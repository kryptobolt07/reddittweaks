const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
function setup(t,{url='https://www.reddit.com/user/Example/',fetcher,intersection=false,before}={}){
  const dom=new JSDOM('<body></body>',{url,runScripts:'outside-only'}),W=dom.window,calls=[];t.after(()=>W.close());W.AbortController=AbortController;before?.(W);
  // jsdom has no IntersectionObserver; feed tests install a controllable one before the bridge loads.
  if(intersection){W.__observers=[];W.IntersectionObserver=class{constructor(callback,options){this.callback=callback;this.options=options;this.targets=new Set();W.__observers.push(this);}observe(target){this.targets.add(target);}unobserve(target){this.targets.delete(target);}disconnect(){this.targets.clear();}};}
  W.fetch=async(...args)=>{calls.push(args);return fetcher?fetcher(...args):{ok:true,status:200,headers:new Headers(),text:async()=>new URL(args[0]).pathname==='/svc/shreddit/search/'?nativePostHtml():JSON.stringify({data:{children:[{kind:'t3',data:{id:'abc12',author:'Example',title:'Public',created_utc:1700000000}}],after:'t3_abc12'}})};};
  for(const file of ['post-model.js','post-page-bridge.js'])W.eval(fs.readFileSync('extension/'+file,'utf8'));
  function send(input){return new Promise(resolve=>{const id=crypto.randomUUID(),channel='test';const listener=e=>{const r=JSON.parse(e.detail);if(r.id!==id)return;W.document.removeEventListener('rt-post-response',listener);resolve(r);};W.document.addEventListener('rt-post-response',listener);W.document.dispatchEvent(new W.CustomEvent('rt-post-request',{detail:JSON.stringify({channel,id,...input})}));});}
  return {W,calls,send};
}
test('YouTube sound requested before API readiness is applied to the same player',async t=>{
 const {W}=setup(t),embed=W.document.createElement('shreddit-embed');
 embed.setAttribute('providername','YouTube');
 const lite=W.document.createElement('lite-youtube');
 embed.liteYoutubeElement=lite;W.document.body.append(embed);
 let ready,activations=0,unmutes=0,plays=0;
 const player={getVolume:()=>50,setVolume(){},unMute(){unmutes++;},playVideo(){plays++;}};
 const pending=new Promise(resolve=>ready=resolve);
 lite.activate=()=>{activations++;lite.classList.add('lyt-activated');};
 lite.getYTPlayer=()=>pending;
 embed.dataset.rtEmbedPreview='on';
 embed.dispatchEvent(new W.Event('rt-embed-preview',{bubbles:true,cancelable:true}));
 delete embed.dataset.rtEmbedPreview;
 embed.dispatchEvent(new W.Event('rt-embed-sound',{bubbles:true}));
 ready(player);await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual({activations,unmutes,plays},{activations:1,unmutes:1,plays:1});
 embed.dispatchEvent(new W.Event('rt-embed-sound',{bubbles:true}));
 assert.equal(unmutes,2,'ready players get the command in the gesture handler');
});
test('the detail YouTube player starts a saved continuation with sound',async t=>{
 const {W}=setup(t,{url:'https://www.reddit.com/r/example/comments/abc12/title/'});
 const card=W.document.createElement('shreddit-post');card.id='t3_abc12';W.document.body.append(card);
 const embed=W.document.createElement('shreddit-embed');embed.setAttribute('providername','YouTube');card.append(embed);
 const lite=W.document.createElement('lite-youtube');embed.liteYoutubeElement=lite;
 const calls=[],player={seekTo(time){calls.push(time);},getVolume:()=>50,setVolume(){},unMute(){calls.push('sound');},playVideo(){calls.push('play');}};
 lite.activate=()=>lite.classList.add('lyt-activated');lite.getYTPlayer=async()=>player;
 embed.dataset.rtStart='12';embed.dataset.rtMuted='false';
 assert.equal(embed.dispatchEvent(new W.Event('rt-embed-continue',{bubbles:true,cancelable:true})),false);
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(calls,[12,'sound','play']);
});
test('video preload only asks the current post detail player to load metadata',t=>{
 const {W,calls}=setup(t,{url:'https://www.reddit.com/r/example/comments/abc12/title/'});
 const players=[];
 for(const [type,id] of [['in_feed_player','abc12'],['post_detail_screen','other'],['post_detail_screen','abc12']]){
  const player=W.document.createElement('shreddit-player');
  player.setAttribute('player-type',type);player.setAttribute('post-id','t3_'+id);
  player.load=async mode=>players.push([type,id,mode]);
  W.document.body.append(player);
  player.dispatchEvent(new W.Event('rt-prepare-detail-video',{bubbles:true}));
 }
 assert.deepEqual(players,[['post_detail_screen','abc12','metadata']]);
 assert.equal(calls.length,0);
});
test('archive comment bootstrap uses only current shell descriptors and rejects late route changes',async t=>{
 const e=setup(t,{url:'https://www.reddit.com/r/example/comments/abc12/title/'}),w=e.W;
 w.document.body.innerHTML='<div data-rt-ui="archive-subreddit" data-rt-subreddit="example"></div><faceplate-loader name="PdpStandardClientAssets_fixture" src="concat:chunkA,chunkB" data-prefix="en-US/"></faceplate-loader>';
 let finish;const calls=[];w.SML={load:(chunks,prefix)=>{calls.push([Array.from(chunks),prefix]);return new Promise(resolve=>finish=resolve);}};
 const pending=e.send({action:'load-archive-comment-modules',postId:'abc12'});await new Promise(r=>setImmediate(r));
 assert.deepEqual(calls,[[['chunkA','chunkB'],'en-US/']]);assert.equal(e.calls.length,0);
 w.history.pushState({},'','/r/example/comments/other/title/');finish();assert.match((await pending).error,/Page changed/);
});
test('archive comment bootstrap reports missing native components and allows retry',async t=>{
 const e=setup(t,{url:'https://www.reddit.com/r/example/comments/abc12/title/'}),w=e.W;
 w.document.body.innerHTML='<div data-rt-ui="archive-subreddit" data-rt-subreddit="example"></div>';
 assert.match((await e.send({action:'load-archive-comment-modules',postId:'abc12'})).error,/unavailable/);
 for(const name of ['shreddit-comment','shreddit-comment-action-row','shreddit-comment-share-button','faceplate-progress'])w.customElements.define(name,class extends w.HTMLElement{});
 assert.equal((await e.send({action:'load-archive-comment-modules',postId:'abc12'})).loaded,true);assert.equal(e.calls.length,0);
});
test('archive comment bootstrap times out when Reddit\'s loader hangs',async t=>{
 const e=setup(t,{url:'https://www.reddit.com/r/example/comments/abc12/title/'}),w=e.W;
 w.document.body.innerHTML='<div data-rt-ui="archive-subreddit" data-rt-subreddit="example"></div><faceplate-loader name="PdpStandardClientAssets_fixture" src="concat:chunkA" data-prefix="en-US/"></faceplate-loader>';
 w.SML={load:()=>new Promise(()=>{})};const timer=w.setTimeout.bind(w);w.setTimeout=(fn,ms,...args)=>timer(fn,ms===10000?10:ms,...args);
 assert.match((await e.send({action:'load-archive-comment-modules',postId:'abc12'})).error,/timed out/);assert.equal(e.calls.length,0);
});
test('archive comment bootstrap loads the matching comment partial descriptor only',async t=>{
 const e=setup(t,{url:'https://www.reddit.com/r/example/comments/abc12/title/',fetcher:async()=>nativeResponse('<faceplate-loader name="Comment$1_fixture" src="concat:chunkA,chunkB" data-prefix="en-US/"></faceplate-loader><faceplate-loader name="Other_fixture" src="concat:ignored" data-prefix="en-US/"></faceplate-loader>')}),w=e.W;
 w.document.body.innerHTML='<div data-rt-ui="archive-subreddit" data-rt-subreddit="example"><shreddit-comment id="t1_com123" data-rt-ui="archive-thread-comment" thingid="t1_com123" postid="t3_abc12"></shreddit-comment></div>';
 const calls=[];w.SML={load:async(chunks,prefix)=>{calls.push([Array.from(chunks),prefix]);for(const name of ['shreddit-comment','shreddit-comment-action-row','shreddit-comment-share-button','faceplate-progress'])w.customElements.define(name,class extends w.HTMLElement{});}};
 assert.equal((await e.send({action:'load-archive-comment-modules',postId:'abc12'})).loaded,true);
 assert.deepEqual(calls,[[['chunkA','chunkB'],'en-US/']]);const [url,options]=e.calls[0];assert.equal(new URL(url).pathname,'/svc/shreddit/comment/t1_com123');assert.equal(new URL(url).search,'?depth=0&subredditName=example');assert.equal(options.headers.Accept,'text/vnd.reddit.partial+html');assert.equal(options.redirect,'error');
});
test('archive comment bootstrap refuses mismatched records and invalid descriptors',async t=>{
 const e=setup(t,{url:'https://www.reddit.com/r/example/comments/abc12/title/',fetcher:async()=>nativeResponse('<faceplate-loader name="Comment$1_fixture" src="concat:bad/path" data-prefix="en-US/"></faceplate-loader>')}),w=e.W;
 w.document.body.innerHTML='<div data-rt-ui="archive-subreddit" data-rt-subreddit="example"><shreddit-comment id="t1_com123" data-rt-ui="archive-thread-comment" thingid="t1_com123" postid="t3_other"></shreddit-comment></div>';w.SML={load:()=>assert.fail('invalid loader')};
 assert.match((await e.send({action:'load-archive-comment-modules',postId:'abc12'})).error,/unavailable/);assert.equal(e.calls.length,0);
 w.document.querySelector('shreddit-comment').setAttribute('postid','t3_abc12');assert.match((await e.send({action:'load-archive-comment-modules',postId:'abc12'})).error,/unavailable/);assert.equal(e.calls.length,1);
});
test('cancelling archive comment bootstrap aborts its partial fetch',async t=>{
 let fetchSignal;const e=setup(t,{url:'https://www.reddit.com/r/example/comments/abc12/title/',fetcher:async(_url,options)=>{fetchSignal=options.signal;return new Promise((_,reject)=>fetchSignal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));}}),w=e.W;
 w.document.body.innerHTML='<div data-rt-ui="archive-subreddit" data-rt-subreddit="example"><shreddit-comment id="t1_com123" data-rt-ui="archive-thread-comment" thingid="t1_com123" postid="t3_abc12"></shreddit-comment></div>';w.SML={load:()=>assert.fail('cancelled before loading')};
 const result=new Promise(resolve=>w.document.addEventListener('rt-post-response',event=>resolve(JSON.parse(event.detail)),{once:true}));
 w.document.dispatchEvent(new w.CustomEvent('rt-post-request',{detail:JSON.stringify({channel:'test',id:'cancel-me',action:'load-archive-comment-modules',postId:'abc12'})}));await new Promise(r=>setImmediate(r));
 w.document.dispatchEvent(new w.CustomEvent('rt-post-request',{detail:JSON.stringify({channel:'test',id:'cancel-me',action:'cancel'})}));assert.match((await result).error,/cancelled/);assert.equal(fetchSignal.aborted,true);
});
test('Reddit reads use a fixed same-origin GET and return only compact public posts',async t=>{
  const e=setup(t),r=await e.send({action:'profile',username:'Example'});assert.equal(r.ok,true);assert.equal(r.posts[0].id,'abc12');const [url,options]=e.calls[0];assert.equal(new URL(url).pathname,'/svc/shreddit/search/');assert.equal(new URL(url).searchParams.get('type'),'posts');assert.equal(new URL(url).searchParams.get('q'),'author:"Example"');assert.equal(options.credentials,'include');assert.equal(options.method,'GET');assert.equal(r.cookie,undefined);assert.equal(r.posts[0].body,'');assert.equal(r.posts[0].status,'unknown');
});
function virtualFeed(t,{owned=true}={}){
 const {W,calls}=setup(t,{intersection:true});if(owned)W.document.documentElement.setAttribute('data-rt-profile-discovery','');
 W.document.body.innerHTML=`<main><shreddit-feed${owned?' data-rt-loading-owner="extension"':''}></shreddit-feed></main>`;
 const feed=W.document.querySelector('shreddit-feed'),frames=[],nativeCalls=[];W.requestAnimationFrame=callback=>{frames.push(callback);return frames.length;};
 const observers=W.__observers;
 const intersect=targets=>{for(const o of observers)o.callback(targets.filter(t=>o.targets.has(t)).map(target=>({target,isIntersecting:true})),o);};
 Object.defineProperty(W,'innerHeight',{value:600,configurable:true});W.scrollBy=()=>{};
 const controller={host:feed,topStack:[],topPadding:0,_virtualizeTop(distance){nativeCalls.push(distance);}};feed.virtualization=controller;
 const at=(element,top,height)=>{element.getBoundingClientRect=()=>({top,bottom:top+height,height});return element;};
 const card=(name,top,height)=>{const node=W.document.createElement('article');node.id=name;return at(node,top,height);};
 const held=(name,top,height)=>{const placeholder=at(W.document.createElement('div'),top,height);placeholder.className='virtualized-placeholder';const node=card(name,top,height);feed.append(placeholder);return {node,placeholder,height};};
 const run=()=>{while(frames.length)frames.shift()();};
 const idle=()=>new Promise(resolve=>setTimeout(resolve,W.__rtFeedIdleMs*2+20));W.__rtFeedIdleMs=30;
 return {W,calls,feed,controller,nativeCalls,at,card,held,run,observers,intersect,idle};
}
test('owned profile feeds restore any placeholder near the viewport, whatever its stack order',async t=>{
 const {W,feed,controller,held,card,run,idle}=virtualFeed(t);
 // Discovery reordered the feed: the entry nearest the viewport is buried
 // under entries for placeholders far above, which stopped Reddit's own pop loop.
 const near=held('near',-300,500),far=held('far',-9000,400),beyond=held('beyond',-8000,400);
 const dup=held('dup',100,200);feed.append(dup.node);// card already back in the feed
 const detachedPlaceholder=W.document.createElement('div');const detached={node:card('detached',0,100),placeholder:detachedPlaceholder,height:100};
 controller.topStack.push(near,detached,dup,far,beyond);
 W.document.dispatchEvent(new W.Event('scroll'));run();await idle();run();
 assert.equal(near.node.parentElement,feed,'the visible card returns to its own position');assert.equal(near.placeholder.isConnected,false);
 assert.equal(dup.placeholder.isConnected,false,'a duplicate placeholder is dropped, its card stays');assert.equal(feed.querySelectorAll('#dup').length,1);
 assert.deepEqual(controller.topStack.map(entry=>entry.node.id),['far','beyond'],'far entries and nothing stale remain');
 assert.equal(controller.topPadding,800);
});
test('owned feeds virtualize only cards far above the viewport, in Reddit\'s entry shape',async t=>{
 const {W,feed,controller,nativeCalls,card,run}=virtualFeed(t);
 const old=card('old',-4000,500),recent=card('recent',-900,400),visible=card('visible',0,500),loader=card('loader',-5000,50);loader.dataset.rtUi='profile-loading';
 feed.append(loader,old,recent,visible);await new Promise(resolve=>setTimeout(resolve,0));run();for(const held of controller.topStack)held.placeholder.getBoundingClientRect=()=>({top:-4000,bottom:-3500,height:held.height});// a real placeholder sits where its card was
 controller._virtualizeTop(5000);assert.deepEqual(nativeCalls,[],'native virtualization is replaced while discovery owns the feed');run();
 assert.equal(old.isConnected,false);assert.equal(controller.topStack.length,1);const [entry]=controller.topStack;assert.equal(entry.node,old);assert.equal(entry.height,500);assert.equal(entry.placeholder.className,'virtualized-placeholder');assert.equal(entry.placeholder.style.height,'500px');
 assert.ok(recent.isConnected && visible.isConnected && loader.isConnected,'nearby cards and extension UI stay mounted');
});
test('ordinary feeds keep native virtualization, and releasing a feed restores what it holds',async t=>{
 const plain=virtualFeed(t,{owned:false});plain.held('x',-200,100);plain.controller.topStack.push({node:plain.card('x',0,1),placeholder:plain.feed.firstElementChild,height:100});plain.W.document.dispatchEvent(new plain.W.Event('scroll'));plain.run();
 assert.equal(plain.feed.firstElementChild.className,'virtualized-placeholder','an ordinary feed is untouched');assert.equal(plain.calls.length,0);
 const {W,feed,controller,nativeCalls,held,run,idle}=virtualFeed(t);const entry=held('kept',-9000,300);controller.topStack.push(entry);W.document.dispatchEvent(new W.Event('scroll'));run();await idle();run();assert.equal(entry.placeholder.isConnected,true);
 W.document.documentElement.removeAttribute('data-rt-profile-discovery');controller._virtualizeTop(-50);
 assert.equal(entry.node.parentElement,feed,'held cards return before Reddit resumes');assert.equal(controller.topStack.length,0);assert.equal(controller.topPadding,0);assert.deepEqual(nativeCalls,[-50]);
});
test('a feed sync measures first, then writes, and does not wake itself',async t=>{
 const {W,feed,controller,card,at,run}=virtualFeed(t);let frames=0;const log=[],raf=W.requestAnimationFrame;W.requestAnimationFrame=callback=>{frames++;return raf(callback);};
 const tall=(name,top,height)=>{const node=card(name,top,height),measure=node.getBoundingClientRect;node.getBoundingClientRect=()=>{log.push('read');return measure();};return node;};
 const old=tall('old',-4000,500),older=tall('older',-4600,500),visible=tall('visible',0,500);feed.append(old,older,visible);
 const replace=feed.replaceChild.bind(feed);feed.replaceChild=(placeholder,node)=>{log.push('write');return replace(placeholder,node);};
 await new Promise(resolve=>setTimeout(resolve,0));run();
 assert.equal(controller.topStack.length,2,'both far cards were virtualized');
 // Every measurement of the pass precedes every change, apart from the one that keeps the reader in place.
 assert.match(log.join(),/^(read,)+write,write(,read)?$/);
 frames=0;await new Promise(resolve=>setTimeout(resolve,0));assert.equal(frames,0,'its own changes schedule no further pass');
 at(visible,0,500);feed.append(tall('later',600,300));await new Promise(resolve=>setTimeout(resolve,0));assert.equal(frames>0,true,'a change by someone else still does');
});
function nativePostHtml({id='abc12',author='Example',crosspost=false,embedded='',next='/svc/shreddit/search/?q=author%3A%22Example%22&type=posts&sort=new&cursor=opaque_post_cursor'}={}){
 const context=JSON.stringify({post:{id:'t3_'+id,title:'Public',nsfw:false,spoiler:false},profile:{name:author},subreddit:{name:'example'}});
 const tracker=`<search-telemetry-tracker data-faceplate-tracking-context='${context}'><a data-testid="post-title" href="/r/example/comments/${id}/public/">Public</a></search-telemetry-tracker>`;
 return `<search-telemetry-tracker view-events="search/view/post" data-faceplate-tracking-context='${crosspost?JSON.stringify({post:{id:'t3_'+id,title:'Public'},subreddit:{name:'example'}}):context}'><div data-testid="${crosspost?'search-crosspost-unit':'search-post-unit'}">${tracker}<faceplate-timeago ts="2026-08-07T20:51:48.364000+0000"></faceplate-timeago>${embedded}<div data-testid="search-counter-row"><faceplate-number number="42"></faceplate-number><faceplate-number number="3"></faceplate-number></div></div></search-telemetry-tracker>`+(next?`<faceplate-partial loading="lazy" src='${next}'></faceplate-partial>`:'');
}
test('native post search reads outer crosspost metadata without importing embedded originals',async t=>{
 const embedded=nativePostHtml({id:'other',author:'Example',next:''}).replace('view-events="search/view/post"','click-events="search/click/post"'),e=setup(t,{fetcher:async()=>nativeResponse(nativePostHtml({crosspost:true,embedded}))});
 const result=await e.send({action:'profile',username:'Example'});assert.equal(result.ok,true);assert.equal(result.posts.length,1);assert.equal(result.posts[0].id,'abc12');assert.equal(result.posts[0].score,42);assert.equal(result.posts[0].comments,3);assert.equal(result.posts[0].created,1786135908);
 await e.send({action:'profile',username:'Example',after:result.after});assert.equal(new URL(e.calls[1][0]).searchParams.get('cursor'),'opaque_post_cursor');
 for(const input of [{username:'Example',sort:'top'}, {username:'Example',range:'day'}])assert.match((await e.send({action:'profile',...input,after:result.after})).error,/cursor/);
});
test('post continuations stay bound to transport, author, sort and time range',async t=>{
 const e=setup(t),first=await e.send({action:'profile',username:'Example'});
 e.W.document.body.innerHTML='<aside id="right-sidebar-container"><faceplate-tracker source="profile" noun="unblock_user"></faceplate-tracker></aside>';
 await e.send({action:'profile',username:'Example',after:first.after});assert.equal(new URL(e.calls[1][0]).pathname,'/svc/shreddit/search/');
 for(const patch of [{username:'other'},{transport:'external'},{cursor:'bad\nvalue'}]){const page={...JSON.parse(first.after.slice(15)),...patch};assert.equal((await e.send({action:'profile',username:'Example',after:'rt-post-search:'+JSON.stringify(page)})).ok,false);}
 for(const next of ['https://evil.test/?cursor=bad','/svc/shreddit/search/?q=author%3A%22Other%22&type=posts&sort=new&cursor=bad','/svc/shreddit/search/?q=author%3A%22Example%22&type=comments&sort=new&cursor=bad']){
  const foreign=setup(t,{fetcher:async()=>nativeResponse(nativePostHtml({next}))});assert.equal((await foreign.send({action:'profile',username:'Example'})).after,null);
 }
});
test('a native page is not truncated at the old JSON page size',async t=>{
 const html=Array.from({length:27},(_,i)=>nativePostHtml({id:'post'+i,next:''})).join(''),e=setup(t,{fetcher:async()=>nativeResponse(html)});
 const result=await e.send({action:'profile',username:'Example'});assert.equal(result.ok,true);assert.equal(result.posts.length,27);
});
test('explicitly blocked profiles use credential-free native search because signed-in search omits them and legacy JSON is refused',async t=>{
 const empty='<search-telemetry-tracker view-events="search/view/no_results" data-faceplate-tracking-context=\'{"action_info":{"reason":"empty"}}\'></search-telemetry-tracker>';
 const e=setup(t,{fetcher:async()=>nativeResponse(empty)});e.W.document.body.innerHTML='<aside id="right-sidebar-container"><faceplate-tracker source="profile" noun="unblock_user"><button>Blocked</button></faceplate-tracker></aside>';
 const result=await e.send({action:'profile',username:'Example'});assert.equal(result.ok,true);const [url,options]=e.calls[0];assert.equal(new URL(url).pathname,'/svc/shreddit/search/');assert.equal(new URL(url).searchParams.get('type'),'posts');assert.equal(options.credentials,'omit');assert.equal(options.referrerPolicy,'no-referrer');assert.equal(options.cache,'no-store');
 e.W.document.body.replaceChildren();await e.send({action:'profile',username:'Example'});assert.equal(e.calls[1][1].credentials,'include','unblocked profiles keep signed-in search');
});
test('native post search distinguishes genuine empty results from changed or unsafe HTML',async t=>{
 for(const html of [nativePostHtml({author:'Other'}),nativePostHtml().replace('/r/example/comments/abc12/public/','https://evil.test/comments/abc12/'),'<h1>Sign in</h1>',nativePostHtml().replace('number="42"','number="bad"')]){
  const e=setup(t,{fetcher:async()=>nativeResponse(html)});assert.equal((await e.send({action:'profile',username:'Example'})).ok,false);
 }
 const empty=setup(t,{fetcher:async()=>nativeResponse('<search-telemetry-tracker view-events="search/view/no_results" data-faceplate-tracking-context=\'{"action_info":{"reason":"empty"}}\'></search-telemetry-tracker>')});const result=await empty.send({action:'profile',username:'Example'});assert.equal(result.ok,true);assert.equal(result.posts.length,0);assert.equal(result.hasMore,false);assert.equal(result.incomplete,true);
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
test('native search keeps each row\'s thumbnail, community icon and, for comments, the post\'s counts',async t=>{
 const context=JSON.stringify({post:{id:'t3_abc12',title:'Public',nsfw:false,spoiler:false},profile:{name:'Example'},subreddit:{name:'example'}});
 const card=`<search-telemetry-tracker view-events="search/view/post" data-faceplate-tracking-context='${context}'><div data-testid="search-post-unit"><h2><a data-testid="post-title" href="/r/example/comments/abc12/public/">Public</a></h2><div data-testid="sdui-post-unit"><div class="post-credit-row"><span avatar=""><img src="https://styles.redditmedia.com/t5_x/styles/communityIcon_a.png"></span></div><faceplate-timeago ts="2026-08-07T20:51:48.364000+0000"></faceplate-timeago><a data-testid="post-title-text" href="/r/example/comments/abc12/public/">Public</a><div data-testid="search-counter-row"><faceplate-number number="2"></faceplate-number><faceplate-number number="1"></faceplate-number></div></div><a><faceplate-img data-testid="search_post_thumbnail" src="https://preview.redd.it/thumb.png?width=140"></faceplate-img></a></div></search-telemetry-tracker>`;
 const e=setup(t,{fetcher:async()=>nativeResponse(card)});const result=await e.send({action:'profile',username:'Example'});assert.equal(result.ok,true,result.error);
 assert.equal(result.posts[0].subredditIcon,'https://styles.redditmedia.com/t5_x/styles/communityIcon_a.png');assert.equal(result.posts[0].media[0].url,'https://preview.redd.it/thumb.png?width=140');
 const html=nativeCommentHtml().replace('</div></div></search-telemetry-tracker>','</div><div data-testid="search-counter-row"><faceplate-number number="867"></faceplate-number><faceplate-number number="100"></faceplate-number></div></div></search-telemetry-tracker>');
 const c=setup(t,{url:'https://www.reddit.com/user/Example/comments/',fetcher:async()=>({ok:true,status:200,headers:new Headers(),text:async()=>html})});const comments=await c.send({action:'profile',username:'Example',kind:'comment'});
 assert.equal(comments.ok,true,comments.error);assert.equal(comments.posts[0].postScore,867);assert.equal(comments.posts[0].postComments,100);assert.equal(comments.posts[0].score,4);
});
function nativeCommentHtml({author='Example',next='/svc/shreddit/search/?q=author%3A%22Example%22&type=comments&sort=new&cursor=opaque_cursor'}={}){
 const context=JSON.stringify({comment:{id:'t1_19rktoupyflj9',post_id:'t3_abc12'},post:{id:'t3_abc12',title:'Parent post',nsfw:false,spoiler:false},subreddit:{name:'example'}});
 return `<search-telemetry-tracker data-faceplate-tracking-context='${context}'><div data-testid="search-sdui-comment-unit"><a href="#">${author}</a><a aria-labelledby="comment-content-one" href="/r/example/comments/abc12/title/19rktoupyflj9/"></a><div data-testid="search-comment-content"><div id="search-comment-one-post-rtjson-content"><p>Public &lt;img onerror=bad()&gt; comment</p><a href="/user/Other/">A mentioned user</a></div><faceplate-timeago ts="2026-10-23T14:56:27Z"></faceplate-timeago><faceplate-number number="4"></faceplate-number></div></div></search-telemetry-tracker><faceplate-partial loading="lazy" src='${next}'></faceplate-partial>`;
}
test('native comment search parses inert public cards and follows only its opaque cursor',async t=>{
 const e=setup(t,{url:'https://www.reddit.com/user/Example/comments/',fetcher:async()=>({ok:true,status:200,headers:new Headers(),text:async()=>nativeCommentHtml()})});
 const result=await e.send({action:'profile',kind:'comment',username:'Example'});assert.equal(result.ok,true);assert.equal(result.posts.length,1);assert.equal(result.posts[0].fullname,'t1_19rktoupyflj9');assert.equal(result.posts[0].body,'Public <img onerror=bad()> comment');assert.equal(JSON.parse(result.after.slice(18)).cursor,'opaque_cursor');
 await e.send({action:'profile',kind:'comment',username:'Example',after:result.after});const u=new URL(e.calls[1][0]);assert.equal(u.pathname,'/svc/shreddit/search/');assert.equal(u.searchParams.get('cursor'),'opaque_cursor');assert.equal(u.searchParams.get('type'),'comments');
});
test('comment search reads absolute profile links and u/ prefixes as the author, ignoring mentions in the text',async t=>{
 const html=nativeCommentHtml().replace('<a href="#">Example</a>','<a href="https://www.reddit.com/user/Example/">u/Example</a>');assert.notEqual(html,nativeCommentHtml(),'fixture uses the old author link');
 const e=setup(t,{fetcher:async()=>({ok:true,status:200,headers:new Headers(),text:async()=>html})});const r=await e.send({action:'profile',kind:'comment',username:'Example'});assert.equal(r.ok,true,r.error);assert.equal(r.posts.length,1);assert.equal(r.posts[0].author,'Example');
});
test('native comment search refuses foreign authors and external pagination',async t=>{
 const foreign=setup(t,{fetcher:async()=>({ok:true,status:200,headers:new Headers(),text:async()=>nativeCommentHtml({author:'Other'})})});const refused=await foreign.send({action:'profile',kind:'comment',username:'Example'});assert.equal(refused.ok,false);assert.match(refused.error,/other people’s comments/,'not misreported as a format change');
 const e=setup(t,{fetcher:async()=>({ok:true,status:200,headers:new Headers(),text:async()=>nativeCommentHtml({next:'https://evil.test/?cursor=bad'})})});assert.equal((await e.send({action:'profile',kind:'comment',username:'Example'})).after,null);
});
test('public comment discovery omits credentials and separates HTTP cache and cursors from signed-in search',async t=>{
 const e=setup(t,{fetcher:async()=>nativeResponse(nativeCommentHtml())});const pub=await e.send({action:'profile',kind:'comment',username:'Example',stream:'public'});assert.equal(pub.ok,true);assert.equal(pub.posts.length,1);assert.equal(e.calls[0][1].credentials,'omit');assert.equal(e.calls[0][1].cache,'no-store');assert.equal(e.calls[0][1].referrerPolicy,'no-referrer');assert.equal(JSON.parse(pub.after.slice(18)).stream,'public');
 for(const extra of [{stream:'authenticated'},{stream:'public',sort:'hot'},{stream:'public',range:'day'}])assert.equal((await e.send({action:'profile',kind:'comment',username:'Example',after:pub.after,...extra})).ok,false);assert.equal(e.calls.length,1);
 await e.send({action:'profile',kind:'comment',username:'Example',stream:'public',after:pub.after});assert.equal(new URL(e.calls[1][0]).searchParams.get('cursor'),'opaque_cursor');const auth=await e.send({action:'profile',kind:'comment',username:'Example'});assert.equal(e.calls[2][1].credentials,'include');assert.equal(e.calls[2][1].cache,'no-store');assert.equal(JSON.parse(auth.after.slice(18)).stream,'authenticated');assert.equal((await e.send({action:'profile',kind:'comment',username:'Example',stream:'public',after:auth.after})).ok,false);assert.equal((await e.send({action:'profile',kind:'post',username:'Example',stream:'public'})).ok,false);
});
test('comment discovery distinguishes empty searches from failed HTML and does not truncate native pages',async t=>{
 for(const stream of ['authenticated','public']){const e=setup(t,{fetcher:async()=>nativeResponse('<h1>Try again later</h1>')});assert.equal((await e.send({action:'profile',kind:'comment',username:'Example',stream})).ok,false);}
 const empty=setup(t,{fetcher:async()=>nativeResponse('<search-telemetry-tracker view-events="search/view/no_results" data-faceplate-tracking-context=\'{"action_info":{"reason":"empty"}}\'></search-telemetry-tracker>')});const result=await empty.send({action:'profile',kind:'comment',username:'Example',stream:'public'});assert.equal(result.ok,true);assert.equal(result.posts.length,0);assert.equal(result.hasMore,false);
 const page=setup(t,{fetcher:async()=>nativeResponse(Array.from({length:27},(_,i)=>nativeCommentHtml().replaceAll('19rktoupyflj9','cmnt'+i)).join(''))});assert.equal((await page.send({action:'profile',kind:'comment',username:'Example',stream:'public'})).posts.length,27);
});
test('native card publication waits for its component definition and first render',async t=>{
 const e=setup(t,{fetcher:async()=>nativeResponse('<shreddit-post id="t3_abc12">Native content</shreddit-post>')}),slot=nativeTarget(e,{defineCard:false});slot.dataset.rtNativeState='loading';let settled=false,finish;const result=e.send({action:'render-card',username:'Example',kind:'post',postId:'abc12',target:slot.id}).then(value=>{settled=true;return value;});await new Promise(r=>setImmediate(r));assert.ok(slot.querySelector('shreddit-post'));assert.equal(settled,false);assert.equal(slot.dataset.rtNativeState,'loading');e.W.customElements.define('shreddit-post',class extends e.W.HTMLElement{constructor(){super();this.updateComplete=new Promise(resolve=>finish=resolve);}});await new Promise(r=>setImmediate(r));assert.equal(settled,false);finish(true);assert.equal((await result).rendered,true);assert.equal(slot.dataset.rtNativeState,'ready');
});
test('native component readiness cannot publish into another route and a missing module times out',async t=>{
 for(const mode of ['route','timeout']){const e=setup(t,{fetcher:async()=>nativeResponse('<shreddit-post id="t3_abc12">Native content</shreddit-post>')}),slot=nativeTarget(e,{defineCard:false});if(mode==='timeout'){const nativeTimer=e.W.setTimeout.bind(e.W);e.W.setTimeout=(cb,ms,...args)=>nativeTimer(cb,ms===10000?10:ms,...args);}const pending=e.send({action:'render-card',username:'Example',kind:'post',postId:'abc12',target:slot.id});await new Promise(r=>setImmediate(r));if(mode==='route'){e.W.history.pushState({},'','/user/Other/');e.W.customElements.define('shreddit-post',class extends e.W.HTMLElement{});}const result=await pending;assert.equal(result.ok,false);assert.notEqual(slot.dataset.rtNativeState,'ready');assert.match(result.error,mode==='route'?/Page changed/:/timed out/);}
});
test('public comment status lookups use t1 identities and cannot escape post-detail scope',async t=>{
 const e=setup(t,{url:'https://www.reddit.com/user/Example/comments/'});await e.send({action:'info',kind:'comment',ids:['19rktoupyflj9']});assert.equal(new URL(e.calls[0][0]).searchParams.get('id'),'t1_19rktoupyflj9');
 const detail=setup(t,{url:'https://www.reddit.com/comments/abc12/title/'});assert.equal((await detail.send({action:'info',kind:'comment',ids:['19rktoupyflj9']})).ok,false);assert.equal(detail.calls.length,0);
});
function nativeTarget(e,{kind='post',id='abc12',target='rt-native-fixture',defineCard=true}={}){
 const w=e.W,tag=kind==='comment'?'shreddit-profile-comment':'shreddit-post';if(defineCard && !w.customElements.get(tag))w.customElements.define(tag,class extends w.HTMLElement{});let main=w.document.querySelector('main');if(!main){main=w.document.createElement('main');w.document.body.append(main);}const slot=w.document.createElement('div');slot.id=target;slot.dataset.rtUi='activity-item';slot.dataset.rtNativeFullname=(kind==='comment'?'t1_':'t3_')+id;main.append(slot);
 if(!w.customElements.get('faceplate-partial'))w.customElements.define('faceplate-partial',class extends w.HTMLElement{_renderContent(text){this.innerHTML=text;}});
 return slot;
}
const nativeResponse=(html,status=200)=>({ok:status===200,status,headers:new Headers({'content-type':'text/vnd.reddit.partial+html'}),text:async()=>html});
test('native feed cards use the first-party profile renderer without returning authenticated HTML',async t=>{
 const e=setup(t,{fetcher:async()=>nativeResponse('<article><shreddit-post id="t3_abc12"><span slot="credit-bar">Native metadata</span><button aria-label="Upvote">↑</button><button>Share</button><img src="https://i.redd.it/synthetic.png"><input name="csrf_token" value="synthetic-only"></shreddit-post></article><hr>')});const slot=nativeTarget(e);
 const result=await e.send({action:'render-card',username:'Example',kind:'post',postId:'abc12',target:slot.id});assert.equal(result.ok,true);assert.equal(result.rendered,true);assert.equal(result.html,undefined);assert.equal(JSON.stringify(result).includes('synthetic-only'),false);assert.ok(slot.querySelector('[aria-label=Upvote]'));assert.ok(slot.querySelector('img'));
 const u=new URL(e.calls[0][0]);assert.equal(u.pathname,'/svc/shreddit/partial-feed-post/t3_abc12');assert.equal(u.searchParams.get('pvc'),'ProfileFeed2');assert.equal(u.searchParams.get('fvt'),'cardView');assert.equal(slot.dataset.rtNativeState,'ready');
});
test('a rendered card reports the status it proves, and a gone comment reports deleted',async t=>{
 const card=`<shreddit-profile-comment comment-id="t1_19rktoupyflj9" author="Example"><faceplate-timeago ts="2026-10-20T12:00:00Z"></faceplate-timeago><div class="md">Synthetic public comment</div></shreddit-profile-comment>`;
 const e=setup(t,{url:'https://www.reddit.com/user/Example/comments/',fetcher:async()=>nativeResponse(card)}),slot=nativeTarget(e,{kind:'comment',id:'19rktoupyflj9'});
 const r=await e.send({action:'render-card',username:'Example',kind:'comment',postId:'19rktoupyflj9',target:slot.id});assert.equal(r.rendered,true);assert.equal(r.status,'available');
 const gone=setup(t,{url:'https://www.reddit.com/user/Example/comments/',fetcher:async()=>nativeResponse('<faceplate-loader></faceplate-loader>')}),goneSlot=nativeTarget(gone,{kind:'comment',id:'19rktoupyflj9'});
 // Current cards name the author only in the poster line.
 const linked=setup(t,{url:'https://www.reddit.com/user/Example/comments/',fetcher:async()=>nativeResponse(`<shreddit-profile-comment comment-id="t1_19rktoupyflj9" item-state="UNMODERATED"><div id="poster-info-t1_19rktoupyflj9"><a href="/user/Example/">Example</a></div><faceplate-timeago ts="2026-10-20T12:00:00Z"></faceplate-timeago><div class="md">Synthetic public comment</div></shreddit-profile-comment>`)}),linkedSlot=nativeTarget(linked,{kind:'comment',id:'19rktoupyflj9'});
 assert.equal((await linked.send({action:'render-card',username:'Example',kind:'comment',postId:'19rktoupyflj9',target:linkedSlot.id})).status,'available');
 const foreign=setup(t,{url:'https://www.reddit.com/user/Example/comments/',fetcher:async()=>nativeResponse(`<shreddit-profile-comment comment-id="t1_19rktoupyflj9"><div id="poster-info-t1_19rktoupyflj9"><a href="/user/Other/">Other</a></div><faceplate-timeago ts="2026-10-20T12:00:00Z"></faceplate-timeago><div class="md">Synthetic public comment</div></shreddit-profile-comment>`)}),foreignSlot=nativeTarget(foreign,{kind:'comment',id:'19rktoupyflj9'});
 assert.equal((await foreign.send({action:'render-card',username:'Example',kind:'comment',postId:'19rktoupyflj9',target:foreignSlot.id})).status,undefined);
 const g=await gone.send({action:'render-card',username:'Example',kind:'comment',postId:'19rktoupyflj9',target:goneSlot.id});assert.equal(g.ok,false);assert.match(g.error,/no longer has this comment/);
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
 e.W.customElements.define('faceplate-partial',class extends e.W.HTMLElement{_renderContent(html){this.innerHTML=html;}});e.W.customElements.define('shreddit-post',class extends e.W.HTMLElement{});assert.equal((await e.send(input)).rendered,true);assert.equal(e.calls.length,1);
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
 const html=fs.readFileSync('tests/fixtures/native-profile-controls.html','utf8').replace('</svg></button>','</svg>Feed options</button>')+'<main>Unrelated private feed</main>',e=setup(t,{url:'https://www.reddit.com/user/Example/comments/?sort=top&t=day&feedViewType=compactView',fetcher:async()=>nativeResponse(html)}),target=controlsTarget(e);const result=await e.send({action:'render-controls',username:'Example',target:target.id});assert.equal(result.rendered,true);assert.equal(result.html,undefined);assert.equal(JSON.stringify(result).includes('private'),false);assert.equal(target.textContent.includes('Unrelated'),false);assert.ok(target.querySelector('shreddit-layout-event-setter rpl-dropdown[placement="bottom-start"]'));assert.equal(target.querySelector('button').getAttribute('aria-label'),'Feed options');assert.ok(target.querySelector('button svg[icon-name="filter"]'),'Comments keeps the Feed options icon like Posts');assert.equal(target.querySelector('button').textContent.trim(),'Feed options','not replaced by the sort label');assert.equal(target.querySelector('.main-menu-container > div').textContent.trim(),'Feed options');const source=new URL(e.calls[0][0]);assert.equal(source.pathname,'/user/reddit/submitted/');assert.equal(source.searchParams.get('feedViewType'),'compactView');for(const row of target.querySelectorAll('rpl-menu-item[href]'))assert.equal(new URL(row.getAttribute('href'),'https://www.reddit.com').pathname,'/user/Example/comments/');const second=controlsTarget(e,'rt-controls-second');assert.equal((await e.send({action:'render-controls',username:'Example',target:second.id})).rendered,true);assert.equal(e.calls.length,1);
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
test('Comments keeps the fetched Feed options trigger and menu, leaving Reddit\'s sort button alone',async t=>{
 const html=fs.readFileSync('tests/fixtures/native-profile-controls.html','utf8'),e=setup(t,{url:'https://www.reddit.com/user/Example/comments/?feedViewType=compactView',fetcher:async()=>nativeResponse(html)}),target=controlsTarget(e),sort=e.W.document.createElement('shreddit-sort-dropdown');sort.attachShadow({mode:'open'}).innerHTML='<button aria-label="Sort by: New" class="button button-small button-plain"><span>New</span><svg icon-name="caret-down"></svg></button>';target.before(sort);const result=await e.send({action:'render-controls',username:'Example',target:target.id});assert.equal(result.rendered,true);
 const trigger=target.querySelector('button');assert.equal(trigger.getAttribute('aria-label'),'Feed options');assert.ok(trigger.querySelector('svg[icon-name="filter"]'));assert.equal(trigger.getAttribute('aria-expanded'),null);assert.equal(sort.shadowRoot.querySelector('button').getAttribute('aria-label'),'Sort by: New');
 const menu=target.querySelector('.main-menu-container');assert.deepEqual([...menu.children].map(n=>n.getAttribute('aria-label') || n.textContent.trim()),['Feed options','New','Top'],'the View section does not apply to Comments');
 const sortLink=menu.querySelector('rpl-menu-item[href]');assert.equal(new URL(sortLink.getAttribute('href'),'https://www.reddit.com').pathname,'/user/Example/comments/');
});
test('Comments keeps Reddit\'s View section when the page shows its own layout control',async t=>{
 const html=fs.readFileSync('tests/fixtures/native-profile-controls.html','utf8'),e=setup(t,{url:'https://www.reddit.com/user/Example/comments/',fetcher:async()=>nativeResponse(html)}),target=controlsTarget(e),layout=e.W.document.createElement('shreddit-layout-switcher');target.before(layout);await e.send({action:'render-controls',username:'Example',target:target.id});
 assert.deepEqual([...target.querySelector('.main-menu-container').children].map(n=>n.getAttribute('aria-label') || n.textContent.trim()),['Feed options','New','Top','View','Compact']);
});

const statusPost=(id='abc12',extra='',body='Public text',author='Example')=>`<shreddit-post id="t3_${id}" author="${author}" post-title="Synthetic public title" created-timestamp="2026-10-20T12:00:00Z" ${extra}><div slot="text-body">${body}</div><input name="csrf_token" value="synthetic-private"></shreddit-post>`;
test('archive status uses authenticated native fragments when legacy info is forbidden, returning only compact evidence',async t=>{
 const e=setup(t,{fetcher:async url=>new URL(url).pathname==='/api/info.json'?nativeResponse('',403):nativeResponse(statusPost('abc12','item-state="REMOVED"','[removed]'))});
 const result=await e.send({action:'status',username:'Example',kind:'post',ids:['abc12']});assert.equal(result.ok,true);assert.deepEqual(result.statuses,[{fullname:'t3_abc12',status:'removed',author:'Example',over18:false,spoiler:false}]);assert.deepEqual(result.unknownIds,[]);assert.equal(result.incomplete,false);assert.equal(JSON.stringify(result).includes('synthetic-private'),false);assert.equal(JSON.stringify(result).includes('Public text'),false);assert.equal(result.via,'native');assert.equal(new URL(e.calls[0][0]).pathname,'/api/info.json');const [url,options]=e.calls[1];assert.equal(new URL(url).pathname,'/svc/shreddit/partial-feed-post/t3_abc12');assert.equal(options.credentials,'include');assert.equal(options.redirect,'error');assert.equal(options.method,'GET');assert.equal(e.calls.length,2);
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
 const input={action:'status',username:'Example',kind:'post',ids:['abc12','t3_abc12']};assert.equal((await e.send(input)).statuses.length,1);assert.equal(e.calls.length,1);now+=30001;assert.equal((await e.send(input)).statuses[0].status,'available');assert.equal(e.calls.length,3);
});
test('native comment status checks require their exact t1 identity and accept explicit tombstones with no archived body',async t=>{
 const e=setup(t,{fetcher:async()=>nativeResponse('<shreddit-profile-comment comment-id="t1_19rktoupyflj9" author="[deleted]" item-state="DELETED"><div class="md">[deleted]</div></shreddit-profile-comment>')});
 const result=await e.send({action:'status',username:'Example',kind:'comment',ids:['19rktoupyflj9']});assert.equal(result.statuses[0].fullname,'t1_19rktoupyflj9');assert.equal(result.statuses[0].status,'deleted');assert.equal(new URL(e.calls[1][0]).pathname,'/svc/shreddit/comment/t1_19rktoupyflj9');assert.equal(new URL(e.calls[1][0]).searchParams.get('isProfile'),'true');
});
test('status batch limits concurrent native requests to two and abandons a changed route',async t=>{
 let running=0,maximum=0;const pending=[],e=setup(t,{fetcher:url=>{if(new URL(url).pathname==='/api/info.json')return nativeResponse('',403);running++;maximum=Math.max(maximum,running);return new Promise(resolve=>pending.push(()=>{running--;resolve(nativeResponse(statusPost(new URL(url).pathname.split('_').pop())));}));}});
 const read=e.send({action:'status',username:'Example',kind:'post',ids:['one','two','three']});await new Promise(r=>setImmediate(r));assert.equal(pending.length,2);pending.shift()();await new Promise(r=>setImmediate(r));assert.equal(pending.length,2);assert.equal(maximum,2);e.W.history.pushState({},'','/user/Other/');for(const finish of pending)finish();assert.match((await read).error,/Page changed/);assert.equal(e.calls.length,4);
});
test('native status rate limiting stops the batch without automatic retries and preserves unknown evidence',async t=>{
 const e=setup(t,{fetcher:async()=>({ok:false,status:429,headers:new Headers({'Retry-After':'30'})})});const result=await e.send({action:'status',username:'Example',kind:'post',ids:['one','two','three','four']});assert.equal(result.ok,true);assert.equal(result.statuses.length,0);assert.equal(result.unknownIds.length,4);assert.ok(e.calls.length<=2);assert.match((await e.send({action:'status',username:'Example',kind:'post',ids:['one']})).error,/asked us to wait/);
});
test('status reuses genuine native DOM but never trusts archive-generated cards as current evidence',async t=>{
 const e=setup(t,{fetcher:async()=>nativeResponse('',403)});e.W.document.body.innerHTML='<main>'+statusPost('native','item-state="removed"','[removed]')+'<div data-rt-ui="activity-item">'+statusPost('archive','deleted','[deleted]')+'</div></main>';
 const result=await e.send({action:'status',username:'Example',kind:'post',ids:['native','archive']});assert.equal(result.statuses.length,1);assert.equal(result.statuses[0].fullname,'t3_native');assert.deepEqual(result.unknownIds,['t3_archive']);assert.equal(e.calls.length,2);assert.equal(new URL(e.calls[0][0]).pathname,'/api/info.json');assert.equal(new URL(e.calls[1][0]).pathname,'/svc/shreddit/partial-feed-post/t3_archive');
});
test('a stalled native status batch returns unknown IDs and aborts its unshared authenticated reads',async t=>{
 const signals=[],e=setup(t,{fetcher:(url,options)=>{signals.push(options.signal);return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));}});
 e.W.setTimeout=(fn,delay)=>{if(delay===4000)return 0;assert.equal(delay,10000);queueMicrotask(fn);return 1;};const result=await e.send({action:'status',username:'Example',kind:'post',ids:['one','two','three']});assert.equal(result.ok,true);assert.equal(result.timedOut,true);assert.deepEqual(result.statuses,[]);assert.deepEqual(result.unknownIds,['t3_one','t3_two','t3_three']);assert.equal(result.incomplete,true);assert.equal(signals.length,1);assert.ok(signals.every(signal=>signal.aborted));assert.equal(e.calls.length,1);
});
test('archive status joins both busy native renders and waits for remaining capacity without false unknown results',async t=>{
 const pending=[],e=setup(t,{fetcher:url=>new URL(url).pathname==='/api/info.json'?nativeResponse('',403):new Promise(resolve=>pending.push({id:new URL(url).pathname.split('_').pop(),finish:()=>resolve(nativeResponse(statusPost(new URL(url).pathname.split('_').pop())))}))});
 const one=nativeTarget(e,{id:'one',target:'rt-native-one'}),two=nativeTarget(e,{id:'two',target:'rt-native-two'}),render=id=>e.send({action:'render-card',username:'Example',kind:'post',postId:id,target:id==='one'?one.id:two.id});
 const r1=render('one'),r2=render('two'),status=e.send({action:'status',username:'Example',kind:'post',ids:['one','two','three']});assert.equal(e.calls.length,3);assert.equal(pending.length,2);pending.splice(0).forEach(read=>read.finish());await new Promise(r=>setImmediate(r));assert.equal(pending.length,1);assert.equal(pending[0].id,'three');pending.shift().finish();assert.equal((await r1).rendered,true);assert.equal((await r2).rendered,true);const result=await status;assert.equal(result.statuses.length,3);assert.deepEqual(result.unknownIds,[]);assert.equal(e.calls.length,4);
});
test('status fetched fragments render through Reddit native components without a second endpoint read',async t=>{
 const e=setup(t,{fetcher:async()=>nativeResponse(statusPost())}),result=await e.send({action:'status',username:'Example',kind:'post',ids:['abc12']});assert.equal(result.statuses[0].status,'available');const target=nativeTarget(e);assert.equal((await e.send({action:'render-card',username:'Example',kind:'post',postId:'abc12',target:target.id})).rendered,true);assert.equal(e.calls.length,2);assert.equal(target.querySelector('faceplate-partial').src,'/svc/shreddit/partial-feed-post/t3_abc12?pvc=ProfileFeed2&fvt=cardView');assert.equal(target.querySelector('shreddit-post').getAttribute('author'),'Example');
});
test('a comment Reddit answers with an empty shell is deleted; removed comments still get a card',async t=>{
 // Reddit renders a comment its author deleted exactly like an ID that never existed: no card at all.
 const shell='<faceplate-loader></faceplate-loader><ac-dispatch></ac-dispatch><script>SML.load([])</script>';
 const card=(id,body)=>`<shreddit-profile-comment comment-id="${id}" author="[deleted]"><faceplate-timeago ts="2026-10-20T12:00:00Z"></faceplate-timeago><div class="md">${body}</div></shreddit-profile-comment>`;
 const e=setup(t,{fetcher:async url=>{const id=new URL(url).pathname.split('/').pop();return id==='t1_gone'?nativeResponse(shell):id==='t1_modded'?nativeResponse(card(id,'[removed]')):id==='t1_other'?nativeResponse(card('t1_elsewhere','Synthetic')):nativeResponse('',403);}});
 const result=await e.send({action:'status',username:'Example',kind:'comment',ids:['gone','modded','other','denied']});
 const by=id=>result.statuses.find(p=>p.fullname===id)?.status;
 assert.equal(by('t1_gone'),'deleted');assert.equal(by('t1_modded'),'removed');
 // A card for another comment, or a refused read, proves nothing about this one.
 assert.deepEqual(new Set(result.unknownIds),new Set(['t1_other','t1_denied']));
});
test('observed UNMODERATED comment state verifies available content, retaining unknown for unfamiliar states',async t=>{
 const e=setup(t,{fetcher:async url=>nativeResponse(`<shreddit-profile-comment comment-id="${new URL(url).pathname.split('/').pop()}" author="Example" item-state="${new URL(url).pathname.includes('normal')?'UNMODERATED':'GATED_NEW_STATE'}"><faceplate-timeago ts="2026-10-20T12:00:00Z"></faceplate-timeago><div class="md">Synthetic public comment</div></shreddit-profile-comment>`)});
 const result=await e.send({action:'status',username:'Example',kind:'comment',ids:['normal','unknown']});assert.equal(result.statuses.length,1);assert.equal(result.statuses[0].status,'available');assert.deepEqual(result.unknownIds,['t1_unknown']);
});
test('status workers wait for unrelated busy native cards instead of skipping all remaining IDs',async t=>{
 const pending=[],e=setup(t,{fetcher:url=>new URL(url).pathname==='/api/info.json'?nativeResponse('',403):new Promise(resolve=>pending.push(()=>resolve(nativeResponse(statusPost(new URL(url).pathname.split('_').pop())))))});
 const one=nativeTarget(e,{id:'one',target:'rt-native-one'}),two=nativeTarget(e,{id:'two',target:'rt-native-two'}),r1=e.send({action:'render-card',username:'Example',kind:'post',postId:'one',target:one.id}),r2=e.send({action:'render-card',username:'Example',kind:'post',postId:'two',target:two.id}),status=e.send({action:'status',username:'Example',kind:'post',ids:['three','four']});assert.equal(e.calls.length,3);pending.splice(0).forEach(finish=>finish());await new Promise(r=>setImmediate(r));assert.equal(e.calls.length,5);pending.splice(0).forEach(finish=>finish());await Promise.all([r1,r2]);const result=await status;assert.equal(result.statuses.length,2);assert.deepEqual(result.unknownIds,[]);
});
test('a status timeout releases its consumer without aborting a native render sharing the same request',async t=>{
 let finish,physicalSignal;const e=setup(t,{fetcher:(url,options)=>{if(new URL(url).pathname==='/api/info.json')return nativeResponse('',403);physicalSignal=options.signal;return new Promise(resolve=>finish=()=>resolve(nativeResponse(statusPost())));}}),timers=[];e.W.setTimeout=(fn,ms)=>ms===4000?0:timers.push(fn);e.W.clearTimeout=()=>{};
 const status=e.send({action:'status',username:'Example',kind:'post',ids:['abc12']}),target=nativeTarget(e),render=e.send({action:'render-card',username:'Example',kind:'post',postId:'abc12',target:target.id});assert.equal(e.calls.length,2);await new Promise(r=>setImmediate(r));timers[0]();const result=await status;assert.equal(result.ok,true);assert.equal(result.timedOut,true);assert.deepEqual(result.unknownIds,['t3_abc12']);assert.equal(physicalSignal.aborted,false);finish();assert.equal((await render).rendered,true);assert.equal(e.calls.length,2);
});
test('a render timeout cannot abort the status consumer that joined its native fragment request',async t=>{
 let finish,physicalSignal;const e=setup(t,{fetcher:(url,options)=>{if(new URL(url).pathname==='/api/info.json')return nativeResponse('',403);physicalSignal=options.signal;return new Promise(resolve=>finish=()=>resolve(nativeResponse(statusPost())));}}),target=nativeTarget(e),timers=[];e.W.setTimeout=(fn,ms)=>ms===4000?0:timers.push(fn);e.W.clearTimeout=()=>{};
 const render=e.send({action:'render-card',username:'Example',kind:'post',postId:'abc12',target:target.id}),status=e.send({action:'status',username:'Example',kind:'post',ids:['abc12']});assert.equal(e.calls.length,2);await new Promise(r=>setImmediate(r));timers[0]();assert.match((await render).error,/timed out/);assert.equal(physicalSignal.aborted,false);finish();const result=await status;assert.equal(result.statuses[0].status,'available');assert.deepEqual(result.unknownIds,[]);assert.equal(target.childElementCount,0);assert.equal(e.calls.length,2);
});
test('a status batch timeout retains finished proofs and reports every unresolved or unstarted ID as unknown',async t=>{
 const signals=[],e=setup(t,{fetcher:(url,options)=>{if(new URL(url).pathname==='/api/info.json')return nativeResponse('',403);if(new URL(url).pathname.endsWith('t3_one'))return nativeResponse(statusPost('one'));signals.push(options.signal);return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));}}),timers=[];e.W.setTimeout=(fn,ms)=>ms===4000?0:timers.push(fn);e.W.clearTimeout=()=>{};
 const status=e.send({action:'status',username:'Example',kind:'post',ids:['one','two','three','four']});await new Promise(resolve=>setImmediate(resolve));assert.equal(e.calls.length,4);timers[0]();const result=await status;assert.equal(result.ok,true);assert.equal(result.timedOut,true);assert.deepEqual(result.statuses.map(p=>p.fullname),['t3_one']);assert.deepEqual(result.unknownIds,['t3_two','t3_three','t3_four']);assert.ok(signals.every(signal=>signal.aborted));assert.equal(e.calls.length,4);
});
test('a changed route never receives partial status proofs when a batch deadline expires',async t=>{
 const e=setup(t,{fetcher:(url,options)=>new URL(url).pathname==='/api/info.json'?nativeResponse('',403):new URL(url).pathname.endsWith('t3_one')?nativeResponse(statusPost('one')):new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}))}),timers=[];e.W.setTimeout=(fn,ms)=>ms===4000?0:timers.push(fn);e.W.clearTimeout=()=>{};
 const status=e.send({action:'status',username:'Example',kind:'post',ids:['one','two']});await new Promise(resolve=>setImmediate(resolve));e.W.history.pushState({},'','/user/Other/');timers[0]();const result=await status;assert.equal(result.ok,false);assert.match(result.error,/Page changed/);assert.equal(result.statuses,undefined);
});

