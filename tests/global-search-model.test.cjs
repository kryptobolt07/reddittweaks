const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
function environment(){const context=vm.createContext({});for(const file of ['search-core.js','global-search-model.js'])vm.runInContext(fs.readFileSync(`extension/${file}`,'utf8'),context);return context;}
const plain=value=>JSON.parse(JSON.stringify(value));

test('applied senders survive editable draft changes and deduplicate normalized identities',()=>{
  const {RCSGlobalSearchModel:{QueryState},RCSCore:C}=environment(),state=new QueryState();
  assert.equal(state.ingestDraft('from:bo'),'from:bo');assert.equal(state.filters.length,0);
  assert.equal(state.ingestDraft('from:Bob '),' ');
  assert.equal(state.ingestDraft('from:Carol',{commit:true}),'');
  state.apply('from','u/bob');assert.equal(state.filters.length,2);
  assert.equal(state.ingestDraft('new phrase'),'new phrase');
  assert.deepEqual(plain(C.parseQuery(state.query('meeting')).from),['bob','carol']);
  assert.equal(C.matchesQuery({author:'Bob',text:'meeting'},state.query('meeting')),true);
  assert.equal(C.matchesQuery({author:'Carol',text:'meeting'},state.query('meeting')),true);
  assert.equal(C.matchesQuery({author:'Bob',text:'holiday'},state.query('meeting')),false);
  assert.equal(state.remove('from:bob'),true);assert.deepEqual(plain(state.filters.map(item=>item.value)),['Carol']);
  state.clear();assert.equal(state.query('  "new phrase"  '),'  "new phrase"  ');
});

test('lifting completed tokens preserves draft phrases and every surrounding whitespace character',()=>{
  const {RCSGlobalSearchModel:{QueryState}}=environment(),state=new QueryState();
  const draft='  "from:Bob has:image"\tfrom:"Bob Builder"\nhello  has:image\tworld ';
  assert.equal(state.ingestDraft(draft),'  "from:Bob has:image"\t\nhello  \tworld ');
  assert.deepEqual(plain(state.filters.map(item=>item.token)),['from:"Bob Builder"','has:image']);
  const incomplete='from:"Bob Builder';assert.equal(state.ingestDraft(incomplete,{commit:true}),incomplete);
  const invalid='has:pdf from: from:Bob:Builder from:foo"bar" ';
  assert.equal(state.ingestDraft(invalid,{commit:true}),invalid);
});

test('recognized media values commit at token end and only one media type remains applied',()=>{
  const {RCSGlobalSearchModel:{QueryState,mediaTypes}}=environment(),state=new QueryState();
  assert.equal(state.ingestDraft('has:vid'),'has:vid');
  for(const type of mediaTypes){assert.equal(state.ingestDraft('has:'+type),'');assert.equal(state.filters.length,1);assert.equal(state.filters[0].value,type);}
  state.apply('from','Bob');state.apply('has','image');
  assert.deepEqual(plain(state.filters.map(item=>item.key)),['from:bob','has:image']);
  assert.equal(state.apply('has','pdf'),null);assert.equal(state.apply('from',''),null);
  const filters=state.filters;filters[0].value='altered';assert.equal(state.filters[0].value,'Bob');
});

test('People and All share literal, phrase, alias, participant and unavailable matching',()=>{
  const {RCSGlobalSearchModel:{matchPeople}}=environment();
  const records=[{id:'group',name:'Team coffee',participants:['BobBuilder','Carol'],type:'group',timestamp:3},
    {id:'bob',name:'BobBuilder',aliases:['Former Bob'],type:'direct',timestamp:2,unread:true},
    {id:'deleted',name:'RetainedName',accountUnavailable:true,type:'direct',timestamp:1},
    {id:'literal',name:'Bob.*',type:'direct',timestamp:4}];
  const ids=(query,options)=>plain(matchPeople(records,query,options).map(record=>record.id));
  assert.deepEqual(ids('bob'),['literal','group','bob']);
  assert.deepEqual(ids('bob.*'),['literal'],'regex metacharacters are literal, as in RCSCore');
  assert.deepEqual(ids('"former bob"'),['bob']);assert.deepEqual(ids('carol'),['group']);
  assert.deepEqual(ids('deleted'),['deleted']);assert.deepEqual(ids('bob',{filter:'unread'}),['bob']);
  assert.deepEqual(ids('bob',{sort:'oldest'}),['bob','group','literal']);
  assert.deepEqual(ids('bob',{filter:record=>record.type==='group'}),['group']);
  assert.deepEqual(ids('bob',{wholeWord:true}),['literal','bob'],'whole-word aliases still match');
  assert.deepEqual(ids('from:bob'),[]);assert.deepEqual(ids('has:image'),[]);assert.deepEqual(ids('has:unknown'),[]);
  assert.deepEqual(ids('before:2026-10-11'),[]);
});

test('model can load before the core and use it lazily after installation',()=>{
  const context=vm.createContext({});vm.runInContext(fs.readFileSync('extension/global-search-model.js','utf8'),context);
  const state=new context.RCSGlobalSearchModel.QueryState();
  vm.runInContext(fs.readFileSync('extension/search-core.js','utf8'),context);
  state.apply('from','Bob');assert.equal(state.query(),'from:Bob');
});

test('shared People matching accepts maps from another realm',()=>{
  const {RCSGlobalSearchModel:{matchPeople}}=environment();const records=new Map([['one',{id:'one',name:'Katwamc',type:'direct'}]]);
  assert.deepEqual(plain(matchPeople(records,'kat').map(record=>record.id)),['one']);
});
