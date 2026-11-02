/* Subreddit archive: for communities Reddit itself will not show (banned, private).
   - Feed: Reddit's notice gets a "Browse archived posts" action; choosing it shows the archive
     laid out like a normal subreddit page (banner, header, sort/time/type row, cards, sidebar).
   - Search: Reddit's own header search lands on Reddit's own search page, which stays empty for
     these communities. We fill that page with archive results in Reddit's search-row markup, and
     Reddit's tabs (Posts/Comments/Media) and sort/time controls drive the archive query.
   Live, quarantined (gated) and nonexistent communities are never touched. Data comes from the
   Arctic Shift archive through RTArchiveQuery; coverage is always described as partial. */
(() => {
  'use strict';
  if(globalThis.RTSubredditArchive)return;
  const holdAttr='data-rt-subreddit-hold',mountedAttr='data-rt-subreddit-mounted',hiddenAttr='data-rt-archive-hidden';
  const nameOK=value=>typeof value==='string' && /^[A-Za-z0-9_]{2,21}$/.test(value);
  const make=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text!=null && text!=='')el.textContent=text;return el;};
  const glyph=kind=>globalThis.RTPostDiscovery?.glyph?.(kind) || document.createElementNS('http://www.w3.org/2000/svg','svg');
  const day=seconds=>new Date(seconds*1000).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});
  const compact=n=>new Intl.NumberFormat(undefined,{notation:'compact',maximumFractionDigits:1}).format(n);
  const MAX_STATES=16;
  const postFields=['title','body','author','site','url','flair','self','nsfw','spoiler','type'];
  const commentFields=['body','author'];
  const mediaTypes=['image','gif','video','gallery'];
  const windows={hour:3600,day:86400,week:604800,month:2592000,year:31536000};

  // The community notice text decides: only Reddit's own "is banned" / "is private" wording qualifies.
  // Quarantine ("Yes, Continue" gate) and every other state stay untouched.
  function unavailable(modal){
    if(!modal?.matches?.('guard-community-modal[subredditname]') || !nameOK(modal.getAttribute('subredditname')))return '';
    const title=(modal.querySelector('[slot="title"]')?.textContent || '').replace(/\s+/g,' ').trim();
    if(/\bis banned\.?$/i.test(title))return 'banned';
    // Private pages were not observed live; the same slot/wording is assumed.
    if(/\bis private\.?$/i.test(title))return 'private';
    return '';
  }
  function hold(modal){modal.setAttribute(holdAttr,'true');modal.style.setProperty('display','none','important');}
  function release(modal){if(!modal || modal.hasAttribute(mountedAttr))return;modal.removeAttribute(holdAttr);modal.style.removeProperty('display');if(!modal.getAttribute('style'))modal.removeAttribute('style');}
  const viewRequested=()=>new URLSearchParams(location.search).get('rt_view')==='archive';
  function setParams(changes){
    const url=new URL(location.href);
    for(const [name,value] of Object.entries(changes)){if(value==null || value==='')url.searchParams.delete(name);else url.searchParams.set(name,value);}
    try{history.replaceState(history.state,'',url.pathname+url.search+url.hash);}catch{}
  }
  async function defaultSettings(){
    const response=await chrome.runtime.sendMessage({scope:'rt-posts',action:'get-settings'});
    const s=response?.settings;return {enabled:response?.ok===true && s?.postDiscovery!==false && s?.archiveDiscovery===true};
  }
  // Reddit's own search page for a community: /r/<name>/search/?q=…&type=…&sort=…&t=…
  function searchRoute(){
    const match=location.pathname.match(/^\/r\/([A-Za-z0-9_]{2,21})\/search\/?$/i);if(!match)return null;
    const params=new URLSearchParams(location.search),pick=(key,list,fallback)=>list.includes(params.get(key))?params.get(key):fallback;
    return {name:match[1],q:(params.get('q') || '').trim().slice(0,256),type:pick('type',['posts','comments','media'],'posts'),sort:pick('sort',['relevance','hot','top','new','comments'],'relevance'),t:pick('t',['hour','day','week','month','year','all'],'all')};
  }
  // Reddit's public about.json says why a community is gone ("banned"/"private"); anything else is not ours.
  const communityCache=new Map();
  async function defaultCommunityState(name){
    const key=name.toLowerCase();if(communityCache.has(key))return communityCache.get(key);
    const pending=(async()=>{
      try{
        // Same-origin read of a public endpoint; logged-out JSON requests are refused outright.
        const response=await fetch('/r/'+encodeURIComponent(name)+'/about.json',{credentials:'same-origin',headers:{Accept:'application/json'}});
        if(response.ok)return '';
        const data=await response.json().catch(()=>null);
        return ['banned','private'].includes(data?.reason)?data.reason:'';
      }catch{communityCache.delete(key);return '';}
    })();
    communityCache.set(key,pending);return pending;
  }

  class SubredditArchive {
    constructor({readSettings=defaultSettings,getOwner=null,observe=true,communityState=defaultCommunityState}={}){
      this.readSettings=readSettings;this.communityState=communityState;
      this.getOwner=getOwner || (()=>globalThis.RCSDirectory?.getOwner?.() || globalThis.RCSMessages?.getSelfIdentity?.()?.id || '');
      this.enabled=null;this.mounted=null;this.search=null;this.states=new Map();this.top=false;this.openMenuEl=null;this.dead=false;this.meta=null;this.metaName='';
      this.onRoute=()=>this.scan();
      this.onDocClick=event=>{if(this.openMenuEl && !this.openMenuEl.parentElement.contains(event.target))this.closeMenus();};
      this.onKey=event=>{if(event.key==='Escape' && this.openMenuEl){const button=this.openMenuEl.parentElement.querySelector('button');this.closeMenus();button?.focus({preventScroll:true});}};
      document.addEventListener('click',this.onDocClick,true);document.addEventListener('keydown',this.onKey,true);
      if(observe){
        this.observer=new MutationObserver(()=>this.scan());this.observer.observe(document.documentElement,{childList:true,subtree:true});
        window.addEventListener('popstate',this.onRoute);document.addEventListener('reddit:route',this.onRoute);
        this.onSettings=(changes,area)=>{if(area==='local' && changes['rt-settings-v1'])this.loadSettings();};
        try{chrome.storage?.onChanged?.addListener(this.onSettings);}catch{}
      }
      this.ready=this.loadSettings();
    }
    async loadSettings(){
      let enabled=false;try{enabled=(await this.readSettings())?.enabled===true;}catch{}
      if(this.dead)return;this.enabled=enabled;this.scan();
    }
    destroy(){
      this.dead=true;this.observer?.disconnect();window.removeEventListener('popstate',this.onRoute);document.removeEventListener('reddit:route',this.onRoute);
      document.removeEventListener('click',this.onDocClick,true);document.removeEventListener('keydown',this.onKey,true);
      try{chrome.storage?.onChanged?.removeListener(this.onSettings);}catch{}this.unmount();this.unmountSearch();
    }

    // Called on every relevant change. Until settings are known nothing is added (an early hold may stay).
    scan(){
      if(this.dead || this.enabled===null)return;
      const route=this.enabled?searchRoute():null;
      if(route){this.unmount();this.scanSearch(route);return;}
      this.unmountSearch();
      const modal=document.querySelector('guard-community-modal[subredditname]'),kind=this.enabled?unavailable(modal):'';
      if(this.mounted && (!kind || modal!==this.mounted.modal || !viewRequested())){this.unmount();}
      if(!modal)return;
      if(!kind){modal.querySelector('[data-rt-ui="subreddit-archive-action"]')?.remove();release(modal);return;}
      this.ensureButton(modal,kind);
      if(viewRequested() && !this.mounted)this.mount(modal,kind);
    }

    ensureButton(modal,kind){
      if(modal.querySelector('[data-rt-ui="subreddit-archive-action"]'))return;
      // Same classes as the notice's own secondary button, placed in the same slot as its primary one.
      const slot=make('div');slot.setAttribute('slot','primaryButton');slot.dataset.rtUi='subreddit-archive-action';
      const button=make('button','w-100 button-medium px-[calc(var(--rem12)-var(--button-border-width,0px))] button-secondary items-center justify-center button inline-flex');button.type='button';button.setAttribute('rpl','');
      const outer=make('span','flex items-center justify-center');outer.append(make('span','flex items-center gap-xs','Browse archived posts'));button.append(outer);
      button.addEventListener('click',event=>{event.preventDefault();setParams({rt_view:'archive'});this.scan();});
      slot.append(button);modal.append(slot);
    }

    // ---- community metadata (shared by the feed header and both sidebars) -------------------------------------
    async loadMeta(name,onLoad){
      if(this.metaName===name.toLowerCase()){if(this.meta)onLoad();return;}
      this.metaName=name.toLowerCase();this.meta=null;
      const Q=globalThis.RTArchiveQuery;if(!Q?.subreddit)return;
      try{const response=await Q.subreddit(name);if(this.metaName!==name.toLowerCase() || !response?.subreddit)return;this.meta=response.subreddit;onLoad();}catch{/* banned communities often have no metadata */}
    }
    avatar(size){
      const icon=globalThis.RTPostModel?.avatarUrl?.(this.meta?.icon || '');
      if(icon){const image=make('img','rt-sra-icon');image.src=icon;image.alt='';image.width=image.height=size;image.referrerPolicy='no-referrer';image.decoding='async';image.addEventListener('error',()=>image.replaceWith(this.placeholderAvatar(size)),{once:true});return image;}
      return this.placeholderAvatar(size);
    }
    placeholderAvatar(size){
      const svg=globalThis.RTFeedFilters?.svgIcon?.('community-fill',size);if(svg){svg.classList.add('rt-sra-glyph');return svg;}
      return make('span','rt-sra-glyph');
    }
    // Reddit's community card: title, description, created date, state, members, then one archive note.
    communityPanel(name,kind){
      const meta=this.meta,panel=make('div','rt-sra-about');panel.dataset.rtUi='archive-community-info';
      panel.append(make('h2','rt-sra-about-title',meta?.title && meta.title.toLowerCase()!==name.toLowerCase()?meta.title:'r/'+name));
      if(meta?.description)panel.append(make('p','rt-sra-about-text',meta.description));
      const facts=make('ul','rt-sra-facts');
      const fact=(icon,text)=>{const li=make('li','rt-sra-fact'),art=glyph(icon);li.append(art,make('span','',text));facts.append(li);};
      if(meta?.created)fact('calendar','Created '+day(meta.created));
      fact(kind==='private'?'hidden':'removed',kind==='private'?'Private':'Banned');
      panel.append(facts);
      if(meta?.subscribers){const stats=make('dl','rt-sra-stats'),item=make('div');item.append(make('dd','',compact(meta.subscribers)),make('dt','','Members'));stats.append(item);panel.append(stats);}
      const note=make('p','rt-sra-about-note'),link=make('a','','Arctic Shift');link.href='https://arctic-shift.photon-reddit.com/';link.rel='noopener noreferrer';link.target='_blank';
      note.append(document.createTextNode('Archived posts from '),link,document.createTextNode('. Coverage may be partial.'));panel.append(note);
      return panel;
    }

    // ---- feed page ----------------------------------------------------------------------------------------------
    mount(modal,kind){
      const name=modal.getAttribute('subredditname'),f=globalThis.RTFeedFilters,params=new URLSearchParams(location.search);
      this.name=name;this.kind=kind;this.filters=f?f.read(location):null;this.top=params.get('rt_top')==='1';this.states=new Map();
      modal.setAttribute(mountedAttr,'true');hold(modal);
      const layout=this.layout=make('div','grid-container theme-rpl grid flex-nav-expanded');layout.dataset.rtUi='archive-subreddit';layout.dataset.rtSubreddit=name;layout.dir='ltr';
      const subgrid=make('div','subgrid-container m:col-start-2 box-border flex flex-col order-2 w-full m:w-[1120px] xs:px-md m:px-lg mx-auto min-h-[calc(100dvh_-_var(--shreddit-header-height))] justify-stretch');subgrid.id='subgrid-container';
      this.headerEl=make('div','masthead w-full relative subreddit-feed-masthead rt-sra-header');this.headerEl.dataset.rtUi='archive-header';this.renderHeader();
      const columns=make('div','main-container gap-lg w-full flex-1 grid place-content-between grid-cols-[minmax(0,1fr)] fixed-sidebar xs:[&.fixed-sidebar]:grid-cols-[minmax(0,756px)_minmax(0,316px)] xs:[&.flex-sidebar]:grid-cols-[minmax(0,756px)_auto]');
      const main=make('main','main w-full min-w-0');main.id='main-content';
      this.listEl=make('shreddit-feed','nd:visible');this.listEl.dataset.rtArchiveFeed='true';this.listEl.setAttribute('aria-live','polite');
      this.footEl=make('div','rt-sra-foot');this.sentinel=make('div','rt-sra-sentinel');this.sentinel.setAttribute('aria-hidden','true');
      this.statusTop=make('p','rt-sra-note text-12 text-neutral-content-weak');this.statusTop.hidden=true;
      main.append(this.buildControls(),make('hr','border-0 border-b-sm border-solid border-b-neutral-border-weak'),this.statusTop,this.listEl,this.footEl,this.sentinel);
      const sidebar=this.sidebarEl=make('aside','right-sidebar min-w-0 w-[316px] max-w-[316px] hidden xs:block styled-scrollbars xs:sticky xs:top-[56px] xs:max-h-screen-without-header xs:overflow-y-auto xs:overflow-x-hidden');sidebar.id='right-sidebar-container';
      this.renderSidebar();
      columns.append(main,sidebar);subgrid.append(this.headerEl,columns);layout.append(subgrid);modal.before(layout);
      document.documentElement.setAttribute('data-rt-subreddit-archive','');
      this.mounted={modal,kind,name};
      if(typeof IntersectionObserver==='function'){this.io=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting))this.loadMore();},{rootMargin:'800px 0px'});this.io.observe(this.sentinel);}
      this.loadMeta(name,()=>{if(this.mounted?.name===name){this.renderHeader();this.renderSidebar();}});this.syncAll();this.refresh();
    }
    unmount(){
      const m=this.mounted;if(!m)return;this.mounted=null;
      this.io?.disconnect();this.io=null;this.pickerHost?.remove();this.closeMenus();
      for(const state of this.states.values())state.gen++;
      this.layout?.remove();this.layout=null;m.modal.removeAttribute(mountedAttr);
      document.documentElement.removeAttribute('data-rt-subreddit-archive');
      if(this.dead || !viewRequested() && m.modal.isConnected)release(m.modal);
    }
    // Reddit's subreddit header: banner, overlapping avatar, r/name, and the community state where Join would be.
    renderHeader(){
      const header=this.headerEl,name=this.name;header.replaceChildren();
      const banner=make('div','rt-sra-banner');banner.setAttribute('aria-hidden','true');
      const row=make('section','flex relative items-center xs:items-end justify-between px-md xs:-top-[2.25rem] xs:-mb-[2.25rem] mt-xs mb-2xs xs:mt-0 rt-sra-header-row');
      const content=make('div','flex flex-1 items-end justify-between flex-col xs:flex-row rt-sra-header-content'),identity=make('div','flex items-end justify-start xs:justify-center gap-xs w-100 xs:w-auto rt-sra-identity');
      const avatar=make('div','xs:w-[88px] xs:h-[88px] w-2xl h-2xl text-48 shrink-0 rt-sra-avatar');avatar.append(this.avatar(88));
      const titleWrap=make('div','flex flex-col'),title=make('h1','flex items-center font-bold text-18 xs:text-32 mb-0 text-neutral-content-strong rt-sra-name','r/'+name);title.dataset.testid='subreddit-name';
      const state=make('span','rt-sra-state');state.dataset.testid='subreddit-archive-state';state.dataset.state=this.kind;
      state.append(glyph(this.kind==='banned'?'removed':'hidden'),make('span','',(this.kind==='private'?'Private':'Banned')+' · Archived posts'));
      state.title=(this.kind==='private'?'r/'+name+' is private':'r/'+name+' is banned')+'. Showing archived posts.';
      titleWrap.append(title);identity.append(avatar,titleWrap);const actions=make('div','flex w-100 xs:w-auto mt-xs xs:mt-0 items-center gap-sm rt-sra-header-actions');actions.append(state);content.append(identity,actions);row.append(content);header.append(banner,row);
    }
    renderSidebar(){
      if(!this.sidebarEl)return;const content=make('div','right-sidebar-contents flex-auto'),panel=make('section','rt-sra-sidebar-panel');panel.setAttribute('aria-label','Archived community information');
      panel.append(this.communityPanel(this.name,this.kind));content.append(panel);this.sidebarEl.replaceChildren(content);
    }

    // ---- feed controls: Reddit's row of sort / time / type dropdowns ---------------------------------------------
    filterState(){return this.filters || {date:null,types:[],subreddits:[],sort:null};}
    sortMode(){const sort=this.filterState().sort;if(sort==='old')return 'old';if(this.top)return 'top';if(sort==='comments')return 'comments';return 'new';}
    applyFilters(next,{top=this.top}={}){
      const f=globalThis.RTFeedFilters;this.filters=f?f.clone(next):next;this.top=top && !this.filters.sort;
      if(f)f.write(this.filters);setParams({rt_top:this.top?'1':null});
      this.syncAll();this.refresh();
    }
    dropdown(label,build){
      const wrap=make('div','rt-sra-dropdown'),button=make('button','rt-sra-dropdown-button');button.type='button';button.setAttribute('aria-haspopup','menu');button.setAttribute('aria-expanded','false');
      const text=make('span','',label);button.append(text,glyph('caret-down'));
      const menu=make('div','rt-sra-menu');menu.setAttribute('role','menu');menu.hidden=true;menu.dataset.rtUi='subreddit-menu';
      button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();const open=menu.hidden;this.closeMenus();if(open){this.syncMenu();menu.hidden=false;button.setAttribute('aria-expanded','true');this.openMenuEl=menu;}});
      wrap.append(button,menu);build(menu);return {wrap,button,text,menu};
    }
    closeMenus(){if(!this.openMenuEl)return;this.openMenuEl.hidden=true;this.openMenuEl.parentElement?.querySelector('button')?.setAttribute('aria-expanded','false');this.openMenuEl=null;}
    buildControls(){
      const f=globalThis.RTFeedFilters,wrap=make('div','rt-sra-controls');wrap.dataset.rtUi='subreddit-controls';
      const fx=this.fx=f.plainContext(glyph,{role:'menuitemradio'}),current=()=>f.clone(this.filterState());this.menuRows={sort:new Map(),date:new Map()};
      const close=()=>this.closeMenus();
      const option=(menu,group,key,options)=>{const el=f.menuOption(fx,options);el.dataset.rtUi='filter-option';menu.append(el);this.menuRows[group].set(key,el);return el;};
      this.sortMenu=this.dropdown('New',menu=>{
        option(menu,'sort','new',{label:'New',icon:'new',value:'new',onSelect:()=>{const next=current();next.sort=null;this.applyFilters(next,{top:false});close();}});
        option(menu,'sort','old',{label:'Old',icon:'archive',value:'old',onSelect:()=>{const next=current();next.sort='old';this.applyFilters(next,{top:false});close();}});
        option(menu,'sort','top',{label:'Top',subtitle:'Among loaded posts',icon:'top',value:'top',onSelect:()=>{const next=current();next.sort=null;this.applyFilters(next,{top:true});close();}});
        option(menu,'sort','comments',{label:'Most commented',subtitle:'Among loaded posts',icon:'comment',value:'comments',onSelect:()=>{const next=current();next.sort='comments';this.applyFilters(next,{top:false});close();}});
      });
      this.dateMenu=this.dropdown('All time',menu=>{
        option(menu,'date','any',{label:'All time',icon:false,value:'any',onSelect:()=>{const next=current();next.date=null;this.applyFilters(next);close();}});
        for(const preset of f.presets)option(menu,'date',preset.id,{label:preset.label,icon:false,value:preset.id,onSelect:()=>{const next=current();next.date={preset:preset.id};this.applyFilters(next);close();}});
        option(menu,'date','custom',{label:'Custom range…',icon:false,value:'custom',onSelect:()=>{close();this.openDatePicker();}});
      });
      this.typeMenu=this.dropdown('All posts',menu=>{
        this.typeList=f.typeOptions(fx,{iconSize:16,outline:true,allIcon:'show',append:el=>menu.append(el),onClear:()=>{const next=current();next.types=[];this.applyFilters(next);},onToggle:name=>{const next=current();next.types=next.types.includes(name)?next.types.filter(x=>x!==name):[...next.types,name];this.applyFilters(next);}});
        for(const el of this.typeList.elements)el.setAttribute('role',el.dataset.rtSection?'presentation':'menuitemcheckbox');
      });
      this.chipsEl=make('div','rt-filter-chips');this.chipsEl.hidden=true;
      const row=make('div','rt-sra-control-row');row.append(this.sortMenu.wrap,this.dateMenu.wrap,this.typeMenu.wrap);wrap.append(row,this.chipsEl);
      return wrap;
    }
    syncMenu(){
      const f=globalThis.RTFeedFilters;if(!f || !this.menuRows)return;const state=this.filterState(),mode=this.sortMode();
      for(const [key,el] of this.menuRows.sort)f.markChecked(this.fx,el,key===mode);
      for(const [key,el] of this.menuRows.date)f.markChecked(this.fx,el,key==='any'?!state.date:key==='custom'?Boolean(state.date?.from):state.date?.preset===key);
      this.typeList.sync(state.types);
      this.sortMenu.text.textContent={new:'New',old:'Old',top:'Top',comments:'Most commented'}[mode];
      const labels=f.valueLabels?f.valueLabels(state):{};
      this.dateMenu.text.textContent=state.date?labels.date || 'Custom range':'All time';
      this.typeMenu.text.textContent=state.types.length?labels.type || state.types.length+' types':'All posts';
    }
    renderChips(){
      const f=globalThis.RTFeedFilters;if(!f)return;
      // Chips only for what the dropdown labels can't show at a glance (several types, custom ranges).
      f.renderChips(this.chipsEl,{...f.clone(this.filterState()),sort:null},{make,glyph,onChange:next=>this.applyFilters({...next,sort:this.filterState().sort})});
    }
    openDatePicker(){
      const Picker=globalThis.RCSDatePicker,f=globalThis.RTFeedFilters;if(!Picker || !f)return;
      this.pickerHost?.remove();const host=this.pickerHost=make('div');host.dataset.rtUi='date-picker';
      const anchor=this.dateMenu.button.getBoundingClientRect?.() || {left:0,bottom:0};
      host.style.cssText=`position:fixed;z-index:2147483000;pointer-events:none;width:0;height:0;left:${Math.max(0,Math.round(anchor.left))}px;top:${Math.max(0,Math.round(anchor.bottom))}px`;
      const shadow=host.attachShadow({mode:'open'}),style=make('style','',`:host{--rcs-bg:var(--color-neutral-background,#fff);--rcs-soft:var(--color-neutral-background-weak,#f2f4f5);--rcs-text:var(--color-neutral-content-strong,#0f1a1c);--rcs-muted:var(--color-neutral-content-weak,#576f76);--rcs-line:var(--color-neutral-border-weak,#e5e8eb);--rcs-hover:var(--color-neutral-background-hover,#e8edef);--rcs-accent:#ff4500}.date-popover{pointer-events:auto;left:0;right:auto;top:4px}`+(Picker.styles || ''));
      const away=event=>{if(!event.composedPath().includes(host))picker.close(false);};
      const picker=new Picker({getAnchor:()=>anchor,onChange:bounds=>{
        const today=new Date(),iso=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`,from=bounds.from || '2005-06-01',to=bounds.to || iso,next=f.clone(this.filterState());
        next.date={from:from<=to?from:to,to:from<=to?to:from};this.applyFilters(next);},onClose:()=>{document.removeEventListener('pointerdown',away,true);host.remove();this.dateMenu?.button?.focus?.({preventScroll:true});}});
      const date=this.filterState().date;if(date?.from)picker.applied={mode:'Between',start:date.from,end:date.to};
      shadow.append(style,picker.element);document.body.append(host);picker.show();document.addEventListener('pointerdown',away,true);
    }

    // ---- search page -----------------------------------------------------------------------------------------------
    async scanSearch(route){
      const key=JSON.stringify(route);
      if(this.search?.key===key){this.ensureSearchMounted();return;}
      this.unmountSearch();
      const search=this.search={key,route,kind:null,checking:true,hidden:new Map(),states:new Map()};
      let kind='';try{kind=await this.communityState(route.name);}catch{}
      if(this.search!==search)return;search.checking=false;search.kind=kind;
      if(!kind){this.search={key,route,kind:'',inactive:true};return;}
      this.loadMeta(route.name,()=>{if(this.search===search)this.fillSearchSidebar(true);});
      this.ensureSearchMounted();
    }
    unmountSearch(){
      const search=this.search;if(!search)return;this.search=null;
      search.io?.disconnect();for(const state of search.states?.values() || [])state.gen++;
      search.host?.remove();search.sidebar?.remove();
      for(const [group,original] of search.tabGroups || []){group.pageNames=original.names;group.pages=original.pages;group.pageIndex=original.index;}
      for(const [node,hidden] of search.hidden || []){node.hidden=hidden;node.removeAttribute(hiddenAttr);}
      document.documentElement.removeAttribute('data-rt-subreddit-archive-search');
    }
    // Reddit re-renders its search page on tab/sort changes: re-attach idempotently.
    ensureSearchMounted(){
      const search=this.search;if(!search || search.inactive || search.checking)return;
      const main=document.querySelector('main');if(!main)return;
      for(const node of main.querySelectorAll('[data-testid="search-error-message"],[data-testid="search-sdui-post"],[data-testid="search-sdui-comment-unit"],[data-testid="search-post-unit"]')){
        const target=node.closest('search-telemetry-tracker') && !node.closest('[data-rt-ui]')?node.closest('search-telemetry-tracker'):node;
        if(target.closest('[data-rt-ui]'))continue;
        if(!search.hidden.has(target))search.hidden.set(target,target.hidden);target.hidden=true;target.setAttribute(hiddenAttr,'');
      }
      if(!search.host?.isConnected){
        const switcher=main.querySelector('[data-testid="search-scope-switcher"]'),anchor=switcher?.parentElement || null;
        const host=search.host || this.buildSearchHost(search);
        if(anchor?.parentElement)anchor.after(host);else (main.querySelector('div.bg-neutral-background') || main).append(host);
        if(!search.started){search.started=true;this.refreshSearch();}else{search.io?.disconnect();search.io?.observe(search.sentinel);}
      }
      this.repairSearchTabs();this.fillSearchSidebar(false);
      document.documentElement.setAttribute('data-rt-subreddit-archive-search','');
    }
    repairSearchTabs(){
      const search=this.search,group=document.querySelector('#search-results-page-tabgroup');
      // Empty banned-community results leave Reddit's linked tab group with zero
      // pages. Use its public paging API so its existing links/keyboard UI render.
      if(!search || !group || group.pages!==0 || !('pageNames' in group))return;
      const names=[...group.children].filter(node=>node.matches('a[slot]')).map(node=>node.getAttribute('slot'));
      if(names.length!==3 || !['posts','comments','media'].every(name=>names.includes(name)))return;
      search.tabGroups ||= new Map();if(!search.tabGroups.has(group))search.tabGroups.set(group,{names:group.pageNames,pages:group.pages,index:group.pageIndex});
      group.pageNames=names;group.pageIndex=names.indexOf(search.route.type)+1;
    }
    fillSearchSidebar(force){
      const search=this.search;if(!search)return;
      const slot=document.querySelector('[data-testid="search-results-sidebar"]');if(!slot)return;
      if(!force && search.sidebar?.isConnected && search.sidebar.parentElement===slot)return;
      search.sidebar?.remove();search.sidebar=this.communityPanel(search.route.name,search.kind);slot.append(search.sidebar);
    }
    buildSearchHost(search){
      const host=search.host=make('div','rt-sra-results');host.dataset.rtUi='archive-search';
      search.list=make('div','rt-sra-result-list');search.foot=make('div','rt-sra-foot');search.sentinel=make('div','rt-sra-sentinel');search.sentinel.setAttribute('aria-hidden','true');
      search.notice=make('p','rt-sra-search-note');search.notice.hidden=true;
      host.append(search.notice,search.list,search.foot,search.sentinel);
      if(typeof IntersectionObserver==='function'){search.io=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting))this.loadMoreSearch();},{rootMargin:'800px 0px'});search.io.observe(search.sentinel);}
      return host;
    }
    searchSpec(route){
      const tab=route.type==='comments'?'comments':'posts',now=Math.floor(Date.now()/1000);
      return {tab,media:route.type==='media',asc:false,range:windows[route.t]?{after:now-windows[route.t]}:null,
        sortMode:route.sort==='top'?'top':route.sort==='comments' && tab==='posts'?'comments':'new',query:route.q};
    }
    searchState(){
      const search=this.search,route=search.route,key=JSON.stringify(route);let state=search.states.get(key);
      if(!state){
        const spec=this.searchSpec(route),parsed=route.q?this.parseSearch(route.q,spec.tab,route.name):null;
        state=this.newState(key,{...spec,scope:'search',name:route.name,parsed,plan:parsed && !parsed.invalid?this.searchPlan(parsed):null});search.states.set(key,state);
      }
      return state;
    }
    refreshSearch(){
      const search=this.search;if(!search?.host)return;const state=this.searchState();this.renderSearch();
      if(!state.started && !state.parsed?.invalid && search.route.q)this.fill(state,()=>this.renderSearch());
    }
    loadMoreSearch(){
      const search=this.search;if(!search?.host)return;const state=this.searchState();
      if(state.parsed?.invalid || state.loading || state.error || !state.hasMore || !state.started)return;
      this.fill(state,()=>this.renderSearch());
    }
    renderSearch(){
      const search=this.search;if(!search?.host)return;const state=this.searchState(),route=search.route,items=this.visibleItems(state);
      const notes=[];
      if(state.parsed?.invalid)notes.push(state.parsed.errors[0]);
      else{
        if(['relevance','hot'].includes(route.sort))notes.push('Archive results, newest first (the archive cannot rank by relevance)');
        else if(route.sort==='top')notes.push('Archive results, sorted by votes among loaded results');
        else if(route.sort==='comments' && state.tab==='posts')notes.push('Archive results, sorted by comments among loaded results');
        else notes.push('Archive results');
      }
      search.notice.textContent=notes.join(' · ');search.notice.hidden=false;search.notice.classList.toggle('rt-sra-error-text',Boolean(state.parsed?.invalid));
      search.list.replaceChildren();
      for(const [index,item] of items.entries()){if(index)search.list.append(make('hr','rt-sra-result-rule'));search.list.append(this.searchUnit(state,item));}
      const foot=search.foot;foot.replaceChildren();
      if(state.loading)foot.append(this.loadingHalo());
      if(state.error)foot.append(this.errorNote(state,()=>{if(!state.loading){state.error=null;this.fill(state,()=>this.renderSearch());}}));
      if(!state.loading && !state.error && !state.parsed?.invalid && state.started){
        const label=state.tab==='comments'?'comments':'posts';
        if(!items.length)foot.append(this.emptyState(route.q,state.hasMore?'No archived '+label+' matched yet.':'No archived '+label+' matched. The archive may not hold every record.'));
        if(state.stalled)foot.append(make('p','rt-sra-note','The archive stopped paging here; older records may exist.'));
        else if(!state.hasMore && items.length)foot.append(make('p','rt-sra-note','End of what the archive returned · Coverage may be partial'));
      }
      const line=this.statusLine(state);if(line)foot.append(make('p','rt-sra-searched',line));
      if(!state.loading && !state.error && state.hasMore && state.started){const more=make('button','button button-small button-secondary','Search older');more.type='button';more.dataset.rtMore='true';more.addEventListener('click',()=>this.loadMoreSearch());foot.append(more);}
    }
    emptyState(query,text){
      const box=make('div','rt-sra-empty');box.dataset.rtUi='archive-search-empty';
      box.append(make('div','rt-sra-empty-title',query?'No archived results for '+query:'No archived results'),make('div','rt-sra-empty-text',text));return box;
    }
    // Reddit's search-row markup, so archive rows read exactly like native results.
    highlight(text,parsed){
      const out=document.createDocumentFragment(),ranges=parsed && globalThis.RCSCore?.highlightRanges?globalThis.RCSCore.highlightRanges(text,parsed):[];let at=0;
      for(const [start,end] of ranges){if(start>at)out.append(text.slice(at,start));out.append(make('span','font-bold',text.slice(start,end)));at=end;}
      if(at<text.length)out.append(text.slice(at));return out;
    }
    communityLink(name){
      const a=make('a','rt-sra-unit-community');a.href='/r/'+encodeURIComponent(name)+'/?rt_view=archive';
      const icon=make('span','rt-sra-unit-icon');icon.append(this.avatar(24));a.append(icon,make('span','truncate','r/'+name));return a;
    }
    time(created){const t=make('faceplate-timeago');t.setAttribute('ts',new Date(created*1000).toISOString());t.setAttribute('format','narrow');t.textContent=day(created);return t;}
    searchUnit(state,item){
      let node=state.cards.get(item.fullname);if(node)return node;
      const parsed=state.parsed && !state.parsed.invalid?state.parsed:null,permalink=item.permalink || '#';
      if(item.kind==='comment'){
        node=make('div','rt-sra-unit');node.dataset.testid='search-sdui-comment-unit';node.dataset.rtUi='archive-search-unit';node.dataset.fullname=item.fullname;
        const cover=make('a','rt-sra-unit-cover');cover.href=permalink.replace(/\/[a-z0-9]+\/?$/i,'/') || permalink;cover.setAttribute('aria-label',item.title || 'Open thread');
        const body=make('div','rt-sra-unit-body'),credit=make('div','rt-sra-unit-credit');credit.append(this.communityLink(item.subreddit),make('span','mx-2xs','·'),this.time(item.created));
        body.append(credit);if(item.title)body.append(make('h2','rt-sra-unit-thread',item.title));
        const box=make('div','rt-sra-comment-box'),who=make('div','rt-sra-unit-credit');const author=make('a','rt-sra-unit-author','u/'+item.author);author.href='/user/'+encodeURIComponent(item.author)+'/';who.append(author,make('span','mx-2xs','·'),this.time(item.created));
        const open=make('a','rt-sra-comment-link');open.href=permalink;open.setAttribute('aria-label','Open comment');
        const text=make('div','rt-sra-comment-text');for(const part of String(item.body || '').split(/\n{2,}/).slice(0,6)){const p=make('p');p.append(this.highlight(part,parsed));text.append(p);}
        box.append(who,open,text,make('p','rt-sra-unit-counts',compact(item.score || 0)+' votes'));
        const thread=make('a','rt-sra-thread-link','Go To Thread');thread.href=cover.href;
        body.append(box,thread);node.append(cover,body);
      }else{
        node=make('div','rt-sra-unit');node.dataset.testid='search-post-unit';node.dataset.rtUi='archive-search-unit';node.dataset.fullname=item.fullname;
        const cover=make('a','rt-sra-unit-cover');cover.href=permalink;cover.setAttribute('aria-label',item.title || 'Open post');
        const body=make('div','rt-sra-unit-body'),credit=make('div','rt-sra-unit-credit');credit.append(this.communityLink(item.subreddit),make('span','mx-2xs','·'),this.time(item.created));
        const title=make('a','rt-sra-unit-title');title.href=permalink;title.append(this.highlight(item.title || '',parsed));
        const counts=make('div','rt-sra-unit-counts');counts.append(make('span','',compact(item.score || 0)+' votes'),make('span','mx-2xs','·'),make('span','',compact(item.comments || 0)+' comments'));
        body.append(credit,title,counts);node.append(cover,body);
        const thumb=!item.over18 && !item.spoiler?(item.media?.find?.(m=>m?.url)?.url || (/^https:\/\//.test(item.thumbnail || '')?item.thumbnail:'')):'';
        if(thumb){const frame=make('div','rt-sra-unit-thumb'),img=make('img');img.src=thumb;img.alt='';img.loading='lazy';img.referrerPolicy='no-referrer';img.addEventListener('error',()=>frame.remove(),{once:true});frame.append(img);node.append(frame);}
      }
      state.cards.set(item.fullname,node);return node;
    }

    // ---- queries ---------------------------------------------------------------------------------------------------
    parseSearch(text,tab,name){
      const fields=tab==='comments'?commentFields:postFields,parsed=globalThis.RCSCore.parseQuery(text,{fields:[...fields,'subreddit']});
      parsed.errors=parsed.errors.map(error=>error.replace("isn't available in this search","isn't available for "+tab));
      const check=node=>{
        if(node.type==='field'){
          if(node.field==='subreddit' && node.value.toLowerCase()!==name.toLowerCase())parsed.errors.unshift('This search is scoped to r/'+name+'; another subreddit isn\'t available here.');
          if(![...fields,'subreddit','before','after'].includes(node.field) && !parsed.errors.some(error=>error.includes("isn't available for "+tab)))parsed.errors.push(node.field+": isn't available for "+tab);
        }
        if(node.child)check(node.child);for(const child of node.children || [])check(child);
      };
      check(parsed.expr);parsed.invalid=parsed.errors.length>0;return parsed;
    }
    searchPlan(parsed){
      const core=globalThis.RCSCore,authors=new Set();
      // Only unconditional positive authors may narrow the request. OR/NOT stay local.
      const collect=node=>{if(node.type==='field' && node.field==='author')authors.add(node.value.toLowerCase());else if(node.type==='and')node.children.forEach(collect);};collect(parsed.expr);
      const author=authors.size===1?[...authors][0]:undefined;
      const strip=node=>node.type==='and'?{...node,children:node.children.map(strip).filter(Boolean)}:node.type==='field' && node.field==='author' && author?null:node;
      const input={...parsed,expr:strip(parsed.expr)},split=core.splitQuery(input,['and','or','not','term','phrase']);
      // Distribution has a bounded size; an untranslatable text expression must also scan locally.
      const untranslatable=(split.server.terms.length || split.server.phrases.length || split.server.excluded.length) && !core.toArchiveQuery(split.server);
      return {author,server:untranslatable?core.parseQuery('',{fields:[]}):split.server,residual:split.residual || Boolean(untranslatable)};
    }
    recordFor(item){
      let domain=item.domain;try{domain ||= new URL(item.url).hostname;}catch{}
      const type=globalThis.RTFeedFilters?.inferType(item),self=item.isSelf ?? item.is_self;
      return {title:item.kind==='comment'?undefined:item.title,body:item.body ?? item.selftext,author:item.author,subreddit:item.subreddit,url:item.url,domain,
        flair:item.flair ?? item.link_flair_text,isSelf:typeof self==='boolean'?self:item.postType?['self','text','textmedia','poll'].includes(item.postType):undefined,
        nsfw:item.nsfw ?? item.over18 ?? item.over_18,spoiler:item.spoiler,type,created:item.created ?? item.created_utc};
    }

    // ---- loading (shared by the feed and search pages) -------------------------------------------------------------
    newState(key,spec){
      return {key,...spec,items:[],seen:new Set(),cursor:null,hasMore:true,started:false,loading:false,error:null,searchedBackTo:null,stalled:false,mode:'',gen:0,cards:new Map()};
    }
    feedKey(){const filters=this.filterState(),f=globalThis.RTFeedFilters;return JSON.stringify([filters.sort==='old'?'asc':'desc',f?f.serialize(filters)[f.params.date] || '':'']);}
    current(){
      const key=this.feedKey();let state=this.states.get(key);
      if(!state){
        state=this.newState(key,{scope:'feed',name:this.name,tab:'posts',media:false,asc:this.filterState().sort==='old',range:globalThis.RTFeedFilters?.dateRange(this.filterState()) || null,parsed:null,plan:null,query:''});
        if(this.states.size>=MAX_STATES){const old=[...this.states.keys()].find(k=>k!==key);const evicted=this.states.get(old);if(evicted)evicted.gen++;this.states.delete(old);}
        this.states.set(key,state);
      }
      state.sortMode=this.sortMode();return state;
    }
    refresh(){if(!this.mounted)return;const state=this.current();this.renderList();if(!state.started)this.fill(state,()=>{if(this.mounted && this.current()===state)this.renderList();});}
    loadMore(){
      if(!this.mounted)return;const state=this.current();
      if(state.loading || state.error || !state.hasMore || !state.started)return;
      this.fill(state,()=>{if(this.mounted && this.current()===state)this.renderList();});
    }
    retry(){if(!this.mounted)return;const state=this.current();if(!state.loading){state.error=null;this.fill(state,()=>{if(this.mounted && this.current()===state)this.renderList();});}}
    visibleItems(state){
      const f=globalThis.RTFeedFilters,filters=state.scope==='feed'?this.filterState():null;
      let items=state.items;
      if(state.media)items=items.filter(item=>mediaTypes.includes(f?f.inferType(item):''));
      if(filters && f){const test=f.predicate({...f.clone(filters),subreddits:[]});items=items.filter(item=>test({created:item.created,kind:item.kind,subreddit:item.subreddit,postType:item.kind==='comment'?'':f.inferType(item)}));}
      if(state.sortMode==='top')items=[...items].sort((a,b)=>(b.score||0)-(a.score||0) || b.created-a.created);
      else if(state.sortMode==='comments')items=[...items].sort((a,b)=>(b.comments||0)-(a.comments||0) || b.created-a.created);
      return items;
    }
    async fill(state,render){
      if(state.parsed?.invalid)return;
      const Q=globalThis.RTArchiveQuery;if(!Q?.search){state.error={message:'Archive search is unavailable.'};state.started=true;render();return;}
      state.started=true;state.loading=true;state.error=null;const gen=state.gen;render();
      const before=this.visibleItems(state).length,name=state.name.toLowerCase();
      try{
        const options={kind:state.tab==='comments'?'comment':'post',subreddit:name,sort:state.asc?'asc':'desc',cursor:state.cursor ?? undefined,after:state.range?.after ?? undefined,before:state.range?.before ?? undefined,maxPages:5};
        if(state.plan)options.parsed=state.plan.server;
        if(state.plan?.author)options.author=state.plan.author;
        if(state.tab==='comments')options.titles=true;
        for await(const page of Q.search(options)){
          if(gen!==state.gen)return;
          for(const item of page.items || []){
            if(state.seen.has(item.fullname))continue;state.seen.add(item.fullname);
            if(!state.plan?.residual || globalThis.RCSCore.matchRecord(state.parsed,this.recordFor(item)))state.items.push(item);
          }
          state.searchedBackTo=page.searchedBackTo ?? state.searchedBackTo;state.hasMore=page.hasMore!==false && page.cursor!=null;state.cursor=page.cursor ?? null;state.stalled=Boolean(page.stalled);state.mode=page.mode || '';
          if(page.hasMore && page.cursor==null)state.hasMore=false;
          if(state.stalled)state.hasMore=false;
          // A filter can leave a page empty: keep going (within the page budget) until something shows.
          if(this.visibleItems(state).length>before || !state.hasMore)break;
        }
      }catch(error){if(gen!==state.gen)return;state.error={message:error?.message || 'The archive is unavailable.',code:error?.code,retryAt:error?.retryAt};}
      if(gen!==state.gen)return;
      state.loading=false;render();
      // The sentinel may still be on screen: look again so a short page does not stall paging.
      for(const [io,sentinel] of [[this.io,this.sentinel],[this.search?.io,this.search?.sentinel]])if(io && sentinel?.isConnected){io.unobserve(sentinel);io.observe(sentinel);}
    }

    // ---- rendering the feed ----------------------------------------------------------------------------------------
    cardFor(state,item){
      let node=state.cards.get(item.fullname);if(node)return node;
      try{node=globalThis.RTPostDiscovery?.archiveCard?.(item);}catch{node=null;}
      if(!node){node=make('div','rt-native-card');node.dataset.rtUi='archive-item';const a=make('a','',item.title || item.body || item.fullname);a.href=item.permalink || '#';node.append(a);}
      state.cards.set(item.fullname,node);return node;
    }
    statusLine(state){
      const when=state.searchedBackTo,parts=[];if(when!=null)parts.push((state.asc?'Searched up to ':'Searched back to ')+day(when));
      if(state.mode==='local')parts.push('Matched by scanning archived pages');
      if(state.plan?.residual || state.mode==='local')parts.push('Matches filtered locally · Results may be incomplete');
      return parts.join(' · ');
    }
    loadingHalo(){
      // Let Reddit own its Snoo halo and animation, including reduced motion.
      const loader=make('shreddit-feed-page-loading','rt-sra-loading');loader.setAttribute('page-type','community');loader.setAttribute('role','status');loader.setAttribute('aria-label','Loading archived results');return loader;
    }
    errorNote(state,retry){
      const note=make('div','rt-sra-error text-12 text-neutral-content-weak');note.setAttribute('role','status');note.append(make('span','',state.error.message || 'The archive is unavailable.'));
      if(state.error.retryAt){const wait=Math.max(0,Math.ceil((state.error.retryAt-Date.now())/1000));if(wait>0)note.append(make('span','',' Try again in about '+wait+' s.'));}
      const button=make('button','button button-small button-secondary','Retry');button.type='button';button.dataset.rtRetry='true';button.addEventListener('click',retry);note.append(button);return note;
    }
    renderList(){
      if(!this.mounted)return;const state=this.current(),items=this.visibleItems(state);
      this.listEl.replaceChildren(...items.map(item=>this.cardFor(state,item)));
      this.statusTop.hidden=!['top','comments'].includes(state.sortMode);
      this.statusTop.textContent=state.sortMode==='top'?'Sorted by votes among loaded posts only.':state.sortMode==='comments'?'Sorted by comment count among loaded posts only.':'';
      const foot=this.footEl;foot.replaceChildren();
      if(state.loading)foot.append(this.loadingHalo());
      if(state.error)foot.append(this.errorNote(state,()=>this.retry()));
      if(!state.loading && !state.error){
        if(!items.length)foot.append(make('p','rt-archive-empty text-14 text-neutral-content-weak',state.hasMore?'No archived posts loaded yet for these settings.':'No archived posts found for these settings. The archive may not hold every record.'));
        if(state.stalled)foot.append(make('p','rt-sra-note text-12 text-neutral-content-weak','The archive stopped paging here; older records may exist.'));
        else if(!state.hasMore && items.length)foot.append(make('p','rt-sra-note text-12 text-neutral-content-weak','End of what the archive returned · Coverage may be partial'));
      }
      const line=this.statusLine(state);if(line)foot.append(make('p','rt-sra-searched text-12 text-neutral-content-weak',line));
      // The feed keeps paging on scroll; a button covers environments where scrolling cannot trigger it.
      if(!state.loading && !state.error && state.hasMore && state.started && !this.io){const more=make('button','button button-small button-secondary','Load more');more.type='button';more.dataset.rtMore='true';more.addEventListener('click',()=>this.loadMore());foot.append(more);}
    }
    syncAll(){if(!this.mounted)return;this.syncMenu();this.renderChips();}
  }

  globalThis.RTSubredditArchive=Object.freeze({SubredditArchive,unavailable,searchRoute});
  // Content script entry (top frame of a Reddit page only). Tests construct SubredditArchive themselves.
  if(window.top===window && globalThis.chrome?.runtime?.id)Object.defineProperty(globalThis,'RTSubredditArchiveInstance',{value:new SubredditArchive()});
})();
