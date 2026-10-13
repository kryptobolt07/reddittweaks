const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {JSDOM}=require('jsdom');
function setup(t,{tag='rs-rooms-nav',native=true}={}) {
  const dom=new JSDOM('<!doctype html><body></body>',{url:'https://www.reddit.com/chat',runScripts:'outside-only'}),w=dom.window;
  if(native)w.customElements.define(tag,class extends w.HTMLElement {});
  const container=w.document.createElement(tag),root=container.attachShadow({mode:'open'});w.document.body.append(container);
  w.eval(readFileSync(join(__dirname,'../extension/adapter.js'),'utf8'));
  t.after(()=>dom.window.close());
  return {w,container,root,adapter:w.RCSAdapter};
}
const dimensions=(element,width,height)=>{element.getBoundingClientRect=()=>({width,height});};

test('native sidebar mount stays unready before the header is inserted and laid out',t=>{
  const {w,container,root,adapter}=setup(t),scroller=w.document.createElement('rs-virtual-scroll');root.append(scroller);
  const pending=adapter.mountPoint(container,'rs-room-list-header');assert.equal(pending.ready,false);assert.equal(pending.before,scroller);
  const header=w.document.createElement('rs-room-list-header');header.textContent='Chats';root.prepend(header);
  assert.equal(adapter.mountPoint(container,'rs-room-list-header').ready,false,'zero-height header must not reveal search');
  dimensions(header,320,48);const mounted=adapter.mountPoint(container,'rs-room-list-header');
  assert.equal(mounted.ready,true);assert.equal(mounted.parent,root);assert.equal(mounted.before,scroller);
});

test('nav filter inside a nested shadow toolbar anchors search beside its outer header',t=>{
  const {w,container,root,adapter}=setup(t),header=w.document.createElement('div'),toolbar=w.document.createElement('rs-toolbar');
  header.append(toolbar);const toolbarRoot=toolbar.attachShadow({mode:'open'});toolbarRoot.innerHTML='<rs-rooms-nav-filter><button>Chats</button></rs-rooms-nav-filter>';
  const scroller=w.document.createElement('rs-virtual-scroll');root.append(header,scroller);dimensions(header,280,48);
  const point=adapter.mountPoint(container,'rs-room-list-header');assert.equal(point.ready,true);assert.equal(point.parent,root);assert.equal(point.before,scroller);assert.equal(point.header,header);
});

test('native header waits for content hydration and becomes unready while minimized or hidden',t=>{
  const {w,container,root,adapter}=setup(t),header=w.document.createElement('rs-room-list-header');root.append(header);dimensions(header,320,48);
  assert.equal(adapter.mountPoint(container,'rs-room-list-header').ready,false,'an empty header placeholder is not hydrated');
  header.attachShadow({mode:'open'}).innerHTML='<button aria-label="New chat"></button>';
  assert.equal(adapter.mountPoint(container,'rs-room-list-header').ready,true);
  container.hidden=true;assert.equal(adapter.mountPoint(container,'rs-room-list-header').ready,false);
  container.hidden=false;dimensions(header,0,0);assert.equal(adapter.mountPoint(container,'rs-room-list-header').ready,false);
  dimensions(header,260,48);assert.equal(adapter.mountPoint(container,'rs-room-list-header').ready,true,'reopening floating/mobile chat restores readiness');
});

test('native room search waits for its main header and keeps its anchor before room banners',t=>{
  const {w,container,root,adapter}=setup(t,{tag:'rs-room'});root.innerHTML='<main><rs-room-banners></rs-room-banners><rs-virtual-scroll></rs-virtual-scroll></main>';
  assert.equal(adapter.mountPoint(container,adapter.selectors.header).ready,false);
  const header=w.document.createElement('header');header.textContent='Synthetic conversation';root.querySelector('main').prepend(header);dimensions(header,680,48);
  const point=adapter.mountPoint(container,adapter.selectors.header);assert.equal(point.ready,true);assert.equal(point.parent.localName,'main');assert.equal(point.before.localName,'rs-room-banners');
});

test('generic layouts and unregistered synthetic native fixtures retain immediate fallback mounting',t=>{
  const {w,container,root,adapter}=setup(t,{native:false});root.innerHTML='<div class="nav-head">Chats</div><rs-virtual-scroll></rs-virtual-scroll>';
  const fixturePoint=adapter.mountPoint(container,'rs-room-list-header');assert.equal(fixturePoint.ready,true);assert.equal(fixturePoint.before.localName,'rs-virtual-scroll');
  const generic=w.document.createElement('div');generic.innerHTML='<div role="list"></div>';w.document.body.append(generic);
  const genericPoint=adapter.mountPoint(generic,'[data-testid="chat-room-header"]');assert.equal(genericPoint.ready,true);assert.equal(genericPoint.before,generic.firstChild);
});

test('unregistered native header placeholders wait for both hydration and layout',t=>{
  for(const tag of ['rs-room-list-header','rs-rooms-nav-filter']) {
    const {w,container,root,adapter}=setup(t,{native:false}),header=w.document.createElement(tag);root.append(header);
    assert.equal(adapter.mountPoint(container,'rs-room-list-header').ready,false,tag+' is not ready before registration');
    dimensions(header,320,48);assert.equal(adapter.mountPoint(container,'rs-room-list-header').ready,false,tag+' still needs content');
    header.attachShadow({mode:'open'}).innerHTML='<button aria-label="New chat"></button>';
    dimensions(header,0,0);assert.equal(adapter.mountPoint(container,'rs-room-list-header').ready,false,tag+' still needs layout');
    dimensions(header,320,48);assert.equal(adapter.mountPoint(container,'rs-room-list-header').ready,true);
  }
});

test('a laid out nav wrapper does not make its empty native filter ready',t=>{
  const {w,container,root,adapter}=setup(t,{native:false}),header=w.document.createElement('div');header.innerHTML='Chats<rs-rooms-nav-filter></rs-rooms-nav-filter>';root.append(header);dimensions(header,320,48);
  assert.equal(adapter.mountPoint(container,'rs-room-list-header').ready,false);
  header.querySelector('rs-rooms-nav-filter').innerHTML='<button>All chats</button>';
  assert.equal(adapter.mountPoint(container,'rs-room-list-header').ready,true);
});
