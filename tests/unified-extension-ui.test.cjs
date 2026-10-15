const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const {setDateSegments}=require('./date-segments-helper.cjs');
const settle=async()=>{for(let i=0;i<35;i++)await Promise.resolve();};
async function setup(t,{large=false,deferSearch=false,scope='all',nativeFonts=false}={}) {
  const dom=new JSDOM('<!doctype html><body></body>',{url:'https://www.reddit.com/chat',runScripts:'outside-only'}),w=dom.window;
  if(nativeFonts)Object.defineProperty(w.document,'fonts',{value:new w.EventTarget()});
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
  load('extension/global-search-model.js');load('extension/media-preview.js');load('extension/unified-search-styles.js');load('extension/unified-search.js');const control=new w.RCSUnifiedSearch(fixture.nav,{cache,adapter:w.RCSAdapter,version:'test'});
  control.setScope(scope);
  t.after(()=>{control.destroy();dom.window.close();});await settle();
  const find=selector=>{const value=control.shadow.querySelector(selector);assert.ok(value,'Missing '+selector);return value;};
  const click=async selector=>{find(selector).click();await settle();};
  const type=query=>{control.input.value=query;control.input.dispatchEvent(new w.Event('input',{bubbles:true}));};
  const search=async query=>{control.queryState.clear();type(query);await tick(180);};
  const key=async(name,target=control.input)=>{target.dispatchEvent(new w.KeyboardEvent('keydown',{key:name,bubbles:true,cancelable:true,composed:true}));await settle();};
  return {w,control,fixture,cache,store,storage,requests,searches,pending,find,click,type,search,tick,key,emit:value=>listeners.forEach(listener=>listener(value)),setOwner:value=>{owner=value;},setOffline:()=>{loadError=true;}};
}

test('unified panel mounts into native fixture with real local storage, native idle view and no global history loading',async t=>{
  const p=await setup(t),c=p.control;
  assert.equal(c.host.getAttribute('data-rcs-ui'),'list');assert.equal(c.host.parentNode,p.fixture.nav.shadowRoot);
  assert.equal(c.input.placeholder,'Search chats and messages');
  assert.ok(c.summaries.size>0);assert.equal(c.panel.hidden,true);await p.search('alex');assert.match(p.find('.chat-result .row-snippet').textContent,/You:/);assert.ok(p.find('.chat-result .row-time').textContent);
  assert.equal(p.requests.filter(item=>item.method==='directory').length,1);
  assert.ok(p.requests.every(item=>['directory'].includes(item.method)));
  c.sync();c.sync();await settle();assert.equal(p.requests.length,1);
  assert.equal(c.shadow.querySelector('.coverage-footer,.help-panel'),null);
  for(const button of c.shadow.querySelectorAll('.icon-button')){assert.ok(button.getAttribute('aria-label'));assert.ok(button.title);}
});

test('typing debounces 180ms while captures and native sync never starve or restart the query',async t=>{
  const p=await setup(t);p.control.input.focus();await settle();const count=p.searches.length;
  p.type('coffee');await p.tick(179);p.emit({owner:p.control.owner});p.control.sync();await settle();
  assert.equal(p.searches.length,count);await p.tick(1);
  assert.equal(p.searches.at(-1).query,'coffee');assert.ok(p.control.savedTotal>0);
  assert.ok(p.control.savedHits.every(record=>/coffee/i.test(record.text)));
  assert.match(p.find('[data-scope="messages"]').textContent,/Messages\d+/);
});

test('scope counts remain independent and sender/operator/known unread filters compose',async t=>{
  const p=await setup(t);p.control.input.focus();await p.search('coffee');
  const messages=p.control.savedTotal;await p.click('[data-scope="people"]');
  assert.equal(p.control.savedTotal,messages);assert.equal(p.control.shadow.querySelectorAll('.message-result').length,0);
  await p.click('[data-scope="messages"]');assert.equal(p.control.shadow.querySelectorAll('.chat-result').length,0);
  await p.search('coffee from:me ');assert.ok(p.control.savedHits.length>0);assert.ok(p.control.savedHits.every(record=>record.authorSelf));
  await p.search('coffee from:them ');assert.ok(p.control.savedHits.length>0);assert.ok(p.control.savedHits.every(record=>!record.authorSelf));
  await p.click('[data-scope="all"]');await p.click('[data-control="filter"]');await p.click('[data-value="unread"]');
  assert.ok(p.control.savedHits.length>0);assert.ok(p.control.savedHits.every(record=>record.roomId==='alex'));
  assert.match(p.find('.active-filters').textContent,/Unread/);
});

test('native open and jump retain sidebar, recent searches are account scoped, flat message rows open without context reads',async t=>{
  const p=await setup(t);p.control.input.focus();await p.search('coffee');await p.click('[data-scope="messages"]');
  assert.equal(p.control.shadow.querySelector('.context-button'),null);
  await p.click('.message-open');assert.ok(p.requests.some(item=>item.method==='jump' && item.eventId));
  assert.equal(p.control.panel.hidden,false);assert.equal(p.control.input.value,'coffee');assert.equal(JSON.stringify(p.storage['rcs-unified-recent:@t2_me:reddit.com']),'["coffee"]');
  await p.key('Escape');assert.equal(p.control.input.value,'coffee');assert.equal(p.control.panel.hidden,true);assert.equal(p.control.scopeBar.hidden,true);assert.ok(p.control.recent.includes('coffee'));await p.search('alex');await p.click('[data-scope="people"]');
  await p.click('.chat-result');assert.ok(p.requests.some(item=>item.method==='open'));
  p.control.resetSaved();p.setOwner('@t2_other:reddit.com');p.control.render();await settle();assert.equal(p.control.recent.length,0);
  assert.equal(p.control.shadow.querySelector('.recent-row'),null);
});

