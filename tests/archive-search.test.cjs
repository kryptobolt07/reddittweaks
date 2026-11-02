const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
// Synthetic rows only. Shapes follow Arctic Shift responses observed on 2026-10-31.
const post=(extra={})=>({id:'abc12',author:'Example',subreddit:'Testsub',created_utc:1700000000,title:'Hello',selftext:'Body',is_self:true,...extra});
const comment=(extra={})=>({id:'c1',author:'Example',subreddit:'Testsub',link_id:'t3_abc12',parent_id:'t3_abc12',created_utc:1700000000,body:'Hi',...extra});
function env({fetcher,settings={postDiscovery:true,archiveDiscovery:true},fastTimeout=false}={}){
 let listener,stored=settings,calls=[];
 const context=vm.createContext({URL,AbortController,Date,console,setTimeout:fastTimeout?fn=>setTimeout(fn,5):setTimeout,clearTimeout,
  chrome:{runtime:{id:'own',onMessage:{addListener(fn){listener=fn;}}},storage:{onChanged:{addListener(){}},local:{async get(){return {'rt-settings-v1':stored};}}},tabs:{}},
  fetch:async(...args)=>{calls.push(args);return fetcher?fetcher(...args):response([post()]);}});
 for(const file of ['post-model.js','post-broker.js'])vm.runInContext(fs.readFileSync('extension/'+file,'utf8'),context);
 return {calls,setSettings(value){stored=value;},send(message,sender={}){return new Promise(resolve=>{const result=listener({scope:'rt-posts',...message},{id:'own',frameId:0,tab:{id:1},url:'https://www.reddit.com/r/anything/',...sender},resolve);if(result!==true)resolve(undefined);});}};
}
function response(data,status=200,headers={},error){return {ok:status>=200&&status<300,status,headers:{get:key=>headers[key]??null},async text(){return JSON.stringify(error?{data:null,error}:{data});}};}
const search=(message={})=>({action:'archive-search',kind:'post',author:'Example',...message});
const plain=value=>JSON.parse(JSON.stringify(value));
const params=call=>Object.fromEntries(new URL(call[0]).searchParams);

