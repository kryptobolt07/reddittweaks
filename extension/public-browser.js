/* Anonymous native-browser search. No visible tabs or owner-session credentials. */
(() => {
  'use strict';
  if(window.top!==window || globalThis.RTPublicBrowser)return;
  const origin='https://www.reddit.com',maxBytes=3000000;
  const itemRefusals=new Map();
  let frame=null,queue=Promise.resolve(),pending=0,idleTimer=null,cooldownUntil=0,rateLimited=false,verifiedSession=false,activeController=null,revision=0,relayHandler=null;
  const failure=(message='Reddit blocked logged-out search (HTTP 403).')=>Error(message);
  function discard(){frame?.remove();frame=null;window.removeEventListener('pagehide',close);}
  function close(){revision++;verifiedSession=false;clearTimeout(idleTimer);activeController?.abort();discard();}
  function idle(){clearTimeout(idleTimer);if(!pending)idleTimer=setTimeout(discard,60000);}
  const sorts=['new','hot','top'],ranges=['hour','day','week','month','year','all'];
  function validate(value){
    const url=new URL(value),p=url.searchParams;
    const clean=location.origin===origin && url.origin===origin && !url.username && !url.password && !url.port && !url.hash;
    if(!clean)throw failure();
    const profile=location.pathname.match(/^\/user\/([\w-]{1,20})(?:\/(?:submitted|comments|search))?\/?$/i),visited=profile?.[1] || '';
    const me=globalThis.RTNativeRemoval?.identity(document),topApp=document.querySelector?.('shreddit-app');
    const signedInTop=Boolean(me || topApp && (topApp.hasAttribute?.('logged-in') || topApp.hasAttribute?.('logged-in-user-id') || topApp.getAttribute?.('user-logged-in')==='true'));
    const allowedUser=name=>Boolean(name) && (me && name.toLowerCase()===me.username.toLowerCase() || signedInTop && visited && name.toLowerCase()===visited.toLowerCase());
    const item=url.pathname.match(/^\/svc\/shreddit\/(comment\/t1_[a-z0-9]{1,32}|partial-feed-post\/t3_[a-z0-9]{1,10})$/);
    if(item){
      const isPost=item[1].startsWith('partial-feed-post/'),allowed=isPost?['isProfile','pvc','fvt']:['isProfile'];
      const bad=p.get('isProfile')!=='true' || (p.has('pvc') && !/^Profile[A-Za-z0-9]{0,24}$/.test(p.get('pvc'))) || (p.has('fvt') && !['cardView','compactView'].includes(p.get('fvt'))) || [...p.keys()].some(key=>!allowed.includes(key) || p.getAll(key).length!==1);
      if(!(me || signedInTop && visited) || bad)throw failure('Invalid signed-out item check.');
      return url;
    }
    const hover=url.pathname.match(/^\/svc\/shreddit\/user-hover-card\/([\w-]{1,20})$/i);
    if(hover){
      if(!allowedUser(hover[1]) || [...p.keys()].length!==0)throw failure('Invalid signed-out profile check.');
      return url;
    }
    // Own profile (spec §18) or visited profile while signed in (blocked-by-user): first page and native continuations only.
    const page=url.pathname.match(/^\/user\/([\w-]{1,20})(?:\/(submitted|comments))?\/$/i);
    if(page){
      const bad=(p.has('sort') && !sorts.includes(p.get('sort'))) || (p.has('t') && !ranges.includes(p.get('t'))) || [...p.keys()].some(key=>!['sort','t'].includes(key) || p.getAll(key).length!==1);
      if(!allowedUser(page[1]) || bad)throw failure('Invalid signed-out profile read.');
      return url;
    }
    const more=url.pathname.match(/^\/svc\/shreddit\/profiles\/profile_(overview|posts|comments)-more-posts\/(new|hot|top)\/$/);
    if(more){
      // Captured 2026-11-16: page 2 onward adds distance.
      const allowed=['sort','after','name','navigationSessionId','feedLength','referer','distance','t','cursor'];
      if(!allowedUser(p.get('name')) || (p.has('sort') && p.get('sort')!==more[2]) || (p.has('t') && !ranges.includes(p.get('t'))) || url.href.length>4096 || [...p.keys()].some(key=>!allowed.includes(key) || p.getAll(key).length!==1) || [...p.values()].some(value=>/[\u0000-\u001f\u007f]/.test(value)))throw failure('Invalid signed-out profile read.');
      return url;
    }
    if(!profile || url.pathname!=='/svc/shreddit/search/')throw failure();
    const q=p.get('q') || '',author=q.match(/^author:"([\w-]{1,20})"(?: [^\u0000-\u001f\u007f]{1,300})?$/);
    if(!author || author[1].toLowerCase()!==profile[1].toLowerCase() || !['posts','comments'].includes(p.get('type')) || !['new','hot','top','relevance','comments'].includes(p.get('sort')) || p.get('limit')!=='25')throw failure();
    if(p.has('t') && !ranges.includes(p.get('t')) || p.has('cursor') && (!p.get('cursor') || p.get('cursor').length>4096 || /[\u0000-\u001f\u007f]/.test(p.get('cursor'))))throw failure();
    for(const key of p.keys())if(!['q','type','sort','limit','t','cursor','rt_public_search'].includes(key) || p.getAll(key).length!==1)throw failure();
    p.delete('rt_public_search');return url;
  }
  function hasCredentialless(){
    if(globalThis.HTMLIFrameElement?.prototype)return 'credentialless' in HTMLIFrameElement.prototype;
    return false;
  }
  function hasRelay(){
    return typeof relayHandler==='function' || Boolean(document.documentElement?.hasAttribute?.('data-rt-public-relay'));
  }
  function setRelay(fn){relayHandler=typeof fn==='function'?fn:null;}
  function isSupported(){
    if(hasCredentialless() || hasRelay())return true;
    try{return 'credentialless' in document.createElement('iframe');}catch{return false;}
  }
  function create(){
    if(frame?.isConnected)return frame;
    discard();
    const node=document.createElement('iframe');
    if(!('credentialless' in node))throw Object.assign(failure(),{unsupported:true});
    node.credentialless=true;
    // Reddit's automatic JS check submits its own verification form. Keep
    // native submission available, while blocking popups and top navigation.
    node.setAttribute('sandbox','allow-scripts allow-same-origin allow-forms');
    node.setAttribute('aria-hidden','true');node.tabIndex=-1;node.inert=true;
    // Fixed positioning outside the viewport contributes no layout or scroll space.
    for(const [key,value] of Object.entries({position:'fixed',width:'1px',height:'1px',left:'-10000px',top:'0',border:'0','pointer-events':'none'}))node.style.setProperty(key,value,'important');
    // A real same-site navigation supplies its origin, without the profile path.
    // Omitting this referrer makes cold anonymous contexts receive a JS shell.
    node.referrerPolicy='strict-origin';node.src=origin+'/';
    document.documentElement.append(node);frame=node;window.addEventListener('pagehide',close);return node;
  }
  function context(node){
    try{
      const w=node.contentWindow,d=node.contentDocument,app=d?.querySelector('shreddit-app');
      if(node!==frame || !node.isConnected || !node.credentialless || w.credentialless!==true || w.location.origin!==origin || w.location.pathname!=='/')return null;
      // SSR can show Log In before native JS has finished preparing the
      // anonymous session. The first search must wait for browser initialization.
      if(d.readyState!=='complete' || !w.customElements.get('shreddit-app'))return null;
      if(app && (app.hasAttribute('logged-in') || app.hasAttribute('logged-in-user-id') || app.getAttribute('user-logged-in')==='true'))throw failure();
      return app && d.querySelector('#login-button')?{window:w,document:d}:null;
    }catch(error){if(error.name==='SecurityError')return null;throw error;}
  }
  function ready(node,signal){
    return new Promise((resolve,reject)=>{
      let interval,timer;
      const finish=(error,value)=>{clearInterval(interval);clearTimeout(timer);signal.removeEventListener('abort',cancel);error?reject(error):resolve(value);};
      const cancel=()=>finish(failure('Post request cancelled.'));
      const check=()=>{try{const value=context(node);if(value)finish(null,value);}catch(error){finish(error);}};
      interval=setInterval(check,100);timer=setTimeout(()=>finish(failure()),6000);
      signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();else check();
    });
  }
  async function text(response,controller){
    if(Number(response.headers.get('content-length'))>maxBytes)throw failure('Reddit returned an oversized public response.');
    const reader=response.body?.getReader();if(!reader)throw failure();
    let bytes=0,value='';const decoder=new TextDecoder();
    try{
      while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>maxBytes)throw failure('Reddit returned an oversized public response.');value+=decoder.decode(part.value,{stream:true});}
      return value+decoder.decode();
    }catch(error){controller.abort();throw error;}finally{await reader.cancel().catch(()=>{});}
  }
  async function relayRead(url,signal,refresh=false){
    if(typeof relayHandler==='function')return relayHandler(url.href,{signal,refresh});
    if(!document.documentElement?.hasAttribute?.('data-rt-public-relay'))throw Object.assign(failure(),{unsupported:true});
    const id=crypto.randomUUID();let timer;
    return new Promise((resolve,reject)=>{
      const finish=(error,value)=>{clearTimeout(timer);document.removeEventListener('rt-public-relay-response',receive);signal?.removeEventListener('abort',cancel);error?reject(error):resolve(value);};
      const cancel=()=>finish(failure('Post request cancelled.'));
      const receive=event=>{
        let data;try{data=JSON.parse(event.detail);}catch{return;}
        if(data?.id!==id)return;
        if(data.ok && typeof data.html==='string')finish(null,data.html);
        else finish(Object.assign(failure(data?.error || undefined),{status:data?.status,unsupported:data?.unsupported===true}));
      };
      document.addEventListener('rt-public-relay-response',receive);
      signal?.addEventListener('abort',cancel,{once:true});
      timer=setTimeout(()=>finish(failure('Reddit request timed out. Try again.')),15000);
      if(signal?.aborted){cancel();return;}
      document.dispatchEvent(new CustomEvent('rt-public-relay-request',{detail:JSON.stringify({id,url:url.href,refresh:Boolean(refresh)})}));
    });
  }
  async function perform(value,{signal,refresh=false}={}){
    const url=validate(value),page=location.href,generation=revision,itemRead=/^\/svc\/shreddit\/(?:comment|partial-feed-post)\//.test(url.pathname),hoverRead=url.pathname.startsWith('/svc/shreddit/user-hover-card/'),firstProfilePage=url.pathname.startsWith('/user/');
    if(signal?.aborted)throw failure('Post request cancelled.');
    if(refresh && !rateLimited)cooldownUntil=0;
    if(itemRead && refresh && !rateLimited)itemRefusals.delete(url.pathname);
    if(cooldownUntil>Date.now())throw failure(rateLimited?'Reddit rate limit reached. Try again later.':undefined);
    if(itemRead && (itemRefusals.get(url.pathname) || 0)>Date.now())throw failure('Reddit blocked logged-out item checks (HTTP 403).');
    if(!hasCredentialless() && hasRelay()){
      const controller=new AbortController(),cancel=()=>controller.abort();activeController=controller;signal?.addEventListener('abort',cancel,{once:true});
      try{
        const result=await relayRead(url,controller.signal,refresh);
        if(controller.signal.aborted || location.href!==page)throw failure('Page changed. Try again.');
        verifiedSession=true;return result;
      }catch(error){
        controller.abort();
        const cancelled=signal?.aborted || generation!==revision || location.href!==page;
        if(error?.status===429){cooldownUntil=Date.now()+60000;rateLimited=true;}
        else if(itemRead && error?.status===403){if(itemRefusals.size>=1000)itemRefusals.delete(itemRefusals.keys().next().value);itemRefusals.set(url.pathname,Date.now()+600000);}
        if(cancelled)throw failure('Post request cancelled.');
        throw error;
      }finally{signal?.removeEventListener('abort',cancel);if(activeController===controller)activeController=null;}
    }
    const controller=new AbortController(),cancel=()=>controller.abort();activeController=controller;signal?.addEventListener('abort',cancel,{once:true});
    let timer,node,responseStatus=0,timedOut=false;
    try{
      node=create();const initial=await ready(node,controller.signal);
      if(signal?.aborted || controller.signal.aborted)throw failure('Post request cancelled.');
      timer=setTimeout(()=>{timedOut=true;controller.abort();},5000);
      const response=await initial.window.fetch(url.href,{method:'GET',credentials:'same-origin',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',headers:{Accept:firstProfilePage?'text/html':'text/vnd.reddit.partial+html, text/html;q=0.9'},signal:controller.signal});
      responseStatus=response.status;
      if(response.status===429){const hint=response.headers.get('retry-after'),seconds=Number(hint),retry=Number.isFinite(seconds)?seconds*1000:Date.parse(hint)-Date.now();cooldownUntil=Date.now()+Math.min(3600000,retry>0?retry:60000);rateLimited=true;throw Object.assign(failure('Reddit rate limit reached. Try again later.'),{status:429});}
      if(response.status>=500)throw Object.assign(failure('Reddit couldn’t load public search (HTTP '+response.status+').'),{status:response.status});
      if(itemRead && response.status===403){if(itemRefusals.size>=1000)itemRefusals.delete(itemRefusals.keys().next().value);itemRefusals.set(url.pathname,Date.now()+600000);}
      if(!response.ok || response.redirected || response.url!==url.href)throw Object.assign(failure(itemRead?'Reddit blocked logged-out item checks (HTTP '+response.status+').':undefined),{status:response.status});
      const result=await text(response,controller),current=context(node);
      if(controller.signal.aborted || location.href!==page || !current || current.window!==initial.window || current.document!==initial.document)throw failure('Page changed. Try again.');
      verifiedSession=true;
      return result;
    }catch(error){
      controller.abort();
      const cancelled=signal?.aborted || generation!==revision || location.href!==page;
      let reusable=false;try{reusable=!!context(node) && (responseStatus===429 || responseStatus>=500 || hoverRead && responseStatus===404 || itemRead && (responseStatus===403 || cancelled && generation===revision) || timedOut || error.name==='TypeError');}catch{}
      if(!reusable){verifiedSession=false;discard();}
      if(!cancelled && !reusable && cooldownUntil<=Date.now()){cooldownUntil=Date.now()+600000;rateLimited=false;}
      if(cancelled)throw failure('Post request cancelled.');
      if(timedOut)throw failure('Reddit request timed out. Try again.');throw error;
    }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);if(activeController===controller)activeController=null;}
  }
  function read(value,options={}){
    try{validate(value);}catch(error){return Promise.reject(error);}
    if(pending>=2)return Promise.reject(failure('Public checks are busy. Try again shortly.'));
    pending++;clearTimeout(idleTimer);
    const generation=revision;
    const result=queue.then(()=>{if(revision!==generation)throw failure('Post request cancelled.');return perform(value,options);});queue=result.catch(()=>{});
    return result.finally(()=>{pending--;idle();});
  }
  // Removing an idle iframe does not clear the top document's anonymous jar.
  // This flag caches transport health only; requested content is always fresh.
  function hasSession(){if(!verifiedSession)return false;if(!frame)return true;try{return !!context(frame);}catch{return false;}}
  globalThis.RTPublicBrowser=Object.freeze({read,close,hasSession,isSupported,setRelay});
})();
