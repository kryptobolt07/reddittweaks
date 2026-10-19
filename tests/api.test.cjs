const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {JSDOM}=require('jsdom');
const code=file=>readFileSync(join(__dirname,'..',file),'utf8');
function setup({content=false,compact=false}={}) {
  const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://www.reddit.com/chat/',runScripts:'outside-only',pretendToBeVisual:true});
  const W=dom.window;W.matchMedia=()=>({matches:true});W.HTMLElement.prototype.scrollIntoView=function(){this.dataset.scrolled='true';};
  let scrollWrites=0;Object.defineProperty(W.HTMLElement.prototype,'scrollTop',{get(){return 123;},set(){scrollWrites++;},configurable:true});
  for(const file of ['demo/fixture.js','extension/directory-model.js','extension/search-core.js','extension/adapter.js','extension/history-store.js','extension/native-identities.js','extension/page-bridge.js','extension/data-client.js'])W.eval(code(file));
  let parent=W.document.body;
  if(compact){const shell=W.document.createElement('div');W.document.body.append(shell);const root=shell.attachShadow({mode:'open'});parent=W.document.createElement('div');parent.id='resizable';root.append(parent);}
  const api=W.ChatFixture.build(parent,{compact});
  if(content){W.eval(code('extension/date-picker.js'));W.eval(code('extension/content.js'));}
  return {dom,W,api,get scrollWrites(){return scrollWrites;}};
}
const tick=()=>new Promise(resolve=>setTimeout(resolve,250));
test('initial bulk discovery includes timeline dates without retaining message bodies or creating membership dates',async t=>{
  const env=setup();t.after(()=>env.dom.window.close());const {W,api}=env,client=api.app.querySelector('rs-matrix-client').client,read=client.getRoomList;
  client.getRoomList=async options=>{
    assert.equal(options.include.timeline,true);
    const data=await read(options);
    for(const room of data.rooms)room.chunk=room.room_id==='alex' ? [{type:'m.room.message',origin_server_ts:1700000000000,content:{body:'private-bulk-message'}}] : [{type:'m.room.member',origin_server_ts:1900000000000,content:{}}];
    return data;
  };
  const records=await W.RCSData.request('conversations').promise;
  assert.equal(records.find(r=>r.id==='alex').timestamp,1700000000000);
  assert.equal(records.find(r=>r.id==='jules').timestamp,0);
  assert.equal(JSON.stringify(records).includes('private-bulk-message'),false);assert.equal(api.calls.length,1);
});
test('authenticated directory finds unrendered users and includes their actual profile image URL',async t=>{
  const env=setup();t.after(()=>env.dom.window.close());const {W,api}=env;
  const before=api.nav.shadowRoot.innerHTML;
  const list=await W.RCSData.request('conversations').promise;
  assert.equal(list.length,7);const river=list.find(item=>item.id==='river');
  assert.equal(river.name,'river_sketches');assert.match(river.avatar,/^https:/);
  assert.equal(W.RCSAdapter.queryAll(W.RCSAdapter.selectors.row,api.nav).length,5);
  assert.equal(api.nav.shadowRoot.innerHTML,before);assert.equal(env.scrollWrites,0);
  assert.equal(api.calls[0].method,'rooms');assert.equal(api.calls[0].options.page_size,200);assert.equal(api.calls[0].options.include.state,true);
  assert.equal(api.calls.some(call=>call.path==='/sync' || call.path?.endsWith('/account_data/m.direct')),false);
  env.dom.window.close();
});
test('history walks sequence cursors to the first event without scrolling or modifying the timeline',async t=>{
  const env=setup();t.after(()=>env.dom.window.close());const {W,api}=env;const before=api.room.shadowRoot.innerHTML;
  const messages=await W.RCSData.request('history',{roomId:'alex'}).promise;
  assert.equal(messages.length,7);assert.match(messages[0].text,/archive/);
  assert.equal(messages[0].author,'You');assert.equal(messages[1].author,'alex_morgan');
  const calls=api.calls.filter(call=>call.method==='GET');
  assert.equal(calls.length,3);assert.equal(calls[0].params.seq,undefined);assert.equal(calls[1].params.seq,'3');assert.equal(calls[2].params.seq,'0');
  assert.ok(calls.every(call=>call.path==='/rooms/alex/events'));
  assert.equal(api.room.shadowRoot.innerHTML,before);assert.equal(env.scrollWrites,0);env.dom.window.close();
});
test('message search has no 5000-message cutoff',async t=>{
  const env=setup();t.after(()=>env.dom.window.close());const {W,api}=env;
  const all=Array.from({length:6001},(_,i)=>({event_id:`m${i}`,seq_id:String(i),type:'m.room.message',sender:'@t2_alex:reddit.com',origin_server_ts:1700000000000+i,content:{body:i===0?'oldest needle':'hello'}}));
  const matrix=api.app.querySelector('rs-matrix-client');
  matrix.client.http.authedRequest=async(method,path,params)=>all.filter(e=>Number(e.seq_id)<=Number(params.seq??Infinity)).slice(-100).reverse().length ? {events:all.filter(e=>Number(e.seq_id)<=Number(params.seq??Infinity)).slice(-100).reverse()} : {events:[]};
  const messages=await W.RCSData.request('history',{roomId:'alex'}).promise;
  assert.equal(messages.length,6001);assert.equal(messages[0].text,'oldest needle');
  const index=new W.RCSCore.MessageIndex(Infinity);index.replace('alex',messages);assert.equal(index.search('alex','oldest').length,1);env.dom.window.close();
});
test('history applies edits and redactions and loads reply threads in background',async t=>{
  const env=setup();t.after(()=>env.dom.window.close());const {W,api}=env;const original=api.remoteMessages.get('alex');
  original[1].unsigned={'m.relations':{'m.thread':{count:1}}};
  original.push({event_id:'edit',seq_id:'7',type:'m.room.message',sender:'@t2_alex:reddit.com',origin_server_ts:1800000000000,content:{body:'* edited','m.relates_to':{rel_type:'m.replace',event_id:original[2].event_id},'m.new_content':{body:'Corrected message'}}});
  original.push({event_id:'redaction',seq_id:'8',type:'m.room.redaction',redacts:original[3].event_id,origin_server_ts:1800000000001});
  const native=api.app.querySelector('rs-matrix-client').client.http.authedRequest;
  api.app.querySelector('rs-matrix-client').client.http.authedRequest=async(method,path,params)=>params.parent ? {events:[{event_id:'thread-reply',seq_id:'1.0',type:'m.room.message',sender:'@t2_alex:reddit.com',origin_server_ts:1800000000002,content:{body:'A reply needle','m.relates_to':{rel_type:'m.thread',event_id:original[1].event_id}}}]} : native(method,path,params);
  const messages=await W.RCSData.request('history',{roomId:'alex'}).promise;
  assert.ok(messages.some(message=>message.id===original[2].event_id && message.text==='Corrected message'));
  assert.ok(!messages.some(message=>message.id===original[3].event_id || message.id==='edit'));
  assert.equal(messages.find(message=>message.id==='thread-reply').thread,true);assert.equal(env.scrollWrites,0);env.dom.window.close();
});
test('native navigation opens an unrendered conversation and jumps directly to a historical message',async t=>{
  const env=setup({compact:true});t.after(()=>env.dom.window.close());const {W,api}=env;
  const open=await W.RCSData.request('open',{roomId:'river'}).promise;assert.equal(open.route,'/room/river');assert.equal(api.active.id,'river');
  const jump=await W.RCSData.request('jump',{roomId:'alex',eventId:'alex-remote-0'}).promise;
  assert.equal(jump.route,'/room/alex/event/alex-remote-0');assert.equal(api.active.id,'alex');
  assert.ok(W.RCSAdapter.messages(api.room).some(message=>message.id==='alex-remote-0'));
  assert.equal(env.scrollWrites,0);env.dom.window.close();
});
test('message navigation uses the native exact-event loader before routing and preserves thread routes',async t=>{
  const env=setup({compact:true});t.after(()=>env.dom.window.close());const {W,api}=env;
  const client=api.app.querySelector('rs-matrix-client').client,steps=[];
  const nativeNavigate=api.app.querySelector('rs-history').navigate;
  api.app.querySelector('rs-history').navigate=async route=>{steps.push(['route',route]);return nativeNavigate(route);};
  client.fetchRoomEvent=async(roomId,eventId)=>{steps.push(['load',roomId,eventId]);assert.equal(env.scrollWrites,0);return {event_id:eventId};};
  const progress=[];
  const result=await W.RCSData.request('jump',{roomId:'alex',eventId:'alex-remote-0',thread:true},value=>progress.push(value.label)).promise;
  assert.deepEqual(steps,[['load','alex','alex-remote-0'],['route','/room/alex/event/alex-remote-0/thread']]);
  assert.equal(result.route,'/room/alex/event/alex-remote-0/thread');assert.deepEqual(progress,['Opening message…']);assert.equal(env.scrollWrites,0);
});
test('temporary local message IDs never reach the native exact-event endpoint or router',async t=>{
  const env=setup();t.after(()=>env.dom.window.close());const {W,api}=env,client=api.app.querySelector('rs-matrix-client').client;
  client.fetchRoomEvent=()=>assert.fail('temporary ID sent to server');api.app.querySelector('rs-history').navigate=()=>assert.fail('temporary ID routed');
  await assert.rejects(W.RCSData.request('jump',{roomId:'alex',eventId:'~alex:m123'}).promise,/temporary Reddit message ID/);assert.equal(api.calls.length,0);
});
test('saved-result navigation proceeds while initial sync and native cache import are still pending',async t=>{
  const env=setup({compact:true});t.after(()=>env.dom.window.close());const {W,api}=env;
  const client=api.app.querySelector('rs-matrix-client').client;
  client.isInitialSyncComplete=()=>false;
  client.syncApi={savedSyncPromise:new Promise(()=>{})};
  let loaded=0;client.fetchRoomEvent=async()=>{loaded++;};
  const directory=W.RCSData.request('conversations');const directoryResult=directory.promise.catch(error=>error.message);
  const navigation=W.RCSData.request('jump',{roomId:'alex',eventId:'alex-remote-0'});
  const result=await Promise.race([navigation.promise,new Promise((_,reject)=>setTimeout(()=>reject(Error('Navigation waited for bulk startup work')),150))]);
  assert.equal(result.route,'/room/alex/event/alex-remote-0');assert.equal(loaded,1);
  assert.equal(api.calls.some(call=>call.method==='rooms'),false,'directory must still wait for verified startup readiness');
  assert.equal(env.scrollWrites,0);directory.cancel();assert.equal(await directoryResult,'Search cancelled');
});
test('navigation still waits for an authenticated client and a callable native router',async t=>{
  const env=setup();t.after(()=>env.dom.window.close());const {W,api}=env;
  const client=api.app.querySelector('rs-matrix-client').client,router=api.app.querySelector('rs-history');
  const authed=client.http.authedRequest,navigate=router.navigate;let routes=0;
  client.http.authedRequest=null;router.navigate=null;client.isInitialSyncComplete=()=>false;
  const task=W.RCSData.request('open',{roomId:'river'});await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal(api.active.id,'alex');client.http.authedRequest=authed;
  await tick();assert.equal(api.active.id,'alex','authentication alone must not bypass router readiness');
  router.navigate=async route=>{routes++;return navigate(route);};
  const result=await task.promise;assert.equal(result.route,'/room/river');assert.equal(routes,1);assert.equal(env.scrollWrites,0);
});
test('an event already loaded in Reddit navigates without another exact-event request',async t=>{
  const env=setup();t.after(()=>env.dom.window.close());const {W,api}=env;
  const client=api.app.querySelector('rs-matrix-client').client,room=client.getRoom('alex');
  room.findEventById=id=>id==='alex-remote-0'?{getId:()=>id}:undefined;
  const getRoom=client.getRoom;client.getRoom=id=>id==='alex'?room:getRoom(id);
  let loads=0;client.fetchRoomEvent=async()=>{loads++;throw Error('Unnecessary request');};
  client.syncApi={savedSyncPromise:new Promise(()=>{})};
  const result=await Promise.race([W.RCSData.request('jump',{roomId:'alex',eventId:'alex-remote-0',thread:true}).promise,new Promise((_,reject)=>setTimeout(()=>reject(Error('Navigation waited for saved cache pages')),150))]);
  assert.equal(result.route,'/room/alex/event/alex-remote-0/thread');assert.equal(loads,0);assert.equal(env.scrollWrites,0);
});
test('uncached exact events use the interactive request slot while directory discovery is in flight',async t=>{
  const env=setup();t.after(()=>env.dom.window.close());const {W,api}=env;
  const client=api.app.querySelector('rs-matrix-client').client;let finishDirectory,loading=false;
  client.getRoomList=()=>new Promise(resolve=>{finishDirectory=resolve;});
  client.fetchRoomEvent=async()=>{loading=true;};
  const priorities=[];
  W.chrome={runtime:{sendMessage:async value=>{
    if(value.action==='traffic-acquire'){priorities.push(value.priority);return {ok:true,token:value.priority};}
    return {ok:true};
  }}};
  const directory=W.RCSData.request('conversations');const directoryResult=directory.promise.catch(error=>error.message);
  await new Promise(resolve=>setTimeout(resolve,30));assert.ok(finishDirectory);
  const result=await W.RCSData.request('jump',{roomId:'alex',eventId:'missing-from-native-cache'}).promise;
  assert.equal(result.route,'/room/alex/event/missing-from-native-cache');assert.equal(loading,true);
  assert.deepEqual(priorities,['background','interactive']);assert.equal(env.scrollWrites,0);
  directory.cancel();finishDirectory({rooms:[]});assert.equal(await directoryResult,'Search cancelled');
  await new Promise(resolve=>setTimeout(resolve,30));
});
test('unavailable exact events fail visibly without navigating to a false successful jump',async t=>{
  const env=setup();t.after(()=>env.dom.window.close());const {W,api}=env;
  const client=api.app.querySelector('rs-matrix-client').client;
  client.fetchRoomEvent=async()=>{const error=Error('gone');error.httpStatus=404;throw error;};
  let routes=0;api.app.querySelector('rs-history').navigate=async()=>{routes++;};
  await assert.rejects(W.RCSData.request('jump',{roomId:'alex',eventId:'removed'}).promise,/Unable to load selected message \(HTTP 404\)/);
  assert.equal(routes,0);assert.equal(env.scrollWrites,0);
});
test('cold saved-room navigation leaves native routing able to initialize an uncached room',async t=>{
  const env=setup();t.after(()=>env.dom.window.close());const {W,api}=env;
  const client=api.app.querySelector('rs-matrix-client').client;
  assert.equal(client.getRoom('oldfriend'),null);
  let loads=0;client.fetchRoomEvent=async()=>{loads++;throw Error('Room not found');};
  const result=await W.RCSData.request('jump',{roomId:'oldfriend',eventId:'saved-event'}).promise;
  assert.equal(result.route,'/room/oldfriend/event/saved-event');assert.equal(api.active.id,'oldfriend');assert.equal(loads,0);assert.equal(env.scrollWrites,0);
});
test('search UI uses full API data, displays avatars, and opens an offscreen conversation',async t=>{
  const env=setup({content:true});t.after(()=>env.dom.window.close());const {W,api}=env;await tick();
  const control=W.RCSAdapter.query('[data-rcs-ui="list"]',api.nav).shadowRoot;const input=control.querySelector('input');
  input.value='river';input.dispatchEvent(new W.Event('input'));assert.equal(control.querySelectorAll('.result').length,1);assert.ok(control.querySelector('.result img'));
  control.querySelector('.result').click();await tick();assert.equal(api.active.id,'river');assert.equal(env.scrollWrites,0);env.dom.window.close();
});
test('cancel stops further pagination after the in-flight request; unsupported pagination never reports complete',async t=>{
  const env=setup();t.after(()=>env.dom.window.close());const {W,api}=env;let release;let count=0;
  api.app.querySelector('rs-matrix-client').client.http.authedRequest=()=>{count++;return new Promise(resolve=>release=resolve);};
  const task=W.RCSData.request('history',{roomId:'alex'});const caught=task.promise.catch(error=>error.message);await tick();task.cancel();
  assert.equal(await caught,'Search cancelled');release({events:[{event_id:'x',seq_id:'100',type:'m.room.message',content:{body:'Hi'}}]});await tick();assert.equal(count,1);
  api.app.querySelector('rs-matrix-client').client.getRoomList=async()=>({rooms:null});
  await assert.rejects(W.RCSData.request('conversations').promise,/incomplete/);env.dom.window.close();
});
test('directory loading waits for Reddit authentication and initial sync to complete',async t=>{
  const env=setup();t.after(()=>env.dom.window.close());const {W,api}=env;let connected=false;
  api.app.querySelector('rs-matrix-client').client.isInitialSyncComplete=()=>connected;
  const task=W.RCSData.request('conversations');await new Promise(resolve=>setTimeout(resolve,50));
  assert.equal(api.calls.length,0);connected=true;const rooms=await task.promise;
  assert.equal(rooms.length,7);assert.equal(api.calls[0].method,'rooms');env.dom.window.close();
});
test('old DM absent from initial sync, cached model, and DOM is searchable and opens without scrolling',async t=>{
  const env=setup({content:true,compact:true});t.after(()=>env.dom.window.close());const {W,api}=env;const client=api.app.querySelector('rs-matrix-client').client;
  assert.equal(client.getRoom('oldfriend'),null);
  await tick();
  const control=W.RCSAdapter.query('[data-rcs-ui="list"]',api.nav).shadowRoot;const input=control.querySelector('input');
  input.value='u/old_friend';input.dispatchEvent(new W.Event('input'));
  assert.equal(control.querySelectorAll('.result').length,1);assert.equal(control.querySelector('.name').textContent,'old_friend');assert.ok(control.querySelector('img'));
  assert.equal(client.getRoom('oldfriend'),null);assert.equal(env.scrollWrites,0);
  assert.ok(api.calls.some(call=>call.method==='rooms' && call.options.page_size===200));
  control.querySelector('.result').click();await tick();assert.equal(api.active.id,'oldfriend');
  assert.ok(api.calls.some(call=>call.method==='cache-room' && call.roomId==='oldfriend'));assert.equal(env.scrollWrites,0);
  env.dom.window.close();
});
test('native cache pages complete before the directory model is read',async t=>{
  const env=setup();t.after(()=>env.dom.window.close());const {W,api}=env;const client=api.app.querySelector('rs-matrix-client').client;let finish;
  client.syncApi={savedSyncPromise:new Promise(resolve=>finish=resolve)};
  const task=W.RCSData.request('conversations');await new Promise(resolve=>setTimeout(resolve,50));assert.equal(api.calls.length,0);
  finish();const records=await task.promise;assert.ok(records.some(record=>record.name==='old_friend'));assert.equal(env.scrollWrites,0);env.dom.window.close();
});
test('canonical username aliases match even when the profile display name differs',async t=>{
  const env=setup();t.after(()=>env.dom.window.close());const {W,api}=env;const row=W.RCSAdapter.query(W.RCSAdapter.selectors.row,api.nav);const users=row.users;const original=users.getRedditUserById;
  users.getRedditUserById=async id=>id==='t2_oldfriend'?{displayName:'Old friend',name:'old_friend',prefixedName:'u/old_friend',avatar:{src:'https://www.redditstatic.com/avatars/defaults/v2/avatar_default_1.png'}}:original(id);
  W.eval(code('extension/date-picker.js'));W.eval(code('extension/content.js'));await tick();
  const control=W.RCSAdapter.query('[data-rcs-ui="list"]',api.nav).shadowRoot;const input=control.querySelector('input');input.value='u/old_friend';input.dispatchEvent(new W.Event('input'));assert.equal(control.querySelectorAll('.result').length,1);
  assert.equal(env.scrollWrites,0);env.dom.window.close();
});
function deletedProfile(env,id='t2_alex') {
  const users=env.W.RCSAdapter.query(env.W.RCSAdapter.selectors.row,env.api.nav).users;
  const original=users.getRedditUserById;
  users.getRedditUserById=async value=>value===id?{displayName:'[deleted]',isDeleted:true}:original(value);
}
function formerMember({sender='@t2_alex:reddit.com',relation='Odd-Ratio-3098',displayname='Odd-Ratio-3098'}={}) {
  return {type:'m.room.member',state_key:'@t2_alex:reddit.com',sender,origin_server_ts:1764751203643,content:{displayname,membership:'join'},unsigned:{'m.relations':{'com.reddit.profile':{username:relation,icon_url:'https://www.redditstatic.com/avatars/defaults/v2/avatar_default_6.png'}}}};
}
test('retained member profile names and icons survive a deleted live profile and DOM refresh',async t=>{
  const env=setup();t.after(()=>env.dom.window.close());const {W,api}=env;deletedProfile(env);
  const client=api.app.querySelector('rs-matrix-client').client;const original=client.getRoomList;
  client.getRoomList=async options=>{
    const data=await original(options);data.rooms.find(room=>room.room_id==='alex').state.push(formerMember({displayname:'[deleted]'}));return data;
  };
  W.RCSAdapter.query(W.RCSAdapter.selectors.row,api.nav).shadowRoot.querySelector('.room-name').textContent='[deleted]';
  W.eval(code('extension/date-picker.js'));W.eval(code('extension/content.js'));await tick();
  const control=W.RCSAdapter.query('[data-rcs-ui="list"]',api.nav).shadowRoot;const input=control.querySelector('input');
  input.value='odd-ratio';input.dispatchEvent(new W.Event('input'));
  assert.equal(control.querySelector('.name').textContent,'Odd-Ratio-3098');assert.match(control.querySelector('.time').textContent,/Unavailable account/);
  assert.match(control.querySelector('img').src,/avatar_default_6/);
  // Native DOM changes must not replace the recovered name with [deleted].
  W.RCSAdapter.query(W.RCSAdapter.selectors.row,api.nav).setAttribute('selected','');await tick();
  assert.equal(control.querySelector('.name').textContent,'Odd-Ratio-3098');
  assert.equal(api.calls.filter(call=>call.params?.peek==='y').length,0);assert.equal(env.scrollWrites,0);env.dom.window.close();
});
test('missing retained identities use one small state read and reuse it on refresh',async t=>{
  const env=setup();t.after(()=>env.dom.window.close());const {W,api}=env;deletedProfile(env,'t2_oldfriend');
  const client=api.app.querySelector('rs-matrix-client').client;const original=client.http.authedRequest;
  const getRooms=client.getRoomList;client.getRoomList=async options=>{const data=await getRooms(options);const room=data.rooms.find(room=>room.room_id==='oldfriend');if(room)room.state=room.state.filter(event=>event.type!=='m.room.member');return data;};
  client.http.authedRequest=async(method,path,params)=>{
    if(path==='/rooms/oldfriend/members'){api.calls.push({method,path,params});return {chunk:[]};}
    if(path==='/rooms/oldfriend/events' && params?.before===1) {
      api.calls.push({method,path,params});return {events:[],state:[{...formerMember(),state_key:'@t2_oldfriend:reddit.com',sender:'@t2_oldfriend:reddit.com'}]};
    }
    return original(method,path,params);
  };
  let records=await W.RCSData.request('conversations').promise;assert.equal(records.find(record=>record.id==='oldfriend').name,'Odd-Ratio-3098');
  records=await W.RCSData.request('conversations').promise;assert.equal(records.find(record=>record.id==='oldfriend').name,'Odd-Ratio-3098');
  const reads=api.calls.filter(call=>call.path==='/rooms/oldfriend/events' && call.params?.before===1);assert.equal(reads.length,1);assert.equal(reads[0].params.before,1);assert.equal(reads[0].params.include,'timeline,state');assert.equal(reads[0].params.peek,undefined);
  assert.equal(env.scrollWrites,0);env.dom.window.close();
});
test('history reuses state supplied with message pages to resolve deleted message authors',async t=>{
  const env=setup();t.after(()=>env.dom.window.close());const {W,api}=env;deletedProfile(env);
  const client=api.app.querySelector('rs-matrix-client').client;const original=client.http.authedRequest;
  client.http.authedRequest=async(method,path,params)=>{
    const data=await original(method,path,params);if(path==='/rooms/alex/events')data.state=[formerMember()];return data;
  };
  const messages=await W.RCSData.request('history',{roomId:'alex'}).promise;
  const message=messages.find(message=>message.sender==='@t2_alex:reddit.com');assert.equal(message.author,'Odd-Ratio-3098');assert.equal(message.authorHistorical,true);
  const index=new W.RCSCore.MessageIndex(Infinity);index.upsert('alex',messages);index.upsert('alex',[{...message,author:'[deleted]',authorHistorical:undefined}]);
  assert.equal(index.search('alex','')[messages.findIndex(value=>value.id===message.id)].author,'Odd-Ratio-3098');
  assert.equal(api.calls.some(call=>call.params?.peek==='y'),false);assert.equal(env.scrollWrites,0);env.dom.window.close();
});
test('a profile relation for a different sender cannot replace the target member identity',async t=>{
  const env=setup();t.after(()=>env.dom.window.close());const {W,api}=env;deletedProfile(env);
  const client=api.app.querySelector('rs-matrix-client').client;const original=client.getRoomList;
  client.getRoomList=async options=>{const data=await original(options);data.rooms.find(room=>room.room_id==='alex').state.push(formerMember({sender:'@t2_me:reddit.com',relation:'DifferentSender',displayname:'Odd-Ratio-3098'}));return data;};
  const records=await W.RCSData.request('conversations').promise;const target=records.find(record=>record.id==='alex');assert.equal(target.name,'Odd-Ratio-3098');assert.ok(!target.aliases.includes('DifferentSender'));
  env.dom.window.close();
});
test('deleted identities are recovered from membership metadata without peeking or loading message pages',async t=>{
  const env=setup();t.after(()=>env.dom.window.close());const {W,api}=env;deletedProfile(env,'t2_oldfriend');
  const client=api.app.querySelector('rs-matrix-client').client,rooms=client.getRoomList,read=client.http.authedRequest;
  client.getRoomList=async options=>{const data=await rooms(options);const room=data.rooms.find(r=>r.room_id==='oldfriend');if(room)room.state=room.state.filter(e=>e.type!=='m.room.member');return data;};
  client.http.authedRequest=async(method,path,params)=>{
    if(path==='/rooms/oldfriend/members'){api.calls.push({method,path,params});return {chunk:[{...formerMember(),state_key:'@t2_oldfriend:reddit.com',sender:'@t2_oldfriend:reddit.com'}]};}
    return read(method,path,params);
  };
  const records=await W.RCSData.request('conversations').promise;assert.equal(records.find(r=>r.id==='oldfriend').name,'Odd-Ratio-3098');
  assert.equal(api.calls.filter(c=>c.path==='/rooms/oldfriend/members').length,1);assert.equal(api.calls.some(c=>c.path==='/rooms/oldfriend/events'),false);
});
test('native unread counts are local metadata and receipt changes do not issue requests',async t=>{
  const {dom,W,api}=setup();t.after(()=>dom.window.close());
  const client=api.app.querySelector('rs-matrix-client').client,rooms=client.getRooms,handlers=new Map();
  let count=3;client.getRooms=()=>rooms().map(room=>({...room,getUnreadNotificationCount:()=>room.roomId==='alex'?count:0}));
  client.on=(name,handler)=>handlers.set(name,handler);client.off=()=>{};
  const context=await W.RCSData.request('directory-context').promise;
  assert.equal(context.roomMeta.alex.unreadCount,3);assert.equal(context.roomMeta.jules.unreadCount,0);
  const calls=api.calls.length;let received;
  W.document.addEventListener('rcs-conversation-activity',event=>received=JSON.parse(event.detail));
  count=0;handlers.get('Room.receipt')?.({roomId:'alex'});
  assert.equal(received.owner,context.owner);assert.equal(received.roomMeta.alex.unreadCount,0);assert.equal(api.calls.length,calls);
});
