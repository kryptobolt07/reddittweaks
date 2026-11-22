const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const {JSDOM}=require('jsdom');
const settle=async()=>{for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r));};
async function setup(t,{active=true,profilePost=false,stored={},failSave=false}={}){
  const dom=new JSDOM(fs.readFileSync('extension/popup.html','utf8'),{url:'https://extension.test/popup.html',runScripts:'outside-only'}),W=dom.window,calls=[],opened=[],storage={...stored};
  t.after(()=>W.close());
  W.chrome={
    storage:{local:{async get(k){return {[k]:storage[k]};},async set(v){if(failSave)throw Error('storage unavailable');Object.assign(storage,v);}}},
    tabs:{async query(){return active?[{id:1,url:'https://www.reddit.com/'}]:[];},async create(v){opened.push(v);}},
    runtime:{async sendMessage(m){
      calls.push(m);
      if(m.scope==='rt-removal'){
        if(!active)return {ok:false,error:'Open a signed-in Reddit tab'};
        return {ok:true,value:{username:'Example',owner:'t2_self',items:{t3_a:{state:'unknown'}},unread:m.action==='seen'?0:1,lastChecked:Date.now(),changes:[{type:'removed',state:'removed-auto',confidence:'likely',why:'The archive saw a removal',permalink:profilePost?'/user/Example/comments/post1/title/':'/r/Alpha/comments/post1/title/',checkedAt:Date.now()}]}};
      }
      return m.action==='stats'?{ok:true,stats:{messages:0,rooms:0}}:{ok:true};
    }}
  };
  W.eval(fs.readFileSync('extension/post-model.js','utf8'));
  W.eval(fs.readFileSync('extension/popup.js','utf8'));
  await settle();
  return {W,calls,opened,storage};
}

test('monitoring defaults off, has separate dependent notification control, and describes browsing limits',async t=>{
  const s=await setup(t),d=s.W.document;
  assert.equal(d.querySelector('#own-removal').checked,false);
  assert.equal(d.querySelector('#removal-notifications').checked,false);
  assert.equal(d.querySelector('#removal-notifications').closest('.setting-row').hidden,true);
  assert.match(d.querySelector('#own-removal-desc').textContent,/brows/i);
  d.querySelector('#own-removal').click();await settle();
  assert.equal(s.storage['rt-settings-v1'].ownRemoval,true);
  assert.equal(d.querySelector('#removal-notifications').closest('.setting-row').hidden,false);
});

test('the popup no longer shows the removed-content summary, link or recent changes; Removed lives on your profile',async t=>{
  const s=await setup(t),d=s.W.document;
  for(const id of ['removal-home-heading','removal-summary','open-removed','removal-history-toggle','removal-history'])assert.equal(d.getElementById(id),null,id);
  assert.equal(s.calls.some(m=>m.scope==='rt-removal'&&m.action==='seen'),false,'opening the popup acknowledges nothing');
});

test('without an active Reddit identity the clear button stays disabled',async t=>{
  const s=await setup(t,{active:false}),d=s.W.document;
  assert.equal(d.querySelector('#clear-removal-history').disabled,true);
});

test('clearing removal history stays in Your Removed Content settings, needs a second click and identifies the current account scope',async t=>{
  const s=await setup(t),d=s.W.document,b=d.querySelector('#clear-removal-history');
  assert.ok(b.closest('[aria-labelledby="removal-settings-heading"]'),'kept with the removal settings');
  assert.equal(b.disabled,true);
  d.querySelector('#tab-settings').click();await settle();
  assert.deepEqual(s.calls.filter(m=>m.scope==='rt-removal').map(m=>m.action),['identity']);
  assert.equal(b.disabled,false);
  b.click();assert.equal(s.calls.some(m=>m.action==='clear'),false);assert.match(b.textContent,/Confirm/);
  d.querySelector('#tab-home').click();d.querySelector('#tab-settings').click();await settle();
  assert.match(b.textContent,/Clear this account/,'reopening Settings requires a new confirmation');
  b.click();b.click();await settle();
  assert.ok(s.calls.some(m=>m.scope==='rt-removal'&&m.action==='clear'&&m.tabId===1&&m.owner==='t2_self'));
});

