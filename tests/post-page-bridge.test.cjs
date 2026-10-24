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
function nativeCommentHtml({author='Example',next='/svc/shreddit/search/?q=author%3A%22Example%22&type=comments&sort=new&cursor=opaque_cursor'}={}){
 const context=JSON.stringify({comment:{id:'t1_19rktoupyflj9',post_id:'t3_abc12'},post:{id:'t3_abc12',title:'Parent post',nsfw:false,spoiler:false},subreddit:{name:'example'}});
 return `<search-telemetry-tracker data-faceplate-tracking-context='${context}'><div data-testid="search-sdui-comment-unit"><a href="#">${author}</a><a aria-labelledby="comment-content-one" href="/r/example/comments/abc12/title/19rktoupyflj9/"></a><div data-testid="search-comment-content"><div id="search-comment-one-post-rtjson-content"><p>Public &lt;img onerror=bad()&gt; comment</p><a href="/user/Other/">A mentioned user</a></div><faceplate-timeago ts="2026-10-23T14:56:27Z"></faceplate-timeago><faceplate-number number="4"></faceplate-number></div></div></search-telemetry-tracker><faceplate-partial loading="lazy" src='${next}'></faceplate-partial>`;
}
test('native comment search parses inert public cards and follows only its opaque cursor',async t=>{
 const e=setup(t,{url:'https://www.reddit.com/user/Example/comments/',fetcher:async()=>({ok:true,status:200,headers:new Headers(),text:async()=>nativeCommentHtml()})});
 const result=await e.send({action:'profile',kind:'comment',username:'Example'});assert.equal(result.ok,true);assert.equal(result.posts.length,1);assert.equal(result.posts[0].fullname,'t1_19rktoupyflj9');assert.equal(result.posts[0].body,'Public <img onerror=bad()> comment');assert.equal(result.after,'opaque_cursor');
 await e.send({action:'profile',kind:'comment',username:'Example',after:result.after});const u=new URL(e.calls[1][0]);assert.equal(u.pathname,'/svc/shreddit/search/');assert.equal(u.searchParams.get('cursor'),'opaque_cursor');assert.equal(u.searchParams.get('type'),'comments');
});
test('native comment search refuses foreign authors and external pagination',async t=>{
 const foreign=setup(t,{fetcher:async()=>({ok:true,status:200,headers:new Headers(),text:async()=>nativeCommentHtml({author:'Other'})})});assert.equal((await foreign.send({action:'profile',kind:'comment',username:'Example'})).ok,false);
 const e=setup(t,{fetcher:async()=>({ok:true,status:200,headers:new Headers(),text:async()=>nativeCommentHtml({next:'https://evil.test/?cursor=bad'})})});assert.equal((await e.send({action:'profile',kind:'comment',username:'Example'})).after,null);
});
test('public comment status lookups use t1 identities and cannot escape post-detail scope',async t=>{
 const e=setup(t,{url:'https://www.reddit.com/user/Example/comments/'});await e.send({action:'info',kind:'comment',ids:['19rktoupyflj9']});assert.equal(new URL(e.calls[0][0]).searchParams.get('id'),'t1_19rktoupyflj9');
 const detail=setup(t,{url:'https://www.reddit.com/comments/abc12/title/'});assert.equal((await detail.send({action:'info',kind:'comment',ids:['19rktoupyflj9']})).ok,false);assert.equal(detail.calls.length,0);
});
