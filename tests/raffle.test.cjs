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
 assert.match(md,/^\*\*Raffle results\*\* \(1 of 12 eligible entrants, drawn 2023-11-14T22:13:20Z\)/);assert.match(md,/\d\. u\/Alice \(\[comment\]\(https:\/\/www\.reddit\.com\/c\/1\)\)/);assert.match(md,/Rules: top-level comments only, one entry per user, post author excluded, accounts at least 30 days old\./);
});

// --- UI
const page=(postId='post1')=>`<main><shreddit-post id="t3_${postId}" post-title="Giveaway" author="Owner" permalink="/r/Alpha/comments/${postId}/giveaway/"><shreddit-post-overflow-menu post-id="t3_${postId}" author-name="Owner" subreddit-prefixed-name="r/Alpha" permalink="/r/Alpha/comments/${postId}/giveaway/"><button aria-haspopup="menu" aria-expanded="true">⋯</button><div slot="devvit-context-actions" role="menuitem"></div></shreddit-post-overflow-menu></shreddit-post></main>`;
const noRaffle=m=>m.action==='status'?{ok:true,exists:false}:{ok:true,signedIn:''};
async function ui(t,{url='https://www.reddit.com/r/Alpha/',thread,tree,users={},settings={raffles:true},narrow=false,me='Owner',chat=args=>args.action==='chat-status'?{ready:true}:{sent:true},raffler=noRaffle}={}){
 const dom=new JSDOM(page(),{url,runScripts:'outside-only',pretendToBeVisual:true}),W=dom.window,calls=[];let r;
 t.after(()=>{r?.destroy();W.close();});
 W.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};W.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
 const media={matches:narrow,listeners:[],addEventListener(type,fn){this.listeners.push(fn);},removeEventListener(){}};
 W.matchMedia=q=>/max-width/.test(q)?media:{matches:false,addEventListener(){},removeEventListener(){}};W.CSS={escape:v=>String(v).replace(/"/g,'\\"')};
 for(const file of ['post-model.js','feed-filters.js','post-menu-dom.js','raffle-model.js','raffle-ui.js'])W.eval(read(file));
 let current=settings;
 const readFn=async args=>{calls.push(args);
  if(args.action==='raffle-me')return {username:me};
  if(args.action==='user-avatar')return {avatar:'https://styles.redditmedia.com/'+args.username+'-head.png'};
  if(args.action==='raffle-winner-comments')return {entries:args.ids.filter(id=>id==='a1').map(id=>comment(id,'Alice',{body:'First line\nSecond line '+ 'x'.repeat(200)}))};
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
  publicSub:()=>q('.rt-raffle-raffler-state').textContent,mode:v=>{const radio=q('input[name="rt-raffle-draw"][value="'+v+'"]');radio.checked=true;radio.dispatchEvent(new W.Event('change'));},
  input:(name,value)=>{const el=q('[name="'+name+'"]');el.value=value;el.dispatchEvent(new W.Event('input',{bubbles:true}));},
  open:async()=>{q('[data-rt-raffle="item"] [role="menuitem"]').click();
    for(let i=0;i<5 && !q('.rt-raffle-form');i++)await new Promise(resolve=>W.requestAnimationFrame(resolve));
    await flush();}};
}
const privateDraw=async(s,winners='1')=>{s.mode('private');if(winners!=='1')s.input('winners',winners);s.primary().click();await flush();};
const loadPrivate=async s=>{const previous=s.q('[name=winners]').value;s.mode('private');s.input('winners','100');s.primary().click();await flush();s.input('winners',previous);};
test('every post menu gets one “Run a raffle” item in its action slot, with Reddit’s menu-item markup',async t=>{
 const s=await ui(t);const item=s.item();assert.ok(item);assert.equal(item.parentElement.getAttribute('slot'),'devvit-context-actions');
 assert.equal(item.getAttribute('role'),'presentation');const row=item.querySelector('[role="menuitem"]');assert.match(row.className,/px-md gap-xs text-secondary-plain/);assert.equal(row.querySelector('.text-body-2').textContent,'Run a raffle');
 s.r.sync();s.r.sync();assert.equal(s.D.querySelectorAll('[data-rt-raffle="item"]').length,1);
 await s.setSettings({raffles:false});assert.equal(s.item(),null);
});
test('the phone bottom sheet keeps one raffle item and updates it with the menu item’s status',async t=>{
 const s=await ui(t,{raffler:m=>m.action==='status'?{ok:true,exists:true}:{ok:true,signedIn:''}}),D=s.D,item=s.item();
 const portal=D.createElement('div');portal.id='post-overflow-menu-bottom-sheet';portal.className='post-overflow-menu-bottom-sheet';
 const slot=(native=false)=>{const el=D.createElement('div');el.setAttribute('slot','devvit-context-actions');el.setAttribute('role','menuitem');if(native)el.innerHTML='<hr><shreddit-async-loader></shreddit-async-loader>';el.append(item.cloneNode(true));return el;};
 const native=slot(true),empty=slot();portal.append(native,empty,D.createElement('div'));D.body.append(portal);
 s.r.sync();assert.equal(portal.querySelectorAll('[data-rt-raffle="item"]').length,1,'one visible row in the copied sheet');
 assert.equal(portal.querySelector('[data-rt-raffle="item"]').closest('[slot]'),native,'the native action slot keeps the item');
 s.D.querySelector('button[aria-haspopup]').dispatchEvent(new s.W.Event('pointerdown',{bubbles:true,composed:true}));await flush();
 assert.equal(portal.querySelector('[data-rt-raffle="item"]').querySelector('.text-body-2').textContent,'View raffle results','the copied row gets the status too');
});
test('a failed settings read keeps raffles on and retries; the item is ensured as ⋯ is pressed; a created slot has no role',async t=>{
 let reads=0;const dom=new JSDOM(page().replace('<div slot="devvit-context-actions" role="menuitem"></div>',''),{url:'https://www.reddit.com/r/Alpha/',runScripts:'outside-only',pretendToBeVisual:true}),W=dom.window;let r;t.after(()=>{r?.destroy();W.close();});
 for(const file of ['post-model.js','feed-filters.js','raffle-model.js','raffle-ui.js'])W.eval(read(file));
 r=new W.RTRaffle.Raffle({observe:false,read:async()=>({}),raffler:noRaffle,readSettings:async()=>{reads++;if(reads===1)throw Error('worker asleep');return {raffles:false};}});await r.ready;await flush();
 const item=W.document.querySelector('[data-rt-raffle="item"]');assert.ok(item,'default on while settings are unknown');assert.equal(item.parentElement.hasAttribute('role'),false,'no menuitem inside a menuitem');
 await new Promise(res=>setTimeout(res,1100));await flush();assert.equal(reads,2,'retried');assert.equal(W.document.querySelector('[data-rt-raffle="item"]'),null,'the real setting applies once read');
 const s2=await ui(t);s2.item().remove();s2.D.querySelector('button[aria-haspopup]').dispatchEvent(new s2.W.Event('pointerdown',{bubbles:true,composed:true}));assert.ok(s2.item(),'re-added as the ⋯ button is pressed');
});
test('the ⋯ item is strictly single-line, shows Reddit’s skeleton until status is known, then the full wording',async t=>{
 const s=await ui(t,{raffler:m=>m.action==='status'?{ok:true,exists:true,raffle:{verified:true}}:{ok:true,signedIn:''}});
 const label=()=>s.item().querySelector('.text-body-2').textContent,row=()=>s.item().querySelector('[role="menuitem"]');
 // Unknown status: single-line skeleton matching native Reddit menu row height (no secondary subtitle).
 assert.equal(s.item().dataset.rtRaffleState,'loading');assert.equal(row().getAttribute('aria-busy'),'true');assert.equal(s.item().querySelector('.text-caption-1'),null,'strictly single-line row without subtitle');
 assert.equal(s.item().querySelector('.rt-raffle-menu-state'),null,'no pill');
 const press=()=>s.D.querySelector('button[aria-haspopup]').dispatchEvent(new s.W.Event('pointerdown',{bubbles:true,composed:true}));
 press();await flush();
 assert.equal(label(),'View raffle results');assert.equal(row().title,'Drawn on Reddit Raffler · verified');assert.equal(s.item().dataset.rtRaffleState,'drawn');assert.equal(row().hasAttribute('aria-busy'),false);
 press();await flush();assert.equal(s.rafflerCalls.filter(c=>c.action==='status').length,1,'cached per post');
 const none=await ui(t);none.D.querySelector('button[aria-haspopup]').dispatchEvent(new none.W.Event('pointerdown',{bubbles:true,composed:true}));await flush();
 assert.equal(none.item().querySelector('.text-body-2').textContent,'Run a raffle');assert.equal(none.item().querySelector('.text-caption-1'),null);assert.equal(none.item().dataset.rtRaffleState,'none');
 const down=await ui(t,{raffler:m=>{throw Error('unreachable');}});down.D.querySelector('button[aria-haspopup]').dispatchEvent(new down.W.Event('pointerdown',{bubbles:true,composed:true}));await flush();
 assert.equal(down.item().dataset.rtRaffleState,'none','a failed check falls back to Run a raffle, never a stuck skeleton');
 const css=read('post-discovery.css');assert.match(css,/\[data-rt-raffle-state="loading"\] :is\(\.text-body-2,\.text-caption-1\)\{[^}]*color:transparent/);assert.match(css,/\[data-rt-raffle-state="loading"\] :is\(\.text-body-2,\.text-caption-1\)::after\{[^}]*animation:rt-shimmer/);
 assert.doesNotMatch(css,/\[data-rt-raffle-state="loading"\][^{]*\{[^}]*margin/,'the skeleton never changes the item’s size');
});
test('hovering or focusing ⋯ fetches the status early, so a menu opened afterwards is drawn with it already in place',async t=>{
 const s=await ui(t,{raffler:m=>m.action==='status'?{ok:true,exists:true,raffle:{verified:false}}:{ok:true,signedIn:''}});
 const trigger=s.D.querySelector('button[aria-haspopup]');
 trigger.dispatchEvent(new s.W.Event('pointerover',{bubbles:true,composed:true}));await flush();assert.equal(s.rafflerCalls.filter(c=>c.action==='status').length,1,'prefetched on hover');
 trigger.dispatchEvent(new s.W.Event('pointerover',{bubbles:true,composed:true}));trigger.dispatchEvent(new s.W.FocusEvent('focusin',{bubbles:true,composed:true}));await flush();assert.equal(s.rafflerCalls.filter(c=>c.action==='status').length,1,'once per post');
 // Reddit redraws the menu: the new item starts with the final wording synchronously, with no skeleton or flash.
 s.item().remove();s.r.sync();assert.equal(s.item().dataset.rtRaffleState,'drawn');assert.equal(s.item().querySelector('.text-body-2').textContent,'View raffle results');assert.equal(s.item().querySelector('[role="menuitem"]').title,'Drawn on Reddit Raffler');
});
test('the rules screen offers a public or a private draw, focuses the heading and keeps one main action',async t=>{
 const s=await ui(t);const trigger=s.D.querySelector('button[aria-haspopup]');let menuClicks=0;trigger.addEventListener('click',()=>{menuClicks++;trigger.setAttribute('aria-expanded','false');});
 await s.open();
 assert.equal(menuClicks,1);assert.ok(s.dialog().hasAttribute('open'));assert.equal(s.dialog().querySelector('rpl-modal-card').getAttribute('appearance'),'modal');
 assert.equal(s.D.activeElement?.id,'rt-raffle-title','focus starts on the heading, not a field');
 assert.deepEqual([...s.D.querySelectorAll('.rt-raffle-option-title')].map(e=>e.textContent),['Public draw','Private draw']);
 assert.equal(s.q('.rt-raffle-option[data-rt-mode="public"] .rt-raffle-option-caption').textContent,'Results page anyone can check');assert.equal(s.q('.rt-raffle-option[data-rt-mode="private"] .rt-raffle-option-caption').textContent,'Only you see the winners');
 assert.equal(s.q('.rt-raffle-option .rt-raffle-option-state'),null,'the Raffler status sits under both cards, so they stay the same height');
 assert.equal(s.q('input[name="rt-raffle-draw"][value="public"]').checked,true);assert.equal(s.primary().textContent,'Run public draw');
 assert.equal(s.secondary(),null,'no Cancel: the close button does that');assert.match(s.status(),/^Public draw by Reddit Raffler/);assert.equal(s.calls.length,0);
 assert.equal(s.publicSub(),'As a guest (unverified). Sign in with Reddit');
 s.mode('private');assert.equal(s.primary().textContent,'Draw privately');assert.match(s.status(),/^Ready for a private draw/);assert.equal(s.calls.length,0);
 assert.equal(s.q('.rt-raffle-option[data-rt-mode="private"]').dataset.selected,'true');
});
test('the winners stepper respects its bounds and warns when asking for more winners than people',async t=>{
 const s=await ui(t);await s.open();s.mode('private');
 assert.equal(s.q('[aria-label="Fewer winners"]').disabled,true);s.input('winners','5');assert.equal(s.calls.length,0);s.primary().click();await flush();
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
 await s.open();await loadPrivate(s);
 const trees=s.calls.filter(c=>c.action==='raffle-tree');assert.equal(trees.length,2);assert.equal(trees[0].loader,null);assert.equal(trees[0].subreddit,'Alpha');assert.equal(trees[1].loader.cursor,'c1');
 assert.ok(!trees.some(c=>c.loader?.cursor==='c9'),'reply loaders are skipped in top-level mode');
 s.mode('private');assert.equal(s.status(),'4 people can win');assert.equal(s.q('.rt-raffle-ack').hidden,true);
});
test('“more replies” threads are followed only when replies count as entries',async t=>{
 const L=(n,top)=>({src:'/svc/shreddit/more-comments/r/Alpha/t3_post1?x='+n,cursor:'c'+n,topLevel:top});
 const s=await ui(t,{thread:()=>({post:{author:'Owner',subreddit:'Alpha'},entries:[comment('a1','Alice')],missingTopLevel:[],missingReplies:3}),
  tree:(args,n)=>!args.loader?{entries:[],loaders:[L(1,false),L(2,false)]}:{entries:[comment('r'+args.loader.cursor,'Replier'+args.loader.cursor,{parent_id:'t1_a1'})],loaders:[]}});
 await s.open();assert.equal(s.calls.filter(c=>c.action==='raffle-tree').length,0,'top-level only: no reply reads');
 s.mode('private');const box=s.q('[name="topLevelOnly"]');box.checked=false;box.dispatchEvent(new s.W.Event('input',{bubbles:true}));await flush();assert.equal(s.calls.filter(c=>c.action==='raffle-tree').length,0);await loadPrivate(s);
 assert.equal(s.calls.filter(c=>c.action==='raffle-tree').length,3);assert.equal(s.status(),'3 people can win');
 assert.match(s.r.coverageText(),/Read all 1 top-level comment and 2 replies$/);
});
test('the placeholder list is not the expected count: a finished chain is complete even with fewer top-level comments',async t=>{
 const s=await ui(t,{thread:()=>({post:{author:'Owner',subreddit:'Alpha',numComments:40},entries:[comment('a1','Alice'),comment('b1','Bob')],missingTopLevel:['c1','x1','x2','x3'],missingReplies:0}),tree:()=>({entries:[comment('c1','Carol')],loaders:[]})});
 await s.open();await loadPrivate(s);
 assert.equal(s.status(),'3 people can win');assert.equal(s.primary().disabled,false);assert.equal(s.q('.rt-raffle-ack').hidden,true);
 assert.equal(s.r.coverageText(),'Read all 3 top-level comments (40 in the thread, counting replies)');
});
test('a chain cut short keeps what was read, says why and needs an explicit tick before a private draw',async t=>{
 const L={src:'/svc/shreddit/more-comments/r/Alpha/t3_post1?top-level=1',cursor:'c1',topLevel:true};
 const s=await ui(t,{thread:()=>({post:{author:'Owner',subreddit:'Alpha'},entries:[comment('a1','Alice'),comment('b1','Bob')],missingTopLevel:['c1'],missingReplies:0}),
  tree:(args,n)=>{if(n===1)return {entries:[comment('c1','Carol')],loaders:[L]};throw Error('Reddit could not load the comments (HTTP 500).');}});
 await s.open();await loadPrivate(s);
 assert.equal(s.status(),'3 people can win · Read 3 top-level comments · Reddit stopped answering (Reddit could not load the comments (HTTP 500)), so some may be missing');
 assert.equal(s.primary().disabled,true);assert.equal(s.q('.rt-raffle-status-card').dataset.state,'warning');
 const ack=s.q('.rt-raffle-ack');assert.equal(ack.hidden,false);assert.equal(ack.querySelector('input').type,'checkbox');ack.querySelector('input').checked=true;ack.querySelector('input').dispatchEvent(new s.W.Event('change'));
 assert.equal(s.primary().disabled,false);
});
test('account rules look up only reached users and report skips; failures never win',async t=>{
 const s=await ui(t,{users:{Alice:Error('HTTP 500'),Bob:{suspended:true}}});
 await s.open();s.mode('private');s.input('minAccountAgeDays','30');await loadPrivate(s);
 assert.equal(s.status(),'2 people can win · Account minimums are checked during the draw');assert.equal(s.q('.rt-raffle-account .rt-raffle-row-caption').textContent,'At least 30 days old');
 s.primary().click();await flush();
 assert.equal(s.D.querySelectorAll('.rt-raffle-winner').length,0);assert.equal(s.q('.rt-raffle-banner-title'),null);assert.match(s.note(),/No eligible entrants.*Some accounts could not be checked/);assert.equal(s.r.dialog.draws,0);
});
const toMessage=async s=>{await s.open();await privateDraw(s,'2');s.primary().click();await flush();};
test('Message winners: separate chats need a second confirmation (warned beside the button), then send one each',async t=>{
 const sent=[];const s=await ui(t,{chat:args=>{if(args.action==='chat-status')return {ready:true};sent.push(args);return args.userId==='idbob'?{sent:false,reason:'Reddit refused the chat.'}:{sent:true,existing:true};}});
 await toMessage(s);
 assert.equal(s.q('#rt-raffle-title').textContent,'Message winners');assert.deepEqual([...s.D.querySelectorAll('.rt-raffle-person-name')].map(e=>e.textContent).sort(),['u/Alice','u/Bob']);
 const send=s.primary();assert.equal(send.textContent,'Send to 2 winners');
 assert.match(s.q('.rt-raffle-preview').textContent,/^Congratulations u\/(Alice|Bob)! You won the raffle on this post: https:\/\/www\.reddit\.com\/r\/Alpha\/comments\/post1\/giveaway\/$/);
 assert.ok(s.q('.rt-raffle-textarea').getAttribute('aria-describedby'),'the placeholder hint describes the message field');
 send.click();await flush();assert.equal(sent.length,0,'the first click only asks for confirmation');assert.equal(send.textContent,'Confirm: send 2 messages');assert.match(s.note(),/can’t be unsent/);
 assert.equal(s.q('.rt-raffle-footnote').getAttribute('slot'),'tertiary-button','the warning sits in the footer, beside the button');
 send.click();await flush();await new Promise(r=>setTimeout(r,1700));await flush();
 assert.equal(sent.length,2);assert.deepEqual(sent.map(a=>a.userId).sort(),['idalice','idbob']);
 const state=name=>s.q('[data-rt-recipient="'+name+'"] .rt-raffle-person-state');
 assert.equal(state('Alice').textContent,'Sent in your existing chat');assert.equal(state('Bob').dataset.state,'failed');
 assert.match(s.note(),/^Sent to 1 of 2 winners\. 1 failed\./);
 assert.equal(send.textContent,'Send to the remaining 1');send.click();send.click();await flush();
 assert.equal(sent.length,3);assert.equal(sent[2].userId,'idbob','a retry goes only to people not reached');
});
test('Message winners: removed winners move to “Not included” and come back with a click; only “Sending to” is messaged',async t=>{
 const sent=[];const s=await ui(t,{chat:args=>{if(args.action==='chat-status')return {ready:true};sent.push(args);return {sent:true};}});
 await toMessage(s);
 const names=sel=>[...s.D.querySelectorAll(sel+' .rt-raffle-person-name')].map(e=>e.textContent).sort();
 assert.equal(s.q('.rt-raffle-people-out').closest('.rt-raffle-mini').hidden,true,'no second section until someone is removed');assert.equal(s.q('[aria-label="Add someone by username"]'),null,'winners only');
 s.q('[aria-label="Remove u/Bob"]').click();
 assert.deepEqual(names('[aria-label="Recipients"]'),['u/Alice']);assert.deepEqual(names('.rt-raffle-people-out'),['u/Bob']);assert.equal(s.primary().textContent,'Send to 1 winner');
 s.q('[aria-label="Add u/Bob back"]').click();assert.deepEqual(names('[aria-label="Recipients"]'),['u/Alice','u/Bob']);
 s.q('[aria-label="Remove u/Alice"]').click();
 s.primary().click();s.primary().click();await flush();
 assert.deepEqual(sent.map(a=>a.userId),['idbob']);
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
  await s.open();s.mode('private');s.primary().click();const d=s.dialog();assert.ok(d);
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
 const b=bridge(t,{body:u=>u.pathname.includes('Gone')?{status:404}:u.pathname.includes('Banned')?{data:{is_suspended:true}}:{data:{created_utc:1600000000,comment_karma:10,link_karma:5,icon_img:'https://styles.redditmedia.com/t5_x/icon.png?width=256&amp;s=abc',snoovatar_img:'https://i.redd.it/snoovatar/avatars/abc-123.png'}}});
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
 const row=s.q('.rt-raffle-winner[data-rt-winner="Alice"]');assert.match(row.querySelector('.rt-raffle-excerpt').textContent,/^First line/);
 // Reddit Raffler's own facts: account age and both karmas, in the same line a private draw shows.
 assert.deepEqual([...row.querySelectorAll('.rt-raffle-stat')].map(e=>e.textContent),['7mo','5','1']);
 assert.deepEqual([...row.querySelectorAll('.rt-raffle-stat')].map(e=>e.title),['Account 243 days old','5 comment karma','1 post karma']);
 const proofIcon=proof.querySelector('svg');assert.equal(proofIcon.dataset.icon,'raffler','Reddit Raffler’s own mark');assert.equal(proofIcon.getAttribute('viewBox'),'0 0 159 159');assert.equal(proofIcon.getAttribute('fill'),'currentColor','follows the button’s colour in both themes');assert.equal(proofIcon.querySelectorAll('path').length,7,'the mark only, without the wordmark');
 assert.equal(s.secondary(),null,'no Draw again for a public draw');assert.equal(s.primary().textContent,'Message winners');
 assert.match(s.q('[data-rt-raffle-view="results"]').dataset.markdown,/Proof: https:\/\/www\.redditraffler\.com\/raffles\/post1$/);
});
test('an existing public raffle is not loaded automatically; View public results opens it on request',async t=>{
 const s=await ui(t,{raffler:m=>m.action==='status'?{ok:true,exists:true,raffle:officialRaffle({verified:false,creator:''})}:{ok:true,signedIn:''}});
 await s.open();
 assert.equal(s.q('#rt-raffle-title').textContent,'Run a raffle');assert.equal(s.q('[data-rt-raffle-view="results"]').hidden,true);
 assert.match(s.publicSub(),/^This post already has a public raffle\. View its results here\. Sign in as u\/Owner$/);
 assert.equal(s.primary().textContent,'View public results');assert.equal(s.calls.some(c=>c.action==='raffle-thread'),false,'opening never scans comments');
 assert.match(s.note(),/This raffle is unverified\. Sign in as u\/Owner to run it yourself/);
 const signIn=[...s.D.querySelectorAll('.rt-raffle-raffler-state .rt-raffle-retry')].find(a=>a.textContent==='Sign in as u/Owner');assert.ok(signIn);
 assert.equal(s.rafflerCalls.filter(c=>c.action==='create').length,0);
 s.primary().click();await flush();assert.equal(s.q('#rt-raffle-title').textContent,'Winners','the public results open only when asked');
});
test('the post author can sign in and run an unverified public raffle themselves',async t=>{
 let exists=true;const s=await ui(t,{raffler:m=>{
  if(m.action==='status')return exists?{ok:true,exists:true,raffle:officialRaffle({verified:false,creator:''})}:{ok:true,exists:false};
  if(m.action==='session')return {ok:true,signedIn:'Owner'};
  if(m.action==='create')exists=true;return {ok:true,exists:true};}});
 await s.open();
 assert.equal(s.primary().textContent,'View public results');assert.match(s.note(),/Run it yourself to create a verified draw/);
 const run=[...s.D.querySelectorAll('.rt-raffle-raffler-state .rt-raffle-retry')].find(a=>a.textContent==='Run it yourself');assert.ok(run);
 run.click();assert.equal(s.primary().textContent,'Run it yourself');assert.match(s.note(),/allows one official raffle per post/);assert.ok([...s.D.querySelectorAll('.rt-raffle-raffler-state .rt-raffle-retry')].some(a=>a.textContent==='View public results'));
 s.primary().click();assert.equal(s.primary().textContent,'Confirm public draw');assert.match(s.note(),/permanent public page/);
 s.primary().click();await flush();assert.equal(s.rafflerCalls.filter(c=>c.action==='create').length,1);
});
test('public mode disables rules Reddit Raffler can’t follow, with the reason beside them',async t=>{
 const s=await ui(t);await s.open();
 const must=s.q('[data-rt-row="mustInclude"]');assert.equal(must.dataset.unsupported,'true');assert.equal(must.querySelector('input').disabled,true);assert.equal(must.querySelector('.rt-raffle-row-caption').textContent,'Private draw only');
 assert.equal(s.q('[data-rt-row="topLevelOnly"] .rt-raffle-row-caption').textContent,'Reddit Raffler only counts top-level comments');
 s.input('minTotalKarma','100');s.input('minCommentKarma','5');
 assert.equal(s.q('.rt-raffle-account .rt-raffle-row-caption').textContent,'Reddit Raffler takes total karma or comment and post karma, not both');assert.equal(s.primary().disabled,true);
 s.mode('private');assert.equal(s.q('[data-rt-row="mustInclude"] input').disabled,false);assert.equal(s.primary().disabled,false);
 s.input('mustInclude','line');s.mode('public');s.mode('private');assert.equal(s.q('[name="mustInclude"]').value,'line','switching modes keeps what was typed');assert.match(s.status(),/^Ready for a private draw/);await loadPrivate(s);assert.match(s.status(),/^1 person can win/);
});
test('Reddit Raffler down or refusing: private draw becomes the choice, with a plain explanation',async t=>{
 const down=await ui(t,{raffler:()=>{throw Error('Reddit Raffler is unreachable.');}});await down.open();
 assert.equal(down.q('input[name="rt-raffle-draw"][value="private"]').checked,true);assert.equal(down.q('input[name="rt-raffle-draw"][value="public"]').disabled,true);
 assert.equal(down.publicSub(),'Reddit Raffler isn’t responding. You can still draw privately. Try again Sign in with Reddit');assert.ok(down.q('.rt-raffle-retry'));assert.equal(down.primary().textContent,'Draw privately');assert.equal(down.primary().disabled,false);
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
  fetch:async(url,init)=>{calls.push({url,init});const r=await responses(url,init);return {status:r.status ?? 200,ok:(r.status ?? 200)<300,type:r.type || 'basic',headers:{get:()=>null},async text(){return r.text ?? '';}};}});
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

test('Raffler coalesces concurrent reads, retries a transient failure once, and does not cache failures',async()=>{
 let attempts=0;const w=rafflerWorker({responses:async()=>{attempts++;if(attempts===1)throw Error('network');return {status:attempts===2?503:404};}});
 const results=await Promise.all([w.send({action:'status',postId:'post1'}),w.send({action:'status',postId:'post1'})]);
 assert.equal(w.calls.length,2);assert.ok(results.every(r=>r.ok===false));
 assert.equal((await w.send({action:'status',postId:'post1'})).exists,false);assert.equal(w.calls.length,3);
 const temporary=rafflerWorker({responses:()=>({status:temporary.calls.length===1?502:404})});
 assert.equal((await temporary.send({action:'status',postId:'post1'})).exists,false);assert.equal(temporary.calls.length,2);
});
test('Raffler does not retry creation, ordinary 404s or rate limits',async()=>{
 const w=rafflerWorker({responses:(url,init)=>{if(init.method==='POST')throw Error('connection lost');return url.endsWith('/raffles/new')?{text:'<input name="csrf_token" value="TOKEN-1234567890">'}:{status:404};}});
 assert.equal((await w.send({action:'create',postId:'post1',params:{winnerCount:1,minAge:0,minComment:0,minLink:0,ignoredUsers:[]}})).ok,false);
 assert.equal(w.calls.filter(c=>c.init.method==='POST').length,1);
 await w.send({action:'status',postId:'post1'});assert.equal(w.calls.filter(c=>c.url.endsWith('/raffles/post1')).length,1);
 const limited=rafflerWorker({responses:()=>({status:429})});assert.equal((await limited.send({action:'status',postId:'post1'})).ok,false);assert.equal(limited.calls.length,1);
});
test('Raffler sign-in comes from its form, validates the OAuth destination, and keeps CSRF private',async()=>{
 const good='https://www.reddit.com/api/v1/authorize?client_id=example&response_type=code&state=state123&redirect_uri=https%3A%2F%2Fwww.redditraffler.com%2Fauth%2Fredirect';
 for(const href of [good,good.replace('www.reddit.com','evil.test'),good.replace('www.redditraffler.com','evil.test'),'javascript:alert(1)']){
  const w=rafflerWorker({responses:()=>({text:'<input name="csrf_token" value="TOKEN-1234567890"><a class="button" href="'+href.replaceAll('&','&amp;')+'">Sign in with Reddit</a>'})});
  const r=await w.send({action:'session'});assert.equal(r.loginUrl,href===good?good:'https://www.redditraffler.com/raffles/new');assert.equal('csrf' in r,false);
 }
});
test('guest sign-in opens separately and refreshes status on return without drawing or changing rules',async t=>{
 let signedIn=false;const calls=[],s=await ui(t,{raffler:async message=>{calls.push(message.action);return message.action==='status'?{exists:false}:{signedIn:signedIn?'Owner':'',loginUrl:'https://www.reddit.com/api/v1/authorize?state=synthetic'};}});
 await s.open();s.input('winners','2');const link=s.q('.rt-raffle-raffler-state a');s.mode('private');assert.equal(s.q('.rt-raffle-raffler-state').hidden,true,'Raffler status only matters for a public draw');assert.equal(link.textContent,'Sign in with Reddit');assert.equal(link.target,'_blank');assert.equal(link.rel,'noopener noreferrer');
 link.addEventListener('click',e=>e.preventDefault());link.click();signedIn=true;s.W.dispatchEvent(new s.W.Event('focus'));await flush();
 assert.match(s.publicSub(),/u\/Owner/);assert.equal(s.q('[name=winners]').value,'2');assert.equal(s.primary().textContent,'Draw privately');assert.equal(calls.includes('create'),false);assert.equal(s.q('.rt-raffle-option-state a'),null);
});
test('raffle account avatars use native comment icons or headshots instead of full-body Snoovatars',async t=>{
 const full='https://i.redd.it/snoovatar/avatars/abc-123.png',native='https://cf.preview.redd.it/snoovatar/avatars/abc-123-headshot.png?width=64&height=64&s=signed';
 const profiles={Alice:{icon_img:native,snoovatar_img:full},Bob:{snoovatar_img:full},Carol:{icon_img:'https://evil.test/avatar.png',snoovatar_img:'https://preview.redd.it/snoovatar/avatars/abc-123.png'}};
 const b=bridge(t,{body:u=>({data:profiles[u.pathname.split('/')[2]]})});
 assert.equal((await b.send({action:'raffle-user',username:'Alice'})).avatar,native);
 assert.equal((await b.send({action:'raffle-user',username:'Bob'})).avatar,full.replace('.png','-headshot.png'));
 assert.equal((await b.send({action:'raffle-user',username:'Carol'})).avatar,'');
});

test('private qualification begins only on Draw privately, and out-of-range counts do not rescan or draw',async t=>{
 const facts={created:1,commentKarma:1000,postKarma:1000};const s=await ui(t,{users:{Alice:facts,Bob:facts}});await s.open();assert.equal(s.calls.length,0);
 s.mode('private');s.input('minAccountAgeDays','30');const replies=s.q('[name=topLevelOnly]');replies.checked=false;replies.dispatchEvent(new s.W.Event('input',{bubbles:true}));s.input('winners','5');assert.equal(s.calls.length,0);
 s.primary().click();await flush();assert.equal(s.calls.filter(c=>c.action==='raffle-thread').length,1);assert.equal(s.calls.filter(c=>c.action==='raffle-user').length,0);assert.match(s.note(),/Only 2 people are available/);assert.equal(s.r.dialog.result,null);assert.equal(s.r.dialog.draws,0);assert.equal(s.primary().disabled,true);
 s.input('winners','1');assert.equal(s.primary().disabled,false);s.primary().click();await flush();assert.equal(s.calls.filter(c=>c.action==='raffle-thread').length,1);assert.equal(s.r.dialog.result.winners.length,1);
});
test('insufficient account qualifiers stay on rules with the available range instead of a partial result',async t=>{
 const s=await ui(t,{users:{Alice:{created:1,commentKarma:1000,postKarma:1000},Bob:{suspended:true}}});await s.open();s.mode('private');s.input('minAccountAgeDays','30');s.input('winners','2');s.primary().click();await flush();
 assert.equal(s.r.dialog.view,'rules');assert.equal(s.r.dialog.result,null);assert.equal(s.r.dialog.draws,0);assert.match(s.note(),/Only 1 eligible person was found/);assert.equal(s.primary().disabled,true);
 const accountReads=s.calls.filter(c=>c.action==='raffle-user').length;s.input('winners','1');s.primary().click();await flush();assert.equal(s.r.dialog.result.winners[0].author,'Alice');assert.equal(s.calls.filter(c=>c.action==='raffle-user').length,accountReads);assert.equal(s.calls.filter(c=>c.action==='raffle-thread').length,1);
});
test('failed private scans can retry on a click and top-level changes never scan automatically',async t=>{
 let attempts=0;const s=await ui(t,{thread:()=>{attempts++;if(attempts===1)throw Error('HTTP 500');return {post:{author:'Owner'},entries:[comment('a1','Alice')],missingTopLevel:[],missingReplies:0};}});await s.open();s.mode('private');s.primary().click();await flush();assert.equal(s.primary().disabled,false);assert.equal(s.r.dialog.form.inert,false);assert.match(s.status(),/Couldn’t read/);
 s.primary().click();await flush();assert.equal(attempts,2);s.tertiary().click();const box=s.q('[name=topLevelOnly]');box.checked=false;box.dispatchEvent(new s.W.Event('input',{bubbles:true}));assert.equal(attempts,2);assert.equal(s.r.dialog.privateReady,false);s.primary().click();await flush();assert.equal(attempts,3);
});
test('public results enrich only winning comments without scanning entrants',async t=>{
 const s=await ui(t,{raffler:m=>m.action==='status'?{exists:true,raffle:officialRaffle()}:{signedIn:''}});await s.open();s.primary().click();await flush();
 assert.ok(s.calls.some(c=>c.action==='raffle-winner-comments' && c.ids.join(',')==='a1'));assert.equal(s.calls.some(c=>['raffle-thread','raffle-tree'].includes(c.action)),false);assert.equal(s.r.dialog.privateReady,false);assert.equal(s.r.dialog.entries.size,0);assert.match(s.q('.rt-raffle-excerpt').textContent,/First line/);
});
test('winner comments are read from each comment’s permalink JSON (Reddit now refuses /api/info.json), read-only, own post only',async t=>{
 const thread=(id,data)=>[{kind:'Listing',data:{children:[{kind:'t3',data:{id:'post1'}}]}},{kind:'Listing',data:{children:data?[{kind:'t1',data}]:[]}}];
 const b=bridge(t,{body:u=>{const id=u.pathname.split('/')[4].replace(/\.json$/,'');if(id==='gone')return {status:404};if(id==='b1')return thread(id,comment('b1','Bob',{link_id:'t3_other'}));return thread(id,comment(id,'Winner '+id,{link_id:'t3_post1'}));}});
 const result=await b.send({action:'raffle-winner-comments',postId:'post1',ids:['a1','b1','gone','c1']});assert.equal(result.ok,true,result.error);
 assert.deepEqual(result.entries.map(e=>e.id).sort(),['a1','c1'],'another post’s comment and a missing one are left out; the rest still load');
 assert.ok(b.calls.every(c=>c.url.pathname.startsWith('/comments/post1/_/') && c.url.pathname.endsWith('.json') && c.url.searchParams.get('depth')==='1' && c.url.searchParams.get('limit')==='1' && c.options.method==='GET'));assert.equal(b.calls.some(c=>c.url.pathname==='/api/info.json'),false);
 assert.deepEqual(b.calls.map(c=>c.url.pathname.split('/')[4].replace(/\.json$/,'')).sort(),['a1','b1','c1','gone'],'one read per winner');
 const before=b.calls.length;assert.equal((await b.send({action:'raffle-winner-comments',postId:'../x',ids:['a1']})).ok,false);assert.equal((await b.send({action:'raffle-winner-comments',postId:'post1',ids:['bad/id']})).ok,false);assert.equal(b.calls.length,before);
 const none=bridge(t,{body:()=>({status:500})});assert.equal((await none.send({action:'raffle-winner-comments',postId:'post1',ids:['a1']})).ok,false,'every read failing reports an error');
});

// --- 0.36: rules layout, user suggestions, winner facts, one results layout
test('rules: every section has its own symbol, text fields match the redaction fields and account minimums start open',async t=>{
 const s=await ui(t);await s.open();
 for(const name of ['winners','topLevelOnly','excludeAuthor','mustInclude','excludeUsers'])assert.ok(s.q('[data-rt-row="'+name+'"] .rt-raffle-row-icon svg[data-icon]'),name+' has a section symbol');
 assert.ok(s.q('.rt-raffle-account > .rt-raffle-row .rt-raffle-row-icon svg[data-icon="shield"]'));
 assert.ok(s.q('.rt-raffle-option[data-rt-mode="public"] svg[data-icon="globe"]'));assert.ok(s.q('.rt-raffle-option[data-rt-mode="private"] svg[data-icon="lock"]'));
 const keyword=s.q('[data-rt-row="mustInclude"]');assert.ok(keyword.classList.contains('rt-raffle-row-stacked'));assert.ok(s.q('[name="mustInclude"]').classList.contains('rt-raffle-text'));
 assert.equal(s.q('.rt-raffle-account').tagName,'DIV','account requirements are always shown, not a collapsible');assert.equal(s.q('.rt-raffle-account summary'),null);
 await flush();assert.equal(s.q('.rt-raffle-body').scrollTop,0,'opens at the top');let scrolled=0;s.W.Element.prototype.scrollIntoView=()=>{scrolled++;};await s.open();await flush();assert.equal(scrolled,0,'nothing scrolls a section into view on open');
 const css=read('post-discovery.css');
 assert.match(css,/\.rt-raffle-text\{[^}]*width:100%[^}]*height:40px[^}]*border-radius:20px/,'the same 40 px pill as the redaction fields');
 // Reddit's own scrollbox scrolls the card; its 2.5em fade overlay is switched off so nothing at the edges looks blurred.
 assert.match(css,/\.rt-raffle-card\{[^}]*--scrollbox-overlay-height:0px/);assert.doesNotMatch(css,/\.rt-raffle-body\{[^}]*overflow-y:auto/,'no second scroll area inside the card');assert.match(css,/@media \(max-width:640px\)\{[^]*\.rt-raffle-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
});
test('exclude users: suggestions are the post’s commenters from one thread read, which a later draw reuses',async t=>{
 const s=await ui(t);await s.open();
 const control=s.q('[data-rt-raffle-filter="excludeUsers"]');assert.equal(control.className,'rt-redact-control');assert.equal(control.querySelector('.rt-redact-control-value').textContent,'No one excluded');assert.equal(s.q('[name="excludeUsers"]').type,'hidden');
 control.click();await flush();
 const menu=s.q('.rt-redact-popover[data-rt-raffle-users]');assert.ok(menu);assert.equal(menu.getAttribute('role'),'menu');assert.ok(menu.hasAttribute('data-rt-feed-options'));
 assert.equal(s.calls.filter(c=>c.action==='raffle-thread').length,1,'one request for suggestions');
 assert.deepEqual([...menu.querySelectorAll('[data-rt-user-row]')].map(r=>r.dataset.rtUserRow),['Alice','Bob'],'commenters, without the excluded post author');
 assert.ok(menu.querySelector('[data-rt-user-row="Alice"] .rt-raffle-avatar img'));
 menu.querySelector('[data-rt-user-row="Alice"]').click();assert.equal(s.q('[name="excludeUsers"]').value,'Alice');assert.equal(control.querySelector('.rt-redact-control-value').textContent,'u/Alice');
 assert.equal(menu.querySelector('[data-rt-user-row="Alice"]').getAttribute('aria-checked'),'true');assert.deepEqual(plain(s.r.rules().excludeUsers),['alice']);
 const search=menu.querySelector('input[type="search"]');search.value='u/zed_99';search.dispatchEvent(new s.W.Event('input',{bubbles:true}));
 assert.deepEqual([...menu.querySelectorAll('[data-rt-user-row]')].map(r=>r.dataset.rtUserRow),['Alice','zed_99'],'an exact name can be added; picked names stay first');
 search.dispatchEvent(new s.W.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));assert.equal(control.querySelector('.rt-redact-control-value').textContent,'2 users');
 search.value='bo';search.dispatchEvent(new s.W.Event('input',{bubbles:true}));assert.deepEqual([...menu.querySelectorAll('[data-rt-user-row]')].map(r=>r.dataset.rtUserRow),['Alice','zed_99','Bob']);
 search.dispatchEvent(new s.W.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(s.q('[data-rt-raffle-users]'),null);assert.equal(s.D.activeElement,control);
 control.click();await flush();assert.equal(s.calls.filter(c=>c.action==='raffle-thread').length,1,'reopening uses what was read');control.click();
 s.mode('private');s.primary().click();await flush();
 assert.equal(s.calls.filter(c=>c.action==='raffle-thread').length,1,'the private draw reuses the same thread read');assert.equal(s.q('.rt-raffle-winner[data-rt-winner="Alice"]'),null,'excluded users never win');
});
test('exclude users after a private read suggests from the comments already read, with no request',async t=>{
 const s=await ui(t);await s.open();await loadPrivate(s);const reads=()=>s.calls.filter(c=>/^raffle-(thread|tree)$/.test(c.action)).length,before=reads();
 s.q('[data-rt-raffle-filter="excludeUsers"]').click();await flush();assert.equal(reads(),before,'no comment reads; only pictures for shown rows');
 assert.deepEqual([...s.D.querySelectorAll('[data-rt-user-row]')].map(r=>r.dataset.rtUserRow),['Alice','Bob']);
 const owner=s.q('[name="excludeAuthor"]');owner.checked=false;owner.dispatchEvent(new s.W.Event('input',{bubbles:true}));s.q('[data-rt-raffle-filter="excludeUsers"]').click();s.q('[data-rt-raffle-filter="excludeUsers"]').click();await flush();
 assert.deepEqual([...s.D.querySelectorAll('[data-rt-user-row]')].map(r=>r.dataset.rtUserRow),['Alice','Bob','Owner'],'the author is offered when not excluded already');
});
test('private winners show account age and both karmas, read once per winner, in the same layout as public results',async t=>{
 const now=Math.floor(Date.now()/1000),users={Alice:{userId:'ida',created:now-120*86400-60,commentKarma:1234,postKarma:56,avatar:''},Bob:{userId:'idb',created:now-3*86400,commentKarma:1,postKarma:0,avatar:''}};
 const s=await ui(t,{users});await s.open();await privateDraw(s,'2');await flush();
 const alice=s.q('.rt-raffle-winner[data-rt-winner="Alice"]');
 assert.deepEqual([...alice.querySelectorAll('.rt-raffle-stat')].map(e=>e.textContent),['3mo','1.2K','56']);assert.equal(alice.querySelector('.rt-raffle-stat').getAttribute('aria-label'),'Account 120 days old');
 assert.deepEqual([...s.q('.rt-raffle-winner[data-rt-winner="Bob"]').querySelectorAll('.rt-raffle-stat')].map(e=>e.textContent),['3d','1','0']);
 // One line with the name and time; each chip carries an icon like the profile search filter chips.
 assert.ok(alice.querySelector('.rt-raffle-meta .rt-raffle-stats'));assert.deepEqual([...alice.querySelectorAll('.rt-raffle-stat svg')].map(i=>i.dataset.icon),['cake','comment','post']);
 assert.equal(s.calls.filter(c=>c.action==='raffle-user' && c.username==='Alice').length,1,'one lookup per winner');
 // One layout for both kinds: banner (title, badge, details, actions), rows (rank, avatar, name and time, facts, comment).
 for(const part of ['.rt-raffle-banner .rt-raffle-banner-title','.rt-raffle-banner .rt-raffle-badge','.rt-raffle-banner .rt-raffle-banner-meta','.rt-raffle-banner .rt-raffle-copy'])assert.ok(s.q(part),part);
 for(const part of ['.rt-raffle-rank','.rt-raffle-avatar','.rt-raffle-meta .rt-raffle-name','.rt-raffle-meta faceplate-timeago','.rt-raffle-stats','.rt-raffle-excerpt'])assert.ok(alice.querySelector(part),part);
 const css=read('post-discovery.css');assert.match(css,/\.rt-raffle-winner\{[^}]*padding:8px 10px/);
});
test('a winner whose account can’t be read says so instead of leaving a gap',async t=>{
 const s=await ui(t,{users:{Bob:Error('HTTP 500')}});await s.open();s.mode('private');s.input('excludeUsers','Alice');await loadPrivate(s);s.primary().click();await flush();
 const bob=s.q('.rt-raffle-winner[data-rt-winner="Bob"]');assert.equal(bob.querySelector('.rt-raffle-stats').dataset.state,'unavailable');assert.equal(bob.querySelector('.rt-raffle-stats').textContent,'Account details unavailable');
});
test('public results use the private layout: the same rows fill in place when the comments arrive',async t=>{
 const s=await ui(t,{raffler:m=>m.action==='status'?{ok:true,exists:true,raffle:officialRaffle()}:{ok:true,signedIn:''}});await s.open();
 s.primary().click();const row=s.q('.rt-raffle-winner[data-rt-winner="Alice"]');assert.ok(row);await flush();
 assert.equal(s.q('.rt-raffle-winner[data-rt-winner="Alice"]'),row,'updated in place, never rebuilt');
 assert.ok(row.querySelector('.rt-raffle-meta faceplate-timeago'),'the comment’s time, like a private draw');assert.match(row.querySelector('.rt-raffle-excerpt').textContent,/^First line/);
 assert.deepEqual([...row.querySelectorAll('.rt-raffle-stat')].map(e=>e.textContent),['7mo','5','1']);
 assert.equal(s.calls.filter(c=>c.action==='raffle-user').length,1,'only the picture is looked up; Raffler gave the facts');
 const proof=s.q('.rt-raffle-proof');assert.ok(proof.classList.contains('rt-raffle-action'));assert.equal(proof.querySelector('.rt-raffle-action-label').textContent,'View proof');
 const css=read('post-discovery.css');assert.match(css,/\.rt-raffle-banner-actions \.rt-raffle-action\.button-small\{[^}]*padding:0 12px 0 10px/,'even leading and trailing space over Reddit’s button padding');
});
test('very new winner accounts are flagged, and the copied results carry the account facts',async t=>{
 const now=Math.floor(Date.now()/1000),users={Alice:{userId:'ida',created:now-5*86400,commentKarma:2,postKarma:0,avatar:''},Bob:{userId:'idb',created:now-400*86400,commentKarma:90,postKarma:12,avatar:''}};
 const s=await ui(t,{users});await s.open();await privateDraw(s,'2');await flush();
 const alice=s.q('.rt-raffle-winner[data-rt-winner="Alice"] .rt-raffle-stats'),bob=s.q('.rt-raffle-winner[data-rt-winner="Bob"] .rt-raffle-stats');
 assert.equal(alice.dataset.new,'true');assert.match(alice.title,/less than 30 days old/);assert.equal(bob.dataset.new,'false');
 const md=s.q('[data-rt-raffle-view="results"]').dataset.markdown;assert.match(md,/\d\. u\/Alice \(\[comment\]\([^)]*\)\) · 5 days old, 2 comment karma, 0 post karma/);assert.match(md,/u\/Bob .*· 400 days old, 90 comment karma, 12 post karma/);
 assert.match(read('post-discovery.css'),/\.rt-raffle-stats\[data-new="true"\] \.rt-raffle-stat:first-child\{[^}]*color:var\(--color-warning-content/);
});
test('the Exclude users control names everyone it counts',async t=>{
 const s=await ui(t);await s.open();s.input('excludeUsers','alice bob carol');const control=s.q('[data-rt-raffle-filter="excludeUsers"]');
 assert.equal(control.querySelector('.rt-redact-control-value').textContent,'3 users');assert.equal(control.title,'u/alice, u/bob, u/carol');
});
test('exclude users lists the commenters already on the page at once, then adds the rest from the thread read',async t=>{
 const s=await ui(t,{url:'https://www.reddit.com/r/Alpha/comments/post1/giveaway/',thread:()=>new Promise(()=>{})});
 s.D.querySelector('main').insertAdjacentHTML('beforeend','<shreddit-comment author="Zoe" depth="0" postid="t3_post1"></shreddit-comment><shreddit-comment author="Yan" depth="1" postid="t3_post1"></shreddit-comment><shreddit-comment author="Other" depth="0" postid="t3_other"></shreddit-comment><shreddit-comment author="Owner" depth="0" postid="t3_post1"></shreddit-comment>');
 await s.open();s.q('[data-rt-raffle-filter="excludeUsers"]').click();await flush();
 assert.deepEqual([...s.D.querySelectorAll('[data-rt-user-row]')].map(r=>r.dataset.rtUserRow),['Zoe'],'top-level commenters on this post, at once, while the thread read is still running');
 assert.match(s.q('.rt-raffle-users .rt-redact-suggestion-status').textContent,/Loading more commenters/);
 assert.match(read('post-discovery.css'),/\.rt-raffle-users\{[^}]*max-height:260px/);
});
test('the user menu is compact: Reddit’s menu width, not the field’s',async t=>{
 const s=await ui(t);await s.open();const control=s.q('[data-rt-raffle-filter="excludeUsers"]');control.getBoundingClientRect=()=>({left:20,top:100,bottom:140,width:480,height:40,right:500});
 control.click();await flush();assert.equal(s.q('[data-rt-raffle-users]').style.width,'256px');
});
test('winners screen: a trophy header, medal ranks, readable names and fact chips',async t=>{
 const s=await ui(t);await s.open();await privateDraw(s,'2');await flush();
 assert.ok(s.q('.rt-raffle-banner .rt-raffle-hero-icon svg[data-icon="trophy"]'));assert.equal(s.q('.rt-raffle-hero-icon').getAttribute('aria-hidden'),'true');
 assert.deepEqual([...s.D.querySelectorAll('.rt-raffle-rank')].map(r=>r.dataset.rank),['1','2']);
 const css=read('post-discovery.css');
 assert.match(css,/\.rt-raffle-rank\[data-rank="1"\]\{[^}]*background:#f5b400/);assert.match(css,/\.rt-raffle-rank\[data-rank="2"\]\{/);assert.match(css,/\.rt-raffle-rank\[data-rank="3"\]\{/);
 assert.match(css,/\.rt-raffle-name\{[^}]*font-size:14px/);assert.match(css,/\.rt-raffle-stat\{[^}]*border:1px solid color-mix\(in srgb,#ff4500 22%/,'the profile search filter-chip look');
 assert.match(css,/\.rt-raffle-excerpt\{[^}]*color:var\(--color-neutral-content-strong/,'comment text at full strength, not faded');
 assert.match(css,/\.rt-raffle-winner\{[^}]*border:1px solid/);assert.doesNotMatch(css,/\.rt-raffle-stat\+\.rt-raffle-stat::before/);
});
test('raffle fields share the redaction dialog’s hover, pressed and focus states',()=>{
 const css=read('post-discovery.css'),rule=sel=>css.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\{([^}]*)\\}'))?.[1] || '';
 const hover=rule('dialog.rt-raffle-dialog :is(.rt-redact-control,.rt-raffle-input,.rt-raffle-field input:not([type=hidden]),.rt-redact-area,.rt-raffle-step,.rt-raffle-option):hover');
 assert.match(hover,/background:var\(--color-neutral-background-hover,#e8edef\)/);assert.match(hover,/border-color:var\(--color-neutral-border-strong,#5c6c74\)/);
 assert.match(rule('dialog.rt-raffle-dialog :is(.rt-redact-control,.rt-raffle-step,.rt-raffle-option):active'),/background:var\(--color-interactive-pressed/);
 const focus=rule('dialog.rt-raffle-dialog :is(.rt-raffle-input,.rt-raffle-field input:not([type=hidden]),.rt-redact-area):focus');assert.match(focus,/outline:2px solid var\(--color-a-default,#216ba5\)/);
 assert.match(rule('dialog.rt-raffle-dialog :is(.rt-redact-control,.rt-raffle-step,.rt-switch input,.rt-raffle-option input,.rt-raffle-more,.rt-raffle-winner a):focus-visible'),/outline:2px solid var\(--color-a-default,#216ba5\)/);
 assert.doesNotMatch(css,/\.rt-raffle-input:focus-visible/,'no second, black focus ring on raffle fields');
});
test('commenter pictures: from the page’s comments at once, otherwise looked up only for rows that are shown',async t=>{
 const s=await ui(t,{url:'https://www.reddit.com/r/Alpha/comments/post1/giveaway/'});
 s.D.querySelector('main').insertAdjacentHTML('beforeend','<shreddit-comment author="Zoe" depth="0" postid="t3_post1" avatar="https://styles.redditmedia.com/t5_zoe/zoe.png"></shreddit-comment><shreddit-comment author="Evil" depth="0" postid="t3_post1" avatar="https://evil.test/x.png"></shreddit-comment>');
 await s.open();s.q('[data-rt-raffle-filter="excludeUsers"]').click();await flush();
 const src=name=>s.q('[data-rt-user-row="'+name+'"] img').getAttribute('src');
 assert.equal(src('Zoe'),'https://styles.redditmedia.com/t5_zoe/zoe.png','the picture Reddit already drew, no request');
 assert.equal(src('Alice'),'https://styles.redditmedia.com/Alice-head.png','looked up for a row on screen');assert.equal(src('Bob'),'https://styles.redditmedia.com/Bob-head.png');
 assert.match(src('Evil'),/^https:\/\/(www\.redditstatic\.com|styles\.redditmedia\.com)\//,'a picture from another host is never used');
 const lookups=()=>s.calls.filter(c=>c.action==='user-avatar').map(c=>c.username).sort();assert.deepEqual(plain(lookups()),['Alice','Bob','Evil'],'Zoe needed none');
 s.q('[data-rt-raffle-filter="excludeUsers"]').click();s.q('[data-rt-raffle-filter="excludeUsers"]').click();await flush();assert.equal(lookups().length,3,'kept for the dialog: reopening looks up nothing');
 assert.equal(src('Alice'),'https://styles.redditmedia.com/Alice-head.png');
});
test('phones keep two footer buttons on one line; scrolling a dialog never scrolls the page behind it',async t=>{
 const s=await ui(t,{narrow:true});await s.open();await privateDraw(s,'2');
 const again=[...s.D.querySelectorAll('[data-rt-raffle] button')].find(b=>/^Draw again/.test(b.textContent));
 assert.equal(again.slot,'tertiary-button','beside the main button instead of stacked above it');assert.equal(again.dataset.rtSlot,'secondary-button');
 s.media.matches=false;for(const fn of s.media.listeners)fn();assert.equal(again.slot,'secondary-button','desktop keeps Reddit’s own footer order');
 s.media.matches=true;for(const fn of s.media.listeners)fn();assert.equal(again.slot,'tertiary-button');
 const css=read('post-discovery.css');
 assert.match(css,/@media \(max-width:639px\)\{[^@]*\.rt-raffle-card::part\(footer\)\{flex-direction:row;flex-wrap:wrap;align-items:center;justify-content:flex-end/);
 assert.match(css,/@media \(max-width:639px\)\{[^@]*\.rt-raffle-footnote\{flex-basis:100%/);
 assert.match(css,/dialog\.rt-raffle-dialog\{[^}]*overscroll-behavior:contain/);assert.match(css,/\.rt-raffle-card\{[^}]*overscroll-behavior:contain/);
});
test('Message winners carries a chat icon',async t=>{
 const s=await ui(t);await s.open();await privateDraw(s);assert.ok(s.primary().classList.contains('rt-raffle-chat-icon'));assert.equal(s.primary().textContent,'Message winners');
 assert.match(read('post-discovery.css'),/\.rt-raffle-chat-icon::before\{[^}]*mask:url/);
});
// Reported 2026-11-17 (slow connection): before Reddit's script defines the post menu, its light-DOM children render in
// place, so the raffle item's ticket icon showed beside the card. It stays hidden until the menu element is defined.
test('the raffle menu item never renders outside an undefined post menu',()=>{
  const css=fs.readFileSync('extension/post-discovery.css','utf8');
  assert.match(css,/shreddit-post-overflow-menu:not\(:defined\)>\[slot="devvit-context-actions"\]\{display:none!important\}/);
});

test('opening Raffle paints a cancellable skeleton before building the rules',async t=>{
 const s=await ui(t);
 const row=s.item().querySelector('[role="menuitem"]');
 row.click();
 assert.ok(s.item().hasAttribute('data-rt-raffle-opening'));
 assert.equal(s.dialog(),null,'the native modal does not block the tap');
 await new Promise(resolve=>s.W.requestAnimationFrame(resolve));
 assert.equal(s.dialog(),null,'the menu gets the first frame');
 await new Promise(resolve=>s.W.requestAnimationFrame(resolve));
 const shell=s.dialog();
 assert.ok(shell?.hasAttribute('open'));
 assert.ok(shell.querySelector('[data-rt-raffle="loading"]'));
 assert.equal(shell.querySelector('form'),null);
 assert.equal(s.rafflerCalls.length,0,'opening the shell has not started a status read');
 await new Promise(resolve=>s.W.requestAnimationFrame(resolve));
 assert.equal(shell.querySelector('form'),null,'the first frame is available to paint the skeleton');
 shell.querySelector('[aria-label="Close"]').click();
 await new Promise(resolve=>s.W.requestAnimationFrame(resolve));
 assert.equal(s.dialog(),null);
 assert.ok(!s.rafflerCalls.some(call=>call.action==='session'),'closing cancels the dialog check; focusing the trigger may check its menu status');
 row.click();
 for(let i=0;i<2;i++)await new Promise(resolve=>s.W.requestAnimationFrame(resolve));
 const second=s.dialog();
 for(let i=0;i<3;i++)await new Promise(resolve=>s.W.requestAnimationFrame(resolve));
 assert.equal(s.dialog(),second,'the rules hydrate the same dialog');
 assert.equal(second.querySelector('[data-rt-raffle="loading"]'),null);
 assert.ok(second.querySelector('form'));
 assert.equal(s.D.activeElement?.id,'rt-raffle-title');
 assert.ok(!s.calls.some(call=>call.action==='raffle-thread'),'opening never scans entrants');
});

test('bridge raffle-user falls back to user-hover-card when about.json returns 403 or 410, and raffle-ui falls back to raffle-tree on 403',async t=>{
 const hoverCard=`<div data-testid="user-hover-card"><a href="/user/Alice/"><span data-testid="nameplate"><span class="truncate">Alice</span></span></a><img alt="u/Alice avatar" src="https://styles.redditmedia.com/t5_x/headshot.png"><time data-testid="cake-day">Nov 14, 2020</time><div data-testid="post-karma">1,250</div><div data-testid="comment-karma">3.5k</div></div>`;
 const suspendedCard=`<div data-testid="user-hover-card"><img src="https://www.redditstatic.com/shreddit/assets/suspended-snoo.png"><p>Account suspended</p></div>`;
 const b=bridge(t,{body:u=>{
  if(u.pathname.endsWith('/about.json'))return {status:u.pathname.includes('Gone')?404:403};
  if(u.pathname==='/svc/shreddit/user-hover-card/Alice')return {text:hoverCard};
  if(u.pathname==='/svc/shreddit/user-hover-card/Banned')return {text:suspendedCard};
  return {status:404};
 }});
 const ok=await b.send({action:'raffle-user',username:'Alice'});
 assert.equal(ok.postKarma,1250);
 assert.equal(ok.commentKarma,3500);
 assert.equal(ok.avatar,'https://styles.redditmedia.com/t5_x/headshot.png');
 assert.ok(ok.created>1600000000);
 assert.equal((await b.send({action:'raffle-user',username:'Banned'})).suspended,true);
 assert.equal((await b.send({action:'raffle-user',username:'Gone'})).unavailable,true);
 assert.equal(b.calls.some(c=>c.url.pathname==='/svc/shreddit/user-hover-card/Gone'),false,'404 keeps direct unavailable result');

 const s=await ui(t,{
  thread:()=>{throw Error('Reddit could not load the comments (HTTP 403).');},
  tree:()=>({entries:[comment('a1','Alice',{body:'Entering!'})],loaders:[]})
 });
 await s.open();
 await privateDraw(s);
 assert.equal(s.calls.filter(c=>c.action==='raffle-tree').length,1);
 assert.equal(s.r.dialog.result?.winners?.[0]?.author,'Alice');
});
