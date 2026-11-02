const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
function environment(){const context=vm.createContext({TextEncoder,console});for(const file of ['search-core.js','message-store.js'])vm.runInContext(fs.readFileSync(`extension/${file}`,'utf8'),context);return context;}
const plain=value=>JSON.parse(JSON.stringify(value));
const owner='@alice:reddit.com',them='@bob:reddit.com',room='!one:reddit.com';
function event(id,text,time,sender=them,roomId=room){return {event_id:id,room_id:roomId,type:'m.room.message',sender,origin_server_ts:time,content:{body:text}};}
const noon=day=>new Date(2026,9,day,12).getTime();

test('unified query operators compose with sender controls and inclusive legacy local dates',()=>{
  const {RCSCore:C}=environment(),record={text:'Coffee tomorrow: https://example.com/cafe',author:'BobBuilder',authorSelf:false,sender:them,timestamp:new Date(noon(11)).toISOString()};
  assert.equal(C.matchesQuery(record,'coffee "coffee tomorrow" from:bob has:link after:2026-10-11 before:2026-10-12',{dates:{from:'2026-10-11',to:'2026-10-11'}}),true);
  assert.equal(C.matchesQuery(record,'coffee from:me'),false);
  assert.equal(C.matchesQuery(record,'coffee from:them',{from:'me'}),false);
  assert.equal(C.matchesQuery(record,'before:2026-10-11'),false);
  assert.equal(C.matchesQuery(record,'after:2026-10-12'),false);
  assert.equal(C.matchesQuery(record,'has:link',{dates:{to:'2026-10-10'}}),false);
  assert.equal(C.matchesQuery(record,'before:2026-02-30'),false);
  assert.equal(C.matchesQuery(record,'has:image'),false);
  assert.equal(C.matchesQuery({...record,author:'You',authorSelf:true},'from:me'),true);
  assert.equal(C.matchesQuery({...record,author:'Alice',authorSelf:undefined,sender:'me'},'from:me'),true);
});
test('media counts ignore selected attachment type but retain sender, terms, dates and exact native types',async()=>{
  const {RCSCore:C,RCSMessageStore:{Store}}=environment(),store=new Store({indexedDB:null});
  await store.ingest({owner,roomId:room,identities:[{id:them,name:'Bob'}],events:[
    {...event('image','coffee.jpg',noon(11)),content:{body:'coffee.jpg',msgtype:'m.image',info:{mimetype:'image/jpeg'}}},
    {...event('gif','coffee.gif',noon(11)),content:{body:'coffee.gif',msgtype:'m.image',info:{mimetype:'image/gif'}}},
    {...event('video','coffee.mp4',noon(11)),content:{body:'coffee.mp4',msgtype:'m.video'}},
    event('link','coffee https://example.test',noon(11)),event('self','coffee https://example.test',noon(11),owner),
    event('older','coffee https://example.test',noon(10)),event('unrelated','tea https://example.test',noon(11))]});
  await store.ingest({owner,roomId:'!elsewhere:reddit.com',events:[event('other-room','coffee https://example.test',noon(11),them,'!elsewhere:reddit.com')]});
  const query='coffee from:bob after:2026-10-11 has:video',result=await store.search(owner,{query,roomIds:[room],limit:1});
  assert.equal(result.total,1);assert.deepEqual(plain(result.mediaCounts),{image:2,gif:1,link:1,video:1,audio:0,file:0});
  const messages=(await store.room(owner,room)).records;
  assert.deepEqual(plain(C.countMediaTypes(messages,query)),plain(result.mediaCounts));
  assert.equal(C.matchesQuery({text:'plain',attachmentType:'link'},'has:link'),false);
  assert.equal(C.matchesQuery({text:'named.gif',attachmentType:'gif'},'has:gif'),false);
});

