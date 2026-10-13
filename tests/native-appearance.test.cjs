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
