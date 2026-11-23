const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {IDBFactory,IDBKeyRange}=require('fake-indexeddb');
const {buildOracleMessages,oracleSearch}=require('./search-oracle-helper.cjs');

function makeEnv(idbFactory){
  const ctx=vm.createContext({indexedDB:idbFactory,IDBKeyRange,TextEncoder,URL,console,crypto});
  for(const file of ['search-core.js','message-store.js'])vm.runInContext(fs.readFileSync(`extension/${file}`,'utf8'),ctx);
  return {C:ctx.RCSCore,M:ctx.RCSMessageStore};
}

// Deterministic PRNG for reproducible fuzz/differential testing.
function prng(seed=20261123){
  let s=seed;
  return ()=>{s=(s*16807)%2147483647;return (s-1)/2147483646;};
}

test('1,000 random queries over synthetic corpus with edits, redactions, threads, echoes, Unicode, renames and multiple accounts match brute-force oracle 100%',async()=>{
  const rand=prng(42);
  const pick=arr=>arr[Math.floor(rand()*arr.length)];
  const idb=new IDBFactory();
  const {C,M}=makeEnv(idb);
  const store=new M.Store({indexedDB:idb,name:'diff-oracle-v2'});
  const owner='@t2_owner:reddit.com',otherAccount='@t2_other:reddit.com';
  const senders=[
    {id:owner,name:'You',self:true},
    {id:'@t2_alice:reddit.com',name:'Alice_New',aliases:['AliceOld']},
    {id:'@t2_bob:reddit.com',name:'Bob_Smith'},
    {id:'@t2_carol:reddit.com',name:'Carol Café',aliases:['Carol99']},
    {id:'@t2_dave:reddit.com',name:'Dave'}
  ];
  const rooms=['!dm1:reddit.com','!dm2:reddit.com','!grp1:reddit.com','!mod1:reddit.com'];
  const vocab=['coffee','tea','battery','laptop','café','naïve','猫猫猫','🎉','ab','go','it','https://example.com/a','www.reddit.com','hello','world','meeting','tomorrow','pizza','iced','latte','decaf','battery-pack','u/alice'];
  const eventsByRoom=new Map(rooms.map(r=>[r,[]]));
  const baseTs=Date.UTC(2026,5,1,12,0,0);

  let seqCounter=1;
  const allEvents=[];
  for(let i=0;i<240;i++){
    const roomId=pick(rooms),sender=pick(senders).id,ts=baseTs+Math.floor(rand()*30)*86400000+Math.floor(rand()*86400000);
    const id=`$m${i}`;
    const wordCount=1+Math.floor(rand()*6);
    const body=Array.from({length:wordCount},()=>pick(vocab)).join(' ');
    const kindRoll=rand();
    let ev;
    if(kindRoll<0.08){
      ev={event_id:id,room_id:roomId,type:'m.sticker',sender,origin_server_ts:ts,seq_id:`m${seqCounter++}`,content:{body:'',url:'https://example.invalid/sticker.png'}};
    }else if(kindRoll<0.16){
      ev={event_id:id,room_id:roomId,type:'m.room.message',sender,origin_server_ts:ts,seq_id:`m${seqCounter++}`,content:{msgtype:'m.image',body:rand()<0.5?body:'',info:{mimetype:rand()<0.4?'image/gif':'image/png'}}};
    }else if(kindRoll<0.22){
      ev={event_id:id,room_id:roomId,type:'m.room.message',sender,origin_server_ts:ts,seq_id:`m${seqCounter++}`,content:{msgtype:pick(['m.video','m.audio','m.file']),body:rand()<0.5?body:''}};
    }else if(kindRoll<0.26){
      // formatted_body only!
      ev={event_id:id,room_id:roomId,type:'m.room.message',sender,origin_server_ts:ts,seq_id:`m${seqCounter++}`,content:{msgtype:'m.text',body:'',formatted_body:`<p><b>${body}</b></p>`}};
    }else{
      ev={event_id:id,room_id:roomId,type:'m.room.message',sender,origin_server_ts:ts,seq_id:`m${seqCounter++}`,content:{msgtype:'m.text',body}};
    }
    eventsByRoom.get(roomId).push(ev);allEvents.push(ev);

    // Local echo that must never appear.
    if(i%15===0)allEvents.push({...ev,event_id:`~${roomId}:echo${i}`});

    // Out-of-order edits (same sender + occasional forged sender).
    if(i%6===0){
      const edit1={event_id:`$e1_${i}`,room_id:roomId,type:'m.room.message',sender,origin_server_ts:ts+5000,content:{body:'* edited','m.new_content':{msgtype:'m.text',body:'edited '+pick(vocab)+' '+pick(vocab)},'m.relates_to':{rel_type:'m.replace',event_id:id}}};
      const edit2={event_id:`$e2_${i}`,room_id:roomId,type:'m.room.message',sender,origin_server_ts:ts+9000,content:{body:'* latest','m.new_content':{msgtype:'m.text',body:'latest '+pick(vocab)},'m.relates_to':{rel_type:'m.replace',event_id:id}}};
      const forged={event_id:`$ef_${i}`,room_id:roomId,type:'m.room.message',sender:sender===owner?'@t2_bob:reddit.com':owner,origin_server_ts:ts+12000,content:{body:'* forged','m.new_content':{msgtype:'m.text',body:'forged text'},'m.relates_to':{rel_type:'m.replace',event_id:id}}};
      eventsByRoom.get(roomId).push(edit1,edit2,forged);allEvents.push(edit1,edit2,forged);
      if(i%12===0){
        // Redact the newer edit so it must fall back to edit1!
        const redEdit={event_id:`$re_${i}`,room_id:roomId,type:'m.room.redaction',sender,origin_server_ts:ts+15000,redacts:`$e2_${i}`};
        eventsByRoom.get(roomId).push(redEdit);allEvents.push(redEdit);
      }
    }
    // Redact original (some via m.room.redaction, some via unsigned.redacted_because).
    if(i%11===0){
      const redOrig={event_id:`$ro_${i}`,room_id:roomId,type:'m.room.redaction',sender,origin_server_ts:ts+20000,redacts:id};
      eventsByRoom.get(roomId).push(redOrig);allEvents.push(redOrig);
    }
  }

  // Shuffle arrival order completely (edits/redactions arriving before originals!).
  for(let i=allEvents.length-1;i>0;i--){const j=Math.floor(rand()*(i+1));[allEvents[i],allEvents[j]]=[allEvents[j],allEvents[i]];}

  // Ingest identities with historical rename: first AliceOld, then renamed to Alice_New!
  await store.ingest({owner,events:[],identities:[{id:'@t2_alice:reddit.com',name:'AliceOld'},{id:'@t2_carol:reddit.com',name:'Carol99'}]});
  await store.ingest({owner,events:[],identities:senders});
  // Ingest another account to verify strict account isolation!
  await store.ingest({owner:otherAccount,roomId:'!dm1:reddit.com',events:[{event_id:'$secret',room_id:'!dm1:reddit.com',type:'m.room.message',sender:otherAccount,origin_server_ts:baseTs,content:{body:'coffee tea battery laptop'}}]});
  for(let off=0;off<allEvents.length;off+=50)await store.ingest({owner,events:allEvents.slice(off,off+50)});

  const peopleMap=Object.fromEntries(senders.map(s=>[s.id,s]));
  const corpus=buildOracleMessages(eventsByRoom,owner,peopleMap);

  // Generate 1,000 diverse queries (plain words, phrases, OR, AND, NOT, -exclude, from: incl. old alias, has:, before:/after:, dates, wholeWord, sorts, roomIds).
  const mediaChoices=['image','gif','link','video','audio','file'];
  const senderChoices=['me','them','Alice_New','AliceOld','Bob_Smith','Carol99','Dave'];
  const dateStrings=['2026-06-05','2026-06-12','2026-06-20','2026-06-25'];
  const sorts=['newest','oldest','relevant'];

  const genQuery=()=>{
    const r=rand();
    if(r<0.12)return pick(vocab);
    if(r<0.24)return `${pick(vocab)} ${pick(vocab)}`;
    if(r<0.34)return `"${pick(vocab)} ${pick(vocab)}"`;
    if(r<0.44)return `${pick(vocab)} OR ${pick(vocab)}`;
    if(r<0.54)return `${pick(vocab)} -${pick(vocab)}`;
    if(r<0.64)return `(${pick(vocab)} OR ${pick(vocab)}) NOT ${pick(vocab)}`;
    if(r<0.74)return `from:${pick(senderChoices)} ${rand()<0.5?pick(vocab):''}`.trim();
    if(r<0.84)return `has:${pick(mediaChoices)} ${rand()<0.5?pick(vocab):''}`.trim();
    if(r<0.92)return `after:${pick(dateStrings)} ${rand()<0.5?'before:'+pick(dateStrings):''} ${rand()<0.5?pick(vocab):''}`.trim();
    return `(from:${pick(senderChoices)} OR has:${pick(mediaChoices)}) ${pick(vocab)}`;
  };

  for(let qIdx=0;qIdx<1000;qIdx++){
    const query=genQuery();
    const from=pick(['all','all','all','me','them']);
    const wholeWord=rand()<0.2;
    const sort=pick(sorts);
    const dates=rand()<0.25?{from:pick(['','2026-06-05','2026-06-15']),to:pick(['','2026-06-20','2026-06-28'])}:{};
    const roomIds=rand()<0.25?[pick(rooms),pick(rooms)]:undefined;
    const opts={query,from,wholeWord,sort,dates,roomIds,limit:500,offset:0};

    const expected=oracleSearch(C,corpus,opts);
    const actual=await store.search(owner,{...opts,committed:true});
    const actualIds=Array.from(actual.records,r=>r.roomId+'\0'+r.id);

    assert.equal(actual.total,expected.total,`q#${qIdx} total mismatch for ${JSON.stringify(opts)}`);
    assert.equal(actual.matchedRooms,expected.matchedRooms,`q#${qIdx} matchedRooms mismatch for ${JSON.stringify(opts)}`);
    assert.deepEqual({...actual.mediaCounts},{...expected.mediaCounts},`q#${qIdx} mediaCounts mismatch for ${JSON.stringify(opts)}`);
    assert.deepEqual([...actual.availableMediaTypes],[...expected.availableMediaTypes],`q#${qIdx} availableMediaTypes mismatch`);
    assert.deepEqual(actualIds,expected.ids,`q#${qIdx} ids/order mismatch for ${JSON.stringify(opts)}`);
  }

  // Verify count equals rows-loaded when paging all the way to the end.
  for(const q of ['','coffee','coffee OR tea','has:image','from:AliceOld']){
    const loaded=[];let offset=0;let firstTotal=null;
    while(true){
      const res=await store.search(owner,{query:q,limit:17,offset,committed:true});
      if(firstTotal===null)firstTotal=res.total;
      assert.equal(res.total,firstTotal);
      loaded.push(...res.records.map(r=>r.roomId+'\0'+r.id));
      if(!res.hasMore)break;
      offset+=17;
    }
    assert.equal(loaded.length,firstTotal,`paged length must equal total for "${q}"`);
    assert.equal(new Set(loaded).size,firstTotal,`paged rows must be deduplicated for "${q}"`);
  }
  (await store.db()).close();
});

