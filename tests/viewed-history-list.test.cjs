// Viewed-posts History in the profile's History tab and in List → History search (docs/viewed-history-spec.md).
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
const read=f=>fs.readFileSync('extension/'+f,'utf8'),flush=async()=>{for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r));};
const tabs=['','submitted/','comments/','saved/','history/','hidden/','upvoted/','downvoted/'];
const shell=()=>'<shreddit-app user-logged-in="true" logged-in-user-id="t2_self"></shreddit-app><div id="user-drawer-content"><faceplate-partial src="/svc/shreddit/partial/X/user-drawer-menu?params=username%3DExample"></faceplate-partial></div><main><faceplate-tabgroup id="profile-feed-tabgroup">'+tabs.map((p,i)=>'<a slot="page-'+(i+1)+'" href="/user/Example/'+p+'" class="button button-plain'+(p==='history/'?' tab-selected bg-secondary-background-selected':'')+'"'+(p==='history/'?' aria-current="page"':'')+'>'+(p || 'Overview')+'</a>').join('')+'</faceplate-tabgroup><faceplate-tabgroup id="search-results-page-tabgroup"><a id="search-results-page-tab-posts" href="?type=posts">Posts</a><a id="search-results-page-tab-comments" href="?type=comments">Comments</a><a id="search-results-page-tab-media" href="?type=media">Media</a></faceplate-tabgroup><shreddit-feed id="original-feed"><shreddit-post id="t3_native">Reddit history card</shreddit-post></shreddit-feed></main>';
const raw=(id,extra={})=>({id,author:'Writer',title:'Seen '+id,selftext:'',subreddit:'Alpha',created_utc:1790000000,is_self:true,...extra});
const viewed=(id,n,extra={})=>({fullname:'t3_'+id,id,title:'Viewed '+id,subreddit:'Beta',author:'Writer',permalink:'/r/Beta/comments/'+id+'/v/',created:1780000000,postType:'text',score:3,comments:1,over18:false,spoiler:false,viewedAt:1800000000000-n,...extra});
async function setup(t,{path='/user/Example/search/?rt_list=history',limit=1000,reddit=['h1','h2'],local=[]}={}){
 const dom=new JSDOM(shell(),{url:'https://www.reddit.com'+path,runScripts:'outside-only',pretendToBeVisual:true}),W=dom.window,calls=[],loads=[],renders=[];let d;t.after(()=>{d?.destroy();W.close();});
 W.customElements.define('faceplate-tabgroup',class extends W.HTMLElement{get pages(){return Number(this.getAttribute('pages')) || undefined;}set pages(v){this.setAttribute('pages',String(v));}get pageIndex(){return Number(this.getAttribute('pageindex')) || 1;}set pageIndex(v){this.setAttribute('pageindex',String(v));}});
 for(const f of ['search-core.js','post-model.js','native-removal.js','removal-model.js','feed-filters.js','post-discovery.js'])W.eval(read(f));
 W.RTArchiveQuery={async *search(){throw Error('History never reaches the archive');},async aggregate(){throw Error('no');}};
 const settings={postDiscovery:true,archiveDiscovery:false,historyLimit:limit};
 d=new W.RTPostDiscovery.Discovery({observe:false,autoDiscover:false,readSettings:async()=>({'rt-settings-v1':settings}),
  reddit:async args=>{calls.push(args);if(args.action==='own-list-identity')return {username:'Example'};if(args.action==='own-list'){assert.equal(args.list,'history');return {posts:reddit.map(id=>W.RTPostModel.normalizePost(raw(id))),scanned:reddit.length,hasMore:false,after:null};}if(args.action==='render-controls'){return {rendered:true};}if(args.action==='render-search-empty'){W.document.getElementById(args.target).innerHTML='<div data-testid="search-error-message"><div>Hm...we couldn’t find any results</div><div>Hint</div></div>';return {rendered:true};}throw Error('Unexpected '+args.action);},
  viewedHistory:async message=>{loads.push(message);return {ok:true,items:local,limit};},
  nativeRenderer:async(post,node)=>{renders.push(post.fullname);node.innerHTML='<shreddit-post id="'+post.fullname+'"><span slot="credit-bar"></span><p>Card</p></shreddit-post>';},
  removalCache:async()=>({ok:true,proofs:{}}),archive:async()=>{throw Error('no archive');}});
 await d.ready;await flush();return {W,d,calls,loads,renders};
}
const shown=s=>[...s.d.nodes.values()].filter(n=>!n.hidden).sort((a,b)=>a.compareDocumentPosition(b)&4?-1:1).map(n=>n.dataset.fullname);

