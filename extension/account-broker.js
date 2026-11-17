/* Account switcher (docs/account-switcher-spec.md). Each saved Reddit account keeps a snapshot of its five session
   cookies here in the worker; pages and the popup only ever receive names, avatars and states. By the user's explicit
   choice this stores Reddit sessions on this device (recorded as an exception in AGENTS.md). */
(() => {
 'use strict';
 if(globalThis.RTAccountBroker)return;
 const KEY='rt-accounts-v1',LOGIN='https://www.reddit.com/login/',MAX=20;
 // Measured 2026-11-17: the signed-in session lives in these cookies; everything else is device or analytics state.
 const SESSION=['reddit_session','token_v2','loid','csrf_token','session_tracker'];
 const ownerOK=value=>/^t2_[a-z0-9]{1,13}$/i.test(value || ''),nameOK=value=>/^[\w-]{1,20}$/.test(value || '');
 const avatarOf=value=>{const url=globalThis.RTPostModel?.avatarUrl?.(value) || '';return url.length<=2048?url:'';};
 const redditPage=sender=>{try{const u=new URL(sender.url);return (sender.frameId==null || sender.frameId===0) && Number.isInteger(sender.tab?.id) && u.protocol==='https:' && !u.port && ['reddit.com','www.reddit.com','new.reddit.com','sh.reddit.com'].includes(u.hostname);}catch{return false;}};
 const popupPage=sender=>!sender.tab && sender.url===chrome.runtime.getURL('popup.html');
 async function state(){const value=(await chrome.storage.local.get(KEY))?.[KEY];return {accounts:Array.isArray(value?.accounts)?value.accounts.filter(a=>ownerOK(a?.owner)):[],current:ownerOK(value?.current)?value.current:'',pending:ownerOK(value?.pending)?value.pending:'',adding:ownerOK(value?.adding?.from)?{from:value.adding.from,at:Number(value.adding.at) || 0,tab:Number.isInteger(value.adding.tab)?value.adding.tab:null}:null};}
 const save=value=>chrome.storage.local.set({[KEY]:value});
 async function snapshot(){
  const all=await chrome.cookies.getAll({domain:'reddit.com'});
  return all.filter(c=>SESSION.includes(c.name)).map(c=>({name:c.name,value:c.value,domain:c.domain,path:c.path || '/',secure:c.secure,httpOnly:c.httpOnly,sameSite:c.sameSite,hostOnly:c.hostOnly,session:c.session,expirationDate:c.expirationDate}));
 }
 const cookieUrl=c=>'https://'+String(c.domain || 'reddit.com').replace(/^\./,'')+(c.path || '/');
 // Signing out locally removes only the sign-in cookies: Reddit's sign-in form needs the device's csrf_token and loid.
 const AUTH=['reddit_session','token_v2'];
 async function clearSession(names=SESSION){for(const c of await chrome.cookies.getAll({domain:'reddit.com'}))if(names.includes(c.name))await chrome.cookies.remove({url:cookieUrl(c),name:c.name});}
 async function apply(cookies){
  await clearSession();
  for(const c of cookies){const details={url:cookieUrl(c),name:c.name,value:c.value,path:c.path || '/',secure:c.secure!==false,httpOnly:Boolean(c.httpOnly)};if(['lax','strict','no_restriction'].includes(c.sameSite))details.sameSite=c.sameSite;if(!c.hostOnly)details.domain=c.domain;if(!c.session && Number.isFinite(c.expirationDate))details.expirationDate=c.expirationDate;await chrome.cookies.set(details);}
 }
 // Saving (or refreshing) the account the browser is signed into now.
 async function store(s,{owner,username,avatar}){
  const cookies=await snapshot();if(!cookies.some(c=>c.name==='reddit_session'))return false;
  const now=Date.now(),existing=s.accounts.find(a=>a.owner===owner);
  if(existing){existing.cookies=cookies;existing.savedAt=now;existing.expired=false;if(nameOK(username))existing.username=username;if(avatar)existing.avatar=avatarOf(avatar) || existing.avatar;}
  else{if(!nameOK(username))return false;s.accounts.push({owner,username,avatar:avatarOf(avatar),savedAt:now,expired:false,cookies});if(s.accounts.length>MAX)s.accounts.shift();}
  return true;
 }
 // A signed-in session the switcher has not saved would be lost by clearing or replacing cookies.
 async function unsavedSession(s,owner){const signed=(await snapshot()).some(c=>c.name==='reddit_session');return signed && !(ownerOK(owner) && s.accounts.some(a=>a.owner===owner));}
 const UNSAVED='Open Reddit’s account menu once so the account you’re signed in to is saved first.';
 const view=(s,current)=>s.accounts.map(a=>({owner:a.owner,username:a.username,avatar:a.avatar || '',savedAt:a.savedAt,expired:a.expired===true,current:a.owner===current}));
 // Reddit's sign-in and sign-up pages: a signed-out report from these means sign-in is still in progress.
 const authPage=url=>{try{return /^\/(login|register|account|password|verification|onboarding)(\/|$)/i.test(new URL(url).pathname);}catch{return false;}};
 // Add account did not end in a sign-in: put the account you came from back, and show it in every Reddit tab.
 async function restore(s){const from=s.accounts.find(a=>a.owner===s.adding?.from);s.adding=null;if(!from)return false;await apply(from.cookies);s.current=from.owner;s.pending='';await save(s);for(const tab of await redditTabs())chrome.tabs.reload(tab.id).catch?.(()=>{});return true;}
 async function redditTabs(){return (await chrome.tabs.query({url:['https://*.reddit.com/*','https://reddit.com/*']})).filter(t=>Number.isInteger(t.id));}
 async function handle(message,sender){
  if(sender?.id!==chrome.runtime.id || !(redditPage(sender) || popupPage(sender)))throw Error('Accounts can only be managed from Reddit or this extension.');
  const s=await state(),owner=String(message.owner || '').toLowerCase();
  if(message.action==='list'){const current=redditPage(sender)?(ownerOK(owner)?owner:''):s.current;return {ok:true,accounts:view(s,current),current};}
  if(message.action==='remember'){
   // A page reports who is signed in now. A switch that did not land on its target means that session expired.
   const now=ownerOK(owner)?owner:'';if(s.pending && s.pending!==now){const target=s.accounts.find(a=>a.owner===s.pending);if(target)target.expired=true;}
   s.pending='';
   const fromSignIn=s.adding && (s.adding.tab==null || sender.tab?.id===s.adding.tab || Date.now()-s.adding.at>600000);
   if(fromSignIn && !now && !authPage(sender.url) && redditPage(sender))return {ok:true,restored:await restore(s)};
   s.current=now;const saved=now && s.accounts.some(a=>a.owner===now);if(saved)await store(s,{owner:now,username:message.username,avatar:message.avatar});
   // Signed in during Add account: the page reads its own name and saves the new account.
   const fresh=Boolean(s.adding && now);if(now)s.adding=null;
   await save(s);return {ok:true,save:fresh && !saved};
  }
  if(message.action==='save-current'){if(!redditPage(sender) || !ownerOK(owner))throw Error('Open Reddit signed in to save this account.');if(!await store(s,{owner,username:message.username,avatar:message.avatar}))throw Error('Reddit’s session was not found.');s.current=owner;await save(s);return {ok:true,accounts:view(s,owner)};}
  if(message.action==='remove'){if(!ownerOK(owner))throw Error('Unknown account.');s.accounts=s.accounts.filter(a=>a.owner!==owner);await save(s);return {ok:true,accounts:view(s,s.current)};}
  if(message.action==='switch'){
   const target=s.accounts.find(a=>a.owner===owner);if(!target)throw Error('That account is not saved.');if(target.expired)return {ok:false,expired:true,error:'Sign in to this account again.'};
   const from=String(message.from || s.current || '').toLowerCase();if(from!==owner && await unsavedSession(s,from))return {ok:false,error:UNSAVED};if(ownerOK(from) && from!==owner)await store(s,{owner:from});
   await apply(target.cookies);s.pending=owner;s.current=owner;await save(s);
   for(const tab of await redditTabs())chrome.tabs.reload(tab.id).catch?.(()=>{});
   return {ok:true};
  }
  if(message.action==='add'){
   if(ownerOK(owner) && redditPage(sender))await store(s,{owner,username:message.username,avatar:message.avatar});
   else if(ownerOK(s.current) && s.accounts.some(a=>a.owner===s.current))await store(s,{owner:s.current});
   if(await unsavedSession(s,ownerOK(owner) && redditPage(sender)?owner:s.current))return {ok:false,error:UNSAVED};
   const from=ownerOK(owner) && redditPage(sender)?owner:s.current;
   await clearSession(AUTH);s.current='';s.pending='';
   // Other tabs are not reloaded: simultaneous reloads raced the sign-in page for fresh cookies.
   const tab=redditPage(sender)?await chrome.tabs.update(sender.tab.id,{url:LOGIN}):await chrome.tabs.create({url:LOGIN});
   s.adding=ownerOK(from) && s.accounts.some(a=>a.owner===from)?{from,at:Date.now(),tab:Number.isInteger(tab?.id)?tab.id:null}:null;await save(s);
   return {ok:true};
  }
  throw Error('Unknown account action.');
 }
 chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message?.scope!=='rt-accounts')return;
  handle(message,sender).then(respond,error=>respond({ok:false,error:error.message || 'Accounts are unavailable.'}));return true;
 });
 // Closing the sign-in tab while still signed out also ends Add account.
 chrome.tabs?.onRemoved?.addListener(async tabId=>{try{const s=await state();if(!s.adding || s.adding.tab!==tabId)return;if((await snapshot()).some(c=>c.name==='reddit_session'))return;await restore(s);}catch{}});
 globalThis.RTAccountBroker=Object.freeze({handle,SESSION});
})();
