const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const row=(extra={})=>({id:'abc12',author:'Example',created_utc:1700000000,selftext:'Public archive',...extra});
function env({fetcher,settings={postDiscovery:true,archiveDiscovery:true},fastTimeout=false}={}){
 let listener,settingsListener,calls=[],stored=settings,notifications=[];
 const context=vm.createContext({URL,AbortController,Date,console,setTimeout:fastTimeout?(fn)=>setTimeout(fn,5):setTimeout,clearTimeout,
 chrome:{runtime:{id:'own',onMessage:{addListener(fn){listener=fn;}}},storage:{onChanged:{addListener(fn){settingsListener=fn;}},local:{async get(){return {'rt-settings-v1':stored};}}},tabs:{async sendMessage(...args){notifications.push(args);}}},
 fetch:async(...args)=>{calls.push(args);return fetcher?fetcher(...args):response([row()]);}});
 for(const file of ['post-model.js','post-broker.js'])vm.runInContext(fs.readFileSync('extension/'+file,'utf8'),context);
 return {calls,notifications,changeSettings(value){stored=value;settingsListener({'rt-settings-v1':{newValue:value}},'local');},setSettings(value){stored=value;},send(message={},sender={}){return new Promise(resolve=>{const result=listener({scope:'rt-posts',action:'archive-profile',username:'Example',...message},{id:'own',frameId:0,url:'https://www.reddit.com/user/Example/',...sender},resolve);if(result!==true)resolve(undefined);});}};
}
function response(data,status=200,headers={}){return {ok:status===200,status,headers:{get:key=>headers[key]??null},async text(){return JSON.stringify({data});}};}
test('broker uses fixed credential-free endpoint and sanitizes source/profile data',async()=>{
 const e=env({fetcher:async()=>response([row(),row({id:'foreign',author:'other'})])}),r=await e.send();assert.equal(r.ok,true);assert.equal(r.posts.length,1);assert.equal(r.incomplete,true);assert.equal(r.posts[0].status,'unknown');
 const [url,options]=e.calls[0];assert.equal(new URL(url).hostname,'arctic-shift.photon-reddit.com');assert.equal(new URL(url).searchParams.get('limit'),'25');assert.equal(options.credentials,'omit');assert.equal(options.referrerPolicy,'no-referrer');assert.equal(options.redirect,'error');
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
 const e=env({fetcher:async()=>response(Array.from({length:25},(_,i)=>row({id:(100+i).toString(36)})))}),first=await e.send();assert.equal(first.before,1700000001);assert.equal(first.hasMore,true);assert.equal(first.cursorStalled,false);
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
test('API field projection contains exactly documented selectable post fields',async()=>{
 const e=env();await e.send();assert.equal(new URL(e.calls[0][0]).searchParams.get('fields'),'id,author,subreddit,title,selftext,created_utc,url,over_18,spoiler,score,num_comments');
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
 assert.equal(result.ok,true);assert.deepEqual(JSON.parse(JSON.stringify(result.settings)),{postDiscovery:true,archiveDiscovery:false,restoreDeletedContent:true});assert.equal(e.calls.length,0);
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
 const url=new URL(e.calls[0][0]);assert.equal(url.pathname,'/api/comments/search');assert.equal(url.searchParams.get('fields'),'id,author,subreddit,body,created_utc,link_id,parent_id,score');
 assert.equal((await e.send({kind:'video'})).code,'invalid-request');
});

test('settings changes reach registered Reddit tabs without exposing trusted chat storage',async()=>{
 const e=env();await e.send({action:'get-settings'},{tab:{id:5,url:'https://www.reddit.com/user/Example/'}});
 e.changeSettings({postDiscovery:false,archiveDiscovery:false,privateChats:['secret']});await new Promise(r=>setImmediate(r));
 assert.equal(e.notifications.length,1);assert.equal(e.notifications[0][0],5);const data=JSON.parse(JSON.stringify(e.notifications[0][1]));assert.deepEqual(data,{scope:'rt-posts',action:'settings-changed',settings:{postDiscovery:false,archiveDiscovery:false,restoreDeletedContent:true}});
});

test('archive author requests allow same-profile SPA tabs while rejecting other profiles and unsupported pages',async()=>{
 const e=env();
 for(const suffix of ['submitted/','comments/','']){
  const result=await e.send({}, {url:'https://www.reddit.com/user/Example/',tab:{url:'https://www.reddit.com/user/Example/'+suffix}});assert.equal(result.ok,true);
 }
 assert.equal((await e.send({}, {url:'https://www.reddit.com/user/Example/comments/',tab:{url:'https://www.reddit.com/user/Example/'}})).ok,true);
 for(const target of ['https://www.reddit.com/user/Other/comments/','https://www.reddit.com/user/Example/saved/','https://www.reddit.com/r/example/','https://evil.test/user/Example/'])assert.equal((await e.send({}, {tab:{url:target}})).code,'forbidden');
 assert.equal((await e.send({}, {url:'https://www.reddit.com/user/Other/',tab:{url:'https://www.reddit.com/user/Example/comments/'}})).code,'forbidden');
 assert.equal((await e.send({action:'archive-ids',ids:['abc12']},{url:'https://www.reddit.com/comments/abc12/',tab:{url:'https://www.reddit.com/user/Example/comments/'}})).code,'forbidden');
});

test('reply archive lookup joins only previously discovered child parents and projects compact author context',async()=>{
 const e=env({fetcher:async url=>new URL(url).pathname.endsWith('/search')?response([row({id:'child1',body:'Reply',link_id:'t3_post',parent_id:'t1_parent'}),row({id:'child2',body:'Reply',link_id:'t3_post',parent_id:'t1_parent'})]):response([row({id:'parent',author:'Recipient',link_id:'t3_post'})])}),sender={tab:{id:7,url:'https://www.reddit.com/user/Example/comments/'}};
 assert.equal((await e.send({action:'archive-parents',children:['child1']},sender)).code,'forbidden');assert.equal(e.calls.length,0);await e.send({kind:'comment'},sender);
 const value=await e.send({action:'archive-parents',children:['child1','child2']},sender);assert.equal(value.ok,true);assert.equal(value.posts[0].author,'Recipient');assert.equal(value.posts[0].body,'');const [url,options]=e.calls[1];assert.equal(new URL(url).pathname,'/api/comments/ids');assert.equal(new URL(url).searchParams.get('ids'),'parent');assert.equal(new URL(url).searchParams.get('fields'),'id,author,link_id,created_utc');assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');await e.send({action:'archive-parents',children:['child2']},sender);assert.equal(e.calls.length,2);
});
test('reply archive lookup cannot request arbitrary parents, cross tabs/profiles or reuse proofs after opt-out',async()=>{
 const e=env({fetcher:async()=>response([row({id:'child',body:'Reply',link_id:'t3_post',parent_id:'t1_parent'})])}),sender={tab:{id:7,url:'https://www.reddit.com/user/Example/'}};await e.send({kind:'comment'},sender);
 for(const [message,source] of [[{children:['unknown']},sender],[{children:['child']},{tab:{id:8,url:sender.tab.url}}],[{children:['child'],username:'Other'},sender],[{children:['child']},{...sender,frameId:1}]])assert.equal((await e.send({action:'archive-parents',...message},source)).code,'forbidden');
 assert.equal((await e.send({action:'archive-parents',children:['../../bad']},sender)).code,'invalid-request');assert.equal(e.calls.length,1);e.changeSettings({postDiscovery:true,archiveDiscovery:false});assert.equal((await e.send({action:'archive-parents',children:['child']},sender)).code,'disabled');e.changeSettings({postDiscovery:true,archiveDiscovery:true});assert.equal((await e.send({action:'archive-parents',children:['child']},sender)).code,'forbidden');assert.equal(e.calls.length,1);
});
test('reply archive results must belong to the child thread and opting out discards an in-flight result',async()=>{
 let release;const e=env({fetcher:async url=>new URL(url).pathname.endsWith('/search')?response([row({id:'child',body:'Reply',link_id:'t3_post',parent_id:'t1_parent'})]):new Promise(r=>release=r)}),sender={tab:{id:9,url:'https://www.reddit.com/user/Example/'}};await e.send({kind:'comment'},sender);
 const pending=e.send({action:'archive-parents',children:['child']},sender);await new Promise(r=>setImmediate(r));release(response([row({id:'parent',author:'Wrong',link_id:'t3_other'})]));assert.equal((await pending).posts.length,0);
 e.changeSettings({postDiscovery:true,archiveDiscovery:true});await e.send({kind:'comment'},sender);const second=e.send({action:'archive-parents',children:['child']},sender);await new Promise(r=>setImmediate(r));e.changeSettings({postDiscovery:true,archiveDiscovery:false});release(response([row({id:'parent',author:'Recipient',link_id:'t3_post'})]));assert.equal((await second).code,'disabled');
});

test('automatic recovery validates bounded IDs and requires the matching active public profile',async()=>{
 const e=env(),message={action:'archive-recover',kind:'post',ids:['t3_abc12']};
 for(const source of [{id:'foreign'},{frameId:1},{origin:'https://evil.test'},{url:'https://www.reddit.com/comments/abc12/'},{tab:{url:'https://www.reddit.com/user/Other/'}},{url:'https://www.reddit.com/user/Other/',tab:{url:'https://www.reddit.com/user/Example/'}},{tab:{url:'https://www.reddit.com/user/Example/saved/'}}])assert.equal((await e.send(message,source)).code,'forbidden');
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
 await e.send({action:'archive-recover',kind:'post',ids:['abc12']});assert.equal(e.calls.length,2);assert.equal(new URL(e.calls[1][0]).pathname,'/api/posts/ids');
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
