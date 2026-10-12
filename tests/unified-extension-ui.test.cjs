const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const settle=async()=>{for(let i=0;i<35;i++)await Promise.resolve();};
async function setup(t,{large=false,deferSearch=false}={}) {
  const dom=new JSDOM('<!doctype html><body></body>',{url:'https://www.reddit.com/chat',runScripts:'outside-only'}),w=dom.window;
  w.TextEncoder=TextEncoder;w.HTMLElement.prototype.scrollIntoView=function(){};
  let clock=0,id=0;const timers=new Map();w.setTimeout=(fn,ms=0)=>{timers.set(++id,{fn,at:clock+ms});return id;};w.clearTimeout=value=>timers.delete(value);w.requestAnimationFrame=fn=>w.setTimeout(fn,0);w.cancelAnimationFrame=w.clearTimeout;
  const tick=async ms=>{const end=clock+ms;for(;;){const next=[...timers].filter(([,timer])=>timer.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;clock=next[1].at;timers.delete(next[0]);next[1].fn();await settle();}clock=end;await settle();};
  const load=file=>w.eval(fs.readFileSync(path.join(__dirname,'..',file),'utf8'));
  load('extension/search-core.js');load('extension/adapter.js');load('extension/date-picker.js');load('extension/message-store.js');load('demo/fixture.js');
  const fixture=w.ChatFixture.build(w.document.body),cache=new Map(w.ChatFixture.conversations.map((record,index)=>[record.id,{id:record.id,name:record.name,type:index===1?'group':'direct',membership:index===2?'invite':'join',timestamp:1791432000000,unreadCount:index===0?3:0,avatar:'https://example.invalid/avatar/'+record.id+'.png'}]));
  const store=new w.RCSMessageStore.Store({indexedDB:null});let owner='@t2_me:reddit.com';
  for(const [roomId,events]of fixture.remoteMessages)await store.ingest({owner,roomId,events,identities:[{id:'@t2_'+roomId+':reddit.com',name:cache.get(roomId)?.name || roomId}]});
  if(large){for(let start=0;start<1400;start+=700)await store.ingest({owner,roomId:'alex',events:Array.from({length:700},(_,i)=>({event_id:'large-'+(start+i),room_id:'alex',type:'m.room.message',sender:i%2?'@t2_me:reddit.com':'@t2_alex:reddit.com',origin_server_ts:1791432000000+(start+i)*1000,content:{body:'Coffee tomorrow with the team '+(start+i)}}))});}
  const storage={},requests=[],searches=[],listeners=new Set(),pending=[];
  w.chrome={storage:{local:{get:async key=>({[key]:storage[key]}),set:async value=>Object.assign(storage,value)}}};
  let loadError=false;
  w.RCSDirectory={getStartup:()=>({pending:false,entry:{directoryComplete:true}}),getOwner:()=>owner,load:(force,progress)=>{requests.push({method:'directory',force});progress({records:[]});return {promise:loadError?Promise.reject(Error('offline')):Promise.resolve([...cache.values()]),cancel:()=>requests.push({method:'cancel'})};}};
  w.RCSData={request:(method,parameters)=>{requests.push({method,...parameters});if(method==='open' || method==='jump')fixture.select(parameters.roomId);return {promise:Promise.resolve({})};}};
  w.RCSMessages={search:async parameters=>{searches.push({...parameters});if(deferSearch)await new Promise(resolve=>pending.push(resolve));return store.search(owner,parameters);},room:roomId=>store.room(owner,roomId),summaries:()=>store.summaries(owner),subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener);}};
  load('extension/unified-search-styles.js');load('extension/unified-search.js');const control=new w.RCSUnifiedSearch(fixture.nav,{cache,adapter:w.RCSAdapter,version:'test'});
  t.after(()=>{control.destroy();dom.window.close();});await settle();
  const find=selector=>{const value=control.shadow.querySelector(selector);assert.ok(value,'Missing '+selector);return value;};
  const click=async selector=>{find(selector).click();await settle();};
  const type=query=>{control.input.value=query;control.input.dispatchEvent(new w.Event('input',{bubbles:true}));};
  const search=async query=>{type(query);await tick(180);};
  const key=async(name,target=control.input)=>{target.dispatchEvent(new w.KeyboardEvent('keydown',{key:name,bubbles:true,cancelable:true,composed:true}));await settle();};
  return {w,control,fixture,cache,store,storage,requests,searches,pending,find,click,type,search,tick,key,emit:value=>listeners.forEach(listener=>listener(value)),setOwner:value=>{owner=value;},setOffline:()=>{loadError=true;}};
}

