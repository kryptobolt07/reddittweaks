/* Inline public-post discovery. Does not change Reddit's posts or chat client. */
(() => {
  'use strict';
  const M=globalThis.RTPostModel;if(!M)return;
  const key='rt-settings-v1';
  const profileBatchSize=25;
  function pageRoute(path=location.pathname,search=location.search){
    const profile=path.match(/^\/user\/([\w-]{1,20})(?:\/(submitted|comments))?\/?$/i);
    if(profile){const view=profile[2]==='submitted'?'posts':profile[2]==='comments'?'comments':'overview',params=new URLSearchParams(search);
      const sort=['new','hot','top'].includes(params.get('sort'))?params.get('sort'):'new',range=sort==='top' && ['hour','day','week','month','year','all'].includes(params.get('t'))?params.get('t'):'all',layout=['cardView','compactView'].includes(params.get('feedViewType'))?params.get('feedViewType'):'';
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
      timer=setTimeout(()=>{document.dispatchEvent(new CustomEvent('rt-post-request',{detail:JSON.stringify({channel,id,action:'cancel'})}));finish(Error('Public posts took too long to load. Try again.'));},12000);
      if(signal?.aborted){cancel();return;}
      document.dispatchEvent(new CustomEvent('rt-post-request',{detail:JSON.stringify({channel,id,...parameters})}));
    });
  }
  async function archiveRead(parameters){
    let timer;try{const response=await Promise.race([chrome.runtime.sendMessage({scope:'rt-posts',...parameters}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Archive request took too long. Try again.')),16000);})]);if(!response?.ok)throw Error(response?.error || 'Archive unavailable.');return response;}finally{clearTimeout(timer);}
  }
  async function settingsRead(){
    const response=await archiveRead({action:'get-settings'});
    return {[key]:response.settings};
  }
  const itemKey=post=>post.kind==='comment'?post.fullname:post.id;
  const make=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text)el.textContent=text;return el;};
  const nativeStatusPaths={hidden:'M3.497 3.503a.9.9 0 10-1.273 1.273l.909.909A10.141 10.141 0 00.92 8.472a3.225 3.225 0 000 3.058A10.296 10.296 0 0010 16.973a10.13 10.13 0 003.709-.712l1.457 1.457a.897.897 0 001.274 0 .9.9 0 000-1.273L3.497 3.503ZM10 15.172a8.497 8.497 0 01-7.495-4.494 1.448 1.448 0 010-1.354 8.436 8.436 0 011.9-2.365l2.069 2.068c-.062.271-.105.55-.105.84a3.77 3.77 0 003.767 3.767c.29 0 .569-.043.84-.106l1.31 1.31a8.284 8.284 0 01-2.284.335L10 15.172Zm.476-7.237L8.874 6.333a3.722 3.722 0 011.26-.233 3.77 3.77 0 013.767 3.767c0 .444-.091.864-.233 1.26l-1.603-1.603a1.963 1.963 0 00-1.59-1.589Zm8.605 3.595a10.297 10.297 0 01-2.22 2.792L15.59 13.05a8.512 8.512 0 001.905-2.372 1.448 1.448 0 000-1.354A8.496 8.496 0 007.69 5.15L6.282 3.742A10.249 10.249 0 0110 3.028c3.8 0 7.28 2.087 9.08 5.444a3.225 3.225 0 010 3.058Z',deleted:'M15.2 15.7c0 .83-.67 1.5-1.5 1.5H6.3c-.83 0-1.5-.67-1.5-1.5V7.6H3v8.1C3 17.52 4.48 19 6.3 19h7.4c1.82 0 3.3-1.48 3.3-3.3V7.6h-1.8v8.1ZM17.5 5.8c.5 0 .9-.4.9-.9S18 4 17.5 4h-3.63c-.15-1.68-1.55-3-3.27-3H9.4C7.68 1 6.28 2.32 6.13 4H2.5c-.5 0-.9.4-.9.9s.4.9.9.9h15ZM7.93 4c.14-.68.75-1.2 1.47-1.2h1.2c.72 0 1.33.52 1.47 1.2H7.93Z'};
  Object.assign(nativeStatusPaths,{filter:'M3 6.9h7.11A4 4 0 0014 10c2.21 0 4-1.79 4-4s-1.79-4-4-4a4 4 0 00-3.89 3.1H3c-.5 0-.9.4-.9.9s.4.9.9.9Zm11-3.1c1.21 0 2.2.99 2.2 2.2 0 1.21-.99 2.2-2.2 2.2-1.21 0-2.2-.99-2.2-2.2 0-1.21.99-2.2 2.2-2.2Zm3 9.3H9.89A4 4 0 006 10c-2.21 0-4 1.79-4 4s1.79 4 4 4a4 4 0 003.89-3.1H17c.5 0 .9-.4.9-.9s-.4-.9-.9-.9ZM6 16.2c-1.21 0-2.2-.99-2.2-2.2 0-1.21.99-2.2 2.2-2.2 1.21 0 2.2.99 2.2 2.2 0 1.21-.99 2.2-2.2 2.2Z',checkmark:'M7.09 15.84c-.23 0-.46-.09-.64-.26L1.3 10.42a.9.9 0 010-1.27.9.9 0 011.27 0l4.52 4.52L17.5 3.26a.9.9 0 011.27 0 .9.9 0 010 1.27L7.73 15.58c-.18.18-.41.26-.64.26Z','chevron-right':'M7.5 17.9a.898.898 0 01-.636-1.536L13.227 10 6.864 3.636a.898.898 0 010-1.272.898.898 0 011.272 0l7 7a.898.898 0 010 1.272l-7 7a.897.897 0 01-.636.264Z','arrow-back':'M17.5 9.1H4.679l5.487-5.462a.898.898 0 00.003-1.272.898.898 0 00-1.272-.003l-7.032 7a.898.898 0 000 1.275l7.03 7a.896.896 0 001.273-.003.898.898 0 00-.002-1.272l-5.487-5.462h12.82a.9.9 0 000-1.8Z'});
  function glyph(kind='search'){
    const s=document.createElementNS('http://www.w3.org/2000/svg','svg');s.setAttribute('viewBox','0 0 24 24');s.dataset.icon=kind;s.classList.add('rt-activity-icon');s.setAttribute('aria-hidden','true');if(nativeStatusPaths[kind]){s.setAttribute('viewBox','0 0 20 20');s.dataset.nativeIcon='true';s.setAttribute('fill','currentColor');s.setAttribute('width','16');s.setAttribute('height','16');s.setAttribute('icon-name',kind);const path=document.createElementNS(s.namespaceURI,'path');path.setAttribute('d',nativeStatusPaths[kind]);s.append(path);return s;}
    const p=document.createElementNS(s.namespaceURI,'path');p.setAttribute('d',kind==='refresh'?'M20 8a8.9443 8.9443 0 1 0 0 8M20 3v5h-5':kind==='filter'?'M4 7h16M4 17h16M9 5v4M15 15v4':kind==='archive'?'M4 8h16v12H4zM3 4h18v4H3zM9 12h6':kind==='removed'?'M5 5l14 14M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20':'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14m5 12 6 6');s.append(p);return s;
  }
  const unavailableAvatarUrl=state=>state==='banned'?'https://www.redditstatic.com/shreddit/assets/snoovatar-back-64x64px.png':'https://www.redditstatic.com/avatars/defaults/v2/avatar_default_0.png';
  function unavailableAvatar(state,size=64){const image=make('img','rt-unavailable-avatar');image.src=unavailableAvatarUrl(state);image.width=image.height=size;image.alt='';image.decoding='async';image.referrerPolicy='no-referrer';return image;}
  function button(text,run,icon){const b=make('button','',text);b.type='button';if(icon)b.prepend(glyph(icon));b.addEventListener('click',run);return b;}
  function link(text,url,cls){const a=make('a',cls,text);a.href=url;a.rel='noopener noreferrer';return a;}
  class Discovery {
    constructor({reddit=redditRead,archive=archiveRead,readSettings=settingsRead,observe=true,autoDiscover=observe,nativeRenderer=null}={}){
      this.navigationLease=crypto.randomUUID();this.profileStates=new Map();this.profileOwner=globalThis.RCSDirectory?.getOwner?.() || '';this.nativeRenderer=nativeRenderer;this.autoDiscover=autoDiscover;this.reddit=reddit;this.archive=archive;this.readSettings=readSettings;this.settings={postDiscovery:false,archiveDiscovery:false};this.settingsRevision=0;this.generation=0;this.controllers=new Set();this.nodes=new Map();this.host=null;
      this.settingsPending=true;this.syncProfileNotice();
      this.onRoute=()=>{this.rememberProfile();this.syncProfileNotice();this.schedule();};this.onNavigate=event=>{const a=event.target.closest?.('a[href]'),card=event.target.closest?.('shreddit-post');if(!this.feed?.contains(event.target) || event.target.closest?.('button,input'))return;try{const url=new URL(a?.href || card?.getAttribute('permalink'),location.href);if(url.origin===location.origin && pageRoute(url.pathname,'')?.kind==='post')this.rememberProfile();}catch{}};if(observe)document.addEventListener('click',this.onNavigate,true);this.onSettings=(changes,area)=>{if(area==='local' && changes[key]){this.profileStates.clear();this.settingsRevision++;this.settingsPending=false;this.settingsError=false;this.settings=M.normalizeSettings(changes[key].newValue);this.reset();this.scan();}};
      if(observe){this.observer=new MutationObserver(records=>{this.syncProfileNotice();this.trackVirtualization(records);if(records.some(r=>!this.ownsMutation(r)))this.schedule();});this.observer.observe(document.documentElement,{childList:true,subtree:true});window.addEventListener('popstate',this.onRoute);document.addEventListener('reddit:route',this.onRoute);globalThis.chrome?.storage?.onChanged?.addListener(this.onSettings);}
      this.onWorkerSettings=(message,sender)=>{if(message?.scope==='rt-posts' && message.action==='settings-changed' && sender?.id===globalThis.chrome?.runtime?.id)this.onSettings({[key]:{newValue:message.settings}},'local');};
      if(observe)globalThis.chrome?.runtime?.onMessage?.addListener(this.onWorkerSettings);
      this.avatarUnsubscribe=globalThis.RCSDirectory?.onChange?.(value=>{const owner=globalThis.RCSDirectory?.getOwner?.() || '';if(value?.owner && value.owner!==owner)return;if(this.profileOwner!==owner){this.profileOwner=owner;this.profileStates.clear();this.reset({retainNavigation:false});this.scan();}});
      this.ready=this.loadSettings();
    }
    async loadSettings(){const revision=this.settingsRevision;try{const saved=await this.readSettings();if(revision!==this.settingsRevision)return;this.settingsPending=false;this.settingsError=false;this.settings=M.normalizeSettings(saved?.[key]);this.scan();}catch{if(revision!==this.settingsRevision)return;this.settingsPending=false;this.settingsError=true;this.scan();}}
    syncProfileNotice(){
      // The independent early guard needs no shared model. Discovery itself
      // retains its established document_idle registration in the isolated world.
      if(globalThis.RTProfileNoticeGuard){if(this.settingsPending)RTProfileNoticeGuard.refresh();else RTProfileNoticeGuard.setEnabled(this.settings.postDiscovery);return;}
      document.documentElement.toggleAttribute('data-rt-profile-discovery',pageRoute()?.kind==='profile' && location.hostname!=='old.reddit.com' && (this.settingsPending || this.settings.postDiscovery));
    }
    ownsMutation(record){if(this.host?.contains(record.target) || record.target.closest?.('[data-rt-ui=activity-item]'))return true;const nodes=[...record.addedNodes,...record.removedNodes];return nodes.length>0 && nodes.every(n=>n.nodeType===1 && Boolean(n.dataset?.rtUi));}
    schedule(){if(this.timer)return;this.timer=setTimeout(()=>{this.timer=null;this.scan();},60);}
    reset({retainNavigation=false}={}){this.flushVirtualization();for(const node of this.mergePendingNodes || [])node.removeAttribute('data-rt-order-pending');this.feed?.removeAttribute('data-rt-merge-waiting');this.mergePendingNodes=new Set();this.publishedNative=new WeakSet();this.feed?.removeAttribute('data-rt-activity');this.feed?.removeAttribute('data-rt-loading-owner');this.feedPresentationObserver?.disconnect();this.feedPresentationObserver=null;for(const style of this.nativeLoadingStyles || [])style.remove();this.nativeLoadingStyles=new Set();for(const [node,hidden] of this.filteredNative || []){node.hidden=hidden;node.removeAttribute('data-rt-filter-hidden');node.removeAttribute('data-rt-activity-match');const original=this.virtualNodes?.get(node);if(original){original.hidden=hidden;original.removeAttribute('data-rt-filter-hidden');original.removeAttribute('data-rt-activity-match');}}this.clearActivityMenu();this.controlsTarget?.remove();this.controlsTarget=null;if(this.commentSort){this.commentSort.node.hidden=this.commentSort.hidden;this.commentSort.node.removeAttribute('data-rt-comment-sort-suppressed');this.commentSort=null;}this.activityArchiveAttempted=false;this.activityEmpty?.remove();this.activityEmpty=null;this.activityFilter='all';this.filteredNative=new Map();this.postStatuses=new Map();this.restoreRecoveredBodies();this.profileNavigation?.remove();if(!retainNavigation){this.profileNavigation=null;this.navigationLease=crypto.randomUUID();}else if(this.profileNavigation?.dataset.state==='loading')this.profileNavigation.dataset.state='idle';this.archiveNotice?.removeAttribute('data-rt-archive-notice');this.archiveShell?.remove();this.archiveNotice=this.archiveNoticeAnchor=this.archiveShell=this.archiveMain=this.archiveStats=this.avatarSlot=this.avatarPlaceholder=null;this.profileOverlay=false;this.profileTransition=false;this.presentedFeedNodes=null;this.archiveOnly=false;this.accountState='';this.generation++;this.recoveryObserver?.disconnect();this.recoveryObserver=null;this.recoveryObserved=new WeakSet();clearTimeout(this.recoveryTimer);this.recoveryTimer=null;clearTimeout(this.nativeResumeTimer);this.nativeObserver?.disconnect();this.batchObserver?.disconnect();this.batchObserver=null;this.nativeLoadingObserver?.disconnect();this.nativeLoadingObserver=null;this.nativeLoadingRoot=null;if(this.batchFrame)cancelAnimationFrame(this.batchFrame);this.batchFrame=null;this.activeProfileBatch=null;this.replyEnrichment=null;this.publishedCards=new Set();this.batchedProfile=false;this.batchInView=false;this.batchAutoPaused=false;this.forceProfileBatch=false;this.nativeBatch={active:0,queue:[]};this.nativeRetries=new WeakMap();this.postMetadata=new Map();this.replyContexts=new Map();this.replyAuthors=new Map();this.replyArchiveChecked=new Set();for(const c of this.controllers)c.abort();this.controllers.clear();if(this.emptyFeed){this.emptyFeed.hidden=this.emptyWasHidden;this.emptyFeed.removeAttribute('data-rt-empty-suppressed');}this.emptyFeed=null;for(const node of this.nodes.values()){const slot=this.feedSlot(node);if(slot!==node){
        // Reddit still owns this placeholder and may restore its detached node.
        // Retire both without removing a slot from its virtualization stack.
        slot.dataset.rtRetired='true';node.dataset.rtRetired='true';node.replaceChildren();node.hidden=true;
      }else node.remove();}this.virtualNodes=new Map();this.loading?.remove();this.loading=null;this.host?.remove();this.host=null;this.feed=null;this.context=null;this.live=new Map();this.commentOrigins=new Map();this.archived=new Map();this.nodes.clear();this.after=this.before=null;this.loaded=false;this.archiveLoaded=false;this.moreReddit=this.moreArchive=false;this.sourceErrors={};this.metadataPending=0;this.recoveryChecked=new Set();this.recoveryActive=false;this.detailRecoveryStarted=false;this.busy=false;this.archiveBusy=false;this.initialPrefetchDone=false;this.sourcePending=new Set();this.sourceFrontiers=new Map();this.pages=0;this.afterByKind={};this.beforeByKind={};this.redMore={};this.archiveMore={};this.renderedPosts=[];this.summaryCounts=null;}
    rememberProfile(){
      if(this.context?.kind!=='profile' || !this.settings.postDiscovery || this.settingsError || !(this.loaded || this.archiveLoaded))return;
      const previous=this.profileStates.get(this.context.key),owner=globalThis.RCSDirectory?.getOwner?.() || '',signature=[this.generation,this.renderVersion || 0,this.pages,this.live.size,this.archived.size,this.activityFilter,JSON.stringify(this.sourceErrors || {}),this.publishedCards.size,[...this.nodes.values()].filter(node=>node.dataset.rtNativeState==='ready').length].join(':');
      if(previous?.signature===signature && previous.owner===owner){if(pageRoute()?.key===this.context.key)previous.scrollY=window.scrollY || 0;return;}
      const saved={signature,owner,archiveOnly:this.archiveOnly,live:new Map(this.live),archived:new Map(this.archived),cards:new Map(),scrollY:pageRoute()?.key===this.context.key?window.scrollY || 0:previous?.scrollY || window.scrollY || 0};
      for(const name of ['loaded','archiveLoaded','pages','moreReddit','moreArchive','initialPrefetchDone'])saved[name]=this[name];
      saved.sourceFrontiers=new Map(this.sourceFrontiers);saved.commentOrigins=new Map(this.commentOrigins);saved.sourceErrors={...this.sourceErrors};for(const name of ['afterByKind','beforeByKind','redMore','archiveMore'])saved[name]={...this[name]};saved.recoveryChecked=new Set(this.recoveryChecked);saved.activityFilter=this.activityFilter;saved.postStatuses=new Map(this.postStatuses);saved.publishedCards=new Set(this.publishedCards);saved.replyContexts=new Map(this.replyContexts);saved.replyAuthors=new Map(this.replyAuthors);saved.replyArchiveChecked=new Set(this.replyArchiveChecked);
      for(const [key,node] of this.nodes)if(node.dataset.rtNativeState==='ready'){const copy=node.cloneNode(true);copy.classList.remove('rt-native-enter');for(const script of copy.querySelectorAll('script'))script.remove();const partial=copy.firstElementChild;if(partial?.matches('faceplate-partial') && partial.querySelector('shreddit-post,shreddit-profile-comment'))partial.replaceWith(...partial.childNodes);saved.cards.set(key,copy);}
      saved.publishedCards=new Set([...saved.publishedCards].filter(key=>saved.cards.has(key)));
      this.profileStates.delete(this.context.key);this.profileStates.set(this.context.key,saved);
      while(this.profileStates.size>4 || [...this.profileStates.values()].reduce((count,state)=>count+state.cards.size,0)>250)this.profileStates.delete(this.profileStates.keys().next().value);
    }
    restoreProfile(context){
      const saved=this.profileStates.get(context.key);if(!saved || saved.owner!==(globalThis.RCSDirectory?.getOwner?.() || '') || saved.archiveOnly!==this.archiveOnly)return false;
      this.sourceFrontiers=saved.sourceFrontiers || new Map();this.profileStates.delete(context.key);this.sourceErrors={...saved.sourceErrors};this.recoveryChecked=new Set(saved.recoveryChecked);this.activityFilter=saved.activityFilter || 'all';this.postStatuses=saved.postStatuses || new Map();this.live=saved.live;this.commentOrigins=saved.commentOrigins || new Map();this.archived=saved.archived;this.nodes=saved.cards;this.publishedCards=saved.publishedCards || new Set(saved.cards.keys());this.replyContexts=saved.replyContexts || new Map();this.replyAuthors=saved.replyAuthors || new Map();this.replyArchiveChecked=saved.replyArchiveChecked || new Set();
      for(const name of ['loaded','archiveLoaded','pages','moreReddit','moreArchive','initialPrefetchDone','afterByKind','beforeByKind','redMore','archiveMore'])this[name]=saved[name];
      for(const node of this.nodes.values())this.results.append(node);
      const generation=this.generation;if(saved.scrollY>0)requestAnimationFrame(()=>{if(generation===this.generation && pageRoute()?.key===context.key && window.scrollY===0)window.scrollTo({top:saved.scrollY,behavior:'instant'});});
      return true;
    }
    trackVirtualization(records){
      for(const record of records){
        if(record.target!==this.feed || record.addedNodes.length!==1 || record.removedNodes.length!==1)continue;
        const added=record.addedNodes[0],removed=record.removedNodes[0];
        if(added.nodeType===1 && added.matches('.virtualized-placeholder') && added.parentElement===this.feed){this.virtualNodes.set(added,removed);if(this.filteredNative.has(removed)){this.filteredNative.set(added,this.filteredNative.get(removed));this.filteredNative.delete(removed);}if(removed.dataset?.rtUi==='activity-item'){added.dataset.rtUi='activity-slot';added.hidden=removed.hidden;}if(removed.hasAttribute?.('data-rt-order-pending')){added.setAttribute('data-rt-order-pending','');this.mergePendingNodes.add(added);}if(removed.hasAttribute?.('data-rt-filter-hidden'))added.setAttribute('data-rt-filter-hidden','');if(removed.hasAttribute?.('data-rt-activity-match'))added.setAttribute('data-rt-activity-match','');}
        else if(this.virtualNodes.get(removed)===added){if(this.filteredNative.has(removed)){this.filteredNative.set(added,this.filteredNative.get(removed));this.filteredNative.delete(removed);}this.virtualNodes.delete(removed);}
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
        if(records.some(record=>!this.ownsMutation(record))){const entries=this.nativeEntries();this.syncNativeOrder(entries);if(this.activityFilter!=='all')this.filterNativeEntries(entries);}
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
      if(this.archiveOnly || context?.kind!=='profile' || this.context?.kind!=='profile' || this.context.username.toLowerCase()!==context.username.toLowerCase() || this.context.view===context.view)return false;
      const tabs=this.feed?.closest('main')?.querySelector('#profile-feed-tabgroup');
      return Boolean(tabs && !tabs.closest('[data-rt-ui]') && this.presentedProfileVisible());
    }
    scan(){
      this.syncProfileNotice();
      const context=pageRoute();
      if(this.settings.postDiscovery && (context?.kind==='post' || context?.kind!=='profile' && !/^\/user\//i.test(location.pathname)) && this.presentedProfileVisible()){this.profileOverlay=true;return;}
      if((this.profileOverlay || this.profileTransition) && context?.key===this.context?.key){this.profileOverlay=false;this.profileTransition=false;if(!this.nativeBatch.active)for(const node of this.nodes.values())if(node.dataset.rtNativeState==='loading')node.dataset.rtNativeState='idle';for(const node of this.activeProfileBatch?.nodes || [])if(node.dataset.rtNativeState==='idle')this.queueNative(node);this.settleProfileBatch();}
      if((!this.settings.postDiscovery && !this.settingsError) || !context || location.hostname==='old.reddit.com'){if(this.host || this.context){if(this.settings.postDiscovery)this.rememberProfile();this.reset();}return;}
      if(this.outgoingProfileVisible(context)){this.profileTransition=true;return;}
      if(this.context?.key===context.key && this.host?.isConnected && (!this.feed || this.feed.isConnected) && (!this.archiveOnly || this.archiveNotice?.isConnected || this.archiveNoticeAnchor?.isConnected)){this.observeNativeLoading();this.observeFeedPresentation();this.ensureActivityMenu();this.maybeRestoreDetail();this.deduplicate();this.drainNative(this.nativeBatch);return;}
      const retainNavigation=Boolean(this.profileNavigation && this.settings.postDiscovery && !this.settingsError);
      this.rememberProfile();this.reset({retainNavigation});
      let main=document.querySelector('main#main-content,main[role="main"],main');
      if(!main && context.kind==='profile'){
        // Unavailable-account pages omit both main and shreddit-feed. Require an
        // explicit native account marker; generic 404/network pages stay native.
        const marker=document.querySelector('shreddit-app > div > img[alt="Deleted user"]');
        const retained=globalThis.RTProfileNoticeGuard?.unavailableNotice?.(),banned=document.querySelector('shreddit-app > #shreddit-forbidden:has(svg[icon-name="ban-fill"])');
        if(retained)main=this.mountArchiveProfile(context,retained.notice,retained.anchor,retained.state);else if(marker && marker.parentElement.querySelector('h3'))main=this.mountArchiveProfile(context,marker.parentElement);else if(banned && /^This account (?:has been (?:banned|suspended)|is suspended)$/i.test(banned.querySelector('#shreddit-forbidden-title')?.textContent.trim()))main=this.mountArchiveProfile(context,banned,banned,'banned');
      }
      if(!main)return;
      let target=context.kind==='profile'?main.querySelector('shreddit-feed,[data-rt-archive-feed]'):main.querySelector('shreddit-post');
      if(!target)return;
      this.context=context;this.feed=context.kind==='profile'?target:null;
      this.batchedProfile=Boolean(this.feed);
      if(this.feed && !this.batchedProfile && typeof IntersectionObserver==='function')this.nativeObserver=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){this.nativeObserver.unobserve(entry.target);this.queueNative(entry.target);}},{rootMargin:'400px'});this.live=new Map();this.archived=new Map();
      const host=this.host=make('section','rt-posts');host.dataset.rtUi='posts';host.setAttribute('aria-label',context.kind==='profile'?'Additional public activity':'Archived post snapshot');
      const toolbar=this.toolbar=make('div','rt-posts-toolbar');
      const noun=context.view==='comments'?'comments':context.view==='overview'?'activity':'posts';
      this.discover=button(this.settingsError?'Retry discovery':context.kind==='profile'?'Discover '+noun:'Check archived post',()=>this.settingsError?this.retrySettings():this.archiveOnly?this.loadArchive():context.kind==='profile'?this.loadReddit():this.loadDetail(),'search');
      this.discover.title=context.kind==='profile'?'Find public '+noun+' through Reddit search, including activity omitted from this profile feed':'Look for a separate archived snapshot without replacing the current post';
      if(context.kind==='post' && !this.settings.archiveDiscovery && !this.settingsError){this.discover.disabled=true;this.discover.title='Enable Arctic Shift archive discovery in Reddit Tweaks to check this post.';}
      this.discover.setAttribute('aria-label',this.discover.textContent);this.discover.textContent='';this.discover.append(glyph(context.kind==='profile'?'refresh':'archive'));
      if(this.archiveOnly){this.discover.setAttribute('aria-label','Search archive');this.discover.title='Find archived public posts and comments for this unavailable account';this.discover.replaceChildren(glyph('archive'));this.discover.disabled=!this.settingsError && !this.settings.archiveDiscovery;}
      toolbar.append(this.discover);
      if(context.kind==='profile' && !this.archiveOnly && this.settings.archiveDiscovery){this.archiveButton=button('Search archive',()=>this.loadArchive(),'archive');this.archiveButton.title='Send this public username to Arctic Shift to look for older snapshots';this.archiveButton.setAttribute('aria-label','Search archive');this.archiveButton.textContent='';this.archiveButton.append(glyph('archive'));toolbar.append(this.archiveButton);}else this.archiveButton=null;
      this.status=make('p','rt-posts-status');this.status.setAttribute('role','status');
      this.results=make('div','rt-posts-results');this.loading=make('div','rt-post-loading');this.loading.hidden=true;this.loading.setAttribute('aria-label','Loading posts');this.loading.append(this.feedLoader());
      this.more=button('Load more',()=>this.batchedProfile?this.advanceProfileBatch(true):this.loadMore());this.more.className='rt-posts-more';this.more.hidden=true;
      toolbar.append(this.status);host.append(toolbar,this.loading,this.results,this.more);
      if(context.kind==='profile'){target.before(host);this.results.hidden=true;this.more.textContent='More discoveries';toolbar.append(this.more);}else target.after(host);
      if(context.kind==='profile'){this.loading.dataset.rtUi='profile-loading';this.loading.slot='load-after';this.feed.append(this.loading);if(typeof IntersectionObserver==='function'){this.batchObserver=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.target===this.loading){this.batchInView=entry.isIntersecting;if(entry.isIntersecting)this.continueProfile();}},{rootMargin:innerHeight*2+'px'});this.batchObserver.observe(this.loading);}}
      if(this.archiveOnly && this.autoDiscover)this.loadNavigation();
      this.emptyFeed=main.querySelector('#empty-feed-content');this.emptyWasHidden=this.emptyFeed?.hidden;
      const restored=context.kind==='profile' && this.restoreProfile(context);
      if(restored)this.render({reuseCards:true});
      this.observeNativeLoading();this.observeFeedPresentation();this.ensureActivityMenu();
      if(this.settingsError)this.setStatus('Discovery settings could not be loaded. Select Retry discovery.',true);
      else if(context.kind==='profile' && this.autoDiscover && !restored)queueMicrotask(()=>{if(this.host===host){if(this.archiveOnly){if(this.settings.archiveDiscovery)this.loadArchive();}else this.loadReddit();}});
      this.maybeRestoreDetail();this.capturePresentedFeed();
    }
    mountArchiveProfile(context,notice,anchor=notice,state='deleted'){
      this.accountState=state;this.archiveOnly=true;this.archiveNotice=notice;this.archiveNoticeAnchor=anchor;
      const layout=this.archiveShell=make('div','grid-container theme-rpl grid flex-nav-expanded');layout.dataset.rtUi='archive-profile';layout.dataset.rtUsername=context.username;layout.dataset.rtAccountState=state;layout.dir='ltr';
      const subgrid=make('div','subgrid-container m:col-start-2 box-border flex flex-col order-2 w-full m:w-[1120px] xs:px-md m:px-lg mx-auto min-h-[calc(100dvh_-_var(--shreddit-header-height))] justify-stretch');subgrid.id='subgrid-container';
      const columns=make('div','main-container gap-lg w-full flex-1 grid place-content-between grid-cols-[minmax(0,1fr)] fixed-sidebar xs:[&.fixed-sidebar]:grid-cols-[minmax(0,756px)_minmax(0,316px)] xs:[&.flex-sidebar]:grid-cols-[minmax(0,756px)_auto]');
      const shell=this.archiveMain=make('main','main w-full min-w-0');shell.id='main-content';
      const header=make('div','px-md relative pt-md flex pb-md items-center'),copy=make('div','w-full min-w-0'),title=make('h1','text-24 font-bold m-0 break-words',context.username),name=make('p','m-0 text-14 text-neutral-content-weak font-semibold','u/'+context.username);
      title.dataset.testid='profile-display-name';name.dataset.testid='profile-prefixed-name';copy.append(title,name);this.avatarSlot=make('div','rt-profile-avatar flex items-center justify-center shrink-0 w-[74px] min-h-4xl overflow-hidden pe-md relative');this.avatarPlaceholder=make('span','flex items-center justify-center text-neutral-content-weak w-4xl h-4xl');this.avatarPlaceholder.setAttribute('role','img');this.avatarPlaceholder.setAttribute('aria-label',(state==='banned'?'Banned or suspended':'Deleted')+' account · Profile picture unavailable');const profileIcon=unavailableAvatar(state);profileIcon.id='profile-icon';profileIcon.dataset.testid='profile-icon';this.avatarPlaceholder.append(profileIcon);this.avatarSlot.append(this.avatarPlaceholder);header.append(this.avatarSlot,copy);
      const tabsContainer=make('div','mx-2xs my-md'),tabs=make('faceplate-tabgroup','nd:flex nd:gap-xs nd:w-fit');tabs.id='profile-feed-tabgroup';tabs.setAttribute('slot','tabs');tabs.setAttribute('for','profile-feed-tabs');
      const views=[['overview','Overview',''],['posts','Posts','submitted/'],['comments','Comments','comments/']],index=views.findIndex(([view])=>view===context.view)+1;tabs.setAttribute('pageindex',String(index));
      for(const [i,[view,label,suffix]] of views.entries()){
        const tab=link('', '/user/'+context.username+'/'+suffix),selected=view===context.view;
        tab.className='button-medium px-[calc(var(--rem12)-var(--button-border-width,0px))] button-plain items-center justify-center button inline-flex';tab.setAttribute('rpl','');tab.setAttribute('slot','page-'+(i+1));tab.id='profile-tab-'+view+'_tab';tab.tabIndex=selected?0:-1;
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
      const target=this.profileNavigation=make('div','contents');target.id='rt-nav-'+crypto.randomUUID();target.dataset.rtUi='profile-navigation';target.dataset.state='idle';const reserve=make('div','left-sidebar theme-rpl order-first hidden m:block');reserve.setAttribute('aria-hidden','true');target.append(reserve);return target;
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
    clearActivityMenu(){
      if(this.activityMain && this.activityOpen)this.activityMain.classList.remove('hidden');
      this.activityMenuObserver?.disconnect();if(this.activityDropdown && this.activityKeydown)this.activityDropdown.removeEventListener('keydown',this.activityKeydown,true);
      for(const row of this.activityMenuRows || [])row.remove();this.activityMenuRows=[];this.activityMenu=null;this.activityMain=null;this.activityDropdown=null;this.activityOpen=false;
    }
    ensureActivityMenu(){
      if(this.context?.kind!=='profile' || !this.toolbar)return;
      const main=this.feed?.closest('main'),dropdown=[...main?.querySelectorAll('rpl-dropdown') || []].find(n=>!n.closest('shreddit-feed') && n.querySelector('button[aria-label="Feed options"]'));
      const menu=dropdown?.querySelector('.main-menu-container') || dropdown?.querySelector('rpl-menu');
      if(dropdown && this.controlsTarget?.isConnected && !this.controlsTarget.contains(dropdown)){this.controlsTarget.remove();this.controlsTarget=null;}
      if(!menu){
        if(!this.autoDiscover || this.controlsTarget?.isConnected)return;
        const target=this.controlsTarget=make('div','flex items-center gap-xs my-md');target.id='rt-controls-'+crypto.randomUUID();target.dataset.rtUi='profile-controls';
        const sort=this.context.view==='comments'?main?.querySelector('shreddit-sort-dropdown'):null,view=main?.querySelector('[aria-label="View"],[data-testid="feed-view-toggle"],shreddit-layout-switcher');if(sort){target.className='contents';sort.before(target);}else if(view && !view.closest('shreddit-feed')){target.className='contents';view.after(target);}else this.host.before(target);
        const generation=this.generation;this.request({action:'render-controls',username:this.context.username,target:target.id}).then(result=>{if(generation!==this.generation)return;if(!result?.rendered)throw Error('Native controls are not ready.');this.ensureActivityMenu();}).catch(()=>{if(generation!==this.generation)return;const retry=button('Retry feed options',()=>{target.remove();this.controlsTarget=null;this.ensureActivityMenu();});retry.className='button button-small button-plain';target.replaceChildren(retry);});return;
      }
      if(this.context.view==='comments'){const sort=main?.querySelector('shreddit-sort-dropdown');if(this.commentSort && this.commentSort.node!==sort){this.commentSort.node.hidden=this.commentSort.hidden;this.commentSort.node.removeAttribute('data-rt-comment-sort-suppressed');this.commentSort=null;}if(sort && !this.commentSort){this.commentSort={node:sort,hidden:sort.hidden};sort.hidden=true;sort.dataset.rtCommentSortSuppressed='true';}}
      if(this.activityMain!==menu){
        this.clearActivityMenu();this.activityMain=menu;this.activityDropdown=dropdown;
        const content=menu.parentElement,sub=this.activityMenu=make('rpl-menu','rt-activity-submenu hidden');sub.dataset.rtUi='activity-filter-option';sub.setAttribute('wrap','');sub.setAttribute('role','menu');
        const row=(label,icon,tail)=>{const el=make('rpl-menu-item','cursor-pointer'),body=make('div','flex justify-between items-center w-full'),caption=make('div','flex items-center gap-xs');for(const [k,v] of Object.entries({size:'medium',appearance:'default',truncate:'both','aria-label':label,'prevent-auto-close':''}))el.setAttribute(k,v);caption.append(glyph(icon),document.createTextNode(label));body.append(caption);if(tail)body.append(glyph(tail));el.tabIndex=-1;el.append(body);return el;};
        const activate=(el,fn)=>{el.addEventListener('click',fn);el.addEventListener('keydown',event=>{if(event.key==='Enter' || event.key===' '){event.preventDefault();event.stopImmediatePropagation();fn(event);}},true);};
        const activity=row('Activity','filter','chevron-right');activity.dataset.rtActivity='true';activity.dataset.rtUi='activity-filter-option';activity.setAttribute('aria-haspopup','menu');
        const show=value=>{this.activityOpen=value;menu.classList.toggle('hidden',value);sub.classList.toggle('hidden',!value);activity.setAttribute('aria-expanded',String(value));(value?sub.querySelector('rpl-menu-item'):activity)?.focus({preventScroll:true});};
        activate(activity,()=>show(true));menu.append(activity);
        const back=row('Back','arrow-back');activate(back,()=>show(false));sub.append(back);
        for(const [value,label,icon] of [['all','All activity','filter'],['hidden','Hidden','hidden'],['deleted','Deleted','deleted']]){const option=row(label,icon);option.dataset.rtActivityFilter=value;activate(option,()=>{if(this.activityFilter!==value){this.activityFilter=value;this.activeProfileBatch=null;this.nativeBatch.queue=this.nativeBatch.queue.filter(node=>{const post=this.postMetadata.get(node.dataset.key);if(post && this.eligibleProfilePost(post,node))return true;node.dataset.rtNativeState='idle';delete node.dataset.rtQualify;return false;});}this.syncActivityPresentation();this.ensureActivityMenu();this.deduplicate();show(false);dropdown.removeAttribute('open');dropdown.querySelector('button[aria-label="Feed options"]')?.focus({preventScroll:true});this.ensureActivityArchive();if(this.batchedProfile)this.advanceProfileBatch(true);});sub.append(option);}
        content.append(sub);this.activityMenuRows=[activity,sub];
        this.activityKeydown=event=>{if(event.key==='Escape' && this.activityOpen){event.preventDefault();event.stopImmediatePropagation();show(false);}};dropdown.addEventListener('keydown',this.activityKeydown,true);
        this.activityMenuObserver=new MutationObserver(()=>{if(!dropdown.hasAttribute('open') && this.activityOpen)show(false);});this.activityMenuObserver.observe(dropdown,{attributes:true,attributeFilter:['open']});
      }
      for(const row of this.activityMenu.querySelectorAll('[data-rt-activity-filter]')){const checked=row.dataset.rtActivityFilter===this.activityFilter;if(row.getAttribute('aria-current')!==String(checked))row.setAttribute('aria-current',String(checked));let mark=row.querySelector('[data-rt-check]');if(checked && !mark){mark=glyph('checkmark');mark.dataset.rtCheck='true';row.firstElementChild.append(mark);}else if(!checked)mark?.remove();}
    }
    ensureActivityArchive(){
      if(this.activityFilter!=='deleted' || !this.settings.archiveDiscovery || this.archiveLoaded || this.activityArchiveAttempted || this.archiveBusy)return;
      this.activityArchiveAttempted=true;this.loadArchive();
    }
    updateActivityEmptyState(){
      if(!this.feed || this.activityFilter==='all'){if(this.activityEmpty)this.activityEmpty.hidden=true;return;}
      const nativeMatches=this.nativeEntries().some(e=>!e.node.hidden && !e.node.hasAttribute('data-rt-filter-hidden'));
      const ownMatches=[...this.nodes.values()].some(n=>!n.hidden && (this.feedSlot(n).parentElement===this.feed));
      const working=this.busy || this.archiveBusy || this.activeProfileBatch || this.metadataPending || this.recoveryActive || this.nativeBatch.active || this.nativeBatch.queue.length || this.nativeFeedLoading();
      const errors=Object.values(this.sourceErrors || {}).some(Boolean) || this.status?.dataset.error==='true';
      const show=!nativeMatches && !ownMatches && !working && !errors && !this.hasMoreProfile() && (this.loaded || this.archiveLoaded);
      if(!show){if(this.activityEmpty)this.activityEmpty.hidden=true;return;}
      if(!this.activityEmpty){const empty=this.activityEmpty=make('div','mt-[100px] flex justify-center items-center flex-col');empty.dataset.rtUi='activity-empty';empty.setAttribute('role','status');
        // Reddit's native rpl empty-state structure; a separate identity keeps the
        // profile privacy-notice guard from capturing this adapted presentation.
        const root=make('div','flex flex-col items-center w-full');root.setAttribute('rpl','');const creative=make('div','w-full flex flex-col items-center overflow-hidden box-border');creative.dataset.testid='empty-state-creative';const image=make('img','mb-0 mt-lg mb-lg');image.src='https://www.redditstatic.com/shreddit/assets/snoo_wave.png';image.alt='Image of a Snoo waving';image.width=128;image.loading='lazy';creative.append(image);
        const body=make('div','flex flex-col w-full items-center box-border px-md gap-md pb-md'),copy=make('div','max-w-[480px] flex flex-col items-center text-center');this.emptyTitle=make('div','text-title-2 text-neutral-content-strong');this.emptyTitle.setAttribute('role','heading');this.emptyTitle.setAttribute('aria-level','2');copy.append(this.emptyTitle,make('div','text-body-1 text-neutral-content-weak','In loaded activity. Search and archive coverage may be incomplete.'));body.append(copy);root.append(creative,body);empty.append(root);const template=globalThis.RTProfileNoticeGuard?.emptyTemplate?.() || this.emptyFeed?.cloneNode(true);if(template?.querySelector('[data-testid="empty-state-creative"]') && template.querySelector('[role="heading"],h2')){empty.className=template.className;empty.replaceChildren(...template.childNodes);for(const child of empty.querySelectorAll('[id]'))child.removeAttribute('id');this.emptyTitle=empty.querySelector('[role="heading"],h2');const description=empty.querySelector('.text-body-1');if(description)description.textContent='In loaded activity. Search and archive coverage may be incomplete.';}this.feed.before(empty);}
      const noun=this.context.view==='comments'?'comments':this.context.view==='posts'?'posts':'posts or comments';const text='No '+this.activityFilter+' '+noun+' found';if(this.emptyTitle.textContent!==text)this.emptyTitle.textContent=text;this.activityEmpty.hidden=false;
    }
    nativeRestrictions(native){const over18=Boolean(native?.matches('[nsfw],[is-nsfw],[over-18]')),spoiler=Boolean(native?.hasAttribute('spoiler'));return {over18,spoiler,restricted:over18 || spoiler || Boolean(native?.querySelector('shreddit-content-gate,[slot="nsfw-blocker"]'))};}
    recoveryInView(node){
      if(!node)return false;const slot=this.feedSlot(node);if(!slot.isConnected || slot.hidden || slot.hasAttribute('data-rt-filter-hidden'))return false;
      const rect=slot.getBoundingClientRect();if(rect.bottom>=0 && rect.top<=innerHeight+200)return true;
      if(typeof IntersectionObserver==='function'){if(!this.recoveryObserver)this.recoveryObserver=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting))this.scheduleRecovery();},{rootMargin:'200px'});if(!this.recoveryObserved.has(slot)){this.recoveryObserved.add(slot);this.recoveryObserver.observe(slot);}}return false;
    }
    scheduleRecovery(){
      if(this.context?.kind!=='profile' || !this.settings.archiveDiscovery || !this.settings.restoreDeletedContent || this.archiveOnly || this.recoveryTimer || this.recoveryActive)return;
      const candidates=new Map();
      for(const post of this.renderedPosts || [])if(this.recoveryInView(this.nodes.get(itemKey(post))) && ['deleted','removed'].includes(this.verifiedStatus(post,this.nodes.get(itemKey(post))?.querySelector('shreddit-post,shreddit-profile-comment'))) && !post.archivedBody && !this.archived.has(itemKey(post)) && !this.recoveryChecked.has(post.fullname))candidates.set(post.fullname,{id:post.id,node:this.nodes.get(itemKey(post)),kind:post.kind==='comment'?'comment':'post',status:this.verifiedStatus(post,this.nodes.get(itemKey(post))?.querySelector('shreddit-post,shreddit-profile-comment'))});
      for(const entry of this.nativeEntries()){const original=this.virtualNodes.get(entry.node) || entry.node,native=original.matches('shreddit-post,shreddit-profile-comment')?original:original.querySelector('shreddit-post,shreddit-profile-comment'),kind=native?.matches('shreddit-profile-comment')?'comment':'post',status=this.verifiedStatus({fullname:entry.fullname,kind,status:'unknown'},native);if(this.recoveryInView(entry.node) && ['deleted','removed'].includes(status) && !this.recoveryChecked.has(entry.fullname) && !this.archived.has(kind==='comment'?entry.fullname:entry.fullname?.replace(/^t3_/,'')))candidates.set(entry.fullname,{id:entry.fullname?.replace(/^t[13]_/,''),kind,status,node:entry.node});}
      if(!candidates.size)return;
      const generation=this.generation,context=this.context;this.recoveryTimer=setTimeout(async()=>{this.recoveryTimer=null;if(generation!==this.generation)return;this.recoveryActive=true;this.updateProfileLoading();
        const current=()=>generation===this.generation && pageRoute()?.key===context.key && this.settings.archiveDiscovery && this.settings.restoreDeletedContent;
        try{for(const kind of ['post','comment']){const group=[...candidates.entries()].filter(([,p])=>p.kind===kind && this.recoveryInView(p.node)).slice(0,25);if(!group.length)continue;for(const [id] of group)this.recoveryChecked.add(id);const result=await this.archive({action:'archive-recover',username:context.username,kind,ids:group.map(([,p])=>p.id)});if(!current())return;for(const raw of result.posts || []){const archived=M.normalizeItem(raw,{source:'arctic-shift'});if(!archived || archived.author.toLowerCase()!==context.username.toLowerCase())continue;const proof=candidates.get(archived.fullname);if(!proof)continue;this.archived.set(itemKey(archived),archived);const existing=this.live.get(itemKey(archived));const restrictions=this.nativeRestrictions(proof.native || proof.node?.querySelector('shreddit-post,shreddit-profile-comment') || proof.node);this.live.set(itemKey(archived),{...archived,...existing,over18:archived.over18 || existing?.over18 || restrictions.over18,spoiler:archived.spoiler || existing?.spoiler || restrictions.spoiler,source:'reddit',status:proof.status,body:'['+(proof.status==='removed'?'removed':'deleted')+']'});}delete this.sourceErrors.recovery;this.render();}}
        catch(error){if(current()){this.sourceErrors.recovery=error.message;this.setStatus('Archived details could not be loaded. Select Refresh activity to retry.',true);}}
        finally{if(generation===this.generation){this.recoveryActive=false;this.updateProfileLoading();this.updateActivityEmptyState();this.scheduleRecovery();}}
      },80);
    }
    verifiedStatus(post,native){
      if(['deleted','removed'].includes(post.status))return post.status;const stored=this.postStatuses.get(post.fullname);
      if(!native)return stored || post.status;const state=native.getAttribute('item-state')?.toLowerCase(),body=native.querySelector(post.kind==='comment'?'[id$="-post-rtjson-content"],.md':'[slot="text-body"]'),text=body?.querySelector('[data-rt-original-text]')?.getAttribute('data-rt-original-text') || body?.textContent?.trim();
      const status=native.hasAttribute('deleted') && native.getAttribute('deleted')!=='false' || state==='deleted' || text==='[deleted]'?'deleted':state==='removed' || text==='[removed]'?'removed':'';if(status)this.postStatuses.set(post.fullname,status);return status || stored || post.status;
    }
    eligibleProfilePost(post,node){
      if(this.activityFilter!=='deleted')return true;
      const status=this.verifiedStatus(post,node?.querySelector('shreddit-post,shreddit-profile-comment'));
      // The archive supplies candidates, never proof of current deletion. Avoid
      // spending the Deleted card budget on known available search results.
      return ['deleted','removed'].includes(status) || status!=='available' && post.source==='arctic-shift';
    }
    matchesActivity(post,node,visible=this.visibleIds()){
      if(this.activityFilter==='all')return true;const status=this.verifiedStatus(post,node?.matches?.('shreddit-post,shreddit-profile-comment')?node:node?.querySelector('shreddit-post,shreddit-profile-comment'));
      return this.activityFilter==='deleted'?['deleted','removed'].includes(status):(post.source==='reddit' || status==='available') && !['deleted','removed'].includes(status) && !visible.has(post.fullname);
    }
    syncActivityPresentation(){
      if(!this.feed)return;if(this.activityFilter==='all')this.feed.removeAttribute('data-rt-activity');else if(this.feed.dataset.rtActivity!==this.activityFilter)this.feed.dataset.rtActivity=this.activityFilter;
    }
    observeFeedPresentation(){
      if(this.feedPresentationObserver || !this.feed)return;const feed=this.feed;
      this.feedPresentationObserver=new MutationObserver(records=>{
        if(this.feed!==feed)return;this.trackVirtualization(records);if(this.context?.key!==pageRoute()?.key){this.scan();return;}if(records.every(r=>this.ownsMutation(r)))return;
        // CSS gates newly inserted native cards immediately. Qualify them in
        // this mutation microtask, before paint, without the general scan delay.
        this.deduplicate();
        if(records.some(r=>r.type==='childList' && [...r.addedNodes].some(n=>n.nodeType===1 && !n.closest?.('[data-rt-ui]'))))this.observeNativeLoading();
        this.updateProfileLoading();
      });
      this.feedPresentationObserver.observe(feed,{childList:true,subtree:true,attributes:true,attributeFilter:['item-state','deleted','removed','hidden','data-feed-element-id','comment-id','id','created-timestamp']});
    }
    filterNativeEntries(entries){
      for(const entry of entries){const node=entry.node,original=this.virtualNodes.get(node) || node,native=original.matches('shreddit-post,shreddit-profile-comment')?original:original.querySelector('shreddit-post,shreddit-profile-comment'),kind=native?.matches('shreddit-profile-comment')?'comment':'post',post={fullname:entry.fullname,kind,status:'unknown',source:'reddit'};
        if(this.activityFilter==='all'){if(this.filteredNative.has(node)){const hidden=this.filteredNative.get(node);node.hidden=hidden;if(original!==node)original.hidden=hidden;this.filteredNative.delete(node);}node.removeAttribute('data-rt-filter-hidden');node.removeAttribute('data-rt-activity-match');if(original!==node){original.removeAttribute('data-rt-filter-hidden');original.removeAttribute('data-rt-activity-match');}continue;}if(!this.filteredNative.has(node))this.filteredNative.set(node,node.hidden);const hidden=this.activityFilter==='hidden' || !['deleted','removed'].includes(this.verifiedStatus(post,native));if(node.hidden!==hidden)node.hidden=hidden;node.toggleAttribute('data-rt-filter-hidden',hidden);node.toggleAttribute('data-rt-activity-match',!hidden);if(original!==node){original.toggleAttribute('data-rt-filter-hidden',hidden);original.toggleAttribute('data-rt-activity-match',!hidden);}}
    }
    updateArchiveSummary(){if(!this.archiveStats)return;const posts=this.renderedPosts || [],times=posts.map(p=>p.created),date=value=>new Date(value*1000).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});const set=(key,value)=>{if(this.archiveStats[key].textContent!==value)this.archiveStats[key].textContent=value;};set('posts',String(posts.filter(p=>p.kind!=='comment').length));set('comments',String(posts.filter(p=>p.kind==='comment').length));set('oldest',times.length?date(Math.min(...times)):'—');set('newest',times.length?date(Math.max(...times)):'—');}
    retrySettings(){this.reset();return this.loadSettings();}
    kinds(){return this.context.view==='overview'?['post','comment']:[this.context.view==='comments'?'comment':'post'];}
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
      const applies=key=>this.activityFilter!=='deleted' || key.startsWith('archive-');
      let floor=-Infinity;
      for(const key of this.sourcePending)if(applies(key) && !this.sourceFrontiers.has(key))return Infinity;
      // Archive Top pages are chronological, not score-ordered. Only New
      // has a comparable continuation boundary across every provider.
      if(this.context.sort!=='new')return [...this.sourcePending].some(applies)?Infinity:-Infinity;
      for(const [key,state] of this.sourceFrontiers)if(applies(key) && state.more)floor=Math.max(floor,state.floor);
      return floor;
    }
    canPublishProfilePost(post){return (this.context.sort==='top'?post.score:post.created)>=this.publicationFloor();}
    nativeContinuation(){
      const candidates=[...this.feed.querySelectorAll('faceplate-partial[slot="load-after"]:is([loading="lazy"],[loading="programmatic"])[src],shreddit-feed-load-more-observer[cursor]')].filter(node=>!node.closest('[data-rt-ui],shreddit-post,shreddit-profile-comment'));
      return candidates.filter(node=>node.matches('faceplate-partial')).at(-1) || candidates.at(-1) || null;
    }
    syncNativeOrder(entries){
      if(!this.feed)return;
      const enabled=this.context.sort==='new' && this.activityFilter==='all' && (this.autoDiscover || this.loaded || this.archiveLoaded),visible=new Set(entries.map(entry=>entry.fullname));
      let boundary=enabled?this.publicationFloor():-Infinity;
      if(enabled && this.autoDiscover && !this.loaded && !this.archiveLoaded && !this.primaryFailure())boundary=Infinity;
      if(enabled){const next=this.renderedPosts.find(post=>!visible.has(post.fullname) && !this.publishedCards.has(itemKey(post)));if(next)boundary=Math.max(boundary,next.created);}
      const previous=this.mergePendingNodes;this.mergePendingNodes=new Set();let waiting=false;
      for(const entry of entries){const original=this.virtualNodes.get(entry.node) || entry.node,pending=enabled && !entry.pinned && Number.isFinite(entry.timestamp) && !this.publishedNative.has(original) && entry.timestamp<=boundary;
        for(const node of new Set([entry.node,original])){node.toggleAttribute('data-rt-order-pending',pending);if(pending)this.mergePendingNodes.add(node);}
        if(pending)waiting=true;else if(enabled && (entry.pinned || Number.isFinite(entry.timestamp)))this.publishedNative.add(original);
      }
      for(const node of previous)if(!this.mergePendingNodes.has(node))node.removeAttribute('data-rt-order-pending');
      // Keep Reddit's retained cards, but pause its next pager while our search
      // has not covered their dates. Otherwise invisible native pages can walk
      // ahead endlessly without increasing the displayed combined prefix.
      this.feed.toggleAttribute('data-rt-merge-waiting',waiting);
    }
    nativeEntries(){
      if(!this.feed)return [];
      this.flushVirtualization();
      const entries=[];
      for(const slot of this.feed.children){
        const node=this.virtualNodes.get(slot) || slot;
        if(node.dataset.rtUi)continue;
        const content=node.matches('shreddit-post,shreddit-profile-comment')?node:node.querySelector('shreddit-post,shreddit-profile-comment');
        if(!content)continue;
        const fullname=content.getAttribute('comment-id') || content.getAttribute('data-feed-element-id') || content.id;
        const timestamp=Date.parse(content.getAttribute('created-timestamp') || content.querySelector('faceplate-timeago[ts]')?.getAttribute('ts'))/1000;
        const rawScore=content.getAttribute('score') ?? content.querySelector('shreddit-comment-action-row[score]')?.getAttribute('score') ?? content.querySelector('faceplate-number[number]')?.getAttribute('number');
        entries.push({node:slot,fullname,timestamp,score:rawScore==null?NaN:Number(rawScore),pinned:content.hasAttribute('stickied')});
      }
      return entries;
    }
    visibleIds(){
      const ids=new Set(this.nativeEntries().map(e=>e.fullname).filter(Boolean));
      for(const element of document.querySelectorAll('shreddit-post[id],shreddit-profile-comment[comment-id],[data-testid="post-container"][data-fullname]')){
        if(element.closest('[data-rt-ui]'))continue;ids.add(element.getAttribute('comment-id') || element.getAttribute('data-fullname') || element.id);
      }
      return ids;
    }
    deduplicate(){
      if(!this.host || this.context.kind!=='profile')return;
      return this.withFeedViewport(()=>{
      this.syncActivityPresentation();
      const entries=this.nativeEntries(),visible=this.visibleIds(),sort=this.context.sort,normal=entries.filter(e=>!e.pinned && (sort==='top'?Number.isFinite(e.score):sort==='hot' || Number.isFinite(e.timestamp))),rank=new Map(this.renderedPosts.map((post,index)=>[post.fullname,index]));
      this.syncNativeOrder(entries);
      const continuation=this.nativeContinuation();
      const horizon=continuation && sort!=='hot'?(normal.length?Math.min(...normal.map(e=>sort==='top'?e.score:Math.floor(e.timestamp))):sort==='new'?Infinity:-Infinity):-Infinity;
      const nativeTail=continuation?(()=>{let n=continuation;while(n.parentElement && n.parentElement!==this.feed)n=n.parentElement;return n.parentElement===this.feed?n:null;})():null;
      // Our sentinel is also a real tail. Using null here appended stable
      // cards past it on every scan, then moved the sentinel back again. Those
      // remove/reinsert cycles disrupt native virtualization and scroll anchors.
      const tail=nativeTail || (this.loading?.parentElement===this.feed?this.loading:null);
      const buckets=new Map();let count=0,deferred=0;
      for(const post of this.renderedPosts || []){
        const node=this.nodes.get(itemKey(post));if(!node)continue;
        const slot=this.feedSlot(node),virtualized=slot!==node;
        const pendingDuplicate=this.publishedCards.has(itemKey(post)) && entries.some(entry=>entry.fullname===post.fullname && entry.node.hasAttribute('data-rt-order-pending'));
        const duplicate=visible.has(post.fullname) && !pendingDuplicate,older=this.activityFilter==='all' && !duplicate && !this.publishedCards.has(itemKey(post)) && (sort==='top'?post.score:post.created)<horizon;
        const staged=this.batchedProfile && (!this.publishedCards.has(itemKey(post)) || !['ready','failed'].includes(node.dataset.rtNativeState));const matches=this.matchesActivity(post,node,visible),qualify=this.activityFilter==='deleted' && !duplicate && !older && !staged && !['deleted','removed'].includes(this.verifiedStatus(post,node.querySelector('shreddit-post,shreddit-profile-comment'))) && node.dataset.rtNativeState==='idle';node.hidden=duplicate || older || staged || !matches;
        if(qualify){node.dataset.rtQualify='true';this.queueNative(node);}node.dataset.deferred=older?'older':'';
        if(virtualized)slot.hidden=node.hidden;
        if(node.hidden){if(duplicate){const entry=entries.find(e=>e.fullname===post.fullname),original=this.virtualNodes.get(entry?.node) || entry?.node,native=original?.matches('shreddit-post,shreddit-profile-comment')?original:original?.querySelector('shreddit-post,shreddit-profile-comment');if(native && this.recoverBody(post,native)){this.nativeDecorations.add(native);this.decorateNative(post,native);}}this.nativeObserver?.unobserve(node);if(older)deferred++;if(!virtualized && !this.publishedCards.has(itemKey(post)) && node.parentElement!==this.results)this.results.append(node);continue;}
        count++;
        // A newly fetched native duplicate may still be behind the merge gate.
        // Retain its displayed peer in the same slot until native handoff.
        if(pendingDuplicate && slot.parentElement===this.feed)continue;
        const target=normal.find(entry=>sort==='top'?entry.score<=post.score:sort==='hot'?rank.has(entry.fullname) && rank.get(entry.fullname)>rank.get(post.fullname):entry.timestamp<=post.created)?.node || tail;
        if(!buckets.has(target))buckets.set(target,[]);buckets.get(target).push(slot);
      }
      // Reconcile only extension-owned cards. Reddit retains ownership and order of its nodes.
      for(const [target,nodes] of buckets){let anchor=target;for(let i=nodes.length-1;i>=0;i--){const node=nodes[i];if(!this.virtualNodes.has(node) && (node.parentElement!==this.feed || node.nextElementSibling!==anchor))this.feed.insertBefore(node,anchor);anchor=node;}}
      for(const nodes of buckets.values())for(const node of nodes)if(node.dataset.rtNativeState==='idle'){if(this.nativeObserver)this.nativeObserver.observe(node);else this.queueNative(node);}
      this.filterNativeEntries(entries);this.summaryCounts={count,deferred};this.updateActivityEmptyState();this.scheduleRecovery();
      if(this.emptyFeed){this.emptyFeed.hidden=this.activityFilter!=='all' || count>0 || this.emptyWasHidden;this.emptyFeed.toggleAttribute('data-rt-empty-suppressed',count>0);}
      if(!this.busy && this.status.dataset.error!=='true')this.summarize();this.updateProfileLoading();this.capturePresentedFeed();
      });
    }
    summarize(){
      const {count=0,deferred=0}=this.summaryCounts || {},noun=this.context.view==='comments'?(count===1?'comment':'comments'):this.context.view==='overview'?(count===1?'item':'items'):count===1?'post':'posts';
      const errors=Object.entries(this.sourceErrors || {}).filter(([key,value])=>value && !key.startsWith('metadata-')).map(([,value])=>value);this.setStatus(errors.length?errors.join(' '):this.nativeBatch.blocked?'Reddit is limiting card requests. Select Refresh activity to retry.':count?`${count} ${this.archiveOnly?'archived':'additional'} ${noun}`:'Activity checked',errors.length>0 || this.nativeBatch.blocked===true);
      if(this.archiveOnly)this.updateArchiveSummary();
      if(this.archiveOnly && this.settings.archiveDiscovery){this.archiveEmpty.hidden=this.activityFilter!=='all' || !this.archiveLoaded || count>0 || this.renderedPosts.length>0;this.archiveEmpty.textContent='No archived activity found for this username. Archive coverage may be incomplete.';}
      this.status.title=(deferred?`${deferred} older discoveries will appear when Reddit loads that part of the feed. `:'')+[...new Set(Object.entries(this.sourceErrors || {}).filter(([key,value])=>key.startsWith('metadata-') && value).map(([,value])=>value)),'Search and archive coverage may be incomplete.'].join(' ');
    }
    setStatus(text,error=false){this.status.textContent=text;this.status.dataset.error=String(error);}
    async request(parameters){const controller=new AbortController();let started=Date.now(),timeoutRetries=0;this.controllers.add(controller);try{
      for(;;){
        if(Date.now()-started>=10000)throw Error('Reddit requests are paused. Please try again shortly.');
        let result;try{result=await this.reddit(parameters,controller.signal);}catch(error){
          // Retry the same discovery cursor once after a transport timeout.
          // Rate limits, cancellation and parsing errors must not be retried.
          if(parameters.action==='profile' && !controller.signal.aborted && timeoutRetries<1 && /^(Reddit request timed out\. Try again\.|Public posts took too long to load\. Try again\.)$/.test(error.message)){timeoutRetries++;started=Date.now();continue;}throw error;
        }if(!result?.deferred || parameters.action==='render-card')return result;
        const remaining=10000-(Date.now()-started);if(remaining<=0)throw Error('Reddit requests are paused. Please try again shortly.');
        await new Promise((resolve,reject)=>{const cancel=()=>{clearTimeout(timer);reject(Error('Post request cancelled.'));},timer=setTimeout(()=>{controller.signal.removeEventListener('abort',cancel);resolve();},Math.min(remaining,Math.max(100,Number(result.retryAfterMs)||1000)));controller.signal.addEventListener('abort',cancel,{once:true});if(controller.signal.aborted)cancel();});
      }
    }finally{this.controllers.delete(controller);}}
    async run(task){
      if(this.busy)return;this.batchAutoPaused=false;const generation=this.generation;this.busy=true;this.host.setAttribute('aria-busy','true');this.setStatus('Checking public activity…');this.updateProfileLoading();this.discover.disabled=true;if(this.archiveButton)this.archiveButton.disabled=true;this.more.disabled=true;this.updateActivityEmptyState();
      try{await task(()=>generation===this.generation && pageRoute()?.key===this.context?.key && this.host?.isConnected);}
      catch(error){if(generation===this.generation && pageRoute()?.key===this.context?.key){this.sourceErrors.request=error.message;this.setStatus(error.message,true);}}
      finally{if(generation===this.generation){this.busy=false;this.host.removeAttribute('aria-busy');this.more.disabled=false;if(this.feed){this.batchAutoPaused=this.primaryFailure();this.updateProfileLoading();this.updateActivityEmptyState();}else this.loading.hidden=true;this.discover.disabled=this.archiveBusy;if(this.archiveButton)this.archiveButton.disabled=this.archiveBusy;this.ensureActivityArchive();}}
    }
    loadReddit({more=false}={}){if(this.busy)return;if(!more){this.initialPrefetchDone=false;this.pages=0;this.recoveryChecked.clear();this.sourceErrors={};}if(this.archiveOnly)return this.loadArchive({more});if(this.nativeBatch?.blocked){this.nativeBatch.blocked=false;this.nativeBatch.serverRetryAt=0;this.drainNative(this.nativeBatch);}
      const frontier=this.publicationFloor(),streams=this.kinds().flatMap(kind=>kind==='comment'?[{kind,key:'comment',stream:'authenticated'},{kind,key:'comment-public',stream:'public'}]:[{kind,key:kind}]).filter(({key})=>!more || this.redMore[key] && (this.context.sort!=='new' || (this.sourceFrontiers.get(key)?.floor ?? Infinity)>=frontier));
      for(const {key} of streams){if(!more)this.sourceFrontiers.delete(key);this.sourcePending.add(key);}
      return this.run(async current=>{
      const errors=[];let succeeded=false;
      await Promise.all(streams.map(async ({kind,key,stream})=>{
        if(more && !this.redMore[key])return;
        const old=more?this.afterByKind[key]:null;this.pages++;
        try{const result=await this.request({action:'profile',username:this.context.username,sort:this.context.sort,range:this.context.range,kind,...(stream?{stream}:{}),...(old?{after:old}:{})});if(!current())return;
          const incoming=new Map(),page=[];for(const raw of result.posts || []){const p=M.normalizeItem(raw,{source:'reddit'});if(!p || p.author.toLowerCase()!==this.context.username.toLowerCase())continue;page.push(p);const id=itemKey(p),previous=this.live.get(id);
            if(stream==='public' && previous && this.commentOrigins.get(id)!=='public'){this.live.set(id,{...previous,over18:previous.over18 || p.over18,spoiler:previous.spoiler || p.spoiler});continue;}
            const merged=previous?{...p,over18:previous.over18 || p.over18,spoiler:previous.spoiler || p.spoiler}:p;this.live.set(id,merged);incoming.set(id,merged);if(kind==='comment')this.commentOrigins.set(id,stream);
          }
          if(!more && this.context.sort==='hot' && stream!=='public'){
            const belongs=post=>(post.kind==='comment'?'comment':'post')===kind,group=new Map([...incoming,...[...this.live].filter(([id,p])=>belongs(p) && !incoming.has(id))]);
            this.live=new Map(this.kinds().flatMap(type=>type===kind?[...group]:[...this.live].filter(([,p])=>(p.kind==='comment'?'comment':'post')===type)));
          }
          this.afterByKind[key]=result.after;this.redMore[key]=Boolean(result.hasMore && result.after && result.after!==old);this.noteSourcePage(key,page,this.redMore[key]);succeeded=true;this.loaded=true;delete this.sourceErrors[key];this.moreReddit=Object.values(this.redMore).some(Boolean);this.render();
        }catch(error){if(!current())return;this.redMore[key]=false;this.noteSourcePage(key,[],false);this.sourceErrors[key]=error.message;errors.push((stream==='public'?'Public comments: ':kind==='comment'?'Comments: ':'Posts: ')+error.message);}
        finally{if(current())this.sourcePending.delete(key);}
      }));
      if(!current())return;
      this.after=this.afterByKind.post;this.moreReddit=Object.values(this.redMore).some(Boolean);this.loaded=succeeded || this.loaded;this.render();
      if(errors.length)this.setStatus(errors.join(' '),true);
      this.discover.setAttribute('aria-label','Refresh activity');
    });}
    async verifyArchiveStatuses(page,kind,current){
      this.metadataPending++;let unknown=false;
      try{
        // Return evidence as each native request pair completes. A slow later
        // fragment must not hide already verified deleted activity for 10s.
        for(let offset=0;offset<page.length && current();offset+=2){
          const batch=page.slice(offset,offset+2),result=await this.request({action:'status',username:this.context.username,kind,ids:batch.map(p=>p.id)});if(!current())return;
          const requested=new Map(batch.map(p=>[p.fullname,p])),verified=new Set();
          for(const evidence of result.statuses || []){const post=requested.get(evidence.fullname);if(!post || !['available','deleted','removed'].includes(evidence.status))continue;verified.add(post.fullname);this.postStatuses.set(post.fullname,evidence.status);if(evidence.over18 || evidence.spoiler)this.archived.set(itemKey(post),{...this.archived.get(itemKey(post)),over18:post.over18 || evidence.over18===true,spoiler:post.spoiler || evidence.spoiler===true});}
          unknown=unknown || verified.size<batch.length;
          if(unknown)this.sourceErrors['metadata-'+kind]='Some archive items have unverified current Reddit status.';else delete this.sourceErrors['metadata-'+kind];this.render();
        }
      }catch{if(current()){this.sourceErrors['metadata-'+kind]='Some archive items have unverified current Reddit status.';this.summarize();}}
      finally{if(current()){this.metadataPending--;this.updateProfileLoading();this.updateActivityEmptyState();}}
    }
    async loadArchive({more=false}={}){
      if(!this.settings.archiveDiscovery || this.archiveBusy)return;
      if(!more){this.initialPrefetchDone=false;if(!this.busy)this.pages=0;for(const key of Object.keys(this.sourceErrors))if(key.startsWith('archive-'))delete this.sourceErrors[key];}
      const generation=this.generation,current=()=>generation===this.generation && pageRoute()?.key===this.context?.key && this.host?.isConnected;
      const frontier=this.publicationFloor(),kinds=this.kinds().filter(kind=>!more || this.archiveMore[kind] && (this.context.sort!=='new' || (this.sourceFrontiers.get('archive-'+kind)?.floor ?? Infinity)>=frontier));for(const kind of kinds){if(!more)this.sourceFrontiers.delete('archive-'+kind);this.sourcePending.add('archive-'+kind);}
      this.archiveBusy=true;this.batchAutoPaused=false;this.setStatus('Checking archived activity…');this.updateProfileLoading();this.discover.disabled=true;if(this.archiveButton)this.archiveButton.disabled=true;this.more.disabled=true;this.updateActivityEmptyState();
      try{
        const warnings=[];
        await Promise.all(kinds.map(async kind=>{
          this.pages++;
          try{const before=more?this.beforeByKind[kind]:null,result=await this.archive({action:'archive-profile',username:this.context.username,kind,...(before?{before}:{})});if(!current())return;
            const page=[];for(const raw of result.posts || []){const p=M.normalizeItem(raw,{source:'arctic-shift'});if(p){this.archived.set(itemKey(p),p);page.push(p);}}
            this.beforeByKind[kind]=result.before;this.archiveMore[kind]=Boolean(result.hasMore && !result.cursorStalled);this.archiveLoaded=true;this.moreArchive=Object.values(this.archiveMore).some(Boolean);this.noteSourcePage('archive-'+kind,page,this.archiveMore[kind]);
            delete this.sourceErrors['archive-'+kind];this.render();
            if(page.length && !this.archiveOnly)this.verifyArchiveStatuses(page,kind,current);
            if(result.cursorStalled){this.sourceErrors['archive-'+kind]='Archive pagination stopped at an ambiguous timestamp. History is incomplete.';warnings.push(this.sourceErrors['archive-'+kind]);}
          }catch(error){if(!current())return;this.archiveMore[kind]=false;this.noteSourcePage('archive-'+kind,[],false);this.sourceErrors['archive-'+kind]=error.message;warnings.push(error.message);}
          finally{if(current())this.sourcePending.delete('archive-'+kind);}
        }));
        if(!current())return;
        this.moreArchive=Object.values(this.archiveMore).some(Boolean);this.render();if(warnings.length)this.setStatus(warnings.join(' '),true);
      }finally{if(generation===this.generation){this.archiveBusy=false;this.discover.disabled=this.busy;if(this.archiveButton)this.archiveButton.disabled=this.busy;this.more.disabled=this.busy;if(this.feed){this.batchAutoPaused=this.primaryFailure();this.updateProfileLoading();this.updateActivityEmptyState();}else this.loading.hidden=true;}}
    }
    hasMoreProfile(){return this.activityFilter==='deleted' && this.settings.archiveDiscovery?this.moreArchive:this.moreReddit || this.moreArchive;}
    loadMore(){
      if(this.batchedProfile)this.forceProfileBatch=true;
      if(this.activityFilter==='deleted' && this.settings.archiveDiscovery)return !this.metadataPending && this.moreArchive?this.loadArchive({more:true}):undefined;
      const floor=this.publicationFloor(),archiveFirst=this.context.sort==='new' && this.moreArchive && [...this.sourceFrontiers].some(([key,state])=>key.startsWith('archive-') && state.more && state.floor>=floor);
      return archiveFirst?this.loadArchive({more:true}):this.moreReddit?this.loadReddit({more:true}):this.loadArchive({more:true});
    }
    captureFeedViewport(){
      if(!this.feed || window.scrollY<=0)return null;
      for(const node of this.feed.children){if(node.hidden || node===this.loading)continue;const rect=node.getBoundingClientRect();if(rect.height>0 && rect.bottom>56 && rect.top<innerHeight)return {node,top:rect.top,scrollY:window.scrollY};}
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
      return this.withFeedViewport(()=>{
      this.renderVersion=(this.renderVersion || 0)+1;
      const posts=M.mergePosts([...this.live.values()],[...this.archived.values()],{username:this.context.username,visibleIds:this.visibleIds(),sort:this.context.sort,range:this.context.range});
      for(const post of posts){const key=itemKey(post);this.postMetadata.set(key,post);const previous=this.nodes.get(key);if(previous){if(reuseCards)continue;if(previous.dataset.rtArchiveFallback==='true'){this.renderArchivedNative(post,previous);this.decorateNative(post,previous);}else if(previous.dataset.rtNativeState==='ready')this.decorateNative(post,previous);continue;}const node=this.card(post);this.results.append(node);this.nodes.set(key,node);}
      this.renderedPosts=posts;
      this.deduplicate();this.more.hidden=!this.hasMoreProfile();
      this.summarize();this.updateProfileLoading();this.updateActivityEmptyState();if(this.activeProfileBatch)this.settleProfileBatch();if(this.batchedProfile)this.advanceProfileBatch(this.forceProfileBatch===true);this.forceProfileBatch=false;
      });
    }
    pendingProfilePosts(){
      const visible=this.visibleIds();return this.renderedPosts.filter(post=>{const node=this.nodes.get(itemKey(post));return node && this.eligibleProfilePost(post,node) && this.canPublishProfilePost(post) && (!this.publishedCards.has(itemKey(post)) || !['ready','failed'].includes(node.dataset.rtNativeState)) && !visible.has(post.fullname) && node.dataset.deferred!=='older';});
    }
    profileTailVisible(){const rect=this.loading.getBoundingClientRect();return this.batchInView && rect.top<=innerHeight*3 && rect.bottom>=0;}
    primaryFailure(){return Object.entries(this.sourceErrors || {}).some(([key,value])=>value && !/^(metadata-|recovery$)/.test(key) && !(['post','comment','comment-public'].includes(key) && Object.values(this.redMore).some(Boolean)));}
    prefetchProfilePage(){
      if(pageRoute()?.key!==this.context?.key || this.busy || this.archiveBusy || this.metadataPending || this.batchAutoPaused || this.primaryFailure() || this.nativeBatch.blocked || !this.batchObserver || !this.hasMoreProfile())return;
      const initial=this.autoDiscover && (this.loaded || this.archiveLoaded) && !this.initialPrefetchDone;
      if(!initial && !this.profileTailVisible())return;
      // Prime one additional cursor page on initial automatic discovery. Later
      // reads start two viewports ahead even between hydration batches. Keep
      // one bounded unpublished buffer, including native-horizon deferrals.
      const visible=this.visibleIds(),buffered=this.renderedPosts.filter(post=>!this.publishedCards.has(itemKey(post)) && !visible.has(post.fullname)).length;
      if(buffered<profileBatchSize){if(initial)this.initialPrefetchDone=true;this.loadMore();}
    }
    continueProfile(force=false){
      // A native continuation halo can remain mounted before its request starts.
      // It owns the visible loader, but must not block preparing our next page.
      if(this.busy || this.archiveBusy)return;
      if(this.batchedProfile){this.prefetchProfilePage();return this.advanceProfileBatch(force);}
      if(this.hasMoreProfile() && !this.batchAutoPaused)this.loadMore();
    }
    updateProfileLoading(){
      if(!this.feed || !this.loading)return;
      return this.withFeedViewport(()=>{
      const pending=this.batchedProfile && this.pendingProfilePosts().length>0,more=this.hasMoreProfile();
      const paused=this.nativeBatch.blocked || (this.batchAutoPaused || this.primaryFailure()) && !pending && !this.activeProfileBatch;
      const work=this.busy || this.archiveBusy || this.activeProfileBatch || this.nativeBatch.active || this.nativeBatch.queue.length || this.metadataPending || this.recoveryActive;
      const continuation=Boolean(work || pending || more || this.mergePendingNodes.size);
      if(this.loading.parentElement!==this.feed || this.loading!==this.feed.lastElementChild)this.feed.append(this.loading);
      const nativeLoading=this.nativeFeedLoading();if(this.loading.hidden===continuation)this.loading.hidden=!continuation;
      if(this.feed.dataset.rtLoadingOwner!==(nativeLoading?'native':'extension'))this.feed.dataset.rtLoadingOwner=nativeLoading?'native':'extension';
      const halo=this.loading.querySelector('.rt-native-loading');if(halo && halo.hidden!==(nativeLoading || paused && !work))halo.hidden=nativeLoading || paused && !work;
      let note=this.loading.querySelector('[data-rt-continuation-note]');
      if(paused && !work){if(!note){note=make('div','flex flex-col items-center justify-center text-center m-md text-body-1');note.dataset.rtContinuationNote='true';this.loading.append(note);}const message='Loading paused. Use Refresh activity to retry.';if(note.dataset.message!==message){note.dataset.message=message;const retry=button('Retry loading',()=>this.discover.click());retry.className='button button-small button-bordered mt-md';note.replaceChildren(make('div','',message),retry);}}else note?.remove();
      this.more.hidden=!continuation || Boolean(this.batchObserver && !paused);this.more.disabled=Boolean(this.busy || this.archiveBusy || this.activeProfileBatch && !paused);
      if(pending && !this.activeProfileBatch && !this.busy && !paused && this.publishedCards.size<profileBatchSize){this.advanceProfileBatch();return;}
      this.prefetchProfilePage();
      if(!this.activeProfileBatch && !this.busy && !this.archiveBusy && !this.metadataPending && !paused && this.batchObserver && !this.loading.hidden && !this.batchFrame){const generation=this.generation;this.batchFrame=requestAnimationFrame(()=>{this.batchFrame=null;if(generation===this.generation && this.host?.isConnected && this.profileTailVisible())this.continueProfile();});}
      this.updateActivityEmptyState();
      });
    }
    advanceProfileBatch(force=false){
      if(!this.batchedProfile || pageRoute()?.key!==this.context?.key)return;
      if(force){this.batchAutoPaused=false;if(this.nativeBatch.blocked){this.nativeBatch.blocked=false;this.nativeBatch.serverRetryAt=0;this.drainNative(this.nativeBatch);}}
      if(this.activeProfileBatch || this.nativeBatch.blocked || this.batchAutoPaused && !this.pendingProfilePosts().length)return;
      if(!force && this.publishedCards.size>=profileBatchSize && (!this.batchObserver || !this.profileTailVisible()))return;
      const posts=this.pendingProfilePosts().slice(0,profileBatchSize);
      if(!posts.length){const visible=this.visibleIds(),waitingBoundary=this.renderedPosts.some(p=>!visible.has(p.fullname) && !this.publishedCards.has(itemKey(p)) && this.nodes.get(itemKey(p))?.dataset.deferred!=='older' && this.eligibleProfilePost(p,this.nodes.get(itemKey(p))) && !this.canPublishProfilePost(p));if(!waitingBoundary && !this.mergePendingNodes.size && this.renderedPosts.some(p=>this.nodes.get(itemKey(p))?.dataset.deferred==='older'))return;if(!this.busy && this.hasMoreProfile() && (force || this.batchObserver && this.profileTailVisible()))this.loadMore();return;}
      const group=this.activeProfileBatch={generation:this.generation,nodes:posts.map(p=>this.nodes.get(itemKey(p))),posts,enriching:false};this.loading.hidden=false;
      for(const node of group.nodes)if(!['ready','failed'].includes(node.dataset.rtNativeState))this.queueNative(node);
      this.settleProfileBatch();
    }
    settleProfileBatch(){
      const group=this.activeProfileBatch;if(!group || group.enriching || group.generation!==this.generation || pageRoute()?.key!==this.context?.key)return;
      const visible=this.visibleIds();let ready=0;
      while(ready<group.nodes.length && this.canPublishProfilePost(this.postMetadata.get(group.nodes[ready].dataset.key)) && (['ready','failed'].includes(group.nodes[ready].dataset.rtNativeState) || visible.has(group.nodes[ready].dataset.fullname)))ready++;
      if(!ready)return;
      // Publish only the ready prefix. A slow later card cannot hold earlier
      // content behind a whole-page barrier or reorder the feed on completion.
      for(const node of group.nodes.splice(0,ready)){this.publishedCards.add(node.dataset.key);node.classList.add('rt-native-enter');setTimeout(()=>node.classList.remove('rt-native-enter'),200);}
      if(!group.nodes.length){group.enriching=true;this.activeProfileBatch=null;const current=()=>group.generation===this.generation && pageRoute()?.key===this.context?.key && this.host?.isConnected;this.replyEnrichment=Promise.resolve(this.replyEnrichment).catch(()=>{}).then(()=>current()?this.enrichReplyContexts(group.posts,current):undefined);}
      this.deduplicate();this.updateProfileLoading();
    }
    indicator(post){
      const removed=['deleted','removed'].includes(post.status),label=removed?`${post.status==='deleted'?'Deleted':'Removed'} on Reddit`:post.source==='arctic-shift'?(post.status==='available'?'Not shown in this profile feed · Available on Reddit · Arctic Shift snapshot':'Arctic Shift snapshot · Current Reddit status unknown'):'Not shown in this profile feed · Found through public Reddit search';
      const badge=make('span','rt-post-indicator');badge.setAttribute('role','img');badge.setAttribute('aria-label',label);badge.title=label;badge.dataset.state=post.status;badge.append(glyph(removed?post.status:post.source==='arctic-shift' && post.status!=='available'?'archive':'hidden'));return badge;
    }
    snapshot(text){const details=make('details','rt-post-snapshot');details.title='Text recovered from Arctic Shift · May differ from the current post';details.open=this.settings.restoreDeletedContent===true;details.append(make('summary','','Recovered text'),make('pre','',text));return details;}
    communityAvatar(subreddit){
      const avatar=make('span','inline-flex items-center justify-center w-lg h-lg relative shrink-0');avatar.setAttribute('avatar','');
      const href='/r/'+subreddit.toLowerCase()+'/',sample=[...document.querySelectorAll('shreddit-post[subreddit-name]')].find(n=>n.getAttribute('subreddit-name')?.toLowerCase()===subreddit.toLowerCase()),hint=sample?.querySelector('[slot="credit-bar"] [avatar] img[src]') || [...document.querySelectorAll('a[href]')].find(a=>{try{return new URL(a.getAttribute('href'),location.origin).pathname.toLowerCase()===href && a.querySelector('img[src]');}catch{return false;}})?.querySelector('img[src]'),url=M.avatarUrl(hint?.getAttribute('src'));
      if(url){const image=make('img','mb-0 rounded-full overflow-hidden w-full h-full');image.src=url;image.alt='';image.width=image.height=24;image.loading='lazy';avatar.append(image);return avatar;}
      const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');for(const [key,value] of Object.entries({rpl:'',fill:'currentColor',height:'24',width:'24',viewBox:'0 0 20 20','icon-name':'community-fill','aria-hidden':'true'}))icon.setAttribute(key,value);
      const path=document.createElementNS(icon.namespaceURI,'path');path.setAttribute('d','M11.977 13.79h-1.955l4.549-10.715a.81.81 0 00-.381-1.032C12.447 1.12 10.37.747 8.179 1.18c-3.612.716-6.471 3.68-7.059 7.316a9.01 9.01 0 0010.409 10.377c3.735-.616 6.741-3.635 7.347-7.371.453-2.8-.388-5.405-2.017-7.322a.505.505 0 00-.853.119l-4.029 9.49ZM9.98 8.118a1.752 1.752 0 00-1.148.167 1.664 1.664 0 00-.651.596 1.703 1.703 0 00-.258.948v3.96H5.998V6.322h1.876v1.074h.035c.251-.344.567-.628.948-.851a2.55 2.55 0 011.311-.335c.172 0 .335.014.488.042.153.028.267.058.342.09l-.774 1.849a.766.766 0 00-.244-.073Z');icon.append(path);avatar.append(icon);return avatar;
    }
    renderArchivedNative(post,node){
      // Reddit may no longer serve a fragment for this identity. Reuse its own
      // card components, layout classes and action row with historical values.
      // Archive strings are always text, never server HTML or executable markup.
      node.replaceChildren();node.dataset.rtArchiveFallback='true';node.dataset.rtNativeState='ready';node.removeAttribute('aria-busy');
      const isComment=post.kind==='comment',native=make(isComment?'shreddit-profile-comment':'shreddit-post');
      const body=post.over18 || post.spoiler?'NSFW or spoiler snapshot · Open the source to review content restrictions.':(post.archivedBody || post.body) && !['[deleted]','[removed]'].includes(post.archivedBody || post.body)?(post.archivedBody || post.body):'The archive has no original text for this item.';
      const date=make('faceplate-timeago');date.setAttribute('ts',new Date(post.created*1000).toISOString());date.setAttribute('short','');
      const profileName=/^u_([\w-]{1,20})$/i.exec(post.subreddit)?.[1],community=link(profileName?'u/'+profileName:'r/'+post.subreddit,profileName?'/user/'+profileName+'/':'/r/'+encodeURIComponent(post.subreddit)+'/','font-semibold text-12 text-neutral-content-strong no-underline hover:underline');
      community.classList.add('inline-flex','items-center','gap-xs');community.prepend(profileName?this.profilePostAvatar(profileName):this.communityAvatar(post.subreddit));
      native.setAttribute('data-feed-element-id',post.fullname);
      if(isComment){
        native.className='w-full nd:visible rounded-4 my-2xs';native.setAttribute('comment-id',post.fullname);native.setAttribute('href',post.permalink);
        const inner=make('div','hover:bg-neutral-background-hover relative rounded-4'),padding=make('div','px-md py-sm'),credit=make('div','text-12 relative w-fit'),context=make('div','flex items-center');
        const heading=make('h2','inline-block m-0');heading.append(link(post.title || 'View post',post.permalink,'text-neutral-content-strong font-normal hover:underline'));
        context.append(community,make('span','px-2xs',' • '),heading);const identity=make('div','text-neutral-content-weak inline-block ms-xl mt-2xs');const info=make('span');info.id='poster-info-'+post.fullname;info.dataset.rtReplyInfo='true';identity.append(info,document.createTextNode(' '),date);credit.append(context,identity);
        const content=make('div','ms-[22px] mt-2xs ps-[10px] md'),text=make('div','md pt-xs pb-2xs whitespace-pre-wrap break-words');text.append(make('p','',body));content.append(text);
        const actions=make('div','block ms-lg relative'),row=make('shreddit-comment-action-row','block');row.setAttribute('comment-id',post.fullname);row.setAttribute('score',String(post.score));row.setAttribute('permalink',post.permalink);row.setAttribute('telemetry-source','profile');row.setAttribute('vote-state','NONE');row.setAttribute('is-desktop-viewport','true');row.setAttribute('inert','');row.setAttribute('aria-disabled','true');row.title='Archived values · Current actions unavailable';
        const reply=link('',post.permalink,'button rpl-cab border-sm text-label-2 button-plain-weak inline-flex items-center px-sm py-xs');reply.slot='comment-reply';reply.style.height='var(--size-button-sm-h)';const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');for(const [key,value] of Object.entries({rpl:'','aria-hidden':'true','fill':'currentColor',height:'16',width:'16',viewBox:'0 0 20 20','icon-name':'comment'}))icon.setAttribute(key,value);const path=document.createElementNS(icon.namespaceURI,'path');path.setAttribute('d','M10 1a9 9 0 00-9 9c0 1.947.79 3.58 1.935 4.957L.231 17.661A.784.784 0 00.785 19H10a9 9 0 009-9 9 9 0 00-9-9Zm0 16.2H6.162c-.994.004-1.907.053-3.045.144l-.076-.188a36.981 36.981 0 002.328-2.087l-1.05-1.263C3.297 12.576 2.8 11.331 2.8 10c0-3.97 3.23-7.2 7.2-7.2s7.2 3.23 7.2 7.2-3.23 7.2-7.2 7.2Z');icon.append(path);const leading=make('span','flex text-body-1 me-2xs');leading.append(icon);reply.append(leading,make('span','rpl-cab--content','Reply'));
        const share=make('shreddit-comment-share-button');share.setAttribute('slot','comment-share');share.setAttribute('permalink',post.permalink);share.setAttribute('is-desktop-viewport','true');row.append(reply,share);actions.append(row);padding.append(credit,content,actions);inner.append(padding);native.append(inner);
      }else{
        native.className='block relative cursor-pointer group bg-neutral-background focus-within:bg-neutral-background-hover hover:bg-neutral-background-hover xs:rounded-4 px-md py-2xs my-2xs nd:visible';native.id=post.fullname;
        for(const [key,value] of Object.entries({'permalink':post.permalink,'view-context':'ProfileFeed2','view-type':'cardView','post-type':'text','post-title':post.title,'author':post.author,'subreddit-name':post.subreddit,'subreddit-prefixed-name':profileName?'u_'+profileName:'r/'+post.subreddit,'score':post.score,'comment-count':post.comments,'created-timestamp':new Date(post.created*1000).toISOString()}))native.setAttribute(key,String(value));
        if(post.author==='[deleted]')native.setAttribute('is-author-deleted','');const credit=make('span','flex justify-between text-12 min-h-[32px] mb-2xs -mt-2xs');credit.slot='credit-bar';const identity=make('span','flex items-center gap-xs');identity.append(community,document.createTextNode(' · '),date);credit.append(identity);
        const title=link(post.title,post.permalink,'block text-neutral-content-strong m-0 visited:text-neutral-content-weak font-semibold text-16-scalable xs:text-18-scalable mb-2xs xs:mb-xs overflow-hidden');title.slot='title';const content=make('div','md whitespace-pre-wrap break-words');content.slot='text-body';content.append(make('p','',body));native.append(credit,title,content);
        // Keep the card inert until the native action bar is isolated. This
        // avoids even a frame of actionable voting on unverified snapshots.
        native.setAttribute('inert','');const disable=()=>{const bar=native.shadowRoot?.querySelector('rpl-action-bar');if(!bar)return false;bar.setAttribute('inert','');bar.setAttribute('aria-disabled','true');bar.title='Archived values · Current actions unavailable';native.removeAttribute('inert');return true;};
        if(!disable())requestAnimationFrame(()=>{if(!disable())requestAnimationFrame(disable);});
      }
      node.append(native);return native;
    }
    card(post){
      const card=make('div','rt-native-card');card.id='rt-native-'+crypto.randomUUID();card.dataset.rtUi='activity-item';card.dataset.postId=post.id;card.dataset.fullname=post.fullname;card.dataset.rtNativeFullname=post.fullname;card.dataset.rtNativeState='idle';card.dataset.key=itemKey(post);card.hidden=post.visible;
      card.setAttribute('aria-busy','true');
      card.append(this.placeholder());return card;
    }
    placeholder(){
      // Cards use quiet native shimmer rows. The animated Snoo belongs to the
      // feed, never repeated for every pending item.
      const placeholder=make('div','rt-native-placeholder');placeholder.setAttribute('aria-hidden','true');
      const avatar=make('faceplate-shimmer','h-lg w-lg rounded-full shrink-0'),lines=make('div','grow');avatar.setAttribute('shape','circle');lines.append(make('faceplate-shimmer','block rounded-2 h-md w-[200px] max-w-full'),make('faceplate-shimmer','block rounded-2 h-xs w-[160px] max-w-full mt-2xs'));placeholder.append(avatar,lines);return placeholder;
    }
    feedLoader(){
      const loader=make('shreddit-feed-page-loading','rt-native-loading');loader.setAttribute('page-type',this.context?.view==='comments'?'profile_comments':this.context?.view==='posts'?'profile_posts':'profile_overview');return loader;
    }
    observeNativeLoading(){
      const feed=this.feed;if(!feed)return;
      // The native feed/continuation can render a linear progress track as
      // well as its Snoo halo. Keep only the halo; never style card/media roots.
      for(const root of [feed.shadowRoot,...[...feed.querySelectorAll('shreddit-feed-page-loading')].map(node=>node.shadowRoot)].filter(Boolean)){
        if([...this.nativeLoadingStyles].some(style=>style.parentNode===root))continue;
        const style=make('style');style.dataset.rtUi='loading-style';style.textContent='faceplate-progress,progress{display:none!important}';root.append(style);this.nativeLoadingStyles.add(style);
      }
      const roots=[feed,feed.shadowRoot,...[...feed.querySelectorAll('shreddit-feed-page-loading')].filter(n=>!n.closest('[data-rt-ui]')).map(n=>n.shadowRoot)].filter(Boolean);if(this.nativeLoadingRoot?.feed===feed && roots.length===this.nativeLoadingRoot.roots.length && roots.every((root,i)=>root===this.nativeLoadingRoot.roots[i]))return;
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
        for(let parent=node;parent;parent=parent.parentElement || parent.getRootNode()?.host){const style=getComputedStyle(parent);if(parent.hidden || style.display==='none' || style.visibility==='hidden')return false;}
        return true;
      };
      return [...this.feed?.shadowRoot?.querySelectorAll('shreddit-loading') || [],...this.feed?.querySelectorAll('shreddit-feed-page-loading,shreddit-loading') || []].some(visible);
    }
    profilePostAvatar(username){
      const avatar=make('span','inline-flex items-center justify-center w-lg h-lg relative shrink-0');avatar.setAttribute('avatar','');
      // Only profile-hosted posts use account artwork. Never modify Reddit's
      // server-rendered author/community markup or borrow another user's photo.
      const same=username.toLowerCase()===this.context.username.toLowerCase(),url=same?M.avatarUrl(this.avatarSlot?.querySelector('img')?.getAttribute('src') || document.querySelector('#profile-icon')?.getAttribute('src')):'';
      const image=make('img','mb-0 rounded-full object-contain w-full h-full');image.src=url || unavailableAvatarUrl(same?this.accountState:'deleted');image.alt='';image.width=image.height=24;image.loading='lazy';avatar.append(image);return avatar;
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
        const next=this.postMetadata.get(batch.queue[0].dataset.key),limit=this.batchedProfile?(next?.kind==='comment'?4:2):1;if(batch.active>=limit)break;
        const node=batch.queue.shift(),post=this.postMetadata.get(node.dataset.key),generation=this.generation;
        if(!post || node.hidden && !this.activeProfileBatch?.nodes.includes(node) && node.dataset.rtQualify!=='true' || !node.isConnected){node.dataset.rtNativeState='idle';continue;}
        if(this.nativeObserver && !this.activeProfileBatch?.nodes.includes(node) && node.dataset.rtQualify!=='true'){const rect=node.getBoundingClientRect();if(rect.top>innerHeight+400 || rect.bottom< -400){node.dataset.rtNativeState='idle';this.nativeObserver.observe(node);continue;}}
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
          node.dataset.rtNativeState='ready';this.nativeRetries.delete(node);delete node.dataset.rtQualify;node.removeAttribute('aria-busy');this.decorateNative(this.postMetadata.get(node.dataset.key) || post,node);
          // An entrance effect must not replay when Reddit restores a virtualized card.
          if(node.isConnected && !this.batchedProfile){node.classList.add('rt-native-enter');const finish=()=>{node.classList.remove('rt-native-enter');node.removeEventListener('animationend',finish);};node.addEventListener('animationend',finish);setTimeout(finish,200);}
        },error=>{
          if(generation!==this.generation || pageRoute()?.key!==this.context?.key)return;
          if(!node.isConnected){if(this.feedSlot(node)!==node)node.dataset.rtNativeState='idle';return;}
          const transient=/^(Native card loading timed out\.|Public posts took too long to load\. Try again\.|Reddit could not render this card \(HTTP 50[0234]\)\.|Failed to fetch)$/.test(error?.message || '');
          if(transient && !this.nativeRetries.has(node)){this.nativeRetries.set(node,1);node.dataset.rtNativeState='queued';batch.queue.push(node);return;}
          if(node.dataset.rtQualify==='true'){delete node.dataset.rtQualify;this.sourceErrors.qualification='Some items could not be checked on Reddit.';}
          if(this.archiveOnly && post.source==='arctic-shift'){this.renderArchivedNative(this.postMetadata.get(node.dataset.key) || post,node);this.decorateNative(this.postMetadata.get(node.dataset.key) || post,node);return;}
          node.dataset.rtNativeState='failed';node.removeAttribute('aria-busy');node.replaceChildren();
          const fallback=make('div','rt-native-unavailable');fallback.append(link(post.title || 'View comment on Reddit',post.permalink));
          const retry=button('Retry',()=>{this.nativeRetries.delete(node);node.dataset.rtNativeState='idle';this.queueNative(node);});retry.title=error?.message || 'Reddit could not load this card.';fallback.append(retry);node.append(fallback);
          const archived=post.archivedBody || (post.source==='arctic-shift'?post.body:'');if(archived && !post.over18 && !post.spoiler)node.append(this.snapshot(archived));
        }).finally(()=>{batch.active--;this.settleProfileBatch();this.deduplicate();this.drainNative(batch);this.updateProfileLoading();});
      }
    }
    restoreRecoveredBodies(){
      for(const [info,original] of this.replyPatches || [])if(info.hasAttribute('data-rt-reply-info')){info.replaceChildren(...original);delete info.dataset.rtReplyInfo;delete info.dataset.rtReplySignature;}this.replyPatches=new Map();
      for(const [body,patch] of this.recoveredBodies || [])if(body.contains(patch.recovered))body.replaceChildren(...patch.original);
      for(const native of this.nativeDecorations || []){native.querySelector('[data-rt-source]')?.remove();native.querySelector('.rt-comment-source-credit')?.classList.remove('rt-comment-source-credit');native.querySelector('.rt-comment-source-host')?.classList.remove('rt-comment-source-host');}
      this.recoveredBodies=new Map();this.nativeDecorations=new Set();
    }
    recoverBody(post,native){
      const text=post.archivedBody || (post.source==='arctic-shift'?post.body:'');
      if(!native || !text || ['[removed]','[deleted]'].includes(text) || post.over18 || post.spoiler || this.nativeRestrictions(native).restricted)return false;
      const body=native.querySelector(post.kind==='comment'?'[id$="-post-rtjson-content"],.md':'[slot="text-body"]');if(!body)return false;
      const copied=body.querySelector('[data-rt-recovered-text][data-rt-original-text]');if(copied && !this.recoveredBodies.has(body))this.recoveredBodies.set(body,{original:[document.createTextNode(copied.dataset.rtOriginalText)],recovered:copied});
      const existing=this.recoveredBodies.get(body);if(existing && body.contains(existing.recovered)){if(existing.recovered.textContent!==text)existing.recovered.textContent=text;return true;}
      const current=body.textContent.trim();if(!/^\[(deleted|removed)\]$/i.test(current) && !(current==='' && ['deleted','removed'].includes(post.status)))return false;
      const recovered=make('p','whitespace-pre-wrap break-words',text);recovered.dataset.rtRecoveredText='true';recovered.dataset.rtOriginalText=current;this.recoveredBodies.set(body,{original:[...body.childNodes],recovered});body.replaceChildren(recovered);return true;
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
        if(unresolved.length){for(const p of unresolved)this.replyArchiveChecked.add(p.parentId || this.replyContexts.get(p.fullname)?.parentId);try{const result=await this.archive({action:'archive-parents',username:this.context.username,children:unresolved.slice(0,25).map(p=>p.id)});if(!current())return;for(const raw of result.posts || []){const p=M.normalizeComment(raw,{source:'arctic-shift'});if(p && unresolved.some(child=>(child.parentId || this.replyContexts.get(child.fullname)?.parentId)===p.fullname && child.linkId===p.linkId) && M.validateUsername(p.author))this.replyAuthors.set(p.fullname,{author:p.author,linkId:p.linkId});}}catch{if(!current())return;}}
      }
      if(current())for(const p of comments){const node=this.nodes.get(itemKey(p));if(node)this.repairReplyInfo(p,node.querySelector('shreddit-profile-comment'));}
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
      node.querySelector('[data-rt-archive]')?.remove();
      const native=node.matches('shreddit-post,shreddit-profile-comment')?node:node.querySelector('shreddit-post,shreddit-profile-comment');if(!native)return;
      post={...post,status:this.verifiedStatus(post,native)};
      // Discovery-only HTML has no full body/deletion proof. Once the actual
      // native card proves deletion, a separately obtained archive can restore
      // its text even though the search record itself still has unknown status.
      const archive=this.archived.get(itemKey(post));
      if(this.context.kind==='profile' && ['deleted','removed'].includes(post.status) && archive?.source==='arctic-shift' && archive.fullname===post.fullname && archive.author.toLowerCase()===this.context.username.toLowerCase() && archive.body)post={...post,archivedBody:post.archivedBody || archive.body,over18:post.over18 || archive.over18,spoiler:post.spoiler || archive.spoiler};
      this.repairReplyInfo(post,native);const recovered=this.recoverBody(post,native),label=this.indicator(post);if(recovered){label.title+=' · Text recovered from Arctic Shift';label.setAttribute('aria-label',label.title);}
      let badge=node.querySelector('[data-rt-source]');if(!badge || badge.title!==label.title){if(badge)badge.replaceWith(label);badge=label;badge.dataset.rtSource='true';}
      if(native.matches('shreddit-profile-comment')){
        const host=native.firstElementChild || native,credit=host.querySelector('.text-12.relative') || host.firstElementChild;host.classList.add('rt-comment-source-host');credit?.classList.add('rt-comment-source-credit');if(badge.parentElement!==host)host.append(badge);
      }else{
        const credit=native.querySelector('[slot="credit-bar"]') || native;
        let actions=credit.querySelector('shreddit-post-overflow-menu');while(actions && actions.parentElement!==credit)actions=actions.parentElement;
        if(actions){if(badge.parentElement!==actions)actions.prepend(badge);}else if(badge.parentElement!==credit){badge.style.marginInlineStart='auto';credit.append(badge);}
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
      if(native && live && this.settings.restoreDeletedContent && this.recoverBody({...live,archivedBody:archived.body,over18:live.over18 || archived.over18,spoiler:live.spoiler || archived.spoiler},native)){this.nativeDecorations.add(native);this.decorateNative({...live,archivedBody:archived.body},native);this.setStatus('Available archived text restored.');return;}
      const note=make('div','rt-post-snapshot');note.append(this.indicator(live || archived));
      if(archived.over18 || archived.spoiler || live?.over18 || live?.spoiler || restrictions.restricted)note.append(make('p','rt-post-source','NSFW or spoiler snapshot · open the post’s source to review content restrictions.'));
      else if(archived.body && !['[deleted]','[removed]'].includes(archived.body))note.append(this.snapshot(archived.body));else note.append(make('p','rt-post-source','The archive has no original text for this post.'));
      this.results.append(note);this.setStatus(live?`${live.status==='deleted'?'Deleted':'Removed'} on Reddit · Separate archived snapshot`:'Archived snapshot · Current Reddit status unknown');
    });}
    destroy(){this.profileStates.clear();document.removeEventListener('click',this.onNavigate,true);this.avatarUnsubscribe?.();clearTimeout(this.timer);this.observer?.disconnect();globalThis.chrome?.runtime?.onMessage?.removeListener?.(this.onWorkerSettings);window.removeEventListener('popstate',this.onRoute);document.removeEventListener('reddit:route',this.onRoute);globalThis.chrome?.storage?.onChanged?.removeListener?.(this.onSettings);this.reset({retainNavigation:false});document.documentElement.removeAttribute('data-rt-profile-discovery');}
  }
  globalThis.RTPostDiscovery=Object.freeze({Discovery,pageRoute});
  if(window.top===window && globalThis.chrome?.runtime?.id)new Discovery();
})();
