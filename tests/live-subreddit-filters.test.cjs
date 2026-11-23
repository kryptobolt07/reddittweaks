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
 for(const name of ['post-model.js','feed-filters.js','feed-sheet.js','live-subreddit-filters.js'])W.eval(read(name));
 const targets=[],api=W.RTLiveSubredditFilters;
 const controller=new api.Controller({navigate:url=>targets.push(String(url))});t.after(()=>{controller.destroy();W.close();});
 return {W,D:W.document,api,controller,targets};
}
test('only supported live feed and search routes qualify',t=>{
 const {api,W}=setup(t);
 for(const path of ['/r/all/search/','/r/popular/search/','/search/','/r/Example/comments/id/title/','/user/Example/','/r/Example/wiki/'])assert.equal(api.route(new W.URL(path,W.location)),null,path);
 for(const [path,surface,sort] of [['/','home',''],['/best/','home','best'],['/hot/','home','hot'],['/new/','home','new'],['/top/','home','top'],['/rising/','home','rising'],['/r/popular/','popular',''],['/r/popular/top/','popular','top'],['/r/all/','all',''],['/r/all/new/','all','new']]){
  const parsed=api.route(new W.URL(path,W.location));
  assert.deepEqual({...parsed},{surface,global:true,name:surface,sort,kind:'feed'},path);
 }
 const subFeed=api.route(new W.URL('/r/Example/top/',W.location));
 assert.equal(subFeed.kind,'feed');assert.equal(Boolean(subFeed.global),false);
 const subSearch=api.route(new W.URL('/r/Example/search/',W.location));
 assert.equal(subSearch.kind,'search');assert.equal(Boolean(subSearch.global),false);
});

const customPath='/user/Curator/m/MyFeed/';
const customFeed=()=>feed().replace('/svc/shreddit/community-more-posts/hot/?name=Example','/svc/shreddit/feeds/custom-feed?curator=Curator&amp;feedName=MyFeed&amp;sort=HOT')
 .replace('<div><shreddit-sort-dropdown></shreddit-sort-dropdown></div>','<div class="flex items-center"><shreddit-sort-dropdown sort-event="feed-sort-change"><span slot="selected-item">Hot</span><a href="'+customPath+'hot/">Hot</a><a href="'+customPath+'top/">Top</a><a href="/user/Other/m/MyFeed/new/">From the wrong feed</a></shreddit-sort-dropdown></div>');
test('a custom feed uses the same sort and post options scoped to the owner and feed name',t=>{
 const {D,W,targets,api}=setup(t,customPath+'?rt_type=video',customFeed());
 assert.equal(api.route(new W.URL('/user/Curator/m/',W.location)),null);
 assert.equal(D.querySelectorAll('article['+stop+']').length,1);
 D.querySelector('[data-rt-community-options]').click();
 D.querySelector('[aria-label="Sort"]').click();
 const menu=D.querySelector('.rt-community-feed-menu');
 assert.equal(menu.querySelector('[aria-label="From the wrong feed"]'),null);
 menu.querySelector('[aria-label="Top"]').click();assert.equal(targets.length,0);
 menu.querySelector('[aria-label="Today"]').click();
 const url=new URL(targets[0]);
 assert.equal(url.pathname,customPath+'top/');assert.equal(url.searchParams.get('t'),'day');assert.equal(url.searchParams.get('rt_type'),'video');
});
test('custom feed filters stay out of the mobile Feed and About tab rail',t=>{
 const markup=customFeed().replace('<div class="flex items-center">','<div class="flex items-center" id="native-tabs"><a>Feed</a><a>About</a>');
 const {D,W,controller}=setup(t,customPath+'?rt_type=video,image',markup);
 W.matchMedia=()=>({matches:true});controller.refresh();
 const rail=D.querySelector('#native-tabs'),bar=D.querySelector('.rt-community-controls'),chips=bar.querySelector('.rt-community-chips');
 assert.equal(rail.contains(bar),false);
 assert.equal(bar.nextElementSibling,D.querySelector('shreddit-feed'));
 assert.equal(chips.hasAttribute('data-rt-rail'),false);
 assert.equal(chips.hidden,false);
 W.matchMedia=()=>({matches:false});controller.refresh();
 assert.equal(bar.parentElement,rail,'desktop keeps the inline controls');
});
test('empty Enter opens the native custom-feed search and carries its active filters',t=>{
 const {D,W,targets}=setup(t,customPath+'?rt_nsfw=1',customFeed());
 const host=D.createElement('reddit-search-large');host.setAttribute('scope',JSON.stringify({type:'custom_feed',path:customPath}));D.body.prepend(host);
 const root=host.attachShadow({mode:'open'});root.innerHTML='<form><input name="q"><span class="scoped-search-pill"></span></form>';
 const input=root.querySelector('input');
 const enter=()=>input.dispatchEvent(new W.KeyboardEvent('keydown',{key:'Enter',bubbles:true,composed:true,cancelable:true}));
 input.value='ordinary query';assert.equal(enter(),true);assert.equal(targets.length,0);
 input.value='';assert.equal(enter(),false);
 const url=new URL(targets[0]);assert.equal(url.pathname,customPath+'search/');assert.equal(url.searchParams.get('q'),'nsfw:yes');
});
test('custom-feed Flair filters its native cards and stays applied when they are displayed in search',t=>{
 const {D,W,targets}=setup(t,customPath,customFeed());
 D.querySelector('[data-rt-community-options]').click();D.querySelector('[aria-label="Flair"]').click();
 D.querySelector('[data-rt-flair-row="News"]').click();
 assert.equal(targets.length,0,'custom feed flair applies to the existing native feed');
 assert.equal(new URL(W.location).searchParams.get('f'),'flair_name:"News"');
 assert.equal(D.querySelectorAll('article['+stop+']').length,1);
});
test('custom-feed search exposes the native result filters and clears only the selected flair',t=>{
 const {D,targets}=setup(t,customPath+'search/?q=flair%3A%22News%22&type=posts&sort=new&t=week',searchPage);
 assert.ok(D.querySelector('[data-rt-community-search="flair"]'));
 assert.ok(D.querySelector('[data-rt-community-search="date"]'));
 D.querySelector('[data-rt-chip-remove="flair"]').click();
 const url=new URL(targets[0]);
 assert.equal(url.pathname,customPath+'search/');assert.equal(url.searchParams.get('q'),'');
 assert.equal(url.searchParams.get('type'),'posts');assert.equal(url.searchParams.get('t'),'week');
});

