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
const noRaffle=m=>m.action==='status'?{ok:true,exists:false}:{ok:true,signedIn:''};
async function ui(t,{url='https://www.reddit.com/r/Alpha/',thread,tree,users={},settings={raffles:true},narrow=false,chat=args=>args.action==='chat-status'?{ready:true}:{sent:true},raffler=noRaffle}={}){
 const dom=new JSDOM(page(),{url,runScripts:'outside-only',pretendToBeVisual:true}),W=dom.window,calls=[];let r;
 t.after(()=>{r?.destroy();W.close();});
 W.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};W.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
 const media={matches:narrow,listeners:[],addEventListener(type,fn){this.listeners.push(fn);},removeEventListener(){}};
 W.matchMedia=q=>/max-width/.test(q)?media:{matches:false,addEventListener(){},removeEventListener(){}};W.CSS={escape:v=>String(v).replace(/"/g,'\\"')};
 for(const file of ['post-model.js','raffle-model.js','raffle-ui.js'])W.eval(read(file));
 let current=settings;
 const readFn=async args=>{calls.push(args);
  if(args.action==='raffle-thread')return thread?thread(args):{post:{author:'Owner',subreddit:'Alpha'},entries:[comment('a1','Alice',{body:'First line\nSecond line '+'x'.repeat(200)}),comment('b1','Bob'),comment('o1','Owner')],missingTopLevel:[],missingReplies:0};
  if(args.action==='raffle-tree')return tree(args,calls.filter(c=>c.action==='raffle-tree').length);
  if(args.action==='raffle-user'){const u=users[args.username];if(u instanceof Error)throw u;return u ?? {userId:'id'+args.username.toLowerCase(),created:0,commentKarma:1000,postKarma:1000,avatar:'https://styles.redditmedia.com/'+args.username+'.png'};}
  if(/^chat-/.test(args.action))return chat(args,calls.filter(c=>c.action===args.action).length);
  throw Error('Unexpected '+args.action);};
 const rafflerCalls=[];r=new W.RTRaffle.Raffle({observe:false,read:readFn,readSettings:async()=>current,random:()=>0,raffler:async m=>{rafflerCalls.push(m);return raffler(m,rafflerCalls);}});await r.ready;await flush();
 const D=W.document,q=sel=>D.querySelector(sel);
 const visible=slot=>q('[data-rt-raffle] [slot="'+slot+'"]:not([hidden])');
 return {W,D,r,calls,rafflerCalls,media,q,setSettings:async v=>{current=v;await r.loadSettings();},item:()=>q('[data-rt-raffle="item"]'),dialog:()=>q('[data-rt-raffle="dialog"]'),
  status:()=>q('.rt-raffle-status').textContent,note:()=>q('.rt-raffle-footnote').textContent,primary:()=>visible('primary-button'),secondary:()=>visible('secondary-button'),tertiary:()=>visible('tertiary-button:not(.rt-raffle-footnote)') || [...D.querySelectorAll('[data-rt-raffle] [slot="tertiary-button"]:not([hidden])')].find(e=>e.tagName==='BUTTON'),
  publicSub:()=>q('.rt-raffle-option[data-rt-mode="public"] .rt-raffle-option-state').textContent,mode:v=>{const radio=q('input[name="rt-raffle-draw"][value="'+v+'"]');radio.checked=true;radio.dispatchEvent(new W.Event('change'));},
  input:(name,value)=>{const el=q('[name="'+name+'"]');el.value=value;el.dispatchEvent(new W.Event('input',{bubbles:true}));},
  open:async()=>{q('[data-rt-raffle="item"] [role="menuitem"]').click();await flush();}};
}
const privateDraw=async(s,winners='1')=>{s.mode('private');if(winners!=='1')s.input('winners',winners);s.primary().click();await flush();};
test('every post menu gets one “Run a raffle” item in its action slot, with Reddit’s menu-item markup',async t=>{
 const s=await ui(t);const item=s.item();assert.ok(item);assert.equal(item.parentElement.getAttribute('slot'),'devvit-context-actions');
 assert.equal(item.getAttribute('role'),'presentation');const row=item.querySelector('[role="menuitem"]');assert.match(row.className,/px-md gap-xs text-secondary-plain/);assert.equal(row.querySelector('.text-body-2').textContent,'Run a raffle');
 s.r.sync();s.r.sync();assert.equal(s.D.querySelectorAll('[data-rt-raffle="item"]').length,1);
 await s.setSettings({raffles:false});assert.equal(s.item(),null);
});
test('a failed settings read keeps raffles on and retries; the item is ensured as ⋯ is pressed; a created slot has no role',async t=>{
 let reads=0;const dom=new JSDOM(page().replace('<div slot="devvit-context-actions" role="menuitem"></div>',''),{url:'https://www.reddit.com/r/Alpha/',runScripts:'outside-only',pretendToBeVisual:true}),W=dom.window;let r;t.after(()=>{r?.destroy();W.close();});
 for(const file of ['post-model.js','raffle-model.js','raffle-ui.js'])W.eval(read(file));
 r=new W.RTRaffle.Raffle({observe:false,read:async()=>({}),raffler:noRaffle,readSettings:async()=>{reads++;if(reads===1)throw Error('worker asleep');return {raffles:false};}});await r.ready;await flush();
 const item=W.document.querySelector('[data-rt-raffle="item"]');assert.ok(item,'default on while settings are unknown');assert.equal(item.parentElement.hasAttribute('role'),false,'no menuitem inside a menuitem');
 await new Promise(res=>setTimeout(res,1100));await flush();assert.equal(reads,2,'retried');assert.equal(W.document.querySelector('[data-rt-raffle="item"]'),null,'the real setting applies once read');
 const s2=await ui(t);s2.item().remove();s2.D.querySelector('button[aria-haspopup]').dispatchEvent(new s2.W.Event('pointerdown',{bubbles:true,composed:true}));assert.ok(s2.item(),'re-added as the ⋯ button is pressed');
});
test('opening a post’s ⋯ menu shows its Reddit Raffler status on the item, checked once per post',async t=>{
 const s=await ui(t,{raffler:m=>m.action==='status'?{ok:true,exists:true,raffle:{verified:true}}:{ok:true,signedIn:''}});
 const press=()=>s.D.querySelector('button[aria-haspopup]').dispatchEvent(new s.W.Event('pointerdown',{bubbles:true,composed:true}));
 press();await flush();
 assert.equal(s.item().querySelector('.text-body-2').textContent,'View raffle results');assert.equal(s.item().querySelector('.text-caption-1').textContent,'Drawn on Reddit Raffler · verified');assert.equal(s.item().dataset.rtRaffleState,'drawn');
 press();await flush();assert.equal(s.rafflerCalls.filter(c=>c.action==='status').length,1,'cached per post');
 const none=await ui(t);none.D.querySelector('button[aria-haspopup]').dispatchEvent(new none.W.Event('pointerdown',{bubbles:true,composed:true}));await flush();
 assert.equal(none.item().querySelector('.text-body-2').textContent,'Run a raffle');assert.equal(none.item().dataset.rtRaffleState,'none');
});
test('the rules screen offers a public or a private draw, focuses the heading and keeps one main action',async t=>{
 const s=await ui(t);const trigger=s.D.querySelector('button[aria-haspopup]');let menuClicks=0;trigger.addEventListener('click',()=>{menuClicks++;trigger.setAttribute('aria-expanded','false');});
 await s.open();
 assert.equal(menuClicks,1);assert.ok(s.dialog().hasAttribute('open'));assert.equal(s.dialog().querySelector('rpl-modal-card').getAttribute('appearance'),'modal');
 assert.equal(s.D.activeElement?.id,'rt-raffle-title','focus starts on the heading, not a field');
 assert.deepEqual([...s.D.querySelectorAll('.rt-raffle-option-title')].map(e=>e.textContent),['Public draw','Private draw']);
 assert.match(s.q('.rt-raffle-option[data-rt-mode="public"] .rt-raffle-option-caption').textContent,/anyone can check · one per post · can’t be redone/);
 assert.equal(s.q('input[name="rt-raffle-draw"][value="public"]').checked,true);assert.equal(s.primary().textContent,'Run public draw');
 assert.equal(s.secondary(),null,'no Cancel: the close button does that');assert.match(s.status(),/^Up to 2 people can enter · Reddit Raffler reads the comments itself and disqualifies anyone with more than one$/);
 assert.equal(s.publicSub(),'As a guest (unverified). Sign in at redditraffler.com to have it verified.');
 s.mode('private');assert.equal(s.primary().textContent,'Draw privately');assert.equal(s.status(),'2 people can win');
 assert.equal(s.q('.rt-raffle-option[data-rt-mode="private"]').dataset.selected,'true');
});
test('the winners stepper respects its bounds and warns when asking for more winners than people',async t=>{
 const s=await ui(t);await s.open();s.mode('private');
 assert.equal(s.q('[aria-label="Fewer winners"]').disabled,true);s.input('winners','5');
 assert.equal(s.q('[data-rt-row="winners"] .rt-raffle-row-caption').textContent,'Only 2 people can win');assert.equal(s.q('[data-rt-row="winners"] .rt-raffle-row-caption').dataset.error,'true');
 s.input('winners','abc');assert.equal(s.primary().disabled,true);assert.equal(s.q('[data-rt-row="winners"] .rt-raffle-row-caption').textContent,'Enter a number from 1 to 100');
 s.input('winners','100');assert.equal(s.q('[aria-label="More winners"]').disabled,true);
});
test('a private draw moves to a separate Winners screen of Reddit-style rows with clear actions',async t=>{
 const s=await ui(t);await s.open();await privateDraw(s,'2');
 assert.equal(s.q('[data-rt-raffle-view="rules"]').hidden,true);assert.equal(s.q('#rt-raffle-title').textContent,'Winners');
 assert.equal(s.primary().textContent,'Message winners');assert.equal(s.secondary().textContent,'Draw again');assert.equal(s.tertiary().textContent,'Back to rules');
 assert.equal(s.q('.rt-raffle-banner-title').textContent,'2 winners');assert.equal(s.q('.rt-raffle-badge').textContent,'Private draw · not recorded');assert.match(s.q('.rt-raffle-banner-meta').textContent,/^From 2 eligible people · /);
 const alice=s.q('.rt-raffle-winner[data-rt-winner="Alice"]');
 assert.equal(alice.querySelector('.rt-raffle-cover').getAttribute('href'),'https://www.reddit.com/r/Alpha/comments/post1/x/a1/');assert.match(alice.querySelector('.rt-raffle-cover').getAttribute('aria-label'),/opens in a new tab/);
 assert.equal(alice.querySelector('.rt-raffle-rank').getAttribute('aria-hidden'),'true');
 const excerpt=alice.querySelector('.rt-raffle-excerpt'),more=alice.querySelector('.rt-raffle-more');assert.equal(more.hidden,false);more.click();assert.equal(excerpt.dataset.rtClamped,'false');assert.equal(more.getAttribute('aria-expanded'),'true');
 assert.equal(alice.querySelector('img').getAttribute('src'),'https://styles.redditmedia.com/Alice.png');
 assert.match(s.q('[data-rt-raffle-view="results"]').dataset.markdown,/Private draw, not recorded\.$/);
 s.tertiary().click();assert.equal(s.q('[data-rt-raffle-view="rules"]').hidden,false);
});
test('Draw again asks first and the results say which draw it is',async t=>{
 const s=await ui(t);await s.open();await privateDraw(s);
 s.secondary().click();await flush();assert.equal(s.secondary().textContent,'Confirm: replace these winners');assert.match(s.note(),/replaces these winners.*draw 2/);
 s.secondary().click();await flush();assert.match(s.q('.rt-raffle-banner-meta').textContent,/· draw 2/);assert.match(s.q('[data-rt-raffle-view="results"]').dataset.markdown,/Draw 2 \(private, not recorded\)\.$/);
});
test('private results aren’t thrown away by a stray click: the backdrop is ignored and closing asks first',async t=>{
 const s=await ui(t);await s.open();await privateDraw(s);
 s.dialog().dispatchEvent(new s.W.MouseEvent('click',{bubbles:true}));assert.ok(s.dialog(),'backdrop click ignored with results on screen');
 s.q('[data-rt-raffle] [slot="close-button"]').click();assert.ok(s.dialog());assert.match(s.note(),/aren’t saved anywhere/);
 s.q('[data-rt-raffle] [slot="close-button"]').click();assert.equal(s.dialog(),null);
});
test('from any page, comments past the JSON are read with Reddit’s own client requests until the chain ends',async t=>{
 const L=(n,top=true)=>({src:'/svc/shreddit/more-comments/r/Alpha/t3_post1?top-level='+(top?1:0)+'&n='+n,cursor:'c'+n,topLevel:top});
 const s=await ui(t,{thread:()=>({post:{author:'Owner',subreddit:'Alpha'},entries:[comment('a1','Alice')],missingTopLevel:['c1','c2','c3'],missingReplies:0}),
  tree:(args,n)=>n===1?{entries:[comment('a1','Alice',{avatar:'https://www.redditstatic.com/a.png'}),comment('c1','Carol')],loaders:[L(1),L(9,false)]}:{entries:[comment('c2','Dan'),comment('c3','Eve')],loaders:[]}});
 await s.open();
 const trees=s.calls.filter(c=>c.action==='raffle-tree');assert.equal(trees.length,2);assert.equal(trees[0].loader,null);assert.equal(trees[0].subreddit,'Alpha');assert.equal(trees[1].loader.cursor,'c1');
 assert.ok(!trees.some(c=>c.loader?.cursor==='c9'),'reply loaders are skipped in top-level mode');
 s.mode('private');assert.equal(s.status(),'4 people can win');assert.equal(s.q('.rt-raffle-ack').hidden,true);
});
test('“more replies” threads are followed only when replies count as entries',async t=>{
 const L=(n,top)=>({src:'/svc/shreddit/more-comments/r/Alpha/t3_post1?x='+n,cursor:'c'+n,topLevel:top});
 const s=await ui(t,{thread:()=>({post:{author:'Owner',subreddit:'Alpha'},entries:[comment('a1','Alice')],missingTopLevel:[],missingReplies:3}),
  tree:(args,n)=>!args.loader?{entries:[],loaders:[L(1,false),L(2,false)]}:{entries:[comment('r'+args.loader.cursor,'Replier'+args.loader.cursor,{parent_id:'t1_a1'})],loaders:[]}});
 await s.open();assert.equal(s.calls.filter(c=>c.action==='raffle-tree').length,0,'top-level only: no reply reads');
 s.mode('private');const box=s.q('[name="topLevelOnly"]');box.checked=false;box.dispatchEvent(new s.W.Event('input',{bubbles:true}));await flush();
 assert.equal(s.calls.filter(c=>c.action==='raffle-tree').length,3);assert.equal(s.status(),'3 people can win');
 assert.match(s.r.coverageText(),/Read all 1 top-level comment and 2 replies$/);
});
test('the placeholder list is not the expected count: a finished chain is complete even with fewer top-level comments',async t=>{
 const s=await ui(t,{thread:()=>({post:{author:'Owner',subreddit:'Alpha',numComments:40},entries:[comment('a1','Alice'),comment('b1','Bob')],missingTopLevel:['c1','x1','x2','x3'],missingReplies:0}),tree:()=>({entries:[comment('c1','Carol')],loaders:[]})});
 await s.open();s.mode('private');
 assert.equal(s.status(),'3 people can win');assert.equal(s.primary().disabled,false);assert.equal(s.q('.rt-raffle-ack').hidden,true);
 assert.equal(s.r.coverageText(),'Read all 3 top-level comments (40 in the thread, counting replies)');
});
test('a chain cut short keeps what was read, says why and needs an explicit tick before a private draw',async t=>{
 const L={src:'/svc/shreddit/more-comments/r/Alpha/t3_post1?top-level=1',cursor:'c1',topLevel:true};
 const s=await ui(t,{thread:()=>({post:{author:'Owner',subreddit:'Alpha'},entries:[comment('a1','Alice'),comment('b1','Bob')],missingTopLevel:['c1'],missingReplies:0}),
  tree:(args,n)=>{if(n===1)return {entries:[comment('c1','Carol')],loaders:[L]};throw Error('Reddit could not load the comments (HTTP 500).');}});
 await s.open();s.mode('private');
 assert.equal(s.status(),'3 people can win · Read 3 top-level comments · Reddit stopped answering (Reddit could not load the comments (HTTP 500)), so some may be missing');
 assert.equal(s.primary().disabled,true);assert.equal(s.q('.rt-raffle-status-card').dataset.state,'warning');
 const ack=s.q('.rt-raffle-ack');assert.equal(ack.hidden,false);assert.equal(ack.querySelector('input').type,'checkbox');ack.querySelector('input').checked=true;ack.querySelector('input').dispatchEvent(new s.W.Event('change'));
 assert.equal(s.primary().disabled,false);
});
test('account rules look up only reached users and report skips; failures never win',async t=>{
 const s=await ui(t,{users:{Alice:Error('HTTP 500'),Bob:{suspended:true}}});
 await s.open();s.mode('private');s.input('minAccountAgeDays','30');
 assert.equal(s.status(),'2 people can win · Account minimums are checked during the draw');assert.equal(s.q('.rt-raffle-account .rt-raffle-row-caption').textContent,'At least 30 days old');
 s.primary().click();await flush();
 assert.equal(s.D.querySelectorAll('.rt-raffle-winner').length,0);assert.equal(s.q('.rt-raffle-banner-title').textContent,'0 winners');
 assert.match(s.q('.rt-raffle-facts').textContent,/Skipped during the draw: (1 couldn’t be checked, 1 suspended|1 suspended, 1 couldn’t be checked)/);
});
const toMessage=async s=>{await s.open();await privateDraw(s,'2');s.primary().click();await flush();};
test('Message winners: separate chats need a second confirmation (warned beside the button), then send one each',async t=>{
 const sent=[];const s=await ui(t,{chat:args=>{if(args.action==='chat-status')return {ready:true};sent.push(args);return args.userId==='idbob'?{sent:false,reason:'Reddit refused the chat.'}:{sent:true,existing:true};}});
 await toMessage(s);
 assert.equal(s.q('#rt-raffle-title').textContent,'Message winners');assert.deepEqual([...s.D.querySelectorAll('.rt-raffle-person-name')].map(e=>e.textContent).sort(),['u/Alice','u/Bob']);
 const send=s.primary();assert.equal(send.textContent,'Send to 2 people');
 assert.match(s.q('.rt-raffle-preview').textContent,/^Congratulations u\/(Alice|Bob)! You won the raffle on this post: https:\/\/www\.reddit\.com\/r\/Alpha\/comments\/post1\/giveaway\/$/);
 assert.ok(s.q('.rt-raffle-textarea').getAttribute('aria-describedby'),'the placeholder hint describes the message field');
 send.click();await flush();assert.equal(sent.length,0,'the first click only asks for confirmation');assert.equal(send.textContent,'Confirm: send 2 messages');assert.match(s.note(),/can’t be unsent/);
 assert.equal(s.q('.rt-raffle-footnote').getAttribute('slot'),'tertiary-button','the warning sits in the footer, beside the button');
 send.click();await flush();await new Promise(r=>setTimeout(r,1700));await flush();
 assert.equal(sent.length,2);assert.deepEqual(sent.map(a=>a.userId).sort(),['idalice','idbob']);
 const state=name=>s.q('[data-rt-recipient="'+name+'"] .rt-raffle-person-state');
 assert.equal(state('Alice').textContent,'Sent in your existing chat');assert.equal(state('Bob').dataset.state,'failed');
 assert.match(s.note(),/^Sent to 1 of 2 people\. 1 failed\./);
 assert.equal(send.textContent,'Send to the remaining 1');send.click();send.click();await flush();
 assert.equal(sent.length,3);assert.equal(sent[2].userId,'idbob','a retry goes only to people not reached');
});
test('Message winners: people can be removed, added back, or added by username; only the “Sending to” list is messaged',async t=>{
 const sent=[];const s=await ui(t,{chat:args=>{if(args.action==='chat-status')return {ready:true};sent.push(args);return {sent:true};}});
 await toMessage(s);
 const names=sel=>[...s.D.querySelectorAll(sel+' .rt-raffle-person-name')].map(e=>e.textContent).sort();
 s.q('[aria-label="Remove u/Bob"]').click();
 assert.deepEqual(names('[aria-label="Recipients"]'),['u/Alice']);assert.deepEqual(names('.rt-raffle-people-out'),['u/Bob']);assert.equal(s.primary().textContent,'Send to 1 person');
 const add=s.q('[aria-label="Add someone by username"]');add.value='bad name!';s.q('.rt-raffle-add button').click();assert.equal(s.q('.rt-raffle-add+.rt-raffle-row-caption').textContent,'Enter a Reddit username');
 add.value='u/Carol';s.q('.rt-raffle-add button').click();await flush();
 assert.deepEqual(names('[aria-label="Recipients"]'),['u/Alice','u/Carol']);
 s.q('[aria-label="Add u/Bob"]').click();assert.deepEqual(names('[aria-label="Recipients"]'),['u/Alice','u/Bob','u/Carol']);
 s.q('[aria-label="Remove u/Alice"]').click();
 s.primary().click();s.primary().click();await flush();await new Promise(r=>setTimeout(r,1700));await flush();
 assert.deepEqual(sent.map(a=>a.userId).sort(),['idbob','idcarol']);assert.ok(sent.find(a=>a.userId==='idcarol').text.includes('u/Carol'));
});
test('Message winners: one group chat sends once with every winner named',async t=>{
 const calls=[];const s=await ui(t,{chat:args=>{if(args.action==='chat-status')return {ready:true};calls.push(args);return {sent:true,failedInvites:[]};}});
 await toMessage(s);
 const group=s.q('input[name="rt-raffle-mode"][value="group"]');group.checked=true;group.dispatchEvent(new s.W.Event('change'));
 assert.equal(s.primary().textContent,'Start group chat');assert.equal(s.q('[data-rt-field="group-name"]').value,'Raffle: Giveaway');
 s.primary().click();s.primary().click();await flush();
 assert.equal(calls.length,1);assert.equal(calls[0].action,'chat-group');assert.deepEqual([...calls[0].userIds].sort(),['idalice','idbob']);assert.match(calls[0].text,/^Congratulations u\/\w+, u\/\w+!/);
 assert.match(s.note(),/^Group chat started with 2 winners\./);assert.equal(s.primary().disabled,true);
});
test('Message winners stops cleanly when Reddit chat is unavailable or rate-limits new chats',async t=>{
 const off=await ui(t,{chat:()=>({ready:false})});await toMessage(off);off.primary().click();off.primary().click();await flush();
 assert.match(off.note(),/Reddit chat isn’t available/);assert.equal(off.calls.filter(c=>c.action==='chat-send').length,0);
 const limited=await ui(t,{chat:(args,n)=>args.action==='chat-status'?{ready:true}:{sent:false,rateLimited:true,reason:'Reddit limits how many new chats you can start. Try the rest later.'}});
 await toMessage(limited);limited.primary().click();limited.primary().click();await flush();
 assert.equal(limited.calls.filter(c=>c.action==='chat-send').length,1,'no further sends after a rate limit');
 assert.equal(limited.D.querySelectorAll('.rt-raffle-person-state[data-state="skipped"]').length,1);
});
test('Escape and the close button close the rules screen, abort reading and return focus',async t=>{
 let release;const s=await ui(t,{thread:()=>new Promise(r=>release=r)});const trigger=s.D.querySelector('button[aria-haspopup]');
 for(const how of ['close','escape']){
  await s.open();const d=s.dialog();assert.ok(d);
  if(how==='close')d.querySelector('[slot="close-button"]').click();else d.dispatchEvent(new s.W.Event('cancel',{cancelable:true}));
  assert.equal(s.dialog(),null,how);assert.equal(s.D.activeElement,trigger,how);
 }
 release({post:{},entries:[],missingTopLevel:[]});await flush();assert.equal(s.dialog(),null,'a late answer for a closed dialog renders nothing');
});
test('phone ↔ desktop follows the screen: Reddit’s bottom sheet below 640 px, switched live',async t=>{
 const s=await ui(t,{narrow:true});await s.open();const card=s.dialog().querySelector('rpl-modal-card');
 assert.equal(card.getAttribute('appearance'),'bottom-sheet');assert.ok(s.dialog().classList.contains('rt-raffle-sheet'));
 s.media.matches=false;for(const fn of s.media.listeners)fn();assert.equal(card.getAttribute('appearance'),'modal');assert.equal(s.dialog().classList.contains('rt-raffle-sheet'),false);
});

// --- Bridge
function bridge(t,{url='https://www.reddit.com/r/Alpha/',body,html,cookie=''}={}){
 const dom=new JSDOM(html || '<body></body>',{url,runScripts:'outside-only'}),W=dom.window,calls=[];t.after(()=>W.close());W.AbortController=AbortController;
 if(cookie)W.document.cookie=cookie;
 W.fetch=async(href,options)=>{const u=new URL(href);calls.push({url:u,options});const value=body(u,options);return {ok:(value?.status ?? 200)===200,status:value?.status ?? 200,headers:new Headers(value?.headers || {}),text:async()=>typeof value?.text==='string'?value.text:JSON.stringify(value)};};
 for(const file of ['post-model.js','post-page-bridge.js'])W.eval(read(file));
 const send=input=>new Promise(resolve=>{const id=crypto.randomUUID(),listener=event=>{const result=JSON.parse(event.detail);if(result.id!==id)return;W.document.removeEventListener('rt-post-response',listener);resolve(result);};W.document.addEventListener('rt-post-response',listener);W.document.dispatchEvent(new W.CustomEvent('rt-post-request',{detail:JSON.stringify({channel:'raffle-test',id,...input})}));});
 return {calls,send,window:W};
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

test('bridge chat actions use Reddit’s chat client, reuse existing chats and only message resolved winners',async t=>{
 const calls=[];
 const client={getUserId:()=>'@t2_me:reddit.com',getSyncState:()=>'SYNCING',makeTxnId:()=>'txn',rooms:new Set(['!old:reddit.com']),getRoom(id){return this.rooms.has(id)?{roomId:id}:null;},on(){},off(){},
  async getRoomList(q){calls.push(['getRoomList',q.with_user,q.type]);return {rooms:q.with_user==='@t2_aaa:reddit.com'?[{room_id:'!old:reddit.com'}]:[]};},
  async createRoom(o){calls.push(['createRoom',o.preset,o.invite.join(','),o.name || '']);const id='!new'+calls.length+':reddit.com';this.rooms.add(id);return {room_id:id};},
  async invite(room,user){calls.push(['invite',user]);},
  async sendTextMessage(room,thread,text,txn){calls.push(['send',room,thread,text,txn]);}};
 const b=bridge(t,{html:'<body><div id="host"></div></body>',body:u=>u.pathname.includes('Alice')?{data:{id:'aaa',created_utc:1}}:u.pathname.includes('Bob')?{data:{id:'bbb',created_utc:1}}:{data:{id:'ccc',created_utc:1}}});
 const W=b.window;const host=W.document.getElementById('host').attachShadow({mode:'open'});host.innerHTML='<rs-matrix-client></rs-matrix-client>';host.querySelector('rs-matrix-client').client=client;
 assert.deepEqual((({ready,syncing,self})=>({ready,syncing,self}))(await b.send({action:'chat-status'})),{ready:true,syncing:true,self:'me'});
 assert.equal((await b.send({action:'chat-send',userId:'aaa',text:'Hi'})).ok,false,'an account this page didn’t resolve can’t be messaged');
 for(const name of ['Alice','Bob','Carol'])await b.send({action:'raffle-user',username:name});
 const existing=await b.send({action:'chat-send',userId:'aaa',text:'Hello Alice'});assert.equal(existing.sent,true);assert.equal(existing.existing,true);
 const fresh=await b.send({action:'chat-send',userId:'bbb',text:'Hello Bob'});assert.equal(fresh.sent,true);assert.equal(fresh.existing,false);
 assert.deepEqual(calls.slice(0,5),[['getRoomList','@t2_aaa:reddit.com','direct'],['send','!old:reddit.com',null,'Hello Alice','txn'],['getRoomList','@t2_bbb:reddit.com','direct'],['createRoom','reddit_dm','@t2_bbb:reddit.com',''],['send','!new4:reddit.com',null,'Hello Bob','txn']]);
 const group=await b.send({action:'chat-group',userIds:['aaa','bbb','ccc'],name:'Raffle: Giveaway',text:'Congrats all'});assert.equal(group.sent,true);
 assert.deepEqual(calls.slice(5),[['createRoom','private_chat','@t2_aaa:reddit.com,@t2_bbb:reddit.com,@t2_ccc:reddit.com','Raffle: Giveaway'],['send','!new6:reddit.com',null,'Congrats all','txn']]);
 for(const bad of [{action:'chat-send',userId:'aaa',text:''},{action:'chat-send',userId:'aaa',text:'x'.repeat(10001)},{action:'chat-group',userIds:[],text:'x',name:''},{action:'chat-send',userId:'aaa',text:'x',url:'https://evil.test'}])assert.equal((await b.send(bad)).ok,false,JSON.stringify(bad).slice(0,60));
});
test('bridge chat reports Reddit’s new-chat limit and finds an existing room from Reddit’s error',async t=>{
 let mode='limit';
 const client={getUserId:()=>'@t2_me:reddit.com',makeTxnId:()=>'t',getRoom:()=>({}),on(){},off(){},async getRoomList(){return {rooms:[]};},
  async createRoom(){const e=Error('x');e.data=mode==='limit'?{errcode:'rate.score_room_creation_limit'}:{'com.reddit.existing_room_id':'!known:reddit.com'};throw e;},sent:[],async sendTextMessage(room){this.sent.push(room);}};
 const b=bridge(t,{html:'<body><rs-matrix-client></rs-matrix-client></body>',body:()=>({data:{id:'aaa'}})});b.window.document.querySelector('rs-matrix-client').client=client;
 await b.send({action:'raffle-user',username:'Alice'});
 const limited=await b.send({action:'chat-send',userId:'aaa',text:'Hi'});assert.equal(limited.sent,false);assert.equal(limited.rateLimited,true);
 mode='known';const known=await b.send({action:'chat-send',userId:'aaa',text:'Hi'});assert.equal(known.sent,true);assert.equal(known.existing,true);assert.deepEqual(client.sent,['!known:reddit.com']);
});

// --- Public draws on Reddit Raffler (§4b)
const officialRaffle=(extra={})=>({postId:'post1',url:'https://www.redditraffler.com/raffles/post1',verified:true,creator:'Owner',created:'November 15 2026, 1:07am',criteria:{minAge:30,minComment:0,minLink:0},ignored:['AutoModerator','Owner'],
 winners:[{username:'Alice',commentUrl:'https://reddit.com/r/Alpha/comments/post1/giveaway/a1/',commentId:'a1',accountAgeDays:243,commentKarma:5,linkKarma:1}],...extra});
test('public draw: says how it will be created, warns before confirming, sends Raffler’s fields and shows results with proof',async t=>{
 let polls=0;const s=await ui(t,{raffler:(m)=>{
  if(m.action==='session')return {ok:true,signedIn:'Owner'};
  if(m.action==='status')return polls<1?{ok:true,exists:false}:{ok:true,exists:true,raffle:officialRaffle()};
  if(m.action==='create')return {ok:true,queued:true};
  if(m.action==='job'){polls++;return {ok:true,status:'Done!',error:false};}}});
 await s.open();
 assert.equal(s.publicSub(),'You’re signed in there as u/Owner, so it’s marked verified.');
 s.input('minAccountAgeDays','30');
 s.primary().click();await flush();assert.equal(s.rafflerCalls.filter(c=>c.action==='create').length,0,'first click only confirms');
 assert.equal(s.primary().textContent,'Confirm public draw');assert.match(s.note(),/permanent public page on redditraffler\.com and can’t be redone/);
 s.input('winners','2');assert.equal(s.primary().textContent,'Run public draw','changing a rule clears the confirmation');s.input('winners','1');
 s.primary().click();s.primary().click();await flush();await new Promise(r=>setTimeout(r,1700));await flush();
 const create=s.rafflerCalls.find(c=>c.action==='create');assert.equal(create.postId,'post1');
 assert.deepEqual(JSON.parse(JSON.stringify(create.params)),{winnerCount:1,minAge:30,ignoredUsers:['AutoModerator','Owner'],minComment:0,minLink:0});
 assert.equal(s.q('[data-rt-raffle-view="results"]').hidden,false);
 const proof=s.q('.rt-raffle-proof');assert.equal(proof.getAttribute('href'),'https://www.redditraffler.com/raffles/post1');assert.match(proof.textContent,/^View proof/);assert.equal(proof.hasAttribute('aria-label'),false,'the visible text is the accessible name');
 assert.equal(s.q('.rt-raffle-badge').textContent,'Verified public raffle');assert.match(s.q('.rt-raffle-banner-meta').textContent,/^Drawn by Reddit Raffler · .*2026.* · created by u\/Owner$/);
 const row=s.q('.rt-raffle-winner[data-rt-winner="Alice"]');assert.match(row.querySelector('.rt-raffle-excerpt').textContent,/^First line/);assert.match(row.textContent,/243-day account/);
 assert.equal(s.secondary(),null,'no Draw again for a public draw');assert.equal(s.primary().textContent,'Message winners');
 assert.match(s.q('[data-rt-raffle-view="results"]').dataset.markdown,/Proof: https:\/\/www\.redditraffler\.com\/raffles\/post1$/);
});
test('a post that already has a public raffle opens on its results; drawing privately is a deliberate second step',async t=>{
 const s=await ui(t,{raffler:m=>m.action==='status'?{ok:true,exists:true,raffle:officialRaffle({verified:false,creator:''})}:{ok:true,signedIn:''}});
 await s.open();
 assert.equal(s.q('#rt-raffle-title').textContent,'Winners');assert.equal(s.q('.rt-raffle-badge').textContent,'Public raffle');assert.match(s.q('.rt-raffle-banner-meta').textContent,/created by a guest$/);
 assert.equal(s.rafflerCalls.filter(c=>c.action==='create').length,0);
 assert.equal(s.tertiary().textContent,'Draw privately anyway');s.tertiary().click();
 assert.equal(s.q('input[name="rt-raffle-draw"][value="private"]').checked,true);assert.equal(s.publicSub(),'This post already has a public raffle. View its results here.');
 s.mode('public');assert.equal(s.primary().textContent,'View public results','the public results stay one click away');s.primary().click();assert.equal(s.q('#rt-raffle-title').textContent,'Winners');
});
test('public mode disables rules Reddit Raffler can’t follow, with the reason beside them',async t=>{
 const s=await ui(t);await s.open();
 const must=s.q('[data-rt-row="mustInclude"]');assert.equal(must.dataset.unsupported,'true');assert.equal(must.querySelector('input').disabled,true);assert.equal(must.querySelector('.rt-raffle-row-caption').textContent,'Private draw only');
 assert.equal(s.q('[data-rt-row="topLevelOnly"] .rt-raffle-row-caption').textContent,'Reddit Raffler only counts top-level comments');
 s.input('minTotalKarma','100');s.input('minCommentKarma','5');
 assert.equal(s.q('.rt-raffle-account .rt-raffle-row-caption').textContent,'Reddit Raffler takes total karma or comment and post karma, not both');assert.equal(s.primary().disabled,true);
 s.mode('private');assert.equal(s.q('[data-rt-row="mustInclude"] input').disabled,false);assert.equal(s.primary().disabled,false);
 s.input('mustInclude','line');s.mode('public');s.mode('private');assert.equal(s.q('[name="mustInclude"]').value,'line','switching modes keeps what was typed');assert.match(s.status(),/^1 person can win/);
});
test('Reddit Raffler down or refusing: private draw becomes the choice, with a plain explanation',async t=>{
 const down=await ui(t,{raffler:()=>{throw Error('Reddit Raffler is unreachable.');}});await down.open();
 assert.equal(down.q('input[name="rt-raffle-draw"][value="private"]').checked,true);assert.equal(down.q('input[name="rt-raffle-draw"][value="public"]').disabled,true);
 assert.equal(down.publicSub(),'Reddit Raffler isn’t responding. You can still draw privately. Try again');assert.ok(down.q('.rt-raffle-retry'));assert.equal(down.primary().textContent,'Draw privately');assert.equal(down.primary().disabled,false);
 const refused=await ui(t,{raffler:m=>{if(m.action==='create')throw Error('Reddit Raffler didn’t accept this raffle.');return noRaffle(m);}});await refused.open();
 refused.primary().click();refused.primary().click();await flush();assert.equal(refused.note(),'Reddit Raffler: Reddit Raffler didn’t accept this raffle.');assert.equal(refused.primary().disabled,false,'can try again');
});

// --- Raffler worker
const raffleCard=(name,id,days)=>`<div class="column is-4"> <div class="card"> <div class="card-content has-text-centered"> <p class="is-size-4 has-text-reddit"> /u/${name} </p> <p> <a class="reddit-button" href="https://reddit.com/u/${name}"><i class="fas fa-user"></i> Profile</a> </p> <p> <a class="reddit-button" href="https://reddit.com/r/Alpha/comments/post1/giveaway/${id}/"><i class="far fa-comment-alt"></i> Comment</a> </p> </div> <footer class="card-footer"> <p class="card-footer-item"> <i class="fas fa-birthday-cake fa-fw card-icon"></i> ${days} days </p> <p class="card-footer-item"> <i class="far fa-comments fa-fw card-icon"></i> 12 karma </p> <p class="card-footer-item"> <i class="fas fa-link fa-fw card-icon"></i> 3 karma </p> </footer> </div> </div>`;
const resultsPage=`<section class="hero"><p class="title has-text-light"> Raffle results for "<a href="https://redd.it/post1">Giveaway</a>" </p> <p id="subtitle" class="subtitle has-text-light"> Created by <a href="/users/Owner">/u/Owner</i></a> on November 15 2026, 1:07am UTC </p> <p> <span id="verified-tag" class="tag is-reddit is-rounded" aria-label="x"> Verified Raffle </span> </p></section><div class="has-text-centered"> <p class="is-size-3">30 <span class="is-size-5">day(s)</span></p> <p class="is-size-6">Minimum Account Age</p> </div><div class="has-text-centered"> <p class="is-size-3">0</p> <p class="is-size-6">Minimum Comment Karma</p> </div><div class="has-text-centered"> <p class="is-size-3">2</p> <p class="is-size-6">Ignored User(s)</p> <p> <span class="tag is-reddit is-rounded"> AutoModerator </span> <span class="tag is-reddit is-rounded"> Owner </span> </p></div>`+raffleCard('Alice','a1',243)+raffleCard('Bob','b1',9);
function rafflerWorker({responses,settings={raffles:true}}){
 let listener;const calls=[];
 const context=vm.createContext({URL,URLSearchParams,AbortController,setTimeout,clearTimeout,JSON,String,Number,Array,Set,Object,Error,Math,
  chrome:{runtime:{id:'own',onMessage:{addListener(fn){listener=fn;}}},storage:{local:{async get(){return {'rt-settings-v1':settings};}}}},
  fetch:async(url,init)=>{calls.push({url,init});const r=responses(url,init);return {status:r.status ?? 200,ok:(r.status ?? 200)<300,type:r.type || 'basic',headers:{get:()=>null},async text(){return r.text ?? '';}};}});
 vm.runInContext(read('post-model.js'),context);vm.runInContext(read('raffler-broker.js'),context);
 const send=(message,sender={})=>new Promise(resolve=>{const result=listener({scope:'rt-raffler',...message},{id:'own',frameId:0,url:'https://www.reddit.com/r/Alpha/',...sender},resolve);if(result!==true)resolve(undefined);});
 return {calls,send,broker:context.RTRafflerBroker};
}
test('Raffler worker parses the permanent results page',()=>{
 const {broker}=rafflerWorker({responses:()=>({})});const r=plain(broker.parseResults(resultsPage,'post1'));
 assert.equal(r.verified,true);assert.equal(r.creator,'Owner');assert.equal(r.created,'November 15 2026, 1:07am');assert.equal(r.url,'https://www.redditraffler.com/raffles/post1');
 assert.deepEqual(r.criteria,{minAge:30,minComment:0,ignoredCount:2});assert.deepEqual(r.ignored,['AutoModerator','Owner']);
 assert.deepEqual(r.winners[0],{username:'Alice',commentUrl:'https://reddit.com/r/Alpha/comments/post1/giveaway/a1/',commentId:'a1',accountAgeDays:243,commentKarma:12,linkKarma:3});assert.equal(r.winners.length,2);
 assert.throws(()=>broker.parseResults('<html>changed</html>','post1'),/changed/);assert.throws(()=>broker.parseResults(resultsPage,'other1'),/changed/);
 assert.equal(broker.signedInName('<a class="navbar-link"> Owner </a><a id="logout" class="navbar-item">'),'Owner');assert.equal(broker.signedInName('<a class="navbar-link"> Owner </a>'),'');
});
test('Raffler worker creates a raffle with the site’s own form fields and reads its progress',async()=>{
 const form='<a class="navbar-link"> Owner </a><a id="logout" class="navbar-item"> Log Out </a><input type="hidden" name="csrf_token" value="TOKEN-1234567890" />';
 let post={status:202,text:'{"url":"/raffles/post1/status"}'};
 const w=rafflerWorker({responses:(url,init)=>url.endsWith('/api/raffles/new')?post:url.endsWith('/raffles/new')?{text:form}:url.includes('job_status')?{text:'{"status":"Selecting winners...","error":false}'}:url.endsWith('/raffles/post1')?{text:resultsPage}:{status:404}});
 const params={winnerCount:2,minAge:30,minComment:0,minLink:5,ignoredUsers:['AutoModerator','Owner','bad name']};
 const created=await w.send({action:'create',postId:'post1',params});assert.equal(created.ok,true);assert.equal(created.queued,true);assert.equal(created.signedIn,'Owner');
 const postCall=w.calls.find(c=>c.url.endsWith('/api/raffles/new'));assert.equal(postCall.init.method,'POST');assert.equal(postCall.init.credentials,'include');assert.equal(postCall.init.redirect,'manual');
 assert.deepEqual(Object.fromEntries(new URLSearchParams(String(postCall.init.body))),{csrf_token:'TOKEN-1234567890',submissionUrl:'https://redd.it/post1',winnerCount:'2',minAge:'30',minComment:'0',minLink:'5',ignoredUsers:'["AutoModerator","Owner"]'});
 const combined=await w.send({action:'create',postId:'post1',params:{winnerCount:1,minAge:0,minCombined:100,ignoredUsers:[]}});assert.equal(combined.ok,true);
 assert.equal(new URLSearchParams(String(w.calls.filter(c=>c.url.endsWith('/api/raffles/new')).at(-1).init.body)).get('minCombined'),'100');
 post={status:0,type:'opaqueredirect'};assert.equal((await w.send({action:'create',postId:'post1',params})).exists,true,'303: the post already has a raffle');
 post={status:422,text:'{"message":"Form validation failed."}'};const refused=await w.send({action:'create',postId:'post1',params});assert.equal(refused.ok,false);assert.match(refused.error,/didn’t accept this raffle \(Form validation failed\)/);
 const job=await w.send({action:'job',postId:'post1'});assert.equal(job.status,'Selecting winners...');assert.equal(job.error,false);
 const status=await w.send({action:'status',postId:'post1'});assert.equal(status.exists,true);assert.equal(status.raffle.winners.length,2);
 assert.equal((await w.send({action:'status',postId:'none1'})).exists,false);
 for(const bad of [{action:'create',postId:'post1',params:{...params,winnerCount:101}},{action:'create',postId:'post1',params:{...params,minCombined:5}},{action:'status',postId:'../x'}])assert.equal((await w.send(bad)).ok,false,JSON.stringify(bad).slice(0,60));
 assert.equal((await w.send({action:'status',postId:'post1'},{url:'https://evil.test/'})).code,'forbidden');
 assert.equal((await rafflerWorker({responses:()=>({}),settings:{raffles:false}}).send({action:'status',postId:'post1'})).code,'disabled');
 assert.ok(w.calls.every(c=>c.url.startsWith('https://www.redditraffler.com/')),'only Raffler is contacted');
});
test('the Referer rule touches only the create request to Reddit Raffler',()=>{
 const [rule]=JSON.parse(read('raffler-referer-rules.json'));const re=new RegExp(rule.condition.regexFilter);
 assert.equal(rule.action.requestHeaders[0].value,'https://www.redditraffler.com/raffles/new');assert.deepEqual(rule.condition.requestMethods,['post']);
 assert.ok(re.test('https://www.redditraffler.com/api/raffles/new'));for(const url of ['https://www.redditraffler.com/api/raffles/new?x=1','https://www.redditraffler.com/raffles/new','https://evil.test/api/raffles/new'])assert.ok(!re.test(url),url);
 const manifest=JSON.parse(read('manifest.json'));assert.ok(manifest.host_permissions.includes('https://www.redditraffler.com/*'));assert.ok(manifest.declarative_net_request.rule_resources.some(r=>r.path==='raffler-referer-rules.json'));
});
