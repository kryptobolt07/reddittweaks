/* "Not yet approved" filter for moderators (docs/unmoderated-filter-spec.md).
   On a community feed the signed-in user moderates, one button next to Reddit's sort control shows only the posts
   in the community's Unmoderated queue, as Reddit's search rows, in place of the feed. Read-only. */
(() => {
  'use strict';
  if(globalThis.RTUnapprovedFilter)return;
  const M=globalThis.RTPostModel;if(!M)return;
  const PARAM='rt_mod',VALUE='unapproved',STATUS_TTL=600000,MAX_ITEMS=1000;
  const hiddenAttr='data-rt-unapproved-hidden';
  const feedRoute=(path=location.pathname)=>path.match(/^\/r\/([A-Za-z0-9_]{2,21})(?:\/(?:hot|new|top|rising|best))?\/?$/i)?.[1] || null;
  const requested=()=>new URLSearchParams(location.search).get(PARAM)===VALUE;
  // Reddit's custom elements reject createElement once defined; parse them instead (contract F7).
  const make=(tag,cls,text)=>{let el;if(tag.includes('-')){const holder=document.createElement('div');holder.innerHTML='<'+tag+'></'+tag+'>';el=holder.firstElementChild;el.remove();}else el=document.createElement(tag);if(cls)el.className=cls;if(text!=null && text!=='')el.textContent=text;return el;};
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
  const defaultReddit=(...args)=>{const read=globalThis.RTPostDiscovery?.redditRead;if(!read)return Promise.reject(Error('Reddit Tweaks is still starting. Try again.'));return read(...args);};

  class UnapprovedFilter {
    constructor({reddit=defaultReddit,readSettings=defaultSettings,observe=true}={}){
      // The page bridge answers "deferred" while it is busy; wait and ask again (bounded).
      this.reddit=async args=>{for(let attempt=0;;attempt++){const result=await reddit(args);if(!result?.deferred || attempt>=20)return result;await new Promise(resolve=>setTimeout(resolve,Math.min(2000,Number(result.retryAfterMs) || 250)));}};this.readSettings=readSettings;this.status=new Map();this.enabled=false;this.dead=false;this.view=null;this.button=null;this.generation=0;
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
      if(settings)this.enabled=Boolean(settings.modUnapprovedFilter);
      else{this.enabled=M.normalizeSettings({}).modUnapprovedFilter;if(attempt<6)this.settingsRetry=setTimeout(()=>this.loadSettings(attempt+1),Math.min(30000,1000*2**attempt));}
      this.sync();
    }
    destroy(){
      this.dead=true;clearTimeout(this.settingsRetry);this.observer?.disconnect();removeEventListener('popstate',this.onRoute);document.removeEventListener('reddit:route',this.onRoute);
      try{chrome.storage?.onChanged?.removeListener(this.onSettings);}catch{}try{chrome.runtime?.onMessage?.removeListener(this.onSettingsMessage);}catch{}
      this.unmount();this.removeButton();
    }
    // Moderator answer per community for this page's lifetime (B1). Pending and failed checks show nothing.
    moderator(name){
      const key=name.toLowerCase(),saved=this.status.get(key);
      if(saved && (saved.pending || Date.now()-saved.at<STATUS_TTL))return saved.pending?null:saved.moderator;
      const entry={pending:true,at:Date.now(),moderator:false};this.status.set(key,entry);
      this.reddit({action:'mod-status',subreddit:name}).then(result=>{entry.moderator=result?.moderator===true;},()=>{entry.moderator=false;entry.failed=true;})
        .finally(()=>{entry.pending=false;entry.at=Date.now()-(entry.failed?STATUS_TTL-30000:0);if(!this.dead)this.sync();});
      return null;
    }
    sortControl(){
      return [...document.querySelectorAll('shreddit-sort-dropdown')].find(el=>!el.closest('shreddit-comment-tree,shreddit-post,[data-rt-unapproved]')) || null;
    }
    sync(){
      if(this.dead)return;
      const name=this.enabled?feedRoute():null;
      if(!name){this.unmount();this.removeButton();return;}
      if(this.view && this.view.name.toLowerCase()!==name.toLowerCase())this.unmount();
      const moderator=this.moderator(name);
      if(moderator!==true){this.unmount();this.removeButton();return;}
      this.ensureButton(name);
      if(requested())this.mount(name);else this.unmount();
    }
    ensureButton(name){
      const sort=this.sortControl();if(!sort)return;
      let button=this.button;
      if(!button){
        // Reddit's plain small feed-control button (measured: 32 px, pill radius, 12 px/600, weak content colour).
        button=this.button=make('button','rt-unapproved-button text-neutral-content-weak button-small button-plain items-center justify-center button inline-flex');
        button.type='button';button.dataset.rtUi='unapproved-filter';button.dataset.rtUnapproved='button';
        button.append(make('span','flex items-center gap-2xs','Not yet approved'));
        button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();const on=!requested();setParam(on);this.sync();if(on)this.view?.summary?.focus?.({preventScroll:true});});
      }
      const on=requested();button.setAttribute('aria-pressed',String(on));button.title=on?'Show the whole feed':'Show only posts no moderator has approved yet in r/'+name;
      const label=button.firstElementChild;if(on && !label.querySelector('svg'))label.prepend(glyph('checkmark'));if(!on)label.querySelector('svg')?.remove();
      if(sort.nextElementSibling!==button)sort.after(button);
    }
    removeButton(){this.button?.remove();}
    mount(name){
      const feed=document.querySelector('shreddit-feed');if(!feed)return;
      if(this.view?.feed===feed && this.view.root.isConnected)return;
      this.unmount();
      const generation=++this.generation,root=make('section','rt-unapproved');root.dataset.rtUi='unapproved-list';root.dataset.rtUnapproved='list';root.setAttribute('aria-label','Posts not yet approved in r/'+name);
      const summary=make('p','rt-unapproved-summary text-12 text-neutral-content-weak m-0 px-md py-sm');summary.setAttribute('role','status');summary.tabIndex=-1;
      const list=make('div','rt-unapproved-rows'),more=make('button','rt-unapproved-more button-secondary button-small button inline-flex items-center justify-center','Show more');more.type='button';more.hidden=true;
      const retry=make('button','rt-unapproved-retry button-secondary button-small button inline-flex items-center justify-center','Retry');retry.type='button';retry.hidden=true;
      const actions=make('div','rt-unapproved-actions flex justify-center gap-sm py-md');actions.append(more,retry);
      root.append(summary,list,actions);feed.before(root);feed.setAttribute(hiddenAttr,'');
      this.view={name,feed,root,summary,list,more,retry,items:new Map(),after:null,cursors:new Set(),loading:false,done:false,error:'',generation};
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
    render(){
      const view=this.view;if(!view)return;
      const count=view.items.size,label=count.toLocaleString('en-US')+' '+(count===1?'post':'posts');
      for(const post of view.items.values())if(!view.list.querySelector('[data-rt-unapproved-id="'+post.id+'"]'))view.list.append(this.row(post));
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
  globalThis.RTUnapprovedFilter=Object.freeze({UnapprovedFilter,feedRoute,PARAM,VALUE});
  // Content script entry (top frame of a Reddit page only). Tests construct UnapprovedFilter themselves.
  if(window.top===window && globalThis.chrome?.runtime?.id && location.hostname!=='old.reddit.com')Object.defineProperty(globalThis,'RTUnapprovedFilterInstance',{value:new UnapprovedFilter()});
})();