test('calendar range can be selected in one popover and date filters cleared without native history requests',async t=>{
  const p=await setup(t);await p.click('[data-control="date"]');const picker=p.control.datePicker;
  setDateSegments(picker.element,'start','2026-10-01');setDateSegments(picker.element,'end','2026-10-09');
  assert.equal(picker.open,true);const bounds=picker.bounds();assert.equal(bounds.from,'2026-10-01');assert.equal(bounds.to,'2026-10-09');
  picker.element.querySelector('.calendar-apply').click();await settle();
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
  p.control.dates={from:'2026-10-08',to:'2026-10-08'};p.control.invalidate();await settle();assert.match(p.find('.empty-state').textContent,/removing a filter/);
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
  await p.key('ArrowRight',p.find('[data-scope="all"]'));assert.equal(p.control.scope,'messages');
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

test('filter menu follows People, Messages and All context with no redundant date, link or word controls',async t=>{
  const p=await setup(t),c=p.control;
  assert.equal(c.shadow.querySelector('[data-control="from"],[data-control="sort"],[data-control="wholeWord"]'),null);
  assert.equal(c.controls.parentNode,c.field);assert.equal(c.controls.children.length,2);
  assert.equal(p.find('[data-control="filter"]').textContent,'');assert.equal(p.find('[data-control="date"]').hidden,false);
  await p.search('coff');await p.click('[data-scope="people"]');await p.click('[data-control="filter"]');
  assert.deepEqual([...c.popover.querySelectorAll('.menu-section-title')].map(el=>el.textContent),['Filters','Chats','Status','Sort by']);
  assert.equal(c.popover.querySelector('[data-value="from:"],[data-value="has:"],[data-value="before:"],[data-value="after:"],[data-value="wholeWord"],[data-value="relevant"]'),null);
  assert.equal(p.find('[data-control="date"]').hidden,false);assert.equal(p.find('[data-control="date"]').disabled,true);
  await p.click('[data-value="unread"]');assert.equal(p.find('[data-control="filter"]').getAttribute('aria-pressed'),'true');
  await p.click('[data-scope="messages"]');assert.equal(c.popover.hidden,true);assert.equal(p.find('[data-control="date"]').hidden,false);
  assert.equal(p.find('[data-control="filter"]').getAttribute('aria-pressed'),'true');assert.deepEqual(JSON.parse(JSON.stringify(p.searches.at(-1).roomIds)),['alex']);
  await p.click('[data-control="filter"]');assert.deepEqual([...c.popover.querySelectorAll('.menu-section-title')].map(el=>el.textContent),['Filters','Contains','Sort by']);
  assert.equal(c.popover.querySelector('[data-value="unread"],[data-value="groups"],[data-value="requests"]'),null);assert.ok(p.find('[data-value="relevant"]'));
  await p.click('[data-value="from:"]');assert.equal(c.input.value,'coff from:');assert.ok(p.find('.sender-result .avatar'));
  await p.search('coffee');await p.click('[data-scope="all"]');await p.click('[data-control="filter"]');assert.ok(p.find('[data-value="from:"]'));assert.ok(p.find('[data-value="unread"]'));
});

test('native header stays above search while list rows stay below; header overrides restore on unmount',async t=>{
  const p=await setup(t),header=p.fixture.nav.shadowRoot.querySelector('.nav-head');
  header.style.position='static';header.append(p.w.document.createElement('rs-rooms-nav-filter'));
  p.control.sync();assert.equal(header.style.position,'relative');assert.equal(header.style.zIndex,'2');
  p.control.savedTotal=2000;p.control.updateControls();assert.equal(p.control.shadow.querySelector('.common-hint'),null);
  p.control.destroy();assert.equal(header.style.position,'static');assert.equal(header.style.zIndex,'');
  const host=p.w.document.createElement('div');header.after(host);header.style.zIndex='9';
  p.w.RCSAdapter.syncSearchLayer(p.fixture.nav,host,'rs-rooms-nav-filter');assert.equal(header.style.zIndex,'9','preserve the native higher layer');
  header.style.position='sticky';p.w.RCSAdapter.releaseSearchLayer(host);assert.equal(header.style.position,'sticky','preserve a later native update');
});

test('operator commands insert query tokens and sender values use main avatar rows without native navigation',async t=>{
  const p=await setup(t);p.control.input.focus();p.type('coffee fr');assert.equal(p.control.suggestions.hidden,true);
  p.type('coffee from');assert.equal(p.control.suggestions.hidden,false);assert.match(p.find('[role="option"]').textContent,/from:.*From a person/);assert.ok(p.find('[role="option"] svg'));const calls=p.requests.length,queries=p.searches.length;await p.tick(180);assert.equal(p.searches.length,queries,'operator command completion must not scan saved messages');
  await p.key('Enter');assert.equal(p.control.input.value,'coffee from:');assert.equal(p.control.suggestions.hidden,true);assert.ok(p.find('.sender-result .avatar'));assert.match(p.control.status.textContent,/Choose a sender/);
  p.cache.set('space',{id:'space',name:'Coffee Person',type:'direct'});p.control.senderChoicesCache=null;p.type('coffee from:Co');await p.tick(180);assert.match(p.find('.sender-result').textContent,/Coffee Person/);
  await p.key('ArrowDown');assert.ok(p.find('.sender-result.keyboard-focus'));await p.key('Enter');assert.equal(p.control.input.value,'coffee');assert.equal(p.control.queryValue(),'from:"Coffee Person" coffee');assert.equal(p.requests.length,calls);
  for(const query of ['has','has:','before','before:','after','after:']){p.type(query);assert.equal(p.control.suggestions.hidden,true);assert.equal(p.control.valuePicker(),null);}
  await p.search('alex');await p.click('[data-scope="people"]');p.type('from');assert.equal(p.control.scope,'people');assert.equal(p.control.suggestions.hidden,false);assert.equal(p.requests.filter(item=>item.method==='history').length,0);
});

test('in-flight capture updates coalesce without restarting requests and preserve committed results',async t=>{
  const p=await setup(t,{deferSearch:true});assert.equal(p.searches.length,0);p.type('coffee');await p.tick(180);assert.equal(p.searches.length,1);
  p.emit({owner:'@t2_me:reddit.com',changed:true});p.emit({owner:'@t2_me:reddit.com',changed:true});
  assert.equal(p.searches.length,1);p.pending.shift()();await settle();assert.equal(p.searches.length,1);await p.tick(750);assert.equal(p.searches.length,2);
  p.pending.shift()();await settle();assert.equal(p.searches.length,2);assert.ok(p.control.savedTotal>0);
  p.control.input.focus();p.type('tomorrow');await p.tick(180);assert.equal(p.searches.length,3);const previous=p.control.savedHits;
  p.emit({owner:'@t2_me:reddit.com',changed:true});assert.equal(p.control.savedHits,previous);assert.equal(p.searches.length,3);
  p.pending.shift()();await settle();assert.equal(p.searches.length,3);await p.tick(750);assert.equal(p.searches.length,4);p.pending.shift()();await settle();assert.ok(p.control.savedHits.every(record=>/tomorrow/i.test(record.text)));
});

test('missing conversation dates remain blank and unavailable names do not falsely claim retention',async t=>{
  const p=await setup(t);const row=p.control.time(0);assert.equal(row.textContent,'');assert.equal(row.title,'Date unavailable');assert.equal(row.hasAttribute('datetime'),false);
  const chat=p.cache.get('alex');p.cache.set('alex',{...chat,accountUnavailable:true,historicalName:false});await p.search('alex');p.control.render();await settle();assert.equal(p.find('.chat-result .row-meta').textContent,'Unavailable');
});

test('missing native event retries are bounded',async t=>{
  const p=await setup(t);p.control.input.focus();
  let scans=0;const adapter=p.control.adapter;p.control.adapter={...adapter,chatRoots:()=>{scans++;return [];}};
  await p.control.openMessage({roomId:'alex',id:'absent-native-event',timestamp:1791432000000});await p.tick(4100);const final=scans;
  await p.tick(1000);assert.equal(scans,final);assert.equal(final,41);assert.equal(p.requests.filter(item=>item.method==='jump').length,1);
});

test('individual room tools insert operators and use the current result panel for sender selection',async t=>{
  const p=await setup(t),w=p.w,host=w.document.createElement('div');host.dataset.rcsUi='messages';const shadow=host.attachShadow({mode:'open'}),bar=w.document.createElement('div'),input=w.document.createElement('input'),date=w.document.createElement('button'),results=w.document.createElement('div'),status=w.document.createElement('span');date.innerHTML='<svg></svg>Date';bar.append(input,date);shadow.append(bar,results,status);p.fixture.room.shadowRoot.append(host);
  let renders=0,loads=0,navigation=0;const room={host,bar,input,dateToggle:date,results,status,dates:{from:'',to:''},room:'alex',hits:[],active:-1,render(){renders++;room.tools?.sync();room.tools?.renderValueChoices();},ensureData(){if(!room.tools?.valuePicker() && room.tools?.suggestions.hidden!==false)loads++;}};
  input.addEventListener('input',()=>{room.render();room.ensureData();});room.datePicker=new w.RCSDatePicker({onChange:()=>{},onClose:()=>{}});shadow.append(room.datePicker.element);shadow.addEventListener('keydown',()=>{navigation++;});
  const before=p.requests.length,tools=w.RCSUnifiedSearch.decorateMessageControl(room,{cache:p.cache,adapter:w.RCSAdapter});t.after(()=>tools.destroy());
  assert.equal(p.requests.length,before);assert.equal(renders,0);assert.equal(loads,0);assert.equal(tools.fromButton.textContent,'From: Anyone');assert.equal(date.textContent,'Date');
  tools.fromButton.click();assert.equal(tools.popover.getAttribute('aria-label'),'Filter messages by sender');tools.closeMenu();input.value='from:';input.dispatchEvent(new w.Event('input',{bubbles:true}));assert.equal(loads,0);assert.equal(tools.suggestions.hidden,true);assert.ok(results.querySelector('.sender-result'));
  input.value='from:al';input.dispatchEvent(new w.Event('input',{bubbles:true}));assert.match(results.textContent,/alex_morgan/);assert.doesNotMatch(results.textContent,/jules_designs/);
  input.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,composed:true,cancelable:true}));assert.equal(input.value,'from:alex_morgan ');assert.equal(loads,1);assert.equal(navigation,0);assert.equal(p.requests.length,before);
  input.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,composed:true,cancelable:true}));assert.equal(navigation,1);
  tools.sortButton.click();tools.popover.querySelector('[data-value="oldest"]').click();assert.equal(room.queryOptions.sort,'oldest');tools.destroy();assert.equal(shadow.querySelector('.query-tools-overlay'),null);assert.equal(shadow.querySelector('.query-filter'),null);
});

test('native selected-chat state follows Reddit navigation and keyboard movement styles the current result',async t=>{
  const p=await setup(t);await p.search('alex');await p.click('[data-scope="people"]');assert.equal(p.find('.chat-result[aria-current="page"]').dataset.key,'chat:alex');
  await p.key('ArrowDown');assert.equal(p.find('.keyboard-focus').dataset.key,p.control.active);p.fixture.select('alex2');p.control.sync();assert.equal(p.find('.chat-result[aria-current="page"]').dataset.key,'chat:alex2');assert.equal(p.control.shadow.querySelectorAll('.chat-result.selected').length,1);
});

test('calendar applies dates independently of filter accent and People ignores dormant message controls',async t=>{
  const p=await setup(t),c=p.control;await p.search('alex');await p.click('[data-control="date"]');
  setDateSegments(c.datePicker.element,'start','2026-10-08');setDateSegments(c.datePicker.element,'end','2026-10-09');await p.click('.calendar-apply');
  assert.equal(c.input.value,'alex');assert.equal(c.datePicker.open,false);assert.equal(c.dates.from,'2026-10-08');assert.equal(c.dates.to,'2026-10-09');
  assert.equal(p.find('[data-control="date"]').getAttribute('aria-pressed'),'true');assert.ok(p.find('[data-control="date"]').classList.contains('active'));
  assert.equal(p.find('[data-control="filter"]').getAttribute('aria-pressed'),'false');assert.equal(p.find('[data-control="filter"]').classList.contains('active'),false);
  await p.click('[data-scope="people"]');assert.equal(c.people().length,2);assert.equal(p.find('[data-control="date"]').hidden,false);assert.equal(p.find('[data-control="date"]').disabled,true);assert.equal(c.chips.hidden,false);
  await p.click('[data-control="filter"]');await p.click('[data-value="unread"]');assert.equal(p.find('[data-control="filter"]').getAttribute('aria-pressed'),'true');
  await p.click('[data-scope="messages"]');assert.equal(p.find('[data-control="filter"]').getAttribute('aria-pressed'),'true');assert.equal(p.find('[data-control="date"]').getAttribute('aria-pressed'),'true');
  await p.search('coffee from:me ');assert.equal(p.find('[data-control="filter"]').getAttribute('aria-pressed'),'true');
  await p.search('coffee');assert.equal(p.find('[data-control="filter"]').getAttribute('aria-pressed'),'true');
  await p.click('[aria-label="Remove date filter"]');assert.equal(p.find('[data-control="date"]').getAttribute('aria-pressed'),'false');assert.equal(c.filter,'unread');
});

