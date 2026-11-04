// Archive feed loading, paging and states: Reddit-sized pages, one halo per loading group,
// filter changes that drop stale work, bounded scans with explicit empty states, virtualized
// off-screen cards, and comment-page loading. Synthetic data only.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');

const modalHtml='<guard-community-modal subredditname="gone"><div slot="title">r/gone is banned</div></guard-community-modal>';
const post=(id,created,extra={})=>({id,fullname:'t3_'+id,kind:'post',title:'Title '+id,body:'Body '+id,author:'alice',subreddit:'gone',created,score:1,comments:0,permalink:'/r/gone/comments/'+id+'/t/',media:[],postType:'self',...extra});
const comment=(id,created,extra={})=>({id,fullname:'t1_'+id,kind:'comment',title:'Title',body:'Comment '+id,author:'alice',subreddit:'gone',created,score:1,comments:0,permalink:'/r/gone/comments/abc12/t/'+id+'/',media:[],linkId:'abc12',parentId:'t3_abc12',...extra});
const tick=async(n=6)=>{for(let i=0;i<n;i++)await new Promise(r=>setImmediate(r));};
// A page of `count` posts, newest first, starting at `from`.
const batch=(prefix,count,from,extra={})=>Array.from({length:count},(_,i)=>post(prefix+i,from-i*60,extra));

// Records every IntersectionObserver so tests can play the browser's part.
function fakeIO(W){
  const observers=[];
  W.IntersectionObserver=class{constructor(callback,options){this.callback=callback;this.options=options;this.targets=new Set();observers.push(this);}observe(t){this.targets.add(t);}unobserve(t){this.targets.delete(t);}disconnect(){this.targets.clear();}
    fire(entries){this.callback(entries.map(([target,isIntersecting])=>({target,isIntersecting})),this);}};
  return observers;
}
async function boot({url='https://www.reddit.com/r/gone/?rt_view=archive',pages,io=false,archive}={}){
  const dom=new JSDOM('<!doctype html><body><shreddit-app>'+modalHtml+'</shreddit-app></body>',{url,runScripts:'outside-only',pretendToBeVisual:true}),W=dom.window;
  for(const f of ['search-core.js','post-model.js','archive-view.js','post-discovery.js','feed-filters.js','subreddit-archive.js'])W.eval(fs.readFileSync('extension/'+f,'utf8'));
  const observers=io?fakeIO(W):null,calls=[];
  W.RTArchiveQuery={async *search(options){calls.push(options);for(const page of await pages(options,calls.length)){if(page instanceof Error)throw page;yield page;}},async subreddit(){throw Error('none');}};
  const sa=new W.RTSubredditArchive.SubredditArchive({observe:false,readSettings:async()=>({enabled:true}),getOwner:()=>'me',communityState:async()=>'banned',reddit:async()=>({rendered:true}),archive:archive || (async()=>({ok:true,posts:[]}))});
  await sa.ready;await tick();
  const feedIO=observers?.find(o=>o.options?.rootMargin==='800px 0px'),cardIO=observers?.find(o=>o.options?.rootMargin==='2000px 0px');
  return {W,doc:W.document,sa,calls,feedIO,cardIO};
}
const cards=doc=>[...doc.querySelectorAll('[data-rt-archive-feed]>[data-fullname]')];
const ids=doc=>cards(doc).map(node=>node.dataset.fullname);
const halos=doc=>doc.querySelectorAll('shreddit-loading');
const gated=()=>{let release;const gate=new Promise(r=>{release=r;});return {gate,release};};

