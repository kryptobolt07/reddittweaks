/* Smooth scrolling across Reddit (docs/smooth-feeds-sitewide-spec.md). Reddit keeps every loaded post and comment laid
   out and painted however far away it is. A unit more than two screens away gets content-visibility:hidden at its
   measured height ([data-rt-smooth][data-rt-skip] in post-discovery.css), so the page keeps its height and scroll
   position while the browser skips its layout and paint; it is drawn again before it comes back on screen.
   Profile feeds the extension manages keep the page-world feed bridge (shreddit-feed[data-rt-loading-owner]). */
(() => {
 'use strict';
 if(globalThis.RTSmoothScroll || window.top!==window)return;
 const UNITS={
  feed:'shreddit-feed article, shreddit-feed shreddit-ad-post',
  search:'[data-testid="sdui-post-unit"]',
  comments:'shreddit-comment[depth="0"]'
 };
 const ALL=Object.values(UNITS).join(',');
 // Which sub-option governs this page.
 function area(path=location.pathname){
  // Post pages carry the post ID after /comments/; a profile's Comments tab (/user/x/comments/) does not.
  if(/\/comments\/[a-z0-9]+(\/|$)/i.test(path))return 'comments';
  if(/(^|\/)search\/?$/.test(path))return 'search';
  if(/^\/user\/[^/]+(\/(submitted|comments|overview|saved|hidden|upvoted|downvoted|history|gilded))?\/?$/i.test(path))return 'profiles';
  if(/^\/r\/(popular|all)(\/|$)/i.test(path))return 'home';
  if(/^\/r\/[^/]+/i.test(path))return 'subreddits';
  return 'home';
 }
 const KEYS={home:'smoothHome',subreddits:'smoothSubreddits',profiles:'smoothProfiles',search:'smoothSearch',comments:'smoothComments'};
 const enabled=(settings,name)=>settings?.smoothFeeds!==false && (name==='comments'?settings?.[KEYS[name]]===true:settings?.[KEYS[name]]!==false);
 const selectorFor=name=>name==='comments'?UNITS.comments:name==='search'?UNITS.search:UNITS.feed;

 class Smooth{
  constructor({doc=document,readSettings,observe=true}={}){
   this.doc=doc;this.settings=null;this.dead=false;this.observed=new Set();this.pending=new Set();this.frame=0;
   this.io=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>this.onIntersect(entries),{rootMargin:'200% 0px 200% 0px'}):null;
   this.mo=observe?new MutationObserver(records=>{for(const r of records)for(const node of r.addedNodes)if(node.nodeType===1)this.pending.add(node);this.schedule();}):null;
   this.mo?.observe(doc.documentElement,{childList:true,subtree:true});
   this.onRoute=()=>this.rescan();addEventListener('popstate',this.onRoute);
   this.ready=(readSettings?readSettings():Promise.resolve({})).then(s=>{this.configure(s);},()=>{this.configure({});});
  }
  configure(settings){
   this.settings=settings || {};if(this.dead)return;
   if(!enabled(this.settings,area()))this.clear();this.rescan();
  }
  schedule(){if(this.frame || this.dead)return;this.frame=(globalThis.requestAnimationFrame || (fn=>setTimeout(fn,16)))(()=>{this.frame=0;this.flush();});}
  flush(){
   const nodes=[...this.pending];this.pending.clear();if(!this.settings)return;
   const name=area();if(!enabled(this.settings,name))return;const selector=selectorFor(name);
   for(const node of nodes){if(!node.isConnected)continue;if(node.matches?.(selector))this.watch(node);for(const unit of node.querySelectorAll?.(selector) || [])this.watch(unit);}
  }
  rescan(){if(!this.settings || this.dead)return;const name=area();if(!enabled(this.settings,name))return;for(const unit of this.doc.querySelectorAll(selectorFor(name)))this.watch(unit);}
  watch(unit){
   if(this.observed.has(unit) || !this.io)return;
   // The extension's own profile feeds are handled by its page-world bridge; its own UI is never touched.
   if(unit.closest('shreddit-feed[data-rt-loading-owner],[data-rt-ui]'))return;
   this.observed.add(unit);unit.setAttribute('data-rt-smooth','');this.io.observe(unit);
  }
  onIntersect(entries){
   for(const entry of entries){
    const unit=entry.target,height=Math.round(entry.boundingClientRect?.height || 0);
    if(!unit.isConnected){this.io.unobserve(unit);this.observed.delete(unit);continue;}
    if(entry.isIntersecting || unit.contains(this.doc.activeElement)){if(unit.hasAttribute('data-rt-skip'))unit.removeAttribute('data-rt-skip');continue;}
    if(height>0 && !unit.hasAttribute('data-rt-skip')){unit.style.containIntrinsicSize='auto '+height+'px';unit.setAttribute('data-rt-skip','');}
   }
  }
  clear(){for(const unit of this.observed){this.io?.unobserve(unit);unit.removeAttribute('data-rt-skip');unit.removeAttribute('data-rt-smooth');unit.style.removeProperty('contain-intrinsic-size');}this.observed.clear();}
  destroy(){this.dead=true;this.mo?.disconnect();this.clear();this.io?.disconnect();removeEventListener('popstate',this.onRoute);}
 }
 globalThis.RTSmoothScroll=Object.freeze({Smooth,area,enabled});
 if(globalThis.chrome?.runtime?.id && !globalThis.__rtSmoothScrollTest){
  const read=async()=>{const r=await chrome.runtime.sendMessage({scope:'rt-posts',action:'get-settings'});return r?.ok?r.settings:{};};
  const smooth=new Smooth({readSettings:read});
  chrome.runtime.onMessage.addListener((message,sender)=>{if(message?.scope==='rt-posts' && message.action==='settings-changed' && sender?.id===chrome.runtime.id)smooth.configure(message.settings);});
 }
})();