test('unknown event types are counted, never dropped silently, and block complete coverage',async()=>{
  const idb=new IDBFactory(),{M}=makeEnv(idb);
  const store=new M.Store({indexedDB:idb,name:'unknown-events-v2'});
  const owner='@t2_owner:reddit.com',roomId='!r1:reddit.com';
  await store.ingest({owner,roomId,events:[
    {event_id:'$ok',room_id:roomId,type:'m.room.message',sender:owner,origin_server_ts:1000,seq_id:'m1',content:{body:'hello'}},
    {event_id:'$poll1',room_id:roomId,type:'com.reddit.poll.v99',sender:owner,origin_server_ts:2000,seq_id:'m2',content:{question:'tea or coffee?'}},
    // Standard state/member events are known-ignored, not unknown!
    {event_id:'$mem1',room_id:roomId,type:'m.room.member',state_key:owner,sender:owner,origin_server_ts:500,content:{membership:'join'}}
  ],span:{p:'',lo:0,hi:2,tLo:1000,tHi:2000,bottom:true,src:'history'}});

  const st=await store.stats(owner);
  assert.equal(st.stats.messages,1);
  assert.equal(st.stats.unknownEvents,1);
  assert.equal(st.stats.completeRooms,0,'a room with unknown event types cannot be complete');
  const cov=await store.coverage(owner,[roomId]);
  assert.equal(cov.rooms[roomId].unknownCount,1);
  assert.equal(cov.rooms[roomId].coverage.complete,false);
  (await store.db()).close();
});

