const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
function setup(t,options={}) {
  const dom=new JSDOM('<!doctype html><body></body>',{runScripts:'outside-only'});t.after(()=>dom.window.close());const W=dom.window;
  for(const name of ['search-core.js','date-picker.js'])W.eval(readFileSync(join(__dirname,'../extension',name),'utf8'));
  const changes=[],picker=new W.RCSDatePicker({...options,onChange:(dates,label)=>changes.push({dates:JSON.parse(JSON.stringify(dates)),label})});W.document.body.append(picker.element);picker.show();
  const month=(y,m)=>{picker.element.querySelector('.calendar-year').click();picker.element.querySelector(`[data-year="${y}"]`).click();picker.element.querySelector('.calendar-month').click();picker.element.querySelector(`[data-month="${m}"]`).click();};
  return {W,picker,changes,month};
}
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

test('quick ranges select inclusive local periods, including leap months, and wait for Apply',t=>{
  const {picker,changes}=setup(t);picker.today=()=> '2026-10-14';const expected={'Last 7 days':['2026-10-08','2026-10-14'],'Last 30 days':['2026-09-15','2026-10-14'],'This month':['2026-10-01','2026-10-31'],'Last month':['2026-09-01','2026-09-30'],'This year':['2026-01-01','2026-12-31']};
  for(const [label,[start,end]]of Object.entries(expected)){picker.element.querySelector('.calendar-quick').click();assert.equal(picker.chooser,'quick');assert.equal(picker.element.querySelector('.calendar-grid'),null);picker.element.querySelector(`[data-preset="${label}"]`).click();assert.equal(picker.draft.mode,'Between');assert.equal(picker.draft.start,start);assert.equal(picker.draft.end,end);assert.equal(picker.chooser,'');assert.equal(changes.length,0);}
  picker.element.querySelector('.calendar-apply').click();assert.deepEqual(changes[0].dates,{from:'2026-01-01',to:'2026-12-31'});picker.today=()=> '2024-03-02';assert.equal(picker.quickRanges().find(range=>range.label==='Last month').end,'2024-02-29');picker.today=()=> '2026-01-03';assert.equal(picker.quickRanges().find(range=>range.label==='Last 7 days').start,'2025-12-28');
});
test('quick-range keyboard navigation and Escape preserve the applied filter and local draft',t=>{
  const {W,picker,changes}=setup(t);picker.today=()=> '2026-10-14';picker.chooseRange(picker.quickRanges()[0]);picker.apply();picker.show();const key=(target,name)=>target.dispatchEvent(new W.KeyboardEvent('keydown',{key:name,bubbles:true,cancelable:true}));
  key(picker.element.querySelector('.calendar-quick'),'ArrowDown');assert.equal(W.document.activeElement.dataset.preset,'Last 7 days');key(W.document.activeElement,'ArrowDown');assert.equal(W.document.activeElement.dataset.preset,'Last 30 days');key(W.document.activeElement,'End');assert.equal(W.document.activeElement.dataset.preset,'This year');key(W.document.activeElement,'Escape');assert.equal(picker.open,true);assert.equal(picker.chooser,'');assert.equal(W.document.activeElement.className,'calendar-quick');assert.equal(picker.draft.start,'2026-10-08');
  picker.toggleQuick();picker.element.querySelector('[data-preset="This year"]').click();key(picker.element,'Escape');picker.show();assert.equal(picker.draft.start,'2026-10-08');assert.equal(picker.draft.end,'2026-10-14');assert.equal(changes.length,1);
});
test('compact months omit only unused calendar weeks, retaining every date and needed sixth weeks',t=>{
  const {picker,month}=setup(t);for(const [m,days,cells]of [[1,28,28],[9,31,35],[4,31,42]]){month(2026,m);const grid=picker.element.querySelector('.calendar-grid');assert.equal(grid.children.length,cells);assert.equal(grid.querySelectorAll('[data-date]').length,days);assert.equal(grid.querySelectorAll('[tabindex="0"]').length,1);}
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
  assert.equal(picker.element.querySelector('[data-date="2026-10-15"]').disabled,true);picker.choose('2026-10-15');assert.equal(picker.draft.start,'');
  picker.focusDay('2026-10-14');W.document.activeElement.dispatchEvent(new W.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));assert.equal(W.document.activeElement.dataset.date,'2026-10-14');
  picker.chooseRange({start:'2026-10-01',end:'2026-10-31'});assert.equal(picker.draft.start,'');
  for(const range of picker.quickRanges())assert.ok(range.end<='2026-10-14');
  picker.draft={mode:'After',start:'2026-10-14',end:''};assert.equal(picker.bounds(),null);
});
test('cached-day dots never restrict incomplete history, verified bounds are optional',t=>{
  let availability={days:['2026-10-08'],min:'2026-10-08',max:'2026-10-09'};
  const {picker,month}=setup(t,{chatMode:true,getAvailability:()=>availability});picker.today=()=> '2026-10-14';month(2026,9);
  assert.equal(picker.element.querySelector('[data-date="2026-10-01"]').disabled,false);assert.equal(picker.element.querySelector('[data-date="2026-10-14"]').disabled,false);
  assert.ok(picker.element.querySelector('[data-date="2026-10-08"].has-messages'));
  availability={...availability,verified:true};picker.render();assert.equal(picker.element.querySelector('[data-date="2026-10-01"]').disabled,true);assert.equal(picker.element.querySelector('[data-date="2026-10-14"]').disabled,true);
  assert.equal(picker.element.querySelector('[data-preset="Last 7 days"]').disabled,true);
});
test('chat range instruction describes the next step above the calendar',t=>{
  const {picker}=setup(t,{chatMode:true});picker.today=()=> '2026-10-14';picker.element.querySelector('[data-mode="Between"]').click();
  assert.equal(picker.element.querySelector('.calendar-instruction').textContent,'Choose a start date');picker.choose('2026-10-05');assert.match(picker.element.querySelector('.calendar-instruction').textContent,/5.*→ select end/);assert.equal(picker.element.querySelector('.calendar-summary'),null);assert.equal(picker.element.querySelector('.calendar-apply').disabled,true);
  picker.choose('2026-10-08');assert.match(picker.element.querySelector('.calendar-instruction').textContent,/5.*→.*8/);assert.equal(picker.element.querySelector('.calendar-apply').disabled,false);
  const children=[...picker.element.children];assert.ok(children.indexOf(picker.element.querySelector('.calendar-instruction'))<children.indexOf(picker.element.querySelector('.calendar-grid')));
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
