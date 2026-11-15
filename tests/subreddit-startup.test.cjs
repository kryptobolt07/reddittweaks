const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync('extension/profile-notice.js','utf8');
const tick=()=>new Promise(r=>setImmediate(r));
function start(t,{path='/r/gone/',title='r/gone is banned',settings,fail=false}={}){
  const W=new JSDOM('<!doctype html><body><shreddit-app><guard-community-modal subredditname="gone"><div slot="title">'+title+'</div></guard-community-modal></shreddit-app></body>',{url:'https://www.reddit.com'+path,runScripts:'outside-only'}).window;t.after(()=>W.close());
  let resolve,reject,onChange,onMessage;const response=new Promise((a,b)=>{resolve=a;reject=b;});
  W.chrome={runtime:{id:'test',sendMessage:()=>response,onMessage:{addListener:fn=>onMessage=fn}},storage:{onChanged:{addListener:fn=>onChange=fn}}};W.eval(source);
  return {W,modal:W.document.querySelector('guard-community-modal'),answer:()=>fail?reject(Error('offline')):resolve({ok:true,settings:{postDiscovery:true,archiveDiscovery:true,subredditArchive:true,...settings}}),change:value=>onChange({'rt-settings-v1':{newValue:value}},'local'),message:value=>onMessage({scope:'rt-posts',action:'settings-changed',settings:value})};
}
test('a slow settings read cannot flash the native banned/private dialog before automatic mode is known',async t=>{
  for(const title of ['r/gone is banned','r/gone is private'])for(const path of ['/r/gone/','/r/gone/comments/abc12/title/']){
    const c=start(t,{title,path,settings:{subredditArchiveAutomatic:true}});assert.equal(c.modal.style.display,'none');await tick();assert.equal(c.modal.style.display,'none');c.answer();await tick();assert.equal(c.modal.style.display,'none');
  }
});
test('manual/disabled/failing settings release the provisional hold and quarantine is never hidden',async t=>{
  for(const options of [{},{settings:{subredditArchive:false}},{settings:{archiveDiscovery:false}},{settings:{postDiscovery:false}},{fail:true}]){
    const c=start(t,options);c.answer();await tick();assert.equal(c.modal.style.display,'');
  }
  const c=start(t,{title:'r/gone is quarantined',settings:{subredditArchiveAutomatic:true}});assert.equal(c.modal.style.display,'');c.answer();await tick();assert.equal(c.modal.style.display,'');
});
test('settings updates beat a stale startup answer and route changes release held notices',async t=>{
  const c=start(t,{settings:{subredditArchiveAutomatic:true}});c.change({postDiscovery:true,archiveDiscovery:true,subredditArchive:false,subredditArchiveAutomatic:true});c.answer();await tick();assert.equal(c.modal.style.display,'');
  const d=start(t,{settings:{subredditArchiveAutomatic:true}});d.answer();await tick();d.W.history.pushState({},'','/r/live/');d.W.dispatchEvent(new d.W.PopStateEvent('popstate'));assert.equal(d.modal.style.display,'');
});
test('an abandoned archive startup fails open after the bounded hold',async t=>{
  const W=new JSDOM('<!doctype html><body></body>',{url:'https://www.reddit.com/r/gone/',runScripts:'outside-only'}).window;t.after(()=>W.close());let expire;
  W.setTimeout=(fn,ms)=>{if(ms===10000)expire=fn;return 1;};W.chrome={runtime:{id:'test',sendMessage:()=>new Promise(()=>{})}};W.eval(source);
  W.document.body.innerHTML='<guard-community-modal subredditname="gone"><div slot="title">r/gone is banned</div></guard-community-modal>';await tick();const modal=W.document.querySelector('guard-community-modal');assert.equal(modal.style.display,'none');expire();assert.equal(modal.style.display,'');
});

test('forwarded worker settings release an automatic hold when trusted-only storage hides local events',async t=>{
 const c=start(t,{settings:{subredditArchiveAutomatic:true}});c.answer();await tick();assert.equal(c.modal.style.display,'none');
 c.message({postDiscovery:true,archiveDiscovery:true,subredditArchive:false,subredditArchiveAutomatic:true});await tick();assert.equal(c.modal.style.display,'');
 c.message({postDiscovery:true,archiveDiscovery:true,subredditArchive:true,subredditArchiveAutomatic:true});await tick();assert.equal(c.modal.style.display,'none');
});

// Reddit's user hover card (captured 2026-11-15): a suspended account's name and picture are not links.
const suspendedCard=name=>`<faceplate-hovercard data-id="user-hover-card" label="${name} details"><span class="author-hovercard-trigger">x</span><div slot="content"><div class="user-hover-card w-[272px]" data-testid="user-hover-card"><div class="p-md flex flex-col"><div class="flex flex-row justify-items-start items-center"><div class="me-sm"><img src="https://www.redditstatic.com/shreddit/assets/suspended-snoo.png" alt="u/${name} avatar" class="mb-0" width="34" height="57"></div><div class="flex flex-col max-w-[calc(100%-60px)] -me-2xs"><div class="flex overflow-hidden text-ellipsis w-[calc(100%+4px)]"><div class="flex items-center"><span class="font-bold text-18 text-neutral-content-strong" dir="auto">${name}</span></div></div><div class="flex items-start justify-start text-neutral-content-weak"><span class="truncate" dir="auto">u/${name}</span></div></div></div><hr><div class="flex flex-wrap"><div class="text-16 font-bold"> Account suspended </div></div></div></div></div></faceplate-hovercard>`;
test('a suspended account’s hover card links its name and picture to the profile, like a live account’s card',async t=>{
  const c=start(t,{path:'/r/techIndia/comments/1xwlzrn/comment/19sns0b6zt9pd/'});c.answer();await tick();
  c.W.document.body.insertAdjacentHTML('beforeend',suspendedCard('This-Bet3831'));await tick();
  const card=c.W.document.querySelector('[data-testid="user-hover-card"]'),name=card.querySelector('a.text-18');
  assert.ok(name,'the name is a link');assert.equal(name.getAttribute('href'),'/user/This-Bet3831/');assert.equal(name.target,'_blank','opens like Reddit’s own card');
  assert.match(name.className,/inline-flex items-center font-bold text-18 text-neutral-content-strong a no-visited hover:underline cursor-pointer/);assert.equal(name.querySelector('[data-testid="nameplate"] .truncate').textContent,'This-Bet3831');
  const picture=card.querySelector('img[src*="suspended-snoo"]');assert.equal(picture.closest('a')?.getAttribute('href'),'/user/This-Bet3831/');
  c.W.document.body.insertAdjacentHTML('beforeend',suspendedCard('Second_One'));await tick();assert.equal(c.W.document.querySelectorAll('[data-testid="user-hover-card"] a.text-18').length,2,'every card that appears');
  // A live card already links; it is left alone. Turning the feature off stops new links.
  const off=start(t,{settings:{postDiscovery:false}});off.answer();await tick();off.W.document.body.insertAdjacentHTML('beforeend',suspendedCard('This-Bet3831'));await tick();assert.equal(off.W.document.querySelector('[data-testid="user-hover-card"] a'),null);
});
test('cards for live accounts and unreadable names are never changed',async t=>{
  const c=start(t);c.answer();await tick();
  c.W.document.body.insertAdjacentHTML('beforeend','<div data-testid="user-hover-card"><a class="text-18" href="/user/spez/">spez</a><div>Post karma</div></div>'+suspendedCard('bad name!'));await tick();
  assert.equal(c.W.document.querySelectorAll('[data-testid="user-hover-card"] a').length,1);
});