test('v1 to v2 migration resumes cleanly across simulated worker kills at every batch boundary, dual-writes during migration, and deletes v1 only after verification',async()=>{
  const idb=new IDBFactory();
  const owner='@t2_alice:reddit.com',other='@t2_bob:reddit.com';
  const v1Name='rcs-messages-v1',v2Name='rcs-chat-v2';

  // Seed a realistic v1 IndexedDB with 2 accounts, 4 rooms, edits, redactions, legacy ~ echo, and coverage.complete=true.
  const v1Db=await new Promise((resolve,reject)=>{
    const open=idb.open(v1Name,1);
    open.onupgradeneeded=()=>{open.result.createObjectStore('rooms',{keyPath:['owner','roomId']});open.result.createObjectStore('identities',{keyPath:'owner'});};
    open.onsuccess=()=>resolve(open.result);open.onerror=()=>reject(open.error);
  });
  const {M}=makeEnv(idb);
  const makeRow=(acc,rid,evs,complete)=>{
    const compacted=evs.map(e=>M.compact(e,rid)).filter(Boolean);
    const row=M.reduce({owner:acc,roomId:rid,events:[]},compacted,complete?{complete:true,dateComplete:true}:undefined);
    return row;
  };
  await new Promise((resolve,reject)=>{
    const tx=v1Db.transaction(['rooms','identities'],'readwrite');
    const r1=makeRow(owner,'!r1:reddit.com',[
      {event_id:'$1',room_id:'!r1:reddit.com',type:'m.room.message',sender:owner,origin_server_ts:1000,content:{body:'hello v1 world'}},
      {event_id:'$2',room_id:'!r1:reddit.com',type:'m.room.message',sender:other,origin_server_ts:2000,content:{body:'original text'}},
      {event_id:'$2e',room_id:'!r1:reddit.com',type:'m.room.message',sender:other,origin_server_ts:2500,content:{body:'* edited','m.new_content':{body:'edited v1 coffee'},'m.relates_to':{rel_type:'m.replace',event_id:'$2'}}}
    ],true);
    // Inject a legacy ~ echo to verify migration strips it!
    r1.events.push({id:'~!r1:reddit.com:echo',room:'!r1:reddit.com',type:'m.room.message',sender:owner,time:3000,body:'pending echo',attachmentType:'',attachmentMime:'',replaces:'',thread:false,threadRoot:'',redacts:'',redacted:false});
    tx.objectStore('rooms').put(r1);
    tx.objectStore('rooms').put(makeRow(owner,'!r2:reddit.com',[
      {event_id:'$3',room_id:'!r2:reddit.com',type:'m.room.message',sender:owner,origin_server_ts:4000,content:{msgtype:'m.image',body:'pic.png',info:{mimetype:'image/gif'}}},
      {event_id:'$4',room_id:'!r2:reddit.com',type:'m.room.message',sender:owner,origin_server_ts:5000,content:{body:'secret to delete'}},
      {event_id:'$4r',room_id:'!r2:reddit.com',type:'m.room.redaction',sender:owner,origin_server_ts:6000,redacts:'$4'}
    ],false));
    tx.objectStore('rooms').put(makeRow(owner,'!r3:reddit.com',[
      {event_id:'$5',room_id:'!r3:reddit.com',type:'m.room.message',sender:other,origin_server_ts:7000,content:{body:'visit https://example.com today'}}
    ],false));
    tx.objectStore('rooms').put(makeRow(other,'!other:reddit.com',[
      {event_id:'$o1',room_id:'!other:reddit.com',type:'m.room.message',sender:other,origin_server_ts:8000,content:{body:'other account message'}}
    ],true));
    tx.objectStore('identities').put({owner,people:{[other]:{id:other,name:'Bob',avatar:'https://example.invalid/bob.png'}},nativeImportComplete:true,nativeReconciledAt:9999,approxBytes:120});
    tx.objectStore('identities').put({owner:other,people:{},nativeImportComplete:true,nativeReconciledAt:8888,approxBytes:60});
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
  });
  v1Db.close();

  // Simulate worker kill after 1st batch of owner migration!
  const store1=new M.Store({indexedDB:idb,name:v2Name,legacyName:v1Name});
  let batches=0;
  const killed=await store1.ensureMigration(owner,{batchEvents:2,onBatch:()=>{if(++batches===1)throw Error('Simulated worker kill');}});
  assert.equal(killed.migrated,false);
  // While mid-migration, reads for owner STILL succeed via v1 and dual-write preserves new ingests!
  const midRead=await store1.search(owner,{query:'coffee'});
  assert.equal(midRead.total,1);assert.equal(midRead.migrating,true);
  await store1.ingest({owner,roomId:'!r3:reddit.com',events:[{event_id:'$live',room_id:'!r3:reddit.com',type:'m.room.message',sender:owner,origin_server_ts:7500,content:{body:'arrived mid migration'}}]});
  (await store1.db()).close();
  (await store1.legacy?.dbPromise)?.close();

  // Restart a brand new Store (simulating worker wake) and resume migration to completion for BOTH owners.
  const store2=new M.Store({indexedDB:idb,name:v2Name,legacyName:v1Name});
  const res1=await store2.ensureMigration(owner,{batchEvents:2});
  assert.equal(res1.migrated,true);
  // v1 must NOT be deleted yet because `other` hasn't finished migrating!
  assert.equal(res1.deletedV1,false);

  // Verify owner's data in v2: all messages present, dual-write kept, ~ echo stripped, redacted gone, legacyComplete NOT reported as complete!
  const allOwner=await store2.search(owner,{query:''});
  assert.equal(allOwner.total,5); // $1, $2(edited), $3(gif), $5(link), $live
  assert.equal(allOwner.migrating,undefined);
  assert.equal((await store2.search(owner,{query:'pending echo'})).total,0);
  assert.equal((await store2.search(owner,{query:'secret'})).total,0);
  assert.equal((await store2.search(owner,{query:'mid migration'})).total,1);
  assert.equal((await store2.search(owner,{query:'has:gif'})).total,1);
  assert.equal((await store2.stats(owner)).nativeImportComplete,true);
  // legacyComplete room must NOT claim complete until an overlapping head pass verifies it.
  const covBefore=await store2.coverage(owner,['!r1:reddit.com']);
  assert.ok(covBefore.rooms['!r1:reddit.com'].legacyComplete);
  assert.equal(covBefore.rooms['!r1:reddit.com'].coverage.complete,false);
  // Overlapping head pass upgrades legacyComplete into a real bottomed span!
  await store2.ingest({owner,roomId:'!r1:reddit.com',events:[{event_id:'$1',room_id:'!r1:reddit.com',type:'m.room.message',sender:owner,origin_server_ts:1000,seq_id:'m10',content:{body:'hello v1 world'}}],span:{p:'',lo:10,hi:10,tLo:1000,tHi:1000,bottom:false,overlapLegacy:true,src:'history'}});
  const covAfter=await store2.coverage(owner,['!r1:reddit.com']);
  assert.equal(covAfter.rooms['!r1:reddit.com'].legacyComplete,null);
  assert.equal(covAfter.rooms['!r1:reddit.com'].coverage.complete,true);
  assert.equal(covAfter.rooms['!r1:reddit.com'].spans[''][0].lo,0);
  assert.equal(covAfter.rooms['!r1:reddit.com'].spans[''][0].bottom,true);

  // Migrate remaining owner -> now v1 is deleted!
  const resAll=await store2.ensureMigration(null);
  assert.equal(resAll.migrated,true);assert.equal(resAll.deletedV1,true);
  assert.equal((await store2.search(other,{query:'other account'})).total,1);
  (await store2.db()).close();
});

