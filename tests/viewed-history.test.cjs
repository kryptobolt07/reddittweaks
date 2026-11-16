// Viewed-posts History beyond Reddit's 20 (spec docs/viewed-history-spec.md): store, worker broker and page recorder.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {IDBFactory,IDBKeyRange}=require('fake-indexeddb');
const {JSDOM}=require('jsdom');
const read=file=>fs.readFileSync('extension/'+file,'utf8');
const flush=async()=>{for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r));};
const item=(id,extra={})=>({fullname:'t3_'+id,id,title:'Viewed '+id,subreddit:'Alpha',author:'Writer',permalink:'/r/Alpha/comments/'+id+'/viewed_'+id+'/',created:1790000000,postType:'text',score:5,comments:2,over18:false,spoiler:false,...extra});

function storeContext(clock={now:1800000000000}){
 const ctx=vm.createContext({indexedDB:new IDBFactory(),IDBKeyRange,URL,Date:class extends Date{static now(){return clock.now;}},console,setTimeout,clearTimeout});
 for(const file of ['post-model.js','viewed-store.js'])vm.runInContext(read(file),ctx);
 return {ctx,clock,store:ctx.RTViewedStore.create({indexedDB:ctx.indexedDB,now:()=>clock.now})};
}

test('the store keeps viewed posts newest first per account, moving a re-viewed post to the top',async()=>{
 const {store,clock}=storeContext(),me={owner:'t2_self',username:'Example'};
 for(const id of ['a1','b2','c3']){await store.record({...me,item:item(id),limit:0});clock.now+=1000;}
 await store.record({...me,item:item('a1'),limit:0});
 assert.deepEqual(Array.from(await store.load({...me,limit:0}),i=>i.fullname),['t3_a1','t3_c3','t3_b2']);
 assert.equal((await store.load({owner:'t2_other',username:'Other',limit:0})).length,0,'another account sees nothing');
 const first=(await store.load({...me,limit:0}))[0];assert.equal(first.title,'Viewed a1');assert.equal(first.viewedAt,clock.now);assert.equal(first.owner,undefined,'no account fields in results');
});

test('the store rejects malformed items and bounds their text',async()=>{
 const {store}=storeContext(),me={owner:'t2_self',username:'Example'};
 for(const bad of [{fullname:'t1_abc',id:'abc'},item('ok',{permalink:'https://evil.example/x'}),item('ok2',{created:-1}),{...item('ok3'),fullname:'t3_other'}])assert.equal(await store.record({...me,item:bad,limit:0}),false);
 await store.record({...me,item:item('long',{title:'x'.repeat(900),token:'SECRET'}),limit:0});
 const [saved]=await store.load({...me,limit:0});assert.equal(saved.title.length,300);assert.equal(saved.token,undefined);
 assert.equal(await store.record({owner:'nope',item:item('zz'),limit:0}),false);
});

test('a limit keeps only the newest views; no limit keeps all; trimming and clearing work across accounts',async()=>{
 const {store,clock}=storeContext(),me={owner:'t2_self',username:'Example'},them={owner:'t2_them',username:'Them'};
 for(let i=0;i<8;i++){await store.record({...me,item:item('p'+i),limit:5});await store.record({...them,item:item('q'+i),limit:0});clock.now+=1000;}
 assert.deepEqual(Array.from(await store.load({...me,limit:0}),i=>i.id),['p7','p6','p5','p4','p3']);
 assert.equal((await store.load({...them,limit:0})).length,8,'limits apply per account');
 assert.deepEqual(Array.from(await store.load({...them,limit:3}),i=>i.id),['q7','q6','q5'],'load honours a smaller limit');
 await store.trimAll(2);assert.equal((await store.load({...them,limit:0})).length,2);assert.equal((await store.load({...me,limit:0})).length,2);
 await store.clear();assert.equal((await store.load({...me,limit:0})).length,0);
});

