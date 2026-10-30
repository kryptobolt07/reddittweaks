const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
function load(url='https://www.reddit.com/user/Example/submitted/?sort=top&t=week'){
  const dom=new JSDOM('<body></body>',{url,runScripts:'outside-only'});dom.window.eval(fs.readFileSync('extension/feed-filters.js','utf8'));return {dom,W:dom.window,F:dom.window.RTFeedFilters};
}
const full={date:{from:'2026-01-02',to:'2026-01-05'},types:['image','text'],subreddits:['Alpha','beta'],sort:'old'};
test('filters round-trip through the URL and keep Reddit params and history state',t=>{
  const {W,F}=load();t.after(()=>W.close());
  W.history.replaceState({reddit:1},'');
  assert.equal(F.write(full,W),true);
  assert.equal(W.location.search,'?sort=top&t=week&rt_date=2026-01-02..2026-01-05&rt_type=image,text&rt_sub=Alpha,beta&rt_sort=old');
  assert.deepEqual(W.history.state,{reddit:1});
  assert.deepEqual(JSON.parse(JSON.stringify(F.read(W.location))),full);
  assert.equal(F.write(F.empty(),W),true);assert.equal(W.location.search,'?sort=top&t=week');assert.equal(F.write(F.empty(),W),false);
});
test('parse ignores invalid values, caps subreddits and normalizes presets',t=>{
  const {W,F}=load();t.after(()=>W.close());
  assert.equal(F.parse('?rt_date=nonsense&rt_type=bogus&rt_sort=hot').date,null);
  assert.deepEqual(F.parse('?rt_date=2026-02-30..2026-03-01').date,null);
  assert.deepEqual(JSON.parse(JSON.stringify(F.parse('?rt_date=2026-03-05..2026-03-01').date)),{from:'2026-03-01',to:'2026-03-05'});
  assert.deepEqual(JSON.parse(JSON.stringify(F.parse('?rt_date=week').date)),{preset:'week'});
  assert.equal(F.parse('?rt_sub='+Array.from({length:12},(_,i)=>'s'+i).join(',')).subreddits.length,8);
  assert.deepEqual([...F.parse('?rt_sub=r/Foo,foo,/r/bar').subreddits],['Foo','bar']);
  assert.deepEqual(JSON.parse(JSON.stringify(F.parse(''))),JSON.parse(JSON.stringify(F.empty())));
});
test('predicate combines date, type and subreddit',t=>{
  const {W,F}=load();t.after(()=>W.close());
  const noon=day=>Math.floor(new Date(day+'T12:00:00').getTime()/1000);
  const p=F.predicate({date:{from:'2026-01-02',to:'2026-01-05'},types:['image'],subreddits:['Alpha'],sort:null});
  const item=(over={})=>({created:noon('2026-01-03'),postType:'image',subreddit:'alpha',kind:'post',...over});
  assert.equal(p(item()),true);assert.equal(p(item({created:noon('2026-01-05')})),true);
  assert.equal(p(item({created:noon('2026-01-06')})),false);assert.equal(p(item({created:noon('2026-01-01')})),false);
  assert.equal(p(item({postType:'text'})),false);assert.equal(p(item({subreddit:'other'})),false);assert.equal(p(item({kind:'comment'})),false);
  assert.equal(F.predicate(F.empty())(item({postType:'',kind:'comment',subreddit:''})),true);
  const now=noon('2026-03-10'),week=F.predicate({...F.empty(),date:{preset:'week'}},now);
  assert.equal(week({created:now-3*86400}),true);assert.equal(week({created:now-9*86400}),false);
  assert.equal(F.predicate({...F.empty(),types:['video']})({postType:'hosted:video',kind:'post'}),true);
});
test('inferType and subreddit counts',t=>{
  const {W,F}=load();t.after(()=>W.close());
  assert.equal(F.inferType({postType:'gallery'}),'gallery');assert.equal(F.inferType({url:'https://example.com/a',permalink:'https://www.reddit.com/r/x/comments/abc/'}),'link');
  assert.equal(F.inferType({url:'https://www.reddit.com/r/x/comments/abc/',media:[]}),'text');assert.equal(F.inferType({media:[{kind:'image'},{kind:'image'}]}),'gallery');
  assert.deepEqual(JSON.parse(JSON.stringify(F.mergeCounts([{key:'a',count:5},{key:'b',count:2}],[{subreddit:'B'},{subreddit:'c'}]))),[{key:'a',count:5},{key:'b',count:3},{key:'c',count:1}]);
});
test('chips render a working x for each filter and one Clear filters',t=>{
  const {W,F}=load();t.after(()=>W.close());
  const d=W.document,make=(tag,cls,text)=>{const el=d.createElement(tag);if(cls)el.className=cls;if(text)el.textContent=text;return el;},glyph=k=>{const s=d.createElement('span');s.dataset.icon=k;return s;};
  const box=d.createElement('div');d.body.append(box);let state=F.clone(full);
  const draw=()=>F.renderChips(box,state,{make,glyph,onChange:next=>{state=next;draw();}});draw();
  assert.equal(box.querySelectorAll('[data-rt-chip]').length,6);
  // A real click is mousedown, mouseup, click; the chip must survive until the click.
  const x=box.querySelector('[data-rt-chip="type:image"] button');x.dispatchEvent(new W.MouseEvent('mousedown',{bubbles:true}));assert.ok(x.isConnected);x.dispatchEvent(new W.MouseEvent('mouseup',{bubbles:true}));x.click();
  assert.deepEqual([...state.types],['text']);assert.equal(box.querySelector('[data-rt-chip="type:image"]'),null);
  box.querySelector('[data-rt-chip="date"] button').click();assert.equal(state.date,null);
  box.querySelector('[data-rt-chip="sub:alpha"] button').click();assert.deepEqual([...state.subreddits],['beta']);
  assert.equal(box.querySelectorAll('[data-rt-filter-clear]').length,1);box.querySelector('[data-rt-filter-clear]').click();
  assert.equal(F.isActive(state),false);assert.equal(box.hidden,true);assert.equal(box.children.length,0);
});
