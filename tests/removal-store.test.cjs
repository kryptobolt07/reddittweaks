const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs'),vm=require('node:vm');
function setup({limit=5000,now=()=>1800000000000}={}){const data={},storage={async get(key){return {[key]:structuredClone(data[key])};},async set(value){Object.assign(data,structuredClone(value));},async remove(key){delete data[key];}};const c=vm.createContext({Date,URL,Map,Set,Promise});for(const f of ['removal-model.js','removal-store.js'])vm.runInContext(fs.readFileSync('extension/'+f,'utf8'),c);return {store:c.RTRemovalStore.create({storage,now,limit}),data};}
const record=(state='unknown',checkedAt=1799999000000,extra={})=>({fullname:'t1_19gsnavtu46ip',state,confidence:state==='unknown'?'unknown':'verified',why:'Native evidence',flags:[],permalink:'/r/Alpha/comments/post1/title/19gsnavtu46ip/',checkedAt,...extra});
const report=(records,extra={})=>({owner:'t2_self',username:'Example',records,...extra});
test('monitor storage keeps bounded metadata only, account scoped, with no body or credential persistence',async()=>{
 const {store,data}=setup();await store.record(report([record('removed-auto',undefined,{body:'PRIVATE TEXT',token:'SECRET'})]));const a=await store.read('t2_self','Example');assert.equal(Object.keys(a.items).length,1);assert.equal(a.unread,0);assert.equal(JSON.stringify(data).includes('PRIVATE TEXT'),false);assert.equal(JSON.stringify(data).includes('SECRET'),false);assert.equal(Object.keys((await store.read('t2_other','Other')).items).length,0);
});
test('first observations are a baseline; subsequent transitions increment unread once with notifications enabled',async()=>{
 const {store}=setup();await store.record(report([record('unknown')],{notify:true}));await store.record(report([record('removed-auto',1799999000100)],{notify:true}));const a=await store.read('t2_self','Example');assert.equal(a.unread,1);assert.equal(a.changes[0].type,'removed');
 await store.record(report([record('removed-auto',1799999000200)],{notify:true}));assert.equal((await store.read('t2_self','Example')).changes.length,1);
});
test('failed checks cannot produce approval; a later verified approval can',async()=>{
 const {store}=setup();await store.record(report([record('removed-mod')]));await store.record(report([record('unknown',1799999000100)],{notify:true}));assert.equal((await store.read('t2_self','Example')).unread,0);
 await store.record(report([record('visible',1799999000200)],{notify:true}));const a=await store.read('t2_self','Example');assert.equal(a.unread,1);assert.equal(a.changes[0].type,'approved');
});
test('concurrent and stale reports do not duplicate or undo changes; restart retains the baseline',async()=>{
 const {store}=setup();await store.record(report([record('visible')]));await Promise.all([store.record(report([record('removed-mod',1799999000100)],{notify:true})),store.record(report([record('removed-mod',1799999000100)],{notify:true}))]);
 await store.record(report([record('visible',1799999000001)],{notify:true}));const a=await store.read('t2_self','Example');assert.equal(a.unread,1);assert.equal(a.items.t1_19gsnavtu46ip.state,'removed-mod');
});
test('marking history seen and clearing data apply only to the requested account',async()=>{
 const {store}=setup();for(const owner of ['t2_self','t2_other']){await store.record(report([record('unknown')],{owner}));await store.record(report([record('removed-mod',1799999000100)],{owner,notify:true}));}
 await store.seen('t2_self','Example');assert.equal((await store.read('t2_self','Example')).unread,0);assert.equal((await store.read('t2_other','Example')).unread,1);
 await store.clear('t2_self');assert.equal(Object.keys((await store.read('t2_self','Example')).items).length,0);assert.equal(Object.keys((await store.read('t2_other','Example')).items).length,1);
});
test('invalid accounts, impossible timestamps, unknown states and external links are rejected',async()=>{
 const {store}=setup();for(const input of [report([record()],{owner:'../x'}),report([record('fake')]),report([record('visible',Infinity)]),report([record('visible',1800000500000)]),report([record('visible',undefined,{permalink:'https://evil.example/x'})])])await assert.rejects(()=>store.record(input));
});
test('notification-off records changes without unread counts; self-deletion never alerts',async()=>{
 const {store}=setup();await store.record(report([record('unknown')]));await store.record(report([record('removed-mod',1799999000100)]));assert.equal((await store.read('t2_self','Example')).unread,0);
 await store.record(report([record('deleted',1799999000200)],{notify:true}));assert.equal((await store.read('t2_self','Example')).changes.length,1);
});
test('the oldest entries are evicted at the account cap',async()=>{
 const {store}=setup({limit:2});await store.record(report([record('unknown',1799999000000,{fullname:'t3_a'}),record('unknown',1799999000100,{fullname:'t3_b'}),record('unknown',1799999000200,{fullname:'t3_c'})]));const a=await store.read('t2_self','Example');assert.deepEqual(Object.keys(a.items).sort(),['t3_b','t3_c']);
});
test('posts published to a user profile are valid monitoring links and do not reject the batch',async()=>{
 const {store}=setup();await store.record(report([record('unknown',1799999000000,{fullname:'t3_profile',permalink:'/user/Example/comments/profile/title/'}),record('unknown')]));assert.equal(Object.keys((await store.read('t2_self','Example')).items).length,2);
});
test('the cache retains unsigned proof provenance without retaining response bodies',async()=>{
 const {store}=setup();await store.record(report([record('visible',1799999000100,{publicStatus:'visible',publicCheckedAt:1799999000000,publicBody:'not saved'})]));const item=(await store.read('t2_self','Example')).items.t1_19gsnavtu46ip;assert.equal(item.publicStatus,'visible');assert.equal(item.publicCheckedAt,1799999000000);assert.equal(item.publicBody,undefined);
});
test('replacing an old metadata-only verdict with its first public proof establishes a new baseline',async()=>{
 const {store}=setup();await store.record(report([record('removed-auto',1799999000000,{confidence:'likely'})]));await store.record(report([record('visible',1799999000100,{publicStatus:'visible',publicCheckedAt:1799999000100})],{notify:true}));assert.equal((await store.read('t2_self','Example')).changes.length,0);
});
test('signed-out result cache: per account, short-lived, statuses only, no text',async()=>{
 const now=1800000000000,{store,data}=setup({now:()=>now});const h=3600000;
 await store.saveProofs({owner:'t2_self',username:'Example',proofs:[{fullname:'t1_visible',status:'visible',checkedAt:now-11*h,body:'secret'},{fullname:'t1_stale',status:'visible',checkedAt:now-13*h},{fullname:'t3_gone',status:'removed',checkedAt:now-23*h},{fullname:'t1_unknown',status:'unknown',checkedAt:now},{fullname:'bad id',status:'visible',checkedAt:now}]});
 const proofs=await store.readProofs('t2_self','Example');
 assert.deepEqual(Object.keys(proofs).sort(),['t1_visible','t3_gone'],'visible keeps 12 h, removed 24 h; unknown and invalid are never cached');
 assert.equal(JSON.stringify(data).includes('secret'),false,'no item text is stored');
 assert.deepEqual(Object.keys(await store.readProofs('t2_self','Other')),[],'bound to the account name too');
 await assert.rejects(store.readProofs('nope','Example'));
});
test('settled visible results last 7 days; items from the last week are rechecked after 12 hours',async()=>{
 const now=1800000000000,{store}=setup({now:()=>now});const h=3600000,d=24*h,old=Math.floor((now-30*d)/1000),recent=Math.floor((now-2*d)/1000);
 await store.saveProofs({owner:'t2_self',username:'Example',proofs:[{fullname:'t1_old',status:'visible',checkedAt:now-6*d,created:old},{fullname:'t1_older',status:'visible',checkedAt:now-8*d,created:old},{fullname:'t1_recent',status:'visible',checkedAt:now-13*h,created:recent},{fullname:'t3_oldremoved',status:'removed',checkedAt:now-6*d,created:old}]});
 assert.deepEqual(Object.keys(await store.readProofs('t2_self','Example')).sort(),['t1_old','t3_oldremoved']);
});
test('the saved Removed list keeps removed items only, per account, bounded, for 30 days',async()=>{
 let now=1800000000000;const {store,data}=setup({now:()=>now}),day=86400000;
 const item=(id,extra={})=>({fullname:'t3_'+id,kind:'post',id,created:1790000000,subreddit:'Alpha',permalink:'/r/Alpha/comments/'+id+'/title/',title:'Title '+id,body:'Body '+id,source:'reddit',removal:{state:'removed-mod',confidence:'verified',why:'Native evidence',flags:['gone','bogus']},...extra});
 await store.saveList({owner:'t2_self',username:'Example',items:[item('a1'),item('b2',{removal:{state:'visible',confidence:'verified',why:'',flags:[]}}),item('c3',{token:'SECRET',body:'x'.repeat(9000)}),{fullname:'bad'}]});
 const list=await store.readList('t2_self','Example');assert.deepEqual(list.items.map(i=>i.fullname),['t3_a1','t3_c3']);assert.deepEqual([...list.items[0].removal.flags],['gone']);assert.ok(list.items[1].body.length<=4000);
 assert.equal(JSON.stringify(data).includes('SECRET'),false);assert.equal((await store.readList('t2_self','Other')).items.length,0,'bound to the account name');
 now+=31*day;assert.equal((await store.readList('t2_self','Example')).items.length,0,'expires after 30 days');
});
