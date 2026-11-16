const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {JSDOM}=require('jsdom');
const source=file=>readFileSync(join(__dirname,'..',file),'utf8');
function setup(t,{compact=false}={}) {
  const dom=new JSDOM('<!doctype html><body></body>',{url:'https://www.reddit.com/chat/',runScripts:'outside-only',pretendToBeVisual:true});
  t.after(()=>dom.window.close());const W=dom.window;W.matchMedia=()=>({matches:true});
  for(const file of ['demo/fixture.js','extension/directory-model.js','extension/search-core.js','extension/adapter.js','extension/history-store.js','extension/native-identities.js','extension/page-bridge.js','extension/data-client.js','extension/native-labels.js'])W.eval(source(file));
  const api=W.ChatFixture.build(W.document.body,{compact}),A=W.RCSAdapter;
  const row=A.query('rs-rooms-nav-room',api.nav),users=row.users,getProfile=users.getRedditUserById;
  users.getRedditUserById=async id=>id==='t2_alex'?{isDeleted:true,name:'[deleted]'}:getProfile(id);
  const client=api.app.querySelector('rs-matrix-client').client,getRooms=client.getRoomList;
  client.getRoomList=async options=>{const data=await getRooms(options);const alex=data.rooms.find(room=>room.room_id==='alex');if(alex)alex.state.push({type:'m.room.member',state_key:'@t2_alex:reddit.com',sender:'@t2_alex:reddit.com',origin_server_ts:123,content:{displayname:'Odd-Ratio-3098',membership:'join',avatar_url:'https://example.invalid/retained-avatar.png'}});return data;};
  A.query('.room-name',row).textContent='[deleted]';A.query('a',row).setAttribute('aria-label','Direct chat with [deleted]');
  A.query('header .name',api.room).textContent='[deleted]';
  for(const message of A.messages(api.room))if(message.element.event.getSender()==='@t2_alex:reddit.com')A.query('.user-name',message.element).textContent='[deleted]';
  return {W,api,A,row,client};
}
test('retained names and unavailable status appear in native rows, headers, and identity-bound authors',async t=>{
  const {W,api,A,row}=setup(t);const records=await W.RCSData.request('conversations').promise;
  const directory=new Map(records.map(r=>[r.id,r])),index=new W.RCSCore.MessageIndex(Infinity);
  const body=A.query('.room-message-text',A.messages(api.room)[0].element),before=body.textContent;
  const calls=api.calls.length;
  await W.RCSNativeLabels.update(directory,index);
  assert.equal(A.text(A.query('.room-name',row)),'Odd-Ratio-3098');
  // An icon with an accessible label, not a word; unclassified accounts keep the generic "unavailable" glyph.
  const badge=A.query('[data-rcs-ui="identity-status"]',row);
  assert.equal(badge.textContent.trim(),'');assert.equal(badge.getAttribute('aria-label'),'Unavailable account');assert.equal(badge.title,'Unavailable account · Retained username');assert.ok(badge.querySelector('svg'));
  assert.equal(A.query('a',row).getAttribute('aria-label'),'Direct chat with Odd-Ratio-3098');
  assert.equal(A.text(A.query('header .name',api.room)),'Odd-Ratio-3098');
  assert.equal(A.messages(api.room)[0].author,'Odd-Ratio-3098');
  assert.equal(A.messages(api.room)[1].author,'You');assert.equal(body.textContent,before);
  assert.equal(api.calls.length,calls,'presentation makes no additional data requests');
  await W.RCSNativeLabels.update(directory,index);
  assert.equal(A.queryAll('[data-rcs-ui="identity-status"]',row).length,1);
});
test('recycled native rows do not retain another account’s recovered name or status',async t=>{
  const {W,api,A,row}=setup(t);const records=await W.RCSData.request('conversations').promise;
  const directory=new Map(records.map(r=>[r.id,r])),index=new W.RCSCore.MessageIndex(Infinity);
  await W.RCSNativeLabels.update(directory,index);
  row.setAttribute('room','jules');A.query('.room-name',row).textContent='jules_designs';
  A.query('a',row).setAttribute('aria-label','Direct chat with jules_designs');
  api.select('jules');await W.RCSNativeLabels.update(directory,index);
  assert.equal(A.text(A.query('.room-name',row)),'jules_designs');assert.equal(A.query('[data-rcs-ui="identity-status"]',row),null);
  assert.equal(A.text(A.query('header .name',api.room)),'jules_designs');
});
test('group titles stay unchanged while unavailable message authors can be labelled',async t=>{
  const {W,api,A,row}=setup(t,{compact:true});const records=await W.RCSData.request('conversations').promise;
  const alex=records.find(r=>r.id==='alex');alex.type='group';alex.name='Project group';alex.accountUnavailable=false;
  A.query('.room-name',row).textContent='Project group';A.query('header .name',api.room).textContent='Project group';
  await W.RCSNativeLabels.update(new Map(records.map(r=>[r.id,r])),new W.RCSCore.MessageIndex(Infinity));
  assert.equal(A.text(A.query('.room-name',row)),'Project group');assert.equal(A.text(A.query('header .name',api.room)),'Project group');
  assert.equal(A.messages(api.room)[0].author,'Odd-Ratio-3098');
});
test('clearing account presentation restores placeholders and removes badges without destroying native elements',async t=>{
  const {W,api,A,row}=setup(t);const records=await W.RCSData.request('conversations').promise;
  const link=A.query('a',row),author=A.query('.user-name',A.messages(api.room)[0].element);
  await W.RCSNativeLabels.update(new Map(records.map(r=>[r.id,r])),new W.RCSCore.MessageIndex(Infinity));
  W.RCSNativeLabels.clear();assert.equal(A.query('a',row),link);assert.equal(author.textContent,'[deleted]');
  assert.equal(A.text(A.query('.room-name',row)),'[deleted]');assert.equal(link.getAttribute('aria-label'),'Direct chat with [deleted]');
  assert.equal(A.query('[data-rcs-ui="identity-status"]',row),null);
});
test('deleted search matches retained names and deleted status while showing the recovered name',async t=>{
  const {W,api,A}=setup(t);W.eval(source('extension/date-picker.js'));W.eval(source('extension/content.js'));await new Promise(resolve=>setTimeout(resolve,300));
  const root=A.query('[data-rcs-ui="list"]',api.nav).shadowRoot,input=root.querySelector('input');
  for(const query of ['deleted','[deleted]','odd-ratio']) {
    input.value=query;input.dispatchEvent(new W.Event('input'));
    assert.equal(root.querySelectorAll('.result').length,1);assert.equal(root.querySelector('.name').textContent,'Odd-Ratio-3098');
  }
});
test('introduction and image-only authors are labelled without touching message content, in both chat layouts',async t=>{
  for(const compact of [false,true]) {
    const {W,api,A}=setup(t,{compact});
    const intro=W.document.createElement('rs-room-info');intro.innerHTML='<div class="font-semibold">[deleted]</div>';
    api.room.shadowRoot.querySelector('main').append(intro);
    const image=api.appendMessage('alex_morgan','',`image-${compact}`);
    A.query('.user-name',image).textContent='[deleted]';
    A.query('.room-message-text',image).innerHTML='<img alt="Attachment"><span>[deleted]</span>';
    // The attachment and arbitrary body text must not be renamed.
    const body=A.query('.room-message-text',image);const before=body.innerHTML;
    const records=await W.RCSData.request('conversations').promise;
    await W.RCSNativeLabels.update(new Map(records.map(r=>[r.id,r])),new W.RCSCore.MessageIndex(Infinity));
    assert.equal(A.text(A.query('.font-semibold',intro)),'Odd-Ratio-3098');
    assert.equal(A.text(A.query('.user-name',image)),'Odd-Ratio-3098');
    assert.equal(A.queryAll('[data-rcs-ui="identity-status"]',image).length,1);assert.equal(body.innerHTML,before);
    body.replaceChildren(body.querySelector('img'));
    A.query('.user-name',image).firstChild.data='[deleted]';
    await W.RCSNativeLabels.update(new Map(records.map(r=>[r.id,r])),new W.RCSCore.MessageIndex(Infinity));
    assert.equal(A.text(A.query('.user-name',image)),'Odd-Ratio-3098');
    assert.equal(A.messages(api.room).some(m=>m.element===image),false);
    W.RCSNativeLabels.clear();assert.equal(A.text(A.query('.font-semibold',intro)),'[deleted]');
  }
});
test('native presentation hooks drive subsequent renders while preserving profile flags, original objects, and group titles',async t=>{
  const {W,api,A,client,row}=setup(t);
  const profile={isDeleted:true,displayName:'[deleted]',id:'t2_alex'};
  const users=row.users;users.getRedditUser=()=>profile;users.getDisplayName=()=>profile.displayName;
  const roomController={roomId:'alex',getDirectRoomUsername(){return profile.isDeleted?'[deleted]':profile.displayName;}};
  row.roomController=roomController;let updates=0;row.requestUpdate=()=>updates++;
  const username=W.document.createElement('rs-username');username.setAttribute('user-id','@t2_alex:reddit.com');
  username.username='[deleted]';username.render=function(){return this.username;};api.room.shadowRoot.append(username);
  const original=users.getRedditUser,originalRender=username.render;
  const records=await W.RCSData.request('conversations').promise;
  const directory=new Map(records.map(r=>[r.id,r])),index=new W.RCSCore.MessageIndex(Infinity),calls=api.calls.length;
  await W.RCSNativeLabels.update(directory,index);
  assert.equal(users.getDisplayName('@t2_alex:reddit.com'),'Odd-Ratio-3098');
  const displayed=users.getRedditUser('@t2_alex:reddit.com');assert.equal(displayed.displayName,'Odd-Ratio-3098');
  assert.equal(displayed.isDeleted,true);assert.equal(profile.displayName,'[deleted]');
  assert.equal(users.getRedditUser('@t2_jules:reddit.com'),profile);
  assert.equal(roomController.getDirectRoomUsername(),'Odd-Ratio-3098');
  roomController.roomId='group';assert.equal(roomController.getDirectRoomUsername(),'[deleted]');
  assert.equal(username.render(),'Odd-Ratio-3098');assert.equal(username.username,'[deleted]');
  const after=updates;await W.RCSNativeLabels.update(directory,index);assert.equal(updates,after,'unchanged identities do not force another render');
  assert.equal(api.calls.length,calls);
  const getOwner=client.getUserId;client.getUserId=()=>'@t2_other:reddit.com';
  assert.equal(username.render(),'[deleted]','another account never inherits historical names');client.getUserId=getOwner;
  W.RCSNativeLabels.clear();assert.equal(users.getRedditUser,original);assert.equal(username.render,originalRender);
  assert.ok(updates>after,'clearing asks native hosts to render their original names');
});

