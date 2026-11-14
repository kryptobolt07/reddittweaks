// Bulk redaction (docs/redaction-spec.md). Synthetic only: nothing here talks to Reddit.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
const read=file=>fs.readFileSync('extension/'+file,'utf8');
const flush=async()=>{for(let i=0;i<20;i++)await new Promise(r=>setImmediate(r));};
const plain=v=>JSON.parse(JSON.stringify(v));
function model(){const context=vm.createContext({Date,Math,Number,String,Array,Set,Map,Object,JSON,Error});vm.runInContext(read('redaction-model.js'),context);return context.RTRedactionModel;}
const NOW=1700000000,DAY=86400;
const item=(id,extra={})=>({fullname:(extra.kind==='post'?'t3_':'t1_')+id,kind:'comment',subreddit:'Alpha',created:NOW-100*DAY,score:1,title:'',body:'text '+id,permalink:'/r/Alpha/comments/p/x/'+id+'/',...extra});

test('filters select exactly the stated items, oldest first, and count every skip',()=>{
 const X=model();
 const items=[item('a'),item('b',{created:NOW-5*DAY}),item('c',{subreddit:'Keep'}),item('d',{score:500}),item('e',{body:'secret code'}),item('p1',{kind:'post',isSelf:true,title:'Hello',body:'post body',created:NOW-200*DAY}),item('f',{body:'[deleted]',deleted:true}),item('g'),item('h',{subreddit:'Other'})];
 const sel=X.select(items,{olderThanDays:30,neverIn:'r/Keep',keepScoreAtLeast:100,keepContaining:'secret',keep:'https://www.reddit.com/r/Alpha/comments/p/x/g/'},{now:NOW});
 assert.deepEqual(plain(sel.matches.map(i=>i.fullname)),['t3_p1','t1_a','t1_h']);assert.equal(sel.posts,1);assert.equal(sel.comments,2);assert.equal(sel.found,9);
 assert.deepEqual(plain(sel.skipped),{'too-new':1,community:1,score:1,'kept-text':1,'already-deleted':1,kept:1});
 assert.deepEqual(plain(X.select(items,{kinds:'posts'},{now:NOW}).matches.map(i=>i.fullname)),['t3_p1']);
 assert.deepEqual(plain(X.select(items,{onlyIn:'alpha',onlyContaining:'text a',kinds:'comments'},{now:NOW}).matches.map(i=>i.fullname)),['t1_a']);
 const ranged=X.select(items,{from:'2023-06-01',to:'2023-08-06'},{now:NOW});assert.deepEqual(plain(ranged.matches.map(i=>i.fullname)),['t1_a','t1_c','t1_d','t1_e','t1_g','t1_h']);
});
test('keep list accepts fullnames, bare IDs and post or comment links',()=>{
 const X=model();assert.deepEqual(plain([...X.keepIds('t1_ABC https://www.reddit.com/r/x/comments/p1/title/ https://reddit.com/r/x/comments/p1/title/c9/ zz')].sort()),['t1_abc','t1_c9','t1_zz','t3_p1','t3_zz']);
});
test('confirmation phrase and overwritable items',()=>{
 const X=model();assert.equal(X.confirmation(3),'delete 3');assert.equal(X.confirmed(' Delete 3 ',3),true);assert.equal(X.confirmed('delete 2',3),false);assert.equal(X.confirmed('',0),false);
 assert.equal(X.overwritable(item('a')),true);assert.equal(X.overwritable(item('p',{kind:'post',isSelf:false,body:''})),false);assert.equal(X.overwritable(item('p',{kind:'post',isSelf:true,body:'  '})),false);assert.equal(X.overwritable(item('p',{kind:'post',isSelf:true,body:'x'})),true);
});
function clock(){let t=0;const sleeps=[];return {now:()=>t,sleep:async ms=>{sleeps.push(ms);t+=ms;},sleeps};}
test('run overwrites then deletes at most one write per 1.1 s, honours 429 and reports partial results',async()=>{
 const X=model(),c=clock(),calls=[];let limited=false;
 const write=async(it,step,text)=>{calls.push(it.fullname+':'+step+':'+(step==='overwrite'?text:''));
  if(it.fullname==='t1_b' && step==='delete' && !limited){limited=true;return {ok:false,rateLimited:true,retryAfterMs:30000};}
  if(it.fullname==='t1_c' && step==='delete')return {ok:false,error:'HTTP 403'};
  if(it.fullname==='t1_d' && step==='overwrite')return {ok:false,error:'HTTP 500'};
  return {ok:true};};
 const items=[item('a'),item('b'),item('c'),item('d'),item('l',{kind:'post',isSelf:false,body:''})];
 const r=await X.run(items,X.normalizeRules({text:'gone'}),{write,sleep:c.sleep,now:c.now});
 assert.deepEqual(calls,['t1_a:overwrite:gone','t1_a:delete:','t1_b:overwrite:gone','t1_b:delete:','t1_b:delete:','t1_c:overwrite:gone','t1_c:delete:','t1_d:overwrite:gone','t3_l:delete:']);
 assert.deepEqual(plain(r.done.map(i=>i.fullname)),['t1_a','t1_b','t3_l']);assert.deepEqual(plain(r.overwrittenOnly.map(e=>e.item.fullname)),['t1_c']);assert.deepEqual(plain(r.failed.map(e=>[e.item.fullname,e.error])),[['t1_d','HTTP 500']]);
 assert.ok(c.sleeps.includes(30000),'waited for Retry-After');assert.ok(c.sleeps.filter(ms=>ms!==30000).every(ms=>ms<=1100));
 assert.ok(c.now()>=8*1100,'nine writes, paced');
});
test('three failures in a row stop the run; Stop ends it after the current request',async()=>{
 const X=model(),c=clock();const items=['a','b','c','d','e'].map(id=>item(id,{kind:'post',isSelf:false,body:''}));
 const r=await X.run(items,X.normalizeRules({}),{write:async()=>{throw Error('network down');},sleep:c.sleep,now:c.now});
 assert.equal(r.failed.length,3);assert.equal(r.remaining,2);assert.match(r.stopped,/3 failures in a row/);
 const controller=new AbortController();let writes=0;
 const s=await X.run(items,X.normalizeRules({}),{write:async()=>{writes++;if(writes===2)controller.abort();return {ok:true};},sleep:async()=>{},now:()=>0,signal:controller.signal});
 assert.equal(s.done.length,2,'the in-flight write completes and counts');assert.equal(s.stopped,'Stopped.');assert.equal(s.remaining,3);
});

