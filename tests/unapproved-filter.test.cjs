// "Awaiting approval" filter: moderators’ queue and the archive source for everyone else (docs/unmoderated-filter-spec.md).
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const read=file=>fs.readFileSync('extension/'+file,'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));// jsdom objects come from another realm
const flush=async()=>{for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r));};
const page='<main><div class="flex"><shreddit-sort-dropdown><button>Best</button></shreddit-sort-dropdown></div><shreddit-feed><article>Native card</article></shreddit-feed></main>';
const raw=(id,extra={})=>({id,author:'Writer',subreddit:'Alpha',title:'Queued '+id,selftext:'',created_utc:1700000000+Number.parseInt(id,36)%1000,is_self:true,score:1,num_comments:0,...extra});

// Fixed clock for the archive source: the 7-day cutoff is the minute-rounded now minus 604800 s.
const NOW=1750000000000,CUTOFF=Math.floor(NOW/60000)*60-604800;
const archived=(id,created,extra={})=>({id,author:'Poster',subreddit:'Alpha',title:'Archived '+id,selftext:'',created_utc:created,is_self:true,score:3,num_comments:1,...extra});
async function setup(t,{url='https://www.reddit.com/r/Alpha/',moderator=true,signedIn,queue,archive,status,menu,before,settings={modUnapprovedFilter:true}}={}){
 const dom=new JSDOM(page,{url,runScripts:'outside-only',pretendToBeVisual:true}),W=dom.window,calls=[],archiveCalls=[];let f;
 t.after(()=>{f?.destroy();W.close();});
 for(const file of ['post-model.js','feed-filters.js','unapproved-filter.js'])W.eval(read(file));
 before?.(W);
 let current=settings;
 const reddit=async args=>{calls.push(args);
  if(args.action==='mod-status'){if(moderator instanceof Error)throw moderator;return {moderator,subreddit:'Alpha',...(signedIn===undefined?{}:{signedIn})};}
  if(args.action==='unapproved')return queue?queue(args,calls.filter(c=>c.action==='unapproved').length):{posts:[raw('q1'),raw('q2')],after:null,hasMore:false};
  if(args.action==='awaiting-status'){if(!status)throw Error('Unexpected status read');return status(args,calls.filter(c=>c.action==='awaiting-status').length);}
  throw Error('Unexpected '+args.action);};
 const archiveRead=async message=>{archiveCalls.push(plain(message));if(!archive)throw Error('Unexpected archive read');return archive(message,archiveCalls.length);};
 f=new W.RTUnapprovedFilter.UnapprovedFilter({observe:false,reddit,archive:archiveRead,menu,now:()=>NOW,readSettings:async()=>current});
 await f.ready;await flush();
 return {W,D:W.document,f,calls,archiveCalls,api:{...W.RTUnapprovedFilter,availability:async name=>plain(await W.RTUnapprovedFilter.availability(name))},setSettings:async value=>{current=value;await f.loadSettings();await flush();},button:()=>W.document.querySelector('[data-rt-unapproved="button"]'),list:()=>W.document.querySelector('[data-rt-unapproved="list"]'),feed:()=>W.document.querySelector('shreddit-feed'),
  summary:()=>W.document.querySelector('.rt-unapproved-summary'),note:()=>W.document.querySelector('.rt-unapproved-source'),ids:()=>[...W.document.querySelectorAll('[data-rt-unapproved-id]')].map(r=>r.dataset.rtUnapprovedId)};
}
const archiveOn={modUnapprovedFilter:true,archiveDiscovery:true};
// Reddit's answer for each requested ID, by removed_by_category (missing key: Reddit left the ID out).
const statusFrom=categories=>args=>({statuses:args.ids.filter(id=>Object.hasOwn(categories,id)).map(id=>({id,category:categories[id],post:archived(id,CUTOFF+1000,{title:'Live '+id,score:9})})),subreddit:'Alpha'});

