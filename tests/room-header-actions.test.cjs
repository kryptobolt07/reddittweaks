const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const fs=require('node:fs');
const path=require('node:path');
function setup(t,{width=400,shadowHeader=false}={}){
  const dom=new JSDOM('<!doctype html><body><main></main></body>',{runScripts:'outside-only'}),w=dom.window,container=w.document.querySelector('main');let currentWidth=width;
  container.getBoundingClientRect=()=>({width:currentWidth});const root=shadowHeader?container.attachShadow({mode:'open'}):container;
  const makeHeader=()=>{const header=w.document.createElement('header'),actions=w.document.createElement('div');for(const label of ['Search messages','Chat settings','Open chat in new window','Minimize chat','Close chat','Other action']){const button=w.document.createElement('button');button.setAttribute('aria-label',label);actions.append(button);}header.append(actions);return header;};
  let header=makeHeader();root.append(header);w.eval(fs.readFileSync(path.join(__dirname,'../extension/room-header-actions.js'),'utf8'));
  const adapter={selectors:{header:'header'},query:(selector,element)=>(element.shadowRoot || element).querySelector(selector),queryAll:(selector,element)=>[...element.querySelectorAll(selector)]};
  const actions=w.RCSRoomHeaderActions.attach(container,{adapter}),getHost=()=>header.querySelector('[data-rcs-ui="room-header-actions"]'),native=label=>header.querySelector(`[aria-label="${label}"]`),key=(target,value)=>target.dispatchEvent(new w.KeyboardEvent('keydown',{key:value,bubbles:true,composed:true,cancelable:true}));
  t.after(()=>{actions.destroy();dom.window.close();});return {w,container,root,actions,getHost,native,key,setWidth(value){currentWidth=value;actions.sync();},replace(){header.replaceWith(header=makeHeader());return header;}};
}
test('compact room actions hide only known native settings/popout and proxy original handlers',t=>{
  const p=setup(t),host=p.getHost(),menu=host.shadowRoot.querySelector('[role="menu"]'),trigger=host.shadowRoot.querySelector('.more');
  assert.ok(host);assert.equal(p.native('Chat settings').hidden,true);assert.equal(p.native('Open chat in new window').hidden,true);
  for(const label of ['Search messages','Minimize chat','Close chat','Other action'])assert.equal(p.native(label).hidden,false);
  let clicks=0;const original=p.native('Chat settings');original.addEventListener('click',()=>clicks++);trigger.click();assert.equal(menu.hidden,false);assert.equal(trigger.getAttribute('aria-expanded'),'true');assert.deepEqual([...menu.children].map(el=>el.textContent),['Chat settings','Open chat in new window']);menu.firstChild.click();assert.equal(clicks,1);assert.equal(p.native('Chat settings'),original);assert.equal(menu.hidden,true);
});
test('wide layout and destroy restore native display while preserving other native changes',t=>{
  const p=setup(t,{width:600});assert.equal(p.getHost(),null);const settings=p.native('Chat settings');settings.style.setProperty('display','inline-flex');settings.style.color='red';p.setWidth(400);assert.equal(settings.style.display,'none');settings.style.color='blue';p.setWidth(500);assert.equal(p.getHost(),null);assert.equal(settings.hidden,false);assert.equal(settings.style.display,'inline-flex');assert.equal(settings.style.color,'blue');p.setWidth(400);settings.style.setProperty('display','grid');settings.setAttribute('hidden','until-found');p.actions.destroy();assert.equal(settings.style.display,'grid');assert.equal(settings.getAttribute('hidden'),'until-found');
});
test('menu supports arrow focus, Escape and outside dismissal without intercepting unknown native actions',t=>{
  const p=setup(t),host=p.getHost(),shadow=host.shadowRoot,trigger=shadow.querySelector('.more'),menu=shadow.querySelector('[role="menu"]');let nativeKeys=0;p.container.addEventListener('keydown',()=>nativeKeys++);trigger.focus();p.key(trigger,'ArrowDown');assert.equal(menu.hidden,false);assert.equal(shadow.activeElement,menu.firstChild);p.key(menu.firstChild,'ArrowDown');assert.equal(shadow.activeElement,menu.lastChild);p.key(menu.lastChild,'Escape');assert.equal(menu.hidden,true);assert.equal(shadow.activeElement,trigger);assert.equal(nativeKeys,0);trigger.click();p.w.document.body.dispatchEvent(new p.w.Event('pointerdown',{bubbles:true}));assert.equal(menu.hidden,true);p.key(p.native('Search messages'),'Escape');assert.equal(nativeKeys,1);
});
test('sync follows native header replacements including shadow rooms and respects native disabled/hidden actions',async t=>{
  const p=setup(t,{shadowHeader:true}),original=p.native('Chat settings');p.replace();p.actions.sync();assert.equal(original.hidden,false);assert.ok(p.getHost());const settings=p.native('Chat settings');settings.disabled=true;await Promise.resolve();p.actions.sync();assert.equal(p.getHost().shadowRoot.querySelector('.item').disabled,true);p.actions.destroy();assert.equal(settings.hidden,false);settings.hidden=true;p.actions=p.w.RCSRoomHeaderActions.attach(p.container,{adapter:{selectors:{header:'header'},query:(_,root)=>root.shadowRoot.querySelector('header'),queryAll:(selector,root)=>[...root.querySelectorAll(selector)]}});assert.equal(p.getHost().shadowRoot.querySelectorAll('.item').length,1);
});