test('archive-search sends posts query / comments body and reports serverFiltered',async()=>{
 const e=env({fetcher:async()=>response([post()])});
 const r=await e.send(search({query:'"red car" OR bike',subreddit:'TestSub'}));
 assert.equal(r.ok,true);assert.equal(r.serverFiltered,true);assert.equal(r.posts[0].postType,'text');
 const p=params(e.calls[0]);assert.equal(new URL(e.calls[0][0]).pathname,'/api/posts/search');assert.equal(p.query,'"red car" OR bike');assert.equal(p.author,'example');assert.equal(p.subreddit,'testsub');assert.equal(p.sort,'desc');assert.equal(p.limit,'100');assert.equal(e.calls[0][1].credentials,'omit');
 const c=env({fetcher:async()=>response([comment()])}),cr=await c.send(search({kind:'comment',query:'hi'}));
 assert.equal(cr.ok,true);assert.equal(cr.posts[0].kind,'comment');assert.equal(cr.posts[0].postType,undefined);assert.equal(params(c.calls[0]).body,'hi');assert.equal(params(c.calls[0]).query,undefined);
 const plain=await env().send(search());assert.equal(plain.serverFiltered,false);
});
test('desc cursor is oldest+1 and asc cursor is newest-1 with stall detection',async()=>{
 const page=(start,step)=>Array.from({length:100},(_,i)=>post({id:(1000+i).toString(36),created_utc:start+step*i}));
 const desc=env({fetcher:async()=>response(page(1700000000,-1))}),d=await desc.send(search());
 assert.equal(d.hasMore,true);assert.equal(d.cursor,1699999901+1-0);assert.equal(d.cursorStalled,false);
 const d2=await desc.send(search({before:d.cursor}));assert.equal(params(desc.calls[1]).before,String(d.cursor));
 const asc=env({fetcher:async()=>response(page(1700000000,1))}),a=await asc.send(search({sort:'asc'}));
 assert.equal(params(asc.calls[0]).sort,'asc');assert.equal(a.cursor,1700000099-1);assert.equal(a.cursorStalled,false);
 await asc.send(search({sort:'asc',after:a.cursor}));assert.equal(params(asc.calls[1]).after,String(a.cursor));
 // A full page entirely inside one second cannot advance: the stall is reported, never complete.
 const same=env({fetcher:async()=>response(Array.from({length:100},(_,i)=>post({id:(1000+i).toString(36),created_utc:1700000000})))});
 const s=await same.send(search({before:1700000001}));assert.equal(s.cursorStalled,true);assert.equal(s.hasMore,true);assert.equal(s.incomplete,true);
 const sa=await same.send(search({sort:'asc',after:1699999999}));assert.equal(sa.cursorStalled,true);
 // A short page ends the listing, but is still never labelled complete.
 const short=await env().send(search());assert.equal(short.hasMore,false);assert.equal(short.cursor,null);assert.equal(short.incomplete,true);
 assert.ok(d2.ok);
});
test('archive-search drops rows outside the requested scope and bounds',async()=>{
 const e=env({fetcher:async()=>response([post(),post({id:'x1',author:'other'}),post({id:'x2',subreddit:'elsewhere'}),post({id:'x3',created_utc:1600000000})])});
 const r=await e.send(search({subreddit:'testsub',after:1650000000}));assert.deepEqual(plain(r.posts.map(p=>p.id)),['abc12']);
});
test('429 with reset and 503 maintenance share the cooldown across all actions',async()=>{
 const limited=env({fetcher:async()=>response([],429,{'X-RateLimit-Reset':'120'})});
 const r=await limited.send(search());assert.equal(r.code,'rate-limited');assert.ok(r.retryAt>Date.now()+100000);
 assert.equal((await limited.send({action:'archive-subreddit',name:'testsub'})).code,'rate-limited');
 assert.equal((await limited.send({action:'archive-aggregate',kind:'post',author:'Example',by:'subreddit'})).code,'rate-limited');assert.equal(limited.calls.length,1);
 const down=env({fetcher:async()=>({ok:false,status:503,headers:{get:()=>null},async text(){return '{"error":"Under maintenance"}';}})});
 const m=await down.send(search());assert.equal(m.code,'maintenance');assert.equal((await down.send(search({before:1700000100}))).code,'maintenance');assert.equal(down.calls.length,1);
});
test('timeouts: plain search is a timeout, text search is text-search-unavailable',async()=>{
 const timeout=env({fetcher:()=>new Promise(()=>{}),fastTimeout:true});
 assert.equal((await timeout.send(search())).code,'timeout');assert.equal((await timeout.send(search({query:'word'}))).code,'text-search-unavailable');
 const slow=env({fetcher:async()=>response(null,422,{},'Timeout. Maybe slow down a bit')});
 assert.equal((await slow.send(search({query:'word'}))).code,'text-search-unavailable');assert.equal((await slow.send(search({before:1700000100}))).code,'timeout');
 const broken=env({fetcher:async()=>response(null,500)});assert.equal((await broken.send(search({query:'word'}))).code,'http-error');
});
test('archive-aggregate normalizes string counts, month keys and drops empty buckets',async()=>{
 const subs=env({fetcher:async()=>response([{key:'alpha',count:'3'},{key:'beta',count:'40'},{key:'zero',count:'0'}])});
 const r=await subs.send({action:'archive-aggregate',kind:'comment',author:'Example',by:'subreddit'});
 assert.deepEqual(plain(r.buckets),[{key:'beta',count:40},{key:'alpha',count:3}]);
 const p=params(subs.calls[0]);assert.equal(new URL(subs.calls[0][0]).pathname,'/api/comments/search/aggregate');assert.equal(p.aggregate,'subreddit');assert.equal(p.author,'example');
 const months=env({fetcher:async()=>response([{created_utc:'2023-01-31T23:00:00.000Z',count:'5'},{created_utc:'2022-12-31T23:00:00.000Z',count:'2'},{created_utc:'2023-02-28T23:00:00.000Z',count:'0'}])});
 const m=await months.send({action:'archive-aggregate',kind:'post',subreddit:'Testsub',by:'month'});
 assert.deepEqual(plain(m.buckets),[{key:'2023-01',count:2},{key:'2023-02',count:5}]);
 const q=params(months.calls[0]);assert.equal(q.aggregate,'created_utc');assert.equal(q.frequency,'month');assert.ok(Number(q.after)>0);
 const slow=env({fetcher:async()=>response(null,422,{},'Timeout. Maybe slow down a bit')});
 const t=await slow.send({action:'archive-aggregate',kind:'post',author:'Example',by:'subreddit'});assert.equal(t.ok,false);assert.equal(t.code,'timeout');
});
test('archive-subreddit normalizes metadata and accepts only Reddit-hosted https icons',async()=>{
 const raw=(extra={})=>({display_name:'Testsub',title:'Test Sub',public_description:'A synthetic place',description:'Long text',subscribers:1234,created_utc:1245256101,over18:true,community_icon:'https://styles.redditmedia.com/t5_x/icon.png?w=256&amp;s=abc',icon_img:'',...extra});
 const e=env({fetcher:async()=>response([raw()])}),r=await e.send({action:'archive-subreddit',name:'TestSub'});
 assert.deepEqual(plain(r.subreddit),{name:'Testsub',title:'Test Sub',description:'A synthetic place',subscribers:1234,created:1245256101,over18:true,icon:'https://styles.redditmedia.com/t5_x/icon.png?w=256&s=abc'});
 assert.equal(params(e.calls[0]).subreddit,'testsub');
 for(const icon of ['http://styles.redditmedia.com/a.png','https://evil.test/a.png','https://redditmedia.com.evil.test/a.png','javascript:alert(1)'])assert.equal('icon' in (await env({fetcher:async()=>response([raw({community_icon:icon})])}).send({action:'archive-subreddit',name:'testsub'})).subreddit,false);
 const none=await env({fetcher:async()=>response([])}).send({action:'archive-subreddit',name:'ghostsub'});assert.equal(none.ok,false);assert.equal(none.code,'not-found');
});
test('invalid inputs, unauthorized senders and disabled setting are rejected before any request',async()=>{
 const e=env();
 for(const m of [search({author:undefined}),search({author:'bad name'}),search({subreddit:'a'}),search({subreddit:'x'.repeat(22)}),search({kind:'user'}),search({sort:'new'}),search({query:'x'.repeat(257)}),search({query:5}),search({after:'1'}),search({before:-1}),search({after:Infinity}),
  {action:'archive-aggregate',kind:'post',author:'Example',by:'week'},{action:'archive-aggregate',kind:'post',by:'month'},{action:'archive-subreddit',name:'a b'},{action:'archive-subreddit'}])assert.equal((await e.send(m)).code,'invalid-request',JSON.stringify(m));
 for(const sender of [{id:'foreign'},{frameId:1},{tab:undefined},{url:'https://evil.test/'},{url:'http://www.reddit.com/'},{url:'https://www.reddit.com.evil.test/'},{origin:'https://evil.test'}])for(const m of [search(),{action:'archive-aggregate',kind:'post',author:'Example',by:'month'},{action:'archive-subreddit',name:'testsub'}])assert.equal((await e.send(m,sender)).code,'forbidden');
 assert.equal(e.calls.length,0);
 const off=env({settings:{postDiscovery:true,archiveDiscovery:false}});assert.equal((await off.send(search())).code,'disabled');assert.equal(off.calls.length,0);
 assert.equal((await env().send(search(),{url:'https://reddit.com/user/x/'})).ok,true);
});
test('postType is derived from raw fields and survives re-normalization',()=>{
 const Model=(()=>{const ctx=vm.createContext({URL});vm.runInContext(fs.readFileSync('extension/post-model.js','utf8'),ctx);return ctx.RTPostModel;})();
 const type=extra=>Model.normalizePost({id:'a1',author:'Example',created_utc:1700000000,...extra},{source:'arctic-shift'}).postType;
 assert.equal(type({is_self:true}),'text');assert.equal(type({crosspost_parent:'t3_zzz',is_self:false}),'crosspost');assert.equal(type({is_gallery:true}),'gallery');assert.equal(type({gallery_data:{items:[]}}),'gallery');
 assert.equal(type({is_video:true}),'video');assert.equal(type({post_hint:'hosted:video'}),'video');assert.equal(type({post_hint:'rich:video'}),'embed');
 assert.equal(type({post_hint:'image'}),'image');assert.equal(type({url:'https://i.redd.it/abc.jpg'}),'image');assert.equal(type({url:'https://i.imgur.com/abc.png'}),'image');
 assert.equal(type({url:'https://example.com/article'}),'link');assert.equal(type({}),'link');assert.equal(type({is_self:false,url:'https://i.redd.it/x/'}),'link');
 assert.equal(Model.normalizePost(Model.normalizePost({id:'a1',author:'Example',created_utc:1700000000,is_video:true},{source:'arctic-shift'}),{source:'arctic-shift'}).postType,'video');
});