test('unified panel mounts into native fixture with real local storage, native idle view and no global history loading',async t=>{
  const p=await setup(t),c=p.control;
  assert.equal(c.host.getAttribute('data-rcs-ui'),'list');assert.equal(c.host.parentNode,p.fixture.nav.shadowRoot);
  assert.equal(c.input.placeholder,'Search chats and messages');
  assert.ok(c.summaries.size>0);assert.equal(c.panel.hidden,true);await p.search('alex');assert.equal(c.shadow.querySelector('.row-snippet'),null);assert.ok(p.find('.chat-result .row-time').textContent);
  assert.equal(p.requests.filter(item=>item.method==='directory').length,1);
  assert.ok(p.requests.every(item=>['directory'].includes(item.method)));
  c.sync();c.sync();await settle();assert.equal(p.requests.length,1);
  assert.match(p.find('.coverage-footer').textContent,/History may be incomplete/);
  for(const button of c.shadow.querySelectorAll('.icon-button')){assert.ok(button.getAttribute('aria-label'));assert.ok(button.title);}
});

test('typing debounces 180ms while captures and native sync never starve or restart the query',async t=>{
  const p=await setup(t);p.control.input.focus();await settle();const count=p.searches.length;
  p.type('coffee');await p.tick(179);p.emit({owner:p.control.owner});p.control.sync();await settle();
  assert.equal(p.searches.length,count);await p.tick(1);
  assert.equal(p.searches.at(-1).query,'coffee');assert.ok(p.control.savedTotal>0);
  assert.ok(p.control.savedHits.every(record=>/coffee/i.test(record.text)));
  assert.match(p.find('[data-scope="messages"]').textContent,/Messages \(\d+\)/);
});

test('scope counts remain independent and sender/operator/known unread filters compose',async t=>{
  const p=await setup(t);p.control.input.focus();await p.search('coffee');
  const messages=p.control.savedTotal;await p.click('[data-scope="people"]');
  assert.equal(p.control.savedTotal,messages);assert.equal(p.control.shadow.querySelectorAll('.message-result').length,0);
  await p.click('[data-scope="messages"]');assert.equal(p.control.shadow.querySelectorAll('.chat-result').length,0);
  await p.click('[data-control="from"]');await p.click('[data-value="me"]');assert.ok(p.control.savedHits.every(record=>record.authorSelf));
  await p.search('from:them ');assert.equal(p.control.savedTotal,0);
  await p.click('[aria-label="Remove sender filter"]');assert.ok(p.control.savedHits.every(record=>!record.authorSelf));
  await p.click('[data-control="filter"]');await p.click('[data-value="unread"]');
  assert.ok(p.control.savedHits.length>0);assert.ok(p.control.savedHits.every(record=>record.roomId==='alex'));
  assert.match(p.find('.active-filters').textContent,/Unread/);
});

test('native open and jump retain sidebar, recent searches are account scoped, flat message rows open without context reads',async t=>{
  const p=await setup(t);p.control.input.focus();await p.search('coffee');await p.click('[data-scope="messages"]');
  assert.equal(p.control.shadow.querySelector('.context-button'),null);
  await p.click('.message-open');assert.ok(p.requests.some(item=>item.method==='jump' && item.eventId));
  assert.equal(p.control.panel.hidden,false);assert.equal(p.control.input.value,'coffee');assert.equal(JSON.stringify(p.storage['rcs-unified-recent:@t2_me:reddit.com']),'["coffee"]');
  await p.key('Escape');assert.equal(p.control.input.value,'');await p.click('[data-scope="all"]');assert.equal(p.control.panel.hidden,true);assert.ok(p.control.recent.includes('coffee'));await p.search('alex');await p.click('[data-scope="people"]');
  await p.click('.chat-result');assert.ok(p.requests.some(item=>item.method==='open'));
  p.control.resetSaved();p.setOwner('@t2_other:reddit.com');p.control.render();await settle();assert.equal(p.control.recent.length,0);
  assert.equal(p.control.shadow.querySelector('.recent-row'),null);
});

