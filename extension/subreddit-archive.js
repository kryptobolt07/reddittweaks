/* Subreddit archive: for communities Reddit itself will not show (banned, private), offers a
   "Browse archived posts" action on Reddit's own notice and, when chosen, a Reddit-styled
   archive view (header, Posts/Comments tabs, native-looking cards, filters, search).
   Live, quarantined (gated) and nonexistent communities are never touched. Data comes from the
   Arctic Shift archive through RTArchiveQuery; coverage is always described as partial. */
(() => {
  'use strict';
  if(globalThis.RTSubredditArchive)return;
  const holdAttr='data-rt-subreddit-hold',mountedAttr='data-rt-subreddit-mounted';
  const nameOK=value=>typeof value==='string' && /^[A-Za-z0-9_]{2,21}$/.test(value);
  const make=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text!=null && text!=='')el.textContent=text;return el;};
  const glyph=kind=>globalThis.RTPostDiscovery?.glyph?.(kind) || document.createElementNS('http://www.w3.org/2000/svg','svg');
  const day=seconds=>new Date(seconds*1000).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});
  const communityPath='M11.977 13.79h-1.955l4.549-10.715a.81.81 0 00-.381-1.032C12.447 1.12 10.37.747 8.179 1.18c-3.612.716-6.471 3.68-7.059 7.316a9.01 9.01 0 0010.409 10.377c3.735-.616 6.741-3.635 7.347-7.371.453-2.8-.388-5.405-2.017-7.322a.505.505 0 00-.853.119l-4.029 9.49ZM9.98 8.118a1.752 1.752 0 00-1.148.167 1.664 1.664 0 00-.651.596 1.703 1.703 0 00-.258.948v3.96H5.998V6.322h1.876v1.074h.035c.251-.344.567-.628.948-.851a2.55 2.55 0 011.311-.335c.172 0 .335.014.488.042.153.028.267.058.342.09l-.774 1.849a.766.766 0 00-.244-.073Z';
  const MAX_STATES=16;

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

  class SubredditArchive {
    constructor({readSettings=defaultSettings,getOwner=null,observe=true}={}){
      this.readSettings=readSettings;this.getOwner=getOwner || (()=>globalThis.RCSDirectory?.getOwner?.() || globalThis.RCSMessages?.getSelfIdentity?.()?.id || '');
      this.enabled=null;this.mounted=null;this.states=new Map();this.query='';this.tab='posts';this.top=false;this.menuOpen=false;this.dead=false;
      this.onRoute=()=>this.scan();
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
    destroy(){this.dead=true;this.observer?.disconnect();window.removeEventListener('popstate',this.onRoute);document.removeEventListener('reddit:route',this.onRoute);try{chrome.storage?.onChanged?.removeListener(this.onSettings);}catch{}this.unmount();}

    // Called on every relevant change. Until settings are known nothing is added (an early hold may stay).
    scan(){
      if(this.dead || this.enabled===null)return;
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

    // ---- mounting -------------------------------------------------------------------------------
    mount(modal,kind){
      const name=modal.getAttribute('subredditname'),notice=(modal.querySelector('[slot="title"]')?.textContent || '').replace(/\s+/g,' ').trim();
      const f=globalThis.RTFeedFilters,params=new URLSearchParams(location.search);
      this.name=name;this.kind=kind;this.noticeText=notice || 'r/'+name+' is '+kind;this.filters=f?f.read(location):null;this.top=params.get('rt_top')==='1';
      this.tab=params.get('rt_tab')==='comments'?'comments':'posts';this.query='';this.meta=null;this.states=new Map();
      modal.setAttribute(mountedAttr,'true');hold(modal);
      const layout=this.layout=make('div','grid-container theme-rpl grid flex-nav-expanded');layout.dataset.rtUi='archive-subreddit';layout.dataset.rtSubreddit=name;layout.dir='ltr';
      const subgrid=make('div','subgrid-container m:col-start-2 box-border flex flex-col order-2 w-full m:w-[1120px] xs:px-md m:px-lg mx-auto min-h-[calc(100dvh_-_var(--shreddit-header-height))] justify-stretch');subgrid.id='subgrid-container';
      const columns=make('div','main-container gap-lg w-full flex-1 grid place-content-between grid-cols-[minmax(0,1fr)] fixed-sidebar xs:[&.fixed-sidebar]:grid-cols-[minmax(0,756px)_minmax(0,316px)] xs:[&.flex-sidebar]:grid-cols-[minmax(0,756px)_auto]');
      const main=make('main','main w-full min-w-0');main.id='main-content';
      this.headerEl=make('div','px-md relative pt-md flex pb-md items-center');this.renderHeader();
      main.append(this.headerEl,this.buildTabs(),this.buildSearch(),this.buildControls());
      this.statusTop=make('p','rt-sra-note text-12 text-neutral-content-weak');this.statusTop.hidden=true;
      this.listEl=make('shreddit-feed','nd:visible');this.listEl.dataset.rtArchiveFeed='true';this.listEl.setAttribute('aria-live','polite');
      this.footEl=make('div','rt-sra-foot');this.sentinel=make('div','rt-sra-sentinel');this.sentinel.setAttribute('aria-hidden','true');
      main.append(this.statusTop,this.listEl,this.footEl,this.sentinel);
      columns.append(main,this.buildSidebar());subgrid.append(columns);layout.append(subgrid);modal.before(layout);
      document.documentElement.setAttribute('data-rt-subreddit-archive','');
      this.mounted={modal,kind,name};
      if(typeof IntersectionObserver==='function'){this.io=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting))this.loadMore();},{rootMargin:'800px 0px'});this.io.observe(this.sentinel);}
      this.loadMeta();this.syncAll();this.refresh();
    }
    unmount(){
      const m=this.mounted;if(!m)return;this.mounted=null;
      this.io?.disconnect();this.io=null;this.pickerHost?.remove();this.closeMenu(true);
      for(const state of this.states.values())state.gen++;
      this.layout?.remove();this.layout=null;m.modal.removeAttribute(mountedAttr);
      document.documentElement.removeAttribute('data-rt-subreddit-archive');
      if(this.dead || !viewRequested() && m.modal.isConnected)release(m.modal);
    }

    // ---- header, tabs, sidebar ------------------------------------------------------------------------
    renderHeader(){
      const meta=this.meta,name=this.name,header=this.headerEl;header.replaceChildren();
      const slot=make('div','rt-sra-avatar flex items-center justify-center shrink-0 w-[74px] min-h-4xl overflow-hidden pe-md relative');
      const icon=globalThis.RTPostModel?.avatarUrl?.(meta?.icon || '');
      if(icon){const image=make('img','rt-sra-icon');image.src=icon;image.alt='';image.width=image.height=64;image.referrerPolicy='no-referrer';image.decoding='async';slot.append(image);}
      else{const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');for(const [k,v] of Object.entries({fill:'currentColor',height:'64',width:'64',viewBox:'0 0 20 20','icon-name':'community-fill','aria-hidden':'true',class:'rt-sra-glyph'}))svg.setAttribute(k,v);const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',communityPath);svg.append(path);slot.append(svg);}
      const copy=make('div','w-full min-w-0'),title=make('h1','text-24 font-bold m-0 break-words','r/'+name);title.dataset.testid='subreddit-name';
      const state=make('p','rt-sra-state m-0 mt-2xs text-12 text-neutral-content-weak flex items-center gap-2xs');state.dataset.testid='subreddit-archive-state';state.dataset.state=this.kind;
      state.append(glyph(this.kind==='banned'?'removed':'hidden'),make('span','',this.noticeText.replace(/\.$/,'')+' · Showing archived posts'));
      copy.append(title,state);
      if(meta){
        if(meta.title && meta.title.toLowerCase()!==name.toLowerCase())copy.append(make('p','m-0 mt-2xs text-14 text-neutral-content-strong',meta.title));
        const facts=[];if(meta.subscribers)facts.push(meta.subscribers.toLocaleString()+' members');if(meta.created)facts.push('Created '+day(meta.created));
        if(facts.length)copy.append(make('p','rt-sra-facts m-0 mt-2xs text-12 text-neutral-content-weak',facts.join(' · ')));
      }
      header.append(slot,copy);
    }
    async loadMeta(){
      const Q=globalThis.RTArchiveQuery,name=this.name;if(!Q?.subreddit)return;
      try{const response=await Q.subreddit(name);if(this.mounted?.name!==name || !response?.subreddit)return;this.meta=response.subreddit;this.renderHeader();this.renderSidebarTitle();}catch{/* banned communities often have no metadata */}
    }
    buildTabs(){
      const box=make('div','mx-2xs my-md'),tabs=this.tabsEl=make('faceplate-tabgroup','nd:flex nd:gap-xs nd:w-fit');tabs.id='subreddit-archive-tabgroup';tabs.setAttribute('slot','tabs');
      for(const [i,[view,label]] of [['posts','Posts'],['comments','Comments']].entries()){
        const tab=make('a','button-medium px-[calc(var(--rem12)-var(--button-border-width,0px))] button-plain items-center justify-center button inline-flex');tab.setAttribute('rpl','');tab.setAttribute('slot','page-'+(i+1));tab.dataset.rtTab=view;tab.id='subreddit-archive-tab-'+view;
        tab.href=location.pathname+'?rt_view=archive'+(view==='comments'?'&rt_tab=comments':'');
        const outer=make('span','flex items-center justify-center');outer.append(make('span','flex items-center gap-xs',label));tab.append(outer);
        tab.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();this.setTab(view);});
        tabs.append(tab);
      }
      box.append(tabs);return box;
    }
    syncTabs(){
      for(const tab of this.tabsEl.querySelectorAll('[data-rt-tab]')){
        const selected=tab.dataset.rtTab===this.tab;tab.toggleAttribute('faceplate-tab-selected',selected);tab.classList.toggle('tab-selected',selected);tab.classList.toggle('bg-secondary-background-selected',selected);tab.classList.toggle('!text-neutral-content-strong',selected);
        if(selected){tab.setAttribute('aria-current','page');tab.style.backgroundColor='var(--color-secondary-background-selected)';}else{tab.removeAttribute('aria-current');tab.style.backgroundColor='';}
        tab.tabIndex=selected?0:-1;
      }
      this.tabsEl.setAttribute('pageindex',this.tab==='posts'?'1':'2');
    }
    setTab(tab){
      if(tab===this.tab)return;this.tab=tab;setParams({rt_tab:tab==='comments'?'comments':null});this.syncAll();this.refresh();
    }
    buildSidebar(){
      const sidebar=make('aside','right-sidebar min-w-0 w-[316px] max-w-[316px] hidden xs:block styled-scrollbars xs:sticky xs:top-[56px] xs:max-h-screen-without-header xs:overflow-y-auto xs:overflow-x-hidden');sidebar.id='right-sidebar-container';
      const content=make('div','right-sidebar-contents flex-auto'),panel=make('section','bg-neutral-background-weak rounded-4'),pad=make('div','p-md');panel.setAttribute('aria-label','Archived community information');
      this.sideTitle=make('h2','inline-flex items-center m-0 text-headline text-neutral-content-strong font-bold truncate','r/'+this.name);
      const stats=make('dl','grid grid-cols-2 gap-md mt-md');this.stats={};
      for(const [key,label] of [['posts','Posts loaded'],['comments','Comments loaded'],['oldest','Oldest loaded'],['newest','Newest loaded']]){const item=make('div'),value=make('dd','m-0 text-14 font-semibold text-neutral-content-strong',key==='posts' || key==='comments'?'0':'—');item.append(value,make('dt','text-12 text-neutral-content-weak',label));stats.append(item);this.stats[key]=value;}
      const link=make('a','text-12 hover:underline','Arctic Shift');link.href='https://arctic-shift.photon-reddit.com/';link.rel='noopener noreferrer';link.target='_blank';
      pad.append(this.sideTitle,make('p','text-12 text-neutral-content-weak','Archived public posts and comments'),stats,make('p','text-12 text-neutral-content-weak','Partial archive coverage. Counts and dates describe loaded records, not the complete community history.'),link);
      panel.append(pad);content.append(panel);sidebar.append(content);return sidebar;
    }
    renderSidebarTitle(){if(this.sideTitle)this.sideTitle.textContent='r/'+this.name;}
    syncStats(){
      if(!this.stats)return;let posts=0,comments=0,oldest=Infinity,newest=-Infinity;
      // The same loaded feed under another date or sort can overlap; count each record once.
      const seen=new Map();for(const state of this.states.values())if(!state.query)for(const item of state.items)seen.set(item.fullname,item);
      for(const item of seen.values()){if(item.kind==='comment')comments++;else posts++;if(item.created<oldest)oldest=item.created;if(item.created>newest)newest=item.created;}
      this.stats.posts.textContent=String(posts);this.stats.comments.textContent=String(comments);
      this.stats.oldest.textContent=Number.isFinite(oldest)?day(oldest):'—';this.stats.newest.textContent=Number.isFinite(newest)?day(newest):'—';
    }

    // ---- filters, controls ----------------------------------------------------------------------------
    filterState(){return this.filters || {date:null,types:[],subreddits:[],sort:null};}
    // Effective sort: new, old (archive asc), top / comments (loaded items only).
    sortMode(){
      const sort=this.filterState().sort;
      if(sort==='old')return 'old';if(this.top)return 'top';if(sort==='comments' && this.tab==='posts')return 'comments';return 'new';
    }
    applyFilters(next,{top=this.top}={}){
      const f=globalThis.RTFeedFilters;this.filters=f?f.clone(next):next;this.top=top && !this.filters.sort;
      if(f)f.write(this.filters);setParams({rt_top:this.top?'1':null});
      this.syncAll();this.refresh();
    }
    buildControls(){
      const wrap=make('div','rt-sra-controls relative flex flex-col gap-xs my-sm');wrap.dataset.rtUi='subreddit-controls';
      const row=make('div','flex items-center gap-xs relative'),button=this.menuButton=make('button','button button-small button-secondary inline-flex items-center gap-xs');button.type='button';button.setAttribute('aria-label','Feed options');button.setAttribute('aria-haspopup','menu');button.setAttribute('aria-expanded','false');
      button.append(glyph('filter'),make('span','','Feed options'));
      button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();this.menuOpen?this.closeMenu():this.openMenu();});
      this.menuEl=make('div','rt-sra-menu');this.menuEl.setAttribute('role','menu');this.menuEl.hidden=true;this.menuEl.dataset.rtUi='subreddit-menu';
      this.buildMenu();
      this.chipsEl=make('div','rt-filter-chips');this.chipsEl.hidden=true;
      row.append(button,this.menuEl);wrap.append(row,this.chipsEl);
      this.onDocClick=event=>{if(this.menuOpen && !wrap.contains(event.target))this.closeMenu();};
      this.onMenuKey=event=>{if(event.key==='Escape' && this.menuOpen){event.stopPropagation();this.closeMenu();this.menuButton.focus({preventScroll:true});}};
      document.addEventListener('click',this.onDocClick,true);wrap.addEventListener('keydown',this.onMenuKey);
      return wrap;
    }
    openMenu(){this.menuOpen=true;this.menuEl.hidden=false;this.menuButton.setAttribute('aria-expanded','true');this.syncMenu();}
    closeMenu(quiet){
      this.menuOpen=false;if(this.menuEl)this.menuEl.hidden=true;this.menuButton?.setAttribute('aria-expanded','false');
      if(quiet)document.removeEventListener('click',this.onDocClick,true);
    }
    buildMenu(){
      const f=globalThis.RTFeedFilters,menu=this.menuEl;menu.replaceChildren();
      const row=(label,icon)=>{
        const el=make('div','rt-sra-row cursor-pointer');el.setAttribute('role','menuitemradio');el.tabIndex=-1;
        const body=make('div','flex justify-between items-center w-full'),caption=make('div','flex items-center gap-xs');caption.append(glyph(icon),document.createTextNode(label));body.append(caption);el.append(body);return el;
      };
      const activate=(el,fn)=>{el.addEventListener('click',event=>{event.preventDefault();fn(event);});el.addEventListener('keydown',event=>{if(event.key==='Enter' || event.key===' '){event.preventDefault();fn(event);}});};
      const fx=this.fx={row,activate,glyph},current=()=>f.clone(this.filterState());this.menuRows={sort:new Map(),date:new Map(),type:new Map()};
      const header=text=>{const h=make('div','rt-sra-heading text-12 text-neutral-content-weak',text);h.setAttribute('role','presentation');menu.append(h);};
      const option=(group,key,options)=>{const el=f.menuOption(fx,options);el.dataset.rtUi='filter-option';menu.append(el);this.menuRows[group].set(key,el);return el;};
      const close=()=>{this.closeMenu();this.menuButton.focus({preventScroll:true});};
      header('Sort');
      option('sort','new',{label:'New',icon:'archive',value:'new',onSelect:()=>{const next=current();next.sort=null;this.applyFilters(next,{top:false});close();}});
      option('sort','old',{label:'Old',subtitle:'From the archive',icon:'archive',value:'old',onSelect:()=>{const next=current();next.sort='old';this.applyFilters(next,{top:false});close();}});
      option('sort','top',{label:'Top',subtitle:'Loaded items only',icon:'archive',value:'top',onSelect:()=>{const next=current();next.sort=null;this.applyFilters(next,{top:true});close();}});
      this.commentedRow=option('sort','comments',{label:'Most commented',subtitle:'Loaded items only',icon:'archive',value:'comments',onSelect:()=>{const next=current();next.sort='comments';this.applyFilters(next,{top:false});close();}});
      header('Date');
      option('date','any',{label:'Any time',icon:'calendar',value:'any',onSelect:()=>{const next=current();next.date=null;this.applyFilters(next);close();}});
      for(const preset of f.presets)option('date',preset.id,{label:preset.label,icon:'calendar',value:preset.id,onSelect:()=>{const next=current();next.date=next.date?.preset===preset.id?null:{preset:preset.id};this.applyFilters(next);close();}});
      option('date','custom',{label:'Custom…',icon:'calendar',value:'custom',onSelect:()=>{this.closeMenu();this.openDatePicker();}});
      this.typeHeader=make('div','rt-sra-heading text-12 text-neutral-content-weak','Post type');this.typeHeader.setAttribute('role','presentation');menu.append(this.typeHeader);
      option('type','all',{label:'All',icon:'posttype',value:'all',onSelect:()=>{const next=current();next.types=[];this.applyFilters(next);}});
      for(const name of f.types)option('type',name,{label:f.typeLabels[name],icon:'posttype',value:name,onSelect:()=>{const next=current();next.types=next.types.includes(name)?next.types.filter(x=>x!==name):[...next.types,name];this.applyFilters(next);}});
    }
    syncMenu(){
      const f=globalThis.RTFeedFilters;if(!f || !this.menuEl)return;const state=this.filterState(),mode=this.sortMode(),posts=this.tab==='posts';
      for(const [key,el] of this.menuRows.sort)f.markChecked(this.fx,el,key===mode);
      this.commentedRow.hidden=!posts;
      for(const [key,el] of this.menuRows.date)f.markChecked(this.fx,el,key==='any'?!state.date:key==='custom'?Boolean(state.date?.from):state.date?.preset===key);
      for(const [key,el] of this.menuRows.type){el.hidden=!posts;f.markChecked(this.fx,el,key==='all'?!state.types.length:state.types.includes(key));}
      this.typeHeader.hidden=!posts;
    }
    renderChips(){
      const f=globalThis.RTFeedFilters;if(!f)return;
      const state=this.filterState(),shown=this.tab==='posts'?state:{...f.clone(state),types:[],sort:state.sort==='comments'?null:state.sort};
      f.renderChips(this.chipsEl,shown,{make,glyph,onChange:next=>{
        // Next is the chip's own removal result; "Clear filters" returns an empty state and also clears Top.
        const cleared=!f.isActive(next);this.applyFilters(this.tab==='posts'?next:{...next,types:state.types},{top:cleared?false:this.top});}});
      if(this.top){
        const chip=make('span','rt-filter-chip'),remove=make('button','rt-filter-chip-remove');remove.type='button';remove.setAttribute('aria-label','Remove filter Top (loaded items)');remove.dataset.rtChipRemove='top';remove.append(glyph('close'));
        remove.addEventListener('click',event=>{event.preventDefault();this.applyFilters(this.filterState(),{top:false});});
        chip.dataset.rtChip='top';chip.append(make('span','rt-filter-chip-label','Top (loaded items)'),remove);this.chipsEl.prepend(chip);this.chipsEl.hidden=false;
        if(!this.chipsEl.querySelector('[data-rt-filter-clear]')){const clear=make('button','rt-filter-clear','Clear filters');clear.type='button';clear.dataset.rtFilterClear='true';clear.addEventListener('click',event=>{event.preventDefault();this.applyFilters(f.empty(),{top:false});});this.chipsEl.append(clear);}
      }
    }
    openDatePicker(){
      const Picker=globalThis.RCSDatePicker,f=globalThis.RTFeedFilters;if(!Picker || !f)return;
      this.pickerHost?.remove();const host=this.pickerHost=make('div');host.dataset.rtUi='date-picker';
      const anchor=this.menuButton.getBoundingClientRect?.() || {left:0,bottom:0};
      host.style.cssText=`position:fixed;z-index:2147483000;pointer-events:none;width:0;height:0;left:${Math.max(0,Math.round(anchor.left))}px;top:${Math.max(0,Math.round(anchor.bottom))}px`;
      const shadow=host.attachShadow({mode:'open'}),style=make('style','',`:host{--rcs-bg:var(--color-neutral-background,#fff);--rcs-soft:var(--color-neutral-background-weak,#f2f4f5);--rcs-text:var(--color-neutral-content-strong,#0f1a1c);--rcs-muted:var(--color-neutral-content-weak,#576f76);--rcs-line:var(--color-neutral-border-weak,#e5e8eb);--rcs-hover:var(--color-neutral-background-hover,#e8edef);--rcs-accent:#ff4500}.date-popover{pointer-events:auto;left:0;right:auto;top:4px}`+(Picker.styles || ''));
      const away=event=>{if(!event.composedPath().includes(host))picker.close(false);};
      const picker=new Picker({getAnchor:()=>anchor,onChange:bounds=>{
        const today=new Date(),iso=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`,from=bounds.from || '2005-06-01',to=bounds.to || iso,next=f.clone(this.filterState());
        next.date={from:from<=to?from:to,to:from<=to?to:from};this.applyFilters(next);},onClose:()=>{document.removeEventListener('pointerdown',away,true);host.remove();this.menuButton?.focus?.({preventScroll:true});}});
      const date=this.filterState().date;if(date?.from)picker.applied={mode:'Between',start:date.from,end:date.to};
      shadow.append(style,picker.element);document.body.append(host);picker.show();document.addEventListener('pointerdown',away,true);
    }

    // ---- search field + recent searches ---------------------------------------------------------------
    buildSearch(){
      const form=this.formEl=make('form','rt-sra-search relative');form.setAttribute('role','search');form.dataset.rtUi='subreddit-search';form.autocomplete='off';
      const field=make('div','rt-sra-field'),icon=glyph('search');icon.classList.add('rt-sra-search-icon');
      const input=this.inputEl=make('input','rt-sra-input');input.type='search';input.name='q';input.placeholder='Search r/'+this.name;input.setAttribute('aria-label','Search r/'+this.name);input.maxLength=256;input.autocomplete='off';
      const clear=this.clearEl=make('button','rt-sra-clear');clear.type='button';clear.hidden=true;clear.setAttribute('aria-label','Clear search');clear.append(glyph('close'));
      field.append(icon,input,clear);this.recentEl=make('div','rt-sra-recent');this.recentEl.hidden=true;this.recentEl.dataset.rtUi='recent-searches';this.hintEl=make('p','rt-sra-hint text-12');this.hintEl.hidden=true;this.hintEl.setAttribute('role','status');
      form.append(field,this.recentEl,this.hintEl);
      form.addEventListener('submit',event=>{event.preventDefault();this.submitSearch(input.value);});
      input.addEventListener('input',()=>{clear.hidden=!input.value;this.hintEl.hidden=true;if(!input.value){if(this.query)this.setQuery('');this.showRecent();}else this.hideRecent();});
      input.addEventListener('focus',()=>this.showRecent());
      form.addEventListener('focusout',event=>{if(!form.contains(event.relatedTarget))this.hideRecent();});
      form.addEventListener('keydown',event=>{if(event.key==='Escape')this.hideRecent();});
      clear.addEventListener('click',()=>{input.value='';clear.hidden=true;this.hintEl.hidden=true;if(this.query)this.setQuery('');input.focus({preventScroll:true});this.showRecent();});
      return form;
    }
    recentScope(){return 'subreddit:'+this.name.toLowerCase();}
    async showRecent(){
      const R=globalThis.RTRecentSearches,owner=this.getOwner();
      if(!R || !owner || this.inputEl.value){this.hideRecent();return;}
      let list=[];try{list=await R.list(owner,this.recentScope());}catch{}
      if(!this.mounted || this.inputEl.value || !list.length){this.hideRecent();return;}
      this.recentEl.replaceChildren();
      // Pointer-down must not blur the field before the click lands.
      this.recentEl.onmousedown=event=>event.preventDefault();
      for(const entry of list){
        const item=make('div','rt-sra-recent-item'),pick=make('button','rt-sra-recent-pick');pick.type='button';pick.dataset.rtRecent=entry.q;pick.append(glyph('search'),make('span','',entry.q));
        pick.addEventListener('click',()=>{this.inputEl.value=entry.q;this.clearEl.hidden=false;this.submitSearch(entry.q);});
        const remove=make('button','rt-sra-recent-remove');remove.type='button';remove.setAttribute('aria-label','Remove recent search '+entry.q);remove.dataset.rtRecentRemove=entry.q;remove.append(glyph('close'));
        remove.addEventListener('click',async()=>{try{await R.remove(owner,this.recentScope(),entry.q);}catch{}this.showRecent();});
        item.append(pick,remove);this.recentEl.append(item);
      }
      const clearAll=make('button','rt-sra-recent-clear','Clear recent');clearAll.type='button';clearAll.dataset.rtRecentClear='true';
      clearAll.addEventListener('click',async()=>{try{await R.clear(owner,this.recentScope());}catch{}this.showRecent();});
      this.recentEl.append(clearAll);this.recentEl.hidden=false;
    }
    hideRecent(){if(this.recentEl)this.recentEl.hidden=true;}
    // Enter (or choosing a recent search) is the only time a query is saved.
    async submitSearch(raw){
      const text=String(raw || '').trim();this.hideRecent();
      if(!text){this.hintEl.hidden=true;if(this.query)this.setQuery('');return;}
      const core=globalThis.RCSCore,parsed=core?.parseQuery?core.parseQuery(text,{scopes:['author']}):{text,authors:[],errors:[],invalid:false};
      if(parsed.invalid){this.hintEl.textContent=parsed.errors[0] || 'Check the search and try again.';this.hintEl.hidden=false;return;}
      this.hintEl.hidden=true;
      const R=globalThis.RTRecentSearches,owner=this.getOwner();
      if(R && owner)R.add(owner,this.recentScope(),text).catch(()=>{});
      this.setQuery(text);
    }
    setQuery(text){
      this.query=text;this.syncAll();this.refresh();
    }

    // ---- loading --------------------------------------------------------------------------------------
    stateKey(){
      const filters=this.filterState(),f=globalThis.RTFeedFilters;
      return JSON.stringify([this.tab,filters.sort==='old'?'asc':'desc',f?f.serialize(filters)[f.params.date] || '':'',this.query]);
    }
    current(){
      const key=this.stateKey();let state=this.states.get(key);
      if(!state){
        const core=globalThis.RCSCore,parsed=this.query?(core?.parseQuery?core.parseQuery(this.query,{scopes:['author']}):{text:this.query,authors:[]}):null;
        state={key,query:this.query,parsed,authors:(parsed?.authors || []).map(a=>a.toLowerCase()),tab:this.tab,asc:this.filterState().sort==='old',range:globalThis.RTFeedFilters?.dateRange(this.filterState()) || null,
          items:[],seen:new Set(),cursor:null,hasMore:true,started:false,loading:false,error:null,searchedBackTo:null,stalled:false,mode:'',gen:0,cards:new Map(),counted:new Set()};
        if(this.states.size>=MAX_STATES){const old=[...this.states.keys()].find(k=>k!==key);const evicted=this.states.get(old);if(evicted)evicted.gen++;this.states.delete(old);}
        this.states.set(key,state);
      }
      return state;
    }
    // Entry points: show the right source now, load its first page once.
    refresh(){
      if(!this.mounted)return;const state=this.current();this.renderList();
      if(!state.started)this.fill(state);
    }
    loadMore(){
      if(!this.mounted)return;const state=this.current();
      if(state.loading || state.error || !state.hasMore || !state.started)return;
      this.fill(state);
    }
    retry(){if(!this.mounted)return;const state=this.current();if(!state.loading){state.error=null;this.fill(state);}}
    visible(state){
      const f=globalThis.RTFeedFilters,filters=this.filterState(),posts=state.tab==='posts';
      const test=f?f.predicate({...f.clone(filters),types:posts?filters.types:[],subreddits:[]}):()=>true;
      let items=state.items.filter(item=>test({created:item.created,kind:item.kind,subreddit:item.subreddit,postType:item.kind==='comment'?'':f?f.inferType(item):''}));
      if(state.authors.length>1)items=items.filter(item=>state.authors.includes(String(item.author).toLowerCase()));
      const mode=this.sortMode();
      if(mode==='top')items=[...items].sort((a,b)=>(b.score||0)-(a.score||0) || b.created-a.created);
      else if(mode==='comments')items=[...items].sort((a,b)=>(b.comments||0)-(a.comments||0) || b.created-a.created);
      return items;
    }
    async fill(state){
      const Q=globalThis.RTArchiveQuery;if(!Q?.search){state.error={message:'Archive search is unavailable.'};state.started=true;this.renderList();return;}
      state.started=true;state.loading=true;state.error=null;const gen=state.gen;this.renderList();
      const before=this.visible(state).length;
      try{
        const options={kind:state.tab==='comments'?'comment':'post',subreddit:this.name.toLowerCase(),sort:state.asc?'asc':'desc',cursor:state.cursor ?? undefined,after:state.range?.after ?? undefined,before:state.range?.before ?? undefined,maxPages:5};
        if(state.parsed)options.parsed=state.parsed;
        if(state.authors.length===1)options.author=state.authors[0];
        for await(const page of Q.search(options)){
          if(gen!==state.gen)return;
          for(const item of page.items || []){if(state.seen.has(item.fullname))continue;state.seen.add(item.fullname);state.items.push(item);}
          state.searchedBackTo=page.searchedBackTo ?? state.searchedBackTo;state.hasMore=page.hasMore!==false && page.cursor!=null;state.cursor=page.cursor ?? null;state.stalled=Boolean(page.stalled);state.mode=page.mode || '';
          if(page.hasMore && page.cursor==null)state.hasMore=false;
          if(state.stalled)state.hasMore=false;
          // A type or date filter can leave a page empty: keep going (within the page budget) until something shows.
          if(this.visible(state).length>before || !state.hasMore)break;
        }
      }catch(error){if(gen!==state.gen)return;state.error={message:error?.message || 'The archive is unavailable.',code:error?.code,retryAt:error?.retryAt};}
      if(gen!==state.gen)return;
      state.loading=false;
      if(this.mounted && this.current()===state){this.renderList();this.syncStats();}
      // The sentinel may still be on screen: look again so a short page does not stall paging.
      if(this.io && this.sentinel?.isConnected){this.io.unobserve(this.sentinel);this.io.observe(this.sentinel);}
    }

    // ---- rendering the feed ---------------------------------------------------------------------------
    cardFor(state,item){
      let node=state.cards.get(item.fullname);if(node)return node;
      try{node=globalThis.RTPostDiscovery?.archiveCard?.(item);}catch{node=null;}
      if(!node){node=make('div','rt-native-card');node.dataset.rtUi='archive-item';const a=make('a','',item.title || item.body || item.fullname);a.href=item.permalink || '#';node.append(a);}
      state.cards.set(item.fullname,node);return node;
    }
    statusLine(state){
      const asc=state.asc,when=state.searchedBackTo;
      if(when==null)return '';
      return (asc?'Searched up to ':'Searched back to ')+day(when)+(state.mode==='local'?' · Matched by scanning archived pages':'');
    }
    renderList(){
      if(!this.mounted)return;const state=this.current(),items=this.visible(state),label=this.tab==='comments'?'comments':'posts';
      this.listEl.replaceChildren(...items.map(item=>this.cardFor(state,item)));
      const mode=this.sortMode();
      this.statusTop.hidden=!(mode==='top' || mode==='comments');
      this.statusTop.textContent=mode==='top'?'Sorted by score among loaded items only.':mode==='comments'?'Sorted by comment count among loaded items only.':'';
      const foot=this.footEl;foot.replaceChildren();
      if(state.loading){for(let i=0;i<3;i++)foot.append(globalThis.RTArchiveView?.skeleton?.({lines:3}) || make('div','rt-skeleton'));}
      if(state.error){
        const note=make('div','rt-sra-error text-12 text-neutral-content-weak');note.setAttribute('role','status');note.append(make('span','',state.error.message || 'The archive is unavailable.'));
        if(state.error.retryAt){const wait=Math.max(0,Math.ceil((state.error.retryAt-Date.now())/1000));if(wait>0)note.append(make('span','',' Try again in about '+wait+' s.'));}
        const retry=make('button','button button-small button-secondary','Retry');retry.type='button';retry.dataset.rtRetry='true';retry.addEventListener('click',()=>this.retry());note.append(retry);foot.append(note);
      }
      const line=this.statusLine(state);
      if(!state.loading && !state.error){
        if(!items.length){foot.append(make('p','rt-archive-empty text-14 text-neutral-content-weak',state.hasMore?'No archived '+label+' loaded yet for these settings.':state.query?'No archived '+label+' matched. The archive may not hold every record.':'No archived '+label+' found for these settings. The archive may not hold every record.'));}
        if(state.stalled)foot.append(make('p','rt-sra-note text-12 text-neutral-content-weak','The archive stopped paging here; older records may exist.'));
        else if(!state.hasMore && items.length)foot.append(make('p','rt-sra-note text-12 text-neutral-content-weak','End of what the archive returned · Coverage may be partial'));
      }
      if(line)foot.append(make('p','rt-sra-searched text-12 text-neutral-content-weak',line));
      // Search is driven by the user (Search older); the plain feed keeps paging on scroll, with a button when scrolling cannot trigger it.
      if(!state.loading && !state.error && state.hasMore && state.started && (state.query || !this.io)){
        const more=make('button','button button-small button-secondary',state.query?'Search older':'Load more');more.type='button';more.dataset.rtMore='true';more.addEventListener('click',()=>this.loadMore());foot.append(more);
      }
      this.syncStats();
    }
    syncAll(){
      if(!this.mounted)return;this.syncTabs();this.syncMenu();this.renderChips();
      if(this.inputEl){this.inputEl.value=this.query;this.clearEl.hidden=!this.query;}
    }
  }

  globalThis.RTSubredditArchive=Object.freeze({SubredditArchive,unavailable});
  // Content script entry (top frame of a Reddit page only). Tests construct SubredditArchive themselves.
  if(window.top===window && globalThis.chrome?.runtime?.id)Object.defineProperty(globalThis,'RTSubredditArchiveInstance',{value:new SubredditArchive()});
})();