const infoChild=(kind,id,data={})=>({kind,data:{id,name:(kind==='t1'?'t1_':'t3_')+id,author:'Example',created_utc:1700000000,link_id:'t3_abc12',...data}});
const infoResponse=children=>({ok:true,status:200,headers:new Headers({'content-type':'application/json'}),text:async()=>JSON.stringify({data:{children}})});
test('one info read resolves a full mixed post batch, and comment batches use their own read without fragments',async t=>{
 const outcome=n=>['available','deleted','removed'][n%3];
 const e=setup(t,{fetcher:async url=>{const u=new URL(url),requested=u.searchParams.get('id').split(',');return infoResponse(requested.map(fullname=>{const n=Number(fullname.match(/\d+$/)[0]),kind=outcome(n);
  if(fullname.startsWith('t1_'))return infoChild('t1',fullname.slice(3),kind==='available'?{body:'Synthetic public comment'}:kind==='deleted'?{author:'[deleted]',body:'[deleted]'}:{body:'[removed]',removed_by_category:'moderator'});
  return infoChild('t3',fullname.slice(3),kind==='available'?{selftext:'Synthetic public text',over_18:n===0}:kind==='deleted'?{author:'[deleted]',selftext:'[deleted]'}:{selftext:'[removed]',removed_by_category:'moderator'});}));}});
 const posts=await e.send({action:'status',username:'Example',kind:'post',ids:Array.from({length:25},(_,n)=>'p'+String(n).padStart(3,'0'))});
 assert.equal(posts.ok,true);assert.equal(posts.via,'info');assert.equal(posts.incomplete,false);assert.equal(posts.statuses.length,25);
 for(const status of posts.statuses){const n=Number(status.fullname.match(/\d+$/)[0]);assert.equal(status.status,outcome(n));assert.equal(status.author,outcome(n)==='deleted'?'[deleted]':'Example');}
 assert.equal(posts.statuses.find(status=>status.fullname==='t3_p000').over18,true);
 assert.equal(e.calls.length,1,'one info request covers all 25 posts');
 const comments=await e.send({action:'status',username:'Example',kind:'comment',ids:['c000','c001','c002']});
 assert.equal(comments.via,'info');assert.deepEqual(Object.fromEntries(comments.statuses.map(status=>[status.fullname,status.status])),{t1_c000:'available',t1_c001:'deleted',t1_c002:'removed'});
 assert.equal(e.calls.length,2);assert.ok(e.calls.every(([url])=>new URL(url).pathname==='/api/info.json'));
});
test('a forbidden info read sends every ID to fragments and suppresses the fast path for later batches',async t=>{
 const e=setup(t,{fetcher:async url=>new URL(url).pathname==='/api/info.json'?nativeResponse('',403):nativeResponse(statusPost(new URL(url).pathname.split('_').pop()))});
 const first=await e.send({action:'status',username:'Example',kind:'post',ids:['one','two']});assert.equal(first.statuses.length,2);assert.equal(first.via,'native');
 const second=await e.send({action:'status',username:'Example',kind:'post',ids:['three']});assert.equal(second.statuses[0].fullname,'t3_three');assert.equal(second.via,'native');
 assert.deepEqual(e.calls.map(([url])=>new URL(url).pathname.split('/').pop()),['info.json','t3_one','t3_two','t3_three']);
});
test('network failures and malformed info bodies disable only the fast path and keep fragment evidence',async t=>{
 for(const failure of [()=>{throw new TypeError('offline');},()=>nativeResponse('<html>challenge</html>'),()=>infoResponse('not-a-list')]){
  const e=setup(t,{fetcher:async url=>new URL(url).pathname==='/api/info.json'?failure():nativeResponse(statusPost(new URL(url).pathname.split('_').pop()))});
  const first=await e.send({action:'status',username:'Example',kind:'post',ids:['one']});assert.equal(first.statuses[0].status,'available');assert.equal(first.via,'native');
  assert.equal((await e.send({action:'status',username:'Example',kind:'post',ids:['two']})).statuses[0].status,'available');
  assert.equal(e.calls.filter(([url])=>new URL(url).pathname==='/api/info.json').length,1);
 }
});
test('an info rate limit starts the shared cooldown without falling back to fragment reads',async t=>{
 const e=setup(t,{fetcher:async url=>new URL(url).pathname==='/api/info.json'?{ok:false,status:429,headers:new Headers({'Retry-After':'30'})}:nativeResponse(statusPost())});
 const result=await e.send({action:'status',username:'Example',kind:'post',ids:['one','two']});assert.equal(result.ok,true);assert.equal(result.statuses.length,0);assert.deepEqual(result.unknownIds,['t3_one','t3_two']);assert.equal(result.via,'native');assert.equal(e.calls.length,1);
 assert.match((await e.send({action:'status',username:'Example',kind:'post',ids:['one']})).error,/asked us to wait/);assert.equal(e.calls.length,1);
});
test('info cannot prove foreign, omitted or deleted-author available IDs, which keep their fragment checks',async t=>{
 const e=setup(t,{fetcher:async url=>{const u=new URL(url);if(u.pathname==='/api/info.json')return infoResponse([infoChild('t3','a',{selftext:'Synthetic public text'}),infoChild('t3','b',{author:'Other',selftext:'[deleted]'}),infoChild('t3','d',{author:'[deleted]',selftext:'Synthetic public text'})]);return nativeResponse(statusPost(u.pathname.split('_').pop()));}});
 const result=await e.send({action:'status',username:'Example',kind:'post',ids:['a','b','c','d']});
 assert.equal(result.ok,true);assert.equal(result.via,'native');assert.deepEqual(result.unknownIds,[]);
 const byName=Object.fromEntries(result.statuses.map(status=>[status.fullname,status]));
 assert.equal(byName.t3_a.status,'available');assert.equal(byName.t3_b.status,'available');assert.equal(byName.t3_b.author,'Example');assert.equal(byName.t3_c.status,'available');assert.equal(byName.t3_d.author,'Example');
 assert.deepEqual(e.calls.slice(1).map(([url])=>new URL(url).pathname.split('_').pop()).sort(),['b','c','d']);
});
test('cancelling a pending info read rejects as cancelled and does not disable the fast path',async t=>{
 let stalled=true,infoSignal;const e=setup(t,{fetcher:async(url,options)=>{if(new URL(url).pathname!=='/api/info.json')return nativeResponse(statusPost());if(!stalled)return nativeResponse('',403);infoSignal=options.signal;return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));}});
 const id=crypto.randomUUID();const answer=new Promise(resolve=>{const listener=event=>{const response=JSON.parse(event.detail);if(response.id!==id)return;e.W.document.removeEventListener('rt-post-response',listener);resolve(response);};e.W.document.addEventListener('rt-post-response',listener);});
 const dispatch=request=>e.W.document.dispatchEvent(new e.W.CustomEvent('rt-post-request',{detail:JSON.stringify({channel:'test',id,...request})}));
 dispatch({action:'status',username:'Example',kind:'post',ids:['abc12']});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(e.calls.length,1);dispatch({action:'cancel'});
 const result=await answer;assert.equal(result.ok,false);assert.equal(result.error,'Post request cancelled.');assert.equal(infoSignal.aborted,true);
 stalled=false;const retry=await e.send({action:'status',username:'Example',kind:'post',ids:['abc12']});assert.equal(retry.statuses[0].status,'available');
 assert.equal(e.calls.filter(([url])=>new URL(url).pathname==='/api/info.json').length,2,'a cancelled read is not a failed info endpoint');
});
test('a route change while info is pending rejects before any status is returned',async t=>{
 let respond;const e=setup(t,{fetcher:url=>new URL(url).pathname==='/api/info.json'?new Promise(resolve=>respond=resolve):nativeResponse(statusPost())});
 const read=e.send({action:'status',username:'Example',kind:'post',ids:['abc12']});await new Promise(resolve=>setImmediate(resolve));e.W.history.pushState({},'','/user/Other/');respond(infoResponse([infoChild('t3','abc12',{selftext:'Synthetic public text'})]));
 const result=await read;assert.equal(result.ok,false);assert.match(result.error,/Page changed/);assert.equal(result.statuses,undefined);assert.equal(e.calls.length,1);
});
function stalledNativeReads(t){
 const pending=[];let running=0,maximum=0;
 const e=setup(t,{fetcher:url=>{if(new URL(url).pathname==='/api/info.json')return nativeResponse('',403);running++;maximum=Math.max(maximum,running);const fullname=new URL(url).pathname.split('/').pop(),comment=fullname.startsWith('t1_');return new Promise(resolve=>pending.push(()=>{running--;resolve(nativeResponse(comment?`<shreddit-profile-comment comment-id="${fullname}" author="Example"><faceplate-timeago ts="2026-10-20T12:00:00Z"></faceplate-timeago><div class="md">Synthetic comment</div></shreddit-profile-comment>`:statusPost(fullname.slice(3))));}));}});
 const render=(kind,id)=>{const target=nativeTarget(e,{kind,id,target:'rt-native-'+kind+'-'+id});return e.send({action:'render-card',username:'Example',kind,postId:id,target:target.id});};
 return {e,pending,render,maximum:()=>maximum};
}
test('four native comment renders can load together while a fifth request defers',async t=>{
 const {e,pending,render,maximum}=stalledNativeReads(t),reads=['one','two','three','four'].map(id=>render('comment',id));assert.equal(e.calls.length,4);assert.equal((await render('comment','five')).deferred,true);assert.equal(e.calls.length,4);assert.equal(maximum(),4);pending.splice(0).forEach(finish=>finish());for(const result of await Promise.all(reads)){assert.equal(result.rendered,true);assert.equal(result.html,undefined);}
});
test('post renders retain two physical slots while comments can use the remaining shared capacity',async t=>{
 const {e,pending,render,maximum}=stalledNativeReads(t),posts=[render('post','one'),render('post','two')];assert.equal((await render('post','three')).deferred,true);assert.equal(e.calls.length,2);const comments=[render('comment','four'),render('comment','five')];assert.equal(e.calls.length,4);assert.equal((await render('comment','six')).deferred,true);assert.equal(maximum(),4);pending.splice(0).forEach(finish=>finish());for(const result of await Promise.all([...posts,...comments]))assert.equal(result.rendered,true);
});
test('two status workers and native comment renders share a four-read physical budget',async t=>{
 const {e,pending,render,maximum}=stalledNativeReads(t),status=e.send({action:'status',username:'Example',kind:'comment',ids:['one','two','three']}),cards=[render('comment','four'),render('comment','five')];await new Promise(resolve=>setImmediate(resolve));assert.equal(e.calls.length,5);assert.equal((await render('comment','six')).deferred,true);assert.equal(maximum(),4);pending.splice(0).forEach(finish=>finish());await new Promise(resolve=>setImmediate(resolve));assert.equal(e.calls.length,6,'the next status item starts only after capacity is released');assert.equal(pending.length,1);pending.splice(0).forEach(finish=>finish());assert.equal((await status).statuses.length,3);for(const result of await Promise.all(cards))assert.equal(result.rendered,true);assert.equal(maximum(),4);
});
test('a status worker waits when three comment renders leave only one physical slot',async t=>{
 const {e,pending,render,maximum}=stalledNativeReads(t),cards=['one','two','three'].map(id=>render('comment',id)),status=e.send({action:'status',username:'Example',kind:'comment',ids:['four','five']});assert.equal(e.calls.length,4);await new Promise(resolve=>setImmediate(resolve));assert.equal(e.calls.length,5);pending.shift()();await new Promise(resolve=>setImmediate(resolve));assert.equal(e.calls.length,6);assert.equal(maximum(),4);pending.splice(0).forEach(finish=>finish());assert.equal((await status).statuses.length,2);for(const result of await Promise.all(cards))assert.equal(result.rendered,true);assert.equal(maximum(),4);
});
test('a hung info read gives up after its own deadline so fragments still prove the batch',async t=>{
 const e=setup(t,{fetcher:(url,options)=>new URL(url).pathname==='/api/info.json'?new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true})):nativeResponse(statusPost(new URL(url).pathname.split('_').pop()))});
 const native=e.W.setTimeout.bind(e.W);e.W.setTimeout=(fn,ms,...args)=>native(fn,ms===4000?5:ms,...args);
 const result=await e.send({action:'status',username:'Example',kind:'post',ids:['one']});
 assert.equal(result.timedOut,undefined);assert.equal(result.statuses[0].status,'available');assert.equal(result.via,'native');
 await e.send({action:'status',username:'Example',kind:'post',ids:['two']});assert.equal(e.calls.filter(([url])=>new URL(url).pathname==='/api/info.json').length,1,'the stalled fast path is suspended');
});
test('native status recognizes Reddit’s current deletion notices, removal banners and removed titles',async t=>{
 const comment=(id,flags,text)=>`<shreddit-profile-comment comment-id="t1_${id}" author="[deleted]" ${flags} created-timestamp="2026-10-20T12:00:00Z"><div><div><p>${text}</p></div></div></shreddit-profile-comment>`;
 const pages={
  t1_cdel:comment('cdel','is-comment-deleted','Comment deleted by user'),
  t1_crem:comment('crem','is-comment-deleted','Comment removed by moderator'),
  t3_prem:`<shreddit-post id="t3_prem" author="Example" post-title="[ Removed by moderator ]" post-type="link" created-timestamp="2026-10-20T12:00:00Z"><h1 slot="title">[ Removed by moderator ]</h1><div slot="post-removed-banner">Sorry, this post has been removed by the moderators.</div></shreddit-post>`};
 const e=setup(t,{fetcher:async url=>{const u=new URL(url);if(u.pathname==='/api/info.json')return nativeResponse('',403);return nativeResponse(pages[u.pathname.split('/').pop()] || '<div></div>');}});
 const comments=await e.send({action:'status',username:'Example',kind:'comment',ids:['cdel','crem']}),post=await e.send({action:'status',username:'Example',kind:'post',ids:['prem']});
 const status=Object.fromEntries([...comments.statuses,...post.statuses].map(s=>[s.fullname,s.status]));
 assert.equal(status.t1_cdel,'deleted');assert.equal(status.t1_crem,'removed');assert.equal(status.t3_prem,'removed');
});
test('user hover cards supply only a Reddit-hosted https profile picture, cached per name',async t=>{
 const card=src=>`<div><span avatar><img src="${src}" alt="User avatar"></span><p>karma</p></div>`;let src='https://styles.redditmedia.com/t5_1/styles/profileIcon_x.png';
 const e=setup(t,{fetcher:async url=>nativeResponse(card(src))});
 const first=await e.send({action:'user-avatar',username:'Someone'});assert.equal(first.avatar,'https://styles.redditmedia.com/t5_1/styles/profileIcon_x.png');assert.equal(new URL(e.calls[0][0]).pathname,'/svc/shreddit/user-hover-card/Someone');assert.equal(e.calls[0][1].credentials,'include');assert.equal(e.calls[0][1].redirect,'error');assert.match(e.calls[0][1].headers.Accept,/text\/vnd\.reddit\.partial\+html/);assert.equal(e.calls.length,1);
 await e.send({action:'user-avatar',username:'someone'});assert.equal(e.calls.length,1,'cached per username');
 src='https://evil.example/track.png';assert.equal((await e.send({action:'user-avatar',username:'Other'})).avatar,'','foreign image hosts are rejected');
 assert.equal((await e.send({action:'user-avatar',username:'bad name!'})).ok,false);
});


