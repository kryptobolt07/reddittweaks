const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {setDateSegments,setDateMode}=require('./date-segments-helper.cjs');
function setup(t,options={}){
  const dom=new JSDOM('<!doctype html><body></body>',{runScripts:'outside-only'});t.after(()=>dom.window.close());const W=dom.window;W.eval(readFileSync(join(__dirname,'../extension/date-picker.js'),'utf8'));
  const changes=[],picker=new W.RCSDatePicker({...options,onChange:(dates,label)=>changes.push({dates:JSON.parse(JSON.stringify(dates)),label})});W.document.body.append(picker.element);picker.show();
  const key=(target,name)=>target.dispatchEvent(new W.KeyboardEvent('keydown',{key:name,bubbles:true,cancelable:true})),type=(bound,part,text)=>{const input=picker.input(bound,part);input.focus();input.value=text;input.dispatchEvent(new W.Event('input',{bubbles:true}));return input;};
  return {W,picker,root:picker.element,changes,key,type,fill:(bound,value)=>setDateSegments(picker.element,bound,value),mode:mode=>setDateMode(picker.element,mode),calendar:()=>{if(!picker.calendarExpanded)picker.toggleCalendar();}};
}
test('aligned day/month/year fields and a second range row apply only explicitly',t=>{
  const {picker,root,changes,fill}=setup(t);assert.equal(root.querySelectorAll('input').length,6);assert.equal(root.querySelectorAll('.date-fields').length,2);assert.equal(root.querySelector('.calendar-grid'),null);
  fill('start','2026-10-05');assert.equal(root.querySelector('.calendar-apply').disabled,true);fill('end','2026-10-08');assert.equal(picker.input('start','month').value,'Oct');assert.equal(picker.input('start','year').value,'2026');assert.equal(changes.length,0);root.querySelector('.calendar-apply').click();assert.deepEqual(changes[0].dates,{from:'2026-10-05',to:'2026-10-08'});assert.equal(picker.open,false);assert.ok(picker.compactSummary());
});
test('On, Before and After preserve whole-day semantics with one row',t=>{
  const {picker,root,changes,fill,mode}=setup(t);for(const [condition,expected]of [['On',{from:'2026-10-08',to:'2026-10-08'}],['Before',{from:'',to:'2026-10-07'}],['After',{from:'2026-10-09',to:''}]]){picker.show();mode(condition);assert.equal(root.querySelectorAll('input').length,3);fill('start','2026-10-08');root.querySelector('.calendar-apply').click();assert.deepEqual(changes.at(-1).dates,expected);}
});
test('optional calendar preserves the draft and expanded preference without applying',t=>{
  const {picker,root,fill,changes}=setup(t);fill('start','2026-10-05');picker.toggleCalendar();assert.equal(root.querySelectorAll('.calendar-day').length,42);assert.equal(picker.calendarButton.getAttribute('aria-expanded'),'true');picker.toggleCalendar();assert.equal(root.querySelector('.calendar-grid'),null);assert.equal(picker.draft.start,'2026-10-05');picker.toggleCalendar();picker.close();picker.show();assert.equal(picker.calendarExpanded,true);assert.ok(root.querySelector('.calendar-grid'));assert.equal(changes.length,0);
});
test('typed month names/numbers and four-digit years resolve without applying',t=>{
  const {picker,root,changes,type,key,mode}=setup(t);mode('On');type('start','day','21');const month=type('start','month','octo');assert.equal(picker.choices.length,1);assert.equal(picker.choices[0].value,'Oct');key(month,'Enter');assert.equal(root.ownerDocument.activeElement,picker.input('start','year'));const year=type('start','year','2026');key(year,'Enter');assert.equal(picker.draft.start,'2026-10-21');assert.equal(changes.length,0);key(year,'Enter');assert.deepEqual(changes[0].dates,{from:'2026-10-21',to:'2026-10-21'});
});
test('day replacement selects existing text on the first pointer interaction and accepts two digits',t=>{
  const {W,picker,fill,type,mode}=setup(t);mode('On');fill('start','2026-10-08');const input=picker.input();input.focus();const event=new W.MouseEvent('pointerdown',{button:0,bubbles:true,cancelable:true});input.dispatchEvent(event);assert.equal(event.defaultPrevented,true);assert.equal(input.selectionStart,0);assert.equal(input.selectionEnd,2);type('start','day','21');assert.equal(picker.draft.start,'2026-10-21');assert.equal(input.value,'21');
});
test('typed suggestions navigate one active choice, fill only the chosen part and retain invalid text',t=>{
  const {picker,root,type,key,changes}=setup(t);const input=type('start','month','j');assert.deepEqual(Array.from(picker.choices,item=>item.label),['Jan','Jun','Jul']);key(input,'ArrowDown');assert.equal(root.querySelectorAll('.date-option[aria-selected=true]').length,1);key(input,'Enter');assert.equal(picker.input('start','month').value,'Jun');assert.equal(picker.input().value,'');assert.equal(picker.view,'');type('start','day','76');assert.equal(picker.input().value,'76');assert.equal(picker.choices.length,0);assert.match(root.querySelector('.date-error').textContent,/1–31/);assert.equal(changes.length,0);
});
test('invalid dates show field-specific errors once and incomplete years never apply',t=>{
  const {picker,root,type,fill,key,changes}=setup(t);fill('start','2025-02-29');fill('end','2025-03-02');assert.equal(picker.bounds(),null);assert.match(root.querySelector('.date-error').textContent,/1–28 for Feb 2025/);assert.equal(picker.input().getAttribute('aria-invalid'),'true');assert.equal(root.querySelector('.date-preview').hidden,true);
  fill('start','2024-02-29');fill('end','2024-02-28');assert.match(root.querySelector('.date-error').textContent,/on or after/);fill('end','2024-02-29');assert.ok(picker.bounds());const input=type('end','year','202');key(input,'Tab');input.blur();assert.equal(input.value,'202');assert.equal(picker.bounds(),null);picker.apply();assert.match(root.querySelector('.date-error').textContent,/four-digit year/);assert.equal(changes.length,0);
});
test('numeric months, leap correction, complete years and exclusive date boundaries remain supported',t=>{
  const {picker,root,type,mode,fill}=setup(t);mode('On');fill('start','2024-02-29');type('start','year','2025');assert.equal(picker.bounds(),null);type('start','year','2024');assert.ok(picker.bounds());type('start','month','13');assert.match(root.querySelector('.date-error').textContent,/Jan to Dec/);type('start','month','2');assert.equal(picker.draft.start,'2024-02-29');mode('Before');fill('start','0001-01-01');assert.equal(picker.bounds(),null);mode('After');fill('start','9999-12-31');assert.equal(picker.bounds(),null);
});
test('calendar range selection fills the active endpoint and highlights the whole range',t=>{
  const {picker,root,changes,calendar}=setup(t);calendar();picker.month=new Date(2026,9,1);picker.renderBody();root.querySelector('[data-date="2026-10-05"]').click();assert.equal(picker.activeBound,'end');root.querySelector('[data-date="2026-10-08"]').click();assert.equal(picker.draft.start,'2026-10-05');assert.equal(picker.draft.end,'2026-10-08');assert.equal(root.querySelectorAll('.calendar-day[aria-selected=true]').length,2);assert.equal(root.querySelectorAll('.calendar-day.in-range').length,2);assert.equal(root.querySelector('.date-fields[data-bound="end"]').dataset.active,'true');assert.equal(changes.length,0);root.querySelector('.calendar-apply').click();assert.deepEqual(changes[0].dates,{from:'2026-10-05',to:'2026-10-08'});
});
test('calendar edits the focused endpoint without silently swapping a reversed range',t=>{
  const {picker,root,fill,calendar}=setup(t);fill('start','2026-10-01');fill('end','2026-10-14');calendar();picker.input('end','day').focus();root.querySelector('[data-date="2026-10-03"]').click();assert.equal(picker.draft.end,'2026-10-03');picker.input('start','day').focus();root.querySelector('[data-date="2026-10-05"]').click();assert.equal(picker.draft.start,'2026-10-05');assert.equal(picker.draft.end,'2026-10-03');assert.equal(picker.bounds(),null);
});
test('independent calendar month and year browsing never modifies draft dates',t=>{
  const {picker,root,fill,changes,calendar}=setup(t);fill('start','2026-10-08');calendar();const before=picker.draft.start;root.querySelector('[aria-label="Next month"]').click();assert.equal(picker.month.getMonth(),10);root.querySelector('[aria-label="Choose calendar month"]').click();root.querySelector('[aria-label="February"]').click();assert.equal(picker.month.getMonth(),1);root.querySelector('[aria-label="Choose calendar year"]').click();[...root.querySelectorAll('.date-option')].find(button=>button.textContent==='2025').click();assert.equal(picker.month.getFullYear(),2025);assert.equal(picker.draft.start,before);assert.equal(changes.length,0);
});
test('calendar keyboard navigation crosses months with one tab stop',t=>{
  const {picker,root,mode,key,calendar}=setup(t);mode('On');calendar();picker.month=new Date(2026,9,1);picker.renderBody();const day=root.querySelector('[data-date="2026-10-31"]');day.focus();key(day,'ArrowRight');const next=root.querySelector('[data-date="2026-11-01"]');assert.equal(root.ownerDocument.activeElement,next);assert.equal(root.querySelectorAll('.calendar-day[tabindex="0"]').length,1);key(next,'PageUp');assert.equal(picker.month.getMonth(),9);
});
test('Escape closes suggestions or condition choices before cancelling the draft',t=>{
  const {picker,root,type,key,fill,changes}=setup(t);fill('start','2026-01-31');fill('end','2026-02-02');root.querySelector('.calendar-apply').click();picker.show();const input=type('start','day','15');key(input,'Escape');assert.equal(picker.open,true);assert.equal(picker.view,'');key(input,'Escape');assert.equal(picker.open,false);picker.show();assert.equal(picker.draft.start,'2026-01-31');assert.equal(changes.length,1);key(root.querySelector('.date-condition'),'ArrowDown');assert.equal(picker.view,'modes');key(root,'Escape');assert.equal(picker.open,true);assert.equal(picker.view,'');
});
test('Today fills the active endpoint and waits for Apply',t=>{
  const {picker,root,fill,changes}=setup(t);fill('start','2026-01-01');picker.input('end','month').focus();root.querySelector('.date-today').click();assert.equal(picker.draft.start,'2026-01-01');assert.equal(picker.draft.end,picker.today());assert.equal(changes.length,0);
});
test('quiet quick ranges choose inclusive periods and handle leap months without applying',t=>{
  const {picker,root,changes}=setup(t);picker.today=()=> '2026-10-14';const expected={'Last 7 days':['2026-10-08','2026-10-14'],'Last 30 days':['2026-09-15','2026-10-14'],'This month':['2026-10-01','2026-10-31'],'Last month':['2026-09-01','2026-09-30'],'This year':['2026-01-01','2026-12-31']};
  for(const [label,[from,to]]of Object.entries(expected)){root.querySelector('[aria-label="Quick date ranges"]').click();root.querySelector('[data-preset="'+label+'"]').click();assert.equal(picker.draft.mode,'Between');assert.deepEqual(JSON.parse(JSON.stringify(picker.bounds())),{from,to});assert.equal(changes.length,0);}root.querySelector('.calendar-apply').click();assert.deepEqual(changes[0].dates,{from:'2026-01-01',to:'2026-12-31'});picker.today=()=> '2024-03-02';assert.equal(picker.quickRanges().find(range=>range.label==='Last month').end,'2024-02-29');
});
test('full-date paste into any part fills the endpoint, and Clear resets even an unopened picker',t=>{
  const {W,picker,root,changes,key}=setup(t);const paste=(bound,part,text)=>{const event=new W.Event('paste',{bubbles:true,cancelable:true});Object.defineProperty(event,'clipboardData',{value:{getData:()=>text}});picker.input(bound,part).dispatchEvent(event);assert.equal(event.defaultPrevented,true);};paste('start','month','2026-01-31');paste('end','year','2/2/2026');assert.equal(picker.draft.end,'2026-02-02');assert.equal(picker.input('end','month').value,'Feb');key(picker.input('end'),'Enter');assert.deepEqual(changes[0].dates,{from:'2026-01-31',to:'2026-02-02'});picker.show();paste('start','day','1/1/99');assert.equal(picker.draft.start,'2099-01-01');paste('start','year','1/1/1999');assert.equal(picker.draft.start,'1999-01-01');root.querySelector('.calendar-clear').click();assert.deepEqual(changes.at(-1).dates,{from:'',to:''});assert.ok([...root.querySelectorAll('input')].every(input=>!input.value));const unopened=new W.RCSDatePicker();assert.doesNotThrow(()=>unopened.reset());assert.equal(unopened.open,false);
});
test('all inline choices remain within the picker and positioning excludes the native header/ribbon',t=>{
  const {W,picker,root,type}=setup(t,{getBounds:()=>({left:20,right:320,top:120,bottom:400})});root.getBoundingClientRect=()=>({left:30,right:330,top:80,bottom:380,width:300,height:300});Object.defineProperties(root,{offsetWidth:{value:300},offsetHeight:{value:300},offsetTop:{value:80}});root.style.top='80px';picker.place();assert.ok(parseFloat(root.style.top)>=124);assert.ok(parseFloat(root.style.maxHeight)<=270);type('start','month','j');assert.ok(picker.body.contains(root.querySelector('.date-option')));root.querySelector('.date-condition').click();assert.ok([...root.querySelectorAll('.date-mode')].every(row=>row.parentNode===picker.body));assert.doesNotThrow(()=>picker.positionListener({target:W}));picker.close();assert.equal(picker.positionListener,null);
});
