/* Public Reddit reads only. Authentication stays in Reddit's page world. */
(() => {
  'use strict';
  if(window.top!==window || !globalThis.RTPostModel)return;
  // Bound simultaneous work and honor server cooldowns; cursor-driven scrolling
  // must not stall behind an unrelated lifetime or rolling card-count quota.
  const M=RTPostModel,jobs=new Map(),rendererWaits=new WeakMap(),navigationReads=new Map(),controlReads=new Map(),statusReads=new Map(),nativeCardReads=new Map();let active=0,cardActive=0,postCardActive=0,cooldown=0;
  function route(){
    const profile=location.pathname.match(/^\/user\/([\w-]{1,20})(?:\/(?:submitted|comments))?\/?$/i);
    const post=location.pathname.match(/^\/(?:r\/[^/]+\/|user\/[^/]+\/)?comments\/([a-z0-9]{1,10})(?:\/.*)?$/i);
    return profile?{username:profile[1]}:post?{id:post[1].toLowerCase()}:null;
  }
  // Reddit's feed virtualizer assumes its placeholders form one block at the top
  // of the feed, in stack order. Discovery inserts and reorders cards, which
  // breaks that: entries end up out of order, duplicated or detached, Reddit
  // stops restoring at the first one out of range and readers see blank space
  // (mostly when scrolling up). While discovery owns a profile feed, drive the
  // same controller from the document instead: restore any placeholder near the
  // viewport, wherever its stack entry is, and only virtualize cards far above.
  // Entries keep Reddit's {node,placeholder,height} shape so its state survives.
  let syncFrame=null,observedFeed=null;const managed=new WeakSet(),nativeMethods=new WeakMap();
  const feedObserver=typeof MutationObserver==='function'?new MutationObserver(()=>scheduleFeedSync()):null;
  function ownedFeed(feed){return Boolean(feed?.isConnected && feed.hasAttribute('data-rt-loading-owner') && route()?.username && document.documentElement.hasAttribute('data-rt-profile-discovery'));}
  function currentFeed(){return document.querySelector('main shreddit-feed[data-rt-loading-owner]') || (observedFeed?.isConnected?observedFeed:null);}
  function manageFeed(feed){
    const controller=feed?.virtualization;
    if(!controller || !Array.isArray(controller.topStack) || typeof controller._virtualizeTop!=='function')return null;
    if(!nativeMethods.has(controller)){
      const native=controller._virtualizeTop;nativeMethods.set(controller,native);
      controller._virtualizeTop=function(distance){
        if(ownedFeed(this.host)){scheduleFeedSync();return;}
        // Discovery released the feed: restore everything we hold so Reddit
        // restarts from a consistent, empty stack.
        if(managed.has(this)){managed.delete(this);releaseFeed(this);}
        return native.call(this,distance);
      };
    }
    managed.add(controller);
    if(observedFeed!==feed && feedObserver){feedObserver.disconnect();feedObserver.observe(feed,{childList:true});observedFeed=feed;}
    return controller;
  }
  function restoreEntry(feed,entry){
    const {node,placeholder}=entry;
    if(!placeholder?.isConnected)return false;
    if(node?.nodeType===1 && !node.isConnected && !node.contains(placeholder))placeholder.replaceWith(node);
    else placeholder.remove();
    return true;
  }
  function releaseFeed(controller){
    const stack=Array.isArray(controller.topStack)?controller.topStack:[];
    for(let pass=0;pass<4 && stack.length;pass++){const entries=stack.splice(0);for(const entry of entries.reverse())if(entry && !restoreEntry(controller.host,entry) && entry.node?.nodeType===1 && !entry.node.isConnected)stack.push(entry);if(stack.length===entries.length)break;}
    for(const placeholder of controller.host?.querySelectorAll?.(':scope > .virtualized-placeholder') || [])placeholder.remove();
    controller.topStack=[];controller.topPadding=0;
  }
  function viewportAnchor(feed){
    for(const child of feed.children){if(child.classList.contains('virtualized-placeholder'))continue;const rect=child.getBoundingClientRect();if(rect.height>0 && rect.bottom>0 && rect.top<window.innerHeight)return {child,top:rect.top};}
    return null;
  }
  function syncFeed(){
    const feed=currentFeed();
    if(!ownedFeed(feed)){
      const controller=feed?.virtualization;if(controller && managed.has(controller)){managed.delete(controller);releaseFeed(controller);}
      return;
    }
    const controller=manageFeed(feed);if(!controller)return;
    const height=Math.max(1,window.innerHeight || 0),restoreAbove=-1.5*height,restoreBelow=2.5*height,virtualizeAbove=-Math.max(3*height,height+1000);
    const anchor=viewportAnchor(feed);let changed=false;
    // Restore pass. A restored entry can itself be an older placeholder, so
    // repeat until nothing near the viewport is left (bounded).
    for(let pass=0;pass<8;pass++){
      const stack=controller.topStack,byPlaceholder=new Map();for(const entry of stack)if(entry?.placeholder)byPlaceholder.set(entry.placeholder,entry);
      const near=[];for(const placeholder of feed.querySelectorAll(':scope > .virtualized-placeholder')){const rect=placeholder.getBoundingClientRect();if(rect.bottom>restoreAbove && rect.top<restoreBelow)near.push(placeholder);}
      // Entries whose placeholder left the document can never be restored by
      // Reddit either (its replaceChild would throw); drop them.
      const stale=stack.filter(entry=>!entry?.placeholder?.isConnected);
      if(!near.length && !stale.length)break;
      const done=new Set(stale);
      for(const placeholder of near){const entry=byPlaceholder.get(placeholder);if(entry){restoreEntry(feed,entry);done.add(entry);}else placeholder.remove();changed=true;}
      if(done.size){const keep=stack.filter(entry=>!done.has(entry));stack.length=0;stack.push(...keep);}
    }
    // Virtualize pass: only cards far above the viewport, the same distance
    // Reddit uses. Our status/loader UI and empty elements stay mounted.
    const pending=[];
    for(const child of feed.children){
      if(child.classList.contains('virtualized-placeholder') || child.dataset.rtUi && child.dataset.rtUi!=='activity-item')continue;
      const rect=child.getBoundingClientRect();if(rect.height>0 && rect.top>=virtualizeAbove)break;
      if(rect.height>0 && rect.bottom<virtualizeAbove)pending.push([child,rect.height]);
    }
    for(const [node,size] of pending){const placeholder=document.createElement('div');placeholder.className='virtualized-placeholder';placeholder.style.height=size+'px';feed.replaceChild(placeholder,node);controller.topStack.push({node,placeholder,height:size});changed=true;}
    if(!changed)return;
    controller.topPadding=controller.topStack.reduce((sum,entry)=>sum+(entry.placeholder?.isConnected && Number.isFinite(entry.height)?entry.height:0),0);
    // Restored cards may differ from their saved heights; keep what the reader
    // is looking at in place.
    if(anchor?.child.isConnected){const delta=anchor.child.getBoundingClientRect().top-anchor.top;if(Math.abs(delta)>0.5)window.scrollBy({top:delta,behavior:'instant'});}
  }
  function scheduleFeedSync(){
    if(syncFrame!==null || typeof requestAnimationFrame!=='function')return;
    syncFrame=requestAnimationFrame(()=>{syncFrame=null;try{syncFeed();}catch{ /* Native virtualization remains if Reddit's contract changes. */ }});
  }
  document.addEventListener('scroll',scheduleFeedSync,{passive:true});
  window.addEventListener('resize',scheduleFeedSync,{passive:true});
  // Take over as soon as discovery marks a feed, before Reddit's next native
  // pass can virtualize around inserted cards.
  if(typeof MutationObserver==='function')new MutationObserver(scheduleFeedSync).observe(document.documentElement,{subtree:true,attributes:true,attributeFilter:['data-rt-loading-owner','data-rt-profile-discovery']});
  async function boundedText(response){
    if(Number(response.headers.get('content-length'))>2500000)throw Error('Reddit response is too large.');
    let text='';
    if(response.body?.getReader){const reader=response.body.getReader(),decoder=new TextDecoder();let bytes=0;try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>2500000){await reader.cancel();throw Error('Reddit response is too large.');}text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}}
    else text=await response.text();
    if(text.length>2500000)throw Error('Reddit response is too large.');
    return text;
  }
  function searchCursor(doc,username,type,sort,range){
    for(const part of doc.querySelectorAll('faceplate-partial[loading="lazy"][src]'))try{
      const url=new URL(part.getAttribute('src'),location.origin),cursor=url.searchParams.get('cursor');
      if(url.origin===location.origin && url.pathname==='/svc/shreddit/search/' && url.searchParams.get('q')===`author:"${username}"` && url.searchParams.get('type')===type && (url.searchParams.get('sort') || 'new')===sort && (sort!=='top' || (url.searchParams.get('t') || 'all')===range) && typeof cursor==='string' && cursor.length>0 && cursor.length<=4096 && !/[\u0000-\u001f]/.test(cursor))return cursor;
    }catch{ /* Only Reddit's matching, same-origin continuation is followed. */ }
    return null;
  }
  function postPageCursor(cursor,transport,username,sort,range){return cursor?'rt-post-search:'+JSON.stringify({cursor,transport,username:username.toLowerCase(),sort,range}):null;}
  function readPostCursor(value,username,sort,range){
    if(value==null)return null;
    try{if(typeof value!=='string' || value.length>8192 || !value.startsWith('rt-post-search:'))throw Error();
      const page=JSON.parse(value.slice(15));
      if(page.username!==username.toLowerCase() || page.sort!==sort || page.range!==range || !['shreddit','json'].includes(page.transport) || typeof page.cursor!=='string' || !page.cursor || page.cursor.length>4096 || /[\u0000-\u001f]/.test(page.cursor) || page.transport==='json' && !/^t3_[a-z0-9]{1,10}$/i.test(page.cursor))throw Error();
      return page;
    }catch{throw Error('Invalid Reddit page cursor. Refresh activity to start again.');}
  }
  function commentPageCursor(cursor,stream,username,sort,range){return cursor?'rt-comment-search:'+JSON.stringify({cursor,stream,username:username.toLowerCase(),sort,range}):null;}
  function readCommentCursor(value,stream,username,sort,range){
    if(value==null)return null;
    try{if(typeof value!=='string' || value.length>8192 || !value.startsWith('rt-comment-search:'))throw Error();const page=JSON.parse(value.slice(18));
      if(page.stream!==stream || page.username!==username.toLowerCase() || page.sort!==sort || page.range!==range || typeof page.cursor!=='string' || !page.cursor || page.cursor.length>4096 || /[\u0000-\u001f]/.test(page.cursor))throw Error();return page.cursor;
    }catch{throw Error('Invalid Reddit comment cursor. Refresh activity to start again.');}
  }
  function postListing(text,username,{sort='new',range='all'}={}){
    const doc=new DOMParser().parseFromString(text,'text/html'),posts=[],seen=new Set();
    // Crossposts have no search-sdui-post test ID. Their outer view tracker is
    // the result; embedded original-post trackers must not become extra hits.
    const cards=doc.querySelectorAll('search-telemetry-tracker[view-events="search/view/post"]');
    if(cards.length>100)throw Error('Reddit returned an unexpected post listing.');
    for(const tracker of cards){
      try{
        const context=JSON.parse(tracker.getAttribute('data-faceplate-tracking-context')),id=context.post?.id;
        const card=tracker.querySelector('[data-testid="search-crosspost-unit"],[data-testid="search-post-unit"]');
        const detail=[tracker,...tracker.querySelectorAll('search-telemetry-tracker')].map(node=>JSON.parse(node.getAttribute('data-faceplate-tracking-context') || '{}')).find(value=>value.post?.id===id && value.profile?.name);
        if(!M.validateId(id) || detail?.profile?.name?.toLowerCase()!==username.toLowerCase() || !card)throw Error();
        const title=card.querySelector('a[data-testid="post-title"]'),permalink=new URL(title?.getAttribute('href'),location.origin);
        if(permalink.origin!==location.origin || permalink.pathname.match(/\/comments\/([a-z0-9]{1,10})(?:\/|$)/i)?.[1]!==id.slice(3))throw Error();
        const crosspost=card.getAttribute('data-testid')==='search-crosspost-unit';
        const counter=card.querySelector(crosspost?':scope > [data-testid="search-counter-row"]':'[data-testid="search-counter-row"]'),numbers=[...counter.querySelectorAll('faceplate-number[number]')].map(node=>Number(node.getAttribute('number')));
        if(numbers.length<2 || !numbers.every(Number.isFinite))throw Error();
        const post=M.normalizePost({id,author:detail.profile.name,title:context.post.title,subreddit:context.subreddit?.name,
          created_utc:Date.parse(card.querySelector('faceplate-timeago[ts]')?.getAttribute('ts'))/1000,
          score:numbers[0],num_comments:numbers[1],permalink:permalink.href,status:'unknown',
          over_18:context.post.nsfw===true || context.subreddit?.nsfw===true || detail.post.nsfw===true,spoiler:context.post.spoiler===true || detail.post.spoiler===true});
        if(!post)throw Error();if(!seen.has(id)){seen.add(id);posts.push(post);}
      }catch{throw Error('Reddit’s post search format changed. Posts could not be read safely.');}
    }
    const cursor=searchCursor(doc,username,'posts',sort,range);
    if(!cards.length && !cursor){const empty=doc.querySelector('search-telemetry-tracker[view-events="search/view/no_results"]');let reason;try{reason=JSON.parse(empty?.getAttribute('data-faceplate-tracking-context')).action_info?.reason;}catch{}if(reason!=='empty')throw Error('Reddit returned an unrecognized post search response.');}
    return {posts,after:postPageCursor(cursor,'shreddit',username,sort,range),hasMore:Boolean(cursor),incomplete:true,source:'reddit'};
  }
  function commentListing(text,username,{sort='new',range='all',stream='authenticated'}={}){
    const doc=new DOMParser().parseFromString(text,'text/html'),posts=[],seen=new Set();
    const cards=doc.querySelectorAll('[data-testid="search-sdui-comment-unit"]');
    if(cards.length>100)throw Error('Reddit returned an unexpected comment listing.');
    for(const card of cards){
      try{
        const context=JSON.parse(card.closest('search-telemetry-tracker')?.getAttribute('data-faceplate-tracking-context') || '{}');
        const content=card.querySelector('[data-testid="search-comment-content"]');
        const author=[...card.querySelectorAll('a[href="#"],a[href^="/user/"]')].find(a=>!a.closest('[id$="-post-rtjson-content"]'))?.textContent?.trim();
        if(author?.toLowerCase()!==username.toLowerCase())continue;
        const parts=[...content.querySelectorAll('[id$="-post-rtjson-content"] p')].map(p=>p.textContent.trim());
        const body=parts.length?parts.join('\n\n'):content.querySelector('[id$="-post-rtjson-content"]')?.textContent?.trim();
        const post=M.normalizeComment({id:context.comment?.id,author,body,link_id:context.comment?.post_id || context.post?.id,
          ...(Object.hasOwn(context.comment || {},'parent_id')?{parent_id:context.comment.parent_id}:{}),link_title:context.post?.title,subreddit:context.subreddit?.name,over_18:context.post?.nsfw===true || context.subreddit?.nsfw===true,spoiler:context.post?.spoiler,
          created_utc:Date.parse(content.querySelector('faceplate-timeago')?.getAttribute('ts'))/1000,
          score:Number(content.querySelector('faceplate-number')?.getAttribute('number')) || 0,
          permalink:card.querySelector('a[aria-labelledby^="comment-content-"]')?.getAttribute('href')});
        if(post && !seen.has(post.fullname)){seen.add(post.fullname);posts.push(post);}
      }catch{ /* A malformed card cannot become an unsafe or misattributed result. */ }
    }
    if(cards.length && !posts.length)throw Error('Reddit’s comment format changed. Comments could not be read.');
    const cursor=searchCursor(doc,username,'comments',sort,range);
    if(!cards.length && !cursor){let reason;try{reason=JSON.parse(doc.querySelector('search-telemetry-tracker[view-events="search/view/no_results"]')?.getAttribute('data-faceplate-tracking-context')).action_info?.reason;}catch{}if(reason!=='empty')throw Error('Reddit returned an unrecognized comment search response.');}
    const after=commentPageCursor(cursor,stream,username,sort,range);
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
    const now=Date.now();if(now<cooldown || active>=2)return {deferred:true,retryAfterMs:Math.max(100,now<cooldown?cooldown-now:250)};
    const Renderer=customElements.get('faceplate-partial');if(typeof Renderer?.prototype?._renderContent!=='function')throw Error('Reddit’s native renderer is not ready.');
    const controller=new AbortController(),cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();let timer;active++;
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
  async function renderControls(input,signal){
    const context=route(),path=location.pathname+location.search,target=typeof input.target==='string' && /^rt-controls-[a-z0-9-]{1,60}$/i.test(input.target)?document.getElementById(input.target):null;
    if(location.protocol!=='https:' || !['reddit.com','www.reddit.com','new.reddit.com','sh.reddit.com'].includes(location.hostname) || !context?.username || !M.validateUsername(input.username) || context.username.toLowerCase()!==input.username.toLowerCase() || target?.dataset.rtUi!=='profile-controls' || !target.closest('main'))throw Error('Open the matching public profile.');
    if(typeof customElements.get('faceplate-partial')?.prototype?._renderContent!=='function')return {deferred:true,retryAfterMs:250};
    const params=new URLSearchParams(location.search),sort=params.get('sort') || 'new',range=params.get('t') || 'all',view=params.get('feedViewType') || 'cardView';
    if(!['new','hot','top'].includes(sort) || !['hour','day','week','month','year','all'].includes(range) || !['cardView','compactView'].includes(view))throw Error('Unsupported native feed controls.');
    const now=Date.now(),app=document.querySelector('shreddit-app'),key=[sort,range,view].join(':');for(const [k,v] of controlReads)if(v.app!==app || v.expires<=now)controlReads.delete(k);
    let cached=controlReads.get(key);
    if(!cached){
      if(now<cooldown || active>=2)return {deferred:true,retryAfterMs:Math.max(250,now<cooldown?cooldown-now:250)};
      // A fixed public profile supplies Reddit's native profile controls even
      // when the viewed account has no native feed. Never import its activity.
      const url=new URL('/user/reddit/submitted/',location.origin);url.searchParams.set('sort',sort);if(sort==='top')url.searchParams.set('t',range);url.searchParams.set('feedViewType',view);
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);active++;
      const promise=(async()=>{const response=await fetch(url.href,{method:'GET',credentials:'include',redirect:'error',headers:{Accept:'text/html'},signal:controller.signal});if(response.status===429){const retry=Number(response.headers.get('retry-after'));cooldown=Date.now()+Math.max(1000,Math.min(3600000,(Number.isFinite(retry)&&retry>0?retry:60)*1000));throw Error('Reddit feed controls are rate limited.');}if(!response.ok)throw Error('Reddit feed controls could not be loaded.');const doc=new DOMParser().parseFromString(await boundedText(response),'text/html'),button=doc.querySelector('button[aria-label="Feed options"]'),dropdown=button?.closest('rpl-dropdown'),root=button?.closest('shreddit-layout-event-setter') || dropdown;if(!dropdown?.querySelector('.main-menu-container') || !root)throw Error('Reddit returned no native profile controls.');for(const node of root.querySelectorAll('script,ac-track,input,form'))node.remove();return root.outerHTML;})().finally(()=>{clearTimeout(timer);active--;});
      cached={app,expires:now+30000,promise};if(controlReads.size>=4)controlReads.delete(controlReads.keys().next().value);controlReads.set(key,cached);promise.catch(()=>{if(controlReads.get(key)===cached)controlReads.delete(key);});
    }
    const doc=new DOMParser().parseFromString(await cached.promise,'text/html'),root=doc.body.firstElementChild;
    if(signal?.aborted || path!==location.pathname+location.search || !target.isConnected || document.getElementById(input.target)!==target)throw Error('Page changed. Try again.');
    for(const row of root.querySelectorAll('rpl-menu-item[href]')){const old=new URL(row.getAttribute('href'),location.origin);if(old.origin!==location.origin || old.pathname!=='/user/reddit/submitted/')throw Error('Unexpected native control destination.');const next=new URL(path,location.origin);for(const name of ['sort','t','feedViewType'])if(old.searchParams.has(name))next.searchParams.set(name,old.searchParams.get(name));if(old.searchParams.has('sort') && old.searchParams.get('sort')!=='top')next.searchParams.delete('t');row.setAttribute('href',next.pathname+next.search);}
    if(/\/comments\/?$/.test(location.pathname)){
      const button=root.querySelector('button[aria-label="Feed options"]'),native=document.querySelector('main shreddit-sort-dropdown')?.shadowRoot?.querySelector('button');
      if(!button)throw Error('Reddit returned no native feed trigger.');
      if(native){const copy=native.cloneNode(true);copy.setAttribute('aria-label','Feed options');copy.setAttribute('aria-expanded','false');button.replaceWith(copy);}
      else{const label=document.createElement('span');label.className='flex items-center gap-xs';label.textContent=sort[0].toUpperCase()+sort.slice(1);let caret=button.querySelector('svg[icon-name="caret-down"]')?.cloneNode(true);if(!caret){caret=document.createElementNS('http://www.w3.org/2000/svg','svg');for(const [name,value] of Object.entries({viewBox:'0 0 20 20',width:'16',height:'16',fill:'currentColor','icon-name':'caret-down','aria-hidden':'true'}))caret.setAttribute(name,value);const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d','M10 13.7a.897.897 0 01-.636-.264l-4.6-4.6a.9.9 0 111.272-1.273L10 11.526l3.964-3.963a.9.9 0 011.272 1.273l-4.6 4.6A.897.897 0 0110 13.7Z');caret.append(path);}label.append(caret);button.replaceChildren(label);button.classList.remove('button-bordered','w-xl');button.classList.add('button-plain');}
      const heading=root.querySelector('.main-menu-container > div');if(heading)heading.textContent='Sort by';
    }
    const partial=document.createElement('faceplate-partial');partial.loading='programmatic';partial.renderMode='contents';partial.style.display='contents';target.replaceChildren(partial);partial._renderContent(root.outerHTML);return {rendered:true};
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
      const view=new URLSearchParams(location.search).get('feedViewType') || sample?.getAttribute('view-type'),context=sample?.getAttribute('view-context');
      url.searchParams.set('pvc',context && /^Profile[A-Za-z0-9]{0,24}$/.test(context)?context:'ProfileFeed2');
      url.searchParams.set('fvt',view && /^[A-Za-z][A-Za-z0-9]{0,31}$/.test(view)?view:'cardView');
    }
    return url;
  }
  function nativeStatus(doc,comments,fullname,username){
    const node=doc.querySelector(comments?`shreddit-profile-comment[comment-id="${fullname}"]`:`shreddit-post[id="${fullname}"]`);
    if(!node)return null;
    const author=node.getAttribute('author') || node.querySelector('shreddit-comment-action-row[author]')?.getAttribute('author') || '';
    // A deleted account is not proof that this particular item was deleted.
    // Likewise, absent content can be a gated or malformed fragment.
    if(author && author!=='[deleted]' && author.toLowerCase()!==username.toLowerCase())return null;
    const state=node.getAttribute('item-state')?.toLowerCase(),body=node.querySelector(comments?'[id$="-post-rtjson-content"],.md':'[slot="text-body"]'),text=body?.textContent?.trim();
    const flag=name=>node.hasAttribute(name) && node.getAttribute(name)!=='false';
    let status=M.domStatus(node) || M.noticeStatus(text) || 'unknown';
    if(status==='unknown' && (!state || ['normal','active','visible','available','unmoderated'].includes(state)) && M.validateUsername(author) && Number.isFinite(Date.parse(node.getAttribute('created-timestamp') || node.querySelector('faceplate-timeago[ts]')?.getAttribute('ts'))) && (comments?Boolean(text):Boolean(node.getAttribute('post-title'))))status='available';
    if(status==='unknown')return null;
    return {fullname,status,author,over18:flag('nsfw'),spoiler:flag('spoiler')};
  }
  function rememberStatus(path,fullname,status){
    if(!status)return;
    const now=Date.now();for(const [key,value] of statusReads)if(value.expires<=now)statusReads.delete(key);
    if(statusReads.size>=100)statusReads.delete(statusReads.keys().next().value);
    statusReads.set(path+'|'+fullname,{status,expires:now+30000});
  }
  function trimNativeReads(path){
    let size=0,count=0;const now=Date.now();
    for(const [key,entry] of nativeCardReads){if(entry.pending)continue;if(entry.path!==path || entry.expires<=now)nativeCardReads.delete(key);else{size+=entry.size;count++;}}
    // Authenticated fragments are transient page-world data, never persisted or
    // sent over the bridge. Bound both their total size and their lifetime.
    for(const [key,entry] of nativeCardReads){if(size<=5000000 && count<=25)break;if(entry.pending)continue;nativeCardReads.delete(key);size-=entry.size;count--;}
  }
  function waitNative(promise,signal,release=()=>{}){
    return new Promise((resolve,reject)=>{
      let settled=false;const finish=(callback,value)=>{if(settled)return;settled=true;signal.removeEventListener('abort',cancel);release();callback(value);},cancel=()=>finish(reject,Error('Post request cancelled.'));
      signal.addEventListener('abort',cancel,{once:true});promise.then(value=>finish(resolve,value),error=>finish(reject,error));if(signal.aborted)cancel();
    });
  }
  function consumeNative(entry,signal){
    // Each consumer cancels only its own wait. Abort the physical read when its
    // last consumer leaves, so a status timeout cannot cancel an active render.
    entry.consumers++;
    return waitNative(entry.promise,signal,()=>{entry.consumers--;if(entry.pending && !entry.consumers)entry.controller.abort();});
  }
  // Comments are small fragments; share four physical reads across render and
  // status consumers, retaining the lower two-read limit for heavier posts.
  function nativeCapacity(comments){return cardActive<4 && (comments || postCardActive<2);}
  async function nativeFragment(comments,fullname,path,signal){
    const key=path+'|'+fullname;
    while(true){
      if(signal.aborted || location.pathname+location.search!==path)throw Error('Page changed. Try again.');
      trimNativeReads(path);const cached=nativeCardReads.get(key);if(cached){if(cached.controller.signal.aborted){await waitNative(cached.promise.catch(()=>null),signal);continue;}return consumeNative(cached,signal);}
      if(Date.now()<cooldown)return {deferred:true,reason:'rate-limit',retryAfterMs:cooldown-Date.now()};
      if(nativeCapacity(comments))break;
      // Join existing reads before taking a slot; a busy renderer is not
      // evidence of an unknown status. Recheck the cache after a slot opens.
      await waitNative(Promise.race([...nativeCardReads.values()].filter(entry=>entry.pending).map(entry=>entry.promise.catch(()=>null))),signal);
    }
    const url=nativeCardUrl(comments,fullname),entry={path,pending:true,size:0,expires:Infinity,controller:new AbortController(),consumers:0};cardActive++;if(!comments)postCardActive++;
    entry.promise=(async()=>{
      const response=await fetch(url.href,{method:'GET',credentials:'include',redirect:'error',headers:{Accept:'text/vnd.reddit.partial+html, text/html;q=0.9'},signal:entry.controller.signal});
      if(response.status===429){const retry=Number(response.headers.get('retry-after'));cooldown=Date.now()+Math.max(1000,Math.min(3600000,(Number.isFinite(retry)&&retry>0?retry:60)*1000));return {deferred:true,reason:'rate-limit',retryAfterMs:cooldown-Date.now()};}
      if(!response.ok)throw Error(`Reddit could not render this card (HTTP ${response.status}).`);
      if(response.headers.get('content-type')?.split(';')[0].trim()!=='text/vnd.reddit.partial+html')throw Error('Reddit returned no native card fragment.');
      const text=await boundedText(response),doc=new DOMParser().parseFromString(text,'text/html'),selector=comments?`shreddit-profile-comment[comment-id="${fullname}"]`:`shreddit-post[id="${fullname}"]`;
      if(!doc.querySelector(selector))throw Error('Reddit returned no matching native card.');
      if(entry.controller.signal.aborted || location.pathname+location.search!==path)throw Error('Page changed. Try again.');
      entry.size=text.length;entry.expires=Date.now()+30000;return {text,url};
    })().finally(()=>{cardActive--;if(!comments)postCardActive--;entry.pending=false;if(!entry.size)nativeCardReads.delete(key);trimNativeReads(location.pathname+location.search);});
    nativeCardReads.set(key,entry);return consumeNative(entry,signal);
  }
  // Cached evidence and rendered native cards already prove a status; they need no read.
  function knownStatus(path,comments,fullname,username){
    const cached=statusReads.get(path+'|'+fullname);if(cached?.expires>Date.now())return cached.status;
    const native=[...document.querySelectorAll(comments?`shreddit-profile-comment[comment-id="${fullname}"]`:`shreddit-post[id="${fullname}"]`)].find(node=>!node.closest('[data-rt-ui]'));
    return native?nativeStatus({querySelector:()=>native},comments,fullname,username):null;
  }
  // Legacy info is only a fast path. After any failure it is skipped for ten minutes; fragments remain the authority.
  let infoBlockedUntil=0;
  // One physical read covers every ID the cache and DOM could not prove. Only exact, authored
  // public evidence resolves here; omitted, foreign-authored or ambiguous IDs stay for fragments.
  async function infoStatuses(ids,comments,path,username,controller,signal){
    if(!ids.length || Date.now()<infoBlockedUntil)return [];
    const url=new URL('/api/info.json',location.origin);url.searchParams.set('id',ids.join(','));url.searchParams.set('raw_json','1');
    // Its own short deadline leaves the batch time to fall back to fragments.
    let children;const local=new AbortController(),link=()=>local.abort(),infoTimer=setTimeout(link,4000);controller.signal.addEventListener('abort',link,{once:true});if(controller.signal.aborted)link();
    try{
      const response=await fetch(url.href,{method:'GET',credentials:'include',redirect:'error',headers:{Accept:'application/json'},signal:local.signal});
      if(response.status===429){const retry=Number(response.headers.get('retry-after'));cooldown=Date.now()+Math.max(1000,Math.min(3600000,(Number.isFinite(retry)&&retry>0?retry:60)*1000));return [];}
      if(!response.ok)throw Error(`Reddit info could not be loaded (HTTP ${response.status}).`);
      const data=JSON.parse(await boundedText(response));
      if(!Array.isArray(data?.data?.children) || data.data.children.length>100)throw Error('Reddit returned an unexpected info response.');
      children=data.data.children;
    }catch{
      // Caller cancellation and route changes reject as before. Anything else, including our own deadline, disables only the fast path.
      if(signal?.aborted || location.pathname+location.search!==path)throw Error('Page changed. Try again.');
      infoBlockedUntil=Date.now()+600000;return [];
    }finally{clearTimeout(infoTimer);controller.signal.removeEventListener('abort',link);}
    if(controller.signal.aborted || location.pathname+location.search!==path)throw Error('Page changed. Try again.');
    const resolved=new Map();
    for(const child of children){
      if(child?.kind!==(comments?'t1':'t3'))continue;
      const item=(comments?M.normalizeComment:M.normalizePost)(child.data,{source:'reddit'});
      if(!item || !ids.includes(item.fullname) || resolved.has(item.fullname))continue;
      // Authorship must match this profile. A deleted account proves only its own tombstones, never that its content is available.
      const own=item.author.toLowerCase()===username.toLowerCase(),tombstone=item.author==='[deleted]' && item.status!=='available';
      if((own || tombstone) && ['available','deleted','removed'].includes(item.status))resolved.set(item.fullname,{fullname:item.fullname,status:item.status,author:item.author,over18:item.over18,spoiler:item.spoiler});
    }
    return [...resolved.values()];
  }
  async function readStatuses(input,signal){
    const context=route(),path=location.pathname+location.search,comments=input.kind==='comment';
    if(location.protocol!=='https:' || !['reddit.com','www.reddit.com','new.reddit.com','sh.reddit.com'].includes(location.hostname) || !context?.username || !M.validateUsername(input.username) || context.username.toLowerCase()!==input.username.toLowerCase())throw Error('Open the matching public profile.');
    if(!['post','comment'].includes(input.kind) || !Array.isArray(input.ids) || !input.ids.length || input.ids.length>25 || !input.ids.every(id=>comments?M.validateCommentId(id):M.validateId(id)))throw Error('Invalid public status IDs.');
    const requestedIds=[...new Set(input.ids.map(id=>(comments?'t1_':'t3_')+id.toLowerCase().replace(/^t[13]_/,'')))],statuses=[];
    const now=Date.now();if(now<cooldown)throw Error('Reddit asked us to wait. Try again shortly.');
    if(active>=2)return {deferred:true,retryAfterMs:250};
    const controller=new AbortController(),cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();active++;
    let timer,timedOut=false,fragmentReads=false;
    const remember=status=>{rememberStatus(path,status.fullname,status);statuses.push(status);};
    try{
      // One bounded, demand-driven batch. No background retry/sync loop, and no
      // authenticated HTML leaves the page world. Known evidence costs no read; the
      // rest share one info read, and only IDs it cannot prove reach the card budget.
      const operation=(async()=>{
        let ids=[];for(const fullname of requestedIds){const status=knownStatus(path,comments,fullname,input.username);if(status)remember(status);else ids.push(fullname);}
        const fast=await infoStatuses(ids,comments,path,input.username,controller,signal);
        fast.forEach(remember);ids=ids.filter(fullname=>!fast.some(status=>status.fullname===fullname));
        await Promise.all(Array.from({length:Math.min(2,ids.length)},async()=>{
          while(ids.length){
            const fullname=ids.shift();
            if(controller.signal.aborted || location.pathname+location.search!==path)throw Error('Page changed. Try again.');
            let status=knownStatus(path,comments,fullname,input.username);
            if(!status){
              fragmentReads=true;
              try{const fragment=await nativeFragment(comments,fullname,path,controller.signal);if(!fragment.deferred)status=nativeStatus(new DOMParser().parseFromString(fragment.text,'text/html'),comments,fullname,input.username);}
              catch{ /* A failed or missing fragment establishes no current status. */ }
            }
            if(controller.signal.aborted || location.pathname+location.search!==path)throw Error('Page changed. Try again.');
            if(status)remember(status);
          }
        }));
      })();
      try{await Promise.race([operation,new Promise(resolve=>{timer=setTimeout(()=>{timedOut=true;controller.abort();resolve();},10000);})]);}
      catch(error){if(!timedOut)throw error;}
      if(signal?.aborted || location.pathname+location.search!==path)throw Error('Page changed. Try again.');
      const verified=new Set(statuses.map(status=>status.fullname)),unknownIds=requestedIds.filter(id=>!verified.has(id));
      // "info" means no native fragment was needed for any ID, so the caller may use a larger batch.
      return {statuses,unknownIds,incomplete:unknownIds.length>0,...(timedOut?{timedOut:true}:{}),via:fragmentReads || unknownIds.length?'native':'info',source:'reddit'};
    }finally{active--;clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
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
    const now=Date.now();
    if(now<cooldown || !nativeCapacity(comments) && !nativeCardReads.has(path+'|'+fullname))return {deferred:true,retryAfterMs:Math.max(100,now<cooldown?cooldown-now:250)};
    if(typeof customElements.get('faceplate-partial')?.prototype?._renderContent!=='function'){
      const since=rendererWaits.get(target) ?? now;rendererWaits.set(target,since);
      if(now-since>=10000)throw Error('Reddit’s native card renderer did not become ready. Retry after the page finishes loading.');
      return {deferred:true,reason:'renderer-startup',retryAfterMs:250};
    }
    rendererWaits.delete(target);
    const controller=new AbortController(),cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
    let timer;
    try{
      const operation=(async()=>{
        const fragment=await nativeFragment(comments,fullname,path,controller.signal);if(fragment.deferred)return fragment;
        const {text,url}=fragment,doc=new DOMParser().parseFromString(text,'text/html');
        rememberStatus(path,fullname,nativeStatus(doc,comments,fullname,input.username));
        if(location.pathname+location.search!==path || controller.signal.aborted || !target.isConnected || document.getElementById(input.target)!==target)throw Error('Page changed. Try again.');
        if(alreadyPresent())return {rendered:false,duplicate:true,fullname};
        // The authenticated HTML stays in Reddit's page world. Use its own trusted
        // fragment renderer so component modules, media and native actions hydrate.
        const partial=document.createElement('faceplate-partial');partial.loading='programmatic';partial.src=url.pathname+url.search;partial.renderMode='contents';
        target.replaceChildren(partial);partial._renderContent(text);
        if(!target.querySelector(selector))throw Error('Reddit could not attach its native card.');
        const tag=comments?'shreddit-profile-comment':'shreddit-post';
        await waitNative(customElements.whenDefined(tag),controller.signal);
        const native=target.querySelector(selector);if(native?.updateComplete)await waitNative(Promise.resolve(native.updateComplete),controller.signal);
        if(location.pathname+location.search!==path || controller.signal.aborted || !target.isConnected || document.getElementById(input.target)!==target || !native || !target.contains(native))throw Error('Page changed. Try again.');
        target.dataset.rtNativeState='ready';return {rendered:true,fullname};
      })();
      const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Native card loading timed out.'));},10000);});
      return await Promise.race([operation,timeout]);
    }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
  }
  // Comment headshot of an archived comment's original author, from native
  // markup or Reddit's profile data, with a hover-card fallback. Only an HTTPS
  // URL on Reddit's image hosts leaves the page world; cache it per username.
  const avatarReads=new Map(),avatarHosts=new Set(['styles.redditmedia.com','i.redd.it','preview.redd.it','cf.preview.redd.it','www.redditstatic.com']);
  const safeAvatar=value=>{try{const url=new URL(value);return url.protocol==='https:' && !url.username && !url.password && avatarHosts.has(url.hostname) && (!url.pathname.includes('/snoovatar/avatars/') || /-headshot\.[a-z]+$/i.test(url.pathname))?url.href:'';}catch{return '';}};
  async function userAvatar(input,signal){
    if(!M.validateUsername(input.username))throw Error('Invalid username.');
    const name=input.username.toLowerCase(),now=Date.now(),cached=avatarReads.get(name);
    // Reuse a native comment headshot (including its signed preview query)
    // when this author already appears on the page. Never synthesize signatures.
    for(const comment of document.querySelectorAll('shreddit-comment[author]'))if(comment.getAttribute('author')?.toLowerCase()===name){const slot=comment.querySelector('[slot="commentAvatar"]');if(slot?.closest('shreddit-comment')!==comment)continue;for(const image of slot?.querySelectorAll('image[href],img[src]') || []){const url=safeAvatar(image.getAttribute('href') || image.getAttribute('src'));if(url)return {avatar:url};}}
    if(cached?.expires>now)return {avatar:cached.url};
    if(now<cooldown)return {deferred:true,retryAfterMs:cooldown-now};
    if(active>=2)return {deferred:true,retryAfterMs:250};
    const controller=new AbortController(),cancel=()=>controller.abort(),timer=setTimeout(cancel,8000);signal?.addEventListener('abort',cancel,{once:true});active++;
    try{
      // icon_img is Reddit's comment/avatar headshot; snoovatar_img and the
      // hover card can contain the full-body artwork instead.
      const profile=await fetch(new URL('/user/'+encodeURIComponent(input.username)+'/about.json?raw_json=1',location.origin).href,{method:'GET',credentials:'include',redirect:'error',headers:{Accept:'application/json'},signal:controller.signal});
      if(profile.status===429){const retry=Number(profile.headers.get('retry-after'));cooldown=Date.now()+Math.max(1000,Math.min(3600000,(Number.isFinite(retry)&&retry>0?retry:60)*1000));return {deferred:true,retryAfterMs:cooldown-Date.now()};}
      if(profile.ok){let data;try{data=JSON.parse(await boundedText(profile)).data;}catch{}const url=typeof data?.name==='string' && data.name.toLowerCase()===name?safeAvatar(data.icon_img):'';if(url){if(avatarReads.size>=200)avatarReads.delete(avatarReads.keys().next().value);avatarReads.set(name,{url,expires:Date.now()+1800000});return {avatar:url};}}
      const response=await fetch(new URL('/svc/shreddit/user-hover-card/'+encodeURIComponent(input.username),location.origin).href,{method:'GET',credentials:'include',redirect:'error',headers:{Accept:'text/vnd.reddit.partial+html, text/html;q=0.9'},signal:controller.signal});
      if(response.status===429){const retry=Number(response.headers.get('retry-after'));cooldown=Date.now()+Math.max(1000,Math.min(3600000,(Number.isFinite(retry)&&retry>0?retry:60)*1000));return {deferred:true,retryAfterMs:cooldown-Date.now()};}
      let url='';
      if(response.ok){
        const doc=new DOMParser().parseFromString(await boundedText(response),'text/html'),img=doc.querySelector('[avatar] image[href],[avatar] img[src],img[alt*="avatar" i][src]') || doc.querySelector('img[src]');
        const candidate=safeAvatar(img?.getAttribute('href') || img?.getAttribute('src'));
        // An unavailable headshot keeps the native default, not a tiny full body.
        if(candidate)url=candidate;
      }
      if(avatarReads.size>=200)avatarReads.delete(avatarReads.keys().next().value);avatarReads.set(name,{url,expires:Date.now()+1800000});
      return {avatar:url};
    }finally{active--;clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
  }
  async function read(input,signal){
    if(input.action==='user-avatar')return userAvatar(input,signal);
    if(input.action==='render-card')return renderCard(input,signal);
    if(input.action==='status')return readStatuses(input,signal);
    if(input.action==='render-navigation')return renderNavigation(input,signal);
    if(input.action==='render-controls')return renderControls(input,signal);
    const context=route(),path=location.pathname+location.search;
    if(!context || !['reddit.com','www.reddit.com','new.reddit.com','sh.reddit.com','old.reddit.com'].includes(location.hostname))throw Error('Open a public Reddit profile or post.');
    const comments=input.kind==='comment';
    const sort=input.sort ?? 'new',range=input.range ?? 'all';
    if(!['new','hot','top'].includes(sort) || !['hour','day','week','month','year','all'].includes(range))throw Error('Invalid public feed sort.');
    if(input.kind!=null && !['post','comment'].includes(input.kind))throw Error('Invalid content type.');
    const stream=input.stream ?? 'authenticated';
    if(input.stream!=null && (input.action!=='profile' || !comments || !['authenticated','public'].includes(stream)))throw Error('Invalid comment discovery stream.');
    const url=new URL('/api/info.json',location.origin);let nativeSearch=false,postPage=null,commentCursor=null,anonymous=false;
    if(input.action==='profile'){
      if(!context.username || !M.validateUsername(input.username) || context.username.toLowerCase()!==input.username.toLowerCase())throw Error('Profile changed. Try again.');
      if(comments)commentCursor=readCommentCursor(input.after,stream,input.username,sort,range);
      if(!comments)postPage=readPostCursor(input.after,input.username,sort,range);
      // Signed-in Shreddit omits posts for explicitly blocked profiles in live
      // comparisons. Keep the existing authenticated JSON path for that case;
      // the page cursor pins its transport until Refresh starts a new scope.
      const blocked=!comments && Boolean(document.querySelector('#right-sidebar-container faceplate-tracker[source="profile"][noun="unblock_user"]'));
      // Blocked profiles: signed-in search omits their posts and the legacy JSON
      // route now answers 403, so search them without credentials instead.
      nativeSearch=comments || (postPage?.transport || 'shreddit')==='shreddit';anonymous=comments?stream==='public':blocked && nativeSearch;
      url.pathname=nativeSearch?'/svc/shreddit/search/':'/search.json';url.searchParams.set('q',`author:"${input.username}"`);url.searchParams.set('type',comments?'comments':nativeSearch?'posts':'link');url.searchParams.set('sort',sort);if(sort==='top')url.searchParams.set('t',range);url.searchParams.set('limit','25');
      if(input.after)url.searchParams.set(nativeSearch?'cursor':'after',comments?commentCursor:postPage.cursor);
    }else if(input.action==='info'){
      if(!Array.isArray(input.ids) || !input.ids.length || input.ids.length>25 || !input.ids.every(id=>comments?M.validateCommentId(id):M.validateId(id)))throw Error('Invalid public post IDs.');
      const ids=input.ids.map(id=>id.toLowerCase().replace(/^t[13]_/, ''));
      if(context.id && (comments || ids.length!==1 || ids[0]!==context.id))throw Error('Post changed. Try again.');
      url.searchParams.set('id',ids.map(id=>(comments?'t1_':'t3_')+id).join(','));
    }else throw Error('Unknown public post operation.');
    const now=Date.now();
    if(now<cooldown)throw Error('Reddit asked us to wait. Try again shortly.');
    if(active>=2)return {deferred:true,retryAfterMs:250};
    active++;
    if(!nativeSearch)url.searchParams.set('raw_json','1');
    const controller=new AbortController(),cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
    let timer;
    try{
      const operation=(async()=>{
        const response=await fetch(url.href,{method:'GET',credentials:input.action==='profile' && anonymous?'omit':'include',...(input.action==='profile' && nativeSearch && (comments || anonymous)?{cache:'no-store',referrerPolicy:'no-referrer'}:{}),redirect:'error',headers:{Accept:nativeSearch?'text/vnd.reddit.partial+html, text/html;q=0.9':'application/json'},signal:controller.signal});
        if(response.status===429){const retry=Number(response.headers.get('retry-after'));cooldown=Date.now()+Math.max(1000,Math.min(3600000,(Number.isFinite(retry)&&retry>0?retry:60)*1000));throw Error('Reddit rate limit reached. Try again later.');}
        if(!response.ok){
          // Name the source so the page can explain it; 403 means Reddit refused this request.
          const what=input.action==='profile'?(comments?(stream==='public'?'logged-out comment search':'comment search'):'post search'):'item details';
          throw Error(response.status===403?`Reddit blocked ${what} (HTTP 403).`:`Reddit couldn’t load ${what} (HTTP ${response.status}).`);
        }
        const text=await boundedText(response);
        if(location.pathname+location.search!==path || controller.signal.aborted)throw Error('Page changed. Try again.');
        if(nativeSearch)return (comments?commentListing:postListing)(text,input.username,{sort,range,stream});
        let data;try{data=JSON.parse(text);}catch{throw Error('Reddit returned an unexpected response.');}
        if(!Array.isArray(data?.data?.children) || data.data.children.length>100)throw Error('Reddit returned an unexpected post listing.');
        if(location.pathname+location.search!==path || controller.signal.aborted)throw Error('Page changed. Try again.');
        const posts=data.data.children.filter(item=>item.kind===(comments?'t1':'t3')).slice(0,25).map(item=>(comments?M.normalizeComment:M.normalizePost)(item.data,{source:'reddit'})).filter(Boolean);
        const filtered=input.action==='profile'?posts.filter(p=>p.author.toLowerCase()===input.username.toLowerCase()):posts.filter(p=>input.ids.some(id=>id.toLowerCase().replace(/^t[13]_/, '')===p.id));
        const cursor=typeof data.data.after==='string' && /^t3_[a-z0-9]{1,10}$/i.test(data.data.after)?data.data.after:null;
        const after=input.action==='profile'?postPageCursor(cursor,'json',input.username,sort,range):cursor;
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
    if(jobs.size>=4){const deferred=['render-card','render-navigation','render-controls','profile','info','status','user-avatar'].includes(input.action);document.dispatchEvent(new CustomEvent('rt-post-response',{detail:JSON.stringify({channel:input.channel,id:input.id,ok:deferred,...(deferred?{deferred:true,retryAfterMs:250}:{error:'Please wait for the current Reddit request.'})})}));return;}
    const controller=new AbortController();jobs.set(key,controller);
    try{const result=await read(input,controller.signal);document.dispatchEvent(new CustomEvent('rt-post-response',{detail:JSON.stringify({channel:input.channel,id:input.id,ok:true,...result})}));}
    catch(error){document.dispatchEvent(new CustomEvent('rt-post-response',{detail:JSON.stringify({channel:input.channel,id:input.id,ok:false,error:controller.signal.aborted?'Post request cancelled.':error.message})}));}
    finally{jobs.delete(key);}
  });
})();
