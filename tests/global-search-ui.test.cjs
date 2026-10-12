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
function setup(t,{compact=false,search,directory,tools=false}={}){
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
  if(directory)W.RCSDirectory=directory;
  if(tools)for(const file of ['extension/unified-search-styles.js','extension/unified-search.js'])W.eval(source(file));
  W.eval(source('extension/content.js'));
  const host=W.RCSAdapter.query('[data-rcs-ui="list"]',api.nav),root=host.shadowRoot,input=root.querySelector('input');
  const all=()=>root.querySelector('[data-scope="all"]').click();
  const query=value=>{input.value=value;input.dispatchEvent(new W.Event('input'));};
  const change=(value,nextData)=>{owner=value.owner;data=nextData || data;for(const listener of listeners)listener(value);};
  return {W,api,host,root,input,all,query,change,nativeCalls,savedCalls,listeners};
}
function visibleRows(root){return [...root.querySelectorAll('.result')].filter(row=>!row.hidden);}
for(const compact of [false,true])test(`${compact?'floating':'full'} All chats stays visible under the calendar and when focus or navigation moves to a room`,async t=>{
  const {W,api,root,input,all,query,nativeCalls,savedCalls}=setup(t,{compact});await wait(20);nativeCalls.length=0;
  all();query('alpha');await wait(140);
  const panel=root.querySelector('.panel'),results=root.querySelector('.results'),scroll=37;
  results.scrollTop=scroll;const rows=visibleRows(root),savedCount=savedCalls.length;
  root.querySelector('[aria-label="Filter by date"]').click();
  assert.equal(panel.hidden,false);assert.equal(root.querySelector('.date-popover').hidden,false);
  assert.equal(visibleRows(root)[0],rows[0]);assert.equal(results.scrollTop,scroll);
  assert.equal(savedCalls.length,savedCount,'opening a calendar does not query messages');assert.equal(nativeCalls.length,0);
  const composer=W.RCSAdapter.query('input[aria-label="Message (demo only)"]',api.room);
  composer.dispatchEvent(new W.Event('pointerdown',{bubbles:true,composed:true}));composer.focus();
  assert.equal(root.querySelector('.date-popover').hidden,true,'outside click closes only the calendar');
  assert.equal(panel.hidden,false);assert.equal(input.value,'alpha');assert.equal(visibleRows(root)[0],rows[0]);assert.equal(results.scrollTop,scroll);
  api.select('jules');await wait(30);
  assert.equal(panel.hidden,false);assert.equal(root.querySelector('[data-scope="all"]').getAttribute('aria-pressed'),'true');assert.equal(input.value,'alpha');assert.equal(savedCalls.length,savedCount);
  input.dispatchEvent(new W.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(panel.hidden,false,'Escape does not change the chosen sidebar view');
  root.querySelector('[data-scope="people"]').click();W.RCSAdapter.query('input[aria-label="Message (demo only)"]',api.room).dispatchEvent(new W.Event('pointerdown',{bubbles:true,composed:true}));
  assert.equal(panel.hidden,true,'People results remain dismissible');
});
test('Escape from the global search field closes its calendar while retaining applied filters and results',async t=>{
  const {W,root,input,all,query}=setup(t);all();query('alpha');await wait(140);
  const toggle=root.querySelector('[aria-label="Filter by date"]');toggle.click();
  input.dispatchEvent(new W.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  assert.equal(root.querySelector('.date-popover').hidden,true);assert.equal(toggle.getAttribute('aria-expanded'),'false');
  assert.equal(root.querySelector('.panel').hidden,false);assert.equal(input.value,'alpha');assert.equal(visibleRows(root).length,2);
});
test('All chats searches only saved messages, preserves separate room rows and exact threaded navigation',async t=>{
  const {W,root,input,all,query,nativeCalls,savedCalls}=setup(t);await wait(20);nativeCalls.length=0;
  all();query('alpha');await wait(140);
  assert.equal(nativeCalls.length,0);assert.equal(savedCalls.at(-1).query,'alpha');
  const rows=visibleRows(root);assert.equal(rows.length,2);assert.equal(rows[1].querySelector('.name').textContent,'You');
  assert.equal(root.querySelector('.coverage'),null);assert.match(root.querySelector('[role=status]').textContent,/2 saved chats/);
  input.dispatchEvent(new W.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));input.dispatchEvent(new W.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));
  assert.equal(nativeCalls.length,0,'arrows only move result focus');
  input.dispatchEvent(new W.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await wait(0);
  assert.deepEqual(nativeCalls.map(call=>({type:call.type,args:JSON.parse(JSON.stringify(call.args))})),[{type:'jump',args:{roomId:'jules',eventId:'shared',thread:true}}]);
  assert.equal(root.querySelector('.panel').hidden,false,'opening a match keeps the selected global sidebar visible');input.dispatchEvent(new W.Event('click'));assert.equal(root.querySelector('.panel').hidden,false);
});
test('floating sidebar keeps the compact field and saved-message date filter uses only local storage',async t=>{
  const {root,host,all,nativeCalls,savedCalls}=setup(t,{compact:true});await wait(20);nativeCalls.length=0;all();await wait(140);
  assert.equal(host.hasAttribute('data-rcs-compact'),true);assert.match(root.querySelector('style').textContent,/height:40px/);
  const toggle=root.querySelector('[aria-label="Filter by date"]');assert.equal(toggle.hidden,false);toggle.click();
  assert.equal(toggle.getAttribute('aria-expanded'),'true');
  assert.equal(root.querySelector('.panel').hidden,false,'the global view stays behind the floating calendar');
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
test('saving failure keeps committed matches visible and Refresh explicitly retries without a history request',async t=>{
  let paused=true;const {all,query,root,savedCalls,nativeCalls}=setup(t,{search:async args=>{if(args.retryWrites)paused=false;return {owner:'fixture-owner',persistent:true,records,total:2,stats:{rooms:2},savingError:paused?'Synthetic quota failure':''};}});
  await wait(20);nativeCalls.length=0;all();query('alpha');await wait(140);
  const row=visibleRows(root)[0];assert.equal(visibleRows(root).length,2);assert.match(root.querySelector('[role=status]').textContent,/Saving paused/);assert.match(root.querySelector('[role=status]').title,/quota failure/);
  root.querySelector('.load').click();assert.equal(visibleRows(root)[0],row,'Refresh retains existing matches while retrying');await wait(140);
  assert.equal(savedCalls.at(-1).retryWrites,true);assert.equal(visibleRows(root)[0],row);assert.doesNotMatch(root.querySelector('[role=status]').textContent,/Saving paused/);assert.equal(nativeCalls.length,0);
});
test('People search includes a named community chat and labels pending invitations separately from usernames',async t=>{
  const {W,api,root,input}=setup(t);await wait(20);
  W.RCSData.request=()=>({promise:Promise.resolve([{id:'community',name:'You have been invited to join r/ExampleCommunity',type:'reddit_modmail',membership:'invite',participantIds:[],identityPending:false}]),cancel(){}});
  root.querySelector('.load').click();await wait(20);input.value='ExampleCommunity';input.dispatchEvent(new W.Event('input'));
  assert.equal(visibleRows(root).length,1);assert.match(visibleRows(root)[0].textContent,/Community chat · Request pending/);
});
test('accepted membership received from saved-directory changes clears a pending caption without another query',async t=>{
  const room={id:'community',name:'r/ExampleCommunity',type:'reddit_modmail',membership:'invite',identityPending:false};let listener,loads=0;
  const directory={getStartup:()=>({pending:false,entry:{directoryComplete:true,records:[room]}}),getOwner:()=> 'fixture-owner',onChange:callback=>{listener=callback;},load:()=>{loads++;return {promise:Promise.resolve([room]),cancel(){}};}};
  const {W,root,input}=setup(t,{directory});await wait(20);input.value='ExampleCommunity';input.dispatchEvent(new W.Event('input'));
  const row=visibleRows(root)[0];assert.match(row.textContent,/Request pending/);const before=loads;
  listener({fromStorage:true,records:[{...room,membership:'join'}]});
  assert.equal(visibleRows(root)[0],row);assert.doesNotMatch(row.textContent,/Request pending/);assert.match(row.textContent,/Community chat/);assert.equal(loads,before);assert.equal(input.value,'ExampleCommunity');
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
test('continuous capture notifications do not starve queries or clear already-visible global matches',async t=>{
  const {all,query,root,change,savedCalls}=setup(t);
  all();query('alpha');
  const interval=setInterval(()=>change({owner:'fixture-owner',changed:true}),15);t.after(()=>clearInterval(interval));
  await wait(180);
  assert.ok(savedCalls.length>0,'query runs while captures are still arriving');
  assert.equal(visibleRows(root).length,2,'matches are visible before the capture stream ends');
  assert.doesNotMatch(root.querySelector('[role=status]').textContent,/0 matches.*0 saved chats/);
  await wait(150);assert.equal(visibleRows(root).length,2,'background refresh preserves current matches');
});
test('a capture arriving during a pending query refreshes once after that query instead of discarding its result',async t=>{
  const pending=[];const {all,query,root,change,savedCalls}=setup(t,{search:args=>new Promise(resolve=>pending.push({args,resolve}))});
  all();query('alpha');assert.equal(root.querySelector('[role=status]').textContent,'Searching saved messages…');await wait(120);
  for(let i=0;i<20;i++)change({owner:'fixture-owner',changed:true});
  pending[0].resolve({owner:'fixture-owner',records:[records[0]],total:1,hasMore:false,importing:true,stats:{rooms:1}});await wait(0);
  assert.equal(visibleRows(root).length,1);assert.match(root.querySelector('[role=status]').textContent,/Saving cached messages/);
  await wait(530);assert.equal(savedCalls.length,2);
  pending[1].resolve({owner:'fixture-owner',records,total:2,hasMore:false,importing:false,stats:{rooms:2}});await wait(0);assert.equal(visibleRows(root).length,2);
});
test('late saved-query completion does not render or refresh a disconnected control',async t=>{
  let resolve;const {all,query,host,change,savedCalls}=setup(t,{search:()=>new Promise(done=>resolve=done)});
  all();query('alpha');await wait(120);change({owner:'fixture-owner',changed:true});host.remove();
  resolve({owner:'fixture-owner',records,total:2,stats:{rooms:2}});await wait(140);
  assert.equal(savedCalls.length,1,'completion cannot start a background refresh after the control is removed');
});


test('individual message search uses sticky days with time-only rows and dates each relevance row',async t=>{
  const {W,api}=setup(t,{tools:true});await wait(20);const host=W.RCSAdapter.query('[data-rcs-ui="messages"]',api.room),root=host.shadowRoot;
  root.querySelector('.toggle').click();const input=root.querySelector('input');input.value='coffee';input.dispatchEvent(new W.Event('input'));await wait(140);
  const rows=visibleRows(root);assert.equal(rows.length,2);assert.equal(root.querySelectorAll('.day-heading').length,1);
  const expected=[33,34].map(minute=>new Date(2026,9,8,9,minute).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'}));
  assert.deepEqual(rows.map(row=>row.querySelector('.time').textContent).sort(),expected.sort());
  for(const row of rows)assert.match(row.querySelector('.time').title,/Thu.*Oct.*8.*2026/);
  root.querySelector('.query-filter').click();root.querySelector('[data-value="relevant"]').click();assert.equal(root.querySelector('.day-heading'),null);
  for(const row of visibleRows(root))assert.match(row.querySelector('.time').textContent,/,/);
  root.querySelector('.query-filter').click();root.querySelector('[data-value="oldest"]').click();assert.equal(root.querySelectorAll('.day-heading').length,1);
  assert.equal(visibleRows(root)[0],rows[1],'changing sort reuses mounted result and avatar nodes');
});
