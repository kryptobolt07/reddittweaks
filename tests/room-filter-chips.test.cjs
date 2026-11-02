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
test('room filters and date share the search field with independent active states',t=>{
  const {control:c,tools}=setup(t);assert.equal(tools.filterButton.parentElement,c.input.parentElement);assert.equal(c.dateToggle.parentElement,c.input.parentElement);assert.equal(tools.filterButton.textContent,'');assert.equal(c.dateToggle.textContent,'');assert.equal(tools.filterButton.getAttribute('aria-pressed'),'false');
  tools.filterButton.click();assert.equal(tools.popover.getAttribute('aria-label'),'Search filters');assert.ok(tools.popover.querySelector('[data-value="from:"]'));tools.popover.querySelector('[data-value="sort"]').click();tools.popover.querySelector('[data-value="oldest"]').click();assert.equal(c.queryOptions.sort,'oldest');assert.equal(tools.filterButton.getAttribute('aria-pressed'),'true');tools.sort='newest';c.dates={from:'2026-10-01',to:''};tools.sync();assert.equal(c.dateToggle.hidden,false);assert.equal(c.dateChip.parentNode,tools.senderChips);assert.ok(c.dateChip.querySelector(':scope > .applied-filter-icon'));assert.equal(tools.controlButtons.date.getAttribute('aria-pressed'),'true');assert.equal(tools.filterButton.getAttribute('aria-pressed'),'false');
});
test('room sender dropdown preserves message terms, supports multiple senders and Any clears only senders',t=>{
  const {control:c,tools}=setup(t,{group:true});c.input.value='coffee ';
  tools.showMenu('from');assert.deepEqual([...tools.popover.querySelectorAll('[role="menuitemcheckbox"]')].map(el=>el.textContent),['Any','You','Other people','Alex','Sam']);
  tools.popover.querySelector('[data-value="from:me"]').click();assert.equal(c.input.value,'coffee ');assert.equal(tools.queryValue(),'from:me coffee ');assert.equal(tools.filterButton.getAttribute('aria-pressed'),'true');assert.equal(tools.sort,'newest');
  tools.showMenu('from');tools.popover.querySelector('[data-value="from:Sam"]').click();assert.equal(c.input.value,'coffee ');assert.equal(tools.queryState.filters.length,2);assert.equal(tools.filterButton.getAttribute('aria-pressed'),'true');assert.equal(tools.senderChips.querySelectorAll('.sender-chip').length,2);assert.equal(tools.senderChips.hidden,false);
  tools.showMenu('from');tools.popover.querySelector('[data-value="all"]').click();assert.equal(c.input.value,'coffee ');assert.equal(tools.filterButton.getAttribute('aria-pressed'),'false');assert.equal(tools.senderChips.querySelectorAll('.sender-chip').length,0);
});
test('room menu keyboard focus and Escape peel off the popup before result navigation',t=>{
  const {control:c,tools,key,counts}=setup(t);tools.filterButton.focus();key('ArrowDown',tools.filterButton);assert.equal(c.host.shadowRoot.activeElement.textContent,'From a person');key('Enter',c.host.shadowRoot.activeElement);key('ArrowDown',tools.filterButton);assert.equal(c.host.shadowRoot.activeElement.textContent,'Any');key('ArrowDown',c.host.shadowRoot.activeElement);assert.equal(c.host.shadowRoot.activeElement.textContent,'You');key('Enter',c.host.shadowRoot.activeElement);assert.equal(c.input.value,'');assert.equal(tools.queryValue(),'from:me');assert.equal(counts().navigation,0);
  tools.filterButton.click();key('Escape');assert.equal(tools.popover.hidden,true);assert.equal(c.host.shadowRoot.activeElement,tools.filterButton);assert.equal(counts().navigation,0);
  c.datePicker.open=true;key('Escape');assert.equal(c.datePicker.open,false);assert.equal(counts().closed>0,true);assert.equal(counts().navigation,0);
  key('Escape');assert.equal(counts().navigation,1);
});
test('typing from keeps autocomplete and sender selection query semantics',t=>{
  const {w,control:c,tools,key}=setup(t);c.input.value='coffee from:al';c.input.dispatchEvent(new w.Event('input',{bubbles:true}));assert.equal(tools.valueChoices().length,1);assert.equal(tools.valueChoices()[0].token,'from:Alex');key('Enter');assert.equal(c.input.value,'coffee');assert.equal(tools.queryValue(),'from:Alex coffee');assert.equal(tools.filterButton.getAttribute('aria-pressed'),'true');
});
test('completed typed media filters remain visible and removable alongside sender tags',t=>{
  const {w,control:c,tools,key}=setup(t);c.input.value='photo has:image ';c.input.dispatchEvent(new w.Event('input',{bubbles:true}));key('Enter');assert.equal(c.input.value,'photo  ');assert.equal(tools.queryValue(),'has:image photo  ');assert.equal(tools.senderChips.hidden,false);assert.equal(tools.senderChips.querySelector('.room-type-chip').textContent,'Images');tools.sync();assert.equal(tools.senderChips.querySelectorAll('.room-type-chip').length,1);tools.senderChips.querySelector('[aria-label="Remove image filter"]').click();assert.equal(tools.queryValue(),'photo  ');assert.equal(tools.senderChips.hidden,true);
});
test('filter menu aligns with its button below the toolbar including applied filter tags',t=>{
  const {control:c,tools}=setup(t);c.host.getBoundingClientRect=()=>({left:100,right:420,width:320,bottom:180});tools.field.getBoundingClientRect=()=>({bottom:148});tools.filterButton.getBoundingClientRect=()=>({right:372});tools.filterButton.click();assert.equal(tools.popover.style.right,'48px');assert.equal(tools.popover.style.left,'');assert.equal(tools.popover.style.top,'4px');
});
test('You uses the saved account profile even when only other senders match, including refreshed chips',t=>{
  const {w,control:c,tools}=setup(t);let avatar='https://example.test/self.png';
  w.RCSMessages={getSelfIdentity:()=>({id:'@self:reddit.com',name:'You',avatar})};
  c.hits=[{author:'Alex',avatar:'https://example.test/alex.png'}];tools.sync();
  assert.equal(tools.senderChoices().find(choice=>choice.name==='me').avatar,avatar);
  tools.showMenu('from');assert.equal(tools.popover.querySelector('[data-value="from:me"] img').src,avatar);
  tools.popover.querySelector('[data-value="from:me"]').click();assert.equal(tools.senderChips.querySelector('img').src,avatar);
  avatar='https://example.test/self-new.png';tools.sync();assert.equal(tools.senderChips.querySelector('img').src,avatar);
  c.hits=[{authorSelf:true},{authorSelf:true,avatar:'https://example.test/fallback.png'}];w.RCSMessages.getSelfIdentity=()=>null;tools.sync();
  assert.equal(tools.senderChoices().find(choice=>choice.name==='me').avatar,'https://example.test/fallback.png');
});
test('room menu exposes every supported message type and shared sort, without global conversation filters',t=>{
  const {control:c,tools}=setup(t);
  for(const type of ['image','gif','link']){
    tools.showMenu('filter');tools.popover.querySelector('[data-value="contains"]').click();const option=tools.popover.querySelector('[data-value="has:'+type+'"]');assert.ok(option,type);assert.equal(tools.popover.querySelector('[data-value="has:video"],[data-value="has:audio"],[data-value="has:file"]'),null);option.click();
    assert.ok(tools.queryValue().includes('has:'+type));const glyph=tools.senderChips.querySelector('.room-type-chip > .applied-filter-icon');assert.ok(glyph);assert.equal(glyph.getAttribute('aria-hidden'),'true');assert.equal(tools.popover.hidden,true);
    tools.showMenu('filter');tools.popover.querySelector('[data-value="contains"]').click();assert.equal(tools.popover.querySelector('[data-value="has:'+type+'"]').getAttribute('aria-checked'),'true');
    assert.equal(tools.popover.querySelector('[data-value="groups"],[data-value="requests"],[data-value="unread"]'),null);
    tools.closeMenu();
  }
  assert.ok(tools.senderChips.textContent.includes('Links'));tools.senderChips.querySelector('[aria-label="Remove link filter"]').click();assert.equal(tools.queryValue(),'');
});
test('room autocomplete supports all operators, filtered media choices and keyboard acceptance',t=>{
  const {w,control:c,tools,key}=setup(t),type=value=>{c.input.value=value;c.input.dispatchEvent(new w.Event('input',{bubbles:true}));};
  for(const operator of ['from','has','before','after']){type('coffee '+operator.slice(0,-1));assert.equal(tools.suggestions.hidden,true);type('coffee '+operator);assert.equal(tools.suggestionOptions[0].token,operator+':');assert.ok(tools.suggestions.querySelector('svg'));}
  type('coffee has');key('Enter');assert.equal(c.input.value,'coffee has:');assert.equal(tools.suggestionOptions.length,3);
  type('coffee has:li');assert.equal(tools.suggestionOptions.length,1);key('ArrowDown');key('Enter');assert.equal(tools.queryValue(),'has:link coffee ');
  tools.queryState.clear();type('coffee after:');assert.equal(tools.suggestionOptions[0].token,'Custom');assert.ok(tools.suggestionOptions.slice(1).every(option=>/^after:\d{4}-\d{2}-\d{2}$/.test(option.token)));key('ArrowDown');key('ArrowDown');key('Enter');
  assert.ok(tools.queryState.filters.some(item=>item.kind==='after'));assert.equal(tools.controlButtons.date.getAttribute('aria-pressed'),'true');assert.equal(tools.filterButton.getAttribute('aria-pressed'),'false');
});