test('the feed reveals Reddit-sized pages of 25 from one 100-post archive read',async()=>{
  const ctx=await boot({pages:()=>[{items:batch('p',100,1500000000),searchedBackTo:1490000000,hasMore:false,cursor:null}]});
  assert.equal(ctx.calls.length,1);assert.equal(cards(ctx.doc).length,25);
  assert.doesNotMatch(ctx.sa.footEl.textContent,/End of what the archive returned/,'no end note while pages wait');
  ctx.doc.querySelector('[data-rt-more]').click();assert.equal(cards(ctx.doc).length,50);
  ctx.sa.loadMore();ctx.sa.loadMore();assert.equal(cards(ctx.doc).length,100);assert.equal(ctx.calls.length,1,'revealing buffered pages makes no archive request');
  assert.equal(new Set(ids(ctx.doc)).size,100,'no card listed twice');
  assert.match(ctx.sa.footEl.textContent,/End of what the archive returned · Coverage may be partial/);assert.equal(ctx.doc.querySelector('[data-rt-more]'),null);
});

test('scrolling reveals the next page, keeps the halo at the end of the feed and prefetches before the buffer runs out',async()=>{
  const ctx=await boot({io:true,pages:options=>options.cursor?[{items:batch('q',100,1400000000),searchedBackTo:1390000000,hasMore:false,cursor:null}]:[{items:batch('p',100,1500000000),searchedBackTo:1490000000,hasMore:true,cursor:1490000000}]});
  assert.equal(cards(ctx.doc).length,25);assert.equal(halos(ctx.doc).length,1,'one halo while more pages are coming');
  assert.equal(ctx.doc.querySelector('[data-rt-more]'),null,'scrolling, not a button, pages the feed');
  const first=cards(ctx.doc)[0];
  for(let page=2;page<=3;page++){ctx.feedIO.fire([[ctx.sa.sentinel,true]]);assert.equal(cards(ctx.doc).length,page*25);}
  assert.equal(ctx.calls.length,1,'two pages are still buffered');
  ctx.feedIO.fire([[ctx.sa.sentinel,true]]);assert.equal(cards(ctx.doc).length,100);assert.equal(ctx.calls.length,2,'the next archive read starts before the buffer runs out');assert.equal(ctx.calls[1].cursor,1490000000);
  await tick();assert.equal(cards(ctx.doc)[0],first,'cards keep their identity across pages');
  ctx.feedIO.fire([[ctx.sa.sentinel,true]]);assert.equal(cards(ctx.doc).length,125);assert.equal(new Set(ids(ctx.doc)).size,125);
  for(let i=0;i<3;i++)ctx.feedIO.fire([[ctx.sa.sentinel,true]]);assert.equal(cards(ctx.doc).length,200);
  assert.equal(halos(ctx.doc).length,0,'no halo once everything is shown');assert.match(ctx.sa.footEl.textContent,/End of what the archive returned/);
});

test('clearing a filter drops the old scan: no stale cards and no error from the superseded request',async()=>{
  const old=gated();let first=true;
  const ctx=await boot({url:'https://www.reddit.com/r/gone/?rt_view=archive&rt_type=crosspost',pages:async options=>{
    if(first){first=false;await old.gate;return [{items:batch('old',100,1500000000),searchedBackTo:1490000000,hasMore:true,cursor:1490000000},Error('The archive query timed out.')];}
    return [{items:batch('new',100,1600000000),searchedBackTo:1590000000,hasMore:true,cursor:1590000000}];
  }});
  assert.equal(halos(ctx.doc).length,1);assert.match(ctx.sa.footEl.textContent,/Searching older archived posts for matches/,'an explicit scanning state');
  ctx.sa.applyFilters({...ctx.sa.filterState(),types:[]});await tick();
  assert.deepEqual(ids(ctx.doc),batch('new',25,1600000000).map(p=>p.fullname));
  old.release();await tick();
  assert.equal(ctx.doc.querySelector('.rt-sra-error'),null,'the superseded request cannot show its error');
  assert.equal(cards(ctx.doc).length,25);assert.ok(ids(ctx.doc).every(id=>id.startsWith('t3_new')),'its late results never land');
  assert.equal(ctx.sa.states.size,1,'only the active feed state is kept');
});

