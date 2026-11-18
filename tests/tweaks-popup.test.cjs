const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');

const html=fs.readFileSync(path.join(__dirname,'../extension/popup.html'),'utf8');
const script=fs.readFileSync(path.join(__dirname,'../extension/popup.js'),'utf8');
const settle=()=>new Promise(resolve=>setTimeout(resolve,0));

function popup(t,{settings,storageFailure=false,runtimeFailure=false,tabs,storedTab}={}){
  const dom=new JSDOM(html,{runScripts:'outside-only',url:'https://extension.test/popup.html'}),w=dom.window;t.after(w.close.bind(w));if(storedTab)w.localStorage.setItem('rt-popup-tab',storedTab);
  const messages=[],state={...(settings||{})};
  w.chrome={storage:{local:{
    async get(key){if(storageFailure)throw Error('storage read failed');return {[key]:state[key]};},
    async set(values){if(storageFailure)throw Error('storage write failed');Object.assign(state,values);}
  }},runtime:{async sendMessage(request){messages.push(request);if(runtimeFailure)throw Error('runtime failed');return request.action==='stats'?{ok:true,stats:{messages:42,rooms:3,approxBytes:2048}}:{ok:true};}}};
  w.chrome.tabs=tabs;w.eval(script);
  return {w,state,messages};
}

test('Reddit Tweaks popup loads defaults and persists individual changes while preserving other settings',async t=>{
  const p=popup(t);await settle();
  const post=p.w.document.querySelector('#post-discovery'),archive=p.w.document.querySelector('#archive-discovery'),restore=p.w.document.querySelector('#restore-deleted-content');
  assert.equal(post.checked,true);assert.equal(archive.checked,false);assert.equal(restore.checked,true);
  archive.checked=true;archive.dispatchEvent(new p.w.Event('change'));
  await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(p.state['rt-settings-v1'])),{postDiscovery:true,archiveDiscovery:true,restoreDeletedContent:true,subredditArchive:false,subredditArchiveAutomatic:false,cleanShareLinks:false,modUnapprovedFilter:true,raffles:true,ownRemoval:false,removalNotifications:false,smoothFeeds:true,smoothHome:true,smoothSubreddits:true,smoothProfiles:true,smoothSearch:true,smoothComments:false,videoRespectAutoplay:true,videoPauseOffscreen:true});
  post.checked=false;post.dispatchEvent(new p.w.Event('change'));
  await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(p.state['rt-settings-v1'])),{postDiscovery:false,archiveDiscovery:true,restoreDeletedContent:true,subredditArchive:false,subredditArchiveAutomatic:false,cleanShareLinks:false,modUnapprovedFilter:true,raffles:true,ownRemoval:false,removalNotifications:false,smoothFeeds:true,smoothHome:true,smoothSubreddits:true,smoothProfiles:true,smoothSearch:true,smoothComments:false,videoRespectAutoplay:true,videoPauseOffscreen:true});
  assert.equal(p.w.document.querySelector('#settings-status').textContent,'Settings saved automatically.');
});

test('automatic restoration stays independent of archive opt-in and serialized writes preserve unknown fields',async t=>{
  const p=popup(t,{settings:{'rt-settings-v1':{archiveDiscovery:false,restoreDeletedContent:false,futureOption:'preserve'}}});await settle();
  const restore=p.w.document.querySelector('#restore-deleted-content'),post=p.w.document.querySelector('#post-discovery');
  assert.equal(restore.checked,false);assert.equal(restore.closest('.setting-row').hidden,true,'folds away until the archive is on');
  restore.checked=true;restore.dispatchEvent(new p.w.Event('change'));post.checked=false;post.dispatchEvent(new p.w.Event('change'));await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(p.state['rt-settings-v1'])),{postDiscovery:false,archiveDiscovery:false,restoreDeletedContent:true,subredditArchive:false,subredditArchiveAutomatic:false,cleanShareLinks:false,modUnapprovedFilter:true,raffles:true,ownRemoval:false,removalNotifications:false,smoothFeeds:true,smoothHome:true,smoothSubreddits:true,smoothProfiles:true,smoothSearch:true,smoothComments:false,videoRespectAutoplay:true,videoPauseOffscreen:true,futureOption:'preserve'});
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

