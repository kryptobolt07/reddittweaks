const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const row=(extra={})=>({id:'abc12',author:'Example',created_utc:1700000000,selftext:'Public archive',...extra});
function env({fetcher,settings={postDiscovery:true,archiveDiscovery:true},fastTimeout=false,session}={}){
 let listener,settingsListener,calls=[],stored=settings,notifications=[];
 const context=vm.createContext({URL,AbortController,Date,console,setTimeout:fastTimeout?(fn)=>setTimeout(fn,5):setTimeout,clearTimeout,
 chrome:{runtime:{id:'own',onMessage:{addListener(fn){listener=fn;}}},storage:{...(session?{session:{async get(key){return {[key]:session[key]};},async set(values){Object.assign(session,JSON.parse(JSON.stringify(values)));}}}:{}),onChanged:{addListener(fn){settingsListener=fn;}},local:{async get(){return {'rt-settings-v1':stored};}}},tabs:{async sendMessage(...args){notifications.push(args);},async query(){return (globalThis.__openRedditTabs || []).map(id=>({id}));}}},
 fetch:async(...args)=>{calls.push(args);return fetcher?fetcher(...args):response([row()]);}});
 for(const file of ['post-model.js','post-broker.js'])vm.runInContext(fs.readFileSync('extension/'+file,'utf8'),context);
 return {calls,notifications,changeSettings(value){stored=value;settingsListener({'rt-settings-v1':{newValue:value}},'local');},setSettings(value){stored=value;},send(message={},sender={}){return new Promise(resolve=>{const result=listener({scope:'rt-posts',action:'archive-profile',username:'Example',...message},{id:'own',frameId:0,url:'https://www.reddit.com/user/Example/',...sender},resolve);if(result!==true)resolve(undefined);});}};
}
function response(data,status=200,headers={}){return {ok:status===200,status,headers:{get:key=>headers[key]??null},async text(){return JSON.stringify({data});}};}
test('broker uses fixed credential-free endpoint and sanitizes source/profile data',async()=>{
 const e=env({fetcher:async()=>response([row(),row({id:'foreign',author:'other'})])}),r=await e.send();assert.equal(r.ok,true);assert.equal(r.posts.length,1);assert.equal(r.incomplete,true);assert.equal(r.posts[0].status,'unknown');
 const [url,options]=e.calls[0];assert.equal(new URL(url).hostname,'arctic-shift.photon-reddit.com');assert.equal(new URL(url).searchParams.get('limit'),'100');assert.equal(options.credentials,'omit');assert.equal(options.referrerPolicy,'no-referrer');assert.equal(options.redirect,'error');
});
test('broker rejects foreign senders, origins, frames, profile mismatches and invalid inputs',async()=>{
 const e=env();for(const sender of [{id:'foreign'},{frameId:1},{url:'https://evil.test/user/Example'},{url:'https://www.reddit.com/user/other'},{origin:'https://evil.test'},{url:'http://www.reddit.com/user/Example'}])assert.equal((await e.send({},sender)).code,'forbidden');
 for(const message of [{username:'a?b'},{before:'1700000000'},{before:Infinity},{action:'proxy'}])assert.equal((await e.send(message)).code,'invalid-request');assert.equal(e.calls.length,0);
});
test('settings are enforced again even for cached successful requests',async()=>{
 const e=env({settings:{}});assert.equal((await e.send()).code,'disabled');assert.equal(e.calls.length,0);e.setSettings({archiveDiscovery:true});assert.equal((await e.send()).ok,true);e.setSettings({postDiscovery:false,archiveDiscovery:true});assert.equal((await e.send()).code,'disabled');
});
test('equal simultaneous requests deduplicate and cache only bounded successful public results',async()=>{
 let resolve;const gate=new Promise(r=>resolve=r),e=env({fetcher:async()=>{await gate;return response([row()]);}}),a=e.send(),b=e.send();await new Promise(r=>setImmediate(r));assert.equal(e.calls.length,1);resolve();assert.equal((await a).ok,true);await b;await e.send();assert.equal(e.calls.length,1);
});
test('timeout, malformed response, network failures and rate limits return incomplete errors without retries',async()=>{
 const timeout=env({fetcher:()=>new Promise(()=>{}),fastTimeout:true});assert.equal((await timeout.send()).code,'timeout');
 const bad=env({fetcher:async()=>response({unexpected:1})});assert.equal((await bad.send()).code,'invalid-response');
 const network=env({fetcher:async()=>{throw Error('private secret');}});assert.equal((await network.send()).error.includes('secret'),false);
 const rate=env({fetcher:async()=>response([],429,{'Retry-After':'60'})});const r=await rate.send();assert.equal(r.code,'rate-limited');assert.ok(r.retryAt>Date.now());assert.equal((await rate.send({before:1700000000})).code,'rate-limited');assert.equal(rate.calls.length,1);
});
test('full same-second pages use overlap and explicitly flag stalled pagination without completeness',async()=>{
 const e=env({fetcher:async()=>response(Array.from({length:100},(_,i)=>row({id:(100+i).toString(36)})))}),first=await e.send();assert.equal(first.before,1700000001);assert.equal(first.hasMore,true);assert.equal(first.cursorStalled,false);
 const next=await e.send({before:first.before});assert.equal(next.cursorStalled,true);assert.equal(next.incomplete,true);assert.match(next.paginationWarning,/overlaps/);
});
test('archive ID recovery accepts only one post matching the current detail URL',async()=>{
 const e=env(),message={action:'archive-ids',ids:['t3_abc12']};const result=await e.send(message,{url:'https://www.reddit.com/r/example/comments/abc12/title/'});assert.equal(result.ok,true);assert.equal(new URL(e.calls[0][0]).pathname,'/api/posts/ids');assert.equal(result.hasMore,false);
 assert.equal((await e.send(message)).code,'forbidden');assert.equal((await e.send({...message,ids:['other']},{url:'https://www.reddit.com/comments/abc12'})).code,'forbidden');
});
test('different pages serialize per profile and global fetch concurrency stays at two',async()=>{
 const gates=[],e=env({fetcher:()=>new Promise(resolve=>gates.push(()=>resolve(response([]))))});
 const first=e.send(),second=e.send({before:1699999999}),other=e.send({username:'Other'},{url:'https://www.reddit.com/user/Other'}),third=e.send({username:'Third'},{url:'https://www.reddit.com/user/Third'});
 await new Promise(r=>setImmediate(r));assert.equal(e.calls.length,2);gates[0]();await first;await new Promise(r=>setImmediate(r));assert.equal(e.calls.length,3);gates[1]();await other;await new Promise(r=>setImmediate(r));assert.equal(e.calls.length,4);gates[2]();gates[3]();await Promise.all([second,third]);
});
test('post requests retain unprojected media fields',async()=>{
 const e=env();await e.send();assert.equal(new URL(e.calls[0][0]).searchParams.has('fields'),false);
});
test('ID lookup accepts a canonical user post permalink and verifies tab URL consistency',async()=>{
 const e=env(),url='https://www.reddit.com/user/Example/comments/abc12/title/';
 assert.equal((await e.send({action:'archive-ids',ids:['abc12']},{url,tab:{url}})).ok,true);
 assert.equal((await e.send({},{tab:{url:'https://evil.test/user/Example/'}})).code,'forbidden');
 assert.equal((await e.send({},{tab:{url:'https://www.reddit.com/user/Other/'}})).code,'forbidden');
});
test('opting out while a profile page is queued prevents fetching or returning archive data',async()=>{
 let release;const gate=new Promise(resolve=>release=resolve),e=env({fetcher:async()=>{await gate;return response([row()]);}});
 const first=e.send(),queued=e.send({before:1699999999});await new Promise(resolve=>setImmediate(resolve));assert.equal(e.calls.length,1);
 e.setSettings({postDiscovery:true,archiveDiscovery:false});release();assert.equal((await first).code,'disabled');assert.equal((await queued).code,'disabled');assert.equal(e.calls.length,1);
 e.setSettings({postDiscovery:true,archiveDiscovery:true});await e.send();assert.equal(e.calls.length,2);
});
test('opting out while a global request slot is queued prevents another fetch',async()=>{
 const releases=[],e=env({fetcher:()=>new Promise(resolve=>releases.push(()=>resolve(response([]))))});
 const first=e.send(),second=e.send({username:'Other'},{url:'https://www.reddit.com/user/Other'}),queued=e.send({username:'Third'},{url:'https://www.reddit.com/user/Third'});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(e.calls.length,2);e.setSettings({postDiscovery:false,archiveDiscovery:true});releases.forEach(release=>release());
 for(const result of await Promise.all([first,second,queued]))assert.equal(result.code,'disabled');assert.equal(e.calls.length,2);
});
test('content scripts read only normalized preferences through the trusted worker even with archives off',async()=>{
 const e=env({settings:{postDiscovery:true,archiveDiscovery:false,privateChatData:'never expose'}}),result=await e.send({action:'get-settings'});
 assert.equal(result.ok,true);assert.deepEqual(JSON.parse(JSON.stringify(result.settings)),{postDiscovery:true,archiveDiscovery:false,restoreDeletedContent:true,subredditArchive:false,subredditArchiveAutomatic:false,cleanShareLinks:false,modUnapprovedFilter:true,raffles:true,ownRemoval:false,removalNotifications:false,historyLimit:20,smoothFeeds:true,smoothHome:true,smoothSubreddits:true,smoothProfiles:true,smoothSearch:true,smoothComments:false,videoStart:'autoplay',videoStartTouch:'autoplay',videoPreviewClick:'open',videoPreviewFrom:'position',videoUnmutePreview:true,videoOpenPost:'continue',videoScrollAway:'reddit'});assert.equal(e.calls.length,0);
 assert.equal((await e.send({action:'get-settings'},{id:'foreign'})).code,'forbidden');
 assert.equal((await e.send({action:'get-settings'},{url:'https://evil.test/'})).code,'forbidden');
});
test('automatic restoration preference never enables archive requests without archive opt-in',async()=>{
 const e=env({settings:{postDiscovery:true,archiveDiscovery:false,restoreDeletedContent:true}});assert.equal((await e.send()).code,'disabled');assert.equal(e.calls.length,0);
 e.setSettings({postDiscovery:true,archiveDiscovery:true,restoreDeletedContent:false});const result=await e.send({action:'get-settings'});assert.equal(result.settings.restoreDeletedContent,false);assert.equal(e.calls.length,0);
});
test('archived comments use their own endpoint, projection, identity and profile route',async()=>{
 const e=env({fetcher:async()=>response([row({id:'19rktoupyflj9',body:'Archived comment',link_id:'t3_abc12'})])});
 const result=await e.send({kind:'comment'},{url:'https://www.reddit.com/user/Example/comments/'});assert.equal(result.ok,true);assert.equal(result.posts[0].kind,'comment');assert.equal(result.posts[0].body,'Archived comment');
 const url=new URL(e.calls[0][0]);assert.equal(url.pathname,'/api/comments/search');assert.equal(url.searchParams.has('fields'),false);
 assert.equal((await e.send({kind:'video'})).code,'invalid-request');
});

