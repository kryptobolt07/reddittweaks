// Removed list on your own profile (docs/own-removal-detection-spec.md U2): bridge, broker and view.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
const read=file=>fs.readFileSync('extension/'+file,'utf8');
const flush=async()=>{for(let i=0;i<6;i++)await new Promise(r=>setImmediate(r));};
const page='<main><faceplate-tabgroup id="search-results-page-tabgroup"><a id="search-results-page-tab-posts" href="?type=posts">Posts</a><a id="search-results-page-tab-comments" href="?type=comments">Comments</a><a id="search-results-page-tab-media" href="?type=media">Media</a></faceplate-tabgroup><div class="bg-neutral-background"><div data-testid="search-sdui-post">Native result</div></div></main>';
const created=1700000000;
const post=(id,extra={})=>({id,author:'Example',title:'Synthetic '+id,selftext:'Synthetic body',subreddit:'Alpha',subreddit_type:'public',created_utc:created,is_self:true,removed_by_category:null,...extra});
const comment=(id,extra={})=>({id,author:'Example',body:'Synthetic comment '+id,link_id:'t3_parent',parent_id:'t3_parent',link_title:'Parent',subreddit:'Alpha',subreddit_type:'public',created_utc:created,...extra});

// --- View (isolated world), with the page bridge stubbed by the bridge's real normalization rules.
async function view(t,{children,settings={postDiscovery:true,archiveDiscovery:false},archive,publicProofs,visitor,calls=[],cache=null,saved=[]}={}){
 const dom=new JSDOM(page,{url:'https://www.reddit.com/user/Example/search/?rt_list=removed',runScripts:'outside-only',pretendToBeVisual:true}),W=dom.window,archives=[];let d;
 t.after(()=>{d?.destroy();W.close();});
 for(const file of ['search-core.js','post-model.js','feed-filters.js','removal-model.js','post-discovery.js'])W.eval(read(file));
 const M=W.RTPostModel;if(publicProofs)W.RTNativeRemoval={identity:()=>({owner:'t2_self',username:'Example'})};
 const reddit=async args=>{
  if(args.action==='own-list-identity')return {username:'Example'};
  calls.push(args);
  if(args.action==='removal-public-profile'){assert.equal(args.owner,'t2_self');if(!visitor)throw Error('Reddit blocked the signed-out profile (HTTP 403).');return visitor(args);}
  if(args.action==='removal-public'){assert.equal(args.owner,'t2_self');return {proof:{fullname:args.fullname,...(publicProofs?.[args.fullname] || {status:'unknown',verified:false})}};}
  if(args.action==='own-list'){assert.equal(args.list,'removed');const posts=children.map(([kind,data])=>{const item=kind==='t3'?M.normalizePost(data):M.normalizeComment(data);item.moderation={category:data.removed_by_category ?? null,removalReason:Boolean(data.removal_reason),locked:data.locked===true,subredditType:data.subreddit_type || 'public',quarantined:false,authorBody:kind==='t3'?data.selftext:data.body,...(data.native?{native:true}:{})};return item;});return {posts,scanned:posts.length,hasMore:false,after:null};}
  throw Error('Unexpected request: '+args.action);
 };
 d=new W.RTPostDiscovery.Discovery({observe:false,autoDiscover:false,removalCache:async message=>{if(message.action==='proofs-load')return {ok:true,proofs:cache || {}};saved.push(...message.proofs);return {ok:true};},reddit,archive:async args=>{archives.push(args);if(!archive)throw Error('No archive expected');return archive(args,W);},readSettings:async()=>({'rt-settings-v1':settings})});
 d.removalGapMs=0;await d.ready;await flush();await d.refreshActivity();await flush();
 const shown=[...d.nodes.values()].filter(n=>!n.hidden).map(n=>n.dataset.fullname);
 const pill=name=>[...d.nodes.values()].find(n=>n.dataset.fullname===name)?.querySelector('.rt-removal-pill');
 return {W,d,archives,shown,pill};
}

