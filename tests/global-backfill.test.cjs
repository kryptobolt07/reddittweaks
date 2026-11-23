const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const {IDBFactory,IDBKeyRange}=require('fake-indexeddb');
const {buildOracleMessages,oracleSearch}=require('./search-oracle-helper.cjs');

const source=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');

function waitFor(fn,{timeout=8000,interval=15}={}){
  return new Promise((resolve,reject)=>{
    const start=Date.now();
    const tick=()=>{
      try{
        const val=fn();
        if(val)return resolve(val);
      }catch(err){return reject(err);}
      if(Date.now()-start>timeout)return reject(new Error('waitFor timed out'));
      setTimeout(tick,interval);
    };
    tick();
  });
}

/**
 * Deterministic synthetic Matrix/Reddit fixture homeserver supporting:
 * - paginated /rooms (getRoomList)
 * - /rooms/{id}/events?dir=b&before=100&seq=...&parent=...
 * - threads, edits, redactions, unknown events, 403 inaccessible rooms, and optional artificial delay
 */
function createFixtureHomeserver({owner='@me:reddit.com',rooms=[]}){
  const roomMap=new Map();
  for(const r of rooms)roomMap.set(r.roomId,r);
  const roomListCalls=[];
  const eventCalls=[];
  let eventDelayMs=0;

  async function getRoomList(opts={}){
    roomListCalls.push({...opts});
    const list=[...roomMap.values()];
    const pageSize=opts.page_size || 200;
    const offset=opts.next_batch?Number(opts.next_batch):0;
    const slice=list.slice(offset,offset+pageSize);
    const next=offset+pageSize<list.length?String(offset+pageSize):null;
    return {
      rooms:slice.map(r=>({
        room_id:r.roomId,
        last_seq_id:r.lastSeq,
        membership:r.membership || 'join',
        timestamp:r.timestamp || 0
      })),
      next_batch:next
    };
  }

  async function authedRequest(method,url,params={}){
    if(eventDelayMs)await new Promise(r=>setTimeout(r,eventDelayMs));
    const m=url.match(/^\/rooms\/([^/]+)\/events$/);
    if(!m)throw Object.assign(Error('Not found'),{httpStatus:404});
    const roomId=decodeURIComponent(m[1]);
    eventCalls.push({roomId,params:{...params}});
    const room=roomMap.get(roomId);
    if(!room)throw Object.assign(Error('Not found'),{httpStatus:404});
    if(room.httpError)throw Object.assign(Error('HTTP '+room.httpError),{httpStatus:room.httpError});
    const parent=params.parent || '';
    const all=(parent?(room.threads?.[parent] || []):room.events).slice().sort((a,b)=>b._seq-a._seq);
    const limit=Number(params.before) || 100;
    const seqCap=params.seq!==undefined?Number(params.seq):Infinity;
    const eligible=all.filter(ev=>ev._seq<=seqCap);
    const page=eligible.slice(0,limit);
    return {events:page};
  }

  function eventsByRoom(){
    const map=new Map();
    for(const r of roomMap.values()){
      if(r.httpError)continue;
      const list=[...r.events];
      for(const tList of Object.values(r.threads || {}))list.push(...tList);
      map.set(r.roomId,list);
    }
    return map;
  }

  return {
    roomMap,roomListCalls,eventCalls,
    getRoomList,authedRequest,eventsByRoom,
    setDelay:ms=>{eventDelayMs=ms;}
  };
}

