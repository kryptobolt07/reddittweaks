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
  // Reddit's custom elements set attributes in their constructors, which createElement rejects once they are
  // defined; parsing creates them the way Reddit's own markup does.
  const make=(tag,cls,text)=>{let el;if(tag.includes('-')){if(!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/.test(tag))throw Error('Invalid custom element name.');const parsed=new DOMParser().parseFromString('<'+tag+'></'+tag+'>','text/html');el=document.adoptNode(parsed.body.firstElementChild);}else el=document.createElement(tag);if(cls)el.className=cls;if(text!=null && text!=='')el.textContent=text;return el;};
  const glyph=kind=>globalThis.RTPostDiscovery?.glyph?.(kind) || document.createElementNS('http://www.w3.org/2000/svg','svg');
  const day=seconds=>new Date(seconds*1000).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});
  const compact=n=>new Intl.NumberFormat(undefined,{notation:'compact',maximumFractionDigits:1}).format(n);
  // Feed paging: the archive is read 100 posts per request, but revealed in Reddit-sized pages.
  // A local type filter can hide whole requests: scan older pages at most SCAN_FILLS times per page
  // asked for, then pause with an explicit state.
  // Loaded cards stay attached so native media and custom-element state survive scrolling.
  const PAGE_SIZE=25,SCAN_FILLS=8;
  const postFields=['title','body','author','site','url','flair','self','nsfw','spoiler','type'];
  const commentFields=['body','author'];
  const mediaTypes=['image','gif','video','gallery'];
  const windows={hour:3600,day:86400,week:604800,month:2592000,year:31536000};
  // Search paging: keep scanning (bounded) until a first screen of results is loaded.
  const SEARCH_TARGET=25,SEARCH_PAGES=10,SEARCH_BUDGET_MS=20000,SEARCH_SETTLE_MS=1000;
  // Reddit's search sorts the archive cannot rank. Their results are shown newest first, so the control says New.
  const unrankedSorts={relevance:['Relevance'],hot:['Hot']},unrankedComments=['Comment count','Most comments'];
  // Reddit's narrow relative time ("8y ago"), as its search units show it.
  function ago(seconds,now=Date.now()){
    const s=Math.max(0,Math.floor(now/1000-seconds));if(s<60)return 'now';
    const m=Math.floor(s/60);if(m<60)return m+'m ago';const h=Math.floor(m/60);if(h<24)return h+'h ago';
    const d=Math.floor(h/24);if(d<30)return d+'d ago';if(d<365)return Math.min(11,Math.max(1,Math.floor(d/30)))+'mo ago';return Math.floor(d/365)+'y ago';
  }

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
  // A banned-community notice whose community isn't the current route is stale: Reddit is navigating away (the URL
  // changes before the new page replaces it). Keep it hidden instead of flashing it during the load.
  function staleModal(modal){const route=location.pathname.match(/^\/r\/([A-Za-z0-9_]{2,21})(?:\/|$)/)?.[1];return !route || route.toLowerCase()!==String(modal?.getAttribute('subredditname') || '').toLowerCase();}
  function release(modal){if(!modal || modal.hasAttribute(mountedAttr))return;if(staleModal(modal)){hold(modal);return;}modal.removeAttribute(holdAttr);modal.style.removeProperty('display');if(!modal.getAttribute('style'))modal.removeAttribute('style');}
  // Reddit's default avatars (one of eight) for authors whose archive record has no avatar.
  const DELETED_AVATAR='https://www.redditstatic.com/shreddit/assets/snoovatar-back-64x64px.png';
  const defaultAvatar=(name,size,href)=>{
    if(!globalThis.RTPostModel?.validateUsername(name)){const img=make('img','rounded-full shrink-0 rt-avatar-img rt-avatar-deleted');img.src=DELETED_AVATAR;img.alt='';img.width=img.height=size;img.decoding='async';img.referrerPolicy='no-referrer';img.style.width=img.style.height=size+'px';return img;}
    let hash=0;for(const ch of String(name || ''))hash=(hash*31+ch.charCodeAt(0))>>>0;
    const img=make('img','rounded-full shrink-0 rt-avatar-img');img.src='https://www.redditstatic.com/avatars/defaults/v2/avatar_default_'+(hash % 8)+'.png';img.alt='';img.width=img.height=size;img.loading='lazy';img.decoding='async';img.referrerPolicy='no-referrer';if(globalThis.RTPostModel?.validateUsername(name))img.dataset.rtAvatarUser=name;img.style.width=img.style.height=size+'px';
    if(!href)return img;const a=make('a','flex items-center mt-2xs');a.href=href;a.setAttribute('aria-label',name+"'s profile");a.append(img);return a;};
  const redditCaret=()=>{const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');for(const [k,v] of Object.entries({fill:'currentColor',height:'16',width:'16',viewBox:'0 0 20 20','aria-hidden':'true','icon-name':'caret-down'}))svg.setAttribute(k,v);
    const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d','M10 13.7a.897.897 0 01-.636-.264l-4.6-4.6a.9.9 0 111.272-1.273L10 11.526l3.964-3.963a.9.9 0 011.272 1.273l-4.6 4.6A.897.897 0 0110 13.7Z');svg.append(path);return svg;};
  const arcticLink=label=>{const a=make('a','',label);a.href='https://arctic-shift.photon-reddit.com/';a.rel='noopener noreferrer';a.target='_blank';return a;};
  // Reddit's comment thresholds (approximation of its default "Best" view): top-level batch, extra replies per click, deepest level.
  const TOP_BATCH=20,REPLY_BATCH=10,MAX_DEPTH=6;
  const addCircle=()=>{const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');for(const [k,v] of Object.entries({fill:'currentColor',height:'16',width:'16',viewBox:'0 0 20 20','aria-hidden':'true','icon-name':'add-circle'}))svg.setAttribute(k,v);
    const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d','M10 1a9 9 0 100 18 9 9 0 000-18Zm0 16.2a7.2 7.2 0 117.2-7.2 7.208 7.208 0 01-7.2 7.2Zm.9-8.1H14v1.8h-3.1V14H9.1v-3.1H6V9.1h3.1V6h1.8v3.1Z');svg.append(path);return svg;};
  // Real profile pictures come from Reddit's own image hosts only (same rule as thread restore).
  const avatarHosts=new Set(['styles.redditmedia.com','i.redd.it','preview.redd.it','cf.preview.redd.it','www.redditstatic.com']);
  const safeAvatar=value=>{if(typeof value!=='string' || value.length>2048)return '';try{const url=new URL(value);return url.protocol==='https:' && !url.username && !url.password && !url.port && avatarHosts.has(url.hostname) && (!url.pathname.includes('/snoovatar/avatars/') || /-headshot\.[a-z]+$/i.test(url.pathname))?url.href:'';}catch{return '';}};
  // Automatic retries for temporary archive failures: attempts and the wait before each (ms).
  const AUTO_RETRIES=3,AUTO_RETRY_WAITS=[2000,5000,12000];
  const redditSearchIcon=()=>{const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');for(const [k,v] of Object.entries({fill:'currentColor',height:'16',width:'16',viewBox:'0 0 20 20','aria-hidden':'true','icon-name':'search'}))svg.setAttribute(k,v);
    const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d','M19.5 18.616 14.985 14.1a8.528 8.528 0 1 0-.884.884l4.515 4.515.884-.884ZM1.301 8.553a7.253 7.253 0 1 1 7.252 7.253 7.261 7.261 0 0 1-7.252-7.253Z');svg.append(path);return svg;};
  // Reddit's current 20px-grid icons as its comment search draws them (16px).
  const pdpPaths={search:'m18.736 17.464-3.483-3.483A7.961 7.961 0 0016.999 9 8 8 0 109 17a7.961 7.961 0 004.981-1.746l3.483 3.483a.9.9 0 101.272-1.273ZM9 15.2A6.207 6.207 0 012.8 9c0-3.419 2.781-6.2 6.2-6.2s6.2 2.781 6.2 6.2-2.781 6.2-6.2 6.2Z',
    clear:['M10 1a9 9 0 10.001 18.001A9 9 0 0010 1Zm0 16.2c-3.97 0-7.2-3.23-7.2-7.2S6.03 2.8 10 2.8s7.2 3.23 7.2 7.2-3.23 7.2-7.2 7.2Z','M12.66 6.06 10 8.73 7.34 6.06 6.06 7.34 8.73 10l-2.67 2.66 1.28 1.28L10 11.27l2.66 2.67 1.28-1.28L11.27 10l2.67-2.66-1.28-1.28Z'],
    'arrow-back':'M17.5 9.1H4.679l5.487-5.462a.898.898 0 00.003-1.272.898.898 0 00-1.272-.003l-7.032 7a.898.898 0 000 1.275l7.03 7a.896.896 0 001.273-.003.898.898 0 00-.002-1.272l-5.487-5.462h12.82a.9.9 0 000-1.8Z'};
  const pdpIcon=name=>{const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');for(const [k,v] of Object.entries({fill:'currentColor',height:'16',width:'16',viewBox:'0 0 20 20','aria-hidden':'true','icon-name':name,rpl:''}))svg.setAttribute(k,v);if(name==='arrow-back')svg.setAttribute('class','rpl-rtl-icon');
    for(const d of [].concat(pdpPaths[name])){const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',d);svg.append(path);}return svg;};
  const srOnly=text=>make('faceplate-screen-reader-content','',text);
  const viewRequested=()=>new URLSearchParams(location.search).get('rt_view')==='archive';
  function setParams(changes){
    const url=new URL(location.href);
    for(const [name,value] of Object.entries(changes)){if(value==null || value==='')url.searchParams.delete(name);else url.searchParams.set(name,value);}
    // Reddit's router reloads the page on a replaceState to the unchanged address.
    const next=url.pathname+url.search+url.hash;if(next===location.pathname+location.search+location.hash)return;
    try{history.replaceState(history.state,'',next);}catch{}
  }
  async function defaultSettings(){
    const response=await chrome.runtime.sendMessage({scope:'rt-posts',action:'get-settings'});
    const s=response?.settings;return {enabled:response?.ok===true && s?.postDiscovery!==false && s?.archiveDiscovery===true && s?.subredditArchive===true,automatic:s?.subredditArchiveAutomatic===true};
  }
  // Reddit's own search page for a community: /r/<name>/search/?q=…&type=…&sort=…&t=…
  function searchRoute(){
    const match=location.pathname.match(/^\/r\/([A-Za-z0-9_]{2,21})\/search\/?$/i);if(!match)return null;
    const params=new URLSearchParams(location.search),pick=(key,list,fallback)=>list.includes(params.get(key))?params.get(key):fallback;
    return {name:match[1],q:(params.get('q') || '').trim().slice(0,256),type:pick('type',['posts','comments','media'],'posts'),sort:pick('sort',['relevance','hot','top','new','comments'],'relevance'),t:pick('t',['hour','day','week','month','year','all'],'all')};
  }
  function threadRoute(){
    const match=location.pathname.match(/^\/r\/([A-Za-z0-9_]{2,21})\/comments\/([a-z0-9]{1,10})(?:\/[^/]*(?:\/([a-z0-9]{1,32}))?)?\/?$/i);
    return match?{name:match[1],postId:match[2].toLowerCase(),focusId:match[3]?.toLowerCase() || ''}:null;
  }
  async function archiveRead(message){
    let timer;try{const answer=await Promise.race([chrome.runtime.sendMessage({scope:'rt-posts',...message,pageUrl:location.href}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Archive request took too long. Try again.')),16000);})]);if(!answer?.ok)throw Error(answer?.error || 'Archive unavailable.');return answer;}finally{clearTimeout(timer);}
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
    constructor({autoRetries=AUTO_RETRIES,autoRetryWaits=AUTO_RETRY_WAITS,readSettings=defaultSettings,getOwner=null,observe=true,communityState=defaultCommunityState,reddit=(...args)=>globalThis.RTPostDiscovery?.redditRead?.(...args),archive=archiveRead}={}){
      this.autoRetries=autoRetries;this.autoRetryWaits=autoRetryWaits;this.readSettings=readSettings;this.communityState=communityState;this.reddit=reddit;this.archive=archive;
      this.getOwner=getOwner || (()=>globalThis.RCSDirectory?.getOwner?.() || globalThis.RCSMessages?.getSelfIdentity?.()?.id || '');
      this.enabled=null;this.mounted=null;this.search=null;this.states=new Map();this.top=false;this.openMenuEl=null;this.dead=false;this.meta=null;this.metaName='';
      this.onRoute=()=>this.scan();this.initialHref=location.href;
      // Record the feed position only while this community's feed path is showing (with or without rt_view:
      // the automatic preference opens the archive without it), never during navigation to a post.
      this.onScroll=()=>{const m=this.mounted;if(m && !m.thread && !threadRoute() && location.pathname.replace(/\/+$/,'').toLowerCase()==='/r/'+m.name.toLowerCase()){this.feedScrollY=scrollY;if(!this.anchorQueued){this.anchorQueued=true;requestAnimationFrame(()=>{this.anchorQueued=false;this.saveFeedAnchor();});}}};
      addEventListener('scroll',this.onScroll,{passive:true});
      this.onDocClick=event=>{if(this.openMenuEl && !this.openMenuEl.parentElement.contains(event.target))this.closeMenus();};
      this.onKey=event=>{if(event.key==='Escape' && this.openMenuEl){const button=this.openMenuEl.parentElement.querySelector('button');this.closeMenus();button?.focus({preventScroll:true});}};
      document.addEventListener('click',this.onDocClick,true);document.addEventListener('keydown',this.onKey,true);
      if(observe){
        this.observer=new MutationObserver(()=>this.scan());this.observer.observe(document.documentElement,{childList:true,subtree:true});
        window.addEventListener('popstate',this.onRoute);document.addEventListener('reddit:route',this.onRoute);
        this.onSettings=(changes,area)=>{if(area==='local' && changes['rt-settings-v1'])this.loadSettings();};
        this.onSettingsMessage=message=>{if(message?.scope==='rt-posts' && message.action==='settings-changed')this.loadSettings();};
        try{chrome.runtime?.onMessage?.addListener(this.onSettingsMessage);}catch{}
        try{chrome.storage?.onChanged?.addListener(this.onSettings);}catch{}
      }
      this.ready=this.loadSettings();
    }
    async loadSettings(){
      const revision=this.settingsRevision=(this.settingsRevision || 0)+1;let settings;try{settings=await this.readSettings();}catch{}
      if(this.dead || revision!==this.settingsRevision)return;this.enabled=settings?.enabled===true;this.automatic=this.enabled && settings?.automatic===true;this.scan();
    }
    destroy(){
      if(this.dead)return;this.dead=true;this.observer?.disconnect();window.removeEventListener('popstate',this.onRoute);document.removeEventListener('reddit:route',this.onRoute);
      removeEventListener('scroll',this.onScroll);document.removeEventListener('click',this.onDocClick,true);document.removeEventListener('keydown',this.onKey,true);
      try{chrome.storage?.onChanged?.removeListener(this.onSettings);chrome.runtime?.onMessage?.removeListener(this.onSettingsMessage);}catch{}this.unmount();this.unmountSearch();this.keptNavigationController?.abort();this.keptNavigation=this.keptNavigationController=null;
    }

    // Called on every relevant change. Until settings are known nothing is added (an early hold may stay).
    scan(){
      if(this.dead || this.enabled===null)return;
      if(!this.avatarSweep){this.avatarSweep=true;(globalThis.requestAnimationFrame || setTimeout)(()=>{this.avatarSweep=false;this.watchAvatars();});}
      const route=this.enabled?searchRoute():null;
      if(route){this.unmount();this.scanSearch(route);return;}
      this.unmountSearch();
      const modal=document.querySelector('guard-community-modal[subredditname]'),routeName=location.pathname.match(/^\/r\/([A-Za-z0-9_]{2,21})(?:\/comments\/[a-z0-9]{1,10}(?:\/.*)?)?\/?$/i)?.[1],kind=this.enabled && routeName?.toLowerCase()===modal?.getAttribute('subredditname')?.toLowerCase()?unavailable(modal):'',thread=this.enabled?threadRoute():null,wanted=this.automatic || viewRequested() || Boolean(thread);
      if(this.mounted && (!kind || modal!==this.mounted.modal || !wanted || JSON.stringify(this.mounted.thread)!==JSON.stringify(thread))){this.unmount();}
      if(!modal)return;
      if(!kind){modal.querySelector('[data-rt-ui="subreddit-archive-action"]')?.remove();release(modal);return;}
      this.ensureButton(modal,kind);
      if(wanted && !this.mounted)this.mount(modal,kind,thread);else if(!wanted && !this.mounted && modal.hasAttribute(holdAttr))release(modal);
    }

    ensureButton(modal,kind){
      if(modal.querySelector('[data-rt-ui="subreddit-archive-action"]'))return;
      // Same classes as the notice's own secondary button, placed in the same slot as its primary one.
      // Content-sized (no w-100) so it sits on the row of Reddit's own button at the same height.
      const slot=make('div');slot.setAttribute('slot','primaryButton');slot.dataset.rtUi='subreddit-archive-action';
      const button=make('button','button-medium px-[calc(var(--rem12)-var(--button-border-width,0px))] button-secondary items-center justify-center button inline-flex');button.type='button';button.setAttribute('rpl','');
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
    communityPanel(name,kind,{note=true}={}){
      const meta=this.meta,panel=make('div','rt-sra-about');panel.dataset.rtUi='archive-community-info';
      panel.append(make('h2','rt-sra-about-title',meta?.title && meta.title.toLowerCase()!==name.toLowerCase()?meta.title:'r/'+name));
      if(meta?.description)panel.append(make('p','rt-sra-about-text',meta.description));
      const facts=make('ul','rt-sra-facts');
      const fact=(icon,text)=>{const li=make('li','rt-sra-fact'),art=glyph(icon);li.append(art,make('span','',text));facts.append(li);};
      if(meta?.created)fact('calendar','Created '+day(meta.created));
      fact(kind==='private'?'hidden':'removed',kind==='private'?'Private':'Banned');
      panel.append(facts);
      if(meta?.subscribers){const stats=make('dl','rt-sra-stats'),item=make('div');item.append(make('dd','',compact(meta.subscribers)),make('dt','','Members'));stats.append(item);panel.append(stats);}
      if(!note)return panel;
      const text=make('p','rt-sra-about-note');text.append(document.createTextNode('Archived posts from '),arcticLink('Arctic Shift'),document.createTextNode('. Coverage may be partial.'));panel.append(text);
      return panel;
    }

    // ---- feed page ----------------------------------------------------------------------------------------------
    mount(modal,kind,thread=null){
      const name=modal.getAttribute('subredditname'),f=globalThis.RTFeedFilters,params=new URLSearchParams(location.search);
      this.name=name;this.kind=kind;this.filters=f?f.read(location):null;this.top=params.get('rt_top')==='1';
      const stash=this.feedStash,reuse=stash && stash.name===name.toLowerCase() && Date.now()-stash.at<30*60*1000;if(stash && !reuse)this.feedStash=null;
      this.states=!thread && reuse?stash.states:new Map();if(!thread && !reuse)this.feedScrollY=undefined;if(!thread && reuse){this.feedStash=null;for(const state of this.states.values())state.loading=false;if(!this.restoringFeed)this.restoreFeedScroll(stash.scrollY);}
      modal.setAttribute(mountedAttr,'true');hold(modal);
      const layout=this.layout=make('div','grid-container theme-rpl grid '+this.navigationClass());layout.dataset.rtUi='archive-subreddit';layout.dataset.rtSubreddit=name;layout.dir='ltr';
      const subgrid=make('div','subgrid-container m:col-start-2 box-border flex flex-col order-2 w-full m:w-[1120px] xs:px-md m:px-lg mx-auto min-h-[calc(100dvh_-_var(--shreddit-header-height))] justify-stretch');subgrid.id='subgrid-container';
      this.headerEl=make('div','masthead w-full relative subreddit-feed-masthead rt-sra-header');this.headerEl.dataset.rtUi='archive-header';this.renderHeader();
      const columns=make('div','main-container gap-lg w-full flex-1 grid place-content-between grid-cols-[minmax(0,1fr)] fixed-sidebar xs:[&.fixed-sidebar]:grid-cols-[minmax(0,756px)_minmax(0,316px)] xs:[&.flex-sidebar]:grid-cols-[minmax(0,756px)_auto]');
      const main=make('main','main w-full min-w-0');main.id='main-content';
      this.listEl=make('shreddit-feed','nd:visible');this.listEl.dataset.rtArchiveFeed='true';this.listEl.setAttribute('aria-live','polite');this.startScrollKeeper(this.listEl);
      this.footEl=make('div','rt-sra-foot');this.sentinel=make('div','rt-sra-sentinel');this.sentinel.setAttribute('aria-hidden','true');
      this.statusTop=make('p','rt-sra-note text-12 text-neutral-content-weak');this.statusTop.hidden=true;
      main.append(...(thread?[]:[this.buildControls()]),make('hr','border-0 border-b-sm border-solid border-b-neutral-border-weak'),this.statusTop,this.listEl,this.footEl,this.sentinel);
      const sidebar=this.sidebarEl=make('aside','rt-sra-sidebar-rail right-sidebar min-w-0 w-[316px] max-w-[316px] hidden xs:block styled-scrollbars xs:sticky xs:top-[56px] xs:max-h-screen-without-header xs:overflow-y-auto xs:overflow-x-hidden');sidebar.id='right-sidebar-container';
      this.sidebarThread=Boolean(thread);this.renderSidebar();
      columns.append(main,sidebar);subgrid.append(...(thread?[]:[this.headerEl]),columns);layout.append(subgrid);this.mountNavigation(layout,name);modal.before(layout);
      document.documentElement.setAttribute('data-rt-subreddit-archive','');
      this.mounted={modal,kind,name,thread};this.loadNavigation();
      if(typeof IntersectionObserver==='function'){
        this.io=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){if(this.mounted?.thread)this.loadMoreThread({auto:true});else this.loadMore({auto:true});}},{rootMargin:'800px 0px'});this.io.observe(this.sentinel);
      }
      this.loadMeta(name,()=>{if(this.mounted?.name===name){this.renderHeader();this.renderSidebar();}});if(thread){const seen=this.recentPosts?.get('t3_'+thread.postId);this.threadState={route:thread,post:seen && seen.subreddit?.toLowerCase()===name.toLowerCase()?seen:null,items:[],seen:new Set(),hasMore:true,loading:false,cursor:null};this.loadThread();}else{this.syncAll();this.refresh();if(!reuse)this.restoreFeedAnchor();this.mountedBefore=true;}
    }
    unmount(){
      const m=this.mounted;if(!m)return;this.mounted=null;this.threadState?.modulesController?.abort();this.scrollKeeper?.stop();this.scrollKeeper=null;this.threadState=null;
      this.io?.disconnect();this.io=null;this.pickerHost?.remove();this.closeMenus();
      if(!m.thread)this.feedStash={name:m.name.toLowerCase(),states:this.states,scrollY:this.feedScrollY ?? scrollY,at:Date.now()};
      for(const state of this.states.values())this.retireFeedState(state);
      if(this.recentPosts?.size>600)this.recentPosts=new Map([...this.recentPosts].slice(-300));
      // Keep the left nav (rendered, loading, or showing its fallback): the next mount of the same community moves it
      // instead of re-rendering from an empty placeholder (no blank nav). A loading nav keeps its request;
      // mountNavigation aborts it if the nav isn't reused.
      const nav=this.navigation,keep=['loading','ready','failed'].includes(nav?.dataset.state);this.navigation=null;
      if(keep && nav.dataset.state==='loading')this.keptNavigationController=this.navigationController;else this.navigationController?.abort();
      this.navigationController=null;this.keptNavigation=keep?nav:null;nav?.remove();
      this.layout?.remove();this.layout=null;m.modal.removeAttribute(mountedAttr);
      document.documentElement.removeAttribute('data-rt-subreddit-archive');
      if(m.modal.isConnected)release(m.modal);
    }
    async loadThread({more=false}={}){
      const state=this.threadState;if(!state || state.loading)return;state.loading=true;state.loadingMore=more && Boolean(state.post);if(state.error)state.emptyPages=0;state.error=null;state.beforeCount=state.items.length;this.renderThread();
      const current=()=>this.threadState===state && this.mounted?.thread?.postId===state.route.postId;
      try{
        if(!state.post){
          const answer=await this.archive({action:'archive-ids',ids:[state.route.postId]});if(!current())return;
          state.post=(answer.posts || []).map(raw=>globalThis.RTPostModel.normalizePost(raw,{source:'arctic-shift'})).find(post=>post?.id===state.route.postId && post.subreddit.toLowerCase()===this.name.toLowerCase());
          if(!state.post){state.missing=true;state.hasMore=false;return;}this.renderThread();
        }
        const answer=await this.archive({action:'archive-thread-comments',postId:state.route.postId,...(more && state.cursor?{before:state.cursor}:{}),...(!more && state.route.focusId?{focusId:state.route.focusId}:{})});if(!current())return;
        for(const raw of answer.posts || []){const comment=globalThis.RTPostModel.normalizeComment(raw,{source:'arctic-shift'});if(comment?.linkId===state.route.postId && comment.subreddit.toLowerCase()===this.name.toLowerCase() && !state.seen.has(comment.fullname)){state.seen.add(comment.fullname);state.items.push(comment);}}
        const previous=state.cursor;state.cursor=answer.cursor || null;state.stalled=answer.cursorStalled===true || more && answer.hasMore===true && state.cursor===previous;state.hasMore=answer.hasMore===true && Boolean(state.cursor) && !state.stalled;
        state.emptyPages=state.items.length===state.beforeCount?(state.emptyPages || 0)+1:0;
        if(state.hasMore && state.emptyPages>=3)state.error={message:'The archive returned no additional matching comments after three pages. Retry to search further.'};
      }catch(error){if(current())state.error={message:error.message || 'The archive is unavailable.'};}
      finally{if(current()){state.loading=false;this.renderThread();if(!state.error && !state.stalled)this.reobserve();}}
    }
    loadMoreThread(){
      const state=this.threadState;if(!state || !this.mounted?.thread || state.loading || state.error || state.missing || state.stalled)return;
      if(state.hiddenTop>0){state.shownTop+=TOP_BATCH;this.renderThread();this.reobserve();}
      else if(state.hasMore)this.loadThread({more:true});
    }
    threadComment(comment){
      // Reddit's comment element can render its own layout from light-DOM slots.
      // Request its native shadow renderer rather than reproducing the SSR grid.
      const node=make('shreddit-comment','col-start-2 rt-sra-thread-comment');node.id=comment.fullname;node.dataset.rtUi='archive-thread-comment';
      const path='/r/'+encodeURIComponent(this.name)+'/comments/'+comment.linkId+'/_/'+comment.id+'/';
      for(const [name,value] of Object.entries({'slot-config':'shadow',thingid:comment.fullname,postid:'t3_'+comment.linkId,parentid:comment.parentId || 't3_'+comment.linkId,author:comment.author,permalink:path,depth:0}))node.setAttribute(name,String(value));
      const author=make('div','flex relative ps-xs py-[2px] min-w-0 max-w-full text-body-2 tracking-normal items-start');author.slot='commentMeta';
      const identity=make('div','flex items-center pe-xs overflow-hidden'),name=make('div','flex flex-none flex-row flex-nowrap items-center author-name-meta');
      if(globalThis.RTPostModel.validateUsername(comment.author)){const link=make('a','truncate font-bold text-neutral-content-strong text-12 hover:underline',comment.author);link.href='/user/'+encodeURIComponent(comment.author)+'/';name.append(link);}else name.append(make('span','text-neutral-content-weak text-12',comment.author || '[deleted]'));
      const timeLink=make('a','text-neutral-content-weak text-12 hover:no-underline');timeLink.href=path;timeLink.append(this.time(comment.created));name.append(make('span','inline-block my-0 mx-2xs text-12 text-neutral-content-weak','•'),timeLink);identity.append(name);author.append(identity);
      const body=make('div','md text-14-scalable rounded-2 pb-2xs overflow-hidden pt-2xs');body.slot='comment';const text=make('div','py-0 xs:mx-xs mx-2xs max-w-full scalable-text');text.dir='auto';
      {const rendered=globalThis.RTMarkdown?.fromHtml?.(comment.bodyHtml) || globalThis.RTMarkdown?.render?.(comment.body || '');if(rendered)text.append(rendered);else text.append(make('p','',comment.body || 'The archive has no original text for this comment.'));}body.append(text);
      const actions=make('shreddit-comment-action-row','block min-h-xl');actions.slot='actionRow';for(const [key,value] of Object.entries({'comment-id':comment.fullname,score:comment.score,'vote-state':'NONE','view-only':'','comment-archived':'','is-desktop-viewport':'',permalink:path}))actions.setAttribute(key,String(value));
      const share=make('shreddit-comment-share-button');share.slot='comment-share';share.setAttribute('permalink',path);share.setAttribute('source-id',comment.fullname);share.setAttribute('is-desktop-viewport','');actions.append(share);const avatar=make('div','flex flex-row items-center rt-sra-comment-avatar');avatar.slot='commentAvatar';avatar.append(defaultAvatar(comment.author,comment.depth?24:32,globalThis.RTPostModel.validateUsername(comment.author)?'/user/'+encodeURIComponent(comment.author)+'/':''));node.append(avatar,author,body,actions);
      // Reddit can render snapshot scores but no action may mutate a snapshot.
      for(const type of ['click','keydown'])actions.addEventListener(type,event=>{if(event.type==='keydown' && !['Enter',' '].includes(event.key))return;if(!event.composedPath().some(part=>part.matches?.('shreddit-comment-share-button'))){event.preventDefault();event.stopImmediatePropagation();}},true);
      return node;
    }
    renderThread(){
      const state=this.threadState;if(!state || !this.mounted)return;
      if(!state.commentsEl){
        this.listEl.replaceChildren();state.nodes=new Map();state.commentsEl=make('section','rt-sra-thread-comments');state.commentsEl.setAttribute('aria-label','Archived comments');
        this.listEl.append(state.commentsEl);
      }
      if(state.post && !state.postEl){
        const card=state.postEl=globalThis.RTPostDiscovery.archiveCard(state.post,{thread:true}),native=card.querySelector('shreddit-post');
        if(native){native.classList.add('rt-sra-thread-post');native.querySelector('[data-rt-source]')?.remove();
        }this.listEl.insertBefore(card,state.commentsEl);
      }
      // Reddit renders the comment toolbar with the post, never before it: it arrives in the same frame as the post
      // (or with the first comments when the archive has no post record).
      if(!state.toolbarEl && (state.postEl || state.missing && state.items.length)){state.toolbarEl=this.commentToolbar(state);this.listEl.insertBefore(state.toolbarEl,state.commentsEl);}
      const comments=state.commentsEl,nodes=state.nodes,items=new Map(state.items.map(item=>[item.fullname,item]));
      for(const item of state.items)if(!nodes.has(item.fullname))nodes.set(item.fullname,this.threadComment(item));
      const hold=this.holdScroll();const changed=this.placeComments(state,items,nodes,comments);hold?.();
      // An open comment search covers comments that arrive after it ran.
      if(state.commentQuery && state.searchedCount!==state.items.length)this.renderCommentSearch(state);
      if(state.items.length && !state.nativeModulesRequested && !state.nativeModulesError){state.nativeModulesRequested=true;state.modulesController=new AbortController();this.reddit({action:'load-archive-comment-modules',postId:state.route.postId},state.modulesController.signal).catch(error=>{if(this.threadState!==state)return;state.nativeModulesRequested=false;state.nativeModulesError=error.message || 'Reddit comment components are unavailable.';this.renderThread();});}
      if(changed)this.reddit({action:'refresh-archive-thread',postId:state.route.postId}).catch(()=>{});
      this.statusTop.hidden=true;this.statusTop.textContent='';
      this.footEl.replaceChildren();
      if(state.nativeModulesError){const note=make('p','rt-sra-note',state.nativeModulesError+' '),retry=make('button','button button-small button-secondary','Retry Reddit components');retry.type='button';retry.addEventListener('click',()=>{state.nativeModulesError=null;this.renderThread();});note.append(retry);this.footEl.append(note);}
      // Reddit's page halo continues the top-level list; only nested reply controls use the small spinner.
      if(state.loading || this.io && !state.error && !state.stalled && (state.hiddenTop>0 || state.hasMore))this.footEl.append(this.loadingHalo('Loading archived comments'));
      if(!state.error && !state.loading)state.autoRetries=0;if(state.error)this.footEl.append(this.errorNote(state,()=>this.loadThread({more:Boolean(state.post && state.cursor)})));
      if(!state.loading && !state.error){
        if(state.missing)this.footEl.append(make('p','rt-sra-note','This post is not in the archive. Coverage may be partial.'));
        else if(state.stalled)this.footEl.append(make('p','rt-sra-note','The archive stopped paging here; more comments may exist.'));
        else if(!state.hasMore && !state.hiddenTop)this.footEl.append(make('p','rt-sra-note',state.items.length?'End of what the archive returned · Coverage may be partial':'No archived comments returned. This does not establish that the post had no comments.'));
        // A comment permalink, as Reddit shows it: the comment's thread first, the comment highlighted, and the page
        // scrolled so the comment toolbar sits just under Reddit's header.
        if(state.route.focusId && !state.focused){const target=nodes.get('t1_'+state.route.focusId);if(target?.isConnected){state.focused=true;target.classList.add('rt-sra-highlighted');target.setAttribute('is-current-permalink','');target.setAttribute('highlight-variant','reply');target.setAttribute('is-highlighted','');
          const anchor=state.toolbarEl || state.commentsEl,headerBottom=()=>Math.max(0,document.querySelector('reddit-header-large,header')?.getBoundingClientRect().bottom || 0);
          const place=()=>{if(!anchor.isConnected || this.threadState!==state)return;const delta=anchor.getBoundingClientRect().top-headerBottom();if(Math.abs(delta)>=1)scrollBy(0,delta);};
          place();let moved=false;const stop=()=>{moved=true;};addEventListener('wheel',stop,{passive:true,once:true});addEventListener('touchstart',stop,{passive:true,once:true});addEventListener('keydown',stop,{once:true});
          for(const ms of [150,600,1500])setTimeout(()=>{if(!moved)place();},ms);}else if(!state.loading)this.footEl.append(make('p','rt-sra-note','The requested comment is not in the loaded archive records.'));}
      }
    }
    // Reddit-like comment tree: best-first (score, as the archive has no "Best"), TOP_BATCH top-level comments,
    // a few replies per comment with "N more replies", and at most MAX_DEPTH+1 levels; deeper replies are a link
    // to that comment's own page. The focused comment's chain is always shown. Nodes are reused, never rebuilt.
    // Returning to the feed from a post: Reddit (or the browser) may scroll first, and the reused cards need a
    // layout pass. Re-apply the saved position for a short while, and stop as soon as the user scrolls.
    // Saved per history entry (Navigation API key): Back/Forward to that entry finds it, a new link to the feed
    // creates a new entry and starts at the top. Falls back to the community and filters where the API is missing.
    // Archive records carry no avatars: once a default avatar nears the screen, ask Reddit (through the page
    // bridge's hover-card lookup, which throttles itself) for that user's real picture. Deleted or suspended
    // accounts and accounts without one keep the default. One lookup per user per page.
    watchAvatars(){
      const images=document.querySelectorAll('img[data-rt-avatar-user]:not([data-rt-avatar-watched])');if(!images.length)return;
      if(!this.avatarIO && typeof IntersectionObserver==='function')this.avatarIO=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){this.avatarIO.unobserve(entry.target);this.resolveAvatar(entry.target);}},{rootMargin:'600px 0px'});
      for(const img of images){img.dataset.rtAvatarWatched='';if(this.avatarIO)this.avatarIO.observe(img);else this.resolveAvatar(img);}
    }
    resolveAvatar(img){
      const user=img.dataset.rtAvatarUser,key=user.toLowerCase();this.avatarUrls ||= new Map();let lookup=this.avatarUrls.get(key);
      if(!lookup){
        lookup=(async()=>{for(let attempt=0;attempt<4;attempt++){try{const result=await this.reddit({action:'user-avatar',username:user});if(!result?.deferred)return safeAvatar(result?.avatar);await new Promise(r=>setTimeout(r,Math.min(5000,result.retryAfterMs || 500)));}catch{return '';}}return null;})();
        // A deferred-out lookup (null) may be retried later; a definitive answer is kept.
        lookup.then(url=>{if(url===null && this.avatarUrls.get(key)===lookup)this.avatarUrls.delete(key);});
        if(this.avatarUrls.size>=500)this.avatarUrls.delete(this.avatarUrls.keys().next().value);this.avatarUrls.set(key,lookup);
      }
      // Suspended or deleted accounts answer with Reddit's profile artwork; posts and comments use its small snoo-back instead.
      lookup.then(url=>{if(!url)return;if(/^https:\/\/www\.redditstatic\.com\/shreddit\/assets\//.test(url)){img.src=DELETED_AVATAR;img.classList.add('rt-avatar-deleted');return;}img.src=url;img.dataset.rtAvatarReal='';});
    }
    feedAnchorKey(){return 'rt-archive-anchor:'+(globalThis.navigation?.currentEntry?.key || '')+'|'+(this.mounted?.name || this.name || '').toLowerCase()+'|'+this.feedKey();}
    // The card at the top of the view, its offset, and how many posts were showing: survives a reload of a post
    // page (which drops this script's memory), so Back can rebuild the same position in a freshly loaded feed.
    saveFeedAnchor(){
      if(!this.listEl?.isConnected || !this.mounted || this.mounted.thread || this.restoringFeed)return;
      let card=null;for(const node of this.listEl.querySelectorAll(':scope > .rt-native-card')){const r=node.getBoundingClientRect();if(r.bottom>80){card=node;break;}}
      try{if(scrollY<=0 || !card){sessionStorage.removeItem(this.feedAnchorKey());return;}
        const state=this.states.get(this.feedKey());sessionStorage.setItem(this.feedAnchorKey(),JSON.stringify({fullname:card.dataset.fullname,offset:Math.round(card.getBoundingClientRect().top),count:state?this.visibleItems(state).length:0,at:Date.now()}));}catch{}
    }
    restoreFeedAnchor(){
      let saved=null;try{saved=JSON.parse(sessionStorage.getItem(this.feedAnchorKey()) || 'null');}catch{}
      const nav=performance.getEntriesByType?.('navigation')?.[0]?.type;
      // Reloading (or freshly opening) the feed page itself starts at the top, like Reddit. Any other return to a
      // history entry that saved an anchor (Back/Forward, in-page or after a reload elsewhere) restores it.
      const fresh=!this.mountedBefore && location.href===this.initialHref && nav!=='back_forward';
      const back=!fresh;
      if(!saved?.fullname || Date.now()-saved.at>60*60*1000 || !back){try{sessionStorage.removeItem(this.feedAnchorKey());}catch{}return;}
      const state=this.states.get(this.feedKey());if(!state || !this.listEl)return;
      // Reveal (and fetch) enough posts in one go, and keep the feed hidden until it is in place, so the reader
      // never watches it scroll down from the top.
      state.want=Math.max(state.want || PAGE_SIZE,Math.ceil((saved.count || PAGE_SIZE)/PAGE_SIZE)*PAGE_SIZE);
      this.listEl.style.visibility='hidden';this.restoringFeed=true;try{history.scrollRestoration='manual';}catch{}
      let user=false;const stop=()=>{user=true;},events=['wheel','touchmove','keydown','mousedown'];for(const type of events)addEventListener(type,stop,{passive:true,capture:true});
      const show=()=>{if(this.listEl)this.listEl.style.visibility='';};
      const done=()=>{show();this.restoringFeed=false;for(const type of events)removeEventListener(type,stop,{capture:true});};
      const started=performance.now();let placedAt=0,card=null;
      const find=()=>[...(this.listEl?.querySelectorAll(':scope > .rt-native-card') || [])].find(node=>node.dataset.fullname===saved.fullname);
      const step=()=>{
        // Reddit can replace its notice element, which remounts the archive around the same cards: follow the
        // current list instead of giving up, and wait briefly while it is between unmount and mount.
        if(this.mounted?.thread || performance.now()-started>15000){done();return;}
        if(!this.mounted || !this.listEl?.isConnected){setTimeout(step,30);return;}
        if(!placedAt)this.listEl.style.visibility='hidden';
        if(!placedAt){
          card=state.loading?null:find();
          if(!card){
            if(performance.now()-started>12000 || user){done();return;}
            if(!state.loading && !state.error && state.started){if(this.visibleItems(state).length<state.want && state.hasMore)this.fillFeed(state);else if(this.visibleItems(state).length>=state.want)this.renderList();else{done();return;}}
            setTimeout(step,100);return;
          }
          placedAt=performance.now();this.anchorStableSince=placedAt;scrollBy(0,card.getBoundingClientRect().top-saved.offset);show();
        }
        // Pin the anchor while media above it settles, until the layout has been stable for 1 s (at most 6 s),
        // unless the reader takes over. Re-find it each frame: the feed may re-render the card element.
        card=card.isConnected?card:find();const now=performance.now();
        if(user || !card || now-placedAt>6000 || now-(this.anchorStableSince ||= now)>1000){this.anchorStableSince=0;done();return;}
        const delta=card.getBoundingClientRect().top-saved.offset;if(Math.abs(delta)>=1){scrollBy(0,delta);this.anchorStableSince=now;}
        // A timer, not requestAnimationFrame: rAF pauses in an unfocused or hidden window and the pin would stop.
        setTimeout(step,30);
      };
      setTimeout(step,0);
    }
    restoreFeedScroll(target){
      if(!(target>0))return;this.feedScrollY=target;let user=false;const stop=()=>{user=true;},events=['wheel','touchmove','keydown','mousedown'];
      for(const type of events)addEventListener(type,stop,{passive:true,capture:true});
      const until=performance.now()+1500,apply=()=>{if(user || this.mounted?.thread || !this.mounted){done();return;}
        const max=document.documentElement.scrollHeight-innerHeight;if(Math.abs(scrollY-target)>2 && max>=target-2)scrollTo(0,target);
        if(performance.now()<until)requestAnimationFrame(apply);else done();};
      const done=()=>{for(const type of events)removeEventListener(type,stop,{capture:true});};
      requestAnimationFrame(apply);
    }
    // Around a synchronous list change: note what the reader is looking at now, and correct right after the change.
    holdScroll(){const keeper=this.scrollKeeper;if(!keeper)return null;keeper.pick();return ()=>keeper.check();}
    // Keeps what the reader is looking at in place when anything above it changes size (new comments or posts,
    // loaders, images, avatars, Reddit's components upgrading). Positions are measured in the page, not the
    // window, so the reader's own scrolling (even mid smooth-scroll) is never mistaken for a shift. The browser's
    // own scroll anchoring is turned off for the list so the two never correct the same shift twice.
    startScrollKeeper(list){
      this.scrollKeeper?.stop();this.scrollKeeper=null;
      if(typeof ResizeObserver!=='function' || typeof document.elementFromPoint!=='function')return;
      list.style.overflowAnchor='none';
      let anchor=null,docTop=0,timer=0,stopped=false;
      const pick=()=>{clearTimeout(timer);timer=0;anchor=null;if(stopped || this.restoringFeed || scrollY<=0 || !list.isConnected)return;const left=list.getBoundingClientRect().left+48;
        for(const y of [140,220,340,480]){const hit=document.elementFromPoint(left,y)?.closest?.('shreddit-comment[data-rt-ui="archive-thread-comment"],[data-rt-ui="archive-comment-toolbar"],.rt-sra-thread-post,[data-rt-archive-feed] > .rt-native-card');if(hit && list.contains(hit)){anchor=hit;docTop=hit.getBoundingClientRect().top+scrollY;return;}}};
      const check=()=>{if(stopped || this.restoringFeed){anchor=null;return;}if(!anchor?.isConnected){pick();return;}
        const now=anchor.getBoundingClientRect().top+scrollY,delta=now-docTop;if(Math.abs(delta)<1)return;docTop=now;if(scrollY>0)scrollBy(0,delta);};
      const onScroll=()=>{if(!timer)timer=setTimeout(pick,50);};
      const observer=new ResizeObserver(check);observer.observe(list);addEventListener('scroll',onScroll,{passive:true});
      this.scrollKeeper={pick,check,stop:()=>{stopped=true;observer.disconnect();clearTimeout(timer);removeEventListener('scroll',onScroll);}};
    }
    // Reddit's comment toolbar (comment-body-header): "Sort by" (Best/Top/New/Old, computed from loaded archive
    // comments; the archive can't do Controversial or Q&A) and Reddit's comment search, rebuilt from its markup.
    commentToolbar(state){
      const bar=make('div','block px-md xs:px-0 rt-sra-comment-toolbar');bar.dataset.rtUi='archive-comment-toolbar';
      const row=make('div','flex gap-xs items-center w-full flex-wrap mt-sm'),host=make('div','flex gap-xs items-center flex-wrap nd:min-h-xl rt-sra-cs-host');row.append(host);bar.append(row);
      const labels={best:'Best',top:'Top',new:'New',old:'Old'},f=globalThis.RTFeedFilters;
      let menu=null;const sort=this.dropdown(labels[state.commentSort || 'best'],el=>{menu=el;},{title:'Sort comments'});
      const build=()=>{menu.replaceChildren();for(const [key,label] of Object.entries(labels)){
        const choose=()=>{this.closeMenus();if((state.commentSort || 'best')===key)return;state.commentSort=key;state.childOrder=new Map();state.shownTop=TOP_BATCH;state.shownReplies=new Map();sort.text.textContent=label;this.renderThread();state.toolbarEl?.scrollIntoView?.({block:'start'});};
        let el;if(f?.menuOption){el=f.menuOption(f.plainContext(glyph,{role:'menuitemradio'}),{label,icon:false,value:key,checked:(state.commentSort || 'best')===key,onSelect:choose});}
        else{el=make('button','rt-sra-menu-row',label);el.type='button';el.addEventListener('click',choose);}
        el.dataset.rtUi='filter-option';el.setAttribute('aria-checked',String((state.commentSort || 'best')===key));menu.append(el);}};
      build();sort.button.addEventListener('click',build,true);
      sort.button.setAttribute('aria-label','Sort by '+labels[state.commentSort || 'best']);
      const sortGroup=make('div','flex items-center pdp-comments-tree-sort-container rt-sra-comment-sort');const sortLabel=make('span','lg:me-2xs text-neutral-content-weak text-12 whitespace-nowrap rt-sra-sort-label','Sort by:');sortLabel.setAttribute('aria-hidden','true');sortGroup.append(sortLabel,sort.wrap);
      // Reddit's pdp-comment-search-input: an outlined "Search Comments" button; clicking it hides Sort by and shows
      // the search box (Reddit's own faceplate-search-input) with Cancel. Nothing filters until Enter, which adds
      // ?q=…&type=comments; Escape in an empty box and Cancel go back to the button.
      const pdp=make('div','flex-1 nd:block nd:h-[40px] rt-sra-cs'),inner=make('div','block');pdp.append(inner);
      const expand=make('button','border-neutral-border-weak hover:border-neutral-content-weak text-secondary-weak font-normal button-medium px-[calc(var(--rem12)-var(--button-border-width,0px))] button-bordered items-center justify-center button inline-flex rt-sra-cs-button');
      expand.type='button';expand.setAttribute('rpl','');expand.setAttribute('aria-controls','rt-sra-cs-form');expand.setAttribute('aria-expanded','false');
      {const outer=make('span','flex items-center justify-center'),icon=make('span','flex ms-[-2px] me-xs'),pad=make('span','flex ps-xs'),label=make('span','flex items-center gap-xs');pad.append(pdpIcon('search'));icon.append(pad);label.append(make('span','flex flex-1 pe-xs text-start','Search Comments'));outer.append(icon,label);expand.append(outer,srOnly('Expand comment search'));}
      const form=make('form','flex w-full rt-sra-cs-form');form.id='rt-sra-cs-form';form.hidden=true;form.setAttribute('role','search');
      const field=make('faceplate-search-input');field.className='text-secondary-plain m-0 rounded-full outline outline-1 outline-neutral-border-weak grow focus:outline-neutral-content-weak rt-sra-cs-field';
      for(const [k,v] of Object.entries({enterkeyhint:'search',placeholder:'Search Comments',value:'','aria-label':'Search Comments'}))field.setAttribute(k,v);
      const clear=make('button',' button-small px-[calc(var(--rem10)-var(--button-border-width,0px))] button-plain icon items-center justify-center button inline-flex rt-sra-cs-clear');clear.type='button';clear.slot='clearIcon';clear.setAttribute('rpl','');
      {const outer=make('span','flex items-center justify-center'),icon=make('span','flex');icon.append(pdpIcon('clear'));outer.append(icon);clear.append(outer,srOnly('Clear search'));}field.append(clear);
      const cancel=make('button','ms-xs button-medium px-[calc(var(--rem12)-var(--button-border-width,0px))] button-plain items-center justify-center button inline-flex rt-sra-cs-cancel');cancel.type='button';cancel.setAttribute('rpl','');
      {const outer=make('span','flex items-center justify-center');outer.append(make('span','flex items-center gap-xs','Cancel'));cancel.append(outer);}
      form.append(field,cancel);inner.append(expand,form);host.append(sortGroup,pdp);
      // The extension can't see Reddit's element properties (separate JS world): read and write its textarea.
      const box=()=>field.shadowRoot?.querySelector('textarea,input');
      const value=()=>String((box() || field).value ?? '').trim();
      const setValue=text=>{field.setAttribute('value',text);const inner=box();if(inner){inner.value=text;inner.dispatchEvent(new Event('input',{bubbles:true,composed:true}));}else field.value=text;};
      // Reddit's search input renders its textarea asynchronously; focus it once it exists.
      const focusField=()=>{const go=()=>{const inner=box();if(inner)inner.focus({preventScroll:true});else field.focus?.({preventScroll:true});};go();if(!field.shadowRoot?.activeElement)requestAnimationFrame(go);};
      const open=(focus=true)=>{sortGroup.hidden=true;expand.hidden=true;form.hidden=false;host.classList.add('w-full');expand.setAttribute('aria-expanded','true');if(focus)focusField();};
      const close=()=>{form.hidden=true;sortGroup.hidden=false;expand.hidden=false;host.classList.remove('w-full');expand.setAttribute('aria-expanded','false');};
      state.closeCommentSearch=({focus=true}={})=>{setValue('');const was=Boolean(state.commentQuery);state.commentQuery='';setParams({q:null,type:null});close();if(was)this.renderCommentSearch(state);if(focus)expand.focus({preventScroll:true});};
      state.runCommentSearch=text=>{state.commentQuery=text;setParams({q:text,type:'comments'});this.renderCommentSearch(state);};
      expand.addEventListener('click',event=>{event.preventDefault();open();});
      cancel.addEventListener('click',event=>{event.preventDefault();state.closeCommentSearch();});
      clear.addEventListener('click',event=>{event.preventDefault();setValue('');focusField();});
      form.addEventListener('submit',event=>{event.preventDefault();if(value())state.runCommentSearch(value());});
      // Capture phase: Reddit's input handles keys inside its shadow root and may not let them bubble.
      field.addEventListener('keydown',event=>{
        if(event.key==='Enter' && !event.isComposing){event.preventDefault();if(value())state.runCommentSearch(value());}
        else if(event.key==='Escape' && !value()){event.preventDefault();state.closeCommentSearch();}},true);
      // A link to a comment search (…?q=…&type=comments) opens with its results.
      const params=new URLSearchParams(location.search);if(params.get('type')==='comments' && params.get('q')){setValue(params.get('q'));state.commentQuery=params.get('q').trim();open(false);queueMicrotask(()=>this.renderCommentSearch(state));}
      state.commentField=field;return bar;
    }
    // Reddit's comment search results: "All Comments" (back to the tree), then one grey card per matching comment
    // linking to its permalink; no count line. No matches: Reddit's telescope box.
    renderCommentSearch(state){
      const raw=(state.commentQuery || '').trim();state.commentsEl.hidden=Boolean(raw);
      if(!raw){state.searchEl?.remove();state.searchEl=null;return;}
      const results=state.searchEl ||= make('div','w-full rt-sra-comment-results');results.dataset.rtUi='archive-comment-results';if(!results.isConnected)state.commentsEl.after(results);
      const back=make('button','m-xs border-none button-small px-[calc(var(--rem10)-var(--button-border-width,0px))] button-plain items-center justify-center button inline-flex rt-sra-cs-back');back.type='button';back.setAttribute('rpl','');back.setAttribute('aria-label','Back');back.title='Navigate to all comments';
      {const outer=make('span','flex items-center justify-center'),icon=make('span','flex ms-[-2px] me-xs');icon.append(pdpIcon('arrow-back'));outer.append(icon,make('span','flex items-center gap-xs','All Comments'));back.append(outer,srOnly('Show all Comments tree'));}
      back.addEventListener('click',()=>{state.closeCommentSearch?.({focus:false});const top=state.toolbarEl?.getBoundingClientRect().top;if(top<0)state.toolbarEl.scrollIntoView({block:'start'});});
      const closeRow=make('div','w-full rt-sra-cs-close');closeRow.append(back);
      // The same query language as every other search box: words, "phrases", OR, NOT/-word, ( ), author:/u/ and body:.
      const core=globalThis.RCSCore,parsed=core?.parseQuery?core.parseQuery(raw,{fields:commentFields}):null;
      if(parsed?.invalid){results.replaceChildren(closeRow,this.commentSearchEmpty(raw,(parsed.errors || []).join(' · ') || 'Check the search.'));return;}
      const record=item=>globalThis.RTPostModel?.searchRecord?.({...item,kind:'comment'}) || {body:item.body,author:item.author};
      const query=raw.toLowerCase(),hits=state.items.filter(item=>parsed && core.matchRecord?core.matchRecord(parsed,record(item)):String(item.body || '').toLowerCase().includes(query) || String(item.author || '').toLowerCase().includes(query));
      state.searchedCount=state.items.length;
      if(!hits.length){results.replaceChildren(closeRow,state.loading && !state.items.length?this.loadingHalo('Loading archived comments'):this.commentSearchEmpty(raw));return;}
      const list=make('div','mt-md mx-xs xs:mx-0 rt-sra-cs-list');list.setAttribute('role','feed');
      hits.slice(0,100).forEach((item,index)=>list.append(this.commentSearchCard(state,item,index)));
      results.replaceChildren(closeRow,list);
    }
    commentSearchCard(state,item,index){
      const article=make('div','rt-sra-cs-article');article.setAttribute('role','article');article.setAttribute('aria-posinset',String(index+1));article.setAttribute('aria-setsize','-1');article.tabIndex=-1;article.dataset.rtUi='archive-comment-hit';
      const card=make('div','bg-neutral-background-weak rounded-4 relative w-100 group mb-md hover:bg-neutral-background-hover rt-sra-cs-hit'),pad=make('div','p-md relative');card.append(pad);article.append(card);
      const head=make('div','text-neutral-content-weak text-12 flex items-center rt-sra-cs-hit-head'),valid=globalThis.RTPostModel?.validateUsername?.(item.author);
      const who=make(valid?'a':'span','text-neutral-content-strong text-12 hover:no-underline flex items-center relative group-hover:z-1 a no-visited hover:underline cursor-pointer');if(valid)who.href='/user/'+encodeURIComponent(item.author)+'/';
      const avatar=make('span','inline-flex items-center justify-center w-lg h-lg relative pointer-events-auto me-xs rt-sra-cs-avatar');avatar.append(defaultAvatar(item.author,24));who.append(avatar,document.createTextNode(item.author || '[deleted]'));
      const date=make('faceplate-timeago');date.setAttribute('ts',new Date(item.created*1000).toISOString());date.setAttribute('short','');date.textContent=ago(item.created);
      head.append(who,make('span','mx-2xs','·'),date);
      const link=make('a','hover:no-underline no-underline no-visited absolute inset-0 a hover:underline cursor-pointer rt-sra-cs-link');link.href='/r/'+encodeURIComponent(this.name)+'/comments/'+state.route.postId+'/_/'+item.id+'/';link.setAttribute('aria-labelledby','rt-sra-cs-content-'+index);
      const content=make('span');content.id='rt-sra-cs-content-'+index;
      const body=make('div','i18n-search-comment-content max-h-[260px] overflow-hidden text-ellipsis text-neutral-content-strong hover:no-underline no-underline no-visited [--emote-size:20px] rt-sra-cs-hit-body');body.dir='auto';
      const rendered=globalThis.RTMarkdown?.fromHtml?.(item.bodyHtml) || globalThis.RTMarkdown?.render?.(item.body || '');if(rendered)body.append(rendered);else for(const para of String(item.body || '').split(/\n{2,}/))body.append(make('p','',para.trim()));
      content.append(body);
      const fade=make('div','h-[21px] mt-[-21px] from-[color:var(--color-neutral-background-weak)] bg-gradient-to-t isolate pointer-events-none group-hover:from-[color:var(--color-neutral-background-hover)] rt-sra-cs-fade');fade.hidden=true;requestAnimationFrame?.(()=>globalThis.RTPostDiscovery?.clipFade?.(body,fade));
      const score=Number(item.score) || 0,votes=make('p','text-neutral-content-weak text-12 rt-sra-cs-hit-votes');votes.append(make('span','',compact(score)+' '+(Math.abs(score)===1?'vote':'votes')));
      pad.append(head,link,content,fade,votes);return article;
    }
    commentSearchEmpty(raw,problem){
      const box=make('div','flex mt-md p-md bg-neutral-background-weak rounded-2 rt-sra-cs-empty');box.dataset.testid='search-no-results';
      const img=make('img','me-md w-[52px] h-2xl xs:w-[68px] xs:h-3xl rt-sra-cs-empty-img');img.src='https://www.redditstatic.com/shreddit/assets/telescope-snoo.svg';img.alt='';img.referrerPolicy='no-referrer';
      const text=make('div'),title=make('div','text-neutral-content font-semibold text-16 xs:text-18 mb-xs rt-sra-cs-empty-title',problem?problem:'Hm... we couldn’t find any results for “'+raw+'”');
      const hint=make('div','text-neutral-content-weak text-12 xs:text-14 rt-sra-cs-empty-hint');
      const adjust=make('button','rt-sra-cs-adjust','adjust your search');adjust.type='button';adjust.addEventListener('click',()=>{const field=this.threadState?.commentField;(field?.shadowRoot?.querySelector('textarea,input') || field)?.focus?.({preventScroll:true});});
      hint.append(problem?'Check the search syntax (Ctrl+/ for tips) or ':'Double-check your spelling or try different keywords to ',adjust,'. Archived comments may be incomplete.');
      text.append(title,hint);box.append(img,text);return box;
    }
    placeComments(state,items,nodes,root){
      state.shownTop ??= TOP_BATCH;state.shownReplies ||= new Map();state.moreEls ||= new Map();state.childOrder ||= new Map();let changed=false;
      const depthOf=new Map(),parentOf=new Map();
      for(const item of state.items){let ancestor=item.parentId,cycle=false;const visited=new Set([item.fullname]);while(items.has(ancestor)){if(visited.has(ancestor)){cycle=true;break;}visited.add(ancestor);ancestor=items.get(ancestor).parentId;}
        depthOf.set(item.fullname,cycle?0:visited.size-1);parentOf.set(item.fullname,!cycle && items.has(item.parentId)?item.parentId:'root');}
      const kids=new Map();for(const item of state.items){const key=parentOf.get(item.fullname);if(!kids.has(key))kids.set(key,[]);kids.get(key).push(item);}
      const sort=state.commentSort || 'best',best=sort==='new'?(a,b)=>b.created-a.created:sort==='old'?(a,b)=>a.created-b.created:(a,b)=>(b.score||0)-(a.score||0) || a.created-b.created;
      // Rank each incoming batch, then append it. Late archive pages must not reshuffle comments already being read.
      for(const [key,list] of kids){const order=state.childOrder.get(key) || [];for(const item of [...list].sort(best))if(!order.includes(item.fullname))order.push(item.fullname);state.childOrder.set(key,order);const ranks=new Map(order.map((id,index)=>[id,index]));list.sort((a,b)=>ranks.get(a.fullname)-ranks.get(b.fullname));}
      const forced=new Set();let focus=state.route.focusId?'t1_'+state.route.focusId:null;while(focus && items.has(focus) && !forced.has(focus)){forced.add(focus);focus=parentOf.get(focus);}
      const replyLimit=depth=>depth===1?3:depth<=3?2:1;
      const more=(parentKey,count,link)=>{
        let el=state.moreEls.get(parentKey);const label=count+' more '+(count===1?'reply':'replies');
        if(!el || el.tagName!==(link?'A':'BUTTON')){el=make(link?'a':'button','rt-sra-more-replies text-tone-2 text-12 no-underline hover:underline px-xs py-xs flex items-center');el.dataset.rtUi='archive-more-replies';
          const icon=make('span','me-xs flex items-center rt-sra-more-icon');icon.append(addCircle());el.append(icon,make('span',''));
          if(link){const id=parentKey.replace(/^t1_/,'');el.href='/r/'+encodeURIComponent(this.name)+'/comments/'+state.route.postId+'/_/'+id+'/';}
          else{el.type='button';el.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();if(el.disabled || this.threadState!==state)return;el.disabled=true;el.setAttribute('aria-busy','true');const icon=el.querySelector('.rt-sra-more-icon');icon.replaceChildren(this.spinner());
            requestAnimationFrame(()=>{if(this.threadState!==state)return;state.shownReplies.set(parentKey,(state.shownReplies.get(parentKey) ?? replyLimit((depthOf.get(parentKey) ?? -1)+1))+REPLY_BATCH);el.disabled=false;el.removeAttribute('aria-busy');this.renderThread();});});}
          state.moreEls.set(parentKey,el);}
        el.lastChild.textContent=label;el.setAttribute('aria-label',label);if(!link){const icon=el.querySelector('.rt-sra-more-icon');if(!el.disabled && !icon.querySelector('[icon-name="add-circle"]'))icon.replaceChildren(addCircle());}
        return el;};
      let hiddenTop=0;
      const place=(parentKey,container,depth)=>{
        const list=kids.get(parentKey) || [],isRoot=parentKey==='root';
        let limit=isRoot?state.shownTop:depth>MAX_DEPTH?0:(state.shownReplies.get(parentKey) ?? replyLimit(depth));
        const shown=list.filter((item,index)=>index<limit || forced.has(item.fullname)),hidden=list.length-shown.length;
        // Reddit's permalink view puts the focused comment's thread first at every level.
        const lead=shown.findIndex(item=>forced.has(item.fullname));if(lead>0)shown.unshift(...shown.splice(lead,1));
        const desired=shown.map(item=>nodes.get(item.fullname));
        if(hidden>0){if(isRoot)hiddenTop=hidden;else desired.push(more(parentKey,hidden,depth>MAX_DEPTH));}
        for(const node of desired)if(!isRoot){if(node.parentElement!==container || !node.getAttribute('slot')?.startsWith('children'))node.slot='children';}else if(node.dataset.rtUi==='archive-thread-comment')node.removeAttribute('slot');
        const managed=[...container.children].filter(child=>child.dataset?.rtUi==='archive-thread-comment' || child.dataset?.rtUi==='archive-more-replies');
        const wanted=new Set(desired);for(const node of managed)if(!wanted.has(node)){node.remove();changed=true;}
        let at=[...container.children].find(child=>child.dataset?.rtUi==='archive-thread-comment' || child.dataset?.rtUi==='archive-more-replies');
        for(const node of desired){if(node===at){at=at.nextElementSibling;continue;}container.insertBefore(node,at || null);changed=true;}
        for(const item of shown){nodes.get(item.fullname).setAttribute('depth',String(depth));place(item.fullname,nodes.get(item.fullname),depth+1);}
      };
      place('root',root,0);state.hiddenTop=hiddenTop;return changed;
    }
    navigationClass(){
      const native=document.querySelector('flex-left-nav-container[expanded]'),grid=native?.closest('.grid-container');
      if(grid?.classList.contains('flex-nav-collapsed'))return 'flex-nav-collapsed';
      if(grid?.classList.contains('flex-nav-expanded'))return 'flex-nav-expanded';
      // Reddit's own flex-nav controller reads this non-sensitive preference cookie (0 collapsed, 1 expanded).
      const value=document.cookie.split(';').map(part=>part.trim()).find(part=>part.startsWith('hui_flex_nav_expanded_state='))?.split('=')[1];
      if(value==='0' || value==='1')return value==='0'?'flex-nav-collapsed':'flex-nav-expanded';
      return native?.getAttribute('expanded')==='0'?'flex-nav-collapsed':'flex-nav-expanded';
    }
    mountNavigation(layout,name){
      const kept=this.keptNavigation,keptController=this.keptNavigationController;this.keptNavigation=this.keptNavigationController=null;
      const reusable=['ready','failed'].includes(kept?.dataset.state) || kept?.dataset.state==='loading' && Date.now()-Number(kept.dataset.loadingSince || 0)<8000;
      if(reusable && kept.dataset.subreddit?.toLowerCase()===String(name).toLowerCase()){
        // A failed nav keeps showing its fallback while loadNavigation retries in place; success replaces the fallback.
        if(kept.dataset.state==='failed')kept.dataset.state='idle';
        this.navigation=kept;this.navigationController=keptController || null;layout.append(kept);return;
      }
      keptController?.abort();
      const target=this.navigation=make('div','contents');target.id='rt-nav-'+crypto.randomUUID();target.dataset.rtUi='community-navigation';target.dataset.state='idle';target.dataset.subreddit=name;
      const reserve=make('div','left-sidebar theme-rpl order-first hidden m:block');reserve.setAttribute('aria-hidden','true');const skeleton=globalThis.RTPostDiscovery?.navSkeleton?.();if(skeleton)reserve.append(skeleton);target.append(reserve);layout.append(target);
    }
    async loadNavigation(){
      const target=this.navigation;if(!target?.isConnected || ['loading','ready'].includes(target.dataset.state))return;
      this.navigationController?.abort();const controller=this.navigationController=new AbortController();target.dataset.state='loading';target.dataset.loadingSince=String(Date.now());
      try{
        for(let attempt=0;attempt<20;attempt++){
          const result=await this.reddit({action:'render-navigation',subreddit:target.dataset.subreddit,target:target.id,navigationLease:target.id},controller.signal);
          // Finished while detached (never remounted): mark it idle so a later mount renders a fresh nav.
          if(controller.signal.aborted || !target.isConnected){if(!controller.signal.aborted)target.dataset.state='idle';return;}
          if(result?.deferred){await new Promise(resolve=>setTimeout(resolve,Math.min(500,result.retryAfterMs || 250)));continue;}
          if(!result?.rendered)throw Error('Reddit navigation is unavailable.');target.dataset.state='ready';return;
        }
        throw Error('Reddit navigation is busy.');
      }catch{if(controller.signal.aborted || !target.isConnected){if(!controller.signal.aborted)target.dataset.state='idle';return;}}
      if(controller.signal.aborted || !target.isConnected)return;target.dataset.state='failed';
      globalThis.RTPostDiscovery?.Discovery?.prototype.navigationFallback.call(this,target);
      const retry=make('button','button button-small button-plain px-md','Retry navigation');retry.type='button';retry.addEventListener('click',()=>{target.dataset.state='idle';this.loadNavigation();});target.querySelector('nav')?.append(retry);
    }
    // Reddit's subreddit header: banner, overlapping avatar and r/name with the existing state glyph.
    renderHeader(){
      const header=this.headerEl,name=this.name;header.replaceChildren();
      const banner=make('div','rt-sra-banner');banner.setAttribute('aria-hidden','true');
      const row=make('section','flex relative items-center xs:items-end justify-between px-md xs:-top-[2.25rem] xs:-mb-[2.25rem] mt-xs mb-2xs xs:mt-0 rt-sra-header-row');
      const content=make('div','flex flex-1 items-end justify-between flex-col xs:flex-row rt-sra-header-content'),identity=make('div','flex items-end justify-start xs:justify-center gap-xs w-100 xs:w-auto rt-sra-identity');
      const avatar=make('div','xs:w-[88px] xs:h-[88px] w-2xl h-2xl text-48 shrink-0 rt-sra-avatar');avatar.append(this.avatar(88));
      const titleWrap=make('div','flex items-center gap-xs min-w-0'),title=make('h1','flex items-center font-bold text-18 xs:text-32 mb-0 text-neutral-content-strong rt-sra-name','r/'+name);title.dataset.testid='subreddit-name';
      const state=make('span','rt-sra-state');state.dataset.testid='subreddit-archive-state';state.dataset.state=this.kind;
      state.append(glyph(this.kind==='banned'?'removed':'hidden'));state.setAttribute('role','img');
      state.title=(this.kind==='private'?'r/'+name+' is private':'r/'+name+' is banned')+'. Showing archived posts.';state.setAttribute('aria-label',state.title);
      titleWrap.append(title,state);identity.append(avatar,titleWrap);content.append(identity);row.append(content);header.append(banner,row);
    }
    // Reddit's community sidebar: one rounded column of sections (12px uppercase headers, 14px body) split by
    // rules. Only what the extension honestly knows: the community state, what the archive is, what has been
    // loaded so far (never presented as complete), the most frequent authors among loaded posts, Reddit's links.
    renderSidebar(){
      if(!this.sidebarEl)return;const content=make('div','right-sidebar-contents flex-auto'),panel=make('section','rt-sra-sidebar-panel rt-sra-sidebar');panel.setAttribute('aria-label','Archived community information');
      const community=make('div','rt-sra-sidebar-section');community.append(this.communityPanel(this.name,this.kind,{note:false}));
      const about=this.sidebarSection('About this archive','archive-about'),aboutText=make('p','rt-sra-sidebar-text');
      aboutText.append(document.createTextNode('These posts come from '),arcticLink('Arctic Shift'),document.createTextNode(', an independent archive of public Reddit data. Reddit no longer shows this community, so nothing here is live.'));
      if(this.sidebarThread){const note=make('p','rt-sra-sidebar-text','Archived thread from Arctic Shift · Coverage may be partial · Posting and voting are unavailable.');note.dataset.rtUi='archive-thread-notice';about.append(note);}
      about.append(aboutText,make('p','rt-sra-sidebar-text','Coverage may be partial: the archive may be missing posts, edits, scores and deletions. Voting, joining and posting are unavailable.'));
      const coverage=this.coverageEl=this.sidebarSection('Archive coverage','archive-coverage');
      const posters=this.postersEl=this.sidebarSection('Most active posters','archive-posters');
      this.statsSignature=null;
      panel.append(community,make('hr','rt-sra-sidebar-rule'),about);
      // A thread page loads no feed: there is nothing to count, so those sections stay out.
      if(!this.sidebarThread)panel.append(make('hr','rt-sra-sidebar-rule'),coverage,make('hr','rt-sra-sidebar-rule'),posters);
      panel.append(make('hr','rt-sra-sidebar-rule'),this.legalLinks());
      content.append(panel);this.sidebarEl.replaceChildren(content);this.renderArchiveStats();
    }
    sidebarSection(title,ui){
      const section=make('div','rt-sra-sidebar-section');section.dataset.rtUi=ui;
      section.append(make('h2','rt-sra-sidebar-heading text-12 font-semibold uppercase text-neutral-content-weak',title));return section;
    }
    // Every loaded feed post (any sort or date window), each counted once.
    loadedPosts(){
      const posts=new Map();
      for(const state of this.states?.values() || [])if(state.scope==='feed')for(const item of state.items)if(item?.kind!=='comment' && Number.isFinite(item.created))posts.set(item.fullname,item);
      return [...posts.values()];
    }
    renderArchiveStats(){
      const coverage=this.coverageEl,posters=this.postersEl;if(!coverage?.isConnected && !posters?.isConnected)return;
      const posts=this.loadedPosts(),state=this.states?.get(this.feedKey())||null,loading=Boolean(state?.loading),failed=Boolean(state?.error);
      const authors=new Map();for(const post of posts){const name=post.author;if(!globalThis.RTPostModel?.validateUsername?.(name) || /^automoderator$/i.test(name))continue;const key=name.toLowerCase(),seen=authors.get(key);if(seen)seen.count++;else authors.set(key,{name,count:1});}
      const top=[...authors.values()].sort((a,b)=>b.count-a.count || a.name.localeCompare(b.name)).slice(0,5);
      let oldest=Infinity,newest=-Infinity;for(const post of posts){if(post.created<oldest)oldest=post.created;if(post.created>newest)newest=post.created;}
      const signature=JSON.stringify([posts.length,oldest,newest,loading,failed,top]);if(signature===this.statsSignature)return;this.statsSignature=signature;
      const heading=section=>section.querySelector('.rt-sra-sidebar-heading');
      coverage.replaceChildren(heading(coverage));
      if(!posts.length)coverage.append(make('p','rt-sra-sidebar-text',loading?'Loading archived posts…':failed?'No archived posts loaded. The archive could not be reached.':'No archived posts loaded yet.'));
      else{
        const stats=make('dl','rt-sra-sidebar-stats'),stat=(value,label)=>{const item=make('div','rt-sra-sidebar-stat');item.append(make('dd','',value),make('dt','',label));stats.append(item);};
        stat(new Intl.NumberFormat().format(posts.length),posts.length===1?'Post loaded':'Posts loaded');
        stat(String(new Date(oldest*1000).getFullYear())+(new Date(newest*1000).getFullYear()!==new Date(oldest*1000).getFullYear()?'–'+new Date(newest*1000).getFullYear():''),'Years spanned');
        coverage.append(stats);
        const range=make('p','rt-sra-sidebar-fact');range.dataset.rtUi='archive-coverage-range';range.append(glyph('calendar'),make('span','',oldest===newest?day(oldest):day(oldest)+' – '+day(newest)));coverage.append(range);
        coverage.append(make('p','rt-sra-sidebar-note','Among loaded posts only. '+(loading?'Loading more… ':state?.hasMore?'More load as you scroll. ':'')+'The archive may not hold every post.'));
      }
      posters.replaceChildren(heading(posters));
      if(!top.length){posters.append(make('p','rt-sra-sidebar-text',posts.length?'No named authors among loaded posts.':'Appears once posts load.'));return;}
      const list=make('ul','rt-sra-posters');
      for(const author of top){
        const li=make('li'),link=make('a','rt-sra-poster');link.href='/user/'+encodeURIComponent(author.name)+'/';
        const text=make('span','rt-sra-poster-text');text.append(make('span','rt-sra-poster-name','u/'+author.name),make('span','rt-sra-poster-count',author.count+(author.count===1?' post':' posts')));
        link.append(defaultAvatar(author.name,32,''),text);li.append(link);list.append(li);
      }
      posters.append(list,make('p','rt-sra-sidebar-note','Counted among loaded posts only.'));
    }
    // Reddit's own sidebar footer links.
    legalLinks(){
      const footer=make('div','rt-sra-sidebar-section rt-sra-legal');footer.dataset.rtUi='archive-legal';const links=make('div','rt-sra-legal-links');
      for(const [label,href] of [['Reddit Rules','https://www.redditinc.com/policies/content-policy'],['Privacy Policy','https://www.reddit.com/policies/privacy-policy'],['User Agreement','https://www.redditinc.com/policies/user-agreement'],['Accessibility','https://support.reddithelp.com/hc/sections/38303584022676-Accessibility']]){
        const a=make('a','',label);a.href=href;a.target='_blank';a.rel='noopener';links.append(a);
      }
      footer.append(links,make('p','rt-sra-legal-copy','Reddit, Inc. © '+new Date().getFullYear()+'. All rights reserved.'));return footer;
    }

    // ---- feed controls: Reddit's row of sort / time / type dropdowns ---------------------------------------------
    filterState(){return this.filters || {date:null,types:[],subreddits:[],sort:null};}
    sortMode(){const sort=this.filterState().sort;if(sort==='old')return 'old';if(this.top)return 'top';if(sort==='comments')return 'comments';return 'new';}
    applyFilters(next,{top=this.top}={}){
      const f=globalThis.RTFeedFilters;this.filters=f?f.clone(next):next;this.top=top && !this.filters.sort;
      if(f)f.write(this.filters);setParams({rt_top:this.top?'1':null});
      this.syncAll();this.refresh();
    }
    // Phones (below Reddit's 768 px layout): each menu opens as Reddit's bottom sheet (dimmed backdrop, 48 px title row,
    // round close button), like profile search's filter sheets; desktop keeps the popover.
    dropdown(label,build,{title=''}={}){
      // Same classes and chevron as Reddit's sort dropdown button (text plus caret, no leading icon).
      const wrap=make('div','rt-sra-dropdown'),button=make('button','rt-sra-dropdown-button text-neutral-content-weak button-small button-plain items-center justify-center button inline-flex');button.type='button';button.setAttribute('aria-haspopup','menu');button.setAttribute('aria-expanded','false');button.setAttribute('rpl','');
      const text=make('span','flex items-center gap-xs',label),caret=make('span','flex ms-2xs me-[-2px]');caret.append(redditCaret());button.append(text,caret);
      const menu=make('div','rt-sra-menu');menu.setAttribute('role','menu');menu.hidden=true;menu.dataset.rtUi='subreddit-menu';
      button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();const open=menu.hidden;this.closeMenus();if(open){this.syncMenu();
        const sheet=Boolean(globalThis.matchMedia?.('(max-width: 767.98px)')?.matches);menu.classList.toggle('rt-sra-sheet',sheet);
        if(sheet){
          if(!menu.querySelector(':scope>.rt-inline-sheet-head')){
            const head=make('div','rt-inline-sheet-head'),name=make('span','text-16 text-neutral-content-strong font-bold',title || text.textContent.trim());head.append(name);
            const close=make('button','rt-inline-sheet-close');close.type='button';close.setAttribute('aria-label','Close');close.append(glyph('close'));close.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();this.closeMenus();button.focus();});
            menu.prepend(close,head);
          }
          const scrim=this.menuScrim=make('div','rt-sra-sheet-scrim');scrim.dataset.rtUi='subreddit-menu-scrim';scrim.setAttribute('aria-hidden','true');scrim.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();this.closeMenus();});wrap.insertBefore(scrim,menu);
        }
        menu.hidden=false;button.setAttribute('aria-expanded','true');this.openMenuEl=menu;}});
      wrap.append(button,menu);build(menu);return {wrap,button,text,menu};
    }
    closeMenus(){this.menuScrim?.remove();this.menuScrim=null;if(!this.openMenuEl)return;this.openMenuEl.hidden=true;this.openMenuEl.parentElement?.querySelector('button')?.setAttribute('aria-expanded','false');this.openMenuEl=null;}
    buildControls(){
      const f=globalThis.RTFeedFilters,wrap=make('div','rt-sra-controls');wrap.dataset.rtUi='subreddit-controls';
      const fx=this.fx=f.plainContext(glyph,{role:'menuitemradio'}),current=()=>f.clone(this.filterState());this.menuRows={sort:new Map(),date:new Map()};
      const close=()=>this.closeMenus();
      const option=(menu,group,key,options)=>{const el=f.menuOption(fx,options);el.dataset.rtUi='filter-option';menu.append(el);this.menuRows[group].set(key,el);return el;};
      this.sortMenu=this.dropdown('New',menu=>{
        option(menu,'sort','new',{label:'New',icon:false,value:'new',onSelect:()=>{const next=current();next.sort=null;this.applyFilters(next,{top:false});close();}});
        option(menu,'sort','old',{label:'Old',icon:false,value:'old',onSelect:()=>{const next=current();next.sort='old';this.applyFilters(next,{top:false});close();}});
        option(menu,'sort','top',{label:'Top',subtitle:'Among loaded posts',icon:false,value:'top',onSelect:()=>{const next=current();next.sort=null;this.applyFilters(next,{top:true});close();}});
        option(menu,'sort','comments',{label:'Most commented',subtitle:'Among loaded posts',icon:false,value:'comments',onSelect:()=>{const next=current();next.sort='comments';this.applyFilters(next,{top:false});close();}});
      },{title:'Sort'});
      this.dateMenu=this.dropdown('All time',menu=>{
        option(menu,'date','any',{label:'All time',icon:false,value:'any',onSelect:()=>{const next=current();next.date=null;this.applyFilters(next);close();}});
        for(const preset of f.presets)option(menu,'date',preset.id,{label:preset.label,icon:false,value:preset.id,onSelect:()=>{const next=current();next.date={preset:preset.id};this.applyFilters(next);close();}});
        option(menu,'date','custom',{label:'Custom range…',icon:false,value:'custom',onSelect:()=>{close();this.openDatePicker();}});
      },{title:'Date'});
      this.typeMenu=this.dropdown('All posts',menu=>{
        this.typeList=f.typeOptions(fx,{iconSize:16,outline:true,allIcon:'show',append:el=>menu.append(el),onClear:()=>{const next=current();next.types=[];this.applyFilters(next);},onToggle:name=>{const next=current();next.types=next.types.includes(name)?next.types.filter(x=>x!==name):[...next.types,name];this.applyFilters(next);}});
        for(const el of this.typeList.elements)el.setAttribute('role',el.dataset.rtSection?'presentation':'menuitemcheckbox');
      },{title:'Post type'});
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
      const shadow=host.attachShadow({mode:'open'}),style=make('style','',`:host{--rcs-bg:var(--color-neutral-background,#fff);--rcs-soft:var(--color-neutral-background-weak,#f2f4f5);--rcs-text:var(--color-neutral-content-strong,#0f1a1c);--rcs-muted:var(--color-neutral-content-weak,#576f76);--rcs-line:var(--color-neutral-border-weak,#e5e8eb);--rcs-hover:var(--color-neutral-background-hover,#e8edef);--rcs-accent:#ff4500}.date-popover{pointer-events:auto;left:0;right:auto;top:4px}`+(Picker.styles || '')+'');
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
      // A tab/sort change in the same community: Reddit is about to replace this page. Remember it so the new
      // results are not first drawn into the outgoing page at its width (layout shift).
      const previous=this.search,staleMain=previous?.host?.isConnected && previous.route.name.toLowerCase()===route.name.toLowerCase()?document.querySelector('main'):null;
      this.unmountSearch();
      const search=this.search={key,route,kind:null,checking:true,hidden:new Map(),states:new Map(),staleMain,staleSince:Date.now()};
      let kind='';try{kind=await this.communityState(route.name);}catch{}
      if(this.search!==search)return;search.checking=false;search.kind=kind;
      if(!kind){this.search={key,route,kind:'',inactive:true};return;}
      this.loadMeta(route.name,()=>{if(this.search===search)this.fillSearchSidebar(true);});
      this.ensureSearchMounted();
    }
    unmountSearch(){
      const search=this.search;if(!search)return;this.search=null;
      search.io?.disconnect();clearTimeout(search.settleTimer);for(const state of search.states?.values() || [])state.gen++;
      search.host?.remove();search.sidebar?.remove();this.restoreSearchSort(search);
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
        const host=search.host || this.buildSearchHost(search);
        // Loading starts at once; only placing the results waits for Reddit's page for this route (bounded).
        if(!search.started){search.started=true;this.refreshSearch();}
        const wait=search.staleMain && main===search.staleMain?SEARCH_SETTLE_MS-(Date.now()-search.staleSince):0;
        if(wait>0){clearTimeout(search.settleTimer);search.settleTimer=setTimeout(()=>{if(this.search===search)this.ensureSearchMounted();},wait);}
        else{
          search.staleMain=null;
          const switcher=main.querySelector('[data-testid="search-scope-switcher"]'),anchor=switcher?.parentElement || null;
          if(anchor?.parentElement)anchor.after(host);else (main.querySelector('div.bg-neutral-background') || main).append(host);
          search.io?.disconnect();search.io?.observe(search.sentinel);
        }
      }
      this.repairSearchTabs();this.fillSearchSidebar(false);this.syncSearchSort();
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
    // Reddit's own sort control stays. When it names a sort the archive cannot rank, its label says what is
    // actually shown (New), and those menu options are marked unavailable. Everything is restored on leaving.
    unrankedWords(route){return unrankedSorts[route.sort] || (route.sort==='comments' && route.type==='comments'?unrankedComments:null);}
    syncSearchSort(){
      const search=this.search;if(!search?.route)return;const route=search.route;
      // Reddit re-renders its menus: forget edits on nodes it has discarded.
      const edits=search.sortEdits=(search.sortEdits || []).filter(edit=>(edit.node || edit.el).isConnected);
      const set=(el,name,value)=>{edits.push({el,name,old:el.getAttribute(name),value});el.setAttribute(name,value);};
      const skip=node=>node.closest('[data-rt-ui],header,reddit-search-large,#search-results-page-tabgroup');
      const why=word=>"The archive can't sort by "+word+'; archived results are shown newest first.';
      const words=this.unrankedWords(route);
      if(words)for(const trigger of document.querySelectorAll('button,[role="button"],[aria-haspopup],[slot="trigger"]')){
        if(skip(trigger) || trigger.closest('a[href*="sort="]'))continue;
        const label=trigger.textContent.replace(/\s+/g,' ').trim(),word=words.find(w=>new RegExp('^(?:sort by:?\\s*)?'+w+'$','i').test(label));if(!word)continue;
        const walker=document.createTreeWalker(trigger,NodeFilter.SHOW_TEXT);
        for(let node=walker.nextNode();node;node=walker.nextNode())if(node.data.trim().toLowerCase()===word.toLowerCase()){const old=node.data;node.data=old.replace(old.trim(),'New');edits.push({node,old,value:node.data});}
        const aria=trigger.getAttribute('aria-label');if(aria)set(trigger,'aria-label',aria.replace(new RegExp(word,'i'),'New'));
        set(trigger,'title',why(word));set(trigger,'data-rt-archive-sort','new');
      }
      // Menu rows (anchors) for unrankable sorts, wherever Reddit renders the open menu.
      const unavailable=[['relevance','Relevance'],['hot','Hot'],...(route.type==='comments'?unrankedComments.map(label=>['comments',label]):[])];
      for(const anchor of document.querySelectorAll('a[href*="sort="]')){
        if(skip(anchor) || anchor.hasAttribute('data-rt-archive-unranked'))continue;
        let sort='';try{sort=new URL(anchor.getAttribute('href'),location.href).searchParams.get('sort') || '';}catch{}
        const text=anchor.textContent.replace(/\s+/g,' ').trim(),hit=unavailable.find(([value,label])=>value===sort && text.toLowerCase().startsWith(label.toLowerCase()));if(!hit)continue;
        const block=event=>{event.preventDefault();event.stopImmediatePropagation();};anchor.addEventListener('click',block,true);edits.push({el:anchor,listener:block});
        set(anchor,'aria-disabled','true');set(anchor,'title',why(hit[1]));set(anchor,'aria-description','Not available for archived results');set(anchor,'data-rt-archive-unranked','');
      }
    }
    // Undo only what is still ours: if Reddit already re-rendered a label for the next route, keep Reddit's.
    restoreSearchSort(search){
      for(const edit of (search.sortEdits || []).reverse()){
        if(edit.node){if(edit.node.data===edit.value)edit.node.data=edit.old;continue;}
        if(edit.listener){edit.el.removeEventListener('click',edit.listener,true);continue;}
        if(edit.el.getAttribute(edit.name)!==edit.value)continue;
        if(edit.old==null)edit.el.removeAttribute(edit.name);else edit.el.setAttribute(edit.name,edit.old);
      }
      search.sortEdits=[];
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
        const words=this.unrankedWords(route);
        if(words)notes.push("Archive results, newest first · The archive can't sort by "+words[0]);
        else if(route.sort==='top')notes.push('Archive results, sorted by votes among loaded results');
        else if(route.sort==='comments' && state.tab==='posts')notes.push('Archive results, sorted by comments among loaded results');
        else notes.push('Archive results');
      }
      search.notice.textContent=notes.join(' · ');search.notice.hidden=false;search.notice.classList.toggle('rt-sra-error-text',Boolean(state.parsed?.invalid));
      // Media is Reddit's tile grid; posts and comments are rows separated by rules.
      search.list.classList.toggle('rt-sra-media-grid',state.media);search.list.replaceChildren();
      if(state.media)search.list.append(...items.map(item=>this.searchTile(state,item)));
      else for(const [index,item] of items.entries()){if(index)search.list.append(make('hr','rt-sra-result-rule'));search.list.append(this.searchUnit(state,item));}
      const foot=search.foot;foot.replaceChildren();
      if(state.loading)foot.append(this.loadingHalo());
      if(!state.error && !state.loading)state.autoRetries=0;if(state.error)foot.append(this.errorNote(state,()=>{if(!state.loading){state.error=null;this.fill(state,()=>this.renderSearch());}}));
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
    // Search units show Reddit's relative time ("8y ago") in faceplate-timeago's own <time> markup.
    searchTime(created){
      const iso=new Date(created*1000).toISOString(),t=make('faceplate-timeago'),time=make('time','',ago(created));t.setAttribute('ts',iso);t.setAttribute('format','narrow');
      time.setAttribute('datetime',iso);time.title=new Date(created*1000).toLocaleString(undefined,{dateStyle:'full',timeStyle:'short'});t.append(time);return t;
    }
    searchImage(item){
      if(item.over18 || item.spoiler)return '';const media=item.media?.find?.(m=>m?.url || m?.poster);
      return media?.url || media?.poster || (/^https:\/\//.test(item.thumbnail || '')?item.thumbnail:'');
    }
    // Reddit's media tab: a grid of image tiles, thumbnail first.
    searchTile(state,item){
      let node=state.cards.get(item.fullname);if(node)return node;
      const parsed=state.parsed && !state.parsed.invalid?state.parsed:null,f=globalThis.RTFeedFilters,type=f?.inferType?.(item) || '';
      node=make('a','rt-sra-tile');node.href=item.permalink || '#';node.dataset.testid='search-media-unit';node.dataset.rtUi='archive-search-unit';node.dataset.fullname=item.fullname;node.setAttribute('aria-label',item.title || 'Open post');
      const frame=make('div','rt-sra-tile-media'),src=this.searchImage(item);
      const placeholder=()=>{const box=make('div','rt-sra-tile-placeholder'),icon=f?.svgIcon?.(f.typeIcons?.[type],24);if(icon)box.append(icon);if(item.over18 || item.spoiler)box.append(make('span','',item.over18?'NSFW':'Spoiler'));return box;};
      if(src){const img=make('img');img.src=src;img.alt='';img.loading='lazy';img.decoding='async';img.referrerPolicy='no-referrer';img.addEventListener('error',()=>img.replaceWith(placeholder()),{once:true});frame.append(img);}
      else frame.append(placeholder());
      if(['gallery','video','gif'].includes(type)){const badge=f?.svgIcon?.(f.typeIcons?.[type],16);if(badge){const tag=make('span','rt-sra-tile-badge');tag.append(badge);frame.append(tag);}}
      const title=make('div','rt-sra-tile-title');title.append(this.highlight(item.title || '',parsed));
      const meta=make('div','rt-sra-tile-meta');meta.append(make('span','',compact(item.score || 0)+' votes'),make('span','mx-2xs','·'),this.searchTime(item.created));
      node.append(frame,title,meta);state.cards.set(item.fullname,node);return node;
    }
    time(created){const t=make('faceplate-timeago');t.setAttribute('ts',new Date(created*1000).toISOString());t.setAttribute('format','narrow');t.textContent=day(created);return t;}
    searchUnit(state,item){
      let node=state.cards.get(item.fullname);if(node)return node;
      const parsed=state.parsed && !state.parsed.invalid?state.parsed:null,permalink=item.permalink || '#';
      if(item.kind==='comment'){
        node=make('div','rt-sra-unit');node.dataset.testid='search-sdui-comment-unit';node.dataset.rtUi='archive-search-unit';node.dataset.fullname=item.fullname;
        const cover=make('a','rt-sra-unit-cover');cover.href=permalink.replace(/\/[a-z0-9]+\/?$/i,'/') || permalink;cover.setAttribute('aria-label',item.title || 'Open thread');
        const body=make('div','rt-sra-unit-body'),credit=make('div','rt-sra-unit-credit');credit.append(this.communityLink(item.subreddit),make('span','mx-2xs','·'),this.searchTime(item.created));
        body.append(credit);if(item.title)body.append(make('h2','rt-sra-unit-thread',item.title));
        // Native comment units: 24px avatar beside the plain username. Archive records carry no avatar, so Reddit's default one.
        const box=make('div','rt-sra-comment-box'),who=make('div','rt-sra-unit-credit'),valid=globalThis.RTPostModel.validateUsername(item.author),author=make(valid?'a':'span','rt-sra-comment-author');
        if(valid)author.href='/user/'+encodeURIComponent(item.author)+'/';author.append(defaultAvatar(item.author,24),make('span','truncate',item.author || '[deleted]'));who.append(author,make('span','mx-2xs','·'),this.searchTime(item.created));
        const open=make('a','rt-sra-comment-link');open.href=permalink;open.setAttribute('aria-label','Open comment');
        const text=make('div','rt-sra-comment-text');for(const part of String(item.body || '').split(/\n{2,}/).slice(0,6)){const p=make('p');p.append(this.highlight(part,parsed));text.append(p);}
        box.append(who,open,text,make('p','rt-sra-unit-counts',compact(item.score || 0)+' votes'));
        const thread=make('a','rt-sra-thread-link','Go To Thread');thread.href=cover.href;
        body.append(box,thread);node.append(cover,body);
      }else{
        node=make('div','rt-sra-unit');node.dataset.testid='search-post-unit';node.dataset.rtUi='archive-search-unit';node.dataset.fullname=item.fullname;
        const cover=make('a','rt-sra-unit-cover');cover.href=permalink;cover.setAttribute('aria-label',item.title || 'Open post');
        // Native post units show community and relative time only (no author).
        const body=make('div','rt-sra-unit-body'),credit=make('div','rt-sra-unit-credit');credit.append(this.communityLink(item.subreddit),make('span','mx-2xs','·'),this.searchTime(item.created));
        const title=make('a','rt-sra-unit-title');title.href=permalink;title.append(this.highlight(item.title || '',parsed));
        const counts=make('div','rt-sra-unit-counts');counts.append(make('span','',compact(item.score || 0)+' votes'),make('span','mx-2xs','·'),make('span','',compact(item.comments || 0)+' comments'));
        body.append(credit,title,counts);node.append(cover,body);
        const thumb=this.searchImage(item);
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
    // The type filter is part of the key: each filter scans the archive on its own, so its count never
    // depends on how far another filter had paged.
    feedKey(){const filters=this.filterState(),f=globalThis.RTFeedFilters;return JSON.stringify([filters.sort==='old'?'asc':'desc',f?f.serialize(filters)[f.params.date] || '':'',[...(filters.types || [])].sort().join(',')]);}
    current(){
      const key=this.feedKey();let state=this.states.get(key);
      if(!state){
        // A new key supersedes the previous feed: cancel its requests and drop its cards, so neither
        // stale cards nor an error from a superseded request can render under the new filters.
        for(const old of this.states.values())this.retireFeedState(old);this.states.clear();
        state=this.newState(key,{scope:'feed',name:this.name,tab:'posts',media:false,asc:this.filterState().sort==='old',range:globalThis.RTFeedFilters?.dateRange(this.filterState()) || null,parsed:null,plan:null,query:''});
        Object.assign(state,{want:PAGE_SIZE,scanFills:0,paused:false});
        this.states.set(key,state);
      }
      state.sortMode=this.sortMode();return state;
    }
    retireFeedState(state){state.gen++;state.loading=false;for(const item of state.items || [])if(item?.kind!=='comment')(this.recentPosts ||= new Map()).set(item.fullname,item);}
    activeFeed(state){return Boolean(this.mounted && !this.mounted.thread && this.states.get(this.feedKey())===state);}
    localFilter(){return (this.filterState().types || []).length>0;}
    refresh(){if(!this.mounted)return;const state=this.current();this.renderList();if(!state.started)this.fillFeed(state);}
    // auto: the scroll sentinel asked. It reveals the next page once the current one is full; it never
    // restarts a paused scan (only the user's "Search older" does).
    loadMore({auto=false}={}){
      if(!this.mounted || this.mounted.thread)return;const state=this.current();
      if(state.loading || state.error || !state.started)return;
      const count=this.visibleItems(state).length;
      if(count<state.want){
        if(!state.hasMore || state.paused && auto)return;
        if(!auto){state.paused=false;state.scanFills=0;}
        this.fillFeed(state);return;
      }
      state.want+=PAGE_SIZE;state.scanFills=0;state.paused=false;
      if(count<state.want && state.hasMore){this.fillFeed(state);return;}
      this.renderList();
      // Keep one page buffered so the next reveal is immediate.
      if(count-state.want<PAGE_SIZE && state.hasMore){this.fillFeed(state);return;}
      this.reobserve();
    }
    retry(){if(!this.mounted)return;const state=this.current();if(!state.loading){state.error=null;state.scanFills=0;state.paused=false;this.fillFeed(state);}}
    reobserve(){if(this.io && this.sentinel?.isConnected){this.io.unobserve(this.sentinel);this.io.observe(this.sentinel);}}
    async fillFeed(state){
      const gen=state.gen,render=()=>{if(this.activeFeed(state))this.renderList();};
      await this.fill(state,render);
      if(gen!==state.gen || state.loading || state.error || !this.activeFeed(state))return;
      if(this.visibleItems(state).length>=state.want || !state.hasMore){state.scanFills=0;return;}
      // Not enough matches yet: scan older pages (bounded), then pause with an explicit state.
      if(++state.scanFills>=SCAN_FILLS){state.paused=true;render();return;}
      if(this.localFilter())return this.fillFeed(state);
    }
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
      const before=this.visibleItems(state).length,name=state.name.toLowerCase(),searching=state.scope==='search',startedAt=Date.now();let shownSoFar=before;
      try{
        const options={kind:state.tab==='comments'?'comment':'post',subreddit:name,sort:state.asc?'asc':'desc',cursor:state.cursor ?? undefined,after:state.range?.after ?? undefined,before:state.range?.before ?? undefined,maxPages:searching?SEARCH_PAGES:5};
        // Text search already proved unavailable here: go straight to scanning instead of timing out again.
        if(searching && state.textLocal)options.textLocal=true;
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
          if(page.textLocal)state.textLocal=true;
          const shown=this.visibleItems(state).length;
          if(!state.hasMore)break;
          // A filter can leave a page empty: keep going (within the page budget) until something shows.
          if(!searching){if(shown>before)break;continue;}
          // Search keeps scanning until a screenful is loaded or its page/time budget runs out; results show as they
          // arrive while Reddit's loading halo stays below them.
          if(shown>=before+SEARCH_TARGET || shown>before && Date.now()-startedAt>=SEARCH_BUDGET_MS)break;
          if(shown>shownSoFar){shownSoFar=shown;render();}
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
      if(item.kind==='comment')node?.querySelector('[data-rt-source]')?.remove();
      if(!node){node=make('div','rt-native-card');node.dataset.rtUi='archive-item';const a=make('a','',item.title || item.body || item.fullname);a.href=item.permalink || '#';node.append(a);}
      node.dataset.fullname ||= item.fullname;state.cards.set(item.fullname,node);return node;
    }
    statusLine(state){
      const when=state.searchedBackTo,parts=[];if(when!=null)parts.push((state.asc?'Searched up to ':'Searched back to ')+day(when));
      if(state.mode==='local')parts.push('Matched by scanning archived pages');
      if(state.plan?.residual || state.mode==='local')parts.push('Matches filtered locally · Results may be incomplete');
      return parts.join(' · ');
    }
    loadingHalo(label='Loading archived results'){
      // One Snoo halo per loading group, never per card. Reddit's own shreddit-loading draws the logo,
      // the halo and its animation (shreddit-feed-page-loading can draw skeleton rows instead).
      // CSS draws a plain halo while the element is undefined.
      const wrap=make('div','rt-sra-loading rt-sra-halo-wrap');wrap.dataset.rtUi='archive-loading';wrap.setAttribute('role','status');wrap.setAttribute('aria-label',label);
      const halo=make('shreddit-loading','rt-sra-halo');halo.setAttribute('aria-hidden','true');
      const fallback=make('span','rt-sra-halo-fallback'),logo=make('shreddit-logo');
      const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 64 64');svg.setAttribute('aria-hidden','true');
      const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d','M34 22l4-13 12 3M10 32a6 6 0 1 0 2 10m42-10a6 6 0 1 1-2 10');path.setAttribute('fill','none');path.setAttribute('stroke','currentColor');path.setAttribute('stroke-width','3');
      const head=document.createElementNS(svg.namespaceURI,'ellipse');for(const [key,value] of Object.entries({cx:32,cy:39,rx:23,ry:17,fill:'white',stroke:'currentColor','stroke-width':3}))head.setAttribute(key,value);svg.append(path,head);
      for(const [cx,cy,r,fill] of [[23,37,3,'#ff4500'],[41,37,3,'#ff4500'],[52,12,5,'white']]){const dot=document.createElementNS(svg.namespaceURI,'circle');for(const [key,value] of Object.entries({cx,cy,r,fill,stroke:'currentColor'}))dot.setAttribute(key,value);svg.append(dot);}
      const smile=document.createElementNS(svg.namespaceURI,'path');smile.setAttribute('d','M23 46q9 7 18 0');smile.setAttribute('fill','none');smile.setAttribute('stroke','currentColor');smile.setAttribute('stroke-width','2');svg.append(smile);logo.append(svg);fallback.append(logo);halo.append(fallback);wrap.append(halo);return wrap;
    }
    // Reddit's small inline spinner (the comment tree's "more replies" loading), not the page halo.
    spinner(){
      const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');for(const [k,v] of Object.entries({fill:'currentColor',height:'16',width:'16',viewBox:'0 0 20 20','aria-hidden':'true','icon-name':'load',class:'animate-spin leading-[0] rt-sra-spinner'}))svg.setAttribute(k,v);
      const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d','M18.1 10.9h-3a.9.9 0 010-1.8h3a.9.9 0 010 1.8ZM5.8 10a.9.9 0 00-.9-.9h-3a.9.9 0 000 1.8h3a.9.9 0 00.9-.9Zm5.1 8.1v-3a.9.9 0 00-1.8 0v3a.9.9 0 001.8 0Zm0-13.2v-3a.9.9 0 00-1.8 0v3a.9.9 0 001.8 0Zm5.464-1.264a.9.9 0 00-1.273 0L12.97 5.757a.901.901 0 001.273 1.273l2.121-2.121a.901.901 0 000-1.273ZM7.03 12.97a.9.9 0 00-1.273 0l-2.121 2.121a.901.901 0 001.273 1.273l2.121-2.121a.901.901 0 000-1.273Zm9.334 2.121-2.121-2.121a.9.9 0 00-1.273 1.273l2.121 2.121a.9.9 0 001.273-1.273ZM7.03 5.758 4.909 3.637A.9.9 0 003.636 4.91l2.121 2.121A.9.9 0 007.03 5.758Z');svg.append(path);return svg;
    }
    // Shown when a scan ends (or pauses) without a single matching post: the coverage date is explicit.
    feedEmpty(state){
      const filters=this.filterState(),filtered=Boolean(filters.types?.length || filters.date),when=state.searchedBackTo!=null?day(state.searchedBackTo):'';
      const box=make('div','rt-sra-empty');box.dataset.rtUi='archive-feed-empty';box.setAttribute('role','status');
      const reach=when?(state.asc?'Searched the archive up to ':'Searched the archive back to ')+when+'. ':'';
      box.append(make('div','rt-sra-empty-title',filtered?'No archived posts match these filters':'No archived posts found'),
        make('div','rt-sra-empty-text',reach+(state.paused && state.hasMore?(state.asc?'Newer':'Older')+' posts may still match.':'The archive may not hold every record.')));
      return box;
    }
    // Temporary archive failures (timeouts, rate limits, maintenance) retry by themselves a few times with
    // growing waits (or the server's requested wait) before the reader is asked to press Retry.
    errorNote(state,retry){
      const error=state.error,message=String(error?.message || 'The archive is unavailable.'),missing=/not in the archive|not found|isn't available/i.test(message);
      const note=make('div','rt-sra-error text-12 text-neutral-content-weak');note.setAttribute('role','status');
      if(!missing && (state.autoRetries || 0)<this.autoRetries){
        if(state.autoRetryFor!==error){
          state.autoRetryFor=error;const attempt=state.autoRetries || 0,wait=Math.max(this.autoRetryWaits[attempt] ?? 0,error?.retryAt?error.retryAt-Date.now():0);
          clearTimeout(state.autoRetryTimer);state.autoRetryTimer=setTimeout(()=>{if(state.error!==error)return;state.autoRetries=attempt+1;retry();},wait);
        }
        note.append(this.spinner(),make('span','','The archive is slow to respond · Retrying automatically…'));return note;
      }
      note.append(make('span','',message));
      if(error?.retryAt){const wait=Math.max(0,Math.ceil((error.retryAt-Date.now())/1000));if(wait>0)note.append(make('span','',' Try again in about '+wait+' s.'));}
      const button=make('button','button button-small button-secondary rt-sra-retry','Retry');button.type='button';button.dataset.rtRetry='true';button.addEventListener('click',()=>{state.autoRetries=0;retry();});note.append(button);return note;
    }
    renderList(){
      if(!this.mounted)return;const state=this.current(),items=this.visibleItems(state),shown=items.slice(0,state.want);
      const hold=this.restoringFeed?null:this.holdScroll();this.syncList(state,shown);hold?.();
      this.statusTop.hidden=false;
      this.statusTop.textContent='Archived results from Arctic Shift · Coverage may be partial.'+(state.sortMode==='top'?' Sorted by votes among loaded posts only.':state.sortMode==='comments'?' Sorted by comment count among loaded posts only.':'');
      const foot=this.footEl;foot.replaceChildren();
      // More is coming while pages wait in memory or the archive has older ones: Reddit keeps its halo
      // at the end of the feed while it pages. A paused scan shows "Search older" instead.
      const more=shown.length<items.length || state.hasMore && !state.paused,idle=!state.loading && !state.error && state.started;
      const scanning=state.loading && !shown.length && this.localFilter();
      if(state.loading || this.io && more && idle)foot.append(this.loadingHalo(scanning?'Searching the archive for matching posts':'Loading archived posts'));
      if(scanning)foot.append(make('p','rt-sra-note rt-sra-scan-note text-12 text-neutral-content-weak','Searching older archived posts for matches…'));
      if(!state.error && !state.loading)state.autoRetries=0;if(state.error)foot.append(this.errorNote(state,()=>this.retry()));
      if(idle){
        if(!items.length){if(!state.hasMore || state.paused)foot.append(this.feedEmpty(state));else foot.append(make('p','rt-archive-empty text-14 text-neutral-content-weak','No archived posts loaded yet for these settings.'));}
        if(state.stalled)foot.append(make('p','rt-sra-note text-12 text-neutral-content-weak','The archive stopped paging here; older records may exist.'));
        else if(!state.hasMore && items.length && shown.length===items.length)foot.append(make('p','rt-sra-note text-12 text-neutral-content-weak','End of what the archive returned · Coverage may be partial'));
      }
      const line=this.statusLine(state);if(line)foot.append(make('p','rt-sra-searched text-12 text-neutral-content-weak',line));
      if(idle && state.paused && state.hasMore){const older=make('button','button button-small button-secondary',state.asc?'Search newer':'Search older');older.type='button';older.dataset.rtMore='true';older.addEventListener('click',()=>this.loadMore());foot.append(older);}
      // The feed keeps paging on scroll; a button covers environments where scrolling cannot trigger it.
      else if(idle && more && !this.io){const button=make('button','button button-small button-secondary','Load more');button.type='button';button.dataset.rtMore='true';button.addEventListener('click',()=>this.loadMore());foot.append(button);}
      this.renderArchiveStats();
    }
    // Reconcile in place: cards that stay keep their identity and position (Reddit's components are not
    // disconnected and reconnected on every render), stale ones leave, and none is ever listed twice.
    syncList(state,items){
      const list=this.listEl,nodes=items.map(item=>this.cardFor(state,item));
      for(const [index,node] of nodes.entries()){const at=list.children[index];if(at!==node)list.insertBefore(node,at || null);}
      while(list.children.length>nodes.length)list.lastElementChild.remove();
    }
    syncAll(){if(!this.mounted)return;this.syncMenu();this.renderChips();}
  }

  globalThis.RTSubredditArchive=Object.freeze({SubredditArchive,unavailable,searchRoute,threadRoute});
  // Content script entry (top frame of a Reddit page only). Tests construct SubredditArchive themselves.
  if(window.top===window && globalThis.chrome?.runtime?.id)Object.defineProperty(globalThis,'RTSubredditArchiveInstance',{value:new SubredditArchive()});
})();
