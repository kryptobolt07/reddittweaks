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
  assert.equal((await new Store({name:store.name}).search(owner)).records[0].text,'edited');assert.equal(writes,1,'only the changed room is rewritten');
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
function clientHarness({store,nativeImport,marked=false,ingestGate,readGate}={}){
  const dom=new JSDOM('',{runScripts:'outside-only'}),win=dom.window;win.TextEncoder=TextEncoder;
  for(const file of ['search-core.js','message-store.js'])win.eval(fs.readFileSync(`extension/${file}`,'utf8'));
  store ||= new win.RCSMessageStore.Store({indexedDB:null});let active=owner,changed,failures=0,imports=0,marks=0;const calls=[],nativeArgs=[];
  const emit=value=>win.document.dispatchEvent(new win.CustomEvent('rcs-message-cache-batch',{detail:JSON.stringify(value)}));
  win.RCSData={request(method,parameters){if(method==='identity-context')return {promise:Promise.resolve({owner:active})};if(method==='cache-native-history'){nativeArgs.push(parameters);imports++;return {promise:Promise.resolve().then(()=>nativeImport?.(emit)).then(result=>result?.available===false?result:{available:true})};}throw Error('Unexpected native method');}};
  win.chrome={runtime:{onMessage:{addListener(fn){changed=fn;}},async sendMessage(msg){calls.push(msg.action);if(msg.action==='stats'){const value=await store.stats(msg.owner,{committed:true});return {ok:true,...value,nativeImportComplete:marked || value.nativeImportComplete};}if(msg.action==='search'){const value=await store.search(msg.owner,{...msg,committed:true});await readGate;return {ok:true,...value};}if(msg.action==='room')return {ok:true,...await store.room(msg.owner,msg.roomId,undefined,{committed:true})};if(msg.action==='mark-native-import-complete'){marks++;return {ok:true,nativeImportComplete:await store.importState(msg.owner,true)};}if(msg.action==='ingest'){await ingestGate;if(failures-->0)return {ok:false,error:'Transient quota failure'};return {ok:true,...await store.ingest(msg)};}}}};
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
    let snapshots=0;const snapshot=store.snapshot.bind(store);store.snapshot=(...args)=>{snapshots++;return snapshot(...args);};
    const room=await Promise.race([store.room(owner,roomId,undefined,{committed:true}),new Promise((_,reject)=>timeout=setTimeout(()=>reject(Error('committed read waited for queued write')),1000))]);
    assert.equal(room.total,750);assert.equal(room.records.length,750);assert.equal(new Set(room.records.map(r=>r.id)).size,750);assert.equal(snapshots,1);
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