test('comment avatar lookup uses the hover card headshot and reuses exact native signed SVG URLs',async t=>{
 const head='https://styles.redditmedia.com/t5_1/styles/profileIcon_example.png?width=256&height=256&crop=256:256,smart&s=synthetic',body='https://i.redd.it/snoovatar/avatars/example.png';
 const card=`<div class="hover-card"><span avatar><img alt="User avatar" src="${head}"></span><img alt="avatar body" src="${body}"><p>1,234 karma</p></div>`;
 const e=setup(t,{fetcher:async()=>nativeResponse(card)});
 assert.equal((await e.send({action:'user-avatar',username:'Example'})).avatar,head);assert.equal(e.calls.length,1);assert.equal(e.calls[0][1].redirect,'error');
 const signed='https://cf.preview.redd.it/snoovatar/avatars/example-headshot.png?width=64&height=64&crop=smart&auto=webp&s=synthetic';
 const comment=e.W.document.createElement('shreddit-comment');comment.setAttribute('author','Example');comment.innerHTML='<div slot="commentAvatar"><svg><image></image></svg></div>';comment.querySelector('image').setAttribute('href',signed);e.W.document.body.append(comment);
 assert.equal((await e.send({action:'user-avatar',username:'example'})).avatar,signed);assert.equal(e.calls.length,1,'native signed URL needs no lookup');
});