test('quoted phrases, conjunctive text and Unicode whole words keep original highlight offsets',()=>{
  const {RCSCore:C}=environment(),text='A ＣＯＦＦＥＥ tomorrow and coffeehouse, café ☕.';
  assert.equal(C.matchesQuery({text},'coffee tomorrow'),true);
  assert.equal(C.matchesQuery({text},'"tomorrow coffee"'),false);
  assert.equal(C.matchesQuery({text:'coffeehouse'},'coffee',{wholeWord:true}),false);
  assert.equal(C.matchesQuery({text:'coffée café'},'café',{wholeWord:true}),true);
  const ranges=plain(C.highlightRanges(text,'coffee from:me',{wholeWord:true}));
  assert.deepEqual(ranges,[[2,8]]);
  assert.equal(text.slice(...ranges[0]),'ＣＯＦＦＥＥ');
  assert.deepEqual(plain(C.highlightRanges('İstanbul, İstanbul','i̇stanbul')),[[0,8],[10,18]]);
  assert.deepEqual(plain(C.highlightRanges('😀 café café','café')),[[3,7],[8,12]]);
  assert.equal(C.matches('ＣＯＦＦＥＥ','coffee'),true,'legacy matching remains compatible');
});

test('excerpt highlights are relative to centered truncated text and omit query operators',()=>{
  const {RCSCore:C}=environment(),text='A little introductory material. '.repeat(8)+'exact phrase here '+ 'some trailing details. '.repeat(8);
  const excerpt=C.excerpt(text,'"exact phrase" from:them',{max:100});
  assert.ok(excerpt.text.startsWith('…') && excerpt.text.endsWith('…'));
  assert.equal(excerpt.text.slice(...excerpt.ranges[0]),'exact phrase');
  assert.deepEqual(plain(C.highlightRanges(text,'from:me after:2026-10-01')),[]);
});

test('saved search filters rooms, counts all grouped matches and keeps pagination and sort stable',async()=>{
  const {RCSMessageStore:{Store}}=environment(),store=new Store({indexedDB:null});
  await store.ingest({owner,events:[event('a','coffee tomorrow',noon(10)),event('b','a coffee story',noon(11),owner),event('c','coffee coffee',noon(9),them,'!two:reddit.com')],identities:[{id:them,name:'BobBuilder'}]});
  assert.deepEqual(plain((await store.search(owner,{query:'coffee',sort:'oldest'})).records.map(record=>record.id)),['c','a','b']);
  assert.deepEqual(plain((await store.search(owner,{query:'coffee',sort:'newest'})).records.map(record=>record.id)),['b','a','c']);
  assert.equal((await store.search(owner,{query:'coffee',sort:'relevant'})).records[0].id,'c');
  const grouped=await store.search(owner,{query:'coffee',grouped:true,limit:1});
  assert.equal(grouped.total,3);assert.equal(grouped.matchedRooms,2);assert.equal(grouped.hasMore,true);
  assert.equal(grouped.groups.reduce((sum,group)=>sum+group.total,0),3);
  assert.equal(grouped.groups.reduce((sum,group)=>sum+group.records.length,0),1);
  assert.equal((await store.search(owner,{query:'from:me',from:'them'})).total,0);
  assert.equal((await store.search(owner,{query:'from:bob'})).total,2);
  assert.equal((await store.search(owner,{roomIds:[room]})).total,2);
  assert.equal((await store.search(owner,{roomIds:[]})).total,0);
  assert.equal((await store.search(them,{query:'coffee'})).total,0);
  await assert.rejects(store.search(owner,{roomIds:'all'}),/Invalid/);
  await assert.rejects(store.search(owner,{limit:501}),/Invalid/);
});

