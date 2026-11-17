const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
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
  for(const f of ['search-core.js','post-model.js','markdown-lite.js','archive-view.js','post-discovery.js','feed-filters.js','subreddit-archive.js'])W.eval(fs.readFileSync('extension/'+f,'utf8'));
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
  const sa=new W.RTSubredditArchive.SubredditArchive({autoRetries:o.autoRetries ?? 0,autoRetryWaits:o.autoRetryWaits || [0,0,0],observe:false,readSettings:async()=>({enabled:o.enabled,automatic:o.automatic}),getOwner:()=>o.owner,communityState:async()=>o.communityKind ?? 'banned',reddit:o.reddit || (async message=>{const target=W.document.getElementById(message.target);if(target)target.innerHTML='<flex-left-nav-container id="left-sidebar-container"><nav><a href="/">Home</a></nav></flex-left-nav-container>';return {rendered:true};}),archive:async message=>o.archive?o.archive(message):{ok:true,posts:[]}});
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
  W.chrome={runtime:{id:'x',sendMessage:async()=>({ok:true,settings:{postDiscovery:true,archiveDiscovery:true,subredditArchive:true}})}};
  W.eval(fs.readFileSync('extension/profile-notice.js','utf8'));
  const modal=W.document.querySelector('guard-community-modal');assert.equal(modal.style.display,'none');assert.equal(modal.getAttribute('data-rt-subreddit-hold'),'true');
  await tick();assert.equal(modal.style.display,'none','stays held once settings allow the archive');
  // Quarantined communities and a normal URL are never held.
  for(const [html,url] of [[quarantineHtml,'https://www.reddit.com/r/gone/?rt_view=archive'],[modalHtml('r/gone is banned'),'https://www.reddit.com/r/gone/']]){
    const d=new JSDOM('<!doctype html><body><shreddit-app>'+html+'</shreddit-app></body>',{url,runScripts:'outside-only'}).window;
    d.chrome={runtime:{id:'x',sendMessage:async()=>({ok:true,settings:{archiveDiscovery:true}})}};d.eval(fs.readFileSync('extension/profile-notice.js','utf8'));
    await tick();assert.equal(d.document.querySelector('guard-community-modal').style.display,'');d.close();
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
 assert.match(doc.querySelector('[data-testid="subreddit-archive-state"]').getAttribute('aria-label'),/banned.*archived posts/i);
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

test('NSFW archive items show Reddit\'s NSFW tag and blurred media behind a reveal button',async()=>{
  const ctx=await boot({url:'https://www.reddit.com/r/gone/?rt_view=archive',pages:()=>[{items:[post('n1',1500000000,{over18:true,postType:'image',media:[{kind:'image',url:'https://i.redd.it/x.png'}]})],searchedBackTo:1500000000,hasMore:false,cursor:null}]});await tick();
  const feed=ctx.doc.querySelector('shreddit-feed');assert.doesNotMatch(feed.textContent,/NSFW or spoiler snapshot/);
  {const tag=feed.querySelector('[slot="ssr-post-content-header"] .rt-archive-tag-nsfw');assert.equal(tag.textContent,'NSFW');assert.equal(tag.querySelector('svg').getAttribute('icon-name'),'nsfw-fill-12');const kids=[...tag.closest('shreddit-post').children];assert.ok(kids.indexOf(tag.closest('[slot]'))<kids.findIndex(n=>n.slot==='title'),'tags above the title');assert.ok(feed.querySelector('.rt-sensitive-media'),'media blur has the scrim variant');}
  const box=feed.querySelector('.rt-sensitive');assert.ok(box.querySelector('.rt-sensitive-content img[src*="i.redd.it"]'),'media kept, blurred');
  const reveal=box.querySelector('.rt-sensitive-reveal');assert.equal(reveal.textContent,'View NSFW content');reveal.click();assert.ok(box.classList.contains('rt-revealed'));assert.equal(box.querySelector('.rt-sensitive-reveal'),null);
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
 assert.equal(ctx.doc.querySelector('#t1_c2').parentElement.id,'t1_c1');assert.ok(ctx.doc.querySelector('#t1_c2').classList.contains('rt-sra-highlighted'));assert.ok(ctx.doc.querySelector('#t1_c2').hasAttribute('is-highlighted'));assert.equal(ctx.doc.querySelector('#t1_c1').hasAttribute('is-highlighted'),false);assert.equal(calls[1].focusId,'c2');assert.match(ctx.doc.querySelector('.rt-sra-foot').textContent,/Coverage may be partial/);
 assert.equal(ctx.doc.querySelectorAll('[data-rt-ui="archive-thread-comment"] [slot="commentMeta"] svg').length,0);assert.match(ctx.doc.querySelector('aside [data-rt-ui="archive-thread-notice"]').textContent,/Arctic Shift.*Coverage may be partial/);assert.equal(ctx.sa.statusTop.hidden,true);
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
  const state=header.querySelector('[data-testid="subreddit-archive-state"]');assert.equal(state.textContent,'');assert.equal(state.previousElementSibling,title);assert.ok(state.querySelector('svg'));assert.match(state.getAttribute('aria-label'),/banned.*archived posts/i);assert.equal(state.getAttribute('role'),'img');assert.equal(header.querySelector('.rt-sra-header-actions'),null);assert.equal(W.getComputedStyle(state).padding,'0px');assert.equal(W.getComputedStyle(state).width,'20px');
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

test('archived comment tree follows Reddit thresholds: top-level batch, a few replies with "N more replies", depth limit, focused chain shown',async()=>{
  const recs=[];for(let i=0;i<25;i++)recs.push(comment('top'+i,1500000000+i,{linkId:'abc12',parentId:'t3_abc12',score:100-i}));
  for(let i=0;i<6;i++)recs.push(comment('r'+i,1500001000+i,{linkId:'abc12',parentId:'t1_top0',score:10-i}));
  let parent='t1_top1';for(let d=1;d<=9;d++){recs.push(comment('d'+d,1500002000+d,{linkId:'abc12',parentId:parent,score:1}));parent='t1_d'+d;}
  const ctx=await boot({url:'https://www.reddit.com/r/gone/comments/abc12/title/',archive:async message=>message.action==='archive-ids'?{ok:true,posts:[post('abc12',1500000000)]}:{ok:true,posts:recs.map(r=>({...r,id:r.id,body:r.body,link_id:'t3_abc12',parent_id:r.parentId,created_utc:r.created,score:r.score,author:'alice',subreddit:'gone'}))}});
  for(let i=0;i<4;i++)await tick();
  const top=[...ctx.doc.querySelectorAll('.rt-sra-thread-comments > shreddit-comment[data-rt-ui="archive-thread-comment"]')];
  assert.equal(top.length,20,'top-level batch of 20');assert.equal(ctx.doc.querySelector('.rt-sra-view-more,[data-rt-more]'),null);ctx.sa.loadMoreThread();assert.equal(ctx.doc.querySelectorAll('.rt-sra-thread-comments > shreddit-comment').length,25);
  const top0=ctx.doc.getElementById('t1_top0'),shownReplies=[...top0.children].filter(c=>c.dataset.rtUi==='archive-thread-comment');
  assert.equal(shownReplies.length,3,'three replies under a top-level comment');assert.match([...top0.children].find(c=>c.dataset.rtUi==='archive-more-replies').textContent,/3 more replies/);
  assert.equal(ctx.doc.getElementById('t1_d7'),null,'nothing deeper than the depth limit is mounted');
  const link=ctx.doc.querySelector('a[data-rt-ui="archive-more-replies"]');assert.ok(link,'deep replies become a link');assert.match(link.getAttribute('href'),/\/comments\/abc12\/_\/d6\/$/);
  ctx.doc.querySelector('button[data-rt-ui="archive-more-replies"]').click();await new Promise(r=>ctx.W.requestAnimationFrame(r));await tick();
  assert.equal([...top0.children].filter(c=>c.dataset.rtUi==='archive-thread-comment').length,6,'more replies revealed in place');
});

test('automatic community mode mounts directly, manual mode waits, and disabling restores the native notice',async t=>{
  const auto=await boot({automatic:true});t.after(()=>auto.W.close());await tick();
  assert.ok(auto.doc.querySelector('[data-rt-ui="archive-subreddit"]'));assert.equal(auto.doc.querySelector('guard-community-modal').style.display,'none');
  auto.sa.readSettings=async()=>({enabled:false,automatic:true});await auto.sa.loadSettings();
  assert.equal(auto.doc.querySelector('[data-rt-ui="archive-subreddit"]'),null);assert.equal(auto.doc.querySelector('guard-community-modal').style.display,'');assert.equal(button(auto.doc),null);
  const manual=await boot();t.after(()=>manual.W.close());assert.ok(button(manual.doc));assert.equal(manual.doc.querySelector('[data-rt-ui="archive-subreddit"]'),null);
  const stale=await boot({automatic:true});t.after(()=>stale.W.close());stale.W.history.pushState({},'','/r/live/');stale.sa.scan();assert.equal(stale.doc.querySelector('[data-rt-ui="archive-subreddit"]'),null,'a retained gone-community modal cannot mount on another route');
});

test('collapsed native navigation preference sets the layout before asynchronous navigation arrives',async t=>{
  let release;const pending=new Promise(r=>release=r);
  const ctx=await boot({reddit:async()=>{await pending;return {rendered:true};}});t.after(()=>ctx.W.close());
  ctx.doc.cookie='hui_flex_nav_expanded_state=0; path=/';button(ctx.doc).click();
  assert.equal(ctx.sa.layout.classList.contains('flex-nav-collapsed'),true);assert.equal(ctx.sa.layout.classList.contains('flex-nav-expanded'),false);
  assert.ok(ctx.doc.querySelector('[data-rt-ui="community-navigation"] .left-sidebar .rt-nav-skeleton .rt-skeleton-line'),'a skeleton column, not blank space, while the navigation loads');
  release();await tick();assert.equal(ctx.sa.layout.classList.contains('flex-nav-collapsed'),true);
});

test('native comment slots, connected siblings and collapsed state survive rerenders and late high-score pages',async t=>{
  let page=0;
  const ctx=await boot({url:'https://www.reddit.com/r/gone/comments/abc12/title/',archive:async message=>message.action==='archive-ids'?{ok:true,posts:[post('abc12',1500000000)]}:++page===1?{ok:true,posts:[comment('p',1500000000,{linkId:'abc12',parentId:'t3_abc12'}),comment('r',1500000001,{linkId:'abc12',parentId:'t1_p'})],cursor:1499999999,hasMore:true}:{ok:true,posts:[comment('late',1400000000,{linkId:'abc12',parentId:'t3_abc12',score:999})],hasMore:false}});t.after(()=>ctx.W.close());await tick();
  const root=ctx.doc.getElementById('t1_p'),reply=ctx.doc.getElementById('t1_r');reply.slot='children-t1_p-0';root.setAttribute('collapsed','');let disconnects=0;
  ctx.W.customElements.define('shreddit-comment',class extends ctx.W.HTMLElement{disconnectedCallback(){disconnects++;}});
  ctx.sa.renderThread();assert.equal(reply.slot,'children-t1_p-0','retain slots assigned by Reddit updateChildren');
  ctx.sa.loadMoreThread();await tick();
  assert.equal(ctx.doc.querySelector('.rt-sra-thread-comments').firstElementChild,root);assert.equal(reply.parentElement,root);assert.equal(reply.slot,'children-t1_p-0');assert.equal(root.hasAttribute('collapsed'),true);assert.equal(disconnects,0);
});

test('worker-forwarded settings update the mounted reader when content-script storage events are unavailable',async t=>{
  const ctx=await boot();ctx.sa.destroy();t.after(()=>ctx.W.close());let enabled=true,listener;
  ctx.W.chrome={runtime:{onMessage:{addListener:fn=>listener=fn,removeListener:fn=>{if(listener===fn)listener=null;}}}};
  const sa=new ctx.W.RTSubredditArchive.SubredditArchive({readSettings:async()=>({enabled,automatic:true}),reddit:async()=>({rendered:true})});t.after(()=>sa.destroy());await sa.ready;await tick();assert.ok(ctx.doc.querySelector('[data-rt-ui="archive-subreddit"]'));
  enabled=false;listener({scope:'rt-posts',action:'settings-changed'});await tick();assert.equal(ctx.doc.querySelector('[data-rt-ui="archive-subreddit"]'),null);assert.equal(ctx.doc.querySelector('guard-community-modal').style.display,'');
  enabled=true;listener({scope:'rt-posts',action:'settings-changed'});await tick();assert.ok(ctx.doc.querySelector('[data-rt-ui="archive-subreddit"]'));sa.destroy();assert.equal(listener,null);
});

test('returning from a post to the archive feed reuses its loaded cards and restores the saved scroll position',async()=>{
  const ctx=await boot();await open(ctx);await tick();
  const before=[...ctx.doc.querySelectorAll('.rt-native-card')],searches=ctx.calls.length;assert.ok(before.length>0);
  let restored=null;ctx.sa.restoreFeedScroll=target=>{restored=target;};
  ctx.sa.feedScrollY=640;
  await goTo(ctx,'/r/gone/comments/abc12/title/');assert.ok(ctx.sa.mounted.thread,'post page mounted');
  ctx.sa.feedScrollY=0;// a scroll event during navigation must not overwrite the saved position (route is the post now)
  await goTo(ctx,'/r/gone/?rt_view=archive');
  const after=[...ctx.doc.querySelectorAll('.rt-native-card')];
  assert.equal(after.length,before.length);assert.ok(after.every((card,i)=>card===before[i]),'same card elements, no rebuild');
  assert.equal(ctx.calls.length,searches,'no new archive request');assert.equal(restored,640);
});

test('the feed scroll position is recorded on the plain community path (automatic archive, no rt_view) but not on a post',async()=>{
  const ctx=await boot();await open(ctx);await tick();
  ctx.W.history.replaceState({},'','/r/gone/');Object.defineProperty(ctx.W,'scrollY',{configurable:true,value:900});
  ctx.sa.onScroll();assert.equal(ctx.sa.feedScrollY,900,'recorded without rt_view');
  ctx.W.history.replaceState({},'','/r/gone/comments/abc12/title/');Object.defineProperty(ctx.W,'scrollY',{configurable:true,value:0});
  ctx.sa.onScroll();assert.equal(ctx.sa.feedScrollY,900,'navigation to a post does not overwrite it');
});

test('after a reload, Back to the archive feed restores the saved reading anchor from session storage',async()=>{
  const ctx=await boot({url:'https://www.reddit.com/r/gone/?rt_view=archive'});const {W}=ctx;
  W.performance.getEntriesByType=()=>[{type:'back_forward'}];
  const moves=[];W.scrollBy=(x,y)=>moves.push(y);
  // Re-mount as a fresh document would: forget memory, keep session storage.
  ctx.sa.unmount();ctx.sa.feedStash=null;ctx.sa.mountedBefore=false;
  W.sessionStorage.setItem(ctx.sa.feedAnchorKey(),JSON.stringify({fullname:'t3_a2',offset:-120,count:2,at:Date.now()}));
  ctx.sa.scan();await tick();await new Promise(r=>setTimeout(r,400));
  assert.ok(ctx.doc.querySelector('.rt-native-card[data-fullname="t3_a2"]'),'anchor card rendered');
  assert.ok(moves.includes(120),'scrolled the anchor card back to its saved offset');
  assert.equal(ctx.doc.querySelector('[data-rt-archive-feed]').style.visibility,'','feed shown again once placed');
});

test('reloading the archive feed itself starts fresh and clears the saved reading anchor',async()=>{
  const ctx=await boot({url:'https://www.reddit.com/r/gone/?rt_view=archive'});const {W}=ctx;
  W.performance.getEntriesByType=()=>[{type:'reload'}];const moves=[];W.scrollBy=(x,y)=>moves.push(y);
  ctx.sa.unmount();ctx.sa.feedStash=null;ctx.sa.mountedBefore=false;const key=ctx.sa.feedAnchorKey();
  W.sessionStorage.setItem(key,JSON.stringify({fullname:'t3_a2',offset:-120,count:2,at:Date.now()}));
  ctx.sa.scan();await tick();await new Promise(r=>setTimeout(r,300));
  assert.equal(moves.length,0,'no restore on reload');assert.equal(W.sessionStorage.getItem(key),null);
});

test('after reloading a post, an in-page Back to the feed entry restores the anchor even though the document type is reload',async()=>{
  const ctx=await boot({url:'https://www.reddit.com/r/gone/comments/abc12/title/'});const {W}=ctx;// document started on the post (reloaded)
  W.performance.getEntriesByType=()=>[{type:'reload'}];const moves=[];W.scrollBy=(x,y)=>moves.push(y);
  ctx.sa.unmount();W.history.pushState({},'','/r/gone/?rt_view=archive');
  W.sessionStorage.setItem(ctx.sa.feedAnchorKey(),JSON.stringify({fullname:'t3_a2',offset:-80,count:2,at:Date.now()}));
  ctx.sa.scan();await tick();await new Promise(r=>setTimeout(r,400));
  assert.ok(moves.includes(80),'restored on Back into the feed entry');
});

test('archive avatars switch from Reddit\'s default to the user\'s real picture from Reddit, only from Reddit image hosts',async()=>{
  const asked=[];const ctx=await boot({reddit:async message=>{
    if(message.action==='user-avatar'){asked.push(message.username);return {avatar:message.username==='alice'?'https://styles.redditmedia.com/t5_x/styles/profileIcon_abc.png':'https://evil.example/x.png'};}
    if(message.action==='render-navigation'){const t=ctx.doc.getElementById(message.target);if(t)t.innerHTML='<nav></nav>';return {rendered:true};}return {};}});
  await open(ctx);for(let i=0;i<4;i++)await tick();ctx.sa.watchAvatars();for(let i=0;i<4;i++)await tick();
  const img=ctx.doc.querySelector('.rt-native-card [slot="credit-bar"] img[data-rt-avatar-user]');
  assert.ok(img,'card avatar is marked with its user');assert.equal(img.src,'https://styles.redditmedia.com/t5_x/styles/profileIcon_abc.png');
  assert.equal(asked.filter(n=>n==='alice').length,1,'one lookup per user');
});

test('suspended or deleted authors get Reddit\'s small snoo-back avatar, not their profile artwork',async()=>{
  const ctx=await boot({reddit:async message=>message.action==='user-avatar'?{avatar:'https://www.redditstatic.com/shreddit/assets/suspended-snoo.png'}:{}});
  const img=ctx.doc.createElement('img');img.dataset.rtAvatarUser='gone';ctx.sa.resolveAvatar(img);for(let i=0;i<4;i++)await tick();
  assert.equal(img.src,'https://www.redditstatic.com/shreddit/assets/snoovatar-back-64x64px.png');assert.ok(img.classList.contains('rt-avatar-deleted'));assert.equal('rtAvatarReal' in img.dataset,false);
});

test('the archived post page header shows the poster\'s avatar, not the community icon',async()=>{
  const {W}=await boot();
  const post=W.RTPostDiscovery.archiveCard(archived(W,{id:'thr2',is_self:true,selftext:'Hi'}),{thread:true}).querySelector('shreddit-post');
  const img=post.querySelector('[slot="credit-bar"] .rt-archive-avatar img');assert.equal(img.dataset.rtAvatarUser,'alice');assert.match(img.src,/avatar_default_\d\.png$/);
});

test('the archived post page Back and Share controls are not swallowed by the snapshot action guard',async()=>{
  const {W,doc}=await boot();const card=W.RTPostDiscovery.archiveCard(archived(W,{id:'thr3',is_self:true,selftext:'Hi'}),{thread:true});doc.body.append(card);
  let shared=null;W.navigator.clipboard={writeText:async v=>{shared=v;}};
  card.querySelector('.rt-sra-share').click();await tick();assert.match(shared || '',/\/comments\/thr3\//,'Share copied the link');
});

test('temporary archive errors retry automatically before asking the reader, with a compact Retry pill',async()=>{
  let calls=0;const ctx=await boot({autoRetries:2,autoRetryWaits:[10,10],pages:()=>{calls++;return calls<=3?[Object.assign(Error('The archive query timed out.'),{code:'timeout'})]:[{items:[post('ok1',1500000000)],searchedBackTo:1500000000,hasMore:false,cursor:null}];}});
  await open(ctx);await tick();
  assert.match(ctx.doc.querySelector('.rt-sra-foot').textContent,/Retrying automatically/);assert.equal(ctx.doc.querySelector('[data-rt-retry]'),null,'no Retry button while retrying');
  for(let i=0;i<6;i++){await new Promise(r=>setTimeout(r,25));await tick();}
  const retry=ctx.doc.querySelector('[data-rt-retry]');assert.ok(retry,'Retry offered after the automatic attempts');assert.ok(retry.classList.contains('rt-sra-retry'));
  retry.click();for(let i=0;i<4;i++)await tick();assert.ok(ctx.doc.querySelector('.rt-native-card[data-fullname="t3_ok1"]'),'manual Retry loads');
});

test('deleted authors get Reddit\'s grey silhouette avatar and no profile lookup',async()=>{
  const {W}=await boot();
  const card=W.RTPostDiscovery.archiveCard(archived(W,{id:'del1',author:'[deleted]',is_self:true,selftext:'x'})).querySelector('shreddit-post');
  const img=card.querySelector('[slot="credit-bar"] img');assert.match(img.src,/snoovatar-back-64x64px\.png$/);assert.equal(img.dataset.rtAvatarUser,undefined);assert.ok(img.classList.contains('rt-avatar-img'));
});

test('archived threads offer Reddit\'s comment Sort by (Best/Top/New/Old) and Search Comments over loaded comments',async()=>{
  const recs=[comment('c1',1500000100,{linkId:'abc12',parentId:'t3_abc12',score:5,body:'apple pie'}),comment('c2',1500000200,{linkId:'abc12',parentId:'t3_abc12',score:50,body:'banana'}),comment('c3',1500000300,{linkId:'abc12',parentId:'t3_abc12',score:1,body:'cherry apple'})];
  const ctx=await boot({url:'https://www.reddit.com/r/gone/comments/abc12/title/',archive:async message=>message.action==='archive-ids'?{ok:true,posts:[post('abc12',1500000000)]}:{ok:true,posts:recs.map(r=>({...r,link_id:'t3_abc12',parent_id:r.parentId,created_utc:r.created,author:'alice',subreddit:'gone'}))}});
  for(let i=0;i<4;i++)await tick();
  const order=()=>[...ctx.doc.querySelectorAll('.rt-sra-thread-comments > shreddit-comment')].map(n=>n.id);
  assert.deepEqual(order(),['t1_c2','t1_c1','t1_c3'],'Best: by score');
  const bar=ctx.doc.querySelector('[data-rt-ui="archive-comment-toolbar"]');assert.match(bar.textContent,/Sort by:\s*Best/);
  const kids=[...bar.parentNode.children],postAt=kids.findIndex(n=>n.querySelector?.('.rt-sra-thread-post'));assert.ok(postAt>=0 && postAt<kids.indexOf(bar) && kids.indexOf(bar)<kids.indexOf(ctx.doc.querySelector('.rt-sra-thread-comments')),'post, then toolbar, then comments');
  bar.querySelector('.rt-sra-dropdown-button').click();[...bar.querySelectorAll('[data-rt-ui="filter-option"]')].find(o=>/New/.test(o.textContent)).click();await tick();
  assert.deepEqual(order(),['t1_c3','t1_c2','t1_c1'],'New: newest first');assert.match(bar.textContent,/Sort by:\s*New/);
  // Reddit's flow: an outlined button opens Reddit's own search box (Sort by hidden, Cancel shown); Enter searches; All Comments goes back.
  const expand=bar.querySelector('.rt-sra-cs-button'),form=bar.querySelector('.rt-sra-cs-form'),field=form.querySelector('faceplate-search-input.rt-sra-cs-field'),sortGroup=bar.querySelector('.rt-sra-comment-sort');
  assert.ok(field,'Reddit\'s faceplate-search-input');assert.equal(field.getAttribute('placeholder'),'Search Comments');assert.equal(form.hidden,true);assert.match(expand.textContent,/Search Comments/);
  expand.click();assert.equal(form.hidden,false);assert.equal(expand.hidden,true);assert.equal(sortGroup.hidden,true);assert.equal(expand.getAttribute('aria-expanded'),'true');
  const enter=()=>field.dispatchEvent(new ctx.W.KeyboardEvent('keydown',{key:'Enter',bubbles:true,composed:true,cancelable:true}));
  const run=async query=>{field.value=query;enter();await tick();return ctx.doc.querySelector('[data-rt-ui="archive-comment-results"]');};
  field.value='apple';field.dispatchEvent(new ctx.W.Event('input'));await tick();assert.equal(ctx.doc.querySelector('[data-rt-ui="archive-comment-results"]'),null,'typing alone doesn\'t search');
  let results=await run('apple');const hits=()=>[...results.querySelectorAll('[data-rt-ui="archive-comment-hit"]')];
  assert.equal(hits().length,2);assert.doesNotMatch(results.textContent,/of 3|match/,'no count line, like Reddit');assert.match(results.querySelector('.rt-sra-cs-back').textContent,/All Comments/);
  const hit=hits()[0];assert.match(hit.querySelector('.rt-sra-cs-link').getAttribute('href'),/\/r\/gone\/comments\/abc12\/_\/c\d\/$/);assert.match(hit.querySelector('.rt-sra-cs-hit-votes').textContent,/^\d+ votes?$/);assert.ok(hit.querySelector('faceplate-timeago[short]'));
  assert.ok(ctx.doc.querySelector('.rt-sra-thread-comments').hidden);assert.equal(new URLSearchParams(ctx.W.location.search).get('q'),'apple');assert.equal(new URLSearchParams(ctx.W.location.search).get('type'),'comments');
  assert.equal(form.hidden,false,'the box stays open with the query');
  // The shared query language, Reddit's no-results box, and the parser's messages for invalid queries.
  results=await run('apple -cherry');assert.equal(hits().length,1);results=await run('banana OR cherry');assert.equal(hits().length,2);
  results=await run('author:alice "apple pie"');assert.equal(hits().length,1);
  results=await run('zzz');assert.match(results.querySelector('[data-testid="search-no-results"]').textContent,/couldn’t find any results for “zzz”/);
  results=await run('apple OR');assert.match(results.textContent,/both sides of OR/);
  const textarea=ctx.doc.createElement('textarea');field.append(textarea);
  textarea.dispatchEvent(new ctx.W.KeyboardEvent('keydown',{key:'/',ctrlKey:true,bubbles:true,composed:true,cancelable:true}));
  const card=ctx.doc.querySelector('[data-rt-ui="search-tips"]');assert.ok(card,'Ctrl+/ opens tips');assert.ok(card.querySelector('[data-rt-tip="u/spez"]'));assert.equal(card.querySelector('[data-rt-tip="title:review"]'),null,'no title: for comments');
  card.querySelector('[data-rt-tip="laptop -gaming"]').click();assert.equal(textarea.value,'laptop -gaming');textarea.remove();
  await run('apple');ctx.doc.querySelector('.rt-sra-cs-back').click();await tick();
  assert.equal(ctx.doc.querySelector('.rt-sra-thread-comments').hidden,false);assert.equal(form.hidden,true);assert.equal(expand.hidden,false);assert.equal(sortGroup.hidden,false);assert.equal(new URLSearchParams(ctx.W.location.search).has('q'),false);
  // Escape in an empty box and Cancel close it without searching.
  expand.click();field.value='';field.dispatchEvent(new ctx.W.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));assert.equal(form.hidden,true);
  expand.click();field.value='typed';bar.querySelector('.rt-sra-cs-cancel').click();assert.equal(form.hidden,true);assert.equal(field.value,'');
});

test('images pasted into archived text posts render inline like Reddit, blurred when NSFW',async()=>{
  const {W}=await boot();
  const link='https://preview.redd.it/aaov9gk8f2of1.png?width=605&format=png&auto=webp&s=dc43';
  const meta={aaov9gk8f2of1:{e:'Image',m:'image/png',s:{u:link.replace(/&/g,'&amp;'),x:605,y:724}}};
  const safe=W.RTPostDiscovery.archiveCard(archived(W,{id:'img1',is_self:true,selftext:'Look:\n\n'+link+'\n\n',media_metadata:meta}),{thread:true}).querySelector('shreddit-post');
const img=safe.querySelector('[slot="text-body"] img');assert.ok(img,'inline image rendered');assert.equal(img.src,link);
  assert.doesNotMatch(safe.querySelector('[slot="text-body"]').textContent,/preview\.redd\.it/,'no raw link text');assert.match(safe.querySelector('[slot="text-body"]').textContent,/Look:/);
  const nsfw=W.RTPostDiscovery.archiveCard(archived(W,{id:'img2',is_self:true,over_18:true,selftext:link,media_metadata:meta}),{thread:true}).querySelector('shreddit-post');
  const box=nsfw.querySelector('[slot="text-body"] .rt-sensitive');assert.ok(box?.querySelector('img'),'NSFW image is blurred behind a reveal');assert.match(box.querySelector('.rt-sensitive-reveal').textContent,/View NSFW content/);
});

test('archived post flair renders as Reddit\'s grey pill below the title',async()=>{
  const {W}=await boot();
  const card=W.RTPostDiscovery.archiveCard(archived(W,{id:'fl1',is_self:true,selftext:'x',link_flair_text:'Autopsy',over_18:true})).querySelector('shreddit-post');
  const kids=[...card.children],flair=card.querySelector('[slot="post-flair"] .flair-content');assert.equal(flair.textContent,'Autopsy');assert.equal(flair.getAttribute('aria-label'),'Flair: Autopsy');
  assert.ok(kids.findIndex(n=>n.slot==='ssr-post-content-header')<kids.findIndex(n=>n.slot==='title') && kids.findIndex(n=>n.slot==='title')<kids.findIndex(n=>n.slot==='post-flair'),'NSFW row, title, flair');
});

test('clicking anywhere on blurred NSFW media reveals it instead of opening the post',async()=>{
  const ctx=await boot({url:'https://www.reddit.com/r/gone/?rt_view=archive',pages:()=>[{items:[post('n2',1500000000,{over18:true,postType:'image',media:[{kind:'image',url:'https://i.redd.it/y.png'}]})],searchedBackTo:1500000000,hasMore:false,cursor:null}]});await tick();
  const box=ctx.doc.querySelector('.rt-sensitive'),img=box.querySelector('img');let opened=0;box.closest('shreddit-post').addEventListener('click',()=>{opened++;});
  const click=new ctx.W.MouseEvent('click',{bubbles:true,cancelable:true,composed:true});img.dispatchEvent(click);
  assert.ok(box.classList.contains('rt-revealed'),'revealed');assert.ok(click.defaultPrevented,'no navigation');assert.equal(opened,0,'post click handlers not reached');
});

test('following a link out of an archived community never flashes Reddit\'s banned notice',async()=>{
  const ctx=await boot({url:'https://www.reddit.com/r/gone/?rt_view=archive',pages:()=>[{items:[post('a1',1500000000)],searchedBackTo:1500000000,hasMore:false,cursor:null}]});await tick();
  const modal=ctx.doc.querySelector('guard-community-modal');assert.ok(ctx.doc.querySelector('[data-rt-ui="archive-subreddit"]'),'archive mounted');
  // The URL changes first; Reddit replaces the stale notice only once the new page has loaded.
  ctx.W.history.pushState({},'','/r/elsewhere/comments/zz1/t/');ctx.sa.scan();await tick();
  assert.equal(ctx.doc.querySelector('[data-rt-ui="archive-subreddit"]'),null,'archive removed');
  assert.equal(modal.style.getPropertyValue('display'),'none','stale notice stays hidden');
  ctx.W.history.pushState({},'','/r/gone/');ctx.sa.scan();await tick();
  assert.ok(ctx.doc.querySelector('[data-rt-ui="archive-subreddit"]') || modal.style.getPropertyValue('display')!=='none','back on the community, archive or notice shows');
});

test('the comment toolbar appears with the post, never before it, and a permalink puts its thread first',async()=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const recs=[comment('a1',1500000100,{linkId:'abc12',parentId:'t3_abc12',score:90}),comment('b1',1500000200,{linkId:'abc12',parentId:'t3_abc12',score:5}),comment('b2',1500000300,{linkId:'abc12',parentId:'t1_b1',score:1}),comment('b3',1500000400,{linkId:'abc12',parentId:'t1_b1',score:50})];
  const ctx=await boot({url:'https://www.reddit.com/r/gone/comments/abc12/title/b2/',archive:async message=>{if(message.action==='archive-ids'){await gate;return {ok:true,posts:[post('abc12',1500000000)]};}return {ok:true,posts:recs.map(r=>({...r,link_id:'t3_abc12',parent_id:r.parentId,created_utc:r.created,author:'alice',subreddit:'gone'}))};}});
  for(let i=0;i<3;i++)await tick();
  assert.equal(ctx.doc.querySelector('[data-rt-ui="archive-comment-toolbar"]'),null,'no toolbar while the post is loading');
  release();for(let i=0;i<4;i++)await tick();
  const bar=ctx.doc.querySelector('[data-rt-ui="archive-comment-toolbar"]');assert.ok(bar);assert.ok(bar.previousElementSibling?.querySelector('.rt-sra-thread-post'),'toolbar directly after the post');
  const top=[...ctx.doc.querySelectorAll('.rt-sra-thread-comments > shreddit-comment')].map(n=>n.id);assert.equal(top[0],'t1_b1','the focused comment\'s thread comes first');
  const kids=[...ctx.doc.querySelector('#t1_b1').children].filter(n=>n.matches('shreddit-comment')).map(n=>n.id);assert.equal(kids[0],'t1_b2','then the focused comment');
  assert.ok(ctx.doc.querySelector('#t1_b2').classList.contains('rt-sra-highlighted'));
  ctx.sa.destroy();ctx.W.close();
});

test('archived comment hits fade only when the comment is cut off, and revealed spoilers in search rows pass clicks through',()=>{
  const js=fs.readFileSync(path.join(__dirname,'../extension/subreddit-archive.js'),'utf8');assert.match(js,/fade\.hidden=true;[^\n]*clipFade/);
  const css=fs.readFileSync(path.join(__dirname,'../extension/post-discovery.css'),'utf8');assert.match(css,/\.rt-search-unit \.rt-sensitive\.rt-revealed\{pointer-events:none\}/);
});
// Phones: profile search opens filters as Reddit's bottom sheet; the archive used small desktop popovers.
test('on phones archive menus open as bottom sheets with a title, close button and backdrop; desktop keeps popovers',async()=>{
 const ctx=await boot({url:'https://www.reddit.com/r/gone/?rt_view=archive'});await tick();const {sa,W,doc}=ctx;let phone=true;
 W.matchMedia=query=>({matches:/max-width/.test(query)?phone:false,media:query,addEventListener(){},removeEventListener(){}});
 sa.sortMenu.button.click();const menu=sa.sortMenu.menu;assert.equal(menu.hidden,false);assert.ok(menu.classList.contains('rt-sra-sheet'));
 assert.equal(menu.querySelector('.rt-inline-sheet-head').textContent,'Sort');const scrim=doc.querySelector('[data-rt-ui="subreddit-menu-scrim"]');assert.ok(scrim);
 menu.querySelector('.rt-inline-sheet-close').click();assert.equal(menu.hidden,true);assert.equal(doc.querySelector('[data-rt-ui="subreddit-menu-scrim"]'),null);
 sa.dateMenu.button.click();assert.equal(sa.dateMenu.menu.querySelector('.rt-inline-sheet-head').textContent,'Date');doc.querySelector('[data-rt-ui="subreddit-menu-scrim"]').click();assert.equal(sa.dateMenu.menu.hidden,true);
 sa.sortMenu.button.click();sa.menuRows.sort.get('old').click();await tick();assert.equal(sa.sortMenu.menu.hidden,true);assert.equal(doc.querySelector('[data-rt-ui="subreddit-menu-scrim"]'),null,'choosing closes the sheet');
 phone=false;sa.sortMenu.button.click();assert.equal(sa.sortMenu.menu.classList.contains('rt-sra-sheet'),false,'desktop popover');assert.equal(doc.querySelector('[data-rt-ui="subreddit-menu-scrim"]'),null);
 assert.match(fs.readFileSync('extension/subreddit-archive.css','utf8'),/\.rt-sra-menu\.rt-sra-sheet\{position:fixed/);
});
