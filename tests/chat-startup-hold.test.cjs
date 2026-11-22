const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
function setup(t){
 const W=new JSDOM('<body><rs-app><rs-rooms-nav></rs-rooms-nav></rs-app></body>',{url:'https://www.reddit.com/chat',runScripts:'outside-only',pretendToBeVisual:true}).window;t.after(()=>W.close());
 let now=0,next=0;const timers=new Map();W.Date.now=()=>now;W.setTimeout=(fn,ms)=>{timers.set(++next,{fn,at:now+ms});return next;};W.clearTimeout=id=>timers.delete(id);
 const tick=ms=>{const end=now+ms;for(;;){const entry=[...timers].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!entry)break;now=entry[1].at;timers.delete(entry[0]);entry[1].fn();}now=end;};
 const nav=W.document.querySelector('rs-rooms-nav'),root=nav.attachShadow({mode:'open'});root.innerHTML='<rs-virtual-scroll></rs-virtual-scroll>';const scroller=root.firstElementChild;scroller.attachShadow({mode:'open'});
 const rect=(top,height)=>({x:0,y:top,top,bottom:top+height,left:0,right:300,width:300,height});nav.getBoundingClientRect=()=>rect(0,500);scroller.getBoundingClientRect=()=>rect(80,420);
 W.eval(fs.readFileSync('extension/adapter.js','utf8'));
 const row=(id,name='Person',avatar=true,top=80)=>{const e=W.document.createElement('rs-rooms-nav-room');e.setAttribute('room',id);const s=e.attachShadow({mode:'open'});s.innerHTML='<div class="container"><span class="room-name"></span><rs-room-icon></rs-room-icon></div>';s.querySelector('.room-name').textContent=name;const icon=s.querySelector('rs-room-icon');icon.attachShadow({mode:'open'});if(avatar)icon.shadowRoot.innerHTML='<span avatar><svg></svg></span>';e.getBoundingClientRect=()=>rect(top,60);scroller.shadowRoot.append(e);return e;};
 W.eval(fs.readFileSync('extension/chat-startup.js','utf8'));const check=()=>W.RCSChatStartup.check(W.RCSAdapter.chatRoots());const held=()=>scroller.style.visibility==='hidden';return {W,nav,root,scroller,row,tick,check,held,timers};
}
test('warm native list holds only its scroller for 300ms, preserving native scroll position and ARIA',t=>{
 const p=setup(t);p.row('one');p.scroller.scrollTop=42;p.scroller.setAttribute('aria-busy','false');p.check();assert.equal(p.held(),true);assert.notEqual(p.nav.style.visibility,'hidden');assert.equal(p.root.querySelector('[data-rcs-ui="startup"]')?.getAttribute('aria-hidden'),'true');p.tick(299);assert.equal(p.held(),true);p.tick(1);assert.equal(p.held(),false);assert.equal(p.scroller.scrollTop,42);assert.equal(p.scroller.getAttribute('aria-busy'),'false');assert.equal(p.root.querySelector('[data-rcs-ui="startup"]'),null);
 p.row('two');p.check();p.tick(500);assert.equal(p.held(),false,'later changes never hold again');assert.equal(p.timers.size,0);
});
test('changing visible room order restarts stability and missing names wait until available',t=>{
 const p=setup(t),a=p.row('a','');p.check();p.tick(250);p.row('b','Other',true,140);p.tick(100);assert.equal(p.held(),true);a.shadowRoot.querySelector('.room-name').textContent='Ready';p.tick(300);assert.equal(p.held(),false);
});
test('offscreen nameless rows do not hold the visible list',t=>{const p=setup(t);p.row('a');p.row('offscreen','',false,800);p.check();p.tick(300);assert.equal(p.held(),false);});
test('avatars receive 1.2 seconds grace after the order settles',t=>{const p=setup(t);p.row('a','Ready',false);p.check();p.tick(1499);assert.equal(p.held(),true);p.tick(1);assert.equal(p.held(),false);});
test('unfinished names release at the hard deadline and an empty list releases when stable',t=>{const p=setup(t);p.row('a','');p.check();p.tick(4499);assert.equal(p.held(),true);p.tick(1);assert.equal(p.held(),false);});
test('empty list releases at 300ms',t=>{const p=setup(t);p.check();p.tick(300);assert.equal(p.held(),false);});
test('hidden and detached documents fail open, restoring original inline styles',t=>{const p=setup(t);p.row('a','');p.scroller.style.visibility='visible';p.nav.style.position='sticky';p.check();p.W.dispatchEvent(new p.W.Event('pagehide'));assert.equal(p.held(),false);assert.equal(p.scroller.style.visibility,'visible');assert.equal(p.nav.style.position,'sticky');assert.equal(p.timers.size,0);});
test('zero-sized minimized lists do not consume the first visible startup',t=>{const p=setup(t);p.row('a');const measure=p.scroller.getBoundingClientRect;p.scroller.getBoundingClientRect=()=>({width:0,height:0});p.check();assert.equal(p.held(),false);p.scroller.getBoundingClientRect=measure;p.check();assert.equal(p.held(),true);});
test('incomplete image avatars wait until the image finishes, without requiring a new row',t=>{const p=setup(t),r=p.row('a');const a=r.shadowRoot.querySelector('rs-room-icon').shadowRoot.querySelector('[avatar]'),img=p.W.document.createElement('img');let complete=false;Object.defineProperty(img,'complete',{get:()=>complete});a.append(img);p.check();p.tick(350);assert.equal(p.held(),true);complete=true;p.tick(100);assert.equal(p.held(),false);});
test('detaching the scroller or hiding the page releases timers and placeholders',t=>{for(const mode of ['detach','hide']){const p=setup(t);p.row('a','');p.check();assert.equal(p.held(),true);if(mode==='detach'){p.scroller.remove();p.tick(50);}else{Object.defineProperty(p.W.document,'hidden',{value:true,configurable:true});p.W.document.dispatchEvent(new p.W.Event('visibilitychange'));}assert.equal(p.held(),false);assert.equal(p.root.querySelector('[data-rcs-ui="startup"]'),null);assert.equal(p.timers.size,0);}});
test('registered native shimmer elements are parsed and reused for startup placeholders',t=>{const p=setup(t);p.W.customElements.define('faceplate-shimmer',class extends p.W.HTMLElement{});p.row('one');p.check();const host=p.root.querySelector('[data-rcs-ui="startup"]');assert.ok(host.shadowRoot.querySelector('faceplate-shimmer[shape="pill"]'));p.W.RCSChatStartup.stop();});
test('first visible list is discovered before document-idle chat controls, including delayed shadow hydration',async t=>{
 const p=setup(t);p.scroller.remove();await new Promise(r=>setImmediate(r));p.row('late');p.root.append(p.scroller);await new Promise(r=>setImmediate(r));assert.equal(p.held(),true,'early discovery catches a hydrated native list without content.refresh');p.tick(300);assert.equal(p.held(),false);
 const manifest=JSON.parse(fs.readFileSync('extension/manifest.json','utf8')),entry=manifest.content_scripts.find(entry=>entry.js?.includes('chat-startup.js'));assert.equal(entry.run_at,'document_start');assert.ok(entry.js.indexOf('adapter.js')<entry.js.indexOf('chat-startup.js'));
});
test('Chrome isolated worlds without access to Reddit’s custom-element registry use the fallback',t=>{const p=setup(t);p.row('one');Object.defineProperty(p.W,'customElements',{value:null,configurable:true});assert.doesNotThrow(()=>p.check());assert.equal(p.held(),true);p.tick(300);assert.equal(p.held(),false);});

