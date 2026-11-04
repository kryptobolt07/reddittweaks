const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync('extension/profile-notice.js','utf8');
const tick=()=>new Promise(r=>setImmediate(r));
function start(t,{path='/r/gone/',title='r/gone is banned',settings,fail=false}={}){
  const W=new JSDOM('<!doctype html><body><shreddit-app><guard-community-modal subredditname="gone"><div slot="title">'+title+'</div></guard-community-modal></shreddit-app></body>',{url:'https://www.reddit.com'+path,runScripts:'outside-only'}).window;t.after(()=>W.close());
  let resolve,reject,onChange;const response=new Promise((a,b)=>{resolve=a;reject=b;});
  W.chrome={runtime:{id:'test',sendMessage:()=>response},storage:{onChanged:{addListener:fn=>onChange=fn}}};W.eval(source);
  return {W,modal:W.document.querySelector('guard-community-modal'),answer:()=>fail?reject(Error('offline')):resolve({ok:true,settings:{postDiscovery:true,archiveDiscovery:true,subredditArchive:true,...settings}}),change:value=>onChange({'rt-settings-v1':{newValue:value}},'local')};
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