function brokerContext({limit=1000,me={owner:'t2_self',username:'Example'}}={}){
 const values={'rt-settings-v1':{historyLimit:limit}};let listener,changed,identity=me;
 const chrome={runtime:{id:'own',onMessage:{addListener(fn){listener=fn;}}},storage:{local:{async get(k){return {[k]:structuredClone(values[k])};}},onChanged:{addListener(fn){changed=fn;}}}};
 const clock={now:1800000000000},ctx=vm.createContext({chrome,indexedDB:new IDBFactory(),IDBKeyRange,Date:class extends Date{static now(){return clock.now;}},console,setTimeout,clearTimeout,URL,
  RTRemovalBroker:{verify:async(sender,username)=>identity && identity.username.toLowerCase()===String(username).toLowerCase()?identity:null}});
 for(const file of ['post-model.js','viewed-store.js','viewed-broker.js'])vm.runInContext(read(file),ctx);
 const sender={id:'own',frameId:0,tab:{id:1},url:'https://www.reddit.com/r/Alpha/comments/a1/x/'};
 const send=(message,from=sender)=>new Promise(resolve=>{if(listener({scope:'rt-viewed',owner:'t2_self',username:'Example',...message},from,resolve)!==true)resolve(undefined);});
 return {send,values,clock,setMe:v=>identity=v,async setLimit(next){values['rt-settings-v1']={historyLimit:next};await changed({'rt-settings-v1':{newValue:values['rt-settings-v1']}},'local');}};
}

test('the worker records from Reddit pages by account ID and loads only for the verified signed-in account, above Reddit’s 20',async()=>{
 const b=brokerContext();assert.equal((await b.send({action:'record',item:item('a1')})).ok,true);b.clock.now+=10;await b.send({action:'record',item:item('b2')});
 const loaded=await b.send({action:'load'});assert.equal(loaded.ok,true);assert.equal(loaded.limit,1000);assert.deepEqual(Array.from(loaded.items,i=>i.id),['b2','a1']);
 b.setMe({owner:'t2_other',username:'Other'});assert.equal((await b.send({action:'load'})).ok,false,'loading needs the verified signed-in account');
 assert.equal((await b.send({action:'record',item:item('c3')},{id:'own',frameId:3,tab:{id:1},url:'https://www.reddit.com/'})).ok,false,'subframes cannot record');
 assert.equal((await b.send({action:'record',item:item('c3')},{id:'own',frameId:0,tab:{id:1},url:'https://evil.example/'})).ok,false,'only Reddit pages record');
 b.setMe({owner:'t2_self',username:'Example'});assert.equal((await b.send({action:'load'},{id:'evil',frameId:0,tab:{id:1},url:'https://www.reddit.com/'})).ok,false,'only this extension');
 const off=brokerContext({limit:20});assert.equal((await off.send({action:'record',item:item('a1')})).recorded,false,'Reddit’s 20 records nothing');assert.equal((await off.send({action:'load'})).items.length,0);
});

test('choosing Reddit’s 20 deletes recorded history; lowering the limit trims it',async()=>{
 const b=brokerContext({limit:0});for(let i=0;i<105;i++){await b.send({action:'record',item:item('p'+i)});b.clock.now+=10;}
 await b.setLimit(100);b.values['rt-settings-v1']={historyLimit:0};const kept=Array.from((await b.send({action:'load'})).items,i=>i.id);
 assert.equal(kept.length,100,'trimmed, not just hidden');assert.equal(kept[0],'p104');assert.equal(kept.at(-1),'p5');
 await b.setLimit(20);b.values['rt-settings-v1']={historyLimit:0};assert.equal((await b.send({action:'load'})).items.length,0,'deleted when set to Reddit’s 20');
 await b.setLimit(7);b.values['rt-settings-v1']={historyLimit:0};assert.equal((await b.send({action:'load'})).items.length,0,'an unknown value counts as Reddit’s 20');
});