test('avatar lookup never requests about.json and prefers the [avatar] headshot over other images',async t=>{
 const head='https://styles.redditmedia.com/t5_1/styles/profileIcon_example.png',other='https://i.redd.it/awards/gold.png';
 const e=setup(t,{fetcher:async()=>nativeResponse(`<div><img alt="avatar badge" src="${other}"><span avatar><img src="${head}" alt=""></span></div>`)});
 assert.equal((await e.send({action:'user-avatar',username:'Example'})).avatar,head);
 for(const name of ['Deleted1','Suspended1'])await e.send({action:'user-avatar',username:name});
 assert.equal(e.calls.every(([url])=>!/about\.json/.test(url) && new URL(url).pathname.startsWith('/svc/shreddit/user-hover-card/')),true);
});

test('deleted and suspended hover cards have no headshot and keep the native default',async t=>{
 const cards={Gone:'<div class="p-md"><p>This account has been deleted.</p></div>',Banned:'<div class="p-md"><p>u/Banned has been suspended.</p></div>'};
 const e=setup(t,{fetcher:async url=>nativeResponse(cards[decodeURIComponent(new URL(url).pathname.split('/').pop())])});
 for(const name of Object.keys(cards))assert.equal((await e.send({action:'user-avatar',username:name})).avatar,'');
 await e.send({action:'user-avatar',username:'Gone'});assert.equal(e.calls.length,2,'a missing headshot is cached too');
});