test('people previews omit missing or older messages and update from existing saved captures without server reads',async t=>{
  const p=await setup(t);await p.search('alex');await p.click('[data-scope="people"]');const c=p.control,calls=p.requests.length,chat=p.cache.get('alex'),at=1791432000000+86400000;
  c.summaries.clear();c.render();assert.equal(c.shadow.querySelector('.row-snippet'),null);assert.doesNotMatch(c.results.textContent,/No saved message/);
  p.cache.set('alex',{...chat,timestamp:at});c.summaries.set('alex',{roomId:'alex',text:'An older saved message',timestamp:new p.w.Date(at-60000).toISOString(),authorSelf:true});c.render();assert.equal(c.shadow.querySelector('[data-key="chat:alex"] .row-snippet'),null);assert.equal(p.find('[data-key="chat:alex"] time').getAttribute('datetime'),new p.w.Date(at).toISOString());
  await p.store.ingest({owner:'@t2_me:reddit.com',roomId:'alex',events:[{event_id:'latest-preview',type:'m.room.message',sender:'@t2_me:reddit.com',origin_server_ts:at,content:{body:'The latest\nmessage'}}]});p.emit({owner:'@t2_me:reddit.com',changed:true,roomIds:['alex']});await p.tick(750);assert.equal(p.find('[data-key="chat:alex"] .row-snippet').textContent,'You: The latest message');
  p.cache.set('alex',{...p.cache.get('alex'),accountUnavailable:true,historicalName:true});c.render();assert.equal(c.items.find(item=>item.key==='chat:alex').height,64);assert.equal(p.find('[data-key="chat:alex"] .row-meta').textContent,'Unavailable');assert.match(p.find('[data-key="chat:alex"] .row-meta').title,/Unavailable account/);
  c.summaries.set('alex',{roomId:'alex',text:'   ',timestamp:new p.w.Date(at).toISOString()});c.render();assert.equal(c.shadow.querySelector('[data-key="chat:alex"] .row-snippet'),null);assert.equal(c.items.find(item=>item.key==='chat:alex').height,64);assert.equal(p.requests.length,calls);
  await p.click('[data-scope="messages"]');p.type('from:');await p.tick(180);assert.ok(c.shadow.querySelector('.sender-result .row-title'),'sender choices reuse the People row renderer');
});

 test('extension popup explains incomplete saved history and shows cache statistics outside injected chat UI',async t=>{
  const dom=new JSDOM(fs.readFileSync(path.join(__dirname,'../extension/popup.html'),'utf8'),{runScripts:'outside-only'}),w=dom.window;t.after(()=>dom.window.close());
  const calls=[];w.chrome={runtime:{sendMessage:async request=>{calls.push(request);return {ok:true,stats:{messages:42,rooms:3,approxBytes:2048}};}}};
  w.eval(fs.readFileSync(path.join(__dirname,'../extension/popup.js'),'utf8'));await settle();
  assert.match(w.document.querySelector('.cache-info').textContent,/Saved messages only.*History may be incomplete.*scoped to your Reddit account/s);
  assert.match(w.document.querySelector('#message-stats').textContent,/42 saved messages.*3 chats/);assert.equal(calls.length,1);assert.equal(calls[0].action,'stats');
});


test('global chronological results show times under day dividers and relevance removes all dividers',async t=>{
  const p=await setup(t),c=p.control;await p.search('coffee');await p.click('[data-scope="messages"]');
  assert.ok(c.items.some(item=>item.kind==='day'));
  const verify=()=>{for(const el of c.shadow.querySelectorAll('.message-result time')){assert.equal(el.textContent,p.w.RCSCore.messageTime(el.getAttribute('datetime'),{sort:c.sort}));assert.equal(el.title,p.w.RCSCore.fullTimestamp(el.getAttribute('datetime')));}};
  verify();await p.click('[data-control="filter"]');await p.click('[data-value="oldest"]');assert.ok(c.items.some(item=>item.kind==='day'));verify();
  await p.click('[data-control="filter"]');await p.click('[data-value="relevant"]');assert.equal(c.items.some(item=>item.kind==='day'),false);assert.equal(c.shadow.querySelector('.day-heading'),null);verify();
  assert.match(p.find('.message-result time').textContent,/,/);await p.click('[data-control="filter"]');await p.click('[data-value="newest"]');assert.ok(c.shadow.querySelector('.day-heading'));verify();
});

test('virtualized chronological results retain the current sticky day beyond unloaded earlier rows',async t=>{
  const p=await setup(t,{large:true}),c=p.control;await p.search('coffee');await p.click('[data-scope="messages"]');
  c.results.scrollTop=12000;c.renderWindow();const heading=p.find('.carried-day'),record=c.items.find(item=>item.kind==='message' && item.offset>=11760).record;
  assert.equal(heading.textContent,p.w.RCSCore.dayLabel(record.timestamp));assert.ok(c.shadow.querySelectorAll('.message-result').length<15);
  const height=[...c.results.children].reduce((sum,el)=>sum+Number.parseFloat(el.style.height||'0'),0);assert.equal(height,c.totalHeight,'carried header retains virtual height and scroll position');
  await p.click('[data-control="filter"]');await p.click('[data-value="relevant"]');assert.equal(c.shadow.querySelector('.carried-day,.day-heading'),null);
});

test('People is the native default; focus and clicking search expose underlined scopes without replacing the empty native list',async t=>{
  const p=await setup(t,{scope:'people'}),c=p.control;assert.equal(c.scope,'people');assert.equal(c.panel.hidden,true);assert.equal(c.scopeBar.hidden,true);
  c.input.focus();c.input.click();await settle();assert.equal(c.scopeBar.hidden,false);assert.equal(c.panel.hidden,true);assert.equal(c.items.length,0);assert.equal(p.searches.length,0);
  assert.deepEqual([...c.scopeBar.children].map(el=>el.dataset.scope),['people','all','messages']);assert.equal(p.w.RCSAdapter.query('.threads',p.fixture.nav).hidden,false);
  await p.search('alex');assert.equal(c.scope,'people');assert.ok(p.find('.chat-result'));assert.equal(p.searches.length,1);assert.equal(p.searches[0].limit,1);
  c.clearQuery();assert.equal(c.panel.hidden,true);assert.equal(c.scope,'people');await p.click('.search-icon');assert.equal(c.scopeBar.hidden,false);
});

test('multiple selected sender chips match alternatives and remove one sender without removing the query',async t=>{
  const p=await setup(t),c=p.control;await p.search('coffee from:me ');await p.click('[data-scope="messages"]');
  assert.equal(c.senderChips.querySelectorAll('.sender-chip').length,1);assert.equal(c.senderChips.querySelector('.sender-chip-label'),null);assert.equal(c.senderChips.querySelector('.sender-chip-value').textContent,'You');assert.ok(c.senderChips.querySelector('.sender-chip-avatar,.sender-chip-icon'));assert.doesNotMatch(c.senderChips.textContent,/from:/);
  await p.click('[aria-label="Add sender"]');assert.equal(c.input.value,'coffee from:');assert.equal(c.valueChoices().some(choice=>choice.token==='from:me'),false);
  const person=c.valueChoices().find(choice=>choice.token==='from:alex_morgan');assert.ok(person);c.selectValue(person);await p.tick(180);
  assert.equal(c.senderChips.querySelectorAll('.sender-chip').length,2);assert.ok(c.senderChips.querySelector('.sender-chip-avatar'));
  assert.ok(c.savedHits.some(record=>record.authorSelf));assert.ok(c.savedHits.some(record=>!record.authorSelf));
  assert.ok(c.savedHits.every(record=>record.authorSelf || record.author==='alex_morgan'));
  await p.click('[aria-label="Remove sender me"]');await p.tick(180);assert.equal(c.senderChips.querySelectorAll('.sender-chip').length,1);assert.match(c.input.value,/coffee/);assert.doesNotMatch(c.input.value,/from:me/);assert.ok(c.savedHits.length);assert.ok(c.savedHits.every(record=>record.author==='alex_morgan'));
});

test('match windows expose long URL substrings and People title matches while live sync retains clickable nodes',async t=>{
  const p=await setup(t),c=p.control,text='https://example.invalid/'+ 'a'.repeat(280)+'TARGET'+ 'z'.repeat(200);
  await p.store.ingest({owner:'@t2_me:reddit.com',roomId:'alex',events:[{event_id:'deep-link',type:'m.room.message',sender:'@t2_alex:reddit.com',origin_server_ts:1791432000000+1e6,content:{body:text}}]});
  await p.search('target');await p.click('[data-scope="messages"]');const row=p.find('[data-key="message:alex:deep-link"]'),snippet=row.querySelector('.snippet');
  assert.equal(snippet.querySelector('mark').textContent,'TARGET');assert.ok(snippet.textContent.startsWith('…'));assert.ok(snippet.textContent.length<=c.snippetMax+2);assert.ok(snippet.classList.contains('link-snippet'));
  const open=row.querySelector('button'),before=p.searches.length;open.dispatchEvent(new p.w.Event('pointerdown',{bubbles:true}));for(let i=0;i<12;i++){c.sync();c.render();}assert.equal(p.find('[data-key="message:alex:deep-link"] button'),open);assert.equal(p.searches.length,before);open.click();await settle();assert.equal(p.requests.at(-1).eventId,'deep-link');
  p.cache.set('long-title',{id:'long-title',name:'Many words before the important Filter Person title',type:'direct'});await p.search('filter');await p.click('[data-scope="people"]');assert.equal(p.find('.chat-result .row-title mark').textContent,'Filter');
});

