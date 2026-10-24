/* Early profile presentation only; independent of the discovery/model scripts. */
(() => {
  'use strict';
  if(window.top!==window || !globalThis.chrome?.runtime?.id)return;
  let enabled=true,revision=0;
  function refresh(){
    const profile=/^\/user\/[\w-]{1,20}(?:\/(?:submitted|comments))?\/?$/i.test(location.pathname);
    document.documentElement?.toggleAttribute('data-rt-profile-discovery',enabled && profile);
  }
  function setEnabled(value){revision++;enabled=value===true;refresh();}
  globalThis.RTProfileNoticeGuard=Object.freeze({refresh,setEnabled});
  // Observe the Document: the root may not exist yet at document_start.
  const observer=new MutationObserver(refresh);observer.observe(document,{childList:true,subtree:true});
  window.addEventListener('popstate',refresh);document.addEventListener('reddit:route',refresh);
  refresh();
  const initialRevision=revision;
  const failed=()=>{if(revision===initialRevision)setEnabled(false);};
  try{chrome.runtime.sendMessage({scope:'rt-posts',action:'get-settings'}).then(response=>{
    if(revision===initialRevision)setEnabled(response?.ok===true && response.settings?.postDiscovery!==false);
  },failed);}catch{failed();}
})();
