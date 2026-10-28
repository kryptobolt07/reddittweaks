/* Opt-in, credential-free public archive requests. No archive data is persisted. */
(() => {
  'use strict';
  if(!globalThis.RTPostModel)importScripts('post-model.js');
  // limit is the profile page size (API maximum 100); ID lookups are bounded separately by their validated input.
  const Model=globalThis.RTPostModel,limit=100,ttl=30000,timeoutMs=12000;
  // Comment parent titles: in-memory only, keyed by post ID, shared across profiles.
  const titleTtl=600000,titleMax=2000,titleTimeoutMs=6000;
  const archiveInit={credentials:'omit',referrerPolicy:'no-referrer',redirect:'error'};
  const pending=new Map(),cache=new Map(),titles=new Map(),profiles=new Map(),commentContexts=new Map(),subscribers=new Set();
  let active=0,cooldownUntil=0;const waiters=[];
  // Arctic Shift answers 503 {"error":"Under maintenance"} while it is down.
  // Pause every archive request (all tabs) with growing backoff, so pages fail
  // fast instead of re-requesting a service that is offline.
  let unavailableUntil=0,unavailableCount=0,unavailableMaintenance=false;
  const unavailable=()=>fail(unavailableMaintenance?'Arctic Shift is down for maintenance.':'Arctic Shift is temporarily unavailable.',unavailableMaintenance?'maintenance':'unavailable',{retryAt:unavailableUntil});
  async function markUnavailable(response,controller,probe=false){
    let text='';try{text=(await readBounded(response,controller)) || '';}catch{}
    unavailableMaintenance=/maintenance/i.test(text.slice(0,2000));
    // Requests already in flight report the same outage; count it once. A
    // reader's explicit probe that fails starts the next, longer pause.
    if(probe || unavailableUntil<=Date.now()){unavailableCount++;unavailableUntil=Date.now()+Math.min(60000*2**(unavailableCount-1),600000);}
    return unavailable();
  }
  function markAvailable(){unavailableUntil=0;unavailableCount=0;unavailableMaintenance=false;}
  function fail(message,code='archive-error',extra={}){return {ok:false,error:message,code,incomplete:true,...extra};}
  async function enabled(requireRestoration=false){
    const stored=await chrome.storage.local.get('rt-settings-v1'),settings=Model.normalizeSettings(stored['rt-settings-v1']);
    const allowed=settings.postDiscovery && settings.archiveDiscovery;if(!allowed){cache.clear();titles.clear();commentContexts.clear();}return allowed && (!requireRestoration || settings.restoreDeletedContent);
  }
  const disabled=()=>fail('Enable archive discovery in Reddit Tweaks settings.','disabled');
  function authorized(sender,username,ids){
    if(sender?.id!==chrome.runtime.id || sender.frameId!=null && sender.frameId!==0)return false;
    try{const url=new URL(sender.url);if(url.protocol!=='https:' || !['reddit.com','www.reddit.com','old.reddit.com','new.reddit.com','sh.reddit.com'].includes(url.hostname) || url.port)return false;
      if(sender.origin && sender.origin!==url.origin)return false;
      // sender.url stays at the document's first URL after Reddit's in-page
      // navigation (profile -> post, post -> profile). Our content script reports
      // its current location (only extension scripts can message the worker);
      // the tab URL is the fallback. The route must match that current page.
      let current=sender.tab?.url?new URL(sender.tab.url):url;
      if(typeof sender.page==='string')current=new URL(sender.page);
      if(current.origin!==url.origin || current.protocol!=='https:')return false;
      if(ids){const detail=current.pathname.match(/^\/(?:(?:r|user)\/[^/]+\/)?comments\/([a-z0-9]+)(?:\/.*)?$/i);return Boolean(detail && ids.length===1 && detail[1].toLowerCase()===ids[0]);}
      const profile=current.pathname.match(/^\/user\/([A-Za-z0-9_-]{1,20})(?:\/(?:submitted|comments))?\/?$/i);
      return profile?.[1].toLowerCase()===username.toLowerCase();
    }catch{return false;}
  }
  async function slot(){if(active>=2)await new Promise(resolve=>waiters.push(resolve));else active++;return ()=>{const next=waiters.shift();if(next)next();else active--;};}
  function cooldown(response){
    const now=Date.now(),retry=response.headers?.get('Retry-After'),reset=response.headers?.get('X-RateLimit-Reset'),resetAt=response.headers?.get('X-RateLimit-Reset-At');
    let until=0;
    if(retry){const seconds=Number(retry);until=Number.isFinite(seconds)?now+Math.max(0,seconds)*1000:Date.parse(retry)||0;}
    if(reset){const number=Number(reset);if(Number.isFinite(number))until=Math.max(until,number>1e9?number*1000:now+Math.max(0,number)*1000);}
    // X-RateLimit-Reset-At is an absolute epoch in milliseconds; values below 1e12 are read as epoch seconds.
    if(resetAt){const number=Number(resetAt);if(Number.isFinite(number) && number>0)until=Math.max(until,number<1e12?number*1000:number);}
    if(response.status===429 && until<=now)until=now+60000;
    if(response.status===429 || response.headers?.get('X-RateLimit-Remaining')==='0')cooldownUntil=Math.max(cooldownUntil,until);
  }
  // Shared transport bound for every archive response: declared length first, then streamed bytes. Returns null when too large.
  async function readBounded(response,controller){
    if(Number(response.headers?.get('Content-Length'))>3000000)return null;
    let text='';
    if(response.body?.getReader && typeof TextDecoder!=='undefined'){
      const reader=response.body.getReader(),decoder=new TextDecoder();let bytes=0;
      try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>3000000){controller.abort();await reader.cancel();return null;}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}
    }else text=await response.text();
    return text.length>3000000?null:text;
  }
  async function request(username,before,ids,kind='post',{contextOnly=false,recoverSender=null,titles=true,force=false}={}){
    const release=await slot();
    try{
      if(!await enabled(Boolean(recoverSender)))return disabled();
      if(recoverSender && !authorized(recoverSender,username,null))return fail('Archive recovery requires the matching Reddit profile.','forbidden');
      if(cooldownUntil>Date.now())return fail('Archive requests are cooling down.','rate-limited',{retryAt:cooldownUntil});
      // A reader's explicit Retry now may probe once during the pause.
      if(unavailableUntil>Date.now() && !force)return unavailable();
      const url=new URL('https://arctic-shift.photon-reddit.com/api/'+(kind==='comment'?'comments':'posts')+'/'+(ids?'ids':'search'));
      if(ids)url.searchParams.set('ids',ids.join(','));else{url.searchParams.set('author',username);url.searchParams.set('sort','desc');url.searchParams.set('limit',String(limit));if(before!=null)url.searchParams.set('before',String(before));}
      // Arctic Shift's server-rendered markdown (body_html/selftext_html); the page sanitizes it.
      url.searchParams.set('md2html',contextOnly?'false':'true');
      // Media fields are not selectable individually; unprojected activity
      // responses retain them. Context-only parent reads remain projected.
      // Transport and accepted records remain bounded.
      if(kind==='comment' && contextOnly)url.searchParams.set('fields','id,author,link_id,created_utc');
      const controller=new AbortController();let timer,value;
      try{
        const timedOut=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Archive request timed out.'));},timeoutMs);});
        const operation=(async()=>{
          const response=await fetch(url.href,{...archiveInit,signal:controller.signal});cooldown(response);
          if([502,503,504].includes(response.status))return markUnavailable(response,controller,force && unavailableUntil>Date.now());
          if(!response.ok)return fail(response.status===429?'Archive rate limit reached.':'Archive service could not load posts.',response.status===429?'rate-limited':'http-error',{retryAt:cooldownUntil||undefined});
          // Both transport text and accepted record count are bounded before normalization.
          const text=await readBounded(response,controller);if(text==null)return fail('Archive response is too large.','invalid-response');
          let json;try{json=JSON.parse(text);}catch{return fail('Invalid archive response.','invalid-response');}
          markAvailable();
          if(!Array.isArray(json?.data) || json.data.length>100)return fail('Invalid archive response.','invalid-response');
          const raw=json.data.slice(0,limit),posts=raw.map(item=>(kind==='comment'?Model.normalizeComment:Model.normalizePost)(item,{source:'arctic-shift'})).filter(post=>post && (ids?ids.includes(post.id):post.author.toLowerCase()===username && (before==null || post.created<before)));
          const oldest=posts.length?Math.min(...posts.map(post=>post.created)):null,hasMore=!ids && json.data.length>=limit;
          // before is exclusive. Overlap the oldest second so same-second records are never silently skipped.
          // A stalled overlap must be shown to the user; this API cannot prove exhaustion within that second.
          const cursor=hasMore && oldest!=null?oldest+1:null,stalled=hasMore && (cursor==null || before!=null && cursor>=before);
          return {ok:true,posts,before:cursor,hasMore,source:'arctic-shift',incomplete:true,cursorStalled:stalled,
            paginationWarning:hasMore?'Timestamp pagination overlaps its oldest second; archive coverage is incomplete.':'',cursorMode:'exclusive-overlap-second'};
        })();
        value=await Promise.race([operation,timedOut]);
      }catch(error){return fail(controller.signal.aborted?'Archive request timed out.':'Archive service is unavailable.',controller.signal.aborted?'timeout':'network-error');}
      finally{clearTimeout(timer);}
      // Title fill has its own budget and runs after the page timer is cleared, so it never turns a page into a timeout.
      if(value.ok && kind==='comment' && !contextOnly && titles)await fillCommentTitles(value.posts);
      return value;
    }finally{release();}
  }
  // Best-effort parent titles and NSFW/spoiler flags for comment rows. Every failure leaves the page unchanged.
  async function lookupTitles(ids){
    const url=new URL('https://arctic-shift.photon-reddit.com/api/posts/ids');url.searchParams.set('ids',ids.join(','));url.searchParams.set('md2html','false');url.searchParams.set('fields','id,title,subreddit,over_18,spoiler');
    const controller=new AbortController();let timer;
    try{
      const timedOut=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Title lookup timed out.'));},titleTimeoutMs);});
      const operation=(async()=>{
        const response=await fetch(url.href,{...archiveInit,signal:controller.signal});cooldown(response);
        if(!response.ok)return false;
        const text=await readBounded(response,controller);if(text==null)return false;
        let json;try{json=JSON.parse(text);}catch{return false;}
        if(!Array.isArray(json?.data) || json.data.length>100)return false;
        // Only records for a requested post ID are accepted; anything else is ignored.
        const requested=new Set(ids),found=new Map();
        for(const item of json.data){const info=Model.normalizeLinkInfo(item);if(info && requested.has(info.id))found.set(info.id,info);}
        // A successful lookup also caches absent posts so later pages do not ask again within the TTL.
        if(!await enabled())return false;
        const expires=Date.now()+titleTtl;
        for(const id of ids){const info=found.get(id);titles.delete(id);titles.set(id,{title:info?.title||'',subreddit:info?.subreddit||'',over18:info?.over18===true,spoiler:info?.spoiler===true,expires});}
        while(titles.size>titleMax)titles.delete(titles.keys().next().value);
        return true;
      })();
      return await Promise.race([operation,timedOut]);
    }catch{return false;}
    finally{clearTimeout(timer);}
  }
  async function fillCommentTitles(posts){
    const now=Date.now();for(const [id,entry] of titles)if(entry.expires<=now)titles.delete(id);
    const missing=[...new Set(posts.map(post=>post.linkId).filter(id=>id && !titles.has(id)))].slice(0,100);
    if(missing.length && cooldownUntil<=now && unavailableUntil<=now && await enabled())await lookupTitles(missing);
    for(const post of posts){const info=titles.get(post.linkId);if(!info || info.expires<=Date.now())continue;if(!post.title && info.title)post.title=info.title;if(info.over18)post.over18=true;if(info.spoiler)post.spoiler=true;}
  }
  // Thread restoration: archived text for deleted/removed comments shown on the
  // open post page. Only that post's own page may ask, only for its comments.
  async function archiveComments(message,sender){
    if(!Model.validateId(message.postId) || !Array.isArray(message.ids) || !message.ids.length || message.ids.length>100 || !message.ids.every(Model.validateCommentId))return fail('Invalid comment IDs.','invalid-request');
    const postId=message.postId.toLowerCase().replace(/^t3_/,''),ids=[...new Set(message.ids.map(id=>id.toLowerCase().replace(/^t1_/,'')))].sort();
    if(!authorized(sender,'',[postId]))return fail('Comment recovery requires the matching Reddit post.','forbidden');
    if(!await enabled(true))return disabled();
    const key='thread:'+postId+':'+ids.join(','),saved=cache.get(key);
    if(saved?.expires>Date.now())return saved.value;
    if(pending.has(key))return pending.get(key);
    if(pending.size>=50)return fail('Too many archive requests.','busy');
    const operation=request('',null,ids,'comment',{titles:false}).then(async value=>{
      if(!await enabled(true))return disabled();
      if(value.ok){value={...value,posts:value.posts.filter(post=>post.linkId===postId)};if(cache.size>=50)cache.delete(cache.keys().next().value);cache.set(key,{value,expires:Date.now()+ttl});}
      return value;
    });
    pending.set(key,operation);try{return await operation;}finally{pending.delete(key);}
  }
  const contextKey=(sender,username)=>sender.tab.id+':'+username.toLowerCase();
  function rememberCommentContexts(message,sender,value){
    if(message.action!=='archive-profile' || message.kind!=='comment' || !Number.isInteger(sender.tab?.id) || !value?.ok)return;
    const now=Date.now();for(const [key,scope] of commentContexts)if(scope.expires<=now)commentContexts.delete(key);
    const key=contextKey(sender,message.username),scope=commentContexts.get(key) || {children:new Map()};scope.expires=now+600000;
    for(const post of value.posts || [])scope.children.set(post.id,{parentId:post.parentId,linkId:post.linkId});
    while(scope.children.size>200)scope.children.delete(scope.children.keys().next().value);commentContexts.delete(key);commentContexts.set(key,scope);while(commentContexts.size>30)commentContexts.delete(commentContexts.keys().next().value);
  }
  async function archiveParents(message,sender){
    if(!Model.validateUsername(message.username) || !Array.isArray(message.children) || !message.children.length || message.children.length>25 || !message.children.every(Model.validateCommentId))return fail('Invalid reply-context IDs.','invalid-request');
    const username=message.username.toLowerCase();if(!Number.isInteger(sender.tab?.id) || !authorized(sender,username,null))return fail('Reply context requires the matching profile.','forbidden');
    if(!await enabled())return disabled();const scope=commentContexts.get(contextKey(sender,username)),children=message.children.map(id=>id.toLowerCase().replace(/^t1_/,''));
    if(!scope || scope.expires<=Date.now() || children.some(id=>!scope.children.has(id)))return fail('Reload profile activity before looking up its reply context.','forbidden');
    const links=new Map();for(const child of children){const p=scope.children.get(child);if(/^t1_[a-z0-9]{1,32}$/.test(p.parentId || '')){const id=p.parentId.slice(3);if(!links.has(id))links.set(id,new Set());links.get(id).add(p.linkId);}}
    const ids=[...links.keys()].sort();if(!ids.length)return {ok:true,posts:[],incomplete:true,source:'arctic-shift'};
    const key='parents:'+contextKey(sender,username)+':'+ids.join(','),saved=cache.get(key);if(saved?.expires>Date.now())return saved.value;if(pending.has(key))return pending.get(key);if(pending.size>=50)return fail('Too many archive requests.','busy');
    const operation=request(username,null,ids,'comment',{contextOnly:true}).then(value=>{if(value.ok){value={...value,posts:value.posts.filter(p=>links.get(p.id)?.has(p.linkId))};if(cache.size>=50)cache.delete(cache.keys().next().value);cache.set(key,{value,expires:Date.now()+ttl});}return value;});pending.set(key,operation);try{return await operation;}finally{pending.delete(key);}
  }
  async function archiveRecover(message,sender){
    const kind=message.kind,validId=kind==='comment'?Model.validateCommentId:Model.validateId;
    if(!['post','comment'].includes(kind) || !Model.validateUsername(message.username) || !Array.isArray(message.ids) || !message.ids.length || message.ids.length>25 || !message.ids.every(validId))return fail('Invalid recovery IDs.','invalid-request');
    const username=message.username.toLowerCase(),ids=[...new Set(message.ids.map(id=>id.toLowerCase().replace(kind==='comment'?/^t1_/:/^t3_/,'')))].sort();
    if(!authorized(sender,username,null))return fail('Archive recovery requires the matching Reddit profile.','forbidden');
    if(!await enabled(true))return disabled();
    const key='recover:'+username+':'+kind+':'+ids.join(','),saved=cache.get(key);
    if(saved?.expires>Date.now())return saved.value;
    if(pending.has(key))return pending.get(key);
    if(pending.size>=50)return fail('Too many archive requests.','busy');
    const operation=request(username,null,ids,kind,{recoverSender:sender}).then(async value=>{
      if(!await enabled(true))return disabled();
      if(!authorized(sender,username,null))return fail('Archive recovery requires the matching Reddit profile.','forbidden');
      if(value.ok){value={...value,posts:value.posts.filter(post=>post.author.toLowerCase()===username)};if(cache.size>=50)cache.delete(cache.keys().next().value);cache.set(key,{value,expires:Date.now()+ttl});}return value;
    });
    pending.set(key,operation);try{return await operation;}finally{pending.delete(key);}
  }
  async function handle(message,sender){
    if(message?.scope!=='rt-posts')return;
    if(message.action==='get-settings'){
      let u;try{u=new URL(sender?.url);}catch{}
      if(sender?.id!==chrome.runtime.id || sender.frameId!==0 || u?.protocol!=='https:' || !['reddit.com','www.reddit.com','new.reddit.com','sh.reddit.com'].includes(u?.hostname) || u.port || sender.origin && sender.origin!==u.origin)return fail('Settings require a Reddit page.','forbidden');
      if(Number.isInteger(sender.tab?.id)){if(subscribers.size>=30)subscribers.delete(subscribers.values().next().value);subscribers.add(sender.tab.id);}
      const stored=await chrome.storage.local.get('rt-settings-v1');return {ok:true,settings:Model.normalizeSettings(stored['rt-settings-v1'])};
    }
    if(message.action==='archive-parents')return archiveParents(message,sender);
    if(message.action==='archive-recover')return archiveRecover(message,sender);
    if(message.action==='archive-comments')return archiveComments(message,sender);
    const kind=message.kind || 'post';
    if(!['post','comment'].includes(kind) || message.action==='archive-ids' && kind!=='post')return fail('Invalid content type.','invalid-request');
    if(!['archive-profile','archive-ids'].includes(message.action))return fail('Unknown archive action.','invalid-request');
    const ids=message.action==='archive-ids'?message.ids:null;
    if(message.action==='archive-ids' && (!Array.isArray(ids)||ids.length!==1||!ids.every(Model.validateId)))return fail('Invalid post IDs.','invalid-request');
    const normalizedIds=ids?ids.map(id=>id.toLowerCase().replace(/^t3_/,'')):null;
    if(!ids && !Model.validateUsername(message.username))return fail('Invalid username.','invalid-request');
    const username=ids?'':message.username.toLowerCase(),before=message.before;
    if(before!=null && (typeof before!=='number'||!Number.isSafeInteger(before)||before<=0||before>32503680000))return fail('Invalid archive cursor.','invalid-request');
    if(!authorized(sender,username,normalizedIds))return fail('Archive requests require the matching Reddit profile.','forbidden');
    if(!await enabled())return disabled();
    const profileKey=ids?'ids:'+normalizedIds.join(','):kind+':'+username,key=profileKey+':'+(before??'initial'),now=Date.now();
    for(const [key,value] of cache)if(value.expires<=now)cache.delete(key);
    if(cache.has(key))return cache.get(key).value;
    if(pending.has(key))return pending.get(key);
    if(pending.size>=50)return fail('Too many archive requests.','busy');
    const previous=profiles.get(profileKey)||Promise.resolve(),operation=previous.catch(()=>{}).then(()=>request(username,before,normalizedIds,kind,{force:message.force===true && !ids}));
    pending.set(key,operation);profiles.set(profileKey,operation);
    try{const value=await operation;if(!await enabled())return disabled();if(value.ok){if(cache.size>=50)cache.delete(cache.keys().next().value);cache.set(key,{value,expires:Date.now()+ttl});}return value;}
    finally{pending.delete(key);if(profiles.get(profileKey)===operation)profiles.delete(profileKey);}
  }
  // Only normalized public preferences cross the worker boundary. Chat storage stays trusted-only.
  chrome.storage.onChanged?.addListener((changes,area)=>{
    if(area!=='local' || !changes['rt-settings-v1'])return;
    cache.clear();titles.clear();commentContexts.clear();
    for(const id of subscribers){
      Promise.resolve(chrome.tabs?.sendMessage(id,{scope:'rt-posts',action:'settings-changed',settings:Model.normalizeSettings(changes['rt-settings-v1'].newValue)},{frameId:0})).catch(()=>subscribers.delete(id));
    }
  });
  chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
    if(message?.scope!=='rt-posts')return;
    sender={...sender,page:typeof message.pageUrl==='string' && message.pageUrl.length<4096?message.pageUrl:undefined};
    handle(message,sender).then(async value=>{if(message.action!=='get-settings' && value?.ok && !await enabled(['archive-recover','archive-comments'].includes(message.action)))value=disabled();if(message.action==='archive-recover' && value?.ok && !authorized(sender,message.username,null))value=fail('Archive recovery requires the matching Reddit profile.','forbidden');rememberCommentContexts(message,sender,value);sendResponse(value);},()=>sendResponse(fail('Archive request failed.'))).catch(()=>sendResponse(fail('Archive request failed.')));return true;
  });
})();
