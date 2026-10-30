const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const read=f=>fs.readFileSync('extension/'+f,'utf8');
const tick=(ms=15)=>new Promise(r=>setTimeout(r,ms));
const track=o=>JSON.stringify(o).replace(/"/g,'&quot;');
// Synthetic markup shaped like Reddit's scoped search page.
const postUnit=(id,sub)=>`<search-telemetry-tracker data-testid="search-sdui-post" data-thingid="t3_${id}" data-faceplate-tracking-context="${track({post:{id:'t3_'+id,title:'Native '+id},subreddit:{name:sub}})}"><div data-testid="search-post-unit"><a href="/r/${sub}/">r/${sub}</a></div></search-telemetry-tracker>`;
const commentUnit=(id,sub)=>`<div data-testid="search-sdui-comment-unit"><search-telemetry-tracker data-faceplate-tracking-context="${track({comment:{id:'t1_'+id,post_id:'t3_p'},post:{id:'t3_p'},subreddit:{name:sub}})}"></search-telemetry-tracker><a href="/r/${sub}/">r/${sub}</a></div>`;
const page=units=>`<body><div data-testid="search-results-filter-spacer-desktop"><faceplate-dropdown-menu><button class="button-small pill">Sort</button><a href="/user/Ann/search/?q=cat&sort=new">New</a></faceplate-dropdown-menu><faceplate-dropdown-menu><button class="button-small pill">Time</button><a href="/user/Ann/search/?q=cat&t=day">Today</a></faceplate-dropdown-menu></div><main class="main"><div class="bg-neutral-background"><div id="list">${units}</div></div></main></body>`;
const item=(n,over={})=>({kind:'post',id:'a'+n,fullname:'t3_a'+n,title:'Cats of day '+n,body:'I like cat things '+n,author:'Ann',subreddit:'Alpha',created:1700000000-n*1000,score:5,comments:2,permalink:'https://www.reddit.com/r/Alpha/comments/a'+n+'/cats/',postType:'text',status:'unknown',archiveStatus:'unknown',...over});
function setup({url='https://www.reddit.com/user/Ann/search/?q=cat',units=postUnit('r1','Alpha')+postUnit('r2','Beta'),pages=null,archive=true,aggregate=null}={}){
  const dom=new JSDOM(page(units),{url,runScripts:'outside-only',pretendToBeVisual:true});const W=dom.window;
  W.__rtProfileSearchManual=true;
  for(const f of ['search-core.js','feed-filters.js'])W.eval(read(f));
  const calls=[];
  W.RTArchiveQuery={
    async *search(args){calls.push(args);const list=pages?pages(args,calls.length):[{items:[item(1),item(2),item(3),item(4)],searchedBackTo:1699000000,hasMore:false,cursor:null}];for(const p of list){if(p instanceof Error)throw p;yield p;}},
    aggregate:aggregate||(async()=>({ok:true,buckets:[{key:'Alpha',count:9},{key:'Gamma',count:2}]}))
  };
  W.RTArchiveView={skeleton:()=>{const d=W.document.createElement('div');d.dataset.rtSkeleton='true';return d;}};
  W.eval(read('profile-search.js'));
  const ctl=new W.RTProfileSearch.ProfileSearch({read:async()=>({archiveDiscovery:archive}),observe:false,delay:1,now:()=>1700500000});
  return {dom,W,calls,ctl,D:W.document};
}
const boot=async o=>{const s=setup(o);await s.ctl.load();await tick();return s;};
const sec=D=>D.querySelector('[data-rt-profile-search]');

test('activates only on the user search route with a query and the setting on',async t=>{
  const base=setup();t.after(()=>base.W.close());const R=base.W.RTProfileSearch.routeOf;
  assert.equal(R('/user/Ann/search/','?q=cat').username,'Ann');
  assert.equal(R('/user/Ann/search/','?q='),null);assert.equal(R('/user/Ann/','?q=cat'),null);assert.equal(R('/search/','?q=cat'),null);assert.equal(R('/user/Ann/submitted/','?q=cat'),null);
  const off=await boot({archive:false});t.after(()=>off.W.close());
  assert.equal(sec(off.D),null);assert.equal(off.calls.length,0);assert.equal(off.D.querySelector('[data-rt-profile-search-filter]'),null);
  const wrong=await boot({url:'https://www.reddit.com/user/Ann/?q=cat'});t.after(()=>wrong.W.close());
  assert.equal(sec(wrong.D),null);assert.equal(wrong.calls.length,0);
});
test('URL maps to query: type, t, sort, r/ scope and filters',async t=>{
  const a=await boot({url:'https://www.reddit.com/user/Ann/search/?q=cat+-dog+r/Alpha&type=comments&t=week&sort=top'});t.after(()=>a.W.close());
  const c=a.calls[0];assert.equal(c.kind,'comment');assert.equal(c.author,'Ann');assert.equal(c.subreddit,'Alpha');assert.equal(c.sort,'desc');assert.equal(c.after,1700500000-604800);assert.deepEqual([...c.parsed.excluded],['dog']);assert.equal(c.postTypes,undefined);
  const m=await boot({url:'https://www.reddit.com/user/Ann/search/?q=cat&type=media&rt_sort=old&rt_sub=A,B'});t.after(()=>m.W.close());
  assert.equal(m.calls[0].kind,'post');assert.deepEqual([...m.calls[0].postTypes],['image','gif','video','gallery']);assert.equal(m.calls[0].sort,'asc');assert.equal(m.calls[0].subreddit,undefined);
  assert.equal(m.calls[0].after,undefined);
});
test('dedupes against Reddit results and renders units with cues and highlights',async t=>{
  const {W,D}=await boot({pages:()=>[{items:[item(1,{fullname:'t3_r1',id:'r1'}),item(2),item(3,{body:'[deleted]'}),item(4,{archiveStatus:'removed'})],searchedBackTo:1699000000,hasMore:false}]});t.after(()=>W.close());
  const s=sec(D);assert.ok(s);assert.equal(s.nextElementSibling.getAttribute('data-thingid'),'t3_r1');
  assert.match(s.querySelector('h2').textContent,/Not in these results · from the archive/);
  const units=[...s.querySelectorAll('[data-rt-archive-result]')];
  assert.deepEqual(units.map(u=>u.dataset.rtArchiveResult),['t3_a2','t3_a3','t3_a4']);
  assert.deepEqual(units.map(u=>u.dataset.rtStatus),['archive','deleted','removed']);
  assert.equal(units[0].querySelector('[data-rt-status-cue]').textContent,'From the archive');
  assert.equal(units[0].querySelector('a.absolute').getAttribute('href'),'/r/Alpha/comments/a2/cats/');
  assert.ok(units[0].querySelector('faceplate-timeago[ts]'));assert.ok(units[0].querySelector('[data-testid="search-counter-row"]'));
  assert.equal(units[0].querySelector('[data-testid="post-title-text"] strong').textContent.toLowerCase(),'cat');
  assert.match(s.textContent,/Searched back to .*2023/);assert.doesNotMatch(s.textContent,/all results|complete/i);
  assert.equal(s.querySelector('[data-rt-show-all]'),null);
});
test('excluded words are not highlighted',async t=>{
  const {W,D}=await boot({url:'https://www.reddit.com/user/Ann/search/?q=cat+-dog',pages:()=>[{items:[item(2,{title:'cat and dog',body:''})],hasMore:false,searchedBackTo:1}]});t.after(()=>W.close());
  const bold=[...sec(D).querySelectorAll('strong')].map(x=>x.textContent.toLowerCase());assert.deepEqual(bold,['cat']);
});
test('Show all expands in place and Search older continues from the cursor',async t=>{
  const pages=(args,n)=>n===1
    ?[{items:[1,2,3,4,5].map(i=>item(i)),searchedBackTo:1699000000,hasMore:true,cursor:1699000000}]
    :[{items:[item(6),item(7)],searchedBackTo:1698000000,hasMore:false,cursor:null}];
  const {W,D,calls}=await boot({pages});t.after(()=>W.close());
  const s=sec(D);assert.equal(s.querySelectorAll('[data-rt-archive-result]').length,3);
  assert.equal(calls[0].cursor,undefined);assert.equal(calls[0].maxPages,3);
  assert.match(s.querySelector('[data-rt-show-all]').textContent,/\(5\)/);
  s.querySelector('[data-rt-show-all]').click();
  assert.equal(sec(D).querySelectorAll('[data-rt-archive-result]').length,5);assert.ok(sec(D).querySelector('[data-rt-search-older]'));
  sec(D).querySelector('[data-rt-search-older]').click();await tick();
  assert.equal(calls[1].cursor,1699000000);assert.equal(calls[1].maxPages,10);
  assert.equal(sec(D).querySelectorAll('[data-rt-archive-result]').length,7);assert.equal(sec(D).querySelector('[data-rt-search-older]'),null);
  assert.match(sec(D).textContent,/Searched back to/);
});
test('Subreddit dropdown filters Reddit units and the archive section',async t=>{
  const pages=()=>[{items:[item(1),item(2,{subreddit:'Gamma'}),item(3)],searchedBackTo:5,hasMore:false}];
  const {W,D,calls}=await boot({pages});t.after(()=>W.close());
  const btn=D.querySelector('[data-rt-subreddit-filter]');assert.ok(btn);
  assert.equal(btn.className.includes('button-small'),true);
  assert.equal(btn.closest('[data-rt-profile-search-filter]').previousElementSibling.tagName.toLowerCase(),'faceplate-dropdown-menu');
  btn.click();
  const opts=[...D.querySelectorAll('[data-rt-sub-option]')].map(o=>o.dataset.rtSubOption+':'+o.querySelector('[data-rt-option-tail]').textContent);
  assert.deepEqual(opts,['Alpha:9','Gamma:2','Beta:1']);// archive totals already include visible items: the larger count, not the sum
  D.querySelector('[data-rt-sub-option="Gamma"]').click();await tick();
  assert.equal(W.location.search.includes('rt_sub=Gamma'),true);
  assert.equal(D.querySelector('[data-thingid="t3_r1"]').hasAttribute('data-rt-filter-hidden'),true);
  assert.equal(D.querySelector('[data-thingid="t3_r2"]').hasAttribute('data-rt-filter-hidden'),true);
  assert.equal(calls.length,2);assert.equal(calls[1].subreddit,'Gamma');
  const chip=D.querySelector('[data-rt-chip="sub:gamma"]');assert.ok(chip);
  chip.querySelector('[data-rt-chip-remove]').click();await tick();
  assert.equal(W.location.search.includes('rt_sub'),false);assert.equal(D.querySelector('[data-rt-filter-hidden]'),null);assert.equal(calls.length,3);assert.equal(calls[2].subreddit,undefined);
});
test('two subreddit picks narrow the archive items locally',async t=>{
  const pages=()=>[{items:[item(1),item(2,{subreddit:'Gamma'}),item(3,{subreddit:'Delta'})],searchedBackTo:5,hasMore:false}];
  const {W,D,calls}=await boot({url:'https://www.reddit.com/user/Ann/search/?q=cat&rt_sub=Gamma,Delta',pages});t.after(()=>W.close());
  assert.equal(calls[0].subreddit,undefined);
  assert.deepEqual([...sec(D).querySelectorAll('[data-rt-archive-result]')].map(u=>u.dataset.rtArchiveResult),['t3_a2','t3_a3']);
  assert.equal(D.querySelectorAll('[data-rt-filter-hidden]').length,2);
});
test('counts fall back to loaded items when the aggregate fails',async t=>{
  const {W,D}=await boot({aggregate:async()=>{throw Object.assign(Error('t'),{code:'timeout'});}});t.after(()=>W.close());
  D.querySelector('[data-rt-subreddit-filter]').click();
  assert.equal(D.querySelector('[data-rt-counts-note]').textContent,'Counts from loaded items');
  assert.deepEqual([...D.querySelectorAll('[data-rt-sub-option]')].map(o=>o.dataset.rtSubOption).sort(),['Alpha','Beta']);
});
test('SPA navigation re-mounts and aborts the stale search; leaving the route cleans up',async t=>{
  let signal;const pages=args=>{signal=args.signal;return [{items:[item(2)],searchedBackTo:5,hasMore:false}];};
  const {W,D,ctl,calls}=await boot({pages});t.after(()=>W.close());
  const first=signal;assert.equal(first.aborted,false);
  W.history.pushState(null,'','/user/Ann/search/?q=dog&type=comments');ctl.tick();await tick();
  assert.equal(first.aborted,true);assert.equal(calls.length,2);assert.equal(calls[1].kind,'comment');assert.equal(D.querySelectorAll('[data-rt-profile-search]').length,1);
  const second=signal;
  W.history.pushState(null,'','/user/Ann/');ctl.tick();
  assert.equal(second.aborted,true);assert.equal(sec(D),null);assert.equal(D.querySelector('[data-rt-profile-search-filter]'),null);
});
test('the section is reserved with a skeleton while loading, and a late result is discarded after navigation',async t=>{
  let release;const gate=new Promise(r=>{release=r;});
  const {W,D,ctl}=setup();t.after(()=>W.close());
  let first=true;W.RTArchiveQuery.search=async function*(){if(first){first=false;await gate;yield {items:[item(2)],searchedBackTo:5,hasMore:false};}else yield {items:[],searchedBackTo:5,hasMore:false};};
  await ctl.load();await tick();
  assert.ok(sec(D).querySelector('[data-rt-skeleton]'));assert.ok(sec(D).querySelector('h2'));
  W.history.pushState(null,'','/user/Ann/search/?q=other');ctl.tick();await tick();
  release();await tick();
  assert.equal(D.querySelectorAll('[data-rt-archive-result]').length,0);
});
test('errors show a quiet note with Retry that resumes the search',async t=>{
  let n=0;const pages=()=>{n++;if(n===1)return [Object.assign(Error('Archive is busy'),{code:'rate-limited',retryAt:Date.now()+5000})];return [{items:[item(2)],searchedBackTo:5,hasMore:false}];};
  const {W,D,calls}=await boot({pages});t.after(()=>W.close());
  const note=D.querySelector('[data-rt-profile-search-error]');assert.ok(note);assert.match(note.textContent,/busy/i);assert.equal(note.classList.contains('text-neutral-content-weak'),true);
  D.querySelector('[data-rt-retry]').click();await tick();
  assert.equal(calls.length,2);assert.equal(D.querySelector('[data-rt-profile-search-error]'),null);assert.equal(D.querySelectorAll('[data-rt-archive-result]').length,1);
});
test('turning the archive setting off removes everything; exclusion-only queries stay inert',async t=>{
  const {W,D,ctl}=await boot();t.after(()=>W.close());
  assert.ok(sec(D));ctl.applySettings({archiveDiscovery:false});await tick();
  assert.equal(sec(D),null);assert.equal(D.querySelector('[data-rt-profile-search-filter]'),null);
  const x=await boot({url:'https://www.reddit.com/user/Ann/search/?q=-dog'});t.after(()=>x.W.close());
  assert.equal(x.calls.length,0);assert.equal(sec(x.D)?.hidden??true,true);
});
test('new Reddit results appended later re-dedupe the section',async t=>{
  const {W,D,ctl}=await boot({pages:()=>[{items:[item(1),item(2)],searchedBackTo:5,hasMore:false}]});t.after(()=>W.close());
  assert.equal(sec(D).querySelectorAll('[data-rt-archive-result]').length,2);
  D.getElementById('list').insertAdjacentHTML('beforeend',postUnit('a1','Alpha'));ctl.maintain();
  assert.deepEqual([...sec(D).querySelectorAll('[data-rt-archive-result]')].map(u=>u.dataset.rtArchiveResult),['t3_a2']);
  D.getElementById('list').insertAdjacentHTML('beforeend',commentUnit('c9','Alpha'));
  assert.equal(W.RTProfileSearch.unitInfo(D.querySelector('[data-testid="search-sdui-comment-unit"]')).id,'t1_c9');
});

// The Subreddit dropdown uses the same list component as the profile Feed options menu.
test('Subreddit dropdown is the shared list: search header, scroll list, icons, pinned picks and 8-pick limit',async t=>{
  const buckets=Array.from({length:12},(_,i)=>({key:'Sub'+String(i).padStart(2,'0'),count:50-i}));
  const {W,D}=await boot({aggregate:async()=>({ok:true,buckets})});t.after(()=>W.close());
  const asked=[];W.RTCommunityIcons={peek:()=>undefined,get:async name=>{asked.push(name);return name==='Sub02'?'https://styles.redditmedia.com/t5_2/styles/communityIcon_two.png':null;}};
  D.querySelector('[data-rt-subreddit-filter]').click();await tick();
  const panel=D.querySelector('.rt-profile-search-menu [data-rt-sub-panel]');assert.ok(panel);
  const head=panel.querySelector('.rt-sub-head');assert.equal(head.querySelector('[data-rt-sub-back]'),null,'no Back inside a dropdown');assert.equal(head.querySelector('input').placeholder,'Search communities');
  const list=panel.querySelector('.rt-sub-list'),rows=()=>[...list.querySelectorAll('[data-rt-sub-row]')];
  assert.ok(rows().length>=12);assert.ok(rows().every(r=>r.querySelector('.rt-community-icon')));assert.equal(D.querySelector('[data-rt-counts-note]').textContent,'Counts from the archive');
  await tick();assert.equal(rows().find(r=>r.dataset.rtSubRow==='Sub02').querySelector('img.rt-community-img').getAttribute('src'),'https://styles.redditmedia.com/t5_2/styles/communityIcon_two.png');
  rows().find(r=>r.dataset.rtSubRow==='Sub05').click();await tick();
  assert.equal(rows()[0].dataset.rtSubRow,'Sub05','picked rows are pinned first');assert.ok(rows()[0].querySelector('[data-rt-check]'));
  for(const k of ['Sub00','Sub01','Sub02','Sub03','Sub04','Sub06','Sub07']){rows().find(r=>r.dataset.rtSubRow===k).click();await tick(2);}
  assert.equal(W.location.search.match(/rt_sub=([^&]*)/)[1].split(',').length,8);
  const blocked=rows().filter(r=>r.getAttribute('aria-disabled')==='true');assert.ok(blocked.length>=4);assert.match(blocked[0].title,/Up to 8 communities/);
  blocked[0].click();await tick(2);assert.equal(W.location.search.match(/rt_sub=([^&]*)/)[1].split(',').length,8);
  assert.match(D.querySelector('[data-rt-counts-note]').textContent,/Counts from the archive · Up to 8 communities/);
  assert.match(fs.readFileSync('extension/post-discovery.css','utf8'),/\.rt-sub-list\{[^}]*overflow-y:auto;overscroll-behavior:contain;max-height:min\(320px/);
  assert.equal(D.querySelectorAll('.rt-sub-panel').length,1);D.querySelector('[data-rt-subreddit-filter]').click();D.querySelector('[data-rt-subreddit-filter]').click();await tick();assert.equal(D.querySelectorAll('.rt-sub-panel').length,1,'reopening reuses the panel');
});
test('Subreddit dropdown footer: Loading counts, then archive or loaded items, never the wrong one',async t=>{
  let release;const gate=new Promise(r=>release=r);
  const {W,D}=await boot({aggregate:async()=>{await gate;return {ok:true,buckets:[{key:'Alpha',count:9}]};}});t.after(()=>W.close());
  D.querySelector('[data-rt-subreddit-filter]').click();assert.equal(D.querySelector('[data-rt-counts-note]').textContent,'Loading counts…');
  release();await tick(30);assert.equal(D.querySelector('[data-rt-counts-note]').textContent,'Counts from the archive');
});
