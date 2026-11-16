const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const read=file=>fs.readFileSync('extension/'+file,'utf8');
const controls=fs.readFileSync('tests/fixtures/native-profile-controls.html','utf8');
const flush=async()=>{for(let i=0;i<6;i++)await new Promise(r=>setImmediate(r));};
const raw=(id,extra={})=>({id,author:'Writer',title:'Synthetic cats',selftext:'body needle',subreddit:'Alpha',created_utc:1700000000,is_self:true,...extra});
const page='<main><faceplate-tabgroup id="search-results-page-tabgroup"><a id="search-results-page-tab-posts" href="?type=posts">Posts</a><a id="search-results-page-tab-comments" href="?type=comments">Comments</a><a id="search-results-page-tab-media" href="?type=media">Media</a></faceplate-tabgroup><div class="bg-neutral-background"><div data-testid="search-sdui-post">Native result</div></div></main>';
function header(W,{hydrated=true}={}){
 const host=W.document.createElement('reddit-search-large');host.setAttribute('scope',JSON.stringify({type:'profile',name:'Example',path:'/user/Example/'}));W.document.body.prepend(host);
 const root=host.attachShadow({mode:'open'});root.innerHTML=hydrated?'<form><faceplate-search-input name="q" placeholder="Search in u/Example"><rpl-input-chip slot="chips" class="scoped-search-pill px-sm" id="search-input-remove-filter"><span>u/Example</span><button aria-label="Remove u/Example filter">×</button></rpl-input-chip></faceplate-search-input></form>':'<form><rpl-input-chip slot="chips" class="scoped-search-pill px-sm" id="search-input-chip"><span>u/Example</span><button aria-label="Remove u/Example filter">×</button></rpl-input-chip><input name="q" placeholder="Search in u/Example"></form>';
 const field=root.querySelector('faceplate-search-input');if(field)field.attachShadow({mode:'open'}).innerHTML='<textarea name="q" placeholder="Search in u/Example"></textarea>';
 return {host,root,form:root.querySelector('form'),field,input:(field?.shadowRoot || root).querySelector('input,textarea'),native:root.querySelector('rpl-input-chip')};
}
async function setup(t,{html=page,directory=null,path='/user/Example/search/?rt_list=saved',username='Example',list,settings={postDiscovery:true,archiveDiscovery:false},withHeader=false,hydrated=true,autoDiscover=false,observe=false}={}){
 const dom=new JSDOM(html,{url:'https://www.reddit.com'+path,runScripts:'outside-only',pretendToBeVisual:true}),W=dom.window;const calls=[],archives=[];let d;
 t.after(()=>{d?.destroy();W.close();});
 for(const file of ['search-core.js','post-model.js','feed-filters.js','post-discovery.js'])W.eval(read(file));
 W.RTArchiveQuery={async *search(args){archives.push(args);throw Error('Private lists must not reach archive search');},async aggregate(args){archives.push(args);throw Error('Private lists must not reach archive aggregates');}};
 const h=withHeader?header(W,{hydrated}):null;
 const reddit=async(args,signal)=>{calls.push({args,signal});
  if(args.action==='own-list-identity'){if(username instanceof Error)throw username;return {username};}
  if(args.action==='render-controls'){W.document.getElementById(args.target).innerHTML=controls;return {rendered:true};}
  if(args.action==='own-list'){if(list)return list(args,signal,W,calls.filter(c=>c.args.action==='own-list').length);return {posts:[W.RTPostModel.normalizePost(raw('first'))],scanned:1,hasMore:false,after:null};}
  throw Error('Unexpected list request: '+args.action);
 };
 if(directory)W.RCSDirectory=directory(W);
 d=new W.RTPostDiscovery.Discovery({observe,autoDiscover,reddit,archive:async args=>{archives.push(args);throw Error('No private list archive reads');},readSettings:async()=>({'rt-settings-v1':settings})});
 await d.ready;await flush();return {W,D:W.document,d,calls,archives,h};
}
const shown=s=>[...s.d.nodes.values()].filter(n=>!n.hidden).sort((a,b)=>a.compareDocumentPosition(b)&4?-1:1).map(n=>n.dataset.fullname);
const listCalls=s=>s.calls.filter(c=>c.args.action==='own-list');
function navigations(s){const urls=[];s.D.addEventListener('click',event=>{const a=event.target.closest?.('a');if(a && !a.closest('#search-results-page-tabgroup,#rt-own-list-types')){event.preventDefault();urls.push(new URL(a.href));}},true);return urls;}

