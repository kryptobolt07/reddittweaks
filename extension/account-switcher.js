/* Account switcher in Reddit's own account menu (docs/account-switcher-spec.md). The desktop dropdown
   (#user-drawer-content) and the phone bottom sheet (#hui-user-drawer-bottom-sheet) share one structure: ul sections
   whose first row is View Profile (faceplate-tracker > li > a[href="/user/<you>/"]), measured live 2026-11-17; signed
   out, the first row is Log In. One "Switch accounts" row goes right after that first row, built by cloning it.
   Selecting it shows, in the same menu, a panel: Back, saved accounts, Browse signed out and Add account.
   Session cookies stay in the worker; this script only sees names, avatars and states. */
(() => {
 'use strict';
 if(globalThis.RTAccountSwitcher || window.top!==window)return;
 const MENUS='#user-drawer-content,#hui-user-drawer-bottom-sheet',SVG='http://www.w3.org/2000/svg';
 const ICONS={
  checkmark:'M7.09 15.84c-.23 0-.46-.09-.64-.26L1.3 10.42a.9.9 0 010-1.27.9.9 0 011.27 0l4.52 4.52L17.5 3.26a.9.9 0 011.27 0 .9.9 0 010 1.27L7.73 15.58c-.18.18-.41.26-.64.26Z',
  add:'M19 9.1h-8.1V1H9.1v8.1H1v1.8h8.1V19h1.8v-8.1H19V9.1Z',
  swap:'M6.2 2.4 1.9 6.7l4.3 4.3 1.3-1.3-2.1-2.1H16V5.8H5.4l2.1-2.1-1.3-1.3Zm7.6 6.6-1.3 1.3 2.1 2.1H4v1.8h10.6l-2.1 2.1 1.3 1.3 4.3-4.3L13.8 9Z',
  next:'M7.4 3.6 6.1 4.9 11.2 10l-5.1 5.1 1.3 1.3 6.4-6.4-6.4-6.4Z',
  back:'M12.6 3.6 6.2 10l6.4 6.4 1.3-1.3L8.8 10l5.1-5.1-1.3-1.3Z',
  signedOut:'M2.3 1.1 1.1 2.3l3.1 3.1C2.8 6.5 1.7 8.1 1 10c1.4 3.8 5 6.5 9 6.5 1.6 0 3.1-.4 4.4-1.1l3.3 3.3 1.2-1.2L2.3 1.1ZM10 14.7c-3 0-5.8-1.9-7.1-4.7.6-1.3 1.5-2.4 2.6-3.2l1.7 1.7a3 3 0 0 0 3.9 3.9l1.6 1.6c-.9.5-1.8.7-2.7.7Zm0-11.2c-1.2 0-2.3.2-3.3.6l1.4 1.4c.6-.2 1.2-.2 1.9-.2 3 0 5.8 1.9 7.1 4.7-.4.9-1 1.7-1.6 2.4l1.3 1.3c.9-1 1.7-2.3 2.2-3.7-1.4-3.8-5-6.5-9-6.5Z'
 };
 const icon=(name,size=20)=>{const s=document.createElementNS(SVG,'svg');s.setAttribute('viewBox','0 0 20 20');s.setAttribute('width',String(size));s.setAttribute('height',String(size));s.setAttribute('fill','currentColor');s.setAttribute('aria-hidden','true');s.dataset.rtIcon=name;const p=document.createElementNS(SVG,'path');p.setAttribute('d',ICONS[name]);s.append(p);return s;};
 const send=message=>new Promise(resolve=>{try{chrome.runtime.sendMessage({scope:'rt-accounts',...message},response=>{void chrome.runtime.lastError;resolve(response || {ok:false,error:'Accounts are unavailable. Reload this tab.'});});}catch{resolve({ok:false,error:'Accounts are unavailable. Reload this tab.'});}});
 // Reddit's logged-in account ID; '' when signed out; null before Reddit's app element exists.
 const signedIn=()=>{const app=document.querySelector('shreddit-app');if(!app)return null;const owner=(app.getAttribute('logged-in-user-id') || '').toLowerCase();return app.getAttribute('user-logged-in')==='true' && /^t2_[a-z0-9]{1,13}$/.test(owner)?owner:'';};
 const profileRow=menu=>{for(const li of menu.querySelectorAll('li')){const href=li.querySelector(':scope > a')?.getAttribute('href') || '';if(/^\/user\/[\w-]{3,20}\/?$/.test(href))return li;}return null;};
 // Signed out, Reddit's menu starts with its Log In row: the switcher sits after that one.
 const firstRow=menu=>[...menu.querySelectorAll('ul li')].find(li=>li.querySelector(':scope > a, :scope > button') && !li.closest('[data-rt-ui]')) || null;
 const avatarOf=row=>{const img=row.querySelector('img[src^="https://"]');return img?img.src:'';};

 class Switcher{
  constructor({send:transport=send}={}){
   this.send=transport;this.lists=new WeakMap();this.panels=new WeakMap();this.queued=false;this.dead=false;
   this.observer=new MutationObserver(()=>this.schedule());
   this.observer.observe(document.documentElement,{childList:true,subtree:true});
   // Opening Reddit's menu again always starts from its own view.
   this.onPress=event=>{if(event.target?.closest?.('#expand-user-drawer-button'))for(const menu of document.querySelectorAll(MENUS))this.closePanel(menu);};
   this.onKey=event=>{if(event.key!=='Escape')return;const menu=[...document.querySelectorAll(MENUS)].find(m=>this.panels.get(m)?.open);if(!menu)return;event.preventDefault();event.stopPropagation();this.closePanel(menu,true);};
   document.addEventListener('pointerdown',this.onPress,true);document.addEventListener('keydown',this.onKey,true);
   this.ready=this.remember().then(()=>this.scan());
  }
  remember(){
   const owner=signedIn();if(owner===null)return Promise.resolve();
   // Every signed-in page refreshes a saved account's session (rotating tokens) and settles a pending switch; an
   // account not saved yet is saved now, so switching works straight away.
   return this.send({action:'remember',owner}).then(result=>{this.anonymous=result?.anonymous===true;return result?.save?this.saveNew(owner):result;});
  }
  // Read this account's own name from Reddit once and save it.
  async saveNew(owner){
   try{const response=await fetch('/api/me.json',{credentials:'include',cache:'no-store',headers:{Accept:'application/json'}});if(!response.ok)return;const me=(await response.json())?.data;
    if(!me || 't2_'+String(me.id || '').toLowerCase()!==owner || !/^[\w-]{3,20}$/.test(me.name || ''))return;
    return this.send({action:'save-current',owner,username:me.name,avatar:String(me.icon_img || '').split('?')[0].startsWith('https://')?me.icon_img:''});}catch{}
  }
  schedule(){if(this.queued || this.dead)return;this.queued=true;queueMicrotask(()=>{this.queued=false;if(!this.dead)this.scan();});}
  scan(){
   const owner=signedIn();
   for(const menu of document.querySelectorAll(MENUS)){
    const row=owner?profileRow(menu):owner===''?firstRow(menu):null,entry=menu.querySelector('[data-rt-ui="accounts"]');
    if(!row){entry?.remove();this.closePanel(menu);continue;}
    const anchor=row.parentElement?.matches('faceplate-tracker')?row.parentElement:row;
    const panel=this.panels.get(menu);if(panel?.open && !panel.node.isConnected)this.openPanel(menu);
    if(entry && entry.previousElementSibling===anchor && entry.dataset.owner===owner)continue;
    entry?.remove();
    // Signed out, the row appears only when something is saved: decide first, so it is never added and removed again.
    if(!owner){const state=this.panels.get(menu) || {};if(state.checking || state.emptyUntil>Date.now())continue;state.checking=true;this.panels.set(menu,state);
     this.load(menu,this.context(row,owner)).then(result=>{state.checking=false;if(this.dead || !row.isConnected)return;if(!(result?.ok && (result.accounts.length || result.anonymous))){state.emptyUntil=Date.now()+5000;return;}if(!menu.querySelector('[data-rt-ui="accounts"]'))this.render(menu,anchor,row,owner);});continue;}
    this.render(menu,anchor,row,owner);
   }
  }
  context(row,owner){
   const href=row.querySelector(':scope > a')?.getAttribute('href') || '';
   return {owner,username:owner?(href.split('/')[2] || ''):'',avatar:owner?avatarOf(row):''};
  }
  async load(menu,{owner,username,avatar}){
   let pending=this.lists.get(menu);
   if(!pending || pending.owner!==owner || Date.now()-pending.at>5000){
    const job=(async()=>{let result=await this.send({action:'list',owner});
     // First time the menu shows for an unsaved account: save it, so switching back is possible.
     if(owner && result?.ok && !result.accounts.some(a=>a.owner===owner)){const saved=await this.send({action:'save-current',owner,username,avatar});if(saved?.ok)result={...result,ok:true,accounts:saved.accounts};}
     return result;})();
    pending={owner,at:Date.now(),job};this.lists.set(menu,pending);
   }
   return pending.job;
  }
  // The single entry row in Reddit's menu.
  render(menu,anchor,row,owner){
   const me=this.context(row,owner);
   const entry=this.row(row,{label:'Switch accounts',caption:'',lead:'swap',tail:'next',run:async()=>{this.openPanel(menu);return {ok:true,stay:true};}});
   entry.dataset.rtUi='accounts';entry.dataset.owner=owner;entry.querySelector(':scope > a')?.setAttribute('aria-haspopup','menu');
   const wrap=anchor.matches('faceplate-tracker')?(()=>{const w=document.createElement('div');w.className='contents';w.setAttribute('role','presentation');return w;})():null;
   if(wrap){wrap.dataset.rtUi='accounts';wrap.dataset.owner=owner;delete entry.dataset.rtUi;wrap.append(entry);anchor.after(wrap);}else anchor.after(entry);
   this.panels.set(menu,{...(this.panels.get(menu) || {}),source:row,me,open:this.panels.get(menu)?.open || false});
   this.load(menu,me).then(result=>{
    if(!entry.isConnected || this.dead)return;const caption=entry.querySelector('.text-caption-1');
    if(!result?.ok){if(caption){caption.textContent=result?.error || 'Reload this tab to retry.';caption.hidden=false;}return;}
    const others=result.accounts.filter(a=>a.owner!==owner).length;
    if(caption){caption.textContent=result.anonymous?'Browsing signed out':others?others+(others===1?' other account':' other accounts'):'Add another account';caption.hidden=false;}
   });
  }
  // The panel replaces the menu's sections in place; Reddit's nodes are hidden, never removed.
  openPanel(menu){
   const state=this.panels.get(menu);if(!state?.source)return;
   const list=state.source.closest('ul'),container=list?.parentElement;if(!container)return;
   if(state.node?.isConnected)state.node.remove();
   const panel=document.createElement('ul');panel.className=list.className;panel.dataset.rtUi='accounts-panel';panel.setAttribute('role','menu');panel.setAttribute('aria-label','Switch accounts');
   const hidden=[];for(const child of container.children){if(child===panel || child.dataset?.rtUi==='accounts-panel')continue;hidden.push([child,child.style.display]);child.style.display='none';}
   state.hidden=hidden;state.node=panel;state.open=true;container.append(panel);
   const me=state.me,back=this.row(state.source,{label:'Switch accounts',caption:'',lead:'back',run:async()=>{this.closePanel(menu,true);return {ok:true,stay:true};}});
   back.dataset.rtUi='account-back';panel.append(back);
   this.load(menu,me).then(result=>{
    if(!panel.isConnected || this.dead)return;
    const rows=[],rule=()=>{const li=document.createElement('li');li.setAttribute('role','separator');li.className='list-none';const hr=document.createElement('hr');hr.className='h-px w-100 bg-neutral-border-weak border-0 my-xs';li.append(hr);return li;};
    rows.push(rule());
    if(!result?.ok)rows.push(this.row(state.source,{label:'Accounts unavailable',caption:result?.error || 'Reload this tab to retry.',disabled:true}));
    else for(const account of result.accounts){
     const current=!result.anonymous && account.owner===me.owner;
     rows.push(this.row(state.source,{label:'u/'+account.username,caption:current?'Signed in':account.expired?'Sign in again':account.private?'This private window':'Switch to this account',avatar:account.avatar,keepAvatar:current && Boolean(me.owner),check:current,owner:account.owner,
      confirm:account.expired && !current,run:current?null:account.expired?()=>this.add(me):()=>this.switchTo(account.owner,me.owner)}));
    }
    rows.push(rule());
    rows.push(this.row(state.source,{label:'Browse signed out',caption:result?.anonymous?'Signed out here':'Use Reddit without an account',lead:'signedOut',check:result?.anonymous===true,confirm:true,run:result?.anonymous?null:()=>this.anonymousMode(me)}));
    rows.push(this.row(state.source,{label:'Add account',caption:'Sign in to another account',lead:'add',confirm:true,run:()=>this.add(me)}));
    panel.append(...rows);
    panel.querySelector('[data-owner] a[tabindex="0"],[data-rt-ui="account-row"] a[tabindex="0"]')?.focus?.({preventScroll:true});
   });
   back.querySelector(':scope > a')?.focus?.({preventScroll:true});
  }
  closePanel(menu,focus=false){
   const state=this.panels.get(menu);if(!state?.open)return;
   for(const [child,display] of state.hidden || [])child.style.display=display;
   state.node?.remove();state.open=false;state.hidden=null;state.node=null;
   if(focus)menu.querySelector('[data-rt-ui="accounts"] a,[data-rt-ui="accounts"]')?.focus?.({preventScroll:true});
  }
  row(source,{label,caption,avatar='',keepAvatar=false,check=false,lead='',tail='',disabled=false,owner='',confirm=false,run=null}){
   const li=source.cloneNode(true);let a=li.querySelector(':scope > a, :scope > button');
   if(a?.tagName==='BUTTON'){const link=document.createElement('a');link.className=a.className;link.append(...a.childNodes);a.replaceWith(link);a=link;}
   if(!a){a=document.createElement('a');a.className='flex justify-between relative px-md gap-xs text-secondary-plain hover:bg-neutral-background-hover cursor-pointer py-xs no-underline';li.replaceChildren(a);}
   li.dataset.rtUi='account-row';if(owner)li.dataset.owner=owner;for(const attr of ['id','noun','data-testid'])li.removeAttribute(attr);
   a.removeAttribute('href');a.removeAttribute('style');a.style.paddingInlineEnd='16px';a.setAttribute('role','menuitem');a.tabIndex=disabled?-1:0;
   if(disabled)a.setAttribute('aria-disabled','true');
   // Reddit's row: [lead slot][title, caption] … [tail]. Build that shape when the cloned row lacks it (signed-out rows).
   let texts=a.querySelectorAll('.text-body-2,.text-caption-1');
   if(texts.length<2){
    const body=document.createElement('span');body.className='flex items-center gap-xs min-w-0 shrink';const slotEl=document.createElement('span');slotEl.className='flex shrink-0 items-center justify-center h-xl w-xl';
    const copy=document.createElement('span');copy.className='flex flex-col justify-center min-w-0 shrink py-[0.375rem]';const t=document.createElement('span');t.className='text-body-2';const c=document.createElement('span');c.className='text-caption-1 text-secondary-plain-weak';copy.append(t,c);body.append(slotEl,copy);
    const end=document.createElement('span');end.className='flex items-center shrink-0';const endSlot=document.createElement('span');endSlot.className='flex items-center justify-center h-lg';end.append(endSlot);
    a.replaceChildren(body,end);texts=a.querySelectorAll('.text-body-2,.text-caption-1');
   }
   texts[0].textContent=label;texts[1].textContent=caption;texts[1].hidden=!caption;
   const slot=a.querySelector('span.shrink-0.items-center.justify-center') || a.firstElementChild?.firstElementChild;
   if(slot && !keepAvatar){
    if(lead)slot.replaceChildren(icon(lead));
    else if(avatar){const img=document.createElement('img');img.src=avatar;img.alt='';img.className='rounded-full w-xl h-xl';img.loading='lazy';img.referrerPolicy='no-referrer';slot.replaceChildren(img);}
   }
   const end=a.lastElementChild?.firstElementChild;if(end){end.replaceChildren();if(check){end.append(icon('checkmark',16));a.setAttribute('aria-current','true');}else if(tail)end.append(icon(tail,16));}
   // Only a real click, tap or key press by the person acts: Reddit's own scripts must never switch or sign out.
   const activate=event=>{
    if(event.type==='keydown' && !['Enter',' '].includes(event.key))return;if(!event.isTrusted && !globalThis.__rtAccountSwitcherTest)return;
    // Keep Reddit's menu (and its phone sheet) from treating our row as one of its own items and closing.
    event.preventDefault();event.stopPropagation();event.stopImmediatePropagation?.();if(!run || li.dataset.busy)return;
    // Signing out here (Add account, Browse signed out) asks once more; the current account is saved first.
    if(confirm && !li.dataset.armed){li.dataset.armed='true';texts[1].hidden=false;texts[1].textContent='Select again to continue';clearTimeout(li.rtDisarm);li.rtDisarm=setTimeout(()=>{delete li.dataset.armed;if(!li.dataset.busy){texts[1].textContent=caption;texts[1].hidden=!caption;}},4000);return;}
    clearTimeout(li.rtDisarm);delete li.dataset.armed;li.dataset.busy='true';
    const working=lead==='add'?'Opening Reddit sign-in…':lead==='signedOut'?'Signing out here…':lead?'':'Switching…';if(working){texts[1].hidden=false;texts[1].textContent=working;}
    run().then(result=>{if(result?.ok && !result.stay)return;delete li.dataset.busy;if(result?.ok)return;texts[1].hidden=false;texts[1].textContent=result?.expired?'Sign in again':result?.error || 'Could not switch. Try again.';});
   };
   // Phones: Reddit's bottom sheet handles touches for dragging and may never deliver the tap's click, so a touch tap
   // (lifted within 10 px of where it started) acts on pointerup; the click that may follow is then ignored.
   let down=null,tappedAt=0;
   const press=event=>{event.stopPropagation();if(event.type==='pointerdown')down=['touch','pen'].includes(event.pointerType)?{x:event.clientX,y:event.clientY,id:event.pointerId}:null;};
   const lift=event=>{event.stopPropagation();const start=down;down=null;if(!start || event.pointerId!==start.id || !['touch','pen'].includes(event.pointerType))return;if(Math.hypot(event.clientX-start.x,event.clientY-start.y)>10)return;tappedAt=Date.now();activate(event);};
   a.addEventListener('click',event=>{if(Date.now()-tappedAt<800){event.preventDefault();event.stopPropagation();return;}activate(event);});a.addEventListener('keydown',activate);
   a.addEventListener('pointerdown',press);a.addEventListener('pointerup',lift);a.addEventListener('pointercancel',()=>{down=null;});
   for(const type of ['touchstart','touchend','mousedown','mouseup'])a.addEventListener(type,event=>event.stopPropagation());
   return li;
  }
  switchTo(target,from){return this.send({action:'switch',owner:target,from});}
  add(me){return this.send({action:'add',owner:me.owner,username:me.username,avatar:me.avatar});}
  anonymousMode(me){return this.send({action:'anonymous',from:me.owner,username:me.username,avatar:me.avatar});}
  destroy(){
   this.dead=true;this.observer.disconnect();document.removeEventListener('pointerdown',this.onPress,true);document.removeEventListener('keydown',this.onKey,true);
   for(const menu of document.querySelectorAll(MENUS))this.closePanel(menu);for(const node of document.querySelectorAll('[data-rt-ui="accounts"],[data-rt-ui="accounts-panel"]'))node.remove();
  }
 }
 globalThis.RTAccountSwitcher=Object.freeze({Switcher,profileRow});
 if(globalThis.chrome?.runtime?.id && !globalThis.__rtAccountSwitcherTest)new Switcher();
})();
