/* Viewed-posts History messages (docs/viewed-history-spec.md). Only this extension's top-level Reddit pages may record
   or load, and only for the account signed in to that tab (verified by the removal broker's native check). */
(() => {
 'use strict';
 if(globalThis.RTViewedBroker)return;
 const store=globalThis.RTViewedStore.create({indexedDB:globalThis.indexedDB}),key='rt-settings-v1';
 const reddit=sender=>{try{const u=new URL(sender.url);return (sender.frameId==null || sender.frameId===0) && Number.isInteger(sender.tab?.id) && u.protocol==='https:' && !u.port && ['reddit.com','www.reddit.com','new.reddit.com','sh.reddit.com'].includes(u.hostname);}catch{return false;}};
 const limitOf=async()=>{const settings=globalThis.RTPostModel.normalizeSettings((await chrome.storage.local.get(key))?.[key]);return settings.postDiscovery?settings.historyLimit:20;};
 async function handle(message,sender){
  if(sender?.id!==chrome.runtime.id)throw Error('Invalid extension sender.');
  if(!['record','seed','load'].includes(message.action))throw Error('Unknown History action.');
  // Recording comes from a top-level Reddit page, keyed by the logged-in account ID the page carries (post pages have no
  // username). Reading the list needs the account verified in that tab, as Removed does.
  if(message.action==='record'){
   if(!reddit(sender) || !/^t2_[a-z0-9]{1,13}$/i.test(message.owner || ''))throw Error('History can only be recorded from Reddit.');
   const limit=await limitOf();if(limit===20)return {ok:true,recorded:false};
   return {ok:true,recorded:await store.record({owner:message.owner,item:message.item,limit})};
  }
  const me=await globalThis.RTRemovalBroker?.verify(sender,message.username);
  if(!me || me.owner!==message.owner)throw Error('The signed-in account changed.');
  const limit=await limitOf();if(limit===20)return message.action==='seed'?{ok:true,recorded:false}:{ok:true,items:[],limit};
  if(message.action==='seed'){if(!Array.isArray(message.items) || message.items.length>100)throw Error('Invalid recent History.');return {ok:true,recorded:Boolean(await store.seed({owner:me.owner,items:message.items,limit}))};}
  return {ok:true,items:await store.load({owner:me.owner,limit}),limit};
 }
 chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message?.scope!=='rt-viewed')return;
  handle(message,sender).then(respond,error=>respond({ok:false,error:error.message || 'History is unavailable.'}));return true;
 });
 // Reddit's 20 means nothing is kept: recorded views are deleted. A lower limit trims the stored views.
 chrome.storage.onChanged?.addListener(async(changes,area)=>{
  if(area!=='local' || !changes[key])return;const limit=globalThis.RTPostModel.normalizeSettings(changes[key].newValue).historyLimit;
  try{if(limit===20)await store.clear();else if(limit>0)await store.trimAll(limit);}catch{}
 });
 globalThis.RTViewedBroker=Object.freeze({handle});
})();
