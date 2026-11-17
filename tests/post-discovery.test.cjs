const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const parkedState=(d,key)=>[...d.parked.values()].find(state=>state.context?.key===key);
const nativeControls=fs.readFileSync('tests/fixtures/native-profile-controls.html','utf8');
const raw=(id='abc12',extra={})=>({id,author:'Example',title:'A public post',selftext:'Public text',subreddit:'example',created_utc:1700000000,score:7,num_comments:2,...extra});
function setup(t,{url='https://www.reddit.com/user/Example/submitted/',settings={postDiscovery:true,archiveDiscovery:false},reddit,publicReddit,archive,readSettings,nativeRender,timing,pre=[]}={}){
  const dom=new JSDOM('<main id="main-content">'+nativeControls+'<shreddit-feed><shreddit-post id="t3_native"></shreddit-post></shreddit-feed></main>',{url,runScripts:'outside-only',pretendToBeVisual:true});const W=dom.window,calls=[];
  for(const file of [...pre,'post-model.js','post-discovery.js'])W.eval(fs.readFileSync('extension/'+file,'utf8'));
  const nativeRenderer=nativeRender || (async(post,node)=>{const native=W.document.createElement(post.kind==='comment'?'shreddit-profile-comment':'shreddit-post');if(post.kind==='comment')native.setAttribute('comment-id',post.fullname);else native.id=post.fullname;const credit=W.document.createElement('span');credit.slot='credit-bar';const title=W.document.createElement('a');title.textContent=post.title || 'Comment';title.href=post.permalink;native.append(credit,title);if(!post.over18 && !post.spoiler){const body=W.document.createElement('p');if(post.kind==='comment')body.className='md';else body.slot='text-body';body.textContent=post.source==='arctic-shift'?'Current native text':post.body;native.append(body);}node.replaceChildren(native);});
  const d=new W.RTPostDiscovery.Discovery({nativeRenderer,timing,observe:false,readSettings:readSettings || (async()=>({'rt-settings-v1':settings})),reddit:async(...args)=>{calls.push(args[0]);if(args[0].action==='render-controls'){const target=W.document.getElementById(args[0].target);target.innerHTML=nativeControls;return {rendered:true};}if(args[0].stream==='public')return publicReddit?publicReddit(...args):{posts:[],after:null,hasMore:false};return reddit?reddit(...args):{posts:[raw('native'),raw()],after:null,hasMore:false};},archive:archive || (async()=>({posts:[raw('old12')],hasMore:false}))});t.after(()=>{d.destroy();dom.window.close();});return {W,d,calls};
}
// The fixture's native card exists at mount. Gate tests treat it as a later
// native page; cards Reddit has already painted are never gated.
const arrivedLater=d=>{d.initialNative=new WeakSet();};
test('profile discovery is explicit, deduplicates native posts and stays inline',async t=>{
  const {W,d,calls}=setup(t);await d.ready;assert.equal(calls.length,0);assert.equal(d.host.nextElementSibling,d.feed);
  await d.loadReddit();await new Promise(r=>setImmediate(r));assert.equal(calls.length,1);assert.equal((d.feed || d.results).querySelectorAll('.rt-native-card:not([hidden])').length,1);assert.match(d.status.textContent,/1 additional post/);assert.ok(d.nodes.get('abc12').querySelector('shreddit-post'));assert.match((d.feed || d.results).querySelector('[role=img]').title,/public Reddit search/);
  const native=W.document.createElement('shreddit-post');native.id='t3_abc12';W.document.querySelector('shreddit-feed').append(native);d.scan();assert.equal(d.nodes.get('abc12').hidden,true);assert.equal(W.document.querySelectorAll('shreddit-post[id="t3_abc12"]').length,2);assert.equal(d.nodes.get('abc12').dataset.rtNativeState,'ready');assert.ok(d.nodes.get('abc12').querySelector('shreddit-post'));
});
test('pagination uses Reddit cursors while refresh starts at the newest page',async t=>{
  const {d,calls}=setup(t,{reddit:async()=>({posts:[raw()],after:'t3_abc12',hasMore:true})});await d.ready;await d.loadReddit();await d.loadMore();await d.loadReddit();
  assert.equal(calls[0].after,undefined);assert.equal(calls[1].after,'t3_abc12');assert.equal(calls[2].after,undefined);assert.equal(d.moreReddit,true);
});
test('stable profile reconciliation never moves published cards around its own loading sentinel',async t=>{
  const {W,d}=setup(t);await d.ready;await d.loadReddit();await new Promise(r=>setImmediate(r));
  const card=d.nodes.get('abc12'),content=card.querySelector('shreddit-post'),observer=new W.MutationObserver(()=>{});observer.observe(d.feed,{childList:true});
  d.deduplicate();d.deduplicate();
  assert.equal(observer.takeRecords().length,0,'unchanged scans must not remove/reinsert cards or the tail');
  const slot=W.document.createElement('div');slot.className='virtualized-placeholder';d.feed.replaceChild(slot,card);d.trackVirtualization([{target:d.feed,addedNodes:[slot],removedNodes:[card]}]);observer.takeRecords();d.deduplicate();assert.equal(observer.takeRecords().length,0);
  d.feed.replaceChild(card,slot);d.trackVirtualization([{target:d.feed,addedNodes:[card],removedNodes:[slot]}]);observer.takeRecords();d.deduplicate();
  assert.equal(observer.takeRecords().length,0,'reverse scrolling restores the same card without another move');assert.equal(card.querySelector('shreddit-post'),content);assert.equal(d.feed.lastElementChild,d.loading);observer.disconnect();
});
test('archived text and current deletion status remain separately attributed',async t=>{
  const {d}=setup(t,{settings:{archiveDiscovery:true},nativeRender:async(post,node)=>{node.innerHTML='<shreddit-post><span slot="credit-bar"></span><p slot="text-body">[removed]</p></shreddit-post>';},reddit:async()=>({posts:[raw('old12',{selftext:'[removed]'})]})});await d.ready;await d.loadArchive();await new Promise(r=>setImmediate(r));
  assert.match((d.feed || d.results).textContent,/Public text/);assert.equal((d.feed || d.results).querySelector('details'),null);assert.match((d.feed || d.results).querySelector('[role=img]').title,/Removed on Reddit/);assert.match((d.feed || d.results).querySelector('[data-rt-source]').title,/Text recovered from Arctic Shift/);
});
test('programmatic native pagination defers unpublished older discoveries until the matching native page arrives',async t=>{
 const {W,d}=setup(t,{reddit:async()=>({posts:[raw('middle',{created_utc:1700000020}),raw('older',{created_utc:1700000000})],hasMore:false})});await d.ready;const native=d.feed.querySelector('shreddit-post');native.setAttribute('created-timestamp',new Date(1700000010*1000).toISOString());const pager=W.document.createElement('faceplate-partial');pager.slot='load-after';pager.setAttribute('loading','programmatic');pager.setAttribute('src','/svc/shreddit/profiles/profile_posts-more-posts/new/?after=opaque');d.feed.append(pager);await d.loadReddit();await new Promise(r=>setImmediate(r));assert.equal(d.nodes.get('middle').hidden,false);assert.equal(d.nodes.get('older').hidden,true);assert.equal(d.nodes.get('older').dataset.deferred,'older');
 const next=W.document.createElement('shreddit-post');next.id='t3_next';next.setAttribute('created-timestamp',new Date(1699999990*1000).toISOString());d.feed.insertBefore(next,pager);d.scan();await new Promise(r=>setImmediate(r));assert.equal(d.nodes.get('older').hidden,false);assert.equal(d.nodes.get('older').nextElementSibling,next);assert.equal(pager.parentElement,d.feed);
});
test('published cards do not disappear when Reddit replaces its pagination marker',async t=>{
 const {W,d}=setup(t);await d.ready;await d.loadReddit();await new Promise(r=>setImmediate(r));const card=d.nodes.get('abc12'),body=card.firstElementChild;d.feed.querySelector('shreddit-post').setAttribute('created-timestamp',new Date(1700000010*1000).toISOString());const pager=W.document.createElement('faceplate-partial');pager.slot='load-after';pager.setAttribute('loading','programmatic');pager.setAttribute('src','/svc/shreddit/profiles/profile_posts-more-posts/new/?after=opaque');d.feed.append(pager);d.scan();assert.equal(card.hidden,false);assert.equal(card.dataset.deferred,'');assert.equal(card.firstElementChild,body);assert.equal(card.nextElementSibling,pager);
});
test('a dormant native continuation halo does not block prefetching the next discovery page',async t=>{
 let observer;const requests=[];const {W,d}=setup(t,{reddit:async input=>{requests.push(input);return {posts:[raw(input.after?'next':'first')],after:input.after?null:'next',hasMore:!input.after};}});await d.ready;d.reset();W.IntersectionObserver=class{constructor(callback,options){observer=callback;assert.equal(options.rootMargin,W.innerHeight*2+'px');}observe(){}disconnect(){}};d.scan();const pager=W.document.createElement('faceplate-partial');pager.slot='load-after';pager.setAttribute('loading','programmatic');pager.setAttribute('src','/svc/shreddit/profiles/profile_posts-more-posts/new/?after=opaque');pager.innerHTML='<shreddit-feed-page-loading></shreddit-feed-page-loading>';d.feed.append(pager);d.feed.querySelector('shreddit-post').setAttribute('created-timestamp',new Date(1600000000*1000).toISOString());// the native page reaches back past the discoveries (Hidden defers anything older)
 d.activityMenu.querySelector('[data-rt-activity-filter="hidden"]').click();await new Promise(r=>setImmediate(r));await d.loadReddit();await new Promise(r=>setImmediate(r));assert.equal(d.nativeFeedLoading(),true);assert.equal(requests.length,1);d.loading.getBoundingClientRect=()=>({top:W.innerHeight*2,bottom:W.innerHeight*2+192});observer([{target:d.loading,isIntersecting:true}]);await new Promise(r=>setImmediate(r));assert.equal(requests.length,2);assert.equal(requests[1].after,'next');assert.equal(d.nodes.get('first').hidden,false);assert.equal(d.nodes.get('next').hidden,false);assert.equal(d.moreReddit,false);assert.equal(pager.parentElement,d.feed);
});
test('metadata-only search results restore archived text only after native deletion proof',async t=>{
 const {d}=setup(t,{settings:{postDiscovery:true,archiveDiscovery:true},reddit:async()=>({posts:[raw('old12',{selftext:'',status:'unknown'})],hasMore:false}),nativeRender:async(post,node)=>{node.innerHTML='<shreddit-post><span slot="credit-bar"></span><p slot="text-body">[deleted]</p></shreddit-post>';}});
 await d.ready;await d.loadReddit();await new Promise(r=>setImmediate(r));await d.loadArchive();await new Promise(r=>setImmediate(r));
 const node=d.nodes.get('old12');assert.match(node.querySelector('[slot="text-body"]').textContent,/Public text/);assert.match(node.querySelector('[data-rt-source]').title,/Deleted on Reddit.*Text recovered from Arctic Shift/);
});
test('unknown search metadata cannot replace available text or import another author’s archive body',async t=>{
 for(const [body,author]of [['Live native text','Example'],['[deleted]','Other']]){
  const {d}=setup(t,{settings:{postDiscovery:true,archiveDiscovery:true},reddit:async()=>({posts:[raw('old12',{selftext:'',status:'unknown'})],hasMore:false}),archive:async()=>({posts:[raw('old12',{author,selftext:'Archived candidate'})],hasMore:false}),nativeRender:async(post,node)=>{node.innerHTML='<shreddit-post><span slot="credit-bar"></span><p slot="text-body">'+body+'</p></shreddit-post>';}});
  await d.ready;await d.loadReddit();await new Promise(r=>setImmediate(r));await d.loadArchive();await new Promise(r=>setImmediate(r));
  assert.equal(d.nodes.get('old12').querySelector('[slot="text-body"]').textContent,body);
 }
});
test('archive failures preserve visible public results and expose a retryable error',async t=>{
  const {d}=setup(t,{settings:{archiveDiscovery:true},archive:async()=>{throw Error('Archive is unavailable.');}});await d.ready;await d.loadReddit();await d.loadArchive();
  assert.equal(d.nodes.get('abc12').isConnected,true);assert.equal(d.status.dataset.error,'true');assert.match(d.status.textContent,/unavailable/);assert.equal(d.discover.disabled,false);
});
test('SPA navigation rejects stale results and disabling discovery removes the interface',async t=>{
  let resolve;const gate=new Promise(r=>resolve=r);const {W,d}=setup(t,{reddit:()=>gate});await d.ready;const load=d.loadReddit();
  W.history.pushState({},'','/user/Other/');d.scan();resolve({posts:[raw()]});await load;assert.equal(d.context.username,'Other');assert.equal(d.nodes.size,0);
  d.onSettings({'rt-settings-v1':{newValue:{postDiscovery:false}}},'local');assert.equal(W.document.querySelector('[data-rt-ui]'),null);
});
test('a late initial settings read cannot undo a newer opt-out',async t=>{
  let resolve;const {d}=setup(t,{readSettings:()=>new Promise(r=>resolve=r)});await Promise.resolve();d.onSettings({'rt-settings-v1':{newValue:{postDiscovery:false}}},'local');resolve({'rt-settings-v1':{postDiscovery:true}});await d.ready;assert.equal(d.settings.postDiscovery,false);assert.equal(d.host,null);
});
test('post text is inert and spoiler or NSFW snapshots do not leak previews',async t=>{
  const {d}=setup(t,{settings:{archiveDiscovery:true},archive:async()=>({posts:[raw('old12',{title:'<img onerror=bad()>',selftext:'secret NSFW text',over_18:true})]}),reddit:async()=>({posts:[]})});await d.ready;await d.loadArchive();await new Promise(r=>setImmediate(r));assert.equal((d.feed || d.results).querySelector('img'),null);assert.equal((d.feed || d.results).textContent.includes('secret NSFW text'),false);assert.match((d.feed || d.results).textContent,/<img onerror=bad\(\)>/);
});
test('cursor pagination continues beyond eight pages without a lifetime request stop',async t=>{
  let count=0;const {d}=setup(t,{settings:{archiveDiscovery:true},archive:async()=>{count++;return {posts:[],before:1700000000-count,hasMore:true};}});await d.ready;await d.loadArchive();for(let i=0;i<12;i++)await d.loadArchive({more:true});assert.equal(count,13);assert.equal(d.pages,13);assert.equal(d.moreArchive,true);
});
test('post detail adds a separate archive snapshot and leaves the native post intact',async t=>{
  const {W,d}=setup(t,{url:'https://www.reddit.com/r/example/comments/abc12/title/',settings:{archiveDiscovery:true},archive:async()=>({posts:[raw('abc12',{selftext:'Original archived text'})]}),reddit:async()=>({posts:[raw('abc12',{selftext:'[deleted]'})]})});await d.ready;const native=W.document.querySelector('shreddit-post');native.append(W.document.createTextNode('Native deleted placeholder'));await d.loadDetail();assert.match(native.textContent,/Native deleted placeholder/);assert.equal(d.host.previousElementSibling,native);assert.equal(native.contains(d.host),false);assert.match((d.feed || d.results).textContent,/Original archived text/);assert.match(d.status.textContent,/Deleted on Reddit/);
});
test('unsupported profile tabs and old Reddit are not modified',async t=>{
  const {d}=setup(t,{url:'https://www.reddit.com/user/Example/saved/'});await d.ready;assert.equal(d.host,null);assert.equal(d.settings.archiveDiscovery,false);
});

test('current live restrictions also protect older unmarked detail snapshots',async t=>{
 const {d}=setup(t,{url:'https://www.reddit.com/comments/abc12/title/',settings:{archiveDiscovery:true},archive:async()=>({posts:[raw('abc12',{selftext:'Restricted original'})]}),reddit:async()=>({posts:[raw('abc12',{selftext:'[removed]',over_18:true})]})});await d.ready;await d.loadDetail();const box=(d.feed || d.results).querySelector('.rt-sensitive');assert.ok(box.querySelector('.rt-sensitive-content').textContent.includes('Restricted original'));assert.equal(box.querySelector('.rt-sensitive-reveal').textContent,'View NSFW content');
});
const comment=()=>({kind:'comment',id:'19rktoupyflj9',fullname:'t1_19rktoupyflj9',author:'Example',link_id:'t3_abc12',parent_id:'t3_abc12',created_utc:1700000000,body:'A discovered public comment',subreddit:'example'});
test('comments tab discovers and displays comments with stable source identity',async t=>{
 const {d,calls}=setup(t,{url:'https://www.reddit.com/user/Example/comments/',reddit:async()=>({posts:[comment()],hasMore:false})});await d.ready;await d.loadReddit();assert.equal(calls[0].kind,'comment');assert.match((d.feed || d.results).textContent,/A discovered public comment/);assert.match(d.status.textContent,/1 additional comment/);assert.ok(d.nodes.has('t1_19rktoupyflj9'));
});
test('overview retains successful comments if public post search fails',async t=>{
 const {d}=setup(t,{url:'https://www.reddit.com/user/Example/',reddit:async request=>{if(request.kind==='post')throw Error('HTTP 403');return {posts:[comment()],hasMore:false};}});await d.ready;await d.loadReddit();assert.match((d.feed || d.results).textContent,/discovered public comment/);assert.match(d.status.textContent,/Posts:.*403/);
});
test('settings use worker messaging without accessing trusted-only content-script storage',async t=>{
 const {JSDOM}=require('jsdom'),dom=new JSDOM('<main id="main-content"><shreddit-feed></shreddit-feed></main>',{url:'https://www.reddit.com/user/Example/submitted/',runScripts:'outside-only'}),w=dom.window;let reads=0,request;
 w.chrome={runtime:{sendMessage:async message=>{request=message;return {ok:true,settings:{postDiscovery:true,archiveDiscovery:false}};}},storage:{local:{get(){reads++;throw Error('Access to storage is not allowed from this context.');}}}};
 for(const file of ['post-model.js','post-discovery.js'])w.eval(fs.readFileSync('extension/'+file,'utf8'));
 const d=new w.RTPostDiscovery.Discovery({observe:false});t.after(()=>{d.destroy();w.close();});await d.ready;assert.equal(reads,0);assert.equal(request.action,'get-settings');assert.equal(d.host.isConnected,true);
});
test('settings failure is visible and retry replaces the error interface',async t=>{
 let fail=true;const {d}=setup(t,{readSettings:async()=>{if(fail)throw Error('worker unavailable');return {'rt-settings-v1':{postDiscovery:true}};}});await d.ready;assert.match(d.status.textContent,/settings could not be loaded/);assert.equal(d.discover.getAttribute('aria-label'),'Retry discovery');fail=false;await d.retrySettings();assert.equal(d.settingsError,false);assert.notEqual(d.discover.getAttribute('aria-label'),'Retry discovery');
});
test('automatic discovery is bounded and hides only the native empty placeholder while results exist',async t=>{
 const {W,d,calls}=setup(t);await d.ready;d.reset();const placeholder=W.document.createElement('div');placeholder.id='empty-feed-content';W.document.querySelector('main').append(placeholder);d.autoDiscover=true;d.scan();await new Promise(r=>setImmediate(r));assert.equal(calls.length,1);assert.equal(placeholder.hidden,true);d.scan();await new Promise(r=>setImmediate(r));assert.equal(calls.length,1);d.reset();assert.equal(placeholder.hidden,false);
});

test('native comments deduplicate by comment-id and discoveries merge between date anchors',async t=>{
 const {W,d}=setup(t,{url:'https://www.reddit.com/user/Example/'});await d.ready;d.reset();
 const feed=W.document.querySelector('shreddit-feed');feed.innerHTML=`<article id="pin"><shreddit-post id="t3_pin" stickied created-timestamp="2020-01-01T00:00:00Z"></shreddit-post></article><article id="recent"><shreddit-profile-comment comment-id="t1_newcomment"><faceplate-timeago ts="2026-10-24T10:00:00Z"></faceplate-timeago></shreddit-profile-comment></article><article id="older"><shreddit-post id="t3_native" created-timestamp="2026-10-23T10:00:00Z"></shreddit-post></article><shreddit-feed-load-more-observer cursor="opaque"></shreddit-feed-load-more-observer>`;
 d.scan();const native=[...feed.children].filter(n=>!n.dataset.rtUi);d.live.set('duplicate',{...comment(),id:'newcomment',fullname:'t1_newcomment',created_utc:1792836000});d.live.set('middle',raw('middle',{created_utc:Date.parse('2026-10-24T00:00:00Z')/1000}));d.live.set('past',raw('past',{created_utc:Date.parse('2026-10-22T00:00:00Z')/1000}));d.render();await new Promise(r=>setImmediate(r));
 assert.equal(d.nodes.get('t1_newcomment').hidden,true);assert.equal(d.nodes.get('past').hidden,true);assert.equal(d.nodes.get('middle').parentElement,feed);
 assert.equal(feed.querySelector('#recent').nextElementSibling,d.nodes.get('middle'));assert.equal(d.nodes.get('middle').nextElementSibling.id,'older');assert.equal(feed.firstElementChild.id,'pin');assert.equal(d.summaryCounts.count,1);assert.equal(d.summaryCounts.deferred,1);
 const next=W.document.createElement('article');next.innerHTML='<shreddit-post id="t3_last" created-timestamp="2026-10-21T00:00:00Z"></shreddit-post>';feed.insertBefore(next,feed.lastElementChild);d.scan();await new Promise(r=>setImmediate(r));assert.equal(d.nodes.get('past').hidden,false);assert.equal(d.nodes.get('past').nextElementSibling,next);
 d.reset();assert.ok(native.every(n=>n.parentElement===feed));assert.equal(feed.querySelectorAll('[data-rt-ui]').length,0);
});

test('replacing the native feed remounts controls and restores loaded discoveries',async t=>{
 const {W,d}=setup(t);await d.ready;await d.loadReddit();const oldFeed=d.feed,oldCard=d.nodes.get('abc12');const replacement=W.document.createElement('shreddit-feed');oldFeed.replaceWith(replacement);d.scan();assert.equal(d.feed,replacement);assert.equal(d.nodes.get('abc12'),oldCard,'the same rendered card returns, without re-rendering a copy');assert.equal(oldCard.parentElement,replacement);assert.equal(d.nodes.size,2);assert.equal(d.host.nextElementSibling,replacement);assert.equal(W.document.querySelectorAll('[data-rt-ui=posts]').length,1);
});

test('default discovery and native rendering communicate end to end without transport-id collisions',async t=>{
 const dom=new JSDOM('<main><shreddit-feed></shreddit-feed></main>',{url:'https://www.reddit.com/user/Example/submitted/',runScripts:'outside-only'}),w=dom.window,calls=[];t.after(()=>dom.window.close());w.AbortController=AbortController;
 w.customElements.define('faceplate-partial',class extends w.HTMLElement{_renderContent(text){this.innerHTML=text;}});
 w.customElements.define('shreddit-post',class extends w.HTMLElement{});
 w.fetch=async url=>{calls.push(new URL(url));return {ok:true,status:200,headers:new Headers({'content-type':url.includes('partial-feed-post')?'text/vnd.reddit.partial+html':'application/json'}),text:async()=>url.includes('partial-feed-post')?'<article><shreddit-post id="t3_abc12"><span slot="credit-bar">Native</span><button aria-label="Upvote">Upvote</button><button>Share</button></shreddit-post></article>':`<search-telemetry-tracker view-events="search/view/post" data-faceplate-tracking-context='{"post":{"id":"t3_abc12","title":"Public"},"profile":{"name":"Example"},"subreddit":{"name":"example"}}'><div data-testid="search-post-unit"><a data-testid="post-title" href="/r/example/comments/abc12/public/">Public</a><faceplate-timeago ts="2026-08-07T20:51:48Z"></faceplate-timeago><div data-testid="search-counter-row"><faceplate-number number="7"></faceplate-number><faceplate-number number="2"></faceplate-number></div></div></search-telemetry-tracker>`};};
 for(const file of ['post-model.js','post-page-bridge.js','post-discovery.js'])w.eval(fs.readFileSync('extension/'+file,'utf8'));
 const d=new w.RTPostDiscovery.Discovery({observe:false,readSettings:async()=>({'rt-settings-v1':{postDiscovery:true}})});await d.ready;await d.loadReddit();await new Promise(r=>setTimeout(r,10));
 const node=d.nodes.get('abc12');assert.equal(node.dataset.rtNativeState,'ready');assert.ok(node.querySelector('[aria-label=Upvote]'));assert.ok(node.querySelector('[data-rt-source]'));assert.equal(node.parentElement,d.feed);assert.deepEqual(calls.map(u=>u.pathname),['/svc/shreddit/search/','/svc/shreddit/partial-feed-post/t3_abc12']);d.destroy();
});
test('native hydration keeps a two-request bound and never publishes unfinished cards or restarts ready cards',async t=>{
 const releases=[],order=[];let active=0,peak=0;
 const {W,d}=setup(t,{reddit:async()=>({posts:Array.from({length:5},(_,i)=>raw('item'+i,{created_utc:1700000000-i})),hasMore:false}),nativeRender:async(post,node)=>{order.push(post.id);active++;peak=Math.max(peak,active);await new Promise(r=>releases.push(r));active--;const native=node.ownerDocument.createElement('shreddit-post');native.id=post.fullname;node.replaceChildren(native);}});
 await d.ready;d.nativeObserver={observe(){},unobserve(){},disconnect(){}};await d.loadReddit();
 // Visibility notifications may arrive in reverse order. Queue the entire batch
 // before draining, and prefer document order over observer delivery order.
 [...d.nodes.values()].reverse().forEach(node=>d.queueNative(node));await new Promise(r=>setImmediate(r));
 assert.deepEqual(order,['item0','item1']);assert.equal(d.feed.querySelectorAll('.rt-native-card').length,0);
 for(let i=0;i<5;i++){assert.ok(releases.length<=2);releases.shift()();await new Promise(r=>setImmediate(r));}
 assert.equal(peak,2);assert.deepEqual(order,['item0','item1','item2','item3','item4']);d.scan();assert.equal(order.length,5);assert.equal(W.document.querySelectorAll('shreddit-post[id^=t3_item]').length,5);
});

test('each extension card keeps exactly one native-style separator through hydration, filtering and virtualization',async t=>{
 let release;const {W,d}=setup(t,{reddit:async()=>({posts:[raw('good'),raw('bad')],hasMore:false}),nativeRender:async(post,node)=>{
  if(post.id==='bad')throw Error('Reddit returned no matching native card');
  await new Promise(r=>release=r);node.innerHTML='<faceplate-partial><article><shreddit-post id="t3_good"><span slot="credit-bar"></span></shreddit-post></article><hr class="border-0 border-b-sm border-solid border-b-neutral-border-weak"></faceplate-partial>';
 }});
 await d.ready;await d.loadReddit();await new Promise(r=>setImmediate(r));const card=d.nodes.get('good'),failed=d.nodes.get('bad');
 assert.equal(card.dataset.rtNativeState,'loading');assert.equal(card.querySelector('hr'),null,'pending card adds no rule');assert.equal(failed.dataset.rtNativeState,'failed');assert.equal(failed.querySelectorAll('hr').length,1,'a fallback row is separated like a native card');assert.equal(failed.lastElementChild.className,'border-0 border-b-sm border-solid border-b-neutral-border-weak');
 release();await new Promise(r=>setImmediate(r));const rule=card.querySelector('hr');assert.ok(rule);assert.equal(card.querySelectorAll('hr').length,1,'a fragment that brings its own rule gets no second one');assert.equal(rule.hasAttribute('data-rt-card-rule'),false);
 d.render();assert.equal(card.querySelector('hr'),rule);d.activityMenu.querySelector('[data-rt-activity-filter="deleted"]').click();assert.equal(card.hidden,true);assert.equal(card.querySelector('hr'),rule);d.activityMenu.querySelector('[data-rt-activity-filter="all"]').click();assert.equal(card.hidden,false);
 const slot=W.document.createElement('div');slot.className='virtualized-placeholder';card.replaceWith(slot);d.trackVirtualization([{target:d.feed,addedNodes:[slot],removedNodes:[card]}]);assert.equal(card.querySelector('hr'),rule);slot.replaceWith(card);d.trackVirtualization([{target:d.feed,addedNodes:[card],removedNodes:[slot]}]);d.render();assert.equal(card.querySelector('hr'),rule);assert.equal(card.querySelectorAll('hr').length,1);await new Promise(r=>setImmediate(r));
});

test('Reddit virtualization retains loaded cards and native date anchors without reinsertion or refetch',async t=>{
 let renders=0;
 const {W,d,calls}=setup(t,{reddit:async()=>({posts:[raw('middle',{created_utc:1700000020}),raw('past',{created_utc:1700000005})],hasMore:false}),nativeRender:async(post,node)=>{renders++;node.innerHTML=`<shreddit-post id="${post.fullname}"><span slot="credit-bar"></span></shreddit-post>`;}});
 await d.ready;d.feed.innerHTML='<article><shreddit-post id="t3_native" created-timestamp="2023-11-14T22:13:30Z"></shreddit-post></article><shreddit-feed-load-more-observer cursor="opaque"></shreddit-feed-load-more-observer>';
 const observer=new W.MutationObserver(records=>{d.trackVirtualization(records);d.scan();});observer.observe(d.feed,{childList:true});t.after(()=>observer.disconnect());
 await d.loadReddit();await new Promise(r=>setImmediate(r));const card=d.nodes.get('middle'),content=card.firstElementChild,native=card.nextElementSibling;
 const cardSlot=W.document.createElement('div');cardSlot.className='virtualized-placeholder';cardSlot.style.height='600px';
 const nativeSlot=W.document.createElement('div');nativeSlot.className='virtualized-placeholder';nativeSlot.style.height='300px';
 d.feed.replaceChild(cardSlot,card);d.feed.replaceChild(nativeSlot,native);await new Promise(r=>setImmediate(r));
 assert.equal(card.isConnected,false);assert.equal(cardSlot.parentElement,d.feed);assert.equal(d.nodes.get('past').hidden,true);assert.equal(d.visibleIds().has('t3_native'),true);
 for(let i=0;i<5;i++)d.scan();assert.equal(cardSlot.nextElementSibling,nativeSlot);assert.equal(renders,1);assert.equal(calls.length,1);assert.equal(d.nodes.get('middle'),card);
 d.feed.replaceChild(native,nativeSlot);d.feed.replaceChild(card,cardSlot);await new Promise(r=>setImmediate(r));
 assert.equal(card.firstElementChild,content);assert.equal(card.dataset.rtNativeState,'ready');assert.equal(renders,1);assert.equal(d.virtualNodes.size,0);assert.equal(d.feed.querySelectorAll('.virtualized-placeholder').length,0);observer.disconnect();
});
test('synchronous reconciliation cannot steal a populated card from a native placeholder before observers deliver',async t=>{
 const {W,d}=setup(t);await d.ready;await d.loadReddit();await new Promise(r=>setImmediate(r));const card=d.nodes.get('abc12'),body=card.firstElementChild,slot=W.document.createElement('div');slot.className='virtualized-placeholder';slot.style.height='600px';const stack=[{node:card,placeholder:slot,height:600}];card.replaceWith(slot);
 // A source completion can run before the queued MutationObserver callback.
 d.deduplicate();assert.equal(card.isConnected,false);assert.equal(slot.parentElement,d.feed);assert.equal(d.feedSlot(card),slot);assert.equal(stack[0].node,card);assert.equal(card.firstElementChild,body);
 slot.replaceWith(card);d.deduplicate();assert.equal(d.feedSlot(card),card);assert.equal(card.firstElementChild,body);await new Promise(r=>setImmediate(r));assert.equal(d.virtualNodes.size,0);assert.equal(d.nodes.get('abc12'),card);assert.equal(card.dataset.rtNativeState,'ready');
});

test('opt-out retires virtualized content without invalidating Reddit-owned replacement slots',async t=>{
 const {W,d}=setup(t);await d.ready;await d.loadReddit();await new Promise(r=>setImmediate(r));const card=d.nodes.get('abc12'),slot=W.document.createElement('div');slot.className='virtualized-placeholder';d.feed.replaceChild(slot,card);d.trackVirtualization([{target:d.feed,addedNodes:[slot],removedNodes:[card]}]);
 d.onSettings({'rt-settings-v1':{newValue:{postDiscovery:false}}},'local');assert.equal(slot.isConnected,true);assert.equal(slot.dataset.rtRetired,'true');assert.equal(card.hidden,true);assert.equal(card.children.length,0);
 assert.doesNotThrow(()=>slot.replaceWith(card));assert.equal(card.dataset.rtRetired,'true');assert.equal(card.querySelector('shreddit-post'),null);
});

test('source indicators precede native Join and overflow controls with distinct availability symbols',async t=>{
 const {d}=setup(t,{nativeRender:async(post,node)=>{node.innerHTML=`<shreddit-post id="${post.fullname}"><span slot="credit-bar"><span>Community · Date</span><span data-actions><button>Join</button><span><shreddit-post-overflow-menu><button>Menu</button></shreddit-post-overflow-menu></span></span></span><div slot="post-media-container"><img width="640" height="480"></div></shreddit-post>`;}});
 await d.ready;await d.loadReddit();await new Promise(r=>setImmediate(r));const node=d.nodes.get('abc12'),native=node.querySelector('shreddit-post'),media=node.querySelector('[slot=post-media-container]'),post=d.postMetadata.get('abc12');
 let badge=node.querySelector('[data-rt-source]');assert.equal(badge.parentElement.hasAttribute('data-actions'),true);assert.equal(badge.nextElementSibling.textContent,'Join');assert.equal(badge.querySelector('svg').dataset.icon,'hidden');
 d.decorateNative({...post,status:'deleted'},node);badge=node.querySelector('[data-rt-source]');assert.equal(badge.querySelector('svg').dataset.icon,'deleted');assert.match(badge.title,/Deleted/);
 d.decorateNative({...post,status:'removed'},node);assert.equal(node.querySelector('[data-rt-source] svg').dataset.icon,'removed');assert.equal(node.querySelectorAll('[data-rt-source]').length,1);assert.equal(native.querySelector('[slot=post-media-container]'),media);
 d.decorateNative({...post,source:'arctic-shift',status:'unknown'},node);assert.equal(node.querySelector('[data-rt-source] svg').dataset.icon,'archive','archive-only items with unknown status use the archive icon, not the trash icon');assert.match(node.querySelector('[data-rt-source]').title,/status unknown/);
});

test('unfinished cards stay outside the native virtualization tree until hydrated',async t=>{
 let release;const {d}=setup(t,{nativeRender:async(post,node)=>{await new Promise(r=>release=r);node.innerHTML=`<shreddit-post id="${post.fullname}"><span slot="credit-bar"></span></shreddit-post>`;}});
 await d.ready;await d.loadReddit();const card=d.nodes.get('abc12');assert.equal(card.parentElement,d.results);assert.equal(d.feed.contains(card),false);assert.equal(d.loading.hidden,false);
 release();await new Promise(r=>setImmediate(r));assert.equal(card.dataset.rtNativeState,'ready');assert.equal(card.parentElement,d.feed);assert.equal(d.feed.lastElementChild,d.loading);d.scan();assert.equal(card.parentElement,d.feed);
});

test('hidden-profile Welcome panels are suppressed before settings/results and after native replacement',async t=>{
 let resolveSettings,resolveSearch;
 const {W,d}=setup(t,{readSettings:()=>new Promise(resolve=>resolveSettings=resolve),reddit:()=>new Promise(resolve=>resolveSearch=resolve)});
 const style=W.document.createElement('style');style.textContent=fs.readFileSync('extension/post-discovery.css','utf8');W.document.head.append(style);
 const panel=()=>{const e=W.document.createElement('div');e.id='empty-feed-content';e.innerHTML='<img src="https://www.redditstatic.com/shreddit/assets/snoo_wave.png"><h2>Welcome!</h2><p>This profile keeps posts hidden.</p>';return e;};
 let notice=panel();W.document.querySelector('shreddit-feed').append(notice);
 assert.equal(W.document.documentElement.hasAttribute('data-rt-profile-discovery'),true);assert.equal(W.getComputedStyle(notice).display,'none');
 resolveSettings({'rt-settings-v1':{postDiscovery:true}});await d.ready;const search=d.loadReddit();assert.equal(W.getComputedStyle(notice).display,'none');
 const replacement=panel();notice.replaceWith(replacement);notice=replacement;
 // No scan or provider completion is needed for replacement markup.
 assert.equal(W.getComputedStyle(notice).display,'none');resolveSearch({posts:[],hasMore:false});await search;assert.equal(W.getComputedStyle(notice).display,'none');
 d.onSettings({'rt-settings-v1':{newValue:{postDiscovery:false}}},'local');assert.equal(W.document.documentElement.hasAttribute('data-rt-profile-discovery'),false);assert.notEqual(W.getComputedStyle(notice).display,'none');
});

test('notice guard leaves other empty states and unsupported routes unchanged',async t=>{
 const {W,d}=setup(t);await d.ready;const style=W.document.createElement('style');style.textContent=fs.readFileSync('extension/post-discovery.css','utf8');W.document.head.append(style);
 const notice=W.document.createElement('div');notice.id='empty-feed-content';notice.innerHTML='<h2>No activity yet</h2>';W.document.querySelector('main').append(notice);assert.notEqual(W.getComputedStyle(notice).display,'none');
 notice.innerHTML='<img src="https://www.redditstatic.com/shreddit/assets/snoo_wave.png"><h2>Welcome!</h2>';assert.equal(W.getComputedStyle(notice).display,'none');
 W.history.pushState({},'','/user/Example/saved/');d.onRoute();assert.equal(W.document.documentElement.hasAttribute('data-rt-profile-discovery'),false);assert.notEqual(W.getComputedStyle(notice).display,'none');
 W.history.pushState({},'','/user/Other/comments/');d.onRoute();assert.equal(W.getComputedStyle(notice).display,'none');d.destroy();assert.notEqual(W.getComputedStyle(notice).display,'none');
 const blocks=JSON.parse(fs.readFileSync('extension/manifest.json','utf8')).content_scripts;
 const discovery=blocks.find(block=>block.js.includes('post-discovery.js')),guard=blocks.find(block=>block.js.includes('profile-notice.js')),bridge=blocks.find(block=>block.js.includes('post-page-bridge.js'));
 assert.equal(guard.run_at,'document_start');assert.equal(discovery.run_at,'document_idle');assert.notEqual(discovery.run_at,bridge.run_at,'Chrome must execute the shared model separately in both worlds');assert.ok(guard.css.includes('post-discovery.css'));
});

test('early guard runs without the shared model, including before the document root exists',async t=>{
 const dom=new JSDOM('',{url:'https://www.reddit.com/user/Example/submitted/',runScripts:'outside-only'}),W=dom.window;t.after(()=>W.close());let resolve;
 W.chrome={runtime:{id:'fixture',sendMessage:()=>new Promise(r=>resolve=r)}};W.document.documentElement.remove();
 assert.doesNotThrow(()=>W.eval(fs.readFileSync('extension/profile-notice.js','utf8')));assert.equal(W.RTPostModel,undefined);
 const root=W.document.createElement('html');W.document.append(root);await new Promise(r=>setImmediate(r));assert.equal(root.hasAttribute('data-rt-profile-discovery'),true);
 resolve({ok:true,settings:{postDiscovery:true}});await new Promise(r=>setImmediate(r));assert.equal(root.hasAttribute('data-rt-profile-discovery'),true);
 W.RTProfileNoticeGuard.setEnabled(false);assert.equal(root.hasAttribute('data-rt-profile-discovery'),false);
});

test('early guard respects newer opt-out and profile SPA route changes independently of discovery',async t=>{
 const dom=new JSDOM('',{url:'https://www.reddit.com/user/Example/',runScripts:'outside-only'}),W=dom.window;t.after(()=>W.close());let resolve;
 W.chrome={runtime:{id:'fixture',sendMessage:()=>new Promise(r=>resolve=r)}};W.eval(fs.readFileSync('extension/profile-notice.js','utf8'));
 W.RTProfileNoticeGuard.setEnabled(false);resolve({ok:true,settings:{postDiscovery:true}});await new Promise(r=>setImmediate(r));assert.equal(W.document.documentElement.hasAttribute('data-rt-profile-discovery'),false);
 W.RTProfileNoticeGuard.setEnabled(true);W.history.pushState({},'','/user/Example/saved/');W.document.dispatchEvent(new W.CustomEvent('reddit:route'));assert.equal(W.document.documentElement.hasAttribute('data-rt-profile-discovery'),false);
 W.history.pushState({},'','/user/Example/comments/');W.document.dispatchEvent(new W.CustomEvent('reddit:route'));assert.equal(W.document.documentElement.hasAttribute('data-rt-profile-discovery'),true);
 // Comments tab: Reddit's sort button stays invisible until Feed options replaces it, with a timed reveal as a fallback.
 assert.equal(W.document.documentElement.hasAttribute('data-rt-profile-comments'),true);
 const css=fs.readFileSync('extension/post-discovery.css','utf8');assert.match(css,/html\[data-rt-profile-comments\] main shreddit-sort-dropdown:not\(\[data-rt-ui\] \*\)\{visibility:hidden;animation:rt-menu-reveal 0s 2\.5s forwards\}/);
 W.history.pushState({},'','/user/Example/submitted/');W.document.dispatchEvent(new W.CustomEvent('reddit:route'));assert.equal(W.document.documentElement.hasAttribute('data-rt-profile-comments'),false);
});

test('sort, range and layout changes reset scope and cancel an obsolete profile search',async t=>{
 let resolve;const {W,d,calls}=setup(t,{reddit:()=>new Promise(r=>resolve=r)});await d.ready;const old=d.loadReddit(),oldKey=d.context.key;
 W.history.pushState({},'','?sort=top&t=year&feedViewType=compactView');d.scan();assert.notEqual(d.context.key,oldKey);assert.equal(d.context.sort,'top');assert.equal(d.context.range,'year');assert.equal(d.nodes.size,0);
 resolve({posts:[raw()],hasMore:false});await old;assert.equal(d.nodes.size,0);assert.equal(calls[0].sort,'new');
 const current=d.loadReddit();assert.equal(calls[1].sort,'top');assert.equal(calls[1].range,'year');resolve({posts:[],hasMore:false});await current;
});

test('Top merges by native score anchors while Hot keeps Reddit search order',async t=>{
 const {W,d}=setup(t,{url:'https://www.reddit.com/user/Example/submitted/?sort=top'});await d.ready;
 d.feed.innerHTML='<article id="higher"><shreddit-post id="t3_high" score="100" created-timestamp="2023-01-01"></shreddit-post></article><article id="lower"><shreddit-profile-comment comment-id="t1_low"><shreddit-comment-action-row score="10"></shreddit-comment-action-row></shreddit-profile-comment></article>';
 d.live.set('middle',raw('middle',{score:50,created_utc:1700000000}));d.render();await new Promise(r=>setImmediate(r));assert.equal(d.nodes.get('middle').previousElementSibling.id,'higher');assert.equal(d.nodes.get('middle').nextElementSibling.id,'lower');
 W.history.pushState({},'','?sort=hot');d.scan();d.live.set('first',raw('first',{created_utc:1700000000}));d.live.set('second',raw('second',{created_utc:1700000010}));d.render();await new Promise(r=>setImmediate(r));assert.equal(d.nodes.get('first').nextElementSibling,d.nodes.get('second'));
});

test('local card backpressure keeps native placeholders and resumes without Retry rows',async t=>{
 let attempts=0;const {d}=setup(t,{nativeRender:async(post,node)=>{attempts++;if(attempts===1)return {deferred:true,retryAfterMs:100};node.innerHTML=`<shreddit-post id="${post.fullname}"></shreddit-post>`;return {rendered:true};}});
 await d.ready;await d.loadReddit();await new Promise(r=>setImmediate(r));const node=d.nodes.get('abc12');assert.equal(node.dataset.rtNativeState,'queued');assert.ok(node.querySelector('.rt-native-placeholder'));assert.equal(node.querySelector('button'),null);
 await new Promise(r=>setTimeout(r,130));assert.equal(node.dataset.rtNativeState,'ready');assert.equal(attempts,2);
 assert.equal(d.loading.querySelector('faceplate-progress'),null);assert.equal(d.loading.querySelectorAll('shreddit-feed-page-loading').length,1);assert.equal(d.loading.querySelector('.rt-native-placeholder'),null);
});

test('scope changes cancel paused metadata without stale requests',async t=>{
 const {W,d,calls}=setup(t,{reddit:async()=>({deferred:true,retryAfterMs:30000})});await d.ready;const pending=d.loadReddit();await new Promise(r=>setImmediate(r));W.history.pushState({},'','?sort=top');d.scan();await pending;assert.equal(calls.length,1);assert.equal(d.nodes.size,0);assert.equal(d.busy,false);
});
test('scope changes discard a paused native-card queue',async t=>{
 let attempts=0;const {W,d}=setup(t,{nativeRender:async()=>{attempts++;return {deferred:true,retryAfterMs:100};}});await d.ready;await d.loadReddit();await new Promise(r=>setImmediate(r));assert.equal(attempts,1);
 W.history.pushState({},'','?sort=hot');d.scan();await new Promise(r=>setTimeout(r,130));assert.equal(attempts,1);assert.equal(d.nodes.size,0);
});
test('Hot refresh replaces the provider order without reverting to chronology',async t=>{
 let reverse=false;const {d}=setup(t,{url:'https://www.reddit.com/user/Example/submitted/?sort=hot',reddit:async()=>({posts:(reverse?[raw('second'),raw('first')]:[raw('first'),raw('second')]),hasMore:false})});await d.ready;await d.loadReddit();await new Promise(r=>setImmediate(r));assert.equal(d.renderedPosts[0].id,'first');reverse=true;await d.loadReddit();await new Promise(r=>setImmediate(r));assert.equal(d.renderedPosts[0].id,'second');assert.equal(d.nodes.get('second').nextElementSibling,d.nodes.get('first'));
});
test('repeated server rate limits pause with one explanation rather than retrying forever',async t=>{
 let attempts=0;const {d}=setup(t,{nativeRender:async()=>{attempts++;return {deferred:true,reason:'rate-limit',retryAfterMs:100};}});await d.ready;await d.loadReddit();await new Promise(r=>setTimeout(r,250));assert.equal(attempts,2);assert.equal(d.nativeBatch.blocked,true);assert.equal(d.status.dataset.error,'true');assert.match(d.status.textContent,/Refresh activity/);assert.equal(d.feed.querySelectorAll('.rt-native-unavailable').length,0);
});

function deletedPage(W,{marker='Deleted user'}={}){
 W.document.body.innerHTML='<shreddit-app><div data-native-notice><img alt="'+marker+'"><h3>This user has deleted their account.</h3><a href="/">Go to home</a></div></shreddit-app>';
 return W.document.querySelector('[data-native-notice]');
}
test('deleted profiles use archive discovery with native tabs and native card hydration',async t=>{
 const requests=[];let nativeRenders=0;
 const {W,d,calls}=setup(t,{settings:{postDiscovery:true,archiveDiscovery:true},archive:async input=>{requests.push(input);return {posts:input.kind==='comment'?[comment()]:[raw()],hasMore:false};},nativeRender:async(post,node)=>{nativeRenders++;node.innerHTML='<shreddit-post><span slot="credit-bar"></span><button>Share</button></shreddit-post>';}});
 await d.ready;d.reset();const notice=deletedPage(W);d.autoDiscover=true;d.scan();await new Promise(r=>setImmediate(r));
 assert.equal(d.archiveOnly,true);assert.equal(d.archiveMain.tagName,'MAIN');assert.equal(notice.dataset.rtArchiveNotice,'true');assert.equal(d.archiveShell.querySelector('h1').textContent,'Example');
 assert.deepEqual(requests.map(r=>r.kind),['post']); // The current route is Posts.
 await new Promise(r=>setImmediate(r));assert.ok(calls.every(call=>['render-navigation','render-controls'].includes(call.action)));assert.equal(nativeRenders,1);assert.equal(d.feed.querySelectorAll('.rt-native-card').length,1);assert.ok(d.archiveShell.querySelector('faceplate-tabgroup[for="profile-feed-tabs"]'));assert.equal(d.feed.tagName,'SHREDDIT-FEED');
 assert.equal(d.feed.querySelector('details'),null);assert.ok(d.feed.querySelector('shreddit-post button'));assert.match(d.feed.querySelector('[data-rt-source]').title,/Current Reddit status unknown/);assert.equal(d.feed.querySelector('.rt-archive-card'),null);
 await d.loadReddit();await new Promise(r=>setImmediate(r));assert.ok(calls.every(call=>['render-navigation','render-controls'].includes(call.action)));assert.equal(nativeRenders,1);assert.equal(d.feed.querySelectorAll('.rt-native-card').length,1);assert.ok(d.archiveShell.querySelector('faceplate-tabgroup[for="profile-feed-tabs"]'));assert.equal(d.feed.tagName,'SHREDDIT-FEED');
 d.reset();assert.equal(notice.hasAttribute('data-rt-archive-notice'),false);assert.equal(W.document.querySelector('[data-rt-ui="archive-profile"]'),null);
});
test('a deleted profile keeps the reader’s collapsed navigation and shows a skeleton column, not blank space, while it loads',async t=>{
 const {W,d}=setup(t,{settings:{postDiscovery:true,archiveDiscovery:true},archive:async()=>({posts:[],hasMore:false})});
 W.document.cookie='hui_flex_nav_expanded_state=0; path=/';await d.ready;d.reset();deletedPage(W);d.autoDiscover=true;d.scan();
 const reserve=W.document.querySelector('[data-rt-ui="profile-navigation"] .left-sidebar');assert.ok(reserve?.querySelector('.rt-nav-skeleton .rt-skeleton-line'),'Reddit-style skeleton rows while the navigation is requested');
 await new Promise(r=>setImmediate(r));
 const shell=W.document.querySelector('[data-rt-ui="archive-profile"]');assert.equal(shell.classList.contains('flex-nav-collapsed'),true);assert.equal(shell.classList.contains('flex-nav-expanded'),false);
});
test('deleted-account Overview combines archived posts/comments and empty/error states stay explicit',async t=>{
 let fail=false,empty=false;const requests=[];
 const {W,d,calls}=setup(t,{url:'https://www.reddit.com/user/Example/',settings:{archiveDiscovery:true},archive:async input=>{requests.push(input);if(fail)throw Error('Archive unavailable');return {posts:empty?[]:input.kind==='comment'?[comment()]:[raw()],hasMore:false};}});
 await d.ready;d.reset();deletedPage(W);d.scan();await d.loadArchive();await new Promise(r=>setImmediate(r));assert.deepEqual(requests.map(r=>r.kind),['post','comment']);assert.equal(d.feed.querySelectorAll('.rt-native-card').length,2);assert.match(d.feed.textContent,/Current native text/);assert.equal(d.feed.querySelector('details'),null);assert.equal(calls.length,0);assert.equal(d.archiveEmpty.hidden,true);
 fail=true;await d.loadArchive();assert.match(d.status.textContent,/Archive unavailable/);assert.equal(d.feed.querySelectorAll('.rt-native-card').length,2);
 fail=false;empty=true;d.reset();d.scan();await d.loadArchive();assert.equal(d.archiveEmpty.hidden,false);assert.match(d.archiveEmpty.textContent,/No archived activity found/);assert.match(d.archiveEmpty.textContent,/incomplete/);
});
test('deleted-profile archive opt-out, route changes and replaced native notices clean up safely',async t=>{
 let resolve;const {W,d,calls}=setup(t,{settings:{archiveDiscovery:true},archive:()=>new Promise(r=>resolve=r)});await d.ready;d.reset();let notice=deletedPage(W);d.scan();const load=d.loadArchive();
 d.onSettings({'rt-settings-v1':{newValue:{postDiscovery:false,archiveDiscovery:true}}},'local');resolve({posts:[raw()],hasMore:false});await load;assert.equal(W.document.querySelector('[data-rt-ui="archive-profile"]'),null);assert.equal(notice.hasAttribute('data-rt-archive-notice'),false);assert.equal(calls.length,0);
 d.onSettings({'rt-settings-v1':{newValue:{postDiscovery:true,archiveDiscovery:false}}},'local');assert.equal(d.discover.disabled,true);assert.match(d.archiveEmpty.textContent,/Enable/);assert.equal(d.archiveEmpty.hidden,false);
 const oldShell=d.archiveShell;notice=deletedPage(W);d.scan();assert.notEqual(d.archiveShell,oldShell);assert.equal(oldShell.isConnected,false);
 W.history.pushState({},'','/user/Other/saved/');d.scan();assert.equal(d.archiveShell,null);assert.equal(notice.hasAttribute('data-rt-archive-notice'),false);
});
test('generic error pages are untouched and archive snapshots remain inert and restricted',async t=>{
 const {W,d}=setup(t,{settings:{archiveDiscovery:true}});await d.ready;d.reset();const notice=deletedPage(W,{marker:'Page not found'});d.scan();assert.equal(d.host,null);assert.equal(notice.hasAttribute('data-rt-archive-notice'),false);
 notice.querySelector('img').alt='Deleted user';d.scan();const p=W.RTPostModel.normalizePost(raw('unsafe',{title:'<img onerror=bad()>',selftext:'<script>bad()</script>'}),{source:'arctic-shift'});const card=d.card(p);d.renderArchivedNative(p,card);assert.equal(card.querySelector('img,script'),null);assert.match(card.textContent,/<script>/);assert.match(card.textContent,/<img onerror/);
 for(const flag of ['over18','spoiler']){const restricted=d.card(p);d.renderArchivedNative({...p,[flag]:true,body:'secret snapshot'},restricted);const box=restricted.querySelector('.rt-sensitive');assert.ok(box?.querySelector('.rt-sensitive-content')?.textContent.includes('secret snapshot'));assert.equal(box.querySelector('.rt-sensitive-reveal').textContent,flag==='over18'?'View NSFW content':'View spoiler');assert.doesNotMatch(restricted.textContent,/NSFW or spoiler/);box.click();assert.ok(box.classList.contains('rt-revealed'));}
});

test('archive-only missing fragments use native components with inert historical actions',async t=>{
 const {W,d}=setup(t,{url:'https://www.reddit.com/user/Example/',settings:{archiveDiscovery:true},archive:async input=>({posts:input.kind==='comment'?[comment()]:[raw()],hasMore:false}),nativeRender:async()=>{throw Error('Reddit returned no matching native card');}});
 await d.ready;d.reset();deletedPage(W);d.scan();
 W.customElements.define('shreddit-post',class extends W.HTMLElement{constructor(){super();this.attachShadow({mode:'open'}).append(W.document.createElement('rpl-action-bar'));}});
 await d.loadArchive();await new Promise(r=>setImmediate(r));const cards=[...d.feed.querySelectorAll('.rt-native-card')];assert.equal(cards.length,2,JSON.stringify([...d.nodes].map(([key,n])=>({key,connected:n.isConnected,parent:n.parentElement?.className,state:n.dataset.rtNativeState,hidden:n.hidden}))));assert.ok(cards.every(n=>n.dataset.rtArchiveFallback==='true'));
 const post=d.feed.querySelector('shreddit-post'),commentNode=d.feed.querySelector('shreddit-profile-comment');assert.ok(post);assert.ok(commentNode);assert.match(post.textContent,/Public text/);assert.match(commentNode.textContent,/A discovered public comment/);
 assert.equal(post.shadowRoot.querySelector('rpl-action-bar').hasAttribute('inert'),true);assert.equal(post.hasAttribute('inert'),false);assert.equal(commentNode.querySelector('shreddit-comment-action-row').hasAttribute('inert'),true);assert.equal(d.feed.querySelector('.rt-native-unavailable,.rt-archive-card'),null);assert.equal(d.feed.querySelectorAll('[data-rt-source]').length,2);
 await d.loadArchive();assert.equal(d.feed.querySelectorAll('shreddit-post').length,1);assert.equal(d.feed.querySelectorAll('shreddit-profile-comment').length,1);assert.equal(d.feed.querySelectorAll('[data-rt-source]').length,2);
});
test('deleted-profile tabs remount their native selected state and request the correct archived kind',async t=>{
 const requests=[];const {W,d}=setup(t,{url:'https://www.reddit.com/user/Example/',settings:{archiveDiscovery:true},archive:async input=>{requests.push(input.kind);return {posts:[],hasMore:false};}});await d.ready;d.reset();const notice=deletedPage(W);d.scan();await d.loadArchive();
 for(const [path,kind,index] of [['/user/Example/submitted/','post','2'],['/user/Example/comments/','comment','3']]){W.history.pushState({},'',path);d.scan();await d.loadArchive();assert.equal(requests.at(-1),kind);assert.equal(d.archiveShell.querySelector('faceplate-tabgroup').getAttribute('pageindex'),index);assert.equal(d.archiveShell.querySelector('faceplate-tabpanel').getAttribute('pageindex'),index);assert.equal(d.archiveShell.querySelectorAll('[faceplate-tab-selected]').length,1);assert.equal(W.document.querySelectorAll('[data-rt-ui="archive-profile"]').length,1);assert.equal(notice.dataset.rtArchiveNotice,'true');}
});

test('early guard detaches native deletion notices, mounts from their anchors and restores on opt-out',async t=>{
 const {W,d}=setup(t,{settings:{archiveDiscovery:true}});await d.ready;d.reset();const notice=deletedPage(W);W.chrome={runtime:{id:'fixture',sendMessage:async()=>({ok:true,settings:{postDiscovery:true}})}};
 W.eval(fs.readFileSync('extension/profile-notice.js','utf8'));assert.equal(notice.isConnected,false);assert.ok(W.RTProfileNoticeGuard.unavailableNotice().anchor.isConnected);d.scan();assert.ok(d.archiveShell.isConnected);assert.equal(W.document.querySelector('img[alt="Deleted user"]'),null);
 const replacement=W.document.createElement('div');replacement.innerHTML='<img alt="Deleted user"><h3>Deleted account</h3>';W.document.querySelector('shreddit-app').append(replacement);await new Promise(r=>setImmediate(r));assert.equal(replacement.isConnected,false);
 d.onSettings({'rt-settings-v1':{newValue:{postDiscovery:false}}},'local');assert.equal(notice.isConnected,true);assert.equal(replacement.isConnected,true);
});
test('hidden-profile notices stay detached under native post overlays and restore when leaving the profile',async t=>{
 const {W,d}=setup(t);await d.ready;const tabs=W.document.createElement('faceplate-tabgroup');tabs.id='profile-feed-tabgroup';W.document.querySelector('main').prepend(tabs);const notice=W.document.createElement('div');notice.id='empty-feed-content';notice.innerHTML='<img src="https://www.redditstatic.com/shreddit/assets/snoo_wave.png"><h2>Welcome!</h2>';d.feed.append(notice);
 W.chrome={runtime:{id:'fixture',sendMessage:async()=>({ok:true,settings:{postDiscovery:true}})}};W.eval(fs.readFileSync('extension/profile-notice.js','utf8'));assert.equal(notice.isConnected,false);const host=d.host;
 W.history.pushState({},'','/r/example/comments/abc12/title/');W.document.dispatchEvent(new W.CustomEvent('reddit:route'));d.scan();assert.equal(d.host,host);assert.equal(notice.isConnected,false);assert.equal(W.document.documentElement.hasAttribute('data-rt-profile-discovery'),true);
 W.history.pushState({},'','/user/Example/submitted/');d.scan();assert.equal(d.host,host);assert.equal(notice.isConnected,false);
 W.history.pushState({},'','/r/example/');W.RTProfileNoticeGuard.refresh();d.scan();assert.equal(notice.isConnected,false);assert.equal(d.host,host);W.document.body.replaceChildren(W.document.createElement('main'));W.RTProfileNoticeGuard.refresh();d.scan();assert.equal(d.host,null);assert.equal(W.document.documentElement.hasAttribute('data-rt-profile-discovery'),false);
});
test('unavailable headers use the exact state-specific Reddit artwork and reject replacement photos',async t=>{
 const {W,d}=setup(t);await d.ready;d.reset();deletedPage(W);d.scan();assert.equal(d.avatarPlaceholder.querySelector('img').src,'https://www.redditstatic.com/shreddit/assets/suspended-snoo.png');assert.match(d.avatarPlaceholder.getAttribute('aria-label'),/Deleted account/);const line=d.archiveShell.querySelector('[data-testid="profile-account-state"]');assert.equal(line.dataset.state,'deleted');assert.match(line.textContent,/^This user has deleted their account\. Showing archived public activity\.$/);assert.equal(d.avatarSlot.querySelectorAll('img').length,1);
 d.reset();bannedPage(W);d.scan();assert.equal(d.avatarPlaceholder.querySelector('img').src,'https://www.redditstatic.com/shreddit/assets/suspended-snoo.png');assert.equal(d.archiveShell.querySelector('[data-testid="profile-account-state"]').dataset.state,'banned');assert.match(d.archiveShell.querySelector('[data-testid="profile-account-state"]').textContent,/^This account has been banned/);assert.ok(d.avatarSlot.parentElement.classList.contains('items-center'));
});

test('deleted desktop layout retains native navigation across tabs and labels loaded archive statistics',async t=>{
 const {W,d}=setup(t,{url:'https://www.reddit.com/user/Example/',settings:{archiveDiscovery:true},archive:async input=>({posts:input.kind==='comment'?[comment()]:[raw()],hasMore:false}),reddit:async input=>{assert.equal(input.action,'render-navigation');const target=W.document.getElementById(input.target);target.innerHTML='<flex-left-nav-container id="left-sidebar-container"><a href="/">Home</a></flex-left-nav-container>';return {rendered:true};}});
 await d.ready;d.reset();deletedPage(W);d.scan();await d.loadNavigation();await d.loadArchive();await new Promise(r=>setImmediate(r));const nav=d.profileNavigation,home=nav.querySelector('a');const observer=new W.MutationObserver(()=>{});observer.observe(d.archiveShell.querySelector('aside'),{subtree:true,childList:true});d.scan();d.scan();assert.equal(observer.takeRecords().length,0);observer.disconnect();assert.equal(nav.dataset.state,'ready');assert.ok(d.archiveShell.classList.contains('grid-container'));assert.ok(d.archiveShell.querySelector('aside#right-sidebar-container'));assert.equal(d.archiveStats.posts.textContent,'1');assert.equal(d.archiveStats.comments.textContent,'1');assert.notEqual(d.archiveStats.oldest.textContent,'—');assert.match(d.archiveShell.querySelector('aside').textContent,/Partial archive coverage/);
 W.history.pushState({},'','/user/Example/comments/');d.scan();assert.equal(d.profileNavigation,nav);assert.equal(nav.querySelector('a'),home);assert.equal(nav.dataset.state,'ready');assert.equal(W.document.querySelectorAll('#left-sidebar-container').length,1);
 d.onSettings({'rt-settings-v1':{newValue:{postDiscovery:false}}},'local');assert.equal(nav.isConnected,false);assert.equal(d.profileNavigation,null);
});
test('native navigation failures keep usable common links and provide an explicit retry',async t=>{
 let fail=true;const {W,d}=setup(t,{reddit:async()=>{if(fail)throw Error('Offline');return {rendered:true};}});await d.ready;d.reset();deletedPage(W);d.scan();d.loadNavigation();await new Promise(r=>setImmediate(r));assert.equal(d.profileNavigation.dataset.state,'failed');assert.match(d.profileNavigation.textContent,/Home/);assert.match(d.profileNavigation.textContent,/Popular/);assert.ok(d.profileNavigation.querySelector('button'));assert.ok(d.host.isConnected);
 fail=false;d.profileNavigation.querySelector('button').click();await new Promise(r=>setImmediate(r));assert.equal(d.profileNavigation.dataset.state,'ready');
});

function bannedPage(W,{title='This account has been banned',icon='ban-fill'}={}){
 W.document.body.innerHTML='<shreddit-app><div id="shreddit-forbidden"><div><svg icon-name="'+icon+'" viewBox="0 0 20 20"></svg></div><div id="shreddit-forbidden-not_found"><h1 id="shreddit-forbidden-title">'+title+'</h1></div><nav><a href="/">Explore Reddit Communities</a></nav></div></shreddit-app>';
 return W.document.getElementById('shreddit-forbidden');
}
test('banned and suspended profiles use archive-only native feeds with the native unavailable-avatar icon',async t=>{
 const requests=[];const {W,d,calls}=setup(t,{url:'https://www.reddit.com/user/Example/',settings:{archiveDiscovery:true},archive:async input=>{requests.push(input.kind);return {posts:input.kind==='comment'?[comment()]:[raw()],hasMore:false};}});await d.ready;d.reset();const notice=bannedPage(W);d.scan();
 assert.equal(d.archiveOnly,true);assert.equal(d.accountState,'banned');assert.equal(d.archiveShell.dataset.rtAccountState,'banned');assert.equal(d.avatarPlaceholder.querySelector('img').src,'https://www.redditstatic.com/shreddit/assets/suspended-snoo.png');assert.equal(d.avatarPlaceholder.textContent,'');assert.match(d.avatarPlaceholder.getAttribute('aria-label'),/Banned or suspended/);
 await d.loadArchive();await new Promise(r=>setImmediate(r));assert.deepEqual(requests,['post','comment']);assert.equal(d.feed.querySelectorAll('.rt-native-card').length,2);assert.ok([...d.renderedPosts].every(post=>post.status==='unknown'));assert.equal(calls.length,0);
 for(const [path,kind] of [['/user/Example/submitted/','post'],['/user/Example/comments/','comment']]){W.history.pushState({},'',path);d.scan();await d.loadArchive();assert.equal(requests.at(-1),kind);assert.equal(d.accountState,'banned');}
 d.onSettings({'rt-settings-v1':{newValue:{postDiscovery:false}}},'local');assert.equal(notice.hasAttribute('data-rt-archive-notice'),false);assert.equal(d.archiveShell,null);
 bannedPage(W,{title:'This account has been suspended'});d.onSettings({'rt-settings-v1':{newValue:{postDiscovery:true,archiveDiscovery:false}}},'local');assert.equal(d.archiveOnly,true);assert.equal(d.discover.disabled,true);assert.match(d.archiveEmpty.textContent,/Enable/);
});
test('banned notice guard handles nested parser insertion, replacement, overlays and opt-out restoration',async t=>{
 const {W,d}=setup(t,{settings:{archiveDiscovery:true}});await d.ready;d.reset();W.document.body.innerHTML='<shreddit-app></shreddit-app>';W.chrome={runtime:{id:'fixture',sendMessage:async()=>({ok:true,settings:{postDiscovery:true}})}};W.eval(fs.readFileSync('extension/profile-notice.js','utf8'));
 const notice=W.document.createElement('div');notice.id='shreddit-forbidden';notice.innerHTML='<div><svg icon-name="ban-fill"></svg></div><div id="shreddit-forbidden-not_found"></div>';W.document.querySelector('shreddit-app').append(notice);await new Promise(r=>setImmediate(r));assert.equal(notice.isConnected,true);
 const title=W.document.createElement('h1');title.id='shreddit-forbidden-title';title.textContent='This account has been banned';notice.lastElementChild.append(title);await new Promise(r=>setImmediate(r));assert.equal(notice.isConnected,false);assert.equal(W.RTProfileNoticeGuard.unavailableNotice().state,'banned');d.scan();const shell=d.archiveShell;assert.ok(shell.isConnected);
 const replacement=notice.cloneNode(true);W.document.querySelector('shreddit-app').append(replacement);await new Promise(r=>setImmediate(r));assert.equal(replacement.isConnected,false);
 W.history.pushState({},'','/r/example/comments/abc12/title/');d.scan();assert.equal(d.archiveShell,shell);assert.equal(notice.isConnected,false);
 d.onSettings({'rt-settings-v1':{newValue:{postDiscovery:false}}},'local');assert.equal(notice.isConnected,true);assert.equal(replacement.isConnected,true);assert.equal(shell.isConnected,false);
});
test('generic forbidden pages and unsupported profile routes never become archived banned profiles',async t=>{
 const {W,d}=setup(t);await d.ready;d.reset();const wrong=bannedPage(W,{title:'Page not found'});W.chrome={runtime:{id:'fixture',sendMessage:async()=>({ok:true,settings:{postDiscovery:true}})}};W.eval(fs.readFileSync('extension/profile-notice.js','utf8'));d.scan();assert.equal(d.host,null);assert.equal(wrong.isConnected,true);assert.equal(W.RTProfileNoticeGuard.unavailableNotice(),null);
 const noIcon=bannedPage(W,{icon:'warning-fill'});W.RTProfileNoticeGuard.refresh();d.scan();assert.equal(d.host,null);assert.equal(noIcon.isConnected,true);
 W.history.pushState({},'','/user/Example/saved/');const unsupported=bannedPage(W);W.RTProfileNoticeGuard.refresh();d.scan();assert.equal(d.host,null);assert.equal(unsupported.isConnected,true);
});

test('notifications preserve the active recovered profile until native navigation replaces it',async t=>{
 const {W,d}=setup(t,{settings:{archiveDiscovery:true}});await d.ready;d.reset();const notice=bannedPage(W);W.chrome={runtime:{id:'fixture',sendMessage:async()=>({ok:true,settings:{postDiscovery:true}})}};W.eval(fs.readFileSync('extension/profile-notice.js','utf8'));d.scan();const shell=d.archiveShell,host=d.host;
 for(const path of ['/notifications','/r/example/comments/abc12/title/','/notifications']){W.history.pushState({},'',path);W.RTProfileNoticeGuard.refresh();d.scan();assert.equal(d.archiveShell,shell);assert.equal(d.host,host);assert.equal(notice.isConnected,false);assert.equal(W.document.documentElement.hasAttribute('data-rt-profile-discovery'),true);}
 W.history.pushState({},'','/user/Example/submitted/');d.scan();assert.equal(d.host,host);
 W.history.pushState({},'','/notifications');W.document.body.innerHTML='<main id="main-content">Native notifications</main>';W.RTProfileNoticeGuard.refresh();d.scan();assert.equal(d.host,null);assert.equal(notice.isConnected,false);assert.equal(W.document.documentElement.hasAttribute('data-rt-profile-discovery'),false);
});
test('archived deleted comments recover inside existing native cards with a right-side icon and reversible text',async t=>{
 const {W,d}=setup(t,{url:'https://www.reddit.com/user/Example/comments/',settings:{archiveDiscovery:true}});await d.ready;const p=W.RTPostModel.normalizeItem(comment(),{source:'arctic-shift'});d.archived.set('t1_'+p.id,p);
 const native=W.document.createElement('shreddit-profile-comment');native.setAttribute('comment-id',p.fullname);native.innerHTML='<div><div class="text-12 relative w-fit"><span>Example</span><faceplate-timeago></faceplate-timeago></div><div class="md" id="fixture-post-rtjson-content"><p>[deleted]</p></div><div>Native actions</div></div>';d.feed.replaceChildren(native);const body=native.querySelector('.md'),original=body.firstChild;
 d.render();assert.equal(body.textContent,p.body);assert.equal(d.nodes.get(p.fullname).hidden,true);assert.equal(native.querySelector('details'),null);const badge=native.querySelector('[data-rt-source]');assert.ok(badge);assert.equal(badge.parentElement,native.firstElementChild);assert.ok(badge.parentElement.classList.contains('rt-comment-source-host'));assert.match(badge.title,/Text recovered from Arctic Shift/);
 const observer=new W.MutationObserver(()=>{});observer.observe(native,{childList:true,subtree:true});d.scan();d.scan();assert.equal(observer.takeRecords().length,0);observer.disconnect();d.reset();assert.equal(body.firstChild,original);assert.equal(body.textContent,'[deleted]');assert.equal(native.querySelector('[data-rt-source]'),null);
});
test('native current comment text is preserved and unknown archive text is never invented',async t=>{
 const {W,d}=setup(t);await d.ready;const p=W.RTPostModel.normalizeItem(comment(),{source:'arctic-shift'}),node=W.document.createElement('div');node.innerHTML='<shreddit-profile-comment><div><div class="md">Current Reddit text</div></div></shreddit-profile-comment>';d.decorateNative(p,node);assert.equal(node.querySelector('.md').textContent,'Current Reddit text');assert.equal(node.querySelector('details'),null);
 node.querySelector('.md').textContent='[deleted]';d.decorateNative({...p,body:'[deleted]'},node);assert.equal(node.querySelector('.md').textContent,'[deleted]');d.decorateNative({...p,spoiler:true},node);assert.equal(node.querySelector('.md').textContent,'[deleted]');
});
test('archive fallback cards retain native community avatars and compact source icons without archive banners',async t=>{
 const {W,d}=setup(t);await d.ready;
 for(const raw of [comment(),{id:'fixture',author:'Example',created_utc:1700000000,subreddit:'example',title:'Post',selftext:'Body'}]){const p=W.RTPostModel.normalizeItem(raw,{source:'arctic-shift'}),node=d.card(p);d.renderArchivedNative(p,node);d.decorateNative(p,node);assert.ok(node.querySelector('[avatar] svg[icon-name="community-fill"]'));assert.equal(node.querySelectorAll('[data-rt-source]').length,1);assert.equal(node.querySelector('details'),null);assert.equal(node.textContent.includes('Arctic Shift'),false);}
 const a=W.document.createElement('a');a.href='/r/example/';a.innerHTML='<img src="https://styles.redditmedia.com/fixture.png">';W.document.body.append(a);assert.equal(d.communityAvatar('example').querySelector('img').src,'https://styles.redditmedia.com/fixture.png');
 const sample=W.document.createElement('shreddit-post');sample.setAttribute('subreddit-name','other');sample.innerHTML='<span slot="credit-bar"><div><span avatar><img src="https://styles.redditmedia.com/community.png"></span><a href="https://www.reddit.com/r/other/">r/other</a></div></span>';W.document.body.append(sample);assert.equal(d.communityAvatar('OTHER').querySelector('img').src,'https://styles.redditmedia.com/community.png');
});
test('native card avatars remain untouched and cannot replace the unavailable-profile header',async t=>{
 const {W,d}=setup(t);await d.ready;d.reset();bannedPage(W);d.scan();assert.equal(d.avatarPlaceholder.querySelector('img').src,'https://www.redditstatic.com/shreddit/assets/suspended-snoo.png');assert.equal(d.avatarSlot.querySelectorAll('img').length,1);
 const post=W.RTPostModel.normalizePost(raw(),{source:'arctic-shift'}),node=d.card(post);node.innerHTML='<shreddit-post author="Example" icon="https://i.redd.it/foreign.png"><span slot="credit-bar"></span></shreddit-post>';d.decorateNative(post,node);assert.equal(d.avatarSlot.querySelectorAll('img').length,1);assert.equal(d.avatarPlaceholder.hidden,false);
 node.querySelector('[slot="credit-bar"]').innerHTML='<a href="/user/Example/"><span avatar><img src="https://i.redd.it/generic.png"></span>Example</a>';d.decorateNative(post,node);assert.equal(node.querySelector('[data-rt-author-avatar-replaced],[data-rt-author-avatar]'),null);assert.equal(node.querySelector('[avatar] img').src,'https://i.redd.it/generic.png');
 const css=fs.readFileSync('extension/post-discovery.css','utf8');assert.match(css,/\.rt-profile-avatar>\[hidden\]\{display:none!important\}/);assert.match(css,/\.rt-profile-avatar>img\{width:64px;height:64px/);
});

test('user-profile post URLs preserve their underlying recovered profile',async t=>{
 const {W,d}=setup(t,{settings:{archiveDiscovery:true}});await d.ready;d.reset();bannedPage(W);d.scan();await d.loadArchive();await new Promise(r=>setImmediate(r));const shell=d.archiveShell,host=d.host;
 W.history.pushState({},'','/user/Example/comments/abc12/title/');d.scan();assert.equal(d.archiveShell,shell);assert.equal(d.host,host);assert.equal(d.profileOverlay,true);
 W.history.pushState({},'','/user/Example/submitted/');d.scan();assert.equal(d.host,host);assert.equal(d.nodes.size,1);
});
test('leaving a profile parks it with Reddit\'s retained feed and Back adopts it without re-rendering or scrolling',async t=>{
 for(const away of ['/r/example/comments/extra/title/','/r/example/','/user/Other/']){
  const {W,d}=setup(t,{reddit:async()=>({posts:[raw('extra')],hasMore:false})});await d.ready;await d.loadReddit();await new Promise(r=>setImmediate(r));W.RTThreadRestore=W.RTThreadRestore || {};
  const profile=W.document.querySelector('main'),feed=d.feed,extra=d.nodes.get('extra'),host=d.host;assert.equal(d.feedSlot(extra).parentElement,feed);
  const moves=[];W.scrollBy=options=>moves.push(options);W.scrollTo=options=>moves.push(options);
  W.history.pushState({},'',away);W.document.body.innerHTML=away.startsWith('/user/')?'<main id="main-content">'+nativeControls+'<shreddit-feed></shreddit-feed></main>':'<main id="main-content"><shreddit-post id="t3_extra"></shreddit-post></main>';d.scan();
  assert.equal(d.parked.size,1,away);assert.notEqual(d.host,host);assert.equal(extra.parentElement,feed,'cards stay in the feed Reddit keeps for Back');assert.equal(feed.hasAttribute('data-rt-loading-owner'),true);
  W.history.pushState({},'','/user/Example/submitted/');W.document.body.replaceChildren(profile);d.scan();
  assert.equal(d.host,host);assert.equal(d.feed,feed);assert.equal(d.nodes.get('extra'),extra);assert.equal(extra.parentElement,feed);assert.equal(d.parked.size,away.startsWith('/user/')?1:0);assert.equal(moves.length,0,'Reddit\'s own scroll restore stands');
  assert.equal(W.document.querySelectorAll('[data-rt-ui=posts]').length,1);
 }
});
test('Back recovers a replacement native card when archive data and deletion proof were retained',async t=>{
 const {W,d}=setup(t,{settings:{postDiscovery:true,archiveDiscovery:true,restoreDeletedContent:true},reddit:async()=>({posts:[raw('native',{selftext:'',status:'unknown'})],hasMore:false}),archive:async()=>({posts:[raw('native',{selftext:'Recovered original'})],hasMore:false})});await d.ready;
 const native=d.feed.querySelector('shreddit-post');native.innerHTML='<p slot="text-body">[removed]</p>';await d.loadReddit();await d.loadArchive();await new Promise(r=>setImmediate(r));assert.equal(native.querySelector('[slot="text-body"]').textContent,'Recovered original');
 const profile=W.document.querySelector('main');W.history.pushState({},'','/r/example/comments/native/title/');W.document.body.innerHTML='<main id="main-content"><shreddit-post id="t3_native"></shreddit-post></main>';d.scan();
 const replacement=native.cloneNode(false);replacement.innerHTML='<p slot="text-body">[removed]</p>';native.replaceWith(replacement);W.history.pushState({},'','/user/Example/submitted/');W.document.body.replaceChildren(profile);d.scan();await new Promise(r=>setImmediate(r));assert.equal(replacement.querySelector('[slot="text-body"]').textContent,'Recovered original');assert.equal(d.nodes.get('native').hidden,true);const observer=new W.MutationObserver(()=>{});observer.observe(replacement,{childList:true,subtree:true});d.deduplicate();d.deduplicate();assert.equal(observer.takeRecords().length,0);observer.disconnect();
});
test('virtualized saved cards restore recovered title, media and created body reversibly',async t=>{
 const {W,d}=setup(t,{settings:{postDiscovery:true,archiveDiscovery:true,restoreDeletedContent:true},reddit:async()=>({posts:[raw('old12',{selftext:'[removed]',title:'[removed]'})],hasMore:false}),archive:async()=>({posts:[raw('old12',{title:'Original title',selftext:'Original text',url:'https://i.redd.it/example.png'})],hasMore:false}),nativeRender:async(post,node)=>{node.innerHTML='<shreddit-post id="'+post.fullname+'" item-state="removed"><span slot="credit-bar"></span><a slot="title"><b>[removed]</b></a></shreddit-post>';}});
 await d.ready;await d.loadReddit();await d.loadArchive();await new Promise(r=>setImmediate(r));const card=d.nodes.get('old12'),native=card.querySelector('shreddit-post');assert.equal(native.querySelector('[slot="title"]').textContent,'Original title');assert.ok(native.querySelector('.rt-archived-media'));assert.match(native.textContent,/Original text/);
 const slot=W.document.createElement('div');slot.className='virtualized-placeholder';card.replaceWith(slot);d.trackVirtualization([{target:d.feed,addedNodes:[slot],removedNodes:[card]}]);const profile=W.document.querySelector('main');W.history.pushState({},'','/r/example/comments/old12/title/');W.document.body.innerHTML='<main id="main-content"><shreddit-post id="t3_old12"></shreddit-post></main>';d.scan();
 W.history.pushState({},'','/user/Example/submitted/');W.document.body.replaceChildren(profile);d.scan();await new Promise(r=>setImmediate(r));const restored=d.nodes.get('old12'),shown=restored.querySelector('shreddit-post');assert.equal(shown.querySelector('[slot="title"]').textContent,'Original title');assert.ok(shown.querySelector('.rt-archived-media'));assert.match(shown.textContent,/Original text/);
 const observer=new W.MutationObserver(()=>{});observer.observe(restored,{childList:true,subtree:true});d.deduplicate();d.deduplicate();assert.equal(observer.takeRecords().length,0);observer.disconnect();d.onSettings({'rt-settings-v1':{newValue:{postDiscovery:false}}},'local');assert.equal(shown.querySelector('[slot="title"]').innerHTML,'<b>[removed]</b>');assert.equal(shown.querySelector('.rt-archived-media'),null);assert.equal(shown.querySelector('[slot="text-body"]'),null);
});
test('Back reapplies recovered text to retained and virtualized profile cards',async t=>{
 for(const virtualized of [false,true]){
  let renders=0;const {W,d}=setup(t,{settings:{postDiscovery:true,archiveDiscovery:true,restoreDeletedContent:true},reddit:async()=>({posts:[raw('old12',{selftext:'[removed]'})],hasMore:false}),archive:async()=>({posts:[raw('old12',{selftext:'Recovered original'})],hasMore:false}),nativeRender:async(post,node)=>{renders++;node.innerHTML='<shreddit-post id="'+post.fullname+'"><span slot="credit-bar"></span><p slot="text-body">[removed]</p></shreddit-post>';}});
  await d.ready;await d.loadReddit();await d.loadArchive();await new Promise(r=>setImmediate(r));const card=d.nodes.get('old12');assert.equal(card.querySelector('[slot="text-body"]').textContent,'Recovered original');
  let slot=null;if(virtualized){slot=W.document.createElement('div');slot.className='virtualized-placeholder';card.replaceWith(slot);d.trackVirtualization([{target:d.feed,addedNodes:[slot],removedNodes:[card]}]);}
  const profile=W.document.querySelector('main');W.history.pushState({},'','/r/example/comments/old12/title/');W.document.body.innerHTML='<main id="main-content"><shreddit-post id="t3_old12"></shreddit-post></main>';d.scan();
  W.history.pushState({},'','/user/Example/submitted/');W.document.body.replaceChildren(profile);d.scan();await new Promise(r=>setImmediate(r));const restored=d.nodes.get('old12');assert.equal(restored.querySelector('[slot="text-body"]').textContent,'Recovered original');assert.equal(renders,1);assert.equal([...d.feed.children].filter(n=>!n.hidden && (n.matches('.rt-native-card') || d.virtualNodes.get(n)?.matches?.('.rt-native-card'))).length,1,'the card or its virtualization slot is in the feed');
  const observer=new W.MutationObserver(()=>{});observer.observe(restored,{childList:true,subtree:true});d.deduplicate();d.deduplicate();assert.equal(observer.takeRecords().length,0);observer.disconnect();
  // Scrolling back to it, Reddit's virtualizer swaps the card in again.
  if(slot){slot.replaceWith(restored);d.trackVirtualization([{target:d.feed,addedNodes:[restored],removedNodes:[slot]}]);}
  d.reset();assert.equal(restored.querySelector('[slot="text-body"]').textContent,'[removed]');
 }
});
test('Back restores loaded pages and rendered cards when Reddit reconnects a cached unavailable-profile view',async t=>{
 let requests=0,renders=0;const {W,d}=setup(t,{settings:{archiveDiscovery:true},archive:async input=>{requests++;return {posts:[raw(input.before?'older':'first')],before:input.before?1600000000:1700000000,hasMore:!input.before};},nativeRender:async(post,node)=>{renders++;node.innerHTML='<faceplate-partial><shreddit-post id="'+post.fullname+'"><span slot="credit-bar"><span></span></span><div slot="text-body">Rendered native text</div></shreddit-post><script>/* synthetic already-executed module */</script></faceplate-partial>';}});
 await d.ready;d.reset();const notice=bannedPage(W),nativeView=W.document.querySelector('shreddit-app');W.chrome={runtime:{id:'fixture',sendMessage:async()=>({ok:true,settings:{postDiscovery:true}})}};W.eval(fs.readFileSync('extension/profile-notice.js','utf8'));d.scan();await d.loadArchive();await new Promise(r=>setImmediate(r));await d.loadMore();await new Promise(r=>setImmediate(r));assert.equal(renders,2);assert.equal(requests,2);const keys=[...d.nodes.keys()];
 W.history.pushState({},'','/user/Example/comments/first/title/');W.document.body.innerHTML='<main id="main-content"><shreddit-post id="t3_first"></shreddit-post></main>';W.RTProfileNoticeGuard.refresh();d.scan();assert.equal(nativeView.querySelector('#shreddit-forbidden'),notice);assert.equal(notice.isConnected,false);assert.ok(d.parked.size);
 W.history.pushState({},'','/user/Example/submitted/');W.document.body.replaceChildren(nativeView);W.RTProfileNoticeGuard.refresh();d.scan();await new Promise(r=>setImmediate(r));assert.equal(d.archiveOnly,true);assert.equal(d.nodes.size,2);assert.deepEqual([...d.nodes.keys()],keys);assert.ok([...d.nodes.values()].every(node=>node.dataset.rtNativeState==='ready' && node.isConnected));assert.equal(d.beforeByKind.post,1600000000);assert.equal(d.pages,2);assert.equal(d.moreArchive,false);assert.equal(requests,2);assert.equal(renders,2);assert.equal(notice.isConnected,false);assert.equal(d.feed.querySelectorAll('[data-rt-source]').length,2);assert.ok([...d.nodes.values()].every(node=>node.querySelector('shreddit-post')?.textContent.includes('Rendered native text')),'saved rendered cards come back as they were');
});
test('parked profile views are bounded and torn down when evicted, on account change and on preference changes',async t=>{
 let who='Example';const {W,d}=setup(t,{reddit:async()=>({posts:[raw('extra',{author:who})],hasMore:false})});await d.ready;let owner='account-a';W.RCSDirectory={getOwner:()=>owner};
 const views=[];
 for(let i=0;i<6;i++){who='User'+i;W.history.pushState({},'','/user/User'+i+'/');W.document.body.innerHTML='<main id="main-content">'+nativeControls+'<shreddit-feed><shreddit-post id="t3_native"></shreddit-post></shreddit-feed></main>';d.scan();await d.loadReddit();await new Promise(r=>setImmediate(r));views.push({feed:d.feed,card:d.nodes.get('extra')});}
 W.history.pushState({},'','/r/example/');W.document.body.innerHTML='<main id="main-content"></main>';d.scan();
 assert.equal(d.parked.size,4);assert.equal(views[0].card.isConnected && views[0].feed.contains(views[0].card),false,'an evicted view is torn down, not left with orphaned cards');assert.equal(views[0].feed.hasAttribute('data-rt-loading-owner'),false);assert.equal(views[5].feed.contains(views[5].card),true);
 d.onSettings({'rt-settings-v1':{newValue:{postDiscovery:false}}},'local');assert.equal(d.parked.size,0);assert.equal(views[5].feed.contains(views[5].card),false);assert.equal(views[5].feed.hasAttribute('data-rt-loading-owner'),false);
});
test('community fallback cards use community identity while profile-hosted posts use the profile identity',async t=>{
 const {W,d}=setup(t);await d.ready;
 for(const [state,url] of [['banned','https://www.redditstatic.com/shreddit/assets/suspended-snoo.png'],['deleted','https://www.redditstatic.com/shreddit/assets/suspended-snoo.png']]){
  d.reset();if(state==='banned')bannedPage(W);else deletedPage(W);d.scan();const header=d.avatarPlaceholder.querySelector('img');assert.equal(header.src,url);assert.equal(header.width,64);assert.equal(header.height,64);
  for(const raw of [comment(),{id:'post',author:'Example',created_utc:1700000000,title:'Post',selftext:'Body',subreddit:'example'}]){const p=W.RTPostModel.normalizeItem(raw,{source:'arctic-shift'}),node=d.card(p);d.renderArchivedNative(p,node);d.decorateNative(p,node);d.decorateNative(p,node);assert.equal(node.querySelectorAll('[avatar]').length,1);assert.ok(node.querySelector('[avatar] [icon-name="community-fill"]'));assert.equal(node.querySelector('[avatar] img'),null);assert.equal(node.querySelector('[data-rt-author-avatar],[is-author-deleted]'),null);}
  const post=W.RTPostModel.normalizePost({id:'ownpost',author:'Example',created_utc:1700000000,title:'Own profile post',subreddit:'u_Example'},{source:'arctic-shift'}),node=d.card(post);d.renderArchivedNative(post,node);d.decorateNative(post,node);const credit=node.querySelector('[slot="credit-bar"]');assert.equal(credit.querySelector('a').getAttribute('href'),'/user/Example/');assert.match(credit.textContent,/u\/Example/);assert.equal(credit.textContent.includes('r/u_'),false);assert.equal(credit.querySelector('img').src,'https://www.redditstatic.com/shreddit/assets/snoovatar-back-64x64px.png');assert.ok(credit.querySelector('img').classList.contains('rt-avatar-deleted'));assert.equal(credit.querySelector('img').width,24);assert.equal(node.querySelector('shreddit-post').getAttribute('subreddit-prefixed-name'),'u_Example');
  const foreign=d.card(post);d.renderArchivedNative({...post,subreddit:'u_Other'},foreign);assert.equal(foreign.querySelector('[avatar] img').src,'https://www.redditstatic.com/avatars/defaults/v2/avatar_default_0.png');
 }
});
test('profile loading delegates to Reddit’s page loader without a second custom halo',async t=>{
 const {W,d}=setup(t);await d.ready;const loader=d.loading.querySelector('shreddit-feed-page-loading');assert.ok(loader);assert.equal(loader.getAttribute('page-type'),'profile_posts');assert.equal(loader.querySelector('shreddit-loading,faceplate-shimmer'),null);
 for(let i=0;i<3;i++){const card=d.card(W.RTPostModel.normalizePost(raw('item'+i)));d.feed.append(card);assert.equal(card.querySelector('shreddit-loading,shreddit-logo,faceplate-progress'),null);assert.equal(card.querySelectorAll('faceplate-shimmer').length,3);}
 assert.equal(W.document.querySelectorAll('shreddit-loading').length,0);
});

test('decorating Reddit-rendered community and profile posts preserves their native identity nodes',async t=>{
 const {W,d}=setup(t);await d.ready;d.reset();bannedPage(W);d.scan();
 for(const subreddit of ['example','u_Example']){const post=W.RTPostModel.normalizePost(raw('nativepost',{subreddit}),{source:'arctic-shift'}),node=d.card(post);node.innerHTML='<shreddit-post><span slot="credit-bar"><span><a href="/r/example/"><span avatar><img src="https://styles.redditmedia.com/native.png"></span>Native identity</a></span><span><shreddit-post-overflow-menu></shreddit-post-overflow-menu></span></span><div slot="text-body">Current body</div></shreddit-post>';const identity=node.querySelector('a'),image=identity.querySelector('img'),before=identity.outerHTML;d.decorateNative(post,node);d.decorateNative(post,node);assert.equal(identity.outerHTML,before);assert.equal(node.querySelector('[avatar] img'),image);assert.equal(node.querySelectorAll('[avatar]').length,1);assert.equal(node.querySelectorAll('[data-rt-source]').length,1);assert.equal(node.querySelector('[slot="text-body"]').textContent,'Current body');}
});

test('reply context joins cached parents first and batches unique missing parents with link verification',async t=>{
 const parent=(id,author,linkId='abc12')=>({...comment(),id,fullname:'t1_'+id,author,link_id:'t3_'+linkId}),requests=[];
 const {W,d}=setup(t,{reddit:async input=>{requests.push(input);return {posts:[parent('parent','Recipient'),parent('wrong','Unrelated','otherpost')]};}});await d.ready;
 const makeReply=(id,parentId)=>W.RTPostModel.normalizeComment({...comment(),id,fullname:'t1_'+id,parent_id:parentId},{source:'arctic-shift'});
 const children=[makeReply('first','t1_parent'),makeReply('second','t1_parent'),makeReply('third','t1_cached'),makeReply('fourth','t1_wrong')];d.archived.set('t1_cached',W.RTPostModel.normalizeComment(parent('cached','SavedRecipient'),{source:'arctic-shift'}));
 for(const post of children){const node=d.card(post);d.nodes.set(post.fullname,node);d.renderArchivedNative(post,node);d.decorateNative(post,node);}
 await d.enrichReplyContexts(children);assert.equal(requests.length,1);assert.equal(requests[0].action,'info');assert.equal(requests[0].kind,'comment');assert.deepEqual(Array.from(requests[0].ids),['t1_parent','t1_wrong']);
 assert.match(d.nodes.get('t1_first').querySelector('[id^=poster-info]').textContent,/Example replied to Recipient/);assert.equal(d.nodes.get('t1_first').querySelector('[id^=poster-info] a:last-child').getAttribute('href'),'/user/Recipient/');assert.match(d.nodes.get('t1_third').textContent,/replied to SavedRecipient/);assert.equal(d.nodes.get('t1_fourth').textContent.includes('Unrelated'),false);assert.match(d.nodes.get('t1_fourth').textContent,/Example replied/);
 await d.enrichReplyContexts(children);assert.equal(requests.length,1);
});
test('native complete reply metadata is untouched and needs no lookup; empty metadata is repaired and restored',async t=>{
 const {W,d,calls}=setup(t);await d.ready;const post=W.RTPostModel.normalizeComment({...comment(),parent_id:'t1_parent'},{source:'arctic-shift'}),node=d.card(post);node.innerHTML='<shreddit-profile-comment><div><span id="poster-info-fixture"><a href="/user/Example/">Example</a> replied to <a href="/user/NativeRecipient/">NativeRecipient</a></span></div></shreddit-profile-comment>';d.nodes.set(post.fullname,node);const info=node.querySelector('[id^=poster-info]'),before=info.innerHTML;d.decorateNative(post,node);await d.enrichReplyContexts([post]);assert.equal(info.innerHTML,before);assert.equal(calls.length,0);
 info.replaceChildren();d.replyAuthors.set('t1_parent',{author:'Recipient',linkId:post.linkId});d.decorateNative(post,node);assert.match(info.textContent,/Example replied to Recipient/);d.restoreRecoveredBodies();assert.equal(info.childNodes.length,0);
});
test('reply metadata failures and stale responses never invent recipients or mutate a later profile',async t=>{
 let resolve;const {W,d}=setup(t,{reddit:()=>new Promise(r=>resolve=r)});await d.ready;const post=W.RTPostModel.normalizeComment({...comment(),parent_id:'t1_parent'},{source:'arctic-shift'}),node=d.card(post);d.nodes.set(post.fullname,node);d.renderArchivedNative(post,node);d.decorateNative(post,node);let current=true;const pending=d.enrichReplyContexts([post],()=>current);current=false;resolve({posts:[{...comment(),id:'parent',fullname:'t1_parent',author:'WrongRecipient'}]});await pending;assert.equal(d.replyAuthors.has('t1_parent'),false);assert.equal(node.textContent.includes('WrongRecipient'),false);
 d.reddit=async()=>{throw Error('metadata unavailable');};await d.enrichReplyContexts([post]);assert.match(node.textContent,/Example replied/);assert.equal(node.textContent.includes('replied to'),false);
});
test('recovered profile loading publishes a ready prefix in order and loads the next group at the feed tail',async t=>{
 const releases=[],started=[],observed=[];let observer;
 const {W,d}=setup(t,{settings:{archiveDiscovery:true},archive:async()=>({posts:Array.from({length:51},(_,i)=>raw('batch'+i,{created_utc:1700000000-i})),hasMore:false}),nativeRender:async(post,node)=>{started.push(post.id);await new Promise(r=>releases.push(r));node.innerHTML='<shreddit-post id="'+post.fullname+'"><span slot="credit-bar">Native community</span></shreddit-post>';}});await d.ready;d.reset();deletedPage(W);W.IntersectionObserver=class{constructor(callback){observer=callback;}observe(node){observed.push(node);}disconnect(){}};d.scan();await d.loadArchive();await new Promise(r=>setImmediate(r));
 assert.equal(d.batchedProfile,true);assert.equal(d.feed.querySelectorAll('.rt-native-card').length,0);assert.equal(d.feed.querySelectorAll('shreddit-feed-page-loading').length,1);assert.equal(d.feed.querySelector('shreddit-loading,.rt-native-placeholder'),null);assert.equal(d.loading.slot,'load-after');assert.equal(d.loading.hidden,false);assert.equal(d.archiveEmpty.hidden,true);assert.equal(observed[0],d.loading);
 for(let i=0;i<25;i++){assert.equal(releases.length,Math.min(2,25-i));releases.shift()();await new Promise(r=>setImmediate(r));assert.equal(d.feed.querySelectorAll('.rt-native-card').length,i+1);}
 assert.equal(d.feed.querySelectorAll('.rt-native-card').length,25);assert.equal(started.length,25);const original=d.nodes.get('batch0').firstChild;
 observer([{target:d.loading,isIntersecting:true}]);await new Promise(r=>setImmediate(r));assert.equal(started.length,27);assert.equal(d.feed.querySelectorAll('.rt-native-card').length,25);
 // Move the tail outside the prefetch area before the second group completes.
 d.loading.getBoundingClientRect=()=>({top:5000,bottom:5192});observer([{target:d.loading,isIntersecting:false}]);for(let i=0;i<25;i++){releases.shift()();await new Promise(r=>setImmediate(r));}
 assert.equal(d.feed.querySelectorAll('.rt-native-card').length,50);assert.equal(started.length,50);assert.equal(d.nodes.get('batch0').firstChild,original);assert.equal(d.loading.hidden,false);
 d.advanceProfileBatch(true);await new Promise(r=>setImmediate(r));releases.shift()();await new Promise(r=>setImmediate(r));assert.equal(d.feed.querySelectorAll('.rt-native-card').length,51);assert.equal(d.loading.hidden,true);assert.equal(d.more.hidden,true);
});
test('batch reveal preserves visible cards on failed metadata and cancels cleanly on settings changes',async t=>{
 let release;const {W,d}=setup(t,{settings:{archiveDiscovery:true},archive:async()=>({posts:[{...comment(),parent_id:'t1_missing'}],hasMore:false}),reddit:async()=>{throw Error('metadata unavailable');},nativeRender:async(post,node)=>{await new Promise(r=>release=r);node.innerHTML='<shreddit-profile-comment comment-id="'+post.fullname+'"><span id="poster-info-fixture"></span></shreddit-profile-comment>';}});await d.ready;d.reset();deletedPage(W);d.scan();await d.loadArchive();release();await new Promise(r=>setImmediate(r));assert.equal(d.feed.querySelectorAll('.rt-native-card').length,1);assert.match(d.feed.textContent,/Example replied/);assert.equal(d.loading.hidden,true);
 d.reset();d.scan();await d.loadArchive();const old=d.activeProfileBatch;d.onSettings({'rt-settings-v1':{newValue:{postDiscovery:false}}},'local');release();await new Promise(r=>setImmediate(r));assert.equal(d.host,null);assert.equal(d.activeProfileBatch,null);assert.equal(old.nodes[0].isConnected,false);
});

test('profile continuation fetches the next bounded archive page only after staged cards are consumed',async t=>{
 let observed,requests=0;const {W,d}=setup(t,{settings:{archiveDiscovery:true},archive:async input=>{requests++;return {posts:[raw(input.before?'second':'first',{created_utc:input.before?1699999990:1700000000})],before:1699999995,hasMore:!input.before};}});await d.ready;d.reset();deletedPage(W);W.IntersectionObserver=class{constructor(callback){observed=callback;}observe(){}disconnect(){}};d.scan();await d.loadArchive();await new Promise(r=>setImmediate(r));assert.equal(requests,1);assert.equal(d.feed.querySelectorAll('.rt-native-card').length,1);assert.equal(d.loading.hidden,false);
 observed([{target:d.loading,isIntersecting:true}]);await new Promise(r=>setImmediate(r));assert.equal(requests,2);assert.equal(d.feed.querySelectorAll('.rt-native-card').length,2);assert.equal(d.loading.hidden,true);observed([{target:d.loading,isIntersecting:true}]);await new Promise(r=>setImmediate(r));assert.equal(requests,2);
});
test('near-tail source reads overlap hydration but stop at a bounded unpublished buffer',async t=>{
 let observer;const releases=[],requests=[];const {W,d}=setup(t,{reddit:async input=>{requests.push(input);return {posts:Array.from({length:25},(_,i)=>raw('page'+requests.length+'c'+i,{created_utc:1700000000-requests.length*25-i})),after:'next'+requests.length,hasMore:true};},nativeRender:async(post,node)=>{await new Promise(resolve=>releases.push(resolve));node.innerHTML='<shreddit-post id="'+post.fullname+'"></shreddit-post>';}});await d.ready;d.reset();W.IntersectionObserver=class{constructor(callback){observer=callback;}observe(){}disconnect(){}};d.scan();await d.loadReddit();await new Promise(r=>setImmediate(r));assert.equal(requests.length,1);d.loading.getBoundingClientRect=()=>({top:W.innerHeight*2,bottom:W.innerHeight*2+192});observer([{target:d.loading,isIntersecting:true}]);assert.equal(requests.length,1,'a full buffered page is not fetched past');releases.shift()();await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));assert.equal(requests.length,2,'one next page overlaps the remaining card requests');assert.equal(requests[1].after,'next1');assert.equal(d.publishedCards.size,1);assert.equal(d.nodes.size,50);for(let i=0;i<5;i++)d.updateProfileLoading();assert.equal(requests.length,2);d.loading.getBoundingClientRect=()=>({top:5000,bottom:5192});observer([{target:d.loading,isIntersecting:false}]);d.reset();while(releases.length)releases.shift()();
});
test('partial progress resumes from ready cards on Back and does not replay completed renders',async t=>{
 let releases=[],renders=0;const {W,d}=setup(t,{settings:{archiveDiscovery:true},archive:async()=>({posts:Array.from({length:3},(_,i)=>raw('rest'+i,{created_utc:1700000000-i})),hasMore:false}),nativeRender:async(post,node)=>{renders++;await new Promise(r=>releases.push(r));node.innerHTML='<shreddit-post id="'+post.fullname+'"><span slot="credit-bar"></span></shreddit-post>';}});await d.ready;d.reset();deletedPage(W);d.scan();await d.loadArchive();releases.shift()();await new Promise(r=>setImmediate(r));assert.equal(d.feed.querySelectorAll('.rt-native-card').length,1);
 const view=W.document.querySelector('shreddit-app') || W.document.body.firstElementChild,started=renders,key=W.location.pathname;
 // Leave while renders are pending; their late results are ignored.
 W.history.pushState({},'','/user/Example/comments/rest0/title/');W.document.body.innerHTML='<main id="main-content"><shreddit-post id="t3_rest0"></shreddit-post></main>';d.scan();assert.equal(d.parked.size,1);while(releases.length)releases.shift()();await new Promise(r=>setImmediate(r));
 W.history.pushState({},'',key);W.document.body.replaceChildren(view);d.scan();await new Promise(r=>setImmediate(r));
 assert.equal(d.feed.querySelectorAll('.rt-native-card').length>=1,true);while(releases.length){releases.shift()();await new Promise(r=>setImmediate(r));}
 assert.equal(renders,started+2,'only the two cards cut off by leaving render again');assert.equal(d.feed.querySelectorAll('.rt-native-card').length,3);assert.equal(d.loading.hidden,true);
});

test('blocked native parent lookup falls back to one opt-in archive batch without replacing valid native metadata',async t=>{
 const archiveCalls=[];const {W,d}=setup(t,{settings:{archiveDiscovery:true},reddit:async()=>{throw Error('Reddit HTTP 403');},archive:async input=>{archiveCalls.push(input);return {posts:[{...comment(),id:'parent',fullname:'t1_parent',author:'ArchivedRecipient'}]};}});await d.ready;
 const posts=['first','second'].map(id=>W.RTPostModel.normalizeComment({...comment(),id,fullname:'t1_'+id,parent_id:'t1_parent'},{source:'arctic-shift'}));for(const p of posts){const node=d.card(p);d.nodes.set(p.fullname,node);d.renderArchivedNative(p,node);d.decorateNative(p,node);}await d.enrichReplyContexts(posts);assert.equal(archiveCalls.length,1);assert.equal(archiveCalls[0].action,'archive-parents');assert.deepEqual(Array.from(archiveCalls[0].children),['first','second']);assert.match(d.nodes.get('t1_first').textContent,/Example replied to ArchivedRecipient/);await d.enrichReplyContexts(posts);assert.equal(archiveCalls.length,1);
 const noArchive=setup(t,{reddit:async()=>{throw Error('metadata unavailable');},archive:async()=>{throw Error('must not call archive');}});await noArchive.d.ready;await noArchive.d.enrichReplyContexts(posts);assert.equal(noArchive.d.replyArchiveChecked.size,0);
});

test('feed options dropdown adds native activity choices and filters between all, hidden and deleted',async t=>{
 const {W,d}=setup(t,{reddit:async()=>({posts:[raw('live1',{selftext:'Normal post'}),raw('live2',{selftext:'[deleted]'})],hasMore:false})});
 await d.ready;await d.loadReddit();await new Promise(r=>setImmediate(r));
 const dropdown=W.document.querySelector('main rpl-dropdown');assert.ok(dropdown);
 const items=dropdown.querySelectorAll('rpl-menu-item[data-rt-activity-filter]');assert.equal(items.length,3);
 const [allItem,hiddenItem,deletedItem]=items;assert.equal(allItem.getAttribute('aria-current'),'true');
 assert.equal(d.nodes.get('live1').hidden,false);
 deletedItem.click();assert.equal(d.activityFilter,'deleted');assert.equal(deletedItem.getAttribute('aria-current'),'true');
 assert.equal(d.nodes.get('live1').hidden,true);
 assert.equal(d.nodes.get('live2').hidden,false);
 allItem.click();assert.equal(d.activityFilter,'all');assert.equal(allItem.getAttribute('aria-current'),'true');
 assert.equal(d.nodes.get('live1').hidden,false);
 assert.equal(d.nodes.get('live2').hidden,false);
});

test('duplicate native feed loading indicators suppress the extension loading halo',async t=>{
 const {W,d}=setup(t);await d.ready;
 const nativeLoader=W.document.createElement('shreddit-loading');
 d.feed.append(nativeLoader);
 assert.equal(d.nativeFeedLoading(),true);
});

test('profile Overview searches start together under existing provider budgets',async t=>{
 const releases=[],requests=[];const {d}=setup(t,{url:'https://www.reddit.com/user/Example/',reddit:input=>{requests.push(input.kind);return new Promise(r=>releases.push(()=>r({posts:input.kind==='post'?[raw()]:[comment()],hasMore:false})));}});await d.ready;const loading=d.loadReddit();await new Promise(r=>setImmediate(r));assert.deepEqual(requests,['post','comment']);assert.equal(releases.length,2);releases[1]();releases[0]();await loading;assert.equal(d.live.size,2);assert.equal(d.pages,3);
});
test('public comments missing from signed-in search appear in both Comments and Overview',async t=>{
 for(const path of ['comments/','']){const missing={...comment(),subreddit:'TheLaptopGuide'};const {d,calls}=setup(t,{url:'https://www.reddit.com/user/Example/'+path,reddit:async input=>({posts:input.kind==='post'?[raw()]:[],hasMore:false}),publicReddit:async()=>({posts:[missing],hasMore:false})});await d.ready;await d.loadReddit();await new Promise(r=>setImmediate(r));const node=d.nodes.get(missing.fullname);assert.ok(node);assert.equal(node.parentElement,d.feed);assert.equal(node.hidden,false);assert.equal(d.commentOrigins.get(missing.fullname),'public');assert.deepEqual(calls.filter(c=>c.kind==='comment').map(c=>c.stream),['authenticated','public']);assert.equal(d.renderedPosts.find(p=>p.fullname===missing.fullname).subreddit,'TheLaptopGuide');}
});
test('comment sources retain independent cursors and deduplicate with signed-in text preferred in either arrival order',async t=>{
 for(const slow of ['authenticated','public']){let release;const {d,calls}=setup(t,{url:'https://www.reddit.com/user/Example/comments/',reddit:async input=>{if(!input.after && slow==='authenticated')await new Promise(r=>release=r);return {posts:[{...comment(),body:'Authenticated text'}],after:input.after?null:'auth-next',hasMore:!input.after};},publicReddit:async input=>{if(!input.after && slow==='public')await new Promise(r=>release=r);return {posts:[{...comment(),body:'Public text',over_18:true},{...comment(),id:'unique',fullname:'t1_unique',body:'Public-only text'}],after:input.after?null:'public-next',hasMore:!input.after};}});await d.ready;const loading=d.loadReddit();await new Promise(r=>setImmediate(r));release();await loading;await new Promise(r=>setImmediate(r));assert.equal(d.live.size,2);assert.equal(d.live.get(comment().fullname).body,'Authenticated text');assert.equal(d.live.get(comment().fullname).over18,true);assert.equal(d.commentOrigins.get(comment().fullname),'authenticated');const card=d.nodes.get('t1_unique');await d.loadMore();await new Promise(r=>setImmediate(r));assert.equal(calls.find(c=>c.stream==='authenticated' && c.after).after,'auth-next');assert.equal(calls.find(c=>c.stream==='public' && c.after).after,'public-next');assert.equal(d.moreReddit,false);assert.equal(d.nodes.get('t1_unique'),card);assert.equal(d.nodes.size,2);}
});
test('a failed comment source keeps the other source visible and pageable until its cursor ends',async t=>{
 for(const failed of ['authenticated','public']){const requests=[],provider=stream=>async input=>{requests.push({stream,after:input.after});if(stream===failed)throw Error('Source unavailable');return {posts:[{...comment(),id:input.after?'second':'first',fullname:input.after?'t1_second':'t1_first'}],after:input.after?null:stream+'-next',hasMore:!input.after};};const {d}=setup(t,{url:'https://www.reddit.com/user/Example/comments/',reddit:provider('authenticated'),publicReddit:provider('public')});await d.ready;await d.loadReddit();await new Promise(r=>setImmediate(r));assert.equal(d.nodes.get('t1_first').hidden,false);assert.equal(d.moreReddit,true);assert.equal(d.batchAutoPaused,false);assert.equal(d.primaryFailure(),false);await d.loadMore();await new Promise(r=>setImmediate(r));assert.equal(d.nodes.get('t1_second').hidden,false);assert.equal(requests.filter(r=>r.stream===failed).length,1);assert.equal(d.moreReddit,false);assert.ok(d.sourceErrors[failed==='public'?'comment-public':'comment']);}
});
test('a fast public Overview source waits for the shared ordering boundary and late reads cannot enter another profile',async t=>{
 const releases=[];const {W,d}=setup(t,{url:'https://www.reddit.com/user/Example/',reddit:()=>new Promise(r=>releases.push(r)),publicReddit:async()=>({posts:[comment()],hasMore:false})});await d.ready;const pending=d.loadReddit();await new Promise(r=>setImmediate(r));assert.equal(d.busy,true);assert.equal(d.nodes.get(comment().fullname).hidden,true);assert.equal(d.nodes.get(comment().fullname).parentElement,d.results);W.history.pushState({},'','/user/Other/comments/');d.scan();for(const release of releases)release({posts:[raw()],hasMore:false});await pending;assert.equal(d.context.username,'Other');assert.equal(d.live.size,0);assert.equal(d.commentOrigins.size,0);
});
test('public comment cursor and precedence survive leaving and returning to a profile',async t=>{
 const {W,d}=setup(t,{url:'https://www.reddit.com/user/Example/comments/',reddit:async()=>({posts:[],hasMore:false}),publicReddit:async()=>({posts:[comment()],after:'public-next',hasMore:true})});await d.ready;await d.loadReddit();await new Promise(r=>setImmediate(r));
 const profile=W.document.querySelector('main');W.history.pushState({},'','/r/example/');W.document.body.innerHTML='<main id="main-content"></main>';d.scan();const saved=parkedState(d,'profile:example:comments:new:all:') || [...d.parked.values()][0];
 assert.equal(saved.afterByKind['comment-public'],'public-next');assert.equal(saved.redMore['comment-public'],true);assert.equal(saved.commentOrigins.get(comment().fullname),'public');
 W.history.pushState({},'','/user/Example/comments/');W.document.body.replaceChildren(profile);d.scan();assert.equal(d.commentOrigins.get(comment().fullname),'public');assert.equal(d.afterByKind['comment-public'],'public-next');
});
test('late public comments cannot enter a replacement profile and local backpressure is not mistaken for a failed source',async t=>{
 let release;const {W,d}=setup(t,{url:'https://www.reddit.com/user/Example/comments/',reddit:async()=>({posts:[],hasMore:false}),publicReddit:()=>new Promise(r=>release=r)});await d.ready;const pending=d.loadReddit();await new Promise(r=>setImmediate(r));W.history.pushState({},'','/user/Other/comments/');d.scan();release({posts:[comment()],after:'old-public',hasMore:true});await pending;assert.equal(d.context.username,'Other');assert.equal(d.nodes.size,0);assert.equal(d.afterByKind['comment-public'],undefined);
 let attempts=0;const other=setup(t,{url:'https://www.reddit.com/user/Example/comments/',reddit:async()=>({posts:[],hasMore:false}),publicReddit:async()=>++attempts<4?{deferred:true,retryAfterMs:100}:{posts:[comment()],hasMore:false}});await other.d.ready;await other.d.loadReddit();await new Promise(r=>setImmediate(r));assert.equal(attempts,4);assert.equal(other.d.nodes.get(comment().fullname).hidden,false);assert.equal(other.d.sourceErrors['comment-public'],undefined);
});
test('ready recovered groups are published before optional reply metadata settles',async t=>{
 let reply;const {W,d}=setup(t,{settings:{archiveDiscovery:true},archive:async()=>({posts:[{...comment(),parent_id:'t1_parent'}],hasMore:false}),reddit:()=>new Promise(r=>reply=r),nativeRender:async(post,node)=>{node.innerHTML='<shreddit-profile-comment comment-id="'+post.fullname+'"><span id="poster-info-fixture"></span></shreddit-profile-comment>';}});await d.ready;d.reset();deletedPage(W);d.scan();await d.loadArchive();await new Promise(r=>setImmediate(r));assert.equal(d.feed.querySelectorAll('.rt-native-card:not([hidden])').length,1);assert.equal(d.loading.hidden,true);assert.equal(typeof reply,'function');reply({posts:[{...comment(),id:'parent',fullname:'t1_parent',author:'Recipient'}]});await d.replyEnrichment;assert.match(d.feed.textContent,/Example replied to Recipient/);
});
test('a profile remount removes its old continuation loader and reuses native navigation across users',async t=>{
 let navRequests=0;const {W,d}=setup(t,{settings:{archiveDiscovery:true},reddit:async input=>{if(input.action==='render-navigation'){navRequests++;return {rendered:true};}return {posts:[]};}});await d.ready;d.reset();deletedPage(W);d.autoDiscover=true;d.scan();await new Promise(r=>setImmediate(r));const nav=d.profileNavigation,lease=d.navigationLease,loader=d.loading;assert.equal(navRequests,1);assert.equal(nav.dataset.state,'ready');W.history.pushState({},'','/user/Other/submitted/');d.scan();await new Promise(r=>setImmediate(r));assert.equal(d.profileNavigation,nav);assert.equal(d.navigationLease,lease);assert.equal(navRequests,1);assert.equal(loader.isConnected,false);assert.equal(W.document.querySelectorAll('[data-rt-ui=profile-loading]').length,1);
 d.onSettings({'rt-settings-v1':{newValue:{postDiscovery:false}}},'local');assert.equal(nav.isConnected,false);assert.notEqual(d.navigationLease,lease);
});
test('native feed reload hides the continuation loader immediately without another halo',async t=>{
 const {W,d}=setup(t);await d.ready;const root=d.feed.attachShadow({mode:'open'});d.batchedProfile=true;d.busy=true;d.observeNativeLoading();d.updateProfileLoading();assert.equal(d.loading.hidden,false);root.innerHTML='<shreddit-loading></shreddit-loading>';await new Promise(r=>setImmediate(r));assert.equal(d.loading.hidden,false);assert.equal(d.loading.querySelector('.rt-native-loading').hidden,true);root.replaceChildren();await new Promise(r=>setImmediate(r));assert.equal(d.loading.hidden,false);const old=d.loading;d.reset();assert.equal(old.isConnected,false);assert.equal(d.nativeLoadingObserver,null);
});
test('native Feed options receives matching status rows exactly once and restores filtered original cards on opt-out',async t=>{
 const {W,d}=setup(t,{reddit:async()=>({posts:[raw('hiddenpost')],hasMore:false})});await d.ready;d.reset();const main=W.document.querySelector('main'),dropdown=W.document.createElement('rpl-dropdown');dropdown.innerHTML='<button aria-label="Feed options"></button><div slot="content"><rpl-menu><rpl-menu-item>New</rpl-menu-item></rpl-menu></div>';main.prepend(dropdown);d.feed=null;d.scan();const feed=d.feed;feed.innerHTML='<article id="original"><shreddit-post id="t3_native" created-timestamp="2023-11-14T22:13:20Z"><span slot="text-body">Current text</span></shreddit-post></article><article id="deleted"><shreddit-post id="t3_deleted" deleted created-timestamp="2023-11-14T22:13:20Z"><span slot="text-body">Removed text</span></shreddit-post></article>';const original=feed.querySelector('#original'),deleted=feed.querySelector('#deleted');await d.loadReddit();await new Promise(r=>setImmediate(r));const menu=dropdown;assert.equal(d.toolbar.querySelector('[data-rt-activity-menu]'),null);assert.equal(menu.querySelectorAll('[data-rt-activity-filter]').length,3);for(let i=0;i<4;i++)d.scan();assert.equal(menu.querySelectorAll('[data-rt-activity-filter]').length,3);
 menu.querySelector('[data-rt-activity-filter=deleted]').click();assert.equal(original.hidden,true);assert.equal(deleted.hidden,false);assert.equal(original.hasAttribute('data-rt-filter-hidden'),true);menu.querySelector('[data-rt-activity-filter=hidden]').click();assert.equal(deleted.hidden,true);assert.equal(d.nodes.get('hiddenpost').hidden,false);d.onSettings({'rt-settings-v1':{newValue:{postDiscovery:false}}},'local');assert.equal(original.hidden,false);assert.equal(deleted.hidden,false);assert.equal(original.hasAttribute('data-rt-filter-hidden'),false);assert.equal(menu.querySelectorAll('[data-rt-activity-filter]').length,0);assert.equal(menu.textContent,'New');
});
test('unknown archive snapshots are not misclassified as hidden or deleted',async t=>{
 const {W,d}=setup(t);await d.ready;const p=W.RTPostModel.normalizePost(raw('unknown'),{source:'arctic-shift'}),node=d.card(p);d.activityFilter='hidden';assert.equal(d.matchesActivity(p,node),false);d.activityFilter='deleted';assert.equal(d.matchesActivity(p,node),false);node.innerHTML='<shreddit-post deleted><span slot="credit-bar"></span></shreddit-post>';assert.equal(d.matchesActivity(p,node),true);
});

test('extension icons are Reddit’s own 20px icons and the Activity menu adds one row',async t=>{
 const {W,d}=setup(t);await d.ready;
 for(const kind of ['refresh','archive','removed','activity','hidden','deleted']){const svg=d.discover.ownerDocument.defaultView.RTPostDiscovery.glyph(kind);assert.equal(svg.getAttribute('viewBox'),'0 0 20 20',kind);assert.equal(svg.dataset.nativeIcon,'true',kind);}
 assert.equal(d.discover.querySelector('svg').dataset.nativeIcon,'true','Refresh uses Reddit’s rotate icon');
 const main=d.activityMain,before=null,rows=[...main.children].filter(n=>!n.hidden && n.matches('rpl-menu-item'));assert.deepEqual(rows.map(n=>n.getAttribute('aria-label')),['Sort','View','Activity'],'Reddit’s sections and Activity become three submenu rows');
 assert.equal(main.querySelectorAll(':scope > rpl-menu-item:not([data-rt-ui])').length,0,'native rows moved into their submenus');const ours=[rows[2]];assert.equal(ours[0].querySelector('[data-rt-activity-value]').textContent,'All');
 rows[0].click();const sortSub=rows[0].rtSubmenu;assert.equal(main.classList.contains('hidden'),true);assert.equal(sortSub.classList.contains('hidden'),false);assert.ok(sortSub.querySelector('rpl-menu-item[aria-label="Top"]'),'Reddit’s Top row lives in the Sort submenu');sortSub.querySelector('[aria-label="Back"]').click();assert.equal(main.classList.contains('hidden'),false);
 assert.ok(d.activityMenu.querySelector('[data-rt-ui="activity-refresh"]'),'Refresh is inside the Activity submenu');
 d.activityMenu.querySelector('[data-rt-activity-filter="deleted"]').click();assert.equal(ours[0].querySelector('[data-rt-activity-value]').textContent,'Deleted');
 for(const [filter,status] of [['hidden','live'],['deleted','deleted']]){const badge=d.indicator({source:'reddit',status}),option=d.activityMenu.querySelector('[data-rt-activity-filter='+filter+']');assert.equal(badge.querySelector('svg').getAttribute('viewBox'),'0 0 20 20');assert.equal(badge.querySelector('path').getAttribute('d'),option.querySelector('path').getAttribute('d'));assert.equal(badge.querySelector('svg').dataset.nativeIcon,'true');}
 d.clearActivityMenu();assert.deepEqual([...main.children].filter(n=>n.matches('rpl-menu-item')).map(n=>n.getAttribute('aria-label')),['New','Top','Compact'],'teardown restores Reddit’s rows in order');assert.equal([...main.children].find(n=>n.textContent==='View').hidden,false);
});
test('profile notice callbacks tolerate a discarded document',async()=>{
 const dom=new JSDOM('<main></main>',{url:'https://www.reddit.com/user/Example/',runScripts:'outside-only'}),W=dom.window;W.chrome={runtime:{id:'fixture',sendMessage:async()=>({ok:true,settings:{postDiscovery:true}})}};W.eval(fs.readFileSync('extension/profile-notice.js','utf8'));await new Promise(r=>setImmediate(r));const refresh=W.RTProfileNoticeGuard.refresh;W.close();assert.doesNotThrow(()=>refresh([]));
});

test('stale parallel discovery completion cannot render or set errors on a successor profile',async t=>{
 const reject=[];const {W,d}=setup(t,{url:'https://www.reddit.com/user/Example/',reddit:()=>new Promise((_,r)=>reject.push(r))});await d.ready;const pending=d.loadReddit();W.history.pushState({},'','/user/Other/');d.scan();let renders=0;const render=d.render.bind(d);d.render=(...args)=>{renders++;return render(...args);};d.setStatus('Successor status');for(const fail of reject)fail(Error('Old request failed'));await pending;assert.equal(renders,0);assert.equal(d.status.textContent,'Successor status');assert.equal(d.context.username,'Other');
});

test('Activity uses one native root row, native checkmarks and same-dropdown Back/Escape navigation',async t=>{
 const {W,d}=setup(t);await d.ready;const dropdown=W.document.querySelector('main rpl-dropdown'),trigger=dropdown.querySelector('button'),before=trigger.outerHTML,nativeRows=[...dropdown.querySelectorAll('.main-menu-container > rpl-menu-item')].filter(n=>!n.dataset.rtUi);for(let i=0;i<4;i++)d.scan();assert.equal(dropdown.querySelectorAll('[data-rt-activity]').length,1);assert.equal(dropdown.querySelectorAll('.main-menu-container [data-rt-activity-filter]').length,0);assert.equal(trigger.outerHTML,before);assert.ok(nativeRows.every(n=>n.isConnected));const activity=dropdown.querySelector('[data-rt-activity]');dropdown.setAttribute('open','');activity.click();assert.equal(d.activityMain.classList.contains('hidden'),true);assert.equal(d.activityMenu.classList.contains('hidden'),false);assert.equal(dropdown.hasAttribute('open'),true);const checked=d.activityMenu.querySelector('[data-rt-check]');assert.equal(checked.tagName.toLowerCase(),'svg');assert.equal(checked.getAttribute('icon-name'),'checkmark');d.activityMenu.dispatchEvent(new W.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(d.activityMain.classList.contains('hidden'),false);assert.equal(dropdown.hasAttribute('open'),true);activity.dispatchEvent(new W.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));assert.equal(d.activityOpen,true);d.activityMenu.querySelector('[aria-label="Back"]').click();assert.equal(d.activityOpen,false);activity.click();dropdown.removeAttribute('open');await new Promise(r=>setImmediate(r));assert.equal(d.activityOpen,false);assert.equal(d.activityMain.classList.contains('hidden'),false);
});
test('filtered native empty states count native matches and never appear during unfinished work or source failure',async t=>{
 const {W,d}=setup(t,{reddit:async()=>({posts:[],hasMore:false})});await d.ready;d.feed.innerHTML='<article><shreddit-post id="t3_deleted" deleted><p slot="text-body">[deleted]</p></shreddit-post></article>';await d.loadReddit();d.activityFilter='deleted';d.deduplicate();assert.ok(!d.activityEmpty || d.activityEmpty.hidden);d.activityFilter='hidden';d.deduplicate();assert.equal(d.activityEmpty.hidden,false);assert.equal(d.activityEmpty.id,'');assert.match(d.activityEmpty.textContent,/No hidden posts found/);assert.ok(d.activityEmpty.querySelector('[data-testid="empty-state-creative"]'));d.busy=true;d.updateActivityEmptyState();assert.equal(d.activityEmpty.hidden,true);d.busy=false;d.sourceErrors.post='HTTP 403';d.render();assert.equal(d.activityEmpty.hidden,true);assert.match(d.status.textContent,/403/);d.sourceErrors={};d.render();d.moreReddit=true;d.updateActivityEmptyState();assert.equal(d.activityEmpty.hidden,true);d.moreReddit=false;d.updateActivityEmptyState();assert.equal(d.activityEmpty.hidden,false);d.activityFilter='all';d.deduplicate();assert.equal(d.activityEmpty.hidden,true);assert.equal(d.feed.firstElementChild.hidden,false);
});
test('archive cards display while current metadata is still pending and unresolved errors survive secondary completion',async t=>{
 let release;const {d}=setup(t,{settings:{archiveDiscovery:true,restoreDeletedContent:false},reddit:()=>new Promise(r=>release=r)});await d.ready;d.activityFilter='hidden';// status is checked up front only in filtered views
 await d.loadArchive();await new Promise(r=>setImmediate(r));assert.equal(d.metadataPending,1);assert.ok(d.nodes.get('old12').querySelector('shreddit-post'));d.sourceErrors.comment='Comments failed';release({statuses:[{fullname:'t3_old12',status:'available'}],unknownIds:[]});await new Promise(r=>setImmediate(r));assert.equal(d.metadataPending,0);assert.match(d.status.textContent,/Comments failed/);assert.equal(d.sourceErrors.comment,'Comments failed');
});
test('bottom continuation keeps the halo after existing cards and refresh resets only the cursor window',async t=>{
 const {d,calls}=setup(t,{reddit:async()=>({posts:[raw()],after:'t3_next',hasMore:true})});await d.ready;await d.loadReddit();await new Promise(r=>setImmediate(r));assert.equal(d.feed.lastElementChild,d.loading);assert.equal(d.loading.slot,'load-after');assert.equal(d.loading.hidden,false);d.pages=80;d.updateProfileLoading();assert.equal(d.loading.hidden,false);assert.equal(d.loading.querySelector('.rt-native-loading').hidden,false);await d.loadReddit();assert.equal(d.pages,1);assert.equal(calls.filter(c=>c.action==='profile').length,2);d.moreReddit=false;d.moreArchive=false;d.updateProfileLoading();assert.equal(d.loading.hidden,true);
});

test('automatic recovery batches visible deleted items, shows recovered text and restores native body on opt-out',async t=>{
 const requests=[];const {W,d}=setup(t,{settings:{archiveDiscovery:true},archive:async input=>{requests.push(input);return {posts:[raw('deleted',{selftext:'Recovered body'})]};}});await d.ready;const native=W.document.createElement('shreddit-post');native.id='t3_deleted';native.setAttribute('deleted','');native.innerHTML='<p slot="text-body">[deleted]</p>';d.feed.append(native);d.deduplicate();await new Promise(r=>setTimeout(r,100));assert.equal(requests.length,1);assert.equal(requests[0].action,'archive-recover');assert.deepEqual(Array.from(requests[0].ids),['deleted']);assert.match(native.textContent,/Recovered body/);assert.ok(native.querySelector('[data-rt-source]'));d.scan();await new Promise(r=>setTimeout(r,100));assert.equal(requests.length,1);d.onSettings({'rt-settings-v1':{newValue:{postDiscovery:false}}},'local');assert.equal(native.querySelector('[slot="text-body"]').textContent,'[deleted]');
});
test('automatic recovery requires archive opt-in and restoration preference and skips offscreen items',async t=>{
 for(const settings of [{archiveDiscovery:false},{archiveDiscovery:true,restoreDeletedContent:false},{archiveDiscovery:true}]){const requests=[];const {W,d}=setup(t,{settings,archive:async input=>{requests.push(input);return {posts:[]};}});await d.ready;const native=W.document.createElement('shreddit-post');native.id='t3_deleted';native.setAttribute('deleted','');native.innerHTML='<p slot="text-body">[deleted]</p>';native.getBoundingClientRect=()=>({top:5000,bottom:5100});d.feed.append(native);d.deduplicate();await new Promise(r=>setTimeout(r,100));assert.equal(requests.length,0);}
});
test('native content restrictions are retained when deleted detail metadata comes from an unmarked archive snapshot',async t=>{
 const {W,d}=setup(t,{url:'https://www.reddit.com/comments/abc12/title/',settings:{archiveDiscovery:true},archive:async()=>({posts:[raw('abc12',{selftext:'Restricted original'})]})});await d.ready;const native=W.document.querySelector('shreddit-post');native.id='t3_abc12';native.setAttribute('deleted','');native.setAttribute('nsfw','');native.innerHTML='<p slot="text-body">[deleted]</p>';await d.loadDetail();assert.equal(native.textContent.includes('Restricted original'),false);assert.equal(native.querySelector('[slot="text-body"]').textContent,'[deleted]');const box=d.results.querySelector('.rt-sensitive');assert.ok(box.textContent.includes('Restricted original'));assert.equal(box.querySelector('.rt-sensitive-reveal').textContent,'View NSFW content');assert.doesNotMatch(d.results.textContent,/NSFW or spoiler/);
});

test('Overview stages the first source until the slower source establishes its ordering boundary',async t=>{
 let release;const {d}=setup(t,{url:'https://www.reddit.com/user/Example/',reddit:input=>input.kind==='comment'?new Promise(r=>release=r):Promise.resolve({posts:[raw()],hasMore:false})});await d.ready;const pending=d.loadReddit();await new Promise(r=>setImmediate(r));assert.equal(d.busy,true);assert.equal(d.nodes.get('abc12').parentElement,d.results);assert.equal(d.nodes.get('abc12').hidden,true);assert.equal(d.loading.hidden,false);release({posts:[comment()],hasMore:false});await pending;await new Promise(r=>setImmediate(r));assert.equal(d.loading.hidden,true);
});
test('out-of-order render completion reveals only a contiguous prefix and keeps the continuation until finished',async t=>{
 const releases=[];const {W,d}=setup(t,{settings:{archiveDiscovery:true},archive:async()=>({posts:[raw('first',{created_utc:1700000002}),raw('second',{created_utc:1700000001}),raw('third')],hasMore:false}),nativeRender:async(post,node)=>{await new Promise(r=>releases.push(r));node.innerHTML='<shreddit-post id="'+post.fullname+'"><span slot="credit-bar"></span></shreddit-post>';}});await d.ready;d.reset();deletedPage(W);d.scan();await d.loadArchive();assert.equal(releases.length,2);releases[1]();await new Promise(r=>setImmediate(r));assert.equal(d.feed.querySelectorAll('.rt-native-card').length,0);assert.equal(releases.length,3);releases[0]();await new Promise(r=>setImmediate(r));assert.equal(d.feed.querySelectorAll('.rt-native-card').length,2);assert.equal(d.loading.hidden,false);releases[2]();await new Promise(r=>setImmediate(r));assert.equal(d.feed.querySelectorAll('.rt-native-card').length,3);assert.equal(d.loading.hidden,true);
});
test('filtered archive candidates can acquire native deletion status while hidden',async t=>{
 let release;const {d}=setup(t,{settings:{archiveDiscovery:true},reddit:async()=>({posts:[]}),nativeRender:async(post,node)=>{await new Promise(r=>release=r);node.innerHTML='<shreddit-post id="'+post.fullname+'" deleted><span slot="credit-bar"></span><p slot="text-body">[deleted]</p></shreddit-post>';}});await d.ready;await d.loadArchive();d.activityFilter='deleted';d.deduplicate();assert.equal(d.nodes.get('old12').hidden,true);assert.ok(!d.activityEmpty || d.activityEmpty.hidden);release();await new Promise(r=>setImmediate(r));assert.equal(d.nodes.get('old12').hidden,false);assert.match(d.nodes.get('old12').textContent,/Public text/);assert.ok(!d.activityEmpty || d.activityEmpty.hidden);
});
test('adapted empty states reuse a detached native creative without being recaptured as a privacy notice',async t=>{
 const {W,d}=setup(t,{reddit:async()=>({posts:[],hasMore:false})});await d.ready;const notice=W.document.createElement('div');notice.id='empty-feed-content';notice.className='mt-[100px] flex justify-center items-center flex-col';notice.innerHTML='<div rpl><div data-testid="empty-state-creative"><img src="https://www.redditstatic.com/shreddit/assets/snoo_wave.png"></div><div role="heading">Welcome!</div><div class="text-body-1">Example keeps posts hidden</div></div>';d.feed.append(notice);W.chrome={runtime:{id:'fixture',sendMessage:async()=>({ok:true,settings:{postDiscovery:true}})}};W.eval(fs.readFileSync('extension/profile-notice.js','utf8'));await d.loadReddit();d.activityFilter='hidden';d.deduplicate();W.RTProfileNoticeGuard.refresh();assert.equal(notice.isConnected,false);assert.equal(d.activityEmpty.hidden,false);assert.ok(d.activityEmpty.querySelector('[rpl] [data-testid="empty-state-creative"]'));assert.match(d.activityEmpty.textContent,/No hidden posts found/);assert.equal(d.activityEmpty.textContent.includes('keeps posts hidden'),false);assert.equal(d.activityEmpty.querySelector('#empty-feed-content'),null);
});
test('opting out during automatic restoration discards the pending archive result',async t=>{
 let release;const {W,d}=setup(t,{settings:{archiveDiscovery:true},archive:()=>new Promise(r=>release=r)});await d.ready;const native=W.document.createElement('shreddit-post');native.id='t3_deleted';native.setAttribute('deleted','');native.innerHTML='<p slot="text-body">[deleted]</p>';d.feed.append(native);d.deduplicate();await new Promise(r=>setTimeout(r,100));assert.equal(typeof release,'function');d.onSettings({'rt-settings-v1':{newValue:{postDiscovery:true,archiveDiscovery:false}}},'local');release({posts:[raw('deleted',{selftext:'Discarded recovered text'})]});await new Promise(r=>setImmediate(r));assert.equal(W.document.body.textContent.includes('Discarded recovered text'),false);assert.equal(native.querySelector('[slot="text-body"]').textContent,'[deleted]');
});

test('automatic detail recovery waits for the matching native deleted post and runs once after hydration',async t=>{
 const requests=[];const {W,d}=setup(t,{url:'https://www.reddit.com/comments/abc12/title/',settings:{archiveDiscovery:true},archive:async input=>{requests.push(input);return {posts:[raw('abc12',{selftext:'Automatically restored body'})]};}});await d.ready;d.autoDiscover=true;const native=W.document.querySelector('shreddit-post');native.id='t3_other';native.setAttribute('deleted','');native.innerHTML='<p slot="text-body">[deleted]</p>';d.scan();await new Promise(r=>setImmediate(r));assert.equal(requests.length,0);native.id='t3_abc12';d.scan();await new Promise(r=>setImmediate(r));assert.equal(requests.length,1);assert.equal(requests[0].action,'archive-ids');assert.match(native.textContent,/Automatically restored body/);d.scan();await new Promise(r=>setImmediate(r));assert.equal(requests.length,1);
});
test('long comment continuation follows each saved cursor and keeps one trailing halo until exhaustion',async t=>{
 let page=0;const {d,calls}=setup(t,{url:'https://www.reddit.com/user/Example/comments/',reddit:async()=>{page++;return {posts:[{...comment(),id:'page'+page,fullname:'t1_page'+page,created_utc:1700000000-page}],after:'cursor'+page,hasMore:page<12};}});await d.ready;await d.loadReddit();await new Promise(r=>setImmediate(r));const first=d.nodes.get('t1_page1');
 for(let i=1;i<12;i++){assert.equal(d.feed.lastElementChild,d.loading);assert.equal(d.loading.hidden,false);await d.loadMore();await new Promise(r=>setImmediate(r));if(d.activeProfileBatch)await new Promise(r=>setImmediate(r));}
 assert.equal(page,12);assert.equal(calls.filter(c=>c.action==='profile').at(-1).after,'cursor11');assert.equal(d.loading.hidden,true);assert.equal(d.nodes.get('t1_page1'),first);assert.equal(d.feed.querySelectorAll('shreddit-feed-page-loading').length,1);
});

test('Deleted activity starts opted-in archive discovery and verifies archived comment status before displaying it',async t=>{
 let release;const requests=[];const {W,d}=setup(t,{url:'https://www.reddit.com/user/Example/comments/',settings:{archiveDiscovery:true,restoreDeletedContent:true},reddit:async()=>({posts:[],hasMore:false}),archive:async input=>{requests.push(input);return {posts:[{...comment(),body:'Archived original'}],hasMore:false};},nativeRender:async(post,node)=>{await new Promise(r=>release=r);node.innerHTML='<shreddit-profile-comment comment-id="'+post.fullname+'"><p class="md">[deleted]</p></shreddit-profile-comment>';}});
 await d.ready;await d.loadReddit();d.activityMenu.querySelector('[data-rt-activity-filter="deleted"]').click();await new Promise(r=>setImmediate(r));assert.equal(requests.length,1);assert.equal(requests[0].kind,'comment');assert.equal(d.loading.hidden,false);assert.equal(d.feed.querySelectorAll('.rt-native-card').length,0);assert.ok(!d.activityEmpty || d.activityEmpty.hidden);
 release();await new Promise(r=>setImmediate(r));const node=d.nodes.get(comment().fullname);assert.equal(node.hidden,false);assert.match(node.textContent,/Archived original/);assert.equal(d.loading.hidden,true);assert.equal(d.postStatuses.get(comment().fullname),'deleted');d.activityMenu.querySelector('[data-rt-activity-filter="all"]').click();d.activityMenu.querySelector('[data-rt-activity-filter="deleted"]').click();await new Promise(r=>setImmediate(r));assert.equal(requests.length,1);
});
test('Deleted overlaps an in-flight Reddit page, respects archive opt-out and does not treat live archive entries as deleted',async t=>{
 let finish;const requests=[];const {d}=setup(t,{url:'https://www.reddit.com/user/Example/comments/',settings:{archiveDiscovery:true},reddit:input=>input.action==='profile'?new Promise(r=>finish=r):Promise.resolve({posts:[],hasMore:false}),archive:async input=>{requests.push(input);return {posts:[comment()],hasMore:false};}});await d.ready;const page=d.loadReddit();d.activityMenu.querySelector('[data-rt-activity-filter="deleted"]').click();assert.equal(requests.length,1);finish({posts:[],hasMore:false});await page;await new Promise(r=>setImmediate(r));assert.equal(requests.length,1);assert.equal(d.nodes.get(comment().fullname).hidden,true);
 const other=setup(t,{settings:{archiveDiscovery:false},archive:async()=>{throw Error('must not query');}});await other.d.ready;other.d.activityMenu.querySelector('[data-rt-activity-filter="deleted"]').click();assert.equal(other.d.archiveLoaded,false);
});
test('Overview stages both comment and post hydration behind a single native halo',async t=>{
 const releases=[];const {d}=setup(t,{url:'https://www.reddit.com/user/Example/',reddit:async input=>({posts:input.kind==='comment'?[comment()]:[raw()],hasMore:false}),nativeRender:async(post,node)=>{await new Promise(r=>releases.push(r));node.innerHTML=post.kind==='comment'?'<shreddit-profile-comment comment-id="'+post.fullname+'"></shreddit-profile-comment>':'<shreddit-post id="'+post.fullname+'"></shreddit-post>';}});await d.ready;await d.loadReddit();assert.equal(releases.length,2);assert.equal(d.feed.querySelector('.rt-native-placeholder,faceplate-shimmer'),null);assert.equal(d.feed.querySelectorAll('shreddit-feed-page-loading').length,1);assert.equal(d.loading.hidden,false);releases[0]();await new Promise(r=>setImmediate(r));assert.equal(releases.length,2);assert.equal(d.loading.hidden,false);assert.equal(d.feed.lastElementChild,d.loading);releases[1]();await new Promise(r=>setImmediate(r));assert.equal(d.loading.hidden,true);assert.equal(d.feed.querySelectorAll('.rt-native-card').length,2);
});
test('dormant and hidden native loaders release the shared halo while offscreen continuation keeps ownership',async t=>{
 const {W,d}=setup(t);await d.ready;d.busy=true;const loader=W.document.createElement('shreddit-feed-page-loading');loader.attachShadow({mode:'open'});d.feed.append(loader);d.updateProfileLoading();assert.equal(d.loading.hidden,false);loader.shadowRoot.innerHTML='<shreddit-loading></shreddit-loading>';loader.style.display='none';d.updateProfileLoading();assert.equal(d.loading.hidden,false);loader.style.display='block';loader.getBoundingClientRect=()=>({top:-300,bottom:-100,width:100,height:200});d.updateProfileLoading();assert.equal(d.loading.querySelector('.rt-native-loading').hidden,true);assert.equal(d.loading.hidden,false);loader.getBoundingClientRect=()=>({top:100,bottom:300,width:100,height:200});d.updateProfileLoading();assert.equal(d.loading.hidden,false);assert.equal(d.loading.querySelector('.rt-native-loading').hidden,true);loader.remove();d.updateProfileLoading();assert.equal(d.loading.hidden,false);d.loading.remove();d.updateProfileLoading();assert.equal(d.feed.lastElementChild,d.loading);
});
test('Comments places one combined native menu at the existing sort position and restores the original on opt-out',async t=>{
 const {W,d}=setup(t,{url:'https://www.reddit.com/user/Example/comments/'});await d.ready;d.reset();W.document.querySelector('main rpl-dropdown').closest('shreddit-layout-event-setter').remove();const row=W.document.createElement('div'),sort=W.document.createElement('shreddit-sort-dropdown');sort.innerHTML='<div slot="selected-item">New</div>';row.append(sort);W.document.querySelector('shreddit-feed').before(row);d.autoDiscover=true;d.scan();assert.equal(sort.hidden,false);await new Promise(r=>setImmediate(r));assert.equal(sort.hidden,true);assert.equal(d.controlsTarget.nextElementSibling,sort);assert.equal(d.controlsTarget.querySelectorAll('rpl-dropdown').length,1);assert.ok(d.controlsTarget.querySelector('[data-rt-activity]'));const replacement=W.document.createElement('shreddit-sort-dropdown');sort.replaceWith(replacement);d.scan();assert.equal(sort.hidden,false);assert.equal(replacement.hidden,true);d.reset();assert.equal(replacement.hidden,false);assert.equal(replacement.hasAttribute('data-rt-comment-sort-suppressed'),false);
});

test('one tail intersection continues through twelve six-comment pages without losing the halo or restarting cards',async t=>{
 let observer;const pending=[],requests=[];const {W,d}=setup(t,{url:'https://www.reddit.com/user/Example/comments/',reddit:input=>{requests.push(input);return new Promise(r=>pending.push(r));}});await d.ready;d.reset();W.IntersectionObserver=class{constructor(callback){observer=callback;}observe(){}disconnect(){}};d.scan();d.loading.getBoundingClientRect=()=>({top:100,bottom:292});const initial=d.loadReddit();observer([{target:d.loading,isIntersecting:true}]);let first;
 for(let page=0;page<12;page++){
   assert.equal(pending.length,1);assert.equal(d.loading.hidden,false);assert.equal(d.feed.lastElementChild,d.loading);pending.shift()({posts:Array.from({length:6},(_,i)=>({...comment(),id:'p'+page+'c'+i,fullname:'t1_p'+page+'c'+i,created_utc:1700000000-page*6-i})),after:'next'+page,hasMore:page<11});
   for(let wait=0;wait<100 && (page<11?!pending.length:d.busy || d.activeProfileBatch);wait++)await new Promise(r=>setTimeout(r,10));if(!page)first=d.nodes.get('t1_p0c0');
 }
 await initial;assert.equal(requests.length,12);assert.equal(requests.at(-1).after,'next10');assert.equal(d.feed.querySelectorAll('.rt-native-card').length,72);assert.equal(d.loading.hidden,true);assert.equal(d.feed.lastElementChild,d.loading);assert.equal(d.nodes.get('t1_p0c0'),first);
});

test('Deleted archive candidates are not stranded behind the unfiltered native feed date horizon',async t=>{
 const {W,d}=setup(t,{settings:{archiveDiscovery:true},reddit:async()=>({posts:[raw('oldergone',{selftext:'[deleted]'})],hasMore:false}),archive:async()=>({posts:[raw('oldergone',{selftext:'Archived older body'})],hasMore:false}),nativeRender:async(post,node)=>{node.innerHTML='<shreddit-post id="'+post.fullname+'" deleted><span slot="credit-bar"></span><p slot="text-body">[deleted]</p></shreddit-post>';}});await d.ready;d.feed.innerHTML='<article><shreddit-post id="t3_native" created-timestamp="2026-10-24T10:00:00Z"></shreddit-post></article><shreddit-feed-load-more-observer cursor="next"></shreddit-feed-load-more-observer>';d.activityMenu.querySelector('[data-rt-activity-filter="deleted"]').click();await new Promise(r=>setImmediate(r));const node=d.nodes.get('oldergone');assert.equal(node.dataset.deferred,'');assert.equal(node.hidden,false);assert.match(node.textContent,/Archived older body/);assert.equal(node.parentElement,d.feed);assert.equal(d.feed.lastElementChild,d.loading);
});

test('native page-loader shadow completion releases the extension halo without requiring another scroll',async t=>{
 const {W,d}=setup(t);await d.ready;d.busy=true;const native=W.document.createElement('shreddit-feed-page-loading');native.attachShadow({mode:'open'}).innerHTML='<shreddit-loading></shreddit-loading>';d.feed.append(native);d.observeNativeLoading();d.updateProfileLoading();assert.equal(d.loading.hidden,false);assert.equal(d.loading.querySelector('.rt-native-loading').hidden,true);native.shadowRoot.replaceChildren();await new Promise(r=>setImmediate(r));assert.equal(d.loading.hidden,false);native.shadowRoot.innerHTML='<shreddit-loading></shreddit-loading>';await new Promise(r=>setImmediate(r));assert.equal(d.loading.hidden,false);assert.equal(d.loading.querySelector('.rt-native-loading').hidden,true);native.hidden=true;await new Promise(r=>setImmediate(r));assert.equal(d.loading.hidden,false);
});

test('active filter CSS gates newly inserted native cards before mutation observers run and keeps them in the feed',async t=>{
 const {W,d}=setup(t);await d.ready;const style=W.document.createElement('style');style.textContent=W.document.defaultView?fs.readFileSync('extension/post-discovery.css','utf8'):'';W.document.head.append(style);d.activityMenu.querySelector('[data-rt-activity-filter="hidden"]').click();const row=W.document.createElement('article');row.innerHTML='<shreddit-post id="t3_arriving"><span slot="text-body">New native card</span></shreddit-post>';d.feed.insertBefore(row,d.loading);assert.equal(W.getComputedStyle(row).display,'none');assert.equal(row.parentElement,d.feed);await new Promise(r=>setImmediate(r));assert.equal(row.hidden,true);assert.equal(row.parentElement,d.feed);
 d.activityMenu.querySelector('[data-rt-activity-filter="all"]').click();assert.equal(row.hidden,false);assert.notEqual(W.getComputedStyle(row).display,'none');assert.equal(row.parentElement,d.feed);
 d.activityMenu.querySelector('[data-rt-activity-filter="deleted"]').click();const gone=W.document.createElement('article');gone.innerHTML='<shreddit-post id="t3_gone" deleted><span slot="text-body">[deleted]</span></shreddit-post>';d.feed.insertBefore(gone,d.loading);assert.equal(W.getComputedStyle(gone).display,'none');await new Promise(r=>setImmediate(r));assert.equal(gone.hidden,false);assert.equal(gone.hasAttribute('data-rt-activity-match'),true);assert.notEqual(W.getComputedStyle(gone).display,'none');assert.equal(row.hidden,true);
 d.reset();assert.equal(d.feed,null);assert.equal(row.hidden,false);assert.equal(gone.hasAttribute('data-rt-activity-match'),false);
});
test('native filter changes during hydration are applied before the next paint',async t=>{
 const {W,d}=setup(t);await d.ready;d.activityMenu.querySelector('[data-rt-activity-filter="deleted"]').click();const row=W.document.createElement('article');row.innerHTML='<shreddit-post id="t3_hydrating"><span slot="text-body">Current</span></shreddit-post>';d.feed.insertBefore(row,d.loading);await new Promise(r=>setImmediate(r));assert.equal(row.hidden,true);row.querySelector('shreddit-post').setAttribute('item-state','DELETED');await new Promise(r=>setImmediate(r));assert.equal(row.hidden,false);assert.equal(d.postStatuses.get('t3_hydrating'),'deleted');
});
test('ready duplicate cards stay populated inside the native virtualization stack through filter changes and scroll restoration',async t=>{
 let renders=0;const {W,d}=setup(t,{nativeRender:async(post,node)=>{renders++;node.innerHTML='<shreddit-post id="'+post.fullname+'"><span slot="credit-bar"></span><p slot="text-body">Retained card body</p></shreddit-post>';}});await d.ready;await d.loadReddit();await new Promise(r=>setImmediate(r));const card=d.nodes.get('abc12'),content=card.querySelector('shreddit-post'),slot=W.document.createElement('div');slot.className='virtualized-placeholder';d.feed.replaceChild(slot,card);d.trackVirtualization([{target:d.feed,addedNodes:[slot],removedNodes:[card]}]);const stack=[{node:card,placeholder:slot,height:250}],native=W.document.createElement('article');native.innerHTML='<shreddit-post id="t3_abc12"><p slot="text-body">Native duplicate</p></shreddit-post>';d.feed.insertBefore(native,d.loading);d.scan();assert.equal(card.dataset.rtNativeState,'ready');assert.equal(card.querySelector('shreddit-post'),content);assert.equal(stack[0].node,card);assert.equal(slot.hidden,true);
 d.activityMenu.querySelector('[data-rt-activity-filter="hidden"]').click();assert.equal(card.parentElement,null);assert.equal(card.querySelector('shreddit-post'),content);const entry=stack.pop();d.feed.replaceChild(entry.node,entry.placeholder);d.trackVirtualization([{target:d.feed,addedNodes:[card],removedNodes:[slot]}]);d.scan();assert.equal(card.querySelector('shreddit-post'),content);assert.equal(card.parentElement,d.feed);assert.equal(card.hidden,true);assert.equal(renders,1);d.activityMenu.querySelector('[data-rt-activity-filter="all"]').click();assert.equal(native.hidden,false);assert.equal(card.hidden,true);assert.equal(card.querySelector('shreddit-post'),content);
});
test('archive status checks use native evidence while keeping archive text provenance and unknown status quiet',async t=>{
 const calls=[];const {d}=setup(t,{settings:{archiveDiscovery:true},reddit:async input=>{calls.push(input);if(input.action==='status')return {statuses:[{fullname:'t3_old12',status:'deleted',author:'[deleted]'}],unknownIds:[]};return {posts:[]};}});await d.ready;d.activityFilter='hidden';// status is checked up front only in filtered views
 await d.loadArchive();await new Promise(r=>setImmediate(r));assert.equal(calls[0].action,'status');assert.equal(calls[0].username,'Example');assert.equal(d.live.size,0);assert.equal(d.postStatuses.get('t3_old12'),'deleted');assert.equal(d.renderedPosts[0].source,'arctic-shift');assert.match(d.nodes.get('old12').querySelector('[data-rt-source]').title,/Deleted/);
 d.reddit=async()=>({statuses:[],unknownIds:['t3_old12'],incomplete:true});await d.loadArchive();await new Promise(r=>setImmediate(r));assert.equal(d.status.dataset.error,'false');assert.match(d.status.title,/unverified current Reddit status/);assert.equal(d.loading.hidden,true);
});

test('native virtualization transfers filter state without turning a temporary hidden flag into the original state',async t=>{
 const {W,d}=setup(t);await d.ready;const native=d.feed.querySelector('shreddit-post'),original=native.parentElement===d.feed?native:native.parentElement;d.activityMenu.querySelector('[data-rt-activity-filter="hidden"]').click();assert.equal(original.hidden,true);const slot=W.document.createElement('div');slot.className='virtualized-placeholder';d.feed.replaceChild(slot,original);d.trackVirtualization([{target:d.feed,addedNodes:[slot],removedNodes:[original]}]);d.scan();assert.equal(slot.hidden,true);assert.equal(d.filteredNative.get(slot),false);d.activityMenu.querySelector('[data-rt-activity-filter="all"]').click();assert.equal(slot.hidden,false);d.feed.replaceChild(original,slot);d.trackVirtualization([{target:d.feed,addedNodes:[original],removedNodes:[slot]}]);d.scan();assert.equal(original.hidden,false);assert.equal(original.hasAttribute('data-rt-filter-hidden'),false);d.activityMenu.querySelector('[data-rt-activity-filter="hidden"]').click();assert.equal(original.hidden,true);d.feed.replaceChild(slot,original);d.trackVirtualization([{target:d.feed,addedNodes:[slot],removedNodes:[original]}]);d.scan();d.feed.replaceChild(original,slot);d.trackVirtualization([{target:d.feed,addedNodes:[original],removedNodes:[slot]}]);d.scan();d.activityMenu.querySelector('[data-rt-activity-filter="all"]').click();assert.equal(original.hidden,false);assert.equal(original.parentElement,d.feed);
});

test('an in-flight duplicate cannot expose an empty published card if the native duplicate later disappears',async t=>{
 let finish,calls=0;const {W,d}=setup(t,{nativeRender:async(post,node)=>{calls++;if(calls===1)return new Promise(r=>finish=r);node.innerHTML='<shreddit-post id="'+post.fullname+'"><span slot="credit-bar"></span><p slot="text-body">Ready again</p></shreddit-post>';}});await d.ready;await d.loadReddit();const node=d.nodes.get('abc12'),native=W.document.createElement('article');native.innerHTML='<shreddit-post id="t3_abc12"></shreddit-post>';d.feed.insertBefore(native,d.loading);finish({duplicate:true});await new Promise(r=>setImmediate(r));assert.equal(node.hidden,true);assert.equal(node.dataset.rtNativeState,'idle');native.remove();d.scan();assert.equal(node.hidden,true);await new Promise(r=>setImmediate(r));assert.equal(calls,2);assert.equal(node.dataset.rtNativeState,'ready');assert.equal(node.hidden,false);assert.match(node.textContent,/Ready again/);
});

test('verified available archive cards qualify for Hidden without labeling historical text as current Reddit content',async t=>{
 const {d}=setup(t,{settings:{archiveDiscovery:true},reddit:async input=>input.action==='status'?{statuses:[{fullname:'t3_old12',status:'available',author:'Example'}],unknownIds:[]}:{posts:[]}});await d.ready;await d.loadArchive();await new Promise(r=>setImmediate(r));d.activityMenu.querySelector('[data-rt-activity-filter="hidden"]').click();for(let i=0;i<4;i++)await new Promise(r=>setImmediate(r));const node=d.nodes.get('old12');assert.equal(node.hidden,false);assert.equal(d.renderedPosts[0].source,'arctic-shift');assert.equal(d.live.size,0);assert.match(node.querySelector('[data-rt-source]').title,/Available on Reddit.*Arctic Shift snapshot/);assert.equal(node.querySelector('[data-rt-source] svg').dataset.icon,'hidden');
});

function nativeProfileTabs(W){const tabs=W.document.createElement('faceplate-tabgroup');tabs.id='profile-feed-tabgroup';tabs.innerHTML='<a href="/user/Example/submitted/" faceplate-tab-selected>Posts</a><a href="/user/Example/comments/">Comments</a>';W.document.querySelector('main').prepend(tabs);return tabs;}
test('opening a post retains the mixed profile feed after Reddit removes the profile tabs',async t=>{
 const {W,d,calls}=setup(t,{settings:{archiveDiscovery:true},reddit:async input=>input.action==='status'?{statuses:[{fullname:'t3_old12',status:'deleted'}],unknownIds:[]}:{posts:[raw('found')],hasMore:false}});await d.ready;const tabs=nativeProfileTabs(W);await d.loadReddit();await d.loadArchive();await new Promise(r=>setImmediate(r));
 const feed=d.feed,host=d.host,found=d.nodes.get('found'),archived=d.nodes.get('old12'),content=found.firstElementChild,generation=d.generation,before=calls.length;tabs.remove();W.history.pushState({},'','/r/example/comments/found/title/');
 const observer=new W.MutationObserver(()=>{});observer.observe(feed,{childList:true,subtree:true});for(let i=0;i<4;i++)d.scan();assert.equal(d.context.kind,'profile');assert.equal(d.profileOverlay,true);assert.equal(d.feed,feed);assert.equal(d.host,host);assert.equal(d.generation,generation);assert.equal(found.parentElement,feed);assert.equal(archived.parentElement,feed);assert.equal(found.firstElementChild,content);assert.equal(calls.length,before);assert.equal(observer.takeRecords().length,0);observer.disconnect();
 const detail=W.document.createElement('shreddit-post');detail.id='t3_found';feed.replaceWith(detail);d.scan();assert.equal(d.context?.kind,'post');assert.notEqual(d.generation,generation);assert.equal(d.feed,null);assert.equal(found.isConnected,false);assert.equal(found.parentElement,feed,'kept in the parked feed');assert.ok(parkedState(d,'profile:example:posts:new:all:'));assert.equal(host.isConnected,false);
});
test('post handoff follows the outgoing native objects even when Reddit reuses its feed container',async t=>{
 const {W,d}=setup(t);await d.ready;nativeProfileTabs(W);await d.loadReddit();await new Promise(r=>setImmediate(r));const feed=d.feed,generation=d.generation;W.history.pushState({},'','/r/example/comments/abc12/title/');d.scan();assert.equal(d.profileOverlay,true);
 // Same ID and still-present tabs do not make a new detail card the old feed.
 feed.replaceChildren();const detail=W.document.createElement('shreddit-post');detail.id='t3_native';feed.append(detail);await new Promise(r=>setImmediate(r));assert.equal(d.context.kind,'post');assert.equal(d.generation,generation+1);assert.equal(d.feed,null);assert.equal(d.nodes.size,0);
});
test('cancelling post navigation keeps the original virtualized feed, cards and activity filter',async t=>{
 const {W,d}=setup(t);await d.ready;await d.loadReddit();await new Promise(r=>setImmediate(r));const feed=d.feed,native=feed.querySelector('shreddit-post'),card=d.nodes.get('abc12'),generation=d.generation,slot=W.document.createElement('div');slot.className='virtualized-placeholder';feed.replaceChild(slot,native);d.trackVirtualization([{target:feed,addedNodes:[slot],removedNodes:[native]}]);d.activityMenu.querySelector('[data-rt-activity-filter="deleted"]').click();W.history.pushState({},'','/r/example/comments/abc12/title/');d.scan();assert.equal(d.profileOverlay,true);
 W.history.pushState({},'','/user/Example/submitted/');d.scan();assert.equal(d.profileOverlay,false);assert.equal(d.feed,feed);assert.equal(d.nodes.get('abc12'),card);assert.equal(d.generation,generation);assert.equal(d.activityFilter,'deleted');assert.equal(d.virtualNodes.get(slot),native);
});
test('post transitions never delay discovery opt-out or accept a late outgoing profile read',async t=>{
 let finish;const {W,d}=setup(t,{reddit:()=>new Promise(r=>finish=r)});await d.ready;const pending=d.loadReddit(),feed=d.feed;W.history.pushState({},'','/r/example/comments/abc12/title/');d.scan();assert.equal(d.profileOverlay,true);
 const detail=W.document.createElement('shreddit-post');detail.id='t3_abc12';feed.replaceWith(detail);d.scan();finish({posts:[raw('late')],hasMore:false});await pending;assert.equal(d.context.kind,'post');assert.equal(d.nodes.size,0);
 W.history.pushState({},'','/user/Example/submitted/');const newFeed=W.document.createElement('shreddit-feed');detail.replaceWith(newFeed);d.scan();W.history.pushState({},'','/r/example/comments/abc12/title/');d.scan();assert.equal(d.profileOverlay,true);d.onSettings({'rt-settings-v1':{newValue:{postDiscovery:false}}},'local');assert.equal(d.host,null);assert.equal(d.profileOverlay,false);assert.equal(W.document.querySelector('[data-rt-ui]'),null);
});
test('native Posts stay enriched until Reddit replaces the outgoing feed during a Comments transition',async t=>{
 const {W,d,calls}=setup(t,{settings:{archiveDiscovery:true},reddit:async input=>input.action==='status'?{statuses:[{fullname:'t3_old12',status:'deleted'}],unknownIds:[]}:{posts:[raw('found')],hasMore:false}});await d.ready;const tabs=nativeProfileTabs(W);await d.loadReddit();await d.loadArchive();await new Promise(r=>setImmediate(r));const feed=d.feed,host=d.host,ready=d.nodes.get('found'),archived=d.nodes.get('old12'),body=ready.querySelector('shreddit-post'),generation=d.generation;d.activityMenu.querySelector('[data-rt-activity-filter="hidden"]').click();const before=calls.length;
 tabs.lastElementChild.setAttribute('faceplate-tab-selected','');tabs.firstElementChild.removeAttribute('faceplate-tab-selected');W.history.pushState({},'','/user/Example/comments/');for(let i=0;i<4;i++)d.scan();assert.equal(d.feed,feed);assert.equal(d.host,host);assert.equal(d.context.view,'posts');assert.equal(d.generation,generation);assert.equal(ready.querySelector('shreddit-post'),body);assert.equal(ready.parentElement,feed);assert.equal(archived.parentElement,feed);assert.equal(feed.dataset.rtActivity,'hidden');assert.equal(calls.length,before);
 const incoming=W.document.createElement('shreddit-feed');incoming.innerHTML='<shreddit-profile-comment comment-id="t1_incoming"></shreddit-profile-comment>';feed.replaceWith(incoming);d.scan();assert.equal(d.context.view,'comments');assert.equal(d.feed,incoming);assert.notEqual(d.generation,generation);assert.equal(d.nodes.size,0);assert.notEqual(d.host,host);assert.equal(host.isConnected,false,'the outgoing header leaves with its feed');assert.equal(incoming.querySelector('shreddit-post'),null);assert.ok(parkedState(d,'profile:example:posts:new:all:'));
});
test('an aborted native tab switch keeps the same ready cards and original filter',async t=>{
 const {W,d}=setup(t);await d.ready;nativeProfileTabs(W);await d.loadReddit();await new Promise(r=>setImmediate(r));const card=d.nodes.get('abc12'),body=card.firstElementChild,generation=d.generation;d.activityMenu.querySelector('[data-rt-activity-filter="deleted"]').click();W.history.pushState({},'','/user/Example/comments/');d.scan();assert.equal(d.profileTransition,true);W.history.pushState({},'','/user/Example/submitted/');d.scan();assert.equal(d.context.view,'posts');assert.equal(d.profileTransition,false);assert.equal(d.nodes.get('abc12'),card);assert.equal(card.firstElementChild,body);assert.equal(d.generation,generation);assert.equal(d.activityFilter,'deleted');
});
test('an in-place native feed replacement finishes the handoff when outgoing native objects disappear',async t=>{
 const {W,d}=setup(t);await d.ready;nativeProfileTabs(W);await d.loadReddit();await new Promise(r=>setImmediate(r));const feed=d.feed,generation=d.generation;W.history.pushState({},'','/user/Example/comments/');d.scan();assert.equal(d.context.view,'posts');feed.replaceChildren();const row=W.document.createElement('article');row.innerHTML='<shreddit-profile-comment comment-id="t1_new"></shreddit-profile-comment>';feed.append(row);await new Promise(r=>setImmediate(r));assert.equal(d.context.view,'comments');assert.equal(d.feed,feed);assert.equal(d.generation,generation+1);assert.equal(d.nodes.size,0);
});
test('a pending native Comments-to-Overview transition preserves comments including virtualized originals',async t=>{
 const {W,d}=setup(t,{url:'https://www.reddit.com/user/Example/comments/',reddit:async()=>({posts:[comment()],hasMore:false})});await d.ready;nativeProfileTabs(W);d.feed.querySelector('shreddit-post').replaceWith(Object.assign(W.document.createElement('shreddit-profile-comment'),{}));const native=d.feed.querySelector('shreddit-profile-comment');native.setAttribute('comment-id','t1_native');await d.loadReddit();await new Promise(r=>setImmediate(r));const card=d.nodes.get(comment().fullname),slot=W.document.createElement('div');slot.className='virtualized-placeholder';d.feed.replaceChild(slot,native);d.trackVirtualization([{target:d.feed,addedNodes:[slot],removedNodes:[native]}]);W.history.pushState({},'','/user/Example/');d.scan();assert.equal(d.context.view,'comments');assert.equal(card.parentElement,d.feed);assert.equal(d.virtualNodes.get(slot),native);
});
test('opening another user waits for Reddit to swap feeds, then parks the outgoing profile with its cards',async t=>{
 const {W,d}=setup(t);await d.ready;nativeProfileTabs(W);await d.loadReddit();await new Promise(r=>setImmediate(r));const feed=d.feed,host=d.host,card=d.nodes.get('abc12'),profile=W.document.querySelector('main');
 W.history.pushState({},'','/user/Other/');d.scan();assert.equal(d.context.username,'Example','the outgoing feed is still on screen');assert.equal(card.parentElement,feed);assert.equal(feed.hasAttribute('data-rt-loading-owner'),true);
 W.document.body.innerHTML='<main id="main-content">'+nativeControls+'<shreddit-feed><shreddit-post id="t3_other"></shreddit-post></shreddit-feed></main>';d.scan();
 assert.equal(d.context.username,'Other');assert.equal(card.parentElement,feed,'parked with its feed, not torn down');assert.ok(parkedState(d,'profile:example:posts:new:all:'));
 W.history.back();await new Promise(r=>setTimeout(r,0));W.history.replaceState({},'','/user/Example/submitted/');W.document.body.replaceChildren(profile);d.scan();
 assert.equal(d.feed,feed);assert.equal(d.host,host);assert.equal(d.nodes.get('abc12'),card);assert.equal(W.document.querySelectorAll('[data-rt-ui=posts]').length,1);
});
test('an empty native profile retains extension results during tab loading but other accounts are not held',async t=>{
 const {W,d}=setup(t);await d.ready;nativeProfileTabs(W);d.feed.querySelector('shreddit-post').remove();await d.loadReddit();await new Promise(r=>setImmediate(r));const feed=d.feed,card=d.nodes.get('abc12');W.history.pushState({},'','/user/Example/comments/');d.scan();assert.equal(d.feed,feed);assert.equal(d.context.view,'posts');assert.equal(card.parentElement,feed);W.history.pushState({},'','/user/Other/comments/');d.scan();assert.equal(d.context.username,'Other');assert.notEqual(d.nodes.get('abc12'),card);
});

test('an outgoing transition does not delay opt-out and never leaks late Posts reads into Comments',async t=>{
 let finish;const {W,d}=setup(t,{reddit:()=>new Promise(r=>finish=r)});await d.ready;nativeProfileTabs(W);const pending=d.loadReddit();const outgoing=d.feed;W.history.pushState({},'','/user/Example/comments/');d.scan();assert.equal(d.context.view,'posts');const incoming=W.document.createElement('shreddit-feed');outgoing.replaceWith(incoming);d.scan();finish({posts:[raw('late')],hasMore:false});await pending;assert.equal(d.context.view,'comments');assert.equal(d.nodes.size,0);assert.equal(incoming.querySelector('shreddit-post'),null);
 W.history.pushState({},'','/user/Example/submitted/');d.scan();assert.equal(d.profileTransition,true);d.onSettings({'rt-settings-v1':{newValue:{postDiscovery:false}}},'local');assert.equal(d.host,null);assert.equal(d.profileTransition,false);assert.equal(W.document.querySelector('[data-rt-ui]'),null);
});

test('archive status verification publishes each native pair before a slower later pair finishes',async t=>{
 let release;const checks=[];const {d}=setup(t,{settings:{archiveDiscovery:true},archive:async()=>({posts:['one','two','three','four'].map(id=>raw(id)),hasMore:false}),reddit:async input=>{if(input.action!=='status')return {posts:[]};checks.push(input.ids);if(checks.length===2)await new Promise(r=>release=r);return {statuses:input.ids.map(id=>({fullname:'t3_'+id,status:id==='one'?'deleted':'available'})),unknownIds:[],via:'native'};}});
 await d.ready;d.activityFilter='hidden';// status is checked up front only in filtered views
 d.statusBatch=2;await d.loadArchive();await new Promise(r=>setImmediate(r));assert.deepEqual(checks.map(ids=>Array.from(ids)),[['one','two'],['three','four']]);assert.equal(d.postStatuses.get('t3_one'),'deleted');assert.equal(d.postStatuses.has('t3_three'),false);assert.equal(d.metadataPending,1);release();await new Promise(r=>setImmediate(r));assert.equal(d.postStatuses.get('t3_three'),'available');assert.equal(d.metadataPending,0);
});
test('Deleted card candidates exclude verified available and unverified search results',async t=>{
 const {d}=setup(t);await d.ready;d.activityFilter='deleted';const available={...raw('live'),fullname:'t3_live',source:'reddit',status:'available'},unknown={...available,status:'unknown'},archived={...unknown,source:'arctic-shift'};
 assert.equal(d.eligibleProfilePost(available),false);assert.equal(d.eligibleProfilePost(unknown),false);assert.equal(d.eligibleProfilePost(archived),true);d.postStatuses.set('t3_live','available');assert.equal(d.eligibleProfilePost(archived),false);d.postStatuses.set('t3_live','removed');assert.equal(d.eligibleProfilePost(archived),true);
});

test('Overview paginates the shallowest source before publishing older mixed activity',async t=>{
 const requests=[],base=1700000000,post=(id,time)=>raw(id,{created_utc:base+time}),reply=(id,time)=>({...comment(),id,fullname:'t1_'+id,created_utc:base+time});
 const {d}=setup(t,{url:'https://www.reddit.com/user/Example/',reddit:async input=>{
   requests.push(input);
   if(input.kind==='post')return input.after?{posts:[post('p80',80)],hasMore:false}:{posts:[post('p300',300),post('p100',100)],after:'posts-next',hasMore:true};
   if(!input.after)return {posts:[reply('c250',250),reply('c240',240)],after:'comments-next',hasMore:true};
   if(input.after==='comments-next')return {posts:[reply('c220',220),reply('c200',200)],after:'comments-last',hasMore:true};
   return {posts:[reply('c150',150),reply('c90',90)],hasMore:false};
 }});await d.ready;
 const visible=()=>Array.from(d.feed.querySelectorAll('.rt-native-card:not([hidden])'),n=>n.dataset.fullname),tick=()=>new Promise(r=>setImmediate(r));
 await d.loadReddit();await tick();assert.deepEqual(visible(),['t3_p300','t1_c250','t1_c240']);const first=d.nodes.get('p300'),native=first.firstElementChild;
 await d.loadMore();await tick();assert.equal(requests.at(-1).after,'comments-next');assert.deepEqual(visible(),['t3_p300','t1_c250','t1_c240','t1_c220','t1_c200']);
 await d.loadMore();await tick();assert.equal(requests.at(-1).after,'comments-last');assert.deepEqual(visible(),['t3_p300','t1_c250','t1_c240','t1_c220','t1_c200','t1_c150','t3_p100']);
 await d.loadMore();await tick();assert.equal(requests.at(-1).after,'posts-next');assert.deepEqual(visible(),['t3_p300','t1_c250','t1_c240','t1_c220','t1_c200','t1_c150','t3_p100','t1_c90','t3_p80']);assert.equal(d.nodes.get('p300'),first);assert.equal(first.firstElementChild,native);assert.equal(d.loading.hidden,true);
});

test('Overview starts native hydration only after slower sources establish their first boundary',async t=>{
 let finishComments;const renders=[],{d}=setup(t,{url:'https://www.reddit.com/user/Example/',reddit:input=>input.kind==='post'?Promise.resolve({posts:[raw('older',{created_utc:1700000000})],hasMore:false}):new Promise(r=>finishComments=r),nativeRender:async(post,node)=>{renders.push(post.fullname);node.innerHTML=post.kind==='comment'?'<shreddit-profile-comment comment-id="'+post.fullname+'"></shreddit-profile-comment>':'<shreddit-post id="'+post.fullname+'"></shreddit-post>';}});
 await d.ready;const load=d.loadReddit();await new Promise(r=>setImmediate(r));assert.deepEqual(renders,[]);assert.equal(d.feed.querySelectorAll('.rt-native-card').length,0);assert.equal(d.loading.hidden,false);
 finishComments({posts:[{...comment(),created_utc:1700000001}],hasMore:false});await load;await new Promise(r=>setImmediate(r));assert.deepEqual(renders,[comment().fullname,'t3_older']);assert.deepEqual(Array.from(d.feed.querySelectorAll('.rt-native-card'),n=>n.dataset.fullname),[comment().fullname,'t3_older']);
});

test('ready active batches resume when a temporary source ordering boundary clears',async t=>{
 let finish;const {d}=setup(t,{nativeRender:async(post,node)=>{await new Promise(r=>finish=r);node.innerHTML='<shreddit-post id="'+post.fullname+'"></shreddit-post>';}});await d.ready;await d.loadReddit();d.sourcePending.add('archive-post');finish();await new Promise(r=>setImmediate(r));assert.ok(d.activeProfileBatch);assert.equal(d.feed.querySelectorAll('.rt-native-card').length,0);
 d.noteSourcePage('archive-post',[],false);d.sourcePending.delete('archive-post');d.render();assert.equal(d.activeProfileBatch,null);assert.equal(d.nodes.get('abc12').hidden,false);
});

test('Deleted exhaustion ignores unrelated live continuation and shows an empty state without another search',async t=>{
 const {d,calls}=setup(t,{settings:{archiveDiscovery:true},reddit:async input=>input.action==='profile'?{posts:[],after:'live-next',hasMore:true}:{statuses:[]},archive:async()=>({posts:[],hasMore:false})});await d.ready;await d.loadReddit();d.activityMenu.querySelector('[data-rt-activity-filter="deleted"]').click();await new Promise(r=>setImmediate(r));assert.equal(d.moreReddit,true);assert.equal(d.moreArchive,false);assert.equal(d.loading.hidden,true);assert.equal(d.activityEmpty.hidden,false);const count=calls.length;await d.loadMore();assert.equal(calls.length,count);
});

test('Deleted switches discard unrelated queued live cards while retaining their saved content',async t=>{
 const releases=[],rendered=[],{d}=setup(t,{settings:{archiveDiscovery:true},reddit:async()=>({posts:Array.from({length:6},(_,i)=>raw('live'+i,{created_utc:1700000000-i})),hasMore:false}),archive:async()=>({posts:[],hasMore:false}),nativeRender:async(post,node)=>{rendered.push(post.id);await new Promise(r=>releases.push(r));node.innerHTML='<shreddit-post id="'+post.fullname+'"></shreddit-post>';}});await d.ready;await d.loadReddit();await new Promise(r=>setImmediate(r));assert.equal(d.nativeBatch.queue.length,4);d.activityMenu.querySelector('[data-rt-activity-filter="deleted"]').click();await new Promise(r=>setImmediate(r));assert.equal(d.nativeBatch.queue.length,0);assert.equal(d.live.size,6);releases.splice(0).forEach(r=>r());await new Promise(r=>setImmediate(r));assert.equal(rendered.length,2);assert.equal(d.activeProfileBatch,null);assert.equal(d.loading.hidden,true);
});

test('archive Overview continuation advances its shallowest chronological stream first',async t=>{
 const requests=[],{W,d}=setup(t,{url:'https://www.reddit.com/user/Example/',settings:{archiveDiscovery:true},archive:async input=>{requests.push(input);return input.kind==='post'?{posts:[raw('older',{created_utc:1700000100})],before:1700000100,hasMore:true}:{posts:[{...comment(),created_utc:1700000200}],before:1700000200,hasMore:true};}});await d.ready;d.reset();deletedPage(W);d.scan();await d.loadArchive();await new Promise(r=>setImmediate(r));assert.equal(d.nodes.get('older').hidden,true);await d.loadMore();assert.equal(requests.length,3);assert.equal(requests.at(-1).kind,'comment');
});

test('Top archive pages do not use a false score continuation boundary',async t=>{
 const {W,d}=setup(t,{url:'https://www.reddit.com/user/Example/?sort=top',settings:{archiveDiscovery:true},archive:async input=>({posts:input.kind==='post'?[raw('low',{score:1})]:[{...comment(),score:200}],before:1699999999,hasMore:true})});await d.ready;d.reset();deletedPage(W);d.scan();await d.loadArchive();await new Promise(r=>setImmediate(r));assert.equal(d.publicationFloor(),-Infinity);assert.equal(d.nodes.get('low').hidden,false);assert.equal(d.nodes.get(comment().fullname).hidden,false);
});

test('scroll anchoring compensates inserted content without overriding a user scroll',async t=>{
 const {W,d}=setup(t);await d.ready;await d.loadReddit();await new Promise(r=>setImmediate(r));const node=d.nodes.get('abc12'),moves=[];Object.defineProperty(W,'scrollY',{value:500,writable:true});node.getBoundingClientRect=()=>({top:80,bottom:280,height:200});W.scrollBy=options=>moves.push(options.top);const anchor=d.captureFeedViewport();assert.equal(anchor.node,node);node.getBoundingClientRect=()=>({top:180,bottom:380,height:200});d.restoreFeedViewport(anchor);assert.deepEqual(moves,[100]);W.scrollY=550;d.restoreFeedViewport(anchor);assert.deepEqual(moves,[100]);node.hidden=true;W.scrollY=500;d.restoreFeedViewport(anchor);assert.deepEqual(moves,[100]);
});

test('empty signed-in cursor pages cannot block public discoveries alongside native profile cards',async t=>{
 for(const view of ['comments/','']){
  const hidden={...comment(),id:'publichidden',fullname:'t1_publichidden',created_utc:1700000300,subreddit:'hiddencommunity'};
  const {W,d}=setup(t,{url:'https://www.reddit.com/user/Example/'+view,reddit:async input=>({posts:input.kind==='post'?[raw('native',{created_utc:1700000200})]:[],after:input.kind==='comment'?'empty-signed-in-next':null,hasMore:input.kind==='comment'}),publicReddit:async()=>({posts:[hidden],after:'public-next',hasMore:true})});await d.ready;
  d.feed.querySelector('shreddit-post').setAttribute('created-timestamp',new Date(1700000200*1000).toISOString());const pager=W.document.createElement('faceplate-partial');pager.slot='load-after';pager.setAttribute('loading','programmatic');pager.setAttribute('src','/svc/shreddit/profiles/profile_comments-more-posts/new/?after=native-next');d.feed.append(pager);
  await d.loadReddit();await new Promise(r=>setImmediate(r));const card=d.nodes.get(hidden.fullname);assert.equal(card.hidden,false);assert.equal(card.parentElement,d.feed);assert.equal(card.nextElementSibling,d.feed.querySelector('shreddit-post'));assert.equal(d.redMore.comment,true,'an empty page is still pageable, never falsely complete');assert.equal(d.afterByKind.comment,'empty-signed-in-next');assert.equal(d.sourceFrontiers.get('comment').floor,-Infinity);assert.equal(d.status.dataset.error,'false');
 }
});

test('initial automatic discovery primes one cursor round before the native feed tail is nearby',async t=>{
 const requests=[];let finish;const {W,d}=setup(t,{reddit:input=>{requests.push(input);return input.after?new Promise(r=>finish=r):Promise.resolve({posts:Array.from({length:7},(_,i)=>raw('first'+i,{created_utc:1700000200-i})),after:'next-page',hasMore:true});}});await d.ready;d.reset();W.IntersectionObserver=class{observe(){}disconnect(){}};d.scan();d.autoDiscover=true;d.loading.getBoundingClientRect=()=>({top:10000,bottom:10192});await d.loadReddit();await new Promise(r=>setImmediate(r));assert.equal(requests.length,2);assert.equal(requests[1].after,'next-page');assert.equal(d.initialPrefetchDone,true);
 finish({posts:Array.from({length:7},(_,i)=>raw('second'+i,{created_utc:1700000100-i})),after:'next-again',hasMore:true});await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));for(let i=0;i<5;i++)d.updateProfileLoading();assert.equal(requests.length,2,'initial look-ahead cannot walk the whole history');assert.equal(d.nodes.size,14);assert.ok(d.publishedCards.has('first0'));
});

test('predictive continuation works between completed batches and stops when the tail moves away',async t=>{
 let observer,finish;const requests=[],{W,d}=setup(t,{reddit:input=>{requests.push(input);return input.after?new Promise(r=>finish=r):Promise.resolve({posts:[raw('first')],after:'next-page',hasMore:true});}});await d.ready;d.reset();W.IntersectionObserver=class{constructor(callback){observer=callback;}observe(){}disconnect(){}};d.scan();d.loading.getBoundingClientRect=()=>({top:10000,bottom:10192});await d.loadReddit();await new Promise(r=>setImmediate(r));assert.equal(d.activeProfileBatch,null);assert.equal(requests.length,1);
 d.loading.getBoundingClientRect=()=>({top:W.innerHeight*2,bottom:W.innerHeight*2+192});observer([{target:d.loading,isIntersecting:true}]);await new Promise(r=>setImmediate(r));assert.equal(requests.length,2,'prefetch must not require an active hydration batch');d.loading.getBoundingClientRect=()=>({top:10000,bottom:10192});observer([{target:d.loading,isIntersecting:false}]);finish({posts:[raw('second',{created_utc:1699999900})],after:'next-again',hasMore:true});await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));assert.equal(requests.length,2);assert.equal(d.nodes.get('first').dataset.rtNativeState,'ready');
});

test('one timed-out discovery read retries the same continuation without discarding populated cards',async t=>{
 let failed=false;const {d,calls}=setup(t,{reddit:async input=>{if(!input.after)return {posts:[raw('first')],after:'same-cursor',hasMore:true};if(!failed){failed=true;throw Error('Reddit request timed out. Try again.');}return {posts:[raw('second',{created_utc:1699999900})],hasMore:false};}});await d.ready;await d.loadReddit();await new Promise(r=>setImmediate(r));const card=d.nodes.get('first'),native=card.firstElementChild;await d.loadMore();await new Promise(r=>setImmediate(r));assert.deepEqual(calls.filter(c=>c.action==='profile').map(c=>c.after),[undefined,'same-cursor','same-cursor']);assert.equal(d.nodes.get('first'),card);assert.equal(card.firstElementChild,native);assert.equal(d.nodes.get('second').hidden,false);assert.equal(d.status.dataset.error,'false');
});

test('timeout recovery is bounded and does not retry rate limits or changed pages',async t=>{
 // Immediate in-request retries stay bounded; transient failures then wait for a scheduled backoff retry instead of an error.
 for(const [message,count,transient]of [['Reddit request timed out. Try again.',2,true],['Reddit rate limit reached. Try again later.',1,true],['Reddit returned an unrecognized comment search response.',1,false]]){const {d,calls}=setup(t,{reddit:async()=>{throw Error(message);}});await d.ready;await d.loadReddit();assert.equal(calls.length,count);assert.equal(d.status.dataset.error,String(!transient));if(transient){assert.equal(d.sourceRetries.get('post').attempts,1);assert.match(d.sourceRetries.get('post').note,/Retrying in/);d.clearSourceRetries();}else assert.match(d.status.textContent,/unrecognized/);}
 const {W,d,calls}=setup(t,{reddit:async()=>{W.history.pushState({},'','/user/Other/submitted/');d.scan();throw Error('Reddit request timed out. Try again.');}});await d.ready;await d.loadReddit();assert.equal(calls.filter(c=>c.action==='profile').length,1);assert.equal(d.context.username,'Other');assert.equal(d.nodes.size,0);
});

test('a transient unrecognized continuation retries its cursor without pausing retained results',async t=>{
 let failures=0;const requests=[],{d}=setup(t,{url:'https://www.reddit.com/user/Example/comments/',reddit:async()=>({posts:[],hasMore:false}),publicReddit:async input=>{requests.push(input.after);if(!input.after)return {posts:[comment()],after:'public-next',hasMore:true};if(!failures++)throw Error('Reddit returned an unrecognized comment search response.');return {posts:[{...comment(),id:'next',fullname:'t1_next',created_utc:1699999900}],hasMore:false};}});await d.ready;await d.loadReddit();await new Promise(r=>setImmediate(r));const first=d.nodes.get(comment().fullname),content=first.firstElementChild;await d.loadMore();await new Promise(r=>setImmediate(r));assert.deepEqual(requests,[undefined,'public-next','public-next']);assert.equal(d.nodes.get(comment().fullname),first);assert.equal(first.firstElementChild,content);assert.equal(d.nodes.get('t1_next').hidden,false);assert.equal(d.batchAutoPaused,false);assert.equal(d.status.dataset.error,'false');assert.equal(d.loading.querySelector('[data-rt-continuation-note]'),null);
});

test('Retry loading resumes only the failed source at its retained continuation',async t=>{
 let failing=true;const requests=[],{d}=setup(t,{url:'https://www.reddit.com/user/Example/',reddit:async input=>{requests.push({key:input.kind,after:input.after});return {posts:[],hasMore:false};},publicReddit:async input=>{requests.push({key:'public',after:input.after});if(!input.after)return {posts:[comment()],after:'saved-public-cursor',hasMore:true};if(failing)throw Error('Reddit returned an unrecognized comment search response.');return {posts:[{...comment(),id:'recovered',fullname:'t1_recovered',created_utc:1699999900}],hasMore:false};}});await d.ready;await d.loadReddit();await d.loadMore();await new Promise(r=>setImmediate(r));assert.equal(requests.filter(r=>r.after==='saved-public-cursor').length,2,'automatic recovery is bounded');assert.equal(d.batchAutoPaused,true);assert.equal(d.redMore['comment-public'],false);assert.ok(d.sourceErrors['comment-public']);const first=d.nodes.get(comment().fullname),pages=d.pages;assert.match(d.loading.querySelector('[data-rt-continuation-note]').textContent,/Existing results are kept/);
 failing=false;d.loading.querySelector('[data-rt-continuation-note] button').click();await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));assert.equal(requests.filter(r=>r.key==='post').length,1);assert.equal(requests.filter(r=>r.key==='comment').length,1);assert.equal(requests.filter(r=>r.key==='public' && !r.after).length,1,'retry does not restart at the newest page');assert.equal(requests.at(-1).after,'saved-public-cursor');assert.equal(d.nodes.get(comment().fullname),first);assert.equal(d.pages,pages+1);assert.equal(d.sourceErrors['comment-public'],undefined);assert.equal(d.batchAutoPaused,false);assert.equal(d.loading.querySelector('[data-rt-continuation-note]'),null);assert.equal(d.nodes.get('t1_recovered').hidden,false);
});

test('retrying a Hot continuation preserves the loaded ranking instead of refreshing it',async t=>{
 let failing=true;const {d}=setup(t,{url:'https://www.reddit.com/user/Example/submitted/?sort=hot',reddit:async input=>{if(!input.after)return {posts:[raw('first')],after:'hot-next',hasMore:true};if(failing)throw Error('Reddit returned an unrecognized post search response.');return {posts:[raw('second',{created_utc:1699999900})],hasMore:false};}});await d.ready;await d.loadReddit();await d.loadMore();assert.equal(d.batchAutoPaused,true);failing=false;await d.loadReddit({retry:true});assert.deepEqual([...d.live.keys()],['first','second']);assert.equal(d.batchAutoPaused,false);
});

test('retrying a failed first page leaves completed overview sources alone',async t=>{
 let failing=true;const {d,calls}=setup(t,{url:'https://www.reddit.com/user/Example/',reddit:async input=>{if(input.kind==='post'){if(failing)throw Error('Reddit returned an unrecognized post search response.');return {posts:[raw()],hasMore:false};}return {posts:[comment()],hasMore:false};}});await d.ready;await d.loadReddit();assert.equal(d.batchAutoPaused,true);const card=d.nodes.get(comment().fullname);failing=false;await d.loadReddit({retry:true});assert.deepEqual(calls.filter(c=>c.action==='profile').map(c=>[c.kind,c.stream,c.after]),[['post',undefined,undefined],['comment','authenticated',undefined],['comment','public',undefined],['post',undefined,undefined]]);assert.equal(d.nodes.get(comment().fullname),card);assert.equal(d.batchAutoPaused,false);assert.equal(d.sourceErrors.post,undefined);
});

test('continuation recovery excludes rate limits and cancels during its retry delay',async t=>{
 for(const message of ['Reddit rate limit reached. Try again later.','Reddit’s comment format changed. Comments could not be read.']){let attempts=0;const {d}=setup(t,{reddit:async input=>{if(!input.after)return {posts:[raw()],after:'next',hasMore:true};attempts++;throw Error(message);}});await d.ready;await d.loadReddit();await d.loadMore();assert.equal(attempts,1);const limited=/rate limit/.test(message);assert.equal(d.status.dataset.error,String(!limited));assert.equal(d.sourceRetries.has('post'),limited);d.clearSourceRetries();}
 let failed;const failure=new Promise(r=>failed=r),{W,d,calls}=setup(t,{reddit:async input=>{if(!input.after)return {posts:[raw()],after:'next',hasMore:true};failed();throw Error('Reddit returned an unrecognized post search response.');}});await d.ready;await d.loadReddit();const loading=d.loadMore();await failure;await Promise.resolve();W.history.pushState({},'','/user/Other/submitted/');d.scan();await loading;assert.equal(calls.filter(c=>c.after==='next').length,1);assert.equal(d.context.username,'Other');assert.equal(d.nodes.size,0);
});

test('archive-only automatic profiles also prime one bounded extra page',async t=>{
 const requests=[];let finish;const {W,d}=setup(t,{settings:{archiveDiscovery:true},archive:input=>{requests.push(input);return input.before?new Promise(r=>finish=r):Promise.resolve({posts:[raw('first')],before:1700000000,hasMore:true});}});await d.ready;d.reset();deletedPage(W);W.IntersectionObserver=class{observe(){}disconnect(){}};d.scan();d.autoDiscover=true;d.loading.getBoundingClientRect=()=>({top:10000,bottom:10192});await d.loadArchive();await new Promise(r=>setImmediate(r));assert.equal(requests.length,2);assert.equal(requests[1].before,1700000000);finish({posts:[raw('second',{created_utc:1699999900})],before:1699999900,hasMore:true});await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));assert.equal(requests.length,2);assert.equal(d.nodes.size,2);
});

test('older native-horizon deferrals cannot strand a newer discovery behind another source boundary',async t=>{
 const c=(id,time)=>({...comment(),id,fullname:'t1_'+id,created_utc:time});const {W,d,calls}=setup(t,{url:'https://www.reddit.com/user/Example/',reddit:async input=>input.kind==='post'?{posts:[raw('inside',{created_utc:1700000300}),raw('older',{created_utc:1700000100})],after:'post-next',hasMore:true}:input.after?{posts:[c('hidden',1700000250)],hasMore:false}:{posts:[c('nativecomment',1700000400)],after:'comment-next',hasMore:true}});await d.ready;d.feed.querySelector('shreddit-post').setAttribute('created-timestamp',new Date(1700000200*1000).toISOString());const native=W.document.createElement('shreddit-profile-comment');native.setAttribute('comment-id','t1_nativecomment');native.setAttribute('created-timestamp',new Date(1700000400*1000).toISOString());d.feed.prepend(native);const pager=W.document.createElement('faceplate-partial');pager.slot='load-after';pager.setAttribute('loading','programmatic');pager.setAttribute('src','/svc/shreddit/profiles/profile_overview-more-posts/new/?after=native-next');d.feed.append(pager);await d.loadReddit();assert.equal(d.nodes.get('inside').hidden,true);assert.equal(d.nodes.get('older').dataset.deferred,'older');d.advanceProfileBatch(true);await new Promise(r=>setImmediate(r));assert.equal(calls.filter(c=>c.action==='profile').at(-1).after,'comment-next');assert.equal(d.nodes.get('inside').hidden,false);assert.equal(d.nodes.get('t1_hidden').hidden,false);assert.equal(d.nodes.get('older').hidden,true);assert.equal(d.nodes.get('older').dataset.deferred,'older');
});

test('a transient native comment timeout recovers automatically without publishing a Retry row',async t=>{
 let attempts=0;const {d}=setup(t,{url:'https://www.reddit.com/user/Example/comments/',reddit:async()=>({posts:[comment()],hasMore:false}),nativeRender:async(post,node)=>{if(++attempts===1)throw Error('Native card loading timed out.');node.innerHTML='<shreddit-profile-comment comment-id="'+post.fullname+'"><p class="md">Recovered native comment</p></shreddit-profile-comment>';}});await d.ready;await d.loadReddit();await new Promise(r=>setImmediate(r));assert.equal(attempts,2);assert.equal(d.nodes.get(comment().fullname).dataset.rtNativeState,'ready');assert.equal(d.feed.querySelector('.rt-native-unavailable'),null);assert.match(d.feed.textContent,/Recovered native comment/);assert.equal(d.loading.hidden,true);
});

test('native retry is bounded, preserves its card identity and can be restarted manually',async t=>{
 let attempts=0,fail=true;const {d}=setup(t,{nativeRender:async(post,node)=>{attempts++;if(fail)throw Error('Native card loading timed out.');node.innerHTML='<shreddit-post id="'+post.fullname+'"></shreddit-post>';}});await d.ready;await d.loadReddit();await new Promise(r=>setImmediate(r));const node=d.nodes.get('abc12');assert.equal(attempts,2);assert.equal(node.dataset.rtNativeState,'failed');assert.match(node.querySelector('button').title,/timed out/);fail=false;node.querySelector('button').click();await new Promise(r=>setImmediate(r));assert.equal(attempts,3);assert.equal(d.nodes.get('abc12'),node);assert.equal(node.dataset.rtNativeState,'ready');assert.equal(node.querySelector('.rt-native-unavailable'),null);
});

test('definitive native errors do not enter automatic retry loops',async t=>{
 for(const error of ['Reddit could not render this card (HTTP 404).','Reddit returned no matching native card.','Reddit asked us to wait. Try again shortly.']){let attempts=0;const {d}=setup(t,{nativeRender:async()=>{attempts++;throw Error(error);}});await d.ready;await d.loadReddit();await new Promise(r=>setImmediate(r));assert.equal(attempts,1);assert.equal(d.nodes.get('abc12').dataset.rtNativeState,'failed');}
});

test('four concurrent comment hydrations keep publication ordered and their work bounded',async t=>{
 const pending=[],started=[],base=1700000000;let active=0,maximum=0;const {d}=setup(t,{url:'https://www.reddit.com/user/Example/comments/',reddit:async()=>({posts:Array.from({length:8},(_,i)=>({...comment(),id:'parallel'+i,fullname:'t1_parallel'+i,created_utc:base-i})),hasMore:false}),nativeRender:async(post,node)=>{active++;maximum=Math.max(maximum,active);started.push(post.id);await new Promise(r=>pending.push({id:post.id,finish:r}));active--;node.innerHTML='<shreddit-profile-comment comment-id="'+post.fullname+'"></shreddit-profile-comment>';}});await d.ready;await d.loadReddit();await new Promise(r=>setImmediate(r));assert.equal(started.length,4);assert.equal(maximum,4);const first=pending.shift();pending.splice(0).reverse().forEach(p=>p.finish());await new Promise(r=>setImmediate(r));assert.equal(started.length,7);assert.equal(d.feed.querySelectorAll('.rt-native-card').length,0,'later native completions must stay behind the first comment');first.finish();await new Promise(r=>setImmediate(r));assert.deepEqual(Array.from(d.feed.querySelectorAll('.rt-native-card'),n=>n.dataset.fullname),['t1_parallel0','t1_parallel1','t1_parallel2','t1_parallel3']);for(let i=0;i<3;i++){pending.splice(0).forEach(p=>p.finish());await new Promise(r=>setImmediate(r));}assert.equal(maximum,4);assert.equal(started.length,8);assert.equal(d.feed.querySelectorAll('.rt-native-card').length,8);assert.equal(d.loading.hidden,true);
});

test('mixed native comment pages wait for the covered and hydrated combined prefix before appearing',async t=>{
 let finishSearch,finishCard;const base=1700000000,c=(id,offset)=>({...comment(),id,fullname:'t1_'+id,created_utc:base+offset});
 const {W,d}=setup(t,{url:'https://www.reddit.com/user/Example/comments/',reddit:async()=>({posts:[],hasMore:false}),publicReddit:()=>new Promise(r=>finishSearch=r),nativeRender:async(post,node)=>{await new Promise(r=>finishCard=r);node.innerHTML='<shreddit-profile-comment comment-id="'+post.fullname+'"><div><span class="text-12 relative"></span></div></shreddit-profile-comment>';}});await d.ready;
 const native=d.feed.firstElementChild;native.setAttribute('created-timestamp',new Date((base+300)*1000).toISOString());
 const load=d.loadReddit();await new Promise(r=>setImmediate(r));assert.equal(native.hasAttribute('data-rt-order-pending'),false,'cards Reddit already painted are never pulled back behind the gate');
 finishSearch({posts:[c('hidden',200)],after:'public-next',hasMore:true});await load;await new Promise(r=>setImmediate(r));assert.equal(native.hasAttribute('data-rt-order-pending'),false);
 const next=W.document.createElement('shreddit-profile-comment');next.setAttribute('comment-id','t1_nativeolder');next.setAttribute('created-timestamp',new Date((base+100)*1000).toISOString());d.feed.insertBefore(next,d.loading);await new Promise(r=>setImmediate(r));
 assert.equal(next.hasAttribute('data-rt-order-pending'),true,'a new native page is gated in its mutation microtask');assert.equal(d.feed.hasAttribute('data-rt-merge-waiting'),true);assert.equal(d.loading.hidden,false);
 finishCard();await new Promise(r=>setImmediate(r));assert.equal(d.nodes.get('t1_hidden').hidden,false);assert.equal(next.hasAttribute('data-rt-order-pending'),true,'source continuation still has newer undiscovered dates');
 d.reddit=async()=>({posts:[],hasMore:false});await d.loadMore();await new Promise(r=>setImmediate(r));
 assert.equal(next.hasAttribute('data-rt-order-pending'),false);assert.equal(d.feed.hasAttribute('data-rt-merge-waiting'),false);assert.equal(d.nodes.get('t1_hidden').nextElementSibling,next);assert.equal(d.feed.firstElementChild,native);assert.equal(d.loading.hidden,true);
});

test('the combined prefix continues searching while native cards and their next pager wait',async t=>{
 let intersect,finish,finishCard;const requests=[],base=1700000000;
 const {W,d}=setup(t,{url:'https://www.reddit.com/user/Example/comments/',reddit:async()=>({posts:[],hasMore:false}),publicReddit:input=>{requests.push(input);return input.after?new Promise(r=>finish=r):Promise.resolve({posts:Array.from({length:25},(_,i)=>({...comment(),id:'hidden'+i,fullname:'t1_hidden'+i,created_utc:base+100-i})),after:'public-next',hasMore:true});},nativeRender:async(post,node)=>{if(post.id==='nexthidden')await new Promise(r=>finishCard=r);node.innerHTML='<shreddit-profile-comment comment-id="'+post.fullname+'"><div><span class="text-12 relative"></span></div></shreddit-profile-comment>';}});await d.ready;d.reset();W.IntersectionObserver=class{constructor(callback){intersect=callback;}observe(){}disconnect(){}};d.scan();
 const native=d.feed.firstElementChild;arrivedLater(d);native.setAttribute('created-timestamp',new Date((base-100)*1000).toISOString());const pager=W.document.createElement('faceplate-partial');pager.slot='load-after';pager.setAttribute('loading','programmatic');pager.setAttribute('src','/svc/shreddit/profiles/profile_comments-more-posts/new/?after=native-next');pager.innerHTML='<shreddit-feed-page-loading></shreddit-feed-page-loading>';d.feed.append(pager);
 const style=W.document.createElement('style');style.textContent=fs.readFileSync('extension/post-discovery.css','utf8');W.document.head.append(style);d.loading.getBoundingClientRect=()=>({top:10000,bottom:10192});await d.loadReddit();await new Promise(r=>setImmediate(r));assert.equal(d.publishedCards.size,25);assert.equal(requests.length,1);assert.equal(native.hasAttribute('data-rt-order-pending'),true);assert.equal(d.nativeFeedLoading(),false,'only the combined tail owns the halo while native pagination waits');assert.equal(W.getComputedStyle(native).display,'none');assert.equal(W.getComputedStyle(pager).display,'none');assert.notEqual(W.getComputedStyle(d.loading.querySelector('.rt-native-loading')).display,'none','the shared native halo remains visible');
 d.loading.getBoundingClientRect=()=>({top:W.innerHeight*2,bottom:W.innerHeight*2+192});intersect([{target:d.loading,isIntersecting:true}]);await new Promise(r=>setImmediate(r));assert.equal(requests.length,2);assert.equal(requests[1].after,'public-next');
 d.loading.getBoundingClientRect=()=>({top:10000,bottom:10192});intersect([{target:d.loading,isIntersecting:false}]);finish({posts:[{...comment(),id:'nexthidden',fullname:'t1_nexthidden',created_utc:base+50}],hasMore:false});await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));assert.equal(native.hasAttribute('data-rt-order-pending'),true,'waiting hydration must not reveal the older native page');
 d.loading.getBoundingClientRect=()=>({top:W.innerHeight*2,bottom:W.innerHeight*2+192});intersect([{target:d.loading,isIntersecting:true}]);await new Promise(r=>setImmediate(r));finishCard();await new Promise(r=>setImmediate(r));assert.equal(d.publishedCards.size,26);assert.equal(native.hasAttribute('data-rt-order-pending'),false);assert.equal(d.nodes.get('t1_nexthidden').nextElementSibling,native);assert.equal(d.nativeFeedLoading(),true);assert.equal(requests.length,2);assert.equal(pager.parentElement,d.feed);
});

test('native merge gates survive virtualization and are removed by filtering or opt-out',async t=>{
 const {W,d}=setup(t,{reddit:async()=>({posts:[raw('hidden',{created_utc:1700000300})],after:'next',hasMore:true})});await d.ready;const native=d.feed.firstElementChild;arrivedLater(d);native.setAttribute('created-timestamp',new Date(1700000200*1000).toISOString());await d.loadReddit();await new Promise(r=>setImmediate(r));assert.equal(native.hasAttribute('data-rt-order-pending'),true);
 const slot=W.document.createElement('div');slot.className='virtualized-placeholder';d.feed.replaceChild(slot,native);await new Promise(r=>setImmediate(r));assert.equal(slot.hasAttribute('data-rt-order-pending'),true);assert.equal(d.virtualNodes.get(slot),native);
 d.feed.replaceChild(native,slot);await new Promise(r=>setImmediate(r));assert.equal(slot.hasAttribute('data-rt-order-pending'),false);assert.equal(d.mergePendingNodes.has(slot),false);assert.equal(native.hasAttribute('data-rt-order-pending'),true);
 d.activityFilter='hidden';d.deduplicate();assert.equal(native.hasAttribute('data-rt-order-pending'),false);assert.equal(native.hidden,true);d.activityFilter='all';d.deduplicate();assert.equal(native.hasAttribute('data-rt-order-pending'),true);
 d.onSettings({'rt-settings-v1':{newValue:{postDiscovery:false}}},'local');assert.equal(native.hasAttribute('data-rt-order-pending'),false);assert.equal(native.hidden,false);assert.equal(native.parentElement,W.document.querySelector('shreddit-feed'));assert.equal(native.parentElement.hasAttribute('data-rt-merge-waiting'),false);
});

test('native pager detection ignores continuation markers embedded inside cards',async t=>{
 const {W,d}=setup(t);await d.ready;await d.loadReddit();await new Promise(r=>setImmediate(r));
 const pager=()=>{const node=W.document.createElement('faceplate-partial');node.slot='load-after';node.setAttribute('loading','programmatic');node.setAttribute('src','/svc/shreddit/profiles/profile_posts-more-posts/new/?after=next');return node;};
 d.feed.firstElementChild.append(pager());d.nodes.get('abc12').append(pager());assert.equal(d.nativeContinuation(),null);
 const next=pager();d.feed.insertBefore(next,d.loading);assert.equal(d.nativeContinuation(),next);
});

test('failed automatic discovery releases retained native cards with a retryable status',async t=>{
 const {d}=setup(t,{reddit:async()=>{throw Error('Reddit returned an unrecognized profile response.');}});await d.ready;const native=d.feed.firstElementChild;arrivedLater(d);native.setAttribute('created-timestamp',new Date(1700000000*1000).toISOString());d.autoDiscover=true;d.deduplicate();assert.equal(native.hasAttribute('data-rt-order-pending'),true);
 await d.loadReddit();await new Promise(r=>setImmediate(r));assert.equal(native.hasAttribute('data-rt-order-pending'),false);assert.equal(d.feed.hasAttribute('data-rt-merge-waiting'),false);assert.equal(d.status.dataset.error,'true');assert.match(d.status.textContent,/unrecognized/);assert.equal(d.discover.disabled,false);
});

test('a full older discovery buffer cannot strand the native prefix behind a shallower source',async t=>{
 let intersect;const base=1700000000,requests=[];
 const {W,d}=setup(t,{url:'https://www.reddit.com/user/Example/',reddit:async input=>{requests.push(input);return input.kind==='post'?{posts:[raw('native',{created_utc:base+300})],after:input.after?null:'next-post',hasMore:!input.after}:{posts:Array.from({length:25},(_,i)=>({...comment(),id:'older'+i,fullname:'t1_older'+i,created_utc:base+100-i})),hasMore:false};}});await d.ready;d.reset();W.IntersectionObserver=class{constructor(callback){intersect=callback;}observe(){}disconnect(){}};d.scan();d.feed.firstElementChild.setAttribute('created-timestamp',new Date((base+300)*1000).toISOString());const older=W.document.createElement('shreddit-profile-comment');older.setAttribute('comment-id','t1_nativeolder');older.setAttribute('created-timestamp',new Date((base+200)*1000).toISOString());d.feed.insertBefore(older,d.loading);const pager=W.document.createElement('shreddit-feed-load-more-observer');pager.setAttribute('cursor','native-next');d.feed.insertBefore(pager,d.loading);
 d.loading.getBoundingClientRect=()=>({top:10000,bottom:10192});await d.loadReddit();await new Promise(r=>setImmediate(r));assert.equal(d.pendingProfilePosts().length,0);assert.equal(d.nodes.get('t1_older0').dataset.deferred,'older');assert.equal(d.feed.hasAttribute('data-rt-merge-waiting'),true);
 d.loading.getBoundingClientRect=()=>({top:W.innerHeight*2,bottom:W.innerHeight*2+192});intersect([{target:d.loading,isIntersecting:true}]);await new Promise(r=>setImmediate(r));assert.equal(requests.filter(r=>r.after==='next-post').length,1);assert.equal(d.feed.hasAttribute('data-rt-merge-waiting'),false);assert.equal(older.hasAttribute('data-rt-order-pending'),false);assert.equal(d.nodes.get('t1_older0').dataset.deferred,'older','older discoveries still wait for the next native page');
});

test('published native cards never disappear when a refresh or a deeper search begins',async t=>{
 let finish;const {W,d}=setup(t,{reddit:()=>new Promise(r=>finish=r)});await d.ready;const native=d.feed.firstElementChild;native.setAttribute('created-timestamp',new Date(1700000300*1000).toISOString());const initial=d.loadReddit();finish({posts:[raw('first',{created_utc:1700000200})],hasMore:false});await initial;await new Promise(r=>setImmediate(r));assert.equal(native.hasAttribute('data-rt-order-pending'),false);assert.equal(d.publishedNative.has(native),true);
 const refresh=d.loadReddit();d.deduplicate();assert.equal(native.hasAttribute('data-rt-order-pending'),false);finish({posts:[raw('newer',{created_utc:1700000400})],hasMore:false});await refresh;await new Promise(r=>setImmediate(r));assert.equal(native.hasAttribute('data-rt-order-pending'),false);assert.equal(native.parentElement,d.feed);assert.equal(d.nodes.get('newer').nextElementSibling,native);assert.equal(W.document.querySelectorAll('#t3_native').length,1);
});

test('a batch preserves its reading anchor through enrichment and nested loader reconciliation',async t=>{
 const {W,d}=setup(t,{reddit:async()=>({posts:[raw('above',{created_utc:1700000200}),raw('reader',{created_utc:1700000100})],hasMore:false})});await d.ready;await d.loadReddit();await new Promise(r=>setImmediate(r));
 const reader=d.nodes.get('reader'),moves=[],feed=d.feed;let extra=0;Object.defineProperty(W,'scrollY',{value:700,writable:true});feed.getBoundingClientRect=()=>({height:1400+extra});reader.getBoundingClientRect=()=>({top:80+extra-(W.scrollY-700),bottom:480+extra-(W.scrollY-700),height:400});
 feed.style.setProperty('min-height','20px','important');feed.style.setProperty('overflow-anchor','auto','important');W.scrollBy=({top})=>{moves.push(top);W.scrollY+=top;};const decorate=d.decorateNative.bind(d);d.decorateNative=(post,node)=>{if(post.id==='above')extra=120;return decorate(post,node);};
 d.render();assert.deepEqual(moves,[120],'correct once after decoration, reconciliation and loader updates');assert.equal(reader.getBoundingClientRect().top,80);assert.equal(feed.style.getPropertyValue('min-height'),'20px');assert.equal(feed.style.getPropertyPriority('min-height'),'important');assert.equal(feed.style.getPropertyValue('overflow-anchor'),'auto');assert.equal(feed.style.getPropertyPriority('overflow-anchor'),'important');
 d.render();assert.deepEqual(moves,[120],'unchanged batches cannot correct the viewport again');
});

test('loader updates protect the reading position while they write, and skip layout work when nothing changes',async t=>{
 const {W,d}=setup(t);await d.ready;await d.loadReddit();await new Promise(r=>setImmediate(r));const reader=d.nodes.get('abc12'),feed=d.feed;let height=1200;Object.defineProperty(W,'innerHeight',{value:500});Object.defineProperty(W,'scrollY',{value:700,writable:true});feed.getBoundingClientRect=()=>({height});reader.getBoundingClientRect=()=>({top:80-(W.scrollY-700),bottom:480-(W.scrollY-700),height:400});
 d.moreReddit=true;const moves=[];W.scrollBy=({top})=>{moves.push(top);W.scrollY+=top;};
 // A write that temporarily drops the feed height (moving the loader) must not clamp the viewport.
 feed.append(W.document.createElement('div'));const append=feed.append.bind(feed);feed.append=(...nodes)=>{height=500;const effective=Math.max(height,parseFloat(feed.style.minHeight)||0);W.scrollY=Math.min(W.scrollY,Math.max(0,effective-W.innerHeight));append(...nodes);height=1200;};
 d.updateProfileLoading();assert.equal(W.scrollY,700,'the protected write keeps the reader in place');assert.equal(reader.getBoundingClientRect().top,80);assert.deepEqual(moves,[]);assert.equal(feed.style.minHeight,'');assert.equal(feed.style.overflowAnchor,'');assert.equal(feed.lastElementChild,d.loading);
 await new Promise(r=>setImmediate(r));d.prefetchProfilePage=()=>{};d.flushVirtualization=()=>{};let transactions=0;const run=d.withFeedViewport.bind(d);d.withFeedViewport=fn=>{transactions++;return run(fn);};d.updateProfileLoading();assert.equal(transactions,0,'an unchanged loader runs no viewport transaction');
});

test('a gated native duplicate cannot collapse its already displayed peer during bottom pagination',async t=>{
 const {W,d}=setup(t,{reddit:async()=>({posts:[raw('shown',{created_utc:1700000200}),raw('reader',{created_utc:1700000100})],hasMore:false})});await d.ready;await d.loadReddit();await new Promise(r=>setImmediate(r));const shown=d.nodes.get('shown'),reader=d.nodes.get('reader');
 d.sourceFrontiers.set('post',{more:true,floor:1700000300});d.moreReddit=true;const native=W.document.createElement('shreddit-post');native.id='t3_shown';native.setAttribute('created-timestamp',new Date(1700000200*1000).toISOString());d.feed.insertBefore(native,d.loading);await new Promise(r=>setImmediate(r));
 assert.equal(native.hasAttribute('data-rt-order-pending'),true);assert.equal(shown.hidden,false,'the peer remains visible until native content can actually appear');assert.ok(shown.compareDocumentPosition(reader)&W.Node.DOCUMENT_POSITION_FOLLOWING);assert.equal(reader.hidden,false);assert.equal(d.nodes.get('shown'),shown);
 d.sourceFrontiers.set('post',{more:false,floor:-Infinity});d.moreReddit=false;d.deduplicate();assert.equal(native.hasAttribute('data-rt-order-pending'),false);assert.equal(shown.hidden,true,'normal deduplication resumes once the native card is visible');
});

test('profile loading suppresses supplemental progress bars while retaining halos and media controls',async t=>{
 const {W,d}=setup(t);await d.ready;const css=W.document.createElement('style');css.textContent=fs.readFileSync('extension/post-discovery.css','utf8');W.document.head.append(css);
 const bar=W.document.createElement('faceplate-progress');d.feed.insertBefore(bar,d.loading);const pager=W.document.createElement('faceplate-partial');pager.slot='load-after';pager.innerHTML='<faceplate-progress></faceplate-progress>';d.feed.insertBefore(pager,d.loading);
 const shadow=d.feed.attachShadow({mode:'open'});shadow.innerHTML='<faceplate-progress></faceplate-progress><shreddit-loading></shreddit-loading><slot></slot>';const loader=d.loading.querySelector('shreddit-feed-page-loading');loader.attachShadow({mode:'open'}).innerHTML='<progress></progress><shreddit-loading></shreddit-loading>';const native=d.feed.querySelector('shreddit-post');native.attachShadow({mode:'open'}).innerHTML='<progress data-video-progress></progress>';
 d.observeNativeLoading();assert.equal(W.getComputedStyle(bar).display,'none');assert.equal(W.getComputedStyle(pager.firstElementChild).display,'none');assert.match(shadow.querySelector('style').textContent,/faceplate-progress,progress/);assert.ok(shadow.querySelector('shreddit-loading'));assert.ok(loader.shadowRoot.querySelector('shreddit-loading'));assert.equal(native.shadowRoot.querySelector('style'),null);const styles=[...d.nativeLoadingStyles];d.observeNativeLoading();assert.equal(d.nativeLoadingStyles.size,styles.length,'repeated scans do not add styles repeatedly');
 d.onSettings({'rt-settings-v1':{newValue:{postDiscovery:false}}},'local');assert.equal(shadow.querySelector('style'),null);assert.equal(loader.shadowRoot.querySelector('style'),null);assert.notEqual(W.getComputedStyle(bar).display,'none');assert.ok(native.shadowRoot.querySelector('[data-video-progress]'));
});

test('native separators remain visible around controls, feed and loader',async t=>{
 const {W,d}=setup(t);await d.ready;const style=W.document.createElement('style');style.textContent=fs.readFileSync('extension/post-discovery.css','utf8');W.document.head.append(style);const rule=()=>{const hr=W.document.createElement('hr');hr.className='border-0 border-b-sm border-solid border-b-neutral-border-weak';return hr;};
 const before=rule(),after=rule(),toolbar=rule(),leading=rule(),tail=rule();d.host.before(before);d.host.after(after);d.toolbar.append(toolbar);d.feed.prepend(leading);d.feed.insertBefore(tail,d.loading);d.busy=true;d.updateProfileLoading();
 const loader=d.loading.firstElementChild;loader.attachShadow({mode:'open'}).innerHTML='<hr class="border-0 border-b-sm border-solid border-b-neutral-border-weak"><shreddit-loading></shreddit-loading>';d.observeNativeLoading();assert.doesNotMatch(loader.shadowRoot.querySelector('style').textContent,/hr/);assert.ok(loader.shadowRoot.querySelector('shreddit-loading'));
 for(const hr of [before,after,toolbar,leading,tail])assert.notEqual(W.getComputedStyle(hr).display,'none');
});

test('native standalone rules follow hidden feed runs through filtering, virtualization and opt-out',async t=>{
 const {W,d}=setup(t);await d.ready;arrivedLater(d);const css=W.document.createElement('style');css.textContent=fs.readFileSync('extension/post-discovery.css','utf8');W.document.head.append(css);
 const feed=d.feed,first=feed.querySelector('shreddit-post'),makeRule=()=>{const rule=W.document.createElement('hr');rule.className='border-0 border-b-sm border-solid border-b-neutral-border-weak';return rule;},makeCard=id=>{const node=W.document.createElement('shreddit-post');node.id='t3_'+id;node.setAttribute('created-timestamp',new Date(1700000000*1000).toISOString());return node;};
 first.setAttribute('created-timestamp',new Date(1700000000*1000).toISOString());const second=makeCard('second'),third=makeCard('third'),a=makeRule(),b=makeRule(),c=makeRule(),unrelated=W.document.createElement('hr');
 feed.insertBefore(a,first);feed.insertBefore(second,d.loading);feed.insertBefore(b,second);feed.insertBefore(c,d.loading);feed.insertBefore(third,d.loading);feed.insertBefore(unrelated,d.loading);
 d.autoDiscover=true;d.deduplicate();for(const node of [a,b,c])assert.equal(W.getComputedStyle(node).display,'none','empty gated run has no orphan rules');assert.notEqual(W.getComputedStyle(unrelated).display,'none');
 const slot=W.document.createElement('div');slot.className='virtualized-placeholder';b.replaceWith(slot);d.trackVirtualization([{target:feed,addedNodes:[slot],removedNodes:[b]}]);d.deduplicate();assert.equal(slot.hasAttribute('data-rt-rule-collapsed'),true);assert.equal(b.hasAttribute('data-rt-rule-collapsed'),false);
 slot.replaceWith(b);d.trackVirtualization([{target:feed,addedNodes:[b],removedNodes:[slot]}]);d.deduplicate();assert.equal(slot.hasAttribute('data-rt-rule-collapsed'),false);assert.equal(b.hasAttribute('data-rt-rule-collapsed'),true);
 d.autoDiscover=false;d.activityFilter='deleted';third.setAttribute('item-state','deleted');d.deduplicate();assert.equal(first.hidden,true);assert.equal(second.hidden,true);assert.equal(third.hidden,false);assert.equal(a.hasAttribute('data-rt-rule-collapsed'),false);assert.equal(b.hasAttribute('data-rt-rule-collapsed'),true);assert.equal(c.hasAttribute('data-rt-rule-collapsed'),true);
 const cardSlot=W.document.createElement('div');cardSlot.className='virtualized-placeholder';second.replaceWith(cardSlot);d.trackVirtualization([{target:feed,addedNodes:[cardSlot],removedNodes:[second]}]);d.deduplicate();assert.equal(cardSlot.hidden,true);assert.equal(b.hasAttribute('data-rt-rule-collapsed'),true);
 cardSlot.replaceWith(second);d.trackVirtualization([{target:feed,addedNodes:[second],removedNodes:[cardSlot]}]);d.activityFilter='hidden';d.deduplicate();for(const node of [a,b,c])assert.equal(node.hasAttribute('data-rt-rule-collapsed'),true);
 d.activityFilter='all';d.deduplicate();for(const node of [a,b,c])assert.equal(node.hasAttribute('data-rt-rule-collapsed'),false);assert.equal(first.hidden,false);assert.equal(second.hidden,false);assert.equal(third.hidden,false);
 d.activityFilter='hidden';d.deduplicate();d.onSettings({'rt-settings-v1':{newValue:{postDiscovery:false}}},'local');for(const node of [a,b,c]){assert.equal(node.hasAttribute('data-rt-rule-collapsed'),false);assert.equal(node.parentElement,feed);}assert.equal(second.hidden,false);
});

test('visible discovery cards and unrelated children preserve native rule boundaries',async t=>{
 const {W,d}=setup(t);await d.ready;const feed=d.feed,first=feed.querySelector('shreddit-post'),a=W.document.createElement('hr'),b=W.document.createElement('hr'),card=W.document.createElement('div'),other=W.document.createElement('div');for(const node of [a,b])node.className='border-0 border-b-sm border-solid border-b-neutral-border-weak';card.dataset.rtUi='activity-item';feed.insertBefore(a,first);feed.insertBefore(card,d.loading);feed.insertBefore(b,d.loading);feed.insertBefore(other,d.loading);d.activityFilter='hidden';d.deduplicate();assert.equal(first.hidden,true);assert.equal(a.hasAttribute('data-rt-rule-collapsed'),false);assert.equal(b.hasAttribute('data-rt-rule-collapsed'),false);card.hidden=true;d.deduplicate();assert.equal(a.hasAttribute('data-rt-rule-collapsed'),true);assert.equal(b.hasAttribute('data-rt-rule-collapsed'),true);assert.equal(other.parentElement,feed);
});

test('merge waiting keeps native posts inside pager wrappers visible',async t=>{
 const {W,d}=setup(t);await d.ready;const style=W.document.createElement('style');style.textContent=fs.readFileSync('extension/post-discovery.css','utf8');W.document.head.append(style);const batch=W.document.createElement('faceplate-batch'),makeCard=(id,tag='shreddit-post')=>{const card=W.document.createElement('article');card.innerHTML='<'+tag+' id="'+id+'">Native content</'+tag+'>';return card;},rule=()=>{const hr=W.document.createElement('hr');hr.className='border-0 border-b-sm border-solid border-b-neutral-border-weak';return hr;};
 const first=makeCard('first');first.firstElementChild.setAttribute('created-timestamp','2023-11-14T22:20:00Z');batch.append(first);const wrappers=[],rules=[];for(let i=0;i<7;i++){const hr=rule(),wrapper=W.document.createElement('shreddit-feed-load-more-observer');wrapper.append(makeCard('card'+i,i===6?'shreddit-profile-comment':'shreddit-post'));batch.append(hr,wrapper);rules.push(hr);wrappers.push(wrapper);}const last=rule(),empty=W.document.createElement('shreddit-feed-load-more-observer');batch.append(last,empty);const pending=W.document.createElement('shreddit-post');pending.id='t3_pending';pending.setAttribute('created-timestamp','2023-11-14T22:13:20Z');d.feed.replaceChildren(batch,pending,d.loading);d.publishedNative.add(batch);d.autoDiscover=true;d.deduplicate();assert.equal(batch.hasAttribute('data-rt-order-pending'),false);assert.notEqual(W.getComputedStyle(batch).display,'none');assert.equal(pending.hasAttribute('data-rt-order-pending'),true);assert.equal(d.feed.hasAttribute('data-rt-merge-waiting'),true);
 for(const wrapper of wrappers)assert.notEqual(W.getComputedStyle(wrapper).display,'none','a pager containing a native post or comment remains visible');assert.equal(W.getComputedStyle(empty).display,'none','an empty continuation remains paused');for(const hr of [...rules,last])assert.equal(hr.hasAttribute('data-rt-rule-collapsed'),false,'card-bearing wrappers preserve boundaries');
});

test('nested native batches collapse repeated pager rules without crossing card or content boundaries',async t=>{
 const {W,d}=setup(t);await d.ready;const feed=d.feed,batch=W.document.createElement('faceplate-batch'),rule=()=>{const n=W.document.createElement('hr');n.className='border-0 border-b-sm border-solid border-b-neutral-border-weak';return n;},card=id=>{const n=W.document.createElement('article');n.innerHTML='<shreddit-post id="t3_'+id+'"><div slot="text-body"><hr class="border-0 border-b-sm border-solid border-b-neutral-border-weak"></div></shreddit-post>';return n;},pager=()=>W.document.createElement('shreddit-feed-load-more-observer');
 const first=card('first'),second=card('second'),boundary=rule(),stack=Array.from({length:8},rule);batch.append(first,boundary,second);for(const hr of stack)batch.append(pager(),hr);feed.replaceChildren(batch,d.loading);d.deduplicate();
 assert.equal(boundary.hasAttribute('data-rt-rule-collapsed'),false);assert.equal(second.querySelector('hr').hasAttribute('data-rt-rule-collapsed'),false);assert.deepEqual(stack.map(n=>n.hasAttribute('data-rt-rule-collapsed')),[false,true,true,true,true,true,true,true]);
 const extra=rule();batch.append(pager(),extra);await new Promise(r=>setImmediate(r));assert.equal(extra.hasAttribute('data-rt-rule-collapsed'),true,'native reinsertion is reconciled asynchronously');
 const slot=W.document.createElement('div');slot.className='virtualized-placeholder';stack[1].replaceWith(slot);await new Promise(r=>setImmediate(r));assert.equal(slot.hasAttribute('data-rt-rule-collapsed'),true);slot.replaceWith(stack[1]);await new Promise(r=>setImmediate(r));assert.equal(stack[1].hasAttribute('data-rt-rule-collapsed'),true);
 const other=W.document.createElement('div'),separate=rule(),renderedPager=pager(),afterPager=rule();other.textContent='unrelated content';renderedPager.getBoundingClientRect=()=>({height:20});batch.append(other,separate,renderedPager,afterPager);await new Promise(r=>setImmediate(r));assert.equal(separate.hasAttribute('data-rt-rule-collapsed'),false);assert.equal(afterPager.hasAttribute('data-rt-rule-collapsed'),false,'a rendered pager is a boundary');const pagerSlot=W.document.createElement('div');pagerSlot.className='virtualized-placeholder';pagerSlot.getBoundingClientRect=()=>({height:20});renderedPager.replaceWith(pagerSlot);await new Promise(r=>setImmediate(r));assert.equal(afterPager.hasAttribute('data-rt-rule-collapsed'),false,'a rendered pager placeholder is a boundary');stack[1].replaceWith(slot);await new Promise(r=>setImmediate(r));assert.equal(slot.hasAttribute('data-rt-rule-collapsed'),true);d.reset();assert.equal(slot.hasAttribute('data-rt-rule-collapsed'),false);for(const hr of [...stack,extra,separate,afterPager])assert.equal(hr.hasAttribute('data-rt-rule-collapsed'),false);
});

test('opt-out restores a native rule while its virtualization placeholder is still mounted',async t=>{
 const {W,d}=setup(t);await d.ready;arrivedLater(d);const feed=d.feed,card=feed.querySelector('shreddit-post'),rule=W.document.createElement('hr');card.setAttribute('created-timestamp',new Date(1700000000*1000).toISOString());rule.className='border-0 border-b-sm border-solid border-b-neutral-border-weak';feed.insertBefore(rule,d.loading);d.autoDiscover=true;d.deduplicate();assert.equal(rule.hasAttribute('data-rt-rule-collapsed'),true);
 const slot=W.document.createElement('div');slot.className='virtualized-placeholder';rule.replaceWith(slot);await new Promise(r=>setImmediate(r));assert.equal(d.virtualNodes.get(slot),rule);assert.equal(slot.hasAttribute('data-rt-rule-collapsed'),true);assert.equal(rule.hasAttribute('data-rt-rule-collapsed'),false);
 d.onSettings({'rt-settings-v1':{newValue:{postDiscovery:false}}},'local');assert.equal(slot.hasAttribute('data-rt-rule-collapsed'),false);assert.equal(rule.hasAttribute('data-rt-rule-collapsed'),false);slot.replaceWith(rule);assert.equal(rule.parentElement,feed);assert.equal(rule.className,'border-0 border-b-sm border-solid border-b-neutral-border-weak');
});

test('scrolled viewport style transactions do not feed back into the loading observer or starve timers',async t=>{
 const {W,d}=setup(t);await d.ready;await d.loadReddit();await new Promise(r=>setImmediate(r));const reader=d.nodes.get('abc12');Object.defineProperty(W,'scrollY',{value:500,writable:true});d.feed.getBoundingClientRect=()=>({height:1200});reader.getBoundingClientRect=()=>({top:80,bottom:280,height:200});
 let updates=0;const update=d.updateProfileLoading.bind(d);d.updateProfileLoading=()=>{if(++updates>5)d.nativeLoadingObserver.disconnect();return update();};d.render();updates=0;let timerRan=false;await new Promise(resolve=>W.setTimeout(()=>{timerRan=true;resolve();},0));assert.equal(timerRan,true);assert.equal(updates,0,'viewport min-height/overflow-anchor writes must not recursively schedule loader updates');
 const native=W.document.createElement('shreddit-feed-page-loading');native.attachShadow({mode:'open'}).innerHTML='<shreddit-loading></shreddit-loading>';d.feed.append(native);d.observeNativeLoading();await new Promise(r=>setImmediate(r));assert.ok(updates>0,'actual native loading changes remain observed');assert.ok(updates<=3,'native loading settles instead of restarting its own viewport transaction');
});

test('painted native cards stay visible while a later native page waits only for the bounded budget',async t=>{
 let finish;const {W,d}=setup(t,{timing:{nativeWaitMs:30,sourceWaitMs:60000},reddit:()=>new Promise(r=>finish=r)});await d.ready;
 const painted=d.feed.firstElementChild;painted.setAttribute('created-timestamp',new Date(1700000300*1000).toISOString());
 d.autoDiscover=true;const load=d.loadReddit();d.deduplicate();
 assert.equal(painted.hasAttribute('data-rt-order-pending'),false,'cards Reddit already painted are never hidden again');
 const next=W.document.createElement('shreddit-post');next.id='t3_next';next.setAttribute('created-timestamp',new Date(1700000100*1000).toISOString());d.feed.insertBefore(next,d.loading);d.deduplicate();
 assert.equal(next.hasAttribute('data-rt-order-pending'),true,'a later native page waits for discovery coverage');
 await new Promise(r=>setTimeout(r,90));
 assert.equal(next.hasAttribute('data-rt-order-pending'),false,'a silent source cannot hold the native page past its budget');assert.equal(d.feed.hasAttribute('data-rt-merge-waiting'),false);
 finish({posts:[raw('late',{created_utc:1700000200})],hasMore:false});await load;await new Promise(r=>setImmediate(r));
 assert.equal(d.nodes.get('late').hidden,false);assert.ok(d.nodes.get('late').compareDocumentPosition(next)&W.Node.DOCUMENT_POSITION_FOLLOWING,'a late discovery is still placed by date');assert.ok(painted.compareDocumentPosition(d.nodes.get('late'))&W.Node.DOCUMENT_POSITION_FOLLOWING);
});

test('an unanswered source stops holding back the other sources after its budget',async t=>{
 const {d}=setup(t,{timing:{sourceWaitMs:30},settings:{postDiscovery:true,archiveDiscovery:true},reddit:async()=>({posts:[raw('found',{created_utc:1700000200})],hasMore:false}),archive:()=>new Promise(()=>{})});await d.ready;
 d.loadArchive();await d.loadReddit();await new Promise(r=>setImmediate(r));
 assert.equal(d.publishedCards.has('found'),false,'a fresh archive request still bounds the date order');
 await new Promise(r=>setTimeout(r,90));await new Promise(r=>setImmediate(r));
 assert.equal(d.publishedCards.has('found'),true);assert.equal(d.nodes.get('found').hidden,false);assert.equal(d.archiveBusy,true,'the archive request itself is not cancelled');
});

test('automatic discovery and Refresh start Reddit search and the archive together',async t=>{
 const archiveCalls=[];const {d,calls}=setup(t,{settings:{postDiscovery:true,archiveDiscovery:true},archive:async input=>{archiveCalls.push(input);return {posts:[raw('old12',{created_utc:1600000000})],hasMore:false};}});await d.ready;
 d.reset();d.autoDiscover=true;d.scan();await new Promise(r=>setImmediate(r));await Promise.all([d.redditRun,d.archiveRun]);
 assert.equal(calls.filter(c=>c.action==='profile').length,1);assert.equal(archiveCalls.length,1,'no archive button click is needed');assert.equal(d.archiveLoaded,true);
 d.discover.click();await Promise.all([d.redditRun,d.archiveRun]);
 assert.equal(calls.filter(c=>c.action==='profile').length,2);assert.equal(archiveCalls.length,2,'Refresh reloads both providers');assert.equal(archiveCalls[1].before,undefined);
});

test('archive discovery stays off without the opt-in setting',async t=>{
 let archived=0;const {d}=setup(t,{archive:async()=>{archived++;return {posts:[],hasMore:false};}});await d.ready;
 d.reset();d.autoDiscover=true;d.scan();await new Promise(r=>setImmediate(r));await d.redditRun;assert.equal(archived,0);
});

test('one provider in flight does not block the other provider’s continuation',async t=>{
 let finishArchive;const archiveCalls=[];
 const {d,calls}=setup(t,{settings:{postDiscovery:true,archiveDiscovery:true},reddit:async input=>({posts:[raw(input.after?'second':'first',{created_utc:input.after?1700000100:1700000300})],after:input.after?null:'next',hasMore:!input.after}),archive:input=>{archiveCalls.push(input);return input.before?new Promise(r=>finishArchive=r):Promise.resolve({posts:[raw('archived',{created_utc:1700000300})],before:1700000300,hasMore:true});}});
 await d.ready;await d.refreshActivity();await new Promise(r=>setImmediate(r));
 const archiveMore=d.loadArchive({more:true});assert.equal(d.archiveBusy,true);
 d.continueProfile(true);await d.redditRun;
 assert.equal(calls.filter(c=>c.action==='profile' && c.after==='next').length,1,'Reddit search continues while the archive page is in flight');
 assert.equal(d.loadArchive({more:true}),archiveMore,'a repeated archive request joins the in-flight page');
 finishArchive({posts:[],hasMore:false});await archiveMore;assert.equal(archiveCalls.length,2);
});

test('archive status checks send 25 IDs per request while the bridge answers in one read',async t=>{
 const checks=[];const ids=Array.from({length:30},(_,i)=>'p'+i);
 const {d}=setup(t,{settings:{archiveDiscovery:true},archive:async()=>({posts:ids.map((id,i)=>raw(id,{created_utc:1700000000-i})),hasMore:false}),reddit:async input=>{if(input.action!=='status')return {posts:[]};checks.push(input.ids.length);return {statuses:input.ids.map(id=>({fullname:'t3_'+id,status:'available'})),unknownIds:[],via:'info'};}});
 await d.ready;d.activityFilter='hidden';// status is checked up front only in filtered views
 await d.loadArchive();for(let i=0;i<4;i++)await new Promise(r=>setImmediate(r));
 assert.deepEqual(checks,[25,5]);assert.equal(d.metadataPending,0);assert.equal(d.verifyQueue.length,0);assert.equal(d.postStatuses.get('t3_p29'),'available');
});

test('Deleted keeps one page of unchecked candidates ahead instead of waiting for every check',async t=>{
 const pages=[];const {d}=setup(t,{settings:{archiveDiscovery:true},archive:async input=>{pages.push(input.before);return {posts:[],hasMore:false};}});await d.ready;
 d.activityFilter='deleted';d.moreArchive=true;d.archiveMore={post:true};d.metadataPending=1;
 d.verifyQueue=Array.from({length:25},(_,i)=>({...raw('q'+i),fullname:'t3_q'+i,kind:'post'}));assert.equal(d.loadMore(),undefined,'a full page of unchecked candidates is enough look-ahead');
 d.verifyQueue=d.verifyQueue.slice(0,3);d.beforeByKind={post:1700000000};await d.loadMore();assert.deepEqual(pages,[1700000000],'pending checks no longer block the next archive page');
});

test('a deleted item Reddit no longer serves keeps its archive snapshot in a native-looking card',async t=>{
 const {d}=setup(t,{url:'https://www.reddit.com/user/Example/comments/',settings:{postDiscovery:true,archiveDiscovery:true},reddit:async input=>input.action==='status'?{statuses:[],unknownIds:[]}:{posts:[],hasMore:false},archive:async()=>({posts:[{...comment(),id:'gone1',fullname:'t1_gone1',body:'Original archived words',title:'The parent post',retrieved:1700086400}],hasMore:false}),nativeRender:async()=>{throw Error('Reddit returned no matching native card.');}});
 await d.ready;await d.loadArchive();for(let i=0;i<3;i++)await new Promise(r=>setImmediate(r));
 const node=d.nodes.get('t1_gone1');assert.equal(node.dataset.rtArchiveFallback,'true');assert.equal(node.querySelector('.rt-native-unavailable'),null);assert.equal(node.querySelector('details'),null);
 assert.ok(node.querySelector('shreddit-profile-comment'));assert.match(node.textContent,/Original archived words/);assert.match(node.textContent,/The parent post/);
 assert.match(node.querySelector('[data-rt-source]').title,/Arctic Shift snapshot.*Snapshot from/);
});

test('an archived comment Reddit no longer has is marked deleted in All activity, without a status request',async t=>{
 const calls=[];const {d}=setup(t,{url:'https://www.reddit.com/user/Example/comments/',settings:{postDiscovery:true,archiveDiscovery:true},reddit:async input=>{calls.push(input.action);return input.action==='status'?{statuses:[],unknownIds:[]}:{posts:[],hasMore:false};},archive:async()=>({posts:[{...comment(),id:'gone2',fullname:'t1_gone2',body:'Original archived words',title:'The parent post',retrieved:1700086400}],hasMore:false}),nativeRender:async()=>{throw Error('Reddit no longer has this comment.');}});
 await d.ready;await d.loadArchive();for(let i=0;i<3;i++)await new Promise(r=>setImmediate(r));
 const node=d.nodes.get('t1_gone2');assert.equal(node.dataset.rtArchiveFallback,'true');assert.match(node.textContent,/Original archived words/);
 assert.equal(d.postStatuses.get('t1_gone2'),'deleted');const badge=node.querySelector('.rt-post-indicator');assert.equal(badge.dataset.state,'deleted');assert.match(badge.title,/^Deleted on Reddit/);
 assert.equal(calls.filter(a=>a==='status').length,0);
});

test('an archived comment Reddit still serves is shown as available, not as an unknown archive snapshot',async t=>{
 const calls=[];const {d}=setup(t,{url:'https://www.reddit.com/user/Example/comments/',settings:{postDiscovery:true,archiveDiscovery:true},reddit:async input=>{calls.push(input.action);return input.action==='status'?{statuses:[],unknownIds:[]}:{posts:[],hasMore:false};},archive:async()=>({posts:[{...comment(),id:'live3',fullname:'t1_live3',body:'Still on Reddit'}],hasMore:false}),
  nativeRender:async(post,node)=>{node.innerHTML='<shreddit-profile-comment comment-id="t1_live3"><div id="t1_live3-post-rtjson-content">Still on Reddit</div></shreddit-profile-comment>';return {rendered:true,fullname:'t1_live3',status:'available'};}});
 await d.ready;await d.loadArchive();for(let i=0;i<3;i++)await new Promise(r=>setImmediate(r));
 assert.equal(d.postStatuses.get('t1_live3'),'available');const badge=d.nodes.get('t1_live3').querySelector('.rt-post-indicator');assert.equal(badge.dataset.state,'available');assert.match(badge.title,/Available on Reddit/);
 assert.equal(calls.filter(a=>a==='status').length,0);
});

test('a card without archive text keeps a Reddit-styled retry row after a definitive failure',async t=>{
 const {d}=setup(t,{nativeRender:async()=>{throw Error('Reddit could not render this card (HTTP 404).');}});await d.ready;await d.loadReddit();await new Promise(r=>setImmediate(r));
 const node=d.nodes.get('abc12'),row=node.querySelector('.rt-native-unavailable');assert.equal(node.dataset.rtNativeState,'failed');assert.ok(row);assert.equal(row.querySelector('details'),null);assert.match(row.querySelector('button').className,/button-bordered/);assert.match(row.textContent,/couldn’t load/);
});

test('Refresh lives in Reddit’s Feed options menu and reloads search and archive together',async t=>{
 const archiveCalls=[];const {W,d,calls}=setup(t,{settings:{postDiscovery:true,archiveDiscovery:true},archive:async input=>{archiveCalls.push(input);return {posts:[],hasMore:false};}});await d.ready;
 assert.equal(d.archiveButton,null,'no separate archive button');assert.equal(d.host.hasAttribute('data-rt-menu-ready'),true);const mainMenu=W.document.querySelector('rpl-menu.main-menu-container');assert.equal(mainMenu.hasAttribute('data-rt-menu-ready'),true,'the grouped menu is marked so the pre-hide stops');t.after(()=>assert.equal(mainMenu.hasAttribute('data-rt-menu-ready'),true,'restored native rows stay visible'));
 const refresh=W.document.querySelector('[data-rt-ui="activity-refresh"]');assert.ok(refresh);assert.equal(refresh.closest('rpl-dropdown').querySelector('button[aria-label="Feed options"]')!=null,true);
 refresh.click();await Promise.all([d.redditRun,d.archiveRun]);assert.equal(calls.filter(c=>c.action==='profile').length,1);assert.equal(archiveCalls.length,1);
 d.onSettings({'rt-settings-v1':{newValue:{postDiscovery:false}}},'local');assert.equal(W.document.querySelector('[data-rt-ui="activity-refresh"]'),null,'opt-out removes the menu row');
});

test('Hot and Top keep Reddit ranking without automatic archive filler',async t=>{
 for(const sort of ['hot','top']){let archived=0;const {d}=setup(t,{url:'https://www.reddit.com/user/Example/submitted/?sort='+sort,settings:{postDiscovery:true,archiveDiscovery:true},archive:async()=>{archived++;return {posts:[],hasMore:false};}});await d.ready;
  await d.refreshActivity();assert.equal(archived,0,sort);d.activityFilter='deleted';await d.refreshActivity();assert.equal(archived,1,'Deleted still uses the archive in '+sort);}
});

test('a blocked logged-out comment search becomes a quiet note, not a failure, and pauses for the session',async t=>{
 let publicCalls=0;const {W,d}=setup(t,{url:'https://www.reddit.com/user/Example/comments/',reddit:async()=>({posts:[comment()],hasMore:false}),publicReddit:async()=>{publicCalls++;throw Error('Reddit blocked logged-out comment search (HTTP 403).');}});await d.ready;
 await d.loadReddit();await new Promise(r=>setImmediate(r));
 assert.equal(d.status.dataset.error,'false','a blocked supplement is not shown as an error');assert.equal(d.primaryFailure(),false);assert.equal(d.sourceErrors['comment-public'],undefined);
 assert.equal(d.notice.hidden,false);assert.match(d.notice.textContent,/Some comments may be missing/);assert.match(d.notice.title,/HTTP 403/);assert.equal(d.notice.getAttribute('role'),'note');
 assert.equal(d.nodes.get(comment().fullname).hidden,false,'signed-in results still appear');
 await d.loadReddit();assert.equal(publicCalls,1,'the blocked stream is skipped for a while');assert.equal(d.notice.hidden,false);
 d.publicBlockedUntil=0;await d.loadReddit();assert.equal(publicCalls,2,'it is tried again after the pause');
});

test('other logged-out search failures stay explicit errors',async t=>{
 const {d}=setup(t,{url:'https://www.reddit.com/user/Example/comments/',reddit:async()=>({posts:[],hasMore:false}),publicReddit:async()=>{throw Error('Reddit couldn’t load logged-out comment search (HTTP 404).');}});await d.ready;
 await d.loadReddit();assert.equal(d.status.dataset.error,'true');assert.match(d.status.textContent,/HTTP 404/);assert.equal(d.notice.hidden,true);
});
test('explicit Refresh activity retries the public supplement rather than retaining its blocked pause',async t=>{
 let calls=0,refreshed=false;const {d}=setup(t,{url:'https://www.reddit.com/user/Example/comments/',reddit:async()=>({posts:[],hasMore:false}),publicReddit:async request=>{calls++;if(!request.refresh)throw Error('Reddit blocked logged-out comment search (HTTP 403).');refreshed=true;return {posts:[comment()],hasMore:false};}});
 await d.ready;await d.loadReddit();assert.equal(calls,1);assert.ok(d.publicBlockedUntil>Date.now());
 d.discover.click();await d.redditRun;assert.equal(calls,2);assert.equal(refreshed,true);assert.equal(d.publicBlockedUntil,0);
});

test('Arctic Shift maintenance shows its own note, waits minutes and Retry now forces one probe',async t=>{
 const requests=[];const {d}=setup(t,{timing:{retryUnitMs:1000},settings:{postDiscovery:true,archiveDiscovery:true},reddit:async input=>input.action==='status'?{statuses:[],unknownIds:[]}:{posts:[],hasMore:false},archive:async input=>{requests.push(input);throw Object.assign(Error('Arctic Shift is down for maintenance.'),{code:'maintenance',retryAt:Date.now()+60000});}});
 await d.ready;d.activityFilter='deleted';await d.loadArchive();
 assert.equal(d.status.dataset.error,'false','maintenance is not reported as a failure');
 const note=d.loading.querySelector('[data-rt-continuation-note]');assert.match(note.textContent,/Arctic Shift is down for maintenance\. Retrying in about 1 min\./);assert.doesNotMatch(note.textContent,/isn’t responding/);assert.equal(note.textContent.match(/down for maintenance/g).length,1,'one note per service, even with posts and comments both waiting');
 const count=requests.length;assert.ok(requests.every(input=>!input.force));
 note.querySelector('button').click();await d.archiveRun;await new Promise(r=>setImmediate(r));
 assert.ok(requests.length>count && requests.slice(count).every(input=>input.force===true),'Retry now asks the broker to probe');
 d.clearSourceRetries();
});
test('an Arctic Shift rate limit shows a quiet note and retries the same cursor with backoff',async t=>{
 const requests=[];let limited=true;const {d}=setup(t,{timing:{retryUnitMs:2},settings:{postDiscovery:true,archiveDiscovery:true},reddit:async input=>input.action==='status'?{statuses:[],unknownIds:[]}:{posts:[],hasMore:false},archive:async input=>{requests.push(input.before);if(limited){limited=false;throw Object.assign(Error('Archive rate limit reached.'),{code:'rate-limited'});}return {posts:[raw('old12',{created_utc:1600000000})],hasMore:false};}});
 await d.ready;d.activityFilter='deleted';await d.loadArchive();
 assert.equal(d.status.dataset.error,'false','a rate limit is not a failure');assert.equal(d.primaryFailure(),false);
 const note=d.loading.querySelector('[data-rt-continuation-note]');assert.match(note.textContent,/Arctic Shift is limiting requests\. Retrying in/);assert.match(note.textContent,/Retry now/);assert.equal(d.loading.hidden,false);assert.equal(d.loading.querySelector('.rt-native-loading').hidden,true,'no spinner while only waiting');
 await new Promise(r=>setTimeout(r,80));await d.archiveRun;await new Promise(r=>setImmediate(r));
 assert.equal(requests.length,2);assert.equal(d.archived.has('old12'),true);assert.equal(d.sourceRetries.size,0);assert.equal(d.loading.querySelector('[data-rt-continuation-note]'),null);
});

test('backoff gives up after a bounded number of attempts and then reports the failure',async t=>{
 let attempts=0;const {d}=setup(t,{timing:{retryUnitMs:1},settings:{postDiscovery:true,archiveDiscovery:true},archive:async()=>{attempts++;throw Object.assign(Error('Archive request timed out.'),{code:'timeout'});}});
 await d.ready;d.activityFilter='deleted';await d.loadArchive();
 for(let i=0;i<10 && !d.sourceErrors['archive-post'];i++){await new Promise(r=>setTimeout(r,40));await d.archiveRun;}
 assert.equal(attempts,6,'one request plus five scheduled retries');assert.match(d.sourceErrors['archive-post'],/timed out/);assert.equal(d.sourceRetries.size,0);
 assert.match(d.loading.querySelector('[data-rt-continuation-note]').textContent,/Some archived items couldn’t be loaded/);
});

test('Retry now runs a waiting retry immediately',async t=>{
 let attempts=0;const {d}=setup(t,{timing:{retryUnitMs:60000},reddit:async()=>{if(++attempts===1)throw Error('Reddit rate limit reached. Try again later.');return {posts:[raw()],hasMore:false};}});
 await d.ready;await d.loadReddit();const note=d.loading.querySelector('[data-rt-continuation-note]');assert.match(note.textContent,/Reddit search is limiting requests/);
 note.querySelector('button').click();await new Promise(r=>setImmediate(r));await d.redditRun;assert.equal(attempts,2);assert.equal(d.sourceRetries.size,0);assert.equal(d.nodes.has('abc12'),true);
});

test('the Deleted view never pauses on unrelated Reddit search errors',async t=>{
 const {d}=setup(t,{settings:{postDiscovery:true,archiveDiscovery:true},reddit:async input=>{if(input.action==='status')return {statuses:[],unknownIds:[]};throw Error('Reddit’s post search format changed. Posts could not be read safely.');},archive:async()=>({posts:[],before:1600000000,hasMore:true})});
 await d.ready;await d.loadReddit();assert.equal(d.primaryFailure(),true,'All activity still reports the search failure');
 d.activityFilter='deleted';d.batchAutoPaused=false;await d.loadArchive();d.updateProfileLoading();
 assert.equal(d.primaryFailure(),false);const note=d.loading.querySelector('[data-rt-continuation-note]');assert.ok(!note || !/search results/.test(note.textContent));
});

test('at the feed tail the reading position follows the last visible card, not the top one',async t=>{
 const {W,d}=setup(t,{reddit:async()=>({posts:[raw('upper',{created_utc:1700000300}),raw('lower',{created_utc:1700000100})],hasMore:true,after:'next'})});await d.ready;await d.loadReddit();await new Promise(r=>setImmediate(r));
 Object.defineProperty(W,'scrollY',{value:900,writable:true});const native=d.feed.querySelector('shreddit-post'),upper=d.nodes.get('upper'),lower=d.nodes.get('lower');
 for(const node of d.feed.children)node.getBoundingClientRect=()=>({top:-500,bottom:-400,height:100});
 upper.getBoundingClientRect=()=>({top:60,bottom:260,height:200});lower.getBoundingClientRect=()=>({top:300,bottom:500,height:200});d.loading.hidden=false;d.loading.getBoundingClientRect=()=>({top:520,bottom:640,height:120});
 assert.equal(d.captureFeedViewport().node,lower,'the card just above the loader is the reading anchor');
 d.loading.getBoundingClientRect=()=>({top:3000,bottom:3120,height:120});assert.equal(d.captureFeedViewport().node,upper,'away from the tail the top visible card anchors');
 assert.ok(native);
});

test('only cards placed between cards Reddit already showed are animated',async t=>{
 const {W,d}=setup(t,{reddit:async()=>({posts:[raw('newer',{created_utc:1700000300}),raw('tail',{created_utc:1600000000})],hasMore:false})});await d.ready;
 d.feed.querySelector('shreddit-post').setAttribute('created-timestamp',new Date(1700000200*1000).toISOString());await d.loadReddit();await new Promise(r=>setImmediate(r));
 const newer=d.nodes.get('newer'),tail=d.nodes.get('tail');assert.ok(newer.classList.contains('rt-native-enter'));assert.ok(newer.classList.contains('rt-native-inserted'),'placed above a native card');assert.equal(tail.classList.contains('rt-native-enter'),false,'cards at the feed end are not animated');assert.equal(tail.classList.contains('rt-native-inserted'),false);
 const css=fs.readFileSync('extension/post-discovery.css','utf8');assert.match(css,/prefers-reduced-motion:reduce\)\{\.rt-native-enter\{animation:none\}\.rt-native-inserted::after\{display:none\}/);
 const profile=W.document.querySelector('main');W.history.pushState({},'','/r/example/');W.document.body.innerHTML='<main id="main-content"></main>';d.scan();assert.equal(d.parked.size,1);
 for(const card of [newer,tail])assert.equal(card.classList.contains('rt-native-enter') || card.classList.contains('rt-native-inserted'),false,'Back does not replay entrance animations');
});

test('comment and archive cards without a native rule get one separator like Reddit’s cards',async t=>{
 const {d}=setup(t,{url:'https://www.reddit.com/user/Example/comments/',reddit:async()=>({posts:[comment(),{...comment(),id:'second1',fullname:'t1_second1',created_utc:1699999000}],hasMore:false})});
 await d.ready;d.feed.querySelector('shreddit-post').remove();await d.loadReddit();await new Promise(r=>setImmediate(r));
 for(const node of [d.nodes.get(comment().fullname),d.nodes.get('t1_second1')]){assert.equal(node.dataset.rtNativeState,'ready');const rules=node.querySelectorAll('hr');assert.equal(rules.length,1);assert.equal(rules[0],node.lastElementChild);assert.equal(rules[0].className,'border-0 border-b-sm border-solid border-b-neutral-border-weak');}
 const node=d.nodes.get(comment().fullname);d.decorateNative(d.postMetadata.get(comment().fullname),node);d.decorateNative(d.postMetadata.get(comment().fullname),node);assert.equal(node.querySelectorAll('hr').length,1,'repeated decoration never stacks rules');
});

test('profile cards with Reddit’s current notices show archived text, and removed posts get their title and body back',async t=>{
 const archivedComment={...comment(),id:'gone1',fullname:'t1_gone1',body:'What I originally wrote',retrieved_on:1700086400};
 const {d}=setup(t,{url:'https://www.reddit.com/user/Example/',settings:{postDiscovery:true,archiveDiscovery:true,restoreDeletedContent:true},
  reddit:async input=>input.action==='status'?{statuses:[],unknownIds:[]}:{posts:[],hasMore:false},
  archive:async input=>input.kind==='comment'?{posts:[archivedComment],hasMore:false}:{posts:[raw('rem1',{title:'My original title',selftext:'My original body'})],hasMore:false},
  nativeRender:async(post,node)=>{node.innerHTML=post.kind==='comment'?'<shreddit-profile-comment comment-id="t1_gone1" is-comment-deleted><div><span class="text-12 relative"></span><div><p>Comment deleted by user</p></div></div></shreddit-profile-comment>':'<shreddit-post id="t3_rem1" post-title="[ Removed by moderator ]"><span slot="credit-bar"></span><h1 slot="title">[ Removed by moderator ]</h1><div slot="post-removed-banner">Sorry, this post has been removed.</div></shreddit-post>';}});
 await d.ready;await d.loadArchive();for(let i=0;i<4;i++)await new Promise(r=>setImmediate(r));
 const c=d.nodes.get('t1_gone1');assert.match(c.textContent,/What I originally wrote/);assert.doesNotMatch(c.textContent,/Comment deleted by user/);assert.match(c.querySelector('[data-rt-source]').title,/Deleted on Reddit.*Text recovered from Arctic Shift.*Snapshot from/);
 const p=d.nodes.get('rem1'),post=p.querySelector('shreddit-post');assert.equal(post.querySelector('[slot="title"]').textContent,'My original title');assert.equal(post.querySelector('[slot="text-body"]').textContent,'My original body');assert.match(p.querySelector('[data-rt-source]').title,/Removed on Reddit/);
 d.onSettings({'rt-settings-v1':{newValue:{postDiscovery:true,archiveDiscovery:false}}},'local');
});

test('a removed post page restores title and text inside Reddit’s post element, not a separate box',async t=>{
 const {W,d}=setup(t,{url:'https://www.reddit.com/r/example/comments/abc12/removed_by_moderator/',settings:{postDiscovery:true,archiveDiscovery:true,restoreDeletedContent:true},archive:async()=>({posts:[raw('abc12',{title:'Original title',selftext:'Original body'})]}),reddit:async()=>({posts:[]})});
 await d.ready;const native=W.document.querySelector('shreddit-post');native.id='t3_abc12';native.setAttribute('author','Example');native.setAttribute('post-title','[ Removed by moderator ]');native.innerHTML='<h1 slot="title">[ Removed by moderator ]</h1><div slot="post-removed-banner">Sorry, this post has been removed.</div>';
 await d.loadDetail();
 assert.equal(native.querySelector('[slot="title"]').textContent,'Original title');assert.equal(native.querySelector('[slot="text-body"]').textContent,'Original body');assert.equal(d.results.querySelector('.rt-post-snapshot'),null,'no separate snapshot box');
 d.restoreRecoveredBodies();assert.equal(native.querySelector('[slot="title"]').textContent,'[ Removed by moderator ]');assert.equal(native.querySelector('[slot="text-body"]'),null,'opt-out removes the added body');
 const other=setup(t,{url:'https://www.reddit.com/r/example/comments/abc12/x/',settings:{postDiscovery:true,archiveDiscovery:true,restoreDeletedContent:true},archive:async()=>({posts:[raw('abc12',{author:'Someone',title:'Not theirs'})]}),reddit:async()=>({posts:[]})});
 await other.d.ready;const n2=other.W.document.querySelector('shreddit-post');n2.id='t3_abc12';n2.setAttribute('author','Example');n2.innerHTML='<h1 slot="title">[ Removed by moderator ]</h1><div slot="post-removed-banner">Removed.</div>';await other.d.loadDetail();assert.equal(n2.querySelector('[slot="title"]').textContent,'[ Removed by moderator ]','a snapshot from another author is never shown in place');
});

test('cards hidden by a filter do not count as the first batch, so Deleted keeps filling',async t=>{
 const ids=Array.from({length:30},(_,i)=>'p'+i);let archiveCalls=0;
 const {d}=setup(t,{settings:{postDiscovery:true,archiveDiscovery:true},reddit:async input=>input.action==='status'?{statuses:input.ids.map(id=>({fullname:'t3_'+id,status:id==='old1'?'deleted':'available'})),unknownIds:[],via:'info'}:{posts:ids.map((id,i)=>raw(id,{created_utc:1700000300-i})),hasMore:false},archive:async input=>{archiveCalls++;return {posts:[raw('old1',{created_utc:1600000000,selftext:'Archived words'})],hasMore:false};}});
 await d.ready;await d.loadReddit();for(let i=0;i<6;i++)await new Promise(r=>setImmediate(r));assert.ok(d.publishedCards.size>=25,'All activity published a full batch');
 d.activityMenu.querySelector('[data-rt-activity-filter="deleted"]').click();for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r));
 assert.equal(d.shownPublished()<=1,true);assert.equal(d.nodes.get('old1').hidden,false,'the verified deleted item is published even though hidden All cards exceed a batch');
});
test('a measurable loader on screen counts as visible even if the observer missed it',async t=>{
 const {W,d}=setup(t);await d.ready;d.batchInView=false;d.loading.hidden=false;d.loading.getBoundingClientRect=()=>({top:300,bottom:420,height:120});assert.equal(d.profileTailVisible(),true);
 d.loading.getBoundingClientRect=()=>({top:W.innerHeight*4,bottom:W.innerHeight*4+120,height:120});assert.equal(d.profileTailVisible(),false);
});

test('post pages are left to the thread module when it is loaded, however the post was opened',async t=>{
 const {W,d}=setup(t,{url:'https://www.reddit.com/r/example/comments/abc12/title/',settings:{postDiscovery:true,archiveDiscovery:true}});await d.ready;
 W.RTThreadRestore={};d.reset();d.scan();assert.equal(d.host,null,'no separate post toolbar or snapshot box');assert.equal(d.context,null);
});

test('All activity never pre-checks archive status that rendering already proves; switching to a filter checks it',async t=>{
 const calls=[];const {d}=setup(t,{settings:{archiveDiscovery:true},reddit:async input=>{calls.push(input.action);return input.action==='status'?{statuses:[{fullname:'t3_old12',status:'deleted'}],unknownIds:[],via:'info'}:{posts:[]};}});
 await d.ready;await d.loadArchive();await new Promise(r=>setImmediate(r));assert.equal(calls.filter(a=>a==='status').length,0,'no duplicate status fetches in All activity');
 d.activityMenu.querySelector('[data-rt-activity-filter="deleted"]').click();for(let i=0;i<4;i++)await new Promise(r=>setImmediate(r));assert.equal(calls.filter(a=>a==='status').length,1);assert.equal(d.postStatuses.get('t3_old12'),'deleted');
});

test('removed image posts in profile cards get their Reddit-hosted image back, never for NSFW',async t=>{
 for(const [extra,expect] of [[{},true],[{over_18:true},false]]){
  const {d}=setup(t,{url:'https://www.reddit.com/user/Example/',settings:{postDiscovery:true,archiveDiscovery:true,restoreDeletedContent:true},reddit:async input=>input.action==='status'?{statuses:[],unknownIds:[]}:{posts:[],hasMore:false},archive:async input=>input.kind==='comment'?{posts:[],hasMore:false}:{posts:[raw('img1',{title:'Picture title',selftext:'',url:'https://i.redd.it/pic.jpeg',...extra})],hasMore:false},
   nativeRender:async(post,node)=>{node.innerHTML='<shreddit-post id="t3_img1" post-title="[ Removed by moderator ]"><span slot="credit-bar"></span><h1 slot="title">[ Removed by moderator ]</h1><div slot="post-removed-banner">Removed.</div></shreddit-post>';}});
  await d.ready;await d.loadArchive();for(let i=0;i<4;i++)await new Promise(r=>setImmediate(r));
  const img=d.nodes.get('img1').querySelector('.rt-archived-media img');assert.equal(Boolean(img),expect);if(img){assert.equal(img.src,'https://i.redd.it/pic.jpeg');d.restoreRecoveredBodies();assert.equal(d.nodes.get('img1').querySelector('.rt-archived-media'),null);}
 }
});

test('pending source retry keeps published cards and the native prefix visible under one continuation loader',async t=>{
 let release,reads=0;const {W,d}=setup(t,{url:'https://www.reddit.com/user/Example/comments/',reddit:async()=>({posts:[],hasMore:false}),publicReddit:async()=>++reads===1?{posts:[comment()],hasMore:false}:new Promise(resolve=>release=resolve)});await d.ready;const style=W.document.createElement('style');style.textContent=fs.readFileSync('extension/post-discovery.css','utf8');W.document.head.append(style);await d.loadReddit();await new Promise(r=>setImmediate(r));const card=d.nodes.get(comment().fullname),content=card.firstElementChild,native=d.feed.firstElementChild;d.sourceErrors['comment-public']='Public search unavailable';const retry=d.loadReddit({retry:true});d.deduplicate();assert.equal(d.busy,true);assert.equal(card.hidden,false);assert.equal(card.firstElementChild,content);assert.notEqual(W.getComputedStyle(card).display,'none');assert.notEqual(W.getComputedStyle(native).display,'none');assert.equal(d.feed.querySelectorAll('shreddit-feed-page-loading').length,1);assert.equal(d.loading.hidden,false);release({posts:[],hasMore:false});await retry;
});

test('archived media fills the native profile thumbnail cell and remains stable across reconciliation',async t=>{
 const {W,d}=setup(t,{settings:{postDiscovery:true,archiveDiscovery:true,restoreDeletedContent:true},reddit:async()=>({posts:[raw('old12',{selftext:'[removed]'})],hasMore:false}),archive:async()=>({posts:[raw('old12',{url:'https://v.redd.it/synthetic',is_video:true,preview:{images:[{source:{url:'https://external-preview.redd.it/poster.png?s=synthetic',width:405,height:720}}]},media:{reddit_video:{hls_url:'https://v.redd.it/synthetic/HLSPlaylist.m3u8?a=synthetic',has_audio:true,width:1080,height:1920}}})],hasMore:false}),nativeRender:async(post,node)=>{node.innerHTML='<shreddit-post id="'+post.fullname+'" item-state="removed" post-type="link"><div class="grid grid-cols-[1fr_min-content] grid-rows-[auto_auto_auto] gap-x-2xs"><div class="col-start-1 col-end-3 row-start-1 row-end-2"><span slot="credit-bar"></span></div><div class="col-start-1 col-end-2 row-start-2 row-end-3"><div slot="text-body">[removed]</div></div><div class="col-start-2 col-end-3 row-start-2 row-end-3"></div></div></shreddit-post>';}});
 W.eval(fs.readFileSync('extension/archive-view.js','utf8'));await d.ready;await d.loadReddit();await d.loadArchive();await new Promise(r=>setImmediate(r));const card=d.nodes.get('old12'),cell=card.querySelector('.col-start-2'),preview=cell.querySelector('[data-testid="post-thumbnail"]');assert.ok(preview);assert.equal(preview.querySelector('img').src,'https://external-preview.redd.it/poster.png?s=synthetic');assert.equal(card.querySelector('shreddit-player'),null,'native profile link cards display a preview');const observer=new W.MutationObserver(()=>{});observer.observe(card,{childList:true,subtree:true});d.deduplicate();d.deduplicate();assert.equal(observer.takeRecords().length,0);observer.disconnect();d.reset();assert.equal(cell.querySelector('img'),null);
});

test('profile restored comments render archive images inline and remain restriction-aware',async t=>{
 const url='https://preview.redd.it/synthetic.jpeg?width=960&s=synthetic';
 for(const restricted of [false,true]){
  const {W,d}=setup(t,{url:'https://www.reddit.com/user/Example/comments/',settings:{postDiscovery:true,archiveDiscovery:true,restoreDeletedContent:true},reddit:async()=>({posts:[{id:'t1_image1',kind:'comment',author:'Example',body:'[removed]',created_utc:1700000000,link_id:'t3_abc12',over_18:restricted}],hasMore:false}),archive:async()=>({posts:[{id:'t1_image1',kind:'comment',author:'Example',body:url,created_utc:1700000000,link_id:'t3_abc12',media_metadata:{synthetic:{e:'Image',m:'image/jpeg',s:{u:url,x:960,y:1482}}}}],hasMore:false}),nativeRender:async(post,node)=>{node.innerHTML='<shreddit-profile-comment comment-id="'+post.fullname+'" is-comment-deleted><div><p class="md">[removed]</p></div></shreddit-profile-comment>';}});
  W.eval(fs.readFileSync('extension/markdown-lite.js','utf8'));await d.ready;await d.loadReddit();await d.loadArchive();await new Promise(r=>setImmediate(r));const card=d.nodes.get('t1_image1'),image=card.querySelector('.rt-comment-media img');if(restricted)assert.equal(image,null);else{assert.equal(image.src,url);assert.equal(image.height,1482);assert.equal(card.querySelector('.md').textContent.includes(url),false);}
 }
});

test('Reddit\'s original Feed options rows stay invisible until grouped, with a self-revealing fail-safe',()=>{
 const css=fs.readFileSync('extension/post-discovery.css','utf8');
 assert.match(css,/@keyframes rt-menu-reveal\{to\{visibility:visible\}\}/);
 assert.match(css,/html\[data-rt-profile-discovery\] main rpl-dropdown:has\(> button\[aria-label="Feed options"\]\) rpl-menu\.main-menu-container:not\(\[data-rt-menu-ready\]\)>:not\(\[data-rt-ui\]\)\{visibility:hidden;animation:rt-menu-reveal 0s 2\.5s forwards\}/);
 assert.doesNotMatch(css,/submenu-container[^{]*:not\(\[data-rt-menu-ready\]\)/,'Reddit\'s own submenus are never hidden');
 const manifest=JSON.parse(fs.readFileSync('extension/manifest.json','utf8'));assert.ok(manifest.content_scripts.some(entry=>entry.run_at==='document_start' && (entry.css || []).includes('post-discovery.css')),'loaded before Reddit renders the menu');
});
test('discovery reuses the document-start settings answer instead of asking the worker again',async t=>{
 const dom=new JSDOM('<main id="main-content"></main>',{url:'https://www.reddit.com/user/Example/',runScripts:'outside-only'}),W=dom.window;t.after(()=>W.close());let asks=0;
 W.chrome={runtime:{id:'fixture',sendMessage:async message=>{if(message.action==='get-settings')asks++;return {ok:true,settings:{postDiscovery:true,archiveDiscovery:false}};}}};
 W.eval(fs.readFileSync('extension/profile-notice.js','utf8'));for(const file of ['post-model.js','post-discovery.js'])W.eval(fs.readFileSync('extension/'+file,'utf8'));
 const d=W.RTDiscoveryDebug;await d.ready;try{assert.equal(d.settings.postDiscovery,true);assert.equal(asks,1,'one get-settings round trip per page');}finally{d.destroy();}
});

const leaveAndReturn=(W,d)=>{const profile=W.document.querySelector('main'),path=W.location.pathname;W.history.pushState({},'','/r/example/');W.document.body.innerHTML='<main id="main-content"></main>';d.scan();assert.equal(d.parked.size,1);W.history.pushState({},'',path);W.document.body.replaceChildren(profile);d.scan();};
test('leaving during the first load restarts it on Back instead of claiming activity was checked',async t=>{
 let calls=0;const {W,d}=setup(t,{reddit:(input,signal)=>new Promise((resolve,reject)=>{if(input.action!=='profile')return resolve({posts:[],hasMore:false});calls++;if(calls>1)return resolve({posts:[raw('later')],hasMore:false});signal?.addEventListener('abort',()=>reject(Error('Post request cancelled.')));})});
 await d.ready;const first=d.loadReddit();await new Promise(r=>setImmediate(r));assert.equal(d.busy,true);
 leaveAndReturn(W,d);await first.catch(()=>{});await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));await d.redditRun;await new Promise(r=>setImmediate(r));
 assert.equal(calls,2,'the interrupted first page is requested again');assert.equal(d.loaded,true);assert.ok(d.nodes.has('later'));assert.doesNotMatch(d.status.textContent,/checked/i,'never reports a dropped load as checked') ;
});
test('renders queued when leaving are queued again on Back and the batch publishes',async t=>{
 const releases=[];const {W,d}=setup(t,{reddit:async()=>({posts:Array.from({length:6},(_,i)=>raw('q'+i,{created_utc:1700000000-i})),hasMore:false}),nativeRender:async(post,node)=>{await new Promise(r=>releases.push(r));node.innerHTML='<shreddit-post id="'+post.fullname+'"><span slot="credit-bar"></span></shreddit-post>';}});
 await d.ready;d.loadReddit();await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));assert.ok([...d.nodes.values()].some(node=>node.dataset.rtNativeState==='queued'),'some renders wait in the queue');
 leaveAndReturn(W,d);for(let i=0;i<40 && [...d.nodes.values()].some(node=>node.dataset.rtNativeState!=='ready');i++){while(releases.length)releases.shift()();await new Promise(r=>setImmediate(r));}
 assert.deepEqual([...d.nodes.values()].map(node=>node.dataset.rtNativeState),Array(6).fill('ready'));assert.equal(d.activeProfileBatch,null,'the batch settled and published');
});
test('a scheduled retry survives leaving and returning, quietly until retries keep failing',async t=>{
 const {W,d}=setup(t,{timing:{retryUnitMs:60000},reddit:async input=>{if(input.action==='profile')throw Error('Reddit returned an error (HTTP 503).');return {};}});
 await d.ready;await d.loadReddit();await new Promise(r=>setImmediate(r));assert.equal(d.sourceRetries.size,1);
 leaveAndReturn(W,d);await new Promise(r=>setImmediate(r));
 assert.equal(d.sourceRetries.size,1,'still scheduled');assert.ok([...d.sourceRetries.values()][0].timer,'re-armed');assert.doesNotMatch(d.loading.textContent,/Retrying in|isn’t responding/,'a quick first retry shows no note');assert.equal(d.loading.hidden,false,'the loader stays up');
 [...d.sourceRetries.values()][0].visible=true;d.updateProfileLoading();assert.match(d.loading.textContent,/Retrying in/,'repeated failures do get a note');d.clearSourceRetries();
});
test('flags that describe in-flight work do not survive parking',async t=>{
 const {W,d}=setup(t);await d.ready;await d.loadReddit();await new Promise(r=>setImmediate(r));
 d.recoveryActive=true;d.recoveryTimer=123;d.batchFrame=77;d.discover.disabled=true;d.host.setAttribute('aria-busy','true');
 leaveAndReturn(W,d);assert.equal(d.recoveryActive,false);assert.equal(d.recoveryTimer,null);assert.equal(d.batchFrame,null);assert.equal(d.discover.disabled,false);assert.equal(d.host.hasAttribute('aria-busy'),false);
});

test('Comments Feed options groups its Sort rows beside Activity, with no View group, like Posts',async t=>{
 const {W,d}=setup(t,{url:'https://www.reddit.com/user/Example/comments/'});await d.ready;d.reset();
 const menu=W.document.querySelector('main rpl-menu.main-menu-container');for(const node of [...menu.children])if(node.textContent.trim()==='View' || node.getAttribute('aria-label')==='Compact')node.remove();
 d.scan();await new Promise(r=>setImmediate(r));
 const dropdown=W.document.querySelector('main rpl-dropdown'),rows=[...dropdown.querySelector('.main-menu-container').children].filter(n=>n.matches('rpl-menu-item')).map(n=>n.getAttribute('aria-label'));
 assert.deepEqual(rows,['Sort','Activity'],'sort rows live in a Sort submenu, like Overview and Posts');
 const sortSub=[...dropdown.querySelectorAll('rpl-menu.rt-activity-submenu')].find(sub=>sub.querySelector('rpl-menu-item[aria-label="New"]'));assert.ok(sortSub);assert.equal(dropdown.querySelector('[data-rt-activity-filter="hidden"]')!=null && dropdown.querySelector('[data-rt-activity-filter="deleted"]')!=null && dropdown.querySelector('[data-rt-ui="activity-refresh"]')!=null,true);
 assert.equal(dropdown.querySelector('button[aria-label="Feed options"]')!=null,true);
});

const creditRow=(extra='')=>`<div slot="credit-bar" class="contents"><div class="flex flex-wrap items-center gap-2xs text-12 min-h-[24px]" id="feed-post-credit-bar-t3_native"><span class="relative"><a href="/r/trains/">r/trains</a></span><span>•</span><faceplate-timeago>2mo ago</faceplate-timeago><shreddit-async-loader><shreddit-status-icons><rpl-tooltip content="Stickied post"><svg></svg></rpl-tooltip></shreddit-status-icons></shreddit-async-loader>${extra}</div></div>`;
test('the status indicator sits inline at the end of Reddit\'s credit row in compact and card views',async t=>{
 for(const view of ['compactView','cardView']){
  const {d}=setup(t,{nativeRender:async(post,node)=>{node.innerHTML=`<shreddit-post id="${post.fullname}" view-type="${view}">${creditRow()}<div slot="title">T</div></shreddit-post>`;}});
  await d.ready;await d.loadReddit();await new Promise(r=>setImmediate(r));const node=d.nodes.get('abc12'),post=d.postMetadata.get('abc12'),slot=node.querySelector('[slot="credit-bar"]'),row=slot.firstElementChild,badge=node.querySelector('[data-rt-source]');
  assert.equal(badge.parentElement,row,view+': inside the inner flex row');assert.equal(row.lastElementChild,badge,'after the pin and status icons');assert.equal(slot.children.length,1,'no extra grid item beside the row');
  for(const status of ['deleted','removed'])d.decorateNative({...post,status},node);d.decorateNative({...post,source:'arctic-shift',status:'unknown'},node);
  assert.equal(node.querySelectorAll('[data-rt-source]').length,1);assert.equal(row.lastElementChild,node.querySelector('[data-rt-source]'));assert.equal(slot.children.length,1);
 }
});
test('the status indicator stays last in the credit row when Reddit adds items afterwards, and keeps the overflow menu placement in card rows',async t=>{
 const {d}=setup(t,{nativeRender:async(post,node)=>{node.innerHTML=`<shreddit-post id="${post.fullname}">${creditRow()}</shreddit-post>`;}});await d.ready;await d.loadReddit();await new Promise(r=>setImmediate(r));
 const node=d.nodes.get('abc12'),row=node.querySelector('#feed-post-credit-bar-t3_native'),late=row.ownerDocument.createElement('span');row.append(late);d.decorateNative({...d.postMetadata.get('abc12')},node);assert.equal(row.lastElementChild,node.querySelector('[data-rt-source]'));
 const card=setup(t,{nativeRender:async(post,node)=>{node.innerHTML=`<shreddit-post id="${post.fullname}">${creditRow('<span data-actions><shreddit-post-overflow-menu></shreddit-post-overflow-menu></span>')}</shreddit-post>`;}});await card.d.ready;await card.d.loadReddit();await new Promise(r=>setImmediate(r));
 const badge=card.d.nodes.get('abc12').querySelector('[data-rt-source]');assert.equal(badge.parentElement.hasAttribute('data-actions'),true);assert.equal(badge.nextElementSibling.localName,'shreddit-post-overflow-menu');
});
test('the credit-row badge has no outer margin so Reddit\'s row gap spaces it',()=>{
 const css=fs.readFileSync('extension/post-discovery.css','utf8');assert.match(css,/\[id\^="feed-post-credit-bar-"\]>\.rt-post-indicator\{margin:0/);
});

test('a deleted comment permalink plays Reddit\'s toast with our wording once restored, or the original otherwise',async t=>{
  const page=async settings=>{
    const dom=new JSDOM('',{url:'https://www.reddit.com/r/example/comments/abc12/title/comment/def34/',runScripts:'outside-only'}),W=dom.window;t.after(()=>W.close());
    W.chrome={runtime:{id:'fixture',sendMessage:async()=>({ok:true,settings})}};W.eval(fs.readFileSync('extension/profile-notice.js','utf8'));
    const alert=W.document.createElement('faceplate-alert');alert.setAttribute('level','notice');alert.setAttribute('message','This comment no longer exists');W.document.body.append(alert);
    for(let i=0;i<3;i++)await new Promise(r=>setImmediate(r));
    const shown=()=>[...W.document.querySelectorAll('faceplate-alert')].map(n=>n.getAttribute('message'));
    return {W,alert,shown};
  };
  const on={postDiscovery:true,archiveDiscovery:true,restoreDeletedContent:true};
  const restored=await page(on);assert.deepEqual(restored.shown(),[],'held until the restorer answers');
  assert.equal(restored.W.RTProfileNoticeGuard.resolveCommentAlert('t1_other','deleted'),false);
  assert.equal(restored.W.RTProfileNoticeGuard.resolveCommentAlert('t1_def34','deleted'),true);assert.deepEqual(restored.shown(),['Deleted comment retrieved from Arctic Shift']);
  assert.equal(restored.W.document.querySelector('faceplate-alert').getAttribute('level'),'notice');
  const missing=await page(on);missing.W.RTProfileNoticeGuard.resolveCommentAlert('t1_def34','');assert.deepEqual(missing.shown(),['This comment no longer exists']);
  for(let i=0;i<2;i++)await new Promise(r=>setImmediate(r));assert.deepEqual(missing.shown(),['This comment no longer exists'],'a released toast is not held again');
  const off=await page({...on,restoreDeletedContent:false});assert.deepEqual(off.shown(),['This comment no longer exists']);
});

test('an unavailable profile header always uses Reddit\'s grey suspended snoo, whatever its notice shows',async t=>{
 const {W,d}=setup(t);await d.ready;
 for(const [src,expect] of [['https://www.redditstatic.com/shreddit/assets/mod/snoo-404.png','https://www.redditstatic.com/shreddit/assets/suspended-snoo.png'],['https://evil.example/shreddit/assets/x.png','https://www.redditstatic.com/shreddit/assets/suspended-snoo.png']]){
  d.reset();const notice=deletedPage(W);notice.querySelector('img').setAttribute('src',src);d.scan();
  assert.equal(d.avatarPlaceholder.querySelector('img').src,expect);
 }
});
// Feed filters (date, post type, subreddit, Old sort) in Reddit's Feed options menu.
const filtered=(t,url,options={})=>{const made=setup(t,{url:'https://www.reddit.com/user/Example/submitted/'+url,pre:['feed-filters.js'],...options});return made;};
const addNative=(W,d,id,{ts,type,sub}={})=>{const card=W.document.createElement('shreddit-post');card.id=id;if(ts)card.setAttribute('created-timestamp',new Date(ts*1000).toISOString());if(type)card.setAttribute('post-type',type);if(sub)card.setAttribute('subreddit-name',sub);d.feed.append(card);return card;};
const chipRemove=(W,id)=>W.document.querySelector('[data-rt-chip="'+id+'"] button');
test('filters add Date, Post type and Subreddit groups with Reddit-style checked rows',async t=>{
  const {W,d}=filtered(t,'?rt_type=image&rt_date=week');await d.ready;
  for(const name of ['Date','Post type','Subreddit'])assert.ok(d.activityMain.parentElement.querySelector('[data-rt-filter-group="'+name+'"]'),name);
  const row=value=>d.activityMain.parentElement.querySelector('[data-rt-option="'+value+'"]');
  assert.equal(row('image').getAttribute('aria-checked'),'true');assert.ok(row('image').querySelector('[data-rt-check]'));assert.equal(row('all').getAttribute('aria-checked'),'false');assert.equal(row('week').getAttribute('aria-checked'),'true');assert.equal(row('any').getAttribute('aria-checked'),'false');
  assert.equal(d.activityMain.querySelector('[data-rt-filter-group="Post type"] [data-rt-menu-value]').textContent,'Images');
  row('text').click();assert.equal(W.location.search,'?rt_date=week&rt_type=image,text');assert.equal(row('text').getAttribute('aria-checked'),'true');
  row('all').click();assert.equal(W.location.search,'?rt_date=week');
});
test('native cards that fail the filters are hidden and chips restore them',async t=>{
  const now=Math.floor(Date.now()/1000),{W,d}=filtered(t,'?rt_type=image&rt_sub=Alpha');await d.ready;
  const ok=addNative(W,d,'t3_ok',{ts:now-60,type:'image',sub:'alpha'}),wrongType=addNative(W,d,'t3_text',{ts:now-60,type:'text',sub:'alpha'}),wrongSub=addNative(W,d,'t3_sub',{ts:now-60,type:'image',sub:'beta'});
  d.deduplicate();
  assert.equal(ok.hasAttribute('data-rt-filter-hidden'),false);assert.equal(wrongType.hasAttribute('data-rt-filter-hidden'),true);assert.equal(wrongSub.hasAttribute('data-rt-filter-hidden'),true);
  const key=d.context.key,host=d.host;
  // A real mouse click: the chip survives mousedown and the click removes it.
  const x=chipRemove(W,'type:image');x.dispatchEvent(new W.MouseEvent('mousedown',{bubbles:true}));assert.ok(x.isConnected);x.click();
  assert.equal(W.location.search,'?rt_sub=Alpha');assert.equal(wrongType.hasAttribute('data-rt-filter-hidden'),false);assert.equal(wrongSub.hasAttribute('data-rt-filter-hidden'),true);
  assert.equal(d.context.key,key);assert.equal(d.host,host);
  W.document.querySelector('[data-rt-filter-clear]').click();assert.equal(W.location.search,'');assert.equal(wrongSub.hasAttribute('data-rt-filter-hidden'),false);assert.equal(d.rtChips.hidden,true);
});
test('filters survive a context rescan, reload from the URL and follow back/forward',async t=>{
  const {W,d}=filtered(t,'?sort=new&rt_type=video');await d.ready;await d.loadReddit();await new Promise(r=>setImmediate(r));
  const key=d.context.key;d.scan();d.scan({cheap:true});assert.equal(d.context.key,key);assert.deepEqual([...d.rtFilters.types],['video']);
  assert.equal(d.nodes.size>0,true);
  W.history.replaceState(null,'','/user/Example/submitted/?sort=new&rt_type=gallery');d.scan();assert.deepEqual([...d.rtFilters.types],['gallery']);assert.equal(d.context.key,key);assert.ok(chipRemove(W,'type:gallery'));
  W.history.replaceState(null,'','/user/Example/submitted/?sort=new');d.scan();assert.equal(d.rtActive(),false);
});
test('archive-backed filters search through RTArchiveQuery and Old lists the archive oldest first',async t=>{
  const calls=[],made=filtered(t,'',{settings:{postDiscovery:true,archiveDiscovery:true}}),{W,d}=made;await d.ready;
  const items=[raw('newer',{created_utc:1700000200}),raw('older',{created_utc:1700000100}),raw('oldest',{created_utc:1700000000})].map(r=>({...W.RTPostModel.normalizePost(r,{source:'arctic-shift'}),postType:'text'}));
  W.RTArchiveQuery={async *search(args){calls.push(args);const asc=args.sort==='asc';yield {items:asc?[...items].reverse():items,searchedBackTo:asc?1700000200:1700000000,hasMore:false,serverFiltered:false,cursor:null,stalled:false,mode:'server'};},async aggregate(){return {ok:true,buckets:[],by:'subreddit',source:'server'};}};
  d.clearActivityMenu();d.ensureActivityMenu();
  const old=d.activityMain.parentElement.querySelector('[data-rt-option="old"]');assert.ok(old);assert.match(old.textContent,/From the archive/);
  old.click();await new Promise(r=>setTimeout(r,20));
  assert.equal(W.location.search,'?rt_sort=old');assert.equal(calls.at(-1).sort,'asc');assert.equal(d.renderedPosts.map(p=>p.id).join(),'oldest,older,newer');
  assert.equal(d.feed.querySelector('shreddit-post#t3_native').closest('[data-rt-filter-hidden]')!==null,true);
  assert.equal(old.getAttribute('aria-checked'),'true');assert.match(d.status.textContent+d.notice.textContent,/./);assert.match(d.status.textContent,/may be incomplete/);
  // Date window and single subreddit go to the server; no sort param returns to newest first.
  const next=W.RTFeedFilters.parse('?rt_date=2023-11-14..2023-11-15&rt_sub=Alpha');d.setFilters(next);await new Promise(r=>setTimeout(r,20));
  const last=calls.at(-1);assert.equal(last.sort,'desc');assert.equal(last.subreddit,'Alpha');assert.equal(last.kind,'post');assert.ok(last.after<last.before);
});
test('subreddit options use aggregate counts and fall back to loaded items with a label',async t=>{
  const {W,d}=filtered(t,'',{settings:{postDiscovery:true,archiveDiscovery:true}});await d.ready;
  let fail=false;W.RTArchiveQuery={async *search(){},async aggregate(){if(fail)throw Object.assign(Error('slow'),{code:'timeout'});return {ok:true,buckets:[{key:'big',count:40},{key:'small',count:2}],by:'subreddit',source:'server'};}};
  addNative(W,d,'t3_live',{ts:Math.floor(Date.now()/1000),type:'text',sub:'loadedonly'});
  d.clearActivityMenu();d.ensureActivityMenu();
  const group=d.activityMain.parentElement.querySelector('[data-rt-filter-group="Subreddit"]'),list=()=>[...d.rtMenu.sub.list.querySelectorAll('[data-rt-sub-row]')].map(el=>el.textContent.trim());
  group.click();await new Promise(r=>setTimeout(r,10));
  assert.match(list()[0],/r\/big\s*40/);assert.ok(list().some(x=>/loadedonly/.test(x)));assert.match(d.rtMenu.sub.note.dataset.rtSource,/archive/);
  d.rtMenu.sub.list.querySelector('[data-rt-sub-row="big"]').click();assert.equal(W.location.search,'?rt_sub=big');assert.equal(d.rtMenu.sub.list.querySelector('[data-rt-sub-row="big"]').getAttribute('aria-checked'),'true');
  fail=true;d.rtAgg=null;d.setFilters({...W.RTFeedFilters.empty()});group.click();await new Promise(r=>setTimeout(r,10));
  assert.equal(d.rtMenu.sub.note.dataset.rtSource,'Counts from loaded items');assert.ok(list().some(x=>/loadedonly/.test(x)));assert.ok(!list().some(x=>/big/.test(x)));
  d.rtMenu.sub.input.value='loaded';d.rtMenu.sub.input.dispatchEvent(new W.Event('input'));assert.equal(list().length,1);
});
test('filters hiding everything show an empty state and never an unfiltered Activity checked',async t=>{
  const {W,d}=filtered(t,'?rt_sub=nothing-here');await d.ready;await d.loadReddit();await new Promise(r=>setImmediate(r));
  d.moreReddit=d.moreArchive=false;d.render({reuseCards:true});await new Promise(r=>setImmediate(r));
  assert.ok(d.activityEmpty && !d.activityEmpty.hidden);assert.match(d.emptyTitle.textContent,/^No posts found$/);assert.match(d.status.textContent,/No matches in loaded activity/);
});

// Redesigned Feed options menus: rows, submenus, community icons, and the open/close regressions.
const menuCss=fs.readFileSync('extension/post-discovery.css','utf8');
const cssRule=selector=>{const at=menuCss.indexOf('\n'+selector+'{');assert.ok(at>=0,selector);return menuCss.slice(at,menuCss.indexOf('}',at));};
const menuSetup=async(t,url='',options={})=>{
  const made=filtered(t,url,{pre:['feed-filters.js','community-icons.js'],...options}),{W,d}=made;await d.ready;
  const dropdown=W.document.querySelector('main rpl-dropdown');dropdown.setAttribute('open','');
  const content=()=>d.activityMain.parentElement,sub=key=>content().querySelector('[data-rt-sub-key="'+key+'"]'),group=name=>d.activityMain.querySelector('[data-rt-filter-group="'+name+'"]');
  const icon=el=>el.querySelector('svg[icon-name],[data-icon]')?.getAttribute('icon-name') || el.querySelector('[data-icon]')?.dataset.icon || '';
  const shown=()=>[...content().children].filter(n=>n.matches('rpl-menu.rt-activity-submenu')&&!n.classList.contains('hidden'));
  return {...made,dropdown,content,sub,group,icon,shown};
};
const tick=(ms=0)=>new Promise(r=>setTimeout(r,ms));
test('main menu rows: Date, Post type and Subreddit with icons and right-aligned values',async t=>{
  const m=await menuSetup(t);const {d}=m;
  const names=[...d.activityMain.children].filter(n=>n.matches('rpl-menu-item')).map(n=>n.getAttribute('aria-label'));
  assert.deepEqual(names.slice(-3),['Date','Post type','Subreddit']);assert.ok(names.indexOf('Activity')<names.indexOf('Date'));
  assert.deepEqual([m.icon(m.group('Date')),m.icon(m.group('Post type')),m.icon(m.group('Subreddit'))],['calendar','text-post','community']);
  const value=name=>m.group(name).querySelector('[data-rt-menu-value]');
  assert.deepEqual(['Date','Post type','Subreddit'].map(n=>value(n).textContent),['Any time','All','All']);
  assert.ok(value('Date').classList.contains('rt-menu-value'));
  assert.equal(m.group('Date').querySelector('.rt-menu-lead').getAttribute('width'),'16','leading glyph uses Reddit’s 16px menu size');
  assert.match(cssRule('.rt-menu-lead'),/width:16px;height:16px/);
  const css=cssRule('.rt-menu-value');assert.match(css,/overflow:hidden/);assert.match(css,/text-overflow:ellipsis/);assert.match(css,/white-space:nowrap/);assert.match(cssRule('.rt-menu-caption'),/flex:none/);
  const set=await menuSetup(t,'?rt_date=year&rt_type=image,gif,poll&rt_sub=announcements');
  assert.deepEqual(['Date','Post type','Subreddit'].map(n=>set.group(n).querySelector('[data-rt-menu-value]').textContent),['Past year','3 types','r/announcements']);
  const range=await menuSetup(t,'?rt_date=2026-10-01..2026-10-20&rt_type=image&rt_sub=a,b,c');
  assert.match(range.group('Date').querySelector('[data-rt-menu-value]').textContent.replace(/ /g,' '),/^Oct 1 – Oct 20(,? 2026)?$/);assert.equal(range.group('Post type').querySelector('[data-rt-menu-value]').textContent,'Images');assert.equal(range.group('Subreddit').querySelector('[data-rt-menu-value]').textContent,'3 communities');
});
test('Date submenu: six single-choice rows with shared outline icons',async t=>{
  const m=await menuSetup(t,'?rt_date=month');const rows=[...m.sub('date').querySelectorAll('[data-rt-option]')];
  assert.deepEqual(rows.map(r=>r.dataset.rtOption),['any','24h','week','month','year','custom']);
  assert.deepEqual(rows.map(r=>r.getAttribute('aria-label')),['Any time','Past 24 hours','Past week','Past month','Past year','Custom…']);
  for(const row of rows){assert.equal(row.querySelector('.rt-menu-lead').dataset.icon,row.dataset.rtOption==='any'?'show':'calendar');assert.equal(row.querySelector('.rt-menu-lead').getAttribute('width'),'16');}
  assert.deepEqual(rows.filter(r=>r.getAttribute('aria-checked')==='true').map(r=>r.dataset.rtOption),['month']);assert.equal(rows.filter(r=>r.querySelector('[data-rt-check]')).length,1);
  assert.ok(m.sub('date').querySelector('[aria-label="Back"]'));
});
test('Post type submenu: sections, Reddit icons, multi-select that stays open and clears with All types',async t=>{
  const m=await menuSetup(t);const {W,d}=m,type=m.sub('type');m.group('Post type').click();assert.equal(d.openSubmenu,type);
  const kids=[...type.querySelector('[data-rt-menu-list]').children].map(n=>n.dataset.rtSection?'#'+n.dataset.rtSection:n.dataset.rtOption);
  assert.deepEqual(kids,['all','#Text','text','textmedia','poll','#Media','image','gif','video','gallery','#Links','link','embed','crosspost']);
  assert.equal(type.querySelector('[data-rt-option="all"]').getAttribute('aria-label'),'All types');assert.equal(type.querySelector('[data-rt-option="all"] .rt-menu-lead').dataset.icon,'show');
  const expect={text:'text-post',textmedia:'collection',poll:'list-bulleted',image:'image',gif:'gif-post-outline',video:'video',gallery:'gallery',link:'link',embed:'browser',crosspost:'rotate'};
  for(const [id,name] of Object.entries(expect)){const row=type.querySelector('[data-rt-option="'+id+'"]');assert.equal(m.icon(row),name,id);}
  assert.equal(type.querySelector('[data-rt-option="gif"] svg').getAttribute('width'),'16');
  assert.deepEqual([...type.querySelectorAll('[data-rt-section]')].map(n=>n.getAttribute('role')),['presentation','presentation','presentation']);
  const row=id=>type.querySelector('[data-rt-option="'+id+'"]');
  row('image').click();row('gif').click();row('poll').click();
  assert.equal(W.location.search,'?rt_type=image,gif,poll');assert.equal(d.openSubmenu,type);assert.ok(m.dropdown.hasAttribute('open'),'multi-select stays open');
  assert.equal(m.group('Post type').querySelector('[data-rt-menu-value]').textContent,'3 types');assert.ok(W.document.querySelector('[data-rt-chip="type:gif"]'),'chips update live');
  assert.equal(row('all').getAttribute('aria-checked'),'false');assert.deepEqual(['image','gif','poll'].map(id=>row(id).getAttribute('aria-checked')),['true','true','true']);
  row('gif').click();assert.equal(W.location.search,'?rt_type=image,poll');
  row('all').click();assert.equal(W.location.search,'');assert.equal(row('all').getAttribute('aria-checked'),'true');assert.ok(m.dropdown.hasAttribute('open'));
});
test('Post type is not offered on the Comments tab',async t=>{
  const m=await menuSetup(t,'');m.d.context.view='comments';m.d.clearActivityMenu();m.d.ensureActivityMenu();
  assert.equal(m.group('Post type'),null);assert.ok(m.group('Date'));
});
test('Subreddit submenu: header row, scrolling list, icons, pinned picks, 8-pick limit and a truthful footer',async t=>{
  const buckets=Array.from({length:14},(_,i)=>({key:'sub'+String(i).padStart(2,'0'),count:100-i})).concat([{key:'u_spez',count:1}]);
  const m=await menuSetup(t,'',{settings:{postDiscovery:true,archiveDiscovery:true}});const {W,d}=m;
  let release;const gate=new Promise(r=>release=r);
  W.RTArchiveQuery={async *search(){},async aggregate(){await gate;return {ok:true,buckets,by:'subreddit',source:'server'};}};
  const asked=[];W.RTCommunityIcons={peek:()=>undefined,get:async name=>{asked.push(name);return name==='sub01'?'https://styles.redditmedia.com/t5_1/styles/communityIcon_one.png':null;}};
  d.clearActivityMenu();d.ensureActivityMenu();dropdownOpen(m);
  const panel=m.sub('sub'),list=d.rtMenu.sub.list,note=d.rtMenu.sub.note;
  m.group('Subreddit').click();assert.equal(d.openSubmenu,panel);assert.equal(note.dataset.rtSource,'Loading counts…');
  release();await tick(20);
  // One header row: Back on the left, the pill search on the right; the list is the only scroller.
  const head=panel.querySelector('.rt-sub-head');assert.equal(head.firstElementChild.dataset.rtSubBack,'true');assert.equal(head.firstElementChild.getAttribute('aria-label'),'Back');assert.ok(head.lastElementChild.matches('.rt-filter-field'));assert.equal(head.querySelector('.rt-filter-search').placeholder,'Search communities');assert.equal(head.lastElementChild.children[0].dataset.icon,'search');assert.ok(head.lastElementChild.querySelector('.rt-filter-search-clear'));assert.equal(head.firstElementChild.querySelector('svg').getAttribute('width'),'16');assert.equal(panel.querySelectorAll('[data-rt-sub-back]').length,1);assert.equal(panel.querySelector('[aria-label="Back"][aria-haspopup]'),null);
  assert.equal(list.parentElement,panel.querySelector('.rt-sub-panel'));assert.ok(!head.contains(list));
  const css=cssRule('.rt-sub-list');assert.match(css,/overflow-y:auto/);assert.match(css,/overscroll-behavior:contain/);assert.match(css,/max-height:min\(320px,calc\(100dvh/);
  assert.match(cssRule('.rt-activity-submenu[data-rt-panel]'),/overflow:visible/);
  assert.equal(note.dataset.rtSource,'Counts from the archive');
  const rows=()=>[...list.querySelectorAll('[data-rt-sub-row]')];
  assert.equal(rows().length,15);assert.match(rows()[0].textContent,/r\/sub00\s*100/);assert.ok(rows().every(r=>r.querySelector('.rt-community-icon')));
  assert.equal(rows().find(r=>r.dataset.rtSubRow==='u_spez').querySelector('svg').getAttribute('icon-name'),'author');assert.match(rows().find(r=>r.dataset.rtSubRow==='u_spez').textContent,/u\/spez/);
  assert.equal(rows()[0].querySelector('svg').getAttribute('icon-name'),'community','outline placeholder until the icon loads');assert.ok(rows().every(r=>r.querySelector('.rt-sub-icon-box')));assert.ok(rows().every(r=>r.querySelector('.rt-sub-name')));
  await tick(10);assert.equal(rows().find(r=>r.dataset.rtSubRow==='sub01').querySelector('img.rt-community-img').getAttribute('src'),'https://styles.redditmedia.com/t5_1/styles/communityIcon_one.png');assert.ok(asked.includes('sub01'));
  // Selected rows are pinned at the top and show a checkmark; the list scroll is kept.
  rows().find(r=>r.dataset.rtSubRow==='sub05').click();assert.equal(W.location.search,'?rt_sub=sub05');assert.equal(rows()[0].dataset.rtSubRow,'sub05');assert.ok(rows()[0].querySelector('[data-rt-check]'));assert.equal(d.openSubmenu,panel);
  for(const k of ['sub03','sub07','sub09','sub11','sub12','sub13','sub10'])rows().find(r=>r.dataset.rtSubRow===k).click();
  assert.equal(d.rtFilters.subreddits.length,8);const blocked=rows().filter(r=>r.getAttribute('aria-disabled')==='true');assert.equal(blocked.length,15-8);assert.match(blocked[0].title,/Up to 8 communities/);assert.match(note.dataset.rtSource,/Counts from the archive/);
  blocked[0].click();assert.equal(d.rtFilters.subreddits.length,8);rows()[0].click();assert.equal(d.rtFilters.subreddits.length,7);assert.equal(rows().filter(r=>r.getAttribute('aria-disabled')==='true').length,0);
  // Search narrows the list and keeps the header.
  d.rtMenu.sub.input.value='sub0';d.rtMenu.sub.input.dispatchEvent(new W.Event('input'));assert.ok(rows().every(r=>/sub0|u_spez/.test(r.dataset.rtSubRow)||d.rtFilters.subreddits.includes(r.dataset.rtSubRow)));
  const clear=panel.querySelector('.rt-filter-search-clear');assert.equal(clear.hidden,false);clear.click();assert.equal(d.rtMenu.sub.input.value,'');assert.equal(clear.hidden,true);assert.equal(W.document.activeElement,d.rtMenu.sub.input);
  panel.querySelector('[data-rt-sub-back]').click();assert.equal(d.openSubmenu,null);
});
const dropdownOpen=m=>m.dropdown.setAttribute('open','');
test('the footer never claims archive counts it does not have',async t=>{
  const m=await menuSetup(t,'',{settings:{postDiscovery:true,archiveDiscovery:true}});const {W,d}=m;
  W.RTArchiveQuery={async *search(){},async aggregate(){throw Object.assign(Error('slow'),{code:'timeout'});}};addNative(W,d,'t3_live',{ts:Math.floor(Date.now()/1000),type:'text',sub:'loadedonly'});
  d.clearActivityMenu();d.ensureActivityMenu();m.group('Subreddit').click();await tick(10);
  assert.equal(d.rtMenu.sub.note.dataset.rtSource,'Counts from loaded items');
  // A different query (the date window) invalidates earlier archive totals instead of mislabelling them.
  W.RTArchiveQuery={async *search(){},async aggregate(){return {ok:true,buckets:[{key:'big',count:9}],by:'subreddit'};}};
  d.rtAgg=null;m.group('Subreddit').click();await tick(10);assert.equal(d.rtMenu.sub.note.dataset.rtSource,'Counts from the archive');
  d.setFilters(W.RTFeedFilters.parse('?rt_date=week'));assert.equal(d.rtAgg,null);assert.notEqual(d.rtMenu.sub.note.dataset.rtSource,'Counts from the archive');assert.equal(d.rtMenu.sub.note.hidden,true,'counts source is not shown in the menu');
  const off=await menuSetup(t,'');addNative(off.W,off.d,'t3_x',{ts:Math.floor(Date.now()/1000),type:'text',sub:'zzz'});off.d.clearActivityMenu();off.d.ensureActivityMenu();off.group('Subreddit').click();assert.equal(off.d.rtMenu.sub.note.dataset.rtSource,'Counts from loaded items');
});
test('choosing a single option closes the whole menu, multi-select lists stay open',async t=>{
  const m=await menuSetup(t);const {W,d,dropdown}=m;let closed=0;
  // Reddit's dropdown may ignore removeAttribute and only react to its own close().
  dropdown.close=()=>{closed++;};
  const reopen=()=>{dropdown.setAttribute('open','');};
  for(const [group,option] of [['Date','week'],['Date','any'],['Date','year']]){m.group(group).click();m.sub('date').querySelector('[data-rt-option="'+option+'"]').click();assert.equal(dropdown.hasAttribute('open'),false,group+' '+option);assert.equal(d.openSubmenu,null);reopen();}
  assert.ok(closed>=3);
  m.group('Post type').click();m.sub('type').querySelector('[data-rt-option="image"]').click();assert.ok(dropdown.hasAttribute('open'));m.sub('type').querySelector('[data-rt-option="video"]').click();assert.ok(dropdown.hasAttribute('open'));
  m.sub('type').querySelector('[aria-label="Back"]').click();assert.equal(d.openSubmenu,null);assert.ok(dropdown.hasAttribute('open'));
  // Activity choices close too, even when the dropdown re-asserts itself for a tick.
  d.activityMain.querySelector('[data-rt-activity]').click();let stubborn=true;dropdown.close=()=>{};const original=dropdown.removeAttribute.bind(dropdown);dropdown.removeAttribute=name=>{if(name==='open' && stubborn){stubborn=false;return;}original(name);};
  d.activityMenu.querySelector('[data-rt-activity-filter="hidden"]').click();await tick(5);assert.equal(dropdown.hasAttribute('open'),false);
});
test('opening Feed options always starts at the main menu',async t=>{
  const m=await menuSetup(t);const {W,d,dropdown}=m;
  m.group('Post type').click();assert.equal(d.openSubmenu,m.sub('type'));assert.equal(m.shown().length,1);
  // Closed and opened again by Reddit.
  dropdown.removeAttribute('open');await tick(0);dropdown.setAttribute('open','');await tick(0);
  assert.equal(d.openSubmenu,null);assert.equal(m.shown().length,0);assert.equal(d.activityMain.classList.contains('hidden'),false);
  // A trigger click while a submenu is showing also lands on the main menu, and each row opens its own submenu only.
  m.group('Subreddit').click();assert.equal(d.openSubmenu,m.sub('sub'));
  dropdown.querySelector('button[aria-label="Feed options"]').click();assert.equal(d.openSubmenu,null);assert.equal(d.activityMain.classList.contains('hidden'),false);
  for(const [name,key] of [['Date','date'],['Post type','type'],['Subreddit','sub'],['Activity','activity']]){m.group(name)?.click?.();if(name==='Activity')d.activityMain.querySelector('[data-rt-activity]').click();else;const open=m.shown();assert.equal(open.length,1,name);assert.equal(open[0].dataset.rtSubKey,key,name);open[0].querySelector('[aria-label="Back"],[data-rt-sub-back]').click();}
  // If Reddit re-renders its menu while a filter list is open, the same list comes back.
  m.group('Post type').click();d.clearActivityMenu();d.ensureActivityMenu();assert.equal(d.openSubmenu?.dataset.rtSubKey,'type');
  d.clearActivityMenu();dropdown.removeAttribute('open');d.ensureActivityMenu();assert.equal(d.openSubmenu,null);
});
test('repeated opens and rebuilds never accumulate submenu elements',async t=>{
  const m=await menuSetup(t,'',{settings:{postDiscovery:true,archiveDiscovery:true}});const {W,d,dropdown}=m;
  W.RTArchiveQuery={async *search(){},async aggregate(){return {ok:true,buckets:[{key:'a',count:1}],by:'subreddit'};}};
  const census=()=>({subs:W.document.querySelectorAll('rpl-menu.rt-activity-submenu').length,groups:W.document.querySelectorAll('[data-rt-filter-group]').length,back:W.document.querySelectorAll('[data-rt-ui="submenu-back"]').length,owned:W.document.querySelectorAll('[data-rt-ui]').length,items:dropdown.querySelectorAll('rpl-menu-item').length,panels:W.document.querySelectorAll('[data-rt-sub-panel]').length,native:W.document.querySelectorAll('.main-menu-container > rpl-menu-item').length});
  d.clearActivityMenu();d.ensureActivityMenu();const first=census();assert.equal(first.groups,3);assert.equal(first.panels,1);
  for(let i=0;i<5;i++){
    for(const name of ['Date','Post type','Subreddit']){m.group(name).click();m.shown()[0].querySelector('[aria-label="Back"],[data-rt-sub-back]').click();}
    dropdown.removeAttribute('open');dropdown.setAttribute('open','');d.ensureActivityMenu();
    d.clearActivityMenu();d.ensureActivityMenu();
    d.detachActivityMenu();d.ensureActivityMenu();
  }
  assert.deepEqual(census(),first);
  assert.equal(d.menuGroups.length,2,'Sort and View are grouped again');assert.ok(d.menuGroups.every(g=>g.sub.querySelector('rpl-menu-item')),'Reddit\'s rows live in their group submenus');
});
test('chips use the menu icons and Clear filters is never clipped',async t=>{
  const m=await menuSetup(t,'?rt_date=year&rt_type=gif,video&rt_sub=announcements');const {W,d}=m;
  const chip=id=>W.document.querySelector('[data-rt-chip="'+id+'"]');
  assert.equal(m.icon(chip('date')),'calendar');assert.equal(m.icon(chip('type:video')),'video');assert.equal(chip('type:gif').querySelector('.rt-gif-tag').textContent,'GIF');assert.equal(m.icon(chip('sub:announcements')),'community-fill');
  assert.equal(chip('type:gif').querySelector('.rt-filter-chip-label').textContent,'GIFs');assert.equal(chip('sub:announcements').querySelector('.rt-filter-chip-label').textContent,'r/announcements');
  const clear=W.document.querySelector('[data-rt-filter-clear]');assert.equal(clear.textContent,'Clear filters');
  const css=cssRule('.rt-filter-chips .rt-filter-clear');assert.match(cssRule('.rt-filter-chips .rt-filter-chip-remove'),/height:18px/);assert.match(cssRule('.rt-filter-chips .rt-filter-chip-remove'),/padding:0/);assert.doesNotMatch(css,/overflow:\s*hidden/);assert.match(css,/overflow:visible/);assert.match(css,/width:auto/);assert.match(css,/white-space:nowrap/);assert.match(css,/min-width:max-content/);assert.match(cssRule('.rt-filter-chips'),/flex:0 0 100%/);
  assert.match(menuCss,/\n\.rt-posts-toolbar\{flex-wrap:wrap\}/);assert.match(cssRule('.rt-posts-toolbar .rt-posts-status[data-error=true],.rt-posts-toolbar .rt-posts-notice'),/flex:1 1 100%/);
});

test('profile menu uses one shared width, pinned headers and 16px outline glyphs',async t=>{
  const m=await menuSetup(t),{W,d}=m;
  const nativeRows=d.menuGroups.flatMap(group=>group.items);
  assert.equal(d.activityMain.parentElement.dataset.rtFeedOptionsHost,'true');
  assert.match(cssRule('[data-rt-feed-options-host]'),/--rt-menu-width:min\(272px,calc\(100vw - 32px\)\)/);
  assert.match(cssRule('[data-rt-feed-options-host]>rpl-menu'),/width:var\(--rt-menu-width\)/);
  assert.match(cssRule('.rt-activity-submenu[data-rt-feed-options]:not(.hidden)'),/height:auto;max-height:min\(400px,calc\(100dvh - 96px\)\)/,'submenus size to their own content');
  assert.match(cssRule('[data-rt-feed-options] rpl-menu-item'),/--rem48:40px;min-height:40px/);
  assert.match(cssRule('.rt-activity-submenu[data-rt-feed-options][data-rt-sub-key="sub"]:not(.hidden)'),/max-height:var\(--rt-menu-height,400px\)/,'Subreddit panel capped at the main menu height');
  assert.match(cssRule('.rt-activity-submenu[data-rt-feed-options]:not(.hidden)'),/overflow:hidden/);
  assert.equal((menuCss.match(/\n\.rt-sub-back\{/g)||[]).length,1,'one base rule for the back button');
  assert.equal(menuCss.includes('.rt-filter-search-box'),false,'unused search wrapper rule removed');
  const rows=[...d.activityMain.children].filter(el=>el.matches('rpl-menu-item'));
  assert.deepEqual(rows.map(el=>m.icon(el)),['sort','card','activity','calendar','text-post','community']);
  for(const row of rows){const icon=row.querySelector('.rt-menu-lead');assert.ok(icon);assert.equal(icon.getAttribute('width'),'16');}
  const nativeIcon=W.document.createElementNS('http://www.w3.org/2000/svg','svg');nativeIcon.setAttribute('icon-name','new-fill');d.menuGroups[0].items[0].append(nativeIcon);
  d.ensureActivityMenu();assert.equal(m.icon(rows[0]),'sort','native selected glyph never replaces the outline Sort icon');
  d.activityMain.getBoundingClientRect=()=>({height:340});
  for(const key of ['sort','view','activity','date','type','sub']){
    const sub=m.sub(key),row=rows.find(el=>el.rtSubmenu===sub);row.click();
    assert.equal(sub.style.getPropertyValue('--rt-menu-height'),'340px',key);
    const head=sub.querySelector('.rt-sub-head'),back=head.querySelector('.rt-sub-back'),list=sub.querySelector('.rt-sub-list');
    assert.ok(head);assert.ok(list);assert.ok(!list.contains(head));assert.equal(W.document.activeElement,back,key+' opens on Back');
    assert.equal(sub.querySelectorAll('.rt-sub-back').length,1);
    back.click();assert.equal(W.document.activeElement,row,key+' restores focus');
  }
  d.clearActivityMenu();assert.ok(nativeRows.every(row=>row.isConnected));assert.equal(nativeRows[0].firstChild.nodeType,W.Node.TEXT_NODE,'original native presentation is restored');assert.equal(W.document.querySelector('[data-rt-feed-options-host]'),null);
});
test('community field clears, shows a caption empty state and retains its outline fallback on image failure',async t=>{
  const m=await menuSetup(t),{W,d}=m;W.RTCommunityIcons={peek:()=> 'https://styles.redditmedia.com/t5_fixture/styles/communityIcon.png',get:async()=>null};
  const panel=d.rtMenu.sub.panel;panel.render({entries:[{key:'fixture',count:3}],picked:[],source:'loaded'});
  const box=panel.list.querySelector('.rt-sub-icon-box');box.querySelector('img').dispatchEvent(new W.Event('error'));assert.equal(box.querySelector('svg').dataset.icon,'community');
  panel.input.value='absent';panel.input.dispatchEvent(new W.Event('input'));assert.equal(panel.list.querySelector('.rt-sub-empty').textContent,'No communities match');
  assert.match(cssRule('[data-rt-feed-options] .rt-sub-icon-box img'),/object-position:center/);
  assert.match(cssRule('.rt-filter-field'),/height:32px/);assert.match(cssRule('.rt-filter-field'),/border-radius:16px/);
  assert.match(cssRule('[data-rt-feed-options] .rt-sub-icon-box img'),/position:absolute;inset:0/);assert.match(cssRule('[data-rt-feed-options] .rt-sub-icon-box'),/clip-path:circle\(50%/);
  assert.match(cssRule('.rt-filter-field:focus-within'),/border-color:var\(--color-neutral-content-weak/);
  assert.match(cssRule('.rt-filter-field .rt-filter-search:focus'),/outline:0;box-shadow:none/);
  assert.match(cssRule('[data-rt-feed-options] .rt-filter-note,[data-rt-feed-options] .rt-sub-empty'),/padding:8px 16px 8px 48px/);
});
test('wrapped submenu lists retain keyboard navigation, native handlers and teardown',async t=>{
  const m=await menuSetup(t),{W,d}=m;
  d.clearActivityMenu();
  const native=d.activityMain || W.document.querySelector('.main-menu-container'),newRow=native.querySelector('[aria-label="New"]');
  const svg=W.document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('icon-name','new-fill');newRow.prepend(svg);
  let clicks=0;newRow.addEventListener('click',()=>clicks++);d.ensureActivityMenu();
  const sort=d.menuGroups[0];sort.row.click();assert.equal(newRow.querySelector('svg').dataset.icon,'new');
  const key=(el,value)=>el.dispatchEvent(new W.KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true})),back=sort.sub.querySelector('.rt-sub-back');
  const list=sort.sub.querySelector('.rt-sub-list');list.getBoundingClientRect=()=>({top:100,bottom:200});newRow.getBoundingClientRect=()=>({top:100,bottom:148});sort.items.at(-1).getBoundingClientRect=()=>({top:210,bottom:258});
  key(back,'ArrowDown');assert.equal(W.document.activeElement,newRow);key(newRow,'End');assert.equal(W.document.activeElement,sort.items.at(-1));assert.equal(list.scrollTop,58,'keyboard reveals the focused row inside the list');key(W.document.activeElement,'Home');assert.equal(W.document.activeElement,back);
  newRow.click();assert.equal(clicks,1);key(back,'Escape');assert.equal(W.document.activeElement,sort.row);
  m.group('Subreddit').click();const input=d.rtMenu.sub.input;input.focus();key(input,'Home');assert.equal(W.document.activeElement,input,'Home edits the query');key(input,'Escape');assert.equal(d.openSubmenu,null);
  d.clearActivityMenu();assert.equal(newRow.querySelector('svg'),svg,'native glyph identity and fill restored');newRow.click();assert.equal(clicks,2);
});
test('profile search uses the same Feed options menu as the profile',async t=>{
  const {W,d}=setup(t,{pre:['feed-filters.js','community-icons.js']});await d.ready;d.context={...d.context,view:'search',q:'fixture'};d.clearActivityMenu();d.ensureActivityMenu();
  assert.ok(W.document.querySelector('[data-rt-feed-options-host]'),'shared profile menu host');
  assert.equal(d.rtMenu.sub.panel.head.lastElementChild.matches('.rt-filter-field'),true,'pill search field in the Subreddit header');
  assert.equal(d.rtMenu.groups.sub.el.querySelector('.rt-menu-lead').dataset.icon,'community');
  assert.equal(d.rtMenu.groups.date.sub.querySelector('[data-rt-option="any"] .rt-menu-lead').dataset.icon,'show');
});

// Each route uses the same semantic icons, whether Reddit supplies a filled SVG or only a label.
for(const suffix of ['', 'submitted/', 'comments/'])for(const filled of [false,true])test(`Feed options icon matrix on /user/Example/${suffix} (${filled?'native filled SVGs':'labels only'})`,async t=>{
  const {W,d}=setup(t,{url:'https://www.reddit.com/user/Example/'+suffix,pre:['feed-filters.js']});await d.ready;d.clearActivityMenu();
  const main=W.document.querySelector('.main-menu-container');
  const sorts={New:'new',Hot:'hot',Top:'top',Best:'best',Relevance:'search',Comments:'comment','Most comments':'comment',Old:'archive'},views={Card:'card',Classic:'classic',Compact:'classic'};
  main.innerHTML='<div>Feed options</div>'+Object.keys(sorts).map(label=>`<rpl-menu-item aria-label="${label}" tabindex="0">${filled?'<svg icon-name="'+(label==='Relevance'?'search':label.toLowerCase())+'-fill"><path d="M1 1h18v18H1z"/></svg>':''}${label}</rpl-menu-item>`).join('')+'<div>View</div>'+Object.keys(views).map(label=>`<rpl-menu-item aria-label="${label}">${filled?'<svg icon-name="card-fill"></svg>':''}${label}</rpl-menu-item>`).join('');
  const originals=[...main.querySelectorAll('rpl-menu-item')].map(row=>({row,html:row.innerHTML,icon:row.querySelector('svg'),tab:row.getAttribute('tabindex')}));
  let clicks=0;originals[0].row.addEventListener('click',()=>clicks++);d.ensureActivityMenu();
  const assertIcon=(row,name)=>{
    assert.ok(row,name+' row exists');const svg=row.querySelector('.rt-menu-lead');assert.ok(svg,name+' has a leading icon');
    assert.equal(svg.getAttribute('icon-name'),name);assert.equal(svg.getAttribute('width'),'16');assert.equal(svg.getAttribute('height'),'16');assert.equal(svg.getAttribute('viewBox'),'0 0 20 20');
    assert.equal(svg.getAttribute('aria-hidden'),'true');assert.equal(svg.getAttribute('icon-name').endsWith('-fill'),false);
    const shared=W.RTFeedFilters.svgIcon(name,16);if(shared)assert.deepEqual([...svg.querySelectorAll('path')].map(p=>p.getAttribute('d')),[...shared.querySelectorAll('path')].map(p=>p.getAttribute('d')));
  };
  for(const [label,name] of Object.entries(sorts))assertIcon(d.menuGroups[0].sub.querySelector('[aria-label="'+label+'"]'),name);
  for(const [label,name] of Object.entries(views))assertIcon(d.menuGroups[1].sub.querySelector('[aria-label="'+label+'"]'),name);
  assertIcon(d.menuGroups[0].row,'sort');assertIcon(d.menuGroups[1].row,'card');
  for(const [key,name] of Object.entries({all:'show',hidden:'hidden',deleted:'deleted'}))assertIcon(d.activityMenu.querySelector('[data-rt-activity-filter="'+key+'"]'),name);
  assertIcon(d.activityMenu.querySelector('[data-rt-ui="activity-refresh"]'),'refresh');
  for(const [key,row] of d.rtMenu.date)assertIcon(row,key==='any'?'show':'calendar');
  const types={text:'text-post',textmedia:'collection',poll:'list-bulleted',image:'image',gif:'gif-post-outline',video:'video',gallery:'gallery',link:'link',embed:'browser',crosspost:'rotate'};
  assert.equal(Boolean(d.rtMenu.all),suffix!=='comments/');
  if(d.rtMenu.all){assertIcon(d.rtMenu.all,'show');for(const [key,name] of Object.entries(types))assertIcon(d.rtMenu.types.get(key),name);}
  const panel=d.rtMenu.sub.panel;panel.render({entries:[{key:'Example',count:1},{key:'u_example',count:1}],picked:[],source:'loaded'});
  assertIcon(panel.list.querySelector('[data-rt-sub-all]'),'show');
  for(const [key,name] of [['Example','community'],['u_example','author']]){const row=panel.list.querySelector('[data-rt-sub-row="'+key+'"]');assert.equal(row.querySelector('svg').getAttribute('icon-name'),name);assert.equal(row.querySelector('svg').getAttribute('width'),'16');}
  const style=W.document.createElement('style');style.textContent=menuCss;W.document.head.append(style);
  const sparkle=d.menuGroups[0].sub.querySelector('[aria-label="New"] svg'),appearance=W.getComputedStyle(sparkle);
  assert.equal(appearance.fill,'none');assert.equal(appearance.stroke,'currentColor');assert.equal(appearance.strokeWidth,'1.8');
  const archive=d.menuGroups[0].sub.querySelector('[aria-label="Old"] svg');assert.equal(archive.firstElementChild.getAttribute('fill-rule'),'evenodd');assert.equal(archive.children.length,2,'hollow body and handle');
  originals[0].row.click();assert.equal(clicks,1);d.clearActivityMenu();
  for(const {row,html,icon,tab} of originals){assert.equal(row.parentElement,main);assert.equal(row.innerHTML,html,'native presentation restored exactly');assert.equal(row.querySelector('svg'),icon,'native SVG identity restored');assert.equal(row.getAttribute('tabindex'),tab);}
  originals[0].row.click();assert.equal(clicks,2,'native event handlers survive');
  assert.equal(W.RTFeedFilters.svgIcon('sort').getAttribute('fill'),'none','Sort is a stroked outline');
  for(const name of W.RTFeedFilters.iconNames)assert.ok(W.RTFeedFilters.svgIcon(name),'export renders '+name);
});

test('profile refresh stays hidden before Feed options mounts and while its native menu is replaced',async t=>{
 const {d,W}=setup(t,{url:'https://www.reddit.com/user/Example/comments/'});await d.ready;
 assert.equal(d.host.dataset.rtContext,'profile');assert.equal(d.discover.hidden,true);
 d.clearActivityMenu();assert.equal(d.host.hasAttribute('data-rt-menu-ready'),false);assert.equal(d.discover.hidden,true);
 const old=W.document.querySelector('shreddit-sort-dropdown');old?.remove();await d.ensureActivityMenu();assert.equal(d.discover.hidden,true);
 let refreshes=0;d.refreshActivity=async()=>{refreshes++;};d.discover.click();assert.equal(refreshes,1,'hidden backing action still powers menu refresh');
});


function ownProfileAccount(W,name='Example',owner='t2_self'){
 let app=W.document.querySelector('shreddit-app');if(!app){app=W.document.createElement('shreddit-app');W.document.body.prepend(app);}app.setAttribute('user-logged-in','true');app.setAttribute('logged-in-user-id',owner);
 const card=W.document.querySelector('shreddit-post');card.setAttribute('author-id',owner);card.setAttribute('author',name);
 if(!W.RTNativeRemoval)W.eval(fs.readFileSync('extension/native-removal.js','utf8'));
 return app;
}
function removedEntryNavigations(W){const urls=[];W.document.addEventListener('click',event=>{const anchor=event.target.closest?.('a[href]');if(anchor && new URL(anchor.href).searchParams.get('rt_view')==='removed'){event.preventDefault();urls.push(new URL(anchor.href));}},true);return urls;}
// Removed is a profile section beside Saved and History (spec §18 P4), from Reddit's own tab bar (captured 2026-11-16).
const profileTabs=(name='Example')=>'<faceplate-tabgroup slot="tabs" id="profile-feed-tabgroup" pageindex="1" for="profile-feed-tabs">'+[['overview',''],['saved','saved/'],['downvoted','downvoted/']].map(([id,path],i)=>'<a rpl="" class=" button-medium px-[calc(var(--rem12)-var(--button-border-width,0px))] button-plain items-center justify-center button inline-flex '+(i?'':'bg-secondary-background-selected !text-neutral-content-strong tab-selected')+'" href="/user/'+name+'/'+path+'" id="profile-tab-'+id+'_tab" slot="page-'+(i+1)+'" tabindex="'+(i?-1:0)+'" type="button"'+(i?'':' faceplate-tab-selected=""')+'><span class="flex items-center justify-center"><span class="flex items-center gap-xs"><span class="flex" actioned="">'+id[0].toUpperCase()+id.slice(1)+'</span></span></span></a>').join('')+'</faceplate-tabgroup>';
const removedTab=W=>W.document.querySelector('#profile-feed-tabgroup [data-rt-ui="removed-tab"]');
// A stand-in for Reddit's faceplate-tabgroup: it renders only "pages" slots, set as a component property.
const defineTabgroup=W=>{if(!W.customElements.get('faceplate-tabgroup'))W.customElements.define('faceplate-tabgroup',class extends W.HTMLElement{get pages(){return Number(this.getAttribute('pages')) || undefined;}set pages(value){this.setAttribute('pages',String(value));}});};
test('your own profile’s tab bar gets a Removed tab like Saved and History, without reads, opening the Removed list',async t=>{
 const {W,d,calls}=setup(t);defineTabgroup(W);W.document.querySelector('main').insertAdjacentHTML('afterbegin',profileTabs());ownProfileAccount(W);const urls=removedEntryNavigations(W);await d.ready;d.ensureActivityMenu();
 const tab=removedTab(W);assert.ok(tab);assert.equal(tab.textContent.trim(),'Removed');assert.equal(tab.getAttribute('slot'),'page-4','after Reddit’s last tab');const group=W.document.querySelector('#profile-feed-tabgroup');assert.equal(group.pages,4,'Reddit’s tab group renders one more page slot (measured: it renders only "pages" slots)');assert.equal(tab.id,'profile-tab-removed_tab');
 assert.match(tab.className,/button-medium .*button-plain/);assert.doesNotMatch(tab.className,/tab-selected|bg-secondary-background-selected/);assert.equal(tab.hasAttribute('faceplate-tab-selected'),false);assert.equal(tab.tabIndex,-1);
 const href=new URL(tab.href);assert.equal(href.pathname,'/user/Example/hidden/');assert.equal(href.searchParams.get('rt_view'),'removed');
 assert.equal(calls.length,0,'mounting the tab must not scan');assert.equal(d.activityMenu.querySelector('[data-rt-activity-filter="removed"]'),null,'no second entry in Feed options');
 tab.click();assert.equal(urls.length,1);assert.equal(urls[0].searchParams.get('rt_view'),'removed');
 tab.dispatchEvent(new W.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));assert.equal(urls.length,2,'keyboard opens it too');
 d.ensureActivityMenu();assert.equal(W.document.querySelectorAll('[data-rt-ui="removed-tab"]').length,1,'added once');
 const old=W.document.querySelector('#profile-feed-tabgroup');old.outerHTML=profileTabs();d.ensureActivityMenu();assert.ok(removedTab(W),'restored after Reddit redraws its tab bar');
});
test('the Removed tab is own-only and leaves after a sign-out or account switch',async t=>{
 const {W,d}=setup(t);defineTabgroup(W);W.document.querySelector('main').insertAdjacentHTML('afterbegin',profileTabs());const app=ownProfileAccount(W,'Other');await d.ready;d.ensureActivityMenu();assert.equal(removedTab(W),null,'another person’s profile');
 ownProfileAccount(W);d.ensureActivityMenu();const tab=removedTab(W);assert.ok(tab);const urls=removedEntryNavigations(W);
 ownProfileAccount(W,'Example','t2_other');tab.click();assert.equal(urls.length,0,'a stale tab never navigates for another account');
 app.setAttribute('user-logged-in','false');d.ensureActivityMenu();assert.equal(removedTab(W),null);assert.equal(W.document.querySelector('#profile-feed-tabgroup').pages,3,'the native count comes back');
});
// Measured 2026-11-17 (phone emulation, 4x CPU, fast flick up a long profile): each finished background card re-ordered the
// whole feed with forced layouts (~165 ms each), starving Reddit's own placeholder swaps, so the flick showed blank screens.
test('cards finished during a flick away from the feed end are reconciled once the scrolling stops',async t=>{
  const {W,d}=setup(t);await d.ready;await d.loadReddit();await new Promise(r=>setImmediate(r));
  let settles=0,dedupes=0;const settle=d.settleProfileBatch.bind(d),dedupe=d.deduplicate.bind(d);d.settleProfileBatch=()=>{settles++;return settle();};d.deduplicate=()=>{dedupes++;return dedupe();};
  d.scrollIdleMs=30;d.batchInView=false;d.lastScrollAt=W.performance.now();
  d.reconcileFeed();d.reconcileFeed();d.reconcileFeed();assert.equal(dedupes,0,'nothing re-orders the feed mid-flick');
  await new Promise(r=>setTimeout(r,80));assert.equal(dedupes,1,'one coalesced run after scrolling stops');assert.equal(settles,1);
  d.lastScrollAt=W.performance.now();d.batchInView=true;d.reconcileFeed();assert.equal(dedupes,2,'near the feed end, new cards are published at once');
  d.lastScrollAt=undefined;d.batchInView=false;d.reconcileFeed();assert.equal(dedupes,3,'when not scrolling, it runs at once');
});

test('the Smooth long feeds setting marks the page for the feed bridge and clears with it',async t=>{
  const {W,d}=setup(t,{settings:{postDiscovery:true,archiveDiscovery:false}});await d.ready;const html=W.document.documentElement;
  assert.equal(html.hasAttribute('data-rt-smooth-feed'),true,'on by default');
  d.applySettings({postDiscovery:true,archiveDiscovery:false,smoothFeeds:false});assert.equal(html.hasAttribute('data-rt-smooth-feed'),false);
  d.applySettings({postDiscovery:true,archiveDiscovery:false,smoothFeeds:true});assert.equal(html.hasAttribute('data-rt-smooth-feed'),true);
  d.applySettings({postDiscovery:false,archiveDiscovery:false,smoothFeeds:true});assert.equal(html.hasAttribute('data-rt-smooth-feed'),false,'off with profile discovery');
});
// Phones (reported 2026-11-17): an archived comment's community name wrapped one letter per line because the long post
// title took the row. Like Reddit's own header, the community name stays on one line and the title wraps.
test('archived comment headers keep the community name on one line and let the post title wrap',async t=>{
  const {W,d}=setup(t);await d.ready;await d.loadReddit();
  const post=W.RTPostModel.normalizeComment({id:'c9',author:'Example',body:'Deleted words',link_id:'t3_p9',link_title:'A long post title that needs the remaining width on a narrow phone screen',subreddit:'kanpur',created_utc:1700000000},{source:'arctic-shift'});
  const node=W.document.createElement('div');d.renderArchivedNative(post,node);
  const card=node.querySelector('shreddit-profile-comment'),community=[...card.querySelectorAll('a')].find(a=>/r\/kanpur/.test(a.textContent)),title=card.querySelector('h2');
  assert.ok(community.classList.contains('whitespace-nowrap') && community.classList.contains('shrink-0'),'community never shrinks or wraps');
  assert.ok(title.classList.contains('min-w-0'),'the title takes the remaining width and wraps');assert.equal(title.classList.contains('inline-block'),false);
  const separator=community.nextElementSibling;assert.ok(separator.classList.contains('shrink-0'));
});
// Phones: profile search already opens its filters as Reddit's bottom sheet; Feed options on the profile feed used the
// desktop popover. Under 768 px it now opens as the same sheet over a dimmed backdrop.
test('on phones the profile Feed options opens as a bottom sheet with a backdrop that closes it',async t=>{
  const {W,d}=setup(t);let phone=true;W.matchMedia=query=>({matches:/max-width/.test(query)?phone:false,media:query,addEventListener(){},removeEventListener(){}});
  await d.ready;d.ensureActivityMenu();const dropdown=d.activityDropdown;assert.ok(dropdown,'Feed options is mounted');
  // Reddit's popper lives in the dropdown's shadow root; the sheet style goes there.
  const shadow=dropdown.shadowRoot || dropdown.attachShadow({mode:'open'});const popper=W.document.createElement('rpl-popper');popper.attachShadow({mode:'open'}).innerHTML='<div part="popup" class="popup"></div>';shadow.append(popper);
  d.ensureActivityMenu();assert.equal(dropdown.hasAttribute('data-rt-feed-sheet'),true);assert.equal(popper.hasAttribute('data-rt-sheet'),true);
  assert.match([...popper.shadowRoot.querySelectorAll('style')].map(s=>s.textContent).join(''),/@media \(max-width:767\.98px\)\{:host\(\[data-rt-sheet\]\) \.popup\{position:fixed!important/);
  dropdown.setAttribute('open','');await new Promise(r=>setImmediate(r));const find=()=>dropdown.shadowRoot.querySelector('[data-rt-ui="feed-sheet-scrim"]') || W.document.querySelector('[data-rt-ui="feed-sheet-scrim"]');const scrim=find();assert.ok(scrim,'a dimmed backdrop');
  scrim.click();await new Promise(r=>setImmediate(r));assert.equal(dropdown.hasAttribute('open'),false,'tapping it closes the sheet');assert.equal(find(),null);
  phone=false;dropdown.setAttribute('open','');await new Promise(r=>setImmediate(r));assert.equal(find(),null,'desktop keeps the popover');
});
test('the Feed options sheet fills the phone width in Reddit sheet style',()=>{
  const css=fs.readFileSync('extension/post-discovery.css','utf8');assert.match(css,/@media \(max-width:767\.98px\)\{rpl-dropdown\[data-rt-feed-sheet\]>\[slot="content"\]\{width:100%!important/);
});
// Reported 2026-11-17: the next card's status icon (z-index 1, later in the page) painted over an open three-dot menu,
// whose popup Reddit also places at z-index 1. At 0 it stays above its own card's link but under any open menu.
test('comment status icons stay under open card menus',()=>{
  const css=fs.readFileSync('extension/post-discovery.css','utf8');const rule=css.match(/\.rt-comment-source-host>\.rt-post-indicator\{[^}]*\}/)?.[0] || '';
  assert.match(rule,/z-index:0/);assert.doesNotMatch(rule,/z-index:[1-9]/);
});

test('the extension’s Feed options row sits where Reddit’s own Posts row puts it, and the hidden status never widens the page',async t=>{
  // Live 2026-11-17: Reddit's Posts row is [faceplate-loader (0 wide), Feed options] with an 8px gap, so Feed options sits
  // 8px in from the tabs; our row on Comments sat flush, so switching Posts ↔ Comments slid the controls 8px and back.
  const dom=new JSDOM('<main id="main-content"><div class="flex items-center gap-xs my-md"><shreddit-sort-dropdown></shreddit-sort-dropdown></div><shreddit-feed><shreddit-profile-comment comment-id="t1_native"></shreddit-profile-comment></shreddit-feed></main>',{url:'https://www.reddit.com/user/Example/comments/',runScripts:'outside-only',pretendToBeVisual:true});const W=dom.window;
  for(const file of ['post-model.js','post-discovery.js'])W.eval(fs.readFileSync('extension/'+file,'utf8'));
  const d=new W.RTPostDiscovery.Discovery({observe:false,autoDiscover:true,readSettings:async()=>({'rt-settings-v1':{postDiscovery:true,archiveDiscovery:false}}),nativeRenderer:async()=>{},reddit:async args=>{if(args.action==='render-controls'){W.document.getElementById(args.target).innerHTML=nativeControls;return {rendered:true};}return {posts:[],hasMore:false,after:null};}});
  t.after(()=>{d.destroy();W.close();});await d.ready;for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r));
  const target=W.document.querySelector('[data-rt-ui="profile-controls"]');assert.ok(target,'controls rendered by the extension');assert.equal(target.dataset.rtNativeInset,'true');
  const css=fs.readFileSync('extension/post-discovery.css','utf8');
  assert.match(css,/\[data-rt-native-inset\] shreddit-layout-event-setter\{margin-inline-start:\.5rem\}/,'Reddit’s gap-xs after its empty loader');
  assert.match(css,/\.rt-posts-status\[data-error=false\]\{position:fixed;[^}]*left:0;top:0/,'the screen-reader status is fixed, so it cannot overflow sideways');
});