test('settings changes reach registered Reddit tabs without exposing trusted chat storage',async()=>{
 const e=env();await e.send({action:'get-settings'},{tab:{id:5,url:'https://www.reddit.com/user/Example/'}});
 e.changeSettings({postDiscovery:false,archiveDiscovery:false,privateChats:['secret']});await new Promise(r=>setImmediate(r));
 assert.equal(e.notifications.length,1);assert.equal(e.notifications[0][0],5);const data=JSON.parse(JSON.stringify(e.notifications[0][1]));assert.deepEqual(data,{scope:'rt-posts',action:'settings-changed',settings:{postDiscovery:false,archiveDiscovery:false,restoreDeletedContent:true,subredditArchive:false,subredditArchiveAutomatic:false,cleanShareLinks:false,modUnapprovedFilter:true,raffles:true,ownRemoval:false,removalNotifications:false,historyLimit:20,smoothFeeds:true,smoothHome:true,smoothSubreddits:true,smoothProfiles:true,smoothSearch:true,smoothComments:false,videoStart:'autoplay',videoStartTouch:'autoplay',videoPreviewClick:'open',videoPreviewFrom:'position',videoUnmutePreview:true,videoOpenPost:'continue',videoScrollAway:'reddit'}});
});

test('settings changes reach every open Reddit tab, even after the worker forgot who asked',async()=>{
 const e=env();globalThis.__openRedditTabs=[7,8];
 try{e.changeSettings({smoothFeeds:false});await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));
  assert.deepEqual(e.notifications.map(n=>n[0]).sort(),[7,8]);assert.equal(e.notifications[0][1].settings.smoothFeeds,false);}
 finally{delete globalThis.__openRedditTabs;}
});
test('archive author requests allow same-profile SPA tabs while rejecting other profiles and unsupported pages',async()=>{
 const e=env();
 for(const suffix of ['submitted/','comments/','']){
  const result=await e.send({}, {url:'https://www.reddit.com/user/Example/',tab:{url:'https://www.reddit.com/user/Example/'+suffix}});assert.equal(result.ok,true);
 }
 assert.equal((await e.send({}, {url:'https://www.reddit.com/user/Example/comments/',tab:{url:'https://www.reddit.com/user/Example/'}})).ok,true);
 for(const target of ['https://www.reddit.com/user/Other/comments/','https://www.reddit.com/user/Example/saved/','https://www.reddit.com/r/example/','https://evil.test/user/Example/'])assert.equal((await e.send({}, {tab:{url:target}})).code,'forbidden');
 // In-page navigation from another profile: the current page decides.
 assert.equal((await e.send({}, {url:'https://www.reddit.com/user/Other/',tab:{url:'https://www.reddit.com/user/Example/comments/'}})).ok,true);
 assert.equal((await e.send({action:'archive-ids',ids:['abc12']},{url:'https://www.reddit.com/comments/abc12/',tab:{url:'https://www.reddit.com/user/Example/comments/'}})).code,'forbidden');
});

