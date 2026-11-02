const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
function load({core,now=Date.now}={}){
 const clock={t:1700000000000},D=class extends Date{static now(){return clock.t;}};
 const context=vm.createContext({console,Date:D,setTimeout,clearTimeout,Promise,RCSCore:core});
 vm.runInContext(fs.readFileSync('extension/archive-query.js','utf8'),context);
 return {Q:context.RTArchiveQuery,clock};
}
const item=(id,created,extra={})=>({id,kind:'post',title:'t'+id,body:'',created,postType:'text',...extra});
// Fake background: pages of descending (or ascending) rows, 100 per page, from a fixed list.
function backend(rows,{timeoutText=false,sort='desc'}={}){
 const calls=[];
 const send=async message=>{
  calls.push(message);
  if(timeoutText && message.query)return {ok:false,code:'text-search-unavailable',error:'x'};
  const asc=message.sort==='asc';let list=rows.slice().sort((a,b)=>asc?a.created-b.created:b.created-a.created);
  if(message.before!=null)list=list.filter(r=>r.created<message.before);if(message.after!=null)list=list.filter(r=>r.created>message.after);
  const page=list.slice(0,10),hasMore=list.length>10,times=page.map(r=>r.created);
  return {ok:true,posts:page,hasMore,cursor:hasMore?(asc?Math.max(...times)-1:Math.min(...times)+1):null,cursorStalled:false,serverFiltered:Boolean(message.query)};
 };
 return {send,calls};
};
const collect=async gen=>{const pages=[];for await(const page of gen)pages.push(page);return pages;};
const rows=n=>Array.from({length:n},(_,i)=>item('r'+i,2000000000-i*10));

