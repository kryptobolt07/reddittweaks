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
test('phone community feed options opens a short sheet whose Post type page holds the type chips',t=>{
 const {D,W}=setup(t);
 W.matchMedia=()=>({matches:true,addEventListener(){},removeEventListener(){}});
 D.querySelector('[data-rt-community-options]').click();
 const rows=()=>[...D.querySelectorAll('.rt-community-sheet .rt-fsheet-row')];
 assert.deepEqual(rows().map(row=>row.querySelector('.rt-fsheet-label').textContent),['Post type','Flair'],'one row per option, values one level down');
 assert.equal(rows()[0].querySelector('.rt-fsheet-sub').textContent,'All types');
 assert.equal(D.querySelector('.rt-community-sheet .rt-fsheet-chip'),null);
 rows()[0].click();
 assert.equal(D.querySelector('.rt-community-sheet .rt-fsheet-title').textContent,'Post type');
 assert.ok(D.querySelector('.rt-community-sheet .rt-fsheet-chip [icon-name="image"]'));
 assert.equal(D.querySelector('.rt-community-sheet .rt-fsheet-chip [icon-name="show"]'),null,'All types carries no unrelated icon');
 assert.equal(D.querySelector('[data-rt-feed-options]'),null);
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
 root.querySelector('[aria-label="Time range"]').click();
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

test('phone Feed options lists Reddit’s existing sort choices and links to the new sort without losing filters',t=>{
 const {D,W,targets}=setup(t,sortedPath,sortedFeed());
 W.matchMedia=()=>({matches:true,addEventListener(){},removeEventListener(){}});
 D.querySelector('[data-rt-community-options]').click();
 const root=D.querySelector('.rt-community-sheet');
 const sortRow=root.querySelector('.rt-fsheet-row');
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