test('moderators get one button right after Reddit’s sort control; nothing else changes',async t=>{
 const s=await setup(t);const b=s.button();assert.ok(b);assert.equal(s.D.querySelector('shreddit-sort-dropdown').nextElementSibling,b);
 assert.equal(b.textContent,'Not yet approved');assert.equal(b.getAttribute('aria-pressed'),'false');assert.match(b.className,/button-small button-plain/);
 assert.equal(s.list(),null);assert.equal(s.feed().hasAttribute('data-rt-unapproved-hidden'),false);
 s.f.sync();s.f.sync();assert.equal(s.D.querySelectorAll('[data-rt-unapproved="button"]').length,1);
 assert.deepEqual(s.calls.map(c=>c.action),['mod-status'],'the moderator check runs once per community');
});
for(const [label,moderator] of [['non-moderators',false],['failed checks',Error('HTTP 403')]])test('no button for '+label,async t=>{
 const s=await setup(t,{moderator});assert.equal(s.button(),null);
});
test('the filter is off outside community feeds and when the setting is off',async t=>{
 for(const url of ['https://www.reddit.com/r/Alpha/comments/abc/x/','https://www.reddit.com/user/Example/','https://www.reddit.com/r/Alpha/search/?q=x']){const s=await setup(t,{url});assert.equal(s.button(),null,url);assert.equal(s.calls.length,0);}
 const s=await setup(t,{settings:{modUnapprovedFilter:false}});assert.equal(s.button(),null);assert.equal(s.calls.length,0);
});
test('turning it on hides Reddit’s feed, shows the queue as search rows, and off restores the feed',async t=>{
 const s=await setup(t);s.button().click();await flush();
 assert.equal(s.W.location.search,'?rt_mod=unapproved');assert.equal(s.button().getAttribute('aria-pressed'),'true');
 assert.equal(s.feed().hasAttribute('data-rt-unapproved-hidden'),true);assert.equal(s.list().nextElementSibling,s.feed());
 const rows=[...s.list().querySelectorAll('[data-rt-unapproved-id]')];assert.deepEqual(rows.map(r=>r.dataset.rtUnapprovedId),['q1','q2']);
 assert.equal(rows[0].querySelector('[data-testid="post-title-text"]').textContent,'Queued q1');assert.ok(rows[0].querySelector('[data-testid="search-post-unit"]'));
 assert.equal(s.list().querySelector('.rt-unapproved-summary').textContent,'2 posts not yet approved in r/Alpha');
 assert.deepEqual(s.calls.filter(c=>c.action==='unapproved').map(c=>c.after),[null]);
 assert.equal(rows[0].querySelectorAll('button').length,0,'read-only rows: no moderation actions');
 s.button().click();await flush();
 assert.equal(s.W.location.search,'');assert.equal(s.list(),null);assert.equal(s.feed().hasAttribute('data-rt-unapproved-hidden'),false);assert.equal(s.D.querySelector('shreddit-feed article').textContent,'Native card');
});
test('direct load with the parameter opens the list once the moderator check passes',async t=>{
 const s=await setup(t,{url:'https://www.reddit.com/r/Alpha/new/?rt_mod=unapproved'});assert.ok(s.list());assert.equal(s.feed().hasAttribute('data-rt-unapproved-hidden'),true);
 const n=await setup(t,{url:'https://www.reddit.com/r/Alpha/?rt_mod=unapproved',moderator:false});assert.equal(n.list(),null);assert.equal(n.feed().hasAttribute('data-rt-unapproved-hidden'),false);
});
test('empty queue says so; a failed read says what failed and offers Retry, never “empty”',async t=>{
 const empty=await setup(t,{url:'https://www.reddit.com/r/Alpha/?rt_mod=unapproved',queue:()=>({posts:[],after:null,hasMore:false})});
 assert.equal(empty.list().querySelector('.rt-unapproved-summary').textContent,'No posts are waiting for approval in r/Alpha.');
 let fail=true;const s=await setup(t,{url:'https://www.reddit.com/r/Alpha/?rt_mod=unapproved',queue:()=>{if(fail)throw Error('Reddit could not load the moderation queue (HTTP 500).');return {posts:[raw('q1')],after:null,hasMore:false};}});
 const summary=s.list().querySelector('.rt-unapproved-summary');assert.match(summary.textContent,/^Couldn’t load the moderation queue: Reddit could not load the moderation queue \(HTTP 500\)\.$/);assert.equal(summary.dataset.error,'true');
 const retry=s.list().querySelector('.rt-unapproved-retry');assert.equal(retry.hidden,false);fail=false;retry.click();await flush();
 assert.equal(summary.textContent,'1 post not yet approved in r/Alpha');assert.equal(retry.hidden,true);
});
test('Show more follows Reddit’s cursor, drops duplicates and stops on a repeated cursor',async t=>{
 const s=await setup(t,{url:'https://www.reddit.com/r/Alpha/?rt_mod=unapproved',queue:(args,n)=>n===1?{posts:[raw('a1'),raw('a2')],after:'t3_a2',hasMore:true}:{posts:[raw('a2'),raw('a3')],after:'t3_a2',hasMore:true}});
 const more=s.list().querySelector('.rt-unapproved-more');assert.equal(more.hidden,false);assert.match(s.list().querySelector('.rt-unapproved-summary').textContent,/^Showing the newest 2 posts/);
 more.click();await flush();
 assert.deepEqual([...s.list().querySelectorAll('[data-rt-unapproved-id]')].map(r=>r.dataset.rtUnapprovedId),['a1','a2','a3']);
 assert.match(s.list().querySelector('.rt-unapproved-summary').textContent,/repeated a queue cursor/);assert.equal(more.hidden,true);
});
test('turning the setting off removes the button and list and restores the feed at once',async t=>{
 const s=await setup(t,{url:'https://www.reddit.com/r/Alpha/?rt_mod=unapproved'});assert.ok(s.list());
 await s.setSettings({modUnapprovedFilter:false});assert.equal(s.button(),null);assert.equal(s.list(),null);assert.equal(s.feed().hasAttribute('data-rt-unapproved-hidden'),false);
});
test('Reddit re-rendering the feed header gets the button back next to the new sort control',async t=>{
 const s=await setup(t);const row=s.D.querySelector('.flex');row.innerHTML='<shreddit-sort-dropdown><button>Hot</button></shreddit-sort-dropdown>';s.f.sync();
 assert.equal(s.D.querySelector('shreddit-sort-dropdown').nextElementSibling,s.button());
});