test('a failed hover card read returns no avatar and is retried after a short cache',async t=>{
 let ok=false;const head='https://styles.redditmedia.com/t5_1/styles/profileIcon_late.png';
 const e=setup(t,{fetcher:async()=>ok?nativeResponse('<span avatar><img src="'+head+'"></span>'):nativeResponse('',503)});
 assert.equal((await e.send({action:'user-avatar',username:'Late'})).avatar,'');const now=e.W.Date.now();e.W.Date.now=()=>now+61000;ok=true;assert.equal((await e.send({action:'user-avatar',username:'Late'})).avatar,head);assert.equal(e.calls.length,2);
});

test('avatar lookup turns a full-body Snoovatar into its headshot, rejects foreign hosts and respects cooldowns',async t=>{
 // The hover card lists a custom avatar as the full-body image; Reddit's comments use <id>-headshot.png.
 const full='https://i.redd.it/snoovatar/avatars/0a1b2c3d-4e5f-6789-abcd-ef0123456789.png?width=380';
 const e=setup(t,{fetcher:async()=>nativeResponse('<img class="m-0" alt="u/Example avatar" src="'+full+'">')});
 assert.equal((await e.send({action:'user-avatar',username:'Example'})).avatar,'https://i.redd.it/snoovatar/avatars/0a1b2c3d-4e5f-6789-abcd-ef0123456789-headshot.png');assert.equal(e.calls.length,1);
 const foreign=setup(t,{fetcher:async()=>nativeResponse('<img alt="u/Example avatar" src="https://evil.example/snoovatar/avatars/x.png">')});
 assert.equal((await foreign.send({action:'user-avatar',username:'Example'})).avatar,'');
 const rate=setup(t,{fetcher:async()=>nativeResponse('',429,{'retry-after':'60'})});const result=await rate.send({action:'user-avatar',username:'Example'});assert.equal(result.deferred,true);assert.equal(rate.calls.length,1);await rate.send({action:'user-avatar',username:'Other'});assert.equal(rate.calls.length,1);
});

