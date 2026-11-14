/* Raffles from a post's ⋯ menu (docs/raffle-spec.md). The menu item sits in the menu's own action slot
   (devvit-context-actions), measured identical to Reddit's items; the dialog uses Reddit's rpl-modal-card.
   Read-only: comments and account facts are read through the page bridge; nothing is posted or stored. */
(() => {
  'use strict';
  if(globalThis.RTRaffle)return;
  const M=globalThis.RTPostModel,R=globalThis.RTRaffleModel;if(!M || !R)return;
  // Reading limits (FINDINGS.md: ~90 top-level comments per client page, ~83 KB per "more replies" page).
  const TOP_PAGES=120,REPLY_REQUESTS=800,REPLY_PARALLEL=2;
  const MOBILE='(max-width: 640px)';
  const make=(tag,cls,text)=>{let el;if(tag.includes('-')){const holder=document.createElement('div');holder.innerHTML='<'+tag+'></'+tag+'>';el=holder.firstElementChild;el.remove();}else el=document.createElement(tag);if(cls)el.className=cls;if(text!=null && text!=='')el.textContent=text;return el;};
  const svgNS='http://www.w3.org/2000/svg';
  function icon(d,size=20){const svg=document.createElementNS(svgNS,'svg');for(const [k,v] of Object.entries({fill:'currentColor',height:String(size),width:String(size),viewBox:'0 0 20 20','aria-hidden':'true'}))svg.setAttribute(k,v);const path=document.createElementNS(svgNS,'path');path.setAttribute('d',d);svg.append(path);return svg;}
  // A ticket outline (Reddit has no raffle icon), drawn on Reddit's 20 px grid.
  const TICKET='M16.6 3H3.4A2.4 2.4 0 001 5.4v2.2a.9.9 0 00.9.9 1.5 1.5 0 010 3 .9.9 0 00-.9.9v2.2A2.4 2.4 0 003.4 17h13.2a2.4 2.4 0 002.4-2.4v-2.2a.9.9 0 00-.9-.9 1.5 1.5 0 010-3 .9.9 0 00.9-.9V5.4A2.4 2.4 0 0016.6 3Zm.6 4.26a3.3 3.3 0 000 5.48v1.86a.6.6 0 01-.6.6H3.4a.6.6 0 01-.6-.6v-1.86a3.3 3.3 0 000-5.48V5.4a.6.6 0 01.6-.6h13.2a.6.6 0 01.6.6v1.86ZM7.1 6.1h1.8v1.8H7.1V6.1Zm0 3h1.8v1.8H7.1V9.1Zm0 3h1.8v1.8H7.1v-1.8Z';
  // Small action icons on Reddit's 20 px grid.
  const EXTERNAL='M11 2.1h5.1c.99 0 1.8.81 1.8 1.8V9a.9.9 0 11-1.8 0V5.17l-6.36 6.37a.9.9 0 01-1.28-1.28L14.83 3.9H11a.9.9 0 110-1.8ZM4.4 4.9a.5.5 0 00-.5.5v10.2c0 .28.22.5.5.5h10.2a.5.5 0 00.5-.5V12a.9.9 0 111.8 0v3.6a2.3 2.3 0 01-2.3 2.3H4.4a2.3 2.3 0 01-2.3-2.3V5.4a2.3 2.3 0 012.3-2.3H8a.9.9 0 110 1.8H4.4Z';
  const COPY='M14.6 5.9H8.4a2.3 2.3 0 00-2.3 2.3v7.4a2.3 2.3 0 002.3 2.3h6.2a2.3 2.3 0 002.3-2.3V8.2a2.3 2.3 0 00-2.3-2.3Zm.5 9.7a.5.5 0 01-.5.5H8.4a.5.5 0 01-.5-.5V8.2c0-.28.22-.5.5-.5h6.2c.28 0 .5.22.5.5v7.4ZM11.6 2.1H5.4a2.3 2.3 0 00-2.3 2.3v7.4a.9.9 0 101.8 0V4.4c0-.28.22-.5.5-.5h6.2a.9.9 0 100-1.8Z';
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
        this.observer=new MutationObserver(()=>{if(!this.queued){this.queued=true;queueMicrotask(()=>{this.queued=false;this.sync();});}});
        this.observer.observe(document.documentElement,{childList:true,subtree:true});
        this.onSettings=(changes,area)=>{if(area==='local' && changes['rt-settings-v1'])this.loadSettings();};
        this.onSettingsMessage=message=>{if(message?.scope==='rt-posts' && message.action==='settings-changed')this.loadSettings();};
        try{chrome.storage?.onChanged?.addListener(this.onSettings);}catch{}try{chrome.runtime?.onMessage?.addListener(this.onSettingsMessage);}catch{}
      }
      // Safety net: make sure the item exists the moment a post's ⋯ button is pressed, before Reddit draws the menu.
      this.onPress=event=>{const menu=event.composedPath?.().find(node=>node?.tagName==='SHREDDIT-POST-OVERFLOW-MENU');if(menu){this.sync();this.menuStatus(menu);}};
      document.addEventListener('pointerdown',this.onPress,true);document.addEventListener('keydown',this.onPress,true);
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
    destroy(){this.dead=true;clearTimeout(this.settingsRetry);document.removeEventListener('pointerdown',this.onPress,true);document.removeEventListener('keydown',this.onPress,true);this.observer?.disconnect();try{chrome.storage?.onChanged?.removeListener(this.onSettings);}catch{}try{chrome.runtime?.onMessage?.removeListener(this.onSettingsMessage);}catch{}this.close(true);for(const item of document.querySelectorAll('[data-rt-raffle="item"]'))item.remove();}

    // One item per post menu, in the menu's own action slot (B1).
    sync(){
      if(this.dead)return;
      const menus=document.querySelectorAll('shreddit-post-overflow-menu');
      for(const menu of menus){
        const existing=menu.querySelector(':scope > [slot="devvit-context-actions"] [data-rt-raffle="item"]');
        if(!this.enabled){existing?.remove();continue;}
        if(existing || !/^t3_[a-z0-9]{1,10}$/i.test(menu.getAttribute('post-id') || ''))continue;
        let slot=menu.querySelector(':scope > [slot="devvit-context-actions"]');
        if(!slot){slot=make('div');slot.setAttribute('slot','devvit-context-actions');menu.append(slot);}
        slot.append(this.menuItem(menu));
      }
      if(!this.enabled)this.close(true);
    }
    menuItem(menu){
      // Reddit's own menu-item markup (FINDINGS.md): li[role=presentation] > div[role=menuitem].
      const li=make('li','relative list-none mt-0');li.setAttribute('role','presentation');li.dataset.rtRaffle='item';li.dataset.rtUi='raffle-menu-item';
      const row=make('div','flex justify-between relative px-md gap-xs text-secondary-plain hover:text-secondary-plain-hover active:bg-interactive-pressed hover:bg-neutral-background-hover hover:no-underline cursor-pointer py-2xs -outline-offset-1');
      row.setAttribute('role','menuitem');row.tabIndex=-1;row.style.paddingInlineEnd='16px';
      const lead=make('span','flex items-center gap-xs min-w-0 shrink'),box=make('span','flex shrink-0 items-center justify-center h-xl w-xl text-20 leading-4');box.append(icon(TICKET));
      const text=make('span','flex flex-col justify-center min-w-0 shrink py-[0.375rem]');text.append(make('span','text-body-2','Run a raffle'),make('span','text-caption-1 text-secondary-plain-weak'));
      lead.append(box,text);const tail=make('span','flex items-center shrink-0');tail.append(make('span','flex items-center justify-center h-lg'));row.append(lead,tail);li.append(row);
      const choose=event=>{event.preventDefault();event.stopPropagation();
        const trigger=menu.querySelector('button[aria-haspopup]');if(trigger?.getAttribute('aria-expanded')==='true')trigger.click();
        this.open(this.postOf(menu),trigger);};
      row.addEventListener('click',choose);row.addEventListener('keydown',event=>{if(event.key==='Enter' || event.key===' ')choose(event);});
      return li;
    }
    /* A post's Reddit Raffler status, shown on its menu item: "View raffle results" when a public raffle exists.
       Checked when the menu is opened, at most once per post every 5 minutes; a failed check leaves the item as is. */
    async menuStatus(menu){
      if(!this.enabled)return;const id=String(menu.getAttribute('post-id') || '').replace(/^t3_/i,'').toLowerCase();if(!/^[a-z0-9]{1,10}$/.test(id))return;
      this.raffleStatus ||= new Map();const cached=this.raffleStatus.get(id);
      if(!cached || Date.now()-cached.at>300000){
        const entry={at:Date.now(),pending:this.raffler({action:'status',postId:id}).then(r=>({exists:Boolean(r?.exists),verified:Boolean(r?.raffle?.verified)}),()=>null)};
        if(this.raffleStatus.size>=200)this.raffleStatus.delete(this.raffleStatus.keys().next().value);this.raffleStatus.set(id,entry);
      }
      const status=await this.raffleStatus.get(id)?.pending;if(!status)return;
      const item=menu.querySelector(':scope > [slot="devvit-context-actions"] [data-rt-raffle="item"]');if(!item)return;
      item.dataset.rtRaffleState=status.exists?'drawn':'none';
      item.querySelector('.text-body-2').textContent=status.exists?'View raffle results':'Run a raffle';
      item.querySelector('.text-caption-1').textContent=status.exists?'Drawn on Reddit Raffler'+(status.verified?' · verified':''):'';
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
      const head=make('div','flex h-xl items-center mt-md px-md');head.slot='title';const h2=make('h2','m-0 text-title-3 text-neutral-content-strong','Run a raffle');h2.id='rt-raffle-title';h2.tabIndex=-1;head.append(h2);
      const close=make('button','mt-md me-md button-small button-secondary icon items-center justify-center button inline-flex');close.type='button';close.slot='close-button';close.setAttribute('aria-label','Close');close.append(icon(CLOSE,16));
      const body=make('div','rt-raffle-body');
      const postLine=make('p','rt-raffle-post m-0');if(post.subreddit)postLine.append(make('span','rt-raffle-post-sub','r/'+post.subreddit),make('span','rt-raffle-post-dot','•'));postLine.append(make('span','rt-raffle-post-title',post.title || 'Post '+post.id));
      // One polite live region for announcements that matter (reading done, errors, copy, sending), not every keystroke.
      const announce=make('p','rt-raffle-sr');announce.setAttribute('role','status');announce.setAttribute('aria-live','polite');
      // Rules screen.
      const rulesView=make('div','rt-raffle-view');rulesView.dataset.rtRaffleView='rules';
      const chooser=make('div','rt-raffle-choice');chooser.setAttribute('role','radiogroup');chooser.setAttribute('aria-label','How to draw');
      const option=(value,title,caption)=>{const label=make('label','rt-raffle-option');label.dataset.rtMode=value;const radio=make('input');radio.type='radio';radio.name='rt-raffle-draw';radio.value=value;
        const text=make('span','rt-raffle-option-text');const sub=make('span','rt-raffle-option-state');text.append(make('span','rt-raffle-option-title',title),make('span','rt-raffle-option-caption',caption),sub);label.append(radio,text);chooser.append(label);return {label,radio,sub};};
      const publicOption=option('public','Public draw','On Reddit Raffler: a results page anyone can check · one per post · can’t be redone');
      const privateOption=option('private','Private draw','Only you see the winners · no proof · you can draw again');
      const status=make('p','rt-raffle-status m-0');
      const progress=make('div','rt-raffle-progress');progress.setAttribute('aria-hidden','true');progress.append(make('span'));
      const statusBox=make('div','rt-raffle-status-card');statusBox.append(status,progress);
      const form=make('form','rt-raffle-form');form.noValidate=true;
      const row=(label,caption,control,{forId,name}={})=>{const wrap=make(forId?'label':'div','rt-raffle-row');if(forId)wrap.htmlFor=forId;if(name)wrap.dataset.rtRow=name;const text=make('span','rt-raffle-row-text');text.append(make('span','rt-raffle-row-label',label));const cap=make('span','rt-raffle-row-caption',caption);text.append(cap);const ctl=make('span','rt-raffle-row-control');ctl.append(control);wrap.append(text,ctl);return wrap;};
      const toggle=(name,checked,label)=>{const wrap=make('span','rt-switch');const input=make('input');input.type='checkbox';input.name=name;input.id='rt-raffle-'+name;input.checked=checked;input.setAttribute('role','switch');input.setAttribute('aria-label',label);const track=make('span','rt-switch-track');track.append(make('span','rt-switch-knob'));wrap.append(input,track);return wrap;};
      const number=(name,value,min,max,label)=>{const input=make('input','rt-raffle-input');input.type='number';input.name=name;input.value=String(value);input.min=String(min);input.max=String(max);input.inputMode='numeric';input.setAttribute('aria-label',label);return input;};
      const text=(name,placeholder,label)=>{const input=make('input','rt-raffle-input');input.type='text';input.name=name;input.placeholder=placeholder;input.maxLength=name==='excludeUsers'?2000:100;input.autocomplete='off';input.setAttribute('aria-label',label);return input;};
      const winners=number('winners',1,1,R.MAX_WINNERS,'Number of winners');winners.classList.add('rt-raffle-count');
      const stepper=make('span','rt-raffle-stepper');const minus=make('button','rt-raffle-step','−'),plus=make('button','rt-raffle-step','+');
      for(const [b,label,delta] of [[minus,'Fewer winners',-1],[plus,'More winners',1]]){b.type='button';b.setAttribute('aria-label',label);b.addEventListener('click',()=>{winners.value=String(Math.min(R.MAX_WINNERS,Math.max(1,(Number(winners.value) || 1)+delta)));winners.dispatchEvent(new Event('input',{bubbles:true}));});}
      stepper.append(minus,winners,plus);
      const account=make('details','rt-raffle-account');const summary=make('summary','rt-raffle-row');const sumText=make('span','rt-raffle-row-text');sumText.append(make('span','rt-raffle-row-label','Account requirements'));const accountHint=make('span','rt-raffle-row-caption','None');sumText.append(accountHint);summary.append(sumText,make('span','rt-raffle-chevron'));
      const grid=make('div','rt-raffle-grid');
      for(const [name,label,max] of [['minAccountAgeDays','Account age (days)',36500],['minCommentKarma','Comment karma',1e9],['minPostKarma','Post karma',1e9],['minTotalKarma','Total karma',1e9]]){const field=make('label','rt-raffle-mini');field.append(make('span','rt-raffle-row-caption',label),number(name,0,0,max,'Minimum '+label.toLowerCase()));grid.append(field);}
      account.append(summary,grid);
      const winnersRow=row('Winners','Between 1 and '+R.MAX_WINNERS,stepper,{name:'winners'});
      form.append(winnersRow,
        row('Top-level comments only','Replies don’t count as entries',toggle('topLevelOnly',true,'Top-level comments only'),{forId:'rt-raffle-topLevelOnly',name:'topLevelOnly'}),
        row('Exclude the post’s author','',toggle('excludeAuthor',true,'Exclude the post’s author'),{forId:'rt-raffle-excludeAuthor',name:'excludeAuthor'}),
        row('Comment must include','Empty accepts any comment',text('mustInclude','Code word','Comment must include'),{name:'mustInclude'}),
        row('Exclude users','Separate names with spaces',text('excludeUsers','u/name','Exclude users'),{name:'excludeUsers'}),account);
      // Consent to draw from an incomplete read: a checkbox, not a switch.
      const ackRow=make('label','rt-raffle-ack');const ack=make('input');ack.type='checkbox';ack.name='acknowledge';ackRow.append(ack,make('span','','Draw from the comments read (Reddit didn’t return every comment)'));ackRow.hidden=true;
      rulesView.append(chooser,statusBox,form,ackRow);
      const resultsView=make('section','rt-raffle-view rt-raffle-results');resultsView.dataset.rtRaffleView='results';resultsView.hidden=true;resultsView.setAttribute('aria-label','Winners');
      const messageView=make('section','rt-raffle-view rt-raffle-message');messageView.dataset.rtRaffleView='message';messageView.hidden=true;messageView.setAttribute('aria-label','Message winners');
      body.append(postLine,rulesView,resultsView,messageView,announce);
      // Footer: one main action per screen; a note beside it carries warnings (kept in view on phones).
      const button=(label,slot,kind)=>{const b=make('button','button-medium button-'+kind+' button inline-flex items-center justify-center px-md',label);b.type='button';b.slot=slot;return b;};
      const note=make('p','rt-raffle-footnote m-0');note.slot='tertiary-button';
      const drawButton=button('Run public draw','primary-button','primary');drawButton.disabled=true;drawButton.classList.add('rt-raffle-draw-icon');
      const back=button('Back to rules','tertiary-button','plain'),again=button('Draw again','secondary-button','secondary'),message=button('Message winners','primary-button','primary');
      const msgBack=button('Back','secondary-button','secondary'),send=button('Send','primary-button','primary');
      again.classList.add('rt-raffle-draw-icon');
      const views={rules:[drawButton],results:[back,again,message],message:[msgBack,send]};
      for(const b of [...views.results,...views.message])b.hidden=true;
      card.append(head,close,body,note,drawButton,back,again,message,msgBack,send);dialog.append(card);document.body.append(dialog);
      const state=this.dialog={dialog,card,post,trigger,h2,form,winners,winnersRow,minus,plus,status,statusCard:statusBox,progress,accountHint,announce,note,ack,ackWrap:ackRow,rulesView,resultsView,messageView,views,
        drawButton,draw:drawButton,back,message,again,msgBack,send,publicOption,privateOption,mode:'public',
        raffler:{phase:'checking',signedIn:'',raffle:null,confirm:false,error:'',progress:'',openedOnExisting:false},
        controller:new AbortController(),entries:new Map(),coverage:null,reading:false,drawing:false,accounts:new Map(),generation:0,view:'rules',result:null,chat:null,draws:0,againConfirm:false,closeAsked:false,touched:false};
      // Phone ↔ desktop follows rotation and resizing (Reddit's bottom sheet below 640 px).
      state.onMedia=()=>{const small=media.matches;dialog.classList.toggle('rt-raffle-sheet',small);card.setAttribute('appearance',small?'bottom-sheet':'modal');};media?.addEventListener?.('change',state.onMedia);state.media=media;
      const finish=()=>this.close();
      close.addEventListener('click',finish);
      dialog.addEventListener('cancel',event=>{event.preventDefault();finish();});
      // A stray click on the dim backdrop never throws away results or interrupts sending.
      dialog.addEventListener('click',event=>{if(event.target===dialog && !state.result && !state.chat?.sending)finish();});
      for(const {radio} of [publicOption,privateOption])radio.addEventListener('change',()=>{if(radio.checked)this.setMode(radio.value,{user:true});});
      form.addEventListener('input',event=>{state.touched=true;state.raffler.confirm=false;if(event.target.name==='topLevelOnly')this.readEntries();else this.updateSummary();});
      form.addEventListener('change',event=>{if(event.target.name!=='topLevelOnly')this.updateSummary();});
      form.addEventListener('submit',event=>{event.preventDefault();this.primaryAction();});
      ack.addEventListener('change',()=>this.updateSummary());
      drawButton.addEventListener('click',()=>this.primaryAction());again.addEventListener('click',()=>this.drawAgain());
      back.addEventListener('click',()=>{if(state.result?.official && state.raffler.openedOnExisting){this.setMode('private',{user:true});}this.showView('rules');});
      message.addEventListener('click',()=>this.openMessage());
      msgBack.addEventListener('click',()=>{if(!state.chat?.sending)this.showView('results');});send.addEventListener('click',()=>this.sendMessages());
      try{dialog.showModal();}catch{dialog.setAttribute('open','');}
      // Focus the heading, not a field: no focus ring, and no phone keyboard over the sheet.
      h2.focus({preventScroll:true});
      this.setMode('public');this.readEntries();this.checkRaffler();
      return state;
    }
    setMode(mode,{user=false}={}){
      const state=this.dialog;if(!state)return;state.mode=mode;state.raffler.confirm=false;if(user)state.touched=true;
      state.publicOption.radio.checked=mode==='public';state.privateOption.radio.checked=mode==='private';
      state.publicOption.label.dataset.selected=String(mode==='public');state.privateOption.label.dataset.selected=String(mode==='private');
      this.updateSummary();
    }
    showView(view){
      const state=this.dialog;if(!state)return;state.view=view;state.raffler.confirm=false;state.againConfirm=false;state.closeAsked=false;
      for(const name of ['rules','results','message']){state[name+'View'].hidden=name!==view;for(const b of state.views[name])b.hidden=name!==view;}
      if(view==='results' && state.result?.official)state.again.hidden=true;
      if(view==='results')state.back.textContent=state.result?.official && state.raffler.openedOnExisting?'Draw privately anyway':'Back to rules';
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
      this.dialog=null;state.controller.abort();state.media?.removeEventListener?.('change',state.onMedia);
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
      state.reading=true;state.error='';state.entries=new Map();state.coverage=null;this.updateSummary('Reading comments…');
      const add=list=>{for(const raw of list || []){const item=R.entry(raw,{postId:state.post.id});if(!item)continue;const seen=state.entries.get(item.id);if(!seen)state.entries.set(item.id,item);else if(!seen.avatar && item.avatar)seen.avatar=item.avatar;}};
      const topCount=()=>{let count=0;for(const e of state.entries.values())if(e.topLevel)count++;return count;};
      const tree=async loader=>{for(let attempt=0;;attempt++){const page=await this.read({action:'raffle-tree',postId:state.post.id,subreddit:state.post.subreddit,loader},{signal,timeout:45000});
        if(!page.rateLimited)return page;if(attempt>=3)throw Object.assign(Error('Reddit kept asking us to slow down.'),{rateLimited:true});
        this.updateSummary('Reddit asked us to slow down · waiting…');await wait(Math.max(1000,Number(page.retryAfterMs) || 30000),signal);}};
      try{
        const thread=await this.read({action:'raffle-thread',postId:state.post.id,topLevelOnly},{signal,timeout:45000});if(!current())return;
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
      finally{if(current()){state.reading=false;this.updateSummary();this.say(state.error?'Couldn’t read the comments.':this.countText());if(state.result?.official && state.view==='results')this.showOfficial(state.result.official,{keepView:true});}}
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
    countText(){const pool=this.dialog?.pool;if(!pool)return '';const k=pool.candidates.length;return this.dialog.mode==='public'?'Up to '+n(k)+' '+(k===1?'person':'people')+' can enter':n(k)+' '+(k===1?'person':'people')+' can win';}
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
      const eligible=state.pool?.candidates.length ?? 0;
      winnersCaption.textContent=!valid?'Enter a number from 1 to '+R.MAX_WINNERS:!pub && !state.reading && state.pool && want>eligible?'Only '+n(eligible)+' '+(eligible===1?'person':'people')+' can win':'Between 1 and '+R.MAX_WINNERS;
      winnersCaption.dataset.error=String(!valid || !pub && !state.reading && Boolean(state.pool) && want>eligible);
      state.ackWrap.hidden=pub || !this.incomplete();
      // Choice captions: Reddit Raffler's state on the public option.
      const sub=state.publicOption.sub,blockers=this.officialBlockers();
      sub.textContent=r.phase==='checking'?'Checking Reddit Raffler…':r.phase==='unavailable'?'Reddit Raffler isn’t responding. You can still draw privately.':r.phase==='exists'?'This post already has a public raffle. View its results here.':
        r.signedIn?'You’re signed in there as u/'+r.signedIn+(state.post.author && r.signedIn.toLowerCase()===state.post.author.toLowerCase()?', so it’s marked verified.':'; only the post’s author gets a verified mark.'):'As a guest (unverified). Sign in at redditraffler.com to have it verified.';
      sub.dataset.state=r.phase;
      state.publicOption.radio.disabled=r.phase==='unavailable';
      if(r.phase==='unavailable'){const retry=make('button','rt-raffle-retry','Try again');retry.type='button';retry.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();r.phase='checking';this.updateSummary();this.checkRaffler();});sub.append(' ',retry);}
      if(state.publicOption.radio.disabled && pub){this.setMode('private');return;}
      // The one main action.
      const b=state.drawButton;
      if(pub){
        b.textContent=r.phase==='exists'?'View public results':r.phase==='creating'?'Drawing…':r.confirm?'Confirm public draw':'Run public draw';
        b.disabled=r.phase==='exists'?!r.raffle:!['none','error'].includes(r.phase) || Boolean(blockers.length) || !valid;
      }else{
        b.textContent=state.drawing?'Drawing…':'Draw privately';
        b.disabled=state.reading || Boolean(state.error) || state.drawing || !eligible || !valid || this.incomplete() && !state.ack.checked;
      }
      b.classList.toggle('rt-raffle-confirm',pub && r.confirm);
      if(state.view==='rules'){
        if(pub && r.phase==='creating')this.setNote(r.progress || 'Reddit Raffler is drawing…');
        else if(pub && r.phase==='error')this.setNote('Reddit Raffler: '+String(r.error).replace(/\.$/,'')+'.',{alert:true});
        else if(pub && r.confirm)this.setNote('This creates a permanent public page on redditraffler.com and can’t be redone.',{alert:true});
        else if(pub && blockers.length && r.phase==='none')this.setNote('Reddit Raffler '+blockers.join(', ')+'.');
        else this.setNote('');
      }
      state.again.disabled=state.drawing || !eligible;
    }
    primaryAction(){const state=this.dialog;if(!state || state.drawButton.disabled)return;if(state.mode==='public')this.runOfficial();else this.drawWinners();}
    // B5: private draw.
    async drawWinners(){
      const state=this.dialog;if(!state || state.reading || state.drawing || state.chat?.sending)return;this.updateSummary();
      if(state.mode!=='private' && state.view==='rules')return;
      const rules=this.rules(),pool=state.pool,signal=state.controller.signal;if(!pool?.candidates.length)return;
      state.drawing=true;this.updateSummary();
      try{
        const drawnAt=Math.floor(Date.now()/1000);
        const result=await R.draw(pool.candidates,rules,{lookup:name=>this.account(name),random:this.random,signal,onProgress:({checked})=>{if(this.dialog===state && state.view==='rules')this.setNote('Checking accounts… '+n(checked));}});
        if(this.dialog!==state)return;state.drawing=false;state.draws++;state.saved=false;state.result={...result,rules,drawnAt,draw:state.draws};state.chat=null;
        this.renderResults(result,rules,drawnAt);this.showView('results');this.fillAvatars(result.winners);this.say(n(result.winners.length)+' '+(result.winners.length===1?'winner':'winners')+' drawn.');
      }catch(error){if(this.dialog===state){state.drawing=false;this.setNote('The draw stopped: '+error.message.replace(/\.$/,'')+'.',{alert:true});}}
      finally{if(this.dialog===state){state.drawing=false;this.updateSummary();state.message.disabled=!state.result?.winners.length;}}
    }
    // Drawing again replaces the winners: it asks once, and the results say which draw this is.
    drawAgain(){
      const state=this.dialog;if(!state || state.result?.official)return;
      if(!state.againConfirm){state.againConfirm=true;state.again.textContent='Confirm: replace these winners';this.setNote('A new draw replaces these winners. The results will say it’s draw '+(state.draws+1)+'.',{alert:true});return;}
      state.againConfirm=false;state.again.textContent='Draw again';this.drawWinners();
    }
    // Account facts (age, karma, picture, chat ID), read once per dialog.
    account(name){const state=this.dialog,key=name.toLowerCase();if(!state.accounts.has(key))state.accounts.set(key,this.read({action:'raffle-user',username:name},{signal:state.controller.signal,timeout:20000}));return state.accounts.get(key);}
    // Results header shared by both kinds: title and actions on one row, badge and details below at full width.
    resultsHeader({count,badge,verified,meta,proof}){
      const state=this.dialog,header=make('div','rt-raffle-banner'),top=make('div','rt-raffle-banner-row');
      const title=make('h3','rt-raffle-banner-title m-0',n(count)+' '+(count===1?'winner':'winners'));title.tabIndex=-1;
      const actions=make('div','rt-raffle-banner-actions');
      // Reddit's small secondary/plain buttons: icon + label, the label alone changes.
      const action=(tag,cls,label,path)=>{const el=make(tag,'rt-raffle-action '+cls+' button-small button inline-flex items-center justify-center');el.append(icon(path,16),make('span','rt-raffle-action-label',label));return el;};
      if(proof){const link=action('a','rt-raffle-proof button-secondary','View proof',EXTERNAL);link.href=proof;link.target='_blank';link.rel='noopener';link.title='Opens redditraffler.com in a new tab';actions.append(link);}
      const copy=action('button','rt-raffle-copy button-plain','Copy',COPY);copy.type='button';const copyLabel=copy.querySelector('.rt-raffle-action-label');
      copy.addEventListener('click',async()=>{let ok=true;try{await navigator.clipboard.writeText(state.markdown || '');}catch{ok=false;}copyLabel.textContent=ok?'Copied':'Couldn’t copy';if(ok)state.saved=true;this.say(ok?'Results copied.':'Couldn’t copy the results.');setTimeout(()=>{if(copy.isConnected)copyLabel.textContent='Copy';},2000);});
      actions.append(copy);top.append(title,actions);header.append(top);
      const info=make('div','rt-raffle-banner-info');if(badge)info.append(make('span','rt-raffle-badge'+(verified?' rt-raffle-verified':''),badge));info.append(make('span','rt-raffle-banner-meta',meta));header.append(info);
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
      state.markdown=R.resultsMarkdown({winners:result.winners,rules,poolSize:eligible,drawnAt,postUrl:state.post.permalink?'https://www.reddit.com'+state.post.permalink:''})+(state.draws>1?'\nDraw '+state.draws+' (private, not recorded).':'\nPrivate draw, not recorded.');box.dataset.markdown=state.markdown;
    }
    details(lines){const details=make('details','rt-raffle-details');details.append(make('summary','','How this was drawn'));const facts=make('ul','rt-raffle-facts');for(const line of lines.filter(Boolean))facts.append(make('li','',line));details.append(facts);return details;}
    winnerList(winners){const list=make('ol','rt-raffle-winners');winners.forEach((winner,index)=>list.append(this.winnerRow(winner,index+1)));this.measureExcerpts(list);return list;}
    winnerRow(winner,rank){
      const li=make('li','rt-raffle-winner');li.dataset.rtWinner=winner.author;
      const cover=make('a','rt-raffle-cover');cover.href=winner.permalink || '#';cover.target='_blank';cover.rel='noopener';cover.setAttribute('aria-label','u/'+winner.author+'’s comment (opens in a new tab)');
      const badge=make('span','rt-raffle-rank',String(rank));badge.setAttribute('aria-hidden','true');
      const avatar=this.avatarEl(winner,32);
      const main=make('div','rt-raffle-winner-main');
      const meta=make('div','rt-raffle-meta');const name=make('a','rt-raffle-name','u/'+winner.author);name.href='/user/'+encodeURIComponent(winner.author)+'/';name.target='_blank';name.rel='noopener';name.title='Profile, opens in a new tab';
      const time=make('faceplate-timeago','rt-raffle-time');time.setAttribute('ts',new Date(winner.created*1000).toISOString());time.setAttribute('format','narrow');
      meta.append(name);if(winner.created)meta.append(make('span','rt-raffle-dot','•'),time);
      if(Number.isFinite(winner.accountAgeDays))meta.append(make('span','rt-raffle-dot','•'),make('span','rt-raffle-facts-inline',n(winner.accountAgeDays)+'-day account'));
      const text=winner.body.trim(),excerpt=make('p','rt-raffle-excerpt',text || (winner.official?'Open the comment to read it':'No text'));excerpt.dataset.rtClamped='true';
      const toggle=make('button','rt-raffle-more','Show more');toggle.type='button';toggle.setAttribute('aria-expanded','false');
      // Shown only when the text is actually cut off (measured after layout); a length guess covers layout-less hosts.
      toggle.hidden=!(text.length>140 || text.includes('\n'));toggle.dataset.rtGuess='true';
      toggle.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();const open=excerpt.dataset.rtClamped==='true';excerpt.dataset.rtClamped=String(!open);toggle.textContent=open?'Show less':'Show more';toggle.setAttribute('aria-expanded',String(open));});
      main.append(meta,excerpt,toggle);
      li.append(cover,badge,avatar,main);return li;
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
    // Profile pictures for winners the thread JSON didn't carry them for (from about.json, cached with account checks).
    async fillAvatars(winners){
      const state=this.dialog;if(!state)return;
      const missing=winners.filter(w=>!w.avatar);
      for(let i=0;i<missing.length;i+=3)await Promise.all(missing.slice(i,i+3).map(async winner=>{
        try{const account=await this.account(winner.author);if(this.dialog!==state || !account?.avatar)return;winner.avatar=account.avatar;
          for(const img of state.dialog.querySelectorAll('[data-rt-avatar-for="'+CSS.escape(winner.author)+'"] img'))img.src=account.avatar;}catch{}
      }));
    }

    /* §4b: public draws on Reddit Raffler. A post that already has one opens straight on its results. */
    async checkRaffler(){
      const state=this.dialog;if(!state)return;const r=state.raffler;
      try{
        const [status,session]=await Promise.all([this.raffler({action:'status',postId:state.post.id}),this.raffler({action:'session'}).catch(()=>({signedIn:''}))]);
        if(this.dialog!==state)return;r.signedIn=session?.signedIn || '';
        if(status.exists){r.phase='exists';r.raffle=status.raffle;}else r.phase='none';
      }catch(error){if(this.dialog!==state)return;r.phase='unavailable';r.error=error.message;}
      this.updateSummary();
      if(r.phase==='exists' && r.raffle && state.view==='rules' && !state.touched){r.openedOnExisting=true;this.showOfficial(r.raffle);}
    }
    async runOfficial(){
      const state=this.dialog;if(!state)return;const r=state.raffler;
      if(r.phase==='exists' && r.raffle){this.showOfficial(r.raffle);return;}
      if(!['none','error'].includes(r.phase) || this.officialBlockers().length)return;
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
        r.phase='exists';r.raffle=result.raffle;this.updateSummary();this.showOfficial(result.raffle);this.say('Public draw done.');
      }catch(error){if(this.dialog!==state || signal.aborted)return;r.phase='error';r.error=error.message;this.updateSummary();this.say('Reddit Raffler: '+error.message);}
    }
    // Public results in our winner rows, with comment text from the comments we read when we have them.
    showOfficial(raffle,{keepView=false}={}){
      const state=this.dialog;if(!state)return;
      const winners=raffle.winners.map(w=>{const entry=w.commentId?state.entries.get(w.commentId):null;
        return {id:w.commentId,author:w.username,official:true,permalink:(w.commentUrl || '').replace(/^https:\/\/reddit\.com\//,'https://www.reddit.com/'),created:entry?.created || 0,body:entry?.body || '',avatar:entry?.avatar || '',accountAgeDays:w.accountAgeDays,commentKarma:w.commentKarma,linkKarma:w.linkKarma};});
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
      state.markdown=['**Raffle results** ('+n(winners.length)+' '+(winners.length===1?'winner':'winners')+', drawn by Reddit Raffler'+(raffle.verified?', verified':'')+')','',...winners.map((w,i)=>(i+1)+'. u/'+w.author+(w.permalink?' ([comment]('+w.permalink+'))':'')),'','Proof: '+raffle.url].join('\n');box.dataset.markdown=state.markdown;
      state.message.disabled=!winners.length;
      if(!keepView)this.showView('results');else state.again.hidden=true;
      this.fillAvatars(winners);
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
      // Two sections: who gets the message (removable), and who doesn't (winners left out, or anyone added by name).
      const person=(winner,action)=>{const li=make('li','rt-raffle-person');li.dataset.rtRecipient=winner.author;li.append(this.avatarEl(winner,24),make('span','rt-raffle-person-name','u/'+winner.author));
        const outcome=chat.outcomes.get(winner.author);if(outcome){const tag=make('span','rt-raffle-person-state',outcome.text);tag.dataset.state=outcome.state;li.append(tag);}
        if(action && !locked && outcome?.state!=='sent'){const b=make('button','rt-raffle-person-action',action==='remove'?'×':'+');b.type='button';b.setAttribute('aria-label',(action==='remove'?'Remove u/':'Add u/')+winner.author);
          b.addEventListener('click',()=>{if(action==='remove'){chat.recipients=chat.recipients.filter(w=>w!==winner);chat.excluded.push(winner);}else{chat.excluded=chat.excluded.filter(w=>w!==winner);chat.recipients.push(winner);}chat.confirm=false;this.renderMessage();});li.append(b);}
        return li;};
      const toLabel=make('span','rt-raffle-row-caption rt-raffle-field-title','Sending to ('+n(chat.recipients.length)+')');toLabel.tabIndex=-1;
      const people=make('ul','rt-raffle-people');people.setAttribute('aria-label','Recipients');
      for(const winner of chat.recipients)people.append(person(winner,'remove'));
      if(!chat.recipients.length)people.append(make('li','rt-raffle-row-caption','No one yet. Add people below.'));
      const toWrap=make('div','rt-raffle-mini');toWrap.append(toLabel,people);
      const outWrap=make('div','rt-raffle-mini');outWrap.append(make('span','rt-raffle-row-caption rt-raffle-field-title','Not included'));
      if(chat.excluded.length){const others=make('ul','rt-raffle-people rt-raffle-people-out');others.setAttribute('aria-label','Not included');for(const winner of chat.excluded)others.append(person(winner,'add'));outWrap.append(others);}
      const addRow=make('div','rt-raffle-add');const addInput=make('input','rt-raffle-input');addInput.type='text';addInput.placeholder='Add someone: u/name';addInput.maxLength=23;addInput.autocomplete='off';addInput.setAttribute('aria-label','Add someone by username');addInput.disabled=locked;
      const addButton=make('button','rt-raffle-action button-small button-secondary button inline-flex items-center justify-center','Add');addButton.type='button';addButton.disabled=locked;
      const addError=make('span','rt-raffle-row-caption');addError.dataset.error='true';
      const add=()=>{const name=addInput.value.trim().replace(/^\/?u\//i,'');
        if(!/^[A-Za-z0-9_-]{3,20}$/.test(name)){addError.textContent='Enter a Reddit username';return;}
        const known=[...chat.recipients,...chat.excluded].find(w=>w.author.toLowerCase()===name.toLowerCase());
        if(known){if(chat.excluded.includes(known)){chat.excluded=chat.excluded.filter(w=>w!==known);chat.recipients.push(known);}chat.confirm=false;this.renderMessage();return;}
        const added={author:name,avatar:'',permalink:'',body:'',created:0,added:true};chat.recipients.push(added);chat.confirm=false;this.renderMessage();this.fillAvatars([added]);};
      addButton.addEventListener('click',add);addInput.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();add();}});
      addRow.append(addInput,addButton);outWrap.append(addRow,addError);
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
      state.send.textContent=chat.done?'Sent':chat.sending?'Sending…':chat.confirm?'Confirm: send '+(chat.mode==='group'?'to the group':n(count)+' '+(count===1?'message':'messages')):(chat.mode==='group'?'Start group chat':(retry?'Send to the remaining '+n(count):'Send to '+n(count)+' '+(count===1?'person':'people')));
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
      chat.failed=failed;chat.summary=(chat.mode==='group'?(sent?'Group chat started with '+n(sent)+' '+(sent===1?'winner':'winners')+'.':'The group chat wasn’t started.'):'Sent to '+n(sent)+' of '+n(winners.length)+' '+(winners.length===1?'person':'people')+'.')+(failed?' '+n(failed)+' failed.':'')+(stopped?' '+stopped:'');
      this.say(chat.summary);this.syncSend();
    }
  }
  globalThis.RTRaffle=Object.freeze({Raffle,bridgeRead,defaultAvatar});
  if(window.top===window && globalThis.chrome?.runtime?.id && location.hostname!=='old.reddit.com')Object.defineProperty(globalThis,'RTRaffleInstance',{value:new Raffle()});
})();
