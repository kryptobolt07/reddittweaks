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

test('archive scroll anchors keep the exact result count without scanning every card or sorting again',async t=>{
  const now=Math.floor(Date.now()/1000),rows=batch('anchor',35,now-86400+34*60);
  const ctx=await boot({url:'https://www.reddit.com/r/gone/?rt_view=archive&rt_top=1&rt_date=24h',pages:()=>[{items:rows,hasMore:false,cursor:null}]});
  t.after(()=>{ctx.sa.destroy();ctx.W.close();});
  // Refilter at the exact inclusive cutoff before sampling the scroll position.
  ctx.W.Date.now=()=>now*1000;
  ctx.sa.renderList();
  Object.defineProperty(ctx.W,'scrollY',{value:500});
  let reads=0;
  [...ctx.sa.listEl.children].forEach((node,index)=>{
    node.getBoundingClientRect=()=>{reads++;return {top:index*30-500,bottom:(index+1)*30-500};};
  });
  const state=ctx.sa.current(),initial=ctx.sa.visibleItems(state);
  ctx.sa.saveFeedAnchor();
  const saved=JSON.parse(ctx.W.sessionStorage.getItem(ctx.sa.feedAnchorKey()));
  assert.equal(reads<=5,true);
  assert.equal(saved.fullname,'t3_anchor19');
  assert.equal(saved.offset,70);
  assert.equal(saved.count,35);
  ctx.W.Date.now=()=>now*1000+500;
  ctx.sa.saveFeedAnchor();
  assert.equal(ctx.sa.visibleItems(state),initial);
  assert.equal(JSON.parse(ctx.W.sessionStorage.getItem(ctx.sa.feedAnchorKey())).at,saved.at);
  ctx.W.Date.now=()=>(now+1)*1000;
  ctx.sa.saveFeedAnchor();
  assert.equal(JSON.parse(ctx.W.sessionStorage.getItem(ctx.sa.feedAnchorKey())).count,34);
  assert.equal(ctx.sa.visibleItems(state)[0].fullname,initial[0].fullname);
});

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
  const sa=new W.RTSubredditArchive.SubredditArchive({autoRetries:0,observe:false,readSettings:async()=>({enabled:true}),getOwner:()=>'me',communityState:async()=>'banned',reddit:async()=>({rendered:true}),archive:archive || (async()=>({ok:true,posts:[]}))});
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

test('scrolling and paging retain every loaded native card without blank placeholders or reconnections',async t=>{
  const ctx=await boot({io:true,pages:()=>[{items:batch('p',100,1500000000),hasMore:false}]});t.after(()=>ctx.W.close());
  for(let i=0;i<3;i++)ctx.feedIO.fire([[ctx.sa.sentinel,true]]);
  const original=cards(ctx.doc);let disconnected=0;
  ctx.W.customElements.define('shreddit-post',class extends ctx.W.HTMLElement{disconnectedCallback(){disconnected++;}});
  assert.equal(ctx.cardIO,undefined,'no observer unloads native cards');
  ctx.sa.renderList();ctx.sa.renderList();
  assert.equal(ctx.doc.querySelectorAll('shreddit-post').length,100);assert.equal(disconnected,0);
  assert.equal(ctx.doc.querySelector('[data-rt-ui="archive-virtual"]'),null);
  assert.ok(original.every((node,i)=>node===cards(ctx.doc)[i] && node.isConnected));
});

test('initial and subsequent comment pages use one halo and scrolling instead of a load-more button',async t=>{
  const first=gated(),more=gated();let reads=0;
  const ctx=await boot({io:true,url:'https://www.reddit.com/r/gone/comments/abc12/title/',archive:async message=>{
    if(message.action==='archive-ids')return {ok:true,posts:[post('abc12',1500000000)]};
    if(++reads===1){await first.gate;return {ok:true,posts:[comment('c1',1500000001)],hasMore:true,cursor:1500000001};}
    await more.gate;return {ok:true,posts:[comment('c2',1500000000)],hasMore:false};
  }});t.after(()=>ctx.W.close());
  assert.ok(ctx.doc.querySelector('shreddit-post'));assert.equal(halos(ctx.doc).length,1);
  first.release();await tick();const original=ctx.doc.querySelector('shreddit-comment');
  assert.equal(ctx.doc.querySelector('[data-rt-more],.rt-sra-view-more,[data-rt-skeleton]'),null);
  ctx.feedIO.fire([[ctx.sa.sentinel,true]]);ctx.feedIO.fire([[ctx.sa.sentinel,true]]);
  assert.equal(reads,2,'concurrent sentinel events share the pending page');assert.equal(halos(ctx.doc).length,1);
  assert.equal(original.isConnected,true);assert.equal(ctx.doc.querySelector('.rt-sra-foot svg[icon-name="load"]'),null);
  more.release();await tick();assert.equal(ctx.doc.querySelectorAll('shreddit-comment').length,2);assert.equal(halos(ctx.doc).length,0);
});

test('a collapsed archived comment hides its replies',()=>{
  const W=new JSDOM('<!doctype html><body><section><shreddit-comment class="rt-sra-thread-comment" collapsed=""><shreddit-comment class="rt-sra-thread-comment" slot="children" id="child"></shreddit-comment></shreddit-comment><shreddit-comment class="rt-sra-thread-comment" id="open"><shreddit-comment class="rt-sra-thread-comment" slot="children" id="kept"></shreddit-comment></shreddit-comment></section></body>',{pretendToBeVisual:true}).window;
  const css=fs.readFileSync('extension/subreddit-archive.css','utf8');
  const rule=css.match(/\.rt-sra-thread-comment\[collapsed\]>\[slot\^="children"\]\{[^}]*\}/)[0];const style=W.document.createElement('style');style.textContent=rule;W.document.head.append(style);
  assert.equal(W.getComputedStyle(W.document.getElementById('child')).display,'none');assert.notEqual(W.getComputedStyle(W.document.getElementById('kept')).display,'none');
});

test('repeated thread cursors stop automatic paging, and empty advancing pages pause after three reads',async t=>{
  let reads=0;
  const stuck=await boot({io:true,url:'https://www.reddit.com/r/gone/comments/abc12/title/',archive:async message=>message.action==='archive-ids'?{ok:true,posts:[post('abc12',1500000000)]}:(reads++,{ok:true,posts:[comment('c1',1500000000)],hasMore:true,cursor:1499999999})});t.after(()=>stuck.W.close());
  stuck.feedIO.fire([[stuck.sa.sentinel,true]]);await tick();for(let i=0;i<5;i++)stuck.feedIO.fire([[stuck.sa.sentinel,true]]);await tick();
  assert.equal(reads,2);assert.match(stuck.sa.footEl.textContent,/stopped paging/);assert.equal(halos(stuck.doc).length,0);
  reads=0;const empty=await boot({io:true,url:'https://www.reddit.com/r/gone/comments/abc12/title/',archive:async message=>message.action==='archive-ids'?{ok:true,posts:[post('abc12',1500000000)]}:(reads++,{ok:true,posts:[],hasMore:true,cursor:1500000000-reads})});t.after(()=>empty.W.close());
  for(let i=0;i<8;i++){empty.feedIO.fire([[empty.sa.sentinel,true]]);await tick();}
  assert.equal(reads,3);assert.match(empty.sa.footEl.textContent,/three pages.*Retry/);assert.equal(halos(empty.doc).length,0);
  empty.doc.querySelector('[data-rt-retry]').click();await tick();assert.equal(reads,4,'only an explicit retry resumes an empty scan');
});
