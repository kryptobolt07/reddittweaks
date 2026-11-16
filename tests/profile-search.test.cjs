const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const controls=fs.readFileSync('tests/fixtures/native-profile-controls.html','utf8');
const read=f=>fs.readFileSync('extension/'+f,'utf8');
const flush=async()=>{for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r));};
// Shape of Reddit's served no-results view (live 2026-11-16), synthetic strings.
const nativeEmpty='<div class="flex flex-col items-center" data-testid="search-error-message"><img alt="" src="https://www.redditstatic.com/synthetic-thinking.svg"><div class="text-neutral-content-strong font-bold">Hm...we couldn’t find any results for "rt-empty-synthetic"</div><div class="text-neutral-content-weak">Double-check your spelling or try different keywords</div><div data-testid="search-error-message-ctas"><adjust-search-query-link><button data-testid="search-error-message-primary-cta">Adjust your search</button></adjust-search-query-link></div></div>';
const raw=(id,extra={})=>({id,author:'Example',title:'Synthetic search post',selftext:'Synthetic words',subreddit:'Alpha',created_utc:1700000000,score:4,num_comments:2,is_self:true,...extra});
// Synthetic shape from the recon: controls outside main; tabs/scope remain native;
// post and comment search units are children of the neutral result container.
const page=`<div data-testid="search-results-filter-spacer-desktop"><faceplate-dropdown-menu id="native-sort"><button>Sort</button><a href="/user/Example/search/?sort=new">New</a></faceplate-dropdown-menu><faceplate-dropdown-menu id="native-time" hidden><a href="/user/Example/search/?t=week">Past week</a></faceplate-dropdown-menu></div>
<main class="main"><faceplate-tabgroup id="search-results-page-tabgroup"><a id="search-results-page-tab-posts" href="?type=posts">Posts</a><a id="search-results-page-tab-comments" href="?type=comments">Comments</a><a id="search-results-page-tab-media" href="?type=media">Media</a></faceplate-tabgroup><div data-testid="search-scope-switcher">Show results from all of Reddit</div><div class="bg-neutral-background" id="native-results"><search-telemetry-tracker data-testid="search-sdui-post" data-thingid="t3_live"><div data-testid="search-post-unit">Native result</div></search-telemetry-tracker><div data-testid="search-sdui-comment-unit"><search-telemetry-tracker data-faceplate-tracking-context='{"comment":{"id":"t1_comment","post_id":"t3_parent"}}'></search-telemetry-tracker><div data-testid="search-comment-content">Synthetic comment</div></div><faceplate-partial loading="lazy" src="/search-more"></faceplate-partial></div></main>`;
function setup(t,{viewer='Viewer',leaveDelay=false,url='https://www.reddit.com/user/Example/search/?q=words',settings={postDiscovery:true,archiveDiscovery:true},html=page,reddit,archive,renderer,aggregate,autoDiscover=false,observe=false}={}){
  const dom=new JSDOM(html,{url,runScripts:'outside-only',pretendToBeVisual:true}),W=dom.window,calls=[],queries=[],aggregates=[];
  for(const file of ['search-core.js','post-model.js','feed-filters.js','post-discovery.js','profile-search.js'])W.eval(read(file));
  W.RTArchiveQuery={async *search(args){queries.push(args);const result=archive?await archive(args,queries.length):{items:[raw('live'),raw('archive',{created_utc:1600000000})],hasMore:false,searchedBackTo:1600000000};
    yield {...result,items:(result.items || []).map(p=>W.RTPostModel.normalizeItem(p,{source:'arctic-shift'}))};},async aggregate(args){aggregates.push(args);return aggregate?aggregate(args):{ok:true,buckets:[{key:'Alpha',count:9}]};}};
  const nativeRenderer=renderer || (async(post,node)=>{const native=W.document.createElement(post.kind==='comment'?'shreddit-profile-comment':'shreddit-post');native.setAttribute(post.kind==='comment'?'comment-id':'id',post.fullname);if(post.kind!=='comment')native.setAttribute('post-type',post.postType);native.innerHTML='<span slot="credit-bar"></span><p slot="text-body">Native synthetic body</p>';node.replaceChildren(native);return {fullname:post.fullname,status:'available'};});
  const d=new W.RTPostDiscovery.Discovery({observe,autoDiscover,nativeRenderer,readSettings:async()=>({'rt-settings-v1':settings}),reddit:async args=>{
    // The signed-in account check (for the own-profile List switcher) isn't a search request.
    if(args.action==='own-list-identity')return {username:viewer};calls.push(args);
    if(args.action==='render-controls'){W.document.getElementById(args.target).innerHTML=controls;return {rendered:true};}
    if(args.action==='render-navigation')return {rendered:true};
    if(args.action==='render-search-empty'){W.document.getElementById(args.target).innerHTML=nativeEmpty;return {rendered:true};}
    if(args.action==='status')return {via:'info',statuses:args.ids.map(id=>({fullname:(args.kind==='comment'?'t1_':'t3_')+id,status:'available'}))};
    return reddit?reddit(args):{posts:[raw('live')],hasMore:false};},archive:async()=>{throw Error('Search must use RTArchiveQuery, not archive-profile');}});
  // These tests check restoring right after leaving; the delayed restore has its own test.
  if(!leaveDelay)d.leaveRestoreMs=0;
  t.after(()=>{d.destroy();W.close();});return {W,D:W.document,d,calls,queries,aggregates};
}
async function boot(t,options){const s=setup(t,options);await s.d.ready;await flush();return s;}
async function search(s){await s.d.refreshActivity();await flush();}
const shown=d=>[...d.feed.children].filter(n=>n.dataset.rtUi==='activity-item' && !n.hidden).map(n=>n.dataset.fullname);

