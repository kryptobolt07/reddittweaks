const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const raw=(id='abc12',extra={})=>({id,author:'Example',title:'A public post',selftext:'Public text',subreddit:'example',created_utc:1700000000,score:7,num_comments:2,...extra});
function setup(t,{url='https://www.reddit.com/user/Example/submitted/',settings={postDiscovery:true,archiveDiscovery:false},reddit,archive,readSettings}={}){
  const dom=new JSDOM('<main id="main-content"><shreddit-feed><shreddit-post id="t3_native"></shreddit-post></shreddit-feed></main>',{url,runScripts:'outside-only',pretendToBeVisual:true});const W=dom.window,calls=[];
  for(const file of ['post-model.js','post-discovery.js'])W.eval(fs.readFileSync('extension/'+file,'utf8'));
  const d=new W.RTPostDiscovery.Discovery({observe:false,readSettings:readSettings || (async()=>({'rt-settings-v1':settings})),reddit:async(...args)=>{calls.push(args[0]);return reddit?reddit(...args):{posts:[raw('native'),raw()],after:null,hasMore:false};},archive:archive || (async()=>({posts:[raw('old12')],hasMore:false}))});t.after(()=>{d.destroy();dom.window.close();});return {W,d,calls};
}
test('profile discovery is explicit, deduplicates native posts and stays inline',async t=>{
  const {W,d,calls}=setup(t);await d.ready;assert.equal(calls.length,0);assert.equal(d.host.parentElement.tagName,'SHREDDIT-FEED');
  await d.loadReddit();assert.equal(calls.length,1);assert.equal(d.results.querySelectorAll('article:not([hidden])').length,1);assert.match(d.status.textContent,/1 additional post/);assert.equal(d.results.querySelector('shreddit-post'),null);assert.match(d.results.querySelector('[role=img]').title,/public Reddit search/);
  const native=W.document.createElement('shreddit-post');native.id='t3_abc12';W.document.querySelector('shreddit-feed').append(native);d.scan();assert.equal(d.nodes.get('abc12').hidden,true);
});
test('pagination uses Reddit cursors while refresh starts at the newest page',async t=>{
  const {d,calls}=setup(t,{reddit:async()=>({posts:[raw()],after:'t3_abc12',hasMore:true})});await d.ready;await d.loadReddit();await d.loadMore();await d.loadReddit();
  assert.equal(calls[0].after,undefined);assert.equal(calls[1].after,'t3_abc12');assert.equal(calls[2].after,undefined);assert.equal(d.moreReddit,true);
});
test('archived text and current deletion status remain separately attributed',async t=>{
  const {d}=setup(t,{settings:{archiveDiscovery:true},reddit:async()=>({posts:[raw('old12',{selftext:'[removed]'})]})});await d.ready;await d.loadArchive();
  assert.match(d.results.textContent,/Archived text · Arctic Shift/);assert.match(d.results.querySelector('[role=img]').title,/Removed on Reddit/);assert.equal(d.results.querySelector('details').open,false);
});
test('archive failures preserve visible public results and expose a retryable error',async t=>{
  const {d}=setup(t,{settings:{archiveDiscovery:true},archive:async()=>{throw Error('Archive is unavailable.');}});await d.ready;await d.loadReddit();await d.loadArchive();
  assert.equal(d.nodes.get('abc12').isConnected,true);assert.equal(d.status.dataset.error,'true');assert.match(d.status.textContent,/unavailable/);assert.equal(d.discover.disabled,false);
});
test('SPA navigation rejects stale results and disabling discovery removes the interface',async t=>{
  let resolve;const gate=new Promise(r=>resolve=r);const {W,d}=setup(t,{reddit:()=>gate});await d.ready;const load=d.loadReddit();
  W.history.pushState({},'','/user/Other/');d.scan();resolve({posts:[raw()]});await load;assert.equal(d.context.username,'Other');assert.equal(d.results.childElementCount,0);
  d.onSettings({'rt-settings-v1':{newValue:{postDiscovery:false}}},'local');assert.equal(W.document.querySelector('[data-rt-ui]'),null);
});
test('a late initial settings read cannot undo a newer opt-out',async t=>{
  let resolve;const {d}=setup(t,{readSettings:()=>new Promise(r=>resolve=r)});await Promise.resolve();d.onSettings({'rt-settings-v1':{newValue:{postDiscovery:false}}},'local');resolve({'rt-settings-v1':{postDiscovery:true}});await d.ready;assert.equal(d.settings.postDiscovery,false);assert.equal(d.host,null);
});
test('post text is inert and spoiler or NSFW snapshots do not leak previews',async t=>{
  const {d}=setup(t,{settings:{archiveDiscovery:true},archive:async()=>({posts:[raw('old12',{title:'<img onerror=bad()>',selftext:'secret NSFW text',over_18:true})]}),reddit:async()=>({posts:[]})});await d.ready;await d.loadArchive();assert.equal(d.results.querySelector('img'),null);assert.equal(d.results.textContent.includes('secret NSFW text'),false);assert.match(d.results.textContent,/<img onerror=bad\(\)>/);
});
test('toolbar pagination is bounded even when its Load more control is bypassed',async t=>{
  let count=0;const {d}=setup(t,{settings:{archiveDiscovery:true},archive:async()=>{count++;return {posts:[],before:1700000000-count,hasMore:true};}});await d.ready;for(let i=0;i<12;i++)await d.loadArchive();assert.equal(count,8);assert.match(d.status.textContent,/bounded/);
});
test('post detail adds a separate archive snapshot and leaves the native post intact',async t=>{
  const {W,d}=setup(t,{url:'https://www.reddit.com/r/example/comments/abc12/title/',settings:{archiveDiscovery:true},archive:async()=>({posts:[raw('abc12',{selftext:'Original archived text'})]}),reddit:async()=>({posts:[raw('abc12',{selftext:'[deleted]'})]})});await d.ready;const native=W.document.querySelector('shreddit-post');native.append(W.document.createTextNode('Native deleted placeholder'));await d.loadDetail();assert.match(native.textContent,/Native deleted placeholder/);assert.equal(d.host.previousElementSibling,native);assert.equal(native.contains(d.host),false);assert.match(d.results.textContent,/Original archived text/);assert.match(d.status.textContent,/Deleted on Reddit/);
});
test('unsupported profile tabs and old Reddit are not modified',async t=>{
  const {d}=setup(t,{url:'https://www.reddit.com/user/Example/saved/'});await d.ready;assert.equal(d.host,null);assert.equal(d.settings.archiveDiscovery,false);
});