test('message selection scrolls and highlights exact message-id targets and ignores obsolete navigation completion',async t=>{
  const p=await setup(t),c=p.control;await p.search('coffee');await p.click('[data-scope="messages"]');let scrolled=0;
  p.w.RCSData={request:()=>{const target=p.w.RCSAdapter.messages(p.fixture.room,{includeNontext:true})[0].element;target.removeAttribute('data-id');target.setAttribute('message-id','exact-match');target.scrollIntoView=()=>{scrolled++;};return {promise:Promise.resolve({})};}};
  await c.openMessage({roomId:'alex',id:'exact-match'});const target=p.w.RCSAdapter.messages(p.fixture.room,{includeNontext:true})[0].element;assert.equal(target.hasAttribute('data-rcs-jump-highlight'),false);assert.equal(target.style.outline,'');assert.equal(scrolled,1);assert.equal(c.navigationNotice,'');
  const pending=[];p.w.RCSData={request:()=>({promise:new Promise(resolve=>pending.push(resolve)),cancel(){}})};
  const old=c.openMessage({roomId:'alex',id:'old'}),latest=c.openMessage({roomId:'alex',id:'exact-match'});pending[1]({});await latest;assert.equal(scrolled,2);pending[0]({});await old;assert.equal(scrolled,2);assert.equal(c.navigationNotice,'');
});

test('attachment menu toggles real metadata filters exclusively and context hides irrelevant options',async t=>{
  const p=await setup(t),c=p.control;
  await p.store.ingest({owner:'@t2_me:reddit.com',roomId:'alex',events:[{event_id:'photo',type:'m.room.message',sender:'@t2_alex:reddit.com',origin_server_ts:1791432000000,content:{body:'A photo',msgtype:'m.image'}}]});
  await p.click('[data-scope="messages"]');await p.click('[data-control="filter"]');await p.click('[data-value="has:image"]');await p.tick(180);assert.equal(c.savedHits.length,1);assert.equal(c.savedHits[0].id,'photo');assert.ok(p.find('[aria-label="Remove image filter"]'));
  await p.click('[data-control="filter"]');assert.equal(c.popover.querySelector('[data-value="has:file"]'),null);await p.click('[data-value="has:gif"]');await p.tick(180);assert.doesNotMatch(c.queryValue(),/has:image/);assert.match(c.queryValue(),/has:gif/);assert.equal(c.savedTotal,0);
  await p.search('alex');await p.click('[data-scope="people"]');await p.click('[data-control="filter"]');assert.equal(c.popover.querySelector('[data-value="has:image"],[data-value="from:"]'),null);assert.ok(p.find('[data-value="direct"]'));assert.ok(p.find('[data-value="unavailable"]'));
});

test('applied filters leave only editable text and pending expressions in the input, with right-side removals below it',async t=>{
  const p=await setup(t,{scope:'messages'}),c=p.control;await p.search('coffee from:me ');
  assert.equal(c.input.value.trim(),'coffee');assert.equal(c.queryState.filters[0].value,'me');assert.equal(c.chips.parentNode,c.bar);assert.equal(c.field.contains(c.chips),false);
  const chip=p.find('.sender-chip');assert.equal(chip.lastElementChild.getAttribute('aria-label'),'Remove sender me');
  p.type('meeting from:al');assert.equal(c.input.value,'meeting from:al');assert.equal(c.queryState.filters.length,1);
  c.selectValue(c.valueChoices().find(choice=>choice.token==='from:alex_morgan'));await p.tick(180);assert.equal(c.input.value,'meeting');assert.equal(c.queryState.filters.length,2);
  await p.click('[aria-label="Remove sender me"]');assert.equal(c.input.value,'meeting');assert.equal(c.queryState.filters.length,1);
});

test('clearing, replacing and removing filters preserves the explicitly selected tab',async t=>{
  const p=await setup(t,{scope:'messages'}),c=p.control;await p.search('coffee from:me ');c.clearQuery();await settle();assert.equal(c.scope,'messages');assert.equal(c.input.value,'');assert.equal(c.queryState.filters.length,1);
  p.type('tomorrow');await p.tick(180);assert.equal(c.scope,'messages');assert.ok(c.savedHits.every(record=>record.authorSelf));
  await p.click('[aria-label="Remove sender me"]');assert.equal(c.scope,'messages');
  await p.click('[data-scope="all"]');c.clearQuery();p.type('alex');await p.tick(180);assert.equal(c.scope,'all');
  await p.click('[data-scope="people"]');p.type('from');assert.equal(c.scope,'people');await p.key('Enter');assert.equal(c.scope,'people');assert.equal(c.input.value,'from:');
});

test('People and message counts are independent of the selected tab and applied message filters',async t=>{
  const p=await setup(t,{scope:'people'}),c=p.control;p.cache.set('alex',{...p.cache.get('alex'),name:'Coffee Person'});
  await p.search('coffee');assert.equal(c.people().length,1);const total=c.savedTotal;assert.ok(total>0);assert.equal(p.searches.at(-1).limit,1);
  const labels=()=>[p.find('[data-scope="people"]').textContent,p.find('[data-scope="messages"]').textContent];const before=labels();
  await p.click('[data-scope="all"]');assert.deepEqual(labels(),before);await p.click('[data-scope="messages"]');assert.deepEqual(labels(),before);
  c.queryState.apply('from','me');c.invalidate();await settle();const filtered=c.savedTotal;assert.ok(filtered>0 && filtered<total);assert.equal(c.people().length,1);
  const withSender=labels();await p.click('[data-scope="people"]');assert.deepEqual(labels(),withSender);await p.click('[data-scope="all"]');assert.deepEqual(labels(),withSender);
});

test('People and All share matching for names, aliases, exact phrases and literal regex characters',async t=>{
  const p=await setup(t,{scope:'people'}),c=p.control;p.cache.set('literal',{id:'literal',name:'Alex.* Example',aliases:['Unusual Alias'],type:'direct'});
  for(const query of ['alex','alias','"Unusual Alias"','.*']){await p.search(query);const people=c.people().map(record=>record.id);await p.click('[data-scope="all"]');assert.deepEqual(c.people().map(record=>record.id),people);await p.click('[data-scope="people"]');}
  await p.search('.*');assert.deepEqual(JSON.parse(JSON.stringify(c.people().map(record=>record.id))),['literal']);
});

test('arrow keys move selection from clicked result buttons without native container scrolling or another jump',async t=>{
  const p=await setup(t,{scope:'messages'}),c=p.control;await p.search('coffee');const items=c.items.filter(item=>item.kind==='message');assert.ok(items.length>1);
  const first=p.find('.message-open');first.click();await settle();const jumps=p.requests.filter(item=>item.method==='jump').length;assert.equal(c.active,items[0].key);
  await p.key('ArrowDown',first);assert.equal(c.active,items[1].key);assert.equal(p.requests.filter(item=>item.method==='jump').length,jumps);assert.equal(c.shadow.activeElement.closest('[data-key]').dataset.key,items[1].key);
  await p.key('ArrowUp',c.shadow.activeElement);assert.equal(c.active,items[0].key);await p.key('Enter',c.shadow.activeElement);assert.equal(p.requests.filter(item=>item.method==='jump').length,jumps+1);
});

test('sender suggestions dismiss outside the field and reopen on focus without dropping draft or selected filters',async t=>{
  const p=await setup(t,{scope:'messages'}),c=p.control;await p.search('coffee from:me ');p.type('coffee from:al');await p.tick(180);assert.ok(c.shadow.querySelector('.global-sender-result'));
  p.fixture.room.dispatchEvent(new p.w.Event('pointerdown',{bubbles:true,composed:true}));assert.equal(c.panel.hidden,true);assert.equal(c.input.value,'coffee from:al');assert.equal(c.queryState.filters.length,1);
  c.sync();assert.equal(c.panel.hidden,true);c.input.click();await settle();assert.equal(c.panel.hidden,false);assert.ok(c.shadow.querySelector('.global-sender-result'));
});

test('global media options use observed cache metadata and do not expand individual room options',async t=>{
  const p=await setup(t,{scope:'messages'}),c=p.control;const events=[['video','m.video','video/mp4'],['audio','m.audio','audio/ogg'],['file','m.file','application/pdf'],['gif','m.image','image/gif']].map(([id,msgtype,mimetype])=>({event_id:'review-'+id,type:'m.room.message',sender:'@t2_alex:reddit.com',origin_server_ts:1791432000000,content:{body:'review '+id,msgtype,info:{mimetype}}}));
  await p.store.ingest({owner:'@t2_me:reddit.com',roomId:'alex',events});await p.search('review');await p.click('[data-control="filter"]');
  for(const type of ['video','audio','file','gif','image','link'])assert.ok(c.popover.querySelector('[data-value="has:'+type+'"]'));
  await p.click('[data-value="has:video"]');await settle();assert.equal(c.input.value.trim(),'review');assert.equal(c.savedTotal,1);assert.equal(c.savedHits[0].attachmentType,'video');assert.ok(p.find('[aria-label="Remove video filter"]'));
  await p.click('[aria-label="Remove video filter"]');await settle();assert.equal(c.savedTotal,4);
});

