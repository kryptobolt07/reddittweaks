const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
const read=f=>fs.readFileSync('extension/'+f,'utf8'),controls=fs.readFileSync('tests/fixtures/native-profile-controls.html','utf8'),flush=async()=>{for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r));};
const tabs=['','submitted/','comments/','saved/','history/','hidden/','upvoted/','downvoted/'];
function shell(){return '<header><a id="global-create" href="/submit">Create</a></header><shreddit-app user-logged-in="true" logged-in-user-id="t2_self"></shreddit-app><div id="user-drawer-content"><faceplate-partial src="/svc/shreddit/partial/X/user-drawer-menu?params=username%3DExample"></faceplate-partial></div><main><faceplate-tabgroup id="profile-feed-tabgroup">'+tabs.map((p,i)=>'<a slot="page-'+(i+1)+'" href="/user/Example/'+p+'" class="button button-plain'+(i?'':' tab-selected bg-secondary-background-selected')+'">'+(p || 'Overview')+'</a>').join('')+'</faceplate-tabgroup><div id="profile-tools"><create-post-entry-point-wrapper id="profile-create"><a href="/submit" aria-label="Create post">Create post</a></create-post-entry-point-wrapper>'+controls+'</div><aside id="right-sidebar-container"><a id="sidebar-create" href="/submit">Sidebar action</a></aside><shreddit-feed id="original-feed"><shreddit-post id="t3_original">Native overview content</shreddit-post></shreddit-feed></main>';}
async function setup(t,{path='/user/Example/hidden/?rt_view=removed',username='Example',listError=''}={}){
 const dom=new JSDOM(shell(),{url:'https://www.reddit.com'+path,runScripts:'outside-only',pretendToBeVisual:true}),W=dom.window,calls=[],renders=[],urls=[];let d;t.after(()=>{d?.destroy();W.close();});
 if(username!=='Example')W.document.querySelector('#user-drawer-content faceplate-partial').setAttribute('src','/svc/shreddit/partial/X/user-drawer-menu?params=username%3D'+username);
 W.customElements.define('faceplate-tabgroup',class extends W.HTMLElement{get pages(){return Number(this.getAttribute('pages')) || undefined;}set pages(v){this.setAttribute('pages',String(v));}get pageIndex(){return Number(this.getAttribute('pageindex')) || 1;}set pageIndex(v){this.setAttribute('pageindex',String(v));}});
 for(const f of ['search-core.js','post-model.js','native-removal.js','removal-model.js','feed-filters.js','post-discovery.js'])W.eval(read(f));
 const M=W.RTPostModel,items=[M.normalizePost({id:'gone',title:'Removed post',selftext:'My post',author:'Example',subreddit:'Alpha',created_utc:1700000000,is_self:true}),M.normalizeComment({id:'reply',body:'My comment',author:'Example',subreddit:'Alpha',link_id:'t3_parent',created_utc:1700000000})];if(new URLSearchParams(W.location.search).get('type')==='media')items[0].postType='image';for(const p of items)p.moderation={native:true,category:'moderator',authorBody:p.body};
 d=new W.RTPostDiscovery.Discovery({observe:false,autoDiscover:false,readSettings:async()=>({'rt-settings-v1':{postDiscovery:true,archiveDiscovery:false}}),reddit:async args=>{calls.push(args);if(args.action==='own-list-identity')return {username};if(args.action==='own-list'){if(listError)throw Error(listError);return {posts:items,scanned:2,hasMore:false,after:null,transport:'native'};}if(args.action==='removal-public-profile')return {items:[],after:null};if(args.action==='removal-public')return {proof:{fullname:args.fullname,status:'unknown',verified:false}};if(args.action==='render-controls'){W.document.getElementById(args.target).innerHTML=controls;return {rendered:true};}throw Error(args.action);},nativeRenderer:async(post,node)=>{renders.push(post.fullname);node.innerHTML=post.kind==='comment'?'<shreddit-profile-comment comment-id="'+post.fullname+'"><span slot="commentMeta"></span><p>My comment</p></shreddit-profile-comment>':'<shreddit-post id="'+post.fullname+'" view-type="'+(new URLSearchParams(W.location.search).get('feedViewType') || 'cardView')+'"><span slot="credit-bar"></span><p>My post</p></shreddit-post>';},removalCache:async()=>({ok:true,proofs:{}})});
 W.document.addEventListener('click',event=>{const a=event.target.closest?.('a');if(a){event.preventDefault();urls.push(new URL(a.href));}},true);await d.ready;await flush();return {W,d,calls,renders,urls,items};
}
for(const tab of ['saved','history','hidden','upvoted','downvoted'])test('Removed remains in the own profile tab bar on '+tab+' without fetching activity',async t=>{
 const s=await setup(t,{path:'/user/Example/'+tab+'/'});const tabNode=s.W.document.querySelector('[data-rt-ui="removed-tab"]');assert.ok(tabNode);assert.equal(new URL(tabNode.href).searchParams.get('rt_view'),'removed');assert.equal(new URL(tabNode.href).pathname,'/user/Example/hidden/');assert.equal(s.calls.filter(c=>c.action!=='own-list-identity').length,0);
});
for(const type of ['all','posts','comments','media'])test('Removed profile section is unified even with obsolete type='+type,async t=>{
 const s=await setup(t,{path:'/user/Example/?rt_view=removed&type='+type+'&feedViewType=compactView'});assert.equal(s.d.context?.section,true);assert.equal(s.d.isSearch(),false);assert.equal(s.d.isOwnList(),true);await s.d.refreshActivity();await flush();
 const shown=[...s.d.nodes.values()].filter(n=>!n.hidden);assert.deepEqual(shown.map(n=>n.dataset.fullname),['t3_gone','t1_reply']);assert.ok(shown.every(n=>n.querySelector('shreddit-post,shreddit-profile-comment')));for(const n of shown)if(n.querySelector('shreddit-post'))assert.equal(n.querySelector('shreddit-post').getAttribute('view-type'),'compactView');assert.equal(s.d.feed.querySelector('[data-testid="search-post-unit"],[data-testid="search-comment-content"]'),null);assert.equal(s.W.document.querySelector('#original-feed').hidden,true);
 const removed=s.W.document.querySelector('[data-rt-ui="removed-tab"]');assert.equal(removed.getAttribute('aria-current'),'page');assert.match(removed.className,/tab-selected/);assert.ok(shown.every(n=>n.querySelector('.rt-removal-pill')));
 assert.equal(s.W.document.querySelector('[data-rt-ui="own-list-tabs"]'),null,'the profile feed has no search content sub-tabs');assert.equal(s.d.context.type,'all');
 assert.equal(s.d.activityDropdown,null);assert.equal(s.W.document.querySelector('#profile-tools').hidden,true);assert.equal(s.d.rtChips,null);
 s.d.applySettings({postDiscovery:false,archiveDiscovery:false});assert.equal(s.W.document.querySelector('#original-feed').hidden,false);assert.equal(s.W.document.querySelector('[data-rt-ui="removed-feed"]'),null);assert.equal(s.W.document.querySelector('[data-rt-ui="removed-tab"]'),null);assert.equal(s.W.document.querySelector('#profile-feed-tabgroup').pageIndex,1);
});
test('Removed section is own-only and its header Enter opens the scoped search view',async t=>{
 const foreign=await setup(t,{username:'Other'});assert.notEqual(foreign.d.context?.section,true);assert.equal(foreign.W.document.querySelector('[data-rt-ui="removed-tab"]'),null);
 const s=await setup(t,{path:'/user/Example/?rt_view=removed&type=comments&rt_sub=Other'}),host=s.W.document.createElement('reddit-search-large');host.setAttribute('scope',JSON.stringify({type:'profile',name:'Example',path:'/user/Example/'}));s.W.document.body.prepend(host);const root=host.attachShadow({mode:'open'});root.innerHTML='<form><rpl-input-chip class="scoped-search-pill" slot="chips">u/Example</rpl-input-chip><input name="q"></form>';s.d.syncOwnListHeader();const e=new s.W.KeyboardEvent('keydown',{key:'Enter',bubbles:true,composed:true,cancelable:true});root.querySelector('input').dispatchEvent(e);assert.equal(e.defaultPrevented,true);assert.equal(s.urls.length,1);assert.equal(s.urls[0].pathname,'/user/Example/search/');assert.equal(s.urls[0].searchParams.get('rt_list'),'removed');assert.equal(s.urls[0].searchParams.get('type'),'posts');assert.equal(s.urls[0].searchParams.has('rt_sub'),false);
});

