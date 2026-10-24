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
  function unavailableAvatar(){
    const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');
    for(const [name,value] of Object.entries({rpl:'',fill:'currentColor',height:'32',width:'32',viewBox:'0 0 20 20','icon-name':'ban-fill','aria-hidden':'true'}))icon.setAttribute(name,value);
    // Reddit's native banned-account artwork, without document-specific clip IDs.
    const path=document.createElementNS(icon.namespaceURI,'path');path.setAttribute('d','M19.188 10.304a2.63 2.63 0 00-.776-1.873 2.825 2.825 0 00-1.493-.796c-.881-.156-1.77-.372-2.493-.899-1.177-.858-1.891-2.091-2.04-3.487-.065-.627-.374-1.236-.865-1.708-1.05-1.01-2.747-.91-3.776.12L3.905 5.5a2.63 2.63 0 00-.775 1.873c0 .707.275 1.372.776 1.872a2.792 2.792 0 001.664.82c.332.036.648.12.957.224l-4.901 4.9a2.25 2.25 0 103.182 3.18l4.9-4.9c.102.31.187.626.223.959.065.607.356 1.198.82 1.663a2.638 2.638 0 001.873.773c.678 0 1.357-.258 1.873-.773l3.915-3.915c.5-.5.776-1.165.776-1.872Z');icon.append(path);return icon;
  }
  function button(text,run,icon){const b=make('button','',text);b.type='button';if(icon)b.prepend(glyph(icon));b.addEventListener('click',run);return b;}
  function link(text,url,cls){const a=make('a',cls,text);a.href=url;a.rel='noopener noreferrer';return a;}
  class Discovery {
    constructor({reddit=redditRead,archive=archiveRead,readSettings=settingsRead,observe=true,autoDiscover=observe,nativeRenderer=null}={}){
      this.nativeRenderer=nativeRenderer;this.autoDiscover=autoDiscover;this.reddit=reddit;this.archive=archive;this.readSettings=readSettings;this.settings={postDiscovery:false,archiveDiscovery:false};this.settingsRevision=0;this.generation=0;this.controllers=new Set();this.nodes=new Map();this.host=null;
      this.settingsPending=true;this.syncProfileNotice();
      this.onRoute=()=>{this.syncProfileNotice();this.schedule();};this.onSettings=(changes,area)=>{if(area==='local' && changes[key]){this.settingsRevision++;this.settingsPending=false;this.settingsError=false;this.settings=M.normalizeSettings(changes[key].newValue);this.reset();this.scan();}};
      if(observe){this.observer=new MutationObserver(records=>{this.syncProfileNotice();this.trackVirtualization(records);if(records.some(r=>!this.ownsMutation(r)))this.schedule();});this.observer.observe(document.documentElement,{childList:true,subtree:true});window.addEventListener('popstate',this.onRoute);document.addEventListener('reddit:route',this.onRoute);globalThis.chrome?.storage?.onChanged?.addListener(this.onSettings);}
      this.onWorkerSettings=(message,sender)=>{if(message?.scope==='rt-posts' && message.action==='settings-changed' && sender?.id===globalThis.chrome?.runtime?.id)this.onSettings({[key]:{newValue:message.settings}},'local');};
      if(observe)globalThis.chrome?.runtime?.onMessage?.addListener(this.onWorkerSettings);
      this.avatarUnsubscribe=globalThis.RCSDirectory?.onChange?.(value=>{const owner=globalThis.RCSDirectory?.getOwner?.();if(value?.owner && value.owner!==owner)return;if(this.archiveOnly && this.avatarOwner && owner && this.avatarOwner!==owner){this.reset();this.scan();}else this.updateProfileAvatar(value);});
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
    reset({retainNavigation=false}={}){this.profileNavigation?.remove();if(!retainNavigation)this.profileNavigation=null;else if(this.profileNavigation?.dataset.state==='loading')this.profileNavigation.dataset.state='idle';this.archiveNotice?.removeAttribute('data-rt-archive-notice');this.archiveShell?.remove();this.archiveNotice=this.archiveNoticeAnchor=this.archiveShell=this.archiveMain=this.archiveStats=this.avatarSlot=this.avatarImage=null;this.avatarOwner=this.avatarSource='';this.failedAvatars=new Set();this.profileOverlay=false;this.archiveOnly=false;this.accountState='';this.generation++;clearTimeout(this.nativeResumeTimer);this.nativeObserver?.disconnect();this.nativeBatch={active:0,queue:[]};this.postMetadata=new Map();for(const c of this.controllers)c.abort();this.controllers.clear();if(this.emptyFeed){this.emptyFeed.hidden=this.emptyWasHidden;this.emptyFeed.removeAttribute('data-rt-empty-suppressed');}this.emptyFeed=null;for(const node of this.nodes.values()){const slot=this.feedSlot(node);if(slot!==node){
        // Reddit still owns this placeholder and may restore its detached node.
        // Retire both without removing a slot from its virtualization stack.
        slot.dataset.rtRetired='true';node.dataset.rtRetired='true';node.replaceChildren();node.hidden=true;
      }else node.remove();}this.virtualNodes=new Map();this.host?.remove();this.host=null;this.feed=null;this.context=null;this.live=new Map();this.archived=new Map();this.nodes.clear();this.after=this.before=null;this.loaded=false;this.archiveLoaded=false;this.moreReddit=this.moreArchive=false;this.busy=false;this.pages=0;this.afterByKind={};this.beforeByKind={};this.redMore={};this.archiveMore={};this.renderedPosts=[];this.summaryCounts=null;}
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
      if(context?.kind==='post' && this.context?.kind==='profile' && this.host?.isConnected && document.querySelector('#profile-feed-tabgroup')){this.profileOverlay=true;return;}
      if(this.profileOverlay && context?.key===this.context?.key){this.profileOverlay=false;if(!this.nativeBatch.active)for(const node of this.nodes.values())if(node.dataset.rtNativeState==='loading')node.dataset.rtNativeState='idle';}
      if((!this.settings.postDiscovery && !this.settingsError) || !context || location.hostname==='old.reddit.com'){if(this.host || this.context)this.reset();return;}
      if(this.context?.key===context.key && this.host?.isConnected && (!this.feed || this.feed.isConnected) && (!this.archiveOnly || this.archiveNotice?.isConnected || this.archiveNoticeAnchor?.isConnected)){this.deduplicate();this.drainNative(this.nativeBatch);return;}
      const retainNavigation=this.archiveOnly && context.kind==='profile' && this.context?.username.toLowerCase()===context.username.toLowerCase() && this.archiveShell?.isConnected && this.context.key!==context.key;
      this.reset({retainNavigation});
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
      if(this.feed && typeof IntersectionObserver==='function')this.nativeObserver=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){this.nativeObserver.unobserve(entry.target);this.queueNative(entry.target);}},{rootMargin:'400px'});this.live=new Map();this.archived=new Map();
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
      this.results=make('div','rt-posts-results');this.loading=make('div','rt-post-loading');this.loading.hidden=true;this.loading.setAttribute('aria-label','Loading posts');for(let i=0;i<2;i++)this.loading.append(this.placeholder());
      this.more=button('Load more',()=>this.loadMore());this.more.className='rt-posts-more';this.more.hidden=true;
      toolbar.append(this.status);host.append(toolbar,this.loading,this.results,this.more);
      if(context.kind==='profile'){target.before(host);this.results.hidden=true;this.more.textContent='More discoveries';toolbar.append(this.more);}else target.after(host);
      if(this.archiveOnly && this.autoDiscover)this.loadNavigation();
      this.emptyFeed=main.querySelector('#empty-feed-content');this.emptyWasHidden=this.emptyFeed?.hidden;
      if(this.settingsError)this.setStatus('Discovery settings could not be loaded. Select Retry discovery.',true);
      else if(context.kind==='profile' && this.autoDiscover)queueMicrotask(()=>{if(this.host===host){if(this.archiveOnly){if(this.settings.archiveDiscovery)this.loadArchive();}else this.loadReddit();}});
    }
    mountArchiveProfile(context,notice,anchor=notice,state='deleted'){
      this.accountState=state;this.archiveOnly=true;this.archiveNotice=notice;this.archiveNoticeAnchor=anchor;
      const layout=this.archiveShell=make('div','grid-container theme-rpl grid flex-nav-expanded');layout.dataset.rtUi='archive-profile';layout.dataset.rtUsername=context.username;layout.dataset.rtAccountState=state;layout.dir='ltr';
      const subgrid=make('div','subgrid-container m:col-start-2 box-border flex flex-col order-2 w-full m:w-[1120px] xs:px-md m:px-lg mx-auto min-h-[calc(100dvh_-_var(--shreddit-header-height))] justify-stretch');subgrid.id='subgrid-container';
      const columns=make('div','main-container gap-lg w-full flex-1 grid place-content-between grid-cols-[minmax(0,1fr)] fixed-sidebar xs:[&.fixed-sidebar]:grid-cols-[minmax(0,756px)_minmax(0,316px)] xs:[&.flex-sidebar]:grid-cols-[minmax(0,756px)_auto]');
      const shell=this.archiveMain=make('main','main w-full min-w-0');shell.id='main-content';
      const header=make('div','px-md relative pt-md flex pb-md items-end'),copy=make('div','w-full'),title=make('h1','text-24 font-bold m-0',context.username),name=make('p','m-0 text-14 text-neutral-content-weak font-semibold','u/'+context.username);
      title.dataset.testid='profile-display-name';name.dataset.testid='profile-prefixed-name';copy.append(title,name,make('p','text-12 text-neutral-content-weak my-xs','Arctic Shift archive · Coverage may be incomplete'));this.avatarSlot=make('div','flex items-center justify-center shrink-0 w-[74px] min-h-4xl overflow-hidden pe-md relative');this.avatarPlaceholder=make('span','flex items-center justify-center rounded-full bg-[color:var(--color-tone-6)] text-neutral-content-weak w-4xl h-4xl');this.avatarPlaceholder.setAttribute('role','img');this.avatarPlaceholder.setAttribute('aria-label',(state==='banned'?'Banned or suspended':'Deleted')+' account · Profile picture unavailable');this.avatarPlaceholder.append(unavailableAvatar());this.avatarSlot.append(this.avatarPlaceholder);header.append(this.avatarSlot,copy);
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
      shell.append(header,tabsContainer,this.archiveEmpty,feed);columns.append(shell,this.archiveSidebar(context));subgrid.append(columns);layout.append(subgrid,this.navigationTarget());anchor.before(layout);notice.setAttribute('data-rt-archive-notice','true');this.updateProfileAvatar();return shell;
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
    setProfileAvatar(value,source){
      const url=M.avatarUrl(value);if(!this.avatarSlot || !url || this.failedAvatars.has(url))return;
      if(this.avatarImage?.src===url)return;
      this.avatarImage?.remove();const image=this.avatarImage=make('img','block h-full m-0 object-contain max-w-full rtl-flip');image.id='profile-icon';image.alt=(this.context?.username || this.archiveShell.querySelector('h1').textContent)+' avatar';image.referrerPolicy='no-referrer';image.hidden=true;this.avatarSource=source;
      image.addEventListener('load',()=>{if(this.avatarImage===image && image.isConnected){image.hidden=false;this.avatarPlaceholder.hidden=true;}},{once:true});image.addEventListener('error',()=>{if(this.avatarImage===image){this.failedAvatars.add(url);image.remove();this.avatarImage=null;this.avatarPlaceholder.hidden=false;}},{once:true});this.avatarSlot.append(image);image.src=url;
    }
    updateProfileAvatar(change){
      if(!this.archiveOnly || !this.avatarSlot)return;
      const directory=globalThis.RCSDirectory,owner=directory?.getOwner?.() || '';
      if(this.avatarSource==='chat' && owner!==this.avatarOwner){this.avatarImage?.remove();this.avatarImage=null;this.avatarPlaceholder.hidden=false;this.avatarSource='';}
      this.avatarOwner=owner;if(!owner)return;
      const startup=directory?.getStartup?.(),entry=change?.owner===owner?{records:change.records || []}:startup?.owner===owner?startup.entry:null;
      const username=this.context?.username || this.archiveShell.querySelector('h1').textContent,avatar=M.retainedAvatar(entry,username);if(avatar)this.setProfileAvatar(avatar,'chat');
    }
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
        node.hidden=duplicate || older;node.dataset.deferred=older?'older':'';
        if(virtualized)slot.hidden=node.hidden;
        if(node.hidden){this.nativeObserver?.unobserve(node);if(duplicate && node.dataset.rtNativeState==='ready'){node.replaceChildren();node.dataset.rtNativeState='idle';}if(older)deferred++;if(!virtualized && node.parentElement!==this.results)this.results.append(node);continue;}
        count++;
        const target=normal.find(entry=>sort==='top'?entry.score<=post.score:sort==='hot'?rank.has(entry.fullname) && rank.get(entry.fullname)>rank.get(post.fullname):entry.timestamp<=post.created)?.node || tail;
        if(!buckets.has(target))buckets.set(target,[]);buckets.get(target).push(slot);
      }
      // Reconcile only extension-owned cards. Reddit retains ownership and order of its nodes.
      for(const [target,nodes] of buckets){let anchor=target;for(let i=nodes.length-1;i>=0;i--){const node=nodes[i];if(!this.virtualNodes.has(node) && (node.parentElement!==this.feed || node.nextElementSibling!==anchor))this.feed.insertBefore(node,anchor);anchor=node;}}
      for(const nodes of buckets.values())for(const node of nodes)if(node.dataset.rtNativeState==='idle'){if(this.nativeObserver)this.nativeObserver.observe(node);else this.queueNative(node);}
      this.summaryCounts={count,deferred};
      if(this.emptyFeed){this.emptyFeed.hidden=count>0 || this.emptyWasHidden;this.emptyFeed.toggleAttribute('data-rt-empty-suppressed',count>0);}
      if(!this.busy && this.status.dataset.error!=='true')this.summarize();
    }
    summarize(){
      const {count=0,deferred=0}=this.summaryCounts || {},noun=this.context.view==='comments'?(count===1?'comment':'comments'):this.context.view==='overview'?(count===1?'item':'items'):count===1?'post':'posts';
      this.setStatus(count?`${count} ${this.archiveOnly?'archived':'additional'} ${noun}`:'Activity checked');
      if(this.archiveOnly)this.updateArchiveSummary();
      if(this.archiveOnly && this.settings.archiveDiscovery){this.archiveEmpty.hidden=!this.archiveLoaded || count>0;this.archiveEmpty.textContent='No archived activity found for this username. Archive coverage may be incomplete.';}
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
      if(this.busy)return;const generation=this.generation;this.busy=true;this.host.setAttribute('aria-busy','true');this.setStatus('Checking public activity…');this.loading.hidden=this.nativeEntries().length>0 || [...this.nodes.values()].some(n=>!n.hidden && n.parentElement===this.feed);this.discover.disabled=true;if(this.archiveButton)this.archiveButton.disabled=true;this.more.disabled=true;
      try{await task(()=>generation===this.generation && pageRoute()?.key===this.context?.key && this.host?.isConnected);}
      catch(error){if(generation===this.generation && pageRoute()?.key===this.context?.key)this.setStatus(error.message,true);}
      finally{if(generation===this.generation){this.busy=false;this.host.removeAttribute('aria-busy');this.loading.hidden=true;this.discover.disabled=false;if(this.archiveButton)this.archiveButton.disabled=false;this.more.disabled=false;}}
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
    loadMore(){if(this.pages>=8){this.more.hidden=true;this.setStatus('Showing a bounded selection; history is incomplete.');return;}return this.moreReddit?this.loadReddit({more:true}):this.loadArchive({more:true});}
    render(){
      const posts=M.mergePosts([...this.live.values()],[...this.archived.values()],{username:this.context.username,visibleIds:this.visibleIds(),sort:this.context.sort,range:this.context.range});
      for(const post of posts){const key=itemKey(post);this.postMetadata.set(key,post);const previous=this.nodes.get(key);if(previous){if(previous.dataset.rtArchiveFallback==='true'){this.renderArchivedNative(post,previous);this.decorateNative(post,previous);}else if(previous.dataset.rtNativeState==='ready')this.decorateNative(post,previous);continue;}const node=this.card(post);this.results.append(node);this.nodes.set(key,node);}
      this.renderedPosts=posts;
      this.deduplicate();this.more.hidden=!(this.moreReddit || this.moreArchive) || this.pages>=8;
      this.summarize();
    }
    indicator(post){
      const removed=['deleted','removed'].includes(post.status),label=removed?`${post.status==='deleted'?'Deleted':'Removed'} on Reddit`:post.source==='arctic-shift'?'Arctic Shift snapshot · Current Reddit status unknown':'Not shown in this profile feed · Found through public Reddit search';
      const badge=make('span','rt-post-indicator');badge.setAttribute('role','img');badge.setAttribute('aria-label',label);badge.title=label;badge.dataset.state=post.status;badge.append(glyph(removed?post.status:post.source==='arctic-shift'?'archive':'hidden'));return badge;
    }
    snapshot(text){const details=make('details','rt-post-snapshot');details.append(make('summary','','Archived text · Arctic Shift'),make('pre','',text),make('p','rt-post-source','Archived snapshot; it may differ from the original or current post.'));return details;}
    renderArchivedNative(post,node){
      // Reddit may no longer serve a fragment for this identity. Reuse its own
      // card components, layout classes and action row with historical values.
      // Archive strings are always text, never server HTML or executable markup.
      node.replaceChildren();node.dataset.rtArchiveFallback='true';node.dataset.rtNativeState='ready';node.removeAttribute('aria-busy');
      const isComment=post.kind==='comment',native=make(isComment?'shreddit-profile-comment':'shreddit-post');
      const body=post.over18 || post.spoiler?'NSFW or spoiler snapshot · Open the source to review content restrictions.':post.body && !['[deleted]','[removed]'].includes(post.body)?post.body:'The archive has no original text for this item.';
      const date=make('faceplate-timeago');date.setAttribute('ts',new Date(post.created*1000).toISOString());date.setAttribute('short','');
      const community=link('r/'+post.subreddit,'/r/'+encodeURIComponent(post.subreddit)+'/','font-semibold text-12 text-neutral-content-strong no-underline hover:underline');
      const author=link(post.author,'/user/'+post.author+'/','font-bold text-12 text-neutral-content-strong hover:underline');
      native.setAttribute('data-feed-element-id',post.fullname);
      if(isComment){
        native.className='w-full nd:visible rounded-4 my-2xs';native.setAttribute('comment-id',post.fullname);native.setAttribute('href',post.permalink);
        const inner=make('div','hover:bg-neutral-background-hover relative rounded-4'),padding=make('div','px-md py-sm'),credit=make('div','text-12 relative w-fit'),context=make('div','flex items-center');
        const heading=make('h2','inline-block m-0');heading.append(link(post.title || 'View post',post.permalink,'text-neutral-content-strong font-normal hover:underline'));
        context.append(community,make('span','px-2xs',' • '),heading);const identity=make('div','text-neutral-content-weak inline-block ms-xl mt-2xs');identity.append(author,document.createTextNode(' commented '),date);credit.append(context,identity);
        const content=make('div','ms-[22px] mt-2xs ps-[10px] md'),text=make('div','md pt-xs pb-2xs whitespace-pre-wrap break-words');text.append(make('p','',body));content.append(text);
        const actions=make('div','block ms-lg relative'),row=make('shreddit-comment-action-row','block');row.setAttribute('comment-id',post.fullname);row.setAttribute('score',String(post.score));row.setAttribute('permalink',post.permalink);row.setAttribute('telemetry-source','profile');row.setAttribute('vote-state','NONE');row.setAttribute('is-desktop-viewport','true');row.setAttribute('inert','');row.setAttribute('aria-disabled','true');row.title='Archived values · Current actions unavailable';
        const reply=link('',post.permalink,'button rpl-cab border-sm text-label-2 button-plain-weak inline-flex items-center px-sm py-xs');reply.slot='comment-reply';reply.style.height='var(--size-button-sm-h)';const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');for(const [key,value] of Object.entries({rpl:'','aria-hidden':'true','fill':'currentColor',height:'16',width:'16',viewBox:'0 0 20 20','icon-name':'comment'}))icon.setAttribute(key,value);const path=document.createElementNS(icon.namespaceURI,'path');path.setAttribute('d','M10 1a9 9 0 00-9 9c0 1.947.79 3.58 1.935 4.957L.231 17.661A.784.784 0 00.785 19H10a9 9 0 009-9 9 9 0 00-9-9Zm0 16.2H6.162c-.994.004-1.907.053-3.045.144l-.076-.188a36.981 36.981 0 002.328-2.087l-1.05-1.263C3.297 12.576 2.8 11.331 2.8 10c0-3.97 3.23-7.2 7.2-7.2s7.2 3.23 7.2 7.2-3.23 7.2-7.2 7.2Z');icon.append(path);const leading=make('span','flex text-body-1 me-2xs');leading.append(icon);reply.append(leading,make('span','rpl-cab--content','Reply'));
        const share=make('shreddit-comment-share-button');share.setAttribute('slot','comment-share');share.setAttribute('permalink',post.permalink);share.setAttribute('is-desktop-viewport','true');row.append(reply,share);actions.append(row);padding.append(credit,content,actions);inner.append(padding);native.append(inner);
      }else{
        native.className='block relative cursor-pointer group bg-neutral-background focus-within:bg-neutral-background-hover hover:bg-neutral-background-hover xs:rounded-4 px-md py-2xs my-2xs nd:visible';native.id=post.fullname;
        for(const [key,value] of Object.entries({'permalink':post.permalink,'view-context':'ProfileFeed2','view-type':'cardView','post-type':'text','post-title':post.title,'author':post.author,'subreddit-name':post.subreddit,'subreddit-prefixed-name':'r/'+post.subreddit,'score':post.score,'comment-count':post.comments,'created-timestamp':new Date(post.created*1000).toISOString()}))native.setAttribute(key,String(value));
        native.setAttribute('is-author-deleted','');const credit=make('span','flex justify-between text-12 min-h-[32px] mb-2xs -mt-2xs');credit.slot='credit-bar';const identity=make('span','flex items-center gap-xs');identity.append(community,document.createTextNode(' · '),date);credit.append(identity);
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
      const placeholder=make('div','rt-native-placeholder');placeholder.setAttribute('aria-label','Loading Reddit card');
      const avatar=make('div','shimmer-placeholder h-lg w-lg bg-shimmer rounded-full'),lines=make('div','grow');lines.append(make('div','shimmer-placeholder bg-shimmer rounded-2 h-md w-[200px] max-w-full'),make('div','shimmer-placeholder bg-shimmer rounded-2 h-xs w-[160px] max-w-full mt-2xs'));placeholder.append(avatar,lines);return placeholder;
    }
    queueNative(node){
      if(node.hidden || !node.isConnected || node.dataset.rtNativeState!=='idle')return;
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
        if(!post || node.hidden || !node.isConnected){node.dataset.rtNativeState='idle';continue;}
        if(this.nativeObserver){const rect=node.getBoundingClientRect();if(rect.top>innerHeight+400 || rect.bottom< -400){node.dataset.rtNativeState='idle';this.nativeObserver.observe(node);continue;}}
        batch.active++;node.dataset.rtNativeState='loading';
        const operation=this.nativeRenderer?this.nativeRenderer(post,node):this.request({action:'render-card',username:this.context.username,kind:post.kind==='comment'?'comment':'post',postId:post.id,target:node.id});
        Promise.resolve(operation).then(result=>{
          if(generation!==this.generation || pageRoute()?.key!==this.context?.key)return;
          if(!node.isConnected && (this.feedSlot(node)===node || !node.querySelector('shreddit-post,shreddit-profile-comment'))){if(this.feedSlot(node)!==node)node.dataset.rtNativeState='idle';return;}
          if(result?.deferred){
            node.dataset.rtNativeState='queued';batch.queue.push(node);const now=Date.now(),retryAt=now+Math.max(100,Math.min(3600000,Number(result.retryAfterMs)||1000));batch.resumeAt=Math.max(batch.resumeAt||0,retryAt);
            if(result.reason==='rate-limit'){
              if(batch.serverRetryAt && now>=batch.serverRetryAt){batch.blocked=true;this.setStatus('Reddit is limiting card requests. Select Refresh activity to retry.',true);}
              else batch.serverRetryAt=retryAt;
            }
            return;
          }
          if(result?.duplicate){node.dataset.rtNativeState='idle';node.replaceChildren();node.removeAttribute('aria-busy');this.deduplicate();return;}
          node.dataset.rtNativeState='ready';node.removeAttribute('aria-busy');this.decorateNative(this.postMetadata.get(node.dataset.key) || post,node);
          // An entrance effect must not replay when Reddit restores a virtualized card.
          if(node.isConnected){node.classList.add('rt-native-enter');const finish=()=>{node.classList.remove('rt-native-enter');node.removeEventListener('animationend',finish);};node.addEventListener('animationend',finish);setTimeout(finish,200);}
        },error=>{
          if(generation!==this.generation || pageRoute()?.key!==this.context?.key)return;
          if(!node.isConnected){if(this.feedSlot(node)!==node)node.dataset.rtNativeState='idle';return;}
          if(this.archiveOnly && post.source==='arctic-shift'){this.renderArchivedNative(this.postMetadata.get(node.dataset.key) || post,node);this.decorateNative(this.postMetadata.get(node.dataset.key) || post,node);return;}
          node.dataset.rtNativeState='failed';node.removeAttribute('aria-busy');node.replaceChildren();
          const fallback=make('div','rt-native-unavailable');fallback.append(link(post.title || 'View comment on Reddit',post.permalink));
          const retry=button('Retry',()=>{node.dataset.rtNativeState='idle';this.queueNative(node);});retry.title=error?.message || 'Reddit could not load this card.';fallback.append(retry);node.append(fallback);
          const archived=post.archivedBody || (post.source==='arctic-shift'?post.body:'');if(archived && !post.over18 && !post.spoiler)node.append(this.snapshot(archived));this.ensureSeparator(node);
        }).finally(()=>{batch.active--;this.drainNative(batch);});
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
    decorateNative(post,node){
      node.querySelector('[data-rt-source]')?.remove();node.querySelector('[data-rt-archive]')?.remove();
      const native=node.querySelector('shreddit-post,shreddit-profile-comment');
      if(this.archiveOnly && post.author.toLowerCase()===this.context.username.toLowerCase() && (native?.getAttribute('author')?.toLowerCase()===this.context.username.toLowerCase() || native?.hasAttribute('is-author-deleted')))this.setProfileAvatar(native.getAttribute('icon'),'native');
      const credit=native?.querySelector('[slot="credit-bar"]') || native?.querySelector('faceplate-timeago')?.parentElement || native;
      if(credit){const badge=this.indicator(post);badge.dataset.rtSource='true';let actions=credit.querySelector('shreddit-post-overflow-menu');while(actions && actions.parentElement!==credit)actions=actions.parentElement;if(actions)actions.prepend(badge);else credit.append(badge);}
      const archived=post.archivedBody || (post.source==='arctic-shift'?post.body:'');
      if(node.dataset.rtArchiveFallback!=='true' && archived && !['[removed]','[deleted]'].includes(archived) && !post.over18 && !post.spoiler){const extra=this.snapshot(archived);extra.dataset.rtArchive='true';node.append(extra);}
      this.ensureSeparator(node);
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
    destroy(){this.avatarUnsubscribe?.();clearTimeout(this.timer);this.observer?.disconnect();globalThis.chrome?.runtime?.onMessage?.removeListener?.(this.onWorkerSettings);window.removeEventListener('popstate',this.onRoute);document.removeEventListener('reddit:route',this.onRoute);globalThis.chrome?.storage?.onChanged?.removeListener?.(this.onSettings);this.reset();document.documentElement.removeAttribute('data-rt-profile-discovery');}
  }
  globalThis.RTPostDiscovery=Object.freeze({Discovery,pageRoute});
  if(window.top===window && globalThis.chrome?.runtime?.id)new Discovery();
})();