test('reply archive lookup joins only previously discovered child parents and projects compact author context',async()=>{
 const e=env({fetcher:async url=>new URL(url).pathname.endsWith('/search')?response([row({id:'child1',body:'Reply',link_id:'t3_post',parent_id:'t1_parent'}),row({id:'child2',body:'Reply',link_id:'t3_post',parent_id:'t1_parent'})]):response([row({id:'parent',author:'Recipient',link_id:'t3_post'})])}),sender={tab:{id:7,url:'https://www.reddit.com/user/Example/comments/'}};
 assert.equal((await e.send({action:'archive-parents',children:['child1']},sender)).code,'forbidden');assert.equal(e.calls.length,0);await e.send({kind:'comment'},sender);
 const value=await e.send({action:'archive-parents',children:['child1','child2']},sender);assert.equal(value.ok,true);assert.equal(value.posts[0].author,'Recipient');assert.equal(value.posts[0].body,'');
 // calls[1] is the comment page's best-effort parent-title lookup, so the parent proof lookup is calls[2].
 const [url,options]=e.calls[2];assert.equal(new URL(url).pathname,'/api/comments/ids');assert.equal(new URL(url).searchParams.get('ids'),'parent');assert.equal(new URL(url).searchParams.get('fields'),'id,author,link_id,created_utc');assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');await e.send({action:'archive-parents',children:['child2']},sender);assert.equal(e.calls.length,3);
});
test('reply archive lookup cannot request arbitrary parents, cross tabs/profiles or reuse proofs after opt-out',async()=>{
 const e=env({fetcher:async()=>response([row({id:'child',body:'Reply',link_id:'t3_post',parent_id:'t1_parent'})])}),sender={tab:{id:7,url:'https://www.reddit.com/user/Example/'}};await e.send({kind:'comment'},sender);
 for(const [message,source] of [[{children:['unknown']},sender],[{children:['child']},{tab:{id:8,url:sender.tab.url}}],[{children:['child'],username:'Other'},sender],[{children:['child']},{...sender,frameId:1}]])assert.equal((await e.send({action:'archive-parents',...message},source)).code,'forbidden');
 assert.equal((await e.send({action:'archive-parents',children:['../../bad']},sender)).code,'invalid-request');assert.equal(e.calls.length,2);e.changeSettings({postDiscovery:true,archiveDiscovery:false});assert.equal((await e.send({action:'archive-parents',children:['child']},sender)).code,'disabled');e.changeSettings({postDiscovery:true,archiveDiscovery:true});assert.equal((await e.send({action:'archive-parents',children:['child']},sender)).code,'forbidden');assert.equal(e.calls.length,2);
});
test('reply archive results must belong to the child thread and opting out discards an in-flight result',async()=>{
 let release;const e=env({fetcher:async url=>{const path=new URL(url).pathname;if(path.endsWith('/search'))return response([row({id:'child',body:'Reply',link_id:'t3_post',parent_id:'t1_parent'})]);if(path.endsWith('/posts/ids'))return response([]);return new Promise(r=>release=r);}}),sender={tab:{id:9,url:'https://www.reddit.com/user/Example/'}};await e.send({kind:'comment'},sender);
 const pending=e.send({action:'archive-parents',children:['child']},sender);await new Promise(r=>setImmediate(r));release(response([row({id:'parent',author:'Wrong',link_id:'t3_other'})]));assert.equal((await pending).posts.length,0);
 e.changeSettings({postDiscovery:true,archiveDiscovery:true});await e.send({kind:'comment'},sender);const second=e.send({action:'archive-parents',children:['child']},sender);await new Promise(r=>setImmediate(r));e.changeSettings({postDiscovery:true,archiveDiscovery:false});release(response([row({id:'parent',author:'Recipient',link_id:'t3_post'})]));assert.equal((await second).code,'disabled');
});

