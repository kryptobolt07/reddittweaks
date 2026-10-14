const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {setDateSegments,setDateMode}=require('./date-segments-helper.cjs');
function setup(t){
  const dom=new JSDOM('<!doctype html><body></body>',{runScripts:'outside-only'});t.after(()=>dom.window.close());const W=dom.window;
  W.eval(readFileSync(join(__dirname,'../extension/date-picker.js'),'utf8'));
  const changes=[],picker=new W.RCSDatePicker({onChange:(dates,label)=>changes.push({dates:JSON.parse(JSON.stringify(dates)),label})});W.document.body.append(picker.element);picker.show();
  const root=picker.element,key=(input,name)=>input.dispatchEvent(new W.KeyboardEvent('keydown',{key:name,bubbles:true,cancelable:true}));
  return {W,picker,root,changes,key,fill:(bound,value)=>setDateSegments(root,bound,value),mode:mode=>setDateMode(root,mode),input:(bound,part)=>picker.segment(bound,part)};
}
test('compact range has two segmented fields and commits only when Apply is pressed',t=>{
  const {picker,root,changes,fill}=setup(t);assert.equal(root.querySelectorAll('[role=spinbutton]').length,6);assert.equal(root.querySelector('.calendar-grid,select'),null);
  fill('start','2026-10-05');assert.equal(root.querySelector('.calendar-apply').disabled,true);fill('end','2026-10-08');assert.equal(changes.length,0);
  root.querySelector('.calendar-apply').click();assert.deepEqual(changes[0].dates,{from:'2026-10-05',to:'2026-10-08'});assert.equal(picker.open,false);assert.ok(picker.compactSummary());
});
test('On, Before and After retain their distinct whole-day semantics with one date row',t=>{
  const {picker,root,changes,fill,mode}=setup(t);
  for(const [condition,expected]of [['On',{from:'2026-10-08',to:'2026-10-08'}],['Before',{from:'',to:'2026-10-07'}],['After',{from:'2026-10-09',to:''}]]){
    picker.show();mode(condition);assert.equal(root.querySelectorAll('input').length,3);fill('start','2026-10-08');root.querySelector('.calendar-apply').click();assert.deepEqual(changes.at(-1).dates,expected);
  }
});
test('cross-month ranges and Escape preserve the last applied dates rather than an unfinished draft',t=>{
  const {picker,root,changes,fill,key}=setup(t);fill('start','2026-01-31');fill('end','2026-02-02');root.querySelector('.calendar-apply').click();assert.deepEqual(changes[0].dates,{from:'2026-01-31',to:'2026-02-02'});
  picker.show();fill('start','2026-01-15');key(root,'Escape');assert.equal(changes.length,1);assert.equal(picker.open,false);picker.show();assert.equal(picker.draft.start,'2026-01-31');assert.equal(picker.segment('start','day').value,'31');
});
test('keyboard stepping clamps month ends and leap days and moves between selected segments',t=>{
  const {W,picker,root,changes,fill,mode,key,input}=setup(t);mode('On');fill('start','2024-01-31');const month=input('start','month');month.focus();key(month,'ArrowUp');assert.equal(picker.draft.start,'2024-02-29');assert.equal(input('start','day').value,'29');
  const year=input('start','year');year.focus();key(year,'ArrowUp');assert.equal(picker.draft.start,'2025-02-28');key(year,'ArrowLeft');assert.equal(W.document.activeElement,month);key(month,'ArrowLeft');assert.equal(W.document.activeElement,input('start','day'));key(W.document.activeElement,'ArrowRight');assert.equal(W.document.activeElement,month);
  key(month,'End');assert.equal(month.value,'12');assert.equal(month.getAttribute('aria-valuenow'),'12');assert.equal(month.getAttribute('aria-valuemax'),'12');assert.equal(changes.length,0);key(year,'Enter');assert.deepEqual(changes[0].dates,{from:'2025-12-28',to:'2025-12-28'});assert.equal(picker.open,false);
});
test('invalid dates, partial years and reversed ranges cannot apply or silently roll into another month',t=>{
  const {W,picker,root,changes,fill,key,input}=setup(t);fill('start','2025-02-29');fill('end','2025-03-02');assert.equal(picker.bounds(),null);assert.match(root.querySelector('.date-error').textContent,/valid date/);assert.equal(root.querySelector('.calendar-apply').disabled,true);
  fill('start','2024-02-29');fill('end','2024-02-28');assert.equal(picker.bounds(),null);assert.match(root.querySelector('.date-error').textContent,/on or after/);
  fill('end','2024-02-29');assert.ok(picker.bounds());assert.equal(root.querySelector('.date-error').hidden,true);
  const year=input('end','year');year.value='202';year.dispatchEvent(new W.Event('input',{bubbles:true}));input('end','day').focus();assert.equal(year.value,'202','blur does not guess a century');assert.equal(picker.bounds(),null);key(year,'Enter');assert.equal(changes.length,0);assert.equal(W.document.activeElement,year);
});
test('mode dropdown is themed and keyboard navigable; closing it does not discard the draft',t=>{
  const {W,picker,root,changes,fill,key}=setup(t);fill('start','2026-10-05');const button=root.querySelector('.date-condition');key(button,'ArrowDown');assert.equal(button.getAttribute('aria-expanded'),'true');assert.equal(W.document.activeElement.dataset.mode,'Between');
  key(W.document.activeElement,'ArrowUp');assert.equal(W.document.activeElement.dataset.mode,'After');key(root,'Escape');assert.equal(picker.open,true);assert.equal(button.getAttribute('aria-expanded'),'false');assert.equal(W.document.activeElement,button);assert.equal(picker.draft.start,'2026-10-05');assert.equal(root.querySelector('select'),null);assert.equal(changes.length,0);key(root,'Escape');assert.equal(picker.open,false);
});
test('pasting an ISO or explicit day/month/year date fills the entire field and validates it',t=>{
  const {W,picker,root,changes,key,input}=setup(t);
  const paste=(bound,text)=>{const event=new W.Event('paste',{bubbles:true,cancelable:true});Object.defineProperty(event,'clipboardData',{value:{getData:()=>text}});input(bound,'day').dispatchEvent(event);assert.equal(event.defaultPrevented,true);};
  paste('start','2026-01-31');paste('end','2/2/2026');assert.equal(picker.draft.end,'2026-02-02');assert.equal(W.document.activeElement,input('end','year'));key(input('end','year'),'Enter');assert.deepEqual(changes[0].dates,{from:'2026-01-31',to:'2026-02-02'});
  picker.show();paste('end','31/2/2026');assert.equal(picker.bounds(),null);assert.equal(root.querySelector('.calendar-apply').disabled,true);
});
test('segment typing advances focus, clearing resets both fields and boundary dates never overflow the filter',t=>{
  const {W,picker,root,changes,mode,input,fill}=setup(t);const day=input('start','day');day.value='08';day.dispatchEvent(new W.Event('input',{bubbles:true}));assert.equal(W.document.activeElement,input('start','month'));
  fill('start','2026-10-08');fill('end','2026-10-08');root.querySelector('.calendar-apply').click();picker.show();root.querySelector('.calendar-clear').click();assert.deepEqual(changes.at(-1).dates,{from:'',to:''});assert.ok([...root.querySelectorAll('input')].every(input=>!input.value));assert.equal(picker.compactSummary(),'');
  mode('Before');fill('start','0001-01-01');assert.equal(picker.bounds(),null);mode('After');fill('start','9999-12-31');assert.equal(picker.bounds(),null);
});
