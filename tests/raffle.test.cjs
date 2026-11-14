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
const page=(postId='post1')=>`<main><shreddit-post id="t3_${postId}" post-title="Giveaway" author="Owner" permalink="/r/Alpha/comments/${postId}/giveaway/"><shreddit-post-overflow-menu post-id="t3_${postId}" author-name="Owner" subreddit-prefixed-name="r/Alpha" permalink="/r/Alpha/comments/${postId}/giveaway/"><button aria-haspopup="menu" aria-expanded="true">⋯</button><div slot="devvit-context-actions" role="menuitem"></div></shreddit-post-overflow-menu></shreddit-post></main>`;
async function ui(t,{url='https://www.reddit.com/r/Alpha/',thread,tree,users={},settings={raffles:true},narrow=false}={}){
 const dom=new JSDOM(page(),{url,runScripts:'outside-only',pretendToBeVisual:true}),W=dom.window,calls=[];let r;
 t.after(()=>{r?.destroy();W.close();});
 W.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};W.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
 W.matchMedia=q=>({matches:narrow && /max-width/.test(q)});W.CSS={escape:v=>String(v).replace(/"/g,'\\"')};
 for(const file of ['post-model.js','raffle-model.js','raffle-ui.js'])W.eval(read(file));
 let current=settings;
 const readFn=async args=>{calls.push(args);
  if(args.action==='raffle-thread')return thread?thread(args):{post:{author:'Owner',subreddit:'Alpha'},entries:[comment('a1','Alice',{body:'First line\nSecond line '+'x'.repeat(200)}),comment('b1','Bob'),comment('o1','Owner')],missingTopLevel:[],missingReplies:0};
  if(args.action==='raffle-tree')return tree(args,calls.filter(c=>c.action==='raffle-tree').length);
  if(args.action==='raffle-user'){const u=users[args.username];if(u instanceof Error)throw u;return u ?? {created:0,commentKarma:1000,postKarma:1000,avatar:'https://styles.redditmedia.com/'+args.username+'.png'};}
  throw Error('Unexpected '+args.action);};
 r=new W.RTRaffle.Raffle({observe:false,read:readFn,readSettings:async()=>current});await r.ready;await flush();
 const D=W.document;
 return {W,D,r,calls,setSettings:async v=>{current=v;await r.loadSettings();},item:()=>D.querySelector('[data-rt-raffle="item"]'),dialog:()=>D.querySelector('[data-rt-raffle="dialog"]'),status:()=>D.querySelector('.rt-raffle-status').textContent,
  draw:()=>D.querySelector('[data-rt-raffle] [slot="primary-button"]:not([hidden])'),open:async()=>{D.querySelector('[data-rt-raffle="item"] [role="menuitem"]').click();await flush();}};
}
test('every post menu gets one “Run a raffle” item in its action slot, with Reddit’s menu-item markup',async t=>{
 const s=await ui(t);const item=s.item();assert.ok(item);assert.equal(item.parentElement.getAttribute('slot'),'devvit-context-actions');
 assert.equal(item.getAttribute('role'),'presentation');const row=item.querySelector('[role="menuitem"]');assert.match(row.className,/px-md gap-xs text-secondary-plain/);assert.equal(row.querySelector('.text-body-2').textContent,'Run a raffle');
 s.r.sync();s.r.sync();assert.equal(s.D.querySelectorAll('[data-rt-raffle="item"]').length,1);
 await s.setSettings({raffles:false});assert.equal(s.item(),null);
});
test('the rules screen reads comments, then a draw moves to a separate results screen of Reddit-style rows',async t=>{
 const s=await ui(t);const trigger=s.D.querySelector('button[aria-haspopup]');let menuClicks=0;trigger.addEventListener('click',()=>{menuClicks++;trigger.setAttribute('aria-expanded','false');});
 await s.open();
 assert.equal(menuClicks,1);assert.ok(s.dialog().hasAttribute('open'));assert.equal(s.dialog().querySelector('rpl-modal-card').getAttribute('appearance'),'modal');
 assert.equal(s.D.querySelector('.rt-raffle-post-sub').textContent,'r/Alpha');assert.equal(s.D.activeElement?.name,'winners');
 assert.deepEqual(s.calls.map(c=>c.action),['raffle-thread'],'a complete JSON read needs no further requests');
 assert.equal(s.status(),'2 eligible entrants · Read all 3 top-level comments');assert.equal(s.draw().textContent,'Draw winners');
 const plus=s.D.querySelector('[aria-label="More winners"]');plus.click();assert.equal(s.D.querySelector('[name="winners"]').value,'2');
 s.draw().click();await flush();
 assert.equal(s.D.querySelector('[data-rt-raffle-view="rules"]').hidden,true);assert.equal(s.D.querySelector('[data-rt-raffle-view="results"]').hidden,false);assert.equal(s.D.querySelector('#rt-raffle-title').textContent,'Winners');
 assert.equal(s.draw().textContent,'Draw again');assert.equal(s.D.querySelector('[slot="tertiary-button"]').hidden,false);
 const rows=[...s.D.querySelectorAll('.rt-raffle-winner')];assert.equal(rows.length,2);
 assert.match(s.D.querySelector('.rt-raffle-banner-title').textContent,/^2 winners from 2 eligible entrants$/);
 const alice=s.D.querySelector('.rt-raffle-winner[data-rt-winner="Alice"]');
 assert.equal(alice.querySelector('.rt-raffle-cover').getAttribute('href'),'https://www.reddit.com/r/Alpha/comments/post1/x/a1/','the row opens the comment');assert.equal(alice.querySelector('.rt-raffle-cover').target,'_blank');
 assert.equal(alice.querySelector('.rt-raffle-name').getAttribute('href'),'/user/Alice/');assert.equal(alice.querySelector('faceplate-timeago').getAttribute('ts'),new Date(comment('a1','Alice').created_utc*1000).toISOString());
 const excerpt=alice.querySelector('.rt-raffle-excerpt');assert.match(excerpt.textContent,/^First line\nSecond line/);assert.equal(excerpt.dataset.rtClamped,'true');
 const more=alice.querySelector('.rt-raffle-more');more.click();assert.equal(excerpt.dataset.rtClamped,'false');assert.equal(more.textContent,'Show less');assert.equal(more.getAttribute('aria-expanded'),'true');
 assert.equal(alice.querySelector('img').getAttribute('src'),'https://styles.redditmedia.com/Alice.png','profile pictures are filled from the account');
 assert.ok(s.D.querySelector('[data-rt-raffle-view="results"]').dataset.markdown.startsWith('**Raffle results**'));
 s.D.querySelector('[slot="secondary-button"]:not([hidden])').click();assert.equal(s.D.querySelector('[data-rt-raffle-view="rules"]').hidden,false);assert.equal(s.draw().textContent,'Draw winners');
});
test('on phones the dialog is Reddit’s bottom sheet',async t=>{
 const s=await ui(t,{narrow:true});await s.open();assert.equal(s.dialog().querySelector('rpl-modal-card').getAttribute('appearance'),'bottom-sheet');assert.ok(s.dialog().classList.contains('rt-raffle-sheet'));
});
test('from any page, comments past the JSON are read with Reddit’s own client requests until the chain ends',async t=>{
 const L=(n,top=true)=>({src:'/svc/shreddit/more-comments/r/Alpha/t3_post1?top-level='+(top?1:0)+'&n='+n,cursor:'c'+n,topLevel:top});
 const s=await ui(t,{thread:()=>({post:{author:'Owner',subreddit:'Alpha'},entries:[comment('a1','Alice')],missingTopLevel:['c1','c2','c3'],missingReplies:0}),
  tree:(args,n)=>n===1?{entries:[comment('a1','Alice',{avatar:'https://www.redditstatic.com/a.png'}),comment('c1','Carol')],loaders:[L(1),L(9,false)]}:{entries:[comment('c2','Dan'),comment('c3','Eve')],loaders:[]}});
 await s.open();
 const trees=s.calls.filter(c=>c.action==='raffle-tree');assert.equal(trees.length,2);assert.equal(trees[0].loader,null);assert.equal(trees[0].subreddit,'Alpha');assert.equal(trees[1].loader.cursor,'c1');
 assert.equal(s.status(),'4 eligible entrants · Read all 4 top-level comments');assert.equal(s.D.querySelector('.rt-raffle-ack').hidden,true);
 assert.ok(!s.calls.some(c=>c.action==='raffle-tree' && c.loader?.cursor==='c9'),'reply loaders are skipped in top-level mode');
});
test('“more replies” threads are followed only when replies count as entries',async t=>{
 const L=(n,top)=>({src:'/svc/shreddit/more-comments/r/Alpha/t3_post1?x='+n,cursor:'c'+n,topLevel:top});
 const s=await ui(t,{thread:()=>({post:{author:'Owner',subreddit:'Alpha'},entries:[comment('a1','Alice')],missingTopLevel:[],missingReplies:3}),
  tree:(args,n)=>!args.loader?{entries:[],loaders:[L(1,false),L(2,false)]}:{entries:[comment('r'+args.loader.cursor,'Replier'+args.loader.cursor,{parent_id:'t1_a1'})],loaders:[]}});
 await s.open();assert.equal(s.calls.filter(c=>c.action==='raffle-tree').length,0,'top-level only: no reply reads');
 const box=s.D.querySelector('[name="topLevelOnly"]');box.checked=false;box.dispatchEvent(new s.W.Event('input',{bubbles:true}));await flush();
 assert.equal(s.calls.filter(c=>c.action==='raffle-tree').length,3);assert.match(s.status(),/Read all 1 top-level comment and 2 replies$/);
});
test('the placeholder list is not the expected count: a finished chain is complete even with fewer top-level comments',async t=>{
 const s=await ui(t,{thread:()=>({post:{author:'Owner',subreddit:'Alpha',numComments:40},entries:[comment('a1','Alice'),comment('b1','Bob')],missingTopLevel:['c1','x1','x2','x3'],missingReplies:0}),tree:()=>({entries:[comment('c1','Carol')],loaders:[]})});
 await s.open();
 assert.equal(s.status(),'3 eligible entrants · Read all 3 top-level comments (40 in the thread, counting replies)');assert.equal(s.draw().disabled,false);assert.equal(s.D.querySelector('.rt-raffle-ack').hidden,true);
});
test('a chain cut short keeps what was read, says why and needs an explicit tick before drawing',async t=>{
 const L={src:'/svc/shreddit/more-comments/r/Alpha/t3_post1?top-level=1',cursor:'c1',topLevel:true};
 const s=await ui(t,{thread:()=>({post:{author:'Owner',subreddit:'Alpha'},entries:[comment('a1','Alice'),comment('b1','Bob')],missingTopLevel:['c1'],missingReplies:0}),
  tree:(args,n)=>{if(n===1)return {entries:[comment('c1','Carol')],loaders:[L]};throw Error('Reddit could not load the comments (HTTP 500).');}});
 await s.open();
 assert.equal(s.status(),'3 eligible entrants · Read 3 top-level comments · Reddit stopped answering (Reddit could not load the comments (HTTP 500)), so some may be missing');
 assert.equal(s.draw().disabled,true);assert.equal(s.dialog().querySelector('.rt-raffle-status-card').dataset.state,'warning');
 const ack=s.D.querySelector('.rt-raffle-ack');assert.equal(ack.hidden,false);ack.querySelector('input').checked=true;ack.querySelector('input').dispatchEvent(new s.W.Event('change'));
 assert.equal(s.draw().disabled,false);
});
test('account rules look up only reached users and report skips; failures never win',async t=>{
 const s=await ui(t,{users:{Alice:Error('HTTP 500'),Bob:{suspended:true}}});
 await s.open();
 const age=s.D.querySelector('input[name="minAccountAgeDays"]');age.value='30';age.dispatchEvent(new s.W.Event('input',{bubbles:true}));
 assert.match(s.status(),/account minimums are checked during the draw$/);assert.equal(s.D.querySelector('.rt-raffle-summary-hint').textContent,'30 days');
 s.draw().click();await flush();
 assert.equal(s.D.querySelectorAll('.rt-raffle-winner').length,0);assert.equal(s.D.querySelector('.rt-raffle-banner-title').textContent,'No winners');
 assert.match(s.D.querySelector('.rt-raffle-facts').textContent,/Skipped during the draw: (1 couldn’t be checked, 1 suspended|1 suspended, 1 couldn’t be checked)/);
});
test('Escape, Cancel and the close button close the dialog, abort reading and return focus',async t=>{
 let release;const s=await ui(t,{thread:()=>new Promise(r=>release=r)});const trigger=s.D.querySelector('button[aria-haspopup]');
 for(const how of ['cancel','close','escape']){
  await s.open();const d=s.dialog();assert.ok(d);
  if(how==='cancel')d.querySelector('[slot="secondary-button"]').click();else if(how==='close')d.querySelector('[slot="close-button"]').click();else d.dispatchEvent(new s.W.Event('cancel',{cancelable:true}));
  assert.equal(s.dialog(),null,how);assert.equal(s.D.activeElement,trigger,how);
 }
 release({post:{},entries:[],missingTopLevel:[]});await flush();assert.equal(s.dialog(),null,'a late answer for a closed dialog renders nothing');
});

// --- Bridge
function bridge(t,{url='https://www.reddit.com/r/Alpha/',body,html,cookie=''}={}){
 const dom=new JSDOM(html || '<body></body>',{url,runScripts:'outside-only'}),W=dom.window,calls=[];t.after(()=>W.close());W.AbortController=AbortController;
 if(cookie)W.document.cookie=cookie;
 W.fetch=async(href,options)=>{const u=new URL(href);calls.push({url:u,options});const value=body(u,options);return {ok:(value?.status ?? 200)===200,status:value?.status ?? 200,headers:new Headers(value?.headers || {}),text:async()=>typeof value?.text==='string'?value.text:JSON.stringify(value)};};
 for(const file of ['post-model.js','post-page-bridge.js'])W.eval(read(file));
 const send=input=>new Promise(resolve=>{const id=crypto.randomUUID(),listener=event=>{const result=JSON.parse(event.detail);if(result.id!==id)return;W.document.removeEventListener('rt-post-response',listener);resolve(result);};W.document.addEventListener('rt-post-response',listener);W.document.dispatchEvent(new W.CustomEvent('rt-post-request',{detail:JSON.stringify({channel:'raffle-test',id,...input})}));});
 return {calls,send};
}
test('bridge reads the thread JSON with the session and lists top-level IDs Reddit didn’t return',async t=>{
 const b=bridge(t,{body:()=>[{data:{children:[{kind:'t3',data:{id:'post1',author:'Owner',title:'Giveaway',subreddit:'Alpha',num_comments:9}}]}},{data:{children:[{kind:'t1',data:{...comment('a1','Alice'),replies:{data:{children:[{kind:'t1',data:comment('r1','Rae',{parent_id:'t1_a1'})},{kind:'more',data:{parent_id:'t1_a1',children:['r2'],count:4}}]}}}},{kind:'more',data:{parent_id:'t3_post1',children:['c1','c2'],count:7}}]}}]});
 const r=await b.send({action:'raffle-thread',postId:'post1',topLevelOnly:false});assert.equal(r.ok,true,r.error);
 assert.deepEqual(r.entries.map(e=>e.id),['a1','r1']);assert.deepEqual(r.missingTopLevel,['c1','c2']);assert.equal(r.missingReplies,4);assert.equal(r.post.subreddit,'Alpha');
 const u=b.calls[0].url;assert.equal(u.pathname,'/comments/post1.json');assert.equal(u.searchParams.get('limit'),'500');assert.equal(u.searchParams.get('depth'),null);assert.equal(b.calls[0].options.credentials,'include');
 await b.send({action:'raffle-thread',postId:'post1'});assert.equal(b.calls[1].url.searchParams.get('depth'),'1');
});
test('bridge raffle-tree makes Reddit’s own client requests and reads comments inside templates',async t=>{
 const row=(id,author,depth,body)=>`<shreddit-comment thingid="t1_${id}" author="${author}" depth="${depth}" created="2026-11-13T18:00:00.000000+0000" permalink="/r/Alpha/comments/post1/x/${id}/" avatar="https://www.redditstatic.com/avatars/${author}.png" score="5"><div slot="comment"><p>${body}</p><p>Line two</p></div></shreddit-comment>`;
 const loader=(q,cursor)=>`<faceplate-partial src="/svc/shreddit/more-comments/r/Alpha/t3_post1?${q}" method="post"><input type="hidden" name="cursor" value="${cursor}"></faceplate-partial>`;
 const first=row('a1','Alice',0,'Hello')+'<template id="x">'+row('b1','Bob',0,'In a template')+row('r1','Rae',1,'A reply')+'</template>'+loader('top-level=1&amp;commentPositionOffset=7','CUR1')+loader('startingDepth=1&amp;commentParentPositions=3','CUR9')+loader('top-level=1','')+'<faceplate-partial src="https://evil.test/x"><input name="cursor" value="z"></faceplate-partial>';
 const b=bridge(t,{cookie:'csrf_token=TOKEN123',body:(u,o)=>({text:o.method==='POST'?row('c1','Carol',0,'Page two'):first})});
 const r=await b.send({action:'raffle-tree',postId:'post1',subreddit:'Alpha',loader:null});assert.equal(r.ok,true,r.error);
 assert.deepEqual(r.entries.map(e=>[e.id,e.parent_id]),[['a1','t3_post1'],['b1','t3_post1'],['r1','t1_']]);assert.equal(r.entries[0].body,'Hello\nLine two');assert.equal(r.entries[0].avatar,'https://www.redditstatic.com/avatars/Alice.png');
 assert.deepEqual(r.loaders.map(l=>[l.cursor,l.topLevel]),[['CUR1',true],['CUR9',false]]);
 const g=b.calls[0];assert.equal(g.options.method,'GET');assert.equal(g.url.pathname,'/svc/shreddit/comments/r/Alpha/post1');assert.equal(g.url.searchParams.get('sort'),'old');assert.equal(g.url.searchParams.get('render-mode'),'partial');assert.match(g.options.headers.Accept,/text\/vnd\.reddit\.partial\+html/);assert.equal(g.options.credentials,'include');
 const next=await b.send({action:'raffle-tree',postId:'post1',subreddit:'Alpha',loader:r.loaders[0]});assert.deepEqual(next.entries.map(e=>e.id),['c1']);
 const p=b.calls[1];assert.equal(p.options.method,'POST');assert.equal(p.url.pathname,'/svc/shreddit/more-comments/r/Alpha/t3_post1');assert.equal(String(p.options.body),'cursor=CUR1&csrf_token=TOKEN123');assert.equal(p.options.headers['Content-Type'],'application/x-www-form-urlencoded');
 const long=await b.send({action:'raffle-tree',postId:'post1',subreddit:'Alpha',loader:{src:'/svc/shreddit/more-comments/r/Alpha/t3_post1?top-level=1',cursor:'x'.repeat(30000)}});assert.equal(long.ok,true,'long cursors from deep pages are followed');
 for(const bad of [{src:'https://evil.test/x',cursor:'a'},{src:'/svc/shreddit/more-comments/r/Alpha/t3_post1?top-level=1',cursor:'x'.repeat(200001)},{src:'/svc/shreddit/more-comments/r/Alpha/t3_other?top-level=1',cursor:'a'},{src:'/svc/shreddit/more-comments/r/Beta/t3_post1?top-level=1',cursor:'a'},{src:'/svc/shreddit/more-comments/r/Alpha/t3_post1?top-level=1',cursor:''}])assert.equal((await b.send({action:'raffle-tree',postId:'post1',subreddit:'Alpha',loader:bad})).ok,false,JSON.stringify(bad));
 assert.equal((await b.send({action:'raffle-tree',postId:'post1',subreddit:'a/b',loader:null})).ok,false);
 assert.equal(b.calls.length,3,'invalid loaders and names are refused before any request');
});
test('bridge raffle-tree reports Reddit’s rate limit instead of failing',async t=>{
 const b=bridge(t,{body:()=>({status:429,headers:{'retry-after':'12'}})});const r=await b.send({action:'raffle-tree',postId:'post1',subreddit:'Alpha',loader:null});assert.equal(r.rateLimited,true);assert.equal(r.retryAfterMs,12000);
});
test('bridge account facts: suspended, missing, invalid names and profile picture',async t=>{
 const b=bridge(t,{body:u=>u.pathname.includes('Gone')?{status:404}:u.pathname.includes('Banned')?{data:{is_suspended:true}}:{data:{created_utc:1600000000,comment_karma:10,link_karma:5,icon_img:'https://styles.redditmedia.com/t5_x/icon.png?width=256&amp;s=abc',snoovatar_img:''}}});
 const ok=await b.send({action:'raffle-user',username:'Alice'});assert.deepEqual([ok.created,ok.commentKarma,ok.postKarma],[1600000000,10,5]);assert.equal(ok.avatar,'https://styles.redditmedia.com/t5_x/icon.png?width=256&s=abc');
 assert.equal((await b.send({action:'raffle-user',username:'Gone'})).unavailable,true);assert.equal((await b.send({action:'raffle-user',username:'Banned'})).suspended,true);
 assert.equal((await b.send({action:'raffle-user',username:'a/b'})).ok,false);assert.equal(b.calls.length,3);
});