test('room Filters use confirmed local counts, badges, removable sort and Reset without losing dates or text',t=>{
  const {control:c,tools}=setup(t);c.input.value='coffee';c.dates={from:'2026-10-01',to:''};c.messageFilterCounts=()=>({image:2,gif:0,link:1,video:0,audio:0,file:0});tools.sync();tools.showMenu('filter');tools.popover.querySelector('[data-value="contains"]').click();
  const image=tools.popover.querySelector('[data-value="has:image"]');assert.equal(image.querySelector('.menu-option-count').textContent,'2');assert.equal(tools.popover.querySelector('[data-value="has:gif"]').disabled,true);image.click();assert.equal(tools.filterButton.dataset.filterCount,'1');
  tools.showMenu('filter');tools.popover.querySelector('[data-value="sort"]').click();tools.popover.querySelector('[data-value="oldest"]').click();assert.equal(tools.filterButton.dataset.filterCount,'2');assert.ok(tools.senderChips.querySelector('[aria-label="Remove sort filter"]').parentElement.querySelector(':scope > .applied-filter-icon'));
  tools.showMenu('filter');tools.popover.querySelector('[aria-label="Reset filters"]').click();assert.equal(c.input.value,'coffee');assert.equal(c.dates.from,'2026-10-01');assert.equal(tools.queryState.filters.length,0);assert.equal(tools.sort,'newest');assert.equal(tools.filterButton.dataset.filterCount,'');assert.equal(tools.controlButtons.date.getAttribute('aria-pressed'),'true');
});
test('room submenu Escape returns to its category before another Escape closes filters',t=>{
  const {control:c,tools,key}=setup(t);c.input.value='coffee';tools.showMenu('filter');
  assert.deepEqual([...tools.popover.querySelectorAll('.operator-option')].map(el=>el.dataset.value),['from:','contains','sort','tips']);assert.equal(tools.popover.querySelector('[role="menuitemradio"]'),null);
  for(const [row,section]of [['from:','from'],['contains','contains'],['sort','sort']]){
    tools.popover.querySelector('[data-value="'+row+'"]').click();assert.equal(tools.filterSection,section);key('Escape',c.host.shadowRoot.activeElement);assert.equal(tools.popover.hidden,false);assert.equal(tools.filterSection,'');assert.equal(c.host.shadowRoot.activeElement.dataset.value,row);assert.equal(c.input.value,'coffee');
  }
  key('Escape',c.host.shadowRoot.activeElement);assert.equal(tools.popover.hidden,true);assert.equal(c.host.shadowRoot.activeElement,tools.filterButton);
});

