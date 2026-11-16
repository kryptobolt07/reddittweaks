/* Metadata-only monitoring storage. Account identity is rechecked in the current Reddit tab. */
(() => {
 'use strict';
 if(globalThis.RTRemovalBroker)return;
 const store=globalThis.RTRemovalStore.create({storage:chrome.storage.local}),bindings=new Map();
 const settings=async()=>((await chrome.storage.local.get('rt-settings-v1'))?.['rt-settings-v1'] || {});
 const reddit=sender=>{try{const u=new URL(sender.url);return sender.id===chrome.runtime.id && (sender.frameId==null || sender.frameId===0) && Number.isInteger(sender.tab?.id) && u.protocol==='https:' && !u.port && ['reddit.com','www.reddit.com','new.reddit.com','sh.reddit.com'].includes(u.hostname);}catch{return false;}};
 const badge=async(tabId,text)=>{await chrome.action?.setBadgeText?.({tabId,text});};
 async function context(tabId){
  const me=await chrome.tabs.sendMessage(tabId,{scope:'rt-removal',action:'context'},{frameId:0}).catch(()=>null);
  if(!/^t2_[a-z0-9]{1,13}$/i.test(me?.owner || '') || !/^[\w-]{1,20}$/.test(me?.username || '')){bindings.delete(tabId);await badge(tabId,'');throw Error('Open a signed-in Reddit tab to view your removal checks.');}
  if(bindings.get(tabId)?.owner!==me.owner)await badge(tabId,'');bindings.set(tabId,me);return me;
 }
 async function verify(sender,username){
  if(!reddit(sender))return null;
  const me=await context(sender.tab.id);return me.username.toLowerCase()===username?.toLowerCase()?me:null;
 }
 async function update(owner,value){
  const cfg=await settings();for(const [tabId,known] of [...bindings])if(known.owner===owner){try{const current=await context(tabId);if(current.owner!==owner)continue;await badge(tabId,cfg.ownRemoval===true && cfg.removalNotifications===true && value.unread?String(Math.min(99,value.unread)):'');}catch{}}
 }
 async function handle(message,sender){
  if(sender.id!==chrome.runtime.id)throw Error('Invalid extension sender.');
  const popup=!sender.tab && sender.url===chrome.runtime.getURL('popup.html');
  if(['summary','seen','clear'].includes(message.action)){
   if(!popup || !Number.isInteger(message.tabId))throw Error('Open Reddit Tweaks to manage removal history.');
   const me=await context(message.tabId);if(message.action!=='summary' && message.owner!==me.owner)throw Error('The signed-in account changed. Reopen Reddit Tweaks.');let value;
   if(message.action==='clear'){await store.clear(me.owner);value=await store.read(me.owner,me.username);for(const [id,bound] of bindings)if(bound.owner===me.owner)await chrome.tabs.sendMessage(id,{scope:'rt-removal',action:'cleared',owner:me.owner},{frameId:0}).catch(()=>{});}
   else value=message.action==='seen'?await store.seen(me.owner,me.username):await store.read(me.owner,me.username);
   await update(me.owner,value);if((await context(message.tabId)).owner!==me.owner)throw Error('The signed-in account changed. Reopen Reddit Tweaks.');return {ok:true,value};
  }
  if(!reddit(sender))throw Error('Monitoring requires a top-level Reddit page.');
  if(message.action==='reset'){bindings.delete(sender.tab.id);await badge(sender.tab.id,'');return {ok:true};}
  const me=await verify(sender,message.username);
  if(!me || me.owner!==message.owner)throw Error('The signed-in account changed.');
  // The Removed view's signed-out result cache serves that view whether or not monitoring is on.
  if(message.action==='proofs-load')return {ok:true,proofs:await store.readProofs(me.owner,me.username)};
  if(message.action==='proofs-save'){await store.saveProofs({...me,proofs:message.proofs});return {ok:true};}
  const cfg=await settings();if(cfg.ownRemoval!==true)throw Error('Removal monitoring is off.');
  const value=message.action==='load'?await store.read(me.owner,me.username):message.action==='record'?await store.record({...me,records:message.records,notify:cfg.removalNotifications===true}):null;
  if(!value)throw Error('Unknown monitoring action.');await update(me.owner,value);return {ok:true,value};
 }
 chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message?.scope!=='rt-removal' || ['context','cleared'].includes(message.action))return;
  handle(message,sender).then(respond,error=>respond({ok:false,error:error.message || 'Removal history is unavailable.'}));return true;
 });
 chrome.storage.onChanged?.addListener(async(changes,area)=>{
  if(area!=='local' || !changes['rt-settings-v1'])return;
  const cfg=changes['rt-settings-v1'].newValue || {};if(cfg.ownRemoval===true && cfg.removalNotifications===true)return;
  for(const tab of await chrome.tabs.query({url:['https://reddit.com/*','https://www.reddit.com/*','https://new.reddit.com/*','https://sh.reddit.com/*']}))if(Number.isInteger(tab.id))await badge(tab.id,'');
 });
 chrome.tabs?.onRemoved?.addListener(id=>bindings.delete(id));
 globalThis.RTRemovalBroker=Object.freeze({verify});
})();
