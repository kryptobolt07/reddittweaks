/* Early profile presentation only; independent of the discovery/model scripts. */
(() => {
  'use strict';
  if(window.top!==window || !globalThis.chrome?.runtime?.id)return;
  let enabled=true,restore=false,settingsKnown=false,revision=0,restoreRevision=0;const notices=new Map();
  const unavailableSelector='shreddit-app > div:has(> img[alt="Deleted user"]):has(> h3),shreddit-app > #shreddit-forbidden:has(svg[icon-name="ban-fill"]):has(#shreddit-forbidden-title)';
  function unavailableState(notice){
    if(notice.matches('shreddit-app > div:has(> img[alt="Deleted user"]):has(> h3)'))return 'deleted';
    return notice.matches('shreddit-app > #shreddit-forbidden:has(svg[icon-name="ban-fill"])') && /^This account (?:has been (?:banned|suspended)|is suspended)$/i.test(notice.querySelector('#shreddit-forbidden-title')?.textContent.trim())?'banned':'';
  }
  // This script runs at document_start, before post-model.js exists, so it keeps one small
  // copy of the notice wording (same patterns as RTPostModel.noticeStatus). Once post-model
  // has loaded into this same isolated world, its shared test is used instead.
  const noticePattern=/^(?:\[deleted\]|comment deleted by user|\[\s*deleted by user\s*\]|\[removed\]|comment removed by moderator|\[\s*removed by (?:moderator|reddit)\s*\])$/i;
  const isNotice=text=>globalThis.RTPostModel?.noticeStatus?Boolean(globalThis.RTPostModel.noticeStatus(text)):noticePattern.test(String(text || '').trim());
  // A comment's own notice is its first non-empty own body paragraph; a later "[removed]"
  // paragraph is user text.
  const ownNotice=comment=>{for(const p of comment.querySelectorAll('p')){if(p.closest('shreddit-comment')!==comment || p.closest('summary,[slot="actionRow"],[slot="commentMeta"],[data-rt-recovered-text]') || !p.textContent.trim())continue;return isNotice(p.textContent)?p:null;}return null;};
  // Mark a comment's own removal notice in the mutation microtask, before
  // paint and before the slower document_idle restorer or its 200ms scan.
  function prepareComments(doc,records){
    const candidates=new Set(),selector='main shreddit-comment[thingid]';
    if(Array.isArray(records)){for(const record of records){if(record.target.nodeType===1){const parent=record.target.closest(selector);if(parent)candidates.add(parent);}for(const node of record.addedNodes)if(node.nodeType===1){if(node.matches(selector))candidates.add(node);for(const comment of node.querySelectorAll(selector))candidates.add(comment);}}}else for(const comment of doc.querySelectorAll(selector))candidates.add(comment);
    const post=window.location.pathname.match(/\/comments\/([a-z0-9]{1,10})(?:\/|$)/i)?.[1]?.toLowerCase();
    for(const comment of candidates){if(comment.hasAttribute('data-rt-settled') || comment.getAttribute('postid') && comment.getAttribute('postid').toLowerCase()!=='t3_'+post)continue;
      const notice=ownNotice(comment);if(!notice)continue;
      notice.dataset.rtNotice='true';notice.dataset.rtHold='';comment.setAttribute('data-rt-pending','');
      if([...comment.querySelectorAll('[data-rt-skeleton]')].some(n=>n.closest('shreddit-comment')===comment))continue;
      const skeleton=doc.createElement('div');skeleton.className='rt-skeleton';skeleton.dataset.rtSkeleton='true';skeleton.setAttribute('aria-hidden','true');
      const reduced=doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      for(const width of [86,55]){const line=doc.createElement(reduced?'span':'faceplate-shimmer');line.className='rt-skeleton-line'+(reduced?' rt-skeleton-fallback':'');if(!reduced)line.setAttribute('shape','pill');line.style.width=width+'%';skeleton.append(line);}notice.after(skeleton);
    }
  }
  // A deleted comment's permalink carries Reddit's own toast, <faceplate-alert message="This comment no
  // longer exists">, which plays when Reddit's scripts start it. Hold it (it is parsed long before they
  // load) until the restorer answers: then show Reddit's toast with our wording, or the original.
  const permalinkComment=()=>(window.location || globalThis.location)?.pathname?.match(/^\/(?:r\/[^/]+\/|user\/[^/]+\/)?comments\/[a-z0-9]{1,10}\/(?:[^/]+\/)?comment\/([a-z0-9]{1,32})\/?$/i)?.[1]?.toLowerCase() || '';
  const heldAlert={node:null,anchor:null,timer:0,id:'',resolved:''};
  function releaseAlert(node){
    const {anchor}=heldAlert;heldAlert.resolved=heldAlert.id;clearTimeout(heldAlert.timer);heldAlert.node=null;heldAlert.anchor=null;heldAlert.timer=0;
    if(anchor?.isConnected)anchor.replaceWith(node);else anchor?.remove();
  }
  function holdAlert(doc){
    if(heldAlert.node)return;
    const id=permalinkComment();if(!id || heldAlert.resolved===id)return;
    const alert=[...doc.querySelectorAll('faceplate-alert[message]:not([data-rt-ui])')].find(node=>/no longer exists/i.test(node.getAttribute('message') || ''));if(!alert)return;
    const anchor=doc.createComment('rt-comment-alert');alert.replaceWith(anchor);
    heldAlert.node=alert;heldAlert.anchor=anchor;heldAlert.id=id;
    // Never lose Reddit's message: show it if no answer arrives in time.
    heldAlert.timer=setTimeout(()=>resolveCommentAlert(id,''),10000);
  }
  // status: 'deleted' or 'removed' once the archive filled in this comment; '' to show Reddit's own toast.
  function resolveCommentAlert(id,status){
    if(!heldAlert.node || heldAlert.id!==String(id || '').toLowerCase().replace(/^t1_/,''))return false;
    const original=heldAlert.node;
    if(status!=='deleted' && status!=='removed'){releaseAlert(original);return true;}
    const alert=original.cloneNode(false);alert.dataset.rtUi='comment-alert';
    alert.setAttribute('message',(status==='removed'?'Removed':'Deleted')+' comment retrieved from Arctic Shift');releaseAlert(alert);return true;
  }
  function setRestoreEnabled(value){restoreRevision++;restore=value===true;refresh();if(!restore && heldAlert.node)releaseAlert(heldAlert.node);}
  // A banned/private community's notice is held from document_start when the archive view is requested by
  // URL (rt_view=archive), so Reddit's modal never flashes before the subreddit archive mounts over it.
  // subreddit-archive.js owns the modal afterwards; this only releases it if that never happens.
  let archiveOn=true,holdExpired=false,holdTimer=0;
  const holdAttr='data-rt-subreddit-hold',mountedAttr='data-rt-subreddit-mounted',modalWording=/\bis (?:banned|private)\.?$/i;
  function releaseModal(modal){if(modal.hasAttribute(mountedAttr))return;modal.removeAttribute(holdAttr);modal.style.removeProperty('display');}
  function holdModals(doc,loc){
    const held=[...doc.querySelectorAll('guard-community-modal['+holdAttr+']')];
    const wanted=enabled && archiveOn && !holdExpired && /^\/r\/[^/]+\/?$/i.test(loc?.pathname || '') && new URLSearchParams(loc?.search || '').get('rt_view')==='archive';
    if(!wanted){for(const modal of held)releaseModal(modal);return;}
    for(const modal of doc.querySelectorAll('guard-community-modal[subredditname]')){
      // The title may not have been parsed yet: hold first, and let go once it names another state (e.g. quarantine).
      const title=modal.querySelector('[slot="title"]')?.textContent.replace(/\s+/g,' ').trim() || '';
      if(title && !modalWording.test(title)){if(modal.hasAttribute(holdAttr))releaseModal(modal);continue;}
      if(!modal.hasAttribute(holdAttr)){modal.setAttribute(holdAttr,'true');modal.style.setProperty('display','none','important');}
    }
    if(!holdTimer)holdTimer=setTimeout(()=>{holdExpired=true;refresh([]);},10000);
  }
  function refresh(records){
    const doc=globalThis.document || window.document;if(!doc)return;
    const loc=window.location || globalThis.location;
    holdModals(doc,loc);
    const profile=/^\/user\/[\w-]{1,20}(?:\/(?:submitted|comments))?\/?$/i.test(loc?.pathname || '');
    // Post pages: let CSS show a skeleton over removal titles until restoration settles.
    const restoreHere=restore && /^\/(?:r\/[^/]+\/|user\/[^/]+\/)?comments\/[a-z0-9]{1,10}(?:\/|$)/i.test(loc?.pathname || '');
    // Held before settings arrive (the toast must not play first); released if restoring turns out to be off.
    if(enabled && (restore || !settingsKnown))holdAlert(doc);doc.documentElement?.toggleAttribute('data-rt-restore',restoreHere);if(restoreHere)prepareComments(doc,records);
    // Notifications and other native overlays can change the URL before replacing
    // the underlying profile. Never restore its notice during that transition.
    for(const [notice,anchor] of notices)if(!anchor.isConnected){
      // Reddit may retain this detached native view for Back navigation. Put its
      // notice back into that off-document view before releasing our anchor.
      if(anchor.parentNode)anchor.replaceWith(notice);notices.delete(notice);
    }
    const underlying=doc.querySelector('#profile-feed-tabgroup,[data-rt-ui="archive-profile"]'),active=enabled && Boolean(profile || underlying || notices.size);
    doc.documentElement?.toggleAttribute('data-rt-profile-discovery',active);
    // Comments tab: Reddit's sort button is swapped for our Feed options menu; keep it from flashing first.
    doc.documentElement?.toggleAttribute('data-rt-profile-comments',active && /^\/user\/[\w-]{1,20}\/comments\/?$/i.test(loc?.pathname || ''));
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
  let settings;try{settings=chrome.runtime.sendMessage({scope:'rt-posts',action:'get-settings'});}catch(error){settings=Promise.reject(error);}settings.catch(()=>{});
  globalThis.RTProfileNoticeGuard=Object.freeze({refresh,setEnabled,setRestoreEnabled,unavailableNotice,emptyTemplate,settings,resolveCommentAlert,permalinkComment});
  // Observe the Document: the root may not exist yet at document_start.
  const observer=new MutationObserver(refresh);observer.observe(document,{childList:true,subtree:true});
  window.addEventListener('popstate',refresh);document.addEventListener('reddit:route',refresh);
  refresh();
  const initialRevision=revision,initialRestoreRevision=restoreRevision;
  const failed=()=>{if(revision===initialRevision)setEnabled(false);};
  try{settings.then(response=>{
    const s=response?.settings;if(restoreRevision===initialRestoreRevision)restore=response?.ok===true && s?.postDiscovery!==false && s?.archiveDiscovery===true && s?.restoreDeletedContent!==false;
    archiveOn=response?.ok===true && s?.postDiscovery!==false && s?.archiveDiscovery===true;
    settingsKnown=true;if(!restore && heldAlert.node)releaseAlert(heldAlert.node);
    if(revision===initialRevision)setEnabled(response?.ok===true && response.settings?.postDiscovery!==false);else refresh([]);if(restore)refresh();
  },()=>{settingsKnown=true;if(heldAlert.node)releaseAlert(heldAlert.node);failed();});}catch{settingsKnown=true;failed();}
})();
