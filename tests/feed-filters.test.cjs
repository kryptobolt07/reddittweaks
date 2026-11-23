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
  assert.deepEqual(JSON.parse(JSON.stringify(F.mergeCounts([{key:'a',count:5},{key:'b',count:2}],[{subreddit:'B'},{subreddit:'c'}]))),[{key:'a',count:5},{key:'b',count:2},{key:'c',count:1}]);
});
test('chips render a working x for each filter and one Clear filters',t=>{
  const {W,F}=load();t.after(()=>W.close());
  const d=W.document,make=(tag,cls,text)=>{const el=d.createElement(tag);if(cls)el.className=cls;if(text)el.textContent=text;return el;},glyph=k=>{const s=d.createElement('span');s.dataset.icon=k;return s;};
  const box=d.createElement('div');d.body.append(box);let state=F.clone(full);
  const draw=()=>F.renderChips(box,state,{make,glyph,onChange:next=>{state=next;draw();}});draw();
  assert.equal(box.querySelectorAll('[data-rt-chip]').length,6);
  // Reddit's element may add attributes in its constructor: createElement would throw, parsing must not.
  const W2=W;if(!W2.customElements.get('rpl-input-chip'))W2.customElements.define('rpl-input-chip',class extends W2.HTMLElement{constructor(){super();this.setAttribute('data-upgraded','');}});
  const strict=F.pill({id:'x',label:'X',icon:'calendar'},{make,glyph,onRemove:()=>{}});d.body.append(strict);assert.equal(strict.hasAttribute('data-upgraded'),true);strict.remove();
  const pillEl=box.querySelector('[data-rt-chip="date"]');assert.equal(pillEl.tagName,'RPL-INPUT-CHIP');assert.equal(pillEl.getAttribute('appearance'),'bordered');assert.ok(pillEl.querySelector('[slot="leading"] .rt-filter-chip-icon'));assert.ok(pillEl.querySelector('.rt-filter-chip-label.text-label-2'));assert.ok(pillEl.querySelector('[slot="trailing"] button.rt-filter-chip-remove'));
  // A real click is mousedown, mouseup, click; the chip must survive until the click.
  const x=box.querySelector('[data-rt-chip="type:image"] button');x.dispatchEvent(new W.MouseEvent('mousedown',{bubbles:true}));assert.ok(x.isConnected);x.dispatchEvent(new W.MouseEvent('mouseup',{bubbles:true}));x.click();
  assert.deepEqual([...state.types],['text']);assert.equal(box.querySelector('[data-rt-chip="type:image"]'),null);
  box.querySelector('[data-rt-chip="date"] button').click();assert.equal(state.date,null);
  box.querySelector('[data-rt-chip="sub:alpha"] button').click();assert.deepEqual([...state.subreddits],['beta']);
  assert.equal(box.querySelectorAll('[data-rt-filter-clear]').length,1);box.querySelector('[data-rt-filter-clear]').click();
  assert.equal(F.isActive(state),false);assert.equal(box.hidden,true);assert.equal(box.children.length,0);
});

test('hourPreset and allPresets support Past hour while preserving existing presets',t=>{
  const {W,F}=load();t.after(()=>W.close());
  assert.deepEqual([...F.presets.map(p=>p.id)],['24h','week','month','year']);
  assert.deepEqual({...F.hourPreset},{id:'hour',label:'Past hour',seconds:3600});
  assert.deepEqual([...F.allPresets.map(p=>p.id)],['hour','24h','week','month','year']);
  const state=F.parse('?rt_date=hour');
  assert.deepEqual({...state.date},{preset:'hour'});
  assert.deepEqual({...F.serialize(state)},{rt_date:'hour'});
  const now=1700003600;
  assert.deepEqual({...F.dateRange(state,now)},{after:1700000000,before:null});
  const pred=F.predicate(state,now);
  assert.equal(pred({created:1700001000}),true);
  assert.equal(pred({created:1699999000}),false);
  assert.equal(F.dateLabel(state.date),'Past hour');
  assert.equal(F.dateShort(state.date),'Past hour');
  assert.equal(F.valueLabels(state).date,'Past hour');
  assert.equal(F.chipList(state)[0].label,'Past hour');
});