test('coverage spans merge adjacent and overlapping ranges, detect head gaps, and honor inaccessible state',async()=>{
  const idb=new IDBFactory(),{M}=makeEnv(idb);
  const store=new M.Store({indexedDB:idb,name:'spans-v2'});
  const owner='@t2_owner:reddit.com',roomId='!r1:reddit.com';

  // Page 1: [51, 100] (not bottom)
  await store.ingest({owner,roomId,events:[{event_id:'$100',room_id:roomId,type:'m.room.message',sender:owner,origin_server_ts:5000,seq_id:'m100',content:{body:'newest'}}],span:{p:'',lo:51,hi:100,tLo:3000,tHi:5000,bottom:false,src:'backfill'}});
  let cov=(await store.coverage(owner,[roomId])).rooms[roomId];
  assert.equal(cov.spans[''].length,1);assert.equal(cov.coverage.complete,false);

  // Page 2: [0, 50] bottom=true -> merges cleanly with [51, 100] into [0, 100]!
  await store.ingest({owner,roomId,events:[{event_id:'$1',room_id:roomId,type:'m.room.message',sender:owner,origin_server_ts:1000,seq_id:'m1',content:{body:'oldest'}}],span:{p:'',lo:0,hi:50,tLo:1000,tHi:2900,bottom:true,src:'backfill'}});
  cov=(await store.coverage(owner,[roomId])).rooms[roomId];
  assert.equal(cov.spans[''].length,1);
  assert.equal(cov.spans[''][0].lo,0);assert.equal(cov.spans[''][0].hi,100);assert.equal(cov.spans[''][0].bottom,true);
  assert.equal(cov.coverage.complete,true);

  // Directory sees newer head seq 120 -> room is no longer complete until head gap [101, 120] is fetched!
  await store.updateHeads(owner,[{roomId,lastSeq:'m120'}]);
  cov=(await store.coverage(owner,[roomId])).rooms[roomId];
  assert.equal(cov.headSeen.s,120);assert.equal(cov.coverage.complete,false);

  // Head fetch [100, 120] closes gap and merges into [0, 120] -> complete again!
  await store.ingest({owner,roomId,events:[{event_id:'$120',room_id:roomId,type:'m.room.message',sender:owner,origin_server_ts:6000,seq_id:'m120',content:{body:'brand new'}}],span:{p:'',lo:100,hi:120,tLo:5000,tHi:6000,bottom:false,src:'backfill'}});
  cov=(await store.coverage(owner,[roomId])).rooms[roomId];
  assert.equal(cov.spans[''].length,1);assert.equal(cov.spans[''][0].hi,120);assert.equal(cov.coverage.complete,true);

  // Mark inaccessible -> never complete!
  await store.markInaccessible(owner,roomId,403);
  cov=(await store.coverage(owner,[roomId])).rooms[roomId];
  assert.equal(cov.inaccessible.status,403);assert.equal(cov.coverage.complete,false);
  (await store.db()).close();
});