test('Removed section survives hydration and Back without rescanning or losing native visibility restoration',async t=>{
 const s=await setup(t);await s.d.refreshActivity();await flush();const feed=s.d.feed,cards=[...s.d.nodes.values()],reads=s.calls.filter(c=>c.action==='own-list').length;
 feed.remove();s.d.scan();assert.equal(s.d.feed,feed);assert.equal(feed.isConnected,true);assert.equal(s.W.document.querySelectorAll('[data-rt-ui="removed-feed"]').length,1);
 s.W.history.pushState({},'','/r/Alpha/comments/gone/');s.W.document.querySelector('main').innerHTML='<shreddit-post id="t3_gone"></shreddit-post>';s.d.scan();
 s.W.history.pushState({},'','/user/Example/?rt_view=removed');s.W.document.querySelector('main').innerHTML=shell().match(/<main>([\s\S]*)<\/main>/)[1];s.d.scan();await flush();
 assert.equal(s.d.feed,feed);assert.deepEqual([...s.d.nodes.values()],cards);assert.equal(s.calls.filter(c=>c.action==='own-list').length,reads);assert.equal(s.W.document.querySelector('#original-feed').hidden,true);
 s.d.applySettings({postDiscovery:false,archiveDiscovery:false});assert.equal(s.W.document.querySelector('#original-feed').hidden,false);
});