test('rt_list=removed is an own list route; other accounts cannot open it',async t=>{
 const s=await view(t,{children:[]});const route=s.W.RTPostDiscovery.pageRoute;
 assert.equal(route('/user/Example/search/','?rt_list=removed').list,'removed');assert.equal(route('/user/Example/search/','?rt_list=removed').type,'all');
 assert.equal(route('/user/Other/search/','?rt_list=removed','Example'),null);
});

test('Removed shows only your removed posts, each with its state pill and evidence tooltip',async t=>{
 const s=await view(t,{children:[['t3',post('visible1')],['t3',post('modpost',{removed_by_category:'moderator'})],['t3',post('autopost',{removed_by_category:'automod_filtered'})],['t3',post('adminpost',{removed_by_category:'anti_evil_ops'})],['t3',post('mine',{removed_by_category:'deleted',selftext:'[deleted]'})],['t1',comment('c1')]]});
 assert.deepEqual(s.shown.sort(),['t3_adminpost','t3_autopost','t3_modpost']);
 assert.equal(s.pill('t3_modpost').dataset.rtRemoval,'removed-mod');assert.match(s.pill('t3_modpost').textContent,/^Removed by moderators$/);assert.match(s.pill('t3_modpost').title,/Reddit marks this post as removed by moderators/);
 assert.equal(s.pill('t3_autopost').textContent,'Removed automatically');assert.equal(s.pill('t3_adminpost').textContent,'Removed by Reddit');
 assert.equal(s.d.status.textContent,'Checked your newest 6 posts and comments · 3 removed');
 // The Posts and Comments tabs count only what they list (no comments counted under Posts).
 s.d.context.type='posts';s.d.summarizeRemoved();assert.equal(s.d.status.textContent,'Checked your newest 5 posts · 3 removed');
 s.d.context.type='comments';s.d.summarizeRemoved();assert.equal(s.d.status.textContent,'Checked your newest 1 comments · 0 removed');
 s.d.context.type='all';s.d.setFilters?.({...s.d.rtFilters,subreddits:['Other']});s.d.summarizeRemoved();assert.match(s.d.status.textContent,/^Checked your newest 0 posts and comments in this view · 0 removed/,'a community filter scopes the counts too');
 s.d.rtFilters={...s.d.rtFilters,subreddits:[]};s.d.summarizeRemoved();
 assert.match(s.d.notice.title,/1 comment couldn’t be checked: a signed-out item check is unavailable\. Turn on “Use the archive”/);
 assert.match(s.d.notice.title,/Couldn’t check whether others can see your profile/);
 assert.equal(s.archives.length,0,'no archive reads while “Use the archive” is off');
});

test('with the archive on, comments are classified from its captures in batches of at most 25',async t=>{
 const children=[['t1',comment('auto1')],['t1',comment('mod1')],['t1',comment('seen1')],['t1',comment('none1')],...Array.from({length:26},(_,i)=>['t1',comment('bulk'+i)])];
 const s=await view(t,{settings:{postDiscovery:true,archiveDiscovery:true},children,archive:async(args,W)=>{
  if(args.action==='archive-profile')return {ok:true,posts:[],hasMore:false};
  assert.equal(args.action,'archive-removal');assert.equal(args.kind,'comment');assert.ok(args.ids.length<=25);
  const caps={auto1:{body:'[removed]',retrieved_on:created+10},mod1:{body:'Synthetic comment mod1',retrieved_on:created+600}};
  return {ok:true,posts:args.ids.filter(id=>caps[id]).map(id=>W.RTPostModel.normalizeComment({...comment(id),...caps[id]},{source:'arctic-shift'}))};
 }});
 const removals=s.archives.filter(a=>a.action==='archive-removal');assert.equal(removals.length,2);assert.deepEqual(removals.map(a=>a.ids.length),[25,5]);
 // Only the archive capture of a removal makes a comment "removed"; one seen visible stays unchecked (no public view).
 assert.deepEqual(s.shown,['t1_auto1']);assert.equal(s.pill('t1_auto1').textContent,'Removed automatically (likely)');assert.match(s.pill('t1_auto1').title,/10 seconds after posting/);
 assert.equal(s.d.listState.items.get('mod1')?.removal?.state ?? [...s.d.listState.items.values()].find(p=>p.id==='mod1').removal.state,'unknown');
 assert.match(s.d.notice.title,/29 comments couldn’t be checked/);assert.doesNotMatch(s.d.notice.title,/Turn on “Use the archive”/);
});