test('current live restrictions also protect older unmarked detail snapshots',async t=>{
 const {d}=setup(t,{url:'https://www.reddit.com/comments/abc12/title/',settings:{archiveDiscovery:true},archive:async()=>({posts:[raw('abc12',{selftext:'Restricted original'})]}),reddit:async()=>({posts:[raw('abc12',{selftext:'[removed]',over_18:true})]})});await d.ready;await d.loadDetail();assert.equal(d.results.textContent.includes('Restricted original'),false);
});
const comment=()=>({kind:'comment',id:'19rktoupyflj9',fullname:'t1_19rktoupyflj9',author:'Example',link_id:'t3_abc12',created_utc:1700000000,body:'A discovered public comment',subreddit:'example'});
test('comments tab discovers and displays comments with stable source identity',async t=>{
 const {d,calls}=setup(t,{url:'https://www.reddit.com/user/Example/comments/',reddit:async()=>({posts:[comment()],hasMore:false})});await d.ready;await d.loadReddit();assert.equal(calls[0].kind,'comment');assert.match(d.results.textContent,/A discovered public comment/);assert.match(d.status.textContent,/1 additional comment/);assert.ok(d.nodes.has('t1_19rktoupyflj9'));
});
test('overview retains successful comments if public post search fails',async t=>{
 const {d}=setup(t,{url:'https://www.reddit.com/user/Example/',reddit:async request=>{if(request.kind==='post')throw Error('HTTP 403');return {posts:[comment()],hasMore:false};}});await d.ready;await d.loadReddit();assert.match(d.results.textContent,/discovered public comment/);assert.match(d.status.textContent,/Posts:.*403/);
});
test('settings use worker messaging without accessing trusted-only content-script storage',async t=>{
 const {JSDOM}=require('jsdom'),dom=new JSDOM('<main id="main-content"><shreddit-feed></shreddit-feed></main>',{url:'https://www.reddit.com/user/Example/submitted/',runScripts:'outside-only'}),w=dom.window;let reads=0,request;
 w.chrome={runtime:{sendMessage:async message=>{request=message;return {ok:true,settings:{postDiscovery:true,archiveDiscovery:false}};}},storage:{local:{get(){reads++;throw Error('Access to storage is not allowed from this context.');}}}};
 for(const file of ['post-model.js','post-discovery.js'])w.eval(fs.readFileSync('extension/'+file,'utf8'));
 const d=new w.RTPostDiscovery.Discovery({observe:false});t.after(()=>{d.destroy();w.close();});await d.ready;assert.equal(reads,0);assert.equal(request.action,'get-settings');assert.equal(d.host.isConnected,true);
});
test('settings failure is visible and retry replaces the error interface',async t=>{
 let fail=true;const {d}=setup(t,{readSettings:async()=>{if(fail)throw Error('worker unavailable');return {'rt-settings-v1':{postDiscovery:true}};}});await d.ready;assert.match(d.status.textContent,/settings could not be loaded/);assert.equal(d.discover.textContent,'Retry discovery');fail=false;await d.retrySettings();assert.equal(d.settingsError,false);assert.notEqual(d.discover.textContent,'Retry discovery');
});
test('automatic discovery is bounded and hides only the native empty placeholder while results exist',async t=>{
 const {W,d,calls}=setup(t);await d.ready;d.reset();const placeholder=W.document.createElement('div');placeholder.id='empty-feed-content';W.document.querySelector('main').append(placeholder);d.autoDiscover=true;d.scan();await new Promise(r=>setImmediate(r));assert.equal(calls.length,1);assert.equal(placeholder.hidden,true);d.scan();await new Promise(r=>setImmediate(r));assert.equal(calls.length,1);d.reset();assert.equal(placeholder.hidden,false);
});