test('Removed ignores stale feed filters and sort, with no filter controls or control requests',async t=>{
 const s=await setup(t,{path:'/user/Example/hidden/?rt_view=removed&sort=old&rt_date=2020-01-01..2020-01-02&rt_sub=Other&rt_type=video&rt_sort=old'});await s.d.refreshActivity();await flush();
 assert.equal(s.d.context?.section,true);assert.equal(s.d.effectiveSort(),'list');assert.deepEqual([...s.d.nodes.values()].filter(n=>!n.hidden).map(n=>n.dataset.fullname),['t3_gone','t1_reply']);assert.equal(s.d.activityDropdown,null);assert.equal(s.d.rtMenu,null);assert.equal(s.W.document.querySelector('[data-rt-ui="filter-chips"]'),null);assert.equal(s.calls.filter(c=>c.action==='render-controls').length,0);
 const route=s.W.RTPostDiscovery.pageRoute;assert.equal(s.d.context.key,route('/user/Example/hidden/','?rt_view=removed').key);assert.equal(s.d.searchParkKey(),route('/user/Example/hidden/','?rt_view=removed').key);
});
test('Removed restores its tab selection, original controls and own data on sign-out',async t=>{
 const s=await setup(t);await s.d.refreshActivity();await flush();const group=s.W.document.querySelector('#profile-feed-tabgroup');assert.equal(group.pages,9);
 s.W.document.querySelector('shreddit-app').setAttribute('user-logged-in','false');s.d.scan();assert.equal(s.d.context,null);assert.equal(s.W.document.querySelector('[data-rt-ui="removed-tab"]'),null);assert.equal(group.pages,8);assert.match(group.querySelector('a').className,/tab-selected/);assert.equal(s.W.document.querySelector('#original-feed').hidden,false);
 for(const node of s.W.document.querySelectorAll('rpl-dropdown [href]'))assert.equal(new URL(node.getAttribute('href'),s.W.location.href).searchParams.has('rt_view'),false);
});

test('Removed selection preserves a linked native panel that contains the profile feed',async t=>{
 const s=await setup(t);s.d.applySettings({postDiscovery:false,archiveDiscovery:false});const main=s.W.document.querySelector('main'),group=main.querySelector('#profile-feed-tabgroup'),panel=s.W.document.createElement('faceplate-tabpanel');panel.id='profile-feed-tabs';group.setAttribute('for',panel.id);for(const n of [...main.children])if(n!==group)panel.append(n);main.append(panel);
 s.d.applySettings({postDiscovery:true,archiveDiscovery:false});assert.equal(group.pageIndex,1,'do not switch the linked native feed to a nonexistent ninth panel');assert.equal(s.W.document.querySelector('[data-rt-ui="removed-tab"]').getAttribute('aria-current'),'page');assert.equal(s.d.feed.isConnected,true);
});

