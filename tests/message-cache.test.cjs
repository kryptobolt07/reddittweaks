const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {indexedDB,IDBKeyRange}=require('fake-indexeddb');
const {JSDOM}=require('jsdom');
function model(){const ctx=vm.createContext({indexedDB,IDBKeyRange,TextEncoder,console});for(const file of ['search-core.js','message-store.js'])vm.runInContext(fs.readFileSync(`extension/${file}`,'utf8'),ctx);return ctx.RCSMessageStore;}
const owner='@alice:reddit.com',other='@bob:reddit.com',roomId='!room:reddit.com';
const event=(id,body,time=1000,extras={})=>({event_id:id,room_id:roomId,type:'m.room.message',sender:owner,origin_server_ts:time,content:{body},...extras});
const batch=(events,extra={})=>({owner,roomId,events,...extra});
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
  await store.ingest(batch([event('$a','duplicate')]));assert.equal((await store.stats(owner)).stats.completeRooms,0);
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
test('isolated client binds batches to native account, flushes reads, and forwards cross-tab changes',async()=>{
  const dom=new JSDOM('',{runScripts:'outside-only'}),win=dom.window;win.TextEncoder=TextEncoder;
  for(const file of ['search-core.js','message-store.js'])win.eval(fs.readFileSync(`extension/${file}`,'utf8'));
  let active=owner,changed;win.RCSData={request(){return {promise:Promise.resolve({owner:active})};}};
  const store=new win.RCSMessageStore.Store({indexedDB:null});
  win.chrome={runtime:{onMessage:{addListener(fn){changed=fn;}},async sendMessage(msg){if(msg.action==='stats')return {ok:true,...await store.stats(msg.owner),nativeImportComplete:true};if(msg.action==='search')return {ok:true,...await store.search(msg.owner,msg)};if(msg.action==='ingest')return {ok:true,...await store.ingest(msg)};}}};
  win.eval(fs.readFileSync('extension/message-cache-client.js','utf8'));const updates=[];win.RCSMessages.subscribe(value=>updates.push(value));
  const emit=value=>win.document.dispatchEvent(new win.CustomEvent('rcs-message-cache-batch',{detail:JSON.stringify(value)}));
  emit(batch([event('$a','hello')]));assert.equal((await win.RCSMessages.search({query:'hello'})).total,1);
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
  const listeners=[],broadcast=[],ctx=vm.createContext({indexedDB,IDBKeyRange,TextEncoder,console,crypto});
  ctx.chrome={runtime:{id:'extension',getURL:path=>'chrome-extension://extension/'+path,onMessage:{addListener:fn=>listeners.push(fn)}},tabs:{query:async()=>[{id:1},{id:2}],sendMessage:async(id,value)=>broadcast.push({id,value})},storage:{local:{get:async()=>({}),set:async()=>{},remove:async()=>{},setAccessLevel:()=>{}},session:{get:async()=>({}),set:async()=>{},remove:async()=>{}}}};
  ctx.importScripts=(...files)=>files.forEach(file=>vm.runInContext(fs.readFileSync(`extension/${file}`,'utf8'),ctx));
  vm.runInContext(fs.readFileSync('extension/cache-broker.js','utf8'),ctx);
  const send=(message,sender)=>new Promise(resolve=>listeners.find(listener=>listener({...message,scope:'rcs-messages'},sender,resolve)));
  const tab={id:'extension',url:'https://chat.reddit.com/',tab:{id:1}},popup={id:'extension',url:'chrome-extension://extension/popup.html'};
  await send({...batch([event('$broker','hello')]),action:'ingest'},tab);
  const stats=await send({action:'stats'},popup);assert.equal(stats.ok,true);assert.equal(stats.accounts>=1,true);assert.equal(stats.stats.messages>=1,true);
  assert.equal(broadcast.length,2);
  assert.equal((await send({action:'clear'},tab)).ok,false);
  assert.equal((await send({action:'stats',owner},{...tab,url:'https://evil.test/'})).ok,false);
  assert.equal((await send({action:'stats'},tab)).ok,false);
  assert.equal((await send({action:'clear'},popup)).cleared,true);
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
test('search estimates sum cached bytes without encoding saved messages again',async()=>{
  let encodings=0;class CountingEncoder extends TextEncoder {encode(value){encodings++;return super.encode(value);}}
  const ctx=vm.createContext({indexedDB,IDBKeyRange,TextEncoder:CountingEncoder});for(const file of ['search-core.js','message-store.js'])vm.runInContext(fs.readFileSync(`extension/${file}`,'utf8'),ctx);
  const store=new ctx.RCSMessageStore.Store({name:crypto.randomUUID()});await store.ingest(batch([event('$a','saved text')]));encodings=0;
  await store.search(owner);await store.search(owner,{roomId});await store.stats(owner);assert.equal(encodings,0);
});
function clientHarness({store,nativeImport,marked=false}={}){
  const dom=new JSDOM('',{runScripts:'outside-only'}),win=dom.window;win.TextEncoder=TextEncoder;
  for(const file of ['search-core.js','message-store.js'])win.eval(fs.readFileSync(`extension/${file}`,'utf8'));
  store ||= new win.RCSMessageStore.Store({indexedDB:null});let active=owner,changed,failures=0,imports=0,marks=0;const calls=[],nativeArgs=[];
  const emit=value=>win.document.dispatchEvent(new win.CustomEvent('rcs-message-cache-batch',{detail:JSON.stringify(value)}));
  win.RCSData={request(method,parameters){if(method==='identity-context')return {promise:Promise.resolve({owner:active})};if(method==='cache-native-history'){nativeArgs.push(parameters);imports++;return {promise:Promise.resolve().then(()=>nativeImport?.(emit)).then(()=>({available:true}))};}throw Error('Unexpected native method');}};
  win.chrome={runtime:{onMessage:{addListener(fn){changed=fn;}},async sendMessage(msg){calls.push(msg.action);if(msg.action==='stats')return {ok:true,...await store.stats(msg.owner),nativeImportComplete:marked || await store.importState(msg.owner)};if(msg.action==='search')return {ok:true,...await store.search(msg.owner,msg)};if(msg.action==='room')return {ok:true,...await store.search(msg.owner,{roomId:msg.roomId})};if(msg.action==='mark-native-import-complete'){marks++;return {ok:true,nativeImportComplete:await store.importState(msg.owner,true)};}if(msg.action==='ingest'){if(failures-->0)return {ok:false,error:'Transient quota failure'};return {ok:true,...await store.ingest(msg)};}}}};
  win.eval(fs.readFileSync('extension/message-cache-client.js','utf8'));
  return {dom,win,store,calls,nativeArgs,emit,setActive(value){active=value;},fail(count){failures=count;},get imports(){return imports;},get marks(){return marks;},change(message){changed(message);}};
}
test('client retains failed batches, retries on explicit reads or next batch, and never writes old account data to new account',async()=>{
  const h=clientHarness({marked:true}),api=h.win.RCSMessages;
  h.fail(1);h.emit(batch([event('$retry','retained')]));await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal((await api.search({query:'retained'})).total,1);
  h.fail(1);h.emit(batch([event('$next','next batch retry')]));await new Promise(resolve=>setTimeout(resolve,0));h.emit(batch([event('$trigger','trigger')]));await api.flush();assert.equal((await h.store.search(owner)).total,3);
  h.fail(2);h.emit(batch([event('$stale','stale owner data')]));await new Promise(resolve=>setTimeout(resolve,0));h.setActive(other);assert.equal((await api.search({})).total,0);assert.equal((await h.store.search(owner,{query:'stale'})).total,0);h.dom.window.close();
});
test('first search and concurrent room read share one native import; later queries and restarted client skip persisted marker',async()=>{
  let release;const gate=new Promise(resolve=>release=resolve);const h=clientHarness({nativeImport:async emit=>{await gate;emit(batch([event('$import','native cached text')]));}});
  const search=h.win.RCSMessages.search({query:'native'}),room=h.win.RCSMessages.room(roomId);await new Promise(resolve=>setTimeout(resolve,0));assert.equal(h.imports,1);assert.equal(h.nativeArgs[0].awaitCache,true);release();assert.equal((await search).total,1);assert.equal((await room).records.length,1);assert.equal(h.marks,1);
  const statsCalls=h.calls.filter(action=>action==='stats').length;await h.win.RCSMessages.search({});assert.equal(h.calls.filter(action=>action==='stats').length,statsCalls);assert.equal(h.imports,1);
  const restarted=clientHarness({store:h.store});assert.equal((await restarted.win.RCSMessages.search({})).total,1);assert.equal(restarted.imports,0);h.dom.window.close();restarted.dom.window.close();
});
test('failed native-import writes prevent completion marker until retained data is saved',async()=>{
  const h=clientHarness({nativeImport:emit=>emit(batch([event('$retryImport','persist before marker')]))});h.fail(10);
  await assert.rejects(h.win.RCSMessages.search({}),/Transient/);assert.equal(h.marks,0);assert.equal(await h.store.importState(owner),false);
  h.fail(0);assert.equal((await h.win.RCSMessages.search({})).total,1);assert.equal(h.imports,1);assert.equal(h.marks,1);h.dom.window.close();
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
test('returning account rechecks persisted import marker while Clear suppresses same-document native reimport',async()=>{
  const h=clientHarness({nativeImport:emit=>emit(batch([event('$importOnce','cached')]))});await h.win.RCSMessages.search({});assert.equal(h.imports,1);
  h.setActive(other);await h.win.RCSMessages.search({});h.setActive(owner);const before=h.calls.filter(action=>action==='stats').length;await h.win.RCSMessages.search({});assert.equal(h.calls.filter(action=>action==='stats').length,before+1);assert.equal(h.imports,2);
  await h.store.clear(owner);h.change({scope:'rcs-messages-changed',owner,cleared:true});assert.equal((await h.win.RCSMessages.search({})).total,0);assert.equal(h.imports,2);assert.equal(await h.store.importState(owner),false);h.dom.window.close();
});
test('Clear during initial native import prevents late completion from marking or restoring discarded writes',async()=>{
  let release;const gate=new Promise(resolve=>release=resolve),h=clientHarness({nativeImport:async emit=>{emit(batch([event('$clearDuringImport','pending native data')]));await gate;}});h.fail(10);
  const searching=h.win.RCSMessages.search({});await new Promise(resolve=>setTimeout(resolve,0));await h.store.clear(owner);h.change({scope:'rcs-messages-changed',owner,cleared:true});h.fail(0);release();
  assert.equal((await searching).total,0);assert.equal(h.marks,0);assert.equal(await h.store.importState(owner),false);assert.equal((await h.win.RCSMessages.search({})).total,0);assert.equal(h.imports,1);h.dom.window.close();
});
