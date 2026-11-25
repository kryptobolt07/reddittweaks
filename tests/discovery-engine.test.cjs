const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const nativeControls=fs.readFileSync('tests/fixtures/native-profile-controls.html','utf8');
const raw=(id='abc12',extra={})=>({id,author:'Example',title:'A public post',selftext:'Public text',subreddit:'example',created_utc:1700000000,score:7,num_comments:2,...extra});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// Same harness as post-discovery.test.cjs (synthetic fixtures only).
function setup(t,{url='https://www.reddit.com/user/Example/submitted/',settings={postDiscovery:true,archiveDiscovery:false},reddit,archive,timing={retryUnitMs:1},observe=false,chrome}={}){
  const dom=new JSDOM('<main id="main-content">'+nativeControls+'<shreddit-feed><shreddit-post id="t3_native"></shreddit-post></shreddit-feed></main>',{url,runScripts:'outside-only',pretendToBeVisual:true});const W=dom.window,calls=[];
  if(chrome)W.chrome=chrome;
  for(const file of ['post-model.js','post-discovery.js'])W.eval(fs.readFileSync('extension/'+file,'utf8'));
  const nativeRenderer=async(post,node)=>{const native=W.document.createElement(post.kind==='comment'?'shreddit-profile-comment':'shreddit-post');if(post.kind==='comment')native.setAttribute('comment-id',post.fullname);else native.id=post.fullname;const title=W.document.createElement('a');title.textContent=post.title || 'Comment';native.append(title);node.replaceChildren(native);};
  const d=new W.RTPostDiscovery.Discovery({nativeRenderer,timing,observe,autoDiscover:false,readSettings:async()=>({'rt-settings-v1':settings}),reddit:async(...args)=>{calls.push(args[0]);if(args[0].action==='render-controls'){W.document.getElementById(args[0].target).innerHTML=nativeControls;return {rendered:true};}if(args[0].stream==='public')return {posts:[],after:null,hasMore:false};return reddit?reddit(...args):{posts:[raw('native'),raw()],after:null,hasMore:false};},archive:archive || (async()=>({posts:[],hasMore:false}))});
  t.after(()=>{d.destroy();dom.window.close();});return {W,d,calls};
}
const timestamp=seconds=>new Date(seconds*1000).toISOString();
const pager=(W,feed)=>{const node=W.document.createElement('faceplate-partial');node.slot='load-after';node.setAttribute('loading','programmatic');node.setAttribute('src','/svc/shreddit/profiles/profile_posts-more-posts/new/?after=opaque');feed.append(node);return node;};
const deletedNative=(W,feed,id='t3_deleted')=>{const native=W.document.createElement('shreddit-post');native.id=id;native.setAttribute('deleted','');native.innerHTML='<p slot="text-body">[deleted]</p>';feed.append(native);return native;};
const maintenance=()=>Object.assign(Error('Arctic Shift is down.'),{code:'maintenance'});

test('Hidden defers discoveries older than the native horizon like All, and shows them once Reddit reaches them',async t=>{
  const {W,d}=setup(t,{reddit:async()=>({posts:[raw('older1',{created_utc:1699000000,title:'older discovered'})],after:null,hasMore:false})});await d.ready;
  const native=d.feed.querySelector('shreddit-post');native.setAttribute('created-timestamp',timestamp(1700000000));pager(W,d.feed);
  await d.loadReddit();for(let i=0;i<8;i++)await tick();
  const card=d.nodes.get('older1');assert.equal(card.dataset.deferred,'older');assert.equal(card.hidden,true,'All defers it');
  d.activityFilter='hidden';d.deduplicate();for(let i=0;i<4;i++)await tick();
  assert.equal(card.hidden,true,'Hidden must not claim an item Reddit has simply not paginated to yet');assert.equal(card.dataset.deferred,'older');assert.equal(card.querySelector('[role=img]'),null,'no "Not shown in this profile feed" cue');
  assert.match(d.status.title,/older discoveries will appear when Reddit loads that part/);
  // Reddit's next page reaches that far back without the item: now it really is missing from the feed.
  native.setAttribute('created-timestamp',timestamp(1698000000));d.deduplicate();for(let i=0;i<8;i++)await tick();
  assert.equal(card.dataset.deferred,'');assert.equal(card.hidden,false);assert.match(card.querySelector('[role=img]').title,/Not shown in this profile feed/);
});

