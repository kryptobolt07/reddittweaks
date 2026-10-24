/* Early profile presentation only; independent of the discovery/model scripts. */
(() => {
  'use strict';
  if(window.top!==window || !globalThis.chrome?.runtime?.id)return;
  let enabled=true,revision=0;const notices=new Map();
  function refresh(records){
    const profile=/^\/user\/[\w-]{1,20}(?:\/(?:submitted|comments))?\/?$/i.test(location.pathname),post=/^\/(?:(?:r|user)\/[^/]+\/)?comments\//i.test(location.pathname);
    // A native post modal changes the URL while the profile remains underneath.
    const underlying=post && document.querySelector('#profile-feed-tabgroup,[data-rt-ui="archive-profile"]'),active=enabled && Boolean(profile || underlying);
    document.documentElement?.toggleAttribute('data-rt-profile-discovery',active);
    for(const [notice,anchor] of notices){if(!anchor.isConnected){notices.delete(notice);continue;}if(!active){anchor.replaceWith(notice);notices.delete(notice);}}
    if(!active)return;
    const selector='main #empty-feed-content:has(img[src*="/shreddit/assets/snoo_wave."]),shreddit-app > div:has(> img[alt="Deleted user"]):has(> h3)',candidates=new Set();
    if(Array.isArray(records)){for(const record of records){if(record.target.nodeType===1 && record.target.matches(selector))candidates.add(record.target);for(const node of record.addedNodes)if(node.nodeType===1){if(node.matches(selector))candidates.add(node);for(const notice of node.querySelectorAll(selector))candidates.add(notice);}}}else for(const notice of document.querySelectorAll(selector))candidates.add(notice);
    for(const notice of candidates){if(!notice.isConnected)continue;
      const anchor=document.createComment('rt-profile-notice');notice.replaceWith(anchor);notices.set(notice,anchor);
    }
  }
  function deletedNotice(){for(const [notice,anchor] of notices)if(anchor.isConnected && notice.querySelector('img[alt="Deleted user"]'))return {notice,anchor};return null;}
  function setEnabled(value){revision++;const next=value===true,changed=next!==enabled;enabled=next;refresh(changed?undefined:[]);}
  globalThis.RTProfileNoticeGuard=Object.freeze({refresh,setEnabled,deletedNotice});
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
