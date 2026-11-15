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
async function view(t,{children,settings={postDiscovery:true,archiveDiscovery:false},archive}={}){
 const dom=new JSDOM(page,{url:'https://www.reddit.com/user/Example/search/?rt_list=removed',runScripts:'outside-only',pretendToBeVisual:true}),W=dom.window,archives=[];let d;
 t.after(()=>{d?.destroy();W.close();});
 for(const file of ['search-core.js','post-model.js','feed-filters.js','removal-model.js','post-discovery.js'])W.eval(read(file));
 const M=W.RTPostModel;
 const reddit=async args=>{
  if(args.action==='own-list-identity')return {username:'Example'};
  if(args.action==='own-list'){assert.equal(args.list,'removed');const posts=children.map(([kind,data])=>{const item=kind==='t3'?M.normalizePost(data):M.normalizeComment(data);item.moderation={category:data.removed_by_category ?? null,removalReason:Boolean(data.removal_reason),locked:data.locked===true,subredditType:data.subreddit_type || 'public',quarantined:false,authorBody:kind==='t3'?data.selftext:data.body};return item;});return {posts,scanned:posts.length,hasMore:false,after:null};}
  throw Error('Unexpected request: '+args.action);
 };
 d=new W.RTPostDiscovery.Discovery({observe:false,autoDiscover:false,reddit,archive:async args=>{archives.push(args);if(!archive)throw Error('No archive expected');return archive(args,W);},readSettings:async()=>({'rt-settings-v1':settings})});
 await d.ready;await flush();await d.refreshActivity();await flush();
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
 assert.match(s.d.notice.textContent,/1 comment couldn’t be checked: Reddit blocks logged-out checks of comments\. Turn on “Use the archive”/);
 assert.match(s.d.notice.textContent,/Couldn’t check whether others can see your profile/);
 assert.equal(s.archives.length,0,'no archive reads while “Use the archive” is off');
});

test('with the archive on, comments are classified from its captures in batches of at most 25',async t=>{
 const children=[['t1',comment('auto1')],['t1',comment('mod1')],['t1',comment('seen1')],['t1',comment('none1')],...Array.from({length:26},(_,i)=>['t1',comment('bulk'+i)])];
 const s=await view(t,{settings:{postDiscovery:true,archiveDiscovery:true},children,archive:async(args,W)=>{
  assert.equal(args.action,'archive-removal');assert.equal(args.kind,'comment');assert.ok(args.ids.length<=25);
  const caps={auto1:{body:'[removed]',retrieved_on:created+10},mod1:{body:'Synthetic comment mod1',retrieved_on:created+600}};
  return {ok:true,posts:args.ids.filter(id=>caps[id]).map(id=>W.RTPostModel.normalizeComment({...comment(id),...caps[id]},{source:'arctic-shift'}))};
 }});
 assert.equal(s.archives.length,2);assert.deepEqual(s.archives.map(a=>a.ids.length),[25,5]);
 // Only the archive capture of a removal makes a comment "removed"; one seen visible stays unchecked (no public view).
 assert.deepEqual(s.shown,['t1_auto1']);assert.equal(s.pill('t1_auto1').textContent,'Removed automatically (likely)');assert.match(s.pill('t1_auto1').title,/10 seconds after posting/);
 assert.equal(s.d.listState.items.get('mod1')?.removal?.state ?? [...s.d.listState.items.values()].find(p=>p.id==='mod1').removal.state,'unknown');
 assert.match(s.d.notice.textContent,/29 comments couldn’t be checked/);assert.doesNotMatch(s.d.notice.textContent,/Turn on “Use the archive”/);
});

test('an archive failure leaves comments as “Couldn’t check” and says so, never as visible',async t=>{
 const s=await view(t,{settings:{postDiscovery:true,archiveDiscovery:true},children:[['t1',comment('c1')],['t3',post('p1',{removed_by_category:'moderator'})]],archive:async()=>{throw Error('Archive requests are cooling down.');}});
 assert.deepEqual(s.shown,['t3_p1']);assert.match(s.d.notice.textContent,/The archive didn’t answer \(Archive requests are cooling down\); some comments couldn’t be checked/);
 assert.equal([...s.d.listState.items.values()].find(p=>p.id==='c1').removal.state,'unknown');assert.notEqual(s.d.status.dataset.error,'true');
});

test('no removals says how many items could be checked, not that nothing was removed',async t=>{
 const s=await view(t,{children:[['t3',post('a')],['t3',post('b')],['t1',comment('c')]]});
 assert.deepEqual(s.shown,[]);assert.equal(s.d.listEmpty.hidden,false);assert.equal(s.d.listEmpty.textContent,'No removals found in the 2 items that could be checked.');
});

test('native metadata without a visibility verdict remains unchecked and exposes its limit',async t=>{
 const s=await view(t,{children:[['t3',post('a')]]});const item=[...s.d.listState.items.values()][0];item.moderation.visibilityKnown=false;
 await s.d.classifyRemoved([item],s.d.context);s.d.renderOwnList();assert.equal(item.removal.state,'unknown');assert.match(s.d.notice.textContent,/native metadata does not establish public visibility/);assert.match(s.d.listEmpty.textContent,/0 items that could be checked/);
});
test('native Removed pages state their coverage limit and use archive evidence for own posts too',async t=>{
 const s=await view(t,{children:[['t3',post('auto1')]]});const p=[...s.d.listState.items.values()][0];Object.assign(p.moderation,{native:true,nativeRemoved:true,visibilityKnown:false});s.d.settings.archiveDiscovery=true;
 s.d.archive=async args=>{assert.equal(args.kind,'post');return {posts:[s.W.RTPostModel.normalizePost({...post('auto1'),selftext:'[removed]',retrieved_on:created+10},{source:'arctic-shift'})]};};
 await s.d.classifyRemoved([p],s.d.context);assert.equal(p.removal.state,'removed-auto');assert.equal(p.removal.confidence,'likely');s.d.listState.native=true;s.d.listState.capped=true;s.d.summarizeRemoved();assert.match(s.d.notice.textContent,/native profile coverage may be incomplete/i);assert.doesNotMatch(s.d.notice.textContent,/Reddit only returns your newest/);
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
