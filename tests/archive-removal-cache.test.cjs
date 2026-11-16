const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const row=id=>({id,author:'Example',body:'Original archived comment',link_id:'t3_parent',created_utc:1700000000,retrieved_on:1700000030});
function setup({session={},fetcher,clock={now:1800000000000},me={owner:'t2_self',username:'Example'},onRead}={}){
 let listener,changed,identity=me,cfg={postDiscovery:true,ownRemoval:true,archiveDiscovery:true};const calls=[],starts=[];class FakeDate extends Date{static now(){return clock.now;}}
 const c=vm.createContext({URL,AbortController,Date:FakeDate,console,clearTimeout,setTimeout:(fn,ms)=>ms===12000?setTimeout(fn,ms):setTimeout(()=>{clock.now+=ms;fn();},0),RTRemovalBroker:{verify:async()=>identity},chrome:{runtime:{id:'own',onMessage:{addListener(fn){listener=fn;}}},storage:{onChanged:{addListener(fn){changed=fn;}},local:{async get(){return {'rt-settings-v1':cfg};}},session:{async get(k){await onRead?.(k);return {[k]:structuredClone(session[k])};},async set(v){Object.assign(session,structuredClone(v));},async remove(k){delete session[k];}}},tabs:{async sendMessage(){}}},fetch:async url=>{url=new URL(url);calls.push(url);starts.push(clock.now);const result=fetcher?await fetcher(url):{data:url.searchParams.has('ids')?url.searchParams.get('ids').split(',').filter(id=>id!=='missing').map(row):[]};return {ok:!result.status || result.status===200,status:result.status || 200,headers:{get:()=>null},async text(){return JSON.stringify({data:result.data});}};}});
 for(const file of ['post-model.js','archive-memo.js','post-broker.js'])vm.runInContext(fs.readFileSync('extension/'+file,'utf8'),c);
 const send=(m={})=>new Promise(resolve=>{listener({scope:'rt-posts',action:'archive-removal',owner:'t2_self',username:'Example',kind:'comment',ids:['a'],...m},{id:'own',frameId:0,tab:{id:1,url:'https://www.reddit.com/user/Example/search/?rt_list=removed'},url:'https://www.reddit.com/user/Example/search/?rt_list=removed'},resolve);});return {send,calls,starts,session,clock,setMe:m=>identity=m,async disable(){cfg={...cfg,archiveDiscovery:false};await changed({'rt-settings-v1':{newValue:cfg}},'local');}};
}
test('removal evidence cache reuses overlapping IDs and successful misses across tabs and worker restart',async()=>{
 const session={},clock={now:1800000000000},s=setup({session,clock});await s.send({ids:['a','missing']});const second=await s.send({ids:['a','b','missing']});assert.deepEqual(s.calls.map(u=>u.searchParams.get('ids')),['a,missing','b']);assert.deepEqual([...second.posts.map(p=>p.id)],['a','b']);
 const resumed=setup({session,clock});await resumed.send({ids:['missing','a']});assert.equal(resumed.calls.length,0);clock.now+=3600001;await resumed.send({ids:['a','missing']});assert.equal(resumed.calls[0].searchParams.get('ids'),'missing','miss refreshes after 1 h while a found record stays cached');clock.now+=86400001;await resumed.send({ids:['a']});assert.equal(resumed.calls.length,2);
});
test('overlapping concurrent archive requests share records; ID and history misses use a single paced queue',async()=>{
 const s=setup();await Promise.all([s.send({ids:['a','b']}),s.send({ids:['b','c']})]);await s.send({action:'archive-profile',purpose:'removal-history',ids:undefined});assert.deepEqual(s.calls.slice(0,2).map(u=>u.searchParams.get('ids')),['a,b','c']);assert.ok(s.starts.every((t,i)=>!i || t-s.starts[i-1]>=1000));
});
test('own history pages including empty pages survive worker restart for 6 h without affecting normal profile reads',async()=>{
 const session={},clock={now:1800000000000},s=setup({session,clock}),query={action:'archive-profile',purpose:'removal-history',ids:undefined};await s.send(query);const resumed=setup({session,clock});await resumed.send(query);assert.equal(resumed.calls.length,0);await resumed.send({...query,purpose:undefined});assert.equal(resumed.calls.length,1,'regular profile activity is independent');clock.now+=21600001;await resumed.send(query);assert.equal(resumed.calls.length,2);
});
test('archive failures do not cache absence; stale accounts cannot read cached results and archive opt-out clears session responses',async()=>{
 let failing=true;const s=setup({fetcher:async()=>failing?{status:500}:({data:[row('a')]})});assert.equal((await s.send()).ok,false);failing=false;assert.equal((await s.send()).ok,false);assert.equal(s.calls.length,1,'transient failures pause repeated archive attempts');s.clock.now+=60001;assert.equal((await s.send()).ok,true);assert.equal(s.calls.length,2);s.setMe({owner:'t2_other',username:'Other'});assert.equal((await s.send()).ok,false);assert.equal(s.calls.length,2);await s.disable();assert.equal(JSON.stringify(s.session).includes('Original archived comment'),false);
});


test('a cached history response is rejected if the native account changes during cache loading',async()=>{
 const session={},seed=setup({session}),query={action:'archive-profile',purpose:'removal-history',ids:undefined};await seed.send(query);
 let enter,release;const entered=new Promise(r=>enter=r),gate=new Promise(r=>release=r),resumed=setup({session,onRead:async key=>{if(key==='rt-own-archive-session-v1'){enter();await gate;}}});const pending=resumed.send(query);await entered;resumed.setMe({owner:'t2_other',username:'Other'});release();assert.equal((await pending).ok,false);assert.equal(resumed.calls.length,0);
});
test('disabling archive during a pending response leaves no cached body and account changes never populate the cache',async()=>{
 let enter,release;const entered=new Promise(r=>enter=r),gate=new Promise(r=>release=r),s=setup({fetcher:async()=>{enter();await gate;return {data:[row('a')]};}});const pending=s.send();await entered;await s.disable();release();assert.equal((await pending).ok,false);assert.equal(JSON.stringify(s.session).includes('Original archived comment'),false);
});
test('an archive refusal of a heavy history query (HTTP 422) does not pause your item lookups',async()=>{
 const s=setup({fetcher:async url=>url.searchParams.has('author')?{status:422}:{data:[row('a')]}});
 const history=await s.send({action:'archive-profile',purpose:'removal-history',ids:undefined});assert.equal(history.ok,false);
 const lookup=await s.send({ids:['a']});assert.equal(lookup.ok,true,'a 4xx refusal is about that query, not the service');assert.equal(s.calls.length,2);
 const again=await s.send({action:'archive-profile',purpose:'removal-history',ids:undefined});assert.equal(again.ok,false);assert.equal(s.calls.length,3,'the history page may be retried');
});
test('item lookups go ahead of queued history pages in the shared paced queue',async()=>{
 const s=setup(),history=b=>s.send({action:'archive-profile',purpose:'removal-history',ids:undefined,before:b});
 await Promise.all([history(1700000500),history(1700000400),s.send({ids:['a']}),history(1700000300)]);
 const order=s.calls.map(u=>u.searchParams.has('ids')?'ids':'history:'+u.searchParams.get('before'));
 assert.deepEqual(order,['history:1700000500','ids','history:1700000400','history:1700000300']);assert.ok(s.starts.every((t,i)=>!i || t-s.starts[i-1]>=1000),'still paced');
});