test('automatic recovery validates bounded IDs and requires the matching active public profile',async()=>{
 const e=env(),message={action:'archive-recover',kind:'post',ids:['t3_abc12']};
 for(const source of [{id:'foreign'},{frameId:1},{origin:'https://evil.test'},{url:'https://www.reddit.com/comments/abc12/'},{tab:{url:'https://www.reddit.com/user/Other/'}},{tab:{url:'https://www.reddit.com/user/Example/saved/'}}])assert.equal((await e.send(message,source)).code,'forbidden');
 for(const input of [{kind:'video'},{kind:null},{username:'bad/name'},{ids:[]},{ids:['../../bad']},{ids:['t1_abc12']},{ids:'abc12'},{ids:Array.from({length:26},(_,i)=>'item'+i)}])assert.equal((await e.send({...message,...input})).code,'invalid-request');assert.equal(e.calls.length,0);
 assert.equal((await e.send(message,{tab:{url:'https://www.reddit.com/user/Example/comments/'}})).ok,true);
 assert.equal((await e.send({action:'archive-ids',ids:['abc12']})).code,'forbidden');
});
test('automatic recovery deduplicates a page of IDs and filters all returned rows to that profile author',async()=>{
 let release;const e=env({fetcher:()=>new Promise(r=>release=r)}),ids=Array.from({length:25},(_,i)=>'item'+i),message={action:'archive-recover',kind:'post',ids};
 const first=e.send(message),same=e.send({...message,ids:ids.map(id=>'t3_'+id.toUpperCase()).reverse()});await new Promise(r=>setImmediate(r));assert.equal(e.calls.length,1);
 const [url,options]=e.calls[0],target=new URL(url);assert.equal(target.pathname,'/api/posts/ids');assert.equal(target.searchParams.get('ids').split(',').length,25);assert.equal(options.credentials,'omit');
 release(response([row({id:'item0'}),row({id:'item1',author:'Other'}),row({id:'unrequested'})]));const result=await first;assert.equal(result.ok,true);assert.deepEqual(Array.from(result.posts,p=>p.id),['item0']);await same;await e.send(message);assert.equal(e.calls.length,1);
 const other=e.send({...message,username:'Other'},{url:'https://www.reddit.com/user/Other/'});await new Promise(r=>setImmediate(r));assert.equal(e.calls.length,2);release(response([row({id:'item0',author:'Other'})]));assert.equal((await other).posts[0].author,'Other');
});
test('automatic recovery uses comment IDs and a separate cache from post recovery',async()=>{
 const e=env({fetcher:async()=>response([row({body:'Archived comment',link_id:'t3_post'})])});
 const comment=await e.send({action:'archive-recover',kind:'comment',ids:['t1_abc12']});assert.equal(comment.ok,true);assert.equal(comment.posts[0].kind,'comment');assert.equal(new URL(e.calls[0][0]).pathname,'/api/comments/ids');
 // calls[1] is the comment page's parent-title lookup, so the post recovery is the third request.
 await e.send({action:'archive-recover',kind:'post',ids:['abc12']});assert.equal(e.calls.length,3);assert.equal(new URL(e.calls[2][0]).pathname,'/api/posts/ids');
});
test('automatic recovery enforces archive and restoration opt-outs before fetch and cached delivery',async()=>{
 const e=env(),message={action:'archive-recover',kind:'post',ids:['abc12']};assert.equal((await e.send(message)).ok,true);
 for(const settings of [{postDiscovery:true,archiveDiscovery:false,restoreDeletedContent:true},{postDiscovery:true,archiveDiscovery:true,restoreDeletedContent:false},{postDiscovery:false,archiveDiscovery:true,restoreDeletedContent:true}]){e.setSettings(settings);assert.equal((await e.send(message)).code,'disabled');}assert.equal(e.calls.length,1);
});
test('queued and in-flight automatic recovery rechecks settings and current profile',async()=>{
 const releases=[],e=env({fetcher:()=>new Promise(r=>releases.push(r))}),message={action:'archive-recover',kind:'post',ids:['abc12']};
 const busy=e.send(),other=e.send({username:'Other'},{url:'https://www.reddit.com/user/Other/'});await new Promise(r=>setImmediate(r));assert.equal(e.calls.length,2);
 const queued=e.send(message);await new Promise(r=>setImmediate(r));e.setSettings({postDiscovery:true,archiveDiscovery:true,restoreDeletedContent:false});releases.splice(0).forEach(r=>r(response([])));await Promise.all([busy,other]);assert.equal((await queued).code,'disabled');assert.equal(e.calls.length,2);
 e.setSettings({postDiscovery:true,archiveDiscovery:true,restoreDeletedContent:true});const source={tab:{url:'https://www.reddit.com/user/Example/'}},pending=e.send(message,source);await new Promise(r=>setImmediate(r));source.tab.url='https://www.reddit.com/user/Other/';releases.shift()(response([row()]));assert.equal((await pending).code,'forbidden');
 const inFlight=e.send(message);await new Promise(r=>setImmediate(r));e.setSettings({postDiscovery:true,archiveDiscovery:false,restoreDeletedContent:true});releases.shift()(response([row()]));assert.equal((await inFlight).code,'disabled');
});

