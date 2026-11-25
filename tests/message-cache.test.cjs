const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {indexedDB,IDBKeyRange}=require('fake-indexeddb');
const {JSDOM}=require('jsdom');
function model(){const ctx=vm.createContext({indexedDB,IDBKeyRange,TextEncoder,console});for(const file of ['search-core.js','message-store.js'])vm.runInContext(fs.readFileSync(`extension/${file}`,'utf8'),ctx);return ctx.RCSMessageStore;}
const owner='@alice:reddit.com',other='@bob:reddit.com',roomId='!room:reddit.com';
const event=(id,body,time=1000,extras={})=>({event_id:id,room_id:roomId,type:'m.room.message',sender:owner,origin_server_ts:time,content:{body},...extras});
const batch=(events,extra={})=>({owner,roomId,events,...extra});
test('temporary Reddit local echoes are not persisted as searchable messages',async()=>{
  const {Store}=model(),store=new Store({name:crypto.randomUUID()});
  await store.ingest(batch([event('~!room:reddit.com:m123','pending text'),event('$sent','confirmed text')]));
  assert.equal((await store.search(owner)).total,1);assert.equal((await store.room(owner,roomId)).records[0].id,'$sent');
  assert.equal((await store.snapshot(owner)).rows[0].events.some(e=>e.id.startsWith('~')),false);(await store.db()).close();
});
test('legacy temporary entries are hidden from global, room, summary and count reads without clearing saved data',async()=>{
  const {Store}=model(),store=new Store({name:crypto.randomUUID()});
  await store.ingest(batch([event('$sent','confirmed text',1000)]));
  const db=await store.db();
  // Inject a legacy temporary ~ record directly into msgs to verify read-side hiding.
  await new Promise((resolve,reject)=>{const tx=db.transaction('msgs','readwrite');tx.objectStore('msgs').put({a:1,n:1,e:'~!room:reddit.com:m123',p:'',t:2000,u:owner,b:'pending text',f:0});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
  store.projections.delete(owner);
  assert.equal((await store.search(owner,{query:'pending'})).total,0);assert.equal((await store.search(owner)).total,1);assert.equal((await store.room(owner,roomId)).records.length,1);
  assert.equal((await store.summaries(owner)).summaries[0].id,'$sent');assert.equal((await store.stats(owner)).stats.messages,1);
  const raw=await new Promise(resolve=>{const req=db.transaction('msgs').objectStore('msgs').getAll();req.onsuccess=()=>resolve(req.result);});assert.equal(raw.length,2);db.close();
});
test('closed extension database handles reopen for reads and queued writes without losing accounts or import state',async()=>{
  const {Store}=model(),store=new Store({name:crypto.randomUUID()});
  await store.ingest(batch([event('$saved','saved body')]));await store.ingest({owner:other,roomId,events:[event('$other','other body')]});await store.importState(owner,true);
  (await store.db()).close();
  const results=await Promise.all([store.search(owner),store.search(other)]);assert.deepEqual(results.map(r=>r.total),[1,1]);assert.equal(await store.importState(owner),true);
  (await store.db()).close();await store.ingest(batch([event('$new','new body')]));assert.equal((await store.stats(owner)).stats.messages,2);
  (await store.db()).close();assert.equal((await store.stats()).accounts,2);
  (await store.db()).close();await store.clear(owner);assert.equal((await store.search(other)).total,1);assert.equal((await store.search(owner)).total,0);(await store.db()).close();
});
test('abnormal extension connection closure discards the cached handle',async()=>{
  const {forceCloseDatabase}=require('fake-indexeddb'),{Store}=model(),store=new Store({name:crypto.randomUUID()});await store.ingest(batch([event('$saved','saved body')]));
  const old=await store.db();forceCloseDatabase(old);await new Promise(resolve=>setImmediate(resolve));
  assert.notEqual(await store.db(),old);assert.equal((await store.search(owner)).total,1);(await store.db()).close();
});
test('extension database yields its connection to a version change',async()=>{
  const {IDBVersionChangeEvent}=require('fake-indexeddb'),{Store}=model(),store=new Store({name:crypto.randomUUID()});await store.ingest(batch([event('$saved','saved body')]));
  const old=await store.db();old.dispatchEvent(new IDBVersionChangeEvent('versionchange',{oldVersion:1,newVersion:2}));
  assert.throws(()=>old.transaction('rooms'),{name:'InvalidStateError'});assert.notEqual(await store.db(),old);assert.equal((await store.search(owner)).total,1);(await store.db()).close();
});
test('IndexedDB persists on restart, scopes accounts, deduplicates and keeps body references',async()=>{
  const {Store}=model(),name=crypto.randomUUID(),store=new Store({name});
  await store.ingest(batch([event('$one','Café FIRST')]));await store.ingest(batch([event('$one','ignored duplicate')]));
  await store.ingest({owner:other,roomId,events:[event('$two','other account')]});
  const restarted=new Store({name}),found=await restarted.search(owner,{query:'café first'});
  assert.equal(found.total,1);assert.equal(found.records[0].text,'Café FIRST');assert.equal(found.records[0].author,'You');
  assert.equal((await restarted.search(other)).total,1);assert.equal((await restarted.stats(owner)).stats.messages,1);
  const row=(await restarted.snapshot(owner)).rows[0];assert.equal(row.records[0].bodyEvent,'$one');assert.equal(row.records[0].text,undefined);
});
test('edits arriving before originals, latest replacement, forged edits, and redacted edit fallback',async()=>{
  const {Store}=model(),store=new Store({name:crypto.randomUUID()});
  const edit=(id,body,time,sender=owner)=>event(id,'* '+body,time,{sender,content:{body:'* '+body,'m.new_content':{body},'m.relates_to':{rel_type:'m.replace',event_id:'$base'}}});
  await store.ingest(batch([edit('$old','old edit',2000),edit('$new','new edit',3000)]));
  await store.ingest(batch([event('$base','base',1000),edit('$forged','forged',4000,other)]));
  assert.equal((await store.search(owner)).records[0].text,'new edit');
  await store.ingest(batch([event('$redact','',5000,{type:'m.room.redaction',redacts:'$new'})]));
  assert.equal((await store.search(owner)).records[0].text,'old edit');
  await store.ingest(batch([event('$remove','',6000,{type:'m.room.redaction',content:{redacts:'$base'}})]));
  assert.equal((await store.search(owner)).total,0);
});
test('redaction before original and unsigned tombstones survive restart and duplicate arrivals',async()=>{
  const {Store}=model(),name=crypto.randomUUID(),store=new Store({name});
  await store.ingest(batch([event('$red','',10,{type:'m.room.redaction',redacts:'$later'})]));
  await store.ingest(batch([event('$later','secret'),event('$gone','secret',1000,{unsigned:{redacted_because:{event_id:'$red'}}})]));
  const next=new Store({name});await next.ingest(batch([event('$gone','secret')]));assert.equal((await next.search(owner)).total,0);
});
test('inclusive dates, room filtering, deterministic newest-first pages, coverage and clear',async()=>{
  const {Store}=model(),store=new Store({name:crypto.randomUUID()});
  const first=new Date(2026,0,1,0).getTime(),last=new Date(2026,0,1,23,59,59).getTime();
  await store.ingest(batch([event('$a','HELLO full width ＷＯＲＤ',first),event('$b','hello word',last),event('$c','outside',new Date(2026,0,2).getTime())],{coverage:{complete:true}}));
  await store.ingest(batch([event('$d','hello word',last,{room_id:'!other:reddit.com'})],{roomId:'!other:reddit.com'}));
  const found=await store.search(owner,{query:'hello word',roomId,dates:{from:'2026-01-01',to:'2026-01-01'},limit:1});
  assert.equal(found.total,2);assert.equal(found.records[0].id,'$b');assert.equal(found.hasMore,true);
  assert.equal((await store.search(owner,{query:'hello word',roomId,limit:1,offset:1})).records[0].id,'$a');
  assert.equal((await store.stats(owner)).stats.completeRooms,1);assert.ok(found.stats.approxBytes>0);
  await store.ingest(batch([event('$a','duplicate')]));assert.equal((await store.stats(owner)).stats.completeRooms,1);
  await store.ingest(batch([event('$unverified','new capture')]));assert.equal((await store.stats(owner)).stats.completeRooms,0);
  assert.equal((await store.search(owner,{dates:{from:'2026-02-30'}})).total,0);
  await store.importState(owner,true);assert.equal((await store.stats(owner)).nativeImportComplete,true);
  await store.clear(owner);assert.equal((await store.stats(owner)).stats.messages,0);assert.equal((await store.stats(owner)).nativeImportComplete,false);
});
test('memory fallback isolates accounts and does not claim persistence; storage failures propagate',async()=>{
  const {Store}=model(),memory=new Store({indexedDB:null});await memory.ingest(batch([event('$a','hello')]));
  assert.equal((await memory.search(owner)).persistent,false);assert.equal((await memory.search(other)).total,0);
  const broken=new Store({indexedDB:{open(){const req={};queueMicrotask(()=>{req.error=Error('quota');req.onerror();});return req;}}});
  await assert.rejects(broken.ingest(batch([event('$a','hello')])),/quota/);
});
test('local reconciliation skips unchanged room and identity writes while persisting new edits and redactions',async()=>{
  const {Store}=model(),store=new Store({name:crypto.randomUUID()}),base=batch([event('$base','original')],{identities:[{id:other,name:'Bob'}]});
  assert.equal((await store.ingest(base)).changed,true);
  const db=await store.db(),transaction=db.transaction.bind(db);let writes=0;
  db.transaction=(...args)=>{const tx=transaction(...args),objectStore=tx.objectStore.bind(tx),wrapped=new WeakSet();tx.objectStore=name=>{const store=objectStore(name);if(!wrapped.has(store)){wrapped.add(store);const put=store.put.bind(store);store.put=(...values)=>{writes++;return put(...values);};}return store;};return tx;};
  assert.equal((await store.ingest(base)).changed,false);assert.equal(writes,0,'duplicate local rows cause no durable rewrites');
  await store.ingest(batch([event('$edit','* edited',2000,{content:{body:'* edited','m.new_content':{body:'edited'},'m.relates_to':{rel_type:'m.replace',event_id:'$base'}}})]));
  assert.equal((await new Store({name:store.name}).search(owner)).records[0].text,'edited');assert.ok(writes>=1 && writes<=4,'only the changed message/relation/room/account records are written');
  await store.ingest(batch([event('$base','',1000,{unsigned:{redacted_because:{event_id:'$red'}}})]));
  assert.equal((await new Store({name:store.name}).search(owner)).total,0);
  assert.equal((await store.ingest(base)).changed,false,'a duplicate cannot undo a saved redaction');
});
test('isolated client reads committed batches for the native account and forwards cross-tab changes',async()=>{
  const dom=new JSDOM('',{runScripts:'outside-only'}),win=dom.window;win.TextEncoder=TextEncoder;
  for(const file of ['search-core.js','message-store.js'])win.eval(fs.readFileSync(`extension/${file}`,'utf8'));
  let active=owner,changed;win.RCSData={request(){return {promise:Promise.resolve({owner:active})};}};
  const store=new win.RCSMessageStore.Store({indexedDB:null});
  win.chrome={runtime:{onMessage:{addListener(fn){changed=fn;}},async sendMessage(msg){if(msg.action==='stats')return {ok:true,...await store.stats(msg.owner),nativeImportComplete:true};if(msg.action==='search')return {ok:true,...await store.search(msg.owner,msg)};if(msg.action==='ingest')return {ok:true,...await store.ingest(msg)};}}};
  win.eval(fs.readFileSync('extension/message-cache-client.js','utf8'));const updates=[];win.RCSMessages.subscribe(value=>updates.push(value));
  const emit=value=>win.document.dispatchEvent(new win.CustomEvent('rcs-message-cache-batch',{detail:JSON.stringify(value)}));
  emit(batch([event('$a','hello')]));await win.RCSMessages.flush();assert.equal((await win.RCSMessages.search({query:'hello'})).total,1);
  changed({scope:'rcs-messages-changed',owner});assert.equal(updates.at(-1).changed,true);
  active=other;emit(batch([event('$bad','must not leak')]));assert.equal((await win.RCSMessages.search({query:''})).total,0);
  assert.ok(updates.some(value=>value.accountChanged && value.owner===other));dom.window.close();
});
test('IndexedDB write failure aborts transaction and preserves preceding saved data',async()=>{
  const {Store}=model(),store=new Store({name:crypto.randomUUID()});await store.ingest(batch([event('$safe','safe')]));
  const db=await store.db(),original=db.transaction.bind(db);db.transaction=(...args)=>{const tx=original(...args),get=tx.objectStore.bind(tx);tx.objectStore=name=>{const object=get(name);if(args[1]==='readwrite' && name==='rooms')object.put=()=>{throw Error('Quota exceeded');};return object;};return tx;};
  await assert.rejects(store.ingest(batch([event('$lost','lost')])),/Quota/);db.transaction=original;
  assert.equal((await store.search(owner)).total,1);
});
test('broker validates origins, restricts clearing to popup, aggregates stats and broadcasts changes',async()=>{
  const listeners=[],connections=[],broadcast=[],ctx=vm.createContext({indexedDB,IDBKeyRange,TextEncoder,console,crypto});
  ctx.chrome={runtime:{id:'extension',getURL:path=>'chrome-extension://extension/'+path,onMessage:{addListener:fn=>listeners.push(fn)},onConnect:{addListener:fn=>connections.push(fn)}},tabs:{query:async()=>[{id:1},{id:2}],sendMessage:async(id,value)=>broadcast.push({id,value})},storage:{local:{get:async()=>({}),set:async()=>{},remove:async()=>{},setAccessLevel:()=>{}},session:{get:async()=>({}),set:async()=>{},remove:async()=>{}}}};
  ctx.importScripts=(...files)=>files.forEach(file=>vm.runInContext(fs.readFileSync(`extension/${file}`,'utf8'),ctx));
  vm.runInContext(fs.readFileSync('extension/cache-broker.js','utf8'),ctx);
  const send=(message,sender)=>new Promise(resolve=>listeners.find(listener=>listener({scope:'rcs-messages',...message},sender,resolve)));
  const tab={id:'extension',url:'https://chat.reddit.com/',tab:{id:1}},popup={id:'extension',url:'chrome-extension://extension/popup.html'};
  await send({...batch([event('$broker','hello')]),action:'ingest'},tab);
  const stream=sender=>new Promise(resolve=>{
    const received=[];let read;
    connections[0]({sender,name:'rcs-room-snapshot',onDisconnect:{addListener(){}},
      onMessage:{addListener(fn){read=fn;},removeListener(){}},
      postMessage(packet){received.push(packet);if(!packet.records)resolve(received);}
    });
    read({owner,roomId});
  });
  const packets=await stream(tab);
  assert.equal(packets[0].records.find(record=>record.id==='$broker').text,'hello');
  assert.equal(packets.at(-1).ok,true);
  const refused=await stream({...tab,url:'https://example.test/'});
  assert.equal(refused.length,1);assert.equal(refused[0].ok,false);
  const stats=await send({action:'stats'},popup);assert.equal(stats.ok,true);assert.equal(stats.accounts>=1,true);assert.equal(stats.stats.messages>=1,true);
  assert.equal(broadcast.length,2);
  assert.equal((await send({action:'clear'},tab)).ok,false);
  assert.equal((await send({action:'stats',owner},{...tab,url:'https://evil.test/'})).ok,false);
  assert.equal((await send({action:'stats'},tab)).ok,false);
  assert.equal((await send({action:'clear'},popup)).cleared,true);
  const popupTab={...popup,tab:{id:9},frameId:0};
  assert.equal((await send({action:'stats'},popupTab)).ok,true);
  assert.equal((await send({action:'clear'},popupTab)).cleared,true);
  assert.equal((await send({scope:'rcs-directory',action:'clear'},popupTab)).cleared,true);
  for(const from of [{...popupTab,frameId:1},{...popup,url:'chrome-extension://extension/offscreen.html'}]){
    assert.equal((await send({action:'stats'},from)).ok,false);
    assert.equal((await send({action:'clear'},from)).ok,false);
    assert.equal((await send({scope:'rcs-directory',action:'clear'},from)).ok,false);
  }
});
test('room reads use direct account-room key and deleted plaintext is removed from persistent ledger',async()=>{
  const {Store}=model(),name=crypto.randomUUID(),store=new Store({name});
  await store.ingest(batch([event('$base','original confidential'),event('$edit','edited confidential',2000,{content:{'m.new_content':{body:'edited confidential'},'m.relates_to':{rel_type:'m.replace',event_id:'$base'}}})]));
  await store.ingest(batch([event('$deleteEdit','',3000,{type:'m.room.redaction',redacts:'$edit'})]));
  assert.equal((await store.search(owner,{roomId})).records[0].text,'original confidential');
  assert.equal(JSON.stringify((await store.snapshot(owner)).rows).includes('edited confidential'),false);
  await store.ingest(batch([event('$deleteOriginal','',4000,{type:'m.room.redaction',redacts:'$base'})]));
  const db=await store.db(),original=db.transaction.bind(db);db.transaction=(...args)=>{const tx=original(...args),get=tx.objectStore.bind(tx);tx.objectStore=name=>{const object=get(name);if(name==='rooms')object.getAll=()=>{throw Error('Individual room read scanned account');};return object;};return tx;};
  assert.equal((await store.search(owner,{roomId})).total,0);db.transaction=original;
  const restarted=new Store({name});const row=(await restarted.snapshot(owner,roomId)).rows[0];assert.equal(JSON.stringify(row).includes('confidential'),false);assert.ok(row.approxBytes>0);
});
test('saved room streams bounded packets from a consistent snapshot with exact ordinary read results',async t=>{
  const {Store}=model(),store=new Store({name:crypto.randomUUID()});
  t.after(async()=>{(await store.db()).close();});
  const messages=Array.from({length:560},(_,i)=>event('$'+String(i).padStart(4,'0'),i===100?'https://example.test/test':'é'.repeat(240),1000+(i%80),{sender:i%2?owner:other}));
  messages[1]=event('$0001','picture',1060,{sender:other,content:{body:'picture',msgtype:'m.image',url:'https://example.test/a.gif',info:{w:480,h:360,mimetype:'image/gif'}}});
  for(let i=0;i<messages.length;i+=100)await store.ingest(batch(messages.slice(i,i+100)));
  const before=await store.room(owner,roomId),records=[],sizes=[];
  let concurrentWrite;
  const result=await store.room(owner,roomId,undefined,{send:part=>{
    sizes.push(part.length);records.push(...part);
    concurrentWrite ||= store.ingest(batch([event('$new','after snapshot',9000)]));
  }});
  await concurrentWrite;
  assert.deepEqual(sizes,[256,256,48]);
  records.sort((a,b)=>Date.parse(b.timestamp)-Date.parse(a.timestamp) || a.id.localeCompare(b.id));
  assert.deepEqual(JSON.parse(JSON.stringify({...result,records})),JSON.parse(JSON.stringify(before)));
  assert.equal((await store.room(owner,roomId)).records[0].id,'$new');
});
test('search estimates sum cached bytes without encoding saved messages again',async()=>{
  let encodings=0;class CountingEncoder extends TextEncoder {encode(value){encodings++;return super.encode(value);}}
  const ctx=vm.createContext({indexedDB,IDBKeyRange,TextEncoder:CountingEncoder});for(const file of ['search-core.js','message-store.js'])vm.runInContext(fs.readFileSync(`extension/${file}`,'utf8'),ctx);
  const store=new ctx.RCSMessageStore.Store({name:crypto.randomUUID()});await store.ingest(batch([event('$a','saved text')]));encodings=0;
  await store.search(owner);await store.search(owner,{roomId});await store.stats(owner);assert.equal(encodings,0);
});
function clientHarness({store,nativeImport,marked=false,ingestGate,readGate,health=()=>({ok:true})}={}){
  const dom=new JSDOM('',{runScripts:'outside-only'}),win=dom.window;win.TextEncoder=TextEncoder;
  for(const file of ['search-core.js','message-store.js'])win.eval(fs.readFileSync(`extension/${file}`,'utf8'));
  store ||= new win.RCSMessageStore.Store({indexedDB:null});let active=owner,changed,failures=0,imports=0,marks=0;const calls=[],nativeArgs=[];
  const emit=value=>win.document.dispatchEvent(new win.CustomEvent('rcs-message-cache-batch',{detail:JSON.stringify(value)}));
  win.RCSData={request(method,parameters,onProgress){if(method==='identity-context')return {promise:Promise.resolve({owner:active})};if(method==='cache-native-history'){nativeArgs.push(parameters);imports++;return {promise:Promise.resolve().then(()=>nativeImport?.(emit,onProgress)).then(result=>result?.available===false?result:{available:true})};}throw Error('Unexpected native method');}};
  win.chrome={runtime:{onMessage:{addListener(fn){changed=fn;}},async sendMessage(msg){if(msg.scope==='rcs-cache-health')return health();calls.push(msg.action);if(msg.action==='stats'){const value=await store.stats(msg.owner,{committed:true});return {ok:true,...value,nativeImportComplete:marked || value.nativeImportComplete};}if(msg.action==='search'){const value=await store.search(msg.owner,{...msg,committed:true});await readGate;return {ok:true,...value};}if(msg.action==='room')return {ok:true,...await store.room(msg.owner,msg.roomId,undefined,{committed:true})};if(msg.action==='mark-native-import-complete'){marks++;return {ok:true,nativeImportComplete:await store.importState(msg.owner,true)};}if(msg.action==='ingest'){await ingestGate;if(failures-->0)return {ok:false,error:'Transient quota failure'};return {ok:true,...await store.ingest(msg)};}}}};
  win.eval(fs.readFileSync('extension/message-cache-client.js','utf8'));
  return {dom,win,store,calls,nativeArgs,emit,setActive(value){active=value;},fail(count){failures=count;},get imports(){return imports;},get marks(){return marks;},change(message){changed(message);}};
}
test('self profile remains available without matching self messages and resets across accounts and Clear',async t=>{
  const h=clientHarness({marked:true}),api=h.win.RCSMessages;
  t.after(()=>h.dom.window.close());
  await h.store.ingest(batch([event('$partner','hello',1000,{sender:other})],{identities:[{id:owner,name:'You',self:true,avatar:'https://example.test/self.png'}]}));
  const result=await api.search({query:'missing'});
  assert.equal(result.total,0);assert.equal(result.selfIdentity.id,owner);
  assert.equal(api.getSelfIdentity().avatar,'https://example.test/self.png');
  const copy=api.getSelfIdentity();copy.avatar='changed';assert.equal(api.getSelfIdentity().avatar,'https://example.test/self.png');
  h.setActive(other);await api.room(roomId);assert.equal(api.getSelfIdentity(),null);
  h.setActive(owner);await api.search({});assert.equal(api.getSelfIdentity().id,owner);
  await h.store.clear(owner);h.change({scope:'rcs-messages-changed',owner,cleared:true});assert.equal(api.getSelfIdentity(),null);
});
test('saved room accepts all port packets together and discards a disconnected partial read',async t=>{
  const h=clientHarness({marked:true}),runtime=h.win.chrome.runtime,api=h.win.RCSMessages;
  t.after(()=>h.dom.window.close());
  let disconnects=0,partial=true;
  runtime.connect=({name})=>{
    assert.equal(name,'rcs-room-snapshot');let message,closed;
    return {
      onMessage:{addListener(fn){message=fn;}},
      onDisconnect:{addListener(fn){closed=fn;}},
      postMessage(request){
        assert.equal(request.owner,owner);assert.equal(request.roomId,roomId);
        queueMicrotask(()=>{
          message({records:[{id:'older',timestamp:'2026-10-08T19:00:00Z'}]});
          if(partial){closed();return;}
          message({records:[{id:'newer',timestamp:'2026-10-08T20:00:00Z'}]});
          message({ok:true,result:{owner,total:2,coverage:{complete:false}}});
        });
      },
      disconnect(){disconnects++;}
    };
  };
  await assert.rejects(api.room(roomId),/connection closed/);
  partial=false;
  const result=await api.room(roomId);
  assert.deepEqual(Array.from(result.records,r=>r.id),['newer','older']);
  assert.equal(result.total,2);assert.equal(result.coverage.complete,false);
  assert.equal(disconnects,2);assert.ok(!h.calls.includes('room'));
});
test('abandoning a room read closes its extension port immediately',async t=>{
  const h=clientHarness({marked:true}),controller=new h.win.AbortController();
  t.after(()=>h.dom.window.close());
  let started,disconnected=false;
  const reading=new Promise(resolve=>{started=resolve;});
  h.win.chrome.runtime.connect=()=>({
    onMessage:{addListener(){}},onDisconnect:{addListener(){}},
    postMessage:started,disconnect(){disconnected=true;}
  });
  const read=h.win.RCSMessages.room(roomId,{signal:controller.signal});
  await reading;
  controller.abort();
  await assert.rejects(read,{name:'AbortError'});
  assert.equal(disconnected,true);
});
test('a stalled cache check settles its activity while committed results remain usable and Refresh retries',async t=>{
  let attempts=0;const h=clientHarness({nativeImport:async(_emit,progress)=>{attempts++;progress?.({loaded:12,scanned:20});if(attempts===1)await new Promise(()=>{});return {available:true};}});t.after(()=>h.dom.window.close());
  const timer=h.win.setTimeout.bind(h.win);h.win.setTimeout=(fn,ms,...args)=>timer(fn,ms===45000?20:ms,...args);
  await h.store.ingest(batch([event('$cached','already saved coffee')]));const notices=[];h.win.RCSMessages.subscribe(value=>notices.push(value));
  const initial=await h.win.RCSMessages.search({query:'coffee'});assert.equal(initial.total,1);assert.equal(initial.importing,true);
  await new Promise(resolve=>setTimeout(resolve,40));const paused=await h.win.RCSMessages.search({query:'coffee'});assert.equal(paused.total,1);assert.equal(paused.importing,false);assert.match(paused.cacheError,/stopped responding/);assert.equal(attempts,1);assert.equal(h.marks,0);assert.ok(notices.some(value=>value.cacheProgress?.scanned===20));
  await h.win.RCSMessages.search({query:'coffee',retryWrites:true});await h.win.RCSMessages.ready();assert.equal(attempts,2);assert.equal(h.marks,1);assert.equal((await h.win.RCSMessages.search({query:'coffee'})).cacheError,'');
});
test('a stalled saved-message transport fails with a retryable error while other committed reads work',async t=>{
  const h=clientHarness({readGate:new Promise(()=>{})});t.after(()=>h.dom.window.close());const timer=h.win.setTimeout.bind(h.win);h.win.setTimeout=(fn,ms,...args)=>timer(fn,ms===15000?5:ms,...args);
  await h.store.ingest(batch([event('$cached','kept in storage')]));await assert.rejects(h.win.RCSMessages.search({}),/Reading saved messages took too long/);assert.equal((await h.win.RCSMessages.room(roomId)).records.length,1);
});
test('an unresponsive worker gives extension-reload instructions without losing saved data',async t=>{
  let probes=0;const h=clientHarness({readGate:new Promise(()=>{}),health:()=>{probes++;return new Promise(()=>{});}});t.after(()=>h.dom.window.close());
  const timer=h.win.setTimeout.bind(h.win);h.win.setTimeout=(fn,ms,...args)=>timer(fn,[15000,1000].includes(ms)?5:ms,...args);
  await h.store.ingest(batch([event('$cached','kept in storage')]));
  await Promise.all([1,2].map(()=>assert.rejects(h.win.RCSMessages.search({}),/background worker.*Reload Reddit Tweaks.*refresh this Reddit tab/)));
  assert.equal(probes,1,'simultaneous read deadlines share one bounded worker probe');
  assert.equal((await h.store.search(owner)).total,1);
});
test('health checking preserves terminal extension invalidation instead of offering a search retry',async t=>{
  const h=clientHarness({readGate:new Promise(()=>{}),health:()=>{throw Error('Extension context invalidated.');}});t.after(()=>h.dom.window.close());
  const timer=h.win.setTimeout.bind(h.win);h.win.setTimeout=(fn,ms,...args)=>timer(fn,ms===15000?5:ms,...args);
  await assert.rejects(h.win.RCSMessages.search({}),error=>error.code==='RCS_CONTEXT_INVALIDATED');
});
test('successful capture acknowledgements keep a long active reconciliation from being reported as stalled',async t=>{
  const h=clientHarness({nativeImport:async emit=>{for(let i=0;i<5;i++){await new Promise(resolve=>setTimeout(resolve,10));emit(batch([event('$active-'+i,'active import')]));await h.win.RCSMessages.flush();}return {available:true};}});t.after(()=>h.dom.window.close());
  const timer=h.win.setTimeout.bind(h.win);h.win.setTimeout=(fn,ms,...args)=>timer(fn,ms===45000?30:ms,...args);
  await h.win.RCSMessages.ready();const result=await h.win.RCSMessages.search({});assert.equal(result.total,5);assert.equal(result.cacheError,'');assert.equal(h.marks,1);
});
test('failed captures leave committed data readable; explicit flush or a new batch retries without account leakage',async()=>{
  const h=clientHarness({marked:true}),api=h.win.RCSMessages;
  h.fail(1);h.emit(batch([event('$retry','retained')]));await new Promise(resolve=>setTimeout(resolve,0));
  const cached=await api.search({query:'retained'});assert.equal(cached.total,0);assert.match(cached.savingError,/Transient/);
  await api.flush();assert.equal((await api.search({query:'retained'})).total,1);
  h.fail(1);h.emit(batch([event('$next','next batch retry')]));await new Promise(resolve=>setTimeout(resolve,0));h.emit(batch([event('$trigger','trigger')]));await api.flush();assert.equal((await h.store.search(owner)).total,3);
  h.fail(2);h.emit(batch([event('$stale','stale owner data')]));await new Promise(resolve=>setTimeout(resolve,0));h.setActive(other);assert.equal((await api.search({})).total,0);assert.equal((await h.store.search(owner,{query:'stale'})).total,0);h.dom.window.close();
});
test('saved search and room read return before native reconciliation; ready waits and a restart reconciles again',async()=>{
  let release;const gate=new Promise(resolve=>release=resolve);const h=clientHarness({nativeImport:async emit=>{await gate;emit(batch([event('$import','native cached text')]));}});
  await h.store.ingest(batch([event('$saved','native already saved')]));
  const search=h.win.RCSMessages.search({query:'native'}),room=h.win.RCSMessages.room(roomId);
  const first=await search;assert.equal(first.total,1);assert.equal(first.importing,true);assert.equal((await room).records.length,1);
  await new Promise(resolve=>setTimeout(resolve,0));assert.equal(h.imports,1);assert.equal(h.nativeArgs[0].awaitCache,true);assert.equal(h.marks,0);
  let finished=false;const ready=h.win.RCSMessages.ready().then(value=>{finished=true;return value;});await waitForTick();assert.equal(finished,false);
  release();assert.equal((await ready).importing,false);assert.equal((await h.win.RCSMessages.search({query:'native'})).total,2);assert.equal(h.marks,1);
  const statsCalls=h.calls.filter(action=>action==='stats').length;await h.win.RCSMessages.search({});assert.equal(h.calls.filter(action=>action==='stats').length,statsCalls);assert.equal(h.imports,1);
  const restarted=clientHarness({store:h.store});assert.equal((await restarted.win.RCSMessages.search({})).total,2);await restarted.win.RCSMessages.ready();assert.equal(restarted.imports,1);h.dom.window.close();restarted.dom.window.close();
});
test('failed native-import writes prevent completion marker until retained data is saved',async()=>{
  const h=clientHarness({nativeImport:emit=>emit(batch([event('$retryImport','persist before marker')]))});h.fail(10);
  await assert.rejects(h.win.RCSMessages.ready(),/Transient/);assert.equal(h.marks,0);assert.equal(await h.store.importState(owner),false);
  h.fail(0);await h.win.RCSMessages.ready();assert.equal((await h.win.RCSMessages.search({})).total,1);assert.equal(h.imports,1);assert.equal(h.marks,1);h.dom.window.close();
});
test('clear drops failed backlog and resets page capture dedup; retry overflow is reported',async()=>{
  const h=clientHarness({marked:true}),resets=[],errors=[];h.win.document.addEventListener('rcs-message-cache-reset',event=>resets.push(JSON.parse(event.detail)));h.win.RCSMessages.subscribe(value=>{if(value.error)errors.push(value.error);});
  h.fail(10);h.emit(batch([event('$pendingClear','do not restore')]));await new Promise(resolve=>setTimeout(resolve,0));
  h.change({scope:'rcs-messages-changed',owner,cleared:true});h.fail(0);assert.equal((await h.win.RCSMessages.search({})).total,0);assert.equal(resets[0].owner,owner);
  h.emit(batch([event('$pendingClear','recaptured after clear')]));await h.win.RCSMessages.flush();assert.equal((await h.win.RCSMessages.search({})).total,1);
  h.emit(batch(Array.from({length:10001},(_,index)=>event('$overflow'+index,'body'))));await assert.rejects(h.win.RCSMessages.flush(),/buffer is full/);assert.ok(errors.some(error=>error.includes('buffer is full')));h.dom.window.close();
});
test('native import flush barrier acknowledges durable writes and rejects wrong account',async()=>{
  const h=clientHarness({marked:true}),acks=[];h.win.document.addEventListener('rcs-message-cache-flushed',event=>acks.push(JSON.parse(event.detail)));
  const barrier=(id,account=owner)=>h.win.document.dispatchEvent(new h.win.CustomEvent('rcs-message-cache-flush',{detail:JSON.stringify({owner:account,id})}));
  h.fail(1);h.emit(batch([event('$barrier','saved before ack')]));barrier('ack');
  await new Promise(resolve=>setTimeout(resolve,10));assert.equal(acks[0].id,'ack');assert.equal(acks[0].ok,true);assert.equal((await h.store.search(owner)).total,1);
  h.fail(10);h.emit(batch([event('$failure','not saved')]));barrier('failure');await new Promise(resolve=>setTimeout(resolve,10));assert.equal(acks[1].ok,false);assert.match(acks[1].error,/Transient/);
  barrier('wrong',other);await new Promise(resolve=>setTimeout(resolve,10));assert.equal(acks[2].ok,false);assert.equal(acks[2].owner,other);assert.match(acks[2].error,/account changed/);h.dom.window.close();
});
test('returning account rechecks readiness without a redundant stats scan while Clear suppresses native reimport',async()=>{
  const h=clientHarness({nativeImport:emit=>emit(batch([event('$importOnce','cached')]))});await h.win.RCSMessages.ready();assert.equal(h.imports,1);
  h.setActive(other);await h.win.RCSMessages.ready();h.setActive(owner);const before=h.calls.filter(action=>action==='stats').length;await h.win.RCSMessages.search({});await h.win.RCSMessages.ready();assert.equal(h.calls.filter(action=>action==='stats').length,before+1);assert.equal(h.imports,2);
  await h.store.clear(owner);h.change({scope:'rcs-messages-changed',owner,cleared:true});assert.equal((await h.win.RCSMessages.search({})).total,0);assert.equal(h.imports,2);assert.equal(await h.store.importState(owner),false);h.dom.window.close();
});
test('Clear during initial native import prevents late completion from marking or restoring discarded writes',async()=>{
  let release;const gate=new Promise(resolve=>release=resolve),h=clientHarness({nativeImport:async emit=>{emit(batch([event('$clearDuringImport','pending native data')]));await gate;}});h.fail(10);
  const searching=h.win.RCSMessages.search({});await new Promise(resolve=>setTimeout(resolve,0));await h.store.clear(owner);h.change({scope:'rcs-messages-changed',owner,cleared:true});h.fail(0);release();
  assert.equal((await searching).total,0);assert.equal(h.marks,0);assert.equal(await h.store.importState(owner),false);assert.equal((await h.win.RCSMessages.search({})).total,0);assert.equal(h.imports,1);h.dom.window.close();
});
test('known sender name and avatar survive opaque or placeholder identity hints across restart',async()=>{
  const {Store}=model(),name=crypto.randomUUID(),store=new Store({name});
  await store.ingest(batch([event('$identity','hello',1000,{sender:other})],{identities:[{id:other,name:'HumanName',avatar:'https://example.test/avatar.png',historical:true,unavailable:true,availabilityKnown:true}]}));
  for(const hint of [other,'[deleted]','Someone','Unknown sender','Username unavailable','[removed]'])await store.ingest(batch([],{identities:[{id:other,name:hint,avatar:'data:image/png;base64,ignored',historical:false,unavailable:false,availabilityKnown:false}]}));
  const restarted=new Store({name}),record=(await restarted.search(owner)).records[0];assert.equal(record.author,'HumanName');assert.equal(record.avatar,'https://example.test/avatar.png');assert.equal(record.authorHistorical,true);assert.equal(record.authorUnavailable,true);
  await restarted.ingest(batch([],{identities:[{id:other,name:'RestoredName',historical:false,unavailable:false,availabilityKnown:true}]}));
  const restored=(await new Store({name}).search(owner)).records[0];assert.equal(restored.author,'RestoredName');assert.equal(restored.authorUnavailable,false);assert.equal(restored.authorHistorical,false);assert.equal(restored.avatar,'https://example.test/avatar.png');
});
test('directory identity enriches opaque saved sender hints and respects verified availability precedence',async()=>{
  const {Store}=model(),store=new Store({name:crypto.randomUUID()});
  await store.ingest(batch([event('$directoryIdentity','hello',1000,{sender:other})],{identities:[{id:other,name:other,unavailable:false,historical:false}]}));
  const directory={identities:{[other]:{id:other,name:'RecoveredDirectoryName',avatar:'https://example.test/directory.png',accountUnavailable:true,historicalName:true,availabilityKnown:true}}};
  const enriched=(await store.search(owner,{},directory)).records[0];assert.equal(enriched.author,'RecoveredDirectoryName');assert.equal(enriched.authorHistorical,true);assert.equal(enriched.authorUnavailable,true);
  await store.ingest(batch([],{identities:[{id:other,name:'SavedHuman',unavailable:true,historical:true,availabilityKnown:true}]}));
  const unknownDirectory={identities:{[other]:{id:other,name:'[deleted]',accountUnavailable:false,historicalName:false,availabilityKnown:false}}};
  const preserved=(await store.search(owner,{},unknownDirectory)).records[0];assert.equal(preserved.author,'SavedHuman');assert.equal(preserved.authorUnavailable,true);assert.equal(preserved.authorHistorical,true);
  const currentDirectory={identities:{[other]:{id:other,name:'CurrentHuman',accountUnavailable:false,historicalName:false,availabilityKnown:true}}};
  const available=(await store.search(owner,{},currentDirectory)).records[0];assert.equal(available.author,'CurrentHuman');assert.equal(available.authorUnavailable,false);assert.equal(available.authorHistorical,false);
});
test('clear-all invalidates previously imported accounts without same-document reimport or empty completion marker',async()=>{
  const h=clientHarness();await h.win.RCSMessages.ready();h.setActive(other);await h.win.RCSMessages.ready();assert.equal(h.imports,2);assert.equal(h.marks,2);
  await h.store.clear();h.change({scope:'rcs-messages-changed',owner:null,cleared:true});assert.equal((await h.win.RCSMessages.search({})).total,0);h.setActive(owner);assert.equal((await h.win.RCSMessages.search({})).total,0);
  assert.equal(h.imports,2);assert.equal(h.marks,2);assert.equal(await h.store.importState(owner),false);assert.equal(await h.store.importState(other),false);h.dom.window.close();
});
test('targeted clear for an inactive account invalidates its import result and preserves active account marker',async()=>{
  const h=clientHarness();await h.win.RCSMessages.ready();h.setActive(other);await h.win.RCSMessages.ready();
  await h.store.clear(owner);h.change({scope:'rcs-messages-changed',owner,cleared:true});assert.equal(await h.store.importState(other),true);await h.win.RCSMessages.search({});h.setActive(owner);await h.win.RCSMessages.search({});
  assert.equal(await h.store.importState(owner),false);assert.equal(h.imports,2);assert.equal(h.marks,2);h.dom.window.close();
});
test('single-event bursts coalesce across rooms without losing room IDs or coverage boundaries',async()=>{
  const h=clientHarness({marked:true});
  for(let i=0;i<1500;i++)h.emit({owner,roomId:'!burst-'+i+':reddit.com',events:[event('$burst-'+i,'burst text',1000,{room_id:undefined})]});
  h.emit(batch([],{coverage:{complete:true}}));await h.win.RCSMessages.flush();
  const found=await h.store.search(owner,{limit:1});assert.equal(found.total,1500);assert.equal(found.stats.rooms,1501);assert.equal(found.stats.completeRooms,1);
  assert.ok(h.calls.filter(action=>action==='ingest').length<15,'one RPC per native event is avoided');
  assert.equal(found.records[0].roomId.startsWith('!burst-'),true);h.dom.window.close();
});
test('overflow barriers can drain, but only matching recovery clears the error; unrecovered gaps block import marker',async()=>{
  const h=clientHarness(),rejected=[];h.win.document.addEventListener('rcs-message-cache-rejected',event=>rejected.push(JSON.parse(event.detail)));
  h.emit(batch(Array.from({length:10001},(_,i)=>event('$lost-'+i,'lost'))));await assert.rejects(h.win.RCSMessages.flush(),/buffer is full/);
  let ack;h.win.document.addEventListener('rcs-message-cache-flushed',event=>ack=JSON.parse(event.detail));
  h.win.document.dispatchEvent(new h.win.CustomEvent('rcs-message-cache-flush',{detail:JSON.stringify({owner,id:'barrier'})}));await waitForTick();assert.equal(ack.ok,true);
  const recover=value=>h.win.document.dispatchEvent(new h.win.CustomEvent('rcs-message-cache-recovered',{detail:JSON.stringify(value)}));
  recover({owner,id:'stale',complete:true});await assert.rejects(h.win.RCSMessages.flush(),/buffer is full/);
  recover({owner,id:rejected[0].id,complete:false});const result=await h.win.RCSMessages.search({});assert.equal(result.captureIncomplete,true);assert.equal(h.marks,0);h.dom.window.close();
});
const waitForTick=()=>new Promise(resolve=>setTimeout(resolve,10));
test('committed snapshots read saved data while future writes are paused; a room uses one consistent snapshot',async()=>{
  const {Store}=model(),store=new Store({name:crypto.randomUUID()});
  await store.ingest(batch(Array.from({length:750},(_,i)=>event('$saved-'+i,'saved text',i+1))));
  let release;const gate=new Promise(resolve=>release=resolve),write=store.write.bind(store);store.write=async value=>{await gate;return write(value);};
  const pending=store.ingest(batch([event('$queued','pending text',10000)]));
  let timeout;
  try {
    let roomReads=0;const txOrig=store.transaction.bind(store);store.transaction=(...args)=>{if(args[1]!=='readwrite')roomReads++;return txOrig(...args);};
    const room=await Promise.race([store.room(owner,roomId,undefined,{committed:true}),new Promise((_,reject)=>timeout=setTimeout(()=>reject(Error('committed read waited for queued write')),1000))]);
    assert.equal(room.total,750);assert.equal(room.records.length,750);assert.equal(new Set(room.records.map(r=>r.id)).size,750);assert.equal(roomReads,1);
    assert.equal((await store.stats(owner,{committed:true})).stats.messages,750);
  }finally{clearTimeout(timeout);release();await pending;}
  assert.equal((await store.search(owner)).total,751);
});
test('search, room and stats return before an in-flight capture while ready and flush keep durable barriers',async()=>{
  let release;const gate=new Promise(resolve=>release=resolve),h=clientHarness({ingestGate:gate});
  await h.store.ingest(batch([event('$old','already saved')]));h.emit(batch([event('$new','new capture')]));
  let flushed=false,readied=false;const flushing=h.win.RCSMessages.flush().then(()=>flushed=true),ready=h.win.RCSMessages.ready().then(()=>readied=true);let timeout;
  try {
    const [search,room,stats]=await Promise.race([Promise.all([h.win.RCSMessages.search({}),h.win.RCSMessages.room(roomId),h.win.RCSMessages.stats()]),new Promise((_,reject)=>timeout=setTimeout(()=>reject(Error('interactive reads waited for capture')),1000))]);
    assert.equal(search.total,1);assert.equal(search.savingPending,true);assert.equal(room.records.length,1);assert.equal(stats.stats.messages,1);assert.equal(flushed,false);assert.equal(readied,false);
  }finally{clearTimeout(timeout);release();await Promise.all([flushing,ready]);}
  assert.equal((await h.win.RCSMessages.search({})).total,2);h.dom.window.close();
});
test('ordinary reads do not retry a failed write repeatedly and explicit Refresh retries in the background',async()=>{
  const h=clientHarness();await h.store.ingest(batch([event('$old','saved')]));h.fail(10);h.emit(batch([event('$new','pending')]));await waitForTick();
  const before=h.calls.filter(action=>action==='ingest').length;
  for(let i=0;i<3;i++){const found=await h.win.RCSMessages.search({});assert.equal(found.total,1);assert.match(found.savingError,/Transient/);}
  assert.equal(h.calls.filter(action=>action==='ingest').length,before);
  h.fail(0);await h.win.RCSMessages.search({retryWrites:true});await h.win.RCSMessages.flush();const saved=await h.win.RCSMessages.search({});assert.equal(saved.total,2);assert.equal(saved.savingError,'');await h.win.RCSMessages.ready();h.dom.window.close();
});
test('a delayed committed read cannot return old results after the active cache is cleared',async()=>{
  let release;const gate=new Promise(resolve=>release=resolve),h=clientHarness({readGate:gate});await h.store.ingest(batch([event('$old','before clear')]));
  const searching=h.win.RCSMessages.search({});const rejected=assert.rejects(searching,/Saved messages changed/);await waitForTick();
  await h.store.clear(owner);h.change({scope:'rcs-messages-changed',owner,cleared:true});release();await rejected;assert.equal((await h.win.RCSMessages.search({})).total,0);h.dom.window.close();
});
test('native connection starts reconciliation without a search and a late database-ready signal retries once',async()=>{
  let ready=false;const h=clientHarness({nativeImport:emit=>{if(!ready)return {available:false,retryable:true};emit(batch([event('$automatic','automatic cached message')]));}});
  const connect=(sourceReady,attachment='first')=>h.win.document.dispatchEvent(new h.win.CustomEvent('rcs-message-cache-connected',{detail:JSON.stringify({owner,attachment,sourceReady})}));
  connect(false);await waitForTick();assert.equal(h.imports,1);assert.equal(h.calls.includes('search'),false);
  connect(false);await waitForTick();assert.equal(h.imports,1,'unchanged not-ready signals do not loop');
  ready=true;connect(true);await waitForTick();assert.equal(h.imports,2);assert.equal((await h.store.search(owner)).total,1);assert.ok((await h.store.stats(owner)).nativeReconciledAt>0);
  connect(true);await waitForTick();assert.equal(h.imports,2,'ordinary native sync signals reuse completed attachment');
  connect(true,'replacement');await waitForTick();assert.equal(h.imports,3,'a replacement client attaches and checks local history again');
  h.change({scope:'rcs-messages-changed',owner,cleared:true});connect(true,'after-clear');await waitForTick();assert.equal(h.imports,3,'Clear does not refill old history in the same document');h.dom.window.close();
});
test('popup global stats are cached persistently and updated incrementally without rescanning IndexedDB',async()=>{
  const storeValues={};
  const makeBroker=()=>{
    const listeners=[],ctx=vm.createContext({indexedDB,IDBKeyRange,TextEncoder,console,crypto});
    ctx.chrome={
      runtime:{id:'extension',getURL:path=>'chrome-extension://extension/'+path,onMessage:{addListener:fn=>listeners.push(fn)}},
      tabs:{query:async()=>[],sendMessage:async()=>{}},
      storage:{
        local:{
          get:async keys=>{
            if(keys===null)return {...storeValues};
            const list=Array.isArray(keys)?keys:[keys],out={};
            for(const k of list)if(k in storeValues)out[k]=JSON.parse(JSON.stringify(storeValues[k]));
            return out;
          },
          set:async values=>{for(const [k,v] of Object.entries(values))storeValues[k]=JSON.parse(JSON.stringify(v));},
          remove:async keys=>{for(const k of (Array.isArray(keys)?keys:[keys]))delete storeValues[k];},
          setAccessLevel:()=>{}
        },
        session:{get:async()=>({}),set:async()=>{},remove:async()=>{}}
      }
    };
    ctx.importScripts=(...files)=>files.forEach(file=>vm.runInContext(fs.readFileSync(`extension/${file}`,'utf8'),ctx));
    vm.runInContext(fs.readFileSync('extension/cache-broker.js','utf8'),ctx);
    const send=(message,sender)=>new Promise(resolve=>listeners.find(listener=>listener({scope:'rcs-messages',...message},sender,resolve)));
    return {ctx,send};
  };
  const tab={id:'extension',url:'https://chat.reddit.com/',tab:{id:1}},popup={id:'extension',url:'chrome-extension://extension/popup.html'};
  const b1=makeBroker();
  await b1.send({action:'clear'},popup); // clean baseline
  await b1.send({...batch([event('$m1','hello'),event('$m2','photo',2000,{content:{msgtype:'m.image',body:'photo',url:'https://i.redd.it/pic.png'}})],{identities:[{id:owner,name:'me'}],coverage:{complete:true,dateComplete:true}}),action:'ingest'},tab);
  const first=await b1.send({action:'stats'},popup);
  assert.equal(first.ok,true);assert.equal(first.stats.messages,2);assert.equal(first.stats.rooms,1);assert.equal(first.stats.completeRooms,1);assert.equal(first.accounts,1);
  // Seeded in chrome.storage.local; subsequent reads & mutations must never invoke full IndexedDB getAll scans.
  const b2=makeBroker();
  const b2Messages=vm.runInContext('messages',b2.ctx);
  const db=await b2Messages.db(),origTx=db.transaction.bind(db);
  let fullScans=0;
  db.transaction=(...args)=>{
    const tx=origTx(...args),getStore=tx.objectStore.bind(tx);
    tx.objectStore=name=>{const store=getStore(name);const origGetAll=store.getAll.bind(store);store.getAll=(...a)=>{if(!a.length)fullScans++;return origGetAll(...a);};return store;};
    return tx;
  };
  const coldHit=await b2.send({action:'stats'},popup);
  assert.equal(fullScans,0,'restarted service worker serves cached popup stats without scanning IndexedDB');
  assert.deepEqual({...coldHit.stats},{...first.stats});
  // Incremental updates across ingest (same room + new room + second account), dimensions, and importState
  await b2.send({...batch([event('$m3','third')]),action:'ingest'},tab);
  await b2.send({...batch([event('$m4','other room',3000,{room_id:'!room2:reddit.com'})],{owner:other,roomId:'!room2:reddit.com'}),action:'ingest'},tab);
  await b2.send({action:'image-dimensions',owner,records:[{roomId,eventId:'$m2',preview:'https://i.redd.it/pic.png',width:800,height:600}]},tab);
  await b2.send({action:'mark-native-import-complete',owner},tab);
  const incremental=await b2.send({action:'stats'},popup);
  assert.equal(fullScans,0,'incremental updates avoid full IndexedDB scans');
  // Compare against a fresh ground-truth full scan
  db.transaction=origTx;
  const truth=await b2Messages.stats(undefined,{committed:true});
  assert.deepEqual({...incremental.stats},{...truth.stats},'incremental stats match full IndexedDB scan byte-for-byte');
  assert.equal(incremental.accounts,truth.accounts);
  // Per-owner clear invalidates cache and recomputes accurately; full clear zeroes cache without scanning
  await b2.send({action:'clear',owner:other},popup);
  const afterOwnerClear=await b2.send({action:'stats'},popup);
  assert.equal(afterOwnerClear.stats.messages,3);assert.equal(afterOwnerClear.accounts,1);
  await b2.send({action:'clear'},popup);
  const afterClearAll=await b2.send({action:'stats'},popup);
  assert.equal(afterClearAll.stats.messages,0);assert.equal(afterClearAll.stats.rooms,0);assert.equal(afterClearAll.stats.approxBytes,0);assert.equal(afterClearAll.accounts,0);
});
