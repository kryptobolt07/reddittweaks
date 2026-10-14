const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
function setup(t,{shadow=false}={}){
  const dom=new JSDOM('<body><rs-room></rs-room></body>',{runScripts:'outside-only'});t.after(()=>dom.window.close());const w=dom.window,room=w.document.querySelector('rs-room'),shadowRoot=room.attachShadow({mode:'open'}),root=w.document.createElement('main'),header=w.document.createElement(shadow?'rs-room-header':'header'),host=w.document.createElement('div');
  shadowRoot.append(root);const native=shadow?header.attachShadow({mode:'open'}):header;native.innerHTML='<style>:host{display:block}</style><span class="identity" style="visibility:visible">Synthetic person</span><button aria-label="Settings">Settings</button>';root.append(header,host,w.document.createElement('rs-timeline'));
  w.eval(readFileSync(join(__dirname,'../extension/adapter.js'),'utf8'));return {w,room,root,header,host,native,A:w.RCSAdapter};
}
for(const shadow of [false,true])test(`${shadow?'shadow':'ordinary'} header search preserves native nodes and restores presentation/accessibility`,t=>{
  const {room,root,header,host,native,A}=setup(t,{shadow}),children=[...native.children],identity=native.querySelector('.identity');header.style.cssText='overflow-x:clip;overflow-y:hidden';
  assert.equal(A.syncRoomSearchHeader(room,host),true);assert.equal(host.parentNode,native);assert.equal(root.children.length,2,'there is no extra search row');assert.equal(host.hasAttribute('data-rcs-header-search'),true);assert.equal(identity.style.visibility,'hidden');assert.equal(identity.getAttribute('inert'),'');assert.equal(identity.getAttribute('aria-hidden'),'true');assert.equal(header.style.overflowX,'visible');assert.equal(header.style.overflowY,'visible');assert.equal(native.querySelector('style'),children[0]);
  A.releaseRoomSearchHeader(host);assert.equal(host.parentNode,root);assert.equal(header.nextSibling,host);assert.equal(host.hasAttribute('data-rcs-header-search'),false);assert.deepEqual([...native.children],children);assert.equal(identity.style.visibility,'visible');assert.equal(identity.hasAttribute('inert'),false);assert.equal(identity.hasAttribute('aria-hidden'),false);assert.equal(header.style.overflowX,'clip');assert.equal(header.style.overflowY,'hidden');assert.equal(header.style.position,'');assert.equal(header.style.zIndex,'');assert.doesNotThrow(()=>A.releaseRoomSearchHeader(host));
});
test('native header rerenders can replace overlay/children without losing the search surface',t=>{
  const {room,header,host,A,w}=setup(t);A.syncRoomSearchHeader(room,host);const original=header.querySelector('.identity'),fresh=w.document.createElement('button');fresh.textContent='Updated native control';header.replaceChildren(fresh);assert.equal(host.isConnected,false);A.syncRoomSearchHeader(room,host);assert.equal(host.parentNode,header);assert.equal(fresh.getAttribute('inert'),'');A.releaseRoomSearchHeader(host);assert.equal(fresh.style.visibility,'');assert.equal(fresh.hasAttribute('inert'),false);assert.equal(original.style.visibility,'visible','detached original nodes are restored too');
});
test('replacement headers release the old header and retain the original return position',t=>{
  const {room,root,header,host,A,w}=setup(t);const identity=header.querySelector('.identity');A.syncRoomSearchHeader(room,host);const next=w.document.createElement('header');next.textContent='New native header';header.replaceWith(next);A.syncRoomSearchHeader(room,host);assert.equal(host.parentNode,next);assert.equal(identity.style.visibility,'visible');assert.equal(header.style.position,'');A.releaseRoomSearchHeader(host);assert.equal(host.parentNode,root);assert.equal(next.nextSibling,host);
});
test('native changes during search are retained rather than overwritten on restoration',t=>{
  const {room,header,host,A}=setup(t),identity=header.querySelector('.identity');identity.setAttribute('inert','true');identity.setAttribute('aria-hidden','false');header.style.zIndex='9';A.syncRoomSearchHeader(room,host);assert.equal(header.style.zIndex,'9');identity.style.setProperty('visibility','collapse');identity.setAttribute('aria-hidden','false');A.syncRoomSearchHeader(room,host);header.style.position='sticky';A.releaseRoomSearchHeader(host);assert.equal(identity.style.visibility,'collapse');assert.equal(identity.getAttribute('inert'),'true');assert.equal(identity.getAttribute('aria-hidden'),'false');assert.equal(header.style.position,'sticky');assert.equal(header.style.zIndex,'9');
});
test('a replaced native main gets a fresh connected return marker',t=>{
  const {room,root,header,host,A,w}=setup(t);A.syncRoomSearchHeader(room,host);const next=w.document.createElement('main'),nextHeader=w.document.createElement('header');nextHeader.textContent='Recreated native conversation';next.append(nextHeader,w.document.createElement('rs-timeline'));root.replaceWith(next);A.syncRoomSearchHeader(room,host);assert.equal(host.parentNode,nextHeader);A.releaseRoomSearchHeader(host);assert.equal(host.isConnected,true);assert.equal(host.parentNode,next);assert.equal(nextHeader.nextSibling,host);assert.equal(header.style.position,'');
});
test('a header without its own layout box retains the existing search fallback',t=>{
  const {room,root,header,host,A}=setup(t);header.style.display='contents';assert.equal(A.syncRoomSearchHeader(room,host),false);assert.equal(host.parentNode,root);assert.equal(header.querySelector('.identity').hasAttribute('inert'),false);assert.equal(host.hasAttribute('data-rcs-header-search'),false);
});
test('removing the return marker cannot leave the closed search inside the native header',t=>{
  const {room,root,header,host,A}=setup(t);A.syncRoomSearchHeader(room,host);[...root.childNodes].find(node=>node.nodeType===8).remove();A.releaseRoomSearchHeader(host);assert.equal(host.parentNode,root);assert.equal(header.nextSibling,host);assert.equal(header.querySelector('.identity').hasAttribute('inert'),false);
});
