const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const raw=(id='abc12',extra={})=>({id,author:'Example',title:'A public post',selftext:'Public text',subreddit:'example',created_utc:1700000000,score:7,num_comments:2,...extra});
function setup(t,{url='https://www.reddit.com/user/Example/submitted/',settings={postDiscovery:true,archiveDiscovery:false},reddit,archive,readSettings,nativeRender}={}){
  const dom=new JSDOM('<main id="main-content"><shreddit-feed><shreddit-post id="t3_native"></shreddit-post></shreddit-feed></main>',{url,runScripts:'outside-only',pretendToBeVisual:true});const W=dom.window,calls=[];
  for(const file of ['post-model.js','post-discovery.js'])W.eval(fs.readFileSync('extension/'+file,'utf8'));
  const nativeRenderer=nativeRender || (async(post,node)=>{const native=W.document.createElement(post.kind==='comment'?'shreddit-profile-comment':'shreddit-post');if(post.kind==='comment')native.setAttribute('comment-id',post.fullname);else native.id=post.fullname;const credit=W.document.createElement('span');credit.slot='credit-bar';const title=W.document.createElement('a');title.textContent=post.title || 'Comment';title.href=post.permalink;native.append(credit,title);if(!post.over18 && !post.spoiler){const body=W.document.createElement('p');body.textContent=post.source==='arctic-shift'?'Current native text':post.body;native.append(body);}node.replaceChildren(native);});
  const d=new W.RTPostDiscovery.Discovery({nativeRenderer,observe:false,readSettings:readSettings || (async()=>({'rt-settings-v1':settings})),reddit:async(...args)=>{calls.push(args[0]);return reddit?reddit(...args):{posts:[raw('native'),raw()],after:null,hasMore:false};},archive:archive || (async()=>({posts:[raw('old12')],hasMore:false}))});t.after(()=>{d.destroy();dom.window.close();});return {W,d,calls};
}
test('profile discovery is explicit, deduplicates native posts and stays inline',async t=>{
  const {W,d,calls}=setup(t);await d.ready;assert.equal(calls.length,0);assert.equal(d.host.nextElementSibling,d.feed);
  await d.loadReddit();assert.equal(calls.length,1);assert.equal((d.feed || d.results).querySelectorAll('.rt-native-card:not([hidden])').length,1);assert.match(d.status.textContent,/1 additional post/);assert.ok(d.nodes.get('abc12').querySelector('shreddit-post'));assert.match((d.feed || d.results).querySelector('[role=img]').title,/public Reddit search/);
  const native=W.document.createElement('shreddit-post');native.id='t3_abc12';W.document.querySelector('shreddit-feed').append(native);d.scan();assert.equal(d.nodes.get('abc12').hidden,true);assert.equal(W.document.querySelectorAll('shreddit-post[id="t3_abc12"]').length,1);
});
test('pagination uses Reddit cursors while refresh starts at the newest page',async t=>{
  const {d,calls}=setup(t,{reddit:async()=>({posts:[raw()],after:'t3_abc12',hasMore:true})});await d.ready;await d.loadReddit();await d.loadMore();await d.loadReddit();
  assert.equal(calls[0].after,undefined);assert.equal(calls[1].after,'t3_abc12');assert.equal(calls[2].after,undefined);assert.equal(d.moreReddit,true);
});
test('archived text and current deletion status remain separately attributed',async t=>{
  const {d}=setup(t,{settings:{archiveDiscovery:true},reddit:async()=>({posts:[raw('old12',{selftext:'[removed]'})]})});await d.ready;await d.loadArchive();
  assert.match((d.feed || d.results).textContent,/Archived text · Arctic Shift/);assert.match((d.feed || d.results).querySelector('[role=img]').title,/Removed on Reddit/);assert.equal((d.feed || d.results).querySelector('details').open,false);
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
test('native hydration runs at most two cards concurrently and does not restart ready cards',async t=>{
 const releases=[];let active=0,peak=0,count=0;const {W,d}=setup(t,{reddit:async()=>({posts:Array.from({length:5},(_,i)=>raw('item'+i)),hasMore:false}),nativeRender:async(post,node)=>{count++;active++;peak=Math.max(peak,active);await new Promise(r=>releases.push(r));active--;const native=node.ownerDocument.createElement('shreddit-post');native.id=post.fullname;node.replaceChildren(native);}});
 await d.ready;await d.loadReddit();assert.equal(count,2);releases.splice(0).forEach(r=>r());await new Promise(r=>setImmediate(r));assert.equal(count,4);releases.splice(0).forEach(r=>r());await new Promise(r=>setImmediate(r));releases.splice(0).forEach(r=>r());await new Promise(r=>setImmediate(r));assert.equal(peak,2);assert.equal(count,5);d.scan();assert.equal(count,5);assert.equal(W.document.querySelectorAll('shreddit-post[id^=t3_item]').length,5);
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
