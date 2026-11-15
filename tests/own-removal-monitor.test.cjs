const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const {JSDOM}=require('jsdom');
const card=(id='post1',author='Example',state='UNMODERATED')=>`<shreddit-post id="t3_${id}" author="${author}" author-id="${author==='Example'?'t2_self':'t2_other'}" item-state="${state}" created-timestamp="2026-11-15T10:00:00Z" subreddit-name="Alpha" permalink="/r/Alpha/comments/${id}/title/" post-title="Example"><div slot="credit-bar"><faceplate-timeago ts="2026-11-15T10:00:00Z"></faceplate-timeago></div><div slot="text-body">Own text</div></shreddit-post>`;
async function setup(t,{archive,visible=()=>true,settings={ownRemoval:true,archiveDiscovery:false},check,saved={},html=card()+card('other','Other'),observe=false}={}){
 const dom=new JSDOM('<shreddit-app user-logged-in="true" logged-in-user-id="t2_self"></shreddit-app><div id="user-drawer-content"><faceplate-partial src="/svc/shreddit/partial/X/user-drawer-menu?params=username%3DExample"></faceplate-partial></div><main>'+html+'</main>',{url:'https://www.reddit.com/r/Alpha/comments/post1/title/',runScripts:'outside-only',pretendToBeVisual:true}),W=dom.window,calls=[],archives=[],checks=[];let m;
 t.after(()=>{m?.destroy();W.close();});for(const f of ['post-model.js','removal-model.js','native-removal.js','own-removal.js'])W.eval(fs.readFileSync('extension/'+f,'utf8'));
 m=new W.RTOwnRemoval.Monitor({observe,visible,check:async(msg,signal)=>{checks.push(msg);return check?check(msg,signal):{status:'unknown',verified:false};},readSettings:async()=>settings,send:async message=>{calls.push(message);return {ok:true,value:{items:saved}};},archive:async message=>{archives.push(message);return archive?archive(message):{ok:true,posts:[]};}});await m.ready;return {W,m,calls,archives,checks};
}
test('own-card badges use native evidence, never appear on other authors, and make no archive reads when off',async t=>{
 const s=await setup(t);assert.equal(s.W.document.querySelectorAll('[data-rt-own-removal]').length,0);assert.equal(s.calls.find(x=>x.action==='record').records[0].state,'unknown');assert.equal(s.archives.length,0);assert.equal(s.calls.filter(x=>x.action==='record').length,1);
});
test('host replacement, Back-style reattachment and repeated scans reuse state without duplicate work or badges',async t=>{
 const s=await setup(t,{html:card('post1','Example','AUTOMOD_FILTERED')}),original=s.W.document.querySelector('shreddit-post');const replacement=original.cloneNode(true);original.replaceWith(replacement);await s.m.scan();await s.m.scan();assert.equal(replacement.querySelectorAll('[data-rt-own-removal]').length,1);assert.equal(s.calls.filter(x=>x.action==='record').length,1);assert.equal(s.archives.length,0);
});
test('native AutoModerator evidence updates only the affected card and reports a new observation',async t=>{
 const s=await setup(t);s.W.document.querySelector('shreddit-post').setAttribute('removed-by-category','automod_filtered');await s.m.scan();assert.match(s.W.document.querySelector('[data-rt-own-removal]').textContent,/Removed automatically/);assert.equal(s.calls.filter(x=>x.action==='record').length,2);
});
test('archive inference is opt-in, bounded, likely, and cached across scans',async t=>{
 const T=Date.parse('2026-11-15T10:00:00Z')/1000;
 const s=await setup(t,{settings:{ownRemoval:true,archiveDiscovery:true},archive:async()=>({ok:true,posts:[{fullname:'t3_post1',id:'post1',author:'Example',kind:'post',body:'[removed]',archiveStatus:'removed',created:T,retrieved:T+10}]})});
 assert.equal(s.archives.length,1);assert.equal(s.archives[0].monitor,true);assert.match(s.W.document.querySelector('[data-rt-own-removal]').textContent,/likely/);await s.m.scan();assert.equal(s.archives.length,1);
 await s.m.configure({ownRemoval:true,archiveDiscovery:false});assert.equal(s.W.document.querySelector('[data-rt-own-removal]'),null);assert.equal(s.archives.length,1);
});
test('settings off and sign-out clear badges immediately; hidden tabs make no checks',async t=>{
 let shown=false;const s=await setup(t,{visible:()=>shown,html:card('post1','Example','AUTOMOD_FILTERED')});assert.equal(s.calls.length,0);shown=true;await s.m.scan();assert.equal(s.W.document.querySelectorAll('[data-rt-own-removal]').length,1);
 await s.m.configure({ownRemoval:false});assert.equal(s.W.document.querySelectorAll('[data-rt-own-removal]').length,0);
 await s.m.configure({ownRemoval:true});s.W.document.querySelector('shreddit-app').setAttribute('user-logged-in','false');await s.m.scan();assert.equal(s.W.document.querySelectorAll('[data-rt-own-removal]').length,0);
});
test('late archive responses after an account switch cannot render or persist prior account results',async t=>{
 let release,requested=0;const s=await setup(t,{html:card()});const pending=new Promise(r=>release=r);s.m.archive=()=>{requested++;return pending;};const job=s.m.configure({ownRemoval:true,archiveDiscovery:true});await new Promise(r=>setImmediate(r));assert.equal(requested,1);
 s.W.document.querySelector('shreddit-app').setAttribute('logged-in-user-id','t2_other');s.W.document.querySelector('faceplate-partial').setAttribute('src','/svc/shreddit/partial/X/user-drawer-menu?params=username%3DOther');await s.m.scan();const count=s.calls.filter(x=>x.action==='record' && x.owner==='t2_self').length;
 release({ok:true,posts:[]});await job;assert.equal(s.calls.filter(x=>x.action==='record' && x.owner==='t2_self').length,count);assert.equal(s.W.document.querySelector('#t3_post1 [data-rt-own-removal]'),null);
});
test('native text edits trigger one new observation without a badge mutation feedback loop',async t=>{
 const s=await setup(t,{observe:true});const before=s.calls.filter(x=>x.action==='record').length;s.W.document.querySelector('[slot="text-body"]').firstChild.data='Edited text';await new Promise(r=>setTimeout(r,65));assert.equal(s.calls.filter(x=>x.action==='record').length,before+1);await new Promise(r=>setTimeout(r,40));assert.equal(s.calls.filter(x=>x.action==='record').length,before+1);
});
test('an item whose native author changes loses its old own-item badge',async t=>{
 const s=await setup(t);const card=s.W.document.querySelector('shreddit-post');card.setAttribute('author','Other');card.setAttribute('author-id','t2_other');await s.m.scan();assert.equal(card.querySelector('[data-rt-own-removal]'),null);
});
test('disabled monitoring does not observe native mutations',async t=>{
 const s=await setup(t,{observe:true});await s.m.configure({ownRemoval:false});await new Promise(r=>setTimeout(r,30));let scans=0;const scan=s.m.scan.bind(s.m);s.m.scan=()=>{scans++;return scan();};s.W.document.querySelector('shreddit-post').remove();await new Promise(r=>setTimeout(r,40));assert.equal(scans,0);
});
test('duplicate native hosts prefer explicit removal evidence and produce one observation',async t=>{
 const s=await setup(t,{html:card()+card('post1','Example','AUTOMOD_FILTERED')});const records=s.calls.filter(x=>x.action==='record').flatMap(x=>x.records);assert.equal(records.length,1);assert.equal(records[0].state,'removed-auto');assert.equal(s.W.document.querySelectorAll('[data-rt-own-removal]').length,2);
});
test('fresh unsigned visibility clears a stale native removal and skips archive lookup',async t=>{
 const s=await setup(t,{html:card('post1','Example','AUTOMOD_FILTERED'),settings:{ownRemoval:true,archiveDiscovery:true},check:async()=>({fullname:'t3_post1',status:'visible',verified:true,moderation:'approved'})});
 assert.equal(s.checks.length,1);assert.equal(s.W.document.querySelectorAll('[data-rt-own-removal]').length,0);assert.equal(s.archives.length,0);const record=s.calls.find(x=>x.action==='record').records[0];assert.equal(record.state,'visible');assert.equal(record.publicStatus,'visible');assert.ok(record.publicCheckedAt);await s.m.scan();assert.equal(s.checks.length,1);
});
test('old metadata-only cache cannot suppress the first real unsigned check',async t=>{
 const s=await setup(t,{saved:{t3_post1:{fullname:'t3_post1',state:'visible',checkedAt:Date.now(),why:'old native inference'}},check:async()=>({fullname:'t3_post1',status:'removed',verified:true})});assert.equal(s.checks.length,1);assert.equal(s.calls.find(x=>x.action==='record').records[0].state,'removed-unknown');
});
test('private items do not issue unsigned or archive requests',async t=>{
 const s=await setup(t,{html:card().replace('item-state=','subreddit-type="private" item-state='),settings:{ownRemoval:true,archiveDiscovery:true}});assert.equal(s.checks.length,0);assert.equal(s.archives.length,0);assert.equal(s.calls.find(x=>x.action==='record').records[0].state,'unknown');
});
test('navigation cancels an old public check and cannot cache its late result for the new route',async t=>{
 const s=await setup(t,{html:card()});let release,signal,n=0;const gate=new Promise(r=>release=r);s.m.check=async(msg,abort)=>{n++;if(n===1){signal=abort;await gate;return {fullname:msg.fullname,status:'removed',verified:true};}return {fullname:msg.fullname,status:'visible',verified:true};};
 const first=s.m.configure({ownRemoval:true});await new Promise(r=>setImmediate(r));s.W.history.pushState({},'','/r/Alpha/comments/post1/new-route/');const next=s.m.scan();assert.equal(signal.aborted,true);release();await Promise.all([first,next]);assert.equal(s.calls.filter(m=>m.action==='record').at(-1).records[0].state,'visible');assert.equal(n,2);
});
test('new native cards arriving during a public check are processed after that check settles',async t=>{
 const s=await setup(t,{html:card(),observe:true});let release,n=0;const gate=new Promise(r=>release=r);s.m.check=async msg=>{if(++n===1)await gate;return {fullname:msg.fullname,status:'visible',verified:true};};const job=s.m.configure({ownRemoval:true});await new Promise(r=>setImmediate(r));s.W.document.querySelector('main').insertAdjacentHTML('beforeend',card('post2'));await new Promise(r=>setTimeout(r,35));release();await job;await new Promise(r=>setTimeout(r,45));assert.equal(n,2);
});
