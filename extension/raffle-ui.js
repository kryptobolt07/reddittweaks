/* Raffles from a post's ⋯ menu (docs/raffle-spec.md). The menu item sits in the menu's own action slot
   (devvit-context-actions), measured identical to Reddit's items; the dialog uses Reddit's rpl-modal-card.
   Read-only: comments and account facts are read through the page bridge; nothing is posted or stored. */
(() => {
  'use strict';
  if(globalThis.RTRaffle)return;
  const M=globalThis.RTPostModel,R=globalThis.RTRaffleModel,F=globalThis.RTFeedFilters;if(!M || !R || !F)return;
  // Reading limits (FINDINGS.md: ~90 top-level comments per client page, ~83 KB per "more replies" page).
  const TOP_PAGES=120,REPLY_REQUESTS=800,REPLY_PARALLEL=2;
  const MOBILE='(max-width: 640px)';
  const make=(tag,cls,text)=>{let el;if(tag.includes('-')){if(!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/.test(tag))throw Error('Invalid custom element name.');const parsed=new DOMParser().parseFromString('<'+tag+'></'+tag+'>','text/html');el=document.adoptNode(parsed.body.firstElementChild);}else el=document.createElement(tag);if(cls)el.className=cls;if(text!=null && text!=='')el.textContent=text;return el;};
  const svgNS='http://www.w3.org/2000/svg';
  function icon(d,size=20){const svg=document.createElementNS(svgNS,'svg');for(const [k,v] of Object.entries({fill:'currentColor',height:String(size),width:String(size),viewBox:'0 0 20 20','aria-hidden':'true'}))svg.setAttribute(k,v);const path=document.createElementNS(svgNS,'path');path.setAttribute('d',d);svg.append(path);return svg;}
  // A ticket outline (Reddit has no raffle icon), drawn on Reddit's 20 px grid.
  const TICKET='M16.6 3H3.4A2.4 2.4 0 001 5.4v2.2a.9.9 0 00.9.9 1.5 1.5 0 010 3 .9.9 0 00-.9.9v2.2A2.4 2.4 0 003.4 17h13.2a2.4 2.4 0 002.4-2.4v-2.2a.9.9 0 00-.9-.9 1.5 1.5 0 010-3 .9.9 0 00.9-.9V5.4A2.4 2.4 0 0016.6 3Zm.6 4.26a3.3 3.3 0 000 5.48v1.86a.6.6 0 01-.6.6H3.4a.6.6 0 01-.6-.6v-1.86a3.3 3.3 0 000-5.48V5.4a.6.6 0 01.6-.6h13.2a.6.6 0 01.6.6v1.86ZM7.1 6.1h1.8v1.8H7.1V6.1Zm0 3h1.8v1.8H7.1V9.1Zm0 3h1.8v1.8H7.1v-1.8Z';
  // Small action icons on Reddit's 20 px grid.
  /* Section and action symbols: one outline set on Reddit's 20 px grid (1.6 px strokes, round ends), so the rules,
     the two ways to draw and the result actions read as one family. */
  const GLYPHS={
    trophy:['M6.5 3.5h7v4.2a3.5 3.5 0 01-7 0V3.5Z','M6.5 5.2H4.2v1.1a2.6 2.6 0 002.6 2.6','M13.5 5.2h2.3v1.1a2.6 2.6 0 01-2.6 2.6','M10 11.2v3.3','M7 16.5h6'],
    comment:['M4.5 4h11A1.5 1.5 0 0117 5.5v7.2a1.5 1.5 0 01-1.5 1.5H9.2L5.8 17v-2.8H4.5A1.5 1.5 0 013 12.7V5.5A1.5 1.5 0 014.5 4Z'],
    person:['M10 9.2a3 3 0 100-6 3 3 0 000 6Z','M4.2 16.8a5.8 5.8 0 0111.6 0'],
    hash:['M8.2 3.5 6.8 16.5','M13.2 3.5l-1.4 13','M4 7.6h12.5','M3.5 12.4H16'],
    'person-minus':['M8.5 9.2a3 3 0 100-6 3 3 0 000 6Z','M3 16.8a5.5 5.5 0 019.5-3.8','M13 15h4.5'],
    shield:['M10 2.8l5.8 2.1v4.4c0 3.6-2.4 6.4-5.8 7.9-3.4-1.5-5.8-4.3-5.8-7.9V4.9L10 2.8Z','M7.4 9.9l1.8 1.8 3.5-3.6'],
    globe:['M10 17.2a7.2 7.2 0 100-14.4 7.2 7.2 0 000 14.4Z','M2.8 10h14.4','M10 2.8c1.9 2 2.9 4.4 2.9 7.2s-1 5.2-2.9 7.2c-1.9-2-2.9-4.4-2.9-7.2s1-5.2 2.9-7.2Z'],
    lock:['M5.8 8.8h8.4a1.2 1.2 0 011.2 1.2v5.6a1.2 1.2 0 01-1.2 1.2H5.8a1.2 1.2 0 01-1.2-1.2V10a1.2 1.2 0 011.2-1.2Z','M7.2 8.8V6.6a2.8 2.8 0 015.6 0v2.2','M10 12.2v1.6'],
    cake:['M4 10.5h12v5.3a1.2 1.2 0 01-1.2 1.2H5.2A1.2 1.2 0 014 15.8v-5.3Z','M4 13c1.3 0 1.3-1 2.7-1s1.3 1 2.6 1 1.3-1 2.7-1 1.3 1 2.7 1','M10 10.5V8','M10 6.2c.9-.6.9-1.7 0-2.7-.9 1-.9 2.1 0 2.7Z'],
    post:['M5.3 3h9.4A1.3 1.3 0 0116 4.3v11.4a1.3 1.3 0 01-1.3 1.3H5.3A1.3 1.3 0 014 15.7V4.3A1.3 1.3 0 015.3 3Z','M7 7.2h6','M7 10h6','M7 12.8h3.5'],
    copy:['M7.5 7.2h7.3A1.2 1.2 0 0116 8.4v7.4a1.2 1.2 0 01-1.2 1.2H7.5a1.2 1.2 0 01-1.2-1.2V8.4a1.2 1.2 0 011.2-1.2Z','M4.2 12.8V4.4a1.2 1.2 0 011.2-1.2h7.3']
  };
  function glyph(name,size=20){
    const svg=document.createElementNS(svgNS,'svg');
    for(const [k,v] of Object.entries({fill:'none',stroke:'currentColor','stroke-width':'1.6','stroke-linecap':'round','stroke-linejoin':'round',height:String(size),width:String(size),viewBox:'0 0 20 20','aria-hidden':'true'}))svg.setAttribute(k,v);
    svg.dataset.icon=name;for(const d of GLYPHS[name]){const path=document.createElementNS(svgNS,'path');path.setAttribute('d',d);svg.append(path);}return svg;
  }
  // Reddit Raffler's ticket mark (the logo without its wordmark, from redditraffler.com/assets/img/brand_white.svg),
  // filled with the current text colour so it suits light and dark themes.
  const RAFFLER_MARK=[
    'M95.37,56.64,91.1,57.78,92.87,83l2.78-.75A12.29,12.29,0,0,0,99.06,81a6.92,6.92,0,0,0,2.93-6.5l-.94-13.26Q100.62,55.24,95.37,56.64Z',
    'M158.21,107.75,133.52,15.61h0l.91,3.41L41.24,44a54,54,0,0,0,9.63,2.78l2.7,8.55L48.3,53.63a37.63,37.63,0,0,1-13-7.57l29.1,108.63,79-21.16A21,21,0,0,0,158.21,107.75Zm-49.39,22.34L95.23,94.22l-1.52.64,2.68,38.56L84.3,136.66,78.12,48.49l17.6-4.72q13.31-3.51,16.5,8.45a30.44,30.44,0,0,1,.91,5.79l1,13.26q.78,11.64-8.49,17.88l16.48,37.39Z',
    'M20.14,42.1c-2-.72-4.08-1.48-6.14-2.14a66.1,66.1,0,0,0-6.38-1.84,5.82,5.82,0,0,0-2.81.38c-.83.25-.87.75-.32,1.51a4.85,4.85,0,0,0,3.05,1.76C11.76,42.8,16,42.46,20.14,42.1Z',
    'M48.56,26.51a10.82,10.82,0,0,0,1.5-3,5.23,5.23,0,0,0-.21-2c-.62.11-1.4,0-1.81.35a14.82,14.82,0,0,0-3,3.29c-1.8,3-3.37,6.19-5.16,9.52C43.07,32.15,46.18,29.74,48.56,26.51Z',
    'M30.88,50.54a43.75,43.75,0,0,1-7,16.14s-.08.06-.17.11a33.12,33.12,0,0,0-3.41-7.72c-.12-.19,0-.66.18-.88A53,53,0,0,0,26.21,48L1.62,54.6,25.4,143.34a21,21,0,0,0,25.78,14.88l10.57-2.83-2.59.7Z',
    'M33.42,38.13c2.81-4.33,5.58-8.68,8.41-13a14.15,14.15,0,0,1,4.73-4.6c2.18-1.26,4-.62,5.14,1.82a7.31,7.31,0,0,1-.63,7.59,37.36,37.36,0,0,1-7.17,7.75l89-23.86A21.06,21.06,0,0,0,107.74.72L28.79,21.88l4.43,16.55Z',
    'M7.77,45.85A7.4,7.4,0,0,1,3,39.48a2.84,2.84,0,0,1,2.07-3A9.18,9.18,0,0,1,10,36c2.59.49,5.17,1.09,7.73,1.75,3.1.79,6.18,1.71,9.27,2.54a2,2,0,0,0,1.1-.05l-4.56-17-8,2.14a21,21,0,0,0-15.28,24l10.44-2.79C9.76,46.36,8.76,46.15,7.77,45.85Z'];
  function rafflerMark(size=16){
    const svg=document.createElementNS(svgNS,'svg');for(const [k,v] of Object.entries({fill:'currentColor',height:String(size),width:String(size),viewBox:'0 0 159 159','aria-hidden':'true'}))svg.setAttribute(k,v);
    svg.dataset.icon='raffler';for(const d of RAFFLER_MARK){const path=document.createElementNS(svgNS,'path');path.setAttribute('d',d);svg.append(path);}return svg;
  }
  const nameOK=/^[A-Za-z0-9_-]{3,20}$/;
  // Profile pictures only from Reddit's own image hosts.
  const safePicture=value=>{try{const url=new URL(String(value || ''));return url.protocol==='https:' && !url.username && !url.password && /(?:^|\.)(?:redditstatic\.com|redditmedia\.com|redd\.it)$/.test(url.hostname)?url.href:'';}catch{return '';}};
  const CLOSE='m11.273 10 5.363-5.363a.9.9 0 10-1.273-1.273L10 8.727 4.637 3.364a.9.9 0 10-1.273 1.273L8.727 10l-5.363 5.363a.9.9 0 101.274 1.273L10 11.273l5.363 5.363a.897.897 0 001.274 0 .9.9 0 000-1.273L11.275 10Z';
  const n=value=>Number(value).toLocaleString('en-US');

  // One date style for both kinds of results (the reader's locale and time zone).
  const dateText=seconds=>new Date(seconds*1000).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});
  // Reddit Raffler writes "November 15 2026, 1:07am" in UTC.
  const rafflerDate=text=>{const m=String(text || '').match(/^([A-Z][a-z]+) (\d{1,2}) (\d{4}), (\d{1,2}):(\d{2})([ap]m)$/);if(!m)return text || '';
    const month=['January','February','March','April','May','June','July','August','September','October','November','December'].indexOf(m[1]);if(month<0)return text;
    const hour=Number(m[4])%12+(m[6]==='pm'?12:0);return dateText(Date.UTC(Number(m[3]),month,Number(m[2]),hour,Number(m[5]))/1000);};
  // Page-bridge request with its own timeout (a raffle read can be slow on large threads).
  function bridgeRead(parameters,{signal,timeout=30000}={}){
    const channel='rt-raffle-'+crypto.randomUUID(),id=crypto.randomUUID();let timer;
    return new Promise((resolve,reject)=>{
      const finish=(error,result)=>{clearTimeout(timer);document.removeEventListener('rt-post-response',receive);signal?.removeEventListener('abort',cancel);error?reject(error):resolve(result);};
      const send=detail=>document.dispatchEvent(new CustomEvent('rt-post-request',{detail:JSON.stringify(detail)}));
      const cancel=()=>{send({channel,id,action:'cancel'});finish(Error('Request cancelled.'));};
      const receive=event=>{let response;try{response=JSON.parse(event.detail);}catch{return;}if(response.channel!==channel || response.id!==id)return;
        if(response.deferred){clearTimeout(timer);setTimeout(()=>{send({channel,id,...parameters});timer=setTimeout(expire,timeout);},Math.min(2000,Number(response.retryAfterMs) || 500));return;}
        finish(response.ok?null:Error(response.error || 'Reddit request failed.'),response);};
      const expire=()=>{send({channel,id,action:'cancel'});finish(Error('Reddit took too long to answer. Try again.'));};
      document.addEventListener('rt-post-response',receive);signal?.addEventListener('abort',cancel,{once:true});
      timer=setTimeout(expire,timeout);if(signal?.aborted){cancel();return;}send({channel,id,...parameters});
    });
  }
  // Reddit Raffler requests run in the extension worker (raffler-broker.js), which holds the host permission.
  async function defaultRaffler(message){const response=await chrome.runtime.sendMessage({scope:'rt-raffler',...message});if(!response?.ok)throw Object.assign(Error(response?.error || 'Reddit Raffler request failed.'),{code:response?.code});return response;}
  async function defaultSettings(){const response=await chrome.runtime.sendMessage({scope:'rt-posts',action:'get-settings'});if(!response?.ok)throw Error('Settings unavailable.');return response.settings;}
  // Reddit's default avatars, chosen the way Reddit does for users without one (0–7).
  const defaultAvatar=name=>'https://www.redditstatic.com/avatars/defaults/v2/avatar_default_'+([...String(name)].reduce((h,ch)=>(h*31+ch.charCodeAt(0))>>>0,7)%8)+'.png';
  const wait=(ms,signal)=>new Promise((resolve,reject)=>{const t=setTimeout(resolve,ms);signal?.addEventListener('abort',()=>{clearTimeout(t);reject(Error('Request cancelled.'));},{once:true});});

  class Raffle {
    constructor({read=bridgeRead,readSettings=defaultSettings,observe=true,random,raffler=defaultRaffler}={}){
      this.read=read;this.raffler=raffler;this.readSettings=readSettings;this.random=random;this.enabled=false;this.dead=false;this.dialog=null;
      if(observe){
        this.observer=new MutationObserver(records=>{
          const dom=globalThis.RTPostMenuDOM;
          if(dom?.onlyMenuChanges(records)){
            for(const menu of new Set(records.map(record=>record.target.closest?.(dom.inline)).filter(Boolean)))this.syncMenu(menu);
            this.dedupe();
          }else if(!this.queued){
            this.queued=true;
            queueMicrotask(()=>{this.queued=false;this.sync();});
          }
        });
        this.observer.observe(document.documentElement,{childList:true,subtree:true});
        this.onSettings=(changes,area)=>{if(area==='local' && changes['rt-settings-v1'])this.loadSettings();};
        this.onSettingsMessage=message=>{if(message?.scope==='rt-posts' && message.action==='settings-changed')this.loadSettings();};
        try{chrome.storage?.onChanged?.addListener(this.onSettings);}catch{}try{chrome.runtime?.onMessage?.addListener(this.onSettingsMessage);}catch{}
      }
      // Safety net: make sure the item exists the moment a post's ⋯ button is pressed, before Reddit draws the menu.
      this.onPress=event=>{
        if(!this.enabled || event.type==='keydown' && !['Enter',' '].includes(event.key))return;
        const menu=event.composedPath?.().find(node=>node?.tagName==='SHREDDIT-POST-OVERFLOW-MENU');
        if(menu){this.syncMenu(menu);this.menuStatus(menu);}
      };
      document.addEventListener('pointerdown',this.onPress,true);document.addEventListener('keydown',this.onPress,true);
      // Fetch the Reddit Raffler status as ⋯ is hovered or focused, so the menu usually opens with it already known.
      this.onNear=event=>{if(!this.enabled)return;const menu=event.composedPath?.().find(node=>node?.tagName==='SHREDDIT-POST-OVERFLOW-MENU');if(menu)this.menuStatus(menu);};
      document.addEventListener('pointerover',this.onNear,true);document.addEventListener('focusin',this.onNear,true);
      this.ready=this.loadSettings();
    }
    /* Settings decide whether the item shows. A failed read (the worker waking, or just reloaded) must not hide raffles
       for the page's whole life: keep the default (on) meanwhile and retry with backoff. */
    async loadSettings(attempt=0){
      clearTimeout(this.settingsRetry);let settings=null;try{settings=M.normalizeSettings(await this.readSettings());}catch{}
      if(this.dead)return;
      if(settings)this.enabled=Boolean(settings.raffles);
      else{this.enabled=M.normalizeSettings({}).raffles;if(attempt<6)this.settingsRetry=setTimeout(()=>this.loadSettings(attempt+1),Math.min(30000,1000*2**attempt));}
      this.sync();
    }
    destroy(){this.dead=true;clearTimeout(this.settingsRetry);document.removeEventListener('pointerdown',this.onPress,true);document.removeEventListener('keydown',this.onPress,true);document.removeEventListener('pointerover',this.onNear,true);document.removeEventListener('focusin',this.onNear,true);this.observer?.disconnect();try{chrome.storage?.onChanged?.removeListener(this.onSettings);}catch{}try{chrome.runtime?.onMessage?.removeListener(this.onSettingsMessage);}catch{}this.close(true);for(const item of document.querySelectorAll('[data-rt-raffle="item"]'))item.remove();}

    // One item per post menu, in the menu's own action slot (B1).
    sync(){
      if(this.dead)return;
      for(const menu of document.querySelectorAll('shreddit-post-overflow-menu'))this.syncMenu(menu);
      this.dedupe();
      if(!this.enabled)this.close(true);
    }
    syncMenu(menu){
      if(!menu.isConnected)return;
      const existing=menu.querySelector(':scope > [slot="devvit-context-actions"] [data-rt-raffle="item"]');
      if(!this.enabled){existing?.remove();return;}
      if(existing || !/^t3_[a-z0-9]{1,10}$/i.test(menu.getAttribute('post-id') || ''))return;
      let slot=menu.querySelector(':scope > [slot="devvit-context-actions"]');
      if(!slot){slot=make('div');slot.setAttribute('slot','devvit-context-actions');menu.append(slot);}
      slot.append(this.menuItem(menu));
    }
    dedupe(){
      const portal=document.getElementById('post-overflow-menu-bottom-sheet');if(!portal)return;
      if(!this.enabled){for(const item of portal.querySelectorAll('[data-rt-raffle="item"]'))item.remove();return;}
      const slots=[...portal.querySelectorAll('[slot="devvit-context-actions"]')];
      const keep=slots.find(slot=>slot.querySelector('shreddit-async-loader,hr,li:not([data-rt-raffle="item"])')) || slots[0];
      for(const slot of slots){
        const items=[...slot.querySelectorAll('[data-rt-raffle="item"]')];
        for(const item of items)if(slot!==keep || item!==items[0])item.remove();
      }
    }
    statusItems(menu){
      const id=String(menu.getAttribute('post-id') || '').replace(/^t3_/i,'').toLowerCase();
      const items=[...menu.querySelectorAll('[data-rt-raffle="item"]')];
      const portal=document.getElementById('post-overflow-menu-bottom-sheet');
      if(portal)items.push(...[...portal.querySelectorAll('[data-rt-raffle="item"]')].filter(item=>item.dataset.rtPostId===id));
      return items;
    }
    menuItem(menu){
      // Reddit's own menu-item markup (FINDINGS.md): li[role=presentation] > div[role=menuitem].
      const li=make('li','relative list-none mt-0');li.setAttribute('role','presentation');li.dataset.rtRaffle='item';li.dataset.rtUi='raffle-menu-item';li.dataset.rtPostId=String(menu.getAttribute('post-id') || '').replace(/^t3_/i,'').toLowerCase();
      const row=make('div','flex justify-between relative px-md gap-xs text-secondary-plain hover:text-secondary-plain-hover active:bg-interactive-pressed hover:bg-neutral-background-hover hover:no-underline cursor-pointer py-2xs -outline-offset-1');
      row.setAttribute('role','menuitem');row.tabIndex=-1;row.style.paddingInlineEnd='16px';
      const lead=make('span','flex items-center gap-xs min-w-0 shrink'),box=make('span','flex shrink-0 items-center justify-center h-xl w-xl text-20 leading-4');box.append(icon(TICKET));
      // Two lines from the start (label and caption), shown as Reddit's skeleton until the Reddit Raffler status is
      // known, so the final wording replaces the skeleton without changing the item's height.
      const text=make('span','flex flex-col justify-center min-w-0 shrink py-[0.375rem]');text.append(make('span','text-body-2','Run a raffle'),make('span','text-caption-1 text-secondary-plain-weak','Pick winners from the comments'));
      const tail=make('span','flex items-center shrink-0');tail.append(make('span','flex items-center justify-center h-lg'));
      lead.append(box,text);row.append(lead,tail);li.append(row);li.dataset.rtRaffleState='loading';row.setAttribute('aria-busy','true');
      const id=String(menu.getAttribute('post-id') || '').replace(/^t3_/i,'').toLowerCase();this.applyStatus(li,this.raffleStatus?.get(id)?.status);
      const choose=event=>{event.preventDefault();event.stopPropagation();
        const trigger=menu.querySelector('button[aria-haspopup]');if(trigger?.getAttribute('aria-expanded')==='true')trigger.click();
        this.open(this.postOf(menu),trigger);};
      row.addEventListener('click',choose);row.addEventListener('keydown',event=>{if(event.key==='Enter' || event.key===' ')choose(event);});
      return li;
    }
    /* A post's Reddit Raffler status: "View raffle results" when a public raffle exists, otherwise "Run a raffle".
       Checked as ⋯ is hovered, focused or pressed, at most once per post every 5 minutes; a failed check shows "Run a raffle". */
    async menuStatus(menu){
      if(!this.enabled)return;const id=String(menu.getAttribute('post-id') || '').replace(/^t3_/i,'').toLowerCase();if(!/^[a-z0-9]{1,10}$/.test(id))return;
      this.raffleStatus ||= new Map();const cached=this.raffleStatus.get(id);
      if(!cached || Date.now()-cached.at>300000){
        const entry={at:Date.now(),status:null};entry.pending=this.raffler({action:'status',postId:id}).then(r=>entry.status={exists:Boolean(r?.exists),verified:Boolean(r?.raffle?.verified)},()=>null);
        if(this.raffleStatus.size>=200)this.raffleStatus.delete(this.raffleStatus.keys().next().value);this.raffleStatus.set(id,entry);
      }
      const entry=this.raffleStatus.get(id),status=await entry?.pending;
      if(!status){if(this.raffleStatus.get(id)===entry)this.raffleStatus.delete(id);for(const item of this.statusItems(menu))this.applyStatus(item,{exists:false});return;}
      for(const item of this.statusItems(menu))this.applyStatus(item,status);
    }
    applyStatus(item,status){
      if(!item || !status)return;const drawn=Boolean(status.exists);
      item.querySelector('.text-body-2').textContent=drawn?'View raffle results':'Run a raffle';
      item.querySelector('.text-caption-1').textContent=drawn?'Drawn on Reddit Raffler'+(status.verified?' · verified':''):'Pick winners from the comments';
      item.dataset.rtRaffleState=drawn?'drawn':'none';item.querySelector('[role="menuitem"]').removeAttribute('aria-busy');
    }
    postOf(menu){
      const card=menu.closest('shreddit-post');
      return {id:menu.getAttribute('post-id').replace(/^t3_/i,'').toLowerCase(),author:menu.getAttribute('author-name') || card?.getAttribute('author') || '',
        subreddit:String(menu.getAttribute('subreddit-prefixed-name') || card?.getAttribute('subreddit-prefixed-name') || '').replace(/^r\//i,''),
        title:card?.getAttribute('post-title') || '',permalink:menu.getAttribute('permalink') || card?.getAttribute('permalink') || ''};
    }

    /* --- Dialog (docs/raffle-spec.md B2–B7). Three screens in Reddit's rpl-modal-card: rules, winners, message.
       Two ways to draw, chosen at the top: a public draw on Reddit Raffler (permanent results page, one per post) or a
       private draw here (not recorded, can be redone). Rules use Reddit's settings rows (FINDINGS.md). Revised
       2026-11-15 after an independent review (clear choice, one main action, exists-state, phone fixes, a11y). */
    open(post,trigger=null){
      this.close(true);
      const media=globalThis.matchMedia?.(MOBILE),narrow=media?.matches===true;
      const dialog=make('dialog','rt-raffle-dialog'+(narrow?' rt-raffle-sheet':''));dialog.dataset.rtRaffle='dialog';dialog.setAttribute('aria-labelledby','rt-raffle-title');
      const card=make('rpl-modal-card','rt-raffle-card');card.setAttribute('appearance',narrow?'bottom-sheet':'modal');
      // Header: the post as a small kicker above the title (the redaction dialog uses the same header).
      const head=make('div','rt-dialog-head');head.slot='title';const h2=make('h2','rt-dialog-title m-0 text-neutral-content-strong','Run a raffle');h2.id='rt-raffle-title';h2.tabIndex=-1;
      const postLine=make('p','rt-dialog-kicker rt-raffle-post m-0');if(post.subreddit)postLine.append(make('span','rt-raffle-post-sub','r/'+post.subreddit),make('span','rt-raffle-post-dot','•'));postLine.append(make('span','rt-raffle-post-title',post.title || 'Post '+post.id));
      head.append(postLine,h2);
      const close=make('button','rt-dialog-close button-small button-secondary icon items-center justify-center button inline-flex');close.type='button';close.slot='close-button';close.setAttribute('aria-label','Close');close.append(icon(CLOSE,16));
      const body=make('div','rt-raffle-body');
      // One polite live region for announcements that matter (reading done, errors, copy, sending), not every keystroke.
      const announce=make('p','rt-raffle-sr');announce.setAttribute('role','status');announce.setAttribute('aria-live','polite');
      // Rules screen.
      const rulesView=make('div','rt-raffle-view');rulesView.dataset.rtRaffleView='rules';
      const chooser=make('div','rt-raffle-choice');chooser.setAttribute('role','radiogroup');chooser.setAttribute('aria-label','How to draw');
      const option=(value,title,caption,symbol)=>{const label=make('label','rt-raffle-option');label.dataset.rtMode=value;const radio=make('input');radio.type='radio';radio.name='rt-raffle-draw';radio.value=value;
        const text=make('span','rt-raffle-option-text');const titleRow=make('span','rt-raffle-option-head');const mark=make('span','rt-raffle-option-icon');mark.append(glyph(symbol,18));titleRow.append(mark,make('span','rt-raffle-option-title',title));
        text.append(titleRow,make('span','rt-raffle-option-caption',caption));label.append(radio,text);chooser.append(label);return {label,radio};};
      // Two equal cards with one short line each; Reddit Raffler's status (sign-in, existing raffle) sits under both.
      const publicOption=option('public','Public draw','Results page anyone can check','globe');
      const privateOption=option('private','Private draw','Only you see the winners','lock');
      publicOption.sub=make('p','rt-raffle-raffler-state m-0');
      const status=make('p','rt-raffle-status m-0');
      const progress=make('div','rt-raffle-progress');progress.setAttribute('aria-hidden','true');progress.append(make('span'));
      const statusBox=make('div','rt-raffle-status-card');statusBox.append(status,progress);
      const form=make('form','rt-raffle-form');form.noValidate=true;
      const symbolBox=name=>{const box=make('span','rt-raffle-row-icon');box.append(glyph(name,18));return box;};
      const row=(label,caption,control,{forId,name,symbol}={})=>{const wrap=make(forId?'label':'div','rt-raffle-row');if(forId)wrap.htmlFor=forId;if(name)wrap.dataset.rtRow=name;const text=make('span','rt-raffle-row-text');text.append(make('span','rt-raffle-row-label',label));const cap=make('span','rt-raffle-row-caption',caption);text.append(cap);const ctl=make('span','rt-raffle-row-control');ctl.append(control);if(symbol)wrap.append(symbolBox(symbol));wrap.append(text,ctl);return wrap;};
      // Text-like fields stack under their label at full width, as in the redaction dialog.
      const stacked=(label,caption,control,{name,symbol,tag='div'})=>{const wrap=make(tag,'rt-raffle-row rt-raffle-row-stacked');wrap.dataset.rtRow=name;const head=make('span','rt-raffle-row-head'),text=make('span','rt-raffle-row-text');text.append(make('span','rt-raffle-row-label',label),make('span','rt-raffle-row-caption',caption));head.append(symbolBox(symbol),text);wrap.append(head,...[].concat(control));return wrap;};
      const toggle=(name,checked,label)=>{const wrap=make('span','rt-switch');const input=make('input');input.type='checkbox';input.name=name;input.id='rt-raffle-'+name;input.checked=checked;input.setAttribute('role','switch');input.setAttribute('aria-label',label);const track=make('span','rt-switch-track');track.append(make('span','rt-switch-knob'));wrap.append(input,track);return wrap;};
      const number=(name,value,min,max,label)=>{const input=make('input','rt-raffle-input');input.type='number';input.name=name;input.value=String(value);input.min=String(min);input.max=String(max);input.inputMode='numeric';input.setAttribute('aria-label',label);return input;};
      const text=(name,placeholder,label)=>{const input=make('input','rt-raffle-input rt-raffle-text');input.type='text';input.name=name;input.placeholder=placeholder;input.maxLength=100;input.autocomplete='off';input.setAttribute('aria-label',label);return input;};
      // Exclude users: the redaction dialog's menu control, opening a list of the post's commenters (openUsers).
      const users=make('button','rt-redact-control'),usersCaption=make('span','rt-redact-control-value','No one excluded'),usersInput=make('input');
      users.type='button';users.dataset.rtRaffleFilter='excludeUsers';users.setAttribute('aria-label','Exclude users');users.setAttribute('aria-haspopup','menu');users.setAttribute('aria-expanded','false');users.append(usersCaption,F.svgIcon('caret-down',16));
      usersInput.type='hidden';usersInput.name='excludeUsers';users.addEventListener('click',()=>this.openUsers());
      const winners=number('winners',1,1,R.MAX_WINNERS,'Number of winners');winners.classList.add('rt-raffle-count');
      const stepper=make('span','rt-raffle-stepper');const minus=make('button','rt-raffle-step','−'),plus=make('button','rt-raffle-step','+');
      for(const [b,label,delta] of [[minus,'Fewer winners',-1],[plus,'More winners',1]]){b.type='button';b.setAttribute('aria-label',label);b.addEventListener('click',()=>{winners.value=String(Math.min(R.MAX_WINNERS,Math.max(1,(Number(winners.value) || 1)+delta)));winners.dispatchEvent(new Event('input',{bubbles:true}));});}
      stepper.append(minus,winners,plus);
      // Always shown (not a collapsible): the minimums are part of the rules.
      const account=make('div','rt-raffle-account');const summary=make('div','rt-raffle-row');const sumText=make('span','rt-raffle-row-text');sumText.append(make('span','rt-raffle-row-label','Account requirements'));const accountHint=make('span','rt-raffle-row-caption','None');sumText.append(accountHint);summary.append(symbolBox('shield'),sumText);
      const grid=make('div','rt-raffle-grid');
      for(const [name,label,max] of [['minAccountAgeDays','Account age (days)',36500],['minCommentKarma','Comment karma',1e9],['minPostKarma','Post karma',1e9],['minTotalKarma','Total karma',1e9]]){const field=make('label','rt-raffle-mini');field.append(make('span','rt-raffle-row-caption',label),number(name,0,0,max,'Minimum '+label.toLowerCase()));grid.append(field);}
      account.append(summary,grid);
      const winnersRow=row('Winners','Between 1 and '+R.MAX_WINNERS,stepper,{name:'winners',symbol:'trophy'});
      form.append(winnersRow,
        row('Top-level comments only','Replies don’t count as entries',toggle('topLevelOnly',true,'Top-level comments only'),{forId:'rt-raffle-topLevelOnly',name:'topLevelOnly',symbol:'comment'}),
        row('Exclude the post’s author','',toggle('excludeAuthor',true,'Exclude the post’s author'),{forId:'rt-raffle-excludeAuthor',name:'excludeAuthor',symbol:'person'}),
        stacked('Comment must include','Empty accepts any comment',text('mustInclude','Code word','Comment must include'),{name:'mustInclude',symbol:'hash',tag:'label'}),
        stacked('Exclude users','Pick commenters or enter a username',[users,usersInput],{name:'excludeUsers',symbol:'person-minus'}),account);
      // Consent to draw from an incomplete read: a checkbox, not a switch.
      const ackRow=make('label','rt-raffle-ack');const ack=make('input');ack.type='checkbox';ack.name='acknowledge';ackRow.append(ack,make('span','','Draw from the comments read (Reddit didn’t return every comment)'));ackRow.hidden=true;
      rulesView.append(chooser,publicOption.sub,statusBox,form,ackRow);
      const resultsView=make('section','rt-raffle-view rt-raffle-results');resultsView.dataset.rtRaffleView='results';resultsView.hidden=true;resultsView.setAttribute('aria-label','Winners');
      const messageView=make('section','rt-raffle-view rt-raffle-message');messageView.dataset.rtRaffleView='message';messageView.hidden=true;messageView.setAttribute('aria-label','Message winners');
      body.append(rulesView,resultsView,messageView,announce);
      // Footer: one main action per screen; a note beside it carries warnings (kept in view on phones).
      const button=(label,slot,kind)=>{const b=make('button','button-medium button-'+kind+' button inline-flex items-center justify-center px-md',label);b.type='button';b.slot=slot;return b;};
      const note=make('p','rt-raffle-footnote m-0');note.slot='tertiary-button';
      const drawButton=button('Run public draw','primary-button','primary');drawButton.disabled=true;drawButton.classList.add('rt-raffle-draw-icon');
      const back=button('Back to rules','tertiary-button','plain'),again=button('Draw again','secondary-button','secondary'),message=button('Message winners','primary-button','primary');message.classList.add('rt-raffle-chat-icon');
      const msgBack=button('Back','secondary-button','secondary'),send=button('Send','primary-button','primary');
      again.classList.add('rt-raffle-draw-icon');
      const views={rules:[drawButton],results:[back,again,message],message:[msgBack,send]};
      for(const b of [...views.results,...views.message])b.hidden=true;
      card.append(head,close,body,note,drawButton,back,again,message,msgBack,send);dialog.append(card);document.body.append(dialog);
      // Below 640 px Reddit's card stacks its button group; a secondary button moved to the leading slot sits on the
      // same line as the main one instead (the footer becomes a row in post-discovery.css).
      for(const b of [again,msgBack])b.dataset.rtSlot=b.slot;
      const footerSlots=small=>{for(const b of [again,msgBack])b.slot=small?'tertiary-button':b.dataset.rtSlot;};footerSlots(narrow);
      const state=this.dialog={dialog,card,post,trigger,h2,form,winners,usersControl:users,usersCaption,winnersRow,minus,plus,status,statusCard:statusBox,progress,accountHint,announce,note,ack,ackWrap:ackRow,rulesView,resultsView,messageView,views,
        drawButton,draw:drawButton,back,message,again,msgBack,send,publicOption,privateOption,mode:'public',
        raffler:{phase:'checking',signedIn:'',me:'',raffle:null,confirm:false,error:'',progress:'',override:false},
        controller:new AbortController(),entries:new Map(),coverage:null,reading:false,privateReady:false,preparing:false,drawing:false,accounts:new Map(),generation:0,view:'rules',result:null,chat:null,draws:0,againConfirm:false,closeAsked:false,touched:false};
      // Phone ↔ desktop follows rotation and resizing (Reddit's bottom sheet below 640 px).
      state.onMedia=()=>{const small=media.matches;dialog.classList.toggle('rt-raffle-sheet',small);card.setAttribute('appearance',small?'bottom-sheet':'modal');footerSlots(small);};media?.addEventListener?.('change',state.onMedia);state.media=media;
      const finish=()=>this.close();
      close.addEventListener('click',finish);
      dialog.addEventListener('cancel',event=>{event.preventDefault();if(state.popup)this.closeUsers();else finish();});
      // A stray click on the dim backdrop never throws away results or interrupts sending.
      dialog.addEventListener('click',event=>{if(event.target===dialog && !state.result && !state.chat?.sending)finish();});
      for(const {radio} of [publicOption,privateOption])radio.addEventListener('change',()=>{if(radio.checked)this.setMode(radio.value,{user:true});});
      form.addEventListener('input',event=>{state.touched=true;state.raffler.confirm=false;this.setNote('');if(event.target.name!=='winners')state.qualifiedRange=null;if(event.target.name==='topLevelOnly'){state.privateReady=false;state.coverage=null;state.pool=null;}if(event.target.name==='excludeUsers')this.syncUsersCaption();this.updateSummary();});
      form.addEventListener('change',event=>{if(event.target.name!=='topLevelOnly')this.updateSummary();});
      form.addEventListener('submit',event=>{event.preventDefault();this.primaryAction();});
      ack.addEventListener('change',()=>this.updateSummary());
      drawButton.addEventListener('click',()=>this.primaryAction());again.addEventListener('click',()=>this.drawAgain());
      back.addEventListener('click',()=>{this.showView('rules');});
      message.addEventListener('click',()=>this.openMessage());
      msgBack.addEventListener('click',()=>{if(!state.chat?.sending)this.showView('results');});send.addEventListener('click',()=>this.sendMessages());
      try{dialog.showModal();}catch{dialog.setAttribute('open','');}
      // Focus the heading, not a field: no focus ring, and no phone keyboard over the sheet.
      h2.focus({preventScroll:true});
      this.setMode('public');this.checkRaffler();
      return state;
    }
    setMode(mode,{user=false}={}){
      const state=this.dialog;if(!state)return;state.mode=mode;state.raffler.confirm=false;if(user)state.touched=true;
      state.publicOption.radio.checked=mode==='public';state.privateOption.radio.checked=mode==='private';
      state.publicOption.label.dataset.selected=String(mode==='public');state.privateOption.label.dataset.selected=String(mode==='private');
      this.updateSummary();
    }
    showView(view){
      const state=this.dialog;if(!state)return;this.closeUsers(false);state.view=view;state.raffler.confirm=false;state.againConfirm=false;state.closeAsked=false;
      for(const name of ['rules','results','message']){state[name+'View'].hidden=name!==view;for(const b of state.views[name])b.hidden=name!==view;}
      if(view==='results' && state.result?.official)state.again.hidden=true;
      if(view==='results')state.back.textContent='Back to rules';
      state.h2.textContent={rules:'Run a raffle',results:'Winners',message:'Message winners'}[view];
      this.setNote('');
      (view==='rules'?state.h2:state[view+'View'].querySelector('[tabindex="-1"]') || state.h2)?.focus?.({preventScroll:true});
      this.updateSummary();if(view==='message')this.syncSend();
    }
    setNote(text,{alert=false}={}){const note=this.dialog?.note;if(!note)return;if(note.textContent!==text)note.textContent=text;note.dataset.alert=String(alert);note.hidden=!text;if(text)note.scrollIntoView?.({block:'nearest'});}
    say(text){const a=this.dialog?.announce;if(a && text && a.textContent!==text)a.textContent=text;}
    close(force=false){
      const state=this.dialog;if(!state)return;
      // Private results exist only here: the first close asks, unless they were copied or messaged.
      if(!force && state.result && !state.result.official && !state.saved && !state.closeAsked){state.closeAsked=true;this.setNote('These winners aren’t saved anywhere. Copy them first, or close again to discard.',{alert:true});return;}
      if(!force && state.chat?.sending){this.setNote('Messages are still sending. Wait for them to finish.',{alert:true});return;}
      this.closeUsers(false);this.dialog=null;state.controller.abort();state.media?.removeEventListener?.('change',state.onMedia);
      if(state.onSignInReturn)window.removeEventListener('focus',state.onSignInReturn);
      try{state.dialog.close();}catch{}state.dialog.remove();
      if(state.trigger?.isConnected)state.trigger.focus({preventScroll:true});
    }
    rules(){const state=this.dialog,raw={};for(const el of state.form.elements)if(el.name && el.type!=='checkbox' && el.type!=='button')raw[el.name]=el.value;raw.topLevelOnly=state.form.elements.topLevelOnly.checked;raw.excludeAuthor=state.form.elements.excludeAuthor.checked;return R.normalizeRules(raw);}

    /* B3/B4: the thread JSON first (one request, up to 500 top-level comments). When Reddit has more, read them the
       way Reddit's client does (raffle-tree: the comments partial, then its "more comments" chain) until the chain
       ends, which is where a person scrolling reaches the bottom. The JSON's "more" placeholder lists replies too,
       so it is only a signal that more exist, never the expected count (measured 2026-11-14). */
    async readEntries(){
      const state=this.dialog;if(!state)return;
      const generation=++state.generation,topLevelOnly=state.form.elements.topLevelOnly.checked,signal=state.controller.signal,current=()=>this.dialog===state && state.generation===generation;
      state.reading=true;state.privateReady=false;state.scanTopLevel=topLevelOnly;state.qualifiedRange=null;state.pool=null;state.ack.checked=false;state.error='';state.entries=new Map();state.coverage=null;this.updateSummary('Reading comments…');
      const add=list=>{for(const raw of list || []){const item=R.entry(raw,{postId:state.post.id});if(!item)continue;const seen=state.entries.get(item.id);if(!seen)state.entries.set(item.id,item);else if(!seen.avatar && item.avatar)seen.avatar=item.avatar;}};
      const topCount=()=>{let count=0;for(const e of state.entries.values())if(e.topLevel)count++;return count;};
      const tree=async loader=>{for(let attempt=0;;attempt++){const page=await this.read({action:'raffle-tree',postId:state.post.id,subreddit:state.post.subreddit,loader},{signal,timeout:45000});
        if(!page.rateLimited)return page;if(attempt>=3)throw Object.assign(Error('Reddit kept asking us to slow down.'),{rateLimited:true});
        this.updateSummary('Reddit asked us to slow down · waiting…');await wait(Math.max(1000,Number(page.retryAfterMs) || 30000),signal);}};
      try{
        const thread=await this.thread(topLevelOnly);if(!current())return;
        for(const key of ['author','subreddit','title'])if(thread.post?.[key] && !state.post[key])state.post[key]=thread.post[key];if(thread.post?.author)state.post.author=thread.post.author;
        state.post.numComments=Number(thread.post?.numComments) || 0;
        add(thread.entries);
        const needTop=(thread.missingTopLevel || []).length>0,needReplies=!topLevelOnly && Number(thread.missingReplies)>0;
        // stop: 'end' (Reddit's chain finished), 'cap', 'error' or 'rate-limited'.
        let stop='end',stopError='',repliesLeft=0,pages=0;
        if(needTop || needReplies){
          const replies=[];
          const step=page=>{add(page.entries);const loaders=page.loaders || [];if(!topLevelOnly)replies.push(...loaders.filter(l=>!l.topLevel));return needTop?loaders.filter(l=>l.topLevel).pop() || null:null;};
          try{
            let next=step(await tree(null));if(!current())return;pages++;
            while(next){
              if(pages>=TOP_PAGES){stop='cap';break;}
              this.updateSummary('Reading comments… '+n(topCount())+' so far');
              next=step(await tree(next));if(!current())return;pages++;
            }
            // "More replies" threads, two at a time, when replies count as entries.
            let requests=0;const seenLoader=new Set();
            while(replies.length){
              if(requests>=REPLY_REQUESTS){if(stop==='end')stop='cap';break;}
              const batch=replies.splice(0,REPLY_PARALLEL).filter(l=>!seenLoader.has(l.src+'#'+l.cursor));for(const l of batch)seenLoader.add(l.src+'#'+l.cursor);
              const results=await Promise.all(batch.map(l=>tree(l)));if(!current())return;requests+=batch.length;
              for(const page of results){add(page.entries);replies.push(...(page.loaders || []).filter(l=>!l.topLevel));}
              this.updateSummary('Reading replies… '+n(state.entries.size)+' comments so far');
            }
            repliesLeft=replies.length;
          }catch(error){
            // Keep what was read; the read is incomplete, never failed outright.
            if(!current() || signal.aborted)return;stop=error.rateLimited?'rate-limited':'error';stopError=error.message;
          }
        }
        state.coverage={topLevelRead:topCount(),stop,stopError,repliesLeft,topLevelOnly,replies:state.entries.size-topCount(),numComments:state.post.numComments};
      }catch(error){if(current())state.error=error.message;}
      finally{if(current()){state.reading=false;state.privateReady=!state.error;this.updateSummary();this.say(state.error?'Couldn’t read the comments.':this.countText());}}
    }
    /* The thread JSON (one request), shared by user suggestions and the private draw: kept for two minutes, so
       suggesting names and then drawing reads the thread once. A failed read is never kept. */
    thread(topLevelOnly){
      const state=this.dialog;state.threads ||= new Map();const key=String(Boolean(topLevelOnly)),cached=state.threads.get(key);
      if(cached && Date.now()-cached.at<120000)return cached.pending;
      const entry={at:Date.now()};entry.pending=this.read({action:'raffle-thread',postId:state.post.id,topLevelOnly:Boolean(topLevelOnly)},{signal:state.controller.signal,timeout:45000}).catch(error=>{if(state.threads.get(key)===entry)state.threads.delete(key);throw error;});
      state.threads.set(key,entry);return entry.pending;
    }
    // Commenters to suggest for Exclude users: from the comments already read, else from the thread JSON.
    commenters(){
      const state=this.dialog,rules=this.rules(),author=String(state.post.author || '').toLowerCase(),people=new Map();
      const source=state.entries.size?[...state.entries.values()]:[...this.pageCommenters(),...(state.suggestEntries || [])];
      for(const entry of source){const name=entry?.author;if(!nameOK.test(name || '') || name==='AutoModerator' || rules.excludeAuthor && name.toLowerCase()===author)continue;
        const key=name.toLowerCase(),seen=people.get(key);if(seen){seen.count++;if(!seen.avatar && entry.avatar)seen.avatar=entry.avatar;}else people.set(key,{author:name,avatar:entry.avatar || '',count:1});}
      for(const person of people.values())if(!person.avatar)person.avatar=state.pictures?.get(person.author.toLowerCase()) || '';
      return [...people.values()];
    }
    /* Pictures for commenters the page hasn't drawn (the thread JSON has none): looked up only for rows that are shown,
       with the extension's cached avatar read, at most 60 per dialog and kept for the dialog. */
    loadPicture(name){
      const state=this.dialog,key=name.toLowerCase();if(!state)return;state.pictures ||= new Map();state.picturePending ||= new Set();
      if(state.pictures.has(key) || state.picturePending.has(key) || state.picturePending.size+state.pictures.size>=60)return;
      state.picturePending.add(key);
      this.read({action:'user-avatar',username:name},{signal:state.controller.signal,timeout:10000}).then(result=>safePicture(result?.avatar),()=>'').then(url=>{
        if(this.dialog!==state)return;state.picturePending.delete(key);state.pictures.set(key,url);if(!url)return;
        for(const img of state.dialog.querySelectorAll('[data-rt-avatar-for="'+CSS.escape(name)+'"] img'))img.src=url;
      });
    }
    // Commenters Reddit has already drawn on this page for this post (no request): top-level ones unless replies count.
    pageCommenters(){
      const state=this.dialog,topLevelOnly=state.form.elements.topLevelOnly.checked,out=[];
      for(const el of document.querySelectorAll('shreddit-comment[author]')){const post=String(el.getAttribute('postid') || '').replace(/^t3_/i,'').toLowerCase();if(post && post!==state.post.id)continue;if(topLevelOnly && Number(el.getAttribute('depth') || 0)!==0)continue;out.push({author:el.getAttribute('author'),avatar:safePicture(el.getAttribute('avatar'))});}
      return out;
    }
    async loadCommenters(){
      const state=this.dialog;if(!state || state.entries.size || state.suggestEntries || state.suggestLoading)return;
      state.suggestLoading=true;state.suggestFailed=false;state.popup?.render?.();
      try{const thread=await this.thread(state.form.elements.topLevelOnly.checked);if(this.dialog!==state)return;state.suggestEntries=(thread.entries || []).map(raw=>R.entry(raw,{postId:state.post.id})).filter(Boolean);}
      catch{if(this.dialog===state)state.suggestFailed=true;}
      finally{if(this.dialog===state){state.suggestLoading=false;state.popup?.render?.();}}
    }
    syncUsersCaption(){const state=this.dialog,names=String(state.form.elements.excludeUsers.value || '').split(/\s+/).filter(Boolean);state.usersCaption.textContent=!names.length?'No one excluded':names.length===1?'u/'+names[0]:n(names.length)+' users';
      if(names.length)state.usersControl.title=names.map(name=>'u/'+name).join(', ');else state.usersControl.removeAttribute('title');}
    // Copied results list each winner's account facts once they are known (as Reddit Raffler's page does).
    syncMarkdown(){
      const state=this.dialog;if(!state?.result || state.markdownBase==null)return;const lines=state.markdownBase.split('\n');
      state.result.winners.forEach((w,i)=>{if(!Number.isFinite(w.accountAgeDays))return;const at=lines.findIndex(line=>line.startsWith((i+1)+'. u/'+w.author));if(at>=0)lines[at]+=' · '+n(w.accountAgeDays)+' '+(w.accountAgeDays===1?'day':'days')+' old, '+n(w.commentKarma ?? 0)+' comment karma, '+n(w.linkKarma ?? 0)+' post karma';});
      state.markdown=lines.join('\n');state.resultsView.dataset.markdown=state.markdown;
    }
    /* Exclude users menu, built like the redaction dialog's community menus (same popover, search field and rows):
       picked names first, then the post's commenters; an exact username can be added from the search field. */
    openUsers(){
      const state=this.dialog;if(!state)return;if(state.popup){this.closeUsers();return;}
      const button=state.usersControl,input=state.form.elements.excludeUsers;
      const menu=make('div','rt-redact-popover rt-raffle-users');menu.dataset.rtRaffleUsers='';menu.setAttribute('data-rt-feed-options','');menu.setAttribute('role','menu');menu.setAttribute('aria-label','Exclude users');menu.id='rt-raffle-users';
      const ctx=F.plainContext(kind=>F.svgIcon(kind),{role:'menuitemcheckbox'});
      const head=make('div','rt-sub-head'),field=make('div','rt-filter-field'),search=make('input','rt-filter-search'),clear=make('button','rt-filter-search-clear');
      search.type='search';search.placeholder='Search or enter u/name';search.autocomplete='off';search.maxLength=24;search.setAttribute('aria-label','Search commenters or enter a username');
      clear.type='button';clear.hidden=true;clear.setAttribute('aria-label','Clear user search');clear.append(F.svgIcon('close',14));field.append(F.svgIcon('search',18),search,clear);head.append(field);
      const list=make('div','rt-sub-list');list.setAttribute('role','group');list.setAttribute('aria-label','Commenters');
      const note=make('p','rt-redact-suggestion-status text-12 text-neutral-content-weak');note.setAttribute('role','status');menu.append(head,list,note);
      const picked=()=>String(input.value || '').split(/\s+/).filter(Boolean);
      const term=()=>search.value.trim().replace(/^\/?u\//i,'');
      const toggle=name=>{const names=picked(),at=names.findIndex(v=>v.toLowerCase()===name.toLowerCase());if(at>=0)names.splice(at,1);else names.push(name);
        input.value=names.join(' ');input.dispatchEvent(new Event('input',{bubbles:true}));this.syncUsersCaption();render();search.focus({preventScroll:true});};
      const render=()=>{
        const people=this.commenters(),byKey=new Map(people.map(p=>[p.author.toLowerCase(),p])),chosen=picked(),chosenKeys=new Set(chosen.map(v=>v.toLowerCase())),q=term(),ql=q.toLowerCase();
        const rows=chosen.map(name=>byKey.get(name.toLowerCase()) || {author:name,avatar:'',count:0});
        if(nameOK.test(q) && !chosenKeys.has(ql) && !byKey.has(ql))rows.push({author:q,avatar:'',count:0,typed:true});
        rows.push(...people.filter(p=>!chosenKeys.has(p.author.toLowerCase()) && (!ql || p.author.toLowerCase().includes(ql))));
        clear.hidden=!search.value;const keep=list.scrollTop;list.replaceChildren();popup.watch?.disconnect();
        // Rows without a picture ask for one as they come into view (the first rows at once where that can't be watched).
        popup.watch=typeof IntersectionObserver==='function'?new IntersectionObserver(seen=>{for(const item of seen)if(item.isIntersecting){popup.watch.unobserve(item.target);this.loadPicture(item.target.dataset.rtUserRow);}},{root:list,rootMargin:'40px'}):null;let shown=0;
        for(const person of rows.slice(0,200)){
          const avatar=this.avatarEl(person,24);avatar.classList.add('rt-sub-icon-box');
          const row=F.menuOption(ctx,{label:'u/'+person.author,icon:avatar,checked:chosenKeys.has(person.author.toLowerCase()),value:person.author,tail:person.typed?'Add':person.count>1?n(person.count):'',slot:true,onSelect:()=>toggle(person.author)});
          row.dataset.rtUserRow=person.author;if(person.count>1)row.title=n(person.count)+' comments';list.append(row);
          if(!person.avatar){if(popup.watch)popup.watch.observe(row);else if(shown<8)this.loadPicture(person.author);}shown++;
        }
        if(!rows.length)list.append(make('div','rt-sub-empty',ql?'No commenters match. Enter a full username to add it.':'No commenters to suggest yet'));
        list.scrollTop=keep;const first=list.querySelector('[role^=menuitem]');if(first)first.tabIndex=0;
        note.textContent=state.suggestLoading?(rows.length?'Loading more commenters…':'Loading commenters…'):state.suggestFailed?'Couldn’t load commenters. Enter a username.':'';note.hidden=!note.textContent;
        this.placeUsers();
      };
      search.addEventListener('input',()=>{list.scrollTop=0;render();});
      clear.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();search.value='';render();search.focus({preventScroll:true});});
      menu.addEventListener('keydown',event=>{
        if(event.key==='Escape'){event.preventDefault();event.stopPropagation();this.closeUsers();return;}
        if(event.key==='Enter' && event.target===search){event.preventDefault();event.stopPropagation();const q=term().toLowerCase(),row=[...list.querySelectorAll('[data-rt-user-row]')].find(r=>r.dataset.rtUserRow.toLowerCase()===q);if(row)row.click();return;}
        if(!['ArrowDown','ArrowUp'].includes(event.key))return;
        const rows=[...list.querySelectorAll('[role^=menuitem]')];if(!rows.length)return;event.preventDefault();event.stopPropagation();
        const at=rows.indexOf(document.activeElement),next=at<0?(event.key==='ArrowUp'?rows.length-1:0):(at+(event.key==='ArrowUp'?-1:1)+rows.length)%rows.length;
        for(const r of rows)r.tabIndex=-1;rows[next].tabIndex=0;rows[next].focus({preventScroll:true});
      },true);
      const popup=state.popup={name:'excludeUsers',el:menu,button,render,watch:null};
      popup.place=()=>this.placeUsers();popup.outside=event=>{const path=event.composedPath();if(!path.includes(menu) && !path.includes(button))this.closeUsers(false);};
      // Reddit's scrollbox scrolls inside the card's shadow root, where scroll events don't reach the page: follow wheel and touch too.
      popup.follow=()=>requestAnimationFrame(popup.place);
      document.addEventListener('pointerdown',popup.outside,true);window.addEventListener('resize',popup.place);window.addEventListener('scroll',popup.place,true);state.dialog.addEventListener('wheel',popup.follow,{passive:true});state.dialog.addEventListener('touchmove',popup.follow,{passive:true});
      state.dialog.append(menu);button.setAttribute('aria-controls',menu.id);button.setAttribute('aria-expanded','true');
      render();search.focus({preventScroll:true});this.loadCommenters();
    }
    placeUsers(){
      const p=this.dialog?.popup;if(!p)return;if(!p.button.isConnected){this.closeUsers(false);return;}
      const a=p.button.getBoundingClientRect(),width=Math.min(256,innerWidth-16),below=innerHeight-a.bottom-12,above=a.top-12,up=below<200 && above>below,size=Math.min(260,Math.max(120,up?above:below));
      p.el.style.width=width+'px';p.el.style.maxHeight=size+'px';p.el.style.left=Math.max(8,Math.min(a.left,innerWidth-width-8))+'px';
      p.el.style.top=(up?Math.max(8,a.top-Math.min(p.el.getBoundingClientRect().height || size,size)-4):a.bottom+4)+'px';
    }
    closeUsers(restore=true){
      const state=this.dialog,p=state?.popup;if(!p)return;state.popup=null;
      document.removeEventListener('pointerdown',p.outside,true);window.removeEventListener('resize',p.place);window.removeEventListener('scroll',p.place,true);state.dialog.removeEventListener('wheel',p.follow);state.dialog.removeEventListener('touchmove',p.follow);
      p.watch?.disconnect();p.button.setAttribute('aria-expanded','false');p.el.remove();if(restore && p.button.isConnected)p.button.focus({preventScroll:true});
    }
    coverageText(){
      const state=this.dialog,c=state.coverage;if(!c)return '';
      const why={cap:'stopped at the reading limit',error:'Reddit stopped answering'+(c.stopError?' ('+c.stopError.replace(/\.$/,'')+')':''),'rate-limited':'Reddit kept asking us to slow down'}[c.stop];
      let text=(c.stop==='end'?'Read all ':'Read ')+n(c.topLevelRead)+' top-level '+(c.topLevelRead===1?'comment':'comments');
      if(!c.topLevelOnly)text+=' and '+n(c.replies)+' '+(c.replies===1?'reply':'replies');
      if(why)text+=' · '+why+', so some may be missing';
      else if(c.repliesLeft)text+=' · '+n(c.repliesLeft)+' reply threads weren’t read';
      if(c.numComments && c.topLevelOnly && c.numComments>c.topLevelRead)text+=' ('+n(c.numComments)+' in the thread, counting replies)';
      return text;
    }
    incomplete(){const c=this.dialog?.coverage;return Boolean(c && (c.stop!=='end' || c.repliesLeft));}
    poster(){const s=this.dialog;return Boolean(s?.raffler.me && s.post.author && s.raffler.me.toLowerCase()===s.post.author.toLowerCase());}
    unverifiedOwn(){const r=this.dialog?.raffler;return Boolean(r && r.phase==='exists' && r.raffle && !r.raffle.verified && this.poster());}
    runOurselves(){const s=this.dialog,r=s?.raffler;if(!s || !r || !this.unverifiedOwn())return;r.override=true;r.confirm=false;this.updateSummary();this.setNote('Run the public draw to create a verified raffle. Reddit Raffler allows one official raffle per post, so it may refuse.',{alert:true});}
    qualificationKey(){const {winners,...rules}=this.rules();return JSON.stringify(rules);}
    availableCount(){const state=this.dialog;if(!state?.pool)return 0;return state.qualifiedRange?.key===this.qualificationKey()?state.qualifiedRange.count:state.pool.candidates.length;}
    countText(){if(!this.dialog?.pool)return '';const k=this.availableCount();return this.dialog.mode==='public'?'Up to '+n(k)+' '+(k===1?'person':'people')+' can enter':n(k)+' '+(k===1?'person':'people')+' can win';}
    /* Rules Reddit Raffler can't follow (§4b). In public mode those rows are disabled with the reason beside them. */
    officialBlockers(){
      const rules=this.rules(),why=[];
      if(rules.minTotalKarma && (rules.minCommentKarma || rules.minPostKarma))why.push('takes either total karma or comment and post karma, not both');
      if(rules.excludeUsers.length>97)why.push('can ignore at most 100 users');
      return why;
    }
    updateSummary(message){
      const state=this.dialog;if(!state)return;
      const rules=this.rules(),pub=state.mode==='public',r=state.raffler;
      const active=[rules.minAccountAgeDays?rules.minAccountAgeDays+' days old':'',rules.minCommentKarma?n(rules.minCommentKarma)+' comment karma':'',rules.minPostKarma?n(rules.minPostKarma)+' post karma':'',rules.minTotalKarma?n(rules.minTotalKarma)+' total karma':''].filter(Boolean);
      const karmaConflict=pub && rules.minTotalKarma && (rules.minCommentKarma || rules.minPostKarma);
      state.accountHint.textContent=karmaConflict?'Reddit Raffler takes total karma or comment and post karma, not both':active.length?'At least '+active.join(', '):'None';
      state.accountHint.dataset.error=String(Boolean(karmaConflict));
      // Rows Reddit Raffler doesn't support: disabled in public mode, with the reason as their caption.
      const rowState=(name,unsupported,caption,normal)=>{const row=state.form.querySelector('[data-rt-row="'+name+'"]');if(!row)return;row.dataset.unsupported=String(unsupported);const control=row.querySelector('input');if(control)control.disabled=unsupported;row.querySelector('.rt-raffle-row-caption').textContent=unsupported?caption:normal;};
      rowState('topLevelOnly',pub,'Reddit Raffler only counts top-level comments','Replies don’t count as entries');
      rowState('mustInclude',pub,'Private draw only','Empty accepts any comment');
      // Winners stepper: bounds, and a warning when asking for more winners than people.
      const want=Number(state.winners.value),valid=Number.isInteger(want) && want>=1 && want<=R.MAX_WINNERS;
      state.minus.disabled=!valid || want<=1;state.plus.disabled=!valid || want>=R.MAX_WINNERS;
      const winnersCaption=state.winnersRow.querySelector('.rt-raffle-row-caption');
      // Status line: who can win (private) or who commented (public); the coverage detail only when it matters.
      let line='',detail='',tone='ready';
      if(state.error && !state.reading){line='Couldn’t read the comments';detail=state.error.replace(/\.$/,'');tone='error';}
      else if(message || state.reading){line=message || 'Reading comments…';tone='loading';}
      else if(!state.privateReady){state.pool=null;line=pub?'Public draw by Reddit Raffler':'Ready for a private draw';detail=pub?'Reddit Raffler reads comments and checks eligibility when you run the draw':'Click Draw privately to read comments and check eligibility';}
      else{
        // A public draw ignores the rows it can't follow (they stay as typed for a private draw).
        state.pool=R.candidates([...state.entries.values()],pub?{...rules,topLevelOnly:true,mustInclude:''}:rules,{postAuthor:state.post.author});
        line=this.countText();tone=!pub && this.incomplete()?'warning':'ready';
        if(tone==='warning')detail=this.coverageText();
        else if(pub)detail='Reddit Raffler reads the comments itself and disqualifies anyone with more than one';
        else if(R.needsAccount(rules))detail='Account minimums are checked during the draw';
      }
      if(state.status.dataset.line!==line+'|'+detail){state.status.dataset.line=line+'|'+detail;state.status.replaceChildren(make('strong','',line),...(detail?[document.createTextNode(' · '+detail)]:[]));}
      state.statusCard.dataset.state=tone;
      const eligible=this.availableCount();
      winnersCaption.textContent=!valid?'Enter a number from 1 to '+R.MAX_WINNERS:!pub && !state.reading && state.pool && want>eligible?'Only '+n(eligible)+' '+(eligible===1?'person':'people')+' can win':'Between 1 and '+R.MAX_WINNERS;
      winnersCaption.dataset.error=String(!valid || !pub && !state.reading && Boolean(state.pool) && want>eligible);
      state.ackWrap.hidden=pub || !this.incomplete();
      // Choice captions: Reddit Raffler's state on the public option.
      const sub=state.publicOption.sub,blockers=this.officialBlockers();
      sub.textContent=r.phase==='checking'?'Checking Reddit Raffler…':r.phase==='unavailable'?'Reddit Raffler isn’t responding. You can still draw privately.':r.phase==='exists'?'This post already has a public raffle. View its results here.':
        r.signedIn?'You’re signed in there as u/'+r.signedIn+(state.post.author && r.signedIn.toLowerCase()===state.post.author.toLowerCase()?', so it’s marked verified.':'; only the post’s author gets a verified mark.'):'As a guest (unverified).';
      sub.dataset.state=r.phase;sub.hidden=!pub;
      const busy=state.preparing || state.reading || state.drawing;
      state.publicOption.radio.disabled=r.phase==='unavailable' || busy;state.privateOption.radio.disabled=busy;
      if(r.phase==='unavailable'){const retry=make('button','rt-raffle-retry','Try again');retry.type='button';retry.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();r.phase='checking';this.updateSummary();this.checkRaffler();});sub.append(' ',retry);}
      const authorSignIn=this.unverifiedOwn() && (!r.signedIn || r.signedIn.toLowerCase()!==state.post.author.toLowerCase());
      if(authorSignIn || (!r.signedIn && ['none','error','unavailable'].includes(r.phase))){
        const signIn=make('a','rt-raffle-retry',authorSignIn?'Sign in as u/'+state.post.author:'Sign in with Reddit');
        signIn.href=r.loginUrl || 'https://www.redditraffler.com/raffles/new';signIn.target='_blank';signIn.rel='noopener noreferrer';signIn.title='Sign in to Reddit Raffler in a new tab';
        signIn.addEventListener('click',event=>{
          event.stopPropagation();
          if(state.onSignInReturn)window.removeEventListener('focus',state.onSignInReturn);
          state.onSignInReturn=()=>{window.removeEventListener('focus',state.onSignInReturn);if(this.dialog!==state || r.phase==='creating')return;r.phase='checking';this.updateSummary();this.checkRaffler();};
          window.addEventListener('focus',state.onSignInReturn);
        });sub.append(' ',signIn);
      }
      if(this.unverifiedOwn() && r.signedIn && r.signedIn.toLowerCase()===state.post.author.toLowerCase() && !r.override){
        const run=make('a','rt-raffle-retry','Run it yourself');run.href='#';run.title='Run a verified public draw as the post’s author';
        run.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();this.runOurselves();});sub.append(' ',run);
      }
      if(r.override && r.raffle){
        const view=make('a','rt-raffle-retry','View public results');view.href='#';view.title='Open the existing public results instead';
        view.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();this.showOfficial(r.raffle);});sub.append(' ',view);
      }
      if(r.phase==='unavailable' && pub){this.setMode('private');return;}
      // The one main action.
      const b=state.drawButton;
      if(pub){
        if(r.phase==='exists' && !r.override){b.textContent='View public results';b.disabled=!r.raffle;}
        else if(r.override){b.textContent=r.phase==='creating'?'Drawing…':r.confirm?'Confirm public draw':'Run it yourself';b.disabled=r.phase==='creating' || Boolean(blockers.length) || !valid;}
        else{b.textContent=r.phase==='creating'?'Drawing…':r.confirm?'Confirm public draw':'Run public draw';b.disabled=!['none','error'].includes(r.phase) || Boolean(blockers.length) || !valid;}
      }else{
        b.textContent=state.drawing?'Drawing…':state.reading?'Reading comments…':state.preparing?'Preparing draw…':'Draw privately';
        b.disabled=busy || !valid || state.privateReady && (!eligible || want>eligible || this.incomplete() && !state.ack.checked);
      }
      b.classList.toggle('rt-raffle-confirm',pub && r.confirm);
      if(state.view==='rules'){
        if(pub && r.phase==='creating')this.setNote(r.progress || 'Reddit Raffler is drawing…');
        else if(pub && r.phase==='error')this.setNote('Reddit Raffler: '+String(r.error).replace(/\.$/,'')+'.',{alert:true});
        else if(pub && r.confirm)this.setNote('This creates a permanent public page on redditraffler.com and can’t be redone.',{alert:true});
        else if(pub && blockers.length && (r.phase==='none' || r.override))this.setNote('Reddit Raffler '+blockers.join(', ')+'.');
        else if(pub && this.unverifiedOwn() && !r.override)this.setNote(r.signedIn && r.signedIn.toLowerCase()===state.post.author.toLowerCase()?'This raffle is unverified. Run it yourself to create a verified draw; Reddit Raffler allows one per post.':'This raffle is unverified. Sign in as u/'+state.post.author+' to run it yourself.');
        else if(pub)this.setNote('');
      }
      state.again.disabled=state.drawing || !eligible;
    }
    primaryAction(){const state=this.dialog;if(!state || state.drawButton.disabled)return;if(state.mode==='public')this.runOfficial();else this.drawWinners();}
    // B5: private draw.
    async drawWinners(){
      const state=this.dialog;if(!state || state.preparing || state.reading || state.drawing || state.chat?.sending)return;this.updateSummary();
      if(state.mode!=='private' && state.view==='rules')return;
      const rules=this.rules(),signal=state.controller.signal;state.preparing=true;state.form.inert=true;this.setNote('');this.updateSummary();
      try{
        if(!state.privateReady || state.scanTopLevel!==rules.topLevelOnly)await this.readEntries();
        if(this.dialog!==state || signal.aborted)return;this.updateSummary();
        if(state.error)return;
        if(this.incomplete() && !state.ack.checked){this.setNote('Some comments could not be read. Confirm that you want to draw from the loaded comments.',{alert:true});return;}
        const pool=state.pool,available=this.availableCount();
        if(!pool?.candidates.length || rules.winners>available){this.setNote(available?'Only '+n(available)+' '+(available===1?'person is':'people are')+' available. Choose between 1 and '+n(available)+' winners.':'No eligible entrants match these rules.',{alert:true});return;}
        state.drawing=true;this.updateSummary();
        const drawnAt=Math.floor(Date.now()/1000);
        const result=await R.draw(pool.candidates,rules,{lookup:name=>this.account(name),random:this.random,signal,onProgress:({checked})=>{if(this.dialog===state && state.view==='rules')this.setNote('Checking accounts… '+n(checked));}});
        if(this.dialog!==state || signal.aborted)return;
        if(result.shortBy){
          if(!result.skipped.unchecked)state.qualifiedRange={key:this.qualificationKey(),count:result.winners.length};
          this.setNote((result.winners.length?'Only '+n(result.winners.length)+' '+(result.winners.length===1?'eligible person was':'eligible people were')+' found. Choose between 1 and '+n(result.winners.length)+' winners.':'No eligible entrants match these rules.')+(result.skipped.unchecked?' Some accounts could not be checked; try again.':''),{alert:true});return;
        }
        if(this.dialog!==state)return;state.drawing=false;state.draws++;state.saved=false;state.result={...result,rules,drawnAt,draw:state.draws};state.chat=null;
        this.renderResults(result,rules,drawnAt);this.showView('results');this.fillAccounts(result.winners);this.say(n(result.winners.length)+' '+(result.winners.length===1?'winner':'winners')+' drawn.');
      }catch(error){if(this.dialog===state){state.drawing=false;this.setNote('The draw stopped: '+error.message.replace(/\.$/,'')+'.',{alert:true});}}
      finally{if(this.dialog===state){state.preparing=false;state.drawing=false;state.form.inert=false;this.updateSummary();state.message.disabled=!state.result?.winners.length;}}
    }
    // Drawing again replaces the winners: it asks once, and the results say which draw this is.
    drawAgain(){
      const state=this.dialog;if(!state || state.result?.official)return;
      if(!state.againConfirm){state.againConfirm=true;state.again.textContent='Confirm: replace these winners';this.setNote('A new draw replaces these winners. The results will say it’s draw '+(state.draws+1)+'.',{alert:true});return;}
      state.againConfirm=false;state.again.textContent='Draw again';this.drawWinners();
    }
    // Account facts (age, karma, picture, chat ID), read once per dialog.
    account(name){const state=this.dialog,key=name.toLowerCase();if(!state.accounts.has(key)){const pending=this.read({action:'raffle-user',username:name},{signal:state.controller.signal,timeout:20000}).catch(error=>{if(state.accounts.get(key)===pending)state.accounts.delete(key);throw error;});state.accounts.set(key,pending);}return state.accounts.get(key);}
    // Results header shared by both kinds: title and actions on one row, badge and details below at full width.
    resultsHeader({count,badge,verified,meta,proof}){
      const state=this.dialog,header=make('div','rt-raffle-banner'),top=make('div','rt-raffle-banner-row');
      const hero=make('span','rt-raffle-hero-icon');hero.setAttribute('aria-hidden','true');hero.append(glyph('trophy',22));
      const title=make('h3','rt-raffle-banner-title m-0',n(count)+' '+(count===1?'winner':'winners'));title.tabIndex=-1;
      const actions=make('div','rt-raffle-banner-actions');
      // Reddit's small secondary/plain buttons: icon + label, the label alone changes.
      const action=(tag,cls,label,symbol)=>{const el=make(tag,'rt-raffle-action '+cls+' button-small button inline-flex items-center justify-center');el.append(symbol==='raffler'?rafflerMark(16):glyph(symbol,16),make('span','rt-raffle-action-label',label));return el;};
      if(proof){const link=action('a','rt-raffle-proof button-secondary','View proof','raffler');link.href=proof;link.target='_blank';link.rel='noopener';link.title='Opens redditraffler.com in a new tab';actions.append(link);}
      const copy=action('button','rt-raffle-copy button-plain','Copy','copy');copy.type='button';const copyLabel=copy.querySelector('.rt-raffle-action-label');
      copy.addEventListener('click',async()=>{let ok=true;try{await navigator.clipboard.writeText(state.markdown || '');}catch{ok=false;}copyLabel.textContent=ok?'Copied':'Couldn’t copy';if(ok)state.saved=true;this.say(ok?'Results copied.':'Couldn’t copy the results.');setTimeout(()=>{if(copy.isConnected)copyLabel.textContent='Copy';},2000);});
      actions.append(copy);
      // Trophy, then the count over its badge and details; the actions sit at the end of the same row.
      const text=make('div','rt-raffle-banner-text'),info=make('div','rt-raffle-banner-info');if(badge)info.append(make('span','rt-raffle-badge'+(verified?' rt-raffle-verified':''),badge));info.append(make('span','rt-raffle-banner-meta',meta));
      text.append(title,info);top.append(hero,text,actions);header.append(top);
      return header;
    }
    // B6: private-draw winners as Reddit comment rows; each row opens its comment.
    renderResults(result,rules,drawnAt){
      const state=this.dialog,box=state.resultsView;box.replaceChildren();
      const eligible=result.poolSize,count=result.winners.length;
      box.append(this.resultsHeader({count,badge:'Private draw · not recorded',meta:'From '+n(eligible)+' eligible '+(eligible===1?'person':'people')+' · '+dateText(drawnAt)+(state.draws>1?' · draw '+n(state.draws):'')+(result.shortBy?' · only '+n(count)+' passed the rules':'')}));
      box.append(this.winnerList(result.winners));
      const reasons={age:'account too new',commentKarma:'comment karma too low',postKarma:'post karma too low',totalKarma:'total karma too low',suspended:'suspended',unavailable:'deleted or unavailable',unchecked:'couldn’t be checked'};
      const skipped=Object.entries(result.skipped).map(([key,value])=>n(value)+' '+(reasons[key] || key));
      box.append(this.details([this.coverageText(),'Random, one entry per person'+(state.draws>1?'; this is draw '+n(state.draws)+' on this page':''),...(skipped.length?['Skipped during the draw: '+skipped.join(', ')]:[]),'Rules: '+R.resultsMarkdown({winners:[],rules,poolSize:eligible,drawnAt}).split('Rules: ')[1].split('\n')[0]]));
      state.markdownBase=R.resultsMarkdown({winners:result.winners,rules,poolSize:eligible,drawnAt,postUrl:state.post.permalink?'https://www.reddit.com'+state.post.permalink:''})+(state.draws>1?'\nDraw '+state.draws+' (private, not recorded).':'\nPrivate draw, not recorded.');this.syncMarkdown();
    }
    details(lines){const details=make('details','rt-raffle-details');details.append(make('summary','','How this was drawn'));const facts=make('ul','rt-raffle-facts');for(const line of lines.filter(Boolean))facts.append(make('li','',line));details.append(facts);return details;}
    winnerList(winners){const list=make('ol','rt-raffle-winners');winners.forEach((winner,index)=>list.append(this.winnerRow(winner,index+1)));this.measureExcerpts(list);return list;}
    winnerRow(winner,rank){
      const li=make('li','rt-raffle-winner');li.dataset.rtWinner=winner.author;
      const cover=make('a','rt-raffle-cover');cover.href=winner.permalink || '#';cover.target='_blank';cover.rel='noopener';cover.setAttribute('aria-label','u/'+winner.author+'’s comment (opens in a new tab)');
      const badge=make('span','rt-raffle-rank',String(rank));badge.setAttribute('aria-hidden','true');badge.dataset.rank=String(rank);
      const avatar=this.avatarEl(winner,32);
      const main=make('div','rt-raffle-winner-main');
      const meta=make('div','rt-raffle-meta');const name=make('a','rt-raffle-name','u/'+winner.author);name.href='/user/'+encodeURIComponent(winner.author)+'/';name.target='_blank';name.rel='noopener';name.title='Profile, opens in a new tab';
      const time=make('faceplate-timeago','rt-raffle-time');time.setAttribute('ts',new Date(winner.created*1000).toISOString());time.setAttribute('format','narrow');
      meta.append(name);if(winner.created)meta.append(make('span','rt-raffle-dot','•'),time);
      // Account facts, as Reddit Raffler lists them (from Raffler for a public draw, from each winner's account
      // otherwise): short chips on the name line, with the full wording in their labels.
      const stats=make('span','rt-raffle-stats');meta.append(stats);
      if(Number.isFinite(winner.accountAgeDays))this.setStats(stats,{days:winner.accountAgeDays,commentKarma:winner.commentKarma,postKarma:winner.linkKarma});else{stats.dataset.state='loading';stats.textContent='Checking account…';}
      const text=winner.body.trim(),excerpt=make('p','rt-raffle-excerpt',text || (winner.official?(winner.loading?'Loading the comment…':'Open the comment to read it'):'No text'));excerpt.dataset.rtClamped='true';if(!text && winner.official)excerpt.dataset.state='placeholder';
      const toggle=make('button','rt-raffle-more','Show more');toggle.type='button';toggle.setAttribute('aria-expanded','false');
      // Shown only when the text is actually cut off (measured after layout); a length guess covers layout-less hosts.
      toggle.hidden=!(text.length>140 || text.includes('\n'));toggle.dataset.rtGuess='true';
      toggle.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();const open=excerpt.dataset.rtClamped==='true';excerpt.dataset.rtClamped=String(!open);toggle.textContent=open?'Show less':'Show more';toggle.setAttribute('aria-expanded',String(open));});
      main.append(meta,excerpt,toggle);
      li.append(cover,badge,avatar,main);return li;
    }
    setStats(box,{days,commentKarma,postKarma}){
      const compact=value=>new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1}).format(Number(value) || 0);
      const age=days<31?days+'d':days<365?Math.floor(days/30.44)+'mo':Math.floor(days/365.25)+'y';
      const chip=(symbol,text,label)=>{const el=make('span','rt-raffle-stat');el.title=label;el.setAttribute('aria-label',label);el.append(glyph(symbol,12),document.createTextNode(text));return el;};
      box.dataset.state='ready';box.dataset.new=String(days<30);if(days<30)box.title='This account is less than 30 days old';else box.removeAttribute('title');
      box.replaceChildren(chip('cake',age,'Account '+n(days)+' '+(days===1?'day':'days')+' old'),chip('comment',compact(commentKarma),n(commentKarma ?? 0)+' comment karma'),chip('post',compact(postKarma),n(postKarma ?? 0)+' post karma'));
    }
    rowsFor(winner){return this.dialog?.dialog.querySelectorAll('.rt-raffle-winner[data-rt-winner="'+CSS.escape(winner.author)+'"]') || [];}
    // A public winner's comment arrived: fill the time and text into the existing row, without rebuilding the list.
    refreshComment(winner){
      for(const li of this.rowsFor(winner)){
        const meta=li.querySelector('.rt-raffle-meta');
        if(winner.created && !meta.querySelector('faceplate-timeago')){const time=make('faceplate-timeago','rt-raffle-time');time.setAttribute('ts',new Date(winner.created*1000).toISOString());time.setAttribute('format','narrow');meta.querySelector('.rt-raffle-name').after(make('span','rt-raffle-dot','•'),time);}
        const excerpt=li.querySelector('.rt-raffle-excerpt'),toggle=li.querySelector('.rt-raffle-more'),text=winner.body.trim();
        excerpt.textContent=text || (winner.loading?'Loading the comment…':'Open the comment to read it');if(text)delete excerpt.dataset.state;else excerpt.dataset.state='placeholder';
        toggle.hidden=!(text.length>140 || text.includes('\n'));
      }
    }
    measureExcerpts(list){
      const measure=()=>{for(const li of list.querySelectorAll('.rt-raffle-winner')){const excerpt=li.querySelector('.rt-raffle-excerpt'),toggle=li.querySelector('.rt-raffle-more');if(!excerpt.clientHeight || toggle.dataset.rtGuess!=='true' || excerpt.dataset.rtClamped!=='true')continue;toggle.hidden=excerpt.scrollHeight<=excerpt.clientHeight+1;}};
      requestAnimationFrame?.(()=>requestAnimationFrame(measure));
      if(globalThis.ResizeObserver){const observer=new ResizeObserver(measure);requestAnimationFrame?.(()=>{if(list.isConnected)observer.observe(list);});}
    }
    avatarEl(winner,size){
      const avatar=make('span','rt-raffle-avatar');avatar.dataset.rtAvatarFor=winner.author;const img=make('img');img.alt='';img.width=size;img.height=size;img.decoding='async';img.referrerPolicy='no-referrer';
      img.src=winner.avatar || defaultAvatar(winner.author);img.addEventListener('error',()=>{if(img.src!==defaultAvatar(winner.author))img.src=defaultAvatar(winner.author);},{once:true});avatar.append(img);return avatar;
    }
    /* Each winner's account (about.json, one read per winner and dialog, shared with account checks): the picture, and
       for a private draw the age and karma line. A public draw already has those facts from Reddit Raffler. */
    async fillAccounts(winners){
      const state=this.dialog;if(!state)return;
      const needed=winners.filter(w=>!w.avatar || !Number.isFinite(w.accountAgeDays));
      for(let i=0;i<needed.length;i+=3)await Promise.all(needed.slice(i,i+3).map(async winner=>{
        const facts=!Number.isFinite(winner.accountAgeDays);let account=null;
        try{account=await this.account(winner.author);}catch{}
        if(this.dialog!==state)return;
        if(account?.avatar && !winner.avatar){winner.avatar=account.avatar;for(const img of state.dialog.querySelectorAll('[data-rt-avatar-for="'+CSS.escape(winner.author)+'"] img'))img.src=account.avatar;}
        if(!facts)return;
        const ok=account && !account.suspended && Number.isFinite(Number(account.created)) && Number(account.created)>0;
        if(ok){winner.accountAgeDays=Math.max(0,Math.floor((Date.now()/1000-Number(account.created))/86400));winner.commentKarma=Number(account.commentKarma) || 0;winner.linkKarma=Number(account.postKarma) || 0;}
        if(ok)this.syncMarkdown();
        for(const li of this.rowsFor(winner)){const box=li.querySelector('.rt-raffle-stats');if(ok)this.setStats(box,{days:winner.accountAgeDays,commentKarma:winner.commentKarma,postKarma:winner.linkKarma});else{box.dataset.state='unavailable';box.textContent='Account details unavailable';}}
      }));
    }

    /* §4b: public draws on Reddit Raffler. An existing raffle stays on the rules screen as "View public results". */
    async checkRaffler(){
      const state=this.dialog;if(!state)return;const r=state.raffler,generation=(r.generation || 0)+1;r.generation=generation;
      try{
        const [status,session]=await Promise.all([this.raffler({action:'status',postId:state.post.id}),this.raffler({action:'session'}).catch(()=>({signedIn:''}))]);
        if(this.dialog!==state || r.generation!==generation)return;r.signedIn=session?.signedIn || '';r.loginUrl=session?.loginUrl || '';
        if(status.exists){
          r.phase='exists';r.raffle=status.raffle;r.me='';
          if(!status.raffle.verified){this.updateSummary();try{const me=await this.read({action:'raffle-me'},{signal:state.controller.signal,timeout:8000});if(this.dialog!==state || r.generation!==generation)return;r.me=me?.username || '';}catch{}}
        }else{r.phase='none';r.override=false;}
      }catch(error){if(this.dialog!==state || r.generation!==generation)return;r.phase='unavailable';r.error=error.message;}
      this.updateSummary();
    }
    async runOfficial(){
      const state=this.dialog;if(!state)return;const r=state.raffler;
      const ownRun=r.override && this.unverifiedOwn() && r.signedIn && r.signedIn.toLowerCase()===state.post.author.toLowerCase();
      if(r.phase==='exists' && r.raffle && !r.override){this.showOfficial(r.raffle);return;}
      if(r.override && !ownRun)return;
      if(!r.override && !['none','error'].includes(r.phase) || this.officialBlockers().length)return;
      if(!r.confirm){r.confirm=true;this.updateSummary();return;}
      const rules=this.rules(),ignored=[...new Set(['AutoModerator',...(rules.excludeAuthor && state.post.author?[state.post.author]:[]),...rules.excludeUsers])].slice(0,100);
      const params={winnerCount:rules.winners,minAge:rules.minAccountAgeDays,ignoredUsers:ignored,...(rules.minTotalKarma?{minCombined:rules.minTotalKarma}:{minComment:rules.minCommentKarma,minLink:rules.minPostKarma})};
      r.confirm=false;r.phase='creating';r.progress='Sending the draw to Reddit Raffler…';this.updateSummary();this.say(r.progress);
      const signal=state.controller.signal;
      try{
        const created=await this.raffler({action:'create',postId:state.post.id,params});if(this.dialog!==state)return;
        if(!created.exists){
          const started=Date.now();let last='';
          for(;;){
            if(Date.now()-started>180000)throw Error('it’s taking longer than three minutes; open redditraffler.com/raffles/'+state.post.id+' later');
            await wait(1500,signal);if(this.dialog!==state)return;
            const job=await this.raffler({action:'job',postId:state.post.id});if(this.dialog!==state)return;
            if(job.missing)continue;
            if(job.error)throw Error(job.status.replace(/^Error:\s*/,'') || 'the draw failed');
            r.progress='Reddit Raffler: '+(job.status || 'waiting…');if(job.status!==last){last=job.status;this.updateSummary();}
            if(/^Done/.test(job.status))break;
          }
        }
        const result=await this.raffler({action:'status',postId:state.post.id});if(this.dialog!==state)return;
        if(!result.exists)throw Error('the results page isn’t there yet; open redditraffler.com/raffles/'+state.post.id);
        r.phase='exists';r.raffle=result.raffle;r.override=false;this.updateSummary();this.showOfficial(result.raffle);this.say('Public draw done.');
      }catch(error){if(this.dialog!==state || signal.aborted)return;r.phase='error';r.error=error.message;this.updateSummary();this.say('Reddit Raffler: '+error.message);}
    }
    // Public results in our winner rows, with comment text from the comments we read when we have them.
    showOfficial(raffle,{keepView=false}={}){
      const state=this.dialog;if(!state)return;
      const winners=raffle.winners.map(w=>{const entry=w.commentId?(state.winnerEntries?.get(w.commentId) || state.entries.get(w.commentId)):null;
        return {id:w.commentId,author:w.username,official:true,loading:!entry && Boolean(w.commentId) && state.winnerRead!==raffle,permalink:(w.commentUrl || '').replace(/^https:\/\/reddit\.com\//,'https://www.reddit.com/'),created:entry?.created || 0,body:entry?.body || '',avatar:entry?.avatar || '',accountAgeDays:w.accountAgeDays,commentKarma:w.commentKarma,linkKarma:w.linkKarma};});
      const previous=state.result?.official===raffle?state.result:null;
      state.result={winners,official:raffle,shortBy:0,skipped:{},poolSize:0};state.saved=true;if(!previous)state.chat=null;
      const box=state.resultsView;box.replaceChildren();
      const when=rafflerDate(raffle.created);
      box.append(this.resultsHeader({count:winners.length,badge:raffle.verified?'Verified public raffle':'Public raffle',verified:raffle.verified,proof:raffle.url,
        meta:'Drawn by Reddit Raffler'+(when?' · '+when:'')+(raffle.creator?' · created by u/'+raffle.creator:' · created by a guest')}));
      box.append(this.winnerList(winners));
      const c=raffle.criteria || {};
      box.append(this.details(['Reddit Raffler read the post’s top-level comments itself and picked at random. On very large threads it may not read every comment.','People with more than one top-level comment are disqualified by Reddit Raffler.',
        'Minimum account age: '+n(c.minAge || 0)+' days · '+(c.minCombined!=null?'total karma '+n(c.minCombined):'comment karma '+n(c.minComment || 0)+', post karma '+n(c.minLink || 0)),raffle.ignored?.length?'Ignored: '+raffle.ignored.map(u=>'u/'+u).join(', '):'',
        raffle.verified?'Verified: created by the post’s author.':'Not verified: not created by the post’s author while signed in to Reddit Raffler.']));
      state.markdownBase=['**Raffle results** ('+n(winners.length)+' '+(winners.length===1?'winner':'winners')+', drawn by Reddit Raffler'+(raffle.verified?', verified':'')+')','',...winners.map((w,i)=>(i+1)+'. u/'+w.author+(w.permalink?' ([comment]('+w.permalink+'))':'')),'','Proof: '+raffle.url].join('\n');this.syncMarkdown();
      state.message.disabled=!winners.length;
      if(!keepView)this.showView('results');else state.again.hidden=true;
      this.fillAccounts(winners);
      this.loadWinnerComments(raffle);
    }
    async loadWinnerComments(raffle){
      const state=this.dialog;if(!state || state.winnerRead===raffle)return;state.winnerRead=raffle;
      const ids=raffle.winners.filter(w=>w.commentId && !state.winnerEntries?.has(w.commentId) && !state.entries.has(w.commentId)).map(w=>w.commentId);if(!ids.length)return;
      try{
        const response=await this.read({action:'raffle-winner-comments',postId:state.post.id,ids},{signal:state.controller.signal,timeout:15000});
        if(this.dialog!==state)return;
        state.winnerEntries ||= new Map();for(const raw of response.entries || []){const entry=R.entry(raw,{postId:state.post.id});if(entry && raffle.winners.some(w=>w.commentId===entry.id && w.username.toLowerCase()===entry.author.toLowerCase()))state.winnerEntries.set(entry.id,entry);}
      }catch{ /* Proof links stay usable if a winner's comment is unavailable. Never scan the thread as a fallback. */ }
      if(this.dialog!==state || state.result?.official!==raffle)return;
      // Fill the rows already on screen (same layout as a private draw); unavailable comments keep a link to open them.
      for(const winner of state.result.winners){const entry=winner.id?state.winnerEntries?.get(winner.id):null;winner.loading=false;if(entry){winner.body=entry.body || '';winner.created=entry.created || 0;if(!winner.avatar && entry.avatar)winner.avatar=entry.avatar;}this.refreshComment(winner);}
    }

    /* B7: message the winners through Reddit chat, as you. Separate chats (one private chat each, reusing an existing
       one) or one group chat. Sending needs a second, explicit confirmation and reports each recipient's outcome. */
    openMessage(){
      const state=this.dialog;if(!state?.result?.winners.length)return;
      if(!state.chat){
        const title=(state.post.title || 'this post').slice(0,120);
        state.chat={mode:'direct',confirm:false,sending:false,done:false,outcomes:new Map(),recipients:[...state.result.winners],excluded:[],
          text:'Congratulations {user}! You won the raffle on this post: {link}',groupName:('Raffle: '+title).slice(0,64)};
      }
      this.renderMessage();this.showView('message');
    }
    fill(template,winners){
      const title=(this.dialog.post.title || 'this post').slice(0,300),link=this.dialog.post.permalink?'https://www.reddit.com'+this.dialog.post.permalink:'';
      return template.replace(/\{user\}/g,winners.map(w=>'u/'+w.author).join(', ')).replace(/\{title\}/g,title).replace(/\{link\}/g,link).slice(0,10000);
    }
    renderMessage(){
      const state=this.dialog,chat=state.chat,winners=state.result.winners,box=state.messageView;box.replaceChildren();
      const field=(label,control,hint)=>{const wrap=make('label','rt-raffle-mini');wrap.append(make('span','rt-raffle-row-caption rt-raffle-field-title',label),control);if(hint){const h=make('span','rt-raffle-row-caption',hint);h.id='rt-raffle-hint-'+label.replace(/\W+/g,'').toLowerCase();control.setAttribute('aria-describedby',h.id);wrap.append(h);}return wrap;};
      const locked=chat.sending || chat.done;
      // Two sections, winners only: who gets the message (× removes), and who doesn't (click to add back).
      const person=(winner,section)=>{const li=make('li','rt-raffle-person');li.dataset.rtRecipient=winner.author;
        const outcome=chat.outcomes.get(winner.author),movable=!locked && outcome?.state!=='sent';
        const move=()=>{if(section==='to'){chat.recipients=chat.recipients.filter(w=>w!==winner);chat.excluded.push(winner);}else{chat.excluded=chat.excluded.filter(w=>w!==winner);chat.recipients.push(winner);}chat.confirm=false;this.renderMessage();};
        if(section==='out' && movable){const chip=make('button','rt-raffle-person-chip');chip.type='button';chip.setAttribute('aria-label','Add u/'+winner.author+' back');chip.append(this.avatarEl(winner,24),make('span','rt-raffle-person-name','u/'+winner.author));chip.addEventListener('click',move);li.append(chip);}
        else li.append(this.avatarEl(winner,24),make('span','rt-raffle-person-name','u/'+winner.author));
        if(outcome){const tag=make('span','rt-raffle-person-state',outcome.text);tag.dataset.state=outcome.state;li.append(tag);}
        if(section==='to' && movable){const b=make('button','rt-raffle-person-action','×');b.type='button';b.setAttribute('aria-label','Remove u/'+winner.author);b.addEventListener('click',move);li.append(b);}
        return li;};
      const toLabel=make('span','rt-raffle-row-caption rt-raffle-field-title','Sending to ('+n(chat.recipients.length)+')');toLabel.tabIndex=-1;
      const people=make('ul','rt-raffle-people');people.setAttribute('aria-label','Recipients');
      for(const winner of chat.recipients)people.append(person(winner,'to'));
      if(!chat.recipients.length)people.append(make('li','rt-raffle-row-caption','No one. Click a winner below to add them back.'));
      const toWrap=make('div','rt-raffle-mini');toWrap.append(toLabel,people);
      const outWrap=make('div','rt-raffle-mini');outWrap.hidden=!chat.excluded.length;
      outWrap.append(make('span','rt-raffle-row-caption rt-raffle-field-title','Not included · click to add back'));
      const others=make('ul','rt-raffle-people rt-raffle-people-out');others.setAttribute('aria-label','Not included');for(const winner of chat.excluded)others.append(person(winner,'out'));outWrap.append(others);
      const modes=make('div','rt-raffle-modes');modes.setAttribute('role','radiogroup');modes.setAttribute('aria-label','How to send');
      for(const [value,label,caption] of [['direct','Separate chats','Each winner gets a private chat with you'],['group','One group chat','Winners can see each other']]){
        const option=make('label','rt-raffle-row rt-raffle-mode');const text=make('span','rt-raffle-row-text');text.append(make('span','rt-raffle-row-label',label),make('span','rt-raffle-row-caption',caption));
        const radio=make('input');radio.type='radio';radio.name='rt-raffle-mode';radio.value=value;radio.checked=chat.mode===value;radio.disabled=chat.sending || chat.done || [...chat.outcomes.values()].some(o=>o.state==='sent');
        radio.addEventListener('change',()=>{chat.mode=value;chat.confirm=false;this.renderMessage();});option.append(text,radio);modes.append(option);
        if(chat.recipients.length>100 && value==='group')radio.disabled=true;
      }
      const name=make('input','rt-raffle-input');name.type='text';name.maxLength=64;name.dataset.rtField='group-name';name.value=chat.groupName;name.disabled=chat.sending || chat.done;name.addEventListener('input',()=>{chat.groupName=name.value;chat.confirm=false;this.syncSend();});
      const area=make('textarea','rt-raffle-input rt-raffle-textarea');area.rows=3;area.maxLength=2000;area.value=chat.text;area.disabled=chat.sending || chat.done;
      const preview=make('p','rt-raffle-preview m-0');
      const updatePreview=()=>{const to=chat.recipients.length?chat.recipients:winners;preview.textContent=this.fill(chat.text,chat.mode==='group'?to:to.slice(0,1));};
      area.addEventListener('input',()=>{chat.text=area.value;chat.confirm=false;updatePreview();this.syncSend();});updatePreview();
      const previewWrap=make('details','rt-raffle-mini rt-raffle-preview-wrap');previewWrap.open=!globalThis.matchMedia?.(MOBILE)?.matches;previewWrap.append(make('summary','rt-raffle-row-caption rt-raffle-field-title',chat.mode==='group'?'Preview':'Preview for u/'+(chat.recipients[0] || winners[0]).author),preview);
      box.append(toWrap,outWrap,modes);
      if(chat.mode==='group')box.append(field('Group name',name));
      box.append(field('Message',area,'{user}, {title} and {link} are filled in for each chat'),previewWrap);
      this.syncSend();
    }
    syncSend(){
      const state=this.dialog,chat=state?.chat;if(!chat)return;const remaining=chat.recipients.filter(w=>chat.outcomes.get(w.author)?.state!=='sent'),count=remaining.length,retry=count<chat.recipients.length;
      state.send.disabled=chat.sending || chat.done || !chat.text.trim() || !count || chat.mode==='group' && chat.groupStarted;
      state.send.textContent=chat.done?'Sent':chat.sending?'Sending…':chat.confirm?'Confirm: send '+(chat.mode==='group'?'to the group':n(count)+' '+(count===1?'message':'messages')):(chat.mode==='group'?'Start group chat':(retry?'Send to the remaining '+n(count):'Send to '+n(count)+' '+(count===1?'winner':'winners')));
      state.send.classList.toggle('rt-raffle-confirm',chat.confirm);state.msgBack.disabled=chat.sending;
      // The footer note (beside the button, in view on phones) holds the warning or the last send's outcome.
      if(state.view!=='message')return;
      if(chat.confirm)this.setNote('Messages are sent from your account and can’t be unsent.',{alert:true});
      else if(chat.summary)this.setNote(chat.summary,{alert:Boolean(chat.failed)});
      else if(!chat.sending)this.setNote('');
    }
    async sendMessages(){
      const state=this.dialog,chat=state?.chat;if(!chat || chat.sending || chat.done)return;
      if(!chat.confirm){chat.confirm=true;this.syncSend();return;}
      chat.sending=true;chat.confirm=false;chat.summary='';this.renderMessage();
      // Only people not reached yet: a second send (after failures) never repeats a delivered message.
      const winners=chat.recipients.filter(w=>chat.outcomes.get(w.author)?.state!=='sent'),set=(winner,stateName,text)=>{chat.outcomes.set(winner.author,{state:stateName,text});const li=state.messageView.querySelector('[data-rt-recipient="'+CSS.escape(winner.author)+'"]');if(li){li.querySelector('.rt-raffle-person-state')?.remove();const tag=make('span','rt-raffle-person-state',text);tag.dataset.state=stateName;li.append(tag);}};
      let sent=0,failed=0,stopped='';
      try{
        const ready=await this.read({action:'chat-status'},{timeout:15000});
        if(!ready?.ready)throw Error('Reddit chat isn’t available on this page. Reload the page and try again.');
        // Chat IDs come from each winner's account (the bridge only messages accounts it resolved here).
        const ids=new Map();
        for(const winner of winners){if(this.dialog!==state)return;try{const account=await this.account(winner.author);if(account?.userId)ids.set(winner.author,account.userId);else set(winner,'failed','Account unavailable');}catch{set(winner,'failed','Couldn’t look up the account');}}
        if(chat.mode==='group'){
          const targets=winners.filter(w=>ids.has(w.author));this.setNote('Starting the group chat…');
          const result=await this.read({action:'chat-group',userIds:targets.map(w=>ids.get(w.author)),name:chat.groupName.trim(),text:this.fill(chat.text,targets)},{timeout:60000});
          if(this.dialog!==state)return;
          const missed=new Set(result.failedInvites || []);
          for(const w of targets){if(!result.sent){set(w,'failed',result.reason || 'Not sent');failed++;}else if(missed.has(ids.get(w.author))){set(w,'failed','Couldn’t be invited');failed++;}else{set(w,'sent','In the group');sent++;}}
          if(!result.sent)stopped=result.reason || '';else chat.groupStarted=true;
        }else{
          let first=true;
          for(const winner of winners){
            if(this.dialog!==state)return;if(!ids.has(winner.author)){failed++;continue;}
            if(stopped){set(winner,'skipped','Not sent');continue;}
            if(!first)await wait(1500,state.controller.signal);first=false;
            set(winner,'sending','Sending…');this.setNote('Sending '+n(sent+failed+1)+' of '+n(winners.length)+'…');
            let result;try{result=await this.read({action:'chat-send',userId:ids.get(winner.author),text:this.fill(chat.text,[winner])},{timeout:45000});}catch(error){result={sent:false,reason:error.message};}
            if(this.dialog!==state)return;
            if(result.sent){sent++;set(winner,'sent',result.existing?'Sent in your existing chat':'Sent');}
            else{failed++;set(winner,'failed',result.reason || 'Not sent');if(result.rateLimited)stopped=result.reason;}
          }
        }
      }catch(error){if(this.dialog!==state)return;stopped=error.message;for(const w of winners)if(!chat.outcomes.has(w.author))set(w,'skipped','Not sent');}
      chat.sending=false;chat.done=chat.recipients.length>0 && chat.recipients.every(w=>chat.outcomes.get(w.author)?.state==='sent');if(sent)state.saved=true;
      chat.failed=failed;chat.summary=(chat.mode==='group'?(sent?'Group chat started with '+n(sent)+' '+(sent===1?'winner':'winners')+'.':'The group chat wasn’t started.'):'Sent to '+n(sent)+' of '+n(winners.length)+' '+(winners.length===1?'winner':'winners')+'.')+(failed?' '+n(failed)+' failed.':'')+(stopped?' '+stopped:'');
      this.say(chat.summary);this.syncSend();
    }
  }
  globalThis.RTRaffle=Object.freeze({Raffle,bridgeRead,defaultAvatar});
  if(window.top===window && globalThis.chrome?.runtime?.id && location.hostname!=='old.reddit.com')Object.defineProperty(globalThis,'RTRaffleInstance',{value:new Raffle()});
})();
