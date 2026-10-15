const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
function setup(t,{group=false}={}){
  const dom=new JSDOM('<!doctype html><body></body>',{url:'https://www.reddit.com/chat',runScripts:'outside-only'}),w=dom.window;
  w.HTMLElement.prototype.scrollIntoView=function(){};
  for(const file of ['search-core.js','global-search-model.js','unified-search.js'])w.eval(fs.readFileSync(path.join(__dirname,'../extension',file),'utf8'));
  const el=tag=>w.document.createElement(tag),host=el('div'),shadow=host.attachShadow({mode:'open'}),bar=el('div'),field=el('div'),input=el('input'),filterBar=el('div'),dateToggle=el('button'),dateChip=el('span'),dateLabel=el('button'),dateRemove=el('button'),results=el('div'),status=el('div');field.className='field';field.append(input);bar.append(field,dateToggle);dateChip.append(dateLabel,dateRemove);shadow.append(bar,filterBar,results,status);w.document.body.append(host);
  let renders=0,loads=0,navigation=0,closed=0;const control={host,bar,filterBar,input,dateToggle,dateChip,dateChipLabel:dateLabel,dateRemove,results,status,room:'room',hits:[],dates:{from:'',to:''},datePicker:{open:false,close(){this.open=false;closed++;}},render(){renders++;control.tools?.sync();},ensureData(){loads++;}};
  input.addEventListener('input',()=>control.render());shadow.addEventListener('keydown',()=>navigation++);
  const cache=new Map([['room',group?{id:'room',name:'Planning',type:'group',participants:['Alex','Sam']}:{id:'room',name:'Alex',type:'direct'}]]),tools=w.RCSUnifiedSearch.decorateMessageControl(control,{cache,adapter:{}});
  const key=(value,target=input)=>target.dispatchEvent(new w.KeyboardEvent('keydown',{key:value,bubbles:true,composed:true,cancelable:true}));
  t.after(()=>{tools.destroy();dom.window.close();});
  return {w,control,tools,key,counts:()=>({renders,loads,navigation,closed})};
}
test('room filter and date icons share the input field with independent active states',t=>{
  const {control:c,tools}=setup(t);assert.equal(tools.filterButton.parentElement,c.input.parentElement);assert.equal(c.dateToggle.parentElement,c.input.parentElement);assert.equal(tools.filterButton.textContent,'');assert.equal(c.dateToggle.textContent,'');assert.equal(tools.filterButton.getAttribute('aria-pressed'),'false');
  tools.filterButton.click();assert.equal(tools.popover.getAttribute('aria-label'),'Search filters');assert.ok(tools.popover.querySelector('[data-value="from:"]'));tools.popover.querySelector('[data-value="oldest"]').click();assert.equal(c.queryOptions.sort,'oldest');assert.equal(tools.filterButton.getAttribute('aria-pressed'),'true');tools.sort='newest';c.dates={from:'2026-10-01',to:''};tools.sync();assert.equal(c.dateToggle.hidden,false);assert.equal(c.dateChip.parentNode,tools.senderChips);assert.equal(c.dateToggle.getAttribute('aria-pressed'),'true');assert.equal(tools.filterButton.getAttribute('aria-pressed'),'false');
});
test('room sender dropdown preserves message terms, supports multiple senders and Anyone clears only senders',t=>{
  const {control:c,tools}=setup(t,{group:true});c.input.value='coffee ';
  tools.showMenu('from');assert.deepEqual([...tools.popover.querySelectorAll('button')].map(el=>el.textContent),['Anyone','You','Other people','Alex','Sam']);
  tools.popover.querySelector('[data-value="from:me"]').click();assert.equal(c.input.value,'coffee ');assert.equal(tools.queryValue(),'from:me coffee ');assert.equal(tools.filterButton.getAttribute('aria-pressed'),'true');assert.equal(tools.sort,'newest');
  tools.showMenu('from');tools.popover.querySelector('[data-value="from:Sam"]').click();assert.equal(c.input.value,'coffee ');assert.equal(tools.queryState.filters.length,2);assert.equal(tools.filterButton.getAttribute('aria-pressed'),'true');assert.equal(tools.senderChips.querySelectorAll('.sender-chip').length,2);
  tools.showMenu('from');tools.popover.querySelector('[data-value="all"]').click();assert.equal(c.input.value,'coffee ');assert.equal(tools.filterButton.getAttribute('aria-pressed'),'false');assert.equal(tools.senderChips.querySelectorAll('.sender-chip').length,0);
});
test('room menu keyboard focus and Escape peel off the popup before result navigation',t=>{
  const {control:c,tools,key,counts}=setup(t);tools.filterButton.focus();tools.showMenu('from');key('ArrowDown',tools.filterButton);assert.equal(c.host.shadowRoot.activeElement.textContent,'Anyone');key('ArrowDown',c.host.shadowRoot.activeElement);assert.equal(c.host.shadowRoot.activeElement.textContent,'You');key('Enter',c.host.shadowRoot.activeElement);assert.equal(c.input.value,'');assert.equal(tools.queryValue(),'from:me');assert.equal(counts().navigation,0);
  tools.filterButton.click();key('Escape');assert.equal(tools.popover.hidden,true);assert.equal(c.host.shadowRoot.activeElement,tools.filterButton);assert.equal(counts().navigation,0);
  c.datePicker.open=true;key('Escape');assert.equal(c.datePicker.open,false);assert.equal(counts().closed>0,true);assert.equal(counts().navigation,0);
  key('Escape');assert.equal(counts().navigation,1);
});
test('typing from keeps autocomplete and sender selection query semantics',t=>{
  const {w,control:c,tools,key}=setup(t);c.input.value='coffee from:al';c.input.dispatchEvent(new w.Event('input',{bubbles:true}));assert.equal(tools.valueChoices().length,1);assert.equal(tools.valueChoices()[0].token,'from:Alex');key('Enter');assert.equal(c.input.value,'coffee');assert.equal(tools.queryValue(),'from:Alex coffee');assert.equal(tools.filterButton.getAttribute('aria-pressed'),'true');
});
test('completed typed media filters remain visible and removable beside sender tags',t=>{
  const {w,control:c,tools}=setup(t);c.input.value='photo has:image ';c.input.dispatchEvent(new w.Event('input',{bubbles:true}));assert.equal(c.input.value,'photo  ');assert.equal(tools.queryValue(),'has:image photo  ');assert.equal(tools.senderChips.hidden,false);assert.equal(tools.senderChips.querySelector('.room-type-chip').textContent,'Images');tools.sync();assert.equal(tools.senderChips.querySelectorAll('.room-type-chip').length,1);tools.senderChips.querySelector('[aria-label="Remove image filter"]').click();assert.equal(tools.queryValue(),'photo  ');assert.equal(tools.senderChips.hidden,true);
});
test('filter menu follows its button below the field even when applied tags extend the toolbar',t=>{
  const {control:c,tools}=setup(t);c.host.getBoundingClientRect=()=>({left:100,right:420,width:320,bottom:180});tools.field.getBoundingClientRect=()=>({bottom:148});tools.filterButton.getBoundingClientRect=()=>({right:372});tools.filterButton.click();assert.equal(tools.popover.style.right,'48px');assert.equal(tools.popover.style.left,'');assert.equal(tools.popover.style.top,'-28px');
});
