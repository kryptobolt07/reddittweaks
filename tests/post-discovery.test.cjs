const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const raw=(id='abc12',extra={})=>({id,author:'Example',title:'A public post',selftext:'Public text',subreddit:'example',created_utc:1700000000,score:7,num_comments:2,...extra});
function setup(t,{url='https://www.reddit.com/user/Example/submitted/',settings={postDiscovery:true,archiveDiscovery:false},reddit,archive,readSettings,nativeRender}={}){
  const dom=new JSDOM('<main id="main-content"><shreddit-feed><shreddit-post id="t3_native"></shreddit-post></shreddit-feed></main>',{url,runScripts:'outside-only',pretendToBeVisual:true});const W=dom.window,calls=[];
  for(const file of ['post-model.js','post-discovery.js'])W.eval(fs.readFileSync('extension/'+file,'utf8'));
  const nativeRenderer=nativeRender || (async(post,node)=>{const native=W.document.createElement(post.kind==='comment'?'shreddit-profile-comment':'shreddit-post');if(post.kind==='comment')native.setAttribute('comment-id',post.fullname);else native.id=post.fullname;const credit=W.document.createElement('span');credit.slot='credit-bar';const title=W.document.createElement('a');title.textContent=post.title || 'Comment';title.href=post.permalink;native.append(credit,title);if(!post.over18 && !post.spoiler){const body=W.document.createElement('p');if(post.kind==='comment')body.className='md';else body.slot='text-body';body.textContent=post.source==='arctic-shift'?'Current native text':post.body;native.append(body);}node.replaceChildren(native);});
  const d=new W.RTPostDiscovery.Discovery({nativeRenderer,observe:false,readSettings:readSettings || (async()=>({'rt-settings-v1':settings})),reddit:async(...args)=>{calls.push(args[0]);return reddit?reddit(...args):{posts:[raw('native'),raw()],after:null,hasMore:false};},archive:archive || (async()=>({posts:[raw('old12')],hasMore:false}))});t.after(()=>{d.destroy();dom.window.close();});return {W,d,calls};
}
test('profile discovery is explicit, deduplicates native posts and stays inline',async t=>{
  const {W,d,calls}=setup(t);await d.ready;assert.equal(calls.length,0);assert.equal(d.host.nextElementSibling,d.feed);
  await d.loadReddit();await new Promise(r=>setImmediate(r));assert.equal(calls.length,1);assert.equal((d.feed || d.results).querySelectorAll('.rt-native-card:not([hidden])').length,1);assert.match(d.status.textContent,/1 additional post/);assert.ok(d.nodes.get('abc12').querySelector('shreddit-post'));assert.match((d.feed || d.results).querySelector('[role=img]').title,/public Reddit search/);
  const native=W.document.createElement('shreddit-post');native.id='t3_abc12';W.document.querySelector('shreddit-feed').append(native);d.scan();assert.equal(d.nodes.get('abc12').hidden,true);assert.equal(W.document.querySelectorAll('shreddit-post[id="t3_abc12"]').length,1);
});
test('pagination uses Reddit cursors while refresh starts at the newest page',async t=>{
  const {d,calls}=setup(t,{reddit:async()=>({posts:[raw()],after:'t3_abc12',hasMore:true})});await d.ready;await d.loadReddit();await d.loadMore();await d.loadReddit();
  assert.equal(calls[0].after,undefined);assert.equal(calls[1].after,'t3_abc12');assert.equal(calls[2].after,undefined);assert.equal(d.moreReddit,true);
});
test('archived text and current deletion status remain separately attributed',async t=>{
  const {d}=setup(t,{settings:{archiveDiscovery:true},reddit:async()=>({posts:[raw('old12',{selftext:'[removed]'})]})});await d.ready;await d.loadArchive();await new Promise(r=>setImmediate(r));
  assert.match((d.feed || d.results).textContent,/Public text/);assert.equal((d.feed || d.results).querySelector('details'),null);assert.match((d.feed || d.results).querySelector('[role=img]').title,/Removed on Reddit/);assert.match((d.feed || d.results).querySelector('[data-rt-source]').title,/Text recovered from Arctic Shift/);
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
  const {d}=setup(t,{settings:{archiveDiscovery:true},archive:async()=>({posts:[raw('old12',{title:'<img onerror=bad()>',selftext:'secret NSFW text',over_18:true})]}),reddit:async()=>({posts:[]})});await d.ready;await d.loadArchive();assert.equal((d.feed || d.results).querySelector('img'),null);assert.equal((d.feed || d.results).textContent.includes('secret NSFW text'),false);assert.match((d.feed || d.results).textContent,/<img onerror=bad\(\)>/);
});
test('toolbar pagination is bounded even when its Load more control is bypassed',async t=>{
  let count=0;const {d}=setup(t,{settings:{archiveDiscovery:true},archive:async()=>{count++;return {posts:[],before:1700000000-count,hasMore:true};}});await d.ready;for(let i=0;i<12;i++)await d.loadArchive();assert.equal(count,8);assert.match(d.status.textContent,/bounded/);
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
const comment=()=>({kind:'comment',id:'19rktoupyflj9',fullname:'t1_19rktoupyflj9',author:'Example',link_id:'t3_abc12',created_utc:1700000000,body:'A discovered public comment',subreddit:'example'});
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
 d.scan();const native=[...feed.children];d.live.set('duplicate',{...comment(),id:'newcomment',fullname:'t1_newcomment',created_utc:1792836000});d.live.set('middle',raw('middle',{created_utc:Date.parse('2026-10-24T00:00:00Z')/1000}));d.live.set('past',raw('past',{created_utc:Date.parse('2026-10-22T00:00:00Z')/1000}));d.render();
 assert.equal(d.nodes.get('t1_newcomment').hidden,true);assert.equal(d.nodes.get('past').hidden,true);assert.equal(d.nodes.get('middle').parentElement,feed);
 assert.equal(feed.querySelector('#recent').nextElementSibling,d.nodes.get('middle'));assert.equal(d.nodes.get('middle').nextElementSibling.id,'older');assert.equal(feed.firstElementChild.id,'pin');assert.equal(d.summaryCounts.count,1);assert.equal(d.summaryCounts.deferred,1);
 const next=W.document.createElement('article');next.innerHTML='<shreddit-post id="t3_last" created-timestamp="2026-10-21T00:00:00Z"></shreddit-post>';feed.insertBefore(next,feed.lastElementChild);d.scan();assert.equal(d.nodes.get('past').hidden,false);assert.equal(d.nodes.get('past').nextElementSibling,next);
 d.reset();assert.ok(native.every(n=>n.parentElement===feed));assert.equal(feed.querySelectorAll('[data-rt-ui]').length,0);
});

