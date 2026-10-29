const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {JSDOM}=require('jsdom');
const source=file=>readFileSync(join(__dirname,'..',file),'utf8');
const alex='@t2_alex:reddit.com',liveAvatar='https://example.invalid/live-alex.png',defaultAvatar='https://example.invalid/default-deleted.png';
// A DM partner whose account was alive when the extension saved them and is deleted now.
// Reddit scrubbed the member events, so the saved identity is the only copy of the name.
function setup(t,{compact=false,saved={}}={}) {
  const dom=new JSDOM('<!doctype html><body></body>',{url:'https://www.reddit.com/chat/',runScripts:'outside-only',pretendToBeVisual:true});
  t.after(()=>dom.window.close());const W=dom.window;W.matchMedia=()=>({matches:true});
  for(const file of ['demo/fixture.js','extension/directory-model.js','extension/search-core.js','extension/adapter.js','extension/history-store.js','extension/native-identities.js','extension/page-bridge.js','extension/data-client.js','extension/native-labels.js'])W.eval(source(file));
  const api=W.ChatFixture.build(W.document.body,{compact}),A=W.RCSAdapter;
  const row=A.query('rs-rooms-nav-room',api.nav),users=row.users,getProfile=users.getRedditUserById;
  users.getRedditUserById=async id=>id==='t2_alex'?{isDeleted:true,name:'[deleted]',displayName:'[deleted]',avatar:{src:defaultAvatar}}:getProfile(id);
  const client=api.app.querySelector('rs-matrix-client').client,getRooms=client.getRoomList;
  // Reddit scrubs the deleted account's member names, so the room state offers nothing to recover from.
  client.getRoomList=async options=>{const data=await getRooms(options);for(const room of data.rooms)room.state=(room.state||[]).filter(event=>!(event.type==='m.room.member' && event.state_key===alex));return data;};
  users.getAvatar=()=>({src:defaultAvatar});
  A.query('.room-name',row).textContent='[deleted]';A.query('a',row).setAttribute('aria-label','Direct chat with [deleted]');
  A.query('header .name',api.room).textContent='[deleted]';
  for(const message of A.messages(api.room))if(message.element.event.getSender()===alex)A.query('.user-name',message.element).textContent='[deleted]';
  const identity={id:alex,name:'Odd-Ratio-3098',avatar:liveAvatar,historicalName:false,accountUnavailable:false,availabilityKnown:true,verifiedAt:1000,observedAt:1000,provenance:'native-profile',...saved};
  return {W,api,A,row,client,identity,owner:client.getUserId(),prime:identities=>W.RCSData.request('prime-directory',{owner:client.getUserId(),records:[{id:'alex',type:'direct',participantIds:[alex]}],identities}).promise};
}
const alexRecord=records=>records.find(record=>record.id==='alex');
for(const compact of [false,true]) {
  test(`a live identity saved before deletion is shown with its retained name and avatar (${compact?'floating/minimized':'full-screen'})`,async t=>{
    const {W,api,A,row,identity,prime}=setup(t,{compact});await prime([identity]);
    const records=await W.RCSData.request('conversations',{refreshProfiles:true}).promise,record=alexRecord(records);
    assert.equal(record.name,'Odd-Ratio-3098');assert.equal(record.avatar,liveAvatar);
    assert.equal(record.accountUnavailable,true);assert.equal(record.historicalName,true);
    const saved=record.identities.find(person=>person.id===alex);
    assert.equal(saved.name,'Odd-Ratio-3098');assert.equal(saved.avatar,liveAvatar,'Reddit\'s default avatar does not replace the retained one');
    // The shared model publishes it as a person for native-identities / native-labels.
    const entry=W.RCSDirectoryModel.normalise({conversations:records,identities:{[alex]:saved},directoryComplete:true},'@t2_me:reddit.com');
    const people=Object.values(entry.identities).filter(person=>person.accountUnavailable && person.historicalName);
    assert.equal(people.length,1);assert.equal(people[0].avatar,liveAvatar);
    const directory=new Map(records.map(item=>[item.id,item]));
    await W.RCSNativeLabels.update(directory,new W.RCSCore.MessageIndex(Infinity));
    assert.equal(A.text(A.query('.room-name',row)),'Odd-Ratio-3098');
    assert.equal(A.text(A.query('header .name',api.room)),'Odd-Ratio-3098');
    const author=A.messages(api.room).find(message=>message.element.event.getSender()===alex);
    assert.equal(A.text(A.query('.user-name',author.element)),'Odd-Ratio-3098');
    assert.equal(row.users.getAvatar(alex).src,liveAvatar);
  });
}
test('a newer retained real name still wins over an older saved one',async t=>{
  const {W,prime,identity}=setup(t);
  await prime([{...identity,name:'Old_Name',observedAt:500,verifiedAt:500}]);
  // A later retained entry (for example from a member event) for the same account is newer.
  await prime([{...identity,name:'Newer_Name',avatar:'https://example.invalid/newer.png',historicalName:true,provenance:'retained-member',observedAt:2000}]);
  let record=alexRecord(await W.RCSData.request('conversations',{refreshProfiles:true}).promise);
  assert.equal(record.name,'Newer_Name');assert.equal(record.avatar,'https://example.invalid/newer.png');
  // Re-priming an older saved identity must not override the newer retained entry.
  await prime([{...identity,name:'Old_Name',observedAt:500,verifiedAt:500}]);
  record=alexRecord(await W.RCSData.request('conversations',{refreshProfiles:true}).promise);
  assert.equal(record.name,'Newer_Name');
});
test('placeholder names are never seeded as retained identities',async t=>{
  const {W,prime,identity}=setup(t);
  await prime([{...identity,name:'Someone'}]);
  const record=alexRecord(await W.RCSData.request('conversations',{refreshProfiles:true}).promise);
  assert.notEqual(record.name,'Someone');
});
test('directory merge keeps a retained avatar over the deleted-account default, but a newer real name keeps its own',t=>{
  const dom=new JSDOM('',{runScripts:'outside-only'});t.after(()=>dom.window.close());dom.window.eval(source('extension/directory-model.js'));
  const M=dom.window.RCSDirectoryModel,live={id:alex,name:'Odd-Ratio-3098',avatar:liveAvatar,verifiedAt:1000,availabilityKnown:true};
  const deleted={id:alex,name:'[deleted]',avatar:defaultAvatar,accountUnavailable:true,availabilityKnown:true,verifiedAt:5000};
  const merged=M.mergeIdentity(M.identity(live),M.identity(deleted));
  assert.equal(merged.name,'Odd-Ratio-3098');assert.equal(merged.avatar,liveAvatar);assert.equal(merged.accountUnavailable,true);assert.equal(merged.historicalName,true);
  // Order of arguments does not matter: the newer record decides.
  assert.equal(M.mergeIdentity(M.identity(deleted),M.identity(live)).avatar,liveAvatar);
  // A live account whose avatar changed keeps the new avatar.
  assert.equal(M.mergeIdentity(M.identity(live),M.identity({...live,avatar:'https://example.invalid/changed.png',verifiedAt:6000})).avatar,'https://example.invalid/changed.png');
  // A newer retained record with a real name keeps its own avatar.
  const retained={id:alex,name:'Newer_Name',avatar:'https://example.invalid/newer.png',accountUnavailable:true,historicalName:true,observedAt:9000};
  const winner=M.mergeIdentity(M.identity(live),M.identity(retained));
  assert.equal(winner.name,'Newer_Name');assert.equal(winner.avatar,'https://example.invalid/newer.png');
});