test('profile pages request the 100-record maximum and report more only when a full page returns',async()=>{
 const short=env({fetcher:async()=>response(Array.from({length:99},(_,i)=>row({id:(200+i).toString(36)})))}),first=await short.send();
 assert.equal(new URL(short.calls[0][0]).searchParams.get('limit'),'100');assert.equal(first.ok,true);assert.equal(first.hasMore,false);assert.equal(first.before,null);
 const full=env({fetcher:async()=>response(Array.from({length:100},(_,i)=>row({id:(200+i).toString(36)})))}),page=await full.send();assert.equal(page.posts.length,100);assert.equal(page.hasMore,true);assert.equal(page.before,1700000001);
});
test('archive retrieval time becomes retrieved on posts and comments and invalid values are omitted',async()=>{
 const post=await env({fetcher:async()=>response([row({retrieved_on:'1700000500'})])}).send();assert.equal(post.posts[0].retrieved,1700000500);
 const comments=env({fetcher:async()=>response([row({id:'19rktoupyflj9',body:'Archived comment',link_id:'t3_abc12',retrieved_on:1700000600.9})])}),comment=await comments.send({kind:'comment'},{url:'https://www.reddit.com/user/Example/comments/'});
 assert.equal(comment.posts[0].retrieved,1700000600);
 const invalid=await env({fetcher:async()=>response([row({retrieved_on:'soon'})])}).send();assert.equal('retrieved' in invalid.posts[0],false);
});
test('comment archive rows borrow parent titles and NSFW flags from a bounded cached ID lookup',async()=>{
 const lookups=[],e=env({fetcher:async url=>{const target=new URL(url);if(target.pathname.endsWith('/posts/ids')){lookups.push(target);return response([{id:'t3_post',title:'Parent title',subreddit:'example',over_18:true,spoiler:false},{id:'unrequested',title:'Not requested',over_18:true}]);}return response([row({id:'c1',body:'Reply',link_id:'t3_post'}),row({id:'c2',body:'Own title',link_id:'t3_post',link_title:'Own title'})]);}}),sender={url:'https://www.reddit.com/user/Example/comments/'};
 const first=await e.send({kind:'comment'},sender);assert.equal(first.ok,true);assert.equal(first.posts.length,2);const [c1,c2]=first.posts;
 assert.equal(c1.title,'Parent title');assert.equal(c1.over18,true);assert.equal(c1.spoiler,false);assert.equal(c2.title,'Own title');assert.equal(c2.over18,true);
 assert.equal(lookups.length,1);assert.equal(lookups[0].pathname,'/api/posts/ids');assert.equal(lookups[0].searchParams.get('ids'),'post');assert.equal(lookups[0].searchParams.get('fields'),'id,title,subreddit,over_18,spoiler');
 const [,options]=e.calls[1];assert.equal(options.credentials,'omit');assert.equal(options.referrerPolicy,'no-referrer');assert.equal(options.redirect,'error');
 const second=await e.send({kind:'comment',before:1700000005},sender);assert.equal(second.posts[0].title,'Parent title');assert.equal(lookups.length,1);
 e.changeSettings({postDiscovery:true,archiveDiscovery:false});e.changeSettings({postDiscovery:true,archiveDiscovery:true});await e.send({kind:'comment',before:1700000004},sender);assert.equal(lookups.length,2);
});
test('failed, rate-limited or hung comment title lookups leave the comment page successful with empty titles',async()=>{
 const sender={url:'https://www.reddit.com/user/Example/comments/'},comment=()=>response([row({id:'c1',body:'Reply',link_id:'t3_post'})]);
 const failing=env({fetcher:async url=>{if(new URL(url).pathname.endsWith('/posts/ids'))throw Error('offline');return comment();}}),offline=await failing.send({kind:'comment'},sender);
 assert.equal(offline.ok,true);assert.equal(offline.posts[0].title,'');assert.equal(offline.posts[0].over18,false);
 const limited=env({fetcher:async url=>new URL(url).pathname.endsWith('/posts/ids')?response([],429,{'Retry-After':'60'}):comment()}),throttled=await limited.send({kind:'comment'},sender);
 assert.equal(throttled.ok,true);assert.equal(throttled.posts[0].title,'');assert.equal((await limited.send({kind:'comment',before:1700000005},sender)).code,'rate-limited');assert.equal(limited.calls.length,2);
 const hung=env({fastTimeout:true,fetcher:async url=>new URL(url).pathname.endsWith('/posts/ids')?new Promise(()=>{}):comment()}),slow=await hung.send({kind:'comment'},sender);
 assert.equal(slow.ok,true);assert.equal(slow.posts[0].title,'');
});
test('rate-limit reset timestamps set cooldown from epoch milliseconds or seconds and never shorten it',async()=>{
 const future=Date.now()+120000,limited=env({fetcher:async()=>response([row()],429,{'X-RateLimit-Reset-At':String(future)})}),result=await limited.send();
 assert.equal(result.code,'rate-limited');assert.equal(result.retryAt,future);assert.equal((await limited.send({before:1700000000})).code,'rate-limited');assert.equal(limited.calls.length,1);
 const seconds=env({fetcher:async()=>response([row()],200,{'X-RateLimit-Remaining':'0','X-RateLimit-Reset-At':String(Math.floor((Date.now()+90000)/1000))})}),first=await seconds.send();
 assert.equal(first.ok,true);const next=await seconds.send({before:1700000000});assert.equal(next.code,'rate-limited');assert.ok(next.retryAt>Date.now()+80000 && next.retryAt<=Date.now()+90000);
});
test('thread comment recovery is limited to the open post page and its own comments',async()=>{
 const rows=[{id:'aaa1',author:'Original',body:'Kept text',created_utc:1700000000,link_id:'t3_abc12',parent_id:'t3_abc12'},{id:'bbb2',author:'Other',body:'Elsewhere',created_utc:1700000000,link_id:'t3_zzz99',parent_id:'t3_zzz99'}];
 const e=env({settings:{postDiscovery:true,archiveDiscovery:true,restoreDeletedContent:true},fetcher:async()=>response(rows)}),detail={url:'https://www.reddit.com/r/example/comments/abc12/title/'};
 const message={action:'archive-comments',postId:'t3_abc12',ids:['t1_aaa1','bbb2','aaa1']};
 const result=await e.send(message,detail);assert.equal(result.ok,true);assert.equal(JSON.stringify(result.posts.map(p=>p.id)),'["aaa1"]','comments from another post are dropped');assert.equal(result.posts[0].body,'Kept text');
 const url=new URL(e.calls[0][0]);assert.equal(url.pathname,'/api/comments/ids');assert.equal(url.searchParams.get('ids'),'aaa1,bbb2');assert.equal(e.calls.length,1,'no extra title lookup for thread pages');
 assert.equal((await e.send(message)).code,'forbidden','a profile page cannot ask for thread comments');
 assert.equal((await e.send({...message,postId:'zzz99'},detail)).code,'forbidden','another post id is rejected');
 for(const bad of [{ids:[]},{ids:Array.from({length:101},(_,i)=>'c'+i)},{ids:['bad id']},{postId:'no!'}])assert.equal((await e.send({...message,...bad},detail)).code,'invalid-request');
 e.setSettings({postDiscovery:true,archiveDiscovery:true,restoreDeletedContent:false});assert.equal((await e.send(message,detail)).code,'disabled','automatic restoration must be on');
});
test('requests follow the current page after Reddit’s in-page navigation (profile to post and back)',async()=>{
 const e=env();const profileDoc={url:'https://www.reddit.com/user/Example/submitted/'};
 assert.equal((await e.send({action:'archive-ids',ids:['abc12'],pageUrl:'https://www.reddit.com/r/example/comments/abc12/removed_by_moderator/'},profileDoc)).ok,true,'post opened from a profile');
 assert.equal((await e.send({action:'archive-ids',ids:['zzz99'],pageUrl:'https://www.reddit.com/r/example/comments/abc12/x/'},profileDoc)).code,'forbidden','only the open post');
 assert.equal((await e.send({pageUrl:'https://www.reddit.com/user/Example/'},{url:'https://www.reddit.com/r/example/comments/abc12/x/'})).ok,true,'profile opened from a post');
 assert.equal((await e.send({pageUrl:'https://www.reddit.com/user/Other/'},profileDoc)).code,'forbidden','another profile is refused');
 assert.equal((await e.send({pageUrl:'https://evil.test/user/Example/'},profileDoc)).code,'forbidden','another origin is refused');
});

