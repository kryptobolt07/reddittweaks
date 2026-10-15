const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {JSDOM}=require('jsdom');
const {setDateSegments,setDateMode}=require('./date-segments-helper.cjs');
const source=file=>readFileSync(join(__dirname,'..',file),'utf8');
const tick=ms=>new Promise(resolve=>setTimeout(resolve,ms||30));
function setup(t,{content=false}={}) {
  const dom=new JSDOM('<!doctype html><body></body>',{url:'https://www.reddit.com/chat/',runScripts:'outside-only',pretendToBeVisual:true});
  t.after(()=>dom.window.close());const W=dom.window;W.matchMedia=()=>({matches:true});W.HTMLElement.prototype.scrollIntoView=function(){};
  for(const file of ['demo/fixture.js','extension/directory-model.js','extension/search-core.js','extension/adapter.js','extension/history-store.js','extension/native-identities.js','extension/page-bridge.js','extension/data-client.js'])W.eval(source(file));
  const api=W.ChatFixture.build(W.document.body),client=api.app.querySelector('rs-matrix-client').client,listeners=new Map();
  client.on=(type,fn)=>listeners.set(type,fn);client.off=type=>listeners.delete(type);
  if(content){for(const file of ['extension/message-store.js','extension/media-preview.js','extension/date-picker.js','extension/content.js'])W.eval(source(file));}
  return {W,api,client,listeners};
}
test('cancelled history resumes at the saved cursor instead of downloading its first page again',async t=>{
  const {W,api}=setup(t);let task;
  task=W.RCSData.request('history',{roomId:'alex'},progress=>{if(progress.loaded===3)task.cancel();});
  await assert.rejects(task.promise,/cancelled/);await tick();
  const messages=await W.RCSData.request('history',{roomId:'alex'}).promise;
  const calls=api.calls.filter(c=>c.path==='/rooms/alex/events');
  assert.equal(messages.length,7);assert.equal(calls.length,3);assert.equal(calls[1].params.seq,'3');assert.equal(messages.historyMeta.complete,true);
});
test('two controls share one history download and cancelling one subscriber preserves the other',async t=>{
  const {W,api,client}=setup(t);let release;const original=client.http.authedRequest;
  client.http.authedRequest=async(method,path,params)=>{if(path==='/rooms/alex/events'&&params.seq===undefined)await new Promise(resolve=>release=resolve);return original(method,path,params);};
  const a=W.RCSData.request('history',{roomId:'alex'}),b=W.RCSData.request('history',{roomId:'alex'});
  const cancelled=a.promise.catch(e=>e.message);await tick();a.cancel();assert.equal(await cancelled,'Search cancelled');release();
  assert.equal((await b.promise).length,7);assert.equal(api.calls.filter(c=>c.path==='/rooms/alex/events').length,3);
});
test('native messages, edits, and redactions update cached searches without more history requests',async t=>{
  const {W,api,listeners}=setup(t);await W.RCSData.request('history',{roomId:'alex'}).promise;
  const count=api.calls.length;
  const message={event_id:'live-message',room_id:'alex',seq_id:'7',type:'m.room.message',sender:'@t2_alex:reddit.com',origin_server_ts:1800000000000,content:{body:'new needle'}};
  listeners.get('event')({event:message});
  let records=await W.RCSData.request('history',{roomId:'alex'}).promise;assert.ok(records.some(m=>m.id==='live-message'&&m.text==='new needle'));
  listeners.get('event')({event:{...message,event_id:'edit-live',seq_id:'8',origin_server_ts:1800000000001,content:{body:'* updated','m.relates_to':{rel_type:'m.replace',event_id:'live-message'},'m.new_content':{body:'corrected needle'}}}});
  records=await W.RCSData.request('history',{roomId:'alex'}).promise;assert.equal(records.find(m=>m.id==='live-message').text,'corrected needle');
  listeners.get('event')({event:{event_id:'redact-live',room_id:'alex',seq_id:'9',type:'m.room.redaction',redacts:'live-message'}});
  records=await W.RCSData.request('history',{roomId:'alex'}).promise;assert.ok(!records.some(m=>m.id==='live-message'));assert.ok(records.historyMeta.redacted.includes('live-message'));
  assert.equal(api.calls.length,count);
});
test('refresh fetches only the newer history until a previously verified boundary',async t=>{
  const {W,api}=setup(t);await W.RCSData.request('history',{roomId:'alex'}).promise;api.calls.length=0;
  api.remoteMessages.get('alex').push({event_id:'new-after-cache',seq_id:'7',type:'m.room.message',sender:'@t2_alex:reddit.com',origin_server_ts:1800000000000,content:{body:'refresh needle'}});
  const records=await W.RCSData.request('history',{roomId:'alex',refresh:true}).promise;
  assert.equal(records.length,8);assert.equal(api.calls.filter(c=>c.path==='/rooms/alex/events').length,1);
});
test('server edits and redactions cannot be undone by a stale rendered message',t=>{
  const {W}=setup(t);const index=new W.RCSCore.MessageIndex(Infinity);
  index.replace('room',[{id:'message',text:'edited body',author:'Person',sender:'@t2_person:reddit.com',thread:true}]);
  index.upsert('room',[{id:'message',text:'old DOM body',author:'Person'}],{dom:true});
  assert.equal(index.search('room','edited')[0].thread,true);assert.equal(index.search('room','old DOM').length,0);
  index.upsert('room',[],{redacted:['message']});index.upsert('room',[{id:'message',text:'old DOM body'}],{dom:true});assert.equal(index.search('room','').length,0);
});
test('live edits remove old words and display new matches in an open message search',async t=>{
  const {W,api,listeners}=setup(t,{content:true});await tick(250);
  const control=W.RCSAdapter.query('[data-rcs-ui="messages"]',api.room).shadowRoot;
  W.RCSAdapter.query('[data-rcs-ui="message-trigger"]',api.room).shadowRoot.querySelector('button').click();await tick(150);
  const input=control.querySelector('input');input.value='coffe';input.dispatchEvent(new W.Event('input'));await tick(170);
  const target=api.remoteMessages.get('alex')[3];
  listeners.get('event')({event:{event_id:'live-edit',room_id:'alex',seq_id:'7',type:'m.room.message',sender:'@t2_alex:reddit.com',origin_server_ts:1800000000000,content:{'m.relates_to':{rel_type:'m.replace',event_id:target.event_id},'m.new_content':{body:'chocolate needle'}}}});
  input.value='chocolate';input.dispatchEvent(new W.Event('input'));await tick(170);assert.equal(control.querySelectorAll('.result').length,1);
  await tick(200);assert.equal(control.querySelectorAll('.result').length,1,'DOM resynchronization preserves the server edit');
});
test('message matches appear while later pages are still blocked, with compact sender names and highlights',async t=>{
  const {W,api,client}=setup(t,{content:true});await tick(250);
  const read=client.http.authedRequest;let release;
  client.http.authedRequest=async(method,path,params)=>{if(path==='/rooms/alex/events' && params.seq!==undefined)await new Promise(resolve=>release=resolve);return read(method,path,params);};
  W.RCSAdapter.query('[data-rcs-ui="message-trigger"]',api.room).shadowRoot.querySelector('button').click();
  const root=W.RCSAdapter.query('[data-rcs-ui="messages"]',api.room).shadowRoot,input=root.querySelector('input');
  input.value='meet';input.dispatchEvent(new W.Event('input'));await tick(170);
  assert.equal(typeof release,'function');assert.equal(root.querySelectorAll('.result').length,1);
  assert.equal(root.querySelector('.result .avatar'),null);assert.ok(root.querySelector('.result .name').textContent);assert.ok(root.querySelector('.result mark'));
  assert.match(root.querySelector('[role="status"]').textContent,/1 result.*Searching/);
  assert.equal(root.querySelector('.panel .load').textContent,'Stop');
  root.querySelector('.panel .load').click();await tick(80);
  release();
});
test('calendar filters work without text and reuse loaded history and stable snippet nodes',async t=>{
  const {W,api}=setup(t,{content:true});await tick(250);
  W.RCSAdapter.query('[data-rcs-ui="message-trigger"]',api.room).shadowRoot.querySelector('button').click();await tick(150);
  const root=W.RCSAdapter.query('[data-rcs-ui="messages"]',api.room).shadowRoot,input=root.querySelector('input');
  input.value='coffee';input.dispatchEvent(new W.Event('input'));await tick(170);const image=root.querySelector('.result .preview'),calls=api.calls.length;
  root.querySelector('[aria-label="Filter by date"]').click();
  setDateSegments(root,'start','2026-10-08');setDateSegments(root,'end','2026-10-08');root.querySelector('.calendar-apply').click();
  assert.equal(root.querySelector('.date-chip').parentElement,root.querySelector('.room-filter-bar'));
  assert.equal(root.querySelectorAll('.result').length,2);assert.equal(root.querySelector('.result .preview'),image);
  input.value='';input.dispatchEvent(new W.Event('input'));await tick(170);assert.equal(root.querySelector('.panel').hidden,false);
  assert.equal(root.querySelectorAll('.result').length,7);
  root.querySelector('[aria-label="Filter by date"]').click();setDateMode(root,'After');setDateSegments(root,'start','2026-10-08');root.querySelector('.calendar-apply').click();assert.equal(root.querySelectorAll('.result').length,0);
  root.querySelector('[aria-label="Filter by date"]').click();root.querySelector('.calendar-clear').click();root.querySelector('.date-popover').dispatchEvent(new W.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(root.querySelector('.panel').hidden,true);
  assert.equal(api.calls.length,calls);
});
test('message history finishes without a profile controller and never waits for optional sender metadata',async t=>{
  const {W,api}=setup(t);for(const row of W.RCSAdapter.queryAll('rs-rooms-nav-room',api.nav))row.users=undefined;
  api.room.users=undefined;const labels=[];
  const messages=await W.RCSData.request('history',{roomId:'alex'},progress=>labels.push(progress.label)).promise;
  assert.equal(messages.length,7);assert.equal(messages.historyMeta.complete,true);
  assert.equal(labels.some(label=>/profile data/.test(label)),false);assert.equal(messages.find(m=>m.sender==='@t2_me:reddit.com').author,'You');
});
test('profile discovery finds a room-info controller even when chat rows have no users property',async t=>{
  const {W,api}=setup(t),A=W.RCSAdapter;
  const provider=A.query('rs-rooms-nav-room',api.nav).users;
  for(const row of A.queryAll('rs-rooms-nav-room',api.nav))row.users=undefined;api.room.users=undefined;
  const info=W.document.createElement('rs-room-info');info.usersController=provider;api.room.shadowRoot.append(info);
  const directory=await W.RCSData.request('conversations').promise;assert.equal(directory.find(r=>r.id==='amey').name,'amey_bhoir');
});
test('optional sender enrichment is bounded and never fetches the current user profile',async t=>{
  const {W,api}=setup(t),provider=W.RCSAdapter.query('rs-rooms-nav-room',api.nav).users,timeout=W.setTimeout.bind(W);let expire;const ids=[];
  provider.getRedditUserById=id=>{ids.push(id);return new Promise(()=>{});};
  W.setTimeout=(fn,ms,...args)=>ms>1000 && ms<=2000 ? (expire=fn,timeout(()=>{},100000)) : timeout(fn,ms,...args);
  const task=W.RCSData.request('history',{roomId:'alex'});await tick(100);assert.equal(typeof expire,'function');expire();
  const messages=await task.promise;assert.equal(messages.length,7);assert.equal(messages.historyMeta.complete,true);
  assert.deepEqual(ids,['t2_alex']);assert.equal(api.calls.filter(c=>c.path==='/rooms/alex/events').length,3);
});
test('cached native messages can match before the first history request returns',async t=>{
  const {W,api,client}=setup(t);const getRoom=client.getRoom;
  client.getRoom=id=>{const room=getRoom(id);return room&&{...room,getLiveTimeline:()=>({getEvents:()=>[{event:api.remoteMessages.get(id)[1]}]})};};
  let release,partial;
  const read=client.http.authedRequest;client.http.authedRequest=async(method,path,params)=>{await new Promise(resolve=>release=resolve);return read(method,path,params);};
  const task=W.RCSData.request('history',{roomId:'alex'},value=>{if(value.label==='Searching cached messages…')partial=value;});
  task.promise.catch(()=>{});await tick(80);
  assert.ok(partial.records.some(m=>/new project/.test(m.text)));assert.equal(api.calls.length,0);
  task.cancel();release();await tick(100);
});
test('SVG sender avatars are reused for grouped history including the current user without profile calls',async t=>{
  const {W,api,client}=setup(t),A=W.RCSAdapter,events=A.queryAll('rs-timeline-event',api.room);
  for(const e of events) {
    const own=e.event.getSender()===client.getUserId(),photo=A.query('.user-avatar',e);
    photo.innerHTML=`<svg><image href="https://www.redditstatic.com/avatars/${own?'self':'other'}.png"></image></svg>`;
  }
  // This author label is absent in a grouped row; another row supplies its identity.
  A.query('.user-name',events[2]).textContent='';
  for(const row of A.queryAll('rs-rooms-nav-room',api.nav))row.users=undefined;api.room.users=undefined;
  assert.equal(A.messages(api.room)[0].avatar,'https://www.redditstatic.com/avatars/other.png');
  const messages=await W.RCSData.request('history',{roomId:'alex'}).promise;
  for(const m of messages)assert.equal(m.avatar,`https://www.redditstatic.com/avatars/${m.sender===client.getUserId()?'self':'other'}.png`);
  assert.equal(messages.filter(m=>m.sender===client.getUserId()).every(m=>m.author==='You'),true);
  assert.equal(api.calls.some(c=>c.method==='profile'),false);
});
function datedFixture(api,W) {api.remoteMessages.get('alex').forEach((event,i)=>event.origin_server_ts=new W.Date(2026,9,i+1,12).getTime());}
test('date search stops at the lower boundary, reuses narrower ranges, and resumes when widened or cleared',async t=>{
  const {W,api}=setup(t);datedFixture(api,W);
  let records=await W.RCSData.request('history',{roomId:'alex',dates:{from:'2026-10-06',to:'2026-10-07'}}).promise;
  assert.equal(api.calls.filter(c=>c.path==='/rooms/alex/events').length,1);assert.equal(records.historyMeta.complete,false);assert.equal(records.historyMeta.dateComplete,true);
  records=await W.RCSData.request('history',{roomId:'alex',dates:{from:'2026-10-07',to:'2026-10-07'}}).promise;
  assert.equal(api.calls.filter(c=>c.path==='/rooms/alex/events').length,1);
  records=await W.RCSData.request('history',{roomId:'alex',dates:{from:'2026-10-03'}}).promise;
  assert.equal(api.calls.filter(c=>c.path==='/rooms/alex/events').length,2);assert.equal(api.calls.filter(c=>c.path==='/rooms/alex/events')[1].params.seq,'3');assert.equal(records.historyMeta.complete,false);
  records=await W.RCSData.request('history',{roomId:'alex',dates:{}}).promise;
  assert.equal(records.length,7);assert.equal(records.historyMeta.complete,true);assert.equal(api.calls.filter(c=>c.path==='/rooms/alex/events').length,3);
});
test('a range after the newest message ends after one latest page and does not look up profiles',async t=>{
  const {W,api}=setup(t);datedFixture(api,W);let profiles=0;
  const provider=W.RCSAdapter.query('rs-rooms-nav-room',api.nav).users;provider.getRedditUserById=async()=>{profiles++;return null;};
  const records=await W.RCSData.request('history',{roomId:'alex',dates:{from:'2026-10-12'}}).promise;
  assert.equal(records.historyMeta.dateComplete,true);assert.equal(records.historyMeta.complete,false);assert.equal(api.calls.filter(c=>c.path==='/rooms/alex/events').length,1);assert.equal(profiles,0);
  const index=new W.RCSCore.MessageIndex(Infinity);index.upsert('alex',records);assert.equal(index.search('alex','',{from:'2026-10-12'}).length,0);
});
test('changing a running search to a date range reuses the in-flight page and stops older reads',async t=>{
  const {W,api,client}=setup(t);datedFixture(api,W);let release;const read=client.http.authedRequest;
  client.http.authedRequest=async(...args)=>{await new Promise(resolve=>release=resolve);return read(...args);};
  const task=W.RCSData.request('history',{roomId:'alex'});await tick(50);task.setDates({from:'2026-10-06'});release();
  const records=await task.promise;assert.equal(records.historyMeta.dateComplete,true);assert.equal(records.historyMeta.dates.from,'2026-10-06');assert.equal(api.calls.filter(c=>c.path==='/rooms/alex/events').length,1);
});
test('a full-history subscriber prevents a shared date-range subscriber from stopping its download',async t=>{
  const {W,api,client}=setup(t);datedFixture(api,W);let release;const read=client.http.authedRequest;
  client.http.authedRequest=async(...args)=>{if(!release)await new Promise(resolve=>release=resolve);return read(...args);};
  const bounded=W.RCSData.request('history',{roomId:'alex',dates:{from:'2026-10-06'}}),all=W.RCSData.request('history',{roomId:'alex'});await tick(50);release();
  const [a,b]=await Promise.all([bounded.promise,all.promise]);assert.equal(a.historyMeta.complete,true);assert.equal(b.length,7);assert.equal(api.calls.filter(c=>c.path==='/rooms/alex/events').length,3);
});
test('unreliable timestamp order disables date stopping rather than hiding older matches',async t=>{
  const {W,api}=setup(t);datedFixture(api,W);api.remoteMessages.get('alex')[4].origin_server_ts=new W.Date(2026,9,10,12).getTime();
  const records=await W.RCSData.request('history',{roomId:'alex',dates:{from:'2026-10-06'}}).promise;
  assert.equal(records.historyMeta.complete,true);assert.equal(api.calls.filter(c=>c.path==='/rooms/alex/events').length,3);
});
test('refreshing a partly searched date range checks the newest page without declaring older history complete',async t=>{
  const {W,api}=setup(t);datedFixture(api,W);
  await W.RCSData.request('history',{roomId:'alex',dates:{from:'2026-10-06'}}).promise;
  api.remoteMessages.get('alex').push({event_id:'new-date-event',seq_id:'7',type:'m.room.message',sender:'@t2_alex:reddit.com',origin_server_ts:new W.Date(2026,9,8,12).getTime(),content:{body:'new matching message'}});
  const records=await W.RCSData.request('history',{roomId:'alex',dates:{from:'2026-10-06'},refresh:true}).promise;
  assert.equal(records.historyMeta.complete,false);assert.ok(records.some(m=>m.id==='new-date-event'));assert.equal(api.calls.filter(c=>c.path==='/rooms/alex/events').length,2);
});
test('a known old thread root still searches recent replies inside the selected dates',async t=>{
  const {W,api,client}=setup(t);datedFixture(api,W);const oldRoot={...api.remoteMessages.get('alex')[0],unsigned:{'m.relations':{'m.thread':{count:2}}}};
  const getRoom=client.getRoom;client.getRoom=id=>({...getRoom(id),getThreads:()=>[{rootEvent:{event:oldRoot},events:[]}]});
  const read=client.http.authedRequest;client.http.authedRequest=async(method,path,params)=>params.parent==='0'?{events:[{event_id:'recent-reply',seq_id:'t6',type:'m.room.message',sender:'@t2_alex:reddit.com',origin_server_ts:new W.Date(2026,9,7,12).getTime(),content:{body:'recent reply','m.relates_to':{rel_type:'m.thread',event_id:oldRoot.event_id}}},{event_id:'old-reply',seq_id:'t4',type:'m.room.message',sender:'@t2_alex:reddit.com',origin_server_ts:new W.Date(2026,9,5,12).getTime(),content:{body:'old reply','m.relates_to':{rel_type:'m.thread',event_id:oldRoot.event_id}}}],state:[]}:read(method,path,params);
  const records=await W.RCSData.request('history',{roomId:'alex',dates:{from:'2026-10-06'}}).promise;
  assert.ok(records.some(m=>m.id==='recent-reply'));assert.equal(records.historyMeta.dateComplete,true);assert.equal(records.historyMeta.complete,false);
});
test('the date pill clear button removes the filter without clearing the message query or opening the calendar',async t=>{
  const {W,api}=setup(t,{content:true});await tick(250);W.RCSAdapter.query('[data-rcs-ui="message-trigger"]',api.room).shadowRoot.querySelector('button').click();await tick(150);
  const root=W.RCSAdapter.query('[data-rcs-ui="messages"]',api.room).shadowRoot,input=root.querySelector('input');input.value='coffee';input.dispatchEvent(new W.Event('input'));await tick(150);
  root.querySelector('[aria-label="Filter by date"]').click();setDateSegments(root,'start','2026-10-08');setDateSegments(root,'end','2026-10-08');root.querySelector('.calendar-apply').click();
  const calls=api.calls.length;assert.equal(root.querySelector('.date-chip svg rect'),null);
  root.querySelector('[aria-label="Remove date filter"]').click();assert.equal(root.querySelector('.date-chip').hidden,true);assert.equal(root.querySelector('.date-popover').hidden,true);assert.equal(input.value,'coffee');assert.equal(root.querySelectorAll('.result').length,2);assert.equal(api.calls.length,calls);
});
test('opening an empty message search does not download history before text or dates are applied',async t=>{
  const {W,api}=setup(t,{content:true});await tick(150);W.RCSAdapter.query('[data-rcs-ui="message-trigger"]',api.room).shadowRoot.querySelector('button').click();await tick(100);
  const root=W.RCSAdapter.query('[data-rcs-ui="messages"]',api.room).shadowRoot;assert.equal(api.calls.filter(c=>c.path==='/rooms/alex/events').length,0);
  root.querySelector('[aria-label="Filter by date"]').click();await tick(50);assert.equal(api.calls.filter(c=>c.path==='/rooms/alex/events').length,0);
  setDateSegments(root,'start','2026-10-08');setDateSegments(root,'end','2026-10-08');root.querySelector('.calendar-apply').click();await tick(150);assert.ok(api.calls.some(c=>c.path==='/rooms/alex/events'));
});
test('a native edit arriving before its original history page is retained when that page loads',async t=>{
  const {W,api,client,listeners}=setup(t);let release;const read=client.http.authedRequest;client.http.authedRequest=async(...args)=>{if(!release)await new Promise(resolve=>release=resolve);return read(...args);};
  const task=W.RCSData.request('history',{roomId:'alex'});await tick(50);const target=api.remoteMessages.get('alex')[3];
  listeners.get('event')({event:{event_id:'early-edit',room_id:'alex',seq_id:'7',type:'m.room.message',sender:target.sender,origin_server_ts:1800000000000,content:{'m.relates_to':{rel_type:'m.replace',event_id:target.event_id},'m.new_content':{body:'early edited body'}}}});
  release();const records=await task.promise;assert.equal(records.find(m=>m.id===target.event_id).text,'early edited body');
});
test('a full-history subscriber joining after a date cutoff resumes the shared saved cursor',async t=>{
  const {W,api}=setup(t);datedFixture(api,W);const provider=W.RCSAdapter.query('rs-rooms-nav-room',api.nav).users,lookup=provider.getRedditUserById;let release;
  provider.getRedditUserById=async id=>{if(!release)await new Promise(resolve=>release=resolve);return lookup(id);};
  const range=W.RCSData.request('history',{roomId:'alex',dates:{from:'2026-10-06'}});await tick(80);assert.equal(typeof release,'function');
  const all=W.RCSData.request('history',{roomId:'alex'});await tick(50);release();const records=await all.promise;await range.promise;
  assert.equal(records.length,7);assert.equal(records.historyMeta.complete,true);assert.equal(api.calls.filter(c=>c.path==='/rooms/alex/events').length,3);
});
test('clicking a still-focused search input after Enter reopens the saved matches without another history read',async t=>{
  const {W,api}=setup(t,{content:true});await tick(150);W.RCSAdapter.query('[data-rcs-ui="message-trigger"]',api.room).shadowRoot.querySelector('button').click();
  const root=W.RCSAdapter.query('[data-rcs-ui="messages"]',api.room).shadowRoot,input=root.querySelector('input');input.value='coffee';input.dispatchEvent(new W.Event('input'));await tick(170);
  input.dispatchEvent(new W.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));input.dispatchEvent(new W.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await tick(50);
  assert.equal(root.querySelector('.panel').hidden,true);assert.equal(root.activeElement,input);const calls=api.calls.length;
  input.click();assert.equal(root.querySelector('.panel').hidden,false);assert.equal(input.value,'coffee');assert.equal(root.querySelectorAll('.result').length,2);assert.equal(input.getAttribute('aria-expanded'),'true');
  await tick(50);assert.equal(api.calls.length,calls);
});
function hideNativePeople(W,api){for(const row of W.RCSAdapter.queryAll('rs-rooms-nav-room',api.nav))row.users=undefined;api.room.users=undefined;for(const event of W.RCSAdapter.queryAll('rs-timeline-event',api.room))W.RCSAdapter.query('.user-name',event).textContent='';}
test('cached room membership resolves grouped senders even with no profile provider or painted author names',async t=>{
  const {W,api,client}=setup(t);hideNativePeople(W,api);const getRoom=client.getRoom;
  client.getRoom=id=>({...getRoom(id),getMembers:()=>[{userId:'@t2_alex:reddit.com',rawDisplayName:'alex_morgan',getMxcAvatarUrl:()=> 'https://example.com/member.png'}]});
  const records=await W.RCSData.request('history',{roomId:'alex'}).promise;
  for(const record of records.filter(m=>m.sender==='@t2_alex:reddit.com')){assert.equal(record.author,'alex_morgan');assert.equal(record.avatar,'https://example.com/member.png');}
  assert.equal(api.calls.filter(c=>c.path==='/rooms/alex/events').length,3);
});
test('opaque cached names fall back to a valid native display name without a profile request',async t=>{
  const {W,api,client}=setup(t);hideNativePeople(W,api);
  await W.RCSData.request('prime-directory',{owner:client.getUserId(),records:[],identities:[{id:'@t2_alex:reddit.com',name:'@t2_alex:reddit.com',availabilityKnown:true}]}).promise;
  const getUser=client.getUser;client.getUser=id=>id==='@t2_alex:reddit.com'?{rawDisplayName:'@t2_alex:reddit.com',displayName:'alex_morgan'}:getUser(id);
  const records=await W.RCSData.request('history',{roomId:'alex'}).promise;assert.equal(records.find(m=>m.sender==='@t2_alex:reddit.com').author,'alex_morgan');
});
test('late saved identities update open completed search results without downloading history again',async t=>{
  const {W,api,client}=setup(t);hideNativePeople(W,api);
  const request=W.RCSData.request;W.RCSData={request:(method,...args)=>method==='conversations'?{promise:Promise.resolve([]),cancel:()=>{}}:request(method,...args)};
  W.eval(source('extension/date-picker.js'));W.eval(source('extension/content.js'));await tick(150);
  W.RCSAdapter.query('[data-rcs-ui="message-trigger"]',api.room).shadowRoot.querySelector('button').click();const root=W.RCSAdapter.query('[data-rcs-ui="messages"]',api.room).shadowRoot,input=root.querySelector('input');input.value='coffee';input.dispatchEvent(new W.Event('input'));await tick(170);
  assert.ok([...root.querySelectorAll('.name')].some(n=>n.textContent==='Sender unavailable'),'room rows expose unresolved sender without guessing from conversation title');const reads=api.calls.filter(c=>c.path==='/rooms/alex/events').length;
  await W.RCSData.request('prime-directory',{owner:client.getUserId(),records:[],identities:[{id:'@t2_alex:reddit.com',name:'alex_morgan',avatar:'https://example.com/late.png',availabilityKnown:true}]}).promise;
  assert.equal([...root.querySelectorAll('.name')].some(n=>n.textContent==='Sender unavailable'),false);assert.ok([...root.querySelectorAll('.name')].some(n=>n.textContent==='alex_morgan'));assert.equal(root.querySelector('.avatar'),null);
  await tick(50);assert.equal(api.calls.filter(c=>c.path==='/rooms/alex/events').length,reads);
});
test('unbound grouped native rows do not create unknown duplicate results while cached events are searched',async t=>{
  const {W,api,client}=setup(t),A=W.RCSAdapter,getRoom=client.getRoom;
  client.getRoom=id=>({...getRoom(id),getLiveTimeline:()=>({getEvents:()=>api.remoteMessages.get(id).map(event=>({event}))})});
  for(const event of A.queryAll('rs-timeline-event',api.room))event.removeAttribute('data-id');
  A.query('.user-name',A.queryAll('rs-timeline-event',api.room)[2]).textContent='';
  let release;const read=client.http.authedRequest;client.http.authedRequest=async(...args)=>{if(!release)await new Promise(resolve=>release=resolve);return read(...args);};
  W.eval(source('extension/date-picker.js'));W.eval(source('extension/content.js'));await tick(150);
  A.query('[data-rcs-ui="message-trigger"]',api.room).shadowRoot.querySelector('button').click();const root=A.query('[data-rcs-ui="messages"]',api.room).shadowRoot,input=root.querySelector('input');input.value='coffee';input.dispatchEvent(new W.Event('input'));await tick(170);
  try {assert.equal([...root.querySelectorAll('.result .name')].filter(n=>n.textContent==='Sender unavailable').length,0);assert.equal(root.querySelectorAll('.result').length,2);}
  finally {input.dispatchEvent(new W.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));input.dispatchEvent(new W.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));release?.();await tick(100);}
});
test('native event bindings update recycled rows independently of deleted-account label patches',async t=>{
  const {W,api}=setup(t);await W.RCSData.request('identity-context').promise;const calls=api.calls.length;
  W.eval(`customElements.define('rs-timeline-event',class extends HTMLElement {connectedCallback(){} updated(){this.nativeUpdates=(this.nativeUpdates||0)+1;}});`);
  const event=W.document.createElement('rs-timeline-event');event.event={getId:()=>'$self',getSender:()=> '@t2_me:reddit.com'};api.room.append(event);
  assert.equal(event.getAttribute('data-rcs-event-id'),'$self');assert.equal(event.getAttribute('data-rcs-author-self'),'true');
  event.event={getId:()=>'$peer',getSender:()=> '@t2_alex:reddit.com'};event.updated();assert.equal(event.getAttribute('data-rcs-event-id'),'$peer');assert.equal(event.getAttribute('data-rcs-sender'),'@t2_alex:reddit.com');assert.equal(event.getAttribute('data-rcs-author-self'),'false');assert.equal(event.nativeUpdates,1);
  W.RCSNativeIdentities.clear();event.event={getId:()=>'$self-again',getSender:()=> '@t2_me:reddit.com'};event.updated();assert.equal(event.getAttribute('data-rcs-author-self'),'true');assert.equal(api.calls.length,calls);
});