test('changing an extension filter (rt_* params) mid-read is not a page change; other params still are',async t=>{
 let resolve;const e=setup(t,{fetcher:()=>new Promise(r=>resolve=r)});
 const pending=e.send({action:'status',username:'Example',kind:'post',ids:['abc12']});
 await new Promise(r=>setImmediate(r));e.W.history.replaceState(e.W.history.state,'','/user/Example/?rt_date=year&rt_type=image');
 resolve(nativeResponse(statusPost('abc12','deleted','[deleted]','[deleted]')));
 const result=await pending;assert.equal(result.ok,true,JSON.stringify(result));assert.doesNotMatch(String(result.error||''),/Page changed/);
 let again;const f=setup(t,{fetcher:()=>new Promise(r=>again=r)}),other=f.send({action:'status',username:'Example',kind:'post',ids:['abc12']});
 await new Promise(r=>setImmediate(r));f.W.history.replaceState(f.W.history.state,'','/user/Example/?sort=top');again(nativeResponse(statusPost()));
 assert.equal((await other).ok,false);
});
test('profile search view: words join the author query, relevance sorts, and cursors stay bound to the query',async t=>{
  const next=q=>'/svc/shreddit/search/?q='+encodeURIComponent(q)+'&type=posts&sort=relevance&cursor=opaque_search_cursor';
  const e=setup(t,{url:'https://www.reddit.com/user/Example/search/?q=cats',fetcher:async url=>({ok:true,status:200,headers:new Headers(),text:async()=>nativePostHtml({next:next(new URL(url).searchParams.get('q'))})})});
  const first=await e.send({action:'profile',username:'Example',kind:'post',query:'cats "big dogs"',sort:'relevance'});
  assert.equal(first.ok,true);const url=new URL(e.calls[0][0]);
  assert.equal(url.searchParams.get('q'),'author:"Example" cats "big dogs"');assert.equal(url.searchParams.get('sort'),'relevance');assert.equal(url.searchParams.has('t'),false);
  assert.ok(first.after,'a relevance page continues');
  const second=await e.send({action:'profile',username:'Example',kind:'post',query:'cats "big dogs"',sort:'relevance',after:first.after});assert.equal(second.ok,true);
  assert.equal(new URL(e.calls[1][0]).searchParams.get('cursor'),'opaque_search_cursor');
  const other=await e.send({action:'profile',username:'Example',kind:'post',query:'dogs',sort:'relevance',after:first.after});
  assert.equal(other.ok,false);assert.match(other.error,/Invalid Reddit page cursor/);
  const timed=await e.send({action:'profile',username:'Example',kind:'post',query:'cats',sort:'comments',range:'week'});assert.equal(timed.ok,true);
  assert.equal(new URL(e.calls[2][0]).searchParams.get('t'),'week');assert.equal(new URL(e.calls[2][0]).searchParams.get('sort'),'comments');
  const empty=await e.send({action:'profile',username:'Example',kind:'post',query:'',sort:'new'});assert.equal(empty.ok,true);assert.equal(new URL(e.calls[3][0]).searchParams.get('q'),'author:"Example"');
});
test('profile search view rejects control characters, oversized words and relevance outside search mode',async t=>{
  const e=setup(t,{url:'https://www.reddit.com/user/Example/search/'});
  for(const input of [{query:'a\nb'},{query:'x'.repeat(301)},{query:5}]){const r=await e.send({action:'profile',username:'Example',kind:'post',...input});assert.equal(r.ok,false);}
  const r=await e.send({action:'profile',username:'Example',kind:'post',sort:'relevance'});assert.equal(r.ok,false);assert.equal(e.calls.length,0);
});

test('search Feed options accepts relevance and keeps the search state in native View links',async t=>{
 const html=fs.readFileSync('tests/fixtures/native-profile-controls.html','utf8'),e=setup(t,{url:'https://www.reddit.com/user/Example/search/?q=synthetic&type=media&sort=relevance&t=week&rt_sub=Alpha',fetcher:async()=>nativeResponse(html)}),target=controlsTarget(e);
 const result=await e.send({action:'render-controls',username:'Example',target:target.id});assert.equal(result.rendered,true);const href=new URL(target.querySelector('rpl-menu-item[href*="feedViewType"]').getAttribute('href'),'https://www.reddit.com');assert.equal(href.pathname,'/user/Example/search/');for(const [key,value] of Object.entries({q:'synthetic',type:'media',sort:'relevance',t:'week',rt_sub:'Alpha',feedViewType:'compactView'}))assert.equal(href.searchParams.get(key),value);
});
test('native card rendering ignores original cards hidden by the merged search view',async t=>{
 const e=setup(t,{url:'https://www.reddit.com/user/Example/search/',fetcher:async()=>nativeResponse('<shreddit-post id="t3_abc12"><span slot="credit-bar">Native synthetic card</span></shreddit-post>')}),slot=nativeTarget(e),original=e.W.document.createElement('div');original.setAttribute('data-rt-search-hidden','');original.innerHTML='<shreddit-post id="t3_abc12"></shreddit-post>';slot.before(original);
 const result=await e.send({action:'render-card',username:'Example',kind:'post',postId:'abc12',target:slot.id});assert.equal(result.rendered,true);assert.ok(slot.querySelector('shreddit-post'));assert.equal(original.isConnected,true);
});
test('scoped post search accepts the current post-title-text unit with the same identity checks',async t=>{
 const html=nativePostHtml({next:''}).replace('data-testid="post-title"','data-testid="post-title-text"'),e=setup(t,{url:'https://www.reddit.com/user/Example/search/?q=synthetic',fetcher:async()=>nativeResponse(html)});
 const result=await e.send({action:'profile',username:'Example',query:'synthetic',sort:'relevance'});assert.equal(result.ok,true);assert.equal(result.posts[0].fullname,'t3_abc12');
});

test('archived communities reuse native navigation without exposing homepage HTML',async t=>{
 const e=setup(t,{url:'https://www.reddit.com/r/gone/',fetcher:async()=>nativeResponse('<main>Unrelated feed</main><flex-left-nav-container id="left-sidebar-container"><nav><a href="/">Home</a></nav></flex-left-nav-container>')}),target=navigationTarget(e);
 target.dataset.rtUi='community-navigation';target.parentElement.dataset.rtUi='archive-subreddit';target.parentElement.dataset.rtSubreddit='gone';
 assert.equal((await e.send({action:'render-navigation',subreddit:'other',target:target.id})).ok,false);assert.equal(e.calls.length,0);
 const result=await e.send({action:'render-navigation',subreddit:'gone',target:target.id});assert.equal(result.rendered,true);assert.ok(target.querySelector('nav a'));assert.equal(target.querySelector('main'),null);assert.equal(result.html,undefined);
});
test('community navigation cannot attach a late response after switching communities',async t=>{
 let resolve;const e=setup(t,{url:'https://www.reddit.com/r/gone/',fetcher:()=>new Promise(r=>resolve=r)}),target=navigationTarget(e);target.dataset.rtUi='community-navigation';target.parentElement.dataset.rtUi='archive-subreddit';target.parentElement.dataset.rtSubreddit='gone';
 const answer=e.send({action:'render-navigation',subreddit:'gone',target:target.id});e.W.history.pushState({},'','/r/other/');resolve(nativeResponse('<flex-left-nav-container id="left-sidebar-container">Old sidebar</flex-left-nav-container>'));assert.equal((await answer).ok,false);assert.equal(target.textContent.includes('Old sidebar'),false);
});
test('archived community navigation drops the home page’s server-rendered selection so no item is active',async t=>{
 const html='<flex-left-nav-container id="left-sidebar-container"><nav><left-nav-top-section home="" selectedpagetype="home"><template shadowrootmode="open"><a aria-current="page" class="selected">Home</a></template></left-nav-top-section></nav></flex-left-nav-container>';
 for(const defined of [true,false]){
  const e=setup(t,{url:'https://www.reddit.com/r/gone/',fetcher:async()=>nativeResponse(html)}),target=navigationTarget(e);
  target.dataset.rtUi='community-navigation';target.parentElement.dataset.rtUi='archive-subreddit';target.parentElement.dataset.rtSubreddit='gone';
  if(defined)e.W.customElements.define('left-nav-top-section',class extends e.W.HTMLElement{});
  assert.equal((await e.send({action:'render-navigation',subreddit:'gone',target:target.id})).rendered,true);
  const top=target.querySelector('left-nav-top-section');assert.equal(top.getAttribute('selectedpagetype'),'community');
  // Only a defined element can re-render itself; otherwise the snapshot is all there is.
  assert.equal(Boolean(top.querySelector('template')),!defined);
 }
});

