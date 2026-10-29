const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const vm=require('node:vm');
const {JSDOM}=require('jsdom');
const source=file=>readFileSync(join(__dirname,'..',file),'utf8');
const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
const alex='@t2_alex:reddit.com',jules='@t2_jules:reddit.com',owner='@t2_me:reddit.com';
const deletedCard='<div class="card"><p>This account was deleted</p></div>';
const bannedCard='<div class="card"><p>u/x has been suspended</p></div>';
const liveCard='<div class="card"><faceplate-img avatar><img src="https://styles.redditmedia.com/t5_1/styles/profileIcon_a.png"></faceplate-img><p>A person who once deleted a post</p></div>';

// The extension's storage and service worker, as in cache.test.cjs.
function storage() {
  const data={};return {data,async get(keys){if(keys===null)return clone(data);return Object.fromEntries([].concat(keys).filter(key=>key in data).map(key=>[key,clone(data[key])]));},async set(value){Object.assign(data,clone(value));},async remove(keys){for(const key of [].concat(keys))delete data[key];},async setAccessLevel(){}};
}
function broker() {
  const local=storage(),session=storage(),handlers=[];
  const chrome={storage:{local,session},runtime:{id:'test-extension',getURL:path=>'chrome-extension://test-extension/'+path,onMessage:{addListener(fn){handlers.push(fn);}}}};
  const context=vm.createContext({chrome,crypto:require('node:crypto').webcrypto,Date,Map,Promise,TextEncoder});
  context.importScripts=(...files)=>{for(const file of files)vm.runInContext(source('extension/'+file),context);};
  vm.runInContext(source('extension/cache-broker.js'),context);
  const sender=tab=>({id:chrome.runtime.id,tab:{id:tab},documentId:'doc-'+tab});
  return {local,send:(message,from=sender(1))=>new Promise(resolve=>{for(const handler of handlers)handler({scope:'rcs-directory',...message},from,resolve);}),sender};
}

// A deleted partner (Alex) and a second one (Jules). The profile only says isDeleted; the member events keep the names.
// A virtual clock makes the 2.5 s spacing, the Retry-After pause and the one-day retry observable without waiting.
function setup(t,{cache,tab=1,cards={},unnamed=[],compact=false}={}) {
  const dom=new JSDOM('<!doctype html><body></body>',{url:'https://www.reddit.com/chat/',runScripts:'outside-only',pretendToBeVisual:true});
  t.after(()=>dom.window.close());const W=dom.window;W.matchMedia=()=>({matches:true});
  let now=1800000000000;const realSetTimeout=W.setTimeout.bind(W);
  W.Date.now=()=>now;
  W.setTimeout=(fn,ms=0,...args)=>realSetTimeout(()=>{now+=ms;fn(...args);},0,...args);
  const requests=[];let active=0,peak=0;
  W.fetch=async(url,init)=>{
    requests.push({url:String(url),init,at:now});active++;peak=Math.max(peak,active);
    try {
      await new Promise(resolve=>realSetTimeout(resolve,2));
      const name=decodeURIComponent(String(url).split('/').pop()),card=cards[name];
      if(typeof card==='function')return card(requests.length);
      if(card===undefined)return new Response('',{status:404});
      return new Response(card,{status:200});
    } finally {active--;}
  };
  if(cache)W.chrome={runtime:{sendMessage:message=>cache.send(message,cache.sender(tab))}};
  for(const file of ['demo/fixture.js','extension/directory-model.js','extension/search-core.js','extension/adapter.js','extension/history-store.js','extension/native-identities.js','extension/page-bridge.js','extension/data-client.js','extension/directory-store.js','extension/native-labels.js'])W.eval(source(file));
  const api=W.ChatFixture.build(W.document.body,{compact}),A=W.RCSAdapter;
  const rows=A.queryAll('rs-rooms-nav-room',api.nav),users=rows[0].users,profile=users.getRedditUserById;
  users.getRedditUserById=async id=>['t2_alex','t2_jules'].includes(id)?{isDeleted:true,name:'[deleted]',displayName:'[deleted]'}:profile(id);
  const client=api.app.querySelector('rs-matrix-client').client,getRooms=client.getRoomList;
  client.getRoomList=async options=>{const data=await getRooms(options);
    for(const [id,sender,name] of [['alex',alex,'Odd-Ratio-3098'],['jules',jules,'Calm_River_7']]) {
      const room=data.rooms.find(item=>item.room_id===id);
      if(room){room.state=room.state.filter(event=>!(event.type==='m.room.member' && event.state_key===sender));
        if(!unnamed.includes(id))room.state.push({type:'m.room.member',state_key:sender,sender,origin_server_ts:123,content:{displayname:name,membership:'join',avatar_url:'https://example.invalid/'+id+'.png'}});}
    }
    return data;};
  for(const row of rows)if(['alex','jules'].includes(row.getAttribute('room'))){A.query('.room-name',row).textContent='[deleted]';A.query('a',row).setAttribute('aria-label','Direct chat with [deleted]');}
  A.query('header .name',api.room).textContent='[deleted]';
  if(unnamed.length){const rooms=client.getRooms;client.getRooms=()=>rooms().map(room=>unnamed.includes(room.roomId) ? {...room,getMembers:()=>[]} : room);}
  if(unnamed.length){
    // Reddit scrubs a deleted account's member events everywhere, not only in the directory listing.
    const ids=new Set(unnamed.map(id=>'@t2_'+id+':reddit.com')),request=client.http.authedRequest,scrub=list=>Array.isArray(list)?list.filter(event=>!(event.type==='m.room.member' && ids.has(event.state_key))):list;
    client.http.authedRequest=async(...args)=>{const data=await request(...args);if(!data || typeof data!=='object')return data;return {...data,...(data.chunk?{chunk:scrub(data.chunk)}:{}),...(data.state?{state:scrub(data.state)}:String(args[1]).endsWith('/events')?{state:[]}:{})};};
    const direct=client.getRoomList;client.getRoomList=async options=>{const data=await direct(options);for(const room of data.rooms || [])if(Array.isArray(room.state))room.state=scrub(room.state);return data;};
  }
  const settle=async(ms=60)=>{for(let i=0;i<ms;i++)await new Promise(resolve=>realSetTimeout(resolve,2));};
  return {W,api,A,client,requests,peak:()=>peak,settle,clock:{get:()=>now,advance:ms=>{now+=ms;}},rows};
}
const people=async(env,cache)=>{
  const records=await env.W.RCSData.request('conversations').promise;
  const directory=new Map(records.map(record=>[record.id,record]));
  return {records,directory,index:new env.W.RCSCore.MessageIndex(Infinity),byId:id=>records.find(record=>record.id===id)};
};

