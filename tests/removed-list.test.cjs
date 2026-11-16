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
async function view(t,{children,settings={postDiscovery:true,archiveDiscovery:false},archive,publicProofs,visitor,calls=[],cache=null,saved=[],ownList,before,emptyRead,publicDelay=0,list=[],listSaved=[],q='',search='',type=children?.every(([kind])=>kind==='t1')?'comments':'posts'}={}){
 const dom=new JSDOM(page,{url:'https://www.reddit.com/user/Example/search/?rt_list=removed&type='+type+(q?'&q='+encodeURIComponent(q):'')+search,runScripts:'outside-only',pretendToBeVisual:true}),W=dom.window,archives=[];let d;
 t.after(()=>{d?.destroy();W.close();});
 for(const file of ['search-core.js','post-model.js','feed-filters.js','removal-model.js','post-discovery.js'])W.eval(read(file));
 const M=W.RTPostModel;if(publicProofs)W.RTNativeRemoval={identity:()=>({owner:'t2_self',username:'Example'})};
 const reddit=async args=>{
  if(args.action==='own-list-identity')return {username:'Example'};
  calls.push(args);
  if(args.action==='render-search-empty'){if(emptyRead)return emptyRead(args,W);W.document.getElementById(args.target).innerHTML='<faceplate-partial><div class="flex flex-col items-center" data-testid="search-error-message"><img data-native-empty-art="true" alt="" src="https://www.redditstatic.com/synthetic-thinking.svg"><div class="text-neutral-content-strong font-bold">Hm...we couldn’t find any results for "rt-empty-synthetic"</div><div class="text-neutral-content-weak">Double-check your spelling or try different keywords</div><div data-testid="search-error-message-ctas"><adjust-search-query-link><button data-testid="search-error-message-primary-cta">Adjust your search</button></adjust-search-query-link></div></div></faceplate-partial>';return {rendered:true};}
  if(args.action==='removal-public-profile'){assert.equal(args.owner,'t2_self');if(!visitor)throw Error('Reddit blocked the signed-out profile (HTTP 403).');return visitor(args);}
  if(args.action==='removal-public'){assert.equal(args.owner,'t2_self');if(publicDelay){await new Promise(r=>setTimeout(r,publicDelay));calls.push({action:'public-done',fullname:args.fullname});}return {proof:{fullname:args.fullname,...(publicProofs?.[args.fullname] || {status:'unknown',verified:false})}};}
  if(args.action==='own-list' && ownList)return ownList(args,M);
  if(args.action==='own-list'){assert.equal(args.list,'removed');const posts=children.map(([kind,data])=>{const item=kind==='t3'?M.normalizePost(data):M.normalizeComment(data);item.moderation={category:data.removed_by_category ?? null,removalReason:Boolean(data.removal_reason),locked:data.locked===true,subredditType:data.subreddit_type || 'public',quarantined:false,authorBody:kind==='t3'?data.selftext:data.body,...(data.native?{native:true}:{})};return item;});return {posts,scanned:posts.length,hasMore:false,after:null};}
  throw Error('Unexpected request: '+args.action);
 };
 d=new W.RTPostDiscovery.Discovery({observe:false,autoDiscover:false,removalCache:async message=>{if(message.action==='proofs-load')return {ok:true,proofs:cache || {}};if(message.action==='list-load')return {ok:true,items:list,savedAt:1};if(message.action==='list-save'){listSaved.push(message.items);return {ok:true};}saved.push(...message.proofs);return {ok:true};},reddit,archive:async args=>{archives.push(args);if(!archive)throw Error('No archive expected');return archive(args,W);},readSettings:async()=>({'rt-settings-v1':settings})});
 d.removalGapMs=0;d.archiveRetryMs=0;await d.ready;await flush();await before?.(d);await d.refreshActivity();await flush();
 const shown=[...d.nodes.values()].filter(n=>!n.hidden).map(n=>n.dataset.fullname);
 const pill=name=>[...d.nodes.values()].find(n=>n.dataset.fullname===name)?.querySelector('.rt-removal-pill');
 return {W,d,archives,shown,pill};
}

test('rt_list=removed is an own list route; other accounts cannot open it',async t=>{
 const s=await view(t,{children:[]});const route=s.W.RTPostDiscovery.pageRoute;
 assert.equal(route('/user/Example/search/','?rt_list=removed').list,'removed');assert.equal(route('/user/Example/search/','?rt_list=removed').type,'posts');
 assert.equal(route('/user/Other/search/','?rt_list=removed','Example'),null);
});

