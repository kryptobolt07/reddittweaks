/* Opt-in, credential-free public archive requests. No archive data is persisted. */
(() => {
  'use strict';
  if(!globalThis.RTPostModel)importScripts('post-model.js');
  const Model=globalThis.RTPostModel,limit=25,ttl=30000,timeoutMs=12000;
  const pending=new Map(),cache=new Map(),profiles=new Map(),commentContexts=new Map(),subscribers=new Set();
  let active=0,cooldownUntil=0;const waiters=[];
  function fail(message,code='archive-error',extra={}){return {ok:false,error:message,code,incomplete:true,...extra};}
  async function enabled(){
    const stored=await chrome.storage.local.get('rt-settings-v1'),settings=Model.normalizeSettings(stored['rt-settings-v1']);
    const allowed=settings.postDiscovery && settings.archiveDiscovery;if(!allowed){cache.clear();commentContexts.clear();}return allowed;
  }
  const disabled=()=>fail('Enable archive discovery in Reddit Tweaks settings.','disabled');
  function authorized(sender,username,ids){
    if(sender?.id!==chrome.runtime.id || sender.frameId!=null && sender.frameId!==0)return false;
    try{const url=new URL(sender.url);if(url.protocol!=='https:' || !['reddit.com','www.reddit.com','old.reddit.com','new.reddit.com','sh.reddit.com'].includes(url.hostname) || url.port)return false;
      if(sender.origin && sender.origin!==url.origin)return false;
      const tabUrl=sender.tab?.url?new URL(sender.tab.url):url;if(tabUrl.origin!==url.origin)return false;
      if(ids){if(tabUrl.pathname!==url.pathname)return false;const detail=url.pathname.match(/^\/(?:(?:r|user)\/[^/]+\/)?comments\/([a-z0-9]+)(?:\/.*)?$/i);return Boolean(detail && ids.length===1 && detail[1].toLowerCase()===ids[0]);}
      // sender.url may remain the content script's document-start URL after SPA
      // navigation. Both URLs must still be supported tabs of this same profile.
      const profile=path=>path.match(/^\/user\/([A-Za-z0-9_-]{1,20})(?:\/(?:submitted|comments))?\/?$/i);
      return [url,tabUrl].every(current=>profile(current.pathname)?.[1].toLowerCase()===username.toLowerCase());
    }catch{return false;}
  }
  async function slot(){if(active>=2)await new Promise(resolve=>waiters.push(resolve));else active++;return ()=>{const next=waiters.shift();if(next)next();else active--;};}
  function cooldown(response){
    const now=Date.now(),retry=response.headers?.get('Retry-After'),reset=response.headers?.get('X-RateLimit-Reset');
    let until=0;
    if(retry){const seconds=Number(retry);until=Number.isFinite(seconds)?now+Math.max(0,seconds)*1000:Date.parse(retry)||0;}
    if(reset){const number=Number(reset);if(Number.isFinite(number))until=Math.max(until,number>1e9?number*1000:now+Math.max(0,number)*1000);}
    if(response.status===429 && until<=now)until=now+60000;
    if(response.status===429 || response.headers?.get('X-RateLimit-Remaining')==='0')cooldownUntil=Math.max(cooldownUntil,until);
  }
  async function request(username,before,ids,kind='post',{contextOnly=false}={}){
    const release=await slot();
    try{
      if(!await enabled())return disabled();
      if(cooldownUntil>Date.now())return fail('Archive requests are cooling down.','rate-limited',{retryAt:cooldownUntil});
      const url=new URL('https://arctic-shift.photon-reddit.com/api/'+(kind==='comment'?'comments':'posts')+'/'+(ids?'ids':'search'));
      if(ids)url.searchParams.set('ids',ids.join(','));else{url.searchParams.set('author',username);url.searchParams.set('sort','desc');url.searchParams.set('limit',String(limit));if(before!=null)url.searchParams.set('before',String(before));}
      url.searchParams.set('md2html','false');url.searchParams.set('fields',contextOnly?'id,author,link_id,created_utc':kind==='comment'?'id,author,subreddit,body,created_utc,link_id,parent_id,score':'id,author,subreddit,title,selftext,created_utc,url,over_18,spoiler,score,num_comments');
      const controller=new AbortController();let timer;
      try{
        const timedOut=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Archive request timed out.'));},timeoutMs);});
        const operation=(async()=>{
          const response=await fetch(url.href,{credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',signal:controller.signal});cooldown(response);
          if(!response.ok)return fail(response.status===429?'Archive rate limit reached.':'Archive service could not load posts.',response.status===429?'rate-limited':'http-error',{retryAt:cooldownUntil||undefined});
          // Both transport text and accepted record count are bounded before normalization.
          let text='';
          if(Number(response.headers?.get('Content-Length'))>3000000)return fail('Archive response is too large.','invalid-response');
          if(response.body?.getReader && typeof TextDecoder!=='undefined'){
            const reader=response.body.getReader(),decoder=new TextDecoder();let bytes=0;
            try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>3000000){controller.abort();await reader.cancel();return fail('Archive response is too large.','invalid-response');}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}
          }else text=await response.text();
          if(text.length>3000000)return fail('Archive response is too large.','invalid-response');
          let json;try{json=JSON.parse(text);}catch{return fail('Invalid archive response.','invalid-response');}
          if(!Array.isArray(json?.data) || json.data.length>100)return fail('Invalid archive response.','invalid-response');
          const raw=json.data.slice(0,limit),posts=raw.map(item=>(kind==='comment'?Model.normalizeComment:Model.normalizePost)(item,{source:'arctic-shift'})).filter(post=>post && (ids?ids.includes(post.id):post.author.toLowerCase()===username && (before==null || post.created<before)));
          const oldest=posts.length?Math.min(...posts.map(post=>post.created)):null,hasMore=!ids && json.data.length>=limit;
          // before is exclusive. Overlap the oldest second so same-second records are never silently skipped.
          // A stalled overlap must be shown to the user; this API cannot prove exhaustion within that second.
          const cursor=hasMore && oldest!=null?oldest+1:null,stalled=hasMore && (cursor==null || before!=null && cursor>=before);
          return {ok:true,posts,before:cursor,hasMore,source:'arctic-shift',incomplete:true,cursorStalled:stalled,
            paginationWarning:hasMore?'Timestamp pagination overlaps its oldest second; archive coverage is incomplete.':'',cursorMode:'exclusive-overlap-second'};
        })();
        return await Promise.race([operation,timedOut]);
      }catch(error){return fail(controller.signal.aborted?'Archive request timed out.':'Archive service is unavailable.',controller.signal.aborted?'timeout':'network-error');}
      finally{clearTimeout(timer);}
    }finally{release();}
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
  async function handle(message,sender){
    if(message?.scope!=='rt-posts')return;
    if(message.action==='get-settings'){
      let u;try{u=new URL(sender?.url);}catch{}
      if(sender?.id!==chrome.runtime.id || sender.frameId!==0 || u?.protocol!=='https:' || !['reddit.com','www.reddit.com','new.reddit.com','sh.reddit.com'].includes(u?.hostname) || u.port || sender.origin && sender.origin!==u.origin)return fail('Settings require a Reddit page.','forbidden');
      if(Number.isInteger(sender.tab?.id)){if(subscribers.size>=30)subscribers.delete(subscribers.values().next().value);subscribers.add(sender.tab.id);}
      const stored=await chrome.storage.local.get('rt-settings-v1');return {ok:true,settings:Model.normalizeSettings(stored['rt-settings-v1'])};
    }
    if(message.action==='archive-parents')return archiveParents(message,sender);
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
    const previous=profiles.get(profileKey)||Promise.resolve(),operation=previous.catch(()=>{}).then(()=>request(username,before,normalizedIds,kind));
    pending.set(key,operation);profiles.set(profileKey,operation);
    try{const value=await operation;if(!await enabled())return disabled();if(value.ok){if(cache.size>=50)cache.delete(cache.keys().next().value);cache.set(key,{value,expires:Date.now()+ttl});}return value;}
    finally{pending.delete(key);if(profiles.get(profileKey)===operation)profiles.delete(profileKey);}
  }
  // Only the two public preferences cross the worker boundary. Chat storage stays trusted-only.
  chrome.storage.onChanged?.addListener((changes,area)=>{
    if(area!=='local' || !changes['rt-settings-v1'])return;
    cache.clear();commentContexts.clear();
    for(const id of subscribers){
      Promise.resolve(chrome.tabs?.sendMessage(id,{scope:'rt-posts',action:'settings-changed',settings:Model.normalizeSettings(changes['rt-settings-v1'].newValue)},{frameId:0})).catch(()=>subscribers.delete(id));
    }
  });
  chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
    if(message?.scope!=='rt-posts')return;
    handle(message,sender).then(async value=>{if(message.action!=='get-settings' && value?.ok && !await enabled())value=disabled();rememberCommentContexts(message,sender,value);sendResponse(value);},()=>sendResponse(fail('Archive request failed.'))).catch(()=>sendResponse(fail('Archive request failed.')));return true;
  });
})();
