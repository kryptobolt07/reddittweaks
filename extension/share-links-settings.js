/* Preferences arrive through the trusted worker; no clipboard contents are read or sent to the extension. */
(() => {
  'use strict';
  if(window.top!==window || !globalThis.chrome?.runtime?.id)return;
  let revision=0,current=false;
  const publish=()=>document.dispatchEvent(new CustomEvent('rt-clean-share-settings',{detail:current}));
  const apply=settings=>{current=settings?.cleanShareLinks===true;publish();};
  document.addEventListener('rt-clean-share-ready',publish);
  chrome.runtime.onMessage?.addListener(message=>{if(message?.scope==='rt-posts' && message.action==='settings-changed'){revision++;apply(message.settings);}});
  const initial=revision;
  try{Promise.resolve(globalThis.RTProfileNoticeGuard?.settings || chrome.runtime.sendMessage({scope:'rt-posts',action:'get-settings'})).then(response=>{if(revision===initial)apply(response?.ok?response.settings:null);},()=>{if(revision===initial)apply(null);});}catch{apply(null);}
})();
