const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const endpoint=(query='hello')=>'https://www.reddit.com/svc/shreddit/search/?'+new URLSearchParams({q:'author:"Example" '+query,type:'comments',sort:'new',limit:'25',rt_public_search:'1'});
function env({supported=true,fetcher,loggedIn=false,credentialless=true,appAttributes={},nativeOwner=null}={}){
 const events=[],calls=[],nodes=[],timers=new Map(),listeners={};let next=0,now=100000;
 const location={origin:'https://www.reddit.com',pathname:'/user/Example/',href:'https://www.reddit.com/user/Example/'};
 const state={loggedIn,credentialless};
 const document={documentElement:{append(node){events.push('append');node.isConnected=true;}},createElement(tag){assert.equal(tag,'iframe');let anonymous=false;
  const d={readyState:'complete',querySelector(selector){return selector==='shreddit-app'?{hasAttribute(name){return state.loggedIn || Object.hasOwn(appAttributes,name);},getAttribute(name){return appAttributes[name] ?? (state.loggedIn && name==='user-logged-in'?'true':null);}}:{};}};
  const w={get credentialless(){return state.credentialless;},location:{origin:location.origin,pathname:'/'},document:d,customElements:{get:()=>class{}},async fetch(url,options){calls.push([url,options]);return fetcher?fetcher(url,options,e):response(url);}};
  const node={style:{setProperty(){}},setAttribute(key,value){events.push([key,value]);},isConnected:false,contentWindow:w,contentDocument:d,remove(){this.isConnected=false;events.push('remove');},set src(value){events.push('src');this.url=value;}};
  if(supported)Object.defineProperty(node,'credentialless',{get(){return anonymous;},set(value){events.push('credentialless');anonymous=value;}});
  nodes.push(node);return node;
 }};
 const window={addEventListener(name,fn){listeners[name]=fn;},removeEventListener(name,fn){if(listeners[name]===fn)delete listeners[name];}};window.top=window;
 const context=vm.createContext({window,document,location,URL,AbortController,TextDecoder,RTNativeRemoval:{identity:()=>nativeOwner},Date:{now:()=>now,parse:Date.parse},setTimeout(fn,ms){const id=++next;timers.set(id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);},setInterval(fn,ms){const id=++next;timers.set(id,{fn,ms,interval:true});return id;},clearInterval(id){timers.delete(id);}});
 vm.runInContext(fs.readFileSync('extension/public-browser.js','utf8'),context);
 const e={read:(...args)=>context.RTPublicBrowser.read(...args),hasSession:()=>context.RTPublicBrowser.hasSession(),events,calls,nodes,state,location,timers,advance(ms){now+=ms;for(const [id,timer] of [...timers])if(timer.ms<=ms){if(!timer.interval)timers.delete(id);timer.fn();}},pagehide:()=>listeners.pagehide()};return e;
}
function response(url,{status=200,chunks=[new TextEncoder().encode('<shreddit-comment>public</shreddit-comment>')],length=null,onRead}={}){
 let index=0;return {url,ok:status===200,status,redirected:false,headers:{get:()=>length},body:{getReader(){return {async read(){onRead?.();return index<chunks.length?{value:chunks[index++],done:false}:{done:true};},async cancel(){}};}}};
}
test('fresh credentialless frame precedes navigation and is reused; only anonymous native fetch options supplied',async()=>{
 const e=env();assert.match(await e.read(endpoint()),/public/);await e.read(endpoint('next'));
 assert.equal(e.nodes.length,1);assert.ok(e.events.indexOf('credentialless')<e.events.indexOf('src'));assert.ok(e.events.indexOf('src')<e.events.indexOf('append'));
 assert.ok(e.events.some(event=>Array.isArray(event)&&event[0]==='sandbox'&&event[1]==='allow-scripts allow-same-origin allow-forms'));
 const [url,options]=e.calls[0];assert.equal(new URL(url).searchParams.has('rt_public_search'),false);assert.equal(options.credentials,'same-origin');assert.equal(options.redirect,'error');assert.equal(options.referrerPolicy,'no-referrer');assert.deepEqual(Object.keys(options.headers),['Accept']);assert.equal(options.method,'GET');
 assert.equal(e.nodes[0].referrerPolicy,'strict-origin','bootstrap supplies the real Reddit origin without the profile path');
 e.advance(59999);assert.equal(e.nodes[0].isConnected,true);e.advance(60000);assert.equal(e.nodes[0].isConnected,false);
});
test('unsupported credentialless fails closed without appending or fetching',async()=>{
 const e=env({supported:false});await assert.rejects(e.read(endpoint()));assert.equal(e.calls.length,0);assert.equal(e.events.includes('append'),false);
});
test('foreign route, author, unexpected parameters and duplicate keys never create a frame',async()=>{
 const e=env();for(const url of [endpoint().replace('www.reddit.com','evil.test'),endpoint().replace('Example','Other'),endpoint()+'&token=secret',endpoint()+'&limit=25',endpoint()+'#fragment'])await assert.rejects(e.read(url));
 e.location.pathname='/r/test/';await assert.rejects(e.read(endpoint()));assert.equal(e.nodes.length,0);
});
test('logged-in or noncredentialless frame cannot issue a network read',async()=>{
 const logged=env({loggedIn:true});await assert.rejects(logged.read(endpoint()));assert.equal(logged.calls.length,0);
 const plain=env({credentialless:false}),p=plain.read(endpoint());await tick();plain.advance(6000);await assert.rejects(p);assert.equal(plain.calls.length,0);
});
test('Reddit native logged-in-user-id and user-logged-in signals reject a frame',async()=>{
 for(const appAttributes of [{'logged-in-user-id':'t2_synthetic'},{'user-logged-in':'true'}]){
  const e=env({appAttributes});await assert.rejects(e.read(endpoint()));assert.equal(e.calls.length,0);
 }
});
test('SSR login markup cannot start a public read before native browser initialization completes',async()=>{
 const e=env(),task=e.read(endpoint());
 // Pause startup before its queued task creates the iframe.
 e.state.credentialless=false;await tick();const node=e.nodes[0];node.contentDocument.readyState='loading';e.state.credentialless=true;
 e.advance(100);await tick();assert.equal(e.calls.length,0);
 node.contentDocument.readyState='complete';node.contentWindow.customElements.get=()=>undefined;
 e.advance(100);await tick();assert.equal(e.calls.length,0);
 node.contentWindow.customElements.get=()=>class{};e.advance(100);await task;assert.equal(e.calls.length,1);
});
test('auth and document identity are checked again after reading',async()=>{
 for(const mutation of [e=>e.state.loggedIn=true,e=>e.state.credentialless=false,e=>e.location.href+='?changed',e=>e.nodes[0].contentDocument={querySelector(){return {};}}]){
  const e=env({fetcher:(url,options,e)=>response(url,{onRead:()=>mutation(e)})});await assert.rejects(e.read(endpoint()));assert.equal(e.nodes[0].isConnected,false);
 }
});
test('only one active request and one queued request; third is rejected',async()=>{
 let release;const gate=new Promise(resolve=>release=resolve);const e=env({fetcher:async url=>{await gate;return response(url);}});
 const a=e.read(endpoint()),b=e.read(endpoint('second'));await assert.rejects(e.read(endpoint('third')),/busy/);await tick();assert.equal(e.calls.length,1);release();await Promise.all([a,b]);assert.equal(e.calls.length,2);
});
test('waiting cancellation never issues its fetch and active cancellation aborts native fetch',async()=>{
 let release;const gate=new Promise(resolve=>release=resolve);const e=env({fetcher:async url=>{await gate;return response(url);}}),controller=new AbortController();
 const a=e.read(endpoint()),b=e.read(endpoint('waiting'),{signal:controller.signal});controller.abort();release();await a;await assert.rejects(b,/cancelled/);assert.equal(e.calls.length,1);
 const active=env({fetcher:(url,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}))}),abort=new AbortController();const p=active.read(endpoint(),{signal:abort.signal});await tick();abort.abort();await assert.rejects(p,/cancelled/);assert.equal(active.calls[0][1].signal.aborted,true);assert.equal(active.nodes[0].isConnected,false);
});
test('declared and streamed responses over three million bytes are rejected and frame discarded',async()=>{
 for(const options of [{length:'3000001'},{chunks:[new Uint8Array(1500000),new Uint8Array(1500001)]}]){
  const e=env({fetcher:url=>response(url,options)});await assert.rejects(e.read(endpoint()),/oversized/);assert.equal(e.nodes[0].isConnected,false);
 }
});
test('429 and blocked responses have cooldown without retries or ordinary-frame fallback',async()=>{
 for(const [status,cooldown] of [[429,60000],[403,600000]]){
  const e=env({fetcher:url=>response(url,{status})});await assert.rejects(e.read(endpoint()));await assert.rejects(e.read(endpoint()));assert.equal(e.calls.length,1);assert.equal(e.nodes.length,1);e.advance(cooldown);await assert.rejects(e.read(endpoint()));assert.equal(e.calls.length,2);assert.ok(e.nodes.every(node=>node.credentialless===true));
 }
});
test('pagehide immediately removes the helper frame',async()=>{const e=env();await e.read(endpoint());e.pagehide();assert.equal(e.nodes[0].isConnected,false);});
test('refresh reuses a healthy anonymous context and results themselves are never cached',async()=>{
 const e=env();assert.equal(e.hasSession(),false);await e.read(endpoint());assert.equal(e.hasSession(),true);await e.read(endpoint(),{refresh:true});await e.read(endpoint());
 assert.equal(e.nodes.length,1);assert.equal(e.calls.length,3);
 e.advance(60000);assert.equal(e.nodes[0].isConnected,false);assert.equal(e.hasSession(),true,'the document still owns the verified anonymous partition');
 await e.read(endpoint());assert.equal(e.calls.length,4);assert.equal(e.nodes.length,2);e.pagehide();assert.equal(e.hasSession(),false);
});
test('explicit refresh may probe a blocked context again but cannot bypass a server rate limit',async()=>{
 let blocked=true;const e=env({fetcher:url=>response(url,{status:blocked?403:200})});
 await assert.rejects(e.read(endpoint()));blocked=false;await assert.rejects(e.read(endpoint()));assert.equal(e.calls.length,1);
 assert.match(await e.read(endpoint(),{refresh:true}),/public/);assert.equal(e.calls.length,2);
 const limited=env({fetcher:url=>{const r=response(url,{status:429});r.headers.get=name=>name==='retry-after'?'120':null;return r;}});
 await assert.rejects(limited.read(endpoint()));assert.equal(limited.nodes[0].isConnected,true,'rate limiting retains the healthy anonymous session');
 limited.advance(60000);await assert.rejects(limited.read(endpoint(),{refresh:true}),/rate limit/);assert.equal(limited.calls.length,1);
});
test('a transient service error retains verified session state for a retry',async()=>{
 let failed=true;const e=env({fetcher:url=>response(url,{status:failed?503:200})});
 await assert.rejects(e.read(endpoint()),/HTTP 503/);assert.equal(e.nodes[0].isConnected,true);
 failed=false;await e.read(endpoint());assert.equal(e.nodes.length,1);assert.equal(e.calls.length,2);
});
test('HTTP-date Retry-After preserves the anonymous session pause until the server deadline',async()=>{
 const e=env({fetcher:url=>{const r=response(url,{status:429});r.headers.get=name=>name==='retry-after'?new Date(220000).toUTCString():null;return r;}});
 await assert.rejects(e.read(endpoint()),/rate limit/);e.advance(60000);
 await assert.rejects(e.read(endpoint(),{refresh:true}),/rate limit/);assert.equal(e.calls.length,1);
 e.advance(60000);await assert.rejects(e.read(endpoint()),/rate limit/);assert.equal(e.calls.length,2);
});
test('pagehide aborts active work and queued reads without poisoning restored-page checks',async()=>{
 let first=true;const e=env({fetcher:(url,options)=>{if(!first)return response(url);first=false;return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));}});
 const active=e.read(endpoint()),queued=e.read(endpoint('queued'));
 const failures=Promise.all([assert.rejects(active,/cancelled/),assert.rejects(queued,/cancelled/)]);
 await tick();e.pagehide();await failures;assert.equal(e.calls.length,1);
 assert.match(await e.read(endpoint('after return')),/public/);assert.equal(e.calls.length,2);
});
test('native item reads reuse the unsigned search frame with the same anonymous fetch policy',async()=>{
 const e=env({nativeOwner:{owner:'t2_self',username:'Example'}});await e.read(endpoint());const url='https://www.reddit.com/svc/shreddit/comment/t1_19gsnavtu46ip?isProfile=true';await e.read(url);assert.equal(e.nodes.length,1);assert.equal(e.calls[1][1].credentials,'same-origin');
 e.location.pathname='/r/Alpha/comments/post1/title/';e.location.href='https://www.reddit.com'+e.location.pathname;await e.read('https://www.reddit.com/svc/shreddit/partial-feed-post/t3_post1?isProfile=true');assert.equal(e.nodes.length,1);
 for(const bad of [url+'&token=x',url.replace('isProfile=true','isProfile=false'),url.replace('t1_19gsnavtu46ip','anything'),url.replace('www.reddit.com','evil.example')])await assert.rejects(e.read(bad));
});
test('an item endpoint refusal does not discard or pause a healthy unsigned search session',async()=>{
 const e=env({nativeOwner:{owner:'t2_self',username:'Example'},fetcher:url=>response(url,{status:url.includes('/comment/')?403:200})});await e.read(endpoint());await assert.rejects(e.read('https://www.reddit.com/svc/shreddit/comment/t1_19gsnavtu46ip?isProfile=true'));assert.equal(e.hasSession(),true);await e.read(endpoint('again'));await e.read('https://www.reddit.com/svc/shreddit/partial-feed-post/t3_post1?isProfile=true');assert.equal(e.nodes.length,1);
});
test('own signed-out profile pages (spec §18): first page as HTML and native continuations, own profile only, exact parameters',async()=>{
 const e=env({nativeOwner:{owner:'t2_self',username:'Example'}});
 const first='https://www.reddit.com/user/Example/?sort=new',next='https://www.reddit.com/svc/shreddit/profiles/profile_overview-more-posts/new/?sort=new&after=dDFfYWJj&name=Example&navigationSessionId=abc-123&feedLength=33&referer=https%3A%2F%2Fwww.reddit.com%2Fuser%2FExample%2F';
 await e.read(first);assert.equal(e.calls[0][1].headers.Accept,'text/html','the first page is a full document');assert.equal(e.calls[0][1].credentials,'same-origin');
 await e.read(next);assert.match(e.calls[1][1].headers.Accept,/partial/);await e.read(next+'&distance=25');assert.equal(e.nodes.length,1,'same anonymous frame');
 for(const bad of ['https://www.reddit.com/user/Other/?sort=new','https://www.reddit.com/user/Example/?sort=top','https://www.reddit.com/user/Example/comments/?sort=new',next.replace('name=Example','name=Other'),next.replace('profile_overview','profile_posts'),next+'&token=x','https://evil.example/user/Example/?sort=new'])await assert.rejects(e.read(bad),undefined,bad);
 const signedOut=env({nativeOwner:null});await assert.rejects(signedOut.read(first),undefined,'needs the verified own account');
});