test('calendar range can be selected in one popover and date filters cleared without native history requests',async t=>{
  const p=await setup(t);await p.click('[data-control="date"]');const picker=p.control.datePicker;
  picker.view=new p.w.Date(2026,9,1);picker.render();picker.choose('2026-10-01');picker.choose('2026-10-09');
  assert.equal(picker.open,true);const bounds=picker.bounds();assert.equal(bounds.from,'2026-10-01');assert.equal(bounds.to,'2026-10-09');
  picker.applied={...picker.draft};picker.onChange(bounds,picker.summary());picker.close();await settle();
  assert.ok(p.find('[aria-label="Remove date filter"]'));await p.click('[aria-label="Remove date filter"]');
  assert.equal(p.control.dates.from,'');assert.equal(p.control.dates.to,'');assert.ok(p.requests.every(item=>item.method==='directory'));
});

test('flat results virtualize every loaded message and pagination retains correct global counts',async t=>{
  const p=await setup(t,{large:true});p.control.input.focus();await p.search('coffee');await p.click('[data-scope="messages"]');
  assert.ok(p.control.savedTotal>1400);assert.equal(p.control.savedHits.length,500);assert.equal(p.control.hasMore,true);
  assert.ok(p.control.shadow.querySelectorAll('.message-result').length<15);assert.equal(p.control.shadow.querySelector('.more-matches'),null);
  assert.ok(p.control.items.filter(item=>item.kind==='message').length>490);
  assert.ok(p.control.shadow.querySelectorAll('.message-result').length<15);
  await p.control.searchSaved(true);await settle();assert.equal(p.control.savedHits.length,1000);
  assert.ok(p.control.items.filter(item=>item.kind==='message').length>990);assert.ok(p.control.shadow.querySelectorAll('.message-result').length<15);
  assert.equal(p.searches.at(-1).offset,500);assert.equal(p.requests.filter(item=>item.method==='history').length,0);
});

test('arrow navigation opens results, query reset removes active descendant, avatar nodes are reused',async t=>{
  const p=await setup(t);p.control.input.focus();await p.search('coffee');await p.click('[data-scope="messages"]');
  const image=p.find('.avatar');p.control.render();await settle();assert.equal(p.find('.avatar'),image);
  await p.key('ArrowDown');assert.ok(p.control.active.startsWith('message:'));assert.ok(p.control.input.getAttribute('aria-activedescendant'));
  await p.key('Enter');assert.ok(p.requests.some(item=>item.method==='jump'));await p.key('Enter');assert.equal(p.requests.filter(item=>item.method==='jump').length,2);
  await p.search('no-synthetic-message');assert.equal(p.control.input.hasAttribute('aria-activedescendant'),false);assert.match(p.find('.empty-state').textContent,/fewer search terms/);
  await p.click('[data-control="from"]');await p.click('[data-value="me"]');assert.match(p.find('.empty-state').textContent,/removing a filter/);
});

test('directory failure keeps cached chats and account reset/destroy discard listeners and private UI data',async t=>{
  const p=await setup(t);const size=p.control.cache.size;p.setOffline();await p.control.ensureData(true);
  assert.equal(p.control.cache.size,size);assert.match(p.control.status.textContent,/Saved conversations available/);
  p.control.input.focus();await p.search('coffee');p.control.saveRecent();p.control.resetSaved();assert.equal(p.control.savedHits.length,0);assert.equal(p.control.recent.length,0);assert.equal(p.control.imageCache.size,0);
  const host=p.control.host;p.control.destroy();assert.equal(host.isConnected,false);
  p.emit({owner:'@t2_me:reddit.com'});await settle();assert.equal(host.isConnected,false);
});

