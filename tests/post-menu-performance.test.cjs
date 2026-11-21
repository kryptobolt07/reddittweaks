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
