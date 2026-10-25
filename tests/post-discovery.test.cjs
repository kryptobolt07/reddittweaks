const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const nativeControls=fs.readFileSync('tests/fixtures/native-profile-controls.html','utf8');
const raw=(id='abc12',extra={})=>({id,author:'Example',title:'A public post',selftext:'Public text',subreddit:'example',created_utc:1700000000,score:7,num_comments:2,...extra});
function setup(t,{url='https://www.reddit.com/user/Example/submitted/',settings={postDiscovery:true,archiveDiscovery:false},reddit,publicReddit,archive,readSettings,nativeRender}={}){
  const dom=new JSDOM('<main id="main-content">'+nativeControls+'<shreddit-feed><shreddit-post id="t3_native"></shreddit-post></shreddit-feed></main>',{url,runScripts:'outside-only',pretendToBeVisual:true});const W=dom.window,calls=[];
  for(const file of ['post-model.js','post-discovery.js'])W.eval(fs.readFileSync('extension/'+file,'utf8'));
  const nativeRenderer=nativeRender || (async(post,node)=>{const native=W.document.createElement(post.kind==='comment'?'shreddit-profile-comment':'shreddit-post');if(post.kind==='comment')native.setAttribute('comment-id',post.fullname);else native.id=post.fullname;const credit=W.document.createElement('span');credit.slot='credit-bar';const title=W.document.createElement('a');title.textContent=post.title || 'Comment';title.href=post.permalink;native.append(credit,title);if(!post.over18 && !post.spoiler){const body=W.document.createElement('p');if(post.kind==='comment')body.className='md';else body.slot='text-body';body.textContent=post.source==='arctic-shift'?'Current native text':post.body;native.append(body);}node.replaceChildren(native);});
  const d=new W.RTPostDiscovery.Discovery({nativeRenderer,observe:false,readSettings:readSettings || (async()=>({'rt-settings-v1':settings})),reddit:async(...args)=>{calls.push(args[0]);if(args[0].action==='render-controls'){const target=W.document.getElementById(args[0].target);target.innerHTML=nativeControls;return {rendered:true};}if(args[0].stream==='public')return publicReddit?publicReddit(...args):{posts:[],after:null,hasMore:false};return reddit?reddit(...args):{posts:[raw('native'),raw()],after:null,hasMore:false};},archive:archive || (async()=>({posts:[raw('old12')],hasMore:false}))});t.after(()=>{d.destroy();dom.window.close();});return {W,d,calls};
}
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
 let observer;const requests=[];const {W,d}=setup(t,{reddit:async input=>{requests.push(input);return {posts:[raw(input.after?'next':'first')],after:input.after?null:'next',hasMore:!input.after};}});await d.ready;d.reset();W.IntersectionObserver=class{constructor(callback,options){observer=callback;assert.equal(options.rootMargin,W.innerHeight*2+'px');}observe(){}disconnect(){}};d.scan();const pager=W.document.createElement('faceplate-partial');pager.slot='load-after';pager.setAttribute('loading','programmatic');pager.setAttribute('src','/svc/shreddit/profiles/profile_posts-more-posts/new/?after=opaque');pager.innerHTML='<shreddit-feed-page-loading></shreddit-feed-page-loading>';d.feed.append(pager);d.activityMenu.querySelector('[data-rt-activity-filter="hidden"]').click();await new Promise(r=>setImmediate(r));await d.loadReddit();await new Promise(r=>setImmediate(r));assert.equal(d.nativeFeedLoading(),true);assert.equal(requests.length,1);d.loading.getBoundingClientRect=()=>({top:W.innerHeight*2,bottom:W.innerHeight*2+192});observer([{target:d.loading,isIntersecting:true}]);await new Promise(r=>setImmediate(r));assert.equal(requests.length,2);assert.equal(requests[1].after,'next');assert.equal(d.nodes.get('first').hidden,false);assert.equal(d.nodes.get('next').hidden,false);assert.equal(d.moreReddit,false);assert.equal(pager.parentElement,d.feed);
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
 const {d}=setup(t,{url:'https://www.reddit.com/comments/abc12/title/',settings:{archiveDiscovery:true},archive:async()=>({posts:[raw('abc12',{selftext:'Restricted original'})]}),reddit:async()=>({posts:[raw('abc12',{selftext:'[removed]',over_18:true})]})});await d.ready;await d.loadDetail();assert.equal((d.feed || d.results).textContent.includes('Restricted original'),false);
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
 const {W,d}=setup(t);await d.ready;await d.loadReddit();const oldFeed=d.feed,oldCard=d.nodes.get('abc12');const replacement=W.document.createElement('shreddit-feed');oldFeed.replaceWith(replacement);d.scan();assert.equal(d.feed,replacement);assert.equal(oldCard.isConnected,false);assert.equal(d.nodes.size,2);assert.equal(d.host.nextElementSibling,replacement);assert.equal(W.document.querySelectorAll('[data-rt-ui=posts]').length,1);
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