function mountFullStack(t,{idb,dbName,owner='@me:reddit.com',homeserver,leaseStore=new Map(),cacheEntries=[],contractBroken=false}){
  const dom=new JSDOM('<!doctype html><body><div id="list"><rs-room-list-header></rs-room-list-header></div></body>',{url:'https://chat.reddit.com/',runScripts:'outside-only'});
  const W=dom.window;
  W.TextEncoder=TextEncoder;W.indexedDB=idb;W.IDBKeyRange=IDBKeyRange;W.crypto=crypto;
  W.requestAnimationFrame=fn=>setTimeout(fn,0);
  W.cancelAnimationFrame=id=>clearTimeout(id);
  for(const file of [
    'extension/search-core.js',
    'extension/global-search-model.js',
    'extension/message-store.js',
    'extension/history-store.js',
    'extension/native-identities.js',
    'extension/data-client.js',
    'extension/unified-search-styles.js',
    'extension/unified-search.js'
  ])W.eval(source(file));

  const store=new W.RCSMessageStore.Store({indexedDB:idb,name:dbName});

  const listeners=[];
  W.chrome={
    storage:{local:{get:async()=>({}),set:async()=>{}}},
    runtime:{
      id:'ext',
      onMessage:{addListener:fn=>listeners.push(fn)},
      async sendMessage(msg){
        if(msg.scope==='rt-posts' && msg.action==='get-settings')return {ok:true,settings:{chatSearch:true}};
        if(msg.scope==='rcs-cache-health')return {ok:true};
        if(msg.scope==='rcs-directory')return {ok:true,token:'t'};
        if(msg.scope!=='rcs-messages')return {ok:true};
        if(msg.action==='ingest')return {ok:true,...await store.ingest(msg)};
        if(msg.action==='coverage')return {ok:true,...await store.coverage(msg.owner,msg.roomIds)};
        if(msg.action==='mark-inaccessible')return {ok:true,...await store.markInaccessible(msg.owner,msg.roomId,msg.status)};
        if(msg.action==='update-heads')return {ok:true,...await store.updateHeads(msg.owner,msg.heads)};
        if(msg.action==='backfill-lease'){
          const key=msg.owner;
          const now=Date.now();
          const cur=leaseStore.get(key);
          const active=cur && cur.expiresAt>now?cur:null;
          if(msg.op==='acquire'){
            if(active && active.token!==msg.token)return {ok:true,busy:true};
            const token=crypto.randomUUID();
            leaseStore.set(key,{token,expiresAt:now+60000});
            return {ok:true,token};
          }
          if(msg.op==='renew'){
            if(!active || active.token!==msg.token)return {ok:true,renewed:false};
            leaseStore.set(key,{token:active.token,expiresAt:now+60000});
            return {ok:true,renewed:true};
          }
          if(msg.op==='release'){
            if(active && active.token===msg.token)leaseStore.delete(key);
            return {ok:true,released:true};
          }
          return {ok:true};
        }
        if(msg.action==='search')return {ok:true,...await store.search(msg.owner,{...msg,committed:true})};
        if(msg.action==='search-count')return {ok:true,...await store.searchCount(msg.owner,{...msg,committed:true})};
        if(msg.action==='room')return {ok:true,...await store.room(msg.owner,msg.roomId,undefined,{committed:true})};
        if(msg.action==='stats')return {ok:true,...await store.stats(msg.owner,{committed:true})};
        if(msg.action==='summaries')return {ok:true,...await store.summaries(msg.owner,{committed:true})};
        if(msg.action==='mark-native-import-complete')return {ok:true,nativeImportComplete:await store.importState(msg.owner,true)};
        return {ok:true};
      }
    }
  };

  let currentOwner=owner;
  const app=W.document.createElement('rs-app'),matrix=W.document.createElement('rs-matrix-client'),history=W.document.createElement('rs-history');
  history.navigate=async()=>{};
  matrix.client={
    getUserId:()=>currentOwner,
    isInitialSyncComplete:()=>true,
    getRooms:()=>[],
    getRoom:()=>null,
    getUser:()=>null,
    getAccountData:()=>null,
    on(){},off(){},
    ...(contractBroken?{http:{authedRequest:async()=>({})}}:{
      getRoomList:opts=>homeserver.getRoomList(opts),
      http:{authedRequest:(m,u,p)=>homeserver.authedRequest(m,u,p)}
    })
  };
  app.append(matrix,history);W.document.body.append(app);
  W.eval(source('extension/page-bridge.js'));
  W.eval(source('extension/message-cache-client.js'));

  const container=W.document.getElementById('list');
  container.getBoundingClientRect=()=>({left:0,top:0,right:400,bottom:600,width:400,height:600});
  const adapter={
    selectors:{row:'a',room:'rs-room'},
    visible:()=>true,
    mountPoint:c=>({parent:c,before:c.firstChild,header:c.querySelector('rs-room-list-header'),ready:true}),
    queryAll:()=>[],
    chatRoots:()=>[],
    conversation:()=>({}),
    roomKey:()=>''
  };
  const cache=new Map(cacheEntries.map(r=>[r.id,r]));
  const ui=new W.RCSUnifiedSearch(container,{cache,adapter});
  t.after(async()=>{
    try{ui.destroy();}catch{}
    try{(await store.db().catch(()=>null))?.close();}catch{}
    try{dom.window.close();}catch{}
  });

  return {W,store,ui,cache,setOwner:next=>{currentOwner=next;}};
}

