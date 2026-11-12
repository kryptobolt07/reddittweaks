const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const endpoint=(query='hello')=>'https://www.reddit.com/svc/shreddit/search/?'+new URLSearchParams({q:'author:"Example" '+query,type:'comments',sort:'new',limit:'25',rt_public_search:'1'});
function env({supported=true,fetcher,loggedIn=false,credentialless=true,appAttributes={}}={}){
 const events=[],calls=[],nodes=[],timers=new Map(),listeners={};let next=0,now=100000;
 const location={origin:'https://www.reddit.com',pathname:'/user/Example/',href:'https://www.reddit.com/user/Example/'};
 const state={loggedIn,credentialless};
 const document={documentElement:{append(node){events.push('append');node.isConnected=true;}},createElement(tag){assert.equal(tag,'iframe');let anonymous=false;
  const d={querySelector(selector){return selector==='shreddit-app'?{hasAttribute(name){return state.loggedIn || Object.hasOwn(appAttributes,name);},getAttribute(name){return appAttributes[name] ?? (state.loggedIn && name==='user-logged-in'?'true':null);}}:{};}};
  const w={get credentialless(){return state.credentialless;},location:{origin:location.origin,pathname:'/'},document:d,async fetch(url,options){calls.push([url,options]);return fetcher?fetcher(url,options,e):response(url);}};
  const node={style:{setProperty(){}},setAttribute(key,value){events.push([key,value]);},isConnected:false,contentWindow:w,contentDocument:d,remove(){this.isConnected=false;events.push('remove');},set src(value){events.push('src');this.url=value;}};
  if(supported)Object.defineProperty(node,'credentialless',{get(){return anonymous;},set(value){events.push('credentialless');anonymous=value;}});
  nodes.push(node);return node;
 }};
 const window={addEventListener(name,fn){listeners[name]=fn;},removeEventListener(name,fn){if(listeners[name]===fn)delete listeners[name];}};window.top=window;
 const context=vm.createContext({window,document,location,URL,AbortController,TextDecoder,Date:{now:()=>now},setTimeout(fn,ms){const id=++next;timers.set(id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);},setInterval(fn,ms){const id=++next;timers.set(id,{fn,ms,interval:true});return id;},clearInterval(id){timers.delete(id);}});
 vm.runInContext(fs.readFileSync('extension/public-browser.js','utf8'),context);
 const e={read:(...args)=>context.RTPublicBrowser.read(...args),events,calls,nodes,state,location,timers,advance(ms){now+=ms;for(const [id,timer] of [...timers])if(timer.ms<=ms){if(!timer.interval)timers.delete(id);timer.fn();}},pagehide:()=>listeners.pagehide()};return e;
}
function response(url,{status=200,chunks=[new TextEncoder().encode('<shreddit-comment>public</shreddit-comment>')],length=null,onRead}={}){
 let index=0;return {url,ok:status===200,status,redirected:false,headers:{get:()=>length},body:{getReader(){return {async read(){onRead?.();return index<chunks.length?{value:chunks[index++],done:false}:{done:true};},async cancel(){}};}}};
}
test('fresh credentialless frame precedes navigation and is reused; only anonymous native fetch options supplied',async()=>{
 const e=env();assert.match(await e.read(endpoint()),/public/);await e.read(endpoint('next'));
 assert.equal(e.nodes.length,1);assert.ok(e.events.indexOf('credentialless')<e.events.indexOf('src'));assert.ok(e.events.indexOf('src')<e.events.indexOf('append'));
 assert.ok(e.events.some(event=>Array.isArray(event)&&event[0]==='sandbox'&&event[1]==='allow-scripts allow-same-origin'));
 const [url,options]=e.calls[0];assert.equal(new URL(url).searchParams.has('rt_public_search'),false);assert.equal(options.credentials,'same-origin');assert.equal(options.redirect,'error');assert.equal(options.referrerPolicy,'no-referrer');assert.deepEqual(Object.keys(options.headers),['Accept']);assert.equal(options.method,'GET');
 e.advance(19999);assert.equal(e.nodes[0].isConnected,true);e.advance(20000);assert.equal(e.nodes[0].isConnected,false);
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
test('pagehide aborts active work and queued reads without poisoning restored-page checks',async()=>{
 let first=true;const e=env({fetcher:(url,options)=>{if(!first)return response(url);first=false;return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));}});
 const active=e.read(endpoint()),queued=e.read(endpoint('queued'));
 const failures=Promise.all([assert.rejects(active,/cancelled/),assert.rejects(queued,/cancelled/)]);
 await tick();e.pagehide();await failures;assert.equal(e.calls.length,1);
 assert.match(await e.read(endpoint('after return')),/public/);assert.equal(e.calls.length,2);
});