test('chatSearch toggle cleanly stops startup hold, chat UI, and local capture without clearing saved data, then resumes live',async t=>{
 const dom=new JSDOM('<!doctype html><body><rs-app><rs-rooms-nav><div class="nav-head">Chats</div><rs-virtual-scroll></rs-virtual-scroll></rs-rooms-nav></rs-app><div id="shell"></div></body>',{url:'https://chat.reddit.com/',runScripts:'outside-only',pretendToBeVisual:true});
 const W=dom.window,D=W.document;
 t.after(()=>{W.dispatchEvent(new W.Event('pagehide'));W.close();});
 const shell=D.getElementById('shell'),shellRoot=shell.attachShadow({mode:'open'});
 shellRoot.innerHTML='<div id="resizable"><button aria-label="Maximize chat view">Open</button></div>';
 const listeners=[],ingests=[];
 let chatSearch=true;
 W.chrome={runtime:{id:'ext',
  onMessage:{addListener(fn){listeners.push(fn);},removeListener(fn){const i=listeners.indexOf(fn);if(i>=0)listeners.splice(i,1);}},
  async sendMessage(msg){
   if(msg?.scope==='rt-posts' && msg.action==='get-settings')return {ok:true,settings:{chatSearch}};
   if(msg?.scope==='rcs-messages' && msg.action==='ingest'){ingests.push(msg);return {ok:true,changed:true,roomIds:['!r:reddit.com']};}
   if(msg?.scope==='rcs-directory' && msg.action==='read')return {ok:true,entry:null};
   return {ok:true};
  }
 }};
 for(const file of ['adapter.js','chat-startup.js','directory-model.js','search-core.js','data-client.js','directory-store.js','message-store.js','message-cache-client.js','date-picker.js','global-search-model.js','unified-search-styles.js','unified-search.js','content.js']){
  W.eval(fs.readFileSync('extension/'+file,'utf8'));
 }
 await new Promise(r=>setTimeout(r,20));
 assert.ok(D.querySelector('[data-rcs-ui="list"]'),'mounts chat list search when chatSearch is on');
 assert.ok(shellRoot.querySelector('[data-rcs-ui="minimized-search"]'),'mounts minimized chat button when chatSearch is on');

 // Toggle chatSearch Off via settings-changed: removes UI, stops capture, never clears stored data.
 let resumeEvents=0;
 D.addEventListener('rcs-message-cache-listening',e=>{if(e.detail==='resume')resumeEvents++;});
 chatSearch=false;
 for(const fn of [...listeners])fn({scope:'rt-posts',action:'settings-changed',settings:{chatSearch:false}},{id:'ext'});
 assert.equal(W.RCSContent.isEnabled(),false);
 assert.equal(W.RCSMessages.isEnabled(),false);
 assert.equal(W.RCSDirectory.isEnabled(),false);
 assert.equal(D.querySelector('[data-rcs-ui="list"]'),null,'removes chat list search UI when toggled off');
 assert.equal(shellRoot.querySelector('[data-rcs-ui="minimized-search"]'),null,'removes minimized search button when toggled off');
 D.dispatchEvent(new W.CustomEvent('rcs-message-cache-batch',{detail:JSON.stringify({owner:'@t2_me:reddit.com',roomId:'!r:reddit.com',events:[{event_id:'$1',room_id:'!r:reddit.com',type:'m.room.message',sender:'@t2_me:reddit.com',origin_server_ts:1,content:{body:'hi'}}]})} ));
 await new Promise(r=>setTimeout(r,20));
 assert.equal(ingests.length,0,'drops capture batches while chatSearch is off');

 // Toggle chatSearch back On: remounts UI and emits resume signal to page bridge.
 chatSearch=true;
 for(const fn of [...listeners])fn({scope:'rt-posts',action:'settings-changed',settings:{chatSearch:true}},{id:'ext'});
 assert.equal(W.RCSContent.isEnabled(),true);
 assert.equal(W.RCSMessages.isEnabled(),true);
 assert.equal(W.RCSDirectory.isEnabled(),true);
 assert.equal(resumeEvents,1,'notifies page bridge to resume capture without reload');
 assert.ok(D.querySelector('[data-rcs-ui="list"]'),'remounts chat list search on toggle back on');
 assert.ok(shellRoot.querySelector('[data-rcs-ui="minimized-search"]'),'remounts minimized chat button on toggle back on');
});