// --- Bridge
function bridge(t,{fetcher}={}){
 const dom=new JSDOM('<body></body>',{url:'https://www.reddit.com/',runScripts:'outside-only'}),W=dom.window,calls=[];t.after(()=>W.close());W.AbortController=AbortController;
 W.fetch=async(href,options)=>{const u=new URL(href);calls.push({url:u,options});const v=fetcher(u,options);return {ok:(v.status ?? 200)===200,status:v.status ?? 200,headers:new Headers(v.headers || {}),text:async()=>JSON.stringify(v.body ?? {})};};
 for(const file of ['post-model.js','post-page-bridge.js'])W.eval(read(file));
 const send=input=>new Promise(resolve=>{const id=crypto.randomUUID(),listener=event=>{const result=JSON.parse(event.detail);if(result.id!==id)return;W.document.removeEventListener('rt-post-response',listener);resolve(result);};W.document.addEventListener('rt-post-response',listener);W.document.dispatchEvent(new W.CustomEvent('rt-post-request',{detail:JSON.stringify({channel:'redact-test',id,...input})}));});
 return {calls,send};
}
const listing=children=>({body:{kind:'Listing',data:{after:null,children}}});
const meBody={body:{data:{name:'Example',modhash:'abcdef1234567890'}}};
test('bridge never reveals the modhash and writes only to items it read from your own lists',async t=>{
 const b=bridge(t,{fetcher:u=>u.pathname==='/api/me.json'?meBody:u.pathname.endsWith('.json')?listing([{kind:'t1',data:{id:'own1',author:'Example',body:'mine',subreddit:'Alpha',created_utc:NOW,score:2,permalink:'/r/Alpha/comments/p/x/own1/'}},{kind:'t1',data:{id:'other',author:'Someone',body:'theirs'}}]):{body:{json:{errors:[]}}}});
 assert.equal((await b.send({action:'redact-item',fullname:'t1_own1',step:'delete',username:'Example'})).ok,false,'nothing is writable before reading');
 const me=await b.send({action:'redact-identity'});assert.equal(me.username,'Example');assert.equal(me.canWrite,true);assert.equal(JSON.stringify(me).includes('abcdef1234567890'),false);
 const list=await b.send({action:'redact-list',username:'Example',source:'comments',sort:'top'});assert.deepEqual(list.items.map(i=>i.fullname),['t1_own1']);
 assert.equal(b.calls[1].url.pathname,'/user/Example/comments.json');assert.equal(b.calls[1].url.searchParams.get('t'),'all');
 const before=b.calls.length;
 for(const input of [{fullname:'t1_other',step:'delete'},{fullname:'t1_unread',step:'delete'},{fullname:'t1_own1',step:'wipe'},{fullname:'t1_own1',step:'delete',username:'Someone'},{fullname:'t1_own1',step:'overwrite',text:''},{fullname:'t1_own1',step:'delete',url:'https://evil.test'}]){const r=await b.send({action:'redact-item',username:'Example',...input});assert.equal(r.ok,false,JSON.stringify(input));}
 assert.equal(b.calls.length,before,'refused before any request');
 const edit=await b.send({action:'redact-item',fullname:'t1_own1',step:'overwrite',text:'gone',username:'Example'});assert.equal(edit.written,true);
 const call=b.calls.at(-1);assert.equal(call.url.pathname,'/api/editusertext');assert.equal(call.options.method,'POST');assert.equal(call.options.headers['X-Modhash'],'abcdef1234567890');assert.equal(String(call.options.body),'thing_id=t1_own1&text=gone&api_type=json');assert.equal(call.url.origin,'https://www.reddit.com');
 const del=await b.send({action:'redact-item',fullname:'t1_own1',step:'delete',username:'Example'});assert.equal(del.written,true);assert.equal(b.calls.at(-1).url.pathname,'/api/del');assert.equal(String(b.calls.at(-1).options.body),'id=t1_own1');
 assert.equal((await b.send({action:'redact-item',fullname:'t1_own1',step:'delete',username:'Example'})).ok,false,'a deleted item is no longer writable');
});
test('bridge reports Reddit’s refusals and rate limits without claiming success',async t=>{
 let mode='errors';
 const b=bridge(t,{fetcher:u=>u.pathname==='/api/me.json'?meBody:u.pathname.endsWith('.json')?listing([{kind:'t3',data:{id:'p1',author:'Example',selftext:'x',is_self:true,title:'T',subreddit:'Alpha',created_utc:NOW}}]):mode==='errors'?{body:{json:{errors:[['DELETED_COMMENT','that comment has been deleted','thing_id']]}}}:mode==='429'?{status:429,headers:{'retry-after':'42'}}:{status:403}});
 await b.send({action:'redact-identity'});await b.send({action:'redact-list',username:'Example',source:'overview',sort:'new'});
 const e=await b.send({action:'redact-item',fullname:'t3_p1',step:'overwrite',text:'x',username:'Example'});assert.equal(e.written,false);assert.match(e.reason,/that comment has been deleted/);
 mode='429';const r=await b.send({action:'redact-item',fullname:'t3_p1',step:'delete',username:'Example'});assert.equal(r.rateLimited,true);assert.equal(r.retryAfterMs,42000);
 mode='403';const f=await b.send({action:'redact-item',fullname:'t3_p1',step:'delete',username:'Example'});assert.equal(f.written,false);assert.match(f.reason,/HTTP 403/);
 assert.equal((await b.send({action:'redact-list',username:'Example',source:'saved',sort:'new'})).ok,false);
});