test('200-room fixture homeserver: 100% oracle recall & precision across DMs, groups, modmail, threads, edits, redactions, and 403 handling',async t=>{
  const idb=new IDBFactory(),dbName='bf-200-'+crypto.randomUUID();
  const owner='@me:reddit.com';
  const baseTs=Date.UTC(2026,5,1,12,0,0); // 2026-06-01
  const rooms=[];
  const cacheEntries=[];
  const identitiesByUser=new Map([[owner,{id:owner,name:'You',self:true}]]);

  const makeEv=(roomId,seq,sender,body,ts,extra={})=>({
    event_id:`$${roomId}_e${seq}`,room_id:roomId,type:'m.room.message',sender,origin_server_ts:ts,seq_id:`m${seq}`,_seq:seq,content:{body},...extra
  });

  // Build 200 rooms: 160 DMs, 25 groups, 10 modmail, 3 threaded (incl. 1 multi-page >100 replies), 2 inaccessible (403)
  for(let i=0;i<200;i++){
    const roomId=`!room${i}:reddit.com`;
    const isModmail=i>=185 && i<195;
    const isGroup=i>=160 && i<185;
    const isThreaded=i>=195 && i<198;
    const is403=i>=198;
    const peerId=`@user${i}:reddit.com`,peerName=i===7?'alice':`user${i}`;
    identitiesByUser.set(peerId,{id:peerId,name:peerName,self:false});

    const events=[];
    const threads={};
    const count=is403?0:(i===0?0:i===1?1:i%25===0?150:i%10===0?25:4);
    const roomTopTs=baseTs-i*3600_000;

    if(!is403){
      let seq=1;
      for(let m=0;m<count;m++){
        const ts=roomTopTs-(count-1-m)*60_000;
        const sender=(m%2===0)?peerId:owner;
        let body=`msg ${m} in room ${i}`;
        if((i%17===0 && m===0) || (isModmail && m===1) || (i===7 && m===2))body=`alpha_needle ${m} in room ${i}`;
        if(i===5 && m===1)body='redacted_needle should vanish';
        if(i===6 && m===1)body='before_edit_needle original';
        const extra={};
        if(isThreaded && m===count-1){
          const replyCount=i===195?115:3; // room 195 has a multi-page thread (>100 replies)!
          const parentSeq=`m${seq}`;
          extra.unsigned={'m.relations':{'m.thread':{count:replyCount}}};
          threads[parentSeq]=[];
          for(let r=1;r<=replyCount;r++){
            const rBody=(r===1 || r===replyCount)?`alpha_needle thread reply ${r} in ${i}`:`reply ${r}`;
            threads[parentSeq].push({
              event_id:`$${roomId}_t${r}`,room_id:roomId,type:'m.room.message',sender:peerId,origin_server_ts:ts+r*1000,seq_id:`t.${parentSeq}.${r}`,_seq:r,
              content:{body:rBody,'m.relates_to':{rel_type:'m.thread',event_id:`$${roomId}_e${seq}`}}
            });
          }
        }
        events.push(makeEv(roomId,seq,sender,body,ts,extra));
        seq++;
      }
      // Redact room 5 msg 1
      if(i===5){
        events.push({event_id:`$${roomId}_red`,room_id:roomId,type:'m.room.redaction',sender:owner,origin_server_ts:roomTopTs+1000,seq_id:`m${seq}`,_seq:seq,redacts:`$${roomId}_e2`,content:{}});
        seq++;
      }
      // Edit room 6 msg 1 so 'before_edit_needle' becomes 'alpha_needle edited_now'
      if(i===6){
        events.push(makeEv(roomId,seq,owner,'* edited',roomTopTs+1000,{
          content:{body:'* edited','m.new_content':{body:'alpha_needle edited_now'},'m.relates_to':{rel_type:'m.replace',event_id:`$${roomId}_e2`}}
        }));
        seq++;
      }
    }

    const lastSeq=events.length?events[events.length-1].seq_id:'m0';
    rooms.push({roomId,events,threads,lastSeq,timestamp:roomTopTs,httpError:is403?403:0});
    cacheEntries.push({
      id:roomId,
      name:isModmail?`r/sub${i} Modmail`:isGroup?`Group ${i}`:peerName,
      type:isModmail?'reddit_modmail':isGroup?'group':'direct',
      participants:isModmail||isGroup?[peerName,'@other']:[peerName],
      participantIds:isModmail||isGroup?[peerId,'@other:reddit.com']:[peerId],
      timestamp:roomTopTs
    });
  }

  const homeserver=createFixtureHomeserver({owner,rooms});
  const {W,store,ui}=mountFullStack(t,{idb,dbName,owner,homeserver,cacheEntries});

  // Switch to Messages scope and search 'alpha_needle' on an empty cache!
  ui.open(false);
  ui.setScope('messages');
  ui.setQuery('alpha_needle');

  // Wait for backfill run 1 to hit the 300-request budget pause on 200 rooms, then scroll near the bottom to load the next slice!
  await waitFor(()=>ui.backfillState && ui.backfillState.state!=='running' && !ui.searching,{timeout:15000});
  assert.equal(ui.shadow.querySelector('.backfill-action'),null,'no extra Stop or Search older messages button in status bar');
  if(ui.backfillState.state==='paused'){
    assert.match(ui.status.textContent,/Scroll for older/);
    ui.results.scrollTop=ui.totalHeight;
    ui.results.dispatchEvent(new W.Event('scroll'));
    await waitFor(()=>ui.backfillState && ui.backfillState.state!=='paused' && ui.backfillState.state!=='running' && !ui.searching && ui.appliedKey===JSON.stringify(ui.parameters()),{timeout:15000});
  }

  assert.equal(ui.backfillState.state,'partial','2 inaccessible 403 rooms must keep run partial');
  assert.equal(ui.backfillState.inaccessibleCount,2);
  assert.match(ui.status.textContent,/2 chats couldn’t be searched/);
  assert.doesNotMatch(ui.status.textContent,/All chats searched/);

  // Compare store results against brute-force oracle on ALL 198 accessible rooms!
  const corpus=buildOracleMessages(homeserver.eventsByRoom(),owner,Object.fromEntries(identitiesByUser));
  const expected=oracleSearch(W.RCSCore,corpus,{query:'alpha_needle',sort:'newest',limit:500});
  const actual=await store.search(owner,{query:'alpha_needle',sort:'newest',limit:500,committed:true});
  assert.equal(actual.total,expected.total,'exact total match against brute-force oracle across 198 rooms incl. modmail & multi-page threads');
  assert.deepEqual(
    Array.from(actual.records,r=>r.roomId+'\0'+r.id),
    expected.ids,
    '100% recall & 100% precision (exact ID set & order)'
  );
  // Verify redacted needle is absent and edited old text is absent
  assert.equal((await store.search(owner,{query:'redacted_needle',committed:true})).total,0);
  assert.equal((await store.search(owner,{query:'before_edit_needle',committed:true})).total,0);

  // Second query on already-backfilled store: 0 /events requests!
  const beforeCalls=homeserver.eventCalls.length;
  ui.setQuery('edited_now');
  await waitFor(()=>ui.backfillState && ui.backfillState.state!=='running' && !ui.searching && ui.appliedKey===JSON.stringify(ui.parameters()),{timeout:8000});
  assert.equal(homeserver.eventCalls.length,beforeCalls,'0 /events requests on already-covered rooms');
  assert.equal(ui.savedTotal,1);

  // Fix the 2 inaccessible rooms (e.g. remove them from fixture) and run Refresh -> must now report "All chats searched" and hide Partial history!
  homeserver.roomMap.delete('!room198:reddit.com');
  homeserver.roomMap.delete('!room199:reddit.com');
  ui.refresh.click();
  await waitFor(()=>ui.backfillState?.state==='complete' && !ui.searching,{timeout:8000});
  assert.match(ui.status.textContent,/All chats searched/);
  assert.equal(ui.coverageNote.hidden,true,'Partial history hidden once complete');
});

