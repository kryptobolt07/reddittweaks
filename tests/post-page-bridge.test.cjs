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
function nativeTarget(e,{kind='post',id='abc12',target='rt-native-fixture'}={}){
 const w=e.W;let main=w.document.querySelector('main');if(!main){main=w.document.createElement('main');w.document.body.append(main);}const slot=w.document.createElement('div');slot.id=target;slot.dataset.rtUi='activity-item';slot.dataset.rtNativeFullname=(kind==='comment'?'t1_':'t3_')+id;main.append(slot);
 if(!w.customElements.get('faceplate-partial'))w.customElements.define('faceplate-partial',class extends w.HTMLElement{_renderContent(text){this.innerHTML=text;}});
 return slot;
}
const nativeResponse=(html,status=200)=>({ok:status===200,status,headers:new Headers({'content-type':'text/vnd.reddit.partial+html'}),text:async()=>html});
test('native feed cards use the first-party profile renderer without returning authenticated HTML',async t=>{
 const e=setup(t,{fetcher:async()=>nativeResponse('<article><shreddit-post id="t3_abc12"><span slot="credit-bar">Native metadata</span><button aria-label="Upvote">↑</button><button>Share</button><img src="https://i.redd.it/synthetic.png"><input name="csrf_token" value="synthetic-only"></shreddit-post></article><hr>')});const slot=nativeTarget(e);
 const result=await e.send({action:'render-card',username:'Example',kind:'post',postId:'abc12',target:slot.id});assert.equal(result.ok,true);assert.equal(result.rendered,true);assert.equal(result.html,undefined);assert.equal(JSON.stringify(result).includes('synthetic-only'),false);assert.ok(slot.querySelector('[aria-label=Upvote]'));assert.ok(slot.querySelector('img'));
 const u=new URL(e.calls[0][0]);assert.equal(u.pathname,'/svc/shreddit/partial-feed-post/t3_abc12');assert.equal(u.searchParams.get('pvc'),'ProfileFeed2');assert.equal(u.searchParams.get('fvt'),'cardView');assert.equal(slot.dataset.rtNativeState,'ready');
});
test('native comment cards use the observed profile-comment endpoint and preserve native actions',async t=>{
 const e=setup(t,{url:'https://www.reddit.com/user/Example/comments/',fetcher:async()=>nativeResponse('<article><shreddit-profile-comment comment-id="t1_19rktoupyflj9"><button aria-label="Downvote">↓</button><button>Share</button></shreddit-profile-comment></article>')}),slot=nativeTarget(e,{kind:'comment',id:'19rktoupyflj9'});
 const r=await e.send({action:'render-card',username:'Example',kind:'comment',postId:'19rktoupyflj9',target:slot.id});assert.equal(r.rendered,true);const u=new URL(e.calls[0][0]);assert.equal(u.pathname,'/svc/shreddit/comment/t1_19rktoupyflj9');assert.equal(u.searchParams.get('isProfile'),'true');assert.ok(slot.querySelector('[aria-label=Downvote]'));
});
test('native renderer rejects arbitrary targets, identities and unrelated fragments',async t=>{
 const e=setup(t,{fetcher:async()=>nativeResponse('<article>not a matching card</article>')}),slot=nativeTarget(e);
 for(const input of [{target:'main'},{username:'Other'},{postId:'../bad'},{kind:'video'},{target:'rt-native-missing'}])assert.equal((await e.send({action:'render-card',username:'Example',kind:'post',postId:'abc12',target:slot.id,...input})).ok,false);assert.equal(e.calls.length,0);
 assert.equal((await e.send({action:'render-card',username:'Example',kind:'post',postId:'abc12',target:slot.id})).ok,false);assert.equal(slot.childElementCount,0);
});
test('native hydration skips an identity already present in Reddit and rejects stale routes',async t=>{
 let resolve;const e=setup(t,{fetcher:()=>new Promise(r=>resolve=r)}),slot=nativeTarget(e),native=e.W.document.createElement('shreddit-post');native.id='t3_abc12';e.W.document.querySelector('main').append(native);
 const duplicate=await e.send({action:'render-card',username:'Example',kind:'post',postId:'abc12',target:slot.id});assert.equal(duplicate.duplicate,true);assert.equal(e.calls.length,0);native.remove();
 const pending=e.send({action:'render-card',username:'Example',kind:'post',postId:'abc12',target:slot.id});e.W.history.pushState({},'','/user/Other/');resolve(nativeResponse('<shreddit-post id="t3_abc12"></shreddit-post>'));assert.equal((await pending).ok,false);assert.equal(slot.childElementCount,0);
});

test('native cards follow the client’s existing profile view mode',async t=>{
 const e=setup(t,{fetcher:async()=>nativeResponse('<article><shreddit-post id="t3_abc12"></shreddit-post></article>')}),slot=nativeTarget(e);const feed=e.W.document.createElement('shreddit-feed');feed.innerHTML='<shreddit-post id="t3_existing" view-type="compactView" view-context="ProfileFeed2"></shreddit-post>';e.W.document.querySelector('main').append(feed);await e.send({action:'render-card',username:'Example',kind:'post',postId:'abc12',target:slot.id});assert.equal(new URL(e.calls[0][0]).searchParams.get('fvt'),'compactView');
});

