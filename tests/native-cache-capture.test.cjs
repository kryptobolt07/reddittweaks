const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {JSDOM}=require('jsdom');
const {IDBFactory,IDBKeyRange}=require('fake-indexeddb');
const source=file=>readFileSync(join(__dirname,'..',file),'utf8');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const message=(id,room_id='unsearched',extra={})=>({event_id:id,room_id,type:'m.room.message',seq_id:'1',sender:'@t2_alex:reddit.com',origin_server_ts:1700000000000,content:{body:`synthetic ${id}`},...extra});
function emitter(client) {
  const handlers=new Map();
  client.on=(name,handler)=>{if(!handlers.has(name))handlers.set(name,new Set());handlers.get(name).add(handler);};
  client.off=(name,handler)=>handlers.get(name)?.delete(handler);
  client.emit=(name,...args)=>{for(const handler of handlers.get(name) || [])handler(...args);};
  return handlers;
}
function setup(configure=()=>{}) {
  const dom=new JSDOM('<!doctype html><body></body>',{url:'https://www.reddit.com/chat/',runScripts:'outside-only'}),W=dom.window;
  for(const file of ['demo/fixture.js','extension/history-store.js','extension/native-identities.js'])W.eval(source(file));
  const api=W.ChatFixture.build(W.document.body),matrix=api.app.querySelector('rs-matrix-client'),client=matrix.client,handlers=emitter(client),batches=[];
  configure(client,W,api);
  W.document.addEventListener('rcs-message-cache-batch',event=>batches.push(JSON.parse(event.detail)));
  W.eval(source('extension/page-bridge.js'));W.eval(source('extension/data-client.js'));
  return {dom,W,api,matrix,client,handlers,batches};
}
test('local cache readiness and replacement announce once rather than starting a sync polling loop',async t=>{
  const env=setup();t.after(()=>env.dom.window.close());const connected=[];
  env.W.document.addEventListener('rcs-message-cache-connected',event=>connected.push(JSON.parse(event.detail)));await wait(20);
  assert.equal(connected.length,1);assert.equal(connected[0].sourceReady,false);
  const database=()=>({name:'reddit-chat-store',objectStoreNames:{contains:()=>true}});
  env.client.store={backend:{db:database()}};env.client.emit('sync');assert.equal(connected.length,2);assert.equal(connected[1].sourceReady,true);assert.equal(connected[1].attachment,connected[0].attachment);
  env.client.emit('sync');assert.equal(connected.length,2);
  env.client.store.backend.db=database();env.client.emit('sync');assert.equal(connected.length,3);assert.notEqual(connected[2].attachment,connected[1].attachment);assert.equal(env.api.calls.length,0);
});
test('startup captures loaded native timelines and threads without profile, history, or directory requests',async t=>{
  const env=setup(client=>{
    client.getRooms=()=>[{roomId:'startup',getLiveTimeline:()=>({getEvents:()=>[message('loaded','startup')]}),getThreads:()=>[{rootEvent:message('root','startup'),events:[message('reply','startup')]}]}];
  });t.after(()=>env.dom.window.close());await wait(20);
  assert.deepEqual(env.batches.flatMap(batch=>batch.events.map(event=>event.event_id)),['loaded','root','reply']);
  assert.equal(env.api.calls.length,0);assert.equal(env.batches.some(batch=>batch.coverage?.complete),false);
  env.client.emit('sync');assert.equal(env.batches.length,1,'unchanged loaded snapshots do not write again');
});
test('native events for unsearched rooms bind room IDs, deduplicate snapshots, and preserve changed/redacted content',async t=>{
  const env=setup();t.after(()=>env.dom.window.close());await wait(20);
  const raw=message('live');delete raw.room_id;
  env.client.emit('Room.timeline',{event:raw},{roomId:'unsearched'});
  env.client.emit('event',{event:{...raw,room_id:'unsearched'}});
  assert.equal(env.batches.length,1);assert.equal(env.batches[0].events[0].room_id,'unsearched');
  env.client.emit('event',{event:message('live','unsearched',{content:{body:'changed synthetic text'}})});
  env.client.emit('event',{event:message('live','unsearched',{content:{},unsigned:{redacted_because:{event_id:'removed'}}})});
  env.client.emit('event',{event:message('redaction','unsearched',{type:'m.room.redaction',redacts:'live'})});
  assert.equal(env.batches.length,4);assert.equal(env.batches[2].events[0].unsigned.redacted_because.event_id,'removed');
  assert.equal(env.batches[3].events[0].redacts,'live');assert.equal(env.api.calls.length,0);
});
test('native callbacks fail open and switching client/account detaches watchers and ignores queued old callbacks',async t=>{
  const env=setup();t.after(()=>env.dom.window.close());await wait(20);
  const oldCallback=[...env.handlers.get('event')][0],oldOwner=env.client.getUserId();
  assert.doesNotThrow(()=>env.client.emit('event',{get event(){throw new Error('new model');}}));
  const next={...env.client,getUserId:()=> '@t2_second:reddit.com'};const nextHandlers=emitter(next);env.matrix.client=next;
  await env.W.RCSData.request('identity-context').promise;
  assert.equal(env.handlers.get('event').size,0);assert.equal(nextHandlers.get('event').size,1);
  oldCallback({event:message('stale')});next.emit('event',{event:message('new')});
  assert.equal(env.batches.length,1);assert.equal(env.batches[0].owner,'@t2_second:reddit.com');assert.notEqual(env.batches[0].owner,oldOwner);
  let owner='@t2_third:reddit.com';next.getUserId=()=>owner;
  next.emit('event',{event:message('queued-during-switch')});assert.equal(env.batches.length,1);
  await env.W.RCSData.request('identity-context').promise;next.emit('event',{event:message('third')});
  assert.equal(env.batches.at(-1).owner,owner);assert.equal(nextHandlers.get('event').size,1);
});
test('already fetched history pages persist out-of-order edits/redactions, even before originals arrive',async t=>{
  const env=setup();t.after(()=>env.dom.window.close());
  const originals=env.api.remoteMessages.get('alex');
  originals.push(message('edit','alex',{seq_id:'7',content:{body:'* synthetic edited','m.relates_to':{rel_type:'m.replace',event_id:originals[1].event_id},'m.new_content':{body:'synthetic corrected'}}}));
  originals.push(message('remove','alex',{seq_id:'8',type:'m.room.redaction',redacts:originals[2].event_id}));
  const records=await env.W.RCSData.request('history',{roomId:'alex'}).promise;
  const pages=env.batches.filter(batch=>batch.source==='history-page');
  assert.equal(pages[0].events.some(event=>event.event_id==='edit'),true);
  assert.equal(pages[0].events.some(event=>event.event_id==='remove'),true);
  assert.equal(pages.at(-1).events.some(event=>event.event_id===originals[0].event_id),true);
  assert.equal(records.find(record=>record.id===originals[1].event_id).text,'synthetic corrected');
  assert.equal(env.batches.at(-1).coverage.complete,true);
});
test('directory capture uses returned bodies without changing native request parameters or exposing bodies in directory records',async t=>{
  const env=setup();t.after(()=>env.dom.window.close());const read=env.client.getRoomList;
  env.client.getRoomList=async options=>{const data=await read(options);data.rooms[0].chunk=[message('bulk',data.rooms[0].room_id)];return data;};
  const records=await env.W.RCSData.request('conversations').promise;
  assert.equal(env.batches.some(batch=>batch.events.some(event=>event.event_id==='bulk')),true);
  assert.equal(JSON.stringify(records).includes('synthetic bulk'),false);
  assert.equal(env.api.calls.length,1);assert.equal(env.api.calls[0].options.include.timeline,true);
});
async function nativeDb(W,count=451,{keyPath=['room_id','scope','parent_id','seq_id'],malformed=false}={}) {
  W.IDBKeyRange=IDBKeyRange;const factory=new IDBFactory();
  const db=await new Promise((resolve,reject)=>{const request=factory.open('reddit-chat-store',1);request.onupgradeneeded=()=>request.result.createObjectStore('room_timeline',{keyPath});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  await new Promise((resolve,reject)=>{const tx=db.transaction('room_timeline','readwrite');const store=tx.objectStore('room_timeline');for(let i=0;i<count;i++)store.put({room_id:'local-only',scope:'',parent_id:'',seq_id:i,content:malformed && i===1 ? null : message(`local-${i}`,undefined,{room_id:undefined})});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
  return db;
}
test('local native IndexedDB import reads bounded readonly transactions and never calls degradable/network loaders',async t=>{
  const env=setup();t.after(()=>env.dom.window.close());const db=await nativeDb(env.W);t.after(()=>db.close());
  const modes=[],transaction=db.transaction.bind(db);db.transaction=(names,mode,...args)=>{modes.push(mode);return transaction(names,mode,...args);};
  env.client.store={backend:{db},getTimelineEvents:()=>assert.fail('degradable wrapper called')};
  env.client.http.authedRequest=()=>assert.fail('network called');env.client.getRoomList=()=>assert.fail('directory called');
  const progress=[],result=await env.W.RCSData.request('cache-native-history',{},value=>progress.push(value.loaded)).promise;
  assert.equal(result.available,true);assert.equal(result.imported,451);assert.deepEqual(progress,[200,400,451]);
  assert.deepEqual(modes,['readonly','readonly','readonly']);assert.equal(env.batches.flatMap(batch=>batch.events).length,451);
  assert.equal(env.batches.every(batch=>batch.events.every(event=>event.room_id==='local-only')),true);
  assert.equal(env.batches.some(batch=>batch.coverage),false);assert.equal(env.api.calls.length,0);
});
test('unsupported or malformed native cache remains retryable and never marks coverage complete',async t=>{
  const env=setup();t.after(()=>env.dom.window.close());
  assert.equal((await env.W.RCSData.request('cache-native-history').promise).available,false);
  const db=await nativeDb(env.W,2,{malformed:true});t.after(()=>db.close());env.client.store={backend:{db}};
  const result=await env.W.RCSData.request('cache-native-history').promise;assert.equal(result.available,false);assert.equal(result.imported,1);
  assert.equal(env.batches.some(batch=>batch.coverage?.complete),false);
});
test('local cache import stops between chunks when its account changes',async t=>{
  const env=setup();t.after(()=>env.dom.window.close());const db=await nativeDb(env.W);t.after(()=>db.close());env.client.store={backend:{db}};
  await assert.rejects(env.W.RCSData.request('cache-native-history',{},()=>{env.client.getUserId=()=> '@t2_switched:reddit.com';}).promise,/account changed/);
  assert.equal(env.batches.flatMap(batch=>batch.events).length,200);
  assert.equal(env.batches.every(batch=>batch.owner==='@t2_me:reddit.com'),true);
});
test('native root updates invalidate saved date/full completeness once while unchanged heartbeat snapshots stay deduplicated',async t=>{
  const env=setup();t.after(()=>env.dom.window.close());await wait(20);
  const root=message('dirty-root','unsearched',{unsigned:{'m.relations':{'m.thread':{count:2}}}});
  env.client.emit('event',{event:root});env.client.emit('event',{event:root});
  assert.equal(env.batches.length,1);assert.equal(env.batches[0].coverage.complete,false);assert.equal(env.batches[0].coverage.dateComplete,false);
});
test('date-limited individual history captures verified date coverage without claiming full history',async t=>{
  const env=setup();t.after(()=>env.dom.window.close());
  env.client.http.authedRequest=async()=>({events:[message('recent','alex',{seq_id:'100',origin_server_ts:new Date('2025-03-01').getTime()}),message('older','alex',{seq_id:'99',origin_server_ts:new Date('2025-01-01').getTime()})]});
  await env.W.RCSData.request('history',{roomId:'alex',dates:{from:'2025-02-01'}}).promise;
  const coverage=env.batches.at(-1).coverage;assert.equal(coverage.complete,false);assert.equal(coverage.dateComplete,true);assert.equal(coverage.dates.from,'2025-02-01');
});
test('local import cancellation stops continuation cursors and schema mismatches remain unavailable',async t=>{
  const env=setup();t.after(()=>env.dom.window.close());const db=await nativeDb(env.W);t.after(()=>db.close());env.client.store={backend:{db}};
  const task=env.W.RCSData.request('cache-native-history',{},()=>task.cancel());
  await assert.rejects(task.promise,/cancelled/);await wait(10);
  assert.equal(env.batches.flatMap(batch=>batch.events).length,200);
  const wrong=await nativeDb(env.W,1,{keyPath:'room_id'});t.after(()=>wrong.close());env.client.store={backend:{db:wrong}};
  const result=await env.W.RCSData.request('cache-native-history').promise;assert.equal(result.available,false);assert.equal(result.imported,0);
});
test('account-scoped cache reset permits recapture without initiating native or network reads',async t=>{
  const env=setup();t.after(()=>env.dom.window.close());await wait(20);
  const event={event:message('reset-message')};env.client.emit('event',event);assert.equal(env.batches.length,1);
  env.W.document.dispatchEvent(new env.W.CustomEvent('rcs-message-cache-reset',{detail:JSON.stringify({owner:'@t2_wrong:reddit.com'})}));
  env.client.emit('event',event);assert.equal(env.batches.length,1,'another account cannot reset deduplication');
  env.W.document.dispatchEvent(new env.W.CustomEvent('rcs-message-cache-reset',{detail:JSON.stringify({owner:env.client.getUserId()})}));
  await wait(10);assert.equal(env.batches.length,1,'reset does not initiate a capture or import');assert.equal(env.api.calls.length,0);
  env.client.emit('event',event);assert.equal(env.batches.length,2);assert.equal(env.batches[1].events[0].event_id,'reset-message');
});
function cacheAck(env,request,ok=true) {
  env.W.document.dispatchEvent(new env.W.CustomEvent('rcs-message-cache-flushed',{detail:JSON.stringify({...request,ok})}));
}
test('durable local import waits for matching storage acknowledgements before reading the next chunk',async t=>{
  const env=setup();t.after(()=>env.dom.window.close());const db=await nativeDb(env.W);t.after(()=>db.close());env.client.store={backend:{db}};
  let first;const reachedFirst=new Promise(resolve=>first=resolve),flushes=[];
  env.W.document.addEventListener('rcs-message-cache-flush',event=>{
    const request=JSON.parse(event.detail);flushes.push(request);
    if(flushes.length===1)first(request);else cacheAck(env,request);
  });
  const task=env.W.RCSData.request('cache-native-history',{owner:env.client.getUserId(),awaitCache:true});
  const request=await reachedFirst;await wait(15);assert.equal(env.batches.flatMap(batch=>batch.events).length,200);
  cacheAck(env,{...request,owner:'@t2_wrong:reddit.com'});cacheAck(env,{...request,id:'wrong-id'});
  await wait(15);assert.equal(flushes.length,1,'wrong-account or unrelated acknowledgements cannot release backpressure');
  cacheAck(env,request);const result=await task.promise;
  assert.equal(result.available,true);assert.equal(result.imported,451);assert.equal(flushes.length,3);assert.equal(env.api.calls.length,0);
});
test('failed storage acknowledgement stops local import and leaves completion retryable',async t=>{
  const env=setup();t.after(()=>env.dom.window.close());const db=await nativeDb(env.W);t.after(()=>db.close());env.client.store={backend:{db}};
  env.W.document.addEventListener('rcs-message-cache-flush',event=>cacheAck(env,JSON.parse(event.detail),false));
  await assert.rejects(env.W.RCSData.request('cache-native-history',{awaitCache:true}).promise,/could not be written/);
  assert.equal(env.batches.flatMap(batch=>batch.events).length,200);
});
test('cancelling an import awaiting storage removes its acknowledgement listener and never reads another chunk',async t=>{
  const env=setup();t.after(()=>env.dom.window.close());const db=await nativeDb(env.W);t.after(()=>db.close());env.client.store={backend:{db}};
  const document=env.W.document,remove=document.removeEventListener.bind(document);let removed=0,release;
  document.removeEventListener=(name,...args)=>{if(name==='rcs-message-cache-flushed')removed++;return remove(name,...args);};
  const barrier=new Promise(resolve=>release=resolve);document.addEventListener('rcs-message-cache-flush',event=>release(JSON.parse(event.detail)));
  const task=env.W.RCSData.request('cache-native-history',{awaitCache:true});const request=await barrier;
  task.cancel();await assert.rejects(task.promise,/cancelled/);await wait(80);
  assert.equal(removed,1);cacheAck(env,request);await wait(10);assert.equal(env.batches.flatMap(batch=>batch.events).length,200);
});
test('storage acknowledgement cannot complete native import after the authenticated account changes',async t=>{
  const env=setup();t.after(()=>env.dom.window.close());const db=await nativeDb(env.W);t.after(()=>db.close());env.client.store={backend:{db}};
  env.W.document.addEventListener('rcs-message-cache-flush',event=>{env.client.getUserId=()=> '@t2_changed:reddit.com';cacheAck(env,JSON.parse(event.detail));});
  await assert.rejects(env.W.RCSData.request('cache-native-history',{awaitCache:true}).promise,/account changed/);
  assert.equal(env.batches.flatMap(batch=>batch.events).length,200);
});
test('a late cache consumer receives loaded timelines once without a flush timeout or server reads',async t=>{
  const env=setup(client=>{client.getRooms=()=>[{roomId:'late',getLiveTimeline:()=>({getEvents:()=>[message('already-loaded','late')]})}];});t.after(()=>env.dom.window.close());
  await wait(30);assert.ok(env.batches.some(batch=>batch.events.some(event=>event.event_id==='already-loaded')));
  const captured=[];env.W.document.addEventListener('rcs-message-cache-batch',event=>captured.push(JSON.parse(event.detail)));
  env.W.document.addEventListener('rcs-message-cache-flush',event=>{const value=JSON.parse(event.detail);env.W.document.dispatchEvent(new env.W.CustomEvent('rcs-message-cache-flushed',{detail:JSON.stringify({...value,ok:true})}));});
  env.W.document.dispatchEvent(new env.W.CustomEvent('rcs-message-cache-listening'));
  await wait(30);assert.equal(captured.flatMap(batch=>batch.events).filter(event=>event.event_id==='already-loaded').length,1);
  const count=captured.length;env.W.document.dispatchEvent(new env.W.CustomEvent('rcs-message-cache-listening'));env.client.emit('sync');await wait(30);
  assert.equal(captured.length,count,'further listening and unchanged sync signals do not replay snapshots');assert.equal(env.api.calls.length,0);
});
