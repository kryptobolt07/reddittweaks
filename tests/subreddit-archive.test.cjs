const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');

const modalHtml=(title,name='gone')=>`<guard-community-modal isdesktop="" isloggedin="" subredditname="${name}" subredditid="t5_x" actioned=""><div slot="titleGraphic" class="flex"><svg></svg></div><div slot="closeButton"><a class="button-secondary icon button" href="/"></a></div><div slot="primaryButton"><a class="w-100 button-medium button-primary button inline-flex" href="/"><span><span>Browse Other Communities</span></span></a></div><div slot="title" class="text-24 s:text-20">${title}</div><div><p>This subreddit has been banned for violating the reddit rules</p></div></guard-community-modal>`;
const quarantineHtml='<guard-community-modal subredditname="gone" actioned=""><div slot="title">r/gone is quarantined</div><div><button class="button-primary">Yes, Continue</button></div></guard-community-modal>';
const post=(id,created,extra={})=>({id,fullname:'t3_'+id,kind:'post',title:'Title '+id,body:'Body '+id,author:'alice',subreddit:'gone',created,score:1,comments:0,permalink:'/r/gone/comments/'+id+'/t/',media:[],postType:'self',...extra});
const comment=(id,created,extra={})=>({id,fullname:'t1_'+id,kind:'comment',title:'Title',body:'Comment '+id,author:'alice',subreddit:'gone',created,score:1,comments:0,permalink:'/r/gone/comments/abc/t/'+id+'/',media:[],...extra});
const tick=async()=>{for(let i=0;i<6;i++)await new Promise(r=>setImmediate(r));};

// Loads the scripts into a synthetic Reddit page with mocked archive/recents services.
async function boot(opts){
  // The script under test defines the class; construct after it loads.
  const dom=new JSDOM('<!doctype html><body><shreddit-app>'+(opts?.html??modalHtml('r/gone is banned'))+'</shreddit-app></body>',{url:opts?.url||'https://www.reddit.com/r/gone/',runScripts:'outside-only',pretendToBeVisual:true}),W=dom.window;
  const o={enabled:true,pages:null,owner:'me',meta:null,recents:null,...opts};
  for(const f of ['search-core.js','post-model.js','archive-view.js','post-discovery.js','feed-filters.js','subreddit-archive.js'])W.eval(fs.readFileSync('extension/'+f,'utf8'));
  const calls=[],store=o.recents || new Map();
  W.RTArchiveQuery={
    async *search(options){calls.push(options);const list=o.pages?o.pages(options,calls.length):[{items:[post('a1',1500000000),post('a2',1400000000)],searchedBackTo:1400000000,hasMore:false,cursor:null}];for(const page of list){if(page instanceof Error)throw page;yield page;}},
    async subreddit(){if(!o.meta)throw Object.assign(Error('not in archive'),{code:'not-found'});return {ok:true,subreddit:o.meta};}
  };
  if(o.send){
    const subreddit=W.RTArchiveQuery.subreddit;W.eval(fs.readFileSync('extension/archive-query.js','utf8'));const Q=W.RTArchiveQuery;
    W.RTArchiveQuery={...Q,subreddit,search(options){calls.push(options);return Q.search({...options,send:o.send});}};
  }
  W.RTRecentSearches={
    async list(ow,s){return [...(store.get(ow+'|'+s)||[])].map(q=>({q,at:1}));},
    async add(ow,s,q){const k=ow+'|'+s,l=(store.get(k)||[]).filter(x=>x!==q);l.unshift(q);store.set(k,l);return [];},
    async remove(ow,s,q){const k=ow+'|'+s;store.set(k,(store.get(k)||[]).filter(x=>x!==q));return [];},
    async clear(ow,s){store.delete(ow+'|'+s);return [];}
  };
  const sa=new W.RTSubredditArchive.SubredditArchive({observe:false,readSettings:async()=>({enabled:o.enabled}),getOwner:()=>o.owner,communityState:async()=>o.communityKind ?? 'banned',reddit:o.reddit || (async message=>{const target=W.document.getElementById(message.target);if(target)target.innerHTML='<flex-left-nav-container id="left-sidebar-container"><nav><a href="/">Home</a></nav></flex-left-nav-container>';return {rendered:true};}),archive:async message=>o.archive?o.archive(message):{ok:true,posts:[]}});
  await sa.ready;
  return {W,doc:W.document,sa,calls,store};
}
const button=doc=>doc.querySelector('[data-rt-ui="subreddit-archive-action"] button');
const open=async ctx=>{button(ctx.doc).click();await tick();};
const searchHtml='<header><reddit-search-large><input name="q"></reddit-search-large></header><faceplate-tabgroup id="search-results-page-tabgroup"><a href="?type=posts">Posts</a><a href="?type=comments">Comments</a><a href="?type=media">Media</a></faceplate-tabgroup><main><div data-testid="search-scope-switcher">Show results from all Reddit</div><div class="bg-neutral-background"><div data-testid="search-error-message">Native empty state</div></div></main><aside data-testid="search-results-sidebar"></aside>';
const search=async(ctx,text,{type,sort='new',t='all'}={})=>{const params=new ctx.W.URLSearchParams(ctx.W.location.search);type ||= params.get('type') || params.get('rt_tab') || 'posts';ctx.sa.unmount();ctx.doc.querySelector('shreddit-app').innerHTML=searchHtml;ctx.W.history.pushState({},'','/r/gone/search/?'+new ctx.W.URLSearchParams({q:text,type,sort,t}));ctx.sa.scan();await tick();};
const resultIds=ctx=>[...ctx.doc.querySelectorAll('[data-rt-ui="archive-search-unit"]')].map(n=>n.dataset.fullname);


