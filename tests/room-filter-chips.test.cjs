const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
function setup(t,{group=false}={}){
  const dom=new JSDOM('<!doctype html><body></body>',{url:'https://www.reddit.com/chat',runScripts:'outside-only'}),w=dom.window;
  w.HTMLElement.prototype.scrollIntoView=function(){};
  for(const file of ['search-core.js','unified-search.js'])w.eval(fs.readFileSync(path.join(__dirname,'../extension',file),'utf8'));
  const el=tag=>w.document.createElement(tag),host=el('div'),shadow=host.attachShadow({mode:'open'}),bar=el('div'),field=el('div'),input=el('input'),filterBar=el('div'),dateToggle=el('button'),dateChip=el('span'),dateLabel=el('button'),dateRemove=el('button'),results=el('div'),status=el('div');field.className='field';field.append(input);bar.append(field,dateToggle);dateChip.append(dateLabel,dateRemove);shadow.append(bar,filterBar,results,status);w.document.body.append(host);
  let renders=0,loads=0,navigation=0,closed=0;const control={host,bar,filterBar,input,dateToggle,dateChip,dateChipLabel:dateLabel,dateRemove,results,status,room:'room',hits:[],dates:{from:'',to:''},datePicker:{open:false,close(){this.open=false;closed++;}},render(){renders++;control.tools?.sync();},ensureData(){loads++;}};
  input.addEventListener('input',()=>control.render());shadow.addEventListener('keydown',()=>navigation++);
  const cache=new Map([['room',group?{id:'room',name:'Planning',type:'group',participants:['Alex','Sam']}:{id:'room',name:'Alex',type:'direct'}]]),tools=w.RCSUnifiedSearch.decorateMessageControl(control,{cache,adapter:{}});
  const key=(value,target=input)=>target.dispatchEvent(new w.KeyboardEvent('keydown',{key:value,bubbles:true,composed:true,cancelable:true}));
  t.after(()=>{tools.destroy();dom.window.close();});
  return {w,control,tools,key,counts:()=>({renders,loads,navigation,closed})};
}
test('room filter chips separate sender, date and sort with independent active states',t=>{
  const {control:c,tools}=setup(t);
  assert.deepEqual([...c.filterBar.children].map(el=>el.textContent),['From: Anyone','Date','','Sort: Newest']);
  assert.equal(c.bar.querySelector('.query-filter'),null);assert.equal(tools.fromButton.getAttribute('aria-pressed'),'false');
  tools.sortButton.click();assert.deepEqual([...tools.popover.querySelectorAll('button')].map(el=>el.textContent),['Newest','Oldest','Relevant']);
  tools.popover.querySelector('[data-value="oldest"]').click();assert.equal(c.queryOptions.sort,'oldest');assert.equal(tools.sortButton.textContent,'Sort: Oldest');assert.equal(tools.sortButton.getAttribute('aria-pressed'),'true');assert.equal(tools.fromButton.getAttribute('aria-pressed'),'false');
  c.dates={from:'2026-10-01',to:''};tools.sync();assert.equal(c.dateToggle.hidden,true);assert.equal(c.dateChip.parentNode,c.filterBar);assert.equal(tools.fromButton.getAttribute('aria-pressed'),'false');
});
test('room sender dropdown preserves message terms, supports multiple senders and Anyone clears only senders',t=>{
  const {control:c,tools}=setup(t,{group:true});c.input.value='coffee ';
  tools.fromButton.click();assert.deepEqual([...tools.popover.querySelectorAll('button')].map(el=>el.textContent),['Anyone','You','Other people','Alex','Sam']);
  tools.popover.querySelector('[data-value="from:me"]').click();assert.equal(c.input.value,'coffee from:me ');assert.equal(tools.fromButton.textContent,'From: You');assert.equal(tools.sort,'newest');
  tools.fromButton.click();tools.popover.querySelector('[data-value="from:Sam"]').click();assert.equal(c.input.value,'coffee from:me from:Sam ');assert.equal(tools.fromButton.textContent,'From: 2 people');assert.equal(tools.senderChips.querySelectorAll('.sender-chip').length,2);
  tools.fromButton.click();tools.popover.querySelector('[data-value="all"]').click();assert.equal(c.input.value,'coffee ');assert.equal(tools.fromButton.textContent,'From: Anyone');assert.equal(tools.senderChips.querySelectorAll('.sender-chip').length,0);
});
test('room menu keyboard focus and Escape peel off the popup before result navigation',t=>{
  const {control:c,tools,key,counts}=setup(t);tools.fromButton.focus();tools.fromButton.click();key('ArrowDown',tools.fromButton);assert.equal(c.host.shadowRoot.activeElement.textContent,'Anyone');key('ArrowDown',c.host.shadowRoot.activeElement);assert.equal(c.host.shadowRoot.activeElement.textContent,'You');key('Enter',c.host.shadowRoot.activeElement);assert.equal(c.input.value,'from:me ');assert.equal(counts().navigation,0);
  tools.sortButton.click();key('Escape');assert.equal(tools.popover.hidden,true);assert.equal(c.host.shadowRoot.activeElement,tools.sortButton);assert.equal(counts().navigation,0);
  c.datePicker.open=true;key('Escape');assert.equal(c.datePicker.open,false);assert.equal(counts().closed>0,true);assert.equal(counts().navigation,0);
  key('Escape');assert.equal(counts().navigation,1);
});
test('typing from keeps autocomplete and sender selection query semantics',t=>{
  const {w,control:c,tools,key}=setup(t);c.input.value='coffee from:al';c.input.dispatchEvent(new w.Event('input',{bubbles:true}));assert.equal(tools.valueChoices().length,1);assert.equal(tools.valueChoices()[0].token,'from:Alex');key('Enter');assert.equal(c.input.value,'coffee from:Alex ');assert.equal(tools.fromButton.textContent,'From: Alex');
});