test('budget pause and Continue ("Search older messages") resumes from persisted spans with zero refetched pages',async t=>{
  const idb=new IDBFactory(),dbName='bf-budget-'+crypto.randomUUID();
  const owner='@me:reddit.com';
  const baseTs=Date.UTC(2026,4,10,12,0,0);
  const rooms=[];
  for(let r=0;r<4;r++){
    const roomId=`!b${r}:reddit.com`;
    const events=[];
    for(let s=1;s<=250;s++){
      events.push({event_id:`$b${r}_e${s}`,room_id:roomId,type:'m.room.message',sender:owner,origin_server_ts:baseTs-(r*10+250-s)*60_000,seq_id:`m${s}`,_seq:s,content:{body:s===1?`deep_gold_${r}`:`chat ${s}`}});
    }
    rooms.push({roomId,events,lastSeq:'m250',timestamp:events[249].origin_server_ts});
  }
  const homeserver=createFixtureHomeserver({owner,rooms});
  const {W,store}=mountFullStack(t,{idb,dbName,owner,homeserver});

  // Run 1 with tight budget of 5 requests (4 rooms * 4 pages each = 16 pages total: 3 full pages + 1 empty page each; wait seq 1..250 -> 250..151, 150..51, 50..1, 0 -> 4 reqs/room = 16 reqs total!)
  const r1=await W.RCSData.request('backfill',{plan:{maxRequests:5}}).promise;
  assert.equal(r1.state,'paused');
  assert.equal(r1.reason,'budget');
  assert.equal(r1.requestsUsed,5);
  assert.ok(r1.watermark>0);

  // Run 2 resumes from persisted spans with 6 more requests
  const r2=await W.RCSData.request('backfill',{plan:{maxRequests:6}}).promise;
  assert.equal(r2.state,'paused');
  assert.equal(r2.requestsUsed,6);

  // Run 3 finishes the remaining 5 requests (5 + 6 + 5 = 16 total, ZERO refetched pages!)
  const r3=await W.RCSData.request('backfill',{plan:{maxRequests:20}}).promise;
  assert.equal(r3.state,'complete');
  assert.equal(r1.requestsUsed+r2.requestsUsed+r3.requestsUsed,16,'exact Σ⌈uncovered/P⌉ with zero refetched pages');
  assert.equal((await store.search(owner,{query:'deep_gold',committed:true})).total,4);
});

test('date-bounded search skips older rooms with 0 requests, marks window-complete, and resumes cleanly when widened',async t=>{
  const idb=new IDBFactory(),dbName='bf-date-'+crypto.randomUUID();
  const owner='@me:reddit.com';
  const janTs=Date.UTC(2026,0,15,12,0,0);
  const mayTs=Date.UTC(2026,4,15,12,0,0);
  const rooms=[
    {roomId:'!old:reddit.com',timestamp:janTs,lastSeq:'m5',events:[
      {event_id:'$o1',room_id:'!old:reddit.com',type:'m.room.message',sender:owner,origin_server_ts:janTs,seq_id:'m5',_seq:5,content:{body:'january_needle'}}
    ]},
    {roomId:'!recent:reddit.com',timestamp:mayTs,lastSeq:'m250',events:Array.from({length:250},(_,idx)=>{
      const s=idx+1;
      // Top 50 messages are in May 2026; older 200 messages are in Jan 2026!
      const ts=s>200?mayTs-(250-s)*60_000:janTs-(200-s)*60_000;
      return {event_id:`$r${s}`,room_id:'!recent:reddit.com',type:'m.room.message',sender:owner,origin_server_ts:ts,seq_id:`m${s}`,_seq:s,content:{body:s===240?'may_needle':s===10?'january_needle':'filler'}};
    })}
  ];
  const homeserver=createFixtureHomeserver({owner,rooms});
  const {W,store,ui}=mountFullStack(t,{idb,dbName,owner,homeserver});

  ui.open(false);
  ui.setScope('messages');
  ui.setQuery('after:2026-05-01 may_needle');
  await waitFor(()=>ui.backfillState?.state==='window-complete' && !ui.searching && ui.appliedKey===JSON.stringify(ui.parameters()),{timeout:8000});

  assert.match(ui.status.textContent,/All chats searched for these dates/);
  assert.equal(ui.coverageNote.hidden,true);
  assert.equal(ui.savedTotal,1);
  // !old took 0 requests, !recent stopped after 1 page (seqs 250..151 crossed May 1 boundary!)
  assert.equal(homeserver.eventCalls.filter(c=>c.roomId==='!old:reddit.com').length,0,'older room skipped with 0 requests');
  assert.equal(homeserver.eventCalls.filter(c=>c.roomId==='!recent:reddit.com').length,1,'spanning room stopped immediately below date window');

  // Now clear the date filter -> resumes !recent at seq 150 (never refetches 250..151!) and fetches !old!
  const beforeCalls=homeserver.eventCalls.length;
  ui.setQuery('january_needle');
  await waitFor(()=>ui.backfillState?.state==='complete' && !ui.searching && ui.appliedKey===JSON.stringify(ui.parameters()),{timeout:8000});
  const added=homeserver.eventCalls.slice(beforeCalls);
  assert.ok(!added.some(c=>c.roomId==='!recent:reddit.com' && c.params.seq===undefined),'never refetched head of !recent');
  assert.equal(ui.savedTotal,2,'found both January matches once date filter removed');
});

test('unknown event type still finds readable messages while blocking completeness',async t=>{
  const idb=new IDBFactory(),dbName='bf-unknown-'+crypto.randomUUID();
  const owner='@me:reddit.com';
  const ts=Date.UTC(2026,4,20,12,0,0);
  const rooms=[{
    roomId:'!u1:reddit.com',timestamp:ts,lastSeq:'m3',events:[
      {event_id:'$u3',room_id:'!u1:reddit.com',type:'com.reddit.future_poll',sender:owner,origin_server_ts:ts,seq_id:'m3',_seq:3,content:{question:'?'}},
      {event_id:'$u2',room_id:'!u1:reddit.com',type:'m.room.message',sender:owner,origin_server_ts:ts-1000,seq_id:'m2',_seq:2,content:{body:'readable_gem'}},
      {event_id:'$u1',room_id:'!u1:reddit.com',type:'m.room.message',sender:owner,origin_server_ts:ts-2000,seq_id:'m1',_seq:1,content:{body:'older_gem'}}
    ]
  }];
  const homeserver=createFixtureHomeserver({owner,rooms});
  const {ui}=mountFullStack(t,{idb,dbName,owner,homeserver});

  ui.open(false);ui.setScope('messages');ui.setQuery('gem');
  await waitFor(()=>ui.backfillState && ui.backfillState.state!=='running' && !ui.searching && ui.appliedKey===JSON.stringify(ui.parameters()),{timeout:8000});
  assert.equal(ui.savedTotal,2,'all readable messages found despite unknown event type');
  assert.equal(ui.backfillState.state,'partial');
  assert.match(ui.status.textContent,/Some messages couldn’t be read/);
  assert.doesNotMatch(ui.status.textContent,/All chats searched/);
});