const filteredFeedPath='/r/Example/?rt_type=video';
const filteredPostPath='/r/Example/comments/circus/circus_champion_tricks/';
const outgoing='data-rt-community-outgoing';
const arriving='data-rt-community-restoring';
function navigationFixture(t){
 const markup=feed().replace('<shreddit-post post-type="video">','<shreddit-post id="t3_circus" view-context="SubredditFeed" post-type="video"><a slot="title" href="'+filteredPostPath+'">Circus champion tricks</a>');
 const f=setup(t,filteredFeedPath,markup),{W,D}=f;
 let y=850,top=980;
 const frames=[];
 Object.defineProperty(W,'scrollY',{get:()=>y});
 W.scrollBy=({top:delta})=>{y+=delta;};
 W.scrollTo=({top:target})=>{y=target;};
 W.requestAnimationFrame=run=>frames.push(run);
 W.cancelAnimationFrame=()=>{};
 const original=D.querySelector('shreddit-feed'),article=D.querySelector('#t3_circus').closest('article');
 const measure=node=>{node.getBoundingClientRect=()=>({top:top-y,height:540});};
 measure(article);
 return {...f,article,original,measure,frames,setLayout:(value,now)=>{top=value;y=now;},
  route(path,{back=false}={}){
   W.history.pushState({},'',path);
   (back?W:D).dispatchEvent(new W.Event(back?'popstate':'reddit:route'));
  }};
}

test('opening a filtered post hides the outgoing feed and Back restores the clicked card offset',async t=>{
 const p=navigationFixture(t),{D,W,original,article}=p;
 const hidden=original.querySelector('article['+stop+']');
 const title=article.querySelector('a');title.addEventListener('click',event=>event.preventDefault());
 title.click();p.route(filteredPostPath);await flush();
 const css=D.createElement('style');css.textContent=read('post-discovery.css').split('\n').find(line=>line.includes('['+outgoing+']'));
 D.head.append(css);
 assert.equal(original.hasAttribute(outgoing),true);
 assert.equal(W.getComputedStyle(original).visibility,'hidden');
 assert.equal(hidden.hasAttribute(stop),true,'hidden posts never become visible in the outgoing feed');
 const detail=D.createElement('shreddit-post');detail.setAttribute('view-context','CommentsPage');
 original.replaceWith(detail);await flush();
 p.setLayout(1210,50);
 p.route(filteredFeedPath,{back:true});detail.replaceWith(original);await flush();
 assert.equal(article.getBoundingClientRect().top,130,'use the saved viewport offset after layout changes');
 assert.equal(original.hasAttribute(outgoing),false);
 assert.equal(hidden.hasAttribute(stop),true);
 for(let count=0;count<4&&p.frames.length;count++)p.frames.shift()();
 assert.equal(original.hasAttribute(arriving),false);
});

