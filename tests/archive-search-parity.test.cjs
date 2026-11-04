// Archive community search reads like Reddit's own search page: truthful sort label, media tiles,
// native unit metadata, a first screen of results before "Search older", and no width jump on tab switches.
// Synthetic records and markup only.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');

const now=Math.floor(Date.now()/1000),YEAR=365*86400;
const post=(id,created,extra={})=>({id,fullname:'t3_'+id,kind:'post',title:'Title '+id,body:'Body '+id,author:'alice',subreddit:'gone',created,score:1,comments:0,permalink:'/r/gone/comments/'+id+'/t/',media:[],postType:'text',...extra});
const comment=(id,created,extra={})=>({id,fullname:'t1_'+id,kind:'comment',title:'Thread',body:'Comment '+id,author:'alice',subreddit:'gone',created,score:1,comments:0,permalink:'/r/gone/comments/abc/t/'+id+'/',media:[],...extra});
const tick=async()=>{for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r));};
const sortMenu=q=>'<div class="sort-row"><faceplate-dropdown-menu><button aria-haspopup="true" aria-label="Sort by: Relevance"><span class="flex"><span>Relevance</span></span><svg></svg></button><faceplate-menu>'+
  [['relevance','Relevance'],['hot','Hot'],['top','Top'],['new','New'],['comments','Comment count']].map(([sort,label])=>'<a role="menuitem" href="/r/gone/search/?q='+q+'&sort='+sort+'"><span>'+label+'</span></a>').join('')+'</faceplate-menu></faceplate-dropdown-menu></div>';
const page=(q='x')=>'<header><reddit-search-large><input name="q"></reddit-search-large></header><faceplate-tabgroup id="search-results-page-tabgroup"><a slot="posts" href="?type=posts">Posts</a><a slot="comments" href="?type=comments">Comments</a><a slot="media" href="?type=media">Media</a></faceplate-tabgroup><main>'+sortMenu(q)+'<div class="scope"><div data-testid="search-scope-switcher">Show results from all of Reddit</div></div><div class="bg-neutral-background"><div data-testid="search-error-message">Native empty state</div></div></main><aside data-testid="search-results-sidebar"></aside>';

async function boot(o={}){
  const dom=new JSDOM('<!doctype html><body><shreddit-app></shreddit-app></body>',{url:'https://www.reddit.com/r/gone/',runScripts:'outside-only',pretendToBeVisual:true}),W=dom.window;
  for(const f of ['search-core.js','post-model.js','archive-view.js','post-discovery.js','feed-filters.js','subreddit-archive.js'])W.eval(fs.readFileSync('extension/'+f,'utf8'));
  const calls=[];
  if(o.send){W.eval(fs.readFileSync('extension/archive-query.js','utf8'));const Q=W.RTArchiveQuery;W.RTArchiveQuery={...Q,async subreddit(){throw Error('none');},search(options){calls.push(options);return Q.search({...options,send:o.send});}};}
  else W.RTArchiveQuery={
    async *search(options){calls.push(options);const list=o.pages?o.pages(options,calls.length):[{items:[post('a1',now-8*YEAR-1000),post('a2',now-3*3600)],searchedBackTo:now-8*YEAR,hasMore:false,cursor:null}];for(const item of list){if(typeof item==='function'){await item();continue;}yield item;}},
    async subreddit(){throw Object.assign(Error('not in archive'),{code:'not-found'});}
  };
  const sa=new W.RTSubredditArchive.SubredditArchive({observe:false,readSettings:async()=>({enabled:true}),getOwner:()=>'me',communityState:async()=>'banned',reddit:async()=>({rendered:true}),archive:async()=>({ok:true,posts:[]})});
  await sa.ready;return {W,doc:W.document,sa,calls};
}
// Reddit's SPA: a new route usually comes with a freshly rendered search page (replace=true).
const go=async(ctx,q,{type='posts',sort='relevance',t='all',replace=true}={})=>{
  if(replace)ctx.doc.querySelector('shreddit-app').innerHTML=page(q);
  ctx.W.history.pushState({},'','/r/gone/search/?'+new ctx.W.URLSearchParams({q,type,sort,t}));ctx.sa.scan();await tick();
};
const units=ctx=>[...ctx.doc.querySelectorAll('[data-rt-ui="archive-search-unit"]')];
const trigger=ctx=>ctx.doc.querySelector('faceplate-dropdown-menu button');
const row=(ctx,sort)=>ctx.doc.querySelector('faceplate-menu a[href*="sort='+sort+'"]');