// --- Page bridge
function bridge(t,{url='https://www.reddit.com/r/Alpha/',respond}={}){
 const dom=new JSDOM('<body></body>',{url,runScripts:'outside-only'}),W=dom.window,calls=[];t.after(()=>W.close());W.AbortController=AbortController;
 W.fetch=async(href,options)=>{const u=new URL(href);calls.push({url:u,options});const value=respond?respond(u):u.pathname.endsWith('/about.json')?{data:{user_is_moderator:true,display_name:'Alpha'}}:{kind:'Listing',data:{children:[{kind:'t3',data:raw('q1')},{kind:'t3',data:raw('q2',{subreddit:'Other'})}],after:null}};return {ok:value.status==null,status:value.status || 200,headers:new Headers(),text:async()=>JSON.stringify(value)};};
 for(const file of ['post-model.js','post-page-bridge.js'])W.eval(read(file));
 const send=input=>new Promise(resolve=>{const id=crypto.randomUUID(),listener=event=>{const result=JSON.parse(event.detail);if(result.id!==id)return;W.document.removeEventListener('rt-post-response',listener);resolve(result);};W.document.addEventListener('rt-post-response',listener);W.document.dispatchEvent(new W.CustomEvent('rt-post-request',{detail:JSON.stringify({channel:'unapproved-test',id,...input})}));});
 return {calls,send};
}
test('bridge reads only fixed same-origin moderation paths with Reddit’s session',async t=>{
 const b=bridge(t);
 const status=await b.send({action:'mod-status',subreddit:'alpha'});assert.equal(status.ok,true);assert.equal(status.moderator,true);
 const queue=await b.send({action:'unapproved',subreddit:'Alpha',after:'t3_abc'});assert.equal(queue.ok,true);assert.deepEqual(queue.posts.map(p=>p.id),['q1'],'posts from other communities are dropped');
 assert.deepEqual(b.calls.map(c=>c.url.pathname),['/r/Alpha/about.json','/r/Alpha/about/unmoderated.json']);
 const q=b.calls[1].url.searchParams;assert.equal(q.get('limit'),'100');assert.equal(q.get('only'),'links');assert.equal(q.get('after'),'t3_abc');
 for(const c of b.calls){assert.equal(c.url.origin,'https://www.reddit.com');assert.equal(c.options.credentials,'include');assert.equal(c.options.method,'GET');assert.equal(c.options.redirect,'error');}
});
test('bridge rejects another community, bad names, cursors and URLs before any fetch',async t=>{
 const b=bridge(t);
 for(const input of [{action:'mod-status',subreddit:'Beta'},{action:'unapproved',subreddit:'a/b'},{action:'unapproved',subreddit:'Alpha',after:'https://evil.test'},{action:'unapproved',subreddit:'Alpha',url:'https://evil.test'}]){const r=await b.send(input);assert.equal(r.ok,false,JSON.stringify(input));}
 const off=bridge(t,{url:'https://www.reddit.com/r/Alpha/comments/abc/x/'});assert.equal((await off.send({action:'unapproved',subreddit:'Alpha'})).ok,false);
 assert.equal(b.calls.length+off.calls.length,0);
});
test('bridge reports a 403 as not a moderator, not an empty queue',async t=>{
 const b=bridge(t,{respond:()=>({status:403})});const r=await b.send({action:'unapproved',subreddit:'Alpha'});assert.equal(r.ok,false);assert.match(r.error,/don’t moderate/);
});

