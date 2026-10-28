/* Early profile presentation only; independent of the discovery/model scripts. */
(() => {
  'use strict';
  if(window.top!==window || !globalThis.chrome?.runtime?.id)return;
  let enabled=true,restore=false,revision=0;const notices=new Map();
  const unavailableSelector='shreddit-app > div:has(> img[alt="Deleted user"]):has(> h3),shreddit-app > #shreddit-forbidden:has(svg[icon-name="ban-fill"]):has(#shreddit-forbidden-title)';
  function unavailableState(notice){
    if(notice.matches('shreddit-app > div:has(> img[alt="Deleted user"]):has(> h3)'))return 'deleted';
    return notice.matches('shreddit-app > #shreddit-forbidden:has(svg[icon-name="ban-fill"])') && /^This account (?:has been (?:banned|suspended)|is suspended)$/i.test(notice.querySelector('#shreddit-forbidden-title')?.textContent.trim())?'banned':'';
  }
  function refresh(records){
    const doc=globalThis.document || window.document;if(!doc)return;
    const loc=window.location || globalThis.location;
    const profile=/^\/user\/[\w-]{1,20}(?:\/(?:submitted|comments))?\/?$/i.test(loc?.pathname || '');
    // Post pages: let CSS show a skeleton over removal titles until restoration settles.
    doc.documentElement?.toggleAttribute('data-rt-restore',restore && /^\/(?:r\/[^/]+\/|user\/[^/]+\/)?comments\/[a-z0-9]{1,10}(?:\/|$)/i.test(loc?.pathname || ''));
    // Notifications and other native overlays can change the URL before replacing
    // the underlying profile. Never restore its notice during that transition.
    for(const [notice,anchor] of notices)if(!anchor.isConnected){
      // Reddit may retain this detached native view for Back navigation. Put its
      // notice back into that off-document view before releasing our anchor.
      if(anchor.parentNode)anchor.replaceWith(notice);notices.delete(notice);
    }
    const underlying=doc.querySelector('#profile-feed-tabgroup,[data-rt-ui="archive-profile"]'),active=enabled && Boolean(profile || underlying || notices.size);
    doc.documentElement?.toggleAttribute('data-rt-profile-discovery',active);
    for(const [notice,anchor] of notices){if(!anchor.isConnected){notices.delete(notice);continue;}if(!active){anchor.replaceWith(notice);notices.delete(notice);}}
    if(!active)return;
    const selector='main #empty-feed-content:has(img[src*="/shreddit/assets/snoo_wave."]),'+unavailableSelector,candidates=new Set();
    if(Array.isArray(records)){for(const record of records){if(record.target.nodeType===1){const parent=record.target.closest(selector);if(parent)candidates.add(parent);}for(const node of record.addedNodes)if(node.nodeType===1){if(node.matches(selector))candidates.add(node);for(const notice of node.querySelectorAll(selector))candidates.add(notice);}}}else for(const notice of doc.querySelectorAll(selector))candidates.add(notice);
    for(const notice of candidates){if(!notice.isConnected || notice.id==='shreddit-forbidden' && !unavailableState(notice))continue;
      const anchor=doc.createComment('rt-profile-notice');notice.replaceWith(anchor);notices.set(notice,anchor);
    }
  }
  function unavailableNotice(){for(const [notice,anchor] of notices)if(anchor.isConnected){const state=notice.querySelector('img[alt="Deleted user"]')?'deleted':notice.id==='shreddit-forbidden'?'banned':'';if(state)return {notice,anchor,state};}return null;}
  function setEnabled(value){revision++;const next=value===true,changed=next!==enabled;enabled=next;refresh(changed?undefined:[]);}
  const emptyTemplate=()=>[...notices.keys()].find(n=>n.id==='empty-feed-content' && n.querySelector('[data-testid="empty-state-creative"]'))?.cloneNode(true) || null;
  globalThis.RTProfileNoticeGuard=Object.freeze({refresh,setEnabled,unavailableNotice,emptyTemplate});
  // Observe the Document: the root may not exist yet at document_start.
  const observer=new MutationObserver(refresh);observer.observe(document,{childList:true,subtree:true});
  window.addEventListener('popstate',refresh);document.addEventListener('reddit:route',refresh);
  refresh();
  const initialRevision=revision;
  const failed=()=>{if(revision===initialRevision)setEnabled(false);};
  try{chrome.runtime.sendMessage({scope:'rt-posts',action:'get-settings'}).then(response=>{
    const s=response?.settings;restore=response?.ok===true && s?.postDiscovery!==false && s?.archiveDiscovery===true && s?.restoreDeletedContent!==false;
    if(revision===initialRevision)setEnabled(response?.ok===true && response.settings?.postDiscovery!==false);else refresh([]);
  },failed);}catch{failed();}
})();
