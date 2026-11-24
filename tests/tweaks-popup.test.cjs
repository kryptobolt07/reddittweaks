const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');

const html=fs.readFileSync(path.join(__dirname,'../extension/popup.html'),'utf8');
const modelScript=fs.readFileSync(path.join(__dirname,'../extension/post-model.js'),'utf8');
const hostsScript=fs.readFileSync(path.join(__dirname,'../extension/embed-player-hosts.js'),'utf8');
const script=fs.readFileSync(path.join(__dirname,'../extension/popup.js'),'utf8');
const settle=()=>new Promise(resolve=>setTimeout(resolve,0));

function popup(t,{settings,storageFailure=false,runtimeFailure=false,tabs,storedTab,mirror,statsMirror,sendMessage,touch=false,embedAccess}={}){
  const dom=new JSDOM(html,{runScripts:'outside-only',url:'https://extension.test/popup.html'}),w=dom.window;
  t.after(w.close.bind(w));
  if(storedTab)w.localStorage.setItem('rt-popup-tab',storedTab);
  if(mirror)w.localStorage.setItem('rt-settings-mirror-v1',JSON.stringify(mirror));
  if(statsMirror)w.localStorage.setItem('rt-message-stats-v1',JSON.stringify(statsMirror));
  const frames=[];
  w.requestAnimationFrame=callback=>frames.push(callback);
  w.matchMedia=query=>({matches:query.includes('pointer: coarse')?touch:false});
  const messages=[],reads=[],state={...(settings||{})};
  w.chrome={
    storage:{local:{
      async get(key){reads.push(key);if(storageFailure)throw Error('storage read failed');return {[key]:state[key]};},
      async set(values){if(storageFailure)throw Error('storage write failed');Object.assign(state,values);}
    }},
    runtime:{async sendMessage(request){
      messages.push(request);
      if(runtimeFailure)throw Error('runtime failed');
      if(sendMessage)return sendMessage(request);
      return request.action==='stats'?{ok:true,stats:{messages:42,rooms:3,approxBytes:2048}}:{ok:true};
    }}
  };
  w.chrome.tabs=tabs;
  Object.assign(w.chrome,embedAccess);
  w.eval(modelScript);
  w.eval(hostsScript);
  w.eval(script);
  return {w,state,messages,reads,paint(){for(const callback of frames.splice(0))callback();}};
}

function embedAccess({granted=false,grant=true}={}){
  const access={granted,registered:[],requests:0};
  access.api={
    permissions:{contains:async()=>access.granted,request:async()=>{access.requests++;return (access.granted=grant);},remove:async()=>{access.granted=false;}},
    scripting:{getRegisteredContentScripts:async()=>access.registered,registerContentScripts:async scripts=>{access.registered=scripts;},unregisterContentScripts:async()=>{access.registered=[];}}
  };
  return access;
}
test('Direct embed controls uses Grant/Revoke access; Block embed links stays visible but dimmed until granted',async t=>{
  const access=embedAccess();
  const p=popup(t,{storedTab:'settings',embedAccess:access.api});
  await settle();
  const {document}=p.w;
  const button=document.querySelector('#direct-embed-controls');
  const control=document.querySelector('#embed-block-links'),blockRow=control.closest('.setting-row');
  assert.equal(access.requests,0);
  assert.equal(button.textContent,'Grant access');
  assert.equal(blockRow.hidden,false,'shown, so the reader knows it exists');
  assert.ok(blockRow.classList.contains('is-inactive'));
  assert.equal(control.getAttribute('aria-disabled'),'true');
  assert.equal(control.disabled,false,'still focusable');
  const note=blockRow.querySelector('[data-permission-note]');
  assert.equal(note.textContent,'Needs Direct embed controls');
  assert.ok(control.getAttribute('aria-describedby').split(' ').includes(note.id));
  assert.equal(document.querySelector('[aria-labelledby="videos-heading"] .group-count').textContent,'Default');

  button.click();await settle();
  assert.equal(access.requests,1);
  assert.equal(button.textContent,'Revoke access');
  assert.equal(blockRow.classList.contains('is-inactive'),false,'enabled in place after the grant');
  assert.equal(control.hasAttribute('aria-disabled'),false);
  assert.equal(blockRow.querySelector('[data-permission-note]'),null,'the note goes away');
  assert.equal(control.getAttribute('aria-describedby'),'embed-block-links-desc');
  assert.ok(access.registered[0].matches.includes('https://www.redgifs.com/ifr/*'));
  assert.equal(access.registered[0].allFrames,true);

  control.click();
  document.querySelector('#embed-block-links-menu [data-value="both"]').click();
  await settle();
  assert.equal(p.state['rt-settings-v1'].embedBlockLinks,'both');
  assert.equal(document.querySelector('[aria-labelledby="videos-heading"] .group-count').textContent,'1 of 13 active');

  button.click();await settle();
  assert.equal(access.granted,false);
  assert.equal(access.registered.length,0);
  assert.equal(button.textContent,'Grant access');
  assert.ok(blockRow.classList.contains('is-inactive'),'dims again when revoked');
  assert.equal(blockRow.hidden,false);
  assert.equal(p.state['rt-settings-v1'].embedBlockLinks,'both','stored value preserved across revoke');
  assert.equal(document.querySelector('[aria-labelledby="videos-heading"] .group-count').textContent,'Default','inactive nested control no longer counts as active');
});
test('a dimmed option leads to Direct embed controls: scroll, a brief outline and focus on Grant access',async t=>{
  const access=embedAccess();
  const p=popup(t,{storedTab:'settings',embedAccess:access.api});
  await settle();
  const {document}=p.w;
  const button=document.querySelector('#direct-embed-controls'),permissionRow=button.closest('.setting-row');
  const control=document.querySelector('#embed-block-links'),menu=document.querySelector('#embed-block-links-menu');
  let scrolled=0;permissionRow.scrollIntoView=()=>scrolled++;
  control.click();
  assert.equal(menu.hidden,true,'the menu does not open');
  assert.equal(document.activeElement,button,'Grant access has focus');
  assert.equal(scrolled,1);
  assert.ok(permissionRow.classList.contains('is-pulsing'));
  await new Promise(resolve=>setTimeout(resolve,1050));
  assert.equal(permissionRow.classList.contains('is-pulsing'),false,'the outline lasts about a second');
  // Anywhere on the row, the note's link, and Enter/Space on the focusable control do the same.
  control.closest('.setting-row').querySelector('.setting-copy p').click();
  assert.equal(scrolled,2);
  control.focus();control.closest('.setting-row').querySelector('.permission-link').click();
  assert.equal(scrolled,3);assert.equal(document.activeElement,button);
  for(const key of ['Enter',' ']){
    control.focus();
    const event=new p.w.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true});
    control.dispatchEvent(event);
    assert.equal(event.defaultPrevented,true,key);assert.equal(document.activeElement,button,key);
  }
  assert.equal(menu.hidden,true);
  // One more click grants, and the option enables without reopening the popup.
  button.click();await settle();
  assert.equal(control.closest('.setting-row').classList.contains('needs-permission'),false);
  control.click();
  assert.equal(menu.hidden,false,'now its own menu opens');
});
test('a denied prompt says so and keeps the option dimmed; partly dependent options carry a hint instead',async t=>{
  const access=embedAccess({grant:false});
  const p=popup(t,{storedTab:'settings',embedAccess:access.api});
  await settle();
  const {document}=p.w;
  const button=document.querySelector('#direct-embed-controls');
  for(const id of ['volume-memory','loop-policy','hold-for-2x','video-direct-open']){
    const row=document.getElementById(id).closest('.setting-row');
    assert.equal(row.classList.contains('is-inactive'),false,id+' is not dimmed');
    const hint=row.querySelector('.permission-hint');
    assert.match(hint.textContent,/need Direct embed controls$/,id);
    assert.ok(document.getElementById(id).getAttribute('aria-describedby').includes(hint.id));
  }
  let scrolled=0;button.closest('.setting-row').scrollIntoView=()=>scrolled++;
  document.querySelector('#loop-policy').closest('.setting-row').querySelector('.permission-link').click();
  assert.equal(scrolled,1);assert.equal(document.activeElement,button);
  button.click();await settle();
  assert.equal(access.requests,1);
  assert.match(document.querySelector('#direct-embed-status').textContent,/Allow access/);
  assert.ok(document.querySelector('#embed-block-links').closest('.setting-row').classList.contains('is-inactive'));
  assert.ok(document.querySelector('#loop-policy').closest('.setting-row').querySelector('.permission-hint'));
});
test('without the permission API, permission-only options stay hidden and no hints show',async t=>{
  const p=popup(t,{storedTab:'settings'});
  await settle();
  const {document}=p.w;
  assert.equal(document.querySelector('#direct-embed-row').hidden,true);
  assert.equal(document.querySelector('#embed-block-links').closest('.setting-row').hidden,true);
  assert.equal(document.querySelectorAll('.permission-hint,[data-permission-note]').length,0);
});