test('a pending People count read upgrades to full records when switching tabs and capture bursts remain bounded',async t=>{
  const p=await setup(t,{scope:'people',deferSearch:true}),c=p.control;p.type('coffee');await p.tick(180);assert.equal(p.searches[0].limit,1);await p.click('[data-scope="messages"]');assert.equal(p.searches.length,1);
  p.pending.shift()();await settle();assert.equal(p.searches.length,2);assert.equal(p.searches[1].limit,500);p.pending.shift()();await settle();assert.ok(c.savedHits.length);
  const node=p.find('.message-open');for(let i=0;i<100;i++)p.emit({owner:c.owner,changed:true});await p.tick(749);assert.equal(p.searches.length,2);assert.equal(p.find('.message-open'),node);
  await p.tick(1);assert.equal(p.searches.length,3);p.pending.shift()();await settle();assert.equal(p.find('.message-open'),node);
});


test('People keyboard selection during debounce opens immediately without waiting for message counts',async t=>{
  const p=await setup(t,{scope:'people',deferSearch:true}),c=p.control;p.type('alex');await p.key('ArrowDown');
  assert.equal(c.active,'chat:alex');assert.equal(c.pendingNavigation || '', '');assert.equal(p.pending.length,1);
  await p.key('Enter');assert.equal(p.requests.at(-1).method,'open');assert.equal(p.requests.at(-1).roomId,'alex');
  p.type('jules');await p.key('Enter');assert.equal(p.requests.at(-1).roomId,'jules');assert.equal(c.pendingNavigation || '', '');
  p.pending.shift()();await settle();p.pending.shift()?.();await settle();
});

test('empty-state Clear filters removes all applied state while preserving draft and scope',async t=>{
  const p=await setup(t,{scope:'messages'}),c=p.control;await p.search('nonexistent has:gif from:me ');
  c.filter='unread';c.dates.from='2026-10-08';c.invalidate();await settle();
  const clear=[...c.results.querySelectorAll('button')].find(button=>button.textContent==='Clear filters');assert.ok(clear);clear.click();await settle();
  assert.equal(c.queryState.filters.length,0);assert.equal(c.filter,'all');assert.equal(c.from,'all');assert.equal(c.dates.from,'');assert.equal(c.scope,'messages');assert.equal(c.input.value.trim(),'nonexistent');assert.equal(c.chips.hidden,true);
});


test('DM and group message headers identify conversations while snippets and accessible names identify the sender',async t=>{
  const p=await setup(t,{scope:'messages'}),c=p.control;
  const own={id:'own',roomId:'alex',text:'A saved response',author:'fixture_user',authorSelf:true,avatar:'https://example.invalid/own.png',timestamp:1791432000000};
  const incoming={...own,id:'other',author:'alex_morgan',authorSelf:false};
  const dm=p.cache.get('alex'),group={id:'group-stable',type:'group',name:'Project discussion',avatar:'https://example.invalid/group.png'};
  for(const [record,chat,prefix,aria]of [[own,dm,'You: ','You sent:'],[incoming,dm,'','alex_morgan sent:'],[own,group,'You: ','You sent:'],[incoming,group,'alex_morgan: ','alex_morgan sent:']]){
    const row=c.messageRow(record,chat);assert.equal(row.querySelector('.message-name').textContent,chat.name);assert.equal(row.querySelector('.message-name').title,chat.name);
    assert.equal(row.querySelector('.you-prefix,.sender-prefix')?.textContent || '',prefix);assert.ok(row.querySelector('.message-open').getAttribute('aria-label').startsWith(aria));
    assert.equal(row.querySelector('img').src,chat.avatar);
  }
  const withoutGroupAvatar=c.messageRow(own,{...group,avatar:''});assert.equal(withoutGroupAvatar.querySelector('img'),null,'an own avatar never becomes the conversation avatar');assert.equal(withoutGroupAvatar.querySelector('.initials').textContent,'PD');
});

test('renamed and identically named conversations retain distinct room/event keys and exact navigation',async t=>{
  const p=await setup(t,{scope:'messages'}),c=p.control;await p.search('coffee');const target=c.savedHits.find(record=>record.roomId==='alex');assert.ok(target);
  p.cache.set('alex',{...p.cache.get('alex'),name:'A renamed conversation'});p.cache.set('maya',{...p.cache.get('maya'),name:'A renamed conversation'});c.makeItems();c.renderWindow();
  const rows=[...c.shadow.querySelectorAll('.message-result')].filter(row=>row.querySelector('.message-name').textContent==='A renamed conversation');assert.ok(rows.length>=2);assert.equal(new Set(rows.map(row=>row.dataset.key)).size,rows.length);
  const row=p.find('[data-key="message:alex:'+target.id+'"]');row.querySelector('button').click();await settle();assert.equal(p.requests.at(-1).roomId,'alex');assert.equal(p.requests.at(-1).eventId,target.id);
});

test('image matches and People summaries show stable lazy thumbnails instead of filenames, with safe fallback and compact text rows',async t=>{
  const p=await setup(t,{scope:'messages'}),c=p.control;
  await p.store.ingest({owner:'@t2_me:reddit.com',roomId:'alex',events:[{event_id:'photo-preview',type:'m.room.message',sender:'@t2_me:reddit.com',origin_server_ts:1791433000000,content:{body:'my-upload.jpeg',msgtype:'m.image',url:'https://example.invalid/thumb.jpg'}}]});await p.search('has:image');
  const row=p.find('[data-key="message:alex:photo-preview"]'),img=row.querySelector('.media-image');assert.ok(img);assert.equal(img.getAttribute('loading'),'lazy');assert.equal(img.src,'https://example.invalid/thumb.jpg');assert.doesNotMatch(row.textContent,/my-upload|jpeg/);assert.match(row.textContent,/You:/);assert.doesNotMatch(row.textContent,/Image|GIF/);assert.equal(img.width,96);assert.equal(img.height,64);assert.match(row.querySelector('button').getAttribute('aria-label'),/You sent: Image/);
  const media=row.querySelector('.media-snippet');assert.equal(media.firstElementChild.textContent.trim(),'You:');assert.ok(media.lastElementChild.matches('.media-thumb'));
  assert.ok(c.messageRowHeight(p.cache.get('alex'),{attachmentType:'image',authorSelf:true})>c.messageRowHeight(p.cache.get('alex'),{attachmentType:'image'}),'reserve the sender line above the image');
  for(let i=0;i<10;i++){c.sync();c.render();}assert.equal(p.find('.media-image'),img,'native updates reuse the image node/source');
  img.dispatchEvent(new p.w.Event('error'));assert.equal(img.hidden,true);assert.equal(row.querySelector('.media-placeholder').hidden,false);c.render();assert.equal(p.find('.media-image'),img,'failed previews are not repeatedly requested');
  await c.loadSummaries();await p.search('alex');await p.click('[data-scope="people"]');const compact=p.find('[data-key="chat:alex"] .row-image-preview');assert.ok(compact.querySelector('.media-image'));assert.doesNotMatch(compact.textContent,/jpeg/);
  assert.ok(c.messageRowHeight(p.cache.get('alex'),{text:'Hello'})<c.messageRowHeight(p.cache.get('alex'),{text:'A longer message that takes two lines in the search preview.'}));
  c.resetSaved();assert.equal(c.mediaView.images.size,0);
});

test('loaded image proportions remeasure virtual results without rerunning search or moving its anchor',async t=>{
  const p=await setup(t,{scope:'messages'}),c=p.control;
  await p.store.ingest({owner:'@t2_me:reddit.com',roomId:'alex',events:[{event_id:'learn-aspect',type:'m.room.message',sender:'@t2_me:reddit.com',origin_server_ts:1791433000000,content:{body:'aspect.jpeg',msgtype:'m.image',url:'https://example.invalid/aspect'}}]});await p.search('has:image');
  const row=p.find('[data-key="message:alex:learn-aspect"]'),img=row.querySelector('img.media-image');
  row.getBoundingClientRect=()=>({height:48+img.height+22});c.results.scrollTop=9;
  const searches=p.searches.length,requests=p.requests.length;
  Object.defineProperties(img,{naturalWidth:{value:500},naturalHeight:{value:1000}});img.dispatchEvent(new p.w.Event('load'));await p.tick(0);
  assert.equal(img.width,64);assert.equal(img.height,128);assert.equal(c.items.find(item=>item.key==='message:alex:learn-aspect').height,198);
  assert.equal(c.results.scrollTop,9);assert.equal(p.searches.length,searches);assert.equal(p.requests.length,requests);
  c.render();assert.equal(p.find('.media-image'),img);assert.equal(img.height,128);
});


test('returning from an opened conversation keeps only one navigation rail',async t=>{
  const p=await setup(t,{scope:'people'}),c=p.control;await p.search('alex');
  await p.click('[data-key="chat:alex"]');
  p.fixture.room.dispatchEvent(new p.w.MouseEvent('pointerdown',{bubbles:true,composed:true}));
  assert.equal(c.active,'');assert.equal(p.find('.selection-rail').dataset.key,'chat:alex');
  c.input.focus();await p.key('ArrowDown');await p.key('ArrowDown');
  assert.equal(c.shadow.querySelectorAll('.selection-rail').length,1);
  assert.equal(p.find('.selection-rail').dataset.key,'chat:alex2');
  assert.equal(p.find('[aria-current="page"]').dataset.key,'chat:alex','opened chat remains accessible without a second visual rail');
  const cached=p.find('[data-key="chat:alex"]');c.render();
  assert.equal(p.find('[data-key="chat:alex"]'),cached);assert.equal(c.shadow.querySelectorAll('.selection-rail').length,1);
  p.fixture.room.dispatchEvent(new p.w.FocusEvent('focusin',{bubbles:true,composed:true}));
  assert.equal(p.find('.selection-rail').dataset.key,'chat:alex');assert.equal(c.shadow.querySelectorAll('.selection-rail').length,1);
});

