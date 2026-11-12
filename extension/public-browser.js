/* Anonymous native-browser search. No visible tabs or owner-session credentials. */
(() => {
  'use strict';
  if(window.top!==window || globalThis.RTPublicBrowser)return;
  const origin='https://www.reddit.com',maxBytes=3000000;
  let frame=null,queue=Promise.resolve(),pending=0,idleTimer=null,cooldownUntil=0,activeController=null,revision=0;
  const failure=(message='Reddit blocked logged-out search (HTTP 403).')=>Error(message);
  function discard(){frame?.remove();frame=null;window.removeEventListener('pagehide',close);}
  function close(){revision++;clearTimeout(idleTimer);activeController?.abort();discard();}
  function idle(){clearTimeout(idleTimer);if(!pending)idleTimer=setTimeout(discard,20000);}
  function validate(value){
    const url=new URL(value),p=url.searchParams;
    const profile=location.pathname.match(/^\/user\/([\w-]{1,20})(?:\/(?:submitted|comments|search))?\/?$/i);
    if(location.origin!==origin || !profile || url.origin!==origin || url.username || url.password || url.port || url.hash || url.pathname!=='/svc/shreddit/search/')throw failure();
    const q=p.get('q') || '',author=q.match(/^author:"([\w-]{1,20})"(?: [^\u0000-\u001f\u007f]{1,300})?$/);
    if(!author || author[1].toLowerCase()!==profile[1].toLowerCase() || !['posts','comments'].includes(p.get('type')) || !['new','hot','top','relevance','comments'].includes(p.get('sort')) || p.get('limit')!=='25')throw failure();
    if(p.has('t') && !['hour','day','week','month','year','all'].includes(p.get('t')) || p.has('cursor') && (!p.get('cursor') || p.get('cursor').length>4096 || /[\u0000-\u001f\u007f]/.test(p.get('cursor'))))throw failure();
    for(const key of p.keys())if(!['q','type','sort','limit','t','cursor','rt_public_search'].includes(key) || p.getAll(key).length!==1)throw failure();
    p.delete('rt_public_search');return url;
  }
  function create(){
    if(frame?.isConnected)return frame;
    discard();
    const node=document.createElement('iframe');
    if(!('credentialless' in node))throw failure();
    node.credentialless=true;
    node.setAttribute('sandbox','allow-scripts allow-same-origin');
    node.setAttribute('aria-hidden','true');node.tabIndex=-1;node.inert=true;
    // Fixed positioning outside the viewport contributes no layout or scroll space.
    for(const [key,value] of Object.entries({position:'fixed',width:'1px',height:'1px',left:'-10000px',top:'0',border:'0','pointer-events':'none'}))node.style.setProperty(key,value,'important');
    node.referrerPolicy='no-referrer';node.src=origin+'/';
    document.documentElement.append(node);frame=node;window.addEventListener('pagehide',close);return node;
  }
  function context(node){
    try{
      const w=node.contentWindow,d=node.contentDocument,app=d?.querySelector('shreddit-app');
      if(node!==frame || !node.isConnected || !node.credentialless || w.credentialless!==true || w.location.origin!==origin || w.location.pathname!=='/')return null;
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
  async function perform(value,{signal}={}){
    const url=validate(value),page=location.href,generation=revision;
    if(signal?.aborted)throw failure('Post request cancelled.');
    if(cooldownUntil>Date.now())throw failure();
    const controller=new AbortController(),cancel=()=>controller.abort();activeController=controller;signal?.addEventListener('abort',cancel,{once:true});
    let timer,node;
    try{
      node=create();const initial=await ready(node,controller.signal);
      if(signal?.aborted || controller.signal.aborted)throw failure('Post request cancelled.');
      timer=setTimeout(()=>controller.abort(),5000);
      const response=await initial.window.fetch(url.href,{method:'GET',credentials:'same-origin',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',headers:{Accept:'text/vnd.reddit.partial+html, text/html;q=0.9'},signal:controller.signal});
      if(response.status===429){cooldownUntil=Date.now()+60000;throw failure('Reddit rate limit reached. Try again later.');}
      if(!response.ok || response.redirected || response.url!==url.href)throw failure();
      const result=await text(response,controller),current=context(node);
      if(controller.signal.aborted || location.href!==page || !current || current.window!==initial.window || current.document!==initial.document)throw failure('Page changed. Try again.');
      return result;
    }catch(error){
      controller.abort();
      const cancelled=signal?.aborted || generation!==revision || location.href!==page;
      discard();if(!cancelled && cooldownUntil<=Date.now())cooldownUntil=Date.now()+600000;
      if(cancelled)throw failure('Post request cancelled.');throw error;
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
  globalThis.RTPublicBrowser=Object.freeze({read,close});
})();