test('profile search forwards validated sort and time range and rejects obsolete same-path responses',async t=>{
 const e=setup(t);await e.send({action:'profile',username:'Example',sort:'top',range:'month'});let url=new URL(e.calls[0][0]);assert.equal(url.searchParams.get('sort'),'top');assert.equal(url.searchParams.get('t'),'month');
 await e.send({action:'profile',username:'Example',sort:'hot'});assert.equal(new URL(e.calls[1][0]).searchParams.get('sort'),'hot');assert.equal((await e.send({action:'profile',username:'Example',sort:'arbitrary'})).ok,false);
 let resolve;const stale=setup(t,{fetcher:()=>new Promise(r=>resolve=r)}),pending=stale.send({action:'profile',username:'Example'});stale.W.history.pushState({},'','?sort=top');resolve({ok:true,status:200,headers:new Headers(),text:async()=>JSON.stringify({data:{children:[]}})});assert.match((await pending).error,/Page changed/);
});

test('native card request budget and server cooldown defer work instead of failing cards',async t=>{
 const e=setup(t,{fetcher:async url=>nativeResponse(`<shreddit-post id="${new URL(url).pathname.split('/').pop()}"></shreddit-post>`)});
 for(let i=0;i<12;i++){const slot=nativeTarget(e,{id:'item'+i,target:'rt-native-'+i});assert.equal((await e.send({action:'render-card',username:'Example',kind:'post',postId:'item'+i,target:slot.id})).rendered,true);}
 const last=nativeTarget(e,{id:'item12',target:'rt-native-last'}),paused=await e.send({action:'render-card',username:'Example',kind:'post',postId:'item12',target:last.id});assert.equal(paused.deferred,true);assert.ok(paused.retryAfterMs>0);assert.equal(e.calls.length,12);
 const limited=setup(t,{fetcher:async()=>({ok:false,status:429,headers:new Headers({'Retry-After':'42'})})}),slot=nativeTarget(limited),response=await limited.send({action:'render-card',username:'Example',kind:'post',postId:'abc12',target:slot.id});assert.equal(response.deferred,true);assert.ok(response.retryAfterMs>=41000);assert.equal(limited.calls.length,1);
});

function navigationTarget(e,{controllerReady=true}={}){if(controllerReady)e.W.customElements.define('flex-left-nav-container',class extends e.W.HTMLElement{});const root=e.W.document.createElement('div');root.dataset.rtUi='archive-profile';const target=e.W.document.createElement('div');target.id='rt-nav-fixture';target.dataset.rtUi='profile-navigation';root.append(target);e.W.document.body.append(root);e.W.customElements.define('faceplate-partial',class extends e.W.HTMLElement{_renderContent(text){this.innerHTML=text;}});return target;}
test('native navigation attaches only Reddit sidebar markup from a fixed same-origin page read',async t=>{
 const e=setup(t,{fetcher:async()=>nativeResponse('<main id="home">Synthetic unrelated feed</main><flex-left-nav-container id="left-sidebar-container"><reddit-sidebar-nav><a href="/">Home</a></reddit-sidebar-nav></flex-left-nav-container>')}),target=navigationTarget(e);
 const result=await e.send({action:'render-navigation',username:'Example',target:target.id});assert.equal(result.ok,true);assert.equal(result.rendered,true);assert.equal(result.html,undefined);assert.ok(target.querySelector('flex-left-nav-container'));assert.equal(target.querySelector('#home'),null);assert.equal(target.textContent.includes('unrelated'),false);const [url,options]=e.calls[0];assert.equal(new URL(url).pathname,'/');assert.equal(options.credentials,'include');assert.equal(options.redirect,'error');
});
test('navigation rejects foreign targets and profile changes but survives same-profile tab changes',async t=>{
 let resolve;const e=setup(t,{fetcher:()=>new Promise(r=>resolve=r)}),target=navigationTarget(e);
 for(const input of [{username:'Other'},{target:'main'},{target:'rt-nav-missing'}])assert.equal((await e.send({action:'render-navigation',username:'Example',target:target.id,...input})).ok,false);assert.equal(e.calls.length,0);
 const pending=e.send({action:'render-navigation',username:'Example',target:target.id});e.W.history.pushState({},'','/user/Example/comments/');resolve(nativeResponse('<flex-left-nav-container id="left-sidebar-container">Native</flex-left-nav-container>'));assert.equal((await pending).rendered,true);
 const stale=e.send({action:'render-navigation',username:'Example',target:target.id});e.W.history.pushState({},'','/user/Other/');resolve(nativeResponse('<flex-left-nav-container id="left-sidebar-container">Wrong scope</flex-left-nav-container>'));assert.equal((await stale).ok,false);assert.equal(target.textContent.includes('Wrong scope'),false);
});