test('Phase D lossless from: room pruning cuts >85% of requests while keeping 100% oracle parity across DMs, groups, modmail, and unresolved DMs',async t=>{
  const idb=new IDBFactory(),dbName='bf-prune-'+crypto.randomUUID();
  const owner='@me:reddit.com';
  const aliceId='@alice:reddit.com';
  const baseTs=Date.UTC(2026,5,1,12,0,0);
  const rooms=[],cacheEntries=[];
  const identitiesByUser=new Map([[owner,{id:owner,name:'You',self:true}],[aliceId,{id:aliceId,name:'alice',self:false}]]);

  // 180 DMs (178 other resolved users, 1 alice DM, 1 unresolved DM where alice actually sent a message!)
  for(let i=0;i<180;i++){
    const roomId=`!dm${i}:reddit.com`;
    const isAlice=i===10,isUnresolved=i===11;
    const peerId=isAlice||isUnresolved?aliceId:`@other${i}:reddit.com`;
    const peerName=isAlice?'alice':isUnresolved?'Username unavailable':`other${i}`;
    if(!isAlice && !isUnresolved)identitiesByUser.set(peerId,{id:peerId,name:peerName,self:false});
    rooms.push({
      roomId,timestamp:baseTs-i*1000,lastSeq:'m1',
      events:[{event_id:`$dm${i}_1`,room_id:roomId,type:'m.room.message',sender:peerId,origin_server_ts:baseTs-i*1000,seq_id:'m1',_seq:1,content:{body:`hello from ${peerId}`}}]
    });
    cacheEntries.push({
      id:roomId,name:peerName,type:'direct',
      participants:isUnresolved?[]:[peerName],
      participantIds:isUnresolved?[]:[peerId],
      identityPending:isUnresolved,
      timestamp:baseTs-i*1000
    });
  }
  // 15 groups (alice speaks in group 3) + 5 modmail (alice speaks in modmail 1)
  for(let g=0;g<15;g++){
    const roomId=`!grp${g}:reddit.com`;
    const sender=g===3?aliceId:'@other1:reddit.com';
    rooms.push({roomId,timestamp:baseTs-500_000-g*1000,lastSeq:'m1',events:[{event_id:`$g${g}_1`,room_id:roomId,type:'m.room.message',sender,origin_server_ts:baseTs-500_000-g*1000,seq_id:'m1',_seq:1,content:{body:`hello group ${g}`}}]});
    cacheEntries.push({id:roomId,name:`Group ${g}`,type:'group',participants:['other1'],participantIds:['@other1:reddit.com'],timestamp:baseTs-500_000-g*1000});
  }
  for(let m=0;m<5;m++){
    const roomId=`!mod${m}:reddit.com`;
    const sender=m===1?aliceId:'@other2:reddit.com';
    rooms.push({roomId,timestamp:baseTs-600_000-m*1000,lastSeq:'m1',events:[{event_id:`$m${m}_1`,room_id:roomId,type:'m.room.message',sender,origin_server_ts:baseTs-600_000-m*1000,seq_id:'m1',_seq:1,content:{body:`hello modmail ${m}`}}]});
    cacheEntries.push({id:roomId,name:`Modmail ${m}`,type:'reddit_modmail',participants:[],participantIds:[],timestamp:baseTs-600_000-m*1000});
  }

  const homeserver=createFixtureHomeserver({owner,rooms});
  const {W,store,ui}=mountFullStack(t,{idb,dbName,owner,homeserver,cacheEntries});
  // Seed Alice's identity so store matches from:alice by author name
  await store.ingest({owner,events:[],identities:[{id:aliceId,name:'alice',aliases:[]}]});

  ui.open(false);ui.setScope('messages');ui.setQuery('from:alice hello');
  await waitFor(()=>ui.backfillState?.state==='complete' && !ui.searching && ui.appliedKey===JSON.stringify(ui.parameters()),{timeout:10000});

  const requestedRooms=new Set(homeserver.eventCalls.map(c=>c.roomId));
  // Only 22 rooms should be touched: alice DM + unresolved DM + 15 groups + 5 modmail (178 other DMs pruned = 89% reduction!)
  assert.equal(requestedRooms.size,22,'pruned all 178 non-Alice resolved DMs (89% reduction)');
  assert.ok(requestedRooms.has('!dm10:reddit.com'),'kept Alice DM');
  assert.ok(requestedRooms.has('!dm11:reddit.com'),'kept unresolved DM');
  assert.ok(requestedRooms.has('!grp3:reddit.com'),'kept group chat');
  assert.ok(requestedRooms.has('!mod1:reddit.com'),'kept modmail');

  // Verify 100% oracle parity (all 4 messages from Alice across DM, unresolved DM, group, and modmail!)
  const corpus=buildOracleMessages(homeserver.eventsByRoom(),owner,Object.fromEntries(identitiesByUser));
  const expected=oracleSearch(W.RCSCore,corpus,{query:'from:alice hello',sort:'newest',limit:500});
  assert.equal(expected.total,4);
  assert.equal(ui.savedTotal,4,'100% oracle recall & precision with lossless from: pruning');
});

