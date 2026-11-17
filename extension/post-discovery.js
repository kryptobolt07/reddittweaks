/* Inline public-post discovery. Does not change Reddit's posts or chat client. */
(() => {
  'use strict';
  const M=globalThis.RTPostModel;if(!M)return;
  const key='rt-settings-v1';
  // Arctic Shift is community-run: removal lookups send up to 100 IDs per request instead of 25.
  const profileBatchSize=25,archiveIdBatch=100,historyFullMs=7*86400000;
  const ownLists=['saved','history','hidden','upvoted','downvoted','removed'];
  const listIcons={saved:'save',history:'history',hidden:'hide',upvoted:'upvote',downvoted:'downvote'};
  // Verified from native account markup or the page-world identity read. The last confirmed name is kept so a
  // list search can show its pill with Reddit's first header; every list request still re-confirms the account.
  const identityKey='rt-own-identity-v1';
  // The cached name belongs to one Reddit account ID: after switching accounts (or signing out) it is never reused.
  const loggedInOwner=()=>{const app=document.querySelector('shreddit-app'),owner=app?.getAttribute('logged-in-user-id') || '';return app?.getAttribute('user-logged-in')==='true' && /^t2_[a-z0-9]{1,13}$/i.test(owner)?owner.toLowerCase():'';};
  let signedInName=(()=>{try{const saved=JSON.parse(sessionStorage.getItem(identityKey) || 'null'),owner=loggedInOwner();return saved && owner && saved.owner===owner && Date.now()-saved.at<3600000 && /^[\w-]{3,20}$/.test(saved.name)?saved.name:'';}catch{return '';}})();
  const rememberIdentity=name=>{try{const owner=loggedInOwner();if(name && owner)sessionStorage.setItem(identityKey,JSON.stringify({name,owner,at:Date.now()}));else sessionStorage.removeItem(identityKey);}catch{}};
  const listLabel=list=>list[0].toUpperCase()+list.slice(1);
  const ownListCandidate=()=>{const match=location.pathname.match(/^\/user\/([\w-]{1,20})\/(saved|history|hidden|upvoted|downvoted|search)\/?$/i);return match && (match[2].toLowerCase()!=='search' || new URLSearchParams(location.search).has('rt_list'))?match:null;};
  const searchSorts=['relevance','new','old','top','comments','hot'],mediaTypes=['image','gif','video','gallery'];
  // Widen only after live verification against native post AND comment search.
  // Each capability must preserve a superset; unsupported predicates stay local.
  const PROFILE_REDDIT_SEARCH_CAPABILITIES=Object.freeze(['term','phrase','and','or']);
  function parseProfileSearch(context){
    const comments=context.type==='comments',fields=comments?['body','subreddit','author']:['title','body','subreddit','author','site','url','flair','self','nsfw','spoiler','type'];
    const parsed=globalThis.RCSCore.parseQuery(context.q,{fields});
    parsed.errors=parsed.errors.map(error=>error.replace("isn't available in this search",comments?"isn't available for comments":"isn't available for posts"));
    const visit=node=>{
      if(!context.list && node.type==='field' && node.field==='author' && node.value.toLowerCase()!==context.username.toLowerCase())parsed.errors.push('Author is fixed to u/'+context.username+'; another user cannot be searched here');
      if(node.type==='field' && ['from','has'].includes(node.field))parsed.errors.push(node.field+": isn't available for "+(comments?'comments':'posts'));
      if(node.child)visit(node.child);for(const child of node.children || [])visit(child);
    };visit(parsed.expr);parsed.errors=[...new Set(parsed.errors)];parsed.invalid=parsed.errors.length>0;return parsed;
  }
  // Bounded waits keep the combined feed in date order without letting a slow
  // source stall it. Native continuation cards wait at most nativeWaitMs for
  // discovery coverage; a discovery source that has not answered within
  // sourceWaitMs stops holding back the other sources' publication.
  const nativeWaitMs=1200,sourceWaitMs=2500;
  // Reddit often refuses logged-out search (HTTP 403). That stream is only a
  // supplement, so pause it quietly and say results may be incomplete.
  // Rate limits, timeouts and gateway failures retry on their own with
  // backoff before a source is reported as failed.
  const retryLimit=5,quietRetries=2;
  // Removed reads your profile, the signed-out view of it and your Arctic Shift history until each has nothing left
  // (measured 2026-11-16: 2,094 items signed in, 85 pages; 73 pages signed out; Reddit has no 1,000-item limit there).
  // These bounds only stop a runaway walk, and stopping at one is reported as incomplete.
  const removedItemBound=20000,removedVisitorPages=1000,removedHistoryPages=500;
  const publicBlockMs=600000,publicBlockedNote='Some comments may be missing · Reddit is blocking logged-out search';
  // Viewed-posts History (docs/viewed-history-spec.md): above Reddit's own 20, your History tab is drawn by the extension.
  let viewedHistoryOn=false;
  function historySectionRoute(username,search,ownName){
    if(username.toLowerCase()!==ownName.toLowerCase())return null;
    const layout=['cardView','compactView'].includes(new URLSearchParams(search).get('feedViewType'))?new URLSearchParams(search).get('feedViewType'):'';
    return {kind:'profile',view:'search',section:true,list:'history',username,q:'',type:'all',sort:'list',range:'all',key:JSON.stringify(['history-section',ownName.toLowerCase(),layout])};
  }
  function removedSectionRoute(username,search,ownName){
    if(username.toLowerCase()!==ownName.toLowerCase())return null;
    const params=new URLSearchParams(search),layout=['cardView','compactView'].includes(params.get('feedViewType'))?params.get('feedViewType'):'';
    return {kind:'profile',view:'search',section:true,list:'removed',username,q:'',type:'all',sort:'list',range:'all',key:JSON.stringify(['removed-section',ownName.toLowerCase(),layout])};
  }
  function pageRoute(path=location.pathname,search=location.search,ownName=signedInName){
    const scoped=path.match(/^\/user\/([\w-]{1,20})\/search\/?$/i);
    if(scoped){const params=new URLSearchParams(search),q=(params.get('q') || '').trim(),type=['posts','comments','media'].includes(params.get('type'))?params.get('type'):'posts';
      const list=params.get('rt_list');if(params.has('rt_list') && (!ownLists.includes(list) || scoped[1].toLowerCase()!==ownName.toLowerCase()))return null;
      if(q.length>300 || /[\u0000-\u001f]/.test(q))return null;
      const layout=['cardView','compactView'].includes(params.get('feedViewType'))?params.get('feedViewType'):'';
      const sort=searchSorts.includes(params.get('sort'))?params.get('sort'):q?'relevance':'new',range=['hour','day','week','month','year','all'].includes(params.get('t'))?params.get('t'):'all';
      if(list){const listSort=['new','old'].includes(params.get('sort'))?params.get('sort'):'list',listType=type;return {kind:'profile',view:'search',username:scoped[1],q,type:listType,list,sort:listSort,range,key:JSON.stringify(['own-list',ownName.toLowerCase(),list,q,listType,listSort,range,layout])};}
      return {kind:'profile',view:'search',username:scoped[1],q,type,sort:!q && sort==='relevance'?'new':sort,range,key:JSON.stringify(['profile-search',scoped[1].toLowerCase(),q,type,sort,range,layout])};}
    const ownTab=path.match(/^\/user\/([\w-]{1,20})\/(saved|history|hidden|upvoted|downvoted)\/?$/i);
    if(ownTab){if(new URLSearchParams(search).get('rt_view')==='removed')return removedSectionRoute(ownTab[1],search,ownName);if(viewedHistoryOn && ownTab[2].toLowerCase()==='history' && ownName)return historySectionRoute(ownTab[1],search,ownName);return ownTab[1].toLowerCase()===ownName.toLowerCase()?{kind:'profile',view:'list-tab',username:ownTab[1],list:ownTab[2].toLowerCase(),key:path.toLowerCase()}:null;}
    const profile=path.match(/^\/user\/([\w-]{1,20})(?:\/(submitted|comments))?\/?$/i);
    if(profile){const view=profile[2]==='submitted'?'posts':profile[2]==='comments'?'comments':'overview',params=new URLSearchParams(search);
      const sort=['new','hot','top'].includes(params.get('sort'))?params.get('sort'):'new',range=sort==='top' && ['hour','day','week','month','year','all'].includes(params.get('t'))?params.get('t'):'all',layout=['cardView','compactView'].includes(params.get('feedViewType'))?params.get('feedViewType'):'';
      if(params.get('rt_view')==='removed')return removedSectionRoute(profile[1],search,ownName);
      return {kind:'profile',view,username:profile[1],sort,range,key:'profile:'+profile[1].toLowerCase()+':'+view+':'+sort+':'+range+':'+layout};}
    const detail=path.match(/^\/(?:r\/[^/]+\/|user\/[^/]+\/)?comments\/([a-z0-9]{1,10})(?:\/.*)?$/i);
    return detail?{kind:'post',id:detail[1].toLowerCase(),key:'post:'+detail[1].toLowerCase()}:null;
  }
  function redditRead(parameters,signal){
    const channel=crypto.randomUUID(),id=crypto.randomUUID();let timer;
    return new Promise((resolve,reject)=>{
      const finish=(error,result)=>{clearTimeout(timer);document.removeEventListener('rt-post-response',receive);signal?.removeEventListener('abort',cancel);error?reject(error):resolve(result);};
      const cancel=()=>{document.dispatchEvent(new CustomEvent('rt-post-request',{detail:JSON.stringify({channel,id,action:'cancel'})}));finish(Error('Post request cancelled.'));};
      const receive=event=>{let response;try{response=JSON.parse(event.detail);}catch{return;}if(response.channel!==channel || response.id!==id)return;finish(response.ok?null:Error(response.error || 'Public posts could not be loaded.'),response);};
      document.addEventListener('rt-post-response',receive);signal?.addEventListener('abort',cancel,{once:true});
      timer=setTimeout(()=>{document.dispatchEvent(new CustomEvent('rt-post-request',{detail:JSON.stringify({channel,id,action:'cancel'})}));finish(Error('Public posts took too long to load. Try again.'));},parameters.action==='removal-public' || parameters.action==='removal-public-profile' || parameters.action==='profile' && (parameters.stream==='public' || parameters.kind!=='comment')?27000:12000);
      if(signal?.aborted){cancel();return;}
      document.dispatchEvent(new CustomEvent('rt-post-request',{detail:JSON.stringify({channel,id,...parameters})}));
    });
  }
  async function archiveRead(parameters){
    let timer;try{const response=await Promise.race([chrome.runtime.sendMessage({scope:'rt-posts',...parameters,pageUrl:location.href}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Archive request took too long. Try again.')),16000);})]);if(!response?.ok)throw Object.assign(Error(response?.error || 'Archive unavailable.'),{code:response?.code,retryAt:response?.retryAt});return response;}catch(error){if(/took too long/.test(error.message))error.code='timeout';throw error;}finally{clearTimeout(timer);}
  }
  let earlySettingsUsed=false;
  async function settingsRead(){
    // The document_start guard already asked the worker; reuse that answer once.
    const early=!earlySettingsUsed && globalThis.RTProfileNoticeGuard?.settings;earlySettingsUsed=true;
    if(early){try{const response=await early;if(response?.ok && response.settings)return {[key]:response.settings};}catch{}}
    const response=await archiveRead({action:'get-settings'});
    return {[key]:response.settings};
  }
  // Reddit's current deletion notices, plus the legacy bracket placeholders.
  const deletionNotice=text=>Boolean(M.noticeStatus(text));
  const itemKey=post=>post.kind==='comment'?post.fullname:post.id;
  // HTMLCollection iteration is slow in jsdom and allocates in browsers; walk siblings.
  function elementChildren(element){const out=[];for(let node=element?.firstElementChild;node;node=node.nextElementSibling)out.push(node);return out;}
  const cardSelector='shreddit-post[id],shreddit-profile-comment[comment-id],[data-testid="post-container"][data-fullname]';
  // Community artwork found on the page, kept per subreddit (a miss expires quickly).
  const avatarHints=new Map();
  const make=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text)el.textContent=text;return el;};
  const nativeStatusPaths={hidden:'M3.497 3.503a.9.9 0 10-1.273 1.273l.909.909A10.141 10.141 0 00.92 8.472a3.225 3.225 0 000 3.058A10.296 10.296 0 0010 16.973a10.13 10.13 0 003.709-.712l1.457 1.457a.897.897 0 001.274 0 .9.9 0 000-1.273L3.497 3.503ZM10 15.172a8.497 8.497 0 01-7.495-4.494 1.448 1.448 0 010-1.354 8.436 8.436 0 011.9-2.365l2.069 2.068c-.062.271-.105.55-.105.84a3.77 3.77 0 003.767 3.767c.29 0 .569-.043.84-.106l1.31 1.31a8.284 8.284 0 01-2.284.335L10 15.172Zm.476-7.237L8.874 6.333a3.722 3.722 0 011.26-.233 3.77 3.77 0 013.767 3.767c0 .444-.091.864-.233 1.26l-1.603-1.603a1.963 1.963 0 00-1.59-1.589Zm8.605 3.595a10.297 10.297 0 01-2.22 2.792L15.59 13.05a8.512 8.512 0 001.905-2.372 1.448 1.448 0 000-1.354A8.496 8.496 0 007.69 5.15L6.282 3.742A10.249 10.249 0 0110 3.028c3.8 0 7.28 2.087 9.08 5.444a3.225 3.225 0 010 3.058Z',deleted:'M15.2 15.7c0 .83-.67 1.5-1.5 1.5H6.3c-.83 0-1.5-.67-1.5-1.5V7.6H3v8.1C3 17.52 4.48 19 6.3 19h7.4c1.82 0 3.3-1.48 3.3-3.3V7.6h-1.8v8.1ZM17.5 5.8c.5 0 .9-.4.9-.9S18 4 17.5 4h-3.63c-.15-1.68-1.55-3-3.27-3H9.4C7.68 1 6.28 2.32 6.13 4H2.5c-.5 0-.9.4-.9.9s.4.9.9.9h15ZM7.93 4c.14-.68.75-1.2 1.47-1.2h1.2c.72 0 1.33.52 1.47 1.2H7.93Z'};
  Object.assign(nativeStatusPaths,{filter:'M3 6.9h7.11A4 4 0 0014 10c2.21 0 4-1.79 4-4s-1.79-4-4-4a4 4 0 00-3.89 3.1H3c-.5 0-.9.4-.9.9s.4.9.9.9Zm11-3.1c1.21 0 2.2.99 2.2 2.2 0 1.21-.99 2.2-2.2 2.2-1.21 0-2.2-.99-2.2-2.2 0-1.21.99-2.2 2.2-2.2Zm3 9.3H9.89A4 4 0 006 10c-2.21 0-4 1.79-4 4s1.79 4 4 4a4 4 0 003.89-3.1H17c.5 0 .9-.4.9-.9s-.4-.9-.9-.9ZM6 16.2c-1.21 0-2.2-.99-2.2-2.2 0-1.21.99-2.2 2.2-2.2 1.21 0 2.2.99 2.2 2.2 0 1.21-.99 2.2-2.2 2.2Z',checkmark:'M7.09 15.84c-.23 0-.46-.09-.64-.26L1.3 10.42a.9.9 0 010-1.27.9.9 0 011.27 0l4.52 4.52L17.5 3.26a.9.9 0 011.27 0 .9.9 0 010 1.27L7.73 15.58c-.18.18-.41.26-.64.26Z','chevron-right':'M7.5 17.9a.898.898 0 01-.636-1.536L13.227 10 6.864 3.636a.898.898 0 010-1.272.898.898 0 011.272 0l7 7a.898.898 0 010 1.272l-7 7a.897.897 0 01-.636.264Z','arrow-back':'M17.5 9.1H4.679l5.487-5.462a.898.898 0 00.003-1.272.898.898 0 00-1.272-.003l-7.032 7a.898.898 0 000 1.275l7.03 7a.896.896 0 001.273-.003.898.898 0 00-.002-1.272l-5.487-5.462h12.82a.9.9 0 000-1.8Z'});
  // Reddit's own icons (copied from its live icon set): remove, archive outline, rotate, pie-chart.
  Object.assign(nativeStatusPaths,{"removed": "M16.38 16.34A8.967 8.967 0 0019 10c0-4.96-4.04-9-9-9-2.47 0-4.71 1-6.34 2.62 0 0-.01 0-.02.01s0 .01-.01.02a8.967 8.967 0 00-2.62 6.34c0 4.96 4.04 9 9 9 2.47 0 4.71-1 6.34-2.62 0 0 .01 0 .02-.01s0-.01.01-.02ZM17.2 10c0 1.66-.57 3.19-1.52 4.41L5.59 4.32A7.157 7.157 0 0110 2.8c3.97 0 7.2 3.23 7.2 7.2ZM2.8 10c0-1.66.57-3.19 1.52-4.41l10.09 10.09A7.157 7.157 0 0110 17.2c-3.97 0-7.2-3.23-7.2-7.2Z", "archive": "M15.7 1H4.3C2.48 1 1 2.48 1 4.3v2.76c0 .5.4.9.9.9H2v6.74C2 16.52 3.48 18 5.3 18h9.4c1.82 0 3.3-1.48 3.3-3.3V7.96h.1c.5 0 .9-.4.9-.9V4.3C19 2.48 17.52 1 15.7 1Zm1.5 5.16H2.8V4.3c0-.83.67-1.5 1.5-1.5h11.4c.83 0 1.5.67 1.5 1.5v1.86ZM3.8 7.96h12.4v6.74c0 .83-.67 1.5-1.5 1.5H5.3c-.83 0-1.5-.67-1.5-1.5V7.96ZM7 10.07h6v1.8H7z", "refresh": "M18 10.1a.9.9 0 01-1.8 0c0-2.867-2.332-5.2-5.199-5.2H8.074l.564.564a.9.9 0 01-1.274 1.272l-2.1-2.1a.898.898 0 010-1.272l2.1-2.1a.9.9 0 111.273 1.272l-.564.564H11c3.859 0 7 3.14 7 7Zm-5.363 3.164a.9.9 0 10-1.273 1.272l.564.564H9.001a5.205 5.205 0 01-5.199-5.2.9.9 0 00-1.8 0c0 3.86 3.141 7 7 7h2.927l-.564.564a.9.9 0 001.274 1.272l2.1-2.1a.898.898 0 000-1.272l-2.102-2.1Z", "activity": "M10 1c-.5 0-.9.4-.9.9v.17C5.11 2.52 2 5.9 2 10c0 4.41 3.59 8 8 8 4.11 0 7.48-3.11 7.93-7.1h.17c.5 0 .9-.4.9-.9 0-4.96-4.04-9-9-9Zm.9 1.86c3.25.41 5.84 2.99 6.24 6.24H10.9V2.86ZM10 16.2c-3.42 0-6.2-2.78-6.2-6.2 0-3.11 2.31-5.69 5.3-6.12V10c0 .5.4.9.9.9h6.12c-.44 2.99-3.01 5.3-6.12 5.3Z"});
  // Native labels and our search options share one semantic mapping, even without native SVGs.
  const sortIcons={relevance:'search',hot:'hot',top:'top',new:'new',old:'archive',best:'best',comments:'comment'};
  const nativeMenuIcons={...sortIcons,'most comments':'comment','most commented':'comment','oldest':'archive',card:'card',classic:'classic',compact:'classic'};
  function glyph(kind='search'){
    const shared=globalThis.RTFeedFilters?.svgIcon?.(kind,16);if(shared)return shared;
    const s=document.createElementNS('http://www.w3.org/2000/svg','svg');s.setAttribute('viewBox','0 0 24 24');s.dataset.icon=kind;s.classList.add('rt-activity-icon');s.setAttribute('aria-hidden','true');if(nativeStatusPaths[kind]){s.setAttribute('viewBox','0 0 20 20');s.dataset.nativeIcon='true';s.setAttribute('fill','currentColor');s.setAttribute('width','16');s.setAttribute('height','16');s.setAttribute('icon-name',kind);const path=document.createElementNS(s.namespaceURI,'path');path.setAttribute('d',nativeStatusPaths[kind]);if(kind==='archive')path.setAttribute('fill-rule','evenodd');s.append(path);return s;}
    const p=document.createElementNS(s.namespaceURI,'path');p.setAttribute('d',kind==='refresh'?'M20 8a8.9443 8.9443 0 1 0 0 8M20 3v5h-5':kind==='filter'?'M4 7h16M4 17h16M9 5v4M15 15v4':kind==='archive'?'M4 8h16v12H4zM3 4h18v4H3zM9 12h6':kind==='removed'?'M5 5l14 14M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20':kind==='close'?'M6 6l12 12M18 6L6 18':kind==='calendar'?'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4':kind==='posttype'?'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4':kind==='community'?'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M9 16l3-8 3 8M10 13.5h4':'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14m5 12 6 6');s.append(p);return s;
  }
  // Unavailable profiles (banned or deleted) show Reddit's grey suspended snoo in the header;
  // their posts and comments use the small snoo-back avatar instead (defaultAvatar).
  const unavailableAvatarUrl=()=>'https://www.redditstatic.com/shreddit/assets/suspended-snoo.png';
  // One clear line under the name, in Reddit's own words when its notice has them.
  function accountStateLine(state,notice){
    const own=notice?.querySelector?.('#shreddit-forbidden-title,h3')?.textContent?.replace(/\s+/g,' ').trim() || '';
    const text=own && own.length<=120?own:state==='banned'?'This account has been suspended.':'This account has been deleted.';
    const line=make('p','rt-account-state m-0 mt-2xs text-12 text-neutral-content-weak flex items-center gap-2xs');line.dataset.state=state;line.dataset.testid='profile-account-state';
    line.append(glyph(state==='banned'?'removed':'deleted'),make('span','',text+' Showing archived public activity.'));return line;
  }
  function unavailableAvatar(state,size=64,notice=null){const image=make('img','rt-unavailable-avatar');image.src=unavailableAvatarUrl(state,notice);image.width=image.height=size;image.alt='';image.decoding='async';image.referrerPolicy='no-referrer';return image;}
  function button(text,run,icon){const b=make('button','',text);b.type='button';if(icon)b.prepend(glyph(icon));b.addEventListener('click',run);return b;}
  // Reddit's 20x20 action icons (same paths as Reddit's own markup), for archive-only controls.
  const REDDIT_ICONS={
    close:'m11.273 10 5.363-5.363a.9.9 0 10-1.273-1.273L10 8.727 4.637 3.364a.9.9 0 10-1.273 1.273L8.727 10l-5.363 5.363a.9.9 0 101.274 1.273L10 11.273l5.363 5.363a.897.897 0 001.274 0 .9.9 0 000-1.273L11.275 10h-.002Z',
    'radio-button':'M10 2.8c3.97 0 7.2 3.23 7.2 7.2s-3.23 7.2-7.2 7.2-7.2-3.23-7.2-7.2S6.03 2.8 10 2.8ZM10 1a9 9 0 10.001 18.001A9 9 0 0010 1Z',
    'radio-button-fill':'M10 2.8c3.97 0 7.2 3.23 7.2 7.2s-3.23 7.2-7.2 7.2-7.2-3.23-7.2-7.2S6.03 2.8 10 2.8ZM10 1a9 9 0 10.001 18.001A9 9 0 0010 1Z M10 14a4 4 0 100-8 4 4 0 000 8Z',
    // 12x12 (viewBox 0 0 12 12), Reddit's nsfw-fill-12.
    nsfw:'M6.506 5.119a.641.641 0 01.002-.723.74.74 0 01.31-.244 1.16 1.16 0 01.874 0 .695.695 0 01.306.244.647.647 0 01-.001.723.768.768 0 01-.303.259 1.008 1.008 0 01-.439.095 1.01 1.01 0 01-.44-.095.765.765 0 01-.309-.259Zm1.255 1.406a1.176 1.176 0 00-.507-.106c-.189 0-.36.036-.508.106a.854.854 0 00-.348.279.647.647 0 00-.127.386.6.6 0 00.13.382.87.87 0 00.353.266c.154.063.317.096.5.096s.352-.034.5-.1a.895.895 0 00.35-.27.625.625 0 00.123-.378.632.632 0 00-.124-.382.85.85 0 00-.342-.279Zm3.918.668c-.359.671-.958 1.57-1.937 2.55-.979.98-1.879 1.579-2.55 1.937-.749.4-1.637.4-2.386 0-.67-.358-1.57-.958-2.55-1.937-.98-.979-1.579-1.879-1.938-2.55-.4-.749-.4-1.637 0-2.387.36-.671.958-1.57 1.937-2.55.98-.98 1.88-1.579 2.55-1.937.75-.4 1.637-.4 2.386 0 .671.358 1.57.958 2.55 1.937.98.98 1.58 1.879 1.938 2.55.4.749.4 1.637 0 2.387ZM4 3.2H2.8v5.6H4V3.2Zm5.5 4.01a1.39 1.39 0 00-.246-.794 1.776 1.776 0 00-.6-.544c.168-.144.3-.312.395-.501.108-.21.163-.44.163-.682 0-.315-.089-.597-.266-.836a1.73 1.73 0 00-.712-.556A2.387 2.387 0 007.26 3.1c-.35 0-.677.065-.976.195-.298.13-.54.316-.72.555-.18.238-.27.521-.27.836 0 .243.054.472.163.684.096.189.228.357.394.501a1.788 1.788 0 00-.6.547 1.393 1.393 0 00.046 1.651c.192.255.465.46.806.608.341.148.727.223 1.151.223.416 0 .8-.074 1.14-.217.341-.145.613-.348.81-.605.197-.258.297-.549.297-.867l-.003-.001Z',
    upvote:'M10 19a3.966 3.966 0 01-3.96-3.962V10.98H2.838a1.731 1.731 0 01-1.605-1.073 1.734 1.734 0 01.377-1.895L9.364.254a.925.925 0 011.272 0l7.754 7.759c.498.499.646 1.242.376 1.894-.27.652-.9 1.073-1.605 1.073h-3.202v4.058A3.965 3.965 0 019.999 19H10ZM2.989 9.179H7.84v5.731c0 1.13.81 2.163 1.934 2.278a2.163 2.163 0 002.386-2.15V9.179h4.851L10 2.163 2.989 9.179Z',
    downvote:'M10 1a3.966 3.966 0 013.96 3.962V9.02h3.202c.706 0 1.335.42 1.605 1.073.27.652.122 1.396-.377 1.895l-7.754 7.759a.925.925 0 01-1.272 0l-7.754-7.76a1.734 1.734 0 01-.376-1.894c.27-.652.9-1.073 1.605-1.073h3.202V4.962A3.965 3.965 0 0110 1Zm7.01 9.82h-4.85V5.09c0-1.13-.81-2.163-1.934-2.278a2.163 2.163 0 00-2.386 2.15v5.859H2.989l7.01 7.016 7.012-7.016Z',
    comment:'M10 1a9 9 0 00-9 9c0 1.947.79 3.58 1.935 4.957L.231 17.661A.784.784 0 00.785 19H10a9 9 0 009-9 9 9 0 00-9-9Zm0 16.2H6.162c-.994.004-1.907.053-3.045.144l-.076-.188a36.981 36.981 0 002.328-2.087l-1.05-1.263C3.297 12.576 2.8 11.331 2.8 10c0-3.97 3.23-7.2 7.2-7.2s7.2 3.23 7.2 7.2-3.23 7.2-7.2 7.2Z',
    share:'m12.8 17.524 6.89-6.887a.9.9 0 000-1.273L12.8 2.477a1.64 1.64 0 00-1.782-.349 1.64 1.64 0 00-1.014 1.518v2.593C4.054 6.728 1.192 12.075 1 17.376a1.353 1.353 0 00.862 1.32 1.35 1.35 0 001.531-.364l.334-.381c1.705-1.944 3.323-3.791 6.277-4.103v2.509c0 .667.398 1.262 1.014 1.518a1.638 1.638 0 001.783-.349v-.002Zm-.994-1.548V12h-.9c-3.969 0-6.162 2.1-8.001 4.161.514-4.011 2.823-8.16 8-8.16h.9V4.024L17.784 10l-5.977 5.976Z',
    overflow:'M16 11.75a1.75 1.75 0 11.001-3.501A1.75 1.75 0 0116 11.75ZM11.75 10a1.75 1.75 0 10-3.501.001A1.75 1.75 0 0011.75 10Zm-6 0a1.75 1.75 0 10-3.501.001A1.75 1.75 0 005.75 10Z',
    caret:'M10 13.7a.897.897 0 01-.636-.264l-4.6-4.6a.9.9 0 111.272-1.273L10 11.526l3.964-3.963a.9.9 0 011.272 1.273l-4.6 4.6A.897.897 0 0110 13.7Z',
    save:'M13.6 3.8c.882 0 1.6.718 1.6 1.6v11.166l-5.201-2.911L4.8 16.566V5.4a1.6 1.6 0 011.6-1.6h7.2Zm0-1.8H6.4A3.4 3.4 0 003 5.4v12.24c0 .682.56 1.172 1.172 1.172.19 0 .385-.047.57-.151L10 15.717l5.259 2.944a1.167 1.167 0 001.742-1.021V5.4A3.4 3.4 0 0013.6 2Z',
    hide:'M3.497 3.503a.9.9 0 10-1.273 1.273l.909.909A10.141 10.141 0 00.92 8.472a3.225 3.225 0 000 3.058A10.296 10.296 0 0010 16.973a10.13 10.13 0 003.709-.712l1.457 1.457a.897.897 0 001.274 0 .9.9 0 000-1.273L3.497 3.503ZM10 15.172a8.497 8.497 0 01-7.495-4.494 1.448 1.448 0 010-1.354 8.436 8.436 0 011.9-2.365l2.069 2.068c-.062.271-.105.55-.105.84a3.77 3.77 0 003.767 3.767c.29 0 .569-.043.84-.106l1.31 1.31a8.284 8.284 0 01-2.284.335L10 15.172Zm.476-7.237L8.874 6.333a3.722 3.722 0 011.26-.233 3.77 3.77 0 013.767 3.767c0 .444-.091.864-.233 1.26l-1.603-1.603a1.963 1.963 0 00-1.59-1.589Zm8.605 3.595a10.297 10.297 0 01-2.22 2.792L15.59 13.05a8.512 8.512 0 001.905-2.372 1.448 1.448 0 000-1.354A8.496 8.496 0 007.69 5.15L6.282 3.742A10.249 10.249 0 0110 3.028c3.8 0 7.28 2.087 9.08 5.444a3.225 3.225 0 010 3.058Z',
    // Reddit has no History icon; a clock on its outline ring.
    history:'M10 2.8c3.97 0 7.2 3.23 7.2 7.2s-3.23 7.2-7.2 7.2-7.2-3.23-7.2-7.2S6.03 2.8 10 2.8ZM10 1a9 9 0 10.001 18.001A9 9 0 0010 1Zm-.9 4h1.8v4.627l3.036 3.037-1.272 1.272L9.1 10.373V5Z',
    back:'M17.5 9.1H4.679l5.487-5.462a.898.898 0 00.003-1.272.898.898 0 00-1.272-.003l-7.032 7a.898.898 0 000 1.275l7.03 7a.896.896 0 001.273-.003.898.898 0 00-.002-1.272l-5.487-5.462h12.82a.9.9 0 000-1.8Z'
  };
  function redditIcon(name,size=16){
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');for(const [k,v] of Object.entries({fill:'currentColor',height:String(size),width:String(size),viewBox:'0 0 20 20','aria-hidden':'true','icon-name':name}))svg.setAttribute(k,v);
    if(name==='nsfw'){svg.setAttribute('viewBox','0 0 12 12');svg.setAttribute('icon-name','nsfw-fill-12');svg.classList.add('block');}
    const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',REDDIT_ICONS[name] || '');svg.append(path);return svg;
  }
  // Reddit shows one of eight default avatars when a user has none; archives carry no avatar.
  function defaultAvatar(name,size){
    // Reddit draws deleted authors as a grey silhouette on its avatar gradient, not a random default avatar.
    if(!M.validateUsername(name)){const img=make('img','rounded-full shrink-0 rt-avatar-img rt-avatar-deleted');img.src='https://www.redditstatic.com/shreddit/assets/snoovatar-back-64x64px.png';img.alt='';img.width=img.height=size;img.decoding='async';img.referrerPolicy='no-referrer';img.style.width=img.style.height=size+'px';return img;}
    let hash=0;for(const ch of String(name || ''))hash=(hash*31+ch.charCodeAt(0))>>>0;
    const img=make('img','rounded-full shrink-0 bg-neutral-background-weak rt-avatar-img');img.src='https://www.redditstatic.com/avatars/defaults/v2/avatar_default_'+(hash % 8)+'.png';img.alt='';img.width=img.height=size;img.loading='lazy';img.decoding='async';img.referrerPolicy='no-referrer';img.style.width=img.style.height=size+'px';if(M.validateUsername(name))img.dataset.rtAvatarUser=name;return img;
  }
  // Reddit's compact counts: 999, 1.2K, 12K, 1.2M.
  function compactCount(value){const n=Number(value) || 0,abs=Math.abs(n);if(abs<1000)return String(n);if(abs<1e6)return (n/1000).toFixed(abs<10000?1:0).replace(/\.0$/,'')+'K';return (n/1e6).toFixed(1).replace(/\.0$/,'')+'M';}
  // Reddit's blur-to-reveal for NSFW media and spoilers: content stays in place, blurred, behind one button.
  // Reddit's fade over long search comments: shown only when the text is actually cut off (watched as it lays out).
  // The reader's left-navigation state (Reddit's own preference cookie, or the page's nav), so a page we build
  // reserves the same column width the native navigation will take.
  function navClass(){
    const native=document.querySelector('flex-left-nav-container[expanded]'),grid=native?.closest('.grid-container');
    if(grid?.classList.contains('flex-nav-collapsed'))return 'flex-nav-collapsed';if(grid?.classList.contains('flex-nav-expanded'))return 'flex-nav-expanded';
    const value=document.cookie.split(';').map(part=>part.trim()).find(part=>part.startsWith('hui_flex_nav_expanded_state='))?.split('=')[1];
    if(value==='0' || value==='1')return value==='0'?'flex-nav-collapsed':'flex-nav-expanded';
    return native?.getAttribute('expanded')==='0'?'flex-nav-collapsed':'flex-nav-expanded';
  }
  // Skeleton rows in the navigation column while Reddit's navigation loads, instead of an empty column.
  function navSkeleton(){const box=make('div','rt-skeleton rt-nav-skeleton');box.setAttribute('aria-hidden','true');for(let i=0;i<7;i++)box.append(make('span','rt-skeleton-line rt-skeleton-fallback'));return box;}
  function clipFade(content,fade){const check=()=>{fade.hidden=!(content.scrollHeight>content.clientHeight+1);};check();if(typeof ResizeObserver==='function' && !fade.rtWatched){fade.rtWatched=true;new ResizeObserver(check).observe(content);}return fade;}
  function sensitive(content,label,{media=true}={}){
    const box=make('div','relative overflow-hidden rt-sensitive'+(media?' rt-sensitive-media':''));content.classList.add('rt-sensitive-content');box.append(content);
    const reveal=make('button','rt-sensitive-reveal',label);reveal.type='button';
    // Like Reddit, a click anywhere on the blur reveals it (and never opens the post); afterwards clicks behave normally.
    box.addEventListener('click',event=>{if(box.classList.contains('rt-revealed'))return;event.preventDefault();event.stopPropagation();box.classList.add('rt-revealed');reveal.remove();},true);
    box.append(reveal);return box;
  }
  // Reddit resets the scroll when its own cards open a post; a plain link navigation keeps the feed's offset.
  // After our cards navigate in the same tab, start the new page at the top unless the reader scrolls first.
  function startNavigatedPageAtTop(url){
    const from=location.href,started=performance.now(),events=['wheel','touchmove','keydown','mousedown'];let user=false,arrived=0;const stop=()=>{user=true;};
    for(const type of events)addEventListener(type,stop,{passive:true,capture:true});
    const done=()=>{for(const type of events)removeEventListener(type,stop,{capture:true});};
    const tick=()=>{const now=performance.now();if(user || now-started>5000){done();return;}
      if(!arrived && location.href!==from)arrived=location.pathname===url.pathname?now:-1;
      if(arrived<0){done();return;}
      if(arrived){if(scrollY>0)scrollTo(0,0);if(now-arrived>1000){done();return;}}
      setTimeout(tick,30);};
    setTimeout(tick,0);
  }
  // Reddit can re-render a result card while it is being clicked (the full-card link changes between mouse down and
  // up), so the click lands on the card itself and nothing opens. A plain click on an empty part of a card that has
  // not navigated by the next task opens the card's own link.
  if(!globalThis.__rtCardClickFallback){globalThis.__rtCardClickFallback=true;
    document.addEventListener('click',event=>{
      if(event.defaultPrevented || event.button!==0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)return;
      const path=event.composedPath(),card=path.find(n=>n.classList?.contains('rt-native-card'));if(!card)return;
      // Only what was clicked inside the card counts (the card's own containers are ours too).
      // A click on a blurred NSFW or spoiler area reveals it; that is not a click meant to open the post.
      if(path.slice(0,path.indexOf(card)).some(n=>n.matches?.('a[href],button,input,textarea,select,label,summary,[role="button"],[role="menuitem"],faceplate-dropdown-menu,shreddit-post-overflow-menu,shreddit-comment-action-row,shreddit-blurred-container,shreddit-spoiler,[blurred],.rt-sensitive')))return;
      if(String(globalThis.getSelection?.() || ''))return;
      const target=card.querySelector('a.absolute.inset-0[href],a[slot="full-post-link"][href],a[data-testid="post-title"][href],a[slot="title"][href],a[href*="/comments/"]');if(!target)return;
      const from=location.href;setTimeout(()=>{if(location.href===from && card.isConnected)target.click();},0);
    });}
  // Reddit's router reloads the page on a replaceState to the unchanged address, so only write real changes.
  function replaceUrl(url){const next=url.pathname+url.search+url.hash;if(next===location.pathname+location.search+location.hash)return false;try{history.replaceState(history.state,'',next);return true;}catch{return false;}}
  // Search tips: Ctrl+/ (⌘/ on Mac) in a search box that uses our query language opens one compact card
  // under it, limited to the fields that box supports. Clicking a tip puts its example into the box.
  const postFieldsAll=['title','body','subreddit','author','site','url','flair','self','nsfw','spoiler','type'],commentFieldsAll=['body','author'];
  function tipsTarget(event){
    const path=event.composedPath(),field=path[0];if(!field?.matches?.('input,textarea'))return null;
    if(path.some(node=>node.matches?.('.rt-sra-cs-field')))return {input:field,fields:commentFieldsAll};
    if(!path.some(node=>node.matches?.('reddit-search-large')))return null;
    const comments=new URLSearchParams(location.search).get('type')==='comments';
    if(document.querySelector('[data-rt-ui="archive-subreddit"],[data-rt-ui="archive-search"]'))return {input:field,fields:comments?commentFieldsAll:[...postFieldsAll]};
    if(pageRoute()?.kind==='profile')return {input:field,fields:comments?['body','subreddit','author']:postFieldsAll};
    return null;
  }
  let tipsCard=null;
  function closeTips(focus){if(!tipsCard)return;const {card,input,cleanup}=tipsCard;tipsCard=null;cleanup();card.remove();if(focus)input.focus({preventScroll:true});}
  function openTips({input,fields}){
    closeTips(false);const data=globalThis.RCSCore?.searchTips?.({fields});if(!data)return;
    const card=make('div','rt-tips-card');card.dataset.rtUi='search-tips';card.setAttribute('role','dialog');card.setAttribute('aria-label','Search tips');
    const head=make('div','rt-tips-head');head.append(make('span','rt-tips-title','Search tips'),make('span','rt-tips-key','Esc to close'));card.append(head);
    const list=make('div','rt-tips-list');list.setAttribute('role','menu');
    for(const tip of data.tips){const row=make('button','rt-tips-row');row.type='button';row.setAttribute('role','menuitem');row.dataset.rtTip=tip.example;row.title='Use: '+tip.example;
      row.append(make('code','rt-tips-syntax',tip.syntax),make('span','rt-tips-meaning',tip.meaning),make('code','rt-tips-example',tip.example));
      row.addEventListener('click',event=>{event.preventDefault();closeTips(false);input.value=tip.example;input.dispatchEvent(new Event('input',{bubbles:true,composed:true}));input.focus({preventScroll:true});input.setSelectionRange?.(tip.example.length,tip.example.length);});
      list.append(row);}
    card.append(list,make('p','rt-tips-note',data.note));document.body.append(card);
    const box=input.getBoundingClientRect(),width=card.getBoundingClientRect().width || 400;
    card.style.left=Math.max(8,Math.min(box.left,innerWidth-width-8))+'px';card.style.top=Math.min(box.bottom+8,Math.max(8,innerHeight-card.getBoundingClientRect().height-8))+'px';
    const rows=()=>[...list.querySelectorAll('.rt-tips-row')];
    const keys=event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeTips(true);return;}
      if(!card.contains(event.composedPath()[0]))return;
      if(event.key==='ArrowDown' || event.key==='ArrowUp'){event.preventDefault();const all=rows(),at=all.indexOf(document.activeElement);all[(at+(event.key==='ArrowDown'?1:-1)+all.length)%all.length]?.focus();}};
    const outside=event=>{if(!event.composedPath().includes(card))closeTips(false);};
    const away=()=>closeTips(false);
    document.addEventListener('keydown',keys,true);document.addEventListener('pointerdown',outside,true);addEventListener('scroll',away,{passive:true,once:true});addEventListener('resize',away,{once:true});
    tipsCard={card,input,cleanup:()=>{document.removeEventListener('keydown',keys,true);document.removeEventListener('pointerdown',outside,true);removeEventListener('scroll',away);removeEventListener('resize',away);}};
    rows()[0]?.focus({preventScroll:true});
  }
  if(!globalThis.__rtSearchTipsKey){globalThis.__rtSearchTipsKey=true;
    document.addEventListener('keydown',event=>{if(event.key!=='/' || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.repeat)return;
      if(tipsCard){event.preventDefault();closeTips(true);return;}const target=tipsTarget(event);if(!target)return;event.preventDefault();event.stopPropagation();openTips(target);},true);}
  function link(text,url,cls){const a=make('a',cls,text);a.href=url;a.rel='noopener noreferrer';return a;}
  // Instance fields that belong to the extension, not to one profile view.
  const sharedKeys=new Set(['settings','settingsPending','settingsError','settingsRevision','parked','searchParks','parkingVisible','listChips','searchReattachQueued','leaveHidden','leaveRestoreTimer','leaveRestoreMs','profileOwner','observer','onRoute','onSettings','onWorkerSettings','onEmptyProfileSearch','avatarUnsubscribe','ready','reddit','archive','readSettings','nativeRenderer','autoDiscover','nativeWaitMs','retryUnitMs','sourceWaitMs','timer','profileNavigation','navigationLease','archiveForceUntil','flushingVirtualization','feedViewportUpdate','runtimeId','dead','scanFull','ownIdentityTask','ownIdentityController','ownIdentityChecked','ownHeader','ownHeaderObserver','ownHeaderDismissed','onOwnSubmit','onOwnFocus','ownIdentityError','onRemovedTab','tabPages','removedTabSelection','removedTabObserver','removedTabOwner','onOwnListLink','searchInlineBar','searchInlineButtons']),parkLimit=4;let generationSeq=0;
  class Discovery {
    constructor({reddit=redditRead,archive=archiveRead,readSettings=settingsRead,observe=true,autoDiscover=observe,nativeRenderer=null,timing={},removalCache=message=>chrome.runtime.sendMessage({scope:'rt-removal',...message}),viewedHistory=message=>chrome.runtime.sendMessage({scope:'rt-viewed',...message})}={}){
      this.removalCache=removalCache;this.viewedHistory=viewedHistory;
      this.nativeWaitMs=timing.nativeWaitMs ?? nativeWaitMs;this.retryUnitMs=timing.retryUnitMs ?? 1000;this.sourceWaitMs=timing.sourceWaitMs ?? sourceWaitMs;
      this.runtimeId=globalThis.chrome?.runtime?.id;this.navigationLease=crypto.randomUUID();this.parked=new Map();this.profileOwner=globalThis.RCSDirectory?.getOwner?.() || '';this.nativeRenderer=nativeRenderer;this.autoDiscover=autoDiscover;this.reddit=reddit;this.archive=archive;this.readSettings=readSettings;this.settings={postDiscovery:false,archiveDiscovery:false};this.settingsRevision=0;this.generation=0;this.controllers=new Set();this.nodes=new Map();this.host=null;
      this.settingsPending=true;this.syncProfileNotice();
      // The signed-in account is checked again on every route, but the last confirmed one stays in use meanwhile
      // (every list request re-confirms it in the page world), so Back to a parked list doesn't wait or flash.
      this.onRoute=()=>{if(ownListCandidate())this.ownIdentityChecked=false;this.syncProfileNotice();if(this.hasSearchPark())this.scan();else this.schedule();};this.onSettings=(changes,area)=>{if(area==='local' && changes[key])this.applySettings(M.normalizeSettings(changes[key].newValue));};
      this.onOwnSubmit=event=>this.submitOwnList(event);document.addEventListener('submit',this.onOwnSubmit,true);
      this.onOwnFocus=()=>this.syncOwnListHeader();document.addEventListener('focusin',this.onOwnFocus,true);
      this.onEmptyProfileSearch=event=>{
        if(this.submitOwnList(event))return;
        if(this.orphaned() || this.settingsPending || this.settingsError || !this.settings.postDiscovery || event.defaultPrevented || event.key!=='Enter' || event.repeat || event.isComposing || event.keyCode===229 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)return;
        const route=pageRoute(),path=event.composedPath();if(route?.kind!=='profile' || route.view==='search')return;
        const input=path[0],form=path.find(node=>node.matches?.('form')),host=path.find(node=>node.matches?.('reddit-search-large')),field=path.find(node=>node.matches?.('faceplate-search-input[name="q"]'));
        // Hydrated search uses a textarea inside the field's shadow root; SSR
        // uses a plain input. Require the current scope pill in either layout.
        const chipSelector='.scoped-search-pill,rpl-input-chip[slot="chips"],#search-input-remove-filter,#search-input-chip',scoped=field?.querySelector(chipSelector) || form?.querySelector(chipSelector);
        if(!input?.matches?.('input[name="q"],textarea[name="q"]') || input.value!=='' || !form || !host || !scoped)return;
        let scope;try{scope=JSON.parse(host.getAttribute('scope'));}catch{return;}
        if(scope?.type!=='profile' || String(scope.name || '').toLowerCase()!==route.username.toLowerCase() || String(scope.path || '').replace(/\/$/,'').toLowerCase()!=='/user/'+route.username.toLowerCase())return;
        event.preventDefault();event.stopImmediatePropagation();
        const anchor=document.createElement('a');anchor.href='/user/'+route.username+'/search/';anchor.hidden=true;document.body.append(anchor);try{anchor.click();}finally{anchor.remove();}
      };document.addEventListener('keydown',this.onEmptyProfileSearch,true);
      // Changes inside the observed feed are handled by its own observer; only
      // route/page-level changes need a scan.
      if(observe){this.observer=new MutationObserver(records=>{if(this.orphaned())return;this.syncProfileNotice();this.syncOwnListHeader();if(this.feed)this.trackVirtualization(records);
        // Reddit's start-up reconcile removes what we inserted into main (only our nodes change, so the
        // filter below would ignore it): put the search view back before the next paint.
        if((this.hasSearchPark() || this.context?.view==='search' && this.host && (!this.host.isConnected || this.isOwnList() && this.listTabsShell && !this.listTabsShell.isConnected)) && !this.searchReattachQueued){this.searchReattachQueued=true;queueMicrotask(()=>{this.searchReattachQueued=false;if(!this.dead)this.scan();});}
        // Late native empty/skeleton content must not paint over a retained result feed.
        if(this.context?.view==='search' && this.feed?.isConnected && pageRoute()?.key===this.context.key && records.some(record=>!this.ownsMutation(record) && !this.feed.contains(record.target)))this.suppressSearchPage();
        // Nothing mounted and not a page discovery acts on: unrelated page churn.
        if(this.idleRoute())return;if(records.some(r=>!this.ownsMutation(r) && !(this.feedPresentationObserver && this.feed?.contains(r.target))))this.schedule(true);});this.observer.observe(document.documentElement,{childList:true,subtree:true});this.onUserScroll=()=>{this.lastScrollAt=performance.now();};window.addEventListener('scroll',this.onUserScroll,{passive:true});window.addEventListener('popstate',this.onRoute);document.addEventListener('reddit:route',this.onRoute);globalThis.chrome?.storage?.onChanged?.addListener(this.onSettings);}
      this.onWorkerSettings=(message,sender)=>{if(message?.scope==='rt-posts' && message.action==='settings-changed' && sender?.id===globalThis.chrome?.runtime?.id)this.onSettings({[key]:{newValue:message.settings}},'local');};
      if(observe)globalThis.chrome?.runtime?.onMessage?.addListener(this.onWorkerSettings);
      this.avatarUnsubscribe=globalThis.RCSDirectory?.onChange?.(value=>{const owner=globalThis.RCSDirectory?.getOwner?.() || '';if(value?.owner && value.owner!==owner)return;// Learning the account at start-up (none → yours) isn't a switch; a different account or signing out is.
        if(!this.profileOwner && owner){this.profileOwner=owner;return;}
        if(this.profileOwner!==owner){this.profileOwner=owner;signedInName='';rememberIdentity('');this.ownIdentityChecked=false;this.clearOwnListHeader();this.discardAllParked();this.reset({retainNavigation:false});this.scan();}});
      this.ready=this.loadSettings();
    }
    async loadSettings(){const revision=this.settingsRevision;try{const saved=await this.readSettings();if(revision!==this.settingsRevision)return;this.settingsPending=false;this.settingsError=false;this.settings=M.normalizeSettings(saved?.[key]);this.syncSmoothFeed();viewedHistoryOn=this.settings.postDiscovery && this.settings.historyLimit!==20;this.scan();}catch{if(revision!==this.settingsRevision)return;this.settingsPending=false;this.settingsError=true;this.scan();}}
    // Storage and the worker both announce a settings change; only the first one
    // differs. Turning discovery or the archive on or off rebuilds the view; a
    // change to restoring deleted text only adjusts what is already mounted.
    // Smooth long feeds (setting): the page-world feed bridge keeps posts mounted and skips drawing far ones.
    syncSmoothFeed(){const on=!this.dead && Boolean(this.settings?.postDiscovery) && this.settings?.smoothFeeds!==false;document.documentElement.toggleAttribute('data-rt-smooth-feed',on);}
    applySettings(next){
      if(this.dead)return;document.documentElement.toggleAttribute('data-rt-smooth-feed',Boolean(next?.postDiscovery) && next?.smoothFeeds!==false);const previous=this.settings,fresh=this.settingsPending || this.settingsError,names=['postDiscovery','archiveDiscovery','restoreDeletedContent','historyLimit'];
      if(!fresh && names.every(name=>previous[name]===next[name]))return;
      viewedHistoryOn=Boolean(next.postDiscovery) && (next.historyLimit ?? 20)!==20;
      const rebuild=fresh || previous.postDiscovery!==next.postDiscovery || previous.archiveDiscovery!==next.archiveDiscovery || (previous.historyLimit ?? 20)!==(next.historyLimit ?? 20);
      if(rebuild)this.discardAllParked();
      this.settingsRevision++;this.settingsPending=false;this.settingsError=false;this.settings=next;
      // A History limit change on this page swaps between Reddit's own History and the extension's: restore at once.
      if(rebuild){this.reset({restoreImmediately:(previous.historyLimit ?? 20)!==(next.historyLimit ?? 20)});this.scan();return;}
      this.syncProfileNotice();this.restoreSettingChanged();
    }
    restoreSettingChanged(){
      this.clearSourceRetries(key=>key==='recovery');if(this.sourceErrors)delete this.sourceErrors.recovery;
      if(this.context?.kind!=='profile' || !this.host)return;
      if(this.settings.restoreDeletedContent){this.scheduleRecovery();return;}
      // Off: stop pending work, drop the text fetched only for recovery and put
      // Reddit's notices back, without rebuilding the view.
      clearTimeout(this.recoveryTimer);this.recoveryTimer=null;
      for(const key of this.recoveredKeys || [])this.archived.delete(key);this.recoveredKeys=new Set();this.recoveryChecked.clear();
      this.restoreRecoveredBodies();this.render({reuseCards:true});
    }
    // After an extension reload this script keeps running without its extension.
    orphaned(){
      if(this.dead)return true;if(!this.runtimeId)return false;let id;try{id=globalThis.chrome?.runtime?.id;}catch{}
      if(id)return false;try{this.destroy();}catch{}return true;
    }
    // Nothing is mounted and the page is not one discovery acts on.
    idleRoute(){if(this.host || this.context)return false;const route=pageRoute();return route?.kind!=='profile' && !(route?.kind==='post' && !globalThis.RTThreadRestore);}
    syncProfileNotice(){
      // The independent early guard needs no shared model. Discovery itself
      // retains its established document_idle registration in the isolated world.
      if(globalThis.RTProfileNoticeGuard){if(this.settingsPending)RTProfileNoticeGuard.refresh();else RTProfileNoticeGuard.setEnabled(this.settings.postDiscovery && (pageRoute()?.view!=='search' || pageRoute()?.list || this.settings.archiveDiscovery));return;}
      document.documentElement.toggleAttribute('data-rt-profile-discovery',pageRoute()?.kind==='profile' && location.hostname!=='old.reddit.com' && (this.settingsPending || this.settings.postDiscovery && (pageRoute()?.view!=='search' || pageRoute()?.list || this.settings.archiveDiscovery)));
    }
    ownsMutation(record){if(this.host?.contains(record.target) || record.target.closest?.('[data-rt-ui=activity-item],[data-rt-ui=activity-slot]'))return true;const nodes=[...record.addedNodes,...record.removedNodes];return nodes.length>0 && nodes.every(n=>n.nodeType===1 && Boolean(n.dataset?.rtUi));}
    // cheap: a page-level mutation, which only needs a full pass if the mounted page changed.
    schedule(cheap=false){if(this.dead)return;if(!cheap)this.scanFull=true;if(this.timer)return;this.timer=setTimeout(()=>{this.timer=null;const full=this.scanFull;this.scanFull=false;this.scan({cheap:!full});},60);}
    reset({retainNavigation=false,detach=false,keepCards=false,restoreImmediately=false}={}){this.flushVirtualization();this.clearHeaderFilters({keepElements:this.keepSearchControls()});this.listState=null;this.historyObserver?.disconnect();this.historyObserver=null;if(!detach){this.listEmpty?.remove();this.searchEmpty?.remove();}this.listEmpty=null;this.searchEmpty=null;const tabs=this.listTabs,tabShell=this.listTabsShell;
      const undoTabs=()=>{for(const [tab,state] of tabs || []){tab.setAttribute('href',state.href);tab.toggleAttribute('faceplate-tab-selected',state.selected);if(state.current==null)tab.removeAttribute('aria-current');else tab.setAttribute('aria-current',state.current);tab.removeEventListener('click',state.click,true);}tabShell?.remove();};
      // A parked list search keeps its tabs on screen; whatever Reddit didn't replace is put back after its page loads.
      if(!detach || !this.parkingVisible || this.leaveRestoreMs===0 || !tabs)undoTabs();else setTimeout(()=>{const now=pageRoute();if(!(now?.kind==='profile' && now.view==='search') || !tabShell?.isConnected)undoTabs();},this.leaveRestoreMs ?? 5000);
      this.listTabs=null;this.listTabsShell=null;
      // Search owns a separate feed; Reddit's original result objects stay in place.
      // Leaving search (opening a result): Reddit's own results stay hidden until Reddit replaces the page,
      // so its unfiltered list never flashes during the transition. Turning the feature off still restores them.
      const route=pageRoute(),leavingSearch=!restoreImmediately && !this.dead && this.settings?.postDiscovery!==false && !(route?.kind==='profile' && route.view==='search');
      const restore=entries=>{for(const [node,hidden] of entries)if(node.hasAttribute('data-rt-search-hidden')){node.hidden=hidden;node.removeAttribute('data-rt-search-hidden');}};
      clearTimeout(this.leaveRestoreTimer);const pendingLeave=this.leaveHidden || [];this.leaveHidden=null;
      if(leavingSearch && this.searchHidden?.size && this.leaveRestoreMs!==0){
        // Anything Reddit didn't replace comes back once its page has had time to load.
        const entries=[...pendingLeave,...this.searchHidden];this.leaveHidden=entries;this.leaveRestoreTimer=setTimeout(()=>{if(this.leaveHidden===entries){this.leaveHidden=null;const now=pageRoute();if(!(now?.kind==='profile' && now.view==='search'))restore(entries.filter(([node])=>node.isConnected));}},this.leaveRestoreMs ?? 5000);
      }else restore([...pendingLeave,...(this.searchHidden || [])]);
      // detach (a parked search): everything stays on screen until Reddit replaces the page.
      if(!detach)this.scopeSwitcher?.remove();this.scopeSwitcher=null;
      this.searchHidden=new Map();if(!detach)this.searchFeed?.remove();this.searchFeed=null;this.searchResumeMenu=null;this.searchRestoringMenu=false;
      // detach: stop all work but leave every change inside the retained feed.
      const undo=!detach;if(undo)for(const node of this.collapsedNativeRules || [])node.removeAttribute('data-rt-rule-collapsed');this.collapsedNativeRules=new Set();if(undo){for(const node of this.mergePendingNodes || [])node.removeAttribute('data-rt-order-pending');this.feed?.removeAttribute('data-rt-merge-waiting');}this.mergePendingNodes=new Set();this.publishedNative=new WeakSet();if(undo){this.feed?.removeAttribute('data-rt-activity');this.feed?.removeAttribute('data-rt-loading-owner');}this.feedPresentationObserver?.disconnect();this.feedPresentationObserver=null;if(undo)for(const style of this.nativeLoadingStyles || [])style.remove();this.nativeLoadingStyles=new Set();if(undo)for(const [node,hidden] of this.filteredNative || []){node.hidden=hidden;node.removeAttribute('data-rt-filter-hidden');node.removeAttribute('data-rt-activity-match');const original=this.virtualNodes?.get(node);if(original){original.hidden=hidden;original.removeAttribute('data-rt-filter-hidden');original.removeAttribute('data-rt-activity-match');}}if(undo){this.clearActivityMenu();this.controlsTarget?.remove();}else this.detachActivityMenu();this.controlsTarget=null;if(this.commentSort && undo){this.commentSort.node.hidden=this.commentSort.hidden;this.commentSort.node.removeAttribute('data-rt-comment-sort-suppressed');this.commentSort=null;}this.commentSort=null;this.activityArchiveAttempted=false;if(undo)this.activityEmpty?.remove();this.activityEmpty=null;this.activityFilter='all';this.filteredNative=new Map();this.postStatuses=new Map();if(undo){this.restoreRecoveredBodies();this.profileNavigation?.remove();}else this.forgetRecoveredBodies();if(!retainNavigation){this.profileNavigation=null;this.navigationLease=crypto.randomUUID();}else if(this.profileNavigation?.dataset.state==='loading')this.profileNavigation.dataset.state='idle';if(undo){this.archiveNotice?.removeAttribute('data-rt-archive-notice');this.archiveShell?.remove();}this.archiveNotice=this.archiveNoticeAnchor=this.archiveShell=this.archiveMain=this.archiveStats=this.avatarSlot=this.avatarPlaceholder=null;this.profileOverlay=false;this.profileTransition=false;this.presentedFeedNodes=null;this.archiveOnly=false;this.accountState='';this.generation=++generationSeq;this.recoveryObserver?.disconnect();this.recoveryObserver=null;this.recoveryObserved=new WeakSet();clearTimeout(this.recoveryTimer);this.recoveryTimer=null;clearTimeout(this.nativeResumeTimer);this.nativeObserver?.disconnect();this.batchObserver?.disconnect();this.batchObserver=null;this.nativeLoadingObserver?.disconnect();this.nativeLoadingObserver=null;this.nativeLoadingRoot=null;if(this.batchFrame)cancelAnimationFrame(this.batchFrame);this.batchFrame=null;this.activeProfileBatch=null;this.replyEnrichment=null;this.publishedCards=new Set();this.batchedProfile=false;this.batchInView=false;this.batchAutoPaused=false;this.forceProfileBatch=false;this.nativeBatch={active:0,queue:[]};this.nativeRetries=new WeakMap();this.postMetadata=new Map();this.replyContexts=new Map();this.replyAuthors=new Map();this.replyArchiveChecked=new Set();for(const c of this.controllers)c.abort();this.controllers.clear();if(this.emptyFeed && undo){this.emptyFeed.hidden=this.emptyWasHidden;this.emptyFeed.removeAttribute('data-rt-empty-suppressed');}this.emptyFeed=null;if(undo && !keepCards)for(const node of this.nodes.values()){const slot=this.feedSlot(node);if(slot!==node){
        // Reddit still owns this placeholder and may restore its detached node.
        // Retire both without removing a slot from its virtualization stack.
        slot.dataset.rtRetired='true';node.dataset.rtRetired='true';node.replaceChildren();node.hidden=true;
      }else node.remove();}this.virtualNodes=new Map();if(undo){this.loading?.remove();this.host?.remove();this.rtChips?.remove();}this.loading=null;this.host=null;this.feed=null;this.context=null;this.live=new Map();this.commentOrigins=new Map();this.archived=new Map();if(undo)this.nodes.clear();else this.nodes=new Map();this.after=this.before=null;this.loaded=false;this.archiveLoaded=false;this.moreReddit=this.moreArchive=false;this.sourceErrors={};this.sourceNotices={};for(const entry of this.sourceRetries?.values() || [])clearTimeout(entry.timer);this.sourceRetries=new Map();this.metadataPending=0;this.recoveryChecked=new Set();this.recoveryActive=false;this.detailRecoveryStarted=false;this.busy=false;this.archiveBusy=false;this.initialPrefetchDone=false;this.sourcePending=new Set();this.sourceFrontiers=new Map();this.sourceStartedAt=new Map();this.nativeSeenAt=new WeakMap();this.initialNative=new WeakSet();clearTimeout(this.gateTimer);this.gateTimer=null;this.gateAt=Infinity;this.redditRun=null;this.archiveRun=null;this.verifyQueue=[];this.verifyQueued=new Set();this.verifyRetry=[];this.recoveredKeys=new Set();this.mountSeen=null;this.verifyActive=false;this.pages=0;this.afterByKind={};this.beforeByKind={};this.redMore={};this.archiveMore={};this.renderedPosts=[];this.summaryCounts=null;this.archiveSig=undefined;this.rtChips=null;this.rtSearch=null;this.rtAgg=null;this.rtMenu=null;}
    // Leaving a profile parks its whole discovery state with its feed element.
    // Reddit keeps that element (cards included) and puts it back on Back with
    // its own scroll restore, so nothing is removed, copied or re-inserted:
    // work stops, every change stays in the retained feed, and the state is
    // adopted again when that feed returns. Up to parkLimit profiles are kept;
    // older ones are torn down properly.
    viewState(){const state={};for(const key of Object.keys(this))if(!sharedKeys.has(key))state[key]=this[key];state.nodes=new Map(this.nodes);return state;}
    // Only a view Reddit has taken out of the page is parked; anything still
    // displayed is torn down as before.
    parkable(){return this.context?.view!=='search' && Boolean(this.settings.postDiscovery && !this.settingsError && this.context?.kind==='profile' && this.feed && !this.feed.isConnected && location.hostname!=='old.reddit.com');}
    // Reddit replaced the feed of the profile being viewed: keep what was
    // loaded and move the same rendered cards into the new feed.
    carryOver(state){
      if(!state || state.archiveOnly!==this.archiveOnly)return false;
      for(const name of ['live','archived','commentOrigins','nodes','publishedCards','replyContexts','replyAuthors','replyArchiveChecked','sourceFrontiers','sourceErrors','recoveryChecked','activityFilter','postStatuses','archiveSig','loaded','archiveLoaded','pages','moreReddit','moreArchive','initialPrefetchDone','afterByKind','beforeByKind','redMore','archiveMore','recoveredKeys','verifyRetry'])if(name in state)this[name]=state[name];
      for(const node of this.nodes.values()){node.classList.remove('rt-native-enter','rt-native-inserted');if(['loading','queued'].includes(node.dataset.rtNativeState))node.dataset.rtNativeState='idle';this.results.append(node);}
      const generation=this.generation;queueMicrotask(()=>this.resumeWork(generation,new Set(state.sourcePending || []),state.sourceRetries || new Map(),false));
      return true;
    }
    // Search results live in our own feed, and Reddit rebuilds its search page on Back, so a search
    // is parked by its address and put back into the rebuilt page (see restoreSearchPark).
    searchParkKey(context=this.context){if(context?.section)return context.key;return context?.view==='search'?context.key+'|'+new URLSearchParams([...new URLSearchParams(location.search)].filter(([name])=>/^rt_/.test(name))).toString():'';}
    hasSearchPark(context=pageRoute()){return !this.dead && this.settings.postDiscovery && !this.settingsPending && !this.settingsError && context?.view==='search' && Boolean(this.searchParks?.has(this.searchParkKey(context)));}
    parkSearch({keepVisible=false}={}){
      const route=pageRoute();if(!this.searchParkAt || this.context?.view!=='search' || !this.host || !this.feed || this.dead || this.settingsError || !this.settings.postDiscovery || route?.key===this.context.key && this.host.isConnected || !this.listState && !this.nodes.size)return false;
      this.flushVirtualization();const state=this.viewState();state.parkedAt=Date.now();state.scrollY=window.scrollY;
      for(const node of this.nodes.values())node.classList.remove('rt-native-enter','rt-native-inserted');
      this.searchParks ||= new Map();const key=this.searchParkAt;
      const old=this.searchParks.get(key);if(old){this.searchParks.delete(key);this.discardParked(old.state);}
      this.searchParks.set(key,{state,feed:this.feed});
      // Opening a result: the parked results stay visible while Reddit loads that page, and go with Reddit's page.
      // Another search (tab, query) mounts at once, so its parked predecessor leaves the screen now.
      const pieces=[this.host,this.feed,this.scopeSwitcher,this.listTabsShell];this.parkingVisible=keepVisible;try{this.reset({detach:true,retainNavigation:true});}finally{this.parkingVisible=false;}if(!keepVisible)for(const piece of pieces)piece?.remove();
      while(this.searchParks.size>3){const [oldKey,parked]=this.searchParks.entries().next().value;this.searchParks.delete(oldKey);this.discardParked(parked.state);}
      return true;
    }
    restoreSearchPark(context,main){
      const key=this.searchParkKey(context),park=key && this.searchParks?.get(key);if(!park)return false;
      this.searchParks.delete(key);if(Date.now()-park.state.parkedAt>15*60000){this.discardParked(park.state);return false;}
      const target=context.section?this.mountRemovedFeed(main):this.mountSearchFeed(main);const hidden=this.searchHidden;if(!target){this.searchParks.set(key,park);return false;}
      if(this.context)this.leaveProfile({always:true});
      this.scopeSwitcher=null;target.replaceWith(park.feed);this.adopt(park.feed,park.state);this.searchFeed=park.feed;this.searchParkAt=key;
      if(this.host.nextElementSibling!==park.feed)park.feed.before(this.host);this.scopeSwitcher?.remove();this.scopeSwitcher=null;this.listEmpty=this.listEmpty?.isConnected && park.feed.contains(this.listEmpty)?this.listEmpty:null;this.searchEmpty=this.searchEmpty?.isConnected && park.feed.contains(this.searchEmpty)?this.searchEmpty:null;
      // The rebuilt page has fresh Reddit results to hide, and cards that never rendered are observed again.
      this.searchHidden=context.section?hidden:new Map();this.suppressSearchPage();
      if(typeof IntersectionObserver==='function')this.nativeObserver=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){this.nativeObserver.unobserve(entry.target);this.queueNative(entry.target);}},{rootMargin:'400px'});
      for(const node of this.nodes.values())if(!node.hidden && node.dataset.rtNativeState==='idle'){if(this.nativeObserver)this.nativeObserver.observe(node);else this.queueNative(node);}
      this.renderFilterChips();if(context.list)this.syncOwnListTabs();
      const y=park.state.scrollY||0;if(y)for(const wait of [0,120,400])setTimeout(()=>{if(this.context?.key===context.key && Math.abs(window.scrollY-y)>2)window.scrollTo(0,y);},wait);
      return true;
    }
    leaveProfile({retainNavigation=false,always=false}={}){
      if(!always && this.parkSearch({keepVisible:true}))return;
      if(!this.parkable()){if(always || this.host || this.context)this.reset({retainNavigation});return;}
      this.flushVirtualization();const feed=this.feed,state=this.viewState();
      // Reattaching the feed would replay entrance animations; they already ran.
      for(const node of this.nodes.values())node.classList.remove('rt-native-enter','rt-native-inserted');
      this.parked.delete(feed);this.parked.set(feed,state);
      // Reddit may leave our header in place while swapping the feed (tab change).
      const host=this.host;this.reset({detach:true,retainNavigation:true});if(host?.isConnected && !host.contains(feed))host.remove();
      while(this.parked.size>parkLimit){const [old,parked]=this.parked.entries().next().value;this.parked.delete(old);this.discardParked(parked);}
    }
    parkedFor(context){for(const [feed,state] of this.parked)if(feed.isConnected && state.context?.key===context.key && state.host)return [feed,state];return null;}
    adopt(feed,state){
      this.parked.delete(feed);for(const [key,value] of Object.entries(state))this[key]=value;
      if(!this.host.isConnected && !this.host.contains(feed))feed.before(this.host);
      // Work cut off by parking, resumed below.
      // A list search keeps its own progress (listState); it never sets the profile's loaded flags.
      const interrupted=new Set(state.sourcePending || []),retries=state.sourceRetries || new Map(),firstLoad=state.listState?false:!state.loaded && !state.archiveLoaded;
      // Fresh generation: anything still in flight from before parking is ignored.
      this.generation=++generationSeq;this.controllers=new Set();this.busy=this.archiveBusy=this.verifyActive=false;this.redditRun=this.archiveRun=null;
      this.sourcePending=new Set();this.metadataPending=0;this.replyEnrichment=null;this.profileOverlay=this.profileTransition=false;this.gateTimer=null;this.gateAt=Infinity;
      // Flags and controls that only describe work in flight start clean.
      this.recoveryActive=false;this.recoveryTimer=null;this.batchFrame=null;this.batchAutoPaused=false;this.forceProfileBatch=false;this.mountSeen=null;
      if(this.discover)this.discover.disabled=false;if(this.more)this.more.disabled=false;this.host.removeAttribute('aria-busy');
      for(const entry of retries.values())clearTimeout(entry.timer);this.sourceRetries=new Map();
      // Queued and loading renders were dropped with the old queue; queue them again.
      this.nativeBatch={active:0,queue:[]};for(const node of this.nodes.values())if(['loading','queued'].includes(node.dataset.rtNativeState))node.dataset.rtNativeState='idle';
      for(const key of ['feedPresentationObserver','nativeLoadingObserver','nativeLoadingRoot','recoveryObserver','nativeObserver'])this[key]=null;this.recoveryObserved=new WeakSet();
      // Rebuild the activity menu from Reddit's rows; it reconnects its observer.
      this.clearActivityMenu();this.observeBatchTail();
      // Cards whose render was cut off by leaving are queued again, as part of
      // the same (re-stamped) batch.
      if(this.activeProfileBatch){this.activeProfileBatch.generation=this.generation;this.activeProfileBatch.enriching=false;}
      for(const node of this.activeProfileBatch?.nodes || [])if(node.dataset.rtNativeState==='idle')this.queueNative(node);this.settleProfileBatch();
      const generation=this.generation;queueMicrotask(()=>this.resumeWork(generation,interrupted,retries,firstLoad));
    }
    // Continue what parking (or a feed replacement) interrupted: re-arm retries
    // for their remaining wait, restart streams that were cut off mid-request,
    // or the whole first load if it never finished. Never leave a view that
    // claims "Activity checked" while something was dropped.
    resumeWork(generation,interrupted,retries,firstLoad){
      if(generation!==this.generation || !this.host?.isConnected)return;
      // Resume incomplete lists; returning to History refreshes recent views and locally recorded visits.
      if(this.isOwnList() && this.listState){const list=this.listState;if(this.context.list==='history' && list.done){list.loading=false;this.loadOwnList();return;}if(!list.done && !list.error){list.loading=false;this.loadOwnList({resume:true});}this.renderOwnList();this.updateProfileLoading();return;}
      for(const [key,entry] of retries){this.sourceRetries.set(key,entry);entry.timer=setTimeout(()=>{entry.timer=null;if(generation!==this.generation || !this.host?.isConnected)return;this.retrySource(key);},Math.max(0,(entry.at || 0)-Date.now()));}
      if(firstLoad){if((interrupted.size || this.autoDiscover) && this.context?.kind==='profile'){if(this.archiveOnly){if(this.settings.archiveDiscovery)this.loadArchive();}else this.refreshActivity();}}
      else{
        const pending=[...interrupted].filter(key=>!retries.has(key)),reddit=pending.filter(key=>!key.startsWith('archive-')),archive=pending.filter(key=>key.startsWith('archive-')).map(key=>key.slice(8));
        if(reddit.length)this.loadReddit({retry:true,keys:reddit});
        if(archive.length && this.settings.archiveDiscovery){for(const kind of archive)this.archiveMore[kind]=true;this.archiveRun=this.archivePage({more:true,only:archive});}
      }
      this.pumpVerification();this.updateProfileLoading();
    }
    discardParked(state){
      const current=this.viewState(),navigation=this.profileNavigation;
      for(const [key,value] of Object.entries(state))this[key]=value;this.controllers=new Set();this.profileNavigation=null;
      try{this.reset({retainNavigation:true});}
      finally{for(const key of Object.keys(this))if(!sharedKeys.has(key) && !(key in current))delete this[key];Object.assign(this,current);this.profileNavigation=navigation;}
    }
    discardAllParked(){const states=[...this.parked.values()];this.parked.clear();for(const state of states)this.discardParked(state);}
    observeBatchTail(){
      this.batchObserver?.disconnect();this.batchObserver=null;
      if(this.context?.kind!=='profile' || !this.loading || typeof IntersectionObserver!=='function')return;
      this.batchObserver=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.target===this.loading){this.batchInView=entry.isIntersecting;if(entry.isIntersecting)this.continueProfile();}},{rootMargin:innerHeight*2+'px'});this.batchObserver.observe(this.loading);
    }
    trackVirtualization(records){
      for(const record of records){
        if((record.target!==this.feed && !(record.target.matches?.('faceplate-batch') && record.target.parentElement===this.feed)) || record.addedNodes.length!==1 || record.removedNodes.length!==1)continue;
        const added=record.addedNodes[0],removed=record.removedNodes[0];
        if(added.nodeType===1 && added.matches('.virtualized-placeholder') && added.parentElement===record.target){this.virtualNodes.set(added,removed);if(this.filteredNative.has(removed)){this.filteredNative.set(added,this.filteredNative.get(removed));this.filteredNative.delete(removed);}if(removed.dataset?.rtUi==='activity-item'){added.dataset.rtUi='activity-slot';added.hidden=removed.hidden;}if(removed.hasAttribute?.('data-rt-order-pending')){added.setAttribute('data-rt-order-pending','');this.mergePendingNodes.add(added);}if(removed.hasAttribute?.('data-rt-filter-hidden'))added.setAttribute('data-rt-filter-hidden','');if(removed.hasAttribute?.('data-rt-rule-collapsed')){added.setAttribute('data-rt-rule-collapsed','');removed.removeAttribute('data-rt-rule-collapsed');this.collapsedNativeRules?.delete(removed);this.collapsedNativeRules?.add(added);}if(removed.hasAttribute?.('data-rt-activity-match'))added.setAttribute('data-rt-activity-match','');}
        else if(this.virtualNodes.get(removed)===added){if(this.filteredNative.has(removed)){this.filteredNative.set(added,this.filteredNative.get(removed));this.filteredNative.delete(removed);}if(removed.hasAttribute?.('data-rt-rule-collapsed')){added.setAttribute('data-rt-rule-collapsed','');removed.removeAttribute('data-rt-rule-collapsed');this.collapsedNativeRules?.delete(removed);this.collapsedNativeRules?.add(added);}this.virtualNodes.delete(removed);}
      }
    }
    flushVirtualization(){
      // A source promise may run before MutationObserver delivery. Consume the
      // native swaps synchronously before locating/moving retained cards, so a
      // detached original is never mistaken for an unmounted discovery.
      if(this.flushingVirtualization)return;const records=this.feedPresentationObserver?.takeRecords();if(!records?.length)return;
      this.flushingVirtualization=true;
      try{this.withFeedViewport(()=>{this.trackVirtualization(records);
        // Draining the observer also consumes native hydration/filter changes.
        // Apply those before paint rather than dropping their presentation work.
        if(records.some(record=>!this.ownsMutation(record))){const entries=this.nativeEntries();this.syncNativeOrder(entries);if(this.activityFilter!=='all' || this.rtActive())this.filterNativeEntries(entries);this.syncNativeRules(entries);}
        if(records.some(record=>record.type==='childList' && [...record.addedNodes].some(node=>node.nodeType===1 && !node.closest?.('[data-rt-ui]'))))this.observeNativeLoading();});
      }finally{this.flushingVirtualization=false;}
    }
    feedSlot(node){this.flushVirtualization();for(const [placeholder,original] of this.virtualNodes || [])if(original===node && placeholder.parentElement===this.feed)return placeholder;return node;}
    capturePresentedFeed(){
      if(this.context?.kind==='profile' && pageRoute()?.key===this.context.key)this.presentedFeedNodes=new Set(this.nativeEntries().map(entry=>this.virtualNodes.get(entry.node) || entry.node));
    }
    presentedProfileVisible(){
      if(this.context?.kind!=='profile' || !this.host?.isConnected || !this.feed?.isConnected)return false;
      if(this.archiveOnly)return Boolean(this.archiveShell?.isConnected && this.archiveShell.contains(this.feed));
      if(this.feed.closest('main')?.querySelector('shreddit-feed')!==this.feed)return false;
      const current=this.nativeEntries().map(entry=>this.virtualNodes.get(entry.node) || entry.node);
      // Route and header changes precede the feed replacement. Retained native
      // objects (including virtualized ones) identify the outgoing view, even
      // after Reddit removes its profile tabs. IDs can recur in the post view.
      return this.presentedFeedNodes?.size?current.some(node=>this.presentedFeedNodes.has(node)):current.length===0;
    }
    outgoingProfileVisible(context){
      if(this.context?.view==='search' || context?.view==='search' || this.archiveOnly || context?.kind!=='profile' || this.context?.kind!=='profile' || this.context.key===context.key)return false;
      // Another user's profile: wait until Reddit has swapped the outgoing feed
      // out, so the incoming view never mounts on (or parks) the wrong feed.
      const other=this.context.username.toLowerCase()!==context.username.toLowerCase();
      if(!other && this.context.view===context.view)return false;
      // An outgoing feed with no native cards gives no signal that Reddit has
      // replaced it; never hold another user's view on that.
      if(other && !this.nativeEntries().length)return false;
      const tabs=this.feed?.closest('main')?.querySelector('#profile-feed-tabgroup');
      return Boolean(tabs && !tabs.closest('[data-rt-ui]') && this.presentedProfileVisible());
    }
    // What the mounted profile hangs on. While none of it is replaced, page-level
    // churn needs no reconciliation.
    mountIdentity(){
      const main=document.querySelector('main#main-content,main[role="main"],main'),profile=this.context?.kind==='profile';
      return {main,feed:profile?main?.querySelector('shreddit-feed,[data-rt-archive-feed]') || null:null,dropdown:profile?this.findDropdown(main):null,tabs:main?.querySelector('#profile-feed-tabgroup') || null};
    }
    // Cheap check against the recorded identity: what was found must still be
    // attached where it was; what was absent is looked for again.
    sameMount(){
      const seen=this.mountSeen;if(!seen?.main?.isConnected)return false;
      const {main,feed,dropdown,tabs}=seen;
      if(feed && (!feed.isConnected || !main.contains(feed)))return false;
      if(dropdown?!dropdown.isConnected || !main.contains(dropdown) || this.activityMain && !dropdown.contains(this.activityMain):this.context?.kind==='profile' && this.findDropdown(main))return false;
      return tabs?tabs.isConnected && main.contains(tabs):!main.querySelector('#profile-feed-tabgroup');
    }
    findDropdown(main){
      const known=this.activityDropdown;if(known?.isConnected && main?.contains(known))return known;
      for(const node of main?.querySelectorAll('rpl-dropdown') || [])if(!node.closest('shreddit-feed') && node.querySelector('button[aria-label="Feed options"]'))return node;
      return null;
    }
    scan({cheap=false}={}){
      if(this.orphaned())return;this.syncProfileNotice();
      this.ensureOwnIdentity();this.syncOwnListHeader();
      const context=pageRoute(),nativeAccount=globalThis.RTNativeRemoval?.identity(document);
      if(this.context?.section && (nativeAccount && nativeAccount.username.toLowerCase()!==this.context.username.toLowerCase() || document.querySelector('shreddit-app[user-logged-in="false"]'))){this.discardAllParked();this.reset({restoreImmediately:true});}
      this.syncRemovedTab(this.settings.postDiscovery?nativeAccount?.owner:'',context);
      if(context?.view==='list-tab'){if(this.context)this.leaveProfile({always:true});return;}
      if(!this.isSearch() && this.settings.postDiscovery && (context?.kind==='post' || context?.kind!=='profile' && !/^\/user\//i.test(location.pathname)) && this.presentedProfileVisible()){this.profileOverlay=true;return;}
      if((this.profileOverlay || this.profileTransition) && context?.key===this.context?.key){this.profileOverlay=false;this.profileTransition=false;if(!this.nativeBatch.active)for(const node of this.nodes.values())if(node.dataset.rtNativeState==='loading')node.dataset.rtNativeState='idle';for(const node of this.activeProfileBatch?.nodes || [])if(node.dataset.rtNativeState==='idle')this.queueNative(node);this.settleProfileBatch();}
      // Post pages belong to the thread module when it is loaded; it follows the URL
      // alone, so restoration works however the post was opened.
      if((!this.settings.postDiscovery && !this.settingsError) || context?.view==='search' && ((!context.list && (this.settings.archiveDiscovery && !globalThis.RTArchiveQuery?.search)) || !globalThis.RTFeedFilters || !globalThis.RCSCore?.parseQuery) || !context || context.kind==='post' && globalThis.RTThreadRestore || location.hostname==='old.reddit.com'){
        // Leaving a profile for a post, subreddit, home...: park it with its feed.
        this.leaveProfile();return;
      }
      if(this.outgoingProfileVisible(context)){this.profileTransition=true;return;}
      // Back (or Forward) to a parked profile whose feed Reddit put back.
      if(context.kind==='profile' && (this.context?.key!==context.key || !this.host?.isConnected)){const parked=this.parkedFor(context);if(parked){if(this.context)this.leaveProfile();this.adopt(...parked);}}
      if(this.context?.key===context.key && this.host?.isConnected && (!this.feed || this.feed.isConnected) && (!this.archiveOnly || this.archiveNotice?.isConnected || this.archiveNoticeAnchor?.isConnected)){
        if(context.view==='search'){this.suppressSearchPage();if(context.list)this.syncOwnListTabs();if(context.section)this.syncRemovedChrome();}
        this.syncFiltersFromUrl();
        if(cheap && this.sameMount()){this.maybeRestoreDetail();this.drainNative(this.nativeBatch);return;}
        this.observeNativeLoading();this.observeFeedPresentation();this.ensureActivityMenu();this.maybeRestoreDetail();this.deduplicate();this.drainNative(this.nativeBatch);this.mountSeen=this.mountIdentity();return;}
      // Same search, but Reddit took our view out of main (hydration): put the same elements back, with
      // everything loaded, instead of rebuilding (which restarted the list and blinked the pills).
      if(context.view==='search' && this.context?.key===context.key && this.host && this.feed && !this.feed.isConnected && this.reattachSearchView()){this.scan();return;}
      const retainNavigation=Boolean(this.profileNavigation && this.settings.postDiscovery && !this.settingsError);
      const carry=this.context?.key===context.key && this.settings.postDiscovery && !this.settingsError && this.context?.kind==='profile' && (this.loaded || this.archiveLoaded)?(this.restoreRecoveredBodies(),this.flushVirtualization(),this.viewState()):null;
      if(carry)this.reset({keepCards:true,retainNavigation:true});else if(!this.parkSearch({keepVisible:context.view!=='search'}))this.leaveProfile({retainNavigation,always:true});
      let main=document.querySelector('main#main-content,main[role="main"],main');
      if(!main && context.kind==='profile'){
        // Unavailable-account pages omit both main and shreddit-feed. Require an
        // explicit native account marker; generic 404/network pages stay native.
        const marker=document.querySelector('shreddit-app > div > img[alt="Deleted user"]');
        const retained=globalThis.RTProfileNoticeGuard?.unavailableNotice?.(),banned=document.querySelector('shreddit-app > #shreddit-forbidden:has(svg[icon-name="ban-fill"])');
        if(retained)main=this.mountArchiveProfile(context,retained.notice,retained.anchor,retained.state);else if(marker && marker.parentElement.querySelector('h3'))main=this.mountArchiveProfile(context,marker.parentElement);else if(banned && /^This account (?:has been (?:banned|suspended)|is suspended)$/i.test(banned.querySelector('#shreddit-forbidden-title')?.textContent.trim()))main=this.mountArchiveProfile(context,banned,banned,'banned');
      }
      if(!main)return;
      if(context.view==='search' && this.restoreSearchPark(context,main)){this.scan();return;}
      let target=context.section?this.mountRemovedFeed(main):context.view==='search'?this.mountSearchFeed(main):context.kind==='profile'?main.querySelector('shreddit-feed,[data-rt-archive-feed]'):main.querySelector('shreddit-post');
      if(!target)return;
      this.context=context;this.feed=context.kind==='profile'?target:null;this.rtFilters=context.kind==='profile'?this.readFilters(context):null;this.rtPred=null;this.rtSearch=location.search;
      this.searchParsed=context.view==='search'?parseProfileSearch(context):null;this.searchParkAt=this.searchParkKey(context);
      this.searchReddit=this.searchParsed?globalThis.RCSCore.splitQuery(this.searchParsed,PROFILE_REDDIT_SEARCH_CAPABILITIES):null;
      this.searchArchiveLocal=false;
      if(context.view==='search')this.suppressSearchPage();
      this.batchedProfile=Boolean(this.feed) && !context.list;
      // Cards Reddit has already painted are never pulled back behind the merge
      // gate; hiding them would flash the feed. Later native pages still wait
      // (briefly) for discovery coverage.
      if(this.feed)for(const entry of this.nativeEntries())this.initialNative.add(entry.node);
      if(this.feed && !this.batchedProfile && typeof IntersectionObserver==='function')this.nativeObserver=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){this.nativeObserver.unobserve(entry.target);this.queueNative(entry.target);}},{rootMargin:'400px'});this.live=new Map();this.archived=new Map();
      const host=this.host=make('section','rt-posts');host.dataset.rtUi='posts';host.setAttribute('aria-label',context.section?(context.list==='history'?'Viewed posts':'Removed posts and comments'):context.view==='search'?'Search results':context.kind==='profile'?'Additional public activity':'Archived post snapshot');
      host.dataset.rtContext=context.kind;
      const toolbar=this.toolbar=make('div','rt-posts-toolbar');if(context.section)toolbar.style.minHeight='0';
      const noun=context.view==='comments'?'comments':context.view==='overview'?'activity':'posts';
      this.discover=button(this.settingsError?'Retry discovery':context.kind==='profile'?'Discover '+noun:'Check archived post',()=>this.settingsError?this.retrySettings():this.archiveOnly?this.loadArchive():context.kind==='profile'?this.refreshActivity({force:true}):this.loadDetail(),'search');
      this.discover.title=context.kind==='profile'?'Find public '+noun+' through Reddit search, including activity omitted from this profile feed':'Look for a separate archived snapshot without replacing the current post';
      if(context.kind==='post' && !this.settings.archiveDiscovery && !this.settingsError){this.discover.disabled=true;this.discover.title='Enable Arctic Shift archive discovery in Reddit Tweaks to check this post.';}
      this.discover.setAttribute('aria-label',this.discover.textContent);this.discover.textContent='';this.discover.append(glyph(context.kind==='profile'?'refresh':'archive'));
      if(this.archiveOnly){this.discover.setAttribute('aria-label','Search archive');this.discover.title='Find archived public posts and comments for this unavailable account';this.discover.replaceChildren(glyph('archive'));this.discover.disabled=!this.settingsError && !this.settings.archiveDiscovery;}
      // Profile refresh belongs in Feed options, including while Reddit replaces that menu.
      this.discover.hidden=context.kind==='profile' && !this.settingsError;
      toolbar.append(this.discover);
      // The archive now loads with Reddit discovery whenever it is enabled;
      // Refresh activity reloads both providers.
      this.archiveButton=null;
      this.status=make('p','rt-posts-status');this.status.setAttribute('role','status');
      this.results=make('div','rt-posts-results');this.loading=make('div','rt-post-loading');this.loading.hidden=true;this.loading.setAttribute('aria-label','Loading posts');this.loading.append(this.feedLoader());
      this.more=button('Load more',()=>this.batchedProfile?this.advanceProfileBatch(true):this.loadMore());this.more.className='rt-posts-more';this.more.hidden=true;
      this.notice=make('p','rt-posts-notice');this.notice.setAttribute('role','note');this.notice.hidden=true;
      toolbar.append(this.status,this.notice);host.append(toolbar,this.loading,this.results,this.more);
      if(context.kind==='profile' && !context.section){this.rtChips=make('div','rt-filter-chips');this.rtChips.dataset.rtUi='filter-chips';this.rtChips.hidden=true;host.prepend(this.rtChips);this.renderFilterChips();}
      if(context.kind==='profile'){target.before(host);this.results.hidden=true;this.more.textContent=context.view==='search'?'Load more':'More discoveries';toolbar.append(this.more);}else target.after(host);
      if(context.kind==='profile'){this.loading.dataset.rtUi='profile-loading';this.loading.slot='load-after';this.feed.append(this.loading);this.observeBatchTail();}
      if(this.archiveOnly && this.autoDiscover)this.loadNavigation();
      // The Removed section already records the native empty notice in searchHidden before hiding it.
      this.emptyFeed=context.section?null:main.querySelector('#empty-feed-content');this.emptyWasHidden=this.emptyFeed?.hidden;
      const restored=context.kind==='profile' && this.carryOver(carry);
      if(restored)this.render({reuseCards:true});
      this.observeNativeLoading();this.observeFeedPresentation();this.ensureActivityMenu();
      if(context.list){this.syncOwnListTabs();this.listState={items:new Map(),scanned:0,loading:false,done:false,capped:false,error:'',after:null};this.more.hidden=true;this.discover.title='Refresh your '+context.list+' list';this.discover.setAttribute('aria-label',this.discover.title);this.loading.setAttribute('aria-label','Loading '+context.list+' items');this.summarizeOwnList();}
      if(this.settingsError)this.setStatus('Discovery settings could not be loaded. Select Retry discovery.',true);
      else if(context.kind==='profile' && this.autoDiscover && !restored)queueMicrotask(()=>{if(this.host===host){if(this.isSearch())this.refreshActivity();else if(this.archiveOnly){if(this.settings.archiveDiscovery)this.loadArchive();}else this.refreshActivity();}});
      this.maybeRestoreDetail();this.capturePresentedFeed();this.mountSeen=this.mountIdentity();
    }
    ensureOwnIdentity(){
      // Native account markup is already available on signed-in profile pages.
      const native=globalThis.RTNativeRemoval?.identity(document);
      if(native){if(signedInName!==native.username){signedInName=native.username;rememberIdentity(signedInName);}return;}
      if(document.querySelector('shreddit-app[user-logged-in="false"]')){signedInName='';rememberIdentity('');return;}
      // A profile search may be your own: learn the account once (cached for the tab) to offer the List switcher.
      const candidate=ownListCandidate() || (!signedInName && this.settings.archiveDiscovery && location.pathname.match(/^\/user\/([\w-]{1,20})\/(search)\/?$/i)) || null;
      if(!candidate || !this.settings.postDiscovery || this.settingsPending || this.settingsError){this.ownIdentityError?.remove();this.ownIdentityController?.abort();this.ownIdentityChecked=false;return;}
      if(this.ownIdentityChecked || this.ownIdentityTask)return;
      // The chat directory owner is a Matrix ID and self labels are "You".
      // Resolve the actual authenticated Reddit name once on demand instead;
      // every list page independently rechecks it in the page world.
      const username=candidate[1],identityPage=location.href;
      this.ownIdentityTask=this.request({action:'own-list-identity',username}).then(result=>{
        if(this.dead || location.href!==identityPage)return;this.ownIdentityError?.remove();signedInName=M.validateUsername(result.username)?result.username:'';rememberIdentity(signedInName);this.ownIdentityChecked=true;if(signedInName.toLowerCase()!==username.toLowerCase() && new URLSearchParams(location.search).has('rt_list'))this.showOwnListIdentityError('You can only search the lists of your signed-in Reddit account.');
      }).catch(error=>{
        if(this.dead || location.href!==identityPage)return;this.ownIdentityChecked=true;if(!ownListCandidate())return;signedInName='';rememberIdentity('');
        this.showOwnListIdentityError(error.message+' List search is unavailable; no complete results were loaded.');
      }).finally(()=>{this.ownIdentityTask=null;if(this.dead)return;
        // Now known to be your own profile: rebuild Feed options so the List switcher appears.
        if(this.isSearch() && !this.isOwnList() && signedInName && this.context?.username.toLowerCase()===signedInName.toLowerCase() && this.activityMenu && !document.querySelector('[data-rt-ui="own-list-switch"]'))this.clearActivityMenu();
        this.scan();});
    }
    showOwnListIdentityError(message){const note=this.ownIdentityError ||= make('p','rt-posts-notice');note.dataset.rtUi='own-list-error';note.setAttribute('role','alert');note.textContent=message;(document.querySelector('main') || document.body).prepend(note);}
    clearOwnListHeader(){
      this.ownHeaderObserver?.disconnect();this.ownHeaderObserver=null;
      const state=this.ownHeader;if(!state)return;
      state.form?.removeEventListener('submit',this.onOwnSubmit,true);state.chip.remove();state.nativeRemove?.removeEventListener('click',state.onNativeRemove);
      for(const [node,previous] of state.placeholders)if(node.getAttribute('placeholder')===state.placeholder){if(previous==null)node.removeAttribute('placeholder');else node.setAttribute('placeholder',previous);}
      this.ownHeader=null;
    }
    syncOwnListHeader(){
      const route=pageRoute(),routeKey=location.pathname+':'+(new URLSearchParams(location.search).get('rt_list') || '');
      if(this.ownHeaderDismissed && this.ownHeaderDismissed!==routeKey)this.ownHeaderDismissed='';
      const host=document.querySelector('reddit-search-large'),root=host?.shadowRoot || host;
      const field=root?.querySelector('faceplate-search-input[name="q"]'),form=root?.querySelector('form');
      let native=root?.querySelector('rpl-input-chip.scoped-search-pill,rpl-input-chip[slot="chips"],#search-input-chip,#search-input-remove-filter');
      native=native?.closest('rpl-input-chip') || native;
      let scope;try{scope=JSON.parse(host?.getAttribute('scope'));}catch{}
      const enabled=!this.dead && !this.settingsPending && !this.settingsError && this.settings.postDiscovery && route?.list && route.username.toLowerCase()===signedInName.toLowerCase() && scope?.type==='profile' && String(scope.name).toLowerCase()===route.username.toLowerCase() && String(scope.path || '').replace(/\/$/,'').toLowerCase()==='/user/'+route.username.toLowerCase() && native && !native.hasAttribute('data-rt-list-chip') && this.ownHeaderDismissed!==routeKey;
      // Opening a result: the list pill stays with the parked results until Reddit swaps the page or the search scope.
      const leaving=!enabled && this.ownHeader?.chip.isConnected && this.ownHeader.native===native && host?.getAttribute('scope')===this.ownHeader.scope && (this.context?.list===this.ownHeader.list && this.host?.isConnected || [...(this.searchParks?.values() || [])].some(park=>park.state.context?.list===this.ownHeader.list && park.feed.isConnected));
      if(leaving){if(!this.ownHeaderObserver){this.ownHeaderObserver=new MutationObserver(()=>this.syncOwnListHeader());this.ownHeaderObserver.observe(root,{childList:true,subtree:true});this.ownHeaderObserver.observe(host,{attributes:true,attributeFilter:['scope']});}return;}
      if(!enabled){this.clearOwnListHeader();if(root && route?.list && signedInName && this.settings.postDiscovery && !this.dead && this.ownHeaderDismissed!==routeKey){this.ownHeaderObserver=new MutationObserver(()=>this.syncOwnListHeader());this.ownHeaderObserver.observe(root,{childList:true,subtree:true});this.ownHeaderObserver.observe(host,{attributes:true,attributeFilter:['scope']});}return;}
      const input=(field?.shadowRoot || root)?.querySelector('input[name="q"],textarea[name="q"]');
      if(this.ownHeader?.native===native && this.ownHeader.chip.isConnected && this.ownHeader.input===input && this.ownHeader.list===route.list)return;
      this.clearOwnListHeader();
      // Reddit's own scope pill markup: leading icon, label, trailing close icon; the whole pill removes it.
      // One pill element per list is kept and moved back after Reddit re-renders its header: a moved pill keeps
      // its rendering, while a fresh one is blank until Reddit's component draws it (a visible blink).
      this.listChips ||= new Map();let chip=this.listChips.get(route.list);const label=listLabel(route.list),placeholder=route.list==='removed'?'Search your removed posts and comments':'Search your '+route.list;
      if(!chip){
        chip=globalThis.RTFeedFilters?.parsedElement?.('rpl-input-chip',native.className) || make('rpl-input-chip',native.className);
        chip.dataset.rtListChip=route.list;chip.dataset.rtUi='own-list-chip';
        chip.setAttribute('aria-label','Remove '+label+' filter and search your whole profile');chip.style.marginInlineStart='4px';chip.setAttribute('role','button');chip.tabIndex=0;
        const lead=make('span');lead.slot='leading';const holder=make('div','w-full h-full flex justify-center items-center');holder.append(route.list==='removed'?glyph('removed'):redditIcon(listIcons[route.list],16));lead.append(holder);
        const text=make('span','whitespace-nowrap overflow-hidden text-ellipsis text-label-2',label);text.setAttribute('aria-hidden','true');
        const trail=make('span','flex items-center ms-2xs');trail.slot='trailing';trail.append(redditIcon('close',12));chip.append(lead,text,trail);
        const remove=event=>{event.preventDefault();event.stopImmediatePropagation();const now=pageRoute();this.ownHeaderDismissed=location.pathname+':'+(new URLSearchParams(location.search).get('rt_list') || '');this.clearOwnListHeader();if(now?.view==='search')this.navigateProfileSearch(now,now.q,false);};
        chip.addEventListener('click',remove,true);chip.addEventListener('keydown',event=>{if(event.key==='Enter' || event.key===' ' || event.key==='Backspace' || event.key==='Delete')remove(event);},true);
        this.listChips.set(route.list,chip);
      }
      chip.className=native.className;chip.setAttribute('slot',native.getAttribute('slot') || 'chips');
      for(const [key,value] of [['appearance','bordered'],['type','standalone'],['selected','']])chip.setAttribute(key,native.getAttribute(key) ?? value);
      if(native.nextSibling!==chip)native.after(chip);
      const placeholders=[...new Set([field,input].filter(Boolean))].map(node=>[node,node.getAttribute('placeholder')]);for(const [node] of placeholders)node.setAttribute('placeholder',placeholder);
      this.ownHeader={chip,native,host,field,form,input,list:route.list,placeholder,placeholders,scope:host.getAttribute('scope')};form?.addEventListener('submit',this.onOwnSubmit,true);
      this.ownHeaderObserver=new MutationObserver(()=>this.syncOwnListHeader());
      this.ownHeaderObserver.observe(root,{childList:true,subtree:true});this.ownHeaderObserver.observe(host,{attributes:true,attributeFilter:['scope']});
      if(field?.shadowRoot)this.ownHeaderObserver.observe(field.shadowRoot,{childList:true,subtree:true});
      // Capture removal before Reddit hydrates/replaces its scope control.
      const nativeRemove=native.querySelector('button,[aria-label^="Remove"]') || native;
      this.ownHeader.nativeRemove=nativeRemove;this.ownHeader.onNativeRemove=()=>{this.ownHeaderDismissed=routeKey;this.clearOwnListHeader();};nativeRemove.addEventListener('click',this.ownHeader.onNativeRemove,{once:true});
      this.fitHeaderChips();
    }
    // Put text into Reddit's header search (as if typed) and focus it; nothing is submitted.
    fillHeaderSearch(text){
      const host=document.querySelector('reddit-search-large'),root=host?.shadowRoot || host,field=root?.querySelector('faceplate-search-input[name="q"]');
      const input=(field?.shadowRoot || root)?.querySelector('input[name="q"],textarea[name="q"]');if(!input)return false;
      input.value=text;input.dispatchEvent(new Event('input',{bubbles:true,composed:true}));input.focus({preventScroll:true});input.setSelectionRange?.(text.length,text.length);return true;
    }
    navigateProfileSearch(route,q,withList=true){
      const params=new URLSearchParams({q});
      // Removing the list changes that scope only; native and extension filters are independent.
      if(route.view==='search' && !route.section)for(const [name,value] of new URLSearchParams(location.search))if(/^(?:sort|t|include_over_18|restrict_sr|safe_search|rt_(?:date|type|sub|sort))$/.test(name))params.set(name,value);
      if(withList && route.list)params.set('rt_list',route.list);
      if(route.view==='search' || route.list)params.set('type',['posts','comments','media'].includes(route.type)?route.type:'posts');
      const anchor=make('a');anchor.href='/user/'+encodeURIComponent(route.username)+'/search/?'+params;anchor.hidden=true;document.body.append(anchor);try{anchor.click();}finally{anchor.remove();}
    }
    submitOwnList(event){
      if(this.orphaned() || event.defaultPrevented)return false;
      if(event.type==='keydown' && (event.key!=='Enter' || event.repeat || event.isComposing || event.keyCode===229 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey))return false;
      this.syncOwnListHeader();const route=pageRoute(),filters=this.headerFilterRoot && document.querySelector('reddit-search-large')?.shadowRoot?.querySelector('[data-rt-header-filter]')?{host:document.querySelector('reddit-search-large'),form:this.headerFilterForm,input:null}:null,state=route?.list?this.ownHeader:filters;
      if(!state || !(route?.list || route?.view==='search'))return false;
      const path=event.composedPath();
      if(!(path.includes(state.host) || event.type==='submit' && path.includes(state.form)) || (event.type==='keydown' && !path[0]?.matches?.('input[name="q"],textarea[name="q"]')))return false;
      const input=event.type==='keydown'?path[0]:state.input || state.form?.querySelector('input[name="q"],textarea[name="q"]') || state.form?.querySelector('faceplate-search-input')?.shadowRoot?.querySelector('input[name="q"],textarea[name="q"]'),q=String(input?.value || '').trim();
      if(q.length>300 || /[\u0000-\u001f]/.test(q))return false;
      event.preventDefault();event.stopImmediatePropagation();this.navigateProfileSearch(route,q);return true;
    }
    // Reddit's own search controls (sort, Safe Search) link to plain profile search. In a list search a click keeps the
    // list, its type and filters: New and Old order the list by date; Relevance and Top keep its original order.
    watchOwnListLinks(){
      if(this.onOwnListLink)return;
      this.onOwnListLink=event=>{
        if(this.dead || event.defaultPrevented || event.button!==0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)return;
        const path=event.composedPath?.() || [],anchor=path.find(node=>node?.tagName==='A' && node.hasAttribute('href'));if(!anchor || anchor.closest('[data-rt-ui]'))return;
        // Only links inside Reddit's search controls; our own deliberate moves to plain profile search pass through.
        if(!path.some(node=>node?.matches?.('search-sort-dropdown-menu,filter-drawer,[id^="search_modifier"],search-results-page-tabs')))return;
        const route=pageRoute();if(route?.view!=='search' || !route.list || route.section || !this.settings.postDiscovery || this.context?.key!==route.key)return;
        let url;try{url=new URL(anchor.getAttribute('href'),location.href);}catch{return;}
        const same=path=>path.replace(/\/?$/,'/').toLowerCase();if(url.origin!==location.origin || same(url.pathname)!==same(location.pathname) || url.searchParams.has('rt_list'))return;
        event.preventDefault();event.stopImmediatePropagation();
        const next=new URLSearchParams(url.search),sorted=next.has('sort');next.delete('iId');next.set('rt_list',route.list);if(!['posts','comments','media'].includes(next.get('type')))next.set('type',route.type);
        if(sorted && !['new','old'].includes(next.get('sort')))next.delete('sort');
        for(const [name,value] of new URLSearchParams(location.search))if(/^rt_(?:date|type|sub|sort)$/.test(name) && !(sorted && name==='rt_sort') && !next.has(name))next.set(name,value);
        const link=make('a');link.href='/user/'+encodeURIComponent(route.username)+'/search/?'+next;link.hidden=true;document.body.append(link);try{link.click();}finally{link.remove();}
      };
      window.addEventListener('click',this.onOwnListLink,true);
    }
    syncOwnListTabs(){
      if(!this.isSearch())return;
      this.watchOwnListLinks();
      const id='rt-own-list-types',native=document.getElementById('search-results-page-tabgroup'),reuse=Boolean(native?.querySelector(':scope > a[href]'));
      // Reddit's own Posts / Comments / Media row is reused when the page has one, exactly as profile search shows it:
      // its links are scoped to the list and clicks navigate. Its in-flow row also sizes the sticky search header,
      // which keeps the first result clear of the filter row (measured 2026-11-16). Our copy is only for pages without it.
      if(reuse){document.getElementById(id)?.remove();if(this.listTabsShell)this.listTabsShell=null;}
      let tabs=reuse?native:document.getElementById(id);
      if(!tabs){
        const shell=document.createElement('template');shell.innerHTML='<faceplate-tabgroup class="nd:flex nd:gap-xs nd:w-fit mb-md"></faceplate-tabgroup>';tabs=this.listTabsShell=shell.content.firstElementChild;tabs.id=id;tabs.dataset.rtUi='own-list-tabs';tabs.setAttribute('appearance','hug');tabs.setAttribute('aria-label','Search result type');
        const template=native?.querySelector('a[href]') || document.querySelector('#profile-feed-tabgroup a[href]'),cls=template?.className.replace(/(?:bg-secondary-background-selected|!text-neutral-content-strong|tab-selected)/g,'') || 'button-medium px-[calc(var(--rem12)-var(--button-border-width,0px))] button-plain items-center justify-center button inline-flex';
        for(const type of ['posts','comments','media']){const tab=link('', '?type='+type,cls),body=make('span','flex items-center justify-center'),label=make('span','flex items-center gap-xs',listLabel(type));body.append(label);tab.append(body);tab.id='rt-own-list-tab-'+type;tab.setAttribute('rpl','');tabs.append(tab);}
      }
      const sort=document.querySelector('search-sort-dropdown-menu:not([hidden]),filter-drawer#search_modifier_post_sort,filter-drawer[id^="search_modifier"]'),row=sort?.closest('div.flex.items-center'),before=row || native || this.host || this.feed;
      if(!reuse && (!tabs.isConnected || row && tabs.compareDocumentPosition(row)&Node.DOCUMENT_POSITION_PRECEDING))before.before(tabs);
      this.listTabs ||= new Map();
      for(const tab of tabs.querySelectorAll('a[href]')){
        const url=new URL(tab.getAttribute('href'),location.href),type=tab.dataset.rtListType || url.searchParams.get('type') || tab.id.match(/-(posts|comments|media)$/)?.[1];
        if(!['posts','comments','media'].includes(type))continue;
        const params=new URLSearchParams(location.search);params.set('rt_list',this.context.list);params.set('type',type);
        if(!this.listTabs.has(tab)){const click=event=>{if(event.button!==0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey)return;event.preventDefault();event.stopImmediatePropagation();const anchor=make('a');anchor.href=tab.href;anchor.hidden=true;document.body.append(anchor);try{anchor.click();}finally{anchor.remove();}};this.listTabs.set(tab,{href:tab.getAttribute('href'),selected:tab.hasAttribute('faceplate-tab-selected'),current:tab.getAttribute('aria-current'),click});tab.addEventListener('click',click,true);}
        const href='/user/'+encodeURIComponent(this.context.username)+'/search/?'+params;if(tab.getAttribute('href')!==href)tab.setAttribute('href',href);
        tab.toggleAttribute('faceplate-tab-selected',type===this.context.type);if(type===this.context.type)tab.setAttribute('aria-current','page');else tab.removeAttribute('aria-current');
      }
      if(reuse)return;
      // Reddit's tab group draws only slotted tabs, up to its pages count, and its selected look is classes on the tab
      // (measured 2026-11-16): Posts, Comments and Media have one slot each, with the selected type highlighted.
      const ordered=[...tabs.querySelectorAll(':scope > a[href]')];let selectedIndex=0;
      ordered.forEach((tab,index)=>{
        const slot='page-'+(index+1);if(tab.getAttribute('slot')!==slot)tab.setAttribute('slot',slot);
        const type=tab.dataset.rtListType || new URL(tab.getAttribute('href'),location.href).searchParams.get('type'),on=type===this.context.type;if(on)selectedIndex=index+1;
        for(const name of ['bg-secondary-background-selected','!text-neutral-content-strong','tab-selected'])tab.classList.toggle(name,on);
        tab.style.backgroundColor=on?'var(--color-secondary-background-selected)':'transparent';tab.tabIndex=on?0:-1;
      });
      this.setTabgroupPages(tabs,ordered.length,selectedIndex);
    }
    // These are observed native attributes. DOM is shared with the page world; its custom-element registry and
    // JS properties need not be visible here. Attributes also configure elements that upgrade after this scan.
    setTabgroupPages(group,pages,index=0){
      const set=(name,value)=>{if(group.getAttribute(name)!==String(value))group.setAttribute(name,String(value));};
      set('pages',pages);if(index)set('pageindex',index);
      // Reddit can reset the component's pages property without touching the attribute, which then hides
      // our extra tab. Writing the attribute again makes the component redraw every requested tab.
      const drawn=group.shadowRoot?.querySelectorAll('.tablist > [role="tab"]').length;
      if(drawn && drawn!==pages){group.removeAttribute('pages');group.setAttribute('pages',String(pages));}
    }
    ownListDateRange(){
      const f=globalThis.RTFeedFilters;if(!f || this.context?.section)return null;
      const ranges=[f.dateRange(this.rtFilters || f.empty())];if(this.context?.range && this.context.range!=='all')ranges.push(f.dateRange({date:{preset:this.context.range==='day'?'24h':this.context.range}}));
      const active=ranges.filter(Boolean);if(!active.length)return null;const upper=active.map(r=>r.before).filter(Number.isFinite);return {after:Math.max(...active.map(r=>r.after)),before:upper.length?Math.min(...upper):null};
    }
    ownListDateMatch(post){const range=this.ownListDateRange();return !range || post.created>=range.after && (range.before==null || post.created<range.before);}
    ownListMatch(post){
      if(this.searchParsed?.invalid || !this.ownListDateMatch(post))return false;
      if(this.context.list==='removed' && !post.removal?.removed)return false;
      const comment=post.kind==='comment';
      if(this.context.type==='comments'?!comment:this.context.type!=='all' && comment)return false;
      if(this.context.type==='media' && !mediaTypes.includes(post.postType))return false;
      const state={...this.rtFilters,types:comment && this.context.type==='comments'?[]:this.rtFilters.types};
      return globalThis.RTFeedFilters.predicate(state)({created:post.created,kind:post.kind,subreddit:post.subreddit,postType:post.postType}) && globalThis.RCSCore.matchRecord(this.searchParsed,M.searchRecord(post));
    }
    summarizeOwnList(){
      this.syncSearchLayout();
      if(!this.status)return;const state=this.listState;
      if(!state)return;
      const error=this.searchParsed.invalid?this.searchParsed.errors.join('. '):state.error;
      if(this.context.list==='removed'){this.summarizeRemoved(error);return;}
      this.setStatus(error || 'Searched '+(this.context.list==='history'?state.items.size:state.scanned).toLocaleString('en-US')+' '+this.context.list+' items'+(state.loading?' · Loading…':''),Boolean(error));
      const notes=[];if(this.searchParsed.invalid)notes.push(error);
      if(this.context.list==='history')notes.push((this.settings.historyLimit ?? 20)===20?'History only includes your ~20 most recently viewed posts':'History grows as you browse on this device'+(this.settings.historyLimit?' (saving up to '+this.settings.historyLimit.toLocaleString('en-US')+' posts)':' (no saving limit)'));
      if(state.capped)notes.push('Reddit only returns the newest 1,000 items');
      if(state.error)notes.push('List search is incomplete. Select Refresh to retry.');
      if(this.notice){this.notice.textContent=notes.join(' · ');this.notice.hidden=!notes.length;}
      this.status.title='Searches only the list items Reddit returned in this session.';
    }
    renderOwnList(){
      const state=this.listState;if(!state || !this.feed)return;
      const posts=[...state.items.values()].filter(post=>this.ownListMatch(post)),sort=this.effectiveSort();
      if(sort==='new' || sort==='old')posts.sort((a,b)=>(sort==='old'?1:-1)*(a.created-b.created));
      // Removed merges profile items with archive-recovered deletions, so it keeps Reddit's newest-first profile order.
      else if(this.context.list==='removed')posts.sort((a,b)=>(Number(b.created) || 0)-(Number(a.created) || 0));
      // The History tab draws its cards 25 at a time as you scroll: each card is a Reddit read.
      const historyTab=this.context.section && this.context.list==='history';if(historyTab){state.revealed ||= 25;state.hiddenHistory=Math.max(0,posts.length-state.revealed);posts.length=Math.min(posts.length,state.revealed);this.observeHistoryTail();}
      for(const node of this.nodes.values())node.hidden=true;
      for(const post of posts){const key=itemKey(post);let node=this.nodes.get(key);if(!node){node=this.card(post);this.nodes.set(key,node);
          // Searches use native search rows; the Removed section uses lazy profile cards below.
          if(!this.context.section)this.showSearchUnit(post,node);
        }else if(!this.context.section && this.postMetadata.get(key)?.saved && this.postMetadata.get(key)!==post)this.showSearchUnit(post,node);
        this.postMetadata.set(key,post);if(this.context.section && post.source==='arctic-shift' && post.removal?.removed){this.renderArchivedNative(post,node);this.decorateNative(post,node);}node.hidden=false;}
      // Reddit's feed swaps off-screen cards for same-height placeholders and swaps them back on scroll. Order whatever
      // currently holds each card's place, so a re-render never pulls a swapped card back in beside its placeholder
      // (which left blanks and shifted the page), and move nothing that is already in place.
      this.flushVirtualization();const slots=new Map();for(const [placeholder,original] of this.virtualNodes || [])if(placeholder.parentElement===this.feed)slots.set(original,placeholder);
      let before=this.loading;for(const post of [...posts].reverse()){const node=this.nodes.get(itemKey(post)),slot=slots.get(node) || node;if(slot!==node)slot.hidden=node.hidden;if(slot.nextSibling!==before)this.feed.insertBefore(slot,before);before=slot;}
      for(const [original,placeholder] of slots)if(placeholder.hidden!==original.hidden)placeholder.hidden=original.hidden;
      // Cards stay undrawn (display:none) until Reddit's card is ready, so a scroll watcher never sees them: queue them.
      if(this.context.section)for(const post of posts){const node=this.nodes.get(itemKey(post));if(node.dataset.rtNativeState==='idle')this.queueNative(node);}
      this.renderedPosts=posts;this.live=new Map(state.items);this.more.hidden=true;this.renderFilterChips();this.renderSubredditOptions();this.summarizeOwnList();this.updateProfileLoading();
      if(this.isSearch()){this.updateSearchEmpty(!posts.length && !state.loading && !state.error && !state.archiveHistoryError && !this.searchParsed.invalid && state.done);return;}
      if(!this.listEmpty){this.listEmpty=make('p','rt-posts-notice');this.listEmpty.dataset.rtUi='own-list-empty';this.feed.append(this.listEmpty);}
      this.listEmpty.hidden=posts.length>0 || state.loading || Boolean(state.error) || this.searchParsed.invalid || !state.done;
      this.listEmpty.textContent=this.context.list==='removed'?this.removedEmptyText():'No matches in the '+state.scanned.toLocaleString('en-US')+' '+this.context.list+' items Reddit returned.';
    }
    /* Reddit's own no-results view (spec §30) ends every empty profile search: plain search, Removed and the other lists.
       Reddit's title is kept and names the actual query; Removed replaces the hint only while items remain unverified. */
    /* Viewed-posts History (docs/viewed-history-spec.md): Reddit's own recent views first, then the older posts this device
       recorded, newest first, without repeats, up to the History limit. Reddit's 20 reads nothing. */
    async mergeViewedHistory(state,context,current){
      const limit=this.settings.historyLimit ?? 20;if(limit===20 || !this.viewedHistory)return;
      const me=globalThis.RTNativeRemoval?.identity(document);if(!me || me.username.toLowerCase()!==context.username.toLowerCase())throw Error('Could not verify the account for recorded History.');
      const seeded=await this.viewedHistory({action:'seed',owner:me.owner,username:me.username,items:[...state.items.values()].slice(0,100)});if(!current())return;if(!seeded?.ok)throw Error(seeded?.error || 'Recent History could not be saved.');
      const result=await this.viewedHistory({action:'load',owner:me.owner,username:me.username});if(!current())return;if(!result?.ok || !Array.isArray(result.items))throw Error(result?.error || 'Recorded History could not be loaded.');
      for(const raw of result.items){
        if(limit>0 && state.items.size>=limit)break;
        const post=M.normalizePost({id:raw.id,title:raw.title,subreddit:raw.subreddit,author:raw.author,created_utc:raw.created,permalink:raw.permalink,over_18:raw.over18===true,spoiler:raw.spoiler===true,score:raw.score,num_comments:raw.comments,thumbnail:raw.thumbnail,is_self:raw.postType==='text'});
        if(!post || state.items.has(itemKey(post)))continue;if(raw.postType)post.postType=raw.postType;if(!Number.isFinite(raw.score))post.factsUnknown=true;post.viewedAt=raw.viewedAt;state.items.set(itemKey(post),post);
      }
      this.renderOwnList();
    }
    revealMoreHistory(){const state=this.listState;if(!state || !this.context?.section || this.context.list!=='history' || !state.hiddenHistory)return;state.revealed=(state.revealed || 25)+25;this.renderOwnList();}
    observeHistoryTail(){
      if(this.historyObserver || typeof IntersectionObserver!=='function' || !this.loading)return;
      this.historyObserver=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting))this.revealMoreHistory();},{rootMargin:'800px'});this.historyObserver.observe(this.loading);
    }
    updateSearchEmpty(show,slot='listEmpty'){
      let empty=this[slot];if(!show){if(empty)empty.hidden=true;return;}
      if(!empty || empty.dataset.rtUi!=='search-empty'){empty?.remove();empty=this[slot]=make('div');empty.id='rt-search-empty-'+crypto.randomUUID();empty.dataset.rtUi='search-empty';empty.setAttribute('role','status');empty.addEventListener('click',event=>{if(event.composedPath().some(node=>node?.matches?.('button,[role="button"]')))this.fillHeaderSearch(this.context?.q || '');});}
      if(empty.parentElement!==this.feed)this.feed.append(empty);
      empty.hidden=false;
      const text=()=>{
        const view=empty.querySelector('[data-testid="search-error-message"]'),leaves=[...empty.querySelectorAll('*')].filter(node=>!node.children.length);
        const title=view?.querySelector(':scope > div') || empty.querySelector('h1,h2,[role="heading"]') || leaves.find(node=>/couldn.t find any results/i.test(node.textContent));
        const description=(view?view.querySelectorAll(':scope > div')[1]:null) || empty.querySelector('p') || leaves.find(node=>/double.check your spelling/i.test(node.textContent));
        if(title){const base=title.dataset.rtBase ||= (title.textContent.match(/^\s*(.*?couldn.t find any results)/i)?.[1] || title.textContent).trim(),q=(this.context?.q || '').trim(),want=q?base+' for "'+q+'"':base;if(title.textContent!==want)title.textContent=want;}
        if(description){const base=description.dataset.rtBase ??= description.textContent.trim(),counts=this.context?.list==='removed'?this.removedCounts():null,unknown=counts?counts.unknownPosts+counts.unknownComments:0,want=unknown?unknown+' items could not be verified. Try a wider time range or adjust your filters.':base;if(description.textContent!==want)description.textContent=want;}
      };
      const failed=()=>this.setStatus(this.context?.list==='removed'?'No matching removals were found; Reddit’s empty search view could not be loaded.':'No results were found; Reddit’s empty search view could not be loaded.',true);
      if(empty.rtNativeEmptyReady){text();return;}if(empty.rtNativeEmptyFailed){failed();return;}if(empty.rtNativeEmptyTask)return;
      const generation=this.generation,context=this.context;empty.append(this.feedLoader());
      empty.rtNativeEmptyTask=this.request({action:'render-search-empty',username:context.username,target:empty.id}).then(result=>{if(this.generation!==generation || this[slot]!==empty || !empty.isConnected)return;if(!result?.rendered)throw Error('Reddit’s native empty view was unavailable.');empty.rtNativeEmptyReady=true;text();}).catch(()=>{if(this.generation!==generation || this[slot]!==empty)return;empty.replaceChildren();empty.rtNativeEmptyFailed=true;failed();}).finally(()=>{empty.rtNativeEmptyTask=null;});
    }
    async loadOwnList({resume=false}={}){
      if(!this.isOwnList() || !this.listState || this.listState.loading)return;
      if(this.searchParsed.invalid){this.summarizeOwnList();return;}
      if(!resume){for(const node of this.nodes.values())node.remove();this.nodes.clear();}
      const state=this.listState,context=this.context,generation=this.generation;
      const current=()=>!this.dead && this.listState===state && generation===this.generation && pageRoute()?.key===context.key && this.host?.isConnected;
      if(resume)state.loading=true;else{state.items.clear();state.removalNotes=new Set();state.scanned=0;state.done=false;state.capped=false;state.error='';state.loading=true;state.after=null;state.source='overview';state.postsScanned=0;state.history=null;state.archiveHistory=new Map();state.visitors={};state.liveTail={};state.liveDone=false;state.confirmedEnd=null;}
      if(this.listEmpty){this.listEmpty.hidden=true;this.listEmpty.rtNativeEmptyFailed=false;}this.discover.disabled=true;this.summarizeOwnList();this.updateProfileLoading();const cursors=new Set(resume && state.after?[state.after]:[]);
      // Saved, History and the other lists are Reddit listings that end at 1,000 items; Removed reads the whole profile.
      const removed=context.list==='removed',cap=this.ownListCap ?? (removed?removedItemBound:1000);
      if(!resume)state.window=removed && this.isSearch()?this.ownListDateRange():null;
      const inWindow=post=>!state.window || post.created>=state.window.after && (state.window.before==null || post.created<state.window.before) && (context.type==='comments'?post.kind==='comment':post.kind!=='comment');
      // Removed checks each page signed out while the next page loads: one chain keeps checks in order and paced.
      let checks=Promise.resolve();const check=(items,source)=>{checks=checks.then(()=>current()?this.classifyRemoved(items,context,source,{pool:true}):undefined).then(()=>{if(current()){this.mergeArchiveHistory();this.renderOwnList();}});checks.catch(()=>{});};
      try{
        if(removed && !resume){await this.showSavedRemoved(state,context);if(!current())return;}
        // Arctic Shift history (removed, then deleted) doesn't depend on the profile walk, so it starts with it.
        if(removed && !state.history)state.history=this.removedThenDeleted(context);
        do{
          const source=removed?state.source || 'overview':'overview',requested=state.after,reread=Boolean(requested) && state.confirmedEnd===source+':'+requested;
          const result=await this.request({action:'own-list',username:context.username,list:context.list,after:requested,...(source==='posts'?{source}:{})});if(!current())return;
          if(!Array.isArray(result.posts) || !Number.isInteger(result.scanned) || result.scanned<0 || result.scanned>100 || result.posts.length>100 || result.hasMore && result.scanned===0)throw Error('Reddit returned an unexpected list page.');
          state.native=result.transport==='native';
          // Live evidence replaces an archive record that history recovery added first for the same item.
          // A saved entry keeps its card and verdict until this item's fresh check replaces it.
          const added=[];for(const post of result.posts){if(!post?.fullname || !inWindow(post))continue;const key=itemKey(post),had=state.items.get(key);if(had && had.source!=='arctic-shift' && !had.saved)continue;if(had?.saved && had.source!=='arctic-shift')post.removal ||= had.removal;else if(had)this.dropCard(key);state.items.set(key,post);added.push(post);}
          // A confirming re-read counts only items it adds.
          const counted=reread?added.length:result.scanned;if(source==='posts')state.postsScanned+=counted;else state.scanned+=Math.min(counted,cap-state.scanned);
          // How far back this walk has read: a page's last item is its oldest (pinned posts come first on page 1).
          const last=result.posts.at(-1);if(removed && last?.created){state.liveTail ||= {};state.liveTail[source]=Math.min(state.liveTail[source] ?? Infinity,last.created);}
          if(removed && added.length)check(added,source);
          state.after=result.after || null;if(source==='overview')state.capped=state.scanned>=cap && context.list!=='history';
          if(result.hasMore && (!state.after || cursors.has(state.after)))throw Error('Reddit repeated a list cursor. List search is incomplete.');
          if(state.after)cursors.add(state.after);
          const pastWindow=Boolean(state.window && result.posts.at(-1)?.created<state.window.after),ended=pastWindow || !result.hasMore || context.list==='history' || (source==='posts'?state.postsScanned>=cap:state.capped);
          // Reddit sometimes ends the feed early with a short last page and no next link (measured 2026-11-16: once at
          // 1,283 of 2,094 items). A continuation that claims to be last is read once more before it is believed.
          if(removed && !pastWindow && !result.hasMore && requested && state.confirmedEnd!==source+':'+requested){state.confirmedEnd=source+':'+requested;state.after=requested;this.renderOwnList();continue;}
          // Then the Posts tab, always: it also covers posts if Overview was cut short or stopped at its bound (spec §26).
          if(ended && removed && source==='overview'){state.source='posts';state.after=null;cursors.clear();}
          else state.done=ended;
          this.renderOwnList();
        }while(current() && !state.done);
        if(context.list==='history'){await this.mergeViewedHistory(state,context,current);if(!current())return;}
        // Every page was read without a safety stop: anything older that it didn't list is no longer on your profile.
        if(removed && !state.capped)state.liveDone=true;
        await checks;if(!current())return;
        // Pooled archive lookups (spec §31) answer before the list is settled.
        this.flushArchiveLookups(state);await Promise.all(state.archiveLookups || []);if(!current())return;
        if(removed && state.history){await state.history;if(!current())return;this.mergeArchiveHistory();}
        if(removed && state.liveDone && !state.error)this.settleSavedRemoved(state);
      }catch(error){if(current()){state.error='Could not search your '+context.list+': '+error.message;if(/signed-in account changed|Sign in to Reddit/i.test(error.message)){state.items.clear();for(const node of this.nodes.values())node.remove();this.nodes.clear();this.clearOwnListHeader();this.ownHeaderDismissed=location.pathname+':'+context.list;this.ownIdentityChecked=false;queueMicrotask(()=>{if(!this.dead)this.scan();});}}}
      finally{if(current()){state.loading=false;this.discover.disabled=false;this.renderOwnList();}}
    }
    // Removed list (docs/own-removal-detection-spec.md U2): classify each of your items with RTRemovalModel.
    // Posts carry Reddit's own removal category; comments only count as removed when the archive captured the
    // removal (§9.1: Reddit blocks every logged-out check). Unknown is never shown as visible (R2).
    // Pooled archive removal lookups for the current list (spec §31): queued per kind, sent in requests of up to 100 IDs
    // once 100 are waiting, after a short window, or when the walk ends. Each caller gets the records for its items.
    archiveLookup(posts,context,me){
      const state=this.listState;if(!state)return Promise.resolve({archives:new Map(),failed:new Set()});
      const pool=state.archivePool ||= {queue:[],timer:null};
      return new Promise(resolve=>{
        pool.queue.push({posts,context,me,resolve});
        const waiting=pool.queue.reduce((n,entry)=>n+entry.posts.length,0);
        if(waiting>=archiveIdBatch)this.flushArchiveLookups(state);else if(!pool.timer)pool.timer=setTimeout(()=>this.flushArchiveLookups(state),this.archiveBatchMs ?? 8000);
      });
    }
    async flushArchiveLookups(state){
      const pool=state?.archivePool;if(!pool?.queue.length)return;clearTimeout(pool.timer);pool.timer=null;
      const entries=pool.queue.splice(0),archives=new Map(),failed=new Set(),{context,me}=entries[0],current=()=>this.listState===state && !this.dead;
      for(const kind of ['post','comment']){
        const ids=[...new Set(entries.flatMap(entry=>entry.posts).filter(post=>(post.kind==='comment'?'comment':'post')===kind).map(post=>post.id))];
        for(let index=0;index<ids.length && current();index+=archiveIdBatch){
          try{const result=await this.archive({action:'archive-removal',username:context.username,...(me?{owner:me.owner}:{}),kind,ids:ids.slice(index,index+archiveIdBatch)});
            for(const raw of result.posts || []){const archived=M.normalizeItem(raw,{source:'arctic-shift'});if(archived && (archived.kind==='comment')===(kind==='comment') && archived.author.toLowerCase()===context.username.toLowerCase())archives.set(archived.fullname,archived);}}
          catch(error){failed.add(kind);state.removalNotes?.add('The archive didn’t answer ('+error.message.replace(/\.$/,'')+'); some '+(kind==='comment'?'comments':'posts')+' couldn’t be checked');break;}
        }
      }
      for(const entry of entries)entry.resolve({archives,failed});
    }
    async classifyRemoved(items,context,source='overview',{pool=false}={}){
      const R=globalThis.RTRemovalModel,state=this.listState;if(!R || !state)return;
      state.removalNotes ||= new Set();
      const author=post=>{const m=post.moderation || {};return {kind:post.kind==='comment'?'comment':'post',name:post.fullname,body:m.authorBody ?? post.body,selftext:m.authorBody ?? post.body,...(post.kind==='comment'?{}:{title:post.title || ''}),
        created_utc:post.created,removed_by_category:m.category ?? null,removal_reason:m.removalReason || null,locked:m.locked===true,subreddit_type:m.subredditType || 'public',quarantine:m.quarantined===true,visibilityKnown:m.visibilityKnown!==false,nativeRemoved:m.nativeRemoved===true};};
      const publicProofs=new Map(),me=globalThis.RTNativeRemoval?.identity(document),generation=this.generation,current=()=>this.listState===state && this.context===context && this.generation===generation;state.publicChecks=Boolean(me && me.username.toLowerCase()===context.username.toLowerCase());
      // Spec §18 P6: signed-out results checked recently (kept per account by the worker) are reused, so reopening the
      // view only reads what is new. Text is never stored.
      if(state.publicChecks && !state.cache){state.cache=new Map();try{const r=await this.removalCache({action:'proofs-load',owner:me.owner,username:me.username});for(const [fullname,proof] of Object.entries(r?.proofs || {}))state.cache.set(fullname,proof);}catch{}if(!current())return;}
      if(state.cache)for(const post of items){const cached=state.cache.get(post.fullname);if(cached)publicProofs.set(post.fullname,{fullname:post.fullname,status:cached.status,verified:true,source:'cache',checkedAt:cached.checkedAt});}
      // Spec §18: compare with your profile as a signed-out visitor sees it (bulk, page by page). Only items the visitor
      // didn't see get a direct signed-out check, paced.
      const uncached=items.filter(post=>!publicProofs.has(post.fullname));
      const visitor=state.publicChecks && uncached.length?await this.visitorPages(uncached,me,source):null;if(state.publicChecks && !current())return;
      state.directChecks ||= 0;state.hiddenChecks ||= 0;
      // Communities a visitor never sees on your profile are hidden by your profile settings (Reddit's profile
      // curation), not removed: their items get a smaller budget of their own, after the real differences.
      const shownSub=post=>!visitor || visitor.failed || !visitor.subs.size || visitor.subs.has(String(post.subreddit || '').toLowerCase());
      if(visitor)for(const post of uncached)if(visitor.seen.has(post.fullname))publicProofs.set(post.fullname,{fullname:post.fullname,status:'visible',verified:true,source:'signed-out-profile'});
      // Verify current visibility before asking the archive. Missing profile entries may simply be curated or stale.
      const unseen=items.filter(post=>!publicProofs.has(post.fullname));
      const ordered=[...unseen.filter(shownSub),...unseen.filter(post=>!shownSub(post))];
      if(me && me.username.toLowerCase()===context.username.toLowerCase())for(const post of ordered){
        if(!current())return;if(globalThis.RTNativeRemoval.identity(document)?.owner!==me.owner)throw Error('The signed-in account changed.');
        const hidden=!shownSub(post);if(hidden)state.removalNotes.add('Some items are in communities a signed-out visitor doesn’t see on your profile (likely hidden by your profile settings); those were checked one by one.');
        // Every remaining item gets one paced signed-out check (about one a second); a refusal stops the rest.
        if(state.directStopped){publicProofs.set(post.fullname,{status:'unknown',verified:false});continue;}
        if(hidden)state.hiddenChecks++;else state.directChecks++;
        const gap=this.removalGapMs ?? 1000,wait=state.lastDirect?Math.max(0,gap-(Date.now()-state.lastDirect)):0;if(wait)await new Promise(resolve=>setTimeout(resolve,wait));state.lastDirect=Date.now();if(!current())return;
        try{const result=await this.request({action:'removal-public',owner:me.owner,username:me.username,fullname:post.fullname});if(!current())return;const proof=result.proof;
          if(proof?.verified===true && proof.fullname===post.fullname)publicProofs.set(post.fullname,proof);else{publicProofs.set(post.fullname,{status:'unknown',verified:false});state.removalNotes.add('Some signed-out checks were unavailable. Missing results are not removal evidence.');
            if(/HTTP 403|HTTP 429|rate limit|blocked/i.test(proof?.why || '')){state.directStopped=true;state.removalNotes.add('Reddit paused signed-out checks, so the rest weren’t checked. Refresh later to continue.');}}}
        catch(error){if(!current())return;if(globalThis.RTNativeRemoval.identity(document)?.owner!==me.owner || /account changed/i.test(error.message))throw Error('The signed-in account changed.');publicProofs.set(post.fullname,{status:'unknown',verified:false});state.removalNotes.add('Some signed-out checks were unavailable. Missing results are not removal evidence.');}
      }
      const candidates=items.filter(post=>{const proof=publicProofs.get(post.fullname),verdict=R.classify({author:{...author(post),visibilityKnown:false},publicView:proof?.verified?{verified:true,visibility:proof.status,moderation:proof.moderation}:proof?{status:'failed'}:null,archiveStatus:'off'});return (post.kind==='comment' || post.moderation?.native) && !['visible','deleted','removed-mod','removed-auto','removed-admin','removed-filter'].includes(verdict.state) && !['private','employees_only','gold_restricted'].includes(post.moderation?.subredditType) && !post.moderation?.quarantined;}),archives=new Map();let archiveStatus=this.settings.archiveDiscovery?'ok':'off';
      // Items needing archive evidence are looked up together. During a profile walk (pool) the lookups of several pages
      // share one Arctic Shift request (spec §31) and their verdicts follow when it answers; everything else is
      // classified now, exactly as before.
      const classify=(posts,archives,statusOf)=>{for(const post of posts){
        const archived=archives.get(post.fullname),archive=archived?{kind:post.kind==='comment'?'comment':'post',...(post.kind==='comment'?{}:{title:archived.title || ''}),body:archived.archiveStatus==='removed'?'[removed]':archived.body,created_utc:archived.created,retrieved_on:archived.retrieved || 0}:null;
        const proof=publicProofs.get(post.fullname),publicView=proof?.verified?{verified:true,visibility:proof.status,moderation:proof.moderation}:proof?{status:'failed'}:null,status=statusOf(post);
        if(proof)post.publicStatus=proof.verified?proof.status:'unknown';
        post.removal=R.classify({author:{...author(post),...(proof?{visibilityKnown:false}:{})},publicView,archive,archiveStatus:archive?'ok':post.kind==='comment' && status==='ok'?'missing':status});
      }};
      const lookup=archiveStatus==='ok'?candidates:[],waiting=new Set(lookup);
      classify(items.filter(post=>!waiting.has(post)),archives,()=>archiveStatus);
      if(lookup.length){
        const task=this.archiveLookup(lookup,context,me).then(({archives:found,failed})=>{if(!current())return;classify(lookup,found,post=>failed.has(post.kind==='comment'?'comment':'post')?'failed':'ok');if(pool){this.mergeArchiveHistory();this.renderOwnList();}});
        if(pool)(state.archiveLookups ||= []).push(task);else{this.flushArchiveLookups(state);await task;if(!current())return;}
      }
      // Keep this batch's new signed-out results (status and time only) for the next visit.
      if(state.publicChecks && me){
        const dates=new Map(items.map(post=>[post.fullname,Number(post.created) || 0]));
        const fresh=[];for(const [fullname,proof] of publicProofs)if(proof?.verified && proof.source!=='cache' && ['visible','removed','deleted'].includes(proof.status)){const value={fullname,status:proof.status,checkedAt:Number(proof.checkedAt) || Date.now(),...(dates.get(fullname)?{created:dates.get(fullname)}:{})};fresh.push(value);state.cache?.set(fullname,{status:value.status,checkedAt:value.checkedAt});}
        for(let i=0;i<fresh.length;i+=500)Promise.resolve(this.removalCache({action:'proofs-save',owner:me.owner,username:me.username,proofs:fresh.slice(i,i+500)})).catch(()=>{});
      }
    }
    /* Removed, then deleted by you (spec §18 P3): your Arctic Shift history over the time the profile walk covered.
       Items no longer on your profile that the archive recorded as removed by moderators, Reddit or AutoModerator are
       added; self-deleted items are not. Only with "Use the archive" on. */
    // A record from your archive history joins the list when nothing live has it, or when the live item turned out
    // self-deleted. A live item that is still being checked waits; mergeArchiveHistory runs again after each check.
    // The profile walk is newest first: once it has passed an item's date without listing it, the item is not on your
    // profile. Posts also count the Posts tab walk; a completed walk has passed everything (spec §27).
    livePassed(item){
      const state=this.listState,tail=state?.liveTail || {};if(state?.liveDone)return true;
      return (tail.overview ?? Infinity)<item.created || item.kind!=='comment' && (tail.posts ?? Infinity)<item.created;
    }
    mergeArchiveItem(key){
      const state=this.listState,R=globalThis.RTRemovalModel,item=state?.archiveHistory?.get(key);if(!item || !R?.afterDeletion)return false;
      const existing=state.items.get(key),live=existing && !existing.saved?existing:null;if(live?.source==='arctic-shift' || live && live.removal?.state!=='deleted')return false;
      if(!live && !this.livePassed(item))return false;
      // A saved archive card for the same item is kept and redrawn in place; anything else gets a new card.
      const removal=R.afterDeletion(item,{deleted:Boolean(live),absent:!live});if(!removal)return false;item.removal=removal;if(existing && !(existing.saved && existing.source==='arctic-shift'))this.dropCard(key);state.items.set(key,item);return true;
    }
    /* The saved Removed list (spec §27): shown at once on open, so search and the list answer before the walk does.
       Each entry is marked saved until a fresh check replaces it; a complete walk drops the rest and saves its result. */
    async showSavedRemoved(state,context){
      const me=globalThis.RTNativeRemoval?.identity(document),R=globalThis.RTRemovalModel;if(!me || !R || !this.removalCache || me.username.toLowerCase()!==context.username.toLowerCase())return;
      // Opening Removed reviews your removals: it acknowledges new changes (the toolbar count) for this account.
      Promise.resolve().then(()=>this.removalCache({action:'list-seen',owner:me.owner,username:me.username})).catch(()=>{});
      let saved;try{saved=await this.removalCache({action:'list-load',owner:me.owner,username:me.username});}catch{return;}if(this.listState!==state || !Array.isArray(saved?.items))return;
      state.savedHistoryAt=Number.isFinite(saved.historyAt) && saved.historyAt>0?saved.historyAt:0;
      for(const raw of saved.items){
        if(raw.source==='arctic-shift' && !this.settings.archiveDiscovery || !R.STATES[raw.removal?.state])continue;
        const source=raw.source==='arctic-shift'?{source:'arctic-shift'}:undefined,base={id:raw.id,author:context.username,subreddit:raw.subreddit,created_utc:raw.created,score:raw.score,num_comments:raw.comments,postScore:raw.postScore,postComments:raw.postComments,thumbnail:raw.thumbnail,permalink:raw.permalink,over_18:raw.over18,spoiler:raw.spoiler};
        const post=raw.kind==='comment'?M.normalizeComment({...base,body:raw.body,link_title:raw.title,link_id:'t3_'+(raw.permalink.match(/\/comments\/([a-z0-9]+)\//i)?.[1] || '')},source):M.normalizePost({...base,title:raw.title,selftext:raw.body,is_self:true},source);
        if(!post || state.items.has(itemKey(post)))continue;if(raw.postType)post.postType=raw.postType;if(!Number.isFinite(raw.score))post.factsUnknown=true;
        post.removal={state:raw.removal.state,label:R.STATES[raw.removal.state].label,confidence:raw.removal.confidence,why:raw.removal.why,flags:[...raw.removal.flags],removed:true};post.saved=true;
        state.items.set(itemKey(post),post);
      }
      if(state.items.size)this.renderOwnList();
    }
    settleSavedRemoved(state){
      const keepArchive=state.archiveHistoryError || !this.settings.archiveDiscovery;
      // An incremental history read didn't re-read archive removals older than its floor: those stay from the saved list.
      const unread=post=>post.source==='arctic-shift' && state.historyFloor!=null && !state.archiveHistoryError && post.created<state.historyFloor;
      for(const [key,post] of state.items)if(post.saved && !(keepArchive && post.source==='arctic-shift') && !unread(post)){state.items.delete(key);this.dropCard(key);}
      this.renderOwnList();
      if(state.window)return; // A date-window search never replaces the saved whole-account result.
      const me=globalThis.RTNativeRemoval?.identity(document);if(!me || !this.removalCache)return;
      const items=[...state.items.values()].filter(post=>post.removal?.removed).slice(0,2000).map(post=>({fullname:post.fullname,kind:post.kind==='comment'?'comment':'post',id:post.id,created:post.created,subreddit:post.subreddit,permalink:post.permalink,title:post.title || '',body:post.source==='arctic-shift'?post.body:post.moderation?.authorBody ?? post.body,source:post.source==='arctic-shift'?'arctic-shift':'reddit',postType:post.postType || '',score:post.score,comments:post.comments,postScore:post.postScore,postComments:post.postComments,thumbnail:(post.media || []).map(m=>m.kind==='video'?m.poster:m.url).find(Boolean) || post.thumbnail || '',over18:post.over18===true,spoiler:post.spoiler===true,removal:{state:post.removal.state,confidence:post.removal.confidence,why:post.removal.why,flags:post.removal.flags || []}}));
      Promise.resolve(this.removalCache({action:'list-save',owner:me.owner,username:me.username,items,historyAt:state.historyComplete?state.historyStartedAt:state.historyFloor!=null && !state.archiveHistoryError?state.savedHistoryAt:0})).catch(()=>{});
    }
    // The card was drawn for a different record of this item (live or archived); the next render draws a new one.
    dropCard(key){const node=this.nodes.get(key);if(!node)return;this.nativeObserver?.unobserve?.(node);node.remove();this.nodes.delete(key);this.postMetadata?.delete(key);}
    mergeArchiveHistory(){let merged=0;for(const key of this.listState?.archiveHistory?.keys() || [])if(this.mergeArchiveItem(key))merged++;return merged;}
    async removedThenDeleted(context){
      const state=this.listState,R=globalThis.RTRemovalModel;if(!state || !R?.afterDeletion)return;const generation=this.generation,current=()=>!this.dead && this.listState===state && this.context===context && this.generation===generation && pageRoute()?.key===context.key;const me=globalThis.RTNativeRemoval?.identity(document);
      if(!this.settings.archiveDiscovery){state.removalNotes.add('Turn on “Use the archive” to include items you deleted after a removal.');return;}
      let added=0;state.archiveHistoryError=false;
      // Arctic Shift is community-run (spec §31): within a week of a complete history read, read only history newer than
      // it, less 2 days (the archive re-captures items about 36 h after posting). Older archive-only removals come
      // from the saved list. Otherwise, or after a week, read the whole history again.
      const startedAt=Date.now(),savedAt=state.savedHistoryAt || 0,floor=!state.window && savedAt>0 && startedAt-savedAt<historyFullMs?Math.floor(savedAt/1000)-2*86400:null;
      state.historyFloor=floor;state.historyComplete=false;let complete=true;
      const kinds=state.window?[context.type==='comments'?'comment':'post']:['post','comment'];
      for(const kind of kinds){
        let before=state.window?.before ?? null;const cursors=new Set();
        const historyPages=this.removedHistoryPages ?? removedHistoryPages;
        for(let page=0;page<historyPages;page++){
          if(!current())return;
          // Arctic Shift sometimes refuses a heavy author query once (HTTP 422) and answers the next try.
          let result,failure=null;
          for(let attempt=0;attempt<3;attempt++){
            try{result=await this.archive({action:'archive-profile',username:context.username,kind,...(me?{purpose:'removal-history',owner:me.owner}:{}),...(before?{before}:{})});failure=null;break;}
            catch(error){failure=error;if(!current())return;if(/turned off|preference|account changed|forbidden/i.test(error.message || ''))break;if(attempt<2)await new Promise(resolve=>setTimeout(resolve,this.archiveRetryMs ?? 2000));}
          }
          if(failure){if(!current())return;complete=false;state.archiveHistoryError=true;state.removalNotes.add('The archive didn’t answer for deleted items ('+String(failure.message || 'request failed').replace(/\.$/,'')+')');break;}
          if(!current())return;
          const found=(result?.posts || []).map(raw=>raw?.kind && raw.kind!==kind?null:(kind==='comment'?M.normalizeComment:M.normalizePost)(raw,{source:'arctic-shift'})).filter(Boolean);
          for(const item of found){
            if((item.kind==='comment'?'comment':'post')!==kind || item.author.toLowerCase()!==context.username.toLowerCase() || state.window && (item.created<state.window.after || state.window.before!=null && item.created>=state.window.before))continue;
            const key=itemKey(item);state.archiveHistory ||= new Map();if(!state.archiveHistory.has(key))state.archiveHistory.set(key,item);if(this.mergeArchiveItem(key))added++;
          }
          if(added)this.renderOwnList();
          if(state.window && found.some(item=>item.created<state.window.after) || floor!=null && found.some(item=>item.created<floor) || !result?.hasMore)break;
          if(result.cursorStalled || !found.length || !Number.isSafeInteger(result.before) || result.before<=0 || before!=null && result.before>=before || cursors.has(result.before)){complete=false;state.removalNotes.add('Archive pagination stalled for '+kind+' history; coverage is incomplete.');break;}
          if(page===historyPages-1){complete=false;state.removalNotes.add('Archive '+kind+' history stopped at '+historyPages+' pages; coverage is incomplete.');break;}
          before=result.before;cursors.add(before);
        }
      }
      state.historyComplete=complete && floor==null && !state.window && !state.archiveHistoryError;state.historyStartedAt=startedAt;
      if(added)this.renderOwnList();
    }
    // Your profile as a signed-out visitor sees it, newest first, read only as far back as the items being checked
    // (spec §18). Page 1 can be a cached copy, so newer items simply aren't seen and get direct checks instead.
    async visitorPages(items,me,source='overview'){
      const state=this.listState,visitors=state.visitors ||= {},v=visitors[source] ||= {seen:new Set(),subs:new Set(),after:null,done:false,failed:false,tail:Infinity,pages:0};
      const floor=Math.min(...items.map(p=>Number(p.created) || 0));
      while(!v.done && !v.failed && v.tail>=floor && v.pages<(this.removedVisitorPages ?? removedVisitorPages)){
        try{
          const r=await this.request({action:'removal-public-profile',owner:me.owner,username:me.username,...(source==='posts'?{source}:{}),...(v.after?{after:v.after}:{})});if(this.listState!==state)return v;
          v.pages++;const list=r?.items || [];for(const item of list)if(item?.fullname){v.seen.add(item.fullname);if(item.subreddit)v.subs.add(String(item.subreddit).toLowerCase());}
          // A page's last item is its oldest (pinned posts come first on page 1).
          const last=list.at(-1);if(last?.created)v.tail=Math.min(v.tail,last.created);
          if(!r?.after || !list.length)v.done=true;else v.after=r.after;
        }catch(error){if(this.listState!==state)return v;v.failed=true;state.removalNotes ||= new Set();state.removalNotes.add('The signed-out profile couldn’t be read ('+String(error.message || 'request failed').replace(/\.$/,'')+'); items were checked one by one instead.');}
      }
      return v;
    }
    // Removed counts follow the selected tab (All, Posts, Comments) and the applied filters, like the rows below them.
    removedScope(post){
      const comment=post.kind==='comment',type=this.context?.type || 'all';
      if(type==='comments'?!comment:type!=='all' && comment)return false;
      const state={...this.rtFilters,types:comment && type==='comments'?[]:this.rtFilters?.types || []};
      return this.ownListDateMatch(post) && (!this.rtFilters || globalThis.RTFeedFilters.predicate(state)({created:post.created,kind:post.kind,subreddit:post.subreddit,postType:post.postType}));
    }
    removedCounts(){
      const counts={checked:0,removed:0,unknownComments:0,unknownPosts:0,deleted:0,publicVisible:0,observed:0};
      for(const post of this.listState?.items.values() || []){const r=post.removal;if(!r || !this.removedScope(post))continue;counts.observed++;if(r.removed)counts.removed++;if(r.state==='visible' && post.publicStatus==='visible')counts.publicVisible++;if(r.state==='deleted')counts.deleted++;if(r.state!=='unknown')counts.checked++;else if(post.kind==='comment')counts.unknownComments++;else counts.unknownPosts++;}
      return counts;
    }
    summarizeRemoved(error){
      const state=this.listState,counts=this.removedCounts(),n=value=>value.toLocaleString('en-US');if(this.context.section && this.discover)this.discover.hidden=!this.settingsError;
      // On the Posts or Comments tab, or with filters, the counts describe only what that view lists.
      const type=this.context?.type || 'all',scoped=type!=='all' || globalThis.RTFeedFilters?.isActive?.(this.rtFilters),what=type==='posts'?'posts':type==='comments'?'comments':'posts and comments';
      this.setStatus(error || (state.native?'Observed ':'Checked your newest ')+n(scoped || state.native?counts.observed:state.scanned)+' '+what+(scoped && type==='all'?' in this view':'')+' · '+n(counts.removed)+' removed'+(state.publicChecks?' · '+n(counts.publicVisible)+' readable signed out':'')+(state.loading?' · Loading…':''),Boolean(error));
      const notes=[];if(this.searchParsed.invalid)notes.push(error);
      if(counts.unknownComments)notes.push(n(counts.unknownComments)+' '+(counts.unknownComments===1?'comment':'comments')+(state.publicChecks?' couldn’t be checked: the signed-out item view was unavailable or unreadable':' couldn’t be checked: a signed-out item check is unavailable'+(this.settings.archiveDiscovery?'':'. Turn on “Use the archive” to catch removals the archive saw')));
      if(counts.unknownPosts)notes.push(counts.unknownPosts.toLocaleString('en-US')+' '+(counts.unknownPosts===1?'post':'posts')+(state.publicChecks?' couldn’t be checked: the signed-out item view was unavailable or unreadable':' couldn’t be checked: native metadata does not establish public visibility'));
      for(const note of state.removalNotes || [])notes.push(note);
      // U3: exact-item reads do not establish account-wide profile visibility.
      notes.push('Couldn’t check whether others can see your profile: account-level verification is not implemented');
      // A walk that reached the end of your profile covers everything Reddit lists; only a safety stop is incomplete.
      if(state.capped)notes.push('Stopped after '+n(state.scanned)+' profile items (a safety limit); older items were checked through your Posts tab and the archive only');
      // Removed has no refresh button (spec §27): reloading the page shows the saved list at once and checks again.
      if(state.error)notes.push(this.context.section?'The check is incomplete. Reload the page to retry.':'The check is incomplete. Select Refresh to retry.');
      // One short line; every reason is in its tooltip.
      const unknown=counts.unknownComments+counts.unknownPosts,line=[];
      if(this.searchParsed.invalid && error)line.push(error);
      if(unknown)line.push(n(unknown)+' couldn’t be checked');
      if(state.capped)line.push('stopped at '+n(state.scanned)+' items');
      if(state.error)line.push(this.context.section?'incomplete · reload to retry':'incomplete · Refresh to retry');
      if(this.notice){this.notice.textContent=line.join(' · ');this.notice.title=notes.join('\n');this.notice.hidden=!line.length;}
      this.status.title='Shows your posts and comments that others can’t see, as far as Reddit and the archive tell us. Nothing is edited or reported.';
    }
    removedEmptyText(){
      const counts=this.removedCounts();
      return 'No removals found in the '+counts.checked.toLocaleString('en-US')+' '+(counts.checked===1?'item':'items')+' that could be checked.';
    }
    isOwnList(){return Boolean(this.context?.list && this.context.view==='search');}
    isSearch(){return this.context?.view==='search' && !this.context.section;}
    searchKind(){return this.context?.type==='comments'?'comment':'post';}
    effectiveSort(){return this.isSearch() || this.isOwnList()?(this.rtFilters?.sort || this.context.sort):this.context?.sort;}
    clientSearchOn(){return !this.archiveOnly && !this.oldSort() && !this.searchParsed?.invalid;}
    readFilters(context=this.context){
      const f=globalThis.RTFeedFilters;if(!f)return null;if(context?.section)return f.empty();const state=f.read(location);
      if(context?.view!=='search')return state;
      const p=new URLSearchParams(location.search),sort=p.get('rt_sort');
      state.sort=(context.list?['list','new','old']:searchSorts).includes(sort) && (sort!=='relevance' || context.q)?sort:null;
      if(!p.has('rt_date') && context.range!=='all')state.date={preset:context.range==='day'?'24h':context.range};
      return state;
    }
    reattachSearchView(){
      const main=document.querySelector('main#main-content,main[role="main"],main');if(!main || this.host.contains(this.feed))return false;
      if(this.context.section){const fresh=this.mountRemovedFeed(main);if(!fresh)return false;fresh.replaceWith(this.feed);this.searchFeed=this.feed;this.feed.before(this.host);return true;}
      const results=[...main.children].find(el=>el.matches('div.bg-neutral-background') && !el.querySelector('#search-results-page-tabgroup')),tabs=main.querySelector('#search-results-page-tabgroup');
      if(results)results.before(this.feed);else if(tabs){let row=tabs;while(row.parentElement!==main)row=row.parentElement;row.after(this.feed);}else main.append(this.feed);
      this.feed.before(this.host);this.scopeSwitcher?.remove();this.scopeSwitcher=null;this.searchHidden ||= new Map();
      if(this.controlsTarget && !this.controlsTarget.isConnected){this.clearActivityMenu();}
      return this.feed.isConnected && this.host.isConnected;
    }
    syncRemovedChrome(){
      if(!this.context?.section)return;const main=this.feed?.closest('main');if(!main)return;
      const protectedNode=node=>node===main || node.matches('aside,#right-sidebar-container') || node.closest('shreddit-feed,aside,[data-rt-ui]') || node.contains(this.feed) || node.contains(this.host) || node.querySelector('#profile-feed-tabgroup,h1,[data-testid="profile-display-name"]');
      const hidden=new Set(),hide=node=>{if(!node || protectedNode(node))return false;this.searchHidden ||= new Map();if(!this.searchHidden.has(node))this.searchHidden.set(node,node.hidden);node.hidden=true;node.setAttribute('data-rt-search-hidden','');hidden.add(node);return true;};
      for(const node of main.querySelectorAll('create-post-entry-point-wrapper,shreddit-composer,[data-testid="create-post"],a[href$="/submit"],a[href$="/submit/"],a[href*="/submit?"],button[aria-label="Create post" i],rpl-dropdown:has(button[aria-label="Feed options"]),shreddit-sort-dropdown,shreddit-layout-switcher,[data-testid="feed-view-toggle"]'))hide(node);
      // Remove empty wrapper space as well, without touching the profile heading, tab strip, sidebar or card actions.
      for(const start of [...hidden])for(let parent=start.parentElement;parent && !protectedNode(parent);parent=parent.parentElement){
        const text=[...parent.childNodes].some(n=>n.nodeType===3 && n.textContent.trim());
        if(text || ![...parent.children].every(child=>child.hidden || child.matches('script,style') || !child.childElementCount && !child.textContent.trim()))break;
        if(!hide(parent))break;
      }
    }
    mountRemovedFeed(main){
      const native=main.querySelector('shreddit-feed:not([data-rt-ui])');if(!native && !document.querySelector('#profile-feed-tabgroup'))return null;
      this.searchHidden ||= new Map();
      for(const node of [native,...main.querySelectorAll('#empty-feed-content,[data-testid="empty-state"]')].filter(Boolean)){if(!this.searchHidden.has(node))this.searchHidden.set(node,node.hidden);node.hidden=true;node.setAttribute('data-rt-search-hidden','');}
      const feed=this.searchFeed=make('shreddit-feed','nd:visible');feed.dataset.rtUi='removed-feed';if(native)native.before(feed);else main.append(feed);return feed;
    }
    mountSearchFeed(main){
      // A native feed lets the profile renderer own cards, hydration, virtualization
      // and the continuation sentinel, while Reddit retains its SPA search tabs.
      const existing=main.querySelector('[data-rt-archive-feed]');if(existing)return existing;
      // Tabs can be outside main, and an empty-query page may never render a
      // result unit. Keep requiring native search evidence so outgoing profile
      // DOM is left alone; the debounced page observer retries late arrivals.
      if(!pageRoute()?.list && !document.querySelector('#search-results-page-tabgroup') && !main.querySelector('[data-testid="search-sdui-post"],[data-testid="search-sdui-comment-unit"],[data-testid="search-error-message"]'))return null;
      const feed=this.searchFeed=make('shreddit-feed','nd:visible');feed.dataset.rtUi='search-feed';
      const results=[...main.children].find(el=>el.matches('div.bg-neutral-background') && !el.querySelector('#search-results-page-tabgroup'));
      const tabs=main.querySelector('#search-results-page-tabgroup');
      if(results)results.before(feed);else if(tabs){let row=tabs;while(row.parentElement!==main)row=row.parentElement;row.after(feed);}else main.append(feed);
      return feed;
    }
    suppressSearchPage(){
      if(!this.isSearch() || this.archiveOnly)return;
      const hide=node=>{if(!node || node.matches('main,body,html,#search-results-page-tabgroup') || node.closest('[data-rt-ui],#search-results-page-tabgroup') || node.querySelector('[data-rt-ui],#search-results-page-tabgroup'))return;
        this.searchHidden ||= new Map();if(!this.searchHidden.has(node))this.searchHidden.set(node,node.hidden);node.hidden=true;node.setAttribute('data-rt-search-hidden','');};
      const main=this.feed.closest('main');
      for(const el of main?.children || [])if(el.matches('div.bg-neutral-background'))hide(el);
      // Reddit's "Show results from all of Reddit" sits inside its hidden results block; show a copy above ours.
      const switcher=main?.querySelector('[data-search-hidden] [data-testid="search-scope-switcher"],[data-rt-search-hidden] [data-testid="search-scope-switcher"]');
      if(switcher && !this.scopeSwitcher?.isConnected){const copy=switcher.cloneNode(true);copy.dataset.rtUi='search-scope-switcher';copy.removeAttribute('data-testid');this.feed.before(copy);this.scopeSwitcher=copy;}
      // Keep the feedback actions and border with the question. Only climb
      // through an isolated banner branch, never through other search content.
      for(const el of main?.querySelectorAll('*') || [])if([...el.childNodes].some(n=>n.nodeType===3 && /did you find what you were looking for\?/i.test(n.textContent))){
        let box=el.closest('div,section,aside') || el;
        while(box.parentElement && box.parentElement!==main){
          const parent=box.parentElement;
          if(parent.matches('main,body,html') || parent.querySelector('[data-rt-ui],#search-results-page-tabgroup,[data-testid="search-scope-switcher"],[data-testid="search-sdui-post"],[data-testid="search-sdui-comment-unit"]'))break;
          if([...parent.children].some(child=>child!==box && child.textContent.trim() && !child.matches('button,[role="button"]') && !child.querySelector('button,[role="button"]')))break;
          box=parent;
        }
        hide(box);
      }
      for(const unit of main?.querySelectorAll('[data-testid="search-sdui-post"],[data-testid="search-post-unit"],[data-testid="search-sdui-comment-unit"],[data-testid="search-error-message"],#empty-search-results,shreddit-search-load-more,faceplate-partial[loading],shreddit-feed-load-more-observer') || [])hide(unit);
      // The search sort/time controls live outside main in some Reddit layouts.
      for(const spacer of document.querySelectorAll('[data-testid="search-results-filter-spacer-desktop"],[data-testid="search-results-filter-spacer-mobile"]')){
        for(const child of spacer.children)hide(child);
      }
      // Some layouts have neither filter spacers nor sort links. Locate the
      // smallest shared row of native dropdown triggers in a sibling branch of
      // the tabs. Require sort and time controls (Safe Search is not always
      // present) and stop at protected content.
      const tabs=document.getElementById('search-results-page-tabgroup');
      const triggers='button,[role="button"],[aria-haspopup],[slot="trigger"]';
      const kinds=node=>new Set([...node.querySelectorAll(triggers)].filter(el=>!el.closest('[data-rt-ui]')).map(el=>{
        const label=(el.getAttribute('aria-label') || el.textContent).trim();
        if(/^(?:relevance|hot|top|new|most comments)(?:\s|$)/i.test(label))return 'sort';
        if(/^(?:all time|past (?:hour|24 hours|day|week|month|year))(?:\s|$)/i.test(label))return 'time';
        if(/^safe search(?:\s|$)/i.test(label))return 'safe';
      }).filter(Boolean));
      const checkedRows=new WeakSet();
      for(let branch=tabs;branch?.parentElement && !branch.matches('body');branch=branch.parentElement){
        for(const sibling of branch.parentElement.children){
          if(sibling===branch || sibling.matches('[data-rt-ui]'))continue;
          for(const trigger of sibling.querySelectorAll(triggers)){
            if(trigger.closest('[data-rt-ui]'))continue;
            for(let row=trigger.parentElement;row && sibling.contains(row);row=row.parentElement){
              if(checkedRows.has(row))break;checkedRows.add(row);
              if(row.matches('main,body,html') || row.querySelector('#search-results-page-tabgroup,[data-rt-ui],[data-testid="search-scope-switcher"],[data-testid="search-sdui-post"],[data-testid="search-sdui-comment-unit"]'))break;
              {const found=kinds(row);if(found.has('sort') && found.has('time')){hide(row);break;}}
            }
          }
        }
      }
      for(const anchor of document.querySelectorAll('a[href*="/search/"][href*="sort="],a[href*="/search/"][href*="t="]')){
        if(anchor.closest('[data-rt-ui],#search-results-page-tabgroup'))continue;
        hide(anchor.closest('faceplate-dropdown-menu,rpl-dropdown,faceplate-menu,shreddit-sort-dropdown'));
      }
    }
    restartSearch(next,{write=true}={}){
      const f=globalThis.RTFeedFilters,activity=this.activityFilter,submenu=['type','sub'].includes(this.openSubmenu?.dataset.rtSubKey)?{key:this.openSubmenu.dataset.rtSubKey,height:this.openSubmenu.style.getPropertyValue('--rt-menu-height')}:null;
      if(write){f.write(next);const url=new URL(location.href);
        // Explicit Any time must override an incoming Reddit t without deleting it.
        if(!next.date && url.searchParams.has('t'))url.searchParams.set('rt_date','all');
        replaceUrl(url);}
      this.reset();this.scan();if(!this.isSearch())return;
      this.activityFilter=activity;this.syncActivityPresentation();
      if(submenu)this.searchResumeMenu=submenu;
      this.ensureActivityMenu();this.renderFilterChips();
    }
    mountArchiveProfile(context,notice,anchor=notice,state='deleted'){
      this.accountState=state;this.archiveOnly=true;this.archiveNotice=notice;this.archiveNoticeAnchor=anchor;
      const layout=this.archiveShell=make('div','grid-container theme-rpl grid '+navClass());layout.dataset.rtUi='archive-profile';layout.dataset.rtUsername=context.username;layout.dataset.rtAccountState=state;layout.dir='ltr';
      const subgrid=make('div','subgrid-container m:col-start-2 box-border flex flex-col order-2 w-full m:w-[1120px] xs:px-md m:px-lg mx-auto min-h-[calc(100dvh_-_var(--shreddit-header-height))] justify-stretch');subgrid.id='subgrid-container';
      const columns=make('div','main-container gap-lg w-full flex-1 grid place-content-between grid-cols-[minmax(0,1fr)] fixed-sidebar xs:[&.fixed-sidebar]:grid-cols-[minmax(0,756px)_minmax(0,316px)] xs:[&.flex-sidebar]:grid-cols-[minmax(0,756px)_auto]');
      const shell=this.archiveMain=make('main','main w-full min-w-0');shell.id='main-content';
      const header=make('div','px-md relative pt-md flex pb-md items-center'),copy=make('div','w-full min-w-0'),title=make('h1','text-24 font-bold m-0 break-words',context.username),name=make('p','m-0 text-14 text-neutral-content-weak font-semibold','u/'+context.username);
      title.dataset.testid='profile-display-name';name.dataset.testid='profile-prefixed-name';copy.append(title,name,accountStateLine(state,notice));this.avatarSlot=make('div','rt-profile-avatar flex items-center justify-center shrink-0 w-[74px] min-h-4xl overflow-hidden pe-md relative');this.avatarPlaceholder=make('span','flex items-center justify-center text-neutral-content-weak w-4xl h-4xl');this.avatarPlaceholder.setAttribute('role','img');this.avatarPlaceholder.setAttribute('aria-label',(state==='banned'?'Banned or suspended':'Deleted')+' account · Profile picture unavailable');const profileIcon=unavailableAvatar(state,64,notice);profileIcon.id='profile-icon';profileIcon.dataset.testid='profile-icon';this.avatarPlaceholder.append(profileIcon);this.avatarSlot.append(this.avatarPlaceholder);header.append(this.avatarSlot,copy);
      const tabsContainer=make('div','mx-2xs my-md'),tabs=make('faceplate-tabgroup','nd:flex nd:gap-xs nd:w-fit');tabs.id='profile-feed-tabgroup';tabs.setAttribute('slot','tabs');tabs.setAttribute('for','profile-feed-tabs');
      const views=context.view==='search'?[['posts','Posts',''],['comments','Comments',''],['media','Media','']]:[['overview','Overview',''],['posts','Posts','submitted/'],['comments','Comments','comments/']],index=views.findIndex(([view])=>view===(context.view==='search'?context.type:context.view))+1;
      if(context.view==='search')tabs.id='search-results-page-tabgroup';tabs.setAttribute('pageindex',String(index));
      for(const [i,[view,label,suffix]] of views.entries()){
        const searchParams=new URLSearchParams(location.search);searchParams.set('type',view);
        const tab=link('',context.view==='search'?'/user/'+context.username+'/search/?'+searchParams:'/user/'+context.username+'/'+suffix),selected=view===(context.view==='search'?context.type:context.view);
        tab.className='button-medium px-[calc(var(--rem12)-var(--button-border-width,0px))] button-plain items-center justify-center button inline-flex';tab.setAttribute('rpl','');tab.setAttribute('slot','page-'+(i+1));tab.id=context.view==='search'?'search-results-page-tab-'+view:'profile-tab-'+view+'_tab';tab.tabIndex=selected?0:-1;
        const content=make('span','flex items-center justify-center'),text=make('span','flex items-center gap-xs',label);content.append(text);tab.append(content);
        if(selected){tab.setAttribute('faceplate-tab-selected','');tab.setAttribute('aria-current','page');tab.classList.add('bg-secondary-background-selected','!text-neutral-content-strong','tab-selected');tab.style.backgroundColor='var(--color-secondary-background-selected)';}
        tabs.append(tab);
      }
      for(const direction of ['back','forward']){const control=make('button','!px-sm button-small px-[calc(var(--rem10)-var(--button-border-width,0px))] button-plain icon items-center justify-center button inline-flex');control.type='button';control.slot=direction+'-button';control.tabIndex=-1;const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');for(const [key,value] of Object.entries({rpl:'',class:'rpl-rtl-icon',fill:'currentColor',height:'16',width:'16',viewBox:'0 0 20 20','icon-name':direction==='back'?'caret-left':'caret-right'}))icon.setAttribute(key,value);const path=document.createElementNS(icon.namespaceURI,'path');path.setAttribute('d',direction==='back'?'M6.3 10c0-.23.088-.46.264-.636l4.6-4.6a.9.9 0 111.273 1.272L8.474 10l3.963 3.964a.9.9 0 01-1.273 1.272l-4.6-4.6A.897.897 0 016.3 10Z':'M13.7 10c0 .23-.088.46-.264.636l-4.6 4.6a.9.9 0 11-1.273-1.272L11.526 10 7.563 6.036a.9.9 0 011.273-1.272l4.6 4.6A.897.897 0 0113.7 10Z');icon.append(path);control.append(icon,make('faceplate-screen-reader-content','',direction));tabs.append(control);}
      // The native tab group owns selection/keyboard styling. It can navigate
      // through Reddit's SPA router; archive authorization accepts these scopes.
      const panel=make('faceplate-tabpanel');panel.id='profile-feed-tabs';panel.setAttribute('pages','3');panel.setAttribute('pageindex',String(index));tabsContainer.append(tabs,panel);
      const feed=make('shreddit-feed','nd:visible');feed.dataset.rtArchiveFeed='true';
      this.archiveEmpty=make('p','rt-archive-empty text-14 text-neutral-content-weak',this.settings.archiveDiscovery?'':'Enable “Search Arctic Shift archive” in Reddit Tweaks to look up this username.');this.archiveEmpty.hidden=this.settings.archiveDiscovery;
      shell.append(header,tabsContainer,this.archiveEmpty,feed);columns.append(shell,this.archiveSidebar(context));subgrid.append(columns);layout.append(subgrid,this.navigationTarget());anchor.before(layout);notice.setAttribute('data-rt-archive-notice','true');return shell;
    }
    navigationTarget(){
      if(this.profileNavigation)return this.profileNavigation;
      const target=this.profileNavigation=make('div','contents');target.id='rt-nav-'+crypto.randomUUID();target.dataset.rtUi='profile-navigation';target.dataset.state='idle';const reserve=make('div','left-sidebar theme-rpl order-first hidden m:block');reserve.setAttribute('aria-hidden','true');reserve.append(navSkeleton());target.append(reserve);return target;
    }
    navigationFallback(target){
      const left=make('flex-left-nav-container','left-sidebar theme-rpl isolate order-first hidden m:block border-0 border-solid s:border-e-sm border-e-neutral-border');left.id='left-sidebar-container';left.setAttribute('expanded','1');left.setAttribute('parent-grid-selector','.grid-container');
      const content=make('reddit-sidebar-nav','nd:visible block w-full h-screen-without-header styled-scrollbars overflow-y-scroll overflow-x-hidden bg-neutral-background box-border px-md overscroll-contain'),nav=make('nav','z-2 box-border flex flex-col mt-0 mb-0 pt-md shrink-0 s:shrink w-full min-h-screen-without-header select-none');nav.setAttribute('aria-label','Primary');
      const top=make('left-nav-top-section','block');for(const flag of ['home','popular','news','explore','is-desktop'])top.setAttribute(flag,'');top.setAttribute('selectedpagetype','unknown');
      // Native components replace these ordinary links once their modules load.
      // Navigation remains usable if the native shell request fails.
      for(const [name,path] of [['Home','/?feed=home'],['Popular','/r/popular/'],['News','/news/'],['Explore','/explore/']])top.append(link(name,path,'flex items-center px-md py-sm text-secondary-plain hover:bg-neutral-background-hover hover:no-underline s:rounded-2'));
      nav.append(top);content.append(nav);left.append(content);target.replaceChildren(left);
    }
    loadNavigation(){
      const target=this.profileNavigation;if(!target || ['ready','loading','failed'].includes(target.dataset.state))return;
      const generation=this.generation;target.dataset.state='loading';
      this.request({action:'render-navigation',username:this.context.username,target:target.id,navigationLease:this.navigationLease}).then(result=>{if(generation===this.generation){if(!result?.rendered)throw Error('Native navigation is unavailable.');target.dataset.state='ready';}}).catch(()=>{if(generation!==this.generation)return;target.dataset.state='failed';this.navigationFallback(target);const retry=button('Retry navigation',()=>{target.dataset.state='idle';this.loadNavigation();});retry.className='button button-small button-plain px-md';target.querySelector('nav').append(retry);});
    }
    archiveSidebar(context){
      const sidebar=make('aside','right-sidebar min-w-0 w-[316px] max-w-[316px] hidden xs:block styled-scrollbars xs:sticky xs:top-[56px] xs:max-h-screen-without-header xs:overflow-y-auto xs:overflow-x-hidden');sidebar.id='right-sidebar-container';
      const content=make('div','right-sidebar-contents flex-auto');content.id='right-sidebar-contents';const panel=make('section','bg-neutral-background-weak rounded-4');panel.setAttribute('aria-label','Archived profile information');const padding=make('div','p-md');padding.append(make('h2','inline-flex items-center m-0 text-headline text-neutral-content-strong font-bold truncate',context.username),make('p','text-12 text-neutral-content-weak','Archived public activity'));
      const stats=make('dl','grid grid-cols-2 gap-md mt-md');this.archiveStats={};for(const [key,label] of [['posts','Posts loaded'],['comments','Comments loaded'],['oldest','Oldest loaded'],['newest','Newest loaded']]){const item=make('div'),value=make('dd','m-0 text-14 font-semibold text-neutral-content-strong',key==='posts' || key==='comments'?'0':'—');item.append(value,make('dt','text-12 text-neutral-content-weak',label));stats.append(item);this.archiveStats[key]=value;}
      padding.append(stats,make('p','text-12 text-neutral-content-weak','Partial archive coverage. Counts and dates describe loaded records, not the complete account history.'),link('Arctic Shift','https://arctic-shift.photon-reddit.com/','text-12 hover:underline'));panel.append(padding);content.append(panel);sidebar.append(content);return sidebar;
    }
    keepSearchControls(){const next=pageRoute();return !this.dead && this.settings.postDiscovery && this.isSearch() && next?.view==='search' && !next.section && next.username.toLowerCase()===this.context.username.toLowerCase();}
    clearActivityMenu(){
      if(this.openSubmenu?.dataset?.rtSubKey && this.activityDropdown?.hasAttribute('open'))this.resumeSubmenu={key:this.openSubmenu.dataset.rtSubKey,at:Date.now()};
      if(this.activityDropdown && this.activityTriggerClick)this.activityDropdown.removeEventListener('click',this.activityTriggerClick,true);
      if(this.activityMain && this.openSubmenu)this.activityMain.classList.remove('hidden');
      // Native rows return; mark the menu handled so the pre-hide never applies.
      this.activityMain?.setAttribute('data-rt-menu-ready','');this.activityMain?.removeAttribute('data-rt-feed-options');this.activityMain?.parentElement?.removeAttribute('data-rt-feed-options-host');
      this.activityMenuObserver?.disconnect();if(this.activityDropdown && this.activityKeydown)this.activityDropdown.removeEventListener('keydown',this.activityKeydown,true);
      // Return Reddit's own rows to their original places.
      for(const group of this.menuGroups || []){for(const restore of group.rtIconRestores || [])restore();for(const item of group.items){if(item.hasAttribute('data-rt-search-sort-hidden')){item.hidden=item.dataset.rtSearchSortHidden==='true';item.removeAttribute('data-rt-search-sort-hidden');}group.anchor.before(item);}if(group.header)group.header.hidden=group.headerHidden;group.anchor.remove();}
      this.menuGroups=[];
      if(!this.keepSearchControls()){this.searchInlineBar?.remove();this.searchInlineBar=null;this.searchInlineButtons=null;}for(const b of document.querySelectorAll('button.rt-feed-trigger-anchor')){b.classList.remove('rt-feed-trigger-anchor');for(const k of ['left','top','width','height'])b.style[k]='';}
      for(const row of this.activityMenuRows || [])row.remove();this.activityMenuRows=[];this.host?.removeAttribute('data-rt-menu-ready');this.rtMenu=null;this.rtPickerHost?.remove();this.activityMenu=null;this.activityMain=null;this.activityDropdown=null;this.activityOpen=false;this.openSubmenu=null;this.openFeedSubmenu=null;
    }
    detachActivityMenu(){
      // Leave the menu as it is in the parked view; only drop live references.
      this.activityMenuObserver?.disconnect();this.activityMenuObserver=null;this.feedSheetObserver?.disconnect();this.feedSheetObserver=null;this.feedSheetScrim?.remove();this.feedSheetScrim=null;this.feedSheetDropdown?.removeAttribute('data-rt-feed-sheet');this.feedSheetDropdown=null;this.menuGroups=[];this.activityMenuRows=[];this.activityMenu=this.activityMain=this.activityDropdown=null;this.activityOpen=false;this.openSubmenu=null;this.controlsTarget=null;
    }
    // Choosing an option closes Reddit's whole dropdown, whichever way it keeps its open state.
    closeFeedMenu(dropdown,open){
      open?.(null);
      const shut=()=>{try{dropdown.close?.();}catch{}dropdown.removeAttribute('open');if(dropdown.open===true)try{dropdown.open=false;}catch{}};
      shut();setTimeout(()=>{if(dropdown.isConnected && dropdown.hasAttribute('open'))shut();},0);
      dropdown.querySelector('button[aria-label="Feed options"]')?.focus({preventScroll:true});
    }
    // A previous build (parked view, re-rendered menu) can leave our rows and submenus behind: put Reddit's rows back and remove them all.
    purgeStaleMenu(content,menu){
      for(const el of [...menu.querySelectorAll('[data-rt-ui="menu-group"]')]){const group=el.rtGroup;if(group){for(const restore of group.group.rtIconRestores || [])restore();for(const item of group.group.items)group.anchor.before(item);if(group.group.header)group.group.header.hidden=group.group.headerHidden ?? false;group.anchor.remove();}}
      for(const node of [...content.querySelectorAll(':scope > [data-rt-ui]')])node.remove();
      for(const node of [...menu.querySelectorAll(':scope > [data-rt-ui]')])node.remove();
    }
    /* Removed beside Saved and History (spec §18 P4): a tab in Reddit's own profile tab bar, on your own profile only.
       It copies Reddit's last tab (unselected) and opens the Removed list; a stale tab never navigates. */
    syncRemovedTab(owner,route=pageRoute()){
      const group=document.querySelector('#profile-feed-tabgroup');let tab=document.querySelector('[data-rt-ui="removed-tab"]');
      const me=globalThis.RTNativeRemoval?.identity(document),allowed=!this.dead && this.settings.postDiscovery && owner && me?.owner===owner && route?.kind==='profile' && me.username.toLowerCase()===route.username.toLowerCase();
      const restoreTab=(node,state)=>{node.className=state.cls;node.tabIndex=state.index;node.toggleAttribute('faceplate-tab-selected',state.selected);if(state.current==null)node.removeAttribute('aria-current');else node.setAttribute('aria-current',state.current);if(state.style==null)node.removeAttribute('style');else if(node.getAttribute('style')!==state.style)node.setAttribute('style',state.style);};
      const restore=()=>{
        this.removedTabObserver?.disconnect();this.removedTabObserver=null;
        const old=this.tabPages;if(old?.group.isConnected){this.setTabgroupPages(old.group,old.native,old.index);}this.tabPages=null;
        for(const [node,state] of this.removedTabSelection || [])restoreTab(node,state);
        this.removedTabSelection=null;tab?.remove();tab=null;
      };
      if(!allowed || !group){restore();return;}
      if(tab?.parentElement!==group || tab.dataset.rtOwner!==owner){
        restore();const tabs=[...group.querySelectorAll(':scope > a[slot^="page-"]')],last=tabs.at(-1);if(!last)return;
        tab=last.cloneNode(true);tab.id='profile-tab-removed_tab';tab.removeAttribute('style');tab.removeAttribute('aria-current');
        tab.setAttribute('slot','page-'+(Math.max(...tabs.map(a=>Number(a.getAttribute('slot').split('-')[1]) || 0))+1));
        const label=tab.querySelector('[actioned]') || [...tab.querySelectorAll('span')].pop() || tab;label.textContent='Removed';
        tab.dataset.rtUi='removed-tab';tab.dataset.rtOwner=owner;last.after(tab);this.tabPages={group,native:Number(group.getAttribute('pages')) || Number(group.pages) || tabs.length,index:Number(group.getAttribute('pageindex')) || group.pageIndex || 1};
      }
      const href='/user/'+encodeURIComponent(route.username)+'/hidden/?rt_view=removed';if(tab.getAttribute('href')!==href)tab.setAttribute('href',href);
      const selected=Boolean(route.section) && route.list==='removed',classes=['bg-secondary-background-selected','!text-neutral-content-strong','tab-selected'];
      // Reddit paints the selected tab with an inline background as well as classes, and only from its own page index.
      const paintTab=(node,on)=>{for(const name of classes)if(node.classList.contains(name)!==on)node.classList.toggle(name,on);node.toggleAttribute('faceplate-tab-selected',on);const index=on?0:-1;if(node.tabIndex!==index)node.tabIndex=index;const background=on?'var(--color-secondary-background-selected)':'transparent';if(node.style.backgroundColor!==background)node.style.backgroundColor=background;};
      if(selected){this.removedTabSelection ||= new Map();for(const node of group.querySelectorAll(':scope > a:not([data-rt-ui="removed-tab"])')){
        if(!this.removedTabSelection.has(node))this.removedTabSelection.set(node,{cls:node.className,index:node.tabIndex,selected:node.hasAttribute('faceplate-tab-selected'),current:node.getAttribute('aria-current'),style:node.getAttribute('style')});
        paintTab(node,false);node.removeAttribute('aria-current');
      }}else if(this.removedTabSelection){for(const [node,state] of this.removedTabSelection)restoreTab(node,state);this.removedTabSelection=null;}
      paintTab(tab,selected);if(selected){if(tab.getAttribute('aria-current')!=='page')tab.setAttribute('aria-current','page');}else tab.removeAttribute('aria-current');
      // Reddit scrolls its strip for its own selected tab only. Bring Removed into view once per selection and let the
      // strip recompute its fade arrows, which otherwise keep covering the end of Removed.
      if(!selected)this.removedTabShown=null;else if(this.removedTabShown!==tab){this.removedTabShown=tab;Promise.resolve(group.updateComplete).then(()=>setTimeout(()=>{const list=group.shadowRoot?.querySelector('.tablist');if(!list || !tab.isConnected || this.removedTabShown!==tab)return;list.scrollLeft=list.scrollWidth;list.dispatchEvent(new Event('scroll'));},0));}
      const slot=Number(tab.getAttribute('slot').split('-')[1]),linked=document.getElementById(group.getAttribute('for')),nativeFeed=document.querySelector('main shreddit-feed:not([data-rt-ui])'),linkedFeed=nativeFeed && linked?.contains(nativeFeed);
      // Native pagination synchronizes through `for`. Selecting a ninth panel would hide a feed hosted in
      // one of Reddit's real panels. Keep that panel, selecting only our header tab and its accessible wrapper.
      this.setTabgroupPages(group,slot,selected && !linkedFeed?slot:0);
      if(!selected && Number(group.getAttribute('pageindex'))===slot)this.setTabgroupPages(group,slot,this.tabPages.index);
      if(selected && linkedFeed)Promise.resolve(group.updateComplete).then(()=>{
        if(!tab.isConnected || pageRoute()?.list!=='removed' || !pageRoute()?.section || this.dead)return;
        for(const node of group.querySelectorAll(':scope > a'))paintTab(node,node===tab);
        for(const wrapper of group.shadowRoot?.querySelectorAll('.tablist > [data-i][role="tab"]') || [])wrapper.setAttribute('aria-selected',String(Number(wrapper.dataset.i)===slot));
      });
      // A native repaint or a reset tab count re-runs this sync; records from our own writes are dropped below.
      this.removedTabOwner=owner;
      if(this.removedTabObserver?.group!==group){
        this.removedTabObserver?.disconnect();const observer=this.removedTabObserver=new MutationObserver(records=>{if(this.removedTabObserver===observer && !this.dead && records.some(record=>record.type!=='childList' || record.target===group || record.target.getRootNode()===group.shadowRoot))this.syncRemovedTab(this.removedTabOwner);});observer.group=group;
        // Reddit can replace the light-DOM tab children on navigation. Restore
        // Removed in the same mutation checkpoint so the strip keeps its width.
        observer.observe(group,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style','faceplate-tab-selected','pages','pageindex']});
      }
      if(group.shadowRoot && this.removedTabObserver.shadow!==group.shadowRoot){this.removedTabObserver.shadow=group.shadowRoot;this.removedTabObserver.observe(group.shadowRoot,{subtree:true,childList:true});}
      this.removedTabObserver.takeRecords();
      if(!this.onRemovedTab){
        this.onRemovedTab=event=>{
          const tab=event.target?.closest?.('[data-rt-ui="removed-tab"]');if(!tab || event.type==='keydown' && (!['Enter',' '].includes(event.key) || event.repeat) || event.type==='click' && event.button!==0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)return;
          event.preventDefault();event.stopImmediatePropagation();
          const me=globalThis.RTNativeRemoval?.identity(document),route=pageRoute();if(me?.owner!==tab.dataset.rtOwner || !route?.username || me.username.toLowerCase()!==route.username.toLowerCase())return;
          const anchor=make('a');anchor.href=tab.href;anchor.hidden=true;document.body.append(anchor);try{anchor.click();}finally{anchor.remove();}
        };
        window.addEventListener('click',this.onRemovedTab,true);window.addEventListener('keydown',this.onRemovedTab,true);
      }
    }
    phoneLayout(){return Boolean(globalThis.matchMedia?.('(max-width: 767.98px)')?.matches);}
    // Below 768 px (Reddit's phone layout) the Feed options popup is a bottom sheet over a dimmed backdrop, like the
    // filter sheets profile search opens. The backdrop sits beside the popup (same stacking context) and closes it.
    syncFeedSheet(dropdown){
      if(!dropdown)return;dropdown.toggleAttribute('data-rt-feed-sheet',!this.isSearch());
      if(this.feedSheetDropdown!==dropdown){this.feedSheetObserver?.disconnect();this.feedSheetScrim?.remove();this.feedSheetScrim=null;this.feedSheetDropdown=dropdown;this.feedSheetObserver=new MutationObserver(()=>this.updateFeedSheetScrim());this.feedSheetObserver.observe(dropdown,{attributes:true,attributeFilter:['open']});}
      this.updateFeedSheetScrim();
    }
    updateFeedSheetScrim(){
      const dropdown=this.feedSheetDropdown,open=Boolean(dropdown?.isConnected && dropdown.hasAttribute('open') && dropdown.hasAttribute('data-rt-feed-sheet') && this.phoneLayout());
      if(!open){this.feedSheetScrim?.remove();this.feedSheetScrim=null;return;}
      if(this.feedSheetScrim?.isConnected)return;
      const scrim=this.feedSheetScrim=make('div','rt-inline-sheet-scrim');scrim.dataset.rtUi='feed-sheet-scrim';scrim.setAttribute('aria-hidden','true');scrim.style.cssText='position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.6)';
      scrim.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();if('open' in dropdown)dropdown.open=false;dropdown.removeAttribute('open');});
      (dropdown.shadowRoot || document.body).append(scrim);
    }
    ensureActivityMenu(){
      if(this.context?.kind!=='profile' || !this.toolbar)return;
      if(this.context.section){this.clearActivityMenu();this.syncRemovedChrome();return;}
      const main=this.feed?.closest('main'),dropdown=this.findDropdown(main);
      const menu=dropdown?.querySelector('.main-menu-container') || dropdown?.querySelector('rpl-menu');
      if(dropdown && this.controlsTarget?.isConnected && !this.controlsTarget.contains(dropdown)){this.controlsTarget.remove();this.controlsTarget=null;}
      if(!menu){
        if(!this.autoDiscover && !this.isSearch() || this.controlsTarget?.isConnected)return;
        const target=this.controlsTarget=make('div','flex items-center gap-xs my-md');target.id='rt-controls-'+crypto.randomUUID();target.dataset.rtUi='profile-controls';if(!this.isSearch())target.dataset.rtNativeInset='true';
        const sort=this.context.view==='comments'?main?.querySelector('shreddit-sort-dropdown'):null,view=main?.querySelector('[aria-label="View"],[data-testid="feed-view-toggle"],shreddit-layout-switcher');if(sort){target.className='contents';sort.before(target);}else if(view && !view.closest('shreddit-feed')){target.className='contents';view.after(target);}else this.host.before(target);
        const generation=this.generation;this.request({action:'render-controls',username:this.context.username,target:target.id}).then(result=>{if(generation!==this.generation)return;if(!result?.rendered)throw Error('Native controls are not ready.');this.ensureActivityMenu();}).catch(()=>{if(generation!==this.generation)return;const retry=button('Retry feed options',()=>{target.remove();this.controlsTarget=null;this.ensureActivityMenu();});retry.className='button button-small button-plain';target.replaceChildren(retry);});return;
      }
      this.syncSearchLayout();
      if(this.context.view==='comments'){const sort=main?.querySelector('shreddit-sort-dropdown');if(this.commentSort && this.commentSort.node!==sort){this.commentSort.node.hidden=this.commentSort.hidden;this.commentSort.node.removeAttribute('data-rt-comment-sort-suppressed');this.commentSort=null;}if(sort && !this.commentSort){this.commentSort={node:sort,hidden:sort.hidden};sort.hidden=true;sort.dataset.rtCommentSortSuppressed='true';}}
      // Our fetched copy of Reddit's control (Comments, unavailable accounts)
      // doesn't get Reddit's popover positioning, so the open menu painted
      // under the feed. Lift it, keeping its static position.
      if(this.controlsTarget?.contains(dropdown) && dropdown.shadowRoot && ![...this.nativeLoadingStyles].some(style=>style.parentNode===dropdown.shadowRoot)){const style=make('style');style.dataset.rtUi='controls-style';style.textContent='#hovercard{position:absolute!important;z-index:20!important}';dropdown.shadowRoot.append(style);this.nativeLoadingStyles.add(style);}
      // Reddit's dropdown popup sits at z-index 1, so card buttons (z-10) and our chips painted over the open menu. Lift it.
      const popper=dropdown.shadowRoot?.querySelector('rpl-popper')?.shadowRoot;if(popper && ![...this.nativeLoadingStyles].some(style=>style.parentNode===popper)){const style=make('style');style.dataset.rtUi='popup-style';style.textContent='.popup{z-index:1000!important}@media (max-width:767.98px){:host([data-rt-sheet]) .popup{position:fixed!important;left:0!important;right:0!important;top:auto!important;bottom:0!important;transform:none!important;width:auto!important;max-height:85vh;overflow-y:auto;z-index:1001!important}:host([data-rt-sheet]) .popup-safe-area{display:none!important}}';popper.append(style);this.nativeLoadingStyles.add(style);}
      // Phones: Feed options on the profile feed opens as Reddit's bottom sheet (search builds its own sheets).
      if(popper)popper.host.toggleAttribute('data-rt-sheet',!this.isSearch());this.syncFeedSheet(dropdown);
      const nativeOwner=!this.archiveOnly && ['overview','posts','comments'].includes(this.context.view)?globalThis.RTNativeRemoval?.identity(document):null;
      const removalOwner=nativeOwner?.username.toLowerCase()===this.context.username.toLowerCase()?nativeOwner.owner:'';
      this.syncRemovedTab(globalThis.RTNativeRemoval?.identity(document)?.owner,this.context);
      if(this.activityMain===menu && (this.activityMenu?.dataset.rtRemovalOwner || '')!==removalOwner)this.clearActivityMenu();
      if(this.activityMain!==menu){
        this.clearActivityMenu();this.activityMain=menu;this.activityDropdown=dropdown;queueMicrotask(()=>this.placeFilterChips());
        const content=menu.parentElement,subs=[],polished=true;
        if(polished){menu.dataset.rtFeedOptions='true';content.dataset.rtFeedOptionsHost='true';}
        const row=(label,icon,tail)=>{const el=make('rpl-menu-item','cursor-pointer'),body=make('div','flex justify-between items-center w-full'),caption=make('div','flex items-center gap-xs rt-menu-caption');for(const [k,v] of Object.entries({size:'medium',appearance:'default',truncate:'both','aria-label':label,'prevent-auto-close':''}))el.setAttribute(k,v);const lead=typeof icon==='string'?glyph(icon):icon;lead?.classList?.add('rt-menu-lead');caption.append(lead,document.createTextNode(label));body.append(caption);if(tail)body.append(glyph(tail));el.tabIndex=-1;el.append(body);return el;};
        const activate=(el,fn)=>{el.addEventListener('click',fn);el.addEventListener('keydown',event=>{if(event.key==='Enter' || event.key===' '){event.preventDefault();event.stopImmediatePropagation();fn(event);}},true);};
        const submenu=key=>{const el=make('rpl-menu','rt-activity-submenu hidden');el.dataset.rtUi='activity-filter-option';if(key)el.dataset.rtSubKey=key;if(polished)el.dataset.rtFeedOptions='true';el.setAttribute('wrap','');el.setAttribute('role','menu');subs.push(el);return el;};
        // Top-style navigation: one submenu open at a time, inside the same dropdown.
        // Search-page submenus keep the main menu's height; profile Feed options submenus size to their own content (see CSS).
        const open=target=>{if(target && !menu.classList.contains('hidden')){const height=menu.getBoundingClientRect().height;if(height>0)target.style.setProperty('--rt-menu-height',Math.round(height)+'px');}this.openSubmenu=target || null;this.activityOpen=target===this.activityMenu;menu.classList.toggle('hidden',Boolean(target));for(const sub of subs)sub.classList.toggle('hidden',sub!==target);for(const entry of this.activityMenuRows)if(entry.matches?.('rpl-menu-item'))entry.setAttribute('aria-expanded',String(entry.rtSubmenu===target));(target?target.querySelector(polished?'.rt-sub-back,rpl-menu-item':'rpl-menu-item'):this.lastSubmenuRow)?.focus({preventScroll:true});};
        this.openFeedSubmenu=open;
        const entry=(label,icon,sub,{back=true}={})=>{const el=row(label,icon,'chevron-right');el.setAttribute('aria-haspopup','menu');el.rtSubmenu=sub;el.rtLabel=label;const value=make('span','rt-menu-value text-12 text-neutral-content-weak ms-auto me-xs');value.dataset.rtMenuValue='true';el.firstElementChild.insertBefore(value,el.firstElementChild.lastElementChild);activate(el,()=>{this.lastSubmenuRow=el;open(sub);el.rtOnOpen?.();});if(back){if(polished && globalThis.RTFeedFilters?.submenuHeader){const header=globalThis.RTFeedFilters.submenuHeader(label,()=>open(null));header.head.dataset.rtUi='submenu-back';sub.append(header.head);}else{const backRow=row('Back','arrow-back');backRow.dataset.rtUi='submenu-back';activate(backRow,()=>open(null));sub.append(backRow);}}return el;};
        this.activityMenuRows=[];this.purgeStaleMenu(content,menu);
        // Group Reddit's own sections (sort, view) into Top-style submenus so the
        // menu stays short. Its rows move (keeping their handlers) and are put back on teardown.
        const groups=[];let current=null;
        for(const node of [...menu.children]){if(node.dataset?.rtUi)continue;if(node.matches('rpl-menu-item')){if(!current)groups.push(current={header:null,items:[]});current.items.push(node);}else if(node.tagName==='DIV')groups.push(current={header:node,items:[]});}
        const native=groups.filter(group=>group.items.length);
        // Comments has no View section, so its single Sort group is grouped too.
        if(native.length>=(this.context.view==='comments' || this.isSearch()?1:2))for(const [index,group] of native.entries()){
          const label=index===0?'Sort':group.header?.textContent.trim() || 'View',sub=submenu(index===0?'sort':'view'),anchor=document.createComment('rt-menu-group');group.items[0].before(anchor);
          if(polished){
            group.rtIconRestores=[];
            for(const item of group.items){
              const original=item.querySelector('svg[icon-name]:not([icon-name="checkmark"])'),name=original?.getAttribute('icon-name'),label=(item.getAttribute('aria-label') || item.textContent).trim().toLowerCase(),fallback=index===0?'sort':'classic';
              const icon=globalThis.RTFeedFilters?.svgIcon?.(nativeMenuIcons[label] || name?.replace(/-fill$/,'') || fallback,16);
              if(!icon)continue;icon.classList.add('rt-menu-lead');
              const tabIndex=item.getAttribute('tabindex');item.tabIndex=-1;group.rtIconRestores.push(()=>{if(tabIndex==null)item.removeAttribute('tabindex');else item.setAttribute('tabindex',tabIndex);});
              if(original){original.replaceWith(icon);group.rtIconRestores.push(()=>icon.replaceWith(original));}
              else{const nodes=[...item.childNodes],body=make('div','flex justify-between items-center w-full'),caption=make('div','flex items-center gap-xs rt-menu-caption');caption.append(icon,...nodes);body.append(caption);item.append(body);group.rtIconRestores.push(()=>item.replaceChildren(...nodes));}
            }
          }
          const el=entry(label,polished?(index===0?'sort':'card'):'activity',sub);el.dataset.rtUi='menu-group';el.rtGroup={anchor,group};anchor.before(el);for(const item of group.items)sub.append(item);content.append(sub);
          if(index>0 && group.header){group.headerHidden=group.header.hidden;group.header.hidden=true;}
          this.menuGroups.push({...group,anchor,row:el,sub});this.activityMenuRows.push(el,sub);
        }
        const sub=this.activityMenu=submenu('activity'),activity=entry(this.isOwnList()?'List':'Activity','activity',sub);activity.dataset.rtActivity='true';activity.dataset.rtUi='activity-filter-option';activity.querySelector('[data-rt-menu-value]').dataset.rtActivityValue='true';menu.append(activity);
        for(const [value,label,icon] of (this.isOwnList()?[]:[['all','All activity','show'],['hidden','Hidden','hidden'],['deleted','Deleted','deleted']])){const option=row(label,icon);option.dataset.rtActivityFilter=value;activate(option,()=>{if(this.activityFilter!==value){this.activityFilter=value;this.activeProfileBatch=null;this.nativeBatch.queue=this.nativeBatch.queue.filter(node=>{const post=this.postMetadata.get(node.dataset.key);if(post && this.eligibleProfilePost(post,node))return true;node.dataset.rtNativeState='idle';delete node.dataset.rtQualify;return false;});}if(value!=='all' && !this.archiveOnly)this.verifyArchiveStatuses([...this.archived.values()].filter(post=>post.source==='arctic-shift'));this.syncActivityPresentation();this.ensureActivityMenu();this.deduplicate();this.closeFeedMenu(dropdown,open);this.ensureActivityArchive();if(this.batchedProfile)this.advanceProfileBatch(true);});sub.append(option);}
        sub.dataset.rtRemovalOwner=removalOwner;
        // Your own profile's search: switch between all activity and your lists (Saved, History, …) in place.
        if(this.context?.view==='search' && !this.archiveOnly && signedInName && this.context.username.toLowerCase()===signedInName.toLowerCase()){
          let listSub=sub,listEntry=activity;
          if(!this.isOwnList()){listSub=submenu('list');listEntry=entry('List','list-bulleted',listSub);listEntry.dataset.rtUi='own-list-switch';menu.append(listEntry);content.append(listSub);this.activityMenuRows.push(listEntry,listSub);}
          const current=this.context.list || '';
          for(const [value,label] of [['','All activity'],['saved','Saved'],['history','History'],['hidden','Hidden'],['upvoted','Upvoted'],['downvoted','Downvoted'],['removed','Removed']]){
            const option=row(label,value==='removed'?'removed':value?redditIcon(listIcons[value],16):'show');option.dataset.rtListSwitch=value || 'all';option.setAttribute('aria-current',String(value===current));
            if(value===current){const mark=glyph('checkmark');mark.dataset.rtCheck='true';option.firstElementChild.append(mark);}
            activate(option,()=>{this.closeFeedMenu(dropdown,open);if(value===current)return;const route=pageRoute();if(route)this.navigateProfileSearch({...route,list:value || undefined},route.q || '',Boolean(value));});
            listSub.append(option);
          }
          const shown=listEntry.querySelector('[data-rt-menu-value]');if(shown && !this.isOwnList())shown.textContent=current?listLabel(current):'All';
        }
        // Refresh sits at the end of the Activity submenu.
        const divider=make('div','my-xs border-0 border-t-sm border-solid border-neutral-border-weak');divider.setAttribute('role','separator');
        const refresh=row(this.isOwnList()?'Refresh list':'Refresh activity','refresh');refresh.dataset.rtUi='activity-refresh';activate(refresh,()=>{this.closeFeedMenu(dropdown,open);if(!this.discover.disabled)this.discover.click();});sub.append(divider,refresh);
        content.append(sub);this.activityMenuRows.push(activity,sub);this.buildFilterMenu({row,activate,submenu,entry,open,content,menu,dropdown});
        if(polished)for(const sub of subs){if(sub.hasAttribute('data-rt-panel'))continue;const list=make('div','rt-sub-list');list.dataset.rtMenuList='true';for(const node of [...sub.children])if(!node.matches('.rt-sub-head'))list.append(node);sub.append(list);}
        this.host?.setAttribute('data-rt-menu-ready','');menu.setAttribute('data-rt-menu-ready','');
        this.activityKeydown=event=>{
          if(event.key==='Escape' && this.openSubmenu){event.preventDefault();event.stopImmediatePropagation();open(null);return;}
          // The list wrapper is not an rpl-menu-item. Navigate its rows explicitly,
          // keeping the header reachable and leaving text-field editing alone.
          if(!polished || !this.openSubmenu || event.target.matches('input') || !['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
          const choices=[...this.openSubmenu.querySelectorAll('.rt-sub-back,rpl-menu-item')].filter(el=>!el.hidden && el.getAttribute('aria-disabled')!=='true' && !el.hasAttribute('disabled'));
          if(!choices.length)return;
          const at=choices.indexOf(event.target.closest('.rt-sub-back,rpl-menu-item')),next=event.key==='Home'?0:event.key==='End'?choices.length-1:(at+(event.key==='ArrowUp'?-1:1)+choices.length)%choices.length;
          event.preventDefault();event.stopImmediatePropagation();const choice=choices[next];choice.focus({preventScroll:true});
          const list=choice.closest('.rt-sub-list');if(list){const bounds=list.getBoundingClientRect(),item=choice.getBoundingClientRect();if(item.top<bounds.top)list.scrollTop-=bounds.top-item.top;else if(item.bottom>bounds.bottom)list.scrollTop+=item.bottom-bounds.bottom;}
        };dropdown.addEventListener('keydown',this.activityKeydown,true);
        // Opening Feed options always starts at the main menu; closing it resets too.
        this.activityTriggerClick=event=>{if(event.target?.closest?.('button[aria-label="Feed options"]'))open(null);};dropdown.addEventListener('click',this.activityTriggerClick,true);
        // Close ours when the dropdown closes, or when Reddit opens its own submenu (Top) from ours.
        let wasOpen=dropdown.hasAttribute('open');
        this.activityMenuObserver=new MutationObserver(()=>{const isOpen=dropdown.hasAttribute('open');if(isOpen!==wasOpen){wasOpen=isOpen;if(isOpen && this.searchRestoringMenu){this.searchRestoringMenu=false;return;}if(this.openSubmenu || menu.classList.contains('hidden'))open(null);return;}if(!this.openSubmenu)return;if(!isOpen){open(null);return;}const nativeOpen=[...content.children].some(node=>node!==menu && !subs.includes(node) && node.matches('rpl-menu') && !node.classList.contains('hidden'));if(nativeOpen){this.openSubmenu.classList.add('hidden');this.openSubmenu=null;this.activityOpen=false;}});
        this.activityMenuObserver.observe(dropdown,{attributes:true,attributeFilter:['open','class'],subtree:true});
        // Reddit re-rendering its menu while ours was open (a filter just changed): come back to the same submenu.
        const resume=this.resumeSubmenu;this.resumeSubmenu=null;if(resume && Date.now()-resume.at<2000 && dropdown.hasAttribute('open')){const target=subs.find(el=>el.dataset.rtSubKey===resume.key);if(target)open(target);}
      }
      // Current choice from Reddit's checkmarks. Group rows keep their own stable icon on every page.
      for(const group of this.menuGroups || []){const checked=group.items.find(item=>item.querySelector('svg[icon-name="checkmark"],[icon-name="checkmark"]') || item.getAttribute('aria-checked')==='true' || item.matches('[aria-current="true"],[aria-current="page"]'));const label=checked?.getAttribute('aria-label') || '';const value=group.row.querySelector('[data-rt-menu-value]');if(value.textContent!==label)value.textContent=label;}
      if(this.searchResumeMenu && this.isSearch()){
        const saved=this.searchResumeMenu,sub=[...this.activityDropdown.querySelectorAll('[data-rt-sub-key]')].find(el=>el.dataset.rtSubKey===saved.key);this.searchResumeMenu=null;
        if(sub){this.searchRestoringMenu=!this.activityDropdown.hasAttribute('open');this.activityDropdown.setAttribute('open','');this.activityMain.classList.remove('hidden');this.openFeedSubmenu(sub);if(saved.height)sub.style.setProperty('--rt-menu-height',saved.height);}
      }
      const value=this.activityMain?.querySelector('[data-rt-activity-value]'),labels={all:'All',hidden:'Hidden',deleted:'Deleted'};if(value && value.textContent!==labels[this.activityFilter])value.textContent=labels[this.activityFilter];
      for(const row of this.activityMenu.querySelectorAll('[data-rt-activity-filter]')){const checked=row.dataset.rtActivityFilter===this.activityFilter;if(row.getAttribute('aria-current')!==String(checked))row.setAttribute('aria-current',String(checked));let mark=row.querySelector('[data-rt-check]');if(checked && !mark){mark=glyph('checkmark');mark.dataset.rtCheck='true';row.firstElementChild.append(mark);}else if(!checked)mark?.remove();}
      this.syncFilterMenu();
      if(this.isSearch())this.syncSearchInlineFilters();else this.closeInlineMenu();
    }
    // Profile search: Reddit's own row already holds "Relevance", "All time" and "Safe Search". Our Feed options
    // items sit to their right as the same plain dropdown buttons; each opens its own submenu under itself.
    // The separate Feed options pill stays in the DOM (it hosts the menus) but is hidden and used as the anchor.
    syncSearchInlineFilters(){
      const dropdown=this.activityDropdown,main=this.activityMain,trigger=dropdown?.querySelector('button[aria-label="Feed options"]');
      // Desktop shows search-sort-dropdown-menu; the mobile site a scrolling strip of filter-drawer buttons that open
      // bottom sheets. Our filters join whichever row Reddit drew, and open the same kind of menu.
      const sortHost=document.querySelector('search-sort-dropdown-menu:not([hidden]),filter-drawer#search_modifier_post_sort,filter-drawer[id^="search_modifier"]'),row=sortHost?.closest('div.flex.items-center');if(!dropdown || !main || !trigger || !row)return;
      this.searchInlineSheet=sortHost.matches('filter-drawer');
      let bar=this.searchInlineBar;if(!bar){bar=this.searchInlineBar=make('div','contents');bar.dataset.rtUi='search-inline-filters';}if(bar.parentElement!==row)row.append(bar);this.searchInlineButtons ||= new Map();
      trigger.classList.add('rt-feed-trigger-anchor');
      // Reddit's own sort button is already in this row: our Sort row would duplicate it, so its extra entry (Old)
      // goes into Reddit's sort menu instead.
      this.hookSearchSortMenu(sortHost);
      const rows=[...main.querySelectorAll('*')].filter(el=>el.rtSubmenu && el.rtLabel && el.rtLabel!=='Sort' && !el.hidden && !el.closest('[hidden]'));
      const keep=new Set();
      for(const menuRow of rows){
        const key=menuRow.rtLabel;let button=this.searchInlineButtons.get(key);
        if(!button){
          button=make('button','border-0 text-12 font-semibold text-secondary-plain button-small px-[calc(var(--rem10)-var(--button-border-width,0px))] button-plain items-center justify-center button inline-flex rt-search-inline-filter');button.type='button';button.setAttribute('aria-haspopup','true');
          const text=make('span','flex items-center gap-xs'),caret=make('span','flex ms-2xs me-[-2px]');caret.append(redditIcon('caret',16));button.append(text,caret);button.rtText=text;
          button.setAttribute('aria-expanded','false');
          button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();this.toggleInlineMenu(button,button.rtMenuRow);});
          this.searchInlineButtons.set(key,button);
        }
        button.rtMenuRow=menuRow;
        // Like Reddit's Relevance / All time buttons: the current value only (the name when nothing is set).
        // Reddit's own buttons show a value (Relevance, All time). A default value alone (All, Any time, Card) says
        // nothing, so a row at its default shows its name (Date, Post type, Subreddit) and its value once set.
        const value=(menuRow.querySelector('[data-rt-menu-value]')?.textContent || '').trim(),label=!value || /^(?:all|any|any time|card|everything)$/i.test(value)?menuRow.rtLabel:value;
        if(button.rtText.textContent!==label){button.rtText.textContent=label;button.setAttribute('aria-label',label);}
        if(button.parentNode!==bar || [...bar.children].indexOf(button)!==[...keep].length)bar.append(button);keep.add(key);
      }
      for(const [key,button] of this.searchInlineButtons)if(!keep.has(key)){button.remove();this.searchInlineButtons.delete(key);}
      // Reddit spaces this row with space-x-* (a margin on each direct child), which never reaches our buttons inside a
      // display:contents wrapper. Copy the gap Reddit actually draws between its own first two buttons.
      const native=[...row.children].filter(child=>child!==bar && !child.matches('faceplate-loader,script,style') && child.getBoundingClientRect().width>0);
      if(native.length>=2){const a=native[0].getBoundingClientRect(),b=native[1].getBoundingClientRect(),flexGap=parseFloat(getComputedStyle(row).columnGap) || 0,gap=Math.round(Math.max(0,b.left-a.right-flexGap));
        if(gap!==this.searchInlineGap){this.searchInlineGap=gap;bar.style.setProperty('--rt-inline-gap',gap+'px');}}
    }

    // Each inline search filter opens its own menu drawn like Reddit's search dropdowns (radio rows, the current
    // choice highlighted; checkbox rows and a search box for subreddits). Choosing a row clicks the matching
    // Feed options entry, so the filter logic and state stay in one place.
    toggleInlineMenu(button,menuRow){
      if(this.inlineMenu?.button===button){this.closeInlineMenu();return;}
      this.closeInlineMenu();let sub=menuRow.rtSubmenu;if(!sub)return;
      // Choosing a filter can rebuild the Feed options menu; always read (and watch) the current copy of this submenu.
      const key=sub.dataset.rtSubKey,liveSub=()=>{if(!sub.isConnected && key){const next=this.activityMain?.parentElement?.querySelector('[data-rt-sub-key="'+key+'"]');if(next && next!==sub){sub=next;observer?.disconnect();observer?.observe(sub,{subtree:true,childList:true,attributes:true,attributeFilter:['aria-checked','hidden']});}}return sub;};let observer=null;
      menuRow.rtOnOpen?.();
      const sheet=Boolean(this.searchInlineSheet),multi=sub.dataset.rtSubKey==='sub',panel=make('div','rt-inline-menu'+(sheet?' rt-inline-sheet':''));panel.dataset.rtUi='search-inline-menu';
      let scrim=null;
      // Mobile: Reddit's filter bottom sheet (a 60% scrim, a sheet with 12px top corners, a 48px bold title row and a
      // round close button).
      if(sheet){scrim=make('div','rt-inline-sheet-scrim');scrim.setAttribute('aria-hidden','true');scrim.addEventListener('click',()=>this.closeInlineMenu());
        panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label',menuRow.rtLabel);
        const head=make('div','flex items-center min-w-0 rt-inline-sheet-head'),title=make('span','grow min-w-0 truncate');title.append(make('span','text-16 text-neutral-content-strong font-bold',menuRow.rtLabel));head.append(title);
        const close=make('button','appearance-none h-xl w-xl border-0 rounded-full bg-secondary-background button-medium items-center justify-center button inline-flex rt-inline-sheet-close');close.type='button';close.setAttribute('aria-label','Close');close.append(redditIcon('close',16));
        close.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();this.closeInlineMenu();button.focus();});panel.append(close,head);}
      const list=make('ul','rt-inline-menu-list');list.setAttribute('role','menu');list.setAttribute('aria-label',menuRow.rtLabel);let search=null,source=null;
      if(multi){source=sub.querySelector('input');if(source){const box=make('div','rt-inline-menu-search');search=make('input');search.type='search';search.placeholder=source.placeholder || 'Search subreddits';search.setAttribute('aria-label',search.placeholder);search.value=source.value || '';
        search.addEventListener('input',()=>{source.value=search.value;source.dispatchEvent(new Event('input',{bubbles:true}));});box.append(search);panel.append(box);}}
      panel.append(list);
      const items=()=>[...liveSub().querySelectorAll('rpl-menu-item')].filter(el=>!el.hidden && !el.closest('[hidden],.rt-sub-head'));
      const labelOf=el=>(el.getAttribute('aria-label') || el.querySelector('.rt-sub-name,.rt-menu-caption')?.textContent || el.textContent || '').trim();
      const checkedOf=el=>el.getAttribute('aria-checked')==='true' || Boolean(el.querySelector('[data-rt-check],[icon-name="checkmark"]'));
      const iconWatch=multi && typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){iconWatch.unobserve(entry.target);globalThis.RTFeedFilters?.loadIcon?.(entry.target);}},{root:list,rootMargin:'200px 0px'}):null;
      // Rows copy Reddit's search dropdown item (li > a, 32px icon box with a 16px radio, body-2 label).
      const render=()=>{
        const rowsNow=[...list.querySelectorAll('.rt-inline-menu-item')],focused=rowsNow.indexOf(document.activeElement),all=items();list.replaceChildren();
        if(!all.length){const li=make('li','rt-inline-menu-empty text-body-2 text-secondary-plain-weak',multi?'No subreddits found':'No options');li.setAttribute('role','presentation');list.append(li);}
        for(const item of all){
          const label=labelOf(item),checked=checkedOf(item),opens=item.hasAttribute('aria-haspopup') || /^custom/i.test(label);
          const li=make('li','relative list-none mt-0');li.setAttribute('role','presentation');
          const row=make('div','flex justify-between relative px-md gap-xs text-secondary-plain hover:bg-neutral-background-hover cursor-pointer py-xs -outline-offset-1 no-underline rt-inline-menu-item'+(checked?' bg-neutral-background-selected':''));
          row.tabIndex=-1;row.setAttribute('role',multi?'menuitemcheckbox':'menuitemradio');row.setAttribute('aria-checked',String(checked));
          const lead=make('span','flex items-center gap-xs min-w-0 shrink'),mark=make('span','flex shrink-0 items-center justify-center h-xl w-xl text-20 leading-4 rt-inline-mark');
          if(multi)mark.append(make('span','rt-inline-check'));else mark.append(redditIcon(checked?'radio-button-fill':'radio-button',sheet?20:16));lead.append(mark);
          // Our own icon (not a copy of the hidden list's placeholder), fetched once its row scrolls into view.
          if(multi){const source=item.querySelector('.rt-community-icon'),name=source?.dataset.rtCommunity,f=globalThis.RTFeedFilters;
            if(source){const icon=name && f?.communityIcon?f.communityIcon(name,24,source.dataset.rtPlaceholder):source.cloneNode(true);icon.classList.add('rt-inline-community');icon.removeAttribute('style');lead.append(icon);if(name && !icon.dataset.rtIconApplied)iconWatch?iconWatch.observe(icon):f?.loadIcon?.(icon);}}
          const text=make('span','flex flex-col justify-center min-w-0 shrink py-[0.375rem]'),body=make('span','text-body-2 rt-inline-menu-label');body.append(make('span','text-secondary-onBackground',label));text.append(body);lead.append(text);
          const end=make('span','flex items-center shrink-0'),slot=make('span','flex items-center justify-center h-lg text-12 text-secondary-plain-weak rt-inline-menu-tail'),tail=item.querySelector('[data-rt-option-tail]')?.textContent;if(tail)slot.textContent=tail;end.append(slot);
          row.append(lead,end);li.append(row);
          const choose=event=>{event.preventDefault();event.stopPropagation();
            // A choice that needs more input (a custom date range) continues in the full Feed options menu.
            if(opens){this.closeInlineMenu();this.openInFeedOptions(menuRow,button,item);return;}
            item.click();if(!multi){this.closeInlineMenu();button.focus();}else for(const wait of [60,300])setTimeout(()=>{if(this.inlineMenu?.panel===panel)render();},wait);};
          row.addEventListener('click',choose);row.addEventListener('keydown',event=>{if(event.key==='Enter' || event.key===' ')choose(event);});
          list.append(li);
        }
        if(focused>=0)list.querySelectorAll('.rt-inline-menu-item')[focused]?.focus();
      };
      render();
      let pending=0;observer=new MutationObserver(()=>{if(!pending)pending=setTimeout(()=>{pending=0;if(this.inlineMenu?.panel===panel)render();},0);});
      observer.observe(sub,{subtree:true,childList:true,attributes:true,attributeFilter:['aria-checked','hidden']});
      if(scrim)document.body.append(scrim);document.body.append(panel);
      // A sheet covers the page like Reddit's: the page behind it doesn't scroll.
      const lock=sheet?document.documentElement.style.getPropertyValue('overflow'):null;if(sheet)document.documentElement.style.setProperty('overflow','hidden');
      // Like Reddit's popper: centred under the button, 8px below it, kept inside the window.
      const place=()=>{if(sheet)return;const r=button.getBoundingClientRect(),w=panel.offsetWidth;let left=r.left+r.width/2-w/2;left=Math.min(left,innerWidth-8-w);panel.style.left=Math.max(8,Math.round(left))+'px';panel.style.top=Math.round(r.bottom+8)+'px';};
      place();
      // The scrim closes on its own click, so a tap on it never falls through to the post underneath.
      const outside=event=>{const path=event.composedPath();if(!path.includes(panel) && !path.includes(button) && !(scrim && path.includes(scrim)))this.closeInlineMenu();};
      const keys=event=>{
        if(event.key==='Escape'){event.preventDefault();this.closeInlineMenu();button.focus();return;}
        if(!['ArrowDown','ArrowUp'].includes(event.key) || !panel.contains(document.activeElement))return;
        const rows=[...list.querySelectorAll('.rt-inline-menu-item')],i=rows.indexOf(document.activeElement);event.preventDefault();
        rows[(i+(event.key==='ArrowDown'?1:-1)+rows.length)%rows.length]?.focus();
      };
      addEventListener('pointerdown',outside,true);addEventListener('keydown',keys,true);addEventListener('resize',place);addEventListener('scroll',place,{passive:true});
      button.setAttribute('aria-expanded','true');
      this.inlineMenu={button,panel,scrim,cleanup:()=>{iconWatch?.disconnect();if(sheet){if(lock)document.documentElement.style.setProperty('overflow',lock);else document.documentElement.style.removeProperty('overflow');}observer.disconnect();clearTimeout(pending);removeEventListener('pointerdown',outside,true);removeEventListener('keydown',keys,true);removeEventListener('resize',place);removeEventListener('scroll',place);}};
      (search || list.querySelector('[aria-checked="true"]') || list.querySelector('.rt-inline-menu-item'))?.focus({preventScroll:true});
    }
    closeInlineMenu(){const m=this.inlineMenu;if(!m)return;this.inlineMenu=null;m.cleanup();m.panel.remove();m.scrim?.remove();m.button.setAttribute('aria-expanded','false');}
    // The full Feed options menu, opened at one submenu under an inline button (for choices that need more input).
    openInFeedOptions(menuRow,button,item){
      const dropdown=this.activityDropdown,main=this.activityMain,trigger=dropdown?.querySelector('button[aria-label="Feed options"]');if(!dropdown || !main || !trigger)return;
      const box=button.getBoundingClientRect();trigger.style.left=Math.round(box.left)+'px';trigger.style.top=Math.round(box.top)+'px';trigger.style.width=Math.round(box.width)+'px';trigger.style.height=Math.round(box.height)+'px';
      // Opening the dropdown resets it to its main list; open this item's submenu (and the item) right after that.
      dropdown.setAttribute('open','');setTimeout(()=>{if(!dropdown.hasAttribute('open'))return;main.classList.remove('hidden');menuRow.click();item?.click();},60);
    }
    // Adds our archive-backed Old sort to Reddit's search sort menu (its items render when the menu opens).
    hookSearchSortMenu(host){
      if(!host)return;
      const inject=()=>{
        const roots=[host,host.shadowRoot].filter(Boolean);if(roots.some(r=>r.querySelector('[data-rt-sort-old]')))return;
        const items=roots.flatMap(r=>[...r.querySelectorAll('[role="menuitem"],[role="menuitemradio"],li:has(a[href*="sort="]),a[href*="sort="]')]).filter(el=>!el.parentElement?.closest('[role="menuitem"],[role="menuitemradio"],li:has(a[href*="sort="])'));
        const base=items.at(-1);if(!base || !this.rtMenu?.old)return;
        const item=base.cloneNode(true);item.dataset.rtSortOld='true';item.removeAttribute('aria-checked');item.removeAttribute('aria-selected');
        for(const a of [item,...item.querySelectorAll('a[href]')])a.removeAttribute?.('href');
        const leaf=[...item.querySelectorAll('*')].reverse().find(el=>!el.children.length && el.textContent.trim()) || item;leaf.textContent='Old';
        item.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();host.removeAttribute('open');host.querySelector('[open]')?.removeAttribute('open');if(this.rtFilters?.sort!=='old')this.rtMenu.old.click();},true);
        base.after(item);
      };
      inject();if(host.rtSortHooked)return;host.rtSortHooked=true;
      host.addEventListener('click',()=>{setTimeout(inject,0);setTimeout(inject,120);},true);
    }
    // Feed filters: date, post type, subreddit and the archive-backed Old sort. State lives in
    // rt_* URL params; context.key ignores them, so changing a filter never resets discovery.
    rtActive(){const f=globalThis.RTFeedFilters;return Boolean(f && this.rtFilters && f.isActive(this.rtFilters));}
    archiveQueryOn(){return !this.isOwnList() && (this.isSearch() || this.rtActive()) && Boolean(globalThis.RTArchiveQuery?.search) && Boolean(this.settings.archiveDiscovery);}
    oldSort(){return (this.isSearch()?this.effectiveSort()==='old':this.rtActive() && this.rtFilters.sort==='old') && this.archiveQueryOn();}
    // Filtered archive pages are placed by date among Reddit's cards instead of waiting for a shared frontier.
    freeMerge(){return this.isSearch() || this.oldSort() || this.archiveQueryOn() && (this.context?.sort==='new' || this.archiveOnly);}
    rtPredicate(){const f=globalThis.RTFeedFilters,sig=JSON.stringify(f.serialize(this.rtFilters))+':'+Math.floor(Date.now()/60000);if(this.rtPred?.sig!==sig)this.rtPred={sig,fn:f.predicate(this.rtFilters)};return this.rtPred.fn;}
    filterItem(post){
      const f=globalThis.RTFeedFilters,key=itemKey(post),native=this.isSearch() && post.source==='reddit'?this.nodes.get(key)?.querySelector('shreddit-post'):null;
      const source=native || [this.archived.get(key),this.live.get(key)].find(item=>item?.postType) || post;
      return {created:post.created,kind:post.kind,subreddit:post.subreddit,postType:post.kind==='comment'?'':f.inferType(source)};
    }
    filterMatch(post,{hydrate=false}={}){
      if(this.isOwnList())return this.ownListMatch(post);
      if(this.isSearch()){
        const f=globalThis.RTFeedFilters,pendingType=hydrate && post.source==='reddit' && !this.nodes.get(itemKey(post))?.querySelector('shreddit-post'),state={...this.rtFilters,types:this.searchKind()==='comment' || pendingType?[]:this.rtFilters.types};
        if(!f.predicate(state)(this.filterItem(post)))return false;
        if(this.context.type==='media' && !pendingType && !mediaTypes.includes(this.filterItem(post).postType))return false;
        // Native cards can prove a type that search metadata did not carry.
        if(!pendingType && (post.source!=='reddit' || this.searchReddit.residual) && !globalThis.RCSCore.matchRecord(this.searchParsed,M.searchRecord(post,this.nodes.get(itemKey(post))?.querySelector('shreddit-post,shreddit-profile-comment'))))return false;
        return true;
      }
      return !this.rtActive() || this.rtPredicate()(this.filterItem(post));
    }
    nativeItem(native,entry){
      const kind=native?.matches?.('shreddit-profile-comment')?'comment':'post',href=native?.querySelector?.('a[href^="/r/"]')?.getAttribute('href') || '';
      return {kind,created:entry.timestamp,subreddit:native?.getAttribute('subreddit-name') || native?.getAttribute('subreddit-prefixed-name') || href.match(/^\/r\/([^/]+)/)?.[1] || '',postType:kind==='comment'?'':native?(globalThis.RTFeedFilters?.inferType?.(native) ?? native.getAttribute('post-type')) || '':''};
    }
    syncFiltersFromUrl(){
      const f=globalThis.RTFeedFilters;if(!f || this.context?.kind!=='profile' || this.rtSearch===location.search)return;
      this.rtSearch=location.search;const next=this.readFilters();if(!f.equal(next,this.rtFilters || f.empty()))this.setFilters(next,{write:false});
    }
    setFilters(next,{write=true}={}){
      const f=globalThis.RTFeedFilters;if(!f || this.context?.kind!=='profile' || this.context.section)return;
      next=f.clone(next);next.subreddits=next.subreddits.slice(0,f.maxSubreddits);const prev=this.rtFilters || f.empty();if(f.equal(prev,next))return;
      if(this.isOwnList()){const dateChanged=this.context.list==='removed' && JSON.stringify(prev.date)!==JSON.stringify(next.date);this.rtFilters=next;this.rtPred=null;if(write){const url=new URL(location.href);for(const name of ['rt_date','rt_type','rt_sub','rt_sort'])url.searchParams.delete(name);for(const [name,value] of Object.entries(f.serialize(next)))url.searchParams.set(name,value);replaceUrl(url);}this.rtSearch=location.search;this.searchParkAt=this.searchParkKey();this.renderFilterChips();this.syncFilterMenu();if(dateChanged){this.generation=++generationSeq;for(const c of this.controllers)c.abort();this.controllers.clear();this.listState={items:new Map(),scanned:0,loading:false,done:false,capped:false,error:'',after:null};this.loadOwnList();}else this.renderOwnList();return;}
      if(this.isSearch()){this.restartSearch(next,{write});return;}
      this.rtFilters=next;this.rtPred=null;if(write){f.write(next);}this.rtSearch=location.search;this.applyFilters(prev);
    }
    applyFilters(prev){
      const f=globalThis.RTFeedFilters;this.renderFilterChips();if(this.rtAgg && this.rtAgg.key!==this.aggKey())this.rtAgg=null;this.syncFilterMenu();this.renderSubredditOptions();
      if(!this.host?.isConnected)return;
      const generation=this.generation;
      // A changed archive query (date window, subreddit, direction) starts a fresh archive stream; what is loaded stays.
      if((this.archiveSig!==undefined || this.oldSort()) && this.archiveSigNow()!==this.archiveSig && this.settings.archiveDiscovery){
        this.beforeByKind={};this.archiveMore={};this.moreArchive=false;if(this.sourceNotices)delete this.sourceNotices.searched;for(const kind of this.kinds())this.sourceFrontiers.delete('archive-'+kind);
        if(this.archiveOnly || this.freeMerge() || this.context.sort==='new' || this.activityFilter==='deleted'){const go=()=>{if(generation===this.generation)this.loadArchive();};if(this.archiveBusy)this.archiveRun.then(go,go);else go();}
      }
      if(prev.sort==='old' && !this.rtFilters.sort && !this.loaded && !this.busy && !this.archiveOnly)this.loadReddit();
      this.activeProfileBatch=null;this.nativeBatch.queue=this.nativeBatch.queue.filter(node=>{const post=this.postMetadata.get(node.dataset.key);if(post && this.eligibleProfilePost(post,node))return true;node.dataset.rtNativeState='idle';delete node.dataset.rtQualify;return false;});
      this.render({reuseCards:true});
    }
    // Pills sit on the Feed options row, right of the button (like the chat search filter rail).
    // The button can be wrapped in a narrow box (Comments tab), so climb to the full-width row first.
    placeFilterChips(){
      const chips=this.rtChips;if(!chips)return;
      for(const stale of document.querySelectorAll('[data-rt-ui="filter-chips"]'))if(stale!==chips)stale.remove();
      if(this.isSearch() && this.controlsTarget?.isConnected){const row=this.controlsTarget;row.className='flex items-center gap-xs my-md';if(chips.parentNode!==row)row.append(chips);chips.dataset.rtRail='true';return;}
      const up=node=>{const root=node.getRootNode();return node.parentNode===root && root!==document?root.host:node.parentElement;};
      let node=this.activityDropdown?.isConnected?this.activityDropdown:null;
      if(node){let guard=0;node=node.closest?.('shreddit-layout-event-setter') || node;
        while(guard++<6){const parent=up(node);if(!parent || parent===document.body)break;const style=getComputedStyle(parent),width=parent.getBoundingClientRect().width;if(style.display!=='contents' && width>=320 && /flex/.test(style.display))break;node=parent;}
        const parent=up(node);if(parent && parent!==document.body && /flex/.test(getComputedStyle(parent).display)){if(node.nextSibling!==chips)node.after(chips);chips.dataset.rtRail='true';return;}
      }
      delete chips.dataset.rtRail;if(this.host && chips.parentNode!==this.host)this.host.prepend(chips);
    }
    renderFilterChips(){
      const f=globalThis.RTFeedFilters;if(!f || !this.rtChips)return;this.placeFilterChips();
      const shown={...(this.rtFilters || f.empty())};if(!this.oldSort())shown.sort=null;
      f.renderChips(this.rtChips,shown,{make,glyph,onChange:next=>this.setFilters(shown.sort?next:{...next,sort:this.rtFilters?.sort ?? null})});
      this.syncHeaderFilters();
    }
    // Profile search on desktop: the filters sit in Reddit's header search as scope pills next to
    // u/name (and the list pill), like Reddit's own scope. The in-page pills stay for other layouts.
    headerFilterChips(){
      const f=globalThis.RTFeedFilters;if(!f || !this.isSearch() || this.dead || !this.settings?.postDiscovery)return [];
      const shown={...(this.rtFilters || f.empty())};if(!this.oldSort())shown.sort=null;
      const chips=f.chipList(shown).filter(chip=>!chip.id.startsWith('sub:'));
      // Several communities share one pill so the search field keeps its room.
      if(shown.subreddits.length>1)chips.push({id:'subs',label:shown.subreddits.length+' communities',icon:'community-fill',remove:state=>({...state,subreddits:[]})});
      else chips.push(...f.chipList({...f.empty(),subreddits:shown.subreddits}));
      return chips.map(chip=>({chip,shown}));
    }
    syncHeaderFilters(){
      const f=globalThis.RTFeedFilters,host=document.querySelector('reddit-search-large'),root=host?.shadowRoot || host;
      const native=root?.querySelector('#search-input-remove-filter,rpl-input-chip.scoped-search-pill:not([data-rt-list-chip]):not([data-rt-header-filter])'),field=root?.querySelector('faceplate-search-input[name="q"]');
      // Desktop layout decides; the field's width is 0 while Reddit hydrates it, which must not move the pills.
      const wide=Boolean(field) && globalThis.matchMedia?.('(min-width: 768px)')?.matches !== false;
      let items=native && wide?this.headerFilterChips():[];
      // Many filters crowd the search field: fold them into one "N filters" pill that opens a card listing each.
      if(items.length>1 && this.headerPillsCrowd(items,host)){const all=items,shown=all[0].shown;items=[{chip:{id:'filters',label:all.length+' filters',icon:'filter',remove:state=>all.reduce((acc,{chip})=>chip.remove(acc),state)},shown,all}];}
      const existing=[...(root?.querySelectorAll('[data-rt-header-filter]') || [])],sig=JSON.stringify(items.map(({chip,all})=>[chip.id,chip.label,...(all || []).map(({chip})=>chip.label)]));
      const after=root?.querySelector('[data-rt-list-chip]') || native;
      // Same pills after Reddit re-rendered the header: move the same elements back (no blank re-render).
      if(items.length && this.headerFilterSig===sig && this.headerPillEls?.length===items.length && !existing.length){let at=after;for(const el of this.headerPillEls){at.after(el);at=el;}}
      else if(!(items.length && this.headerFilterSig===sig && existing.length===items.length && existing[0]?.previousElementSibling===after)){
        for(const el of existing)el.remove();this.headerFilterSig=sig;this.headerPillEls=[];
        let at=after;
        this.closeHeaderFilterCard();
        for(const {chip,shown,all} of items){
          const el=f.pill(chip,{make,glyph,onRemove:()=>this.removeHeaderChip(chip,shown)});
          if(all){el.setAttribute('aria-label',chip.label+': '+all.map(({chip})=>chip.label).join(', '));el.setAttribute('aria-haspopup','dialog');el.querySelector('.rt-filter-chip-remove')?.setAttribute('aria-label','Clear all filters');
            // A click on the pill opens the list; only its × clears everything.
            el.addEventListener('click',event=>{if(event.composedPath().some(node=>node.classList?.contains('rt-filter-chip-remove')))return;event.preventDefault();event.stopImmediatePropagation();this.toggleHeaderFilterCard(el,all);},true);}
          el.dataset.rtHeaderFilter=chip.id;if(native.hasAttribute('selected'))el.setAttribute('selected','');el.setAttribute('slot',native.getAttribute('slot') || 'chips');el.className=native.className+' rt-filter-chip';el.style.marginInlineStart='4px';el.style.flex='none';
          // Our stylesheet doesn't reach Reddit's shadow root: size the icon and close control inline.
          for(const node of el.querySelectorAll('.rt-filter-chip-icon,.rt-filter-chip-icon svg,.rt-filter-chip-icon img'))Object.assign(node.style,{display:'inline-flex',width:'16px',height:'16px',borderRadius:node.tagName==='svg'?'':'50%',overflow:'hidden',objectFit:'cover',margin:'0'});
          const remove=el.querySelector('.rt-filter-chip-remove');Object.assign(remove.style,{display:'inline-flex',alignItems:'center',justifyContent:'center',width:'16px',height:'16px',padding:'0',border:'0',background:'none',color:'inherit',cursor:'pointer'});
          for(const svg of remove.querySelectorAll('svg'))Object.assign(svg.style,{width:'12px',height:'12px'});
          at.after(el);at=el;this.headerPillEls.push(el);
        }
      }
      // The header shows them, so the in-page row doesn't repeat them.
      if(this.rtChips)this.rtChips.toggleAttribute('data-rt-in-header',Boolean(items.length));if(items.length && this.rtChips)this.rtChips.hidden=true;
      if(items.length && root && !this.headerFilterObserver){
        this.headerFilterObserver=new MutationObserver(()=>{if(this.headerFilterQueued)return;this.headerFilterQueued=true;queueMicrotask(()=>{this.headerFilterQueued=false;if(this.headerFilterObserver)this.syncHeaderFilters();});});
        this.headerFilterObserver.observe(root,{childList:true,subtree:true});this.headerFilterRoot=root;
        const form=root.querySelector('form');if(form){this.headerFilterForm=form;form.addEventListener('submit',this.onOwnSubmit,true);}
      }else if(!items.length)this.clearHeaderFilters({keepRow:true});
      this.fitHeaderChips();
    }
    /* All chips in the header search share its row with the text field (Reddit's u/ scope pill, our list pill and
       filter pills). When they take more than half the field, ours become compact (icon, plus a count such as "3"),
       with the full name as their tooltip, and Reddit's pill is capped, so typed text keeps most of the row. */
    fitHeaderChips(){
      if(!this.onHeaderResize){this.onHeaderResize=()=>this.fitHeaderChips();addEventListener('resize',this.onHeaderResize);}
      const host=document.querySelector('reddit-search-large'),root=host?.shadowRoot;if(!root)return;
      const field=root.querySelector('faceplate-search-input[name="q"]'),bar=field?.getBoundingClientRect?.().width || 0;
      const ours=[...root.querySelectorAll('[data-rt-list-chip],[data-rt-header-filter]')],native=root.querySelector('rpl-input-chip:not([data-rt-list-chip]):not([data-rt-header-filter])');
      // Full widths are measured only while a chip shows its full label, so deciding never flips the DOM back and forth
      // (the header observer would see each flip as a change and sync again).
      this.fullChipWidths ||= new WeakMap();const width=el=>{if(el.dataset.rtCompact!=='true' && !(el===native && native.style.maxWidth))this.fullChipWidths.set(el,el.getBoundingClientRect?.().width || 0);return this.fullChipWidths.get(el) || 0;};
      const used=bar && ours.length?[native,...ours].filter(Boolean).reduce((sum,el)=>sum+width(el)+4,0):0,on=Boolean(bar) && used>bar*0.5;
      for(const el of ours){
        if(el.dataset.rtCompact===String(on))continue;el.dataset.rtCompact=String(on);const label=el.querySelector('.rt-filter-chip-label');
        if(label){if(label.dataset.rtFull==null)label.dataset.rtFull=label.textContent;const full=label.dataset.rtFull,count=full.match(/^\d[\d,.]*(?=\s)/)?.[0],text=on?(count || full):full;
          if(label.textContent!==text)label.textContent=text;label.style.display=on && !count?'none':'';if(on)el.title=full;else el.removeAttribute('title');}
        else{const text=el.querySelector('.text-label-2');if(text){text.style.display=on?'none':'';if(on)el.title=text.textContent.trim();else el.removeAttribute('title');}}
      }
      if(native && (native.style.maxWidth==='160px')!==on){native.style.maxWidth=on?'160px':'';native.style.overflow=on?'hidden':'';}
    }
    removeHeaderChip(chip,shown){const f=globalThis.RTFeedFilters,next=chip.remove(f.clone(shown));this.setFilters(shown.sort?next:{...next,sort:this.rtFilters?.sort ?? null});}
    // Estimated pill widths (Reddit's input chip: 11+16+5 before the 600 12px label, 4+16+5 after, 1px borders, 4px apart)
    // against 42% of the header search bar, so the text field keeps most of the room.
    headerPillsCrowd(items,host){
      const width=host?.getBoundingClientRect?.().width || 0;if(!width)return items.length>2;
      return items.reduce((sum,{chip})=>sum+62+6.6*String(chip.label).length,0)>width*0.42;
    }
    toggleHeaderFilterCard(anchor,all){if(this.headerFilterCard?.anchor===anchor){this.closeHeaderFilterCard(true);return;}this.openHeaderFilterCard(anchor,all);}
    openHeaderFilterCard(anchor,all){
      this.closeHeaderFilterCard();const f=globalThis.RTFeedFilters;
      const card=make('div','rt-header-filters');card.dataset.rtUi='header-filters';card.setAttribute('role','dialog');card.setAttribute('aria-label','Search filters');
      const head=make('div','rt-header-filters-head'),clear=make('button','rt-header-filters-clear','Clear all');clear.type='button';
      clear.addEventListener('click',event=>{event.preventDefault();const shown=all[0].shown;this.closeHeaderFilterCard();this.removeHeaderChip({remove:state=>all.reduce((acc,{chip})=>chip.remove(acc),state)},shown);});
      head.append(make('span','rt-header-filters-title','Filters'),clear);
      const list=make('div','rt-header-filters-list');
      for(const {chip,shown} of all)list.append(f.pill(chip,{make,glyph,onRemove:()=>{this.closeHeaderFilterCard();this.removeHeaderChip(chip,shown);}}));
      card.append(head,list);document.body.append(card);
      const box=anchor.getBoundingClientRect(),width=card.getBoundingClientRect().width || 320;
      card.style.left=Math.max(8,Math.min(box.left,innerWidth-width-8))+'px';card.style.top=(box.bottom+8)+'px';
      const outside=event=>{const path=event.composedPath();if(!path.includes(card) && !path.includes(anchor))this.closeHeaderFilterCard();};
      const keys=event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();this.closeHeaderFilterCard(true);}};
      const away=()=>this.closeHeaderFilterCard();
      document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',keys,true);addEventListener('scroll',away,{passive:true,once:true});addEventListener('resize',away,{once:true});
      anchor.setAttribute('aria-expanded','true');
      this.headerFilterCard={card,anchor,cleanup:()=>{document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',keys,true);removeEventListener('scroll',away);removeEventListener('resize',away);}};
      clear.focus({preventScroll:true});
    }
    closeHeaderFilterCard(focus=false){const open=this.headerFilterCard;if(!open)return;this.headerFilterCard=null;open.cleanup();open.card.remove();open.anchor.setAttribute('aria-expanded','false');if(focus && open.anchor.isConnected)open.anchor.focus?.({preventScroll:true});}
    clearHeaderFilters({keepRow=false,keepElements=false}={}){
      this.closeHeaderFilterCard();
      this.headerFilterObserver?.disconnect();this.headerFilterObserver=null;this.headerFilterSig='';this.headerPillEls=null;this.headerFilterRoot=null;
      this.headerFilterForm?.removeEventListener('submit',this.onOwnSubmit,true);this.headerFilterForm=null;
      if(!keepElements)for(const el of document.querySelector('reddit-search-large')?.shadowRoot?.querySelectorAll('[data-rt-header-filter]') || [])el.remove();
      if(!keepRow && this.rtChips?.hasAttribute('data-rt-in-header')){this.rtChips.removeAttribute('data-rt-in-header');}
    }
    archiveSigNow(){
      if(!this.archiveQueryOn())return 'legacy';const f=globalThis.RTFeedFilters,s=f.serialize(this.rtFilters);
      return JSON.stringify([this.isSearch()?this.context.q:'',this.oldSort()?'asc':'desc',s.rt_date || '',this.rtFilters.subreddits.length===1?this.rtFilters.subreddits[0].toLowerCase():'',this.rtFilters.types.join(',')]);
    }
    // One archive page. Unfiltered views use the established action; filters use RTArchiveQuery.search
    // (date window and a single subreddit are sent to the server, post type is always matched locally).
    async archiveFetch(kind,more){
      const Q=this.archiveQueryOn()?globalThis.RTArchiveQuery:null,cursor=more?this.beforeByKind[kind]:null;
      if(!Q)return this.archive({action:'archive-profile',username:this.context.username,kind,...(cursor?{before:cursor}:{}),...(this.archiveForceUntil>Date.now()?{force:true}:{})});
      const f=globalThis.RTFeedFilters,state=this.rtFilters,range=f.dateRange(state),old=this.oldSort(),controller=new AbortController();this.controllers.add(controller);
      const args={kind,author:this.context.username,sort:old?'asc':'desc',maxPages:1,signal:controller.signal};
      if(this.isSearch()){args.parsed=this.searchParsed;if(this.context.type==='media')args.postTypes=state.types.length?mediaTypes.filter(t=>state.types.includes(t)):mediaTypes;if(args.postTypes && !args.postTypes.length)args.postTypes=['none'];}
      if(range?.after!=null)args.after=range.after;if(range?.before!=null)args.before=range.before;if(cursor!=null)args.cursor=cursor;
      if(state.subreddits.length===1)args.subreddit=state.subreddits[0];if(kind==='post' && state.types.length && !(this.isSearch() && this.context.type==='media'))args.postTypes=[...state.types];
      try{
        // search() is an async generator of pages; one page per call, the page cursor continues it.
        let page=null;for await(const next of Q.search(args)){page=next;break;}
        if(!page)return {posts:[],normalized:true,before:cursor,hasMore:false,cursorStalled:false};
        const back=page.searchedBackTo==null?NaN:Number(page.searchedBackTo),seconds=Number.isFinite(back) && back>0?(back>1e11?Math.floor(back/1000):back):null;
        if(this.isSearch() && page.mode==='local')this.searchArchiveLocal=true;
        return {posts:Array.isArray(page.items)?page.items:[],normalized:true,before:page.cursor ?? null,hasMore:Boolean(page.hasMore),cursorStalled:Boolean(page.stalled),searchedBackTo:seconds,serverFiltered:Boolean(page.serverFiltered)};
      }finally{this.controllers.delete(controller);}
    }
    // A filtered archive result is a search window, never a complete history.
    noteSearched(result){
      if(!this.sourceNotices)return;
      if(this.archiveQueryOn() && !this.isSearch() && result.hasMore && result.searchedBackTo!=null){const date=new Date(result.searchedBackTo*1000).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});this.sourceNotices.searched=(this.oldSort()?'Searched up to ':'Searched back to ')+date;}
      else delete this.sourceNotices.searched;
    }
    aggKey(){return JSON.stringify([this.context?.username,this.kinds(),globalThis.RTFeedFilters.serialize(this.rtFilters || globalThis.RTFeedFilters.empty()).rt_date || '']);}
    // Everything loaded so far, once per item, for the counts fallback.
    loadedItems(){
      const out=new Map();
      for(const post of [...this.archived.values(),...this.live.values()])out.set(post.fullname,{fullname:post.fullname,subreddit:post.subreddit});
      for(const entry of this.nativeEntries()){if(out.has(entry.fullname))continue;const slot=this.virtualNodes.get(entry.node) || entry.node,native=slot.matches('shreddit-post,shreddit-profile-comment')?slot:slot.querySelector('shreddit-post,shreddit-profile-comment');out.set(entry.fullname,{fullname:entry.fullname,subreddit:this.nativeItem(native,entry).subreddit});}
      return [...out.values()];
    }
    // Where the numbers in the list come from: 'archive' only when this exact query's aggregate answered.
    subredditCounts(){
      // On Removed, communities come only from removed items on the current tab (not every community you posted in).
      const removedList=this.isOwnList() && this.context?.list==='removed',type=this.context?.type || 'all';
      const f=globalThis.RTFeedFilters,agg=this.rtAgg,current=agg && agg.key===this.aggKey(),loaded=removedList?[...(this.listState?.items.values() || [])].filter(post=>post.removal?.removed && (type==='comments'?post.kind==='comment':type==='all' || post.kind!=='comment')).map(post=>({fullname:post.fullname,subreddit:post.subreddit})):this.loadedItems();
      if(current && agg.state==='ok')return {source:'archive',entries:f.mergeCounts(agg.buckets,loaded.filter(item=>!this.archived.has(item.fullname) && !this.archived.has(item.fullname?.replace(/^t3_/,''))))};
      const waiting=!this.isOwnList() && Boolean(globalThis.RTArchiveQuery?.aggregate && this.settings.archiveDiscovery) && (!agg || !current || agg.state==='loading');
      // Counts from loaded items shrink to the picked subreddits once a subreddit filter applies, which would hide every
      // other choice. Keep offering the subreddits seen before any was picked (same user, tab and dates).
      let entries=f.mergeCounts([],loaded);const scope=this.aggKey(),picked=this.rtFilters?.subreddits || [];
      if(!picked.length){if(entries.length)this.rtSubSeen={scope,entries};}
      else if(this.rtSubSeen?.scope===scope){const byKey=new Map(this.rtSubSeen.entries.map(entry=>[entry.key.toLowerCase(),{...entry}]));for(const entry of entries){const known=byKey.get(entry.key.toLowerCase());if(!known)byKey.set(entry.key.toLowerCase(),entry);else known.count=Math.max(known.count,entry.count);}
        entries=[...byKey.values()].sort((a,b)=>b.count-a.count || a.key.localeCompare(b.key));}
      return {source:waiting?'loading':'loaded',entries};
    }
    // Counts come from the archive's aggregate; if it is unavailable or slow, loaded items stand in.
    loadSubredditCounts(){
      const Q=globalThis.RTArchiveQuery;if(this.isOwnList() || !Q?.aggregate || !this.settings.archiveDiscovery){this.renderSubredditOptions();return;}
      const key=this.aggKey();if(this.rtAgg?.key===key)return;
      const entry=this.rtAgg={key,state:'loading',buckets:[]},generation=this.generation,range=globalThis.RTFeedFilters.dateRange(this.rtFilters || globalThis.RTFeedFilters.empty());
      const query=kind=>Q.aggregate({kind,author:this.context.username,by:'subreddit',...(range?.after!=null?{after:range.after}:{}),...(range?.before!=null?{before:range.before}:{})});
      let timer;const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('timeout')),8000);});
      Promise.race([Promise.all(this.kinds().map(query)),timeout]).then(results=>{if(!results.every(result=>result?.ok===true))throw Error('unavailable');entry.buckets=results.flatMap(result=>result.buckets || []);entry.state='ok';}).catch(()=>{entry.state='failed';}).finally(()=>{clearTimeout(timer);if(generation===this.generation && this.rtAgg===entry)this.renderSubredditOptions();});
      this.renderSubredditOptions();
    }
    renderSubredditOptions(){
      const m=this.rtMenu,f=globalThis.RTFeedFilters;if(!m?.sub || !f)return;
      const {source,entries}=this.subredditCounts();
      m.sub.panel.render({entries,picked:this.rtFilters?.subreddits || [],source});
    }
    syncFilterMenu(){
      const m=this.rtMenu,f=globalThis.RTFeedFilters;if(!m || !f)return;const state=this.rtFilters || f.empty(),fx=m.fx;
      const set=(el,on)=>el && f.markChecked(fx,el,on);
      set(m.date.get('any'),!state.date);for(const preset of [...(this.isSearch()?[{id:'hour'}]:[]),...f.presets])set(m.date.get(preset.id),state.date?.preset===preset.id);set(m.date.get('custom'),Boolean(state.date && !state.date.preset));
      m.typeList?.sync(state.types);
      set(m.old,this.oldSort());
      if(m.searchSort)for(const [key,el] of m.searchSort)set(el,key===this.effectiveSort());
      const value=(group,text)=>{const el=(group?.el || group?.row)?.querySelector('[data-rt-menu-value]');if(el && el.textContent!==text){el.textContent=text;el.title=text;}};
      const labels=f.valueLabels(state);value(m.groups.date,labels.date);value(m.groups.type,labels.type);value(m.groups.sub,labels.sub);
      const sort=this.menuGroups?.[0];if(sort){sort.sub.toggleAttribute('data-rt-sort-old',this.oldSort());if(this.isSearch() || this.isOwnList())value(sort,({list:'List order',relevance:'Relevance',new:'New',old:'Old',top:'Top',comments:'Most commented',hot:'Hot'})[this.effectiveSort()]);else if(this.oldSort())value(sort,'Old');}
    }
    buildFilterMenu({row,activate,submenu,entry,open,content,menu,dropdown}){
      const f=globalThis.RTFeedFilters;this.rtMenu=null;if(!f)return;
      const polished=true,fx={row,activate,glyph},current=()=>f.clone(this.rtFilters || f.empty()),m=this.rtMenu={fx,date:new Map(),types:new Map(),groups:{},sub:null,old:null,all:null,typeList:null};
      // Single choices close the whole menu; Post type and Subreddit are multi-select and stay open.
      const close=()=>this.closeFeedMenu(dropdown,open);
      const option=(parent,options)=>{const el=f.menuOption(fx,options);el.dataset.rtUi='filter-option';parent.append(el);return el;};
      const group=(label,icon,{key,back=true,onOpen}={})=>{const sub=submenu(key),el=entry(label,icon,sub,{back});el.dataset.rtUi='filter-group';el.dataset.rtFilterGroup=label;if(onOpen)el.rtOnOpen=onOpen;content.append(sub);menu.append(el);this.activityMenuRows.push(el,sub);return {el,sub};};
      // Old goes into Reddit's own Sort group. It needs the archive, so it is only offered when that can answer.
      const sortGroup=this.menuGroups?.[0];
      if(sortGroup && (this.isSearch() || this.isOwnList())){
        // Search sorts stay in the same native submenu, with local URL state.
        for(const item of sortGroup.items){item.dataset.rtSearchSortHidden=String(item.hidden);item.hidden=true;}
        m.searchSort=new Map();
        for(const [value,label,subtitle] of (this.isOwnList()?[['list','List order','Reddit’s order'],['new','New','By creation date'],['old','Old','By creation date']]:[['relevance','Relevance',''],['new','New',''],['old','Old','From the archive'],['top','Top',''],['comments','Most commented','Loaded items only'],['hot','Hot','']])){
          if(value==='relevance' && !this.context.q)continue;
          m.searchSort.set(value,option(sortGroup.sub,{label,subtitle,icon:sortIcons[value],value,onSelect:()=>{close();const next=current();next.sort=value;this.setFilters(next);}}));
        }
      }else if(sortGroup && globalThis.RTArchiveQuery?.search && this.settings.archiveDiscovery){
        m.old=option(sortGroup.sub,{label:'Old',subtitle:'From the archive',icon:'archive',value:'old',onSelect:()=>{const next=current();next.sort=next.sort==='old'?null:'old';this.setFilters(next);close();}});
        for(const item of sortGroup.items)if(!item.rtSortHook){item.rtSortHook=()=>{if(this.rtFilters?.sort==='old'){const next=current();next.sort=null;this.setFilters(next);}};item.addEventListener('click',item.rtSortHook);}
      }
      // Profile filter rows share the same 16px outline glyphs as the main menu.
      const date=m.groups.date=group('Date','calendar',{key:'date'});
      m.date.set('any',option(date.sub,{label:'Any time',icon:polished?'show':false,value:'any',onSelect:()=>{const next=current();next.date=null;this.setFilters(next);close();}}));
      for(const preset of [...(this.isSearch()?[{id:'hour',label:'Past hour'}]:[]),...f.presets])m.date.set(preset.id,option(date.sub,{label:preset.label,icon:polished?'calendar':false,value:preset.id,onSelect:()=>{const next=current();next.date=next.date?.preset===preset.id?null:{preset:preset.id};this.setFilters(next);close();}}));
      m.date.set('custom',option(date.sub,{label:'Custom…',icon:polished?'calendar':false,value:'custom',onSelect:()=>{close();this.openDatePicker(dropdown);}}));
      if(this.context.view!=='comments' && !(this.isSearch() && this.searchKind()==='comment')){
        const type=m.groups.type=group('Post type','text-post',{key:'type'});
        m.typeList=f.typeOptions(fx,{iconSize:polished?16:20,outline:polished,allIcon:polished?'show':false,append:el=>type.sub.append(el),onClear:()=>{const next=current();next.types=[];this.setFilters(next);},onToggle:name=>{const next=current();next.types=next.types.includes(name)?next.types.filter(x=>x!==name):[...next.types,name];this.setFilters(next);}});
        m.all=m.typeList.all;m.types=m.typeList.rows;
      }
      // Subreddit: its own Back + search header, then a scrolling list with community icons.
      const community=m.groups.sub=group('Subreddit',polished?'community':'community-fill',{key:'sub',back:false,onOpen:()=>{m.sub.panel.reset();this.loadSubredditCounts();}});
      const panel=f.subredditPanel({ctx:fx,nativeHeader:polished,onBack:()=>open(null),onClear:()=>{const next=current();next.subreddits=[];this.setFilters(next);},onToggle:name=>{
        const next=current(),has=next.subreddits.findIndex(x=>x.toLowerCase()===name.toLowerCase());
        if(has>=0)next.subreddits.splice(has,1);else if(next.subreddits.length<f.maxSubreddits)next.subreddits.push(name);else return;this.setFilters(next);}});
      community.sub.dataset.rtPanel='true';community.sub.append(panel.el);m.sub={panel,input:panel.input,list:panel.list,note:panel.note,fx};
      this.renderSubredditOptions();
    }
    // Calendar for Custom…: Reddit Tweaks' own date picker in a shadow root over the page.
    openDatePicker(dropdown){
      const Picker=globalThis.RCSDatePicker;if(!Picker)return;
      this.rtPickerHost?.remove();const host=this.rtPickerHost=make('div');host.dataset.rtUi='date-picker';
      const button=dropdown?.querySelector('button[aria-label="Feed options"]'),anchor=button?.getBoundingClientRect?.() || {left:0,bottom:0};
      host.style.cssText=`position:fixed;z-index:2147483000;pointer-events:none;width:0;height:0;left:${Math.max(0,Math.round(anchor.left))}px;top:${Math.max(0,Math.round(anchor.bottom))}px`;
      const shadow=host.attachShadow({mode:'open'}),style=make('style','',`:host{--rcs-bg:var(--color-neutral-background,#fff);--rcs-soft:var(--color-neutral-background-weak,#f2f4f5);--rcs-text:var(--color-neutral-content-strong,#0f1a1c);--rcs-muted:var(--color-neutral-content-weak,#576f76);--rcs-line:var(--color-neutral-border-weak,#e5e8eb);--rcs-hover:var(--color-neutral-background-hover,#e8edef);--rcs-accent:#ff4500}.date-popover{pointer-events:auto;left:0;right:auto;top:4px}`+(Picker.styles || ''));
      const away=event=>{if(!event.composedPath().includes(host))picker.close(false);};
      const picker=new Picker({getAnchor:()=>anchor,onChange:(bounds)=>{
        const today=new Date(),iso=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`,from=bounds.from || '2005-06-01',to=bounds.to || iso,next=globalThis.RTFeedFilters.clone(this.rtFilters || globalThis.RTFeedFilters.empty());
        next.date={from:from<=to?from:to,to:from<=to?to:from};this.setFilters(next);},onClose:()=>{document.removeEventListener('pointerdown',away,true);host.remove();button?.focus?.({preventScroll:true});}});
      const date=this.rtFilters?.date;if(date?.from)picker.applied={mode:'Between',start:date.from,end:date.to};
      shadow.append(style,picker.element);document.body.append(host);picker.show();document.addEventListener('pointerdown',away,true);
    }
    ensureActivityArchive(){
      if(this.isOwnList())return;
      if(this.activityFilter!=='deleted' || !this.settings.archiveDiscovery || this.archiveLoaded || this.activityArchiveAttempted || this.archiveBusy)return;
      this.activityArchiveAttempted=true;this.loadArchive();
    }
    updateActivityEmptyState(){
      if(this.isOwnList())return;
      if(!this.feed || !this.isSearch() && this.activityFilter==='all' && !this.rtActive()){if(this.activityEmpty)this.activityEmpty.hidden=true;return;}
      const nativeMatches=this.nativeEntries().some(e=>!e.node.hidden && !e.node.hasAttribute('data-rt-filter-hidden'));
      const ownMatches=[...this.nodes.values()].some(n=>!n.hidden && (this.feedSlot(n).parentElement===this.feed));
      const working=this.waitingRetries().length || this.busy || this.archiveBusy || this.activeProfileBatch || this.metadataPending || this.recoveryActive || this.nativeBatch.active || this.nativeBatch.queue.length || this.nativeFeedLoading();
      const errors=Object.values(this.sourceErrors || {}).some(Boolean) || this.status?.dataset.error==='true';
      const show=!nativeMatches && !ownMatches && !working && !errors && !this.hasMoreProfile() && (this.loaded || this.archiveLoaded);
      if(this.isSearch()){if(this.activityEmpty)this.activityEmpty.hidden=true;this.updateSearchEmpty(show,'searchEmpty');return;}
      if(!show){if(this.activityEmpty)this.activityEmpty.hidden=true;return;}
      if(!this.activityEmpty){const empty=this.activityEmpty=make('div','mt-[100px] flex justify-center items-center flex-col');empty.dataset.rtUi='activity-empty';empty.setAttribute('role','status');
        // Reddit's native rpl empty-state structure; a separate identity keeps the
        // profile privacy-notice guard from capturing this adapted presentation.
        const root=make('div','flex flex-col items-center w-full');root.setAttribute('rpl','');const creative=make('div','w-full flex flex-col items-center overflow-hidden box-border');creative.dataset.testid='empty-state-creative';const image=make('img','mb-0 mt-lg mb-lg');image.src='https://www.redditstatic.com/shreddit/assets/snoo_wave.png';image.alt='Image of a Snoo waving';image.width=128;image.loading='lazy';creative.append(image);
        const body=make('div','flex flex-col w-full items-center box-border px-md gap-md pb-md'),copy=make('div','max-w-[480px] flex flex-col items-center text-center');this.emptyTitle=make('div','text-title-2 text-neutral-content-strong');this.emptyTitle.setAttribute('role','heading');this.emptyTitle.setAttribute('aria-level','2');copy.append(this.emptyTitle,make('div','text-body-1 text-neutral-content-weak','In loaded activity. Search and archive coverage may be incomplete.'));body.append(copy);root.append(creative,body);empty.append(root);const template=globalThis.RTProfileNoticeGuard?.emptyTemplate?.() || this.emptyFeed?.cloneNode(true);if(template?.querySelector('[data-testid="empty-state-creative"]') && template.querySelector('[role="heading"],h2')){empty.className=template.className;empty.replaceChildren(...template.childNodes);for(const child of empty.querySelectorAll('[id]'))child.removeAttribute('id');this.emptyTitle=empty.querySelector('[role="heading"],h2');const description=empty.querySelector('.text-body-1');if(description)description.textContent='In loaded activity. Search and archive coverage may be incomplete.';}this.feed.before(empty);}
      const noun=this.context.view==='comments'?'comments':this.context.view==='posts'?'posts':'posts or comments';const text=this.isSearch()?(this.context.q?"Hm... we couldn't find any results for \""+this.context.q+"\"":'No '+(this.searchKind()==='comment'?'comments':'posts')+' found'):'No '+(this.activityFilter==='all'?'':this.activityFilter+' ')+noun+' found';if(this.emptyTitle.textContent!==text)this.emptyTitle.textContent=text;this.activityEmpty.hidden=false;
    }
    nativeRestrictions(native){const over18=Boolean(native?.matches('[nsfw],[is-nsfw],[over-18]')),spoiler=Boolean(native?.hasAttribute('spoiler'));return {over18,spoiler,restricted:over18 || spoiler || Boolean(native?.querySelector('shreddit-content-gate,[slot="nsfw-blocker"]'))};}
    recoveryInView(node){
      if(!node)return false;const slot=this.feedSlot(node);if(!slot.isConnected || slot.hidden || slot.hasAttribute('data-rt-filter-hidden'))return false;
      const rect=slot.getBoundingClientRect();if(rect.bottom>=0 && rect.top<=innerHeight+200)return true;
      if(typeof IntersectionObserver==='function'){if(!this.recoveryObserver)this.recoveryObserver=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting))this.scheduleRecovery();},{rootMargin:'200px'});if(!this.recoveryObserved.has(slot)){this.recoveryObserved.add(slot);this.recoveryObserver.observe(slot);}}return false;
    }
    scheduleRecovery(){
      if(this.isOwnList())return;
      if(this.isSearch() || this.context?.kind!=='profile' || !this.settings.archiveDiscovery || !this.settings.restoreDeletedContent || this.archiveOnly || this.recoveryTimer || this.recoveryActive || this.sourceRetries?.get('recovery')?.timer)return;
      const candidates=new Map();
      for(const post of this.renderedPosts || [])if(this.recoveryInView(this.nodes.get(itemKey(post))) && ['deleted','removed'].includes(this.verifiedStatus(post,this.nodes.get(itemKey(post))?.querySelector('shreddit-post,shreddit-profile-comment'))) && !post.archivedBody && !this.archived.has(itemKey(post)) && !this.recoveryChecked.has(post.fullname))candidates.set(post.fullname,{id:post.id,node:this.nodes.get(itemKey(post)),kind:post.kind==='comment'?'comment':'post',status:this.verifiedStatus(post,this.nodes.get(itemKey(post))?.querySelector('shreddit-post,shreddit-profile-comment'))});
      for(const entry of this.nativeEntries()){const original=this.virtualNodes.get(entry.node) || entry.node,native=original.matches('shreddit-post,shreddit-profile-comment')?original:original.querySelector('shreddit-post,shreddit-profile-comment'),kind=native?.matches('shreddit-profile-comment')?'comment':'post',status=this.verifiedStatus({fullname:entry.fullname,kind,status:'unknown'},native);if(this.recoveryInView(entry.node) && ['deleted','removed'].includes(status) && !this.recoveryChecked.has(entry.fullname) && !this.archived.has(kind==='comment'?entry.fullname:entry.fullname?.replace(/^t3_/,'')))candidates.set(entry.fullname,{id:entry.fullname?.replace(/^t[13]_/,''),kind,status,node:entry.node});}
      if(!candidates.size)return;
      const generation=this.generation,context=this.context;this.recoveryTimer=setTimeout(async()=>{this.recoveryTimer=null;if(generation!==this.generation)return;this.recoveryActive=true;this.updateProfileLoading();
        const current=()=>generation===this.generation && pageRoute()?.key===context.key && this.settings.archiveDiscovery && this.settings.restoreDeletedContent;
        // Ids count as checked only once the archive has answered; a failed request leaves them for the retry.
        let group=[];
        try{for(const kind of ['post','comment']){group=[...candidates.entries()].filter(([,p])=>p.kind===kind && this.recoveryInView(p.node)).slice(0,25);if(!group.length)continue;const result=await this.archive({action:'archive-recover',username:context.username,kind,ids:group.map(([,p])=>p.id)});if(!current())return;for(const [id] of group)this.recoveryChecked.add(id);this.clearSourceRetries(name=>name==='recovery');for(const raw of result.posts || []){const archived=M.normalizeItem(raw,{source:'arctic-shift'});if(!archived || archived.author.toLowerCase()!==context.username.toLowerCase())continue;const proof=candidates.get(archived.fullname);if(!proof)continue;if(!this.archived.has(itemKey(archived)))this.recoveredKeys.add(itemKey(archived));this.archived.set(itemKey(archived),archived);const existing=this.live.get(itemKey(archived));const restrictions=this.nativeRestrictions(proof.native || proof.node?.querySelector('shreddit-post,shreddit-profile-comment') || proof.node);this.live.set(itemKey(archived),{...archived,...existing,over18:archived.over18 || existing?.over18 || restrictions.over18,spoiler:archived.spoiler || existing?.spoiler || restrictions.spoiler,source:'reddit',status:proof.status,body:'['+(proof.status==='removed'?'removed':'deleted')+']'});}delete this.sourceErrors.recovery;this.render();}}
        catch(error){if(current()){
          // A busy or briefly unavailable archive is retried quietly with backoff.
          if(this.transientFailure(error,'archive') && this.scheduleSourceRetry('recovery',error,'archive'))return;
          for(const [id] of group)this.recoveryChecked.add(id);this.sourceErrors.recovery=error.message;this.setStatus('Archived details could not be loaded. Select Refresh activity to retry.',true);}}
        finally{if(generation===this.generation){this.recoveryActive=false;this.updateProfileLoading();this.updateActivityEmptyState();this.scheduleRecovery();}}
      },80);
    }
    verifiedStatus(post,native){
      if(['deleted','removed'].includes(post.status))return post.status;const stored=this.postStatuses.get(post.fullname);
      if(!native)return stored || post.status;const state=native.getAttribute('item-state')?.toLowerCase(),body=native.querySelector(post.kind==='comment'?'[id$="-post-rtjson-content"],.md':'[slot="text-body"]'),text=body?.querySelector('[data-rt-original-text]')?.getAttribute('data-rt-original-text') || body?.textContent?.trim();
      // The restored body keeps Reddit's original notice in data-rt-original-text.
      const status=M.domStatus(native) || M.noticeStatus(text);if(status)this.postStatuses.set(post.fullname,status);return status || stored || post.status;
    }
    eligibleProfilePost(post,node){
      // Search metadata omits the true type. Hydrate the native fragment before
      // applying type/media filters; date and community still narrow candidates.
      if(!this.filterMatch(post,{hydrate:this.isSearch()}))return false;
      if(this.activityFilter!=='deleted')return true;
      const status=this.verifiedStatus(post,node?.querySelector('shreddit-post,shreddit-profile-comment'));
      // The archive supplies candidates, never proof of current deletion. Avoid
      // spending the Deleted card budget on known available search results.
      return ['deleted','removed'].includes(status) || status!=='available' && post.source==='arctic-shift';
    }
    matchesActivity(post,node,visible=this.visibleIds()){
      if(!this.filterMatch(post))return false;if(this.activityFilter==='all')return true;const status=this.verifiedStatus(post,node?.matches?.('shreddit-post,shreddit-profile-comment')?node:node?.querySelector('shreddit-post,shreddit-profile-comment'));
      if(this.isSearch() && this.activityFilter==='hidden')return post.source==='arctic-shift' && status==='available' && !this.live.has(itemKey(post));
      return this.activityFilter==='deleted'?['deleted','removed'].includes(status):(post.source==='reddit' || status==='available') && !['deleted','removed'].includes(status) && !visible.has(post.fullname);
    }
    syncActivityPresentation(){
      if(this.isOwnList())return;
      if(!this.feed)return;if(this.activityFilter==='all')this.feed.removeAttribute('data-rt-activity');else if(this.feed.dataset.rtActivity!==this.activityFilter)this.feed.dataset.rtActivity=this.activityFilter;
    }
    observeFeedPresentation(){
      if(this.feedPresentationObserver || !this.feed)return;const feed=this.feed;
      this.feedPresentationObserver=new MutationObserver(records=>{
        if(this.feed!==feed)return;this.trackVirtualization(records);if(this.context?.key!==pageRoute()?.key){this.scan();return;}
        // Scrolling swaps cards for placeholders constantly. Those swaps carry our
        // state over in trackVirtualization, so they need no reconciliation pass.
        const swap=r=>r.type==='childList' && r.addedNodes.length===1 && r.removedNodes.length===1 && [r.addedNodes[0],r.removedNodes[0]].some(n=>n.nodeType===1 && n.matches('.virtualized-placeholder'));
        if(records.every(r=>this.ownsMutation(r) || swap(r)))return;
        // CSS gates newly inserted native cards immediately. Qualify them in
        // this mutation microtask, before paint, without the general scan delay.
        this.deduplicate();
        if(records.some(r=>r.type==='childList' && [...r.addedNodes].some(n=>n.nodeType===1 && !n.closest?.('[data-rt-ui]'))))this.observeNativeLoading();
        this.updateProfileLoading();
      });
      this.feedPresentationObserver.observe(feed,{childList:true,subtree:true,attributes:true,attributeFilter:['item-state','deleted','removed','hidden','data-feed-element-id','comment-id','id','created-timestamp']});
    }
    filterNativeEntries(entries){
      const rt=this.rtActive(),predicate=rt?this.rtPredicate():null,old=this.oldSort(),activity=this.activityFilter!=='all';
      for(const entry of entries){const node=entry.node,original=this.virtualNodes.get(node) || node,native=original.matches('shreddit-post,shreddit-profile-comment')?original:original.querySelector('shreddit-post,shreddit-profile-comment'),kind=native?.matches('shreddit-profile-comment')?'comment':'post',post={fullname:entry.fullname,kind,status:'unknown',source:'reddit'};
        if(!activity && !rt){if(this.filteredNative.has(node)){const hidden=this.filteredNative.get(node);node.hidden=hidden;if(original!==node)original.hidden=hidden;this.filteredNative.delete(node);}node.removeAttribute('data-rt-filter-hidden');node.removeAttribute('data-rt-activity-match');if(original!==node){original.removeAttribute('data-rt-filter-hidden');original.removeAttribute('data-rt-activity-match');}continue;}if(!this.filteredNative.has(node))this.filteredNative.set(node,node.hidden);
        // Old replaces the feed with the archive's list; date, type and subreddit hide what does not match.
        let hidden=activity && (this.activityFilter==='hidden' || !['deleted','removed'].includes(this.verifiedStatus(post,native)));if(!hidden && rt)hidden=old || !predicate(this.nativeItem(native,entry));
        if(node.hidden!==hidden)node.hidden=hidden;node.toggleAttribute('data-rt-filter-hidden',hidden);node.toggleAttribute('data-rt-activity-match',activity && !hidden);if(original!==node){original.toggleAttribute('data-rt-filter-hidden',hidden);original.toggleAttribute('data-rt-activity-match',activity && !hidden);}}
    }
    updateArchiveSummary(){if(!this.archiveStats)return;const posts=this.renderedPosts || [],times=posts.map(p=>p.created),date=value=>new Date(value*1000).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});const set=(key,value)=>{if(this.archiveStats[key].textContent!==value)this.archiveStats[key].textContent=value;};set('posts',String(posts.filter(p=>p.kind!=='comment').length));set('comments',String(posts.filter(p=>p.kind==='comment').length));set('oldest',times.length?date(Math.min(...times)):'—');set('newest',times.length?date(Math.max(...times)):'—');}
    retrySettings(){this.reset();return this.loadSettings();}
    kinds(){if(this.isSearch())return [this.searchKind()];return this.context.view==='overview'?['post','comment']:[this.context.view==='comments'?'comment':'post'];}
    noteSourcePage(key,posts,more){
      const values=posts.map(post=>this.context.sort==='top'?post.score:post.created).filter(Number.isFinite),previous=this.sourceFrontiers.get(key);
      this.sourceFrontiers.set(key,{more,floor:more?(values.length?Math.min(...values):previous?.floor ?? -Infinity):-Infinity});
    }
    publicationFloor(){
      // Descending source pages have different depths. Only publish the shared
      // covered prefix; a later page from a shallower stream can otherwise
      // insert newer comments above already published posts (or vice versa).
      // Empty cursor pages establish no date boundary. They remain pageable,
      // but must not pin a healthy stream behind an infinite publication floor.
      // A request still unanswered after sourceWaitMs no longer holds the
      // others back; its late results are placed by date when they arrive.
      const now=Date.now(),waiting=key=>this.sourcePending.has(key) && !this.sourceOverdue(key,now);
      if(this.freeMerge())return -Infinity;
      const applies=key=>this.activityFilter!=='deleted' || key.startsWith('archive-');
      let floor=-Infinity;
      for(const key of this.sourcePending)if(applies(key) && !this.sourceFrontiers.has(key) && waiting(key))return Infinity;
      // Archive Top pages are chronological, not score-ordered. Only New
      // has a comparable continuation boundary across every provider.
      if(this.context.sort!=='new')return [...this.sourcePending].some(key=>applies(key) && waiting(key))?Infinity:-Infinity;
      for(const [key,state] of this.sourceFrontiers)if(applies(key) && state.more && (!this.sourcePending.has(key) || waiting(key)))floor=Math.max(floor,state.floor);
      return floor;
    }
    sourceOverdue(key,now=Date.now()){const started=this.sourceStartedAt?.get(key);return started!=null && now-started>=this.sourceWaitMs;}
    // One timer re-evaluates the merge gates when the earliest budget expires.
    scheduleGate(delay){
      const at=Date.now()+Math.max(0,delay);if(this.gateTimer && this.gateAt<=at)return;
      clearTimeout(this.gateTimer);this.gateAt=at;const generation=this.generation;
      this.gateTimer=setTimeout(()=>{this.gateTimer=null;this.gateAt=Infinity;if(generation!==this.generation || !this.host?.isConnected || pageRoute()?.key!==this.context?.key)return;this.render({reuseCards:true});},Math.max(0,delay)+16);
    }
    canPublishProfilePost(post,floor=this.publicationFloor()){return (this.context.sort==='top'?post.score:post.created)>=floor;}
    // Reddit's shell around its cards: the feed's children and those of its
    // faceplate-batch wrappers. Never descends into cards or our own elements;
    // pagers and loaders (the only shell nodes with content) are searched inside.
    shellNodes(){
      const out=[];if(!this.feed)return out;
      for(const child of elementChildren(this.feed)){if(child.localName==='faceplate-batch')out.push(...elementChildren(child));else out.push(child);}
      return out;
    }
    shellQuery(selector,{deep=false}={}){
      const found=[];
      for(const node of this.shellNodes()){
        if(node.hasAttribute('data-rt-ui') || node.matches('shreddit-post,shreddit-profile-comment,.virtualized-placeholder'))continue;
        if(node.matches(selector))found.push(node);
        if(deep && node.matches('faceplate-partial,shreddit-feed-load-more-observer,shreddit-feed-page-loading'))found.push(...node.querySelectorAll(selector));
      }
      return found;
    }
    nativeContinuation(){
      const candidates=this.shellQuery('faceplate-partial[slot="load-after"]:is([loading="lazy"],[loading="programmatic"])[src],shreddit-feed-load-more-observer[cursor]');
      return candidates.filter(node=>node.matches('faceplate-partial')).at(-1) || candidates.at(-1) || null;
    }
    syncNativeOrder(entries){
      if(!this.feed)return;
      const enabled=this.context.sort==='new' && this.activityFilter==='all' && (this.autoDiscover || this.loaded || this.archiveLoaded),visible=new Set(entries.map(entry=>entry.fullname));
      let boundary=enabled?this.publicationFloor():-Infinity;
      if(enabled && this.autoDiscover && !this.loaded && !this.archiveLoaded && !this.primaryFailure())boundary=Infinity;
      if(enabled){const next=this.renderedPosts.find(post=>!visible.has(post.fullname) && !this.publishedCards.has(itemKey(post)));if(next)boundary=Math.max(boundary,next.created);}
      const previous=this.mergePendingNodes;this.mergePendingNodes=new Set();let waiting=false,release=Infinity;const now=Date.now();
      for(const entry of entries){const original=this.virtualNodes.get(entry.node) || entry.node;let pending=enabled && !entry.pinned && Number.isFinite(entry.timestamp) && !this.publishedNative.has(original) && !this.initialNative.has(original) && entry.timestamp<=boundary;
        if(pending){
          // Reddit's own page never waits longer than the native budget.
          if(!this.nativeSeenAt.has(original))this.nativeSeenAt.set(original,now);
          const expires=this.nativeSeenAt.get(original)+this.nativeWaitMs;if(now>=expires)pending=false;else release=Math.min(release,expires);
        }
        for(const node of new Set([entry.node,original])){node.toggleAttribute('data-rt-order-pending',pending);if(pending)this.mergePendingNodes.add(node);}
        if(pending)waiting=true;else if(enabled && (entry.pinned || Number.isFinite(entry.timestamp)))this.publishedNative.add(original);
      }
      for(const node of previous)if(!this.mergePendingNodes.has(node))node.removeAttribute('data-rt-order-pending');
      // Keep Reddit's retained cards, but pause its next pager while our search
      // has not covered their dates. Otherwise invisible native pages can walk
      // ahead endlessly without increasing the displayed combined prefix.
      this.feed.toggleAttribute('data-rt-merge-waiting',waiting);
      if(release<Infinity)this.scheduleGate(release-now);
    }
    nativeEntries(){
      if(!this.feed)return [];
      this.flushVirtualization();
      const entries=[];
      for(const slot of elementChildren(this.feed)){
        const node=this.virtualNodes.get(slot) || slot;
        if(node.hasAttribute('data-rt-ui'))continue;
        const content=node.matches('shreddit-post,shreddit-profile-comment')?node:node.querySelector('shreddit-post,shreddit-profile-comment');
        if(!content)continue;
        const fullname=content.getAttribute('comment-id') || content.getAttribute('data-feed-element-id') || content.id;
        const timestamp=Date.parse(content.getAttribute('created-timestamp') || content.querySelector('faceplate-timeago[ts]')?.getAttribute('ts'))/1000;
        const rawScore=content.getAttribute('score') ?? content.querySelector('shreddit-comment-action-row[score]')?.getAttribute('score') ?? content.querySelector('faceplate-number[number]')?.getAttribute('number');
        entries.push({node:slot,fullname,timestamp,score:rawScore==null?NaN:Number(rawScore),pinned:content.hasAttribute('stickied')});
      }
      return entries;
    }
    syncNativeRules(entries){
      if(!this.feed)return;
      // Reddit may append several rules separated only by empty pager observers.
      // Traverse its native batch, but never descend into cards or other content.
      const slots=new Set(entries.map(entry=>entry.node)),previous=this.collapsedNativeRules || new Set(),collapsed=new Set();let rules=[],hiddenCard=false,leftVisible=false;
      const finish=rightVisible=>{const keep=hiddenCard?(leftVisible || rightVisible?1:0):1;for(const rule of rules.slice(keep))collapsed.add(rule);rules=[];hiddenCard=false;};
      const visit=(node,batch=null)=>{
        const original=this.virtualNodes.get(node) || node;
        if(original.matches('hr.border-0.border-b-sm.border-solid.border-b-neutral-border-weak')){rules.push(node);return;}
        if(original.matches('shreddit-feed-load-more-observer') && !original.children.length && !original.textContent.trim() && node.getBoundingClientRect().height===0)return;
        const native=slots.has(node) || Boolean(batch && (original.matches('article,shreddit-post,shreddit-profile-comment') || original.matches('shreddit-feed-load-more-observer') && original.querySelector('shreddit-post,shreddit-profile-comment'))),owned=['activity-item','activity-slot'].includes(node.dataset.rtUi);
        const hidden=native && (node.hasAttribute('data-rt-order-pending') || node.hasAttribute('data-rt-filter-hidden') || batch?.hasAttribute('data-rt-order-pending') || batch?.hasAttribute('data-rt-filter-hidden')) || owned && (node.hidden || node.hasAttribute('data-rt-retired'));
        if(hidden){hiddenCard=true;return;}
        const visible=native || owned;finish(visible);leftVisible=visible;
      };
      for(const node of elementChildren(this.feed)){
        if(node.matches('faceplate-batch')){for(const child of elementChildren(node))visit(child,node);}else visit(node);
      }
      finish(false);
      for(const node of previous)if(!collapsed.has(node))node.removeAttribute('data-rt-rule-collapsed');
      for(const node of collapsed)if(!previous.has(node))node.setAttribute('data-rt-rule-collapsed','');
      this.collapsedNativeRules=collapsed;
    }
    // Cards of this profile's feed only: a matching card elsewhere on the page
    // (a sidebar, another tab) says nothing about what this feed shows.
    visibleIds(){
      const ids=new Set();if(!this.feed)return ids;
      for(const entry of this.nativeEntries())if(entry.fullname)ids.add(entry.fullname);
      for(const batch of elementChildren(this.feed)){
        if(batch.localName!=='faceplate-batch')continue;
        for(const node of elementChildren(batch)){if(node.hasAttribute('data-rt-ui'))continue;const card=node.matches(cardSelector)?node:node.querySelector(cardSelector);if(card)ids.add(card.getAttribute('comment-id') || card.getAttribute('data-fullname') || card.id);}
      }
      return ids;
    }
    /* Measured 2026-11-17 (phone emulation, 4x CPU, fast flicks on a long profile): re-ordering the feed forces layout
       of the whole feed, and doing it while the reader flicks starved Reddit's own frame work, so flicks reached blank
       placeholders. While the reader scrolls away from the feed end, this work waits until scrolling pauses, merged
       into one run; near the end (new cards are needed) it runs at once. */
    deferWhileScrolling(key,run){
      const idle=this.scrollIdleMs ?? 200,since=performance.now()-(this.lastScrollAt ?? -Infinity);if(since>=idle || this.batchInView)return false;
      (this.scrollDeferred ||= new Map()).set(key,run);if(!this.scrollDeferTimer)this.scrollDeferTimer=setTimeout(()=>this.flushScrollDeferred(),idle-since+10);return true;
    }
    flushScrollDeferred(){
      this.scrollDeferTimer=null;if(this.dead || !this.scrollDeferred?.size)return;
      const idle=this.scrollIdleMs ?? 200,since=performance.now()-(this.lastScrollAt ?? -Infinity);
      if(since<idle && !this.batchInView){this.scrollDeferTimer=setTimeout(()=>this.flushScrollDeferred(),idle-since+10);return;}
      const jobs=[...this.scrollDeferred.values()];this.scrollDeferred.clear();for(const job of jobs)job();
    }
    // A finished background card: publish what's ready and put the feed in order.
    reconcileFeed(){if(this.deferWhileScrolling('reconcile',()=>this.reconcileFeed()))return;this.settleProfileBatch();this.deduplicate();}
    deduplicate(){
      if(this.isOwnList())return;
      if(!this.host || this.context.kind!=='profile')return;
      if(this.deferWhileScrolling('deduplicate',()=>this.deduplicate()))return;
      return this.withFeedViewport(()=>{
      this.syncActivityPresentation();
      const entries=this.nativeEntries(),visible=this.visibleIds(),sort=this.effectiveSort(),normal=entries.filter(e=>!e.pinned && (sort==='top'?Number.isFinite(e.score):sort==='hot' || Number.isFinite(e.timestamp))),rank=new Map(this.renderedPosts.map((post,index)=>[post.fullname,index]));
      this.syncNativeOrder(entries);
      const continuation=this.nativeContinuation();
      const horizon=this.freeMerge()?-Infinity:continuation && sort!=='hot'?(normal.length?Math.min(...normal.map(e=>sort==='top'?e.score:Math.floor(e.timestamp))):sort==='new'?Infinity:-Infinity):-Infinity;
      const nativeTail=continuation?(()=>{let n=continuation;while(n.parentElement && n.parentElement!==this.feed)n=n.parentElement;return n.parentElement===this.feed?n:null;})():null;
      // Our sentinel is also a real tail. Using null here appended stable
      // cards past it on every scan, then moved the sentinel back again. Those
      // remove/reinsert cycles disrupt native virtualization and scroll anchors.
      const tail=nativeTail || (this.loading?.parentElement===this.feed?this.loading:null);
      const buckets=new Map(),entriesByName=new Map(),oldMode=this.oldSort();let count=0,deferred=0;
      for(const entry of entries){const list=entriesByName.get(entry.fullname);if(list)list.push(entry);else entriesByName.set(entry.fullname,[entry]);}
      for(const post of this.renderedPosts || []){
        const node=this.nodes.get(itemKey(post));if(!node)continue;
        const slot=this.feedSlot(node),virtualized=slot!==node;
        const pendingDuplicate=this.publishedCards.has(itemKey(post)) && (entriesByName.get(post.fullname) || []).some(entry=>entry.node.hasAttribute('data-rt-order-pending'));
        const duplicate=visible.has(post.fullname) && !pendingDuplicate && !oldMode,older=this.activityFilter!=='deleted' && !duplicate && !this.publishedCards.has(itemKey(post)) && (sort==='top'?post.score:post.created)<horizon;
        const staged=this.batchedProfile && (!this.publishedCards.has(itemKey(post)) || !['ready','failed'].includes(node.dataset.rtNativeState));const matches=this.matchesActivity(post,node,visible),qualify=this.activityFilter==='deleted' && !duplicate && !older && !staged && !['deleted','removed'].includes(this.verifiedStatus(post,node.querySelector('shreddit-post,shreddit-profile-comment'))) && node.dataset.rtNativeState==='idle';const hide=duplicate || older || staged || !matches;if(node.hidden!==hide)node.hidden=hide;
        if(qualify){node.dataset.rtQualify='true';this.queueNative(node);}const deferral=older?'older':'';if(node.getAttribute('data-deferred')!==deferral)node.setAttribute('data-deferred',deferral);
        if(virtualized && slot.hidden!==node.hidden)slot.hidden=node.hidden;
        if(node.hidden){if(duplicate){const entry=entriesByName.get(post.fullname)?.[0],original=this.virtualNodes.get(entry?.node) || entry?.node,native=original?.matches('shreddit-post,shreddit-profile-comment')?original:original?.querySelector('shreddit-post,shreddit-profile-comment');if(native){const archive=this.archived.get(itemKey(post)),status=this.verifiedStatus(post,native),owned=archive?.source==='arctic-shift' && archive.fullname===post.fullname && archive.author.toLowerCase()===this.context.username.toLowerCase();if(owned && ['deleted','removed'].includes(status) || this.recoverBody(post,native)){this.nativeDecorations.add(native);this.decorateNative(post,native);}}}this.nativeObserver?.unobserve(node);if(older)deferred++;if(!virtualized && !this.publishedCards.has(itemKey(post)) && node.parentElement!==this.results)this.results.append(node);continue;}
        count++;
        // A newly fetched native duplicate may still be behind the merge gate.
        // Retain its displayed peer in the same slot until native handoff.
        if(pendingDuplicate && slot.parentElement===this.feed)continue;
        const target=oldMode?tail:normal.find(entry=>sort==='top'?entry.score<=post.score:sort==='hot'?rank.has(entry.fullname) && rank.get(entry.fullname)>rank.get(post.fullname):entry.timestamp<=post.created)?.node || tail;
        if(!buckets.has(target))buckets.set(target,[]);buckets.get(target).push(slot);
      }
      // Reconcile only extension-owned cards. Reddit retains ownership and order of its nodes.
      for(const [target,nodes] of buckets){let anchor=target;for(let i=nodes.length-1;i>=0;i--){const node=nodes[i];if(!this.virtualNodes.has(node) && (node.parentElement!==this.feed || node.nextElementSibling!==anchor))this.feed.insertBefore(node,anchor);anchor=node;}}
      for(const nodes of buckets.values())for(const node of nodes)if(node.dataset.rtNativeState==='idle'){if(this.nativeObserver)this.nativeObserver.observe(node);else this.queueNative(node);}
      this.filterNativeEntries(entries);this.syncNativeRules(entries);this.summaryCounts={count,deferred};this.updateActivityEmptyState();this.scheduleRecovery();
      if(this.emptyFeed){this.emptyFeed.hidden=this.activityFilter!=='all' || this.rtActive() || count>0 || this.emptyWasHidden;this.emptyFeed.toggleAttribute('data-rt-empty-suppressed',count>0);}
      if(!this.busy && this.status.dataset.error!=='true')this.summarize();this.updateProfileLoading();this.capturePresentedFeed();
      });
    }
    // Search keeps Reddit's spacing (spec §30): its first result and no-results view sit 8px under the scope switcher.
    // The controls row is drawn inside the filter row, so it keeps no margins or flex box, and an empty toolbar
    // (display:contents in search) must not stop that margin from collapsing.
    /* Reddit's faceplate-timeago renders <time datetime title>6mo ago</time> into itself once Reddit has loaded its script,
       which some search pages (Removed comments, Media) never do. An element still empty shortly after drawing gets
       the same markup, so a row always shows its time. */
    timeFallback(element,ts){
      setTimeout(()=>{
        if(element.querySelector('time') || !element.parentNode || !Number.isFinite(ts))return;
        const date=new Date(ts*1000),seconds=Math.max(0,Math.floor(Date.now()/1000-ts)),format=new Intl.RelativeTimeFormat('en',{style:'narrow',numeric:'always'});
        const days=Math.floor(seconds/86400),text=seconds<60?'just now':seconds<3600?format.format(-Math.floor(seconds/60),'minute'):seconds<86400?format.format(-Math.floor(seconds/3600),'hour'):days<30?format.format(-days,'day'):days<365?format.format(-Math.floor(days/30),'month'):format.format(-Math.floor(days/365),'year');
        const node=document.createElement('time');node.setAttribute('datetime',date.toISOString());node.title=date.toLocaleString(undefined,{dateStyle:'full',timeStyle:'long'});node.textContent=text;element.replaceWith(node);
      },this.timeFallbackMs ?? 600);
    }
    syncSearchLayout(){
      const search=this.isSearch();this.host?.toggleAttribute('data-rt-search',search);
      if(this.controlsTarget && this.controlsTarget.className!=='contents'){this.controlsTarget.classList.toggle('my-md',!search);this.controlsTarget.classList.toggle('flex',!search);}
    }
    summarize(){
      this.syncSearchLayout();
      if(this.isOwnList()){this.summarizeOwnList();return;}
      const {count=0,deferred=0}=this.summaryCounts || {},noun=this.context.view==='comments'?(count===1?'comment':'comments'):this.context.view==='overview'?(count===1?'item':'items'):count===1?'post':'posts';
      const archiveView=this.activityFilter==='deleted' && this.settings.archiveDiscovery,errors=Object.entries(this.sourceErrors || {}).filter(([key,value])=>value && !key.startsWith('metadata-') && !(archiveView && ['post','comment','comment-public','request'].includes(key))).map(([,value])=>value);this.setStatus(errors.length?errors.join(' '):this.nativeBatch.blocked?'Reddit is limiting card requests. Select Refresh activity to retry.':count?`${count} ${this.archiveOnly?'archived':'additional'} ${noun}${this.rtActive()?' · Search and archive coverage may be incomplete':''}`:this.rtActive()?'No matches in loaded activity':'Activity checked',errors.length>0 || this.nativeBatch.blocked===true);
      if(this.isSearch() && !errors.length && !this.nativeBatch.blocked)this.setStatus(this.searchParsed.invalid?this.searchParsed.errors.join('. '):count?count+' results · Search and archive coverage may be incomplete':'Search and archive coverage may be incomplete',Boolean(this.searchParsed.invalid));
      if(this.isSearch()){
        if(this.searchParsed.invalid)this.sourceNotices.query=this.searchParsed.errors.join('. ');
        // Local filtering stays in the status for assistive tech; search shows no banner above Reddit's first result.
        else delete this.sourceNotices.query;
      }
      // Quiet notes: a source paused on purpose, never a failure banner.
      if(this.notice){const notes=[...new Set(Object.values(this.sourceNotices || {}).filter(Boolean))],text=notes.join(' · ');if(this.notice.textContent!==text)this.notice.textContent=text;this.notice.hidden=!notes.length;this.notice.title=notes.includes(publicBlockedNote)?'Reddit refused the extension’s logged-out comment search (HTTP 403). It is skipped for about 10 minutes; signed-in search, Reddit’s own feed and the archive keep loading.':'';}
      if(this.archiveOnly)this.updateArchiveSummary();
      if(this.archiveOnly && this.settings.archiveDiscovery){this.archiveEmpty.hidden=this.isSearch() || this.activityFilter!=='all' || !this.archiveLoaded || count>0 || this.renderedPosts.length>0;this.archiveEmpty.textContent='No archived activity found for this username. Archive coverage may be incomplete.';}
      this.status.title=(deferred?`${deferred} older discoveries will appear when Reddit loads that part of the feed. `:'')+[...new Set(Object.entries(this.sourceErrors || {}).filter(([key,value])=>key.startsWith('metadata-') && value).map(([,value])=>value)),'Search and archive coverage may be incomplete.'].join(' ');
    }
    setStatus(text,error=false){
      if(this.isSearch() && !this.isOwnList() && !this.searchParsed?.invalid && (this.searchReddit?.residual || this.searchArchiveLocal) && !text.includes('filtered locally') && !(error && this.sourceNotices?.query))text+=' · Some matches filtered locally'+(text.includes('may be incomplete')?'':' · Results may be incomplete');
      this.status.textContent=text;this.status.dataset.error=String(error);
    }
    async request(parameters){const controller=new AbortController(),identity=parameters.action==='own-list-identity';let started=Date.now(),timeoutRetries=0,responseRetries=0;if(identity)this.ownIdentityController=controller;else this.controllers.add(controller);try{
      for(;;){
        if(Date.now()-started>=10000)throw Error('Reddit requests are paused. Please try again shortly.');
        let result;try{result=await this.reddit(parameters,controller.signal);}catch(error){
          // A continuation can receive transient HTML without search markup.
          // Retry that cursor once, never treating it as history exhaustion.
          if(parameters.action==='profile' && !controller.signal.aborted && timeoutRetries<1 && /^(Reddit request timed out\. Try again\.|Public posts took too long to load\. Try again\.)$/.test(error.message)){timeoutRetries++;started=Date.now();continue;}
          if(parameters.action==='profile' && parameters.after && !controller.signal.aborted && responseRetries<1 && /^Reddit returned an unrecognized (?:comment|post) search response\.$/.test(error.message)){
            responseRetries++;await new Promise((resolve,reject)=>{const cancel=()=>{clearTimeout(timer);reject(Error('Post request cancelled.'));},timer=setTimeout(()=>{controller.signal.removeEventListener('abort',cancel);resolve();},350);controller.signal.addEventListener('abort',cancel,{once:true});if(controller.signal.aborted)cancel();});continue;
          }throw error;
        }if(!result?.deferred || parameters.action==='render-card')return result;
        const remaining=10000-(Date.now()-started);if(remaining<=0)throw Error('Reddit requests are paused. Please try again shortly.');
        await new Promise((resolve,reject)=>{const cancel=()=>{clearTimeout(timer);reject(Error('Post request cancelled.'));},timer=setTimeout(()=>{controller.signal.removeEventListener('abort',cancel);resolve();},Math.min(remaining,Math.max(100,Number(result.retryAfterMs)||1000)));controller.signal.addEventListener('abort',cancel,{once:true});if(controller.signal.aborted)cancel();});
      }
    }finally{this.controllers.delete(controller);if(identity && this.ownIdentityController===controller)this.ownIdentityController=null;}}
    async run(task){
      if(this.busy)return;this.batchAutoPaused=false;const generation=this.generation;this.busy=true;this.host.setAttribute('aria-busy','true');this.setStatus('Checking public activity…');this.updateProfileLoading();this.discover.disabled=true;if(this.archiveButton)this.archiveButton.disabled=true;this.more.disabled=true;this.updateActivityEmptyState();
      try{await task(()=>generation===this.generation && pageRoute()?.key===this.context?.key && this.host?.isConnected);}
      catch(error){if(generation===this.generation && pageRoute()?.key===this.context?.key){this.sourceErrors.request=error.message;this.setStatus(error.message,true);}}
      finally{if(generation===this.generation){this.busy=false;this.host.removeAttribute('aria-busy');this.more.disabled=false;if(this.feed){this.batchAutoPaused=this.primaryFailure();this.updateProfileLoading();this.updateActivityEmptyState();}else this.loading.hidden=true;this.discover.disabled=this.archiveBusy;if(this.archiveButton)this.archiveButton.disabled=this.archiveBusy;this.ensureActivityArchive();}}
    }
    loadReddit({more=false,retry=false,keys=null,force=false}={}){if(this.isOwnList())return;if(this.isSearch() && !this.clientSearchOn())return;if(this.busy)return this.redditRun;if(force)this.publicBlockedUntil=0;if(!more && !retry){this.initialPrefetchDone=false;this.pages=0;this.recoveryChecked.clear();this.sourceErrors={};this.sourceNotices={};this.clearSourceRetries(key=>!key.startsWith('archive-'));this.refreshStatuses();}if(retry && !keys)this.clearSourceRetries(key=>!key.startsWith('archive-') && !['recovery','replies','verify'].includes(key));if(this.archiveOnly)return this.loadArchive({more});if(this.nativeBatch?.blocked){this.nativeBatch.blocked=false;this.nativeBatch.serverRetryAt=0;this.drainNative(this.nativeBatch);}
      const frontier=this.publicationFloor(),streams=this.kinds().flatMap(kind=>kind==='comment' && !this.isSearch()?[{kind,key:'comment',stream:'authenticated'},{kind,key:'comment-public',stream:'public'}]:[{kind,key:kind}])      .filter(({key})=>{if(key!=='comment-public' || !(this.publicBlockedUntil>Date.now()))return true;this.sourceNotices[key]=publicBlockedNote;this.redMore[key]=false;return false;})
      .filter(({key})=>retry?(keys?keys.includes(key):Boolean(this.sourceErrors[key])):!more || this.redMore[key] && (this.context.sort!=='new' || (this.sourceFrontiers.get(key)?.floor ?? Infinity)>=frontier));
      for(const {key} of streams){if(!more && !retry)this.sourceFrontiers.delete(key);this.sourcePending.add(key);this.sourceStartedAt.set(key,Date.now());}
      if(streams.length)this.scheduleGate(this.sourceWaitMs);
      return this.redditRun=this.run(async current=>{
      const errors=[];let succeeded=false;
      await Promise.all(streams.map(async ({kind,key,stream})=>{
        if(more && !retry && !this.redMore[key])return;
        const old=more || retry?this.afterByKind[key]:null;this.pages++;
        try{const result=await this.request({action:'profile',username:this.context.username,sort:this.effectiveSort(),range:this.isSearch()?'all':this.context.range,kind,...(force?{refresh:true}:{}),...(this.isSearch()?{query:globalThis.RCSCore.toRedditQuery(this.searchReddit.server)}:{}),...(stream?{stream}:{}),...(old?{after:old}:{})});if(!current())return;
          const incoming=new Map(),page=[];for(const raw of result.posts || []){const p=M.normalizeItem(raw,{source:'reddit'});if(!p || p.author.toLowerCase()!==this.context.username.toLowerCase())continue;page.push(p);const id=itemKey(p),previous=this.live.get(id);
            if(stream==='public' && previous && this.commentOrigins.get(id)!=='public'){this.live.set(id,{...previous,over18:previous.over18 || p.over18,spoiler:previous.spoiler || p.spoiler});continue;}
            const merged=previous?{...p,over18:previous.over18 || p.over18,spoiler:previous.spoiler || p.spoiler}:p;this.live.set(id,merged);incoming.set(id,merged);if(kind==='comment')this.commentOrigins.set(id,stream);
          }
          if(!more && !retry && (this.context.sort==='hot' || this.isSearch() && ['hot','relevance'].includes(this.effectiveSort())) && stream!=='public'){
            const belongs=post=>(post.kind==='comment'?'comment':'post')===kind,group=new Map([...incoming,...[...this.live].filter(([id,p])=>belongs(p) && !incoming.has(id))]);
            this.live=new Map(this.kinds().flatMap(type=>type===kind?[...group]:[...this.live].filter(([,p])=>(p.kind==='comment'?'comment':'post')===type)));
          }
          this.afterByKind[key]=result.after;this.redMore[key]=Boolean(result.hasMore && result.after && result.after!==old);this.noteSourcePage(key,page,this.redMore[key]);succeeded=true;this.loaded=true;delete this.sourceErrors[key];this.clearSourceRetries(name=>name===key);this.moreReddit=Object.values(this.redMore).some(Boolean);this.render();
        }catch(error){if(!current())return;this.redMore[key]=false;this.noteSourcePage(key,[],false);
          if(stream==='public' && /\(HTTP 403\)/.test(error.message)){this.publicBlockedUntil=Date.now()+publicBlockMs;this.sourceNotices[key]=publicBlockedNote;return;}
          if(this.scheduleSourceRetry(key,error,'reddit'))return;
          this.sourceErrors[key]=error.message;errors.push((stream==='public'?'Public comments: ':kind==='comment'?'Comments: ':'Posts: ')+error.message);}
        finally{if(current()){this.sourcePending.delete(key);this.sourceStartedAt.delete(key);}}
      }));
      if(!current())return;
      this.after=this.afterByKind.post;this.moreReddit=Object.values(this.redMore).some(Boolean);this.loaded=succeeded || this.loaded;this.render();
      if(errors.length)this.setStatus(errors.join(' '),true);
      this.discover.setAttribute('aria-label','Refresh activity');
    });}
    // Refresh forgets every stored status: a re-approved or restored item must not
    // keep a stale Removed or Deleted cue. Cards re-read their own markup, and
    // archive candidates are verified again where their status matters.
    refreshStatuses(){
      this.postStatuses.clear();
      if(this.activityFilter!=='all' && !this.archiveOnly)this.verifyArchiveStatuses([...this.archived.values()].filter(post=>post.source==='arctic-shift'),{force:true});
    }
    // Archive snapshots are candidates; Reddit's own evidence decides their
    // current status. One queue serves every page. Batches use 25 IDs while the
    // bridge answers them in a single read, and drop to native-fragment pairs
    // (published as each pair finishes) once it reports per-card fallback.
    verifyArchiveStatuses(page,{force=false}={}){
      // Refresh re-checks known items; continuation pages skip them.
      for(const post of page)if((force || !this.postStatuses.has(post.fullname)) && !this.verifyQueued.has(post.fullname)){this.verifyQueued.add(post.fullname);this.verifyQueue.push(post);}
      return this.pumpVerification();
    }
    async pumpVerification(){
      if(this.verifyActive || !this.verifyQueue.length || this.context?.kind!=='profile')return;
      const generation=this.generation,context=this.context,current=()=>generation===this.generation && pageRoute()?.key===context.key && this.host?.isConnected;
      this.verifyActive=true;this.metadataPending++;this.updateProfileLoading();const unresolved=new Set();
      try{
        while(this.verifyQueue.length && current()){
          const kind=this.verifyQueue[0].kind==='comment'?'comment':'post',size=this.statusBatch || profileBatchSize,batch=[];
          while(batch.length<size && this.verifyQueue.length && (this.verifyQueue[0].kind==='comment'?'comment':'post')===kind){const next=this.verifyQueue.shift();this.verifyQueued.delete(next.fullname);batch.push(next);}
          let result;
          try{result=await this.request({action:'status',username:context.username,kind,ids:batch.map(p=>p.id)});}
          catch(error){if(!current())return;
            // A busy Reddit is retried quietly; the batch goes back in the queue.
            if(this.transientFailure(error,'reddit') && this.scheduleSourceRetry('verify',error,'reddit')){this.verifyRetry.push(...batch);continue;}
            unresolved.add(kind);this.sourceErrors['metadata-'+kind]='Some archive items have unverified current Reddit status.';this.summarize();continue;}
          this.clearSourceRetries(name=>name==='verify');
          if(!current())return;
          this.statusBatch=result.via==='info'?profileBatchSize:2;
          const requested=new Map(batch.map(p=>[p.fullname,p])),verified=new Set();
          for(const evidence of result.statuses || []){const post=requested.get(evidence.fullname);if(!post || !['available','deleted','removed'].includes(evidence.status))continue;verified.add(post.fullname);this.postStatuses.set(post.fullname,evidence.status);if(evidence.over18 || evidence.spoiler)this.archived.set(itemKey(post),{...this.archived.get(itemKey(post)),over18:post.over18 || evidence.over18===true,spoiler:post.spoiler || evidence.spoiler===true});}
          if(verified.size<batch.length){unresolved.add(kind);this.sourceErrors['metadata-'+kind]='Some archive items have unverified current Reddit status.';}else if(!unresolved.has(kind))delete this.sourceErrors['metadata-'+kind];
          this.render();
        }
      }finally{if(generation===this.generation){this.verifyActive=false;this.metadataPending--;if(current()){this.updateProfileLoading();this.updateActivityEmptyState();if(this.activityFilter==='deleted' && this.batchedProfile)this.advanceProfileBatch();}}}
    }
    loadArchive(options){
      if(this.isOwnList())return;
      if(!this.settings.archiveDiscovery || this.isSearch() && this.searchParsed.invalid)return;if(this.archiveBusy)return this.archiveRun;
      return this.archiveRun=this.archivePage(options);
    }
    // Archive and Reddit search streams load independently; neither waits for
    // the other's request to finish.
    // Archive pages are chronological, so they merge automatically only into
    // New (and Deleted); Hot/Top keep Reddit's ranking without archive filler.
    refreshActivity({force=false}={}){
      if(this.isOwnList())return this.loadOwnList();
      if(this.isSearch()){if(this.searchParsed.invalid){this.summarize();return;}return Promise.all([this.clientSearchOn()?this.loadReddit({force}):undefined,this.loadArchive()]);}
      const merge=this.settings.archiveDiscovery && !this.archiveOnly && (this.context?.sort==='new' || this.activityFilter==='deleted' || this.oldSort());
      const reddit=this.oldSort()?undefined:this.loadReddit({force}),archive=merge?this.loadArchive():undefined;
      return Promise.all([reddit,archive]);
    }
    async archivePage({more=false,only=null}={}){
      if(!more){this.initialPrefetchDone=false;if(!this.busy)this.pages=0;for(const key of Object.keys(this.sourceErrors))if(key.startsWith('archive-'))delete this.sourceErrors[key];this.clearSourceRetries(key=>key.startsWith('archive-'));}
      const generation=this.generation,current=()=>generation===this.generation && pageRoute()?.key===this.context?.key && this.host?.isConnected;
      const sig=more?(this.archiveSig ??= this.archiveSigNow()):(this.archiveSig=this.archiveSigNow());
      const frontier=this.publicationFloor(),kinds=only?this.kinds().filter(kind=>only.includes(kind)):this.kinds().filter(kind=>!more || this.archiveMore[kind] && (this.context.sort!=='new' || (this.sourceFrontiers.get('archive-'+kind)?.floor ?? Infinity)>=frontier));for(const kind of kinds){if(!more)this.sourceFrontiers.delete('archive-'+kind);this.sourcePending.add('archive-'+kind);this.sourceStartedAt.set('archive-'+kind,Date.now());}if(kinds.length)this.scheduleGate(this.sourceWaitMs);
      this.archiveBusy=true;this.batchAutoPaused=false;this.setStatus('Checking archived activity…');this.updateProfileLoading();this.discover.disabled=true;if(this.archiveButton)this.archiveButton.disabled=true;this.more.disabled=true;this.updateActivityEmptyState();
      try{
        const warnings=[];
        await Promise.all(kinds.map(async kind=>{
          this.pages++;
          try{const result=await this.archiveFetch(kind,more);if(!current())return;
            const page=[];for(const raw of result.posts || []){const p=result.normalized && raw.fullname && raw.source?raw:M.normalizeItem(raw,{source:'arctic-shift'});if(p){this.archived.set(itemKey(p),p);page.push(p);}}
            // The filters changed while this page was loading: keep its items, drop its cursor.
            if(sig!==this.archiveSig){this.render();return;}
            this.noteSearched(result);
            this.beforeByKind[kind]=result.before;this.archiveMore[kind]=Boolean(result.hasMore && !result.cursorStalled);this.archiveLoaded=true;this.moreArchive=Object.values(this.archiveMore).some(Boolean);this.noteSourcePage('archive-'+kind,page,this.archiveMore[kind]);
            delete this.sourceErrors['archive-'+kind];this.clearSourceRetries(key=>key==='archive-'+kind);this.render();
            // All activity renders these cards, and rendering proves their status, so a
            // separate check would fetch each card twice. Hidden/Deleted need status first.
            if(page.length && !this.archiveOnly && this.activityFilter!=='all')this.verifyArchiveStatuses(page,{force:!more});
            if(result.cursorStalled){this.sourceErrors['archive-'+kind]='Archive pagination stopped at an ambiguous timestamp. History is incomplete.';warnings.push(this.sourceErrors['archive-'+kind]);}
          }catch(error){if(!current())return;this.archiveMore[kind]=false;this.noteSourcePage('archive-'+kind,[],false);if(this.scheduleSourceRetry('archive-'+kind,error,'archive'))return;this.sourceErrors['archive-'+kind]=error.message;warnings.push(error.message);}
          finally{if(current()){this.sourcePending.delete('archive-'+kind);this.sourceStartedAt.delete('archive-'+kind);}}
        }));
        if(!current())return;
        this.moreArchive=Object.values(this.archiveMore).some(Boolean);this.render();if(warnings.length)this.setStatus(warnings.join(' '),true);
      }finally{if(generation===this.generation){this.archiveBusy=false;this.discover.disabled=this.busy;if(this.archiveButton)this.archiveButton.disabled=this.busy;this.more.disabled=this.busy;if(this.feed){this.batchAutoPaused=this.primaryFailure();this.updateProfileLoading();this.updateActivityEmptyState();}else this.loading.hidden=true;}}
    }
    // Transient failures (rate limits, timeouts, gateway errors) wait and retry
    // the same cursor with backoff, showing a quiet note instead of an error.
    // After retryLimit attempts the failure is reported normally.
    transientFailure(error,provider){
      if(provider==='archive')return ['rate-limited','timeout','network-error','http-error','busy','maintenance','unavailable'].includes(error?.code);
      return /rate limit|asked us to wait|requests are paused|timed out|took too long|\(HTTP (?:5\d\d|403|429)\)|Failed to fetch/i.test(error?.message || '');
    }
    scheduleSourceRetry(key,error,provider){
      if(!this.transientFailure(error,provider))return false;
      const previous=this.sourceRetries.get(key),attempts=(previous?.attempts || 0)+1;if(attempts>retryLimit){this.sourceRetries.delete(key);return false;}
      const limited=provider==='archive'?error.code==='rate-limited':/rate limit|asked us to wait|requests are paused/i.test(error.message),now=Date.now();
      // A service that reports itself down gets minutes, not seconds.
      const down=provider==='archive' && ['maintenance','unavailable'].includes(error.code);
      let delay=(down?60:limited?15:4)*this.retryUnitMs*2**(attempts-1);if(Number.isFinite(error.retryAt) && error.retryAt>now)delay=Math.max(delay,error.retryAt-now+500);delay=Math.min(delay,300000);
      const name=provider==='archive'?'Arctic Shift':'Reddit search',wait=delay<60000?Math.ceil(delay/1000)+' seconds':'about '+Math.max(1,Math.round(delay/60000))+' min';
      const note=down?(error.code==='maintenance'?`${name} is down for maintenance. Retrying in ${wait}.`:`${name} is temporarily unavailable. Retrying in ${wait}.`):limited?`${name} is limiting requests. Retrying in ${wait}.`:`${name} isn’t responding. Retrying in ${wait}.`;
      clearTimeout(previous?.timer);const generation=this.generation,entry={attempts,at:now+delay,note,provider,visible:down || limited || attempts>quietRetries};
      entry.timer=setTimeout(()=>{entry.timer=null;if(generation!==this.generation || !this.host?.isConnected)return;this.retrySource(key);},delay);
      this.sourceRetries.set(key,entry);this.updateProfileLoading();return true;
    }
    async retrySource(key){
      const entry=this.sourceRetries.get(key);if(!entry)return;clearTimeout(entry.timer);entry.timer=null;
      // Work that is not a paged source: the entry stays until the retry succeeds.
      if(key==='recovery'){this.scheduleRecovery();return;}
      if(key==='replies')return this.retryReplyEnrichment();
      if(key==='verify'){const again=this.verifyRetry;this.verifyRetry=[];return this.verifyArchiveStatuses(again,{force:true});}
      if(key.startsWith('archive-')){if(this.archiveBusy)await this.archiveRun;if(!this.settings.archiveDiscovery)return;this.archiveMore[key.slice(8)]=true;this.archiveRun=this.archivePage({more:true,only:[key.slice(8)]});return this.archiveRun;}
      if(this.busy)await this.redditRun;return this.loadReddit({retry:true,keys:[key]});
    }
    clearSourceRetries(match=()=>true){for(const [key,entry] of this.sourceRetries || [])if(match(key)){clearTimeout(entry.timer);this.sourceRetries.delete(key);}}
    waitingRetries(){return [...this.sourceRetries?.values() || []].filter(entry=>entry.timer);}
    hasMoreProfile(){if(this.oldSort())return this.moreArchive;return this.activityFilter==='deleted' && this.settings.archiveDiscovery?this.moreArchive:this.moreReddit || this.moreArchive;}
    // Advance every provider that has a stream at the shared frontier (the
    // shallowest pending boundary). A busy provider never blocks the other.
    loadMore(){
      if(this.isSearch()){
        if(this.searchParsed.invalid)return;
        const reddit=this.moreReddit && this.clientSearchOn() && !this.busy,archive=this.moreArchive && !this.archiveBusy;
        if(!reddit && !archive)return;
        return Promise.all([reddit?this.loadReddit({more:true}):undefined,archive?this.loadArchive({more:true}):undefined]);
      }
      if(this.batchedProfile)this.forceProfileBatch=true;
      if(this.oldSort()){if(!this.moreArchive || this.archiveBusy)return;return this.loadArchive({more:true});}
      if(this.activityFilter==='deleted' && this.settings.archiveDiscovery){
        // Keep at most one archive page of unchecked Deleted candidates ahead.
        if(!this.moreArchive || this.archiveBusy || this.verifyQueue.length>=profileBatchSize)return;
        return this.loadArchive({more:true});
      }
      const floor=this.publicationFloor(),ordered=this.context.sort==='new';
      const atFrontier=(key,more)=>Boolean(more) && (!ordered || (this.sourceFrontiers.get(key)?.floor ?? Infinity)>=floor);
      const archive=this.moreArchive && this.kinds().some(kind=>atFrontier('archive-'+kind,this.archiveMore[kind]));
      const reddit=this.moreReddit && Object.keys(this.redMore).some(key=>atFrontier(key,this.redMore[key]));
      const tasks=[];
      if(archive && !this.archiveBusy)tasks.push(this.loadArchive({more:true}));
      if(reddit && !this.busy)tasks.push(this.loadReddit({more:true}));
      if(!tasks.length && !archive && !reddit && !this.busy && !this.archiveBusy){
        // No comparable boundary (e.g. a source without one yet): keep the
        // previous preference so continuation can still make progress.
        if(this.moreReddit)tasks.push(this.loadReddit({more:true}));else if(this.moreArchive)tasks.push(this.loadArchive({more:true}));
      }
      return tasks.length?Promise.all(tasks):undefined;
    }
    captureFeedViewport(){
      // A parked (detached) feed must never scroll the page that replaced it.
      if(!this.feed?.isConnected || window.scrollY<=0)return null;
      // Near the feed end the reader is looking at the last card above the
      // loader, so keep that card fixed; elsewhere keep the top visible card.
      const children=elementChildren(this.feed),tail=this.loading?.parentElement===this.feed && !this.loading.hidden?this.loading.getBoundingClientRect():null,atTail=Boolean(tail && tail.top<innerHeight && tail.bottom>0);
      for(const node of atTail?children.reverse():children){if(node.hidden || node===this.loading)continue;const rect=node.getBoundingClientRect();if(rect.height>0 && rect.bottom>56 && rect.top<innerHeight)return {node,top:rect.top,scrollY:window.scrollY};}
      return null;
    }
    withFeedViewport(change){
      if(!this.feed || this.feedViewportUpdate)return change();
      const feed=this.feed,anchor=this.captureFeedViewport();if(!anchor)return change();
      const properties=['min-height','overflow-anchor'],styles=properties.map(name=>[name,feed.style.getPropertyValue(name),feed.style.getPropertyPriority(name)]),height=feed.getBoundingClientRect().height;
      const restore=name=>{const [,value,priority]=styles.find(style=>style[0]===name);if(value)feed.style.setProperty(name,value,priority);else feed.style.removeProperty(name);};
      this.feedViewportUpdate=true;
      // Reconciliation may hide a native tail before inserting its ready peers.
      // Keep the document tall until the whole synchronous update is finished;
      // otherwise bottom clamping changes scrollY between these operations.
      feed.style.setProperty('min-height',height+'px','important');
      feed.style.setProperty('overflow-anchor','none','important');
      try{return change();}
      finally{restore('min-height');try{if(this.feed===feed)this.restoreFeedViewport(anchor,true);}finally{restore('overflow-anchor');this.feedViewportUpdate=false;}}
    }
    restoreFeedViewport(anchor,layoutUpdate=false){
      if(!anchor || anchor.node.parentElement!==this.feed || anchor.node.hidden || anchor.node.hasAttribute('data-rt-order-pending') || !layoutUpdate && window.scrollY!==anchor.scrollY)return;
      const rect=anchor.node.getBoundingClientRect();if(rect.height<=0)return;const delta=rect.top-anchor.top;
      if(Math.abs(delta)>1)window.scrollBy({top:delta,behavior:'instant'});
    }
    render({reuseCards=false}={}){
      if(this.isOwnList()){this.renderOwnList();return;}
      return this.withFeedViewport(()=>{
      this.renderVersion=(this.renderVersion || 0)+1;
      const posts=this.oldSort()?M.mergePosts([],[...this.archived.values()],{username:this.context.username,visibleIds:[],sort:'new'}).reverse():M.mergePosts(this.isSearch() && !this.clientSearchOn()?[]:[...this.live.values()],[...this.archived.values()],{username:this.context.username,visibleIds:this.visibleIds(),sort:this.effectiveSort(),range:this.isSearch()?'all':this.context.range});
      for(const post of posts){const key=itemKey(post);this.postMetadata.set(key,post);if(post.subredditIcon)globalThis.RTCommunityIcons?.prime?.(post.subreddit,post.subredditIcon);const previous=this.nodes.get(key);if(previous){if(!reuseCards && previous.dataset.rtArchiveFallback==='true')this.renderArchivedNative(post,previous);if(previous.dataset.rtNativeState==='ready')this.decorateNative(post,previous);continue;}const node=this.card(post);this.results.append(node);this.nodes.set(key,node);}
      this.renderedPosts=posts;
      this.deduplicate();this.more.hidden=!this.hasMoreProfile();
      this.summarize();this.updateProfileLoading();this.updateActivityEmptyState();if(this.activeProfileBatch)this.settleProfileBatch();if(this.batchedProfile)this.advanceProfileBatch(this.forceProfileBatch===true);this.forceProfileBatch=false;
      });
    }
    pendingProfilePosts(){
      const visible=this.visibleIds(),floor=this.publicationFloor();return this.renderedPosts.filter(post=>{const node=this.nodes.get(itemKey(post));return node && this.eligibleProfilePost(post,node) && this.canPublishProfilePost(post,floor) && (!this.publishedCards.has(itemKey(post)) || !['ready','failed'].includes(node.getAttribute('data-rt-native-state'))) && !visible.has(post.fullname) && node.getAttribute('data-deferred')!=='older';});
    }
    // The observer can miss a change (e.g. a filter collapsing the feed in an
    // unfocused window); a measurable loader on screen counts as visible too.
    profileTailVisible(){const rect=this.loading.getBoundingClientRect();return (this.batchInView || rect.height>0 && !this.loading.hidden) && rect.top<=innerHeight*3 && rect.bottom>=0;}
    // Published cards actually on screen. Cards hidden by the current filter
    // (or as duplicates) must not count toward filling the first batch.
    shownPublished(){let count=0;for(const key of this.publishedCards)if(this.nodes.get(key)?.hidden===false)count++;return count;}
    primaryFailure(){const archiveOnlyView=this.activityFilter==='deleted' && this.settings.archiveDiscovery;return Object.entries(this.sourceErrors || {}).some(([key,value])=>value && !/^(metadata-|recovery$)/.test(key) && !(archiveOnlyView && !key.startsWith('archive-')) && !(['post','comment','comment-public'].includes(key) && Object.values(this.redMore).some(Boolean)));}
    prefetchProfilePage(){
      if(pageRoute()?.key!==this.context?.key || this.busy && this.archiveBusy || this.batchAutoPaused || this.primaryFailure() || this.nativeBatch.blocked || !this.batchObserver || !this.hasMoreProfile())return;
      const initial=this.autoDiscover && (this.loaded || this.archiveLoaded) && !this.initialPrefetchDone;
      if(!initial && !this.profileTailVisible())return;
      // Prime one additional cursor page on initial automatic discovery. Later
      // reads start two viewports ahead even between hydration batches. Keep
      // one bounded unpublished buffer, including native-horizon deferrals.
      const visible=this.visibleIds(),buffered=this.renderedPosts.filter(post=>!this.publishedCards.has(itemKey(post)) && !visible.has(post.fullname)).length;
      if(buffered<profileBatchSize && this.loadMore() && initial)this.initialPrefetchDone=true;
    }
    continueProfile(force=false){
      // A native continuation halo can remain mounted before its request starts.
      // It owns the visible loader, but must not block preparing our next page.
      // One provider's request in flight never blocks the other provider.
      if(this.busy && this.archiveBusy)return;
      if(this.batchedProfile){this.prefetchProfilePage();return this.advanceProfileBatch(force);}
      if(this.hasMoreProfile() && !this.batchAutoPaused)this.loadMore();
    }
    updateProfileLoading(){
      // The loader follows the page kind (search skeleton or profile halo) once the route is known.
      if(this.loading && this.context && !this.isOwnList()){const halo=this.loading.querySelector('.rt-native-loading'),want=this.isSearch()?'search':'feed';if(halo && (halo.dataset.rtLoader || 'feed')!==want){const next=this.feedLoader();next.hidden=halo.hidden;halo.replaceWith(next);}}
      if(this.isOwnList()){const hidden=!this.listState?.loading && !this.listState?.hiddenHistory;if(this.loading && this.loading.hidden!==hidden)this.loading.hidden=hidden;return;}
      if(!this.feed || !this.loading)return;
      const pending=this.batchedProfile && this.pendingProfilePosts().length>0,more=this.hasMoreProfile();
      const paused=this.nativeBatch.blocked || (this.batchAutoPaused || this.primaryFailure()) && !pending && !this.activeProfileBatch;
      const work=this.busy || this.archiveBusy || this.activeProfileBatch || this.nativeBatch.active || this.nativeBatch.queue.length || this.metadataPending || this.recoveryActive;
      // Quick retries stay behind the normal loader; only long waits or repeated failures get a note.
      const retrying=this.waitingRetries().filter(entry=>entry.visible!==false),continuation=Boolean(work || pending || more || this.mergePendingNodes.size || this.waitingRetries().length);
      const nativeLoading=this.nativeFeedLoading(),owner=nativeLoading?'native':'extension',halo=this.loading.querySelector('.rt-native-loading'),quiet=nativeLoading || (paused || retrying.length>0) && !work;
      const archiveView=this.activityFilter==='deleted' && this.settings.archiveDiscovery,failedArchive=this.kinds().filter(kind=>this.sourceErrors['archive-'+kind]),failedSearch=!archiveView && ['post','comment','comment-public'].some(key=>this.sourceErrors[key]);
      let message='',action=null,label='';
      if(paused && !work){
        if(archiveView && failedArchive.length){message='Some archived items couldn’t be loaded. Existing results are kept.';label='Retry loading';action=()=>{for(const kind of failedArchive)delete this.sourceErrors['archive-'+kind];this.batchAutoPaused=false;this.archiveMore=Object.fromEntries(Object.entries(this.archiveMore).concat(failedArchive.map(kind=>[kind,true])));return this.archiveBusy?undefined:(this.archiveRun=this.archivePage({more:true,only:failedArchive}));};}
        else if(failedSearch){message='Some search results couldn’t be loaded. Existing results are kept.';label='Retry loading';action=()=>this.loadReddit({retry:true});}
        else{message='Loading paused.';label='Retry loading';action=()=>this.discover.click();}
      }else if(retrying.length && !work){const soonest=new Map();for(const entry of retrying)if(!soonest.has(entry.provider) || entry.at<soonest.get(entry.provider).at)soonest.set(entry.provider,entry);message=[...soonest.values()].map(entry=>entry.note).join(' ');label='Retry now';action=()=>{this.archiveForceUntil=Date.now()+5000;for(const [key,entry] of this.sourceRetries)if(entry.timer)this.retrySource(key);};}
      // The button always runs the latest action.
      this.noteAction=action;
      // Most calls change nothing; only a real change pays for the viewport
      // transaction (which reads layout to keep the reading position).
      const note=this.loading.querySelector('[data-rt-continuation-note]');
      const dirty=this.loading.parentElement!==this.feed || this.loading!==this.feed.lastElementChild || this.loading.hidden===continuation || this.feed.dataset.rtLoadingOwner!==owner || Boolean(halo) && halo.hidden!==quiet || Boolean(message)!==Boolean(note) || Boolean(note) && note.dataset.message!==message;
      if(dirty)this.withFeedViewport(()=>{
        if(this.loading.parentElement!==this.feed || this.loading!==this.feed.lastElementChild)this.feed.append(this.loading);
        if(this.loading.hidden===continuation)this.loading.hidden=!continuation;
        if(this.feed.dataset.rtLoadingOwner!==owner)this.feed.dataset.rtLoadingOwner=owner;
        if(halo && halo.hidden!==quiet)halo.hidden=quiet;
        let current=this.loading.querySelector('[data-rt-continuation-note]');
        if(message){
          if(!current){current=make('div','rt-feed-note');current.dataset.rtContinuationNote='true';current.setAttribute('role','status');this.loading.append(current);}
          if(current.dataset.message!==message){current.dataset.message=message;const retry=button(label,()=>this.noteAction?.());retry.className=label==='Retry now'?'button button-small button-plain':'button button-small button-bordered';current.replaceChildren(make('span','rt-feed-note-text',message),retry);}
        }else current?.remove();
      });
      this.more.hidden=!continuation || Boolean(this.batchObserver && (!paused || this.isSearch()));this.more.disabled=Boolean(this.busy || this.archiveBusy || this.activeProfileBatch && !paused);
      if(pending && !this.activeProfileBatch && !paused && this.shownPublished()<profileBatchSize){this.advanceProfileBatch();return;}
      this.prefetchProfilePage();
      if(!this.activeProfileBatch && !(this.busy && this.archiveBusy) && !paused && this.batchObserver && !this.loading.hidden && !this.batchFrame){const generation=this.generation;this.batchFrame=requestAnimationFrame(()=>{this.batchFrame=null;if(generation===this.generation && this.host?.isConnected && this.profileTailVisible())this.continueProfile();});}
      this.updateActivityEmptyState();
    }
    advanceProfileBatch(force=false){
      if(!this.batchedProfile || pageRoute()?.key!==this.context?.key)return;
      if(force){this.batchAutoPaused=false;if(this.nativeBatch.blocked){this.nativeBatch.blocked=false;this.nativeBatch.serverRetryAt=0;this.drainNative(this.nativeBatch);}}
      if(this.activeProfileBatch || this.nativeBatch.blocked || this.batchAutoPaused && !this.pendingProfilePosts().length)return;
      if(!force && this.shownPublished()>=profileBatchSize && (!this.batchObserver || !this.profileTailVisible()))return;
      const posts=this.pendingProfilePosts().slice(0,profileBatchSize);
      if(!posts.length){const visible=this.visibleIds(),floor=this.publicationFloor(),waitingBoundary=this.renderedPosts.some(p=>!visible.has(p.fullname) && !this.publishedCards.has(itemKey(p)) && this.nodes.get(itemKey(p))?.dataset.deferred!=='older' && this.eligibleProfilePost(p,this.nodes.get(itemKey(p))) && !this.canPublishProfilePost(p,floor));if(!waitingBoundary && !this.mergePendingNodes.size && this.renderedPosts.some(p=>this.nodes.get(itemKey(p))?.dataset.deferred==='older'))return;if(this.hasMoreProfile() && (force || this.batchObserver && this.profileTailVisible()))this.loadMore();return;}
      const group=this.activeProfileBatch={generation:this.generation,nodes:posts.map(p=>this.nodes.get(itemKey(p))),posts,enriching:false};this.loading.hidden=false;
      for(const node of group.nodes)if(!['ready','failed'].includes(node.dataset.rtNativeState))this.queueNative(node);
      this.settleProfileBatch();
    }
    settleProfileBatch(){
      const group=this.activeProfileBatch;if(!group || group.enriching || group.generation!==this.generation || pageRoute()?.key!==this.context?.key)return;
      const visible=this.visibleIds(),floor=this.publicationFloor();let ready=0;
      while(ready<group.nodes.length && this.canPublishProfilePost(this.postMetadata.get(group.nodes[ready].dataset.key),floor) && (['ready','failed'].includes(group.nodes[ready].dataset.rtNativeState) || visible.has(group.nodes[ready].dataset.fullname)))ready++;
      if(!ready)return;
      // Publish only the ready prefix. A slow later card cannot hold earlier
      // content behind a whole-page barrier or reorder the feed on completion.
      // Native cards already on screen before this publish; only insertions above
      // one of them are animated.
      const shown=new Set(this.nativeEntries().filter(e=>!e.node.hidden && !e.node.hasAttribute('data-rt-order-pending') && !e.node.hasAttribute('data-rt-filter-hidden')).map(e=>e.node));
      const entering=group.nodes.splice(0,ready);for(const node of entering)this.publishedCards.add(node.dataset.key);
      if(!group.nodes.length){group.enriching=true;this.activeProfileBatch=null;const current=()=>group.generation===this.generation && pageRoute()?.key===this.context?.key && this.host?.isConnected;this.replyEnrichment=Promise.resolve(this.replyEnrichment).catch(()=>{}).then(()=>current()?this.enrichReplyContexts(group.posts,current):undefined);}
      this.deduplicate();this.animateEntrance(entering,shown);this.updateProfileLoading();
    }
    // Animate only cards that land between cards Reddit had already shown;
    // cards at the feed end or alongside a new native page just appear.
    animateEntrance(nodes,shown){
      const entering=new Set(nodes);
      for(const node of nodes){const slot=this.feedSlot(node);if(slot!==node || node.hidden || node.parentElement!==this.feed)continue;
        let next=node.nextElementSibling;while(next && (entering.has(next) || next.hidden || next.hasAttribute('data-rt-order-pending') || next.hasAttribute('data-rt-filter-hidden')))next=next.nextElementSibling;
        if(!next || !shown.has(next))continue;
        node.classList.add('rt-native-enter','rt-native-inserted');clearTimeout(node.rtEnterTimer);node.rtEnterTimer=setTimeout(()=>node.classList.remove('rt-native-enter','rt-native-inserted'),1500);
      }
    }
    // Reddit separates feed cards with one native rule after each card. Post
    // fragments bring theirs; comment fragments and our own fallbacks do not,
    // so add exactly one with Reddit's classes when the card has none.
    ensureCardRule(node){
      if(!node?.matches?.('.rt-native-card'))return;
      const own=node.querySelector(':scope > hr[data-rt-card-rule]'),native=[...node.querySelectorAll('hr')].some(rule=>rule!==own && !rule.closest('shreddit-post,shreddit-profile-comment'));
      if(native){own?.remove();return;}
      if(!own){const rule=make('hr','border-0 border-b-sm border-solid border-b-neutral-border-weak');rule.dataset.rtCardRule='true';node.append(rule);}
      else if(own!==node.lastElementChild)node.append(own);
    }
    // One compact state pill with its evidence as the tooltip (spec §3, U1/U2).
    // A removal is one red ban icon, like the status icons of profile search; its wording is in the tooltip (spec §27).
    removalPill(removal){
      const pill=make('span','rt-removal-pill rt-post-indicator');pill.dataset.rtRemoval=removal.state;pill.dataset.rtConfidence=removal.confidence;pill.dataset.state=removal.state==='deleted'?'deleted':'removed';
      const label=removal.label+(removal.flags?.includes('deleted-later')?', then deleted by you':removal.flags?.includes('gone')?', no longer on your profile':'')+(removal.confidence==='likely' && removal.state!=='removed-unknown'?' (likely)':''),why=[removal.why,removal.flags.includes('locked')?'Locked: no new replies.':'',removal.flags.includes('approved-after-auto')?'Approved after an automatic removal.':''].filter(Boolean).join(' ');
      pill.dataset.rtLabel=label;pill.setAttribute('role','img');pill.setAttribute('aria-label',label+(why?'. '+why:''));pill.title=label+(why?'\n'+why:'');pill.tabIndex=0;
      pill.append(glyph(removal.state==='deleted'?'deleted':'removed'));return pill;
    }
    indicator(post){
      const removed=['deleted','removed'].includes(post.status),label=removed?`${post.status==='deleted'?'Deleted':'Removed'} on Reddit`:post.source==='arctic-shift'?(post.status==='available'?(this.isSearch()?'Not shown in Reddit’s loaded search results · Available on Reddit · Arctic Shift snapshot':'Not shown in this profile feed · Available on Reddit · Arctic Shift snapshot'):'Arctic Shift snapshot · Current Reddit status unknown'):'Not shown in this profile feed · Found through public Reddit search';
      const badge=make('span','rt-post-indicator');badge.setAttribute('role','img');badge.setAttribute('aria-label',label);badge.title=label;badge.dataset.state=post.status;// One icon per real state: trash (deleted), ban (removed by moderators),
      // eye-slash (available but hidden from the profile). Archive-only items
      // with unconfirmed status are not on Reddit's profile; they get the archive icon,
      // since nothing shows they were deleted.
      badge.append(glyph(removed?post.status:post.source==='arctic-shift' && post.status!=='available'?'archive':'hidden'));return badge;
    }
    // Archive text for this exact item and author, never a placeholder.
    snapshotText(post){
      const archive=this.archived.get(itemKey(post)),own=archive?.source==='arctic-shift' && archive.fullname===post.fullname && archive.author?.toLowerCase()===this.context?.username?.toLowerCase();
      const text=post.archivedBody || (post.source==='arctic-shift'?post.body:'') || (own?archive.body:'');
      return text && !['[deleted]','[removed]'].includes(text)?text:'';
    }
    snapshot(text){const details=make('details','rt-post-snapshot');details.title='Text recovered from Arctic Shift · May differ from the current post';details.open=this.settings.restoreDeletedContent===true;details.append(make('summary','','Recovered text'),make('pre','',text));return details;}
    // The page is searched once per community. A miss is kept while the page's links
    // and images are unchanged (and for at most half a minute).
    communityAvatarUrl(subreddit){
      const name=subreddit.toLowerCase(),cached=avatarHints.get(name),shape=document.links.length+':'+document.images.length;if(cached && (cached.url || cached.shape===shape && Date.now()-cached.at<30000))return cached.url;
      const href='/r/'+name+'/',sample=[...document.querySelectorAll('shreddit-post[subreddit-name]')].find(n=>n.getAttribute('subreddit-name')?.toLowerCase()===name),hint=sample?.querySelector('[slot="credit-bar"] [avatar] img[src]') || [...document.querySelectorAll('a[href]')].find(a=>{try{return new URL(a.getAttribute('href'),location.origin).pathname.toLowerCase()===href && a.querySelector('img[src]');}catch{return false;}})?.querySelector('img[src]'),url=M.avatarUrl(hint?.getAttribute('src')) || '';
      if(avatarHints.size>=300)avatarHints.delete(avatarHints.keys().next().value);avatarHints.set(name,{url,shape,at:Date.now()});return url;
    }
    communityAvatar(subreddit){
      const avatar=make('span','inline-flex items-center justify-center w-lg h-lg relative shrink-0');avatar.setAttribute('avatar','');
      const url=this.communityAvatarUrl(subreddit);
      const show=src=>{const image=make('img','mb-0 rounded-full overflow-hidden w-full h-full');image.src=src;image.alt='';image.width=image.height=24;image.loading='lazy';avatar.replaceChildren(image);};
      if(url){show(url);return avatar;}
      // Not on this page yet: ask the shared icon lookup, as search rows do, and swap the placeholder when it answers.
      Promise.resolve(globalThis.RTCommunityIcons?.get?.(subreddit)).then(src=>{if(src && M.avatarUrl(src))show(src);},()=>{});
      const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');for(const [key,value] of Object.entries({rpl:'',fill:'currentColor',height:'24',width:'24',viewBox:'0 0 20 20','icon-name':'community-fill','aria-hidden':'true'}))icon.setAttribute(key,value);
      const path=document.createElementNS(icon.namespaceURI,'path');path.setAttribute('d','M11.977 13.79h-1.955l4.549-10.715a.81.81 0 00-.381-1.032C12.447 1.12 10.37.747 8.179 1.18c-3.612.716-6.471 3.68-7.059 7.316a9.01 9.01 0 0010.409 10.377c3.735-.616 6.741-3.635 7.347-7.371.453-2.8-.388-5.405-2.017-7.322a.505.505 0 00-.853.119l-4.029 9.49ZM9.98 8.118a1.752 1.752 0 00-1.148.167 1.664 1.664 0 00-.651.596 1.703 1.703 0 00-.258.948v3.96H5.998V6.322h1.876v1.074h.035c.251-.344.567-.628.948-.851a2.55 2.55 0 011.311-.335c.172 0 .335.014.488.042.153.028.267.058.342.09l-.774 1.849a.766.766 0 00-.244-.073Z');icon.append(path);avatar.append(icon);return avatar;
    }
    renderArchivedNative(post,node){
      // Reddit may no longer serve a fragment for this identity. Reuse its own
      // card components, layout classes and action row with historical values.
      // Archive strings are always text, never server HTML or executable markup.
      const archived=this.archived.get(itemKey(post)),owned=archived?.author?.toLowerCase()===this.context?.username?.toLowerCase() && archived.fullname===post.fullname,media=post.archivedMedia || (post.media?.length?post.media:owned?archived.media:[]) || [];
      const signature=JSON.stringify([post.fullname,post.title,post.archivedBody || post.body,post.archivedBodyHtml || post.bodyHtml,media,post.over18,post.spoiler,post.score,post.comments,post.title,post.parentId,post.archiveAuthor || post.author]);
      this.archiveRenderSignatures ||= new WeakMap();const existing=node.querySelector('shreddit-post,shreddit-profile-comment');if(existing && this.archiveRenderSignatures.get(node)===signature)return existing;this.archiveRenderSignatures.set(node,signature);
      // Retire only this card's previous media bookkeeping before a data change.
      for(const figure of this.recoveredMedia || [])if(node.contains(figure))this.recoveredMedia.delete(figure);
      node.replaceChildren();node.dataset.rtArchiveFallback='true';node.dataset.rtNativeState='ready';node.removeAttribute('aria-busy');
      const listSnapshot=this.isOwnList(),isComment=post.kind==='comment',native=make(isComment?'shreddit-profile-comment':'shreddit-post');
      const restrictedText=(post.over18 || post.spoiler) && Boolean(post.archivedBody || post.body) && !deletionNotice((post.archivedBody || post.body).trim()),snapshotText=!post.over18 && !post.spoiler && Boolean(post.archivedBody || post.body) && !deletionNotice((post.archivedBody || post.body).trim()),body=snapshotText || restrictedText?(post.archivedBody || post.body):(listSnapshot?'Open this item on Reddit to view its content.':'The archive has no original text for this item.');
      const date=make('faceplate-timeago');date.setAttribute('ts',new Date(post.created*1000).toISOString());date.setAttribute('short','');
      const archiveAuthor=()=>M.validateUsername(post.author)?link('u/'+post.author,'/user/'+encodeURIComponent(post.author)+'/','font-semibold text-12 text-neutral-content-strong no-underline hover:underline'):make('span','text-12 text-neutral-content-weak',post.author || '[deleted]');
      const profileName=/^u_([\w-]{1,20})$/i.exec(post.subreddit)?.[1],community=link(profileName?'u/'+profileName:'r/'+post.subreddit,profileName?'/user/'+profileName+'/':'/r/'+encodeURIComponent(post.subreddit)+'/'+(this.context.kind==='archive'?'?rt_view=archive':''),'font-semibold text-12 text-neutral-content-strong no-underline hover:underline');
      community.classList.add('inline-flex','items-center','gap-xs');community.prepend(profileName?this.profilePostAvatar(profileName):this.communityAvatar(post.subreddit));
      native.setAttribute('data-feed-element-id',post.fullname);
      if(!isComment && this.context.kind==='archive'){this.renderSubredditArchivePost(post,native,{date,media,body,snapshotText,thread:post.rtThread===true});node.append(native);return native;}
      if(isComment){
        native.className='w-full nd:visible rounded-4 my-2xs';native.setAttribute('comment-id',post.fullname);native.setAttribute('href',post.permalink);
        const inner=make('div','hover:bg-neutral-background-hover relative rounded-4'),padding=make('div','px-md py-sm'),credit=make('div','text-12 relative w-fit'),context=make('div','flex items-center');
        // Reddit's own header: the community name stays on one line and the post title wraps in the remaining width
        // (a shrinking name broke one letter per line on phones).
        const heading=make('h2','m-0 min-w-0');heading.append(link(post.title || 'View post',post.permalink,'text-neutral-content-strong font-normal hover:underline'));
        community.classList.add('whitespace-nowrap','shrink-0');context.append(community,make('span','px-2xs shrink-0',' • '),heading);const identity=make('div','text-neutral-content-weak inline-block ms-xl mt-2xs');const info=make('span');info.id='poster-info-'+post.fullname;info.dataset.rtReplyInfo='true';if(this.context.kind==='archive'){info.append(archiveAuthor(),document.createTextNode(' commented'));}identity.append(info,document.createTextNode(' '),date);credit.append(context,identity);
        const content=make('div','ms-[22px] mt-2xs ps-[10px] md'),text=make('div','md pt-xs pb-2xs break-words');text.append(snapshotText?this.archivedText(body,post.archivedBodyHtml || post.bodyHtml,media):restrictedText?sensitive(this.archivedText(body,post.archivedBodyHtml || post.bodyHtml),post.over18?'View NSFW content':'View spoiler',{media:false}):make('p','',body));content.append(text);
        const actions=make('div','block ms-lg relative'),row=make('shreddit-comment-action-row','block');row.setAttribute('comment-id',post.fullname);row.setAttribute('score',String(post.score));row.setAttribute('permalink',post.permalink);row.setAttribute('telemetry-source','profile');row.setAttribute('vote-state','NONE');row.setAttribute('is-desktop-viewport','true');row.setAttribute('inert','');row.setAttribute('aria-disabled','true');row.title=listSnapshot?'List snapshot · Open the item for current actions':'Archived values · Current actions unavailable';
        const reply=link('',post.permalink,'button rpl-cab border-sm text-label-2 button-plain-weak inline-flex items-center px-sm py-xs');reply.slot='comment-reply';reply.style.height='var(--size-button-sm-h)';const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');for(const [key,value] of Object.entries({rpl:'','aria-hidden':'true','fill':'currentColor',height:'16',width:'16',viewBox:'0 0 20 20','icon-name':'comment'}))icon.setAttribute(key,value);const path=document.createElementNS(icon.namespaceURI,'path');path.setAttribute('d','M10 1a9 9 0 00-9 9c0 1.947.79 3.58 1.935 4.957L.231 17.661A.784.784 0 00.785 19H10a9 9 0 009-9 9 9 0 00-9-9Zm0 16.2H6.162c-.994.004-1.907.053-3.045.144l-.076-.188a36.981 36.981 0 002.328-2.087l-1.05-1.263C3.297 12.576 2.8 11.331 2.8 10c0-3.97 3.23-7.2 7.2-7.2s7.2 3.23 7.2 7.2-3.23 7.2-7.2 7.2Z');icon.append(path);const leading=make('span','flex text-body-1 me-2xs');leading.append(icon);reply.append(leading,make('span','rpl-cab--content','Reply'));
        const share=make('shreddit-comment-share-button');share.setAttribute('slot','comment-share');share.setAttribute('permalink',post.permalink);share.setAttribute('is-desktop-viewport','true');row.append(reply,share);actions.append(row);padding.append(credit,content,actions);inner.append(padding);native.append(inner);
      }else{
        native.className='block relative cursor-pointer group bg-neutral-background focus-within:bg-neutral-background-hover hover:bg-neutral-background-hover xs:rounded-4 px-md py-2xs my-2xs nd:visible';native.id=post.fullname;
        for(const [key,value] of Object.entries({'permalink':post.permalink,'view-context':'ProfileFeed2','view-type':'cardView','post-type':listSnapshot?post.postType:'text','post-title':post.title,'author':post.author,'subreddit-name':post.subreddit,'subreddit-prefixed-name':profileName?'u_'+profileName:'r/'+post.subreddit,'score':post.score,'comment-count':post.comments,'created-timestamp':new Date(post.created*1000).toISOString()}))native.setAttribute(key,String(value));
        if(post.author==='[deleted]')native.setAttribute('is-author-deleted','');const credit=make('span','flex justify-between text-12 min-h-[32px] mb-2xs -mt-2xs');credit.slot='credit-bar';const identity=make('span','flex items-center gap-xs');identity.append(community,document.createTextNode(' · '),date);if(this.context.kind==='archive'){identity.classList.add('flex-wrap');identity.append(document.createTextNode(' · '),archiveAuthor());}credit.append(identity);
        const title=link(post.title,post.permalink,'block text-neutral-content-strong m-0 visited:text-neutral-content-weak font-semibold text-16-scalable xs:text-18-scalable mb-2xs xs:mb-xs overflow-hidden');title.slot='title';const content=make('div','md break-words');content.slot='text-body';const rawText=(post.archivedBody || post.body || '').trim(),linkUrl=post.isSelf===true || !post.url || /^https:\/\/(?:www\.|old\.|new\.)?reddit\.com\/(?:r\/[^/]+\/)?comments\//i.test(post.url)?'':post.url;if(snapshotText)content.append(this.archivedText(body,post.archivedBodyHtml || post.bodyHtml));else if(restrictedText)content.append(sensitive(this.archivedText(body,post.archivedBodyHtml || post.bodyHtml),post.over18?'View NSFW content':'View spoiler',{media:false}));else if(!media.length && linkUrl){// Link posts show their destination, as Reddit's own cards do, not a missing-text note.
let host='';try{host=new URL(linkUrl).hostname.replace(/^www\./,'');}catch{}const out=link(post.domain || host || linkUrl,linkUrl,'rt-archive-link text-12 hover:underline');out.target='_blank';out.rel='noopener noreferrer';content.append(out);}else if(!media.length && (listSnapshot || rawText && deletionNotice(rawText)))content.append(make('p','',body));
        if(media.length && !post.over18 && !post.spoiler){const grid=make('div','grid grid-cols-[1fr_min-content] grid-rows-[auto_auto_auto] gap-x-2xs'),header=make('div','col-start-1 col-end-3 row-start-1 row-end-2'),copy=make('div','col-start-1 col-end-2 row-start-2 row-end-3 overflow-hidden'),preview=make('div','col-start-2 col-end-3 row-start-2 row-end-3');header.append(credit);copy.append(title,content);grid.append(header,copy,preview);native.setAttribute('post-type','link');native.append(grid);this.recoverImage({...post,media},native);}else native.append(credit,title,content);
        // Keep the card inert until the native action bar is isolated. This
        // avoids even a frame of actionable voting on unverified snapshots.
        native.setAttribute('inert','');const disable=()=>{const bar=native.shadowRoot?.querySelector('rpl-action-bar');if(!bar)return false;bar.setAttribute('inert','');bar.setAttribute('aria-disabled','true');bar.title=listSnapshot?'List snapshot · Open the item for current actions':'Archived values · Current actions unavailable';native.removeAttribute('inert');return true;};
        if(this.context.kind==='archive')native.removeAttribute('inert');else if(!listSnapshot && !disable())requestAnimationFrame(()=>{if(!disable())requestAnimationFrame(disable);});
      }
      node.append(native);return native;
    }
    // Subreddit archive posts follow Reddit's own subreddit feed card (and post page when thread):
    // author avatar + name + time on the left, status and overflow on the right, title, flair,
    // then media by real post type. Read-only: no action may mutate a snapshot.
    renderSubredditArchivePost(post,native,{date,media,body,snapshotText,thread=false}){
      const type=post.postType || 'text',visual=['image','gif','gallery','video'].includes(type),linkish=['link','embed','crosspost'].includes(type);
      let host='';try{host=post.url?new URL(post.url).hostname.replace(/^www\./,''):'';}catch{}
      const linkUrl=linkish && post.url && !/^https:\/\/(?:www\.|old\.|new\.)?reddit\.com\/(?:r\/[^/]+\/)?comments\//i.test(post.url)?post.url:'';
      native.className=thread?'block relative xs:mt-xs xs:-mx-xs xs:px-xs xs:rounded-[16px] pt-xs nd:visible':'block relative cursor-pointer group bg-neutral-background focus-within:bg-neutral-background-hover hover:bg-neutral-background-hover xs:rounded-4 px-md py-2xs my-2xs nd:visible';native.id=post.fullname;
      for(const [key,value] of Object.entries({'permalink':post.permalink,'view-context':thread?'CommentsPage':'SubredditFeed','view-type':'cardView','post-type':type,'post-title':post.title,'author':post.author,'subreddit-name':post.subreddit,'subreddit-prefixed-name':'r/'+post.subreddit,'score':post.score,'comment-count':post.comments,'created-timestamp':new Date(post.created*1000).toISOString(),'domain':host || 'self.'+post.subreddit}))native.setAttribute(key,String(value));
      if(post.author==='[deleted]')native.setAttribute('is-author-deleted','');
      const validAuthor=M.validateUsername(post.author),authorLink=(cls)=>{if(!validAuthor)return make('span','text-12 text-neutral-content-weak',post.author || '[deleted]');const a=link('u/'+post.author,'/user/'+encodeURIComponent(post.author)+'/',cls);a.setAttribute('aria-label','Author: u/'+post.author);return a;};
      const credit=make('span',thread?'flex justify-between text-12 relative pb-2xs pt-md':'flex justify-between text-12 min-h-[32px] mb-2xs -mt-2xs');credit.slot='credit-bar';
      const left=make('span','flex flex-wrap text-12 gap-2xs items-center min-w-0 relative'),right=make('span','flex items-center gap-xs');right.dataset.rtCreditRight='true';
      if(thread){
        const back=make('button','button button-plain icon inline-flex items-center justify-center rounded-full w-xl h-xl shrink-0 rt-sra-back');back.type='button';back.setAttribute('aria-label','Back');back.title='Back';back.append(redditIcon('back',16));
        back.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();if(history.length>1 && document.referrer.startsWith(location.origin))history.back();else location.assign('/r/'+encodeURIComponent(post.subreddit)+'/?rt_view=archive');});
        const community=link('r/'+post.subreddit,'/r/'+encodeURIComponent(post.subreddit)+'/?rt_view=archive','font-bold text-12 text-neutral-content-strong no-underline hover:underline');
        const lines=make('div','flex gap-0 flex-col truncate'),top=make('span','flex items-center gap-2xs');top.append(community,make('span','text-neutral-content-weak','•'),date);
        lines.append(top,authorLink('text-12 text-neutral-content no-underline hover:underline'));
        // The banned community has no icon worth showing; use the poster's picture (real one swapped in by the archive).
        const avatar=make('span','inline-flex items-center justify-center w-xl h-xl relative shrink-0 rt-archive-avatar rt-archive-avatar-lg');avatar.append(defaultAvatar(post.author,32));left.classList.add('gap-xs');left.append(back,avatar,lines);
      }else{
        const author=make('span','flex');author.slot='authorName';const inner=make('span','inline-flex items-center gap-2xs max-w-full rt-archive-author'),name=authorLink('flex items-center text-neutral-content font-bold no-underline hover:underline'),frame=make('span','inline-flex items-center justify-center w-lg h-lg relative shrink-0 rt-archive-avatar');frame.append(defaultAvatar(post.author,24));inner.append(frame,name);author.append(inner);
        left.append(author,make('span','inline-block my-0 text-neutral-content-weak','•'),date);
      }
      const more=make('button','button button-plain icon inline-flex items-center justify-center rounded-full w-xl h-xl rt-archive-overflow');more.type='button';more.disabled=true;more.setAttribute('aria-label','Archived post · Actions unavailable');more.title='Archived post · Actions unavailable';more.append(redditIcon('overflow',16));right.append(more);
      credit.append(left,right);
      const title=thread?make('h1','font-semibold text-neutral-content-strong m-0 text-18 xs:text-24 mb-xs overflow-hidden rt-sra-thread-title',post.title):link(post.title,post.permalink,'block text-neutral-content-strong m-0 visited:text-neutral-content-weak font-semibold text-16-scalable xs:text-18-scalable mb-2xs xs:mb-xs overflow-hidden');title.slot='title';
      // Reddit's content tags (NSFW, Spoiler) sit in a row above the title; the flair pill sits below it.
      native.append(credit);
      if(post.over18 || post.spoiler){const head=make('div','flex justify-between gap-xs rt-archive-content-header');head.slot='ssr-post-content-header';const wrap=make('div','inline-flex items-center'),tags=make('div','flex content-tags flex-wrap gap-xs whitespace-nowrap rt-archive-tags');
        const tag=(cls,label,icon)=>{const outer=make('span','h-lg inline-block'),inner=make('span','inline-flex items-center whitespace-nowrap gap-[var(--spacer-4xs)] rounded-full text-caption-1 rt-archive-tag '+cls);if(icon){const i=make('span','inline-flex shrink-0 leading-none');i.setAttribute('aria-hidden','true');i.append(redditIcon(icon,12));inner.append(i);}inner.append(make('span','text-caption-1',label));outer.append(inner);return outer;};
        if(post.over18)tags.append(tag('text-tags-nsfw-content rt-archive-tag-nsfw','NSFW','nsfw'));if(post.spoiler)tags.append(tag('rt-archive-tag-spoiler','Spoiler'));wrap.append(tags);head.append(wrap);native.append(head);}
      native.append(title);
      if(post.flair){const flair=make('span','rt-archive-flair');flair.slot='post-flair';const pill=make('span','bg-tone-4 inline-block truncate max-w-full text-12 font-normal align-text-bottom box-border px-[6px] rounded-5 leading-4 text-secondary relative -top-2xs xs:top-[-2px] my-2xs xs:mb-sm py-0 rt-archive-flair-pill'),text=make('div','flair-content max-w-full overflow-hidden whitespace-nowrap text-ellipsis',post.flair);text.setAttribute('aria-label','Flair: '+post.flair);text.dir='auto';pill.append(text);flair.append(pill);native.append(flair);}
      const content=make('div','md break-words');content.slot='text-body';
      const rawBody=(post.archivedBody || post.body || '').trim(),sensitiveText=(post.over18 || post.spoiler) && rawBody && !deletionNotice(rawBody);
      // Images pasted into a text post (preview.redd.it links) show inline, as Reddit renders them.
      const inlineMedia=!visual && !linkish && Array.isArray(post.bodyMedia) && post.bodyMedia.length && rawBody?post.bodyMedia:null;
      if(inlineMedia){content.append(this.archivedText(rawBody,'',inlineMedia));for(const figure of content.querySelectorAll('.rt-comment-media')){figure.classList.add('rt-archive-inline-media');if(post.over18 || post.spoiler)figure.replaceWith(sensitive(figure.cloneNode(true),post.over18?'View NSFW content':'View spoiler'));}}
      else if(snapshotText || sensitiveText)content.append(this.archivedText(rawBody || body,post.archivedBodyHtml || post.bodyHtml));else if(!linkUrl && !visual && (thread || /^\[(?:deleted|removed)\]$/i.test((post.body || '').trim())))content.append(make('p','text-neutral-content-weak',body));
      if(linkUrl){const out=link(post.domain || host || linkUrl,linkUrl,'rt-archive-link block text-12 text-neutral-content-weak hover:underline truncate mt-2xs');out.target='_blank';out.rel='noopener noreferrer nofollow ugc';content.append(out);}
      // Spoiler text is blurred until revealed.
      if(content.childNodes.length)native.append(post.spoiler && sensitiveText && !inlineMedia?sensitive(content,'View spoiler',{media:false}):content);
      // Media by type: images/galleries/videos full width; link previews as the right-hand thumbnail; text posts never borrow a link preview.
      const usable=visual?media:linkish?media:type==='textmedia'?media.filter(item=>item.kind==='image'):[];
      if(usable.length){let view=globalThis.RTArchiveView?.media(usable,{alt:post.title,compact:linkish,postId:post.id,href:linkish?linkUrl || post.permalink:post.url || post.permalink});if(view){if(post.over18 || post.spoiler)view=sensitive(view,post.over18?'View NSFW content':'View spoiler');view.slot=linkish?'thumbnail':'post-media-container';native.append(view);(this.recoveredMedia ||= new Set()).add(view);}}
      // A video or GIF post whose media the archive doesn't have says so, rather than showing nothing.
      else if(['video','gif'].includes(type) && globalThis.RTArchiveView?.videoUnavailable){const note=globalThis.RTArchiveView.videoUnavailable('',{});note.slot='post-media-container';native.append(note);}
      // Content scripts can't see Reddit's custom-element registry, so decide from the DOM: once the post has
      // rendered Reddit's own action bar (it has an open shadow root), our read-only row steps aside.
      if(thread && !native.shadowRoot?.querySelector('rpl-action-bar'))native.append(this.archiveActionRow(post,native));
      this.disableArchiveVotes(native);
    }
    // Read-only action row for archived posts when Reddit's post component isn't loaded on the page.
    archiveActionRow(post,native){
      const row=make('div','flex items-center gap-sm mt-xs rt-sra-action-row');row.dataset.rtUi='archive-action-row';
      const votes=make('span','rt-sra-pill rt-sra-vote-pill');votes.title='Archived score · Voting is unavailable';
      const vote=(name,label)=>{const b=make('button','rt-sra-vote');b.type='button';b.disabled=true;b.setAttribute('aria-label',label+' (unavailable on archived posts)');b.append(redditIcon(name,16));return b;};
      votes.append(vote('upvote','Upvote'),make('span','rt-sra-pill-count',post.factsUnknown?'':compactCount(post.score)),vote('downvote','Downvote'));
      const comments=make('span','rt-sra-pill');comments.title='Comment count when archived';comments.append(redditIcon('comment',16),make('span','rt-sra-pill-count',post.factsUnknown?'':compactCount(post.comments)));
      const share=make('button','rt-sra-pill rt-sra-share');share.type='button';share.append(redditIcon('share',16),make('span','','Share'));
      share.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();const url=new URL(post.permalink,location.origin).href;navigator.clipboard?.writeText(url).then(()=>{share.lastChild.textContent='Link copied';setTimeout(()=>{share.lastChild.textContent='Share';},2000);},()=>{});});
      row.append(votes,comments,share);
      // If Reddit's own post component upgrades this post later, its action bar takes over.
      let checks=0;const yield_=()=>{if(!row.isConnected && checks>0)return;if(native?.shadowRoot?.querySelector('rpl-action-bar')){row.remove();return;}if(++checks<120)setTimeout(yield_,250);};setTimeout(yield_,0);
      return row;
    }
    // Reddit renders vote buttons inside the post's shadow root once it upgrades; mark them unavailable.
    disableArchiveVotes(native){
      let tries=0;const apply=()=>{const buttons=native.shadowRoot?[...native.shadowRoot.querySelectorAll('.rpl-vote-button-group button,button[upvote],button[downvote]')]:[];
        for(const b of buttons){b.disabled=true;b.setAttribute('aria-disabled','true');b.title='Voting is unavailable on archived posts';b.style.cursor='not-allowed';b.style.opacity='0.5';}
        if(!buttons.length && native.isConnected!==false && ++tries<40)requestAnimationFrame(apply);};
      if(typeof requestAnimationFrame==='function')requestAnimationFrame(apply);
    }
    // Search pages show results as Reddit's own search rows (copied from its profile search page):
    // community · time, title, votes · comments and a thumbnail for posts; the post title, a grey comment
    // box and Go To Thread for comments. Every source (Reddit search, archive, own lists) uses the same row.
    searchUnit(post){
      const wrap=make('div','rt-search-unit');wrap.dataset.rtSearchUnit=post.kind==='comment'?'comment':'post';
      // Plain text: Reddit's faceplate-number would add its own copy of the number.
      const count=(n,one,many)=>make('span','',new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1}).format(Number(n) || 0)+' '+(Number(n)===1?one:many));
      const dot=()=>make('span','mx-2xs','·');
      const time=(ts,format)=>{const t=make('faceplate-timeago');t.setAttribute('ts',new Date(ts*1000).toISOString());if(format)t.setAttribute('format',format);else t.setAttribute('short','');this.timeFallback(t,ts);return t;};
      const profileName=/^u_([\w-]{1,20})$/i.exec(post.subreddit || '')?.[1],communityHref=profileName?'/user/'+profileName+'/':'/r/'+encodeURIComponent(post.subreddit)+'/',communityLabel=profileName?'u/'+profileName:'r/'+post.subreddit;
      const icon=()=>{
        const outer=make('span','inline-flex items-center justify-center w-lg h-lg relative me-xs');outer.setAttribute('avatar','');
        const inner=make('span','inline-block rounded-full relative h-full w-full overflow-hidden');outer.append(inner);
        if(profileName){inner.append(this.profilePostAvatar(profileName));return outer;}
        const url=post.subredditIcon || this.communityAvatarUrl(post.subreddit || '');
        const show=src=>{const img=make('img','mb-0 w-full h-full rounded-full');if(post.subredditColor && src===post.subredditIcon)img.style.background=post.subredditColor;img.src=src;img.alt='';img.width=24;img.loading='lazy';img.decoding='async';img.referrerPolicy='no-referrer';inner.replaceChildren(img);};
        if(url)show(url);else{inner.append(this.communityAvatar(post.subreddit || ''));globalThis.RTCommunityIcons?.get?.(post.subreddit)?.then?.(src=>{if(src && M.avatarUrl(src))show(src);},()=>{});}
        return outer;
      };
      const tags=()=>{const out=[];
        if(post.over18){const tag=make('span','rt-search-tag inline-flex items-center gap-2xs font-semibold');tag.style.color='var(--color-tags-nsfw-content,#b2007f)';tag.append(redditIcon('nsfw',12),document.createTextNode('NSFW'));out.push(dot(),tag);}
        if(post.spoiler){const tag=make('span','rt-search-tag font-semibold','Spoiler');out.push(dot(),tag);}
        if(post.removal && post.removal.state!=='visible'){out.push(dot(),this.removalPill(post.removal));}
        // Archive results and Reddit status say where a result came from, as small cues after the time.
        if(post.source==='arctic-shift' || ['deleted','removed'].includes(post.status)){const cue=this.indicator(post);cue.classList.add('ms-xs');cue.dataset.rtRowSource=post.status || 'unknown';out.push(cue);}
        return out;};
      const thumbUrl=post.kind==='comment'?'':(post.media || []).map(item=>item.kind==='video'?item.poster:item.url).find(Boolean) || M.mediaUrl(post.thumbnail || '');
      if(post.kind!=='comment'){
        const row=make('div','flex justify-between items-center hover:bg-neutral-background-hover xs:rounded-4 relative p-md my-2xs');row.dataset.testid='search-post-unit';
        const h2=make('h2','m-0'),cover=link('',post.permalink,'absolute inset-0');cover.dataset.testid='post-title';cover.setAttribute('aria-label',post.title || 'Post');h2.append(cover);
        const body=make('div','w-full flex flex-col items-start min-w-0'+(thumbUrl?' pe-md overflow-hidden':''));body.dataset.testid='sdui-post-unit';
        const credit=make('div','post-credit-row flex items-center mb-xs relative overflow-hidden whitespace-nowrap w-auto max-w-full'),meta=make('span','flex items-center text-neutral-content-weak text-12 overflow-hidden');
        const community=link('',communityHref+(this.context?.kind==='archive' && !profileName?'?rt_view=archive':''),'flex items-center text-neutral-content-weak font-semibold relative');const shrink=make('span','flex shrink-0 items-center');shrink.append(icon());community.append(shrink,make('span','truncate',communityLabel));
        meta.append(community,dot(),time(post.created,'narrow'),...tags());const creditWrap=make('div');credit.append(meta);creditWrap.append(credit);
        const title=link(post.title || '[untitled]',post.permalink,'xs:text-18 text-neutral-content-strong no-underline hover:no-underline visited:text-neutral-content-weak text-ellipsis mb-xs line-clamp-3 font-semibold text-16 relative');title.dataset.testid='post-title-text';
        const counter=make('div','text-neutral-content-weak text-12');counter.dataset.testid='search-counter-row';counter.append(count(post.score,'vote','votes'),dot(),count(post.comments,'comment','comments'));
        body.append(creditWrap,title);if(!post.factsUnknown)body.append(counter);row.append(h2,body);
        if(thumbUrl){const a=link('',post.permalink,'relative');a.setAttribute('aria-label',(post.title || 'Post')+' thumbnail image');const box=make('div','relative inline-block'),clip=make('div','rounded-2 overflow-hidden'),img=make('img','block rounded-2 object-cover h-[60px] w-[80px] xs:h-[90px] xs:w-[120px]');img.src=thumbUrl;img.alt=post.title || '';img.loading='lazy';img.decoding='async';img.referrerPolicy='no-referrer';img.dataset.testid='search_post_thumbnail';if(post.over18 || post.spoiler)img.style.filter='blur(12px)';clip.append(img);box.append(clip);a.append(box);row.append(a);}
        wrap.append(row);
      }else{
        const postHref=post.permalink.replace(/\/comment\/[a-z0-9]+\/?$|\/[a-z0-9]+\/?$/i,'/');
        const row=make('div','flex justify-between items-center p-md hover:bg-neutral-background-hover xs:rounded-4 my-2xs relative');row.dataset.testid='search-sdui-comment-unit';
        const cover=link('',postHref,'absolute inset-0');cover.setAttribute('aria-label',post.title || 'Post');
        const col=make('div','w-full flex justify-center flex-col items-start');
        const head=make('div','text-neutral-content-weak text-12 flex items-center mb-xs relative'),community=link('',communityHref,'flex items-center text-neutral-content-weak font-semibold hover:underline');community.append(icon(),document.createTextNode(communityLabel));head.append(community,...tags());
        const title=make('h2','m-0 text-16 line-clamp-3 text-ellipsis text-neutral-content font-semibold mb-xs',post.title || '');
        const box=make('div','bg-neutral-background-weak rounded-4 relative w-100 group mb-xs');box.dataset.testid='search-comment-content';box.style.width='100%';
        const pad=make('div','p-md relative'),who=make('div','text-neutral-content-weak text-12 flex items-center relative');
        const valid=M.validateUsername(post.author),author=valid?link('','/user/'+encodeURIComponent(post.author)+'/','text-neutral-content-strong text-12 hover:underline flex items-center relative group-hover:z-1'):make('span','text-neutral-content-strong text-12 flex items-center relative');
        const avatar=make('span','inline-flex items-center justify-center w-lg h-lg relative me-xs');avatar.setAttribute('avatar','');// The profile's own comments use its picture (or the snoo-back when the account is gone); others get Reddit's default.
        // Reddit's u/ pill in the header search carries the profile's headshot, as Reddit's own rows use.
        const self=valid && post.author.toLowerCase()===String(this.context?.username || '').toLowerCase(),own=self && !this.accountState?M.avatarUrl(document.querySelector('reddit-search-large')?.shadowRoot?.querySelector('#search-input-remove-filter image,#search-input-chip image')?.getAttribute('href') || ''):'';
        if(own){const img=make('img','rounded-full w-full h-full object-cover');img.style.background='var(--color-avatar-gradient)';img.src=own;img.alt='';avatar.append(img);}else avatar.append(defaultAvatar(valid && !(self && this.accountState)?post.author:'[deleted]',24));
        author.append(avatar,document.createTextNode(post.author || '[deleted]'));who.append(author,dot(),time(post.created,'narrow'));
        const commentLink=link('',post.permalink,'absolute inset-0');commentLink.setAttribute('aria-label','Comment by '+(post.author || '[deleted]'));
        const text=(post.archivedBody || post.body || '').trim(),content=make('div','relative max-h-[260px] overflow-hidden text-ellipsis text-neutral-content-strong [--emote-size:20px] text-14');
        // Plain text: clicks go through to the comment link underneath (the text block otherwise stacks above it).
        content.style.pointerEvents='none';
        for(const para of (text || '[deleted]').split(/\n{2,}/).slice(0,8))content.append(make('p','my-xs',para.replace(/\s+/g,' ').trim()));
        const shown=post.over18 || post.spoiler?sensitive(content,post.over18?'View NSFW content':'View spoiler',{media:false}):content;
        const fade=make('div','h-[21px] mt-[-21px] bg-gradient-to-t isolate pointer-events-none relative');fade.style.backgroundImage='linear-gradient(to top,var(--color-neutral-background-weak),transparent)';fade.dataset.rtCommentFade='true';fade.hidden=true;
        const votes=make('p','text-neutral-content-weak text-12 m-0 relative');votes.append(count(post.score,'vote','votes'));
        pad.append(who,commentLink,shown,fade,...(post.factsUnknown?[]:[votes]));box.append(pad);requestAnimationFrame?.(()=>clipFade(content,fade));
        const thread=link('Go To Thread',postHref,'text-12 font-semibold no-underline text-primary-plain mb-xs relative hover:underline');
        col.append(head,title,box,thread);
        if(Number.isFinite(post.postScore) && Number.isFinite(post.postComments)){const counter=make('div','text-neutral-content-weak text-12');counter.dataset.testid='search-counter-row';counter.append(count(post.postScore,'vote','votes'),dot(),count(post.postComments,'comment','comments'));col.append(counter);}
        row.append(cover,col);wrap.append(row);
      }
      wrap.append(make('hr','list-divider-line border-0 border-b-sm border-solid border-b-neutral-border-weak xs:mx-md'));return wrap;
    }
    // Reddit's full card stays the proof behind a row (kept hidden): an archive result's current status on Reddit,
    // and for Reddit's own results a post-type filter, the Media tab or a structured query Reddit can't run.
    needsTypeProof(post){if(!post || this.isOwnList())return false;if(post.source==='arctic-shift')return true;return post.kind!=='comment' && (this.rtFilters?.types?.length>0 || this.context?.type==='media') || Boolean(this.searchReddit?.residual);}
    showSearchUnit(post,node){
      const proof=node.querySelector(':scope > .rt-type-proof') || null,native=node.querySelector('shreddit-post,shreddit-profile-comment');
      let holder=proof;if(native && !proof){holder=make('div','rt-type-proof');holder.hidden=true;holder.append(native);}
      const card=holder?.querySelector('shreddit-post,shreddit-profile-comment'),status=card?this.verifiedStatus(post,card):this.postStatuses?.get(post.fullname);node.replaceChildren(this.searchUnit(status?{...post,status}:post),...(holder?[holder]:[]));node.dataset.rtNativeState='ready';node.dataset.rtSearchRow='true';node.removeAttribute('aria-busy');
    }
    card(post){
      const card=make('div','rt-native-card');card.id='rt-native-'+crypto.randomUUID();card.dataset.rtUi='activity-item';card.dataset.postId=post.id;card.dataset.fullname=post.fullname;card.dataset.rtNativeFullname=post.fullname;card.dataset.rtNativeState='idle';card.dataset.key=itemKey(post);card.hidden=post.visible;
      card.setAttribute('aria-busy','true');
      card.append(this.placeholder());return card;
    }
    // Reddit's search-result skeleton (its next-page placeholder, copied from the live page): a title line, a body
    // block with a thumbnail, three meta pills and the list divider.
    searchSkeleton(){
      const article=make('div','rt-search-skeleton');article.setAttribute('role','article');article.setAttribute('aria-hidden','true');
      const shim=cls=>make('div','shimmer-placeholder bg-shimmer rounded-2 '+cls),body=make('div','flex flex-col p-md');
      const top=make('div','flex items-center mb-xs');top.append(shim('h-[21px] w-[112px] me-2xs'),shim('h-[21px] w-[90px]'));
      const mid=make('div','flex items-center justify-between mb-xs');mid.append(shim('h-[60px] xs:h-[90px] flex-1 me-md'),shim('h-[60px] w-[80px] xs:h-[90px] xs:w-[120px]'));
      const meta=make('div','flex items-center');meta.append(shim('h-md w-[70px] me-2xs'),shim('h-md w-[70px] me-2xs'),shim('h-md w-[70px] me-2xs'));
      body.append(top,mid,meta);article.append(body,make('hr','list-divider-line border-0 border-b-sm border-solid border-b-neutral-border-weak xs:mx-md'));return article;
    }
    placeholder(){
      if(this.isSearch?.())return this.searchSkeleton();
      // Cards use quiet native shimmer rows. The animated Snoo belongs to the
      // feed, never repeated for every pending item.
      const placeholder=make('div','rt-native-placeholder');placeholder.setAttribute('aria-hidden','true');
      const avatar=make('faceplate-shimmer','h-lg w-lg rounded-full shrink-0'),lines=make('div','grow');avatar.setAttribute('shape','circle');lines.append(make('faceplate-shimmer','block rounded-2 h-md w-[200px] max-w-full'),make('faceplate-shimmer','block rounded-2 h-xs w-[160px] max-w-full mt-2xs'));placeholder.append(avatar,lines);return placeholder;
    }
    feedLoader(){
      // Search pages load like Reddit's search: three result skeletons, not the profile feed's halo.
      if(this.context && this.isSearch()){const loader=make('div','rt-native-loading rt-search-loading');loader.dataset.rtLoader='search';loader.append(this.searchSkeleton(),this.searchSkeleton(),this.searchSkeleton());return loader;}
      const loader=make('shreddit-feed-page-loading','rt-native-loading');loader.setAttribute('page-type',this.context?.view==='comments'?'profile_comments':this.context?.view==='posts'?'profile_posts':'profile_overview');return loader;
    }
    observeNativeLoading(){
      const feed=this.feed;if(!feed)return;
      // The native feed/continuation can render a linear progress track as
      // well as its Snoo halo. Keep only the halo; never style card/media roots.
      const loaders=this.shellQuery('shreddit-feed-page-loading',{deep:true}),own=this.loading?.querySelector('shreddit-feed-page-loading');
      for(const root of [feed.shadowRoot,...(own?[...loaders,own]:loaders).map(node=>node.shadowRoot)].filter(Boolean)){
        if([...this.nativeLoadingStyles].some(style=>style.parentNode===root))continue;
        const style=make('style');style.dataset.rtUi='loading-style';style.textContent='faceplate-progress,progress{display:none!important}';root.append(style);this.nativeLoadingStyles.add(style);
      }
      const roots=[feed,feed.shadowRoot,...loaders.map(n=>n.shadowRoot)].filter(Boolean);if(this.nativeLoadingRoot?.feed===feed && roots.length===this.nativeLoadingRoot.roots.length && roots.every((root,i)=>root===this.nativeLoadingRoot.roots[i]))return;
      this.nativeLoadingObserver?.disconnect();this.nativeLoadingRoot={feed,roots};
      this.nativeLoadingObserver=new MutationObserver(records=>{
        // Viewport preservation writes and restores these inline feed styles.
        // Observing our own transaction would enqueue another transaction in
        // every mutation microtask and starve rendering/input indefinitely.
        if(this.loading && records.some(r=>!(r.type==='attributes' && r.attributeName==='style' && r.target===feed) && !this.ownsMutation(r)))this.updateProfileLoading();
      });
      for(const root of roots)this.nativeLoadingObserver.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','class','style']});
    }
    nativeFeedLoading(){
      const visible=node=>{
        if(this.loading?.contains(node) || this.feed?.hasAttribute('data-rt-merge-waiting') || node.closest('[data-rt-ui="activity-item"],[data-rt-filter-hidden],[data-rt-order-pending]'))return false;
        if(node.matches('shreddit-feed-page-loading') && node.shadowRoot && !node.shadowRoot.querySelector('shreddit-loading'))return false;
        // Computed style once for the loader itself; its ancestors are checked by
        // attribute, class and inline style, which is what hides them in practice.
        const style=getComputedStyle(node);if(style.display==='none' || style.visibility==='hidden')return false;
        for(let parent=node;parent;parent=parent.parentElement || parent.getRootNode()?.host)if(parent.hidden || parent.classList?.contains('hidden') || parent.style?.display==='none' || parent.style?.visibility==='hidden')return false;
        return true;
      };
      if(!this.feed)return false;
      return [...this.feed.shadowRoot?.querySelectorAll('shreddit-loading') || [],...this.shellQuery('shreddit-feed-page-loading,shreddit-loading',{deep:true})].some(visible);
    }
    profilePostAvatar(username){
      const avatar=make('span','inline-flex items-center justify-center w-lg h-lg relative shrink-0');avatar.setAttribute('avatar','');
      // Only profile-hosted posts use account artwork. Never modify Reddit's
      // server-rendered author/community markup or borrow another user's photo.
      const same=username.toLowerCase()===this.context.username.toLowerCase(),url=same?M.avatarUrl(this.avatarSlot?.querySelector('img')?.getAttribute('src') || document.querySelector('#profile-icon')?.getAttribute('src')):'';
      const image=make('img','mb-0 rounded-full object-contain w-full h-full');if(same && this.accountState){avatar.append(defaultAvatar('[deleted]',24));return avatar;}
      image.src=url || 'https://www.redditstatic.com/avatars/defaults/v2/avatar_default_0.png';image.alt='';image.width=image.height=24;image.loading='lazy';avatar.append(image);return avatar;
    }
    queueNative(node){
      if(node.hidden && !this.activeProfileBatch?.nodes.includes(node) && node.dataset.rtQualify!=='true' || !node.isConnected || node.dataset.rtNativeState!=='idle')return;
      node.dataset.rtNativeState='queued';const batch=this.nativeBatch;batch.queue.push(node);
      // Collect the whole visibility notification before choosing the first card.
      if(!batch.scheduled){batch.scheduled=true;queueMicrotask(()=>{batch.scheduled=false;this.drainNative(batch);});}
    }
    drainNative(batch){
      if(batch!==this.nativeBatch || batch.blocked || pageRoute()?.key!==this.context?.key)return;
      if(batch.resumeAt>Date.now()){clearTimeout(this.nativeResumeTimer);this.nativeResumeTimer=setTimeout(()=>this.drainNative(batch),batch.resumeAt-Date.now());return;}
      // Comments use four bounded slots; heavier posts keep two. Publish the
      // ready prefix so parallel completions never reorder the visible feed.
      const order=new Map((this.activeProfileBatch?.nodes || []).map((node,index)=>[node,index]));
      batch.queue.sort((a,b)=>{const priority=(order.get(a) ?? Infinity)-(order.get(b) ?? Infinity);if(priority)return priority;const position=a.compareDocumentPosition(b);return position&4?-1:position&2?1:0;});
      while(batch.queue.length){
        // Removed draws three at once at most, leaving one of the page bridge's four request slots for its profile walk.
        const next=this.postMetadata.get(batch.queue[0].dataset.key),limit=this.batchedProfile?(next?.kind==='comment'?4:2):this.context?.section?(next?.kind==='comment'?3:2):1;if(batch.active>=limit)break;
        const node=batch.queue.shift(),post=this.postMetadata.get(node.dataset.key),generation=this.generation;
        if(!post || node.hidden && !this.activeProfileBatch?.nodes.includes(node) && node.dataset.rtQualify!=='true' || !node.isConnected){node.dataset.rtNativeState='idle';continue;}
        if(this.nativeObserver && !this.context?.section && !this.activeProfileBatch?.nodes.includes(node) && node.dataset.rtQualify!=='true'){const rect=node.getBoundingClientRect();if(rect.top>innerHeight+400 || rect.bottom< -400){node.dataset.rtNativeState='idle';this.nativeObserver.observe(node);continue;}}
        if(this.isSearch() && !this.needsTypeProof(post)){this.showSearchUnit(post,node);continue;}
        batch.active++;node.dataset.rtNativeState='loading';
        const operation=this.nativeRenderer?this.nativeRenderer(post,node):this.request({action:'render-card',username:this.context.username,kind:post.kind==='comment'?'comment':'post',postId:post.id,target:node.id});
        Promise.resolve(operation).then(result=>{
          if(generation!==this.generation || pageRoute()?.key!==this.context?.key)return;
          if(!node.isConnected && (this.feedSlot(node)===node || !node.querySelector('shreddit-post,shreddit-profile-comment'))){if(this.feedSlot(node)!==node)node.dataset.rtNativeState='idle';return;}
          if(result?.deferred){
            node.dataset.rtNativeState='queued';batch.queue.push(node);const now=Date.now(),retryAt=now+Math.max(100,Math.min(3600000,Number(result.retryAfterMs)||1000));batch.resumeAt=Math.max(batch.resumeAt||0,retryAt);
            if(result.reason==='rate-limit'){
              if(batch.serverRetryAt && now>=batch.serverRetryAt){batch.blocked=true;this.setStatus('Reddit is limiting card requests. Select Refresh activity to retry.',true);this.updateProfileLoading();}
              else batch.serverRetryAt=retryAt;
            }
            return;
          }
          if(result?.duplicate){node.dataset.rtNativeState='idle';node.replaceChildren();node.removeAttribute('aria-busy');this.deduplicate();return;}
          if(['available','deleted','removed'].includes(result?.status) && result.fullname===post.fullname)this.postStatuses.set(post.fullname,result.status);
          node.dataset.rtNativeState='ready';this.nativeRetries.delete(node);delete node.dataset.rtQualify;node.removeAttribute('aria-busy');this.decorateNative(this.postMetadata.get(node.dataset.key) || post,node);if(this.isSearch())this.showSearchUnit(this.postMetadata.get(node.dataset.key) || post,node);
        },error=>{
          if(generation!==this.generation || pageRoute()?.key!==this.context?.key)return;
          if(!node.isConnected){if(this.feedSlot(node)!==node)node.dataset.rtNativeState='idle';return;}
          const transient=/^(Native card loading timed out\.|Public posts took too long to load\. Try again\.|Reddit could not render this card \(HTTP 50[0234]\)\.|Failed to fetch)$/.test(error?.message || '');
          if(transient && !this.nativeRetries.has(node)){this.nativeRetries.set(node,1);node.dataset.rtNativeState='queued';batch.queue.push(node);return;}
          if(node.dataset.rtQualify==='true'){delete node.dataset.rtQualify;this.sourceErrors.qualification='Some items could not be checked on Reddit.';}
          // Reddit no longer serves this item (deleted comments commonly 404).
          // With an archive snapshot, show it in Reddit's own card layout rather
          // than a bare link; the cue states where the text came from.
          // Reddit answers a comment its author deleted with no card at all (removed ones keep a "[removed]" card).
          const gone=error?.message==='Reddit no longer has this comment.';if(gone)this.postStatuses.set(post.fullname,'deleted');
          const latest=this.postMetadata.get(node.dataset.key) || post,snapshot=this.snapshotText(latest);
          if(this.isSearch()){this.showSearchUnit(gone?{...latest,status:'deleted'}:latest,node);return;}
          if(this.archiveOnly && latest.source==='arctic-shift' || !transient && snapshot){const shown={...latest,archivedBody:snapshot || latest.archivedBody};this.renderArchivedNative(shown,node);this.decorateNative(shown,node);return;}
          node.dataset.rtNativeState='failed';node.removeAttribute('aria-busy');node.replaceChildren();
          const fallback=make('div','rt-native-unavailable px-md py-sm'),copy=make('div','min-w-0 flex flex-col');copy.append(link(latest.title || (latest.kind==='comment'?'View comment on Reddit':'View post on Reddit'),latest.permalink,'text-14 font-semibold text-neutral-content-strong no-underline hover:underline'),make('span','text-12 text-neutral-content-weak','Reddit couldn’t load this item right now.'));fallback.append(copy);
          const retry=button('Retry',()=>{this.nativeRetries.delete(node);node.dataset.rtNativeState='idle';this.queueNative(node);});retry.className='button button-small button-bordered';retry.title=error?.message || 'Reddit could not load this card.';fallback.append(retry);node.append(fallback);this.ensureCardRule(node);
        }).finally(()=>{batch.active--;
          // A render from a parked or replaced view must not reconcile the current one.
          if(batch!==this.nativeBatch)return;this.reconcileFeed();this.drainNative(batch);this.updateProfileLoading();});
      }
    }
    forgetRecoveredBodies(){this.replyPatches=new Map();this.recoveredTitles=new Map();this.recoveredMedia=new Set();this.recoveredBodies=new Map();this.nativeDecorations=new Set();}
    restoreRecoveredBodies(){
      for(const [info,original] of this.replyPatches || [])if(info.hasAttribute('data-rt-reply-info')){info.replaceChildren(...original);delete info.dataset.rtReplyInfo;delete info.dataset.rtReplySignature;}this.replyPatches=new Map();
      for(const [body,patch] of this.recoveredBodies || [])if(body.contains(patch.recovered)){if(patch.created)body.remove();else body.replaceChildren(...patch.original);}
      for(const [node,original] of this.recoveredTitles || [])if(node.querySelector('[data-rt-recovered-text]'))node.replaceChildren(...original);this.recoveredTitles=new Map();
      for(const figure of this.recoveredMedia || [])figure.remove();this.recoveredMedia=new Set();
      for(const native of this.nativeDecorations || []){native.querySelector('[data-rt-source]')?.remove();native.querySelector('.rt-comment-source-credit')?.classList.remove('rt-comment-source-credit');native.querySelector('.rt-comment-source-host')?.classList.remove('rt-comment-source-host');}
      this.recoveredBodies=new Map();this.nativeDecorations=new Set();
    }
    // Show archived text where Reddit shows a deletion notice. The body can be
    // Reddit's rich-text block, a plain notice paragraph (current comments) or
    // missing entirely (removed posts), in which case Reddit's own text-body
    // slot receives it. Live text is never replaced.
    recoverBody(post,native){
      const text=post.archivedBody || (post.source==='arctic-shift'?post.body:''),html=post.archivedBody?post.archivedBodyHtml || '':post.source==='arctic-shift'?post.bodyHtml || '':'',media=post.kind==='comment'?(post.archivedMedia || post.media || []):undefined,mediaKey=JSON.stringify(media || []);
      if(!native || !text || deletionNotice(text.trim()) || post.over18 || post.spoiler || this.nativeRestrictions(native).restricted)return false;
      // An earlier restore in this card: keep it (the notice it replaced is gone).
      for(const prior of native.querySelectorAll('[data-rt-recovered-text]')){if(prior.closest('[slot="title"]'))continue;const patch=this.recoveredBodies.get(prior.parentElement);if(patch?.recovered===prior){if(prior.dataset.rtSourceText!==text || prior.dataset.rtSourceMedia!==mediaKey){const next=this.archivedText(text,html,media);next.dataset.rtOriginalText=prior.dataset.rtOriginalText || '';prior.replaceWith(next);patch.recovered=next;}return true;}}
      let body=native.querySelector(post.kind==='comment'?'[id$="-post-rtjson-content"],.md':'[slot="text-body"]'),created=false;
      const noticeParagraph=[...native.querySelectorAll('p')].find(p=>!p.closest('[data-rt-recovered-text],summary,[slot="commentMeta"],[slot="post-removed-banner"],[slot="title"]') && deletionNotice(p.textContent.trim()));
      if(noticeParagraph && (!body || !body.textContent.trim()))body=noticeParagraph.parentElement;
      if(!body && post.kind!=='comment' && ['deleted','removed'].includes(post.status)){body=make('div','md text-14 pb-xs');body.slot='text-body';created=true;}
      if(!body)return false;
      const copied=body.querySelector('[data-rt-recovered-text][data-rt-original-text]');if(copied && !this.recoveredBodies.has(body))this.recoveredBodies.set(body,{original:[document.createTextNode(copied.dataset.rtOriginalText)],recovered:copied});
      const existing=this.recoveredBodies.get(body);if(existing && body.contains(existing.recovered))return true;
      const current=body.textContent.trim();if(!created && !deletionNotice(current) && !(current==='' && ['deleted','removed'].includes(post.status)))return false;
      if(created){
        native.append(body);
        // Link-post layouts don't render text-body; use the next native slot that renders.
        for(const slot of ['post-recovery-section','post-removed-banner']){if(!native.shadowRoot || body.assignedSlot)break;body.slot=slot;}
        if(native.shadowRoot && !body.assignedSlot)body.removeAttribute('slot');
      }
      const recovered=this.archivedText(text,html,media);recovered.dataset.rtOriginalText=current;this.recoveredBodies.set(body,{original:[...body.childNodes],recovered,created});body.replaceChildren(recovered);return true;
    }
    // Archived markdown rendered like Reddit's body text (DOM nodes only).
    // Prefer the archive's server-rendered markdown (sanitized), then local rendering, then plain text.
    archivedText(text,html='',media){const el=make('div','rt-recovered-md');el.dataset.rtRecoveredText='true';el.dataset.rtSourceText=text;el.dataset.rtSourceMedia=JSON.stringify(media || []);const rendered=Array.isArray(media)?globalThis.RTMarkdown?.renderComment(text,html,media):globalThis.RTMarkdown?.fromHtml(html) || globalThis.RTMarkdown?.render(text);if(rendered)el.append(rendered);else el.append(make('p','whitespace-pre-wrap break-words',text));return el;}
    // Removed image posts lose their media in the card; Reddit-hosted images
    // usually remain, so show them where Reddit puts post media.
    recoverImage(value,native){
      if(!native || this.nativeRestrictions(native).restricted || native.querySelector('[slot="post-media-container"] img,[slot="post-media-container"] video,[slot="thumbnail"] img,.rt-archived-media,.rt-archive-media-group'))return false;
      const post=typeof value==='object'?value:null,items=post?.media || (M.mediaUrl(value)?[{kind:'image',url:M.mediaUrl(value)}]:[]);if(!items.length)return false;
      // Modern profile link cards render their thumbnail in a light-DOM grid,
      // not a named shadow slot. Put the archive preview in that existing cell.
      const grid=[...native.children].find(n=>n.classList.contains('grid') && n.className.includes('grid-cols-[1fr_min-content]')),cell=grid && [...grid.children].find(n=>n.className.includes('col-start-2') && n.className.includes('row-start-2'));
      const compact=Boolean(cell) || items.every(item=>['preview','thumbnail'].includes(item.kind));
      let figure=globalThis.RTArchiveView?.media(items,{alt:native.getAttribute('post-title') || post?.title || '',compact,postId:post?.id || native.id,href:post?.url || post?.permalink || ''});
      if(!figure){const image=items.find(item=>item.kind==='image' && M.mediaUrl(item.url));if(!image)return false;figure=make('figure','rt-archived-media');figure.dataset.rtRecoveredText='true';const img=make('img');img.src=M.mediaUrl(image.url);img.alt='';img.loading='lazy';img.decoding='async';img.referrerPolicy='no-referrer';figure.append(img);}
      if(cell)cell.append(figure);else{native.append(figure);for(const slot of compact?['thumbnail','post-media-container','post-recovery-section']:['post-media-container','post-recovery-section','text-body']){figure.slot=slot;if(!native.shadowRoot || figure.assignedSlot)break;}if(native.shadowRoot && !figure.assignedSlot)figure.removeAttribute('slot');}
      (this.recoveredMedia ||= new Set()).add(figure);return true;
    }
    // Removed posts show "[ Removed by moderator ]" as their title.
    recoverTitle(title,native){
      const node=native?.querySelector('[slot="title"]');if(!node || !title || deletionNotice(title.trim()) || !deletionNotice(node.textContent.trim()))return false;
      this.recoveredTitles ||= new Map();if(!this.recoveredTitles.has(node))this.recoveredTitles.set(node,[...node.childNodes]);
      const text=make('span','',title);text.dataset.rtRecoveredText='true';node.replaceChildren(text);return true;
    }
    async enrichReplyContexts(posts,current=()=>true){
      const comments=posts.filter(p=>{if(p.kind!=='comment')return false;const info=this.nodes.get(itemKey(p))?.querySelector('[id^="poster-info-"]');return !info?.textContent.trim() || info.hasAttribute('data-rt-reply-info');});if(!comments.length)return;
      // Seed the join from records already in memory before requesting anything.
      for(const p of [...this.live.values(),...this.archived.values()])if(p.kind==='comment' && M.validateUsername(p.author))this.replyAuthors.set(p.fullname,{author:p.author,linkId:p.linkId});
      const missing=comments.filter(p=>!p.parentId && !this.replyContexts.has(p.fullname));
      if(missing.length){try{const result=await this.request({action:'info',kind:'comment',ids:missing.slice(0,25).map(p=>p.id)});if(!current())return;for(const raw of result.posts || []){const p=M.normalizeComment(raw),original=missing.find(c=>c.fullname===p?.fullname && c.linkId===p.linkId);if(original)this.replyContexts.set(p.fullname,{parentId:p.parentId,linkId:p.linkId});}}catch{if(!current())return;}}
      const parents=new Set();for(const p of comments){const parentId=p.parentId || this.replyContexts.get(p.fullname)?.parentId;if(/^t1_[a-z0-9]{1,32}$/i.test(parentId || '') && !this.replyAuthors.has(parentId))parents.add(parentId);}
      if(parents.size){try{const ids=[...parents].slice(0,25),result=await this.request({action:'info',kind:'comment',ids});if(!current())return;for(const id of ids)this.replyAuthors.set(id,{author:'',linkId:''});for(const raw of result.posts || []){const p=M.normalizeComment(raw);if(p && parents.has(p.fullname) && (M.validateUsername(p.author) || p.author==='[deleted]'))this.replyAuthors.set(p.fullname,{author:p.author,linkId:p.linkId});}}catch{if(!current())return;}}
      for(const id of parents)if(!this.replyAuthors.has(id))this.replyAuthors.set(id,{author:'',linkId:''});
      if(this.settings.archiveDiscovery){
        const unresolved=comments.filter(p=>{const id=p.parentId || this.replyContexts.get(p.fullname)?.parentId;return /^t1_[a-z0-9]{1,32}$/.test(id || '') && !M.validateUsername(this.replyAuthors.get(id)?.author) && !this.replyArchiveChecked.has(id);});
        if(unresolved.length){const asked=unresolved.slice(0,25),parentOf=p=>p.parentId || this.replyContexts.get(p.fullname)?.parentId,markChecked=()=>{for(const p of asked)this.replyArchiveChecked.add(parentOf(p));};try{const result=await this.archive({action:'archive-parents',username:this.context.username,children:asked.map(p=>p.id)});if(!current())return;markChecked();this.clearSourceRetries(name=>name==='replies');for(const raw of result.posts || []){const p=M.normalizeComment(raw,{source:'arctic-shift'});if(p && unresolved.some(child=>(child.parentId || this.replyContexts.get(child.fullname)?.parentId)===p.fullname && child.linkId===p.linkId) && M.validateUsername(p.author))this.replyAuthors.set(p.fullname,{author:p.author,linkId:p.linkId});}}catch(error){if(!current())return;
          // Unanswered requests stay unchecked while a quiet retry is pending.
          if(!(this.transientFailure(error,'archive') && this.scheduleSourceRetry('replies',error,'archive')))markChecked();}}
      }
      if(current())for(const p of comments){const node=this.nodes.get(itemKey(p));if(node)this.repairReplyInfo(p,node.querySelector('shreddit-profile-comment'));}
    }
    retryReplyEnrichment(){
      const generation=this.generation,current=()=>generation===this.generation && pageRoute()?.key===this.context?.key && this.host?.isConnected;
      const comments=(this.renderedPosts || []).filter(p=>p.kind==='comment' && this.publishedCards.has(itemKey(p)));
      return this.replyEnrichment=Promise.resolve(this.replyEnrichment).catch(()=>{}).then(()=>current()?this.enrichReplyContexts(comments,current):undefined);
    }
    repairReplyInfo(post,native){
      if(post.kind!=='comment' || !native)return;
      const info=native.querySelector('[id^="poster-info-"]');if(!info || info.textContent.trim() && !info.hasAttribute('data-rt-reply-info'))return;
      const parentId=post.parentId || this.replyContexts.get(post.fullname)?.parentId,parent=this.replyAuthors.get(parentId),replyTo=parent?.linkId===post.linkId?parent.author:'',author=post.archiveAuthor || post.author;
      if(!M.validateUsername(author) && author!=='[deleted]')return;
      const signature=[author,parentId,replyTo].join(':');if(info.dataset.rtReplySignature===signature)return;
      this.replyPatches ||= new Map();if(!this.replyPatches.has(info))this.replyPatches.set(info,[...info.childNodes]);
      const identity=username=>M.validateUsername(username)?link(username,'/user/'+username+'/','font-bold text-12 hover:underline text-tone-1 inline-flex items-center'):document.createTextNode('[deleted]');
      const reply=/^t1_[a-z0-9]{1,32}$/i.test(parentId || '');info.replaceChildren(identity(author),document.createTextNode(reply?(replyTo?' replied to ':' replied'):' commented'));if(reply && replyTo)info.append(identity(replyTo));info.dataset.rtReplyInfo='true';info.dataset.rtReplySignature=signature;
    }
    decorateNative(post,node){
      node.querySelector('[data-rt-archive]')?.remove();this.ensureCardRule(node);
      const native=node.matches('shreddit-post,shreddit-profile-comment')?node:node.querySelector('shreddit-post,shreddit-profile-comment');if(!native)return;
      post={...post,status:this.verifiedStatus(post,native)};
      if(this.context.section){
        this.repairReplyInfo(post,native);node.querySelector('[data-rt-source]')?.remove();for(const pill of node.querySelectorAll('.rt-removal-pill'))pill.remove();
        // One icon, right after the time, as profile search places its status icons.
        if(post.removal){const pill=this.removalPill(post.removal),time=native.querySelector('faceplate-timeago');if(time)time.after(pill);else (native.querySelector('[slot="commentMeta"],[slot="credit-bar"]') || native).append(pill);}return;
      }
      // Client search matches are ordinary native results. Only archive-only
      // matches and proven removals need a discovery/status cue in this view.
      if(this.isSearch() && post.source==='reddit' && !['deleted','removed'].includes(post.status) && node.dataset.rtArchiveFallback!=='true'){this.repairReplyInfo(post,native);node.querySelector('[data-rt-source]')?.remove();return;}
      // Discovery-only HTML has no full body/deletion proof. Once the actual
      // native card proves deletion, a separately obtained archive can restore
      // its text even though the search record itself still has unknown status.
      const archive=this.archived.get(itemKey(post));
      const owned=this.context.kind==='profile' && ['deleted','removed'].includes(post.status) && archive?.source==='arctic-shift' && archive.fullname===post.fullname && archive.author.toLowerCase()===this.context.username.toLowerCase();
      if(owned)post={...post,archivedBody:post.archivedBody || archive.body,archivedBodyHtml:post.archivedBodyHtml || archive.bodyHtml,archivedMedia:archive.media,over18:post.over18 || archive.over18,spoiler:post.spoiler || archive.spoiler};
      const fallback=node.dataset?.rtArchiveFallback==='true',fallbackMedia=fallback && archive?.fullname===post.fullname && archive.author?.toLowerCase()===this.context.username?.toLowerCase()?archive:post;
      this.repairReplyInfo(post,native);const recovered=this.recoverBody(post,native),titled=owned && post.kind!=='comment' && !post.over18 && !post.spoiler && this.recoverTitle(archive.title,native),pictured=(owned || fallback) && post.kind!=='comment' && !post.over18 && !post.spoiler && this.recoverImage(owned?archive:fallbackMedia,native),label=this.indicator(post);
      const titleShown=titled || Boolean(this.recoveredTitles?.has(native.querySelector('[slot="title"]')));if(recovered)label.title+=' · Text recovered from Arctic Shift';else if(titleShown)label.title+=' · Title recovered from Arctic Shift';else if(fallback && post.source!=='arctic-shift')label.title+=' · Text from an Arctic Shift snapshot';
      const retrieved=archive?.retrieved || post.retrieved;if(retrieved && (recovered || titleShown || fallback || post.source==='arctic-shift'))label.title+=' · Snapshot from '+new Date(retrieved*1000).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});
      label.setAttribute('aria-label',label.title);
      let badge=node.querySelector('[data-rt-source]');if(!badge || badge.title!==label.title){if(badge)badge.replaceWith(label);badge=label;badge.dataset.rtSource='true';}
      if(native.matches('shreddit-profile-comment')){
        const host=native.firstElementChild || native,credit=host.querySelector('.text-12.relative') || host.firstElementChild;host.classList.add('rt-comment-source-host');credit?.classList.add('rt-comment-source-credit');if(badge.parentElement!==host)host.append(badge);
      }else{
        const credit=native.querySelector('[slot="credit-bar"]') || native;
        // Reddit's credit slot is display:contents, so anything appended to it
        // becomes its own grid item on a new line. Join the inner credit row
        // (subreddit, time, pin) as its last inline item instead.
        const row=credit.querySelector(':scope > [id^="feed-post-credit-bar-"], :scope > * > [id^="feed-post-credit-bar-"]') || (credit.matches('.contents')?credit.querySelector(':scope > .flex'):null),scope=row || credit;
        let actions=scope.querySelector('shreddit-post-overflow-menu');while(actions && actions.parentElement!==scope)actions=actions.parentElement;
        if(actions){if(badge.parentElement!==actions)actions.prepend(badge);}
        else if(row){if(badge.parentElement!==row || badge!==row.lastElementChild){badge.style.marginInlineStart='';row.append(badge);}}
        else if(badge.parentElement!==credit){badge.style.marginInlineStart='auto';credit.append(badge);}
      }
    }
    maybeRestoreDetail(){
      if(!this.autoDiscover || this.context?.kind!=='post' || !this.settings.archiveDiscovery || !this.settings.restoreDeletedContent || this.detailRecoveryStarted)return;
      const context=this.context,native=document.querySelector('main shreddit-post[id="t3_'+context.id+'"]');
      if(!['deleted','removed'].includes(this.verifiedStatus({fullname:'t3_'+context.id,status:'unknown'},native)))return;
      this.detailRecoveryStarted=true;const generation=this.generation;queueMicrotask(()=>{if(generation===this.generation && pageRoute()?.key===context.key && this.host?.isConnected)this.loadDetail();});
    }
    loadDetail(){if(!this.settings.archiveDiscovery)return;return this.run(async current=>{
      const id=this.context.id,result=await this.archive({action:'archive-ids',ids:[id]});if(!current())return;
      const archived=(result.posts || []).map(p=>M.normalizePost(p,{source:'arctic-shift'})).find(p=>p?.id===id);
      if(!archived){this.setStatus('No archived snapshot is available for this post.');return;}
      const native=document.querySelector('shreddit-post[id="t3_'+id+'"]'),status=this.verifiedStatus({fullname:'t3_'+id,status:'unknown'},native);const restrictions=this.nativeRestrictions(native);let live=['deleted','removed'].includes(status)?{...archived,status,source:'reddit',over18:archived.over18 || restrictions.over18,spoiler:archived.spoiler || restrictions.spoiler}:null;try{if(!live){const response=await this.request({action:'info',ids:[id]});live=response.posts?.map(p=>M.normalizePost(p,{source:'reddit'})).find(p=>p?.id===id);}}catch{ /* An archive is never proof of current removal. */ }
      if(!current())return;
      this.results.replaceChildren();
      if(live?.status==='available'){this.setStatus('This post is available on Reddit. Its live content is unchanged.');return;}
      // Restore inside Reddit's own post element when the snapshot belongs to the same author.
      const nativeAuthor=native?.getAttribute('author') || '',sameAuthor=!nativeAuthor || nativeAuthor==='[deleted]' || nativeAuthor.toLowerCase()===archived.author.toLowerCase();
      if(native && live && sameAuthor && this.settings.restoreDeletedContent){
        const shown={...live,archivedBody:archived.body,archivedBodyHtml:archived.bodyHtml,over18:live.over18 || archived.over18,spoiler:live.spoiler || archived.spoiler},safe=!shown.over18 && !shown.spoiler && !restrictions.restricted;
        const body=this.recoverBody(shown,native),titled=safe && this.recoverTitle(archived.title,native);
        if(body || titled){this.nativeDecorations.add(native);this.decorateNative({...live,archivedBody:archived.body,retrieved:archived.retrieved},native);this.setStatus(body?'Available archived text restored.':'Archived title restored.');return;}
      }
      const note=make('div','rt-post-snapshot');note.append(this.indicator(live || archived));
      const hasText=archived.body && !['[deleted]','[removed]'].includes(archived.body),nsfw=archived.over18 || live?.over18;
      if(hasText && (nsfw || archived.spoiler || live?.spoiler || restrictions.restricted))note.append(sensitive(this.snapshot(archived.body),nsfw?'View NSFW content':archived.spoiler || live?.spoiler?'View spoiler':'View content',{media:false}));
      else if(hasText)note.append(this.snapshot(archived.body));else note.append(make('p','rt-post-source','The archive has no original text for this post.'));
      this.results.append(note);this.setStatus(live?`${live.status==='deleted'?'Deleted':'Removed'} on Reddit · Separate archived snapshot`:'Archived snapshot · Current Reddit status unknown');
    });}
    destroy(){this.dead=true;this.syncRemovedTab('');if(this.onRemovedTab){window.removeEventListener('click',this.onRemovedTab,true);window.removeEventListener('keydown',this.onRemovedTab,true);}document.querySelector('[data-rt-ui="removed-tab"]')?.remove();if(this.onHeaderResize)removeEventListener('resize',this.onHeaderResize);this.ownIdentityController?.abort();this.clearOwnListHeader();this.clearHeaderFilters();this.ownIdentityError?.remove();document.removeEventListener('submit',this.onOwnSubmit,true);document.removeEventListener('focusin',this.onOwnFocus,true);this.discardAllParked();this.avatarUnsubscribe?.();clearTimeout(this.timer);this.observer?.disconnect();
      // An orphaned script can no longer reach its extension's APIs.
      try{globalThis.chrome?.runtime?.onMessage?.removeListener?.(this.onWorkerSettings);}catch{}try{globalThis.chrome?.storage?.onChanged?.removeListener?.(this.onSettings);}catch{}
      document.documentElement.removeAttribute('data-rt-smooth-feed');window.removeEventListener('popstate',this.onRoute);if(this.onUserScroll)window.removeEventListener('scroll',this.onUserScroll);clearTimeout(this.scrollDeferTimer);document.removeEventListener('reddit:route',this.onRoute);document.removeEventListener('keydown',this.onEmptyProfileSearch,true);this.reset({retainNavigation:false});document.documentElement.removeAttribute('data-rt-profile-discovery');}
  }
  // One archive item as the same Reddit-native card the profile archive draws, for pages that are not a
  // profile (the subreddit archive). Inert actions, archive status badge, no live Reddit lookups.
  function archiveCard(post,{thread=false}={}){
    const d=Object.create(Discovery.prototype);d.archived=new Map();d.context={kind:'archive',username:''};d.recoveredMedia=new Set();d.recoveredBodies=new Map();
    const item={...post,source:'arctic-shift',status:post.status || 'available',rtThread:thread===true},node=make('div','rt-native-card');node.dataset.rtUi='archive-item';node.dataset.fullname=item.fullname;
    const native=d.renderArchivedNative(item,node);
    // A snapshot's current Reddit status is unknown: use the archive badge, never a deleted/removed claim.
    const badge=d.indicator({...item,status:'unknown'});badge.dataset.rtSource='true';
    if(native.matches('shreddit-profile-comment')){const host=native.firstElementChild || native;host.classList.add('rt-comment-source-host');host.firstElementChild?.classList.add('rt-comment-source-credit');host.append(badge);}
    else{const right=native.querySelector('[data-rt-credit-right]');if(right)right.prepend(badge);else (native.querySelector('[slot="credit-bar"]') || native).append(badge);}
    // Snapshot cards retain navigation even before native controls hydrate.
    // Stop captured actions before Reddit can vote/save/share against archived values.
    const guard=event=>{
      // The archive's own safe controls (reveal, Back, copy-link Share) never act on Reddit: let them through.
      if(event.composedPath().some(n=>n.matches?.('.rt-sensitive:not(.rt-revealed),.rt-sra-back,.rt-sra-share')))return;
      if(event.type==='keydown' && !['Enter',' '].includes(event.key) || event.type==='auxclick' && event.button!==1)return;
      const path=event.composedPath(),anchor=path.find(n=>n.matches?.('a[href]'));
      if(anchor){let url;try{url=new URL(anchor.href,location.href);}catch{}if(url && ['http:','https:'].includes(url.protocol) && !url.username && !url.password){
        if(event.type==='keydown' && event.key===' ')return;
        const handled=event.defaultPrevented;event.preventDefault();event.stopImmediatePropagation();if(handled)return;
        // A capture stop inside an upgrading native card can swallow its default
        // link activation. Forward the URL outside that card, retaining new-tab gestures.
        const forward=link('',url.href);forward.hidden=true;forward.dataset.rtUi='archive-navigation-link';forward.target=event.ctrlKey || event.metaKey || event.shiftKey || event.button===1?'_blank':anchor.target || '';document.body.append(forward);try{forward.click();}finally{forward.remove();}if(!forward.target && url.origin===location.origin && !url.hash && !/\/comments\/[a-z0-9]+\/[^/]*\/[a-z0-9]+\/?$/i.test(url.pathname))startNavigatedPageAtTop(url);return;
      }}
      event.preventDefault();event.stopImmediatePropagation();
      if(event.type==='click' && !thread && !path.some(n=>n.matches?.('button,input,textarea,select,video,audio,[role="button"]')) && !String(globalThis.getSelection?.() || ''))native.querySelector('[slot="title"] a,a[slot="title"]')?.click();
    };
    for(const type of ['click','auxclick','keydown'])node.addEventListener(type,guard,true);
    native.removeAttribute('inert');
    for(const row of native.querySelectorAll('shreddit-comment-action-row')){row.removeAttribute('inert');row.setAttribute('aria-label','Archived values; open the thread for current actions');}
    return node;
  }
  globalThis.RTPostDiscovery=Object.freeze({Discovery,pageRoute,glyph,redditRead,archiveCard,clipFade,navSkeleton,PROFILE_REDDIT_SEARCH_CAPABILITIES,avatarHint:name=>avatarHints.get(String(name||'').toLowerCase())?.url || ''});
  // Debug handle in the extension's isolated world only (not visible to Reddit's page).
  if(window.top===window && globalThis.chrome?.runtime?.id)Object.defineProperty(globalThis,'RTDiscoveryDebug',{value:new Discovery()});
})();
