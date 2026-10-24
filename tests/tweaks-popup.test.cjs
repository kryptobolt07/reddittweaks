const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');

const html=fs.readFileSync(path.join(__dirname,'../extension/popup.html'),'utf8');
const script=fs.readFileSync(path.join(__dirname,'../extension/popup.js'),'utf8');
const settle=()=>new Promise(resolve=>setTimeout(resolve,0));

function popup(t,{settings,storageFailure=false,runtimeFailure=false}={}){
  const dom=new JSDOM(html,{runScripts:'outside-only'}),w=dom.window;t.after(()=>w.close());
  const messages=[],state={...(settings||{})};
  w.chrome={storage:{local:{
    async get(key){if(storageFailure)throw Error('storage read failed');return {[key]:state[key]};},
    async set(values){if(storageFailure)throw Error('storage write failed');Object.assign(state,values);}
  }},runtime:{async sendMessage(request){messages.push(request);if(runtimeFailure)throw Error('runtime failed');return request.action==='stats'?{ok:true,stats:{messages:42,rooms:3,approxBytes:2048}}:{ok:true};}}};
  w.eval(script);
  return {w,state,messages};
}

test('Reddit Tweaks popup loads defaults and persists individual changes while preserving other settings',async t=>{
  const p=popup(t);await settle();
  const post=p.w.document.querySelector('#post-discovery'),archive=p.w.document.querySelector('#archive-discovery');
  assert.equal(post.checked,true);assert.equal(archive.checked,false);
  archive.checked=true;archive.dispatchEvent(new p.w.Event('change'));
  await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(p.state['rt-settings-v1'])),{postDiscovery:true,archiveDiscovery:true});
  post.checked=false;post.dispatchEvent(new p.w.Event('change'));
  await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(p.state['rt-settings-v1'])),{postDiscovery:false,archiveDiscovery:true});
  assert.equal(p.w.document.querySelector('#settings-status').textContent,'Settings saved automatically.');
});

test('Reddit Tweaks popup reports settings storage failures and restores the failed toggle',async t=>{
  const p=popup(t,{storageFailure:true});await settle();
  const control=p.w.document.querySelector('#post-discovery');
  assert.equal(control.disabled,true);assert.match(p.w.document.querySelector('#settings-status').textContent,/Could not load settings/);
  assert.equal(p.w.document.querySelector('#settings-status').classList.contains('error'),true);
});

test('popup keeps chat stats and both cache clear actions available',async t=>{
  const p=popup(t);await settle();
  assert.match(p.w.document.querySelector('#message-stats').textContent,/42 saved messages.*3 chats/);
  assert.match(p.w.document.querySelector('.cache-info').textContent,/scoped to your Reddit account/);
  await p.w.document.querySelector('#clear-messages').click();await settle();
  await p.w.document.querySelector('#clear-cache').click();await settle();
  assert.ok(p.messages.some(message=>message.scope==='rcs-messages'&&message.action==='clear'));
  assert.ok(p.messages.some(message=>message.scope==='rcs-directory'&&message.action==='clear'));
  assert.match(p.w.document.querySelector('#cache-status').textContent,/Saved usernames cleared/);
});

test('a failed settings write restores the switch and leaves it retryable',async t=>{
  const p=popup(t);await settle();
  p.w.chrome.storage.local.set=async()=>{throw Error('write failed');};
  const control=p.w.document.querySelector('#archive-discovery');control.checked=true;control.dispatchEvent(new p.w.Event('change'));await settle();
  assert.equal(control.checked,false);assert.equal(control.disabled,false);assert.match(p.w.document.querySelector('#settings-status').textContent,/Could not save/);
});
