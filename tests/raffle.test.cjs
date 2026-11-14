// Raffles (docs/raffle-spec.md): model, ⋯ menu item and dialog, page bridge.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
const read=file=>fs.readFileSync('extension/'+file,'utf8');
const flush=async()=>{for(let i=0;i<12;i++)await new Promise(r=>setImmediate(r));};
function model(){const context=vm.createContext({crypto,Date,Math,Number,String,Array,Set,Map,Object,JSON,RangeError,Error,Uint32Array});vm.runInContext(read('raffle-model.js'),context);return context.RTRaffleModel;}
const plain=v=>JSON.parse(JSON.stringify(v));
const comment=(id,author,extra={})=>({id,author,created_utc:1700000000+Number.parseInt(id,36)%100000,parent_id:'t3_post1',body:'I’m in '+id,permalink:'/r/Alpha/comments/post1/x/'+id+'/',...extra});

test('randomInt is unbiased by rejection and the draw is uniform among candidates',async()=>{
 const R=model();
 // A word at or above the largest multiple of max is rejected.
 const words=[2**32-1,5];let i=0;assert.equal(R.randomInt(3,()=>words[i++]),2);assert.equal(i,2);
 assert.throws(()=>R.randomInt(0));
 const pool=['a','b','c','d','e','f'].map((name,k)=>({id:String(k),author:'user'+name,created:k,topLevel:true,body:''}));const counts={};
 for(let k=0;k<20000;k++){const {winners}=await R.draw(pool,{winners:3});for(const w of winners)counts[w.author]=(counts[w.author] || 0)+1;}
 for(const value of Object.values(counts))assert.ok(Math.abs(value/20000-0.5)<0.02,'each user wins about half the time: '+value);
});
test('candidates apply every rule and count each exclusion; one entry per user, earliest comment',()=>{
 const R=model();
 const entries=[comment('a1','Alice'),comment('a2','Alice'),comment('b1','Bob',{parent_id:'t1_a1'}),comment('o1','Owner'),comment('d1','[deleted]'),comment('r1','Rita',{body:'[removed]'}),comment('m1','AutoModerator'),comment('x1','Xavier'),comment('k1','Kim',{body:'no code here'}),comment('l1','Late',{created_utc:1800000000})].map(raw=>R.entry(raw,{postId:'post1'}));
 const {candidates,excluded}=R.candidates(entries,{excludeUsers:'u/xavier',mustInclude:'in ',postedBefore:1750000000},{postAuthor:'owner'});
 assert.deepEqual(plain(candidates.map(c=>c.author)),['Alice']);assert.equal(candidates[0].id,'a1');
 assert.deepEqual({...excluded},{deleted:2,notTopLevel:1,author:1,listed:2,keyword:1,late:1,duplicate:1,invalid:0});
 const all=R.candidates(entries,{topLevelOnly:false,excludeAuthor:false});assert.deepEqual(plain(all.candidates.map(c=>c.author).sort()),['Alice','Bob','Kim','Late','Owner','Xavier']);
});
test('account rules are checked only for users reached; failures and suspensions never win',async()=>{
 const R=model();const pool=['a','b','c','d','e'].map((n,k)=>({id:n,author:'user_'+n,created:k,topLevel:true,body:''}));const asked=[];
 const accounts={user_a:{created:0,commentKarma:500,postKarma:0},user_b:{suspended:true},user_c:{created:1699990000,commentKarma:500,postKarma:0},user_d:null,user_e:{created:0,commentKarma:5,postKarma:0}};
 const seq=[0,0,0,0];let s=0;// all-zero words → reverse-rotation order, deterministic
 const result=await R.draw(pool,{winners:1,minAccountAgeDays:30,minCommentKarma:100},{lookup:async name=>{asked.push(name);if(accounts[name]===null)throw Error('HTTP 500');return accounts[name];},random:()=>seq[s++ % 4],now:1700000000});
 assert.equal(result.winners.length,1);assert.equal(result.winners[0].author,'user_a');assert.equal(asked.at(-1),'user_a');assert.equal(result.checked,asked.length);
 assert.ok(!asked.includes(undefined));
 const all=await R.draw(pool,{winners:5,minAccountAgeDays:30,minCommentKarma:100},{lookup:async name=>{if(accounts[name]===null)throw Error('x');return accounts[name];},now:1700000000});
 assert.deepEqual(plain(all.winners.map(w=>w.author)),['user_a']);assert.equal(all.shortBy,4);assert.deepEqual({...all.skipped},{suspended:1,age:1,unchecked:1,commentKarma:1});
});
test('results Markdown lists winners with links and states the rules',()=>{
 const R=model();const md=R.resultsMarkdown({winners:[{author:'Alice',permalink:'https://www.reddit.com/c/1'}],rules:R.normalizeRules({minAccountAgeDays:30}),poolSize:12,drawnAt:1700000000,postUrl:'https://www.reddit.com/r/Alpha/comments/post1/'});
 assert.match(md,/^\*\*Raffle results\*\* \(1 of 12 eligible entrants, drawn 2023-11-14T22:13:20Z\)/);assert.match(md,/1\. u\/Alice \(\[comment\]\(https:\/\/www\.reddit\.com\/c\/1\)\)/);assert.match(md,/Rules: top-level comments only, one entry per user, post author excluded, accounts at least 30 days old\./);
});

