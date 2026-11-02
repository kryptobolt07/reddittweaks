const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const post={id:'synthetic',author:'Writer',subreddit:'Alpha',title:'Synthetic post',selftext:'Synthetic body',created_utc:1700000000,is_self:true};
const listing=(children,after=null)=>({kind:'Listing',data:{children,after}});
const json=value=>JSON.stringify(value);
function setup(t,{url='https://www.reddit.com/user/Example/search/?rt_list=saved',username='Example',fetcher}={}){
 const dom=new JSDOM('<body></body>',{url,runScripts:'outside-only'}),W=dom.window,calls=[];t.after(()=>W.close());W.AbortController=AbortController;
 W.fetch=async(url,options)=>{calls.push({url:new URL(url),options});const response={ok:true,status:200,headers:new Headers(),text:async()=>new URL(url).pathname==='/api/me.json'?json({data:{name:username}}):json(listing([{kind:'t3',data:post}]))};return fetcher?fetcher(new URL(url),options,response):response;};
 for(const file of ['post-model.js','post-page-bridge.js'])W.eval(fs.readFileSync('extension/'+file,'utf8'));
 const send=(input,id=crypto.randomUUID())=>new Promise(resolve=>{const listener=event=>{const result=JSON.parse(event.detail);if(result.id!==id)return;W.document.removeEventListener('rt-post-response',listener);resolve(result);};W.document.addEventListener('rt-post-response',listener);W.document.dispatchEvent(new W.CustomEvent('rt-post-request',{detail:json({channel:'own-list-test',id,...input})}));});return {W,calls,send};
}
for(const list of ['saved','hidden','upvoted','downvoted'])test('own '+list+' uses only fixed same-origin cookie-authenticated GET and 100-item cursors',async t=>{
 const s=setup(t);const result=await s.send({action:'own-list',username:'EXAMPLE',list,after:'t3_cursor'});assert.equal(result.ok,true);assert.equal(result.posts[0].author,'Writer');assert.equal(result.scanned,1);assert.equal(result.hasMore,false);assert.equal(result.incomplete,true);
 assert.deepEqual(s.calls.map(c=>c.url.pathname),['/api/me.json','/user/Example/'+list+'.json']);const url=s.calls[1].url;assert.equal(url.searchParams.get('limit'),'100');assert.equal(url.searchParams.get('raw_json'),'1');assert.equal(url.searchParams.get('after'),'t3_cursor');for(const call of s.calls){assert.equal(call.url.origin,'https://www.reddit.com');assert.equal(call.options.method,'GET');assert.equal(call.options.credentials,'include');assert.equal(call.options.redirect,'error');assert.equal(call.options.cache,'no-store');}assert.equal(result.cookie,undefined);
});
test('Saved bridge normalizes comments and preserves Reddit order without an author restriction',async t=>{
 const comment={id:'comment',link_id:'t3_synthetic',parent_id:'t3_synthetic',author:'Another',subreddit:'Alpha',body:'Synthetic comment',created_utc:1700000001};
 const s=setup(t,{fetcher:async(url,options,response)=>url.pathname==='/api/me.json'?response:{...response,text:async()=>json(listing([{kind:'t1',data:comment},{kind:'t3',data:post}],'t1_comment'))}});const result=await s.send({action:'own-list',username:'Example',list:'saved'});assert.equal(result.ok,true);assert.deepEqual(result.posts.map(p=>p.fullname),['t1_comment','t3_synthetic']);assert.equal(result.posts[0].kind,'comment');assert.equal(result.posts[0].body,'Synthetic comment');assert.equal(result.after,'t1_comment');assert.equal(result.hasMore,true);
});
test('identity action returns only the authenticated account name',async t=>{
 const s=setup(t);const result=await s.send({action:'own-list-identity',username:'Example'});assert.equal(result.username,'Example');assert.equal(s.calls.length,1);assert.deepEqual(Object.keys(result).sort(),['channel','id','ok','username']);
});
for(const input of [{username:'Other',list:'saved'},{username:'Example',list:'friends'},{username:'Example',list:'history',after:'t3_cursor'},{username:'Example',list:'saved',after:'https://other.test'},{username:'Example',list:'saved',url:'https://other.test/'},{username:'Example',list:'saved',origin:'https://other.test'},{username:'Example',list:'saved',method:'POST'},{username:'Example',list:'saved',headers:{Authorization:'synthetic'}}])test('own-list bridge rejects invalid scope/input: '+json(input),async t=>{
 const s=setup(t);const result=await s.send({action:'own-list',...input});assert.equal(result.ok,false);assert.equal(s.calls.length,0);
});
for(const url of ['https://other.test/user/Example/search/?rt_list=saved','http://www.reddit.com/user/Example/search/?rt_list=saved','https://www.reddit.com/r/Alpha/'])test('own-list bridge rejects off-origin/insecure/nonprofile location: '+url,async t=>{
 const s=setup(t,{url});assert.equal((await s.send({action:'own-list',username:'Example',list:'saved'})).ok,false);assert.equal(s.calls.length,0);
});
test('signed-in account mismatch rejects before reading any list contents',async t=>{
 const s=setup(t,{username:'Other'});const result=await s.send({action:'own-list',username:'Example',list:'saved'});assert.equal(result.ok,false);assert.match(result.error,/only search your own lists/);assert.equal(s.calls.length,1);
});
for(const status of [401,403,500])test('own-list HTTP '+status+' errors explicitly report incomplete access',async t=>{
 const s=setup(t,{fetcher:(url,options,response)=>url.pathname==='/api/me.json'?response:{...response,ok:false,status}});const result=await s.send({action:'own-list',username:'Example',list:'hidden'});assert.equal(result.ok,false);assert.match(result.error,status===401?/Sign in/:new RegExp('HTTP '+status));assert.equal(result.posts,undefined);
});
test('signed out and network failures do not become empty successful listings',async t=>{
 const out=setup(t,{username:null});const result=await out.send({action:'own-list',username:'Example',list:'saved'});assert.equal(result.ok,false);assert.match(result.error,/Sign in/);assert.equal(out.calls.length,1);
 const network=setup(t,{fetcher:()=>{throw Error('Synthetic network failure');}});const failed=await network.send({action:'own-list',username:'Example',list:'saved'});assert.equal(failed.ok,false);assert.match(failed.error,/network failure/);
});
for(const data of [{data:{children:[],after:null}},listing([{kind:'t1',data:{...post,body:'comment',link_id:'t3_synthetic'}}]),listing([{kind:'t3',data:{id:'broken'}}]),listing([], 'https://other.test'),listing(Array.from({length:101},()=>({kind:'t3',data:post})))])test('malformed list pages are never treated as a complete/empty list: '+json(data).slice(0,100),async t=>{
 const s=setup(t,{fetcher:(url,options,response)=>url.pathname==='/api/me.json'?response:{...response,text:async()=>json(data)}});const result=await s.send({action:'own-list',username:'Example',list:'hidden'});assert.equal(result.ok,false);assert.equal(result.posts,undefined);
});
test('History fetches HTML once and returns only normalized posts, never HTML/scripts',async t=>{
 const html='<main><shreddit-post id="t3_synthetic" author="Writer" subreddit-name="Alpha" post-title="Synthetic History" created-timestamp="2023-11-14T22:13:20.000Z" post-type="image" content-href="https://example.test/synthetic.jpg" permalink="/r/Alpha/comments/synthetic/test/" nsfw="false" spoiler="false" score="3" comment-count="2"><span slot="text-body">Synthetic body</span><span slot="post-flair">News</span></shreddit-post></main><script>privateState="synthetic-secret"</script>';
 const s=setup(t,{fetcher:(url,options,response)=>url.pathname==='/api/me.json'?response:{...response,text:async()=>html}});const result=await s.send({action:'own-list',username:'Example',list:'history'});assert.equal(result.ok,true);assert.equal(result.posts[0].title,'Synthetic History');assert.equal(result.posts[0].author,'Writer');assert.equal(result.posts[0].body,'Synthetic body');assert.equal(result.posts[0].postType,'image');assert.equal(result.posts[0].over18,false);assert.equal(result.scanned,1);assert.equal(result.hasMore,false);assert.equal(result.incomplete,true);assert.equal(s.calls[1].url.pathname,'/user/Example/history/');assert.equal(s.calls[1].url.search,'');assert.doesNotMatch(json(result),/privateState|synthetic-secret|<script/);
});
for(const html of ['<html>Login or error page</html>','<main><shreddit-post id="t3_synthetic" author="Writer"></shreddit-post></main>'])test('History markup failure never becomes an empty complete result',async t=>{
 const s=setup(t,{fetcher:(url,options,response)=>url.pathname==='/api/me.json'?response:{...response,text:async()=>html}});const result=await s.send({action:'own-list',username:'Example',list:'history'});assert.equal(result.ok,false);assert.match(result.error,/History/);
});
test('History accepts an explicitly empty native feed',async t=>{
 const s=setup(t,{fetcher:(url,options,response)=>url.pathname==='/api/me.json'?response:{...response,text:async()=>'<main><div id="empty-feed-content"></div></main>'}});const result=await s.send({action:'own-list',username:'Example',list:'history'});assert.equal(result.ok,true);assert.equal(result.posts.length,0);assert.equal(result.incomplete,true);
});
test('bridge cancellation aborts the authenticated fetch and rejects the response',async t=>{
 let started;const pending=new Promise(resolve=>started=resolve);const s=setup(t,{fetcher:(url,options,response)=>url.pathname==='/api/me.json'?response:new Promise((resolve,reject)=>{started(options.signal);options.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true});})});const id='cancel-list',task=s.send({action:'own-list',username:'Example',list:'saved'},id);const signal=await pending;s.W.document.dispatchEvent(new s.W.CustomEvent('rt-post-request',{detail:json({channel:'own-list-test',id,action:'cancel'})}));const result=await task;assert.equal(signal.aborted,true);assert.equal(result.ok,false);assert.match(result.error,/cancelled/);
});
test('changing the list scope during a read rejects even on the same search pathname',async t=>{
 let release;const pending=new Promise(resolve=>release=resolve);const s=setup(t,{fetcher:async(url,options,response)=>{if(url.pathname!=='/api/me.json')await pending;return response;}});const task=s.send({action:'own-list',username:'Example',list:'saved'});await new Promise(r=>setImmediate(r));s.W.history.pushState({},'','?rt_list=hidden');release();assert.equal((await task).ok,false);
});
