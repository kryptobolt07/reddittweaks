const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
function setup(t,options={}) {
  const dom=new JSDOM('<!doctype html><body></body>',{runScripts:'outside-only'});t.after(()=>dom.window.close());const W=dom.window;
  for(const name of ['search-core.js','date-picker.js'])W.eval(readFileSync(join(__dirname,'../extension',name),'utf8'));
  const changes=[],picker=new W.RCSDatePicker({...options,onChange:(dates,label)=>changes.push({dates:JSON.parse(JSON.stringify(dates)),label})});picker.today=()=> '2026-10-14';W.document.body.append(picker.element);picker.show();
  const key=(target,name,extra={})=>target.dispatchEvent(new W.KeyboardEvent('keydown',{key:name,bubbles:true,cancelable:true,...extra}));
  return {W,picker,changes,key,q:selector=>picker.element.querySelector(selector),status:()=>picker.element.querySelector('.calendar-summary').textContent};
}
const css=()=>{const {JSDOM}=require('jsdom');const W=new JSDOM('',{runScripts:'outside-only'}).window;W.eval(readFileSync(join(__dirname,'../extension/date-picker.js'),'utf8'));return W.RCSDatePicker.styles;};

test('the calendar is an ARIA grid with named weekday columns and descriptive day labels',t=>{
  const {picker,q}=setup(t);picker.today=()=> '2026-10-14';picker.getAvailability=()=>({days:['2026-10-08']});
  picker.show('Between');picker.choose('2026-10-05');picker.choose('2026-10-12');
  const grid=q('.calendar-grid');assert.equal(grid.getAttribute('role'),'grid');assert.equal(grid.getAttribute('aria-label'),'October 2026');
  const headers=[...grid.querySelectorAll('[role=columnheader]')];assert.equal(headers.length,7);assert.equal(headers[0].getAttribute('aria-label'),'Sunday');assert.equal(headers[6].getAttribute('aria-label'),'Saturday');assert.equal(grid.querySelector('[aria-hidden=true]:not(svg)')?.closest('.calendar-weekdays')?.getAttribute('aria-hidden'),undefined);
  assert.ok(grid.querySelectorAll('[role=row]').length>=5);for(const cell of grid.querySelectorAll('[data-date]'))assert.equal(cell.getAttribute('role'),'gridcell');
  const label=date=>q(`[data-date="${date}"]`).getAttribute('aria-label');
  assert.match(label('2026-10-05'),/start of range/);assert.match(label('2026-10-12'),/end of range/);assert.match(label('2026-10-08'),/has saved messages, in range/);assert.match(label('2026-10-14'),/today/);assert.match(label('2026-10-20'),/unavailable/);
  assert.equal(q('[data-date="2026-10-05"]').getAttribute('aria-selected'),'true');assert.equal(q('[data-date="2026-10-12"]').getAttribute('aria-selected'),'true');assert.equal(q('[data-date="2026-10-08"]').getAttribute('aria-selected'),'true');assert.equal(q('[data-date="2026-10-02"]').getAttribute('aria-selected'),'false');
  assert.equal(q('[data-date="2026-10-14"]').getAttribute('aria-current'),'date');assert.equal(grid.querySelectorAll('[aria-current]').length,1);assert.equal(q('[data-date="2026-10-20"]').getAttribute('aria-disabled'),'true');
  assert.ok(q('[data-date="2026-10-08"].has-messages.range'));assert.ok(q('[data-date="2026-10-14"].today.has-messages')||q('[data-date="2026-10-14"].today'));
  assert.equal(grid.querySelectorAll('[aria-pressed]').length,0,'days use aria-selected, not aria-pressed');
});
test('modes are a radiogroup with a roving tab stop and arrow-key selection',t=>{
  const {W,picker,key,q}=setup(t);const group=q('.date-modes');assert.equal(group.getAttribute('role'),'radiogroup');
  const radios=()=>[...q('.date-modes').querySelectorAll('[role=radio]')];assert.equal(radios().length,4);assert.deepEqual(radios().map(r=>r.getAttribute('aria-checked')),['false','false','false','true']);assert.deepEqual(radios().map(r=>r.tabIndex),[-1,-1,-1,0]);
  key(q('[data-mode="Between"]'),'ArrowRight');assert.equal(picker.draft.mode,'On');assert.equal(W.document.activeElement.dataset.mode,'On');assert.equal(radios()[0].getAttribute('aria-checked'),'true');
  key(W.document.activeElement,'ArrowLeft');assert.equal(picker.draft.mode,'Between');key(W.document.activeElement,'Home');assert.equal(picker.draft.mode,'On');key(W.document.activeElement,'End');assert.equal(picker.draft.mode,'Between');key(W.document.activeElement,'ArrowDown');assert.equal(picker.draft.mode,'On');
  assert.equal(picker.element.querySelectorAll('.calendar-month,.calendar-year').length,2);
});
test('month and year buttons have names that start with their visible text',t=>{
  const {q}=setup(t);for(const [selector,kind]of [['.calendar-month','month'],['.calendar-year','year']]){const button=q(selector),visible=button.textContent.trim();assert.ok(button.getAttribute('aria-label').startsWith(visible),button.getAttribute('aria-label'));assert.match(button.getAttribute('aria-label'),new RegExp(`choose ${kind}`));assert.equal(button.getAttribute('aria-expanded'),'false');}
  assert.equal(q('.calendar-year').textContent.trim(),'2026');assert.equal(q('[aria-label="Previous month"]').querySelector('svg')!==null,true);
});
test('keyboard: Shift+PageUp/PageDown change the year and clamp leap days, the available range is announced',t=>{
  const {W,picker,key,q,status}=setup(t);picker.today=()=> '2028-10-14';picker.view=new W.Date(2028,1,1);picker.render();picker.focusDay('2028-02-29');
  key(W.document.activeElement,'PageUp',{shiftKey:true});assert.equal(W.document.activeElement.dataset.date,'2027-02-28');key(W.document.activeElement,'PageDown',{shiftKey:true});assert.equal(W.document.activeElement.dataset.date,'2028-02-28');
  key(W.document.activeElement,'PageDown');assert.equal(W.document.activeElement.dataset.date,'2028-03-28');key(W.document.activeElement,'PageUp');assert.equal(W.document.activeElement.dataset.date,'2028-02-28');
  picker.view=new W.Date(2028,9,1);picker.render();picker.focusDay('2028-10-14');key(W.document.activeElement,'PageDown',{shiftKey:true});assert.equal(W.document.activeElement.dataset.date,'2028-10-14');assert.match(status(),/Latest available date is Oct 14, 2028/);
  key(W.document.activeElement,'ArrowDown');assert.equal(W.document.activeElement.dataset.date,'2028-10-14');key(W.document.activeElement,'End');assert.equal(W.document.activeElement.dataset.date,'2028-10-14');
  key(W.document.activeElement,'ArrowLeft');assert.equal(W.document.activeElement.dataset.date,'2028-10-13');assert.equal(q('[data-date][tabindex="0"]').dataset.date,'2028-10-13');
  assert.equal(picker.element.querySelectorAll('[data-date][tabindex="0"]').length,1);
});
test('unavailable days stay focusable and explain why they cannot be chosen',t=>{
  const {W,picker,changes,q,status}=setup(t);const future=q('[data-date="2026-10-20"]');assert.equal(future.disabled,false);assert.equal(future.getAttribute('aria-disabled'),'true');future.focus();assert.equal(W.document.activeElement,future);future.click();
  assert.equal(picker.draft.start,'');assert.match(status(),/after Oct 14/i);assert.equal(changes.length,0);assert.equal(q('.calendar-apply').disabled,true);
});
test('the global calendar excludes future days like the room calendar and clamps period chips to today',t=>{
  const {picker,q}=setup(t);assert.equal(picker.chatMode,false);
  assert.equal(q('[data-date="2026-10-14"]').hasAttribute('aria-disabled'),false);assert.equal(q('[data-date="2026-10-15"]').getAttribute('aria-disabled'),'true');
  picker.choose('2026-10-31');assert.equal(picker.draft.start,'');picker.draft={mode:'After',start:'2026-10-14',end:''};assert.equal(picker.bounds(),null);
  picker.draft={mode:'Between',start:'2026-10-01',end:'2026-10-31'};assert.equal(picker.bounds(),null);
  for(const range of picker.quickRanges())assert.ok(range.end<='2026-10-14',range.label);
  picker.render();assert.equal(q('[aria-label="Next month"]').getAttribute('aria-disabled'),'true');q('[aria-label="Next month"]').click();assert.equal(picker.view.getMonth(),9);
  q('[aria-label="Previous month"]').click();assert.equal(picker.view.getMonth(),8);assert.equal(q('[aria-label="Next month"]').hasAttribute('aria-disabled'),false);
});
test('Clear is labelled Clear filter only when a filter is applied, and Apply stays the only filled action',t=>{
  const {picker,q,changes}=setup(t);assert.equal(q('.calendar-clear').textContent,'Clear');q('[data-mode="On"]').click();picker.choose('2026-10-08');q('.calendar-apply').click();picker.show();assert.equal(q('.calendar-clear').textContent,'Clear filter');
  q('.calendar-clear').click();assert.deepEqual(changes.at(-1).dates,{from:'',to:''});assert.equal(q('.calendar-clear').textContent,'Clear');
});
test('Escape closes the month chooser first and the dialog second, returning focus to the heading control',t=>{
  const {W,picker,key,q}=setup(t);assert.equal(q('[role=dialog]')??picker.element.getAttribute('role'),'dialog');assert.equal(picker.element.getAttribute('aria-modal'),'false');
  q('.calendar-year').click();assert.equal(picker.chooser,'year');assert.equal(W.document.activeElement.dataset.year,'2026');assert.equal(q('.calendar-grid'),null);assert.equal(q('.calendar-nav-button').disabled,true);
  key(W.document.activeElement,'Escape');assert.equal(picker.open,true);assert.equal(picker.chooser,'');assert.equal(W.document.activeElement.className,'calendar-year');
  key(W.document.activeElement,'Escape');assert.equal(picker.open,false);
});
test('the month and year chooser keep the popover height and the footer in place',t=>{
  const {picker,q}=setup(t);const names=()=>[...picker.element.children].map(node=>node.className.split(' ')[0]);const before=names();q('.calendar-month').click();assert.deepEqual(names().map(n=>n==='calendar-body'?n:n),before);assert.equal(q('.calendar-footer')!==null,true);assert.equal(q('.calendar-apply')!==null,true);
  assert.equal(picker.element.querySelectorAll('.calendar-option').length,12);
});
test('styles: compact footprint, readable text, Reddit accents and no fixed year width',t=>{
  const styles=css();
  const sizes=[...styles.matchAll(/font-size:\s*([\d.]+)px/g)].map(match=>Number(match[1]));assert.ok(sizes.length>=8);assert.ok(Math.min(...sizes)>=12,`smallest font ${Math.min(...sizes)}px`);
  for(const match of styles.matchAll(/font:\s*(?:\d+\s+)?([\d.]+)px/g))assert.ok(Number(match[1])>=12);
  // Close to the original 264 px popover; floating chat narrower still.
  assert.match(styles,/width:264px/);assert.match(styles,/:host\(\[data-rcs-compact\]\) \.date-popover\{[^}]*width:240px/);
  assert.match(styles,/--calendar-cell:28px/);assert.match(styles,/--calendar-cell:26px/);assert.match(styles,/pointer:coarse[^}]*--calendar-cell:34px/);
  assert.doesNotMatch(styles,/min-height:var\(--calendar-body\)/,'the grid fits the month instead of reserving empty rows');
  assert.match(styles,/gap:0\}/);assert.doesNotMatch(styles,/width:63px/);assert.doesNotMatch(styles,/#1a1a1b|#0002/);
  // Reddit's brand accent marks the active mode, today, the selection and Apply.
  assert.match(styles,/--calendar-accent:var\(--color-brand-background,#d93900\)/);
  assert.match(styles,/\.date-mode\[aria-checked=true\]\{[^}]*box-shadow:inset 0 -2px 0 var\(--calendar-accent\)/);
  assert.match(styles,/\.calendar-day\.today\{color:var\(--calendar-accent\)/);assert.match(styles,/\.calendar-apply\{background:var\(--calendar-accent\)/);
  // Presets stay on one row and scroll instead of wrapping into extra rows.
  assert.match(styles,/\.calendar-presets\{[^}]*flex-wrap:nowrap[^}]*overflow-x:auto/);
  assert.match(styles,/focus-visible\{outline:2px solid var\(--calendar-focus\);outline-offset:-2px\}/);assert.match(styles,/\.calendar-day:focus-visible::before\{outline:2px/);
  assert.match(styles,/@container \(max-width:231px\)/);assert.match(styles,/wd-short\{display:inline\}/);
});
test('styles: transitions exist only under prefers-reduced-motion: no-preference',t=>{
  const styles=css();const gated=styles.slice(styles.indexOf('@media (prefers-reduced-motion:no-preference)'));assert.ok(gated.includes('transition'));assert.equal(styles.slice(0,styles.indexOf('@media (prefers-reduced-motion:no-preference)')).includes('transition'),false);
  assert.doesNotMatch(styles,/calendar-quick/);
});