test('individual image history keeps preview metadata and shows a thumbnail instead of a filename',async t=>{
  const {W,api,client}=setup(t,{content:true});client.mxcUrlToHttp=()=> 'https://example.invalid/native-thumb.jpg';
  api.remoteMessages.get('alex').push({event_id:'native-image',room_id:'alex',type:'m.room.message',sender:'@t2_alex:reddit.com',seq_id:'7',origin_server_ts:1791432420000,content:{msgtype:'m.image',body:'photo.jpeg',url:'mxc://reddit.com/photo',info:{mimetype:'image/jpeg',w:1200,h:1600}}});
  const records=await W.RCSData.request('history',{roomId:'alex'}).promise,photo=records.find(record=>record.id==='native-image');assert.equal(photo.attachmentType,'image');assert.equal(photo.attachmentPreview,'https://example.invalid/native-thumb.jpg');
  const trigger=W.RCSAdapter.query('[data-rcs-ui="message-trigger"]',api.room).shadowRoot.querySelector('button');trigger.click();const root=W.RCSAdapter.query('[data-rcs-ui="messages"]',api.room).shadowRoot,input=root.querySelector('input');input.value='photo';input.dispatchEvent(new W.Event('input'));await tick(250);
  assert.equal(photo.attachmentWidth,1200);assert.equal(photo.attachmentHeight,1600);
  const preview=root.querySelector('.preview.has-image');assert.ok(preview);assert.ok(preview.querySelector('.media-image'));assert.doesNotMatch(preview.textContent,/jpeg/);assert.doesNotMatch(preview.textContent,/Image|GIF/);const image=preview.querySelector('.media-image');Object.defineProperties(image,{naturalWidth:{value:192},naturalHeight:{value:256}});image.dispatchEvent(new W.Event('load'));assert.equal(image.width,96);assert.equal(image.height,128);
});