test('own-list routes allow only five lists and a verified matching account',async t=>{
 const s=await setup(t);const route=s.W.RTPostDiscovery.pageRoute;
 for(const list of ['saved','history','hidden','upvoted','downvoted']){assert.equal(route('/user/EXAMPLE/search/','?rt_list='+list).list,list);assert.equal(route('/user/Example/'+list+'/').view,'list-tab');}
 for(const [profile,owner] of [['Other','Example'],['Example','']])assert.equal(route('/user/'+profile+'/search/','?rt_list=saved',owner),null);
 for(const list of ['friends','SAVED','https://other.test',''])assert.equal(route('/user/Example/search/','?rt_list='+encodeURIComponent(list)),null);
 assert.equal(route('/user/Example/search/','?rt_list=saved').type,'all');assert.equal(route('/user/Example/search/','?rt_list=saved&type=posts').type,'posts');
 assert.notEqual(route('/user/Example/search/','?rt_list=saved').key,route('/user/Example/search/','?rt_list=saved&type=posts').key);
 assert.equal(route('/user/Example/search/','?q='+ 'x'.repeat(301)+'&rt_list=saved'),null);
});
for(const hydrated of [true,false])test(`own tab header adds native-styled removable pill and submits (${hydrated?'hydrated':'SSR'})`,async t=>{
 const s=await setup(t,{path:'/user/Example/saved/',withHeader:true,hydrated});const {root,input,native,form}=s.h,urls=navigations(s);
 const pill=root.querySelector('[data-rt-list-chip]');assert.ok(pill);assert.equal(pill.tagName,'RPL-INPUT-CHIP');assert.equal(pill.className,native.className);assert.equal(native.nextElementSibling,pill);assert.equal(input.placeholder,'Search your saved');assert.match(pill.textContent,/Saved/);
 for(const q of ['', 'author:Writer cats']){input.value=q;const event=new s.W.KeyboardEvent('keydown',{key:'Enter',bubbles:true,composed:true,cancelable:true});input.dispatchEvent(event);assert.equal(event.defaultPrevented,true);assert.equal(urls.at(-1).pathname,'/user/Example/search/');assert.equal(urls.at(-1).searchParams.get('rt_list'),'saved');assert.equal(urls.at(-1).searchParams.get('q'),q);}
 input.value='form query';const submit=new s.W.Event('submit',{bubbles:true,composed:true,cancelable:true});form.dispatchEvent(submit);assert.equal(submit.defaultPrevented,true);assert.equal(urls.at(-1).searchParams.get('q'),'form query');
 for(const options of [{shiftKey:true},{ctrlKey:true},{isComposing:true},{repeat:true}]){const e=new s.W.KeyboardEvent('keydown',{key:'Enter',bubbles:true,composed:true,cancelable:true,...options});input.dispatchEvent(e);assert.equal(e.defaultPrevented,false);}
 pill.click();s.d.scan();assert.equal(root.querySelector('[data-rt-list-chip]'),null);assert.equal(input.placeholder,'Search in u/Example');assert.ok(native.isConnected);
});
test('own pill copies Reddit\'s scope pill markup and survives Reddit re-rendering the header',async t=>{
 const s=await setup(t,{path:'/user/Example/search/?q=cats&rt_list=saved',withHeader:true});let pill=s.h.root.querySelector('[data-rt-list-chip]');
 assert.equal(pill.getAttribute('appearance'),'bordered');assert.equal(pill.querySelector('[slot="leading"] svg').getAttribute('icon-name'),'save');assert.equal(pill.querySelector('.text-label-2').textContent,'Saved');assert.equal(pill.querySelector('[slot="trailing"] svg').getAttribute('icon-name'),'close');
 const parent=s.h.native.parentNode;s.h.native.remove();await flush();s.d.syncOwnListHeader();parent.prepend(s.h.native);await flush();s.d.syncOwnListHeader();
 pill=s.h.root.querySelector('[data-rt-list-chip]');assert.ok(pill,'re-added after the header re-renders');assert.equal(s.d.ownHeaderDismissed || '','');
});
test('search filters show as Reddit scope pills in the header search and keep the query scope',async t=>{
 const s=await setup(t,{path:'/user/Example/search/?q=cats&rt_list=saved',withHeader:true});s.h.field.getBoundingClientRect=()=>({width:600,height:40,top:0,left:0,right:600,bottom:40});const urls=navigations(s);
 s.d.setFilters({...s.d.rtFilters,subreddits:['Alpha','Beta'],date:{preset:'week'}});await flush();
 let pills=[...s.h.root.querySelectorAll('[data-rt-header-filter]')];
 assert.deepEqual(pills.map(p=>p.querySelector('.text-label-2').textContent),[s.W.RTFeedFilters.dateLabel({preset:'week'}),'2 communities']);
 assert.equal(pills[0].tagName,'RPL-INPUT-CHIP');assert.equal(pills[0].getAttribute('appearance'),'bordered');assert.equal(pills[0].getAttribute('slot'),'chips');
 assert.equal(pills[0].previousElementSibling,s.h.root.querySelector('[data-rt-list-chip]'),'after u/name and the list pill');assert.equal(s.d.rtChips.hidden,true,'the in-page row does not repeat them');
 for(const p of pills)p.remove();await flush();assert.equal(s.h.root.querySelectorAll('[data-rt-header-filter]').length,2,'re-added after Reddit re-renders the header');
 s.h.input.value='dogs';const e=new s.W.KeyboardEvent('keydown',{key:'Enter',bubbles:true,composed:true,cancelable:true});s.h.input.dispatchEvent(e);assert.equal(e.defaultPrevented,true);
 assert.equal(urls.at(-1).searchParams.get('q'),'dogs');assert.equal(urls.at(-1).searchParams.get('rt_sub'),'Alpha,Beta');assert.equal(urls.at(-1).searchParams.get('rt_date'),'week');assert.equal(urls.at(-1).searchParams.get('rt_list'),'saved');
 s.h.root.querySelector('[data-rt-header-filter="subs"]').click();await flush();assert.deepEqual(Array.from(s.d.rtFilters.subreddits),[]);
 pills=[...s.h.root.querySelectorAll('[data-rt-header-filter]')];assert.equal(pills.length,1);
 s.d.destroy();assert.equal(s.h.root.querySelectorAll('[data-rt-header-filter]').length,0);
});
test('Back to a list search puts its loaded items back without reading the list again',async t=>{
 const s=await setup(t,{path:'/user/Example/search/?q=needle&rt_list=saved',withHeader:true,autoDiscover:true});await s.d.loadOwnList();await flush();
 const before=shown(s),node=s.d.nodes.get('first'),reads=listCalls(s).length;assert.ok(before.length);
 s.W.history.pushState({},'','/r/Alpha/comments/first/synthetic/');s.W.dispatchEvent(new s.W.PopStateEvent('popstate'));s.D.querySelector('main').innerHTML='<shreddit-post id="t3_first"></shreddit-post>';s.d.scan();await flush();
 s.W.history.pushState({},'','/user/Example/search/?q=needle&rt_list=saved');s.W.dispatchEvent(new s.W.PopStateEvent('popstate'));s.D.querySelector('main').outerHTML=page;s.d.scan();await flush();
 assert.deepEqual(shown(s),before);assert.equal(s.d.nodes.get('first'),node);assert.ok(node.isConnected);assert.equal(listCalls(s).length,reads,'the list is not read again');
});
test('opening a list result keeps the results and list pill on screen until Reddit swaps the page',async t=>{
 const s=await setup(t,{path:'/user/Example/search/?q=needle&rt_list=saved',withHeader:true});await s.d.loadOwnList();await flush();const row=s.d.nodes.get('first');
 s.W.history.pushState({},'','/r/Alpha/comments/first/synthetic/');s.W.dispatchEvent(new s.W.PopStateEvent('popstate'));s.d.scan();await flush();
 assert.ok(row.isConnected,'results stay while the post loads');assert.ok(s.h.root.querySelector('[data-rt-list-chip]'),'the list pill stays too');
 s.D.querySelector('main').innerHTML='<shreddit-post id="t3_first"></shreddit-post>';s.d.scan();await flush();
 assert.equal(s.h.root.querySelector('[data-rt-list-chip]'),null,'both go once Reddit shows the post');
});
test('a list parked mid-download continues from its cursor after Back',async t=>{
 let release;const s=await setup(t,{path:'/user/Example/search/?q=needle&rt_list=saved',withHeader:true,list:async(args,signal,W,n)=>{if(n===1)return {posts:[W.RTPostModel.normalizePost(raw('first'))],scanned:1,hasMore:true,after:'t3_first'};if(n===2)return new Promise(r=>release=r);return {posts:[W.RTPostModel.normalizePost(raw('second'))],scanned:1,hasMore:false,after:null};}});
 const pending=s.d.loadOwnList();await flush();assert.equal(listCalls(s).length,2);
 s.W.history.pushState({},'','/r/Alpha/comments/first/synthetic/');s.D.querySelector('main').innerHTML='<shreddit-post id="t3_first"></shreddit-post>';s.d.scan();await flush();
 release({posts:[],scanned:0,hasMore:false,after:null});await pending;
 s.W.history.pushState({},'','/user/Example/search/?q=needle&rt_list=saved');s.D.querySelector('main').outerHTML=page;s.d.scan();await flush();await flush();
 const third=listCalls(s)[2];assert.ok(third,'resumed');assert.equal(third.args.after,'t3_first','from the parked cursor, not the first page');assert.deepEqual(shown(s),['t3_first','t3_second']);
});
test('Reddit re-rendering its header gets the same list pill back, never a fresh blank one',async t=>{
 const s=await setup(t,{path:'/user/Example/search/?q=needle&rt_list=saved',withHeader:true});const pill=s.h.root.querySelector('[data-rt-list-chip]');assert.ok(pill);
 // Reddit swaps its scope pill (hydration): ours goes with the old container.
 const native=s.h.native,fresh=native.cloneNode(true);native.replaceWith(fresh);pill.remove();s.d.syncOwnListHeader();
 assert.equal(s.h.root.querySelector('[data-rt-list-chip]'),pill,'the same element is moved back');assert.equal(fresh.nextElementSibling,pill);
});
test('filter pills stay in the header while Reddit hydrates the field (zero width)',async t=>{
 const s=await setup(t,{path:'/user/Example/search/?q=cats&rt_list=saved',withHeader:true});s.h.field.getBoundingClientRect=()=>({width:0,height:0,top:0,left:0,right:0,bottom:0});
 s.d.setFilters({...s.d.rtFilters,subreddits:['Alpha']});await flush();const pill=s.h.root.querySelector('[data-rt-header-filter]');assert.ok(pill,'placed by layout, not width');
 pill.remove();s.d.syncHeaderFilters();assert.equal(s.h.root.querySelector('[data-rt-header-filter]'),pill,'moved back, not rebuilt');
});
test('the List menu on a list search switches lists or back to all activity',async t=>{
 const s=await setup(t,{path:'/user/Example/search/?q=needle&rt_list=saved',withHeader:true});s.d.scan();await flush();const urls=navigations(s);
 assert.equal(s.D.querySelector('[data-rt-list-switch="saved"]')?.getAttribute('aria-current'),'true');
 s.D.querySelector('[data-rt-list-switch="history"]').click();assert.equal(urls.at(-1).searchParams.get('rt_list'),'history');assert.equal(urls.at(-1).searchParams.get('q'),'needle');
 s.D.querySelector('[data-rt-list-switch="all"]').click();assert.equal(urls.at(-1).searchParams.has('rt_list'),false);assert.equal(urls.at(-1).searchParams.get('q'),'needle');
});
test('Ctrl+/ in Reddit\'s search box opens Search tips for this search; a tip fills the box',async t=>{
 const s=await setup(t,{path:'/user/Example/search/?q=needle&rt_list=saved',withHeader:true});s.d.scan();await flush();
 assert.equal(s.D.querySelector('[data-rt-ui="search-tips"]'),null,'no tips control on the page');
 const press=()=>{const e=new s.W.KeyboardEvent('keydown',{key:'/',ctrlKey:true,bubbles:true,composed:true,cancelable:true});s.h.input.dispatchEvent(e);return e;};
 assert.equal(press().defaultPrevented,true);const card=s.D.querySelector('[data-rt-ui="search-tips"]');assert.ok(card);
 assert.ok(card.querySelector('[data-rt-tip="title:review"]'),'post fields');assert.equal(card.querySelector('[data-rt-tip="from:alice"]'),null,'no chat fields');
 for(const row of card.querySelectorAll('[data-rt-tip]'))assert.equal(s.W.RCSCore.parseQuery(row.dataset.rtTip,{fields:['title','body','subreddit','author','site','url','flair','self','nsfw','spoiler','type']}).invalid,false,row.dataset.rtTip);
 card.querySelector('[data-rt-tip="laptop OR notebook"]').click();assert.equal(s.h.input.value,'laptop OR notebook');assert.equal(s.D.querySelector('[data-rt-ui="search-tips"]'),null,'closes after a pick');
 press();s.D.dispatchEvent(new s.W.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(s.D.querySelector('[data-rt-ui="search-tips"]'),null,'Escape closes');
});
test('Reddit\'s start-up reconcile removing our view puts the same view back with nothing reloaded',async t=>{
 const s=await setup(t,{path:'/user/Example/search/?q=needle&rt_list=saved',withHeader:true,observe:true});await s.d.loadOwnList();await flush();
 const feed=s.d.feed,host=s.d.host,row=s.d.nodes.get('first'),reads=listCalls(s).length;assert.ok(feed.isConnected && row);
 for(const el of [...s.D.querySelector('main').children])if(el.dataset.rtUi)el.remove();assert.equal(feed.isConnected,false);
 for(let i=0;i<3;i++)await Promise.resolve();
 assert.equal(s.d.feed,feed);assert.ok(feed.isConnected,'back before the next paint');assert.ok(host.isConnected);assert.ok(row.isConnected);assert.equal(listCalls(s).length,reads,'the list is not read again');
 assert.ok(s.h.root.querySelector('[data-rt-list-chip]'),'pill stays');
});
test('the chat directory learning your account at start-up doesn\'t rebuild or reload the list; switching accounts does',async t=>{
 let owner='',notify=null;const directory=()=>({getOwner:()=>owner,onChange:fn=>{notify=fn;return ()=>{};}});
 const s=await setup(t,{directory,path:'/user/Example/search/?q=needle&rt_list=saved',withHeader:true});await s.d.loadOwnList();await flush();
 const feed=s.d.feed,reads=listCalls(s).length;owner='@t2_me:reddit.com';notify({owner});await flush();
 assert.equal(s.d.feed,feed);assert.ok(feed.isConnected);assert.equal(listCalls(s).length,reads,'not read again');assert.ok(s.h.root.querySelector('[data-rt-list-chip]'),'pill stays');
 owner='@t2_other:reddit.com';notify({owner});await flush();assert.notEqual(s.d.nodes.get('first')?.isConnected,true,'a real account switch clears the list');
});
test('profile scope removal drops own pill; navigation and teardown restore placeholders',async t=>{
 const s=await setup(t,{path:'/user/Example/history/',withHeader:true});assert.ok(s.h.root.querySelector('[data-rt-list-chip]'));
 s.h.native.remove();await flush();assert.equal(s.h.root.querySelector('[data-rt-list-chip]'),null);assert.equal(s.h.input.placeholder,'Search in u/Example');
 s.W.history.pushState({},'','/user/Example/upvoted/');s.h.root.querySelector('faceplate-search-input').prepend(s.h.native);s.d.scan();assert.match(s.h.root.querySelector('[data-rt-list-chip]').textContent,/Upvoted/);
 s.W.history.pushState({},'','/user/Example/submitted/');s.d.scan();assert.equal(s.h.root.querySelector('[data-rt-list-chip]'),null);
 s.W.history.pushState({},'','/user/Example/downvoted/');s.d.scan();assert.ok(s.h.root.querySelector('[data-rt-list-chip]'));s.d.destroy();assert.equal(s.h.root.querySelector('[data-rt-list-chip]'),null);assert.equal(s.h.input.placeholder,'Search in u/Example');
});
test('scope remove control clears own pill immediately and prevents reinsertion',async t=>{
 const s=await setup(t,{path:'/user/Example/hidden/',withHeader:true});s.h.native.querySelector('button').click();s.d.scan();assert.equal(s.h.root.querySelector('[data-rt-list-chip]'),null);
});
for(const username of ['Other',new Error('Sign in to Reddit to search your lists.')])test('own-list UI refuses another or unavailable account: '+String(username),async t=>{
 const s=await setup(t,{username,withHeader:true,autoDiscover:true});assert.equal(s.h.root.querySelector('[data-rt-list-chip]'),null);assert.equal(s.d.host,null);assert.equal(listCalls(s).length,0);if(username instanceof Error)assert.match(s.D.querySelector('[role="alert"]').textContent,/Sign in.*no complete results/i);
});
test('list search stays available with archives disabled and uses list order across pages',async t=>{
 const s=await setup(t,{list:async(args,signal,W,n)=>({posts:[W.RTPostModel.normalizePost(raw(n===1?'older':'newer',{created_utc:n===1?1600000000:1800000000}))],scanned:n===1?100:40,after:n===1?'t3_older':null,hasMore:n===1})});
 await s.d.refreshActivity();assert.deepEqual(listCalls(s).map(c=>c.args.after),[null,'t3_older']);assert.deepEqual(shown(s),['t3_older','t3_newer']);assert.equal(s.d.status.textContent,'Searched 140 saved items');assert.equal(s.archives.length,0);
 assert.deepEqual([...s.d.rtMenu.searchSort.keys()],['list','new','old']);s.d.setFilters({...s.d.rtFilters,sort:'new'});assert.deepEqual(shown(s),['t3_newer','t3_older']);s.d.setFilters({...s.d.rtFilters,sort:'old'});assert.deepEqual(shown(s),['t3_older','t3_newer']);assert.equal(listCalls(s).length,2);assert.equal(new URLSearchParams(s.W.location.search).get('rt_list'),'saved');
 await s.d.loadSubredditCounts();await s.d.loadArchive();await s.d.loadReddit();assert.equal(s.archives.length,0);assert.equal(s.d.subredditCounts().source,'loaded');
});
test('Saved includes comments by other authors and allows author/u and dates',async t=>{
 const list=async(args,signal,W)=>({posts:[W.RTPostModel.normalizePost(raw('post')),W.RTPostModel.normalizeComment({id:'comment',author:'Writer',body:'needle comment',subreddit:'Alpha',created_utc:1700000000,link_id:'t3_post',parent_id:'t3_post'})],scanned:2,hasMore:false});
 for(const q of ['author:Writer needle','u/Writer after:2023-01-01 before:2024-01-01','body:needle r/Alpha']){const s=await setup(t,{path:'/user/Example/search/?rt_list=saved&q='+encodeURIComponent(q),list});await s.d.refreshActivity();assert.equal(s.d.searchParsed.invalid,false);assert.deepEqual(shown(s),['t3_post','t1_comment']);s.d.setFilters({...s.d.rtFilters,types:['text']});assert.deepEqual(shown(s),['t3_post']);}
 const s=await setup(t,{path:'/user/Example/search/?rt_list=saved&type=comments&q=author:Writer',list});await s.d.refreshActivity();assert.deepEqual(shown(s),['t1_comment']);assert.equal(s.d.searchParsed.invalid,false);
});
for(const q of ['title:cats','body:needle','author:Writer','u/Writer','subreddit:Alpha','r/Alpha','site:example.test','url:example.test','flair:News','self:no','nsfw:yes','spoiler:yes','type:link','after:2023-01-01 before:2024-01-01','cats OR dogs','cats -dogs'])test('post query filters locally: '+q,async t=>{
 const s=await setup(t,{path:'/user/Example/search/?rt_list=upvoted&type=posts&q='+encodeURIComponent(q),list:async(args,signal,W)=>({posts:[W.RTPostModel.normalizePost(raw('match',{is_self:false,url:'https://example.test/cats',link_flair_text:'News',over_18:true,spoiler:true})),W.RTPostModel.normalizePost(raw('miss',{author:'Other',title:'dogs',selftext:'different',subreddit:'Beta',url:'https://other.test',created_utc:1600000000}))],scanned:2,hasMore:false})});await s.d.refreshActivity();assert.equal(s.d.searchParsed.invalid,false);assert.deepEqual(shown(s),q==='cats OR dogs'?['t3_match','t3_miss']:['t3_match']);assert.equal(s.archives.length,0);
});
for(const q of ['title:cats','site:example.test','type:link','from:Writer','has:image'])test('Saved comment mode rejects inapplicable fields: '+q,async t=>{
 const s=await setup(t,{path:'/user/Example/search/?rt_list=saved&type=comments&q='+encodeURIComponent(q)});await s.d.refreshActivity();assert.equal(s.d.searchParsed.invalid,true);assert.equal(s.d.status.dataset.error,'true');assert.match(s.d.notice.textContent,/available for comments/);assert.equal(listCalls(s).length,0);
});
test('Feed options filter list items by date, post type and subreddit with no refetch',async t=>{
 const s=await setup(t,{path:'/user/Example/search/?rt_list=hidden&rt_date=2023-11-01..2023-11-30&rt_type=image&rt_sub=Alpha',list:async(args,signal,W)=>({posts:[W.RTPostModel.normalizePost(raw('match',{is_self:false,post_hint:'image'})),W.RTPostModel.normalizePost(raw('text')),W.RTPostModel.normalizePost(raw('beta',{is_self:false,post_hint:'image',subreddit:'Beta'})),W.RTPostModel.normalizePost(raw('old',{is_self:false,post_hint:'image',created_utc:1600000000}))],scanned:4,hasMore:false})});await s.d.refreshActivity();assert.deepEqual(shown(s),['t3_match']);s.d.setFilters({...s.d.rtFilters,types:[],subreddits:[],date:null});assert.equal(shown(s).length,4);assert.equal(listCalls(s).length,1);
});
test('native tabs keep list scope and filter post/comment/media kind',async t=>{
 const s=await setup(t);assert.equal(s.D.querySelector('[data-rt-list-type="all"]').getAttribute('aria-current'),'page');
 for(const type of ['posts','comments','media']){const a=s.D.getElementById('rt-own-list-tab-'+type);assert.equal(new URL(a.href).searchParams.get('rt_list'),'saved');assert.equal(new URL(a.href).searchParams.get('type'),type);}
 const urls=navigations(s);s.D.getElementById('rt-own-list-tab-media').click();assert.equal(urls.at(-1).searchParams.get('type'),'media');
 s.W.history.pushState({},'','?rt_list=saved&type=media');s.d.scan();await flush();await s.d.refreshActivity();assert.deepEqual(shown(s),[]);
 s.d.leaveRestoreMs=0;s.W.history.pushState({},'','/r/Alpha/');s.d.scan();assert.equal(s.D.getElementById('search-results-page-tab-posts').getAttribute('href'),'?type=posts');assert.equal(s.D.querySelector('[data-rt-list-type="all"]'),null);
});
test('automatic list loading stops at 1000 with a cap notice',async t=>{
 const s=await setup(t,{list:async(args,signal,W,n)=>({posts:[],scanned:100,hasMore:true,after:'t3_page'+n})});await s.d.refreshActivity();assert.equal(listCalls(s).length,10);assert.equal(s.d.listState.capped,true);assert.equal(s.d.status.textContent,'Searched 1,000 saved items');assert.match(s.d.notice.textContent,/Reddit only returns the newest 1,000/);assert.doesNotMatch(s.d.status.textContent+s.d.notice.textContent,/complete/i);
});
test('progress, failed second page, empty and repeated cursor stay honest',async t=>{
 let release;const pending=new Promise(resolve=>release=resolve);const s=await setup(t,{list:async(args,signal,W,n)=>{if(n===2){await pending;throw Error('network unavailable');}return {posts:[],scanned:100,hasMore:true,after:'t3_next'};}});const task=s.d.refreshActivity();await flush();assert.match(s.d.status.textContent,/Searched 100 saved items.*Loading/);assert.equal(s.d.listEmpty.hidden,true);release();await task;assert.equal(s.d.status.dataset.error,'true');assert.match(s.d.status.textContent,/network unavailable/);assert.match(s.d.notice.textContent,/incomplete/);assert.equal(s.d.listEmpty.hidden,true);
 const empty=await setup(t,{list:async()=>({posts:[],scanned:0,hasMore:false})});await empty.d.refreshActivity();assert.match(empty.d.listEmpty.textContent,/0 saved items Reddit returned/);assert.equal(empty.d.listEmpty.hidden,false);
 const repeated=await setup(t,{list:async()=>({posts:[],scanned:1,hasMore:true,after:'t3_same'})});await repeated.d.refreshActivity();assert.equal(listCalls(repeated).length,2);assert.match(repeated.d.status.textContent,/repeated a list cursor/);assert.equal(repeated.d.listState.done,false);
});
test('navigation cancels pending list work and ignores a late answer',async t=>{
 let release;const pending=new Promise(resolve=>release=resolve);const s=await setup(t,{list:async()=>pending});const task=s.d.refreshActivity();await flush();const signal=listCalls(s)[0].signal;
 s.W.history.pushState({},'','/r/Alpha/');s.d.scan();assert.equal(signal.aborted,true);release({posts:[],scanned:100,hasMore:true,after:'t3_next'});await task;assert.equal(listCalls(s).length,1);assert.equal(s.d.listState,null);assert.equal(s.d.host,null);
});
test('History uses one page and always states its limited coverage',async t=>{
 const s=await setup(t,{path:'/user/Example/search/?rt_list=history'});await s.d.refreshActivity();assert.equal(listCalls(s).length,1);assert.equal(listCalls(s)[0].args.list,'history');assert.match(s.d.notice.textContent,/History only includes your ~20 most recently viewed posts/);assert.equal(s.d.listState.done,true);assert.equal(s.archives.length,0);
});
test('removing the search view list chip navigates back to ordinary profile search',async t=>{
 const s=await setup(t,{path:'/user/Example/search/?q=cats&rt_list=saved',withHeader:true});const urls=navigations(s);s.h.root.querySelector('[data-rt-list-chip]').click();assert.equal(urls.at(-1).searchParams.has('rt_list'),false);assert.equal(urls.at(-1).searchParams.get('q'),'cats');assert.ok(s.h.native.isConnected);
});
test('route events reverify identity without cancelling that read when the search view resets',async t=>{
 const s=await setup(t,{autoDiscover:true,observe:true});assert.equal(listCalls(s).length,1);
 s.W.history.pushState({},'','?rt_list=hidden&q=needle');s.W.dispatchEvent(new s.W.PopStateEvent('popstate'));await new Promise(r=>setTimeout(r,90));await flush();
 assert.equal(s.d.context.list,'hidden');assert.equal(s.d.status.dataset.error,'false');assert.equal(s.calls.filter(c=>c.args.action==='own-list-identity').length,2);assert.equal(listCalls(s).length,2);
});
test('native shadow-root form submission works without a composed event',async t=>{
 const s=await setup(t,{path:'/user/Example/saved/',withHeader:true});const urls=navigations(s);s.h.input.value='needle';const event=new s.W.Event('submit',{bubbles:true,cancelable:true});s.h.form.dispatchEvent(event);assert.equal(event.defaultPrevented,true);assert.equal(urls.at(-1).searchParams.get('rt_list'),'saved');
});
test('hydrated native chip arriving after the header is observed adds the own-list pill',async t=>{
 const s=await setup(t,{path:'/user/Example/saved/',withHeader:true});s.h.native.remove();await flush();s.d.ownHeaderDismissed='';s.d.syncOwnListHeader();s.h.field.prepend(s.h.native);await flush();assert.ok(s.h.root.querySelector('[data-rt-list-chip]'));
});
test('list requests never reach third parties even with archive discovery enabled',async t=>{
 const s=await setup(t,{settings:{postDiscovery:true,archiveDiscovery:true},autoDiscover:true});await s.d.loadSubredditCounts();await s.d.loadArchive();await s.d.loadReddit();assert.equal(s.archives.length,0);assert.equal(listCalls(s).length,1);assert.ok(s.d.nodes.get('first').querySelector('a[href*="/comments/first/"]'));assert.equal(s.d.nodes.get('first').querySelector('shreddit-post'),null,'list items are search rows, not live cards');assert.ok(s.d.nodes.get('first').querySelector('[data-testid="search-post-unit"]'));assert.doesNotMatch(s.d.nodes.get('first').textContent,/Open post on Reddit/);
});
test('empty list-search shell gets local tabs; disabled settings restore the header',async t=>{
 const s=await setup(t,{path:'/user/Example/saved/',withHeader:true});s.d.applySettings({postDiscovery:false,archiveDiscovery:false});assert.equal(s.h.root.querySelector('[data-rt-list-chip]'),null);assert.equal(s.h.input.placeholder,'Search in u/Example');
 s.D.querySelector('main').innerHTML='';s.W.history.pushState({},'','/user/Example/search/?rt_list=saved');s.d.applySettings({postDiscovery:true,archiveDiscovery:false});await flush();assert.ok(s.D.querySelector('[data-rt-ui="own-list-tabs"]'));await s.d.refreshActivity();assert.deepEqual(shown(s),['t3_first']);
});
test('account access lost during paging removes earlier private results',async t=>{
 const s=await setup(t,{list:async(args,signal,W,n)=>{if(n>1)throw Error('You can only search your own lists. The signed-in account changed.');return {posts:[W.RTPostModel.normalizePost(raw('first'))],scanned:100,hasMore:true,after:'t3_first'};}});await s.d.refreshActivity();assert.equal(shown(s).length,0);assert.equal(s.d.listState.items.size,0);assert.equal(s.d.nodes.size,0);assert.match(s.d.status.textContent,/signed-in account changed/);
});
test('crowded header filters fold into one "N filters" pill whose card lists and removes each filter',async t=>{
 const s=await setup(t,{path:'/user/Example/search/?q=cats&rt_list=saved',withHeader:true});s.h.field.getBoundingClientRect=()=>({width:600,height:40,top:0,left:0,right:600,bottom:40});s.h.host.getBoundingClientRect=()=>({width:600,height:40,top:0,left:0,right:600,bottom:40});
 s.d.setFilters({...s.d.rtFilters,subreddits:['Alpha','Beta'],date:{preset:'week'},types:['image']});await flush();
 let pills=[...s.h.root.querySelectorAll('[data-rt-header-filter]')];assert.equal(pills.length,1,'one folded pill');assert.equal(pills[0].dataset.rtHeaderFilter,'filters');
 assert.match(pills[0].querySelector('.text-label-2').textContent,/^3 filters$/);assert.match(pills[0].getAttribute('aria-label'),/communities/);
 pills[0].click();await flush();const card=s.W.document.querySelector('[data-rt-ui="header-filters"]');assert.ok(card,'click opens the card, not clear');assert.equal(s.d.rtFilters.subreddits.length,2);
 const inCard=[...card.querySelectorAll('rpl-input-chip')];assert.equal(inCard.length,3);
 inCard.find(p=>/communities/.test(p.textContent)).click();await flush();assert.deepEqual(Array.from(s.d.rtFilters.subreddits),[]);assert.equal(s.W.document.querySelector('[data-rt-ui="header-filters"]'),null,'card closes after a removal');
 pills=[...s.h.root.querySelectorAll('[data-rt-header-filter]')];assert.equal(pills.length,2,'two short pills fit again');
 s.d.setFilters({...s.d.rtFilters,subreddits:['Alpha','Beta']});await flush();pills=[...s.h.root.querySelectorAll('[data-rt-header-filter]')];assert.equal(pills.length,1);
 pills[0].querySelector('.rt-filter-chip-remove').click();await flush();assert.equal(s.d.rtFilters.subreddits.length,0);assert.equal(s.d.rtFilters.date,null);assert.equal(s.d.rtFilters.types.length,0,'× clears all');
 s.d.destroy();
});
test('a crowded header search turns our chips compact so typed text keeps most of the row',async t=>{
 const s=await setup(t,{path:'/user/Example/search/?q=this%20is%20not%20what%20i%20expected&rt_list=saved',withHeader:true});
 const box=width=>()=>({width,height:32,top:0,left:0,right:width,bottom:32});
 s.h.field.getBoundingClientRect=box(820);s.h.native.getBoundingClientRect=box(220);
 s.d.setFilters({...s.d.rtFilters,subreddits:['Alpha','Beta','Gamma']});await flush();
 const list=s.h.root.querySelector('[data-rt-list-chip]'),filter=s.h.root.querySelector('[data-rt-header-filter]');
 list.getBoundingClientRect=box(110);filter.getBoundingClientRect=box(200);s.d.fitHeaderChips();
 // u/ 220 + Saved 110 + 3 communities 200 (+gaps) is more than half of 820: compact.
 assert.equal(list.dataset.rtCompact,'true');assert.equal(filter.dataset.rtCompact,'true');
 assert.equal(list.querySelector('.text-label-2').style.display,'none','the list chip keeps its icon only');assert.equal(list.title,'Saved');
 assert.equal(filter.querySelector('.rt-filter-chip-label').textContent,'3','a count stays readable');assert.match(filter.title,/3 communities/);
 assert.equal(s.h.native.style.maxWidth,'160px','Reddit’s u/ pill is capped and truncates');
 // Plenty of room: full labels come back.
 s.h.field.getBoundingClientRect=box(2000);s.d.fitHeaderChips();
 assert.equal(list.dataset.rtCompact,'false');assert.equal(list.querySelector('.text-label-2').style.display,'');assert.equal(filter.querySelector('.rt-filter-chip-label').textContent,'3 communities');assert.equal(s.h.native.style.maxWidth,'');
});


for(const list of ['saved','removed'])for(const type of ['all','posts','comments','media'])test(`${list} search draws scoped ${type} tabs before filters without a native definition or tab bar`,async t=>{
 const html='<main><div id="filters" class="flex items-center"><search-sort-dropdown-menu><button>Relevance</button></search-sort-dropdown-menu></div><div class="bg-neutral-background"><div id="empty-search-results">No native results</div></div></main>',s=await setup(t,{html,path:'/user/Example/search/?rt_list='+list+'&type='+type+'&q=needle&rt_sub=Alpha'});
 assert.equal(s.W.customElements.get('faceplate-tabgroup'),undefined);const tabs=s.D.getElementById('rt-own-list-types');assert.ok(tabs);assert.equal(tabs.getAttribute('pages'),'4');assert.equal(tabs.getAttribute('pageindex'),String(['all','posts','comments','media'].indexOf(type)+1));assert.equal(Object.hasOwn(tabs,'pages'),false,'no isolated-world property shadows native pagination');
 assert.ok(tabs.compareDocumentPosition(s.D.getElementById('filters'))&s.W.Node.DOCUMENT_POSITION_FOLLOWING,'tabs before native inline filters');assert.deepEqual([...tabs.querySelectorAll('a')].map(a=>a.textContent),['All','Posts','Comments','Media']);
 for(const a of tabs.querySelectorAll('a')){assert.match(a.className,/button-medium/);const url=new URL(a.href);assert.equal(url.searchParams.get('rt_list'),list);assert.equal(url.searchParams.get('q'),'needle');assert.equal(url.searchParams.get('rt_sub'),'Alpha');assert.equal(a.getAttribute('aria-current')==='page',url.searchParams.get('type')===type);}
 assert.equal(s.calls.filter(c=>c.args.action==='own-list').length,0,'tabs already visible before a scan begins');assert.equal(s.archives.length,0);s.d.scan();assert.equal(s.D.querySelectorAll('#rt-own-list-types').length,1);
});
test('own search tabs leave native linked pagination untouched and configure a late component',async t=>{
 const html=page.replace('<faceplate-tabgroup id="search-results-page-tabgroup">','<faceplate-tabgroup id="search-results-page-tabgroup" for="native-results" pages="3" pageindex="1">'),s=await setup(t,{html,path:'/user/Example/search/?rt_list=saved&type=comments'}),native=s.D.getElementById('search-results-page-tabgroup'),tabs=s.D.getElementById('rt-own-list-types');
 assert.ok(tabs);assert.equal(tabs.hasAttribute('for'),false);assert.equal(tabs.getAttribute('pages'),'4');assert.equal(tabs.getAttribute('pageindex'),'3');assert.equal(native.getAttribute('pages'),'3');assert.equal(native.getAttribute('pageindex'),'1');assert.equal(native.hidden,true);
 s.W.customElements.define('faceplate-tabgroup',class extends s.W.HTMLElement{get pages(){return Number(this.getAttribute('pages'));}get pageIndex(){return Number(this.getAttribute('pageindex'));}});await flush();assert.equal(tabs.pages,4);assert.equal(tabs.pageIndex,3);
 s.d.applySettings({postDiscovery:false,archiveDiscovery:false});assert.equal(native.getAttribute('pages'),'3');assert.equal(native.getAttribute('pageindex'),'1');assert.equal(native.hidden,false);assert.equal(native.querySelectorAll('a').length,3);assert.equal(s.D.getElementById('rt-own-list-types'),null);
});
test('hydration restores the owned search tabs without refetching and opt-out unhides native tabs',async t=>{
 const s=await setup(t,{observe:true});await s.d.refreshActivity();await flush();const native=s.D.getElementById('search-results-page-tabgroup'),feed=s.d.feed,node=[...s.d.nodes.values()][0],reads=listCalls(s).length;
 s.D.getElementById('rt-own-list-types').remove();await flush();assert.ok(s.D.getElementById('rt-own-list-types'),'replacement reconciles even when only our tab bar was removed');
 feed.remove();s.d.scan();await flush();assert.equal(s.d.feed,feed);assert.equal([...s.d.nodes.values()][0],node);assert.equal(listCalls(s).length,reads);
 s.d.applySettings({postDiscovery:false,archiveDiscovery:false});assert.equal(native.hidden,false);assert.equal(native.hasAttribute('data-rt-search-hidden'),false);
});