test('retained avatars drive native room icons and profile presentation without modifying original objects or fetching profiles',async t=>{
  for(const compact of [false,true]){
    const {W,api,A,client,row}=setup(t,{compact}),users=row.users,originalAvatar={src:'https://example.invalid/deleted.png',isNSFW:true},profile={displayName:'[deleted]',isDeleted:true,avatar:originalAvatar,snoovatarIcon:{src:'https://example.invalid/deleted-snoovatar.png'}};
    let avatarReads=0;users.getAvatar=()=>{avatarReads++;return originalAvatar;};users.getRedditUser=()=>profile;
    const originalGetAvatar=users.getAvatar,originalGetProfile=users.getRedditUser;
    const roomIcon=W.document.createElement('rs-room-icon');roomIcon.users=users;row.shadowRoot.append(roomIcon);let updates=0;roomIcon.requestUpdate=()=>updates++;
    const records=await W.RCSData.request('conversations').promise,directory=new Map(records.map(record=>[record.id,record])),index=new W.RCSCore.MessageIndex(Infinity),calls=api.calls.length;
    assert.equal(directory.get('alex').avatar,'https://example.invalid/retained-avatar.png');await W.RCSNativeLabels.update(directory,index);
    assert.equal(users.getAvatar('@t2_alex:reddit.com').src,directory.get('alex').avatar);assert.equal(avatarReads,0,'known retained avatars bypass native cache misses');assert.equal(users.getAvatar('@t2_alex:reddit.com'),users.getAvatar('@t2_alex:reddit.com'),'native renders reuse the same avatar model');
    const displayed=users.getRedditUser('@t2_alex:reddit.com');assert.equal(displayed.avatar.src,directory.get('alex').avatar);assert.equal(displayed.isDeleted,true);assert.equal(displayed.avatar.isNSFW,true);assert.equal(displayed.snoovatarIcon,undefined);assert.equal(profile.avatar,originalAvatar);assert.equal(profile.snoovatarIcon.src,'https://example.invalid/deleted-snoovatar.png');
    assert.equal(users.getAvatar('@t2_jules:reddit.com'),originalAvatar);assert.equal(users.getRedditUser('@t2_jules:reddit.com'),profile);
    const before=updates;directory.get('alex').avatar='https://example.invalid/new-retained-avatar.png';for(const person of directory.get('alex').identities)if(person.id==='@t2_alex:reddit.com')person.avatar=directory.get('alex').avatar;
    await W.RCSNativeLabels.update(directory,index);assert.equal(users.getAvatar('@t2_alex:reddit.com').src,directory.get('alex').avatar);assert.ok(updates>before,'an avatar-only change repaints native hosts');
    await W.RCSNativeLabels.update(directory,index);const unchanged=updates;await W.RCSNativeLabels.update(directory,index);assert.equal(updates,unchanged);assert.equal(api.calls.length,calls);
    const getOwner=client.getUserId;client.getUserId=()=>'@t2_other:reddit.com';assert.equal(users.getAvatar('@t2_alex:reddit.com'),originalAvatar);client.getUserId=getOwner;
    W.RCSNativeLabels.clear();assert.equal(users.getAvatar,originalGetAvatar);assert.equal(users.getRedditUser,originalGetProfile);
  }
});