test('Removed profile content scopes do not split its navigation cache and layout links',async t=>{
 const s=await setup(t),route=s.W.RTPostDiscovery.pageRoute,base=route('/user/Example/','?rt_view=removed').key;
 for(const type of ['all','posts','comments','media'])assert.equal(route('/user/Example/','?rt_view=removed&type='+type).key,base);
 assert.equal(s.d.activityDropdown,null);
});

test('Removed hides only profile list chrome, reconciles replacements and restores exact native visibility',async t=>{
 const s=await setup(t);await s.d.refreshActivity();await flush();const D=s.W.document,feed=s.d.feed,reads=s.calls.filter(c=>c.action==='own-list').length;
 for(const id of ['profile-create','profile-tools'])assert.equal(D.getElementById(id).hidden,true);
 for(const id of ['global-create','sidebar-create'])assert.equal(D.getElementById(id).hidden,false);
 const replacement=D.createElement('div');replacement.innerHTML='<create-post-entry-point-wrapper id="late-create"><a href="/submit">Create post</a></create-post-entry-point-wrapper>'+controls;D.getElementById('profile-tools').replaceWith(replacement);s.d.scan({cheap:true});assert.equal(replacement.hidden,true);assert.equal(s.d.feed,feed);assert.equal(s.calls.filter(c=>c.action==='own-list').length,reads);
 s.d.applySettings({postDiscovery:false,archiveDiscovery:false});assert.equal(replacement.hidden,false);assert.equal(D.getElementById('late-create').hidden,false);assert.equal(D.querySelector('shreddit-layout-event-setter').hidden,false);assert.equal(D.getElementById('original-feed').hidden,false);
});
test('Removed scan failure keeps a reachable retry without opening filter menus',async t=>{
 const s=await setup(t,{listError:'Synthetic unavailable listing'});await s.d.refreshActivity();assert.match(s.d.status.textContent,/Synthetic unavailable/);assert.equal(s.d.discover.hidden,false);assert.equal(s.d.discover.disabled,false);assert.equal(s.d.activityDropdown,null);
});
test('Removed historical deleted cards use archived text instead of requesting live placeholders',async t=>{
 const s=await setup(t),M=s.W.RTPostModel;s.d.listState.done=true;
 for(const kind of ['post','comment']){const raw={id:'past'+kind,author:'Example',title:'Archived post',body:'Archived comment original',selftext:'Archived post original',created_utc:1600000000,subreddit:'Alpha',link_id:'t3_parent'},p=kind==='post'?M.normalizePost(raw,{source:'arctic-shift'}):M.normalizeComment(raw,{source:'arctic-shift'});p.archiveDeletedLater=true;p.removal={removed:true,state:'removed-mod',confidence:'verified',label:'Removed by moderators',why:'Archive captured removal and subsequent deletion',flags:['deleted-later']};s.d.listState.items.set(kind==='post'?p.id:p.fullname,p);}
 s.d.renderOwnList();await flush();assert.equal(s.renders.length,0);for(const node of s.d.nodes.values()){assert.equal(node.dataset.rtArchiveFallback,'true');assert.match(node.textContent,/Archived (?:post|comment) original/);assert.ok(node.querySelector('.rt-removal-pill'));}
});
test('Removed mounts independently when the native hidden list has no feed',async t=>{
 const s=await setup(t);s.d.applySettings({postDiscovery:false,archiveDiscovery:false});s.W.document.getElementById('original-feed').remove();const empty=s.W.document.createElement('div');empty.id='empty-feed-content';empty.textContent='No hidden items';s.W.document.querySelector('main').append(empty);
 s.d.applySettings({postDiscovery:true,archiveDiscovery:false});assert.equal(s.d.context?.section,true);assert.ok(s.d.feed?.isConnected);assert.equal(empty.hidden,true);await s.d.refreshActivity();await flush();assert.equal([...s.d.nodes.values()].filter(n=>!n.hidden).length,2);
 s.d.applySettings({postDiscovery:false,archiveDiscovery:false});assert.equal(empty.hidden,false);assert.equal(s.W.document.querySelector('[data-rt-ui="removed-feed"]'),null);
});
test('archive recovery failures remain retryable in the plain Removed list',async t=>{
 const s=await setup(t);s.d.settings.archiveDiscovery=true;s.d.archive=async()=>{throw Error('Synthetic archive failure');};await s.d.refreshActivity();assert.match(s.d.notice.title,/Synthetic archive failure/);assert.equal(s.d.discover.hidden,false);assert.equal(s.d.discover.disabled,false);assert.equal(s.d.activityDropdown,null);
});
test('Removed merges recovered archive cards into newest-first unified order',async t=>{
 const s=await setup(t);await s.d.refreshActivity();const p=s.W.RTPostModel.normalizePost({id:'newpast',title:'Recovered newest',selftext:'Archived newest text',author:'Example',subreddit:'Alpha',created_utc:1800000000},{source:'arctic-shift'});p.archiveDeletedLater=true;p.removal={removed:true,state:'removed-mod',confidence:'verified',label:'Removed by moderators',why:'Archive captured removal',flags:['deleted-later']};s.d.listState.items.set(p.id,p);s.d.renderOwnList();await flush();assert.deepEqual([...s.d.feed.querySelectorAll(':scope > [data-rt-ui="activity-item"]')].filter(n=>!n.hidden).map(n=>n.dataset.fullname),['t3_newpast','t3_gone','t1_reply']);
});
test('Removed takes Reddit\'s inline selected highlight from Hidden and keeps it after a native repaint',async t=>{
 const s=await setup(t);s.d.applySettings({postDiscovery:false,archiveDiscovery:false});const D=s.W.document,group=D.querySelector('#profile-feed-tabgroup'),sel='var(--color-secondary-background-selected)',bg=n=>n.style.backgroundColor;
 const paint=target=>{for(const n of group.querySelectorAll(':scope > a')){const on=n===target;for(const c of ['tab-selected','bg-secondary-background-selected'])if(n.classList.contains(c)!==on)n.classList.toggle(c,on);n.toggleAttribute('faceplate-tab-selected',on);n.style.backgroundColor=on?sel:'transparent';}},hidden=group.querySelector('a[href$="/hidden/"]');
 paint(hidden);group.setAttribute('pageindex','6');s.d.applySettings({postDiscovery:true,archiveDiscovery:false});await flush();const removed=D.querySelector('[data-rt-ui="removed-tab"]');
 assert.equal(bg(removed),sel);assert.match(removed.className,/tab-selected/);assert.equal(bg(hidden),'transparent');assert.doesNotMatch(hidden.className,/tab-selected/);assert.equal(hidden.hasAttribute('faceplate-tab-selected'),false);
 paint(hidden);await flush();assert.equal(bg(hidden),'transparent','a native repaint does not move the highlight back to Hidden');assert.doesNotMatch(hidden.className,/tab-selected/);assert.equal(bg(removed),sel);assert.match(removed.className,/tab-selected/);
 s.d.applySettings({postDiscovery:false,archiveDiscovery:false});await flush();assert.equal(bg(hidden),sel);assert.match(hidden.className,/tab-selected/);assert.equal(hidden.hasAttribute('faceplate-tab-selected'),true);assert.equal(D.querySelector('[data-rt-ui="removed-tab"]'),null);
});
test('Removed re-asserts the tab count when Reddit resets the drawn pages under an unchanged attribute',async t=>{
 const s=await setup(t,{path:'/user/Example/'});const D=s.W.document,group=D.querySelector('#profile-feed-tabgroup'),root=group.attachShadow?group.shadowRoot || group.attachShadow({mode:'open'}):null,draw=n=>{root.innerHTML='<div class="tablist" role="tablist">'+Array.from({length:n},(_,i)=>'<span role="tab" data-i="'+(i+1)+'"><slot name="page-'+(i+1)+'"></slot></span>').join('')+'</div>';};
 const changes=[];new s.W.MutationObserver(records=>{for(const r of records)if(r.attributeName==='pages')changes.push(group.getAttribute('pages'));}).observe(group,{attributes:true});
 draw(9);s.d.scan();await flush();assert.equal(group.getAttribute('pages'),'9');changes.length=0;
 draw(8);await flush();assert.ok(changes.length>=1,'the pages attribute is written again so the component redraws nine tabs');assert.equal(group.getAttribute('pages'),'9');
});