test('a recovery request that fails transiently leaves its ids unchecked and retries quietly',async t=>{
  const requests=[];let fail=true;
  const {d}=setup(t,{settings:{archiveDiscovery:true},archive:async input=>{requests.push(input);if(input.action==='archive-recover' && fail)throw maintenance();return {posts:input.action==='archive-recover'?[raw('deleted',{selftext:'Recovered body'})]:[],hasMore:false};}});await d.ready;
  const native=deletedNative(d.feed.ownerDocument.defaultView,d.feed);d.deduplicate();await sleep(150);
  assert.equal(requests.filter(r=>r.action==='archive-recover').length,1);
  assert.equal(d.recoveryChecked.has('t3_deleted'),false,'not checked until the archive answered');
  assert.equal(d.sourceRetries.has('recovery'),true);assert.equal(d.sourceErrors.recovery,undefined);assert.notEqual(d.status.dataset.error,'true','no red banner');
  assert.match(d.loading.textContent,/Arctic Shift is down for maintenance/,'a quiet backoff note');
  fail=false;await d.retrySource('recovery');await sleep(150);
  assert.equal(requests.filter(r=>r.action==='archive-recover').length,2);assert.equal(d.recoveryChecked.has('t3_deleted'),true);assert.equal(d.sourceRetries.has('recovery'),false);
  assert.equal(native.querySelector('[slot="text-body"]').textContent,'Recovered body');
});

test('a permanent recovery failure still reports an error and does not loop',async t=>{
  const requests=[];const {d}=setup(t,{settings:{archiveDiscovery:true},archive:async input=>{requests.push(input);throw Object.assign(Error('Archive refused the request.'),{code:'forbidden'});}});await d.ready;
  deletedNative(d.feed.ownerDocument.defaultView,d.feed);d.deduplicate();await sleep(200);
  assert.equal(requests.length,1);assert.equal(d.recoveryChecked.has('t3_deleted'),true);assert.equal(d.sourceRetries.size,0);assert.equal(d.sourceErrors.recovery,'Archive refused the request.');assert.equal(d.status.dataset.error,'true');
});

test('reply-parent lookups stay unchecked after a transient archive failure and are retried',async t=>{
  let fail=true;const asked=[];const {W,d}=setup(t,{settings:{archiveDiscovery:true},reddit:async()=>({posts:[]}),archive:async input=>{asked.push(input);if(fail)throw Object.assign(Error('slow'),{code:'timeout'});return {posts:[{kind:'comment',id:'t1_par',fullname:'t1_par',author:'Parent',link_id:'t3_abc12',parent_id:'t3_abc12',body:'x',created_utc:1699999999,subreddit:'example'}]};}});await d.ready;
  const post=W.RTPostModel.normalizeItem({kind:'comment',id:'t1_c1',author:'Example',link_id:'t3_abc12',parent_id:'t1_par',body:'reply',created_utc:1700000000,subreddit:'example'},{source:'reddit'});
  const card=d.card(post);card.append(Object.assign(W.document.createElement('span'),{id:'poster-info-t1_c1'}));d.nodes.set('t1_c1',card);d.renderedPosts=[post];d.postMetadata.set('t1_c1',post);d.publishedCards.add('t1_c1');
  await d.enrichReplyContexts([post]);
  assert.equal(d.replyArchiveChecked.has('t1_par'),false);assert.equal(d.sourceRetries.has('replies'),true);assert.equal(asked.length,1);
  fail=false;await d.retrySource('replies');await d.replyEnrichment;
  assert.equal(asked.length,2);assert.equal(d.replyArchiveChecked.has('t1_par'),true);assert.equal(d.sourceRetries.has('replies'),false);
});

test('status verification returns a batch to the queue after a transient Reddit failure',async t=>{
  let fail=true;const {W,d}=setup(t,{settings:{archiveDiscovery:true},reddit:async input=>{if(input.action==='status'){if(fail)throw Error('Reddit requests are paused. Please try again shortly.');return {via:'info',statuses:[{fullname:'t3_old12',status:'available'}]};}return {posts:[],hasMore:false};}});await d.ready;
  const post=W.RTPostModel.normalizeItem(raw('old12'),{source:'arctic-shift'});
  await d.verifyArchiveStatuses([post]);assert.equal(d.postStatuses.has('t3_old12'),false);assert.equal(d.sourceRetries.has('verify'),true);assert.equal(d.sourceErrors['metadata-post'],undefined,'no failure note while a retry is pending');assert.equal(d.verifyRetry.length,1);
  fail=false;await d.retrySource('verify');await tick();
  assert.equal(d.postStatuses.get('t3_old12'),'available');assert.equal(d.verifyRetry.length,0);assert.equal(d.sourceRetries.has('verify'),false);
});

