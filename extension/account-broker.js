/* Account switcher (docs/account-switcher-spec.md). Each saved Reddit account keeps a snapshot of its five session
   cookies here in the worker; pages and the popup only ever receive names, avatars and states. By the user's explicit
   choice this stores Reddit sessions on this device (recorded as an exception in AGENTS.md).
   Private (incognito) windows have their own cookie store: everything acts on the store of the tab or window that asked,
   and accounts first saved in a private window live in session storage only (gone when the browser closes). */
(() => {
 'use strict';
 if(globalThis.RTAccountBroker)return;
 const KEY='rt-accounts-v1',LOGIN='https://www.reddit.com/login/',MAX=20;
 // Measured 2026-11-17: the signed-in session lives in these cookies; everything else is device or analytics state.
 const SESSION=['reddit_session','token_v2','loid','csrf_token','session_tracker'];
 const ownerOK=value=>/^t2_[a-z0-9]{1,13}$/i.test(value || ''),nameOK=value=>/^[\w-]{1,20}$/.test(value || '');
 const avatarOf=value=>{const url=globalThis.RTPostModel?.avatarUrl?.(value) || '';return url.length<=2048?url:'';};
 const redditPage=sender=>{try{const u=new URL(sender.url);return (sender.frameId==null || sender.frameId===0) && Number.isInteger(sender.tab?.id) && u.protocol==='https:' && !u.port && ['reddit.com','www.reddit.com','new.reddit.com','sh.reddit.com'].includes(u.hostname);}catch{return false;}};
 // The popup: a panel on desktop, a tab on phones (Firefox for Android, Kiwi). Its extension URL identifies it either way.
 const popupPage=sender=>{try{const u=new URL(sender.url),own=new URL(chrome.runtime.getURL('popup.html'));return u.origin===own.origin && u.pathname===own.pathname;}catch{return false;}};

 // ---- Cookie store of the asking tab or window: {id (undefined = the browser's default), private, windowId}. ----
 async function jarOf(sender){
  // On phones the popup is a tab of its own: act on the store of the tab it was opened from.
  if(sender?.tab && popupPage(sender) && Number.isInteger(sender.tab.openerTabId)){
   try{const opener=await chrome.tabs.get(sender.tab.openerTabId);if(opener)return jarOf({tab:opener});}catch{}
  }
  if(sender?.tab){
   const tab=sender.tab,priv=tab.incognito===true;
   if(typeof tab.cookieStoreId==='string')return {id:tab.cookieStoreId,private:priv,windowId:tab.windowId};
   return {id:priv?await storeOfTab(tab.id):undefined,private:priv,windowId:tab.windowId};
  }
  // The popup: the window it was opened from.
  let win=null;try{win=await chrome.windows?.getLastFocused?.({populate:true});}catch{}
  if(!win?.incognito)return {id:undefined,private:false,windowId:win?.id};
  const tab=(win.tabs || []).find(t=>t.active) || (win.tabs || [])[0];
  return {id:typeof tab?.cookieStoreId==='string'?tab.cookieStoreId:await storeOfTab(tab?.id),private:true,windowId:win.id};
 }
 async function storeOfTab(tabId){try{const stores=await chrome.cookies.getAllCookieStores?.();return stores?.find(s=>s.tabIds?.includes(tabId))?.id;}catch{return undefined;}}
 const scoped=(jar,details)=>jar?.id==null?details:{...details,storeId:jar.id};

 // ---- State: one record for normal windows (local storage), one per private cookie store (session storage). ----
 const area=jar=>jar?.private && chrome.storage.session?{store:chrome.storage.session,key:KEY+':'+(jar.id ?? 'private')}:{store:chrome.storage.local,key:KEY};
 const clean=value=>({accounts:Array.isArray(value?.accounts)?value.accounts.filter(a=>ownerOK(a?.owner)):[],current:ownerOK(value?.current)?value.current:'',pending:ownerOK(value?.pending)?value.pending:'',anonymous:value?.anonymous===true,adding:ownerOK(value?.adding?.from)?{from:value.adding.from,at:Number(value.adding.at) || 0,tab:Number.isInteger(value.adding.tab)?value.adding.tab:null}:null});
 async function state(jar){
  const {store,key}=area(jar),s=clean((await store.get(key))?.[key]);s.jar=jar;
  // A private window can also switch to accounts saved in normal windows (read-only there: never overwritten).
  s.shared=jar?.private?clean((await chrome.storage.local.get(KEY))?.[KEY]).accounts:[];
  return s;
 }
 const save=s=>{const {store,key}=area(s.jar),{jar,shared,...value}=s;return store.set({[key]:value});};
 const known=(s,owner)=>s.accounts.find(a=>a.owner===owner) || s.shared.find(a=>a.owner===owner);

 async function snapshot(jar){
  const all=await chrome.cookies.getAll(scoped(jar,{domain:'reddit.com'}));
  return all.filter(c=>SESSION.includes(c.name)).map(c=>({name:c.name,value:c.value,domain:c.domain,path:c.path || '/',secure:c.secure,httpOnly:c.httpOnly,sameSite:c.sameSite,hostOnly:c.hostOnly,session:c.session,expirationDate:c.expirationDate}));
 }
 const cookieUrl=c=>'https://'+String(c.domain || 'reddit.com').replace(/^\./,'')+(c.path || '/');
 // Signing out locally removes only the sign-in cookies: Reddit's sign-in form needs the device's csrf_token and loid.
 const AUTH=['reddit_session','token_v2'];
 async function clearSession(jar,names=SESSION){for(const c of await chrome.cookies.getAll(scoped(jar,{domain:'reddit.com'})))if(names.includes(c.name))await chrome.cookies.remove(scoped(jar,{url:cookieUrl(c),name:c.name}));}
 async function apply(jar,cookies){
  await clearSession(jar);
  for(const c of cookies){const details={url:cookieUrl(c),name:c.name,value:c.value,path:c.path || '/',secure:c.secure!==false,httpOnly:Boolean(c.httpOnly)};if(['lax','strict','no_restriction'].includes(c.sameSite))details.sameSite=c.sameSite;if(!c.hostOnly)details.domain=c.domain;if(!c.session && Number.isFinite(c.expirationDate))details.expirationDate=c.expirationDate;await chrome.cookies.set(scoped(jar,details));}
 }
 const signedIn=async jar=>(await snapshot(jar)).some(c=>c.name==='reddit_session');
 // Saving (or refreshing) the account this cookie store is signed into now.
 async function store(s,{owner,username,avatar}){
  const cookies=await snapshot(s.jar);if(!cookies.some(c=>c.name==='reddit_session'))return false;
  const now=Date.now(),existing=s.accounts.find(a=>a.owner===owner),shared=s.shared.find(a=>a.owner===owner);
  if(existing){existing.cookies=cookies;existing.savedAt=now;existing.expired=false;if(nameOK(username))existing.username=username;if(avatar)existing.avatar=avatarOf(avatar) || existing.avatar;}
  else{const name=nameOK(username)?username:shared?.username;if(!nameOK(name))return false;s.accounts.push({owner,username:name,avatar:avatarOf(avatar) || shared?.avatar || '',savedAt:now,expired:false,cookies});if(s.accounts.length>MAX)s.accounts.shift();}
  return true;
 }
 // A signed-in session the switcher has not saved would be lost by clearing or replacing cookies.
 async function unsavedSession(s,owner){return await signedIn(s.jar) && !(ownerOK(owner) && known(s,owner));}
 const UNSAVED='Reddit hasn’t reported the account you’re signed in to yet. Reload a Reddit tab, then try again.';
 // Asks the Reddit tabs of this cookie store to report who is signed in (they answer through 'remember' and
 // 'save-current', queued after the current action), so the popup can retry instead of failing.
 async function askToReport(jar){for(const tab of await redditTabs(jar))chrome.tabs.sendMessage?.(tab.id,{scope:'rt-accounts',action:'report'})?.catch?.(()=>{});}
 const unsaved=jar=>{askToReport(jar).catch(()=>{});return {ok:false,error:UNSAVED,unsaved:true};};
 const view=(s,current)=>{
  const own=s.accounts.map(a=>({...a,private:Boolean(s.jar?.private)})),rest=s.shared.filter(a=>!s.accounts.some(b=>b.owner===a.owner)).map(a=>({...a,private:false}));
  return [...own,...rest].map(a=>({owner:a.owner,username:a.username,avatar:a.avatar || '',savedAt:a.savedAt,expired:a.expired===true,current:a.owner===current,private:a.private}));
 };
 // Reddit's sign-in and sign-up pages: a signed-out report from these means sign-in is still in progress.
 const authPage=url=>{try{return /^\/(login|register|account|password|verification|onboarding)(\/|$)/i.test(new URL(url).pathname);}catch{return false;}};
 // Reddit tabs that share the asking cookie store (a private window's tabs never reload for a normal window's switch).
 async function redditTabs(jar){
  const tabs=(await chrome.tabs.query({url:['https://*.reddit.com/*','https://reddit.com/*']})).filter(t=>Number.isInteger(t.id));
  if(tabs.some(t=>typeof t.cookieStoreId==='string'))return tabs.filter(t=>t.cookieStoreId===(jar?.id ?? 'firefox-default'));
  return tabs.filter(t=>Boolean(t.incognito)===Boolean(jar?.private));
 }
 const reloadAll=async jar=>{for(const tab of await redditTabs(jar))chrome.tabs.reload(tab.id).catch?.(()=>{});};
 // Add account did not end in a sign-in: put the account you came from back, and show it in every Reddit tab.
 async function restore(s){const from=known(s,s.adding?.from);s.adding=null;if(!from){await save(s);return false;}await apply(s.jar,from.cookies);s.current=from.owner;s.pending='';await save(s);await reloadAll(s.jar);return true;}

 async function handle(message,sender){
  if(sender?.id!==chrome.runtime.id || !(redditPage(sender) || popupPage(sender)))throw Error('Accounts can only be managed from Reddit or this extension.');
  const jar=await jarOf(sender),s=await state(jar),owner=String(message.owner || '').toLowerCase();
  if(message.action==='list'){const current=s.anonymous?'':redditPage(sender)?(ownerOK(owner)?owner:''):s.current;return {ok:true,accounts:view(s,current),current,anonymous:s.anonymous,private:Boolean(jar.private)};}
  if(message.action==='remember'){
   // A page reports who is signed in now. A switch that did not land on its target means that session expired.
   let now=ownerOK(owner)?owner:'';if(s.anonymous && now){if(await signedIn(jar))s.anonymous=false;else now='';}
   if(s.pending && s.pending!==now){const target=s.accounts.find(a=>a.owner===s.pending);if(target)target.expired=true;}
   s.pending='';
   const fromSignIn=s.adding && (s.adding.tab==null || sender.tab?.id===s.adding.tab || Date.now()-s.adding.at>600000);
   if(fromSignIn && !now && !authPage(sender.url) && redditPage(sender))return {ok:true,restored:await restore(s)};
   s.current=now;const saved=Boolean(now && s.accounts.some(a=>a.owner===now));if(saved)await store(s,{owner:now,username:message.username,avatar:message.avatar});
   if(now)s.adding=null;
   // Any signed-in account not saved yet is saved now: the page reads its own name from Reddit and sends it back.
   await save(s);return {ok:true,save:Boolean(now) && !known(s,now),current:s.current,anonymous:s.anonymous};
  }
  if(message.action==='save-current'){if(!redditPage(sender) || !ownerOK(owner))throw Error('Open Reddit signed in to save this account.');if(!await store(s,{owner,username:message.username,avatar:message.avatar}))throw Error('Reddit’s session was not found.');s.current=owner;s.anonymous=false;await save(s);return {ok:true,accounts:view(s,owner),current:owner,anonymous:false};}
  if(message.action==='update-avatar'){
   const avatar=avatarOf(message.avatar);
   if(!redditPage(sender) || s.anonymous || s.current!==owner || !avatar || !known(s,owner))return {ok:false};
   const account=s.accounts.find(a=>a.owner===owner);
   if(account && account.avatar!==avatar){account.avatar=avatar;await save(s);}
   return {ok:true};
  }
  if(message.action==='remove'){
   if(!ownerOK(owner))throw Error('Unknown account.');s.accounts=s.accounts.filter(a=>a.owner!==owner);await save(s);
   // From a private window, an account saved in normal windows is forgotten there too.
   if(jar.private){const normal=await state({id:undefined,private:false});normal.accounts=normal.accounts.filter(a=>a.owner!==owner);await save(normal);s.shared=normal.accounts;}
   return {ok:true,accounts:view(s,s.current)};
  }
  if(message.action==='anonymous'){
   const from=String(message.from || s.current || '').toLowerCase();
   if(ownerOK(from) && redditPage(sender))await store(s,{owner:from,username:message.username,avatar:message.avatar});
   if(await unsavedSession(s,from))return unsaved(jar);
   const before=await snapshot(jar);
   try{await clearSession(jar,AUTH);s.current='';s.pending='';s.adding=null;s.anonymous=true;await save(s);}catch(error){try{await apply(jar,before);}catch{}throw error;}
   await reloadAll(jar);
   return {ok:true,current:'',anonymous:true};
  }
  if(message.action==='switch'){
   const target=known(s,owner);if(!target)throw Error('That account is not saved.');if(target.expired)return {ok:false,expired:true,error:'Sign in to this account again.'};
   const from=String(message.from || s.current || '').toLowerCase();if(from!==owner && await unsavedSession(s,from))return unsaved(jar);
   if(ownerOK(from) && from!==owner && s.accounts.some(a=>a.owner===from))await store(s,{owner:from});
   await apply(jar,target.cookies);s.pending=owner;s.current=owner;s.anonymous=false;s.adding=null;await save(s);
   await reloadAll(jar);
   return {ok:true};
  }
  if(message.action==='add'){
   const here=ownerOK(owner) && redditPage(sender)?owner:s.current;
   if(ownerOK(owner) && redditPage(sender))await store(s,{owner,username:message.username,avatar:message.avatar});
   else if(ownerOK(s.current) && s.accounts.some(a=>a.owner===s.current))await store(s,{owner:s.current});
   if(await unsavedSession(s,here))return unsaved(jar);
   const from=s.anonymous?'':here;
   await clearSession(jar,AUTH);s.current='';s.pending='';
   // Other tabs are not reloaded: simultaneous reloads raced the sign-in page for fresh cookies.
   const tab=redditPage(sender)?await chrome.tabs.update(sender.tab.id,{url:LOGIN}):await chrome.tabs.create(Number.isInteger(jar.windowId)?{url:LOGIN,windowId:jar.windowId}:{url:LOGIN});
   s.adding=ownerOK(from) && known(s,from)?{from,at:Date.now(),tab:Number.isInteger(tab?.id)?tab.id:null}:null;await save(s);
   return {ok:true};
  }
  throw Error('Unknown account action.');
 }
 let queue=Promise.resolve();
 const serial=work=>{const next=queue.then(work);queue=next.catch(()=>{});return next;};
 chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message?.scope!=='rt-accounts')return;
  serial(()=>handle(message,sender)).then(respond,error=>respond({ok:false,error:error.message || 'Accounts are unavailable.'}));return true;
 });
 // Closing the sign-in tab while still signed out also ends Add account (normal windows and each private store).
 chrome.tabs?.onRemoved?.addListener(tabId=>serial(async()=>{try{
  const jars=[{id:undefined,private:false}];
  if(chrome.storage.session)for(const key of Object.keys(await chrome.storage.session.get(null) || {}))if(key.startsWith(KEY+':')){const id=key.slice(KEY.length+1);jars.push({id:id==='private'?undefined:id,private:true});}
  for(const jar of jars){const s=await state(jar);if(!s.adding || s.adding.tab!==tabId)continue;if(await signedIn(jar))continue;await restore(s);}
 }catch{}}));
 globalThis.RTAccountBroker=Object.freeze({handle,SESSION});
})();
