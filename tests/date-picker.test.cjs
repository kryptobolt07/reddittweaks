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
  const {picker,root,changes,fill}=setup(t);assert.equal(root.querySelectorAll('[role=combobox]').length,6);assert.equal(root.querySelector('.calendar-grid,select'),null);
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
test('keyboard dropdown selection clamps month ends and leap days and moves between fields',t=>{
  const {W,picker,root,changes,fill,mode,key,input}=setup(t);mode('On');fill('start','2024-01-31');const month=input('start','month');month.focus();key(month,'ArrowDown');key(month,'ArrowDown');key(month,'Enter');assert.equal(picker.draft.start,'2024-02-29');assert.equal(input('start','day').value,'29');
  const year=input('start','year');year.focus();year.value='2025';year.dispatchEvent(new W.Event('input',{bubbles:true}));key(year,'Enter');assert.equal(picker.draft.start,'2025-02-28');key(year,'ArrowLeft');assert.equal(W.document.activeElement,month);key(month,'ArrowLeft');assert.equal(W.document.activeElement,input('start','day'));key(W.document.activeElement,'ArrowRight');assert.equal(W.document.activeElement,month);
  key(month,'ArrowDown');key(month,'End');key(month,'Enter');assert.equal(month.value,'Dec');assert.equal(month.getAttribute('aria-expanded'),'false');assert.equal(changes.length,0);key(year,'Enter');assert.deepEqual(changes[0].dates,{from:'2025-12-28',to:'2025-12-28'});assert.equal(picker.open,false);
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
test('segment selection advances focus, clearing resets both fields and boundary dates never overflow the filter',t=>{
  const {W,picker,root,changes,mode,input,fill}=setup(t);const day=input('start','day');day.value='08';day.dispatchEvent(new W.Event('input',{bubbles:true}));day.dispatchEvent(new W.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));assert.equal(W.document.activeElement,input('start','month'));
  fill('start','2026-10-08');fill('end','2026-10-08');root.querySelector('.calendar-apply').click();picker.show();root.querySelector('.calendar-clear').click();assert.deepEqual(changes.at(-1).dates,{from:'',to:''});assert.ok([...root.querySelectorAll('input')].every(input=>!input.value));assert.equal(picker.compactSummary(),'');
  mode('Before');fill('start','0001-01-01');assert.equal(picker.bounds(),null);mode('After');fill('start','9999-12-31');assert.equal(picker.bounds(),null);
});

test('month dropdown filters names and numbers while keeping edits local until Apply',t=>{
  const {W,picker,root,changes,mode,input,key}=setup(t);mode('On');const month=input('start','month');month.focus();month.click();assert.equal(root.querySelectorAll('.date-option').length,12);
  const type=value=>{month.value=value;month.dispatchEvent(new W.Event('input',{bubbles:true}));};type('ma');assert.deepEqual([...root.querySelectorAll('.date-option')].map(option=>option.dataset.value),['03','05']);assert.equal(picker.values.start.month,'');type('oc');assert.equal(root.querySelector('.date-option').textContent,'October10');key(month,'Enter');assert.equal(month.value,'Oct');assert.equal(picker.values.start.month,'10');assert.equal(W.document.activeElement,input('start','year'));
  month.focus();type('02');assert.equal(root.querySelector('.date-option').dataset.value,'02');key(month,'Enter');assert.equal(month.value,'Feb');month.focus();type('nonesuch');assert.equal(root.querySelectorAll('.date-option').length,0);assert.match(root.querySelector('.date-option-empty').textContent,/No matching month/);key(month,'Enter');assert.equal(picker.open,true);assert.equal(root.querySelector('.calendar-apply').disabled,true);picker.closeOptions();key(month,'Enter');assert.equal(month.getAttribute('aria-invalid'),'true');assert.equal(W.document.activeElement,month);assert.equal(changes.length,0);
});

test('year filtering is bounded and supports any four-digit year without guessing a partial year',t=>{
  const {W,picker,root,mode,input,key}=setup(t);mode('On');const year=input('start','year');year.click();assert.ok(root.querySelectorAll('.date-option').length<=101);
  for(const value of ['19','0001','9999']){year.value=value;year.dispatchEvent(new W.Event('input',{bubbles:true}));const options=[...root.querySelectorAll('.date-option')];assert.ok(options.length>0 && options.length<=101);assert.ok(options.every(option=>option.dataset.value.startsWith(value)));if(value.length===4){key(year,'Enter');assert.equal(picker.values.start.year,value);}}
  year.value='202';year.dispatchEvent(new W.Event('input',{bubbles:true}));key(year,'Tab');assert.equal(picker.optionsMenu.hidden,true);year.blur();assert.equal(picker.values.start.year,'202');assert.equal(picker.bounds(),null);
});

test('only one themed dropdown opens at a time and Escape closes it before discarding a draft',t=>{
  const {picker,root,fill,input,key,changes}=setup(t);fill('start','2026-10-08');fill('end','2026-10-09');input('start','day').click();assert.equal(input('start','day').getAttribute('aria-expanded'),'true');input('start','month').focus();input('start','month').click();assert.equal(input('start','day').getAttribute('aria-expanded'),'false');assert.equal(input('start','month').getAttribute('aria-expanded'),'true');
  root.querySelector('.date-condition').click();assert.equal(picker.optionsMenu.hidden,true);assert.equal(picker.modeOpen,true);input('start','month').click();assert.equal(picker.modeOpen,false);key(input('start','month'),'Escape');assert.equal(picker.open,true);assert.equal(picker.optionsMenu.hidden,true);assert.equal(picker.draft.start,'2026-10-08');assert.equal(picker.positionListener,null);key(root,'Escape');assert.equal(picker.open,false);assert.equal(changes.length,0);
});

test('dropdowns flip upward and clamp horizontally inside a clipped chat container',t=>{
  const {W,picker,input}=setup(t),root=picker.element,parent=W.document.createElement('div');parent.style.overflow='hidden';root.before(parent);parent.append(root);
  parent.getBoundingClientRect=()=>({left:10,right:290,top:20,bottom:240,width:280,height:220});root.getBoundingClientRect=()=>({left:10,right:282,top:70,bottom:270,width:272,height:200});Object.defineProperties(root,{offsetWidth:{value:272},offsetHeight:{value:200}});
  const month=input('start','month'),anchor=month.closest('.date-segment-wrap');anchor.getBoundingClientRect=()=>({left:250,right:290,top:200,bottom:225,width:40,height:25});month.click();assert.equal(picker.optionsMenu.dataset.side,'above');assert.ok(parseFloat(picker.optionsMenu.style.left)+164<=280-6);assert.ok(parseFloat(picker.optionsMenu.style.maxHeight)<=174);assert.ok(parseFloat(picker.optionsMenu.style.top)<200-70);
  anchor.getBoundingClientRect=()=>({left:30,right:100,top:40,bottom:65,width:70,height:25});picker.placeMenu(picker.optionsMenu,anchor);assert.equal(picker.optionsMenu.dataset.side,'below');assert.ok(parseFloat(picker.optionsMenu.style.maxHeight)<=165);
  parent.getBoundingClientRect=()=>({left:10,right:580,top:20,bottom:600,width:570,height:580});root.getBoundingClientRect=()=>({left:10,right:554,top:70,bottom:470,width:544,height:400});anchor.getBoundingClientRect=()=>({left:300,right:440,top:400,bottom:450,width:140,height:50});picker.optionsMenu.getBoundingClientRect=()=>({height:200});picker.placeMenu(picker.optionsMenu,anchor);assert.equal(picker.optionsMenu.dataset.side,'above');assert.equal(parseFloat(picker.optionsMenu.style.top),61,'scaled menus subtract their CSS height, not their transformed height');picker.close();assert.equal(picker.positionListener,null);
});

test('day options respect the selected month and year, and typed invalid dates stay invalid',t=>{
  const {W,picker,root,fill,mode,input}=setup(t);mode('On');fill('start','2024-02-29');input('start','day').click();assert.equal(root.querySelectorAll('.date-option').length,29);fill('start','2025-02-29');input('start','day').click();assert.equal(root.querySelectorAll('.date-option').length,28);assert.equal(picker.bounds(),null);assert.equal(root.querySelector('.calendar-apply').disabled,true);
  const day=input('start','day');day.value='0';day.dispatchEvent(new W.Event('input',{bubbles:true}));assert.ok([...root.querySelectorAll('.date-option')].every(option=>Number(option.dataset.value)<=9));assert.equal(picker.bounds(),null);
});
