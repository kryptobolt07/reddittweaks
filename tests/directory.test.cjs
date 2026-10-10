const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {JSDOM}=require('jsdom');
const source=file=>readFileSync(join(__dirname,'..',file),'utf8');
const tick=ms=>new Promise(resolve=>setTimeout(resolve,ms||30));
async function setup(t,total=401) {
  const dom=new JSDOM('<!doctype html><body></body>',{url:'https://www.reddit.com/chat/',runScripts:'outside-only',pretendToBeVisual:true});
  t.after(()=>dom.window.close());const W=dom.window;W.matchMedia=()=>({matches:true});W.HTMLElement.prototype.scrollIntoView=function(){};
  for(const file of ['demo/fixture.js','extension/directory-model.js','extension/search-core.js','extension/adapter.js','extension/history-store.js','extension/native-identities.js','extension/page-bridge.js','extension/data-client.js'])W.eval(source(file));
  const api=W.ChatFixture.build(W.document.body),client=api.app.querySelector('rs-matrix-client').client;
  const base=await client.getRoomList({page_size:200});api.calls.length=0;
  const rooms=[...base.rooms,...Array.from({length:total-base.rooms.length},(_,i)=>({room_id:'extra-'+i,membership:'join',state:[{type:'com.reddit.chat.type',content:{type:'direct',participants:['@t2_me:reddit.com','@t2_extra_'+i+':reddit.com']}}]}))];
  const target=rooms.at(-1);target.room_id='fantastic';target.state[0].content.participants[1]='@t2_fantastic:reddit.com';
  const users=W.RCSAdapter.query('rs-rooms-nav-room',api.nav).users,original=users.getRedditUserById;
  const profileCalls=[];users.getRedditUserById=async id=>{profileCalls.push(id);return id==='t2_fantastic'?{name:'Fantastic_Care9298'}:id.startsWith('t2_extra_')?{name:id.slice(3)}:original(id);};
  client.getRoomList=async options=>{api.calls.push({method:'rooms',options});const offset=Number(options.next_batch || 0);return {rooms:rooms.slice(offset,offset+200),...(offset+200<rooms.length?{next_batch:String(offset+200)}:{})};};
  return {W,api,client,rooms,profileCalls};
}
test('full discovery reaches a conversation beyond two pages without sync or direct-map requests',async t=>{
  const {W,api,profileCalls}=await setup(t);const records=await W.RCSData.request('conversations').promise;
  assert.equal(records.length,401);assert.equal(records.find(r=>r.id==='fantastic').name,'Fantastic_Care9298');
  assert.equal(api.calls.length,3);assert.deepEqual(Array.from(api.calls,c=>c.options.next_batch),[undefined,'200','400']);
  assert.ok(api.calls.every(c=>c.options.page_size===200));assert.equal(new Set(profileCalls).size,401);
});
test('a failed directory page resumes from its cursor and is never mistaken for a complete response',async t=>{
  const {W,api,client}=await setup(t);const read=client.getRoomList;let fail=true;
  client.getRoomList=async options=>{if(options.next_batch==='200' && fail)throw Object.assign(Error('page failure'),{httpStatus:400});return read(options);};
  await assert.rejects(W.RCSData.request('conversations').promise,/HTTP 400/);
  fail=false;const records=await W.RCSData.request('conversations').promise;
  assert.equal(records.length,401);assert.deepEqual(Array.from(api.calls,c=>c.options.next_batch),[undefined,'200','400']);
});
test('repeated pagination cursors are rejected instead of sending an unbounded request loop',async t=>{
  const {W,api,client}=await setup(t);const read=client.getRoomList;
  client.getRoomList=async options=>({...await read(options),next_batch:'repeated'});
  await assert.rejects(W.RCSData.request('conversations').promise,/pagination stopped advancing/);assert.equal(api.calls.length,2);
});
test('empty-field browsing progressively reveals the entire local directory without more data requests',async t=>{
  const {W,api}=await setup(t,201);W.eval(source('extension/date-picker.js'));W.eval(source('extension/content.js'));await tick(300);
  const root=W.RCSAdapter.query('[data-rcs-ui="list"]',api.nav).shadowRoot,input=root.querySelector('input');
  assert.equal(root.querySelector('.panel').hidden,true);input.focus();assert.equal(root.querySelector('.panel').hidden,false);
  assert.equal(root.querySelectorAll('.result').length,50);const count=api.calls.length;
  for(let i=0;i<4;i++)root.querySelector('.results').dispatchEvent(new W.Event('scroll'));
  assert.equal(root.querySelectorAll('.result').length,201);assert.equal(api.calls.length,count);
  input.value='no-such-person';input.dispatchEvent(new W.Event('input'));assert.equal(root.querySelectorAll('.result').length,0);
  root.querySelector('[aria-label="Clear search"]').click();assert.equal(input.value,'');assert.equal(root.querySelectorAll('.result').length,50);assert.equal(api.calls.length,count);
});
test('avatars receive a URL only when near the visible results and keep their element across searches',async t=>{
  const {W,api}=await setup(t,201);const observers=[];
  W.IntersectionObserver=class {constructor(callback){this.callback=callback;this.targets=new Set();observers.push(this);}observe(target){this.targets.add(target);}unobserve(target){this.targets.delete(target);}disconnect(){this.targets.clear();}};
  W.eval(source('extension/date-picker.js'));W.eval(source('extension/content.js'));await tick(300);
  const root=W.RCSAdapter.query('[data-rcs-ui="list"]',api.nav).shadowRoot,input=root.querySelector('input');input.focus();
  const image=root.querySelector('.result img');assert.equal(image.getAttribute('src'),null);
  assert.notEqual(image.style.display,'none','visibility observation requires an image layout box');
  observers.find(observer=>observer.targets.has(image)).callback([{target:image,isIntersecting:true}]);const url=image.getAttribute('src');assert.match(url,/^https:/);
  input.value='alex_morgan';input.dispatchEvent(new W.Event('input'));assert.equal(root.querySelector('.result img'),image);assert.equal(image.getAttribute('src'),url);
  input.value='';input.dispatchEvent(new W.Event('input'));assert.equal(root.querySelector('.result img'),image);
});
test('conversation dates use existing activity timestamps and omit missing dates without extra requests',async t=>{
  const {W,api,client}=await setup(t,7),getRooms=client.getRooms;
  client.getRooms=()=>getRooms().map(room=>({...room,getLastActiveTimestamp:()=>room.roomId==='alex'?1791432000000:0}));
  W.eval(source('extension/date-picker.js'));W.eval(source('extension/content.js'));await tick(300);
  const root=W.RCSAdapter.query('[data-rcs-ui="list"]',api.nav).shadowRoot,input=root.querySelector('input');
  const calls=api.calls.length;input.value='alex';input.dispatchEvent(new W.Event('input'));
  const date=root.querySelector('.time');assert.equal(date.title,'Last conversation activity');
  assert.equal(date.textContent,new W.Date(1791432000000).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}));
  input.value='fantastic';input.dispatchEvent(new W.Event('input'));
  assert.equal(root.querySelector('.time').textContent,'Date unavailable');assert.match(root.querySelector('.time').title,/not provided/);
  assert.equal(api.calls.length,calls);
});
test('Retry-After waits longer than 30 seconds are honored without an early retry',async t=>{
  const {W,client}=await setup(t,7);const original=client.getRoomList;
  let clock=Date.now(),attempts=0,firstAttempt=0,retryTime=0;
  W.Date.now=()=>clock;const timeout=W.setTimeout.bind(W);
  W.setTimeout=(callback,ms,...args)=>{if(ms<=250){clock+=ms;return timeout(callback,0,...args);}return timeout(callback,ms,...args);};
  client.getRoomList=async options=>{
    attempts++;if(attempts===1){firstAttempt=clock;throw Object.assign(Error('limited'),{httpStatus:429,headers:{'Retry-After':'120'}});}
    retryTime=clock;return original(options);
  };
  assert.equal((await W.RCSData.request('conversations').promise).length,7);
  assert.equal(attempts,2);assert.ok(retryTime-firstAttempt>=120000);
});