test('archive media survives worker normalization',async()=>{
 const e=env({fetcher:async()=>response([row({url:'https://example.com/article',preview:{images:[{source:{url:'https://external-preview.redd.it/cover.jpg?width=640&amp;format=pjpg'}}]}})])});
 const result=await e.send();assert.equal(result.posts[0].media[0].url,'https://external-preview.redd.it/cover.jpg?width=640&format=pjpg');assert.equal(result.posts[0].media[0].kind,'preview');
});

test('Arctic Shift maintenance pauses archive requests with backoff; Retry now probes once and success resumes',async()=>{
 let down=true;const maintenance=()=>({ok:false,status:503,headers:{get:()=>null},async text(){return JSON.stringify({data:null,error:'Under maintenance'});}});
 const e=env({fetcher:async()=>down?maintenance():response([row()])});
 const first=await e.send();assert.equal(first.ok,false);assert.equal(first.code,'maintenance');assert.match(first.error,/down for maintenance/);
 assert.ok(first.retryAt-Date.now()>50000 && first.retryAt-Date.now()<=60000,'first pause is about a minute');
 const paused=await e.send({kind:'comment'});assert.equal(paused.code,'maintenance');assert.equal(e.calls.length,1,'paused requests never reach the network');
 const probe=await e.send({force:true});assert.equal(probe.code,'maintenance');assert.equal(e.calls.length,2,'Retry now probes once');assert.ok(probe.retryAt-Date.now()>100000,'the pause doubles');
 down=false;const back=await e.send({force:true});assert.equal(back.ok,true);const after=await e.send({kind:'comment'});assert.equal(after.ok,true,'success lifts the pause for everyone');
 const plain=env({fetcher:async()=>({ok:false,status:502,headers:{get:()=>null},async text(){return 'Bad gateway';}})});assert.equal((await plain.send()).code,'unavailable');
});

