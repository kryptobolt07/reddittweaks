const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function setup(t,{detach=false,resize=false}={}){
  const dom=new JSDOM('<body></body>',{runScripts:'outside-only',pretendToBeVisual:true,url:'https://www.reddit.com/chat'}),w=dom.window;t.after(()=>w.close());
  w.TextEncoder=TextEncoder;w.HTMLElement.prototype.scrollIntoView=function(){};
  if(resize)w.ResizeObserver=class{constructor(callback){this.callback=callback;this.targets=new Set();}observe(target){this.targets.add(target);}unobserve(target){this.targets.delete(target);}disconnect(){this.targets.clear();}};
  const load=file=>w.eval(fs.readFileSync(path.join(__dirname,'..',file),'utf8'));
  for(const file of ['search-core','adapter','date-picker','message-store'])load('extension/'+file+'.js');load('demo/fixture.js');
  const api=w.ChatFixture.build(w.document.body),parent=api.nav.parentNode,records=w.ChatFixture.conversations.map(record=>({...record,type:'direct',timestamp:1791432000000}));
  const store=new w.RCSMessageStore.Store({indexedDB:null});let owner='@t2_me:reddit.com';
  for(const [roomId,events]of api.remoteMessages)await store.ingest({owner,roomId,events});
  const listeners=[],requests=[];let searches=0,directoryLoads=0;w.chrome={storage:{local:{get:async()=>({}),set:async()=>{}}}};
  w.RCSDirectory={getOwner:()=>owner,getStartup:()=>({pending:false,entry:{records,directoryComplete:true}}),onChange:callback=>listeners.push(callback),load:()=>{directoryLoads++;return {promise:Promise.resolve(records),cancel(){}};}};
  w.RCSMessages={search:parameters=>{searches++;return store.search(owner,parameters);},summaries:()=>store.summaries(owner),room:roomId=>store.room(owner,roomId),subscribe:()=>()=>{}};
  w.RCSData={request:(method,args)=>{requests.push({method,...args});if(method==='jump' || method==='open'){api.select(args.roomId);detach?api.nav.remove():api.nav.hidden=true;}return {promise:Promise.resolve({}),cancel(){}};}};
  for(const file of ['global-search-model','media-preview','unified-search-styles','unified-search'])load('extension/'+file+'.js');
  const Base=w.RCSUnifiedSearch,instances=[];w.RCSUnifiedSearch=class extends Base{constructor(...args){super(...args);instances.push(this);}};
  load('extension/content.js');await wait(25);const control=instances[0];assert.ok(control);control.setScope('messages');control.input.value='coffee from:me ';control.input.dispatchEvent(new w.Event('input'));await wait(210);
  return {w,api,parent,control,instances,requests,counts:()=>({searches,directoryLoads}),paint:()=>new Promise(resolve=>w.requestAnimationFrame(resolve)),changeAccount:()=>{owner='@t2_other:reddit.com';for(const callback of listeners)callback({accountChanged:true});}};
}
for(const detach of [false,true])test(`mobile Back restores ${detach?'replaced':'hidden'} sidebar search and its viewport`,async t=>{
  const p=await setup(t,{detach}),c=p.control;assert.ok(c.savedHits.length);c.results.scrollTop=19;
  const text=c.input.value,filters=JSON.stringify(c.queryState.filters),hits=c.savedHits.map(r=>r.id);
  c.shadow.querySelector('.message-open').click();await wait(180);assert.equal(c.suspended,true);assert.equal(c.destroyed,false);
  const counts=p.counts();
  if(detach){const replacement=p.w.ChatFixture.build(p.w.document.body);p.parent.prepend(replacement.nav);replacement.app.remove();p.api.nav=replacement.nav;}else p.api.nav.hidden=false;
  await p.paint();assert.equal(p.instances.length,1,'reuse the retained controller instead of starting a fresh search');assert.equal(c.suspended,false,'restore with the first native sidebar paint');
  assert.equal(c.host.hidden,false);assert.equal(c.panel.hidden,false);assert.deepEqual(p.counts(),counts,'Back reuses ready results without another search or directory load');
  assert.equal(c.input.value,text);assert.equal(c.scope,'messages');assert.equal(JSON.stringify(c.queryState.filters),filters);assert.deepEqual(c.savedHits.map(r=>r.id),hits);assert.equal(c.results.scrollTop,19);assert.equal(c.host.isConnected,true);
  assert.equal(p.requests.filter(request=>request.method==='jump').length,1);
});

test('header layout readiness restores the complete retained search immediately',async t=>{
  const p=await setup(t,{resize:true}),c=p.control;c.results.scrollTop=19;
  c.shadow.querySelector('.message-open').click();await p.paint();assert.equal(c.suspended,true);
  const root=p.api.nav.shadowRoot;root.querySelector('.nav-head').remove();
  const header=p.w.document.createElement('rs-room-list-header');header.textContent='Chats';let height=0;header.getBoundingClientRect=()=>({width:320,height});root.prepend(header);
  p.api.nav.hidden=false;await p.paint();assert.equal(c.suspended,false);assert.equal(c.host.hidden,true,'no incorrect above-header mount');
  assert.ok(c.resizeObserver.targets.has(header));const counts=p.counts();
  height=48;c.resizeObserver.callback([{target:header}]);
  assert.equal(c.host.hidden,false);assert.equal(c.panel.hidden,false);assert.equal(c.results.scrollTop,19);assert.deepEqual(p.counts(),counts);
});

