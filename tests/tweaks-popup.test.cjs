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
  const post=p.w.document.querySelector('#post-discovery'),archive=p.w.document.querySelector('#archive-discovery'),restore=p.w.document.querySelector('#restore-deleted-content');
  assert.equal(post.checked,true);assert.equal(archive.checked,false);assert.equal(restore.checked,true);
  archive.checked=true;archive.dispatchEvent(new p.w.Event('change'));
  await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(p.state['rt-settings-v1'])),{postDiscovery:true,archiveDiscovery:true,restoreDeletedContent:true,subredditArchive:false,subredditArchiveAutomatic:false,cleanShareLinks:false,modUnapprovedFilter:true});
  post.checked=false;post.dispatchEvent(new p.w.Event('change'));
  await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(p.state['rt-settings-v1'])),{postDiscovery:false,archiveDiscovery:true,restoreDeletedContent:true,subredditArchive:false,subredditArchiveAutomatic:false,cleanShareLinks:false,modUnapprovedFilter:true});
  assert.equal(p.w.document.querySelector('#settings-status').textContent,'Settings saved automatically.');
});

test('automatic restoration stays independent of archive opt-in and serialized writes preserve unknown fields',async t=>{
  const p=popup(t,{settings:{'rt-settings-v1':{archiveDiscovery:false,restoreDeletedContent:false,futureOption:'preserve'}}});await settle();
  const restore=p.w.document.querySelector('#restore-deleted-content'),post=p.w.document.querySelector('#post-discovery');
  assert.equal(restore.checked,false);assert.equal(restore.closest('.setting-row').hidden,true,'folds away until the archive is on');
  restore.checked=true;restore.dispatchEvent(new p.w.Event('change'));post.checked=false;post.dispatchEvent(new p.w.Event('change'));await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(p.state['rt-settings-v1'])),{postDiscovery:false,archiveDiscovery:false,restoreDeletedContent:true,subredditArchive:false,subredditArchiveAutomatic:false,cleanShareLinks:false,modUnapprovedFilter:true,futureOption:'preserve'});
  const reopened=popup(t,{settings:p.state});await settle();assert.equal(reopened.w.document.querySelector('#restore-deleted-content').checked,true);assert.equal(reopened.w.document.querySelector('#archive-discovery').checked,false);
});

test('Reddit Tweaks popup reports settings storage failures and restores the failed toggle',async t=>{
  const p=popup(t,{storageFailure:true});await settle();
  const control=p.w.document.querySelector('#post-discovery');
  assert.equal(control.disabled,true);assert.match(p.w.document.querySelector('#settings-status').textContent,/Could not load settings/);
  assert.equal(p.w.document.querySelector('#settings-status').classList.contains('error'),true);
  for(const sw of p.w.document.querySelectorAll('.switch')){assert.equal(sw.indeterminate,true);assert.equal(sw.getAttribute('aria-disabled'),'true');assert.ok(sw.classList.contains('is-unavailable'));}
});