test('community navigation seeds the native collapsed controller before connecting its markup',async t=>{
 const e=setup(t,{url:'https://www.reddit.com/r/example/comments/abc12/title/',fetcher:async()=>nativeResponse('<flex-left-nav-container expanded="1" id="left-sidebar-container"><nav>Native sidebar</nav></flex-left-nav-container>')}),target=navigationTarget(e);
 target.dataset.rtUi='community-navigation';const shell=target.parentElement;shell.dataset.rtUi='archive-subreddit';shell.dataset.rtSubreddit='example';shell.className='grid-container flex-nav-collapsed';
 const result=await e.send({action:'render-navigation',subreddit:'example',target:target.id});assert.equal(result.rendered,true);
 const native=target.querySelector('flex-left-nav-container');assert.equal(native.getAttribute('expanded'),'0');assert.equal(native.getAttribute('parent-grid-selector'),'[data-rt-ui="archive-subreddit"]');assert.equal(native.hasAttribute('no-animate'),true);
});
test('native post search reads Reddit\'s newer content-preview cards and skips one unreadable card',async t=>{
 // Live shape (2026-11): search-post-with-content-preview > sdui-post-unit holds the title and counters.
 const context=id=>JSON.stringify({post:{id:'t3_'+id,title:'Public',nsfw:false,spoiler:false},profile:{name:'Example'},subreddit:{name:'example'}});
 const card=id=>`<search-telemetry-tracker view-events="search/view/post" data-faceplate-tracking-context='${context(id)}'><div data-testid="search-post-with-content-preview"><search-telemetry-tracker data-faceplate-tracking-context='${context(id)}'><h2><a data-testid="post-title" href="/r/example/comments/${id}/public/">Public</a></h2></search-telemetry-tracker><faceplate-timeago ts="2026-08-07T20:51:48.364000+0000"></faceplate-timeago><div data-testid="sdui-post-unit"><a data-testid="post-title-text" href="/r/example/comments/${id}/public/">Public</a><div data-testid="search-counter-row"><faceplate-number number="42"></faceplate-number><faceplate-number number="3"></faceplate-number></div></div></div></search-telemetry-tracker>`;
 const broken=`<search-telemetry-tracker view-events="search/view/post" data-faceplate-tracking-context='${context('zzz99')}'><div data-testid="something-new"></div></search-telemetry-tracker>`;
 const e=setup(t,{fetcher:async()=>nativeResponse(card('abc12')+broken+card('def34')+`<faceplate-partial loading="lazy" src='/svc/shreddit/search/?q=author%3A%22Example%22&type=posts&sort=new&cursor=opaque_post_cursor'></faceplate-partial>`)});
 const result=await e.send({action:'profile',username:'Example'});assert.equal(result.ok,true,result.error);assert.deepEqual(result.posts.map(p=>p.id),['abc12','def34']);assert.equal(result.posts[0].score,42);assert.equal(result.posts[0].comments,3);
 const none=setup(t,{fetcher:async()=>nativeResponse(broken)});assert.match((await none.send({action:'profile',username:'Example'})).error,/format changed/,'a page with no readable card still reports it');
});

test('Google referrer rule applies only to explicitly marked credential-free extension searches',async t=>{
 const manifest=JSON.parse(fs.readFileSync('extension/manifest.json','utf8'));
 assert.ok(manifest.permissions.includes('declarativeNetRequestWithHostAccess'));
 const all=manifest.declarative_net_request.rule_resources;assert.deepEqual(all.map(r=>r.id).sort(),['logged_out_search_referrer','raffler_referer']);const resources=all.filter(r=>r.id==='logged_out_search_referrer');assert.equal(resources[0].enabled,true);
 const rules=JSON.parse(fs.readFileSync('extension/'+resources[0].path,'utf8'));assert.equal(rules.length,1);
 const rule=rules[0],matches=new RegExp(rule.condition.regexFilter);
 assert.deepEqual(rule.action,{type:'modifyHeaders',requestHeaders:[{header:'Referer',operation:'set',value:'https://www.google.com/'}]});
 assert.deepEqual(rule.condition.initiatorDomains,['reddit.com']);assert.deepEqual(rule.condition.resourceTypes,['xmlhttprequest']);assert.deepEqual(rule.condition.requestMethods,['get']);assert.equal(rule.condition.isUrlFilterCaseSensitive,true);
 for(const host of ['reddit.com','www.reddit.com','new.reddit.com','sh.reddit.com']){
  assert.ok(manifest.host_permissions.includes('https://'+host+'/*'));
  assert.equal(matches.test('https://'+host+'/svc/shreddit/search/?rt_public_search=1'),true);
  assert.equal(matches.test('https://'+host+'/svc/shreddit/search/?q=cats&rt_public_search=1&cursor=next'),true);
 }
 for(const url of ['https://www.reddit.com/svc/shreddit/search/?q=cats','https://www.reddit.com/svc/shreddit/search/?q=rt_public_search%3D1','https://www.reddit.com/svc/shreddit/search/?not_rt_public_search=1','https://www.reddit.com/svc/shreddit/search/?rt_public_search=10','https://www.reddit.com/svc/shreddit/search/?rt_public_search=1evil','https://www.reddit.com/svc/shreddit/user-hover-card/Example?rt_public_search=1','https://www.reddit.com/r/example/?rt_public_search=1','https://www.reddit.com/search.json?rt_public_search=1','https://evilreddit.com/svc/shreddit/search/?rt_public_search=1','https://www.reddit.com.evil.test/svc/shreddit/search/?rt_public_search=1','https://old.reddit.com/svc/shreddit/search/?rt_public_search=1','http://www.reddit.com/svc/shreddit/search/?rt_public_search=1'])assert.equal(matches.test(url),false,url);
 const e=setup(t,{fetcher:async()=>nativeResponse(nativeCommentHtml())});
 const first=await e.send({action:'profile',kind:'comment',username:'Example',stream:'public'});assert.equal(first.ok,true);
 await e.send({action:'profile',kind:'comment',username:'Example',stream:'public',after:first.after});
 await e.send({action:'profile',kind:'comment',username:'Example'});
 for(const [url,options] of e.calls){assert.equal(matches.test(url),options.credentials==='omit',url);assert.equal(new URL(url).searchParams.has('rt_public_search'),options.credentials==='omit');}
 const blocked=setup(t);blocked.W.document.body.innerHTML='<aside id="right-sidebar-container"><faceplate-tracker source="profile" noun="unblock_user"></faceplate-tracker></aside>';
 assert.equal((await blocked.send({action:'profile',username:'Example'})).ok,true);assert.equal(matches.test(blocked.calls[0][0]),true);assert.equal(blocked.calls[0][1].credentials,'omit');
 blocked.W.document.body.replaceChildren();await blocked.send({action:'profile',username:'Example'});assert.equal(matches.test(blocked.calls[1][0]),false);assert.equal(blocked.calls[1][1].credentials,'include');
});

function publicBrowserMock(e,reply){
 const calls=[];
 e.W.RTPublicBrowser={read:(url,{signal,refresh})=>new Promise((resolve,reject)=>{
  const input={action:'read',url,refresh};calls.push(input);
  const cancel=()=>{calls.push({action:'cancel'});reject(Error('Post request cancelled.'));};signal.addEventListener('abort',cancel,{once:true});
  Promise.resolve().then(()=>reply(input)).then(value=>{if(value!==null){signal.removeEventListener('abort',cancel);resolve(value);}},error=>{signal.removeEventListener('abort',cancel);reject(error);});
 })};return calls;
}
test('refused anonymous comment searches use isolated browser HTML and preserve public pagination',async t=>{
 const e=setup(t,{fetcher:async()=>nativeResponse('',403)});
 const browser=publicBrowserMock(e,()=>nativeCommentHtml());
 const first=await e.send({action:'profile',kind:'comment',username:'Example',stream:'public'});
 assert.equal(first.ok,true,first.error);assert.equal(first.posts.length,1);assert.equal(JSON.parse(first.after.slice(18)).stream,'public');
 const next=await e.send({action:'profile',kind:'comment',username:'Example',stream:'public',after:first.after});
 assert.equal(next.ok,true,next.error);assert.equal(browser.length,2);assert.equal(new URL(browser[1].url).searchParams.get('cursor'),JSON.parse(first.after.slice(18)).cursor);
 assert.ok(e.calls.every(([,init])=>init.credentials==='omit'),'the owner session is never used for the initial public reads');
});
test('signed-in refusals and public rate limits never start a browser fallback',async t=>{
 const e=setup(t,{fetcher:async()=>nativeResponse('',403)}),browser=publicBrowserMock(e,()=>assert.fail('signed-in browser fallback'));
 assert.equal((await e.send({action:'profile',kind:'comment',username:'Example'})).ok,false);assert.equal(browser.length,0);
 const limited=setup(t,{fetcher:async()=>nativeResponse('',429)}),reads=publicBrowserMock(limited,()=>assert.fail('rate-limit fallback'));
 assert.match((await limited.send({action:'profile',kind:'comment',username:'Example',stream:'public'})).error,/rate limit/);assert.equal(reads.length,0);
});
test('browser checks still pass through the existing safe parser',async t=>{
 for(const reply of ['<html><body>Prove your humanity</body></html>','<shreddit-app></shreddit-app>']){
  const e=setup(t,{fetcher:async()=>nativeResponse('',403)});publicBrowserMock(e,()=>reply);
  const result=await e.send({action:'profile',kind:'comment',username:'Example',stream:'public'});assert.equal(result.ok,false);assert.equal(result.posts,undefined);
 }
});
test('a browser response from a previous profile cannot populate the current page',async t=>{
 const e=setup(t,{fetcher:async()=>nativeResponse('',403)});
 publicBrowserMock(e,()=>{e.W.history.pushState({},'','/user/Other/');return nativeCommentHtml();});
 assert.match((await e.send({action:'profile',kind:'comment',username:'Example',stream:'public'})).error,/Page changed/);
});
test('cancelling the parent search also cancels its hidden browser read',async t=>{
 const e=setup(t,{fetcher:async()=>nativeResponse('',403)});let started;
 const ready=new Promise(resolve=>started=resolve),browser=publicBrowserMock(e,()=>{started();return null;});
 const response=new Promise(resolve=>e.W.document.addEventListener('rt-post-response',event=>resolve(JSON.parse(event.detail)),{once:true}));
 const dispatch=input=>e.W.document.dispatchEvent(new e.W.CustomEvent('rt-post-request',{detail:JSON.stringify({channel:'test',id:'cancel-browser',...input})}));
 dispatch({action:'profile',kind:'comment',username:'Example',stream:'public'});await ready;dispatch({action:'cancel'});
 assert.match((await response).error,/cancelled/);assert.equal(browser.at(-1).action,'cancel');
});
test('explicit activity refresh reaches the anonymous session without changing its public stream',async t=>{
 const e=setup(t,{fetcher:async()=>nativeResponse('',403)}),browser=publicBrowserMock(e,()=>nativeCommentHtml());
 assert.equal((await e.send({action:'profile',kind:'comment',username:'Example',stream:'public',refresh:true})).ok,true);
 assert.equal(browser[0].refresh,true);
});
test('public requests honor an HTTP-date Retry-After without starting alternate transports',async t=>{
 let now=Math.floor(Date.now()/1000)*1000;const e=setup(t,{fetcher:async()=>({ok:false,status:429,headers:new Headers({'Retry-After':new Date(now+120000).toUTCString()})})});
 e.W.Date.now=()=>now;const browser=publicBrowserMock(e,()=>assert.fail('rate-limit fallback'));
 const input={action:'profile',kind:'comment',username:'Example',stream:'public'};
 assert.match((await e.send(input)).error,/rate limit/);now+=60000;
 assert.match((await e.send({...input,refresh:true})).error,/asked us to wait/);assert.equal(e.calls.length,1);assert.equal(browser.length,0);
 now+=60000;assert.match((await e.send(input)).error,/rate limit/);assert.equal(e.calls.length,2);
});
test('a verified anonymous session skips redundant cookie-free requests without caching results',async t=>{
 const e=setup(t,{fetcher:async()=>nativeResponse(nativeCommentHtml())}),browser=publicBrowserMock(e,()=>nativeCommentHtml());e.W.RTPublicBrowser.hasSession=()=>true;
 const input={action:'profile',kind:'comment',username:'Example',stream:'public'};
 assert.equal((await e.send(input)).ok,true);assert.equal((await e.send(input)).ok,true);assert.equal(browser.length,2);assert.equal(e.calls.length,0);
 assert.equal((await e.send({...input,stream:'authenticated'})).ok,true);assert.equal(e.calls.length,1);assert.equal(e.calls[0][1].credentials,'include');
});
test('profile navigation seeds the native collapsed controller too, so a collapsed layout never widens',async t=>{
 const e=setup(t,{fetcher:async()=>nativeResponse('<flex-left-nav-container expanded="1" id="left-sidebar-container"><nav>Native sidebar</nav></flex-left-nav-container>')}),target=navigationTarget(e);
 target.parentElement.classList.add('grid-container','flex-nav-collapsed');
 const result=await e.send({action:'render-navigation',username:'Example',target:target.id});assert.equal(result.rendered,true);
 const native=target.querySelector('flex-left-nav-container');assert.equal(native.getAttribute('expanded'),'0');assert.equal(native.getAttribute('parent-grid-selector'),'[data-rt-ui="archive-profile"]');assert.equal(native.hasAttribute('no-animate'),true);
});