test('documented search parameters are whitelisted, guarded and included in broker cache keys',async()=>{
 const e=env(),first={title:'launch',selftext:'quiet',link_flair_text:'news',over_18:false,spoiler:true,url:'https://example.test/',url_exact:false};
 const r=await e.send(search(first));assert.equal(r.ok,true);assert.equal(r.serverFiltered,true);
 const p=params(e.calls[0]);for(const [key,value]of Object.entries(first))assert.equal(p[key],String(value),key);
 await e.send(search({...first}));assert.equal(e.calls.length,1);
 for(const [key,value]of Object.entries({title:'other',selftext:'different',link_flair_text:'events',over_18:true,spoiler:false,url:'https://other.test/',url_exact:true}))await e.send(search({...first,[key]:value}));
 assert.equal(e.calls.length,8);
 const c=env({fetcher:async()=>response([comment()])});assert.equal((await c.send(search({kind:'comment',body:'quiet'}))).ok,true);assert.equal(params(c.calls[0]).body,'quiet');
 const guard=env();for(const key of ['title','selftext','link_flair_text','url','body'])for(const value of ['x'.repeat(257),'bad\ntext','bad\x7ftext',4]){
  assert.equal((await guard.send(search({kind:key==='body'?'comment':'post',[key]:value}))).code,'invalid-request',key);
 }
 for(const m of [{kind:'comment',title:'x'},{kind:'post',body:'x'},{over_18:'yes'},{spoiler:1},{url_exact:'true'},{kind:'comment',query:'x',body:'y'}])assert.equal((await guard.send(search(m))).code,'invalid-request');
 await guard.send(search({title:'valid',site:'ignored.test',fields:'private',md2html:false}));const sent=params(guard.calls[0]);assert.equal(sent.site,undefined);assert.equal(sent.fields,undefined);assert.equal(sent.md2html,'true');
});
test('field keyword timeouts retain the local-scan fallback signal',async()=>{
 const e=env({fetcher:async()=>response(null,422,{},'Query timed out')});
 for(const input of [{title:'launch'},{selftext:'quiet'},{link_flair_text:'news'},{kind:'comment',body:'quiet'}])assert.equal((await e.send(search(input))).code,'text-search-unavailable');
});