// Page recorder: the post you open, once per visit, only when signed in and above Reddit's 20.
function page(t,{url='https://www.reddit.com/r/Alpha/comments/abc123/a_viewed_post/',limit=1000,identity={owner:'t2_self',username:'Example'},html}={}){
 const post='<shreddit-post id="t3_abc123" post-title="A viewed post" subreddit-name="Alpha" author="Writer" created-timestamp="2026-11-10T10:00:00Z" permalink="/r/Alpha/comments/abc123/a_viewed_post/" post-type="image" score="42" comment-count="7" nsfw></shreddit-post>';
 const dom=new JSDOM((identity?'<shreddit-app user-logged-in="true" logged-in-user-id="'+identity.owner+'"></shreddit-app>':'<shreddit-app user-logged-in="false"></shreddit-app>')+'<main>'+(html ?? post+'<shreddit-feed><shreddit-post id="t3_feed1" post-title="Other" subreddit-name="Beta" author="X" created-timestamp="2026-11-10T10:00:00Z" permalink="/r/Beta/comments/feed1/other/"></shreddit-post></shreddit-feed>')+'</main>',{url,runScripts:'outside-only',pretendToBeVisual:true}),W=dom.window,sent=[];t.after(()=>{r?.destroy();W.close();});
 W.eval(read('post-model.js'));W.eval(read('viewed-history.js'));
 let settings={historyLimit:limit};const r=new W.RTViewedHistory.Recorder({readSettings:async()=>settings,send:async m=>{sent.push(m);return {ok:true};},observe:false});
 return {W,r,sent,setSettings:v=>settings=v};
}
test('opening a post records it once with its title, community and facts; feed cards are not views',async t=>{
 const s=page(t);await s.r.ready;await s.r.scan();await s.r.scan();await flush();
 assert.equal(s.sent.length,1);const m=s.sent[0];assert.equal(m.action,'record');assert.equal(m.owner,'t2_self','Reddit’s logged-in account ID: post pages carry no username');assert.equal(m.username,undefined);
 assert.deepEqual({fullname:m.item.fullname,title:m.item.title,subreddit:m.item.subreddit,author:m.item.author,postType:m.item.postType,score:m.item.score,comments:m.item.comments,over18:m.item.over18},{fullname:'t3_abc123',title:'A viewed post',subreddit:'Alpha',author:'Writer',postType:'image',score:42,comments:7,over18:true});
 assert.equal(m.item.permalink,'/r/Alpha/comments/abc123/a_viewed_post/');
});
test('a client-side navigation to another post records that post; returning later records it again',async t=>{
 const s=page(t);await s.r.ready;await s.r.scan();
 s.W.history.pushState({},'','/r/Beta/comments/feed1/other/');s.W.document.querySelector('shreddit-post').remove();await s.r.scan();
 s.W.history.pushState({},'','/r/Alpha/comments/abc123/a_viewed_post/');s.W.document.querySelector('main').insertAdjacentHTML('afterbegin','<shreddit-post id="t3_abc123" post-title="A viewed post" subreddit-name="Alpha" author="Writer" created-timestamp="2026-11-10T10:00:00Z" permalink="/r/Alpha/comments/abc123/a_viewed_post/"></shreddit-post>');await s.r.scan();
 assert.deepEqual(s.sent.map(m=>m.item.fullname),['t3_abc123','t3_feed1','t3_abc123']);
});
test('nothing is recorded at Reddit’s 20, when signed out, or off a post page',async t=>{
 const off=page(t,{limit:20});await off.r.ready;await off.r.scan();assert.equal(off.sent.length,0);
 const signedOut=page(t,{identity:null});await signedOut.r.ready;await signedOut.r.scan();assert.equal(signedOut.sent.length,0);
 const feed=page(t,{url:'https://www.reddit.com/r/Alpha/'});await feed.r.ready;await feed.r.scan();assert.equal(feed.sent.length,0);
 const later=page(t,{limit:20});await later.r.ready;later.setSettings({historyLimit:500});await later.r.configure({historyLimit:500});await later.r.scan();assert.equal(later.sent.length,1,'turning it on records the open post');
});
test('settings accept only the offered History limits, defaulting to Reddit’s 20',()=>{
 const dom=new JSDOM('',{runScripts:'outside-only'});dom.window.eval(read('post-model.js'));const N=dom.window.RTPostModel.normalizeSettings;
 assert.equal(N({}).historyLimit,20);for(const v of [100,500,1000,5000,0])assert.equal(N({historyLimit:v}).historyLimit,v);for(const v of [7,'1000',-1,null,1e9])assert.equal(N({historyLimit:v}).historyLimit,20);dom.window.close();
});
test('the recorder reads settings from the worker (pages cannot read extension storage) and follows pushed changes',async t=>{
 const dom=new JSDOM('<shreddit-app user-logged-in="true" logged-in-user-id="t2_self"></shreddit-app><main></main>',{url:'https://www.reddit.com/r/Alpha/',runScripts:'outside-only'}),W=dom.window;t.after(()=>W.close());
 const asked=[];let push;W.chrome={runtime:{id:'own',async sendMessage(m){asked.push(m);return {ok:true,settings:{historyLimit:500}};},onMessage:{addListener(fn){push=fn;},removeListener(){}}},storage:{local:{get(){throw Error('Access to storage is not allowed from this context.');}}}};
 W.eval(read('post-model.js'));W.eval(read('viewed-history.js'));const r=new W.RTViewedHistory.Recorder({observe:true,send:async()=>({ok:true})});t.after(()=>r.destroy());await r.ready;
 assert.deepEqual({scope:asked[0].scope,action:asked[0].action},{scope:'rt-posts',action:'get-settings'});assert.equal(r.limit,500);
 push({scope:'rt-posts',action:'settings-changed',settings:{historyLimit:20}},{id:'own'});assert.equal(r.limit,20);push({scope:'rt-posts',action:'settings-changed',settings:{historyLimit:0}},{id:'evil'});assert.equal(r.limit,20,'only this extension');
});