test('Reddit Tweaks popup loads canonical passive defaults and persists individual changes while preserving other settings',async t=>{
  const p=popup(t);await settle();
  const doc=p.w.document;
  const post=doc.querySelector('#post-discovery'),archive=doc.querySelector('#archive-discovery'),restore=doc.querySelector('#restore-deleted-content');
  assert.equal(post.checked,true);assert.equal(archive.checked,false);assert.equal(restore.checked,true);
  assert.equal(doc.querySelector('#download-media').checked,true);
  assert.equal(doc.querySelector('#chat-search').checked,true);
  archive.checked=true;archive.dispatchEvent(new p.w.Event('change'));
  await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(p.state['rt-settings-v1'])),{...p.w.RTPostModel.SETTINGS_DEFAULTS,archiveDiscovery:true});
  post.checked=false;post.dispatchEvent(new p.w.Event('change'));
  await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(p.state['rt-settings-v1'])),{...p.w.RTPostModel.SETTINGS_DEFAULTS,postDiscovery:false,archiveDiscovery:true});
  assert.equal(doc.querySelector('#settings-status').textContent,'Settings saved automatically.');
  assert.equal(doc.querySelector('[data-requires="post-discovery"] .requires-note').textContent,'Requires Profile search & hidden activity');
});

test('Mobile Web card is hidden on desktop and visible with Mobile Only badges on touch devices',async t=>{
  const desktop=popup(t,{storedTab:'settings',touch:false});await settle();
  assert.equal(desktop.w.document.getElementById('mobile-web-card').hidden,true,'hidden on desktop');

  const mobile=popup(t,{storedTab:'settings',touch:true});await settle();
  const card=mobile.w.document.getElementById('mobile-web-card');
  assert.equal(card.hidden,false,'visible on touch');
  assert.equal(card.querySelectorAll('.badge-mobile').length,2);
  const control=mobile.w.document.querySelector('#hide-mature-overlay');
  assert.equal(control.closest('section').getAttribute('aria-labelledby'),'mobile-heading');
  assert.equal(control.checked,true);
  control.click();await settle();
  assert.equal(mobile.state['rt-settings-v1'].hideMatureOverlay,false);
  const reopened=popup(t,{storedTab:'settings',touch:true,settings:mobile.state});await settle();
  assert.equal(reopened.w.document.querySelector('#hide-mature-overlay').checked,false);
  const media=reopened.w.document.querySelector('#reveal-nsfw-post-media');
  assert.equal(media.checked,false);
  media.click();await settle();
  assert.equal(reopened.state['rt-settings-v1'].revealNsfwPostMedia,true);
  assert.equal(reopened.state['rt-settings-v1'].hideMatureOverlay,false);
});

test('automatic restoration stays independent of archive opt-in and serialized writes preserve unknown fields',async t=>{
  const p=popup(t,{settings:{'rt-settings-v1':{archiveDiscovery:false,restoreDeletedContent:false,futureOption:'preserve'}}});await settle();
  const restore=p.w.document.querySelector('#restore-deleted-content'),post=p.w.document.querySelector('#post-discovery');
  assert.equal(restore.checked,false);assert.equal(restore.closest('.setting-row').hidden,true,'folds away until the archive is on');
  restore.checked=true;restore.dispatchEvent(new p.w.Event('change'));post.checked=false;post.dispatchEvent(new p.w.Event('change'));await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(p.state['rt-settings-v1'])),{...p.w.RTPostModel.SETTINGS_DEFAULTS,postDiscovery:false,archiveDiscovery:false,restoreDeletedContent:true,futureOption:'preserve'});
  const reopened=popup(t,{settings:p.state});await settle();
  assert.equal(reopened.w.document.querySelector('#restore-deleted-content').checked,true);
  assert.equal(reopened.w.document.querySelector('#archive-discovery').checked,false);
});

