const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {JSDOM}=require('jsdom');
const source=file=>readFileSync(join(__dirname,'..',file),'utf8');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const records=[
  {id:'shared',roomId:'alex',text:'alpha saved message',author:'alex_morgan',timestamp:'2026-10-08T10:00:00Z'},
  {id:'shared',roomId:'jules',text:'alpha saved reply',authorSelf:true,author:'fixture_user',timestamp:'2026-10-07T10:00:00Z',thread:true}
];
function setup(t,{compact=false,search}={}){
  const dom=new JSDOM('<!doctype html><body></body>',{url:'https://www.reddit.com/chat/',runScripts:'outside-only',pretendToBeVisual:true});
  t.after(()=>dom.window.close());const W=dom.window;W.matchMedia=()=>({matches:true});
  for(const file of ['demo/fixture.js','extension/search-core.js','extension/adapter.js','extension/date-picker.js'])W.eval(source(file));
  const parent=W.document.createElement('div');if(compact)parent.id='resizable';W.document.body.append(parent);
  const api=W.ChatFixture.build(parent,{compact}),nativeCalls=[],savedCalls=[],listeners=new Set();let data=records,owner='fixture-owner';
  W.RCSData={request(type,args){nativeCalls.push({type,args});return {promise:Promise.resolve(type==='history'?[]:[]),cancel(){}};}};
  W.RCSMessages={
    ready:async()=>({owner,persistent:true,stats:{messages:data.length,rooms:2}}),
    search:async args=>{savedCalls.push(args);if(search)return search(args);const bounds=W.RCSCore.dateBounds(args.dates);const filtered=data.filter(r=>W.RCSCore.matches(r.text,args.query) && (!bounds.active || (Date.parse(r.timestamp)>=bounds.start && Date.parse(r.timestamp)<bounds.end)));return {owner,persistent:true,records:filtered.slice(args.offset,args.offset+args.limit),total:filtered.length,hasMore:filtered.length>args.offset+args.limit,stats:{messages:data.length,rooms:data.length?2:0}};},
    room:async room=>({owner,records:data.filter(r=>r.roomId===room),coverage:{complete:false}}),
    subscribe:callback=>{listeners.add(callback);return ()=>listeners.delete(callback);},flush:async()=>{}
  };
  W.eval(source('extension/content.js'));
  const host=W.RCSAdapter.query('[data-rcs-ui="list"]',api.nav),root=host.shadowRoot,input=root.querySelector('input');
  const all=()=>root.querySelector('[data-scope="all"]').click();
  const query=value=>{input.value=value;input.dispatchEvent(new W.Event('input'));};
  const change=(value,nextData)=>{owner=value.owner;data=nextData || data;for(const listener of listeners)listener(value);};
  return {W,api,host,root,input,all,query,change,nativeCalls,savedCalls,listeners};
}
function visibleRows(root){return [...root.querySelectorAll('.result')].filter(row=>!row.hidden);}
test('All chats searches only saved messages, preserves separate room rows and exact threaded navigation',async t=>{
  const {W,root,input,all,query,nativeCalls,savedCalls}=setup(t);await wait(20);nativeCalls.length=0;
  all();query('alpha');await wait(140);
  assert.equal(nativeCalls.length,0);assert.equal(savedCalls.at(-1).query,'alpha');
  const rows=visibleRows(root);assert.equal(rows.length,2);assert.equal(rows[1].querySelector('.name').textContent,'You');
  assert.match(root.querySelector('.coverage').textContent,/History may be incomplete/);assert.match(root.querySelector('[role=status]').textContent,/2 saved chats/);
  input.dispatchEvent(new W.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));input.dispatchEvent(new W.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));
  assert.equal(nativeCalls.length,0,'arrows only move result focus');
  input.dispatchEvent(new W.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await wait(0);
  assert.deepEqual(nativeCalls.map(call=>({type:call.type,args:JSON.parse(JSON.stringify(call.args))})),[{type:'jump',args:{roomId:'jules',eventId:'shared',thread:true}}]);
  assert.equal(root.querySelector('.panel').hidden,true);input.dispatchEvent(new W.Event('click'));assert.equal(root.querySelector('.panel').hidden,false,'focused field reopens results');
});
test('floating sidebar keeps the compact field and saved-message date filter uses only local storage',async t=>{
  const {root,host,all,nativeCalls,savedCalls}=setup(t,{compact:true});await wait(20);nativeCalls.length=0;all();await wait(140);
  assert.equal(host.hasAttribute('data-rcs-compact'),true);assert.match(root.querySelector('style').textContent,/height:32px/);
  const toggle=root.querySelector('[aria-label="Filter by date"]');assert.equal(toggle.hidden,false);toggle.click();
  assert.equal(toggle.getAttribute('aria-expanded'),'true');
  root.querySelector('[data-mode="On"]').click();root.querySelector('.calendar-year').click();root.querySelector('[data-year="2026"]').click();root.querySelector('.calendar-month').click();root.querySelector('[data-month="9"]').click();
  root.querySelector('[data-date="2026-10-08"]').click();root.querySelector('.calendar-apply').click();await wait(140);
  assert.equal(savedCalls.at(-1).dates.from,'2026-10-08');assert.equal(visibleRows(root).length,1);assert.equal(nativeCalls.length,0);
  root.querySelector('[aria-label="Remove date filter"]').click();await wait(140);assert.equal(visibleRows(root).length,2);
  root.querySelector('.load').click();await wait(140);assert.equal(nativeCalls.length,0);
});
test('stale saved queries and account notifications cannot show a previous account result',async t=>{
  const pending=[];const {all,query,root,change}=setup(t,{search:args=>new Promise(resolve=>pending.push({args,resolve}))});
  all();query('old');await wait(120);query('new');await wait(120);
  pending[1].resolve({owner:'fixture-owner',records:[{...records[1],text:'new'}],total:1,hasMore:false,stats:{rooms:1}});await wait(0);
  pending[0].resolve({owner:'fixture-owner',records:[{...records[0],text:'old'}],total:1,hasMore:false,stats:{rooms:1}});await wait(0);
  assert.match(visibleRows(root)[0].textContent,/new/);assert.doesNotMatch(root.querySelector('[role=status]').textContent,/still connecting/);
  query('pending');await wait(120);change({owner:'new-account',cleared:true},[]);assert.equal(visibleRows(root).length,0);
  pending[2].resolve({owner:'fixture-owner',records:[records[0]],total:1,hasMore:false,stats:{rooms:1}});await wait(0);assert.equal(visibleRows(root).length,0);
});
test('empty saved cache explains coverage without triggering network history',async t=>{
  const {all,change,root,nativeCalls}=setup(t);await wait(20);nativeCalls.length=0;change({owner:'fixture-owner',cleared:true},[]);all();await wait(140);
  assert.match(root.querySelector('.empty').textContent,/No saved messages yet/);assert.equal(nativeCalls.length,0);
});
test('individual searches show saved room messages before a missing native history request completes',async t=>{
  const {W,api}=setup(t);let resolveHistory;W.RCSData.request=(type,args)=>({promise:type==='history'?new Promise(resolve=>resolveHistory=resolve):Promise.resolve([]),cancel(){}});
  const A=W.RCSAdapter,trigger=A.query('[data-rcs-ui="message-trigger"]',api.room).shadowRoot.querySelector('button');trigger.click();
  const root=A.query('[data-rcs-ui="messages"]',api.room).shadowRoot,input=root.querySelector('input');input.value='saved';input.dispatchEvent(new W.Event('input'));await wait(20);
  assert.equal(visibleRows(root).length,1);assert.match(visibleRows(root)[0].textContent,/alpha saved message/);assert.ok(resolveHistory);resolveHistory([]);
});
test('global cache pagination preserves the full count and returns later pages without network calls',async t=>{
  const items=Array.from({length:235},(_,i)=>({...records[i%2],id:`saved-${i}`,text:`pagination ${i}`}));
  const {all,query,root,savedCalls,nativeCalls}=setup(t,{search:async args=>({owner:'fixture-owner',persistent:true,records:items.slice(args.offset,args.offset+args.limit),total:items.length,hasMore:args.offset+args.limit<items.length,stats:{rooms:2,messages:235}})});
  await wait(20);nativeCalls.length=0;all();query('pagination');await wait(140);
  assert.match(root.querySelector('[role=status]').textContent,/235 matches/);assert.equal(visibleRows(root).length,50);
  assert.match(root.querySelector('.saved-more').textContent,/200 of 235/);root.querySelector('.saved-more').click();await wait(20);
  assert.equal(savedCalls.at(-1).offset,200);assert.equal(visibleRows(root).length,235);assert.equal(root.querySelector('.saved-more'),null);assert.equal(nativeCalls.length,0);
});
test('saved events update edits and delete redacted matches without fetching history; destruction unsubscribes',async t=>{
  const {W,root,all,query,change,nativeCalls,listeners}=setup(t);await wait(20);nativeCalls.length=0;all();query('alpha');await wait(140);
  change({owner:'fixture-owner',roomIds:['alex']},[{...records[0],text:'edited content'}]);await wait(140);assert.equal(visibleRows(root).length,0);assert.equal(nativeCalls.length,0);
  query('edited');await wait(140);assert.equal(visibleRows(root).length,1);change({owner:'fixture-owner',cleared:true},[]);await wait(140);assert.equal(visibleRows(root).length,0);assert.equal(nativeCalls.length,0);
  assert.equal(listeners.size,2);W.dispatchEvent(new W.PageTransitionEvent('pagehide',{persisted:false}));assert.equal(listeners.size,0);
});