test('popup keeps chat stats and both cache clear actions available',async t=>{
  const p=popup(t);await settle();
  assert.match(p.w.document.querySelector('#message-stats').textContent,/42 saved messages.*3 chats/);
  assert.match(p.w.document.querySelector('.cache-info').textContent,/every Reddit account on this device/);
  for(const id of ['#clear-messages','#clear-cache']){p.w.document.querySelector(id).click();p.w.document.querySelector(id).click();await settle();}
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

test('a failed save re-syncs dependent dimming with the reverted switch',async t=>{
  const p=popup(t,{settings:{'rt-settings-v1':{postDiscovery:true,archiveDiscovery:false}}});await settle();
  const row=p.w.document.querySelector('[data-requires="archive-discovery"]'),archive=p.w.document.querySelector('#archive-discovery');
  assert.ok(row.classList.contains('is-inactive'));
  p.w.chrome.storage.local.set=async()=>{throw Error('write failed');};
  archive.checked=true;archive.dispatchEvent(new p.w.Event('change',{bubbles:true}));assert.equal(row.classList.contains('is-inactive'),false);
  await settle();assert.equal(archive.checked,false);assert.ok(row.classList.contains('is-inactive'));
});

test('clear actions need a confirmation click, name the all-accounts scope, and expire',async t=>{
  const p=popup(t);await settle();const doc=p.w.document,btn=doc.querySelector('#clear-messages'),status=doc.querySelector('#cache-status');
  const clears=()=>p.messages.filter(m=>m.action==='clear').length;
  btn.click();assert.equal(clears(),0);assert.match(status.textContent,/every Reddit account on this device/);assert.equal(btn.textContent,'Confirm clear');
  // Escape cancels.
  doc.dispatchEvent(new p.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(btn.textContent,'Clear saved messages');assert.equal(status.textContent,'');
  // Clicking elsewhere cancels.
  btn.click();doc.body.click();assert.equal(btn.textContent,'Clear saved messages');btn.click();
  // Arming the other button moves the confirmation instead of clearing.
  doc.querySelector('#clear-cache').click();assert.equal(clears(),0);assert.equal(btn.textContent,'Clear saved messages');
  doc.querySelector('#clear-cache').click();await settle();assert.equal(clears(),1);assert.equal(p.messages.find(m=>m.action==='clear').scope,'rcs-directory');
  assert.equal(doc.querySelector('#clear-cache').textContent,'Clear saved usernames');
});

test('clear usernames disables its button while the request runs',async t=>{
  const p=popup(t);await settle();let finish;
  p.w.chrome.runtime.sendMessage=request=>request.action==='clear'?new Promise(resolve=>finish=()=>resolve({ok:true})):Promise.resolve({ok:true,stats:{}});
  const btn=p.w.document.querySelector('#clear-cache');btn.click();btn.click();assert.equal(btn.disabled,true);finish();await settle();assert.equal(btn.disabled,false);
});

test('popup accessibility wiring: descriptions, dependent state, focusable About panel',async t=>{
  const p=popup(t);await settle();const doc=p.w.document;
  for(const sw of doc.querySelectorAll('.switch')){const desc=doc.getElementById(sw.getAttribute('aria-describedby'));assert.ok(desc&&desc.textContent.length>10);}
  const archive=doc.querySelector('#archive-discovery'),restore=doc.querySelector('#restore-deleted-content');
  assert.equal(restore.getAttribute('aria-disabled'),'true');assert.equal(archive.hasAttribute('aria-disabled'),false);
  archive.checked=true;archive.dispatchEvent(new p.w.Event('change',{bubbles:true}));assert.equal(restore.hasAttribute('aria-disabled'),false);
  assert.equal(doc.querySelector('#cache-info-panel').getAttribute('tabindex'),'-1');
});

function luminance(hex){const c=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4);return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2];}
const contrast=(a,b)=>{const [x,y]=[luminance(a),luminance(b)].sort((m,n)=>n-m);return (x+0.05)/(y+0.05);};
test('popup colors meet contrast minimums and forced-colors keeps switches visible',()=>{
  const css=fs.readFileSync(path.join(__dirname,'../extension/popup.css'),'utf8');
  const light=css.match(/--link-bg:(#\w{6});--track:(#\w{6})/),dark=css.match(/\.switch\{--track:(#\w{6})\}/);
  assert.ok(contrast(light[1],'#ffffff')>=4.5);assert.ok(contrast(light[2],'#ffffff')>=3);assert.ok(contrast(dark[1],'#151a1c')>=3);assert.ok(contrast(dark[1],'#ffffff')>=3);
  assert.match(css,/@media\(forced-colors:active\)\{[^@]*\.switch\{[^}]*ButtonText/);
});

test('unavailable-community loading and direct-open are separate opt-ins and retain dependency state',async t=>{
  const p=popup(t);await settle();const doc=p.w.document,archive=doc.querySelector('#archive-discovery'),community=doc.querySelector('#subreddit-archive'),automatic=doc.querySelector('#subreddit-archive-automatic');
  assert.equal(community.checked,false);assert.equal(automatic.checked,false);assert.equal(automatic.getAttribute('aria-disabled'),'true');
  for(const control of [archive,community,automatic]){control.checked=true;control.dispatchEvent(new p.w.Event('change',{bubbles:true}));await settle();}
  assert.equal(p.state['rt-settings-v1'].subredditArchiveAutomatic,true);assert.equal(automatic.getAttribute('aria-disabled'),null);
  community.checked=false;community.dispatchEvent(new p.w.Event('change',{bubbles:true}));await settle();assert.equal(automatic.checked,true,'retains the direct-open preference for later');assert.equal(automatic.getAttribute('aria-disabled'),'true');
  const reopened=popup(t,{settings:p.state});await settle();assert.equal(reopened.w.document.querySelector('#subreddit-archive').checked,false);assert.equal(reopened.w.document.querySelector('#subreddit-archive-automatic').checked,true);
});

test('clean sharing is an independent opt-in that persists with all discovery options disabled',async t=>{
 const p=popup(t,{settings:{'rt-settings-v1':{postDiscovery:false,archiveDiscovery:false}}});await settle();const control=p.w.document.querySelector('#clean-share-links');assert.equal(control.checked,false);assert.equal(control.getAttribute('aria-disabled'),null);
 control.checked=true;control.dispatchEvent(new p.w.Event('change',{bubbles:true}));await settle();assert.equal(p.state['rt-settings-v1'].cleanShareLinks,true);
 const reopened=popup(t,{settings:p.state});await settle();assert.equal(reopened.w.document.querySelector('#clean-share-links').checked,true);assert.equal(reopened.w.document.querySelector('#post-discovery').checked,false);
});
