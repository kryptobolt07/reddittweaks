const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
function setup(t,{url='https://www.reddit.com/user/Example/',fetcher}={}){
  const dom=new JSDOM('<body></body>',{url,runScripts:'outside-only'}),W=dom.window,calls=[];t.after(()=>W.close());W.AbortController=AbortController;
  W.fetch=async(...args)=>{calls.push(args);return fetcher?fetcher(...args):{ok:true,status:200,headers:new Headers(),text:async()=>JSON.stringify({data:{children:[{kind:'t3',data:{id:'abc12',author:'Example',title:'Public',created_utc:1700000000}}],after:'t3_abc12'}})};};
  for(const file of ['post-model.js','post-page-bridge.js'])W.eval(fs.readFileSync('extension/'+file,'utf8'));
  function send(input){return new Promise(resolve=>{const id=crypto.randomUUID(),channel='test';const listener=e=>{const r=JSON.parse(e.detail);if(r.id!==id)return;W.document.removeEventListener('rt-post-response',listener);resolve(r);};W.document.addEventListener('rt-post-response',listener);W.document.dispatchEvent(new W.CustomEvent('rt-post-request',{detail:JSON.stringify({channel,id,...input})}));});}
  return {W,calls,send};
}
test('Reddit reads use a fixed same-origin GET and return only compact public posts',async t=>{
  const e=setup(t),r=await e.send({action:'profile',username:'Example'});assert.equal(r.ok,true);assert.equal(r.posts[0].id,'abc12');const [url,options]=e.calls[0];assert.equal(new URL(url).pathname,'/search.json');assert.equal(new URL(url).searchParams.get('q'),'author:"Example"');assert.equal(options.credentials,'include');assert.equal(options.method,'GET');assert.equal(r.cookie,undefined);
});
test('invalid routes, usernames, cursors and arbitrary operations never fetch',async t=>{
  const e=setup(t);for(const input of [{action:'profile',username:'Other'},{action:'profile',username:'Example',after:'https://evil.test'},{action:'fetch',url:'https://evil.test'},{action:'info',ids:['../bad']}])assert.equal((await e.send(input)).ok,false);assert.equal(e.calls.length,0);
});
test('detail lookup IDs must match the current post, including profile-hosted posts',async t=>{
  const e=setup(t,{url:'https://www.reddit.com/user/Example/comments/abc12/title/'});assert.equal((await e.send({action:'info',ids:['other']})).ok,false);assert.equal((await e.send({action:'info',ids:['abc12']})).ok,true);assert.equal(new URL(e.calls[0][0]).pathname,'/api/info.json');
});
test('rate limits cool down future reads without an automatic retry loop',async t=>{
  const e=setup(t,{fetcher:async()=>({ok:false,status:429,headers:new Headers({'Retry-After':'60'})})});assert.match((await e.send({action:'profile',username:'Example'})).error,/rate limit/);assert.match((await e.send({action:'profile',username:'Example'})).error,/asked us to wait/);assert.equal(e.calls.length,1);
});
test('a response from a previous SPA route is not returned as current data',async t=>{
  let resolve;const e=setup(t,{fetcher:()=>new Promise(r=>resolve=r)}),request=e.send({action:'profile',username:'Example'});e.W.history.pushState({},'','/user/Other/');resolve({ok:true,status:200,headers:new Headers(),text:async()=>JSON.stringify({data:{children:[]}})});assert.match((await request).error,/Page changed/);
});