test('Reddit Tweaks popup reports settings storage failures and marks switches unavailable',async t=>{
  const p=popup(t,{storageFailure:true});await settle();
  const control=p.w.document.querySelector('#post-discovery');
  assert.equal(control.disabled,true);assert.match(p.w.document.querySelector('#settings-status').textContent,/Could not load settings/);
  assert.equal(p.w.document.querySelector('#settings-status').classList.contains('error'),true);
  for(const sw of p.w.document.querySelectorAll('.switch')){assert.equal(sw.indeterminate,true);assert.equal(sw.getAttribute('aria-disabled'),'true');assert.ok(sw.classList.contains('is-unavailable'));}
});

test('Data tab has local chat search toggle (default On), Paused state when off, and keeps Clear actions active',async t=>{
  const p=popup(t,{storedTab:'data'});await settle();
  const doc=p.w.document,toggle=doc.getElementById('chat-search'),paused=doc.getElementById('chat-paused-pill'),stats=doc.getElementById('chat-stats-box');
  assert.equal(toggle.checked,true);assert.equal(paused.hidden,true);assert.equal(stats.classList.contains('is-paused'),false);
  assert.match(doc.querySelector('#message-stats').textContent,/42 saved messages.*3 chats/);
  assert.match(doc.querySelector('.cache-info').textContent,/every Reddit account on this device/);
  toggle.click();await settle();
  assert.equal(p.state['rt-settings-v1'].chatSearch,false);
  assert.equal(paused.hidden,false,'Paused badge shows when indexing is off');
  assert.equal(stats.classList.contains('is-paused'),true);
  assert.equal(doc.getElementById('clear-messages').disabled,false,'Clear buttons stay enabled when chat search is off');
  assert.equal(doc.getElementById('clear-cache').disabled,false);
  for(const id of ['#clear-messages','#clear-cache']){doc.querySelector(id).click();doc.querySelector(id).click();await settle();}
  assert.ok(p.messages.some(message=>message.scope==='rcs-messages'&&message.action==='clear'));
  assert.ok(p.messages.some(message=>message.scope==='rcs-directory'&&message.action==='clear'));
  assert.match(doc.querySelector('#cache-status').textContent,/Saved usernames cleared/);
  assert.equal(p.messages.filter(message=>message.action==='stats').length,2,'clearing saved messages refreshes the count');
});

test('Data tab shows cached message stats immediately on reopen without flashing loading text',async t=>{
  let resolveStats;
  const p=popup(t,{
    storedTab:'data',
    statsMirror:{messages:36331,rooms:2075,approxBytes:22124954},
    sendMessage:request=>request.action==='stats'?new Promise(resolve=>{resolveStats=resolve;}):{ok:true}
  });
  const statsEl=p.w.document.querySelector('#message-stats');
  assert.match(statsEl.textContent,/36,331 saved messages.*2,075 chats.*21\.1 MB estimated data/,'renders cached stats synchronously before background replies');
  resolveStats({ok:true,stats:{messages:36335,rooms:2076,approxBytes:22229811}});
  await settle();
  assert.match(statsEl.textContent,/36,335 saved messages.*2,076 chats.*21\.2 MB estimated data/,'updates seamlessly when background replies');
  assert.equal(JSON.parse(p.w.localStorage.getItem('rt-message-stats-v1')).messages,36335);
});

test('Home opens with one settings read and leaves hidden panels idle',async t=>{
  let tabQueries=0;
  const p=popup(t,{tabs:{async query(){tabQueries++;return [];}}});
  const doc=p.w.document;
  await settle();
  assert.deepEqual(p.reads,['rt-settings-v1']);
  assert.equal(doc.querySelector('#history-limit').disabled,false);
  assert.equal(doc.querySelector('#video-start').disabled,false);
  assert.equal(tabQueries,0);
  assert.equal(p.messages.length,0);
  doc.getElementById('tab-settings').click();
  await settle();
  assert.equal(tabQueries,1);
  assert.equal(p.messages.length,0);
  doc.getElementById('tab-data').click();
  await settle();
  assert.match(doc.querySelector('#message-stats').textContent,/42 saved messages/);
  doc.getElementById('tab-home').click();
  doc.getElementById('tab-data').click();
  await settle();
  assert.deepEqual(p.messages.map(message=>message.action),['stats']);
});

test('a failed settings write restores the switch and re-syncs dependent dimming',async t=>{
  const p=popup(t,{settings:{'rt-settings-v1':{postDiscovery:true,archiveDiscovery:false}}});await settle();
  const row=p.w.document.querySelector('[data-requires="archive-discovery"]'),archive=p.w.document.querySelector('#archive-discovery');
  assert.ok(row.classList.contains('is-inactive'));
  p.w.chrome.storage.local.set=async()=>{throw Error('write failed');};
  archive.checked=true;archive.dispatchEvent(new p.w.Event('change',{bubbles:true}));
  assert.equal(row.classList.contains('is-inactive'),false);
  await settle();
  assert.equal(archive.checked,false);assert.equal(archive.disabled,false);
  assert.ok(row.classList.contains('is-inactive'));
  assert.match(p.w.document.querySelector('#settings-status').textContent,/Could not save/);
});