test('the directory model stores one classification per account and never keeps it for a live account',()=>{
  const dom=new JSDOM('',{runScripts:'outside-only'});const M=(dom.window.eval(source('extension/directory-model.js')),dom.window.RCSDirectoryModel);
  const base={id:alex,name:'Odd-Ratio-3098',historicalName:true,accountUnavailable:true,availabilityKnown:true,verifiedAt:10};
  assert.equal(M.identity({...base,accountState:'banned',accountStateCheckedAt:5}).accountState,'banned');
  assert.equal(M.identity({...base,accountState:'something else'}).accountState,'','only deleted or banned are accepted');
  // A newer scan that did not ask keeps the answer; a live account drops it.
  const kept=M.mergeIdentity(M.identity({...base,accountState:'deleted',accountStateCheckedAt:5}),M.identity({...base,verifiedAt:20}));
  assert.equal(kept.accountState,'deleted');assert.equal(kept.accountStateCheckedAt,5);
  const live=M.mergeIdentity(M.identity({...base,accountState:'deleted'}),M.identity({...base,accountUnavailable:false,verifiedAt:30}));
  assert.equal(live.accountState,'');
  const entry=M.normalise({conversations:[{id:'r',type:'direct',participantIds:[alex]}],identities:{[alex]:{...base,accountState:'banned'}},directoryComplete:true},owner);
  const record=M.view(entry).records[0];assert.equal(record.accountState,'banned');assert.equal(record.accountUnavailable,true);
  // The shared wording and glyphs.
  assert.deepEqual(['deleted','banned','','whatever'].map(state=>M.accountMarker(state).label),['Deleted account','Banned account','Unavailable account','Unavailable account']);
  assert.equal(M.accountMarker('banned',true).title,'Banned account · Retained username');
  assert.equal(new Set(['deleted','banned','unavailable'].map(state=>M.accountMarker(state).path)).size,3,'three different icons');
});

