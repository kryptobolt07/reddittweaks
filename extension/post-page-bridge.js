/* Public Reddit reads only. Authentication stays in Reddit's page world. */
(() => {
  'use strict';
  if(window.top!==window || !globalThis.RTPostModel)return;
  const M=RTPostModel,jobs=new Map();let active=0,cardActive=0,cooldown=0,starts=[],cardStarts=[];
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
  function commentListing(text,username){
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
        if(u.origin===location.origin && u.pathname==='/svc/shreddit/search/' && u.searchParams.get('q')===`author:"${username}"` && u.searchParams.get('type')==='comments' && typeof cursor==='string' && cursor.length<=4096)after=cursor;
      }catch{}
    }
    return {posts,after,hasMore:Boolean(after),incomplete:true,source:'reddit'};
  }
  async function renderCard(input,signal){
    const context=route(),path=location.pathname,comments=input.kind==='comment';
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
    if(now<cooldown || cardActive>=2 || cardStarts.length>=12)throw Error('Please wait before loading another native card.');
    const url=new URL(comments?'/svc/shreddit/comment/'+fullname:'/svc/shreddit/partial-feed-post/'+fullname,location.origin);
    if(comments)url.searchParams.set('isProfile','true');else{
      const sample=[...document.querySelectorAll('main shreddit-feed shreddit-post')].find(node=>!node.closest('[data-rt-ui]'));
      const view=sample?.getAttribute('view-type'),context=sample?.getAttribute('view-context');
      url.searchParams.set('pvc',context && /^Profile[A-Za-z0-9]{0,24}$/.test(context)?context:'ProfileFeed2');
      url.searchParams.set('fvt',view && /^[A-Za-z][A-Za-z0-9]{0,31}$/.test(view)?view:'cardView');
    }
    const controller=new AbortController(),cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
    let timer,definitionAbort;cardStarts.push(now);cardActive++;
    try{
      const operation=(async()=>{
        // Discovery now mounts before Reddit's modules. Wait within the same
        // bounded operation instead of failing early or fetching another copy.
        if(!customElements.get('faceplate-partial'))await new Promise((resolve,reject)=>{
          definitionAbort=()=>reject(Error('Native card request cancelled.'));controller.signal.addEventListener('abort',definitionAbort,{once:true});
          if(controller.signal.aborted){definitionAbort();return;}customElements.whenDefined('faceplate-partial').then(resolve,reject);
        });
        if(location.pathname!==path || controller.signal.aborted || !target.isConnected)throw Error('Page changed. Try again.');
        if(typeof customElements.get('faceplate-partial')?.prototype?._renderContent!=='function')throw Error('Reddit’s native card renderer is not ready.');
        const response=await fetch(url.href,{method:'GET',credentials:'include',redirect:'error',headers:{Accept:'text/vnd.reddit.partial+html, text/html;q=0.9'},signal:controller.signal});
        if(response.status===429){cooldown=Date.now()+60000;throw Error('Reddit rate limit reached. Try again later.');}
        if(!response.ok)throw Error(`Reddit could not render this card (HTTP ${response.status}).`);
        if(response.headers.get('content-type')?.split(';')[0].trim()!=='text/vnd.reddit.partial+html')throw Error('Reddit returned no native card fragment.');
        const text=await boundedText(response),doc=new DOMParser().parseFromString(text,'text/html');
        if(!doc.querySelector(selector))throw Error('Reddit returned no matching native card.');
        if(location.pathname!==path || controller.signal.aborted || !target.isConnected || document.getElementById(input.target)!==target)throw Error('Page changed. Try again.');
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
    }finally{cardActive--;clearTimeout(timer);signal?.removeEventListener('abort',cancel);if(definitionAbort)controller.signal.removeEventListener('abort',definitionAbort);}
  }
  async function read(input,signal){
    if(input.action==='render-card')return renderCard(input,signal);
    const context=route(),path=location.pathname;
    if(!context || !['reddit.com','www.reddit.com','new.reddit.com','sh.reddit.com','old.reddit.com'].includes(location.hostname))throw Error('Open a public Reddit profile or post.');
    const comments=input.kind==='comment';
    if(input.kind!=null && !['post','comment'].includes(input.kind))throw Error('Invalid content type.');
    const url=new URL('/api/info.json',location.origin);
    if(input.action==='profile'){
      if(!context.username || !M.validateUsername(input.username) || context.username.toLowerCase()!==input.username.toLowerCase())throw Error('Profile changed. Try again.');
      if(input.after!=null && (comments?(typeof input.after!=='string' || input.after.length>4096 || /[\u0000-\u001f]/.test(input.after)):!/^t3_[a-z0-9]{1,10}$/i.test(input.after)))throw Error('Invalid Reddit page cursor.');
      url.pathname=comments?'/svc/shreddit/search/':'/search.json';url.searchParams.set('q',`author:"${input.username}"`);url.searchParams.set('type',comments?'comments':'link');url.searchParams.set('sort','new');url.searchParams.set('limit','25');
      if(input.after)url.searchParams.set(comments?'cursor':'after',input.after);
    }else if(input.action==='info'){
      if(!Array.isArray(input.ids) || !input.ids.length || input.ids.length>25 || !input.ids.every(id=>comments?M.validateCommentId(id):M.validateId(id)))throw Error('Invalid public post IDs.');
      const ids=input.ids.map(id=>id.toLowerCase().replace(/^t[13]_/, ''));
      if(context.id && (comments || ids.length!==1 || ids[0]!==context.id))throw Error('Post changed. Try again.');
      url.searchParams.set('id',ids.map(id=>(comments?'t1_':'t3_')+id).join(','));
    }else throw Error('Unknown public post operation.');
    const now=Date.now();starts=starts.filter(time=>now-time<30000);
    if(now<cooldown)throw Error('Reddit asked us to wait. Try again shortly.');
    if(active>=2 || starts.length>=8)throw Error('Please wait for the current Reddit request.');
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
        if(location.pathname!==path || controller.signal.aborted)throw Error('Page changed. Try again.');
        if(comments && input.action==='profile')return commentListing(text,input.username);
        let data;try{data=JSON.parse(text);}catch{throw Error('Reddit returned an unexpected response.');}
        if(!Array.isArray(data?.data?.children) || data.data.children.length>100)throw Error('Reddit returned an unexpected post listing.');
        if(location.pathname!==path || controller.signal.aborted)throw Error('Page changed. Try again.');
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
    if(jobs.size>=4){document.dispatchEvent(new CustomEvent('rt-post-response',{detail:JSON.stringify({channel:input.channel,id:input.id,ok:false,error:'Please wait for the current Reddit request.'})}));return;}
    const controller=new AbortController();jobs.set(key,controller);
    try{const result=await read(input,controller.signal);document.dispatchEvent(new CustomEvent('rt-post-response',{detail:JSON.stringify({channel:input.channel,id:input.id,ok:true,...result})}));}
    catch(error){document.dispatchEvent(new CustomEvent('rt-post-response',{detail:JSON.stringify({channel:input.channel,id:input.id,ok:false,error:controller.signal.aborted?'Post request cancelled.':error.message})}));}
    finally{jobs.delete(key);}
  });
})();
