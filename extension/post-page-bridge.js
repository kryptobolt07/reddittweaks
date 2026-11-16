/* Reddit reads. Authentication and private page HTML stay in Reddit's page world. */
(() => {
  'use strict';
  if(window.top!==window || !globalThis.RTPostModel)return;
  function publicBrowserRead(url,signal,refresh=false){
    if(!globalThis.RTPublicBrowser)throw Error('Reddit blocked logged-out search (HTTP 403).');
    return RTPublicBrowser.read(url,{signal,refresh});
  }
  // Bound simultaneous work and honor server cooldowns; cursor-driven scrolling
  // must not stall behind an unrelated lifetime or rolling card-count quota.
  const M=RTPostModel,jobs=new Map(),rendererWaits=new WeakMap(),navigationReads=new Map(),controlReads=new Map(),emptySearchReads=new Map(),statusReads=new Map(),nativeCardReads=new Map();let active=0,cardActive=0,postCardActive=0,cooldown=0;
  // The page a read belongs to. The extension's own rt_* filter params (written with replaceState) are not
  // navigation, so changing a filter must not abort reads already in flight ("Page changed. Try again.").
  function pageKey(){const params=new URLSearchParams(location.search);for(const key of [...params.keys()])if(key.startsWith('rt_') && key!=='rt_list')params.delete(key);const rest=params.toString();return location.pathname+(rest?'?'+rest:'');}
  function route(){
    const profile=location.pathname.match(/^\/user\/([\w-]{1,20})(?:\/(?:submitted|comments|search|saved|history|hidden|upvoted|downvoted))?\/?$/i);
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
  // One pass: measure everything first, then change the DOM, then correct the
  // scroll position. Measuring between writes would force a layout each time.
  function syncFeed(){
    const feed=currentFeed();
    if(!ownedFeed(feed)){
      const controller=feed?.virtualization;if(controller && managed.has(controller)){managed.delete(controller);releaseFeed(controller);}
      return;
    }
    const controller=manageFeed(feed);if(!controller)return;
    try{reconcileFeed(feed,controller);}
    // Our own changes must not wake the observer into another pass.
    finally{feedObserver?.takeRecords();}
  }
  function reconcileFeed(feed,controller){
    const height=Math.max(1,window.innerHeight || 0),restoreAbove=-1.5*height,restoreBelow=2.5*height,virtualizeAbove=-Math.max(3*height,height+1000);
    // Read phase.
    const rows=[];let anchor=null;
    for(let child=feed.firstElementChild;child;child=child.nextElementSibling){
      const rect=child.getBoundingClientRect(),row={child,top:rect.top,bottom:rect.bottom,height:rect.height,placeholder:child.classList.contains('virtualized-placeholder')};rows.push(row);
      if(!anchor && !row.placeholder && row.height>0 && row.bottom>0 && row.top<window.innerHeight)anchor={child,top:row.top};
    }
    // Virtualize candidates: only cards far above the viewport, the same distance
    // Reddit uses. Our status/loader UI and empty elements stay mounted.
    const pending=[];
    for(const row of rows){
      if(row.placeholder || row.child.dataset.rtUi && row.child.dataset.rtUi!=='activity-item')continue;
      if(row.height>0 && row.top>=virtualizeAbove)break;
      if(row.height>0 && row.bottom<virtualizeAbove)pending.push(row);
    }
    // Write phase. Restore any placeholder near the viewport; a restored entry
    // can itself be an older placeholder, so look again only in that case (bounded).
    let changed=false,nearRows=rows.filter(row=>row.placeholder && row.bottom>restoreAbove && row.top<restoreBelow);
    for(let pass=0;pass<8;pass++){
      const stack=controller.topStack,byPlaceholder=new Map();for(const entry of stack)if(entry?.placeholder)byPlaceholder.set(entry.placeholder,entry);
      // Entries whose placeholder left the document can never be restored by
      // Reddit either (its replaceChild would throw); drop them.
      const stale=stack.filter(entry=>!entry?.placeholder?.isConnected);
      if(!nearRows.length && !stale.length)break;
      const done=new Set(stale);let again=false;
      for(const {child:placeholder} of nearRows){const entry=byPlaceholder.get(placeholder);if(entry){restoreEntry(feed,entry);done.add(entry);if(entry.node?.classList?.contains('virtualized-placeholder'))again=true;}else placeholder.remove();changed=true;}
      if(done.size){const keep=stack.filter(entry=>!done.has(entry));stack.length=0;stack.push(...keep);}
      if(!again)break;
      nearRows=[];for(const placeholder of feed.querySelectorAll(':scope > .virtualized-placeholder')){const rect=placeholder.getBoundingClientRect();if(rect.bottom>restoreAbove && rect.top<restoreBelow)nearRows.push({child:placeholder});}
    }
    for(const {child:node,height:size} of pending){
      if(node.parentElement!==feed)continue;
      const placeholder=document.createElement('div');placeholder.className='virtualized-placeholder';placeholder.style.height=size+'px';feed.replaceChild(placeholder,node);controller.topStack.push({node,placeholder,height:size});changed=true;
    }
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
  async function boundedText(response,max=2500000){
    if(Number(response.headers.get('content-length'))>max)throw Error('Reddit response is too large.');
    let text='';
    if(response.body?.getReader){const reader=response.body.getReader(),decoder=new TextDecoder();let bytes=0;try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>max){await reader.cancel();throw Error('Reddit response is too large.');}text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}}
    else text=await response.text();
    if(text.length>max)throw Error('Reddit response is too large.');
    return text;
  }
  // Search mode (the profile search view) adds the user's words to the author query and may sort by relevance or comment count.
  const authorQuery=username=>`author:"${username}"`;
  function searchCursor(doc,username,type,sort,range,{q=authorQuery(username),search=false}={}){
    for(const part of doc.querySelectorAll('faceplate-partial[loading="lazy"][src]'))try{
      const url=new URL(part.getAttribute('src'),location.origin),cursor=url.searchParams.get('cursor');
      if(url.origin===location.origin && url.pathname==='/svc/shreddit/search/' && url.searchParams.get('q')===q && url.searchParams.get('type')===type && (url.searchParams.get('sort') || (search?'relevance':'new'))===sort && (sort!=='top' && !search || (url.searchParams.get('t') || 'all')===range) && typeof cursor==='string' && cursor.length>0 && cursor.length<=4096 && !/[\u0000-\u001f]/.test(cursor))return cursor;
    }catch{ /* Only Reddit's matching, same-origin continuation is followed. */ }
    return null;
  }
  function postPageCursor(cursor,transport,username,sort,range,q=authorQuery(username)){return cursor?'rt-post-search:'+JSON.stringify({cursor,transport,username:username.toLowerCase(),sort,range,q}):null;}
  function readPostCursor(value,username,sort,range,q=authorQuery(username)){
    if(value==null)return null;
    try{if(typeof value!=='string' || value.length>8192 || !value.startsWith('rt-post-search:'))throw Error();
      const page=JSON.parse(value.slice(15));
      if(page.username!==username.toLowerCase() || page.sort!==sort || page.range!==range || (page.q ?? authorQuery(username))!==q || !['shreddit','json'].includes(page.transport) || typeof page.cursor!=='string' || !page.cursor || page.cursor.length>4096 || /[\u0000-\u001f]/.test(page.cursor) || page.transport==='json' && !/^t3_[a-z0-9]{1,10}$/i.test(page.cursor))throw Error();
      return page;
    }catch{throw Error('Invalid Reddit page cursor. Refresh activity to start again.');}
  }
  function commentPageCursor(cursor,stream,username,sort,range,q=authorQuery(username)){return cursor?'rt-comment-search:'+JSON.stringify({cursor,stream,username:username.toLowerCase(),sort,range,q}):null;}
  function readCommentCursor(value,stream,username,sort,range,q=authorQuery(username)){
    if(value==null)return null;
    try{if(typeof value!=='string' || value.length>8192 || !value.startsWith('rt-comment-search:'))throw Error();const page=JSON.parse(value.slice(18));
      if(page.stream!==stream || page.username!==username.toLowerCase() || page.sort!==sort || page.range!==range || (page.q ?? authorQuery(username))!==q || typeof page.cursor!=='string' || !page.cursor || page.cursor.length>4096 || /[\u0000-\u001f]/.test(page.cursor))throw Error();return page.cursor;
    }catch{throw Error('Invalid Reddit comment cursor. Refresh activity to start again.');}
  }
  function postListing(text,username,{sort='new',range='all',q=authorQuery(username),search=false}={}){
    const doc=new DOMParser().parseFromString(text,'text/html'),posts=[],seen=new Set();
    // Crossposts have no search-sdui-post test ID. Their outer view tracker is
    // the result; embedded original-post trackers must not become extra hits.
    const cards=doc.querySelectorAll('search-telemetry-tracker[view-events="search/view/post"]');let unread=0;
    if(cards.length>100)throw Error('Reddit returned an unexpected post listing.');
    for(const tracker of cards){
      try{
        const context=JSON.parse(tracker.getAttribute('data-faceplate-tracking-context')),id=context.post?.id;
        // Reddit's newer search cards: search-post-with-content-preview > sdui-post-unit (title, counters).
        const card=tracker.querySelector('[data-testid="search-crosspost-unit"],[data-testid="search-post-unit"],[data-testid="search-post-with-content-preview"],[data-testid="sdui-post-unit"]');
        const detail=[tracker,...tracker.querySelectorAll('search-telemetry-tracker')].map(node=>JSON.parse(node.getAttribute('data-faceplate-tracking-context') || '{}')).find(value=>value.post?.id===id && value.profile?.name);
        if(!M.validateId(id) || detail?.profile?.name?.toLowerCase()!==username.toLowerCase() || !card)throw Error();
        const title=card.querySelector('a[data-testid="post-title"],a[data-testid="post-title-text"]'),permalink=new URL(title?.getAttribute('href'),location.origin);
        if(permalink.origin!==location.origin || permalink.pathname.match(/\/comments\/([a-z0-9]{1,10})(?:\/|$)/i)?.[1]!==id.slice(3))throw Error();
        const crosspost=card.getAttribute('data-testid')==='search-crosspost-unit';
        const counter=card.querySelector(crosspost?':scope > [data-testid="search-counter-row"]':'[data-testid="search-counter-row"]'),numbers=[...counter.querySelectorAll('faceplate-number[number]')].map(node=>Number(node.getAttribute('number')));
        if(numbers.length<2 || !numbers.every(Number.isFinite))throw Error();
        const post=M.normalizePost({id,author:detail.profile.name,title:context.post.title,subreddit:context.subreddit?.name,
          created_utc:Date.parse((card.querySelector('faceplate-timeago[ts]') || tracker.querySelector('faceplate-timeago[ts]'))?.getAttribute('ts'))/1000,
          score:numbers[0],num_comments:numbers[1],permalink:permalink.href,status:'unknown',thumbnail:card.querySelector('faceplate-img[data-testid="search_post_thumbnail"],img[data-testid="search_post_thumbnail"]')?.getAttribute('src') || undefined,subredditIcon:card.querySelector('.post-credit-row img[src],[avatar] img[src]')?.getAttribute('src') || undefined,subredditColor:card.querySelector('.post-credit-row img[src],[avatar] img[src]')?.getAttribute('style')?.match(/background:\s*(#[0-9a-f]{6})\b/i)?.[1],
          over_18:context.post.nsfw===true || context.subreddit?.nsfw===true || detail.post.nsfw===true,spoiler:context.post.spoiler===true || detail.post.spoiler===true});
        if(!post)throw Error();if(!seen.has(id)){seen.add(id);posts.push(post);}
      }catch{unread++;}
    }
    // One unusual card is skipped; only a page where no card can be read means the format changed.
    if(cards.length && !posts.length && unread)throw Error('Reddit’s post search format changed. Posts could not be read safely.');
    const cursor=searchCursor(doc,username,'posts',sort,range,{q,search});
    if(!cards.length && !cursor){const empty=doc.querySelector('search-telemetry-tracker[view-events="search/view/no_results"]');let reason;try{reason=JSON.parse(empty?.getAttribute('data-faceplate-tracking-context')).action_info?.reason;}catch{}if(reason!=='empty')throw Error('Reddit returned an unrecognized post search response.');}
    return {posts,after:postPageCursor(cursor,'shreddit',username,sort,range,q),hasMore:Boolean(cursor),incomplete:true,source:'reddit'};
  }
  function commentListing(text,username,{sort='new',range='all',stream='authenticated',q=authorQuery(username),search=false}={}){
    const doc=new DOMParser().parseFromString(text,'text/html'),posts=[],seen=new Set();let unread=0,foreign=0;
    const cards=doc.querySelectorAll('[data-testid="search-sdui-comment-unit"]');
    // The comment's author: a profile link outside the comment text, relative or absolute (Reddit moved to absolute
    // https://www.reddit.com/user/<name>/ links), or the older href="#" link; "u/" prefixes are ignored.
    const authorOf=card=>{for(const a of card.querySelectorAll('a[href="#"],a[href*="/user/"]')){if(a.closest('[id$="-post-rtjson-content"],[data-testid="search-comment-content"] p'))continue;
      const fromHref=(a.getAttribute('href') || '').match(/^(?:https:\/\/(?:www\.)?reddit\.com)?\/user\/([A-Za-z0-9_-]{3,20})\/?$/)?.[1],fromText=a.textContent.trim().replace(/^\/?u\//i,'');
      const name=fromHref || (/^[A-Za-z0-9_-]{3,20}$/.test(fromText)?fromText:'');if(name)return name;}return '';};
    if(cards.length>100)throw Error('Reddit returned an unexpected comment listing.');
    for(const card of cards){
      try{
        const context=JSON.parse(card.closest('search-telemetry-tracker')?.getAttribute('data-faceplate-tracking-context') || '{}');
        const content=card.querySelector('[data-testid="search-comment-content"]');
        const author=authorOf(card);
        // Another person's comment is skipped, not a sign that the format changed.
        if(author && author.toLowerCase()!==username.toLowerCase()){foreign++;continue;}
        if(!author)throw Error('no author');
        const parts=[...content.querySelectorAll('[id$="-post-rtjson-content"] p')].map(p=>p.textContent.trim());
        const body=parts.length?parts.join('\n\n'):content.querySelector('[id$="-post-rtjson-content"]')?.textContent?.trim();
        const post=M.normalizeComment({id:context.comment?.id,author,body,link_id:context.comment?.post_id || context.post?.id,
          ...(Object.hasOwn(context.comment || {},'parent_id')?{parent_id:context.comment.parent_id}:{}),link_title:context.post?.title,subreddit:context.subreddit?.name,over_18:context.post?.nsfw===true || context.subreddit?.nsfw===true,spoiler:context.post?.spoiler,
          created_utc:Date.parse(content.querySelector('faceplate-timeago')?.getAttribute('ts'))/1000,
          score:Number(content.querySelector('faceplate-number')?.getAttribute('number')) || 0,
          ...(counts=>counts.length>=2 && counts.every(Number.isFinite)?{postScore:counts[0],postComments:counts[1]}:{})([...(card.querySelector(':scope [data-testid="search-counter-row"]')?.querySelectorAll('faceplate-number[number]') || [])].map(node=>Number(node.getAttribute('number')))),
          subredditIcon:card.querySelector('.shreddit-subreddit-icon__icon img[src],[avatar] img[src]')?.getAttribute('src') || undefined,subredditColor:card.querySelector('.shreddit-subreddit-icon__icon img[src],[avatar] img[src]')?.getAttribute('style')?.match(/background:\s*(#[0-9a-f]{6})\b/i)?.[1],
          permalink:card.querySelector('a[aria-labelledby^="comment-content-"]')?.getAttribute('href')});
        if(!post)throw Error('unreadable');if(!seen.has(post.fullname)){seen.add(post.fullname);posts.push(post);}
      }catch{unread++; /* A malformed card cannot become an unsafe or misattributed result. */ }
    }
    // Only a page where cards exist but none could be read means the format changed (contract R13).
    if(cards.length && !posts.length && unread)throw Error('Reddit’s comment format changed. Comments could not be read.');
    // Only other people's comments: Reddit didn't apply the author filter, so this page can't be trusted.
    if(cards.length && !posts.length && foreign)throw Error('Reddit’s comment search returned other people’s comments instead of this profile’s.');
    const cursor=searchCursor(doc,username,'comments',sort,range,{q,search});
    if(!cards.length && !cursor){let reason;try{reason=JSON.parse(doc.querySelector('search-telemetry-tracker[view-events="search/view/no_results"]')?.getAttribute('data-faceplate-tracking-context')).action_info?.reason;}catch{}if(reason!=='empty')throw Error('Reddit returned an unrecognized comment search response.');}
    const after=commentPageCursor(cursor,stream,username,sort,range,q);
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
    const profileShell=target?.closest('[data-rt-ui="archive-profile"]'),communityShell=target?.closest('[data-rt-ui="archive-subreddit"]'),shell=profileShell || communityShell;
    const communityName=()=>location.pathname.match(/^\/r\/([A-Za-z0-9_]{2,21})(?:\/(?:search|comments(?:\/.*)?))?\/?$/i)?.[1]?.toLowerCase();
    const communityAllowed=Boolean(communityShell && target?.dataset.rtUi==='community-navigation' && /^[A-Za-z0-9_]{2,21}$/.test(input.subreddit || '') && communityName()===input.subreddit.toLowerCase() && communityShell.dataset.rtSubreddit?.toLowerCase()===input.subreddit.toLowerCase());
    const profileAllowed=Boolean(profileShell && context?.username && M.validateUsername(input.username) && context.username.toLowerCase()===input.username.toLowerCase() && target?.dataset.rtUi==='profile-navigation');
    if(location.protocol!=='https:' || !['reddit.com','www.reddit.com','new.reddit.com','sh.reddit.com'].includes(location.hostname) || !shell || !(profileAllowed || communityAllowed))throw Error('Open the matching archived profile or community.');
    const now=Date.now();if(now<cooldown || active>=2)return {deferred:true,retryAfterMs:Math.max(100,now<cooldown?cooldown-now:250)};
    const Renderer=customElements.get('faceplate-partial');if(typeof Renderer?.prototype?._renderContent!=='function')return {deferred:true,retryAfterMs:250};
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
      // The fragment comes from the home page, so its server-rendered top section (declarative shadow root) shows
      // Home selected. A subreddit page selects none: drop that snapshot so the defined element renders itself
      // from selectedpagetype instead of hydrating the home page's selection.
      if(communityAllowed)for(const top of navigation.querySelectorAll('left-nav-top-section')){top.setAttribute('selectedpagetype','community');if(customElements.get('left-nav-top-section'))for(const snapshot of top.querySelectorAll(':scope>template[shadowrootmode],:scope>template[shadowroot]'))snapshot.remove();}
      const current=route();if(controller.signal.aborted || !target.isConnected || document.getElementById(input.target)!==target || target.closest(profileAllowed?'[data-rt-ui="archive-profile"]':'[data-rt-ui="archive-subreddit"]')!==shell || (profileAllowed?(current?.username?current.username.toLowerCase()!==input.username.toLowerCase():!current?.id):communityName()!==input.subreddit.toLowerCase()))throw Error('Page changed. Try again.');
      // Seed the native controller before connection so SSR's expanded default cannot widen a collapsed layout
      // (archived communities and deleted profiles alike).
      navigation.setAttribute('expanded',shell.classList.contains('flex-nav-collapsed')?'0':'1');
      navigation.setAttribute('parent-grid-selector',communityAllowed?'[data-rt-ui="archive-subreddit"]':'[data-rt-ui="archive-profile"]');navigation.setAttribute('no-animate','');
      const partial=document.createElement('faceplate-partial');partial.loading='programmatic';partial.renderMode='contents';partial.style.display='contents';target.replaceChildren(partial);partial._renderContent(navigation.outerHTML);return {rendered:true};
    })(),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Reddit navigation loading timed out.'));},10000);})]);}finally{active--;clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
  }
  async function loadArchiveCommentModules(input,signal){
    const match=location.pathname.match(/^\/r\/([A-Za-z0-9_]{2,21})\/comments\/([a-z0-9]{1,10})(?:\/|$)/i),shell=document.querySelector('[data-rt-ui="archive-subreddit"]');
    if(!match || !shell || shell.dataset.rtSubreddit?.toLowerCase()!==match[1].toLowerCase() || input.postId!==match[2].toLowerCase())throw Error('Open the matching archived thread.');
    const current=()=>!signal?.aborted && shell.isConnected && document.querySelector('[data-rt-ui="archive-subreddit"]')===shell && location.pathname.match(/^\/r\/([A-Za-z0-9_]{2,21})\/comments\/([a-z0-9]{1,10})(?:\/|$)/i)?.slice(1,3).join('/').toLowerCase()===match.slice(1,3).join('/').toLowerCase();
    const required=['shreddit-comment','shreddit-comment-action-row','shreddit-comment-share-button','faceplate-progress'];
    const specs=[...document.querySelectorAll('faceplate-loader')].filter(node=>/^(PdpStandardClientAssets|CommentActionRowFull|CommentShareMenu)_/.test(node.getAttribute('name') || '')).map(nativeModuleSpec).filter(Boolean);
    const controller=new AbortController();let timer,abort;
    try{
      await Promise.race([(async()=>{
        if(required.some(name=>!customElements.get(name)) && typeof window.SML?.load==='function')await Promise.all(specs.map(spec=>window.SML.load(spec.chunks,spec.prefix,'auto')));
        if(!current())throw Error('Page changed. Try again.');
        if(required.some(name=>!customElements.get(name)) && typeof window.SML?.load==='function'){
          const comment=[...shell.querySelectorAll('shreddit-comment[data-rt-ui="archive-thread-comment"]')].find(node=>/^t1_[a-z0-9]{1,10}$/.test(node.id) && node.getAttribute('thingid')===node.id && node.getAttribute('postid')==='t3_'+input.postId);
          if(comment){
            const url=new URL('/svc/shreddit/comment/'+comment.id,location.origin);url.searchParams.set('depth','0');url.searchParams.set('subredditName',match[1]);
            const response=await fetch(url.href,{method:'GET',credentials:'include',redirect:'error',headers:{Accept:'text/vnd.reddit.partial+html'},signal:controller.signal});
            if(!response.ok)throw Error('Reddit comment components could not be loaded.');
            const doc=new DOMParser().parseFromString(await boundedText(response),'text/html');
            if(!current() || !comment.isConnected || !shell.contains(comment))throw Error('Page changed. Try again.');
            const loaders=[...doc.querySelectorAll('faceplate-loader')].filter(node=>/^Comment\$1_[A-Za-z0-9_-]+$/.test(node.getAttribute('name') || '')).map(nativeModuleSpec).filter(Boolean);
            if(!loaders.length)throw Error('Reddit comment components are unavailable on this page.');
            await Promise.all(loaders.map(spec=>window.SML.load(spec.chunks,spec.prefix,'auto')));
          }
        }
        if(!current())throw Error('Page changed. Try again.');
        if(required.some(name=>!customElements.get(name)))throw Error('Reddit comment components are unavailable on this page.');
      })(),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Reddit comment components timed out.'));},10000);abort=()=>{controller.abort();reject(Error('Page changed. Try again.'));};signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();})]);
      return {loaded:true};
    }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }
  function refreshArchiveThread(input){
    const match=location.pathname.match(/^\/r\/([A-Za-z0-9_]{2,21})\/comments\/([a-z0-9]{1,10})(?:\/|$)/i),shell=document.querySelector('[data-rt-ui="archive-subreddit"]');
    if(!match || !shell || shell.dataset.rtSubreddit?.toLowerCase()!==match[1].toLowerCase() || input.postId!==match[2].toLowerCase())throw Error('Open the matching archived thread.');
    for(const node of shell.querySelectorAll('shreddit-comment[data-rt-ui="archive-thread-comment"]'))if(node.getAttribute('postid')==='t3_'+input.postId && typeof node.updateChildren==='function')node.updateChildren();
    return {refreshed:true};
  }
  async function renderSearchEmpty(input,signal){
    const context=route(),path=pageKey(),target=typeof input.target==='string' && /^rt-search-empty-[a-z0-9-]{1,60}$/i.test(input.target)?document.getElementById(input.target):null;
    if(location.protocol!=='https:' || !['reddit.com','www.reddit.com','new.reddit.com','sh.reddit.com'].includes(location.hostname) || !/\/search\/?$/.test(location.pathname) || !context?.username || !M.validateUsername(input.username) || context.username.toLowerCase()!==input.username.toLowerCase() || target?.dataset.rtUi!=='search-empty' || !target.closest('main'))throw Error('Open the matching profile search.');
    if(typeof customElements.get('faceplate-partial')?.prototype?._renderContent!=='function')return {deferred:true,retryAfterMs:250};
    const app=document.querySelector('shreddit-app'),now=Date.now(),key=context.username.toLowerCase();for(const [k,v] of emptySearchReads)if(v.app!==app || v.expires<=now)emptySearchReads.delete(k);
    let root=[...document.querySelectorAll('#empty-search-results')].find(node=>!node.closest('[data-rt-ui]'))?.cloneNode(true),cached=emptySearchReads.get(key);
    if(!root && cached)root=new DOMParser().parseFromString(cached.html,'text/html').body.firstElementChild;
    if(!root){
      if(now<cooldown || active>=2)return {deferred:true,retryAfterMs:Math.max(250,now<cooldown?cooldown-now:250)};
      const url=new URL('/user/'+encodeURIComponent(context.username)+'/search/',location.origin);url.searchParams.set('q','"rt-empty-'+crypto.randomUUID()+'"');url.searchParams.set('type','posts');url.searchParams.set('t','hour');
      active++;try{const response=await fetch(url.href,{credentials:'include',cache:'no-store',redirect:'error',headers:{Accept:'text/html'},signal});if(!response.ok)throw Error('Reddit could not load its empty search view (HTTP '+response.status+').');const doc=new DOMParser().parseFromString(await boundedText(response,6000000),'text/html');root=doc.querySelector('#empty-search-results');if(!root)throw Error('Reddit returned no native empty search view.');if(emptySearchReads.size>=4)emptySearchReads.delete(emptySearchReads.keys().next().value);emptySearchReads.set(key,{html:root.outerHTML,app,expires:now+300000});}finally{active--;}
    }
    if(signal?.aborted || pageKey()!==path || document.getElementById(input.target)!==target)throw Error('Page changed. Try again.');
    root.removeAttribute('id');root.removeAttribute('hidden');root.removeAttribute('data-rt-search-hidden');root.classList.remove('hidden');if(root.style.display==='none')root.style.removeProperty('display');
    const template=document.createElement('template');template.innerHTML='<faceplate-partial loading="programmatic" render-mode="contents" style="display:contents"></faceplate-partial>';const partial=template.content.firstElementChild;target.replaceChildren(partial);partial._renderContent(root.outerHTML);return {rendered:true};
  }
  async function renderControls(input,signal){
    const context=route(),path=pageKey(),target=typeof input.target==='string' && /^rt-controls-[a-z0-9-]{1,60}$/i.test(input.target)?document.getElementById(input.target):null;
    if(location.protocol!=='https:' || !['reddit.com','www.reddit.com','new.reddit.com','sh.reddit.com'].includes(location.hostname) || !context?.username || !M.validateUsername(input.username) || context.username.toLowerCase()!==input.username.toLowerCase() || target?.dataset.rtUi!=='profile-controls' || !target.closest('main'))throw Error('Open the matching public profile.');
    if(typeof customElements.get('faceplate-partial')?.prototype?._renderContent!=='function')return {deferred:true,retryAfterMs:250};
    const params=new URLSearchParams(location.search),sort=/\/search\/?$/.test(location.pathname)?'new':params.get('sort') || 'new',range=params.get('t') || 'all',view=params.get('feedViewType') || 'cardView';
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
    if(signal?.aborted || path!==pageKey() || !target.isConnected || document.getElementById(input.target)!==target)throw Error('Page changed. Try again.');
    for(const row of root.querySelectorAll('rpl-menu-item[href]')){const old=new URL(row.getAttribute('href'),location.origin);if(old.origin!==location.origin || old.pathname!=='/user/reddit/submitted/')throw Error('Unexpected native control destination.');const next=new URL(path,location.origin);if(/\/search\/?$/.test(location.pathname))next.search=location.search;for(const name of ['sort','t','feedViewType'])if(old.searchParams.has(name))next.searchParams.set(name,old.searchParams.get(name));if(old.searchParams.has('sort') && old.searchParams.get('sort')!=='top')next.searchParams.delete('t');row.setAttribute('href',next.pathname+next.search);}
    if(/\/comments\/?$/.test(location.pathname)){
      // The Comments tab gets the same Feed options trigger and menu Reddit renders
      // on Posts. Only the View section is dropped, because the Comments tab has
      // no Card/Compact choice (unless Reddit shows its own layout control here).
      if(!root.querySelector('button[aria-label="Feed options"]'))throw Error('Reddit returned no native feed trigger.');
      const nativeView=[...document.querySelectorAll('main [aria-label="View"],main [data-testid="feed-view-toggle"],main shreddit-layout-switcher')].some(node=>!node.closest('shreddit-feed,[data-rt-ui]'));
      const menu=root.querySelector('.main-menu-container');
      if(menu && !nativeView){let drop=false;for(const node of [...menu.children]){if(node.tagName==='DIV'){drop=node.textContent.trim().toLowerCase()==='view';if(drop)node.remove();}else if(drop&&node.matches('rpl-menu-item'))node.remove();}}
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
    // Profile comment cards no longer carry an author attribute; their poster line links the author first.
    const poster=comments?node.querySelector('[id^="poster-info-"] a[href^="/user/"]')?.getAttribute('href')?.match(/^\/user\/([\w-]{1,20})\/?$/)?.[1]:'';
    const author=node.getAttribute('author') || node.querySelector('shreddit-comment-action-row[author]')?.getAttribute('author') || poster || '';
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
      if(signal.aborted || pageKey()!==path)throw Error('Page changed. Try again.');
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
      // Reddit answers a comment its author deleted exactly like an ID that never existed: a small
      // shell with no comment card at all. Removed comments still get a card (body "[removed]").
      if(!doc.querySelector(selector)){
        if(!comments || doc.querySelector('shreddit-profile-comment,shreddit-comment') || text.length>65536)throw Error('Reddit returned no matching native card.');
        entry.size=text.length;entry.expires=Date.now()+30000;return {missing:true};
      }
      if(entry.controller.signal.aborted || pageKey()!==path)throw Error('Page changed. Try again.');
      entry.size=text.length;entry.expires=Date.now()+30000;return {text,url};
    })().finally(()=>{cardActive--;if(!comments)postCardActive--;entry.pending=false;if(!entry.size)nativeCardReads.delete(key);trimNativeReads(pageKey());});
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
      if(signal?.aborted || pageKey()!==path)throw Error('Page changed. Try again.');
      infoBlockedUntil=Date.now()+600000;return [];
    }finally{clearTimeout(infoTimer);controller.signal.removeEventListener('abort',link);}
    if(controller.signal.aborted || pageKey()!==path)throw Error('Page changed. Try again.');
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
    const context=route(),path=pageKey(),comments=input.kind==='comment';
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
            if(controller.signal.aborted || pageKey()!==path)throw Error('Page changed. Try again.');
            let status=knownStatus(path,comments,fullname,input.username);
            if(!status){
              fragmentReads=true;
              try{const fragment=await nativeFragment(comments,fullname,path,controller.signal);if(fragment.missing)status={fullname,status:'deleted',author:'[deleted]',over18:false,spoiler:false};else if(!fragment.deferred)status=nativeStatus(new DOMParser().parseFromString(fragment.text,'text/html'),comments,fullname,input.username);}
              catch{ /* A failed or missing fragment establishes no current status. */ }
            }
            if(controller.signal.aborted || pageKey()!==path)throw Error('Page changed. Try again.');
            if(status)remember(status);
          }
        }));
      })();
      try{await Promise.race([operation,new Promise(resolve=>{timer=setTimeout(()=>{timedOut=true;controller.abort();resolve();},10000);})]);}
      catch(error){if(!timedOut)throw error;}
      if(signal?.aborted || pageKey()!==path)throw Error('Page changed. Try again.');
      const verified=new Set(statuses.map(status=>status.fullname)),unknownIds=requestedIds.filter(id=>!verified.has(id));
      // "info" means no native fragment was needed for any ID, so the caller may use a larger batch.
      return {statuses,unknownIds,incomplete:unknownIds.length>0,...(timedOut?{timedOut:true}:{}),via:fragmentReads || unknownIds.length?'native':'info',source:'reddit'};
    }finally{active--;clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
  }
  async function renderCard(input,signal){
    const context=route(),path=pageKey(),comments=input.kind==='comment';
    if(location.protocol!=='https:' || !['reddit.com','www.reddit.com','new.reddit.com','sh.reddit.com'].includes(location.hostname))throw Error('Open a public Reddit profile.');
    if(!context?.username || !M.validateUsername(input.username) || context.username.toLowerCase()!==input.username.toLowerCase())throw Error('Profile changed. Try again.');
    if(!['post','comment'].includes(input.kind) || !(comments?M.validateCommentId(input.postId):M.validateId(input.postId)))throw Error('Invalid native card identity.');
    if(typeof input.target!=='string' || !/^rt-native-[a-z0-9-]{1,60}$/i.test(input.target))throw Error('Invalid native card target.');
    const fullname=(comments?'t1_':'t3_')+input.postId.toLowerCase().replace(/^t[13]_/,''),target=document.getElementById(input.target);
    if(!target?.isConnected || target.dataset.rtUi!=='activity-item' || target.dataset.rtNativeFullname!==fullname || !target.closest('main'))throw Error('Native card target is no longer available.');
    const selector=comments?`shreddit-profile-comment[comment-id="${fullname}"]`:`shreddit-post[id="${fullname}"]`;
    const alreadyPresent=()=>[...document.querySelectorAll(selector)].some(node=>!target.contains(node) && !node.closest('[data-rt-search-hidden]'));
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
        if(fragment.missing){rememberStatus(path,fullname,{fullname,status:'deleted',author:'[deleted]',over18:false,spoiler:false});throw Error('Reddit no longer has this comment.');}
        const {text,url}=fragment,doc=new DOMParser().parseFromString(text,'text/html');
        const evidence=nativeStatus(doc,comments,fullname,input.username);rememberStatus(path,fullname,evidence);
        if(pageKey()!==path || controller.signal.aborted || !target.isConnected || document.getElementById(input.target)!==target)throw Error('Page changed. Try again.');
        if(alreadyPresent())return {rendered:false,duplicate:true,fullname};
        // The authenticated HTML stays in Reddit's page world. Use its own trusted
        // fragment renderer so component modules, media and native actions hydrate.
        const partial=document.createElement('faceplate-partial');partial.loading='programmatic';partial.src=url.pathname+url.search;partial.renderMode='contents';
        target.replaceChildren(partial);partial._renderContent(text);
        if(!target.querySelector(selector))throw Error('Reddit could not attach its native card.');
        const tag=comments?'shreddit-profile-comment':'shreddit-post';
        await waitNative(customElements.whenDefined(tag),controller.signal);
        const native=target.querySelector(selector);if(native?.updateComplete)await waitNative(Promise.resolve(native.updateComplete),controller.signal);
        if(pageKey()!==path || controller.signal.aborted || !target.isConnected || document.getElementById(input.target)!==target || !native || !target.contains(native))throw Error('Page changed. Try again.');
        // The card Reddit just served is current evidence: report what it proves (available, deleted or removed).
        target.dataset.rtNativeState='ready';return {rendered:true,fullname,...(evidence?{status:evidence.status}:{})};
      })();
      const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Native card loading timed out.'));},10000);});
      return await Promise.race([operation,timeout]);
    }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
  }
  // Comment headshot of an archived comment's original author, from native
  // markup or the signed-out-safe user hover card. Only an HTTPS
  // URL on Reddit's image hosts leaves the page world; cache it per username.
  const avatarReads=new Map(),avatarHosts=new Set(['styles.redditmedia.com','i.redd.it','preview.redd.it','cf.preview.redd.it','www.redditstatic.com']);
  // The hover card offers a custom avatar as the full-body Snoovatar; Reddit's
  // comments use its headshot, published next to it as <id>-headshot.png.
  const headshotOf=value=>{try{const url=new URL(value);if(url.hostname==='i.redd.it' && /^\/snoovatar\/avatars\/[0-9a-z-]+\.png$/i.test(url.pathname) && !/-headshot\.png$/i.test(url.pathname)){url.pathname=url.pathname.replace(/\.png$/i,'-headshot.png');url.search='';return url.href;}}catch{}return value;};
  const safeAvatar=value=>{try{const url=new URL(value);return url.protocol==='https:' && !url.username && !url.password && avatarHosts.has(url.hostname) && (!url.pathname.includes('/snoovatar/avatars/') || /-headshot\.[a-z]+$/i.test(url.pathname))?url.href:'';}catch{return '';}};
  async function userAvatar(input,signal){
    if(!M.validateUsername(input.username))throw Error('Invalid username.');
    const name=input.username.toLowerCase(),now=Date.now(),cached=avatarReads.get(name);
    // Reuse a native comment headshot (including its signed preview query)
    // when this author already appears on the page. Never synthesize signatures.
    // A restored comment carries its archived author but still Reddit's placeholder avatar: never reuse it.
    for(const comment of document.querySelectorAll('shreddit-comment[author]:not([is-author-deleted])'))if(comment.getAttribute('author')?.toLowerCase()===name){const slot=comment.querySelector('[slot="commentAvatar"]');if(slot?.closest('shreddit-comment')!==comment)continue;for(const image of slot?.querySelectorAll('image[href],img[src]') || []){const url=safeAvatar(image.getAttribute('href') || image.getAttribute('src'));if(url)return {avatar:url};}}
    if(cached?.expires>now)return {avatar:cached.url};
    if(now<cooldown)return {deferred:true,retryAfterMs:cooldown-now};
    if(active>=2)return {deferred:true,retryAfterMs:250};
    const controller=new AbortController(),cancel=()=>controller.abort(),timer=setTimeout(cancel,8000);signal?.addEventListener('abort',cancel,{once:true});active++;
    try{
      // Reddit's hover card is served to signed-out visitors and is tiny; its
      // [avatar] image is the profile headshot. Deleted and suspended accounts
      // return a card without one. No /about.json: it is unavailable signed out.
      const response=await fetch(new URL('/svc/shreddit/user-hover-card/'+encodeURIComponent(input.username),location.origin).href,{method:'GET',credentials:'include',redirect:'error',headers:{Accept:'text/vnd.reddit.partial+html, text/html;q=0.9'},signal:controller.signal});
      if(response.status===429){const retry=Number(response.headers.get('retry-after'));cooldown=Date.now()+Math.max(1000,Math.min(3600000,(Number.isFinite(retry)&&retry>0?retry:60)*1000));return {deferred:true,retryAfterMs:cooldown-Date.now()};}
      let url='';
      if(response.ok){
        const doc=new DOMParser().parseFromString(await boundedText(response),'text/html'),headshot=[...doc.querySelectorAll('[avatar] image[href],[avatar] img[src]')],pool=headshot.length?headshot:[...doc.querySelectorAll('img[alt*="avatar" i][src]')];
        // The first safe headshot wins; a full-body Snoovatar is rejected by safeAvatar,
        // so an unavailable headshot keeps the native default.
        for(const img of pool){const candidate=safeAvatar(headshotOf(img.getAttribute('href') || img.getAttribute('src')));if(candidate){url=candidate;break;}}
      }
      if(avatarReads.size>=200)avatarReads.delete(avatarReads.keys().next().value);avatarReads.set(name,{url,expires:Date.now()+(response.ok?1800000:60000)});
      return {avatar:url};
    }finally{active--;clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
  }
  const ownLists=new Set(['saved','history','hidden','upvoted','downvoted','removed']);
  // The Removed list reads your own overview and keeps only the moderation facts Reddit gives the author
  // (docs/own-removal-detection-spec.md §4.1 E1). The content script classifies them with RTRemovalModel.
  const moderationOf=(raw,kind)=>{
    const text=(value,max)=>typeof value==='string'?value.slice(0,max):null;
    return {category:text(raw.removed_by_category,40),removalReason:Boolean(raw.removal_reason),locked:raw.locked===true,
      subredditType:text(raw.subreddit_type,40) || 'public',quarantined:raw.quarantine===true,authorBody:text(kind==='t1'?raw.body:raw.selftext,40000) ?? ''};
  };
  function ownListContext(input){
    const context=route();
    if(location.protocol!=='https:' || !['reddit.com','www.reddit.com','new.reddit.com','sh.reddit.com'].includes(location.hostname) || !context?.username || !M.validateUsername(input.username) || context.username.toLowerCase()!==input.username.toLowerCase())throw Error('Open your own Reddit profile to search your lists.');
    // Callers supply structured names/cursors, never a URL, method or headers.
    if(['url','origin','method','headers'].some(key=>input[key]!==undefined))throw Error('Invalid own-list request.');
    return context;
  }
  async function signedInUsername(signal){
    const native=globalThis.RTNativeRemoval?.identity(document);if(native)return native.username;
    const response=await fetch(new URL('/api/me.json',location.origin).href,{method:'GET',credentials:'include',cache:'no-store',redirect:'error',headers:{Accept:'application/json'},signal});
    if(!response.ok)throw Error(response.status===401 || response.status===403?'Sign in to Reddit to search your lists.':'Reddit could not verify your signed-in account (HTTP '+response.status+').');
    let data;try{data=JSON.parse(await boundedText(response));}catch{throw Error('Reddit could not verify your signed-in account.');}
    if(!M.validateUsername(data?.data?.name))throw Error('Sign in to Reddit to search your lists.');
    return data.data.name;
  }
  const communitySuggestions=new Map();
  async function readCommunitySuggestions(input,signal){
    if(typeof input.query!=='string' || input.query.length>50 || /[\u0000-\u001f\u007f]/.test(input.query) || ['url','origin','headers','method'].some(k=>input[k]!==undefined))throw Error('Invalid community search.');
    const query=input.query.trim().replace(/^\/?r\//i,''),username=await signedInUsername(signal),key=username.toLowerCase()+'|'+query.toLowerCase();
    const cached=communitySuggestions.get(key);if(cached?.expires>Date.now())return cached.value;
    let doc=document;
    const own=route()?.username?.toLowerCase()===username.toLowerCase() && document.querySelector('main shreddit-feed');
    if(query || !own){
      try{
      const url=new URL(query?'/svc/shreddit/search-typeahead':'/user/'+encodeURIComponent(username)+'/',location.origin);
      if(query){url.searchParams.set('query',query);url.searchParams.set('cId',crypto.randomUUID());url.searchParams.set('recentSearchesCount','0');url.searchParams.set('mode','search');}else url.searchParams.set('sort','new');
      const response=await fetch(url.href,{method:'GET',credentials:'include',cache:'no-store',redirect:'error',headers:{Accept:query?'text/vnd.reddit.partial+html, text/html;q=0.9':'text/html'},signal});
      if(!response.ok)throw Error('Reddit community suggestions are unavailable (HTTP '+response.status+').');
      doc=new DOMParser().parseFromString(await boundedText(response), 'text/html');
      if(!query && !doc.querySelector('shreddit-feed'))throw Error('Reddit returned no profile suggestions.');
      }catch(error){if(query || signal?.aborted)throw error;return {username,entries:[],source:'native-profile',unavailable:true};}
    }
    const counts=new Map(),add=name=>{if(!/^[A-Za-z0-9_]{2,21}$/.test(name || '') && !/^u_[A-Za-z0-9_-]{3,20}$/.test(name || ''))return;const k=name.toLowerCase(),old=counts.get(k);if(old)old.count++;else counts.set(k,{key:name,count:query?0:1});};
    if(query){
      for(const anchor of doc.querySelectorAll('a[href]')){try{const url=new URL(anchor.getAttribute('href'),location.origin),name=url.pathname.match(/^\/r\/([A-Za-z0-9_]{2,21})\/$/)?.[1];if(url.origin===location.origin && name && !counts.has(name.toLowerCase()))add(name);}catch{}}
    }else for(const card of doc.querySelectorAll('main shreddit-feed shreddit-post,main shreddit-feed shreddit-profile-comment')){
      if(card.closest('[data-rt-ui]'))continue;const author=card.getAttribute('author') || card.querySelector('[id^="poster-info-"] a[href*="/user/"]')?.getAttribute('href')?.match(/\/user\/([A-Za-z0-9_-]{3,20})\/?$/)?.[1];
      if(author?.toLowerCase()!==username.toLowerCase())continue;
      add((card.getAttribute('subreddit-name') || card.getAttribute('subreddit-prefixed-name') || (card.getAttribute('href') || card.getAttribute('permalink') || '').match(/^\/r\/([^/]+)\//)?.[1] || '').replace(/^r\//i,''));
    }
    const value={username,entries:[...counts.values()].slice(0,100),source:query?'reddit-search':'native-profile'};
    if(communitySuggestions.size>=50)communitySuggestions.delete(communitySuggestions.keys().next().value);communitySuggestions.set(key,{expires:Date.now()+300000,value});return value;
  }
  function historyListing(text){
    const doc=new DOMParser().parseFromString(text,'text/html'),cards=[...doc.querySelectorAll('main shreddit-post[id]')];
    if(cards.length>100 || !cards.length && !doc.querySelector('main #empty-feed-content,main [data-testid="empty-state"]'))throw Error('Reddit’s History format changed or History could not be loaded.');
    const posts=[],seen=new Set();
    for(const card of cards){
      const flag=name=>card.hasAttribute(name) && !['false','0'].includes(card.getAttribute(name));
      const post=M.normalizePost({id:card.id,author:card.getAttribute('author'),title:card.getAttribute('post-title') || card.querySelector('[slot="title"]')?.textContent,
        selftext:card.querySelector('[slot="text-body"],[id$="-post-rtjson-content"]')?.textContent || '',subreddit:card.getAttribute('subreddit-name'),
        created_utc:Date.parse(card.getAttribute('created-timestamp'))/1000,permalink:card.getAttribute('permalink'),url:card.getAttribute('content-href'),
        postType:card.getAttribute('post-type'),is_self:['text','textmedia'].includes(card.getAttribute('post-type')),over_18:flag('nsfw') || flag('is-nsfw'),spoiler:flag('spoiler'),
        score:Number(card.getAttribute('score')),num_comments:Number(card.getAttribute('comment-count')),link_flair_text:card.querySelector('[slot="post-flair"]')?.textContent});
      if(!post)throw Error('Reddit’s History format changed. Some recently viewed posts could not be read.');
      if(!seen.has(post.fullname)){seen.add(post.fullname);posts.push(post);}
    }
    return {posts,after:null,hasMore:false,scanned:cards.length,incomplete:true,source:'reddit'};
  }
  // Removed reads Overview, then the Posts tab, which reaches posts older than Overview's newest 1,000 items.
  const removalSource=input=>{if(input.source!=null && !['overview','posts'].includes(input.source))throw Error('Invalid native profile source.');return input.source || 'overview';};
  const removalFirstPage=(me,source)=>'/user/'+encodeURIComponent(me.username)+'/'+(source==='posts'?'submitted/':'')+'?sort=new';
  const removalPublicCursors=new Map(),removalCursors=new Map(),removalItems=new Map(),removalProofs=new Map(),removalPending=new Map();let removalOwner='',removalQueue=Promise.resolve();
  function removalScope(me){
    const key=me.owner+':'+me.username.toLowerCase();if(removalOwner!==key){removalCursors.clear();removalItems.clear();removalProofs.clear();removalOwner=key;}return key;
  }
  function rememberRemovalItem(post,me){
    const entry={fullname:post.fullname,username:me.username,owner:me.owner,kind:post.kind==='comment'?'comment':'post',expectsBody:Boolean(post.body?.trim()),originalNotice:M.noticeStatus(post.body),restricted:['private','employees_only','gold_restricted'].includes(post.moderation?.subredditType) || post.moderation?.quarantined===true,revision:JSON.stringify([post.moderation,post.body])};
    if(removalItems.size>=1000 && !removalItems.has(post.fullname))removalItems.delete(removalItems.keys().next().value);removalItems.set(post.fullname,entry);return entry;
  }
  async function readRemovalPublic(input,signal){
    const N=globalThis.RTNativeRemoval,me=N?.identity(document),path=pageKey();
    if(!me || input.owner!==me.owner || input.username?.toLowerCase()!==me.username.toLowerCase() || !/^t(?:1_[a-z0-9]{1,32}|3_[a-z0-9]{1,10})$/.test(input.fullname || '') || ['url','origin','method','headers'].some(k=>input[k]!==undefined))throw Error('Invalid own-item public check.');
    const scope=removalScope(me);
    for(const node of document.querySelectorAll('shreddit-post,shreddit-profile-comment,shreddit-comment')){
      if(![node.id,node.getAttribute('comment-id'),node.getAttribute('thingid')].includes(input.fullname))continue;const post=N.item(node,me);if(post)rememberRemovalItem(post,me);
    }
    const item=removalItems.get(input.fullname);if(!item || item.owner!==me.owner || item.username.toLowerCase()!==me.username.toLowerCase())throw Error('This item was not observed in your native activity.');
    if(item.restricted)return {proof:{fullname:item.fullname,status:'unknown',verified:false,source:'signed-out-native',why:'Public visibility cannot be checked for this private or quarantined community.',checkedAt:Date.now()}};
    const key=scope+':'+item.fullname,saved=removalProofs.get(key);
    if(input.refresh!==true && saved?.expires>Date.now() && saved.revision===item.revision)return {proof:saved.proof};
    const pendingKey=key+':'+path+':'+item.revision,running=removalPending.get(pendingKey);if(running && !running.signal?.aborted)return running.operation;
    const current=()=>{const value=N.identity(document);return !signal?.aborted && pageKey()===path && value?.owner===me.owner && value?.username.toLowerCase()===me.username.toLowerCase();};
    const operation=removalQueue.catch(()=>{}).then(async()=>{
      if(!current())throw Error('Account or page changed. Try again.');
      const url=new URL('/svc/shreddit/'+(item.kind==='comment'?'comment/':'partial-feed-post/')+item.fullname,location.origin);url.searchParams.set('isProfile','true');let proof;
      try{const html=await publicBrowserRead(url.href,signal,false);proof=N.publicItem(new DOMParser().parseFromString(html,'text/html'),item);}
      catch(error){if(!current())throw Error('Account or page changed. Try again.');proof={fullname:item.fullname,status:'unknown',verified:false,source:'signed-out-native',why:'Signed-out check unavailable: '+String(error.message || 'request failed').slice(0,200)};}
      if(!current())throw Error('Account or page changed. Try again.');proof.checkedAt=Date.now();
      if(removalProofs.size>=1000 && !removalProofs.has(key))removalProofs.delete(removalProofs.keys().next().value);removalProofs.set(key,{proof,revision:item.revision,expires:Date.now()+(proof.verified?600000:60000)});return {proof};
    });
    const pending={operation,signal};removalQueue=operation;removalPending.set(pendingKey,pending);try{return await operation;}finally{if(removalPending.get(pendingKey)===pending)removalPending.delete(pendingKey);}
  }
  // Your profile as a signed-out visitor sees it (spec §18), through the anonymous transport only: which items it
  // lists, for the Removed view's bulk visibility comparison. Continuations are only those this read handed out.
  async function readRemovalPublicProfile(input,signal){
    const N=globalThis.RTNativeRemoval,me=N?.identity(document),path=pageKey();
    if(!me || input.owner!==me.owner || input.username?.toLowerCase()!==me.username.toLowerCase() || ['url','origin','method','headers'].some(k=>input[k]!==undefined))throw Error('Invalid own signed-out profile read.');
    const source=removalSource(input),key=removalScope(me)+':'+source;
    if(input.after!=null && (typeof input.after!=='string' || removalPublicCursors.get(input.after)!==key))throw Error('Invalid signed-out profile continuation.');
    const url=new URL(input.after || removalFirstPage(me,source),location.origin);
    const html=await publicBrowserRead(url.href,signal,false),now=N.identity(document);
    if(signal?.aborted || pageKey()!==path || now?.owner!==me.owner || now?.username.toLowerCase()!==me.username.toLowerCase())throw Error('Account or page changed. Try again.');
    const value=N.publicListing(new DOMParser().parseFromString(html,'text/html'),me,{continuation:Boolean(input.after),source});
    if(value.after===input.after && value.after)throw Error('Reddit repeated the signed-out profile continuation.');
    if(value.after){if(removalPublicCursors.size>=1000)removalPublicCursors.delete(removalPublicCursors.keys().next().value);removalPublicCursors.set(value.after,key);}
    return value;
  }
  async function nativeRemovedList(input,signal){
    const N=globalThis.RTNativeRemoval,me=N?.identity(document),path=pageKey();
    if(!me)throw Error('Reddit’s signed-in account is not ready. Refresh this tab to retry.');
    const scope=removalScope(me);
    if(input.action==='own-list-identity')return {username:me.username};
    if(input.username?.toLowerCase()!==me.username.toLowerCase())throw Error('You can only check your own removed items.');
    const source=removalSource(input),key=scope+':'+source;
    if(input.after!=null && (typeof input.after!=='string' || removalCursors.get(input.after)!==key))throw Error('Invalid native profile continuation.');
    const url=new URL(input.after || removalFirstPage(me,source),location.origin);
    const response=await fetch(url.href,{method:'GET',credentials:'include',cache:'no-store',redirect:'error',headers:{Accept:input.after?'text/vnd.reddit.partial+html, text/html;q=0.9':'text/html'},signal});
    if(!response.ok)throw Error('Reddit could not load your native profile (HTTP '+response.status+').');
    const text=await boundedText(response,6000000),now=N.identity(document);
    if(signal?.aborted || pageKey()!==path || now?.owner!==me.owner || now?.username.toLowerCase()!==me.username.toLowerCase())throw Error('Account or page changed. Try again.');
    const value=N.listing(new DOMParser().parseFromString(text,'text/html'),me,source,{continuation:Boolean(input.after)});
    for(const post of value.posts)rememberRemovalItem(post,me);
    if(value.after===input.after && value.after)throw Error('Reddit repeated the native profile continuation.');
    if(value.after){if(removalCursors.size>=1000)removalCursors.delete(removalCursors.keys().next().value);removalCursors.set(value.after,key);}
    return value;
  }
  async function readOwnList(input,signal){
    ownListContext(input);
    if(input.list==='removed' || input.action==='own-list-identity' && new URLSearchParams(location.search).get('rt_list')==='removed')return nativeRemovedList(input,signal);
    if(input.action!=='own-list-identity' && (!ownLists.has(input.list) || input.list==='history' && input.after!=null || input.after!=null && (typeof input.after!=='string' || !/^t[13]_[a-z0-9]{1,32}$/i.test(input.after))))throw Error('Invalid own-list name or cursor.');
    const path=pageKey(),username=await signedInUsername(signal);
    if(signal.aborted || pageKey()!==path)throw Error('Page changed. Try again.');
    if(input.action==='own-list-identity')return {username};
    if(username.toLowerCase()!==input.username.toLowerCase())throw Error('You can only search your own lists. The signed-in account changed.');
    const url=new URL('/user/'+encodeURIComponent(username)+'/'+(input.list==='removed'?'overview':input.list)+(input.list==='history'?'/':'.json'),location.origin);
    if(input.list!=='history'){url.searchParams.set('limit','100');url.searchParams.set('raw_json','1');if(input.after)url.searchParams.set('after',input.after);}
    const response=await fetch(url.href,{method:'GET',credentials:'include',cache:'no-store',redirect:'error',headers:{Accept:input.list==='history'?'text/html':'application/json'},signal});
    if(!response.ok)throw Error(response.status===401?'Sign in to Reddit to search your lists.':response.status===403?'Reddit denied access to your '+input.list+' list (HTTP 403).':'Reddit could not load your '+input.list+' list (HTTP '+response.status+').');
    const text=await boundedText(response);
    if(signal.aborted || pageKey()!==path)throw Error('Page changed. Try again.');
    if(input.list==='history')return historyListing(text);
    let data;try{data=JSON.parse(text);}catch{throw Error('Reddit returned an unexpected own-list response.');}
    const listing=data?.data;
    if(data.kind!=='Listing' || !Array.isArray(listing?.children) || listing.children.length>100 || listing.after!=null && !/^t[13]_[a-z0-9]{1,32}$/i.test(listing.after))throw Error('Reddit returned an unexpected own-list listing.');
    const posts=listing.children.map(item=>item.kind==='t3'?M.normalizePost(item.data):item.kind==='t1' && ['saved','removed'].includes(input.list)?M.normalizeComment(item.data):null);
    if(input.list==='removed')listing.children.forEach((item,index)=>{const post=posts[index];if(post){
      // Only the signed-in author's own items are classified (spec §7); anything else is a malformed page.
      if(post.author.toLowerCase()!==username.toLowerCase())posts[index]=null;else post.moderation=moderationOf(item.data,item.kind);}});
    // A malformed item is an explicit partial load, never silent exhaustion.
    if(posts.some(post=>!post))throw Error('Some '+input.list+' items could not be read. The list search is incomplete.');
    return {posts,after:listing.after || null,hasMore:Boolean(listing.after),scanned:listing.children.length,incomplete:true,source:'reddit'};
  }
  // "Not yet approved" filter (docs/unmoderated-filter-spec.md): moderator check and the Unmoderated queue for the
  // community this page shows. Fixed same-origin paths, the reader's own session, read-only.
  const communityName=/^[A-Za-z0-9_]{2,21}$/;
  function modContext(input){
    const page=location.pathname.match(/^\/r\/([A-Za-z0-9_]{2,21})(?:\/(?:hot|new|top|rising|best))?\/?$/i);
    if(location.protocol!=='https:' || !['reddit.com','www.reddit.com','new.reddit.com','sh.reddit.com'].includes(location.hostname) || !page || !communityName.test(input.subreddit || '') || page[1].toLowerCase()!==input.subreddit.toLowerCase())throw Error('Open the community’s feed to check its moderation queue.');
    if(['url','origin','method','headers'].some(key=>input[key]!==undefined))throw Error('Invalid moderation request.');
    return page[1];
  }
  async function modJson(path,params,signal){
    const url=new URL(path,location.origin);for(const [key,value] of Object.entries(params))url.searchParams.set(key,value);
    const response=await fetch(url.href,{method:'GET',credentials:'include',cache:'no-store',redirect:'error',headers:{Accept:'application/json'},signal});
    if(!response.ok)throw Object.assign(Error(response.status===403 || response.status===401?'Reddit says you don’t moderate this community.':'Reddit could not load the moderation queue (HTTP '+response.status+').'),{status:response.status});
    try{return JSON.parse(await boundedText(response));}catch{throw Error('Reddit returned an unexpected moderation response.');}
  }
  async function readModeration(input,signal){
    const name=modContext(input),path=pageKey();
    if(input.action==='mod-status'){
      const data=await modJson('/r/'+name+'/about.json',{raw_json:'1'},signal);
      if(signal.aborted || pageKey()!==path)throw Error('Page changed. Try again.');
      return {moderator:data?.data?.user_is_moderator===true,subreddit:typeof data?.data?.display_name==='string' && communityName.test(data.data.display_name)?data.data.display_name:name};
    }
    if(input.after!=null && (typeof input.after!=='string' || !/^t3_[a-z0-9]{1,10}$/i.test(input.after)))throw Error('Invalid moderation queue cursor.');
    const params={limit:'100',only:'links',raw_json:'1'};if(input.after)params.after=input.after;
    const data=await modJson('/r/'+name+'/about/unmoderated.json',params,signal),listing=data?.data;
    if(signal.aborted || pageKey()!==path)throw Error('Page changed. Try again.');
    if(data?.kind!=='Listing' || !Array.isArray(listing?.children) || listing.children.length>100 || listing.after!=null && !/^t3_[a-z0-9]{1,10}$/i.test(listing.after))throw Error('Reddit returned an unexpected moderation queue.');
    const posts=listing.children.filter(item=>item?.kind==='t3').map(item=>M.normalizePost(item.data));
    if(posts.some(post=>!post))throw Error('Some queued posts could not be read.');
    return {posts:posts.filter(post=>post.subreddit.toLowerCase()===name.toLowerCase()),after:listing.after || null,hasMore:Boolean(listing.after)};
  }
  // Raffles (docs/raffle-spec.md): comments of one post and account facts, read with the reader's session.
  const raffleId=/^[a-z0-9]{1,10}$/i,raffleComment=/^[a-z0-9]{1,32}$/i;
  const raffleEntry=(raw,postId)=>{
    if(!raw || typeof raw!=='object' || !raffleComment.test(raw.id || ''))return null;
    return {id:raw.id.toLowerCase(),author:typeof raw.author==='string'?raw.author.slice(0,20):'',created_utc:Number(raw.created_utc) || 0,parent_id:typeof raw.parent_id==='string'?raw.parent_id.slice(0,40):'',
      body:typeof raw.body==='string'?raw.body.slice(0,2000):'',permalink:typeof raw.permalink==='string' && raw.permalink.startsWith('/')?raw.permalink.slice(0,300):'/comments/'+postId+'/comment/'+raw.id+'/',removed_by_category:raw.removed_by_category ?? null};
  };
  // Winners' comments for a public draw. Reddit refuses /api/info.json on www.reddit.com (HTTP 403, measured
  // 2026-11-15), so each winner's comment is read from its permalink JSON, three at a time; one failure skips
  // only that comment.
  async function raffleWinnerComments(input,signal){
    if(!raffleId.test(input.postId || '') || !Array.isArray(input.ids) || !input.ids.length || input.ids.length>100 || !input.ids.every(id=>typeof id==='string' && raffleComment.test(id)))throw Error('Invalid winner comments.');
    const postId=input.postId.toLowerCase(),ids=[...new Set(input.ids.map(id=>id.toLowerCase()))],entries=[];let failures=0;
    const one=async id=>{
      const url=new URL('/comments/'+postId+'/_/'+id+'.json',location.origin);for(const [k,v] of Object.entries({depth:'1',limit:'1',raw_json:'1'}))url.searchParams.set(k,v);
      try{
        const response=await fetch(url.href,{method:'GET',credentials:'include',cache:'no-store',redirect:'error',headers:{Accept:'application/json'},signal});
        if(!response.ok)throw Error('HTTP '+response.status);
        const data=JSON.parse(await boundedText(response,2000000)),child=(data?.[1]?.data?.children || []).find(c=>c?.kind==='t1' && String(c.data?.id).toLowerCase()===id);
        if(child && String(child.data?.link_id).toLowerCase()==='t3_'+postId){const entry=raffleEntry(child.data,postId);if(entry)entries.push(entry);}
      }catch(error){if(signal?.aborted)throw error;failures++;}
    };
    for(let i=0;i<ids.length;i+=3)await Promise.all(ids.slice(i,i+3).map(one));
    if(failures===ids.length)throw Error('Reddit could not read the winner comments.');
    return {entries};
  }

  async function raffleMe(signal){
    try{return {username:await signedInUsername(signal)};}catch{return {username:''};}
  }
  async function raffleThread(input,signal){
    if(!raffleId.test(input.postId || ''))throw Error('Invalid post.');
    const postId=input.postId.toLowerCase(),url=new URL('/comments/'+postId+'.json',location.origin);
    for(const [k,v] of Object.entries({limit:'500',sort:'old',raw_json:'1',...(input.topLevelOnly===false?{}:{depth:'1'})}))url.searchParams.set(k,v);
    const response=await fetch(url.href,{method:'GET',credentials:'include',cache:'no-store',redirect:'error',headers:{Accept:'application/json'},signal});
    if(!response.ok)throw Error('Reddit could not load the comments (HTTP '+response.status+').');
    let data;try{data=JSON.parse(await boundedText(response,12000000));}catch(error){throw Error(/too large/.test(error.message)?error.message:'Reddit returned unexpected comments.');}
    const post=data?.[0]?.data?.children?.[0]?.data,listing=data?.[1]?.data;
    if(!post || String(post.id).toLowerCase()!==postId || !Array.isArray(listing?.children))throw Error('Reddit returned unexpected comments.');
    const entries=[],missingTopLevel=[];let missingReplies=0;
    const walk=children=>{for(const child of children || []){
      if(child?.kind==='t1'){const entry=raffleEntry(child.data,postId);if(entry)entries.push(entry);walk(child.data?.replies?.data?.children);}
      else if(child?.kind==='more'){const ids=(Array.isArray(child.data?.children)?child.data.children:[]).filter(id=>raffleComment.test(id));
        if(String(child.data?.parent_id).toLowerCase()==='t3_'+postId)missingTopLevel.push(...ids.map(id=>id.toLowerCase()));else missingReplies+=Math.max(ids.length,Number(child.data?.count) || 0);}
    }};walk(listing.children);
    return {post:{id:postId,author:typeof post.author==='string'?post.author:'',title:typeof post.title==='string'?post.title.slice(0,300):'',subreddit:typeof post.subreddit==='string'?post.subreddit:'',numComments:Number(post.num_comments) || 0,permalink:typeof post.permalink==='string'?post.permalink:''},
      entries,missingTopLevel:[...new Set(missingTopLevel)].slice(0,20000),missingReplies};
  }
  // Comments beyond the thread JSON, read with the same requests Reddit's own client makes (measured 2026-11-14,
  // artifacts/research/verify/raffle/FINDINGS.md): the comments partial for the first page, then the
  // "more comments" POST with its cursor and the page's csrf_token cookie. Works from any Reddit page.
  // One page per call; the answer lists the next loaders (top-level and "more replies") for the caller to follow.
  const reddittImage=url=>{const safe=M.avatarUrl(url);try{return safe && /(?:^|\.)(?:redditstatic\.com|redditmedia\.com|redd\.it)$/.test(new URL(safe).hostname)?safe:'';}catch{return '';}};
  const deepAll=(root,selector,acc=[])=>{for(const el of root.querySelectorAll(selector))acc.push(el);for(const t of root.querySelectorAll('template'))deepAll(t.content,selector,acc);return acc;};
  async function raffleTree(input,signal){
    if(!raffleId.test(input.postId || '') || !communityName.test(input.subreddit || ''))throw Error('Invalid post.');
    if(['url','origin','method','headers'].some(key=>input[key]!==undefined))throw Error('Invalid comment request.');
    const postId=input.postId.toLowerCase(),sub=input.subreddit;
    // Reddit's cursor grows ~700 characters per page (measured: 3,428 after six pages), so it is bounded generously.
    const path=new RegExp('^/svc/shreddit/more-comments/r/'+sub+'/t3_'+postId+'\\?[^#\\s]{0,600}$','i');
    const valid=l=>l && typeof l.src==='string' && typeof l.cursor==='string' && l.cursor.length>0 && l.cursor.length<=200000 && path.test(l.src);
    const accept='text/vnd.reddit.partial+html, text/html;q=0.9';let response;
    if(input.loader==null){
      const url=new URL('/svc/shreddit/comments/r/'+sub+'/'+postId,location.origin);for(const [k,v] of Object.entries({sort:'old','seeker-session':'true','render-mode':'partial'}))url.searchParams.set(k,v);
      response=await fetch(url.href,{method:'GET',credentials:'include',cache:'no-store',redirect:'error',headers:{Accept:accept},signal});
    }else{
      if(!valid(input.loader))throw Error('Invalid comment loader.');
      const csrf=decodeURIComponent((document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/) || [])[1] || '');
      response=await fetch(new URL(input.loader.src,location.origin).href,{method:'POST',credentials:'include',cache:'no-store',redirect:'error',headers:{Accept:accept,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({cursor:input.loader.cursor,csrf_token:csrf}),signal});
    }
    if(response.status===429){const seconds=Number(response.headers.get('retry-after'));return {entries:[],loaders:[],rateLimited:true,retryAfterMs:Number.isFinite(seconds)?Math.min(300000,seconds*1000):30000};}
    if(!response.ok)throw Error('Reddit could not load the comments (HTTP '+response.status+').');
    const doc=new DOMParser().parseFromString(await boundedText(response,8000000),'text/html');
    const entries=[],ids=new Set();
    for(const node of deepAll(doc,'shreddit-comment[thingid]')){
      const id=String(node.getAttribute('thingid')).toLowerCase().replace(/^t1_/,'');if(!raffleComment.test(id) || ids.has(id))continue;ids.add(id);
      const depth=Number(node.getAttribute('depth'));const body=node.querySelector('[slot="comment"]'),paras=body?[...body.querySelectorAll('p,li,blockquote,h1,h2,h3,pre')].filter(el=>!el.parentElement.closest('p,li,blockquote,pre')):[];
      const text=(paras.length?paras.map(el=>el.textContent.replace(/\s+/g,' ').trim()).filter(Boolean).join('\n'):String(body?.textContent || '').replace(/\s+/g,' ').trim()).slice(0,2000);
      const link=String(node.getAttribute('permalink') || '');
      entries.push({id,author:String(node.getAttribute('author') || '').slice(0,20),created_utc:Math.floor(Date.parse(node.getAttribute('created') || '')/1000) || 0,parent_id:depth===0?'t3_'+postId:'t1_',
        body:text,permalink:link.startsWith('/')?link.slice(0,300):'/comments/'+postId+'/comment/'+id+'/',avatar:reddittImage(node.getAttribute('avatar')),score:Number(node.getAttribute('score')) || 0,
        removed_by_category:/^(?:\[deleted\]|\[removed\])$/.test(text) || node.hasAttribute('is-comment-deleted') || node.hasAttribute('deleted')?'unknown':null});
    }
    const loaders=deepAll(doc,'faceplate-partial[src*="more-comments"]').map(p=>({src:p.getAttribute('src') || '',cursor:p.querySelector('input[name="cursor"]')?.value || ''})).filter(valid).map(l=>({...l,topLevel:/(?:^|[?&])top-level=1(?:&|$)/.test(l.src.split('?')[1] || '')}));
    return {entries,loaders};
  }
  // Messaging raffle winners (docs/raffle-spec.md §B7) through Reddit's own chat client, which Reddit preloads
  // (hidden) on every page: the same calls its composer makes (FINDINGS.md, 2026-11-15). Only accounts this page
  // resolved for a raffle (raffle-user) can be messaged, at most 100 per send; the chat token stays in Reddit's client.
  const chatRecipients=new Map();
  function chatClient(){
    const walk=(root,depth=0)=>{for(const el of root.querySelectorAll('rs-matrix-client'))if(el.client)return el.client;if(depth>6)return null;
      for(const el of root.querySelectorAll('*'))if(el.shadowRoot){const found=walk(el.shadowRoot,depth+1);if(found)return found;}return null;};
    const client=walk(document);
    return client && typeof client.createRoom==='function' && typeof client.sendTextMessage==='function' && /^@t2_[a-z0-9]+:reddit\.com$/i.test(client.getUserId?.() || '')?client:null;
  }
  const mxid=id=>'@t2_'+id+':reddit.com';
  const chatError=error=>{const code=String(error?.data?.errcode || error?.errcode || error?.data?.error || error?.message || '');
    if(/rate\.score_room_creation_limit/.test(code) || error?.httpStatus===429)return {sent:false,rateLimited:true,reason:'Reddit limits how many new chats you can start. Try the rest later.'};
    if(/feature_gated/.test(code))return {sent:false,reason:'Reddit doesn’t allow you to start chats right now.'};
    return {sent:false,reason:'Reddit refused the chat'+(code?' ('+code.slice(0,120)+')':'')+'.'};};
  const roomReady=(client,roomId,ms=15000)=>client.getRoom(roomId)?Promise.resolve():new Promise(resolve=>{let timer;const done=()=>{if(client.getRoom(roomId)){clearTimeout(timer);client.off?.('Room',done);resolve();}};timer=setTimeout(()=>{client.off?.('Room',done);resolve();},ms);client.on?.('Room',done);});
  const chatText=text=>typeof text==='string' && text.trim().length>0 && text.length<=10000;
  async function chatStatus(){
    const client=chatClient();if(!client)return {ready:false};
    return {ready:true,syncing:['SYNCING','PREPARED'].includes(client.getSyncState?.()),self:String(client.getUserId()).replace(/^@t2_|:reddit\.com$/g,'')};
  }
  async function chatSend(input){
    if(['url','origin','method','headers'].some(key=>input[key]!==undefined) || typeof input.userId!=='string' || !chatRecipients.has(input.userId) || !chatText(input.text))throw Error('Invalid chat request.');
    const client=chatClient();if(!client)throw Error('Reddit chat isn’t available on this page. Reload the page and try again.');
    const target=mxid(input.userId);if(target===client.getUserId())throw Error('You can’t message yourself.');
    let roomId='',existing=false;
    try{roomId=(await client.getRoomList?.({with_user:target,type:'direct',include:{state:true,timeline:true}}))?.rooms?.[0]?.room_id || '';existing=Boolean(roomId);}catch{}
    if(!roomId){
      try{roomId=(await client.createRoom({preset:'reddit_dm',invite:[target]}))?.room_id || '';}
      catch(error){const known=error?.data?.['com.reddit.existing_room_id'];if(typeof known==='string' && known.startsWith('!')){roomId=known;existing=true;}else return chatError(error);}
    }
    if(!roomId)return {sent:false,reason:'Reddit didn’t return a chat for this user.'};
    await roomReady(client,roomId);
    try{await client.sendTextMessage(roomId,null,input.text,client.makeTxnId?.());}catch(error){return chatError(error);}
    return {sent:true,existing,roomId};
  }
  async function chatGroup(input){
    const ids=Array.isArray(input.userIds)?[...new Set(input.userIds)]:[];
    if(['url','origin','method','headers'].some(key=>input[key]!==undefined) || !ids.length || ids.length>100 || !ids.every(id=>typeof id==='string' && chatRecipients.has(id)) || !chatText(input.text) || typeof input.name!=='string' || input.name.length>64)throw Error('Invalid chat request.');
    const client=chatClient();if(!client)throw Error('Reddit chat isn’t available on this page. Reload the page and try again.');
    const targets=ids.map(mxid).filter(id=>id!==client.getUserId());if(!targets.length)throw Error('There is no one else to message.');
    let roomId;try{roomId=(await client.createRoom({name:input.name.trim() || undefined,preset:'private_chat',visibility:'private',invite:targets.slice(0,10)}))?.room_id;}catch(error){return chatError(error);}
    if(!roomId)return {sent:false,reason:'Reddit didn’t create the group chat.'};
    const failedInvites=[];for(const target of targets.slice(10)){try{await client.invite(roomId,target);}catch{failedInvites.push(target.replace(/^@t2_|:reddit\.com$/g,''));}}
    await roomReady(client,roomId);
    try{await client.sendTextMessage(roomId,null,input.text,client.makeTxnId?.());}catch(error){return {...chatError(error),roomId,failedInvites};}
    return {sent:true,roomId,failedInvites};
  }
  async function raffleUser(input,signal){
    if(!M.validateUsername(input.username))throw Error('Invalid username.');
    const response=await fetch(new URL('/user/'+encodeURIComponent(input.username)+'/about.json?raw_json=1',location.origin).href,{method:'GET',credentials:'include',cache:'no-store',redirect:'error',headers:{Accept:'application/json'},signal});
    if(response.status===404 || response.status===403)return {unavailable:true};
    if(!response.ok)throw Error('Reddit could not load u/'+input.username+' (HTTP '+response.status+').');
    let data;try{data=JSON.parse(await boundedText(response))?.data;}catch{throw Error('Reddit returned an unexpected profile.');}
    if(!data || data.is_suspended===true)return {suspended:true};
    const userId=typeof data.id==='string' && /^[a-z0-9]{1,13}$/i.test(data.id)?data.id.toLowerCase():'';if(userId)chatRecipients.set(userId,input.username);
    const commentAvatar=value=>safeAvatar(headshotOf(String(value || '').replace(/&amp;/g,'&')));
    return {userId,created:Number(data.created_utc) || 0,commentKarma:Number(data.comment_karma) || 0,postKarma:Number(data.link_karma) || 0,avatar:commentAvatar(data.icon_img) || commentAvatar(data.snoovatar_img)};
  }
  // Redaction (docs/redaction-spec.md): writes only to items this page read from the signed-in account's own lists.
  // The modhash stays here, in the page world; the extension's other scripts never receive it.
  const redaction={username:'',modhash:'',allowed:new Map(),cursors:new Map(),dirty:false};
  const redactSources={overview:['new'],submitted:['new','top','controversial'],comments:['new','top','controversial']};
  async function redactIdentity(signal){
    const response=await fetch(new URL('/api/me.json',location.origin).href,{method:'GET',credentials:'include',cache:'no-store',redirect:'error',headers:{Accept:'application/json'},signal});
    if(!response.ok)throw Error(response.status===401 || response.status===403?'Sign in to Reddit to redact your posts and comments.':'Reddit could not confirm your account (HTTP '+response.status+').');
    let data;try{data=JSON.parse(await boundedText(response))?.data;}catch{throw Error('Reddit could not confirm your account.');}
    if(!M.validateUsername(data?.name))throw Error('Sign in to Reddit to redact your posts and comments.');
    if(redaction.username && redaction.username.toLowerCase()!==data.name.toLowerCase()){redaction.allowed.clear();redaction.cursors.clear();redaction.dirty=false;}
    redaction.username=data.name;redaction.modhash=typeof data.modhash==='string' && /^[a-z0-9]{10,100}$/i.test(data.modhash)?data.modhash:'';
    return {username:data.name,canWrite:Boolean(redaction.modhash)};
  }
  function redactNativePage(root,source){
    const feed=root.querySelector('shreddit-feed') || root,items=[];let unread=0;
    const wanted=source==='comments'?'shreddit-profile-comment':source==='submitted'?'shreddit-post':'shreddit-post,shreddit-profile-comment';
    for(const card of feed.querySelectorAll(wanted)){
      if(card.closest('[data-rt-ui]'))continue;
      try{
      const comment=card.tagName==='SHREDDIT-PROFILE-COMMENT',fullname=card.getAttribute(comment?'comment-id':'id');
      const author=comment?card.querySelector('[id^="poster-info-"] a[href*="/user/"]')?.getAttribute('href')?.match(/\/user\/([A-Za-z0-9_-]{3,20})\/?$/)?.[1]:card.getAttribute('author');
      if(!author)throw Error('A native profile author could not be verified.');
      if(author.toLowerCase()!==redaction.username.toLowerCase())continue;
      if(!(comment?/^t1_[a-z0-9]{1,32}$/i:/^t3_[a-z0-9]{1,32}$/i).test(fullname || ''))throw Error('A native profile item could not be read.');
      const action=card.querySelector('shreddit-comment-action-row'),href=card.getAttribute('permalink') || card.getAttribute('href') || action?.getAttribute('permalink') || '';
      let url;try{url=new URL(href,location.origin);}catch{}
      const profile=url?.pathname.match(/^\/user\/([A-Za-z0-9_-]{3,20})\/comments\//)?.[1];
      const subreddit=url?.pathname.match(/^\/r\/([A-Za-z0-9_]{2,21})\/comments\//)?.[1] || (profile?.toLowerCase()===redaction.username.toLowerCase()?'u_'+profile:'');
      const created=Date.parse(card.getAttribute('created-timestamp') || card.querySelector('faceplate-timeago[ts]')?.getAttribute('ts') || card.querySelector('time[datetime]')?.getAttribute('datetime'))/1000;
      const content=card.querySelector(comment?'.md':'[slot="text-body"]');
      if(!subreddit || url.origin!==location.origin || !Number.isFinite(created) || comment && !content)throw Error('A native profile item is incomplete.');
      const paragraphs=[...content?.querySelectorAll('p') || []],body=(paragraphs.length?paragraphs.map(p=>p.textContent.trim()).join('\n\n'):content?.textContent?.trim() || '');
      const score=Number((comment?action:card)?.getAttribute('score'));
      if(!(comment?action:card)?.hasAttribute('score') || !Number.isFinite(score))throw Error('A native profile score could not be read.');
      const item={fullname:fullname.toLowerCase(),kind:comment?'comment':'post',subreddit,created,score,body:body.slice(0,100000),title:(card.getAttribute('post-title') || card.querySelector('h2')?.textContent || '').trim().slice(0,300),
        isSelf:!comment && (card.getAttribute('post-type')==='text' || Boolean(content)),permalink:url.pathname+url.search,deleted:body==='[deleted]',pinned:card.hasAttribute('stickied') || card.getAttribute('is-stickied')==='true'};
      redaction.allowed.set(item.fullname,item.kind);items.push(item);
      }catch{unread++; /* Keep readable authored items; skipped cards never enter the write allow-list. */}
    }
    let after=null;
    const view=source==='submitted'?'posts':source;
    for(const partial of feed.querySelectorAll('faceplate-partial[src*="/svc/shreddit/profiles/"]')){
      const url=new URL(partial.getAttribute('src'),location.origin);
      if(!url.pathname.includes('more-posts'))continue;
      if(url.origin!==location.origin || url.pathname!=='/svc/shreddit/profiles/profile_'+view+'-more-posts/new/' || url.searchParams.get('name')?.toLowerCase()!==redaction.username.toLowerCase() || url.href.length>2048)throw Error('Reddit’s native profile continuation changed.');
      after=url.pathname+url.search;redaction.cursors.set(after,source);break;
    }
    return {items,after,hasMore:Boolean(after),scanned:items.length+unread,unread,transport:'native-profile'};
  }
  async function redactNativeList(input,signal){
    if(input.sort!=='new')throw Error('Native profile discovery requires newest first.');
    let url;
    if(input.after!=null){
      if(typeof input.after!=='string' || redaction.cursors.get(input.after)!==input.source)throw Error('Invalid native profile cursor.');
      url=new URL(input.after,location.origin);
    }else{
      const path='/user/'+encodeURIComponent(redaction.username)+'/'+(input.source==='overview'?'':input.source+'/');
      // Reuse the actual signed-in profile only when it still contains its newest native page.
      const current=location.pathname.replace(/\/$/,'').toLowerCase()===path.replace(/\/$/,'').toLowerCase(),params=new URLSearchParams(location.search);
      if(!redaction.dirty && current && (!params.get('sort') || params.get('sort')==='new') && ![...params.keys()].some(k=>k.startsWith('rt_')) && !document.querySelector('shreddit-feed .virtualized-placeholder') && document.querySelector('shreddit-feed shreddit-post,shreddit-feed shreddit-profile-comment'))return redactNativePage(document,input.source);
      url=new URL(path,location.origin);url.searchParams.set('sort','new');
    }
    const response=await fetch(url.href,{method:'GET',credentials:'include',cache:'no-store',redirect:'error',headers:{Accept:input.after?'text/vnd.reddit.partial+html, text/html;q=0.9':'text/html'},signal});
    if(!response.ok)throw Error('Reddit could not load your native '+input.source+' profile (HTTP '+response.status+').');
    const text=await boundedText(response,6000000),doc=new DOMParser().parseFromString(text,'text/html');
    if(!input.after && !doc.querySelector('shreddit-feed'))throw Error('Reddit returned no native profile feed.');
    if(input.after && /<(?:html|body)\b/i.test(text) && !doc.querySelector('shreddit-feed,shreddit-post,shreddit-profile-comment'))throw Error('Reddit returned an unexpected native profile page.');
    return redactNativePage(doc,input.source);
  }
  async function redactList(input,signal){
    if(!redaction.username || input.username!==redaction.username)throw Error('Confirm your account first.');
    if(!Object.hasOwn(redactSources,input.source) || !redactSources[input.source].includes(input.sort))throw Error('Invalid list.');
    if(input.native===true)return redactNativeList(input,signal);
    if(input.after!=null && (typeof input.after!=='string' || !/^t[13]_[a-z0-9]{1,32}$/i.test(input.after)))throw Error('Invalid list cursor.');
    const url=new URL('/user/'+encodeURIComponent(redaction.username)+'/'+input.source+'.json',location.origin);
    for(const [k,v] of Object.entries({sort:input.sort,limit:'100',raw_json:'1',...(input.sort==='new'?{}:{t:'all'}),...(input.after?{after:input.after}:{})}))url.searchParams.set(k,v);
    const response=await fetch(url.href,{method:'GET',credentials:'include',cache:'no-store',redirect:'error',headers:{Accept:'application/json'},signal});
    if(!response.ok)throw Error('Reddit could not list your '+(input.source==='overview'?'posts and comments':input.source==='submitted'?'posts':'comments')+' (HTTP '+response.status+').');
    let data;try{data=JSON.parse(await boundedText(response,6000000));}catch{throw Error('Reddit returned an unexpected list.');}
    const listing=data?.data;
    if(data?.kind!=='Listing' || !Array.isArray(listing?.children) || listing.children.length>100 || listing.after!=null && !/^t[13]_[a-z0-9]{1,32}$/i.test(listing.after))throw Error('Reddit returned an unexpected list.');
    const items=[];
    for(const child of listing.children){
      const raw=child?.data;if(!raw || !['t1','t3'].includes(child.kind) || typeof raw.id!=='string' || !/^[a-z0-9]{1,32}$/i.test(raw.id))continue;
      // Your own lists only ever hold your items; anything else is skipped and never becomes writable.
      if(String(raw.author).toLowerCase()!==redaction.username.toLowerCase())continue;
      const kind=child.kind==='t1'?'comment':'post',fullname=child.kind+'_'+raw.id.toLowerCase(),body=kind==='comment'?raw.body:raw.selftext;
      const item={fullname,kind,subreddit:typeof raw.subreddit==='string'?raw.subreddit:'',created:Number(raw.created_utc) || 0,score:Number(raw.score) || 0,
        title:kind==='post' && typeof raw.title==='string'?raw.title.slice(0,300):(typeof raw.link_title==='string'?raw.link_title.slice(0,300):''),body:typeof body==='string'?body.slice(0,100000):'',
        isSelf:kind==='post'?raw.is_self===true:undefined,permalink:typeof raw.permalink==='string' && raw.permalink.startsWith('/')?raw.permalink.slice(0,300):'',deleted:body==='[deleted]' || raw.removed_by_category==='deleted'};
      if(redaction.allowed.size<50000 || redaction.allowed.has(fullname))redaction.allowed.set(fullname,kind);items.push(item);
    }
    return {items,after:listing.after || null,hasMore:Boolean(listing.after),scanned:listing.children.length};
  }
  async function redactItem(input,signal){
    if(!['overwrite','delete'].includes(input.step) || typeof input.fullname!=='string' || !/^t[13]_[a-z0-9]{1,32}$/.test(input.fullname))throw Error('Invalid redaction request.');
    if(['url','origin','method','headers'].some(key=>input[key]!==undefined))throw Error('Invalid redaction request.');
    if(!redaction.allowed.has(input.fullname))throw Error('This item wasn’t read from your own lists on this page, so it can’t be changed.');
    if(!redaction.modhash || input.username!==redaction.username)throw Error('Confirm your account first.');
    if(input.step==='overwrite' && (typeof input.text!=='string' || !input.text.trim() || input.text.length>1000))throw Error('Invalid replacement text.');
    const body=input.step==='overwrite'?new URLSearchParams({thing_id:input.fullname,text:input.text,api_type:'json'}):new URLSearchParams({id:input.fullname});
    const response=await fetch(new URL(input.step==='overwrite'?'/api/editusertext':'/api/del',location.origin).href,{method:'POST',credentials:'include',cache:'no-store',redirect:'error',
      headers:{'Content-Type':'application/x-www-form-urlencoded','X-Modhash':redaction.modhash,Accept:'application/json'},body,signal});
    if(response.status===429){const seconds=Number(response.headers.get('retry-after'));return {written:false,rateLimited:true,retryAfterMs:Number.isFinite(seconds)?seconds*1000:60000,reason:'Reddit is limiting requests.'};}
    if(!response.ok)return {written:false,reason:'Reddit refused the '+(input.step==='overwrite'?'edit':'delete')+' (HTTP '+response.status+').'};
    let data=null;try{const text=await boundedText(response);data=text?JSON.parse(text):{};}catch{data=null;}
    const errors=data?.json?.errors;
    if(data==null)return {written:false,reason:'Reddit returned an unexpected answer.'};
    if(Array.isArray(errors) && errors.length)return {written:false,reason:'Reddit refused the '+(input.step==='overwrite'?'edit':'delete')+': '+String(errors[0]?.[1] || errors[0]?.[0] || 'unknown error').slice(0,200)+'.'};
    if(input.step==='delete')redaction.allowed.delete(input.fullname);
    redaction.dirty=true;return {written:true};
  }
  async function read(input,signal){
    if(input.action==='removal-public')return readRemovalPublic(input,signal);
    if(input.action==='removal-public-profile')return readRemovalPublicProfile(input,signal);
    if(input.action==='community-suggestions')return readCommunitySuggestions(input,signal);
    if(['own-list','own-list-identity'].includes(input.action))return readOwnList(input,signal);
    if(['mod-status','unapproved'].includes(input.action))return readModeration(input,signal);
    if(input.action==='raffle-thread')return raffleThread(input,signal);
    if(input.action==='raffle-me')return raffleMe(signal);
    if(input.action==='raffle-winner-comments')return raffleWinnerComments(input,signal);
    if(input.action==='raffle-tree')return raffleTree(input,signal);
    if(input.action==='raffle-user')return raffleUser(input,signal);
    if(input.action==='chat-status')return chatStatus();
    if(input.action==='chat-send')return chatSend(input);
    if(input.action==='chat-group')return chatGroup(input);
    if(input.action==='redact-identity')return redactIdentity(signal);
    if(input.action==='redact-list')return redactList(input,signal);
    if(input.action==='redact-item')return redactItem(input,signal);
    if(input.action==='user-avatar')return userAvatar(input,signal);
    if(input.action==='render-card')return renderCard(input,signal);
    if(input.action==='status')return readStatuses(input,signal);
    if(input.action==='render-navigation')return renderNavigation(input,signal);
    if(input.action==='refresh-archive-thread')return refreshArchiveThread(input);
    if(input.action==='load-archive-comment-modules')return loadArchiveCommentModules(input,signal);
    if(input.action==='render-controls')return renderControls(input,signal);
    if(input.action==='render-search-empty')return renderSearchEmpty(input,signal);
    const context=route(),path=pageKey();
    if(!context || !['reddit.com','www.reddit.com','new.reddit.com','sh.reddit.com','old.reddit.com'].includes(location.hostname))throw Error('Open a public Reddit profile or post.');
    const comments=input.kind==='comment';
    // A search view request carries the user's plain words; it needs relevance and comment-count sorts too.
    const search=input.action==='profile' && input.query!==undefined,query=search && typeof input.query==='string'?input.query.trim():'';
    if(search && (typeof input.query!=='string' || query.length>300 || /[\u0000-\u001f]/.test(query)))throw Error('Invalid search words.');
    const sort=input.sort ?? (search?'relevance':'new'),range=input.range ?? 'all';
    if(!(search?['new','hot','top','relevance','comments']:['new','hot','top']).includes(sort) || !['hour','day','week','month','year','all'].includes(range))throw Error('Invalid public feed sort.');
    if(input.kind!=null && !['post','comment'].includes(input.kind))throw Error('Invalid content type.');
    const stream=input.stream ?? 'authenticated';
    if(input.stream!=null && (input.action!=='profile' || !comments || !['authenticated','public'].includes(stream)))throw Error('Invalid comment discovery stream.');
    const url=new URL('/api/info.json',location.origin);let nativeSearch=false,postPage=null,commentCursor=null,anonymous=false,q='';
    if(input.action==='profile'){
      if(!context.username || !M.validateUsername(input.username) || context.username.toLowerCase()!==input.username.toLowerCase())throw Error('Profile changed. Try again.');
      q=authorQuery(input.username)+(query?' '+query:'');
      if(comments)commentCursor=readCommentCursor(input.after,stream,input.username,sort,range,q);
      if(!comments)postPage=readPostCursor(input.after,input.username,sort,range,q);
      // Signed-in Shreddit omits posts for explicitly blocked profiles in live
      // comparisons. Keep the existing authenticated JSON path for that case;
      // the page cursor pins its transport until Refresh starts a new scope.
      const blocked=!comments && Boolean(document.querySelector('#right-sidebar-container faceplate-tracker[source="profile"][noun="unblock_user"]'));
      // Blocked profiles: signed-in search omits their posts and the legacy JSON
      // route now answers 403, so search them without credentials instead.
      nativeSearch=comments || (postPage?.transport || 'shreddit')==='shreddit';anonymous=comments?stream==='public':blocked && nativeSearch;
      url.pathname=nativeSearch?'/svc/shreddit/search/':'/search.json';url.searchParams.set('q',q);url.searchParams.set('type',comments?'comments':nativeSearch?'posts':'link');url.searchParams.set('sort',sort);if(sort==='top' || search && range!=='all')url.searchParams.set('t',range);url.searchParams.set('limit','25');
      if(input.after)url.searchParams.set(nativeSearch?'cursor':'after',comments?commentCursor:postPage.cursor);
      // Only credential-free extension searches opt into the browser's Google Referer rule.
      if(nativeSearch && anonymous)url.searchParams.set('rt_public_search','1');
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
        const useBrowser=nativeSearch && anonymous && globalThis.RTPublicBrowser?.hasSession?.();
        const response=useBrowser?null:await fetch(url.href,{method:'GET',credentials:input.action==='profile' && anonymous?'omit':'include',...(input.action==='profile' && nativeSearch && (comments || anonymous)?{cache:'no-store',referrerPolicy:'no-referrer'}:{}),redirect:'error',headers:{Accept:nativeSearch?'text/vnd.reddit.partial+html, text/html;q=0.9':'application/json'},signal:controller.signal});
        if(response?.status===429){const hint=response.headers.get('retry-after'),seconds=Number(hint),retry=Number.isFinite(seconds)?seconds*1000:Date.parse(hint)-Date.now();cooldown=Date.now()+Math.max(1000,Math.min(3600000,retry>0?retry:60000));throw Error('Reddit rate limit reached. Try again later.');}
        let publicText=useBrowser?await publicBrowserRead(url.href,controller.signal,input.refresh===true):undefined;
        // Cold anonymous reads start a browser only after explicit refusal;
        // verified anonymous sessions are reused directly. Signed-in reads
        // never enter this transport or lend it their cookies.
        if(nativeSearch && anonymous && response?.status===403)publicText=await publicBrowserRead(url.href,controller.signal,input.refresh===true);
        if(response && !response.ok && publicText===undefined){
          // Name the source so the page can explain it; 403 means Reddit refused this request.
          const what=input.action==='profile'?(comments?(stream==='public'?'logged-out comment search':'comment search'):'post search'):'item details';
          throw Error(response.status===403?`Reddit blocked ${what} (HTTP 403).`:`Reddit couldn’t load ${what} (HTTP ${response.status}).`);
        }
        const text=publicText===undefined?await boundedText(response):publicText;
        if(pageKey()!==path || controller.signal.aborted)throw Error('Page changed. Try again.');
        if(nativeSearch)return (comments?commentListing:postListing)(text,input.username,{sort,range,stream,q,search});
        let data;try{data=JSON.parse(text);}catch{throw Error('Reddit returned an unexpected response.');}
        if(!Array.isArray(data?.data?.children) || data.data.children.length>100)throw Error('Reddit returned an unexpected post listing.');
        if(pageKey()!==path || controller.signal.aborted)throw Error('Page changed. Try again.');
        const posts=data.data.children.filter(item=>item.kind===(comments?'t1':'t3')).slice(0,25).map(item=>(comments?M.normalizeComment:M.normalizePost)(item.data,{source:'reddit'})).filter(Boolean);
        const filtered=input.action==='profile'?posts.filter(p=>p.author.toLowerCase()===input.username.toLowerCase()):posts.filter(p=>input.ids.some(id=>id.toLowerCase().replace(/^t[13]_/, '')===p.id));
        const cursor=typeof data.data.after==='string' && /^t3_[a-z0-9]{1,10}$/i.test(data.data.after)?data.data.after:null;
        const after=input.action==='profile'?postPageCursor(cursor,'json',input.username,sort,range,q):cursor;
        return {posts:filtered,after,hasMore:Boolean(after),incomplete:true,source:'reddit'};
      })();
      const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Reddit request timed out. Try again.'));},nativeSearch && anonymous?25000:10000);});
      return await Promise.race([operation,timeout]);
    }finally{active--;clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
  }
  document.addEventListener('rt-post-request',async event=>{
    let input;try{input=JSON.parse(event.detail);}catch{return;}
    if(typeof input?.channel!=='string' || input.channel.length>80 || typeof input.id!=='string' || input.id.length>80)return;
    const key=input.channel+':'+input.id;
    if(input.action==='cancel'){jobs.get(key)?.abort();return;}
    if(jobs.has(key))return;
    if(jobs.size>=4){const deferred=['own-list','own-list-identity','removal-public','removal-public-profile','render-card','render-navigation','render-controls','render-search-empty','profile','info','status','user-avatar','raffle-thread','raffle-me','raffle-winner-comments','raffle-tree','raffle-user','chat-status','chat-send','chat-group','unapproved','mod-status','community-suggestions','redact-identity','redact-list','redact-item'].includes(input.action);document.dispatchEvent(new CustomEvent('rt-post-response',{detail:JSON.stringify({channel:input.channel,id:input.id,ok:deferred,...(deferred?{deferred:true,retryAfterMs:250}:{error:'Please wait for the current Reddit request.'})})}));return;}
    const controller=new AbortController();jobs.set(key,controller);
    try{const result=await read(input,controller.signal);document.dispatchEvent(new CustomEvent('rt-post-response',{detail:JSON.stringify({channel:input.channel,id:input.id,ok:true,...result})}));}
    catch(error){document.dispatchEvent(new CustomEvent('rt-post-response',{detail:JSON.stringify({channel:input.channel,id:input.id,ok:false,error:controller.signal.aborted?'Post request cancelled.':error.message})}));}
    finally{jobs.delete(key);}
  });
})();