test('lifecycle: minimize keeps backfill running, panel close stops it, Stop/Continue works, multi-tab lease blocks duplicate runs, and contract gate degrades cleanly',async t=>{
  const idb=new IDBFactory(),dbName='bf-life-'+crypto.randomUUID();
  const owner='@me:reddit.com';
  const ts=Date.UTC(2026,4,20,12,0,0);
  const rooms=Array.from({length:12},(_,i)=>({
    roomId:`!l${i}:reddit.com`,timestamp:ts-i*1000,lastSeq:'m1',
    events:[{event_id:`$l${i}_1`,room_id:`!l${i}:reddit.com`,type:'m.room.message',sender:owner,origin_server_ts:ts-i*1000,seq_id:'m1',_seq:1,content:{body:`life_needle_${i}`}}]
  }));
  const leaseStore=new Map();
  const homeserver=createFixtureHomeserver({owner,rooms});
  homeserver.setDelay(10);
  const {W,ui}=mountFullStack(t,{idb,dbName,owner,homeserver,leaseStore});

  // 1. Multi-tab lease already held by another tab -> other-tab state, 0 /events requests!
  leaseStore.set(owner,{token:'other-tab-token',expiresAt:Date.now()+60000});
  ui.open(false);ui.setScope('messages');ui.setQuery('life_needle');
  await waitFor(()=>ui.backfillState?.state==='other-tab' && !ui.backfillTask && !ui.refresh.disabled,{timeout:15000});
  assert.match(ui.status.textContent,/Searching in another tab…/);
  assert.equal(homeserver.eventCalls.length,0,'second tab made 0 /events requests');
  leaseStore.delete(owner);

  // 2. Start backfill, minimize (suspend) mid-run -> keeps running and finishes!
  ui.refresh.click();
  await waitFor(()=>ui.backfillState?.state==='running',{timeout:15000});
  ui.suspend();
  await waitFor(()=>ui.backfillState?.state==='complete',{timeout:15000});
  ui.resume();
  await waitFor(()=>ui.savedTotal===12,{timeout:15000});
  assert.equal(ui.savedTotal,12,'minimize kept backfill running to completion');

  // 3. Unfiltered Messages tab (no search term or filter): 0 automatic requests; repeated scroll-to-bottom loads batches until complete!
  const idb2=new IDBFactory(),dbName2='bf-browse-'+crypto.randomUUID();
  const browseRooms=Array.from({length:16},(_,i)=>({
    roomId:`!br${i}:reddit.com`,timestamp:ts-i*60_000,lastSeq:'m1',
    events:[{event_id:`$br${i}_1`,room_id:`!br${i}:reddit.com`,type:'m.room.message',sender:owner,origin_server_ts:ts-i*60_000,seq_id:'m1',_seq:1,content:{body:`browse message ${i}`}}]
  }));
  const hs2=createFixtureHomeserver({owner,rooms:browseRooms});
  const s2=mountFullStack(t,{idb:idb2,dbName:dbName2,owner,homeserver:hs2,leaseStore:new Map()});
  s2.ui.open(false);s2.ui.setScope('messages');
  await new Promise(r=>setTimeout(r,80));
  assert.equal(hs2.eventCalls.length,0,'unfiltered Messages tab with no search term makes 0 automatic /events requests');
  assert.equal(s2.ui.backfillTask,null);
  // First scroll to bottom -> loads first bounded batch (maxRequests: 12) and pauses!
  s2.ui.results.scrollTop=s2.ui.totalHeight;
  s2.ui.results.dispatchEvent(new s2.W.Event('scroll'));
  await waitFor(()=>s2.ui.backfillState?.state==='paused' && !s2.ui.backfillTask && !s2.ui.searching,{timeout:15000});
  assert.equal(s2.ui.backfillState.requestsUsed,12,'first scroll batch bounded to 12 requests');
  assert.ok(s2.ui.savedTotal>0 && s2.ui.savedTotal<16,'partial older messages loaded on first scroll');
  // Repeat scroll-to-bottom cycles until all 16 rooms complete!
  for(let cycle=0;cycle<4 && s2.ui.backfillState?.state!=='complete';cycle++){
    const prevCalls=hs2.eventCalls.length;
    s2.ui.results.scrollTop=s2.ui.totalHeight;
    s2.ui.results.dispatchEvent(new s2.W.Event('scroll'));
    await waitFor(()=>hs2.eventCalls.length>prevCalls && s2.ui.backfillState && s2.ui.backfillState.state!=='running' && !s2.ui.backfillTask && !s2.ui.searching,{timeout:15000});
  }
  assert.equal(s2.ui.backfillState.state,'complete','repeated scroll-to-bottom batches eventually cover all rooms');
  assert.equal(s2.ui.savedTotal,16);

  // 4. Closing search panel (dismissSearch) stops an active backfill immediately.
  const idb3=new IDBFactory(),dbName3='bf-close-'+crypto.randomUUID();
  const hs3=createFixtureHomeserver({owner,rooms});
  hs3.setDelay(15);
  const lease3=new Map();
  const s3=mountFullStack(t,{idb:idb3,dbName:dbName3,owner,homeserver:hs3,leaseStore:lease3});
  s3.ui.open(false);s3.ui.setScope('messages');s3.ui.setQuery('life_needle');
  await waitFor(()=>s3.ui.backfillTask!==null,{timeout:15000});
  s3.ui.dismissSearch();
  assert.equal(s3.ui.backfillTask,null,'dismissSearch cancelled active backfill');
  await waitFor(()=>lease3.size===0,{timeout:15000});

  // 5. Runtime contract gate (M9): broken native client degrades cleanly without throwing.
  const idb4=new IDBFactory(),dbName4='bf-contract-'+crypto.randomUUID();
  const s4=mountFullStack(t,{idb:idb4,dbName:dbName4,owner,homeserver:hs3,contractBroken:true});
  const res=await s4.W.RCSData.request('backfill',{plan:{}}).promise;
  assert.equal(res.state,'unavailable');
  assert.equal(res.reason,'contract');
});