test('visible deleted and suspended partners are told apart by the hover card, one request at a time, at least 2.5 s apart',async t=>{
  const env=setup(t,{cards:{'Odd-Ratio-3098':deletedCard,'Calm_River_7':bannedCard}});
  const {records}=await people(env);
  assert.equal(records.find(record=>record.id==='alex').accountState,'');
  const ids=[alex,jules];
  await env.W.RCSData.request('identity-snapshot',{owner,people:[],rooms:[],records:[],identities:[]}).promise;
  env.W.RCSData.request('classify-accounts',{owner,source:'native',ids}).promise;
  await env.settle(400);
  assert.deepEqual(env.requests.map(request=>decodeURIComponent(request.url.split('/').pop())),['Odd-Ratio-3098','Calm_River_7']);
  const first=env.requests[0];
  assert.equal(first.url,'https://www.reddit.com/svc/shreddit/user-hover-card/Odd-Ratio-3098');
  assert.equal(first.init.credentials,'omit');assert.equal(first.init.redirect,'error');assert.equal(first.init.headers.Accept,'text/vnd.reddit.partial+html, text/html;q=0.9');
  assert.ok(env.requests[1].at-first.at>=2500,'at least 2.5 s between requests');assert.equal(env.peak(),1,'never two at once');
  const after=await people(env);
  assert.equal(after.byId('alex').accountState,'deleted');assert.equal(after.byId('jules').accountState,'banned');
  assert.equal(after.byId('alex').identities[0].accountState,'deleted');
  // Asking again for someone already answered costs nothing.
  env.W.RCSData.request('classify-accounts',{owner,source:'native',ids}).promise;await env.settle(100);
  assert.equal(env.requests.length,2);
});

test('nobody without a retained username is ever looked up, and a live hover card is not a classification',async t=>{
  const env=setup(t,{unnamed:['alex'],cards:{'Calm_River_7':liveCard}});
  await people(env);await env.W.RCSData.request('identity-snapshot',{owner,people:[],rooms:[],records:[],identities:[]}).promise;
  env.W.RCSData.request('classify-accounts',{owner,source:'native',ids:[alex,jules,'@t2_unknown:reddit.com']}).promise;
  await env.settle(300);
  assert.deepEqual(env.requests.map(request=>request.url.split('/').pop()),['Calm_River_7'],'only the one with a retained name');
  const after=await people(env);assert.equal(after.byId('jules').accountState,'','a live-looking card proves nothing');assert.equal(after.byId('alex').accountState,'');
  // Today's attempt is spent: nothing more until a day has passed, then exactly one more.
  env.W.RCSData.request('classify-accounts',{owner,source:'native',ids:[jules]}).promise;await env.settle(100);assert.equal(env.requests.length,1);
  env.clock.advance(86400000+1);env.W.RCSData.request('classify-accounts',{owner,source:'native',ids:[jules]}).promise;await env.settle(200);
  assert.equal(env.requests.length,2);
});

test('a rate limit pauses everything for Retry-After, and a failed request is retried after about ten minutes without being saved',async t=>{
  let call=0;
  const env=setup(t,{cards:{'Odd-Ratio-3098':()=>(++call===1?new Response('',{status:429,headers:{'Retry-After':'120'}}):new Response(deletedCard,{status:200})),'Calm_River_7':()=>{throw new TypeError('network down');}}});
  await people(env);await env.W.RCSData.request('identity-snapshot',{owner,people:[],rooms:[],records:[],identities:[]}).promise;
  env.W.RCSData.request('classify-accounts',{owner,source:'native',ids:[alex,jules]}).promise;await env.settle(500);
  const times=env.requests.map(request=>request.at);
  assert.equal(env.requests.length,3,'429, the retry, then Jules once');
  assert.ok(times[1]-times[0]>=120000,'waited for Retry-After');assert.ok(times[2]-times[1]>=2500);
  const after=await people(env);assert.equal(after.byId('alex').accountState,'deleted');assert.equal(after.byId('jules').accountState,'','a failure is not an answer');
  env.W.RCSData.request('classify-accounts',{owner,source:'native',ids:[jules]}).promise;await env.settle(100);
  assert.equal(env.requests.length,3,'not retried immediately');
  assert.equal(after.byId('jules').accountStateCheckedAt||0,0,'a failed request is not saved as a check');
  env.clock.advance(600001);env.W.RCSData.request('classify-accounts',{owner,source:'other',ids:[jules]}).promise;await env.settle(100);
  assert.equal(env.requests.length,4,'retried after about ten minutes');
});

