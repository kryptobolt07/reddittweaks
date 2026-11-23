const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const {IDBFactory,IDBKeyRange}=require('fake-indexeddb');

const source=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');

function mountBridge(t,{idb,dbName,owner='@me:reddit.com',pages}){
  const dom=new JSDOM('<!doctype html><body></body>',{url:'https://chat.reddit.com/',runScripts:'outside-only'});
  t.after(()=>dom.window.close());
  const W=dom.window;
  W.TextEncoder=TextEncoder;W.indexedDB=idb;W.IDBKeyRange=IDBKeyRange;W.crypto=crypto;
  for(const file of ['extension/search-core.js','extension/message-store.js','extension/history-store.js','extension/native-identities.js','extension/data-client.js'])W.eval(source(file));
  const store=new W.RCSMessageStore.Store({indexedDB:idb,name:dbName});
  t.after(async()=>{(await store.db().catch(()=>null))?.close();});
  // Wire chrome.runtime to the shared v2 Store (simulating the worker across page reloads).
  const listeners=[];
  W.chrome={runtime:{id:'ext',onMessage:{addListener:fn=>listeners.push(fn)},async sendMessage(msg){
    if(msg.scope==='rcs-cache-health')return {ok:true};
    if(msg.scope==='rcs-directory')return {ok:true,token:'t'};
    if(msg.scope!=='rcs-messages')return {ok:true};
    if(msg.action==='ingest')return {ok:true,...await store.ingest(msg)};
    if(msg.action==='coverage')return {ok:true,...await store.coverage(msg.owner,msg.roomIds)};
    if(msg.action==='search')return {ok:true,...await store.search(msg.owner,{...msg,committed:true})};
    if(msg.action==='room')return {ok:true,...await store.room(msg.owner,msg.roomId,undefined,{committed:true})};
    if(msg.action==='stats')return {ok:true,...await store.stats(msg.owner,{committed:true})};
    if(msg.action==='summaries')return {ok:true,...await store.summaries(msg.owner,{committed:true})};
    if(msg.action==='mark-native-import-complete')return {ok:true,nativeImportComplete:await store.importState(msg.owner,true)};
    return {ok:true};
  }}};
  const calls=[];
  const app=W.document.createElement('rs-app'),matrix=W.document.createElement('rs-matrix-client'),history=W.document.createElement('rs-history');
  history.navigate=async()=>{};
  matrix.client={
    getUserId:()=>owner,
    isInitialSyncComplete:()=>true,
    getRooms:()=>[],
    getRoom:()=>null,
    getUser:()=>null,
    getAccountData:()=>null,
    on(){},off(){},
    http:{authedRequest:async(method,url,params={})=>{calls.push({method,url,params:{...params}});return pages(url,params);}}
  };
  app.append(matrix,history);W.document.body.append(app);
  W.eval(source('extension/page-bridge.js'));
  W.eval(source('extension/message-cache-client.js'));
  return {W,store,calls};
}

test('completed room re-verifies after reload with at most 1 /events request and preserves all persisted messages',async t=>{
  const idb=new IDBFactory(),dbName='phase-b-complete-'+crypto.randomUUID(),owner='@me:reddit.com',roomId='!r1:reddit.com';
  const ev=(seq,body,ts,extra={})=>({event_id:`$e${seq}`,room_id:roomId,type:'m.room.message',sender:owner,origin_server_ts:ts,seq_id:`m${seq}`,content:{body},...extra});
  let headEvents=[ev(5,'msg 5',5000),ev(4,'msg 4',4000)];
  const pages=(_url,params)=>{
    if(!params.seq)return {events:headEvents};
    const s=Number(params.seq);
    if(s===3)return {events:[ev(3,'msg 3',3000),ev(2,'msg 2',2000)]};
    if(s===1)return {events:[ev(1,'msg 1',1000)]};
    return {events:[]};
  };

  // Session 1: full 4-request history load (head -> seq 3 -> seq 1 -> seq 0 empty).
  const s1=mountBridge(t,{idb,dbName,owner,pages});
  const r1=await s1.W.RCSData.request('history',{roomId}).promise;
  assert.equal(r1.historyMeta.complete,true);
  assert.equal(s1.calls.length,4);
  assert.equal((await s1.store.room(owner,roomId)).total,5);

  // Session 2 (fresh page reload!): add 1 new message at head + 1 edit to older msg $e1!
  headEvents=[
    ev(7,'* edited oldest',7000,{content:{body:'* edited oldest','m.new_content':{body:'msg 1 updated'},'m.relates_to':{rel_type:'m.replace',event_id:'$e1'}}}),
    ev(6,'msg 6 brand new',6000),
    ev(5,'msg 5',5000)
  ];
  const s2=mountBridge(t,{idb,dbName,owner,pages});
  const r2=await s2.W.RCSData.request('history',{roomId}).promise;
  assert.equal(r2.historyMeta.complete,true,'room stays complete after reload');
  assert.equal(r2.historyMeta.resumedFromStore,true);
  assert.equal(s2.calls.length,1,'completed room re-verifies with at most 1 /events request after reload');

  // Persisted v2 store now has all 6 visible messages, with $e1 updated by the post-reload edit!
  const persisted=await s2.store.room(owner,roomId);
  assert.equal(persisted.total,6);
  assert.equal(persisted.records.find(r=>r.id==='$e1').text,'msg 1 updated');
  assert.equal(persisted.records.find(r=>r.id==='$e6').text,'msg 6 brand new');
});