test('an archive failure leaves comments as “Couldn’t check” and says so, never as visible',async t=>{
 const s=await view(t,{settings:{postDiscovery:true,archiveDiscovery:true},children:[['t1',comment('c1')],['t3',post('p1',{removed_by_category:'moderator'})]],archive:async()=>{throw Error('Archive requests are cooling down.');}});
 assert.deepEqual(s.shown,['t3_p1']);assert.match(s.d.notice.title,/The archive didn’t answer \(Archive requests are cooling down\); some comments couldn’t be checked/);
 assert.equal([...s.d.listState.items.values()].find(p=>p.id==='c1').removal.state,'unknown');assert.notEqual(s.d.status.dataset.error,'true');
});

test('no removals says how many items could be checked, not that nothing was removed',async t=>{
 const s=await view(t,{children:[['t3',post('a')],['t3',post('b')],['t1',comment('c')]]});
 assert.deepEqual(s.shown,[]);assert.equal(s.d.listEmpty.hidden,false);assert.equal(s.d.listEmpty.textContent,'No removals found in the 2 items that could be checked.');
});

test('native metadata without a visibility verdict remains unchecked and exposes its limit',async t=>{
 const s=await view(t,{children:[['t3',post('a')]]});const item=[...s.d.listState.items.values()][0];item.moderation.visibilityKnown=false;
 await s.d.classifyRemoved([item],s.d.context);s.d.renderOwnList();assert.equal(item.removal.state,'unknown');assert.match(s.d.notice.title,/native metadata does not establish public visibility/);assert.match(s.d.listEmpty.textContent,/0 items that could be checked/);
});
test('native Removed pages state their coverage limit and use archive evidence for own posts too',async t=>{
 const s=await view(t,{children:[['t3',post('auto1')]]});const p=[...s.d.listState.items.values()][0];Object.assign(p.moderation,{native:true,nativeRemoved:true,visibilityKnown:false});s.d.settings.archiveDiscovery=true;
 s.d.archive=async args=>{assert.equal(args.kind,'post');return {posts:[s.W.RTPostModel.normalizePost({...post('auto1'),selftext:'[removed]',retrieved_on:created+10},{source:'arctic-shift'})]};};
 await s.d.classifyRemoved([p],s.d.context);assert.equal(p.removal.state,'removed-auto');assert.equal(p.removal.confidence,'likely');s.d.listState.native=true;s.d.listState.capped=true;s.d.summarizeRemoved();assert.match(s.d.notice.title,/native profile coverage may be incomplete/i);assert.doesNotMatch(s.d.notice.title,/Reddit only returns your newest/);
});
test('Removed uses fresh unsigned evidence; search absence or an unreadable public response is not removal',async t=>{
 const s=await view(t,{children:[['t3',post('oldmod',{removed_by_category:'moderator'})],['t1',comment('publicremoved')],['t1',comment('missing')]],publicProofs:{t3_oldmod:{status:'visible',verified:true,moderation:'approved'},t1_publicremoved:{status:'removed',verified:true}}});
 assert.deepEqual(s.shown,['t1_publicremoved']);assert.equal([...s.d.listState.items.values()].find(p=>p.id==='oldmod').removal.state,'visible');assert.equal([...s.d.listState.items.values()].find(p=>p.id==='missing').removal.state,'unknown');assert.match(s.d.notice.title,/signed.out.*unavailable/i);assert.doesNotMatch(s.d.notice.title,/Reddit blocks logged-out checks/);
});
test('a readable but explicitly removed native post can still use archive evidence for its removal source',async t=>{
 const s=await view(t,{children:[['t3',post('both')]],publicProofs:{t3_both:{status:'visible',verified:true}}});const p=[...s.d.listState.items.values()][0];Object.assign(p.moderation,{native:true,nativeRemoved:true,visibilityKnown:false});s.d.settings.archiveDiscovery=true;let reads=0;s.d.archive=async()=>{reads++;return {posts:[s.W.RTPostModel.normalizePost({...post('both'),selftext:'[removed]',retrieved_on:created+10},{source:'arctic-shift'})]};};await s.d.classifyRemoved([p],s.d.context);assert.equal(reads,1);assert.equal(p.removal.state,'removed-auto');
});

