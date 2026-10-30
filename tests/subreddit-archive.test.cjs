const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');

const modalHtml=(title,name='gone')=>`<guard-community-modal isdesktop="" isloggedin="" subredditname="${name}" subredditid="t5_x" actioned=""><div slot="titleGraphic" class="flex"><svg></svg></div><div slot="closeButton"><a class="button-secondary icon button" href="/"></a></div><div slot="primaryButton"><a class="w-100 button-medium button-primary button inline-flex" href="/"><span><span>Browse Other Communities</span></span></a></div><div slot="title" class="text-24 s:text-20">${title}</div><div><p>This subreddit has been banned for violating the reddit rules</p></div></guard-community-modal>`;
const quarantineHtml='<guard-community-modal subredditname="gone" actioned=""><div slot="title">r/gone is quarantined</div><div><button class="button-primary">Yes, Continue</button></div></guard-community-modal>';
const post=(id,created,extra={})=>({id,fullname:'t3_'+id,kind:'post',title:'Title '+id,body:'Body '+id,author:'alice',subreddit:'gone',created,score:1,comments:0,permalink:'/r/gone/comments/'+id+'/t/',media:[],postType:'self',...extra});
const comment=(id,created,extra={})=>({id,fullname:'t1_'+id,kind:'comment',title:'Title',body:'Comment '+id,author:'alice',subreddit:'gone',created,score:1,comments:0,permalink:'/r/gone/comments/abc/t/'+id+'/',media:[],...extra});
const tick=async()=>{for(let i=0;i<6;i++)await new Promise(r=>setImmediate(r));};

// Loads the scripts into a synthetic Reddit page with mocked archive/recents services.
async function boot(opts){
  // The script under test defines the class; construct after it loads.
  const dom=new JSDOM('<!doctype html><body><shreddit-app>'+(opts?.html??modalHtml('r/gone is banned'))+'</shreddit-app></body>',{url:opts?.url||'https://www.reddit.com/r/gone/',runScripts:'outside-only',pretendToBeVisual:true}),W=dom.window;
  const o={enabled:true,pages:null,owner:'me',meta:null,recents:null,...opts};
  for(const f of ['search-core.js','post-model.js','archive-view.js','post-discovery.js','feed-filters.js','subreddit-archive.js'])W.eval(fs.readFileSync('extension/'+f,'utf8'));
  const calls=[],store=o.recents || new Map();
  W.RTArchiveQuery={
    async *search(options){calls.push(options);const list=o.pages?o.pages(options,calls.length):[{items:[post('a1',1500000000),post('a2',1400000000)],searchedBackTo:1400000000,hasMore:false,cursor:null}];for(const page of list){if(page instanceof Error)throw page;yield page;}},
    async subreddit(){if(!o.meta)throw Object.assign(Error('not in archive'),{code:'not-found'});return {ok:true,subreddit:o.meta};}
  };
  W.RTRecentSearches={
    async list(ow,s){return [...(store.get(ow+'|'+s)||[])].map(q=>({q,at:1}));},
    async add(ow,s,q){const k=ow+'|'+s,l=(store.get(k)||[]).filter(x=>x!==q);l.unshift(q);store.set(k,l);return [];},
    async remove(ow,s,q){const k=ow+'|'+s;store.set(k,(store.get(k)||[]).filter(x=>x!==q));return [];},
    async clear(ow,s){store.delete(ow+'|'+s);return [];}
  };
  const sa=new W.RTSubredditArchive.SubredditArchive({observe:false,readSettings:async()=>({enabled:o.enabled}),getOwner:()=>o.owner});
  await sa.ready;
  return {W,doc:W.document,sa,calls,store};
}
const button=doc=>doc.querySelector('[data-rt-ui="subreddit-archive-action"] button');
const open=async ctx=>{button(ctx.doc).click();await tick();};