test('a filter change discards in-flight results, so filtered counts do not depend on the previous filter',async()=>{
  // Three archive pages; images on every page, one video on the second.
  const archive=options=>!options.cursor?[{items:[...batch('i1_',3,1500000000,{postType:'image'}),...batch('t1_',5,1499000000)],searchedBackTo:1490000000,hasMore:true,cursor:1490000000}]
    :options.cursor===1490000000?[{items:[post('v2',1480000000,{postType:'video'}),...batch('i2_',2,1479000000,{postType:'image'})],searchedBackTo:1470000000,hasMore:true,cursor:1470000000}]
    :[{items:[post('i3',1460000000,{postType:'image'})],searchedBackTo:1450000000,hasMore:false,cursor:null}];
  const direct=await boot({url:'https://www.reddit.com/r/gone/?rt_view=archive&rt_type=image',pages:archive});
  const expected=ids(direct.doc);assert.equal(expected.length,6,'the image scan reads every page it needs');
  // Arriving at Images after Videos had paged deeper gives the same list.
  const after=await boot({url:'https://www.reddit.com/r/gone/?rt_view=archive&rt_type=video',pages:archive});
  after.sa.loadMore();await tick();after.sa.loadMore();await tick();
  after.sa.applyFilters({...after.sa.filterState(),types:['image']});await tick(12);
  assert.deepEqual(ids(after.doc),expected);
  // A request still in flight for the previous filter never lands in the new one.
  const held=gated();let n=0;
  const late=await boot({url:'https://www.reddit.com/r/gone/?rt_view=archive&rt_type=video',pages:async options=>{if(++n===1){await held.gate;return [{items:[post('late',1600000000,{postType:'image'})],searchedBackTo:1590000000,hasMore:true,cursor:1590000000}];}return archive(options);}});
  late.sa.applyFilters({...late.sa.filterState(),types:['image']});await tick(12);
  held.release();await tick(12);
  assert.deepEqual(ids(late.doc),expected);assert.equal(late.doc.querySelector('[data-fullname="t3_late"]'),null);
});

test('a filter with no matches scans with the halo, then pauses on a clear empty state with the coverage date',async()=>{
  const ctx=await boot({io:true,url:'https://www.reddit.com/r/gone/?rt_view=archive&rt_type=crosspost',pages:(options,count)=>{const start=1500000000-(count-1)*86400;return [{items:batch('d'+count+'_',100,start),searchedBackTo:start-86400,hasMore:count<12,cursor:count<12?start-86400:null}];}});
  await tick(20);
  assert.equal(ctx.calls.length,8,'the scan is bounded');assert.equal(cards(ctx.doc).length,0);assert.equal(halos(ctx.doc).length,0,'no endless halo once paused');
  const empty=ctx.doc.querySelector('[data-rt-ui="archive-feed-empty"]');assert.ok(empty);assert.match(empty.textContent,/No archived posts match these filters/);
  assert.match(empty.textContent,/Searched the archive back to .*Older posts may still match/);
  ctx.feedIO.fire([[ctx.sa.sentinel,true]]);await tick();assert.equal(ctx.calls.length,8,'scrolling does not restart a paused scan');
  const older=ctx.doc.querySelector('[data-rt-more]');assert.equal(older.textContent,'Search older');older.click();
  assert.equal(halos(ctx.doc).length,1);assert.match(ctx.sa.footEl.textContent,/Searching older archived posts for matches/);
  await tick(20);assert.equal(ctx.calls.length,12);
  const done=ctx.doc.querySelector('[data-rt-ui="archive-feed-empty"]');assert.match(done.textContent,/The archive may not hold every record/);assert.doesNotMatch(done.textContent,/may still match/);
  assert.equal(ctx.doc.querySelector('[data-rt-more]'),null);assert.equal(halos(ctx.doc).length,0);
});