test('Enter flushes pending input and opens first matching native result; tab arrows change scope',async t=>{
  const p=await setup(t);p.control.input.focus();p.type('coffee');await p.key('Enter');await settle();
  assert.ok(p.requests.some(item=>item.method==='jump'));
  await p.key('ArrowRight',p.find('[data-scope="all"]'));assert.equal(p.control.scope,'people');
  await p.key('End',p.find('[data-scope="people"]'));assert.equal(p.control.scope,'messages');
  const calls=p.requests.length;await p.click('.icon-button[aria-label="Refresh saved results"]');
  assert.equal(p.requests.length,calls);assert.equal(p.searches.at(-1).retryWrites,true);
});

test('account change removes previous people/query immediately and recent persistence waits for a known owner',async t=>{
  const p=await setup(t);p.control.input.focus();await p.search('coffee');await p.click('.message-open');
  p.setOwner('@t2_new:reddit.com');p.emit({owner:'@t2_new:reddit.com',accountChanged:true});
  assert.equal(p.control.cache.size,0);assert.equal(p.control.input.value,'');assert.equal(p.control.recent.length,0);
  assert.equal(p.control.shadow.querySelector('.chat-result'),null);assert.equal(p.control.savedHits.length,0);
  await settle();assert.equal(p.control.owner,'@t2_new:reddit.com');
  assert.equal(p.storage['rcs-unified-recent:@t2_new:reddit.com'],undefined);
});

test('capture changes preserve results, retained unavailable names match and people phrases remain exact',async t=>{
  const p=await setup(t);p.control.input.focus();await p.search('coffee');await p.click('[data-scope="messages"]');
  const hits=p.control.savedHits;p.emit({owner:p.control.owner,changed:true,roomIds:['alex']});assert.equal(p.control.savedHits,hits);assert.equal(p.control.shadow.querySelector('.message-context'),null);await settle();
  const chat=p.cache.get('alex');p.cache.set('alex',{...chat,name:'Retained Coffee Person',accountUnavailable:true});
  await p.search('deleted');await p.click('[data-scope="people"]');assert.equal(p.control.people()[0].id,'alex');
  await p.search('"Coffee Retained"');assert.equal(p.control.people().length,0);
  await p.search('"Retained Coffee"');assert.equal(p.control.people().length,1);
});

test('single filter icon exposes all options while From/sort/word stay out of the toolbar',async t=>{
  const p=await setup(t);assert.equal(p.find('[data-control="from"]').hidden,true);assert.equal(p.find('[data-control="sort"]').hidden,true);assert.equal(p.control.word.hidden,true);
  assert.equal(p.control.controls.parentNode,p.control.field,'filter/calendar share the input ribbon instead of an empty toolbar row');
  assert.equal(p.find('[data-control="filter"]').querySelector('span').hidden,true);assert.equal(p.find('[data-control="date"]').hidden,false);
  p.control.input.focus();await p.search('coff');await p.click('[data-control="filter"]');
  assert.deepEqual([...p.control.popover.querySelectorAll('.menu-section-title')].map(el=>el.textContent),['Filter results…','Chats','Sort']);
  assert.ok(p.find('[data-value="has:"]'));assert.ok(p.find('[data-value="wholeWord"]'));
  await p.click('[data-value="wholeWord"]');assert.equal(p.control.wholeWord,true);assert.equal(p.control.savedTotal,0);assert.ok(p.find('[data-control="filter"]').classList.contains('active'));
  await p.click('[data-control="filter"]');await p.click('[data-value="has:"]');assert.match(p.control.input.value,/has:/);await p.key('Enter');assert.match(p.control.input.value,/has:link/);
});

test('native header stays above search while list rows stay below; header overrides restore on unmount',async t=>{
  const p=await setup(t),header=p.fixture.nav.shadowRoot.querySelector('.nav-head');
  header.style.position='static';header.append(p.w.document.createElement('rs-rooms-nav-filter'));
  p.control.sync();assert.equal(header.style.position,'relative');assert.equal(header.style.zIndex,'2');
  p.control.savedTotal=2000;p.control.updateControls();assert.equal(p.control.common.hidden,true,'empty browsing is not a common-word search');
  p.control.destroy();assert.equal(header.style.position,'static');assert.equal(header.style.zIndex,'');
  const host=p.w.document.createElement('div');header.after(host);header.style.zIndex='9';
  p.w.RCSAdapter.syncSearchLayer(p.fixture.nav,host,'rs-rooms-nav-filter');assert.equal(header.style.zIndex,'9','preserve the native higher layer');
  header.style.position='sticky';p.w.RCSAdapter.releaseSearchLayer(host);assert.equal(header.style.position,'sticky','preserve a later native update');
});

