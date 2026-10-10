const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {JSDOM} = require('jsdom');
const source = file => readFileSync(require('node:path').join(__dirname,'..',file),'utf8');
function environment() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>',{url:'https://www.reddit.com/chat/',runScripts:'outside-only',pretendToBeVisual:true});
  dom.window.matchMedia = () => ({matches:true});
  dom.window.HTMLElement.prototype.scrollIntoView = function(){ this.dataset.scrolled='true'; };
  for(const file of ['extension/search-core.js','extension/adapter.js','demo/fixture.js']) dom.window.eval(source(file));
  return dom;
}
const tick = () => new Promise(resolve=>setTimeout(resolve,220));
const plain = value => JSON.parse(JSON.stringify(value));
test('message dates include both selected local days and support open ranges, date-only searches, and invalid input',()=>{
  const dom=environment(),W=dom.window,C=W.RCSCore,index=new C.MessageIndex(Infinity);
  const stamp=(day,h=0,m=0,s=0,ms=0)=>new W.Date(2026,9,day,h,m,s,ms).toISOString();
  index.upsert('room',[{id:'before',text:'needle',timestamp:stamp(7,23,59,59,999)},{id:'start',text:'needle',timestamp:stamp(8)},
    {id:'end',text:'needle',timestamp:stamp(8,23,59,59,999)},{id:'after',text:'needle',timestamp:stamp(9)},{id:'unknown',text:'needle',timestamp:'not a date'}]);
  assert.deepEqual(plain(index.search('room','',{from:'2026-10-08',to:'2026-10-08'}).map(m=>m.id)),['start','end']);
  assert.equal(index.search('room','needle',{from:'2026-10-09'}).length,1);
  assert.equal(index.search('room','needle',{to:'2026-10-07'}).length,1);
  assert.equal(index.search('room','needle',{from:'2026-10-09',to:'2026-10-08'}).length,0);
  assert.equal(index.search('room','needle',{from:'2026-02-30'}).length,0);
  assert.equal(index.search('room','needle').length,5);dom.window.close();
});
test('search treats punctuation literally and matches all words, Unicode, and u/ prefixes',()=>{
  const dom=environment();const C=dom.window.RCSCore;
  assert.equal(C.matches('Alex_Morgan','u/ALEX'),true);
  assert.equal(C.matches('coffee tomorrow','tomorrow coffee'),true);
  assert.equal(C.matches('coffee today','coffee tomorrow'),false);
  assert.equal(C.matches('ＣＯＦＦＥＥ','coffee'),true);
  assert.deepEqual(plain(C.ranges('price [a.b] and [a.b]','[a.b]')),[[6,11],[16,21]]);
  assert.deepEqual(plain(C.ranges('coffee coffee','coffee co')),[[0,6],[7,13]]);
  dom.window.close();
});
test('message index scopes by room, deduplicates stable IDs, accepts edits, and is bounded',()=>{
  const dom=environment();const index=new dom.window.RCSCore.MessageIndex(2);
  index.upsert('one',[{id:'1',text:'coffee'},{id:'2',text:'tea'},{id:'3',text:'coffee tomorrow'}]);
  index.upsert('two',[{id:'1',text:'different conversation'}]);
  assert.equal(index.search('one','').length,2);
  assert.equal(index.search('one','coffee').length,1);
  assert.equal(index.search('two','coffee').length,0);
  index.upsert('one',[{id:'3',text:'edited coffee'}]);
  assert.equal(index.search('one','edited')[0].text,'edited coffee');
  index.clear();assert.equal(index.search('one','').length,0);dom.window.close();
});
test('native adapter traverses the host shadow root and reads the correct message body',()=>{
  const dom=environment();const W=dom.window;const api=W.ChatFixture.build(W.document.body);const A=W.RCSAdapter;
  const rows=A.queryAll(A.selectors.row,api.nav);
  assert.equal(rows.length,5);assert.equal(A.conversation(rows[0]).name,'alex_morgan');
  assert.equal(A.roomKey(api.room),'alex');
  const messages=A.messages(api.room);assert.equal(messages.length,6);
  assert.equal(messages[2].text,'Nice. Want to grab a coffee tomorrow?');
  assert.equal(messages[2].author,'alex_morgan');assert.equal(messages[2].id,'alex-remote-3');
  assert.ok(!messages[2].text.includes('AM'));
  const slotHost=W.document.createElement('div');slotHost.attachShadow({mode:'open'}).innerHTML='<slot></slot>';slotHost.textContent='assigned text';W.document.body.append(slotHost);
  assert.equal(A.text(slotHost),'assigned text');
  const point=A.mountPoint(api.room,A.selectors.header);assert.equal(point.parent.localName,'main');assert.equal(point.before.localName,'rs-room-banners');
  dom.window.close();
});
test('list search filters usernames rather than previews; keyboard selection opens the selected room',async()=>{
  const dom=environment();const W=dom.window;const api=W.ChatFixture.build(W.document.body);W.eval(source('extension/date-picker.js'));W.eval(source('extension/content.js'));
  const control=W.RCSAdapter.query('[data-rcs-ui="list"]',api.nav).shadowRoot;
  const input=control.querySelector('input');
  input.value='coffee';input.dispatchEvent(new W.Event('input'));assert.equal(control.querySelectorAll('.result').length,0);
  input.value='alex';input.dispatchEvent(new W.Event('input'));assert.equal(control.querySelectorAll('.result').length,2);
  input.dispatchEvent(new W.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));
  assert.equal(control.querySelector('.result.active .name').textContent,'alex_morgan');
  input.dispatchEvent(new W.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));assert.equal(api.active.id,'alex');
  input.value='jules';input.dispatchEvent(new W.Event('input'));control.querySelector('.result').click();await tick();
  assert.equal(api.active.id,'jules');assert.equal(control.querySelector('.panel').hidden,true);
  assert.equal(W.RCSAdapter.queryAll('[data-rcs-ui="list"]',api.nav).length,1);
  dom.window.close();
});
test('message search finds and jumps to matches, clears, and resets when a reused room changes',async()=>{
  const dom=environment();const W=dom.window;const api=W.ChatFixture.build(W.document.body);W.eval(source('extension/date-picker.js'));W.eval(source('extension/content.js'));
  const trigger=W.RCSAdapter.query('[data-rcs-ui="message-trigger"]',api.room).shadowRoot.querySelector('button');trigger.click();
  const host=W.RCSAdapter.query('[data-rcs-ui="messages"]',api.room);const control=host.shadowRoot;const input=control.querySelector('input');
  assert.equal(host.parentElement.localName,'main');assert.equal(host.hidden,false);
  input.value='coffee';input.dispatchEvent(new W.Event('input'));assert.equal(control.querySelectorAll('.result').length,2);assert.ok(control.querySelector('mark'));
  input.dispatchEvent(new W.KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true}));assert.equal(control.querySelector('.count').textContent,'2/2');
  assert.equal(W.RCSAdapter.messages(api.room)[2].element.dataset.scrolled,undefined);assert.equal(control.querySelector('.panel').hidden,false);
  input.dispatchEvent(new W.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  assert.equal(W.RCSAdapter.messages(api.room)[2].element.dataset.scrolled,'true');
  control.querySelector('[aria-label="Clear search"]').click();assert.equal(input.value,'');assert.equal(control.querySelector('.panel').hidden,true);
  input.value='coffee';input.dispatchEvent(new W.Event('input'));api.select('jules');await tick();
  const next=W.RCSAdapter.query('[data-rcs-ui="messages"]',api.room).shadowRoot;
  assert.equal(next.querySelector('input').value,'');
  W.RCSAdapter.query('[data-rcs-ui="message-trigger"]',api.room).shadowRoot.querySelector('button').click();
  next.querySelector('input').value='coffee';next.querySelector('input').dispatchEvent(new W.Event('input'));assert.equal(next.querySelectorAll('.result').length,0);
  dom.window.close();
});
test('messages that unload from a virtual timeline remain searchable without retaining their DOM',async()=>{
  const dom=environment();const W=dom.window;const api=W.ChatFixture.build(W.document.body);W.eval(source('extension/date-picker.js'));W.eval(source('extension/content.js'));
  const old=W.RCSAdapter.messages(api.room)[2];old.element.remove();await tick();
  W.RCSAdapter.query('[data-rcs-ui="message-trigger"]',api.room).shadowRoot.querySelector('button').click();
  const control=W.RCSAdapter.query('[data-rcs-ui="messages"]',api.room).shadowRoot;const input=control.querySelector('input');input.value='grab';input.dispatchEvent(new W.Event('input'));
  assert.equal(control.querySelectorAll('.result').length,1);control.querySelector('.result').click();assert.match(control.querySelector('[role="status"]').textContent,/connected/);
  api.appendMessage('alex_morgan','A new coffee message','new-live-id');await tick();input.value='coffee';input.dispatchEvent(new W.Event('input'));assert.equal(control.querySelectorAll('.result').length,3);
  dom.window.close();
});
test('untrusted message text renders as text and never becomes HTML',async()=>{
  const dom=environment();const W=dom.window;const api=W.ChatFixture.build(W.document.body);api.appendMessage('alex_morgan','<img src=x onerror=alert(1)> coffee','xss');W.eval(source('extension/date-picker.js'));W.eval(source('extension/content.js'));
  W.RCSAdapter.query('[data-rcs-ui="message-trigger"]',api.room).shadowRoot.querySelector('button').click();
  const control=W.RCSAdapter.query('[data-rcs-ui="messages"]',api.room).shadowRoot;const input=control.querySelector('input');input.value='onerror';input.dispatchEvent(new W.Event('input'));
  assert.equal(control.querySelectorAll('.result img').length,0);assert.match(control.querySelector('.preview').textContent,/<img/);dom.window.close();
});
test('floating chat inside an anonymous shell works, minimized search restores and focuses the list',async()=>{
  const dom=environment();const W=dom.window;const shell=W.document.createElement('div');W.document.body.append(shell);const root=shell.attachShadow({mode:'open'});
  const resizable=W.document.createElement('div');resizable.id='resizable';root.append(resizable);const api=W.ChatFixture.build(resizable,{compact:true});
  assert.equal(W.document.querySelector('rs-app'),null);W.eval(source('extension/date-picker.js'));W.eval(source('extension/content.js'));
  assert.equal(W.RCSAdapter.queryAll('[data-rcs-ui="list"]',api.app).length,1);
  resizable.hidden=true;const bar=W.document.createElement('div');const restore=W.document.createElement('button');restore.setAttribute('aria-label','Maximize chat view');bar.append(restore);root.append(bar);
  restore.addEventListener('click',()=>{resizable.hidden=false;bar.remove();});await tick();
  assert.equal(W.RCSAdapter.queryAll('[data-rcs-ui="list"]',api.app).length,0);
  const shortcut=root.querySelector('[data-rcs-ui="minimized-search"]');assert.ok(shortcut);shortcut.shadowRoot.querySelector('button').click();await tick();
  const control=W.RCSAdapter.query('[data-rcs-ui="list"]',api.nav).shadowRoot;
  assert.equal(control.activeElement,control.querySelector('input'));assert.equal(root.querySelector('[data-rcs-ui="minimized-search"]'),null);
  assert.equal(W.RCSAdapter.queryAll('[data-rcs-ui="message-trigger"]',api.room).length,1);dom.window.close();
});
test('nothing mounts on an unrelated Reddit feed or thread',()=>{
  const dom=environment();dom.window.document.body.innerHTML='<main><header>Post</header><p>A normal Reddit post</p></main>';dom.window.eval(source('extension/content.js'));
  assert.equal(dom.window.document.querySelector('[data-rcs-ui]'),null);dom.window.close();
});
test('late hydration moves username search below the native Chats header',async()=>{
  const dom=environment();const W=dom.window;const api=W.ChatFixture.build(W.document.body);
  const scroller=api.nav.shadowRoot.querySelector('rs-virtual-scroll');scroller.remove();
  W.eval(source('extension/date-picker.js'));W.eval(source('extension/content.js'));
  const host=W.RCSAdapter.query('[data-rcs-ui="list"]',api.nav);
  assert.equal(api.nav.shadowRoot.firstElementChild.localName,'div');
  api.nav.shadowRoot.append(scroller);await tick();
  assert.equal(host.nextElementSibling,scroller);
  assert.ok(host.previousElementSibling);
  assert.equal(api.nav.shadowRoot.querySelectorAll('[data-rcs-ui="list"]').length,1);
  dom.window.close();
});
test('opaque server sender IDs do not replace an already known native author name',t=>{
  const dom=environment();t.after(()=>dom.window.close());const index=new dom.window.RCSCore.MessageIndex(Infinity);
  index.upsert('room',[{id:'known',text:'coffee',author:'alex_morgan',sender:'@t2_alex:reddit.com',avatar:'https://example.com/avatar.png'}],{dom:true});
  index.upsert('room',[{id:'known',text:'coffee',author:'@t2_alex:reddit.com',sender:'@t2_alex:reddit.com',avatar:''}],{authoritative:true});
  const hit=index.search('room','coffee')[0];assert.equal(hit.author,'alex_morgan');assert.equal(hit.avatar,'https://example.com/avatar.png');
});
test('arrow keys within focused result rows change selection and keep the menu open until Enter',t=>{
  const dom=environment();t.after(()=>dom.window.close());const W=dom.window,api=W.ChatFixture.build(W.document.body);W.eval(source('extension/date-picker.js'));W.eval(source('extension/content.js'));
  W.RCSAdapter.query('[data-rcs-ui="message-trigger"]',api.room).shadowRoot.querySelector('button').click();const root=W.RCSAdapter.query('[data-rcs-ui="messages"]',api.room).shadowRoot,input=root.querySelector('input');input.value='coffee';input.dispatchEvent(new W.Event('input'));
  input.dispatchEvent(new W.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));const first=root.querySelector('.result.active');first.focus();first.dispatchEvent(new W.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));
  assert.equal(root.querySelector('.count').textContent,'2/2');assert.equal(root.activeElement,root.querySelector('.result.active'));assert.equal(root.querySelector('.panel').hidden,false);assert.equal(W.RCSAdapter.messages(api.room).some(m=>m.element.dataset.scrolled),false);
  root.activeElement.dispatchEvent(new W.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));assert.equal(root.querySelector('.panel').hidden,true);assert.equal(W.RCSAdapter.messages(api.room).some(m=>m.element.dataset.scrolled),true);
});
test('authoritative replacement preserves known native identities and shares them only by verified sender',t=>{
  const dom=environment();t.after(()=>dom.window.close());const index=new dom.window.RCSCore.MessageIndex(Infinity);
  index.upsert('room',[{id:'named',text:'old body',author:'alex_morgan',sender:'@t2_alex:reddit.com',avatar:'https://example.com/alex.png'},{id:'remove',text:'stale body',author:'Other',sender:'@t2_other:reddit.com'}],{dom:true});
  index.replace('room',[{id:'named',text:'edited body',author:'@t2_alex:reddit.com',sender:'@t2_alex:reddit.com'},{id:'grouped',text:'next message',author:'@t2_alex:reddit.com',sender:'@t2_alex:reddit.com'},{id:'unresolved',text:'unknown message',author:'@t2_new:reddit.com',sender:'@t2_new:reddit.com'}]);
  assert.equal(index.rooms.get('room').has('remove'),false);assert.equal(index.rooms.get('room').get('named').text,'edited body');
  for(const id of ['named','grouped']){assert.equal(index.rooms.get('room').get(id).author,'alex_morgan');assert.equal(index.rooms.get('room').get(id).avatar,'https://example.com/alex.png');}
  assert.equal(index.rooms.get('room').get('unresolved').author,'@t2_new:reddit.com');
  index.upsert('room',[{id:'named',text:'changed sender',sender:'@t2_new:reddit.com'}],{authoritative:true});assert.equal(index.rooms.get('room').get('named').author,'');assert.equal(index.rooms.get('room').get('named').avatar,'');
});
test('the signed-in sender stays You through later DOM username refreshes and replacement',t=>{
  const dom=environment();t.after(()=>dom.window.close());const index=new dom.window.RCSCore.MessageIndex(Infinity),sender='@t2_me:reddit.com';
  index.upsert('room',[{id:'self',text:'hello',author:'You',authorSelf:true,sender,avatar:'https://example.com/self.png'}],{authoritative:true});
  index.upsert('room',[{id:'self',text:'hello',author:'kryptobolt200528',sender}],{dom:true});assert.equal(index.search('room','hello')[0].author,'You');
  index.replace('room',[{id:'self',text:'hello',author:'@t2_me:reddit.com',sender}]);assert.equal(index.search('room','hello')[0].author,'You');assert.equal(index.search('room','hello')[0].avatar,'https://example.com/self.png');
  index.upsert('room',[{id:'next-self',text:'next',author:'kryptobolt200528',sender}],{dom:true});assert.equal(index.search('room','next')[0].author,'You');
});
