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
      this.ready=this.loadSettings();
    }
    async loadSettings(){let settings=null;try{settings=M.normalizeSettings(await this.readSettings());}catch{}this.enabled=Boolean(settings?.raffles);this.sync();}
    destroy(){this.dead=true;this.observer?.disconnect();try{chrome.storage?.onChanged?.removeListener(this.onSettings);}catch{}try{chrome.runtime?.onMessage?.removeListener(this.onSettingsMessage);}catch{}this.close();for(const item of document.querySelectorAll('[data-rt-raffle="item"]'))item.remove();}

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

    // --- Dialog (B2–B6): a rules screen and a separate results screen, in Reddit's rpl-modal-card.
    open(post,trigger=null){
      this.close();
      const narrow=globalThis.matchMedia?.(MOBILE)?.matches===true;
      const dialog=make('dialog','rt-raffle-dialog'+(narrow?' rt-raffle-sheet':''));dialog.dataset.rtRaffle='dialog';dialog.setAttribute('aria-labelledby','rt-raffle-title');
      const card=make('rpl-modal-card','rt-raffle-card');card.setAttribute('appearance',narrow?'bottom-sheet':'modal');
      const head=make('div','flex h-xl items-center mt-md px-md');head.slot='title';const h2=make('h2','m-0 text-title-3 text-neutral-content-strong','Run a raffle');h2.id='rt-raffle-title';head.append(h2);
      const close=make('button','mt-md me-md button-small button-secondary icon items-center justify-center button inline-flex');close.type='button';close.slot='close-button';close.setAttribute('aria-label','Close');close.append(icon(CLOSE,16));
      const body=make('div','rt-raffle-body');
      // Post line: community and title, like Reddit's crosspost preview.
      const postLine=make('div','rt-raffle-post');postLine.append(make('span','rt-raffle-post-sub text-12 font-semibold text-neutral-content-weak',post.subreddit?'r/'+post.subreddit:''),make('span','rt-raffle-post-title text-14 text-neutral-content-strong',post.title || 'Post '+post.id));
      // Rules screen.
      const rulesView=make('div','rt-raffle-view');rulesView.dataset.rtRaffleView='rules';
      const form=make('form','rt-raffle-form');form.noValidate=true;
      const field=(label,input,hint)=>{const wrap=make('label','rt-raffle-field');wrap.append(make('span','rt-raffle-label',label),input);if(hint)wrap.append(make('span','rt-raffle-hint',hint));return wrap;};
      const number=(name,value,min,max)=>{const input=make('input');input.type='number';input.name=name;input.value=String(value);input.min=String(min);input.max=String(max);input.inputMode='numeric';return input;};
      const check=(name,label,checked,hint)=>{const wrap=make('label','rt-raffle-check');const input=make('input');input.type='checkbox';input.name=name;input.checked=checked;const text=make('span','rt-raffle-check-text');text.append(make('span','',label));if(hint)text.append(make('span','rt-raffle-hint',hint));wrap.append(input,text);return wrap;};
      const text=(name,placeholder)=>{const input=make('input');input.type='text';input.name=name;input.placeholder=placeholder;input.maxLength=name==='excludeUsers'?2000:100;input.autocomplete='off';return input;};
      let sections=0;const section=(title,...children)=>{const box=make('div','rt-raffle-section'),id='rt-raffle-section-'+(++sections);box.setAttribute('role','group');box.setAttribute('aria-labelledby',id);const h=make('h3','rt-raffle-section-title',title);h.id=id;box.append(h,...children);return box;};
      const winners=number('winners',1,1,R.MAX_WINNERS);
      const stepper=make('div','rt-raffle-stepper');const minus=make('button','button-small button-secondary icon button inline-flex items-center justify-center','−'),plus=make('button','button-small button-secondary icon button inline-flex items-center justify-center','+');
      for(const [b,label,delta] of [[minus,'Fewer winners',-1],[plus,'More winners',1]]){b.type='button';b.setAttribute('aria-label',label);b.addEventListener('click',()=>{winners.value=String(Math.min(R.MAX_WINNERS,Math.max(1,(Number(winners.value) || 1)+delta)));winners.dispatchEvent(new Event('input',{bubbles:true}));});}
      stepper.append(minus,winners,plus);
      const account=make('details','rt-raffle-section rt-raffle-account');const summary=make('summary','rt-raffle-section-title','Account requirements');const accountHint=make('span','rt-raffle-summary-hint','None');summary.append(accountHint);
      const grid=make('div','rt-raffle-grid');grid.append(field('Account age (days)',number('minAccountAgeDays',0,0,36500)),field('Comment karma',number('minCommentKarma',0,0,1e9)),field('Post karma',number('minPostKarma',0,0,1e9)),field('Total karma',number('minTotalKarma',0,0,1e9)));
      account.append(summary,make('p','rt-raffle-hint','Minimums, checked only for the accounts a draw reaches.'),grid);
      form.append(section('Winners',field('How many',stepper)),
        section('Who can enter',check('topLevelOnly','Top-level comments only',true,'Replies don’t count as entries'),check('excludeAuthor','Exclude the post’s author',true),field('Comment must include',text('mustInclude','Any comment'),'For example a code word from the post'),field('Exclude users',text('excludeUsers','u/name, u/other'))),
        account);
      // Status card: progress while reading, then the entry count.
      const statusCard=make('div','rt-raffle-status-card');const status=make('p','rt-raffle-status m-0');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
      const progress=make('div','rt-raffle-progress');progress.setAttribute('aria-hidden','true');progress.append(make('span'));statusCard.append(status,progress);
      const ackWrap=check('acknowledge','Draw from the comments read',false,'Reddit didn’t return every comment, so some entrants can’t win');ackWrap.hidden=true;ackWrap.classList.add('rt-raffle-ack');
      rulesView.append(statusCard,ackWrap,form);
      // Results screen.
      const resultsView=make('section','rt-raffle-view rt-raffle-results');resultsView.dataset.rtRaffleView='results';resultsView.hidden=true;resultsView.setAttribute('aria-label','Winners');
      body.append(postLine,rulesView,resultsView);
      const button=(label,slot,kind)=>{const b=make('button','button-medium button-'+kind+' button inline-flex items-center justify-center px-md',label);b.type='button';b.slot=slot;return b;};
      const cancel=button('Cancel','secondary-button','secondary'),draw=button('Draw winners','primary-button','primary');draw.disabled=true;
      const back=button('Back to rules','secondary-button','secondary'),again=button('Draw again','primary-button','primary'),copy=button('Copy results','tertiary-button','plain');
      for(const b of [back,again,copy])b.hidden=true;
      card.append(head,close,body,cancel,draw,copy,back,again);dialog.append(card);document.body.append(dialog);
      const state=this.dialog={dialog,card,post,trigger,h2,form,winners,status,statusCard,progress,accountHint,ack:ackWrap.querySelector('input'),ackWrap,rulesView,resultsView,draw,cancel,back,again,copy,
        controller:new AbortController(),entries:new Map(),coverage:null,reading:false,drawing:false,accounts:new Map(),generation:0,view:'rules'};
      const finish=()=>this.close();
      close.addEventListener('click',finish);cancel.addEventListener('click',finish);
      dialog.addEventListener('cancel',event=>{event.preventDefault();finish();});
      dialog.addEventListener('click',event=>{if(event.target===dialog)finish();});
      form.addEventListener('input',event=>{if(event.target.name==='topLevelOnly')this.readEntries();else this.updateSummary();});
      form.addEventListener('change',event=>{if(event.target.name!=='topLevelOnly')this.updateSummary();});
      form.addEventListener('submit',event=>{event.preventDefault();if(!draw.disabled)this.drawWinners();});
      state.ack.addEventListener('change',()=>this.updateSummary());
      draw.addEventListener('click',()=>this.drawWinners());again.addEventListener('click',()=>this.drawWinners());
      back.addEventListener('click',()=>this.showView('rules'));
      copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(state.markdown || '');copy.textContent='Copied';}catch{copy.textContent='Couldn’t copy';}setTimeout(()=>{if(copy.isConnected)copy.textContent='Copy results';},2000);});
      try{dialog.showModal();}catch{dialog.setAttribute('open','');}
      winners.focus({preventScroll:true});
      this.readEntries();
      return state;
    }
    showView(view){
      const state=this.dialog;if(!state)return;state.view=view;const results=view==='results';
      state.rulesView.hidden=results;state.resultsView.hidden=!results;state.h2.textContent=results?'Winners':'Run a raffle';
      state.cancel.hidden=results;state.draw.hidden=results;for(const b of [state.back,state.again,state.copy])b.hidden=!results;
      // Focus the results heading (not a row) so screen readers announce it without a focus ring on a winner.
      (results?state.resultsView.querySelector('.rt-raffle-banner-title'):state.winners)?.focus?.({preventScroll:true});
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
      const rules=state.form?this.rules():null;
      if(rules){const active=[rules.minAccountAgeDays?rules.minAccountAgeDays+' days':'',rules.minCommentKarma?'comment karma '+n(rules.minCommentKarma):'',rules.minPostKarma?'post karma '+n(rules.minPostKarma):'',rules.minTotalKarma?'total karma '+n(rules.minTotalKarma):''].filter(Boolean);state.accountHint.textContent=active.length?active.join(', '):'None';}
      if(state.error && !state.reading){state.status.textContent='Couldn’t read the comments: '+state.error.replace(/\.$/,'')+'.';state.statusCard.dataset.state='error';state.draw.disabled=true;state.ackWrap.hidden=true;return;}
      if(message || state.reading){state.status.textContent=message || 'Reading comments…';state.statusCard.dataset.state='loading';state.draw.disabled=true;return;}
      if(state.drawing){state.draw.disabled=true;state.again.disabled=true;return;}
      const pool=R.candidates([...state.entries.values()],rules,{postAuthor:state.post.author});
      state.pool=pool;const eligible=pool.candidates.length;
      state.statusCard.dataset.state=this.incomplete()?'warning':'ready';
      state.status.textContent='';const strong=make('strong','',n(eligible)+' eligible '+(eligible===1?'entrant':'entrants'));
      state.status.append(strong,document.createTextNode(' · '+this.coverageText()+(R.needsAccount(rules)?' · account minimums are checked during the draw':'')));
      state.ackWrap.hidden=!this.incomplete();
      const blocked=!eligible || this.incomplete() && !state.ack.checked;state.draw.disabled=blocked;state.again.disabled=blocked;
    }
    // B5
    async drawWinners(){
      const state=this.dialog;if(!state || state.reading || state.drawing)return;this.updateSummary();if(state.draw.disabled)return;
      const rules=this.rules(),pool=state.pool,signal=state.controller.signal;state.drawing=true;state.draw.disabled=true;state.again.disabled=true;state.status.textContent='Drawing…';
      const lookup=name=>{const key=name.toLowerCase();if(!state.accounts.has(key))state.accounts.set(key,this.read({action:'raffle-user',username:name},{signal,timeout:20000}));return state.accounts.get(key);};
      try{
        const drawnAt=Math.floor(Date.now()/1000);
        const result=await R.draw(pool.candidates,rules,{lookup,random:this.random,signal,onProgress:({checked,winners})=>{if(this.dialog===state)state.status.textContent='Drawing… checked '+n(checked)+' '+(checked===1?'account':'accounts')+', '+n(winners)+' '+(winners===1?'winner':'winners')+' so far';}});
        if(this.dialog!==state)return;state.drawing=false;this.renderResults(result,rules,drawnAt);this.showView('results');this.fillAvatars(result.winners);
      }catch(error){if(this.dialog===state){state.drawing=false;state.status.textContent='The draw stopped: '+error.message.replace(/\.$/,'')+'.';}}
      finally{if(this.dialog===state){state.drawing=false;this.updateSummary();}}
    }
    // B6: winners as Reddit comment rows; each row opens its comment.
    renderResults(result,rules,drawnAt){
      const state=this.dialog,box=state.resultsView;box.replaceChildren();
      const eligible=result.poolSize,count=result.winners.length;
      const banner=make('div','rt-raffle-banner');
      const bannerTitle=make('p','rt-raffle-banner-title m-0');bannerTitle.tabIndex=-1;banner.append(bannerTitle);bannerTitle.textContent=(count?n(count)+' '+(count===1?'winner':'winners')+' from '+n(eligible)+' eligible '+(eligible===1?'entrant':'entrants'):'No winners');
      banner.append(make('p','rt-raffle-banner-meta m-0','Drawn '+new Date(drawnAt*1000).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'})+' · random, one entry per user'));
      box.append(banner);
      if(result.shortBy)box.append(make('p','rt-raffle-note m-0','Only '+n(count)+' '+(count===1?'entrant passes':'entrants pass')+' the rules, '+n(result.shortBy)+' fewer than asked.'));
      const list=make('ol','rt-raffle-winners');
      result.winners.forEach((winner,index)=>list.append(this.winnerRow(winner,index+1)));
      box.append(list);
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
      const href=winner.permalink || '#';
      // The whole row opens the comment (new tab, so the results stay); the name opens the profile.
      const cover=make('a','rt-raffle-cover');cover.href=href;cover.target='_blank';cover.rel='noopener';cover.setAttribute('aria-label','Open u/'+winner.author+'’s comment');
      const badge=make('span','rt-raffle-rank',String(rank));badge.setAttribute('aria-label','Winner '+rank);
      const avatar=make('span','rt-raffle-avatar');const img=make('img');img.alt='';img.width=32;img.height=32;img.decoding='async';img.referrerPolicy='no-referrer';img.src=winner.avatar || defaultAvatar(winner.author);img.addEventListener('error',()=>{if(img.src!==defaultAvatar(winner.author))img.src=defaultAvatar(winner.author);},{once:true});avatar.append(img);
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
    // Profile pictures for winners the thread JSON didn't carry them for (from about.json, cached with account checks).
    async fillAvatars(winners){
      const state=this.dialog;if(!state)return;const signal=state.controller.signal;
      const missing=winners.filter(w=>!w.avatar);
      for(let i=0;i<missing.length;i+=3)await Promise.all(missing.slice(i,i+3).map(async winner=>{
        try{const key=winner.author.toLowerCase();if(!state.accounts.has(key))state.accounts.set(key,this.read({action:'raffle-user',username:winner.author},{signal,timeout:20000}));
          const account=await state.accounts.get(key);if(this.dialog!==state || !account?.avatar)return;winner.avatar=account.avatar;
          const img=state.resultsView.querySelector('.rt-raffle-winner[data-rt-winner="'+CSS.escape(winner.author)+'"] img');if(img)img.src=account.avatar;}catch{}
      }));
    }
  }
  globalThis.RTRaffle=Object.freeze({Raffle,bridgeRead,defaultAvatar});
  if(window.top===window && globalThis.chrome?.runtime?.id && location.hostname!=='old.reddit.com')Object.defineProperty(globalThis,'RTRaffleInstance',{value:new Raffle()});
})();
