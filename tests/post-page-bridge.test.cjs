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

test('sequential native cards remain demand-driven across page boundaries without a thirty-card stall',async t=>{
 const e=setup(t,{fetcher:async url=>nativeResponse(`<shreddit-post id="${new URL(url).pathname.split('/').pop()}"></shreddit-post>`)});const now=e.W.Date.now();e.W.Date.now=()=>now;
 for(let i=0;i<55;i++){const slot=nativeTarget(e,{id:'item'+i,target:'rt-native-'+i});assert.equal((await e.send({action:'render-card',username:'Example',kind:'post',postId:'item'+i,target:slot.id})).rendered,true);}
 assert.equal(e.calls.length,55);
});
test('native card server cooldown still defers requests until Retry-After expires',async t=>{
 let requests=0;const limited=setup(t,{fetcher:async()=>++requests===1?{ok:false,status:429,headers:new Headers({'Retry-After':'42'})}:nativeResponse('<shreddit-post id="t3_abc12"></shreddit-post>')}),slot=nativeTarget(limited),input={action:'render-card',username:'Example',kind:'post',postId:'abc12',target:slot.id};
 let now=limited.W.Date.now();limited.W.Date.now=()=>now;
 const response=await limited.send(input);assert.equal(response.deferred,true);assert.equal(response.reason,'rate-limit');assert.equal(response.retryAfterMs,42000);assert.equal(limited.calls.length,1);
 now+=41000;const waiting=await limited.send(input);assert.equal(waiting.deferred,true);assert.equal(waiting.retryAfterMs,1000);assert.equal(limited.calls.length,1);
 now+=1000;assert.equal((await limited.send(input)).rendered,true);assert.equal(limited.calls.length,2);
});

