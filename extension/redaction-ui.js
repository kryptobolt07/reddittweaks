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
      const intro=make('p','text-14 text-neutral-content-weak m-0','Overwrites the text of the items you choose, then deletes them. This can’t be undone, and archives that already saved an item keep their copy.');
      const form=make('form','rt-raffle-form');form.noValidate=true;
      const field=(label,input,hint)=>{const wrap=make('label','rt-raffle-field');wrap.append(make('span','rt-raffle-label',label),input);if(hint)wrap.append(make('span','rt-raffle-hint',hint));return wrap;};
      const input=(name,type,placeholder='')=>{const el=make('input');el.type=type;el.name=name;el.placeholder=placeholder;if(type==='number')el.inputMode='numeric';return el;};
      const area=(name,value='',placeholder='')=>{const el=make('textarea','rt-redact-area');el.name=name;el.value=value;el.placeholder=placeholder;el.rows=2;return el;};
      const kinds=make('select');kinds.name='kinds';for(const [value,label] of [['both','Posts and comments'],['posts','Posts only'],['comments','Comments only']]){const o=make('option','',label);o.value=value;kinds.append(o);}
      const grid=make('div','rt-raffle-grid');
      grid.append(field('Older than (days)',input('olderThanDays','number','Any age')),field('Keep items with score at least',input('keepScoreAtLeast','number','No limit')),
        field('Posted on or after',input('from','date')),field('Posted on or before',input('to','date')),
        field('Only in communities',input('onlyIn','text','r/one, r/two')),field('Never in communities',input('neverIn','text','r/keep')),
        field('Only items containing',input('onlyContaining','text','Any text')),field('Keep items containing',input('keepContaining','text','Nothing')));
      form.append(field('What to redact',kinds),grid,field('Keep these items',area('keep','','Links or IDs, separated by spaces')),field('Replace the text with',area('text',X.DEFAULT_TEXT),'Posts without text (links, images) are deleted only'));
      const status=make('p','rt-raffle-status text-12 text-neutral-content-weak m-0');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
      const preview=make('section','rt-redact-preview');preview.hidden=true;preview.setAttribute('aria-label','Matching items');
      const confirmWrap=make('label','rt-raffle-field rt-redact-confirm');confirmWrap.hidden=true;const confirm=input('confirm','text');confirm.autocomplete='off';confirm.spellcheck=false;
      const confirmLabel=make('span','rt-raffle-label');confirmWrap.append(confirmLabel,confirm);
      const results=make('section','rt-redact-results');results.hidden=true;
      body.append(intro,form,status,preview,confirmWrap,results);
      const cancel=make('button','button-medium button-secondary button inline-flex items-center justify-center px-md','Cancel');cancel.type='button';cancel.slot='secondary-button';
      const primary=make('button','button-medium button-primary button inline-flex items-center justify-center px-md','Find matching items');primary.type='button';primary.slot='primary-button';
      card.append(head,close,body,cancel,primary);dialog.append(card);document.body.append(dialog);
      const state=this.state={dialog,form,status,preview,confirm,confirmWrap,confirmLabel,results,primary,cancel,username:'',items:new Map(),selection:null,phase:'idle',controller:new AbortController(),finding:null,running:null,closeAsked:false};
      const requestClose=()=>this.close();
      close.addEventListener('click',requestClose);cancel.addEventListener('click',requestClose);
      dialog.addEventListener('cancel',event=>{event.preventDefault();requestClose();});
      dialog.addEventListener('click',event=>{if(event.target===dialog)requestClose();});
      // Any rule change invalidates the preview: the run must use exactly what was previewed.
      form.addEventListener('input',()=>{if(state.phase==='previewed' || state.phase==='done')this.clearPreview();});
      form.addEventListener('submit',event=>event.preventDefault());
      confirm.addEventListener('input',()=>this.syncPrimary());
      primary.addEventListener('click',()=>{if(state.phase==='previewed')this.runRedaction();else if(['idle','done','error'].includes(state.phase))this.find();});
      try{dialog.showModal();}catch{dialog.setAttribute('open','');}
      kinds.focus({preventScroll:true});
      return state;
    }
    close(force=false){
      const state=this.state;if(!state)return;
      if(state.phase==='running' && !force && !state.closeAsked){state.closeAsked=true;state.status.textContent='A run is in progress. Close again to stop it after the current request and close.';return;}
      this.state=null;state.controller.abort();try{state.dialog.close();}catch{}state.dialog.remove();
    }
    rules(){const state=this.state;return X.normalizeRules(Object.fromEntries(new FormData(state.form).entries()));}
    clearPreview(){const state=this.state;state.phase='idle';state.selection=null;state.preview.hidden=true;state.preview.replaceChildren();state.confirmWrap.hidden=true;state.confirm.value='';state.results.hidden=true;state.primary.textContent='Find matching items';state.primary.classList.remove('rt-redact-danger');state.status.textContent='';this.syncPrimary();}
    syncPrimary(){
      const state=this.state;if(!state)return;
      if(state.phase==='previewed'){const count=state.selection.matches.length;state.primary.disabled=!count || !X.confirmed(state.confirm.value,count);}
      else state.primary.disabled=['finding','running'].includes(state.phase);
    }
    // B2/B3: confirm the account, read your own lists (several sorts, union by ID), then select.
    async find(){
      const state=this.state;if(!state)return;const signal=state.controller.signal,current=()=>this.state===state && !signal.aborted;
      state.phase='finding';state.results.hidden=true;this.syncPrimary();state.status.textContent='Confirming your account…';
      try{
        const me=await this.read({action:'redact-identity'},{signal});if(!current())return;
        if(!me.canWrite)throw Error('Reddit didn’t provide the token needed to edit or delete. Reload the page and try again.');
        if(state.username && state.username!==me.username)state.items.clear();
        state.username=me.username;state.status.textContent='Finding your posts and comments…';
        for(const [source,sort] of SOURCES){
          if(this.rules().kinds==='posts' && source==='comments' || this.rules().kinds==='comments' && source==='submitted')continue;
          let after=null;const cursors=new Set();
          for(let page=0;page<PAGES_PER_LIST;page++){
            const result=await this.read({action:'redact-list',username:state.username,source,sort,after},{signal});if(!current())return;
            for(const item of result.items || [])if(!state.items.has(item.fullname))state.items.set(item.fullname,item);
            state.status.textContent='Finding your posts and comments… '+n(state.items.size)+' found';
            after=result.hasMore?result.after:null;if(!after || cursors.has(after))break;cursors.add(after);
          }
        }
        state.selection=X.select([...state.items.values()],this.rules());state.phase='previewed';this.renderPreview();
      }catch(error){if(current()){state.phase='error';state.status.textContent='Couldn’t find your items: '+String(error.message).replace(/\.$/,'')+'.';state.status.dataset.error='true';}}
      finally{if(current()){if(state.phase!=='error')delete state.status.dataset.error;this.syncPrimary();}}
    }
    renderPreview(){
      const state=this.state,sel=state.selection,count=sel.matches.length;
      state.status.textContent=n(count)+' '+(count===1?'item matches':'items match')+' ('+n(sel.posts)+' '+(sel.posts===1?'post':'posts')+', '+n(sel.comments)+' '+(sel.comments===1?'comment':'comments')+') out of '+n(sel.found)+' found'+(sel.oldest?' · oldest found: '+dateText(sel.oldest):'')+' · Reddit may not list older items';
      const list=make('ul','rt-redact-rows');
      for(const item of sel.matches.slice(0,PREVIEW_ROWS)){
        const li=make('li','rt-redact-row'),meta=make('span','text-12 text-neutral-content-weak',(item.kind==='post'?'Post':'Comment')+' · r/'+item.subreddit+' · '+dateText(item.created)+' · '+n(item.score)+' points'+(X.overwritable(item)?'':' · delete only'));
        const text=(item.kind==='post'?item.title:item.body.split('\n')[0]) || '(no text)',link=make('a','rt-redact-link',text.length>140?text.slice(0,139)+'…':text);link.href=item.permalink || '#';link.target='_blank';link.rel='noopener';
        li.append(meta,link);list.append(li);
      }
      const more=count>PREVIEW_ROWS?make('p','text-12 text-neutral-content-weak m-0','and '+n(count-PREVIEW_ROWS)+' more'):null;
      const backup=make('button','button-small button-secondary button inline-flex items-center justify-center px-md','Download a copy');backup.type='button';backup.addEventListener('click',()=>this.download());
      state.preview.replaceChildren(list,...(more?[more]:[]),backup);state.preview.hidden=!count;
      state.confirmWrap.hidden=!count;state.confirmLabel.textContent='Type “'+X.confirmation(count)+'” to confirm';state.confirm.placeholder=X.confirmation(count);state.confirm.value='';
      state.primary.textContent=count?'Overwrite and delete '+n(count)+' '+(count===1?'item':'items'):'Find matching items';state.primary.classList.toggle('rt-redact-danger',Boolean(count));
      if(!count)state.phase='idle';this.syncPrimary();
    }
    download(){
      const state=this.state;if(!state?.selection)return;
      const data=JSON.stringify({account:state.username,exportedAt:new Date().toISOString(),items:state.selection.matches.map(({fullname,kind,subreddit,created,score,title,body,permalink})=>({fullname,kind,subreddit,created,score,title,body,permalink:permalink?'https://www.reddit.com'+permalink:''}))},null,2);
      const url=URL.createObjectURL(new Blob([data],{type:'application/json'})),a=make('a');a.href=url;a.download='reddit-'+state.username+'-redaction-copy.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
    }
    // B4–B6
    async runRedaction(){
      const state=this.state;if(!state || state.phase!=='previewed')return;const items=state.selection.matches,rules=state.selection.rules;
      if(!X.confirmed(state.confirm.value,items.length))return;
      state.phase='running';state.form.inert=true;state.confirm.disabled=true;this.syncPrimary();state.cancel.textContent='Stop';
      const signal=state.controller.signal;
      const stop=()=>{if(state.phase==='running'){state.stopController.abort();state.status.textContent='Stopping after the current request…';}};state.stopController=new AbortController();
      const combined=AbortSignal.any?AbortSignal.any([signal,state.stopController.signal]):state.stopController.signal;
      state.cancel.addEventListener('click',stop,{once:true});
      const write=async(item,step,text)=>{// No abort signal: Stop and Close take effect after the current request, so Reddit's answer is never lost.
        const r=await this.read({action:'redact-item',fullname:item.fullname,step,text,username:state.username},{timeout:30000});return {ok:r.written===true,rateLimited:r.rateLimited===true,retryAfterMs:r.retryAfterMs,error:r.reason};};
      state.status.textContent='Starting… about '+X.minutesLeft(items)+' min';
      const result=await X.run(items,rules,{write,sleep:this.sleep,signal:combined,onProgress:({done,failed,total})=>{if(this.state===state)state.status.textContent='Done '+n(done)+' of '+n(total)+' · '+n(failed)+' failed · about '+X.minutesLeft(items.slice(done+failed))+' min left';}});
      if(this.state!==state)return;
      state.phase='done';state.form.inert=false;state.confirm.disabled=false;state.cancel.textContent='Close';state.closeAsked=false;
      state.cancel.removeEventListener('click',stop);this.renderResults(result,items.length);this.syncPrimary();state.primary.textContent='Find matching items';state.primary.classList.remove('rt-redact-danger');state.confirmWrap.hidden=true;
    }
    renderResults(result,total){
      const state=this.state,box=state.results;box.replaceChildren();box.hidden=false;
      state.status.textContent='Deleted '+n(result.done.length)+' of '+n(total)+'. '+n(result.failed.length+result.overwrittenOnly.length)+' failed.'+(result.stopped?' '+result.stopped:'')+(result.remaining?' '+n(result.remaining)+' not processed.':'');
      const group=(title,entries)=>{if(!entries.length)return;box.append(make('h3','text-14 font-semibold m-0 text-neutral-content-strong',title));const ul=make('ul','rt-redact-rows');
        for(const {item,error} of entries.slice(0,200)){const li=make('li','rt-redact-row'),a=make('a','rt-redact-link',(item.kind==='post'?item.title:item.body.split('\n')[0]) || item.fullname);a.href=item.permalink || '#';a.target='_blank';a.rel='noopener';li.append(a,make('span','text-12 text-neutral-content-weak',error));ul.append(li);}box.append(ul);};
      group('Failed',result.failed);group('Text overwritten, delete failed',result.overwrittenOnly);
      state.preview.hidden=true;state.selection=null;
    }
  }
  globalThis.RTRedaction=Object.freeze({Redaction,FRAGMENT});
  if(window.top===window && globalThis.chrome?.runtime?.id && location.hostname!=='old.reddit.com')Object.defineProperty(globalThis,'RTRedactionInstance',{value:new Redaction()});
})();
