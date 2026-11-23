/* "Awaiting approval" filter (docs/unmoderated-filter-spec.md).
   In any community feed, shows only the posts held for review and not yet approved, as Reddit's search rows, in
   place of the feed. Moderators read the community's Unmoderated queue (exact); everyone else reads the newest posts
   of the last 7 days from Arctic Shift and asks Reddit for their current state. The feed menu turns it on and off
   (RTUnapprovedFilter.setActive); without a menu, moderators get a standalone button next to Reddit's sort. Read-only. */
(() => {
  'use strict';
  if(globalThis.RTUnapprovedFilter)return;
  const M=globalThis.RTPostModel;if(!M)return;
  const PARAM='rt_mod',VALUE='unapproved',STATUS_TTL=600000,MAX_ITEMS=1000;
  // Archive source bounds (spec B8): three Arctic Shift pages of 100, last 7 days, 100 IDs per Reddit status read.
  const ARCHIVE_PAGES=3,ARCHIVE_DAYS=7,STATUS_BATCH=100;
  // Reddit's removed_by_category for a post held by AutoModerator or Reddit's filters and not yet approved.
  const AWAITING=new Set(['automod_filtered','reddit']);
  const awaitingCategory=category=>typeof category==='string' && AWAITING.has(category);
  const hiddenAttr='data-rt-unapproved-hidden',MENU_ATTR='data-rt-unapproved-menu';
  const NOTES=Object.freeze({modqueue:'From your mod queue',archive:'Held for review and not yet approved (from Arctic Shift, last 7 days)'});
  const feedRoute=(path=location.pathname)=>path.match(/^\/r\/([A-Za-z0-9_]{2,21})(?:\/(?:hot|new|top|rising|best))?\/?$/i)?.[1] || null;
  const requested=()=>new URLSearchParams(location.search).get(PARAM)===VALUE;
  // Reddit's custom elements reject createElement once defined; parse them instead (contract F7).
  const make=(tag,cls,text)=>{let el;if(tag.includes('-')){if(!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/.test(tag))throw Error('Invalid custom element name.');const parsed=new DOMParser().parseFromString('<'+tag+'></'+tag+'>','text/html');el=document.adoptNode(parsed.body.firstElementChild);}else el=document.createElement(tag);if(cls)el.className=cls;if(text!=null && text!=='')el.textContent=text;return el;};
  const link=(text,href,cls)=>{const a=make('a',cls,text);a.href=href;return a;};
  const glyph=kind=>globalThis.RTFeedFilters?.svgIcon?.(kind,16) || globalThis.RTPostDiscovery?.glyph?.(kind) || document.createElementNS('http://www.w3.org/2000/svg','svg');
  const number=n=>new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1}).format(Number(n) || 0);
  function setParam(on){
    const url=new URL(location.href);if(on)url.searchParams.set(PARAM,VALUE);else url.searchParams.delete(PARAM);
    // Reddit's router reloads on a replaceState to the unchanged address (contract F3).
    const next=url.pathname+url.search+url.hash;if(next===location.pathname+location.search+location.hash)return;
    try{history.replaceState(history.state,'',next);}catch{}
  }
  async function defaultSettings(){const response=await chrome.runtime.sendMessage({scope:'rt-posts',action:'get-settings'});if(!response?.ok)throw Error('Settings unavailable.');return response.settings;}
  // The worker's archive path (post-broker.js archive-search): its slot, cooldown, backoff and opt-in check apply.
  async function defaultArchive(message){let timer;try{return await Promise.race([chrome.runtime.sendMessage({scope:'rt-posts',...message,pageUrl:location.href}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Arctic Shift took too long. Try again.')),16000);})]);}finally{clearTimeout(timer);}}
  const defaultReddit=(...args)=>{const read=globalThis.RTPostDiscovery?.redditRead;if(!read)return Promise.reject(Error('Reddit Tweaks is still starting. Try again.'));return read(...args);};
  // The feed menu talks to the page's one live filter (the content-script instance, or the one a test constructs).
  let primary=null;

  class UnapprovedFilter {
    constructor({reddit=defaultReddit,archive=defaultArchive,readSettings=defaultSettings,observe=true,menu=false,now=()=>Date.now()}={}){
      // The page bridge answers "deferred" while it is busy; wait and ask again (bounded).
      this.reddit=async args=>{for(let attempt=0;;attempt++){const result=await reddit(args);if(!result?.deferred || attempt>=20)return result;await new Promise(resolve=>setTimeout(resolve,Math.min(2000,Number(result.retryAfterMs) || 250)));}};
      this.readSettings=readSettings;this.archive=archive;this.now=now;this.status=new Map();this.enabled=false;this.archiveOn=false;this.menu=Boolean(menu);this.listeners=new Set();this.snapshot='';
      this.dead=false;this.view=null;this.button=null;this.generation=0;primary=this;
      this.onRoute=()=>this.sync();
      if(observe){
        this.observer=new MutationObserver(()=>{if(!this.queued){this.queued=true;queueMicrotask(()=>{this.queued=false;this.sync();});}});
        this.observer.observe(document.documentElement,{childList:true,subtree:true});
        addEventListener('popstate',this.onRoute);document.addEventListener('reddit:route',this.onRoute);
        this.onSettings=(changes,area)=>{if(area==='local' && changes['rt-settings-v1'])this.loadSettings();};
        this.onSettingsMessage=message=>{if(message?.scope==='rt-posts' && message.action==='settings-changed')this.loadSettings();};
        try{chrome.storage?.onChanged?.addListener(this.onSettings);}catch{}
        try{chrome.runtime?.onMessage?.addListener(this.onSettingsMessage);}catch{}
      }
      this.ready=this.loadSettings();
    }
    // A failed settings read keeps the default and retries with backoff, instead of disabling the filter for the page.
    async loadSettings(attempt=0){
      clearTimeout(this.settingsRetry);let settings=null;try{settings=M.normalizeSettings(await this.readSettings());}catch{}
      if(this.dead)return;
      if(settings){this.enabled=Boolean(settings.modUnapprovedFilter);this.archiveOn=settings.archiveDiscovery===true;}
      else{const fallback=M.normalizeSettings({});this.enabled=fallback.modUnapprovedFilter;this.archiveOn=fallback.archiveDiscovery;if(attempt<6)this.settingsRetry=setTimeout(()=>this.loadSettings(attempt+1),Math.min(30000,1000*2**attempt));}
      this.sync();
    }
    destroy(){
      this.dead=true;clearTimeout(this.settingsRetry);this.observer?.disconnect();removeEventListener('popstate',this.onRoute);document.removeEventListener('reddit:route',this.onRoute);
      try{chrome.storage?.onChanged?.removeListener(this.onSettings);}catch{}try{chrome.runtime?.onMessage?.removeListener(this.onSettingsMessage);}catch{}
      this.unmount();this.removeButton();this.listeners.clear();if(primary===this)primary=null;
    }
    // Moderator answer per community for this page's lifetime (B1), at most 10 minutes; a failed check is asked
    // again after 30 s. Returns the entry; entry.done settles once the answer is in.
    check(name){
      const key=name.toLowerCase(),saved=this.status.get(key);
      if(saved && (saved.pending || Date.now()-saved.at<STATUS_TTL))return saved;
      const entry={pending:true,at:Date.now(),moderator:false,signedIn:null,failed:false};this.status.set(key,entry);
      entry.done=this.reddit({action:'mod-status',subreddit:name})
        .then(result=>{if(result?.ok===false || result?.deferred)throw Error(result.error || 'Moderator check unavailable.');entry.moderator=result?.moderator===true;entry.signedIn=typeof result?.signedIn==='boolean'?result.signedIn:null;},()=>{entry.moderator=false;entry.failed=true;})
        .finally(()=>{entry.pending=false;entry.at=Date.now()-(entry.failed?STATUS_TTL-30000:0);if(!this.dead)this.sync();});
      return entry;
    }
    moderator(name){const entry=this.check(name);return entry.pending?null:entry.moderator;}
    // Which list this community gets now: 'modqueue', 'archive', or null (pending, unavailable or failed check).
    source(name){
      const entry=this.check(name);if(entry.pending || entry.failed)return null;
      if(entry.moderator)return 'modqueue';
      return entry.signedIn!==false && this.archiveOn?'archive':null;
    }
    describe(entry){
      if(entry.failed)return {available:false,source:null,reason:'error'};
      if(entry.moderator)return {available:true,source:'modqueue'};
      if(entry.signedIn===false)return {available:false,source:null,reason:'signed-out'};
      return this.archiveOn?{available:true,source:'archive'}:{available:false,source:'archive',reason:'archive-off'};
    }
    // Public (B7): what the feed menu can offer in the current community.
    async availability(subreddit){
      await this.ready;
      const name=feedRoute();
      if(this.dead || !this.enabled)return {available:false,source:null,reason:'disabled'};
      if(!name || subreddit!=null && String(subreddit).toLowerCase()!==name.toLowerCase())return {available:false,source:null,reason:'not-community'};
      const entry=this.check(name);await entry.done;
      return this.dead?{available:false,source:null,reason:'disabled'}:this.describe(entry);
    }
    active(){return requested();}
    // Public: turn the filtered view on or off in the current community. One replaceState (F3); resolves to the new state.
    async setActive(on){
      if(this.dead)return false;
      if(on){const state=await this.availability();if(!state.available || this.dead)return requested();}
      setParam(Boolean(on));this.sync();
      if(on)this.view?.summary?.focus?.({preventScroll:true});
      return requested();
    }
    useMenu(on=true){this.menu=Boolean(on);this.sync();}
    menuActive(){return this.menu || document.documentElement.hasAttribute(MENU_ATTR);}
    onChange(fn){if(typeof fn!=='function')return ()=>{};this.listeners.add(fn);return ()=>{this.listeners.delete(fn);};}
    // Tells subscribers once per real change of {subreddit, active, available, source, reason, pending}.
    emit(name){
      let state={subreddit:name || null,active:Boolean(name) && requested(),available:false,source:null};
      if(name && this.enabled){const entry=this.check(name);state=entry.pending?{...state,pending:true}:{...state,...this.describe(entry)};}
      else if(!this.enabled)state.reason='disabled';else state.reason='not-community';
      const key=JSON.stringify(state);if(key===this.snapshot)return;this.snapshot=key;
      for(const fn of [...this.listeners])try{fn(state);}catch{}
    }
    sortControl(){
      return [...document.querySelectorAll('shreddit-sort-dropdown')].find(el=>!el.closest('shreddit-comment-tree,shreddit-post,[data-rt-unapproved]')) || null;
    }
    sync(){
      if(this.dead)return;
      const name=this.enabled?feedRoute():null;
      if(!name){this.unmount();this.removeButton();this.emit(null);return;}
      if(this.view && this.view.name.toLowerCase()!==name.toLowerCase())this.unmount();
      const source=this.source(name);
      // The standalone button is for moderators only, and only while no feed menu offers the filter (B2).
      if(source==='modqueue' && !this.menuActive())this.ensureButton(name);else this.removeButton();
      if(source && requested())this.mount(name,source);else this.unmount();
      this.emit(name);
    }
    ensureButton(name){
      const sort=this.sortControl();if(!sort)return;
      let button=this.button;
      if(!button){
        // Reddit's plain small feed-control button (measured: 32 px, pill radius, 12 px/600, weak content colour).
        button=this.button=make('button','rt-unapproved-button text-neutral-content-weak button-small button-plain items-center justify-center button inline-flex');
        button.type='button';button.dataset.rtUi='unapproved-filter';button.dataset.rtUnapproved='button';
        button.append(make('span','flex items-center gap-2xs','Not yet approved'));
        button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();this.setActive(!requested());});
      }
      const on=requested();button.setAttribute('aria-pressed',String(on));button.title=on?'Show the whole feed':'Show only posts no moderator has approved yet in r/'+name;
      const label=button.firstElementChild;if(on && !label.querySelector('svg'))label.prepend(glyph('checkmark'));if(!on)label.querySelector('svg')?.remove();
      if(sort.nextElementSibling!==button)sort.after(button);
    }
    removeButton(){this.button?.remove();}
    mount(name,source='modqueue'){
      const feed=document.querySelector('shreddit-feed');if(!feed)return;
      if(this.view?.feed===feed && this.view.source===source && this.view.root.isConnected)return;
      this.unmount();
      const generation=++this.generation,root=make('section','rt-unapproved');root.dataset.rtUi='unapproved-list';root.dataset.rtUnapproved='list';root.dataset.rtUnapprovedSource=source;
      root.setAttribute('aria-label',(source==='archive'?'Posts awaiting approval in r/':'Posts not yet approved in r/')+name);
      const summary=make('p','rt-unapproved-summary text-12 text-neutral-content-weak m-0 px-md pt-sm');summary.setAttribute('role','status');summary.tabIndex=-1;
      const note=make('p','rt-unapproved-source text-12 text-neutral-content-weak m-0 px-md pb-sm',NOTES[source]);
      const list=make('div','rt-unapproved-rows'),more=make('button','rt-unapproved-more button-secondary button-small button inline-flex items-center justify-center','Show more');more.type='button';more.hidden=true;
      const retry=make('button','rt-unapproved-retry button-secondary button-small button inline-flex items-center justify-center','Retry');retry.type='button';retry.hidden=true;
      const actions=make('div','rt-unapproved-actions flex justify-center gap-sm py-md');actions.append(more,retry);
      root.append(summary,note,list,actions);feed.before(root);feed.setAttribute(hiddenAttr,'');
      // Archive state: the 7-day cutoff, Arctic Shift cursor, pages read, posts read but not yet checked with Reddit,
      // IDs seen, why the check stopped short of 7 days ('cap' or 'stalled'), and posts Reddit didn't answer for.
      const cutoff=Math.floor(this.now()/60000)*60-ARCHIVE_DAYS*86400;
      this.view={name,source,feed,root,summary,note,list,more,retry,items:new Map(),after:null,cursors:new Set(),loading:false,done:false,error:'',generation,
        cutoff,cursor:null,pages:0,pending:[],seen:new Set(),last:false,partial:'',unchecked:0};
      more.addEventListener('click',()=>this.load());retry.addEventListener('click',()=>this.load());
      this.load();
    }
    unmount(){
      const view=this.view;if(!view)return;this.view=null;this.generation++;
      view.root.remove();if(view.feed.isConnected)view.feed.removeAttribute(hiddenAttr);
    }
    async load(){
      const view=this.view;if(!view || view.loading || view.done)return;
      view.loading=true;view.error='';this.render();
      const current=()=>this.view===view && view.generation===this.generation && !this.dead;
      if(view.source==='archive')return this.loadArchive(view,current);
      try{
        const result=await this.reddit({action:'unapproved',subreddit:view.name,after:view.after});if(!current())return;
        if(!Array.isArray(result?.posts) || result.posts.length>100)throw Error('Reddit returned an unexpected moderation queue.');
        for(const raw of result.posts){const post=M.normalizePost(raw);if(post && !view.items.has(post.id) && view.items.size<MAX_ITEMS)view.items.set(post.id,post);}
        const after=result.hasMore?result.after:null;
        if(after && view.cursors.has(after))throw Error('Reddit repeated a queue cursor; the list may be incomplete.');
        if(after)view.cursors.add(after);view.after=after;view.done=!after || view.items.size>=MAX_ITEMS;
      }catch(error){if(current())view.error=error.message || 'Reddit could not load the moderation queue.';}
      finally{if(current()){view.loading=false;this.render();}}
    }
    // Archive source (B8): up to three Arctic Shift pages of the last 7 days, newest first. Each page's IDs are checked
    // with Reddit before the next page is read, so a failure keeps what was verified and Retry resumes where it stopped.
    async loadArchive(view,current){
      try{
        while(!view.done){
          if(!view.pending.length && !view.last){
            const answer=await this.archive({action:'archive-search',kind:'post',subreddit:view.name,sort:'desc',after:view.cutoff,...(view.cursor?{before:view.cursor}:{})});if(!current())return;
            if(!answer?.ok)throw Error(answer?.code==='disabled'?'Turn on Use the archive to check this community':answer?.error || 'Arctic Shift is unavailable');
            if(!Array.isArray(answer.posts) || answer.posts.length>100)throw Error('Arctic Shift returned an unexpected listing');
            let older=false;
            for(const raw of answer.posts){
              const post=M.normalizePost(raw,{source:'arctic-shift'});if(!post || post.subreddit.toLowerCase()!==view.name.toLowerCase())continue;
              if(post.created<view.cutoff){older=true;continue;}
              if(!view.seen.has(post.id)){view.seen.add(post.id);view.pending.push(post);}
            }
            view.pages++;
            const cursor=Number(answer.cursor);
            if(!answer.hasMore || older)view.last=true;
            else if(answer.cursorStalled || !Number.isSafeInteger(cursor) || view.cursor!=null && cursor>=view.cursor){view.last=true;view.partial='stalled';}
            else{view.cursor=cursor;if(view.pages>=ARCHIVE_PAGES){view.last=true;view.partial='cap';}}
          }
          while(view.pending.length){
            const batch=view.pending.slice(0,STATUS_BATCH);
            const result=await this.reddit({action:'awaiting-status',subreddit:view.name,ids:batch.map(post=>post.id)});if(!current())return;
            if(result?.ok===false || result?.deferred)throw Error(result.error || 'Reddit is busy. Try again');
            if(!Array.isArray(result?.statuses) || result.statuses.length>batch.length)throw Error('Reddit returned an unexpected status answer');
            const answered=new Map();for(const status of result.statuses)if(status && typeof status.id==='string')answered.set(status.id,status);
            for(const archived of batch){
              const status=answered.get(archived.id);if(!status){view.unchecked++;continue;}
              if(!awaitingCategory(status.category) || view.items.has(archived.id) || view.items.size>=MAX_ITEMS)continue;
              // Reddit's current copy (title, votes, thumbnail) when it reads; the archive copy otherwise.
              const live=M.normalizePost(status.post,{source:'reddit'});view.items.set(archived.id,live?.id===archived.id?live:archived);
            }
            view.pending.splice(0,batch.length);
          }
          if(view.last)view.done=true;
        }
      }catch(error){if(current())view.error=String(error?.message || 'Reddit could not check these posts').replace(/\.$/,'');}
      finally{if(current()){view.loading=false;this.render();}}
    }
    // Never "complete": the archive can lag or miss posts (spec L5-L7). A short check says why.
    archiveSummary(view,count,label){
      const where=' in r/'+view.name;
      if(view.error)return (count?'Showing '+label+' held for review'+where+' · ':'')+'Couldn’t check posts awaiting approval: '+view.error+'.';
      if(view.loading)return count?'Showing '+label+' held for review'+where+' · Checking…':'Checking recent posts'+where+'…';
      const notes=[];
      if(view.partial==='cap')notes.push('only the newest '+ARCHIVE_PAGES*100+' posts were checked; older posts from the last 7 days weren’t');
      if(view.partial==='stalled')notes.push('the archive listing stopped early; older posts weren’t checked');
      if(view.unchecked)notes.push(view.unchecked.toLocaleString('en-US')+' '+(view.unchecked===1?'post':'posts')+' couldn’t be checked with Reddit');
      const tail=notes.length?' · '+notes.join(' · '):'';
      if(!count)return notes.length?'No posts found waiting for approval'+where+tail+'.':'No posts are waiting for approval'+where+' in the last 7 days.';
      return label+' held for review'+where+(tail || ' in the last 7 days');
    }
    render(){
      const view=this.view;if(!view)return;
      const count=view.items.size,label=count.toLocaleString('en-US')+' '+(count===1?'post':'posts');
      for(const post of view.items.values())if(!view.list.querySelector('[data-rt-unapproved-id="'+post.id+'"]'))view.list.append(this.row(post));
      if(view.source==='archive'){
        view.summary.textContent=this.archiveSummary(view,count,label);if(view.error)view.summary.dataset.error='true';else delete view.summary.dataset.error;
        view.more.hidden=true;view.retry.hidden=!view.error || view.loading;view.root.setAttribute('aria-busy',String(view.loading));return;
      }
      if(view.error){view.summary.textContent=(count?'Showing '+label+' not yet approved in r/'+view.name+' · ':'')+'Couldn’t load the moderation queue: '+view.error.replace(/\.$/,'')+'.';view.summary.dataset.error='true';}
      else{delete view.summary.dataset.error;
        view.summary.textContent=view.loading && !count?'Loading posts not yet approved in r/'+view.name+'…':!count?'No posts are waiting for approval in r/'+view.name+'.':(view.done?label+' not yet approved in r/'+view.name:'Showing the newest '+label+' not yet approved in r/'+view.name)+(view.loading?' · Loading…':'');}
      view.more.hidden=view.done || view.loading || Boolean(view.error);view.retry.hidden=!view.error || view.loading;view.root.setAttribute('aria-busy',String(view.loading));
    }
    // Reddit's search post row (the same markup as our list searches), without any action that writes.
    row(post){
      const wrap=make('div','rt-search-unit');wrap.dataset.rtSearchUnit='post';wrap.dataset.rtUnapprovedId=post.id;
      const dot=()=>make('span','mx-2xs','·'),time=make('faceplate-timeago');time.setAttribute('ts',new Date(post.created*1000).toISOString());time.setAttribute('format','narrow');
      const row=make('div','flex justify-between items-center hover:bg-neutral-background-hover xs:rounded-4 relative p-md my-2xs');row.dataset.testid='search-post-unit';
      const h2=make('h2','m-0'),cover=link('',post.permalink,'absolute inset-0');cover.setAttribute('aria-label',post.title || 'Post');h2.append(cover);
      const thumb=(post.media || []).map(item=>item.kind==='video'?item.poster:item.url).find(Boolean) || M.mediaUrl?.(post.thumbnail || '') || '';
      const body=make('div','w-full flex flex-col items-start min-w-0'+(thumb?' pe-md overflow-hidden':''));
      const credit=make('div','post-credit-row flex items-center mb-xs relative overflow-hidden whitespace-nowrap w-auto max-w-full'),meta=make('span','flex items-center text-neutral-content-weak text-12 overflow-hidden');
      const author=link('u/'+post.author,'/user/'+encodeURIComponent(post.author)+'/','text-neutral-content-weak font-semibold relative hover:underline');
      meta.append(author,dot(),time);
      if(post.over18){meta.append(dot(),make('span','rt-search-tag font-semibold','NSFW'));}if(post.spoiler){meta.append(dot(),make('span','rt-search-tag font-semibold','Spoiler'));}
      credit.append(meta);
      const title=link(post.title || '[untitled]',post.permalink,'xs:text-18 text-neutral-content-strong no-underline hover:no-underline visited:text-neutral-content-weak text-ellipsis mb-xs line-clamp-3 font-semibold text-16 relative');title.dataset.testid='post-title-text';
      const counter=make('div','text-neutral-content-weak text-12');counter.dataset.testid='search-counter-row';counter.append(make('span','',number(post.score)+' '+(Number(post.score)===1?'vote':'votes')),dot(),make('span','',number(post.comments)+' '+(Number(post.comments)===1?'comment':'comments')));
      body.append(credit,title,counter);row.append(h2,body);
      if(thumb){const a=link('',post.permalink,'relative');a.setAttribute('aria-label',(post.title || 'Post')+' thumbnail image');const img=make('img','block rounded-2 object-cover h-[60px] w-[80px] xs:h-[90px] xs:w-[120px]');img.src=thumb;img.alt=post.title || '';img.loading='lazy';img.decoding='async';img.referrerPolicy='no-referrer';if(post.over18 || post.spoiler)img.style.filter='blur(12px)';a.append(img);row.append(a);}
      wrap.append(row,make('hr','list-divider-line border-0 border-b-sm border-solid border-b-neutral-border-weak xs:mx-md'));return wrap;
    }
  }
  const unavailable=Object.freeze({available:false,source:null,reason:'error'});
  globalThis.RTUnapprovedFilter=Object.freeze({UnapprovedFilter,feedRoute,awaitingCategory,PARAM,VALUE,MENU_ATTR,NOTES,ARCHIVE_PAGES,ARCHIVE_DAYS,
    availability:subreddit=>primary?primary.availability(subreddit):Promise.resolve(unavailable),
    active:()=>requested(),
    setActive:on=>primary?primary.setActive(on):Promise.resolve(false),
    onChange:fn=>primary?primary.onChange(fn):()=>{},
    // The feed menu calls this once it has taken over (the attribute also works before this script loads).
    useMenu:(on=true)=>{if(on)document.documentElement.setAttribute(MENU_ATTR,'');else document.documentElement.removeAttribute(MENU_ATTR);primary?.useMenu(on);}});
  // Content script entry (top frame of a Reddit page only). Tests construct UnapprovedFilter themselves.
  if(window.top===window && globalThis.chrome?.runtime?.id && location.hostname!=='old.reddit.com')Object.defineProperty(globalThis,'RTUnapprovedFilterInstance',{value:new UnapprovedFilter()});
  try{document.dispatchEvent(new CustomEvent('rt-unapproved-ready'));}catch{}
})();