test('History search shows Reddit’s recent views first, then older recorded views, without repeats',async t=>{
 const s=await setup(t,{local:[viewed('h2',0),viewed('v3',1),viewed('v4',2)]});await s.d.refreshActivity();await flush();
 assert.deepEqual(shown(s),['t3_h1','t3_h2','t3_v3','t3_v4']);assert.equal(s.loads.length,1);assert.equal(s.loads[0].action,'load');assert.equal(s.loads[0].owner,'t2_self');assert.equal(s.loads[0].username,'Example');
 assert.match(s.d.feed.textContent,/Viewed v3/);assert.doesNotMatch(s.d.notice.textContent+s.d.notice.title,/~20 most recently viewed/);
});
test('the History limit caps Reddit’s and recorded views together',async t=>{
 const s=await setup(t,{limit:100,local:Array.from({length:100},(_,i)=>viewed('x'+i,i))});await s.d.refreshActivity();await flush();
 const list=shown(s);assert.equal(list.length,100);assert.deepEqual(list.slice(0,3),['t3_h1','t3_h2','t3_x0']);
});
test('History search matches recorded views by title like Reddit’s own items',async t=>{
 const s=await setup(t,{path:'/user/Example/search/?rt_list=history&q=needle',local:[viewed('v3',1,{title:'A needle in history'}),viewed('v4',2)]});await s.d.refreshActivity();await flush();
 assert.deepEqual(shown(s),['t3_v3']);
});
test('at Reddit’s 20 nothing recorded is read and History stays Reddit’s own',async t=>{
 const s=await setup(t,{limit:20,local:[viewed('v3',1)]});await s.d.refreshActivity();await flush();
 assert.equal(s.loads.length,0);assert.deepEqual(shown(s),['t3_h1','t3_h2']);assert.match(s.d.notice.textContent+s.d.notice.title,/20 most recently viewed/);
});
test('above Reddit’s 20 the profile History tab shows the full list; at 20 it stays Reddit’s page',async t=>{
 const s=await setup(t,{path:'/user/Example/history/',local:[viewed('v3',1)]});const route=s.W.RTPostDiscovery.pageRoute('/user/Example/history/','','Example');
 assert.equal(route.section,true);assert.equal(route.list,'history');assert.equal(s.d.context?.list,'history');await s.d.refreshActivity();await flush();
 assert.deepEqual(shown(s),['t3_h1','t3_h2','t3_v3']);assert.equal(s.W.document.querySelector('#original-feed').hidden,true,'Reddit’s 20-card feed is replaced');
 assert.equal(s.d.host.getAttribute('aria-label'),'Viewed posts');
 const removedTab=s.W.document.querySelector('[data-rt-ui="removed-tab"]');if(removedTab)assert.equal(removedTab.hasAttribute('aria-current'),false,'Removed is not the selected tab');
 s.d.applySettings({postDiscovery:true,archiveDiscovery:false,historyLimit:20});assert.equal(s.W.RTPostDiscovery.pageRoute('/user/Example/history/','','Example').view,'list-tab');assert.equal(s.W.document.querySelector('#original-feed').hidden,false,'Reddit’s own History returns');
});
test('the History tab draws cards 25 at a time as you scroll, not all at once',async t=>{
 const s=await setup(t,{path:'/user/Example/history/',reddit:[],local:Array.from({length:60},(_,i)=>viewed('y'+i,i))});await s.d.refreshActivity();await flush();
 assert.equal(shown(s).length,25);assert.ok(s.renders.length<=25,'cards are fetched only for the drawn window');
 s.d.revealMoreHistory();await flush();assert.equal(shown(s).length,50);s.d.revealMoreHistory();await flush();assert.equal(shown(s).length,60);
});