test('Removed shows only your removed posts, each with its state pill and evidence tooltip',async t=>{
 const s=await view(t,{children:[['t3',post('visible1')],['t3',post('modpost',{removed_by_category:'moderator'})],['t3',post('autopost',{removed_by_category:'automod_filtered'})],['t3',post('adminpost',{removed_by_category:'anti_evil_ops'})],['t3',post('mine',{removed_by_category:'deleted',selftext:'[deleted]'})],['t1',comment('c1')]]});
 assert.deepEqual(s.shown.sort(),['t3_adminpost','t3_autopost','t3_modpost']);
 assert.equal(s.pill('t3_modpost').dataset.rtRemoval,'removed-mod');assert.match(s.pill('t3_modpost').dataset.rtLabel,/^Removed by moderators$/);assert.match(s.pill('t3_modpost').title,/Reddit marks this post as removed by moderators/);
 assert.equal(s.pill('t3_autopost').dataset.rtLabel,'Removed automatically');assert.equal(s.pill('t3_adminpost').dataset.rtLabel,'Removed by Reddit');
 assert.equal(s.d.status.textContent,'Checked your newest 5 posts · 3 removed');
 // The Posts and Comments tabs count only what they list (no comments counted under Posts).
 s.d.context.type='posts';s.d.summarizeRemoved();assert.equal(s.d.status.textContent,'Checked your newest 5 posts · 3 removed');
 s.d.context.type='comments';s.d.summarizeRemoved();assert.equal(s.d.status.textContent,'Checked your newest 1 comments · 0 removed');
 s.d.context.type='posts';s.d.setFilters?.({...s.d.rtFilters,subreddits:['Other']});s.d.summarizeRemoved();assert.match(s.d.status.textContent,/^Checked your newest 0 posts · 0 removed/,'a community filter scopes the counts too');
 s.d.rtFilters={...s.d.rtFilters,subreddits:[]};s.d.context.type='comments';s.d.summarizeRemoved();
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
 assert.deepEqual(s.shown,['t1_auto1']);assert.equal(s.pill('t1_auto1').dataset.rtLabel,'Removed automatically (likely)');assert.match(s.pill('t1_auto1').title,/10 seconds after posting/);
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
 assert.deepEqual(s.shown,[]);assert.equal(s.d.listEmpty.hidden,false);assert.equal(s.d.listEmpty.querySelector('[data-testid="search-error-message"] > div').textContent,'Hm...we couldn’t find any results','Reddit’s own title, without the template query');assert.doesNotMatch(s.d.listEmpty.textContent,/rt-empty|No removed/);
});