test('sort control names the order actually shown; unrankable options are unavailable and restored on leaving',async()=>{
  const ctx=await boot();await go(ctx,'Title');
  assert.equal(trigger(ctx).textContent.trim(),'New','Relevance is shown newest first, so the control says New');
  assert.equal(trigger(ctx).getAttribute('aria-label'),'Sort by: New');assert.match(trigger(ctx).title,/can't sort by Relevance.*newest first/);
  assert.match(ctx.sa.search.notice.textContent,/newest first · The archive can't sort by Relevance/);
  for(const sort of ['relevance','hot']){assert.equal(row(ctx,sort).getAttribute('aria-disabled'),'true',sort);const click=new ctx.W.MouseEvent('click',{bubbles:true,cancelable:true});row(ctx,sort).dispatchEvent(click);assert.equal(click.defaultPrevented,true,sort);}
  for(const sort of ['top','new','comments'])assert.equal(row(ctx,sort).hasAttribute('aria-disabled'),false,sort+' stays available on posts');
  // Leaving the archive search returns Reddit's control untouched.
  ctx.W.history.pushState({},'','/r/live/');ctx.sa.scan();
  assert.equal(trigger(ctx).textContent.trim(),'Relevance');assert.equal(trigger(ctx).getAttribute('aria-label'),'Sort by: Relevance');assert.equal(trigger(ctx).hasAttribute('title'),false);
  assert.equal(row(ctx,'relevance').hasAttribute('aria-disabled'),false);const click=new ctx.W.MouseEvent('click',{bubbles:true,cancelable:true});row(ctx,'relevance').dispatchEvent(click);assert.equal(click.defaultPrevented,false);
});

test("leaving restores only labels that are still the archive's, never over Reddit's next render",async()=>{
  const ctx=await boot();await go(ctx,'Title');assert.equal(trigger(ctx).textContent.trim(),'New');
  // Reddit updates its own label for the next route before the archive search is replaced.
  trigger(ctx).querySelector('span span').firstChild.data='Top';trigger(ctx).setAttribute('aria-label','Sort by: Top');
  await go(ctx,'Title',{sort:'top',replace:false});
  assert.equal(trigger(ctx).textContent.trim(),'Top');assert.equal(trigger(ctx).getAttribute('aria-label'),'Sort by: Top');assert.equal(trigger(ctx).hasAttribute('data-rt-archive-sort'),false);
  assert.match(ctx.sa.search.notice.textContent,/among loaded results/);assert.equal(row(ctx,'relevance').getAttribute('aria-disabled'),'true','unrankable rows stay unavailable on every archive sort');
});

test('Hot is relabelled too; Top and Comment count keep their among-loaded-results notes',async()=>{
  const ctx=await boot();
  await go(ctx,'Title',{sort:'hot'});trigger(ctx).querySelector('span span').textContent='Hot';ctx.sa.scan();
  assert.equal(trigger(ctx).textContent.trim(),'New');assert.match(ctx.sa.search.notice.textContent,/can't sort by Hot/);
  await go(ctx,'Title',{sort:'top'});trigger(ctx).querySelector('span span').textContent='Top';ctx.sa.scan();
  assert.equal(trigger(ctx).textContent.trim(),'Top');assert.match(ctx.sa.search.notice.textContent,/sorted by votes among loaded results/);
  await go(ctx,'Title',{sort:'comments'});assert.match(ctx.sa.search.notice.textContent,/sorted by comments among loaded results/);
  // Comment search cannot rank by comment count: newest first, and the row is unavailable there.
  await go(ctx,'Comment',{type:'comments',sort:'comments'});assert.match(ctx.sa.search.notice.textContent,/can't sort by Comment count/);assert.equal(row(ctx,'comments').getAttribute('aria-disabled'),'true');
});

test('post units show relative time, no author, and a native-size thumbnail',async()=>{
  const ctx=await boot({pages:()=>[{items:[post('a1',now-8*YEAR-1000,{postType:'image',media:[{kind:'image',url:'https://i.redd.it/a.png'}]}),post('a2',now-3*3600)],hasMore:false,cursor:null}]});
  await go(ctx,'Title',{sort:'new'});const [first,second]=units(ctx);
  const time=first.querySelector('.rt-sra-unit-credit faceplate-timeago time');assert.equal(time.textContent,'8y ago');assert.equal(time.getAttribute('datetime'),new Date((now-8*YEAR-1000)*1000).toISOString());
  assert.equal(second.querySelector('faceplate-timeago time').textContent,'3h ago');
  assert.equal(first.querySelector('.rt-sra-unit-author'),null);assert.doesNotMatch(first.textContent,/u\/alice/);
  assert.equal(first.querySelector('.rt-sra-unit-thumb img').getAttribute('src'),'https://i.redd.it/a.png');
  const css=fs.readFileSync('extension/subreddit-archive.css','utf8');
  assert.match(css,/\.rt-sra-unit-thumb\{width:120px;height:90px;margin-top:4px;border-radius:8px\}/);assert.match(css,/\.rt-sra-unit\[data-testid="search-post-unit"\]\{align-items:flex-start\}/);
});

test('comment units carry a 24px default avatar beside the plain username',async()=>{
  const ctx=await boot({pages:()=>[{items:[comment('c1',now-2*86400),comment('c2',now-86400,{author:'[deleted]'})],hasMore:false,cursor:null}]});
  await go(ctx,'Comment',{type:'comments',sort:'new'});const [first,second]=units(ctx);
  const author=first.querySelector('.rt-sra-comment-box a.rt-sra-comment-author');assert.equal(author.getAttribute('href'),'/user/alice/');assert.equal(author.textContent,'alice');
  const img=author.querySelector('img');assert.match(img.src,/^https:\/\/www\.redditstatic\.com\/avatars\/defaults\/v2\/avatar_default_[0-7]\.png$/);assert.equal(img.width,24);
  // The same name always gets the same default avatar.
  const again=await boot({pages:()=>[{items:[comment('c9',now-60)],hasMore:false,cursor:null}]});await go(again,'Comment',{type:'comments',sort:'new'});
  assert.equal(units(again)[0].querySelector('.rt-sra-comment-author img').src,img.src);
  assert.equal(units(again)[0].querySelector('.rt-sra-comment-box faceplate-timeago time').textContent,'1m ago');
  assert.equal(second.querySelector('a.rt-sra-comment-author'),null,'deleted authors are not links');assert.ok(second.querySelector('span.rt-sra-comment-author img'));
});

test('media tab is a tile grid of media posts only, thumbnail first; other tabs stay rows',async()=>{
  const items=[post('img1',now-100,{postType:'image',media:[{kind:'image',url:'https://i.redd.it/one.png'}]}),post('vid1',now-200,{postType:'video',media:[{kind:'video',poster:'https://preview.redd.it/poster.jpg'}]}),
    post('txt1',now-300),post('nsfw1',now-400,{postType:'image',over18:true,media:[{kind:'image',url:'https://i.redd.it/n.png'}]})];
  const ctx=await boot({pages:()=>[{items,hasMore:false,cursor:null}]});
  await go(ctx,'Title',{type:'media',sort:'new'});
  const list=ctx.doc.querySelector('.rt-sra-result-list');assert.equal(list.classList.contains('rt-sra-media-grid'),true);assert.equal(list.querySelector('hr'),null);
  assert.deepEqual(units(ctx).map(n=>n.dataset.fullname),['t3_img1','t3_vid1','t3_nsfw1'],'text posts are not media');
  const [image,video,nsfw]=units(ctx);
  assert.equal(image.tagName,'A');assert.equal(image.getAttribute('href'),'/r/gone/comments/img1/t/');assert.equal(image.firstElementChild.className,'rt-sra-tile-media','thumbnail first');
  assert.equal(image.querySelector('.rt-sra-tile-media img').getAttribute('src'),'https://i.redd.it/one.png');assert.equal(video.querySelector('.rt-sra-tile-media img').getAttribute('src'),'https://preview.redd.it/poster.jpg');
  assert.equal(nsfw.querySelector('img'),null);assert.match(nsfw.querySelector('.rt-sra-tile-placeholder').textContent,/NSFW/);
  assert.match(image.querySelector('.rt-sra-tile-title').textContent,/Title img1/);
  await go(ctx,'Title',{type:'posts',sort:'new'});assert.equal(ctx.doc.querySelector('.rt-sra-result-list').classList.contains('rt-sra-media-grid'),false);assert.equal(units(ctx)[0].dataset.testid,'search-post-unit');
});

test('first search keeps scanning with the native halo until a screenful is loaded, then offers Search older',async()=>{
  let release;const gate=new Promise(r=>release=r);let n=0;
  const batch=()=>({items:Array.from({length:5},()=>{n++;return post('p'+n,now-n*60);}),hasMore:true,cursor:now-n*60});
  const ctx=await boot({pages:options=>options.cursor?[batch(),batch()]:[batch(),()=>gate,batch(),batch(),batch(),batch(),batch()]});
  await go(ctx,'Title',{sort:'new'});
  assert.equal(ctx.calls[0].maxPages,10);
  assert.equal(units(ctx).length,5,'results show as they arrive');assert.ok(ctx.doc.querySelector('.rt-sra-foot [data-rt-ui="archive-loading"] shreddit-loading'),'halo while scanning');
  assert.equal(ctx.doc.querySelector('[data-rt-more]'),null,'no Search older while still scanning');
  release();await tick();
  assert.equal(units(ctx).length,25,'stops at the first screenful');assert.equal(ctx.doc.querySelector('[data-rt-ui="archive-loading"]'),null);
  assert.ok(ctx.doc.querySelector('[data-rt-more]'));assert.equal(ctx.calls.length,1);
  ctx.doc.querySelector('[data-rt-more]').click();await tick();assert.equal(ctx.calls.length,2);assert.equal(ctx.calls[1].cursor,now-25*60);assert.equal(units(ctx).length,35);
});

test('once text search times out, later pages scan directly instead of timing out again',async()=>{
  for(const code of ['text-search-unavailable','timeout']){
    const wire=[];let next=now;
    const ctx=await boot({send:async message=>{wire.push(message);if(message.query)return {ok:false,code};
      const top=message.before ?? next;const posts=[0,1,2].map(i=>({id:'z'+(top-i),fullname:'t3_z'+(top-i),kind:'post',title:i===2?'other':'cats '+i,body:'',author:'alice',subreddit:'gone',created:top-i-1,score:0,comments:0,permalink:'/r/gone/comments/z/t/',media:[],postType:'text'}));
      return {ok:true,posts,hasMore:true,cursor:top-3};}});
    await go(ctx,'cats',{sort:'new'});
    assert.equal(wire.filter(m=>m.query).length,1,code);assert.equal(ctx.sa.searchState().textLocal,true);assert.equal(units(ctx).length,20,'two matches per scanned page, ten pages');
    assert.match(ctx.doc.querySelector('.rt-sra-searched').textContent,/Matched by scanning archived pages.*Results may be incomplete/);
    ctx.doc.querySelector('[data-rt-more]').click();await tick();await tick();
    assert.equal(wire.filter(m=>m.query).length,1,'no second text attempt');assert.equal(ctx.calls.at(-1).textLocal,true);assert.ok(units(ctx).length>20);
  }
});

test('a tab switch waits for Reddit to render the new page before placing results (no width jump)',async()=>{
  const ctx=await boot();await go(ctx,'Title',{sort:'new'});
  const oldMain=ctx.doc.querySelector('main');assert.ok(oldMain.querySelector('[data-rt-ui="archive-search"]'));
  // Route changes first; Reddit's page is still the posts page.
  await go(ctx,'Title',{type:'comments',sort:'new',replace:false});
  assert.equal(ctx.doc.querySelector('[data-rt-ui="archive-search"]'),null,'not drawn into the outgoing page');assert.equal(ctx.calls.at(-1).kind,'comment','loading already started');
  // Reddit renders the comments page: results are placed into it once.
  ctx.doc.querySelector('shreddit-app').innerHTML=page('Title');ctx.sa.scan();
  const host=ctx.doc.querySelector('[data-rt-ui="archive-search"]');assert.ok(host);assert.notEqual(host.closest('main'),oldMain);assert.equal(ctx.doc.querySelectorAll('[data-rt-ui="archive-search"]').length,1);
  // If Reddit keeps the same page element, results still appear after a short bound.
  await go(ctx,'Title',{type:'posts',sort:'new',replace:false});assert.equal(ctx.doc.querySelector('[data-rt-ui="archive-search"]'),null);
  await new Promise(r=>setTimeout(r,1100));assert.ok(ctx.doc.querySelector('main [data-rt-ui="archive-search"]'));assert.ok(units(ctx).length>0);
  // Another community (or a first visit) is placed at once.
  const fresh=await boot();await go(fresh,'Title');assert.ok(fresh.doc.querySelector('main [data-rt-ui="archive-search"]'));
});