test('trigger only for banned (and private) communities',async()=>{
  for(const [title,expected] of [['r/gone is banned',true],['r/gone is private',true],['r/gone is quarantined',false]]){
    const {doc}=await boot({html:modalHtml(title)});assert.equal(Boolean(button(doc)),expected,title);
  }
  const quarantine=await boot({html:quarantineHtml});assert.equal(button(quarantine.doc),null);assert.equal(quarantine.doc.querySelector('guard-community-modal').children.length,2);
  const none=await boot({html:''});assert.equal(none.doc.querySelector('[data-rt-ui]'),null);
  const live=await boot({html:'<main><shreddit-feed><shreddit-post id="t3_x"></shreddit-post></shreddit-feed></main>'});assert.equal(live.doc.querySelector('[data-rt-ui]'),null);
  assert.equal(live.doc.querySelector('shreddit-post').parentElement.children.length,1);
});
test('archive setting off adds nothing and releases an early hold',async()=>{
  const ctx=await boot({enabled:false,url:'https://www.reddit.com/r/gone/?rt_view=archive',html:modalHtml('r/gone is banned').replace('<guard-community-modal','<guard-community-modal data-rt-subreddit-hold="true" style="display:none !important"')});
  assert.equal(button(ctx.doc),null);assert.equal(ctx.doc.querySelector('[data-rt-ui="archive-subreddit"]'),null);
  const modal=ctx.doc.querySelector('guard-community-modal');assert.equal(modal.hasAttribute('data-rt-subreddit-hold'),false);assert.equal(modal.style.display,'');
});
test('button is a secondary-styled sibling in the modal and click mounts the view and sets rt_view',async()=>{
  const ctx=await boot(),{doc,W}=ctx,b=button(doc);
  assert.match(b.className,/button-secondary/);assert.match(b.className,/button-medium/);assert.equal(b.textContent.trim(),'Browse archived posts');assert.equal(b.parentElement.getAttribute('slot'),'primaryButton');
  assert.ok(doc.querySelector('guard-community-modal a.button-primary'),"Reddit's own buttons stay");
  W.history.replaceState({keep:1},'',W.location.pathname);
  b.click();await tick();
  assert.equal(new W.URLSearchParams(W.location.search).get('rt_view'),'archive');assert.deepEqual(W.history.state,{keep:1});
  const modal=doc.querySelector('guard-community-modal');assert.equal(modal.style.display,'none');
  assert.ok(doc.querySelector('[data-rt-ui="archive-subreddit"]'));assert.equal(doc.querySelectorAll('guard-community-modal').length,1);
});
test('reload with rt_view=archive mounts directly; early hold keeps the modal from flashing',async()=>{
  const ctx=await boot({url:'https://www.reddit.com/r/gone/?rt_view=archive'});await tick();
  assert.ok(ctx.doc.querySelector('[data-rt-ui="archive-subreddit"]'));
  // profile-notice.js holds the modal from document_start.
  const dom=new JSDOM('<!doctype html><body><shreddit-app>'+modalHtml('r/gone is banned')+'</shreddit-app></body>',{url:'https://www.reddit.com/r/gone/?rt_view=archive',runScripts:'outside-only'}),W=dom.window;
  W.chrome={runtime:{id:'x',sendMessage:async()=>({ok:true,settings:{postDiscovery:true,archiveDiscovery:true}})}};
  W.eval(fs.readFileSync('extension/profile-notice.js','utf8'));
  const modal=W.document.querySelector('guard-community-modal');assert.equal(modal.style.display,'none');assert.equal(modal.getAttribute('data-rt-subreddit-hold'),'true');
  await tick();assert.equal(modal.style.display,'none','stays held once settings allow the archive');
  // Quarantined communities and a normal URL are never held.
  for(const [html,url] of [[quarantineHtml,'https://www.reddit.com/r/gone/?rt_view=archive'],[modalHtml('r/gone is banned'),'https://www.reddit.com/r/gone/']]){
    const d=new JSDOM('<!doctype html><body><shreddit-app>'+html+'</shreddit-app></body>',{url,runScripts:'outside-only'}).window;
    d.chrome={runtime:{id:'x',sendMessage:async()=>({ok:true,settings:{archiveDiscovery:true}})}};d.eval(fs.readFileSync('extension/profile-notice.js','utf8'));
    assert.equal(d.document.querySelector('guard-community-modal').style.display,'');
  }
  // Archive off in settings: released.
  const off=new JSDOM('<!doctype html><body><shreddit-app>'+modalHtml('r/gone is banned')+'</shreddit-app></body>',{url:'https://www.reddit.com/r/gone/?rt_view=archive',runScripts:'outside-only'}).window;
  off.chrome={runtime:{id:'x',sendMessage:async()=>({ok:true,settings:{postDiscovery:true,archiveDiscovery:false}})}};off.eval(fs.readFileSync('extension/profile-notice.js','utf8'));
  await tick();assert.equal(off.document.querySelector('guard-community-modal').style.display,'');
});
test('removing rt_view (Back) restores Reddit’s modal',async()=>{
  const ctx=await boot({url:'https://www.reddit.com/r/gone/?rt_view=archive'}),{W,doc,sa}=ctx;await tick();
  assert.equal(doc.querySelector('guard-community-modal').style.display,'none');
  W.history.replaceState(null,'','/r/gone/');sa.scan();
  assert.equal(doc.querySelector('[data-rt-ui="archive-subreddit"]'),null);assert.equal(doc.querySelector('guard-community-modal').style.display,'');assert.ok(button(doc),'button stays on the restored modal');
  assert.equal(doc.documentElement.hasAttribute('data-rt-subreddit-archive'),false);
});
test('grouped Boolean text sends a keyword superset to Arctic Shift posts and is evaluated locally',async()=>{
  const wire=[],rows=[post('a1',1500000000,{title:'cats quiet place'}),post('a2',1400000000,{title:'dogs quiet place'}),post('a3',1300000000,{title:'cats quiet place spam'}),post('a4',1200000000,{title:'cats elsewhere'})];
  const ctx=await boot({url:'https://www.reddit.com/r/gone/?rt_view=archive',send:async message=>{
    wire.push(message);if(message.query)return {ok:false,code:'text-search-unavailable'};
    return {ok:true,posts:rows,hasMore:false};
  }});await tick();
  await search(ctx,'(cats OR dogs) AND "quiet place" NOT spam');
  // Arctic Shift post search is keyword-only: send the AND-only superset, filter the rest locally.
  assert.equal(wire.find(message=>message.query).query,'"quiet place"');
  assert.deepEqual(resultIds(ctx),['t3_a1','t3_a2']);
  assert.match(ctx.doc.querySelector('.rt-sra-searched').textContent,/Matched by scanning archived pages.*Matches filtered locally.*Results may be incomplete/);
});

test('mixed Boolean fields retain OR/NOT meaning and only safe text reaches the helper',async()=>{
  const rows=[post('a1',1500000000,{title:'cats',over18:false}),post('a2',1400000000,{title:'dogs',over18:true}),post('a3',1300000000,{title:'cats',over18:true}),post('a4',1200000000,{title:'dogs',over18:false})];
  const ctx=await boot({url:'https://www.reddit.com/r/gone/?rt_view=archive',pages:()=>[{items:rows,searchedBackTo:1200000000,hasMore:false,cursor:null}]});await tick();
  await search(ctx,'(title:cats AND NOT nsfw:yes) OR (body:"Body a2" AND nsfw:yes)');
  assert.equal(ctx.W.RCSCore.toArchiveQuery(ctx.calls.at(-1).parsed),'');
  assert.deepEqual(resultIds(ctx),['t3_a1','t3_a2']);
  assert.equal(ctx.sa.searchState().plan.residual,true);
  await search(ctx,'cats AND (nsfw:no OR type:image)');
  assert.equal(ctx.W.RCSCore.toArchiveQuery(ctx.calls.at(-1).parsed),'cats');
  assert.deepEqual(resultIds(ctx),['t3_a1']);
});

test('only a single unconditional positive author is sent to the author parameter',async()=>{
  const rows=[post('a1',1500000000,{author:'alice',title:'cats'}),post('a2',1400000000,{author:'bobby',title:'dogs'}),post('a3',1300000000,{author:'carol',title:'birds'})];
  const ctx=await boot({url:'https://www.reddit.com/r/gone/?rt_view=archive',pages:()=>[{items:rows,searchedBackTo:1300000000,hasMore:false,cursor:null}]});await tick();
  await search(ctx,'(u/Alice AND cats)');assert.equal(ctx.calls.at(-1).author,'alice');assert.equal(ctx.sa.searchState().plan.residual,false);
  for(const [query,ids] of [
    ['author:alice OR title:dogs',['t3_a1','t3_a2']],['NOT author:alice',['t3_a2','t3_a3']],
    ['author:alice OR author:bobby',['t3_a1','t3_a2']],['author:alice AND author:bobby',[]]
  ]){
    await search(ctx,query);assert.equal(ctx.calls.at(-1).author,undefined,query);
    assert.deepEqual(resultIds(ctx),ids,query);
  }
});