test('route-local follow-up discovers a replacement sidebar shadow root on the next frame',async t=>{
  const p=await setup(t,{detach:true}),c=p.control;c.shadow.querySelector('.message-open').click();await p.paint();assert.equal(c.suspended,true);
  const nav=p.w.document.createElement('rs-rooms-nav');p.parent.prepend(nav);
  p.w.requestAnimationFrame(()=>{nav.attachShadow({mode:'open'}).innerHTML='<div class="nav-head">Chats</div><rs-virtual-scroll></rs-virtual-scroll>';});
  await p.paint();await p.paint();assert.equal(c.container,nav);assert.equal(c.host.hidden,false);assert.equal(c.panel.hidden,false);assert.equal(c.suspended,false);
  assert.equal(p.instances.length,1);assert.equal(c.scope,'messages');assert.equal(c.input.value.trim(),'coffee from:me');
});
test('retained mobile search is discarded on account change',async t=>{
  const p=await setup(t,{detach:true}),old=p.control;old.shadow.querySelector('.message-open').click();await wait(180);assert.equal(old.suspended,true);
  p.changeAccount();assert.equal(old.destroyed,true);p.parent.prepend(p.api.nav);await wait(180);
  const fresh=p.instances.at(-1);assert.notEqual(fresh,old);assert.equal(fresh.input.value,'');assert.equal(fresh.queryState.filters.length,0);assert.equal(fresh.scope,'people');
});

test('timeline mutations remain batched and extension redraws do not trigger discovery',async t=>{
  const p=await setup(t),c=p.control;await wait(160);let syncs=0;const sync=c.sync.bind(c);c.sync=()=>{syncs++;return sync();};
  const message=p.w.RCSAdapter.messages(p.api.room)[0].element;message.append(p.w.document.createElement('span'));
  await p.paint();assert.equal(syncs,0,'timeline updates do not take the urgent route path');
  await wait(150);assert.ok(syncs>0,'ordinary native updates still reconcile');
  syncs=0;c.status.textContent='Synthetic status update';await wait(160);assert.equal(syncs,0,'ignore our shadow-root redraws');
});

test('page unload cancels a queued mobile restore',async t=>{
  const p=await setup(t),c=p.control;c.shadow.querySelector('.message-open').click();await p.paint();assert.equal(c.suspended,true);
  const counts=p.counts();p.api.nav.hidden=false;p.w.dispatchEvent(new p.w.PageTransitionEvent('pagehide',{persisted:false}));await p.paint();
  assert.equal(c.destroyed,true);assert.equal(c.host.isConnected,false);assert.deepEqual(p.counts(),counts);
});

test('native scrolling defers ordinary reconciliation until the scroll pauses',async t=>{
  const p=await setup(t),c=p.control;await wait(200);let syncs=0;const sync=c.sync.bind(c);c.sync=()=>{syncs++;return sync();};
  const scroll=p.api.nav.shadowRoot.querySelector('rs-virtual-scroll'),row=p.w.RCSAdapter.query(p.w.RCSAdapter.selectors.row,p.api.nav);
  for(let i=0;i<4;i++){scroll.dispatchEvent(new p.w.Event('scroll'));row.append(p.w.document.createElement('span'));await wait(90);}
  assert.equal(syncs,0,'virtualized updates do not repeatedly rescan during a scroll');
  await wait(250);assert.ok(syncs>0,'the latest native data is reconciled after scrolling');
});

test('sidebar route changes still reconcile immediately while native scrolling',async t=>{
  const p=await setup(t);await wait(200);const scroll=p.api.nav.shadowRoot.querySelector('rs-virtual-scroll');
  scroll.dispatchEvent(new p.w.Event('scroll'));p.api.nav.hidden=true;await p.paint();
  assert.equal(p.control.suspended,true,'navigation remains urgent');
});

test('continuous native scrolling cannot indefinitely postpone reconciliation',async t=>{
  const p=await setup(t),c=p.control;await wait(200);let syncs=0;const sync=c.sync.bind(c);c.sync=()=>{syncs++;return sync();};
  const scroll=p.api.nav.shadowRoot.querySelector('rs-virtual-scroll'),row=p.w.RCSAdapter.query(p.w.RCSAdapter.selectors.row,p.api.nav);
  for(let i=0;i<15;i++){scroll.dispatchEvent(new p.w.Event('scroll'));row.append(p.w.document.createElement('span'));await wait(100);}
  assert.ok(syncs>0,'reconcile at the bounded delay even if scrolling continues');
});
