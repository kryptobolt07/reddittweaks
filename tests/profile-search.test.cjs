const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const controls=fs.readFileSync('tests/fixtures/native-profile-controls.html','utf8');
const read=f=>fs.readFileSync('extension/'+f,'utf8');
const flush=async()=>{for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r));};
const raw=(id,extra={})=>({id,author:'Example',title:'Synthetic search post',selftext:'Synthetic words',subreddit:'Alpha',created_utc:1700000000,score:4,num_comments:2,is_self:true,...extra});
// Synthetic shape from the recon: controls outside main; tabs/scope remain native;
// post and comment search units are children of the neutral result container.
const page=`<div data-testid="search-results-filter-spacer-desktop"><faceplate-dropdown-menu id="native-sort"><button>Sort</button><a href="/user/Example/search/?sort=new">New</a></faceplate-dropdown-menu><faceplate-dropdown-menu id="native-time" hidden><a href="/user/Example/search/?t=week">Past week</a></faceplate-dropdown-menu></div>
<main class="main"><faceplate-tabgroup id="search-results-page-tabgroup"><a id="search-results-page-tab-posts" href="?type=posts">Posts</a><a id="search-results-page-tab-comments" href="?type=comments">Comments</a><a id="search-results-page-tab-media" href="?type=media">Media</a></faceplate-tabgroup><div data-testid="search-scope-switcher">Show results from all of Reddit</div><div class="bg-neutral-background" id="native-results"><search-telemetry-tracker data-testid="search-sdui-post" data-thingid="t3_live"><div data-testid="search-post-unit">Native result</div></search-telemetry-tracker><div data-testid="search-sdui-comment-unit"><search-telemetry-tracker data-faceplate-tracking-context='{"comment":{"id":"t1_comment","post_id":"t3_parent"}}'></search-telemetry-tracker><div data-testid="search-comment-content">Synthetic comment</div></div><faceplate-partial loading="lazy" src="/search-more"></faceplate-partial></div></main>`;
function setup(t,{url='https://www.reddit.com/user/Example/search/?q=words',settings={postDiscovery:true,archiveDiscovery:true},html=page,reddit,archive,renderer,aggregate,autoDiscover=false,observe=false}={}){
  const dom=new JSDOM(html,{url,runScripts:'outside-only',pretendToBeVisual:true}),W=dom.window,calls=[],queries=[],aggregates=[];
  for(const file of ['search-core.js','post-model.js','feed-filters.js','post-discovery.js','profile-search.js'])W.eval(read(file));
  W.RTArchiveQuery={async *search(args){queries.push(args);const result=archive?await archive(args,queries.length):{items:[raw('live'),raw('archive',{created_utc:1600000000})],hasMore:false,searchedBackTo:1600000000};
    yield {...result,items:(result.items || []).map(p=>W.RTPostModel.normalizeItem(p,{source:'arctic-shift'}))};},async aggregate(args){aggregates.push(args);return aggregate?aggregate(args):{ok:true,buckets:[{key:'Alpha',count:9}]};}};
  const nativeRenderer=renderer || (async(post,node)=>{const native=W.document.createElement(post.kind==='comment'?'shreddit-profile-comment':'shreddit-post');native.setAttribute(post.kind==='comment'?'comment-id':'id',post.fullname);if(post.kind!=='comment')native.setAttribute('post-type',post.postType);native.innerHTML='<span slot="credit-bar"></span><p slot="text-body">Native synthetic body</p>';node.replaceChildren(native);return {fullname:post.fullname,status:'available'};});
  const d=new W.RTPostDiscovery.Discovery({observe,autoDiscover,nativeRenderer,readSettings:async()=>({'rt-settings-v1':settings}),reddit:async args=>{calls.push(args);
    if(args.action==='render-controls'){W.document.getElementById(args.target).innerHTML=controls;return {rendered:true};}
    if(args.action==='render-navigation')return {rendered:true};
    if(args.action==='status')return {via:'info',statuses:args.ids.map(id=>({fullname:(args.kind==='comment'?'t1_':'t3_')+id,status:'available'}))};
    return reddit?reddit(args):{posts:[raw('live')],hasMore:false};},archive:async()=>{throw Error('Search must use RTArchiveQuery, not archive-profile');}});
  t.after(()=>{d.destroy();W.close();});return {W,D:W.document,d,calls,queries,aggregates};
}
async function boot(t,options){const s=setup(t,options);await s.d.ready;await flush();return s;}
async function search(s){await s.d.refreshActivity();await flush();}
const shown=d=>[...d.feed.children].filter(n=>n.dataset.rtUi==='activity-item' && !n.hidden).map(n=>n.dataset.fullname);