function navigationTarget(e,{controllerReady=true}={}){if(controllerReady && !e.W.customElements.get('flex-left-nav-container'))e.W.customElements.define('flex-left-nav-container',class extends e.W.HTMLElement{});const root=e.W.document.createElement('div');root.dataset.rtUi='archive-profile';const target=e.W.document.createElement('div');target.id='rt-nav-fixture';target.dataset.rtUi='profile-navigation';root.append(target);e.W.document.body.append(root);if(!e.W.customElements.get('faceplate-partial'))e.W.customElements.define('faceplate-partial',class extends e.W.HTMLElement{_renderContent(text){this.innerHTML=text;}});return target;}
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
test('navigation reads reuse cached responses across profile targets sharing a lease',async t=>{
 const e=setup(t,{fetcher:async()=>nativeResponse('<flex-left-nav-container id="left-sidebar-container"><a href="/">Home</a></flex-left-nav-container>')});
 const first=navigationTarget(e),second=navigationTarget(e,{controllerReady:false});second.id='rt-nav-second';
 const r1=await e.send({action:'render-navigation',username:'Example',target:first.id,navigationLease:'lease-1'});assert.equal(r1.rendered,true);
 const r2=await e.send({action:'render-navigation',username:'Example',target:second.id,navigationLease:'lease-1'});assert.equal(r2.rendered,true);
 assert.equal(e.calls.length,1);
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

test('navigation preloads native eager modules before attaching sidebar text and never re-executes response scripts',async t=>{
 let release;const e=setup(t,{fetcher:async()=>nativeResponse('<flex-left-nav-container id="left-sidebar-container"><faceplate-loader loading="eager" src="concat:CommonNav_1,Section-2" data-prefix="en-US/"><script>bad()</script></faceplate-loader><a href="/">Home</a></flex-left-nav-container>')}),target=navigationTarget(e),calls=[];e.W.SML={load:(chunks,prefix)=>{calls.push({chunks:Array.from(chunks),prefix});return new Promise(r=>release=r);}};
 const pending=e.send({action:'render-navigation',username:'Example',target:target.id,navigationLease:'test'});await new Promise(r=>setImmediate(r));assert.equal(target.childElementCount,0);assert.equal(calls.length,1);assert.deepEqual(calls[0].chunks,['CommonNav_1','Section-2']);release();assert.equal((await pending).rendered,true);assert.equal(target.querySelector('script'),null);assert.equal(target.textContent,'Home');
});
test('navigation leases and expiry prevent stale cache reuse beyond the current scope',async t=>{
 const e=setup(t,{fetcher:async()=>nativeResponse('<flex-left-nav-container id="left-sidebar-container">Native</flex-left-nav-container>')}),target=navigationTarget(e);let now=10000;e.W.Date.now=()=>now;const input={action:'render-navigation',username:'Example',target:target.id,navigationLease:'first'};await e.send(input);await e.send(input);assert.equal(e.calls.length,1);await e.send({...input,navigationLease:'second'});assert.equal(e.calls.length,2);now+=30001;await e.send({...input,navigationLease:'second'});assert.equal(e.calls.length,3);
});

function controlsTarget(e,id='rt-controls-fixture'){
 const main=e.W.document.querySelector('main') || e.W.document.body.appendChild(e.W.document.createElement('main')),target=e.W.document.createElement('div');target.id=id;target.dataset.rtUi='profile-controls';main.append(target);if(!e.W.customElements.get('faceplate-partial'))e.W.customElements.define('faceplate-partial',class extends e.W.HTMLElement{_renderContent(html){this.innerHTML=html;}});return target;
}
test('missing native controls reuse only the first-party menu fragment and retarget current profile links',async t=>{
 const html=fs.readFileSync('tests/fixtures/native-profile-controls.html','utf8').replace('</svg></button>','</svg>Feed options</button>')+'<main>Unrelated private feed</main>',e=setup(t,{url:'https://www.reddit.com/user/Example/comments/?sort=top&t=day&feedViewType=compactView',fetcher:async()=>nativeResponse(html)}),target=controlsTarget(e);const result=await e.send({action:'render-controls',username:'Example',target:target.id});assert.equal(result.rendered,true);assert.equal(result.html,undefined);assert.equal(JSON.stringify(result).includes('private'),false);assert.equal(target.textContent.includes('Unrelated'),false);assert.ok(target.querySelector('shreddit-layout-event-setter rpl-dropdown[placement="bottom-start"]'));assert.equal(target.querySelector('button').textContent.trim(),'Top');assert.equal(target.querySelector('button svg[icon-name="filter"]'),null);assert.ok(target.querySelector('button svg[icon-name="caret-down"]'));const source=new URL(e.calls[0][0]);assert.equal(source.pathname,'/user/reddit/submitted/');assert.equal(source.searchParams.get('feedViewType'),'compactView');for(const row of target.querySelectorAll('rpl-menu-item[href]'))assert.equal(new URL(row.getAttribute('href'),'https://www.reddit.com').pathname,'/user/Example/comments/');const second=controlsTarget(e,'rt-controls-second');assert.equal((await e.send({action:'render-controls',username:'Example',target:second.id})).rendered,true);assert.equal(e.calls.length,1);
});
test('native controls reject foreign targets, unsafe destinations and stale profile responses',async t=>{
 let release;const e=setup(t,{fetcher:()=>new Promise(r=>release=r)}),target=controlsTarget(e),input={action:'render-controls',username:'Example',target:target.id};for(const value of [{username:'Other'},{target:'main'},{target:'rt-controls-missing'}])assert.equal((await e.send({...input,...value})).ok,false);assert.equal(e.calls.length,0);const pending=e.send(input);e.W.history.pushState({},'','/user/Other/');release(nativeResponse(fs.readFileSync('tests/fixtures/native-profile-controls.html','utf8')));assert.equal((await pending).ok,false);assert.equal(target.childElementCount,0);
 const bad=setup(t,{fetcher:async()=>nativeResponse(fs.readFileSync('tests/fixtures/native-profile-controls.html','utf8').replace('/user/reddit/submitted/?sort=new','https://evil.test/'))}),slot=controlsTarget(bad);assert.equal((await bad.send({...input,target:slot.id})).ok,false);assert.equal(slot.childElementCount,0);
});
test('unavailable native cards honor the selected compact view without borrowing another card',async t=>{
 const e=setup(t,{url:'https://www.reddit.com/user/Example/submitted/?feedViewType=compactView',fetcher:async()=>nativeResponse('<shreddit-post id="t3_abc12"></shreddit-post>')}),target=nativeTarget(e);await e.send({action:'render-card',username:'Example',kind:'post',postId:'abc12',target:target.id});assert.equal(new URL(e.calls[0][0]).searchParams.get('fvt'),'compactView');
});

test('demand-driven profile reads do not pause at the former eight-read window',async t=>{
 const e=setup(t);const now=e.W.Date.now();e.W.Date.now=()=>now;for(let i=0;i<16;i++)assert.equal((await e.send({action:'profile',username:'Example',kind:'post',sort:'new'})).ok,true);assert.equal(e.calls.length,16);
});
test('Comments combined trigger borrows the actual native sort button with its caret',async t=>{
 const html=fs.readFileSync('tests/fixtures/native-profile-controls.html','utf8'),e=setup(t,{url:'https://www.reddit.com/user/Example/comments/',fetcher:async()=>nativeResponse(html)}),target=controlsTarget(e),sort=e.W.document.createElement('shreddit-sort-dropdown');sort.attachShadow({mode:'open'}).innerHTML='<button aria-label="Sort by: New" class="button button-small button-plain"><span>New</span><svg icon-name="caret-down"></svg></button>';target.before(sort);const result=await e.send({action:'render-controls',username:'Example',target:target.id});assert.equal(result.rendered,true);const trigger=target.querySelector('button');assert.equal(trigger.textContent,'New');assert.equal(trigger.getAttribute('aria-label'),'Feed options');assert.ok(trigger.querySelector('[icon-name="caret-down"]'));assert.equal(sort.shadowRoot.querySelector('button').getAttribute('aria-label'),'Sort by: New');
});

const statusPost=(id='abc12',extra='',body='Public text',author='Example')=>`<shreddit-post id="t3_${id}" author="${author}" post-title="Synthetic public title" created-timestamp="2026-10-20T12:00:00Z" ${extra}><div slot="text-body">${body}</div><input name="csrf_token" value="synthetic-private"></shreddit-post>`;
test('archive status uses authenticated native fragments when legacy info is forbidden, returning only compact evidence',async t=>{
 const e=setup(t,{fetcher:async url=>new URL(url).pathname==='/api/info.json'?nativeResponse('',403):nativeResponse(statusPost('abc12','item-state="REMOVED"','[removed]'))});
 const result=await e.send({action:'status',username:'Example',kind:'post',ids:['abc12']});assert.equal(result.ok,true);assert.deepEqual(result.statuses,[{fullname:'t3_abc12',status:'removed',author:'Example',over18:false,spoiler:false}]);assert.deepEqual(result.unknownIds,[]);assert.equal(result.incomplete,false);assert.equal(JSON.stringify(result).includes('synthetic-private'),false);assert.equal(JSON.stringify(result).includes('Public text'),false);const [url,options]=e.calls[0];assert.equal(new URL(url).pathname,'/svc/shreddit/partial-feed-post/t3_abc12');assert.equal(options.credentials,'include');assert.equal(options.redirect,'error');assert.equal(options.method,'GET');assert.equal(e.calls.length,1);
});
test('status batches keep missing, denied, mismatched and gated fragments unknown without treating empty or link posts as deleted',async t=>{
 const e=setup(t,{fetcher:async url=>{const id=new URL(url).pathname.split('_').pop();return id==='denied'?nativeResponse('',403):nativeResponse(id==='missing'?'<div>No item</div>':id==='foreign'?statusPost(id,'','','Other'):id==='gated'?statusPost(id,'item-state="blocked"',''):id==='link'?statusPost(id,'post-type="link"',''):id==='account'?statusPost(id,'is-author-deleted',''):statusPost(id,'deleted','[deleted]','[deleted]'));}});
 const result=await e.send({action:'status',username:'Example',kind:'post',ids:['denied','missing','foreign','gated','link','account','deleted']});assert.equal(result.ok,true);assert.equal(result.incomplete,true);assert.deepEqual(new Set(result.unknownIds),new Set(['t3_denied','t3_missing','t3_foreign','t3_gated']));assert.equal(result.statuses.find(p=>p.fullname==='t3_link').status,'available');assert.equal(result.statuses.find(p=>p.fullname==='t3_account').status,'available');assert.equal(result.statuses.find(p=>p.fullname==='t3_deleted').status,'deleted');
});
test('status identity and route validation refuses arbitrary destinations and post-detail requests before any fetch',async t=>{
 const e=setup(t);for(const input of [{username:'Other'},{ids:['../bad']},{ids:[]},{ids:Array(26).fill('abc12')},{kind:'anything'},{username:'https://evil.test'}])assert.equal((await e.send({action:'status',username:'Example',kind:'post',ids:['abc12'],...input})).ok,false);assert.equal(e.calls.length,0);
 const detail=setup(t,{url:'https://www.reddit.com/comments/abc12/title/'});assert.equal((await detail.send({action:'status',username:'Example',kind:'post',ids:['abc12']})).ok,false);assert.equal(detail.calls.length,0);
});
test('status checks share native render evidence, deduplicate IDs and expire their bounded cache',async t=>{
 const e=setup(t,{fetcher:async()=>nativeResponse(statusPost())}),slot=nativeTarget(e);let now=10000;e.W.Date.now=()=>now;
 assert.equal((await e.send({action:'render-card',username:'Example',kind:'post',postId:'abc12',target:slot.id})).rendered,true);
 const input={action:'status',username:'Example',kind:'post',ids:['abc12','t3_abc12']};assert.equal((await e.send(input)).statuses.length,1);assert.equal(e.calls.length,1);now+=30001;assert.equal((await e.send(input)).statuses[0].status,'available');assert.equal(e.calls.length,2);
});
test('native comment status checks require their exact t1 identity and accept explicit tombstones with no archived body',async t=>{
 const e=setup(t,{fetcher:async()=>nativeResponse('<shreddit-profile-comment comment-id="t1_19rktoupyflj9" author="[deleted]" item-state="DELETED"><div class="md">[deleted]</div></shreddit-profile-comment>')});
 const result=await e.send({action:'status',username:'Example',kind:'comment',ids:['19rktoupyflj9']});assert.equal(result.statuses[0].fullname,'t1_19rktoupyflj9');assert.equal(result.statuses[0].status,'deleted');assert.equal(new URL(e.calls[0][0]).pathname,'/svc/shreddit/comment/t1_19rktoupyflj9');assert.equal(new URL(e.calls[0][0]).searchParams.get('isProfile'),'true');
});
test('status batch limits concurrent native requests to two and abandons a changed route',async t=>{
 let running=0,maximum=0;const pending=[],e=setup(t,{fetcher:url=>{running++;maximum=Math.max(maximum,running);return new Promise(resolve=>pending.push(()=>{running--;resolve(nativeResponse(statusPost(new URL(url).pathname.split('_').pop())));}));}});
 const read=e.send({action:'status',username:'Example',kind:'post',ids:['one','two','three']});assert.equal(pending.length,2);pending.shift()();await new Promise(r=>setImmediate(r));assert.equal(pending.length,2);assert.equal(maximum,2);e.W.history.pushState({},'','/user/Other/');for(const finish of pending)finish();assert.match((await read).error,/Page changed/);assert.equal(e.calls.length,3);
});
test('native status rate limiting stops the batch without automatic retries and preserves unknown evidence',async t=>{
 const e=setup(t,{fetcher:async()=>({ok:false,status:429,headers:new Headers({'Retry-After':'30'})})});const result=await e.send({action:'status',username:'Example',kind:'post',ids:['one','two','three','four']});assert.equal(result.ok,true);assert.equal(result.statuses.length,0);assert.equal(result.unknownIds.length,4);assert.ok(e.calls.length<=2);assert.match((await e.send({action:'status',username:'Example',kind:'post',ids:['one']})).error,/asked us to wait/);
});
test('status reuses genuine native DOM but never trusts archive-generated cards as current evidence',async t=>{
 const e=setup(t,{fetcher:async()=>nativeResponse('',403)});e.W.document.body.innerHTML='<main>'+statusPost('native','item-state="removed"','[removed]')+'<div data-rt-ui="activity-item">'+statusPost('archive','deleted','[deleted]')+'</div></main>';
 const result=await e.send({action:'status',username:'Example',kind:'post',ids:['native','archive']});assert.equal(result.statuses.length,1);assert.equal(result.statuses[0].fullname,'t3_native');assert.deepEqual(result.unknownIds,['t3_archive']);assert.equal(e.calls.length,1);assert.equal(new URL(e.calls[0][0]).pathname,'/svc/shreddit/partial-feed-post/t3_archive');
});
test('a stalled native status batch returns unknown IDs and aborts its unshared authenticated reads',async t=>{
 const signals=[],e=setup(t,{fetcher:(url,options)=>{signals.push(options.signal);return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));}});
 e.W.setTimeout=(fn,delay)=>{assert.equal(delay,10000);queueMicrotask(fn);return 1;};const result=await e.send({action:'status',username:'Example',kind:'post',ids:['one','two','three']});assert.equal(result.ok,true);assert.equal(result.timedOut,true);assert.deepEqual(result.statuses,[]);assert.deepEqual(result.unknownIds,['t3_one','t3_two','t3_three']);assert.equal(result.incomplete,true);assert.equal(signals.length,2);assert.ok(signals.every(signal=>signal.aborted));assert.equal(e.calls.length,2);
});
test('archive status joins both busy native renders and waits for remaining capacity without false unknown results',async t=>{
 const pending=[],e=setup(t,{fetcher:url=>new Promise(resolve=>pending.push({id:new URL(url).pathname.split('_').pop(),finish:()=>resolve(nativeResponse(statusPost(new URL(url).pathname.split('_').pop())))}))});
 const one=nativeTarget(e,{id:'one',target:'rt-native-one'}),two=nativeTarget(e,{id:'two',target:'rt-native-two'}),render=id=>e.send({action:'render-card',username:'Example',kind:'post',postId:id,target:id==='one'?one.id:two.id});
 const r1=render('one'),r2=render('two'),status=e.send({action:'status',username:'Example',kind:'post',ids:['one','two','three']});assert.equal(e.calls.length,2);assert.equal(pending.length,2);pending.splice(0).forEach(read=>read.finish());await new Promise(r=>setImmediate(r));assert.equal(pending.length,1);assert.equal(pending[0].id,'three');pending.shift().finish();assert.equal((await r1).rendered,true);assert.equal((await r2).rendered,true);const result=await status;assert.equal(result.statuses.length,3);assert.deepEqual(result.unknownIds,[]);assert.equal(e.calls.length,3);
});
test('status fetched fragments render through Reddit native components without a second endpoint read',async t=>{
 const e=setup(t,{fetcher:async()=>nativeResponse(statusPost())}),result=await e.send({action:'status',username:'Example',kind:'post',ids:['abc12']});assert.equal(result.statuses[0].status,'available');const target=nativeTarget(e);assert.equal((await e.send({action:'render-card',username:'Example',kind:'post',postId:'abc12',target:target.id})).rendered,true);assert.equal(e.calls.length,1);assert.equal(target.querySelector('faceplate-partial').src,'/svc/shreddit/partial-feed-post/t3_abc12?pvc=ProfileFeed2&fvt=cardView');assert.equal(target.querySelector('shreddit-post').getAttribute('author'),'Example');
});
test('observed UNMODERATED comment state verifies available content, retaining unknown for unfamiliar states',async t=>{
 const e=setup(t,{fetcher:async url=>nativeResponse(`<shreddit-profile-comment comment-id="${new URL(url).pathname.split('/').pop()}" author="Example" item-state="${new URL(url).pathname.includes('normal')?'UNMODERATED':'GATED_NEW_STATE'}"><faceplate-timeago ts="2026-10-20T12:00:00Z"></faceplate-timeago><div class="md">Synthetic public comment</div></shreddit-profile-comment>`)});
 const result=await e.send({action:'status',username:'Example',kind:'comment',ids:['normal','unknown']});assert.equal(result.statuses.length,1);assert.equal(result.statuses[0].status,'available');assert.deepEqual(result.unknownIds,['t1_unknown']);
});
test('status workers wait for unrelated busy native cards instead of skipping all remaining IDs',async t=>{
 const pending=[],e=setup(t,{fetcher:url=>new Promise(resolve=>pending.push(()=>resolve(nativeResponse(statusPost(new URL(url).pathname.split('_').pop())))))});
 const one=nativeTarget(e,{id:'one',target:'rt-native-one'}),two=nativeTarget(e,{id:'two',target:'rt-native-two'}),r1=e.send({action:'render-card',username:'Example',kind:'post',postId:'one',target:one.id}),r2=e.send({action:'render-card',username:'Example',kind:'post',postId:'two',target:two.id}),status=e.send({action:'status',username:'Example',kind:'post',ids:['three','four']});assert.equal(e.calls.length,2);pending.splice(0).forEach(finish=>finish());await new Promise(r=>setImmediate(r));assert.equal(e.calls.length,4);pending.splice(0).forEach(finish=>finish());await Promise.all([r1,r2]);const result=await status;assert.equal(result.statuses.length,2);assert.deepEqual(result.unknownIds,[]);
});
test('a status timeout releases its consumer without aborting a native render sharing the same request',async t=>{
 let finish,physicalSignal;const e=setup(t,{fetcher:(url,options)=>{physicalSignal=options.signal;return new Promise(resolve=>finish=()=>resolve(nativeResponse(statusPost())));}}),timers=[];e.W.setTimeout=fn=>timers.push(fn);e.W.clearTimeout=()=>{};
 const status=e.send({action:'status',username:'Example',kind:'post',ids:['abc12']}),target=nativeTarget(e),render=e.send({action:'render-card',username:'Example',kind:'post',postId:'abc12',target:target.id});assert.equal(e.calls.length,1);timers[0]();const result=await status;assert.equal(result.ok,true);assert.equal(result.timedOut,true);assert.deepEqual(result.unknownIds,['t3_abc12']);assert.equal(physicalSignal.aborted,false);finish();assert.equal((await render).rendered,true);assert.equal(e.calls.length,1);
});
test('a render timeout cannot abort the status consumer that joined its native fragment request',async t=>{
 let finish,physicalSignal;const e=setup(t,{fetcher:(url,options)=>{physicalSignal=options.signal;return new Promise(resolve=>finish=()=>resolve(nativeResponse(statusPost())));}}),target=nativeTarget(e),timers=[];e.W.setTimeout=fn=>timers.push(fn);e.W.clearTimeout=()=>{};
 const render=e.send({action:'render-card',username:'Example',kind:'post',postId:'abc12',target:target.id}),status=e.send({action:'status',username:'Example',kind:'post',ids:['abc12']});assert.equal(e.calls.length,1);timers[0]();assert.match((await render).error,/timed out/);assert.equal(physicalSignal.aborted,false);finish();const result=await status;assert.equal(result.statuses[0].status,'available');assert.deepEqual(result.unknownIds,[]);assert.equal(target.childElementCount,0);assert.equal(e.calls.length,1);
});
test('a status batch timeout retains finished proofs and reports every unresolved or unstarted ID as unknown',async t=>{
 const signals=[],e=setup(t,{fetcher:(url,options)=>{if(new URL(url).pathname.endsWith('t3_one'))return nativeResponse(statusPost('one'));signals.push(options.signal);return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));}}),timers=[];e.W.setTimeout=fn=>timers.push(fn);e.W.clearTimeout=()=>{};
 const status=e.send({action:'status',username:'Example',kind:'post',ids:['one','two','three','four']});await new Promise(resolve=>setImmediate(resolve));assert.equal(e.calls.length,3);timers[0]();const result=await status;assert.equal(result.ok,true);assert.equal(result.timedOut,true);assert.deepEqual(result.statuses.map(p=>p.fullname),['t3_one']);assert.deepEqual(result.unknownIds,['t3_two','t3_three','t3_four']);assert.ok(signals.every(signal=>signal.aborted));assert.equal(e.calls.length,3);
});
test('a changed route never receives partial status proofs when a batch deadline expires',async t=>{
 const e=setup(t,{fetcher:(url,options)=>new URL(url).pathname.endsWith('t3_one')?nativeResponse(statusPost('one')):new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}))}),timers=[];e.W.setTimeout=fn=>timers.push(fn);e.W.clearTimeout=()=>{};
 const status=e.send({action:'status',username:'Example',kind:'post',ids:['one','two']});await new Promise(resolve=>setImmediate(resolve));e.W.history.pushState({},'','/user/Other/');timers[0]();const result=await status;assert.equal(result.ok,false);assert.match(result.error,/Page changed/);assert.equal(result.statuses,undefined);
});