test('the answer is saved with the account, survives a reload and is never requested again',async t=>{
  const cache=broker();
  const first=setup(t,{cache,cards:{'Odd-Ratio-3098':deletedCard,'Calm_River_7':bannedCard}});
  // Save the directory once (as the extension does after loading), then let the labels report what is on screen.
  const records=await first.W.RCSDirectory.load().promise;
  assert.equal(records.find(record=>record.id==='alex').accountUnavailable,true);
  const directory=new Map(records.map(record=>[record.id,record]));
  await first.W.RCSNativeLabels.update(directory,new first.W.RCSCore.MessageIndex(Infinity),owner);
  await first.settle(500);
  assert.deepEqual(first.requests.map(request=>request.url.split('/').pop()).sort(),['Calm_River_7','Odd-Ratio-3098'],'rows on screen are classified');
  const saved=cache.local.data['rcs-directory-v2:'+owner];
  assert.equal(saved.identities[alex].accountState,'deleted');assert.equal(saved.identities[jules].accountState,'banned');
  assert.ok(saved.identities[alex].accountStateCheckedAt>0);
  // A new tab reads it back without any request; its rows are labelled from the saved answer.
  const second=setup(t,{cache,tab:2,cards:{}});
  const restored=await second.W.RCSDirectory.load().promise;
  assert.equal(restored.find(record=>record.id==='alex').accountState,'deleted');assert.equal(restored.find(record=>record.id==='jules').accountState,'banned');
  await second.W.RCSNativeLabels.update(new Map(restored.map(record=>[record.id,record])),new second.W.RCSCore.MessageIndex(Infinity),owner);
  await second.settle(300);assert.equal(second.requests.length,0,'one request per person, ever');
  const badge=second.A.query('[data-rcs-ui="identity-status"]',second.rows.find(row=>row.getAttribute('room')==='alex'));
  assert.equal(badge.getAttribute('aria-label'),'Deleted account');
});

test('the broker only sets the classification on an unavailable account that is already saved',async t=>{
  const cache=broker(),key='rcs-directory-v2:'+owner;
  const unavailable={id:alex,name:'Odd-Ratio-3098',historicalName:true,accountUnavailable:true,availabilityKnown:true,verifiedAt:1},live={id:jules,name:'Calm_River_7',availabilityKnown:true,verifiedAt:1};
  const claim=await cache.send({action:'acquire',owner});
  await cache.send({action:'publish',owner,token:claim.token,records:[{id:'a',type:'direct',participantIds:[alex]},{id:'j',type:'direct',participantIds:[jules]}],identities:[unavailable,live],full:true});
  const result=await cache.send({action:'identity-state',owner,states:[{id:alex,accountState:'banned',accountStateCheckedAt:50},{id:jules,accountState:'deleted',accountStateCheckedAt:50},{id:'@t2_stranger:reddit.com',accountState:'deleted',accountStateCheckedAt:50},{id:alex,accountState:'x',accountStateCheckedAt:'now'}]});
  assert.equal(result.ok,true);assert.equal(cache.local.data[key].identities[alex].accountState,'banned');assert.equal(cache.local.data[key].identities[jules].accountState,'');
  assert.equal(cache.local.data[key].identities['@t2_stranger:reddit.com'],undefined);
  // A later "could not tell" note keeps the answer but moves the check time.
  await cache.send({action:'identity-state',owner,states:[{id:alex,accountState:'',accountStateCheckedAt:90}]});
  assert.equal(cache.local.data[key].identities[alex].accountState,'banned');assert.equal(cache.local.data[key].identities[alex].accountStateCheckedAt,90);
  // Another tab cannot write someone else's account.
  assert.equal((await cache.send({action:'identity-state',owner:'bad',states:[]})).ok,false);
});