test('Redaction opens in the active Reddit tab by message, without changing its address (no Reddit re-render)',async t=>{
 const updated=[],created=[],sent=[],p=popup(t,{tabs:{async query(){return [{id:7,url:'https://www.reddit.com/r/Alpha/comments/abc/title/?sort=new'}];},async sendMessage(id,message,options){sent.push({id,message,options});return {ok:true,opened:true};},async update(id,options){updated.push({id,...options});},async create(options){created.push(options);}}});let closed=false;p.w.close=()=>{closed=true;};await settle();
 const button=p.w.document.getElementById('open-redaction');assert.equal(button.closest('section').getAttribute('aria-labelledby'),'redaction-heading');button.click();await settle();
 assert.deepEqual(JSON.parse(JSON.stringify(sent)),[{id:7,message:{scope:'rt-redact',action:'open'},options:{frameId:0}}]);assert.equal(updated.length,0,'the tab address is never touched');assert.equal(created.length,0);assert.equal(closed,true);
});
test('Redaction falls back to the address fragment only when the page has no connected script',async t=>{
 const updated=[],p=popup(t,{tabs:{async query(){return [{id:7,url:'https://www.reddit.com/r/Alpha/'}];},async sendMessage(){throw Error('Could not establish connection. Receiving end does not exist.');},async update(id,options){updated.push({id,...options});}}});p.w.close=()=>{};await settle();
 p.w.document.getElementById('open-redaction').click();await settle();assert.deepEqual(updated,[{id:7,url:'https://www.reddit.com/r/Alpha/#rt-redact'}]);
});
test('Redaction uses the own-profile fallback outside Reddit and reports tab failures',async t=>{
 const created=[],p=popup(t,{tabs:{async query(){return [{id:8,url:'https://example.test/'}];},async create(options){created.push(options);}}});p.w.close=()=>{};await settle();p.w.document.getElementById('open-redaction').click();await settle();assert.deepEqual(JSON.parse(JSON.stringify(created)),[{url:'https://www.reddit.com/user/me/#rt-redact'}]);
 const broken=popup(t,{tabs:{async query(){throw Error('unavailable');}}});await settle();broken.w.document.getElementById('open-redaction').click();await settle();assert.match(broken.w.document.getElementById('redaction-open-status').textContent,/Couldn’t open/);assert.equal(broken.w.document.getElementById('open-redaction').disabled,false);
});