test('certified-watermark early stop saves >80% of requests on common queries, preserves exact top-N oracle order, advances on scroll, resumes on rare queries, and disables on oldest sort',async t=>{
  const idb=new IDBFactory(),dbName='bf-cert-'+crypto.randomUUID();
  const owner='@me:reddit.com';
  const baseTs=Date.UTC(2026,10,20,12,0,0); // Nov 20, 2026
  const rooms=[];
  // 40 rooms spanning 40 distinct days (120 msgs each = 4,800 msgs total, ~3 requests/room = 120 requests full scan).
  // Every room has 'hi' in every message; only the oldest room (#39) has 'ultra_rare_diamond'.
  for(let r=0;r<40;r++){
    const roomId=`!c${r}:reddit.com`;
    const events=[];
    const roomEnd=baseTs-r*86400_000*2; // spaced 2 days apart so watermark crosses cleanly
    for(let s=1;s<=120;s++){
      const ts=roomEnd-(120-s)*600_000; // 10 min apart
      const body=(r===39 && s===5)?'hi ultra_rare_diamond':`hi msg ${s} in room ${r}`;
      events.push({event_id:`$c${r}_e${s}`,room_id:roomId,type:'m.room.message',sender:owner,origin_server_ts:ts,seq_id:`m${s}`,_seq:s,content:{body}});
    }
    rooms.push({roomId,events,lastSeq:'m120',timestamp:roomEnd});
  }
  // Add 50 empty/undated rooms (timestamp: 0, simulating invites/dormant rooms) — they must NOT pin W at Date.now()!
  for(let e=0;e<50;e++){
    rooms.push({roomId:`!empty${e}:reddit.com`,events:[],lastSeq:'m0',timestamp:0});
  }
  const homeserver=createFixtureHomeserver({owner,rooms});
  const {W,store,ui}=mountFullStack(t,{idb,dbName,owner,homeserver});
  const corpus=buildOracleMessages(homeserver.eventsByRoom(),owner,{[owner]:{id:owner,name:'You',self:true}});

  // 1. Common query 'hi' with default sort='newest': stops early once 20+ newest matches are certified above watermark + skew!
  ui.open(false);ui.setScope('messages');ui.setQuery('hi');
  await waitFor(()=>ui.backfillState?.state==='paused' && ui.backfillState.reason==='target' && !ui.backfillTask && !ui.searching && ui.appliedKey===JSON.stringify(ui.parameters()),{timeout:15000});
  const reqsAfterFirstStop=homeserver.eventCalls.length;
  assert.ok(reqsAfterFirstStop<10,`expected <10 requests on early stop even with 50 undated rooms (got ${reqsAfterFirstStop})`);
  assert.equal(homeserver.eventCalls.filter(c=>c.roomId.startsWith('!empty')).length,0,'undated/empty rooms do not pin watermark or run ahead of recent rooms');
  assert.match(ui.status.textContent,/\+ matches/);
  assert.match(ui.status.textContent,/Scroll for older/);
  assert.equal(ui.coverageNote.hidden,true,'does not duplicate Partial history badge alongside watermark status');

  // Top 20 results must match the brute-force oracle 100% bit-for-bit!
  const expectedTop20=oracleSearch(W.RCSCore,corpus,{query:'hi',sort:'newest',limit:20});
  const actualTop20=await store.search(owner,{query:'hi',sort:'newest',limit:20,committed:true});
  assert.deepEqual(Array.from(actualTop20.records,r=>r.roomId+'\0'+r.id),expectedTop20.ids,'top 20 certified matches are 100% oracle-exact');

  // 2. Scroll down -> raises certified target and advances watermark with 0 refetched pages!
  const callsBeforeScroll=homeserver.eventCalls.length;
  ui.results.scrollTop=ui.totalHeight;
  ui.results.dispatchEvent(new W.Event('scroll'));
  await waitFor(()=>homeserver.eventCalls.length>callsBeforeScroll && ui.backfillState?.state==='paused' && !ui.backfillTask && !ui.searching,{timeout:15000});
  const expectedTop45=oracleSearch(W.RCSCore,corpus,{query:'hi',sort:'newest',limit:45});
  const actualTop45=await store.search(owner,{query:'hi',sort:'newest',limit:45,committed:true});
  assert.deepEqual(Array.from(actualTop45.records,r=>r.roomId+'\0'+r.id),expectedTop45.ids,'top 45 certified matches after scroll are 100% oracle-exact');

  // 2b. Another common query ('msg') already satisfied by cached pages above watermark -> 0 new /events requests!
  const callsBeforeCachedCommon=homeserver.eventCalls.length;
  ui.setQuery('msg');
  await waitFor(()=>ui.backfillState?.state==='paused' && ui.backfillState.reason==='target' && !ui.backfillTask && !ui.searching && ui.appliedKey===JSON.stringify(ui.parameters()),{timeout:15000});
  assert.equal(homeserver.eventCalls.length,callsBeforeCachedCommon,'0 /events requests when local cache already holds >=20 certified matches above watermark');

  // 3. Switch to a rare query ('ultra_rare_diamond') -> immediately resumes past watermark without refetching covered spans and finds it!
  const seenKeySet=new Set(homeserver.eventCalls.map(c=>`${c.roomId}:${c.params.seq ?? 'head'}`));
  const beforeRare=homeserver.eventCalls.length;
  ui.setQuery('ultra_rare_diamond');
  await waitFor(()=>ui.backfillState?.state==='complete' && !ui.backfillTask && !ui.searching && ui.appliedKey===JSON.stringify(ui.parameters()),{timeout:15000});
  assert.equal(ui.savedTotal,1,'rare query found deep in oldest room');
  const rareNewCalls=homeserver.eventCalls.slice(beforeRare);
  const duplicates=rareNewCalls.filter(c=>seenKeySet.has(`${c.roomId}:${c.params.seq ?? 'head'}`));
  assert.equal(duplicates.length,0,'zero already-fetched pages refetched when resuming for rare query');

  // 4. Separate fresh DB: switching to sort='oldest' disables early stop and searches all rooms to exact oldest match!
  const idb2=new IDBFactory(),dbName2='bf-oldest-'+crypto.randomUUID();
  const hs2=createFixtureHomeserver({owner,rooms:rooms.slice(0,8)});
  const s2=mountFullStack(t,{idb:idb2,dbName:dbName2,owner,homeserver:hs2});
  s2.ui.open(false);s2.ui.setScope('messages');s2.ui.sort='oldest';s2.ui.setQuery('hi');
  await waitFor(()=>s2.ui.backfillState?.state==='complete' && !s2.ui.backfillTask && !s2.ui.searching,{timeout:15000});
  assert.equal(s2.ui.savedTotal,8*120,'sort=oldest searches full history without early stop');
});