test('individual search anchors the visible header when images above or below it decode',async t=>{
  const {W,api}=setup(t,{content:true});await tick();
  for(const [i,msgtype]of [[0,'m.image'],[1,'m.text'],[2,'m.image']])api.remoteMessages.get('alex').push({event_id:'anchor-'+i,room_id:'alex',type:'m.room.message',sender:'@t2_alex:reddit.com',seq_id:String(9-i),origin_server_ts:1800000000000-i*1000,content:{msgtype,body:'anchor '+i,...(msgtype==='m.image'?{url:'https://example.invalid/anchor/'+i}:{})}});
  W.RCSAdapter.query('[data-rcs-ui="message-trigger"]',api.room).shadowRoot.querySelector('button').click();const root=W.RCSAdapter.query('[data-rcs-ui="messages"]',api.room).shadowRoot,input=root.querySelector('input');input.value='anchor';input.dispatchEvent(new W.Event('input'));await tick(250);
  const results=root.querySelector('.results'),rows=[...results.querySelectorAll('.result')];assert.equal(rows.length,3);
  const height=row=>64+(row.querySelector('.media-image')?.height || 0);results.getBoundingClientRect=()=>({top:10});
  for(const [i,row]of rows.entries())row.getBoundingClientRect=()=>{const top=10+rows.slice(0,i).reduce((sum,r)=>sum+height(r),0)-results.scrollTop;return {top,bottom:top+height(row)};};
  results.scrollTop=height(rows[0]);const headerTop=rows[1].getBoundingClientRect().top;
  const decode=row=>{const img=row.querySelector('.media-image');Object.defineProperties(img,{naturalWidth:{value:400},naturalHeight:{value:800}});img.dispatchEvent(new W.Event('load'));};
  decode(rows[0]);assert.equal(results.scrollTop,192);assert.equal(rows[1].getBoundingClientRect().top,headerTop);
  const before=results.scrollTop;decode(rows[2]);assert.equal(results.scrollTop,before);assert.equal(rows[1].getBoundingClientRect().top,headerTop);
});

