const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
function setup(t,options={}) {
  const dom=new JSDOM('<!doctype html><body></body>',{runScripts:'outside-only'});t.after(()=>dom.window.close());const W=dom.window;
  for(const name of ['search-core.js','date-picker.js'])W.eval(readFileSync(join(__dirname,'../extension',name),'utf8'));
  const changes=[],picker=new W.RCSDatePicker({...options,onChange:(dates,label)=>changes.push({dates:JSON.parse(JSON.stringify(dates)),label})});picker.today=()=>options.today||'2026-10-29';W.document.body.append(picker.element);picker.show();
  const month=(y,m)=>{picker.element.querySelector('.calendar-year').click();picker.element.querySelector(`[data-year="${y}"]`).click();picker.element.querySelector('.calendar-month').click();picker.element.querySelector(`[data-month="${m}"]`).click();};
  return {W,picker,changes,month};
}
test('calendar glyphs render their paths without writing SVG innerHTML',t=>{
  const dom=new JSDOM('<!doctype html><body></body>',{runScripts:'outside-only'});t.after(()=>dom.window.close());const W=dom.window;
  W.eval(readFileSync(join(__dirname,'../extension','search-core.js'),'utf8'));
  const descriptor=Object.getOwnPropertyDescriptor(W.Element.prototype,'innerHTML');
  Object.defineProperty(W.Element.prototype,'innerHTML',{...descriptor,set(value){if(this.namespaceURI==='http://www.w3.org/2000/svg')throw new Error('SVG innerHTML writes are blocked');return descriptor.set.call(this,value);}});
  W.eval(readFileSync(join(__dirname,'../extension','date-picker.js'),'utf8'));
  const picker=new W.RCSDatePicker();W.document.body.append(picker.element);picker.show();
  const paths=[...picker.element.querySelectorAll('.calendar-nav-button svg path')];
  assert.equal(paths.length,2);assert.deepEqual(paths.map(path=>path.getAttribute('d')),['m15 6-6 6 6 6','m9 6 6 6-6 6']);
  const caret=picker.element.querySelector('.calendar-month svg path');assert.equal(caret.getAttribute('d'),'m6 9 6 6 6-6');
  const svg=caret.parentElement;assert.equal(svg.getAttribute('viewBox'),'0 0 24 24');assert.equal(svg.getAttribute('stroke'),'currentColor');assert.equal(svg.getAttribute('stroke-width'),'2');assert.equal(svg.getAttribute('aria-hidden'),'true');
});
test('a range uses one calendar with accent endpoints and interior days, and commits only on Apply',t=>{
  const {picker,changes,month}=setup(t);month(2026,9);
  picker.element.querySelector('[data-date="2026-10-08"]').click();assert.equal(picker.element.querySelector('.calendar-apply').disabled,true);
  picker.element.querySelector('[data-date="2026-10-05"]').click();
  assert.equal(picker.element.querySelectorAll('.selected').length,2);assert.equal(picker.element.querySelectorAll('.range').length,2);assert.equal(changes.length,0);
  picker.element.querySelector('.calendar-apply').click();assert.deepEqual(changes[0].dates,{from:'2026-10-05',to:'2026-10-08'});assert.equal(picker.open,false);
});
test('On, Before and After have distinct whole-day semantics',t=>{
  const {picker,changes,month}=setup(t);
  for(const [mode,expected]of [['On',{from:'2026-10-08',to:'2026-10-08'}],['Before',{from:'',to:'2026-10-07'}],['After',{from:'2026-10-09',to:''}]]) {
    picker.show();picker.element.querySelector(`[data-mode="${mode}"]`).click();month(2026,9);picker.element.querySelector('[data-date="2026-10-08"]').click();picker.element.querySelector('.calendar-apply').click();
    assert.deepEqual(changes.at(-1).dates,expected);
  }
});
test('range selection works across months, and Escape discards uncommitted changes',t=>{
  const {W,picker,changes,month}=setup(t);month(2026,0);picker.element.querySelector('[data-date="2026-01-31"]').click();
  picker.element.querySelector('[aria-label="Next month"]').click();picker.element.querySelector('[data-date="2026-02-02"]').click();picker.element.querySelector('.calendar-apply').click();
  assert.deepEqual(changes[0].dates,{from:'2026-01-31',to:'2026-02-02'});
  picker.show();picker.element.querySelector('[data-date="2026-01-15"]').click();picker.element.dispatchEvent(new W.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  assert.equal(changes.length,1);assert.equal(picker.applied.start,'2026-01-31');assert.equal(picker.open,false);
});
test('keyboard navigation crosses month boundaries without applying or fetching anything',t=>{
  const {W,picker,changes,month}=setup(t);month(2026,0);
  const day=picker.element.querySelector('[data-date="2026-01-31"]');day.focus();day.dispatchEvent(new W.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
  assert.equal(W.document.activeElement.dataset.date,'2026-02-01');assert.equal(changes.length,0);
});
test('themed month/year choices support keyboard navigation and Escape without losing the draft range',t=>{
  const {W,picker,changes,month}=setup(t);month(2026,9);picker.element.querySelector('[data-date="2026-10-05"]').click();
  picker.element.querySelector('.calendar-month').click();assert.equal(picker.element.querySelectorAll('select').length,0);
  const october=picker.element.querySelector('[data-month="9"]');october.focus();october.dispatchEvent(new W.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));assert.equal(W.document.activeElement.dataset.month,'8');W.document.activeElement.click();
  assert.equal(picker.view.getMonth(),8);assert.equal(picker.draft.start,'2026-10-05');
  picker.element.querySelector('.calendar-year').click();picker.element.dispatchEvent(new W.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  assert.equal(picker.open,true);assert.equal(picker.chooser,'');assert.equal(W.document.activeElement.className,'calendar-year');assert.equal(changes.length,0);
});

test('restoring the calendar retains strict date validation and exclusive boundary guards',t=>{
  const {picker,changes}=setup(t);picker.draft={mode:'On',start:'2025-02-29',end:''};assert.equal(picker.bounds(),null);picker.choose('2025-02-30');assert.equal(picker.draft.start,'2025-02-29');
  picker.draft={mode:'Before',start:'0001-01-01',end:''};assert.equal(picker.bounds(),null);picker.draft={mode:'After',start:'9999-12-31',end:''};assert.equal(picker.bounds(),null);assert.equal(changes.length,0);
});
test('the restored grid keeps one tab stop and existing week/month keyboard navigation',t=>{
  const {W,picker,changes,month}=setup(t);month(2026,0);picker.focusDay('2026-01-31');const key=name=>W.document.activeElement.dispatchEvent(new W.KeyboardEvent('keydown',{key:name,bubbles:true,cancelable:true}));
  key('PageDown');assert.equal(W.document.activeElement.dataset.date,'2026-02-28');assert.equal(picker.element.querySelectorAll('[data-date][tabindex="0"]').length,1);key('Home');assert.equal(W.document.activeElement.dataset.date,'2026-02-22');key('End');assert.equal(W.document.activeElement.dataset.date,'2026-02-28');key('PageUp');assert.equal(W.document.activeElement.dataset.date,'2026-01-28');assert.equal(changes.length,0);
});
test('placement stays below the chat ribbon and closing releases its listeners',t=>{
  const {W,picker}=setup(t),root=picker.element;picker.getBounds=()=>({left:20,right:320,top:120,bottom:400});root.getBoundingClientRect=()=>({left:30,right:302,top:80,bottom:380,width:272,height:300});Object.defineProperties(root,{offsetWidth:{value:272},offsetHeight:{value:300},offsetTop:{value:80}});root.style.top='80px';picker.place();assert.ok(parseFloat(root.style.top)>=124);assert.ok(parseFloat(root.style.maxHeight)<=270);assert.doesNotThrow(()=>picker.positionListener({target:W}));picker.close();assert.equal(picker.positionListener,null);
});

test('global quick ranges are chips in the same row, select inclusive local periods, clamp to today and wait for Apply',t=>{
  const {picker,changes}=setup(t);picker.today=()=> '2026-10-14';picker.render();assert.equal(picker.element.querySelector('.calendar-quick'),null);assert.equal(picker.chooser,'');
  assert.deepEqual([...picker.element.querySelectorAll('.calendar-presets [data-preset]')].map(button=>button.dataset.preset),['Today','Yesterday','Last 7 days','Last 30 days','This month','Last month','This year']);
  const expected={'Today':['2026-10-14','On'],'Yesterday':['2026-10-13','On'],'Last 7 days':['2026-10-08','Between','2026-10-14'],'Last 30 days':['2026-09-15','Between','2026-10-14'],'This month':['2026-10-01','Between','2026-10-14'],'Last month':['2026-09-01','Between','2026-09-30'],'This year':['2026-01-01','Between','2026-10-14']};
  for(const [label,[start,mode,end]]of Object.entries(expected)){picker.element.querySelector(`[data-preset="${label}"]`).click();assert.equal(picker.draft.mode,mode,label);assert.equal(picker.draft.start,start,label);assert.equal(picker.draft.end,end||'',label);assert.equal(picker.chooser,'');assert.equal(changes.length,0);assert.equal(picker.element.querySelector(`[data-preset="${label}"]`).getAttribute('aria-pressed'),'true',label);}
  picker.element.querySelector('.calendar-apply').click();assert.deepEqual(changes[0].dates,{from:'2026-01-01',to:'2026-10-14'});picker.today=()=> '2024-03-02';assert.equal(picker.quickRanges().find(range=>range.label==='Last month').end,'2024-02-29');picker.today=()=> '2026-01-03';assert.equal(picker.quickRanges().find(range=>range.label==='Last 7 days').start,'2025-12-28');
});
test('Escape after choosing a chip discards the draft and keeps the applied filter',t=>{
  const {W,picker,changes}=setup(t);picker.today=()=> '2026-10-14';picker.render();picker.chooseRange(picker.quickRanges()[2]);picker.apply();picker.show();
  assert.equal(picker.element.querySelector('[data-preset="Last 7 days"]').getAttribute('aria-pressed'),'true');
  picker.element.querySelector('[data-preset="This year"]').click();picker.element.dispatchEvent(new W.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(picker.open,false);picker.show();
  assert.equal(picker.draft.start,'2026-10-08');assert.equal(picker.draft.end,'2026-10-14');assert.equal(changes.length,1);
});
test('weeks are grid rows that omit only unused weeks, while the grid keeps six-row height',t=>{
  const {picker,month}=setup(t);for(const [m,days,rows]of [[1,28,4],[9,31,5],[4,31,6]]){month(2026,m);const grid=picker.element.querySelector('.calendar-grid');assert.equal(grid.querySelectorAll('.calendar-week[role=row]').length,rows);assert.equal(grid.querySelectorAll('[data-date]').length,days);assert.equal(grid.querySelectorAll('[role=gridcell]').length,days);assert.equal(grid.querySelectorAll('[tabindex="0"]').length,1);}
});


test('chat calendar shows four immediate quick ranges and starts with On',t=>{
  const {picker,changes}=setup(t,{chatMode:true});picker.today=()=> '2026-10-14';picker.render();
  assert.equal(picker.draft.mode,'On');assert.equal(picker.element.querySelector('.calendar-quick'),null);
  assert.deepEqual([...picker.element.querySelectorAll('[data-preset]')].map(button=>button.dataset.preset),['Today','Yesterday','Last 7 days','Last 30 days']);
  assert.equal(picker.element.querySelector('.calendar-apply').disabled,true);
  picker.element.querySelector('[data-preset="Yesterday"]').click();assert.equal(picker.draft.mode,'On');assert.equal(picker.draft.start,'2026-10-13');assert.equal(changes.length,0);
  assert.ok(picker.element.querySelector('.calendar-grid'));assert.equal(picker.element.querySelector('.calendar-apply').disabled,false);
  picker.element.querySelector('[data-preset="Last 7 days"]').click();assert.equal(picker.draft.mode,'Between');picker.apply();assert.deepEqual(changes[0].dates,{from:'2026-10-08',to:'2026-10-14'});
  picker.reset();assert.equal(picker.draft.mode,'On');
});
test('chat calendar excludes future days and keyboard movement beyond today',t=>{
  const {W,picker,month}=setup(t,{chatMode:true});picker.today=()=> '2026-10-14';month(2026,9);
  assert.equal(picker.element.querySelector('[data-date="2026-10-15"]').getAttribute('aria-disabled'),'true');picker.choose('2026-10-15');assert.equal(picker.draft.start,'');assert.match(picker.element.querySelector('.calendar-summary').textContent,/after Oct 14/i);
  picker.focusDay('2026-10-14');W.document.activeElement.dispatchEvent(new W.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));assert.equal(W.document.activeElement.dataset.date,'2026-10-14');
  picker.chooseRange({start:'2026-10-01',end:'2026-10-31'});assert.equal(picker.draft.start,'');
  for(const range of picker.quickRanges())assert.ok(range.end<='2026-10-14');
  picker.draft={mode:'After',start:'2026-10-14',end:''};assert.equal(picker.bounds(),null);
});
test('cached-day dots never restrict incomplete history, verified bounds are optional',t=>{
  let availability={days:['2026-10-08'],min:'2026-10-08',max:'2026-10-09'};
  const {picker,month}=setup(t,{chatMode:true,getAvailability:()=>availability});picker.today=()=> '2026-10-14';month(2026,9);
  assert.equal(picker.element.querySelector('[data-date="2026-10-01"]').hasAttribute('aria-disabled'),false);assert.equal(picker.element.querySelector('[data-date="2026-10-14"]').hasAttribute('aria-disabled'),false);
  assert.ok(picker.element.querySelector('[data-date="2026-10-08"].has-messages'));
  availability={...availability,verified:true};picker.render();assert.equal(picker.element.querySelector('[data-date="2026-10-01"]').getAttribute('aria-disabled'),'true');assert.equal(picker.element.querySelector('[data-date="2026-10-14"]').getAttribute('aria-disabled'),'true');
  assert.equal(picker.element.querySelector('[data-preset="Last 7 days"]').disabled,true);
});
test('the footer status describes the next step and why Apply is disabled',t=>{
  const {picker}=setup(t,{chatMode:true});picker.today=()=> '2026-10-14';picker.element.querySelector('[data-mode="Between"]').click();
  const status=()=>picker.element.querySelector('.calendar-instruction');
  assert.equal(status().textContent,'Choose a start date');assert.ok(status().classList.contains('calendar-summary'),'one status element serves both hooks');assert.equal(picker.element.querySelectorAll('[aria-live]').length,1);assert.equal(picker.element.querySelector('.calendar-apply').disabled,true);
  picker.choose('2026-10-05');assert.match(status().textContent,/5.*→ select end/);assert.equal(picker.element.querySelector('.calendar-apply').disabled,true);
  picker.choose('2026-10-08');assert.match(status().textContent,/5.*→.*8/);assert.equal(picker.element.querySelector('.calendar-apply').disabled,false);
  const footer=picker.element.querySelector('.calendar-footer'),children=[...picker.element.children];assert.ok(footer.contains(status()));assert.ok(footer.contains(picker.element.querySelector('.calendar-apply')));assert.ok(children.indexOf(footer)>children.indexOf(picker.element.querySelector('.calendar-body')));
  picker.element.querySelector('[data-mode="After"]').click();picker.choose('2026-10-14');assert.match(status().textContent,/No dates after Oct 14/);assert.equal(picker.element.querySelector('.calendar-apply').disabled,true);
});
test('chat calendar can anchor directly below the triggering date chip',t=>{
  const {picker}=setup(t,{chatMode:true,getAnchor:()=>({left:55,bottom:150})}),root=picker.element;picker.getBounds=()=>({left:20,right:400,top:120,bottom:500});root.getBoundingClientRect=()=>({left:30,right:294,top:80,bottom:380,width:264,height:300});Object.defineProperties(root,{offsetWidth:{value:264},offsetHeight:{value:300},offsetTop:{value:80},offsetLeft:{value:30}});root.style.top='80px';picker.place();assert.equal(root.style.top,'154px');assert.equal(root.style.left,'55px');
});

test('room calendar opens directly with quick ranges and retains Apply and draft cancellation',t=>{
  const {picker,changes,W}=setup(t,{chatMode:true});assert.ok(picker.element.querySelector('.calendar-grid'));assert.equal(picker.element.querySelector('.date-range-options'),null);assert.equal(picker.element.querySelectorAll('.calendar-visible-presets [data-preset]').length,4);
  picker.element.querySelector('[data-preset="Last 7 days"]').click();assert.equal(changes.length,0);const expected=picker.visibleRanges().find(range=>range.label==='Last 7 days');picker.element.querySelector('.calendar-apply').click();assert.deepEqual(changes.at(-1).dates,{from:expected.start,to:expected.end});assert.equal(picker.open,false);
  picker.show();assert.equal(picker.element.querySelector('[data-preset="Last 7 days"]').getAttribute('aria-pressed'),'true');picker.element.querySelector('[data-preset=Today]').click();picker.element.dispatchEvent(new W.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));picker.show();assert.equal(picker.element.querySelector('[data-preset="Last 7 days"]').getAttribute('aria-pressed'),'true');
  picker.element.querySelector('.calendar-clear').click();assert.deepEqual(changes.at(-1).dates,{from:'',to:''});
  const global=new W.RCSDatePicker();W.document.body.append(global.element);global.show();assert.ok(global.element.querySelector('.calendar-grid'));assert.equal(global.element.querySelector('.date-range-options'),null);global.close();
});

test('room quick ranges work across a month boundary without a separate selection menu',t=>{
  const {picker,changes}=setup(t,{chatMode:true});picker.today=()=> '2026-03-01';picker.render();picker.element.querySelector('[data-preset="Last 7 days"]').click();picker.element.querySelector('.calendar-apply').click();assert.deepEqual(changes.at(-1).dates,{from:'2026-02-23',to:'2026-03-01'});
});

function phoneSetup(t,options={}){
  const dom=new JSDOM('<!doctype html><body></body>',{runScripts:'outside-only',pretendToBeVisual:true});t.after(()=>dom.window.close());const W=dom.window;
  W.matchMedia=query=>({matches:/max-width/.test(query),media:query,addEventListener(){},removeEventListener(){}});
  for(const name of ['search-core.js','date-picker.js'])W.eval(readFileSync(join(__dirname,'../extension',name),'utf8'));
  const changes=[],closed=[];const picker=new W.RCSDatePicker({...options,onClose:()=>closed.push(1),onChange:(dates,label)=>changes.push({dates:JSON.parse(JSON.stringify(dates)),label})});picker.today=()=>options.today||'2026-10-29';
  W.document.body.append(picker.element);picker.show();
  return {W,picker,changes,closed,el:picker.element};
}
test('on phones the calendar is a pull-up sheet with every mode, quick ranges and scrolling months',t=>{
  const {W,el}=phoneSetup(t);
  assert.ok(el.classList.contains('date-sheet'));assert.equal(el.getAttribute('aria-modal'),'true');
  assert.ok(W.document.querySelector('.date-sheet-scrim'),'a backdrop');
  assert.equal(el.querySelector('.date-sheet-title').textContent,'Date');
  assert.deepEqual([...el.querySelectorAll('.date-mode')].map(b=>b.textContent),['On','Before','After','Between'],'no mode is lost');
  assert.ok(el.querySelectorAll('.calendar-preset').length>=4,'quick ranges');
  assert.equal(el.querySelectorAll('.calendar-weekdays').length,1,'one weekday row above all months');
  const months=[...el.querySelectorAll('.calendar-month-block')].map(b=>b.dataset.month);
  assert.ok(months.length>=4);assert.equal(months.at(-1),'2026-10','ends at the current month');assert.ok(months.includes('2026-07'));
  assert.equal(el.querySelector('.calendar-nav'),null,'scrolling replaces the arrows');
  assert.match(W.document.querySelector('style')?.textContent || globalThis.String(W.RCSDatePicker.styles),/\.date-popover\.date-sheet\{position:fixed/);
  assert.match(W.RCSDatePicker.styles,/--calendar-cell:44px/,'44 px touch targets');
});
test('a phone range is picked across months and applied from the sticky footer',t=>{
  const {el,changes,closed}=phoneSetup(t);
  el.querySelector('[data-date="2026-09-28"]').click();
  el.querySelector('[data-date="2026-10-03"]').click();
  assert.ok(el.querySelector('[data-date="2026-09-30"]').classList.contains('range'),'the range spans the months');
  assert.match(el.querySelector('.calendar-summary').textContent,/→/);
  el.querySelector('.calendar-apply').click();
  assert.deepEqual(changes.at(-1).dates,{from:'2026-09-28',to:'2026-10-03'});assert.equal(closed.length,1);
});
test('a phone month title jumps to any year and month, and the backdrop closes without applying',t=>{
  const {W,el,changes,closed}=phoneSetup(t);
  el.querySelector('.calendar-month-title').click();
  assert.equal(el.querySelector('.date-sheet-title').textContent,'Choose year');
  el.querySelector('[data-year="2019"]').click();
  assert.equal(el.querySelector('.date-sheet-title').textContent,'Choose month');
  el.querySelector('[data-month="2"]').click();
  assert.ok(el.querySelector('[data-month="2019-03"]'),'March 2019 is listed');
  assert.ok(el.querySelector('[data-date="2019-03-15"]'));
  W.document.querySelector('.date-sheet-scrim').click();
  assert.equal(closed.length,1);assert.equal(changes.length,0,'nothing applied');assert.equal(W.document.querySelector('.date-sheet-scrim'),null);
});