// --- Dialog
async function dialog(t,{items,writes=()=>({written:true}),list}={}){
 const dom=new JSDOM('<main></main>',{url:'https://www.reddit.com/#rt-redact',runScripts:'outside-only',pretendToBeVisual:true}),W=dom.window,calls=[];let r;
 t.after(()=>{r?.destroy();W.close();});
 W.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};W.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
 W.eval(read('date-picker.js'));W.eval(read('redaction-model.js'));W.eval(read('redaction-ui.js'));
 const readFn=async args=>{calls.push(args);
  if(args.action==='redact-identity')return {username:'Example',canWrite:true};
  if(args.action==='redact-list')return list?list(args):{items:args.source==='overview'?items:[],hasMore:false,after:null};
  if(args.action==='redact-item')return writes(args);throw Error('unexpected');};
 r=new W.RTRedaction.Redaction({read:readFn,sleep:async()=>{}});await flush();
 const D=W.document,q=s=>D.querySelector(s);
 return {W,D,r,calls,q,primary:()=>q('[data-rt-redact] [slot="primary-button"]'),status:()=>q('.rt-raffle-status').textContent,type:(name,value)=>{const el=q('[name="'+name+'"]');el.value=value;el.dispatchEvent(new W.Event('input',{bubbles:true}));}};
}
const fresh=[item('a',{created:NOW-400*DAY}),item('b',{created:NOW-300*DAY}),item('p',{kind:'post',isSelf:false,body:'',title:'Link post',created:NOW-200*DAY})];
test('the #rt-redact fragment opens the dialog once and leaves the address',async t=>{
 const s=await dialog(t,{items:fresh});assert.ok(s.q('[data-rt-redact="dialog"]').hasAttribute('open'));assert.equal(s.W.location.hash,'');
 s.r.checkFragment();assert.equal(s.D.querySelectorAll('[data-rt-redact="dialog"]').length,1);assert.equal(s.calls.length,0,'nothing is read until you ask');
});
test('find is a dry run; the run needs the typed phrase and uses exactly the previewed set',async t=>{
 const s=await dialog(t,{items:fresh});
 s.primary().click();await flush();
 assert.deepEqual(s.calls.map(c=>c.action+(c.source?':'+c.source+':'+c.sort:'')),['redact-identity','redact-list:overview:new','redact-list:submitted:top','redact-list:submitted:controversial','redact-list:comments:top','redact-list:comments:controversial']);
 assert.equal(s.calls.some(c=>c.action==='redact-item'),false,'finding never writes');
 assert.match(s.status(),/^3 items match \(1 post, 2 comments\) out of 3 found/);assert.equal(s.primary().textContent,'Review 3 selected items');assert.equal(s.primary().disabled,false);
 s.primary().click();assert.equal(s.primary().textContent,'Overwrite and delete 3 items');assert.equal(s.primary().disabled,true);
 assert.equal(s.D.querySelectorAll('.rt-redact-preview .rt-redact-row').length,3);assert.match(s.q('.rt-redact-preview').textContent,/delete only/);
 s.type('confirm','delete 2');assert.equal(s.primary().disabled,true);s.type('confirm','delete 3');assert.equal(s.primary().disabled,false);
 s.primary().click();await flush();
 assert.deepEqual(s.calls.filter(c=>c.action==='redact-item').map(c=>c.fullname+':'+c.step),['t1_a:overwrite','t1_a:delete','t1_b:overwrite','t1_b:delete','t3_p:delete']);
 assert.equal(s.calls.find(c=>c.step==='overwrite').text,'This comment has been redacted or anonymized by Reddit Tweaks.');
 assert.match(s.status(),/^Deleted 3 of 3\. 0 failed\.$/);
});
test('changing a rule after the preview clears it, so a run can’t use stale matches',async t=>{
 const s=await dialog(t,{items:fresh});s.primary().click();await flush();s.primary().click();s.type('confirm','delete 3');
 s.type('from','2023-01-01');assert.equal(s.primary().textContent,'Find matching items');assert.equal(s.q('.rt-redact-confirm').hidden,true);
 s.primary().click();await flush();assert.match(s.status(),/^2 items match/);
});
test('failures are listed with Reddit’s reason; closing during a run asks first',async t=>{
 let release;const gate=new Promise(r=>release=r);
 const s=await dialog(t,{items:fresh,writes:async args=>{if(args.fullname==='t1_a'){await gate;return args.step==='delete'?{written:false,reason:'Reddit refused the delete (HTTP 403).'}:{written:true};}return {written:true};}});
 s.primary().click();await flush();s.primary().click();s.type('confirm','delete 3');s.primary().click();await flush();
 s.q('[data-rt-redact] [slot="close-button"]').click();assert.ok(s.q('[data-rt-redact="dialog"]'),'first close only asks');assert.match(s.status(),/Close again to stop/);
 release();await flush();
 assert.match(s.status(),/^Deleted 2 of 3\. 1 failed\./);assert.match(s.q('.rt-redact-results').textContent,/Text overwritten, delete failed.*HTTP 403/s);
});