test('lightweight summaries use materialized edits, exclude redactions, and isolate owners',async()=>{
  const {RCSMessageStore:{Store}}=environment(),store=new Store({indexedDB:null});
  await store.ingest({owner,events:[event('old','old text',noon(9),owner),event('latest','private text',noon(10)),event('base','original',noon(8),owner,'!two:reddit.com')]});
  await store.ingest({owner,events:[{...event('edit','edit body',noon(11),owner,'!two:reddit.com'),content:{body:'* edited','m.new_content':{body:'Edited '.repeat(60)},'m.relates_to':{rel_type:'m.replace',event_id:'base'}}},{...event('redaction','',noon(11)),type:'m.room.redaction',redacts:'latest'}]});
  const summaries=await store.summaries(owner);
  assert.equal(summaries.summaries.length,2);
  assert.equal(summaries.summaries.find(item=>item.roomId===room).text,'old text');
  assert.equal(summaries.summaries.find(item=>item.roomId==='!two:reddit.com').text.length,200);
  assert.ok(summaries.summaries.every(item=>item.authorSelf));
  assert.deepEqual(plain((await store.summaries(them)).summaries),[]);
  assert.equal(JSON.stringify(summaries).includes('private text'),false);
  await assert.rejects(store.summaries('invalid'),/Invalid account/);
});

test('summary client reads honor identity changes without waiting for catch-up',async()=>{
  const dom=new JSDOM('',{runScripts:'outside-only'}),win=dom.window;win.TextEncoder=TextEncoder;
  for(const file of ['search-core.js','message-store.js'])win.eval(fs.readFileSync(`extension/${file}`,'utf8'));
  let active=owner,finish;
  win.RCSData={request:action=>({promise:action==='identity-context'?Promise.resolve({owner:active}):new Promise(()=>{})})};
  win.chrome={runtime:{sendMessage:message=>message.action==='summaries'?new Promise(resolve=>{finish=resolve;}):Promise.resolve({ok:true}),onMessage:{addListener(){}}}};
  win.eval(fs.readFileSync('extension/message-cache-client.js','utf8'));
  const request=win.RCSMessages.summaries();
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.ok(finish,'summary transport started while native history remains pending');
  active=them;finish({ok:true,owner,summaries:[{roomId:room,text:'old account'}]});
  await assert.rejects(request,/account changed/);dom.window.close();
});

test('compact timestamps show same-day time, yesterday, recent weekday and prior-year date',()=>{
  const {RCSCore:C}=environment(),now=noon(11);
  assert.ok(C.compactTime(noon(11),now).includes('12'));
  assert.equal(C.compactTime(noon(10),now),'Yesterday');
  assert.ok(C.compactTime(noon(8),now));
  assert.ok(C.compactTime(new Date(2025,9,3).getTime(),now).includes('2025'));
  assert.equal(C.compactTime('not a date',now),'');
});

test('in-room MessageIndex supports operators and authoritative self identities',()=>{
  const {RCSCore:C}=environment(),index=new C.MessageIndex();
  const timestamp=new Date(noon(11)).toISOString();
  index.upsert(room,[{id:'self',text:'Coffee tomorrow https://example.com/self',author:'Alice',authorSelf:true,timestamp},
    {id:'other',text:'Coffee tomorrow https://example.com/them',author:'BobBuilder',authorSelf:false,timestamp},
    {id:'plain',text:'Coffee tomorrow',author:'BobBuilder',authorSelf:false,timestamp}]);
  assert.deepEqual(plain(index.search(room,'from:me has:link "coffee tomorrow"').map(message=>message.id)),['self']);
  assert.deepEqual(plain(index.search(room,'from:bob has:link after:2026-10-11 before:2026-10-12').map(message=>message.id)),['other']);
  assert.equal(index.search(room,'from:them',{to:'2026-10-10'}).length,0);
  assert.equal(index.search(room,'before:2026-02-30').length,0);
  assert.equal(index.search(room,'coffee tomorrow').length,3);
});


