const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');

const read=name=>fs.readFileSync('extension/'+name,'utf8');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const card=id=>`<article><shreddit-post id="t3_${id}" post-type="image" nsfw content-href="https://i.redd.it/example.png"><shreddit-post-overflow-menu post-id="t3_${id}"><button aria-label="Open user actions">⋯</button></shreddit-post-overflow-menu></shreddit-post></article>`;
const sheet=()=>'<div id="post-overflow-menu-bottom-sheet"><div class="post-overflow-menu-bottom-sheet"></div></div>';
function setup(t,files) {
  const {window:W}=new JSDOM('<shreddit-app><main><shreddit-feed>'+card('abc')+'</shreddit-feed></main></shreddit-app>',{
    url:'https://www.reddit.com/r/Example/?rt_nsfw=1',runScripts:'outside-only'
  });
  const cleanup=[];
  t.after(()=>{for(const dispose of cleanup)dispose();W.close();});
  const scripts=JSON.parse(read('manifest.json')).content_scripts.flatMap(block=>block.js);
  if(scripts.includes('post-menu-dom.js'))W.eval(read('post-menu-dom.js'));
  for(const name of files)W.eval(read(name));
  return {W,D:W.document,cleanup,app:W.document.querySelector('shreddit-app'),feed:W.document.querySelector('shreddit-feed')};
}
function countMethod(object,name) {
  const original=object[name];let calls=0;
  object[name]=function(...args){calls++;return original.apply(this,args);};
  return ()=>calls;
}

test('post menu mount, update and close do not rescan a filtered feed, but a simultaneous page of posts still does',async t=>{
  const {W,D,cleanup,app,feed}=setup(t,['post-model.js','feed-filters.js','feed-sheet.js','live-subreddit-filters.js']);
  const controller=new W.RTLiveSubredditFilters.Controller();
  cleanup.push(()=>controller.destroy());
  await flush();
  const calls=countMethod(controller,'refresh');
  app.insertAdjacentHTML('beforeend',sheet());
  const portal=D.getElementById('post-overflow-menu-bottom-sheet');
  portal.firstElementChild.append(D.createElement('li'));
  await flush();
  portal.firstElementChild.replaceChildren();
  portal.remove();
  await flush();
  assert.equal(calls(),0);

  app.insertAdjacentHTML('beforeend',sheet());
  feed.insertAdjacentHTML('beforeend',card('def').replace(' nsfw',''));
  await flush();
  assert.equal(calls(),1);
  assert.ok(D.getElementById('t3_def').parentElement.hasAttribute('data-rt-community-filtered'));

  const menu=D.querySelector('shreddit-post-overflow-menu');
  menu.append(D.createElement('div'));
  await flush();
  assert.equal(calls(),1,'the inline desktop menu also leaves the feed alone');
});

test('NSFW-only filtering never inspects the media DOM to infer a post type',t=>{
  const {W,D,cleanup}=setup(t,['post-model.js','feed-filters.js','feed-sheet.js']);
  const original=W.RTFeedFilters;let typeReads=0;
  W.RTFeedFilters={...original,inferType(...args){typeReads++;return original.inferType(...args);}};
  W.eval(read('live-subreddit-filters.js'));
  const controller=new W.RTLiveSubredditFilters.Controller();
  cleanup.push(()=>controller.destroy());
  assert.equal(typeReads,0);
  assert.equal(D.querySelector('[data-rt-community-filtered]'),null);
});