test('People previews and status share compact rows without the common-word hint',async t=>{
  const p=await setup(t,{scope:'people'}),c=p.control;await p.search('alex');
  for(const kind of [{accountUnavailable:true,historicalName:true},{type:'group'},{membership:'invite'}]){
    p.cache.set('alex',{...p.cache.get('alex'),...kind});c.render();
    assert.equal(c.items.find(item=>item.key==='chat:alex').height,64);
    const secondary=p.find('[data-key="chat:alex"] .row-secondary');
    assert.ok(secondary.querySelector('.row-snippet'));assert.ok(secondary.querySelector('.row-meta'));
  }
  await p.click('[data-scope="messages"]');await p.search('this');
  c.savedTotal=1784;c.savedRooms=725;c.hasMore=true;c.updateControls();
  assert.equal(c.status.textContent,'1,784 matches · 725 chats');
  assert.doesNotMatch(c.status.textContent,/loaded/);assert.match(c.status.title,/loaded/);
  assert.equal(c.shadow.querySelector('.common-hint'),null);
});


test('scope labels and reserved count slots stay mounted across count changes',async t=>{
  const p=await setup(t,{scope:'messages'}),c=p.control;await p.search('coffee');
  const label=p.find('[data-scope="messages"] .scope-label'),count=p.find('[data-scope="messages"] .scope-count');
  for(const total of [1,37,999,1784]){c.savedTotal=total;c.updateControls();
    assert.equal(p.find('[data-scope="messages"] .scope-label'),label);
    assert.equal(p.find('[data-scope="messages"] .scope-count'),count);
    assert.equal(label.textContent,'Messages');assert.equal(count.textContent,total>999?'999+':String(total));
    assert.match(c.scopeButtons.messages.getAttribute('aria-label'),new RegExp(total.toLocaleString()));
  }
  c.clearQuery();assert.equal(p.find('[data-scope="messages"] .scope-count'),count);
});


test('Enter promotes keyboard preview to the opened chat or message indicator',async t=>{
  const p=await setup(t,{scope:'people'}),c=p.control;await p.search('alex');
  await p.key('ArrowDown');await p.key('ArrowDown');
  assert.ok(p.find('.selection-rail').classList.contains('keyboard-preview'));
  await p.key('Enter');assert.equal(p.requests.at(-1).roomId,'alex2');
  const opened=p.find('.selection-rail');assert.equal(opened.dataset.key,'chat:alex2');
  assert.ok(opened.classList.contains('selected'));assert.equal(opened.classList.contains('keyboard-preview'),false);
  await p.key('ArrowUp');assert.ok(p.find('.selection-rail').classList.contains('keyboard-preview'));
  assert.equal(c.shadow.querySelectorAll('.selection-rail').length,1);
  await p.click('[data-scope="all"]');await p.search('coffee');
  const item=c.items.find(item=>item.kind==='message');assert.ok(item);
  c.active=item.key;c.navigating=true;c.renderWindow();await p.key('Enter');
  const message=p.find('.message-result.selection-rail');assert.equal(message.dataset.key,item.key);
  assert.ok(message.classList.contains('selected'));assert.equal(message.classList.contains('keyboard-preview'),false);
  assert.equal(c.shadow.querySelectorAll('.selection-rail').length,1);
});


test('ArrowUp brings the previous whole card below the sticky day header',async t=>{
  const p=await setup(t,{scope:'messages'}),c=p.control;await p.search('coffee');
  Object.defineProperty(c.results,'clientHeight',{value:180,configurable:true});
  const hits=c.items.filter(item=>item.kind==='message');assert.ok(hits.length>1);
  c.active=hits[1].key;c.results.scrollTop=hits[0].offset+12;await p.key('ArrowUp');
  assert.equal(c.active,hits[0].key);
  const header=c.items.slice(0,c.items.indexOf(hits[0])).reverse().find(item=>item.kind==='day');
  assert.ok(hits[0].offset>=c.results.scrollTop+header.height);
  assert.ok(hits[0].offset+hits[0].height<=c.results.scrollTop+c.results.clientHeight);
  await p.click('[data-scope="people"]');await p.search('alex');
  const people=c.items.filter(item=>item.kind==='chat');c.active=people[1].key;c.results.scrollTop=people[0].offset+10;await p.key('ArrowUp');
  assert.equal(c.results.scrollTop,people[0].offset);
});


test('rendered message heights replace estimates without losing the scroll anchor or cached rows',async t=>{
  const p=await setup(t,{scope:'messages'}),c=p.control;await p.search('coffee');
  const before=c.items.filter(item=>item.kind==='message');assert.ok(before.length>1);
  const target=before[1],row=p.find('[data-key="'+target.key+'"]');
  const nodes=c.items.filter(item=>item.kind==='message');for(const item of nodes){const node=p.find('[data-key="'+item.key+'"]');node.getBoundingClientRect=()=>({height:item.key===target.key?94:64});}
  const oldTop=target.offset+8;c.results.scrollTop=oldTop;c.renderedWindow='';c.renderWindow();
  const updated=c.items.find(item=>item.key===target.key);
  assert.equal(updated.height,94);assert.equal(c.items.find(item=>item.key===nodes[0].key).height,64);
  assert.equal(c.results.scrollTop,updated.offset+8,'height changes above the viewport preserve its content anchor');
  assert.equal(p.find('[data-key="'+target.key+'"]'),row,'measurement reuses mounted rows');
  const total=c.items.reduce((sum,item)=>sum+item.height,0);assert.equal(c.totalHeight,total);
  c.makeItems();assert.equal(c.items.find(item=>item.key===target.key).height,94,'unchanged results reuse measured heights');
  row.getBoundingClientRect=()=>{throw Error('cached row should not be measured again');};c.active=target.key;c.navigating=true;c.results.scrollTop=0;c.renderedWindow='';c.renderWindow();assert.equal(c.results.scrollTop,0,'manual scroll is not pulled back to the keyboard cursor');
  c.container.getBoundingClientRect=()=>({width:240,bottom:700});c.updateLayout();assert.equal(c.messageHeights.size,0,'width changes invalidate wrapping measurements');
});


test('Escape closes search chrome from the field or opened results and reopening retains the query',async t=>{
  const p=await setup(t,{scope:'messages'}),c=p.control;await p.search('coffee from:me ');c.input.focus();
  await p.click('.message-open');const row=p.find('.message-open');row.focus();await p.key('Escape',row);
  assert.equal(c.panel.hidden,true);assert.equal(c.scopeBar.hidden,true);assert.equal(c.chips.hidden,true);
  assert.equal(c.input.value.trim(),'coffee');assert.equal(c.queryState.filters.length,1);
  c.sync();p.emit({owner:c.owner});await p.tick(750);assert.equal(c.panel.hidden,true);assert.equal(c.scopeBar.hidden,true);
  c.input.focus();await settle();assert.equal(c.panel.hidden,false);assert.equal(c.scopeBar.hidden,false);assert.equal(c.chips.hidden,false);
  await p.click('[data-control="filter"]');await p.key('Escape');assert.equal(c.popover.hidden,true);assert.equal(c.panel.hidden,true);assert.equal(c.scopeBar.hidden,true);
  c.input.focus();await settle();c.datePicker.show();await p.key('Escape');assert.equal(c.datePicker.open,false);assert.equal(c.scopeBar.hidden,true);
});


test('native responsive metrics update both result kinds and invalidate only changed measurements',async t=>{
  const p=await setup(t,{scope:'people'}),c=p.control;await p.search('alex');
  let metrics={'--rcs-row-title-font':'400 14px/20px TestSans','--rcs-row-preview-font':'400 14px/20px TestSans','--rcs-row-time-font':'400 11px/16px TestSans','--rcs-row-min-height':'60px','--rcs-row-avatar-size':'32px'};
  c.adapter={...c.adapter,chatListMetrics:()=>metrics};c.updateLayout(true);c.render();
  assert.equal(c.host.style.getPropertyValue('--rcs-row-title-font'),metrics['--rcs-row-title-font']);assert.equal(c.items.find(item=>item.kind==='chat').height,60);
  c.messageHeights.set('retained',80);c.updateLayout(true);assert.equal(c.messageHeights.size,1,'identical native styles retain measurement cache');
  metrics={...metrics,'--rcs-row-title-font':'400 18px/24px TestSans','--rcs-row-preview-font':'400 18px/24px TestSans','--rcs-row-min-height':'72px'};c.updateLayout(true);c.render();
  assert.equal(c.messageHeights.size,0);assert.equal(c.items.find(item=>item.kind==='chat').height,72);
  await p.click('[data-scope="messages"]');await p.search('coffee');assert.equal(c.host.style.getPropertyValue('--rcs-row-preview-font'),metrics['--rcs-row-preview-font']);
  assert.ok(p.find('.message-name.row-title'));assert.ok(p.find('.message-heading.row-top'));assert.ok(p.requests.every(item=>item.method==='directory'),'appearance syncing makes no server calls');
});