test('trigger only for banned (and private) communities',async()=>{
  for(const [title,expected] of [['r/gone is banned',true],['r/gone is private',true],['r/gone is quarantined',false]]){
    const {doc}=await boot({html:modalHtml(title)});assert.equal(Boolean(button(doc)),expected,title);
  }
  const quarantine=await boot({html:quarantineHtml});assert.equal(button(quarantine.doc),null);assert.equal(quarantine.doc.querySelector('guard-community-modal').children.length,2);
  const none=await boot({html:''});assert.equal(none.doc.querySelector('[data-rt-ui]'),null);
  const live=await boot({html:'<main><shreddit-feed><shreddit-post id="t3_x"></shreddit-post></shreddit-feed></main>'});assert.equal(live.doc.querySelector('[data-rt-ui]'),null);
  assert.equal(live.doc.querySelector('shreddit-post').parentElement.children.length,1);
});
test('archive setting off adds nothing and releases an early hold',async()=>{
  const ctx=await boot({enabled:false,url:'https://www.reddit.com/r/gone/?rt_view=archive',html:modalHtml('r/gone is banned').replace('<guard-community-modal','<guard-community-modal data-rt-subreddit-hold="true" style="display:none !important"')});
  assert.equal(button(ctx.doc),null);assert.equal(ctx.doc.querySelector('[data-rt-ui="archive-subreddit"]'),null);
  const modal=ctx.doc.querySelector('guard-community-modal');assert.equal(modal.hasAttribute('data-rt-subreddit-hold'),false);assert.equal(modal.style.display,'');
});
test('button is a secondary-styled sibling in the modal and click mounts the view and sets rt_view',async()=>{
  const ctx=await boot(),{doc,W}=ctx,b=button(doc);
  assert.match(b.className,/button-secondary/);assert.match(b.className,/button-medium/);assert.equal(b.textContent.trim(),'Browse archived posts');assert.equal(b.parentElement.getAttribute('slot'),'primaryButton');
  assert.ok(doc.querySelector('guard-community-modal a.button-primary'),"Reddit's own buttons stay");
  W.history.replaceState({keep:1},'',W.location.pathname);
  b.click();await tick();
  assert.equal(new W.URLSearchParams(W.location.search).get('rt_view'),'archive');assert.deepEqual(W.history.state,{keep:1});
  const modal=doc.querySelector('guard-community-modal');assert.equal(modal.style.display,'none');
  assert.ok(doc.querySelector('[data-rt-ui="archive-subreddit"]'));assert.equal(doc.querySelectorAll('guard-community-modal').length,1);
});
test('reload with rt_view=archive mounts directly; early hold keeps the modal from flashing',async()=>{
  const ctx=await boot({url:'https://www.reddit.com/r/gone/?rt_view=archive'});await tick();
  assert.ok(ctx.doc.querySelector('[data-rt-ui="archive-subreddit"]'));
  // profile-notice.js holds the modal from document_start.
  const dom=new JSDOM('<!doctype html><body><shreddit-app>'+modalHtml('r/gone is banned')+'</shreddit-app></body>',{url:'https://www.reddit.com/r/gone/?rt_view=archive',runScripts:'outside-only'}),W=dom.window;
  W.chrome={runtime:{id:'x',sendMessage:async()=>({ok:true,settings:{postDiscovery:true,archiveDiscovery:true}})}};
  W.eval(fs.readFileSync('extension/profile-notice.js','utf8'));
  const modal=W.document.querySelector('guard-community-modal');assert.equal(modal.style.display,'none');assert.equal(modal.getAttribute('data-rt-subreddit-hold'),'true');
  await tick();assert.equal(modal.style.display,'none','stays held once settings allow the archive');
  // Quarantined communities and a normal URL are never held.
  for(const [html,url] of [[quarantineHtml,'https://www.reddit.com/r/gone/?rt_view=archive'],[modalHtml('r/gone is banned'),'https://www.reddit.com/r/gone/']]){
    const d=new JSDOM('<!doctype html><body><shreddit-app>'+html+'</shreddit-app></body>',{url,runScripts:'outside-only'}).window;
    d.chrome={runtime:{id:'x',sendMessage:async()=>({ok:true,settings:{archiveDiscovery:true}})}};d.eval(fs.readFileSync('extension/profile-notice.js','utf8'));
    assert.equal(d.document.querySelector('guard-community-modal').style.display,'');
  }
  // Archive off in settings: released.
  const off=new JSDOM('<!doctype html><body><shreddit-app>'+modalHtml('r/gone is banned')+'</shreddit-app></body>',{url:'https://www.reddit.com/r/gone/?rt_view=archive',runScripts:'outside-only'}).window;
  off.chrome={runtime:{id:'x',sendMessage:async()=>({ok:true,settings:{postDiscovery:true,archiveDiscovery:false}})}};off.eval(fs.readFileSync('extension/profile-notice.js','utf8'));
  await tick();assert.equal(off.document.querySelector('guard-community-modal').style.display,'');
});
test('removing rt_view (Back) restores Reddit’s modal',async()=>{
  const ctx=await boot({url:'https://www.reddit.com/r/gone/?rt_view=archive'}),{W,doc,sa}=ctx;await tick();
  assert.equal(doc.querySelector('guard-community-modal').style.display,'none');
  W.history.replaceState(null,'','/r/gone/');sa.scan();
  assert.equal(doc.querySelector('[data-rt-ui="archive-subreddit"]'),null);assert.equal(doc.querySelector('guard-community-modal').style.display,'');assert.ok(button(doc),'button stays on the restored modal');
  assert.equal(doc.documentElement.hasAttribute('data-rt-subreddit-archive'),false);
});
test('header without metadata: glyph, r/name, Reddit’s wording and cue; no members/created',async()=>{
  const ctx=await boot({url:'https://www.reddit.com/r/gone/?rt_view=archive'}),{doc}=ctx;await tick();
  assert.equal(doc.querySelector('h1').textContent,'r/gone');
  const state=doc.querySelector('[data-testid="subreddit-archive-state"]');assert.equal(state.textContent,'r/gone is banned · Showing archived posts');assert.ok(state.querySelector('svg'));
  assert.ok(doc.querySelector('.rt-sra-glyph'));assert.equal(doc.querySelector('.rt-sra-facts'),null);
  const tabs=doc.querySelector('faceplate-tabgroup');assert.deepEqual([...tabs.querySelectorAll('[data-rt-tab]')].map(t=>t.textContent),['Posts','Comments']);
  assert.match(doc.querySelector('aside').textContent,/Partial archive coverage/);assert.ok(doc.querySelector('aside a[href*="arctic-shift"]'));
});
test('header with metadata shows icon, title, members and created',async()=>{
  const ctx=await boot({url:'https://www.reddit.com/r/gone/?rt_view=archive',meta:{name:'gone',title:'Gone Community',subscribers:12345,created:1300000000,icon:'https://styles.redditmedia.com/t5_x/styles/icon.png'}}),{doc}=ctx;await tick();
  assert.equal(doc.querySelector('.rt-sra-facts').textContent.startsWith('12,345 members · Created '),true);assert.match(doc.querySelector('.rt-sra-avatar').textContent+doc.querySelector('.rt-sra-state').textContent,/banned/);
  assert.match(doc.querySelector('h1').parentElement.textContent,/Gone Community/);
});
test('feed renders archive cards, stats and a "Searched back to" status; never claims completeness',async()=>{
  const ctx=await boot({url:'https://www.reddit.com/r/gone/?rt_view=archive'}),{doc}=ctx;await tick();
  assert.equal(doc.querySelectorAll('shreddit-feed shreddit-post').length,2);assert.match(doc.querySelector('shreddit-post').getAttribute('subreddit-name'),/gone/);
  assert.match(doc.querySelector('.rt-sra-searched').textContent,/^Searched back to /);assert.doesNotMatch(doc.body.textContent,/complete archive|fully loaded/i);
  assert.equal(doc.querySelector('aside dl').textContent.includes('2'),true);
  assert.equal(ctx.calls[0].subreddit,'gone');assert.equal(ctx.calls[0].kind,'post');assert.equal(ctx.calls[0].sort,'desc');
});
test('NSFW archive items do not restore media',async()=>{
  const ctx=await boot({url:'https://www.reddit.com/r/gone/?rt_view=archive',pages:()=>[{items:[post('n1',1500000000,{over18:true,media:[{kind:'image',url:'https://i.redd.it/x.png'}]})],searchedBackTo:1500000000,hasMore:false,cursor:null}]});await tick();
  assert.equal(ctx.doc.querySelector('img[src*="i.redd.it"]'),null);assert.match(ctx.doc.querySelector('shreddit-feed').textContent,/NSFW or spoiler/);
});
test('tab switch loads comments with kind=comment and sets rt_tab',async()=>{
  const ctx=await boot({url:'https://www.reddit.com/r/gone/?rt_view=archive',pages:o=>[{items:[o.kind==='comment'?comment('c1',1500000000):post('p1',1500000000)],searchedBackTo:1500000000,hasMore:false,cursor:null}]});await tick();
  ctx.doc.querySelector('[data-rt-tab="comments"]').click();await tick();
  assert.equal(ctx.calls.at(-1).kind,'comment');assert.equal(new ctx.W.URLSearchParams(ctx.W.location.search).get('rt_tab'),'comments');
  assert.equal(ctx.doc.querySelectorAll('shreddit-profile-comment').length,1);assert.equal(ctx.doc.querySelector('[data-rt-tab="comments"]').getAttribute('aria-current'),'page');
  assert.equal(ctx.doc.querySelector('[data-rt-row-hidden]'),null);
  ctx.doc.querySelector('[data-rt-tab="posts"]').click();await tick();assert.equal(ctx.doc.querySelectorAll('shreddit-post').length,1);assert.equal(new ctx.W.URLSearchParams(ctx.W.location.search).has('rt_tab'),false);
  const reload=await boot({url:'https://www.reddit.com/r/gone/?rt_view=archive&rt_tab=comments'});await tick();assert.equal(reload.calls[0].kind,'comment');
});
test('sort Old uses ascending archive order; Top is loaded-only and labelled',async()=>{
  const ctx=await boot({url:'https://www.reddit.com/r/gone/?rt_view=archive',pages:()=>[{items:[post('a1',1500000000,{score:1,comments:9}),post('a2',1400000000,{score:50,comments:1})],searchedBackTo:1400000000,hasMore:false,cursor:null}]}),{doc,W}=ctx;await tick();
  ctx.sa.menuButton.click();assert.equal(ctx.sa.menuEl.hidden,false);
  doc.querySelector('[data-rt-option="old"]').click();await tick();
  assert.equal(ctx.calls.at(-1).sort,'asc');assert.equal(new W.URLSearchParams(W.location.search).get('rt_sort'),'old');assert.ok(doc.querySelector('[data-rt-chip="sort"]'));
  assert.equal(doc.querySelector('[data-rt-option="old"]').getAttribute('aria-checked'),'true');
  const before=ctx.calls.length;
  ctx.sa.menuButton.click();doc.querySelector('[data-rt-option="top"]').click();await tick();
  assert.equal(ctx.calls.length,before,'top reuses the already loaded desc feed');
  assert.deepEqual([...doc.querySelectorAll('shreddit-post')].map(p=>p.id),['t3_a2','t3_a1']);
  assert.match(doc.querySelector('.rt-sra-note').textContent,/loaded items only/);assert.equal(new W.URLSearchParams(W.location.search).get('rt_top'),'1');
  doc.querySelector('[data-rt-chip="top"] button').click();await tick();assert.equal(new W.URLSearchParams(W.location.search).has('rt_top'),false);
  ctx.sa.menuButton.click();doc.querySelector('[data-rt-option="comments"]').click();await tick();
  assert.deepEqual([...doc.querySelectorAll('shreddit-post')].map(p=>p.id),['t3_a1','t3_a2']);assert.match(doc.querySelector('.rt-sra-note').textContent,/comment count among loaded/);
  doc.querySelector('[data-rt-filter-clear]').click();await tick();assert.equal(new W.URLSearchParams(W.location.search).has('rt_sort'),false);
});
test('date and type filters narrow the feed and chips remove them',async()=>{
  const now=Math.floor(Date.now()/1000);
  const ctx=await boot({url:'https://www.reddit.com/r/gone/?rt_view=archive',pages:()=>[{items:[post('new1',now-3600,{postType:'self'}),post('img1',now-7200,{postType:'image',media:[{kind:'image',url:'https://i.redd.it/a.png'}]}),post('old1',now-86400*400)],searchedBackTo:now-86400*400,hasMore:false,cursor:null}]}),{doc,W}=ctx;await tick();
  assert.equal(doc.querySelectorAll('shreddit-post').length,3);
  ctx.sa.menuButton.click();doc.querySelector('[data-rt-option="week"]').click();await tick();
  assert.equal(doc.querySelectorAll('shreddit-post').length,2);assert.equal(new W.URLSearchParams(W.location.search).get('rt_date'),'week');
  const range=ctx.calls.at(-1);assert.ok(range.after>0);
  ctx.sa.menuButton.click();doc.querySelector('[data-rt-option="image"]').click();await tick();
  assert.deepEqual([...doc.querySelectorAll('shreddit-post')].map(p=>p.id),['t3_img1']);assert.equal(new W.URLSearchParams(W.location.search).get('rt_type'),'image');
  assert.equal(doc.querySelectorAll('[data-rt-chip]').length,2);
  doc.querySelector('[data-rt-chip="type:image"] button').click();await tick();assert.equal(doc.querySelectorAll('shreddit-post').length,2);
  doc.querySelector('[data-rt-chip="date"] button').click();await tick();assert.equal(doc.querySelectorAll('shreddit-post').length,3);assert.equal(doc.querySelectorAll('[data-rt-chip]').length,0);
  assert.equal(doc.querySelector('[data-rt-option="video"]').hidden,false);
  doc.querySelector('[data-rt-tab="comments"]').click();await tick();assert.equal(doc.querySelector('[data-rt-option="image"]').hidden,true);
});
test('search: u/author narrows by author, operators go through the query, Enter submits and clearing returns to the feed',async()=>{
  const ctx=await boot({url:'https://www.reddit.com/r/gone/?rt_view=archive'}),{doc,sa}=ctx;await tick();
  const input=doc.querySelector('.rt-sra-input');assert.equal(input.placeholder,'Search r/gone');
  const feedCalls=ctx.calls.length;
  input.value='u/Bob (cats OR dogs) -mice';input.dispatchEvent(new ctx.W.Event('input'));
  assert.equal(ctx.calls.length,feedCalls,'typing never searches');
  doc.querySelector('form.rt-sra-search').dispatchEvent(new ctx.W.Event('submit',{cancelable:true}));await tick();
  const call=ctx.calls.at(-1);assert.equal(call.author,'bob');assert.equal(call.subreddit,'gone');assert.ok(call.parsed.expr);assert.ok(call.parsed.excluded.length>0 || JSON.stringify(call.parsed.expr).includes('not'));
  assert.equal(ctx.sa.query,'u/Bob (cats OR dogs) -mice');
  const call2=await (async()=>{input.value='cats OR dogs -mice';doc.querySelector('form').dispatchEvent(new ctx.W.Event('submit',{cancelable:true}));await tick();return ctx.calls.at(-1);})();
  assert.equal(call2.author,undefined);assert.equal(ctx.W.RCSCore.toArchiveQuery(call2.parsed).length>0,true);
  input.value='';input.dispatchEvent(new ctx.W.Event('input'));await tick();assert.equal(sa.query,'');
  // An invalid query shows a hint and does not search.
  const n=ctx.calls.length;input.value='a OR';doc.querySelector('form').dispatchEvent(new ctx.W.Event('submit',{cancelable:true}));await tick();
  assert.equal(ctx.calls.length,n);assert.equal(doc.querySelector('.rt-sra-hint').hidden,false);
});
test('Search older continues from the cursor and shows how far back it searched',async()=>{
  const pages=(o)=>o.cursor?[{items:[post('b1',1300000000)],searchedBackTo:1300000000,hasMore:false,cursor:null}]:[{items:[post('a1',1500000000)],searchedBackTo:1450000000,hasMore:true,cursor:1450000001}];
  const ctx=await boot({url:'https://www.reddit.com/r/gone/?rt_view=archive',pages}),{doc}=ctx;await tick();
  const input=doc.querySelector('.rt-sra-input');input.value='hello';doc.querySelector('form').dispatchEvent(new ctx.W.Event('submit',{cancelable:true}));await tick();
  assert.match(doc.querySelector('.rt-sra-searched').textContent,/^Searched back to /);
  const more=doc.querySelector('[data-rt-more]');assert.equal(more.textContent,'Search older');more.click();await tick();
  assert.equal(ctx.calls.at(-1).cursor,1450000001);assert.equal(doc.querySelectorAll('shreddit-post').length,2);assert.equal(doc.querySelector('[data-rt-more]'),null);
  assert.match(doc.querySelector('.rt-sra-foot').textContent,/Coverage may be partial/);
});
test('recent searches are saved on submit only, listed when the empty field is focused, removable and clearable',async()=>{
  const ctx=await boot({url:'https://www.reddit.com/r/gone/?rt_view=archive'}),{doc,store}=ctx;await tick();
  const input=doc.querySelector('.rt-sra-input'),form=doc.querySelector('form');
  input.value='abc';input.dispatchEvent(new ctx.W.Event('input'));await tick();assert.equal(store.size,0,'not per keystroke');
  form.dispatchEvent(new ctx.W.Event('submit',{cancelable:true}));await tick();assert.deepEqual(store.get('me|subreddit:gone'),['abc']);
  input.value='second';form.dispatchEvent(new ctx.W.Event('submit',{cancelable:true}));await tick();
  input.value='';input.dispatchEvent(new ctx.W.Event('input'));input.dispatchEvent(new ctx.W.Event('focus'));await tick();
  const recent=doc.querySelector('.rt-sra-recent');assert.equal(recent.hidden,false);assert.deepEqual([...recent.querySelectorAll('[data-rt-recent]')].map(b=>b.dataset.rtRecent),['second','abc']);
  recent.querySelector('[data-rt-recent-remove="second"]').click();await tick();assert.deepEqual(store.get('me|subreddit:gone'),['abc']);
  recent.querySelector('[data-rt-recent="abc"]').click();await tick();assert.equal(ctx.sa.query,'abc');
  input.value='';input.dispatchEvent(new ctx.W.Event('input'));await tick();
  doc.querySelector('[data-rt-recent-clear]').click();await tick();assert.equal(store.has('me|subreddit:gone'),false);assert.equal(doc.querySelector('.rt-sra-recent').hidden,true);
  const typed=await boot({url:'https://www.reddit.com/r/gone/?rt_view=archive',owner:''});await tick();const field=typed.doc.querySelector('.rt-sra-input');field.value='x';typed.doc.querySelector('form').dispatchEvent(new typed.W.Event('submit',{cancelable:true}));await tick();assert.equal(typed.store.size,0,'no owner, nothing saved');
});
test('errors show a quiet note with Retry, and Retry loads again',async()=>{
  let fail=true;
  const ctx=await boot({url:'https://www.reddit.com/r/gone/?rt_view=archive',pages:()=>fail?[Object.assign(Error('The archive is busy.'),{code:'rate-limited',retryAt:Date.now()+30000})]:[{items:[post('r1',1500000000)],searchedBackTo:1500000000,hasMore:false,cursor:null}]}),{doc}=ctx;await tick();
  const note=doc.querySelector('.rt-sra-error');assert.match(note.textContent,/The archive is busy\./);assert.equal(doc.querySelectorAll('shreddit-post').length,0);
  fail=false;note.querySelector('[data-rt-retry]').click();await tick();
  assert.equal(doc.querySelector('.rt-sra-error'),null);assert.equal(doc.querySelectorAll('shreddit-post').length,1);
});
test('paging continues from the cursor on load more and shows a skeleton while loading',async()=>{
  let release;const gate=new Promise(r=>{release=r;});
  const ctx=await boot({url:'https://www.reddit.com/r/gone/?rt_view=archive',pages:o=>o.cursor?null:[{items:[post('a1',1500000000)],searchedBackTo:1500000000,hasMore:true,cursor:1499999999}]});await tick();
  assert.equal(ctx.calls.length,1);const {sa,doc,W}=ctx;
  W.RTArchiveQuery.search=async function*(options){ctx.calls.push(options);await gate;yield {items:[post('a2',1400000000)],searchedBackTo:1400000000,hasMore:false,cursor:null};};
  sa.loadMore();assert.ok(doc.querySelector('[data-rt-skeleton]'));assert.equal(ctx.calls.at(-1).cursor,1499999999);
  release();await tick();assert.equal(doc.querySelector('[data-rt-skeleton]'),null);assert.equal(doc.querySelectorAll('shreddit-post').length,2);
});
test('RTPostDiscovery.archiveCard draws inert native-looking cards for non-profile pages',()=>{
  const W=new JSDOM('<main></main>',{url:'https://www.reddit.com/r/gone/',runScripts:'outside-only',pretendToBeVisual:true}).window;
  for(const f of ['post-model.js','archive-view.js','post-discovery.js'])W.eval(fs.readFileSync('extension/'+f,'utf8'));
  const card=W.RTPostDiscovery.archiveCard(post('abc12',1400000000)),native=card.querySelector('shreddit-post');
  assert.ok(native);assert.equal(native.getAttribute('subreddit-name'),'gone');assert.ok(native.hasAttribute('inert'));assert.match(card.textContent,/Body abc12/);assert.equal(card.querySelector('[data-rt-source]').dataset.state,'unknown');
  const reply=W.RTPostDiscovery.archiveCard(comment('c1',1400000000));assert.ok(reply.querySelector('shreddit-profile-comment'));assert.equal(reply.querySelector('shreddit-comment-action-row').hasAttribute('inert'),true);
});