test('raffle menu press and download/raffle sheet updates do not rescan every post',async t=>{
  const {W,D,cleanup,app,feed}=setup(t,['post-model.js','feed-filters.js','raffle-model.js','raffle-ui.js','download-model.js','download-ui.js']);
  const raffle=new W.RTRaffle.Raffle({readSettings:async()=>({raffles:true}),raffler:async()=>({ok:true})});
  const download=new W.RTDownloadUI.Download({mobile:true});
  cleanup.push(()=>{raffle.destroy();download.destroy();});
  download.sync();
  await raffle.ready;
  await flush();
  const raffleScans=countMethod(raffle,'sync'),downloadScans=countMethod(download,'sync');
  const menu=D.querySelector('shreddit-post-overflow-menu'),trigger=menu.querySelector('button');
  const item=menu.querySelector('[data-rt-raffle="item"]');
  assert.ok(item);
  assert.ok(menu.querySelector('[data-rt-download="item"]'));
  item.remove();
  trigger.dispatchEvent(new W.Event('pointerdown',{bubbles:true,composed:true}));
  assert.ok(menu.querySelector('[data-rt-raffle="item"]'),'raffle item is ready for the same press');
  app.insertAdjacentHTML('beforeend',sheet());
  const portal=D.getElementById('post-overflow-menu-bottom-sheet').firstElementChild;
  for(let i=0;i<2;i++)portal.append(menu.querySelector('[slot="devvit-context-actions"]').cloneNode(true));
  await flush();
  assert.equal(raffleScans(),0);
  assert.equal(downloadScans(),0);
  assert.equal(portal.querySelectorAll('[data-rt-raffle="item"]').length,1);
  assert.equal(portal.querySelectorAll('[data-rt-download="item"]').length,1);

  feed.insertAdjacentHTML('beforeend',card('def'));
  await flush();
  assert.ok(D.querySelector('#t3_def [data-rt-raffle="item"]'));
  assert.ok(D.querySelector('#t3_def [data-rt-download="item"]'));
});

test('post menu mutations do not wake account-menu discovery, but mounting the account menu does',async t=>{
  const {W,D,cleanup,app}=setup(t,['account-switcher.js']);
  app.setAttribute('user-logged-in','true');
  app.setAttribute('logged-in-user-id','t2_example');
  const switcher=new W.RTAccountSwitcher.Switcher({send:async()=>({ok:true,accounts:[{owner:'t2_example',username:'Example'}]})});
  cleanup.push(()=>switcher.destroy());
  await switcher.ready;
  await flush();
  const scans=countMethod(switcher,'scan');
  app.insertAdjacentHTML('beforeend',sheet());
  await flush();
  assert.equal(scans(),0);

  const portal=D.getElementById('post-overflow-menu-bottom-sheet');
  const drawer=D.createElement('div');
  drawer.id='hui-user-drawer-bottom-sheet';
  drawer.innerHTML='<ul><li><a href="/user/Example/">View Profile</a></li></ul>';
  app.replaceChildren(portal,drawer);
  await flush();
  assert.ok(scans()>0,'mixed records still discover the account drawer');
  assert.ok(drawer.querySelector('[data-rt-ui="accounts"]'));
});

test('the raffle dialog can open and hydrate without rechecking the community feed',async t=>{
  const {W,D,cleanup}=setup(t,['post-model.js','feed-filters.js','feed-sheet.js','live-subreddit-filters.js']);
  const controller=new W.RTLiveSubredditFilters.Controller();
  cleanup.push(()=>controller.destroy());
  await flush();
  const calls=countMethod(controller,'refresh');
  D.body.insertAdjacentHTML('beforeend','<dialog data-rt-raffle="dialog"><p>Loading</p></dialog>');
  await flush();
  D.querySelector('dialog p').replaceWith(D.createElement('form'));
  await flush();
  D.querySelector('dialog').remove();
  await flush();
  assert.equal(calls(),0);
});

test('a late native action slot does not discard the sole download and raffle rows',async t=>{
  const {W,D,cleanup,app}=setup(t,['post-model.js','feed-filters.js','raffle-model.js','raffle-ui.js','download-model.js','download-ui.js']);
  const raffle=new W.RTRaffle.Raffle({readSettings:async()=>({raffles:true})});
  const download=new W.RTDownloadUI.Download({mobile:true});
  cleanup.push(()=>{raffle.destroy();download.destroy();});
  download.sync();await raffle.ready;await flush();
  const menu=D.querySelector('shreddit-post-overflow-menu');
  const projected=menu.querySelector('[slot="devvit-context-actions"]').cloneNode(true);
  const portal=D.createElement('div');portal.id='post-overflow-menu-bottom-sheet';
  const nativeSlot=D.createElement('div');nativeSlot.setAttribute('slot','devvit-context-actions');
  portal.append(nativeSlot,projected);app.append(portal);
  await flush();
  nativeSlot.append(D.createElement('shreddit-async-loader'));
  await flush();
  assert.equal(nativeSlot.querySelectorAll('[data-rt-raffle="item"]').length,1);
  assert.equal(nativeSlot.querySelectorAll('[data-rt-download="item"]').length,1);
  assert.equal(portal.querySelectorAll('[data-rt-ui$="menu-item"]').length,2);
});

