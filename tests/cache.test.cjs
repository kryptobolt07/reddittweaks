const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const vm=require('node:vm');
const {JSDOM}=require('jsdom');
const source=file=>readFileSync(join(__dirname,'..',file),'utf8');
const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
function storage() {
  const data={};return {data,async get(keys){if(keys===null)return clone(data);return Object.fromEntries([].concat(keys).filter(key=>key in data).map(key=>[key,clone(data[key])]));},async set(value){Object.assign(data,clone(value));},async remove(keys){for(const key of [].concat(keys))delete data[key];},async clear(){for(const key of Object.keys(data))delete data[key];},async setAccessLevel(){}};
}
function broker() {
  const local=storage(),session=storage(),handlers=[];
  const chrome={storage:{local,session},runtime:{id:'test-extension',getURL:path=>'chrome-extension://test-extension/'+path,onMessage:{addListener(fn){handlers.push(fn);}}}};
  const start=()=>{
    handlers.length=0;
    const context=vm.createContext({chrome,crypto:require('node:crypto').webcrypto,Date,Map,Promise,TextEncoder});
    context.importScripts=(...files)=>{for(const file of files)vm.runInContext(source('extension/'+file),context);};
    vm.runInContext(source('extension/cache-broker.js'),context);
  };start();
  const sender=tab=>({id:chrome.runtime.id,tab:{id:tab},documentId:'doc-'+tab});
  const send=(message,from=sender(1))=>new Promise(resolve=>{for(const handler of handlers)handler({scope:'rcs-directory',...message},from,resolve);});
  return {local,session,send,start,sender};
}
const owner='@t2_me:reddit.com';
function environment(cache,tab=1,{content=false}={}) {
  const dom=new JSDOM('<!doctype html><body></body>',{url:'https://www.reddit.com/chat/',runScripts:'outside-only',pretendToBeVisual:true});const W=dom.window;
  W.chrome={runtime:{sendMessage:message=>cache.send(message,cache.sender(tab))}};
  W.matchMedia=()=>({matches:true});W.HTMLElement.prototype.scrollIntoView=function(){};
  for(const file of ['demo/fixture.js','extension/directory-model.js','extension/search-core.js','extension/adapter.js','extension/history-store.js','extension/native-identities.js','extension/page-bridge.js','extension/data-client.js','extension/directory-store.js'])W.eval(source(file));
  const api=W.ChatFixture.build(W.document.body);const client=api.app.querySelector('rs-matrix-client').client;
  const listeners=new Map();client.on=(event,fn)=>listeners.set(event,fn);client.off=event=>listeners.delete(event);
  if(content){W.eval(source('extension/date-picker.js'));W.eval(source('extension/content.js'));}
  return {dom,W,api,client,listeners};
}
const tick=ms=>new Promise(resolve=>setTimeout(resolve,ms||250));
test('broker serializes simultaneous directory fetches, persists the lease across restart, and isolates accounts',async t=>{
  const cache=broker();const [a,b]=await Promise.all([cache.send({action:'acquire',owner}),cache.send({action:'acquire',owner},cache.sender(2))]);
  assert.ok(a.token);assert.equal(b.busy,true);cache.start();
  assert.equal((await cache.send({action:'acquire',owner},cache.sender(2))).busy,true);
  assert.ok((await cache.send({action:'acquire',owner:'@t2_other:reddit.com'},cache.sender(2))).token);
  assert.equal((await cache.send({action:'publish',owner,token:a.token,records:[],revision:'one'},cache.sender(2))).ok,false);
  const published=await cache.send({action:'publish',owner,token:a.token,records:[{id:'room',name:'Person',text:'private message',token:'secret',element:{nodeType:1},avatar:'https://example.com/icon.png',participantIds:['@t2_person:reddit.com']}],revision:'one'});
  assert.ok(published.ok);assert.equal(published.entry.records[0].text,undefined);assert.equal(published.entry.records[0].token,undefined);assert.equal(published.entry.records[0].element,undefined);
  assert.ok((await cache.send({action:'acquire',owner},cache.sender(2))).entry);
});
test('saved directory survives a new tab, issues no Reddit reads, and can open an uncached native room',async t=>{
  const cache=broker();const first=environment(cache);t.after(()=>first.dom.window.close());const records=await first.W.RCSDirectory.load().promise;
  assert.equal(records.length,7);assert.ok(first.api.calls.some(call=>call.method==='rooms' && call.options.page_size===200));first.dom.window.close();
  const second=environment(cache,2);t.after(()=>second.dom.window.close());const restored=await second.W.RCSDirectory.load().promise;
  assert.equal(restored.find(record=>record.id==='oldfriend').name,'old_friend');assert.equal(second.api.calls.length,0);
  await second.W.RCSData.request('open',{roomId:'oldfriend'}).promise;assert.equal(second.api.active.id,'oldfriend');assert.equal(second.api.calls[0].method,'rooms');second.dom.window.close();
});
test('pending invite status persists without a forbidden lookup and resolves after acceptance across restart',async t=>{
  const cache=broker();let lookups=0;
  const addRestricted=env=>{
    const getRooms=env.client.getRooms,read=env.client.getRoomList;
    env.client.getRooms=()=>[...getRooms(),{roomId:'restricted',name:'Chat request',getMyMembership:()=> 'invite'}];
    env.client.getRoomList=async options=>{const data=await read(options);data.rooms.push({room_id:'restricted',membership:'invite',state:[]});return data;};
    env.client.http.authedRequest=async()=>{lookups++;throw Object.assign(Error('forbidden'),{httpStatus:403});};
  };
  const first=environment(cache);t.after(()=>first.dom.window.close());addRestricted(first);
  const records=await first.W.RCSDirectory.load().promise;
  assert.equal(records.find(r=>r.id==='oldfriend').name,'old_friend');
  assert.equal(records.find(r=>r.id==='restricted').status,'invite-pending');assert.equal(lookups,0);
  assert.equal(cache.local.data['rcs-directory-v2:'+owner].directoryComplete,true,'room enumeration is complete, even though an identity is unresolved');
  first.dom.window.close();const second=environment(cache,2);t.after(()=>second.dom.window.close());addRestricted(second);
  const restored=await second.W.RCSDirectory.load().promise;
  assert.equal(restored.find(r=>r.id==='restricted').identityPending,true);assert.equal(lookups,0);assert.equal(second.api.calls.length,0);
  const getRooms=second.client.getRooms;
  second.client.getRooms=()=>getRooms().map(room=>room.roomId==='restricted'?{roomId:'restricted',name:'Community invitation',getMyMembership:()=> 'join',currentState:{getStateEvents:type=>type==='com.reddit.chat.type'?{getContent:()=>({type:'reddit_modmail'}),getTs:()=>2000}:null}}:room);
  const accepted=await second.W.RCSDirectory.load().promise;
  assert.equal(accepted.find(r=>r.id==='restricted').membership,'join');assert.equal(accepted.find(r=>r.id==='restricted').type,'reddit_modmail');assert.equal(accepted.find(r=>r.id==='restricted').name,'Community invitation');assert.equal(accepted.find(r=>r.id==='restricted').identityPending,false);assert.equal(accepted.find(r=>r.id==='restricted').status,'');assert.equal(lookups,0);
  assert.equal(cache.local.data['rcs-directory-v2:'+owner].conversations.find(r=>r.id==='restricted').membership,'join');
});
test('native membership acceptance resolves a saved pending request without a directory rebuild',async t=>{
  const cache=broker(),env=environment(cache);t.after(()=>env.dom.window.close());let joined=false,lookups=0;
  const read=env.client.getRoomList,getRooms=env.client.getRooms,getRoom=env.client.getRoom;
  const invitation={roomId:'pending-person',name:'Empty room',getMyMembership:()=>joined?'join':'invite',getMembers:()=>joined?[{userId:'@t2_alex:reddit.com',membership:'join',name:'alex_morgan'}]:[]};
  env.client.getRooms=()=>[...getRooms(),invitation];env.client.getRoom=id=>id===invitation.roomId?invitation:getRoom(id);
  env.client.getRoomList=async options=>{const value=await read(options);value.rooms.push({room_id:invitation.roomId,membership:'invite',state:[]});return value;};
  env.client.http.authedRequest=async()=>{lookups++;throw Object.assign(Error('forbidden'),{httpStatus:403});};
  const pending=await env.W.RCSDirectory.load().promise;assert.equal(pending.find(r=>r.id===invitation.roomId).status,'invite-pending');assert.equal(lookups,0);
  env.api.calls.length=0;joined=true;
  env.listeners.get('RoomState.events')({event_id:'$accepted',room_id:invitation.roomId,type:'m.room.member',state_key:owner,origin_server_ts:2000,content:{membership:'join'}});
  await tick(400);const accepted=await env.W.RCSDirectory.load().promise;
  const room=accepted.find(r=>r.id===invitation.roomId);assert.equal(room.membership,'join');assert.equal(room.status,'');assert.equal(room.name,'alex_morgan');assert.equal(room.identityPending,false);assert.equal(lookups,0);assert.equal(env.api.calls.length,0);
});
test('parallel tabs share a single full directory fetch',async t=>{
  const cache=broker();const a=environment(cache),b=environment(cache,2);t.after(()=>{a.dom.window.close();b.dom.window.close();});t.after(()=>a.dom.window.close());
  const results=await Promise.all([a.W.RCSDirectory.load().promise,b.W.RCSDirectory.load().promise]);
  assert.equal(results[0].length,7);assert.equal(results[1].length,7);
  assert.equal([...a.api.calls,...b.api.calls].filter(call=>call.method==='rooms' && call.options.page_size===200).length,1);
  a.dom.window.close();b.dom.window.close();
});
test('native sync with unchanged roster makes no reads; a new DM resolves only the added conversation',async t=>{
  const cache=broker();const env=environment(cache);t.after(()=>env.dom.window.close());await env.W.RCSDirectory.load().promise;env.api.calls.length=0;
  let changes=0;env.W.RCSDirectory.onChange(()=>changes++);env.listeners.get('sync')();await tick(450);
  assert.equal(changes,0);assert.equal(env.api.calls.length,0);
  const getRooms=env.client.getRooms;env.client.getRooms=()=>[...getRooms(),{roomId:'new-room',name:'NewPerson',summaryHeroes:['@t2_new:reddit.com']}];
  const row=env.W.RCSAdapter.query('rs-rooms-nav-room',env.api.nav);const getProfile=row.users.getRedditUserById;
  const profiles=[];row.users.getRedditUserById=async id=>{profiles.push(id);return id==='t2_new'?{name:'NewPerson'}:getProfile(id);};
  env.listeners.get('Room')();await tick(450);assert.equal(changes,1);
  const records=await env.W.RCSDirectory.load().promise;assert.equal(records.length,8);assert.equal(env.api.calls.length,0);assert.deepEqual(profiles,['t2_new']);
  await env.W.RCSDirectory.load().promise;assert.equal(profiles.length,1);env.dom.window.close();
});
test('explicit refresh rebuilds; expired cache does not crawl all rooms; accounts never share cached names',async t=>{
  const cache=broker();const env=environment(cache);t.after(()=>env.dom.window.close());await env.W.RCSDirectory.load().promise;env.api.calls.length=0;
  await env.W.RCSDirectory.load(true).promise;assert.equal(env.api.calls.filter(call=>call.method==='rooms' && call.options.page_size===200).length,1);
  const key=Object.keys(cache.local.data)[0];cache.local.data[key].fetchedAt=Date.now()-25*60*60*1000;env.api.calls.length=0;
  await env.W.RCSDirectory.load().promise;assert.equal(env.api.calls.filter(call=>call.method==='rooms' && call.options.page_size===200).length,0);
  await cache.session.clear();await env.W.RCSDirectory.load().promise;assert.equal(env.api.calls.filter(call=>call.method==='rooms' && call.options.page_size===200).length,0);
  env.client.getUserId=()=>'@t2_other:reddit.com';env.api.calls.length=0;await env.W.RCSDirectory.load().promise;
  assert.ok(env.api.calls.some(call=>call.method==='rooms' && call.options.page_size===200));assert.equal(Object.keys(cache.local.data).length,2);env.dom.window.close();
});
test('clearing saved usernames is available to the extension popup and excludes other storage keys',async t=>{
  const cache=broker();cache.local.data.unrelated={keep:true};const env=environment(cache);t.after(()=>env.dom.window.close());await env.W.RCSDirectory.load().promise;
  assert.equal((await cache.send({action:'clear'})).ok,false);
  const result=await cache.send({action:'clear'},{id:'test-extension',url:'chrome-extension://test-extension/popup.html'});
  assert.equal(result.cleared,true);assert.deepEqual(cache.local.data,{unrelated:{keep:true}});env.dom.window.close();
});
test('result avatars survive repeated DOM sync, keyboard selection, and query changes without new src assignments',async t=>{
  const cache=broker();const env=environment(cache,1,{content:true});t.after(()=>env.dom.window.close());await tick();
  const control=env.W.RCSAdapter.query('[data-rcs-ui="list"]',env.api.nav).shadowRoot;const input=control.querySelector('input');
  const search=value=>{input.value=value;input.dispatchEvent(new env.W.Event('input'));};search('old_friend');const image=control.querySelector('.result img');assert.ok(image);
  let imageMutations=0;const observer=new env.W.MutationObserver(records=>{imageMutations+=records.filter(record=>record.type==='attributes' && record.attributeName==='src' || record.type==='childList' && [...record.addedNodes].some(node=>node.nodeName==='IMG')).length;});
  observer.observe(control.querySelector('.results'),{subtree:true,childList:true,attributes:true});
  for(let i=0;i<5;i++) {env.W.RCSAdapter.query('rs-rooms-nav-room',env.api.nav).setAttribute('test',String(i));await tick(150);}
  input.dispatchEvent(new env.W.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));search('alex');search('old_friend');await tick(20);
  assert.equal(control.querySelector('.result img'),image);assert.equal(imageMutations,0);
  assert.equal(env.api.calls.filter(call=>call.method==='rooms' && call.options.page_size===200).length,1);observer.disconnect();env.dom.window.close();
});
test('one cancelled subscriber does not abort a shared load; failed reads release the lease for retry',async t=>{
  const cache=broker();const env=environment(cache);t.after(()=>env.dom.window.close());let release;
  const original=env.client.getRoomList;env.client.getRoomList=async options=>{await new Promise(resolve=>release=resolve);return original(options);};
  const a=env.W.RCSDirectory.load(),b=env.W.RCSDirectory.load();const cancelled=a.promise.catch(error=>error.message);await tick(30);a.cancel();assert.equal(await cancelled,'Search cancelled');release();assert.equal((await b.promise).length,7);
  env.client.getRoomList=async t=>{throw Object.assign(Error('test'),{httpStatus:400});};await assert.rejects(env.W.RCSDirectory.load(true).promise,/HTTP 400/);
  assert.equal(Object.keys(cache.session.data).filter(key=>key.startsWith('rcs-directory-lease:')).length,0);
  env.client.getRoomList=original;assert.equal((await env.W.RCSDirectory.load(true).promise).length,7);env.dom.window.close();
});
test('a native new-room signal refreshes the visible search automatically and preserves existing result images',async t=>{
  const cache=broker();const env=environment(cache,1,{content:true});t.after(()=>env.dom.window.close());await tick();
  const control=env.W.RCSAdapter.query('[data-rcs-ui="list"]',env.api.nav).shadowRoot;const input=control.querySelector('input');
  input.value='oldfriend';input.dispatchEvent(new env.W.Event('input'));const image=control.querySelector('.result img');
  env.api.calls.length=0;const getRooms=env.client.getRooms;env.client.getRooms=()=>[...getRooms(),{roomId:'new-room',name:'NewPerson',summaryHeroes:['@t2_new:reddit.com']}];
  const users=env.W.RCSAdapter.query('rs-rooms-nav-room',env.api.nav).users;const getProfile=users.getRedditUserById;users.getRedditUserById=async id=>id==='t2_new'?{name:'NewPerson'}:getProfile(id);
  env.listeners.get('Room')();await tick(650);assert.equal(control.querySelector('.result img'),image);
  input.value='NewPerson';input.dispatchEvent(new env.W.Event('input'));assert.equal(control.querySelector('.result .name').textContent,'NewPerson');assert.equal(env.api.calls.length,0);env.dom.window.close();
});
test('cached results remain immediately usable while another tab holds the refresh lease',async t=>{
  const cache=broker();const seed=environment(cache);t.after(()=>seed.dom.window.close());await seed.W.RCSDirectory.load().promise;seed.dom.window.close();
  const lease=await cache.send({action:'acquire',owner});assert.ok(lease.token);
  const waiting=environment(cache,2);t.after(()=>waiting.dom.window.close());const cached=await waiting.W.RCSDirectory.load().promise;
  assert.equal(cached.length,7);assert.equal(waiting.api.calls.length,0);
  await waiting.W.RCSData.request('open',{roomId:'oldfriend'}).promise;assert.equal(waiting.api.active.id,'oldfriend');assert.equal(waiting.api.calls[0].method,'rooms');
  await cache.send({action:'release',owner,token:lease.token});waiting.dom.window.close();
});
test('browser restart restores a complete index without room or profile requests',async t=>{
  const cache=broker(),first=environment(cache);t.after(()=>first.dom.window.close());
  await first.W.RCSDirectory.load().promise;first.dom.window.close();await cache.session.clear();cache.start();
  const fresh=environment(cache,2);t.after(()=>fresh.dom.window.close());
  fresh.client.getRoomList=()=>{throw Error('Unexpected full rebuild');};
  fresh.W.RCSAdapter.query('rs-rooms-nav-room',fresh.api.nav).users.getRedditUserById=()=>{throw Error('Unexpected profile request');};
  const records=await fresh.W.RCSDirectory.load().promise;
  assert.equal(records.length,7);assert.equal(records.find(r=>r.id==='oldfriend').name,'old_friend');assert.equal(fresh.api.calls.length,0);
});
test('v1 cache migration retains aliases and strips private fields while performing the initial complete enumeration',async t=>{
  const cache=broker();cache.local.data['rcs-directory-v1:'+owner]={schema:1,owner,fetchedAt:Date.now(),revision:'old',records:[{
    id:'alex',name:'alex_morgan',aliases:['older-search-name'],participantIds:['@t2_alex:reddit.com'],avatar:'https://example.com/avatar.png',text:'secret message body',token:'secret auth credential'}]};
  const env=environment(cache);t.after(()=>env.dom.window.close());const records=await env.W.RCSDirectory.load().promise;
  const entry=cache.local.data['rcs-directory-v2:'+owner];assert.equal(entry.schema,2);assert.equal(entry.directoryComplete,true);
  assert.equal(Object.keys(entry.identities).length,7);assert.ok(records.find(r=>r.id==='alex').aliases.includes('older-search-name'));
  assert.equal(JSON.stringify(entry).includes('secret message body'),false);assert.equal(JSON.stringify(entry).includes('secret auth credential'),false);
  assert.equal(entry.conversations.find(r=>r.id==='alex').name,'');assert.equal(env.api.calls.filter(c=>c.method==='rooms').length,1);
});
test('request coordination allows one background batch and one interactive request and preserves server cooldown across restart',async()=>{
  const cache=broker();const a=await cache.send({action:'traffic-acquire',owner,priority:'background'});assert.ok(a.token);
  assert.equal((await cache.send({action:'traffic-acquire',owner,priority:'background'},cache.sender(2))).busy,true);
  const b=await cache.send({action:'traffic-acquire',owner,priority:'interactive'},cache.sender(2));assert.ok(b.token);
  assert.equal((await cache.send({action:'traffic-acquire',owner,priority:'interactive'},cache.sender(3))).busy,true);
  await cache.send({action:'traffic-release',owner,token:a.token});await cache.send({action:'traffic-release',owner,token:b.token},cache.sender(2));
  const until=Date.now()+120000;await cache.send({action:'traffic-cooldown',owner,until});await cache.session.clear();cache.start();
  const blocked=await cache.send({action:'traffic-acquire',owner,priority:'interactive'});assert.equal(blocked.busy,true);assert.equal(blocked.cooldown,true);
  assert.equal(cache.local.data['rcs-request-cooldown-v1:'+owner].until,until);
});
test('native startup hydration of known rooms does not refetch their saved profiles',async t=>{
  const cache=broker(),env=environment(cache);t.after(()=>env.dom.window.close());await env.W.RCSDirectory.load().promise;
  env.api.calls.length=0;const users=env.W.RCSAdapter.query('rs-rooms-nav-room',env.api.nav).users,original=users.getRedditUserById;
  const lookups=[];users.getRedditUserById=async id=>{lookups.push(id);return original(id);};
  env.listeners.get('Room')({roomId:'alex'});await tick(450);await env.W.RCSDirectory.load().promise;
  assert.equal(env.api.calls.length,0);assert.equal(lookups.length,0);
});
async function seedRecoveredCache(t,cache) {
  const env=environment(cache);t.after(()=>env.dom.window.close());await env.W.RCSDirectory.load().promise;env.dom.window.close();
  const entry=cache.local.data['rcs-directory-v2:'+owner];
  Object.assign(entry.identities['@t2_alex:reddit.com'],{name:'Odd-Ratio-3098',historicalName:true,accountUnavailable:true,availabilityKnown:true});
  return entry;
}
test('startup restores saved names and native first renders before initial sync; early deleted search never shows placeholder rows',async t=>{
  const cache=broker();await seedRecoveredCache(t,cache);
  const env=environment(cache,2);t.after(()=>env.dom.window.close());const {W,api,client}=env;
  client.isInitialSyncComplete=()=>false;
  // The prefetch started at document_start; delaying owner detection is sufficient to expose the loading phase.
  const getOwner=client.getUserId;let authenticated=false;client.getUserId=()=>authenticated?getOwner():null;
  const row=W.RCSAdapter.query('rs-rooms-nav-room',api.nav);W.RCSAdapter.query('.room-name',row).textContent='[deleted]';
  const frames=[];
  W.eval(`customElements.define('rs-username',class extends HTMLElement {
    constructor(){super();this.username='[deleted]';}
    render(){return this.username;}
    connectedCallback(){this.requestUpdate();}
    requestUpdate(){this.textContent=this.render();}
  });`);
  W.eval(source('extension/native-labels.js'));W.eval(source('extension/date-picker.js'));W.eval(source('extension/content.js'));
  const username=W.document.createElement('rs-username');username.setAttribute('user-id','@t2_alex:reddit.com');api.room.shadowRoot.append(username);
  frames.push(username.textContent);assert.equal(username.textContent,'…');
  const root=W.RCSAdapter.query('[data-rcs-ui="list"]',api.nav).shadowRoot,input=root.querySelector('input');
  input.value='deleted';input.dispatchEvent(new W.Event('input'));
  assert.equal(root.querySelectorAll('.result').length,0);assert.match(root.querySelector('[role="status"]').textContent,/Restoring saved/);
  authenticated=true;await tick(100);
  frames.push(username.textContent);assert.equal(username.textContent,'Odd-Ratio-3098');
  assert.equal(root.querySelector('.result .name').textContent,'Odd-Ratio-3098');assert.equal(frames.includes('[deleted]'),false);
  assert.equal(client.isInitialSyncComplete(),false);assert.equal(api.calls.length,0);
  const startup=W.RCSDirectory.getStartup();assert.equal(startup.pending,false);assert.equal(startup.owner,owner);
});
test('missing dates are backfilled in a bulk pass once, persist across restart, and never store fetched message bodies',async t=>{
  const cache=broker(),entry=await seedRecoveredCache(t,cache);entry.activityComplete=false;
  const env=environment(cache,2);t.after(()=>env.dom.window.close());const original=env.client.getRoomList;
  env.client.getRoomList=async options=>{
    const data=await original(options);
    for(const room of data.rooms)room.chunk=room.room_id==='alex' ? [
      {type:'m.room.message',origin_server_ts:1700000000000,content:{body:'private-date-probe-body'}},
      {type:'m.room.member',origin_server_ts:1900000000000,content:{}}
    ]:[];
    return data;
  };
  const records=await env.W.RCSDirectory.load().promise;
  assert.equal(records.find(r=>r.id==='alex').timestamp,1700000000000);
  assert.equal(records.find(r=>r.id==='alex').name,'Odd-Ratio-3098');
  assert.equal(env.api.calls.length,1);assert.equal(env.api.calls[0].options.include.timeline,true);assert.equal(env.api.calls[0].options.include.state,undefined);
  assert.equal(cache.local.data['rcs-directory-v2:'+owner].activityComplete,true);
  assert.equal(JSON.stringify(cache.local.data).includes('private-date-probe-body'),false);
  await env.W.RCSDirectory.load().promise;assert.equal(env.api.calls.length,1);env.dom.window.close();
  await cache.session.clear();cache.start();const restart=environment(cache,3);t.after(()=>restart.dom.window.close());
  const restored=await restart.W.RCSDirectory.load().promise;
  assert.equal(restored.find(r=>r.id==='alex').timestamp,1700000000000);assert.equal(restart.api.calls.length,0);
});
test('native timeline timestamps update the saved directory without another room or profile lookup',async t=>{
  const cache=broker(),env=environment(cache);t.after(()=>env.dom.window.close());await env.W.RCSDirectory.load().promise;
  env.api.calls.length=0;const getRooms=env.client.getRooms;
  env.client.getRooms=()=>getRooms().map(room=>({...room,getLastActiveTimestamp:()=>room.roomId==='alex'?1800000000000:0}));
  const users=env.W.RCSAdapter.query('rs-rooms-nav-room',env.api.nav).users;let profiles=0;const getProfile=users.getRedditUserById;
  users.getRedditUserById=async id=>{profiles++;return getProfile(id);};
  env.listeners.get('Room.timeline')({getRoomId:()=> 'alex'});await tick(450);
  const records=await env.W.RCSDirectory.load().promise;
  assert.equal(records.find(r=>r.id==='alex').timestamp,1800000000000);assert.equal(profiles,0);assert.equal(env.api.calls.length,0);
});
test('an ordinary Reddit page preloads extension storage without starting a Reddit connection poll',async t=>{
  const cache=broker(),dom=new JSDOM('<!doctype html><body><main>Feed</main></body>',{url:'https://www.reddit.com/',runScripts:'outside-only'});
  t.after(()=>dom.window.close());const W=dom.window;let requests=0;
  W.chrome={runtime:{sendMessage:message=>cache.send(message)}};W.RCSData={request(){requests++;throw Error('Unexpected chat polling');}};
  W.eval(source('extension/directory-store.js'));await tick(30);
  assert.equal(requests,0);assert.equal(W.RCSDirectory.getOwner(),'');
});
test('a stopped stalled request releases its permit and lets another search proceed',async t=>{
  const cache=broker(),env=environment(cache);t.after(()=>env.dom.window.close());const read=env.client.getRoomList;
  env.client.getRoomList=()=>new Promise(()=>{});
  const task=env.W.RCSDirectory.load();task.promise.catch(()=>{});await tick(100);
  assert.equal(cache.session.data['rcs-traffic-v1:'+owner].permits.length,1);
  task.cancel();await tick(100);
  assert.equal(cache.session.data['rcs-traffic-v1:'+owner].permits.length,0);
  env.client.getRoomList=read;assert.equal((await env.W.RCSDirectory.load().promise).length,7);
});
test('a timed-out native operation releases its queue slot rather than renewing forever',async t=>{
  const cache=broker(),env=environment(cache);t.after(()=>env.dom.window.close());const timeout=env.W.setTimeout.bind(env.W);let expire;
  env.W.setTimeout=(fn,ms,...args)=>ms===60000 ? (expire=fn,timeout(()=>{},100000)) : timeout(fn,ms,...args);
  env.client.getRoomList=()=>new Promise(()=>{});
  const task=env.W.RCSDirectory.load(),failure=task.promise.catch(e=>e.message);await tick(100);assert.equal(typeof expire,'function');
  expire();assert.match(await failure,/stopped responding/);
  assert.equal(cache.session.data['rcs-traffic-v1:'+owner].permits.length,0);
});
test('unloading a document releases only its own traffic slots and directory lease',async()=>{
  const cache=broker();const lease=await cache.send({action:'acquire',owner});
  const background=await cache.send({action:'traffic-acquire',owner,priority:'background'});
  const interactive=await cache.send({action:'traffic-acquire',owner,priority:'interactive'},cache.sender(2));
  assert.ok(lease.token&&background.token&&interactive.token);
  await cache.send({action:'detach',owner});
  assert.equal(cache.session.data['rcs-directory-lease:'+owner],undefined);
  assert.deepEqual(cache.session.data['rcs-traffic-v1:'+owner].permits.map(p=>p.token),[interactive.token]);
});
test('an interrupted initial directory crawl resumes its saved page after a new document starts',async t=>{
  const cache=broker(),first=environment(cache);t.after(()=>first.dom.window.close());
  const base=(await first.client.getRoomList({page_size:200})).rooms;
  const rooms=[...base,...Array.from({length:394},(_,i)=>({room_id:'extra-'+i,state:[{type:'com.reddit.chat.type',content:{type:'direct',participants:[owner,'@t2_extra_'+i+':reddit.com']}}]}))];
  first.api.calls.length=0;
  first.client.getRoomList=async options=>{
    first.api.calls.push({method:'rooms',options});if(options.next_batch==='200')throw Object.assign(Error('interrupted'),{httpStatus:400});
    return {rooms:rooms.slice(0,200),next_batch:'200'};
  };
  await assert.rejects(first.W.RCSDirectory.load().promise,/HTTP 400/);
  const entry=cache.local.data['rcs-directory-v2:'+owner];assert.equal(entry.directoryCursor,'200');assert.equal(entry.directoryComplete,false);
  first.dom.window.close();const resumed=environment(cache,2);t.after(()=>resumed.dom.window.close());
  const users=resumed.W.RCSAdapter.query('rs-rooms-nav-room',resumed.api.nav).users,getProfile=users.getRedditUserById;
  users.getRedditUserById=id=>id.startsWith('t2_extra_')?Promise.resolve({name:'Person_'+id.slice(9)}):getProfile(id);
  resumed.client.getRoomList=async options=>{
    resumed.api.calls.push({method:'rooms',options});const offset=Number(options.next_batch||0);
    return {rooms:rooms.slice(offset,offset+200),...(offset+200<rooms.length?{next_batch:String(offset+200)}:{})};
  };
  const records=await resumed.W.RCSDirectory.load().promise;assert.equal(records.length,401);
  assert.deepEqual(Array.from(resumed.api.calls.filter(c=>c.method==='rooms'),c=>c.options.next_batch),['200','400']);
  assert.equal(cache.local.data['rcs-directory-v2:'+owner].directoryComplete,true);assert.equal(cache.local.data['rcs-directory-v2:'+owner].directoryCursor,null);
});
test('completed room discovery is saved before profile resolution, so a stopped profile phase does not repeat room pages',async t=>{
  const cache=broker(),first=environment(cache);t.after(()=>first.dom.window.close());
  const users=first.W.RCSAdapter.query('rs-rooms-nav-room',first.api.nav).users;users.getRedditUserById=()=>new Promise(()=>{});
  const task=first.W.RCSDirectory.load();task.promise.catch(()=>{});await tick(120);
  assert.equal(cache.local.data['rcs-directory-v2:'+owner].directoryComplete,true);
  task.cancel();await tick(100);first.dom.window.close();
  const resumed=environment(cache,2);t.after(()=>resumed.dom.window.close());const records=await resumed.W.RCSDirectory.load().promise;
  assert.equal(records.length,7);assert.equal(records.find(r=>r.id==='oldfriend').name,'old_friend');
  // The interrupted run never fetched conversation dates, so discovery being complete must not mark dates complete:
  // exactly one dates page is read now, and room discovery is not repeated.
  assert.equal(resumed.api.calls.map(call=>call.method).join(),'rooms');assert.equal(resumed.api.calls[0].options.include.timeline,true);
});
test('the date backfill resumes its saved page after refresh and retains dates from earlier pages',async t=>{
  const cache=broker(),entry=await seedRecoveredCache(t,cache);entry.activityComplete=false;
  const first=environment(cache,2);t.after(()=>first.dom.window.close());const base=(await first.client.getRoomList({page_size:200})).rooms;first.api.calls.length=0;
  const dated=base.map((r,i)=>({...r,chunk:[{type:'m.room.message',origin_server_ts:1700000000000+i,content:{body:'not-persisted'}}]}));
  first.client.getRoomList=async options=>{first.api.calls.push({method:'rooms',options});if(options.next_batch==='older')throw Object.assign(Error('interrupted'),{httpStatus:400});return {rooms:dated.slice(0,3),next_batch:'older'};};
  await assert.rejects(first.W.RCSDirectory.load().promise,/HTTP 400/);first.dom.window.close();
  assert.equal(cache.local.data['rcs-directory-v2:'+owner].activityCursor,'older');
  const resumed=environment(cache,3);t.after(()=>resumed.dom.window.close());
  resumed.client.getRoomList=async options=>{resumed.api.calls.push({method:'rooms',options});assert.equal(options.next_batch,'older');return {rooms:dated.slice(3)};};
  const records=await resumed.W.RCSDirectory.load().promise;assert.equal(records.find(r=>r.id===base[0].room_id).timestamp,1700000000000);
  assert.equal(resumed.api.calls.length,1);assert.equal(cache.local.data['rcs-directory-v2:'+owner].activityComplete,true);
  assert.equal(cache.local.data['rcs-directory-v2:'+owner].activityCursor,null);
  assert.equal(JSON.stringify(cache.local.data).includes('not-persisted'),false);
});
test('early message matches reuse saved sender names and avatars before directory reconciliation or history completes',async t=>{
  const cache=broker(),entry=await seedRecoveredCache(t,cache),env=environment(cache,2);t.after(()=>env.dom.window.close());
  const send=env.W.chrome.runtime.sendMessage;env.W.chrome.runtime.sendMessage=message=>message.action==='acquire'?new Promise(()=>{}):send(message);
  const directory=env.W.RCSDirectory.load();directory.promise.catch(()=>{});await tick(80);
  const getRoom=env.client.getRoom;
  env.client.getRoom=id=>{const room=getRoom(id);return room&&{...room,getLiveTimeline:()=>({getEvents:()=>[{event:env.api.remoteMessages.get(id)[1]}]})};};
  env.client.http.authedRequest=()=>new Promise(()=>{});let partial;
  const history=env.W.RCSData.request('history',{roomId:'alex'},value=>partial=value);history.promise.catch(()=>{});await tick(80);
  assert.equal(partial.records[0].author,'Odd-Ratio-3098');
  assert.equal(partial.records[0].avatar,entry.identities['@t2_alex:reddit.com'].avatar);assert.equal(env.api.calls.length,0);
  history.cancel();directory.cancel();await tick(100);
});