test('native metadata without a visibility verdict remains unchecked and exposes its limit',async t=>{
 const s=await view(t,{children:[['t3',post('a')]]});const item=[...s.d.listState.items.values()][0];item.moderation.visibilityKnown=false;
 await s.d.classifyRemoved([item],s.d.context);s.d.renderOwnList();assert.equal(item.removal.state,'unknown');assert.match(s.d.notice.title,/native metadata does not establish public visibility/);assert.match(s.d.listEmpty.textContent,/could not be verified/i);
});
test('native Removed pages state their coverage limit and use archive evidence for own posts too',async t=>{
 const s=await view(t,{children:[['t3',post('auto1')]]});const p=[...s.d.listState.items.values()][0];Object.assign(p.moderation,{native:true,nativeRemoved:true,visibilityKnown:false});s.d.settings.archiveDiscovery=true;
 s.d.archive=async args=>{assert.equal(args.kind,'post');return {posts:[s.W.RTPostModel.normalizePost({...post('auto1'),selftext:'[removed]',retrieved_on:created+10},{source:'arctic-shift'})]};};
 await s.d.classifyRemoved([p],s.d.context);assert.equal(p.removal.state,'removed-auto');assert.equal(p.removal.confidence,'likely');s.d.listState.native=true;s.d.listState.capped=true;s.d.summarizeRemoved();assert.match(s.d.notice.title,/Stopped after .*safety limit/i);assert.doesNotMatch(s.d.notice.title,/newest 1,000/);
});
test('Removed uses fresh unsigned evidence; search absence or an unreadable public response is not removal',async t=>{
 const s=await view(t,{type:'comments',children:[['t3',post('oldmod',{removed_by_category:'moderator'})],['t1',comment('publicremoved')],['t1',comment('missing')]],publicProofs:{t3_oldmod:{status:'visible',verified:true,moderation:'approved'},t1_publicremoved:{status:'removed',verified:true}}});
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
 assert.deepEqual(s.shown,['t3_gone']);assert.match(s.pill('t3_gone').dataset.rtLabel,/^Removed by moderators, then deleted by you/);
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
test('Removed search uses Reddit’s Posts, Comments and Media tabs with Posts selected by default',async t=>{
 const s=await view(t,{children:[['t3',post('m1',{removed_by_category:'moderator'})],['t1',comment('c1',{removed_by_category:'moderator'})]],publicProofs:{}});
 const W=s.W,group=W.document.getElementById('search-results-page-tabgroup'),tabs=()=>[...group.querySelectorAll(':scope > a')];
 assert.equal(W.document.getElementById('rt-own-list-types'),null);assert.equal(group.hidden,false);assert.deepEqual(tabs().map(a=>a.textContent.trim()),['Posts','Comments','Media']);
 assert.deepEqual(tabs().filter(a=>a.getAttribute('aria-current')==='page').map(a=>a.textContent.trim()),['Posts']);assert.ok(tabs().every(a=>new URL(a.href).searchParams.get('rt_list')==='removed'));
 s.d.context.type='comments';s.d.syncOwnListTabs();assert.deepEqual(tabs().filter(a=>a.getAttribute('aria-current')==='page').map(a=>a.textContent.trim()),['Comments']);
});
test('cached signed-out results skip the visitor walk and direct checks; new results are saved without text',async t=>{
 const calls=[],saved=[],now=Date.now();
 const s=await view(t,{children:[['t1',comment('cached',{created_utc:created})],['t1',comment('fresh',{created_utc:created-60})]],publicProofs:{t1_fresh:{status:'removed',verified:true}},visitor:pages([]),calls,cache:{t1_cached:{status:'visible',checkedAt:now-60000}},saved});
 assert.equal(calls.filter(c=>c.action==='removal-public' && c.fullname==='t1_cached').length,0,'cached: no signed-out request');
 assert.equal(calls.filter(c=>c.action==='removal-public' && c.fullname==='t1_fresh').length,1);
 assert.deepEqual(JSON.parse(JSON.stringify(saved.map(p=>[p.fullname,p.status]))),[['t1_fresh','removed']],'only new verified results are saved');assert.equal(Object.keys(saved[0]).sort().join(),'checkedAt,created,fullname,status','status, time and item date only');
 assert.deepEqual(s.shown,['t1_fresh']);
 const again=[],quiet=await view(t,{children:[['t1',comment('cached',{created_utc:created})]],publicProofs:{},visitor:pages([]),calls:again,cache:{t1_cached:{status:'visible',checkedAt:now}}});
 assert.equal(again.filter(c=>c.action==='removal-public-profile' || c.action==='removal-public').length,0,'everything cached: no signed-out reads at all');
});


test('archive enrichment follows public checks and skips visible, self-deleted and explicit native removal causes',async t=>{
 const order=[],s=await view(t,{children:[['t1',comment('visible')],['t1',comment('unresolved')],['t3',post('native',{removed_by_category:'moderator',native:true})],['t1',comment('selfdel',{body:'[deleted]'})],['t3',post('private',{subreddit_type:'private',native:true})]],settings:{postDiscovery:true,archiveDiscovery:true},publicProofs:new Proxy({},{get:(o,k)=>{order.push(k);return {status:k==='t1_visible'?'visible':k==='t1_selfdel'?'deleted':'unknown',verified:k==='t1_visible' || k==='t1_selfdel'};}}),visitor:pages([]),archive:async args=>{if(args.action==='archive-removal')order.push('archive:'+args.ids.join(','));return {ok:true,posts:[],hasMore:false};}});
 const lookups=s.archives.filter(a=>a.action==='archive-removal');assert.equal(lookups.length,1);assert.deepEqual([...lookups[0].ids],['unresolved']);assert.ok(order.indexOf('archive:unresolved')>order.indexOf('t1_unresolved'));assert.equal(lookups[0].owner,'t2_self');
});


for(const type of ['posts','comments','media'])test(`Removed search ${type} keeps removals and removed-then-deleted records in their own content view`,async t=>{
 const s=await view(t,{children:[['t3',post('post',{removed_by_category:'moderator'})],['t1',comment('comment',{removed_by_category:'moderator'})]]}),M=s.W.RTPostModel;
 for(const [kind,id] of [['post','oldpost'],['comment','oldcomment']]){const p=kind==='post'?M.normalizePost(post(id)):M.normalizeComment(comment(id));p.removal={removed:true,state:'moderator-removed',label:'Removed by moderators',confidence:'confirmed',flags:['deleted-later'],why:'Historical removal evidence'};s.d.listState.items.set(p.fullname,p);}
 const image=M.normalizePost(post('image'));image.postType='image';image.removal={removed:true,state:'moderator-removed',label:'Removed by moderators',confidence:'confirmed',flags:[],why:'Native removal'};s.d.listState.items.set(image.fullname,image);
 s.W.history.replaceState({},'','?rt_list=removed&type='+type);s.d.context={...s.d.context,type};s.d.renderOwnList();s.d.syncOwnListTabs();
 const visible=[...s.d.nodes.values()].filter(n=>!n.hidden);assert.equal(visible.length,type==='posts'?3:type==='comments'?2:1);assert.ok(visible.every(n=>n.querySelector('[data-rt-search-unit="'+(type==='comments'?'comment':'post')+'"]')));assert.equal(s.W.document.querySelector('[aria-current="page"][href*="type='+type+'"]')?.textContent,type[0].toUpperCase()+type.slice(1));
});

for(const empty of [false,true])test(`archive recovery includes older removed-then-deleted posts and comments (empty profile=${empty})`,async t=>{
 const archive=async args=>({posts:args.kind==='post'?[{...post('oldpost',{created_utc:created-1000000,removed_by_category:'moderator'}),_meta:{removal_type:'deleted',was_deleted_later:true}},post('ordinary',{created_utc:created-1000001}),post('onlyremoved',{created_utc:created-1000002,removed_by_category:'moderator'}),{...post('selfonly',{created_utc:created-1000003}),_meta:{removal_type:'deleted'}}]:[{...comment('oldcomment',{created_utc:created-2000000,removed_by_category:'moderator'}),_meta:{removal_type:'deleted',was_deleted_later:true}}],hasMore:false});
 const s=await view(t,{children:empty?[]:[['t3',post('live',{removed_by_category:'moderator'})]],type:'posts',settings:{postDiscovery:true,archiveDiscovery:true},archive});
 assert.ok(s.d.listState.items.has('oldpost'));assert.ok(s.d.listState.items.has('t1_oldcomment'));assert.equal(s.d.listState.items.has('ordinary'),false);assert.equal(s.d.listState.items.has('onlyremoved'),false);assert.equal(s.d.listState.items.has('selfonly'),false);assert.ok(s.pill('t3_oldpost').dataset.rtLabel.includes('then deleted'));
 assert.equal(s.archives.filter(a=>a.action==='archive-profile').length,2);
});
test('archive recovery enriches a current deleted item but never overrides a current visible item',async t=>{
 const s=await view(t,{children:[['t3',post('deleted',{selftext:'[deleted]',removed_by_category:'deleted'})],['t3',post('visible')]],publicProofs:{t3_deleted:{status:'deleted',verified:true},t3_visible:{status:'visible',verified:true}},visitor:pages([{fullname:'t3_visible',created}]),settings:{postDiscovery:true,archiveDiscovery:true},archive:async args=>({posts:args.kind==='post'?[post('deleted',{removed_by_category:'moderator'}),{...post('visible',{removed_by_category:'moderator'}),_meta:{removal_type:'deleted'}}]:[],hasMore:false})});
 assert.deepEqual(s.shown,['t3_deleted']);assert.ok(s.pill('t3_deleted').dataset.rtLabel.includes('then deleted'));assert.equal(s.d.listState.items.get('visible').removal.state,'visible');
});
test('archive history stops repeated/stalled cursors with an honest coverage note',async t=>{
 const calls=[];const s=await view(t,{children:[],settings:{postDiscovery:true,archiveDiscovery:true},archive:async args=>{calls.push(args);return {posts:[args.kind==='post'?post('same'):comment('same')],hasMore:true,before:created,cursorStalled:args.before===created};}});
 assert.equal(calls.length,4);assert.match(s.d.notice.title,/archive.*(?:cursor|pagination).*incomplete/i);
});
const native=(M,kind,data)=>{const item=kind==='t3'?M.normalizePost(data):M.normalizeComment(data);item.moderation={category:data.removed_by_category ?? null,removalReason:false,locked:false,subredditType:'public',quarantined:false,authorBody:kind==='t3'?data.selftext:data.body};return item;};
test('archive history only stops at its safety bound, and says so',async t=>{
 let n=0;const s=await view(t,{children:[],settings:{postDiscovery:true,archiveDiscovery:true},before:d=>{d.removedHistoryPages=10;},archive:async args=>{n++;return {posts:[args.kind==='post'?post('p'+n,{created_utc:created-n}):comment('c'+n,{created_utc:created-n})],hasMore:true,before:created-n};}});
 assert.equal(n,20);assert.match(s.d.notice.title,/archive.*10 pages.*incomplete/i);
});
test('archive history is read until Arctic Shift has nothing left, past 50 pages',async t=>{
 const pages={post:0,comment:0};const s=await view(t,{children:[],settings:{postDiscovery:true,archiveDiscovery:true},archive:async args=>{const n=++pages[args.kind];return {posts:[args.kind==='post'?post('p'+n,{created_utc:created-n}):comment('c'+n,{created_utc:created-n})],hasMore:n<70,before:created-n};}});
 assert.deepEqual({...pages},{post:70,comment:70});assert.doesNotMatch(s.d.notice.title || '',/stopped at|incomplete/i);
});
test('Removed reads your whole profile until Reddit has nothing left, past 1,000 items',async t=>{
 const calls=[],total=1125,ownList=(args,M)=>{if(args.source==='posts')return {posts:[],scanned:0,hasMore:false,after:null};const page=args.after?Number(args.after):0,items=[];for(let i=page*25;i<Math.min(total,page*25+25);i++)items.push(native(M,'t1',comment('c'+i,{created_utc:created-i})));const more=(page+1)*25<total;return {posts:items,scanned:items.length,hasMore:more,after:more?String(page+1):null};};
 const visitor=()=>({items:Array.from({length:total},(_,i)=>({fullname:'t1_c'+i,created:created-i,subreddit:'alpha'})),after:null});
 const s=await view(t,{ownList,visitor,calls,publicProofs:{}});
 assert.equal(calls.filter(c=>c.action==='own-list' && !c.source).length,46,'45 pages and one confirmation of the last');
 assert.equal(s.d.listState.scanned,total);assert.equal(s.d.listState.capped,false);assert.equal(s.d.listState.done,true);assert.doesNotMatch(s.d.notice.title || '',/stopped|1,000|coverage may be incomplete/i);
});
test('the signed-out comparison follows the visitor profile past 60 pages when your items go back that far',async t=>{
 const calls=[],ownList=(args,M)=>({posts:[native(M,'t1',comment('old',{created_utc:created-100}))],scanned:1,hasMore:false,after:null});
 const visitor=args=>{const n=args.after?Number(args.after):0;return n<70?{items:[{fullname:'t1_v'+n,created:created-n,subreddit:'alpha'}],after:String(n+1)}:{items:[{fullname:'t1_old',created:created-100,subreddit:'alpha'}],after:null};};
 await view(t,{ownList,visitor,calls,publicProofs:{}});
 assert.equal(calls.filter(c=>c.action==='removal-public-profile').length,71);assert.equal(calls.filter(c=>c.action==='removal-public').length,0,'found by the walk, so no single check');
});
test('posts older than the 1,000-item Overview window are walked from the Posts tab and compared signed out',async t=>{
 const calls=[],ownList=(args,M)=>{
  if(args.source==='posts')return {posts:[native(M,'t3',post('recent',{created_utc:created})),native(M,'t3',post('old',{created_utc:created-9000000}))],scanned:2,hasMore:false,after:null};
  return args.after?{posts:[native(M,'t1',comment('c2'))],scanned:1,hasMore:true,after:'o3'}:{posts:[native(M,'t3',post('recent')),native(M,'t1',comment('c1'))],scanned:2,hasMore:true,after:'o2'};};
 const visitor=args=>args.source==='posts'?{items:[{fullname:'t3_recent',created,subreddit:'alpha'}],after:null}:{items:[{fullname:'t3_recent',created,subreddit:'alpha'},{fullname:'t1_c1',created,subreddit:'alpha'},{fullname:'t1_c2',created,subreddit:'alpha'}],after:null};
 const s=await view(t,{ownList,visitor,calls,publicProofs:{t3_old:{status:'removed',verified:true}},before:d=>{d.ownListCap=3;}});
 const own=calls.filter(c=>c.action==='own-list');assert.deepEqual(own.map(c=>[c.source || 'overview',c.after || null]),[['overview',null],['overview','o2'],['posts',null]],'Overview stops at the window, then the Posts tab is walked from its start');
 assert.ok(calls.some(c=>c.action==='removal-public-profile' && c.source==='posts'),'the signed-out Posts tab is compared');
 assert.deepEqual(calls.filter(c=>c.action==='removal-public').map(c=>c.fullname),['t3_old'],'only the post a visitor did not see is checked directly');
 assert.deepEqual(s.shown,['t3_old']);assert.equal([...s.d.listState.items.keys()].filter(k=>/recent/.test(k)).length,1,'a post in both walks is listed once');
});
test('the Posts tab is always read after Overview, so posts survive a feed Reddit cut short',async t=>{
 const calls=[],ownList=(args,M)=>args.source==='posts'?{posts:[native(M,'t3',post('one')),native(M,'t3',post('older',{created_utc:created-500}))],scanned:2,hasMore:false,after:null}:{posts:[native(M,'t3',post('one'))],scanned:1,hasMore:false,after:null};
 const s=await view(t,{ownList,calls,visitor:args=>({items:[{fullname:'t3_one',created,subreddit:'alpha'}],after:null}),publicProofs:{t3_older:{status:'removed',verified:true}}});
 assert.equal(calls.filter(c=>c.action==='own-list' && c.source==='posts').length,1);assert.deepEqual(s.shown,['t3_older']);
});
test('a continuation page that ends the profile is read once more before the walk ends',async t=>{
 const calls=[],seen={};const ownList=(args,M)=>{if(args.source==='posts')return {posts:[],scanned:0,hasMore:false,after:null};const at=args.after || 'start',n=seen[at]=(seen[at] || 0)+1;
  if(at==='start')return {posts:[native(M,'t1',comment('a'))],scanned:1,hasMore:true,after:'p2'};
  if(at==='p2')return n===1?{posts:[native(M,'t1',comment('b'))],scanned:1,hasMore:false,after:null}:{posts:[native(M,'t1',comment('b'))],scanned:1,hasMore:true,after:'p3'};
  return {posts:[native(M,'t1',comment('c'))],scanned:1,hasMore:false,after:null};};
 const s=await view(t,{ownList,calls,visitor:()=>({items:['a','b','c'].map(id=>({fullname:'t1_'+id,created,subreddit:'alpha'})),after:null}),publicProofs:{}});
 assert.deepEqual(calls.filter(c=>c.action==='own-list' && !c.source).map(c=>c.after || null),[null,'p2','p2','p3','p3']);assert.ok(['t1_a','t1_b','t1_c'].every(k=>s.d.listState.items.has(k)));
});
test('archive recovery starts with the profile walk instead of after it',{timeout:5000},async t=>{
 let release;const gate=new Promise(r=>release=r),order=[];
 const ownList=async(args,M)=>{order.push('own-list');await gate;return {posts:[native(M,'t3',post('live',{removed_by_category:'moderator'}))],scanned:1,hasMore:false,after:null};};
 const archive=async args=>{order.push(args.action);if(args.action==='archive-profile' && order.filter(a=>a==='archive-profile').length===2)release();return {posts:[],hasMore:false};};
 const s=await view(t,{ownList,archive,settings:{postDiscovery:true,archiveDiscovery:true}});
 assert.ok(order.indexOf('archive-profile')>-1 && order.indexOf('archive-profile')<order.lastIndexOf('own-list')+2,'history was requested while the first profile page was still pending (the page waits for it)');assert.deepEqual(s.shown,['t3_live']);
});
test('a failed archive history page is retried before recovery gives up',async t=>{
 let failures=0;const archive=async args=>{if(args.action==='archive-profile' && args.kind==='comment' && failures++<1)throw Error('Archive service could not load posts.');return {posts:args.kind==='comment'?[{...comment('gone',{created_utc:created-50,removed_by_category:'moderator'}),_meta:{removal_type:'deleted',was_deleted_later:true}}]:[],hasMore:false};};
 const s=await view(t,{children:[],archive,settings:{postDiscovery:true,archiveDiscovery:true}});
 assert.ok(s.d.listState.items.has('t1_gone'),'recovered after the retry');assert.doesNotMatch(s.d.notice.title || '',/didn’t answer for deleted items/);
});
test('the next profile page is requested while the previous page is still being checked signed out',async t=>{
 const calls=[],ownList=(args,M)=>args.after?{posts:[native(M,'t1',comment('b'))],scanned:1,hasMore:false,after:null}:{posts:[native(M,'t1',comment('a'))],scanned:1,hasMore:true,after:'p2'};
 await view(t,{ownList,calls,visitor:()=>({items:[],after:null}),publicProofs:{t1_a:{status:'removed',verified:true},t1_b:{status:'removed',verified:true}},publicDelay:40});
 const page2=calls.findIndex(c=>c.action==='own-list' && c.after==='p2'),aDone=calls.findIndex(c=>c.action==='public-done' && c.fullname==='t1_a');
 assert.ok(page2>-1 && aDone>-1 && page2<aDone,'page 2 is fetched before page 1 finishes its checks');
});

test('an archived removal that your complete profile no longer lists is shown as gone',async t=>{
 const archive=async args=>({posts:args.kind==='post'?[post('spam',{created_utc:created-50,removed_by_category:'reddit',selftext:'[removed]'}),post('live',{created_utc:created-60,removed_by_category:'reddit',selftext:'[removed]'}),post('plain',{created_utc:created-70})]:[],hasMore:false});
 const s=await view(t,{children:[['t3',post('live',{created_utc:created-60,removed_by_category:'reddit',native:true})]],settings:{postDiscovery:true,archiveDiscovery:true},archive});
 assert.ok(s.shown.includes('t3_spam'));assert.match(s.pill('t3_spam').dataset.rtLabel,/no longer on your profile/);assert.equal(s.d.listState.items.get('spam').source,'arctic-shift');
 assert.notEqual(s.d.listState.items.get('live').source,'arctic-shift','a live item keeps its live record');assert.equal(s.d.listState.items.has('plain'),false,'no removal evidence, not listed');
});
test('archive records wait until the profile walk has passed their date before they are added',async t=>{
 let release;const gate=new Promise(r=>release=r),seen=[];
 const ownList=async(args,M)=>{if(args.source==='posts')return {posts:[],scanned:0,hasMore:false,after:null};if(!args.after)return {posts:[native(M,'t1',comment('new',{created_utc:created}))],scanned:1,hasMore:true,after:'p2'};await gate;return {posts:[native(M,'t3',post('older',{created_utc:created-100}))],scanned:1,hasMore:false,after:null};};
 const archive=async args=>{const r={posts:args.kind==='post'?[{...post('older',{created_utc:created-100,removed_by_category:'moderator'}),_meta:{removal_type:'deleted',was_deleted_later:true}}]:[],hasMore:false};setTimeout(()=>{seen.push([...view.state?.items.keys() || []]);release();},20);return r;};
 const s=await view(t,{ownList,archive,settings:{postDiscovery:true,archiveDiscovery:true},visitor:()=>({items:[{fullname:'t1_new',created,subreddit:'alpha'},{fullname:'t3_older',created:created-100,subreddit:'alpha'}],after:null}),publicProofs:{},before:d=>{view.state=null;const orig=d.loadOwnList.bind(d);d.loadOwnList=async(...a)=>{view.state=d.listState;return orig(...a);};}});
 assert.ok(seen.length && !seen[0].includes('older'),'not added while the walk had not reached its date');assert.notEqual(s.d.listState.items.get('older').source,'arctic-shift','the live record decides');assert.equal(s.shown.includes('t3_older'),false);
});

const savedItem=(id,extra={})=>({fullname:'t3_'+id,kind:'post',id,created:created-10,subreddit:'Alpha',permalink:'/r/Alpha/comments/'+id+'/title/',title:'Saved needle '+id,body:'Saved body',source:'reddit',removal:{state:'removed-mod',confidence:'verified',why:'Earlier check',flags:[]},...extra});
test('reopening Removed shows the saved list at once, before the profile walk answers',async t=>{
 let d,atFirstPage=null;const ownList=(args,M)=>{if(atFirstPage==null)atFirstPage=[...d.nodes.values()].filter(n=>!n.hidden).map(n=>n.dataset.fullname);return args.source==='posts'?{posts:[],scanned:0,hasMore:false,after:null}:{posts:[native(M,'t3',post('kept',{created_utc:created-10,removed_by_category:'moderator'}))],scanned:1,hasMore:false,after:null};};
 const listSaved=[],s=await view(t,{ownList,list:[savedItem('kept'),savedItem('stale')],listSaved,publicProofs:{},visitor:()=>({items:[],after:null}),before:x=>{d=x;}});
 assert.deepEqual(atFirstPage.sort(),['t3_kept','t3_stale'],'saved removals are shown before the first page arrives');
 assert.deepEqual(s.shown,['t3_kept'],'the complete walk confirms kept and drops what it no longer finds');assert.equal(s.d.listState.items.get('kept').saved,undefined,'the live record replaced the saved one');
 assert.equal(listSaved.length,1);assert.deepEqual([...listSaved[0]].map(i=>i.fullname),['t3_kept']);assert.equal(listSaved[0][0].title,'Synthetic kept');
});
test('Removed search matches saved items immediately',async t=>{
 let d,atFirstPage=null;const ownList=(args,M)=>{if(atFirstPage==null)atFirstPage=[...d.nodes.values()].filter(n=>!n.hidden).map(n=>n.dataset.fullname);return {posts:[],scanned:0,hasMore:false,after:null};};
 await view(t,{ownList,q:'needle',list:[savedItem('match'),savedItem('other',{title:'Unrelated',body:'nothing'})],publicProofs:{},visitor:()=>({items:[],after:null}),before:x=>{d=x;}});
 assert.deepEqual(atFirstPage,['t3_match']);
});
test('signed-out results are saved with the item date so settled items keep them longer',async t=>{
 const saved=[];await view(t,{children:[['t1',comment('dated',{created_utc:created-77})]],publicProofs:{t1_dated:{status:'removed',verified:true}},visitor:()=>({items:[],after:null}),saved});
 assert.equal(saved.find(p=>p.fullname==='t1_dated')?.created,created-77);
});
test('a deferred profile-list read is retried rather than reported as a failure',async t=>{
 let n=0;const ownList=(args,M)=>{if(args.source==='posts')return {posts:[],scanned:0,hasMore:false,after:null};if(!n++)return {deferred:true,retryAfterMs:1};return {posts:[native(M,'t3',post('ok',{removed_by_category:'moderator'}))],scanned:1,hasMore:false,after:null};};
 const s=await view(t,{ownList,publicProofs:{},visitor:()=>({items:[],after:null})});assert.equal(s.d.listState.error,'');assert.deepEqual(s.shown,['t3_ok']);
});
test('a saved archive card is updated in place when the fresh archive history confirms it',async t=>{
 let d,before=null;const archive=async args=>({posts:args.kind==='post'?[{...post('gonepost',{created_utc:created-50,removed_by_category:'moderator',selftext:'Fresh archived text'}),_meta:{removal_type:'deleted',was_deleted_later:true}}]:[],hasMore:false});
 const ownList=(args,M)=>{if(before==null)before=[...d.nodes.values()].find(n=>n.dataset.fullname==='t3_gonepost');return {posts:[],scanned:0,hasMore:false,after:null};};
 const s=await view(t,{ownList,archive,publicProofs:{},visitor:()=>({items:[],after:null}),settings:{postDiscovery:true,archiveDiscovery:true},list:[savedItem('gonepost',{source:'arctic-shift',created:created-50,removal:{state:'removed-mod',confidence:'verified',why:'Earlier',flags:['deleted-later']}})],before:x=>{d=x;}});
 const after=[...s.d.nodes.values()].find(n=>n.dataset.fullname==='t3_gonepost');assert.ok(before);assert.equal(after,before,'same card node, no remove and re-insert');assert.equal(s.d.listState.items.get('gonepost').saved,undefined);assert.match(after.textContent,/Synthetic gonepost/,'the row shows the fresh record');
});

test('saved Removed search shows the stored votes, comments and preview before its fresh walk answers',async t=>{
 let d,preview,facts;const list=[{fullname:'t3_kept',kind:'post',id:'kept',created,subreddit:'Alpha',permalink:'/r/Alpha/comments/kept/title/',title:'Saved facts',body:'Saved text',source:'reddit',postType:'image',score:57,comments:8,thumbnail:'https://preview.redd.it/syntheticpreview.jpg',removal:{state:'removed-mod',confidence:'verified',why:'Native',flags:[]}}];
 await view(t,{children:[],type:'posts',list,publicProofs:{},before:instance=>d=instance,ownList:async()=>{const node=d.nodes.get('kept');preview ||= node?.querySelector('[data-testid="search_post_thumbnail"]')?.getAttribute('src');facts ||= node?.querySelector('[data-testid="search-counter-row"]')?.textContent;return {posts:[],scanned:0,hasMore:false};}});assert.equal(preview,'https://preview.redd.it/syntheticpreview.jpg');assert.equal(facts,'57 votes·8 comments');
});

test('Today plus Removed stops profile/archive walks outside the window and never replaces the whole saved list',async t=>{
 const now=Math.floor(Date.now()/1000),old=now-10*86400,calls=[],listSaved=[],archiveCalls=[];
 const s=await view(t,{children:[],type:'posts',search:'&t=day',calls,listSaved,settings:{postDiscovery:true,archiveDiscovery:true},ownList:async(args,M)=>{assert.equal(args.after,null,'do not request older continuation pages');return {posts:[native(M,'t3',post('old',{created_utc:old,removed_by_category:'moderator'}))],scanned:1,hasMore:true,after:'older',transport:'native'};},archive:async args=>{archiveCalls.push(args);return {posts:[post('archiveold',{created_utc:old,removed_by_category:'moderator'})],hasMore:true,before:old};}});
 assert.equal(s.d.listState.error,'');assert.equal(s.d.listState.done,true);assert.equal(s.d.listState.loading,false);assert.deepEqual(s.shown,[]);assert.equal(calls.filter(c=>c.action==='own-list').length,2);assert.equal(calls.some(c=>c.action==='removal-public'),false);assert.equal(archiveCalls.length,1);assert.equal(archiveCalls[0].kind,'post');assert.equal(listSaved.length,0,'a bounded search is never saved as a complete account check');
});
test('Today Removed comments search classifies only in-window comments while retaining other current filters',async t=>{
 const now=Math.floor(Date.now()/1000),calls=[];const s=await view(t,{children:[],type:'comments',search:'&t=day&rt_sub=Alpha',calls,ownList:async(args,M)=>({posts:[native(M,'t3',post('posttoday',{created_utc:now-60,removed_by_category:'moderator'})),native(M,'t1',comment('newcomment',{created_utc:now-60,removed_by_category:'moderator'})),native(M,'t1',comment('oldcomment',{created_utc:now-864000}))],scanned:3,hasMore:true,after:'older',transport:'native'})});assert.deepEqual(s.shown,['t1_newcomment']);assert.equal(s.d.listState.error,'');assert.equal(calls.filter(c=>c.action==='own-list').length,2);assert.equal(s.d.listState.loading,false);
});

test('a completed empty Removed search reuses Reddit actual empty-search DOM and its adjust-search action',async t=>{
 const s=await view(t,{children:[],type:'posts',before:d=>{const empty=d.feed.ownerDocument.createElement('div');empty.id='empty-search-results';empty.innerHTML='<img data-native-empty-art="true" src="https://www.redditstatic.com/synthetic-empty.png"><h2>Hm...we couldn’t find any results for</h2><p>Double-check your spelling</p><button>Adjust your search</button>';d.feed.closest('main').append(empty);}});
 assert.ok(s.d.listEmpty.querySelector('[data-native-empty-art="true"]'));assert.equal(s.d.listEmpty.querySelector('button').textContent,'Adjust your search');assert.equal(s.d.listEmpty.hidden,false);assert.match(s.d.listEmpty.textContent,/Double-check your spelling/);assert.equal(s.d.loading.hidden,true);assert.equal(s.d.listEmpty.querySelector('faceplate-partial')?.tagName,'FACEPLATE-PARTIAL','the bridge hydrates Reddit components in the page world');let adjusted=null;s.d.fillHeaderSearch=q=>{adjusted=q;};s.d.listEmpty.querySelector('button').click();assert.equal(adjusted,'');
});

test('native Today and an additional local date filter intersect instead of widening Removed search',async t=>{
 const now=Math.floor(Date.now()/1000);const s=await view(t,{children:[],type:'posts',search:'&t=day&rt_date=week',ownList:async(args,M)=>({posts:[native(M,'t3',post('weekonly',{created_utc:now-3*86400,removed_by_category:'moderator'}))],scanned:1,hasMore:true,after:'older',transport:'native'})});assert.deepEqual(s.shown,[]);assert.equal(s.d.listState.error,'');assert.ok(s.d.listState.window.after>now-2*86400);
});

test('a failed native empty template is retried only on an explicit list refresh',async t=>{
 let reads=0;const s=await view(t,{children:[],type:'posts',emptyRead:async()=>{reads++;throw Error('Native template unavailable');}});assert.equal(reads,1);assert.match(s.d.status.textContent,/empty search view could not be loaded/);s.d.renderOwnList();await flush();s.d.renderOwnList();await flush();assert.equal(reads,1,'redraws must not hammer native search');assert.match(s.d.status.textContent,/empty search view could not be loaded/);await s.d.refreshActivity();await flush();assert.equal(reads,2,'an explicit retry may read once again');
});

test('a completed empty Removed search titles Reddit’s view with the actual query',async t=>{
 const s=await view(t,{children:[],type:'posts',q:'needle'});assert.equal(s.d.listEmpty.querySelector('[data-testid="search-error-message"] > div').textContent,'Hm...we couldn’t find any results for "needle"');
});
test('a saved entry without stored counts shows no invented votes until its fresh record supplies them',async t=>{
 let d,early;const ownList=(args,M)=>{if(early===undefined)early=d.nodes.get('kept')?.querySelector('[data-testid="search-counter-row"]')?.textContent ?? null;return args.source==='posts'?{posts:[],scanned:0,hasMore:false,after:null}:{posts:[native(M,'t3',post('kept',{created_utc:created-10,removed_by_category:'moderator',score:18,num_comments:22}))],scanned:1,hasMore:false,after:null};};
 const s=await view(t,{ownList,list:[savedItem('kept')],publicProofs:{},visitor:()=>({items:[],after:null}),before:x=>{d=x;}});
 assert.equal(early,null,'a legacy saved entry has no counts to show, not 0 votes · 0 comments');
 assert.equal(s.d.nodes.get('kept').querySelector('[data-testid="search-counter-row"]').textContent,'18 votes·22 comments');
});
test('Removed search uses the same zero-gap search layout as plain search',async t=>{
 const s=await view(t,{children:[],type:'posts',q:'needle',before:d=>{const target=d.controlsTarget=d.feed.ownerDocument.createElement('div');target.className='flex items-center gap-xs my-md';target.dataset.rtUi='profile-controls';d.host.before(target);}});
 assert.equal(s.d.host.hasAttribute('data-rt-search'),true);assert.equal(s.d.controlsTarget.classList.contains('my-md'),false);assert.equal(s.d.controlsTarget.classList.contains('flex'),false);
});

test('Removed comment rows show the post title and a time even when Reddit’s time element never renders',async t=>{
 const s=await view(t,{children:[],type:'comments',ownList:async(args,M)=>args.source==='posts'?{posts:[],scanned:0,hasMore:false,after:null}:{posts:[native(M,'t1',comment('c1',{created_utc:Math.floor(Date.now()/1000)-5*86400,link_title:'Synthetic thread title',removed_by_category:'moderator'}))],scanned:1,hasMore:false,after:null},before:d=>{d.timeFallbackMs=0;}});
 await new Promise(r=>setTimeout(r,5));const row=s.d.nodes.get('t1_c1') || [...s.d.nodes.values()].find(n=>n.dataset.fullname==='t1_c1');
 assert.equal(row.querySelector('[data-testid="search-sdui-comment-unit"] h2').textContent,'Synthetic thread title');
 const time=row.querySelector('time');assert.ok(time,'Reddit’s rendered <time> markup');assert.equal(time.textContent,'5d ago');assert.ok(time.getAttribute('datetime'));
});