// Measured 2026-11-17 (your Chrome, phone emulation, 4x CPU, user scrolling u/EmployeeFeisty6589): measuring every feed
// child on every scroll frame forced ~10 s of layout in 90 s, and the 1.5-screen restore window let fast flicks up
// reach unrestored placeholders (blank screens for ~0.9 s).
test('scrolling never measures the whole feed; one full pass runs after scrolling pauses',async t=>{
 const {W,feed,controller,card,run,idle}=virtualFeed(t);let reads=0;
 const counted=(name,top,height)=>{const node=card(name,top,height),m=node.getBoundingClientRect;node.getBoundingClientRect=()=>{reads++;return m();};return node;};
 const old=counted('old',-5000,500),visible=counted('visible',0,500);feed.append(old,visible);await new Promise(r=>setTimeout(r,0));run();await idle();run();reads=0;
 for(let i=0;i<20;i++){W.document.dispatchEvent(new W.Event('scroll'));run();}
 assert.equal(reads,0,'no layout reads while the reader is scrolling');
 await idle();run();assert.ok(reads>0,'the full pass runs once scrolling stops');
});
test('placeholders are swapped back as they come within four screens, from the observer alone, without measuring',async t=>{
 const {W,feed,controller,held,run,observers,intersect}=virtualFeed(t);
 const ahead=held('ahead',-2000,400),far=held('far',-9000,400);controller.topStack.push(ahead,far);
 W.document.dispatchEvent(new W.Event('scroll'));run();
 const io=observers.find(o=>o.targets.has(ahead.placeholder));assert.ok(io,'placeholders are observed');assert.match(io.options.rootMargin,/400%/);
 let reads=0;for(const el of feed.children){const m=el.getBoundingClientRect;el.getBoundingClientRect=()=>{reads++;return m.call(el);};}
 intersect([ahead.placeholder]);run();
 assert.equal(ahead.node.parentElement,feed,'restored ahead of the reader');assert.equal(ahead.placeholder.isConnected,false);assert.equal(far.placeholder.isConnected,true);
 assert.deepEqual(controller.topStack.map(e=>e.node.id),['far']);assert.equal(controller.topPadding,400);assert.equal(reads,0);
});
// Smooth long feeds (setting, default on): loaded posts stay in the page and the browser skips drawing those far off
// screen (content-visibility), instead of swapping them for placeholders that must be rebuilt while flicking.
test('with smooth feeds, nearby-far posts stay mounted; only very distant ones are swapped out',async t=>{
 const {W,feed,controller,card,run}=virtualFeed(t);W.document.documentElement.setAttribute('data-rt-smooth-feed','');
 const old=card('old',-4000,500),ancient=card('ancient',-40000,500),visible=card('visible',0,500);feed.append(ancient,old,visible);await new Promise(r=>setTimeout(r,0));run();
 assert.equal(old.isConnected,true,'5+ screens above stays in the page');assert.equal(ancient.isConnected,false,'beyond the safety distance it is still swapped out');assert.deepEqual(controller.topStack.map(e=>e.node.id),['ancient']);
});
test('with smooth feeds, posts beyond two screens skip drawing at their measured height and draw again as they near',async t=>{
 const {W,feed,card,run,observers}=virtualFeed(t);W.document.documentElement.setAttribute('data-rt-smooth-feed','');
 const far=card('far',-3000,480),near=card('near',0,300),loader=card('loader',900,40);loader.dataset.rtUi='profile-loading';feed.append(far,near,loader);await new Promise(r=>setTimeout(r,0));run();
 const skip=observers.find(o=>o.targets.has(far));assert.ok(skip,'feed posts are observed');assert.match(skip.options.rootMargin,/200%/);assert.equal(skip.targets.has(loader),false,'extension UI is left alone');
 skip.callback([{target:far,isIntersecting:false,boundingClientRect:{height:480}},{target:near,isIntersecting:true,boundingClientRect:{height:300}}],skip);run();
 assert.equal(far.hasAttribute('data-rt-skip'),true);assert.equal(far.style.containIntrinsicSize,'auto 480px');assert.equal(near.hasAttribute('data-rt-skip'),false);
 skip.callback([{target:far,isIntersecting:true,boundingClientRect:{height:480}}],skip);run();assert.equal(far.hasAttribute('data-rt-skip'),false,'drawn again as it nears');
 W.document.documentElement.removeAttribute('data-rt-smooth-feed');W.document.dispatchEvent(new W.Event('scroll'));await new Promise(r=>setTimeout(r,W.__rtFeedIdleMs*2+20));run();
 skip.callback([{target:far,isIntersecting:false,boundingClientRect:{height:480}}],skip);run();assert.equal(far.hasAttribute('data-rt-skip'),false,'off: nothing is skipped');
});
test('the skip rule hides drawing only, keeping the remembered height',()=>{
 const css=fs.readFileSync('extension/post-discovery.css','utf8');assert.match(css,/shreddit-feed\[data-rt-loading-owner\]>\[data-rt-skip\]\{content-visibility:hidden/);
});

test('new profile navigation starts in the saved collapsed state before native upgrade',async t=>{
 const {W}=setup(t);W.document.documentElement.setAttribute('data-rt-profile-discovery','');W.document.cookie='hui_flex_nav_expanded_state=0; path=/';
 const grid=W.document.createElement('div');grid.className='grid-container flex-nav-expanded';grid.innerHTML='<flex-left-nav-container id="left-sidebar-container" expanded="1"></flex-left-nav-container>';W.document.body.append(grid);await Promise.resolve();
 const nav=grid.querySelector('flex-left-nav-container');assert.equal(nav.getAttribute('expanded'),'0');assert.equal(grid.classList.contains('flex-nav-collapsed'),true);assert.equal(grid.classList.contains('flex-nav-expanded'),false);
 W.customElements.define('flex-left-nav-container',class extends W.HTMLElement{connectedCallback(){this.closest('.grid-container').classList.toggle('flex-nav-expanded',this.getAttribute('expanded')==='1');}});assert.equal(grid.classList.contains('flex-nav-expanded'),false);
 const next=grid.cloneNode(false);next.className='grid-container flex-nav-expanded';next.innerHTML='<flex-left-nav-container id="left-sidebar-container" expanded="1"></flex-left-nav-container>';grid.replaceWith(next);await Promise.resolve();assert.equal(next.querySelector('flex-left-nav-container').getAttribute('expanded'),'0');assert.equal(next.classList.contains('flex-nav-collapsed'),true);
 const current=next.querySelector('flex-left-nav-container');current.setAttribute('expanded','1');next.classList.replace('flex-nav-collapsed','flex-nav-expanded');current.append(W.document.createElement('span'));await Promise.resolve();assert.equal(current.getAttribute('expanded'),'1');assert.equal(next.classList.contains('flex-nav-expanded'),true,'a later native user toggle is respected');
});

test('profile navigation seeding leaves invalid preference and disabled discovery alone',async t=>{
 const {W}=setup(t);W.document.cookie='hui_flex_nav_expanded_state=invalid; path=/';W.document.documentElement.setAttribute('data-rt-profile-discovery','');
 const grid=W.document.createElement('div');grid.className='grid-container flex-nav-expanded';grid.innerHTML='<flex-left-nav-container id="left-sidebar-container" expanded="1"></flex-left-nav-container>';W.document.body.append(grid);await Promise.resolve();assert.equal(grid.querySelector('flex-left-nav-container').getAttribute('expanded'),'1');assert.equal(grid.className,'grid-container flex-nav-expanded');
 W.document.documentElement.removeAttribute('data-rt-profile-discovery');W.document.cookie='hui_flex_nav_expanded_state=0; path=/';const other=grid.cloneNode(true);W.document.body.append(other);await Promise.resolve();assert.equal(other.querySelector('flex-left-nav-container').getAttribute('expanded'),'1');assert.equal(other.className,'grid-container flex-nav-expanded');
});

test('a type-filtered community feed swaps cards out only far above, so Reddit rebuilds their embeds rarely',async t=>{
 const {W}=setup(t,{url:'https://www.reddit.com/r/india/?rt_type=video'});
 Object.defineProperty(W,'innerHeight',{value:800,configurable:true});
 W.document.body.innerHTML='<main><shreddit-feed></shreddit-feed></main>';
 const feed=W.document.querySelector('shreddit-feed'),nativeCalls=[];
 const controller={host:feed,topStack:[],topPadding:0,_virtualizeTop(distance){nativeCalls.push(distance);}};feed.virtualization=controller;
 W.dispatchEvent(new W.Event('scroll'));await new Promise(r=>setTimeout(r,5));
 controller._virtualizeTop(5000);
 assert.deepEqual(nativeCalls,[5000-9*800],'Reddit swaps out only beyond about ten screens');
 W.history.replaceState({},'','/r/india/');controller._virtualizeTop(5000);
 assert.deepEqual(nativeCalls,[5000-9*800,5000],'without a type filter Reddit virtualizes as usual');
});

test('while smooth scrolling is on, window size reads answer from a value refreshed on resize',async t=>{
 let reads=0,width=400;
 const {W}=setup(t,{url:'https://www.reddit.com/r/pics/',before:W=>{for(const key of ['innerWidth','innerHeight'])Object.defineProperty(W,key,{configurable:true,enumerable:true,get(){reads++;return key==='innerWidth'?width:900;}});}});
 const d=W.document.documentElement;
 assert.equal(W.innerWidth,400);assert.equal(W.innerWidth,400);assert.equal(reads,2,'off: every read is real');
 d.setAttribute('data-rt-smooth-site','');reads=0;
 assert.equal(W.innerWidth,400);assert.equal(W.innerHeight,900);assert.equal(W.innerWidth,400);
 assert.equal(reads,2,'on: one real read per size until the window resizes');
 width=500;W.dispatchEvent(new W.Event('resize'));
 assert.equal(W.innerWidth,500,'a resize refreshes it');
 d.removeAttribute('data-rt-smooth-site');width=600;assert.equal(W.innerWidth,600,'off again: real');
});

test('while smooth scrolling is on, the header height Reddit reads per ad post is re-read at most once a second',async t=>{
 let reads=0;
 const {W}=setup(t,{url:'https://www.reddit.com/r/pics/',before:W=>{W.getComputedStyle=()=>({getPropertyValue(name){reads++;return name==='--shreddit-header-height'?'56px':'block';},display:'block'});}});
 W.document.body.innerHTML='<shreddit-app></shreddit-app><div id="other"></div>';const app=W.document.querySelector('shreddit-app');
 W.document.documentElement.setAttribute('data-rt-smooth-site','');
 for(let i=0;i<5;i++)assert.equal(W.getComputedStyle(app).getPropertyValue('--shreddit-header-height'),'56px');
 assert.equal(reads,1,'one real read for five');
 assert.equal(W.getComputedStyle(app).getPropertyValue('display'),'block');assert.equal(W.getComputedStyle(app).display,'block');
 W.getComputedStyle(W.document.getElementById('other')).getPropertyValue('--shreddit-header-height');assert.equal(reads,3,'other properties and elements are real reads');
 W.document.documentElement.removeAttribute('data-rt-smooth-site');W.getComputedStyle(app).getPropertyValue('--shreddit-header-height');assert.equal(reads,4,'off: real');
});

test('another provider’s iframe is held at its card, then replaces the post’s own iframe of the same video',async t=>{
 const {W}=setup(t,{url:'https://www.reddit.com/r/soccer/',before:W=>{W.Element.prototype.moveBefore=function(node,ref){return this.insertBefore(node,ref);};}});
 const d=W.document;d.body.innerHTML='<shreddit-feed><shreddit-post id="t3_abc"></shreddit-post></shreddit-feed>';
 const embed=d.createElement('shreddit-embed');d.querySelector('shreddit-post').append(embed);
 const frame=embed.attachShadow({mode:'open'}).appendChild(d.createElement('iframe'));frame.src='https://streamable.com/e/abc?autoplay=1';
 frame.getBoundingClientRect=()=>({left:10,top:100,width:360,height:203});
 const hold=new W.Event('rt-hold-feed-embed',{bubbles:true,cancelable:true});embed.dispatchEvent(hold);
 assert.equal(hold.defaultPrevented,true);assert.notEqual(frame.parentNode,embed.shadowRoot);assert.equal(frame.parentNode.style.position,'fixed');
 assert.equal(d.documentElement.hasAttribute('data-rt-media-moving'),true);
 W.history.pushState({},'','/r/soccer/comments/abc/goal/');
 const post=d.createElement('shreddit-post');post.id='t3_abc';d.body.append(post);
 const target=d.createElement('shreddit-embed');post.append(target);const own=target.attachShadow({mode:'open'}).appendChild(d.createElement('iframe'));
 own.getBoundingClientRect=()=>({left:0,top:60,width:390,height:220});
 const place=new W.Event('rt-place-held-embed',{bubbles:true,cancelable:true});target.dispatchEvent(place);
 assert.equal(place.defaultPrevented,true);assert.equal(frame.parentNode,target.shadowRoot,'the playing iframe is in the post');assert.equal(own.isConnected,false);
 assert.equal(d.documentElement.hasAttribute('data-rt-media-moving'),false);
});

test('a Vimeo player made by Reddit’s lite-vimeo is held at its card and placed over the post’s lite-vimeo',async t=>{
 const {W}=setup(t,{url:'https://www.reddit.com/r/videos/',before:W=>{W.Element.prototype.moveBefore=function(node,ref){return this.insertBefore(node,ref);};}});
 const d=W.document;d.body.innerHTML='<shreddit-feed><shreddit-post id="t3_vim"></shreddit-post></shreddit-feed>';
 const embed=d.createElement('shreddit-embed');d.querySelector('shreddit-post').append(embed);
 const lite=embed.attachShadow({mode:'open'}).appendChild(d.createElement('lite-vimeo'));
 const frame=lite.attachShadow({mode:'open'}).appendChild(d.createElement('iframe'));frame.src='https://player.vimeo.com/video/1?autoplay=1&muted=1';
 frame.getBoundingClientRect=()=>({left:10,top:100,width:360,height:203});
 const hold=new W.Event('rt-hold-feed-embed',{bubbles:true,cancelable:true});embed.dispatchEvent(hold);
 assert.equal(hold.defaultPrevented,true,'held');assert.equal(frame.parentNode.style.position,'fixed');
 W.history.pushState({},'','/r/videos/comments/vim/clip/');
 const post=d.createElement('shreddit-post');post.id='t3_vim';d.body.append(post);
 const target=d.createElement('shreddit-embed');post.append(target);const own=target.attachShadow({mode:'open'}).appendChild(d.createElement('lite-vimeo'));own.attachShadow({mode:'open'});
 own.getBoundingClientRect=()=>({left:0,top:60,width:390,height:220});
 const place=new W.Event('rt-place-held-embed',{bubbles:true,cancelable:true});target.dispatchEvent(place);
 assert.equal(place.defaultPrevented,true);assert.equal(frame.parentNode,target.shadowRoot,'the playing player is in the post, not reloaded');
 assert.equal(own.style.visibility,'hidden','Reddit’s thumbnail and play button stay under it');assert.equal(frame.style.position,'absolute');
 assert.equal(d.documentElement.hasAttribute('data-rt-media-moving'),false);
});

test('a moving player keeps the rounded corners Reddit gives the media in the feed and lands with the post’s',async t=>{
 const frames=[];
 const {W}=setup(t,{url:'https://www.reddit.com/r/soccer/',before:W=>{W.Element.prototype.moveBefore=function(node,ref){return this.insertBefore(node,ref);};W.Element.prototype.animate=function(keys){frames.push(keys);return {finished:Promise.resolve()};};}});
 const d=W.document;d.body.innerHTML='<shreddit-feed><shreddit-post id="t3_abc"><div id="wrap" style="border-top-left-radius:16px;overflow:hidden"></div></shreddit-post></shreddit-feed>';
 const embed=d.createElement('shreddit-embed');d.getElementById('wrap').append(embed);
 const frame=embed.attachShadow({mode:'open'}).appendChild(d.createElement('iframe'));frame.src='https://streamable.com/e/abc';
 const feedBox={left:10,top:100,width:360,height:203};frame.getBoundingClientRect=()=>feedBox;
 embed.getBoundingClientRect=()=>feedBox;d.getElementById('wrap').getBoundingClientRect=()=>feedBox;
 embed.dispatchEvent(new W.Event('rt-hold-feed-embed',{bubbles:true,cancelable:true}));
 assert.equal(frame.parentNode.style.borderRadius,'16px','held at its card with the same corners');
 W.history.pushState({},'','/r/soccer/comments/abc/goal/');
 const post=d.createElement('shreddit-post');post.id='t3_abc';d.body.append(post);
 const target=d.createElement('shreddit-embed');post.append(target);const own=target.attachShadow({mode:'open'}).appendChild(d.createElement('iframe'));
 own.style.borderTopLeftRadius='8px';own.getBoundingClientRect=()=>({left:0,top:60,width:390,height:220});
 frame.getBoundingClientRect=()=>({left:0,top:60,width:390,height:220});
 target.dispatchEvent(new W.Event('rt-place-held-embed',{bubbles:true,cancelable:true}));
 const clip=frames.find(keys=>keys[0].clipPath);assert.ok(clip,'clipped while it moves');
 assert.match(clip[0].clipPath,/round [\d.]+px\)$/,'rounded from the start');assert.equal(clip[1].clipPath,'inset(0px 0px round 8px)','the post’s corners at the end');
 const scale=360/390;assert.ok(Math.abs(parseFloat(/round ([\d.]+)px/.exec(clip[0].clipPath)[1])*scale-16)<0.01,'looks 16 px round at the feed’s size');
});