// --- Any community: source selection, archive source, menu API (spec B7-B10)
test('availability picks the mod queue for moderators, the archive for everyone else, and says why when it can’t',async t=>{
 const mod=await setup(t,{settings:archiveOn});assert.deepEqual(await mod.api.availability('alpha'),{available:true,source:'modqueue'});
 const reader=await setup(t,{moderator:false,settings:archiveOn});assert.deepEqual(await reader.api.availability('Alpha'),{available:true,source:'archive'});
 assert.equal(reader.button(),null,'the standalone button stays moderator-only');assert.equal(reader.list(),null,'nothing changes until the filter is turned on');
 assert.deepEqual(await reader.api.availability('Beta'),{available:false,source:null,reason:'not-community'});
 const off=await setup(t,{moderator:false});assert.deepEqual(await off.api.availability('Alpha'),{available:false,source:'archive',reason:'archive-off'});
 const signedOut=await setup(t,{moderator:false,signedIn:false,settings:archiveOn});assert.deepEqual(await signedOut.api.availability('Alpha'),{available:false,source:null,reason:'signed-out'});
 const failed=await setup(t,{moderator:Error('HTTP 500'),settings:archiveOn});assert.deepEqual(await failed.api.availability('Alpha'),{available:false,source:null,reason:'error'});
 const disabled=await setup(t,{moderator:false,settings:{modUnapprovedFilter:false,archiveDiscovery:true}});assert.deepEqual(await disabled.api.availability('Alpha'),{available:false,source:null,reason:'disabled'});
 const post=await setup(t,{url:'https://www.reddit.com/r/Alpha/comments/abc/x/',moderator:false,settings:archiveOn});assert.equal((await post.api.availability('Alpha')).reason,'not-community');
});
test('only automod_filtered and reddit count as awaiting approval',async t=>{
 const s=await setup(t,{moderator:false});const awaiting=s.api.awaitingCategory;
 assert.equal(awaiting('automod_filtered'),true);assert.equal(awaiting('reddit'),true);
 for(const category of ['moderator','deleted','author','copyright_takedown','anti_evil_ops','content_takedown',null,undefined,'','REDDIT'])assert.equal(awaiting(category),false,String(category));
});
test('non-moderators see held posts from Arctic Shift checked against Reddit, with the source note',async t=>{
 const posts=['a1','a2','a3','a4','a5','a6'].map((id,i)=>archived(id,NOW/1000-60*(i+1)));
 const s=await setup(t,{moderator:false,settings:archiveOn,archive:()=>({ok:true,posts,cursor:null,hasMore:false}),
  status:statusFrom({a1:'automod_filtered',a2:null,a3:'moderator',a4:'reddit',a5:'deleted',a6:'author'})});
 assert.equal(await s.api.setActive(true),true);await flush();
 assert.equal(s.W.location.search,'?rt_mod=unapproved');assert.equal(s.feed().hasAttribute('data-rt-unapproved-hidden'),true);assert.equal(s.list().dataset.rtUnapprovedSource,'archive');
 assert.deepEqual(s.ids(),['a1','a4']);
 assert.equal(s.summary().textContent,'2 posts held for review in r/Alpha in the last 7 days');
 assert.equal(s.note().textContent,'Held for review and not yet approved (from Arctic Shift, last 7 days)');assert.equal(s.summary().nextElementSibling,s.note());
 assert.equal(s.list().querySelector('[data-testid="post-title-text"]').textContent,'Live a1','rows use Reddit’s current copy');
 assert.deepEqual(s.archiveCalls[0],{action:'archive-search',kind:'post',subreddit:'Alpha',sort:'desc',after:CUTOFF});
 assert.equal(s.list().querySelector('.rt-unapproved-more').hidden,true);
 const mod=await setup(t,{url:'https://www.reddit.com/r/Alpha/?rt_mod=unapproved'});assert.equal(mod.note().textContent,'From your mod queue');assert.equal(mod.list().dataset.rtUnapprovedSource,'modqueue');
});
test('an empty archive check says so for the last 7 days',async t=>{
 const s=await setup(t,{url:'https://www.reddit.com/r/Alpha/?rt_mod=unapproved',moderator:false,settings:archiveOn,archive:()=>({ok:true,posts:[archived('b1',NOW/1000-100)],cursor:null,hasMore:false}),status:statusFrom({b1:null})});
 assert.equal(s.summary().textContent,'No posts are waiting for approval in r/Alpha in the last 7 days.');assert.equal(s.summary().dataset.error,undefined);
});
test('the archive read stops at the 7-day cutoff',async t=>{
 const s=await setup(t,{url:'https://www.reddit.com/r/Alpha/?rt_mod=unapproved',moderator:false,settings:archiveOn,
  archive:()=>({ok:true,posts:[archived('c1',CUTOFF+10),archived('c2',CUTOFF-10)],cursor:CUTOFF-9,hasMore:true,cursorStalled:false}),status:statusFrom({c1:'reddit',c2:'reddit'})});
 assert.equal(s.archiveCalls.length,1,'an older post ends the read');assert.deepEqual(s.ids(),['c1']);
 assert.deepEqual(plain(s.calls.filter(c=>c.action==='awaiting-status').map(c=>c.ids)),[['c1']],'posts older than 7 days are not checked');
 assert.equal(s.summary().textContent,'1 post held for review in r/Alpha in the last 7 days');
});
test('at most three Arctic Shift pages, paged backwards, each checked in batches of at most 100',async t=>{
 const top=Math.floor(NOW/1000)-10;
 const page=n=>{const posts=Array.from({length:100},(_,i)=>archived((n*1000+i).toString(36),top-(n-1)*100-i));return {ok:true,posts,cursor:top-(n-1)*100-99+1,hasMore:true,cursorStalled:false};};
 const s=await setup(t,{url:'https://www.reddit.com/r/Alpha/?rt_mod=unapproved',moderator:false,settings:archiveOn,archive:(message,n)=>page(n),status:args=>({statuses:args.ids.map(id=>({id,category:id.endsWith('0')?'automod_filtered':null,post:null})),subreddit:'Alpha'})});
 assert.equal(s.archiveCalls.length,3);
 assert.deepEqual(s.archiveCalls.map(c=>c.before),[undefined,top-98,top-198]);assert.ok(s.archiveCalls.every(c=>c.after===CUTOFF));
 const reads=s.calls.filter(c=>c.action==='awaiting-status');assert.equal(reads.length,3);assert.ok(reads.every(c=>c.ids.length<=100 && c.ids.every(id=>/^[a-z0-9]{1,10}$/.test(id))));
 assert.match(s.summary().textContent,/ held for review in r\/Alpha · only the newest 300 posts were checked; older posts from the last 7 days weren’t$/);
 assert.ok(s.ids().length>0);
});
test('a stalled archive cursor and IDs Reddit leaves out are stated, never read as empty',async t=>{
 const stalled=await setup(t,{url:'https://www.reddit.com/r/Alpha/?rt_mod=unapproved',moderator:false,settings:archiveOn,archive:()=>({ok:true,posts:[archived('d1',NOW/1000-100)],cursor:null,hasMore:true,cursorStalled:true}),status:statusFrom({d1:null})});
 assert.equal(stalled.summary().textContent,'No posts found waiting for approval in r/Alpha · the archive listing stopped early; older posts weren’t checked.');
 const missing=await setup(t,{url:'https://www.reddit.com/r/Alpha/?rt_mod=unapproved',moderator:false,settings:archiveOn,archive:()=>({ok:true,posts:[archived('e1',NOW/1000-100),archived('e2',NOW/1000-200)],cursor:null,hasMore:false}),status:statusFrom({e1:null})});
 assert.equal(missing.summary().textContent,'No posts found waiting for approval in r/Alpha · 1 post couldn’t be checked with Reddit.');
});
test('a failed archive or Reddit read shows the error with Retry, never “empty”, and Retry resumes',async t=>{
 let archiveFail=true;
 const a=await setup(t,{url:'https://www.reddit.com/r/Alpha/?rt_mod=unapproved',moderator:false,settings:archiveOn,archive:()=>archiveFail?{ok:false,error:'Archive rate limit reached.',code:'rate-limited'}:{ok:true,posts:[archived('f1',NOW/1000-100)],cursor:null,hasMore:false},status:statusFrom({f1:'reddit'})});
 assert.equal(a.summary().textContent,'Couldn’t check posts awaiting approval: Archive rate limit reached.');assert.equal(a.summary().dataset.error,'true');
 const retry=a.list().querySelector('.rt-unapproved-retry');assert.equal(retry.hidden,false);archiveFail=false;retry.click();await flush();
 assert.equal(a.summary().textContent,'1 post held for review in r/Alpha in the last 7 days');assert.equal(retry.hidden,true);
 let statusFail=true;
 const b=await setup(t,{url:'https://www.reddit.com/r/Alpha/?rt_mod=unapproved',moderator:false,settings:archiveOn,archive:()=>({ok:true,posts:[archived('g1',NOW/1000-100)],cursor:null,hasMore:false}),
  status:args=>{if(statusFail)throw Error('Reddit refused the post status check (HTTP 403).');return statusFrom({g1:'automod_filtered'})(args);}});
 assert.equal(b.summary().textContent,'Couldn’t check posts awaiting approval: Reddit refused the post status check (HTTP 403).');assert.deepEqual(b.ids(),[]);
 statusFail=false;b.list().querySelector('.rt-unapproved-retry').click();await flush();
 assert.equal(b.archiveCalls.length,1,'Retry re-checks the posts already read instead of reading the archive again');assert.deepEqual(b.ids(),['g1']);
 const off=await setup(t,{url:'https://www.reddit.com/r/Alpha/?rt_mod=unapproved',moderator:false,settings:archiveOn,archive:()=>({ok:false,error:'Enable archive discovery in Reddit Tweaks settings.',code:'disabled'})});
 assert.equal(off.summary().textContent,'Couldn’t check posts awaiting approval: Turn on Use the archive to check this community.');
});
test('setActive turns the archive view on and off, restores the feed and tells subscribers',async t=>{
 const s=await setup(t,{moderator:false,settings:archiveOn,archive:()=>({ok:true,posts:[archived('h1',NOW/1000-100)],cursor:null,hasMore:false}),status:statusFrom({h1:'reddit'})});
 const seen=[];const stop=s.api.onChange(state=>seen.push(state));
 assert.equal(s.api.active(),false);assert.equal(await s.api.setActive(true),true);await flush();
 assert.equal(s.api.active(),true);assert.ok(s.list());assert.equal(s.feed().hasAttribute('data-rt-unapproved-hidden'),true);
 assert.equal(await s.api.setActive(false),false);await flush();
 assert.equal(s.W.location.search,'');assert.equal(s.list(),null);assert.equal(s.feed().hasAttribute('data-rt-unapproved-hidden'),false);assert.equal(s.D.querySelector('shreddit-feed article').textContent,'Native card');
 assert.deepEqual(seen.map(state=>state.active),[true,false]);assert.ok(seen.every(state=>state.source==='archive' && state.available===true && state.subreddit==='Alpha'));
 stop();await s.api.setActive(true);assert.equal(seen.length,2,'unsubscribed');
 await s.setSettings({modUnapprovedFilter:true,archiveDiscovery:false});
 assert.equal(s.list(),null,'turning Use the archive off removes the archive list');assert.equal(s.feed().hasAttribute('data-rt-unapproved-hidden'),false);
 const off=await setup(t,{moderator:false});assert.equal(await off.api.setActive(true),false);assert.equal(off.W.location.search,'');assert.equal(off.list(),null);
});
test('a registered feed menu suppresses the standalone button; moderators keep the mod queue through setActive',async t=>{
 const s=await setup(t);assert.ok(s.button());
 s.api.useMenu(true);assert.equal(s.button(),null);
 assert.equal(await s.api.setActive(true),true);await flush();assert.equal(s.button(),null);assert.deepEqual(s.ids(),['q1','q2']);assert.equal(s.list().dataset.rtUnapprovedSource,'modqueue');
 s.api.useMenu(false);assert.ok(s.button());assert.equal(s.button().getAttribute('aria-pressed'),'true');
 const early=await setup(t,{before:W=>W.document.documentElement.setAttribute(W.RTUnapprovedFilter.MENU_ATTR,'')});assert.equal(early.button(),null,'the attribute works before the filter starts');
 const option=await setup(t,{menu:true});assert.equal(option.button(),null);
});