test('Refresh forgets stored statuses so a re-approved item loses its stale cue',async t=>{
  const {d,calls}=setup(t,{settings:{archiveDiscovery:true},archive:async()=>({posts:[raw('old12')],hasMore:false})});await d.ready;
  await d.loadArchive();d.postStatuses.set('t3_old12','removed');d.postStatuses.set('t3_other','deleted');
  const before=calls.filter(c=>c.action==='status').length;
  await d.loadReddit();assert.equal(d.postStatuses.has('t3_other'),false);assert.equal(d.postStatuses.has('t3_old12'),false,'Reddit has not re-confirmed it');
  // More pages and retries keep what is known.
  d.postStatuses.set('t3_keep','removed');await d.loadReddit({more:true});assert.equal(d.postStatuses.get('t3_keep'),'removed');
  // Filtered views re-verify the archive candidates after a refresh.
  d.activityFilter='hidden';await d.loadReddit();await tick();assert.ok(calls.filter(c=>c.action==='status').length>before);
});

test('a settings change that changes nothing, or arrives twice, resets at most once',async t=>{
  const {d}=setup(t);await d.ready;let resets=0;const reset=d.reset.bind(d);d.reset=(...args)=>{resets++;return reset(...args);};
  const host=d.host,generation=d.generation;
  d.onSettings({'rt-settings-v1':{newValue:{postDiscovery:true,archiveDiscovery:false}}},'local');assert.equal(resets,0,'identical settings');assert.equal(d.host,host);assert.equal(d.generation,generation);
  const worker=d.onWorkerSettings;
  d.onSettings({'rt-settings-v1':{newValue:{postDiscovery:true,archiveDiscovery:true}}},'local');assert.ok(resets>=1,'a real change rebuilds the view');const rebuilt=resets,built=d.host;
  d.onSettings({'rt-settings-v1':{newValue:{postDiscovery:true,archiveDiscovery:true}}},'local');assert.equal(resets,rebuilt,'the duplicate delivery changes nothing');assert.equal(d.host,built);
  d.onSettings({'rt-settings-v1':{newValue:{postDiscovery:true,archiveDiscovery:true,restoreDeletedContent:true}}},'local');assert.equal(resets,rebuilt,'defaults normalise to the same settings');
  assert.equal(typeof worker,'function');
});

test('turning restoration on or off adjusts the open profile without rebuilding it',async t=>{
  const requests=[];const {d}=setup(t,{settings:{archiveDiscovery:true,restoreDeletedContent:false},archive:async input=>{requests.push(input);return {posts:input.action==='archive-recover'?[raw('deleted',{selftext:'Recovered body'})]:[],hasMore:false};}});await d.ready;
  const native=deletedNative(d.feed.ownerDocument.defaultView,d.feed);d.deduplicate();await sleep(150);assert.equal(requests.length,0,'restoration is off');
  const host=d.host,feed=d.feed,generation=d.generation;
  d.onSettings({'rt-settings-v1':{newValue:{postDiscovery:true,archiveDiscovery:true,restoreDeletedContent:true}}},'local');await sleep(200);
  assert.equal(d.host,host);assert.equal(d.feed,feed);assert.equal(d.generation,generation,'no teardown');
  assert.equal(requests.filter(r=>r.action==='archive-recover').length,1);assert.equal(native.querySelector('[slot="text-body"]').textContent,'Recovered body');
  d.onSettings({'rt-settings-v1':{newValue:{postDiscovery:true,archiveDiscovery:true,restoreDeletedContent:false}}},'local');await sleep(50);
  assert.equal(d.host,host);assert.equal(d.generation,generation);assert.equal(native.querySelector('[slot="text-body"]').textContent,'[deleted]','Reddit’s own notice is back');
  d.onSettings({'rt-settings-v1':{newValue:{postDiscovery:true,archiveDiscovery:true,restoreDeletedContent:true}}},'local');await sleep(200);
  assert.equal(requests.filter(r=>r.action==='archive-recover').length,2,'turning it on again asks again');assert.equal(native.querySelector('[slot="text-body"]').textContent,'Recovered body');
});

test('archive-only items with unknown status use the archive icon; verified states keep theirs',async t=>{
  const {W,d}=setup(t);await d.ready;const icon=post=>d.indicator(post).querySelector('svg').dataset.icon;
  const archived=W.RTPostModel.normalizeItem(raw('old12'),{source:'arctic-shift'}),live=W.RTPostModel.normalizeItem(raw('abc12'),{source:'reddit'});
  assert.equal(icon({...archived,status:'unknown'}),'archive');assert.equal(icon({...archived,status:'available'}),'hidden');assert.equal(icon({...archived,status:'deleted'}),'deleted');assert.equal(icon({...archived,status:'removed'}),'removed');assert.equal(icon(live),'hidden');
});