test('all post fields and aliases map archive data to residual records',async()=>{
  const created=new Date(2026,0,15,12).getTime()/1000;
  const rows=[post('a1',created,{title:'Alpha launch',body:'quiet place',url:'https://news.example.test/article',link_flair_text:'Project News',postType:'text',over18:false,spoiler:true}),post('a2',created,{title:'Other',url:'https://elsewhere.test',postType:'image',over18:true,spoiler:false})];
  const ctx=await boot({url:'https://www.reddit.com/r/gone/?rt_view=archive',pages:()=>[{items:rows,searchedBackTo:created,hasMore:false,cursor:null}]});await tick();
  for(const query of ['title:Alpha','body:"quiet place"','selftext:quiet','text:quiet','site:example.test','domain:example.test','url:article','flair:"Project News"','self:yes','nsfw:no','spoiler:yes','type:text','after:2026-01-01 before:2026-02-01']){
    await search(ctx,query);
    const ids=resultIds(ctx);
    assert.deepEqual(ids,query.startsWith('after:')?['t3_a1','t3_a2']:['t3_a1'],query);
    assert.equal(ctx.sa.searchState().plan.residual,true,query);assert.equal(ctx.W.RCSCore.toArchiveQuery(ctx.calls.at(-1).parsed),'',query);
    assert.equal(ctx.calls.at(-1).after,undefined,'date query stays local');assert.equal(ctx.calls.at(-1).before,undefined,'date query stays local');
  }
  await search(ctx,'self:no nsfw:yes spoiler:no type:image');assert.deepEqual(resultIds(ctx),['t3_a2']);
  await search(ctx,'flair:missing');assert.equal(ctx.doc.querySelectorAll('.rt-sra-unit').length,0);
});

