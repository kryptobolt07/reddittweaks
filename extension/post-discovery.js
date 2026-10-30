/* Inline public-post discovery. Does not change Reddit's posts or chat client. */
(() => {
  'use strict';
  const M=globalThis.RTPostModel;if(!M)return;
  const key='rt-settings-v1';
  const profileBatchSize=25;
  // Bounded waits keep the combined feed in date order without letting a slow
  // source stall it. Native continuation cards wait at most nativeWaitMs for
  // discovery coverage; a discovery source that has not answered within
  // sourceWaitMs stops holding back the other sources' publication.
  const nativeWaitMs=1200,sourceWaitMs=2500;
  // Reddit often refuses logged-out search (HTTP 403). That stream is only a
  // supplement, so pause it quietly and say results may be incomplete.
  // Rate limits, timeouts and gateway failures retry on their own with
  // backoff before a source is reported as failed.
  const retryLimit=5;
  const publicBlockMs=600000,publicBlockedNote='Some comments may be missing · Reddit is blocking logged-out search';
  function pageRoute(path=location.pathname,search=location.search){
    const profile=path.match(/^\/user\/([\w-]{1,20})(?:\/(submitted|comments))?\/?$/i);
    if(profile){const view=profile[2]==='submitted'?'posts':profile[2]==='comments'?'comments':'overview',params=new URLSearchParams(search);
      const sort=['new','hot','top'].includes(params.get('sort'))?params.get('sort'):'new',range=sort==='top' && ['hour','day','week','month','year','all'].includes(params.get('t'))?params.get('t'):'all',layout=['cardView','compactView'].includes(params.get('feedViewType'))?params.get('feedViewType'):'';
      return {kind:'profile',view,username:profile[1],sort,range,key:'profile:'+profile[1].toLowerCase()+':'+view+':'+sort+':'+range+':'+layout};}
    const detail=path.match(/^\/(?:r\/[^/]+\/|user\/[^/]+\/)?comments\/([a-z0-9]{1,10})(?:\/.*)?$/i);
    return detail?{kind:'post',id:detail[1].toLowerCase(),key:'post:'+detail[1].toLowerCase()}:null;
  }
  function redditRead(parameters,signal){
    const channel=crypto.randomUUID(),id=crypto.randomUUID();let timer;
    return new Promise((resolve,reject)=>{
      const finish=(error,result)=>{clearTimeout(timer);document.removeEventListener('rt-post-response',receive);signal?.removeEventListener('abort',cancel);error?reject(error):resolve(result);};
      const cancel=()=>{document.dispatchEvent(new CustomEvent('rt-post-request',{detail:JSON.stringify({channel,id,action:'cancel'})}));finish(Error('Post request cancelled.'));};
      const receive=event=>{let response;try{response=JSON.parse(event.detail);}catch{return;}if(response.channel!==channel || response.id!==id)return;finish(response.ok?null:Error(response.error || 'Public posts could not be loaded.'),response);};
      document.addEventListener('rt-post-response',receive);signal?.addEventListener('abort',cancel,{once:true});
      timer=setTimeout(()=>{document.dispatchEvent(new CustomEvent('rt-post-request',{detail:JSON.stringify({channel,id,action:'cancel'})}));finish(Error('Public posts took too long to load. Try again.'));},12000);
      if(signal?.aborted){cancel();return;}
      document.dispatchEvent(new CustomEvent('rt-post-request',{detail:JSON.stringify({channel,id,...parameters})}));
    });
  }
  async function archiveRead(parameters){
    let timer;try{const response=await Promise.race([chrome.runtime.sendMessage({scope:'rt-posts',...parameters,pageUrl:location.href}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Archive request took too long. Try again.')),16000);})]);if(!response?.ok)throw Object.assign(Error(response?.error || 'Archive unavailable.'),{code:response?.code,retryAt:response?.retryAt});return response;}catch(error){if(/took too long/.test(error.message))error.code='timeout';throw error;}finally{clearTimeout(timer);}
  }
  let earlySettingsUsed=false;
  async function settingsRead(){
    // The document_start guard already asked the worker; reuse that answer once.
    const early=!earlySettingsUsed && globalThis.RTProfileNoticeGuard?.settings;earlySettingsUsed=true;
    if(early){try{const response=await early;if(response?.ok && response.settings)return {[key]:response.settings};}catch{}}
    const response=await archiveRead({action:'get-settings'});
    return {[key]:response.settings};
  }
  // Reddit's current deletion notices, plus the legacy bracket placeholders.
  const deletionNotice=text=>Boolean(M.noticeStatus(text));
  const itemKey=post=>post.kind==='comment'?post.fullname:post.id;
  // HTMLCollection iteration is slow in jsdom and allocates in browsers; walk siblings.
  function elementChildren(element){const out=[];for(let node=element?.firstElementChild;node;node=node.nextElementSibling)out.push(node);return out;}
  const cardSelector='shreddit-post[id],shreddit-profile-comment[comment-id],[data-testid="post-container"][data-fullname]';
  // Community artwork found on the page, kept per subreddit (a miss expires quickly).
  const avatarHints=new Map();
  const make=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text)el.textContent=text;return el;};
  const nativeStatusPaths={hidden:'M3.497 3.503a.9.9 0 10-1.273 1.273l.909.909A10.141 10.141 0 00.92 8.472a3.225 3.225 0 000 3.058A10.296 10.296 0 0010 16.973a10.13 10.13 0 003.709-.712l1.457 1.457a.897.897 0 001.274 0 .9.9 0 000-1.273L3.497 3.503ZM10 15.172a8.497 8.497 0 01-7.495-4.494 1.448 1.448 0 010-1.354 8.436 8.436 0 011.9-2.365l2.069 2.068c-.062.271-.105.55-.105.84a3.77 3.77 0 003.767 3.767c.29 0 .569-.043.84-.106l1.31 1.31a8.284 8.284 0 01-2.284.335L10 15.172Zm.476-7.237L8.874 6.333a3.722 3.722 0 011.26-.233 3.77 3.77 0 013.767 3.767c0 .444-.091.864-.233 1.26l-1.603-1.603a1.963 1.963 0 00-1.59-1.589Zm8.605 3.595a10.297 10.297 0 01-2.22 2.792L15.59 13.05a8.512 8.512 0 001.905-2.372 1.448 1.448 0 000-1.354A8.496 8.496 0 007.69 5.15L6.282 3.742A10.249 10.249 0 0110 3.028c3.8 0 7.28 2.087 9.08 5.444a3.225 3.225 0 010 3.058Z',deleted:'M15.2 15.7c0 .83-.67 1.5-1.5 1.5H6.3c-.83 0-1.5-.67-1.5-1.5V7.6H3v8.1C3 17.52 4.48 19 6.3 19h7.4c1.82 0 3.3-1.48 3.3-3.3V7.6h-1.8v8.1ZM17.5 5.8c.5 0 .9-.4.9-.9S18 4 17.5 4h-3.63c-.15-1.68-1.55-3-3.27-3H9.4C7.68 1 6.28 2.32 6.13 4H2.5c-.5 0-.9.4-.9.9s.4.9.9.9h15ZM7.93 4c.14-.68.75-1.2 1.47-1.2h1.2c.72 0 1.33.52 1.47 1.2H7.93Z'};
  Object.assign(nativeStatusPaths,{filter:'M3 6.9h7.11A4 4 0 0014 10c2.21 0 4-1.79 4-4s-1.79-4-4-4a4 4 0 00-3.89 3.1H3c-.5 0-.9.4-.9.9s.4.9.9.9Zm11-3.1c1.21 0 2.2.99 2.2 2.2 0 1.21-.99 2.2-2.2 2.2-1.21 0-2.2-.99-2.2-2.2 0-1.21.99-2.2 2.2-2.2Zm3 9.3H9.89A4 4 0 006 10c-2.21 0-4 1.79-4 4s1.79 4 4 4a4 4 0 003.89-3.1H17c.5 0 .9-.4.9-.9s-.4-.9-.9-.9ZM6 16.2c-1.21 0-2.2-.99-2.2-2.2 0-1.21.99-2.2 2.2-2.2 1.21 0 2.2.99 2.2 2.2 0 1.21-.99 2.2-2.2 2.2Z',checkmark:'M7.09 15.84c-.23 0-.46-.09-.64-.26L1.3 10.42a.9.9 0 010-1.27.9.9 0 011.27 0l4.52 4.52L17.5 3.26a.9.9 0 011.27 0 .9.9 0 010 1.27L7.73 15.58c-.18.18-.41.26-.64.26Z','chevron-right':'M7.5 17.9a.898.898 0 01-.636-1.536L13.227 10 6.864 3.636a.898.898 0 010-1.272.898.898 0 011.272 0l7 7a.898.898 0 010 1.272l-7 7a.897.897 0 01-.636.264Z','arrow-back':'M17.5 9.1H4.679l5.487-5.462a.898.898 0 00.003-1.272.898.898 0 00-1.272-.003l-7.032 7a.898.898 0 000 1.275l7.03 7a.896.896 0 001.273-.003.898.898 0 00-.002-1.272l-5.487-5.462h12.82a.9.9 0 000-1.8Z'});
  // Reddit's own icons (copied from its live icon set): remove, archive-fill, rotate, pie-chart.
  Object.assign(nativeStatusPaths,{"removed": "M16.38 16.34A8.967 8.967 0 0019 10c0-4.96-4.04-9-9-9-2.47 0-4.71 1-6.34 2.62 0 0-.01 0-.02.01s0 .01-.01.02a8.967 8.967 0 00-2.62 6.34c0 4.96 4.04 9 9 9 2.47 0 4.71-1 6.34-2.62 0 0 .01 0 .02-.01s0-.01.01-.02ZM17.2 10c0 1.66-.57 3.19-1.52 4.41L5.59 4.32A7.157 7.157 0 0110 2.8c3.97 0 7.2 3.23 7.2 7.2ZM2.8 10c0-1.66.57-3.19 1.52-4.41l10.09 10.09A7.157 7.157 0 0110 17.2c-3.97 0-7.2-3.23-7.2-7.2Z", "archive": "M15.7 1H4.3C2.48 1 1 2.48 1 4.3v2.76c0 .5.4.9.9.9H2v6.74C2 16.52 3.48 18 5.3 18h9.4c1.82 0 3.3-1.48 3.3-3.3V7.96h.1c.5 0 .9-.4.9-.9V4.3C19 2.48 17.52 1 15.7 1ZM13 11.87H7v-1.8h6v1.8Zm4.2-5.71H2.8V4.3c0-.83.67-1.5 1.5-1.5h11.4c.83 0 1.5.67 1.5 1.5v1.86Z", "refresh": "M18 10.1a.9.9 0 01-1.8 0c0-2.867-2.332-5.2-5.199-5.2H8.074l.564.564a.9.9 0 01-1.274 1.272l-2.1-2.1a.898.898 0 010-1.272l2.1-2.1a.9.9 0 111.273 1.272l-.564.564H11c3.859 0 7 3.14 7 7Zm-5.363 3.164a.9.9 0 10-1.273 1.272l.564.564H9.001a5.205 5.205 0 01-5.199-5.2.9.9 0 00-1.8 0c0 3.86 3.141 7 7 7h2.927l-.564.564a.9.9 0 001.274 1.272l2.1-2.1a.898.898 0 000-1.272l-2.102-2.1Z", "activity": "M10 1c-.5 0-.9.4-.9.9v.17C5.11 2.52 2 5.9 2 10c0 4.41 3.59 8 8 8 4.11 0 7.48-3.11 7.93-7.1h.17c.5 0 .9-.4.9-.9 0-4.96-4.04-9-9-9Zm.9 1.86c3.25.41 5.84 2.99 6.24 6.24H10.9V2.86ZM10 16.2c-3.42 0-6.2-2.78-6.2-6.2 0-3.11 2.31-5.69 5.3-6.12V10c0 .5.4.9.9.9h6.12c-.44 2.99-3.01 5.3-6.12 5.3Z"});
  function glyph(kind='search'){
    const s=document.createElementNS('http://www.w3.org/2000/svg','svg');s.setAttribute('viewBox','0 0 24 24');s.dataset.icon=kind;s.classList.add('rt-activity-icon');s.setAttribute('aria-hidden','true');if(nativeStatusPaths[kind]){s.setAttribute('viewBox','0 0 20 20');s.dataset.nativeIcon='true';s.setAttribute('fill','currentColor');s.setAttribute('width','16');s.setAttribute('height','16');s.setAttribute('icon-name',kind);const path=document.createElementNS(s.namespaceURI,'path');path.setAttribute('d',nativeStatusPaths[kind]);s.append(path);return s;}
    const p=document.createElementNS(s.namespaceURI,'path');p.setAttribute('d',kind==='refresh'?'M20 8a8.9443 8.9443 0 1 0 0 8M20 3v5h-5':kind==='filter'?'M4 7h16M4 17h16M9 5v4M15 15v4':kind==='archive'?'M4 8h16v12H4zM3 4h18v4H3zM9 12h6':kind==='removed'?'M5 5l14 14M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20':kind==='close'?'M6 6l12 12M18 6L6 18':kind==='calendar'?'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4':kind==='posttype'?'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4':kind==='community'?'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M9 16l3-8 3 8M10 13.5h4':'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14m5 12 6 6');s.append(p);return s;
  }
  // Reddit's own artwork for unavailable accounts: the image on its own notice when there is one
  // (deleted: snoo-404), otherwise the suspended snoo it uses in hover cards.
  const unavailableAvatarUrl=(state,notice)=>{
    const own=notice?.querySelector?.('img[src]')?.getAttribute('src');
    try{const url=new URL(own,location.href);if(url.protocol==='https:' && url.hostname==='www.redditstatic.com' && /^\/shreddit\/assets\/[\w/-]+\.png$/.test(url.pathname))return url.href;}catch{}
    return state==='banned'?'https://www.redditstatic.com/shreddit/assets/suspended-snoo.png':'https://www.redditstatic.com/shreddit/assets/mod/snoo-404.png';
  };
  // One clear line under the name, in Reddit's own words when its notice has them.
  function accountStateLine(state,notice){
    const own=notice?.querySelector?.('#shreddit-forbidden-title,h3')?.textContent?.replace(/\s+/g,' ').trim() || '';
    const text=own && own.length<=120?own:state==='banned'?'This account has been suspended.':'This account has been deleted.';
    const line=make('p','rt-account-state m-0 mt-2xs text-12 text-neutral-content-weak flex items-center gap-2xs');line.dataset.state=state;line.dataset.testid='profile-account-state';
    line.append(glyph(state==='banned'?'removed':'deleted'),make('span','',text+' Showing archived public activity.'));return line;
  }
  function unavailableAvatar(state,size=64,notice=null){const image=make('img','rt-unavailable-avatar');image.src=unavailableAvatarUrl(state,notice);image.width=image.height=size;image.alt='';image.decoding='async';image.referrerPolicy='no-referrer';return image;}
  function button(text,run,icon){const b=make('button','',text);b.type='button';if(icon)b.prepend(glyph(icon));b.addEventListener('click',run);return b;}
  function link(text,url,cls){const a=make('a',cls,text);a.href=url;a.rel='noopener noreferrer';return a;}
  // Instance fields that belong to the extension, not to one profile view.
  const sharedKeys=new Set(['settings','settingsPending','settingsError','settingsRevision','parked','profileOwner','observer','onRoute','onSettings','onWorkerSettings','avatarUnsubscribe','ready','reddit','archive','readSettings','nativeRenderer','autoDiscover','nativeWaitMs','retryUnitMs','sourceWaitMs','timer','profileNavigation','navigationLease','archiveForceUntil','flushingVirtualization','feedViewportUpdate','runtimeId','dead','scanFull']),parkLimit=4;let generationSeq=0;
  class Discovery {
    constructor({reddit=redditRead,archive=archiveRead,readSettings=settingsRead,observe=true,autoDiscover=observe,nativeRenderer=null,timing={}}={}){
      this.nativeWaitMs=timing.nativeWaitMs ?? nativeWaitMs;this.retryUnitMs=timing.retryUnitMs ?? 1000;this.sourceWaitMs=timing.sourceWaitMs ?? sourceWaitMs;
      this.runtimeId=globalThis.chrome?.runtime?.id;this.navigationLease=crypto.randomUUID();this.parked=new Map();this.profileOwner=globalThis.RCSDirectory?.getOwner?.() || '';this.nativeRenderer=nativeRenderer;this.autoDiscover=autoDiscover;this.reddit=reddit;this.archive=archive;this.readSettings=readSettings;this.settings={postDiscovery:false,archiveDiscovery:false};this.settingsRevision=0;this.generation=0;this.controllers=new Set();this.nodes=new Map();this.host=null;
      this.settingsPending=true;this.syncProfileNotice();
      this.onRoute=()=>{this.syncProfileNotice();this.schedule();};this.onSettings=(changes,area)=>{if(area==='local' && changes[key])this.applySettings(M.normalizeSettings(changes[key].newValue));};
      // Changes inside the observed feed are handled by its own observer; only
      // route/page-level changes need a scan.
      if(observe){this.observer=new MutationObserver(records=>{if(this.orphaned())return;this.syncProfileNotice();if(this.feed)this.trackVirtualization(records);
        // Nothing mounted and not a page discovery acts on: unrelated page churn.
        if(this.idleRoute())return;if(records.some(r=>!this.ownsMutation(r) && !(this.feedPresentationObserver && this.feed?.contains(r.target))))this.schedule(true);});this.observer.observe(document.documentElement,{childList:true,subtree:true});window.addEventListener('popstate',this.onRoute);document.addEventListener('reddit:route',this.onRoute);globalThis.chrome?.storage?.onChanged?.addListener(this.onSettings);}
      this.onWorkerSettings=(message,sender)=>{if(message?.scope==='rt-posts' && message.action==='settings-changed' && sender?.id===globalThis.chrome?.runtime?.id)this.onSettings({[key]:{newValue:message.settings}},'local');};
      if(observe)globalThis.chrome?.runtime?.onMessage?.addListener(this.onWorkerSettings);
      this.avatarUnsubscribe=globalThis.RCSDirectory?.onChange?.(value=>{const owner=globalThis.RCSDirectory?.getOwner?.() || '';if(value?.owner && value.owner!==owner)return;if(this.profileOwner!==owner){this.profileOwner=owner;this.discardAllParked();this.reset({retainNavigation:false});this.scan();}});
      this.ready=this.loadSettings();
    }
    async loadSettings(){const revision=this.settingsRevision;try{const saved=await this.readSettings();if(revision!==this.settingsRevision)return;this.settingsPending=false;this.settingsError=false;this.settings=M.normalizeSettings(saved?.[key]);this.scan();}catch{if(revision!==this.settingsRevision)return;this.settingsPending=false;this.settingsError=true;this.scan();}}
    // Storage and the worker both announce a settings change; only the first one
    // differs. Turning discovery or the archive on or off rebuilds the view; a
    // change to restoring deleted text only adjusts what is already mounted.
    applySettings(next){
      if(this.dead)return;const previous=this.settings,fresh=this.settingsPending || this.settingsError,names=['postDiscovery','archiveDiscovery','restoreDeletedContent'];
      if(!fresh && names.every(name=>previous[name]===next[name]))return;
      const rebuild=fresh || previous.postDiscovery!==next.postDiscovery || previous.archiveDiscovery!==next.archiveDiscovery;
      if(rebuild)this.discardAllParked();
      this.settingsRevision++;this.settingsPending=false;this.settingsError=false;this.settings=next;
      if(rebuild){this.reset();this.scan();return;}
      this.syncProfileNotice();this.restoreSettingChanged();
    }
    restoreSettingChanged(){
      this.clearSourceRetries(key=>key==='recovery');if(this.sourceErrors)delete this.sourceErrors.recovery;
      if(this.context?.kind!=='profile' || !this.host)return;
      if(this.settings.restoreDeletedContent){this.scheduleRecovery();return;}
      // Off: stop pending work, drop the text fetched only for recovery and put
      // Reddit's notices back, without rebuilding the view.
      clearTimeout(this.recoveryTimer);this.recoveryTimer=null;
      for(const key of this.recoveredKeys || [])this.archived.delete(key);this.recoveredKeys=new Set();this.recoveryChecked.clear();
      this.restoreRecoveredBodies();this.render({reuseCards:true});
    }
    // After an extension reload this script keeps running without its extension.
    orphaned(){
      if(this.dead)return true;if(!this.runtimeId)return false;let id;try{id=globalThis.chrome?.runtime?.id;}catch{}
      if(id)return false;try{this.destroy();}catch{}return true;
    }
    // Nothing is mounted and the page is not one discovery acts on.
    idleRoute(){if(this.host || this.context)return false;const route=pageRoute();return route?.kind!=='profile' && !(route?.kind==='post' && !globalThis.RTThreadRestore);}
    syncProfileNotice(){
      // The independent early guard needs no shared model. Discovery itself
      // retains its established document_idle registration in the isolated world.
      if(globalThis.RTProfileNoticeGuard){if(this.settingsPending)RTProfileNoticeGuard.refresh();else RTProfileNoticeGuard.setEnabled(this.settings.postDiscovery);return;}
      document.documentElement.toggleAttribute('data-rt-profile-discovery',pageRoute()?.kind==='profile' && location.hostname!=='old.reddit.com' && (this.settingsPending || this.settings.postDiscovery));
    }
    ownsMutation(record){if(this.host?.contains(record.target) || record.target.closest?.('[data-rt-ui=activity-item],[data-rt-ui=activity-slot]'))return true;const nodes=[...record.addedNodes,...record.removedNodes];return nodes.length>0 && nodes.every(n=>n.nodeType===1 && Boolean(n.dataset?.rtUi));}
    // cheap: a page-level mutation, which only needs a full pass if the mounted page changed.
    schedule(cheap=false){if(this.dead)return;if(!cheap)this.scanFull=true;if(this.timer)return;this.timer=setTimeout(()=>{this.timer=null;const full=this.scanFull;this.scanFull=false;this.scan({cheap:!full});},60);}
    reset({retainNavigation=false,detach=false,keepCards=false}={}){this.flushVirtualization();
      // detach: stop all work but leave every change inside the retained feed.
      const undo=!detach;if(undo)for(const node of this.collapsedNativeRules || [])node.removeAttribute('data-rt-rule-collapsed');this.collapsedNativeRules=new Set();if(undo){for(const node of this.mergePendingNodes || [])node.removeAttribute('data-rt-order-pending');this.feed?.removeAttribute('data-rt-merge-waiting');}this.mergePendingNodes=new Set();this.publishedNative=new WeakSet();if(undo){this.feed?.removeAttribute('data-rt-activity');this.feed?.removeAttribute('data-rt-loading-owner');}this.feedPresentationObserver?.disconnect();this.feedPresentationObserver=null;if(undo)for(const style of this.nativeLoadingStyles || [])style.remove();this.nativeLoadingStyles=new Set();if(undo)for(const [node,hidden] of this.filteredNative || []){node.hidden=hidden;node.removeAttribute('data-rt-filter-hidden');node.removeAttribute('data-rt-activity-match');const original=this.virtualNodes?.get(node);if(original){original.hidden=hidden;original.removeAttribute('data-rt-filter-hidden');original.removeAttribute('data-rt-activity-match');}}if(undo){this.clearActivityMenu();this.controlsTarget?.remove();}else this.detachActivityMenu();this.controlsTarget=null;if(this.commentSort && undo){this.commentSort.node.hidden=this.commentSort.hidden;this.commentSort.node.removeAttribute('data-rt-comment-sort-suppressed');this.commentSort=null;}this.commentSort=null;this.activityArchiveAttempted=false;if(undo)this.activityEmpty?.remove();this.activityEmpty=null;this.activityFilter='all';this.filteredNative=new Map();this.postStatuses=new Map();if(undo){this.restoreRecoveredBodies();this.profileNavigation?.remove();}else this.forgetRecoveredBodies();if(!retainNavigation){this.profileNavigation=null;this.navigationLease=crypto.randomUUID();}else if(this.profileNavigation?.dataset.state==='loading')this.profileNavigation.dataset.state='idle';if(undo){this.archiveNotice?.removeAttribute('data-rt-archive-notice');this.archiveShell?.remove();}this.archiveNotice=this.archiveNoticeAnchor=this.archiveShell=this.archiveMain=this.archiveStats=this.avatarSlot=this.avatarPlaceholder=null;this.profileOverlay=false;this.profileTransition=false;this.presentedFeedNodes=null;this.archiveOnly=false;this.accountState='';this.generation=++generationSeq;this.recoveryObserver?.disconnect();this.recoveryObserver=null;this.recoveryObserved=new WeakSet();clearTimeout(this.recoveryTimer);this.recoveryTimer=null;clearTimeout(this.nativeResumeTimer);this.nativeObserver?.disconnect();this.batchObserver?.disconnect();this.batchObserver=null;this.nativeLoadingObserver?.disconnect();this.nativeLoadingObserver=null;this.nativeLoadingRoot=null;if(this.batchFrame)cancelAnimationFrame(this.batchFrame);this.batchFrame=null;this.activeProfileBatch=null;this.replyEnrichment=null;this.publishedCards=new Set();this.batchedProfile=false;this.batchInView=false;this.batchAutoPaused=false;this.forceProfileBatch=false;this.nativeBatch={active:0,queue:[]};this.nativeRetries=new WeakMap();this.postMetadata=new Map();this.replyContexts=new Map();this.replyAuthors=new Map();this.replyArchiveChecked=new Set();for(const c of this.controllers)c.abort();this.controllers.clear();if(this.emptyFeed && undo){this.emptyFeed.hidden=this.emptyWasHidden;this.emptyFeed.removeAttribute('data-rt-empty-suppressed');}this.emptyFeed=null;if(undo && !keepCards)for(const node of this.nodes.values()){const slot=this.feedSlot(node);if(slot!==node){
        // Reddit still owns this placeholder and may restore its detached node.
        // Retire both without removing a slot from its virtualization stack.
        slot.dataset.rtRetired='true';node.dataset.rtRetired='true';node.replaceChildren();node.hidden=true;
      }else node.remove();}this.virtualNodes=new Map();if(undo){this.loading?.remove();this.host?.remove();}this.loading=null;this.host=null;this.feed=null;this.context=null;this.live=new Map();this.commentOrigins=new Map();this.archived=new Map();if(undo)this.nodes.clear();else this.nodes=new Map();this.after=this.before=null;this.loaded=false;this.archiveLoaded=false;this.moreReddit=this.moreArchive=false;this.sourceErrors={};this.sourceNotices={};for(const entry of this.sourceRetries?.values() || [])clearTimeout(entry.timer);this.sourceRetries=new Map();this.metadataPending=0;this.recoveryChecked=new Set();this.recoveryActive=false;this.detailRecoveryStarted=false;this.busy=false;this.archiveBusy=false;this.initialPrefetchDone=false;this.sourcePending=new Set();this.sourceFrontiers=new Map();this.sourceStartedAt=new Map();this.nativeSeenAt=new WeakMap();this.initialNative=new WeakSet();clearTimeout(this.gateTimer);this.gateTimer=null;this.gateAt=Infinity;this.redditRun=null;this.archiveRun=null;this.verifyQueue=[];this.verifyQueued=new Set();this.verifyRetry=[];this.recoveredKeys=new Set();this.mountSeen=null;this.verifyActive=false;this.pages=0;this.afterByKind={};this.beforeByKind={};this.redMore={};this.archiveMore={};this.renderedPosts=[];this.summaryCounts=null;this.archiveSig=undefined;this.rtChips=null;this.rtSearch=null;this.rtAgg=null;this.rtMenu=null;}
    // Leaving a profile parks its whole discovery state with its feed element.
    // Reddit keeps that element (cards included) and puts it back on Back with
    // its own scroll restore, so nothing is removed, copied or re-inserted:
    // work stops, every change stays in the retained feed, and the state is
    // adopted again when that feed returns. Up to parkLimit profiles are kept;
    // older ones are torn down properly.
    viewState(){const state={};for(const key of Object.keys(this))if(!sharedKeys.has(key))state[key]=this[key];state.nodes=new Map(this.nodes);return state;}
    // Only a view Reddit has taken out of the page is parked; anything still
    // displayed is torn down as before.
    parkable(){return Boolean(this.settings.postDiscovery && !this.settingsError && this.context?.kind==='profile' && this.feed && !this.feed.isConnected && location.hostname!=='old.reddit.com');}
    // Reddit replaced the feed of the profile being viewed: keep what was
    // loaded and move the same rendered cards into the new feed.
    carryOver(state){
      if(!state || state.archiveOnly!==this.archiveOnly)return false;
      for(const name of ['live','archived','commentOrigins','nodes','publishedCards','replyContexts','replyAuthors','replyArchiveChecked','sourceFrontiers','sourceErrors','recoveryChecked','activityFilter','postStatuses','archiveSig','loaded','archiveLoaded','pages','moreReddit','moreArchive','initialPrefetchDone','afterByKind','beforeByKind','redMore','archiveMore','recoveredKeys','verifyRetry'])if(name in state)this[name]=state[name];
      for(const node of this.nodes.values()){node.classList.remove('rt-native-enter','rt-native-inserted');if(['loading','queued'].includes(node.dataset.rtNativeState))node.dataset.rtNativeState='idle';this.results.append(node);}
      const generation=this.generation;queueMicrotask(()=>this.resumeWork(generation,new Set(state.sourcePending || []),state.sourceRetries || new Map(),false));
      return true;
    }
    leaveProfile({retainNavigation=false,always=false}={}){
      if(!this.parkable()){if(always || this.host || this.context)this.reset({retainNavigation});return;}
      this.flushVirtualization();const feed=this.feed,state=this.viewState();
      // Reattaching the feed would replay entrance animations; they already ran.
      for(const node of this.nodes.values())node.classList.remove('rt-native-enter','rt-native-inserted');
      this.parked.delete(feed);this.parked.set(feed,state);
      // Reddit may leave our header in place while swapping the feed (tab change).
      const host=this.host;this.reset({detach:true,retainNavigation:true});if(host?.isConnected && !host.contains(feed))host.remove();
      while(this.parked.size>parkLimit){const [old,parked]=this.parked.entries().next().value;this.parked.delete(old);this.discardParked(parked);}
    }
    parkedFor(context){for(const [feed,state] of this.parked)if(feed.isConnected && state.context?.key===context.key && state.host)return [feed,state];return null;}
    adopt(feed,state){
      this.parked.delete(feed);for(const [key,value] of Object.entries(state))this[key]=value;
      if(!this.host.isConnected && !this.host.contains(feed))feed.before(this.host);
      // Work cut off by parking, resumed below.
      const interrupted=new Set(state.sourcePending || []),retries=state.sourceRetries || new Map(),firstLoad=!state.loaded && !state.archiveLoaded;
      // Fresh generation: anything still in flight from before parking is ignored.
      this.generation=++generationSeq;this.controllers=new Set();this.busy=this.archiveBusy=this.verifyActive=false;this.redditRun=this.archiveRun=null;
      this.sourcePending=new Set();this.metadataPending=0;this.replyEnrichment=null;this.profileOverlay=this.profileTransition=false;this.gateTimer=null;this.gateAt=Infinity;
      // Flags and controls that only describe work in flight start clean.
      this.recoveryActive=false;this.recoveryTimer=null;this.batchFrame=null;this.batchAutoPaused=false;this.forceProfileBatch=false;this.mountSeen=null;
      if(this.discover)this.discover.disabled=false;if(this.more)this.more.disabled=false;this.host.removeAttribute('aria-busy');
      for(const entry of retries.values())clearTimeout(entry.timer);this.sourceRetries=new Map();
      // Queued and loading renders were dropped with the old queue; queue them again.
      this.nativeBatch={active:0,queue:[]};for(const node of this.nodes.values())if(['loading','queued'].includes(node.dataset.rtNativeState))node.dataset.rtNativeState='idle';
      for(const key of ['feedPresentationObserver','nativeLoadingObserver','nativeLoadingRoot','recoveryObserver','nativeObserver'])this[key]=null;this.recoveryObserved=new WeakSet();
      // Rebuild the activity menu from Reddit's rows; it reconnects its observer.
      this.clearActivityMenu();this.observeBatchTail();
      // Cards whose render was cut off by leaving are queued again, as part of
      // the same (re-stamped) batch.
      if(this.activeProfileBatch){this.activeProfileBatch.generation=this.generation;this.activeProfileBatch.enriching=false;}
      for(const node of this.activeProfileBatch?.nodes || [])if(node.dataset.rtNativeState==='idle')this.queueNative(node);this.settleProfileBatch();
      const generation=this.generation;queueMicrotask(()=>this.resumeWork(generation,interrupted,retries,firstLoad));
    }
    // Continue what parking (or a feed replacement) interrupted: re-arm retries
    // for their remaining wait, restart streams that were cut off mid-request,
    // or the whole first load if it never finished. Never leave a view that
    // claims "Activity checked" while something was dropped.
    resumeWork(generation,interrupted,retries,firstLoad){
      if(generation!==this.generation || !this.host?.isConnected)return;
      for(const [key,entry] of retries){this.sourceRetries.set(key,entry);entry.timer=setTimeout(()=>{entry.timer=null;if(generation!==this.generation || !this.host?.isConnected)return;this.retrySource(key);},Math.max(0,(entry.at || 0)-Date.now()));}
      if(firstLoad){if((interrupted.size || this.autoDiscover) && this.context?.kind==='profile'){if(this.archiveOnly){if(this.settings.archiveDiscovery)this.loadArchive();}else this.refreshActivity();}}
      else{
        const pending=[...interrupted].filter(key=>!retries.has(key)),reddit=pending.filter(key=>!key.startsWith('archive-')),archive=pending.filter(key=>key.startsWith('archive-')).map(key=>key.slice(8));
        if(reddit.length)this.loadReddit({retry:true,keys:reddit});
        if(archive.length && this.settings.archiveDiscovery){for(const kind of archive)this.archiveMore[kind]=true;this.archiveRun=this.archivePage({more:true,only:archive});}
      }
      this.pumpVerification();this.updateProfileLoading();
    }
    discardParked(state){
      const current=this.viewState(),navigation=this.profileNavigation;
      for(const [key,value] of Object.entries(state))this[key]=value;this.controllers=new Set();this.profileNavigation=null;
      try{this.reset({retainNavigation:true});}
      finally{for(const key of Object.keys(this))if(!sharedKeys.has(key) && !(key in current))delete this[key];Object.assign(this,current);this.profileNavigation=navigation;}
    }
    discardAllParked(){const states=[...this.parked.values()];this.parked.clear();for(const state of states)this.discardParked(state);}
    observeBatchTail(){
      this.batchObserver?.disconnect();this.batchObserver=null;
      if(this.context?.kind!=='profile' || !this.loading || typeof IntersectionObserver!=='function')return;
      this.batchObserver=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.target===this.loading){this.batchInView=entry.isIntersecting;if(entry.isIntersecting)this.continueProfile();}},{rootMargin:innerHeight*2+'px'});this.batchObserver.observe(this.loading);
    }
    trackVirtualization(records){
      for(const record of records){
        if((record.target!==this.feed && !(record.target.matches?.('faceplate-batch') && record.target.parentElement===this.feed)) || record.addedNodes.length!==1 || record.removedNodes.length!==1)continue;
        const added=record.addedNodes[0],removed=record.removedNodes[0];
        if(added.nodeType===1 && added.matches('.virtualized-placeholder') && added.parentElement===record.target){this.virtualNodes.set(added,removed);if(this.filteredNative.has(removed)){this.filteredNative.set(added,this.filteredNative.get(removed));this.filteredNative.delete(removed);}if(removed.dataset?.rtUi==='activity-item'){added.dataset.rtUi='activity-slot';added.hidden=removed.hidden;}if(removed.hasAttribute?.('data-rt-order-pending')){added.setAttribute('data-rt-order-pending','');this.mergePendingNodes.add(added);}if(removed.hasAttribute?.('data-rt-filter-hidden'))added.setAttribute('data-rt-filter-hidden','');if(removed.hasAttribute?.('data-rt-rule-collapsed')){added.setAttribute('data-rt-rule-collapsed','');removed.removeAttribute('data-rt-rule-collapsed');this.collapsedNativeRules?.delete(removed);this.collapsedNativeRules?.add(added);}if(removed.hasAttribute?.('data-rt-activity-match'))added.setAttribute('data-rt-activity-match','');}
        else if(this.virtualNodes.get(removed)===added){if(this.filteredNative.has(removed)){this.filteredNative.set(added,this.filteredNative.get(removed));this.filteredNative.delete(removed);}if(removed.hasAttribute?.('data-rt-rule-collapsed')){added.setAttribute('data-rt-rule-collapsed','');removed.removeAttribute('data-rt-rule-collapsed');this.collapsedNativeRules?.delete(removed);this.collapsedNativeRules?.add(added);}this.virtualNodes.delete(removed);}
      }
    }
    flushVirtualization(){
      // A source promise may run before MutationObserver delivery. Consume the
      // native swaps synchronously before locating/moving retained cards, so a
      // detached original is never mistaken for an unmounted discovery.
      if(this.flushingVirtualization)return;const records=this.feedPresentationObserver?.takeRecords();if(!records?.length)return;
      this.flushingVirtualization=true;
      try{this.withFeedViewport(()=>{this.trackVirtualization(records);
        // Draining the observer also consumes native hydration/filter changes.
        // Apply those before paint rather than dropping their presentation work.
        if(records.some(record=>!this.ownsMutation(record))){const entries=this.nativeEntries();this.syncNativeOrder(entries);if(this.activityFilter!=='all' || this.rtActive())this.filterNativeEntries(entries);this.syncNativeRules(entries);}
        if(records.some(record=>record.type==='childList' && [...record.addedNodes].some(node=>node.nodeType===1 && !node.closest?.('[data-rt-ui]'))))this.observeNativeLoading();});
      }finally{this.flushingVirtualization=false;}
    }
    feedSlot(node){this.flushVirtualization();for(const [placeholder,original] of this.virtualNodes || [])if(original===node && placeholder.parentElement===this.feed)return placeholder;return node;}
    capturePresentedFeed(){
      if(this.context?.kind==='profile' && pageRoute()?.key===this.context.key)this.presentedFeedNodes=new Set(this.nativeEntries().map(entry=>this.virtualNodes.get(entry.node) || entry.node));
    }
    presentedProfileVisible(){
      if(this.context?.kind!=='profile' || !this.host?.isConnected || !this.feed?.isConnected)return false;
      if(this.archiveOnly)return Boolean(this.archiveShell?.isConnected && this.archiveShell.contains(this.feed));
      if(this.feed.closest('main')?.querySelector('shreddit-feed')!==this.feed)return false;
      const current=this.nativeEntries().map(entry=>this.virtualNodes.get(entry.node) || entry.node);
      // Route and header changes precede the feed replacement. Retained native
      // objects (including virtualized ones) identify the outgoing view, even
      // after Reddit removes its profile tabs. IDs can recur in the post view.
      return this.presentedFeedNodes?.size?current.some(node=>this.presentedFeedNodes.has(node)):current.length===0;
    }
    outgoingProfileVisible(context){
      if(this.archiveOnly || context?.kind!=='profile' || this.context?.kind!=='profile' || this.context.key===context.key)return false;
      // Another user's profile: wait until Reddit has swapped the outgoing feed
      // out, so the incoming view never mounts on (or parks) the wrong feed.
      const other=this.context.username.toLowerCase()!==context.username.toLowerCase();
      if(!other && this.context.view===context.view)return false;
      // An outgoing feed with no native cards gives no signal that Reddit has
      // replaced it; never hold another user's view on that.
      if(other && !this.nativeEntries().length)return false;
      const tabs=this.feed?.closest('main')?.querySelector('#profile-feed-tabgroup');
      return Boolean(tabs && !tabs.closest('[data-rt-ui]') && this.presentedProfileVisible());
    }
    // What the mounted profile hangs on. While none of it is replaced, page-level
    // churn needs no reconciliation.
    mountIdentity(){
      const main=document.querySelector('main#main-content,main[role="main"],main'),profile=this.context?.kind==='profile';
      return {main,feed:profile?main?.querySelector('shreddit-feed,[data-rt-archive-feed]') || null:null,dropdown:profile?this.findDropdown(main):null,tabs:main?.querySelector('#profile-feed-tabgroup') || null};
    }
    // Cheap check against the recorded identity: what was found must still be
    // attached where it was; what was absent is looked for again.
    sameMount(){
      const seen=this.mountSeen;if(!seen?.main?.isConnected)return false;
      const {main,feed,dropdown,tabs}=seen;
      if(feed && (!feed.isConnected || !main.contains(feed)))return false;
      if(dropdown?!dropdown.isConnected || !main.contains(dropdown) || this.activityMain && !dropdown.contains(this.activityMain):this.context?.kind==='profile' && this.findDropdown(main))return false;
      return tabs?tabs.isConnected && main.contains(tabs):!main.querySelector('#profile-feed-tabgroup');
    }
    findDropdown(main){
      const known=this.activityDropdown;if(known?.isConnected && main?.contains(known))return known;
      for(const node of main?.querySelectorAll('rpl-dropdown') || [])if(!node.closest('shreddit-feed') && node.querySelector('button[aria-label="Feed options"]'))return node;
      return null;
    }
    scan({cheap=false}={}){
      if(this.orphaned())return;this.syncProfileNotice();
      const context=pageRoute();
      if(this.settings.postDiscovery && (context?.kind==='post' || context?.kind!=='profile' && !/^\/user\//i.test(location.pathname)) && this.presentedProfileVisible()){this.profileOverlay=true;return;}
      if((this.profileOverlay || this.profileTransition) && context?.key===this.context?.key){this.profileOverlay=false;this.profileTransition=false;if(!this.nativeBatch.active)for(const node of this.nodes.values())if(node.dataset.rtNativeState==='loading')node.dataset.rtNativeState='idle';for(const node of this.activeProfileBatch?.nodes || [])if(node.dataset.rtNativeState==='idle')this.queueNative(node);this.settleProfileBatch();}
      // Post pages belong to the thread module when it is loaded; it follows the URL
      // alone, so restoration works however the post was opened.
      if((!this.settings.postDiscovery && !this.settingsError) || !context || context.kind==='post' && globalThis.RTThreadRestore || location.hostname==='old.reddit.com'){
        // Leaving a profile for a post, subreddit, home...: park it with its feed.
        this.leaveProfile();return;
      }
      if(this.outgoingProfileVisible(context)){this.profileTransition=true;return;}
      // Back (or Forward) to a parked profile whose feed Reddit put back.
      if(context.kind==='profile' && (this.context?.key!==context.key || !this.host?.isConnected)){const parked=this.parkedFor(context);if(parked){if(this.context)this.leaveProfile();this.adopt(...parked);}}
      if(this.context?.key===context.key && this.host?.isConnected && (!this.feed || this.feed.isConnected) && (!this.archiveOnly || this.archiveNotice?.isConnected || this.archiveNoticeAnchor?.isConnected)){
        this.syncFiltersFromUrl();
        if(cheap && this.sameMount()){this.maybeRestoreDetail();this.drainNative(this.nativeBatch);return;}
        this.observeNativeLoading();this.observeFeedPresentation();this.ensureActivityMenu();this.maybeRestoreDetail();this.deduplicate();this.drainNative(this.nativeBatch);this.mountSeen=this.mountIdentity();return;}
      const retainNavigation=Boolean(this.profileNavigation && this.settings.postDiscovery && !this.settingsError);
      const carry=this.context?.key===context.key && this.settings.postDiscovery && !this.settingsError && this.context?.kind==='profile' && (this.loaded || this.archiveLoaded)?(this.restoreRecoveredBodies(),this.flushVirtualization(),this.viewState()):null;
      if(carry)this.reset({keepCards:true,retainNavigation:true});else this.leaveProfile({retainNavigation,always:true});
      let main=document.querySelector('main#main-content,main[role="main"],main');
      if(!main && context.kind==='profile'){
        // Unavailable-account pages omit both main and shreddit-feed. Require an
        // explicit native account marker; generic 404/network pages stay native.
        const marker=document.querySelector('shreddit-app > div > img[alt="Deleted user"]');
        const retained=globalThis.RTProfileNoticeGuard?.unavailableNotice?.(),banned=document.querySelector('shreddit-app > #shreddit-forbidden:has(svg[icon-name="ban-fill"])');
        if(retained)main=this.mountArchiveProfile(context,retained.notice,retained.anchor,retained.state);else if(marker && marker.parentElement.querySelector('h3'))main=this.mountArchiveProfile(context,marker.parentElement);else if(banned && /^This account (?:has been (?:banned|suspended)|is suspended)$/i.test(banned.querySelector('#shreddit-forbidden-title')?.textContent.trim()))main=this.mountArchiveProfile(context,banned,banned,'banned');
      }
      if(!main)return;
      let target=context.kind==='profile'?main.querySelector('shreddit-feed,[data-rt-archive-feed]'):main.querySelector('shreddit-post');
      if(!target)return;
      this.context=context;this.feed=context.kind==='profile'?target:null;this.rtFilters=context.kind==='profile'?globalThis.RTFeedFilters?.read(location) || null:null;this.rtPred=null;this.rtSearch=location.search;
      this.batchedProfile=Boolean(this.feed);
      // Cards Reddit has already painted are never pulled back behind the merge
      // gate; hiding them would flash the feed. Later native pages still wait
      // (briefly) for discovery coverage.
      if(this.feed)for(const entry of this.nativeEntries())this.initialNative.add(entry.node);
      if(this.feed && !this.batchedProfile && typeof IntersectionObserver==='function')this.nativeObserver=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){this.nativeObserver.unobserve(entry.target);this.queueNative(entry.target);}},{rootMargin:'400px'});this.live=new Map();this.archived=new Map();
      const host=this.host=make('section','rt-posts');host.dataset.rtUi='posts';host.setAttribute('aria-label',context.kind==='profile'?'Additional public activity':'Archived post snapshot');
      const toolbar=this.toolbar=make('div','rt-posts-toolbar');
      const noun=context.view==='comments'?'comments':context.view==='overview'?'activity':'posts';
      this.discover=button(this.settingsError?'Retry discovery':context.kind==='profile'?'Discover '+noun:'Check archived post',()=>this.settingsError?this.retrySettings():this.archiveOnly?this.loadArchive():context.kind==='profile'?this.refreshActivity():this.loadDetail(),'search');
      this.discover.title=context.kind==='profile'?'Find public '+noun+' through Reddit search, including activity omitted from this profile feed':'Look for a separate archived snapshot without replacing the current post';
      if(context.kind==='post' && !this.settings.archiveDiscovery && !this.settingsError){this.discover.disabled=true;this.discover.title='Enable Arctic Shift archive discovery in Reddit Tweaks to check this post.';}
      this.discover.setAttribute('aria-label',this.discover.textContent);this.discover.textContent='';this.discover.append(glyph(context.kind==='profile'?'refresh':'archive'));
      if(this.archiveOnly){this.discover.setAttribute('aria-label','Search archive');this.discover.title='Find archived public posts and comments for this unavailable account';this.discover.replaceChildren(glyph('archive'));this.discover.disabled=!this.settingsError && !this.settings.archiveDiscovery;}
      toolbar.append(this.discover);
      // The archive now loads with Reddit discovery whenever it is enabled;
      // Refresh activity reloads both providers.
      this.archiveButton=null;
      this.status=make('p','rt-posts-status');this.status.setAttribute('role','status');
      this.results=make('div','rt-posts-results');this.loading=make('div','rt-post-loading');this.loading.hidden=true;this.loading.setAttribute('aria-label','Loading posts');this.loading.append(this.feedLoader());
      this.more=button('Load more',()=>this.batchedProfile?this.advanceProfileBatch(true):this.loadMore());this.more.className='rt-posts-more';this.more.hidden=true;
      this.notice=make('p','rt-posts-notice');this.notice.setAttribute('role','note');this.notice.hidden=true;
      toolbar.append(this.status,this.notice);host.append(toolbar,this.loading,this.results,this.more);
      if(context.kind==='profile'){this.rtChips=make('div','rt-filter-chips');this.rtChips.dataset.rtUi='filter-chips';this.rtChips.hidden=true;host.prepend(this.rtChips);this.renderFilterChips();}
      if(context.kind==='profile'){target.before(host);this.results.hidden=true;this.more.textContent='More discoveries';toolbar.append(this.more);}else target.after(host);
      if(context.kind==='profile'){this.loading.dataset.rtUi='profile-loading';this.loading.slot='load-after';this.feed.append(this.loading);this.observeBatchTail();}
      if(this.archiveOnly && this.autoDiscover)this.loadNavigation();
      this.emptyFeed=main.querySelector('#empty-feed-content');this.emptyWasHidden=this.emptyFeed?.hidden;
      const restored=context.kind==='profile' && this.carryOver(carry);
      if(restored)this.render({reuseCards:true});
      this.observeNativeLoading();this.observeFeedPresentation();this.ensureActivityMenu();
      if(this.settingsError)this.setStatus('Discovery settings could not be loaded. Select Retry discovery.',true);
      else if(context.kind==='profile' && this.autoDiscover && !restored)queueMicrotask(()=>{if(this.host===host){if(this.archiveOnly){if(this.settings.archiveDiscovery)this.loadArchive();}else this.refreshActivity();}});
      this.maybeRestoreDetail();this.capturePresentedFeed();this.mountSeen=this.mountIdentity();
    }
    mountArchiveProfile(context,notice,anchor=notice,state='deleted'){
      this.accountState=state;this.archiveOnly=true;this.archiveNotice=notice;this.archiveNoticeAnchor=anchor;
      const layout=this.archiveShell=make('div','grid-container theme-rpl grid flex-nav-expanded');layout.dataset.rtUi='archive-profile';layout.dataset.rtUsername=context.username;layout.dataset.rtAccountState=state;layout.dir='ltr';
      const subgrid=make('div','subgrid-container m:col-start-2 box-border flex flex-col order-2 w-full m:w-[1120px] xs:px-md m:px-lg mx-auto min-h-[calc(100dvh_-_var(--shreddit-header-height))] justify-stretch');subgrid.id='subgrid-container';
      const columns=make('div','main-container gap-lg w-full flex-1 grid place-content-between grid-cols-[minmax(0,1fr)] fixed-sidebar xs:[&.fixed-sidebar]:grid-cols-[minmax(0,756px)_minmax(0,316px)] xs:[&.flex-sidebar]:grid-cols-[minmax(0,756px)_auto]');
      const shell=this.archiveMain=make('main','main w-full min-w-0');shell.id='main-content';
      const header=make('div','px-md relative pt-md flex pb-md items-center'),copy=make('div','w-full min-w-0'),title=make('h1','text-24 font-bold m-0 break-words',context.username),name=make('p','m-0 text-14 text-neutral-content-weak font-semibold','u/'+context.username);
      title.dataset.testid='profile-display-name';name.dataset.testid='profile-prefixed-name';copy.append(title,name,accountStateLine(state,notice));this.avatarSlot=make('div','rt-profile-avatar flex items-center justify-center shrink-0 w-[74px] min-h-4xl overflow-hidden pe-md relative');this.avatarPlaceholder=make('span','flex items-center justify-center text-neutral-content-weak w-4xl h-4xl');this.avatarPlaceholder.setAttribute('role','img');this.avatarPlaceholder.setAttribute('aria-label',(state==='banned'?'Banned or suspended':'Deleted')+' account · Profile picture unavailable');const profileIcon=unavailableAvatar(state,64,notice);profileIcon.id='profile-icon';profileIcon.dataset.testid='profile-icon';this.avatarPlaceholder.append(profileIcon);this.avatarSlot.append(this.avatarPlaceholder);header.append(this.avatarSlot,copy);
      const tabsContainer=make('div','mx-2xs my-md'),tabs=make('faceplate-tabgroup','nd:flex nd:gap-xs nd:w-fit');tabs.id='profile-feed-tabgroup';tabs.setAttribute('slot','tabs');tabs.setAttribute('for','profile-feed-tabs');
      const views=[['overview','Overview',''],['posts','Posts','submitted/'],['comments','Comments','comments/']],index=views.findIndex(([view])=>view===context.view)+1;tabs.setAttribute('pageindex',String(index));
      for(const [i,[view,label,suffix]] of views.entries()){
        const tab=link('', '/user/'+context.username+'/'+suffix),selected=view===context.view;
        tab.className='button-medium px-[calc(var(--rem12)-var(--button-border-width,0px))] button-plain items-center justify-center button inline-flex';tab.setAttribute('rpl','');tab.setAttribute('slot','page-'+(i+1));tab.id='profile-tab-'+view+'_tab';tab.tabIndex=selected?0:-1;
        const content=make('span','flex items-center justify-center'),text=make('span','flex items-center gap-xs',label);content.append(text);tab.append(content);
        if(selected){tab.setAttribute('faceplate-tab-selected','');tab.setAttribute('aria-current','page');tab.classList.add('bg-secondary-background-selected','!text-neutral-content-strong','tab-selected');tab.style.backgroundColor='var(--color-secondary-background-selected)';}
        tabs.append(tab);
      }
      for(const direction of ['back','forward']){const control=make('button','!px-sm button-small px-[calc(var(--rem10)-var(--button-border-width,0px))] button-plain icon items-center justify-center button inline-flex');control.type='button';control.slot=direction+'-button';control.tabIndex=-1;const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');for(const [key,value] of Object.entries({rpl:'',class:'rpl-rtl-icon',fill:'currentColor',height:'16',width:'16',viewBox:'0 0 20 20','icon-name':direction==='back'?'caret-left':'caret-right'}))icon.setAttribute(key,value);const path=document.createElementNS(icon.namespaceURI,'path');path.setAttribute('d',direction==='back'?'M6.3 10c0-.23.088-.46.264-.636l4.6-4.6a.9.9 0 111.273 1.272L8.474 10l3.963 3.964a.9.9 0 01-1.273 1.272l-4.6-4.6A.897.897 0 016.3 10Z':'M13.7 10c0 .23-.088.46-.264.636l-4.6 4.6a.9.9 0 11-1.273-1.272L11.526 10 7.563 6.036a.9.9 0 011.273-1.272l4.6 4.6A.897.897 0 0113.7 10Z');icon.append(path);control.append(icon,make('faceplate-screen-reader-content','',direction));tabs.append(control);}
      // The native tab group owns selection/keyboard styling. It can navigate
      // through Reddit's SPA router; archive authorization accepts these scopes.
      const panel=make('faceplate-tabpanel');panel.id='profile-feed-tabs';panel.setAttribute('pages','3');panel.setAttribute('pageindex',String(index));tabsContainer.append(tabs,panel);
      const feed=make('shreddit-feed','nd:visible');feed.dataset.rtArchiveFeed='true';
      this.archiveEmpty=make('p','rt-archive-empty text-14 text-neutral-content-weak',this.settings.archiveDiscovery?'':'Enable “Search Arctic Shift archive” in Reddit Tweaks to look up this username.');this.archiveEmpty.hidden=this.settings.archiveDiscovery;
      shell.append(header,tabsContainer,this.archiveEmpty,feed);columns.append(shell,this.archiveSidebar(context));subgrid.append(columns);layout.append(subgrid,this.navigationTarget());anchor.before(layout);notice.setAttribute('data-rt-archive-notice','true');return shell;
    }
    navigationTarget(){
      if(this.profileNavigation)return this.profileNavigation;
      const target=this.profileNavigation=make('div','contents');target.id='rt-nav-'+crypto.randomUUID();target.dataset.rtUi='profile-navigation';target.dataset.state='idle';const reserve=make('div','left-sidebar theme-rpl order-first hidden m:block');reserve.setAttribute('aria-hidden','true');target.append(reserve);return target;
    }
    navigationFallback(target){
      const left=make('flex-left-nav-container','left-sidebar theme-rpl isolate order-first hidden m:block border-0 border-solid s:border-e-sm border-e-neutral-border');left.id='left-sidebar-container';left.setAttribute('expanded','1');left.setAttribute('parent-grid-selector','.grid-container');
      const content=make('reddit-sidebar-nav','nd:visible block w-full h-screen-without-header styled-scrollbars overflow-y-scroll overflow-x-hidden bg-neutral-background box-border px-md overscroll-contain'),nav=make('nav','z-2 box-border flex flex-col mt-0 mb-0 pt-md shrink-0 s:shrink w-full min-h-screen-without-header select-none');nav.setAttribute('aria-label','Primary');
      const top=make('left-nav-top-section','block');for(const flag of ['home','popular','news','explore','is-desktop'])top.setAttribute(flag,'');top.setAttribute('selectedpagetype','unknown');
      // Native components replace these ordinary links once their modules load.
      // Navigation remains usable if the native shell request fails.
      for(const [name,path] of [['Home','/?feed=home'],['Popular','/r/popular/'],['News','/news/'],['Explore','/explore/']])top.append(link(name,path,'flex items-center px-md py-sm text-secondary-plain hover:bg-neutral-background-hover hover:no-underline s:rounded-2'));
      nav.append(top);content.append(nav);left.append(content);target.replaceChildren(left);
    }
    loadNavigation(){
      const target=this.profileNavigation;if(!target || ['ready','loading','failed'].includes(target.dataset.state))return;
      const generation=this.generation;target.dataset.state='loading';
      this.request({action:'render-navigation',username:this.context.username,target:target.id,navigationLease:this.navigationLease}).then(result=>{if(generation===this.generation){if(!result?.rendered)throw Error('Native navigation is unavailable.');target.dataset.state='ready';}}).catch(()=>{if(generation!==this.generation)return;target.dataset.state='failed';this.navigationFallback(target);const retry=button('Retry navigation',()=>{target.dataset.state='idle';this.loadNavigation();});retry.className='button button-small button-plain px-md';target.querySelector('nav').append(retry);});
    }
    archiveSidebar(context){
      const sidebar=make('aside','right-sidebar min-w-0 w-[316px] max-w-[316px] hidden xs:block styled-scrollbars xs:sticky xs:top-[56px] xs:max-h-screen-without-header xs:overflow-y-auto xs:overflow-x-hidden');sidebar.id='right-sidebar-container';
      const content=make('div','right-sidebar-contents flex-auto');content.id='right-sidebar-contents';const panel=make('section','bg-neutral-background-weak rounded-4');panel.setAttribute('aria-label','Archived profile information');const padding=make('div','p-md');padding.append(make('h2','inline-flex items-center m-0 text-headline text-neutral-content-strong font-bold truncate',context.username),make('p','text-12 text-neutral-content-weak','Archived public activity'));
      const stats=make('dl','grid grid-cols-2 gap-md mt-md');this.archiveStats={};for(const [key,label] of [['posts','Posts loaded'],['comments','Comments loaded'],['oldest','Oldest loaded'],['newest','Newest loaded']]){const item=make('div'),value=make('dd','m-0 text-14 font-semibold text-neutral-content-strong',key==='posts' || key==='comments'?'0':'—');item.append(value,make('dt','text-12 text-neutral-content-weak',label));stats.append(item);this.archiveStats[key]=value;}
      padding.append(stats,make('p','text-12 text-neutral-content-weak','Partial archive coverage. Counts and dates describe loaded records, not the complete account history.'),link('Arctic Shift','https://arctic-shift.photon-reddit.com/','text-12 hover:underline'));panel.append(padding);content.append(panel);sidebar.append(content);return sidebar;
    }
    clearActivityMenu(){
      if(this.activityMain && this.openSubmenu)this.activityMain.classList.remove('hidden');
      // Native rows return; mark the menu handled so the pre-hide never applies.
      this.activityMain?.setAttribute('data-rt-menu-ready','');
      this.activityMenuObserver?.disconnect();if(this.activityDropdown && this.activityKeydown)this.activityDropdown.removeEventListener('keydown',this.activityKeydown,true);
      // Return Reddit's own rows to their original places.
      for(const group of this.menuGroups || []){for(const item of group.items)group.anchor.before(item);if(group.header)group.header.hidden=group.headerHidden;group.anchor.remove();}
      this.menuGroups=[];
      for(const row of this.activityMenuRows || [])row.remove();this.activityMenuRows=[];this.host?.removeAttribute('data-rt-menu-ready');this.rtMenu=null;this.rtPickerHost?.remove();this.activityMenu=null;this.activityMain=null;this.activityDropdown=null;this.activityOpen=false;this.openSubmenu=null;
    }
    detachActivityMenu(){
      // Leave the menu as it is in the parked view; only drop live references.
      this.activityMenuObserver?.disconnect();this.activityMenuObserver=null;this.menuGroups=[];this.activityMenuRows=[];this.activityMenu=this.activityMain=this.activityDropdown=null;this.activityOpen=false;this.openSubmenu=null;this.controlsTarget=null;
    }
    ensureActivityMenu(){
      if(this.context?.kind!=='profile' || !this.toolbar)return;
      const main=this.feed?.closest('main'),dropdown=this.findDropdown(main);
      const menu=dropdown?.querySelector('.main-menu-container') || dropdown?.querySelector('rpl-menu');
      if(dropdown && this.controlsTarget?.isConnected && !this.controlsTarget.contains(dropdown)){this.controlsTarget.remove();this.controlsTarget=null;}
      if(!menu){
        if(!this.autoDiscover || this.controlsTarget?.isConnected)return;
        const target=this.controlsTarget=make('div','flex items-center gap-xs my-md');target.id='rt-controls-'+crypto.randomUUID();target.dataset.rtUi='profile-controls';
        const sort=this.context.view==='comments'?main?.querySelector('shreddit-sort-dropdown'):null,view=main?.querySelector('[aria-label="View"],[data-testid="feed-view-toggle"],shreddit-layout-switcher');if(sort){target.className='contents';sort.before(target);}else if(view && !view.closest('shreddit-feed')){target.className='contents';view.after(target);}else this.host.before(target);
        const generation=this.generation;this.request({action:'render-controls',username:this.context.username,target:target.id}).then(result=>{if(generation!==this.generation)return;if(!result?.rendered)throw Error('Native controls are not ready.');this.ensureActivityMenu();}).catch(()=>{if(generation!==this.generation)return;const retry=button('Retry feed options',()=>{target.remove();this.controlsTarget=null;this.ensureActivityMenu();});retry.className='button button-small button-plain';target.replaceChildren(retry);});return;
      }
      if(this.context.view==='comments'){const sort=main?.querySelector('shreddit-sort-dropdown');if(this.commentSort && this.commentSort.node!==sort){this.commentSort.node.hidden=this.commentSort.hidden;this.commentSort.node.removeAttribute('data-rt-comment-sort-suppressed');this.commentSort=null;}if(sort && !this.commentSort){this.commentSort={node:sort,hidden:sort.hidden};sort.hidden=true;sort.dataset.rtCommentSortSuppressed='true';}}
      // Our fetched copy of Reddit's control (Comments, unavailable accounts)
      // doesn't get Reddit's popover positioning, so the open menu painted
      // under the feed. Lift it, keeping its static position.
      if(this.controlsTarget?.contains(dropdown) && dropdown.shadowRoot && ![...this.nativeLoadingStyles].some(style=>style.parentNode===dropdown.shadowRoot)){const style=make('style');style.dataset.rtUi='controls-style';style.textContent='#hovercard{position:absolute!important;z-index:20!important}';dropdown.shadowRoot.append(style);this.nativeLoadingStyles.add(style);}
      if(this.activityMain!==menu){
        this.clearActivityMenu();this.activityMain=menu;this.activityDropdown=dropdown;
        const content=menu.parentElement,subs=[];
        const row=(label,icon,tail)=>{const el=make('rpl-menu-item','cursor-pointer'),body=make('div','flex justify-between items-center w-full'),caption=make('div','flex items-center gap-xs');for(const [k,v] of Object.entries({size:'medium',appearance:'default',truncate:'both','aria-label':label,'prevent-auto-close':''}))el.setAttribute(k,v);caption.append(typeof icon==='string'?glyph(icon):icon,document.createTextNode(label));body.append(caption);if(tail)body.append(glyph(tail));el.tabIndex=-1;el.append(body);return el;};
        const activate=(el,fn)=>{el.addEventListener('click',fn);el.addEventListener('keydown',event=>{if(event.key==='Enter' || event.key===' '){event.preventDefault();event.stopImmediatePropagation();fn(event);}},true);};
        const submenu=()=>{const el=make('rpl-menu','rt-activity-submenu hidden');el.dataset.rtUi='activity-filter-option';el.setAttribute('wrap','');el.setAttribute('role','menu');subs.push(el);return el;};
        // Top-style navigation: one submenu open at a time, inside the same dropdown.
        const open=target=>{this.openSubmenu=target || null;this.activityOpen=target===this.activityMenu;menu.classList.toggle('hidden',Boolean(target));for(const sub of subs)sub.classList.toggle('hidden',sub!==target);for(const entry of this.activityMenuRows)if(entry.matches?.('rpl-menu-item'))entry.setAttribute('aria-expanded',String(entry.rtSubmenu===target));(target?target.querySelector('rpl-menu-item'):this.lastSubmenuRow)?.focus({preventScroll:true});};
        const entry=(label,icon,sub)=>{const el=row(label,icon,'chevron-right');el.setAttribute('aria-haspopup','menu');el.rtSubmenu=sub;const value=make('span','text-12 text-neutral-content-weak ms-auto me-xs');value.dataset.rtMenuValue='true';el.firstElementChild.insertBefore(value,el.firstElementChild.lastElementChild);activate(el,()=>{this.lastSubmenuRow=el;open(sub);el.rtOnOpen?.();});const back=row('Back','arrow-back');activate(back,()=>open(null));sub.append(back);return el;};
        this.activityMenuRows=[];
        // Group Reddit's own sections (sort, view) into Top-style submenus so the
        // menu stays short. Its rows move (keeping their handlers) and are put back on teardown.
        const groups=[];let current=null;
        for(const node of [...menu.children]){if(node.dataset?.rtUi)continue;if(node.matches('rpl-menu-item')){if(!current)groups.push(current={header:null,items:[]});current.items.push(node);}else if(node.tagName==='DIV')groups.push(current={header:node,items:[]});}
        const native=groups.filter(group=>group.items.length);
        // Comments has no View section, so its single Sort group is grouped too.
        if(native.length>=(this.context.view==='comments'?1:2))for(const [index,group] of native.entries()){
          const label=index===0?'Sort':group.header?.textContent.trim() || 'View',sub=submenu(),anchor=document.createComment('rt-menu-group');group.items[0].before(anchor);
          const el=entry(label,'activity',sub);el.dataset.rtUi='menu-group';anchor.before(el);for(const item of group.items)sub.append(item);content.append(sub);
          if(index>0 && group.header){group.headerHidden=group.header.hidden;group.header.hidden=true;}
          this.menuGroups.push({...group,anchor,row:el,sub});this.activityMenuRows.push(el,sub);
        }
        const sub=this.activityMenu=submenu(),activity=entry('Activity','activity',sub);activity.dataset.rtActivity='true';activity.dataset.rtUi='activity-filter-option';activity.querySelector('[data-rt-menu-value]').dataset.rtActivityValue='true';menu.append(activity);
        for(const [value,label,icon] of [['all','All activity','activity'],['hidden','Hidden','hidden'],['deleted','Deleted','deleted']]){const option=row(label,icon);option.dataset.rtActivityFilter=value;activate(option,()=>{if(this.activityFilter!==value){this.activityFilter=value;this.activeProfileBatch=null;this.nativeBatch.queue=this.nativeBatch.queue.filter(node=>{const post=this.postMetadata.get(node.dataset.key);if(post && this.eligibleProfilePost(post,node))return true;node.dataset.rtNativeState='idle';delete node.dataset.rtQualify;return false;});}if(value!=='all' && !this.archiveOnly)this.verifyArchiveStatuses([...this.archived.values()].filter(post=>post.source==='arctic-shift'));this.syncActivityPresentation();this.ensureActivityMenu();this.deduplicate();open(null);dropdown.removeAttribute('open');dropdown.querySelector('button[aria-label="Feed options"]')?.focus({preventScroll:true});this.ensureActivityArchive();if(this.batchedProfile)this.advanceProfileBatch(true);});sub.append(option);}
        // Refresh sits at the end of the Activity submenu.
        const divider=make('div','my-xs border-0 border-t-sm border-solid border-neutral-border-weak');divider.setAttribute('role','separator');
        const refresh=row('Refresh activity','refresh');refresh.dataset.rtUi='activity-refresh';activate(refresh,()=>{open(null);dropdown.removeAttribute('open');dropdown.querySelector('button[aria-label="Feed options"]')?.focus({preventScroll:true});if(!this.discover.disabled)this.discover.click();});sub.append(divider,refresh);
        content.append(sub);this.activityMenuRows.push(activity,sub);this.buildFilterMenu({row,activate,submenu,entry,open,content,menu,dropdown});this.host?.setAttribute('data-rt-menu-ready','');menu.setAttribute('data-rt-menu-ready','');
        this.activityKeydown=event=>{if(event.key==='Escape' && this.openSubmenu){event.preventDefault();event.stopImmediatePropagation();open(null);}};dropdown.addEventListener('keydown',this.activityKeydown,true);
        // Close ours when the dropdown closes, or when Reddit opens its own submenu (Top) from ours.
        this.activityMenuObserver=new MutationObserver(()=>{if(!this.openSubmenu)return;const nativeOpen=[...content.children].some(node=>node!==menu && !subs.includes(node) && node.matches('rpl-menu') && !node.classList.contains('hidden'));if(!dropdown.hasAttribute('open'))open(null);else if(nativeOpen){this.openSubmenu.classList.add('hidden');this.openSubmenu=null;this.activityOpen=false;}});
        this.activityMenuObserver.observe(dropdown,{attributes:true,attributeFilter:['open','class'],subtree:true});
      }
      // Current choice beside each group row (from Reddit's checkmarks) and its icon.
      for(const group of this.menuGroups || []){const checked=group.items.find(item=>item.querySelector('svg[icon-name="checkmark"],[icon-name="checkmark"]') || item.getAttribute('aria-checked')==='true' || item.matches('[aria-current="true"],[aria-current="page"]'));const label=checked?.getAttribute('aria-label') || '';const value=group.row.querySelector('[data-rt-menu-value]');if(value.textContent!==label)value.textContent=label;const icon=checked?.querySelector('svg[icon-name]');const caption=group.row.firstElementChild.firstElementChild;if(icon && caption.firstElementChild?.getAttribute('icon-name')!==icon.getAttribute('icon-name')){const copy=icon.cloneNode(true);copy.removeAttribute('id');caption.firstElementChild.replaceWith(copy);}}
      const value=this.activityMain?.querySelector('[data-rt-activity-value]'),labels={all:'All',hidden:'Hidden',deleted:'Deleted'};if(value && value.textContent!==labels[this.activityFilter])value.textContent=labels[this.activityFilter];
      for(const row of this.activityMenu.querySelectorAll('[data-rt-activity-filter]')){const checked=row.dataset.rtActivityFilter===this.activityFilter;if(row.getAttribute('aria-current')!==String(checked))row.setAttribute('aria-current',String(checked));let mark=row.querySelector('[data-rt-check]');if(checked && !mark){mark=glyph('checkmark');mark.dataset.rtCheck='true';row.firstElementChild.append(mark);}else if(!checked)mark?.remove();}
      this.syncFilterMenu();
    }
    // Feed filters: date, post type, subreddit and the archive-backed Old sort. State lives in
    // rt_* URL params; context.key ignores them, so changing a filter never resets discovery.
    rtActive(){const f=globalThis.RTFeedFilters;return Boolean(f && this.rtFilters && f.isActive(this.rtFilters));}
    archiveQueryOn(){return this.rtActive() && Boolean(globalThis.RTArchiveQuery?.search) && Boolean(this.settings.archiveDiscovery);}
    oldSort(){return this.rtActive() && this.rtFilters.sort==='old' && this.archiveQueryOn();}
    // Filtered archive pages are placed by date among Reddit's cards instead of waiting for a shared frontier.
    freeMerge(){return this.oldSort() || this.archiveQueryOn() && (this.context?.sort==='new' || this.archiveOnly);}
    rtPredicate(){const f=globalThis.RTFeedFilters,sig=JSON.stringify(f.serialize(this.rtFilters))+':'+Math.floor(Date.now()/60000);if(this.rtPred?.sig!==sig)this.rtPred={sig,fn:f.predicate(this.rtFilters)};return this.rtPred.fn;}
    filterItem(post){const f=globalThis.RTFeedFilters,key=itemKey(post),source=[this.archived.get(key),this.live.get(key)].find(item=>item?.postType) || post;return {created:post.created,kind:post.kind,subreddit:post.subreddit,postType:post.kind==='comment'?'':f.inferType(source)};}
    filterMatch(post){return !this.rtActive() || this.rtPredicate()(this.filterItem(post));}
    nativeItem(native,entry){
      const kind=native?.matches?.('shreddit-profile-comment')?'comment':'post',href=native?.querySelector?.('a[href^="/r/"]')?.getAttribute('href') || '';
      return {kind,created:entry.timestamp,subreddit:native?.getAttribute('subreddit-name') || native?.getAttribute('subreddit-prefixed-name') || href.match(/^\/r\/([^/]+)/)?.[1] || '',postType:kind==='comment'?'':native?.getAttribute('post-type') || ''};
    }
    syncFiltersFromUrl(){
      const f=globalThis.RTFeedFilters;if(!f || this.context?.kind!=='profile' || this.rtSearch===location.search)return;
      this.rtSearch=location.search;const next=f.read(location);if(!f.equal(next,this.rtFilters || f.empty()))this.setFilters(next,{write:false});
    }
    setFilters(next,{write=true}={}){
      const f=globalThis.RTFeedFilters;if(!f || this.context?.kind!=='profile')return;
      next=f.clone(next);next.subreddits=next.subreddits.slice(0,f.maxSubreddits);const prev=this.rtFilters || f.empty();if(f.equal(prev,next))return;
      this.rtFilters=next;this.rtPred=null;if(write){f.write(next);}this.rtSearch=location.search;this.applyFilters(prev);
    }
    applyFilters(prev){
      const f=globalThis.RTFeedFilters;this.renderFilterChips();if(this.rtAgg && this.rtAgg.key!==this.aggKey())this.rtAgg=null;this.syncFilterMenu();this.renderSubredditOptions();
      if(!this.host?.isConnected)return;
      const generation=this.generation;
      // A changed archive query (date window, subreddit, direction) starts a fresh archive stream; what is loaded stays.
      if((this.archiveSig!==undefined || this.oldSort()) && this.archiveSigNow()!==this.archiveSig && this.settings.archiveDiscovery){
        this.beforeByKind={};this.archiveMore={};this.moreArchive=false;if(this.sourceNotices)delete this.sourceNotices.searched;for(const kind of this.kinds())this.sourceFrontiers.delete('archive-'+kind);
        if(this.archiveOnly || this.freeMerge() || this.context.sort==='new' || this.activityFilter==='deleted'){const go=()=>{if(generation===this.generation)this.loadArchive();};if(this.archiveBusy)this.archiveRun.then(go,go);else go();}
      }
      if(prev.sort==='old' && !this.rtFilters.sort && !this.loaded && !this.busy && !this.archiveOnly)this.loadReddit();
      this.activeProfileBatch=null;this.nativeBatch.queue=this.nativeBatch.queue.filter(node=>{const post=this.postMetadata.get(node.dataset.key);if(post && this.eligibleProfilePost(post,node))return true;node.dataset.rtNativeState='idle';delete node.dataset.rtQualify;return false;});
      this.render({reuseCards:true});
    }
    renderFilterChips(){
      const f=globalThis.RTFeedFilters;if(!f || !this.rtChips)return;
      const shown={...(this.rtFilters || f.empty())};if(!this.oldSort())shown.sort=null;
      f.renderChips(this.rtChips,shown,{make,glyph,onChange:next=>this.setFilters(shown.sort?next:{...next,sort:this.rtFilters?.sort ?? null})});
    }
    archiveSigNow(){
      if(!this.archiveQueryOn())return 'legacy';const f=globalThis.RTFeedFilters,s=f.serialize(this.rtFilters);
      return JSON.stringify([this.oldSort()?'asc':'desc',s.rt_date || '',this.rtFilters.subreddits.length===1?this.rtFilters.subreddits[0].toLowerCase():'',this.rtFilters.types.join(',')]);
    }
    // One archive page. Unfiltered views use the established action; filters use RTArchiveQuery.search
    // (date window and a single subreddit are sent to the server, post type is always matched locally).
    async archiveFetch(kind,more){
      const Q=this.archiveQueryOn()?globalThis.RTArchiveQuery:null,cursor=more?this.beforeByKind[kind]:null;
      if(!Q)return this.archive({action:'archive-profile',username:this.context.username,kind,...(cursor?{before:cursor}:{}),...(this.archiveForceUntil>Date.now()?{force:true}:{})});
      const f=globalThis.RTFeedFilters,state=this.rtFilters,range=f.dateRange(state),old=this.oldSort(),controller=new AbortController();this.controllers.add(controller);
      const args={kind,author:this.context.username,sort:old?'asc':'desc',maxPages:1,signal:controller.signal};
      if(range?.after!=null)args.after=range.after;if(range?.before!=null)args.before=range.before;if(cursor!=null)args.cursor=cursor;
      if(state.subreddits.length===1)args.subreddit=state.subreddits[0];if(kind==='post' && state.types.length)args.postTypes=[...state.types];
      try{
        // search() is an async generator of pages; one page per call, the page cursor continues it.
        let page=null;for await(const next of Q.search(args)){page=next;break;}
        if(!page)return {posts:[],normalized:true,before:cursor,hasMore:false,cursorStalled:false};
        const back=Number(page.searchedBackTo),seconds=Number.isFinite(back)?(back>1e11?Math.floor(back/1000):back):null;
        return {posts:Array.isArray(page.items)?page.items:[],normalized:true,before:page.cursor ?? null,hasMore:Boolean(page.hasMore),cursorStalled:Boolean(page.stalled),searchedBackTo:seconds,serverFiltered:Boolean(page.serverFiltered)};
      }finally{this.controllers.delete(controller);}
    }
    // A filtered archive result is a search window, never a complete history.
    noteSearched(result){
      if(!this.sourceNotices)return;
      if(this.archiveQueryOn() && result.hasMore && result.searchedBackTo!=null){const date=new Date(result.searchedBackTo*1000).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});this.sourceNotices.searched=(this.oldSort()?'Searched up to ':'Searched back to ')+date;}
      else delete this.sourceNotices.searched;
    }
    aggKey(){return JSON.stringify([this.context?.username,this.kinds(),globalThis.RTFeedFilters.serialize(this.rtFilters || globalThis.RTFeedFilters.empty()).rt_date || '']);}
    // Everything loaded so far, once per item, for the counts fallback.
    loadedItems(){
      const out=new Map();
      for(const post of [...this.archived.values(),...this.live.values()])out.set(post.fullname,{fullname:post.fullname,subreddit:post.subreddit});
      for(const entry of this.nativeEntries()){if(out.has(entry.fullname))continue;const slot=this.virtualNodes.get(entry.node) || entry.node,native=slot.matches('shreddit-post,shreddit-profile-comment')?slot:slot.querySelector('shreddit-post,shreddit-profile-comment');out.set(entry.fullname,{fullname:entry.fullname,subreddit:this.nativeItem(native,entry).subreddit});}
      return [...out.values()];
    }
    subredditCounts(){
      const f=globalThis.RTFeedFilters,loaded=this.loadedItems();
      if(this.rtAgg?.state==='ok')return {source:'archive',entries:f.mergeCounts(this.rtAgg.buckets,loaded.filter(item=>!this.archived.has(item.fullname)))};
      return {source:'loaded',entries:f.mergeCounts([],loaded)};
    }
    // Counts come from the archive's aggregate; if it is unavailable or slow, loaded items stand in.
    loadSubredditCounts(){
      const Q=globalThis.RTArchiveQuery;if(!Q?.aggregate || !this.settings.archiveDiscovery){this.renderSubredditOptions();return;}
      const key=this.aggKey();if(this.rtAgg?.key===key)return;
      const entry=this.rtAgg={key,state:'loading',buckets:[]},generation=this.generation,range=globalThis.RTFeedFilters.dateRange(this.rtFilters || globalThis.RTFeedFilters.empty());
      const query=kind=>Q.aggregate({kind,author:this.context.username,by:'subreddit',...(range?.after!=null?{after:range.after}:{}),...(range?.before!=null?{before:range.before}:{})});
      let timer;const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('timeout')),8000);});
      Promise.race([Promise.all(this.kinds().map(query)),timeout]).then(results=>{if(!results.every(result=>result?.ok===true))throw Error('unavailable');entry.buckets=results.flatMap(result=>result.buckets || []);entry.state='ok';}).catch(()=>{entry.state='failed';}).finally(()=>{clearTimeout(timer);if(generation===this.generation && this.rtAgg===entry)this.renderSubredditOptions();});
      this.renderSubredditOptions();
    }
    renderSubredditOptions(){
      const m=this.rtMenu,f=globalThis.RTFeedFilters;if(!m?.sub || !f)return;
      const {list,note,input,fx}=m.sub,picked=this.rtFilters?.subreddits || [],term=f.subName(input.value).toLowerCase(),{source,entries}=this.subredditCounts();
      const pickedKeys=new Set(picked.map(name=>name.toLowerCase())),byKey=new Map(entries.map(entry=>[entry.key.toLowerCase(),entry]));
      const rows=[...picked.map(name=>byKey.get(name.toLowerCase()) || {key:name,count:0}),...entries.filter(entry=>!pickedKeys.has(entry.key.toLowerCase()) && (!term || entry.key.toLowerCase().includes(term)))].slice(0,60);
      list.replaceChildren();
      for(const entry of rows){
        const checked=pickedKeys.has(entry.key.toLowerCase()),el=f.menuOption(fx,{label:'r/'+entry.key,subtitle:entry.count?String(entry.count):'',icon:'community',checked,value:entry.key,onSelect:()=>{
          const next=f.clone(this.rtFilters || f.empty()),has=next.subreddits.findIndex(name=>name.toLowerCase()===entry.key.toLowerCase());
          if(has>=0)next.subreddits.splice(has,1);else if(next.subreddits.length<f.maxSubreddits)next.subreddits.push(entry.key);else return;this.setFilters(next);}});
        el.dataset.rtUi='filter-option';list.append(el);
      }
      const text=this.rtAgg?.state==='loading'?'Loading counts…':source==='archive'?'Counts from the archive and loaded items':'Counts from loaded items';
      const full=picked.length>=f.maxSubreddits?' · Up to '+f.maxSubreddits+' communities':'';if(note.textContent!==text+full)note.textContent=text+full;
    }
    syncFilterMenu(){
      const m=this.rtMenu,f=globalThis.RTFeedFilters;if(!m || !f)return;const state=this.rtFilters || f.empty(),fx=m.fx;
      const set=(el,on)=>el && f.markChecked(fx,el,on);
      set(m.date.get('any'),!state.date);for(const preset of f.presets)set(m.date.get(preset.id),state.date?.preset===preset.id);set(m.date.get('custom'),Boolean(state.date && !state.date.preset));
      set(m.all,!state.types.length);for(const [type,el] of m.types)set(el,state.types.includes(type));
      set(m.old,this.oldSort());
      const value=(group,text)=>{const el=(group?.el || group?.row)?.querySelector('[data-rt-menu-value]');if(el && el.textContent!==text)el.textContent=text;};
      value(m.groups.date,f.dateLabel(state.date));value(m.groups.type,state.types.length>1?state.types.length+' types':state.types.length?f.typeLabels[state.types[0]]:'');value(m.groups.sub,state.subreddits.length>1?state.subreddits.length+' communities':state.subreddits.length?'r/'+state.subreddits[0]:'');
      const sort=this.menuGroups?.[0];if(sort){sort.sub.toggleAttribute('data-rt-sort-old',this.oldSort());if(this.oldSort())value(sort,'Old');}
    }
    buildFilterMenu({row,activate,submenu,entry,open,content,menu,dropdown}){
      const f=globalThis.RTFeedFilters;this.rtMenu=null;if(!f)return;
      const fx={row,activate,glyph},current=()=>f.clone(this.rtFilters || f.empty()),m=this.rtMenu={fx,date:new Map(),types:new Map(),groups:{},sub:null,old:null,all:null};
      const close=()=>{open(null);dropdown.removeAttribute('open');dropdown.querySelector('button[aria-label="Feed options"]')?.focus({preventScroll:true});};
      const option=(parent,options)=>{const el=f.menuOption(fx,options);el.dataset.rtUi='filter-option';parent.append(el);return el;};
      const group=(label,icon,onOpen)=>{const sub=submenu(),el=entry(label,icon,sub);el.dataset.rtUi='filter-group';el.dataset.rtFilterGroup=label;if(onOpen)el.rtOnOpen=onOpen;content.append(sub);menu.append(el);this.activityMenuRows.push(el,sub);return {el,sub};};
      // Old goes into Reddit's own Sort group. It needs the archive, so it is only offered when that can answer.
      const sortGroup=this.menuGroups?.[0];
      if(sortGroup && globalThis.RTArchiveQuery?.search && this.settings.archiveDiscovery){
        m.old=option(sortGroup.sub,{label:'Old',subtitle:'From the archive',icon:'archive',value:'old',onSelect:()=>{const next=current();next.sort=next.sort==='old'?null:'old';this.setFilters(next);close();}});
        for(const item of sortGroup.items)if(!item.rtSortHook){item.rtSortHook=()=>{if(this.rtFilters?.sort==='old'){const next=current();next.sort=null;this.setFilters(next);}};item.addEventListener('click',item.rtSortHook);}
      }
      const date=m.groups.date=group('Date','calendar');
      m.date.set('any',option(date.sub,{label:'Any time',icon:'calendar',value:'any',onSelect:()=>{const next=current();next.date=null;this.setFilters(next);close();}}));
      for(const preset of f.presets)m.date.set(preset.id,option(date.sub,{label:preset.label,icon:'calendar',value:preset.id,onSelect:()=>{const next=current();next.date=next.date?.preset===preset.id?null:{preset:preset.id};this.setFilters(next);close();}}));
      m.date.set('custom',option(date.sub,{label:'Custom…',icon:'calendar',value:'custom',onSelect:()=>{close();this.openDatePicker(dropdown);}}));
      if(this.context.view!=='comments'){
        const type=m.groups.type=group('Post type','posttype');
        m.all=option(type.sub,{label:'All',icon:'posttype',value:'all',onSelect:()=>{const next=current();next.types=[];this.setFilters(next);}});
        for(const name of f.types)m.types.set(name,option(type.sub,{label:f.typeLabels[name],icon:'posttype',value:name,onSelect:()=>{const next=current();next.types=next.types.includes(name)?next.types.filter(x=>x!==name):[...next.types,name];this.setFilters(next);}}));
      }
      const community=m.groups.sub=group('Subreddit','community',()=>this.loadSubredditCounts());
      const input=make('input','rt-filter-search'),box=make('div','rt-filter-search-box'),list=make('div'),note=make('div','rt-filter-note text-12 text-neutral-content-weak');
      input.type='search';input.placeholder='Search communities';input.setAttribute('aria-label','Search communities');input.autocomplete='off';
      // Typing must not trigger the menu's own keyboard handling.
      input.addEventListener('keydown',event=>{if(event.key!=='Escape')event.stopPropagation();});input.addEventListener('input',()=>this.renderSubredditOptions());
      for(const el of [box,list,note])el.dataset.rtUi='filter-option';box.append(input);community.sub.append(box,list,note);m.sub={input,list,note,fx};
      this.renderSubredditOptions();
    }
    // Calendar for Custom…: Reddit Tweaks' own date picker in a shadow root over the page.
    openDatePicker(dropdown){
      const Picker=globalThis.RCSDatePicker;if(!Picker)return;
      this.rtPickerHost?.remove();const host=this.rtPickerHost=make('div');host.dataset.rtUi='date-picker';
      const button=dropdown?.querySelector('button[aria-label="Feed options"]'),anchor=button?.getBoundingClientRect?.() || {left:0,bottom:0};
      host.style.cssText=`position:fixed;z-index:2147483000;pointer-events:none;width:0;height:0;left:${Math.max(0,Math.round(anchor.left))}px;top:${Math.max(0,Math.round(anchor.bottom))}px`;
      const shadow=host.attachShadow({mode:'open'}),style=make('style','',`:host{--rcs-bg:var(--color-neutral-background,#fff);--rcs-soft:var(--color-neutral-background-weak,#f2f4f5);--rcs-text:var(--color-neutral-content-strong,#0f1a1c);--rcs-muted:var(--color-neutral-content-weak,#576f76);--rcs-line:var(--color-neutral-border-weak,#e5e8eb);--rcs-hover:var(--color-neutral-background-hover,#e8edef);--rcs-accent:#ff4500}.date-popover{pointer-events:auto;left:0;right:auto;top:4px}`+(Picker.styles || ''));
      const away=event=>{if(!event.composedPath().includes(host))picker.close(false);};
      const picker=new Picker({getAnchor:()=>anchor,onChange:(bounds)=>{
        const today=new Date(),iso=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`,from=bounds.from || '2005-06-01',to=bounds.to || iso,next=globalThis.RTFeedFilters.clone(this.rtFilters || globalThis.RTFeedFilters.empty());
        next.date={from:from<=to?from:to,to:from<=to?to:from};this.setFilters(next);},onClose:()=>{document.removeEventListener('pointerdown',away,true);host.remove();button?.focus?.({preventScroll:true});}});
      const date=this.rtFilters?.date;if(date?.from)picker.applied={mode:'Between',start:date.from,end:date.to};
      shadow.append(style,picker.element);document.body.append(host);picker.show();document.addEventListener('pointerdown',away,true);
    }
    ensureActivityArchive(){
      if(this.activityFilter!=='deleted' || !this.settings.archiveDiscovery || this.archiveLoaded || this.activityArchiveAttempted || this.archiveBusy)return;
      this.activityArchiveAttempted=true;this.loadArchive();
    }
    updateActivityEmptyState(){
      if(!this.feed || this.activityFilter==='all' && !this.rtActive()){if(this.activityEmpty)this.activityEmpty.hidden=true;return;}
      const nativeMatches=this.nativeEntries().some(e=>!e.node.hidden && !e.node.hasAttribute('data-rt-filter-hidden'));
      const ownMatches=[...this.nodes.values()].some(n=>!n.hidden && (this.feedSlot(n).parentElement===this.feed));
      const working=this.waitingRetries().length || this.busy || this.archiveBusy || this.activeProfileBatch || this.metadataPending || this.recoveryActive || this.nativeBatch.active || this.nativeBatch.queue.length || this.nativeFeedLoading();
      const errors=Object.values(this.sourceErrors || {}).some(Boolean) || this.status?.dataset.error==='true';
      const show=!nativeMatches && !ownMatches && !working && !errors && !this.hasMoreProfile() && (this.loaded || this.archiveLoaded);
      if(!show){if(this.activityEmpty)this.activityEmpty.hidden=true;return;}
      if(!this.activityEmpty){const empty=this.activityEmpty=make('div','mt-[100px] flex justify-center items-center flex-col');empty.dataset.rtUi='activity-empty';empty.setAttribute('role','status');
        // Reddit's native rpl empty-state structure; a separate identity keeps the
        // profile privacy-notice guard from capturing this adapted presentation.
        const root=make('div','flex flex-col items-center w-full');root.setAttribute('rpl','');const creative=make('div','w-full flex flex-col items-center overflow-hidden box-border');creative.dataset.testid='empty-state-creative';const image=make('img','mb-0 mt-lg mb-lg');image.src='https://www.redditstatic.com/shreddit/assets/snoo_wave.png';image.alt='Image of a Snoo waving';image.width=128;image.loading='lazy';creative.append(image);
        const body=make('div','flex flex-col w-full items-center box-border px-md gap-md pb-md'),copy=make('div','max-w-[480px] flex flex-col items-center text-center');this.emptyTitle=make('div','text-title-2 text-neutral-content-strong');this.emptyTitle.setAttribute('role','heading');this.emptyTitle.setAttribute('aria-level','2');copy.append(this.emptyTitle,make('div','text-body-1 text-neutral-content-weak','In loaded activity. Search and archive coverage may be incomplete.'));body.append(copy);root.append(creative,body);empty.append(root);const template=globalThis.RTProfileNoticeGuard?.emptyTemplate?.() || this.emptyFeed?.cloneNode(true);if(template?.querySelector('[data-testid="empty-state-creative"]') && template.querySelector('[role="heading"],h2')){empty.className=template.className;empty.replaceChildren(...template.childNodes);for(const child of empty.querySelectorAll('[id]'))child.removeAttribute('id');this.emptyTitle=empty.querySelector('[role="heading"],h2');const description=empty.querySelector('.text-body-1');if(description)description.textContent='In loaded activity. Search and archive coverage may be incomplete.';}this.feed.before(empty);}
      const noun=this.context.view==='comments'?'comments':this.context.view==='posts'?'posts':'posts or comments';const text='No '+(this.activityFilter==='all'?'':this.activityFilter+' ')+noun+' found';if(this.emptyTitle.textContent!==text)this.emptyTitle.textContent=text;this.activityEmpty.hidden=false;
    }
    nativeRestrictions(native){const over18=Boolean(native?.matches('[nsfw],[is-nsfw],[over-18]')),spoiler=Boolean(native?.hasAttribute('spoiler'));return {over18,spoiler,restricted:over18 || spoiler || Boolean(native?.querySelector('shreddit-content-gate,[slot="nsfw-blocker"]'))};}
    recoveryInView(node){
      if(!node)return false;const slot=this.feedSlot(node);if(!slot.isConnected || slot.hidden || slot.hasAttribute('data-rt-filter-hidden'))return false;
      const rect=slot.getBoundingClientRect();if(rect.bottom>=0 && rect.top<=innerHeight+200)return true;
      if(typeof IntersectionObserver==='function'){if(!this.recoveryObserver)this.recoveryObserver=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting))this.scheduleRecovery();},{rootMargin:'200px'});if(!this.recoveryObserved.has(slot)){this.recoveryObserved.add(slot);this.recoveryObserver.observe(slot);}}return false;
    }
    scheduleRecovery(){
      if(this.context?.kind!=='profile' || !this.settings.archiveDiscovery || !this.settings.restoreDeletedContent || this.archiveOnly || this.recoveryTimer || this.recoveryActive || this.sourceRetries?.get('recovery')?.timer)return;
      const candidates=new Map();
      for(const post of this.renderedPosts || [])if(this.recoveryInView(this.nodes.get(itemKey(post))) && ['deleted','removed'].includes(this.verifiedStatus(post,this.nodes.get(itemKey(post))?.querySelector('shreddit-post,shreddit-profile-comment'))) && !post.archivedBody && !this.archived.has(itemKey(post)) && !this.recoveryChecked.has(post.fullname))candidates.set(post.fullname,{id:post.id,node:this.nodes.get(itemKey(post)),kind:post.kind==='comment'?'comment':'post',status:this.verifiedStatus(post,this.nodes.get(itemKey(post))?.querySelector('shreddit-post,shreddit-profile-comment'))});
      for(const entry of this.nativeEntries()){const original=this.virtualNodes.get(entry.node) || entry.node,native=original.matches('shreddit-post,shreddit-profile-comment')?original:original.querySelector('shreddit-post,shreddit-profile-comment'),kind=native?.matches('shreddit-profile-comment')?'comment':'post',status=this.verifiedStatus({fullname:entry.fullname,kind,status:'unknown'},native);if(this.recoveryInView(entry.node) && ['deleted','removed'].includes(status) && !this.recoveryChecked.has(entry.fullname) && !this.archived.has(kind==='comment'?entry.fullname:entry.fullname?.replace(/^t3_/,'')))candidates.set(entry.fullname,{id:entry.fullname?.replace(/^t[13]_/,''),kind,status,node:entry.node});}
      if(!candidates.size)return;
      const generation=this.generation,context=this.context;this.recoveryTimer=setTimeout(async()=>{this.recoveryTimer=null;if(generation!==this.generation)return;this.recoveryActive=true;this.updateProfileLoading();
        const current=()=>generation===this.generation && pageRoute()?.key===context.key && this.settings.archiveDiscovery && this.settings.restoreDeletedContent;
        // Ids count as checked only once the archive has answered; a failed request leaves them for the retry.
        let group=[];
        try{for(const kind of ['post','comment']){group=[...candidates.entries()].filter(([,p])=>p.kind===kind && this.recoveryInView(p.node)).slice(0,25);if(!group.length)continue;const result=await this.archive({action:'archive-recover',username:context.username,kind,ids:group.map(([,p])=>p.id)});if(!current())return;for(const [id] of group)this.recoveryChecked.add(id);this.clearSourceRetries(name=>name==='recovery');for(const raw of result.posts || []){const archived=M.normalizeItem(raw,{source:'arctic-shift'});if(!archived || archived.author.toLowerCase()!==context.username.toLowerCase())continue;const proof=candidates.get(archived.fullname);if(!proof)continue;if(!this.archived.has(itemKey(archived)))this.recoveredKeys.add(itemKey(archived));this.archived.set(itemKey(archived),archived);const existing=this.live.get(itemKey(archived));const restrictions=this.nativeRestrictions(proof.native || proof.node?.querySelector('shreddit-post,shreddit-profile-comment') || proof.node);this.live.set(itemKey(archived),{...archived,...existing,over18:archived.over18 || existing?.over18 || restrictions.over18,spoiler:archived.spoiler || existing?.spoiler || restrictions.spoiler,source:'reddit',status:proof.status,body:'['+(proof.status==='removed'?'removed':'deleted')+']'});}delete this.sourceErrors.recovery;this.render();}}
        catch(error){if(current()){
          // A busy or briefly unavailable archive is retried quietly with backoff.
          if(this.transientFailure(error,'archive') && this.scheduleSourceRetry('recovery',error,'archive'))return;
          for(const [id] of group)this.recoveryChecked.add(id);this.sourceErrors.recovery=error.message;this.setStatus('Archived details could not be loaded. Select Refresh activity to retry.',true);}}
        finally{if(generation===this.generation){this.recoveryActive=false;this.updateProfileLoading();this.updateActivityEmptyState();this.scheduleRecovery();}}
      },80);
    }
    verifiedStatus(post,native){
      if(['deleted','removed'].includes(post.status))return post.status;const stored=this.postStatuses.get(post.fullname);
      if(!native)return stored || post.status;const state=native.getAttribute('item-state')?.toLowerCase(),body=native.querySelector(post.kind==='comment'?'[id$="-post-rtjson-content"],.md':'[slot="text-body"]'),text=body?.querySelector('[data-rt-original-text]')?.getAttribute('data-rt-original-text') || body?.textContent?.trim();
      // The restored body keeps Reddit's original notice in data-rt-original-text.
      const status=M.domStatus(native) || M.noticeStatus(text);if(status)this.postStatuses.set(post.fullname,status);return status || stored || post.status;
    }
    eligibleProfilePost(post,node){
      if(!this.filterMatch(post))return false;
      if(this.activityFilter!=='deleted')return true;
      const status=this.verifiedStatus(post,node?.querySelector('shreddit-post,shreddit-profile-comment'));
      // The archive supplies candidates, never proof of current deletion. Avoid
      // spending the Deleted card budget on known available search results.
      return ['deleted','removed'].includes(status) || status!=='available' && post.source==='arctic-shift';
    }
    matchesActivity(post,node,visible=this.visibleIds()){
      if(!this.filterMatch(post))return false;if(this.activityFilter==='all')return true;const status=this.verifiedStatus(post,node?.matches?.('shreddit-post,shreddit-profile-comment')?node:node?.querySelector('shreddit-post,shreddit-profile-comment'));
      return this.activityFilter==='deleted'?['deleted','removed'].includes(status):(post.source==='reddit' || status==='available') && !['deleted','removed'].includes(status) && !visible.has(post.fullname);
    }
    syncActivityPresentation(){
      if(!this.feed)return;if(this.activityFilter==='all')this.feed.removeAttribute('data-rt-activity');else if(this.feed.dataset.rtActivity!==this.activityFilter)this.feed.dataset.rtActivity=this.activityFilter;
    }
    observeFeedPresentation(){
      if(this.feedPresentationObserver || !this.feed)return;const feed=this.feed;
      this.feedPresentationObserver=new MutationObserver(records=>{
        if(this.feed!==feed)return;this.trackVirtualization(records);if(this.context?.key!==pageRoute()?.key){this.scan();return;}
        // Scrolling swaps cards for placeholders constantly. Those swaps carry our
        // state over in trackVirtualization, so they need no reconciliation pass.
        const swap=r=>r.type==='childList' && r.addedNodes.length===1 && r.removedNodes.length===1 && [r.addedNodes[0],r.removedNodes[0]].some(n=>n.nodeType===1 && n.matches('.virtualized-placeholder'));
        if(records.every(r=>this.ownsMutation(r) || swap(r)))return;
        // CSS gates newly inserted native cards immediately. Qualify them in
        // this mutation microtask, before paint, without the general scan delay.
        this.deduplicate();
        if(records.some(r=>r.type==='childList' && [...r.addedNodes].some(n=>n.nodeType===1 && !n.closest?.('[data-rt-ui]'))))this.observeNativeLoading();
        this.updateProfileLoading();
      });
      this.feedPresentationObserver.observe(feed,{childList:true,subtree:true,attributes:true,attributeFilter:['item-state','deleted','removed','hidden','data-feed-element-id','comment-id','id','created-timestamp']});
    }
    filterNativeEntries(entries){
      const rt=this.rtActive(),predicate=rt?this.rtPredicate():null,old=this.oldSort(),activity=this.activityFilter!=='all';
      for(const entry of entries){const node=entry.node,original=this.virtualNodes.get(node) || node,native=original.matches('shreddit-post,shreddit-profile-comment')?original:original.querySelector('shreddit-post,shreddit-profile-comment'),kind=native?.matches('shreddit-profile-comment')?'comment':'post',post={fullname:entry.fullname,kind,status:'unknown',source:'reddit'};
        if(!activity && !rt){if(this.filteredNative.has(node)){const hidden=this.filteredNative.get(node);node.hidden=hidden;if(original!==node)original.hidden=hidden;this.filteredNative.delete(node);}node.removeAttribute('data-rt-filter-hidden');node.removeAttribute('data-rt-activity-match');if(original!==node){original.removeAttribute('data-rt-filter-hidden');original.removeAttribute('data-rt-activity-match');}continue;}if(!this.filteredNative.has(node))this.filteredNative.set(node,node.hidden);
        // Old replaces the feed with the archive's list; date, type and subreddit hide what does not match.
        let hidden=activity && (this.activityFilter==='hidden' || !['deleted','removed'].includes(this.verifiedStatus(post,native)));if(!hidden && rt)hidden=old || !predicate(this.nativeItem(native,entry));
        if(node.hidden!==hidden)node.hidden=hidden;node.toggleAttribute('data-rt-filter-hidden',hidden);node.toggleAttribute('data-rt-activity-match',activity && !hidden);if(original!==node){original.toggleAttribute('data-rt-filter-hidden',hidden);original.toggleAttribute('data-rt-activity-match',activity && !hidden);}}
    }
    updateArchiveSummary(){if(!this.archiveStats)return;const posts=this.renderedPosts || [],times=posts.map(p=>p.created),date=value=>new Date(value*1000).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});const set=(key,value)=>{if(this.archiveStats[key].textContent!==value)this.archiveStats[key].textContent=value;};set('posts',String(posts.filter(p=>p.kind!=='comment').length));set('comments',String(posts.filter(p=>p.kind==='comment').length));set('oldest',times.length?date(Math.min(...times)):'—');set('newest',times.length?date(Math.max(...times)):'—');}
    retrySettings(){this.reset();return this.loadSettings();}
    kinds(){return this.context.view==='overview'?['post','comment']:[this.context.view==='comments'?'comment':'post'];}
    noteSourcePage(key,posts,more){
      const values=posts.map(post=>this.context.sort==='top'?post.score:post.created).filter(Number.isFinite),previous=this.sourceFrontiers.get(key);
      this.sourceFrontiers.set(key,{more,floor:more?(values.length?Math.min(...values):previous?.floor ?? -Infinity):-Infinity});
    }
    publicationFloor(){
      // Descending source pages have different depths. Only publish the shared
      // covered prefix; a later page from a shallower stream can otherwise
      // insert newer comments above already published posts (or vice versa).
      // Empty cursor pages establish no date boundary. They remain pageable,
      // but must not pin a healthy stream behind an infinite publication floor.
      // A request still unanswered after sourceWaitMs no longer holds the
      // others back; its late results are placed by date when they arrive.
      const now=Date.now(),waiting=key=>this.sourcePending.has(key) && !this.sourceOverdue(key,now);
      if(this.freeMerge())return -Infinity;
      const applies=key=>this.activityFilter!=='deleted' || key.startsWith('archive-');
      let floor=-Infinity;
      for(const key of this.sourcePending)if(applies(key) && !this.sourceFrontiers.has(key) && waiting(key))return Infinity;
      // Archive Top pages are chronological, not score-ordered. Only New
      // has a comparable continuation boundary across every provider.
      if(this.context.sort!=='new')return [...this.sourcePending].some(key=>applies(key) && waiting(key))?Infinity:-Infinity;
      for(const [key,state] of this.sourceFrontiers)if(applies(key) && state.more && (!this.sourcePending.has(key) || waiting(key)))floor=Math.max(floor,state.floor);
      return floor;
    }
    sourceOverdue(key,now=Date.now()){const started=this.sourceStartedAt?.get(key);return started!=null && now-started>=this.sourceWaitMs;}
    // One timer re-evaluates the merge gates when the earliest budget expires.
    scheduleGate(delay){
      const at=Date.now()+Math.max(0,delay);if(this.gateTimer && this.gateAt<=at)return;
      clearTimeout(this.gateTimer);this.gateAt=at;const generation=this.generation;
      this.gateTimer=setTimeout(()=>{this.gateTimer=null;this.gateAt=Infinity;if(generation!==this.generation || !this.host?.isConnected || pageRoute()?.key!==this.context?.key)return;this.render({reuseCards:true});},Math.max(0,delay)+16);
    }
    canPublishProfilePost(post,floor=this.publicationFloor()){return (this.context.sort==='top'?post.score:post.created)>=floor;}
    // Reddit's shell around its cards: the feed's children and those of its
    // faceplate-batch wrappers. Never descends into cards or our own elements;
    // pagers and loaders (the only shell nodes with content) are searched inside.
    shellNodes(){
      const out=[];if(!this.feed)return out;
      for(const child of elementChildren(this.feed)){if(child.localName==='faceplate-batch')out.push(...elementChildren(child));else out.push(child);}
      return out;
    }
    shellQuery(selector,{deep=false}={}){
      const found=[];
      for(const node of this.shellNodes()){
        if(node.hasAttribute('data-rt-ui') || node.matches('shreddit-post,shreddit-profile-comment,.virtualized-placeholder'))continue;
        if(node.matches(selector))found.push(node);
        if(deep && node.matches('faceplate-partial,shreddit-feed-load-more-observer,shreddit-feed-page-loading'))found.push(...node.querySelectorAll(selector));
      }
      return found;
    }
    nativeContinuation(){
      const candidates=this.shellQuery('faceplate-partial[slot="load-after"]:is([loading="lazy"],[loading="programmatic"])[src],shreddit-feed-load-more-observer[cursor]');
      return candidates.filter(node=>node.matches('faceplate-partial')).at(-1) || candidates.at(-1) || null;
    }
    syncNativeOrder(entries){
      if(!this.feed)return;
      const enabled=this.context.sort==='new' && this.activityFilter==='all' && (this.autoDiscover || this.loaded || this.archiveLoaded),visible=new Set(entries.map(entry=>entry.fullname));
      let boundary=enabled?this.publicationFloor():-Infinity;
      if(enabled && this.autoDiscover && !this.loaded && !this.archiveLoaded && !this.primaryFailure())boundary=Infinity;
      if(enabled){const next=this.renderedPosts.find(post=>!visible.has(post.fullname) && !this.publishedCards.has(itemKey(post)));if(next)boundary=Math.max(boundary,next.created);}
      const previous=this.mergePendingNodes;this.mergePendingNodes=new Set();let waiting=false,release=Infinity;const now=Date.now();
      for(const entry of entries){const original=this.virtualNodes.get(entry.node) || entry.node;let pending=enabled && !entry.pinned && Number.isFinite(entry.timestamp) && !this.publishedNative.has(original) && !this.initialNative.has(original) && entry.timestamp<=boundary;
        if(pending){
          // Reddit's own page never waits longer than the native budget.
          if(!this.nativeSeenAt.has(original))this.nativeSeenAt.set(original,now);
          const expires=this.nativeSeenAt.get(original)+this.nativeWaitMs;if(now>=expires)pending=false;else release=Math.min(release,expires);
        }
        for(const node of new Set([entry.node,original])){node.toggleAttribute('data-rt-order-pending',pending);if(pending)this.mergePendingNodes.add(node);}
        if(pending)waiting=true;else if(enabled && (entry.pinned || Number.isFinite(entry.timestamp)))this.publishedNative.add(original);
      }
      for(const node of previous)if(!this.mergePendingNodes.has(node))node.removeAttribute('data-rt-order-pending');
      // Keep Reddit's retained cards, but pause its next pager while our search
      // has not covered their dates. Otherwise invisible native pages can walk
      // ahead endlessly without increasing the displayed combined prefix.
      this.feed.toggleAttribute('data-rt-merge-waiting',waiting);
      if(release<Infinity)this.scheduleGate(release-now);
    }
    nativeEntries(){
      if(!this.feed)return [];
      this.flushVirtualization();
      const entries=[];
      for(const slot of elementChildren(this.feed)){
        const node=this.virtualNodes.get(slot) || slot;
        if(node.hasAttribute('data-rt-ui'))continue;
        const content=node.matches('shreddit-post,shreddit-profile-comment')?node:node.querySelector('shreddit-post,shreddit-profile-comment');
        if(!content)continue;
        const fullname=content.getAttribute('comment-id') || content.getAttribute('data-feed-element-id') || content.id;
        const timestamp=Date.parse(content.getAttribute('created-timestamp') || content.querySelector('faceplate-timeago[ts]')?.getAttribute('ts'))/1000;
        const rawScore=content.getAttribute('score') ?? content.querySelector('shreddit-comment-action-row[score]')?.getAttribute('score') ?? content.querySelector('faceplate-number[number]')?.getAttribute('number');
        entries.push({node:slot,fullname,timestamp,score:rawScore==null?NaN:Number(rawScore),pinned:content.hasAttribute('stickied')});
      }
      return entries;
    }
    syncNativeRules(entries){
      if(!this.feed)return;
      // Reddit may append several rules separated only by empty pager observers.
      // Traverse its native batch, but never descend into cards or other content.
      const slots=new Set(entries.map(entry=>entry.node)),previous=this.collapsedNativeRules || new Set(),collapsed=new Set();let rules=[],hiddenCard=false,leftVisible=false;
      const finish=rightVisible=>{const keep=hiddenCard?(leftVisible || rightVisible?1:0):1;for(const rule of rules.slice(keep))collapsed.add(rule);rules=[];hiddenCard=false;};
      const visit=(node,batch=null)=>{
        const original=this.virtualNodes.get(node) || node;
        if(original.matches('hr.border-0.border-b-sm.border-solid.border-b-neutral-border-weak')){rules.push(node);return;}
        if(original.matches('shreddit-feed-load-more-observer') && !original.children.length && !original.textContent.trim() && node.getBoundingClientRect().height===0)return;
        const native=slots.has(node) || Boolean(batch && (original.matches('article,shreddit-post,shreddit-profile-comment') || original.matches('shreddit-feed-load-more-observer') && original.querySelector('shreddit-post,shreddit-profile-comment'))),owned=['activity-item','activity-slot'].includes(node.dataset.rtUi);
        const hidden=native && (node.hasAttribute('data-rt-order-pending') || node.hasAttribute('data-rt-filter-hidden') || batch?.hasAttribute('data-rt-order-pending') || batch?.hasAttribute('data-rt-filter-hidden')) || owned && (node.hidden || node.hasAttribute('data-rt-retired'));
        if(hidden){hiddenCard=true;return;}
        const visible=native || owned;finish(visible);leftVisible=visible;
      };
      for(const node of elementChildren(this.feed)){
        if(node.matches('faceplate-batch')){for(const child of elementChildren(node))visit(child,node);}else visit(node);
      }
      finish(false);
      for(const node of previous)if(!collapsed.has(node))node.removeAttribute('data-rt-rule-collapsed');
      for(const node of collapsed)if(!previous.has(node))node.setAttribute('data-rt-rule-collapsed','');
      this.collapsedNativeRules=collapsed;
    }
    // Cards of this profile's feed only: a matching card elsewhere on the page
    // (a sidebar, another tab) says nothing about what this feed shows.
    visibleIds(){
      const ids=new Set();if(!this.feed)return ids;
      for(const entry of this.nativeEntries())if(entry.fullname)ids.add(entry.fullname);
      for(const batch of elementChildren(this.feed)){
        if(batch.localName!=='faceplate-batch')continue;
        for(const node of elementChildren(batch)){if(node.hasAttribute('data-rt-ui'))continue;const card=node.matches(cardSelector)?node:node.querySelector(cardSelector);if(card)ids.add(card.getAttribute('comment-id') || card.getAttribute('data-fullname') || card.id);}
      }
      return ids;
    }
    deduplicate(){
      if(!this.host || this.context.kind!=='profile')return;
      return this.withFeedViewport(()=>{
      this.syncActivityPresentation();
      const entries=this.nativeEntries(),visible=this.visibleIds(),sort=this.context.sort,normal=entries.filter(e=>!e.pinned && (sort==='top'?Number.isFinite(e.score):sort==='hot' || Number.isFinite(e.timestamp))),rank=new Map(this.renderedPosts.map((post,index)=>[post.fullname,index]));
      this.syncNativeOrder(entries);
      const continuation=this.nativeContinuation();
      const horizon=this.freeMerge()?-Infinity:continuation && sort!=='hot'?(normal.length?Math.min(...normal.map(e=>sort==='top'?e.score:Math.floor(e.timestamp))):sort==='new'?Infinity:-Infinity):-Infinity;
      const nativeTail=continuation?(()=>{let n=continuation;while(n.parentElement && n.parentElement!==this.feed)n=n.parentElement;return n.parentElement===this.feed?n:null;})():null;
      // Our sentinel is also a real tail. Using null here appended stable
      // cards past it on every scan, then moved the sentinel back again. Those
      // remove/reinsert cycles disrupt native virtualization and scroll anchors.
      const tail=nativeTail || (this.loading?.parentElement===this.feed?this.loading:null);
      const buckets=new Map(),entriesByName=new Map(),oldMode=this.oldSort();let count=0,deferred=0;
      for(const entry of entries){const list=entriesByName.get(entry.fullname);if(list)list.push(entry);else entriesByName.set(entry.fullname,[entry]);}
      for(const post of this.renderedPosts || []){
        const node=this.nodes.get(itemKey(post));if(!node)continue;
        const slot=this.feedSlot(node),virtualized=slot!==node;
        const pendingDuplicate=this.publishedCards.has(itemKey(post)) && (entriesByName.get(post.fullname) || []).some(entry=>entry.node.hasAttribute('data-rt-order-pending'));
        const duplicate=visible.has(post.fullname) && !pendingDuplicate && !oldMode,older=this.activityFilter!=='deleted' && !duplicate && !this.publishedCards.has(itemKey(post)) && (sort==='top'?post.score:post.created)<horizon;
        const staged=this.batchedProfile && (!this.publishedCards.has(itemKey(post)) || !['ready','failed'].includes(node.dataset.rtNativeState));const matches=this.matchesActivity(post,node,visible),qualify=this.activityFilter==='deleted' && !duplicate && !older && !staged && !['deleted','removed'].includes(this.verifiedStatus(post,node.querySelector('shreddit-post,shreddit-profile-comment'))) && node.dataset.rtNativeState==='idle';const hide=duplicate || older || staged || !matches;if(node.hidden!==hide)node.hidden=hide;
        if(qualify){node.dataset.rtQualify='true';this.queueNative(node);}const deferral=older?'older':'';if(node.getAttribute('data-deferred')!==deferral)node.setAttribute('data-deferred',deferral);
        if(virtualized && slot.hidden!==node.hidden)slot.hidden=node.hidden;
        if(node.hidden){if(duplicate){const entry=entriesByName.get(post.fullname)?.[0],original=this.virtualNodes.get(entry?.node) || entry?.node,native=original?.matches('shreddit-post,shreddit-profile-comment')?original:original?.querySelector('shreddit-post,shreddit-profile-comment');if(native){const archive=this.archived.get(itemKey(post)),status=this.verifiedStatus(post,native),owned=archive?.source==='arctic-shift' && archive.fullname===post.fullname && archive.author.toLowerCase()===this.context.username.toLowerCase();if(owned && ['deleted','removed'].includes(status) || this.recoverBody(post,native)){this.nativeDecorations.add(native);this.decorateNative(post,native);}}}this.nativeObserver?.unobserve(node);if(older)deferred++;if(!virtualized && !this.publishedCards.has(itemKey(post)) && node.parentElement!==this.results)this.results.append(node);continue;}
        count++;
        // A newly fetched native duplicate may still be behind the merge gate.
        // Retain its displayed peer in the same slot until native handoff.
        if(pendingDuplicate && slot.parentElement===this.feed)continue;
        const target=oldMode?tail:normal.find(entry=>sort==='top'?entry.score<=post.score:sort==='hot'?rank.has(entry.fullname) && rank.get(entry.fullname)>rank.get(post.fullname):entry.timestamp<=post.created)?.node || tail;
        if(!buckets.has(target))buckets.set(target,[]);buckets.get(target).push(slot);
      }
      // Reconcile only extension-owned cards. Reddit retains ownership and order of its nodes.
      for(const [target,nodes] of buckets){let anchor=target;for(let i=nodes.length-1;i>=0;i--){const node=nodes[i];if(!this.virtualNodes.has(node) && (node.parentElement!==this.feed || node.nextElementSibling!==anchor))this.feed.insertBefore(node,anchor);anchor=node;}}
      for(const nodes of buckets.values())for(const node of nodes)if(node.dataset.rtNativeState==='idle'){if(this.nativeObserver)this.nativeObserver.observe(node);else this.queueNative(node);}
      this.filterNativeEntries(entries);this.syncNativeRules(entries);this.summaryCounts={count,deferred};this.updateActivityEmptyState();this.scheduleRecovery();
      if(this.emptyFeed){this.emptyFeed.hidden=this.activityFilter!=='all' || this.rtActive() || count>0 || this.emptyWasHidden;this.emptyFeed.toggleAttribute('data-rt-empty-suppressed',count>0);}
      if(!this.busy && this.status.dataset.error!=='true')this.summarize();this.updateProfileLoading();this.capturePresentedFeed();
      });
    }
    summarize(){
      const {count=0,deferred=0}=this.summaryCounts || {},noun=this.context.view==='comments'?(count===1?'comment':'comments'):this.context.view==='overview'?(count===1?'item':'items'):count===1?'post':'posts';
      const archiveView=this.activityFilter==='deleted' && this.settings.archiveDiscovery,errors=Object.entries(this.sourceErrors || {}).filter(([key,value])=>value && !key.startsWith('metadata-') && !(archiveView && ['post','comment','comment-public','request'].includes(key))).map(([,value])=>value);this.setStatus(errors.length?errors.join(' '):this.nativeBatch.blocked?'Reddit is limiting card requests. Select Refresh activity to retry.':count?`${count} ${this.archiveOnly?'archived':'additional'} ${noun}${this.rtActive()?' · Search and archive coverage may be incomplete':''}`:this.rtActive()?'No matches in loaded activity':'Activity checked',errors.length>0 || this.nativeBatch.blocked===true);
      // Quiet notes: a source paused on purpose, never a failure banner.
      if(this.notice){const notes=[...new Set(Object.values(this.sourceNotices || {}).filter(Boolean))],text=notes.join(' · ');if(this.notice.textContent!==text)this.notice.textContent=text;this.notice.hidden=!notes.length;this.notice.title=notes.includes(publicBlockedNote)?'Reddit refused the extension’s logged-out comment search (HTTP 403). It is skipped for about 10 minutes; signed-in search, Reddit’s own feed and the archive keep loading.':'';}
      if(this.archiveOnly)this.updateArchiveSummary();
      if(this.archiveOnly && this.settings.archiveDiscovery){this.archiveEmpty.hidden=this.activityFilter!=='all' || !this.archiveLoaded || count>0 || this.renderedPosts.length>0;this.archiveEmpty.textContent='No archived activity found for this username. Archive coverage may be incomplete.';}
      this.status.title=(deferred?`${deferred} older discoveries will appear when Reddit loads that part of the feed. `:'')+[...new Set(Object.entries(this.sourceErrors || {}).filter(([key,value])=>key.startsWith('metadata-') && value).map(([,value])=>value)),'Search and archive coverage may be incomplete.'].join(' ');
    }
    setStatus(text,error=false){this.status.textContent=text;this.status.dataset.error=String(error);}
    async request(parameters){const controller=new AbortController();let started=Date.now(),timeoutRetries=0,responseRetries=0;this.controllers.add(controller);try{
      for(;;){
        if(Date.now()-started>=10000)throw Error('Reddit requests are paused. Please try again shortly.');
        let result;try{result=await this.reddit(parameters,controller.signal);}catch(error){
          // A continuation can receive transient HTML without search markup.
          // Retry that cursor once, never treating it as history exhaustion.
          if(parameters.action==='profile' && !controller.signal.aborted && timeoutRetries<1 && /^(Reddit request timed out\. Try again\.|Public posts took too long to load\. Try again\.)$/.test(error.message)){timeoutRetries++;started=Date.now();continue;}
          if(parameters.action==='profile' && parameters.after && !controller.signal.aborted && responseRetries<1 && /^Reddit returned an unrecognized (?:comment|post) search response\.$/.test(error.message)){
            responseRetries++;await new Promise((resolve,reject)=>{const cancel=()=>{clearTimeout(timer);reject(Error('Post request cancelled.'));},timer=setTimeout(()=>{controller.signal.removeEventListener('abort',cancel);resolve();},350);controller.signal.addEventListener('abort',cancel,{once:true});if(controller.signal.aborted)cancel();});continue;
          }throw error;
        }if(!result?.deferred || parameters.action==='render-card')return result;
        const remaining=10000-(Date.now()-started);if(remaining<=0)throw Error('Reddit requests are paused. Please try again shortly.');
        await new Promise((resolve,reject)=>{const cancel=()=>{clearTimeout(timer);reject(Error('Post request cancelled.'));},timer=setTimeout(()=>{controller.signal.removeEventListener('abort',cancel);resolve();},Math.min(remaining,Math.max(100,Number(result.retryAfterMs)||1000)));controller.signal.addEventListener('abort',cancel,{once:true});if(controller.signal.aborted)cancel();});
      }
    }finally{this.controllers.delete(controller);}}
    async run(task){
      if(this.busy)return;this.batchAutoPaused=false;const generation=this.generation;this.busy=true;this.host.setAttribute('aria-busy','true');this.setStatus('Checking public activity…');this.updateProfileLoading();this.discover.disabled=true;if(this.archiveButton)this.archiveButton.disabled=true;this.more.disabled=true;this.updateActivityEmptyState();
      try{await task(()=>generation===this.generation && pageRoute()?.key===this.context?.key && this.host?.isConnected);}
      catch(error){if(generation===this.generation && pageRoute()?.key===this.context?.key){this.sourceErrors.request=error.message;this.setStatus(error.message,true);}}
      finally{if(generation===this.generation){this.busy=false;this.host.removeAttribute('aria-busy');this.more.disabled=false;if(this.feed){this.batchAutoPaused=this.primaryFailure();this.updateProfileLoading();this.updateActivityEmptyState();}else this.loading.hidden=true;this.discover.disabled=this.archiveBusy;if(this.archiveButton)this.archiveButton.disabled=this.archiveBusy;this.ensureActivityArchive();}}
    }
    loadReddit({more=false,retry=false,keys=null}={}){if(this.busy)return this.redditRun;if(!more && !retry){this.initialPrefetchDone=false;this.pages=0;this.recoveryChecked.clear();this.sourceErrors={};this.sourceNotices={};this.clearSourceRetries(key=>!key.startsWith('archive-'));this.refreshStatuses();}if(retry && !keys)this.clearSourceRetries(key=>!key.startsWith('archive-') && !['recovery','replies','verify'].includes(key));if(this.archiveOnly)return this.loadArchive({more});if(this.nativeBatch?.blocked){this.nativeBatch.blocked=false;this.nativeBatch.serverRetryAt=0;this.drainNative(this.nativeBatch);}
      const frontier=this.publicationFloor(),streams=this.kinds().flatMap(kind=>kind==='comment'?[{kind,key:'comment',stream:'authenticated'},{kind,key:'comment-public',stream:'public'}]:[{kind,key:kind}])      .filter(({key})=>{if(key!=='comment-public' || !(this.publicBlockedUntil>Date.now()))return true;this.sourceNotices[key]=publicBlockedNote;this.redMore[key]=false;return false;})
      .filter(({key})=>retry?(keys?keys.includes(key):Boolean(this.sourceErrors[key])):!more || this.redMore[key] && (this.context.sort!=='new' || (this.sourceFrontiers.get(key)?.floor ?? Infinity)>=frontier));
      for(const {key} of streams){if(!more && !retry)this.sourceFrontiers.delete(key);this.sourcePending.add(key);this.sourceStartedAt.set(key,Date.now());}
      if(streams.length)this.scheduleGate(this.sourceWaitMs);
      return this.redditRun=this.run(async current=>{
      const errors=[];let succeeded=false;
      await Promise.all(streams.map(async ({kind,key,stream})=>{
        if(more && !retry && !this.redMore[key])return;
        const old=more || retry?this.afterByKind[key]:null;this.pages++;
        try{const result=await this.request({action:'profile',username:this.context.username,sort:this.context.sort,range:this.context.range,kind,...(stream?{stream}:{}),...(old?{after:old}:{})});if(!current())return;
          const incoming=new Map(),page=[];for(const raw of result.posts || []){const p=M.normalizeItem(raw,{source:'reddit'});if(!p || p.author.toLowerCase()!==this.context.username.toLowerCase())continue;page.push(p);const id=itemKey(p),previous=this.live.get(id);
            if(stream==='public' && previous && this.commentOrigins.get(id)!=='public'){this.live.set(id,{...previous,over18:previous.over18 || p.over18,spoiler:previous.spoiler || p.spoiler});continue;}
            const merged=previous?{...p,over18:previous.over18 || p.over18,spoiler:previous.spoiler || p.spoiler}:p;this.live.set(id,merged);incoming.set(id,merged);if(kind==='comment')this.commentOrigins.set(id,stream);
          }
          if(!more && !retry && this.context.sort==='hot' && stream!=='public'){
            const belongs=post=>(post.kind==='comment'?'comment':'post')===kind,group=new Map([...incoming,...[...this.live].filter(([id,p])=>belongs(p) && !incoming.has(id))]);
            this.live=new Map(this.kinds().flatMap(type=>type===kind?[...group]:[...this.live].filter(([,p])=>(p.kind==='comment'?'comment':'post')===type)));
          }
          this.afterByKind[key]=result.after;this.redMore[key]=Boolean(result.hasMore && result.after && result.after!==old);this.noteSourcePage(key,page,this.redMore[key]);succeeded=true;this.loaded=true;delete this.sourceErrors[key];this.clearSourceRetries(name=>name===key);this.moreReddit=Object.values(this.redMore).some(Boolean);this.render();
        }catch(error){if(!current())return;this.redMore[key]=false;this.noteSourcePage(key,[],false);
          if(stream==='public' && /\(HTTP 403\)/.test(error.message)){this.publicBlockedUntil=Date.now()+publicBlockMs;this.sourceNotices[key]=publicBlockedNote;return;}
          if(this.scheduleSourceRetry(key,error,'reddit'))return;
          this.sourceErrors[key]=error.message;errors.push((stream==='public'?'Public comments: ':kind==='comment'?'Comments: ':'Posts: ')+error.message);}
        finally{if(current()){this.sourcePending.delete(key);this.sourceStartedAt.delete(key);}}
      }));
      if(!current())return;
      this.after=this.afterByKind.post;this.moreReddit=Object.values(this.redMore).some(Boolean);this.loaded=succeeded || this.loaded;this.render();
      if(errors.length)this.setStatus(errors.join(' '),true);
      this.discover.setAttribute('aria-label','Refresh activity');
    });}
    // Refresh forgets every stored status: a re-approved or restored item must not
    // keep a stale Removed or Deleted cue. Cards re-read their own markup, and
    // archive candidates are verified again where their status matters.
    refreshStatuses(){
      this.postStatuses.clear();
      if(this.activityFilter!=='all' && !this.archiveOnly)this.verifyArchiveStatuses([...this.archived.values()].filter(post=>post.source==='arctic-shift'),{force:true});
    }
    // Archive snapshots are candidates; Reddit's own evidence decides their
    // current status. One queue serves every page. Batches use 25 IDs while the
    // bridge answers them in a single read, and drop to native-fragment pairs
    // (published as each pair finishes) once it reports per-card fallback.
    verifyArchiveStatuses(page,{force=false}={}){
      // Refresh re-checks known items; continuation pages skip them.
      for(const post of page)if((force || !this.postStatuses.has(post.fullname)) && !this.verifyQueued.has(post.fullname)){this.verifyQueued.add(post.fullname);this.verifyQueue.push(post);}
      return this.pumpVerification();
    }
    async pumpVerification(){
      if(this.verifyActive || !this.verifyQueue.length || this.context?.kind!=='profile')return;
      const generation=this.generation,context=this.context,current=()=>generation===this.generation && pageRoute()?.key===context.key && this.host?.isConnected;
      this.verifyActive=true;this.metadataPending++;this.updateProfileLoading();const unresolved=new Set();
      try{
        while(this.verifyQueue.length && current()){
          const kind=this.verifyQueue[0].kind==='comment'?'comment':'post',size=this.statusBatch || profileBatchSize,batch=[];
          while(batch.length<size && this.verifyQueue.length && (this.verifyQueue[0].kind==='comment'?'comment':'post')===kind){const next=this.verifyQueue.shift();this.verifyQueued.delete(next.fullname);batch.push(next);}
          let result;
          try{result=await this.request({action:'status',username:context.username,kind,ids:batch.map(p=>p.id)});}
          catch(error){if(!current())return;
            // A busy Reddit is retried quietly; the batch goes back in the queue.
            if(this.transientFailure(error,'reddit') && this.scheduleSourceRetry('verify',error,'reddit')){this.verifyRetry.push(...batch);continue;}
            unresolved.add(kind);this.sourceErrors['metadata-'+kind]='Some archive items have unverified current Reddit status.';this.summarize();continue;}
          this.clearSourceRetries(name=>name==='verify');
          if(!current())return;
          this.statusBatch=result.via==='info'?profileBatchSize:2;
          const requested=new Map(batch.map(p=>[p.fullname,p])),verified=new Set();
          for(const evidence of result.statuses || []){const post=requested.get(evidence.fullname);if(!post || !['available','deleted','removed'].includes(evidence.status))continue;verified.add(post.fullname);this.postStatuses.set(post.fullname,evidence.status);if(evidence.over18 || evidence.spoiler)this.archived.set(itemKey(post),{...this.archived.get(itemKey(post)),over18:post.over18 || evidence.over18===true,spoiler:post.spoiler || evidence.spoiler===true});}
          if(verified.size<batch.length){unresolved.add(kind);this.sourceErrors['metadata-'+kind]='Some archive items have unverified current Reddit status.';}else if(!unresolved.has(kind))delete this.sourceErrors['metadata-'+kind];
          this.render();
        }
      }finally{if(generation===this.generation){this.verifyActive=false;this.metadataPending--;if(current()){this.updateProfileLoading();this.updateActivityEmptyState();if(this.activityFilter==='deleted' && this.batchedProfile)this.advanceProfileBatch();}}}
    }
    loadArchive(options){
      if(!this.settings.archiveDiscovery)return;if(this.archiveBusy)return this.archiveRun;
      return this.archiveRun=this.archivePage(options);
    }
    // Archive and Reddit search streams load independently; neither waits for
    // the other's request to finish.
    // Archive pages are chronological, so they merge automatically only into
    // New (and Deleted); Hot/Top keep Reddit's ranking without archive filler.
    refreshActivity(){
      const merge=this.settings.archiveDiscovery && !this.archiveOnly && (this.context?.sort==='new' || this.activityFilter==='deleted' || this.oldSort());
      const reddit=this.oldSort()?undefined:this.loadReddit(),archive=merge?this.loadArchive():undefined;
      return Promise.all([reddit,archive]);
    }
    async archivePage({more=false,only=null}={}){
      if(!more){this.initialPrefetchDone=false;if(!this.busy)this.pages=0;for(const key of Object.keys(this.sourceErrors))if(key.startsWith('archive-'))delete this.sourceErrors[key];this.clearSourceRetries(key=>key.startsWith('archive-'));}
      const generation=this.generation,current=()=>generation===this.generation && pageRoute()?.key===this.context?.key && this.host?.isConnected;
      const sig=more?(this.archiveSig ??= this.archiveSigNow()):(this.archiveSig=this.archiveSigNow());
      const frontier=this.publicationFloor(),kinds=only?this.kinds().filter(kind=>only.includes(kind)):this.kinds().filter(kind=>!more || this.archiveMore[kind] && (this.context.sort!=='new' || (this.sourceFrontiers.get('archive-'+kind)?.floor ?? Infinity)>=frontier));for(const kind of kinds){if(!more)this.sourceFrontiers.delete('archive-'+kind);this.sourcePending.add('archive-'+kind);this.sourceStartedAt.set('archive-'+kind,Date.now());}if(kinds.length)this.scheduleGate(this.sourceWaitMs);
      this.archiveBusy=true;this.batchAutoPaused=false;this.setStatus('Checking archived activity…');this.updateProfileLoading();this.discover.disabled=true;if(this.archiveButton)this.archiveButton.disabled=true;this.more.disabled=true;this.updateActivityEmptyState();
      try{
        const warnings=[];
        await Promise.all(kinds.map(async kind=>{
          this.pages++;
          try{const result=await this.archiveFetch(kind,more);if(!current())return;
            const page=[];for(const raw of result.posts || []){const p=result.normalized && raw.fullname && raw.source?raw:M.normalizeItem(raw,{source:'arctic-shift'});if(p){this.archived.set(itemKey(p),p);page.push(p);}}
            // The filters changed while this page was loading: keep its items, drop its cursor.
            if(sig!==this.archiveSig){this.render();return;}
            this.noteSearched(result);
            this.beforeByKind[kind]=result.before;this.archiveMore[kind]=Boolean(result.hasMore && !result.cursorStalled);this.archiveLoaded=true;this.moreArchive=Object.values(this.archiveMore).some(Boolean);this.noteSourcePage('archive-'+kind,page,this.archiveMore[kind]);
            delete this.sourceErrors['archive-'+kind];this.clearSourceRetries(key=>key==='archive-'+kind);this.render();
            // All activity renders these cards, and rendering proves their status, so a
            // separate check would fetch each card twice. Hidden/Deleted need status first.
            if(page.length && !this.archiveOnly && this.activityFilter!=='all')this.verifyArchiveStatuses(page,{force:!more});
            if(result.cursorStalled){this.sourceErrors['archive-'+kind]='Archive pagination stopped at an ambiguous timestamp. History is incomplete.';warnings.push(this.sourceErrors['archive-'+kind]);}
          }catch(error){if(!current())return;this.archiveMore[kind]=false;this.noteSourcePage('archive-'+kind,[],false);if(this.scheduleSourceRetry('archive-'+kind,error,'archive'))return;this.sourceErrors['archive-'+kind]=error.message;warnings.push(error.message);}
          finally{if(current()){this.sourcePending.delete('archive-'+kind);this.sourceStartedAt.delete('archive-'+kind);}}
        }));
        if(!current())return;
        this.moreArchive=Object.values(this.archiveMore).some(Boolean);this.render();if(warnings.length)this.setStatus(warnings.join(' '),true);
      }finally{if(generation===this.generation){this.archiveBusy=false;this.discover.disabled=this.busy;if(this.archiveButton)this.archiveButton.disabled=this.busy;this.more.disabled=this.busy;if(this.feed){this.batchAutoPaused=this.primaryFailure();this.updateProfileLoading();this.updateActivityEmptyState();}else this.loading.hidden=true;}}
    }
    // Transient failures (rate limits, timeouts, gateway errors) wait and retry
    // the same cursor with backoff, showing a quiet note instead of an error.
    // After retryLimit attempts the failure is reported normally.
    transientFailure(error,provider){
      if(provider==='archive')return ['rate-limited','timeout','network-error','http-error','busy','maintenance','unavailable'].includes(error?.code);
      return /rate limit|asked us to wait|requests are paused|timed out|took too long|\(HTTP 5\d\d\)|Failed to fetch/i.test(error?.message || '');
    }
    scheduleSourceRetry(key,error,provider){
      if(!this.transientFailure(error,provider))return false;
      const previous=this.sourceRetries.get(key),attempts=(previous?.attempts || 0)+1;if(attempts>retryLimit){this.sourceRetries.delete(key);return false;}
      const limited=provider==='archive'?error.code==='rate-limited':/rate limit|asked us to wait|requests are paused/i.test(error.message),now=Date.now();
      // A service that reports itself down gets minutes, not seconds.
      const down=provider==='archive' && ['maintenance','unavailable'].includes(error.code);
      let delay=(down?60:limited?15:4)*this.retryUnitMs*2**(attempts-1);if(Number.isFinite(error.retryAt) && error.retryAt>now)delay=Math.max(delay,error.retryAt-now+500);delay=Math.min(delay,300000);
      const name=provider==='archive'?'Arctic Shift':'Reddit search',wait=delay<60000?Math.ceil(delay/1000)+' seconds':'about '+Math.max(1,Math.round(delay/60000))+' min';
      const note=down?(error.code==='maintenance'?`${name} is down for maintenance. Retrying in ${wait}.`:`${name} is temporarily unavailable. Retrying in ${wait}.`):limited?`${name} is limiting requests. Retrying in ${wait}.`:`${name} isn’t responding. Retrying in ${wait}.`;
      clearTimeout(previous?.timer);const generation=this.generation,entry={attempts,at:now+delay,note,provider};
      entry.timer=setTimeout(()=>{entry.timer=null;if(generation!==this.generation || !this.host?.isConnected)return;this.retrySource(key);},delay);
      this.sourceRetries.set(key,entry);this.updateProfileLoading();return true;
    }
    async retrySource(key){
      const entry=this.sourceRetries.get(key);if(!entry)return;clearTimeout(entry.timer);entry.timer=null;
      // Work that is not a paged source: the entry stays until the retry succeeds.
      if(key==='recovery'){this.scheduleRecovery();return;}
      if(key==='replies')return this.retryReplyEnrichment();
      if(key==='verify'){const again=this.verifyRetry;this.verifyRetry=[];return this.verifyArchiveStatuses(again,{force:true});}
      if(key.startsWith('archive-')){if(this.archiveBusy)await this.archiveRun;if(!this.settings.archiveDiscovery)return;this.archiveMore[key.slice(8)]=true;this.archiveRun=this.archivePage({more:true,only:[key.slice(8)]});return this.archiveRun;}
      if(this.busy)await this.redditRun;return this.loadReddit({retry:true,keys:[key]});
    }
    clearSourceRetries(match=()=>true){for(const [key,entry] of this.sourceRetries || [])if(match(key)){clearTimeout(entry.timer);this.sourceRetries.delete(key);}}
    waitingRetries(){return [...this.sourceRetries?.values() || []].filter(entry=>entry.timer);}
    hasMoreProfile(){if(this.oldSort())return this.moreArchive;return this.activityFilter==='deleted' && this.settings.archiveDiscovery?this.moreArchive:this.moreReddit || this.moreArchive;}
    // Advance every provider that has a stream at the shared frontier (the
    // shallowest pending boundary). A busy provider never blocks the other.
    loadMore(){
      if(this.batchedProfile)this.forceProfileBatch=true;
      if(this.oldSort()){if(!this.moreArchive || this.archiveBusy)return;return this.loadArchive({more:true});}
      if(this.activityFilter==='deleted' && this.settings.archiveDiscovery){
        // Keep at most one archive page of unchecked Deleted candidates ahead.
        if(!this.moreArchive || this.archiveBusy || this.verifyQueue.length>=profileBatchSize)return;
        return this.loadArchive({more:true});
      }
      const floor=this.publicationFloor(),ordered=this.context.sort==='new';
      const atFrontier=(key,more)=>Boolean(more) && (!ordered || (this.sourceFrontiers.get(key)?.floor ?? Infinity)>=floor);
      const archive=this.moreArchive && this.kinds().some(kind=>atFrontier('archive-'+kind,this.archiveMore[kind]));
      const reddit=this.moreReddit && Object.keys(this.redMore).some(key=>atFrontier(key,this.redMore[key]));
      const tasks=[];
      if(archive && !this.archiveBusy)tasks.push(this.loadArchive({more:true}));
      if(reddit && !this.busy)tasks.push(this.loadReddit({more:true}));
      if(!tasks.length && !archive && !reddit && !this.busy && !this.archiveBusy){
        // No comparable boundary (e.g. a source without one yet): keep the
        // previous preference so continuation can still make progress.
        if(this.moreReddit)tasks.push(this.loadReddit({more:true}));else if(this.moreArchive)tasks.push(this.loadArchive({more:true}));
      }
      return tasks.length?Promise.all(tasks):undefined;
    }
    captureFeedViewport(){
      // A parked (detached) feed must never scroll the page that replaced it.
      if(!this.feed?.isConnected || window.scrollY<=0)return null;
      // Near the feed end the reader is looking at the last card above the
      // loader, so keep that card fixed; elsewhere keep the top visible card.
      const children=elementChildren(this.feed),tail=this.loading?.parentElement===this.feed && !this.loading.hidden?this.loading.getBoundingClientRect():null,atTail=Boolean(tail && tail.top<innerHeight && tail.bottom>0);
      for(const node of atTail?children.reverse():children){if(node.hidden || node===this.loading)continue;const rect=node.getBoundingClientRect();if(rect.height>0 && rect.bottom>56 && rect.top<innerHeight)return {node,top:rect.top,scrollY:window.scrollY};}
      return null;
    }
    withFeedViewport(change){
      if(!this.feed || this.feedViewportUpdate)return change();
      const feed=this.feed,anchor=this.captureFeedViewport();if(!anchor)return change();
      const properties=['min-height','overflow-anchor'],styles=properties.map(name=>[name,feed.style.getPropertyValue(name),feed.style.getPropertyPriority(name)]),height=feed.getBoundingClientRect().height;
      const restore=name=>{const [,value,priority]=styles.find(style=>style[0]===name);if(value)feed.style.setProperty(name,value,priority);else feed.style.removeProperty(name);};
      this.feedViewportUpdate=true;
      // Reconciliation may hide a native tail before inserting its ready peers.
      // Keep the document tall until the whole synchronous update is finished;
      // otherwise bottom clamping changes scrollY between these operations.
      feed.style.setProperty('min-height',height+'px','important');
      feed.style.setProperty('overflow-anchor','none','important');
      try{return change();}
      finally{restore('min-height');try{if(this.feed===feed)this.restoreFeedViewport(anchor,true);}finally{restore('overflow-anchor');this.feedViewportUpdate=false;}}
    }
    restoreFeedViewport(anchor,layoutUpdate=false){
      if(!anchor || anchor.node.parentElement!==this.feed || anchor.node.hidden || anchor.node.hasAttribute('data-rt-order-pending') || !layoutUpdate && window.scrollY!==anchor.scrollY)return;
      const rect=anchor.node.getBoundingClientRect();if(rect.height<=0)return;const delta=rect.top-anchor.top;
      if(Math.abs(delta)>1)window.scrollBy({top:delta,behavior:'instant'});
    }
    render({reuseCards=false}={}){
      return this.withFeedViewport(()=>{
      this.renderVersion=(this.renderVersion || 0)+1;
      const posts=this.oldSort()?M.mergePosts([],[...this.archived.values()],{username:this.context.username,visibleIds:[],sort:'new'}).reverse():M.mergePosts([...this.live.values()],[...this.archived.values()],{username:this.context.username,visibleIds:this.visibleIds(),sort:this.context.sort,range:this.context.range});
      for(const post of posts){const key=itemKey(post);this.postMetadata.set(key,post);const previous=this.nodes.get(key);if(previous){if(!reuseCards && previous.dataset.rtArchiveFallback==='true')this.renderArchivedNative(post,previous);if(previous.dataset.rtNativeState==='ready')this.decorateNative(post,previous);continue;}const node=this.card(post);this.results.append(node);this.nodes.set(key,node);}
      this.renderedPosts=posts;
      this.deduplicate();this.more.hidden=!this.hasMoreProfile();
      this.summarize();this.updateProfileLoading();this.updateActivityEmptyState();if(this.activeProfileBatch)this.settleProfileBatch();if(this.batchedProfile)this.advanceProfileBatch(this.forceProfileBatch===true);this.forceProfileBatch=false;
      });
    }
    pendingProfilePosts(){
      const visible=this.visibleIds(),floor=this.publicationFloor();return this.renderedPosts.filter(post=>{const node=this.nodes.get(itemKey(post));return node && this.eligibleProfilePost(post,node) && this.canPublishProfilePost(post,floor) && (!this.publishedCards.has(itemKey(post)) || !['ready','failed'].includes(node.getAttribute('data-rt-native-state'))) && !visible.has(post.fullname) && node.getAttribute('data-deferred')!=='older';});
    }
    // The observer can miss a change (e.g. a filter collapsing the feed in an
    // unfocused window); a measurable loader on screen counts as visible too.
    profileTailVisible(){const rect=this.loading.getBoundingClientRect();return (this.batchInView || rect.height>0 && !this.loading.hidden) && rect.top<=innerHeight*3 && rect.bottom>=0;}
    // Published cards actually on screen. Cards hidden by the current filter
    // (or as duplicates) must not count toward filling the first batch.
    shownPublished(){let count=0;for(const key of this.publishedCards)if(this.nodes.get(key)?.hidden===false)count++;return count;}
    primaryFailure(){const archiveOnlyView=this.activityFilter==='deleted' && this.settings.archiveDiscovery;return Object.entries(this.sourceErrors || {}).some(([key,value])=>value && !/^(metadata-|recovery$)/.test(key) && !(archiveOnlyView && !key.startsWith('archive-')) && !(['post','comment','comment-public'].includes(key) && Object.values(this.redMore).some(Boolean)));}
    prefetchProfilePage(){
      if(pageRoute()?.key!==this.context?.key || this.busy && this.archiveBusy || this.batchAutoPaused || this.primaryFailure() || this.nativeBatch.blocked || !this.batchObserver || !this.hasMoreProfile())return;
      const initial=this.autoDiscover && (this.loaded || this.archiveLoaded) && !this.initialPrefetchDone;
      if(!initial && !this.profileTailVisible())return;
      // Prime one additional cursor page on initial automatic discovery. Later
      // reads start two viewports ahead even between hydration batches. Keep
      // one bounded unpublished buffer, including native-horizon deferrals.
      const visible=this.visibleIds(),buffered=this.renderedPosts.filter(post=>!this.publishedCards.has(itemKey(post)) && !visible.has(post.fullname)).length;
      if(buffered<profileBatchSize && this.loadMore() && initial)this.initialPrefetchDone=true;
    }
    continueProfile(force=false){
      // A native continuation halo can remain mounted before its request starts.
      // It owns the visible loader, but must not block preparing our next page.
      // One provider's request in flight never blocks the other provider.
      if(this.busy && this.archiveBusy)return;
      if(this.batchedProfile){this.prefetchProfilePage();return this.advanceProfileBatch(force);}
      if(this.hasMoreProfile() && !this.batchAutoPaused)this.loadMore();
    }
    updateProfileLoading(){
      if(!this.feed || !this.loading)return;
      const pending=this.batchedProfile && this.pendingProfilePosts().length>0,more=this.hasMoreProfile();
      const paused=this.nativeBatch.blocked || (this.batchAutoPaused || this.primaryFailure()) && !pending && !this.activeProfileBatch;
      const work=this.busy || this.archiveBusy || this.activeProfileBatch || this.nativeBatch.active || this.nativeBatch.queue.length || this.metadataPending || this.recoveryActive;
      const retrying=this.waitingRetries(),continuation=Boolean(work || pending || more || this.mergePendingNodes.size || retrying.length);
      const nativeLoading=this.nativeFeedLoading(),owner=nativeLoading?'native':'extension',halo=this.loading.querySelector('.rt-native-loading'),quiet=nativeLoading || (paused || retrying.length>0) && !work;
      const archiveView=this.activityFilter==='deleted' && this.settings.archiveDiscovery,failedArchive=this.kinds().filter(kind=>this.sourceErrors['archive-'+kind]),failedSearch=!archiveView && ['post','comment','comment-public'].some(key=>this.sourceErrors[key]);
      let message='',action=null,label='';
      if(paused && !work){
        if(archiveView && failedArchive.length){message='Some archived items couldn’t be loaded. Existing results are kept.';label='Retry loading';action=()=>{for(const kind of failedArchive)delete this.sourceErrors['archive-'+kind];this.batchAutoPaused=false;this.archiveMore=Object.fromEntries(Object.entries(this.archiveMore).concat(failedArchive.map(kind=>[kind,true])));return this.archiveBusy?undefined:(this.archiveRun=this.archivePage({more:true,only:failedArchive}));};}
        else if(failedSearch){message='Some search results couldn’t be loaded. Existing results are kept.';label='Retry loading';action=()=>this.loadReddit({retry:true});}
        else{message='Loading paused.';label='Retry loading';action=()=>this.discover.click();}
      }else if(retrying.length && !work){const soonest=new Map();for(const entry of retrying)if(!soonest.has(entry.provider) || entry.at<soonest.get(entry.provider).at)soonest.set(entry.provider,entry);message=[...soonest.values()].map(entry=>entry.note).join(' ');label='Retry now';action=()=>{this.archiveForceUntil=Date.now()+5000;for(const [key,entry] of this.sourceRetries)if(entry.timer)this.retrySource(key);};}
      // The button always runs the latest action.
      this.noteAction=action;
      // Most calls change nothing; only a real change pays for the viewport
      // transaction (which reads layout to keep the reading position).
      const note=this.loading.querySelector('[data-rt-continuation-note]');
      const dirty=this.loading.parentElement!==this.feed || this.loading!==this.feed.lastElementChild || this.loading.hidden===continuation || this.feed.dataset.rtLoadingOwner!==owner || Boolean(halo) && halo.hidden!==quiet || Boolean(message)!==Boolean(note) || Boolean(note) && note.dataset.message!==message;
      if(dirty)this.withFeedViewport(()=>{
        if(this.loading.parentElement!==this.feed || this.loading!==this.feed.lastElementChild)this.feed.append(this.loading);
        if(this.loading.hidden===continuation)this.loading.hidden=!continuation;
        if(this.feed.dataset.rtLoadingOwner!==owner)this.feed.dataset.rtLoadingOwner=owner;
        if(halo && halo.hidden!==quiet)halo.hidden=quiet;
        let current=this.loading.querySelector('[data-rt-continuation-note]');
        if(message){
          if(!current){current=make('div','rt-feed-note');current.dataset.rtContinuationNote='true';current.setAttribute('role','status');this.loading.append(current);}
          if(current.dataset.message!==message){current.dataset.message=message;const retry=button(label,()=>this.noteAction?.());retry.className=label==='Retry now'?'button button-small button-plain':'button button-small button-bordered';current.replaceChildren(make('span','rt-feed-note-text',message),retry);}
        }else current?.remove();
      });
      this.more.hidden=!continuation || Boolean(this.batchObserver && !paused);this.more.disabled=Boolean(this.busy || this.archiveBusy || this.activeProfileBatch && !paused);
      if(pending && !this.activeProfileBatch && !paused && this.shownPublished()<profileBatchSize){this.advanceProfileBatch();return;}
      this.prefetchProfilePage();
      if(!this.activeProfileBatch && !(this.busy && this.archiveBusy) && !paused && this.batchObserver && !this.loading.hidden && !this.batchFrame){const generation=this.generation;this.batchFrame=requestAnimationFrame(()=>{this.batchFrame=null;if(generation===this.generation && this.host?.isConnected && this.profileTailVisible())this.continueProfile();});}
      this.updateActivityEmptyState();
    }
    advanceProfileBatch(force=false){
      if(!this.batchedProfile || pageRoute()?.key!==this.context?.key)return;
      if(force){this.batchAutoPaused=false;if(this.nativeBatch.blocked){this.nativeBatch.blocked=false;this.nativeBatch.serverRetryAt=0;this.drainNative(this.nativeBatch);}}
      if(this.activeProfileBatch || this.nativeBatch.blocked || this.batchAutoPaused && !this.pendingProfilePosts().length)return;
      if(!force && this.shownPublished()>=profileBatchSize && (!this.batchObserver || !this.profileTailVisible()))return;
      const posts=this.pendingProfilePosts().slice(0,profileBatchSize);
      if(!posts.length){const visible=this.visibleIds(),floor=this.publicationFloor(),waitingBoundary=this.renderedPosts.some(p=>!visible.has(p.fullname) && !this.publishedCards.has(itemKey(p)) && this.nodes.get(itemKey(p))?.dataset.deferred!=='older' && this.eligibleProfilePost(p,this.nodes.get(itemKey(p))) && !this.canPublishProfilePost(p,floor));if(!waitingBoundary && !this.mergePendingNodes.size && this.renderedPosts.some(p=>this.nodes.get(itemKey(p))?.dataset.deferred==='older'))return;if(this.hasMoreProfile() && (force || this.batchObserver && this.profileTailVisible()))this.loadMore();return;}
      const group=this.activeProfileBatch={generation:this.generation,nodes:posts.map(p=>this.nodes.get(itemKey(p))),posts,enriching:false};this.loading.hidden=false;
      for(const node of group.nodes)if(!['ready','failed'].includes(node.dataset.rtNativeState))this.queueNative(node);
      this.settleProfileBatch();
    }
    settleProfileBatch(){
      const group=this.activeProfileBatch;if(!group || group.enriching || group.generation!==this.generation || pageRoute()?.key!==this.context?.key)return;
      const visible=this.visibleIds(),floor=this.publicationFloor();let ready=0;
      while(ready<group.nodes.length && this.canPublishProfilePost(this.postMetadata.get(group.nodes[ready].dataset.key),floor) && (['ready','failed'].includes(group.nodes[ready].dataset.rtNativeState) || visible.has(group.nodes[ready].dataset.fullname)))ready++;
      if(!ready)return;
      // Publish only the ready prefix. A slow later card cannot hold earlier
      // content behind a whole-page barrier or reorder the feed on completion.
      // Native cards already on screen before this publish; only insertions above
      // one of them are animated.
      const shown=new Set(this.nativeEntries().filter(e=>!e.node.hidden && !e.node.hasAttribute('data-rt-order-pending') && !e.node.hasAttribute('data-rt-filter-hidden')).map(e=>e.node));
      const entering=group.nodes.splice(0,ready);for(const node of entering)this.publishedCards.add(node.dataset.key);
      if(!group.nodes.length){group.enriching=true;this.activeProfileBatch=null;const current=()=>group.generation===this.generation && pageRoute()?.key===this.context?.key && this.host?.isConnected;this.replyEnrichment=Promise.resolve(this.replyEnrichment).catch(()=>{}).then(()=>current()?this.enrichReplyContexts(group.posts,current):undefined);}
      this.deduplicate();this.animateEntrance(entering,shown);this.updateProfileLoading();
    }
    // Animate only cards that land between cards Reddit had already shown;
    // cards at the feed end or alongside a new native page just appear.
    animateEntrance(nodes,shown){
      const entering=new Set(nodes);
      for(const node of nodes){const slot=this.feedSlot(node);if(slot!==node || node.hidden || node.parentElement!==this.feed)continue;
        let next=node.nextElementSibling;while(next && (entering.has(next) || next.hidden || next.hasAttribute('data-rt-order-pending') || next.hasAttribute('data-rt-filter-hidden')))next=next.nextElementSibling;
        if(!next || !shown.has(next))continue;
        node.classList.add('rt-native-enter','rt-native-inserted');clearTimeout(node.rtEnterTimer);node.rtEnterTimer=setTimeout(()=>node.classList.remove('rt-native-enter','rt-native-inserted'),1500);
      }
    }
    // Reddit separates feed cards with one native rule after each card. Post
    // fragments bring theirs; comment fragments and our own fallbacks do not,
    // so add exactly one with Reddit's classes when the card has none.
    ensureCardRule(node){
      if(!node?.matches?.('.rt-native-card'))return;
      const own=node.querySelector(':scope > hr[data-rt-card-rule]'),native=[...node.querySelectorAll('hr')].some(rule=>rule!==own && !rule.closest('shreddit-post,shreddit-profile-comment'));
      if(native){own?.remove();return;}
      if(!own){const rule=make('hr','border-0 border-b-sm border-solid border-b-neutral-border-weak');rule.dataset.rtCardRule='true';node.append(rule);}
      else if(own!==node.lastElementChild)node.append(own);
    }
    indicator(post){
      const removed=['deleted','removed'].includes(post.status),label=removed?`${post.status==='deleted'?'Deleted':'Removed'} on Reddit`:post.source==='arctic-shift'?(post.status==='available'?'Not shown in this profile feed · Available on Reddit · Arctic Shift snapshot':'Arctic Shift snapshot · Current Reddit status unknown'):'Not shown in this profile feed · Found through public Reddit search';
      const badge=make('span','rt-post-indicator');badge.setAttribute('role','img');badge.setAttribute('aria-label',label);badge.title=label;badge.dataset.state=post.status;// One icon per real state: trash (deleted), ban (removed by moderators),
      // eye-slash (available but hidden from the profile). Archive-only items
      // with unconfirmed status are not on Reddit's profile; they get the archive icon,
      // since nothing shows they were deleted.
      badge.append(glyph(removed?post.status:post.source==='arctic-shift' && post.status!=='available'?'archive':'hidden'));return badge;
    }
    // Archive text for this exact item and author, never a placeholder.
    snapshotText(post){
      const archive=this.archived.get(itemKey(post)),own=archive?.source==='arctic-shift' && archive.fullname===post.fullname && archive.author?.toLowerCase()===this.context?.username?.toLowerCase();
      const text=post.archivedBody || (post.source==='arctic-shift'?post.body:'') || (own?archive.body:'');
      return text && !['[deleted]','[removed]'].includes(text)?text:'';
    }
    snapshot(text){const details=make('details','rt-post-snapshot');details.title='Text recovered from Arctic Shift · May differ from the current post';details.open=this.settings.restoreDeletedContent===true;details.append(make('summary','','Recovered text'),make('pre','',text));return details;}
    // The page is searched once per community. A miss is kept while the page's links
    // and images are unchanged (and for at most half a minute).
    communityAvatarUrl(subreddit){
      const name=subreddit.toLowerCase(),cached=avatarHints.get(name),shape=document.links.length+':'+document.images.length;if(cached && (cached.url || cached.shape===shape && Date.now()-cached.at<30000))return cached.url;
      const href='/r/'+name+'/',sample=[...document.querySelectorAll('shreddit-post[subreddit-name]')].find(n=>n.getAttribute('subreddit-name')?.toLowerCase()===name),hint=sample?.querySelector('[slot="credit-bar"] [avatar] img[src]') || [...document.querySelectorAll('a[href]')].find(a=>{try{return new URL(a.getAttribute('href'),location.origin).pathname.toLowerCase()===href && a.querySelector('img[src]');}catch{return false;}})?.querySelector('img[src]'),url=M.avatarUrl(hint?.getAttribute('src')) || '';
      if(avatarHints.size>=300)avatarHints.delete(avatarHints.keys().next().value);avatarHints.set(name,{url,shape,at:Date.now()});return url;
    }
    communityAvatar(subreddit){
      const avatar=make('span','inline-flex items-center justify-center w-lg h-lg relative shrink-0');avatar.setAttribute('avatar','');
      const url=this.communityAvatarUrl(subreddit);
      if(url){const image=make('img','mb-0 rounded-full overflow-hidden w-full h-full');image.src=url;image.alt='';image.width=image.height=24;image.loading='lazy';avatar.append(image);return avatar;}
      const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');for(const [key,value] of Object.entries({rpl:'',fill:'currentColor',height:'24',width:'24',viewBox:'0 0 20 20','icon-name':'community-fill','aria-hidden':'true'}))icon.setAttribute(key,value);
      const path=document.createElementNS(icon.namespaceURI,'path');path.setAttribute('d','M11.977 13.79h-1.955l4.549-10.715a.81.81 0 00-.381-1.032C12.447 1.12 10.37.747 8.179 1.18c-3.612.716-6.471 3.68-7.059 7.316a9.01 9.01 0 0010.409 10.377c3.735-.616 6.741-3.635 7.347-7.371.453-2.8-.388-5.405-2.017-7.322a.505.505 0 00-.853.119l-4.029 9.49ZM9.98 8.118a1.752 1.752 0 00-1.148.167 1.664 1.664 0 00-.651.596 1.703 1.703 0 00-.258.948v3.96H5.998V6.322h1.876v1.074h.035c.251-.344.567-.628.948-.851a2.55 2.55 0 011.311-.335c.172 0 .335.014.488.042.153.028.267.058.342.09l-.774 1.849a.766.766 0 00-.244-.073Z');icon.append(path);avatar.append(icon);return avatar;
    }
    renderArchivedNative(post,node){
      // Reddit may no longer serve a fragment for this identity. Reuse its own
      // card components, layout classes and action row with historical values.
      // Archive strings are always text, never server HTML or executable markup.
      const archived=this.archived.get(itemKey(post)),owned=archived?.author?.toLowerCase()===this.context?.username?.toLowerCase() && archived.fullname===post.fullname,media=post.archivedMedia || (post.media?.length?post.media:owned?archived.media:[]) || [];
      const signature=JSON.stringify([post.fullname,post.title,post.archivedBody || post.body,post.archivedBodyHtml || post.bodyHtml,media,post.over18,post.spoiler,post.score,post.comments,post.title,post.parentId,post.archiveAuthor || post.author]);
      this.archiveRenderSignatures ||= new WeakMap();const existing=node.querySelector('shreddit-post,shreddit-profile-comment');if(existing && this.archiveRenderSignatures.get(node)===signature)return existing;this.archiveRenderSignatures.set(node,signature);
      // Retire only this card's previous media bookkeeping before a data change.
      for(const figure of this.recoveredMedia || [])if(node.contains(figure))this.recoveredMedia.delete(figure);
      node.replaceChildren();node.dataset.rtArchiveFallback='true';node.dataset.rtNativeState='ready';node.removeAttribute('aria-busy');
      const isComment=post.kind==='comment',native=make(isComment?'shreddit-profile-comment':'shreddit-post');
      const snapshotText=!post.over18 && !post.spoiler && Boolean(post.archivedBody || post.body) && !deletionNotice((post.archivedBody || post.body).trim()),body=post.over18 || post.spoiler?'NSFW or spoiler snapshot · Open the source to review content restrictions.':snapshotText?(post.archivedBody || post.body):'The archive has no original text for this item.';
      const date=make('faceplate-timeago');date.setAttribute('ts',new Date(post.created*1000).toISOString());date.setAttribute('short','');
      const profileName=/^u_([\w-]{1,20})$/i.exec(post.subreddit)?.[1],community=link(profileName?'u/'+profileName:'r/'+post.subreddit,profileName?'/user/'+profileName+'/':'/r/'+encodeURIComponent(post.subreddit)+'/','font-semibold text-12 text-neutral-content-strong no-underline hover:underline');
      community.classList.add('inline-flex','items-center','gap-xs');community.prepend(profileName?this.profilePostAvatar(profileName):this.communityAvatar(post.subreddit));
      native.setAttribute('data-feed-element-id',post.fullname);
      if(isComment){
        native.className='w-full nd:visible rounded-4 my-2xs';native.setAttribute('comment-id',post.fullname);native.setAttribute('href',post.permalink);
        const inner=make('div','hover:bg-neutral-background-hover relative rounded-4'),padding=make('div','px-md py-sm'),credit=make('div','text-12 relative w-fit'),context=make('div','flex items-center');
        const heading=make('h2','inline-block m-0');heading.append(link(post.title || 'View post',post.permalink,'text-neutral-content-strong font-normal hover:underline'));
        context.append(community,make('span','px-2xs',' • '),heading);const identity=make('div','text-neutral-content-weak inline-block ms-xl mt-2xs');const info=make('span');info.id='poster-info-'+post.fullname;info.dataset.rtReplyInfo='true';identity.append(info,document.createTextNode(' '),date);credit.append(context,identity);
        const content=make('div','ms-[22px] mt-2xs ps-[10px] md'),text=make('div','md pt-xs pb-2xs break-words');text.append(snapshotText?this.archivedText(body,post.archivedBodyHtml || post.bodyHtml,media):make('p','',body));content.append(text);
        const actions=make('div','block ms-lg relative'),row=make('shreddit-comment-action-row','block');row.setAttribute('comment-id',post.fullname);row.setAttribute('score',String(post.score));row.setAttribute('permalink',post.permalink);row.setAttribute('telemetry-source','profile');row.setAttribute('vote-state','NONE');row.setAttribute('is-desktop-viewport','true');row.setAttribute('inert','');row.setAttribute('aria-disabled','true');row.title='Archived values · Current actions unavailable';
        const reply=link('',post.permalink,'button rpl-cab border-sm text-label-2 button-plain-weak inline-flex items-center px-sm py-xs');reply.slot='comment-reply';reply.style.height='var(--size-button-sm-h)';const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');for(const [key,value] of Object.entries({rpl:'','aria-hidden':'true','fill':'currentColor',height:'16',width:'16',viewBox:'0 0 20 20','icon-name':'comment'}))icon.setAttribute(key,value);const path=document.createElementNS(icon.namespaceURI,'path');path.setAttribute('d','M10 1a9 9 0 00-9 9c0 1.947.79 3.58 1.935 4.957L.231 17.661A.784.784 0 00.785 19H10a9 9 0 009-9 9 9 0 00-9-9Zm0 16.2H6.162c-.994.004-1.907.053-3.045.144l-.076-.188a36.981 36.981 0 002.328-2.087l-1.05-1.263C3.297 12.576 2.8 11.331 2.8 10c0-3.97 3.23-7.2 7.2-7.2s7.2 3.23 7.2 7.2-3.23 7.2-7.2 7.2Z');icon.append(path);const leading=make('span','flex text-body-1 me-2xs');leading.append(icon);reply.append(leading,make('span','rpl-cab--content','Reply'));
        const share=make('shreddit-comment-share-button');share.setAttribute('slot','comment-share');share.setAttribute('permalink',post.permalink);share.setAttribute('is-desktop-viewport','true');row.append(reply,share);actions.append(row);padding.append(credit,content,actions);inner.append(padding);native.append(inner);
      }else{
        native.className='block relative cursor-pointer group bg-neutral-background focus-within:bg-neutral-background-hover hover:bg-neutral-background-hover xs:rounded-4 px-md py-2xs my-2xs nd:visible';native.id=post.fullname;
        for(const [key,value] of Object.entries({'permalink':post.permalink,'view-context':'ProfileFeed2','view-type':'cardView','post-type':'text','post-title':post.title,'author':post.author,'subreddit-name':post.subreddit,'subreddit-prefixed-name':profileName?'u_'+profileName:'r/'+post.subreddit,'score':post.score,'comment-count':post.comments,'created-timestamp':new Date(post.created*1000).toISOString()}))native.setAttribute(key,String(value));
        if(post.author==='[deleted]')native.setAttribute('is-author-deleted','');const credit=make('span','flex justify-between text-12 min-h-[32px] mb-2xs -mt-2xs');credit.slot='credit-bar';const identity=make('span','flex items-center gap-xs');identity.append(community,document.createTextNode(' · '),date);credit.append(identity);
        const title=link(post.title,post.permalink,'block text-neutral-content-strong m-0 visited:text-neutral-content-weak font-semibold text-16-scalable xs:text-18-scalable mb-2xs xs:mb-xs overflow-hidden');title.slot='title';const content=make('div','md break-words');content.slot='text-body';if(snapshotText)content.append(this.archivedText(body,post.archivedBodyHtml || post.bodyHtml));else if(!media.length || post.over18 || post.spoiler)content.append(make('p','',body));
        if(media.length && !post.over18 && !post.spoiler){const grid=make('div','grid grid-cols-[1fr_min-content] grid-rows-[auto_auto_auto] gap-x-2xs'),header=make('div','col-start-1 col-end-3 row-start-1 row-end-2'),copy=make('div','col-start-1 col-end-2 row-start-2 row-end-3 overflow-hidden'),preview=make('div','col-start-2 col-end-3 row-start-2 row-end-3');header.append(credit);copy.append(title,content);grid.append(header,copy,preview);native.setAttribute('post-type','link');native.append(grid);this.recoverImage({...post,media},native);}else native.append(credit,title,content);
        // Keep the card inert until the native action bar is isolated. This
        // avoids even a frame of actionable voting on unverified snapshots.
        native.setAttribute('inert','');const disable=()=>{const bar=native.shadowRoot?.querySelector('rpl-action-bar');if(!bar)return false;bar.setAttribute('inert','');bar.setAttribute('aria-disabled','true');bar.title='Archived values · Current actions unavailable';native.removeAttribute('inert');return true;};
        if(!disable())requestAnimationFrame(()=>{if(!disable())requestAnimationFrame(disable);});
      }
      node.append(native);return native;
    }
    card(post){
      const card=make('div','rt-native-card');card.id='rt-native-'+crypto.randomUUID();card.dataset.rtUi='activity-item';card.dataset.postId=post.id;card.dataset.fullname=post.fullname;card.dataset.rtNativeFullname=post.fullname;card.dataset.rtNativeState='idle';card.dataset.key=itemKey(post);card.hidden=post.visible;
      card.setAttribute('aria-busy','true');
      card.append(this.placeholder());return card;
    }
    placeholder(){
      // Cards use quiet native shimmer rows. The animated Snoo belongs to the
      // feed, never repeated for every pending item.
      const placeholder=make('div','rt-native-placeholder');placeholder.setAttribute('aria-hidden','true');
      const avatar=make('faceplate-shimmer','h-lg w-lg rounded-full shrink-0'),lines=make('div','grow');avatar.setAttribute('shape','circle');lines.append(make('faceplate-shimmer','block rounded-2 h-md w-[200px] max-w-full'),make('faceplate-shimmer','block rounded-2 h-xs w-[160px] max-w-full mt-2xs'));placeholder.append(avatar,lines);return placeholder;
    }
    feedLoader(){
      const loader=make('shreddit-feed-page-loading','rt-native-loading');loader.setAttribute('page-type',this.context?.view==='comments'?'profile_comments':this.context?.view==='posts'?'profile_posts':'profile_overview');return loader;
    }
    observeNativeLoading(){
      const feed=this.feed;if(!feed)return;
      // The native feed/continuation can render a linear progress track as
      // well as its Snoo halo. Keep only the halo; never style card/media roots.
      const loaders=this.shellQuery('shreddit-feed-page-loading',{deep:true}),own=this.loading?.querySelector('shreddit-feed-page-loading');
      for(const root of [feed.shadowRoot,...(own?[...loaders,own]:loaders).map(node=>node.shadowRoot)].filter(Boolean)){
        if([...this.nativeLoadingStyles].some(style=>style.parentNode===root))continue;
        const style=make('style');style.dataset.rtUi='loading-style';style.textContent='faceplate-progress,progress{display:none!important}';root.append(style);this.nativeLoadingStyles.add(style);
      }
      const roots=[feed,feed.shadowRoot,...loaders.map(n=>n.shadowRoot)].filter(Boolean);if(this.nativeLoadingRoot?.feed===feed && roots.length===this.nativeLoadingRoot.roots.length && roots.every((root,i)=>root===this.nativeLoadingRoot.roots[i]))return;
      this.nativeLoadingObserver?.disconnect();this.nativeLoadingRoot={feed,roots};
      this.nativeLoadingObserver=new MutationObserver(records=>{
        // Viewport preservation writes and restores these inline feed styles.
        // Observing our own transaction would enqueue another transaction in
        // every mutation microtask and starve rendering/input indefinitely.
        if(this.loading && records.some(r=>!(r.type==='attributes' && r.attributeName==='style' && r.target===feed) && !this.ownsMutation(r)))this.updateProfileLoading();
      });
      for(const root of roots)this.nativeLoadingObserver.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','class','style']});
    }
    nativeFeedLoading(){
      const visible=node=>{
        if(this.loading?.contains(node) || this.feed?.hasAttribute('data-rt-merge-waiting') || node.closest('[data-rt-ui="activity-item"],[data-rt-filter-hidden],[data-rt-order-pending]'))return false;
        if(node.matches('shreddit-feed-page-loading') && node.shadowRoot && !node.shadowRoot.querySelector('shreddit-loading'))return false;
        // Computed style once for the loader itself; its ancestors are checked by
        // attribute, class and inline style, which is what hides them in practice.
        const style=getComputedStyle(node);if(style.display==='none' || style.visibility==='hidden')return false;
        for(let parent=node;parent;parent=parent.parentElement || parent.getRootNode()?.host)if(parent.hidden || parent.classList?.contains('hidden') || parent.style?.display==='none' || parent.style?.visibility==='hidden')return false;
        return true;
      };
      if(!this.feed)return false;
      return [...this.feed.shadowRoot?.querySelectorAll('shreddit-loading') || [],...this.shellQuery('shreddit-feed-page-loading,shreddit-loading',{deep:true})].some(visible);
    }
    profilePostAvatar(username){
      const avatar=make('span','inline-flex items-center justify-center w-lg h-lg relative shrink-0');avatar.setAttribute('avatar','');
      // Only profile-hosted posts use account artwork. Never modify Reddit's
      // server-rendered author/community markup or borrow another user's photo.
      const same=username.toLowerCase()===this.context.username.toLowerCase(),url=same?M.avatarUrl(this.avatarSlot?.querySelector('img')?.getAttribute('src') || document.querySelector('#profile-icon')?.getAttribute('src')):'';
      const image=make('img','mb-0 rounded-full object-contain w-full h-full');image.src=url || (same?unavailableAvatarUrl(this.accountState,this.archiveNotice):'https://www.redditstatic.com/avatars/defaults/v2/avatar_default_0.png');image.alt='';image.width=image.height=24;image.loading='lazy';avatar.append(image);return avatar;
    }
    queueNative(node){
      if(node.hidden && !this.activeProfileBatch?.nodes.includes(node) && node.dataset.rtQualify!=='true' || !node.isConnected || node.dataset.rtNativeState!=='idle')return;
      node.dataset.rtNativeState='queued';const batch=this.nativeBatch;batch.queue.push(node);
      // Collect the whole visibility notification before choosing the first card.
      if(!batch.scheduled){batch.scheduled=true;queueMicrotask(()=>{batch.scheduled=false;this.drainNative(batch);});}
    }
    drainNative(batch){
      if(batch!==this.nativeBatch || batch.blocked || pageRoute()?.key!==this.context?.key)return;
      if(batch.resumeAt>Date.now()){clearTimeout(this.nativeResumeTimer);this.nativeResumeTimer=setTimeout(()=>this.drainNative(batch),batch.resumeAt-Date.now());return;}
      // Comments use four bounded slots; heavier posts keep two. Publish the
      // ready prefix so parallel completions never reorder the visible feed.
      const order=new Map((this.activeProfileBatch?.nodes || []).map((node,index)=>[node,index]));
      batch.queue.sort((a,b)=>{const priority=(order.get(a) ?? Infinity)-(order.get(b) ?? Infinity);if(priority)return priority;const position=a.compareDocumentPosition(b);return position&4?-1:position&2?1:0;});
      while(batch.queue.length){
        const next=this.postMetadata.get(batch.queue[0].dataset.key),limit=this.batchedProfile?(next?.kind==='comment'?4:2):1;if(batch.active>=limit)break;
        const node=batch.queue.shift(),post=this.postMetadata.get(node.dataset.key),generation=this.generation;
        if(!post || node.hidden && !this.activeProfileBatch?.nodes.includes(node) && node.dataset.rtQualify!=='true' || !node.isConnected){node.dataset.rtNativeState='idle';continue;}
        if(this.nativeObserver && !this.activeProfileBatch?.nodes.includes(node) && node.dataset.rtQualify!=='true'){const rect=node.getBoundingClientRect();if(rect.top>innerHeight+400 || rect.bottom< -400){node.dataset.rtNativeState='idle';this.nativeObserver.observe(node);continue;}}
        batch.active++;node.dataset.rtNativeState='loading';
        const operation=this.nativeRenderer?this.nativeRenderer(post,node):this.request({action:'render-card',username:this.context.username,kind:post.kind==='comment'?'comment':'post',postId:post.id,target:node.id});
        Promise.resolve(operation).then(result=>{
          if(generation!==this.generation || pageRoute()?.key!==this.context?.key)return;
          if(!node.isConnected && (this.feedSlot(node)===node || !node.querySelector('shreddit-post,shreddit-profile-comment'))){if(this.feedSlot(node)!==node)node.dataset.rtNativeState='idle';return;}
          if(result?.deferred){
            node.dataset.rtNativeState='queued';batch.queue.push(node);const now=Date.now(),retryAt=now+Math.max(100,Math.min(3600000,Number(result.retryAfterMs)||1000));batch.resumeAt=Math.max(batch.resumeAt||0,retryAt);
            if(result.reason==='rate-limit'){
              if(batch.serverRetryAt && now>=batch.serverRetryAt){batch.blocked=true;this.setStatus('Reddit is limiting card requests. Select Refresh activity to retry.',true);this.updateProfileLoading();}
              else batch.serverRetryAt=retryAt;
            }
            return;
          }
          if(result?.duplicate){node.dataset.rtNativeState='idle';node.replaceChildren();node.removeAttribute('aria-busy');this.deduplicate();return;}
          if(['available','deleted','removed'].includes(result?.status) && result.fullname===post.fullname)this.postStatuses.set(post.fullname,result.status);
          node.dataset.rtNativeState='ready';this.nativeRetries.delete(node);delete node.dataset.rtQualify;node.removeAttribute('aria-busy');this.decorateNative(this.postMetadata.get(node.dataset.key) || post,node);
        },error=>{
          if(generation!==this.generation || pageRoute()?.key!==this.context?.key)return;
          if(!node.isConnected){if(this.feedSlot(node)!==node)node.dataset.rtNativeState='idle';return;}
          const transient=/^(Native card loading timed out\.|Public posts took too long to load\. Try again\.|Reddit could not render this card \(HTTP 50[0234]\)\.|Failed to fetch)$/.test(error?.message || '');
          if(transient && !this.nativeRetries.has(node)){this.nativeRetries.set(node,1);node.dataset.rtNativeState='queued';batch.queue.push(node);return;}
          if(node.dataset.rtQualify==='true'){delete node.dataset.rtQualify;this.sourceErrors.qualification='Some items could not be checked on Reddit.';}
          // Reddit no longer serves this item (deleted comments commonly 404).
          // With an archive snapshot, show it in Reddit's own card layout rather
          // than a bare link; the cue states where the text came from.
          // Reddit answers a comment its author deleted with no card at all (removed ones keep a "[removed]" card).
          const gone=error?.message==='Reddit no longer has this comment.';if(gone)this.postStatuses.set(post.fullname,'deleted');
          const latest=this.postMetadata.get(node.dataset.key) || post,snapshot=this.snapshotText(latest);
          if(this.archiveOnly && latest.source==='arctic-shift' || !transient && snapshot){const shown={...latest,archivedBody:snapshot || latest.archivedBody};this.renderArchivedNative(shown,node);this.decorateNative(shown,node);return;}
          node.dataset.rtNativeState='failed';node.removeAttribute('aria-busy');node.replaceChildren();
          const fallback=make('div','rt-native-unavailable px-md py-sm'),copy=make('div','min-w-0 flex flex-col');copy.append(link(latest.title || (latest.kind==='comment'?'View comment on Reddit':'View post on Reddit'),latest.permalink,'text-14 font-semibold text-neutral-content-strong no-underline hover:underline'),make('span','text-12 text-neutral-content-weak','Reddit couldn’t load this item right now.'));fallback.append(copy);
          const retry=button('Retry',()=>{this.nativeRetries.delete(node);node.dataset.rtNativeState='idle';this.queueNative(node);});retry.className='button button-small button-bordered';retry.title=error?.message || 'Reddit could not load this card.';fallback.append(retry);node.append(fallback);this.ensureCardRule(node);
        }).finally(()=>{batch.active--;
          // A render from a parked or replaced view must not reconcile the current one.
          if(batch!==this.nativeBatch)return;this.settleProfileBatch();this.deduplicate();this.drainNative(batch);this.updateProfileLoading();});
      }
    }
    forgetRecoveredBodies(){this.replyPatches=new Map();this.recoveredTitles=new Map();this.recoveredMedia=new Set();this.recoveredBodies=new Map();this.nativeDecorations=new Set();}
    restoreRecoveredBodies(){
      for(const [info,original] of this.replyPatches || [])if(info.hasAttribute('data-rt-reply-info')){info.replaceChildren(...original);delete info.dataset.rtReplyInfo;delete info.dataset.rtReplySignature;}this.replyPatches=new Map();
      for(const [body,patch] of this.recoveredBodies || [])if(body.contains(patch.recovered)){if(patch.created)body.remove();else body.replaceChildren(...patch.original);}
      for(const [node,original] of this.recoveredTitles || [])if(node.querySelector('[data-rt-recovered-text]'))node.replaceChildren(...original);this.recoveredTitles=new Map();
      for(const figure of this.recoveredMedia || [])figure.remove();this.recoveredMedia=new Set();
      for(const native of this.nativeDecorations || []){native.querySelector('[data-rt-source]')?.remove();native.querySelector('.rt-comment-source-credit')?.classList.remove('rt-comment-source-credit');native.querySelector('.rt-comment-source-host')?.classList.remove('rt-comment-source-host');}
      this.recoveredBodies=new Map();this.nativeDecorations=new Set();
    }
    // Show archived text where Reddit shows a deletion notice. The body can be
    // Reddit's rich-text block, a plain notice paragraph (current comments) or
    // missing entirely (removed posts), in which case Reddit's own text-body
    // slot receives it. Live text is never replaced.
    recoverBody(post,native){
      const text=post.archivedBody || (post.source==='arctic-shift'?post.body:''),html=post.archivedBody?post.archivedBodyHtml || '':post.source==='arctic-shift'?post.bodyHtml || '':'',media=post.kind==='comment'?(post.archivedMedia || post.media || []):undefined,mediaKey=JSON.stringify(media || []);
      if(!native || !text || deletionNotice(text.trim()) || post.over18 || post.spoiler || this.nativeRestrictions(native).restricted)return false;
      // An earlier restore in this card: keep it (the notice it replaced is gone).
      for(const prior of native.querySelectorAll('[data-rt-recovered-text]')){if(prior.closest('[slot="title"]'))continue;const patch=this.recoveredBodies.get(prior.parentElement);if(patch?.recovered===prior){if(prior.dataset.rtSourceText!==text || prior.dataset.rtSourceMedia!==mediaKey){const next=this.archivedText(text,html,media);next.dataset.rtOriginalText=prior.dataset.rtOriginalText || '';prior.replaceWith(next);patch.recovered=next;}return true;}}
      let body=native.querySelector(post.kind==='comment'?'[id$="-post-rtjson-content"],.md':'[slot="text-body"]'),created=false;
      const noticeParagraph=[...native.querySelectorAll('p')].find(p=>!p.closest('[data-rt-recovered-text],summary,[slot="commentMeta"],[slot="post-removed-banner"],[slot="title"]') && deletionNotice(p.textContent.trim()));
      if(noticeParagraph && (!body || !body.textContent.trim()))body=noticeParagraph.parentElement;
      if(!body && post.kind!=='comment' && ['deleted','removed'].includes(post.status)){body=make('div','md text-14 pb-xs');body.slot='text-body';created=true;}
      if(!body)return false;
      const copied=body.querySelector('[data-rt-recovered-text][data-rt-original-text]');if(copied && !this.recoveredBodies.has(body))this.recoveredBodies.set(body,{original:[document.createTextNode(copied.dataset.rtOriginalText)],recovered:copied});
      const existing=this.recoveredBodies.get(body);if(existing && body.contains(existing.recovered))return true;
      const current=body.textContent.trim();if(!created && !deletionNotice(current) && !(current==='' && ['deleted','removed'].includes(post.status)))return false;
      if(created){
        native.append(body);
        // Link-post layouts don't render text-body; use the next native slot that renders.
        for(const slot of ['post-recovery-section','post-removed-banner']){if(!native.shadowRoot || body.assignedSlot)break;body.slot=slot;}
        if(native.shadowRoot && !body.assignedSlot)body.removeAttribute('slot');
      }
      const recovered=this.archivedText(text,html,media);recovered.dataset.rtOriginalText=current;this.recoveredBodies.set(body,{original:[...body.childNodes],recovered,created});body.replaceChildren(recovered);return true;
    }
    // Archived markdown rendered like Reddit's body text (DOM nodes only).
    // Prefer the archive's server-rendered markdown (sanitized), then local rendering, then plain text.
    archivedText(text,html='',media){const el=make('div','rt-recovered-md');el.dataset.rtRecoveredText='true';el.dataset.rtSourceText=text;el.dataset.rtSourceMedia=JSON.stringify(media || []);const rendered=Array.isArray(media)?globalThis.RTMarkdown?.renderComment(text,html,media):globalThis.RTMarkdown?.fromHtml(html) || globalThis.RTMarkdown?.render(text);if(rendered)el.append(rendered);else el.append(make('p','whitespace-pre-wrap break-words',text));return el;}
    // Removed image posts lose their media in the card; Reddit-hosted images
    // usually remain, so show them where Reddit puts post media.
    recoverImage(value,native){
      if(!native || this.nativeRestrictions(native).restricted || native.querySelector('[slot="post-media-container"] img,[slot="post-media-container"] video,[slot="thumbnail"] img,.rt-archived-media,.rt-archive-media-group'))return false;
      const post=typeof value==='object'?value:null,items=post?.media || (M.mediaUrl(value)?[{kind:'image',url:M.mediaUrl(value)}]:[]);if(!items.length)return false;
      // Modern profile link cards render their thumbnail in a light-DOM grid,
      // not a named shadow slot. Put the archive preview in that existing cell.
      const grid=[...native.children].find(n=>n.classList.contains('grid') && n.className.includes('grid-cols-[1fr_min-content]')),cell=grid && [...grid.children].find(n=>n.className.includes('col-start-2') && n.className.includes('row-start-2'));
      const compact=Boolean(cell) || items.every(item=>['preview','thumbnail'].includes(item.kind));
      let figure=globalThis.RTArchiveView?.media(items,{alt:native.getAttribute('post-title') || post?.title || '',compact,postId:post?.id || native.id,href:post?.url || post?.permalink || ''});
      if(!figure){const image=items.find(item=>item.kind==='image' && M.mediaUrl(item.url));if(!image)return false;figure=make('figure','rt-archived-media');figure.dataset.rtRecoveredText='true';const img=make('img');img.src=M.mediaUrl(image.url);img.alt='';img.loading='lazy';img.decoding='async';img.referrerPolicy='no-referrer';figure.append(img);}
      if(cell)cell.append(figure);else{native.append(figure);for(const slot of compact?['thumbnail','post-media-container','post-recovery-section']:['post-media-container','post-recovery-section','text-body']){figure.slot=slot;if(!native.shadowRoot || figure.assignedSlot)break;}if(native.shadowRoot && !figure.assignedSlot)figure.removeAttribute('slot');}
      (this.recoveredMedia ||= new Set()).add(figure);return true;
    }
    // Removed posts show "[ Removed by moderator ]" as their title.
    recoverTitle(title,native){
      const node=native?.querySelector('[slot="title"]');if(!node || !title || deletionNotice(title.trim()) || !deletionNotice(node.textContent.trim()))return false;
      this.recoveredTitles ||= new Map();if(!this.recoveredTitles.has(node))this.recoveredTitles.set(node,[...node.childNodes]);
      const text=make('span','',title);text.dataset.rtRecoveredText='true';node.replaceChildren(text);return true;
    }
    async enrichReplyContexts(posts,current=()=>true){
      const comments=posts.filter(p=>{if(p.kind!=='comment')return false;const info=this.nodes.get(itemKey(p))?.querySelector('[id^="poster-info-"]');return !info?.textContent.trim() || info.hasAttribute('data-rt-reply-info');});if(!comments.length)return;
      // Seed the join from records already in memory before requesting anything.
      for(const p of [...this.live.values(),...this.archived.values()])if(p.kind==='comment' && M.validateUsername(p.author))this.replyAuthors.set(p.fullname,{author:p.author,linkId:p.linkId});
      const missing=comments.filter(p=>!p.parentId && !this.replyContexts.has(p.fullname));
      if(missing.length){try{const result=await this.request({action:'info',kind:'comment',ids:missing.slice(0,25).map(p=>p.id)});if(!current())return;for(const raw of result.posts || []){const p=M.normalizeComment(raw),original=missing.find(c=>c.fullname===p?.fullname && c.linkId===p.linkId);if(original)this.replyContexts.set(p.fullname,{parentId:p.parentId,linkId:p.linkId});}}catch{if(!current())return;}}
      const parents=new Set();for(const p of comments){const parentId=p.parentId || this.replyContexts.get(p.fullname)?.parentId;if(/^t1_[a-z0-9]{1,32}$/i.test(parentId || '') && !this.replyAuthors.has(parentId))parents.add(parentId);}
      if(parents.size){try{const ids=[...parents].slice(0,25),result=await this.request({action:'info',kind:'comment',ids});if(!current())return;for(const id of ids)this.replyAuthors.set(id,{author:'',linkId:''});for(const raw of result.posts || []){const p=M.normalizeComment(raw);if(p && parents.has(p.fullname) && (M.validateUsername(p.author) || p.author==='[deleted]'))this.replyAuthors.set(p.fullname,{author:p.author,linkId:p.linkId});}}catch{if(!current())return;}}
      for(const id of parents)if(!this.replyAuthors.has(id))this.replyAuthors.set(id,{author:'',linkId:''});
      if(this.settings.archiveDiscovery){
        const unresolved=comments.filter(p=>{const id=p.parentId || this.replyContexts.get(p.fullname)?.parentId;return /^t1_[a-z0-9]{1,32}$/.test(id || '') && !M.validateUsername(this.replyAuthors.get(id)?.author) && !this.replyArchiveChecked.has(id);});
        if(unresolved.length){const asked=unresolved.slice(0,25),parentOf=p=>p.parentId || this.replyContexts.get(p.fullname)?.parentId,markChecked=()=>{for(const p of asked)this.replyArchiveChecked.add(parentOf(p));};try{const result=await this.archive({action:'archive-parents',username:this.context.username,children:asked.map(p=>p.id)});if(!current())return;markChecked();this.clearSourceRetries(name=>name==='replies');for(const raw of result.posts || []){const p=M.normalizeComment(raw,{source:'arctic-shift'});if(p && unresolved.some(child=>(child.parentId || this.replyContexts.get(child.fullname)?.parentId)===p.fullname && child.linkId===p.linkId) && M.validateUsername(p.author))this.replyAuthors.set(p.fullname,{author:p.author,linkId:p.linkId});}}catch(error){if(!current())return;
          // Unanswered requests stay unchecked while a quiet retry is pending.
          if(!(this.transientFailure(error,'archive') && this.scheduleSourceRetry('replies',error,'archive')))markChecked();}}
      }
      if(current())for(const p of comments){const node=this.nodes.get(itemKey(p));if(node)this.repairReplyInfo(p,node.querySelector('shreddit-profile-comment'));}
    }
    retryReplyEnrichment(){
      const generation=this.generation,current=()=>generation===this.generation && pageRoute()?.key===this.context?.key && this.host?.isConnected;
      const comments=(this.renderedPosts || []).filter(p=>p.kind==='comment' && this.publishedCards.has(itemKey(p)));
      return this.replyEnrichment=Promise.resolve(this.replyEnrichment).catch(()=>{}).then(()=>current()?this.enrichReplyContexts(comments,current):undefined);
    }
    repairReplyInfo(post,native){
      if(post.kind!=='comment' || !native)return;
      const info=native.querySelector('[id^="poster-info-"]');if(!info || info.textContent.trim() && !info.hasAttribute('data-rt-reply-info'))return;
      const parentId=post.parentId || this.replyContexts.get(post.fullname)?.parentId,parent=this.replyAuthors.get(parentId),replyTo=parent?.linkId===post.linkId?parent.author:'',author=post.archiveAuthor || post.author;
      if(!M.validateUsername(author) && author!=='[deleted]')return;
      const signature=[author,parentId,replyTo].join(':');if(info.dataset.rtReplySignature===signature)return;
      this.replyPatches ||= new Map();if(!this.replyPatches.has(info))this.replyPatches.set(info,[...info.childNodes]);
      const identity=username=>M.validateUsername(username)?link(username,'/user/'+username+'/','font-bold text-12 hover:underline text-tone-1 inline-flex items-center'):document.createTextNode('[deleted]');
      const reply=/^t1_[a-z0-9]{1,32}$/i.test(parentId || '');info.replaceChildren(identity(author),document.createTextNode(reply?(replyTo?' replied to ':' replied'):' commented'));if(reply && replyTo)info.append(identity(replyTo));info.dataset.rtReplyInfo='true';info.dataset.rtReplySignature=signature;
    }
    decorateNative(post,node){
      node.querySelector('[data-rt-archive]')?.remove();this.ensureCardRule(node);
      const native=node.matches('shreddit-post,shreddit-profile-comment')?node:node.querySelector('shreddit-post,shreddit-profile-comment');if(!native)return;
      post={...post,status:this.verifiedStatus(post,native)};
      // Discovery-only HTML has no full body/deletion proof. Once the actual
      // native card proves deletion, a separately obtained archive can restore
      // its text even though the search record itself still has unknown status.
      const archive=this.archived.get(itemKey(post));
      const owned=this.context.kind==='profile' && ['deleted','removed'].includes(post.status) && archive?.source==='arctic-shift' && archive.fullname===post.fullname && archive.author.toLowerCase()===this.context.username.toLowerCase();
      if(owned)post={...post,archivedBody:post.archivedBody || archive.body,archivedBodyHtml:post.archivedBodyHtml || archive.bodyHtml,archivedMedia:archive.media,over18:post.over18 || archive.over18,spoiler:post.spoiler || archive.spoiler};
      const fallback=node.dataset?.rtArchiveFallback==='true',fallbackMedia=fallback && archive?.fullname===post.fullname && archive.author?.toLowerCase()===this.context.username?.toLowerCase()?archive:post;
      this.repairReplyInfo(post,native);const recovered=this.recoverBody(post,native),titled=owned && post.kind!=='comment' && !post.over18 && !post.spoiler && this.recoverTitle(archive.title,native),pictured=(owned || fallback) && post.kind!=='comment' && !post.over18 && !post.spoiler && this.recoverImage(owned?archive:fallbackMedia,native),label=this.indicator(post);
      const titleShown=titled || Boolean(this.recoveredTitles?.has(native.querySelector('[slot="title"]')));if(recovered)label.title+=' · Text recovered from Arctic Shift';else if(titleShown)label.title+=' · Title recovered from Arctic Shift';else if(fallback && post.source!=='arctic-shift')label.title+=' · Text from an Arctic Shift snapshot';
      const retrieved=archive?.retrieved || post.retrieved;if(retrieved && (recovered || titleShown || fallback || post.source==='arctic-shift'))label.title+=' · Snapshot from '+new Date(retrieved*1000).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});
      label.setAttribute('aria-label',label.title);
      let badge=node.querySelector('[data-rt-source]');if(!badge || badge.title!==label.title){if(badge)badge.replaceWith(label);badge=label;badge.dataset.rtSource='true';}
      if(native.matches('shreddit-profile-comment')){
        const host=native.firstElementChild || native,credit=host.querySelector('.text-12.relative') || host.firstElementChild;host.classList.add('rt-comment-source-host');credit?.classList.add('rt-comment-source-credit');if(badge.parentElement!==host)host.append(badge);
      }else{
        const credit=native.querySelector('[slot="credit-bar"]') || native;
        // Reddit's credit slot is display:contents, so anything appended to it
        // becomes its own grid item on a new line. Join the inner credit row
        // (subreddit, time, pin) as its last inline item instead.
        const row=credit.querySelector(':scope > [id^="feed-post-credit-bar-"], :scope > * > [id^="feed-post-credit-bar-"]') || (credit.matches('.contents')?credit.querySelector(':scope > .flex'):null),scope=row || credit;
        let actions=scope.querySelector('shreddit-post-overflow-menu');while(actions && actions.parentElement!==scope)actions=actions.parentElement;
        if(actions){if(badge.parentElement!==actions)actions.prepend(badge);}
        else if(row){if(badge.parentElement!==row || badge!==row.lastElementChild){badge.style.marginInlineStart='';row.append(badge);}}
        else if(badge.parentElement!==credit){badge.style.marginInlineStart='auto';credit.append(badge);}
      }
    }
    maybeRestoreDetail(){
      if(!this.autoDiscover || this.context?.kind!=='post' || !this.settings.archiveDiscovery || !this.settings.restoreDeletedContent || this.detailRecoveryStarted)return;
      const context=this.context,native=document.querySelector('main shreddit-post[id="t3_'+context.id+'"]');
      if(!['deleted','removed'].includes(this.verifiedStatus({fullname:'t3_'+context.id,status:'unknown'},native)))return;
      this.detailRecoveryStarted=true;const generation=this.generation;queueMicrotask(()=>{if(generation===this.generation && pageRoute()?.key===context.key && this.host?.isConnected)this.loadDetail();});
    }
    loadDetail(){if(!this.settings.archiveDiscovery)return;return this.run(async current=>{
      const id=this.context.id,result=await this.archive({action:'archive-ids',ids:[id]});if(!current())return;
      const archived=(result.posts || []).map(p=>M.normalizePost(p,{source:'arctic-shift'})).find(p=>p?.id===id);
      if(!archived){this.setStatus('No archived snapshot is available for this post.');return;}
      const native=document.querySelector('shreddit-post[id="t3_'+id+'"]'),status=this.verifiedStatus({fullname:'t3_'+id,status:'unknown'},native);const restrictions=this.nativeRestrictions(native);let live=['deleted','removed'].includes(status)?{...archived,status,source:'reddit',over18:archived.over18 || restrictions.over18,spoiler:archived.spoiler || restrictions.spoiler}:null;try{if(!live){const response=await this.request({action:'info',ids:[id]});live=response.posts?.map(p=>M.normalizePost(p,{source:'reddit'})).find(p=>p?.id===id);}}catch{ /* An archive is never proof of current removal. */ }
      if(!current())return;
      this.results.replaceChildren();
      if(live?.status==='available'){this.setStatus('This post is available on Reddit. Its live content is unchanged.');return;}
      // Restore inside Reddit's own post element when the snapshot belongs to the same author.
      const nativeAuthor=native?.getAttribute('author') || '',sameAuthor=!nativeAuthor || nativeAuthor==='[deleted]' || nativeAuthor.toLowerCase()===archived.author.toLowerCase();
      if(native && live && sameAuthor && this.settings.restoreDeletedContent){
        const shown={...live,archivedBody:archived.body,archivedBodyHtml:archived.bodyHtml,over18:live.over18 || archived.over18,spoiler:live.spoiler || archived.spoiler},safe=!shown.over18 && !shown.spoiler && !restrictions.restricted;
        const body=this.recoverBody(shown,native),titled=safe && this.recoverTitle(archived.title,native);
        if(body || titled){this.nativeDecorations.add(native);this.decorateNative({...live,archivedBody:archived.body,retrieved:archived.retrieved},native);this.setStatus(body?'Available archived text restored.':'Archived title restored.');return;}
      }
      const note=make('div','rt-post-snapshot');note.append(this.indicator(live || archived));
      if(archived.over18 || archived.spoiler || live?.over18 || live?.spoiler || restrictions.restricted)note.append(make('p','rt-post-source','NSFW or spoiler snapshot · open the post’s source to review content restrictions.'));
      else if(archived.body && !['[deleted]','[removed]'].includes(archived.body))note.append(this.snapshot(archived.body));else note.append(make('p','rt-post-source','The archive has no original text for this post.'));
      this.results.append(note);this.setStatus(live?`${live.status==='deleted'?'Deleted':'Removed'} on Reddit · Separate archived snapshot`:'Archived snapshot · Current Reddit status unknown');
    });}
    destroy(){this.dead=true;this.discardAllParked();this.avatarUnsubscribe?.();clearTimeout(this.timer);this.observer?.disconnect();
      // An orphaned script can no longer reach its extension's APIs.
      try{globalThis.chrome?.runtime?.onMessage?.removeListener?.(this.onWorkerSettings);}catch{}try{globalThis.chrome?.storage?.onChanged?.removeListener?.(this.onSettings);}catch{}
      window.removeEventListener('popstate',this.onRoute);document.removeEventListener('reddit:route',this.onRoute);this.reset({retainNavigation:false});document.documentElement.removeAttribute('data-rt-profile-discovery');}
  }
  globalThis.RTPostDiscovery=Object.freeze({Discovery,pageRoute,glyph,redditRead});
  // Debug handle in the extension's isolated world only (not visible to Reddit's page).
  if(window.top===window && globalThis.chrome?.runtime?.id)Object.defineProperty(globalThis,'RTDiscoveryDebug',{value:new Discovery()});
})();
