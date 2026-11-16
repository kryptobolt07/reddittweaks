const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const code=()=>fs.readFileSync('extension/archive-memo.js','utf8');
function setup({data={},time=1000,limit=512,maxBytes=2097152}={}){let now=time;const storage={async get(k){return {[k]:structuredClone(data[k])};},async set(v){Object.assign(data,structuredClone(v));},async remove(k){delete data[k];}};const c=vm.createContext({});vm.runInContext(code(),c);const create=()=>c.RTArchiveMemo.create({storage,now:()=>now,limit,maxBytes});return {memo:create(),create,data,tick:n=>now+=n};}
test('archive session memo survives worker recreation, expires entries, and isolates account keys',async()=>{
 const s=setup(),a='t2_self:example:comment:a',b='t2_other:other:comment:a';await s.memo.put([{key:a,value:{posts:[]},ttl:100},{key:b,value:{posts:[{id:'a'}]},ttl:200}]);
 const hit=await s.create().get([a]);assert.equal(hit[a].posts.length,0);assert.equal(hit[b],undefined);hit[a].posts.push({body:'mutation'});assert.equal((await s.memo.get([a]))[a].posts.length,0);
 s.tick(101);assert.equal((await s.create().get([a]))[a],undefined);assert.equal((await s.memo.get([b]))[b].posts.length,1);
});
test('archive session memo bounds entries and bytes, ignores malformed records, and serializes writes',async()=>{
 const s=setup({limit:2,maxBytes:1200});await Promise.all(['a','b','c'].map(id=>s.memo.put([{key:'t2_self:example:post:'+id,value:{id},ttl:100}])));const all=await s.create().get(['a','b','c'].map(id=>'t2_self:example:post:'+id));assert.equal(Object.keys(all).length,2);
 await s.memo.put([{key:'t2_self:example:post:large',value:{body:'x'.repeat(1000)},ttl:100}]);assert.equal((await s.memo.get(['t2_self:example:post:large']))['t2_self:example:post:large'],undefined);await s.memo.clear();assert.equal(Object.keys(await s.create().get(['t2_self:example:post:c'])).length,0);
});


test('cache clear invalidates queued writes from an older preference generation',async()=>{
 const s=setup();await s.memo.clear();await s.memo.put([{key:'t2_self:example:post:a',value:{body:'stale'},ttl:100}],0);assert.equal((await s.memo.get(['t2_self:example:post:a']))['t2_self:example:post:a'],undefined);
});


test('malformed session records are ignored instead of breaking cached requests',async()=>{
 const key='t2_self:example:post:a',data={'rt-own-archive-session-v1':{[key]:{expires:1100,touched:900},'t2_self:example:post:b':{value:{posts:[]},expires:1100,touched:900}}},s=setup({data});assert.equal((await s.memo.get([key]))[key],undefined);
});