// The popover uses the same rows, sections and chips as the profile Feed options menu (it has no Subreddit filter).
test('Feed options popover: icon-less Date rows, sectioned multi-select Post type, shared chips',async()=>{
  const now=Math.floor(Date.now()/1000);
  const ctx=await boot({url:'https://www.reddit.com/r/gone/?rt_view=archive&rt_date=year&rt_type=gif,poll',pages:()=>[{items:[post('a1',now-3600,{postType:'gif'}),post('a2',now-7200,{postType:'poll'}),post('a3',now-9000,{postType:'image'})],searchedBackTo:now-9000,hasMore:false,cursor:null}]}),{doc,W}=ctx;await tick();
  const menu=ctx.sa.menuEl;ctx.sa.menuButton.click();
  assert.deepEqual([...menu.querySelectorAll('[data-rt-section]')].map(n=>n.dataset.rtSection),['Sort','Date','Post type','Text','Media','Links']);
  for(const row of menu.querySelectorAll('[data-rt-option="any"],[data-rt-option="24h"],[data-rt-option="year"],[data-rt-option="custom"]'))assert.equal(row.querySelector('.rt-menu-lead'),null);
  const expect={text:'text-post',textmedia:'collection',poll:'list-bulleted',image:'image',video:'video',gallery:'gallery',link:'link',embed:'browser',crosspost:'rotate'};
  for(const [id,name] of Object.entries(expect))assert.equal(menu.querySelector('[data-rt-option="'+id+'"] .rt-menu-lead').getAttribute('icon-name'),name,id);
  assert.equal(menu.querySelector('[data-rt-option="gif"] .rt-gif-tag').textContent,'GIF');assert.equal(menu.querySelector('[data-rt-option="all"]').getAttribute('aria-label'),'All types');
  assert.equal(menu.querySelector('[data-rt-option="gif"]').getAttribute('aria-checked'),'true');assert.equal(menu.querySelector('[data-rt-option="poll"]').getAttribute('aria-checked'),'true');
  assert.deepEqual([...doc.querySelectorAll('shreddit-post')].map(p=>p.id).sort(),['t3_a1','t3_a2']);
  // Multi-select keeps the popover open; a single choice closes it.
  menu.querySelector('[data-rt-option="video"]').click();await tick();assert.equal(ctx.sa.menuOpen,true);assert.equal(new W.URLSearchParams(W.location.search).get('rt_type'),'gif,poll,video');
  menu.querySelector('[data-rt-option="week"]').click();await tick();assert.equal(ctx.sa.menuOpen,false);
  assert.equal(doc.querySelector('[data-rt-chip="type:gif"] .rt-gif-tag').textContent,'GIF');assert.equal(doc.querySelector('[data-rt-chip="date"] [icon-name="calendar"]')!==null,true);
  assert.equal(doc.querySelector('[data-rt-filter-clear]').textContent,'Clear filters');assert.equal(menu.querySelector('[data-rt-sub-panel]'),null);
});