test('simultaneous requests that hit one outage count it once',async()=>{
 const e=env({fetcher:async()=>({ok:false,status:503,headers:{get:()=>null},async text(){return '{"error":"Under maintenance"}';}})});
 const [a,b]=await Promise.all([e.send(),e.send({kind:'comment'})]);assert.equal(e.calls.length,2);
 for(const result of [a,b]){assert.equal(result.code,'maintenance');assert.ok(result.retryAt-Date.now()<=60000);}
});

test('server cooldown headers are capped at one hour',async()=>{
 for(const headers of [{'Retry-After':'99999999'},{'X-RateLimit-Reset':'4102444800'},{'X-RateLimit-Reset-At':'4102444800000'}]){
  const e=env({fetcher:async()=>response([],429,headers)}),r=await e.send();assert.equal(r.code,'rate-limited');assert.ok(r.retryAt<=Date.now()+3600000+1000,'cooldown capped');assert.ok(r.retryAt>Date.now()+3500000);
 }
});
test('rate-limit and maintenance backoff survive a service-worker restart through session storage',async()=>{
 const session={};
 const limited=env({session,fetcher:async()=>response([],429,{'Retry-After':'120'})});await limited.send();await new Promise(r=>setImmediate(r));
 assert.ok(session['rt-archive-backoff-v1'].cooldownUntil>Date.now());
 const restarted=env({session}),r=await restarted.send();assert.equal(r.code,'rate-limited');assert.equal(restarted.calls.length,0);
 const s2={};const maint=env({session:s2,fetcher:async()=>({ok:false,status:503,headers:{get:()=>null},async text(){return '{"error":"Under maintenance"}';}})});
 assert.equal((await maint.send()).code,'maintenance');await new Promise(r=>setImmediate(r));assert.equal(s2['rt-archive-backoff-v1'].unavailableCount,1);
 const after=env({session:s2}),again=await after.send({before:1700000000});assert.equal(again.code,'maintenance');assert.equal(after.calls.length,0);
});
test('stored backoff is bounded and ignores malformed values',async()=>{
 const e=env({session:{'rt-archive-backoff-v1':{cooldownUntil:Date.now()+9e12,unavailableUntil:'x',unavailableCount:'many'}}}),r=await e.send();
 assert.equal(r.code,'rate-limited');assert.ok(r.retryAt<=Date.now()+3600000+1000);
});
test('the transport slot is released before parent-title lookups',async()=>{
 const titleGates=[],e=env({fetcher:url=>{const u=new URL(url);if(u.pathname==='/api/posts/ids')return new Promise(resolve=>titleGates.push(()=>resolve(response([]))));return Promise.resolve(response([row({id:'19rktoupyflj9',author:u.searchParams.get('author'),body:'Archived comment',link_id:'t3_abc12'})]));}});
 const comments=[1,2].map(i=>e.send({kind:'comment',username:'Example'+i},{url:'https://www.reddit.com/user/Example'+i+'/comments/'}));
 await new Promise(r=>setTimeout(r,20));assert.equal(titleGates.length,2);
 // Both slots would still be held if title lookups kept them; a third profile request must reach fetch now.
 const third=e.send({username:'Third'},{url:'https://www.reddit.com/user/Third/'});await new Promise(r=>setTimeout(r,20));
 assert.ok(e.calls.some(([url])=>new URL(url).searchParams.get('author')==='third'));
 titleGates.forEach(g=>g());await Promise.all([...comments,third]);
});

