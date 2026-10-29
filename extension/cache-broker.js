/* Directory coordination and saved-message storage. Reddit credentials stay in the page. */
importScripts('directory-model.js');
const Model=RCSDirectoryModel;
const cachePrefix='rcs-directory-v2:';
const oldPrefix='rcs-directory-v1:';
const leasePrefix='rcs-directory-lease:';
const sessionPrefix='rcs-directory-session-v2:';
const trafficPrefix='rcs-traffic-v1:';
const cooldownPrefix='rcs-request-cooldown-v1:';
const recentPrefix='rcs-unified-recent:';
// A server hint or a page script can never block directory requests for longer than this.
const maxCooldownMs=3600000;
let queue=Promise.resolve();
chrome.storage.local.setAccessLevel?.({accessLevel:'TRUSTED_CONTEXTS'});
async function entryFor(owner) {
  const key=cachePrefix+owner;
  const stored=await chrome.storage.local.get([key,oldPrefix+owner]);
  if(stored[key]?.schema===2)return stored[key];
  if(stored[oldPrefix+owner]) {
    const entry=Model.normalise(stored[oldPrefix+owner],owner);
    await chrome.storage.local.set({[key]:entry});
    await chrome.storage.local.remove(oldPrefix+owner);return entry;
  }
}
function mergeRecords(previous, additions) {
  const records=new Map((previous || []).map(record=>[record.id,record]));
  for(const record of additions || [])records.set(record.id,record);
  return [...records.values()];
}
async function handle(message,sender) {
  if(sender.id!==chrome.runtime.id || message?.scope!=='rcs-directory')return;
  if(message.action==='clear') {
    if(sender.tab || !sender.url?.startsWith(chrome.runtime.getURL('')))throw Error('Open the extension popup to clear the cache.');
    const all=await chrome.storage.local.get(null);
    await chrome.storage.local.remove(Object.keys(all).filter(key=>key.startsWith(cachePrefix)||key.startsWith(oldPrefix)||key.startsWith(cooldownPrefix)));
    const session=await chrome.storage.session.get(null);
    await chrome.storage.session.remove(Object.keys(session).filter(key=>key.startsWith(leasePrefix)||key.startsWith(sessionPrefix)));
    // Traffic state keeps a session copy of the cooldown; clearing must end a lockout but not live permits.
    const traffic={};for(const key of Object.keys(session))if(key.startsWith(trafficPrefix))traffic[key]={...session[key],cooldownUntil:0};
    if(Object.keys(traffic).length)await chrome.storage.session.set(traffic);
    return {cleared:true};
  }
  const owner=message.owner;
  if(typeof owner!=='string' || !/^@[^:\s]{1,200}:[^\s]{1,200}$/.test(owner))throw Error('Invalid account');
  const holder=sender.tab?.id+':'+(sender.documentId || sender.frameId || 0);
  const now=Date.now();
  if(message.action==='detach') {
    const leaseKey=leasePrefix+owner,trafficKey=trafficPrefix+owner;
    const saved=await chrome.storage.session.get([leaseKey,trafficKey]);
    if(saved[leaseKey]?.holder===holder)await chrome.storage.session.remove(leaseKey);
    if(saved[trafficKey])await chrome.storage.session.set({[trafficKey]:{...saved[trafficKey],permits:saved[trafficKey].permits.filter(p=>p.holder!==holder)}});
    return {detached:true};
  }
  if(message.action.startsWith('traffic-')) {
    const key=trafficPrefix+owner;
    const traffic=(await chrome.storage.session.get(key))[key] || {permits:[],cooldownUntil:0};
    const cooldownKey=cooldownPrefix+owner;
    const cooldown=(await chrome.storage.local.get(cooldownKey))[cooldownKey];
    // Values saved before the cap (or edited storage) are clamped on read as well.
    const bounded=value=>Number.isFinite(value) && value>now ? Math.min(value,now+maxCooldownMs) : 0;
    traffic.cooldownUntil=Math.max(bounded(traffic.cooldownUntil),bounded(cooldown?.until));
    traffic.permits=traffic.permits.filter(permit=>permit.expires>now);
    if(message.action==='traffic-cooldown') {
      // Past or invalid hints are ignored rather than stored.
      const until=bounded(message.until);
      if(until>traffic.cooldownUntil) {
        traffic.cooldownUntil=until;
        await chrome.storage.local.set({[cooldownKey]:{until}});
      }
    } else if(message.action==='traffic-acquire') {
      if(traffic.cooldownUntil>now)return {busy:true,waitMs:Math.min(1000,traffic.cooldownUntil-now),cooldown:true};
      if(traffic.permits.length>=2 || message.priority!=='interactive' && traffic.permits.some(p=>p.priority!=='interactive'))return {busy:true,waitMs:250};
      const token=crypto.randomUUID();
      traffic.permits.push({token,holder,priority:message.priority==='interactive'?'interactive':'background',expires:now+120000});
      await chrome.storage.session.set({[key]:traffic});return {token};
    } else if(message.action==='traffic-renew') {
      const permit=traffic.permits.find(p=>p.token===message.token&&p.holder===holder);
      if(!permit)throw Error('Request coordination expired');
      permit.expires=now+120000;
    } else if(message.action==='traffic-release')traffic.permits=traffic.permits.filter(p=>p.token!==message.token||p.holder!==holder);
    else throw Error('Unknown request operation');
    await chrome.storage.session.set({[key]:traffic});return {cooldownUntil:traffic.cooldownUntil};
  }
  const key=cachePrefix+owner,leaseKey=leasePrefix+owner,sessionKey=sessionPrefix+owner;
  const stored=await chrome.storage.session.get([leaseKey,sessionKey]);
  const lease=stored[leaseKey],session=stored[sessionKey] || {};
  const entry=await entryFor(owner);
  const reply={entry:Model.view(entry),verifiedAt:session.verifiedAt || 0};
  if(message.action==='read')return reply;
  if(message.action==='invalidate') {await chrome.storage.session.remove(sessionKey);return {...reply,verifiedAt:0};}
  if(message.action==='identity-state') {
    // A classification of an unavailable account needs no directory lease: it only sets two fields on a person
    // already saved, and this handler runs inside the same serialized queue as every directory write.
    if(!entry || !Array.isArray(message.states))return {changed:false};
    const identityMap={...entry.identities},accountStates={...(entry.accountStates || {})};let changed=false;
    for(const state of message.states.slice(0,50)) {
      const saved=identityMap[state?.id],kind=Model.accountState(state?.accountState);
      if(!saved?.accountUnavailable || !Number.isFinite(state.accountStateCheckedAt))continue;
      const known=accountStates[saved.id];
      if(kind){if(known?.state===kind && known.checkedAt>=state.accountStateCheckedAt)continue;accountStates[saved.id]={state:kind,checkedAt:state.accountStateCheckedAt};}
      // A check without an answer only records when it happened.
      if(saved.accountStateCheckedAt>=state.accountStateCheckedAt && !kind)continue;
      identityMap[saved.id]=Model.identity({...saved,accountState:kind || known?.state || saved.accountState,accountStateCheckedAt:state.accountStateCheckedAt});changed=true;
    }
    if(!changed)return {changed:false};
    const saved=Model.normalise({...entry,identities:identityMap,accountStates},owner);
    await chrome.storage.local.set({[key]:saved});return {changed:true,entry:Model.view(saved)};
  }
  const owns=Boolean(lease && lease.token===message.token && lease.holder===holder && lease.expires>now);
  if(message.action==='acquire') {
    if(lease && lease.expires>now)return {...reply,busy:true};
    const token=crypto.randomUUID();
    await chrome.storage.session.set({[leaseKey]:{token,holder,expires:now+90000}});
    return {...reply,token};
  }
  if(!owns)throw Error('Directory update expired. Please retry.');
  if(message.action==='renew') {
    await chrome.storage.session.set({[leaseKey]:{...lease,expires:now+90000}});return {renewed:true};
  }
  if(message.action==='publish' || message.action==='checkpoint') {
    if(!Array.isArray(message.records))throw Error('Invalid directory');
    const previous=Model.view(entry),identityMap={...(entry?.identities || {})};
    for(const person of message.identities || []) {
      const incoming=Model.identity(person);if(incoming)identityMap[incoming.id]=Model.mergeIdentity(identityMap[incoming.id],incoming);
    }
    // Absence from a scan is not evidence of permanent conversation deletion.
    const records=mergeRecords(previous?.records,message.records);
    const complete=message.action==='publish' && message.full===true || message.discoveryComplete===true;
    const directoryComplete=complete || Boolean(entry?.directoryComplete),activityComplete=message.activityComplete===true || Boolean(entry?.activityComplete);
    const saved=Model.normalise({records,identities:identityMap,accountStates:entry?.accountStates,revision:message.revision || entry?.revision || '',
      nativeRevision:message.nativeRevision || entry?.nativeRevision || '',
      directoryComplete,activityComplete,
      directoryCursor:directoryComplete ? null : Object.hasOwn(message,'directoryCursor') ? message.directoryCursor : entry?.directoryCursor,
      activityCursor:activityComplete ? null : Object.hasOwn(message,'activityCursor') ? message.activityCursor : entry?.activityCursor,
      directoryVerifiedAt:complete ? now : entry?.directoryVerifiedAt || 0},owner);
    await chrome.storage.local.set({[key]:saved});
    if(complete)await chrome.storage.session.set({[sessionKey]:{verifiedAt:now}});
    if(message.action==='publish')await chrome.storage.session.remove(leaseKey);
    return {entry:Model.view(saved),verifiedAt:complete ? now : reply.verifiedAt};
  }
  if(message.action==='release') {await chrome.storage.session.remove(leaseKey);return {released:true};}
  throw Error('Unknown cache operation');
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message?.scope!=='rcs-directory')return;
  const result=queue.then(()=>handle(message,sender));queue=result.catch(()=>{});
  result.then(value=>respond({ok:true,...value}),()=>respond({ok:false,error:'Unable to coordinate the username cache. Please retry.'}));
  return true;
});

