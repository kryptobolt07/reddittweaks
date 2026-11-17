/* Account switcher in Reddit's own account menu (docs/account-switcher-spec.md). The desktop dropdown
   (#user-drawer-content) and the phone bottom sheet (#hui-user-drawer-bottom-sheet) share one structure: ul sections
   whose first row is View Profile (faceplate-tracker > li > a[href="/user/<you>/"]), measured live 2026-11-17.
   An Accounts group (saved accounts, then Add account) goes directly after View Profile, built by cloning that row.
   Session cookies stay in the worker; this script only sees names, avatars and states. */
(() => {
 'use strict';
 if(globalThis.RTAccountSwitcher || window.top!==window)return;
 const MENUS='#user-drawer-content,#hui-user-drawer-bottom-sheet',SVG='http://www.w3.org/2000/svg';
 const ICONS={checkmark:'M7.09 15.84c-.23 0-.46-.09-.64-.26L1.3 10.42a.9.9 0 010-1.27.9.9 0 011.27 0l4.52 4.52L17.5 3.26a.9.9 0 011.27 0 .9.9 0 010 1.27L7.73 15.58c-.18.18-.41.26-.64.26Z',add:'M19 9.1h-8.1V1H9.1v8.1H1v1.8h8.1V19h1.8v-8.1H19V9.1Z'};
 const icon=(name,size=20)=>{const s=document.createElementNS(SVG,'svg');s.setAttribute('viewBox','0 0 20 20');s.setAttribute('width',String(size));s.setAttribute('height',String(size));s.setAttribute('fill','currentColor');s.setAttribute('aria-hidden','true');s.dataset.rtIcon=name;const p=document.createElementNS(SVG,'path');p.setAttribute('d',ICONS[name]);s.append(p);return s;};
 const send=message=>new Promise(resolve=>{try{chrome.runtime.sendMessage({scope:'rt-accounts',...message},response=>{void chrome.runtime.lastError;resolve(response || {ok:false,error:'Accounts are unavailable. Reload this tab.'});});}catch{resolve({ok:false,error:'Accounts are unavailable. Reload this tab.'});}});
 // Reddit's logged-in account ID; '' when signed out; null before Reddit's app element exists.
 const signedIn=()=>{const app=document.querySelector('shreddit-app');if(!app)return null;const owner=(app.getAttribute('logged-in-user-id') || '').toLowerCase();return app.getAttribute('user-logged-in')==='true' && /^t2_[a-z0-9]{1,13}$/.test(owner)?owner:'';};
 const profileRow=menu=>{for(const li of menu.querySelectorAll('li')){const href=li.querySelector(':scope > a')?.getAttribute('href') || '';if(/^\/user\/[\w-]{3,20}\/?$/.test(href))return li;}return null;};
 const avatarOf=row=>{const img=row.querySelector('img[src^="https://"]');return img?img.src:'';};

 class Switcher{
  constructor({send:transport=send}={}){
   this.send=transport;this.lists=new WeakMap();this.queued=false;this.dead=false;
   this.observer=new MutationObserver(()=>this.schedule());
   this.observer.observe(document.documentElement,{childList:true,subtree:true});
   this.ready=this.remember().then(()=>this.scan());
  }
  remember(){
   const owner=signedIn();if(owner===null)return Promise.resolve();
   // Every signed-in page refreshes a saved account's session (rotating tokens) and settles a pending switch.
   return this.send({action:'remember',owner}).then(result=>result?.save?this.saveNew(owner):result);
  }
  // Just signed in through Add account: read this account's own name from Reddit once and save it.
  async saveNew(owner){
   try{const response=await fetch('/api/me.json',{credentials:'include',cache:'no-store',headers:{Accept:'application/json'}});if(!response.ok)return;const me=(await response.json())?.data;
    if(!me || 't2_'+String(me.id || '').toLowerCase()!==owner || !/^[\w-]{3,20}$/.test(me.name || ''))return;
    return this.send({action:'save-current',owner,username:me.name,avatar:String(me.icon_img || '').split('?')[0].startsWith('https://')?me.icon_img:''});}catch{}
  }
  schedule(){if(this.queued || this.dead)return;this.queued=true;queueMicrotask(()=>{this.queued=false;if(!this.dead)this.scan();});}
  scan(){
   const owner=signedIn();
   for(const menu of document.querySelectorAll(MENUS)){
    const row=profileRow(menu),group=menu.querySelector('[data-rt-ui="accounts"]');
    if(!owner || !row){group?.remove();continue;}
    const anchor=row.parentElement?.matches('faceplate-tracker')?row.parentElement:row;
    if(group && group.previousElementSibling===anchor && group.dataset.owner===owner)continue;
    group?.remove();this.render(menu,anchor,row,owner);
   }
  }
  async load(menu,owner,username,avatar){
   let pending=this.lists.get(menu);
   if(!pending || pending.owner!==owner || Date.now()-pending.at>5000){
    const job=(async()=>{let result=await this.send({action:'list',owner});
     // First time the menu shows for an unsaved account: save it, so switching back is possible.
     if(result?.ok && !result.accounts.some(a=>a.owner===owner)){const saved=await this.send({action:'save-current',owner,username,avatar});if(saved?.ok)result={ok:true,accounts:saved.accounts};}
     return result;})();
    pending={owner,at:Date.now(),job};this.lists.set(menu,pending);
   }
   return pending.job;
  }
  render(menu,anchor,row,owner){
   const username=(row.querySelector(':scope > a').getAttribute('href').split('/')[2] || ''),avatar=avatarOf(row);
   const group=document.createElement('div');group.className='contents';group.setAttribute('role','presentation');group.dataset.rtUi='accounts';group.dataset.owner=owner;
   const rule=()=>{const hr=document.createElement('hr');hr.className='h-px w-100 bg-neutral-border-weak border-0 my-xs';return hr;};
   group.append(rule(),rule());anchor.after(group);
   this.load(menu,owner,username,avatar).then(result=>{
    if(!group.isConnected || this.dead)return;
    const rows=[];
    if(!result?.ok){rows.push(this.row(row,{label:'Accounts unavailable',caption:result?.error || 'Reload this tab to retry.',disabled:true}));}
    else{
     for(const account of result.accounts){
      const current=account.owner===owner;
      rows.push(this.row(row,{label:'u/'+account.username,caption:current?'Signed in':account.expired?'Sign in again':'Switch account',avatar:account.avatar,keepAvatar:current,check:current,owner:account.owner,
       confirm:account.expired && !current,run:current?null:account.expired?()=>this.add(owner,username,avatar):()=>this.switchTo(account.owner,owner)}));
     }
    }
    rows.push(this.row(row,{label:'Add account',caption:'Sign in to another account',plus:true,confirm:true,run:()=>this.add(owner,username,avatar)}));
    group.lastElementChild.before(...rows);
   });
  }
  row(source,{label,caption,avatar='',keepAvatar=false,check=false,plus=false,disabled=false,owner='',confirm=false,run=null}){
   const li=source.cloneNode(true),a=li.querySelector(':scope > a');
   li.dataset.rtUi='account-row';if(owner)li.dataset.owner=owner;
   a.removeAttribute('href');a.removeAttribute('style');a.style.paddingInlineEnd='16px';a.setAttribute('role','menuitem');a.tabIndex=disabled?-1:0;
   if(disabled)a.setAttribute('aria-disabled','true');
   const texts=a.querySelectorAll('.text-body-2,.text-caption-1');if(texts[0])texts[0].textContent=label;if(texts[1])texts[1].textContent=caption;
   const slot=a.querySelector('span.shrink-0.items-center.justify-center') || a.firstElementChild?.firstElementChild;
   if(slot && !keepAvatar){
    if(plus)slot.replaceChildren(icon('add'));
    else if(avatar){const img=document.createElement('img');img.src=avatar;img.alt='';img.className='rounded-full w-xl h-xl';img.loading='lazy';img.referrerPolicy='no-referrer';slot.replaceChildren(img);}
   }
   const tail=a.lastElementChild?.firstElementChild;if(tail){tail.replaceChildren();if(check){tail.append(icon('checkmark',16));a.setAttribute('aria-current','true');}}
   // Only a real click or key press by the person acts: Reddit's own scripts must never switch or sign out by script.
   const activate=event=>{if(event.type==='keydown' && !['Enter',' '].includes(event.key))return;if(!event.isTrusted && !globalThis.__rtAccountSwitcherTest)return;event.preventDefault();event.stopPropagation();if(!run || li.dataset.busy)return;
    // Adding an account signs Reddit out in this browser (the current account is saved first), so it asks once more.
    if(confirm && !li.dataset.armed){li.dataset.armed='true';if(texts[1])texts[1].textContent='Select again to continue';clearTimeout(li.rtDisarm);li.rtDisarm=setTimeout(()=>{delete li.dataset.armed;if(texts[1] && !li.dataset.busy)texts[1].textContent=caption;},4000);return;}
    clearTimeout(li.rtDisarm);delete li.dataset.armed;li.dataset.busy='true';if(texts[1])texts[1].textContent=plus?'Opening Reddit sign-in…':'Switching…';
    run().then(result=>{if(result?.ok)return;delete li.dataset.busy;if(texts[1])texts[1].textContent=result?.expired?'Sign in again':result?.error || 'Could not switch. Try again.';});};
   a.addEventListener('click',activate);a.addEventListener('keydown',activate);
   return li;
  }
  switchTo(target,from){return this.send({action:'switch',owner:target,from});}
  add(owner,username,avatar){return this.send({action:'add',owner,username,avatar});}
  destroy(){this.dead=true;this.observer.disconnect();for(const group of document.querySelectorAll('[data-rt-ui="accounts"]'))group.remove();}
 }
 globalThis.RTAccountSwitcher=Object.freeze({Switcher,profileRow});
 if(globalThis.chrome?.runtime?.id && !globalThis.__rtAccountSwitcherTest)new Switcher();
})();
