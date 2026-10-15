const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const fs=require('node:fs');
const path=require('node:path');

test('chat appearance reads native sidebar typography across shadow roots and follows replacement rows',t=>{
  const dom=new JSDOM('<body><rs-rooms-nav></rs-rooms-nav></body>',{runScripts:'outside-only',url:'https://www.reddit.com/chat'}),w=dom.window;t.after(()=>w.close());
  w.eval(fs.readFileSync(path.join(__dirname,'../extension/adapter.js'),'utf8'));
  const nav=w.document.querySelector('rs-rooms-nav'),root=nav.attachShadow({mode:'open'});
  const build=(size,min)=>{const row=w.document.createElement('rs-rooms-nav-room');const shadow=row.attachShadow({mode:'open'});shadow.innerHTML=`<a class="container" style="min-height:${min}px;padding:8px 12px;column-gap:8px"><span class="avatar" style="width:32px;height:32px"></span><div class="body" style="row-gap:2px"><span class="room-name" style="font:${size}px/20px TestSans;color:rgb(20,20,20)">Synthetic Person</span><span class="last-message" style="font:${size}px/20px TestSans;color:rgb(70,70,70)">Synthetic preview</span><span class="last-message-time" style="font:11px/16px TestSans;color:rgb(70,70,70)">Yesterday</span></div></a>`;return row;};
  root.append(build(14,60));root.firstChild.shadowRoot.querySelector('a').getBoundingClientRect=()=>({height:120});const a=w.RCSAdapter.chatListMetrics(nav);
  assert.match(a['--rcs-row-title-font'],/14px\/20px TestSans/);assert.equal(a['--rcs-row-preview-font'],a['--rcs-row-title-font']);
  assert.equal(a['--rcs-row-time-size'],'11px');assert.equal(a['--rcs-row-avatar-size'],'32px');assert.equal(a['--rcs-row-min-height'],'60px');assert.equal(a['--rcs-row-padding-inline'],'12px');assert.equal(a['--rcs-row-body-gap'],'2px');
  root.replaceChildren(build(18,72));const b=w.RCSAdapter.chatListMetrics(nav);assert.equal(b['--rcs-row-title-size'],'18px');assert.equal(b['--rcs-row-min-height'],'72px');
  root.replaceChildren();assert.equal(w.RCSAdapter.chatListMetrics(nav),null);
});

test('search toolbars use the local native header height in CSS pixels through hiding, resizing and replacement',t=>{
  const dom=new JSDOM('<body></body>',{runScripts:'outside-only',url:'https://www.reddit.com/chat'}),w=dom.window;t.after(()=>w.close());w.eval(fs.readFileSync(path.join(__dirname,'../extension/adapter.js'),'utf8'));
  const build=height=>{const app=w.document.createElement('rs-app'),root=app.attachShadow({mode:'open'}),nav=w.document.createElement('rs-rooms-nav'),room=w.document.createElement('rs-room');room.innerHTML='<main><header>Person</header></main>';root.append(nav,room);w.document.body.append(app);const header=room.querySelector('header');header.style.cssText='height:'+height+'px;box-sizing:border-box';header.getBoundingClientRect=()=>({width:640,height:height*2});return {nav,room,header};};
  const a=build(48),b=build(64);assert.equal(w.RCSAdapter.searchToolbarHeight(a.nav),48);assert.equal(w.RCSAdapter.searchToolbarHeight(b.nav),64,'each chat shell uses its own room');
  b.header.style.display='none';assert.equal(w.RCSAdapter.searchToolbarHeight(b.nav),64,'search may hide the native header');b.header.style.display='block';b.header.style.height='56px';w.document.body.style.setProperty('--fixture-resize','1');assert.equal(w.RCSAdapter.searchToolbarHeight(b.nav),56);
  const next=w.document.createElement('header');next.style.cssText='height:40px;padding:3px;border:1px solid;box-sizing:content-box';b.header.replaceWith(next);assert.equal(w.RCSAdapter.searchToolbarHeight(b.nav),48,'replacement includes padding and border without applying display scale twice');assert.equal(w.RCSAdapter.searchToolbarHeight(b.room),48);
});
