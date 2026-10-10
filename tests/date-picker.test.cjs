const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
function setup(t) {
  const dom=new JSDOM('<!doctype html><body></body>',{runScripts:'outside-only'});t.after(()=>dom.window.close());const W=dom.window;
  for(const name of ['search-core.js','date-picker.js'])W.eval(readFileSync(join(__dirname,'../extension',name),'utf8'));
  const changes=[],picker=new W.RCSDatePicker({onChange:(dates,label)=>changes.push({dates:JSON.parse(JSON.stringify(dates)),label})});W.document.body.append(picker.element);picker.show();
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
