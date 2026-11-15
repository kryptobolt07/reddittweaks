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
    if(probe || unavailableUntil<=Date.now()){unavailableCount++;unavailableUntil=Date.now()+Math.min(60000*2**(unavailableCount-1),600000);persistBackoff();}
    return unavailable();
  }
  function markAvailable(){const dirty=unavailableUntil||unavailableCount;unavailableUntil=0;unavailableCount=0;unavailableMaintenance=false;if(dirty)persistBackoff();}
  // Backoff state survives service-worker restarts through chrome.storage.session (memory-only, cleared with the browser session).
  const backoffKey='rt-archive-backoff-v1',maxCooldown=3600000;
  let backoffLoaded=null;
  function persistBackoff(){
    try{Promise.resolve(chrome.storage?.session?.set?.({[backoffKey]:{cooldownUntil,unavailableUntil,unavailableCount,unavailableMaintenance}})).catch(()=>{});}catch{}
  }
  // Read once at worker start; each request re-reads so another worker instance's newer state is honored.
  async function loadBackoff(){
    try{
      const stored=await chrome.storage?.session?.get?.(backoffKey),saved=stored?.[backoffKey],now=Date.now();
      if(!saved || typeof saved!=='object')return;
      const bounded=value=>Number.isFinite(value)?Math.min(Math.max(0,value),now+maxCooldown):0;
      cooldownUntil=Math.max(cooldownUntil,bounded(saved.cooldownUntil));
      if(bounded(saved.unavailableUntil)>unavailableUntil){unavailableUntil=bounded(saved.unavailableUntil);unavailableMaintenance=saved.unavailableMaintenance===true;}
      if(Number.isInteger(saved.unavailableCount))unavailableCount=Math.max(unavailableCount,Math.min(Math.max(0,saved.unavailableCount),20));
    }catch{}
  }
  backoffLoaded=loadBackoff();
  function fail(message,code='archive-error',extra={}){return {ok:false,error:message,code,incomplete:true,...extra};}
  async function enabled(requireRestoration=false,monitor=false){
    const stored=await chrome.storage.local.get('rt-settings-v1'),settings=Model.normalizeSettings(stored['rt-settings-v1']);
    const allowed=(monitor?settings.ownRemoval:settings.postDiscovery) && settings.archiveDiscovery;if(!allowed){cache.clear();titles.clear();commentContexts.clear();}return allowed && (!requireRestoration || settings.restoreDeletedContent);
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
      const profile=current.pathname.match(/^\/user\/([A-Za-z0-9_-]{1,20})(?:\/(?:submitted|comments|search))?\/?$/i);
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
    until=Math.min(until,now+maxCooldown);
    if(response.status===429 || response.headers?.get('X-RateLimit-Remaining')==='0'){const before=cooldownUntil;cooldownUntil=Math.max(cooldownUntil,until);if(cooldownUntil!==before)persistBackoff();}
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
  async function request(username,before,ids,kind='post',{contextOnly=false,recoverSender=null,titles=true,force=false,monitor=false}={}){
    const release=await slot();let released=false;const freeSlot=()=>{if(!released){released=true;release();}};
    try{
      if(!await enabled(Boolean(recoverSender),monitor))return disabled();
      await backoffLoaded;await loadBackoff();
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
      // The transport slot is not held while parent titles are looked up.
      freeSlot();
      if(value.ok && kind==='comment' && !contextOnly && titles)await fillCommentTitles(value.posts);
      return value;
    }finally{freeSlot();}
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
  // Browsing a banned/private community's archived thread. Only the current
  // post is allowed; every returned comment is checked against that identity.
  async function archiveThreadComments(message,sender){
    if(!Model.validateId(message.postId) || message.before!=null && !validTime(message.before) || message.focusId!=null && !Model.validateCommentId(message.focusId))return fail('Invalid thread page.','invalid-request');
    const id=message.postId.toLowerCase().replace(/^t3_/,''),focus=message.focusId?.toLowerCase().replace(/^t1_/,'');
    if(!redditSender(sender) || !authorized(sender,'',[id]))return fail('Open the matching Reddit post.','forbidden');
    const key=['thread-page',id,message.before || '',focus || ''].join(':');
    return cachedSearch(key,()=>archiveFetch('comments/search',{link_id:id,before:message.before,sort:'desc',limit,md2html:'true'},data=>{
      const posts=data.map(raw=>Model.normalizeComment(raw,{source:'arctic-shift'})).filter(post=>post?.linkId===id && (message.before==null || post.created<message.before));
      const hasMore=data.length>=limit,times=posts.map(post=>post.created),cursor=hasMore && times.length?Math.min(...times)+1:null;
      return {ok:true,posts,hasMore,cursor,cursorStalled:hasMore && (cursor==null || message.before!=null && cursor>=message.before),incomplete:true,source:'arctic-shift'};
    })).then(async value=>{
      if(value?.ok && focus && !value.posts.some(post=>post.id===focus)){
        const extra=await request('',null,[focus],'comment',{titles:false}).catch(()=>null);
        if(extra?.ok)value={...value,posts:[...value.posts,...extra.posts.filter(post=>post.linkId===id)]};
      }
      return value;
    });
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
  // Removal evidence for your own items (docs/own-removal-detection-spec.md §4.1 E3): the archive's first capture
  // (body or [removed], retrieved_on). Needs only "Use the archive"; restoring deleted text is a separate setting.
  async function archiveRemoval(message,sender){
    const kind=message.kind,validId=kind==='comment'?Model.validateCommentId:Model.validateId;
    if(!['post','comment'].includes(kind) || !Model.validateUsername(message.username) || !Array.isArray(message.ids) || !message.ids.length || message.ids.length>25 || !message.ids.every(validId))return fail('Invalid removal-check IDs.','invalid-request');
    const username=message.username.toLowerCase(),ids=[...new Set(message.ids.map(id=>id.toLowerCase().replace(kind==='comment'?/^t1_/:/^t3_/,'')))].sort();
    if(message.monitor===true){const me=await globalThis.RTRemovalBroker?.verify(sender,username);if(!me || me.owner!==message.owner)return fail('The signed-in account changed.','forbidden');}
    else if(!authorized(sender,username,null))return fail('Removal checks require your own Reddit profile.','forbidden');
    if(!await enabled(false,message.monitor===true))return disabled();
    const key='removal:'+username+':'+kind+':'+ids.join(','),saved=cache.get(key);
    if(saved?.expires>Date.now())return saved.value;
    if(pending.has(key))return pending.get(key);
    if(pending.size>=50)return fail('Too many archive requests.','busy');
    const operation=request(username,null,ids,kind,{titles:false,monitor:message.monitor===true}).then(value=>{
      if(value.ok){value={...value,posts:value.posts.filter(post=>post.author.toLowerCase()===username)};if(cache.size>=50)cache.delete(cache.keys().next().value);cache.set(key,{value,expires:Date.now()+ttl});}return value;
    });
    pending.set(key,operation);try{return await operation;}finally{pending.delete(key);}
  }
  // --- Archive search layer: text search, aggregates, subreddit metadata. Same slot, cooldown, backoff, timeout and size bound as request().
  // A second source (e.g. a PullPush adapter) would plug in here by returning the same shapes; none is configured.
  const searchSubreddit=/^[A-Za-z0-9_]{2,21}$/,searchTtl=30000;
  const validTime=value=>typeof value==='number' && Number.isSafeInteger(value) && value>0 && value<=32503680000;
  async function archiveFetch(path,params,onJson){
    const release=await slot();
    try{
      if(!await enabled())return disabled();
      await backoffLoaded;await loadBackoff();
      if(cooldownUntil>Date.now())return fail('Archive requests are cooling down.','rate-limited',{retryAt:cooldownUntil});
      if(unavailableUntil>Date.now())return unavailable();
      const url=new URL('https://arctic-shift.photon-reddit.com/api/'+path);for(const [key,value] of Object.entries(params))if(value!=null && value!=='')url.searchParams.set(key,String(value));
      const controller=new AbortController();let timer;
      try{
        const timedOut=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Archive request timed out.'));},timeoutMs);});
        const operation=(async()=>{
          const response=await fetch(url.href,{...archiveInit,signal:controller.signal});cooldown(response);
          if([502,503,504].includes(response.status))return markUnavailable(response,controller);
          const text=await readBounded(response,controller);if(text==null)return fail('Archive response is too large.','invalid-response');
          let json;try{json=JSON.parse(text);}catch{json=null;}
          // Arctic Shift reports a slow query as HTTP 422 {"data":null,"error":"Timeout. Maybe slow down a bit"}.
          if(!response.ok && /time(?:d)?[ -]?out/i.test(String(json?.error || '')))return fail('The archive query timed out.','timeout');
          if(!response.ok)return fail(response.status===429?'Archive rate limit reached.':'Archive service could not load results.',response.status===429?'rate-limited':'http-error',{retryAt:cooldownUntil||undefined});
          markAvailable();
          if(!Array.isArray(json?.data) || json.data.length>1000)return fail('Invalid archive response.','invalid-response');
          return onJson(json.data);
        })();
        return await Promise.race([operation,timedOut]);
      }catch(error){return fail(controller.signal.aborted?'Archive request timed out.':'Archive service is unavailable.',controller.signal.aborted?'timeout':'network-error');}
      finally{clearTimeout(timer);}
    }finally{release();}
  }
  // Any page of the signed-in Reddit site may use these reads; scoped data (author/subreddit) is validated per message.
  function redditSender(sender){
    if(sender?.id!==chrome.runtime.id || sender.frameId!=null && sender.frameId!==0 || !Number.isInteger(sender.tab?.id))return false;
    try{const url=new URL(sender.url);return url.protocol==='https:' && !url.port && ['reddit.com','www.reddit.com'].includes(url.hostname) && (!sender.origin || sender.origin===url.origin);}catch{return false;}
  }
  // Validated scope shared by search and aggregate. Returns an error response or {kind,author,subreddit}.
  function searchScope(message){
    const kind=message.kind;if(!['post','comment'].includes(kind))return fail('Invalid content type.','invalid-request');
    const author=message.author,subreddit=message.subreddit;
    if(author!=null && !Model.validateUsername(author) || subreddit!=null && (typeof subreddit!=='string' || !searchSubreddit.test(subreddit)))return fail('Invalid archive scope.','invalid-request');
    if(author==null && subreddit==null)return fail('An author or subreddit is required.','invalid-request');
    for(const key of ['after','before'])if(message[key]!=null && !validTime(message[key]))return fail('Invalid archive cursor.','invalid-request');
    return {kind,author:author?.toLowerCase(),subreddit:subreddit?.toLowerCase()};
  }
  async function cachedSearch(key,run){
    const now=Date.now();for(const [id,value] of cache)if(value.expires<=now)cache.delete(id);
    if(cache.has(key))return cache.get(key).value;
    if(pending.has(key))return pending.get(key);
    if(pending.size>=50)return fail('Too many archive requests.','busy');
    const operation=run();pending.set(key,operation);
    try{const value=await operation;if(!await enabled())return disabled();if(value.ok){if(cache.size>=50)cache.delete(cache.keys().next().value);cache.set(key,{value,expires:Date.now()+searchTtl});}return value;}
    finally{pending.delete(key);}
  }
  async function archiveSearch(message,sender){
    if(!redditSender(sender))return fail('Archive search requires a Reddit page.','forbidden');
    const scope=searchScope(message);if(scope.ok===false)return scope;
    const sort=message.sort==null?'desc':message.sort,query=message.query;
    if(!['desc','asc'].includes(sort))return fail('Invalid sort.','invalid-request');
    const textKeys=scope.kind==='comment'?['body']:['title','selftext','link_flair_text','url'],boolKeys=scope.kind==='comment'?[]:['over_18','spoiler','url_exact'];
    const fieldKeys=['title','selftext','body','link_flair_text','url','over_18','spoiler','url_exact'],params={};
    // Explicit parameter whitelist; never spread a caller's request into a URL.
    for(const key of ['query',...fieldKeys]){
      if(message[key]==null)continue;
      if(key==='query' || textKeys.includes(key)){
        if(typeof message[key]!=='string' || message[key].length>256 || /[\u0000-\u001f\u007f]/.test(message[key]))return fail('Invalid search text.','invalid-request');
        if(key!=='query' && message[key].trim())params[key]=message[key].trim();
      }else if(boolKeys.includes(key)){
        if(typeof message[key]!=='boolean')return fail('Invalid search flag.','invalid-request');params[key]=message[key];
      }else return fail(key+" isn't available for "+(scope.kind==='comment'?'comments.':'posts.'),'invalid-request');
    }
    if(scope.kind==='comment' && query?.trim() && params.body)return fail('Use query or body, not both.','invalid-request');
    const text=query?.trim() || '',{kind,author,subreddit}=scope,after=message.after,before=message.before;
    const key=JSON.stringify(['search',kind,author||'',subreddit||'',text,after??'',before??'',sort,Object.entries(params).sort(([a],[b])=>a.localeCompare(b))]);
    const textFiltered=Boolean(text || [...textKeys].some(key=>params[key]));
    return cachedSearch(key,()=>archiveFetch(kind==='comment'?'comments/search':'posts/search',{author,subreddit,...params,...(text?{[kind==='comment'?'body':'query']:text}:{}),after,before,sort,limit,md2html:'true'},data=>{
      const normalize=kind==='comment'?Model.normalizeComment:Model.normalizePost;
      const posts=data.slice(0,limit).map(item=>normalize(item,{source:'arctic-shift'})).filter(post=>post && (!author || post.author.toLowerCase()===author) && (!subreddit || post.subreddit.toLowerCase()===subreddit)
        && (before==null || post.created<before) && (after==null || post.created>after));
      const hasMore=data.length>=limit,times=posts.map(post=>post.created);
      // Bounds are exclusive. Overlap the boundary second so same-second records are never skipped; a stall is surfaced, never called complete.
      const edge=times.length?(sort==='asc'?Math.max(...times)-1:Math.min(...times)+1):null,bound=sort==='asc'?after:before;
      const cursor=hasMore && edge!=null && edge>0?edge:null,stalled=hasMore && (cursor==null || bound!=null && (sort==='asc'?cursor<=bound:cursor>=bound));
      return {ok:true,posts,cursor,hasMore,sort,serverFiltered:Boolean(text || Object.keys(params).length),source:'arctic-shift',incomplete:true,cursorStalled:stalled,cursorMode:'exclusive-overlap-second'};
    }).then(value=>value.ok===false && textFiltered && ['timeout','text-search-unavailable'].includes(value.code)?fail('Text search is unavailable for this scope.','text-search-unavailable'):value)).then(async value=>{
      // Opt-in, best effort: thread titles for comment search rows.
      if(value?.ok && kind==='comment' && message.titles===true)try{await fillCommentTitles(value.posts);}catch{}
      return value;});
  }
  async function archiveAggregate(message,sender){
    if(!redditSender(sender))return fail('Archive aggregates require a Reddit page.','forbidden');
    const scope=searchScope(message);if(scope.ok===false)return scope;
    if(!['subreddit','month'].includes(message.by))return fail('Invalid aggregate.','invalid-request');
    const {kind,author,subreddit}=scope,month=message.by==='month',before=message.before,after=message.after ?? (month && before==null?1104537600:undefined);
    const key=['aggregate',kind,author||'',subreddit||'',message.by,after??'',before??''].join('\u0001');
    return cachedSearch(key,()=>archiveFetch((kind==='comment'?'comments':'posts')+'/search/aggregate',{author,subreddit,aggregate:month?'created_utc':'subreddit',frequency:month?'month':undefined,after,before,limit:month?undefined:100},data=>{
      // Observed: counts are strings; created_utc keys are ISO instants at the server's local month start (e.g. 2022-12-31T23:00:00.000Z for 2023-01), so half a day is added before reading YYYY-MM.
      const buckets=[];
      for(const item of data){
        const count=Number(item?.count);if(!Number.isFinite(count) || count<=0)continue;
        let bucketKey;
        if(month){const time=Date.parse(item.created_utc);if(!Number.isFinite(time))continue;bucketKey=new Date(time+43200000).toISOString().slice(0,7);}
        else{bucketKey=typeof item.key==='string'?item.key.slice(0,100):'';if(!bucketKey)continue;}
        buckets.push({key:bucketKey,count:Math.floor(count)});
      }
      buckets.sort(month?(a,b)=>a.key<b.key?-1:1:(a,b)=>b.count-a.count);
      return {ok:true,buckets,by:message.by,source:'arctic-shift'};
    }));
  }
  // Subreddit metadata: https icon only on a Reddit-owned host. An absent record (never archived) is not-found.
  const iconHosts=/(?:^|\.)(?:redd\.it|redditmedia\.com|reddituploads\.com|reddit\.com|redditstatic\.com)$/i;
  function iconUrl(value){
    if(typeof value!=='string' || value.length>4096)return '';
    try{const url=new URL(value.replace(/&amp;/gi,'&'));return url.protocol==='https:' && !url.username && !url.password && !url.port && iconHosts.test(url.hostname)?url.href:'';}catch{return '';}
  }
  async function archiveSubreddit(message,sender){
    if(!redditSender(sender))return fail('Subreddit details require a Reddit page.','forbidden');
    if(typeof message.name!=='string' || !searchSubreddit.test(message.name))return fail('Invalid subreddit name.','invalid-request');
    const name=message.name.toLowerCase();
    return cachedSearch('subreddit\u0001'+name,()=>archiveFetch('subreddits/search',{subreddit:name},data=>{
      const raw=data.find(item=>String(item?.display_name || '').toLowerCase()===name);
      if(!raw)return fail('This subreddit is not in the archive.','not-found');
      const text=(value,max)=>typeof value==='string'?value.slice(0,max).replace(/\u0000/g,''):'',number=value=>Number.isFinite(Number(value)) && Number(value)>=0?Math.floor(Number(value)):0;
      const subreddit={name:text(raw.display_name,21),title:text(raw.title,200),description:text(raw.public_description,500) || text(raw.description,2000),subscribers:number(raw.subscribers),created:number(raw.created_utc),over18:raw.over_18===true || raw.over18===true,icon:iconUrl(raw.community_icon) || iconUrl(raw.icon_img)};
      if(!subreddit.icon)delete subreddit.icon;
      return {ok:true,subreddit,source:'arctic-shift'};
    }));
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
    if(message.action==='archive-removal')return archiveRemoval(message,sender);
    if(message.action==='archive-comments')return archiveComments(message,sender);
    if(message.action==='archive-thread-comments')return archiveThreadComments(message,sender);
    if(message.action==='archive-search')return archiveSearch(message,sender);
    if(message.action==='archive-aggregate')return archiveAggregate(message,sender);
    if(message.action==='archive-subreddit')return archiveSubreddit(message,sender);
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
    handle(message,sender).then(async value=>{const monitor=message.action==='archive-removal' && message.monitor===true;if(message.action!=='get-settings' && value?.ok && !await enabled(['archive-recover','archive-comments'].includes(message.action),monitor))value=disabled();if(monitor && value?.ok){const me=await globalThis.RTRemovalBroker?.verify(sender,message.username);if(!me || me.owner!==message.owner)value=fail('The signed-in account changed.','forbidden');}if(message.action==='archive-recover' && value?.ok && !authorized(sender,message.username,null))value=fail('Archive recovery requires the matching Reddit profile.','forbidden');rememberCommentContexts(message,sender,value);sendResponse(value);},()=>sendResponse(fail('Archive request failed.'))).catch(()=>sendResponse(fail('Archive request failed.')));return true;
  });
})();
