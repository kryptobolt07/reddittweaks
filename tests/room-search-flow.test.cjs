const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function setup(t){
  const dom=new JSDOM('<!doctype html><body></body>',{url:'https://www.reddit.com/chat',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
  t.after(()=>dom.window.close());w.matchMedia=()=>({matches:true});w.HTMLElement.prototype.scrollIntoView=function(){this.dataset.scrolled='true';};
  for(const file of ['search-core.js','global-search-model.js','adapter.js','room-header-actions.js','date-picker.js','unified-search-styles.js','unified-search.js'])w.eval(fs.readFileSync('extension/'+file,'utf8'));
  w.eval(fs.readFileSync('demo/fixture.js','utf8'));const api=w.ChatFixture.build(w.document.body),calls=[];for(const message of w.RCSAdapter.messages(api.room)){const image=w.document.createElement('img');image.src='https://example.invalid/'+(message.author==='You'?'self':'other')+'.png';w.RCSAdapter.query('.user-avatar',message.element).append(image);}
  w.RCSData={request(method,args){calls.push({method,...args});return {promise:new Promise(()=>{}),cancel(){}};}};
  w.eval(fs.readFileSync('extension/content.js','utf8'));
  const host=w.RCSAdapter.query('[data-rcs-ui="messages"]',api.room),root=host.shadowRoot,input=root.querySelector('input'),trigger=w.RCSAdapter.query('[data-rcs-ui="message-trigger"]',api.room).shadowRoot.querySelector('button');
  const key=(key,target=input,extra={})=>target.dispatchEvent(new w.KeyboardEvent('keydown',{key,bubbles:true,composed:true,cancelable:true,...extra}));
  const search=async query=>{trigger.click();input.value=query;input.dispatchEvent(new w.Event('input'));await wait(170);};
  return {w,api,root,input,trigger,calls,key,search};
}
test('switching conversations puts the room search back before the next paint, not after the debounce',async t=>{
  const p=setup(t),other=[...p.w.RCSAdapter.queryAll('rs-rooms-nav-room',p.api.app)].map(row=>row.getAttribute('room')).find(id=>id!==p.api.active.id);
  const trigger=()=>p.w.RCSAdapter.query('[data-rcs-ui="message-trigger"]',p.api.room);assert.ok(trigger()?.isConnected);
  p.api.select(other);assert.equal(trigger(),null,'Reddit re-rendered the room without our trigger');
  for(let i=0;i<3;i++)await Promise.resolve();
  assert.ok(trigger()?.isConnected,'restored within microtasks (before paint)');
});
test('large room results keep a bounded window and scrolling never rereads storage or starts history',async t=>{
  const p=setup(t);let reads=0;
  const records=Array.from({length:600},(_,i)=>({id:'scroll-'+i,text:'scroll result '+i,author:'alex_morgan',timestamp:new Date(1791432000000+i*60000).toISOString()}));
  p.w.RCSMessages={room:async()=>{reads++;return {records};}};
  await p.search('scroll');const results=p.root.querySelector('.results'),calls=p.calls.length,initialReads=reads;
  assert.ok(p.root.querySelectorAll('.result').length<25);assert.ok(p.root.querySelectorAll('.room-spacer').length===2);
  const first=p.root.querySelector('.result');
  for(let i=0;i<20;i++){results.scrollTop=18000+i*10;results.dispatchEvent(new p.w.Event('scroll'));}
  await wait(40);assert.ok(p.root.querySelectorAll('.result').length<25);assert.notEqual(p.root.querySelector('.result'),first);assert.equal(p.calls.length,calls);assert.equal(reads,initialReads);assert.equal(results.scrollTop,18190);
  const anchor=p.root.querySelector('.result');
  p.w.document.dispatchEvent(new p.w.CustomEvent('rcs-history-changed',{detail:JSON.stringify({roomId:'alex',identityOnly:true,complete:false,records:[{id:'new-top',text:'scroll newly arrived result',author:'alex_morgan',timestamp:new Date(1791432000000+600*60000).toISOString()}]})}));
  await wait(40);assert.equal(results.scrollTop,18190,'data updates wait while scrolling is active');
  await wait(280);assert.equal(p.root.querySelector('.result'),anchor,'new messages above preserve the visible content');assert.ok(results.scrollTop>18190);
  p.key('ArrowUp');const active=p.root.querySelector('.result.active');assert.ok(active);assert.match(active.textContent,/scroll result 0/);p.key('Enter');assert.equal(p.calls.at(-1).eventId,'scroll-0');
});
test('room search keeps its loading placeholder until saved data and history settle',async t=>{
  const p=setup(t);let resolveSaved,resolveHistory;
  p.w.RCSMessages={room:()=>new Promise(resolve=>{resolveSaved=resolve;})};
  p.w.RCSData.request=(method,args)=>({promise:new Promise(resolve=>{if(method==='history')resolveHistory=resolve;}),cancel(){}});
  await p.search('you deferred');assert.ok(p.root.querySelector('.skeleton-list'));assert.equal(p.root.querySelector('.empty'),null);
  resolveSaved({records:[]});await wait(20);assert.ok(resolveHistory);assert.ok(p.root.querySelector('.skeleton-list'));assert.equal(p.root.querySelector('.empty'),null);
  resolveHistory([{id:'later-you',author:'alex_morgan',text:'you deferred can find this',timestamp:'2026-10-14T10:00:00Z'}]);await wait(20);assert.equal(p.root.querySelector('.skeleton-list'),null);assert.match(p.root.querySelector('.result').textContent,/you deferred can find this/);
});
test('room list has one result status, sender avatars/names, no redundant jump controls, and immediate local navigation during blocked history',async t=>{
  const p=setup(t);await p.search('coffee');
  assert.equal(p.root.querySelectorAll('.result').length,2);assert.equal(p.root.querySelectorAll('.result .avatar').length,2);assert.equal(p.root.querySelector('.result .name').textContent,'You');assert.equal(p.root.querySelector('.preview .you-prefix'),null);assert.deepEqual([...p.root.querySelectorAll('.result .avatar img')].map(image=>image.getAttribute('src')),['https://example.invalid/self.png','https://example.invalid/other.png']);
  assert.equal(p.root.querySelector('.bar .count,.bar .match-arrow,[aria-label="Close message search"]'),null);assert.match(p.root.querySelector('[role=status]').textContent,/2 results/);assert.equal(p.root.querySelector('.room-filter-bar'),null);assert.equal(p.root.querySelector('[data-control=filter]').parentElement,p.root.querySelector('.field'));assert.equal(p.trigger.getAttribute('aria-expanded'),'true');
  p.root.querySelector('.result').click();assert.equal(p.root.querySelector('.panel').hidden,true);assert.ok(p.w.RCSAdapter.messages(p.api.room).some(message=>message.element.dataset.scrolled==='true'));assert.equal(p.calls.some(call=>call.method==='jump'),false);
  p.input.click();assert.equal(p.root.querySelector('.panel').hidden,false);assert.equal(p.root.querySelectorAll('.result').length,2);
});
test('Escape peels date picker, result view, then search while Ctrl/Cmd F is scoped to the native room',async t=>{
  const p=setup(t),composer=p.w.RCSAdapter.query('.composer input',p.api.room);p.key('f',composer,{ctrlKey:true});assert.equal(p.root.querySelector('.bar').hidden,false);assert.equal(p.root.activeElement,p.input);
  p.input.value='coffee';p.input.dispatchEvent(new p.w.Event('input'));await wait(170);p.root.querySelector('.room-date-toggle').click();assert.equal(p.root.querySelector('.date-popover').hidden,false);p.key('Escape');assert.equal(p.root.querySelector('.date-popover').hidden,true);assert.equal(p.root.querySelector('.panel').hidden,false);
  p.key('Escape');assert.equal(p.root.querySelector('.panel').hidden,true);assert.equal(p.root.querySelector('.bar').hidden,false);p.key('Escape');assert.equal(p.root.querySelector('.bar').hidden,true);assert.equal(p.root.querySelector('.room-filter-bar'),null);assert.equal(p.trigger.getAttribute('aria-expanded'),'false');
  p.key('f',composer,{metaKey:true});assert.equal(p.root.activeElement,p.input);assert.equal(p.root.querySelector('.bar').hidden,false);
});
test('room snippets show deep matches and short terms match whole words only',async t=>{
  const p=setup(t);p.api.appendMessage('alex_morgan','This which think', 'noise');p.api.appendMessage('alex_morgan','Opening sentence '.repeat(30)+'hi there, find this', 'deep');await wait(120);await p.search('hi');
  assert.equal(p.root.querySelectorAll('.result').length,1);assert.equal(p.root.querySelector('mark').textContent,'hi');assert.ok(p.root.querySelector('.preview').textContent.startsWith('…'));assert.equal(p.root.querySelector('.result').getAttribute('aria-label').includes('alex_morgan sent:'),true);
});
test('room calendar exposes cached data dots without restricting unsaved history',async t=>{
  const p=setup(t);p.w.matchMedia=query=>({matches:!/max-width/.test(query)});await p.search('coffee');p.root.querySelector('.room-date-toggle').click();const calendar=p.root.querySelector('.date-popover');assert.ok(calendar.querySelector('.calendar-grid'));assert.equal(calendar.querySelector('.date-range-options'),null);assert.equal(calendar.querySelectorAll('[data-preset]').length,4);const saved=p.w.RCSAdapter.messages(p.api.room)[0].timestamp,date=new p.w.Date(saved);calendar.querySelector('.calendar-year').click();calendar.querySelector(`[data-year="${date.getFullYear()}"]`).click();calendar.querySelector('.calendar-month').click();calendar.querySelector(`[data-month="${date.getMonth()}"]`).click();assert.ok(calendar.querySelector('.has-messages'));assert.equal(calendar.querySelector('[data-date="2026-10-01"]').disabled,false);
});
test('message reveal expands native text and paints exact matches in the text shadow tree without replacing its nodes',async t=>{
  const p=setup(t),event=p.w.RCSAdapter.messages(p.api.room)[0].element,root=event.shadowRoot,body=p.w.document.createElement('rs-text-message'),inner=body.attachShadow({mode:'open'}),span=p.w.document.createElement('span');
  span.textContent='this hi';inner.append(span);root.querySelector('.room-message-text').replaceWith(body);
  const paints=new Map();p.w.CSS={highlights:paints};p.w.Highlight=class {constructor(...ranges){this.ranges=ranges;}};
  const more=p.w.document.createElement('button');more.textContent='Read more';root.append(more);more.addEventListener('click',()=>{span.textContent='this hi there';more.remove();});
  p.w.RCSAdapter.revealMessage(event,'hi');await wait(30);
  assert.equal(more.isConnected,false);assert.equal(inner.firstElementChild,span);assert.equal(span.textContent,'this hi there');assert.equal(paints.get('rcs-message-match').ranges.length,1);assert.equal(paints.get('rcs-message-match').ranges[0].toString(),'hi');assert.ok(inner.querySelector('[data-rcs-hit-style]'));assert.equal(event.dataset.scrolled,'true');
});
test('upward keyboard navigation keeps the whole result below its sticky day header',async t=>{
  const p=setup(t);await p.search('coffee');const results=p.root.querySelector('.results');results.scrollTop=100;results.getBoundingClientRect=()=>({top:50,bottom:250});p.root.querySelector('.day-heading').getBoundingClientRect=()=>({height:28});const rows=[...p.root.querySelectorAll('.result')];rows[1].getBoundingClientRect=()=>({top:60,bottom:115});p.key('ArrowUp');assert.equal(results.scrollTop,82);assert.equal(p.root.querySelector('.result.active'),rows[1]);
});
test('selected senders appear in removable tags and keep the input editable without losing message filtering',async t=>{
  const p=setup(t);await p.search('coffee');p.root.querySelector('[data-control=filter]').click();p.root.querySelector('[data-value="from:"]').click();p.root.querySelector('[data-value="from:them"]').click();
  assert.equal(p.input.value,'coffee');assert.equal(p.root.querySelectorAll('.result').length,1);assert.equal(p.root.querySelector('.result .name').textContent,'alex_morgan');assert.equal(p.root.querySelector('.field .sender-chips'),null);assert.equal(p.root.querySelector('.field').classList.contains('has-senders'),false);assert.equal(p.root.querySelector('.room-filter-toggle').textContent,'');assert.equal(p.root.querySelector('.room-applied-filters .sender-chip-value').textContent,'Other people');assert.equal(p.root.querySelector('.room-applied-filters').hidden,false);
  p.root.querySelector('[aria-label="Clear search"]').click();assert.equal(p.input.value,'');assert.equal(p.root.querySelectorAll('.result').length,3);assert.ok([...p.root.querySelectorAll('.result .name')].every(name=>name.textContent==='alex_morgan'));
  p.root.querySelector('[aria-label="Remove sender them"]').click();assert.equal(p.root.querySelector('.room-applied-filters').hidden,true);assert.equal(p.root.querySelector('.panel').hidden,false);
});
test('room refresh and loading placeholders reuse the global search presentation',async t=>{
  const p=setup(t);await p.search('coffee');const globalRoot=p.w.RCSAdapter.query('[data-rcs-ui="list"]',p.api.nav).shadowRoot;
  assert.equal(p.root.querySelector('.room-refresh svg').outerHTML,globalRoot.querySelector('.rcs-refresh svg').outerHTML);
  p.input.value='missing';p.input.dispatchEvent(new p.w.Event('input'));const skeleton=p.root.querySelector('.skeleton-list');assert.ok(skeleton);assert.equal(skeleton.querySelectorAll('.skeleton-row').length,7);assert.equal(p.root.querySelector('.results').getAttribute('aria-busy'),'true');assert.ok(p.root.querySelector('.room-refresh').classList.contains('busy'));
  await wait(170);assert.equal(p.root.querySelector('.skeleton-list'),skeleton,'pending history retains one placeholder');p.root.querySelector('.room-refresh').click();assert.equal(p.root.querySelector('.skeleton-list'),null);assert.match(p.root.querySelector('.empty').textContent,/No messages match/);
});

test('new room queries and sort changes reset scroll and selection while native updates preserve the same query position',async t=>{
  const p=setup(t);await p.search('coffee');const results=p.root.querySelector('.results');p.key('ArrowDown');results.scrollTop=125;
  p.input.value='tomorrow';p.input.dispatchEvent(new p.w.Event('input'));assert.equal(results.scrollTop,0);await wait(170);assert.equal(results.scrollTop,0);assert.equal(p.root.querySelector('.result.active'),null);
  results.scrollTop=40;p.api.appendMessage('alex_morgan','tomorrow works', 'added-result');await wait(130);assert.equal(results.scrollTop,40);
  p.root.querySelector('[data-control=filter]').click();p.root.querySelector('[data-value=sort]').click();p.root.querySelector('[data-value=oldest]').click();assert.equal(results.scrollTop,0);
});

test('header search replaces native header in place and Back restores the original nodes and styles',async t=>{
  const p=setup(t),header=p.w.RCSAdapter.query(p.w.RCSAdapter.selectors.header,p.api.room),host=p.root.host;header.style.setProperty('display','flex','important');const name=header.querySelector('.name');let clicks=0;name.addEventListener('click',()=>clicks++);
  p.trigger.click();assert.equal(host.nextSibling,header);assert.equal(header.style.display,'none');assert.equal(header.style.getPropertyPriority('display'),'important');assert.equal(host.hasAttribute('data-header-search'),true);assert.equal(p.root.activeElement,p.input);assert.equal(p.input.placeholder,'Search in this chat');assert.equal(p.root.querySelector('.panel').hidden,false);assert.equal(p.root.querySelector('.meta').hidden,false);assert.equal(p.root.querySelector('.room-filter-rail'),null);
  p.root.querySelector('[aria-label="Back to conversation"]').click();assert.equal(header.style.display,'flex');assert.equal(header.style.getPropertyPriority('display'),'important');assert.equal(header.querySelector('.name'),name);name.click();assert.equal(clicks,1);assert.equal(host.hasAttribute('data-header-search'),false);assert.equal(p.root.querySelector('.room-filter-rail'),null);assert.equal(p.trigger.getAttribute('aria-expanded'),'false');p.trigger.click();assert.equal(header.style.display,'none');p.w.dispatchEvent(new p.w.Event('pagehide'));assert.equal(header.style.display,'flex');assert.equal(header.style.getPropertyPriority('display'),'important');
});

test('empty room search displays recent messages just like global message search',async t=>{
  const p=setup(t);let owner='account-a';p.w.RCSDirectory={getOwner:()=>owner,getStartup:()=>({pending:true})};await p.search('');assert.equal(p.input.value,'');assert.equal(p.root.querySelector('.panel').hidden,false);assert.ok(p.root.querySelectorAll('.result').length>0);p.input.value='coffee';p.input.dispatchEvent(new p.w.Event('input'));await wait(170);assert.equal(p.root.querySelectorAll('.result').length,2);p.root.querySelector('[aria-label="Clear search"]').click();assert.equal(p.input.value,'');assert.equal(p.root.querySelector('.panel').hidden,false);assert.ok(p.root.querySelectorAll('.result').length>2);
});

test('live room Boolean results, field groups and error feedback match saved search semantics during history loading',async t=>{
  const p=setup(t),type=async query=>{p.input.value=query;p.input.dispatchEvent(new p.w.Event('input'));await wait(190);};
  for(const [id,body]of [['both','cats dogs'],['cat','cats birds'],['dog','dogs'],['iced','coffee iced latte'],['hot','coffee latte']])p.api.appendMessage('alex_morgan',body,'boolean-'+id);
  await wait(120);p.trigger.click();
  for(const [query,wanted]of [['cats AND dogs',1],['(cats OR dogs) NOT birds',2],['((cats AND dogs) OR dogs) NOT birds',2],['cats NOT from:me',2],['(from:them OR from:me) AND cats',2],['cats NOT has:image',2]]){
    await type(query);assert.equal(p.input.value,query);assert.equal(p.root.querySelectorAll('.result').length,wanted,query);
    for(const mark of p.root.querySelectorAll('mark'))assert.match(mark.textContent,/^(cats|dogs)$/i);
  }
  const calls=p.calls.length;
  for(const query of ['cats AND','(cats OR dogs','cats OR NOT','-"iced latte"']){
    await type(query);assert.equal(p.input.getAttribute('aria-invalid'),'true');
    assert.match(p.root.querySelector('[role=status]').textContent,/both sides|Close the group|word to search|after NOT/);
    assert.equal(p.root.querySelector('.result,.skeleton-list'),null,'invalid input cannot expose stale matches or hide the error behind loading');
  }
  assert.equal(p.calls.length,calls,'invalid input never starts another history request');
});
test('a saved-room read merges with what is in memory instead of dropping messages the store lacks',async t=>{
  const p=setup(t);
  p.w.RCSMessages={room:async()=>({records:[]})};
  p.w.document.dispatchEvent(new p.w.CustomEvent('rcs-history-changed',{detail:JSON.stringify({roomId:p.api.active.id,complete:false,records:[{id:'mem-only',text:'kettle memory only',author:'alex_morgan',timestamp:'2026-10-14T10:00:00Z'}]})}));
  await wait(20);
  await p.search('kettle');await wait(40);
  assert.match(p.root.querySelector('.result')?.textContent || '',/kettle memory only/,'a message not yet saved stays searchable');
});