test('native filter chips upgrade with native constructors without assigning HTML, and labels remain text',t=>{
 const {W,F}=load();t.after(()=>W.close());W.customElements.define('rpl-input-chip',class extends W.HTMLElement{constructor(){super();this.setAttribute('data-upgraded','true');}});const descriptor=Object.getOwnPropertyDescriptor(W.Element.prototype,'innerHTML');Object.defineProperty(W.Element.prototype,'innerHTML',{...descriptor,set(value){if(value)throw Error('HTML sink blocked');return descriptor.set.call(this,value);}});const make=(tag,cls,text)=>{const el=W.document.createElement(tag);if(cls)el.className=cls;if(text)el.textContent=text;return el;},container=make('div');W.document.body.append(container);F.renderChips(container,{...F.empty(),subreddits:['Alpha']},{make,glyph:()=>W.document.createElementNS('http://www.w3.org/2000/svg','svg'),onChange(){}});const chip=container.querySelector('rpl-input-chip');assert.equal(chip.getAttribute('data-upgraded'),'true');assert.match(chip.textContent,/Alpha/);assert.equal(chip.getAttribute('appearance'),'bordered');assert.throws(()=>F.parsedElement('rpl-input-chip onclick=alert(1)'),/Invalid custom element/);const label='<img src=x onerror=alert(1)>',literal=F.pill({id:'date',kind:'date',label},{make,glyph:()=>W.document.createElementNS('http://www.w3.org/2000/svg','svg'),onRemove(){}});assert.equal(literal.querySelector('.rt-filter-chip-label').textContent,label);assert.equal(literal.querySelector('[onerror]'),null);
});
test('applied filters: badge on the owner button, one summary chip on computers, list with removal, badge only when no room',t=>{
  const {W,F}=load();t.after(()=>W.close());
  const d=W.document,make=(tag,cls,text)=>{const el=d.createElement(tag);if(cls)el.className=cls;if(text)el.textContent=text;return el;},glyph=k=>{const s=d.createElement('span');s.dataset.icon=k;return s;};
  const box=d.createElement('div');box.dataset.rtRail='true';d.body.append(box);let width=400,textRoom=300;
  // Synthetic layout: the summary chip is its text (8 px per character, capped by the room) plus 60 px of icon and ×.
  const summaryText=()=>box.querySelector('.rt-filter-summary-text');
  Object.defineProperty(box,'scrollWidth',{get:()=>{const t=summaryText();return t?Math.min(t.textContent.length*8,textRoom)+60:0;}});Object.defineProperty(box,'clientWidth',{get:()=>width});
  Object.defineProperty(W.HTMLElement.prototype,'scrollWidth',{configurable:true,get(){return this.classList.contains('rt-filter-summary-text')?this.textContent.length*8:0;}});
  Object.defineProperty(W.HTMLElement.prototype,'clientWidth',{configurable:true,get(){return this.classList.contains('rt-filter-summary-text')?Math.min(this.textContent.length*8,textRoom):0;}});
  const owner=d.createElement('button');owner.textContent='Sort & filter';d.body.append(owner);
  let state=F.clone(full);const draw=()=>{F.renderChips(box,state,{make,glyph,onChange:next=>{state=next;draw();}});F.fitRail(box,{badgeFor:owner});};draw();
  const pills=()=>[...box.querySelectorAll('[data-rt-chip]')];
  assert.equal(pills().filter(node=>!node.hidden).length,0,'pills are data only');
  assert.equal(owner.getAttribute('data-rt-filter-count'),'6');assert.equal(owner.querySelector('.rt-filter-count').textContent,'6');
  const chip=box.querySelector('.rt-filter-summary');assert.ok(chip);assert.equal(summaryText().textContent,'6 filters','truncated names give way to the count');
  assert.match(chip.querySelector('.rt-filter-summary-open').getAttribute('aria-label'),/^6 filters applied: /);
  chip.querySelector('.rt-filter-summary-open').click();const list=d.querySelector('[data-rt-ui="applied-filters"]');assert.ok(list);assert.equal(list.querySelectorAll('.rt-filter-list-row').length,6);
  list.querySelector('.rt-filter-list-row:last-child .rt-filter-list-remove').click();assert.equal(d.querySelector('[data-rt-ui="applied-filters"]'),null);
  assert.equal(pills().length,5,'removing from the list removes that filter');assert.equal(owner.getAttribute('data-rt-filter-count'),'5');
  textRoom=2000;width=2100;F.fitRail(box);assert.equal(summaryText().textContent,pills().map(node=>node.querySelector('.rt-filter-chip-label').textContent).join(' · '),'names when they fit');
  width=30;textRoom=300;F.fitRail(box);assert.ok(box.hasAttribute('data-rt-collapsed'));assert.equal(box.querySelector('.rt-filter-summary'),null);assert.equal(owner.getAttribute('data-rt-filter-count'),'5','badge stays');
  width=2000;F.fitRail(box);box.querySelector('.rt-filter-summary-clear').click();assert.equal(box.hidden,true);assert.equal(owner.hasAttribute('data-rt-filter-count'),false);
});