test('native user avatars receive retained images before first render and restore on recycling, account clear and unsafe URLs',async t=>{
  const {W,api,A,client,row}=setup(t),records=await W.RCSData.request('conversations').promise,directory=new Map(records.map(record=>[record.id,record])),index=new W.RCSCore.MessageIndex(Infinity);
  await W.RCSNativeLabels.update(directory,index);
  W.customElements.define('rs-user-avatar',class extends W.HTMLElement{
    constructor(){super();this.icon='https://example.invalid/placeholder.png';this.snoovatar='native-snoovatar';this.isNSFW=true;}
    connectedCallback(){this.first=this.render();}
    render(){return {icon:this.icon,snoovatar:this.snoovatar,isNSFW:this.isNSFW};}
  });
  const avatars=[];for(const scope of [row.shadowRoot,A.query('header',api.room),A.messages(api.room)[0].element.shadowRoot]){const avatar=W.document.createElement('rs-user-avatar');avatar.setAttribute('user-id','@t2_alex:reddit.com');avatar.setAttribute('room-id','alex');scope.append(avatar);avatars.push(avatar);assert.equal(avatar.first.icon,'https://example.invalid/retained-avatar.png');assert.equal(avatar.first.snoovatar,null);assert.equal(avatar.first.isNSFW,true);assert.equal(avatar.icon,'https://example.invalid/placeholder.png');}
  const avatar=avatars[0];avatar.setAttribute('user-id','@t2_jules:reddit.com');assert.equal(avatar.render().icon,avatar.icon);avatar.setAttribute('user-id','@t2_alex:reddit.com');avatar.isCommunityAgent=true;assert.equal(avatar.render().icon,avatar.icon);avatar.isCommunityAgent=false;
  for(const unsafe of ['javascript:alert(1)','https://example.invalid/avatar?access_token=secret','https://user:password@example.invalid/avatar']){W.RCSNativeIdentities.update({client,all:()=>avatars},{people:[{id:'@t2_alex:reddit.com',name:'Odd-Ratio-3098',avatar:unsafe}]});assert.equal(avatar.render().icon,avatar.icon);}
  await W.RCSNativeLabels.update(directory,index);assert.equal(avatar.render().icon,'https://example.invalid/retained-avatar.png');W.RCSNativeLabels.clear();for(const item of avatars)assert.equal(item.render().icon,item.icon);
});

test('identity SVG markers keep geometry but reject executable elements, events and URL paints',async t=>{
 const {W,api,A,row}=setup(t);W.RCSDirectoryModel={...W.RCSDirectoryModel,accountMarker:()=>({kind:'unavailable',label:'Unavailable account',title:'Retained',path:'<script>alert(1)</script><image href="https://evil.invalid/a"/><foreignObject><div>bad</div></foreignObject><path d="M1 2L3 4" onload="alert(1)" fill="url(https://evil.invalid/paint)"/>'})};const records=await W.RCSData.request('conversations').promise;await W.RCSNativeLabels.update(new Map(records.map(r=>[r.id,r])),new W.RCSCore.MessageIndex(Infinity));const badge=A.query('[data-rcs-ui="identity-status"]',row),svg=badge.querySelector('svg');assert.equal(svg.querySelector('script,image,foreignObject'),null);assert.equal(svg.querySelector('[onload],[href]'),null);assert.equal(svg.querySelector('path').getAttribute('d'),'M1 2L3 4');assert.equal(svg.querySelector('path').getAttribute('fill'),null);assert.equal(badge.getAttribute('aria-label'),'Unavailable account');
});
