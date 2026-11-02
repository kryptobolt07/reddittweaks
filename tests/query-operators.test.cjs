const test=require('node:test');
const strict=require('node:assert/strict');
const assert={...strict,deepEqual:(a,b,m)=>strict.deepEqual(JSON.parse(JSON.stringify(a)),b,m)};
const fs=require('node:fs'),vm=require('node:vm');
const {indexedDB,IDBKeyRange}=require('fake-indexeddb');
const ctx=vm.createContext({indexedDB,IDBKeyRange,TextEncoder,console});
for(const file of ['search-core.js','message-store.js','global-search-model.js'])vm.runInContext(fs.readFileSync(`extension/${file}`,'utf8'),ctx);
const C=ctx.RCSCore,{Store}=ctx.RCSMessageStore;
const hit=(query,text,options)=>C.matchesQuery({text},query,options);
const owner='@alice:reddit.com',roomId='!room:reddit.com';
const event=(id,body,time)=>({event_id:id,room_id:roomId,type:'m.room.message',sender:owner,origin_server_ts:time,content:{body}});

test('OR binds tighter than AND and chains',()=>{
  assert.deepEqual(C.parseQuery('a1 b2 OR c3').expr,{type:'and',children:[{type:'term',text:'a1'},{type:'or',children:[{type:'term',text:'b2'},{type:'term',text:'c3'}]}]});
  assert.equal(hit('apple banana OR cherry','apple cherry'),true);
  assert.equal(hit('apple banana OR cherry','banana cherry'),false);
  assert.equal(hit('apple OR banana OR cherry','only cherry here'),true);
  assert.equal(hit('apple OR banana OR cherry','only grape here'),false);
});
test('only uppercase OR is an operator',()=>{
  const parsed=C.parseQuery('tea or coffee');
  assert.deepEqual(parsed.terms,['tea','or','coffee']);assert.equal(parsed.invalid,false);
  assert.equal(hit('tea or coffee','tea coffee'),false);assert.equal(hit('tea or coffee','tea or coffee'),true);
});
test('-word and -"phrase" exclude, hyphenated words stay plain',()=>{
  assert.equal(hit('coffee -decaf','hot coffee'),true);assert.equal(hit('coffee -decaf','hot decaf coffee'),false);
  assert.equal(hit('coffee -"iced latte"','coffee and iced latte'),false);assert.equal(hit('coffee -"iced latte"','coffee and iced tea'),true);
  const parsed=C.parseQuery('e-mail - mixed-case');
  assert.deepEqual(parsed.terms,['e-mail','-','mixed-case']);assert.deepEqual(parsed.excluded,[]);assert.equal(parsed.invalid,false);
  assert.equal(hit('e-mail','send an e-mail'),true);
  assert.deepEqual(C.parseQuery('mail -e-mail').excluded,['e-mail']);
  assert.deepEqual(C.parseQuery('x1y -"a b"').excluded,['a b']);
});
test('invalid input is reported with hints',()=>{
  for(const query of ['OR apple','apple OR','apple OR OR pear','OR'])assert.deepEqual(C.parseQuery(query).errors.filter(e=>/OR/.test(e)),['Put a word on both sides of OR'],query);
  assert.equal(C.parseQuery('OR apple').invalid,true);
  assert.deepEqual(C.parseQuery('-lol').errors,['Add a word to search for']);
  assert.deepEqual(C.parseQuery('-lol -"a b"').errors,['Add a word to search for']);
  assert.equal(C.parseQuery('from:alice -lol').invalid,false);
  assert.equal(C.parseQuery('has:image -lol').invalid,false);
  assert.equal(C.parseQuery('after:2024-01-01 -lol').invalid,false);
  assert.equal(C.parseQuery('from:alice OR bob').invalid,true);
  assert.equal(hit('-lol','anything'),false);
  assert.equal(C.matchesQuery({text:'hello',author:'alice'},'from:alice -lol'),true);assert.equal(C.matchesQuery({text:'hello lol',author:'alice'},'from:alice -lol'),false);
});
test('terms and phrases hold positive words only; highlights skip excluded words',()=>{
  const parsed=C.parseQuery('coffee OR tea -decaf -"iced latte"');
  assert.deepEqual(parsed.terms,['coffee','tea']);assert.deepEqual(parsed.phrases,[]);assert.deepEqual(parsed.excluded,['decaf','iced latte']);
  const text='coffee and tea, never decaf';
  assert.deepEqual(C.highlightRanges(text,parsed).map(([a,b])=>text.slice(a,b)),['coffee','tea']);
  const shown=C.excerpt(text,'tea -decaf');
  assert.deepEqual(shown.ranges.map(([a,b])=>shown.text.slice(a,b)),['tea']);
  assert.ok(C.relevanceScore('tea tea','tea OR coffee')>C.relevanceScore('nothing','tea OR coffee'));
  assert.equal(C.relevanceScore('decaf','tea -decaf'),0);
});
test('CJK and emoji work with OR',()=>{
  assert.equal(hit('猫猫猫 OR 犬犬犬','今日は 犬犬犬 です'),true);
  assert.equal(hit('猫猫猫 OR 犬犬犬','鳥鳥鳥'),false);
  assert.equal(hit('🎉 OR 🔥','so hot 🔥'),true);
  assert.equal(hit('🎉 OR 🔥','nothing'),false);
  assert.equal(hit('party -🎉','party 🎉'),false);
});
test('short terms keep whole-word rules inside OR and NOT',()=>{
  assert.equal(hit('ab OR zz','cab'),false);assert.equal(hit('ab OR zz','an ab here'),true);
  assert.equal(hit('hello -ab','hello cab'),true);assert.equal(hit('hello -ab','hello ab'),false);
});
test('queries without operators behave as before',()=>{
  assert.equal(hit('red blue','blue and red'),true);assert.equal(hit('red blue','red only'),false);
  assert.equal(hit('"red blue"','blue red'),false);
  assert.equal(C.parseQuery('red blue').hasOperators,false);
});
test('matchesText evaluates plain text',()=>{
  const parsed=C.parseQuery('title OR post -spam');
  assert.equal(C.matchesText(parsed,'A Title here'),true);
  assert.equal(C.matchesText(parsed,'A title with spam'),false);
  assert.equal(C.matchesText(parsed,'unrelated'),false);
  assert.equal(C.matchesText(parsed,null),false);
  assert.equal(C.matchesText(C.parseQuery(''),'anything'),true);
  assert.equal(C.matchesText(C.parseQuery('ab'),'cab',{shortTermsWholeWord:false}),true);
});
test('toArchiveQuery serializes for the archive API',()=>{
  const q=text=>C.toArchiveQuery(C.parseQuery(text));
  assert.equal(q('apple banana'),'apple banana');
  assert.equal(q('"red apple" pie'),'"red apple" pie');
  assert.equal(q('a1 OR b2 OR c3'),'a1 OR b2 OR c3');
  assert.equal(q('coffee -decaf -"iced latte"'),'coffee -decaf -"iced latte"');
  assert.equal(q('coffee tea OR milk from:alice before:2024-01-01 has:image'),'coffee tea OR coffee milk','OR binds first, as in local matching');
  assert.equal(q('from:alice -lol'),'');assert.equal(q(''),'');assert.equal(q('from:alice'),'');
});
test('author and subreddit scopes are opt-in',()=>{
  const off=C.parseQuery('r/india u/spez author:bob');
  assert.deepEqual(off.terms,['r/india','u/spez','author:bob']);assert.equal(off.authors,undefined);
  const on=C.parseQuery('news u/spez author:bob_1 r/india subreddit:AskReddit',{scopes:['author','subreddit']});
  assert.deepEqual(on.authors,['spez','bob_1']);assert.deepEqual(on.subreddits,['india','AskReddit']);assert.deepEqual(on.terms,['news']);
  const authorOnly=C.parseQuery('u/spez r/india',{scopes:['author']});
  assert.deepEqual(authorOnly.authors,['spez']);assert.deepEqual(authorOnly.terms,['r/india']);
  assert.equal(C.parseQuery('u/a',{scopes:['author']}).invalid,true);
  assert.equal(C.parseQuery('r/x',{scopes:['subreddit']}).invalid,true);
  assert.equal(C.parseQuery('-lol u/spez',{scopes:['author']}).invalid,false);
  assert.equal(C.toArchiveQuery(C.parseQuery('news u/spez r/india',{scopes:['author','subreddit']})),'news');
});
test('chat filters ignore OR and -word',()=>{
  const {QueryState,matchPeople}=ctx.RCSGlobalSearchModel,state=new QueryState();
  assert.equal(state.ingestDraft('tea OR coffee -decaf ',{commit:true}),'tea OR coffee -decaf ');
  assert.equal(state.filters.length,0);
  const people=[{id:'1',name:'Tea Club'},{id:'2',name:'Coffee Club'},{id:'3',name:'Decaf Club'}];
  assert.deepEqual(matchPeople(people,'tea OR coffee').map(p=>p.id).sort(),['1','2']);
  assert.deepEqual(matchPeople(people,'club -decaf').map(p=>p.id).sort(),['1','2']);
  assert.deepEqual(matchPeople(people,'-decaf'),[]);
});
test('message store search returns OR and NOT correct results',async()=>{
  const store=new Store({name:crypto.randomUUID()});
  await store.ingest({owner,roomId,events:[event('$1','fresh coffee today',1000),event('$2','green tea please',2000),event('$3','decaf coffee only',3000),event('$4','just water',4000)]});
  const ids=async query=>(await store.search(owner,{query})).records.map(r=>r.id).sort();
  assert.deepEqual(await ids('coffee OR tea'),['$1','$2','$3']);
  assert.deepEqual(await ids('coffee -decaf'),['$1']);
  assert.deepEqual(await ids('coffee OR tea -decaf'),['$1','$2']);
  assert.deepEqual(await ids('coffee -"only"'),['$1']);
  assert.deepEqual(await ids('-water'),[]);
  assert.equal((await store.search(owner,{query:'coffee OR tea',sort:'relevant'})).total,3);
});

test('a missing query is no archive text and matches everything',()=>{
 assert.equal(C.toArchiveQuery(null),'');assert.equal(C.toArchiveQuery(undefined),'');assert.equal(C.toArchiveQuery(''),'');assert.equal(C.matchesText(null,'anything'),true);
});
