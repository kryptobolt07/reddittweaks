/* Bulk redaction dialog (docs/redaction-spec.md): find (dry run) → typed confirmation → overwrite, then delete.
   Opened by the address fragment #rt-redact (the popup's "Redact my posts and comments…"). Reads and writes go
   through the page bridge, which holds the modhash and only writes to items it read from your own lists. */
(() => {
  'use strict';
  if(globalThis.RTRedaction)return;
  const X=globalThis.RTRedactionModel,F=globalThis.RTFeedFilters;if(!X || !F)return;
  const FRAGMENT='#rt-redact',PAGES_PER_LIST=10,PREVIEW_ROWS=50;
  const SOURCES=[['overview','new'],['submitted','top'],['submitted','controversial'],['comments','top'],['comments','controversial']];
  const operations={'overwrite-delete':'Overwrite, then delete',overwrite:'Overwrite text',delete:'Delete'};
  const settingsRead=async()=>{const result=await chrome.runtime.sendMessage({scope:'rt-posts',action:'get-settings'});return result?.ok?result.settings:{};};
  const make=(tag,cls,text)=>{let el;if(tag.includes('-')){const holder=document.createElement('div');holder.innerHTML='<'+tag+'></'+tag+'>';el=holder.firstElementChild;el.remove();}else el=document.createElement(tag);if(cls)el.className=cls;if(text!=null && text!=='')el.textContent=text;return el;};
  const n=value=>Number(value).toLocaleString('en-US');
  const dateText=seconds=>new Date(seconds*1000).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});
  const CLOSE='m11.273 10 5.363-5.363a.9.9 0 10-1.273-1.273L10 8.727 4.637 3.364a.9.9 0 10-1.273 1.273L8.727 10l-5.363 5.363a.9.9 0 101.274 1.273L10 11.273l5.363 5.363a.897.897 0 001.274 0 .9.9 0 000-1.273L11.275 10Z';
  function closeIcon(){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');for(const [k,v] of Object.entries({fill:'currentColor',height:'16',width:'16',viewBox:'0 0 20 20','aria-hidden':'true'}))svg.setAttribute(k,v);const p=document.createElementNS(svg.namespaceURI,'path');p.setAttribute('d',CLOSE);svg.append(p);return svg;}
  const sleepFor=(ms,signal)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{signal?.removeEventListener('abort',stop);resolve();},ms);const stop=()=>{clearTimeout(timer);reject(Object.assign(Error('Stopped.'),{stopped:true}));};if(signal?.aborted)stop();else signal?.addEventListener('abort',stop,{once:true});});

  class Redaction {
    constructor({read=(...args)=>globalThis.RTRaffle.bridgeRead(...args),sleep=sleepFor,readSettings=settingsRead,aggregate=args=>globalThis.RTArchiveQuery?.aggregate(args),observe=true}={}){
      this.read=read;this.sleep=sleep;this.readSettings=readSettings;this.aggregate=aggregate;this.state=null;this.dead=false;
      if(observe){this.onHash=()=>this.checkFragment();addEventListener('hashchange',this.onHash);this.checkFragment();}
    }
    destroy(){this.dead=true;if(this.onHash)removeEventListener('hashchange',this.onHash);this.close(true);}
    checkFragment(){
      if(this.dead || location.hash!==FRAGMENT)return;
      // Remove the fragment once (a different address, so Reddit's router doesn't reload; contract F3).
      try{history.replaceState(history.state,'',location.pathname+location.search);}catch{}
      this.open();
    }
    open(){
      if(this.state){this.state.dialog.querySelector('input,select,textarea')?.focus();return this.state;}
      const dialog=make('dialog','rt-raffle-dialog rt-redact-dialog');dialog.dataset.rtRedact='dialog';dialog.setAttribute('aria-labelledby','rt-redact-title');
      const card=make('rpl-modal-card','rt-raffle-card');card.setAttribute('appearance','modal');
      const head=make('div','flex h-xl items-center mt-md px-md');head.slot='title';const h2=make('h2','m-0 text-title-3 text-neutral-content-strong','Redact your posts and comments');h2.id='rt-redact-title';head.append(h2);
      const close=make('button','mt-md me-md button-small button-secondary icon items-center justify-center button inline-flex');close.type='button';close.slot='close-button';close.setAttribute('aria-label','Close');close.append(closeIcon());
      const body=make('div','rt-raffle-body');
      const step=make('p','rt-redact-step text-12 text-neutral-content-weak m-0','Step 1 of 3 · Choose filters');
      const intro=make('p','text-14 text-neutral-content-weak m-0','Overwrites the text of the items you choose, then deletes them. This can’t be undone, and archives that already saved an item keep their copy.');
      const form=make('form','rt-raffle-form');form.noValidate=true;
      const field=(label,input,hint)=>{const wrap=make('label','rt-raffle-field');wrap.append(make('span','rt-raffle-label',label),input);if(hint)wrap.append(make('span','rt-raffle-hint',hint));return wrap;};
      const input=(name,type,placeholder='')=>{const el=make('input');el.type=type;el.name=name;el.placeholder=placeholder;if(type==='number')el.inputMode='numeric';return el;};
      const area=(name,value='',placeholder='')=>{const el=make('textarea','rt-redact-area');el.name=name;el.value=value;el.placeholder=placeholder;el.rows=2;return el;};
      const group=(title,...fields)=>{const box=make('fieldset','rt-redact-group');box.append(make('legend','text-14 font-semibold',title),...fields);return box;};
      const controls={};
      const choice=(name,label,icon,value,initial)=>{
        const hidden=input(name,'hidden');hidden.value=value;
        const button=make('button','rt-redact-control');button.type='button';button.dataset.rtRedactFilter=name;button.setAttribute('aria-label',label);button.setAttribute('aria-haspopup',name==='date'?'dialog':'menu');button.setAttribute('aria-expanded','false');
        const caption=make('span','rt-redact-control-value',initial);button.append(F.svgIcon(icon,20),caption,F.svgIcon('caret-down',16));
        button.addEventListener('click',()=>name==='date'?this.openCalendar():this.openFilter(name));controls[name]={button,caption,input:hidden};
        const wrap=make('div','rt-raffle-field');wrap.append(make('span','rt-raffle-label',label),button,hidden);return wrap;
      };
      const kindsField=choice('kinds','Content type','collection','both','Posts and comments'),kinds=controls.kinds.input;
      const from=input('from','hidden'),to=input('to','hidden');
      const dateField=choice('date','Date range','calendar','','Any date'),dateButton=controls.date.button;
      dateField.append(from,to);
      const dateHost=make('div','rt-redact-popover rt-redact-calendar');dateHost.hidden=true;dialog.append(dateHost);
      const includeField=choice('onlyIn','Include communities','community','','All communities');
      const excludeField=choice('neverIn','Exclude communities','community','','None excluded');
      const actionField=choice('operation','Action','collection','overwrite-delete',operations['overwrite-delete']);
      const messageField=field('Replacement message',area('text',X.DEFAULT_TEXT),'Edit this message before finding matches. Items without editable text can only be deleted.');
      messageField.querySelector('textarea').maxLength=1000;
      const full=el=>{el.classList.add('rt-redact-full');return el;};
      form.append(group('Find items',kindsField,dateField,field('Minimum age (days)',input('olderThanDays','number','Any age')),
        includeField,full(field('Include text',input('onlyContaining','text','Words in the title or text')))),
        group('Keep items safe',excludeField,field('Minimum votes to keep',input('keepScoreAtLeast','number','Not set')),
        full(make('p','rt-raffle-hint','10 keeps items with 10 or more votes. Leave empty to ignore votes.')),
        full(field('Keep text containing',input('keepContaining','text','Words to protect'))),full(field('Keep specific items',area('keep','','Reddit links or item IDs, separated by spaces')))),
        group('Action and message',actionField,messageField));
      const status=make('p','rt-raffle-status text-12 text-neutral-content-weak m-0');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
      const preview=make('section','rt-redact-preview');preview.hidden=true;preview.setAttribute('aria-label','Matching items');
      const confirmWrap=make('label','rt-raffle-field rt-redact-confirm');confirmWrap.hidden=true;const confirm=input('confirm','text');confirm.autocomplete='off';confirm.spellcheck=false;
      const confirmLabel=make('span','rt-raffle-label');confirmWrap.append(confirmLabel,confirm);
      const results=make('section','rt-redact-results');results.hidden=true;
      const confirmation=make('section','rt-redact-confirmation');confirmation.hidden=true;confirmation.append(confirmWrap);
      body.append(step,intro,form,status,preview,confirmation,results);
      const cancel=make('button','button-medium button-secondary button inline-flex items-center justify-center px-md','Cancel');cancel.type='button';cancel.slot='secondary-button';
      const primary=make('button','button-medium button-primary button inline-flex items-center justify-center px-md','Find matching items');primary.type='button';primary.slot='primary-button';
      card.append(head,close,body,cancel,primary);dialog.append(card);document.body.append(dialog);
      const state=this.state={dialog,h2,step,intro,form,messageField,controls,dateButton,dateHost,from,to,status,preview,confirmation,confirm,confirmWrap,confirmLabel,results,primary,cancel,username:'',items:new Map(),selection:null,phase:'idle',controller:new AbortController(),finding:null,running:null,closeAsked:false};
      const requestClose=()=>this.close();
      close.addEventListener('click',requestClose);cancel.addEventListener('click',()=>{
        if(state.phase==='confirming'){state.phase='previewed';state.confirm.value='';this.showStep('review');this.syncSelection();}
        else if(state.phase==='previewed')this.clearPreview();
        else if(state.phase==='running'){state.stopController.abort();state.status.textContent='Stopping after the current request…';}
        else requestClose();
      });
      dialog.addEventListener('cancel',event=>{event.preventDefault();if(state.popup)this.closeFilter();else requestClose();});
      dialog.addEventListener('click',event=>{if(event.target===dialog)requestClose();});
      // Any rule change invalidates the preview: the run must use exactly what was previewed.
      form.addEventListener('input',()=>{if(['previewed','confirming','done'].includes(state.phase))this.clearPreview();this.syncOperation();});
      form.addEventListener('submit',event=>event.preventDefault());
      confirm.addEventListener('input',()=>this.syncPrimary());
      primary.addEventListener('click',()=>{
        if(state.phase==='previewed')this.showConfirmation();
        else if(state.phase==='confirming')this.runRedaction();
        else if(['idle','done','error'].includes(state.phase))this.find();
      });
      try{dialog.showModal();}catch{dialog.setAttribute('open','');}
      this.syncOperation();controls.kinds.button.focus({preventScroll:true});
      return state;
    }
    close(force=false){
      const state=this.state;if(!state)return;
      if(state.phase==='running' && !force && !state.closeAsked){state.closeAsked=true;state.status.textContent='A run is in progress. Close again to stop it after the current request and close.';return;}
      this.closeFilter(false);state.rowObserver?.disconnect();this.state=null;state.picker?.close(false);state.controller.abort();try{state.dialog.close();}catch{}state.dialog.remove();
    }
    syncOperation(){
      const s=this.state,operation=this.rules().operation;s.messageField.hidden=operation==='delete';
      s.intro.textContent=operation==='overwrite'?'Replace the text of selected items without deleting them. Existing archives may still retain their earlier text.':operation==='delete'?'Delete selected items without overwriting their text. This can’t be undone, and existing archives may keep their copy.':'Overwrite selected items, then delete them. This can’t be undone, and existing archives may keep their copy.';
    }
    closeFilter(restore=true){
      const s=this.state,p=s?.popup;if(!p)return;s.popup=null;
      clearTimeout(p.searchTimer);document.removeEventListener('pointerdown',p.outside,true);document.removeEventListener('focusin',p.focus);
      window.removeEventListener('resize',p.place);window.removeEventListener('scroll',p.place,true);
      p.button.setAttribute('aria-expanded','false');
      if(p.name==='date'){s.picker?.close(false);p.el.hidden=true;}else p.el.remove();
      if(restore && p.button.isConnected)p.button.focus({preventScroll:true});
    }
    attachFilter(name,el){
      const s=this.state,button=s.controls[name].button;el.hidden=false;el.id='rt-redact-filter-'+name;button.setAttribute('aria-controls',el.id);button.setAttribute('aria-expanded','true');
      const p=s.popup={name,el,button};p.place=()=>this.positionFilter();
      p.outside=event=>{const path=event.composedPath();if(!path.includes(el) && !path.includes(button))this.closeFilter(false);};
      // A calendar's focused day lives inside its shadow root.
      p.focus=event=>{const path=event.composedPath();if(!path.includes(el) && !path.includes(button))this.closeFilter(false);};
      document.addEventListener('pointerdown',p.outside,true);document.addEventListener('focusin',p.focus);
      window.addEventListener('resize',p.place);window.addEventListener('scroll',p.place,true);
      if(name!=='date')el.addEventListener('keydown',event=>{
        if(event.key==='Escape'){event.preventDefault();event.stopPropagation();this.closeFilter();return;}
        if(event.key==='Enter' && event.target.matches('input[type=search]')){
          const term=event.target.value.trim().replace(/^\/?r\//i,'').toLowerCase(),row=[...el.querySelectorAll('[data-rt-sub-row]')].find(row=>row.dataset.rtSubRow.toLowerCase()===term);
          if(row){event.preventDefault();event.stopPropagation();row.click();}return;
        }
        if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key) || event.target.matches('input') && !['ArrowDown','ArrowUp'].includes(event.key))return;
        const rows=[...el.querySelectorAll('[role^=menuitem]:not([aria-disabled=true])')];if(!rows.length)return;
        event.preventDefault();event.stopPropagation();const at=rows.indexOf(document.activeElement),next=event.key==='Home'?0:event.key==='End'?rows.length-1:at<0?(event.key==='ArrowUp'?rows.length-1:0):(at+(event.key==='ArrowUp'?-1:1)+rows.length)%rows.length;
        for(const row of rows)row.tabIndex=-1;rows[next].tabIndex=0;rows[next].focus({preventScroll:true});
      },true);
      this.positionFilter();
    }
    positionFilter(){
      const p=this.state?.popup;if(!p)return;
      if(!p.button.isConnected){this.closeFilter(false);return;}
      const a=p.button.getBoundingClientRect(),width=Math.min(p.name==='date'?288:256,innerWidth-16),height=p.name==='date'?410:240;
      const below=innerHeight-a.bottom-12,above=a.top-12,up=below<Math.min(height,240) && above>below,available=Math.max(80,up?above:below),size=Math.min(height,available);
      p.el.style.width=width+'px';p.el.style.maxHeight=size+'px';p.el.style.setProperty('--rt-popover-height',size+'px');
      p.el.style.left=Math.max(8,Math.min(a.left,innerWidth-width-8))+'px';
      p.el.style.top=(up?Math.max(8,a.top-Math.min(p.el.getBoundingClientRect().height || size,size)-4):a.bottom+4)+'px';
    }
    loadCommunityHistory(s){
      if(s.historyPromise)return s.historyPromise;
      const refresh=()=>{if(this.state===s)s.popup?.el.rtRefresh?.();};
      const merge=entries=>{s.historyEntries ||= new Map();for(const entry of entries || []){const name=X.normalizeRules({onlyIn:entry.key}).onlyIn[0];if(!name)continue;const old=s.historyEntries.get(name);s.historyEntries.set(name,{key:name,count:Math.max(old?.count || 0,Number(entry.count) || 0)});}refresh();};
      s.historyPromise=(async()=>{
        const [base,settings]=await Promise.all([this.read({action:'community-suggestions',query:''},{signal:s.controller.signal,timeout:12000}),this.readSettings().catch(()=>({}))]);
        if(this.state!==s)return;
        s.suggestionUsername=base.username;s.historyReady=true;s.historyFailed=Boolean(base.unavailable);merge(base.entries);
        const discovery=globalThis.RTDiscoveryDebug;if(discovery?.context?.username?.toLowerCase()===base.username?.toLowerCase())merge(discovery.subredditCounts?.().entries);
        if(settings.archiveDiscovery && base.username){
          const answers=await Promise.allSettled(['post','comment'].map(kind=>this.aggregate({kind,author:base.username,by:'subreddit'})));
          if(this.state!==s)return;const counts=new Map();for(const answer of answers)if(answer.status==='fulfilled' && answer.value?.ok)for(const bucket of answer.value.buckets || [])counts.set(bucket.key,(counts.get(bucket.key)||0)+Number(bucket.count || 0));
          if(counts.size)s.historyFailed=false;merge([...counts].map(([key,count])=>({key,count})));
        }
      })().catch(()=>{s.historyPromise=null;s.historyReady=true;s.historyFailed=true;refresh();});
      return s.historyPromise;
    }
    openFilter(name){
      const s=this.state;if(!s)return;if(s.popup?.name===name){this.closeFilter();return;}this.closeFilter(false);
      const menu=make('div','rt-redact-popover');menu.setAttribute('data-rt-feed-options','');menu.setAttribute('role','menu');menu.setAttribute('aria-label',s.controls[name].button.getAttribute('aria-label'));
      const ctx=F.plainContext(kind=>F.svgIcon(kind),{role:['kinds','operation'].includes(name)?'menuitemradio':'menuitemcheckbox'});
      const change=value=>{s.controls[name].input.value=value;s.controls[name].input.dispatchEvent(new Event('input',{bubbles:true}));};
      if(['kinds','operation'].includes(name)){
        const choices=name==='kinds'?[['both','Posts and comments','collection'],['posts','Posts only','text-post'],['comments','Comments only','comment']]:[['overwrite-delete',operations['overwrite-delete'],'collection'],['overwrite',operations.overwrite,'text-post'],['delete',operations.delete,'close']];
        for(const [value,label,icon] of choices){
          const row=F.menuOption(ctx,{label,icon,value,checked:s.controls[name].input.value===value,onSelect:()=>{change(value);s.controls[name].caption.textContent=label;this.closeFilter();}});menu.append(row);
        }
      }else{
        const picked=()=>X.normalizeRules({onlyIn:s.controls[name].input.value}).onlyIn;
        const note=make('p','rt-redact-suggestion-status text-12 text-neutral-content-weak');note.setAttribute('role','status');
        const sync=()=>{
          const counts=new Map();for(const item of s.items.values())if(item.subreddit)counts.set(item.subreddit,(counts.get(item.subreddit)||0)+1);
          for(const entry of s.historyEntries?.values() || [])counts.set(entry.key,Math.max(counts.get(entry.key)||0,entry.count));
          const entries=[...counts].map(([key,count])=>({key,count})).sort((a,b)=>b.count-a.count || a.key.localeCompare(b.key));
          for(const entry of menu.rtRemote || []){const old=entries.find(e=>e.key.toLowerCase()===entry.key.toLowerCase());if(old)old.matched=true;else entries.push({key:entry.key,count:0,matched:true});}
          const term=panel.input.value.trim().replace(/^\/?r\//i,'');if(/^[a-z0-9_]{2,21}$/i.test(term) && ![...counts.keys()].some(n=>n.toLowerCase()===term.toLowerCase()))counts.set(term,0);
          if(counts.has(term) && !entries.some(e=>e.key.toLowerCase()===term.toLowerCase()))entries.push({key:term,count:0});
          panel.render({entries,picked:picked(),source:'loaded'});
          note.textContent=menu.rtSearching?'Searching Reddit…':!s.historyReady?'Loading your communities…':s.historyFailed?'Activity suggestions unavailable. Search Reddit or enter a name.':'';note.hidden=!note.textContent;
          s.controls[name].caption.textContent=picked().length?picked().length===1?F.subLabel(picked()[0]):n(picked().length)+' communities':name==='onlyIn'?'All communities':'None excluded';
          const row=panel.list.querySelector('[role^=menuitem]');if(row)row.tabIndex=0;
        };
        const panel=F.subredditPanel({ctx,nativeHeader:true,clearLabel:name==='neverIn'?'None excluded':'All communities',onClear:()=>{change('');sync();},onToggle:key=>{const next=picked(),at=next.findIndex(n=>n.toLowerCase()===key.toLowerCase());if(at>=0)next.splice(at,1);else next.push(key);change(next.join(','));sync();panel.input.focus({preventScroll:true});}});
        panel.input.placeholder='Search or enter r/name';panel.input.title='Search communities or enter an exact r/name';
        panel.input.maxLength=50;
        panel.input.addEventListener('input',()=>{
          const p=s.popup;if(p?.el!==menu)return;clearTimeout(p.searchTimer);const query=panel.input.value.trim().replace(/^\/?r\//i,'');
          const generation=p.queryGeneration=(p.queryGeneration || 0)+1;menu.rtRemote=[];menu.rtSearching=query.length>=2;sync();
          if(query.length<2)return;
          p.searchTimer=setTimeout(async()=>{try{const result=await this.read({action:'community-suggestions',query},{signal:s.controller.signal,timeout:10000});if(this.state!==s || s.popup!==p || p.queryGeneration!==generation)return;menu.rtRemote=result.entries || [];}catch{}finally{if(this.state===s && s.popup===p && p.queryGeneration===generation){menu.rtSearching=false;sync();this.positionFilter();}}},250);
        });menu.append(panel.el,note);sync();menu.rtCommunityPanel=panel;menu.rtRefresh=sync;
      }
      s.dialog.append(menu);this.attachFilter(name,menu);
      const focus=menu.rtCommunityPanel?.input || menu.querySelector('[aria-checked=true]') || menu.querySelector('[role^=menuitem]');if(focus){focus.tabIndex=0;focus.focus({preventScroll:true});}
      if(menu.rtCommunityPanel)this.loadCommunityHistory(s);
    }
    openCalendar(){
      const state=this.state,Picker=globalThis.RCSDatePicker;if(!state || !Picker)return;
      if(state.popup?.name==='date'){this.closeFilter();return;}this.closeFilter(false);
      if(!state.picker){
        const shadow=state.dateHost.attachShadow({mode:'open'}),style=make('style','',`:host{--rcs-bg:var(--color-neutral-background,#fff);--rcs-soft:var(--color-neutral-background-weak,#f2f4f5);--rcs-text:var(--color-neutral-content-strong,#181c1f);--rcs-muted:var(--color-neutral-content-weak,#576f76);--rcs-line:var(--color-neutral-border-weak,#e5e8eb);--rcs-hover:var(--color-neutral-background-hover,#e8edef);--rcs-accent:var(--color-brand-background,#d93900)}`+(Picker.styles || '')+'.date-popover{position:relative;top:0!important;left:0!important;right:auto!important;width:100%;max-width:100%;max-height:var(--rt-popover-height,420px)!important;pointer-events:auto}.calendar-presets{flex-wrap:wrap;overflow:visible}');
        const picker=state.picker=new Picker({getBounds:()=>({left:8,top:8,right:innerWidth-8,bottom:innerHeight-8}),onChange:bounds=>{
          state.from.value=bounds.from || '';state.to.value=bounds.to || '';state.controls.date.caption.textContent=picker.summary() || 'Any date';
          state.from.dispatchEvent(new Event('input',{bubbles:true}));
        },onClose:restore=>{state.dateHost.hidden=true;state.dateButton.setAttribute('aria-expanded','false');if(state.popup?.name==='date')this.closeFilter(restore);}});
        picker.element.setAttribute('aria-label','Filter your posts and comments by date');shadow.append(style,picker.element);
      }
      this.attachFilter('date',state.dateHost);state.picker.show();this.positionFilter();
    }
    showStep(view){
      const s=this.state;s.form.hidden=view!=='filters';s.intro.hidden=view!=='filters';s.preview.hidden=view!=='review';s.confirmation.hidden=view!=='confirm';s.results.hidden=view!=='results';
      s.h2.textContent={filters:'Redact your posts and comments',review:'Review matching items',confirm:'Confirm redaction',results:'Redaction results'}[view];
      s.step.textContent={filters:'Step 1 of 3 · Choose filters',review:'Step 2 of 3 · Review and select',confirm:'Step 3 of 3 · Confirm',results:'Run finished'}[view];
      s.cancel.textContent={filters:'Cancel',review:s.phase==='finding'?'Cancel':'Back to filters',confirm:'Back to selection',results:'Close'}[view];
      s.h2.tabIndex=-1;s.h2.focus({preventScroll:true});
    }
    rules(){const state=this.state;return X.normalizeRules(Object.fromEntries(new FormData(state.form).entries()));}
    clearPreview(){const state=this.state;state.rowObserver?.disconnect();state.phase='idle';state.selection=null;state.preview.replaceChildren();state.confirmWrap.hidden=true;state.confirm.value='';state.primary.textContent='Find matching items';state.primary.classList.remove('rt-redact-danger');state.status.textContent='';this.showStep('filters');this.syncPrimary();}
    syncPrimary(){
      const state=this.state;if(!state)return;
      if(state.phase==='previewed')state.primary.disabled=!state.selection.matches.length;
      else if(state.phase==='confirming'){const count=state.selection.matches.length;state.primary.disabled=!count || !X.confirmed(state.confirm.value,count,state.selection.rules.operation);}
      else state.primary.disabled=['finding','running'].includes(state.phase);
    }
    // B2/B3: confirm the account, read your own lists (several sorts, union by ID), then select.
    async find(){
      const state=this.state;if(!state)return;const signal=state.controller.signal,current=()=>this.state===state && !signal.aborted;
      const rules=this.rules();
      if(rules.from!=null && rules.to!=null && rules.from>rules.to){state.status.textContent='The start date must be on or before the end date.';state.status.dataset.error='true';return;}
      this.closeFilter(false);state.phase='finding';state.form.inert=true;
      const loading=make('div','rt-redact-loading');loading.append(make('shreddit-loading'));loading.setAttribute('aria-label','Finding matching items');state.preview.replaceChildren(loading);
      this.showStep('review');state.primary.textContent='Finding matching items…';this.syncPrimary();state.status.textContent='Confirming your account…';
      try{
        const me=await this.read({action:'redact-identity'},{signal});if(!current())return;
        if(!me.canWrite)throw Error('Reddit didn’t provide the token needed to edit or delete. Reload the page and try again.');
        state.items.clear();state.limited=false;state.failures=[];state.unread=0;state.username=me.username;state.status.textContent='Finding your posts and comments…';
        const bounded=rules.from!=null || rules.to!=null;
        const sources=bounded?[[rules.kinds==='comments'?'comments':rules.kinds==='posts'?'submitted':'overview','new']]:SOURCES;
        let successful=0;
        for(const [source,sort] of sources){
          if(rules.kinds==='posts' && source==='comments' || rules.kinds==='comments' && source==='submitted')continue;
          let after=null;const cursors=new Set();
          try{
            for(let page=0;page<PAGES_PER_LIST;page++){
            const result=await this.read({action:'redact-list',username:state.username,source,sort,after,...(sort==='new'?{native:true}:{})},{signal});if(!current())return;
            successful++;
            state.unread+=Number(result.unread) || 0;
            for(const item of result.items || [])if(!state.items.has(item.fullname))state.items.set(item.fullname,item);
            state.status.textContent='Finding your posts and comments… '+n(state.items.size)+' found';
            // Only newest-first lists are chronological. Top/controversial pages may still contain newer matches.
            if(sort==='new' && rules.from!=null && result.items?.some(item=>!item.pinned && item.created<rules.from))break;
            after=result.hasMore?result.after:null;if(!after || cursors.has(after))break;cursors.add(after);
            if(page===PAGES_PER_LIST-1)state.limited=true;
            }
          }catch(error){if(!current())return;state.failures.push(String(error.message).replace(/\.$/,''));}
        }
        if(!successful && state.failures.length)throw Error(state.failures.join('; '));
        state.selection=X.select([...state.items.values()],rules);state.phase='previewed';this.renderPreview();
      }catch(error){if(current()){state.phase='error';state.status.textContent='Couldn’t find your items: '+String(error.message).replace(/\.$/,'')+'.';state.status.dataset.error='true';}}
      finally{if(current()){state.form.inert=false;if(state.phase==='error'){this.showStep('filters');state.primary.textContent='Find matching items';}else delete state.status.dataset.error;this.syncPrimary();}}
    }
    renderPreview(){
      const state=this.state,sel=state.selection,count=sel.matches.length;
      state.status.textContent=n(count)+' '+(count===1?'item matches':'items match')+' ('+n(sel.posts)+' '+(sel.posts===1?'post':'posts')+', '+n(sel.comments)+' '+(sel.comments===1?'comment':'comments')+') out of '+n(sel.found)+' found'+(sel.oldest?' · oldest found: '+dateText(sel.oldest):'')+' · Reddit may not list older items';
      if(state.limited)state.status.append(' · Discovery limit reached; more items may exist.');
      if(state.failures?.length)state.status.append(' · Incomplete discovery: '+state.failures.join('; ')+'. Only the items found are available below.');
      if(state.unread)state.status.append(' · Incomplete discovery: '+n(state.unread)+' '+(state.unread===1?'item could':'items could')+' not be read and '+(state.unread===1?'was':'were')+' excluded.');
      state.status.dataset.incomplete=String(Boolean(state.limited || state.failures?.length || state.unread));
      state.candidates=[...sel.matches];state.selected=new Set(sel.matches.map(item=>item.fullname));state.visibleRows=0;
      state.rowObserver?.disconnect();
      const list=state.list=make('ul','rt-redact-rows');list.setAttribute('aria-label','Select items to redact');
      state.tail=make('li','rt-redact-tail');state.tail.hidden=!count;state.tail.setAttribute('aria-hidden','true');list.append(state.tail);
      list.addEventListener('scroll',()=>{if(list.clientHeight>0 && list.scrollTop+list.clientHeight>=list.scrollHeight-120)this.appendRows();},{passive:true});
      state.selectionCount=make('p','text-14 font-semibold m-0');state.selectAll=make('button','button-small button-secondary button inline-flex items-center justify-center px-md','Deselect all');state.selectAll.type='button';
      state.selectAll.addEventListener('click',()=>{if(state.selected.size===state.candidates.length)state.selected.clear();else for(const item of state.candidates)state.selected.add(item.fullname);
        for(const box of list.querySelectorAll('input[type=checkbox]'))box.checked=state.selected.has(box.value);this.syncSelection();});
      const tools=make('div','rt-redact-review-tools');tools.append(state.selectionCount,state.selectAll);
      const backup=make('button','button-small button-secondary button inline-flex items-center justify-center px-md','Download a copy');backup.type='button';backup.addEventListener('click',()=>this.download());
      state.preview.replaceChildren(tools,list,backup);this.appendRows();
      if(typeof IntersectionObserver==='function' && !state.tail.hidden){state.rowObserver=new IntersectionObserver(entries=>{if(this.state===state && entries.some(entry=>entry.isIntersecting))this.appendRows();},{root:list,rootMargin:'120px'});state.rowObserver.observe(state.tail);}
      this.showStep('review');this.syncSelection();
      if(!count){state.status.append(' · Go back to adjust your filters.');state.primary.disabled=true;}
    }
    appendRows(){
      const state=this.state;if(!state || state.phase!=='previewed' || state.visibleRows>=state.candidates.length)return;const end=Math.min(state.visibleRows+PREVIEW_ROWS,state.candidates.length);
      for(const item of state.candidates.slice(state.visibleRows,end)){
        const li=make('li','rt-redact-row'),content=make('div','rt-redact-item'),text=(item.kind==='post'?item.title:item.body) || '(no text)';
        const checkbox=make('input');checkbox.type='checkbox';checkbox.value=item.fullname;checkbox.checked=state.selected.has(item.fullname);checkbox.setAttribute('aria-label','Select '+item.kind+': '+text.slice(0,100));
        checkbox.addEventListener('change',()=>{if(checkbox.checked)state.selected.add(item.fullname);else state.selected.delete(item.fullname);this.syncSelection();});
        const meta=make('span','text-12 text-neutral-content-weak',(item.kind==='post'?'Post':'Comment')+' · '+F.subLabel(item.subreddit)+' · '+dateText(item.created)+' · '+n(item.score)+' votes'+(X.overwritable(item)?'':' · delete only'));
        const title=make('label','rt-redact-excerpt',text.length>220?text.slice(0,219)+'…':text);checkbox.id='rt-redact-select-'+item.fullname;title.htmlFor=checkbox.id;
        const link=make('a','rt-redact-link','View on Reddit');link.href=item.permalink || '#';link.target='_blank';link.rel='noopener noreferrer';
        content.append(meta,title);
        const fullText=item.kind==='post'?[item.title,item.body].filter(Boolean).join('\n\n'):item.body;
        if(fullText && fullText!==title.textContent){
          const collapsed=title.textContent,expand=make('button','rt-redact-expand','Read full text');expand.type='button';expand.setAttribute('aria-expanded','false');title.id='rt-redact-text-'+item.fullname;expand.setAttribute('aria-controls',title.id);
          expand.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();const open=expand.getAttribute('aria-expanded')!=='true';title.textContent=open?fullText:collapsed;expand.setAttribute('aria-expanded',String(open));expand.textContent=open?'Read less':'Read full text';});content.append(expand);
        }
        content.append(link);li.append(checkbox,content);state.list.insertBefore(li,state.tail);
      }
      state.visibleRows=end;state.tail.hidden=end>=state.candidates.length;if(state.tail.hidden)state.rowObserver?.disconnect();
    }
    syncSelection(){
      const state=this.state,sel=state.selection;sel.matches=state.candidates.filter(item=>state.selected.has(item.fullname));sel.posts=sel.matches.filter(item=>item.kind==='post').length;sel.comments=sel.matches.length-sel.posts;
      state.selectionCount.textContent=n(sel.matches.length)+' of '+n(state.candidates.length)+' selected';state.selectAll.textContent=state.selected.size===state.candidates.length?'Deselect all':'Select all';
      state.confirm.value='';state.primary.textContent='Review '+n(sel.matches.length)+' selected '+(sel.matches.length===1?'item':'items');state.primary.classList.remove('rt-redact-danger');this.syncPrimary();
    }
    showConfirmation(){
      const state=this.state,count=state.selection.matches.length;if(!count)return;
      const operation=state.selection.rules.operation;
      state.phase='confirming';state.confirmWrap.hidden=false;state.confirmLabel.textContent='Type “'+X.confirmation(count,operation)+'” to confirm';state.confirm.placeholder=X.confirmation(count,operation);state.confirm.value='';
      const action=operation==='overwrite'?'Their text will be replaced; the items will remain on Reddit.':operation==='delete'?'These items will be permanently deleted without overwriting.':'These items will be overwritten where possible, then permanently deleted.';
      const summary=make('p','text-14 m-0','u/'+state.username+' · '+n(state.selection.posts)+' posts and '+n(state.selection.comments)+' comments selected. '+action+(state.limited || state.failures?.length || state.unread?' Discovery was incomplete; this run includes only the selected items found.':''));
      const replacement=make('blockquote','rt-redact-replacement',state.selection.rules.text);
      state.confirmation.replaceChildren(summary,...(operation==='delete'?[]:[make('h3','text-14 font-semibold m-0','Replacement message'),replacement]),state.confirmWrap);
      state.primary.textContent=(operation==='overwrite'?'Overwrite':operation==='delete'?'Delete':'Overwrite and delete')+' '+n(count)+' '+(count===1?'item':'items');state.primary.classList.add('rt-redact-danger');this.showStep('confirm');this.syncPrimary();state.confirm.focus({preventScroll:true});
    }
    download(){
      const state=this.state;if(!state?.selection)return;
      const data=JSON.stringify({account:state.username,exportedAt:new Date().toISOString(),items:state.selection.matches.map(({fullname,kind,subreddit,created,score,title,body,permalink})=>({fullname,kind,subreddit,created,score,title,body,permalink:permalink?'https://www.reddit.com'+permalink:''}))},null,2);
      const url=URL.createObjectURL(new Blob([data],{type:'application/json'})),a=make('a');a.href=url;a.download='reddit-'+state.username+'-redaction-copy.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
    }
    // B4–B6
    async runRedaction(){
      const state=this.state;if(!state || state.phase!=='confirming')return;const items=[...state.selection.matches],rules=state.selection.rules;
      if(!X.confirmed(state.confirm.value,items.length,rules.operation))return;
      state.phase='running';state.form.inert=true;state.preview.inert=true;state.confirm.disabled=true;state.primary.textContent='Redacting…';this.syncPrimary();state.cancel.textContent='Stop';
      const signal=state.controller.signal;
      state.stopController=new AbortController();
      const stopOnClose=()=>state.stopController.abort();signal.addEventListener('abort',stopOnClose,{once:true});
      const combined=state.stopController.signal;
      const write=async(item,step,text)=>{// No abort signal: Stop and Close take effect after the current request, so Reddit's answer is never lost.
        const r=await this.read({action:'redact-item',fullname:item.fullname,step,text,username:state.username},{timeout:30000});return {ok:r.written===true,rateLimited:r.rateLimited===true,retryAfterMs:r.retryAfterMs,error:r.reason};};
      state.status.textContent='Starting… about '+X.minutesLeft(items,rules.operation)+' min';
      const result=await X.run(items,rules,{write,sleep:this.sleep,signal:combined,onProgress:({done,failed,total})=>{if(this.state===state)state.status.textContent='Done '+n(done)+' of '+n(total)+' · '+n(failed)+' failed · about '+X.minutesLeft(items.slice(done+failed),rules.operation)+' min left';}});
      signal.removeEventListener('abort',stopOnClose);
      if(this.state!==state)return;
      state.phase='done';state.form.inert=false;state.preview.inert=false;state.confirm.disabled=false;state.cancel.textContent='Close';state.closeAsked=false;
      this.renderResults(result,items.length);this.showStep('results');this.syncPrimary();state.primary.textContent='Find matching items';state.primary.classList.remove('rt-redact-danger');state.confirmWrap.hidden=true;
    }
    renderResults(result,total){
      const state=this.state,box=state.results;box.replaceChildren();box.hidden=false;
      const verb=state.selection.rules.operation==='overwrite'?'Overwritten':'Deleted';
      state.status.textContent=verb+' '+n(result.done.length)+' of '+n(total)+'. '+n(result.failed.length+result.overwrittenOnly.length)+' failed.'+(result.stopped?' '+result.stopped:'')+(result.remaining?' '+n(result.remaining)+' not processed.':'');
      const group=(title,entries)=>{if(!entries.length)return;box.append(make('h3','text-14 font-semibold m-0 text-neutral-content-strong',title));const ul=make('ul','rt-redact-rows');
        for(const {item,error} of entries.slice(0,200)){const li=make('li','rt-redact-row'),a=make('a','rt-redact-link',(item.kind==='post'?item.title:item.body.split('\n')[0]) || item.fullname);a.href=item.permalink || '#';a.target='_blank';a.rel='noopener';li.append(a,make('span','text-12 text-neutral-content-weak',error));ul.append(li);}box.append(ul);};
      group(verb+' items',result.done.map(item=>({item,error:verb})));group('Failed',result.failed);group('Text overwritten, delete failed',result.overwrittenOnly);
      state.preview.hidden=true;state.selection=null;
    }
  }
  globalThis.RTRedaction=Object.freeze({Redaction,FRAGMENT});
  if(window.top===window && globalThis.chrome?.runtime?.id && location.hostname!=='old.reddit.com')Object.defineProperty(globalThis,'RTRedactionInstance',{value:new Redaction()});
})();