test('replacing the native feed remounts controls and removes detached injected cards',async t=>{
 const {W,d}=setup(t);await d.ready;await d.loadReddit();const oldFeed=d.feed,oldCard=d.nodes.get('abc12');const replacement=W.document.createElement('shreddit-feed');oldFeed.replaceWith(replacement);d.scan();assert.equal(d.feed,replacement);assert.equal(oldCard.isConnected,false);assert.equal(d.nodes.size,0);assert.equal(d.host.nextElementSibling,replacement);assert.equal(W.document.querySelectorAll('[data-rt-ui=posts]').length,1);
});

test('default discovery and native rendering communicate end to end without transport-id collisions',async t=>{
 const dom=new JSDOM('<main><shreddit-feed></shreddit-feed></main>',{url:'https://www.reddit.com/user/Example/submitted/',runScripts:'outside-only'}),w=dom.window,calls=[];t.after(()=>dom.window.close());w.AbortController=AbortController;
 w.customElements.define('faceplate-partial',class extends w.HTMLElement{_renderContent(text){this.innerHTML=text;}});
 w.fetch=async url=>{calls.push(new URL(url));return {ok:true,status:200,headers:new Headers({'content-type':url.includes('partial-feed-post')?'text/vnd.reddit.partial+html':'application/json'}),text:async()=>url.includes('partial-feed-post')?'<article><shreddit-post id="t3_abc12"><span slot="credit-bar">Native</span><button aria-label="Upvote">Upvote</button><button>Share</button></shreddit-post></article>':JSON.stringify({data:{children:[{kind:'t3',data:raw()}],after:null}})};};
 for(const file of ['post-model.js','post-page-bridge.js','post-discovery.js'])w.eval(fs.readFileSync('extension/'+file,'utf8'));
 const d=new w.RTPostDiscovery.Discovery({observe:false,readSettings:async()=>({'rt-settings-v1':{postDiscovery:true}})});await d.ready;await d.loadReddit();await new Promise(r=>setTimeout(r,10));
 const node=d.nodes.get('abc12');assert.equal(node.dataset.rtNativeState,'ready');assert.ok(node.querySelector('[aria-label=Upvote]'));assert.ok(node.querySelector('[data-rt-source]'));assert.equal(node.parentElement,d.feed);assert.deepEqual(calls.map(u=>u.pathname),['/search.json','/svc/shreddit/partial-feed-post/t3_abc12']);d.destroy();
});
test('native hydration attaches cards in feed order with one request in flight and never restarts ready cards',async t=>{
 const releases=[],order=[];let active=0,peak=0;
 const {W,d}=setup(t,{reddit:async()=>({posts:Array.from({length:5},(_,i)=>raw('item'+i,{created_utc:1700000000-i})),hasMore:false}),nativeRender:async(post,node)=>{order.push(post.id);active++;peak=Math.max(peak,active);await new Promise(r=>releases.push(r));active--;const native=node.ownerDocument.createElement('shreddit-post');native.id=post.fullname;node.replaceChildren(native);}});
 await d.ready;d.nativeObserver={observe(){},disconnect(){}};await d.loadReddit();
 // Visibility notifications may arrive in reverse order. Queue the entire batch
 // before draining, and prefer document order over observer delivery order.
 [...d.nodes.values()].reverse().forEach(node=>d.queueNative(node));await new Promise(r=>setImmediate(r));
 assert.deepEqual(order,['item0']);
 for(let i=0;i<5;i++){assert.equal(releases.length,1);releases.shift()();await new Promise(r=>setImmediate(r));}
 assert.equal(peak,1);assert.deepEqual(order,['item0','item1','item2','item3','item4']);d.scan();assert.equal(order.length,5);assert.equal(W.document.querySelectorAll('shreddit-post[id^=t3_item]').length,5);
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

test('a card virtualized during hydration can recover when Reddit restores it',async t=>{
 let reject,attempts=0;
 const {W,d}=setup(t,{nativeRender:async(post,node)=>{attempts++;if(attempts===1)await new Promise((_,fail)=>reject=fail);node.innerHTML=`<shreddit-post id="${post.fullname}"><span slot="credit-bar"></span></shreddit-post>`;}});
 await d.ready;await d.loadReddit();const card=d.nodes.get('abc12'),slot=W.document.createElement('div');slot.className='virtualized-placeholder';d.feed.replaceChild(slot,card);d.trackVirtualization([{target:d.feed,addedNodes:[slot],removedNodes:[card]}]);reject(Error('Page changed. Try again.'));await new Promise(r=>setImmediate(r));assert.equal(card.dataset.rtNativeState,'idle');assert.equal(card.isConnected,false);
 d.feed.replaceChild(card,slot);d.trackVirtualization([{target:d.feed,addedNodes:[card],removedNodes:[slot]}]);d.scan();await new Promise(r=>setImmediate(r));assert.equal(card.dataset.rtNativeState,'ready');assert.equal(attempts,2);assert.ok(card.querySelector('shreddit-post'));
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
 d.live.set('middle',raw('middle',{score:50,created_utc:1700000000}));d.render();assert.equal(d.nodes.get('middle').previousElementSibling.id,'higher');assert.equal(d.nodes.get('middle').nextElementSibling.id,'lower');
 W.history.pushState({},'','?sort=hot');d.scan();d.live.set('first',raw('first',{created_utc:1700000000}));d.live.set('second',raw('second',{created_utc:1700000010}));d.render();assert.equal(d.nodes.get('first').nextElementSibling,d.nodes.get('second'));
});

test('local card backpressure keeps native placeholders and resumes without Retry rows',async t=>{
 let attempts=0;const {d}=setup(t,{nativeRender:async(post,node)=>{attempts++;if(attempts===1)return {deferred:true,retryAfterMs:100};node.innerHTML=`<shreddit-post id="${post.fullname}"></shreddit-post>`;return {rendered:true};}});
 await d.ready;await d.loadReddit();await new Promise(r=>setImmediate(r));const node=d.nodes.get('abc12');assert.equal(node.dataset.rtNativeState,'queued');assert.ok(node.querySelector('.rt-native-placeholder'));assert.equal(node.querySelector('button'),null);
 await new Promise(r=>setTimeout(r,130));assert.equal(node.dataset.rtNativeState,'ready');assert.equal(attempts,2);
 assert.equal(d.loading.querySelector('faceplate-progress'),null);assert.equal(d.loading.querySelectorAll('.rt-native-placeholder').length,2);assert.ok(d.loading.querySelector('.shimmer-placeholder.bg-shimmer'));
});

test('scope changes cancel paused metadata without stale requests',async t=>{
 const {W,d,calls}=setup(t,{reddit:async()=>({deferred:true,retryAfterMs:30000})});await d.ready;const pending=d.loadReddit();await new Promise(r=>setImmediate(r));W.history.pushState({},'','?sort=top');d.scan();await pending;assert.equal(calls.length,1);assert.equal(d.nodes.size,0);assert.equal(d.busy,false);
});
test('scope changes discard a paused native-card queue',async t=>{
 let attempts=0;const {W,d}=setup(t,{nativeRender:async()=>{attempts++;return {deferred:true,retryAfterMs:100};}});await d.ready;await d.loadReddit();await new Promise(r=>setImmediate(r));assert.equal(attempts,1);
 W.history.pushState({},'','?sort=hot');d.scan();await new Promise(r=>setTimeout(r,130));assert.equal(attempts,1);assert.equal(d.nodes.size,0);
});
test('Hot refresh replaces the provider order without reverting to chronology',async t=>{
 let reverse=false;const {d}=setup(t,{url:'https://www.reddit.com/user/Example/submitted/?sort=hot',reddit:async()=>({posts:(reverse?[raw('second'),raw('first')]:[raw('first'),raw('second')]),hasMore:false})});await d.ready;await d.loadReddit();assert.equal(d.renderedPosts[0].id,'first');reverse=true;await d.loadReddit();assert.equal(d.renderedPosts[0].id,'second');assert.equal(d.nodes.get('second').nextElementSibling,d.nodes.get('first'));
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
 await new Promise(r=>setImmediate(r));assert.ok(calls.every(call=>call.action==='render-navigation'));assert.equal(nativeRenders,1);assert.equal(d.feed.querySelectorAll('.rt-native-card').length,1);assert.ok(d.archiveShell.querySelector('faceplate-tabgroup[for="profile-feed-tabs"]'));assert.equal(d.feed.tagName,'SHREDDIT-FEED');
 assert.equal(d.feed.querySelector('details'),null);assert.ok(d.feed.querySelector('shreddit-post button'));assert.match(d.feed.querySelector('[data-rt-source]').title,/Current Reddit status unknown/);assert.equal(d.feed.querySelector('.rt-archive-card'),null);
 await d.loadReddit();await new Promise(r=>setImmediate(r));assert.ok(calls.every(call=>call.action==='render-navigation'));assert.equal(nativeRenders,1);assert.equal(d.feed.querySelectorAll('.rt-native-card').length,1);assert.ok(d.archiveShell.querySelector('faceplate-tabgroup[for="profile-feed-tabs"]'));assert.equal(d.feed.tagName,'SHREDDIT-FEED');
 d.reset();assert.equal(notice.hasAttribute('data-rt-archive-notice'),false);assert.equal(W.document.querySelector('[data-rt-ui="archive-profile"]'),null);
});
test('deleted-account Overview combines archived posts/comments and empty/error states stay explicit',async t=>{
 let fail=false,empty=false;const requests=[];
 const {W,d,calls}=setup(t,{url:'https://www.reddit.com/user/Example/',settings:{archiveDiscovery:true},archive:async input=>{requests.push(input);if(fail)throw Error('Archive unavailable');return {posts:empty?[]:input.kind==='comment'?[comment()]:[raw()],hasMore:false};}});
 await d.ready;d.reset();deletedPage(W);d.scan();await d.loadArchive();await new Promise(r=>setImmediate(r));assert.deepEqual(requests.map(r=>r.kind),['post','comment']);assert.equal(d.feed.children.length,2);assert.match(d.feed.textContent,/Current native text/);assert.equal(d.feed.querySelector('details'),null);assert.equal(calls.length,0);assert.equal(d.archiveEmpty.hidden,true);
 fail=true;await d.loadArchive();assert.match(d.status.textContent,/Archive unavailable/);assert.equal(d.feed.children.length,2);
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
test('deleted header avatars use only the active account snapshot and handle failed images without shifts',async t=>{
 const {W,d}=setup(t);await d.ready;d.reset();deletedPage(W);let owner='@active:reddit.com',startup={owner:'@other:reddit.com',entry:{identities:[{name:'Example',avatar:'https://i.redd.it/other.png'}]}};
 W.RCSDirectory={getOwner:()=>owner,getStartup:()=>startup};d.scan();assert.equal(d.avatarImage,null);assert.ok(d.avatarPlaceholder.querySelector('svg[icon-name="profile-fill"]'));assert.match(d.avatarPlaceholder.getAttribute('aria-label'),/Deleted account/);
 startup={owner,entry:{identities:[{name:'Example',avatar:'https://i.redd.it/saved.png'}]}};d.updateProfileAvatar();const first=d.avatarImage;assert.equal(first.src,'https://i.redd.it/saved.png');assert.equal(first.hidden,true);first.dispatchEvent(new W.Event('load'));assert.equal(first.hidden,false);assert.equal(d.avatarPlaceholder.hidden,true);
 d.updateProfileAvatar({owner:'@other:reddit.com',records:[{type:'direct',name:'Example',avatar:'https://i.redd.it/wrong.png'}]});assert.equal(d.avatarImage,first);
 owner='@new:reddit.com';d.updateProfileAvatar();assert.equal(d.avatarImage,null);assert.equal(d.avatarPlaceholder.hidden,false);
 d.updateProfileAvatar({owner,records:[{type:'direct',name:'Example',avatar:'https://i.redd.it/broken.png'}]});const broken=d.avatarImage;broken.dispatchEvent(new W.Event('error'));assert.equal(d.avatarImage,null);d.updateProfileAvatar({owner,records:[{type:'direct',name:'Example',avatar:'https://i.redd.it/broken.png'}]});assert.equal(d.avatarImage,null);
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
 assert.equal(d.archiveOnly,true);assert.equal(d.accountState,'banned');assert.equal(d.archiveShell.dataset.rtAccountState,'banned');assert.ok(d.avatarPlaceholder.querySelector('svg[icon-name="profile-fill"][viewBox="0 0 20 20"][fill="currentColor"] path'));assert.equal(d.avatarPlaceholder.textContent,'');assert.match(d.avatarPlaceholder.getAttribute('aria-label'),/Banned or suspended/);
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
});
test('generic card avatars cannot replace the native unavailable-profile silhouette',async t=>{
 const {W,d}=setup(t);await d.ready;d.reset();bannedPage(W);d.scan();assert.ok(d.avatarPlaceholder.querySelector('svg[icon-name="profile-fill"]'));d.setProfileAvatar('https://www.redditstatic.com/avatars/defaults/v2/avatar_default_7.png','chat');assert.equal(d.avatarImage,null);
 const post=W.RTPostModel.normalizePost(raw(),{source:'arctic-shift'}),node=d.card(post);node.innerHTML='<shreddit-post author="Example" icon="https://i.redd.it/foreign.png"><span slot="credit-bar"></span></shreddit-post>';d.decorateNative(post,node);assert.equal(d.avatarImage,null);assert.equal(d.avatarPlaceholder.hidden,false);
 const css=fs.readFileSync('extension/post-discovery.css','utf8');assert.match(css,/\.rt-profile-avatar>\[hidden\]\{display:none!important\}/);assert.match(css,/\.rt-profile-avatar>img\{width:64px;height:64px/);
});
