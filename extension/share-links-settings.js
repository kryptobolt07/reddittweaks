/* Preferences arrive through the trusted worker; no clipboard contents are read or sent to the extension. */
(() => {
  'use strict';
  if(window.top!==window || (!globalThis.chrome?.runtime?.id && !globalThis.RTCore?.settings))return;
  let revision=0,current=false,stopTl=false;
  const publish=()=>{
    document.dispatchEvent(new CustomEvent('rt-clean-share-settings',{detail:current}));
    document.dispatchEvent(new CustomEvent('rt-stop-tl-settings',{detail:stopTl}));
  };
  const apply=settings=>{
    current=settings?.cleanShareLinks===true;
    stopTl=settings?.stopAutoTranslation===true;
    publish();
  };
  document.addEventListener('rt-clean-share-ready',publish);
  document.addEventListener('rt-stop-tl-ready',publish);
  if(globalThis.RTCore?.settings){
    globalThis.RTCore.settings.subscribe(settings=>apply(settings));
    return;
  }
  chrome.runtime.onMessage?.addListener(message=>{if(message?.scope==='rt-posts' && message.action==='settings-changed'){revision++;apply(message.settings);}});
  const initial=revision;
  try{Promise.resolve(globalThis.RTProfileNoticeGuard?.settings || chrome.runtime.sendMessage({scope:'rt-posts',action:'get-settings'})).then(response=>{if(revision===initial)apply(response?.ok?response.settings:null);},()=>{if(revision===initial)apply(null);});}catch{apply(null);}
})();
