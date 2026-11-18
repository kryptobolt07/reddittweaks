/* Popup Accounts card (docs/account-switcher-spec.md): saved accounts with Switch, Sign in again, Remove and Add account.
   The worker keeps the sessions; this page only receives names, avatars and states. */
(() => {
 'use strict';
 const card=document.getElementById('accounts-home');if(!card)return;
 const list=card.querySelector('#account-list'),add=card.querySelector('#add-account'),anonymous=card.querySelector('#browse-signed-out'),status=card.querySelector('#accounts-status');let signedOut=false;
 const send=message=>Promise.resolve().then(()=>chrome.runtime.sendMessage({scope:'rt-accounts',...message})).then(r=>r || {ok:false,error:'Accounts are unavailable.'},error=>({ok:false,error:error?.message || 'Accounts are unavailable.'}));
 const say=(text,error=false)=>{status.textContent=text;status.classList.toggle('error',error);};
 const make=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text!=null)el.textContent=text;return el;};
 const busy=on=>{for(const b of card.querySelectorAll('button'))b.disabled=on;};
 async function refresh(){
  const result=await send({action:'list'});
  if(!result?.ok){list.replaceChildren();say(result?.error || 'Accounts are unavailable.',true);return;}
  signedOut=result.anonymous===true;if(anonymous){anonymous.textContent=signedOut?'Browsing anonymously':'Anonymous browsing';anonymous.disabled=signedOut;anonymous.setAttribute('aria-pressed',String(signedOut));}
  if(!result.accounts.length){list.replaceChildren(make('li','account-empty','No saved accounts yet. Accounts you’re signed in to on Reddit are saved automatically, or use Add account.'));return;}
  list.replaceChildren(...result.accounts.map(row));
 }
 async function addAccount(){busy(true);say('Opening Reddit sign-in…');const r=await send({action:'add'});busy(false);if(!r?.ok)say(r?.error || 'Could not open Reddit sign-in.',true);else say('Sign in on the Reddit tab. The new account is saved when you do.');}
 function row(account){
  const li=make('li');li.dataset.owner=account.owner;if(account.current)li.dataset.current='true';if(account.expired)li.dataset.expired='true';
  const fallback=make('span','account-avatar',(account.username || '?')[0]);fallback.setAttribute('aria-hidden','true');
  let avatar=fallback;
  if(account.avatar){
   avatar=make('img','account-avatar');avatar.alt='';avatar.referrerPolicy='no-referrer';
   avatar.addEventListener('error',()=>avatar.replaceWith(fallback),{once:true});
   avatar.src=account.avatar;
  }
  const copy=make('span','account-copy');copy.append(make('span','account-name','u/'+account.username),make('span','account-caption',account.current?'Signed in':account.expired?'Session expired':account.private?'This private window':'Saved on this device'));
  li.append(avatar,copy);
  if(!account.current){
   const go=make('button','account-switch',account.expired?'Sign in again':'Switch');go.type='button';
   go.addEventListener('click',async()=>{
    if(account.expired)return addAccount();
    busy(true);say('Switching to u/'+account.username+'…');const r=await send({action:'switch',owner:account.owner});busy(false);
    if(r?.ok){say('Switched to u/'+account.username+'. Open Reddit tabs reload as this account.');refresh();}
    else{say(r?.error || 'Could not switch accounts.',true);refresh();}
   });
   const remove=make('button','account-remove','×');remove.type='button';remove.setAttribute('aria-label','Remove u/'+account.username+' from this device');remove.title='Remove from this device';let timer=0;
   remove.addEventListener('click',async()=>{
    if(!remove.classList.contains('confirming')){remove.classList.add('confirming');remove.textContent='Remove?';clearTimeout(timer);timer=setTimeout(()=>{remove.classList.remove('confirming');remove.textContent='×';},4000);return;}
    clearTimeout(timer);busy(true);const r=await send({action:'remove',owner:account.owner});busy(false);
    if(r?.ok){say('Removed u/'+account.username+' from this device. Its Reddit session was not signed out.');refresh();}else say(r?.error || 'Could not remove the account.',true);
   });
   li.append(go,remove);
  }
  return li;
 }
 add.addEventListener('click',addAccount);
 // Anonymous browsing signs Reddit out in this window (accounts stay saved), so it asks once more.
 let armed=0;
 anonymous?.addEventListener('click',async()=>{
  if(signedOut)return;
  if(!anonymous.classList.contains('confirming')){anonymous.classList.add('confirming');anonymous.textContent='Sign out here?';clearTimeout(armed);armed=setTimeout(()=>{anonymous.classList.remove('confirming');anonymous.textContent='Anonymous browsing';},4000);return;}
  clearTimeout(armed);anonymous.classList.remove('confirming');busy(true);say('Signing Reddit out here…');const r=await send({action:'anonymous'});busy(false);
  if(r?.ok){say('Browsing Reddit signed out. Your accounts stay saved; switch back any time.');refresh();}else{anonymous.textContent='Anonymous browsing';say(r?.error || 'Could not sign out here.',true);}
 });
 refresh();
})();