test('late fonts and root theme changes refresh native row metrics without starting searches',async t=>{
  const p=await setup(t,{scope:'people',nativeFonts:true}),c=p.control;await p.search('alex');const requests=p.requests.length,searches=p.searches.length;
  c.messageHeights.set('old-font',88);p.w.document.fonts.dispatchEvent(new p.w.Event('loadingdone'));await settle();assert.equal(c.messageHeights.size,0);
  c.messageHeights.set('old-theme',88);p.w.document.body.classList.add('synthetic-theme');await settle();assert.equal(c.messageHeights.size,0);
  assert.equal(p.requests.length,requests);assert.equal(p.searches.length,searches);assert.equal(c.input.value,'alex');
});


test('suspended mobile search retains filters, paged results and return viewport through catch-up',async t=>{
  const p=await setup(t,{scope:'messages',large:true}),c=p.control;await p.search('coffee from:me ');await c.searchSaved(true);await settle();assert.ok(c.savedHits.length>500);
  const wanted=c.savedHits.length,anchor=c.items.filter(item=>item.kind==='message')[550];assert.ok(anchor);
  c.results.scrollTop=anchor.offset+5;c.lastScrollTop=c.results.scrollTop;c.returnViewport=c.captureViewport();
  const scope=c.scope,query=c.input.value,filters=JSON.stringify(c.queryState.filters),calendar=c.datePicker.applied;
  c.suspend();p.emit({owner:c.owner});await p.tick(750);const searches=p.searches.length;assert.equal(c.suspended,true);
  c.resume(p.fixture.nav);await settle();
  assert.equal(c.scope,scope);assert.equal(c.input.value,query);assert.equal(JSON.stringify(c.queryState.filters),filters);assert.equal(c.datePicker.applied,calendar);
  assert.equal(c.savedHits.length,wanted,'refresh retains all previously loaded result pages');
  const restored=c.items.find(item=>item.key===anchor.key);assert.equal(c.results.scrollTop,restored.offset+5);
  assert.ok(p.searches.length<=searches+2,'two local pages refresh once, without an extra directory build');assert.equal(p.requests.filter(item=>item.method==='directory').length,1);
});

