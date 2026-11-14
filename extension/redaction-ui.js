/* Bulk redaction dialog (docs/redaction-spec.md): find (dry run) → typed confirmation → overwrite, then delete.
   Opened by the address fragment #rt-redact (the popup's "Redact my posts and comments…"). Reads and writes go
   through the page bridge, which holds the modhash and only writes to items it read from your own lists. */
(() => {
  'use strict';
  if(globalThis.RTRedaction)return;
  const X=globalThis.RTRedactionModel;if(!X)return;
  const FRAGMENT='#rt-redact',PAGES_PER_LIST=10,PREVIEW_ROWS=50;
  const SOURCES=[['overview','new'],['submitted','top'],['submitted','controversial'],['comments','top'],['comments','controversial']];
  const make=(tag,cls,text)=>{let el;if(tag.includes('-')){const holder=document.createElement('div');holder.innerHTML='<'+tag+'></'+tag+'>';el=holder.firstElementChild;el.remove();}else el=document.createElement(tag);if(cls)el.className=cls;if(text!=null && text!=='')el.textContent=text;return el;};
  const n=value=>Number(value).toLocaleString('en-US');
  const dateText=seconds=>new Date(seconds*1000).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});
  const CLOSE='m11.273 10 5.363-5.363a.9.9 0 10-1.273-1.273L10 8.727 4.637 3.364a.9.9 0 10-1.273 1.273L8.727 10l-5.363 5.363a.9.9 0 101.274 1.273L10 11.273l5.363 5.363a.897.897 0 001.274 0 .9.9 0 000-1.273L11.275 10Z';
  function closeIcon(){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');for(const [k,v] of Object.entries({fill:'currentColor',height:'16',width:'16',viewBox:'0 0 20 20','aria-hidden':'true'}))svg.setAttribute(k,v);const p=document.createElementNS(svg.namespaceURI,'path');p.setAttribute('d',CLOSE);svg.append(p);return svg;}
  const sleepFor=(ms,signal)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{signal?.removeEventListener('abort',stop);resolve();},ms);const stop=()=>{clearTimeout(timer);reject(Object.assign(Error('Stopped.'),{stopped:true}));};if(signal?.aborted)stop();else signal?.addEventListener('abort',stop,{once:true});});

  class Redaction {
    constructor({read=(...args)=>globalThis.RTRaffle.bridgeRead(...args),sleep=sleepFor,observe=true}={}){
      this.read=read;this.sleep=sleep;this.state=null;this.dead=false;
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
      const kinds=make('select');kinds.name='kinds';for(const [value,label] of [['both','Posts and comments'],['posts','Posts only'],['comments','Comments only']]){const o=make('option','',label);o.value=value;kinds.append(o);}
      const group=(title,...fields)=>{const box=make('fieldset','rt-redact-group');box.append(make('legend','text-14 font-semibold',title),...fields);return box;};
      const from=input('from','hidden'),to=input('to','hidden');
      const dateButton=make('button','button-medium button-secondary button inline-flex items-center justify-center px-md','Any date');dateButton.type='button';dateButton.setAttribute('aria-haspopup','dialog');dateButton.setAttribute('aria-expanded','false');
      const dateHost=make('div','rt-redact-calendar');dateHost.hidden=true;
      const dateField=make('div','rt-raffle-field');dateField.append(make('span','rt-raffle-label','Date range'),dateButton,from,to,dateHost);
      dateButton.addEventListener('click',()=>this.openCalendar());
      form.append(group('Find items',field('Content type',kinds),dateField,field('Minimum age in days',input('olderThanDays','number','Any age'),'Include items at least this many days old'),
        field('Include communities',input('onlyIn','text','r/one, r/two'),'Leave blank for all communities'),field('Include text',input('onlyContaining','text','Any text'),'Match words in the title or text')),
        group('Keep items safe',field('Exclude communities',input('neverIn','text','r/keep')),field('Keep items scoring at least',input('keepScoreAtLeast','number','No score limit')),
        field('Keep items containing text',input('keepContaining','text','Words to protect')),field('Keep specific items',area('keep','','Reddit links or item IDs, separated by spaces'))),
        group('Replacement text',field('Overwrite text before deleting',area('text',X.DEFAULT_TEXT),'Link and image posts without text are deleted without an overwrite.')));
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
      const state=this.state={dialog,h2,step,intro,form,dateButton,dateHost,from,to,status,preview,confirmation,confirm,confirmWrap,confirmLabel,results,primary,cancel,username:'',items:new Map(),selection:null,phase:'idle',controller:new AbortController(),finding:null,running:null,closeAsked:false};
      const requestClose=()=>this.close();
      close.addEventListener('click',requestClose);cancel.addEventListener('click',()=>{
        if(state.phase==='confirming'){state.phase='previewed';state.confirm.value='';this.showStep('review');this.syncSelection();}
        else if(state.phase==='previewed')this.clearPreview();
        else if(state.phase==='running'){state.stopController.abort();state.status.textContent='Stopping after the current request…';}
        else requestClose();
      });
      dialog.addEventListener('cancel',event=>{event.preventDefault();if(state.picker?.open)state.picker.close();else requestClose();});
      dialog.addEventListener('click',event=>{if(event.target===dialog)requestClose();});
      // Any rule change invalidates the preview: the run must use exactly what was previewed.
      form.addEventListener('input',()=>{if(['previewed','confirming','done'].includes(state.phase))this.clearPreview();});
      form.addEventListener('submit',event=>event.preventDefault());
      confirm.addEventListener('input',()=>this.syncPrimary());
      primary.addEventListener('click',()=>{
        if(state.phase==='previewed')this.showConfirmation();
        else if(state.phase==='confirming')this.runRedaction();
        else if(['idle','done','error'].includes(state.phase))this.find();
      });
      try{dialog.showModal();}catch{dialog.setAttribute('open','');}
      kinds.focus({preventScroll:true});
      return state;
    }
    close(force=false){
      const state=this.state;if(!state)return;
      if(state.phase==='running' && !force && !state.closeAsked){state.closeAsked=true;state.status.textContent='A run is in progress. Close again to stop it after the current request and close.';return;}
      this.state=null;state.picker?.close(false);state.controller.abort();try{state.dialog.close();}catch{}state.dialog.remove();
    }
    openCalendar(){
      const state=this.state,Picker=globalThis.RCSDatePicker;if(!state || !Picker)return;
      if(state.picker?.open){state.picker.close();return;}
      if(!state.picker){
        const shadow=state.dateHost.attachShadow({mode:'open'}),style=make('style','',`:host{--rcs-bg:var(--color-neutral-background,#fff);--rcs-soft:var(--color-neutral-background-weak,#f2f4f5);--rcs-text:var(--color-neutral-content-strong,#181c1f);--rcs-muted:var(--color-neutral-content-weak,#576f76);--rcs-line:var(--color-neutral-border-weak,#e5e8eb);--rcs-hover:var(--color-neutral-background-hover,#e8edef);--rcs-accent:var(--color-brand-background,#d93900)}`+(Picker.styles || '')+'.date-popover{position:relative;top:0!important;left:0!important;right:auto!important;max-width:100%;pointer-events:auto}.calendar-presets{flex-wrap:wrap;overflow:visible}');
        const picker=state.picker=new Picker({getBounds:()=>state.dialog.getBoundingClientRect(),onChange:bounds=>{
          state.from.value=bounds.from || '';state.to.value=bounds.to || '';state.dateButton.textContent=picker.summary() || 'Any date';
          state.from.dispatchEvent(new Event('input',{bubbles:true}));
        },onClose:restore=>{state.dateHost.hidden=true;state.dateButton.setAttribute('aria-expanded','false');if(restore && this.state===state)state.dateButton.focus({preventScroll:true});}});
        picker.element.setAttribute('aria-label','Filter your posts and comments by date');shadow.append(style,picker.element);
      }
      state.dateHost.hidden=false;state.dateButton.setAttribute('aria-expanded','true');state.picker.show();
    }
    showStep(view){
      const s=this.state;s.form.hidden=view!=='filters';s.intro.hidden=view!=='filters';s.preview.hidden=view!=='review';s.confirmation.hidden=view!=='confirm';s.results.hidden=view!=='results';
      s.h2.textContent={filters:'Redact your posts and comments',review:'Review matching items',confirm:'Confirm redaction',results:'Redaction results'}[view];
      s.step.textContent={filters:'Step 1 of 3 · Choose filters',review:'Step 2 of 3 · Review and select',confirm:'Step 3 of 3 · Confirm',results:'Run finished'}[view];
      s.cancel.textContent={filters:'Cancel',review:s.phase==='finding'?'Cancel':'Back to filters',confirm:'Back to selection',results:'Close'}[view];
      s.h2.tabIndex=-1;s.h2.focus({preventScroll:true});
    }
    rules(){const state=this.state;return X.normalizeRules(Object.fromEntries(new FormData(state.form).entries()));}
    clearPreview(){const state=this.state;state.phase='idle';state.selection=null;state.preview.replaceChildren();state.confirmWrap.hidden=true;state.confirm.value='';state.primary.textContent='Find matching items';state.primary.classList.remove('rt-redact-danger');state.status.textContent='';this.showStep('filters');this.syncPrimary();}
    syncPrimary(){
      const state=this.state;if(!state)return;
      if(state.phase==='previewed')state.primary.disabled=!state.selection.matches.length;
      else if(state.phase==='confirming'){const count=state.selection.matches.length;state.primary.disabled=!count || !X.confirmed(state.confirm.value,count);}
      else state.primary.disabled=['finding','running'].includes(state.phase);
    }
    // B2/B3: confirm the account, read your own lists (several sorts, union by ID), then select.
    async find(){
      const state=this.state;if(!state)return;const signal=state.controller.signal,current=()=>this.state===state && !signal.aborted;
      const rules=this.rules();
      if(rules.from!=null && rules.to!=null && rules.from>rules.to){state.status.textContent='The start date must be on or before the end date.';state.status.dataset.error='true';return;}
      state.picker?.close(false);state.phase='finding';state.form.inert=true;
      const loading=make('div','rt-redact-loading');loading.append(make('shreddit-loading'));loading.setAttribute('aria-label','Finding matching items');state.preview.replaceChildren(loading);
      this.showStep('review');state.primary.textContent='Finding matching items…';this.syncPrimary();state.status.textContent='Confirming your account…';
      try{
        const me=await this.read({action:'redact-identity'},{signal});if(!current())return;
        if(!me.canWrite)throw Error('Reddit didn’t provide the token needed to edit or delete. Reload the page and try again.');
        state.items.clear();state.limited=false;state.username=me.username;state.status.textContent='Finding your posts and comments…';
        for(const [source,sort] of SOURCES){
          if(rules.kinds==='posts' && source==='comments' || rules.kinds==='comments' && source==='submitted')continue;
          let after=null;const cursors=new Set();
          for(let page=0;page<PAGES_PER_LIST;page++){
            const result=await this.read({action:'redact-list',username:state.username,source,sort,after},{signal});if(!current())return;
            for(const item of result.items || [])if(!state.items.has(item.fullname))state.items.set(item.fullname,item);
            state.status.textContent='Finding your posts and comments… '+n(state.items.size)+' found';
            // Only newest-first lists are chronological. Top/controversial pages may still contain newer matches.
            if(sort==='new' && rules.from!=null && result.items?.length && result.items.at(-1).created<rules.from)break;
            after=result.hasMore?result.after:null;if(!after || cursors.has(after))break;cursors.add(after);
            if(page===PAGES_PER_LIST-1)state.limited=true;
          }
        }
        state.selection=X.select([...state.items.values()],rules);state.phase='previewed';this.renderPreview();
      }catch(error){if(current()){state.phase='error';state.status.textContent='Couldn’t find your items: '+String(error.message).replace(/\.$/,'')+'.';state.status.dataset.error='true';}}
      finally{if(current()){state.form.inert=false;if(state.phase==='error'){this.showStep('filters');state.primary.textContent='Find matching items';}else delete state.status.dataset.error;this.syncPrimary();}}
    }
    renderPreview(){
      const state=this.state,sel=state.selection,count=sel.matches.length;
      state.status.textContent=n(count)+' '+(count===1?'item matches':'items match')+' ('+n(sel.posts)+' '+(sel.posts===1?'post':'posts')+', '+n(sel.comments)+' '+(sel.comments===1?'comment':'comments')+') out of '+n(sel.found)+' found'+(sel.oldest?' · oldest found: '+dateText(sel.oldest):'')+' · Reddit may not list older items';
      if(state.limited)state.status.append(' · Discovery limit reached; more items may exist.');
      state.candidates=[...sel.matches];state.selected=new Set(sel.matches.map(item=>item.fullname));state.visibleRows=0;
      const list=state.list=make('ul','rt-redact-rows');list.setAttribute('aria-label','Select items to redact');
      state.selectionCount=make('p','text-14 font-semibold m-0');state.selectAll=make('button','button-small button-secondary button inline-flex items-center justify-center px-md','Deselect all');state.selectAll.type='button';
      state.selectAll.addEventListener('click',()=>{if(state.selected.size===state.candidates.length)state.selected.clear();else for(const item of state.candidates)state.selected.add(item.fullname);
        for(const box of list.querySelectorAll('input[type=checkbox]'))box.checked=state.selected.has(box.value);this.syncSelection();});
      const tools=make('div','rt-redact-review-tools');tools.append(state.selectionCount,state.selectAll);
      state.more=make('button','button-small button-secondary button inline-flex items-center justify-center px-md');state.more.type='button';state.more.addEventListener('click',()=>this.appendRows());
      const backup=make('button','button-small button-secondary button inline-flex items-center justify-center px-md','Download a copy');backup.type='button';backup.addEventListener('click',()=>this.download());
      state.preview.replaceChildren(tools,list,state.more,backup);this.appendRows();this.showStep('review');this.syncSelection();
      if(!count){state.status.append(' · Go back to adjust your filters.');state.primary.disabled=true;}
    }
    appendRows(){
      const state=this.state,end=Math.min(state.visibleRows+PREVIEW_ROWS,state.candidates.length);
      for(const item of state.candidates.slice(state.visibleRows,end)){
        const li=make('li','rt-redact-row'),content=make('div','rt-redact-item'),text=(item.kind==='post'?item.title:item.body) || '(no text)';
        const checkbox=make('input');checkbox.type='checkbox';checkbox.value=item.fullname;checkbox.checked=state.selected.has(item.fullname);checkbox.setAttribute('aria-label','Select '+item.kind+': '+text.slice(0,100));
        checkbox.addEventListener('change',()=>{if(checkbox.checked)state.selected.add(item.fullname);else state.selected.delete(item.fullname);this.syncSelection();});
        const meta=make('span','text-12 text-neutral-content-weak',(item.kind==='post'?'Post':'Comment')+' · r/'+item.subreddit+' · '+dateText(item.created)+' · '+n(item.score)+' points'+(X.overwritable(item)?'':' · delete only'));
        const title=make('label','rt-redact-excerpt',text.length>220?text.slice(0,219)+'…':text);checkbox.id='rt-redact-select-'+item.fullname;title.htmlFor=checkbox.id;
        const link=make('a','rt-redact-link','View on Reddit');link.href=item.permalink || '#';link.target='_blank';link.rel='noopener noreferrer';
        content.append(meta,title);
        if(item.body && (item.kind==='post' || item.body.length>220)){const details=make('details'),summary=make('summary','text-12','Read full text');details.append(summary,make('p','rt-redact-fulltext',item.body));content.append(details);}
        content.append(link);li.append(checkbox,content);state.list.append(li);
      }
      state.visibleRows=end;state.more.hidden=end>=state.candidates.length;state.more.textContent='Show next '+n(Math.min(PREVIEW_ROWS,state.candidates.length-end))+' items';
    }
    syncSelection(){
      const state=this.state,sel=state.selection;sel.matches=state.candidates.filter(item=>state.selected.has(item.fullname));sel.posts=sel.matches.filter(item=>item.kind==='post').length;sel.comments=sel.matches.length-sel.posts;
      state.selectionCount.textContent=n(sel.matches.length)+' of '+n(state.candidates.length)+' selected';state.selectAll.textContent=state.selected.size===state.candidates.length?'Deselect all':'Select all';
      state.confirm.value='';state.primary.textContent='Review '+n(sel.matches.length)+' selected '+(sel.matches.length===1?'item':'items');state.primary.classList.remove('rt-redact-danger');this.syncPrimary();
    }
    showConfirmation(){
      const state=this.state,count=state.selection.matches.length;if(!count)return;
      state.phase='confirming';state.confirmWrap.hidden=false;state.confirmLabel.textContent='Type “'+X.confirmation(count)+'” to confirm';state.confirm.placeholder=X.confirmation(count);state.confirm.value='';
      const summary=make('p','text-14 m-0','u/'+state.username+' · '+n(state.selection.posts)+' posts and '+n(state.selection.comments)+' comments selected. These items will be overwritten where possible, then permanently deleted.');
      const replacement=make('blockquote','rt-redact-replacement',state.selection.rules.text);
      state.confirmation.replaceChildren(summary,make('h3','text-14 font-semibold m-0','Replacement text'),replacement,state.confirmWrap);
      state.primary.textContent='Overwrite and delete '+n(count)+' '+(count===1?'item':'items');state.primary.classList.add('rt-redact-danger');this.showStep('confirm');this.syncPrimary();state.confirm.focus({preventScroll:true});
    }
    download(){
      const state=this.state;if(!state?.selection)return;
      const data=JSON.stringify({account:state.username,exportedAt:new Date().toISOString(),items:state.selection.matches.map(({fullname,kind,subreddit,created,score,title,body,permalink})=>({fullname,kind,subreddit,created,score,title,body,permalink:permalink?'https://www.reddit.com'+permalink:''}))},null,2);
      const url=URL.createObjectURL(new Blob([data],{type:'application/json'})),a=make('a');a.href=url;a.download='reddit-'+state.username+'-redaction-copy.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
    }
    // B4–B6
    async runRedaction(){
      const state=this.state;if(!state || state.phase!=='confirming')return;const items=[...state.selection.matches],rules=state.selection.rules;
      if(!X.confirmed(state.confirm.value,items.length))return;
      state.phase='running';state.form.inert=true;state.preview.inert=true;state.confirm.disabled=true;state.primary.textContent='Redacting…';this.syncPrimary();state.cancel.textContent='Stop';
      const signal=state.controller.signal;
      state.stopController=new AbortController();
      const combined=AbortSignal.any?AbortSignal.any([signal,state.stopController.signal]):state.stopController.signal;
      const write=async(item,step,text)=>{// No abort signal: Stop and Close take effect after the current request, so Reddit's answer is never lost.
        const r=await this.read({action:'redact-item',fullname:item.fullname,step,text,username:state.username},{timeout:30000});return {ok:r.written===true,rateLimited:r.rateLimited===true,retryAfterMs:r.retryAfterMs,error:r.reason};};
      state.status.textContent='Starting… about '+X.minutesLeft(items)+' min';
      const result=await X.run(items,rules,{write,sleep:this.sleep,signal:combined,onProgress:({done,failed,total})=>{if(this.state===state)state.status.textContent='Done '+n(done)+' of '+n(total)+' · '+n(failed)+' failed · about '+X.minutesLeft(items.slice(done+failed))+' min left';}});
      if(this.state!==state)return;
      state.phase='done';state.form.inert=false;state.preview.inert=false;state.confirm.disabled=false;state.cancel.textContent='Close';state.closeAsked=false;
      this.renderResults(result,items.length);this.showStep('results');this.syncPrimary();state.primary.textContent='Find matching items';state.primary.classList.remove('rt-redact-danger');state.confirmWrap.hidden=true;
    }
    renderResults(result,total){
      const state=this.state,box=state.results;box.replaceChildren();box.hidden=false;
      state.status.textContent='Deleted '+n(result.done.length)+' of '+n(total)+'. '+n(result.failed.length+result.overwrittenOnly.length)+' failed.'+(result.stopped?' '+result.stopped:'')+(result.remaining?' '+n(result.remaining)+' not processed.':'');
      const group=(title,entries)=>{if(!entries.length)return;box.append(make('h3','text-14 font-semibold m-0 text-neutral-content-strong',title));const ul=make('ul','rt-redact-rows');
        for(const {item,error} of entries.slice(0,200)){const li=make('li','rt-redact-row'),a=make('a','rt-redact-link',(item.kind==='post'?item.title:item.body.split('\n')[0]) || item.fullname);a.href=item.permalink || '#';a.target='_blank';a.rel='noopener';li.append(a,make('span','text-12 text-neutral-content-weak',error));ul.append(li);}box.append(ul);};
      group('Deleted items',result.done.map(item=>({item,error:'Deleted'})));group('Failed',result.failed);group('Text overwritten, delete failed',result.overwrittenOnly);
      state.preview.hidden=true;state.selection=null;
    }
  }
  globalThis.RTRedaction=Object.freeze({Redaction,FRAGMENT});
  if(window.top===window && globalThis.chrome?.runtime?.id && location.hostname!=='old.reddit.com')Object.defineProperty(globalThis,'RTRedactionInstance',{value:new Redaction()});
})();