test('native chat list rows and the room header show one labelled icon per state, placed on the preview line',async t=>{
  const env=setup(t);const {directory,index,records}=await people(env);
  records.find(record=>record.id==='alex').accountState='deleted';records.find(record=>record.id==='jules').accountState='banned';
  for(const record of records)for(const person of record.identities || [])if(person.id===alex)person.accountState='deleted';else if(person.id===jules)person.accountState='banned';
  await env.W.RCSNativeLabels.update(directory,index);
  const A=env.A,row=id=>env.rows.find(item=>item.getAttribute('room')===id);
  const badge=id=>A.query('[data-rcs-ui="identity-status"]',row(id));
  assert.equal(badge('alex').getAttribute('aria-label'),'Deleted account');assert.equal(badge('alex').title,'Deleted account · Retained username');
  assert.equal(badge('jules').getAttribute('aria-label'),'Banned account');
  assert.equal(badge('alex').textContent,'','an icon, not a word');assert.ok(badge('alex').querySelector('svg'));
  assert.notEqual(badge('alex').innerHTML,badge('jules').innerHTML,'separate glyphs');
  // The row's own description and a single badge per row, even after another pass.
  assert.equal(A.query('a',row('alex')).getAttribute('aria-description'),'Deleted account');
  await env.W.RCSNativeLabels.update(directory,index);
  assert.equal(A.queryAll('[data-rcs-ui="identity-status"]',row('alex')).length,1);
  // The preview line is not widened: the icon floats over the row (or joins a flex line) and reserves room only inside the preview.
  const preview=A.query('.preview',row('alex'));assert.match(preview.getAttribute('style'),/padding-inline-end/);
  const header=A.query('header',env.api.room),mark=A.query('[data-rcs-ui="identity-status"]',header);
  assert.equal(mark.getAttribute('aria-label'),'Deleted account');assert.equal(mark.textContent.trim(),'');
  // A state arriving later swaps the icon in place.
  for(const record of records)for(const person of record.identities || [])if(person.id===alex)person.accountState='banned';
  records.find(record=>record.id==='alex').accountState='banned';
  await env.W.RCSNativeLabels.update(directory,index);
  assert.equal(badge('alex').getAttribute('aria-label'),'Banned account');assert.equal(A.queryAll('[data-rcs-ui="identity-status"]',row('alex')).length,1);
  // Teardown removes every icon and restores the row's own styles.
  const before=preview.getAttribute('style');env.W.RCSNativeLabels.clear();
  assert.equal(A.queryAll('[data-rcs-ui="identity-status"]',env.api.nav).length,0);assert.equal(A.queryAll('[data-rcs-ui="identity-status"]',env.api.room).length,0);
  assert.doesNotMatch(preview.getAttribute('style') || '',/padding-inline-end/);assert.notEqual(before,preview.getAttribute('style'));
});

test('on-screen unavailable people are reported to the classifier; rows without a name are not',async t=>{
  const env=setup(t,{unnamed:['jules']});const {directory,index}=await people(env);
  const calls=[];env.W.RCSDirectory={classify:(source,ids)=>calls.push([source,[...ids].sort()])};
  await env.W.RCSNativeLabels.update(directory,index,owner);
  assert.deepEqual(calls.at(-1),['native',[alex]],'Jules has no retained name and is never offered');
  env.W.RCSNativeLabels.clear();assert.deepEqual(calls.at(-1),['native',[]],'teardown withdraws the request');
});

test('a banned account is found by "banned", a deleted or unclassified one by "deleted"',()=>{
  const dom=new JSDOM('',{runScripts:'outside-only'});dom.window.eval(source('extension/search-core.js'));dom.window.eval(source('extension/global-search-model.js'));
  const M=dom.window.RCSGlobalSearchModel,records=[{id:'d',name:'A',accountUnavailable:true,accountState:'deleted'},{id:'b',name:'B',accountUnavailable:true,accountState:'banned'},{id:'u',name:'C',accountUnavailable:true}];
  const find=query=>M.matchPeople(new Map(records.map(record=>[record.id,record])),query,{filter:'all',chatType:'all',sort:'newest'}).map(record=>record.id).sort().slice();
  assert.deepEqual([...find('banned')],['b']);assert.deepEqual([...find('deleted')],['d','u']);
});

test('a saved deleted/banned answer survives directory refreshes that carry stale or group-chat copies of the person',async t=>{
  const cache=broker(),key='rcs-directory-v2:'+owner;
  const person={id:alex,name:'Odd-Ratio-3098',historicalName:true,accountUnavailable:true,availabilityKnown:true,verifiedAt:1};
  let claim=await cache.send({action:'acquire',owner});
  await cache.send({action:'publish',owner,token:claim.token,records:[{id:'a',type:'direct',participantIds:[alex]}],identities:[person],full:true});
  await cache.send({action:'identity-state',owner,states:[{id:alex,accountState:'deleted',accountStateCheckedAt:50}]});
  // Refresh copies built before the answer arrived (one per conversation the person is in), none carrying it.
  claim=await cache.send({action:'acquire',owner});
  const stale={...person,verifiedAt:60,accountState:'',accountStateCheckedAt:0},group={...stale,verifiedAt:61};
  await cache.send({action:'checkpoint',owner,token:claim.token,records:[{id:'g',type:'group',participantIds:[alex,jules],identities:[group]},{id:'a',type:'direct',participantIds:[alex],identities:[stale]}],identities:[stale]});
  const saved=cache.local.data[key];
  assert.equal(saved.accountStates[alex].state,'deleted','kept in its own map');
  const record=(await cache.send({action:'read',owner})).entry.records.find(item=>item.id==='a');
  assert.equal(record.accountState,'deleted','the saved answer is what the chat shows');
});