// --- Page bridge (main world).
function bridge(t,{children,username='Example'}){
 const dom=new JSDOM('<body></body>',{url:'https://www.reddit.com/user/Example/search/?rt_list=removed',runScripts:'outside-only'}),W=dom.window,calls=[];t.after(()=>W.close());W.AbortController=AbortController;
 W.fetch=async url=>{url=new URL(url);calls.push(url);return {ok:true,status:200,headers:new Headers(),text:async()=>JSON.stringify(url.pathname==='/api/me.json'?{data:{name:username}}:{kind:'Listing',data:{children,after:null}})};};
 for(const file of ['post-model.js','post-page-bridge.js'])W.eval(read(file));
 const send=input=>new Promise(resolve=>{const id=crypto.randomUUID(),listener=event=>{const result=JSON.parse(event.detail);if(result.id!==id)return;W.document.removeEventListener('rt-post-response',listener);resolve(result);};W.document.addEventListener('rt-post-response',listener);W.document.dispatchEvent(new W.CustomEvent('rt-post-request',{detail:JSON.stringify({channel:'removed-test',id,...input})}));});
 return {calls,send};
}
test('legacy Removed listing fails closed when native authenticated identity is unavailable',async t=>{
 const b=bridge(t,{children:[{kind:'t3',data:post('p1',{removed_by_category:'moderator',locked:true})},{kind:'t1',data:comment('c1')}]});
 const result=await b.send({action:'own-list',username:'Example',list:'removed'});assert.equal(result.ok,false);assert.equal(b.calls.length,0);
});
test('bridge treats another author’s item in your overview as a malformed page',async t=>{
 const b=bridge(t,{children:[{kind:'t3',data:post('p1',{author:'Someone'})}]});
 const result=await b.send({action:'own-list',username:'Example',list:'removed'});assert.equal(result.ok,false);
});

// --- Broker (worker).
function broker({settings={postDiscovery:true,archiveDiscovery:true},data,monitorIdentity=null}={}){
 let listener;const calls=[];
 const context=vm.createContext({URL,AbortController,Date,console,setTimeout,clearTimeout,RTRemovalBroker:{verify:async()=>monitorIdentity},
  chrome:{runtime:{id:'own',onMessage:{addListener(fn){listener=fn;}}},storage:{onChanged:{addListener(){}},local:{async get(){return {'rt-settings-v1':settings};}}},tabs:{async sendMessage(){}}},
  fetch:async url=>{calls.push(new URL(url));return {ok:true,status:200,headers:{get:()=>null},async text(){return JSON.stringify({data});}};}});
 for(const file of ['post-model.js','post-broker.js'])vm.runInContext(read(file),context);
 const send=(message,sender={})=>new Promise(resolve=>{const r=listener({scope:'rt-posts',action:'archive-removal',username:'Example',kind:'comment',ids:['c1'],...message},{id:'own',frameId:0,url:'https://www.reddit.com/user/Example/search/?rt_list=removed',...sender},resolve);if(r!==true)resolve(undefined);});
 return {calls,send};
}
test('archive-removal needs the archive on and your own profile, takes at most 25 IDs and returns only your records',async()=>{
 const b=broker({data:[{...comment('c1'),body:'[removed]',retrieved_on:created+5},{...comment('c2'),author:'Someone'}]});
 const result=await b.send({ids:['c1','c2']});assert.equal(result.ok,true);assert.deepEqual([...result.posts.map(p=>p.id)],['c1']);assert.equal(result.posts[0].retrieved,created+5);
 assert.equal(b.calls[0].pathname,'/api/comments/ids');assert.equal(b.calls[0].searchParams.get('ids'),'c1,c2');
 assert.equal((await b.send({ids:Array.from({length:26},(_,i)=>'c'+i)})).code,'invalid-request');
 assert.equal((await b.send({},{url:'https://www.reddit.com/user/Other/'})).code,'forbidden');
 assert.equal((await broker({settings:{postDiscovery:true}}).send({})).code,'disabled');
});