test('partial room resumes directly from persisted lo-1 after reload without refetching covered pages',async t=>{
  const idb=new IDBFactory(),dbName='phase-b-partial-'+crypto.randomUUID(),owner='@me:reddit.com',roomId='!r2:reddit.com';
  const ev=(seq,body,ts)=>({event_id:`$e${seq}`,room_id:roomId,type:'m.room.message',sender:owner,origin_server_ts:ts,seq_id:`m${seq}`,content:{body}});
  const pages=(_url,params)=>{
    if(!params.seq)return {events:[ev(10,'ten',10000),ev(9,'nine',9000)]};
    const s=Number(params.seq);
    if(s===8)return {events:[ev(8,'eight',8000),ev(7,'seven',7000)]};
    if(s===6)return {events:[ev(6,'six',6000),ev(5,'five',5000)]};
    if(s===4)return {events:[ev(4,'four',4000),ev(3,'three',3000),ev(2,'two',2000),ev(1,'one',1000)]};
    return {events:[]};
  };

  // Seed persisted partial span [5, 10] (not bottom) in the v2 store.
  const s1=mountBridge(t,{idb,dbName,owner,pages});
  await s1.store.ingest({owner,roomId,events:[ev(10,'ten',10000),ev(9,'nine',9000),ev(8,'eight',8000),ev(7,'seven',7000),ev(6,'six',6000),ev(5,'five',5000)],span:{p:'',lo:5,hi:10,tLo:5000,tHi:10000,bottom:false,src:'history'}});

  // Fresh reload searches room: fetches head (10..9 touches [5,10]), JUMPS directly to seq=4 (skips 8 & 6!), then empty at 0!
  const s2=mountBridge(t,{idb,dbName,owner,pages});
  const r2=await s2.W.RCSData.request('history',{roomId}).promise;
  assert.equal(r2.historyMeta.complete,true);
  const seqsRequested=s2.calls.map(c=>c.params.seq ?? 'head');
  assert.deepEqual(seqsRequested,['head','4','0'],'jumped straight to lo-1 (4) without refetching 8 or 6');
  assert.equal((await s2.store.room(owner,roomId)).total,10);
});

test('thread root with unbottomed thread keeps room partial until thread replies finish',async t=>{
  const idb=new IDBFactory(),dbName='phase-b-thread-'+crypto.randomUUID(),owner='@me:reddit.com',roomId='!r3:reddit.com';
  const ev=(seq,body,ts,extra={})=>({event_id:`$e${seq}`,room_id:roomId,type:'m.room.message',sender:owner,origin_server_ts:ts,seq_id:`m${seq}`,content:{body},...extra});
  let serveThread=false;
  const pages=(_url,params)=>{
    if(params.parent){
      if(!serveThread)throw Object.assign(Error('temporary error'),{httpStatus:400});
      if(!params.seq)return {events:[{event_id:'$rep1',room_id:roomId,type:'m.room.message',sender:owner,origin_server_ts:3500,seq_id:'t.m2.1',content:{body:'thread reply','m.relates_to':{rel_type:'m.thread',event_id:'$e2'}}}]};
      return {events:[]};
    }
    if(!params.seq)return {events:[ev(2,'root msg',2000,{unsigned:{'m.relations':{'m.thread':{count:1}}}}),ev(1,'first',1000)]};
    return {events:[]};
  };

  const s1=mountBridge(t,{idb,dbName,owner,pages});
  await assert.rejects(s1.W.RCSData.request('history',{roomId}).promise);
  await s1.W.RCSMessages.flush();
  const cov1=(await s1.store.coverage(owner,[roomId])).rooms[roomId];
  assert.equal(cov1.coverage.complete,false,'unbottomed thread keeps room partial');

  // Reload and finish the thread!
  serveThread=true;
  const s2=mountBridge(t,{idb,dbName,owner,pages});
  const r2=await s2.W.RCSData.request('history',{roomId}).promise;
  assert.equal(r2.historyMeta.complete,true);
  assert.equal((await s2.store.room(owner,roomId)).total,3);
});