// --- 0.36 popup redesign: tabs, a Home of things to run, grouped settings, data on its own tab
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
  // Sections live in their tabs.
  assert.ok(panel('home').contains(doc.getElementById('open-redaction')));assert.ok(panel('settings').contains(doc.getElementById('post-discovery')));assert.ok(panel('data').contains(doc.getElementById('clear-messages')));
});
test('Home: a plain Redaction card: no step list, badge icon or destination text',async t=>{
  const p=popup(t,{tabs:redditTab});await settle();const doc=p.w.document,card=doc.getElementById('open-redaction').closest('section');
  assert.equal(card.getAttribute('aria-labelledby'),'redaction-heading');assert.equal(doc.getElementById('open-redaction').textContent.trim(),'Start redaction');
  assert.match(doc.getElementById('open-redaction-desc').textContent,/until you confirm/);
  for(const gone of ['.steps','.safety','#redaction-destination'])assert.equal(doc.querySelector(gone),null,gone);
  assert.equal(doc.getElementById('open-redaction').getAttribute('aria-describedby'),'open-redaction-desc');
});
test('Home: Raffles explains where to find them and can be turned on in place',async t=>{
  const p=popup(t,{tabs:redditTab,settings:{'rt-settings-v1':{raffles:false}}});await settle();const doc=p.w.document,card=doc.getElementById('raffles-home');
  assert.match(card.textContent,/⋯ menu/);assert.equal(card.querySelector('.state-pill').textContent,'Off');const turnOn=doc.getElementById('raffles-turn-on');assert.equal(turnOn.hidden,false);
  turnOn.click();await settle();assert.equal(p.state['rt-settings-v1'].raffles,true);assert.equal(doc.getElementById('raffles').checked,true);assert.equal(card.querySelector('.state-pill').textContent,'On');assert.equal(turnOn.hidden,true);
});
test('Home summarises active features and Manage opens Settings; each settings group counts what is on',async t=>{
  const p=popup(t,{tabs:redditTab});await settle();const doc=p.w.document;
  assert.equal(doc.getElementById('feature-summary').textContent,'6 of 13 features on','dependent options whose parent is off do not count; Smooth scrolling and both video options are on by default');
  doc.getElementById('manage-features').click();assert.equal(doc.getElementById('panel-settings').hidden,false);
  const count=id=>doc.querySelector('[aria-labelledby="'+id+'"] .group-count').textContent;
  assert.equal(count('reddit-heading'),'5 of 6 on');assert.equal(count('tools-heading'),'1 of 1 on');assert.equal(count('archive-heading'),'0 of 4 on');
  const archive=doc.getElementById('archive-discovery');archive.checked=true;archive.dispatchEvent(new p.w.Event('change',{bubbles:true}));
  assert.equal(count('archive-heading'),'2 of 4 on','the archive and its already-on restore option');assert.equal(doc.getElementById('feature-summary').textContent,'8 of 13 features on');
});
test('popup styles: fluid width and larger targets on touch screens, tabs in both themes',()=>{
  const css=fs.readFileSync(path.join(__dirname,'../extension/popup.css'),'utf8');
  // One size for every tab: panels share a fixed height and scroll without a visible scrollbar; the page never scrolls.
  assert.match(css,/\.panel\{[^}]*height:240px[^}]*overflow-y:auto[^}]*scrollbar-width:none/,'measured: Home 238 px and Data 240 px fill it');
  assert.match(css,/\.panel\[data-more=end\]\{[^}]*mask-image:linear-gradient/);assert.match(css,/#cache-status:empty\{display:none\}/);assert.match(css,/\.panel::-webkit-scrollbar\{display:none\}/);
  assert.match(css,/html\{[^}]*overflow:hidden/);assert.doesNotMatch(css,/\.safety|\.steps|\.destination/);
  assert.match(css,/@media\(hover:none\) and \(pointer:coarse\)\{[^@]*html,body\{width:auto;min-width:0/);assert.match(css,/@media\(hover:none\) and \(pointer:coarse\)\{[^@]*\.tab\{[^}]*min-height:44px/);
  assert.match(css,/\.tab\[aria-selected="true"\]\{/);
});
test('a tab taller than the popup fades at the edge that has more, instead of showing a scrollbar',async t=>{
  const p=popup(t,{tabs:redditTab});await settle();const panel=p.w.document.getElementById('panel-settings');p.w.document.getElementById('tab-settings').click();
  Object.defineProperty(panel,'scrollHeight',{configurable:true,value:600});Object.defineProperty(panel,'clientHeight',{configurable:true,value:240});
  panel.dispatchEvent(new p.w.Event('scroll'));assert.equal(panel.dataset.more,'end');
  panel.scrollTop=100;panel.dispatchEvent(new p.w.Event('scroll'));assert.equal(panel.dataset.more,'both');
  panel.scrollTop=360;panel.dispatchEvent(new p.w.Event('scroll'));assert.equal(panel.dataset.more,'start');
  assert.match(p.w.document.querySelector('#raffles-home').textContent,/⋯ menu/);
});