test('archive comment searches can enrich thread titles without changing normal search requests',async()=>{
 const e=env({fetcher:async url=>new URL(url).pathname.endsWith('/posts/ids')?response([{id:'parent',title:'Synthetic parent title',subreddit:'example'}]):response([row({id:'c1',body:'Reply',link_id:'t3_parent',subreddit:'example'})])});
 const request={action:'archive-search',kind:'comment',subreddit:'example'};
 const plain=await e.send(request,{tab:{id:1}});assert.equal(plain.ok,true,JSON.stringify(plain));assert.equal(e.calls.length,1);
 const enriched=await e.send({...request,titles:true},{tab:{id:1}});assert.equal(enriched.ok,true);assert.equal(enriched.posts[0].title,'Synthetic parent title');assert.equal(e.calls.filter(([url])=>new URL(url).pathname.endsWith('/posts/ids')).length,1);
});

test('archived thread pages are bounded to the open post, retain parents and reject unrelated comments',async()=>{
 const e=env({fetcher:async()=>response([row({id:'c1',body:'Reply',link_id:'t3_abc12',parent_id:'t1_parent',subreddit:'example'}),row({id:'other',body:'Foreign',link_id:'t3_other',subreddit:'example'})])}),sender={url:'https://www.reddit.com/r/example/comments/abc12/title/',tab:{id:1}};
 const request={action:'archive-thread-comments',postId:'abc12'};
 assert.equal((await e.send({...request,postId:'other'},sender)).code,'forbidden');assert.equal(e.calls.length,0);
 const r=await e.send(request,sender);assert.equal(r.ok,true);assert.equal(r.posts.length,1);assert.equal(r.posts[0].parentId,'t1_parent');assert.equal(r.incomplete,true);
 const [url,options]=e.calls[0];assert.equal(new URL(url).searchParams.get('link_id'),'abc12');assert.equal(new URL(url).searchParams.get('limit'),'100');assert.equal(options.credentials,'omit');
 for(const bad of [{before:'soon'},{before:-1},{focusId:'bad id'}])assert.equal((await e.send({...request,...bad},sender)).code,'invalid-request');
});
test('thread comment pagination detects stalled cursors and focused IDs remain scoped to the open post',async()=>{
 const e=env({fetcher:async url=>new URL(url).pathname.endsWith('/comments/ids')?response([row({id:'focus',body:'Focused',link_id:'t3_foreign',subreddit:'example'})]):response(Array.from({length:100},(_,i)=>row({id:(1000+i).toString(36),body:'Reply',link_id:'t3_abc12',created_utc:1700000000,subreddit:'example'})))}),sender={url:'https://www.reddit.com/r/example/comments/abc12/title/',tab:{id:1}};
 const r=await e.send({action:'archive-thread-comments',postId:'abc12',before:1700000001,focusId:'focus'},sender);assert.equal(r.ok,true);assert.equal(r.hasMore,true);assert.equal(r.cursorStalled,true);assert.equal(r.posts.some(p=>p.id==='focus'),false);
 e.setSettings({postDiscovery:true,archiveDiscovery:false});assert.equal((await e.send({action:'archive-thread-comments',postId:'abc12'},sender)).code,'disabled');
});

test('archive profile reads support the dedicated Removed list shell without opening other list routes',async()=>{
 const e=env();assert.equal((await e.send({}, {url:'https://www.reddit.com/user/Example/hidden/?rt_view=removed'})).ok,true);
 for(const url of ['https://www.reddit.com/user/Other/hidden/?rt_view=removed','https://www.reddit.com/user/Example/hidden/','https://www.reddit.com/user/Example/saved/'])assert.equal((await e.send({}, {url})).code,'forbidden');
});
