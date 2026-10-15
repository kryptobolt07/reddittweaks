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
test('date operators become removable validated filters without changing matching boundaries',()=>{
  const {RCSGlobalSearchModel:{QueryState},RCSCore:C}=environment(),state=new QueryState();
  assert.equal(state.ingestDraft('coffee after:2026-10-01 before:2026-11-01'),'coffee  ');
  assert.deepEqual(plain(state.filters.map(item=>item.kind)),['after','before']);
  assert.equal(C.matchesQuery({text:'coffee',timestamp:'2026-10-01T12:00:00'},state.query('coffee')),true);
  assert.equal(C.matchesQuery({text:'coffee',timestamp:'2026-11-01T12:00:00'},state.query('coffee')),false);
  assert.equal(state.ingestDraft('before:2026-10-15'),'');assert.equal(state.filters.length,3);
  assert.equal(C.matchesQuery({text:'coffee',timestamp:'2026-10-20T12:00:00'},state.query('coffee')),false);
  assert.equal(state.ingestDraft('before:2026-02-30 '),'before:2026-02-30 ');
  assert.equal(state.ingestDraft('"before:2026-10-01"'),'"before:2026-10-01"');
  assert.equal(state.remove('before:2026-10-15'),true);assert.equal(state.filters.length,2);
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

const filterRecords=()=>[
  {id:'group-unread',name:'Zulu team',type:'group',participants:['CoffeeFriend'],unread:true,timestamp:40},
  {id:'group-read',name:'Alpha team',type:'group',aliases:['Coffee club'],timestamp:50},
  {id:'group-request',name:'Group invite',type:'group',membership:'invite',unreadCount:2,timestamp:10},
  {id:'direct-unread',name:'Beta friend',type:'direct',isUnread:true,timestamp:20},
  {id:'direct-request',name:'Charlie invite',type:'reddit_titled_direct',status:'pending',timestamp:30},
  {id:'unavailable',name:'Retained friend',type:'direct',accountUnavailable:true,timestamp:5}
];

test('chat type and status combine independently, including direct and group requests',()=>{
  const {RCSGlobalSearchModel:{matchPeople,roomAllowed}}=environment();
  const records=filterRecords(),ids=options=>plain(matchPeople(records,'',options).map(record=>record.id));
  assert.deepEqual(ids({chatType:'groups',status:'unread'}),['group-unread','group-request']);
  assert.deepEqual(ids({chatType:'groups',status:'requests'}),['group-request']);
  assert.deepEqual(ids({chatType:'direct',status:'requests'}),['direct-request']);
  assert.equal(roomAllowed(records[2],{chatType:'groups'}),true);
  assert.equal(roomAllowed(records[4],{chatType:'direct'}),true);
  assert.equal(roomAllowed(records[5],{chatType:'direct',status:'unavailable'}),true);
  assert.equal(roomAllowed(records[0]),true);
  // Keep the old single-filter contract for existing consumers.
  assert.deepEqual(ids({filter:'groups'}),['group-read','group-unread']);
  assert.deepEqual(ids({filter:'direct'}),['direct-unread','unavailable']);
  assert.deepEqual(ids({filter:'requests'}),['direct-request','group-request']);
  assert.deepEqual(ids({filter:record=>record.timestamp>15,status:'unread'}),['group-unread','direct-unread']);
});

test('counts retain the other dimension and use the same literal name search across realms',()=>{
  const {RCSGlobalSearchModel:{chatFilterCounts,matchPeople}}=environment(),records=filterRecords();
  const map=new Map(records.map(record=>[record.id,record]));
  assert.deepEqual(plain(chatFilterCounts(map,'',{chatType:'groups',status:'unread'})),{
    types:{all:3,direct:1,groups:2},statuses:{all:3,unread:2,requests:1,unavailable:0}
  });
  assert.deepEqual(plain(chatFilterCounts(map,'coffee',{chatType:'groups',status:'unread'})),{
    types:{all:1,direct:0,groups:1},statuses:{all:2,unread:1,requests:0,unavailable:0}
  });
  const literal=[{name:'a.*',type:'direct'},{name:'abc',type:'group'}];
  assert.equal(chatFilterCounts(literal,'a.*').types.all,1);
  for(const query of ['from:Bob','has:image','before:2026-10-01']){
    assert.equal(chatFilterCounts(map,query).types.all,0);
    assert.equal(matchPeople(map,query).length,0);
  }
  assert.deepEqual(plain(chatFilterCounts([])),{types:{all:0,direct:0,groups:0},statuses:{all:0,unread:0,requests:0,unavailable:0}});
});

test('alphabetical and unread-first chat sorts retain chronology as a tie breaker',()=>{
  const {RCSGlobalSearchModel:{matchPeople}}=environment(),records=filterRecords();
  const ids=sort=>plain(matchPeople(records,'',{sort}).map(record=>record.id));
  assert.deepEqual(ids('alphabetical'),['group-read','direct-unread','direct-request','group-request','unavailable','group-unread']);
  assert.deepEqual(ids('unread'),['group-unread','direct-unread','group-request','group-read','direct-request','unavailable']);
  assert.deepEqual(ids('newest'),['group-read','group-unread','direct-request','direct-unread','group-request','unavailable']);
  assert.deepEqual(ids('oldest'),['unavailable','group-request','direct-unread','direct-request','group-unread','group-read']);
  assert.deepEqual(ids((a,b)=>a.id.localeCompare(b.id)),[...records].sort((a,b)=>a.id.localeCompare(b.id)).map(record=>record.id));
});