test('a video or YouTube player moving into the post keeps the filtered feed on screen behind it',async t=>{
 const p=navigationFixture(t),{D,original,article}=p;
 const hidden=original.querySelector('article['+stop+']');
 const title=article.querySelector('a');title.addEventListener('click',event=>event.preventDefault());
 D.documentElement.setAttribute('data-rt-media-moving','');
 title.click();p.route(filteredPostPath);await flush();
 assert.equal(original.hasAttribute(outgoing),false,'no blank page behind the moving video');
 assert.equal(hidden.hasAttribute(stop),true,'the feed stays filtered');
});
test('an in-place post swap releases the outgoing hold and input cancels Back correction',async t=>{
 const p=navigationFixture(t),{D,W,original,article}=p;
 const title=article.querySelector('a');title.addEventListener('click',event=>event.preventDefault());
 title.click();p.route(filteredPostPath);await flush();
 const oldNodes=[...original.childNodes];
 original.innerHTML='<shreddit-post id="t3_circus" view-context="CommentsPage"></shreddit-post>';
 await flush();
 assert.equal(original.hasAttribute(outgoing),false,'the incoming detail can paint inside a reused container');
 original.replaceChildren(...oldNodes);p.setLayout(1210,0);
 p.route(filteredFeedPath,{back:true});await flush();
 assert.equal(original.hasAttribute(arriving),true);
 W.dispatchEvent(new W.Event('wheel'));
 assert.equal(original.hasAttribute(arriving),false);
 p.setLayout(1350,200);
 for(let count=0;count<4&&p.frames.length;count++)p.frames.shift()();
 assert.equal(W.scrollY,200,'the reader owns scrolling again');
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
test('a Videos filter keeps external video links and removes promoted units',async t=>{
 const external='<article><shreddit-post post-type="link" domain="youtube.com" content-href="https://youtube.com/shorts/abc"></shreddit-post></article><hr>';
 const ad='<article><shreddit-ad-post></shreddit-ad-post></article><hr>';
 const markup='<main><shreddit-feed>'+external+card('text')+ad+'<faceplate-partial slot="load-after"></faceplate-partial></shreddit-feed></main>';
 const {D}=setup(t,'/r/Example/?rt_type=video',markup);
 const [youtube,,promoted]=D.querySelectorAll('article');
 assert.equal(youtube.hasAttribute(stop),false);
 assert.equal(D.querySelector('shreddit-post[post-type=text]').parentElement.hasAttribute(stop),true);
 assert.equal(promoted.hasAttribute(stop),true);
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
const searchPage = '<main><div slot="filters"><div class="flex items-center"><search-sort-dropdown-menu></search-sort-dropdown-menu></div></div><div id="search-results-page-tabgroup"></div><div data-testid="search-sdui-post"></div></main>';
test('search filters join Reddit’s existing control row and date opens its own menu on both layouts',t=>{
 for(const phone of [false,true]){
  const {D,targets,W}=setup(t,'/r/Example/search/?q=subreddit%3AExample&type=posts&sort=new',searchPage);
  W.matchMedia=()=>({matches:phone});
  const bar=D.querySelector('[data-rt-ui="community-filters"]');
  assert.equal(bar.parentElement,D.querySelector('search-sort-dropdown-menu').parentElement);
  assert.deepEqual([...bar.querySelectorAll('button:not([hidden])')].map(e=>e.textContent),['Date','Flair']);
  bar.querySelector('[data-rt-community-search="date"]').click();
  const menu=D.querySelector('[data-rt-ui="community-filter-menu"]');
  assert.equal(menu.classList.contains('rt-inline-sheet'),phone);
  assert.equal(menu.querySelector('[aria-checked=true]').textContent,'All time');
  [...menu.querySelectorAll('[role=menuitemradio]')].find(e=>e.textContent==='Past week').click();
  assert.equal(new W.URL(targets[0]).searchParams.get('t'),'week');
 }
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
test('desktop community feed options uses current-value rows and drill-ins, rather than phone chips',t=>{
 const {D}=setup(t,'/r/Example/?rt_type=video');
 assert.ok(D.querySelector('[data-rt-community-options] [icon-name="filter"]'));
 assert.ok(D.querySelector('[data-rt-ui="community-filters"] .rt-filter-chip[data-rt-chip="type-video"] [icon-name="video"]'));
 D.querySelector('[data-rt-community-options]').click();
 const menu=D.querySelector('[data-rt-feed-options]');
 const type=menu.querySelector('[aria-label="Post type"]');
 assert.equal(type.querySelector('[data-rt-menu-value]').textContent,'Videos');
 assert.ok(type.querySelector('[icon-name="chevron-right"]'));
 assert.equal(menu.querySelector('.rt-fsheet-chip'),null);
 type.click();
 assert.ok(menu.querySelector('[data-rt-sub-back]'));
 assert.equal(menu.querySelector('[aria-label="Videos"]').getAttribute('aria-checked'),'true');
 menu.querySelector('[aria-label="Images"]').click();
 assert.equal(menu.querySelector('[aria-label="Images"]').getAttribute('aria-checked'),'true');
 menu.querySelector('[data-rt-sub-back]').click();
 assert.equal(menu.querySelector('[aria-label="Post type"] [data-rt-menu-value]').textContent,'2 types');
});
test('phone community feed options keeps the type choices on the Post type page',t=>{
 const {D,W}=setup(t);
 W.matchMedia=()=>({matches:true,addEventListener(){},removeEventListener(){}});
 D.querySelector('[data-rt-community-options]').click();
 const rows=()=>[...D.querySelectorAll('.rt-community-sheet .rt-fsheet-row')];
 assert.deepEqual(rows().map(row=>row.querySelector('.rt-fsheet-label').textContent),['Post type','Flair'],'one row per option, values one level down');
 assert.equal(rows()[0].querySelector('.rt-fsheet-sub').textContent,'All types');
 assert.equal(D.querySelector('.rt-community-sheet [aria-pressed]'),null);
 rows()[0].click();
 assert.equal(D.querySelector('.rt-community-sheet .rt-fsheet-title').textContent,'Post type');
 assert.ok(D.querySelector('.rt-community-sheet .rt-fsheet-row [icon-name="image"]'));
 assert.equal(D.querySelector('.rt-community-sheet .rt-fsheet-row [icon-name="show"]'),null,'All types carries no unrelated icon');
 assert.equal(D.querySelector('[data-rt-feed-options]'),null);
});
const flairDirectory='<aside><a href="/r/Example/?f=flair_name%3A%22News%22"><span class="bg-tone-4 text-global-white" style="background-color:#23507f"><span class="flair-content" aria-label="Flair: News"><img class="flair-image" alt="" src="https://emoji.redditmedia.com/sample/Example/sparkle">News</span></span></a><a href="/r/Other/?f=flair_name%3A%22Other%22"><span class="flair-content">Other</span></a></aside>';
test('desktop Flair uses the native community pill and a distinct tag icon',t=>{
 const markup=feed().replace('>News</span>','><span style="background-color:#d05020"><span class="flair-content">News</span></span></span>')+flairDirectory;
 const {D,targets}=setup(t,'/r/Example/?rt_type=video',markup);
 D.querySelector('[data-rt-community-options]').click();
 const row=D.querySelector('[aria-label="Flair"]');
 assert.ok(row.querySelector('[icon-name="tag"]'));row.click();
 const option=D.querySelector('[data-rt-flair-row="News"]'),badge=option.querySelector('.flair-content');
 assert.equal(badge.parentElement.style.backgroundColor,'rgb(35, 80, 127)');
 assert.ok(badge.parentElement.classList.contains('text-global-white'));
 assert.equal(badge.querySelector('img').src,'https://emoji.redditmedia.com/sample/Example/sparkle');
 assert.equal(option.textContent.trim(),'News');assert.equal(option.querySelector('a'),null);
 assert.equal(D.querySelector('[data-rt-flair-row="Other"]'),null);
 option.click();const url=new URL(targets.at(-1));assert.equal(url.searchParams.get('f'),'flair_name:"News"');assert.equal(url.searchParams.get('rt_type'),'video');
});
test('the phone Flair page and search reuse observed community styling across navigation',t=>{
 const {D,W,controller}=setup(t,'/r/Example/',feed()+flairDirectory);
 W.matchMedia=()=>({matches:true,addEventListener(){},removeEventListener(){}});
 D.querySelector('[data-rt-community-options]').click();
 const row=[...D.querySelectorAll('.rt-fsheet-row')].find(element=>element.querySelector('.rt-fsheet-label')?.textContent==='Flair');
 assert.ok(row.querySelector('[icon-name="tag"]'));row.click();
 assert.ok(D.querySelector('.rt-community-sheet [data-rt-flair-row="News"] .flair-content'));
 controller.destroy();
 D.querySelector('aside').remove();
 D.querySelector('main').outerHTML=searchPage;
 W.history.pushState({},'','/r/Example/search/?q=subreddit%3AExample');
 const search=new W.RTLiveSubredditFilters.Controller();
 try {
  D.querySelector('[data-rt-community-search="flair"]').click();
  assert.equal(D.querySelector('[data-rt-flair-row="News"] .flair-content').parentElement.style.backgroundColor,'rgb(35, 80, 127)');
  assert.equal(D.querySelector('[data-rt-flair-row="Q&A"] .flair-content'),null,'plain cached labels remain usable');
 } finally {search.destroy();}
});
test('Flair can narrow the feed to Reddit’s NSFW tag without removing the community flair or type',t=>{
 const markup=feed().replace('post-type="video"','post-type="video" nsfw').replace('</shreddit-feed>',card('video','SFW')+card('image','NSFW').replace('post-type="image"','post-type="image" nsfw')+'</shreddit-feed>');
 const {D,W}=setup(t,'/r/Example/?f=flair_name%3A%22News%22&rt_type=video',markup);
 D.querySelector('[data-rt-community-options]').click();
 D.querySelector('[aria-label="Flair"]').click();
 const row=D.querySelector('[aria-label="NSFW"]');
 assert.ok(row.querySelector('[icon-name="nsfw-fill-12"]'));
 assert.equal(row.getAttribute('role'),'menuitemcheckbox');
 row.click();
 const filtered=()=>[...D.querySelectorAll('article:not([data-rt-community-filtered]) shreddit-post')].map(p=>p.getAttribute('post-type')+p.hasAttribute('nsfw'));
 assert.deepEqual(filtered(),['videotrue']);
 let url=new URL(W.location);assert.equal(url.searchParams.get('rt_nsfw'),'1');
 D.querySelector('[data-rt-chip-remove="nsfw"]').click();
 url=new URL(W.location);assert.equal(url.searchParams.has('rt_nsfw'),false);
 assert.equal(url.searchParams.get('f'),'flair_name:"News"');assert.equal(url.searchParams.get('rt_type'),'video');
 assert.deepEqual(filtered(),['videotrue','videofalse']);
});
test('scoped search NSFW uses Reddit’s query operator without changing Safe Search',t=>{
 const {D,targets}=setup(t,'/r/Example/search/?q=words+flair%3A%22News%22&type=posts&sort=top&t=week&include_over_18=off',searchPage);
 D.querySelector('[data-rt-community-search="flair"]').click();
 D.querySelector('[aria-label="NSFW"]').click();
 const url=new URL(targets.at(-1));
 assert.equal(url.searchParams.get('q'),'words nsfw:yes flair:"News"');
 assert.equal(url.searchParams.get('include_over_18'),'off');assert.equal(url.searchParams.get('t'),'week');
});
test('applied emoji-only flair keeps its native pill in the chip and menu summaries',t=>{
 const name=':ME1::ME2::ME3:',path='/r/Example/?f='+encodeURIComponent('flair_name:'+JSON.stringify(name));
 const images=['ME1','ME2','ME3'].map(value=>'<img class="flair-image" alt=":'+value+':" src="https://emoji.redditmedia.com/example/'+value+'">').join('');
 const native='<aside><a href="'+path+'"><span class="text-global-white" style="background-color:#882266"><span class="flair-content">'+images+'</span></span></a></aside>';
 const {D,W}=setup(t,path,feed()+native);
 const chip=D.querySelector('[data-rt-chip="flair"]');
 assert.equal(chip.querySelectorAll('.flair-content img').length,3);assert.doesNotMatch(chip.textContent,/ME1/);
 D.querySelector('[data-rt-community-options]').click();
 assert.equal(D.querySelector('[aria-label="Flair"] [data-rt-menu-value]').querySelectorAll('img').length,3);
 D.querySelector('[data-rt-community-options]').click();
 W.matchMedia=()=>({matches:true,addEventListener(){},removeEventListener(){}});
 D.querySelector('[data-rt-community-options]').click();
 const mobile=[...D.querySelectorAll('.rt-fsheet-row')].find(row=>row.querySelector('.rt-fsheet-label')?.textContent==='Flair');
 assert.equal(mobile.querySelectorAll('.rt-fsheet-sub img').length,3);assert.doesNotMatch(mobile.textContent,/ME1/);
});
test('Media types can be selected together without hiding the native pager or clearing other filters',t=>{
 const tile=(id,html)=>'<search-telemetry-tracker view-events="search/view/post" id="'+id+'"><div data-id="search-media-post-unit">'+html+'</div></search-telemetry-tracker>';
 const markup=searchPage.replace('</main>','<search-media-feed>'+tile('photo','<img data-post-media-primary src="https://i.redd.it/photo.png">')+tile('video','<button data-testid="videoIcon"></button>')+tile('gif','<img data-post-media-primary src="https://i.redd.it/clip.gif">')+tile('gallery','<a href="/gallery/abc"></a>')+'</search-media-feed><faceplate-partial loading="lazy" src="/svc/shreddit/r/Example/search/?after=a"></faceplate-partial></main>');
 const {D,W}=setup(t,'/r/Example/search/?q=subreddit%3AExample&type=media&sort=top&t=week',markup);
 D.querySelector('[data-rt-community-search="media"]').click();
 const menu=D.querySelector('[data-rt-ui="community-filter-menu"]');
 menu.querySelector('[aria-label="Videos"]').click();
 menu.querySelector('[aria-label="GIFs"]').click();
 assert.deepEqual([...D.querySelectorAll('search-media-feed > ['+stop+']')].map(e=>e.id),['photo','gallery']);
 assert.equal(menu.querySelector('[aria-label="Videos"]').getAttribute('aria-checked'),'true');
 assert.equal(menu.querySelector('[aria-label="GIFs"]').getAttribute('aria-checked'),'true');
 assert.equal(D.querySelector('faceplate-partial').hasAttribute(stop),false);
 const params=new W.URL(W.location).searchParams;
 assert.equal(params.get('rt_type'),'video,gif');
 assert.equal(params.get('type'),'media');assert.equal(params.get('sort'),'top');assert.equal(params.get('t'),'week');
});

const nativeFeedOptions=()=>'<div class="flex items-center"><shreddit-sort-dropdown sort-event="feed-sort-change"><span slot="selected-item">Top</span><a href="/r/Example/best/">Best</a><a href="/r/Example/new/">New</a><a href="/r/Example/top/">Top</a><a href="/r/Other/new/">Other</a></shreddit-sort-dropdown><shreddit-sort-dropdown sort-event="feed-time-sort-change"><span slot="selected-item">This Week</span><a href="/r/Example/top/?t=day">Today</a><a href="/r/Example/top/?t=week">This Week</a></shreddit-sort-dropdown><shreddit-layout-switcher><a href="?feedViewType=cardView">Card</a></shreddit-layout-switcher></div>';
const sortedFeed=()=>feed().replace('<div><shreddit-sort-dropdown></shreddit-sort-dropdown></div>',nativeFeedOptions());
const sortedPath='/r/Example/top/?t=week&rt_type=video&f=flair_name%3A%22News%22&feedViewType=compactView';
test('a filtered feed with no remaining native pager explains the end and keeps filters when changing sort',async t=>{
 const {D,W,controller,targets}=setup(t,sortedPath,sortedFeed());
 const footer=()=>D.querySelector('[data-rt-ui=community-filter-end]');
 assert.equal(footer(),null);
 D.querySelector('[slot=load-after]').outerHTML='<faceplate-batch>'+card('video')+'</faceplate-batch>';
 await flush();
 assert.match(footer()?.textContent,/end of this Reddit feed/);
 assert.equal(footer()?.previousElementSibling,D.querySelector('shreddit-feed'));
 [...footer().querySelectorAll('button')].find(button=>button.textContent==='New').click();
 const target=new W.URL(targets.at(-1));
 assert.equal(target.pathname,'/r/Example/new/');
 assert.equal(target.searchParams.get('rt_type'),'video');
 assert.equal(target.searchParams.get('f'),'flair_name:"News"');
 controller.applyTypes([]);assert.equal(footer(),null);
});
const replaced='data-rt-community-sort-replaced';
const heldSorts='data-rt-community-sort-boot';

test('active feed chips shrink inside the native rail so the Card view control keeps its hit area',t=>{
 const {D,W}=setup(t,sortedPath,sortedFeed());
 const view=D.querySelector('shreddit-layout-switcher a'),bar=D.querySelector('.rt-community-in-feed-rail');
 assert.ok(bar.querySelector('.rt-community-chips[data-rt-rail]'),'reuse the inline sizing instead of a full-width chip row');
 const url=new W.URL(view.href);
 assert.equal(url.searchParams.get('feedViewType'),'cardView');
 assert.equal(url.searchParams.get('rt_type'),'video');
});

test('the production startup hides native feed sort before settings settle and restores it on opt-out',async t=>{
 const {window:W}=new JSDOM('<body></body>',{url:'https://www.reddit.com'+sortedPath,runScripts:'outside-only'}),D=W.document;
 t.after(()=>{W.RTLiveSubredditFiltersDebug?.destroy();W.close();});
 let settings;
 W.chrome={runtime:{id:'test',sendMessage:()=>new Promise(resolve=>{settings=resolve;}),onMessage:{addListener(){}}}};
 const script=JSON.parse(read('manifest.json')).content_scripts.find(entry=>entry.js?.includes('live-subreddit-filters.js'));
 assert.equal(script.run_at,'document_start');
 for(const name of script.js.filter(name=>['feed-filters.js','feed-sheet.js','live-subreddit-filters.js'].includes(name)))W.eval(read(name));
 assert.equal(D.documentElement.hasAttribute(heldSorts),true,'the gate is present before any feed markup');
 D.body.innerHTML=sortedFeed();
 const bootRule=read('post-discovery.css').split('\n').find(line=>line.startsWith('html['+heldSorts+']'));
 assert.ok(bootRule,'the prepaint gate has a stylesheet rule');
 const style=D.createElement('style');style.textContent=bootRule;D.head.append(style);
 assert.equal(W.getComputedStyle(D.querySelector('[sort-event="feed-sort-change"]')).display,'none');
 assert.notEqual(W.getComputedStyle(D.querySelector('shreddit-layout-switcher')).display,'none');
 settings({ok:true,settings:{postDiscovery:false}});await flush();
 assert.equal(D.documentElement.hasAttribute(heldSorts),false);
 assert.notEqual(W.getComputedStyle(D.querySelector('[sort-event="feed-sort-change"]')).display,'none');
});

test('desktop Feed options moves native sorting and Top time ranges into Sort, preserving other filters',t=>{
 const {D,targets,W,controller}=setup(t,sortedPath,sortedFeed());
 assert.equal(D.querySelectorAll('shreddit-sort-dropdown['+replaced+']').length,2);
 assert.equal(D.querySelector('shreddit-layout-switcher').hasAttribute(replaced),false);
 D.querySelector('[data-rt-community-options]').click();
 const root=D.querySelector('.rt-community-feed-menu');
 assert.equal(root.querySelector('[aria-label="Sort"] [data-rt-menu-value]').textContent,'Top');
 root.querySelector('[aria-label="Sort"]').click();
 assert.equal(root.querySelector('[aria-label="Top"]').getAttribute('aria-checked'),'true');
 assert.equal(root.querySelector('[aria-label="Other"]'),null);
 root.querySelector('[aria-label="Top"]').click();
 assert.equal(targets.length,0);
 assert.equal(root.querySelector('[aria-label="This Week"]').getAttribute('aria-checked'),'true');
 root.querySelector('[aria-label="Today"]').click();
 const url=new W.URL(targets.at(-1));
 assert.equal(url.pathname,'/r/Example/top/');
 assert.equal(url.searchParams.get('t'),'day');
 assert.equal(url.searchParams.get('rt_type'),'video');
 assert.equal(url.searchParams.get('f'),'flair_name:"News"');
 assert.equal(url.searchParams.get('feedViewType'),'compactView');
 controller.setEnabled(false);
 assert.equal(D.querySelectorAll('['+replaced+']').length,0);
});

for(const phone of [false,true])test((phone?'phone':'desktop')+' Top opens all native ranges before the sort changes',t=>{
 const markup=sortedFeed().replace('>Top</span>','>New</span>').replace(/<shreddit-sort-dropdown sort-event="feed-time-sort-change">.*?<\/shreddit-sort-dropdown>/,'');
 const {D,W,targets}=setup(t,'/r/Example/new/?rt_type=video&f=flair_name%3A%22News%22&feedViewType=compactView',markup);
 if(phone)W.matchMedia=()=>({matches:true,addEventListener(){},removeEventListener(){}});
 D.querySelector('[data-rt-community-options]').click();
 const root=D.querySelector(phone?'.rt-community-sheet':'.rt-community-feed-menu');
 const row=name=>phone?[...root.querySelectorAll('.rt-fsheet-row')].find(r=>r.querySelector('.rt-fsheet-label').textContent===name):root.querySelector('[aria-label="'+name+'"]');
 row(phone?'Sort by':'Sort').click();row('Top').click();
 assert.equal(targets.length,0,'no navigation before choosing the period');
 for(const choice of ['Now','Today','This Week','This Month','This Year','All Time'])assert.ok(row(choice),choice);
 root.querySelector(phone?'.rt-fsheet-back':'[data-rt-sub-back]').click();
 assert.ok(row('New'));assert.equal(targets.length,0);
 row('Top').click();row('This Month').click();
 assert.equal(targets.length,1);
 const url=new W.URL(targets[0]);
 assert.equal(url.pathname,'/r/Example/top/');assert.equal(url.searchParams.get('t'),'month');
 assert.equal(url.searchParams.get('rt_type'),'video');assert.equal(url.searchParams.get('f'),'flair_name:"News"');assert.equal(url.searchParams.get('feedViewType'),'compactView');
});

test('phone Feed options lists Reddit’s existing sort choices and links to the new sort without losing filters',t=>{
 const {D,W,targets}=setup(t,sortedPath,sortedFeed());
 W.matchMedia=()=>({matches:true,addEventListener(){},removeEventListener(){}});
 D.querySelector('[data-rt-community-options]').click();
 const root=D.querySelector('.rt-community-sheet');
 assert.equal(root.querySelector('.rt-fsheet-row .rt-fsheet-label').textContent,'Applied filters','applied filters come first, one tap from removal');
 const sortRow=[...root.querySelectorAll('.rt-fsheet-row')].find(row=>row.querySelector('.rt-fsheet-label').textContent==='Sort by');
 assert.equal(sortRow.querySelector('.rt-fsheet-sub').textContent,'Top · This Week','the current sort and its range');
 assert.equal(sortRow.querySelector('svg').dataset.icon,'top-fill','Reddit marks the selected sort with its filled icon');
 sortRow.click();
 const top=[...root.querySelectorAll('.rt-fsheet-row')].find(row=>row.querySelector('.rt-fsheet-label').textContent==='Top');
 assert.equal(top.querySelector('.rt-fsheet-sub').textContent,'This Week');assert.ok(top.querySelector('[data-rt-sheet-icon="next"]'),'Top opens its time ranges');
 top.click();
 assert.equal(root.querySelector('.rt-fsheet-title').textContent,'Time range');
 assert.deepEqual([...root.querySelectorAll('.rt-fsheet-row')].map(row=>row.textContent.trim()),['Today','This Week']);
 root.querySelector('.rt-fsheet-back').click();
 const newSort=[...root.querySelectorAll('.rt-fsheet-row')].find(row=>row.textContent.trim()==='New');
 newSort.click();
 const url=new W.URL(targets.at(-1));
 assert.equal(url.pathname,'/r/Example/new/');
 assert.equal(url.searchParams.get('rt_type'),'video');
 assert.equal(url.searchParams.get('f'),'flair_name:"News"');
});
test('phone subreddit Post type uses checked rows and supports multiple choices on the same page',async t=>{
 const {D,W}=setup(t,sortedPath,sortedFeed());
 W.matchMedia=()=>({matches:true,addEventListener(){},removeEventListener(){}});
 D.querySelector('[data-rt-community-options]').click();
 const root=D.querySelector('.rt-community-sheet');
 const row=name=>[...root.querySelectorAll('.rt-fsheet-row')].find(r=>r.querySelector('.rt-fsheet-label').textContent===name);
 row('Post type').click();
 assert.equal(row('Videos').getAttribute('aria-pressed'),'true');
 row('GIFs').click();await new Promise(resolve=>W.setTimeout(resolve,15));
 assert.equal(row('Videos').getAttribute('aria-pressed'),'true');
 assert.equal(row('GIFs').getAttribute('aria-pressed'),'true');
 assert.match(new URL(W.location.href).searchParams.get('rt_type'),/gif/);
 root.querySelector('.rt-fsheet-back').click();
 assert.match(row('Post type').textContent,/2 types/);
});

test('native sort stays visible until links arrive and a replaced control is integrated once',async t=>{
 const {D,controller}=setup(t,'/r/Example/');
 const old=D.querySelector('shreddit-sort-dropdown');
 assert.equal(old.hasAttribute(replaced),false);
 old.insertAdjacentHTML('beforeend','<a href="/r/Example/new/">New</a>');
 await flush();
 assert.equal(old.hasAttribute(replaced),true);
 old.parentElement.outerHTML=nativeFeedOptions();
 await flush();
 assert.equal(old.hasAttribute(replaced),false);
 assert.equal(D.querySelectorAll('[data-rt-ui="community-filters"]').length,1);
 assert.equal(D.querySelectorAll('shreddit-sort-dropdown['+replaced+']').length,2);
 controller.destroy();
 assert.equal(D.querySelectorAll('['+replaced+']').length,0);
});

test('an unsupported native feed sort remains available and the boot gate stays off on search',async t=>{
 const {D,W}=setup(t,'/r/Example/',sortedFeed().replace(/<a href="\/r\/Example\/(?:best|new|top)\/">(Best|New|Top)<\/a>/g,''));
 const sort=D.querySelector('[sort-event="feed-sort-change"]');
 assert.equal(sort.hasAttribute(replaced),false);
 assert.equal(sort.hasAttribute('data-rt-community-sort-native'),true);
 W.history.pushState({},'','/r/Example/search/?q=fixture');
 D.dispatchEvent(new W.Event('reddit:route'));await flush();
 assert.equal(D.documentElement.hasAttribute(heldSorts),false);
});

test('a large filtered feed detaches only hidden card contents and restores the same native nodes',async t=>{
 const markup='<main><shreddit-feed><faceplate-batch>'+card('video','Match')+card('text','Hidden').repeat(45)+
  '</faceplate-batch><faceplate-partial slot="load-after"></faceplate-partial></shreddit-feed></main>';
 const {D,controller}=setup(t,'/r/Example/',markup);
 const feed=D.querySelector('shreddit-feed'),batch=feed.querySelector('faceplate-batch');
 const posts=[...batch.querySelectorAll('shreddit-post')],wrappers=[...batch.querySelectorAll('article')];
 const pager=feed.querySelector('[slot="load-after"]');
 controller.applyTypes(['video']);await flush();
 assert.equal(batch.querySelectorAll('article').length,wrappers.length,'Reddit keeps its native wrappers');
 assert.deepEqual([...batch.querySelectorAll('shreddit-post')],[posts[0]]);
 assert.equal(batch.querySelectorAll('article['+stop+'] + hr['+stop+']').length,45);
 assert.equal(feed.querySelector('[slot="load-after"]'),pager);

 const extra= D.createElement('faceplate-batch');
 extra.innerHTML=card('text','Later');
 const newPost=extra.querySelector('shreddit-post');feed.insertBefore(extra,pager);
 await flush();
 assert.equal(newPost.isConnected,false,'new hidden cards are parked as pagination appends them');
 batch.remove();
 controller.applyTypes([]);await flush();
 assert.deepEqual([...batch.querySelectorAll('shreddit-post')],posts,'even a cached native batch gets its original cards back');
 assert.equal(newPost.isConnected,true);
 feed.insertBefore(batch,pager);
 assert.deepEqual([...batch.querySelectorAll('article')],wrappers);
 assert.equal(feed.querySelectorAll('['+stop+']').length,0);
});

const homeFeed=({withReload=true}={})=>'<main><div class="flex items-center"><shreddit-sort-dropdown sort-event="feed-sort-change"><span slot="selected-item">Best</span><a href="/">Best</a><a href="/hot/">Hot</a><a href="/new/">New</a><a href="/top/">Top</a><a href="/rising/">Rising</a></shreddit-sort-dropdown><shreddit-layout-switcher><a href="?feedViewType=compactView">Compact</a></shreddit-layout-switcher></div><shreddit-feed'+(withReload?' reload-url="/svc/shreddit/feeds/home-feed"':'')+'>'+card('video','News')+card('text','Q&A')+'<faceplate-partial slot="load-after"></faceplate-partial></shreddit-feed></main>';

test('Home, Popular, and All feeds mount Feed options with Sort and Post type (without Flair) on desktop and phone',t=>{
 const {D,W,targets}=setup(t,'/?rt_type=video',homeFeed());
 assert.equal(D.querySelectorAll('article['+stop+']').length,1);
 assert.equal(D.querySelector('shreddit-sort-dropdown').hasAttribute(replaced),true);
 assert.equal(new W.URL(D.querySelector('shreddit-layout-switcher a').href).searchParams.get('rt_type'),'video');
 D.querySelector('[data-rt-community-options]').click();
 const menu=D.querySelector('.rt-community-feed-menu');
 assert.deepEqual([...menu.querySelectorAll('[role="menuitem"]')].map(el=>el.getAttribute('aria-label')),['Sort','Post type']);
 assert.equal(menu.querySelector('[aria-label="Flair"]'),null);
 menu.querySelector('[aria-label="Sort"]').click();
 assert.equal(menu.querySelector('[aria-label="Best"]').getAttribute('aria-checked'),'true');
 menu.querySelector('[aria-label="Top"]').click();
 menu.querySelector('[aria-label="Today"]').click();
 const dest=new W.URL(targets.at(-1));
 assert.equal(dest.pathname,'/top/');
 assert.equal(dest.searchParams.get('t'),'day');
 assert.equal(dest.searchParams.get('rt_type'),'video');

 W.matchMedia=()=>({matches:true,addEventListener(){},removeEventListener(){}});
 D.querySelector('[data-rt-community-options]').click();
 const rows=[...D.querySelectorAll('.rt-community-sheet .rt-fsheet-row')].map(r=>r.querySelector('.rt-fsheet-label').textContent).filter(label=>label!=='Applied filters');
 assert.deepEqual(rows,['Sort by','Post type']);

 for(const [path,reload,links] of [
  ['/r/popular/','/svc/shreddit/community-more-posts/hot/?name=popular','<a href="/r/popular/hot/">Hot</a><a href="/r/popular/new/">New</a>'],
  ['/r/all/','/svc/shreddit/feeds/all-feed','<a href="/r/all/hot/">Hot</a><a href="/r/all/top/">Top</a>']
 ]){
  const markup='<main><div class="flex items-center"><shreddit-sort-dropdown sort-event="feed-sort-change"><span slot="selected-item">Hot</span>'+links+'</shreddit-sort-dropdown></div><shreddit-feed reload-url="'+reload+'">'+card('video')+card('text')+'</shreddit-feed></main>';
  const f=setup(t,path,markup);
  f.D.querySelector('[data-rt-community-options]').click();
  assert.deepEqual([...f.D.querySelectorAll('.rt-community-feed-menu [role="menuitem"]')].map(el=>el.getAttribute('aria-label')),['Sort','Post type'],path);
 }
});

test('SPA transitions between Home and Subreddit clear stale Feed options immediately and never mount on outgoing feeds',async t=>{
 for(const withReload of [true,false]){
  const {D,W}=setup(t,'/',homeFeed({withReload}));
  assert.ok(D.querySelector('[data-rt-ui="community-filters"]'),'Home mounts Feed options');
  // Reddit changes the URL to /r/Example/ before replacing Home's outgoing shreddit-feed.
  W.history.pushState({},'','/r/Example/');
  D.dispatchEvent(new W.Event('reddit:route'));
  assert.equal(D.querySelector('[data-rt-ui="community-filters"]'),null,'stale Home controls clear immediately on route change');
  await flush();
  assert.equal(D.querySelector('[data-rt-ui="community-filters"]'),null,'does not mount Subreddit controls onto outgoing Home feed (withReload='+withReload+')');
  // Now Reddit swaps in r/Example's incoming feed.
  D.querySelector('main').outerHTML=sortedFeed();
  await flush();
  assert.ok(D.querySelector('[data-rt-ui="community-filters"]'),'mounts once incoming Subreddit feed arrives');
  D.querySelector('[data-rt-community-options]').click();
  assert.ok(D.querySelector('.rt-community-feed-menu [aria-label="Flair"]'),'Subreddit menu includes Flair');
  // Navigate back from Subreddit to Home while Subreddit feed is still detaching.
  W.history.pushState({},'','/');
  D.dispatchEvent(new W.Event('reddit:route'));
  assert.equal(D.querySelector('[data-rt-ui="community-filters"]'),null,'stale Subreddit controls clear immediately');
  await flush();
  assert.equal(D.querySelector('[data-rt-ui="community-filters"]'),null,'does not mount Home controls onto outgoing Subreddit feed');
  D.querySelector('main').outerHTML=homeFeed({withReload});
  await flush();
  assert.ok(D.querySelector('[data-rt-ui="community-filters"]'),'Home controls mount cleanly on incoming Home feed');
 }
});

test('live filters bail out on banned subreddit archive feed and archive search',async t=>{
 // Initial presence of archive search attribute prevents mounting.
 {
  const {window:W}=new JSDOM('<body>'+searchPage+'</body>',{url:'https://www.reddit.com/r/Banned/search/?q=subreddit%3ABanned',runScripts:'outside-only'});
  W.document.documentElement.setAttribute('data-rt-subreddit-archive-search','');
  for(const name of ['post-model.js','feed-filters.js','feed-sheet.js','live-subreddit-filters.js'])W.eval(read(name));
  const c=new W.RTLiveSubredditFilters.Controller();t.after(()=>{c.destroy();W.close();});
  assert.equal(W.document.querySelector('[data-rt-ui="community-filters"]'),null);
 }
 // Late activation of archive search clears already-mounted live search controls.
 {
  const {D}=setup(t,'/r/Banned/search/?q=subreddit%3ABanned&type=posts&sort=new',searchPage);
  assert.ok(D.querySelector('[data-rt-ui="community-filters"]'));
  D.documentElement.setAttribute('data-rt-subreddit-archive-search','');
  await flush();
  assert.equal(D.querySelector('[data-rt-ui="community-filters"]'),null,'clears live controls when archive-search attr is set');
 }
 // Late insertion of [data-rt-ui="archive-search"] also clears live controls.
 {
  const {D}=setup(t,'/r/Banned/search/?q=subreddit%3ABanned&type=posts&sort=new',searchPage);
  assert.ok(D.querySelector('[data-rt-ui="community-filters"]'));
  const host=D.createElement('div');host.dataset.rtUi='archive-search';D.querySelector('main').append(host);
  await flush();
  assert.equal(D.querySelector('[data-rt-ui="community-filters"]'),null,'clears live controls when [data-rt-ui="archive-search"] mounts');
 }
 // Archive feed attribute clears boot gate and live controls.
 {
  const {D}=setup(t,'/r/Banned/',sortedFeed().replace(/Example/g,'Banned'));
  assert.equal(D.documentElement.hasAttribute(heldSorts),true);
  D.documentElement.setAttribute('data-rt-subreddit-archive','');
  await flush();
  assert.equal(D.documentElement.hasAttribute(heldSorts),false);
  assert.equal(D.querySelector('[data-rt-ui="community-filters"]'),null);
 }
});
