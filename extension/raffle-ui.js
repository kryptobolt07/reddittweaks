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
  const CLOSE='m11.273 10 5.363-5.363a.9.9 0 10-1.273-1.273L10 8.727 4.637 3.364a.9.9 0 10-1.273 1.273L8.727 10l-5.363 5.363a.9.9 0 101.274 1.273L10 11.273l5.363 5.363a.897.897 0 001.274 0 .9.9 0 000-1.273L11.275 10Z';
  const n=value=>Number(value).toLocaleString('en-US');

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
  async function defaultSettings(){const response=await chrome.runtime.sendMessage({scope:'rt-posts',action:'get-settings'});if(!response?.ok)throw Error('Settings unavailable.');return response.settings;}
  // Reddit's default avatars, chosen the way Reddit does for users without one (0–7).
  const defaultAvatar=name=>'https://www.redditstatic.com/avatars/defaults/v2/avatar_default_'+([...String(name)].reduce((h,ch)=>(h*31+ch.charCodeAt(0))>>>0,7)%8)+'.png';
  const wait=(ms,signal)=>new Promise((resolve,reject)=>{const t=setTimeout(resolve,ms);signal?.addEventListener('abort',()=>{clearTimeout(t);reject(Error('Request cancelled.'));},{once:true});});

  class Raffle {
    constructor({read=bridgeRead,readSettings=defaultSettings,observe=true,random}={}){
      this.read=read;this.readSettings=readSettings;this.random=random;this.enabled=false;this.dead=false;this.dialog=null;
      if(observe){
        this.observer=new MutationObserver(()=>{if(!this.queued){this.queued=true;queueMicrotask(()=>{this.queued=false;this.sync();});}});
        this.observer.observe(document.documentElement,{childList:true,subtree:true});
        this.onSettings=(changes,area)=>{if(area==='local' && changes['rt-settings-v1'])this.loadSettings();};
        this.onSettingsMessage=message=>{if(message?.scope==='rt-posts' && message.action==='settings-changed')this.loadSettings();};
        try{chrome.storage?.onChanged?.addListener(this.onSettings);}catch{}try{chrome.runtime?.onMessage?.addListener(this.onSettingsMessage);}catch{}
      }
      // Safety net: make sure the item exists the moment a post's ⋯ button is pressed, before Reddit draws the menu.
      this.onPress=event=>{const menu=event.composedPath?.().find(node=>node?.tagName==='SHREDDIT-POST-OVERFLOW-MENU');if(menu)this.sync();};
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
    destroy(){this.dead=true;clearTimeout(this.settingsRetry);document.removeEventListener('pointerdown',this.onPress,true);document.removeEventListener('keydown',this.onPress,true);this.observer?.disconnect();try{chrome.storage?.onChanged?.removeListener(this.onSettings);}catch{}try{chrome.runtime?.onMessage?.removeListener(this.onSettingsMessage);}catch{}this.close();for(const item of document.querySelectorAll('[data-rt-raffle="item"]'))item.remove();}

    // One item per post menu, in the menu's own action slot (B1).
    sync(){
      if(this.dead)return;
      const menus=document.querySelectorAll('shreddit-post-overflow-menu');
      for(const menu of menus){
        const existing=menu.querySelector(':scope > [slot="devvit-context-actions"] [data-rt-raffle="item"]');
        if(!this.enabled){existing?.remove();continue;}
        if(existing || !/^t3_[a-z0-9]{1,10}$/i.test(menu.getAttribute('post-id') || ''))continue;
        let slot=menu.querySelector(':scope > [slot="devvit-context-actions"]');
        if(!slot){slot=make('div');slot.setAttribute('slot','devvit-context-actions');slot.setAttribute('role','menuitem');menu.append(slot);}
        slot.append(this.menuItem(menu));
      }
      if(!this.enabled)this.close();
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
    postOf(menu){
      const card=menu.closest('shreddit-post');
      return {id:menu.getAttribute('post-id').replace(/^t3_/i,'').toLowerCase(),author:menu.getAttribute('author-name') || card?.getAttribute('author') || '',
        subreddit:String(menu.getAttribute('subreddit-prefixed-name') || card?.getAttribute('subreddit-prefixed-name') || '').replace(/^r\//i,''),
        title:card?.getAttribute('post-title') || '',permalink:menu.getAttribute('permalink') || card?.getAttribute('permalink') || ''};
    }

    // --- Dialog (B2–B7): three screens (rules, winners, message) in Reddit's rpl-modal-card. Rules use Reddit's
    // settings rows (FINDINGS.md: label 14/20 + caption 12/16 on the left, control on the right, 8 px rows).
    open(post,trigger=null){
      this.close();
      const narrow=globalThis.matchMedia?.(MOBILE)?.matches===true;
      const dialog=make('dialog','rt-raffle-dialog'+(narrow?' rt-raffle-sheet':''));dialog.dataset.rtRaffle='dialog';dialog.setAttribute('aria-labelledby','rt-raffle-title');
      const card=make('rpl-modal-card','rt-raffle-card');card.setAttribute('appearance',narrow?'bottom-sheet':'modal');
      const head=make('div','flex h-xl items-center mt-md px-md');head.slot='title';const h2=make('h2','m-0 text-title-3 text-neutral-content-strong','Run a raffle');h2.id='rt-raffle-title';head.append(h2);
      const close=make('button','mt-md me-md button-small button-secondary icon items-center justify-center button inline-flex');close.type='button';close.slot='close-button';close.setAttribute('aria-label','Close');close.append(icon(CLOSE,16));
      const body=make('div','rt-raffle-body');
      const postLine=make('p','rt-raffle-post m-0');if(post.subreddit)postLine.append(make('span','rt-raffle-post-sub','r/'+post.subreddit),make('span','rt-raffle-post-dot','•'));postLine.append(make('span','rt-raffle-post-title',post.title || 'Post '+post.id));
      const status=make('p','rt-raffle-status m-0');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
      const progress=make('div','rt-raffle-progress');progress.setAttribute('aria-hidden','true');progress.append(make('span'));
      const statusBox=make('div','rt-raffle-status-card');statusBox.append(status,progress);
      // Rules screen.
      const rulesView=make('div','rt-raffle-view');rulesView.dataset.rtRaffleView='rules';
      const form=make('form','rt-raffle-form');form.noValidate=true;
      const row=(label,caption,control,{forId}={})=>{const wrap=make(forId?'label':'div','rt-raffle-row');if(forId)wrap.htmlFor=forId;const text=make('span','rt-raffle-row-text');text.append(make('span','rt-raffle-row-label',label));if(caption)text.append(make('span','rt-raffle-row-caption',caption));const ctl=make('span','rt-raffle-row-control');ctl.append(control);wrap.append(text,ctl);return wrap;};
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
      form.append(row('Winners','Between 1 and '+R.MAX_WINNERS,stepper),
        row('Top-level comments only','Replies don’t count as entries',toggle('topLevelOnly',true,'Top-level comments only'),{forId:'rt-raffle-topLevelOnly'}),
        row('Exclude the post’s author','',toggle('excludeAuthor',true,'Exclude the post’s author'),{forId:'rt-raffle-excludeAuthor'}),
        row('Comment must include','Empty accepts any comment',text('mustInclude','Code word','Comment must include')),
        row('Exclude users','Separate names with spaces',text('excludeUsers','u/name','Exclude users')),account);
      const ackRow=row('Draw from the comments read','Reddit didn’t return every comment',toggle('acknowledge',false,'Draw from the comments read'),{forId:'rt-raffle-acknowledge'});ackRow.classList.add('rt-raffle-ack');ackRow.hidden=true;
      rulesView.append(form,ackRow);
      const resultsView=make('section','rt-raffle-view rt-raffle-results');resultsView.dataset.rtRaffleView='results';resultsView.hidden=true;resultsView.setAttribute('aria-label','Winners');
      const messageView=make('section','rt-raffle-view rt-raffle-message');messageView.dataset.rtRaffleView='message';messageView.hidden=true;messageView.setAttribute('aria-label','Message winners');
      body.append(postLine,statusBox,rulesView,resultsView,messageView);
      const button=(label,slot,kind)=>{const b=make('button','button-medium button-'+kind+' button inline-flex items-center justify-center px-md',label);b.type='button';b.slot=slot;return b;};
      const cancel=button('Cancel','secondary-button','secondary'),draw=button('Draw winners','primary-button','primary');draw.disabled=true;
      const back=button('Back to rules','tertiary-button','plain'),message=button('Message winners','secondary-button','secondary'),again=button('Draw again','primary-button','primary');
      const msgBack=button('Back','secondary-button','secondary'),send=button('Send','primary-button','primary');
      const views={rules:[cancel,draw],results:[back,message,again],message:[msgBack,send]};
      for(const b of [...views.results,...views.message])b.hidden=true;
      card.append(head,close,body,cancel,draw,back,message,again,msgBack,send);dialog.append(card);document.body.append(dialog);
      const state=this.dialog={dialog,card,post,trigger,h2,form,winners,status,statusCard:statusBox,progress,accountHint,ack:ackRow.querySelector('input'),ackWrap:ackRow,rulesView,resultsView,messageView,views,draw,cancel,back,message,again,msgBack,send,
        controller:new AbortController(),entries:new Map(),coverage:null,reading:false,drawing:false,accounts:new Map(),generation:0,view:'rules',result:null,chat:null};
      const finish=()=>this.close();
      close.addEventListener('click',finish);cancel.addEventListener('click',finish);
      dialog.addEventListener('cancel',event=>{event.preventDefault();if(state.chat?.sending)return;finish();});
      dialog.addEventListener('click',event=>{if(event.target===dialog && !state.chat?.sending)finish();});
      form.addEventListener('input',event=>{if(event.target.name==='topLevelOnly')this.readEntries();else this.updateSummary();});
      form.addEventListener('change',event=>{if(event.target.name!=='topLevelOnly')this.updateSummary();});
      form.addEventListener('submit',event=>{event.preventDefault();if(!draw.disabled)this.drawWinners();});
      state.ack.addEventListener('change',()=>this.updateSummary());
      draw.addEventListener('click',()=>this.drawWinners());again.addEventListener('click',()=>this.drawWinners());
      back.addEventListener('click',()=>this.showView('rules'));message.addEventListener('click',()=>this.openMessage());
      msgBack.addEventListener('click',()=>{if(!state.chat?.sending)this.showView('results');});send.addEventListener('click',()=>this.sendMessages());
      try{dialog.showModal();}catch{dialog.setAttribute('open','');}
      winners.focus({preventScroll:true});
      this.readEntries();
      return state;
    }
    showView(view){
      const state=this.dialog;if(!state)return;state.view=view;
      for(const name of ['rules','results','message']){state[name+'View'].hidden=name!==view;for(const b of state.views[name])b.hidden=name!==view;}
      state.h2.textContent={rules:'Run a raffle',results:'Winners',message:'Message winners'}[view];
      state.statusCard.hidden=view!=='rules';
      // Focus a heading, not a row, so screen readers announce the screen without a focus ring on a winner.
      (view==='rules'?state.winners:state[view+'View'].querySelector('[tabindex="-1"]'))?.focus?.({preventScroll:true});
      this.updateSummary();
    }
    close(){
      const state=this.dialog;if(!state)return;this.dialog=null;state.controller.abort();
      try{state.dialog.close();}catch{}state.dialog.remove();
      if(state.trigger?.isConnected)state.trigger.focus({preventScroll:true});
    }
    rules(){const state=this.dialog,data=new FormData(state.form);const raw=Object.fromEntries(data.entries());raw.topLevelOnly=state.form.elements.topLevelOnly.checked;raw.excludeAuthor=state.form.elements.excludeAuthor.checked;return R.normalizeRules(raw);}

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
              this.updateSummary('Reading comments… '+n(topCount())+' top-level so far');
              next=step(await tree(next));if(!current())return;pages++;
            }
            // "More replies" threads, two at a time, for the all-comments mode.
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
      finally{if(current()){state.reading=false;this.updateSummary();}}
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
    updateSummary(message){
      const state=this.dialog;if(!state)return;
      const rules=this.rules();
      const active=[rules.minAccountAgeDays?rules.minAccountAgeDays+' days old':'',rules.minCommentKarma?n(rules.minCommentKarma)+' comment karma':'',rules.minPostKarma?n(rules.minPostKarma)+' post karma':'',rules.minTotalKarma?n(rules.minTotalKarma)+' total karma':''].filter(Boolean);
      state.accountHint.textContent=active.length?'At least '+active.join(', '):'None';
      if(state.error && !state.reading){state.status.textContent='Couldn’t read the comments: '+state.error.replace(/\.$/,'')+'.';state.statusCard.dataset.state='error';state.draw.disabled=true;state.ackWrap.hidden=true;return;}
      if(message || state.reading){state.status.textContent=message || 'Reading comments…';state.statusCard.dataset.state='loading';state.draw.disabled=true;return;}
      if(state.drawing){state.draw.disabled=true;state.again.disabled=true;return;}
      const pool=R.candidates([...state.entries.values()],rules,{postAuthor:state.post.author});
      state.pool=pool;const eligible=pool.candidates.length;
      state.statusCard.dataset.state=this.incomplete()?'warning':'ready';
      state.status.textContent='';state.status.append(make('strong','',n(eligible)+' eligible '+(eligible===1?'entrant':'entrants')),document.createTextNode(' · '+this.coverageText()+(R.needsAccount(rules)?' · account minimums are checked during the draw':'')));
      state.ackWrap.hidden=!this.incomplete();
      const blocked=!eligible || this.incomplete() && !state.ack.checked;state.draw.disabled=blocked;state.again.disabled=blocked;
    }
    // B5
    async drawWinners(){
      const state=this.dialog;if(!state || state.reading || state.drawing || state.chat?.sending)return;this.updateSummary();if(state.draw.disabled)return;
      const rules=this.rules(),pool=state.pool,signal=state.controller.signal;state.drawing=true;state.draw.disabled=true;state.again.disabled=true;state.status.textContent='Drawing…';
      try{
        const drawnAt=Math.floor(Date.now()/1000);
        const result=await R.draw(pool.candidates,rules,{lookup:name=>this.account(name),random:this.random,signal,onProgress:({checked,winners})=>{if(this.dialog===state)state.status.textContent='Drawing… checked '+n(checked)+' '+(checked===1?'account':'accounts')+', '+n(winners)+' '+(winners===1?'winner':'winners')+' so far';}});
        if(this.dialog!==state)return;state.drawing=false;state.result={...result,rules,drawnAt};state.chat=null;this.renderResults(result,rules,drawnAt);this.showView('results');this.fillAvatars(result.winners);
      }catch(error){if(this.dialog===state){state.drawing=false;state.status.textContent='The draw stopped: '+error.message.replace(/\.$/,'')+'.';}}
      finally{if(this.dialog===state){state.drawing=false;this.updateSummary();state.message.disabled=!state.result?.winners.length;}}
    }
    // Account facts (age, karma, picture, chat ID), read once per dialog.
    account(name){const state=this.dialog,key=name.toLowerCase();if(!state.accounts.has(key))state.accounts.set(key,this.read({action:'raffle-user',username:name},{signal:state.controller.signal,timeout:20000}));return state.accounts.get(key);}
    // B6: winners as Reddit comment rows; each row opens its comment.
    renderResults(result,rules,drawnAt){
      const state=this.dialog,box=state.resultsView;box.replaceChildren();
      const eligible=result.poolSize,count=result.winners.length;
      const header=make('div','rt-raffle-banner'),text=make('div','rt-raffle-banner-text');
      const title=make('p','rt-raffle-banner-title m-0',count?n(count)+' '+(count===1?'winner':'winners')+' from '+n(eligible)+' eligible '+(eligible===1?'entrant':'entrants'):'No winners');title.tabIndex=-1;
      text.append(title,make('p','rt-raffle-banner-meta m-0','Drawn '+new Date(drawnAt*1000).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'})+' · random, one entry per user'+(result.shortBy?' · only '+n(count)+' passed the rules':'')));
      const copy=make('button','rt-raffle-copy button-small button-plain button inline-flex items-center justify-center','Copy');copy.type='button';copy.setAttribute('aria-label','Copy results as Markdown');
      copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(state.markdown || '');copy.textContent='Copied';}catch{copy.textContent='Couldn’t copy';}setTimeout(()=>{if(copy.isConnected)copy.textContent='Copy';},2000);});
      header.append(text,copy);box.append(header);
      const list=make('ol','rt-raffle-winners');result.winners.forEach((winner,index)=>list.append(this.winnerRow(winner,index+1)));box.append(list);
      const reasons={age:'account too new',commentKarma:'comment karma too low',postKarma:'post karma too low',totalKarma:'total karma too low',suspended:'suspended',unavailable:'deleted or unavailable',unchecked:'couldn’t be checked'};
      const skipped=Object.entries(result.skipped).map(([key,value])=>n(value)+' '+(reasons[key] || key));
      const details=make('details','rt-raffle-details');details.append(make('summary','','How this was drawn'));
      const facts=make('ul','rt-raffle-facts');
      for(const line of [this.coverageText(),...(skipped.length?['Skipped during the draw: '+skipped.join(', ')]:[]),'Rules: '+R.resultsMarkdown({winners:[],rules,poolSize:eligible,drawnAt}).split('Rules: ')[1].split('\n')[0]])facts.append(make('li','',line));
      details.append(facts);box.append(details);
      state.markdown=R.resultsMarkdown({winners:result.winners,rules,poolSize:eligible,drawnAt,postUrl:state.post.permalink?'https://www.reddit.com'+state.post.permalink:''});box.dataset.markdown=state.markdown;
    }
    winnerRow(winner,rank){
      const li=make('li','rt-raffle-winner');li.dataset.rtWinner=winner.author;
      const cover=make('a','rt-raffle-cover');cover.href=winner.permalink || '#';cover.target='_blank';cover.rel='noopener';cover.setAttribute('aria-label','Open u/'+winner.author+'’s comment');
      const badge=make('span','rt-raffle-rank',String(rank));badge.setAttribute('aria-label','Winner '+rank);
      const avatar=this.avatarEl(winner,32);
      const main=make('div','rt-raffle-winner-main');
      const meta=make('div','rt-raffle-meta');const name=make('a','rt-raffle-name','u/'+winner.author);name.href='/user/'+encodeURIComponent(winner.author)+'/';name.target='_blank';name.rel='noopener';
      const time=make('faceplate-timeago','rt-raffle-time');time.setAttribute('ts',new Date(winner.created*1000).toISOString());time.setAttribute('format','narrow');
      meta.append(name,make('span','rt-raffle-dot','•'),time);
      const text=winner.body.trim(),excerpt=make('p','rt-raffle-excerpt',text || 'No text');excerpt.dataset.rtClamped='true';
      main.append(meta,excerpt);
      if(text.length>140 || text.includes('\n')){
        const toggle=make('button','rt-raffle-more','Show more');toggle.type='button';toggle.setAttribute('aria-expanded','false');
        toggle.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();const open=excerpt.dataset.rtClamped==='true';excerpt.dataset.rtClamped=String(!open);toggle.textContent=open?'Show less':'Show more';toggle.setAttribute('aria-expanded',String(open));});
        main.append(toggle);
      }
      li.append(cover,badge,avatar,main);return li;
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

    /* B7: message the winners through Reddit chat, as you. Separate chats (one private chat each, reusing an existing
       one) or one group chat. Sending needs a second, explicit confirmation and reports each recipient's outcome. */
    openMessage(){
      const state=this.dialog;if(!state?.result?.winners.length)return;
      if(!state.chat){
        const title=(state.post.title || 'this post').slice(0,120),link=state.post.permalink?'https://www.reddit.com'+state.post.permalink:'';
        state.chat={mode:'direct',confirm:false,sending:false,done:false,outcomes:new Map(),
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
      const heading=make('p','rt-raffle-banner-title m-0',n(winners.length)+' '+(winners.length===1?'winner':'winners'));heading.tabIndex=-1;
      const people=make('ul','rt-raffle-people');
      for(const winner of winners){const li=make('li','rt-raffle-person');li.dataset.rtRecipient=winner.author;li.append(this.avatarEl(winner,24),make('span','rt-raffle-person-name','u/'+winner.author));
        const outcome=chat.outcomes.get(winner.author);if(outcome){const tag=make('span','rt-raffle-person-state',outcome.text);tag.dataset.state=outcome.state;li.append(tag);}people.append(li);}
      const modes=make('div','rt-raffle-modes');modes.setAttribute('role','radiogroup');modes.setAttribute('aria-label','How to send');
      for(const [value,label,caption] of [['direct','Separate chats','Each winner gets a private chat with you'],['group','One group chat','Winners can see each other']]){
        const option=make('label','rt-raffle-row rt-raffle-mode');const text=make('span','rt-raffle-row-text');text.append(make('span','rt-raffle-row-label',label),make('span','rt-raffle-row-caption',caption));
        const radio=make('input');radio.type='radio';radio.name='rt-raffle-mode';radio.value=value;radio.checked=chat.mode===value;radio.disabled=chat.sending || chat.done || chat.outcomes.size>0 && [...chat.outcomes.values()].some(o=>o.state==='sent');
        radio.addEventListener('change',()=>{chat.mode=value;chat.confirm=false;this.renderMessage();});option.append(text,radio);modes.append(option);
        if(winners.length>100 && value==='group')radio.disabled=true;
      }
      const field=(label,control)=>{const wrap=make('label','rt-raffle-mini');wrap.append(make('span','rt-raffle-row-caption',label),control);return wrap;};
      const name=make('input','rt-raffle-input');name.type='text';name.maxLength=64;name.value=chat.groupName;name.disabled=chat.sending || chat.done;name.addEventListener('input',()=>{chat.groupName=name.value;chat.confirm=false;this.syncSend();});
      const area=make('textarea','rt-raffle-input rt-raffle-textarea');area.rows=4;area.maxLength=2000;area.value=chat.text;area.disabled=chat.sending || chat.done;
      const preview=make('p','rt-raffle-preview m-0');
      const updatePreview=()=>{preview.textContent=this.fill(chat.text,chat.mode==='group'?winners:winners.slice(0,1));};
      area.addEventListener('input',()=>{chat.text=area.value;chat.confirm=false;updatePreview();this.syncSend();});updatePreview();
      box.append(heading,people,modes);
      if(chat.mode==='group')box.append(field('Group name',name));
      box.append(field('Message',area),make('p','rt-raffle-row-caption m-0','{user}, {title} and {link} are filled in for each chat.'),make('p','rt-raffle-row-caption m-0',chat.mode==='group'?'Preview':'Preview for u/'+winners[0].author),preview);
      const note=make('p','rt-raffle-send-note m-0');note.setAttribute('role','status');note.setAttribute('aria-live','polite');state.sendNote=note;box.append(note);
      this.syncSend();
    }
    syncSend(){
      const state=this.dialog,chat=state?.chat;if(!chat)return;const remaining=state.result.winners.filter(w=>chat.outcomes.get(w.author)?.state!=='sent'),count=remaining.length,retry=count<state.result.winners.length;
      state.send.disabled=chat.sending || chat.done || !chat.text.trim() || !count || chat.mode==='group' && chat.groupStarted;
      state.send.textContent=chat.done?'Sent':chat.sending?'Sending…':chat.confirm?'Confirm: send '+(chat.mode==='group'?'to the group':n(count)+' '+(count===1?'message':'messages')):(chat.mode==='group'?'Start group chat':(retry?'Send to the remaining '+n(count):'Send to '+n(count)+' '+(count===1?'winner':'winners')));
      state.send.classList.toggle('rt-raffle-confirm',chat.confirm);state.msgBack.disabled=chat.sending;
      // The note holds the confirmation warning, or the last send's outcome; nothing else clears it.
      if(state.sendNote && chat.confirm)state.sendNote.textContent='Messages are sent from your account and can’t be unsent.';
      else if(state.sendNote && !chat.sending && !chat.outcomes.size)state.sendNote.textContent='';
    }
    async sendMessages(){
      const state=this.dialog,chat=state?.chat;if(!chat || chat.sending || chat.done)return;
      if(!chat.confirm){chat.confirm=true;this.syncSend();return;}
      chat.sending=true;chat.confirm=false;this.renderMessage();
      // Only people not reached yet: a second send (after failures) never repeats a delivered message.
      const winners=state.result.winners.filter(w=>chat.outcomes.get(w.author)?.state!=='sent'),note=()=>state.sendNote,set=(winner,stateName,text)=>{chat.outcomes.set(winner.author,{state:stateName,text});const li=state.messageView.querySelector('[data-rt-recipient="'+CSS.escape(winner.author)+'"]');if(li){li.querySelector('.rt-raffle-person-state')?.remove();const tag=make('span','rt-raffle-person-state',text);tag.dataset.state=stateName;li.append(tag);}};
      let sent=0,failed=0,stopped='';
      try{
        const ready=await this.read({action:'chat-status'},{timeout:15000});
        if(!ready?.ready)throw Error('Reddit chat isn’t available on this page. Reload the page and try again.');
        // Chat IDs come from each winner's account (the bridge only messages accounts it resolved here).
        const ids=new Map();
        for(const winner of winners){if(this.dialog!==state)return;try{const account=await this.account(winner.author);if(account?.userId)ids.set(winner.author,account.userId);else set(winner,'failed','Account unavailable');}catch{set(winner,'failed','Couldn’t look up the account');}}
        if(chat.mode==='group'){
          const targets=winners.filter(w=>ids.has(w.author));note().textContent='Starting the group chat…';
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
            set(winner,'sending','Sending…');note().textContent='Sending '+n(sent+failed+1)+' of '+n(winners.length)+'…';
            let result;try{result=await this.read({action:'chat-send',userId:ids.get(winner.author),text:this.fill(chat.text,[winner])},{timeout:45000});}catch(error){result={sent:false,reason:error.message};}
            if(this.dialog!==state)return;
            if(result.sent){sent++;set(winner,'sent',result.existing?'Sent in your existing chat':'Sent');}
            else{failed++;set(winner,'failed',result.reason || 'Not sent');if(result.rateLimited)stopped=result.reason;}
          }
        }
      }catch(error){if(this.dialog!==state)return;stopped=error.message;for(const w of winners)if(!chat.outcomes.has(w.author))set(w,'skipped','Not sent');}
      chat.sending=false;chat.done=state.result.winners.every(w=>chat.outcomes.get(w.author)?.state==='sent');
      note().textContent=(chat.mode==='group'?(sent?'Group chat started with '+n(sent)+' '+(sent===1?'winner':'winners')+'.':'The group chat wasn’t started.'):'Sent to '+n(sent)+' of '+n(winners.length)+' winners.')+(failed?' '+n(failed)+' failed.':'')+(stopped?' '+stopped:'');
      this.syncSend();
    }
  }
  globalThis.RTRaffle=Object.freeze({Raffle,bridgeRead,defaultAvatar});
  if(window.top===window && globalThis.chrome?.runtime?.id && location.hostname!=='old.reddit.com')Object.defineProperty(globalThis,'RTRaffleInstance',{value:new Raffle()});
})();
