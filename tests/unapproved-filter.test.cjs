// "Not yet approved" filter for moderators (docs/unmoderated-filter-spec.md).
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const read=file=>fs.readFileSync('extension/'+file,'utf8');
const flush=async()=>{for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r));};
const page='<main><div class="flex"><shreddit-sort-dropdown><button>Best</button></shreddit-sort-dropdown></div><shreddit-feed><article>Native card</article></shreddit-feed></main>';
const raw=(id,extra={})=>({id,author:'Writer',subreddit:'Alpha',title:'Queued '+id,selftext:'',created_utc:1700000000+Number.parseInt(id,36)%1000,is_self:true,score:1,num_comments:0,...extra});

async function setup(t,{url='https://www.reddit.com/r/Alpha/',moderator=true,queue,settings={modUnapprovedFilter:true}}={}){
 const dom=new JSDOM(page,{url,runScripts:'outside-only',pretendToBeVisual:true}),W=dom.window,calls=[];let f;
 t.after(()=>{f?.destroy();W.close();});
 for(const file of ['post-model.js','feed-filters.js','unapproved-filter.js'])W.eval(read(file));
 let current=settings;
 const reddit=async args=>{calls.push(args);
  if(args.action==='mod-status'){if(moderator instanceof Error)throw moderator;return {moderator,subreddit:'Alpha'};}
  if(args.action==='unapproved')return queue?queue(args,calls.filter(c=>c.action==='unapproved').length):{posts:[raw('q1'),raw('q2')],after:null,hasMore:false};
  throw Error('Unexpected '+args.action);};
 f=new W.RTUnapprovedFilter.UnapprovedFilter({observe:false,reddit,readSettings:async()=>current});
 await f.ready;await flush();
 return {W,D:W.document,f,calls,setSettings:async value=>{current=value;await f.loadSettings();await flush();},button:()=>W.document.querySelector('[data-rt-unapproved="button"]'),list:()=>W.document.querySelector('[data-rt-unapproved="list"]'),feed:()=>W.document.querySelector('shreddit-feed')};
}

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