test('History length uses a themed radio menu and saves choices while preserving other settings',async t=>{
  const s=await setup(t),d=s.W.document,b=d.querySelector('#history-limit');
  assert.equal(b.tagName,'BUTTON');assert.equal(b.getAttribute('aria-haspopup'),'menu');
  assert.equal(b.closest('.setting-row').dataset.requires,'post-discovery');
  assert.equal(d.querySelector('select#history-limit'),null);
  b.click();
  const menu=d.getElementById(b.getAttribute('aria-controls')),options=[...menu.querySelectorAll('[role="menuitemradio"]')];
  assert.equal(menu.hidden,false);
  assert.deepEqual(options.map(o=>o.dataset.value),['20','100','500','1000','5000','0']);
  assert.equal(options[0].getAttribute('aria-checked'),'true');
  options[5].click();await settle();
  assert.equal(s.storage['rt-settings-v1'].historyLimit,0);
  assert.match(b.textContent,/No limit/);assert.equal(menu.hidden,true);
  b.click();options[3].click();await settle();
  assert.equal(s.storage['rt-settings-v1'].historyLimit,1000);
  assert.equal(s.storage['rt-settings-v1'].postDiscovery,true);
});

test('History picker supports keyboard selection, Escape and outside dismissal',async t=>{
  const s=await setup(t),d=s.W.document,b=d.getElementById('history-limit');
  b.dispatchEvent(new s.W.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));
  const menu=d.getElementById(b.getAttribute('aria-controls'));
  assert.equal(menu.hidden,false);assert.equal(d.activeElement.dataset.value,'20');
  d.activeElement.dispatchEvent(new s.W.KeyboardEvent('keydown',{key:'End',bubbles:true}));
  assert.equal(d.activeElement.dataset.value,'0');
  d.activeElement.dispatchEvent(new s.W.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  assert.equal(menu.hidden,true);assert.equal(d.activeElement,b);
  b.click();d.body.click();assert.equal(menu.hidden,true);
});

test('failed History saves keep the last stored selection and allow retry',async t=>{
  const s=await setup(t,{stored:{'rt-settings-v1':{postDiscovery:true,historyLimit:500}},failSave:true}),d=s.W.document,b=d.getElementById('history-limit');
  b.click();d.querySelector('#history-limit-menu [data-value="1000"]').click();await settle();
  assert.equal(s.storage['rt-settings-v1'].historyLimit,500);
  assert.match(b.textContent,/500/);assert.equal(b.disabled,false);
  assert.match(d.getElementById('settings-status').textContent,/Could not save/);
});

test('History menu escapes the masked settings panel, uses uniform rows and stays inside a short popup',async t=>{
  const s=await setup(t),d=s.W.document,b=d.getElementById('history-limit'),menu=d.getElementById('history-limit-menu');
  Object.defineProperty(s.W,'innerWidth',{value:250});Object.defineProperty(s.W,'innerHeight',{value:160});
  b.getBoundingClientRect=()=>({right:240,bottom:140});menu.getBoundingClientRect=()=>({height:190,width:164});
  b.click();
  assert.equal(menu.parentElement,d.body);assert.equal(menu.closest('.panel'),null);
  const options=[...menu.querySelectorAll('[role="menuitemradio"]')];
  assert.equal(options[0].textContent.trim(),'20');
  assert.ok(options.every(o=>!o.querySelector('span')),'all options are a single line');
  assert.ok(Number.parseFloat(menu.style.maxHeight)<=144);
  assert.ok(Number.parseFloat(menu.style.top)+Number.parseFloat(menu.style.maxHeight)<=152);
  assert.ok(Number.parseFloat(menu.style.left)+Number.parseFloat(menu.style.width)<=242);
  menu.dispatchEvent(new s.W.Event('scroll'));assert.equal(menu.hidden,false,'scrolling the overlay does not dismiss it');
});

test('Performance consolidates smooth scrolling into one Feeds toggle with nested Beta Long comment threads',async t=>{
  const s=await setup(t),d=s.W.document,box=d.querySelector('#smooth-feeds');await settle();
  assert.ok(box);assert.equal(box.dataset.setting,'smoothFeeds');assert.equal(box.checked,true);
  assert.equal(box.closest('section').getAttribute('aria-labelledby'),'performance-heading');
  assert.equal(box.closest('.setting-row').dataset.requires,undefined);
  const subs=[...d.querySelectorAll('.setting-row[data-requires="smooth-feeds"]')];
  assert.deepEqual(subs.map(r=>r.querySelector('input').dataset.setting+':'+r.querySelector('input').checked),['smoothComments:false']);
  assert.equal(subs[0].dataset.level,'2');
  assert.equal(subs[0].querySelector('.badge-beta')?.textContent,'Beta');
  d.querySelector('#smooth-comments').click();await settle();
  assert.equal(s.storage['rt-settings-v1'].smoothComments,true);
  box.click();await settle();
  assert.equal(s.storage['rt-settings-v1'].smoothFeeds,false);
  assert.equal(subs[0].hidden,true,'nested comment option folds away when smoothFeeds is off');
});