test('page-level churn does not reconcile a mounted profile whose structure is unchanged',async t=>{
  const {W,d}=setup(t);await d.ready;await d.loadReddit();await tick();
  const count=name=>{let n=0;const original=d[name].bind(d);d[name]=(...args)=>{n++;return original(...args);};return ()=>n;};
  const dedupe=count('deduplicate'),menu=count('ensureActivityMenu'),loading=count('observeNativeLoading');
  W.document.body.append(W.document.createElement('div'));
  d.scan({cheap:true});d.scan({cheap:true});assert.equal(dedupe()+menu()+loading(),0,'identity unchanged: no reconcile');
  d.scan();assert.ok(dedupe()>0 && menu()>0 && loading()>0,'an explicit scan still reconciles');
  const before=dedupe();
  // Reddit replaces its Feed options dropdown: the mounted identity changed.
  const dropdown=W.document.querySelector('rpl-dropdown');dropdown.replaceWith(dropdown.cloneNode(true));
  d.scan({cheap:true});assert.ok(dedupe()>before,'a replaced dropdown is noticed');
  const second=dedupe();d.scan({cheap:true});assert.equal(dedupe(),second,'and settles again');
  const feed=d.feed,replacement=feed.cloneNode(false);feed.replaceWith(replacement);d.scan({cheap:true});assert.notEqual(d.feed,feed,'a replaced feed is noticed');
});

test('the page-wide observer skips unrelated routes and unrelated churn',async t=>{
  const {W,d}=setup(t,{observe:true});await d.ready;await d.loadReddit();await tick();
  let scans=0;const scan=d.scan.bind(d);d.scan=options=>{scans++;return scan(options);};
  W.document.body.append(W.document.createElement('div'));await sleep(150);
  assert.equal(scans,1,'one cheap scan for the churn');
  const dedupe=d.deduplicate.bind(d);let dedupes=0;d.deduplicate=()=>{dedupes++;return dedupe();};
  W.document.body.append(W.document.createElement('div'));await sleep(150);assert.equal(dedupes,0,'and it reconciled nothing');
  d.reset();W.history.pushState({},'','/r/example/');assert.equal(d.idleRoute(),true,'nothing mounted off profile pages');
  scans=0;W.document.body.append(W.document.createElement('div'));await sleep(150);assert.equal(scans,0,'no scan is even scheduled');
  W.history.pushState({},'','/user/Example/submitted/');assert.equal(d.idleRoute(),false);
});

test('activity placeholders are ours, and a slot is only written when its state changes',async t=>{
  const {W,d}=setup(t);await d.ready;await d.loadReddit();await tick();
  const card=d.nodes.get('abc12');assert.equal(card.parentElement,d.feed);
  const slot=W.document.createElement('div');slot.className='virtualized-placeholder';d.feed.replaceChild(slot,card);d.trackVirtualization([{target:d.feed,addedNodes:[slot],removedNodes:[card]}]);
  assert.equal(slot.dataset.rtUi,'activity-slot');
  assert.equal(d.ownsMutation({target:slot,addedNodes:[],removedNodes:[],type:'attributes'}),true);
  const observer=new W.MutationObserver(()=>{});observer.observe(d.feed,{attributes:true,subtree:true,attributeFilter:['hidden']});
  d.deduplicate();d.deduplicate();assert.equal(observer.takeRecords().length,0,'unchanged cards and slots are not rewritten');
  // A real change is written once.
  d.nodes.get('abc12').hidden=true;observer.takeRecords();d.deduplicate();const records=observer.takeRecords().filter(r=>r.target===slot);assert.ok(records.length<=1);assert.equal(slot.hidden,d.nodes.get('abc12').hidden);
  observer.disconnect();
});