test('message timestamps use divider dates for chronological sort and retain their own date for relevance',()=>{
  const {RCSCore:C}=environment(),now=new Date(2026,9,11,23,40).getTime(),at=(year,month,day)=>new Date(year,month,day,21,42).getTime();
  assert.equal(C.dayLabel(at(2026,9,11),now),'Today');assert.equal(C.dayLabel(at(2026,9,10),now),'Yesterday');
  assert.equal(C.dayLabel(at(2026,9,5),now),'Monday');assert.equal(C.dayLabel(at(2026,9,4),now),'Oct 4');assert.equal(C.dayLabel(at(2025,9,3),now),'Oct 3, 2025');
  const yesterday=at(2026,9,10),time=new Date(yesterday).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});
  for(const sort of ['newest','oldest'])assert.equal(C.messageTime(yesterday,{sort,now}),time);
  assert.equal(C.messageTime(yesterday,{sort:'relevant',now}),'Yesterday, '+time);
  assert.equal(C.messageTime(at(2026,9,3),{sort:'relevant',now}),'Oct 3, '+time);
  assert.equal(C.messageTime(at(2025,9,3),{sort:'relevant',now}),'Oct 3, 2025, '+time);
  assert.match(C.fullTimestamp(yesterday),/Sat.*Oct.*10.*2026.*9:42/);
  assert.equal(C.messageTime('invalid'),'');assert.equal(C.dayLabel('invalid'),'Date unavailable');assert.equal(C.fullTimestamp('invalid'),'Date unavailable');assert.equal(C.dayKey('invalid'),'');
  assert.notEqual(C.dayKey(new Date(2026,9,10,23,59)),C.dayKey(new Date(2026,9,11,0,0)));assert.equal(C.dayKey(new Date(2026,9,10,0,0)),C.dayKey(new Date(2026,9,10,23,59)));
  assert.equal(C.dayLabel(new Date(2026,2,8),new Date(2026,2,9)),'Yesterday','local calendar dates survive a daylight-saving transition');
});

test('long substring matches deep in links remain visible and use original offsets',()=>{
  const {RCSCore:C}=environment(),text='https://example.com/'+ 'a'.repeat(600)+'TARGET'+ 'b'.repeat(300);
  assert.equal(C.matchesQuery({text},'target'),true);
  const snippet=C.excerpt(text,'target',{max:60});
  assert.ok(snippet.text.startsWith('…') && snippet.text.endsWith('…'));
  assert.ok(snippet.text.length<=62);
  assert.equal(snippet.ranges.length,1);
  assert.equal(snippet.text.slice(...snippet.ranges[0]),'TARGET');
  assert.ok(snippet.ranges[0][0]<25,'the match appears early enough in the visual window');
  for(const body of ['u/foo','  Ｆｏｏ café  ','Σ','😀needle😀']){
    const needle=body==='Σ'?'σ':body.includes('needle')?'needle':'foo';
    assert.equal(C.matchesQuery({text:body},needle),C.highlightRanges(body,needle).length>0,'matching and highlight normalization agree');
  }
  assert.equal(C.matchesQuery({text:'😀needle😀'},'needle',{wholeWord:true}),true);
  assert.equal(C.matchesQuery({text:'𐐀needle'},'needle',{wholeWord:true}),false,'astral letters remain part of a word');
});

test('multiple sender filters are alternatives while text and dates remain conjunctive',async()=>{
  const {RCSCore:C,RCSMessageStore:{Store}}=environment(),store=new Store({indexedDB:null}),carol='@carol:reddit.com';
  await store.ingest({owner,events:[event('bob','meeting',noon(10)),event('carol','meeting',noon(11),carol),event('self','meeting',noon(11),owner),event('different','holiday',noon(11))],identities:[{id:them,name:'Bob'},{id:carol,name:'Carol'}]});
  assert.deepEqual(plain((await store.search(owner,{query:'meeting from:bob from:carol'})).records.map(message=>message.id)),['carol','bob']);
  assert.deepEqual(plain((await store.search(owner,{query:'meeting from:bob from:carol after:2026-10-11'})).records.map(message=>message.id)),['carol']);
  assert.equal(C.matchesQuery({text:'meeting',authorSelf:true},'meeting from:me from:bob'),true);
});