test('review exposes every match and confirmation writes only the selected set',async t=>{
 const items=Array.from({length:53},(_,i)=>item('a'+i));const s=await dialog(t,{items});s.primary().click();await flush();
 assert.equal(s.r.state.form.hidden,true);assert.equal(s.r.state.confirmation.hidden,true);
 assert.equal(s.q('.rt-redact-preview').querySelectorAll('input[type=checkbox]').length,50);
 s.r.state.more.click();assert.equal(s.q('.rt-redact-preview').querySelectorAll('input[type=checkbox]').length,53);assert.equal(s.r.state.more.hidden,true);
 s.r.state.selectAll.click();assert.equal(s.primary().disabled,true);
 const box=s.q('input[value="t1_a52"]');box.click();assert.equal(s.r.state.selection.matches.length,1);s.primary().click();
 assert.equal(s.r.state.preview.hidden,true);assert.equal(s.r.state.confirmation.hidden,false);assert.match(s.r.state.confirmation.textContent,/u\/Example · 0 posts and 1 comments selected/);
 s.type('confirm','delete 1');s.r.state.cancel.click();assert.equal(s.r.state.phase,'previewed');assert.equal(s.r.state.selected.has('t1_a52'),true);assert.equal(s.r.state.confirm.value,'');
 s.primary().click();assert.equal(s.primary().disabled,true);s.type('confirm','delete 1');s.primary().click();await flush();
 assert.deepEqual(s.calls.filter(c=>c.action==='redact-item').map(c=>c.fullname+':'+c.step),['t1_a52:overwrite','t1_a52:delete']);
});
test('shared calendar supplies the date bounds and invalidates a previous review',async t=>{
 const s=await dialog(t,{items:fresh});assert.equal(s.D.querySelector('input[type=date]'),null);
 s.r.state.dateButton.click();const picker=s.r.state.picker;assert.ok(picker instanceof s.W.RCSDatePicker);assert.equal(s.r.state.dateHost.hidden,false);
 picker.draft={mode:'Between',start:'2023-01-01',end:'2023-06-30'};picker.apply();
 assert.equal(s.q('[name=from]').value,'2023-01-01');assert.equal(s.q('[name=to]').value,'2023-06-30');assert.equal(s.r.state.dateHost.hidden,true);
 s.primary().click();await flush();assert.equal(s.r.state.phase,'previewed');s.r.state.cancel.click();
 s.r.state.dateButton.click();picker.reset();assert.equal(s.q('[name=from]').value,'');assert.equal(s.r.state.selection,null);
});
test('date discovery stops chronological pagination at the start boundary but keeps score-sorted matches',async t=>{
 const newer=item('a',{created:Date.parse('2023-05-02T00:00:00Z')/1000}),old=item('b',{created:Date.parse('2022-01-01T00:00:00Z')/1000});
 const s=await dialog(t,{list:args=>{
  if(args.source==='overview')return {items:[newer,old],hasMore:true,after:'past-range'};
  if(args.source==='comments' && args.sort==='top')return args.after?{items:[newer],hasMore:false}:{items:[old],hasMore:true,after:'still-matching'};
  return {items:[],hasMore:false};
 }});s.type('kinds','comments');s.type('from','2023-01-01');s.type('to','2023-12-31');s.primary().click();await flush();
 assert.equal(s.calls.filter(c=>c.source==='overview').length,1);assert.equal(s.calls.some(c=>c.source==='submitted'),false);
 assert.equal(s.calls.filter(c=>c.source==='comments' && c.sort==='top').length,2);assert.deepEqual([...s.r.state.selected],['t1_a']);
});
test('inverted dates do not start discovery and Stop completes only the current request',async t=>{
 let release;const gate=new Promise(r=>release=r);const s=await dialog(t,{items:fresh,writes:async()=>{await gate;return {written:true};}});
 s.type('from','2024-01-01');s.type('to','2023-01-01');s.primary().click();await flush();assert.equal(s.calls.length,0);assert.match(s.status(),/start date/);
 s.type('from','');s.type('to','');s.primary().click();await flush();s.primary().click();s.type('confirm','delete 3');s.primary().click();await flush();
 s.r.state.cancel.click();release();await flush();assert.equal(s.calls.filter(c=>c.action==='redact-item').length,1);assert.match(s.status(),/Stopped/);
});
