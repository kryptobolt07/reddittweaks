/* Videos (docs/video-control-spec.md): enforce Reddit's own "Autoplay media" off, which its phone layout ignores, and
   pause a playing video as soon as it is mostly scrolled away. Reddit's player (shreddit-player) keeps its <video> in
   an open shadow root and starts it from script, so its non-bubbling play event is caught there in the capture phase. */
(() => {
 'use strict';
 if(globalThis.RTVideoControl || window.top!==window)return;
 const PLAYERS='shreddit-player, shreddit-player-2',GESTURE_MS=1500,PREVIEW_S=10,PREF_KEY='rt-video-autoplay-v1',PREF_TTL=3600000,CONTINUE_KEY='rt-video-continue-v1',CONTINUE_MS=12000;
 const FEED_PLAYER='in_feed_player',DETAIL_PLAYER='post_detail_screen';
 const postId=path=>/^\/(?:r\/[^/]+\/|user\/[^/]+\/)?comments\/([a-z0-9]{1,10})(?:\/|$)/i.exec(path)?.[1].toLowerCase() || '';
 const playback=video=>({time:video.currentTime,muted:video.muted,volume:video.volume,rate:video.playbackRate});
 const owner=doc=>{const app=doc.querySelector('shreddit-app'),id=(app?.getAttribute('logged-in-user-id') || '').toLowerCase();return app?.getAttribute('user-logged-in')==='true' && /^t2_[a-z0-9]{1,13}$/.test(id)?id:'';};
 // Reddit's preference, from its settings page (the prefs API needs a token the page does not expose).
 async function readAutoplayDisabled({doc=document,fetcher=globalThis.fetch,store=globalThis.sessionStorage}={}){
  const me=owner(doc);if(!me)return null;
  try{const saved=JSON.parse(store?.getItem(PREF_KEY) || 'null');if(saved?.owner===me && Date.now()-saved.at<PREF_TTL && typeof saved.disabled==='boolean')return saved.disabled;}catch{}
  try{
   const html=await (await fetcher('/settings/preferences',{credentials:'include',cache:'no-store'})).text();
   const match=/isVideoAutoplayDisabled(?:&quot;|")\s*:\s*(true|false)/.exec(html);if(!match)return null;const disabled=match[1]==='true';
   try{store?.setItem(PREF_KEY,JSON.stringify({owner:me,disabled,at:Date.now()}));}catch{}
   return disabled;
  }catch{return null;}
 }
 class Videos{
  constructor({doc=document,readSettings,readPreference=readAutoplayDisabled,observe=true}={}){
   this.doc=doc;this.win=doc.defaultView;this.settings={};this.autoplayDisabled=null;this.players=new Set();this.attached=new WeakSet();this.previews=new Map();this.started=new WeakSet();this.continued=new WeakSet();this.gesture={at:-Infinity,path:[]};this.dead=false;
   this.onGesture=event=>{
    if(!event.isTrusted && !globalThis.__rtVideoControlTest)return;
    const path=event.composedPath();
    this.gesture={at:performance.now(),path};
    const player=path.find(node=>node.matches?.(PLAYERS));
    if(!player)return;
    this.attach(player);
    const video=this.video(player);
    if(video && (!video.paused || this.previews.has(player)))this.started.add(video);
    if(this.previews.has(player))this.endPreview(player);
   };
   this.onRemember=event=>this.remember(event);
   this.onRoute=()=>this.handoff();
   this.onBack=()=>this.clearHandoff();
   this.onPageExit=()=>{
    const pending=this.activeHandoff();
    if(pending?.sourceVideo){
     this.updatePlayback(pending);
     this.saveHandoff();
    }
    this.pending=null;
   };
   for(const type of ['pointerdown','keydown','click'])doc.addEventListener(type,this.onGesture,true);
   doc.addEventListener('click',this.onRemember,true);
   doc.addEventListener('reddit:route',this.onRoute);
   this.win.addEventListener('popstate',this.onBack);
   this.win.addEventListener('pagehide',this.onPageExit);
   this.io=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>this.onVisibility(entries),{threshold:[0,0.5,1]}):null;
   this.mo=observe?new MutationObserver(()=>{this.handoff();this.schedule();}):null;
   this.mo?.observe(doc.documentElement,{childList:true,subtree:true});
   this.readPreference=readPreference;this.preference=null;
   this.ready=Promise.resolve(readSettings?.()).then(s=>{this.configure(s || {});},()=>this.configure({}));
  }
  configure(settings){
   this.settings=settings || {};
   if(!this.continueOnOpen)this.clearHandoff();
   else if(!this.configured)this.restoreHandoff();
   this.configured=true;this.scan();
   // Reddit's preference is read only while this option is on; a video Reddit started before it arrived is paused then.
   if(this.respect && !this.preference)this.preference=Promise.resolve().then(()=>this.readPreference({doc:this.doc})).then(value=>{this.autoplayDisabled=value;if(value===true && this.respect)for(const player of this.players){const video=this.video(player);if(video && !video.paused && !this.started.has(video) && !this.continued.has(video))this.block(player,video);}},()=>{});
  }
  get respect(){return this.settings.videoRespectAutoplay!==false;}
  get pauseAway(){return this.settings.videoPauseOffscreen!==false;}
  get previewsOn(){return this.settings.videoPreviews!==false;}
  get continueOnOpen(){return this.settings.videoContinueOnOpen!==false;}
  schedule(){if(this.queued || this.dead)return;this.queued=true;setTimeout(()=>{this.queued=false;if(!this.dead)this.scan();},200);}
  scan(){
   for(const player of this.players)if(!player.isConnected){
    this.players.delete(player);this.previews.delete(player);this.io?.unobserve(player);
   }
   for(const player of this.doc.querySelectorAll(PLAYERS))this.attach(player);
   this.handoff();
  }
  attach(player){
   if(this.players.has(player) || !player.shadowRoot)return;
   this.players.add(player);this.io?.observe(player);
   if(this.attached.has(player))return;
   this.attached.add(player);
   player.shadowRoot.addEventListener('play',event=>this.onPlay(player,event),true);
   player.shadowRoot.addEventListener('timeupdate',event=>this.onTime(player,event),true);
   player.shadowRoot.addEventListener('pause',event=>{
    if(event.target.paused)this.continued.delete(event.target);
   },true);
   player.shadowRoot.addEventListener('loadedmetadata',()=>this.handoff(),true);
  }
  video(player){return player.shadowRoot?.querySelector('video') || null;}
  userStarted(player){return performance.now()-this.gesture.at<GESTURE_MS && this.gesture.path.includes(player);}
  remember(event){
   if(!this.configured || !this.continueOnOpen || (!event.isTrusted && !globalThis.__rtVideoControlTest) ||
      event.defaultPrevented || event.button!==0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)return;
   const path=event.composedPath();
   if(path.some(node=>node.matches?.(PLAYERS)))return;
   const link=path.find(node=>node.matches?.('a[href]'));
   const card=path.find(node=>node.matches?.('shreddit-post'));
   if(!link || !card || link.hasAttribute('download') || link.target && link.target!=='_self')return;
   const url=new URL(link.href,this.win.location.href),id=postId(url.pathname);
   if(url.origin!==this.win.location.origin || !id || card.id!=='t3_'+id || postId(this.win.location.pathname)===id)return;
   const source=[...card.querySelectorAll(PLAYERS)].find(player=>player.getAttribute('player-type')===FEED_PLAYER);
   const sourceVideo=source && this.video(source);
   if(!sourceVideo || sourceVideo.paused || sourceVideo.ended || !this.started.has(sourceVideo) || this.previews.has(source))return;
   const saved={id,owner:owner(this.doc),at:Date.now(),...playback(sourceVideo)};
   this.pending={saved,source,sourceVideo,from:this.win.location.pathname,reached:false};
   this.saveHandoff();
  }
  saveHandoff(){
   try{this.win.sessionStorage.setItem(CONTINUE_KEY,JSON.stringify(this.pending.saved));}catch{}
  }
  clearHandoff(){
   this.pending=null;
   try{this.win.sessionStorage.removeItem(CONTINUE_KEY);}catch{}
  }
  restoreHandoff(){
   let saved;
   try{saved=JSON.parse(this.win.sessionStorage.getItem(CONTINUE_KEY) || 'null');}catch{}
   if(saved && saved.id===postId(this.win.location.pathname) && saved.owner===owner(this.doc) &&
      Number.isFinite(saved.time) && saved.time>=0 && Number.isFinite(saved.volume) && saved.volume>=0 && saved.volume<=1 &&
      Number.isFinite(saved.rate) && saved.rate>=0.25 && saved.rate<=4){
    this.pending={saved,reached:true};
   }else if(saved)this.clearHandoff();
  }
  activeHandoff(){
   const pending=this.pending;
   if(!pending || this.dead)return null;
   const path=this.win.location.pathname,samePost=postId(path)===pending.saved.id,age=Date.now()-pending.saved.at;
   if(!this.continueOnOpen || !(age>=0 && age<CONTINUE_MS) || (!samePost && (pending.reached || path!==pending.from))){
    this.clearHandoff();return null;
   }
   if(samePost)pending.reached=true;
   return pending;
  }
  updatePlayback(pending){
   if(pending.sourceVideo?.isConnected)Object.assign(pending.saved,playback(pending.sourceVideo));
  }
  handoff(){
   const pending=this.activeHandoff();
   if(!pending?.reached)return;
   const player=this.doc.querySelector(`[player-type="${DETAIL_PLAYER}"][post-id="t3_${pending.saved.id}"]:is(${PLAYERS})`);
   if(!player)return;
   this.attach(player);
   const video=this.video(player);
   if(!video)return;
   if(video.readyState<1){
    if(pending.loadingVideo!==video){
     pending.loadingVideo=video;
     player.dispatchEvent(new this.win.Event('rt-prepare-detail-video',{bubbles:true}));
    }
    return;
   }
   this.updatePlayback(pending);
   const {time,muted,volume,rate}=pending.saved;
   this.clearHandoff();
   this.previews.delete(player);
   delete player.dataset.rtPreview;delete player.dataset.rtAutoplayBlocked;
   if(pending.sourceVideo===video && !video.paused)return;
   if(pending.sourceVideo && !pending.sourceVideo.paused)pending.sourceVideo.pause();
   video.currentTime=Number.isFinite(video.duration)?Math.min(time,Math.max(0,video.duration-0.1)):time;
   video.volume=volume;video.muted=muted;video.playbackRate=rate;
   this.continued.add(video);
   video.play()?.catch?.(()=>this.continued.delete(video));
  }
  onPlay(player,event){
   const video=event.target;if(!(video instanceof (this.doc.defaultView?.HTMLMediaElement || HTMLMediaElement)))return;
   if(this.continued.has(video))return;
   const userStarted=this.userStarted(player);
   if(userStarted)this.started.add(video);
   else this.started.delete(video);
   if(this.previews.has(player))return;
   if(this.respect && this.autoplayDisabled===true && !userStarted){this.block(player,video);return;}
   delete player.dataset.rtAutoplayBlocked;
  }
  // Autoplay that Reddit's setting says should not happen: a silent preview (first 10 s, muted, looping, never
  // advancing the real position) or, with previews off, a pause.
  block(player,video){
   if(!this.previewsOn){video.pause();player.dataset.rtAutoplayBlocked='true';return;}
   if(!this.previews.has(player))this.previews.set(player,{start:Number(video.currentTime) || 0,muted:video.muted});
   video.muted=true;player.dataset.rtPreview='true';delete player.dataset.rtAutoplayBlocked;
  }
  onTime(player,event){
   const state=this.previews.get(player),video=event.target;
   if(state && video.currentTime>=state.start+PREVIEW_S)video.currentTime=state.start;
   if(this.pending?.sourceVideo===video)this.updatePlayback(this.pending);
  }
  // Your tap: the preview ends, the video goes back to where it started and plays with Reddit's sound setting.
  endPreview(player){
   const state=this.previews.get(player),video=this.video(player);this.previews.delete(player);delete player.dataset.rtPreview;if(!state || !video)return;
   video.currentTime=state.start;video.muted=state.muted;
   setTimeout(()=>{if(video.paused)video.play()?.catch?.(()=>{});},0);
  }
  onVisibility(entries){
   if(!this.pauseAway)return;
   const pending=this.activeHandoff();
   for(const entry of entries){if(entry.intersectionRatio>=0.5 || entry.target===pending?.source && pending.reached)continue;const video=this.video(entry.target),preview=this.previews.get(entry.target);if(video && !video.paused){video.pause();entry.target.dataset.rtPausedAway='true';}if(video && preview)video.currentTime=preview.start;}
  }
  destroy(){
   this.dead=true;this.mo?.disconnect();this.io?.disconnect();
   for(const type of ['pointerdown','keydown','click'])this.doc.removeEventListener(type,this.onGesture,true);
   this.doc.removeEventListener('click',this.onRemember,true);this.doc.removeEventListener('reddit:route',this.onRoute);
   this.win.removeEventListener('popstate',this.onBack);this.win.removeEventListener('pagehide',this.onPageExit);
   this.clearHandoff();
  }
 }
 globalThis.RTVideoControl=Object.freeze({Videos,readAutoplayDisabled});
 if(globalThis.chrome?.runtime?.id && !globalThis.__rtVideoControlTest){
  const read=async()=>{const r=await chrome.runtime.sendMessage({scope:'rt-posts',action:'get-settings'});return r?.ok?r.settings:{};};
  const videos=new Videos({readSettings:read});
  chrome.runtime.onMessage.addListener((message,sender)=>{if(message?.scope==='rt-posts' && message.action==='settings-changed' && sender?.id===chrome.runtime.id)videos.configure(message.settings);});
  // Visiting Reddit's own settings re-reads the preference next time.
  if(/^\/settings\//.test(location.pathname))try{sessionStorage.removeItem(PREF_KEY);}catch{}
 }
})();
