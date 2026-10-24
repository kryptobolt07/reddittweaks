/* Inline public-post discovery. Does not change Reddit's posts or chat client. */
(() => {
  'use strict';
  const M=globalThis.RTPostModel;if(!M)return;
  const key='rt-settings-v1';
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
  function glyph(kind='search'){
    const s=document.createElementNS('http://www.w3.org/2000/svg','svg');s.setAttribute('viewBox','0 0 24 24');s.dataset.icon=kind;s.setAttribute('aria-hidden','true');
    const p=document.createElementNS(s.namespaceURI,'path');p.setAttribute('d',kind==='refresh'?'M20 7V3l-3 3a8 8 0 1 0 2 10M20 3v6h-6':kind==='archive'?'M4 8h16v12H4zM3 4h18v4H3zM9 12h6':kind==='deleted'?'M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7':kind==='hidden'?'M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M7 5.5A11 11 0 0 1 12 4c5 0 9 8 9 8a20 20 0 0 1-3.4 4.3M5 7a22 22 0 0 0-2 5s4 8 9 8a10 10 0 0 0 4-1':kind==='removed'?'M5 5l14 14M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20':'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14m5 12 6 6');s.append(p);return s;
  }
  const unavailableAvatarUrl=state=>state==='banned'?'https://www.redditstatic.com/shreddit/assets/snoovatar-back-64x64px.png':'https://www.redditstatic.com/avatars/defaults/v2/avatar_default_0.png';
  function unavailableAvatar(state,size=64){const image=make('img','rt-unavailable-avatar');image.src=unavailableAvatarUrl(state);image.width=image.height=size;image.alt='';image.decoding='async';image.referrerPolicy='no-referrer';return image;}
  function button(text,run,icon){const b=make('button','',text);b.type='button';if(icon)b.prepend(glyph(icon));b.addEventListener('click',run);return b;}
  function link(text,url,cls){const a=make('a',cls,text);a.href=url;a.rel='noopener noreferrer';return a;}
  class Discovery {
    constructor({reddit=redditRead,archive=archiveRead,readSettings=settingsRead,observe=true,autoDiscover=observe,nativeRenderer=null}={}){
      this.profileStates=new Map();this.profileOwner=globalThis.RCSDirectory?.getOwner?.() || '';this.nativeRenderer=nativeRenderer;this.autoDiscover=autoDiscover;this.reddit=reddit;this.archive=archive;this.readSettings=readSettings;this.settings={postDiscovery:false,archiveDiscovery:false};this.settingsRevision=0;this.generation=0;this.controllers=new Set();this.nodes=new Map();this.host=null;
      this.settingsPending=true;this.syncProfileNotice();
      this.onRoute=()=>{this.rememberProfile();this.syncProfileNotice();this.schedule();};this.onNavigate=event=>{const a=event.target.closest?.('a[href]'),card=event.target.closest?.('shreddit-post');if(!this.feed?.contains(event.target) || event.target.closest?.('button,input'))return;try{const url=new URL(a?.href || card?.getAttribute('permalink'),location.href);if(url.origin===location.origin && pageRoute(url.pathname,'')?.kind==='post')this.rememberProfile();}catch{}};if(observe)document.addEventListener('click',this.onNavigate,true);this.onSettings=(changes,area)=>{if(area==='local' && changes[key]){this.profileStates.clear();this.settingsRevision++;this.settingsPending=false;this.settingsError=false;this.settings=M.normalizeSettings(changes[key].newValue);this.reset();this.scan();}};
      if(observe){this.observer=new MutationObserver(records=>{this.syncProfileNotice();this.trackVirtualization(records);if(records.some(r=>!this.ownsMutation(r)))this.schedule();});this.observer.observe(document.documentElement,{childList:true,subtree:true});window.addEventListener('popstate',this.onRoute);document.addEventListener('reddit:route',this.onRoute);globalThis.chrome?.storage?.onChanged?.addListener(this.onSettings);}
      this.onWorkerSettings=(message,sender)=>{if(message?.scope==='rt-posts' && message.action==='settings-changed' && sender?.id===globalThis.chrome?.runtime?.id)this.onSettings({[key]:{newValue:message.settings}},'local');};
      if(observe)globalThis.chrome?.runtime?.onMessage?.addListener(this.onWorkerSettings);
      this.avatarUnsubscribe=globalThis.RCSDirectory?.onChange?.(value=>{const owner=globalThis.RCSDirectory?.getOwner?.() || '';if(value?.owner && value.owner!==owner)return;if(this.profileOwner!==owner){this.profileOwner=owner;this.profileStates.clear();this.reset();this.scan();}});
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
    reset({retainNavigation=false}={}){this.restoreRecoveredBodies();this.profileNavigation?.remove();if(!retainNavigation)this.profileNavigation=null;else if(this.profileNavigation?.dataset.state==='loading')this.profileNavigation.dataset.state='idle';this.archiveNotice?.removeAttribute('data-rt-archive-notice');this.archiveShell?.remove();this.archiveNotice=this.archiveNoticeAnchor=this.archiveShell=this.archiveMain=this.archiveStats=this.avatarSlot=this.avatarPlaceholder=null;this.profileOverlay=false;this.archiveOnly=false;this.accountState='';this.generation++;clearTimeout(this.nativeResumeTimer);this.nativeObserver?.disconnect();this.batchObserver?.disconnect();this.batchObserver=null;if(this.batchFrame)cancelAnimationFrame(this.batchFrame);this.batchFrame=null;this.activeProfileBatch=null;this.publishedCards=new Set();this.batchedProfile=false;this.batchInView=false;this.batchAutoPaused=false;this.forceProfileBatch=false;this.nativeBatch={active:0,queue:[]};this.postMetadata=new Map();this.replyContexts=new Map();this.replyAuthors=new Map();this.replyArchiveChecked=new Set();for(const c of this.controllers)c.abort();this.controllers.clear();if(this.emptyFeed){this.emptyFeed.hidden=this.emptyWasHidden;this.emptyFeed.removeAttribute('data-rt-empty-suppressed');}this.emptyFeed=null;for(const node of this.nodes.values()){const slot=this.feedSlot(node);if(slot!==node){
        // Reddit still owns this placeholder and may restore its detached node.
        // Retire both without removing a slot from its virtualization stack.
        slot.dataset.rtRetired='true';node.dataset.rtRetired='true';node.replaceChildren();node.hidden=true;
      }else node.remove();}this.virtualNodes=new Map();this.host?.remove();this.host=null;this.feed=null;this.context=null;this.live=new Map();this.archived=new Map();this.nodes.clear();this.after=this.before=null;this.loaded=false;this.archiveLoaded=false;this.moreReddit=this.moreArchive=false;this.busy=false;this.pages=0;this.afterByKind={};this.beforeByKind={};this.redMore={};this.archiveMore={};this.renderedPosts=[];this.summaryCounts=null;}
    rememberProfile(){
      if(this.context?.kind!=='profile' || !this.settings.postDiscovery || this.settingsError || !(this.loaded || this.archiveLoaded))return;
      const previous=this.profileStates.get(this.context.key),owner=globalThis.RCSDirectory?.getOwner?.() || '',signature=[this.generation,this.renderVersion || 0,this.pages,this.live.size,this.archived.size,this.publishedCards.size,[...this.nodes.values()].filter(node=>node.dataset.rtNativeState==='ready').length].join(':');
      if(previous?.signature===signature && previous.owner===owner){if(pageRoute()?.key===this.context.key)previous.scrollY=window.scrollY || 0;return;}
      const saved={signature,owner,archiveOnly:this.archiveOnly,live:new Map(this.live),archived:new Map(this.archived),cards:new Map(),scrollY:pageRoute()?.key===this.context.key?window.scrollY || 0:previous?.scrollY || window.scrollY || 0};
      for(const name of ['loaded','archiveLoaded','pages','moreReddit','moreArchive'])saved[name]=this[name];
      for(const name of ['afterByKind','beforeByKind','redMore','archiveMore'])saved[name]={...this[name]};saved.publishedCards=new Set(this.publishedCards);saved.replyContexts=new Map(this.replyContexts);saved.replyAuthors=new Map(this.replyAuthors);saved.replyArchiveChecked=new Set(this.replyArchiveChecked);
      for(const [key,node] of this.nodes)if(node.dataset.rtNativeState==='ready'){const copy=node.cloneNode(true);copy.classList.remove('rt-native-enter');for(const script of copy.querySelectorAll('script'))script.remove();const partial=copy.firstElementChild;if(partial?.matches('faceplate-partial') && partial.querySelector('shreddit-post,shreddit-profile-comment'))partial.replaceWith(...partial.childNodes);saved.cards.set(key,copy);}
      saved.publishedCards=new Set([...saved.publishedCards].filter(key=>saved.cards.has(key)));
      this.profileStates.delete(this.context.key);this.profileStates.set(this.context.key,saved);
      while(this.profileStates.size>4 || [...this.profileStates.values()].reduce((count,state)=>count+state.cards.size,0)>250)this.profileStates.delete(this.profileStates.keys().next().value);
    }
    restoreProfile(context){
      const saved=this.profileStates.get(context.key);if(!saved || saved.owner!==(globalThis.RCSDirectory?.getOwner?.() || '') || saved.archiveOnly!==this.archiveOnly)return false;
      this.profileStates.delete(context.key);this.live=saved.live;this.archived=saved.archived;this.nodes=saved.cards;this.publishedCards=saved.publishedCards || new Set(saved.cards.keys());this.replyContexts=saved.replyContexts || new Map();this.replyAuthors=saved.replyAuthors || new Map();this.replyArchiveChecked=saved.replyArchiveChecked || new Set();
      for(const name of ['loaded','archiveLoaded','pages','moreReddit','moreArchive','afterByKind','beforeByKind','redMore','archiveMore'])this[name]=saved[name];
      for(const node of this.nodes.values())this.results.append(node);
      const generation=this.generation;if(saved.scrollY>0)requestAnimationFrame(()=>{if(generation===this.generation && pageRoute()?.key===context.key && window.scrollY===0)window.scrollTo({top:saved.scrollY,behavior:'instant'});});
      return true;
    }
    trackVirtualization(records){
      for(const record of records){
        if(record.target!==this.feed || record.addedNodes.length!==1 || record.removedNodes.length!==1)continue;
        const added=record.addedNodes[0],removed=record.removedNodes[0];
        if(added.nodeType===1 && added.matches('.virtualized-placeholder'))this.virtualNodes.set(added,removed);
        else if(this.virtualNodes.get(removed)===added)this.virtualNodes.delete(removed);
      }
    }
    feedSlot(node){for(const [placeholder,original] of this.virtualNodes || [])if(original===node && placeholder.parentElement===this.feed)return placeholder;return node;}
    scan(){
      this.syncProfileNotice();
      const context=pageRoute();
      if((context?.kind==='post' || context?.kind!=='profile' && !/^\/user\//i.test(location.pathname)) && this.context?.kind==='profile' && this.host?.isConnected && document.querySelector('#profile-feed-tabgroup')){this.profileOverlay=true;return;}
      if(this.profileOverlay && context?.key===this.context?.key){this.profileOverlay=false;if(!this.nativeBatch.active)for(const node of this.nodes.values())if(node.dataset.rtNativeState==='loading')node.dataset.rtNativeState='idle';for(const node of this.activeProfileBatch?.nodes || [])if(node.dataset.rtNativeState==='idle')this.queueNative(node);this.settleProfileBatch();}
      if((!this.settings.postDiscovery && !this.settingsError) || !context || location.hostname==='old.reddit.com'){if(this.host || this.context){if(this.settings.postDiscovery)this.rememberProfile();this.reset();}return;}
      if(this.context?.key===context.key && this.host?.isConnected && (!this.feed || this.feed.isConnected) && (!this.archiveOnly || this.archiveNotice?.isConnected || this.archiveNoticeAnchor?.isConnected)){this.deduplicate();this.drainNative(this.nativeBatch);return;}
      const retainNavigation=this.archiveOnly && context.kind==='profile' && this.context?.username.toLowerCase()===context.username.toLowerCase() && this.archiveShell?.isConnected && this.context.key!==context.key;
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
      this.batchedProfile=Boolean(this.feed && (this.archiveOnly || !this.feed.querySelector('shreddit-post,shreddit-profile-comment,shreddit-feed-load-more-observer[cursor],faceplate-partial[slot="load-after"][src]')));
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
      if(this.batchedProfile){this.loading.dataset.rtUi='profile-loading';this.loading.slot='load-after';this.feed.append(this.loading);if(typeof IntersectionObserver==='function'){this.batchObserver=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.target===this.loading){this.batchInView=entry.isIntersecting;if(entry.isIntersecting)this.advanceProfileBatch();}},{rootMargin:'200px'});this.batchObserver.observe(this.loading);}}
      if(this.archiveOnly && this.autoDiscover)this.loadNavigation();
      this.emptyFeed=main.querySelector('#empty-feed-content');this.emptyWasHidden=this.emptyFeed?.hidden;
      const restored=context.kind==='profile' && this.restoreProfile(context);
      if(restored)this.render({reuseCards:true});
      if(this.settingsError)this.setStatus('Discovery settings could not be loaded. Select Retry discovery.',true);
      else if(context.kind==='profile' && this.autoDiscover && !restored)queueMicrotask(()=>{if(this.host===host){if(this.archiveOnly){if(this.settings.archiveDiscovery)this.loadArchive();}else this.loadReddit();}});
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
      const target=this.profileNavigation=make('div','contents');target.id='rt-nav-'+crypto.randomUUID();target.dataset.rtUi='profile-navigation';target.dataset.state='idle';this.navigationFallback(target);return target;
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
      this.request({action:'render-navigation',username:this.context.username,target:target.id}).then(result=>{if(generation===this.generation){if(!result?.rendered)throw Error('Native navigation is unavailable.');target.dataset.state='ready';}}).catch(()=>{if(generation!==this.generation)return;target.dataset.state='failed';this.navigationFallback(target);const retry=button('Retry navigation',()=>{target.dataset.state='idle';this.loadNavigation();});retry.className='button button-small button-plain px-md';target.querySelector('nav').append(retry);});
    }
    archiveSidebar(context){
      const sidebar=make('aside','right-sidebar min-w-0 w-[316px] max-w-[316px] hidden xs:block styled-scrollbars xs:sticky xs:top-[56px] xs:max-h-screen-without-header xs:overflow-y-auto xs:overflow-x-hidden');sidebar.id='right-sidebar-container';
      const content=make('div','right-sidebar-contents flex-auto');content.id='right-sidebar-contents';const panel=make('section','bg-neutral-background-weak rounded-4');panel.setAttribute('aria-label','Archived profile information');const padding=make('div','p-md');padding.append(make('h2','inline-flex items-center m-0 text-headline text-neutral-content-strong font-bold truncate',context.username),make('p','text-12 text-neutral-content-weak','Archived public activity'));
      const stats=make('dl','grid grid-cols-2 gap-md mt-md');this.archiveStats={};for(const [key,label] of [['posts','Posts loaded'],['comments','Comments loaded'],['oldest','Oldest loaded'],['newest','Newest loaded']]){const item=make('div'),value=make('dd','m-0 text-14 font-semibold text-neutral-content-strong',key==='posts' || key==='comments'?'0':'—');item.append(value,make('dt','text-12 text-neutral-content-weak',label));stats.append(item);this.archiveStats[key]=value;}
      padding.append(stats,make('p','text-12 text-neutral-content-weak','Partial archive coverage. Counts and dates describe loaded records, not the complete account history.'),link('Arctic Shift','https://arctic-shift.photon-reddit.com/','text-12 hover:underline'));panel.append(padding);content.append(panel);sidebar.append(content);return sidebar;
    }
    updateArchiveSummary(){if(!this.archiveStats)return;const posts=this.renderedPosts || [],times=posts.map(p=>p.created),date=value=>new Date(value*1000).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});const set=(key,value)=>{if(this.archiveStats[key].textContent!==value)this.archiveStats[key].textContent=value;};set('posts',String(posts.filter(p=>p.kind!=='comment').length));set('comments',String(posts.filter(p=>p.kind==='comment').length));set('oldest',times.length?date(Math.min(...times)):'—');set('newest',times.length?date(Math.max(...times)):'—');}
    retrySettings(){this.reset();return this.loadSettings();}
    kinds(){return this.context.view==='overview'?['post','comment']:[this.context.view==='comments'?'comment':'post'];}
    nativeEntries(){
      if(!this.feed)return [];
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
      const entries=this.nativeEntries(),visible=this.visibleIds(),sort=this.context.sort,normal=entries.filter(e=>!e.pinned && (sort==='top'?Number.isFinite(e.score):sort==='hot' || Number.isFinite(e.timestamp))),rank=new Map(this.renderedPosts.map((post,index)=>[post.fullname,index]));
      const continuation=this.feed.querySelector('shreddit-feed-load-more-observer[cursor],faceplate-partial[slot="load-after"][loading="lazy"][src]');
      const horizon=continuation && sort!=='hot'?(normal.length?Math.min(...normal.map(e=>sort==='top'?e.score:Math.floor(e.timestamp))):sort==='new'?Infinity:-Infinity):-Infinity;
      const tail=continuation?(()=>{let n=continuation;while(n.parentElement && n.parentElement!==this.feed)n=n.parentElement;return n.parentElement===this.feed?n:null;})():null;
      const buckets=new Map();let count=0,deferred=0;
      for(const post of this.renderedPosts || []){
        const node=this.nodes.get(itemKey(post));if(!node)continue;
        const slot=this.feedSlot(node),virtualized=slot!==node;
        const duplicate=visible.has(post.fullname),older=!duplicate && (sort==='top'?post.score:post.created)<horizon;
        const staged=this.batchedProfile && !this.publishedCards.has(itemKey(post));node.hidden=duplicate || older || staged;node.dataset.deferred=older?'older':'';
        if(virtualized)slot.hidden=node.hidden;
        if(node.hidden){if(duplicate){const entry=entries.find(e=>e.fullname===post.fullname),original=this.virtualNodes.get(entry?.node) || entry?.node,native=original?.matches('shreddit-post,shreddit-profile-comment')?original:original?.querySelector('shreddit-post,shreddit-profile-comment');if(native && this.recoverBody(post,native)){this.nativeDecorations.add(native);this.decorateNative(post,native);}}this.nativeObserver?.unobserve(node);if(duplicate && node.dataset.rtNativeState==='ready'){node.replaceChildren();node.dataset.rtNativeState='idle';}if(older)deferred++;if(!virtualized && node.parentElement!==this.results)this.results.append(node);continue;}
        count++;
        const target=normal.find(entry=>sort==='top'?entry.score<=post.score:sort==='hot'?rank.has(entry.fullname) && rank.get(entry.fullname)>rank.get(post.fullname):entry.timestamp<=post.created)?.node || tail;
        if(!buckets.has(target))buckets.set(target,[]);buckets.get(target).push(slot);
      }
      // Reconcile only extension-owned cards. Reddit retains ownership and order of its nodes.
      for(const [target,nodes] of buckets){let anchor=target;for(let i=nodes.length-1;i>=0;i--){const node=nodes[i];if(!this.virtualNodes.has(node) && (node.parentElement!==this.feed || node.nextElementSibling!==anchor))this.feed.insertBefore(node,anchor);anchor=node;}}
      for(const nodes of buckets.values())for(const node of nodes)if(node.dataset.rtNativeState==='idle'){if(this.nativeObserver)this.nativeObserver.observe(node);else this.queueNative(node);}
      this.summaryCounts={count,deferred};
      if(this.emptyFeed){this.emptyFeed.hidden=count>0 || this.emptyWasHidden;this.emptyFeed.toggleAttribute('data-rt-empty-suppressed',count>0);}
      if(!this.busy && this.status.dataset.error!=='true')this.summarize();if(this.batchedProfile)this.updateProfileLoading();
    }
    summarize(){
      const {count=0,deferred=0}=this.summaryCounts || {},noun=this.context.view==='comments'?(count===1?'comment':'comments'):this.context.view==='overview'?(count===1?'item':'items'):count===1?'post':'posts';
      this.setStatus(count?`${count} ${this.archiveOnly?'archived':'additional'} ${noun}`:'Activity checked');
      if(this.archiveOnly)this.updateArchiveSummary();
      if(this.archiveOnly && this.settings.archiveDiscovery){this.archiveEmpty.hidden=!this.archiveLoaded || count>0 || this.renderedPosts.length>0;this.archiveEmpty.textContent='No archived activity found for this username. Archive coverage may be incomplete.';}
      this.status.title=(deferred?`${deferred} older discoveries will appear when Reddit loads that part of the feed. `:'')+'Search and archive coverage may be incomplete.';
    }
    setStatus(text,error=false){this.status.textContent=text;this.status.dataset.error=String(error);}
    async request(parameters){const controller=new AbortController();this.controllers.add(controller);try{
      for(let attempt=0;;attempt++){
        const result=await this.reddit(parameters,controller.signal);if(!result?.deferred || parameters.action==='render-card')return result;
        if(attempt>=2)throw Error('Reddit requests are paused. Please try again shortly.');
        await new Promise((resolve,reject)=>{const cancel=()=>{clearTimeout(timer);reject(Error('Post request cancelled.'));},timer=setTimeout(()=>{controller.signal.removeEventListener('abort',cancel);resolve();},Math.max(100,Math.min(30000,Number(result.retryAfterMs)||1000)));controller.signal.addEventListener('abort',cancel,{once:true});if(controller.signal.aborted)cancel();});
      }
    }finally{this.controllers.delete(controller);}}
    async run(task){
      if(this.busy)return;this.batchAutoPaused=false;const generation=this.generation;this.busy=true;this.host.setAttribute('aria-busy','true');this.setStatus('Checking public activity…');this.loading.hidden=!this.batchedProfile && (this.nativeEntries().length>0 || [...this.nodes.values()].some(n=>!n.hidden && n.parentElement===this.feed));this.discover.disabled=true;if(this.archiveButton)this.archiveButton.disabled=true;this.more.disabled=true;
      try{await task(()=>generation===this.generation && pageRoute()?.key===this.context?.key && this.host?.isConnected);}
      catch(error){if(generation===this.generation && pageRoute()?.key===this.context?.key)this.setStatus(error.message,true);}
      finally{if(generation===this.generation){this.busy=false;this.host.removeAttribute('aria-busy');this.more.disabled=false;if(this.batchedProfile){this.batchAutoPaused=this.status.dataset.error==='true';this.updateProfileLoading();}else this.loading.hidden=true;this.discover.disabled=false;if(this.archiveButton)this.archiveButton.disabled=false;}}
    }
    loadReddit({more=false}={}){if(this.archiveOnly)return this.loadArchive({more});if(this.nativeBatch?.blocked){this.nativeBatch.blocked=false;this.nativeBatch.serverRetryAt=0;this.drainNative(this.nativeBatch);}if(this.pages>=8){this.setStatus('Showing a bounded selection. History is incomplete.');return;}return this.run(async current=>{
      const errors=[];let succeeded=false;
      for(const kind of this.kinds()){
        if(this.pages>=8 || more && !this.redMore[kind])continue;
        const old=more?this.afterByKind[kind]:null;this.pages++;
        try{const result=await this.request({action:'profile',username:this.context.username,sort:this.context.sort,range:this.context.range,kind,...(old?{after:old}:{})});if(!current())return;
          const incoming=new Map();for(const raw of result.posts || []){const p=M.normalizeItem(raw,{source:'reddit'});if(p){this.live.set(itemKey(p),p);incoming.set(itemKey(p),p);}}
          if(!more && this.context.sort==='hot'){
            const belongs=post=>(post.kind==='comment'?'comment':'post')===kind,group=new Map([...incoming,...[...this.live].filter(([id,p])=>belongs(p) && !incoming.has(id))]);
            this.live=new Map(this.kinds().flatMap(type=>type===kind?[...group]:[...this.live].filter(([,p])=>(p.kind==='comment'?'comment':'post')===type)));
          }
          this.afterByKind[kind]=result.after;this.redMore[kind]=Boolean(result.hasMore && result.after && result.after!==old);succeeded=true;
        }catch(error){if(!current())return;errors.push((kind==='comment'?'Comments: ':'Posts: ')+error.message);}
      }
      this.after=this.afterByKind.post;this.moreReddit=Object.values(this.redMore).some(Boolean);this.loaded=succeeded || this.loaded;this.render();
      if(errors.length)this.setStatus(errors.join(' '),true);
      this.discover.setAttribute('aria-label','Refresh activity');
    });}
    loadArchive({more=false}={}){if(!this.settings.archiveDiscovery)return;if(this.pages>=8){this.setStatus('Showing a bounded selection. History is incomplete.');return;}return this.run(async current=>{
      const warnings=[];
      for(const kind of this.kinds()){
        if(this.pages>=8 || more && !this.archiveMore[kind])continue;
        this.pages++;
        try{const before=more?this.beforeByKind[kind]:null,result=await this.archive({action:'archive-profile',username:this.context.username,kind,...(before?{before}:{})});if(!current())return;
          const page=[];for(const raw of result.posts || []){const p=M.normalizeItem(raw,{source:'arctic-shift'});if(p){this.archived.set(itemKey(p),p);page.push(p);}}
          this.beforeByKind[kind]=result.before;this.archiveMore[kind]=Boolean(result.hasMore && !result.cursorStalled);this.archiveLoaded=true;
          if(page.length && !this.archiveOnly){try{const live=await this.request({action:'info',kind,ids:page.map(p=>p.id)});if(!current())return;for(const raw of live.posts || []){const p=M.normalizeItem(raw,{source:'reddit'});if(p)this.live.set(itemKey(p),p);}}catch{if(!current())return;warnings.push('Current Reddit status could not be checked.');}}
          if(result.cursorStalled)warnings.push('Archive pagination stopped at an ambiguous timestamp. History is incomplete.');
        }catch(error){if(!current())return;warnings.push(error.message);}
      }
      this.moreArchive=Object.values(this.archiveMore).some(Boolean);this.render();if(warnings.length)this.setStatus(warnings.join(' '),true);
    });}
    loadMore(){if(this.batchedProfile)this.forceProfileBatch=true;if(this.pages>=8){this.more.hidden=true;this.setStatus('Showing a bounded selection; history is incomplete.');return;}return this.moreReddit?this.loadReddit({more:true}):this.loadArchive({more:true});}
    render({reuseCards=false}={}){
      this.renderVersion=(this.renderVersion || 0)+1;
      const posts=M.mergePosts([...this.live.values()],[...this.archived.values()],{username:this.context.username,visibleIds:this.visibleIds(),sort:this.context.sort,range:this.context.range});
      for(const post of posts){const key=itemKey(post);this.postMetadata.set(key,post);const previous=this.nodes.get(key);if(previous){if(reuseCards)continue;if(previous.dataset.rtArchiveFallback==='true'){this.renderArchivedNative(post,previous);this.decorateNative(post,previous);}else if(previous.dataset.rtNativeState==='ready')this.decorateNative(post,previous);continue;}const node=this.card(post);this.results.append(node);this.nodes.set(key,node);}
      this.renderedPosts=posts;
      this.deduplicate();this.more.hidden=!(this.moreReddit || this.moreArchive) || this.pages>=8;
      this.summarize();if(this.batchedProfile)this.advanceProfileBatch(this.forceProfileBatch===true);this.forceProfileBatch=false;
    }
    pendingProfilePosts(){
      const visible=this.visibleIds();return this.renderedPosts.filter(post=>{const node=this.nodes.get(itemKey(post));return node && !this.publishedCards.has(itemKey(post)) && !visible.has(post.fullname) && node.dataset.deferred!=='older';});
    }
    profileTailVisible(){const rect=this.loading.getBoundingClientRect();return this.batchInView && rect.top<=innerHeight+200 && rect.bottom>=0;}
    updateProfileLoading(){
      if(!this.batchedProfile || !this.loading)return;
      const pending=this.pendingProfilePosts().length>0,more=(this.moreReddit || this.moreArchive) && this.pages<8,paused=this.batchAutoPaused || this.nativeBatch.blocked;
      this.loading.hidden=paused || !(this.busy || this.activeProfileBatch || pending || more);this.more.hidden=!(pending || more || this.activeProfileBatch) || Boolean(this.batchObserver && !paused);this.more.disabled=this.busy || Boolean(this.activeProfileBatch && !paused);
      if(!this.activeProfileBatch && !this.busy && !paused && this.batchObserver && !this.loading.hidden && !this.batchFrame){const generation=this.generation;this.batchFrame=requestAnimationFrame(()=>{this.batchFrame=null;if(generation===this.generation && this.host?.isConnected && this.profileTailVisible())this.advanceProfileBatch();});}
    }
    advanceProfileBatch(force=false){
      if(!this.batchedProfile || pageRoute()?.key!==this.context?.key)return;
      if(force){this.batchAutoPaused=false;if(this.nativeBatch.blocked){this.nativeBatch.blocked=false;this.nativeBatch.serverRetryAt=0;this.drainNative(this.nativeBatch);}}
      if(this.activeProfileBatch || this.batchAutoPaused)return;
      if(!force && this.publishedCards.size>0 && (!this.batchObserver || !this.profileTailVisible()))return;
      const posts=this.pendingProfilePosts().slice(0,6);
      if(!posts.length){if(!this.busy && (this.moreReddit || this.moreArchive) && this.pages<8 && (force || this.batchObserver && this.profileTailVisible()))this.loadMore();return;}
      const group=this.activeProfileBatch={generation:this.generation,nodes:posts.map(p=>this.nodes.get(itemKey(p))),posts,enriching:false};this.loading.hidden=false;
      for(const node of group.nodes)if(!['ready','failed'].includes(node.dataset.rtNativeState))this.queueNative(node);
      this.settleProfileBatch();
    }
    settleProfileBatch(){
      const group=this.activeProfileBatch;if(!group || group.enriching || group.generation!==this.generation || pageRoute()?.key!==this.context?.key)return;
      const visible=this.visibleIds();if(group.nodes.some(node=>!['ready','failed'].includes(node.dataset.rtNativeState) && !visible.has(node.dataset.fullname)))return;
      group.enriching=true;const current=()=>this.activeProfileBatch===group && group.generation===this.generation && pageRoute()?.key===this.context?.key;
      this.enrichReplyContexts(group.posts,current).finally(()=>{if(!current()){if(this.activeProfileBatch===group)group.enriching=false;return;}for(const node of group.nodes){this.publishedCards.add(node.dataset.key);node.classList.add('rt-native-enter');setTimeout(()=>node.classList.remove('rt-native-enter'),200);}this.activeProfileBatch=null;this.deduplicate();this.updateProfileLoading();});
    }
    indicator(post){
      const removed=['deleted','removed'].includes(post.status),label=removed?`${post.status==='deleted'?'Deleted':'Removed'} on Reddit`:post.source==='arctic-shift'?'Arctic Shift snapshot · Current Reddit status unknown':'Not shown in this profile feed · Found through public Reddit search';
      const badge=make('span','rt-post-indicator');badge.setAttribute('role','img');badge.setAttribute('aria-label',label);badge.title=label;badge.dataset.state=post.status;badge.append(glyph(removed?post.status:post.source==='arctic-shift'?'archive':'hidden'));return badge;
    }
    snapshot(text){const details=make('details','rt-post-snapshot');details.title='Text recovered from Arctic Shift · May differ from the current post';details.append(make('summary','','Recovered text'),make('pre','',text));return details;}
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
      node.append(native);this.ensureSeparator(node);return native;
    }
    card(post){
      const card=make('div','rt-native-card');card.id='rt-native-'+crypto.randomUUID();card.dataset.rtUi='activity-item';card.dataset.postId=post.id;card.dataset.fullname=post.fullname;card.dataset.rtNativeFullname=post.fullname;card.dataset.rtNativeState='idle';card.dataset.key=itemKey(post);card.hidden=post.visible;
      card.setAttribute('aria-busy','true');
      card.append(this.placeholder());this.ensureSeparator(card);return card;
    }
    placeholder(){
      // Cards use quiet native shimmer rows. The animated Snoo belongs to the
      // feed, never repeated for every pending item.
      const placeholder=make('div','rt-native-placeholder');placeholder.setAttribute('aria-hidden','true');
      const avatar=make('faceplate-shimmer','h-lg w-lg rounded-full shrink-0'),lines=make('div','grow');avatar.setAttribute('shape','circle');lines.append(make('faceplate-shimmer','block rounded-2 h-md w-[200px] max-w-full'),make('faceplate-shimmer','block rounded-2 h-xs w-[160px] max-w-full mt-2xs'));placeholder.append(avatar,lines);return placeholder;
    }
    feedLoader(){
      const loader=make('shreddit-loading','rt-native-loading');loader.setAttribute('aria-label','Loading public activity');if(!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches)loader.setAttribute('data-animated','');loader.append(this.placeholder());return loader;
    }
    profilePostAvatar(username){
      const avatar=make('span','inline-flex items-center justify-center w-lg h-lg relative shrink-0');avatar.setAttribute('avatar','');
      // Only profile-hosted posts use account artwork. Never modify Reddit's
      // server-rendered author/community markup or borrow another user's photo.
      const same=username.toLowerCase()===this.context.username.toLowerCase(),url=same?M.avatarUrl(this.avatarSlot?.querySelector('img')?.getAttribute('src') || document.querySelector('#profile-icon')?.getAttribute('src')):'';
      const image=make('img','mb-0 rounded-full object-contain w-full h-full');image.src=url || unavailableAvatarUrl(same?this.accountState:'deleted');image.alt='';image.width=image.height=24;image.loading='lazy';avatar.append(image);return avatar;
    }
    queueNative(node){
      if(node.hidden && !this.activeProfileBatch?.nodes.includes(node) || !node.isConnected || node.dataset.rtNativeState!=='idle')return;
      node.dataset.rtNativeState='queued';const batch=this.nativeBatch;batch.queue.push(node);
      // Collect the whole visibility notification before choosing the first card.
      if(!batch.scheduled){batch.scheduled=true;queueMicrotask(()=>{batch.scheduled=false;this.drainNative(batch);});}
    }
    drainNative(batch){
      if(batch!==this.nativeBatch || batch.blocked || pageRoute()?.key!==this.context?.key)return;
      if(batch.resumeAt>Date.now()){clearTimeout(this.nativeResumeTimer);this.nativeResumeTimer=setTimeout(()=>this.drainNative(batch),batch.resumeAt-Date.now());return;}
      // Hydration attaches Reddit's markup itself, so serial requests also keep
      // visible attachment in order, even when individual responses vary in speed.
      batch.queue.sort((a,b)=>{const position=a.compareDocumentPosition(b);return position&4?-1:position&2?1:0;});
      while(batch.active<1 && batch.queue.length){
        const node=batch.queue.shift(),post=this.postMetadata.get(node.dataset.key),generation=this.generation;
        if(!post || node.hidden && !this.activeProfileBatch?.nodes.includes(node) || !node.isConnected){node.dataset.rtNativeState='idle';continue;}
        if(this.nativeObserver && !this.activeProfileBatch?.nodes.includes(node)){const rect=node.getBoundingClientRect();if(rect.top>innerHeight+400 || rect.bottom< -400){node.dataset.rtNativeState='idle';this.nativeObserver.observe(node);continue;}}
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
          node.dataset.rtNativeState='ready';node.removeAttribute('aria-busy');this.decorateNative(this.postMetadata.get(node.dataset.key) || post,node);
          // An entrance effect must not replay when Reddit restores a virtualized card.
          if(node.isConnected && !this.batchedProfile){node.classList.add('rt-native-enter');const finish=()=>{node.classList.remove('rt-native-enter');node.removeEventListener('animationend',finish);};node.addEventListener('animationend',finish);setTimeout(finish,200);}
        },error=>{
          if(generation!==this.generation || pageRoute()?.key!==this.context?.key)return;
          if(!node.isConnected){if(this.feedSlot(node)!==node)node.dataset.rtNativeState='idle';return;}
          if(this.archiveOnly && post.source==='arctic-shift'){this.renderArchivedNative(this.postMetadata.get(node.dataset.key) || post,node);this.decorateNative(this.postMetadata.get(node.dataset.key) || post,node);return;}
          node.dataset.rtNativeState='failed';node.removeAttribute('aria-busy');node.replaceChildren();
          const fallback=make('div','rt-native-unavailable');fallback.append(link(post.title || 'View comment on Reddit',post.permalink));
          const retry=button('Retry',()=>{node.dataset.rtNativeState='idle';this.queueNative(node);});retry.title=error?.message || 'Reddit could not load this card.';fallback.append(retry);node.append(fallback);
          const archived=post.archivedBody || (post.source==='arctic-shift'?post.body:'');if(archived && !post.over18 && !post.spoiler)node.append(this.snapshot(archived));this.ensureSeparator(node);
        }).finally(()=>{batch.active--;this.settleProfileBatch();this.drainNative(batch);});
      }
    }
    ensureSeparator(node){
      const native=node.querySelector('shreddit-post,shreddit-profile-comment');
      // Feed fragments differ: posts usually supply a rule; comments often do
      // not. A rule inside the post body is content, never a feed separator.
      const supplied=[...node.querySelectorAll('hr')].some(rule=>!rule.hasAttribute('data-rt-separator') && !native?.contains(rule) && !rule.closest('.rt-post-snapshot'));
      let separator=node.querySelector('[data-rt-separator]');
      if(supplied){separator?.remove();return;}
      if(!separator){separator=make('hr','border-0 border-b-sm border-solid border-b-neutral-border-weak');separator.dataset.rtSeparator='true';}
      // Keep the separator inside the card so native virtualization, hiding and
      // opt-out move/remove it together with its content.
      if(node.lastElementChild!==separator)node.append(separator);
    }
    restoreRecoveredBodies(){
      for(const [info,original] of this.replyPatches || [])if(info.hasAttribute('data-rt-reply-info')){info.replaceChildren(...original);delete info.dataset.rtReplyInfo;delete info.dataset.rtReplySignature;}this.replyPatches=new Map();
      for(const [body,patch] of this.recoveredBodies || [])if(body.contains(patch.recovered))body.replaceChildren(...patch.original);
      for(const native of this.nativeDecorations || []){native.querySelector('[data-rt-source]')?.remove();native.querySelector('.rt-comment-source-credit')?.classList.remove('rt-comment-source-credit');native.querySelector('.rt-comment-source-host')?.classList.remove('rt-comment-source-host');}
      this.recoveredBodies=new Map();this.nativeDecorations=new Set();
    }
    recoverBody(post,native){
      const text=post.archivedBody || (post.source==='arctic-shift'?post.body:'');
      if(!text || ['[removed]','[deleted]'].includes(text) || post.over18 || post.spoiler)return false;
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
      this.repairReplyInfo(post,native);const recovered=this.recoverBody(post,native),label=this.indicator(post);if(recovered){label.title+=' · Text recovered from Arctic Shift';label.setAttribute('aria-label',label.title);}
      let badge=node.querySelector('[data-rt-source]');if(!badge || badge.title!==label.title){if(badge)badge.replaceWith(label);badge=label;badge.dataset.rtSource='true';}
      if(native.matches('shreddit-profile-comment')){
        const host=native.firstElementChild || native,credit=host.querySelector('.text-12.relative') || host.firstElementChild;host.classList.add('rt-comment-source-host');credit?.classList.add('rt-comment-source-credit');if(badge.parentElement!==host)host.append(badge);
      }else{
        const credit=native.querySelector('[slot="credit-bar"]') || native;
        let actions=credit.querySelector('shreddit-post-overflow-menu');while(actions && actions.parentElement!==credit)actions=actions.parentElement;
        if(actions){if(badge.parentElement!==actions)actions.prepend(badge);}else if(badge.parentElement!==credit){badge.style.marginInlineStart='auto';credit.append(badge);}
      }
      if(node!==native)this.ensureSeparator(node);
    }
    loadDetail(){if(!this.settings.archiveDiscovery)return;return this.run(async current=>{
      const id=this.context.id,result=await this.archive({action:'archive-ids',ids:[id]});if(!current())return;
      const archived=(result.posts || []).map(p=>M.normalizePost(p,{source:'arctic-shift'})).find(p=>p?.id===id);
      if(!archived){this.setStatus('No archived snapshot is available for this post.');return;}
      let live;try{const response=await this.request({action:'info',ids:[id]});live=response.posts?.map(p=>M.normalizePost(p,{source:'reddit'})).find(p=>p?.id===id);}catch{ /* An archive is never proof of current removal. */ }
      if(!current())return;
      this.results.replaceChildren();
      if(live?.status==='available'){this.setStatus('This post is available on Reddit. Its live content is unchanged.');return;}
      const note=make('div','rt-post-snapshot');note.append(this.indicator(live || archived));
      if(archived.over18 || archived.spoiler || live?.over18 || live?.spoiler)note.append(make('p','rt-post-source','NSFW or spoiler snapshot · open the post’s source to review content restrictions.'));
      else if(archived.body && !['[deleted]','[removed]'].includes(archived.body))note.append(this.snapshot(archived.body));else note.append(make('p','rt-post-source','The archive has no original text for this post.'));
      this.results.append(note);this.setStatus(live?`${live.status==='deleted'?'Deleted':'Removed'} on Reddit · Separate archived snapshot`:'Archived snapshot · Current Reddit status unknown');
    });}
    destroy(){this.profileStates.clear();document.removeEventListener('click',this.onNavigate,true);this.avatarUnsubscribe?.();clearTimeout(this.timer);this.observer?.disconnect();globalThis.chrome?.runtime?.onMessage?.removeListener?.(this.onWorkerSettings);window.removeEventListener('popstate',this.onRoute);document.removeEventListener('reddit:route',this.onRoute);globalThis.chrome?.storage?.onChanged?.removeListener?.(this.onSettings);this.reset();document.documentElement.removeAttribute('data-rt-profile-discovery');}
  }
  globalThis.RTPostDiscovery=Object.freeze({Discovery,pageRoute});
  if(window.top===window && globalThis.chrome?.runtime?.id)new Discovery();
})();
