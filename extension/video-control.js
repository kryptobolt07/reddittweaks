/* Videos (docs/video-control-spec.md): enforce Reddit's own "Autoplay media" off, which its phone layout ignores, pause
   a playing video as soon as it is mostly scrolled away, muted YouTube-style previews (hover on desktop, optionally the
   video in view on phones), and keep playing the same video when its post opens. Reddit's player (shreddit-player)
   keeps its <video> in an open shadow root and starts it from script, so its non-bubbling play event is caught there
   in the capture phase. */
(() => {
 'use strict';
 if(globalThis.RTVideoControl || window.top!==window)return;
 const PLAYERS='shreddit-player, shreddit-player-2',GESTURE_MS=1500,HOVER_MS=160,LEAVE_MS=250,FADE_MS=200,IN_VIEW=0.6,PREF_KEY='rt-video-autoplay-v1',PREF_TTL=3600000,CONTINUE_KEY='rt-video-continue-v1',CONTINUE_MS=12000;
 const PLAY_BUTTON='.poster-play-button,.play-pause-button';
 const SOUND_CONTROL='.mute-button,.volume-slider';
 const FEED_PLAYER='in_feed_player',DETAIL_PLAYER='post_detail_screen';
 const postId=path=>/^\/(?:r\/[^/]+\/|user\/[^/]+\/)?comments\/([a-z0-9]{1,10})(?:\/|$)/i.exec(path)?.[1].toLowerCase() || '';
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
   this.doc=doc;this.win=doc.defaultView;this.settings={};this.autoplayDisabled=null;this.players=new Set();this.attached=new WeakSet();this.previews=new WeakMap();this.started=new WeakSet();this.continued=new WeakSet();this.gesture={at:-Infinity,path:[]};this.dead=false;
   this.visibilityReady=new WeakMap();this.fading=new WeakMap();this.ratios=new Map();this.away=new WeakMap();
   this.onGesture=event=>{
    if(!event.isTrusted && !globalThis.__rtVideoControlTest)return;
    const path=event.composedPath();
    this.gesture={at:performance.now(),path};
    const player=path.find(node=>node.matches?.(PLAYERS));
    if(!player)return;
    this.attach(player);
    const video=this.video(player);
    if(this.previews.get(player)?.video===video){
     if(event.type==='click' && event.button===0)this.usePreview(player,event,path);
    }else if(video && !video.paused)this.started.add(video);
   };
   this.onHover=event=>this.hover(event);
   this.onTabVisibility=()=>{if(this.doc.hidden)this.stopHover();};
   this.onRemember=event=>this.remember(event);
   this.onRoute=()=>{this.stopHover();this.handoff();};
   this.onBack=()=>{this.stopHover();this.clearHandoff();};
   this.onPageExit=()=>{
    const pending=this.activeHandoff();
    if(pending?.sourceVideo){
     this.updatePlayback(pending);
     this.saveHandoff();
    }
    this.releaseHeldVideo();
    this.stopHover();
    this.pending=null;
   };
   for(const type of ['pointerdown','keydown','click'])doc.addEventListener(type,this.onGesture,true);
   for(const type of ['pointerover','pointerout'])doc.addEventListener(type,this.onHover,true);
   doc.addEventListener('visibilitychange',this.onTabVisibility);
   doc.addEventListener('click',this.onRemember,true);
   doc.addEventListener('reddit:route',this.onRoute);
   this.win.addEventListener('popstate',this.onBack);
   this.win.addEventListener('pagehide',this.onPageExit);
   this.io=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>this.onVisibility(entries),{threshold:[0,0.5,IN_VIEW,1]}):null;
   this.mo=observe?new MutationObserver(()=>{this.handoff();this.schedule();}):null;
   this.mo?.observe(doc.documentElement,{childList:true,subtree:true});
   this.readPreference=readPreference;this.preference=null;
   this.ready=Promise.resolve(readSettings?.()).then(s=>{this.configure(s || {});},()=>this.configure({}));
  }
  configure(settings){
   this.settings=settings || {};
   if(!this.previewsOn){this.stopHover();this.previews=new WeakMap();}
   if(!this.continueOnOpen)this.clearHandoff();
   else if(!this.configured)this.restoreHandoff();
   this.configured=true;this.scan();
   // Visibility reports that arrived before the settings did still choose the in-view preview.
   if(this.inView)this.pickInView();
   else if(this.viewing)this.stopHover();
   // Reddit's preference is read only while this option is on; a video Reddit started before it arrived is paused then.
   if(this.respect && !this.preference)this.preference=Promise.resolve().then(()=>this.readPreference({doc:this.doc})).then(value=>{this.autoplayDisabled=value;if(value===true && this.respect)for(const player of this.players){const video=this.video(player);if(video && !video.paused && !this.started.has(video) && !this.continued.has(video))this.block(player,video);}},()=>{});
  }
  get respect(){return this.settings.videoRespectAutoplay!==false;}
  get pauseAway(){return this.settings.videoPauseOffscreen!==false;}
  get previewsOn(){return this.settings.videoPreviews!==false;}
  get unmutePreview(){return this.settings.videoUnmutePreview!==false;}
  get continueOnOpen(){return this.settings.videoContinueOnOpen!==false;}
  get clickPlays(){return this.settings.videoPreviewClickPlays===true;}
  get restartPreview(){return this.settings.videoPreviewRestart===true;}
  // Phones have no hover: the video in view previews instead, when chosen.
  get inView(){return this.previewsOn && this.settings.videoPreviewsInView===true && Boolean(this.win.matchMedia?.('(hover: none), (pointer: coarse)')?.matches);}
  playback(video){return {time:video.currentTime,muted:video.muted,volume:this.fading.get(video) ?? video.volume,rate:video.playbackRate};}
  // Sound is turned on through Reddit's own volume state (the page bridge), so the post's player keeps it, then comes
  // in over 200 ms instead of at full volume.
  fadeIn(video,volume,player){
   player?.dispatchEvent(new this.win.Event('rt-video-sound',{bubbles:true}));
   if(!(volume>0)){video.muted=false;return;}
   const begin=performance.now();this.fading.set(video,volume);
   video.volume=0;video.muted=false;
   const step=()=>{
    if(this.fading.get(video)!==volume || this.dead)return;
    const t=Math.min(1,(performance.now()-begin)/FADE_MS);
    video.volume=volume*t;
    if(t<1)this.win.setTimeout(step,16);else this.fading.delete(video);
   };
   step();
  }
  schedule(){if(this.queued || this.dead)return;this.queued=true;setTimeout(()=>{this.queued=false;if(!this.dead)this.scan();},200);}
  scan(){
   for(const player of this.players)if(!player.isConnected){
    if(this.hovered===player)this.stopHover();
    this.players.delete(player);this.previews.delete(player);this.ratios.delete(player);this.io?.unobserve(player);
   }
   for(const player of this.doc.querySelectorAll(PLAYERS))this.attach(player);
   this.handoff();
  }
  attach(player){
   if(this.players.has(player) || !player.shadowRoot)return;
   this.players.add(player);this.io?.observe(player);this.ratios.delete(player);
   if(this.attached.has(player))return;
   this.attached.add(player);
   player.shadowRoot.addEventListener('play',event=>this.onPlay(player,event),true);
   player.shadowRoot.addEventListener('timeupdate',event=>this.onTime(event),true);
   player.shadowRoot.addEventListener('pause',event=>{
    if(event.target.paused)this.continued.delete(event.target);
   },true);
   // Reddit re-applies its saved volume when a video starts; a preview stays muted until it plays for real.
   player.shadowRoot.addEventListener('volumechange',event=>{
    const preview=this.previews.get(player);
    if(preview?.active && preview.video===event.target && !event.target.muted)event.target.muted=true;
   },true);
   player.shadowRoot.addEventListener('loadedmetadata',event=>{
    const preview=this.previews.get(player);
    if(preview?.active && preview.video===event.target)this.playPreview(player,preview);
    if(this.away.get(player)?.loading)this.resumeAway(player);
    this.handoff();
   },true);
  }
  video(player){return player.shadowRoot?.querySelector('video') || null;}
  userStarted(player){return performance.now()-this.gesture.at<GESTURE_MS && this.gesture.path.includes(player);}
  // A preview belongs to its post card: moving to the title, flair or votes keeps it; leaving the card pauses it.
  cardOf(player){return player.closest('shreddit-post') || player.parentElement || player;}
  hover(event){
   if(!this.configured || !this.previewsOn || event.pointerType!=='mouse' ||
      (!event.isTrusted && !globalThis.__rtVideoControlTest))return;
   const path=event.composedPath(),to=event.relatedTarget,within=(node,root)=>Boolean(node?.nodeType && (node===root || root.contains(node)));
   const current=this.hovered,card=current && this.cardOf(current);
   if(event.type==='pointerout'){
    if(!current || path.includes(current) && within(to,current))return;
    const preview=this.previews.get(current);
    // Before it plays, the preview is the player's alone; once playing, it belongs to the card.
    if(!preview?.active || !preview.played){if(path.includes(current))this.stopHover();return;}
    if(!path.includes(card) || within(to,card))return;
    this.win.clearTimeout(this.leaveTimer);
    this.leaveTimer=this.win.setTimeout(()=>{if(this.hovered===current)this.stopHover();},LEAVE_MS);
    return;
   }
   if(current && path.includes(card))this.win.clearTimeout(this.leaveTimer);
   const player=path.find(node=>node.matches?.(PLAYERS));
   if(!player || player.getAttribute('player-type')!==FEED_PLAYER || event.buttons || current===player)return;
   if(within(to,player))return;
   this.stopHover();
   this.hovered=player;
   this.hoverTimer=this.win.setTimeout(()=>this.startPreview(player),HOVER_MS);
  }
  startPreview(player){
   const video=this.video(player);
   if(this.doc.hidden || this.hovered!==player || !player.isConnected || !video?.paused ||
      video.ended || this.started.has(video))return;
   for(const other of this.players){
    const media=this.video(other);
    if(media && !media.paused && this.started.has(media))return;
   }
   this.attach(player);
   const previous=this.previews.get(player);
   const preview={video,muted:video.muted,active:true,played:previous?.video===video && previous.played};
   this.previews.set(player,preview);
   video.muted=true;
   player.dispatchEvent(new this.win.Event('rt-prepare-feed-preview',{bubbles:true}));
   if(video.readyState>=1)this.playPreview(player,preview);
  }
  playPreview(player,preview){
   if(preview.requested || this.hovered!==player)return;
   preview.requested=true;
   preview.video.play()?.catch?.(()=>{
    if(this.previews.get(player)===preview && preview.active)this.stopHover();
   });
  }
  stopHover(){
   this.win.clearTimeout(this.hoverTimer);this.win.clearTimeout(this.leaveTimer);this.viewing=false;
   const player=this.hovered;
   this.hovered=null;
   const preview=player && this.previews.get(player);
   if(!preview?.active)return;
   preview.active=false;
   preview.video.pause();
   preview.video.muted=preview.muted;
   if(!preview.played)this.previews.delete(player);
  }
  // A click on a preview opens its post (as YouTube does) or plays it here; its own sound control acts in place.
  usePreview(player,event,path){
   const preview=this.previews.get(player);
   if(path.some(node=>node.matches?.(SOUND_CONTROL))){
    this.promotePreview(player,true);
    return;
   }
   const button=path.some(node=>node.matches?.(PLAY_BUTTON));
   if(!button && path[0]!==preview.video)return;
   if(!preview.played){this.stopHover();return;}
   event.preventDefault();
   event.stopImmediatePropagation();
   if(button || this.clickPlays || !this.openPost(player))this.promotePreview(player);
  }
  // Follow the card's own permalink, so Reddit routes it and the playing preview continues into the post.
  openPost(player){
   const card=player.closest('shreddit-post'),id=card?.id?.replace(/^t3_/,'');
   if(!id)return false;
   const links=[...card.querySelectorAll('a[href]')].filter(link=>!link.closest(PLAYERS) && (!link.target || link.target==='_self') &&
    postId(new URL(link.href,this.win.location.href).pathname)===id);
   const link=links.find(link=>link.slot==='full-post-link') || links.find(link=>link.slot==='title') || links[0];
   if(!link)return false;
   this.opening=link;
   try{link.click();}finally{this.opening=null;}
   return true;
  }
  promotePreview(player,nativeSound=false){
   const preview=this.previews.get(player);
   if(!preview || (!preview.played && !(nativeSound && preview.active)))return;
   const video=preview.video;
   this.previews.delete(player);
   this.started.add(video);
   if(this.hovered===player)this.stopHover();
   if(nativeSound)return;
   if(this.restartPreview)video.currentTime=0;
   if(this.unmutePreview)this.fadeIn(video,video.volume>0?video.volume:0.5,player);
   else video.muted=true;
   if(video.paused){
    this.continued.add(video);
    video.play()?.catch?.(()=>this.continued.delete(video));
   }
  }
  remember(event){
   if(!this.configured || !this.continueOnOpen || (!event.isTrusted && !globalThis.__rtVideoControlTest && event.target!==this.opening) ||
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
   if(sourceVideo && this.previews.get(source)?.video===sourceVideo)this.promotePreview(source);
   if(!sourceVideo || sourceVideo.paused || sourceVideo.ended || !this.started.has(sourceVideo) || this.previews.has(source))return;
   this.clearHandoff();
   const saved={id,owner:owner(this.doc),at:Date.now(),...this.playback(sourceVideo)};
   this.pending={saved,source,sourceVideo,from:this.win.location.pathname,reached:false};
   this.saveHandoff();
   this.pending.held=!source.dispatchEvent(new this.win.Event('rt-hold-feed-video',{bubbles:true,cancelable:true}));
   this.expiry=this.win.setTimeout(()=>this.clearHandoff(),CONTINUE_MS);
  }
  saveHandoff(){
   try{this.win.sessionStorage.setItem(CONTINUE_KEY,JSON.stringify(this.pending.saved));}catch{}
  }
  clearHandoff(){
   this.releaseHeldVideo();
   this.pending=null;
   try{this.win.sessionStorage.removeItem(CONTINUE_KEY);}catch{}
  }
  releaseHeldVideo(){
   this.win.clearTimeout(this.expiry);
   this.pending?.layoutObserver?.disconnect();
   if(this.pending?.held){
    this.pending.held=false;
    this.doc.dispatchEvent(new this.win.Event('rt-release-feed-video'));
   }
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
   if(pending.sourceVideo?.isConnected)Object.assign(pending.saved,this.playback(pending.sourceVideo));
  }
  waitForDetailLayout(pending,player){
   if(!this.win.ResizeObserver)return false;
   const {width,height}=player.getBoundingClientRect();
   if(width && height)return false;
   if(pending.layoutTarget!==player){
    pending.layoutObserver?.disconnect();
    pending.layoutTarget=player;
    pending.layoutObserver=new this.win.ResizeObserver(()=>this.handoff());
    pending.layoutObserver.observe(player);
   }
   return true;
  }
  handoff(){
   const pending=this.activeHandoff();
   if(!pending?.reached)return;
   const player=this.doc.querySelector(`[player-type="${DETAIL_PLAYER}"][post-id="t3_${pending.saved.id}"]:is(${PLAYERS})`);
   if(!player)return;
   if(pending.held && this.waitForDetailLayout(pending,player))return;
   if(pending.held && !player.dispatchEvent(new this.win.Event('rt-place-held-video',{bubbles:true,cancelable:true}))){
    pending.held=false;
    this.observeAfterMove(pending.source);
    this.clearHandoff();
    return;
   }
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
   delete player.dataset.rtAutoplayBlocked;
   if(pending.sourceVideo===video && !video.paused)return;
   if(pending.sourceVideo && !pending.sourceVideo.paused)pending.sourceVideo.pause();
   video.currentTime=Number.isFinite(video.duration)?Math.min(time,Math.max(0,video.duration-0.1)):time;
   video.playbackRate=rate;
   if(muted){video.volume=volume;video.muted=true;}else this.fadeIn(video,volume,player);
   this.continued.add(video);
   video.play()?.catch?.(()=>this.continued.delete(video));
  }
  onPlay(player,event){
   const video=event.target;if(!(video instanceof (this.doc.defaultView?.HTMLMediaElement || HTMLMediaElement)))return;
   if(this.continued.has(video))return;
   const preview=this.previews.get(player);
   if(preview?.active && preview.video===video){preview.played=true;return;}
   const userStarted=this.userStarted(player);
   if(userStarted){this.started.add(video);this.previews.delete(player);this.away.delete(player);}
   else this.started.delete(video);
   if(this.respect && this.autoplayDisabled===true && !userStarted){this.block(player,video);return;}
   delete player.dataset.rtAutoplayBlocked;
  }
  block(player,video){
   if(this.previews.get(player)?.active)return;
   video.pause();player.dataset.rtAutoplayBlocked='true';
  }
  onTime(event){if(this.pending?.sourceVideo===event.target)this.updatePlayback(this.pending);}
  observeAfterMove(player){
   if(!this.io)return;
   this.visibilityReady.set(player,Infinity);
   this.io.unobserve(player);
   // Discard feed geometry and wait for the relocated player to paint in the post (after its flight, if it flies).
   const observe=()=>this.win.requestAnimationFrame(()=>{
    if(this.dead)return;
    this.visibilityReady.set(player,this.win.performance.now());
    if(player.isConnected && this.players.has(player))this.io.observe(player);
   });
   if(player.hasAttribute('data-rt-video-flying'))player.addEventListener('rt-video-placed',observe,{once:true});
   else this.win.requestAnimationFrame(observe);
  }
  onVisibility(entries){
   const pending=this.activeHandoff();
   for(const entry of entries){
    const player=entry.target,ready=this.visibilityReady.get(player);
    if(player.getAttribute('player-type')===FEED_PLAYER)this.ratios.set(player,entry.intersectionRatio);
    if((ready!==undefined && !(entry.time>=ready)) || (player===pending?.source && (pending.held || pending.reached)))continue;
    // A post's own video pauses once it is fully out of view and resumes where it was when half of it is back;
    // a feed video pauses when less than half of it is on screen and stays paused.
    const detail=player.getAttribute('player-type')===DETAIL_PLAYER,ratio=entry.intersectionRatio;
    if(ratio>=0.5){if(detail)this.resumeAway(player);continue;}
    if(detail && ratio>0)continue;
    if(player===this.hovered)this.stopHover();
    if(!this.pauseAway)continue;
    const video=this.video(player);
    if(video && !video.paused && !video.ended){
     video.pause();player.dataset.rtPausedAway='true';
     if(detail)this.away.set(player,{video,time:video.currentTime});
    }
   }
   if(this.inView)this.pickInView();
  }
  resumeAway(player){
   const away=this.away.get(player),video=this.video(player);
   if(!away || !this.pauseAway || this.doc.hidden){this.away.delete(player);return;}
   if(video!==away.video || !video.paused || video.ended){this.away.delete(player);return;}
   // Reddit may have unloaded the source while it was far away: reload it, then resume at the same time.
   if(video.readyState<1){
    if(!away.loading){away.loading=true;player.dispatchEvent(new this.win.Event('rt-prepare-detail-video',{bubbles:true}));}
    return;
   }
   this.away.delete(player);delete player.dataset.rtPausedAway;
   if(Math.abs(video.currentTime-away.time)>0.25)video.currentTime=away.time;
   this.continued.add(video);
   video.play()?.catch?.(()=>this.continued.delete(video));
  }
  // The feed video at least 60 % visible and nearest the middle of the screen previews; one at a time.
  pickInView(){
   const middle=this.win.innerHeight/2;let best=null,distance=Infinity;
   for(const [player,ratio] of this.ratios){
    if(ratio<IN_VIEW || !player.isConnected || player.getAttribute('player-type')!==FEED_PLAYER)continue;
    const box=player.getBoundingClientRect(),gap=Math.abs(box.top+box.height/2-middle);
    if(gap<distance){best=player;distance=gap;}
   }
   if(best===this.hovered)return;
   this.stopHover();
   if(!best)return;
   this.hovered=best;this.viewing=true;
   this.hoverTimer=this.win.setTimeout(()=>this.startPreview(best),HOVER_MS);
  }
  destroy(){
   this.dead=true;this.mo?.disconnect();this.io?.disconnect();
   this.stopHover();
   for(const type of ['pointerdown','keydown','click'])this.doc.removeEventListener(type,this.onGesture,true);
   for(const type of ['pointerover','pointerout'])this.doc.removeEventListener(type,this.onHover,true);
   this.doc.removeEventListener('visibilitychange',this.onTabVisibility);
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