// --- UI
const page=(postId='post1')=>`<main><shreddit-post id="t3_${postId}" post-title="Giveaway" author="Owner" permalink="/r/Alpha/comments/${postId}/giveaway/"><shreddit-post-overflow-menu post-id="t3_${postId}" author-name="Owner" permalink="/r/Alpha/comments/${postId}/giveaway/"><button aria-haspopup="menu" aria-expanded="true">⋯</button><div slot="devvit-context-actions" role="menuitem"></div></shreddit-post-overflow-menu></shreddit-post></main>`;
async function ui(t,{url='https://www.reddit.com/r/Alpha/comments/post1/giveaway/',thread,more,users={},settings={raffles:true}}={}){
 const dom=new JSDOM(page(),{url,runScripts:'outside-only',pretendToBeVisual:true}),W=dom.window,calls=[];let r;
 t.after(()=>{r?.destroy();W.close();});
 W.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};W.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
 for(const file of ['post-model.js','raffle-model.js','raffle-ui.js'])W.eval(read(file));
 let current=settings;
 const readFn=async args=>{calls.push(args);
  if(args.action==='raffle-thread')return thread?thread(args):{post:{author:'Owner'},entries:[comment('a1','Alice'),comment('b1','Bob'),comment('o1','Owner')],missingTopLevel:[],missingReplies:0};
  if(args.action==='raffle-more')return more(args,calls.filter(c=>c.action==='raffle-more').length);
  if(args.action==='raffle-user'){const u=users[args.username];if(u instanceof Error)throw u;return u ?? {created:0,commentKarma:1000,postKarma:1000};}
  throw Error('Unexpected '+args.action);};
 r=new W.RTRaffle.Raffle({observe:false,read:readFn,readSettings:async()=>current});await r.ready;await flush();
 const D=W.document;
 return {W,D,r,calls,setSettings:async v=>{current=v;await r.loadSettings();},item:()=>D.querySelector('[data-rt-raffle="item"]'),dialog:()=>D.querySelector('[data-rt-raffle="dialog"]'),status:()=>D.querySelector('.rt-raffle-status').textContent,draw:()=>D.querySelector('[slot="primary-button"]')};
}
test('every post menu gets one “Run a raffle” item in its action slot, with Reddit’s menu-item markup',async t=>{
 const s=await ui(t);const item=s.item();assert.ok(item);assert.equal(item.parentElement.getAttribute('slot'),'devvit-context-actions');
 assert.equal(item.getAttribute('role'),'presentation');const row=item.querySelector('[role="menuitem"]');assert.match(row.className,/px-md gap-xs text-secondary-plain/);assert.equal(row.querySelector('.text-body-2').textContent,'Run a raffle');
 s.r.sync();s.r.sync();assert.equal(s.D.querySelectorAll('[data-rt-raffle="item"]').length,1);
 await s.setSettings({raffles:false});assert.equal(s.item(),null);
});
test('choosing the item closes the menu, opens the dialog and reads the comments; draw picks from eligible users',async t=>{
 const s=await ui(t);const trigger=s.D.querySelector('button[aria-haspopup]');let menuClicks=0;trigger.addEventListener('click',()=>{menuClicks++;trigger.setAttribute('aria-expanded','false');});
 s.item().querySelector('[role="menuitem"]').click();await flush();
 assert.equal(menuClicks,1);assert.ok(s.dialog().hasAttribute('open'));assert.equal(s.dialog().querySelector('rpl-modal-card').getAttribute('appearance'),'modal');
 assert.equal(s.D.activeElement?.name,'winners');assert.deepEqual(s.calls.map(c=>c.action),['raffle-thread']);assert.equal(s.calls[0].topLevelOnly,true);
 assert.equal(s.status(),'Read all 3 top-level comments · 2 eligible entrants');assert.equal(s.draw().disabled,false);
 s.draw().click();await flush();
 const winners=[...s.D.querySelectorAll('.rt-raffle-winner')];assert.equal(winners.length,1);assert.match(winners[0].textContent,/^u\/(Alice|Bob) · comment/);
 assert.match(s.D.querySelector('.rt-raffle-result-summary').textContent,/^1 winner from 2 eligible entrants · Drawn /);assert.match(s.D.querySelector('.rt-raffle-results').dataset.markdown,/\*\*Raffle results\*\*/);
 assert.equal(s.calls.some(c=>c.action==='raffle-user'),false,'no account lookups without account rules');assert.equal(s.draw().textContent,'Draw again');
});
test('top-level comments Reddit listed but didn’t return are read through the more-comments chain',async t=>{
 const s=await ui(t,{thread:()=>({post:{author:'Owner'},entries:[comment('a1','Alice')],missingTopLevel:['c1','c2','c3'],missingReplies:0}),
  more:(args,n)=>n===1?{available:true,entries:[comment('c1','Carol'),comment('zz','Stranger')],next:{src:'/svc/shreddit/more-comments/r/Alpha/t3_post1?top-level=1',cursor:'x'}}:{available:true,entries:[comment('c2','Dan'),comment('c3','Eve')],next:null}});
 s.item().querySelector('[role="menuitem"]').click();await flush();
 const more=s.calls.filter(c=>c.action==='raffle-more');assert.equal(more.length,2);assert.equal(more[0].loader,null);assert.equal(more[1].loader.cursor,'x');
 assert.equal(s.status(),'Read all 4 top-level comments · 4 eligible entrants','only IDs Reddit listed are added');
});
test('an incomplete read says so and needs an explicit tick before drawing',async t=>{
 const s=await ui(t,{url:'https://www.reddit.com/r/Alpha/',thread:()=>({post:{author:'Owner'},entries:[comment('a1','Alice'),comment('b1','Bob')],missingTopLevel:['c1','c2'],missingReplies:0}),more:()=>({available:false,entries:[],next:null})});
 s.item().querySelector('[role="menuitem"]').click();await flush();
 assert.equal(s.status(),'Read 2 of 4 top-level comments · Open the post to read the rest · 2 eligible entrants');assert.equal(s.draw().disabled,true);
 const ack=s.D.querySelector('.rt-raffle-ack');assert.equal(ack.hidden,false);ack.querySelector('input').checked=true;ack.querySelector('input').dispatchEvent(new s.W.Event('change'));
 assert.equal(s.draw().disabled,false);
});
test('account rules look up only reached users and report skips; failures never win',async t=>{
 const s=await ui(t,{users:{Alice:Error('HTTP 500'),Bob:{suspended:true}}});
 s.item().querySelector('[role="menuitem"]').click();await flush();
 const age=s.D.querySelector('input[name="minAccountAgeDays"]');age.value='30';age.dispatchEvent(new s.W.Event('input',{bubbles:true}));
 assert.match(s.status(),/2 eligible entrants before account checks$/);
 s.draw().click();await flush();
 assert.equal(s.D.querySelectorAll('.rt-raffle-winner').length,0);assert.match(s.D.querySelector('.rt-raffle-result-summary').textContent,/^No winners · Only 0 entrants pass the rules · Skipped: (1 couldn’t be checked, 1 suspended|1 suspended, 1 couldn’t be checked)/);
});
test('Escape, Cancel and the close button close the dialog, abort reading and return focus',async t=>{
 let release;const s=await ui(t,{thread:()=>new Promise(r=>release=r)});const trigger=s.D.querySelector('button[aria-haspopup]');
 for(const how of ['cancel','close','escape']){
  s.item().querySelector('[role="menuitem"]').click();await flush();const d=s.dialog();assert.ok(d);
  if(how==='cancel')d.querySelector('[slot="secondary-button"]').click();else if(how==='close')d.querySelector('[slot="close-button"]').click();else d.dispatchEvent(new s.W.Event('cancel',{cancelable:true}));
  assert.equal(s.dialog(),null,how);assert.equal(s.D.activeElement,trigger,how);
 }
 release({post:{},entries:[],missingTopLevel:[]});await flush();assert.equal(s.dialog(),null,'a late answer for a closed dialog renders nothing');
});