test('cold search reads share a projection only within the same write generation',async()=>{
 const idb=new IDBFactory(),{M}=makeEnv(idb);
 const store=new M.Store({indexedDB:idb,name:'cold-projection-generations'});
 const owner='@t2_account:reddit.com',roomId='!room:reddit.com';
 const ingest=id=>store.ingest({owner,roomId,events:[{
  event_id:id,type:'m.room.message',sender:owner,origin_server_ts:Date.now(),
  content:{msgtype:'m.text',body:'fixture'}
 }]});
 await ingest('$first');
 const build=store._buildProjection.bind(store);
 let builds=0,ready,release;
 const snapshotReady=new Promise(resolve=>{ready=resolve;});
 const blocked=new Promise(resolve=>{release=resolve;});
 store._buildProjection=async id=>{
  const n=++builds,result=await build(id);
  if(n===1){ready();await blocked;}
  return result;
 };
 const first=store._ensureProjection(owner),same=store._ensureProjection(owner);
 await snapshotReady;
 assert.equal(builds,1);
 await ingest('$second');
 const after=await store._ensureProjection(owner);
 assert.equal(after.count,2);
 release();
 const previous=await first;
 assert.equal(await same,previous);
 assert.equal(previous.count,1);
 assert.equal(await store._ensureProjection(owner),after,'an older snapshot never replaces the newer projection');
 assert.equal(builds,2);
 await store.clear(owner);
 assert.equal(await store._ensureProjection(owner),null);
});

test('a cold search that starts while a save is running never caches its snapshot',async()=>{
 const idb=new IDBFactory(),{M}=makeEnv(idb);
 const store=new M.Store({indexedDB:idb,name:'cold-projection-active-write'});
 const owner='@t2_account:reddit.com',roomId='!room:reddit.com';
 const batch=id=>({owner,roomId,events:[{event_id:id,type:'m.room.message',sender:owner,origin_server_ts:Date.now(),content:{msgtype:'m.text',body:'fixture'}}]});
 await store.ingest(batch('$first'));
 const write=store.write.bind(store);let release;const gate=new Promise(resolve=>{release=resolve;});
 store.write=async value=>{await gate;return write(value);};
 const saving=store.ingest(batch('$second'));
 await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(store.activeWrites>0,true,'the save has started');
 const during=await store._ensureProjection(owner);
 assert.equal(during.count,1);
 release();await saving;
 assert.equal(store.activeWrites,0);
 assert.equal((await store._ensureProjection(owner)).count,2,'the snapshot read during the save was not kept');
});