function headerSearch(s,hydrated=false){
  const host=s.D.createElement('reddit-search-large');host.setAttribute('scope',JSON.stringify({type:'profile',path:'/user/Example/',name:'Example'}));s.D.body.prepend(host);
  const root=host.attachShadow({mode:'open'});root.innerHTML='<form class="reddit-search-bar"><span id="search-input-chip">u/Example</span><input name="q"></form>';
  if(hydrated){root.innerHTML='<form><faceplate-search-input name="q"><rpl-input-chip id="search-input-remove-filter">u/Example</rpl-input-chip></faceplate-search-input></form>';const field=root.querySelector('faceplate-search-input'),inner=field.attachShadow({mode:'open'});inner.innerHTML='<textarea name="q"></textarea>';return {host,root,input:inner.querySelector('textarea'),form:root.querySelector('form')};}
  return {host,root,input:root.querySelector('input'),form:root.querySelector('form')};
}
function enter(W,input,options={}){const event=new W.KeyboardEvent('keydown',{key:'Enter',bubbles:true,composed:true,cancelable:true,...options});input.dispatchEvent(event);return event;}
for(const hydrated of [false,true])test(`empty native scoped header Enter opens author history (${hydrated?'hydrated textarea':'SSR input'})`,async t=>{
  const s=await boot(t,{url:'https://www.reddit.com/user/Example/',html:'<main></main>',autoDiscover:true});const {input}=headerSearch(s,hydrated);let navigations=0;
  s.D.addEventListener('click',event=>{const anchor=event.target.closest('a');if(!anchor)return;event.preventDefault();navigations++;s.W.history.pushState({},'',anchor.href);s.D.body.innerHTML=page;s.d.scan();},true);
  const event=enter(s.W,input);await flush();
  assert.equal(event.defaultPrevented,true);assert.equal(navigations,1);assert.equal(s.W.location.pathname,'/user/Example/search/');assert.equal(s.d.context.view,'search');assert.equal(s.calls.find(c=>c.action==='profile').query,'');assert.equal(s.queries[0].author,'Example');
});
for(const hydrated of [false,true])test(`header handler preserves other input, scopes, settings and keys (${hydrated?'hydrated':'SSR'})`,async t=>{
  const s=await boot(t,{url:'https://www.reddit.com/user/Example/',html:'<main></main>'});const {host,root,input,form}=headerSearch(s,hydrated);let clicks=0;s.D.addEventListener('click',()=>clicks++);
  const unchanged=(node=input,opts={})=>assert.equal(enter(s.W,node,opts).defaultPrevented,false);
  for(const value of ['words',' ']){input.value=value;unchanged();}input.value='';
  for(const opts of [{key:'Escape'},{shiftKey:true},{ctrlKey:true},{altKey:true},{metaKey:true},{isComposing:true},{keyCode:229},{repeat:true}])unchanged(input,opts);
  const other=s.D.createElement('input');other.name='q';s.D.body.append(other);unchanged(other);
  input.name='other';unchanged();input.name='q';
  const chip=root.querySelector('#search-input-chip,#search-input-remove-filter'),chipParent=chip.parentNode;chip.remove();unchanged();chipParent.prepend(chip);
  for(const scope of [{type:'subreddit',name:'Example',path:'/user/Example/'},{type:'profile',name:'Other',path:'/user/Example/'},{type:'profile',name:'Example',path:'/user/Other/'},null]){host.setAttribute('scope',JSON.stringify(scope));unchanged();}
  host.setAttribute('scope',JSON.stringify({type:'profile',name:'Example',path:'/user/Example/'}));
  for(const settings of [{postDiscovery:false,archiveDiscovery:true}]){s.d.applySettings(settings);unchanged();}
  s.d.applySettings({postDiscovery:true,archiveDiscovery:true});s.W.history.pushState({},'','/r/Example/');unchanged();assert.equal(clicks,0);
});
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
  assert.deepEqual(shown(s.d),['t3_live','t3_archive']);assert.equal(s.d.feed.querySelectorAll('[data-fullname="t3_live"]').length,1);assert.match(s.d.nodes.get('live').querySelector('[data-testid="search-post-unit"] a[data-testid="post-title-text"]').getAttribute('href'),/\/comments\/live\//);
  assert.equal(s.D.querySelector('[data-rt-profile-search]'),null);assert.doesNotMatch(s.D.body.textContent,/Not in these results/);
});
test('without q, search browses and filters author history from both sources',async t=>{
  const s=await boot(t,{url:'https://www.reddit.com/user/Example/search/'});await search(s);
  assert.equal(s.calls.find(c=>c.action==='profile').query,'');assert.equal(s.calls.find(c=>c.action==='profile').sort,'new');assert.equal(s.queries.length,1);assert.equal(s.queries[0].parsed.terms.length,0);assert.equal(shown(s.d).length,2);
  assert.ok(s.d.rtMenu.groups.date);assert.ok(s.d.rtMenu.groups.type);assert.ok(s.d.rtMenu.groups.sub);assert.equal(s.d.rtMenu.searchSort.has('relevance'),false);
});
test('OR and exclusions keep Reddit search; Old sort remains archive-only',async t=>{
  for(const suffix of ['?q=cat+OR+dog','?q=cat+-dog','?q=cat+-"exact+phrase"','?q=cat&rt_sort=old','?q=cat&sort=old']){
    const s=await boot(t,{url:'https://www.reddit.com/user/Example/search/'+suffix,archive:async()=>({items:[raw('live',{title:'cat'}),raw('archive',{title:'cat',created_utc:1600000000})],hasMore:false,searchedBackTo:1600000000})});await search(s);
    const old=suffix.includes('old');assert.equal(s.calls.filter(c=>c.action==='profile').length,old?0:1,suffix);assert.equal(s.queries.length,1);assert.equal(s.d.clientSearchOn(),!old);
    if(!old)assert.equal(s.calls.find(c=>c.action==='profile').query,suffix.includes('OR')?'(cat OR dog)':'cat');
    if(suffix.includes('old')){assert.equal(s.queries[0].sort,'asc');assert.deepEqual(shown(s.d),['t3_archive','t3_live']);assert.doesNotMatch(s.d.notice.textContent,/Searched up to/);}
  }
});
test('results are Reddit\'s search rows: community, time, title, counts and thumbnail; comments get Go To Thread',async t=>{
  let renders=0;const thumb='https://preview.redd.it/synthetic.png?width=140';
  const s=await boot(t,{reddit:async()=>({posts:[raw('live',{score:1,num_comments:2,thumbnail:thumb,subredditIcon:'https://styles.redditmedia.com/t5_x/styles/communityIcon_a.png'})],hasMore:false}),archive:async()=>({items:[],hasMore:false}),renderer:async()=>{renders++;}});await search(s);
  const row=s.d.nodes.get('live').querySelector('[data-testid="search-post-unit"]');assert.ok(row);assert.equal(renders,0,'Reddit\'s own results need no full card');
  assert.match(row.querySelector('.post-credit-row').textContent,/r\/Alpha/);assert.ok(row.querySelector('.post-credit-row faceplate-timeago[ts]'));assert.equal(row.querySelector('.post-credit-row img').getAttribute('src'),'https://styles.redditmedia.com/t5_x/styles/communityIcon_a.png');
  assert.equal(row.querySelector('[data-testid="post-title-text"]').textContent,'Synthetic search post');assert.equal(row.querySelector('[data-testid="search-counter-row"]').textContent.replace(/\s+/g,' ').trim(),'1 vote·2 comments');
  assert.equal(row.querySelector('[data-testid="search_post_thumbnail"]').getAttribute('src'),thumb);assert.ok(row.nextElementSibling.matches('hr.list-divider-line'));
  const comment={kind:'comment',id:'c9',author:'Example',body:'First line\n\nSecond line',link_id:'parent',parent_id:'t3_parent',link_title:'Parent title',subreddit:'Alpha',created_utc:1700000000,score:3,postScore:867,postComments:100,permalink:'/r/Alpha/comments/parent/parent_title/c9/'};
  const c=s.d.searchUnit(s.W.RTPostModel.normalizeComment(comment));
  assert.equal(c.querySelector('h2').textContent,'Parent title');assert.equal(c.querySelectorAll('[data-testid="search-comment-content"] p').length,3,'two body paragraphs and the votes line');
  const thread=[...c.querySelectorAll('a')].find(a=>a.textContent==='Go To Thread');assert.equal(new URL(thread.href).pathname,'/r/Alpha/comments/parent/parent_title/');
  assert.equal(c.querySelector('[data-testid="search-counter-row"]').textContent.replace(/\s+/g,' ').trim(),'867 votes·100 comments');
  // The comment text lets clicks through to the comment link beneath it, and the fade appears only when the text is cut off.
  const box=c.querySelector('[data-testid="search-comment-content"]'),body=box.querySelector('.max-h-\\[260px\\]'),fade=box.querySelector('[data-rt-comment-fade]'),commentLink=box.querySelector('a[aria-label^="Comment by"]');
  assert.equal(body.style.pointerEvents,'none');assert.ok(commentLink);assert.equal(fade.hidden,true,'no blur over a comment that fits');
  Object.defineProperty(body,'scrollHeight',{configurable:true,value:400});Object.defineProperty(body,'clientHeight',{configurable:true,value:260});s.W.RTPostDiscovery.clipFade(body,fade);assert.equal(fade.hidden,false,'shown only when the comment is cut off');assert.equal(s.d.searchUnit(s.W.RTPostModel.normalizePost(raw('big',{score:12345,num_comments:1}))).querySelector('[data-testid="search-counter-row"]').textContent,'12.3K votes·1 comment');
});
test('Back to a search puts its loaded results back instead of searching again',async t=>{
  const s=await boot(t,{url:'https://www.reddit.com/user/Example/search/?q=words&rt_sub=Alpha'});await search(s);
  const before=shown(s.d),node=s.d.nodes.get('live'),calls=s.calls.filter(c=>c.action==='profile').length,queries=s.queries.length;assert.ok(before.length>0);
  // Open a result: Reddit swaps in the post page.
  s.W.history.pushState({},'','/r/Alpha/comments/live/synthetic/');s.D.body.innerHTML='<main><shreddit-post id="t3_live"></shreddit-post></main>';s.d.scan();await flush();
  // Back: Reddit rebuilds its search page from scratch.
  s.W.history.pushState({},'','/user/Example/search/?q=words&rt_sub=Alpha');s.D.body.innerHTML=page;s.d.scan();await flush();
  assert.deepEqual(shown(s.d),before);assert.equal(s.d.nodes.get('live'),node,'the same loaded rows come back');assert.ok(node.isConnected);
  assert.equal(s.calls.filter(c=>c.action==='profile').length,calls,'Reddit is not searched again');assert.equal(s.queries.length,queries,'the archive is not searched again');
  assert.equal(s.D.querySelector('[data-testid="search-sdui-post"]').closest('[data-rt-search-hidden]')?.hidden,true,'the rebuilt page\'s own results are hidden again');
  // A different search is not served from the park.
  s.W.history.pushState({},'','/user/Example/search/?q=other');s.D.body.innerHTML=page;s.d.scan();await search(s);assert.equal(s.calls.filter(c=>c.action==='profile').length,calls+1);
});
test('opening a result keeps Reddit\'s own results hidden while its next page loads',async t=>{
  const s=await boot(t,{leaveDelay:true});await search(s);const native=s.D.querySelector('[data-testid="search-sdui-post"]');assert.equal(native.closest('[data-rt-search-hidden]')?.hidden,true);
  s.d.leaveRestoreMs=30;s.W.history.pushState({},'','/r/Alpha/comments/live/synthetic/');s.d.scan();await flush();
  assert.equal(native.closest('[data-rt-search-hidden]')?.hidden,true,'no flash of Reddit\'s unfiltered list');
  await new Promise(r=>setTimeout(r,60));assert.equal(native.closest('[data-rt-search-hidden]'),null,'restored if Reddit kept the old page');
});
test('your own profile search offers a List switcher (Saved, History, …) and others\' profiles don\'t',async t=>{
  const own=await boot(t,{viewer:'Example'});await search(own);for(let i=0;i<3;i++)await flush();own.d.scan();await flush();
  const urls=[];own.D.addEventListener('click',event=>{const a=event.target.closest?.('a');if(a && a.hidden){event.preventDefault();urls.push(new URL(a.href));}},true);
  const option=own.D.querySelector('[data-rt-list-switch="saved"]');assert.ok(own.D.querySelector('[data-rt-ui="own-list-switch"]'),'List entry on your own profile');assert.ok(option);
  assert.equal(own.D.querySelector('[data-rt-list-switch="all"]').getAttribute('aria-current'),'true');
  option.click();assert.equal(urls.at(-1).searchParams.get('rt_list'),'saved');assert.equal(urls.at(-1).searchParams.get('q'),'words');assert.equal(urls.at(-1).pathname,'/user/Example/search/');
  const other=await boot(t,{viewer:'Someone'});await search(other);for(let i=0;i<3;i++)await flush();other.d.scan();await flush();assert.equal(other.D.querySelector('[data-rt-ui="own-list-switch"]'),null);
});
test('deleted and banned accounts use archive profile shell with native search tabs',async t=>{
  for(const html of ['<shreddit-app><div><img alt="Deleted user"><h3>This account has been deleted</h3></div></shreddit-app>', '<shreddit-app><div id="shreddit-forbidden"><svg icon-name="ban-fill"></svg><h3 id="shreddit-forbidden-title">This account has been suspended</h3></div></shreddit-app>']){
    const s=await boot(t,{html});await search(s);assert.equal(s.d.archiveOnly,true);assert.equal(s.calls.filter(c=>c.action==='profile').length,0);assert.equal(s.queries.length,1);
    assert.ok(s.D.querySelector('[data-rt-ui="archive-profile"]'));const tab=s.D.getElementById('search-results-page-tab-comments');assert.ok(tab);assert.match(tab.href,/\/user\/Example\/search\/\?q=words&type=comments/);assert.ok(s.d.feed.querySelector('[data-rt-search-unit="post"]'));
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
test('filter changes never rewrite the unchanged address, which Reddit treats as a reload',async t=>{
  for(const url of ['https://www.reddit.com/user/Example/search/?q=words','https://www.reddit.com/user/Example/search/?q=words&t=week']){
    const s=await boot(t,{url}),writes=[],original=s.W.history.replaceState;
    s.W.history.replaceState=function(state,title,next){const before=s.W.location.pathname+s.W.location.search+s.W.location.hash;original.call(this,state,title,next);writes.push([before,s.W.location.pathname+s.W.location.search+s.W.location.hash]);};
    s.d.setFilters({...s.d.rtFilters,subreddits:['Alpha']});await flush();s.d.setFilters({...s.d.rtFilters,subreddits:['Alpha','Beta']});await flush();
    assert.ok(writes.length>=2,url);for(const [before,after] of writes)assert.notEqual(after,before,url);
    assert.equal(new URLSearchParams(s.W.location.search).get('rt_sub'),'Alpha,Beta');
  }
});
test('native result list and sort/time controls hide reversibly; native tabs and scope stay usable',async t=>{
  const s=await boot(t);const results=s.D.getElementById('native-results'),sort=s.D.getElementById('native-sort'),time=s.D.getElementById('native-time');
  assert.equal(results.hidden,true);assert.equal(sort.hidden,true);assert.equal(time.hidden,true);assert.equal(s.D.getElementById('search-results-page-tabgroup').hidden,false);assert.equal(s.D.querySelector('[data-testid="search-scope-switcher"]').hidden,false);
  const replacement=s.D.createElement('div');replacement.className='bg-neutral-background';replacement.textContent='SPA continuation';results.after(replacement);s.d.scan();assert.equal(replacement.hidden,true);
  s.W.history.pushState({},'','/r/Synthetic/');s.d.scan();assert.equal(results.hidden,false);assert.equal(sort.hidden,false);assert.equal(time.hidden,true);assert.equal(replacement.hidden,false);assert.equal(s.D.querySelector('[data-rt-ui="search-feed"]'),null);assert.equal(s.D.querySelector('[data-rt-search-hidden]'),null);
});
test('archive off keeps native profile search available and disabling discovery restores originals',async t=>{
  const off=await boot(t,{settings:{postDiscovery:true,archiveDiscovery:false}});assert.ok(off.d.host);assert.equal(off.D.getElementById('native-results').hidden,true);await search(off);assert.ok(off.calls.some(c=>c.action==='profile'));assert.equal(off.queries.length,0);
  const s=await boot(t);s.d.applySettings({postDiscovery:false,archiveDiscovery:false,restoreDeletedContent:true});assert.equal(s.d.host,null);assert.equal(s.D.getElementById('native-results').hidden,false);assert.equal(s.D.getElementById('native-sort').hidden,false);
});
test('search shows no searched-back date or Search older; it never claims full coverage',async t=>{
  const s=await boot(t);await search(s);assert.doesNotMatch(s.d.notice.textContent,/Searched back to|Searched up to/);assert.doesNotMatch(s.d.status.textContent+s.d.notice.textContent,/all results|history complete|search complete/i);
  assert.equal([...s.D.querySelectorAll('button')].some(b=>/Search older/.test(b.textContent) && !b.hidden && !b.closest('[hidden]')),false);
});
test('an empty profile search ends with Reddit’s own no-results view while failures remain retryable',async t=>{
  const s=await boot(t,{reddit:async()=>({posts:[],hasMore:false}),archive:async()=>({items:[],hasMore:false})});await search(s);
  const empty=s.d.searchEmpty;assert.ok(empty && !empty.hidden,'Reddit no-results view shown');assert.ok(empty.querySelector('[data-testid="search-error-message"] adjust-search-query-link button'));
  assert.equal(empty.querySelector('[data-testid="search-error-message"] > div').textContent,'Hm...we couldn’t find any results for "words"');assert.doesNotMatch(empty.textContent,/coverage may be incomplete|rt-empty/);
  assert.ok(!s.d.activityEmpty || s.d.activityEmpty.hidden,'no extension replica');assert.equal(s.calls.filter(c=>c.action==='render-search-empty').length,1);
  const fail=await boot(t,{archive:async()=>{throw Error('Archive temporarily unavailable');}});await search(fail);assert.equal(fail.d.status.dataset.error,'true');assert.match(fail.d.status.textContent,/unavailable/);assert.equal(fail.d.nodes.get('live').hidden,false);assert.equal(fail.d.searchEmpty?.hidden ?? true,true);
});
test('search keeps paging both cursors past ten pages until both sources end, with no Search older pause',async t=>{
  const s=await boot(t,{reddit:async args=>{const n=Number(String(args.after || 'cursor-0').split('-')[1]);return n>=24?{posts:[],hasMore:false}:{posts:[],after:'cursor-'+(n+1),hasMore:true};},archive:async(args,n)=>n>=18?{items:[],hasMore:false}:({items:[],cursor:1700000000-n,hasMore:true,searchedBackTo:1700000000-n})});await search(s);
  for(let i=0;i<30;i++)await s.d.loadMore();await flush();
  assert.equal(s.queries.length,18);assert.equal(s.calls.filter(c=>c.action==='profile').length,25);assert.equal(s.queries[1].cursor,1699999999);assert.equal(s.calls.filter(c=>c.action==='profile')[1].after,'cursor-1');assert.equal(s.d.hasMoreProfile(),false);
  assert.doesNotMatch(s.d.loading.textContent,/Search older|coverage may be incomplete/);assert.equal([...s.D.querySelectorAll('button')].some(b=>/Search older/.test(b.textContent) && !b.hidden && !b.closest('[hidden]')),false);
  assert.ok(s.d.searchEmpty && !s.d.searchEmpty.hidden,'the end of an empty search shows Reddit’s no-results view');
});
test('Relevance keeps client ranking ahead of archive-only matches; loaded-item comment sort works',async t=>{
  const s=await boot(t,{reddit:async()=>({posts:[raw('rank1',{created_utc:1500000000}),raw('rank2',{created_utc:1600000000})],hasMore:false}),archive:async()=>({items:[raw('newer',{created_utc:1800000000}),raw('older',{created_utc:1400000000})],hasMore:false})});await search(s);assert.deepEqual(shown(s.d),['t3_rank1','t3_rank2','t3_newer','t3_older']);
  const c=await boot(t,{url:'https://www.reddit.com/user/Example/search/?q=words&sort=comments',reddit:async()=>({posts:[raw('few',{num_comments:1}),raw('many',{num_comments:50})],hasMore:false}),archive:async()=>({items:[raw('mid',{num_comments:10})],hasMore:false})});await search(c);assert.deepEqual(shown(c.d),['t3_many','t3_mid','t3_few']);
});
test('Feed options reuses native groups, submenu size, pills and author aggregate',async t=>{
  const s=await boot(t);assert.ok(s.d.activityDropdown.querySelector('button[aria-label="Feed options"]'));assert.ok(s.d.activityMenu);assert.ok(s.d.rtMenu.groups.date);assert.ok(s.d.rtMenu.groups.type);assert.ok(s.d.rtMenu.groups.sub);assert.equal(s.d.rtChips.parentNode,s.d.controlsTarget);
  s.d.activityMain.getBoundingClientRect=()=>({height:312});s.d.rtMenu.groups.sub.el.click();assert.equal(s.d.rtMenu.groups.sub.sub.style.getPropertyValue('--rt-menu-height'),'312px');await flush();assert.equal(s.aggregates[0].author,'Example');assert.match(s.d.rtMenu.sub.note.dataset.rtSource,/Counts from the archive/);
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
  assert.deepEqual(shown(s.d),['t1_c1','t1_c2']);assert.equal(s.d.feed.querySelectorAll('[data-fullname="t1_c1"]').length,1);const row=s.d.feed.querySelector('[data-fullname="t1_c1"]');assert.ok(row.querySelector('[data-testid="search-sdui-comment-unit"]'));assert.match(row.querySelector('[data-testid="search-comment-content"]').textContent,/Synthetic client words/);assert.equal(s.calls.filter(c=>c.action==='profile').length,1);assert.equal(s.queries[0].postTypes,undefined);
});
test('archive status cues follow current Reddit evidence and Deleted never includes an unverified item',async t=>{
  const s=await boot(t,{reddit:async()=>({posts:[],hasMore:false}),archive:async()=>({items:[raw('gone'),raw('live')],hasMore:false}),renderer:async(post,node)=>{node.innerHTML='<shreddit-post id="'+post.fullname+'" post-type="text"><span slot="credit-bar"></span><div slot="text-body">'+(post.id==='gone'?'[removed]':'Current synthetic text')+'</div></shreddit-post>';}});await search(s);
  assert.match(s.d.nodes.get('gone').querySelector('[data-rt-row-source]').title,/Removed on Reddit/);assert.match(s.d.nodes.get('gone').querySelector('[data-testid="search-post-unit"]').textContent,/Synthetic search post/);
  s.d.activityFilter='deleted';s.d.deduplicate();await flush();assert.deepEqual(shown(s.d),['t3_gone']);assert.doesNotMatch(s.d.nodes.get('live').querySelector('[data-rt-row-source]').title,/Deleted on Reddit|Removed on Reddit/);
});
test('archive fallback retains a native card and unknown status instead of inventing deletion',async t=>{
  const s=await boot(t,{url:'https://www.reddit.com/user/Example/search/?q=words+-excluded',archive:async()=>({items:[raw('fallback')],hasMore:false}),renderer:async()=>{throw Error('Reddit could not render this card (HTTP 404).');}});await search(s);
  const card=s.d.nodes.get('fallback');assert.ok(card.querySelector('[data-testid="search-post-unit"]'),'the row stays when Reddit has no card');assert.doesNotMatch(card.querySelector('[data-rt-row-source]').title,/Deleted on Reddit|Removed on Reddit/);
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
  const s=await boot(t);await search(s);assert.equal(s.d.nodes.get('live').querySelector('[data-rt-row-source]'),null);assert.match(s.d.nodes.get('archive').querySelector('[data-rt-row-source]').title,/loaded search results/);assert.doesNotMatch(s.d.nodes.get('archive').querySelector('[data-rt-row-source]').title,/profile feed/);
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
  if(outside)s.d.applySettings({postDiscovery:false,archiveDiscovery:false});else{s.W.history.pushState({},'','/r/Synthetic/');s.d.scan();}
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

test('search Feed options shares the full profile icon matrix and restores native rows',async t=>{
  const s=await boot(t),{W,d}=s;
  const assertIcon=(row,name)=>{
    assert.ok(row,name+' row exists');const icon=row.querySelector('.rt-menu-lead');assert.ok(icon,name+' has a leading icon');
    assert.equal(icon.getAttribute('icon-name'),name);assert.equal(icon.getAttribute('width'),'16');assert.equal(icon.getAttribute('height'),'16');assert.equal(icon.getAttribute('viewBox'),'0 0 20 20');
    const shared=W.RTFeedFilters.svgIcon(name,16);if(shared)assert.deepEqual([...icon.querySelectorAll('path')].map(p=>p.getAttribute('d')),[...shared.querySelectorAll('path')].map(p=>p.getAttribute('d')));
  };
  assertIcon(d.menuGroups[0].row,'sort');assertIcon(d.menuGroups[1].row,'card');
  for(const [key,name] of Object.entries({relevance:'search',new:'new',old:'archive',top:'top',comments:'comment',hot:'hot'}))assertIcon(d.rtMenu.searchSort.get(key),name);
  for(const row of d.menuGroups[1].items)assertIcon(row,'classic');
  for(const [key,name] of Object.entries({all:'show',hidden:'hidden',deleted:'deleted'}))assertIcon(d.activityMenu.querySelector('[data-rt-activity-filter="'+key+'"]'),name);
  assertIcon(d.activityMenu.querySelector('[data-rt-ui="activity-refresh"]'),'refresh');
  for(const [key,row] of d.rtMenu.date)assertIcon(row,key==='any'?'show':'calendar');
  assert.ok(d.rtMenu.date.has('hour'),'incoming search-only Past hour also has the date icon');
  assertIcon(d.rtMenu.all,'show');
  for(const [key,name] of Object.entries({text:'text-post',textmedia:'collection',poll:'list-bulleted',image:'image',gif:'gif-post-outline',video:'video',gallery:'gallery',link:'link',embed:'browser',crosspost:'rotate'}))assertIcon(d.rtMenu.types.get(key),name);
  const panel=d.rtMenu.sub.panel;panel.render({entries:[{key:'Alpha',count:1}],picked:['Alpha'],source:'loaded'});
  assertIcon(panel.list.querySelector('[data-rt-sub-all]'),'show');assert.equal(panel.list.querySelector('[data-rt-sub-all]').getAttribute('aria-checked'),'false');
  assert.equal(panel.list.querySelector('[data-rt-sub-row] svg').getAttribute('icon-name'),'community');
  d.setFilters({...d.rtFilters,subreddits:['Alpha']});await flush();
  d.rtMenu.sub.list.querySelector('[data-rt-sub-all]').click();await flush();assert.deepEqual([...d.rtFilters.subreddits],[]);assert.equal(d.rtMenu.sub.list.querySelector('[data-rt-sub-all]').getAttribute('aria-checked'),'true');
  const native=d.menuGroups.flatMap(group=>group.items);assert.ok(d.menuGroups[0].items.every(row=>row.hidden));d.clearActivityMenu();
  assert.ok(native.every(row=>row.parentElement.matches('.main-menu-container') && !row.hidden));assert.ok(native.every(row=>!row.querySelector('.rt-menu-lead')));
});

test('structured and negative predicates filter Reddit and archive cards locally with honest status',async t=>{
  const records=[raw('keep',{title:'launch',spoiler:false}),raw('skip',{title:'launch',spoiler:true}),raw('other',{title:'different',spoiler:false})];
  const s=await boot(t,{url:'https://www.reddit.com/user/Example/search/?q='+encodeURIComponent('launch AND NOT spoiler:yes'),reddit:async()=>({posts:records,hasMore:false}),archive:async()=>({items:[...records,raw('archive',{title:'launch',spoiler:false})],hasMore:false,searchedBackTo:1600000000})});await search(s);
  assert.equal(s.calls.find(c=>c.action==='profile').query,'launch');assert.equal(s.d.searchReddit.residual,true);
  assert.deepEqual(shown(s.d),['t3_keep','t3_archive']);assert.match(s.d.status.textContent,/filtered locally/);assert.match(s.d.status.textContent,/may be incomplete/);
  assert.doesNotMatch(s.d.notice.textContent,/Searched back to|filtered locally/);assert.equal(s.d.notice.hidden,true,'no banner above Reddit’s first result; the note stays in the status');assert.doesNotMatch(s.d.status.textContent+s.d.notice.textContent,/search complete|history complete/i);
  s.d.activityFilter='hidden';s.d.deduplicate();await flush();assert.deepEqual(shown(s.d),['t3_archive']);
});

test('Reddit projections preserve grouped AND/OR, phrases and plain query behavior',async t=>{
  assert.deepEqual([...((await boot(t)).W.RTPostDiscovery.PROFILE_REDDIT_SEARCH_CAPABILITIES)],['term','phrase','and','or']);
  for(const [query,expected,residual] of [['words','words',false],['words AND ("quiet place" OR coffee)','(words AND ("quiet place" OR coffee))',false],['words AND (title:launch OR type:image)','words',true],['title:launch OR type:image','',true],['words NOT coffee','words',true]]){
    const s=await boot(t,{url:'https://www.reddit.com/user/Example/search/?q='+encodeURIComponent(query)});await search(s);
    assert.equal(s.calls.find(c=>c.action==='profile').query,expected,query);assert.equal(s.d.searchReddit.residual,residual,query);
  }
});

test('post fields and aliases opt in, and comment-only errors appear in the existing notice without requests',async t=>{
  const valid=['title:words','body:words','selftext:words','text:words','r/Alpha','subreddit:Alpha','site:example.test','domain:example.test','url:example.test','flair:news','self:yes','nsfw:no','spoiler:no','type:text','before:2026-01-01','after:2020-01-01','author:Example','u/example'];
  for(const query of valid){const s=await boot(t,{url:'https://www.reddit.com/user/Example/search/?q='+encodeURIComponent(query)});assert.equal(s.d.searchParsed.invalid,false,query);}
  for(const query of ['title:words','type:text','site:example.test','url:example.test','flair:news','self:yes','nsfw:no','spoiler:no','from:Example','has:image']){
    const s=await boot(t,{url:'https://www.reddit.com/user/Example/search/?type=comments&q='+encodeURIComponent(query)});await search(s);
    assert.equal(s.calls.filter(c=>c.action==='profile').length,0,query);assert.equal(s.queries.length,0);assert.match(s.d.notice.textContent,/isn't available for comments/);assert.equal(s.d.notice.hidden,false);
  }
  const comments=await boot(t,{url:'https://www.reddit.com/user/Example/search/?type=comments&q='+encodeURIComponent('body:words r/Alpha before:2026-01-01 after:2020-01-01')});assert.equal(comments.d.searchParsed.invalid,false);
});

test('author is fixed to the profile even inside Boolean groups and negation',async t=>{
  for(const query of ['author:Other','u/Other','words OR author:Other','NOT u/Other']){
    const s=await boot(t,{url:'https://www.reddit.com/user/Example/search/?q='+encodeURIComponent(query)});await search(s);
    assert.equal(s.queries.length,0);assert.equal(s.calls.filter(c=>c.action==='profile').length,0);assert.match(s.d.notice.textContent,/Author is fixed to u\/Example/);
  }
  const s=await boot(t,{url:'https://www.reddit.com/user/Example/search/?q='+encodeURIComponent('author:example words')});await search(s);assert.deepEqual(shown(s.d),['t3_live','t3_archive']);assert.equal(s.calls.find(c=>c.action==='profile').query,'words');
});

test('subreddit disjunction is not flattened into a contradictory menu filter or archive scope',async t=>{
  const items=[raw('alpha'),raw('beta',{subreddit:'Beta'}),raw('gamma',{subreddit:'Gamma'})];
  const s=await boot(t,{url:'https://www.reddit.com/user/Example/search/?q='+encodeURIComponent('r/Alpha OR r/Beta'),reddit:async()=>({posts:items,hasMore:false}),archive:async()=>({items,hasMore:false})});await search(s);
  assert.equal(s.queries[0].subreddit,undefined);assert.equal(s.calls.find(c=>c.action==='profile').query,'');assert.deepEqual(shown(s.d),['t3_alpha','t3_beta']);
});

test('query type waits for native proof, then all structured metadata uses the shared record',async t=>{
  const s=await boot(t,{url:'https://www.reddit.com/user/Example/search/?q='+encodeURIComponent('type:image self:no site:example.test flair:news nsfw:no'),reddit:async()=>({posts:[raw('image',{is_self:false,url:'https://example.test/image',link_flair_text:'news'}),raw('text',{is_self:false,url:'https://example.test/text',link_flair_text:'news'})],hasMore:false}),archive:async()=>({items:[],hasMore:false}),renderer:async(post,node)=>{node.innerHTML='<shreddit-post id="'+post.fullname+'" post-type="'+(post.id==='image'?'image':'text')+'"><span slot="credit-bar"></span></shreddit-post>';}});await search(s);assert.deepEqual(shown(s.d),['t3_image']);
  const card=s.D.createElement('shreddit-post');card.setAttribute('post-title','Native title');card.setAttribute('post-type','image');card.setAttribute('content-href','https://www.example.test/a');card.setAttribute('is-self','false');card.innerHTML='<p slot="text-body">Native body</p><span slot="post-flair">news</span>';
  const record=s.W.RTPostModel.searchRecord(card);assert.equal(record.title,'Native title');assert.equal(record.body,'Native body');assert.equal(record.domain,'www.example.test');assert.equal(record.type,'image');assert.equal(record.isSelf,false);
});

test('comment predicates search comment bodies and never borrowed parent titles',async t=>{
  const comment=(id,body)=>({kind:'comment',id,author:'Example',body,link_id:'parent',subreddit:'Alpha',link_title:'secret parent words',created_utc:1700000000});
  const s=await boot(t,{url:'https://www.reddit.com/user/Example/search/?type=comments&q='+encodeURIComponent('words NOT body:spam'),reddit:async()=>({posts:[comment('match','words here'),comment('spam','words spam'),comment('parent','unrelated')],hasMore:false}),archive:async()=>({items:[],hasMore:false})});await search(s);assert.deepEqual(shown(s.d),['t1_match']);assert.equal(s.calls.find(c=>c.action==='profile').query,'words');
});

test('sparse Reddit listing metadata uses hydrated body, destination, flair and self type',async t=>{
  const s=await boot(t,{url:'https://www.reddit.com/user/Example/search/?q='+encodeURIComponent('body:quiet site:example.test flair:news self:yes'),reddit:async()=>({posts:[raw('sparse',{selftext:'',is_self:undefined})],hasMore:false}),archive:async()=>({items:[],hasMore:false}),renderer:async(post,node)=>{node.innerHTML='<shreddit-post id="'+post.fullname+'" post-type="text" content-href="https://example.test/a"><span slot="credit-bar"></span><p slot="text-body">quiet place</p><span slot="post-flair">news</span></shreddit-post>';}});await search(s);assert.deepEqual(shown(s.d),['t3_sparse']);
});
test('residual wording survives archive failures in the status and parse errors remain in the notice',async t=>{
  const s=await boot(t,{url:'https://www.reddit.com/user/Example/search/?q='+encodeURIComponent('words NOT spoiler:yes'),archive:async()=>{throw Error('Archive unavailable');}});await search(s);assert.match(s.d.status.textContent,/unavailable.*filtered locally/,'the status carries the note once');assert.doesNotMatch(s.d.notice.textContent,/filtered locally/,'no banner above the results');
  const invalid=await boot(t,{url:'https://www.reddit.com/user/Example/search/?q=words+OR'});await search(invalid);assert.match(invalid.d.notice.textContent,/word on both sides/);assert.equal(invalid.d.notice.hidden,false);
});
test('picking a subreddit keeps the other subreddits available to add when counts come from loaded items',async t=>{
  const s=await boot(t);await search(s);const f=s.W.RTFeedFilters;s.d.rtAgg={key:'unavailable',state:'failed',buckets:[]};
  s.d.rtFilters=f.empty();s.d.loadedItems=()=>[{fullname:'t3_a1',subreddit:'Alpha'},{fullname:'t3_a2',subreddit:'Alpha'},{fullname:'t3_b1',subreddit:'Beta'}];
  assert.deepEqual(Array.from(s.d.subredditCounts().entries,e=>e.key),['Alpha','Beta']);
  // With Alpha picked, only Alpha's results load; Beta must still be offered.
  s.d.rtFilters={...f.empty(),subreddits:['Alpha']};s.d.loadedItems=()=>[{fullname:'t3_a1',subreddit:'Alpha'}];
  const entries=Array.from(s.d.subredditCounts().entries);assert.deepEqual(entries.map(e=>e.key),['Alpha','Beta']);assert.equal(entries.find(e=>e.key==='Alpha').count,2,'the larger count is kept');
});


for(const hydrated of [false,true])test(`empty Enter restores native profile search with archive off and a current scope chip (${hydrated})`,async t=>{
 const s=await boot(t,{url:'https://www.reddit.com/user/Example/',html:'<main></main>',settings:{postDiscovery:true,archiveDiscovery:false},autoDiscover:true}),h=headerSearch(s,hydrated);const chip=h.root.querySelector('#search-input-chip,#search-input-remove-filter');chip.removeAttribute('id');chip.classList.add('scoped-search-pill');chip.setAttribute('slot','chips');const urls=[];
 s.D.addEventListener('click',event=>{const a=event.target.closest?.('a');if(!a)return;event.preventDefault();urls.push(new URL(a.href));s.W.history.pushState({},'',a.href);s.D.body.innerHTML=page;s.d.scan();},true);
 assert.equal(enter(s.W,h.input).defaultPrevented,true);await flush();assert.equal(urls.length,1);assert.equal(urls[0].pathname,'/user/Example/search/');assert.equal(s.d.context?.view,'search');assert.ok(s.calls.some(c=>c.action==='profile'));assert.equal(s.queries.length,0,'archive off does not prevent Reddit search or query the archive');
});

test('search adds no space above the first result: no controls margin and no local-filter banner',async t=>{
  const s=await boot(t,{autoDiscover:true});await search(s);s.d.ensureActivityMenu?.();await flush();
  // Reddit's first result sits 8px under the scope switcher; our zero-height rows must let that margin collapse (live 2026-11-16).
  const target=s.D.querySelector('[data-rt-ui="profile-controls"]');if(target && target.className!=='contents'){assert.equal(target.classList.contains('my-md'),false,'empty controls row keeps no margins in search');assert.equal(target.classList.contains('flex'),false,'a flex row would stop the margin collapsing');}
  assert.equal(s.d.notice.hidden,true);assert.equal(s.d.host.hasAttribute('data-rt-search'),true);
  assert.match(fs.readFileSync('extension/post-discovery.css','utf8'),/\.rt-posts\[data-rt-search\] \.rt-posts-toolbar\{display:contents\}/);
});