test('overflow menu clamps shadow dropdowns, coalesces resize recalculations, and collapses >2 extension actions into Reddit Tweaks ›',async t=>{
  const {W,D,cleanup}=setup(t,['post-model.js','feed-filters.js','raffle-model.js','raffle-ui.js','download-model.js','download-ui.js']);
  const menu=D.querySelector('shreddit-post-overflow-menu');
  const shadow=menu.attachShadow({mode:'open'});
  shadow.innerHTML='<rpl-dropdown open><faceplate-menu slot="content"><slot name="devvit-context-actions"></slot></faceplate-menu></rpl-dropdown>';
  let resizes=0;
  W.addEventListener('resize',()=>{resizes++;});
  const raffle=new W.RTRaffle.Raffle({readSettings:async()=>({raffles:true})});
  const download=new W.RTDownloadUI.Download({mobile:true});
  cleanup.push(()=>{raffle.destroy();download.destroy();});
  download.sync();await raffle.ready;await flush();
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.ok(shadow.querySelector('style[data-rt-menu-clamp]'),'viewport clamp injected into shadowRoot');
  assert.match(shadow.querySelector('style[data-rt-menu-clamp]').textContent,/max-height:\s*calc\(100vh - 80px\)/);
  assert.ok(resizes>=1,'coalesced resize fired for open overflow menu');

  const slot=menu.querySelector('[slot="devvit-context-actions"]');
  assert.equal(slot.querySelector('[data-rt-menu-group="trigger"]'),null,'<=2 actions render directly');
  const extra=D.createElement('li');extra.dataset.rtMenuAction='custom';extra.innerHTML='<div role="menuitem"><span class="text-body-2">Extra tweak</span></div>';
  slot.append(extra);
  W.RTPostMenuDOM.reconcile(slot);
  const trigger=slot.querySelector('[data-rt-menu-group="trigger"]');
  assert.ok(trigger,'>2 extension actions collapse into Reddit Tweaks ›');
  assert.equal(trigger.querySelector('.text-body-2').textContent,'Reddit Tweaks');
  assert.equal(slot.querySelectorAll(':scope > [data-rt-menu-action]').length,0,'direct actions moved into collapsed group');

  trigger.querySelector('[role="menuitem"]').click();
  const flyout=D.querySelector('[data-rt-menu-group="flyout"]');
  assert.ok(flyout,'clicking trigger opens desktop flyout');
  assert.equal(flyout.querySelectorAll('[data-rt-menu-action]').length,3);
  W.RTPostMenuDOM.closeSubmenu();
  assert.equal(D.querySelector('[data-rt-menu-group="flyout"]'),null);

  extra.remove();
  W.RTPostMenuDOM.reconcile(slot);
  assert.equal(slot.querySelector('[data-rt-menu-group="trigger"]'),null,'unwraps cleanly when back to <=2 actions');
  assert.equal(slot.querySelectorAll(':scope > [data-rt-menu-action]').length,2);

  // Mobile bottom sheet >2 actions drills in-place with a single-line Back row.
  const portal=D.createElement('div');portal.id='post-overflow-menu-bottom-sheet';
  const sheetBody=D.createElement('div');sheetBody.className='post-overflow-menu-bottom-sheet';
  const sheetSlot=D.createElement('div');sheetSlot.setAttribute('slot','devvit-context-actions');
  for(const key of ['raffle','download','custom']){
    const li=D.createElement('li');li.dataset.rtMenuAction=key;
    li.innerHTML='<div role="menuitem"><span class="text-body-2">'+key+'</span></div>';
    sheetSlot.append(li);
  }
  sheetBody.append(sheetSlot);portal.append(sheetBody);D.body.append(portal);
  W.RTPostMenuDOM.reconcile(sheetSlot);
  const sheetTrigger=sheetSlot.querySelector('[data-rt-menu-group="trigger"]');
  assert.ok(sheetTrigger,'mobile bottom sheet collapses >2 actions into Reddit Tweaks ›');
  sheetTrigger.querySelector('[role="menuitem"]').click();
  const panel=sheetBody.querySelector('.rt-menu-sheet-panel');
  assert.ok(panel,'opens in-place sheet panel on mobile');
  assert.equal(sheetSlot.style.display,'none');
  assert.equal(panel.querySelectorAll('[data-rt-menu-action]').length,3);
  panel.querySelector('[data-rt-menu-group="back"] [role="menuitem"]').click();
  assert.equal(sheetBody.querySelector('.rt-menu-sheet-panel'),null);
  assert.equal(sheetSlot.style.display,'');
});
