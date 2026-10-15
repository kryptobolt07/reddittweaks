const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const source=file=>fs.readFileSync(`extension/${file}`,'utf8');
const owner='@t2_self:reddit.com',other='@t2_other:reddit.com';
const avatar='https://example.test/current-self.png',savedAvatar='https://example.test/saved-self.png';

test('identity context exposes a safe native self avatar without reading profiles or importing messages',async t=>{
  const dom=new JSDOM('<body></body>',{url:'https://www.reddit.com/chat/',runScripts:'outside-only'}),W=dom.window;
  t.after(()=>W.close());
  W.eval(fs.readFileSync('demo/fixture.js','utf8'));
  for(const file of ['history-store.js','native-identities.js'])W.eval(source(file));
  const fixture=W.ChatFixture.build(W.document.body),client=fixture.app.querySelector('rs-matrix-client').client;
  let currentAvatar=avatar;const id=client.getUserId();
  client.getUser=person=>person===id?{avatarUrl:currentAvatar,accessToken:'must stay in page world'}:null;
  W.eval(source('page-bridge.js'));W.eval(source('data-client.js'));
  let result=await W.RCSData.request('identity-context').promise;
  assert.deepEqual(JSON.parse(JSON.stringify(result.selfIdentity)),{id,name:'You',self:true,avatar});
  assert.equal(fixture.calls.length,0);
  currentAvatar='javascript:alert(1)';result=await W.RCSData.request('identity-context').promise;
  assert.equal(result.selfIdentity.avatar,'');assert.equal(fixture.calls.length,0);
  client.getUser=()=>{throw Error('native profile temporarily unavailable');};
  result=await W.RCSData.request('identity-context').promise;
  assert.equal(result.owner,id);assert.equal(result.selfIdentity.avatar,'');
});

function harness(t,{store}={}){
  const dom=new JSDOM('',{url:'https://www.reddit.com/chat/',runScripts:'outside-only'}),W=dom.window;
  t.after(()=>W.close());W.TextEncoder=TextEncoder;
  for(const file of ['search-core.js','message-store.js'])W.eval(source(file));
  store ||= new W.RCSMessageStore.Store({indexedDB:null});
  let active=owner,native={id:owner,avatar},changed;
  W.RCSData={request(method){return {promise:Promise.resolve(method==='identity-context'?{owner:active,selfIdentity:native}:{available:false})};}};
  W.chrome={runtime:{onMessage:{addListener(fn){changed=fn;}},async sendMessage(msg){
    if(msg.action==='search')return {ok:true,...await store.search(msg.owner,msg)};
    if(msg.action==='stats')return {ok:true,...await store.stats(msg.owner)};
  }}};
  W.eval(source('message-cache-client.js'));
  return {api:W.RCSMessages,store,setNative(value){native=value;},setAccount(value){active=value;},clear(){changed({scope:'rcs-messages-changed',owner:active,cleared:true});}};
}

test('self avatar is available before any own messages, prefers native data and retains cached fallback',async t=>{
  const h=harness(t);
  assert.equal((await h.api.search({query:'no matching messages'})).total,0);
  assert.equal(h.api.getSelfIdentity().avatar,avatar);
  await h.store.ingest({owner,identities:[{id:owner,self:true,name:'You',avatar:savedAvatar}],events:[]});
  await h.api.search({query:'still no messages'});assert.equal(h.api.getSelfIdentity().avatar,avatar);
  h.setNative({id:owner,avatar:''});await h.api.search({});
  assert.equal(h.api.getSelfIdentity().avatar,savedAvatar,'unknown native avatar retains saved profile');
  const copy=h.api.getSelfIdentity();copy.avatar='mutated';assert.equal(h.api.getSelfIdentity().avatar,savedAvatar);
  const restarted=harness(t,{store:h.store});restarted.setNative(null);await restarted.api.search({});
  assert.equal(restarted.api.getSelfIdentity().avatar,savedAvatar,'fresh attachment can recover the saved profile');
});

test('native self profile is account scoped and Clear removes the retained profile before a new native read',async t=>{
  const h=harness(t);await h.api.search({});
  h.setAccount(other);h.setNative({id:owner,avatar});await h.api.search({});
  assert.equal(h.api.getSelfIdentity(),null,'mismatched native profile cannot cross accounts');
  h.setNative({id:other,avatar:'https://example.test/other.png'});await h.api.search({});
  assert.equal(h.api.getSelfIdentity().id,other);
  h.setAccount(owner);h.setNative(null);await h.api.search({});assert.equal(h.api.getSelfIdentity(),null);
  h.setNative({id:owner,avatar});await h.api.search({});h.clear();
  assert.equal(h.api.getSelfIdentity(),null);
  h.setNative(null);await h.api.search({});assert.equal(h.api.getSelfIdentity(),null,'Clear cannot resurrect an in-memory native snapshot');
  h.setNative({id:owner,avatar});await h.api.search({});assert.equal(h.api.getSelfIdentity().avatar,avatar,'live native profile remains readable after Clear');
});