test('operator commands insert query tokens and sender values use main avatar rows without native navigation',async t=>{
  const p=await setup(t);p.control.input.focus();p.type('coffee fr');assert.equal(p.control.suggestions.hidden,true);
  p.type('coffee from');assert.equal(p.control.suggestions.hidden,false);assert.match(p.find('[role="option"]').textContent,/from:.*From a person/);assert.ok(p.find('[role="option"] svg'));const calls=p.requests.length;
  await p.key('Enter');assert.equal(p.control.input.value,'coffee from:');assert.equal(p.control.suggestions.hidden,true);assert.ok(p.find('.sender-result .avatar'));assert.match(p.control.status.textContent,/Choose a sender/);
  p.cache.set('space',{id:'space',name:'Coffee Person',type:'direct'});p.control.senderChoicesCache=null;p.type('coffee from:Co');assert.match(p.find('.sender-result').textContent,/Coffee Person/);
  await p.key('ArrowDown');assert.ok(p.find('.sender-result.keyboard-focus'));await p.key('Enter');assert.equal(p.control.input.value,'coffee from:"Coffee Person" ');assert.equal(p.requests.length,calls);
  p.type('has');await p.key('Enter');assert.equal(p.control.input.value,'has:');assert.equal(p.control.suggestions.hidden,true);await p.key('Enter');assert.equal(p.control.input.value,'has:link ');
  p.type('before');assert.equal(p.control.suggestions.hidden,false);await p.key('Escape');assert.equal(p.control.suggestions.hidden,true);assert.equal(p.control.input.value,'before');assert.equal(p.requests.filter(item=>item.method==='history').length,0);
});

test('in-flight capture updates coalesce without restarting requests and preserve committed results',async t=>{
  const p=await setup(t,{deferSearch:true});assert.equal(p.searches.length,0);p.type('coffee');await p.tick(180);assert.equal(p.searches.length,1);
  p.emit({owner:'@t2_me:reddit.com',changed:true});p.emit({owner:'@t2_me:reddit.com',changed:true});
  assert.equal(p.searches.length,1);p.pending.shift()();await settle();assert.equal(p.searches.length,2);
  p.pending.shift()();await settle();assert.equal(p.searches.length,2);assert.ok(p.control.savedTotal>0);
  p.control.input.focus();p.type('tomorrow');await p.tick(180);assert.equal(p.searches.length,3);const previous=p.control.savedHits;
  p.emit({owner:'@t2_me:reddit.com',changed:true});assert.equal(p.control.savedHits,previous);assert.equal(p.searches.length,3);
  p.pending.shift()();await settle();assert.equal(p.searches.length,4);p.pending.shift()();await settle();assert.ok(p.control.savedHits.every(record=>/tomorrow/i.test(record.text)));
});

test('missing conversation dates remain blank and unavailable names do not falsely claim retention',async t=>{
  const p=await setup(t);const row=p.control.time(0);assert.equal(row.textContent,'');assert.equal(row.title,'Date unavailable');assert.equal(row.hasAttribute('datetime'),false);
  const chat=p.cache.get('alex');p.cache.set('alex',{...chat,accountUnavailable:true,historicalName:false});p.control.render();await settle();assert.equal(p.find('.chat-result .row-meta').textContent,'Unavailable account');
});

test('has: autocomplete provides a valid link operator and missing native event retries are bounded',async t=>{
  const p=await setup(t);p.control.input.focus();p.type('coffee has:');assert.equal(p.control.suggestions.hidden,true);assert.match(p.find('.sender-result').textContent,/Link/);
  await p.key('Enter');assert.equal(p.control.input.value,'coffee has:link ');
  let scans=0;const adapter=p.control.adapter;p.control.adapter={...adapter,chatRoots:()=>{scans++;return [];}};
  await p.control.openMessage({roomId:'alex',id:'absent-native-event',timestamp:1791432000000});await p.tick(1600);const final=scans;
  await p.tick(1000);assert.equal(scans,final);assert.equal(final,16);assert.equal(p.requests.filter(item=>item.method==='jump').length,1);
});