test('bridge checks archived IDs with one fixed info.json read and returns Reddit’s removal category',async t=>{
 const b=bridge(t,{respond:u=>u.pathname==='/api/info.json'?{kind:'Listing',data:{children:[
  {kind:'t3',data:raw('aa',{removed_by_category:'automod_filtered'})},{kind:'t3',data:raw('bb',{removed_by_category:null})},{kind:'t3',data:raw('cc',{subreddit:'Other',removed_by_category:'reddit'})},{kind:'t3',data:raw('dd',{removed_by_category:'<script>'})},{kind:'t3',data:raw('zz',{removed_by_category:'reddit'})}]}}:{}});
 const r=await b.send({action:'awaiting-status',subreddit:'alpha',ids:['aa','bb','cc','dd','aa']});assert.equal(r.ok,true,r.error);
 assert.deepEqual(r.statuses.map(s=>[s.id,s.category]),[['aa','automod_filtered'],['bb',null],['dd',null]],'other communities and unrequested IDs are dropped; odd categories read as none');
 assert.equal(b.calls.length,1);const c=b.calls[0];
 assert.equal(c.url.origin,'https://www.reddit.com');assert.equal(c.url.pathname,'/api/info.json');assert.equal(c.url.searchParams.get('id'),'t3_aa,t3_bb,t3_cc,t3_dd');assert.equal(c.url.searchParams.get('raw_json'),'1');assert.equal([...c.url.searchParams.keys()].length,2);
 assert.equal(c.options.credentials,'include');assert.equal(c.options.redirect,'error');assert.equal(c.options.method,'GET');
});
test('bridge rejects more than 100 IDs and anything that is not a bare base36 ID before any fetch',async t=>{
 const b=bridge(t);const many=Array.from({length:101},(_,i)=>i.toString(36));
 for(const ids of [many,[],['t3_abc'],['ABC'],['abcdefghijk'],['https://evil.test'],['a,b'],[5],'abc',undefined]){const r=await b.send({action:'awaiting-status',subreddit:'Alpha',ids});assert.equal(r.ok,false,JSON.stringify(ids));}
 for(const input of [{action:'awaiting-status',subreddit:'Beta',ids:['abc']},{action:'awaiting-status',subreddit:'Alpha',ids:['abc'],url:'https://evil.test'}]){const r=await b.send(input);assert.equal(r.ok,false,JSON.stringify(input));}
 assert.equal(b.calls.length,0);
 const ok=await b.send({action:'awaiting-status',subreddit:'Alpha',ids:Array.from({length:100},(_,i)=>i.toString(36))});assert.equal(ok.ok,true,'exactly 100 is allowed');
 assert.equal(b.calls.length,1);assert.equal(b.calls[0].url.searchParams.get('id').split(',').length,100);
});
test('bridge reports a failed status read as an error, a refused one as refused, and a signed-out reader as signed out',async t=>{
 {const b=bridge(t,{respond:()=>({status:500})});const r=await b.send({action:'awaiting-status',subreddit:'Alpha',ids:['abc']});assert.equal(r.ok,false);assert.match(r.error,/HTTP 500/);}
 for(const status of [401,403]){const b=bridge(t,{respond:()=>({status})});const r=await b.send({action:'awaiting-status',subreddit:'Alpha',ids:['abc']});assert.equal(r.ok,true,r.error);assert.equal(r.refused,true,'a refusal is reported as such, not as a failure');assert.deepEqual(plain(r.statuses),[]);}
 const out=bridge(t,{respond:()=>({data:{user_is_moderator:null,display_name:'Alpha'}})});const r=await out.send({action:'mod-status',subreddit:'Alpha'});
 assert.equal(r.moderator,false);assert.equal(r.signedIn,false);
 const member=bridge(t,{respond:()=>({data:{user_is_moderator:false,display_name:'Alpha'}})});assert.equal((await member.send({action:'mod-status',subreddit:'Alpha'})).signedIn,true);
});

test('when Reddit refuses the status check, Arctic Shift’s recorded state is listed and the summary says so',async t=>{
 const posts=[archived('b1',NOW/1000-60,{removed_by_category:'automod_filtered'}),archived('b2',NOW/1000-120,{removed_by_category:'moderator'}),archived('b3',NOW/1000-180,{removed_by_category:'reddit'}),archived('b4',NOW/1000-240)];
 let reads=0;
 const s=await setup(t,{moderator:false,settings:archiveOn,archive:()=>({ok:true,posts,cursor:null,hasMore:false}),status:()=>{reads++;return {ok:true,statuses:[],refused:true};}});
 assert.equal(await s.api.setActive(true),true);await flush();
 assert.deepEqual(s.ids(),['b1','b3']);
 assert.equal(reads,1,'one refusal stops further status reads');
 assert.match(s.summary().textContent,/^2 posts held for review in r\/Alpha · as recorded when posted; Reddit doesn’t share current status/);
});
