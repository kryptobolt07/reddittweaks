const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
const {IDBFactory,IDBKeyRange}=require('fake-indexeddb');
const source=file=>fs.readFileSync(file,'utf8');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function worker(t,idb=new IDBFactory()){
  const listeners=[],tabs=new Map();
  const context=vm.createContext({indexedDB:idb,IDBKeyRange,TextEncoder,crypto,URL});
  const local={get:async()=>({}),set:async()=>{},remove:async()=>{},setAccessLevel(){}};
  context.chrome={runtime:{id:'test-extension',getURL:path=>'chrome-extension://test-extension/'+path,onMessage:{addListener:fn=>listeners.push(fn)}},storage:{local,session:local},tabs:{query:async()=>[...tabs.keys()].map(id=>({id})),sendMessage:async(id,message)=>tabs.get(id)?.(message)}};
  context.importScripts=(...files)=>files.forEach(file=>vm.runInContext(source('extension/'+file),context));
  vm.runInContext(source('extension/cache-broker.js'),context);
  t.after(async()=>{const db=await vm.runInContext('messages.db()',context);db?.close();});
  const send=(message,sender)=>new Promise(resolve=>{for(const listener of listeners)listener(message,sender,resolve);});
  return {tabs,send,store:vm.runInContext('messages',context)};
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
  await first.W.RCSMessages.flush();
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
test('worker committed reads bypass paused mutations while captures and clear remain ordered',async t=>{
  const broker=worker(t),owner='@t2_me:reddit.com',sender={id:'test-extension',url:'https://www.reddit.com/chat/',tab:{id:1}},send=(action,extra={},from=sender)=>broker.send({scope:'rcs-messages',owner,action,...extra},from);
  await send('ingest',{roomId:'alex',events:[event('$saved','already committed')]});
  let release;const gate=new Promise(resolve=>release=resolve),write=broker.store.write.bind(broker.store),order=[];
  broker.store.write=async value=>{await gate;order.push(value.events[0].event_id);return write(value);};
  const one=send('ingest',{roomId:'alex',events:[event('$one','queued first')]}),two=send('ingest',{roomId:'alex',events:[event('$two','queued second')]}),clearing=send('clear',{}, {id:'test-extension',url:'chrome-extension://test-extension/popup.html'});let timeout;
  try {
    const reads=await Promise.race([Promise.all([send('search',{query:'committed'}),send('room',{roomId:'alex'}),send('stats')]),new Promise((_,reject)=>timeout=setTimeout(()=>reject(Error('worker reads joined the mutation queue')),1000))]);
    assert.ok(reads.every(value=>value.ok));assert.equal(reads[0].total,1);assert.equal(reads[1].records.length,1);assert.equal(reads[2].stats.messages,1);assert.equal(order.length,0);
  }finally{clearTimeout(timeout);release();await Promise.all([one,two,clearing]);}
  assert.deepEqual(order,['$one','$two']);assert.equal((await send('search')).total,0);
});
test('real global interface searches captured messages and receives redactions without directory or history reads',async t=>{
  const broker=worker(t),env=page(t,broker,1);await wait(30);
  env.emit(event('$visible','saved coffee'));await env.W.RCSMessages.flush();
  for(const file of ['extension/adapter.js','extension/date-picker.js','extension/content.js'])env.W.eval(source(file));
  await wait(50);env.api.calls.length=0;
  const root=env.W.RCSAdapter.query('[data-rcs-ui="list"]',env.api.nav).shadowRoot;
  root.querySelector('[data-scope="all"]').click();const input=root.querySelector('input');input.value='coffee';input.dispatchEvent(new env.W.Event('input'));await wait(160);
  assert.equal(root.querySelectorAll('.result').length,1);assert.equal(root.querySelector('.name').textContent,'You');assert.equal(env.api.calls.length,0);
  assert.equal(root.querySelector('.coverage'),null);
  env.emit(event('$remove','',{type:'m.room.redaction',redacts:'$visible'}));await env.W.RCSMessages.flush();await wait(160);
  assert.equal(root.querySelectorAll('.result').length,0);assert.equal(env.api.calls.length,0);
});
test('large native cache reconciles in durable chunks and is read again without duplicate rewrites on reload',async t=>{
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
  env.client.emitSync();
  let nativeReads=0;const transaction=db.transaction.bind(db);db.transaction=(...args)=>{nativeReads++;return transaction(...args);};
  const first=await env.W.RCSMessages.search({query:'coffee',limit:1});assert.equal(first.importing,true);
  await env.W.RCSMessages.ready();const result=await env.W.RCSMessages.search({query:'coffee',limit:1});
  assert.equal(result.total,12000);assert.equal((await env.W.RCSMessages.ready()).nativeImportComplete,true);assert.equal(result.coverage.complete,false);assert.ok(nativeReads>1);
  const priorReads=nativeReads,reloaded=page(t,broker,2,undefined,(client,W)=>{client.store={backend:{db}};W.IDBKeyRange=IDBKeyRange;});
  assert.equal((await reloaded.W.RCSMessages.search({query:'coffee',limit:1})).total,12000);await reloaded.W.RCSMessages.ready();assert.ok(nativeReads>priorReads,'a new attachment checks local cached changes despite the old completion marker');
  assert.equal(env.api.calls.length+reloaded.api.calls.length,0);
});
test('restart after a disabled interval automatically catches up native cached messages, edits and redactions',async t=>{
  const factory=new IDBFactory(),db=await new Promise((resolve,reject)=>{const open=factory.open('reddit-chat-store',1);open.onupgradeneeded=()=>open.result.createObjectStore('room_timeline',{keyPath:['room_id','scope','parent_id','seq_id']});open.onsuccess=()=>resolve(open.result);open.onerror=()=>reject(open.error);});t.after(()=>db.close());
  const nativeRoom='!local-history:reddit.com';
  const write=values=>new Promise((resolve,reject)=>{const tx=db.transaction('room_timeline','readwrite'),store=tx.objectStore('room_timeline');for(const [seq,content]of values)store.put({room_id:nativeRoom,scope:'',parent_id:'',seq_id:seq,content:{...content,room_id:nativeRoom}});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
  await write([[1,event('$base','old coffee')],[2,event('$gone','private deleted text')],[3,event('$kept','older text retained by extension')]]);
  const extensionDB=new IDBFactory(),firstWorker=worker(t,extensionDB),configure=(client,W)=>{client.store={backend:{db}};client.getRooms=()=>[];W.IDBKeyRange=IDBKeyRange;};
  const first=page(t,firstWorker,1,undefined,configure);await wait(30);await first.W.RCSMessages.ready();
  assert.equal((await first.W.RCSMessages.stats()).stats.messages,3);assert.ok((await first.W.RCSMessages.stats()).nativeReconciledAt>0);assert.equal(first.api.calls.length,0);
  first.W.close();firstWorker.tabs.delete(1);
  // Reddit continues saving while the extension has no document or listeners.
  await write([[2,event('$gone','', {content:{},unsigned:{redacted_because:{event_id:'$red'}}})],[4,event('$edit','* updated tea',{origin_server_ts:1791433000000,content:{body:'* updated tea','m.new_content':{body:'updated tea'},'m.relates_to':{rel_type:'m.replace',event_id:'$base'}}})],[5,event('$missed','message received while disabled')]]);
  await new Promise(resolve=>{const tx=db.transaction('room_timeline','readwrite');tx.objectStore('room_timeline').delete([nativeRoom,'','',3]);tx.oncomplete=resolve;});
  const nextWorker=worker(t,extensionDB),next=page(t,nextWorker,2,undefined,configure);
  // Startup capture must reconcile even before the user opens a search.
  let caughtUp=false;
  for(let attempt=0;attempt<100;attempt++){const result=await nextWorker.send({scope:'rcs-messages',action:'search',query:'disabled',owner:'@t2_me:reddit.com'},{id:'test-extension',url:'https://www.reddit.com/chat/',tab:{id:2}});if(result.total===1){caughtUp=true;break;}await wait(10);}
  assert.equal(caughtUp,true,'the page attaches and reconciles before any document search or ready call');
  await next.W.RCSMessages.ready();const all=await next.W.RCSMessages.search({});
  assert.equal(all.total,3);assert.equal((await next.W.RCSMessages.search({query:'updated tea'})).total,1);assert.equal((await next.W.RCSMessages.search({query:'private deleted text'})).total,0);assert.equal((await next.W.RCSMessages.search({query:'disabled'})).total,1);assert.equal((await next.W.RCSMessages.search({query:'older text'})).total,1,'native cache eviction does not imply deletion');
  assert.equal(all.coverage.complete,false);assert.equal(next.api.calls.length,0);assert.equal((await next.W.RCSMessages.room(nativeRoom)).records.length,3);
});
test('individual history completion waits for saved writes and a storage failure remains retryable',async t=>{
  const broker=worker(t),send=broker.send;let fail=true;
  broker.send=(message,sender)=>message.action==='ingest' && fail?Promise.resolve({ok:false,error:'Synthetic storage failure'}):send(message,sender);
  const env=page(t,broker,1);await wait(30);
  await assert.rejects(env.W.RCSData.request('history',{roomId:'alex'}).promise,/Saved messages could not be written/);
  fail=false;await env.W.RCSData.request('history',{roomId:'alex'}).promise;
  assert.ok((await env.W.RCSMessages.room('alex')).records.length>0);
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

test('native media MIME survives the bridge into persistent GIF search, edits and redactions',async t=>{
  const broker=worker(t),env=page(t,broker,11),batches=[];env.W.document.addEventListener('rcs-message-cache-batch',value=>batches.push(JSON.parse(value.detail)));await wait(30);
  env.emit(event('$native-gif','animation',{content:{body:'animation',msgtype:'m.image',info:{mimetype:'image/gif',thumbnail_url:'https://example.invalid/private-thumbnail',w:1000,h:2000,thumbnail_info:{w:1000,h:2000}}}}));await env.W.RCSMessages.flush();
  let found=await env.W.RCSMessages.search({query:'has:gif'});assert.equal(found.total,1);assert.equal(found.records[0].attachmentMime,'image/gif');assert.ok(found.availableMediaTypes.includes('gif'));
  const raw=batches.flatMap(batch=>batch.events).find(record=>record.event_id==='$native-gif');assert.deepEqual(Object.keys(raw.content.info),['mimetype','w','h']);assert.equal(raw.content.rcs_preview_url,'https://example.invalid/private-thumbnail');
  env.emit(event('$native-gif-edit','* still image',{content:{body:'* still image','m.relates_to':{rel_type:'m.replace',event_id:'$native-gif'},'m.new_content':{body:'still image',msgtype:'m.image',info:{mimetype:'image/png'}}}}));await env.W.RCSMessages.flush();assert.equal((await env.W.RCSMessages.search({query:'has:gif'})).total,0);assert.equal((await env.W.RCSMessages.search({query:'has:image'})).total,1);
  env.emit(event('$native-image-redact','',{type:'m.room.redaction',redacts:'$native-gif'}));await env.W.RCSMessages.flush();found=await env.W.RCSMessages.search({query:'has:image'});assert.equal(found.total,0);assert.equal(found.availableMediaTypes.includes('gif'),false);assert.equal(env.api.calls.length,0);
});

test('native image capture reuses the client media URL conversion without profile or history requests',async t=>{
  const broker=worker(t),converted=[],env=page(t,broker,12,'@t2_me:reddit.com',client=>{client.mxcUrlToHttp=(...args)=>{converted.push(args);return 'https://matrix.redditspace.com/_matrix/media/v3/thumbnail/reddit.com/image?width=384&height=256';};});await wait(30);
  env.emit(event('$photo','photo.jpeg',{content:{body:'photo.jpeg',msgtype:'m.image',url:'mxc://reddit.com/original',info:{mimetype:'image/jpeg',thumbnail_url:'mxc://reddit.com/image'}}}));await env.W.RCSMessages.flush();
  const result=await env.W.RCSMessages.search({query:'has:image'});assert.equal(result.total,1);assert.match(result.records[0].attachmentPreview,/thumbnail/);assert.ok(converted.length);assert.ok(converted.every(args=>JSON.stringify(args)===JSON.stringify(['mxc://reddit.com/original',384,256,'scale'])));assert.equal(env.api.calls.length,0);
});

test('decoded layout hints batch across images, survive reload, and do not announce message changes',async t=>{
  const broker=worker(t),env=page(t,broker,21);await env.W.RCSMessages.ready();
  for(const id of ['$one-image','$two-image'])env.emit(event(id,'image.jpeg',{content:{body:'image.jpeg',msgtype:'m.image',url:'https://example.invalid/'+id}}));await env.W.RCSMessages.flush();
  const updates=[];env.W.RCSMessages.subscribe(value=>updates.push(value));const calls=[],send=broker.send;broker.send=(message,sender)=>{calls.push(message);return send(message,sender);};
  const save=id=>env.W.RCSMessages.rememberImageDimensions({owner:'@t2_me:reddit.com',roomId:'alex',eventId:id,preview:'https://example.invalid/'+id,width:400,height:800});
  await Promise.all([save('$one-image'),save('$two-image')]);assert.equal(calls.filter(call=>call.action==='image-dimensions').length,1);assert.equal(updates.length,0,'layout hints do not restart saved-message queries');
  const reloaded=page(t,broker,22);const result=await reloaded.W.RCSMessages.search({query:'has:image'});assert.equal(result.records.length,2);assert.ok(result.records.every(record=>record.attachmentWidth===400 && record.attachmentHeight===800));
  assert.equal(env.api.calls.length+reloaded.api.calls.length,0);
  const other=page(t,broker,23,'@t2_other:reddit.com');await other.W.RCSMessages.ready();assert.equal((await other.W.RCSMessages.rememberImageDimensions({owner:'@t2_me:reddit.com',roomId:'alex',eventId:'$one-image',preview:'https://example.invalid/$one-image',width:50,height:50})).changed,false);
});

test('native preview conversion falls back safely when the original reference cannot be converted',async t=>{
  const converted=[],broker=worker(t),env=page(t,broker,14,'@t2_me:reddit.com',client=>{client.mxcUrlToHttp=(...args)=>{converted.push(args);if(args[0].endsWith('/unavailable'))throw Error('Unavailable original');return 'https://example.invalid/safe-preview';};});await wait(30);
  env.emit(event('$fallback-photo','fallback.jpeg',{content:{body:'fallback.jpeg',msgtype:'m.image',url:'mxc://reddit.com/unavailable',info:{thumbnail_url:'mxc://reddit.com/thumbnail'}}}));await env.W.RCSMessages.flush();
  const result=await env.W.RCSMessages.search({query:'fallback.jpeg'});assert.equal(result.records[0].attachmentPreview,'https://example.invalid/safe-preview');
  assert.ok(converted.some(args=>args[0]==='mxc://reddit.com/unavailable'));assert.ok(converted.some(args=>args[0]==='mxc://reddit.com/thumbnail'));
  assert.ok(converted.every(args=>args[1]===384 && args[2]===256 && args[3]==='scale'));assert.equal(env.api.calls.length,0);
});


test('native IndexedDB catch-up preserves previews through both compact capture passes without server calls',async t=>{
  const factory=new IDBFactory(),db=await new Promise((resolve,reject)=>{const open=factory.open('reddit-chat-store',1);open.onupgradeneeded=()=>open.result.createObjectStore('room_timeline',{keyPath:['room_id','scope','parent_id','seq_id']});open.onsuccess=()=>resolve(open.result);open.onerror=()=>reject(open.error);});t.after(()=>db.close());
  await new Promise((resolve,reject)=>{const tx=db.transaction('room_timeline','readwrite');tx.objectStore('room_timeline').put({room_id:'!local-image:reddit.com',scope:'',parent_id:'',seq_id:1,content:event('$local-photo','local.jpeg',{room_id:undefined,content:{body:'local.jpeg',msgtype:'m.image',url:'mxc://reddit.com/local-image',info:{mimetype:'image/jpeg',w:1200,h:1600}}})});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
  const broker=worker(t),env=page(t,broker,13,undefined,(client,W)=>{W.IDBKeyRange=IDBKeyRange;client.store={backend:{db}};client.getRooms=()=>[];client.mxcUrlToHttp=()=> 'https://example.invalid/local-thumb.jpg';});await env.W.RCSMessages.ready();
  const result=await env.W.RCSMessages.search({query:'has:image'});assert.equal(result.total,1);assert.equal(result.records[0].attachmentPreview,'https://example.invalid/local-thumb.jpg');assert.equal(result.records[0].attachmentWidth,1200);assert.equal(result.records[0].attachmentHeight,1600);assert.equal(env.api.calls.length,0);
});
