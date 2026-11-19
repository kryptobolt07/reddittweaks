// Smooth scrolling across Reddit (docs/smooth-feeds-sitewide-spec.md).
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const flush=async()=>{for(let i=0;i<6;i++)await new Promise(r=>setTimeout(r,0));};
function page(t,{path='/',html}={}){
 const feed='<shreddit-feed><article id="a1"><shreddit-post></shreddit-post><button id="b1">menu</button></article><hr><shreddit-ad-post id="ad"></shreddit-ad-post><article id="a2"></article></shreddit-feed>';
 const dom=new JSDOM('<!doctype html><body>'+(html ?? feed)+'</body>',{url:'https://www.reddit.com'+path,runScripts:'outside-only',pretendToBeVisual:true}),W=dom.window;t.after(()=>W.close());
 const io={observed:new Set(),callback:null};W.IntersectionObserver=class{constructor(cb,options){io.callback=cb;io.options=options;}observe(el){io.observed.add(el);}unobserve(el){io.observed.delete(el);}disconnect(){io.observed.clear();}};
 W.__rtSmoothScrollTest=true;W.eval(fs.readFileSync('extension/smooth-scroll.js','utf8'));
 const fire=(el,{intersecting=false,height=500}={})=>io.callback([{target:el,isIntersecting:intersecting,boundingClientRect:{height}}]);
 return {W,d:W.document,io,fire};
}
test('each page belongs to one sub-option; comment threads are off by default and the master switch rules them all',t=>{
 const {W}=page(t),{area,enabled}=W.RTSmoothScroll;
 const cases={'/':'home','/r/popular/':'home','/r/all/top/':'home','/r/pics/':'subreddits','/r/pics/new/':'subreddits','/r/pics/comments/abc/title/':'comments','/search/':'search','/r/pics/search/':'search','/user/someone/':'profiles','/user/someone/comments/':'profiles'};
 for(const [path,name] of Object.entries(cases))assert.equal(area(path),name,path);
 assert.equal(enabled({},'home'),true);assert.equal(enabled({},'comments'),false);assert.equal(enabled({smoothComments:true},'comments'),true);
 assert.equal(enabled({smoothFeeds:false,smoothHome:true},'home'),false);assert.equal(enabled({smoothSubreddits:false},'subreddits'),false);
});
test('posts and ads far off screen skip drawing at their measured height, come back near the screen, and never while focused',async t=>{
 const {W,d,io,fire}=page(t);const s=new W.RTSmoothScroll.Smooth({readSettings:async()=>({}),observe:false});await s.ready;
 assert.deepEqual([...io.observed].map(e=>e.id).sort(),['a1','a2','ad']);assert.equal(io.options.rootMargin,'200% 0px 200% 0px','two screens of margin');
 const a2=d.getElementById('a2');fire(a2,{height:640});assert.equal(a2.hasAttribute('data-rt-skip'),true);assert.equal(a2.style.containIntrinsicSize,'auto 640px');
 fire(a2,{intersecting:true});assert.equal(a2.hasAttribute('data-rt-skip'),false);
 d.getElementById('b1').focus();const a1=d.getElementById('a1');fire(a1);assert.equal(a1.hasAttribute('data-rt-skip'),false,'a unit holding focus stays drawn');
 assert.match(fs.readFileSync('extension/post-discovery.css','utf8'),/\[data-rt-smooth\]\[data-rt-skip\]\{content-visibility:hidden\}/);
});
test('new batches are picked up; the extension’s own profile feeds and UI are left to their own code; switching off clears everything',async t=>{
 const {W,d,io,fire}=page(t,{html:'<shreddit-feed data-rt-loading-owner="x"><article id="managed"></article></shreddit-feed><shreddit-feed id="native"></shreddit-feed><div data-rt-ui="x"><shreddit-feed><article id="ours"></article></shreddit-feed></div>'});
 const s=new W.RTSmoothScroll.Smooth({readSettings:async()=>({}),observe:false});await s.ready;assert.equal(io.observed.size,0);
 const batch=d.createElement('faceplate-batch');batch.innerHTML='<article id="n1"></article><article id="n2"></article>';d.getElementById('native').append(batch);
 s.pending.add(batch);s.flush();assert.deepEqual([...io.observed].map(e=>e.id).sort(),['n1','n2']);
 fire(d.getElementById('n1'));assert.equal(d.getElementById('n1').hasAttribute('data-rt-skip'),true);
 s.configure({smoothHome:false});assert.equal(io.observed.size,0);assert.equal(d.querySelector('[data-rt-skip],[data-rt-smooth]'),null,'switching the area off clears every skip');
});
test('comment threads (opt-in) skip top-level comments only; search results skip each result',async t=>{
 const html='<shreddit-comment-tree><section><shreddit-comment depth="0" id="c1"><shreddit-comment depth="1" id="c2"></shreddit-comment></shreddit-comment></section></shreddit-comment-tree>';
 const off=page(t,{path:'/r/pics/comments/abc/title/',html});const s1=new off.W.RTSmoothScroll.Smooth({readSettings:async()=>({}),observe:false});await s1.ready;assert.equal(off.io.observed.size,0,'off by default');
 const on=page(t,{path:'/r/pics/comments/abc/title/',html});const s2=new on.W.RTSmoothScroll.Smooth({readSettings:async()=>({smoothComments:true}),observe:false});await s2.ready;assert.deepEqual([...on.io.observed].map(e=>e.id),['c1']);
 const search=page(t,{path:'/search/',html:'<div data-testid="sdui-post-unit" id="r1"></div><div data-testid="sdui-post-unit" id="r2"></div>'});const s3=new search.W.RTSmoothScroll.Smooth({readSettings:async()=>({}),observe:false});await s3.ready;assert.deepEqual([...search.io.observed].map(e=>e.id),['r1','r2']);
});
test('lists the extension renders itself (profile search, archives) are smoothed too; bridge-owned feeds and nested cards are not doubled',async t=>{
 // Measured 2026-11-19: a profile search held 100 extension-rendered results on a 6,735 px page with none smoothed.
 const html='<main><section data-rt-ui="posts"><div><div data-rt-ui="activity-item" id="i1"><div class="rt-native-card" id="inner"></div></div><div class="rt-native-card" id="c2"></div></div></section>'+
  '<div data-rt-ui="archive-subreddit"><div class="rt-native-card" id="a1"></div></div><shreddit-feed data-rt-loading-owner="x"><div data-rt-ui="activity-item" id="owned"></div></shreddit-feed></main>';
 const {W,io,fire,d}=page(t,{path:'/user/someone/search/',html});const s=new W.RTSmoothScroll.Smooth({readSettings:async()=>({}),observe:false});await s.ready;
 assert.deepEqual([...io.observed].map(e=>e.id).sort(),['a1','c2','i1'],'extension items, not the card inside an item, not the bridge-owned feed');
 fire(d.getElementById('i1'),{height:420});assert.equal(d.getElementById('i1').hasAttribute('data-rt-skip'),true);
 const off=page(t,{path:'/user/someone/search/',html});const s2=new off.W.RTSmoothScroll.Smooth({readSettings:async()=>({smoothSearch:false}),observe:false});await s2.ready;assert.equal(off.io.observed.size,0,'the page’s option still governs');
});

test('phones keep eight screens drawn either way; a mouse keeps two',async t=>{
 for(const [coarse,margin] of [[true,'800%'],[false,'200%']]){
  const {W,io}=page(t);W.matchMedia=q=>({matches:coarse && /hover: none|pointer: coarse/.test(q)});
  const s=new W.RTSmoothScroll.Smooth({readSettings:async()=>({}),observe:false});await s.ready;
  assert.equal(io.options.rootMargin,margin+' 0px '+margin+' 0px');s.destroy();
 }
});
