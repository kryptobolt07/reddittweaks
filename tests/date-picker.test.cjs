const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {setDateSegments,setDateMode}=require('./date-segments-helper.cjs');
function setup(t,options={}){
  const dom=new JSDOM('<!doctype html><body></body>',{runScripts:'outside-only'});t.after(()=>dom.window.close());const W=dom.window;W.eval(readFileSync(join(__dirname,'../extension/date-picker.js'),'utf8'));
  const changes=[],picker=new W.RCSDatePicker({...options,onChange:(dates,label)=>changes.push({dates:JSON.parse(JSON.stringify(dates)),label})});W.document.body.append(picker.element);picker.show();
  const key=(target,name)=>target.dispatchEvent(new W.KeyboardEvent('keydown',{key:name,bubbles:true,cancelable:true})),type=(bound,text)=>{const input=picker.input(bound);input.focus();input.value=text;input.dispatchEvent(new W.Event('input',{bubbles:true}));return input;};
  return {W,picker,root:picker.element,changes,key,type,fill:(bound,value)=>setDateSegments(picker.element,bound,value),mode:mode=>setDateMode(picker.element,mode)};
}
test('compact picker uses one slash-formatted field per date and a shared calendar, applying only explicitly',t=>{
  const {picker,root,changes,fill}=setup(t);assert.equal(root.querySelectorAll('input').length,2);assert.equal(root.querySelectorAll('.calendar-day').length,42);assert.equal(root.querySelector('select,.date-segment'),null);
  fill('start','2026-10-05');assert.equal(root.querySelector('.calendar-apply').disabled,true);fill('end','2026-10-08');assert.equal(picker.input().value,'05/10/26');assert.equal(changes.length,0);root.querySelector('.calendar-apply').click();assert.deepEqual(changes[0].dates,{from:'2026-10-05',to:'2026-10-08'});assert.equal(picker.open,false);assert.ok(picker.compactSummary());
});
test('On, Before and After preserve whole-day semantics with one date field',t=>{
  const {picker,root,changes,fill,mode}=setup(t);for(const [condition,expected]of [['On',{from:'2026-10-08',to:'2026-10-08'}],['Before',{from:'',to:'2026-10-07'}],['After',{from:'2026-10-09',to:''}]]){picker.show();mode(condition);assert.equal(root.querySelectorAll('input').length,1);fill('start','2026-10-08');root.querySelector('.calendar-apply').click();assert.deepEqual(changes.at(-1).dates,expected);}
});
test('typing a full date with short or explicit years offers the exact date without silently applying it',t=>{
  const {picker,root,changes,type,key,mode}=setup(t);mode('On');for(const text of ['21/10/26','21/10/2026']){const input=type('start',text);assert.equal(picker.draft.start,'2026-10-21');assert.equal(root.querySelector('.date-option').dataset.date,'2026-10-21');assert.equal(changes.length,0);key(input,'Enter');assert.equal(picker.view,'calendar');assert.equal(input.value,'21/10/26');}key(picker.input(),'Enter');assert.deepEqual(changes[0].dates,{from:'2026-10-21',to:'2026-10-21'});
});
test('sequential digits insert date slashes and retain a two-digit day on replacement',t=>{
  const {W,picker,type,mode}=setup(t);mode('On');const input=picker.input();for(const raw of ['2','21','211','21/10','21/102','21/10/26']){input.value=raw;input.dispatchEvent(new W.InputEvent('input',{bubbles:true,inputType:'insertText'}));}assert.equal(input.value,'21/10/26');assert.equal(picker.draft.start,'2026-10-21');
  input.focus();const event=new W.MouseEvent('pointerdown',{button:0,bubbles:true,cancelable:true});input.dispatchEvent(event);assert.equal(event.defaultPrevented,true);assert.equal(input.selectionStart,0);assert.equal(input.selectionEnd,input.value.length);type('start','05/10/26');assert.equal(picker.draft.start,'2026-10-05');
});
test('partial dates suggest full dates and arrow navigation uses a single active suggestion',t=>{
  const {picker,root,type,key,changes}=setup(t);const input=type('start','14/10/');assert.equal(picker.draft.start,'');assert.ok(picker.choices.length>1);assert.equal(root.querySelectorAll('.date-option[aria-selected=true]').length,1);key(input,'ArrowDown');const expected=picker.choices[1].value;assert.equal(root.querySelector('.date-option[aria-selected=true]').dataset.date,expected);key(input,'Enter');assert.equal(picker.draft.start,expected);assert.equal(picker.view,'calendar');assert.equal(changes.length,0);
});
test('invalid dates, ambiguous partial years and reversed ranges cannot apply',t=>{
  const {picker,root,type,fill,key,changes}=setup(t);fill('start','2025-02-29');fill('end','2025-03-02');assert.equal(picker.bounds(),null);assert.equal(root.querySelector('.calendar-apply').disabled,true);
  fill('start','2024-02-29');fill('end','2024-02-28');assert.equal(picker.bounds(),null);assert.match(root.querySelector('.date-error').textContent,/on or after/);fill('end','2024-02-29');assert.ok(picker.bounds());const input=type('end','29/02/202');key(input,'Tab');input.blur();assert.equal(picker.draft.end,'');assert.equal(input.value,'29/02/202');assert.equal(changes.length,0);assert.equal(picker.bounds(),null);
});
test('two-digit years are fixed to 2000–2099; explicit older and boundary years remain supported',t=>{
  const {picker,type,mode,fill}=setup(t);mode('On');type('start','01/01/99');assert.equal(picker.draft.start,'2099-01-01');type('start','01/01/1999');assert.equal(picker.draft.start,'1999-01-01');picker.input().blur();assert.equal(picker.input().value,'01/01/1999');mode('Before');fill('start','0001-01-01');assert.equal(picker.bounds(),null);mode('After');fill('start','9999-12-31');assert.equal(picker.bounds(),null);
});
test('calendar range selection fills the active field, highlights its endpoints and preserves validation',t=>{
  const {picker,root,changes}=setup(t);picker.month=new Date(2026,9,1);picker.renderBody();root.querySelector('[data-date="2026-10-05"]').click();assert.equal(picker.activeBound,'end');root.querySelector('[data-date="2026-10-08"]').click();assert.equal(picker.draft.start,'2026-10-05');assert.equal(picker.draft.end,'2026-10-08');assert.equal(root.querySelectorAll('.calendar-day[aria-selected=true]').length,2);assert.equal(root.querySelectorAll('.calendar-day.in-range').length,2);assert.equal(changes.length,0);root.querySelector('.calendar-apply').click();assert.deepEqual(changes[0].dates,{from:'2026-10-05',to:'2026-10-08'});
});
test('month navigation and inline month/year selection never modify the date draft',t=>{
  const {picker,root,fill,changes}=setup(t);fill('start','2026-10-08');const before=picker.draft.start;root.querySelector('[aria-label="Next month"]').click();assert.equal(picker.month.getMonth(),10);root.querySelector('[aria-label="Choose month and year"]').click();assert.equal(picker.view,'months');root.querySelector('[aria-label="Previous year"]').click();root.querySelector('[aria-label="February"]').click();assert.equal(picker.month.getFullYear(),2025);assert.equal(picker.month.getMonth(),1);assert.equal(picker.draft.start,before);assert.equal(changes.length,0);
});
test('calendar keyboard navigation moves across months while maintaining one tab stop',t=>{
  const {picker,root,mode,key}=setup(t);mode('On');picker.month=new Date(2026,9,1);picker.renderBody();key(picker.input(),'ArrowDown');assert.ok(root.ownerDocument.activeElement.matches('.calendar-day'));const day=root.querySelector('[data-date="2026-10-31"]');day.focus();key(day,'ArrowRight');const next=root.querySelector('[data-date="2026-11-01"]');assert.equal(root.ownerDocument.activeElement,next);assert.equal(root.querySelectorAll('.calendar-day[tabindex="0"]').length,1);key(next,'PageUp');assert.equal(picker.month.getMonth(),9);
});
test('Escape closes inline suggestions or condition choices before discarding a draft',t=>{
  const {picker,root,type,key,fill,changes}=setup(t);fill('start','2026-01-31');fill('end','2026-02-02');root.querySelector('.calendar-apply').click();picker.show();const input=type('start','15/01/');key(input,'Escape');assert.equal(picker.open,true);assert.equal(picker.view,'calendar');key(input,'Escape');assert.equal(picker.open,false);picker.show();assert.equal(picker.draft.start,'2026-01-31');assert.equal(changes.length,1);key(root.querySelector('.date-condition'),'ArrowDown');assert.equal(picker.view,'modes');key(root,'Escape');assert.equal(picker.open,true);assert.equal(picker.view,'calendar');
});
test('Today and relative suggestions choose a date but still wait for Apply',t=>{
  const {picker,root,type,key,mode,changes}=setup(t);mode('On');const input=type('start','tod');assert.equal(picker.choices[0].label,'Today');key(input,'Enter');assert.equal(picker.draft.start,picker.today());const yesterday=type('start','yest');key(yesterday,'Enter');assert.notEqual(picker.draft.start,picker.today());[...root.querySelectorAll('button')].find(button=>button.textContent==='Today').click();assert.equal(picker.draft.start,picker.today());assert.equal(changes.length,0);
});
test('quick ranges share the existing header and select inclusive preset dates without fetching',t=>{
  const {picker,root,changes}=setup(t);picker.today=()=> '2026-10-14';const expected={'Last 7 days':['2026-10-08','2026-10-14'],'Last 30 days':['2026-09-15','2026-10-14'],'This month':['2026-10-01','2026-10-31'],'Last month':['2026-09-01','2026-09-30'],'This year':['2026-01-01','2026-12-31']};
  assert.ok(root.querySelector('.date-header [aria-label="Quick date ranges"]'));for(const [label,[from,to]]of Object.entries(expected)){root.querySelector('[aria-label="Quick date ranges"]').click();assert.equal(root.querySelector('.calendar-grid'),null);root.querySelector('[data-preset="'+label+'"]').click();assert.equal(picker.draft.mode,'Between');assert.deepEqual(JSON.parse(JSON.stringify(picker.bounds())),{from,to});assert.equal(changes.length,0);}root.querySelector('.calendar-apply').click();assert.deepEqual(changes[0].dates,{from:'2026-01-01',to:'2026-12-31'});picker.today=()=> '2024-03-02';const leap=picker.quickRanges().find(range=>range.label==='Last month');assert.equal(leap.start,'2024-02-01');assert.equal(leap.end,'2024-02-29');
});
test('pasting ISO or slash dates fills a field and Clear resets the filter',t=>{
  const {W,picker,root,changes,key}=setup(t);const paste=(bound,text)=>{const event=new W.Event('paste',{bubbles:true,cancelable:true});Object.defineProperty(event,'clipboardData',{value:{getData:()=>text}});picker.input(bound).dispatchEvent(event);assert.equal(event.defaultPrevented,true);};paste('start','2026-01-31');paste('end','2/2/2026');assert.equal(picker.draft.end,'2026-02-02');key(picker.input('end'),'Enter');assert.deepEqual(changes[0].dates,{from:'2026-01-31',to:'2026-02-02'});picker.show();root.querySelector('.calendar-clear').click();assert.deepEqual(changes.at(-1).dates,{from:'',to:''});assert.ok([...root.querySelectorAll('input')].every(input=>!input.value));const unopened=new W.RCSDatePicker();assert.doesNotThrow(()=>unopened.reset());assert.equal(unopened.open,false);
});
test('the entire picker stays below the supplied chat ribbon and its body contains every menu',t=>{
  const {W,picker,root,type}=setup(t,{getBounds:()=>({left:20,right:320,top:120,bottom:400})});root.getBoundingClientRect=()=>({left:30,right:330,top:80,bottom:380,width:300,height:300});Object.defineProperties(root,{offsetWidth:{value:300},offsetHeight:{value:300},offsetTop:{value:80}});root.style.top='80px';picker.place();assert.ok(parseFloat(root.style.top)>=124);assert.ok(parseFloat(root.style.maxHeight)<=270);type('start','14');assert.equal(root.querySelector('.date-option').parentNode,picker.body);root.querySelector('.date-condition').click();assert.ok([...root.querySelectorAll('.date-mode')].every(row=>row.parentNode===picker.body));assert.doesNotThrow(()=>picker.positionListener({target:W}));picker.close();assert.equal(picker.positionListener,null);
});