test('attachment filters use authentic message types, edited metadata and account isolation',async()=>{
  const {RCSMessageStore:{Store}}=environment(),store=new Store({indexedDB:null});
  const image={...event('image','Photo.jpg',noon(10)),content:{body:'Photo.jpg',msgtype:'m.image'}},file={...event('file','Document.pdf',noon(10)),content:{body:'Document.pdf',msgtype:'m.file'}};
  await store.ingest({owner,events:[image,file,event('fake','Photo.jpg',noon(10)),{...event('sticker','',noon(10)),type:'m.sticker'}]});
  assert.deepEqual(plain((await store.search(owner,{query:'has:image'})).records.map(record=>record.id)),['image','sticker']);
  assert.deepEqual(plain((await store.search(owner,{query:'has:file'})).records.map(record=>record.id)),['file']);
  assert.equal((await store.search(owner,{query:'has:image has:file'})).total,0);
  assert.equal((await store.search(them,{query:'has:image'})).total,0);
  await store.ingest({owner,events:[{...event('edit-file','* converted',noon(11)),content:{body:'* converted','m.new_content':{body:'converted.png',msgtype:'m.image'},'m.relates_to':{rel_type:'m.replace',event_id:'file'}}}]});
  assert.equal((await store.search(owner,{query:'has:file'})).total,0);
  assert.equal((await store.search(owner,{query:'has:image converted'})).records[0].id,'file');
});


test('native replay backfills attachment metadata in preexisting cached events without a schema reset',async()=>{
  const {RCSMessageStore:{Store}}=environment(),store=new Store({indexedDB:null}),image={...event('image','Photo.jpg',noon(10)),content:{body:'Photo.jpg',msgtype:'m.image'}};
  await store.ingest({owner,roomId:room,events:[image],coverage:{complete:true,dateComplete:true}});
  const saved=[...store.memory.values()][0];delete saved.events[0].attachmentType;
  assert.equal((await store.search(owner,{query:'has:image'})).total,0);
  const replay=await store.ingest({owner,roomId:room,events:[image],coverage:{complete:true,dateComplete:true}});
  assert.equal(replay.changed,true);
  assert.equal((await store.search(owner,{query:'has:image'})).total,1);
  assert.equal((await store.search(owner,{roomId:room})).coverage.complete,true);
  assert.equal((await store.ingest({owner,roomId:room,events:[image],coverage:{complete:true,dateComplete:true}})).changed,false);
});


test('short message terms use Unicode whole words in matching, excerpts and relevance while longer terms retain substrings',()=>{
  const {RCSCore:C}=environment();
  for(const term of ['u','us','in','σ']){
    const body='introduce user outlet inside '+term+'!';
    assert.deepEqual(plain(C.highlightRanges(body,term)),[[body.lastIndexOf(term),body.lastIndexOf(term)+term.length]]);
    assert.equal(C.matchesQuery({text:'introduce user outlet inside'},term),false);
    assert.equal(C.matchesQuery({text:body},term),true);
    const snippet=C.excerpt(body,term,{max:24});assert.equal(snippet.text.slice(...snippet.ranges[0]),term);
  }
  assert.equal(C.matchesQuery({text:'user username'},'use'),true);
  assert.equal(C.matchesQuery({text:'introduce'},'u',{shortTermsWholeWord:false}),true,'People/name matching may explicitly retain substring completion');
  assert.equal(C.matchesQuery({text:'can introduce either'},'can either u'),false);
  assert.equal(C.matchesQuery({text:'u can do either'},'can either u'),true);
  assert.equal(C.matchesQuery({text:'can u do either'},'"can either" u'),false);
  assert.equal(C.matchesQuery({text:'can either work for u'},'"can either" u'),true);
  assert.ok(C.relevanceScore('can either u','can either u')>C.relevanceScore('can can can','can either u'));
});