test('clear actions need a confirmation click, name the all-accounts scope, and expire',async t=>{
  const p=popup(t);await settle();const doc=p.w.document,btn=doc.querySelector('#clear-messages'),status=doc.querySelector('#cache-status');
  const clears=()=>p.messages.filter(m=>m.action==='clear').length;
  btn.click();assert.equal(clears(),0);assert.match(status.textContent,/every Reddit account on this device/);assert.equal(btn.textContent,'Confirm clear');
  doc.dispatchEvent(new p.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(btn.textContent,'Clear saved messages');assert.equal(status.textContent,'');
  btn.click();doc.body.click();assert.equal(btn.textContent,'Clear saved messages');btn.click();
  doc.querySelector('#clear-cache').click();assert.equal(clears(),0);assert.equal(btn.textContent,'Clear saved messages');
  doc.querySelector('#clear-cache').click();await settle();assert.equal(clears(),1);assert.equal(p.messages.find(m=>m.action==='clear').scope,'rcs-directory');
  assert.equal(doc.querySelector('#clear-cache').textContent,'Clear saved usernames');
});

test('clear usernames disables its button while the request runs',async t=>{
  const p=popup(t);await settle();let finish;
  p.w.chrome.runtime.sendMessage=request=>request.action==='clear'?new Promise(resolve=>finish=()=>resolve({ok:true})):Promise.resolve({ok:true,stats:{}});
  const btn=p.w.document.querySelector('#clear-cache');btn.click();btn.click();assert.equal(btn.disabled,true);finish();await settle();assert.equal(btn.disabled,false);
});

test('popup accessibility wiring: descriptions, dependent state, focusable About panel, unified menu mutual exclusion',async t=>{
  const p=popup(t,{storedTab:'settings'});await settle();const doc=p.w.document;
  for(const sw of doc.querySelectorAll('.switch')){const desc=doc.getElementById(sw.getAttribute('aria-describedby'));assert.ok(desc&&desc.textContent.length>10,sw.id);}
  for(const ch of doc.querySelectorAll('.setting-choice[data-choice]')){const desc=doc.getElementById(ch.getAttribute('aria-describedby'));assert.ok(desc&&desc.textContent.length>10,ch.id);}
  const archive=doc.querySelector('#archive-discovery'),restore=doc.querySelector('#restore-deleted-content');
  assert.equal(restore.getAttribute('aria-disabled'),'true');assert.equal(archive.hasAttribute('aria-disabled'),false);
  archive.checked=true;archive.dispatchEvent(new p.w.Event('change',{bubbles:true}));assert.equal(restore.hasAttribute('aria-disabled'),false);
  await settle();
  assert.equal(doc.querySelector('#cache-info-panel').getAttribute('tabindex'),'-1');
  // Unified PopupMenu closes any other open menu.
  doc.getElementById('history-limit').click();
  assert.equal(doc.getElementById('history-limit-menu').hidden,false);
  doc.getElementById('video-start').click();
  assert.equal(doc.getElementById('history-limit-menu').hidden,true,'opening a choice menu closes History length menu');
  assert.equal(doc.getElementById('video-start-menu').hidden,false);
});

function luminance(hex){const c=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4);return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2];}
const contrast=(a,b)=>{const [x,y]=[luminance(a),luminance(b)].sort((m,n)=>n-m);return (x+0.05)/(y+0.05);};
test('popup colors meet WCAG AA contrast minimums in both light and dark modes, and forced-colors keeps controls visible',()=>{
  const css=fs.readFileSync(path.join(__dirname,'../extension/popup.css'),'utf8');
  const light=css.match(/--link-bg:(#\w{6});--link-text:(#\w{6});--track:(#\w{6})/);
  const darkLink=css.match(/--link-text:(#\w{6});--beta-bg:(#\w{6});--beta-fg:(#\w{6});--mobile-bg:(#\w{6});--mobile-fg:(#\w{6})/);
  const darkTrack=css.match(/\.switch\{--track:(#\w{6})\}/);
  assert.ok(contrast(light[1],'#ffffff')>=4.5,'light button contrast');
  assert.ok(contrast(light[2],'#ffffff')>=4.5,'light link contrast');
  assert.ok(contrast(light[3],'#ffffff')>=3,'light switch track contrast');
  assert.ok(contrast(darkLink[1],'#151a1c')>=4.5,'dark link contrast');
  assert.ok(contrast(darkLink[3],darkLink[2])>=4.5,'dark beta badge contrast');
  assert.ok(contrast(darkLink[5],darkLink[4])>=4.5,'dark mobile badge contrast');
  assert.ok(contrast(darkTrack[1],'#151a1c')>=3,'dark switch track vs card');
  assert.ok(contrast(darkTrack[1],'#ffffff')>=3,'dark switch track vs thumb');
  assert.match(css,/@media\(forced-colors:active\)\{[^@]*\.switch\{[^}]*ButtonText/);
});

test('unavailable-community loading and direct-open are separate opt-ins and retain dependency state',async t=>{
  const p=popup(t);await settle();const doc=p.w.document,archive=doc.querySelector('#archive-discovery'),community=doc.querySelector('#subreddit-archive'),automatic=doc.querySelector('#subreddit-archive-automatic');
  assert.equal(community.checked,false);assert.equal(automatic.checked,false);assert.equal(automatic.getAttribute('aria-disabled'),'true');
  for(const control of [archive,community,automatic]){control.checked=true;control.dispatchEvent(new p.w.Event('change',{bubbles:true}));await settle();}
  assert.equal(p.state['rt-settings-v1'].subredditArchiveAutomatic,true);assert.equal(automatic.getAttribute('aria-disabled'),null);
  community.checked=false;community.dispatchEvent(new p.w.Event('change',{bubbles:true}));await settle();
  assert.equal(automatic.checked,true,'retains the direct-open preference for later');assert.equal(automatic.getAttribute('aria-disabled'),'true');
  const reopened=popup(t,{settings:p.state});await settle();
  assert.equal(reopened.w.document.querySelector('#subreddit-archive').checked,false);
  assert.equal(reopened.w.document.querySelector('#subreddit-archive-automatic').checked,true);
});

test('clean sharing is an independent opt-in that persists with all discovery options disabled',async t=>{
  const p=popup(t,{settings:{'rt-settings-v1':{postDiscovery:false,archiveDiscovery:false}}});await settle();
  const control=p.w.document.querySelector('#clean-share-links');
  assert.equal(control.checked,false);assert.equal(control.getAttribute('aria-disabled'),null);
  control.checked=true;control.dispatchEvent(new p.w.Event('change',{bubbles:true}));await settle();
  assert.equal(p.state['rt-settings-v1'].cleanShareLinks,true);
  const reopened=popup(t,{settings:p.state});await settle();
  assert.equal(reopened.w.document.querySelector('#clean-share-links').checked,true);
  assert.equal(reopened.w.document.querySelector('#post-discovery').checked,false);
});

test('Redaction opens in the active Reddit tab by message, without changing its address',async t=>{
  const updated=[],created=[],sent=[],p=popup(t,{tabs:{async query(){return [{id:7,url:'https://www.reddit.com/r/Alpha/comments/abc/title/?sort=new'}];},async sendMessage(id,message,options){sent.push({id,message,options});return {ok:true,opened:true};},async update(id,options){updated.push({id,...options});},async create(options){created.push(options);}}});let closed=false;p.w.close=()=>{closed=true;};await settle();
  const button=p.w.document.getElementById('open-redaction');assert.equal(button.closest('section').getAttribute('aria-labelledby'),'redaction-heading');button.click();await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(sent)),[{id:7,message:{scope:'rt-redact',action:'open'},options:{frameId:0}}]);assert.equal(updated.length,0);assert.equal(created.length,0);assert.equal(closed,true);
});

test('Redaction falls back to the address fragment only when the page has no connected script',async t=>{
  const updated=[],p=popup(t,{tabs:{async query(){return [{id:7,url:'https://www.reddit.com/r/Alpha/'}];},async sendMessage(){throw Error('Could not establish connection.');},async update(id,options){updated.push({id,...options});}}});p.w.close=()=>{};await settle();
  p.w.document.getElementById('open-redaction').click();await settle();assert.deepEqual(updated,[{id:7,url:'https://www.reddit.com/r/Alpha/#rt-redact'}]);
});

test('Redaction uses the own-profile fallback outside Reddit and reports tab failures',async t=>{
  const created=[],p=popup(t,{tabs:{async query(){return [{id:8,url:'https://example.test/'}];},async create(options){created.push(options);}}});p.w.close=()=>{};await settle();p.w.document.getElementById('open-redaction').click();await settle();assert.deepEqual(JSON.parse(JSON.stringify(created)),[{url:'https://www.reddit.com/user/me/#rt-redact'}]);
  const broken=popup(t,{tabs:{async query(){throw Error('unavailable');}}});await settle();broken.w.document.getElementById('open-redaction').click();await settle();assert.match(broken.w.document.getElementById('redaction-open-status').textContent,/Couldn’t open/);assert.equal(broken.w.document.getElementById('open-redaction').disabled,false);
});

const redditTab={async query(){return [{id:7,url:'https://www.reddit.com/r/Alpha/'}];},async update(){},async create(){}};
test('three tabs (Home, Settings, Data) with tab semantics, keyboard movement and a remembered choice',async t=>{
  const p=popup(t,{tabs:redditTab});await settle();const doc=p.w.document,tabs=[...doc.querySelectorAll('[role="tab"]')];
  assert.equal(doc.querySelector('[role="tablist"]').getAttribute('aria-label'),'Reddit Tweaks sections');
  assert.deepEqual(tabs.map(tab=>tab.textContent.trim()),['Home','Settings','Data']);
  const panel=name=>doc.getElementById('panel-'+name),selected=()=>tabs.find(tab=>tab.getAttribute('aria-selected')==='true').dataset.tab;
  assert.equal(selected(),'home');assert.equal(panel('home').hidden,false);assert.equal(panel('settings').hidden,true);assert.equal(panel('data').hidden,true);
  for(const tab of tabs){assert.equal(panel(tab.dataset.tab).getAttribute('role'),'tabpanel');assert.equal(tab.getAttribute('aria-controls'),'panel-'+tab.dataset.tab);assert.equal(panel(tab.dataset.tab).getAttribute('aria-labelledby'),tab.id);}
  assert.equal(tabs[0].tabIndex,0);assert.equal(tabs[1].tabIndex,-1);
  tabs[1].click();assert.equal(selected(),'settings');assert.equal(panel('settings').hidden,false);assert.equal(panel('home').hidden,true);
  tabs[1].dispatchEvent(new p.w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));assert.equal(selected(),'data');assert.equal(doc.activeElement,tabs[2]);
  tabs[2].dispatchEvent(new p.w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));assert.equal(selected(),'home','wraps');
  tabs[0].dispatchEvent(new p.w.KeyboardEvent('keydown',{key:'End',bubbles:true}));assert.equal(selected(),'data');assert.equal(p.w.localStorage.getItem('rt-popup-tab'),'data');
  const again=popup(t,{tabs:redditTab,storedTab:'settings'});await settle();assert.equal(again.w.document.getElementById('panel-settings').hidden,false,'reopens on the last tab');
  assert.ok(panel('home').contains(doc.getElementById('open-redaction')));assert.ok(panel('settings').contains(doc.getElementById('post-discovery')));assert.ok(panel('data').contains(doc.getElementById('clear-messages')));
});

test('Home: Raffles explains where to find them and can be turned on in place',async t=>{
  const p=popup(t,{tabs:redditTab,settings:{'rt-settings-v1':{raffles:false}}});await settle();const doc=p.w.document,card=doc.getElementById('raffles-home');
  assert.match(card.textContent,/⋯ menu/);assert.equal(card.querySelector('.state-pill').textContent,'Off');const turnOn=doc.getElementById('raffles-turn-on');assert.equal(turnOn.hidden,false);
  turnOn.click();await settle();assert.equal(p.state['rt-settings-v1'].raffles,true);assert.equal(doc.getElementById('raffles').checked,true);assert.equal(card.querySelector('.state-pill').textContent,'On');assert.equal(turnOn.hidden,true);
});

test('accurate counters: active booleans + overridden selectors, excluding historyLimit, clickAudio, actions, and hidden device cards',async t=>{
  const p=popup(t,{tabs:redditTab,touch:false});await settle();const doc=p.w.document;
  assert.equal(doc.getElementById('feature-summary').textContent,'8 of 33 active','desktop fresh count excludes Mobile Web card, includes blockedProfiles and chatSearch');
  doc.getElementById('manage-features').click();assert.equal(doc.getElementById('panel-settings').hidden,false);
  const count=id=>doc.querySelector('[aria-labelledby="'+id+'"] .group-count').textContent;
  assert.equal(count('browsing-heading'),'3 of 4 on');
  assert.equal(count('performance-heading'),'1 of 2 on');
  assert.equal(count('videos-heading'),'Default');
  assert.equal(count('tools-heading'),'3 of 3 on');
  assert.equal(count('removal-settings-heading'),'0 of 2 on');
  assert.equal(count('archive-heading'),'0 of 4 on');
  assert.equal(count('visual-search-heading'),'0 of 4 on');

  // Numeric History length dropdown does NOT change Browsing & Feed or Home counts.
  doc.getElementById('history-limit').click();
  doc.querySelector('#history-limit-menu [data-value="500"]').click();await settle();
  assert.equal(count('browsing-heading'),'3 of 4 on');
  assert.equal(doc.getElementById('feature-summary').textContent,'8 of 33 active');

  // Overriding mediaClickAction counts (+1) and reveals clickAudio; changing clickAudio does NOT add to counts.
  const clickAudioRow=doc.getElementById('click-audio').closest('.setting-row');
  assert.equal(clickAudioRow.hidden,true,'clickAudio hidden when mediaClickAction is Default');
  doc.getElementById('media-click-action').click();
  doc.querySelector('#media-click-action-menu [data-value="inline"]').click();await settle();
  assert.equal(clickAudioRow.hidden,false);
  assert.equal(count('videos-heading'),'1 of 13 active');
  assert.equal(doc.getElementById('feature-summary').textContent,'9 of 33 active');
  assert.equal(doc.getElementById('reset-video-defaults').hidden,false);
  doc.getElementById('click-audio').click();
  doc.querySelector('#click-audio-menu [data-value="unmute"]').click();await settle();
  assert.equal(count('videos-heading'),'1 of 13 active','clickAudio is excluded from counts');

  // Seamless post transition sits in the main Videos & Embeds section (not inside the collapsed Enhancements drawer)
  // and reveals its nested Post card click audio row when enabled.
  const openPostBtn=doc.getElementById('video-open-post'),cardAudioRow=doc.getElementById('card-click-audio').closest('.setting-row');
  assert.equal(Boolean(openPostBtn.closest('#video-enhancements')),false,'Seamless post transition is promoted out of Enhancements');
  assert.equal(cardAudioRow.hidden,true,'cardClickAudio hidden when videoOpenPost is Default');
  openPostBtn.click();
  doc.querySelector('#video-open-post-menu [data-value="position"]').click();await settle();
  assert.equal(cardAudioRow.hidden,false,'cardClickAudio appears when videoOpenPost is enabled');
  assert.equal(count('videos-heading'),'2 of 13 active');
  doc.getElementById('card-click-audio').click();
  doc.querySelector('#card-click-audio-menu [data-value="unmute"]').click();await settle();
  assert.equal(count('videos-heading'),'2 of 13 active','cardClickAudio is excluded from counts');
  openPostBtn.click();
  doc.querySelector('#video-open-post-menu [data-value="default"]').click();await settle();
  assert.equal(cardAudioRow.hidden,true);

  // Enabling Archive turns on Archive + already-checked restoreDeletedContent (+2).
  const archive=doc.getElementById('archive-discovery');archive.checked=true;archive.dispatchEvent(new p.w.Event('change',{bubbles:true}));await settle();
  assert.equal(count('archive-heading'),'2 of 4 on');
  assert.equal(doc.getElementById('feature-summary').textContent,'11 of 33 active');

  // Touch device counts Mobile Web card (+1 of +8: two switches and six navigation bar choices at their defaults).
  const mob=popup(t,{tabs:redditTab,touch:true});await settle();
  assert.equal(mob.w.document.getElementById('feature-summary').textContent,'9 of 41 active');
  assert.equal(mob.w.document.querySelector('[aria-labelledby="mobile-heading"] .group-count').textContent,'1 of 8 on');
});

test('View profiles that blocked you defaults on, nests under postDiscovery, and persists independently',async t=>{
  const p=popup(t,{storedTab:'settings',tabs:redditTab});await settle();
  const doc=p.w.document,post=doc.getElementById('post-discovery'),blocked=doc.getElementById('blocked-profiles');
  const row=blocked.closest('.setting-row');
  assert.equal(blocked.checked,true);
  assert.equal(row.dataset.requires,'post-discovery');
  assert.equal(row.dataset.level,'2');
  assert.equal(row.hidden,false);
  blocked.click();await settle();
  assert.equal(p.state['rt-settings-v1'].blockedProfiles,false);
  assert.equal(doc.querySelector('[aria-labelledby="browsing-heading"] .group-count').textContent,'2 of 4 on');
  blocked.click();await settle();
  assert.equal(p.state['rt-settings-v1'].blockedProfiles,true);
  post.click();await settle();
  assert.equal(row.hidden,true,'hides when Profile search & hidden activity is turned off');
  assert.equal(blocked.getAttribute('aria-disabled'),'true');
  assert.equal(p.state['rt-settings-v1'].blockedProfiles,true,'preserves blockedProfiles while parent is off');
});

test('collapsible Enhancements drawer toggles smoothly, tracks live active badge, and Reset restores video defaults',async t=>{
  const p=popup(t,{tabs:redditTab,storedTab:'settings'});await settle();const doc=p.w.document;
  const toggle=doc.getElementById('enhancements-toggle'),body=doc.getElementById('video-enhancements'),inner=body.querySelector('.drawer-inner'),badge=doc.getElementById('enhancements-badge'),reset=doc.getElementById('reset-video-defaults');
  assert.equal(toggle.getAttribute('aria-expanded'),'false');
  assert.equal(body.dataset.open,'false');
  assert.equal(inner.hasAttribute('inert'),true);
  assert.equal(badge.hidden,true);
  assert.equal(reset.hidden,true);

  toggle.click();
  assert.equal(toggle.getAttribute('aria-expanded'),'true');
  assert.equal(body.dataset.open,'true');
  assert.equal(inner.hasAttribute('inert'),false);

  doc.getElementById('single-video').click();await settle();
  doc.getElementById('hold-for-2x').click();await settle();
  assert.equal(badge.hidden,false);
  assert.equal(badge.textContent,'2 active');
  assert.equal(doc.querySelector('[aria-labelledby="videos-heading"] .group-count').textContent,'2 of 13 active');
  assert.equal(reset.hidden,false);

  // Reset restores all media keys to passive defaults without touching non-media settings.
  doc.getElementById('clean-share-links').click();await settle();
  reset.click();await settle();
  assert.equal(doc.getElementById('single-video').checked,false);
  assert.equal(doc.getElementById('hold-for-2x').checked,false);
  assert.equal(badge.hidden,true);
  assert.equal(reset.hidden,true);
  assert.equal(doc.querySelector('[aria-labelledby="videos-heading"] .group-count').textContent,'Default');
  assert.equal(p.state['rt-settings-v1'].cleanShareLinks,true,'non-media settings untouched');
  assert.equal(doc.getElementById('settings-status').textContent,'Video defaults restored.');
});

test('adaptive platform copy switches between mouse and touch labels without duplicate controls',async t=>{
  const desktop=popup(t,{storedTab:'settings',touch:false});await settle();
  assert.equal(desktop.w.document.querySelector('#video-start-menu [data-value="preview"]').textContent,'Preview on hover, muted');
  assert.match(desktop.w.document.getElementById('hold-for-2x-desc').textContent,/Press and hold/);

  const touch=popup(t,{storedTab:'settings',touch:true});await settle();
  assert.equal(touch.w.document.querySelector('#video-start-menu [data-value="preview"]').textContent,'Preview the one I stop on, muted');
  assert.match(touch.w.document.getElementById('hold-for-2x-desc').textContent,/Long-press the right side/);
  touch.w.document.getElementById('video-start').click();
  touch.w.document.querySelector('#video-start-menu [data-value="preview"]').click();await settle();
  assert.equal(touch.w.document.getElementById('video-start').textContent.trim(),'When I stop');
  assert.equal(touch.state['rt-settings-v1'].videoStart,'preview');
});

test('legacy saved settings migrate cleanly in popup while preserving per-surface smooth toggles and stripping deprecated media keys',async t=>{
  const legacy={videoPreviews:false,videoPreviewsInView:true,videoPreviewClick:'here',videoUnmutePreview:false,smoothHome:false,smoothSubreddits:true,smoothProfiles:false,smoothSearch:true,futureOption:'keep'};
  const p=popup(t,{storedTab:'settings',settings:{'rt-settings-v1':legacy}});await settle();
  const doc=p.w.document;
  assert.equal(doc.getElementById('video-start').textContent.trim(),'On hover');
  assert.equal(doc.getElementById('media-click-action').textContent.trim(),'Play in feed');
  assert.equal(doc.getElementById('click-audio').textContent.trim(),'Keep muted');
  assert.equal(doc.getElementById('smooth-feeds').checked,true);
  assert.equal(doc.getElementById('smooth-home').checked,false,'saved per-surface smooth toggles are preserved');
  assert.equal(doc.getElementById('smooth-subreddits').checked,true);
  assert.equal(doc.getElementById('smooth-profiles').checked,false);
  assert.equal(doc.getElementById('smooth-surfaces-badge').textContent,'2 of 5 on');

  doc.getElementById('smooth-home').click();await settle();
  assert.equal(p.state['rt-settings-v1'].smoothHome,true);
  assert.equal(p.state['rt-settings-v1'].smoothProfiles,false);
  assert.equal('videoPreviewClick' in p.state['rt-settings-v1'],false);
  assert.equal(p.state['rt-settings-v1'].futureOption,'keep','unknown keys preserved');
  assert.equal(doc.getElementById('smooth-surfaces-badge').textContent,'3 of 5 on');
});

test('popup styles: fixed desktop height, scroll fade, fluid touch targets, and desktop FOUC guard',()=>{
  const css=fs.readFileSync(path.join(__dirname,'../extension/popup.css'),'utf8');
  assert.match(css,/\.panel\{[^}]*height:400px[^}]*overflow-y:auto[^}]*scrollbar-width:none/);
  assert.match(css,/\.panel\[data-more=end\]\{[^}]*mask-image:linear-gradient/);
  assert.match(css,/#cache-status:empty\{display:none\}/);
  assert.match(css,/\.panel::-webkit-scrollbar\{display:none\}/);
  assert.match(css,/html\{[^}]*overflow:hidden/);
  assert.match(css,/@media\(hover:hover\) and \(pointer:fine\)\{[^}]*\[data-device="touch"\]\{display:none\}/);
  const touchBlock=css.slice(css.indexOf('@media(hover:none) and (pointer:coarse){'));
  const block=touchBlock.slice(0,touchBlock.indexOf('\n}')+2);
  for(const rule of ['html,body{width:auto;min-width:0}','.tabs{position:sticky;top:0','.tab{min-height:44px','.switch{width:52px;height:32px}','.setting-row .setting-choice,.permission-action{min-height:40px','.info-trigger{width:40px;height:40px','.link-action,.chat-link{min-height:40px','.account-switch,.account-remove{min-height:40px}'])assert.ok(block.includes(rule),rule);
  assert.match(css,/\.account-actions\{display:flex;flex-wrap:wrap;gap:8px\}\.account-actions \.secondary-action\{flex:1 1 auto;width:auto;white-space:nowrap\}/);
});

test('a tab taller than the popup fades at the edge that has more, and touch skips fade measurement',async t=>{
  const p=popup(t,{tabs:redditTab});await settle();const panel=p.w.document.getElementById('panel-settings');p.w.document.getElementById('tab-settings').click();
  Object.defineProperty(panel,'scrollHeight',{configurable:true,value:800});Object.defineProperty(panel,'clientHeight',{configurable:true,value:400});
  panel.dispatchEvent(new p.w.Event('scroll'));p.paint();assert.equal(panel.dataset.more,'end');
  panel.scrollTop=100;panel.dispatchEvent(new p.w.Event('scroll'));p.paint();assert.equal(panel.dataset.more,'both');
  panel.scrollTop=400;panel.dispatchEvent(new p.w.Event('scroll'));p.paint();assert.equal(panel.dataset.more,'start');

  const touchP=popup(t,{tabs:redditTab,storedTab:'settings',touch:true});
  const tPanel=touchP.w.document.getElementById('panel-settings');
  let reads=0;Object.defineProperty(tPanel,'scrollHeight',{get(){reads++;return 800;}});
  await settle();
  tPanel.dispatchEvent(new touchP.w.Event('scroll'));touchP.paint();touchP.paint();
  assert.equal(reads,0);assert.equal(tPanel.dataset.more,undefined);
});

test('switches and choices show the last known settings on first paint via mirror, then follow storage',async t=>{
  const p=popup(t,{tabs:redditTab,mirror:{raffles:false,cleanShareLinks:true,videoStart:'play'},settings:{'rt-settings-v1':{raffles:false,cleanShareLinks:false,videoStart:'play'}}});
  const doc=p.w.document,raffles=doc.getElementById('raffles'),links=doc.getElementById('clean-share-links');
  assert.equal(raffles.checked,false);assert.equal(links.checked,true);assert.equal(raffles.disabled,false);
  assert.equal(doc.getElementById('video-start').textContent.trim(),'On Play','choice first paint from mirror');
  assert.equal(doc.documentElement.classList.contains('rt-settling'),true,'no switch animation on first paint');
  await settle();
  assert.equal(links.checked,false,'storage wins once read');
  assert.equal(JSON.parse(p.w.localStorage.getItem('rt-settings-mirror-v1')).cleanShareLinks,false);
  links.checked=true;links.dispatchEvent(new p.w.Event('change',{bubbles:true}));await settle();
  assert.equal(JSON.parse(p.w.localStorage.getItem('rt-settings-mirror-v1')).cleanShareLinks,true);
  const fresh=popup(t,{tabs:redditTab});assert.equal(fresh.w.document.getElementById('raffles').disabled,true,'without a mirror, controls wait for storage');
});

test('a grant made before the other embed providers were added stays on, and Grant access adds the rest',async t=>{
  const access=embedAccess({granted:true});let requested=null;
  const hostsContext={};require('node:vm').runInNewContext(require('node:fs').readFileSync('extension/embed-player-hosts.js','utf8'),hostsContext);
  const granted=new Set(hostsContext.RTEmbedHosts.origins);
  access.api.permissions.contains=async({origins})=>origins.every(origin=>granted.has(origin));
  access.api.permissions.request=async({origins})=>{requested=origins;for(const origin of origins)granted.add(origin);return true;};
  access.api.permissions.remove=async({origins})=>{for(const origin of origins)granted.delete(origin);};
  const p=popup(t,{storedTab:'settings',embedAccess:access.api});
  await settle();
  const {document}=p.w,button=document.querySelector('#direct-embed-controls'),revoke=document.querySelector('#direct-embed-revoke');
  assert.equal(button.textContent,'Grant access');assert.equal(button.dataset.granted,'true');assert.equal(button.dataset.partial,'true');
  assert.match(document.querySelector('#direct-embed-status').textContent,/^Granted for Vimeo, Streamable, RedGIFs and Twitch\. YouTube, Dailymotion and \d+ more need one more Grant access\.$/);
  assert.equal(revoke.hidden,false);
  const blockRow=document.querySelector('#embed-block-links').closest('.setting-row');
  assert.equal(blockRow.classList.contains('is-inactive'),false,'options that need the grant stay on');
  button.click();await settle();
  assert.ok(requested.includes('https://www.youtube.com/*') && requested.includes('https://www.redgifs.com/*'));
  assert.equal(button.textContent,'Revoke access');assert.equal(button.dataset.partial,'false');assert.equal(revoke.hidden,true);
  assert.ok(access.registered[0].matches.includes('https://www.youtube.com/embed/*'));
});

test('Visual Search defaults off, asks for infini.wtf access when turned on, and stays off if refused',async t=>{
  let permRequests=0,grant=true,asked=null;
  const permsApi={
    permissions:{
      async contains(){return true;},
      async request(arg){permRequests++;asked=arg;return grant;},
      async remove(){}
    },
    scripting:{async getRegisteredContentScripts(){return [];},async registerContentScripts(){},async unregisterContentScripts(){}}
  };
  const p=popup(t,{storedTab:'settings',tabs:redditTab,embedAccess:permsApi});
  await settle();
  const doc=p.w.document;
  const toggle=doc.getElementById('visual-search');
  const postMenu=doc.getElementById('visual-search-post-menu');
  const postMenuRow=postMenu.closest('.setting-row');
  const clickRow=doc.getElementById('visual-click').closest('.setting-row');

  assert.equal(toggle.checked,false);
  assert.equal(postMenuRow.hidden,true);
  assert.equal(clickRow.hidden,true);
  assert.equal(postMenu.getAttribute('aria-disabled'),'true');
  assert.ok(doc.getElementById('visual-search-desc').textContent.length<130,'a short description');

  toggle.checked=true;toggle.dispatchEvent(new p.w.Event('change',{bubbles:true}));await settle();
  assert.equal(permRequests,1,'turning it on asks for access (the browser prompts only when it is missing)');
  assert.deepEqual([...asked.origins],['https://infini.wtf/*','https://video.infini.wtf/*']);
  assert.equal(toggle.checked,true);
  assert.equal(p.state['rt-settings-v1'].visualSearch,true);
  assert.equal(postMenuRow.hidden,false);
  assert.equal(clickRow.hidden,false);
  assert.equal(doc.querySelector('[aria-labelledby="visual-search-heading"] .group-count').textContent,'2 of 4 on');

  toggle.checked=false;toggle.dispatchEvent(new p.w.Event('change',{bubbles:true}));await settle();
  assert.equal(permRequests,1,'turning it off asks nothing');
  assert.equal(p.state['rt-settings-v1'].visualSearch,false);
  assert.equal(postMenuRow.hidden,true);

  grant=false;
  toggle.checked=true;toggle.dispatchEvent(new p.w.Event('change',{bubbles:true}));await settle();
  assert.equal(toggle.checked,false,'refused access leaves it off');
  assert.equal(p.state['rt-settings-v1'].visualSearch,false);
  assert.match(doc.getElementById('settings-status').textContent,/infini\.wtf/);
});