test('hot paths walk the feed shell, not every card; helpers are cached and hoisted',async t=>{
  const {W,d}=setup(t,{reddit:async()=>({posts:Array.from({length:6},(_,i)=>raw('p'+i,{created_utc:1700000000-i})),hasMore:false})});await d.ready;await d.loadReddit();await tick();
  pager(W,d.feed).innerHTML='<shreddit-feed-page-loading></shreddit-feed-page-loading>';
  // Cards (and anything inside them) hold lookalike markers that a subtree query would trip over.
  const decoy=d.feed.querySelector('shreddit-post');decoy.innerHTML='<faceplate-partial slot="load-after" loading="lazy" src="/decoy"></faceplate-partial><shreddit-loading></shreddit-loading>';
  let subtree=0;const query=d.feed.querySelectorAll.bind(d.feed);d.feed.querySelectorAll=(...args)=>{subtree++;return query(...args);};
  const continuation=d.nativeContinuation();assert.equal(continuation.getAttribute('src').includes('opaque'),true,'the real pager, not the decoy in a card');
  d.observeNativeLoading();d.nativeFeedLoading();assert.equal(subtree,0,'no whole-feed queries');
  // publicationFloor once per pass, however many posts.
  await tick();await tick();let floors=0;const floor=d.publicationFloor.bind(d);d.publicationFloor=()=>{floors++;return floor();};
  d.pendingProfilePosts();assert.equal(floors,1);
  // verification queue uses a set and stays duplicate free.
  d.verifyActive=true;const post=W.RTPostModel.normalizeItem(raw('old12'),{source:'arctic-shift'});d.verifyArchiveStatuses([post]);d.verifyArchiveStatuses([post]);d.verifyArchiveStatuses([post],{force:true});assert.equal(d.verifyQueue.length,1);assert.equal(d.verifyQueued.has('t3_old12'),true);
  // community artwork is looked for once per community.
  let scans=0;const all=W.document.querySelectorAll.bind(W.document);W.document.querySelectorAll=(selector,...rest)=>{if(selector==='a[href]')scans++;return all(selector,...rest);};
  d.communityAvatar('somewhere');d.communityAvatar('somewhere');d.communityAvatar('SOMEWHERE');assert.equal(scans,1);
  const link=W.document.createElement('a');link.href='/r/somewhere/';link.innerHTML='<img src="https://styles.redditmedia.com/somewhere.png">';W.document.body.append(link);
  assert.equal(d.communityAvatar('somewhere').querySelector('img')?.src,'https://styles.redditmedia.com/somewhere.png','a changed page is searched again');
});

test('a card elsewhere on the page does not hide a discovered result',async t=>{
  const {W,d}=setup(t);await d.ready;
  const elsewhere=W.document.createElement('aside');elsewhere.innerHTML='<shreddit-post id="t3_abc12"></shreddit-post>';W.document.body.append(elsewhere);
  await d.loadReddit();await tick();await tick();
  assert.equal(d.visibleIds().has('t3_abc12'),false);assert.equal(d.visibleIds().has('t3_native'),true);
  const card=d.nodes.get('abc12');assert.equal(card.hidden,false,'shown in the feed');assert.equal(card.parentElement,d.feed);
  // A card inside this feed (even in a native batch) still counts.
  const batch=W.document.createElement('faceplate-batch');batch.innerHTML='<article><shreddit-post id="t3_batched"></shreddit-post></article>';d.feed.append(batch);assert.equal(d.visibleIds().has('t3_batched'),true);
});

test('an orphaned content script cleans up and stops',async t=>{
  const runtime={id:'extension',onMessage:{addListener(){},removeListener(){}}};
  const {W,d}=setup(t,{observe:true,chrome:{runtime,storage:{onChanged:{addListener(){},removeListener(){}}}}});await d.ready;await d.loadReddit();await tick();
  assert.equal(d.host.isConnected,true);
  delete runtime.id;// the extension was reloaded
  W.document.body.append(W.document.createElement('div'));await sleep(30);
  assert.equal(d.dead,true);assert.equal(W.document.querySelector('[data-rt-ui]'),null,'the injected interface is gone');assert.equal(d.host,null);
  d.scan();W.document.body.append(W.document.createElement('div'));await sleep(100);assert.equal(d.host,null,'and nothing mounts again');
  d.onSettings({'rt-settings-v1':{newValue:{postDiscovery:true,archiveDiscovery:true}}},'local');assert.equal(d.host,null);
});

test('Signed-out comment search: on by default for a comments feed, and its toggle turns the signed-out stream off',async t=>{
  for(const [settings,expected] of [[{postDiscovery:true},true],[{postDiscovery:true,signedOutSearch:false},false]]){
    const {d,calls}=setup(t,{url:'https://www.reddit.com/user/Example/comments/',settings});await d.ready;
    await d.loadReddit();for(let i=0;i<6;i++)await tick();
    const comments=calls.filter(c=>c.action==='profile' && c.kind==='comment');
    assert.equal(comments.some(c=>c.stream==='public'),expected,JSON.stringify(settings));
    assert.equal(comments.some(c=>c.stream==='authenticated'),true,'the signed-in stream always runs');
  }
});