test('search route accepts absent/empty q and preserves query and native tab state',async t=>{
  const {W}=await boot(t);const route=W.RTPostDiscovery.pageRoute;
  for(const q of ['', '?q=']){const r=route('/user/Example/search/',q);assert.equal(r.view,'search');assert.equal(r.q,'');assert.equal(r.sort,'new');assert.equal(r.type,'posts');}
  assert.equal(route('/user/Example/search/','?q=words&type=comments').type,'comments');
  assert.equal(route('/user/Example/search/','?q=words&type=media').type,'media');
  assert.equal(route('/search/','?q=words'),null);
  assert.equal(route('/user/Example/search/','?q='+ 'x'.repeat(301)),null);
});
test('plain search merges client and archive into one native feed, deduping fullnames',async t=>{
  const s=await boot(t);await search(s);
  assert.equal(s.calls.filter(c=>c.action==='profile').length,1);assert.equal(s.calls.find(c=>c.action==='profile').query,'words');assert.equal(s.calls.find(c=>c.action==='profile').sort,'relevance');
  assert.equal(s.queries.length,1);assert.equal(s.queries[0].author,'Example');assert.deepEqual([...s.queries[0].parsed.terms],['words']);
  assert.deepEqual(shown(s.d),['t3_live','t3_archive']);assert.equal(s.d.feed.querySelectorAll('#t3_live').length,1);assert.equal(s.d.nodes.get('live').querySelector('shreddit-post').id,'t3_live');
  assert.equal(s.D.querySelector('[data-rt-profile-search]'),null);assert.doesNotMatch(s.D.body.textContent,/Not in these results/);
});
test('without q, search browses and filters author history from both sources',async t=>{
  const s=await boot(t,{url:'https://www.reddit.com/user/Example/search/'});await search(s);
  assert.equal(s.calls.find(c=>c.action==='profile').query,'');assert.equal(s.calls.find(c=>c.action==='profile').sort,'new');assert.equal(s.queries.length,1);assert.equal(s.queries[0].parsed.terms.length,0);assert.equal(shown(s.d).length,2);
  assert.ok(s.d.rtMenu.groups.date);assert.ok(s.d.rtMenu.groups.type);assert.ok(s.d.rtMenu.groups.sub);assert.equal(s.d.rtMenu.searchSort.has('relevance'),false);
});
test('OR, exclusions and Old sort use only the archive',async t=>{
  for(const suffix of ['?q=cat+OR+dog','?q=cat+-dog','?q=cat+-"exact+phrase"','?q=cat&rt_sort=old','?q=cat&sort=old']){
    const s=await boot(t,{url:'https://www.reddit.com/user/Example/search/'+suffix});await search(s);
    assert.equal(s.calls.filter(c=>c.action==='profile').length,0,suffix);assert.equal(s.queries.length,1);assert.equal(s.d.clientSearchOn(),false);
    if(suffix.includes('old')){assert.equal(s.queries[0].sort,'asc');assert.deepEqual(shown(s.d),['t3_archive','t3_live']);assert.match(s.d.notice.textContent,/Searched up to/);}
  }
});
test('deleted and banned accounts use archive profile shell with native search tabs',async t=>{
  for(const html of ['<shreddit-app><div><img alt="Deleted user"><h3>This account has been deleted</h3></div></shreddit-app>', '<shreddit-app><div id="shreddit-forbidden"><svg icon-name="ban-fill"></svg><h3 id="shreddit-forbidden-title">This account has been suspended</h3></div></shreddit-app>']){
    const s=await boot(t,{html});await search(s);assert.equal(s.d.archiveOnly,true);assert.equal(s.calls.filter(c=>c.action==='profile').length,0);assert.equal(s.queries.length,1);
    assert.ok(s.D.querySelector('[data-rt-ui="archive-profile"]'));const tab=s.D.getElementById('search-results-page-tab-comments');assert.ok(tab);assert.match(tab.href,/\/user\/Example\/search\/\?q=words&type=comments/);assert.ok(s.d.feed.querySelector('shreddit-post'));
  }
});
test('client cards are locally narrowed by Date, Post type and Subreddit',async t=>{
  const s=await boot(t,{url:'https://www.reddit.com/user/Example/search/?q=words&rt_date=2023-11-01..2023-11-30&rt_type=image&rt_sub=Alpha',reddit:async()=>({posts:[raw('match',{is_self:false,post_hint:'image'}),raw('wrongsub',{is_self:false,post_hint:'image',subreddit:'Beta'}),raw('wrongtype'),raw('wrongdate',{is_self:false,post_hint:'image',created_utc:1600000000})],hasMore:false}),archive:async()=>({items:[],hasMore:false})});await search(s);
  assert.deepEqual(shown(s.d),['t3_match']);assert.equal(s.queries[0].subreddit,'Alpha');assert.deepEqual([...s.queries[0].postTypes],['image']);assert.equal(s.queries[0].after,new Date(2023,10,1).getTime()/1000);assert.equal(s.queries[0].before,new Date(2023,11,1).getTime()/1000);
});
test('tab switching changes kind, drops old work and uses media post types',async t=>{
  const s=await boot(t);await search(s);const old=s.d.feed;
  s.W.history.pushState({},'','?q=words&type=comments');s.d.scan();await flush();await search(s);
  assert.equal(old.isConnected,false);assert.equal(s.queries.at(-1).kind,'comment');assert.equal(s.calls.filter(c=>c.action==='profile').at(-1).kind,'comment');assert.equal(s.calls.some(c=>c.stream==='public'),false);assert.equal(s.d.rtMenu.groups.type,undefined);
  s.W.history.pushState({},'','?q=words&type=media');s.d.scan();await flush();await search(s);
  assert.equal(s.queries.at(-1).kind,'post');assert.deepEqual([...s.queries.at(-1).postTypes],['image','gif','video','gallery']);assert.deepEqual(shown(s.d),[]);
});
test('incoming Reddit sort/time map to filters; rt overrides preserve Reddit URL params',async t=>{
  const s=await boot(t,{url:'https://www.reddit.com/user/Example/search/?q=words&type=posts&sort=comments&t=week&cId=synthetic'});
  assert.equal(s.d.effectiveSort(),'comments');assert.equal(s.d.rtFilters.date.preset,'week');assert.match(s.d.rtMenu.searchSort.get('comments').textContent,/Loaded items only/);
  s.d.setFilters({...s.d.rtFilters,sort:'old',date:null});await flush();
  const p=new URLSearchParams(s.W.location.search);assert.equal(p.get('rt_sort'),'old');assert.equal(p.get('rt_date'),'all');assert.equal(p.get('sort'),'comments');assert.equal(p.get('t'),'week');assert.equal(p.get('q'),'words');assert.equal(p.get('type'),'posts');assert.equal(p.get('cId'),'synthetic');assert.equal(s.d.rtFilters.date,null);assert.equal(s.d.effectiveSort(),'old');
  s.W.history.replaceState({},'','?q=words&sort=top&t=hour');s.d.scan();await flush();assert.equal(s.d.effectiveSort(),'top');assert.equal(s.d.rtFilters.date.preset,'hour');
});
test('native result list and sort/time controls hide reversibly; native tabs and scope stay usable',async t=>{
  const s=await boot(t);const results=s.D.getElementById('native-results'),sort=s.D.getElementById('native-sort'),time=s.D.getElementById('native-time');
  assert.equal(results.hidden,true);assert.equal(sort.hidden,true);assert.equal(time.hidden,true);assert.equal(s.D.getElementById('search-results-page-tabgroup').hidden,false);assert.equal(s.D.querySelector('[data-testid="search-scope-switcher"]').hidden,false);
  const replacement=s.D.createElement('div');replacement.className='bg-neutral-background';replacement.textContent='SPA continuation';results.after(replacement);s.d.scan();assert.equal(replacement.hidden,true);
  s.W.history.pushState({},'','/r/Synthetic/');s.d.scan();assert.equal(results.hidden,false);assert.equal(sort.hidden,false);assert.equal(time.hidden,true);assert.equal(replacement.hidden,false);assert.equal(s.D.querySelector('[data-rt-ui="search-feed"]'),null);assert.equal(s.D.querySelector('[data-rt-search-hidden]'),null);
});
test('archive setting off leaves Reddit search untouched and turning it off restores originals',async t=>{
  const off=await boot(t,{settings:{postDiscovery:true,archiveDiscovery:false}});assert.equal(off.d.host,null);assert.equal(off.D.querySelector('[data-rt-search-hidden]'),null);assert.equal(off.calls.length,0);assert.equal(off.queries.length,0);assert.equal(off.D.getElementById('native-results').hidden,false);
  const s=await boot(t);s.d.applySettings({postDiscovery:true,archiveDiscovery:false,restoreDeletedContent:true});assert.equal(s.d.host,null);assert.equal(s.D.getElementById('native-results').hidden,false);assert.equal(s.D.getElementById('native-sort').hidden,false);
});
test('status retains a searched date on exhausted windows without claiming full coverage',async t=>{
  const s=await boot(t);await search(s);assert.match(s.d.notice.textContent,/Searched back to/);assert.equal(s.d.notice.hidden,false);assert.doesNotMatch(s.d.status.textContent+s.d.notice.textContent,/all results|history complete|search complete/i);
  const old=s.d.notice.textContent;s.d.noteSearched({hasMore:false,searchedBackTo:null});s.d.summarize();assert.equal(s.d.notice.textContent,old);
});
test('empty state uses Reddit wording while failures remain retryable and incomplete',async t=>{
  const s=await boot(t,{reddit:async()=>({posts:[],hasMore:false}),archive:async()=>({items:[],hasMore:false})});await search(s);assert.equal(s.d.activityEmpty.hidden,false);assert.match(s.d.emptyTitle.textContent,/couldn't find any results/);assert.match(s.d.activityEmpty.textContent,/coverage may be incomplete/);assert.doesNotMatch(s.d.notice.textContent,/1970/);
  const fail=await boot(t,{archive:async()=>{throw Error('Archive temporarily unavailable');}});await search(fail);assert.equal(fail.d.status.dataset.error,'true');assert.match(fail.d.status.textContent,/unavailable/);assert.equal(fail.d.nodes.get('live').hidden,false);assert.equal(fail.d.activityEmpty?.hidden ?? true,true);
});
test('search pagination continues both cursors and caps each automatic window at ten pages',async t=>{
  const s=await boot(t,{reddit:async args=>({posts:[],after:'cursor-'+(args.after || 'first'),hasMore:true}),archive:async(args,n)=>({items:[],cursor:1700000000-n,hasMore:true,searchedBackTo:1700000000-n})});await search(s);
  for(let i=0;i<10;i++)await s.d.loadMore();await flush();
  assert.equal(s.queries.length,11);assert.equal(s.calls.filter(c=>c.action==='profile').length,11);assert.equal(s.queries[1].cursor,1699999999);assert.equal(s.calls.filter(c=>c.action==='profile')[1].after,'cursor-first');assert.equal(s.d.hasMoreProfile(),true);assert.equal(s.d.searchBudgetPaused(),true);assert.match(s.d.loading.textContent,/Search older/);
  await s.d.loadMore();assert.equal(s.queries.length,11);s.d.loading.querySelector('button').click();await flush();assert.equal(s.queries.length,12);assert.equal(s.d.searchBudgetPaused(),false);
});
test('Relevance keeps client ranking ahead of archive-only matches; loaded-item comment sort works',async t=>{
  const s=await boot(t,{reddit:async()=>({posts:[raw('rank1',{created_utc:1500000000}),raw('rank2',{created_utc:1600000000})],hasMore:false}),archive:async()=>({items:[raw('newer',{created_utc:1800000000}),raw('older',{created_utc:1400000000})],hasMore:false})});await search(s);assert.deepEqual(shown(s.d),['t3_rank1','t3_rank2','t3_newer','t3_older']);
  const c=await boot(t,{url:'https://www.reddit.com/user/Example/search/?q=words&sort=comments',reddit:async()=>({posts:[raw('few',{num_comments:1}),raw('many',{num_comments:50})],hasMore:false}),archive:async()=>({items:[raw('mid',{num_comments:10})],hasMore:false})});await search(c);assert.deepEqual(shown(c.d),['t3_many','t3_mid','t3_few']);
});
test('Feed options reuses native groups, submenu size, pills and author aggregate',async t=>{
  const s=await boot(t);assert.ok(s.d.activityDropdown.querySelector('button[aria-label="Feed options"]'));assert.ok(s.d.activityMenu);assert.ok(s.d.rtMenu.groups.date);assert.ok(s.d.rtMenu.groups.type);assert.ok(s.d.rtMenu.groups.sub);assert.equal(s.d.rtChips.parentNode,s.d.controlsTarget);
  s.d.activityMain.getBoundingClientRect=()=>({height:312});s.d.rtMenu.groups.sub.el.click();assert.equal(s.d.rtMenu.groups.sub.sub.style.getPropertyValue('--rt-menu-height'),'312px');await flush();assert.equal(s.aggregates[0].author,'Example');assert.match(s.d.rtMenu.sub.note.textContent,/Counts from the archive/);
  s.d.setFilters({...s.d.rtFilters,subreddits:['Alpha']});await flush();assert.match(s.d.rtChips.textContent,/Alpha/);assert.equal(s.d.rtChips.parentNode,s.d.controlsTarget);
});
test('invalid queries explain the problem without starting either source',async t=>{
  const s=await boot(t,{url:'https://www.reddit.com/user/Example/search/?q=cat+OR'});await search(s);assert.equal(s.queries.length,0);assert.equal(s.calls.filter(c=>c.action==='profile').length,0);assert.match(s.d.status.textContent,/word on both sides/);
});

test('leaving while either source is in flight aborts it and ignores late answers',async t=>{
  let finishReddit,finishArchive,signal;
  const s=await boot(t,{reddit:async()=>new Promise(r=>{finishReddit=r;}),archive:async args=>{signal=args.signal;return new Promise(r=>{finishArchive=r;});}});
  const pending=s.d.refreshActivity();await flush();const oldFeed=s.d.feed;
  s.W.history.pushState({},'','/r/Synthetic/');s.d.scan();assert.equal(signal.aborted,true);assert.equal(oldFeed.isConnected,false);assert.equal(s.D.getElementById('native-results').hidden,false);
  finishReddit({posts:[raw('late')],hasMore:false});finishArchive({items:[raw('latearchive')],hasMore:false});await pending;await flush();assert.equal(s.d.context,null);assert.equal(s.d.nodes.size,0);assert.equal(s.D.querySelector('#t3_late'),null);
});
test('post type filters wait for native type proof rather than guessing from search metadata',async t=>{
  const rendered=[];const s=await boot(t,{url:'https://www.reddit.com/user/Example/search/?q=words&rt_type=image',reddit:async()=>({posts:[raw('image'),raw('text')],hasMore:false}),archive:async()=>({items:[],hasMore:false}),renderer:async(post,node)=>{rendered.push(post.id);node.innerHTML='<shreddit-post id="'+post.fullname+'" post-type="'+(post.id==='image'?'image':'text')+'"><span slot="credit-bar"></span></shreddit-post>';}});await search(s);
  assert.deepEqual(rendered,['image','text']);assert.deepEqual(shown(s.d),['t3_image']);
});
test('native comment cards merge by t1 fullname and keep one authenticated source',async t=>{
  const comment=(id,body)=>({kind:'comment',id,author:'Example',body,link_id:'parent',parent_id:'t3_parent',subreddit:'Alpha',created_utc:1700000000});
  const s=await boot(t,{url:'https://www.reddit.com/user/Example/search/?q=words&type=comments',reddit:async()=>({posts:[comment('c1','Synthetic client words')],hasMore:false}),archive:async()=>({items:[comment('c1','Synthetic archive words'),comment('c2','Other synthetic words')],hasMore:false})});await search(s);
  assert.deepEqual(shown(s.d),['t1_c1','t1_c2']);assert.equal(s.d.feed.querySelectorAll('shreddit-profile-comment[comment-id="t1_c1"]').length,1);assert.equal(s.calls.filter(c=>c.action==='profile').length,1);assert.equal(s.queries[0].postTypes,undefined);
});
test('archive status cues follow current Reddit evidence and Deleted never includes an unverified item',async t=>{
  const s=await boot(t,{reddit:async()=>({posts:[],hasMore:false}),archive:async()=>({items:[raw('gone'),raw('live')],hasMore:false}),renderer:async(post,node)=>{node.innerHTML='<shreddit-post id="'+post.fullname+'" post-type="text"><span slot="credit-bar"></span><div slot="text-body">'+(post.id==='gone'?'[removed]':'Current synthetic text')+'</div></shreddit-post>';}});await search(s);
  assert.match(s.d.nodes.get('gone').querySelector('[data-rt-source]').title,/Removed on Reddit/);assert.match(s.d.nodes.get('gone').textContent,/Synthetic words/);
  s.d.activityFilter='deleted';s.d.deduplicate();await flush();assert.deepEqual(shown(s.d),['t3_gone']);assert.doesNotMatch(s.d.nodes.get('live').querySelector('[data-rt-source]').title,/Deleted on Reddit|Removed on Reddit/);
});
test('archive fallback retains a native card and unknown status instead of inventing deletion',async t=>{
  const s=await boot(t,{url:'https://www.reddit.com/user/Example/search/?q=words+-excluded',archive:async()=>({items:[raw('fallback')],hasMore:false}),renderer:async()=>{throw Error('Reddit could not render this card (HTTP 404).');}});await search(s);
  const card=s.d.nodes.get('fallback');assert.ok(card.querySelector('shreddit-post'));assert.equal(card.dataset.rtArchiveFallback,'true');assert.doesNotMatch(card.querySelector('[data-rt-source]').title,/Deleted on Reddit|Removed on Reddit/);
});
test('author aggregate counts do not add archive snapshots a second time',async t=>{
  const s=await boot(t);await search(s);s.d.loadSubredditCounts();await flush();assert.equal(s.d.subredditCounts().source,'archive');assert.equal(s.d.subredditCounts().entries.find(e=>e.key==='Alpha').count,9);
});
test('the early notice guard returns unavailable search pages when archive discovery is off',async t=>{
  const dom=new JSDOM('<shreddit-app><div><img alt="Deleted user"><h3>This account has been deleted</h3></div></shreddit-app>',{url:'https://www.reddit.com/user/Example/search/',runScripts:'outside-only'}),W=dom.window;t.after(()=>W.close());
  W.chrome={runtime:{id:'fixture',sendMessage:async()=>({ok:true,settings:{postDiscovery:true,archiveDiscovery:false}})}};W.eval(read('profile-notice.js'));await flush();assert.ok(W.document.querySelector('img[alt="Deleted user"]'));assert.equal(W.document.documentElement.hasAttribute('data-rt-profile-discovery'),false);
});
test('search mounts only after Reddit replaces an outgoing profile with search DOM',async t=>{
  const s=await boot(t,{html:'<main>'+controls+'<shreddit-feed><shreddit-post id="t3_old"></shreddit-post></shreddit-feed></main>'});assert.equal(s.d.host,null);assert.equal(s.D.getElementById('t3_old').hidden,false);assert.equal(s.calls.length,0);
  s.D.body.innerHTML=page;s.d.scan();await flush();assert.ok(s.d.host);assert.equal(s.D.getElementById('native-results').hidden,true);
});
test('multi-select filters keep their native submenu open at the same size after restarting sources',async t=>{
  const s=await boot(t);s.d.activityDropdown.setAttribute('open','');await flush();s.d.activityMain.getBoundingClientRect=()=>({height:312});s.d.rtMenu.groups.type.el.click();assert.equal(s.d.openSubmenu.dataset.rtSubKey,'type');assert.equal(s.d.openSubmenu.style.getPropertyValue('--rt-menu-height'),'312px');
  s.d.rtMenu.types.get('image').click();await flush();assert.deepEqual([...s.d.rtFilters.types],['image']);assert.equal(s.d.activityDropdown.hasAttribute('open'),true);assert.equal(s.d.openSubmenu.dataset.rtSubKey,'type');assert.equal(s.d.openSubmenu.classList.contains('hidden'),false);assert.equal(s.d.openSubmenu.style.getPropertyValue('--rt-menu-height'),'312px');assert.equal(s.d.rtMenu.groups.type.el.getAttribute('aria-expanded'),'true');
});
test('automatic discovery starts both sources on search and reports invalid unavailable-account queries',async t=>{
  const s=await boot(t,{autoDiscover:true});await flush();assert.equal(s.calls.filter(c=>c.action==='profile').length,1);assert.equal(s.queries.length,1);assert.deepEqual(shown(s.d),['t3_live','t3_archive']);
  const invalid=await boot(t,{autoDiscover:true,url:'https://www.reddit.com/user/Example/search/?q=cat+OR',html:'<shreddit-app><div><img alt="Deleted user"><h3>This account has been deleted</h3></div></shreddit-app>'});assert.match(invalid.d.status.textContent,/word on both sides/);assert.equal(invalid.queries.length,0);
});
test('ordinary client matches have no hidden-profile cue; Hidden shows verified archive-only matches',async t=>{
  const s=await boot(t);await search(s);assert.equal(s.d.nodes.get('live').querySelector('[data-rt-source]'),null);assert.match(s.d.nodes.get('archive').querySelector('[data-rt-source]').title,/loaded search results/);assert.doesNotMatch(s.d.nodes.get('archive').querySelector('[data-rt-source]').title,/profile feed/);
  s.d.activityFilter='hidden';s.d.deduplicate();await flush();assert.deepEqual(shown(s.d),['t3_archive']);
});
test('refresh replaces client ranking for Relevance and rt_sort Hot',async t=>{
  for(const suffix of ['?q=words','?q=words&rt_sort=hot']){
    let reads=0;const s=await boot(t,{url:'https://www.reddit.com/user/Example/search/'+suffix,reddit:async()=>({posts:(++reads===1?['first','second']:['second','first']).map(id=>raw(id)),hasMore:false}),archive:async()=>({items:[],hasMore:false})});await search(s);assert.deepEqual(shown(s.d),['t3_first','t3_second']);await search(s);assert.deepEqual(shown(s.d),['t3_second','t3_first']);
  }
});

const skeletonPage=`<faceplate-tabgroup id="search-results-page-tabgroup"><a href="?type=posts">Posts</a><a href="?type=comments">Comments</a><a href="?type=media">Media</a></faceplate-tabgroup>
<div data-testid="search-results-filter-spacer-desktop"><div id="skeleton-sort">Relevance / All time / Safe Search Off</div></div>
<main class="main"><div id="feedback">Did you find what you were looking for?<button>Yes</button><button>No</button></div><div class="bg-neutral-background" id="skeleton-results"><div id="skeleton">Loading placeholder</div></div></main>`;
test('external search tabs and skeleton-only history mount and load without q, then restore',async t=>{
  const s=await boot(t,{html:skeletonPage,url:'https://www.reddit.com/user/Example/search/',autoDiscover:true});
  assert.equal(s.d.context.view,'search');assert.ok(s.d.searchFeed?.isConnected);
  assert.equal(s.calls.find(c=>c.action==='profile').query,'');assert.equal(s.queries.length,1);
  for(const id of ['skeleton-results','feedback','skeleton-sort'])assert.equal(s.D.getElementById(id).hidden,true,id);
  assert.equal(s.D.getElementById('search-results-page-tabgroup').hidden,false);
  assert.equal(s.d.feed.nextElementSibling.id,'skeleton-results');
  s.W.history.pushState({},'','/r/Synthetic/');s.d.scan();
  for(const id of ['skeleton-results','feedback','skeleton-sort'])assert.equal(s.D.getElementById(id).hidden,false,id);
  assert.equal(s.D.querySelector('[data-rt-search-hidden]'),null);
});
test('late external search tabs trigger mounting and loading through the page observer',async t=>{
  const s=await boot(t,{html:'<main><div class="bg-neutral-background">Loading placeholder</div></main>',observe:true,autoDiscover:true});
  assert.equal(s.d.context,null);assert.equal(s.calls.length,0);
  const tabs=s.D.createElement('faceplate-tabgroup');tabs.id='search-results-page-tabgroup';tabs.innerHTML='<a href="?type=posts">Posts</a>';s.D.body.prepend(tabs);
  await new Promise(resolve=>s.W.setTimeout(resolve,150));await flush();
  assert.equal(s.d.context.view,'search');assert.ok(s.d.searchFeed?.isConnected);
  assert.equal(s.calls.find(c=>c.action==='profile').query,'words');assert.equal(s.queries.length,1);
});

// Structural fallback fixture: approval was unavailable for a live DOM capture.
const structuralFilters=`<div id="filter-row"><span><faceplate-dropdown-menu><button slot="trigger">Relevance ▾</button></faceplate-dropdown-menu></span><span><rpl-dropdown><button aria-haspopup="menu">All time ▾</button></rpl-dropdown></span><span><faceplate-dropdown-menu><button slot="trigger">Safe Search Off ▾</button></faceplate-dropdown-menu></span></div>`;
for(const outside of [false,true])for(const suffix of ['', '?q=laptop','?type=comments'])test(`structural native filter row restores with tabs intact (${outside?'outside':'inside'} main, ${suffix || 'no query'})`,async t=>{
  let html=page.replace(/<div data-testid="search-results-filter-spacer-desktop">[\s\S]*?<main class="main">/,'<main class="main">');
  html=outside?structuralFilters+html:html.replace('<div data-testid="search-scope-switcher">',structuralFilters+'<div data-testid="search-scope-switcher">');
  html=html.replace('</main>','<aside id="feedback-box"><div><p>Did you find what you were looking for?</p></div><div><button>Yes</button><button>No</button></div></aside></main>');
  const s=await boot(t,{html,url:'https://www.reddit.com/user/Example/search/'+suffix});
  const row=s.D.getElementById('filter-row'),banner=s.D.getElementById('feedback-box'),tabs=s.D.getElementById('search-results-page-tabgroup');
  assert.equal(row.hidden,true);assert.equal(banner.hidden,true);
  for(let el=tabs;el;el=el.parentElement)assert.equal(el.hidden,false,'tabs and ancestors stay visible');
  assert.equal(tabs.querySelectorAll('a').length,3);
  assert.equal(s.d.feed.hidden,false);assert.equal(s.d.host.hidden,false);
  s.d.scan();assert.equal(row.hidden,true);
  if(outside)s.d.applySettings({postDiscovery:true,archiveDiscovery:false});else{s.W.history.pushState({},'','/r/Synthetic/');s.d.scan();}
  assert.equal(row.hidden,false);assert.equal(banner.hidden,false);assert.equal(s.D.querySelector('[data-rt-search-hidden]'),null);
});
test('structural filter suppression hides a sort and time row without Safe Search',async t=>{
  const html=page.replace('</main>',structuralFilters.replace(/<span><faceplate-dropdown-menu><button slot="trigger">Safe Search Off ▾<\/button><\/faceplate-dropdown-menu><\/span>/,'')+'</main>');
  const s=await boot(t,{html});s.d.scan();assert.equal(s.D.getElementById('filter-row').hidden,true);
});
test('structural filter suppression fails closed for incomplete rows and extension controls',async t=>{
  const html=page.replace('</main>',structuralFilters.replace('All time','Unrelated')+'<div data-rt-ui="fixture">'+structuralFilters.replace('filter-row','own-row')+'</div></main>');
  const s=await boot(t,{html});assert.equal(s.D.getElementById('filter-row').hidden,false);assert.equal(s.D.getElementById('own-row').hidden,false);
});
