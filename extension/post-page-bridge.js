/* Public Reddit reads only. Authentication stays in Reddit's page world. */
(() => {
  'use strict';
  if(window.top!==window || !globalThis.RTPostModel)return;
  const M=RTPostModel,jobs=new Map(),rendererWaits=new WeakMap(),navigationReads=new Map();let active=0,cardActive=0,cooldown=0,starts=[],cardStarts=[];
  function route(){
    const profile=location.pathname.match(/^\/user\/([\w-]{1,20})(?:\/(?:submitted|comments))?\/?$/i);
    const post=location.pathname.match(/^\/(?:r\/[^/]+\/|user\/[^/]+\/)?comments\/([a-z0-9]{1,10})(?:\/.*)?$/i);
    return profile?{username:profile[1]}:post?{id:post[1].toLowerCase()}:null;
  }
  async function boundedText(response){
    if(Number(response.headers.get('content-length'))>2500000)throw Error('Reddit response is too large.');
    let text='';
    if(response.body?.getReader){const reader=response.body.getReader(),decoder=new TextDecoder();let bytes=0;try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>2500000){await reader.cancel();throw Error('Reddit response is too large.');}text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}}
    else text=await response.text();
    if(text.length>2500000)throw Error('Reddit response is too large.');
    return text;
  }
  function commentListing(text,username,{sort='new',range='all'}={}){
    const doc=new DOMParser().parseFromString(text,'text/html'),posts=[];
    const cards=doc.querySelectorAll('[data-testid="search-sdui-comment-unit"]');
    for(const card of [...cards].slice(0,25)){
      try{
        const context=JSON.parse(card.closest('search-telemetry-tracker')?.getAttribute('data-faceplate-tracking-context') || '{}');
        const content=card.querySelector('[data-testid="search-comment-content"]');
        const author=[...card.querySelectorAll('a[href="#"],a[href^="/user/"]')].find(a=>!a.closest('[id$="-post-rtjson-content"]'))?.textContent?.trim();
        if(author?.toLowerCase()!==username.toLowerCase())continue;
        const parts=[...content.querySelectorAll('[id$="-post-rtjson-content"] p')].map(p=>p.textContent.trim());
        const body=parts.length?parts.join('\n\n'):content.querySelector('[id$="-post-rtjson-content"]')?.textContent?.trim();
        const post=M.normalizeComment({id:context.comment?.id,author,body,link_id:context.comment?.post_id || context.post?.id,
          link_title:context.post?.title,subreddit:context.subreddit?.name,over_18:context.post?.nsfw,spoiler:context.post?.spoiler,
          created_utc:Date.parse(content.querySelector('faceplate-timeago')?.getAttribute('ts'))/1000,
          score:Number(content.querySelector('faceplate-number')?.getAttribute('number')) || 0,
          permalink:card.querySelector('a[aria-labelledby^="comment-content-"]')?.getAttribute('href')});
        if(post)posts.push(post);
      }catch{ /* A malformed card cannot become an unsafe or misattributed result. */ }
    }
    if(cards.length && !posts.length)throw Error('Reddit’s comment format changed. Comments could not be read.');
    let after=null;
    for(const part of doc.querySelectorAll('faceplate-partial[loading="lazy"][src]')){
      try{const u=new URL(part.getAttribute('src'),location.origin),cursor=u.searchParams.get('cursor');
        if(u.origin===location.origin && u.pathname==='/svc/shreddit/search/' && u.searchParams.get('q')===`author:"${username}"` && u.searchParams.get('type')==='comments' && (u.searchParams.get('sort') || 'new')===sort && (sort!=='top' || (u.searchParams.get('t') || 'all')===range) && typeof cursor==='string' && cursor.length<=4096)after=cursor;
      }catch{}
    }
    return {posts,after,hasMore:Boolean(after),incomplete:true,source:'reddit'};
  }
  function navigationText(lease){
    const now=Date.now(),app=document.querySelector('shreddit-app');for(const [key,value] of navigationReads)if(value.expires<=now || value.app!==app)navigationReads.delete(key);
    const cached=navigationReads.get(lease);if(cached)return cached.promise;
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
    const promise=(async()=>{const response=await fetch(new URL('/',location.origin).href,{method:'GET',credentials:'include',redirect:'error',headers:{Accept:'text/html'},signal:controller.signal});if(response.status===429){const retry=Number(response.headers.get('retry-after'));cooldown=Date.now()+Math.max(1000,Math.min(3600000,(Number.isFinite(retry)&&retry>0?retry:60)*1000));throw Error('Reddit navigation is rate limited.');}if(!response.ok)throw Error('Reddit navigation could not be loaded.');const doc=new DOMParser().parseFromString(await boundedText(response),'text/html'),navigation=doc.querySelector('flex-left-nav-container#left-sidebar-container');if(!navigation)throw Error('Reddit returned no native navigation.');const bootstrap=navigation.closest('.grid-container')?.previousElementSibling;for(const script of navigation.querySelectorAll('script'))script.remove();const boot=bootstrap?.tagName==='FACEPLATE-LOADER'?bootstrap.cloneNode(false).outerHTML:'';return boot+'<div class="grid-container">'+navigation.outerHTML+'</div>';})().finally(()=>clearTimeout(timer));
    if(navigationReads.size>=2)navigationReads.delete(navigationReads.keys().next().value);const entry={app,promise,expires:now+30000};navigationReads.set(lease,entry);promise.catch(()=>{if(navigationReads.get(lease)===entry)navigationReads.delete(lease);});return promise;
  }
  function nativeModuleSpec(loader){
    const src=loader?.getAttribute('src') || '',prefix=loader?.getAttribute('data-prefix') || '',chunks=src.startsWith('concat:')?src.slice(7).split(','):[];
    return loader?.tagName==='FACEPLATE-LOADER' && chunks.length && chunks.length<=512 && chunks.every(id=>/^[A-Za-z0-9_-]{1,80}$/.test(id)) && /^[A-Za-z0-9_-]{1,30}\/$/.test(prefix)?{chunks,prefix}:null;
  }
  async function renderNavigation(input,signal){
    const context=route(),target=typeof input.target==='string' && /^rt-nav-[a-z0-9-]{1,60}$/i.test(input.target)?document.getElementById(input.target):null;
    const shell=target?.closest('[data-rt-ui="archive-profile"]');
    if(location.protocol!=='https:' || !['reddit.com','www.reddit.com','new.reddit.com','sh.reddit.com'].includes(location.hostname) || !context?.username || !M.validateUsername(input.username) || context.username.toLowerCase()!==input.username.toLowerCase() || target?.dataset.rtUi!=='profile-navigation' || !shell)throw Error('Open the matching archived profile.');
    const now=Date.now();starts=starts.filter(time=>now-time<30000);if(now<cooldown || active>=2 || starts.length>=8)return {deferred:true,retryAfterMs:Math.max(100,now<cooldown?cooldown-now:starts.length>=8?starts[0]+30000-now:250)};
    const Renderer=customElements.get('faceplate-partial');if(typeof Renderer?.prototype?._renderContent!=='function')throw Error('Reddit’s native renderer is not ready.');
    const controller=new AbortController(),cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();let timer;starts.push(now);active++;
    try{return await Promise.race([(async()=>{
      // Only the native navigation fragment is attached. Homepage/feed markup,
      // credentials and personalized HTML never cross into the isolated world.
      const lease=typeof input.navigationLease==='string' && /^[a-z0-9-]{1,60}$/i.test(input.navigationLease)?input.navigationLease:input.target;
      const doc=new DOMParser().parseFromString(await navigationText(lease),'text/html'),navigation=doc.querySelector('flex-left-nav-container#left-sidebar-container');if(!navigation)throw Error('Reddit returned no native navigation.');
      const bootstrap=navigation.closest('.grid-container')?.previousElementSibling,specs=[];
      if(!customElements.get('flex-left-nav-container')){const spec=nativeModuleSpec(bootstrap);if(!spec || typeof window.SML?.load!=='function')throw Error('Reddit’s navigation controller is unavailable.');specs.push(spec);}
      // Parsed SSR scripts do not initialize eager sidebar modules. Ask the
      // native loader to prepare those modules before revealing the fragment.
      if(typeof window.SML?.load==='function')for(const loader of navigation.querySelectorAll('faceplate-loader[loading="eager"]')){const spec=nativeModuleSpec(loader);if(spec)specs.push(spec);}
      const groups=new Map();for(const spec of specs){if(!groups.has(spec.prefix))groups.set(spec.prefix,new Set());for(const id of spec.chunks)groups.get(spec.prefix).add(id);}await Promise.all([...groups].map(([prefix,chunks])=>window.SML.load([...chunks],prefix,'auto')));
      if(!customElements.get('flex-left-nav-container'))throw Error('Reddit’s navigation controller could not be initialized.');
      for(const script of navigation.querySelectorAll('script'))script.remove();
      const current=route();if(controller.signal.aborted || !target.isConnected || document.getElementById(input.target)!==target || target.closest('[data-rt-ui="archive-profile"]')!==shell || current?.username && current.username.toLowerCase()!==input.username.toLowerCase() || !current?.username && !current?.id)throw Error('Page changed. Try again.');
      const partial=document.createElement('faceplate-partial');partial.loading='programmatic';partial.renderMode='contents';partial.style.display='contents';target.replaceChildren(partial);partial._renderContent(navigation.outerHTML);return {rendered:true};
    })(),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Reddit navigation loading timed out.'));},10000);})]);}finally{active--;clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
  }
  function nativeCardUrl(comments,fullname){
    const tag=comments?'shreddit-profile-comment':'shreddit-post',sample=[...document.querySelectorAll('main '+tag)].find(node=>!node.closest('[data-rt-ui]'));
    // Prefer Reddit's own reload contract when present. Only replace the exact
    // item's terminal fullname; never accept arbitrary paths/query credentials.
    const identity=sample?.getAttribute(comments?'comment-id':'id'),reload=sample?.getAttribute('reload-url');
    if(identity && reload){try{
      const url=new URL(reload,location.origin),prefix=comments?'t1_':'t3_',validIdentity=comments?M.validateCommentId(identity):M.validateId(identity);
      if(validIdentity && identity.startsWith(prefix) && url.origin===location.origin && !url.username && !url.password && !url.hash && new RegExp('^/svc/shreddit/(?:[a-z][a-z0-9-]*/){1,3}'+identity+'$').test(url.pathname) && [...url.searchParams].every(([key,value])=>key==='isProfile'?value==='true':key==='pvc'?/^Profile[A-Za-z0-9]{0,24}$/.test(value):key==='fvt' && /^[A-Za-z][A-Za-z0-9]{0,31}$/.test(value))){url.pathname=url.pathname.slice(0,-identity.length)+fullname;return url;}
    }catch{ /* Fall back to the last verified native endpoint. */ }}
    const url=new URL(comments?'/svc/shreddit/comment/'+fullname:'/svc/shreddit/partial-feed-post/'+fullname,location.origin);
    if(comments)url.searchParams.set('isProfile','true');else{
      const view=sample?.getAttribute('view-type'),context=sample?.getAttribute('view-context');
      url.searchParams.set('pvc',context && /^Profile[A-Za-z0-9]{0,24}$/.test(context)?context:'ProfileFeed2');
      url.searchParams.set('fvt',view && /^[A-Za-z][A-Za-z0-9]{0,31}$/.test(view)?view:'cardView');
    }
    return url;
  }
  async function renderCard(input,signal){
    const context=route(),path=location.pathname+location.search,comments=input.kind==='comment';
    if(location.protocol!=='https:' || !['reddit.com','www.reddit.com','new.reddit.com','sh.reddit.com'].includes(location.hostname))throw Error('Open a public Reddit profile.');
    if(!context?.username || !M.validateUsername(input.username) || context.username.toLowerCase()!==input.username.toLowerCase())throw Error('Profile changed. Try again.');
    if(!['post','comment'].includes(input.kind) || !(comments?M.validateCommentId(input.postId):M.validateId(input.postId)))throw Error('Invalid native card identity.');
    if(typeof input.target!=='string' || !/^rt-native-[a-z0-9-]{1,60}$/i.test(input.target))throw Error('Invalid native card target.');
    const fullname=(comments?'t1_':'t3_')+input.postId.toLowerCase().replace(/^t[13]_/,''),target=document.getElementById(input.target);
    if(!target?.isConnected || target.dataset.rtUi!=='activity-item' || target.dataset.rtNativeFullname!==fullname || !target.closest('main'))throw Error('Native card target is no longer available.');
    const selector=comments?`shreddit-profile-comment[comment-id="${fullname}"]`:`shreddit-post[id="${fullname}"]`;
    const alreadyPresent=()=>[...document.querySelectorAll(selector)].some(node=>!target.contains(node));
    if(alreadyPresent())return {rendered:false,duplicate:true,fullname};
    const now=Date.now();cardStarts=cardStarts.filter(t=>now-t<30000);
    if(now<cooldown || cardActive>=2 || cardStarts.length>=12)return {deferred:true,retryAfterMs:Math.max(100,now<cooldown?cooldown-now:cardStarts.length>=12?cardStarts[0]+30000-now:250)};
    if(typeof customElements.get('faceplate-partial')?.prototype?._renderContent!=='function'){
      const since=rendererWaits.get(target) ?? now;rendererWaits.set(target,since);
      if(now-since>=10000)throw Error('Reddit’s native card renderer did not become ready. Retry after the page finishes loading.');
      return {deferred:true,reason:'renderer-startup',retryAfterMs:250};
    }
    rendererWaits.delete(target);const url=nativeCardUrl(comments,fullname);
    const controller=new AbortController(),cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
    let timer;cardStarts.push(now);cardActive++;
    try{
      const operation=(async()=>{
        const response=await fetch(url.href,{method:'GET',credentials:'include',redirect:'error',headers:{Accept:'text/vnd.reddit.partial+html, text/html;q=0.9'},signal:controller.signal});
        if(response.status===429){const retry=Number(response.headers.get('retry-after'));cooldown=Date.now()+Math.max(1000,Math.min(3600000,(Number.isFinite(retry)&&retry>0?retry:60)*1000));return {deferred:true,reason:'rate-limit',retryAfterMs:cooldown-Date.now()};}
        if(!response.ok)throw Error(`Reddit could not render this card (HTTP ${response.status}).`);
        if(response.headers.get('content-type')?.split(';')[0].trim()!=='text/vnd.reddit.partial+html')throw Error('Reddit returned no native card fragment.');
        const text=await boundedText(response),doc=new DOMParser().parseFromString(text,'text/html');
        if(!doc.querySelector(selector))throw Error('Reddit returned no matching native card.');
        if(location.pathname+location.search!==path || controller.signal.aborted || !target.isConnected || document.getElementById(input.target)!==target)throw Error('Page changed. Try again.');
        if(alreadyPresent())return {rendered:false,duplicate:true,fullname};
        // The authenticated HTML stays in Reddit's page world. Use its own trusted
        // fragment renderer so component modules, media and native actions hydrate.
        const partial=document.createElement('faceplate-partial');partial.loading='programmatic';partial.src=url.pathname+url.search;partial.renderMode='contents';
        target.replaceChildren(partial);partial._renderContent(text);
        if(!target.querySelector(selector))throw Error('Reddit could not attach its native card.');
        target.dataset.rtNativeState='ready';return {rendered:true,fullname};
      })();
      const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Native card loading timed out.'));},10000);});
      return await Promise.race([operation,timeout]);
    }finally{cardActive--;clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
  }
  async function read(input,signal){
    if(input.action==='render-card')return renderCard(input,signal);
    if(input.action==='render-navigation')return renderNavigation(input,signal);
    const context=route(),path=location.pathname+location.search;
    if(!context || !['reddit.com','www.reddit.com','new.reddit.com','sh.reddit.com','old.reddit.com'].includes(location.hostname))throw Error('Open a public Reddit profile or post.');
    const comments=input.kind==='comment';
    const sort=input.sort ?? 'new',range=input.range ?? 'all';
    if(!['new','hot','top'].includes(sort) || !['hour','day','week','month','year','all'].includes(range))throw Error('Invalid public feed sort.');
    if(input.kind!=null && !['post','comment'].includes(input.kind))throw Error('Invalid content type.');
    const url=new URL('/api/info.json',location.origin);
    if(input.action==='profile'){
      if(!context.username || !M.validateUsername(input.username) || context.username.toLowerCase()!==input.username.toLowerCase())throw Error('Profile changed. Try again.');
      if(input.after!=null && (comments?(typeof input.after!=='string' || input.after.length>4096 || /[\u0000-\u001f]/.test(input.after)):!/^t3_[a-z0-9]{1,10}$/i.test(input.after)))throw Error('Invalid Reddit page cursor.');
      url.pathname=comments?'/svc/shreddit/search/':'/search.json';url.searchParams.set('q',`author:"${input.username}"`);url.searchParams.set('type',comments?'comments':'link');url.searchParams.set('sort',sort);if(sort==='top')url.searchParams.set('t',range);url.searchParams.set('limit','25');
      if(input.after)url.searchParams.set(comments?'cursor':'after',input.after);
    }else if(input.action==='info'){
      if(!Array.isArray(input.ids) || !input.ids.length || input.ids.length>25 || !input.ids.every(id=>comments?M.validateCommentId(id):M.validateId(id)))throw Error('Invalid public post IDs.');
      const ids=input.ids.map(id=>id.toLowerCase().replace(/^t[13]_/, ''));
      if(context.id && (comments || ids.length!==1 || ids[0]!==context.id))throw Error('Post changed. Try again.');
      url.searchParams.set('id',ids.map(id=>(comments?'t1_':'t3_')+id).join(','));
    }else throw Error('Unknown public post operation.');
    const now=Date.now();starts=starts.filter(time=>now-time<30000);
    if(now<cooldown)throw Error('Reddit asked us to wait. Try again shortly.');
    if(active>=2 || starts.length>=8)return {deferred:true,retryAfterMs:Math.max(100,starts.length>=8?starts[0]+30000-now:250)};
    starts.push(now);active++;
    url.searchParams.set('raw_json','1');
    const controller=new AbortController(),cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
    let timer;
    try{
      const operation=(async()=>{
        const response=await fetch(url.href,{method:'GET',credentials:'include',redirect:'error',headers:{Accept:comments && input.action==='profile'?'text/vnd.reddit.partial+html, text/html;q=0.9':'application/json'},signal:controller.signal});
        if(response.status===429){const retry=Number(response.headers.get('retry-after'));cooldown=Date.now()+Math.max(1000,Math.min(3600000,(Number.isFinite(retry)&&retry>0?retry:60)*1000));throw Error('Reddit rate limit reached. Try again later.');}
        if(!response.ok)throw Error(`Reddit could not load public posts (HTTP ${response.status}).`);
        const text=await boundedText(response);
        if(location.pathname+location.search!==path || controller.signal.aborted)throw Error('Page changed. Try again.');
        if(comments && input.action==='profile')return commentListing(text,input.username,{sort,range});
        let data;try{data=JSON.parse(text);}catch{throw Error('Reddit returned an unexpected response.');}
        if(!Array.isArray(data?.data?.children) || data.data.children.length>100)throw Error('Reddit returned an unexpected post listing.');
        if(location.pathname+location.search!==path || controller.signal.aborted)throw Error('Page changed. Try again.');
        const posts=data.data.children.filter(item=>item.kind===(comments?'t1':'t3')).slice(0,25).map(item=>(comments?M.normalizeComment:M.normalizePost)(item.data,{source:'reddit'})).filter(Boolean);
        const filtered=input.action==='profile'?posts.filter(p=>p.author.toLowerCase()===input.username.toLowerCase()):posts.filter(p=>input.ids.some(id=>id.toLowerCase().replace(/^t[13]_/, '')===p.id));
        const after=typeof data.data.after==='string' && /^t3_[a-z0-9]{1,10}$/i.test(data.data.after)?data.data.after:null;
        return {posts:filtered,after,hasMore:Boolean(after),incomplete:true,source:'reddit'};
      })();
      const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Reddit request timed out. Try again.'));},10000);});
      return await Promise.race([operation,timeout]);
    }finally{active--;clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
  }
  document.addEventListener('rt-post-request',async event=>{
    let input;try{input=JSON.parse(event.detail);}catch{return;}
    if(typeof input?.channel!=='string' || input.channel.length>80 || typeof input.id!=='string' || input.id.length>80)return;
    const key=input.channel+':'+input.id;
    if(input.action==='cancel'){jobs.get(key)?.abort();return;}
    if(jobs.has(key))return;
    if(jobs.size>=4){const deferred=['render-card','render-navigation','profile','info'].includes(input.action);document.dispatchEvent(new CustomEvent('rt-post-response',{detail:JSON.stringify({channel:input.channel,id:input.id,ok:deferred,...(deferred?{deferred:true,retryAfterMs:250}:{error:'Please wait for the current Reddit request.'})})}));return;}
    const controller=new AbortController();jobs.set(key,controller);
    try{const result=await read(input,controller.signal);document.dispatchEvent(new CustomEvent('rt-post-response',{detail:JSON.stringify({channel:input.channel,id:input.id,ok:true,...result})}));}
    catch(error){document.dispatchEvent(new CustomEvent('rt-post-response',{detail:JSON.stringify({channel:input.channel,id:input.id,ok:false,error:controller.signal.aborted?'Post request cancelled.':error.message})}));}
    finally{jobs.delete(key);}
  });
})();