test('search waits for native header readiness before revealing and restoring a mobile viewport',async t=>{
  const p=await setup(t,{scope:'messages'}),c=p.control;await p.search('coffee');
  const mount=c.adapter.mountPoint;let ready=false;
  c.adapter={...c.adapter,mountPoint:(...args)=>({...mount(...args),ready})};
  c.results.scrollTop=19;c.returnViewport=c.captureViewport();c.suspend();c.resume(p.fixture.nav);
  assert.equal(c.host.hidden,true);assert.ok(c.pendingResumeViewport);
  assert.match(c.shadow.querySelector('style').textContent,/:host\(\[hidden\]\)\s*\{\s*display:none\s*!important/);
  const parent=c.host.parentNode,previous=c.host.previousElementSibling;
  ready=true;c.sync();assert.equal(c.host.hidden,false);assert.equal(c.pendingResumeViewport,null);
  assert.equal(c.host.parentNode,parent);assert.equal(c.host.previousElementSibling,previous);assert.equal(c.results.scrollTop,19);
});

test('refresh shows local query activity and import progress without extra directory or message reads',async t=>{
  const p=await setup(t,{deferSearch:true}),c=p.control;await p.click('[data-scope="messages"]');
  assert.equal(c.refresh.getAttribute('aria-busy'),'true');assert.equal(c.refresh.disabled,true);assert.match(c.refresh.title,/Searching saved/);
  p.pending.shift()();await settle();const searches=p.searches.length,requests=p.requests.length;
  p.emit({owner:c.owner,statusOnly:true,importing:true});
  assert.equal(c.refresh.classList.contains('busy'),true);assert.match(c.status.textContent,/Importing cached messages/);assert.match(c.refresh.title,/Importing/);
  await p.tick(1000);assert.equal(p.searches.length,searches);assert.equal(p.requests.length,requests,'progress does not build another directory');
  p.emit({owner:c.owner,statusOnly:true,importing:false});assert.equal(c.refresh.getAttribute('aria-busy'),'false');assert.doesNotMatch(c.status.textContent,/Importing/);
  c.refresh.click();await settle();assert.equal(p.searches.length,searches+1);assert.equal(c.refresh.getAttribute('aria-busy'),'true');
  p.pending.shift()();await settle();assert.equal(c.refresh.getAttribute('aria-busy'),'false');assert.equal(p.requests.length,requests);
});

test('invalidated context preserves visible matches and asks for a page refresh instead of showing perpetual search',async t=>{
  const p=await setup(t),c=p.control;await p.search('coffee');await p.click('[data-scope="messages"]');const count=c.savedHits.length,searches=p.searches.length;
  p.emit({contextInvalidated:true,error:'Extension updated. Refresh this Reddit tab to reconnect.'});
  assert.equal(c.savedHits.length,count);assert.match(c.status.textContent,/Refresh this Reddit tab/);assert.doesNotMatch(c.status.textContent,/Searching/);assert.equal(c.refresh.disabled,true);assert.equal(c.refresh.getAttribute('aria-busy'),'false');
  p.emit({owner:c.owner,changed:true});await p.tick(2000);c.render();await settle();assert.equal(p.searches.length,searches);assert.equal(c.savedHits.length,count);
});

test('image growth commits track height before restoring a bottom viewport and retains unrelated measurements',async t=>{
  const p=await setup(t,{scope:'messages'}),c=p.control,original=c.messageRow.bind(c);
  c.messageRow=(...args)=>{const row=original(...args);row.getBoundingClientRect=()=>({height:70+(row.querySelector('.media-image')?.height || 0)});return row;};
  await p.store.ingest({owner:'@t2_me:reddit.com',roomId:'alex',events:Array.from({length:16},(_,i)=>({event_id:'anchor-photo-'+i,type:'m.room.message',sender:'@t2_me:reddit.com',origin_server_ts:1791433000000+i*1000,content:{body:'anchor.jpeg',msgtype:'m.image',url:'https://example.invalid/anchor/'+i}}))});
  Object.defineProperty(c.results,'clientHeight',{value:180});await p.search('has:image');
  c.results.scrollTop=c.totalHeight-180;c.renderedWindow='';c.renderWindow();
  // Model browser scroll clamping against the committed DOM track, which JSDOM
  // does not perform. A target beyond the old track must not be assigned early.
  let scroll=c.results.scrollTop;
  const maximum=()=>Math.max(0,[...c.results.children].reduce((sum,node)=>sum+(parseFloat(node.style.height)||0),0)-180);
  Object.defineProperty(c.results,'scrollTop',{configurable:true,get:()=>scroll,set:value=>{scroll=Math.max(0,Math.min(value,maximum()));}});
  for(const node of c.results.children){const remove=node.remove.bind(node);node.remove=()=>{remove();scroll=Math.min(scroll,maximum());};}
  const top=scroll,anchor=c.items.find(item=>item.offset+item.height>top),within=top-anchor.offset;
  const above=c.items.filter(item=>item.kind==='message' && item.offset+item.height<=top && c.results.querySelector('[data-key="'+item.key+'"]')).at(-1);assert.ok(above);
  const unrelated=c.items.find(item=>item.kind==='message' && item.key!==above.key);const savedHeight=c.messageHeights.get(unrelated.renderKey);assert.ok(savedHeight);
  const searches=p.searches.length,requests=p.requests.length,topSpacer=c.topSpacer,bottomSpacer=c.bottomSpacer;
  const decode=async item=>{const image=p.find('[data-key="'+item.key+'"] .media-image');Object.defineProperties(image,{naturalWidth:{value:500,configurable:true},naturalHeight:{value:1000,configurable:true}});image.dispatchEvent(new p.w.Event('load'));await p.tick(0);};
  await decode(above);
  let current=c.items.find(item=>item.key===anchor.key);assert.equal(current.offset-scroll,-within,'the visible row stays at the same screen position near the end');assert.equal(scroll,top+64,'the offset is applied after the taller track exists');
  assert.equal(c.messageHeights.get(unrelated.renderKey),savedHeight,'one image does not invalidate every image height');assert.equal(c.topSpacer,topSpacer);assert.equal(c.bottomSpacer,bottomSpacer);
  const beforeCurrent=scroll;await decode(current);assert.equal(scroll,beforeCurrent,'the visible image grows downwards without moving its header');
  current=c.items.find(item=>item.key===anchor.key);c.results.scrollTop=current.offset;c.renderedWindow='';c.renderWindow();const beforeBelow=scroll;
  const below=c.items.find(item=>item.kind==='message' && item.offset>=scroll+180);assert.ok(below);await decode(below);assert.equal(scroll,beforeBelow,'an image below the viewport does not pull the viewport down');
  assert.equal(p.searches.length,searches);assert.equal(p.requests.length,requests);
});

test('typing does not scan people or rebuild results until debounce, even during native capture and resize work',async t=>{
  const p=await setup(t,{large:true}),c=p.control;await p.search('coffee');const row=p.find('.message-open'),searches=p.searches.length,people=c.people.bind(c);let scans=0;
  c.people=(...args)=>{scans++;return people(...args);};
  for(const query of ['c','co','cof','coff','coffe']){p.type(query);assert.equal(c.input.value,query);p.emit({owner:c.owner,statusOnly:true,importing:true});p.emit({owner:c.owner,changed:true});c.updateLayout(true);c.render();await p.tick(30);}
  assert.equal(scans,0);assert.equal(p.searches.length,searches);assert.ok([...c.rowCache.values()].some(entry=>entry.node.contains(row)));assert.ok(c.results.querySelector('.skeleton-list'));assert.equal(c.results.querySelector('.message-open'),null);assert.equal(c.results.getAttribute('aria-busy'),'true');
  await p.tick(179-30);assert.equal(scans,0);await p.tick(1);assert.ok(scans>0);assert.equal(p.searches.length,searches+1);assert.equal(p.searches.at(-1).query,'coffe');assert.equal(c.queryPending,false);
});

test('a saved query completing while the user types leaves the input and result DOM alone until debounce',async t=>{
  const p=await setup(t,{deferSearch:true}),c=p.control;await p.search('coffee');const people=c.people.bind(c);let scans=0;c.people=(...args)=>{scans++;return people(...args);};
  p.type('unmatched-word');const children=[...c.results.children];p.pending.shift()();await settle();assert.equal(scans,0);assert.equal(c.input.value,'unmatched-word');assert.deepEqual([...c.results.children],children);
  await p.tick(180);assert.equal(p.searches.at(-1).query,'unmatched-word');p.pending.shift()();await settle();assert.equal(c.savedTotal,0);assert.match(p.find('.empty-state').textContent,/No messages match/);
});

for(const scope of ['people','all','messages'])test(scope+' shows a reusable loading placeholder immediately, before debounced filtering',async t=>{
  const p=await setup(t,{scope}),c=p.control;await p.search('alex');const searches=p.searches.length,people=c.people.bind(c);let scans=0;c.people=(...args)=>{scans++;return people(...args);};
  p.type('co');const placeholder=p.find('.skeleton-list');assert.equal(c.panel.hidden,false);assert.equal(c.results.getAttribute('aria-busy'),'true');assert.equal(scans,0);assert.equal(p.searches.length,searches);
  p.type('cof');p.emit({owner:c.owner,statusOnly:true,importing:true});c.render();assert.equal(p.find('.skeleton-list'),placeholder);assert.equal(scans,0);await p.tick(179);assert.equal(p.find('.skeleton-list'),placeholder);assert.equal(p.searches.length,searches);
  await p.tick(1);assert.equal(c.results.querySelector('.skeleton-list'),null);assert.equal(c.results.getAttribute('aria-busy'),'false');assert.ok(scans>0);
  p.type('alex');assert.equal(p.find('.skeleton-list'),placeholder);await p.key('Escape');assert.equal(c.panel.hidden,true);await p.tick(200);assert.equal(c.panel.hidden,true);c.clearQuery();await settle();assert.equal(c.results.querySelector('.skeleton-list'),null);
});

test('loading placeholders reuse Reddit shimmer when available, with a reduced-motion fallback',async t=>{
  const p=await setup(t),c=p.control;p.w.customElements.define('faceplate-shimmer',class extends p.w.HTMLElement{});p.type('coffee');assert.equal(p.find('.skeleton-list').querySelectorAll('faceplate-shimmer').length,21);assert.equal(c.results.querySelector('.skeleton-fallback'),null);
  await p.tick(180);c.loadingSkeleton=null;p.w.matchMedia=()=>({matches:true});p.type('coff');assert.equal(c.results.querySelector('faceplate-shimmer'),null);assert.equal(p.find('.skeleton-list').querySelectorAll('.skeleton-fallback').length,21);
});

for(const scope of ['people','all','messages'])test(scope+' Down Arrow enters results from the field and scope tab, including a cached pending draft',async t=>{
  const p=await setup(t,{scope}),c=p.control,query=scope==='messages'?'coffee':'alex';await p.search(query);c.input.focus();p.type(query);await p.key('ArrowDown');
  assert.ok(c.active);assert.equal(c.shadow.activeElement.closest('[data-key]').dataset.key,c.active);assert.equal(c.pendingNavigation || '', '');
  const first=c.active;await p.key('ArrowDown',c.shadow.activeElement);assert.notEqual(c.active,first);assert.equal(c.shadow.activeElement.closest('[data-key]').dataset.key,c.active);
  await p.key('Escape',c.shadow.activeElement);assert.equal(c.panel.hidden,true);await p.key('ArrowDown');assert.equal(c.panel.hidden,false);assert.equal(c.shadow.activeElement.closest('[data-key]').dataset.key,c.active);
  c.scopeButtons[scope].focus();await p.key('ArrowDown',c.scopeButtons[scope]);assert.equal(c.shadow.activeElement.closest('[data-key]').dataset.key,c.active);
  await p.search('nonexistent-phrase');p.type('nonexistent-phrase');await p.key('ArrowDown');assert.equal(c.active,'');assert.equal(c.pendingNavigation || '','');
});

test('Down Arrow during message loading waits for current matches then focuses the result',async t=>{
  const p=await setup(t,{scope:'messages',deferSearch:true}),c=p.control;c.input.focus();p.type('coffee');await p.key('ArrowDown');assert.equal(c.pendingNavigation,'ArrowDown');assert.equal(c.active,'');await p.key('ArrowDown');assert.equal(c.active,'');
  while(p.pending.length){p.pending.shift()();await settle();}assert.ok(c.active.startsWith('message:'));assert.equal(c.pendingNavigation,'');assert.equal(c.shadow.activeElement.closest('[data-key]').dataset.key,c.active);assert.equal(c.input.value,'coffee');
});

test('All and Messages mark unavailable accounts compactly and refresh cached rows when availability changes',async t=>{
  const p=await setup(t),c=p.control;await p.search('coffee');const chat=p.cache.get('alex');p.cache.set('alex',{...chat,name:'CoffeeAlex',accountUnavailable:true,historicalName:true});c.render();
  assert.equal(p.find('[data-key="chat:alex"] .row-meta').textContent,'Unavailable');let row=p.find('.message-result[data-key^="message:alex:"]');assert.ok(row.querySelector('.unavailable-marker'));assert.match(row.querySelector('.unavailable-marker').title,/Unavailable account.*Retained identity/);assert.match(row.querySelector('button').getAttribute('aria-label'),/Unavailable account/);assert.equal(row.querySelectorAll('.row-time').length,1);
  await p.click('[data-scope="messages"]');row=p.find('.message-result[data-key^="message:alex:"]');assert.ok(row.querySelector('.unavailable-marker'));assert.equal(row.querySelector('.avatar').src,chat.avatar);
  p.cache.set('alex',chat);c.render();assert.equal(p.find('.message-result[data-key^="message:alex:"]').querySelector('.unavailable-marker'),null);
});

test('an unavailable group sender is identified without marking the whole group unavailable',async t=>{
  const p=await setup(t,{scope:'messages'}),c=p.control;await p.search('coffee');const record=c.savedHits.find(record=>!record.authorSelf);assert.ok(record);p.cache.set(record.roomId,{...p.cache.get(record.roomId),type:'group',accountUnavailable:false});record.authorUnavailable=true;record.authorHistorical=true;c.render();
  const row=p.find('[data-key="message:'+record.roomId+':'+record.id+'"]');assert.match(row.querySelector('.unavailable-marker').getAttribute('aria-label'),/Unavailable sender:/);assert.doesNotMatch(row.querySelector('.unavailable-marker').title,/Unavailable account/);
  record.authorUnavailable=false;c.render();assert.equal(p.find('[data-key="message:'+record.roomId+':'+record.id+'"]').querySelector('.unavailable-marker'),null);
});

test('calendar chooser Escape stays inside the picker and does not dismiss global search',async t=>{
  const p=await setup(t),c=p.control;await p.search('coffee');const searches=p.searches.length;await p.click('[data-control="date"]');const picker=c.datePicker;picker.element.querySelector('.calendar-month').click();assert.equal(picker.chooser,'month');await p.key('Escape',picker.element.querySelector('.calendar-option'));assert.equal(picker.open,true);assert.equal(picker.chooser,'');assert.equal(c.searchDismissed,false);await p.key('Escape',picker.element.querySelector('.calendar-month'));assert.equal(picker.open,false);assert.equal(c.searchDismissed,false);assert.equal(c.input.value,'coffee');assert.equal(p.searches.length,searches);
});

test('quick dates remain a local draft until Apply and reuse the existing saved-search path',async t=>{
  const p=await setup(t),c=p.control;await p.search('coffee');await p.click('[data-control="date"]');const picker=c.datePicker;picker.today=()=> '2026-10-14';const searches=p.searches.length,requests=p.requests.length;
  picker.element.querySelector('.calendar-quick').click();picker.element.querySelector('[data-preset="Last 7 days"]').click();await settle();assert.equal(p.searches.length,searches);assert.equal(p.requests.length,requests);assert.equal(c.dates.from,'');assert.equal(c.dates.to,'');assert.equal(picker.open,true);
  picker.element.querySelector('.calendar-apply').click();await settle();assert.equal(c.dates.from,'2026-10-08');assert.equal(c.dates.to,'2026-10-14');assert.equal(p.searches.length,searches+1);assert.equal(p.requests.length,requests);assert.ok(p.find('[aria-label="Remove date filter"]'));await p.click('[aria-label="Remove date filter"]');assert.equal(c.dates.from,'');assert.equal(c.dates.to,'');assert.equal(c.input.value,'coffee');
});
