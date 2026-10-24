/* Opt-in, credential-free public archive requests. No archive data is persisted. */
(() => {
  'use strict';
  if(!globalThis.RTPostModel)importScripts('post-model.js');
  const Model=globalThis.RTPostModel,limit=25,ttl=30000,timeoutMs=12000;
  const pending=new Map(),cache=new Map(),profiles=new Map(),subscribers=new Set();
  let active=0,cooldownUntil=0;const waiters=[];
  function fail(message,code='archive-error',extra={}){return {ok:false,error:message,code,incomplete:true,...extra};}
  async function enabled(){
    const stored=await chrome.storage.local.get('rt-settings-v1'),settings=Model.normalizeSettings(stored['rt-settings-v1']);
    const allowed=settings.postDiscovery && settings.archiveDiscovery;if(!allowed)cache.clear();return allowed;
  }
  const disabled=()=>fail('Enable archive discovery in Reddit Tweaks settings.','disabled');
  function authorized(sender,username,ids){
    if(sender?.id!==chrome.runtime.id || sender.frameId!=null && sender.frameId!==0)return false;
    try{const url=new URL(sender.url);if(url.protocol!=='https:' || !['reddit.com','www.reddit.com','old.reddit.com','new.reddit.com','sh.reddit.com'].includes(url.hostname) || url.port)return false;
      if(sender.origin && sender.origin!==url.origin)return false;
      if(sender.tab?.url){const tabUrl=new URL(sender.tab.url);if(tabUrl.origin!==url.origin || tabUrl.pathname!==url.pathname)return false;}
      if(ids){const detail=url.pathname.match(/^\/(?:(?:r|user)\/[^/]+\/)?comments\/([a-z0-9]+)(?:\/.*)?$/i);return Boolean(detail && ids.length===1 && detail[1].toLowerCase()===ids[0]);}
      const match=url.pathname.match(/^\/user\/([A-Za-z0-9_-]{1,20})(?:\/(?:submitted|comments))?\/?$/i);
      return Boolean(match && match[1].toLowerCase()===username.toLowerCase());
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
  async function request(username,before,ids,kind='post'){
    const release=await slot();
    try{
      if(!await enabled())return disabled();
      if(cooldownUntil>Date.now())return fail('Archive requests are cooling down.','rate-limited',{retryAt:cooldownUntil});
      const url=new URL('https://arctic-shift.photon-reddit.com/api/'+(kind==='comment'?'comments':'posts')+'/'+(ids?'ids':'search'));
      if(ids)url.searchParams.set('ids',ids.join(','));else{url.searchParams.set('author',username);url.searchParams.set('sort','desc');url.searchParams.set('limit',String(limit));if(before!=null)url.searchParams.set('before',String(before));}
      url.searchParams.set('md2html','false');url.searchParams.set('fields',kind==='comment'?'id,author,subreddit,body,created_utc,link_id,parent_id,score':'id,author,subreddit,title,selftext,created_utc,url,over_18,spoiler,score,num_comments');
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
  async function handle(message,sender){
    if(message?.scope!=='rt-posts')return;
    if(message.action==='get-settings'){
      let u;try{u=new URL(sender?.url);}catch{}
      if(sender?.id!==chrome.runtime.id || sender.frameId!==0 || u?.protocol!=='https:' || !['reddit.com','www.reddit.com','new.reddit.com','sh.reddit.com'].includes(u?.hostname) || u.port || sender.origin && sender.origin!==u.origin)return fail('Settings require a Reddit page.','forbidden');
      if(Number.isInteger(sender.tab?.id)){if(subscribers.size>=30)subscribers.delete(subscribers.values().next().value);subscribers.add(sender.tab.id);}
      const stored=await chrome.storage.local.get('rt-settings-v1');return {ok:true,settings:Model.normalizeSettings(stored['rt-settings-v1'])};
    }
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
    cache.clear();
    for(const id of subscribers){
      Promise.resolve(chrome.tabs?.sendMessage(id,{scope:'rt-posts',action:'settings-changed',settings:Model.normalizeSettings(changes['rt-settings-v1'].newValue)},{frameId:0})).catch(()=>subscribers.delete(id));
    }
  });
  chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
    if(message?.scope!=='rt-posts')return;
    handle(message,sender).then(async value=>sendResponse(message.action!=='get-settings' && value?.ok && !await enabled()?disabled():value),()=>sendResponse(fail('Archive request failed.'))).catch(()=>sendResponse(fail('Archive request failed.')));return true;
  });
})();
