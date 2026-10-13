const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function setup(t,{detach=false}={}){
  const dom=new JSDOM('<body></body>',{runScripts:'outside-only',pretendToBeVisual:true,url:'https://www.reddit.com/chat'}),w=dom.window;t.after(()=>w.close());
  w.TextEncoder=TextEncoder;w.HTMLElement.prototype.scrollIntoView=function(){};
  const load=file=>w.eval(fs.readFileSync(path.join(__dirname,'..',file),'utf8'));
  for(const file of ['search-core','adapter','date-picker','message-store'])load('extension/'+file+'.js');load('demo/fixture.js');
  const api=w.ChatFixture.build(w.document.body),parent=api.nav.parentNode,records=w.ChatFixture.conversations.map(record=>({...record,type:'direct',timestamp:1791432000000}));
  const store=new w.RCSMessageStore.Store({indexedDB:null});let owner='@t2_me:reddit.com';
  for(const [roomId,events]of api.remoteMessages)await store.ingest({owner,roomId,events});
  const listeners=[],requests=[];w.chrome={storage:{local:{get:async()=>({}),set:async()=>{}}}};
  w.RCSDirectory={getOwner:()=>owner,getStartup:()=>({pending:false,entry:{records,directoryComplete:true}}),onChange:callback=>listeners.push(callback),load:()=>({promise:Promise.resolve(records),cancel(){}})};
  w.RCSMessages={search:parameters=>store.search(owner,parameters),summaries:()=>store.summaries(owner),room:roomId=>store.room(owner,roomId),subscribe:()=>()=>{}};
  w.RCSData={request:(method,args)=>{requests.push({method,...args});if(method==='jump' || method==='open'){api.select(args.roomId);detach?api.nav.remove():api.nav.hidden=true;}return {promise:Promise.resolve({}),cancel(){}};}};
  for(const file of ['global-search-model','media-preview','unified-search-styles','unified-search'])load('extension/'+file+'.js');
  const Base=w.RCSUnifiedSearch,instances=[];w.RCSUnifiedSearch=class extends Base{constructor(...args){super(...args);instances.push(this);}};
  load('extension/content.js');await wait(25);const control=instances[0];assert.ok(control);control.setScope('messages');control.input.value='coffee from:me ';control.input.dispatchEvent(new w.Event('input'));await wait(210);
  return {w,api,parent,control,instances,requests,changeAccount:()=>{owner='@t2_other:reddit.com';for(const callback of listeners)callback({accountChanged:true});}};
}
for(const detach of [false,true])test(`mobile Back restores ${detach?'replaced':'hidden'} sidebar search and its viewport`,async t=>{
  const p=await setup(t,{detach}),c=p.control;assert.ok(c.savedHits.length);c.results.scrollTop=19;
  const text=c.input.value,filters=JSON.stringify(c.queryState.filters),hits=c.savedHits.map(r=>r.id);
  c.shadow.querySelector('.message-open').click();await wait(180);assert.equal(c.suspended,true);assert.equal(c.destroyed,false);
  if(detach){const replacement=p.w.ChatFixture.build(p.w.document.body);p.parent.prepend(replacement.nav);replacement.app.remove();p.api.nav=replacement.nav;}else p.api.nav.hidden=false;
  await wait(180);assert.equal(p.instances.length,1,'reuse the retained controller instead of starting a fresh search');assert.equal(c.suspended,false);
  assert.equal(c.input.value,text);assert.equal(c.scope,'messages');assert.equal(JSON.stringify(c.queryState.filters),filters);assert.deepEqual(c.savedHits.map(r=>r.id),hits);assert.equal(c.results.scrollTop,19);assert.equal(c.host.isConnected,true);
  assert.equal(p.requests.filter(request=>request.method==='jump').length,1);
});
test('retained mobile search is discarded on account change',async t=>{
  const p=await setup(t,{detach:true}),old=p.control;old.shadow.querySelector('.message-open').click();await wait(180);assert.equal(old.suspended,true);
  p.changeAccount();assert.equal(old.destroyed,true);p.parent.prepend(p.api.nav);await wait(180);
  const fresh=p.instances.at(-1);assert.notEqual(fresh,old);assert.equal(fresh.input.value,'');assert.equal(fresh.queryState.filters.length,0);assert.equal(fresh.scope,'people');
});
