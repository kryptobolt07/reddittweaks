const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const ext=file=>fs.readFileSync(path.join(__dirname,'../extension',file),'utf8');

// Synthetic layout: every visible pill is 100 px, the add-sender button 32 px, the +N chip 40 px.
function layout(rail,state){
  const used=()=>[...rail.children].filter(node=>!node.hidden && !node.hasAttribute('data-rcs-fit-hidden')).reduce((sum,node)=>sum+(node.matches('.rcs-rail-more')?40:node.matches('.room-add-sender,.global-filter-add')?32:node.matches('.sender-chip,.filter-chip,.date-chip')?100:0),0);
  Object.defineProperty(rail,'scrollWidth',{configurable:true,get:used});Object.defineProperty(rail,'clientWidth',{configurable:true,get:()=>state.width});
}
function pill(d,cls,label,onRemove){
  const el=d.createElement('span');el.className=cls;const text=d.createElement('span');text.className='sender-chip-value';text.textContent=label;
  const remove=d.createElement('button');remove.setAttribute('aria-label','Remove '+label);remove.addEventListener('click',onRemove);el.append(text,remove);return el;
}
function railFixture(t,{phone=false,sheet=null}={}){
  const dom=new JSDOM('<!doctype html><body></body>',{url:'https://www.reddit.com/chat',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
  w.matchMedia=query=>({matches:phone && /max-width/.test(query),addEventListener(){},removeEventListener(){}});
  if(sheet)w.RTFeedSheet=sheet;
  w.eval(ext('chat-filter-rail.js'));
  const d=w.document,host=d.createElement('div'),shadow=host.attachShadow({mode:'open'}),bar=d.createElement('div'),rail=d.createElement('div');
  rail.className='room-applied-filters';bar.append(rail);shadow.append(bar);d.body.append(host);
  const removed=[],state={width:260};layout(rail,state);
  const labels=['You','Other people','Images','Before Jan 1','On or after Jan 1, 2025'];
  for(const label of labels)rail.append(pill(d,'sender-chip',label,()=>{removed.push(label);}));
  const add=d.createElement('button');add.className='room-add-sender';rail.insertBefore(add,rail.children[2]);
  t.after(()=>w.close());
  return {w,d,shadow,rail,state,removed,labels,add,fit:()=>w.RCSFilterRail.fit(rail),visible:()=>[...rail.children].filter(node=>node.matches('.sender-chip') && !node.hasAttribute('data-rcs-fit-hidden')).map(node=>node.querySelector('.sender-chip-value').textContent),more:()=>rail.querySelector('.rcs-rail-more')};
}

test('chat rail never scrolls: pills that do not fit hide behind +N and the add button stays',t=>{
  const f=railFixture(t);f.fit();
  assert.deepEqual(f.visible(),['You'],'one 100 px pill, the 32 px add button and the 40 px chip fit in 260 px');
  assert.equal(f.more().textContent,'+4');assert.equal(f.rail.getAttribute('data-rcs-fit'),'partial');
  assert.equal(f.add.hasAttribute('data-rcs-fit-hidden'),false,'the add-sender button is never hidden by fitting');
  assert.equal(f.rail.scrollWidth<=f.rail.clientWidth,true);
  f.state.width=520;f.fit();assert.deepEqual(f.visible(),f.labels.slice(0,4),'a wider rail shows more pills, still in order');assert.equal(f.more().textContent,'+1');
  f.state.width=900;f.fit();assert.deepEqual(f.visible(),f.labels);assert.equal(f.more(),null);assert.equal(f.rail.hasAttribute('data-rcs-fit'),false);
  f.state.width=60;f.fit();assert.deepEqual(f.visible(),[]);assert.equal(f.more().textContent,'5 filters','with no room for a pill the chip counts them');assert.equal(f.rail.getAttribute('data-rcs-fit'),'collapsed');
});

test('chat rail refits when its own width changes and when pills are re-rendered',async t=>{
  const f=railFixture(t);let observed=null;
  f.w.ResizeObserver=class{constructor(callback){observed=callback;}observe(){}disconnect(){}};
  f.fit();assert.equal(typeof observed,'function');assert.equal(f.more().textContent,'+4');
  f.state.width=900;observed();await new Promise(resolve=>f.w.requestAnimationFrame(resolve));assert.equal(f.more(),null,'a resize refits without a render');
  f.rail.querySelector('.sender-chip').remove();f.state.width=260;f.fit();assert.equal(f.more().textContent,'+3');assert.equal(f.rail.querySelectorAll('.rcs-rail-more').length,1,'a refit never stacks chips');
});

test('+N popover lives in the chat shadow root, lists every filter and removes through the pill handlers',t=>{
  const f=railFixture(t);f.fit();f.more().click();
  const list=f.shadow.querySelector('.rcs-rail-list');assert.ok(list,'the popover is inside the shadow root');assert.equal(f.d.querySelector('.rcs-rail-list'),null);
  assert.equal(f.more().getAttribute('aria-expanded'),'true');
  assert.deepEqual([...list.querySelectorAll('.rcs-rail-list-label')].map(node=>node.textContent),f.labels,'hidden and shown filters are all listed');
  list.querySelectorAll('.rcs-rail-list-remove')[3].click();
  assert.deepEqual(f.removed,['Before Jan 1']);assert.equal(f.shadow.querySelector('.rcs-rail-list'),null,'the list closes after a removal');
  f.more().click();f.shadow.querySelector('.rcs-rail-list-clear').click();
  assert.deepEqual(f.removed.slice(1),[...f.labels].reverse(),'Clear all removes each filter');assert.equal(f.shadow.querySelector('.rcs-rail-list'),null);
});

test('+N popover closes on Escape, an outside press and a second click on the chip',t=>{
  const f=railFixture(t);f.fit();
  f.more().click();assert.ok(f.shadow.querySelector('.rcs-rail-list'));
  f.shadow.querySelector('.rcs-rail-list button').dispatchEvent(new f.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,composed:true,cancelable:true}));
  assert.equal(f.shadow.querySelector('.rcs-rail-list'),null);assert.equal(f.more().getAttribute('aria-expanded'),'false');
  f.more().click();f.d.body.dispatchEvent(new f.w.Event('pointerdown',{bubbles:true,composed:true}));assert.equal(f.shadow.querySelector('.rcs-rail-list'),null);
  f.more().click();assert.ok(f.shadow.querySelector('.rcs-rail-list'));f.more().click();assert.equal(f.shadow.querySelector('.rcs-rail-list'),null);
});

