const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
const {IDBFactory,IDBKeyRange}=require('fake-indexeddb');
const source=file=>fs.readFileSync(file,'utf8');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function worker(t){
  const listeners=[],tabs=new Map(),idb=new IDBFactory();
  const context=vm.createContext({indexedDB:idb,IDBKeyRange,TextEncoder,crypto});
  const local={get:async()=>({}),set:async()=>{},remove:async()=>{},setAccessLevel(){}};
  context.chrome={runtime:{id:'test-extension',getURL:path=>'chrome-extension://test-extension/'+path,onMessage:{addListener:fn=>listeners.push(fn)}},storage:{local,session:local},tabs:{query:async()=>[...tabs.keys()].map(id=>({id})),sendMessage:async(id,message)=>tabs.get(id)?.(message)}};
  context.importScripts=(...files)=>files.forEach(file=>vm.runInContext(source('extension/'+file),context));
  vm.runInContext(source('extension/cache-broker.js'),context);
  t.after(async()=>{const db=await vm.runInContext('messages.db()',context);db?.close();});
  const send=(message,sender)=>new Promise(resolve=>{for(const listener of listeners)listener(message,sender,resolve);});
  return {tabs,send};
}
function page(t,broker,id,owner='@t2_me:reddit.com',configure=()=>{}){
  const dom=new JSDOM('<!doctype html><body></body>',{url:'https://www.reddit.com/chat/',runScripts:'outside-only',pretendToBeVisual:true});
  t.after(()=>dom.window.close());const W=dom.window;W.TextEncoder=TextEncoder;W.matchMedia=()=>({matches:true});
  W.chrome={runtime:{sendMessage:message=>broker.send(message,{id:'test-extension',url:W.location.href,tab:{id}}),onMessage:{addListener:fn=>broker.tabs.set(id,fn)}}};
  for(const file of ['demo/fixture.js','extension/directory-model.js','extension/history-store.js','extension/native-identities.js','extension/search-core.js'])W.eval(source(file));
  const api=W.ChatFixture.build(W.document.body),client=api.app.querySelector('rs-matrix-client').client;
  client.getUserId=()=>owner;configure(client,W,api);
  const handlers=new Map();client.on=(type,fn)=>{if(!handlers.has(type))handlers.set(type,new Set());handlers.get(type).add(fn);};client.off=(type,fn)=>handlers.get(type)?.delete(fn);
  const emit=event=>{for(const fn of handlers.get('event') || [])fn({event});};client.emitSync=()=>{for(const fn of handlers.get('sync') || [])fn();};
  // Register the isolated listener before native watchers start, as document_start does.
  for(const file of ['extension/data-client.js','extension/message-store.js','extension/message-cache-client.js','extension/page-bridge.js'])W.eval(source(file));
  return {W,api,client,emit};
}
const event=(id,body,extras={})=>({event_id:id,room_id:'alex',type:'m.room.message',sender:'@t2_me:reddit.com',origin_server_ts:1791432000000,content:{body},...extras});
test('native capture, worker persistence, reload and account isolation share global and room search',async t=>{
  const broker=worker(t),first=page(t,broker,1);await wait(30);
  first.emit(event('$one','saved coffee'));
  let found=await first.W.RCSMessages.search({query:'coffee'});
  assert.equal(found.total,1);assert.equal(found.records[0].author,'You');assert.equal(found.coverage.complete,false);assert.equal(first.api.calls.length,0);
  const restarted=page(t,broker,2);await wait(30);
  assert.equal((await restarted.W.RCSMessages.room('alex')).records[0].id,'$one');
  const isolated=page(t,broker,3,'@t2_other:reddit.com');await wait(30);
  assert.equal((await isolated.W.RCSMessages.search({query:'coffee'})).total,0);
  restarted.emit(event('$edit','* tea',{content:{body:'* tea','m.new_content':{body:'saved tea'},'m.relates_to':{rel_type:'m.replace',event_id:'$one'}}}));
  await restarted.W.RCSMessages.flush();
  assert.equal((await first.W.RCSMessages.search({query:'coffee'})).total,0);
  assert.equal((await first.W.RCSMessages.room('alex')).records[0].text,'saved tea');
  restarted.emit(event('$redact','',{type:'m.room.redaction',redacts:'$one'}));await restarted.W.RCSMessages.flush();
  assert.equal((await first.W.RCSMessages.search({query:'tea'})).total,0);
  assert.equal(first.api.calls.length+restarted.api.calls.length+isolated.api.calls.length,0);
});
test('real global interface searches captured messages and receives redactions without directory or history reads',async t=>{
  const broker=worker(t),env=page(t,broker,1);await wait(30);
  env.emit(event('$visible','saved coffee'));await env.W.RCSMessages.flush();
  for(const file of ['extension/adapter.js','extension/date-picker.js','extension/content.js'])env.W.eval(source(file));
  await wait(50);env.api.calls.length=0;
  const root=env.W.RCSAdapter.query('[data-rcs-ui="list"]',env.api.nav).shadowRoot;
  root.querySelector('[data-scope="all"]').click();const input=root.querySelector('input');input.value='coffee';input.dispatchEvent(new env.W.Event('input'));await wait(160);
  assert.equal(root.querySelectorAll('.result').length,1);assert.equal(root.querySelector('.name').textContent,'You');assert.equal(env.api.calls.length,0);
  assert.match(root.querySelector('.coverage').textContent,/incomplete/);
  env.emit(event('$remove','',{type:'m.room.redaction',redacts:'$visible'}));await env.W.RCSMessages.flush();await wait(160);
  assert.equal(root.querySelectorAll('.result').length,0);assert.equal(env.api.calls.length,0);
});
test('large native local import drains durably between chunks and is not repeated on reload',async t=>{
  const broker=worker(t),send=broker.send;
  broker.send=async(message,sender)=>{if(message.action==='ingest')await wait(2);return send(message,sender);};
  const env=page(t,broker,1);env.W.IDBKeyRange=IDBKeyRange;
  const factory=new IDBFactory(),db=await new Promise((resolve,reject)=>{
    const request=factory.open('reddit-chat-store',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('room_timeline',{keyPath:['room_id','scope','parent_id','seq_id']});
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });t.after(()=>db.close());
  await new Promise((resolve,reject)=>{
    const tx=db.transaction('room_timeline','readwrite'),store=tx.objectStore('room_timeline');
    for(let room=0;room<600;room++)for(let seq=0;seq<20;seq++)store.put({room_id:`!local-${room}:reddit.com`,scope:'',parent_id:'',seq_id:seq,content:event(`$${room}-${seq}`,'local cache coffee',{room_id:undefined})});
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
  });
  env.client.store={backend:{db}};
  let nativeReads=0;const transaction=db.transaction.bind(db);db.transaction=(...args)=>{nativeReads++;return transaction(...args);};
  const first=await env.W.RCSMessages.search({query:'coffee',limit:1});assert.equal(first.importing,true);
  await env.W.RCSMessages.ready();const result=await env.W.RCSMessages.search({query:'coffee',limit:1});
  assert.equal(result.total,12000);assert.equal((await env.W.RCSMessages.ready()).nativeImportComplete,true);assert.equal(result.coverage.complete,false);assert.ok(nativeReads>1);
  const priorReads=nativeReads,reloaded=page(t,broker,2);reloaded.client.store={backend:{db}};reloaded.W.IDBKeyRange=IDBKeyRange;
  assert.equal((await reloaded.W.RCSMessages.search({query:'coffee',limit:1})).total,12000);assert.equal(nativeReads,priorReads,'persisted import marker prevents a second native scan');
  assert.equal(env.api.calls.length+reloaded.api.calls.length,0);
});

test('startup native timelines exceeding both buffer limits save completely and unchanged sync does not replay',async t=>{
  const broker=worker(t),writes=[],original=broker.send;
  broker.send=async(message,sender)=>{if(message.action==='ingest'){writes.push(message);await wait(2);}return original(message,sender);};
  const env=page(t,broker,1,undefined,client=>{
    const rooms=Array.from({length:1020},(_,room)=>({roomId:`!startup-${room}:reddit.com`,events:Array.from({length:20},(_,i)=>event(`$startup-${room}-${i}`,'startup coffee',{room_id:`!startup-${room}:reddit.com`}))}));
    for(const room of rooms)room.getLiveTimeline=()=>({getEvents:()=>room.events});
    client.getRooms=()=>rooms;client.getRoom=id=>rooms.find(room=>room.roomId===id);
  });
  await wait(30);await env.W.RCSMessages.flush();
  // The producer announces durable completion, so a test cannot pass on a
  // partially drained snapshot merely because one read won a scheduling race.
  await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('startup capture did not drain')),20000);env.W.document.addEventListener('rcs-message-cache-snapshot-saved',()=>{clearTimeout(timeout);resolve();},{once:true});});
  const result=await env.W.RCSMessages.search({query:'startup',limit:1});assert.equal(result.total,20400);assert.equal(env.api.calls.length,0);
  const before=writes.length;
  // Registered sync listener belongs to the native client, not a new fetch.
  env.client.emitSync();await wait(40);await env.W.RCSMessages.flush();assert.equal(writes.length,before);
});
test('a live event burst recovers rejected captures locally and clears the latched error without a reload',async t=>{
  const broker=worker(t),env=page(t,broker,1);await wait(30);
  const events=Array.from({length:12500},(_,i)=>event('$live-'+i,'burst coffee',{room_id:'!burst:reddit.com'}));
  const native={roomId:'!burst:reddit.com',getLiveTimeline:()=>({getEvents:()=>events})},getRoom=env.client.getRoom;
  env.client.getRoom=id=>id===native.roomId?native:getRoom(id);
  const recovered=new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('burst recovery did not finish')),20000);env.W.document.addEventListener('rcs-message-cache-recovered',event=>{clearTimeout(timeout);resolve(JSON.parse(event.detail));},{once:true});});
  for(const raw of events)env.emit(raw);
  assert.equal((await recovered).complete,true);
  const result=await env.W.RCSMessages.search({query:'burst',limit:1});assert.equal(result.total,12500);assert.equal(result.captureIncomplete,false);assert.equal(env.api.calls.length,0);
});
