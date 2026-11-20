/* Smooth scrolling across Reddit (docs/smooth-feeds-sitewide-spec.md). A mounted unit more than two screens away gets content-visibility:hidden at its
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
 // Lists the extension renders itself: profile search and discovery rows, archive cards (measured 2026-11-19: 100 profile
 // search results on a 6,735 px page were never smoothed). The bridge keeps the profile feeds it owns.
 const OWN='[data-rt-ui="activity-item"], [data-rt-ui="archive-item"], [data-rt-ui="posts"] .rt-native-card, [data-rt-ui="archive-subreddit"] .rt-native-card';
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
 const selectorFor=name=>(name==='comments'?UNITS.comments:name==='search'?UNITS.search:UNITS.feed)+', '+OWN;

 class Smooth{
  constructor({doc=document,readSettings,observe=true}={}){
   this.doc=doc;this.settings=null;this.dead=false;this.observed=new Set();this.pending=new Set();this.frame=0;this.currentArea=null;this.active=false;
   // Touch screens do not skip anything. Measured on a phone-emulated Videos feed (2026-11-19, the user flicking, 45 s
   // each way): skipping left 8.8 % of frames at least half blank against 1.0 % without it. Throughput was 3.0 vs
   // 2.1 fps, with Reddit saturating the main thread either way. A flick outruns the redraw.
   // Re-tested with the other optimisations in place (2026-11-19, the user flicking): skipping on touch left 37.8 % of
   // moving frames at least half blank against 1.4 % without it.
   this.touch=Boolean(globalThis.matchMedia?.('(hover: none), (pointer: coarse)')?.matches);
   this.io=typeof IntersectionObserver==='function' && !this.touch?new IntersectionObserver(entries=>this.onIntersect(entries),{rootMargin:'200% 0px 200% 0px'}):null;
   this.mo=observe && this.io?new MutationObserver(records=>{
    for(const record of records)for(const node of record.addedNodes)if(node.nodeType===1)this.pending.add(node);
    if(this.pending.size)this.schedule();
   }):null;
   this.onRoute=()=>this.sync();addEventListener('popstate',this.onRoute);doc.addEventListener('reddit:route',this.onRoute);
   this.ready=(readSettings?readSettings():Promise.resolve({})).then(s=>{this.configure(s);},()=>{this.configure({});});
  }
  configure(settings){
   this.settings=settings || {};this.sync();
  }
  sync(){
   if(!this.settings || this.dead)return;
   const name=area(),active=enabled(this.settings,name);
   // The page bridge uses measurement caches while the current area's Smooth scrolling option is enabled.
   this.doc.documentElement.toggleAttribute('data-rt-smooth-site',active);
   if(!this.io)return;
   if(name!==this.currentArea || !active){this.pending.clear();this.clear();}
   this.currentArea=name;this.active=active;
   if(!active){this.mo?.disconnect();return;}
   this.mo?.observe(this.doc.documentElement,{childList:true,subtree:true});
   for(const unit of this.doc.querySelectorAll(selectorFor(name)))this.watch(unit);
  }
  schedule(){if(this.frame || this.dead)return;this.frame=(globalThis.requestAnimationFrame || (fn=>setTimeout(fn,16)))(()=>{this.frame=0;this.flush();});}
  flush(){
   if(this.dead || !this.active)return;
   const nodes=[...this.pending];this.pending.clear();const selector=selectorFor(this.currentArea);
   for(const node of nodes){if(!node.isConnected)continue;if(node.matches?.(selector))this.watch(node);for(const unit of node.querySelectorAll?.(selector) || [])this.watch(unit);}
  }
  watch(unit){
   if(this.observed.has(unit) || !this.io)return;
   // The extension's own profile feeds are handled by its page-world bridge; its own UI is never touched.
   if(unit.closest('shreddit-feed[data-rt-loading-owner]'))return;
   const own=unit.matches(OWN);
   if(!own && unit.closest('[data-rt-ui]'))return;
   if(own && unit.matches('.rt-native-card') && unit.parentElement?.closest('[data-rt-ui="activity-item"],[data-rt-ui="archive-item"]'))return;
   this.observed.add(unit);unit.setAttribute('data-rt-smooth','');this.io.observe(unit);
  }
  onIntersect(entries){
   for(const entry of entries){
    const unit=entry.target,height=Math.round(entry.boundingClientRect?.height || 0);
    if(!this.observed.has(unit))continue;
    if(!unit.isConnected){this.io.unobserve(unit);this.observed.delete(unit);continue;}
    if(entry.isIntersecting || unit.contains(this.doc.activeElement)){if(unit.hasAttribute('data-rt-skip'))unit.removeAttribute('data-rt-skip');continue;}
    if(height>0 && !unit.hasAttribute('data-rt-skip')){unit.style.containIntrinsicSize='auto '+height+'px';unit.setAttribute('data-rt-skip','');}
   }
  }
  clear(){for(const unit of this.observed){this.io?.unobserve(unit);unit.removeAttribute('data-rt-skip');unit.removeAttribute('data-rt-smooth');unit.style.removeProperty('contain-intrinsic-size');}this.observed.clear();this.io?.takeRecords?.();}
  destroy(){this.dead=true;this.doc.documentElement.removeAttribute('data-rt-smooth-site');this.mo?.disconnect();this.pending.clear();this.clear();this.io?.disconnect();removeEventListener('popstate',this.onRoute);this.doc.removeEventListener('reddit:route',this.onRoute);}
 }
 globalThis.RTSmoothScroll=Object.freeze({Smooth,area,enabled});
 if(globalThis.chrome?.runtime?.id && !globalThis.__rtSmoothScrollTest){
  const read=async()=>{const r=await chrome.runtime.sendMessage({scope:'rt-posts',action:'get-settings'});return r?.ok?r.settings:{};};
  const smooth=new Smooth({readSettings:read});
  chrome.runtime.onMessage.addListener((message,sender)=>{if(message?.scope==='rt-posts' && message.action==='settings-changed' && sender?.id===chrome.runtime.id)smooth.configure(message.settings);});
 }
})();
