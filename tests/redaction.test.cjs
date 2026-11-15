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
function bridge(t,{fetcher,html='<body></body>',url='https://www.reddit.com/'}={}){
 const dom=new JSDOM(html,{url,runScripts:'outside-only'}),W=dom.window,calls=[];t.after(()=>W.close());W.AbortController=AbortController;
 W.fetch=async(href,options)=>{const u=new URL(href);calls.push({url:u,options});const v=await fetcher(u,options);return {ok:(v.status ?? 200)===200,status:v.status ?? 200,headers:new Headers(v.headers || {}),text:async()=>typeof v.text==='string'?v.text:JSON.stringify(v.body ?? {})};};
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
async function dialog(t,{items,writes=()=>({written:true}),list,suggestions=()=>({username:'Example',entries:[]}),settings={},aggregate}={}){
 const dom=new JSDOM('<main></main>',{url:'https://www.reddit.com/#rt-redact',runScripts:'outside-only',pretendToBeVisual:true}),W=dom.window,calls=[];let r;
 t.after(()=>{r?.destroy();W.close();});
 W.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};W.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
 W.eval(read('feed-filters.js'));W.eval(read('date-picker.js'));W.eval(read('redaction-model.js'));W.eval(read('redaction-ui.js'));
 const readFn=async args=>{calls.push(args);
  if(args.action==='community-suggestions')return suggestions(args);
  if(args.action==='redact-identity')return {username:'Example',canWrite:true};
  if(args.action==='redact-list')return list?list(args):{items:args.source==='overview'?items:[],hasMore:false,after:null};
  if(args.action==='redact-item')return writes(args);throw Error('unexpected');};
 r=new W.RTRedaction.Redaction({read:readFn,sleep:async()=>{},readSettings:async()=>settings,aggregate});await flush();
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
 assert.equal(s.calls.find(c=>c.step==='overwrite').text,'This comment has been redacted by Reddit Tweaks.');
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
 Object.defineProperties(s.r.state.list,{clientHeight:{value:400},scrollHeight:{value:800}});s.r.state.list.scrollTop=400;s.r.state.list.dispatchEvent(new s.W.Event('scroll'));assert.equal(s.q('.rt-redact-preview').querySelectorAll('input[type=checkbox]').length,53);assert.equal(s.r.state.tail.hidden,true);
 s.r.state.selectAll.click();assert.equal(s.primary().disabled,true);
 const box=s.q('input[value="t1_a52"]');box.click();assert.equal(s.r.state.selection.matches.length,1);s.primary().click();
 assert.equal(s.r.state.preview.hidden,true);assert.equal(s.r.state.confirmation.hidden,false);assert.match(s.r.state.confirmation.textContent,/u\/Example · 0 posts and 1 comment selected/);
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
test('recent-date discovery uses only the newest native list and stops immediately at the boundary',async t=>{
 const newer=item('a',{created:Date.parse('2023-05-02T00:00:00Z')/1000}),old=item('b',{created:Date.parse('2022-01-01T00:00:00Z')/1000});
 const s=await dialog(t,{list:args=>({items:[newer,old],hasMore:true,after:'past-range'})});
 s.type('kinds','comments');s.type('from','2023-01-01');s.type('to','2023-12-31');s.primary().click();await flush();
 const lists=s.calls.filter(c=>c.action==='redact-list');assert.equal(lists.length,1);assert.equal(lists[0].source,'comments');assert.equal(lists[0].sort,'new');assert.equal(lists[0].native,true);assert.deepEqual([...s.r.state.selected],['t1_a']);
});
test('inverted dates do not start discovery and Stop completes only the current request',async t=>{
 let release;const gate=new Promise(r=>release=r);const s=await dialog(t,{items:fresh,writes:async()=>{await gate;return {written:true};}});
 s.type('from','2024-01-01');s.type('to','2023-01-01');s.primary().click();await flush();assert.equal(s.calls.length,0);assert.match(s.status(),/start date/);
 s.type('from','');s.type('to','');s.primary().click();await flush();s.primary().click();s.type('confirm','delete 3');s.primary().click();await flush();
 s.r.state.cancel.click();release();await flush();assert.equal(s.calls.filter(c=>c.action==='redact-item').length,1);assert.match(s.status(),/Stopped/);
});

test('content type reuses menu rows with icons, keyboard navigation and focus restoration',async t=>{
 const s=await dialog(t,{items:fresh}),state=s.r.state,button=state.controls.kinds.button;
 assert.equal(s.D.querySelector('select'),null);assert.ok(button.querySelector('svg'));button.click();
 const menu=state.popup.el;assert.equal(button.getAttribute('aria-expanded'),'true');assert.equal(menu.querySelectorAll('.rt-menu-row[role=menuitemradio]').length,3);
 menu.dispatchEvent(new s.W.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));assert.equal(s.D.activeElement.dataset.rtOption,'posts');
 s.D.activeElement.click();assert.equal(state.controls.kinds.input.value,'posts');assert.equal(button.textContent,'Posts only');assert.equal(state.popup,null);assert.equal(s.D.activeElement,button);
 button.click();state.popup.el.dispatchEvent(new s.W.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(state.popup,null);assert.ok(state.dialog.open);
});
test('include and exclude communities reuse the shared picker, support exact names and remain independent',async t=>{
 const s=await dialog(t,{items:fresh}),state=s.r.state;s.W.RTCommunityIcons={peek:()=>'',get:async()=>''};
 state.controls.onlyIn.button.click();let panel=state.popup.el.rtCommunityPanel;assert.ok(panel.el.matches('.rt-sub-panel'));
 panel.input.value='r/Alpha';panel.input.dispatchEvent(new s.W.Event('input',{bubbles:true}));panel.input.dispatchEvent(new s.W.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
 assert.equal(s.r.rules().onlyIn.join(','),'alpha');assert.equal(state.controls.onlyIn.caption.textContent,'r/alpha');
 state.controls.neverIn.button.click();panel=state.popup.el.rtCommunityPanel;assert.equal(state.controls.onlyIn.button.getAttribute('aria-expanded'),'false');
 assert.equal(panel.list.querySelector('[data-rt-sub-all]').getAttribute('aria-label'),'None excluded');
 panel.input.value='Beta';panel.input.dispatchEvent(new s.W.Event('input',{bubbles:true}));panel.list.querySelector('[data-rt-sub-row="Beta"]').click();
 assert.equal(s.r.rules().neverIn.join(','),'beta');assert.equal(s.r.rules().onlyIn.join(','),'alpha');
 panel.list.querySelector('[data-rt-sub-all]').click();assert.equal(s.r.rules().neverIn.length,0);
 state.controls.kinds.button.dispatchEvent(new s.W.MouseEvent('pointerdown',{bubbles:true}));assert.equal(state.popup,null);
 assert.ok(s.calls.every(c=>c.action==='community-suggestions'),'opening selectors never starts redaction discovery');
});
test('calendar is an icon control beside the other filters and opening it does not insert a form section',async t=>{
 const s=await dialog(t,{items:fresh}),state=s.r.state;
 assert.equal(state.dateButton.className,state.controls.kinds.button.className);assert.equal(state.dateButton.querySelectorAll('svg').length,2);
 assert.equal(state.dateHost.parentElement,state.dialog);state.dateButton.click();assert.equal(state.popup.name,'date');assert.ok(state.dateHost.style.width);
 state.controls.onlyIn.button.click();assert.equal(state.picker.open,false);assert.equal(state.dateHost.hidden,true);assert.equal(state.popup.name,'onlyIn');
 assert.equal(s.q('[name=keepScoreAtLeast]').closest('label').firstElementChild.textContent,'Minimum votes to keep');assert.match(s.r.state.form.textContent,/10 keeps items with 10 or more votes/);
});
test('a later source failure keeps already found matches and labels discovery incomplete',async t=>{
 const s=await dialog(t,{list:args=>{if(args.source==='overview')return {items:fresh,hasMore:false};throw Error('Reddit could not list your comments (HTTP 404).');}});
 s.primary().click();await flush();assert.equal(s.r.state.phase,'previewed');assert.equal(s.r.state.selected.size,3);assert.match(s.status(),/Incomplete discovery.*HTTP 404/);
 s.primary().click();assert.match(s.r.state.confirmation.textContent,/Discovery was incomplete/);assert.equal(s.calls.some(c=>c.action==='redact-item'),false);
});
const nativeComments=(rows,next='')=>'<main><shreddit-feed>'+rows.map(({id='abc',author='Example',date='2023-05-02T00:00:00Z',score=5,text='Native comment'})=>`<shreddit-profile-comment comment-id="t1_${id}" href="/r/Alpha/comments/p/title/comment/${id}/"><div id="poster-info-t1_${id}"><a href="/user/${author}/">${author}</a></div><faceplate-timeago ts="${date}"></faceplate-timeago><div class="md"><p>${text}</p></div><shreddit-comment-action-row score="${score}" permalink="/r/Alpha/comments/p/title/comment/${id}/"></shreddit-comment-action-row></shreddit-profile-comment>`).join('')+(next?'<faceplate-partial src="'+next.replaceAll('&','&amp;')+'"></faceplate-partial>':'')+'</shreddit-feed></main>';
test('native discovery reuses the signed-in profile, follows its actual continuation and guards writes',async t=>{
 const next='/svc/shreddit/profiles/profile_comments-more-posts/new/?after=opaque-token&name=Example';
 const b=bridge(t,{url:'https://www.reddit.com/user/Example/comments/',html:nativeComments([{id:'a'},{id:'foreign',author:'Other'}],next),fetcher:u=>u.pathname==='/api/me.json'?meBody:u.pathname.includes('more-posts')?{text:nativeComments([{id:'b',date:'2022-01-01T00:00:00Z'}])}:{body:{json:{errors:[]}}}});
 await b.send({action:'redact-identity'});const page=await b.send({action:'redact-list',username:'Example',source:'comments',sort:'new',native:true});
 assert.equal(b.calls.length,1,'loaded native cards need no listing request');assert.deepEqual(page.items.map(i=>i.fullname),['t1_a']);assert.equal(page.after,next);assert.equal(page.items[0].body,'Native comment');assert.equal(page.items[0].score,5);
 const more=await b.send({action:'redact-list',username:'Example',source:'comments',sort:'new',native:true,after:page.after});assert.equal(more.items[0].fullname,'t1_b');assert.equal(more.hasMore,false);
 assert.equal(b.calls[1].options.credentials,'include');assert.match(b.calls[1].options.headers.Accept,/partial/);
 const before=b.calls.length;assert.equal((await b.send({action:'redact-list',username:'Example',source:'comments',sort:'new',native:true,after:'/api/me.json'})).ok,false);assert.equal(b.calls.length,before);
 assert.equal((await b.send({action:'redact-item',username:'Example',fullname:'t1_foreign',step:'delete'})).ok,false);
 assert.equal((await b.send({action:'redact-item',username:'Example',fullname:'t1_a',step:'overwrite',text:'replacement'})).written,true);
});
test('native discovery reads the own profile HTML outside that view and never calls legacy comments JSON',async t=>{
 const b=bridge(t,{fetcher:u=>u.pathname==='/api/me.json'?meBody:{text:nativeComments([{id:'a'}])}});await b.send({action:'redact-identity'});
 const page=await b.send({action:'redact-list',username:'Example',source:'comments',sort:'new',native:true});assert.equal(page.items.length,1);assert.equal(b.calls[1].url.pathname,'/user/Example/comments/');assert.equal(b.calls[1].url.searchParams.get('sort'),'new');assert.ok(!b.calls.some(c=>c.url.pathname.endsWith('comments.json')));
});

test('loaded profile communities appear in the picker without another discovery request',async t=>{
 const s=await dialog(t,{items:fresh,suggestions:()=>({username:'Example',entries:[{key:'alpha',count:3}]})});
 s.r.state.controls.onlyIn.button.click();await flush();assert.ok(s.r.state.popup.el.querySelector('[data-rt-sub-row="alpha"]'));assert.equal(s.calls.filter(c=>c.action==='community-suggestions').length,1);
});
test('older pinned items do not stop chronological discovery before newer matches',async t=>{
 const old=item('pin',{created:Date.parse('2020-01-01T00:00:00Z')/1000,pinned:true}),recent=item('new',{created:Date.parse('2023-05-02T00:00:00Z')/1000});
 const s=await dialog(t,{list:args=>args.after?{items:[recent],hasMore:false}:{items:[old],hasMore:true,after:'next'}});s.type('from','2023-01-01');s.primary().click();await flush();assert.equal(s.calls.filter(c=>c.action==='redact-list').length,2);assert.deepEqual([...s.r.state.selected],['t1_new']);
});

test('native discovery refuses unreadable authors and retains long text for keep filters',async t=>{
 const text='x'.repeat(4500)+' protected phrase';let broken=false;
 const b=bridge(t,{fetcher:u=>u.pathname==='/api/me.json'?meBody:{text:broken?nativeComments([{id:'a'}]).replace('poster-info-t1_a','missing-author'):nativeComments([{id:'a',text}])}});
 await b.send({action:'redact-identity'});const page=await b.send({action:'redact-list',username:'Example',source:'comments',sort:'new',native:true});assert.ok(page.items[0].body.endsWith('protected phrase'));
 assert.equal(model().select(page.items,{keepContaining:'protected phrase'}).matches.length,0);
 broken=true;const refused=await b.send({action:'redact-list',username:'Example',source:'comments',sort:'new',native:true});assert.equal(refused.ok,true);assert.equal(refused.unread,1);assert.deepEqual(refused.items,[]);
});

test('native profile posts and unreadable cards do not discard other authored items',async t=>{
 const post=`<shreddit-post id="t3_pin1" author="Example" permalink="/user/Example/comments/pin1/title/" created-timestamp="2020-01-01T00:00:00Z" post-type="text" score="12" stickied><div slot="text-body"><p>Profile post text</p></div></shreddit-post>`;
 const html=nativeComments([{id:'good'},{id:'bad'}]).replace('<div class="md"><p>Native comment</p></div><shreddit-comment-action-row score="5" permalink="/r/Alpha/comments/p/title/comment/bad/">','<shreddit-comment-action-row score="5" permalink="/r/Alpha/comments/p/title/comment/bad/">').replace('<shreddit-feed>','<shreddit-feed>'+post);
 const b=bridge(t,{fetcher:u=>u.pathname==='/api/me.json'?meBody:{text:html}});await b.send({action:'redact-identity'});
 const page=await b.send({action:'redact-list',username:'Example',source:'overview',sort:'new',native:true});assert.equal(page.ok,true);assert.equal(page.unread,1);assert.deepEqual(page.items.map(i=>i.fullname),['t3_pin1','t1_good']);
 assert.equal(page.items[0].subreddit,'u_Example');assert.equal(page.items[0].pinned,true);assert.equal(page.items[0].body,'Profile post text');
 assert.equal((await b.send({action:'redact-item',username:'Example',fullname:'t1_bad',step:'delete'})).ok,false);
 const X=model();assert.equal(X.select(page.items,{neverIn:'u/Example'}).matches.length,1);
});
test('unread native items are disclosed in review and confirmation without hiding valid matches',async t=>{
 const s=await dialog(t,{list:()=>({items:fresh,unread:1,hasMore:false})});s.type('from','2000-01-01');s.primary().click();await flush();
 assert.equal(s.r.state.selected.size,3);assert.match(s.status(),/1 item could not be read and was excluded/);assert.equal(s.r.state.status.dataset.incomplete,'true');
 s.primary().click();assert.match(s.r.state.confirmation.textContent,/Discovery was incomplete/);
});

test('operation modes perform only their chosen writes and overwrite mode excludes textless items',async()=>{
 const X=model(),items=[item('a'),item('p',{kind:'post',isSelf:false,body:''})];
 for(const operation of ['overwrite','delete','overwrite-delete']){
  const rules=X.normalizeRules({operation,text:'Custom message'}),selected=X.select(items,rules),calls=[];
  const result=await X.run(selected.matches,rules,{write:async(i,step,text)=>{calls.push([i.fullname,step,text]);return {ok:true};},sleep:async()=>{},now:()=>0});
  assert.equal(result.failed.length,0);assert.deepEqual(calls.map(c=>c[1]),operation==='overwrite'?['overwrite']:operation==='delete'?['delete','delete']:['overwrite','delete','delete']);
  assert.ok(calls.every(c=>c[2]==='Custom message'));assert.equal(X.confirmation(1,operation),operation==='overwrite'?'overwrite 1':'delete 1');
 }
 let writes=0;const bad=await X.run([items[1]],X.normalizeRules({operation:'overwrite'}),{write:async()=>{writes++;return {ok:true};},sleep:async()=>{}});assert.equal(writes,0);assert.equal(bad.failed.length,1);
});
test('custom replacement text is editable, confirmed verbatim and used for overwrite-only',async t=>{
 const s=await dialog(t,{items:fresh}),state=s.r.state;assert.equal(s.q('[name=text]').value,'This comment has been redacted by Reddit Tweaks.');
 s.type('text','A custom privacy message.');state.controls.operation.button.click();s.q('[data-rt-option=overwrite]').click();assert.equal(state.messageField.hidden,false);assert.equal(state.controls.operation.caption.textContent,'Overwrite text');
 s.primary().click();await flush();assert.equal(state.selection.matches.length,2);s.primary().click();assert.equal(state.replacementEditor.value,'A custom privacy message.');assert.match(state.confirmation.textContent,/remain on Reddit/);
 s.type('confirm','delete 2');assert.equal(s.primary().disabled,true);s.type('confirm','overwrite 2');s.primary().click();await flush();
 const writes=s.calls.filter(c=>c.action==='redact-item');assert.deepEqual(writes.map(c=>c.step),['overwrite','overwrite']);assert.ok(writes.every(c=>c.text==='A custom privacy message.'));assert.match(s.status(),/^Overwritten 2 of 2/);
});
test('delete-only hides replacement without losing edits and never overwrites',async t=>{
 const s=await dialog(t,{items:fresh});s.type('text','Saved custom text');s.type('operation','delete');assert.equal(s.r.state.messageField.hidden,true);
 s.type('operation','overwrite');assert.equal(s.q('[name=text]').value,'Saved custom text');s.type('operation','delete');s.primary().click();await flush();s.primary().click();
 assert.equal(s.q('.rt-redact-replacement'),null);assert.match(s.r.state.confirmation.textContent,/without overwriting/);s.type('confirm','delete 3');s.primary().click();await flush();assert.deepEqual(s.calls.filter(c=>c.action==='redact-item').map(c=>c.step),['delete','delete','delete']);
});
test('Read full text expands the same excerpt without changing selection or making another copy',async t=>{
 const body='A long comment '+ 'word '.repeat(80)+'ending';const s=await dialog(t,{items:[item('long',{body})]});s.primary().click();await flush();
 const row=s.q('.rt-redact-row'),excerpt=row.querySelector('.rt-redact-excerpt'),button=row.querySelector('.rt-redact-expand'),collapsed=excerpt.textContent;assert.notEqual(collapsed,body);
 button.click();assert.equal(row.querySelector('.rt-redact-excerpt'),excerpt);assert.equal(excerpt.textContent,body);assert.equal(row.querySelector('input').checked,true);assert.equal(row.querySelectorAll('.rt-redact-fulltext,details').length,0);assert.equal(row.textContent.split(body).length-1,1);
 button.click();assert.equal(excerpt.textContent,collapsed);assert.equal(button.getAttribute('aria-expanded'),'false');
});
test('review loads more on scrolling and retains offscreen deselections without paging buttons',async t=>{
 const s=await dialog(t,{items:Array.from({length:105},(_,i)=>item('a'+i))});s.primary().click();await flush();const state=s.r.state;
 assert.ok(!state.preview.textContent.includes('Show next'));state.selectAll.click();Object.defineProperties(state.list,{clientHeight:{value:400},scrollHeight:{value:800}});state.list.scrollTop=400;
 state.list.dispatchEvent(new s.W.Event('scroll'));assert.equal(state.visibleRows,100);state.list.dispatchEvent(new s.W.Event('scroll'));assert.equal(state.visibleRows,105);assert.equal(state.tail.hidden,true);assert.ok([...state.list.querySelectorAll('input')].every(e=>!e.checked));assert.equal(s.primary().disabled,true);
});
test('own activity suggestions merge optional archive counts, stay available across selectors and respect opt-out',async t=>{
 const aggregateCalls=[],suggestions=()=>({username:'Example',entries:[{key:'alpha',count:2}]});
 const s=await dialog(t,{items:fresh,suggestions,settings:{archiveDiscovery:true},aggregate:async args=>{aggregateCalls.push(args);return {ok:true,buckets:[{key:'beta',count:args.kind==='post'?5:7}]};}});
 s.r.state.controls.onlyIn.button.click();await flush();const panel=s.r.state.popup.el.rtCommunityPanel;assert.equal(panel.data.entries[0].key,'beta');assert.equal(panel.data.entries[0].count,12);assert.ok(panel.data.entries.some(e=>e.key==='alpha'));
 s.r.state.controls.neverIn.button.click();await flush();assert.equal(s.calls.filter(c=>c.action==='community-suggestions' && !c.query).length,1);assert.equal(aggregateCalls.length,2);
 const off=await dialog(t,{items:fresh,suggestions,settings:{archiveDiscovery:false},aggregate:async()=>{throw Error('must not call');}});off.r.state.controls.onlyIn.button.click();await flush();assert.ok(off.r.state.popup.el.rtCommunityPanel.data.entries.some(e=>e.key==='alpha'));assert.equal(off.r.state.historyFailed,false);
});
test('Reddit typeahead debounces, rejects stale responses, and clears back to activity suggestions',async t=>{
 let release;const first=new Promise(r=>release=r);const s=await dialog(t,{items:fresh,suggestions:args=>!args.query?{username:'Example',entries:[{key:'alpha',count:2}]}:args.query==='lap'?first:{username:'Example',entries:[{key:'Android',count:0}]}});
 s.r.state.controls.onlyIn.button.click();await flush();const panel=s.r.state.popup.el.rtCommunityPanel,input=panel.input;
 input.value='lap';input.dispatchEvent(new s.W.Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,280));
 input.value='phone';input.dispatchEvent(new s.W.Event('input',{bubbles:true}));release({entries:[{key:'Macbook',count:0}]});await new Promise(r=>setTimeout(r,280));await flush();
 assert.equal(panel.list.querySelector('[data-rt-sub-row=Macbook]'),null);assert.ok(panel.list.querySelector('[data-rt-sub-row=Android]'),'server semantic matches need not contain the query');
 s.r.state.popup.el.querySelector('.rt-filter-search-clear').click();assert.equal(input.value,'');assert.equal(panel.list.querySelector('[data-rt-sub-row=Android]'),null);assert.ok(panel.list.querySelector('[data-rt-sub-row=alpha]'));
});
test('community suggestions use authored profile activity and native typeahead, with account-scoped caching',async t=>{
 let account='Example';const b=bridge(t,{url:'https://www.reddit.com/user/Example/comments/',html:nativeComments([{id:'own'},{id:'other',author:'Other'}]),fetcher:u=>u.pathname==='/api/me.json'?{body:{data:{name:account,modhash:'NOT-FOR-CALLERS'}}}:u.pathname==='/svc/shreddit/search-typeahead'?{text:'<a href="/r/Laptops/">Laptops</a><a href="https://evil.test/r/Evil/">ignore</a><a href="/r/Laptops/comments/x/">ignore</a>'}:{text:nativeComments([{id:'new',author:'Other'}]).replaceAll('/r/Alpha/','/r/Beta/')}});
 const own=await b.send({action:'community-suggestions',query:''});assert.equal(own.username,'Example');assert.deepEqual(own.entries,[{key:'Alpha',count:1}]);assert.equal(JSON.stringify(own).includes('NOT-FOR-CALLERS'),false);
 const search=await b.send({action:'community-suggestions',query:'lap'});assert.deepEqual(search.entries,[{key:'Laptops',count:0}]);await b.send({action:'community-suggestions',query:'lap'});assert.equal(b.calls.filter(c=>c.url.pathname.includes('typeahead')).length,1);
 const call=b.calls.find(c=>c.url.pathname.includes('typeahead'));assert.equal(call.options.credentials,'include');assert.equal(call.url.searchParams.get('recentSearchesCount'),'0');assert.ok(call.url.searchParams.get('cId'));
 account='Other';const next=await b.send({action:'community-suggestions',query:''});assert.deepEqual(next.entries,[{key:'Beta',count:1}]);
 const before=b.calls.length;assert.equal((await b.send({action:'community-suggestions',query:'bad\nquery'})).ok,false);assert.equal(b.calls.length,before);
});
test('closing a run stops after its pending request on browsers without AbortSignal.any',async t=>{
 let release;const gate=new Promise(r=>release=r),s=await dialog(t,{items:fresh,writes:async()=>{await gate;return {written:true};}});
 s.primary().click();await flush();s.primary().click();s.type('confirm','delete 3');s.primary().click();await flush();
 s.q('[slot=close-button]').click();s.q('[slot=close-button]').click();release();await flush();assert.equal(s.calls.filter(c=>c.action==='redact-item').length,1);assert.equal(s.r.state,null);
});
test('subsequent native discovery refreshes its data after a successful write',async t=>{
 const b=bridge(t,{url:'https://www.reddit.com/user/Example/comments/',html:nativeComments([{id:'a',text:'Before'}]),fetcher:(u,o)=>u.pathname==='/api/me.json'?meBody:o.method==='POST'?{body:{json:{errors:[]}}}:{text:nativeComments([{id:'a',text:'After'}])}});
 await b.send({action:'redact-identity'});await b.send({action:'redact-list',username:'Example',source:'comments',sort:'new',native:true});
 await b.send({action:'redact-item',username:'Example',fullname:'t1_a',step:'overwrite',text:'After'});const next=await b.send({action:'redact-list',username:'Example',source:'comments',sort:'new',native:true});assert.equal(next.items[0].body,'After');assert.ok(b.calls.some(c=>c.url.pathname==='/user/Example/comments/'));
});

test('matched posts and comments have separate labelled sections with shared community icons',async t=>{
 const items=[item('a'),item('b',{subreddit:'Beta'}),item('p1',{kind:'post',isSelf:true,title:'First post',body:'Post body'}),item('p2',{kind:'post',isSelf:true,title:'Second post',body:'More text',subreddit:'Beta'})];
 const s=await dialog(t,{items});s.W.RTCommunityIcons={peek:name=>'https://styles.redditmedia.com/t5_test/'+name+'.png',get:async()=>{throw Error('cached icons need no lookup');}};
 s.primary().click();await flush();const posts=s.q('[data-rt-redact-kind=post]'),comments=s.q('[data-rt-redact-kind=comment]');
 assert.equal(posts.querySelector('h3').textContent,'Posts');assert.equal(comments.querySelector('h3').textContent,'Comments');
 assert.equal(posts.querySelectorAll('input[value^=t3_]').length,2);assert.equal(posts.querySelectorAll('input[value^=t1_]').length,0);assert.equal(comments.querySelectorAll('input[value^=t1_]').length,2);
 for(const row of s.q('.rt-redact-preview').querySelectorAll('.rt-redact-row')){const box=row.querySelector('input'),expected=items.find(i=>i.fullname===box.value).subreddit,icon=row.querySelector('.rt-community-icon');assert.equal(icon.dataset.rtCommunity,expected);assert.ok(icon.querySelector('img').src.endsWith('/'+expected+'.png'));}
 const order=[...s.r.state.selection.matches].map(i=>i.fullname);s.r.state.selectAll.click();assert.equal(posts.querySelector('input').checked,false);assert.equal(comments.querySelector('input').checked,false);s.r.state.selectAll.click();assert.deepEqual([...s.r.state.selection.matches].map(i=>i.fullname),order);
});
test('both sections load independently on scroll and keep shared offscreen selections',async t=>{
 const items=[...Array.from({length:60},(_,i)=>item('p'+i,{kind:'post',title:'Post '+i,isSelf:true,body:'Body'})),...Array.from({length:55},(_,i)=>item('c'+i))];
 const s=await dialog(t,{items});s.primary().click();await flush();const state=s.r.state,posts=state.groups.find(g=>g.kind==='post'),comments=state.groups.find(g=>g.kind==='comment'),first=posts.list.firstElementChild;
 assert.equal(posts.visible,50);assert.equal(comments.visible,50);state.selectAll.click();
 for(const group of [posts,comments]){Object.defineProperties(group.list,{clientHeight:{value:300},scrollHeight:{value:600}});group.list.scrollTop=300;}
 comments.list.dispatchEvent(new s.W.Event('scroll'));assert.equal(comments.visible,55);assert.equal(posts.visible,50);
 posts.list.dispatchEvent(new s.W.Event('scroll'));assert.equal(posts.visible,60);assert.equal(posts.list.firstElementChild,first);assert.equal(state.visibleRows,115);assert.ok([...state.preview.querySelectorAll('input[type=checkbox]')].every(input=>!input.checked));
 posts.list.lastElementChild.previousElementSibling.querySelector('input').click();assert.equal(posts.selected.textContent,'1 of 60 selected');assert.equal(comments.selected.textContent,'0 of 55 selected');assert.equal(state.selection.matches.length,1);
});
test('community icons load when visible and old section observers cannot append into a later review',async t=>{
 const s=await dialog(t,{items:Array.from({length:53},(_,i)=>item('a'+i))}),observers=[],reads=[];
 s.W.IntersectionObserver=class{constructor(callback){this.callback=callback;this.targets=new Set();observers.push(this);}observe(node){this.targets.add(node);}unobserve(node){this.targets.delete(node);}disconnect(){this.disconnected=true;this.targets.clear();}};
 s.W.RTCommunityIcons={peek:()=>'',get:async name=>{reads.push(name);return 'https://styles.redditmedia.com/t5_test/icon.png';}};
 s.primary().click();await flush();const old=s.r.state.groups[0],observer=observers[0],icon=old.list.querySelector('.rt-community-icon');assert.equal(reads.length,0);
 observer.callback([{target:icon,isIntersecting:true}]);await flush();assert.ok(icon.querySelector('img'));assert.equal(reads.length,1);
 s.r.state.cancel.click();assert.equal(observer.disconnected,true);s.primary().click();await flush();observer.callback([{target:old.tail,isIntersecting:true}]);assert.equal(old.visible,50);assert.equal(s.r.state.groups[0].visible,50);
 s.r.close(true);assert.ok(observers.every(o=>o.disconnected));
});
test('replacement message is editable on confirmation, persists when going back and locks during writes',async t=>{
 let release;const gate=new Promise(r=>release=r);const s=await dialog(t,{items:[item('a'),item('b')],writes:async()=>{await gate;return {written:true};}});
 s.type('operation','overwrite');s.primary().click();await flush();s.primary().click();const state=s.r.state,ids=state.selection.matches.map(i=>i.fullname),editor=state.replacementEditor;
 s.type('confirm','overwrite 2');assert.equal(s.primary().disabled,false);editor.value='Edited on the confirmation screen.\n';editor.dispatchEvent(new s.W.Event('input',{bubbles:true}));
 assert.equal(state.confirm.value,'');assert.equal(s.primary().disabled,true);assert.deepEqual(state.selection.matches.map(i=>i.fullname),ids);assert.equal(state.form.elements.text.value,editor.value);
 state.cancel.click();s.primary().click();assert.equal(state.replacementEditor.value,'Edited on the confirmation screen.\n');s.type('confirm','overwrite 2');s.primary().click();assert.equal(state.replacementEditor.disabled,true);
 state.replacementEditor.value='Too late';state.replacementEditor.dispatchEvent(new s.W.Event('input',{bubbles:true}));assert.equal(state.selection.rules.text,'Edited on the confirmation screen.\n');release();await flush();
 const calls=s.calls.filter(c=>c.action==='redact-item');assert.equal(calls.length,2);assert.ok(calls.every(c=>c.step==='overwrite' && c.text==='Edited on the confirmation screen.\n'));
});
test('empty or oversized confirmation messages cannot run even with the typed phrase',async t=>{
 const s=await dialog(t,{items:[item('a')]});s.primary().click();await flush();s.primary().click();const editor=s.r.state.replacementEditor;
 for(const value of ['', 'x'.repeat(1001)]){editor.value=value;editor.dispatchEvent(new s.W.Event('input',{bubbles:true}));s.type('confirm','delete 1');assert.equal(s.primary().disabled,true);assert.equal(editor.getAttribute('aria-invalid'),'true');await s.r.runRedaction();}
 assert.equal(s.calls.some(c=>c.action==='redact-item'),false);editor.value='Valid edited message';editor.dispatchEvent(new s.W.Event('input',{bubbles:true}));s.type('confirm','delete 1');assert.equal(s.primary().disabled,false);
});
test('the confirmation screen can switch overwrite, delete and both without losing the reviewed selection',async t=>{
 const s=await dialog(t,{items:fresh});s.primary().click();await flush();s.primary().click();const state=s.r.state,control=()=>s.q('[data-rt-redact-filter=confirmationOperation]');
 const change=value=>{control().click();s.q('.rt-redact-popover[role=menu] [data-rt-option="'+value+'"]').click();};
 // Step 3 uses the same styled menu control as step 1, not a native select.
 assert.equal(s.q('select'),null);assert.equal(control().className,'rt-redact-control');assert.equal(control().getAttribute('aria-haspopup'),'menu');
 assert.equal(control().querySelector('.rt-redact-control-value').textContent,'Overwrite, then delete');assert.equal(s.q('[name=confirmationOperation]').value,'overwrite-delete');assert.ok(state.replacementEditor);
 control().click();const menu=s.q('.rt-redact-popover[role=menu]');assert.equal(control().getAttribute('aria-expanded'),'true');assert.deepEqual([...menu.querySelectorAll('[data-rt-option]')].map(row=>row.dataset.rtOption),['overwrite-delete','overwrite','delete']);
 assert.equal(menu.querySelector('[aria-checked=true]').dataset.rtOption,'overwrite-delete');control().click();assert.equal(s.q('.rt-redact-popover[role=menu]'),null,'the control toggles its menu');
 assert.equal(state.phase,'confirming','opening the menu never leaves the confirmation');
 change('overwrite');assert.deepEqual(plain(state.selection.matches.map(i=>i.fullname)),['t1_a','t1_b']);assert.equal(state.selection.posts,0);assert.equal(state.selection.comments,2);assert.equal(s.primary().textContent,'Overwrite 2 items');assert.equal(state.confirmLabel.textContent,'Type “overwrite 2” to confirm');assert.ok(state.replacementEditor);assert.equal(state.form.elements.operation.value,'overwrite');
 s.type('confirm','overwrite 2');assert.equal(s.primary().disabled,false);
 change('delete');assert.equal(state.selection.matches.length,3);assert.equal(state.replacementEditor,null);assert.equal(s.primary().textContent,'Delete 3 items');assert.equal(state.form.elements.operation.value,'delete');assert.equal(state.confirm.value,'');assert.match(state.confirmation.textContent,/without overwriting/);assert.equal(s.primary().disabled,true);
 change('overwrite-delete');assert.equal(state.selection.matches.length,3);assert.ok(state.replacementEditor);assert.equal(s.primary().textContent,'Overwrite and delete 3 items');
 assert.equal(control().querySelector('.rt-redact-control-value').textContent,'Overwrite, then delete');assert.equal(state.phase,'confirming');assert.equal(s.D.activeElement,control(),'focus returns to the action control');
 change('delete');s.type('confirm','delete 3');s.primary().click();await flush();assert.deepEqual(plain(s.calls.filter(c=>c.action==='redact-item').map(c=>c.fullname+':'+c.step)),['t1_a:delete','t1_b:delete','t3_p:delete']);
});
test('dialog header: a step kicker above a styled title, tightened for every step',async t=>{
 const s=await dialog(t,{items:fresh});const head=s.q('[data-rt-redact] [slot="title"]');
 assert.ok(head.classList.contains('rt-dialog-head'));assert.equal(head.querySelector('.rt-dialog-kicker').textContent,'Step 1 of 3 · Choose filters');assert.ok(head.querySelector('h2#rt-redact-title.rt-dialog-title'));
 assert.equal(s.q('.rt-raffle-body .rt-redact-step'),null,'the step lives in the header, not the body');
 s.primary().click();await flush();assert.equal(head.querySelector('.rt-dialog-kicker').textContent,'Step 2 of 3 · Review and select');assert.equal(s.q('#rt-redact-title').textContent,'Review matching items');
 const css=read('post-discovery.css');assert.match(css,/\.rt-dialog-title\{[^}]*font-size:18px[^}]*font-weight:700/);assert.match(css,/\.rt-dialog-kicker\{[^}]*font-size:12px/);
 assert.match(css,/\.rt-raffle-body\{[^}]*gap:10px;padding:0 16px 8px/);
});
test('the header shows a three-step progress bar that follows the step',async t=>{
 const s=await dialog(t,{items:fresh});const bars=()=>[...s.D.querySelectorAll('.rt-dialog-steps > span')].map(b=>b.dataset.state);
 assert.deepEqual(bars(),['current','todo','todo']);assert.equal(s.q('.rt-dialog-steps').getAttribute('aria-hidden'),'true','the kicker text already says the step');
 s.primary().click();await flush();assert.deepEqual(bars(),['done','current','todo']);s.primary().click();assert.deepEqual(bars(),['done','done','current']);
});
test('the popup’s open message opens the dialog in place, without touching the address',async t=>{
 const dom=new JSDOM('<main></main>',{url:'https://www.reddit.com/r/Alpha/',runScripts:'outside-only',pretendToBeVisual:true}),W=dom.window;t.after(()=>W.close());
 W.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};W.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
 const listeners=[];let replaced=0;W.history.replaceState=()=>{replaced++;};
 W.chrome={runtime:{id:'ext',onMessage:{addListener:fn=>listeners.push(fn),removeListener(){}},sendMessage:async()=>({ok:true,settings:{}})}};
 W.eval(read('feed-filters.js'));W.eval(read('date-picker.js'));W.eval(read('redaction-model.js'));W.eval(read('redaction-ui.js'));
 assert.equal(listeners.length,1);let answer;const kept=listeners[0]({scope:'rt-redact',action:'open'},{id:'ext'},value=>{answer=value;});
 assert.equal(answer.ok,true);assert.ok(W.document.querySelector('[data-rt-redact="dialog"][open]'));assert.equal(W.location.href,'https://www.reddit.com/r/Alpha/');assert.equal(replaced,0);
 listeners[0]({scope:'rt-redact',action:'open'},{id:'ext'},()=>{});assert.equal(W.document.querySelectorAll('[data-rt-redact="dialog"]').length,1,'a second open reuses the dialog');
 assert.equal(listeners[0]({scope:'other'},{id:'ext'},()=>{}),undefined);assert.equal(kept,undefined);
 W.RTRedactionInstance.destroy();
});
test('the finding spinner is centred in its own space, with the status line centred under it',async t=>{
 const css=read('post-discovery.css');
 assert.match(css,/\.rt-redact-loading\{display:grid;place-items:center;min-height:160px/);assert.match(css,/\.rt-redact-loading shreddit-loading\{display:block;width:48px;height:48px;margin:0\}/);
 assert.match(css,/\.rt-raffle-body:has\(\.rt-redact-loading\) \.rt-raffle-status\{order:1;text-align:center\}/);
});
test('on phones the redaction footer keeps Cancel and the main action on one line',async t=>{
 const dom=new JSDOM('<main></main>',{url:'https://www.reddit.com/#rt-redact',runScripts:'outside-only',pretendToBeVisual:true}),W=dom.window;t.after(()=>W.close());
 W.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};W.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
 const media={matches:true,listeners:[],addEventListener(type,fn){this.listeners.push(fn);},removeEventListener(){}};W.matchMedia=()=>media;
 W.eval(read('feed-filters.js'));W.eval(read('date-picker.js'));W.eval(read('redaction-model.js'));W.eval(read('redaction-ui.js'));
 const r=new W.RTRedaction.Redaction({read:async()=>({}),sleep:async()=>{},readSettings:async()=>({})});await flush();
 const cancel=W.document.querySelector('[data-rt-redact] button[data-rt-slot="secondary-button"]');assert.equal(cancel.slot,'tertiary-button');
 media.matches=false;for(const fn of media.listeners)fn();assert.equal(cancel.slot,'secondary-button');r.destroy();
});