test('on a phone-width window the list is the phone sheet, not a popover',t=>{
  const opened=[];
  const sheet={open(options){const rows=[];const ui={row:row=>rows.push(row),divider(){}};options.build(null,ui);opened.push({options,rows});return {close(){opened.length=0;}};}};
  const f=railFixture(t,{phone:true,sheet});f.fit();f.more().click();
  assert.equal(f.shadow.querySelector('.rcs-rail-list'),null);assert.equal(opened.length,1);assert.equal(opened[0].options.title,'Applied filters');
  const rows=opened[0].rows;assert.deepEqual(rows.slice(0,5).map(row=>row.label),f.labels);assert.equal(rows[5].label,'Clear all filters');
  assert.equal(rows[0].action.label,'Remove filter You');assert.ok(rows[0].action.icon,'each row has a remove button');
  rows[1].onSelect();assert.deepEqual(f.removed,['Other people']);
  rows[5].onSelect();assert.equal(f.removed.length,6,'Clear all removes the five remaining filters too');
  const without=railFixture(t,{phone:true});without.fit();without.more().click();assert.ok(without.shadow.querySelector('.rcs-rail-list'),'without the sheet module the popover is the fallback');
});

test('the chat list and room rails call the shared fit after rendering filters',()=>{
  const source=ext('unified-search.js');
  assert.match(source,/globalThis\.RCSFilterRail\?\.fit\(this\.chips\)/,'chat list rail');
  assert.match(source,/globalThis\.RCSFilterRail\?\.fit\(tools\.senderChips\)/,'room rail');
});

test('chat rails are clipped, not scrollable, and ship with the shared module',()=>{
  const css=ext('unified-search-styles.js')+ext('content.js');
  for(const line of css.split('\n'))if(/global-filter-rail|room-applied-filters/.test(line))assert.doesNotMatch(line,/overflow-x:\s*auto|scrollbar-width:\s*none/,'a rail row must not scroll sideways: '+line.trim().slice(0,90));
  assert.match(css,/\[data-rcs-fit-hidden\]\s*\{\s*display:none\s*!important/);
  const manifest=JSON.parse(ext('manifest.json')),group=manifest.content_scripts.find(entry=>entry.js.includes('unified-search.js')).js;
  assert.ok(group.indexOf('chat-filter-rail.js')>=0 && group.indexOf('chat-filter-rail.js')<group.indexOf('unified-search.js'),'the module loads before the chat UI');
  const tool=css.indexOf('RCSUnifiedToolStyles+=chips'),rule=css.indexOf('[data-rcs-fit-hidden]');assert.ok(rule>0 && rule<tool,'the fit rules are part of the block shared with the room shadow root');
});