test('individual room tools insert operators and use the current result panel for sender selection',async t=>{
  const p=await setup(t),w=p.w,host=w.document.createElement('div');host.dataset.rcsUi='messages';const shadow=host.attachShadow({mode:'open'}),bar=w.document.createElement('div'),input=w.document.createElement('input'),date=w.document.createElement('button'),results=w.document.createElement('div'),status=w.document.createElement('span');date.innerHTML='<svg></svg>Date';bar.append(input,date);shadow.append(bar,results,status);p.fixture.room.shadowRoot.append(host);
  let renders=0,loads=0,navigation=0;const room={host,bar,input,dateToggle:date,results,status,dates:{from:'',to:''},room:'alex',hits:[],active:-1,render(){renders++;room.tools?.sync();room.tools?.renderValueChoices();},ensureData(){if(!room.tools?.valuePicker())loads++;}};
  input.addEventListener('input',()=>{room.render();room.ensureData();});room.datePicker=new w.RCSDatePicker({onChange:()=>{},onClose:()=>{}});shadow.append(room.datePicker.element);shadow.addEventListener('keydown',()=>{navigation++;});
  const before=p.requests.length,tools=w.RCSUnifiedSearch.decorateMessageControl(room,{cache:p.cache,adapter:w.RCSAdapter});t.after(()=>tools.destroy());
  assert.equal(p.requests.length,before);assert.equal(renders,0);assert.equal(loads,0);assert.equal(tools.filterButton.textContent,'');assert.equal(date.textContent,'');
  tools.filterButton.click();assert.deepEqual([...tools.popover.querySelectorAll('.menu-section-title')].map(el=>el.textContent),['Filter results…','Sort']);tools.popover.querySelector('[data-value="from:"]').click();assert.equal(input.value,'from:');assert.equal(loads,0);assert.equal(tools.suggestions.hidden,true);assert.ok(results.querySelector('.sender-result'));
  input.value='from:al';input.dispatchEvent(new w.Event('input',{bubbles:true}));assert.match(results.textContent,/alex_morgan/);assert.doesNotMatch(results.textContent,/jules_designs/);
  input.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,composed:true,cancelable:true}));assert.equal(input.value,'from:alex_morgan ');assert.equal(loads,1);assert.equal(navigation,0);assert.equal(p.requests.length,before);
  input.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,composed:true,cancelable:true}));assert.equal(navigation,1);
  tools.filterButton.click();tools.popover.querySelector('[data-value="oldest"]').click();assert.equal(room.queryOptions.sort,'oldest');tools.destroy();assert.equal(shadow.querySelector('.query-tools-overlay'),null);assert.equal(shadow.querySelector('.query-filter'),null);
});

test('native selected-chat state follows Reddit navigation and keyboard movement styles the current result',async t=>{
  const p=await setup(t);await p.search('alex');await p.click('[data-scope="people"]');assert.equal(p.find('.chat-result[aria-current="page"]').dataset.key,'chat:alex');
  await p.key('ArrowDown');assert.equal(p.find('.keyboard-focus').dataset.key,p.control.active);p.fixture.select('alex2');p.control.sync();assert.equal(p.find('.chat-result[aria-current="page"]').dataset.key,'chat:alex2');assert.equal(p.control.shadow.querySelectorAll('.chat-result.selected').length,1);
});

test('date operator completion applies query dates through the existing calendar without changing the separate range',async t=>{
  const p=await setup(t);p.type('coffee before');await p.key('Enter');assert.equal(p.control.input.value,'coffee before:');await p.key('Enter');const picker=p.control.datePicker;assert.equal(picker.open,true);picker.choose('2026-10-09');p.find('.calendar-apply').click();assert.equal(p.control.input.value,'coffee before:2026-10-09 ');assert.equal(picker.open,false);assert.equal(p.control.dates.from,'');assert.equal(p.control.dates.to,'');assert.equal(p.control.shadow.activeElement,p.control.input);await p.tick(180);assert.equal(p.searches.at(-1).query,'coffee before:2026-10-09');
  p.type('after:2026-10-08');await p.key('Enter');assert.equal(p.control.input.value,'after:2026-10-08 ');
});
