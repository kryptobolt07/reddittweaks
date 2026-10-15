const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function setup(t){
  const dom=new JSDOM('<!doctype html><body></body>',{url:'https://www.reddit.com/chat',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
  t.after(()=>dom.window.close());w.matchMedia=()=>({matches:true});w.HTMLElement.prototype.scrollIntoView=function(){this.dataset.scrolled='true';};
  for(const file of ['search-core.js','global-search-model.js','adapter.js','room-header-actions.js','date-picker.js','unified-search-styles.js','unified-search.js'])w.eval(fs.readFileSync('extension/'+file,'utf8'));
  w.eval(fs.readFileSync('demo/fixture.js','utf8'));const api=w.ChatFixture.build(w.document.body),calls=[];
  w.RCSData={request(method,args){calls.push({method,...args});return {promise:new Promise(()=>{}),cancel(){}};}};
  w.eval(fs.readFileSync('extension/content.js','utf8'));
  const host=w.RCSAdapter.query('[data-rcs-ui="messages"]',api.room),root=host.shadowRoot,input=root.querySelector('input'),trigger=w.RCSAdapter.query('[data-rcs-ui="message-trigger"]',api.room).shadowRoot.querySelector('button');
  const key=(key,target=input,extra={})=>target.dispatchEvent(new w.KeyboardEvent('keydown',{key,bubbles:true,composed:true,cancelable:true,...extra}));
  const search=async query=>{trigger.click();input.value=query;input.dispatchEvent(new w.Event('input'));await wait(170);};
  return {w,api,root,input,trigger,calls,key,search};
}
test('room list has one result status, sender names, no repeated avatars or jump controls, and immediate local navigation during blocked history',async t=>{
  const p=setup(t);await p.search('coffee');
  assert.equal(p.root.querySelectorAll('.result').length,2);assert.equal(p.root.querySelector('.result .avatar'),null);assert.equal(p.root.querySelector('.result .name').textContent,'You');assert.equal(p.root.querySelector('.preview .you-prefix'),null);
  assert.equal(p.root.querySelector('.bar .count,.bar .match-arrow,[aria-label="Close message search"]'),null);assert.match(p.root.querySelector('[role=status]').textContent,/2 results/);assert.equal(p.root.querySelector('.room-filter-bar').hidden,false);assert.equal(p.trigger.getAttribute('aria-expanded'),'true');
  p.root.querySelector('.result').click();assert.equal(p.root.querySelector('.panel').hidden,true);assert.ok(p.w.RCSAdapter.messages(p.api.room).some(message=>message.element.dataset.scrolled==='true'));assert.equal(p.calls.some(call=>call.method==='jump'),false);
  p.input.click();assert.equal(p.root.querySelector('.panel').hidden,false);assert.equal(p.root.querySelectorAll('.result').length,2);
});
test('Escape peels date picker, result view, then search while Ctrl/Cmd F is scoped to the native room',async t=>{
  const p=setup(t),composer=p.w.RCSAdapter.query('.composer input',p.api.room);p.key('f',composer,{ctrlKey:true});assert.equal(p.root.querySelector('.bar').hidden,false);assert.equal(p.root.activeElement,p.input);
  p.input.value='coffee';p.input.dispatchEvent(new p.w.Event('input'));await wait(170);p.root.querySelector('.room-date-toggle').click();assert.equal(p.root.querySelector('.date-popover').hidden,false);p.key('Escape');assert.equal(p.root.querySelector('.date-popover').hidden,true);assert.equal(p.root.querySelector('.panel').hidden,false);
  p.key('Escape');assert.equal(p.root.querySelector('.panel').hidden,true);assert.equal(p.root.querySelector('.bar').hidden,false);p.key('Escape');assert.equal(p.root.querySelector('.bar').hidden,true);assert.equal(p.root.querySelector('.room-filter-bar').hidden,true);assert.equal(p.trigger.getAttribute('aria-expanded'),'false');
  p.key('f',composer,{metaKey:true});assert.equal(p.root.activeElement,p.input);assert.equal(p.root.querySelector('.bar').hidden,false);
});
test('room snippets show deep matches and short terms match whole words only',async t=>{
  const p=setup(t);p.api.appendMessage('alex_morgan','This which think', 'noise');p.api.appendMessage('alex_morgan','Opening sentence '.repeat(30)+'hi there, find this', 'deep');await wait(120);await p.search('hi');
  assert.equal(p.root.querySelectorAll('.result').length,1);assert.equal(p.root.querySelector('mark').textContent,'hi');assert.ok(p.root.querySelector('.preview').textContent.startsWith('…'));assert.equal(p.root.querySelector('.result').getAttribute('aria-label').includes('alex_morgan sent:'),true);
});
test('room calendar exposes cached data dots without restricting unsaved history',async t=>{
  const p=setup(t);await p.search('coffee');p.root.querySelector('.room-date-toggle').click();const calendar=p.root.querySelector('.date-popover');assert.equal(calendar.querySelectorAll('[data-preset]').length,4);const saved=p.w.RCSAdapter.messages(p.api.room)[0].timestamp,date=new p.w.Date(saved);calendar.querySelector('.calendar-year').click();calendar.querySelector(`[data-year="${date.getFullYear()}"]`).click();calendar.querySelector('.calendar-month').click();calendar.querySelector(`[data-month="${date.getMonth()}"]`).click();assert.ok(calendar.querySelector('.has-messages'));assert.equal(calendar.querySelector('[data-date="2026-10-01"]').disabled,false);
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