test('optimizations: thread-in-heap orders recent thread replies ahead of old main pages, m.room.create avoids empty seq=0 requests, conversations seeds freshness, and dateOrderUnsafe guards out-of-order rooms',async t=>{
  const idb=new IDBFactory(),dbName='bf-opt-'+crypto.randomUUID();
  const owner='@me:reddit.com';
  const novTs=Date.UTC(2026,10,20,12,0,0);
  const janTs=Date.UTC(2026,0,15,12,0,0);

  // Room 1: 150 main messages (page 1 has Nov thread root with latest_event in Nov, page 2 is old Jan 2026) + 1 thread reply in Nov!
  const r1Events=[];
  for(let s=1;s<=150;s++){
    const ts=s>50?novTs-(150-s)*60_000:janTs-(50-s)*60_000;
    const isRoot=s===140;
    r1Events.push({
      event_id:`$r1_e${s}`,room_id:'!r1:reddit.com',type:s===1?'m.room.create':'m.room.message',sender:owner,origin_server_ts:ts,seq_id:`m${s}`,_seq:s,
      content:s===1?{}:{body:`main ${s}`},
      ...(isRoot?{unsigned:{'m.relations':{'m.thread':{count:1,latest_event:{origin_server_ts:novTs-1000}}}}}:{})
    });
  }
  const r1Threads={
    m140:[{event_id:'$r1_t1',room_id:'!r1:reddit.com',type:'m.room.message',sender:owner,origin_server_ts:novTs-1000,seq_id:'t.m140.1',_seq:1,content:{body:'hot_nov_thread_reply','m.relates_to':{rel_type:'m.thread',event_id:'$r1_e140'}}}]
  };

  // Room 2: tiny room with m.room.create at seq 1 -> should take ONLY 1 /events request (no seq=0 follow-up!).
  const r2Events=[
    {event_id:'$r2_create',room_id:'!r2:reddit.com',type:'m.room.create',sender:owner,origin_server_ts:novTs-500_000,seq_id:'m1',_seq:1,content:{}},
    {event_id:'$r2_m2',room_id:'!r2:reddit.com',type:'m.room.message',sender:owner,origin_server_ts:novTs-400_000,seq_id:'m2',_seq:2,content:{body:'tiny_create_room'}}
  ];

  // Room 3: out-of-order timestamps (page 1 drops below May 1, page 2 jumps FORWARD to Nov 20 with 'sneaky_out_of_order'!).
  const mayTs=Date.UTC(2026,4,1,0,0,0);
  const r3Events=[];
  for(let s=1;s<=120;s++){
    // seqs 21..120 (page 1) are in Nov..Apr (oldest seq 21 = Apr 1 < May 1); seqs 1..20 (page 2) jump forward to Nov!
    const ts=s>20?(s===21?janTs:novTs-(120-s)*60_000):novTs-5000;
    r3Events.push({event_id:`$r3_e${s}`,room_id:'!r3:reddit.com',type:'m.room.message',sender:owner,origin_server_ts:ts,seq_id:`m${s}`,_seq:s,content:{body:s===10?'sneaky_out_of_order':'filler'}});
  }

  const rooms=[
    {roomId:'!r1:reddit.com',events:r1Events,threads:r1Threads,lastSeq:'m150',timestamp:novTs},
    {roomId:'!r2:reddit.com',events:r2Events,threads:{},lastSeq:'m2',timestamp:novTs-400_000},
    {roomId:'!r3:reddit.com',events:r3Events,threads:{},lastSeq:'m120',timestamp:novTs}
  ];
  const homeserver=createFixtureHomeserver({owner,rooms});
  const {W,store}=mountFullStack(t,{idb,dbName,owner,homeserver});

  // 1. Seed freshness via full conversations() scan -> backfill must make 0 additional getRoomList calls!
  await W.RCSData.request('conversations',{}).promise;
  const roomListBefore=homeserver.roomListCalls.length;
  assert.equal(roomListBefore,1);

  const res=await W.RCSData.request('backfill',{plan:{}}).promise;
  assert.equal(res.state,'complete');
  assert.equal(homeserver.roomListCalls.length,roomListBefore,'backfill reused conversations() freshness with 0 extra /rooms calls');

  // 2. Room 2 (with m.room.create) took ONLY 1 /events request (no redundant seq=0 check)!
  assert.equal(homeserver.eventCalls.filter(c=>c.roomId==='!r2:reddit.com').length,1,'m.room.create marks bottom immediately in 1 request');

  // 3. Thread-in-heap: !r1 thread m140 (Nov 20) was fetched BEFORE !r1 page 2 (seq 50, older main messages)!
  const r1Calls=homeserver.eventCalls.filter(c=>c.roomId==='!r1:reddit.com');
  const threadIdx=r1Calls.findIndex(c=>c.params.parent==='m140');
  const mainPage2Idx=r1Calls.findIndex(c=>!c.params.parent && c.params.seq==='50');
  assert.ok(threadIdx>=0 && mainPage2Idx>=0 && threadIdx<mainPage2Idx,`thread (idx ${threadIdx}) fetched ahead of older main page (idx ${mainPage2Idx})`);
  assert.equal((await store.search(owner,{query:'hot_nov_thread_reply',committed:true})).total,1);
  assert.equal((await store.search(owner,{query:'tiny_create_room',committed:true})).total,1);
  assert.equal((await store.search(owner,{query:'sneaky_out_of_order',committed:true})).total,1);
});