test('off-screen cards become same-height placeholders and come back as the same element',async()=>{
  const ctx=await boot({io:true,pages:()=>[{items:batch('p',100,1500000000),searchedBackTo:1490000000,hasMore:false,cursor:null}]});
  for(let i=0;i<3;i++)ctx.feedIO.fire([[ctx.sa.sentinel,true]]);assert.equal(cards(ctx.doc).length,100);
  const list=cards(ctx.doc);list.forEach((node,i)=>{node.getBoundingClientRect=()=>({top:i*300-20000,height:290,bottom:i*300-19710});});
  assert.ok(list.every(node=>ctx.cardIO.targets.has(node)),'every card is watched');
  const gone=list.slice(0,40);ctx.cardIO.fire(gone.map(node=>[node,false]));
  assert.equal(ctx.doc.querySelectorAll('shreddit-post').length,60,'far-away cards are unmounted');
  const holders=ctx.doc.querySelectorAll('[data-rt-ui="archive-virtual"]');assert.equal(holders.length,40);assert.equal(holders[0].style.height,'300px','the placeholder spans to the next row');
  assert.deepEqual(ids(ctx.doc),list.map(node=>node.dataset.fullname),'order and identity are kept');
  ctx.sa.renderList();assert.equal(ctx.doc.querySelectorAll('[data-rt-ui="archive-virtual"]').length,40,'a re-render keeps placeholders');assert.equal(new Set(ids(ctx.doc)).size,100);
  ctx.cardIO.fire([[holders[0],true]]);assert.equal(cards(ctx.doc)[0],list[0],'the original card returns');assert.equal(ctx.doc.querySelectorAll('shreddit-post').length,61);
  const focused=list[50];focused.querySelector('a').focus();ctx.cardIO.fire([[focused,false]]);assert.ok(focused.isConnected,'a card holding focus stays');
});

test('archived comments load under one halo; more comments use a small inline spinner',async()=>{
  const first=gated(),more=gated();let reads=0;
  const ctx=await boot({url:'https://www.reddit.com/r/gone/comments/abc12/title/',archive:async message=>{
    if(message.action==='archive-ids')return {ok:true,posts:[post('abc12',1500000000)]};
    if(++reads===1){await first.gate;return {ok:true,posts:[comment('c1',1500000001)],hasMore:true,cursor:1500000001};}
    await more.gate;return {ok:true,posts:[comment('c2',1500000002)],hasMore:false};
  }});
  assert.ok(ctx.doc.querySelector('shreddit-post'),'the post is shown while its comments load');
  assert.equal(halos(ctx.doc).length,1,'first load: one page halo');assert.equal(ctx.doc.querySelector('.rt-sra-foot faceplate-progress'),null);
  first.release();await tick();
  assert.equal(halos(ctx.doc).length,0);assert.equal(ctx.doc.querySelectorAll('shreddit-comment').length,1);
  ctx.doc.querySelector('[data-rt-more]').click();
  const button=ctx.doc.querySelector('[data-rt-more]');assert.equal(button.getAttribute('aria-busy'),'true');assert.equal(button.disabled,true);
  const spinner=button.querySelector('faceplate-progress');assert.equal(spinner.getAttribute('status'),'indeterminate');assert.equal(spinner.style.getPropertyValue('--loader-size'),'16px');
  assert.equal(halos(ctx.doc).length,0,'no page halo for nested paging');
  more.release();await tick();assert.equal(ctx.doc.querySelectorAll('shreddit-comment').length,2);assert.equal(ctx.doc.querySelector('[data-rt-more]'),null);
});

test('a collapsed archived comment hides its replies',()=>{
  const W=new JSDOM('<!doctype html><body><section><shreddit-comment class="rt-sra-thread-comment" collapsed=""><shreddit-comment class="rt-sra-thread-comment" slot="children" id="child"></shreddit-comment></shreddit-comment><shreddit-comment class="rt-sra-thread-comment" id="open"><shreddit-comment class="rt-sra-thread-comment" slot="children" id="kept"></shreddit-comment></shreddit-comment></section></body>',{pretendToBeVisual:true}).window;
  const css=fs.readFileSync('extension/subreddit-archive.css','utf8');
  const rule=css.match(/\.rt-sra-thread-comment\[collapsed\]>\[slot="children"\]\{[^}]*\}/)[0];const style=W.document.createElement('style');style.textContent=rule;W.document.head.append(style);
  assert.equal(W.getComputedStyle(W.document.getElementById('child')).display,'none');assert.notEqual(W.getComputedStyle(W.document.getElementById('kept')).display,'none');
});
