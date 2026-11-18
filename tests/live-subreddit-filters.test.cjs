const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const read=name=>fs.readFileSync('extension/'+name,'utf8');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const stop='data-rt-community-filtered';
const card=(type,flair='')=>'<article><shreddit-post post-type="'+type+'"><span slot="post-flair">'+flair+'</span></shreddit-post></article><hr>';
const feed=()=>'<main><div><shreddit-sort-dropdown></shreddit-sort-dropdown></div><shreddit-feed reload-url="/svc/shreddit/community-more-posts/hot/?name=Example">'+card('video','News')+card('text','Q&A')+'<faceplate-partial slot="load-after"></faceplate-partial></shreddit-feed></main>';
function setup(t,path='/r/Example/',markup=feed()){
 const {window:W}=new JSDOM('<body>'+markup+'</body>',{url:'https://www.reddit.com'+path,runScripts:'outside-only'});
 for(const name of ['feed-filters.js','feed-sheet.js','live-subreddit-filters.js'])W.eval(read(name));
 const targets=[],api=W.RTLiveSubredditFilters;
 const controller=new api.Controller({navigate:url=>targets.push(String(url))});t.after(()=>{controller.destroy();W.close();});
 return {W,D:W.document,api,controller,targets};
}
test('only scoped live feed and search routes qualify',t=>{
 const {api,W}=setup(t);
 for(const path of ['/r/all/','/r/popular/','/r/Example/comments/id/title/','/user/Example/','/r/Example/wiki/'])assert.equal(api.route(new W.URL(path,W.location)),null);
 assert.equal(api.route(new W.URL('/r/Example/top/',W.location)).kind,'feed');
 assert.equal(api.route(new W.URL('/r/Example/search/',W.location)).kind,'search');
});
test('type filtering hides complete article/separator pairs and leaves native paging live',async t=>{
 const {W,D,controller}=setup(t,'/r/Example/?rt_type=video');
 assert.equal(D.querySelectorAll('article['+stop+']').length,1);
 assert.equal(D.querySelector('shreddit-post[post-type=text]').parentElement.nextElementSibling.hasAttribute(stop),true);
 const pager=D.querySelector('[slot=load-after]');
 assert.equal(pager.hasAttribute(stop),false);
 pager.insertAdjacentHTML('beforebegin','<faceplate-batch>'+card('image')+card('video')+'</faceplate-batch>');
 await flush();assert.equal(D.querySelector('faceplate-batch shreddit-post[post-type=image]').parentElement.hasAttribute(stop),true);
 assert.equal(D.querySelector('faceplate-batch shreddit-post[post-type=video]').parentElement.hasAttribute(stop),false);
 controller.applyTypes([]);assert.equal(D.querySelectorAll('['+stop+']').length,0);
 assert.equal(W.location.search,'');
});
test('Back and DOM replacements read the URL and never leave duplicate controls or hidden cards after opt-out',async t=>{
 const {W,D,controller}=setup(t,'/r/Example/?rt_type=video');
 D.querySelector('main').outerHTML=feed();await flush();
 assert.equal(D.querySelectorAll('[data-rt-ui=community-filters]').length,1);
 assert.equal(D.querySelectorAll('article['+stop+']').length,1);
 W.history.replaceState({},'','/r/Example/?rt_type=text');W.dispatchEvent(new W.PopStateEvent('popstate'));await flush();
 assert.equal(D.querySelector('shreddit-post[post-type=video]').parentElement.hasAttribute(stop),true);
 controller.setEnabled(false);
 assert.equal(D.querySelectorAll('['+stop+'],[data-rt-ui=community-filters]').length,0);
});
test('native flair feed and search destinations preserve independent filters and quote exact flair',t=>{
 const {api,W}=setup(t);
 const feedUrl=api.withFlair(new W.URL('/r/Example/new/?rt_type=image&t=week',W.location),'News & Q&A');
 assert.equal(feedUrl.pathname,'/r/Example/new/');
 assert.equal(feedUrl.searchParams.get('f'),'flair_name:"News & Q&A"');
 assert.equal(feedUrl.searchParams.get('rt_type'),'image');
 const search=api.searchUrl(new W.URL('/r/Example/?f=flair_name%3A%22News%22',W.location),'Example');
 assert.equal(search.searchParams.get('q'),'subreddit:Example flair:"News"');
 assert.equal(search.searchParams.get('type'),'posts');
 assert.equal(search.searchParams.get('sort'),'new');
 const typed=api.withFlair(new W.URL('/r/Example/search/?q=words+flair%3A%22News%22&t=week&sort=top&type=media',W.location),'Q&A');
 assert.equal(typed.searchParams.get('q'),'words flair:"Q&A"');
 assert.equal(typed.searchParams.get('t'),'week');assert.equal(typed.searchParams.get('sort'),'top');assert.equal(typed.searchParams.get('type'),'media');
 assert.equal(api.withFlair(typed,'').searchParams.get('q'),'words');
});
test('empty Enter opens scoped community search while typed, unscoped, and composing inputs retain native behavior',t=>{
 const {W,D,targets}=setup(t);
 const host=D.createElement('reddit-search-large');host.setAttribute('scope',JSON.stringify({type:'community',name:'Example',path:'/r/Example/'}));D.body.append(host);
 const root=host.attachShadow({mode:'open'});root.innerHTML='<form><input name="q"><span class="scoped-search-pill"></span></form>';
 const input=root.querySelector('input'),press=options=>input.dispatchEvent(new W.KeyboardEvent('keydown',{key:'Enter',bubbles:true,composed:true,cancelable:true,...options}));
 input.value='keywords';assert.equal(press(),true);input.value='';assert.equal(press({isComposing:true}),true);
 assert.equal(press(),false);assert.equal(new W.URL(targets[0]).searchParams.get('q'),'subreddit:Example');
 root.querySelector('.scoped-search-pill').remove();assert.equal(press(),true);assert.equal(targets.length,1);
});
test('shared controls offer native search sort, date, result scope and flair with no keyword',t=>{
 const {D,targets,W}=setup(t,'/r/Example/search/?q=subreddit%3AExample&type=posts&sort=new','<main><div slot="filters"></div><div data-testid="search-sdui-post"></div></main>');
 D.querySelector('[data-rt-community-options]').click();
 const labels=[...D.querySelectorAll('.rt-fsheet-group-title')].map(e=>e.textContent);
 assert.deepEqual(labels,['Sort','Date','Results']);
 [...D.querySelectorAll('.rt-fsheet-chip')].find(e=>e.textContent==='Past week').click();
 assert.equal(new W.URL(targets[0]).searchParams.get('t'),'week');
});
test('an empty media filter pauses repeated automatic continuations but can continue with Reddit’s loader',async t=>{
 const {D}=setup(t,'/r/Example/?rt_type=poll');
 for(let i=0;i<2;i++){
  D.querySelector('[slot=load-after]').outerHTML='<faceplate-batch>'+card('text')+'</faceplate-batch><faceplate-partial slot="load-after" src="/next/'+i+'"></faceplate-partial>';
  await flush();
 }
 const pager=D.querySelector('[slot=load-after]');
 assert.equal(pager.hasAttribute('data-rt-community-paused'),true);
 D.querySelector('[data-rt-community-continue]').click();
 assert.equal(pager.hasAttribute('data-rt-community-paused'),false);
});
test('search date filters exclude older native cards even when Reddit ignores the period for New',t=>{
 const recent=new Date(Date.now()-15*60e3).toISOString(),old=new Date(Date.now()-2*3600e3).toISOString();
 const results='<main><div slot="filters"></div><div data-testid="search-sdui-post" id="recent"><faceplate-timeago ts="'+recent+'"></faceplate-timeago></div><div data-testid="search-sdui-post" id="old"><time datetime="'+old+'"></time></div><div data-testid="search-sdui-post" id="unknown"></div></main>';
 const {D}=setup(t,'/r/Example/search/?q=subreddit%3AExample&sort=new&t=hour',results);
 assert.equal(D.querySelector('#recent').hasAttribute(stop),false);
 assert.equal(D.querySelector('#old').hasAttribute(stop),true);
 assert.equal(D.querySelector('#unknown').hasAttribute(stop),true);
});
test('native search tabs and sorting keep the independent time filter and restore native links on opt-out',t=>{
 const base='/r/Example/search/?q=subreddit%3AExample';
 const result='<main><div id="search-results-page-tabgroup"><a href="'+base+'&type=comments">Comments</a></div><search-sort-dropdown-menu><a href="'+base+'&type=posts&sort=top">Top</a></search-sort-dropdown-menu></main>';
 const {D,controller}=setup(t,base+'&type=posts&sort=new&t=week',result);
 const tab=D.querySelector('#search-results-page-tabgroup a'),sort=D.querySelector('search-sort-dropdown-menu a');
 assert.equal(new URL(tab.href).searchParams.get('sort'),'new');
 assert.equal(new URL(tab.href).searchParams.get('t'),'week');
 assert.equal(new URL(sort.href).searchParams.get('t'),'week');
 assert.equal(new URL(sort.href).searchParams.get('sort'),'top');
 controller.setEnabled(false);
 assert.equal(tab.getAttribute('href'),base+'&type=comments');
 assert.equal(sort.getAttribute('href'),base+'&type=posts&sort=top');
});
test('desktop community filters reuse the inline dropdown, type icons and applied pills',t=>{
 const {D}=setup(t,'/r/Example/?rt_type=video');
 assert.ok(D.querySelector('[data-rt-community-options].rt-search-inline-filter [icon-name="filter"]'));
 assert.ok(D.querySelector('[data-rt-ui="community-filters"] .rt-filter-chip[data-rt-chip="type-video"] [icon-name="video"]'));
 D.querySelector('[data-rt-community-options]').click();
 assert.ok(D.querySelector('.rt-community-sheet[data-rt-anchored] .rt-inline-menu'));
 assert.ok(D.querySelector('.rt-community-sheet .rt-fsheet-chip [icon-name="image"]'));
 D.querySelector('[aria-label="Remove filter Videos"].rt-filter-chip-remove').click();
 assert.equal(D.querySelectorAll('article['+stop+']').length,0);
});
