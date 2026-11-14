/* Raffles from a post's ⋯ menu (docs/raffle-spec.md). The menu item sits in the menu's own action slot
   (devvit-context-actions), measured identical to Reddit's items; the dialog uses Reddit's rpl-modal-card.
   Read-only: comments and account facts are read through the page bridge; nothing is posted or stored. */
(() => {
  'use strict';
  if(globalThis.RTRaffle)return;
  const M=globalThis.RTPostModel,R=globalThis.RTRaffleModel;if(!M || !R)return;
  const MORE_PAGES=40;
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
  const postPage=()=>location.pathname.match(/^\/(?:r\/[^/]+\/|user\/[^/]+\/)?comments\/([a-z0-9]{1,10})(?:\/|$)/i)?.[1]?.toLowerCase() || '';

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
        title:card?.getAttribute('post-title') || '',permalink:menu.getAttribute('permalink') || card?.getAttribute('permalink') || ''};
    }

    // --- Dialog (B2–B6)
    open(post,trigger=null){
      this.close();
      const dialog=make('dialog','rt-raffle-dialog');dialog.dataset.rtRaffle='dialog';dialog.setAttribute('aria-labelledby','rt-raffle-title');
      const card=make('rpl-modal-card','rt-raffle-card');card.setAttribute('appearance','modal');
      const head=make('div','flex h-xl items-center mt-md px-md');head.slot='title';const h2=make('h2','m-0 text-title-3 text-neutral-content-strong','Run a raffle');h2.id='rt-raffle-title';head.append(h2);
      const close=make('button','mt-md me-md button-small button-secondary icon items-center justify-center button inline-flex');close.type='button';close.slot='close-button';close.setAttribute('aria-label','Close');close.append(icon(CLOSE,16));
      const body=make('div','rt-raffle-body');
      const subtitle=make('p','rt-raffle-post text-14 text-neutral-content-weak m-0',post.title || 'Post '+post.id);
      const form=make('form','rt-raffle-form');form.noValidate=true;
      const field=(label,input,hint)=>{const wrap=make('label','rt-raffle-field');wrap.append(make('span','rt-raffle-label',label),input);if(hint)wrap.append(make('span','rt-raffle-hint',hint));return wrap;};
      const number=(name,value,min,max)=>{const input=make('input');input.type='number';input.name=name;input.value=String(value);input.min=String(min);input.max=String(max);input.inputMode='numeric';return input;};
      const check=(name,label,checked)=>{const wrap=make('label','rt-raffle-check');const input=make('input');input.type='checkbox';input.name=name;input.checked=checked;wrap.append(input,make('span','',label));return wrap;};
      const text=(name,placeholder)=>{const input=make('input');input.type='text';input.name=name;input.placeholder=placeholder;input.maxLength=name==='excludeUsers'?2000:100;return input;};
      const winners=number('winners',1,1,R.MAX_WINNERS);
      const grid=make('div','rt-raffle-grid');grid.append(field('Minimum account age (days)',number('minAccountAgeDays',0,0,36500)),field('Minimum comment karma',number('minCommentKarma',0,0,1e9)),field('Minimum post karma',number('minPostKarma',0,0,1e9)),field('Minimum total karma',number('minTotalKarma',0,0,1e9)));
      form.append(field('Number of winners',winners),check('topLevelOnly','Top-level comments only',true),check('excludeAuthor','Exclude the post’s author',true),grid,
        field('Comment must include',text('mustInclude','Any text'),'Leave empty to accept every comment'),field('Exclude users',text('excludeUsers','u/name, u/other'),'Separate names with spaces or commas'));
      const status=make('p','rt-raffle-status text-12 text-neutral-content-weak m-0');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
      const ackWrap=check('acknowledge','Draw from the comments read',false);ackWrap.hidden=true;ackWrap.classList.add('rt-raffle-ack');
      const results=make('section','rt-raffle-results');results.hidden=true;results.setAttribute('aria-label','Winners');
      body.append(subtitle,form,status,ackWrap,results);
      const cancel=make('button','button-medium button-secondary button inline-flex items-center justify-center px-md','Cancel');cancel.type='button';cancel.slot='secondary-button';
      const draw=make('button','button-medium button-primary button inline-flex items-center justify-center px-md','Draw winners');draw.type='button';draw.slot='primary-button';draw.disabled=true;
      card.append(head,close,body,cancel,draw);dialog.append(card);document.body.append(dialog);
      const state=this.dialog={dialog,post,trigger,form,winners,status,ack:ackWrap.querySelector('input'),ackWrap,results,draw,cancel,controller:new AbortController(),entries:new Map(),coverage:null,reading:false,drawing:false,accounts:new Map(),generation:0};
      const finish=()=>this.close();
      close.addEventListener('click',finish);cancel.addEventListener('click',finish);
      dialog.addEventListener('cancel',event=>{event.preventDefault();finish();});
      dialog.addEventListener('click',event=>{if(event.target===dialog)finish();});
      form.addEventListener('input',event=>{if(event.target.name==='topLevelOnly')this.readEntries();else this.updateSummary();});
      form.addEventListener('change',event=>{if(event.target.name==='topLevelOnly')return;this.updateSummary();});
      form.addEventListener('submit',event=>{event.preventDefault();if(!draw.disabled)this.drawWinners();});
      state.ack.addEventListener('change',()=>this.updateSummary());
      draw.addEventListener('click',()=>this.drawWinners());
      try{dialog.showModal();}catch{dialog.setAttribute('open','');}
      winners.focus({preventScroll:true});
      this.readEntries();
      return state;
    }
    close(){
      const state=this.dialog;if(!state)return;this.dialog=null;state.controller.abort();
      try{state.dialog.close();}catch{}state.dialog.remove();
      if(state.trigger?.isConnected)state.trigger.focus({preventScroll:true});
    }
    rules(){const state=this.dialog,data=new FormData(state.form);const raw=Object.fromEntries(data.entries());raw.topLevelOnly=state.form.elements.topLevelOnly.checked;raw.excludeAuthor=state.form.elements.excludeAuthor.checked;return R.normalizeRules(raw);}

    // B3/B4: read the thread JSON, then Reddit's "more comments" chain for top-level comments it listed but didn't return.
    async readEntries(){
      const state=this.dialog;if(!state)return;
      const generation=++state.generation,topLevelOnly=state.form.elements.topLevelOnly.checked,signal=state.controller.signal,current=()=>this.dialog===state && state.generation===generation;
      state.reading=true;state.entries=new Map();state.coverage=null;state.results.hidden=true;this.updateSummary('Reading comments…');
      try{
        const thread=await this.read({action:'raffle-thread',postId:state.post.id,topLevelOnly},{signal,timeout:45000});if(!current())return;
        if(thread.post?.author)state.post.author=thread.post.author;
        const add=list=>{for(const raw of list || []){const item=R.entry(raw,{postId:state.post.id});if(item && !state.entries.has(item.id))state.entries.set(item.id,item);}};
        add(thread.entries);
        const missing=new Set((thread.missingTopLevel || []).filter(id=>!state.entries.has(id)));let moreAvailable=true,pages=0;
        if(missing.size){
          let loader=null;
          do{
            this.updateSummary('Reading comments… '+n(state.entries.size)+' so far');
            const page=await this.read({action:'raffle-more',postId:state.post.id,loader,missing:[...missing].slice(0,20000)},{signal,timeout:45000});if(!current())return;
            if(page.available===false){moreAvailable=false;break;}
            for(const raw of page.entries || []){const id=String(raw?.id || '').toLowerCase();if(missing.has(id)){missing.delete(id);add([raw]);}}
            loader=page.next || null;pages++;
          }while(loader && missing.size && pages<MORE_PAGES);
        }
        state.coverage={topLevelRead:[...state.entries.values()].filter(e=>e.topLevel).length,missing:missing.size,missingReplies:topLevelOnly?0:Number(thread.missingReplies) || 0,moreAvailable,topLevelOnly};
      }catch(error){if(current())state.error=error.message;}
      finally{if(current()){state.reading=false;this.updateSummary();}}
    }
    coverageText(){
      const state=this.dialog,c=state.coverage;if(!c)return '';
      const total=c.topLevelRead+c.missing;
      let text=c.missing?'Read '+n(c.topLevelRead)+' of '+n(total)+' top-level comments'+(c.moreAvailable?'':' · Open the post to read the rest'):'Read all '+n(total)+' top-level '+(total===1?'comment':'comments');
      if(!c.topLevelOnly)text+=' and '+n(state.entries.size-c.topLevelRead)+' replies'+(c.missingReplies?' · '+n(c.missingReplies)+' replies behind “more replies” weren’t read':'');
      return text;
    }
    incomplete(){const c=this.dialog?.coverage;return Boolean(c && (c.missing || c.missingReplies));}
    updateSummary(message){
      const state=this.dialog;if(!state)return;
      if(state.error && !state.reading){state.status.textContent='Couldn’t read the comments: '+state.error.replace(/\.$/,'')+'.';state.status.dataset.error='true';state.draw.disabled=true;state.ackWrap.hidden=true;return;}
      delete state.status.dataset.error;
      if(message || state.reading){state.status.textContent=message || 'Reading comments…';state.draw.disabled=true;return;}
      if(state.drawing){state.draw.disabled=true;return;}
      const rules=this.rules(),pool=R.candidates([...state.entries.values()],rules,{postAuthor:state.post.author});
      state.pool=pool;const eligible=pool.candidates.length;
      state.status.textContent=this.coverageText()+' · '+n(eligible)+' eligible '+(eligible===1?'entrant':'entrants')+(R.needsAccount(rules)?' before account checks':'');
      state.ackWrap.hidden=!this.incomplete();
      state.draw.disabled=!eligible || this.incomplete() && !state.ack.checked;
    }
    // B5/B6
    async drawWinners(){
      const state=this.dialog;if(!state || state.reading || state.drawing)return;this.updateSummary();if(state.draw.disabled)return;
      const rules=this.rules(),pool=state.pool,signal=state.controller.signal;state.drawing=true;state.draw.disabled=true;state.status.textContent='Drawing…';
      const lookup=async name=>{const key=name.toLowerCase();if(!state.accounts.has(key))state.accounts.set(key,this.read({action:'raffle-user',username:name},{signal,timeout:20000}));return state.accounts.get(key);};
      try{
        const drawnAt=Math.floor(Date.now()/1000);
        const result=await R.draw(pool.candidates,rules,{lookup,random:this.random,signal,onProgress:({checked,winners})=>{if(this.dialog===state)state.status.textContent='Drawing… checked '+n(checked)+' '+(checked===1?'account':'accounts')+', '+n(winners)+' '+(winners===1?'winner':'winners')+' so far';}});
        if(this.dialog!==state)return;this.renderResults(result,rules,drawnAt);
      }catch(error){if(this.dialog===state)state.status.textContent='The draw stopped: '+error.message.replace(/\.$/,'')+'.';}
      finally{if(this.dialog===state){state.drawing=false;state.draw.textContent='Draw again';this.updateSummaryAfterDraw();}}
    }
    updateSummaryAfterDraw(){const state=this.dialog;if(!state)return;state.draw.disabled=!state.pool?.candidates.length || this.incomplete() && !state.ack.checked;}
    renderResults(result,rules,drawnAt){
      const state=this.dialog,box=state.results;box.replaceChildren();box.hidden=false;
      const list=make('ol','rt-raffle-winners');
      for(const winner of result.winners){
        const li=make('li','rt-raffle-winner'),name=make('a','font-semibold text-neutral-content-strong','u/'+winner.author);name.href='/user/'+encodeURIComponent(winner.author)+'/';
        const parts=[name];if(winner.permalink){const link=make('a','rt-raffle-comment-link','comment');link.href=winner.permalink;parts.push(document.createTextNode(' · '),link);}
        const line=winner.body.split('\n')[0].trim();if(line)parts.push(make('span','rt-raffle-excerpt text-neutral-content-weak',' · '+(line.length>120?line.slice(0,119)+'…':line)));
        li.append(...parts);list.append(li);
      }
      const reasons={age:'too new',commentKarma:'comment karma too low',postKarma:'post karma too low',totalKarma:'total karma too low',suspended:'suspended',unavailable:'deleted or unavailable',unchecked:'couldn’t be checked'};
      const skipped=Object.entries(result.skipped).map(([key,count])=>n(count)+' '+(reasons[key] || key)).join(', ');
      const eligible=result.poolSize;
      const summary=make('p','rt-raffle-result-summary text-12 text-neutral-content-weak m-0',
        (result.winners.length?n(result.winners.length)+' '+(result.winners.length===1?'winner':'winners')+' from '+n(eligible)+' eligible '+(eligible===1?'entrant':'entrants'):'No winners')+
        (result.shortBy?' · Only '+n(result.winners.length)+' '+(result.winners.length===1?'entrant passes':'entrants pass')+' the rules':'')+(skipped?' · Skipped: '+skipped:'')+' · Drawn '+new Date(drawnAt*1000).toLocaleString());
      const copy=make('button','button-small button-secondary button inline-flex items-center justify-center px-md','Copy results');copy.type='button';
      const markdown=R.resultsMarkdown({winners:result.winners,rules,poolSize:eligible,drawnAt,postUrl:state.post.permalink?'https://www.reddit.com'+state.post.permalink:''});
      copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(markdown);copy.textContent='Copied';}catch{copy.textContent='Couldn’t copy';}setTimeout(()=>{if(copy.isConnected)copy.textContent='Copy results';},2000);});
      box.append(make('h3','text-14 font-semibold m-0 text-neutral-content-strong','Winners'),list,summary,copy);box.dataset.markdown=markdown;
      state.status.textContent=this.coverageText();
    }
  }
  globalThis.RTRaffle=Object.freeze({Raffle,bridgeRead});
  if(window.top===window && globalThis.chrome?.runtime?.id && location.hostname!=='old.reddit.com')Object.defineProperty(globalThis,'RTRaffleInstance',{value:new Raffle()});
})();