test('native monitoring may check observed own items on a thread only after current account verification',async()=>{
 const sender={url:'https://www.reddit.com/r/Alpha/comments/parent/title/'};
 const cfg={postDiscovery:false,ownRemoval:true,archiveDiscovery:true};
 const good=broker({settings:cfg,data:[comment('c1')],monitorIdentity:{owner:'t2_self',username:'Example'}});
 const answer=await good.send({monitor:true,owner:'t2_self'},sender);assert.equal(answer.ok,true,answer.error);assert.equal(good.calls.length,1);
 const bad=broker({settings:cfg,data:[],monitorIdentity:{owner:'t2_other',username:'Other'}});assert.equal((await bad.send({monitor:true,owner:'t2_self'},sender)).ok,false);assert.equal(bad.calls.length,0);
 const off=broker({settings:{...cfg,ownRemoval:false},data:[],monitorIdentity:{owner:'t2_self',username:'Example'}});assert.equal((await off.send({monitor:true,owner:'t2_self'},sender)).ok,false);assert.equal(off.calls.length,0);
});

// Signed-in vs signed-out comparison (spec §18).
const pages=(...lists)=>args=>{const index=args.after?Number(args.after.split('=').pop()):0;const items=lists[index] || [];return {items,after:index+1<lists.length?'/svc/shreddit/profiles/profile_overview-more-posts/new/?n='+(index+1):null,hasMore:index+1<lists.length};};
test('what a signed-out visitor sees on your profile is visible; only the rest get direct checks',async t=>{
 const calls=[],many=Array.from({length:60},(_,i)=>['t1',comment('c'+i,{created_utc:created-i*60})]);
 const seen=many.slice(0,55).map(([,d],i)=>({fullname:'t1_'+d.id,created:created-i*60}));
 const s=await view(t,{children:many,publicProofs:{},visitor:pages(seen.slice(0,25),seen.slice(25,50),seen.slice(50)),calls});
 assert.equal(calls.filter(c=>c.action==='removal-public-profile').length,3,'three visitor pages cover 55 items');
 assert.deepEqual(calls.filter(c=>c.action==='removal-public').map(c=>c.fullname).sort(),many.slice(55).map(([,d])=>'t1_'+d.id).sort(),'direct checks only for the 5 the visitor didn’t see');
 assert.match(s.d.status.textContent,/55 readable signed out/);
});
test('the visitor walk stops once it is older than the items being checked',async t=>{
 const calls=[],children=[['t1',comment('new1',{created_utc:created})],['t1',comment('new2',{created_utc:created-60})]];
 const s=await view(t,{children,publicProofs:{},visitor:pages([{fullname:'t1_new1',created},{fullname:'t1_new2',created:created-60},{fullname:'t1_old',created:created-99999}],[{fullname:'t1_older',created:created-999999}]),calls});
 assert.equal(calls.filter(c=>c.action==='removal-public-profile').length,1,'one page reached past the batch');assert.equal(calls.filter(c=>c.action==='removal-public').length,0);
});
test('every item the visitor didn’t see gets a paced signed-out check; a refusal stops the rest',async t=>{
 const calls=[],many=Array.from({length:60},(_,i)=>['t1',comment('k'+i,{created_utc:created-i})]);
 const s=await view(t,{children:many,publicProofs:{},visitor:pages([]),calls});
 assert.equal(calls.filter(c=>c.action==='removal-public').length,60,'no fixed cap');assert.deepEqual(s.shown,[]);
 const refused=[],r=await view(t,{children:many,publicProofs:new Proxy({},{get:(o,k)=>{refused.push(k);return refused.length===3?{status:'unknown',verified:false,why:'Signed-out check unavailable: Reddit blocked logged-out item checks (HTTP 403).'}:undefined;}}),visitor:pages([]),calls:[]});
 assert.match(r.d.notice.title,/Reddit paused signed-out checks/);assert.match(r.d.notice.textContent,/couldn’t be checked/);
});
test('a post the visitor sees beats an archive snapshot that saw it removed early (approved later)',async t=>{
 const children=[['t3',post('gta',{created_utc:created})]];
 const archive=async args=>args.kind==='post'?{ok:true,posts:[{...post('gta'),selftext:'[removed]',removed_by_category:'automod_filtered',retrieved_on:created+22}]}:{ok:true,posts:[]};
 const s=await view(t,{children,settings:{postDiscovery:true,archiveDiscovery:true},archive,publicProofs:{t3_gta:{status:'unknown',verified:false}},visitor:pages([{fullname:'t3_gta',created}])});
 assert.deepEqual(s.shown,[]);
});
test('if the signed-out profile is refused, direct checks still run (capped) and the refusal is reported',async t=>{
 const calls=[],children=[['t1',comment('a')],['t1',comment('b')]];
 const s=await view(t,{children,publicProofs:{t1_a:{status:'visible',verified:true}},calls});
 assert.deepEqual(calls.filter(c=>c.action==='removal-public').map(c=>c.fullname).sort(),['t1_a','t1_b']);assert.match(s.d.notice.title,/signed-out profile couldn’t be read/);
});
test('communities a visitor never sees on your profile (profile curation) are not removal evidence; real differences are checked first',async t=>{
 const calls=[],children=[...Array.from({length:40},(_,i)=>['t1',comment('h'+i,{subreddit:'Hidden',created_utc:created-i*60})]),...Array.from({length:10},(_,i)=>['t1',comment('s'+i,{subreddit:'Shown',created_utc:created-i*60-30})])];
 const visitor=pages([...Array.from({length:8},(_,i)=>({fullname:'t1_s'+i,created:created-i*60-30,subreddit:'Shown'})),{fullname:'t1_older',created:created-99999,subreddit:'Shown'}]);
 const s=await view(t,{children,publicProofs:{},visitor,calls});
 const direct=calls.filter(c=>c.action==='removal-public').map(c=>c.fullname);
 assert.deepEqual(direct.slice(0,2).sort(),['t1_s8','t1_s9'],'the two missing from a community the visitor does see go first');
 assert.equal(direct.filter(id=>id.startsWith('t1_h')).length,40,'hidden-community items are all checked, after the real differences');
 assert.match(s.d.notice.title,/communities a signed-out visitor doesn’t see on your profile/);
});
test('a hidden-community item verified visible never needs archive ID enrichment (captured GTA6 case)',async t=>{
 const calls=[],children=[...Array.from({length:35},(_,i)=>['t1',comment('h'+i,{subreddit:'Hidden',created_utc:created-i*60})]),['t3',post('gta',{subreddit:'GTA6unmoderated',created_utc:created-9000,native:true})],['t1',comment('s0',{subreddit:'Shown',created_utc:created-30})]];
 const archive=async args=>args.kind==='post'?{ok:true,posts:[{...post('gta',{subreddit:'GTA6unmoderated',created_utc:created-9000}),selftext:'[removed]',removed_by_category:'reddit',retrieved_on:created-9000+22}]}:{ok:true,posts:[]};
 const s=await view(t,{children,settings:{postDiscovery:true,archiveDiscovery:true},archive,publicProofs:{t3_gta:{status:'visible',verified:true}},visitor:pages([{fullname:'t1_s0',created:created-30,subreddit:'Shown'},{fullname:'t1_x',created:created-999999,subreddit:'Shown'}]),calls});
 const direct=calls.filter(c=>c.action==='removal-public').map(c=>c.fullname);
 assert.ok(direct.includes('t3_gta'));assert.equal(s.archives.filter(a=>a.action==='archive-removal' && a.ids.includes('gta')).length,0,'current visibility settles the item before archive enrichment');
 assert.equal(s.shown.includes('t3_gta'),false,'visible now, so not listed as removed');
});