test('room Boolean sender completion stays inline and syntax suggestions and tips use existing keys',t=>{
  const {w,control:c,tools,key}=setup(t),type=value=>{c.input.value=value;c.input.dispatchEvent(new w.Event('input',{bubbles:true}));};
  type('(from:me OR from:Al');assert.equal(tools.valuePicker().prefix,'Al');key('Enter');
  assert.equal(c.input.value,'(from:me OR from:Alex ');assert.equal(tools.queryState.filters.length,0);
  type('(from:me OR from:Alex) NOT has:image');assert.equal(c.input.value,'(from:me OR from:Alex) NOT has:image');assert.equal(tools.queryState.filters.length,0);
  type('cats ');assert.deepEqual(Array.from(tools.suggestionOptions,option=>option.token),['from:','has:','before:','after:','AND','OR','NOT','( )','"phrase"','-exclude']);
  type('cats N');key('ArrowDown');assert.equal(tools.suggestions.querySelector('[aria-selected=true] code').textContent,'NOT');key('Enter');assert.equal(c.input.value,'cats NOT ');
  tools.showMenu('filter');tools.popover.querySelector('[data-value="tips"]').click();assert.equal(tools.popover.querySelectorAll('.search-tip').length,10);key('Escape',c.host.shadowRoot.activeElement);assert.equal(c.host.shadowRoot.activeElement.dataset.value,'tips');
});