test('unavailable fields, aliases and malformed queries show inline errors without searching or saving',async()=>{
  const ctx=await boot({url:'https://www.reddit.com/r/gone/?rt_view=archive&rt_tab=comments'});await tick();
  const count=ctx.calls.length;
  for(const query of ['title:cats','site:example.test','domain:example.test','url:article','flair:News','self:yes','nsfw:no','spoiler:no','type:image']){
    await search(ctx,query);assert.equal(ctx.sa.search.notice.classList.contains('rt-sra-error-text'),true,query);assert.match(ctx.sa.search.notice.textContent,/isn't available for comments/,query);
  }
  for(const query of ['cats AND','(cats OR dogs','body:"unfinished','after:tomorrow','from:Alice','has:image']){
    await search(ctx,query);assert.equal(ctx.sa.search.notice.classList.contains('rt-sra-error-text'),true,query);assert.ok(ctx.sa.search.notice.textContent.length>8);
  }
  assert.equal(ctx.calls.length,count);assert.equal(ctx.store.size,0);
});

test('both tabs reject another subreddit and accept the current page scope',async()=>{
  for(const tab of ['posts','comments']){
    const ctx=await boot({url:'https://www.reddit.com/r/gone/?rt_view=archive&rt_tab='+tab});await tick();const count=ctx.calls.length;
    for(const query of ['subreddit:OtherSub','r/OtherSub','NOT r/OtherSub','body:cats OR r/OtherSub']){
      await search(ctx,query);assert.match(ctx.sa.search.notice.textContent,/scoped to r\/gone/);assert.equal(ctx.calls.length,count);
    }
    for(const query of ['subreddit:GONE','r/gone']){await search(ctx,query);assert.equal(ctx.sa.search.notice.classList.contains('rt-sra-error-text'),false);assert.equal(ctx.calls.at(-1).subreddit,'gone');}
  }
});

test('switching to comments revalidates the active query and never starts an invalid search',async()=>{
  const ctx=await boot({url:'https://www.reddit.com/r/gone/?rt_view=archive'});await tick();await search(ctx,'title:cats');const count=ctx.calls.length;
  await search(ctx,'title:cats',{type:'comments'});assert.equal(ctx.calls.length,count);assert.equal(ctx.sa.search.notice.classList.contains('rt-sra-error-text'),true);assert.match(ctx.sa.search.notice.textContent,/isn't available for comments/);
  ctx.sa.loadMoreSearch();await tick();assert.equal(ctx.calls.length,count);
  await search(ctx,'title:cats',{type:'posts'});assert.equal(ctx.sa.search.notice.classList.contains('rt-sra-error-text'),false);assert.equal(ctx.calls.length,count+1,'returning to a valid native search route starts that search');
});

test('comment body, author and dates use residual matching without searching synthetic titles',async()=>{
  const created=new Date(2026,0,15,12).getTime()/1000;
  const rows=[comment('c1',created,{body:'cats quiet place',author:'alice'}),comment('c2',created,{body:'dogs noisy place',author:'bobby'}),comment('c3',created,{title:'cats',body:'birds'})];
  const ctx=await boot({url:'https://www.reddit.com/r/gone/?rt_view=archive&rt_tab=comments',pages:()=>[{items:rows,searchedBackTo:created,hasMore:false,cursor:null}]});await tick();
  await search(ctx,'(body:cats OR u/bobby) after:2026-01-01 before:2026-02-01 NOT body:birds');
  assert.equal(ctx.calls.at(-1).author,undefined);assert.equal(ctx.calls.at(-1).kind,'comment');
  assert.deepEqual(Array.from(ctx.sa.searchState().items,item=>item.id),['c1','c2']);
  await search(ctx,'cats AND after:2026-01-01');assert.deepEqual(Array.from(ctx.sa.searchState().items,item=>item.id),['c1']);
});

test('residual filtering skips empty pages, deduplicates overlaps and preserves Search older cursor and searched date',async()=>{
  const ctx=await boot({url:'https://www.reddit.com/r/gone/?rt_view=archive',pages:options=>options.cursor?[{items:[post('yes1',1300000000,{title:'cats'}),post('yes2',1200000000,{title:'cats'})],searchedBackTo:1100000000,hasMore:false,cursor:null}]:[
    {items:[post('no1',1600000000,{title:'dogs'})],searchedBackTo:1500000000,hasMore:true,cursor:1500000001},
    {items:[post('no1',1600000000,{title:'dogs'}),post('yes1',1300000000,{title:'cats'})],searchedBackTo:1250000000,hasMore:true,cursor:1250000001}
  ]});await tick();await search(ctx,'title:cats');
  assert.deepEqual(Array.from(ctx.sa.searchState().items,item=>item.id),['yes1']);assert.equal(ctx.sa.searchState().cursor,1250000001);assert.equal(ctx.sa.searchState().searchedBackTo,1250000000);
  assert.match(ctx.doc.querySelector('.rt-sra-searched').textContent,/^Searched back to .*Matches filtered locally.*Results may be incomplete/);
  ctx.doc.querySelector('[data-rt-more]').click();await tick();assert.equal(ctx.calls.at(-1).cursor,1250000001);
  assert.deepEqual(Array.from(ctx.sa.searchState().items,item=>item.id),['yes1','yes2']);assert.equal(ctx.sa.searchState().searchedBackTo,1100000000);assert.equal(ctx.doc.querySelector('[data-rt-more]'),null);
  assert.match(ctx.doc.querySelector('.rt-sra-foot').textContent,/Coverage may be partial/);assert.doesNotMatch(ctx.doc.querySelector('.rt-sra-foot').textContent,/history complete|all results|search complete/i);
});

test('an untranslatable text expression scans locally instead of silently dropping its query',async()=>{
  const query=Array.from({length:8},(_,i)=>`(left${i} OR right${i})`).join(' AND '),title=Array.from({length:8},(_,i)=>'left'+i).join(' ');
  const wire=[],ctx=await boot({url:'https://www.reddit.com/r/gone/?rt_view=archive',send:async message=>{wire.push(message);return {ok:true,posts:[post('a1',1500000000,{title}),post('a2',1400000000,{title:'left0'})],hasMore:false};}});await tick();
  await search(ctx,query);assert.equal(wire.at(-1).query,undefined);assert.deepEqual(Array.from(ctx.sa.searchState().items,item=>item.id),['a1']);
  assert.match(ctx.doc.querySelector('.rt-sra-searched').textContent,/Matches filtered locally.*Results may be incomplete/);
});


test('community masthead and sidebar use one header, native sort row, and no extra search bar or tabs',async()=>{
 const ctx=await boot({url:'https://www.reddit.com/r/gone/?rt_view=archive'});await tick();const {doc}=ctx;
 assert.equal(doc.querySelector('h1').textContent,'r/gone');assert.ok(doc.querySelector('.masthead.subreddit-feed-masthead section'));
 assert.equal(doc.querySelector('.rt-sra-avatar').parentElement,doc.querySelector('.rt-sra-name').parentElement.parentElement);
 assert.match(doc.querySelector('[data-testid="subreddit-archive-state"]').textContent,/Banned.*Archived posts/);
 assert.equal(doc.querySelectorAll('main input,main form,faceplate-tabgroup').length,0);
 assert.equal(doc.querySelectorAll('.rt-sra-control-row>div').length,3);assert.match(doc.querySelector('aside').textContent,/Coverage may be partial/);
 assert.equal(ctx.calls[0].kind,'post');assert.equal(ctx.calls[0].subreddit,'gone');
 assert.equal(doc.querySelectorAll('shreddit-feed shreddit-post').length,2);assert.match(doc.querySelector('.rt-sra-searched').textContent,/Searched back to/);
 ctx.sa.destroy();ctx.W.close();
});
test('archived metadata stays in the community sidebar without inventing live member counts',async()=>{
 const ctx=await boot({url:'https://www.reddit.com/r/gone/?rt_view=archive',meta:{title:'Gone Community',subscribers:12345,created:1300000000,icon:'https://styles.redditmedia.com/t5_x/styles/icon.png'}});await tick();
 assert.equal(ctx.doc.querySelector('.rt-sra-icon').src,'https://styles.redditmedia.com/t5_x/styles/icon.png');assert.match(ctx.doc.querySelector('aside').textContent,/Gone Community|12.3K/);
 assert.match(ctx.doc.querySelector('.rt-sra-facts').textContent,/Created/);assert.equal(ctx.doc.querySelectorAll('h1').length,1);
});
test('dropdowns preserve sort, date, type filters and loaded-only ranking',async()=>{
 const ctx=await boot({url:'https://www.reddit.com/r/gone/?rt_view=archive'});await tick();const {sa,W,doc}=ctx;
 sa.sortMenu.button.click();assert.equal(sa.sortMenu.menu.hidden,false);sa.menuRows.sort.get('old').click();await tick();assert.equal(ctx.calls.at(-1).sort,'asc');assert.equal(new W.URLSearchParams(W.location.search).get('rt_sort'),'old');
 sa.sortMenu.button.click();sa.menuRows.sort.get('top').click();await tick();assert.match(sa.statusTop.textContent,/loaded posts only/);assert.equal(new W.URLSearchParams(W.location.search).get('rt_top'),'1');
 sa.dateMenu.button.click();sa.menuRows.date.get('week').click();await tick();assert.ok(ctx.calls.at(-1).after);assert.equal(sa.dateMenu.menu.hidden,true);
 sa.typeMenu.button.click();assert.equal(sa.typeMenu.menu.hidden,false);assert.ok(sa.typeMenu.menu.querySelector('[role="menuitemcheckbox"]'));
 doc.dispatchEvent(new W.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(sa.typeMenu.menu.hidden,true);
});
test('one Reddit community halo replaces skeletons on initial feed load and disappears after completion',async()=>{
 const ctx=await boot({url:'https://www.reddit.com/r/gone/?rt_view=archive'});await tick();let release;const gate=new Promise(r=>release=r);
 ctx.W.RTArchiveQuery.search=async function*(){await gate;yield {items:[],hasMore:false};};ctx.sa.states.clear();ctx.sa.refresh();
 const loader=ctx.doc.querySelector('[data-rt-ui="archive-loading"]');assert.equal(loader.getAttribute('role'),'status');assert.ok(loader.querySelector('shreddit-loading'),'Reddit\'s Snoo halo element');assert.equal(ctx.doc.querySelectorAll('shreddit-loading').length,1);assert.equal(ctx.doc.querySelector('shreddit-feed-page-loading,faceplate-shimmer,[data-rt-skeleton],.rt-skeleton'),null);
 release();await tick();assert.equal(ctx.doc.querySelector('shreddit-loading'),null);
});
test('feed pagination keeps cards and cursor while the native halo is loading',async()=>{
 const ctx=await boot({url:'https://www.reddit.com/r/gone/?rt_view=archive',pages:()=>[{items:[post('a1',1500000000)],hasMore:true,cursor:1499999999}]});await tick();let release;const gate=new Promise(r=>release=r);
 ctx.W.RTArchiveQuery.search=async function*(o){ctx.calls.push(o);await gate;yield {items:[post('a2',1400000000)],hasMore:false};};ctx.sa.loadMore();assert.equal(ctx.calls.at(-1).cursor,1499999999);assert.equal(ctx.doc.querySelectorAll('shreddit-post').length,1);assert.ok(ctx.doc.querySelector('[data-rt-ui="archive-loading"] shreddit-loading'));
 release();await tick();assert.equal(ctx.doc.querySelector('shreddit-loading'),null);assert.equal(ctx.doc.querySelectorAll('shreddit-post').length,2);
});
test('archive errors stop the halo and offer a working retry without claiming completeness',async()=>{
 let fail=true;const ctx=await boot({url:'https://www.reddit.com/r/gone/?rt_view=archive',pages:()=>{if(fail)throw Error('Archive unavailable');return [{items:[post('a1',1500000000)],hasMore:false}];}});await tick();assert.match(ctx.doc.querySelector('.rt-sra-error').textContent,/Archive unavailable/);assert.equal(ctx.doc.querySelector('shreddit-loading'),null);
 fail=false;ctx.doc.querySelector('[data-rt-retry]').click();await tick();assert.equal(ctx.doc.querySelector('.rt-sra-error'),null);assert.equal(ctx.doc.querySelectorAll('shreddit-post').length,1);assert.match(ctx.doc.body.textContent,/Coverage may be partial/);
});
test('native search tabs, scope and sidebar stay in place, originals restore on leaving search',async()=>{
 const ctx=await boot();await search(ctx,'Body');const {doc,W,sa}=ctx;
 assert.ok(doc.querySelector('[data-rt-ui="archive-search"]'));assert.equal(doc.querySelectorAll('input').length,1);assert.equal(doc.querySelectorAll('faceplate-tabgroup').length,1);assert.equal(doc.querySelector('[data-testid="search-scope-switcher"]').hidden,false);
 assert.equal(doc.querySelector('[data-testid="search-error-message"]').hidden,true);assert.equal(resultIds(ctx).length,2);assert.ok(doc.querySelector('[data-testid="search-results-sidebar"] .rt-sra-about-title'));
 W.history.pushState({},'','/r/live/');sa.scan();assert.equal(doc.querySelector('[data-rt-ui="archive-search"]'),null);assert.equal(doc.querySelector('[data-testid="search-error-message"]').hidden,false);
});
test('live community search is left untouched and unavailable-state responses do not imply an empty archive',async()=>{
 const ctx=await boot({communityKind:''});await search(ctx,'cat');assert.equal(ctx.calls.length,0);assert.equal(ctx.doc.querySelector('[data-rt-ui="archive-search"]'),null);assert.equal(ctx.doc.querySelector('[data-testid="search-error-message"]').hidden,false);
});
test('native comments and media tabs drive archive kind, titles and media filtering',async()=>{
 const ctx=await boot({pages:o=>[{items:o.kind==='comment'?[comment('c1',1500000000)]:[post('a1',1500000000,{postType:'image'}),post('a2',1400000000)],hasMore:false}]});await search(ctx,'Comment',{type:'comments'});assert.equal(ctx.calls.at(-1).kind,'comment');assert.equal(ctx.calls.at(-1).titles,true);assert.ok(ctx.doc.querySelector('.rt-sra-comment-box'));
 await search(ctx,'Title',{type:'media'});assert.deepEqual(resultIds(ctx),['t3_a1']);
});
test('search loading uses a single native halo and late answers cannot update a departed route',async()=>{
 const ctx=await boot();let release;const gate=new Promise(r=>release=r);ctx.W.RTArchiveQuery.search=async function*(){await gate;yield {items:[post('late',1500000000)],hasMore:false};};await search(ctx,'cat');assert.ok(ctx.doc.querySelector('[data-rt-ui="archive-loading"] shreddit-loading'));assert.equal(ctx.doc.querySelector('[data-rt-skeleton]'),null);
 ctx.W.history.pushState({},'','/r/live/');ctx.sa.scan();release();await tick();assert.equal(ctx.doc.querySelector('[data-rt-ui="archive-search"]'),null);assert.equal(ctx.doc.querySelector('[data-fullname="t3_late"]'),null);
});
test('archive cards show link domains without a missing-text warning, while unrecorded removed text stays explicit',async()=>{
 const ctx=await boot();const card=ctx.W.RTPostDiscovery.archiveCard(post('link',1400000000,{body:'',postType:'link',isSelf:false,url:'https://example.test/story'}));assert.equal(card.querySelector('.rt-archive-link').textContent,'example.test');assert.doesNotMatch(card.textContent,/no original text/);assert.equal(card.querySelector('shreddit-post').hasAttribute('inert'),false);
 const removed=ctx.W.RTPostDiscovery.archiveCard(post('gone',1400000000,{body:'[removed]',isSelf:true}));assert.match(removed.textContent,/no original text/);
});

test('empty native tab groups use Reddit paging API and restore their original state on exit',async()=>{
 const ctx=await boot();await search(ctx,'Title');const group=ctx.doc.getElementById('search-results-page-tabgroup');
 group.pageNames=undefined;group.pages=0;group.pageIndex=0;
 for(const [index,name] of ['posts','comments','media'].entries())group.children[index].setAttribute('slot',name);
 ctx.sa.repairSearchTabs();assert.deepEqual(Array.from(group.pageNames),['posts','comments','media']);assert.equal(group.pageIndex,1);
 ctx.W.history.pushState({},'','/r/live/');ctx.sa.scan();assert.equal(group.pageNames,undefined);assert.equal(group.pages,0);assert.equal(group.pageIndex,0);
});

test('NSFW archive items do not restore media',async()=>{
  const ctx=await boot({url:'https://www.reddit.com/r/gone/?rt_view=archive',pages:()=>[{items:[post('n1',1500000000,{over18:true,media:[{kind:'image',url:'https://i.redd.it/x.png'}]})],searchedBackTo:1500000000,hasMore:false,cursor:null}]});await tick();
  assert.equal(ctx.doc.querySelector('img[src*="i.redd.it"]'),null);assert.match(ctx.doc.querySelector('shreddit-feed').textContent,/NSFW or spoiler/);
});

test('RTPostDiscovery.archiveCard draws inert native-looking cards for non-profile pages',()=>{
  const W=new JSDOM('<main></main>',{url:'https://www.reddit.com/r/gone/',runScripts:'outside-only',pretendToBeVisual:true}).window;
  for(const f of ['post-model.js','archive-view.js','post-discovery.js'])W.eval(fs.readFileSync('extension/'+f,'utf8'));
  const card=W.RTPostDiscovery.archiveCard(post('abc12',1400000000)),native=card.querySelector('shreddit-post');
  assert.ok(native);assert.equal(native.getAttribute('subreddit-name'),'gone');assert.equal(native.hasAttribute('inert'),false);assert.match(card.textContent,/Body abc12/);assert.equal(card.querySelector('[data-rt-source]').dataset.state,'unknown');
  const reply=W.RTPostDiscovery.archiveCard(comment('c1',1400000000));assert.ok(reply.querySelector('shreddit-profile-comment'));assert.equal(reply.querySelector('shreddit-comment-action-row').hasAttribute('inert'),false);
});

test('feed cards keep native title, author, community and comment navigation while blocking archive actions',async()=>{
 const ctx=await boot({url:'https://www.reddit.com/r/gone/?rt_view=archive'});await tick();const native=ctx.doc.querySelector('shreddit-post'),card=native.parentElement;
 assert.ok(native.querySelector('[slot="credit-bar"] a[href="/user/alice/"]'));assert.match(native.querySelector('[slot="credit-bar"]').textContent,/u\/alice/);assert.equal(native.hasAttribute('inert'),false);assert.ok(ctx.doc.querySelector('#left-sidebar-container nav a'));
 const navigation=[];ctx.doc.addEventListener('click',event=>{if(event.target.dataset.rtUi==='archive-navigation-link'){event.preventDefault();navigation.push(event.target.href);}},true);const title=native.querySelector('a[slot="title"]'),click=new ctx.W.MouseEvent('click',{bubbles:true,composed:true,cancelable:true});title.addEventListener('click',()=>assert.fail('native handler must not swallow navigation'));assert.equal(title.dispatchEvent(click),false);assert.equal(navigation[0],title.href);
 const vote=ctx.doc.createElement('button');vote.textContent='Vote';native.append(vote);let writes=0;vote.addEventListener('click',()=>writes++);assert.equal(vote.dispatchEvent(new ctx.W.MouseEvent('click',{bubbles:true,composed:true,cancelable:true})),false);assert.equal(writes,0);
 ctx.sa.destroy();ctx.W.close();
});
test('banned post permalinks show the archived post and nested comments, including a focused comment',async()=>{
 const calls=[],ctx=await boot({url:'https://www.reddit.com/r/gone/comments/abc12/title/c2/',archive:async message=>{calls.push(message);return message.action==='archive-ids'?{ok:true,posts:[post('abc12',1500000000)]}:{ok:true,posts:[comment('c2',1500000002,{linkId:'abc12',parentId:'t1_c1'}),comment('c1',1500000001,{linkId:'abc12',parentId:'t3_abc12'})],hasMore:false};}});await tick();
 assert.equal(ctx.doc.querySelector('h1[slot="title"]').textContent,'Title abc12');assert.ok(ctx.doc.querySelector('#left-sidebar-container'));assert.equal(ctx.doc.querySelector('.masthead'),null);
 assert.equal(ctx.doc.querySelector('#t1_c2').parentElement.id,'t1_c1');assert.ok(ctx.doc.querySelector('#t1_c2').classList.contains('rt-sra-focused-comment'));assert.equal(calls[1].focusId,'c2');assert.match(ctx.doc.querySelector('.rt-sra-foot').textContent,/Coverage may be partial/);
 assert.equal(ctx.doc.querySelectorAll('[data-rt-ui="archive-thread-comment"] [slot="commentMeta"] svg').length,0);assert.match(ctx.doc.querySelector('.rt-sra-note').textContent,/Arctic Shift.*Coverage may be partial/);
 ctx.W.history.pushState({},'','/r/live/');ctx.sa.scan();assert.equal(ctx.doc.querySelector('[data-rt-ui="archive-subreddit"]'),null);ctx.sa.destroy();ctx.W.close();
});
test('community comment cards use one page-level archive note instead of repeated badges',async()=>{
 const ctx=await boot({url:'https://www.reddit.com/r/gone/?rt_view=archive&rt_tab=comments',pages:()=>[{items:[comment('c1',1500000000),comment('c2',1400000000)],hasMore:false}]});await tick();
 assert.equal(ctx.doc.querySelectorAll('shreddit-profile-comment').length,2);assert.equal(ctx.doc.querySelectorAll('shreddit-profile-comment [data-rt-source]').length,0);assert.match(ctx.doc.querySelector('.rt-sra-note').textContent,/Arctic Shift.*Coverage may be partial/);
 ctx.sa.destroy();ctx.W.close();
});
test('thread misses, errors, paging and cyclic parent metadata stay explicit and bounded',async()=>{
 let fail=true;const ctx=await boot({url:'https://www.reddit.com/r/gone/comments/abc12/title/',archive:async message=>{if(message.action==='archive-ids')return {ok:true,posts:[post('abc12',1500000000)]};if(fail)throw Error('Temporarily unavailable');return {ok:true,posts:[comment('c1',1500000000,{linkId:'abc12',parentId:'t1_c2'}),comment('c2',1500000001,{linkId:'abc12',parentId:'t1_c1'}),comment('bad',1500000000,{linkId:'foreign'})],hasMore:true,cursor:1500000001,cursorStalled:true};}});await tick();assert.ok(ctx.doc.querySelector('h1'));assert.match(ctx.doc.querySelector('.rt-sra-error').textContent,/Temporarily unavailable/);
 fail=false;ctx.doc.querySelector('[data-rt-retry]').click();await tick();assert.equal(ctx.doc.querySelectorAll('shreddit-comment').length,2);assert.equal(ctx.doc.querySelector('#t1_bad'),null);assert.match(ctx.doc.querySelector('.rt-sra-foot').textContent,/stopped paging/);assert.equal(ctx.doc.querySelector('[data-rt-more]'),null);ctx.sa.destroy();ctx.W.close();
 const missing=await boot({url:'https://www.reddit.com/r/gone/comments/abc12/title/',archive:async()=>({ok:true,posts:[post('wrong',1500000000)]})});await tick();assert.match(missing.doc.querySelector('.rt-sra-foot').textContent,/not in the archive/);assert.equal(missing.doc.querySelector('shreddit-post'),null);missing.sa.destroy();missing.W.close();
});

// Left nav: Reddit renders it asynchronously through the page bridge, so re-rendering on every route change left it blank.
const navRecorder=(W,{holdFirst=false}={})=>{const renders=[];let release;const held=new Promise(r=>{release=r;});
  const fill=message=>{const target=W().document.getElementById(message.target);if(target)target.innerHTML='<flex-left-nav-container id="left-sidebar-container"><nav><a href="/">Home</a></nav></flex-left-nav-container>';return {rendered:true};};
  return {renders,release,reddit:async message=>{if(message.action!=='render-navigation')return {};renders.push(message);
    if(holdFirst && renders.length===1){await held;return fill(message);}return fill(message);}};};
const goTo=async(ctx,url)=>{ctx.W.history.pushState({},'',url);ctx.sa.scan();await tick();};
const navEl=doc=>doc.querySelector('[data-rt-ui="community-navigation"]');

test('archive keeps its rendered left nav across feed and thread routes',async()=>{
  let win;const rec=navRecorder(()=>win),ctx=await boot({reddit:rec.reddit});win=ctx.W;
  await open(ctx);const first=navEl(ctx.doc);
  assert.equal(first.dataset.state,'ready');assert.match(first.textContent,/Home/);assert.equal(rec.renders.length,1);
  await goTo(ctx,'/r/gone/comments/abc12/title/');
  assert.equal(navEl(ctx.doc),first,'thread route reuses the same nav element');assert.ok(first.isConnected);
  assert.ok(ctx.doc.querySelector('[data-rt-ui="archive-subreddit"]').contains(first));assert.equal(rec.renders.length,1,'no second render request');
  await goTo(ctx,'/r/gone/?rt_view=archive');
  assert.equal(navEl(ctx.doc),first,'back on the feed it is still the same element');assert.equal(rec.renders.length,1);
  assert.equal(ctx.doc.querySelectorAll('[data-rt-ui="community-navigation"]').length,1);
});

test('archive keeps a still-loading left nav across a remount and lets it finish in place',async()=>{
  let win;const rec=navRecorder(()=>win,{holdFirst:true}),ctx=await boot({reddit:rec.reddit});win=ctx.W;
  await open(ctx);const loading=navEl(ctx.doc);assert.equal(loading.dataset.state,'loading');
  await goTo(ctx,'/r/gone/comments/abc12/title/');
  assert.equal(navEl(ctx.doc),loading,'the loading nav is moved, not replaced');assert.equal(rec.renders.length,1,'no second render request');
  rec.release();await tick();
  assert.equal(loading.dataset.state,'ready');assert.match(loading.textContent,/Home/);assert.ok(loading.isConnected);
});

test('archive renders a fresh left nav for another community or a stale loading one',async()=>{
  let win;const rec=navRecorder(()=>win,{holdFirst:true}),ctx=await boot({reddit:rec.reddit});win=ctx.W;
  await open(ctx);const stale=navEl(ctx.doc);stale.dataset.loadingSince='0';
  await goTo(ctx,'/r/gone/comments/abc12/title/');
  const fresh=navEl(ctx.doc);assert.notEqual(fresh,stale,'a nav loading for over 8 s is not reused');assert.equal(fresh.dataset.state,'ready');assert.equal(rec.renders.length,2);
  rec.release();await tick();assert.equal(stale.isConnected,false,'the abandoned nav stays detached');
  ctx.sa.unmount();ctx.doc.querySelector('shreddit-app').innerHTML=modalHtml('r/other is banned','other');
  await goTo(ctx,'/r/other/?rt_view=archive');
  const other=navEl(ctx.doc);assert.notEqual(other,fresh,'another community gets its own nav');assert.equal(other.dataset.subreddit,'other');assert.equal(rec.renders.length,3);
});

test('archive keeps a failed left nav on screen and retries its render in place on the next route',async()=>{
  let win,count=0;const renders=[],ctx=await boot({reddit:async message=>{
    if(message.action!=='render-navigation')return {};renders.push(message);count++;if(count===1)return {rendered:false};
    const target=win.document.getElementById(message.target);target.innerHTML='<flex-left-nav-container id="left-sidebar-container"><nav><a href="/">Home</a></nav></flex-left-nav-container>';return {rendered:true};}});win=ctx.W;
  await open(ctx);const nav=navEl(ctx.doc);
  assert.equal(nav.dataset.state,'failed');assert.ok(nav.querySelector('nav'),'the fallback nav is shown');
  await goTo(ctx,'/r/gone/comments/abc12/title/');
  assert.equal(navEl(ctx.doc),nav,'the failed nav is moved, not replaced by an empty placeholder');
  assert.equal(renders.length,2,'one retry on the new route');assert.equal(nav.dataset.state,'ready');assert.match(nav.textContent,/Home/);
});

// Archive cards follow Reddit's subreddit feed card, not the profile card.
const archived=(W,raw)=>W.RTPostModel.normalizePost({subreddit:'gone',author:'alice',created_utc:1500000000,score:1240,num_comments:120,permalink:'/r/gone/comments/'+raw.id+'/t/',title:'T '+raw.id,...raw},{source:'arctic-shift'});

test('archive feed cards use the native subreddit layout: author avatar and name, no community, real post type',async()=>{
  const {W}=await boot();
  const image=W.RTPostDiscovery.archiveCard(archived(W,{id:'img1',post_hint:'image',url:'https://i.redd.it/abc.png',preview:{images:[{source:{url:'https://preview.redd.it/abc.png?width=640',width:640,height:480}}]}}));
  const post=image.querySelector('shreddit-post'),credit=post.querySelector('[slot="credit-bar"]');
  assert.equal(post.getAttribute('view-context'),'SubredditFeed');assert.equal(post.getAttribute('post-type'),'image');
  assert.doesNotMatch(credit.textContent,/r\/gone/,'no community name in the subreddit feed card');assert.match(credit.textContent,/u\/alice/);
  assert.match(credit.querySelector('img').src,/avatar_default_\d\.png$/);
  assert.ok(credit.querySelector('[data-rt-credit-right] .rt-archive-overflow[disabled]'),'disabled overflow on the right');
  assert.ok(credit.querySelector('[data-rt-credit-right] [data-rt-source]'),'archive badge sits on the right');
  assert.equal(post.querySelector('.rt-archive-media-group').slot,'post-media-container','image posts get full-width media');
  const linkCard=W.RTPostDiscovery.archiveCard(archived(W,{id:'lnk1',url:'https://www.example.com/story',domain:'example.com',thumbnail:'https://b.thumbs.redditmedia.com/x.jpg',preview:{images:[{source:{url:'https://external-preview.redd.it/x.jpg',width:300,height:200}}]}})).querySelector('shreddit-post');
  assert.equal(linkCard.getAttribute('post-type'),'link');assert.equal(linkCard.querySelector('.rt-archive-media-group')?.slot,'thumbnail');assert.equal(linkCard.querySelector('.rt-archive-link').textContent,'example.com');
  const self=W.RTPostDiscovery.archiveCard(archived(W,{id:'txt1',is_self:true,post_hint:'self',selftext:'See https://variety.com/x',preview:{images:[{source:{url:'https://external-preview.redd.it/v.jpg',width:300,height:200}}]}})).querySelector('shreddit-post');
  assert.equal(self.getAttribute('post-type'),'text');assert.equal(self.querySelector('.rt-archive-media-group'),null,'self posts never borrow a link preview');
});

test('archive post page card has a back button, community line, native title and a read-only action row',async()=>{
  const {W}=await boot();
  const card=W.RTPostDiscovery.archiveCard(archived(W,{id:'thr1',is_self:true,selftext:'Hello',link_flair_text:'Discussion'}),{thread:true}),post=card.querySelector('shreddit-post');
  assert.equal(post.getAttribute('view-context'),'CommentsPage');assert.ok(post.querySelector('.rt-sra-back'));assert.match(post.querySelector('[slot="credit-bar"]').textContent,/r\/gone[\s\S]*u\/alice/);
  assert.equal(post.querySelector('h1[slot="title"]').textContent,'T thr1');assert.equal(post.querySelector('[slot="post-flair"]').textContent,'Discussion');
  const row=post.querySelector('[data-rt-ui="archive-action-row"]');assert.ok(row,'action row when shreddit-post is not defined');
  assert.match(row.textContent,/1\.2K[\s\S]*120[\s\S]*Share/);assert.equal(row.querySelectorAll('button[disabled]').length,2,'votes are disabled');
});

test('archived comments carry a default avatar in the native avatar slot',async()=>{
  const ctx=await boot({url:'https://www.reddit.com/r/gone/comments/abc12/title/',archive:async message=>message.action==='archive-ids'?{ok:true,posts:[post('abc12',1500000000)]}:{ok:true,posts:[comment('c1',1500000100,{linkId:'abc12',link_id:'t3_abc12',parent_id:'t3_abc12'})]}});
  await tick();await tick();
  const node=ctx.doc.querySelector('shreddit-comment[data-rt-ui="archive-thread-comment"]');
  if(node){const avatar=node.querySelector('[slot="commentAvatar"] img');assert.ok(avatar,'avatar slot filled');assert.match(avatar.src,/avatar_default_\d\.png$/);}
});

test('archived images that are gone become a fixed-size notice instead of a stretched placeholder',async()=>{
  const {W}=await boot();
  const view=W.RTArchiveView.media([{kind:'image',url:'https://i.redd.it/gone.png'}],{alt:'x'}),img=view.querySelector('img:not(.rt-media-backdrop)');
  img.dispatchEvent(new W.Event('error'));assert.match(view.textContent,/Image no longer available/);
  const thumb=W.RTArchiveView.media([{kind:'preview',url:'https://external-preview.redd.it/gone.jpg'}],{alt:'x',compact:true});
  thumb.querySelector('img').dispatchEvent(new W.Event('error'));assert.match(thumb.textContent,/No image/);
});

test('archive sort, date and type buttons match Reddit\'s sort button: text and caret, no leading icon or menu icons',async()=>{
  const ctx=await boot();await open(ctx);
  const buttons=[...ctx.doc.querySelectorAll('.rt-sra-dropdown-button')];assert.equal(buttons.length,3);
  for(const b of buttons){assert.ok(b.classList.contains('button-plain') && b.classList.contains('button-small'));const icons=[...b.querySelectorAll('svg')];assert.equal(icons.length,1,'only the caret');assert.equal(icons[0].getAttribute('icon-name'),'caret-down');}
  const sortMenu=buttons[0].parentElement.querySelector('[data-rt-ui="subreddit-menu"]');assert.equal(sortMenu.querySelectorAll('[data-rt-ui="filter-option"] svg[icon-name="new"],[data-rt-ui="filter-option"] svg[icon-name="top"]').length,0,'sort rows carry no icons');
});

test('masthead matches Reddit’s no-banner geometry and leaves the title colour to Reddit’s token class',async()=>{
  const ctx=await boot({url:'https://www.reddit.com/r/gone/?rt_view=archive'});await tick();const {doc,W}=ctx;
  const style=doc.createElement('style');style.textContent=fs.readFileSync('extension/subreddit-archive.css','utf8');doc.head.append(style);
  const header=doc.querySelector('[data-rt-ui="archive-header"]'),banner=header.querySelector('.rt-sra-banner'),title=header.querySelector('h1');
  assert.equal(W.getComputedStyle(banner).height,'64px');assert.equal(W.getComputedStyle(header).paddingTop,'8px');assert.notEqual(W.getComputedStyle(banner).marginTop,'8px','gap stays inside the masthead');
  assert.equal(W.getComputedStyle(header.querySelector('.rt-sra-avatar')).height,'88px');
  // 8 + 64 + 88 - 36 = 124px like native r/Design: the row is lifted 36px over the band and gives the 36px back.
  assert.match(style.textContent,/@media \(min-width:640px\)\{\.rt-sra-header-row\{top:-36px;margin-top:0;margin-bottom:-36px\}\}/);
  assert.ok(title.classList.contains('text-neutral-content-strong'));
  assert.equal(W.getComputedStyle(title).color,W.getComputedStyle(doc.body).color,'our CSS does not override Reddit’s text-neutral-content-strong');
  assert.match(header.querySelector('[data-testid="subreddit-archive-state"]').textContent,/Banned · Archived posts/);
  ctx.sa.destroy();ctx.W.close();
});
test('notice action is content-sized on the row of Reddit’s own button',async()=>{
  const ctx=await boot(),{doc,W}=ctx,b=button(doc),slot=b.parentElement;
  const style=doc.createElement('style');style.textContent=fs.readFileSync('extension/subreddit-archive.css','utf8');doc.head.append(style);
  assert.equal(b.classList.contains('w-100'),false);assert.match(b.className,/button-medium/);assert.match(b.className,/button-secondary/);
  assert.equal(W.getComputedStyle(slot).marginTop,'0px');assert.equal(W.getComputedStyle(slot).width,'auto');assert.equal(W.getComputedStyle(b).width,'auto');
  ctx.sa.destroy();ctx.W.close();
});
test('feed sidebar shows native-style sections with loaded-post stats that grow and never claim completeness',async()=>{
  const first=[post('p1',1500000000,{author:'alice'}),post('p2',1490000000,{author:'bob'}),post('p3',1480000000,{author:'alice'}),post('p4',1470000000,{author:'[deleted]'}),post('p5',1460000000,{author:'AutoModerator'})];
  const ctx=await boot({url:'https://www.reddit.com/r/gone/?rt_view=archive',pages:()=>[{items:first,searchedBackTo:1460000000,hasMore:true,cursor:1459999999}]});await tick();const {doc}=ctx;
  const aside=doc.querySelector('aside#right-sidebar-container'),headings=[...aside.querySelectorAll('h2.rt-sra-sidebar-heading')].map(h=>h.textContent);
  assert.deepEqual(headings,['About this archive','Archive coverage','Most active posters']);
  for(const h of aside.querySelectorAll('h2.rt-sra-sidebar-heading'))assert.match(h.className,/uppercase/);
  assert.equal(aside.querySelector('.rt-sra-about-title').textContent,'r/gone');assert.match(aside.querySelector('.rt-sra-facts').textContent,/Banned/);
  assert.equal(aside.querySelector('[data-rt-ui="archive-about"] a').href,'https://arctic-shift.photon-reddit.com/');assert.match(aside.querySelector('[data-rt-ui="archive-about"]').textContent,/partial/);
  // Nothing invented: no created date or members without archive metadata.
  assert.doesNotMatch(aside.textContent,/Created|Members|members/);
  const coverage=aside.querySelector('[data-rt-ui="archive-coverage"]');
  assert.match(coverage.textContent,/5\s*Posts loaded/);assert.match(coverage.querySelector('[data-rt-ui="archive-coverage-range"]').textContent,/2016.*–.*2017/);assert.match(coverage.textContent,/Among loaded posts only/);
  assert.doesNotMatch(aside.textContent,/\bcomplete\b|\ball posts\b/i);
  const posters=[...aside.querySelectorAll('[data-rt-ui="archive-posters"] a.rt-sra-poster')];
  assert.deepEqual(posters.map(a=>a.getAttribute('href')),['/user/alice/','/user/bob/'],'deleted and AutoModerator are not ranked');
  assert.match(posters[0].textContent,/u\/alice\s*2 posts/);assert.match(aside.querySelector('[data-rt-ui="archive-posters"]').textContent,/among loaded posts/i);
  assert.deepEqual([...aside.querySelectorAll('[data-rt-ui="archive-legal"] a')].map(a=>a.textContent),['Reddit Rules','Privacy Policy','User Agreement','Accessibility']);
  // Paging grows the counts in place.
  ctx.W.RTArchiveQuery.search=async function*(){yield {items:[post('p6',1300000000,{author:'bob'}),post('p7',1290000000,{author:'bob'})],hasMore:false,cursor:null};};
  ctx.sa.loadMore();await tick();
  assert.match(coverage.textContent,/7\s*Posts loaded/);assert.match(coverage.textContent,/2010.*–.*2017/);assert.ok(coverage.isConnected,'updated in place');
  assert.deepEqual([...aside.querySelectorAll('a.rt-sra-poster')].map(a=>a.getAttribute('href')),['/user/bob/','/user/alice/']);
  ctx.sa.destroy();ctx.W.close();
});
test('feed sidebar reports an unreachable archive without counts and thread pages skip loaded-post sections',async()=>{
  const ctx=await boot({url:'https://www.reddit.com/r/gone/?rt_view=archive',pages:()=>{throw Error('Archive unavailable');}});await tick();
  assert.match(ctx.doc.querySelector('[data-rt-ui="archive-coverage"]').textContent,/could not be reached/);assert.doesNotMatch(ctx.doc.querySelector('aside').textContent,/Posts loaded/);
  ctx.sa.destroy();ctx.W.close();
  const thread=await boot({url:'https://www.reddit.com/r/gone/comments/abc12/title/',archive:async message=>message.action==='archive-ids'?{ok:true,posts:[post('abc12',1500000000)]}:{ok:true,posts:[],hasMore:false}});await tick();
  const aside=thread.doc.querySelector('aside');assert.ok(aside.querySelector('[data-rt-ui="archive-about"]'));assert.ok(aside.querySelector('[data-rt-ui="archive-legal"]'));
  assert.equal(aside.querySelector('[data-rt-ui="archive-coverage"]'),null);assert.equal(aside.querySelector('[data-rt-ui="archive-posters"]'),null);
  thread.sa.destroy();thread.W.close();
});