// Removed, then deleted by you (spec §18 P3): Arctic Shift history for items no longer on the profile.
test('items no longer on your profile that the archive shows removed are listed as removed, then deleted; self-deleted ones are not',async t=>{
 const archivePosts=[{...post('gone',{created_utc:created-100}),selftext:'Original words',removed_by_category:'moderator',_meta:{removal_type:'moderator',was_deleted_later:true}},
  {...post('selfdel',{created_utc:created-200}),_meta:{removal_type:'deleted'}},{...post('kept',{created_utc:created})}];
 const archive=async args=>args.action==='archive-profile'?{ok:true,posts:args.kind==='post'?archivePosts:[],hasMore:false}:{ok:true,posts:[]};
 const s=await view(t,{children:[['t3',post('kept',{created_utc:created})],['t3',post('old',{created_utc:created-1000})]],settings:{postDiscovery:true,archiveDiscovery:true},archive,publicProofs:{t3_kept:{status:'visible',verified:true},t3_old:{status:'visible',verified:true}},visitor:pages([{fullname:'t3_kept',created},{fullname:'t3_old',created:created-1000}])});
 assert.deepEqual(s.shown,['t3_gone']);assert.match(s.pill('t3_gone').textContent,/^Removed by moderators, then deleted by you/);
 assert.ok(s.archives.some(a=>a.action==='archive-profile' && a.kind==='post' && a.username==='Example'));
});
test('with the archive off, removed-then-deleted is skipped and said so',async t=>{
 const s=await view(t,{children:[['t3',post('kept')]],publicProofs:{t3_kept:{status:'visible',verified:true}},visitor:pages([{fullname:'t3_kept',created}])});
 assert.equal(s.archives.some(a=>a.action==='archive-profile'),false);assert.match(s.d.notice.title,/Turn on “Use the archive” to include items you deleted after a removal/);
});
test('the Subreddit menu on Removed offers only communities with removals, counted on the current tab',async t=>{
 const s=await view(t,{children:[['t3',post('m1',{subreddit:'Alpha',removed_by_category:'moderator'})],['t3',post('m2',{subreddit:'Alpha',removed_by_category:'moderator'})],['t3',post('m3',{subreddit:'Beta',removed_by_category:'automod_filtered'})],...Array.from({length:6},(_,i)=>['t3',post('v'+i,{subreddit:'Gamma'})])],publicProofs:{}});
 assert.deepEqual(JSON.parse(JSON.stringify(s.d.subredditCounts().entries)),[{key:'Alpha',count:2},{key:'Beta',count:1}],'no Gamma: nothing was removed there');
 s.d.context.type='comments';assert.deepEqual(JSON.parse(JSON.stringify(s.d.subredditCounts().entries)),[],'the Comments tab counts only removed comments');
});
test('the notice is one short line; the reasons are in its tooltip',async t=>{
 const s=await view(t,{children:[['t1',comment('a')],['t1',comment('b')]],publicProofs:{}});
 assert.equal(s.d.notice.textContent,'2 couldn’t be checked');assert.match(s.d.notice.title,/2 comments couldn’t be checked/);assert.match(s.d.notice.title,/\n/);
});
test('the All tab is drawn and selected; Reddit’s Posts highlight moves to the tab the list shows (live: Posts stayed highlighted)',async t=>{
 const s=await view(t,{children:[['t3',post('m1',{removed_by_category:'moderator'})],['t1',comment('c1',{removed_by_category:'moderator'})]],publicProofs:{}});
 const W=s.W,group=W.document.getElementById('search-results-page-tabgroup'),tabs=()=>[...group.querySelectorAll(':scope > a')];
 W.customElements.define('faceplate-tabgroup',class extends W.HTMLElement{get pages(){return this._pages;}set pages(v){this._pages=v;}get pageIndex(){return this._index;}set pageIndex(v){this._index=v;}});
 s.d.syncOwnListTabs();await flush();
 assert.deepEqual(tabs().map(a=>a.textContent.trim()+'@'+a.getAttribute('slot')),['All@page-1','Posts@page-2','Comments@page-3','Media@page-4'],'every tab sits in a slot Reddit draws');
 assert.equal(group.pages,4);assert.equal(group.pageIndex,1);
 const selected=tabs().filter(a=>a.hasAttribute('faceplate-tab-selected') || /tab-selected/.test(a.className)).map(a=>a.textContent.trim());assert.deepEqual(selected,['All']);
 assert.match(tabs()[0].className,/bg-secondary-background-selected/);assert.doesNotMatch(tabs()[1].className,/bg-secondary-background-selected|tab-selected/);
 s.d.context.type='posts';s.d.syncOwnListTabs();await flush();assert.equal(group.pageIndex,2);assert.deepEqual(tabs().filter(a=>/tab-selected/.test(a.className)).map(a=>a.textContent.trim()),['Posts']);
});
test('cached signed-out results skip the visitor walk and direct checks; new results are saved without text',async t=>{
 const calls=[],saved=[],now=Date.now();
 const s=await view(t,{children:[['t1',comment('cached',{created_utc:created})],['t1',comment('fresh',{created_utc:created-60})]],publicProofs:{t1_fresh:{status:'removed',verified:true}},visitor:pages([]),calls,cache:{t1_cached:{status:'visible',checkedAt:now-60000}},saved});
 assert.equal(calls.filter(c=>c.action==='removal-public' && c.fullname==='t1_cached').length,0,'cached: no signed-out request');
 assert.equal(calls.filter(c=>c.action==='removal-public' && c.fullname==='t1_fresh').length,1);
 assert.deepEqual(JSON.parse(JSON.stringify(saved.map(p=>[p.fullname,p.status]))),[['t1_fresh','removed']],'only new verified results are saved');assert.equal(Object.keys(saved[0]).sort().join(),'checkedAt,fullname,status');
 assert.deepEqual(s.shown,['t1_fresh']);
 const again=[],quiet=await view(t,{children:[['t1',comment('cached',{created_utc:created})]],publicProofs:{},visitor:pages([]),calls:again,cache:{t1_cached:{status:'visible',checkedAt:now}}});
 assert.equal(again.filter(c=>c.action==='removal-public-profile' || c.action==='removal-public').length,0,'everything cached: no signed-out reads at all');
});


test('archive enrichment follows public checks and skips visible, self-deleted and explicit native removal causes',async t=>{
 const order=[],s=await view(t,{children:[['t1',comment('visible')],['t1',comment('unresolved')],['t3',post('native',{removed_by_category:'moderator',native:true})],['t1',comment('selfdel',{body:'[deleted]'})],['t3',post('private',{subreddit_type:'private',native:true})]],settings:{postDiscovery:true,archiveDiscovery:true},publicProofs:new Proxy({},{get:(o,k)=>{order.push(k);return {status:k==='t1_visible'?'visible':k==='t1_selfdel'?'deleted':'unknown',verified:k==='t1_visible' || k==='t1_selfdel'};}}),visitor:pages([]),archive:async args=>{if(args.action==='archive-removal')order.push('archive:'+args.ids.join(','));return {ok:true,posts:[],hasMore:false};}});
 const lookups=s.archives.filter(a=>a.action==='archive-removal');assert.equal(lookups.length,1);assert.deepEqual([...lookups[0].ids],['unresolved']);assert.ok(order.indexOf('archive:unresolved')>order.indexOf('t1_unresolved'));assert.equal(lookups[0].owner,'t2_self');
});
