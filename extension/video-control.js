/* Videos (docs/video-control-spec.md): enforce Reddit's own "Autoplay media" off, which its phone layout ignores, and
   pause a playing video as soon as it is mostly scrolled away. Reddit's player (shreddit-player) keeps its <video> in
   an open shadow root and starts it from script, so its non-bubbling play event is caught there in the capture phase. */
(() => {
 'use strict';
 if(globalThis.RTVideoControl || window.top!==window)return;
 const PLAYERS='shreddit-player, shreddit-player-2',GESTURE_MS=1500,PREF_KEY='rt-video-autoplay-v1',PREF_TTL=3600000;
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
   this.doc=doc;this.settings={};this.autoplayDisabled=null;this.players=new Set();this.gesture={at:-Infinity,path:[]};this.dead=false;
   this.onGesture=event=>{this.gesture={at:performance.now(),path:event.composedPath?.() || [event.target]};};
   for(const type of ['pointerdown','keydown','click'])doc.addEventListener(type,this.onGesture,true);
   this.io=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>this.onVisibility(entries),{threshold:[0,0.5,1]}):null;
   this.mo=observe?new MutationObserver(()=>this.schedule()):null;this.mo?.observe(doc.documentElement,{childList:true,subtree:true});
   this.readPreference=readPreference;this.preference=null;
   this.ready=Promise.resolve(readSettings?.()).then(s=>{this.configure(s || {});},()=>this.configure({}));
  }
  configure(settings){
   this.settings=settings || {};this.scan();
   // Reddit's preference is read only while this option is on; a video Reddit started before it arrived is paused then.
   if(this.respect && !this.preference)this.preference=Promise.resolve().then(()=>this.readPreference({doc:this.doc})).then(value=>{this.autoplayDisabled=value;if(value===true && this.respect)for(const player of this.players){const video=this.video(player);if(video && !video.paused && !this.userStarted(player)){video.pause();player.dataset.rtAutoplayBlocked='true';}}},()=>{});
  }
  get respect(){return this.settings.videoRespectAutoplay!==false;}
  get pauseAway(){return this.settings.videoPauseOffscreen!==false;}
  schedule(){if(this.queued || this.dead)return;this.queued=true;setTimeout(()=>{this.queued=false;if(!this.dead)this.scan();},200);}
  scan(){for(const player of this.doc.querySelectorAll(PLAYERS))this.attach(player);}
  attach(player){
   if(this.players.has(player) || !player.shadowRoot)return;
   this.players.add(player);this.io?.observe(player);
   player.shadowRoot.addEventListener('play',event=>this.onPlay(player,event),true);
  }
  video(player){return player.shadowRoot?.querySelector('video') || null;}
  userStarted(player){return performance.now()-this.gesture.at<GESTURE_MS && this.gesture.path.includes(player);}
  onPlay(player,event){
   const video=event.target;if(!(video instanceof (this.doc.defaultView?.HTMLMediaElement || HTMLMediaElement)))return;
   if(this.respect && this.autoplayDisabled===true && !this.userStarted(player)){video.pause();player.dataset.rtAutoplayBlocked='true';return;}
   delete player.dataset.rtAutoplayBlocked;
  }
  onVisibility(entries){
   if(!this.pauseAway)return;
   for(const entry of entries){if(entry.intersectionRatio>=0.5)continue;const video=this.video(entry.target);if(video && !video.paused){video.pause();entry.target.dataset.rtPausedAway='true';}}
  }
  destroy(){this.dead=true;this.mo?.disconnect();this.io?.disconnect();for(const type of ['pointerdown','keydown','click'])this.doc.removeEventListener(type,this.onGesture,true);}
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