test('cards supply native feed separators without duplicating server rules or confusing body rules',async t=>{
 const {W,d}=setup(t);await d.ready;
 const node=d.card({id:'test',fullname:'t3_test'}),placeholderRule=node.querySelector('[data-rt-separator]');
 assert.equal(placeholderRule.className,'border-0 border-b-sm border-solid border-b-neutral-border-weak');
 node.innerHTML='<faceplate-partial><article><shreddit-post><div slot="text-body"><hr></div></shreddit-post></article></faceplate-partial>';
 d.ensureSeparator(node);const rule=node.querySelector('[data-rt-separator]');assert.equal(rule,node.lastElementChild);assert.equal(node.querySelectorAll('hr').length,2);
 d.ensureSeparator(node);assert.equal(node.querySelectorAll('[data-rt-separator]').length,1);
 const supplied=W.document.createElement('hr');node.querySelector('faceplate-partial').append(supplied);d.ensureSeparator(node);assert.equal(node.querySelector('[data-rt-separator]'),null);assert.equal(supplied.isConnected,false);
 // Comments omit the feed-level rule. The generated one stays with the wrapper
 // through native virtualization and opt-out rather than becoming an orphan.
 node.innerHTML='<faceplate-partial><shreddit-profile-comment></shreddit-profile-comment></faceplate-partial>';d.ensureSeparator(node);d.feed.append(node);d.nodes.set('test',node);
 const separator=node.lastElementChild,slot=W.document.createElement('div');slot.className='virtualized-placeholder';node.replaceWith(slot);d.trackVirtualization([{target:d.feed,addedNodes:[slot],removedNodes:[node]}]);assert.equal(separator.parentElement,node);slot.replaceWith(node);d.trackVirtualization([{target:d.feed,addedNodes:[node],removedNodes:[slot]}]);assert.equal(node.lastElementChild,separator);d.reset();assert.equal(separator.isConnected,false);
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
 assert.equal(card.firstElementChild,content);assert.equal(card.dataset.rtNativeState,'ready');assert.equal(renders,1);assert.equal(d.virtualNodes.size,0);assert.equal(d.feed.querySelectorAll('.virtualized-placeholder').length,0);
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
 d.decorateNative({...post,source:'arctic-shift',status:'unknown'},node);assert.equal(node.querySelector('[data-rt-source] svg').dataset.icon,'archive');assert.match(node.querySelector('[data-rt-source]').title,/status unknown/);
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
 for(const flag of ['over18','spoiler']){const restricted=d.card(p);d.renderArchivedNative({...p,[flag]:true,body:'secret snapshot'},restricted);assert.equal(restricted.textContent.includes('secret snapshot'),false);assert.match(restricted.textContent,/NSFW or spoiler/);}
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
 const {W,d}=setup(t);await d.ready;d.reset();deletedPage(W);d.scan();assert.equal(d.avatarPlaceholder.querySelector('img').src,'https://www.redditstatic.com/avatars/defaults/v2/avatar_default_0.png');assert.match(d.avatarPlaceholder.getAttribute('aria-label'),/Deleted account/);assert.equal(d.avatarSlot.querySelectorAll('img').length,1);
 d.reset();bannedPage(W);d.scan();assert.equal(d.avatarPlaceholder.querySelector('img').src,'https://www.redditstatic.com/shreddit/assets/snoovatar-back-64x64px.png');assert.ok(d.avatarSlot.parentElement.classList.contains('items-center'));
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
 assert.equal(d.archiveOnly,true);assert.equal(d.accountState,'banned');assert.equal(d.archiveShell.dataset.rtAccountState,'banned');assert.equal(d.avatarPlaceholder.querySelector('img').src,'https://www.redditstatic.com/shreddit/assets/snoovatar-back-64x64px.png');assert.equal(d.avatarPlaceholder.textContent,'');assert.match(d.avatarPlaceholder.getAttribute('aria-label'),/Banned or suspended/);
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
 const {W,d}=setup(t);await d.ready;d.reset();bannedPage(W);d.scan();assert.equal(d.avatarPlaceholder.querySelector('img').src,'https://www.redditstatic.com/shreddit/assets/snoovatar-back-64x64px.png');assert.equal(d.avatarSlot.querySelectorAll('img').length,1);
 const post=W.RTPostModel.normalizePost(raw(),{source:'arctic-shift'}),node=d.card(post);node.innerHTML='<shreddit-post author="Example" icon="https://i.redd.it/foreign.png"><span slot="credit-bar"></span></shreddit-post>';d.decorateNative(post,node);assert.equal(d.avatarSlot.querySelectorAll('img').length,1);assert.equal(d.avatarPlaceholder.hidden,false);
 node.querySelector('[slot="credit-bar"]').innerHTML='<a href="/user/Example/"><span avatar><img src="https://i.redd.it/generic.png"></span>Example</a>';d.decorateNative(post,node);assert.equal(node.querySelector('[data-rt-author-avatar-replaced],[data-rt-author-avatar]'),null);assert.equal(node.querySelector('[avatar] img').src,'https://i.redd.it/generic.png');
 const css=fs.readFileSync('extension/post-discovery.css','utf8');assert.match(css,/\.rt-profile-avatar>\[hidden\]\{display:none!important\}/);assert.match(css,/\.rt-profile-avatar>img\{width:64px;height:64px/);
});

test('user-profile post URLs preserve their underlying recovered profile',async t=>{
 const {W,d}=setup(t,{settings:{archiveDiscovery:true}});await d.ready;d.reset();bannedPage(W);d.scan();await d.loadArchive();await new Promise(r=>setImmediate(r));const shell=d.archiveShell,host=d.host;
 W.history.pushState({},'','/user/Example/comments/abc12/title/');d.scan();assert.equal(d.archiveShell,shell);assert.equal(d.host,host);assert.equal(d.profileOverlay,true);
 W.history.pushState({},'','/user/Example/submitted/');d.scan();assert.equal(d.host,host);assert.equal(d.nodes.size,1);
});
test('Back restores loaded pages and rendered cards when Reddit reconnects a cached unavailable-profile view',async t=>{
 let requests=0,renders=0;const {W,d}=setup(t,{settings:{archiveDiscovery:true},archive:async input=>{requests++;return {posts:[raw(input.before?'older':'first')],before:input.before?1600000000:1700000000,hasMore:!input.before};},nativeRender:async(post,node)=>{renders++;node.innerHTML='<faceplate-partial><shreddit-post id="'+post.fullname+'"><span slot="credit-bar"><span></span></span><div slot="text-body">Rendered native text</div></shreddit-post><script>/* synthetic already-executed module */</script></faceplate-partial>';}});
 await d.ready;d.reset();const notice=bannedPage(W),nativeView=W.document.querySelector('shreddit-app');W.chrome={runtime:{id:'fixture',sendMessage:async()=>({ok:true,settings:{postDiscovery:true}})}};W.eval(fs.readFileSync('extension/profile-notice.js','utf8'));d.scan();await d.loadArchive();await new Promise(r=>setImmediate(r));await d.loadMore();await new Promise(r=>setImmediate(r));assert.equal(renders,2);assert.equal(requests,2);const keys=[...d.nodes.keys()];d.rememberProfile();
 W.history.pushState({},'','/user/Example/comments/first/title/');W.document.body.innerHTML='<main id="main-content"><shreddit-post id="t3_first"></shreddit-post></main>';W.RTProfileNoticeGuard.refresh();d.scan();assert.equal(nativeView.querySelector('#shreddit-forbidden'),notice);assert.equal(notice.isConnected,false);assert.ok(d.profileStates.size);
 W.history.pushState({},'','/user/Example/submitted/');W.document.body.replaceChildren(nativeView);W.RTProfileNoticeGuard.refresh();d.scan();await new Promise(r=>setImmediate(r));assert.equal(d.archiveOnly,true);assert.equal(d.nodes.size,2);assert.deepEqual([...d.nodes.keys()],keys);assert.ok([...d.nodes.values()].every(node=>node.dataset.rtNativeState==='ready' && node.isConnected));assert.equal(d.beforeByKind.post,1600000000);assert.equal(d.pages,2);assert.equal(d.moreArchive,false);assert.equal(requests,2);assert.equal(renders,2);assert.equal(notice.isConnected,false);assert.equal(d.feed.querySelectorAll('[data-rt-source]').length,2);assert.equal(d.feed.querySelector('script'),null);assert.ok([...d.nodes.values()].every(node=>node.firstElementChild.tagName==='SHREDDIT-POST'));
});
test('saved profile views are bounded, owner-scoped and cleared by preference changes',async t=>{
 const {W,d}=setup(t);await d.ready;let owner='account-a';W.RCSDirectory={getOwner:()=>owner};await d.loadReddit();await new Promise(r=>setImmediate(r));
 for(let i=0;i<6;i++){d.context={...d.context,key:'profile:example:'+i};d.rememberProfile();}assert.equal(d.profileStates.size,4);const context=d.context;owner='account-b';assert.equal(d.restoreProfile(context),false);owner='account-a';assert.equal(d.restoreProfile(context),true);
 d.onSettings({'rt-settings-v1':{newValue:{postDiscovery:false}}},'local');assert.equal(d.profileStates.size,0);
});
test('community fallback cards use community identity while profile-hosted posts use the profile identity',async t=>{
 const {W,d}=setup(t);await d.ready;
 for(const [state,url] of [['banned','https://www.redditstatic.com/shreddit/assets/snoovatar-back-64x64px.png'],['deleted','https://www.redditstatic.com/avatars/defaults/v2/avatar_default_0.png']]){
  d.reset();if(state==='banned')bannedPage(W);else deletedPage(W);d.scan();const header=d.avatarPlaceholder.querySelector('img');assert.equal(header.src,url);assert.equal(header.width,64);assert.equal(header.height,64);
  for(const raw of [comment(),{id:'post',author:'Example',created_utc:1700000000,title:'Post',selftext:'Body',subreddit:'example'}]){const p=W.RTPostModel.normalizeItem(raw,{source:'arctic-shift'}),node=d.card(p);d.renderArchivedNative(p,node);d.decorateNative(p,node);d.decorateNative(p,node);assert.equal(node.querySelectorAll('[avatar]').length,1);assert.ok(node.querySelector('[avatar] [icon-name="community-fill"]'));assert.equal(node.querySelector('[avatar] img'),null);assert.equal(node.querySelector('[data-rt-author-avatar],[is-author-deleted]'),null);}
  const post=W.RTPostModel.normalizePost({id:'ownpost',author:'Example',created_utc:1700000000,title:'Own profile post',subreddit:'u_Example'},{source:'arctic-shift'}),node=d.card(post);d.renderArchivedNative(post,node);d.decorateNative(post,node);const credit=node.querySelector('[slot="credit-bar"]');assert.equal(credit.querySelector('a').getAttribute('href'),'/user/Example/');assert.match(credit.textContent,/u\/Example/);assert.equal(credit.textContent.includes('r/u_'),false);assert.equal(credit.querySelector('img').src,url);assert.equal(credit.querySelector('img').width,24);assert.equal(node.querySelector('shreddit-post').getAttribute('subreddit-prefixed-name'),'u_Example');
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
test('partial prefix progress resumes from ready saved cards on Back and does not replay completed requests',async t=>{
 let releases=[],renders=0;const {W,d}=setup(t,{settings:{archiveDiscovery:true},archive:async()=>({posts:Array.from({length:3},(_,i)=>raw('rest'+i,{created_utc:1700000000-i})),hasMore:false}),nativeRender:async(post,node)=>{renders++;await new Promise(r=>releases.push(r));node.innerHTML='<shreddit-post id="'+post.fullname+'"><span slot="credit-bar"></span></shreddit-post>';}});await d.ready;d.reset();deletedPage(W);d.scan();await d.loadArchive();releases.shift()();await new Promise(r=>setImmediate(r));assert.equal(d.feed.querySelectorAll('.rt-native-card').length,1);d.rememberProfile();const saved=d.profileStates.get(d.context.key);assert.equal(saved.cards.size,1);assert.equal(saved.publishedCards.size,1);
 // Simulate a full native view replacement while an unfinished request is pending.
 d.reset();while(releases.length)releases.shift()();await new Promise(r=>setImmediate(r));deletedPage(W);d.scan();await new Promise(r=>setImmediate(r));assert.equal(renders,5);assert.equal(d.feed.querySelectorAll('.rt-native-card').length,1);while(releases.length){releases.shift()();await new Promise(r=>setImmediate(r));}assert.equal(renders,5);assert.equal(d.feed.querySelectorAll('.rt-native-card').length,3);assert.equal(d.loading.hidden,true);
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
test('public comment cursor and precedence survive the existing account-scoped Back snapshot',async t=>{
 const {d}=setup(t,{url:'https://www.reddit.com/user/Example/comments/',reddit:async()=>({posts:[],hasMore:false}),publicReddit:async()=>({posts:[comment()],after:'public-next',hasMore:true})});await d.ready;await d.loadReddit();await new Promise(r=>setImmediate(r));d.rememberProfile();const context=d.context,saved=d.profileStates.get(context.key);assert.equal(saved.afterByKind['comment-public'],'public-next');assert.equal(saved.redMore['comment-public'],true);assert.equal(saved.commentOrigins.get(comment().fullname),'public');d.commentOrigins.clear();d.afterByKind={};assert.equal(d.restoreProfile(context),true);assert.equal(d.commentOrigins.get(comment().fullname),'public');assert.equal(d.afterByKind['comment-public'],'public-next');
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

test('activity indicators reuse monochrome status paths and the chat refresh glyph',async t=>{
 const {d}=setup(t);await d.ready;const refresh=d.discover.querySelector('svg');assert.equal(refresh.getAttribute('viewBox'),'0 0 24 24');assert.equal(refresh.querySelector('path').getAttribute('d'),'M20 8a8.9443 8.9443 0 1 0 0 8M20 3v5h-5');
 for(const [filter,status] of [['hidden','live'],['deleted','deleted']]){const badge=d.indicator({source:'reddit',status}),option=d.activityMenu.querySelector('[data-rt-activity-filter='+filter+']');assert.equal(badge.querySelector('svg').getAttribute('viewBox'),'0 0 20 20');assert.equal(badge.querySelector('path').getAttribute('d'),option.querySelector('path').getAttribute('d'));assert.equal(badge.querySelector('svg').dataset.nativeIcon,'true');}
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
 let release;const {d}=setup(t,{settings:{archiveDiscovery:true,restoreDeletedContent:false},reddit:()=>new Promise(r=>release=r)});await d.ready;await d.loadArchive();await new Promise(r=>setImmediate(r));assert.equal(d.metadataPending,1);assert.ok(d.nodes.get('old12').querySelector('shreddit-post'));d.sourceErrors.comment='Comments failed';release({statuses:[{fullname:'t3_old12',status:'available'}],unknownIds:[]});await new Promise(r=>setImmediate(r));assert.equal(d.metadataPending,0);assert.match(d.status.textContent,/Comments failed/);d.rememberProfile();const saved=d.profileStates.get(d.context.key);assert.equal(saved.sourceErrors.comment,'Comments failed');
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
 const {W,d}=setup(t,{url:'https://www.reddit.com/comments/abc12/title/',settings:{archiveDiscovery:true},archive:async()=>({posts:[raw('abc12',{selftext:'Restricted original'})]})});await d.ready;const native=W.document.querySelector('shreddit-post');native.id='t3_abc12';native.setAttribute('deleted','');native.setAttribute('nsfw','');native.innerHTML='<p slot="text-body">[deleted]</p>';await d.loadDetail();assert.equal(W.document.body.textContent.includes('Restricted original'),false);assert.equal(native.querySelector('[slot="text-body"]').textContent,'[deleted]');assert.match(d.results.textContent,/NSFW or spoiler/);
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
 const calls=[];const {d}=setup(t,{settings:{archiveDiscovery:true},reddit:async input=>{calls.push(input);if(input.action==='status')return {statuses:[{fullname:'t3_old12',status:'deleted',author:'[deleted]'}],unknownIds:[]};return {posts:[]};}});await d.ready;await d.loadArchive();await new Promise(r=>setImmediate(r));assert.equal(calls[0].action,'status');assert.equal(calls[0].username,'Example');assert.equal(d.live.size,0);assert.equal(d.postStatuses.get('t3_old12'),'deleted');assert.equal(d.renderedPosts[0].source,'arctic-shift');assert.match(d.nodes.get('old12').querySelector('[data-rt-source]').title,/Deleted/);
 d.reddit=async()=>({statuses:[],unknownIds:['t3_old12'],incomplete:true});await d.loadArchive();await new Promise(r=>setImmediate(r));assert.equal(d.status.dataset.error,'false');assert.match(d.status.title,/unverified current Reddit status/);assert.equal(d.loading.hidden,true);
});

test('native virtualization transfers filter state without turning a temporary hidden flag into the original state',async t=>{
 const {W,d}=setup(t);await d.ready;const native=d.feed.querySelector('shreddit-post'),original=native.parentElement===d.feed?native:native.parentElement;d.activityMenu.querySelector('[data-rt-activity-filter="hidden"]').click();assert.equal(original.hidden,true);const slot=W.document.createElement('div');slot.className='virtualized-placeholder';d.feed.replaceChild(slot,original);d.trackVirtualization([{target:d.feed,addedNodes:[slot],removedNodes:[original]}]);d.scan();assert.equal(slot.hidden,true);assert.equal(d.filteredNative.get(slot),false);d.activityMenu.querySelector('[data-rt-activity-filter="all"]').click();assert.equal(slot.hidden,false);d.feed.replaceChild(original,slot);d.trackVirtualization([{target:d.feed,addedNodes:[original],removedNodes:[slot]}]);d.scan();assert.equal(original.hidden,false);assert.equal(original.hasAttribute('data-rt-filter-hidden'),false);d.activityMenu.querySelector('[data-rt-activity-filter="hidden"]').click();assert.equal(original.hidden,true);d.feed.replaceChild(slot,original);d.trackVirtualization([{target:d.feed,addedNodes:[slot],removedNodes:[original]}]);d.scan();d.feed.replaceChild(original,slot);d.trackVirtualization([{target:d.feed,addedNodes:[original],removedNodes:[slot]}]);d.scan();d.activityMenu.querySelector('[data-rt-activity-filter="all"]').click();assert.equal(original.hidden,false);assert.equal(original.parentElement,d.feed);
});

test('an in-flight duplicate cannot expose an empty published card if the native duplicate later disappears',async t=>{
 let finish,calls=0;const {W,d}=setup(t,{nativeRender:async(post,node)=>{calls++;if(calls===1)return new Promise(r=>finish=r);node.innerHTML='<shreddit-post id="'+post.fullname+'"><span slot="credit-bar"></span><p slot="text-body">Ready again</p></shreddit-post>';}});await d.ready;await d.loadReddit();const node=d.nodes.get('abc12'),native=W.document.createElement('article');native.innerHTML='<shreddit-post id="t3_abc12"></shreddit-post>';d.feed.insertBefore(native,d.loading);finish({duplicate:true});await new Promise(r=>setImmediate(r));assert.equal(node.hidden,true);assert.equal(node.dataset.rtNativeState,'idle');native.remove();d.scan();assert.equal(node.hidden,true);await new Promise(r=>setImmediate(r));assert.equal(calls,2);assert.equal(node.dataset.rtNativeState,'ready');assert.equal(node.hidden,false);assert.match(node.textContent,/Ready again/);
});

test('verified available archive cards qualify for Hidden without labeling historical text as current Reddit content',async t=>{
 const {d}=setup(t,{settings:{archiveDiscovery:true},reddit:async input=>input.action==='status'?{statuses:[{fullname:'t3_old12',status:'available',author:'Example'}],unknownIds:[]}:{posts:[]}});await d.ready;await d.loadArchive();await new Promise(r=>setImmediate(r));d.activityMenu.querySelector('[data-rt-activity-filter="hidden"]').click();const node=d.nodes.get('old12');assert.equal(node.hidden,false);assert.equal(d.renderedPosts[0].source,'arctic-shift');assert.equal(d.live.size,0);assert.match(node.querySelector('[data-rt-source]').title,/Available on Reddit.*Arctic Shift snapshot/);assert.equal(node.querySelector('[data-rt-source] svg').dataset.icon,'hidden');
});

function nativeProfileTabs(W){const tabs=W.document.createElement('faceplate-tabgroup');tabs.id='profile-feed-tabgroup';tabs.innerHTML='<a href="/user/Example/submitted/" faceplate-tab-selected>Posts</a><a href="/user/Example/comments/">Comments</a>';W.document.querySelector('main').prepend(tabs);return tabs;}
test('opening a post retains the mixed profile feed after Reddit removes the profile tabs',async t=>{
 const {W,d,calls}=setup(t,{settings:{archiveDiscovery:true},reddit:async input=>input.action==='status'?{statuses:[{fullname:'t3_old12',status:'deleted'}],unknownIds:[]}:{posts:[raw('found')],hasMore:false}});await d.ready;const tabs=nativeProfileTabs(W);await d.loadReddit();await d.loadArchive();await new Promise(r=>setImmediate(r));
 const feed=d.feed,host=d.host,found=d.nodes.get('found'),archived=d.nodes.get('old12'),content=found.firstElementChild,generation=d.generation,before=calls.length;tabs.remove();W.history.pushState({},'','/r/example/comments/found/title/');
 const observer=new W.MutationObserver(()=>{});observer.observe(feed,{childList:true,subtree:true});for(let i=0;i<4;i++)d.scan();assert.equal(d.context.kind,'profile');assert.equal(d.profileOverlay,true);assert.equal(d.feed,feed);assert.equal(d.host,host);assert.equal(d.generation,generation);assert.equal(found.parentElement,feed);assert.equal(archived.parentElement,feed);assert.equal(found.firstElementChild,content);assert.equal(calls.length,before);assert.equal(observer.takeRecords().length,0);observer.disconnect();
 const detail=W.document.createElement('shreddit-post');detail.id='t3_found';feed.replaceWith(detail);d.scan();assert.equal(d.context.kind,'post');assert.equal(d.generation,generation+1);assert.equal(d.feed,null);assert.equal(found.isConnected,false);assert.equal(d.profileStates.has('profile:example:posts:new:all:'),true);
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
 const incoming=W.document.createElement('shreddit-feed');incoming.innerHTML='<shreddit-profile-comment comment-id="t1_incoming"></shreddit-profile-comment>';feed.replaceWith(incoming);d.scan();assert.equal(d.context.view,'comments');assert.equal(d.feed,incoming);assert.equal(d.generation,generation+1);assert.equal(d.nodes.size,0);assert.notEqual(d.host,host);assert.equal(incoming.querySelector('shreddit-post'),null);assert.equal(d.profileStates.has('profile:example:posts:new:all:'),true);
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
test('an empty native profile retains extension results during tab loading but other accounts are not held',async t=>{
 const {W,d}=setup(t);await d.ready;nativeProfileTabs(W);d.feed.querySelector('shreddit-post').remove();await d.loadReddit();await new Promise(r=>setImmediate(r));const feed=d.feed,card=d.nodes.get('abc12');W.history.pushState({},'','/user/Example/comments/');d.scan();assert.equal(d.feed,feed);assert.equal(d.context.view,'posts');assert.equal(card.parentElement,feed);W.history.pushState({},'','/user/Other/comments/');d.scan();assert.equal(d.context.username,'Other');assert.notEqual(d.nodes.get('abc12'),card);
});

test('an outgoing transition does not delay opt-out and never leaks late Posts reads into Comments',async t=>{
 let finish;const {W,d}=setup(t,{reddit:()=>new Promise(r=>finish=r)});await d.ready;nativeProfileTabs(W);const pending=d.loadReddit();const outgoing=d.feed;W.history.pushState({},'','/user/Example/comments/');d.scan();assert.equal(d.context.view,'posts');const incoming=W.document.createElement('shreddit-feed');outgoing.replaceWith(incoming);d.scan();finish({posts:[raw('late')],hasMore:false});await pending;assert.equal(d.context.view,'comments');assert.equal(d.nodes.size,0);assert.equal(incoming.querySelector('shreddit-post'),null);
 W.history.pushState({},'','/user/Example/submitted/');d.scan();assert.equal(d.profileTransition,true);d.onSettings({'rt-settings-v1':{newValue:{postDiscovery:false}}},'local');assert.equal(d.host,null);assert.equal(d.profileTransition,false);assert.equal(W.document.querySelector('[data-rt-ui]'),null);
});

test('archive status verification publishes each native pair before a slower later pair finishes',async t=>{
 let release;const checks=[];const {d}=setup(t,{settings:{archiveDiscovery:true},archive:async()=>({posts:['one','two','three','four'].map(id=>raw(id)),hasMore:false}),reddit:async input=>{if(input.action!=='status')return {posts:[]};checks.push(input.ids);if(checks.length===2)await new Promise(r=>release=r);return {statuses:input.ids.map(id=>({fullname:'t3_'+id,status:id==='one'?'deleted':'available'})),unknownIds:[]};}});
 await d.ready;await d.loadArchive();await new Promise(r=>setImmediate(r));assert.deepEqual(checks.map(ids=>Array.from(ids)),[['one','two'],['three','four']]);assert.equal(d.postStatuses.get('t3_one'),'deleted');assert.equal(d.postStatuses.has('t3_three'),false);assert.equal(d.metadataPending,1);release();await new Promise(r=>setImmediate(r));assert.equal(d.postStatuses.get('t3_three'),'available');assert.equal(d.metadataPending,0);
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
 for(const [message,count]of [['Reddit request timed out. Try again.',2],['Reddit rate limit reached. Try again later.',1],['Reddit returned an unrecognized comment search response.',1]]){const {d,calls}=setup(t,{reddit:async()=>{throw Error(message);}});await d.ready;await d.loadReddit();assert.equal(calls.length,count);assert.equal(d.status.dataset.error,'true');assert.match(d.status.textContent,/timed out|rate limit|unrecognized/);}
 const {W,d,calls}=setup(t,{reddit:async()=>{W.history.pushState({},'','/user/Other/submitted/');d.scan();throw Error('Reddit request timed out. Try again.');}});await d.ready;await d.loadReddit();assert.equal(calls.filter(c=>c.action==='profile').length,1);assert.equal(d.context.username,'Other');assert.equal(d.nodes.size,0);
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