/* Independent write queue: directory refreshes cannot block saved-message searches. */
importScripts('search-core.js','message-store.js');
const messages=new RCSMessageStore.Store();
let messageQueue=Promise.resolve();
async function notifyMessageTabs(owner,cleared=false,roomIds) {
  const tabs=await chrome.tabs.query({});
  await Promise.all(tabs.map(tab=>chrome.tabs.sendMessage(tab.id,{scope:'rcs-messages-changed',owner,cleared,...(roomIds?{roomIds}:{})}).catch(()=>{})));
}
async function handleMessages(message,sender) {
  if(sender.id!==chrome.runtime.id)throw Error('Invalid sender');
  const popup=!sender.tab && sender.url?.startsWith(chrome.runtime.getURL(''));
  if(!popup && !/^https:\/\/([a-z0-9-]+\.)*reddit\.com\//i.test(sender.url || sender.tab?.url || ''))throw Error('Invalid message origin');
  if(message.action==='clear') {
    if(!popup)throw Error('Open the extension popup to clear saved messages.');
    if(message.owner && !RCSMessageStore.ownerOK(message.owner))throw Error('Invalid account');
    await messages.clear(message.owner);
    // Recent searches are typed message queries: they are cleared with the messages they came from.
    if(message.owner)await chrome.storage.local.remove(recentPrefix+message.owner);
    else {const all=await chrome.storage.local.get(null);await chrome.storage.local.remove(Object.keys(all).filter(key=>key.startsWith(recentPrefix)));}
    await notifyMessageTabs(message.owner || null,true);return {cleared:true};
  }
  if(message.action==='stats' && popup)return messages.stats(message.owner,{committed:true});
  if(!RCSMessageStore.ownerOK(message.owner))throw Error('Invalid account');
  if(message.action==='ingest') {const result=await messages.ingest(message);if(result.changed!==false)await notifyMessageTabs(message.owner,false,result.roomIds);return result;}
  // Layout hints do not broadcast message changes or restart active searches.
  if(message.action==='image-dimensions')return messages.rememberDimensions(message);
  if(message.action==='mark-native-import-complete'){await messages.importState(message.owner,true);return {nativeImportComplete:true};}
  if(message.action==='stats')return messages.stats(message.owner,{committed:true});
  if(message.action==='summaries')return messages.summaries(message.owner,{committed:true});
  if(message.action==='search')return messages.search(message.owner,{...message,committed:true},await entryFor(message.owner));
  if(message.action==='room') {
    if(typeof message.roomId!=='string' || !message.roomId || message.roomId.length>1000)throw Error('Invalid room');
    return messages.room(message.owner,message.roomId,await entryFor(message.owner),{committed:true});
  }
  throw Error('Unknown message operation');
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  // Answer without opening storage or joining any queue. A timeout probe must
  // distinguish a slow database read from a worker that cannot receive work.
  if(message?.scope==='rcs-cache-health'){respond({ok:sender.id===chrome.runtime.id});return;}
  if(message?.scope!=='rcs-messages')return;
  // Reads see committed data without joining the capture/clear mutation queue.
  // Mutations retain their order and native producers still wait for their ack.
  const reading=['search','room','stats','summaries'].includes(message.action);
  const result=reading?handleMessages(message,sender):messageQueue.then(()=>handleMessages(message,sender));if(!reading)messageQueue=result.catch(()=>{});
  result.then(value=>respond({ok:true,...value}),error=>respond({ok:false,error:error?.message || 'Unable to save messages. Please retry.'}));return true;
});

/* Public post archives have their own bounded transport and never join chat queues. */
importScripts('post-broker.js');