test('persistent and individual message searches share short-term AND and exact-phrase semantics',async()=>{
  const {RCSCore:C,RCSMessageStore:{Store}}=environment(),store=new Store({indexedDB:null}),index=new C.MessageIndex(Infinity);
  const texts=['can introduce either a user outlet','can u choose either','either can u choose','can choose either'];
  await store.ingest({owner,events:texts.map((text,i)=>event('short-'+i,text,noon(10)+i))});
  index.upsert(room,texts.map((text,i)=>({id:'short-'+i,text})));
  for(const [query,expected]of [['can either u',['short-1','short-2']],['"u choose either" can',['short-1']],['us',[]]]){
    assert.deepEqual(plain((await store.search(owner,{query})).records.map(r=>r.id).sort()),expected);
    assert.deepEqual(plain(index.search(room,query).map(r=>r.id).sort()),expected);
  }
  const now=noon(11);assert.equal(C.dayLabel(new Date(2025,8,2),now),'Sep 2, 2025');assert.equal(C.dayLabel(new Date(2024,8,2),now),'Sep 2, 2024');
});

test('saved storage and the live index agree on Boolean trees, conditional media, senders and dates',async()=>{
  const {RCSCore:C,RCSMessageStore:{Store}}=environment(),store=new Store({indexedDB:null}),index=new C.MessageIndex(Infinity),carol='@carol:reddit.com';
  const events=[event('both','cats dogs',noon(10)),event('cat','cats birds',noon(11),carol),event('dog','dogs',noon(11),owner),event('iced','coffee iced latte',noon(11)),event('hot','coffee latte',noon(10),carol),
    {...event('image','cats image',noon(11)),content:{body:'cats image',msgtype:'m.image'}},event('link','dogs https://example.test',noon(10),carol)];
  await store.ingest({owner,roomId:room,events,identities:[{id:them,name:'Bob'},{id:carol,name:'Carol'}]});
  const messages=(await store.room(owner,room)).records;index.upsert(room,messages);
  const cases=[['cats AND dogs',['both']],['(cats OR dogs) NOT birds',['both','dog','image','link']],['((cats AND dogs) OR (dogs NOT cats)) NOT birds',['both','dog','link']],['coffee -"iced latte"',['hot']],
    ['(from:Bob OR from:Carol) AND cats',['both','cat','image']],['cats NOT from:Carol',['both','image']],['(has:image OR has:link)',['image','link']],['cats NOT has:image',['both','cat']],['(has:image OR coffee) NOT from:me',['hot','iced','image']],
    ['(before:2026-10-11 OR from:me) AND dogs',['both','dog','link']],['(cats OR after:2026-10-11) NOT has:image',['both','cat','dog','iced']],['NOT (has:image OR has:link) AND cats',['both','cat']],
    ['from:Bob from:Carol cats',['both','cat','image']],['from:Bob AND from:Carol',[]]];
  for(const [query,wanted]of cases){
    assert.equal(C.parseQuery(query).invalid,false,query);
    assert.deepEqual(plain(index.search(room,query).map(record=>record.id).sort()),wanted.slice().sort(),'index: '+query);
    const result=await store.search(owner,{query,limit:1});
    assert.equal(result.total,wanted.length,'total: '+query);
    const all=[];for(let offset=0;offset<wanted.length;offset++)all.push(...(await store.search(owner,{query,limit:1,offset})).records.map(record=>record.id));
    assert.deepEqual(plain(all.sort()),wanted.slice().sort(),'storage pages: '+query);
  }
  assert.deepEqual(plain(index.search(room,'from:Bob OR from:Carol').map(r=>r.id).sort()),plain(index.search(room,'(from:Bob OR from:Carol)').map(r=>r.id).sort()),'bare field alternatives equal their grouped form');
  assert.equal((await store.search(owner,{query:'from:Bob OR from:Carol'})).total,(await store.search(owner,{query:'(from:Bob OR from:Carol)'})).total);
  for(const query of ['cats AND','(cats OR dogs','-"iced latte"']){
    assert.equal(C.parseQuery(query).invalid,true,query);
    assert.equal(index.search(room,query).length,0,query);assert.equal((await store.search(owner,{query})).total,0,query);
  }
});