// --- Bridge
function bridge(t,{url='https://www.reddit.com/r/Alpha/comments/post1/giveaway/',body,html}={}){
 const dom=new JSDOM(html || '<body></body>',{url,runScripts:'outside-only'}),W=dom.window,calls=[];t.after(()=>W.close());W.AbortController=AbortController;
 W.fetch=async(href,options)=>{const u=new URL(href);calls.push({url:u,options});const value=body(u,options);return {ok:(value?.status ?? 200)===200,status:value?.status ?? 200,headers:new Headers(),text:async()=>typeof value?.text==='string'?value.text:JSON.stringify(value)};};
 for(const file of ['post-model.js','post-page-bridge.js'])W.eval(read(file));
 const send=input=>new Promise(resolve=>{const id=crypto.randomUUID(),listener=event=>{const result=JSON.parse(event.detail);if(result.id!==id)return;W.document.removeEventListener('rt-post-response',listener);resolve(result);};W.document.addEventListener('rt-post-response',listener);W.document.dispatchEvent(new W.CustomEvent('rt-post-request',{detail:JSON.stringify({channel:'raffle-test',id,...input})}));});
 return {calls,send};
}
test('bridge reads the thread JSON with the session and lists top-level IDs Reddit didn’t return',async t=>{
 const b=bridge(t,{body:()=>[{data:{children:[{kind:'t3',data:{id:'post1',author:'Owner',title:'Giveaway',num_comments:9}}]}},{data:{children:[{kind:'t1',data:{...comment('a1','Alice'),replies:{data:{children:[{kind:'t1',data:comment('r1','Rae',{parent_id:'t1_a1'})},{kind:'more',data:{parent_id:'t1_a1',children:['r2'],count:4}}]}}}},{kind:'more',data:{parent_id:'t3_post1',children:['c1','c2'],count:7}}]}}]});
 const r=await b.send({action:'raffle-thread',postId:'post1',topLevelOnly:false});assert.equal(r.ok,true,r.error);
 assert.deepEqual(r.entries.map(e=>e.id),['a1','r1']);assert.deepEqual(r.missingTopLevel,['c1','c2']);assert.equal(r.missingReplies,4);assert.equal(r.post.author,'Owner');
 const u=b.calls[0].url;assert.equal(u.pathname,'/comments/post1.json');assert.equal(u.searchParams.get('limit'),'500');assert.equal(u.searchParams.get('depth'),null);assert.equal(b.calls[0].options.credentials,'include');
 await b.send({action:'raffle-thread',postId:'post1'});assert.equal(b.calls[1].url.searchParams.get('depth'),'1');
});
test('bridge follows only Reddit’s own more-comments loader for this post',async t=>{
 const loader='<faceplate-partial src="/svc/shreddit/more-comments/r/Alpha/t3_post1?top-level=1&amp;rootCommentOffset=5" method="post"><input name="cursor" value="CUR1"></faceplate-partial>';
 const html='<main><shreddit-comment depth="0" thingid="t1_a1" author="Alice" created="2026-11-13T17:31:14.585000+0000" permalink="/r/Alpha/comments/post1/x/a1/"><div slot="comment">Hello</div></shreddit-comment>'+loader+'</main>';
 const b=bridge(t,{html,body:(u,o)=>({text:'<shreddit-comment depth="0" thingid="t1_c1" author="Carol" created="2026-11-13T18:00:00.000000+0000" permalink="/r/Alpha/comments/post1/x/c1/"><div slot="comment">Me too</div></shreddit-comment><shreddit-comment depth="1" thingid="t1_c9" author="Reply"></shreddit-comment>'})});
 const r=await b.send({action:'raffle-more',postId:'post1',loader:null});assert.equal(r.ok,true,r.error);
 assert.deepEqual(r.entries.map(e=>e.id),['a1','c1']);assert.equal(r.entries[1].body,'Me too');assert.equal(r.next,null);
 assert.equal(b.calls[0].url.pathname,'/svc/shreddit/more-comments/r/Alpha/t3_post1');assert.equal(b.calls[0].options.method,'POST');assert.equal(String(b.calls[0].options.body),'cursor=CUR1');
 for(const bad of [{src:'https://evil.test/x',cursor:'a'},{src:'/svc/shreddit/more-comments/r/Alpha/t3_other?top-level=1',cursor:'a'},{src:'/svc/shreddit/more-comments/r/Alpha/t3_post1?sort=new',cursor:'a'}])assert.equal((await b.send({action:'raffle-more',postId:'post1',loader:bad})).ok,false);
 assert.equal(b.calls.length,1);
 const feed=bridge(t,{url:'https://www.reddit.com/r/Alpha/',body:()=>({})});const f=await feed.send({action:'raffle-more',postId:'post1',loader:null});assert.equal(f.available,false);assert.equal(feed.calls.length,0);
});
test('bridge account facts: suspended, missing and invalid names',async t=>{
 const b=bridge(t,{body:u=>u.pathname.includes('Gone')?{status:404}:u.pathname.includes('Banned')?{data:{is_suspended:true}}:{data:{created_utc:1600000000,comment_karma:10,link_karma:5}}});
 assert.deepEqual(JSON.parse(JSON.stringify((({created,commentKarma,postKarma})=>({created,commentKarma,postKarma}))(await b.send({action:'raffle-user',username:'Alice'})))),{created:1600000000,commentKarma:10,postKarma:5});
 assert.equal((await b.send({action:'raffle-user',username:'Gone'})).unavailable,true);assert.equal((await b.send({action:'raffle-user',username:'Banned'})).suspended,true);
 assert.equal((await b.send({action:'raffle-user',username:'a/b'})).ok,false);assert.equal(b.calls.length,3);
});