test('server search streams pages until the archive reports no more, with cursors passed on',async()=>{
 const {Q}=load(),b=backend(rows(25)),pages=await collect(Q.search({kind:'post',author:'example',text:'cats',send:b.send}));
 assert.equal(pages.length,3);assert.equal(pages[0].serverFiltered,true);assert.equal(pages[0].mode,'server');assert.equal(b.calls[0].query,'cats');
 assert.equal(b.calls[1].before,pages[0].cursor);assert.equal(pages[2].hasMore,false);assert.equal(pages[2].cursor,null);assert.equal(pages[2].searchedBackTo,2000000000-240);
 assert.equal(pages.reduce((n,p)=>n+p.items.length,0),25);
});
test('maxPages bounds one call, reports hasMore and a later call continues from the cursor',async()=>{
 const {Q}=load(),b=backend(rows(25)),first=await collect(Q.search({kind:'post',author:'example',text:'cats',maxPages:2,send:b.send})),last=first.at(-1);
 assert.equal(first.length,2);assert.equal(last.hasMore,true);assert.ok(last.cursor);assert.equal(last.searchedBackTo,2000000000-180);
 const rest=await collect(Q.search({kind:'post',author:'example',text:'cats',cursor:last.cursor,send:b.send}));
 assert.equal(rest.length,1);assert.equal(rest[0].hasMore,false);assert.ok(rest[0].items.length>=5);
});
test('asc searches advance the after cursor',async()=>{
 const {Q}=load(),b=backend(rows(15)),pages=await collect(Q.search({kind:'post',subreddit:'testsub',sort:'asc',after:1,before:3000000000,send:b.send}));
 assert.equal(b.calls[0].after,1);assert.equal(b.calls[0].before,3000000000);assert.equal(b.calls[1].after,pages[0].cursor);assert.equal(pages[0].serverFiltered,false);assert.equal(pages.length,2);assert.equal(pages[1].searchedBackTo,2000000000);
});
test('text-search-unavailable falls back to a local scan with the page budget and never claims completeness',async()=>{
 const all=rows(60).map((r,i)=>({...r,title:i%3===0?'Red Car':'other',body:'text '+i})),{Q}=load(),b=backend(all,{timeoutText:true});
 const pages=await collect(Q.search({kind:'post',author:'example',text:'red car',maxPages:3,send:b.send}));
 assert.equal(b.calls[0].query,'red car');assert.equal(b.calls[1].query,undefined);assert.equal(pages.length,3);
 assert.ok(pages.every(p=>p.mode==='local' && p.serverFiltered===false));assert.equal(pages.reduce((n,p)=>n+p.items.length,0),10);assert.ok(pages.every(p=>p.items.every(r=>r.title==='Red Car')));
 assert.equal(pages.at(-1).hasMore,true);assert.equal(pages.at(-1).searchedBackTo,2000000000-270);assert.equal(pages.at(-1).scanned,10);
});
test('WS1 helpers are used when present: toArchiveQuery for the server, matchesText for the scan',async()=>{
 const seen=[],core={toArchiveQuery:p=>'Q:'+p.text,matchesText:(p,h)=>{seen.push(h);return h.includes('keep');}};
 const {Q}=load({core}),all=[item('a',2000000000,{title:'keep',body:'x'}),item('b',1999999990,{title:'drop'}),item('c',1999999980,{kind:'comment',title:'ignored title',body:'keep'})],b=backend(all,{timeoutText:true});
 const pages=await collect(Q.search({kind:'post',parsed:{text:'zzz'},send:b.send}));
 assert.equal(b.calls[0].query,'Q:zzz');assert.deepEqual(pages[0].items.map(r=>r.id),['a','c']);assert.ok(seen.includes('ignored title keep')===false);assert.ok(seen.includes('keep'));
});
test('fallback without WS1 is a case-insensitive AND of words and quoted phrases',async()=>{
 const {Q}=load(),all=[item('a',3,{title:'Big RED Car',body:''}),item('b',2,{title:'red',body:'big car'}),item('c',1,{title:'red bus'})],b=backend(all,{timeoutText:true});
 assert.deepEqual((await collect(Q.search({kind:'post',text:'red car',author:'x',send:b.send})))[0].items.map(r=>r.id),['a','b']);
 assert.deepEqual((await collect(Q.search({kind:'post',text:'"red car"',author:'x',send:b.send})))[0].items.map(r=>r.id),['a']);
});
test('postTypes filter applies to posts locally and a stalled cursor ends the stream',async()=>{
 const {Q}=load(),all=[item('a',5,{postType:'image'}),item('b',4,{postType:'text'}),item('c',3,{postType:'video'})];
 const pages=await collect(Q.search({kind:'post',author:'x',postTypes:['image','video'],send:async()=>({ok:true,posts:all,hasMore:true,cursor:3,cursorStalled:true})}));
 assert.deepEqual(pages[0].items.map(r=>r.id),['a','c']);assert.equal(pages.length,1);assert.equal(pages[0].stalled,true);assert.equal(pages[0].hasMore,true);
 const comments=await collect(Q.search({kind:'comment',author:'x',postTypes:['image'],send:async()=>({ok:true,posts:[item('k',2,{kind:'comment'})],hasMore:false})}));assert.equal(comments[0].items.length,1);
});
test('errors carry the background code and retryAt; abort stops quietly',async()=>{
 const {Q}=load();
 await assert.rejects(collect(Q.search({kind:'post',author:'x',send:async()=>({ok:false,code:'rate-limited',error:'slow',retryAt:5})})),e=>e.code==='rate-limited' && e.retryAt===5);
 await assert.rejects(collect(Q.search({kind:'post',author:'x',text:'a',send:async()=>({ok:false,code:'maintenance'})})),e=>e.code==='maintenance');
 const controller=new AbortController();controller.abort();let calls=0;
 assert.deepEqual(await collect(Q.search({kind:'post',author:'x',signal:controller.signal,send:async()=>{calls++;return {ok:true,posts:[],hasMore:false};}})),[]);assert.equal(calls,0);
});
test('aggregate and subreddit return background data and are cached for 10 minutes, bounded to 50',async()=>{
 const {Q,clock}=load();let calls=0;const send=async message=>{calls++;return {ok:true,buckets:[{key:message.by,count:1}],subreddit:{name:message.name}};};
 await Q.aggregate({kind:'post',author:'x',by:'subreddit',send});await Q.aggregate({kind:'post',author:'x',by:'subreddit',send});assert.equal(calls,1);
 await Q.aggregate({kind:'post',author:'x',by:'month',send});assert.equal(calls,2);
 assert.equal((await Q.subreddit('testsub',send)).subreddit.name,'testsub');await Q.subreddit('testsub',send);assert.equal(calls,3);
 clock.t+=599000;await Q.subreddit('testsub',send);assert.equal(calls,3);
 clock.t+=2000;await Q.subreddit('testsub',send);assert.equal(calls,4);
 for(let i=0;i<60;i++)await Q.subreddit('sub'+i,send);calls=0;await Q.subreddit('sub59',send);assert.equal(calls,0);await Q.subreddit('sub0',send);assert.equal(calls,1);
 await assert.rejects(Q.aggregate({kind:'post',author:'x',by:'month',after:1,send:async()=>({ok:false,code:'timeout'})}),e=>e.code==='timeout');
});
test('RTArchiveQuery is frozen and failures are not cached',async()=>{
 const {Q}=load();assert.ok(Object.isFrozen(Q));let n=0;const send=async()=>(++n===1?{ok:false,code:'busy'}:{ok:true,subreddit:{name:'a'}});
 await assert.rejects(Q.subreddit('abc',send));assert.equal((await Q.subreddit('abc',send)).ok,true);
});

test('the local fallback uses the shared grammar: OR, exclusions and phrases, with the archive query serialized',async()=>{
 const ctx=vm.createContext({console,Date,setTimeout,clearTimeout,Promise,Intl,TextEncoder});vm.runInContext(fs.readFileSync('extension/search-core.js','utf8'),ctx);
 const {Q}=load({core:ctx.RCSCore}),parsed=ctx.RCSCore.parseQuery('tea OR coffee -decaf "morning cup"');
 const list=[item('a',2000000000,{title:'Morning cup of tea'}),item('b',1999999990,{title:'morning cup of decaf coffee'}),item('c',1999999980,{title:'coffee only'}),item('d',1999999970,{title:'A morning cup of coffee'})];
 const b=backend(list,{timeoutText:true}),pages=await collect(Q.search({kind:'post',author:'example',parsed,send:b.send}));
 assert.equal(b.calls[0].query,'tea -decaf "morning cup" OR coffee -decaf "morning cup"','OR binds first, so the archive gets an expanded query');
 assert.deepEqual(pages.flatMap(p=>p.items.map(i=>i.id)),['a','d']);assert.ok(pages.every(p=>p.mode==='local'));
});