test('native reload contracts follow compatible Reddit endpoint changes without recreating card markup',async t=>{
 const e=setup(t,{fetcher:async()=>nativeResponse('<shreddit-profile-comment comment-id="t1_abc12"><span data-native-layout="new">Native community metadata</span></shreddit-profile-comment>')}),slot=nativeTarget(e,{kind:'comment'});
 const sample=e.W.document.createElement('shreddit-profile-comment');sample.setAttribute('comment-id','t1_native');sample.setAttribute('reload-url','/svc/shreddit/profile-comment/card/t1_native?isProfile=true');e.W.document.querySelector('main').append(sample);
 const result=await e.send({action:'render-card',username:'Example',kind:'comment',postId:'abc12',target:slot.id});assert.equal(result.rendered,true);const url=new URL(e.calls[0][0]);assert.equal(url.pathname,'/svc/shreddit/profile-comment/card/t1_abc12');assert.equal(url.searchParams.get('isProfile'),'true');assert.equal(slot.querySelector('[data-native-layout]').textContent,'Native community metadata');
});
test('native reload discovery rejects foreign, credential-bearing and unrelated endpoint templates',async t=>{
 for(const reload of ['https://evil.test/svc/shreddit/comment/t1_native?isProfile=true','https://name:pass@www.reddit.com/svc/shreddit/comment/t1_native','/api/private/t1_native','/svc/shreddit/comment/t1_other','/svc/shreddit/comment/t1_native?token=private']){
  const e=setup(t,{fetcher:async()=>nativeResponse('<shreddit-profile-comment comment-id="t1_abc12"></shreddit-profile-comment>')}),slot=nativeTarget(e,{kind:'comment'}),sample=e.W.document.createElement('shreddit-profile-comment');sample.setAttribute('comment-id','t1_native');sample.setAttribute('reload-url',reload);e.W.document.querySelector('main').append(sample);
  assert.equal((await e.send({action:'render-card',username:'Example',kind:'comment',postId:'abc12',target:slot.id})).rendered,true);assert.equal(new URL(e.calls[0][0]).href,'https://www.reddit.com/svc/shreddit/comment/t1_abc12?isProfile=true');
 }
});
test('native renderer startup defers cards without requests or fallback and fails within a bounded interval',async t=>{
 const e=setup(t,{fetcher:async()=>nativeResponse('<shreddit-post id="t3_abc12"></shreddit-post>')});e.W.document.body.innerHTML='<main><div id="rt-native-fixture" data-rt-ui="activity-item" data-rt-native-fullname="t3_abc12"></div></main>';const input={action:'render-card',username:'Example',kind:'post',postId:'abc12',target:'rt-native-fixture'},now=e.W.Date.now();e.W.Date.now=()=>now;
 const waiting=await e.send(input);assert.equal(waiting.deferred,true);assert.equal(waiting.reason,'renderer-startup');assert.equal(e.calls.length,0);e.W.Date.now=()=>now+10001;assert.match((await e.send(input)).error,/did not become ready/);assert.equal(e.calls.length,0);
 e.W.customElements.define('faceplate-partial',class extends e.W.HTMLElement{_renderContent(html){this.innerHTML=html;}});assert.equal((await e.send(input)).rendered,true);assert.equal(e.calls.length,1);
});


test('missing navigation controller loads only validated bootstrap chunks supplied by the native grid',async t=>{
 const html='<main>Unrelated homepage</main><faceplate-loader src="concat:NativeGrid_1,NavController-2" data-prefix="en-US/"></faceplate-loader><div class="grid-container"><flex-left-nav-container id="left-sidebar-container"><button>Collapse Navigation</button></flex-left-nav-container></div>';
 const e=setup(t,{fetcher:async()=>nativeResponse(html)}),target=navigationTarget(e,{controllerReady:false}),loads=[];e.W.SML={load:async(...args)=>{loads.push(args);e.W.customElements.define('flex-left-nav-container',class extends e.W.HTMLElement{});}};
 assert.equal((await e.send({action:'render-navigation',username:'Example',target:target.id})).rendered,true);assert.deepEqual(Array.from(loads[0][0]),['NativeGrid_1','NavController-2']);assert.equal(loads[0][1],'en-US/');assert.equal(target.querySelector('main,faceplate-loader'),null);assert.equal(target.textContent,'Collapse Navigation');
});
test('invalid native navigation bootstrap cannot execute arbitrary scripts or report a functional controller',async t=>{
 for(const [src,prefix] of [['https://evil.test/code.js','en-US/'],['concat:../bad','en-US/'],['concat:Native','../../'],['concat:Native','en-US/']]){
  const e=setup(t,{fetcher:async()=>nativeResponse(`<faceplate-loader src="${src}" data-prefix="${prefix}"><script>bad()</script></faceplate-loader><div class="grid-container"><flex-left-nav-container id="left-sidebar-container"></flex-left-nav-container></div>`)}),target=navigationTarget(e,{controllerReady:false});let calls=0;e.W.SML={load:async()=>{calls++;}};const result=await e.send({action:'render-navigation',username:'Example',target:target.id});assert.equal(result.ok,false);assert.equal(target.childElementCount,0);assert.equal(calls,src==='concat:Native'&&prefix==='en-US/'?1:0);
 }
});