test('room typing postpones local matching and progressive history redraws until idle, while Enter flushes immediately',async t=>{
  const {W,api}=setup(t,{content:true});await tick(50);W.RCSAdapter.query('[data-rcs-ui="message-trigger"]',api.room).shadowRoot.querySelector('button').click();const root=W.RCSAdapter.query('[data-rcs-ui="messages"]',api.room).shadowRoot,input=root.querySelector('input');
  const search=W.RCSCore.MessageIndex.prototype.search;let queries=0;W.RCSCore.MessageIndex.prototype.search=function(...args){queries++;return search.apply(this,args);};
  for(const text of ['c','co','cof']){input.value=text;input.dispatchEvent(new W.Event('input'));assert.equal(input.value,text);}
  assert.equal(queries,0);assert.equal(api.calls.filter(call=>call.path==='/rooms/alex/events').length,0);assert.equal(root.querySelector('.results').getAttribute('aria-busy'),'true');
  input.dispatchEvent(new W.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));assert.ok(queries>0);assert.ok(root.querySelector('.result.active'));assert.equal(root.querySelector('.results').getAttribute('aria-busy'),'false');
  const before=queries;input.value='new draft';input.dispatchEvent(new W.Event('input'));api.appendMessage('alex_morgan','new draft arrives','pending-typing-event');await tick(70);assert.equal(queries,before,'timeline updates do not search within the typing window');
  await tick(140);assert.ok(queries>before);assert.ok(root.querySelector('.preview').textContent.includes('new draft'));
  input.value='unfinished';input.dispatchEvent(new W.Event('input'));api.room.dispatchEvent(new W.MouseEvent('pointerdown',{bubbles:true,composed:true}));await tick(180);assert.equal(root.querySelector('.panel').hidden,true,'a dismissed typing timer cannot reopen the menu');
});
