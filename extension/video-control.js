/* Videos (docs/video-control-spec.md): enforce Reddit's own "Autoplay media" off, which its phone layout ignores, pause
   a playing video as soon as it is mostly scrolled away, muted YouTube-style previews (hover on desktop, optionally the
   video in view on phones), and keep playing the same video when its post opens. Reddit's player (shreddit-player)
   keeps its <video> in an open shadow root and starts it from script, so its non-bubbling play event is caught there
   in the capture phase. */
(() => {
 'use strict';
 if(globalThis.RTVideoControl || window.top!==window)return;
 const PLAYERS='shreddit-player, shreddit-player-2',GESTURE_MS=1500,HOVER_MS=160,LEAVE_MS=250,FADE_MS=200,IN_VIEW=0.6,DWELL_MS=600,PREF_KEY='rt-video-autoplay-v1',PREF_TTL=3600000,CONTINUE_KEY='rt-video-continue-v1',CONTINUE_MS=12000;
 const PLAY_BUTTON='.poster-play-button,.play-pause-button';
 const SOUND_CONTROL='.mute-button,.volume-slider';
 const FEED_PLAYER='in_feed_player',DETAIL_PLAYER='post_detail_screen';
 // YouTube embeds Reddit renders as lite-youtube with the YouTube player API (controlled by the page bridge).
 const EMBED='shreddit-embed[providername="YouTube"]',EMBED_KEY='rt-embed-continue-v1',ANY_EMBED='shreddit-embed';
 // Other providers (Streamable, Twitch, Dailymotion, …): Reddit renders their oEmbed iframe directly in the embed. A
 // preview reloads it with the provider's autoplay and mute flags; its own player API, if any, is not used.
 const rawFrame=embed=>{const frame=embed?.shadowRoot?.querySelector?.('iframe');return frame && !frame.closest('lite-youtube,lite-vimeo')?frame:null;};
 const FLAGS=[[/(^|\.)twitch\.tv$/i,{autoplay:'true',muted:'true'}],[/(^|\.)dailymotion\.com$/i,{autoplay:'1',mute:'1'}],[/./,{autoplay:'1',muted:'1',mute:'1'}]];
 // Control protocols of the players Reddit embeds as plain iframes (read from Reddit's stored embed code 2026-11-19):
 // Embedly's wrapper (Streamable, Vimeo, Twitch, some YouTube) speaks player.js; YouTube's own player its iframe API
 // (Reddit's embed code has enablejsapi=1); Vimeo's player its message API. RedGIFs and others take only address flags.
 function frameKind(frame){
  let url;try{url=new URL(frame.getAttribute('src') || '','https://www.reddit.com');}catch{return 'flags';}
  if(/(^|\.)embedly\.com$/i.test(url.hostname))return 'playerjs';
  if(/(^|\.)youtube(-nocookie)?\.com$/i.test(url.hostname) && url.searchParams.get('enablejsapi')==='1')return 'youtube';
  if(/^player\.vimeo\.com$/i.test(url.hostname))return 'vimeo';
  return 'flags';
 }
 function frameMessage(kind,method){
  if(kind==='playerjs')return JSON.stringify({context:'player.js',version:'0.0.11',method});
  if(kind==='vimeo')return JSON.stringify(method==='mute'?{method:'setVolume',value:0}:method==='unmute'?{method:'setVolume',value:1}:{method});
  if(kind==='youtube')return JSON.stringify({event:'command',func:{play:'playVideo',pause:'pauseVideo',mute:'mute',unmute:'unMute'}[method],args:[]});
  return '';
 }
 // Whether a player's message says it started playing, or is ready for commands.
 function frameEvent(kind,raw){
  let data=raw;if(typeof data==='string'){try{data=JSON.parse(data);}catch{return '';}}
  if(!data || typeof data!=='object')return '';
  if(kind==='playerjs')return data.context==='player.js' && ['play','ready'].includes(data.event)?data.event:'';
  if(kind==='vimeo')return ['play','ready'].includes(data.event)?data.event:'';
  if(kind==='youtube'){const state=data.event==='onStateChange'?data.info:data.event==='infoDelivery'?data.info?.playerState:null;return state===1?'play':data.event==='onReady'?'ready':'';}
  return '';
 }
 function flagged(src,sound){
  let url;try{url=new URL(src);}catch{return src;}
  const flags=FLAGS.find(([host])=>host.test(url.hostname))[1];
  for(const [key,value] of Object.entries(flags)){
   if(!sound || key==='autoplay')url.searchParams.set(key,value);
   else if(value==='true')url.searchParams.set(key,'false');else url.searchParams.delete(key);
  }
  return url.href;
 }
 const postId=path=>/^\/(?:r\/[^/]+\/|user\/[^/]+\/)?comments\/([a-z0-9]{1,10})(?:\/|$)/i.exec(path)?.[1].toLowerCase() || '';
  // Same choices and migration as RTPostModel.normalizeSettings (settings may arrive raw in tests and old builds).
 const choices=raw=>{const pick=(key,allowed,fallback)=>allowed.includes(raw?.[key])?raw[key]:fallback;return {start:pick('videoStart',['hover','reddit','play'],raw?.videoPreviews===false?'reddit':'hover'),touch:pick('videoStartTouch',['stop','reddit','play'],raw?.videoPreviewsInView===true?'stop':'reddit'),click:pick('videoPreviewClick',['open','here'],raw?.videoPreviewClickPlays===true?'here':'open'),from:pick('videoPreviewFrom',['position','start'],raw?.videoPreviewRestart===true?'start':'position'),open:pick('videoOpenPost',['continue','reddit'],raw?.videoContinueOnOpen===false?'reddit':'continue'),away:pick('videoScrollAway',['pause','reddit'],raw?.videoPauseOffscreen===false?'reddit':'pause'),sound:raw?.videoUnmutePreview!==false};};
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
   this.visibilityReady=new WeakMap();this.fading=new WeakMap();this.away=new WeakMap();
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
   // Phones, like YouTube's feed: a preview starts once scrolling has stopped for a moment.
   this.onScroll=()=>{if(this.inView)this.settle();};
   this.onRemember=event=>this.remember(event);
   this.onRoute=()=>{this.stopHover();this.handoff();};
   this.onBack=()=>{this.stopHover();this.clearHandoff();this.clearEmbedHandoff();};
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
   this.win.addEventListener('scroll',this.onScroll,{passive:true,capture:true});
   doc.addEventListener('click',this.onRemember,true);
   doc.addEventListener('reddit:route',this.onRoute);
   // The page bridge reports a YouTube player that started (by its own controls, a preview or a continuation).
   this.onEmbedPlaying=event=>{if(event.target?.matches?.(EMBED))this.exclusive(event.target);};
   doc.addEventListener('rt-embed-playing',this.onEmbedPlaying);
   // Clicking into an embed's player moves focus into its iframe (the page sees a blur): that embed is in use, so other
   // videos pause, and opening its post carries it over.
   this.onFrameFocus=()=>this.win.setTimeout(()=>{
    const active=this.doc.activeElement;if(!active?.matches?.(ANY_EMBED))return;
    active.dataset.rtEmbedUsed='1';this.exclusive(active);
   },0);
   this.win.addEventListener('blur',this.onFrameFocus);
   // Provider players report starting (see frameEvent): that one plays, everything else pauses.
   this.frames=new Map();
   this.onFrameMessage=event=>{
    for(const [frame,state] of this.frames){
     if(!frame.isConnected){this.frames.delete(frame);continue;}
     if(frame.contentWindow!==event.source)continue;
     const kind=frameEvent(state.kind,event.data);
     if(kind==='ready'){for(const data of state.queue.splice(0))this.post(frame,data);this.subscribe(frame,state);}
     if(kind==='play'){const embed=frame.getRootNode()?.host;if(embed && this.ePreview?.embed!==embed){embed.dataset.rtEmbedUsed='1';this.exclusive(embed);}}
     return;
    }
   };
   this.win.addEventListener('message',this.onFrameMessage);
   this.win.addEventListener('popstate',this.onBack);
   this.win.addEventListener('pagehide',this.onPageExit);
   this.io=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>this.onVisibility(entries),{threshold:[0,0.5,IN_VIEW,1]}):null;
   this.mo=observe?new MutationObserver(()=>{this.handoff();this.schedule();}):null;
   this.mo?.observe(doc.documentElement,{childList:true,subtree:true});
   this.readPreference=readPreference;this.preference=null;
   this.ready=Promise.resolve(readSettings?.()).then(s=>{this.configure(s || {});},()=>this.configure({}));
  }
  configure(settings){
   this.settings=settings || {};this.choice=choices(this.settings);
   if(!this.previewsOn){this.stopHover();this.previews=new WeakMap();}
   if(!this.continueOnOpen)this.clearHandoff();
   else if(!this.configured)this.restoreHandoff();
   this.configured=true;this.scan();
   // Visibility reports that arrived before the settings did still choose the in-view preview.
   if(this.inView)this.settle();
   else if(this.viewing || this.ePreview?.view)this.stopHover();
   // "Like Reddit" reads Reddit's own "Autoplay media" preference (its phone layout ignores it, so it is applied here);
   // the other choices start nothing by themselves. A video Reddit started before that was known is paused then.
   const pauseStarted=()=>{if(!this.blocksAutoplay)return;for(const player of this.players){const video=this.video(player);if(video && !video.paused && !this.started.has(video) && !this.continued.has(video))this.block(player,video);}};
   if(this.startMode==='reddit' && !this.preference)this.preference=Promise.resolve().then(()=>this.readPreference({doc:this.doc})).then(value=>{this.autoplayDisabled=value;pauseStarted();},()=>{});
   pauseStarted();
  }
  get touch(){return Boolean(this.win.matchMedia?.('(hover: none), (pointer: coarse)')?.matches);}
  // How feed videos start on this device: desktop On hover / Like Reddit / When I press Play; phones When I stop
  // scrolling / Like Reddit / When I press Play.
  get startMode(){const c=this.choice || choices({});return this.touch?c.touch:c.start;}
  get blocksAutoplay(){return this.startMode==='reddit'?this.autoplayDisabled===true:true;}
  get pauseAway(){return (this.choice || choices({})).away==='pause';}
  get previewsOn(){return (this.choice || choices({})).start==='hover';}
  get unmutePreview(){return (this.choice || choices({})).sound;}
  get continueOnOpen(){return (this.choice || choices({})).open==='continue';}
  get clickPlays(){return (this.choice || choices({})).click==='here';}
  get restartPreview(){return (this.choice || choices({})).from==='start';}
  // Phones have no hover: the video you stop scrolling on previews instead, when chosen.
  get inView(){return this.touch && (this.choice || choices({})).touch==='stop';}
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
    this.players.delete(player);this.previews.delete(player);this.io?.unobserve(player);
   }
   for(const player of this.doc.querySelectorAll(PLAYERS))this.attach(player);
   for(const embed of this.doc.querySelectorAll(ANY_EMBED)){const frame=rawFrame(embed);if(frame && !this.frames.has(frame))this.frameState(frame);}
   this.handoff();
   this.embedHandoff();
  }
  attach(player){
   if(this.players.has(player) || !player.shadowRoot)return;
   this.players.add(player);this.io?.observe(player);
   if(this.inView && !this.viewing)this.settle();
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
   if(this.embedHover(event,path,to,within))return;
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
  // Playback goes through Reddit's own player (page bridge) so its controls show the playing state; a direct
  // <video>.play() left Reddit's play icon and poster up (measured 2026-11-19).
  play(player,video){
   if(!player.dispatchEvent(new this.win.Event('rt-play-video',{bubbles:true,cancelable:true})))return Promise.resolve();
   return video.play();
  }
  playPreview(player,preview){
   if(preview.requested || this.hovered!==player)return;
   preview.requested=true;
   this.play(player,preview.video)?.catch?.(()=>{
    if(this.previews.get(player)===preview && preview.active)this.stopHover();
   });
  }
  stopHover(){
   this.stopEmbed();
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
  post(frame,data){try{frame.contentWindow?.postMessage(data,new URL(frame.getAttribute('src') || '',this.win.location.href).origin);}catch{}}
  frameState(frame){
   let state=this.frames.get(frame);
   if(!state){
    state={kind:frameKind(frame),queue:[]};this.frames.set(frame,state);
    if(state.kind!=='flags'){this.subscribe(frame,state);frame.addEventListener('load',()=>{this.subscribe(frame,state);this.win.setTimeout(()=>{for(const data of state.queue.splice(0))this.post(frame,data);},300);});}
   }
   return state;
  }
  subscribe(frame,state){
   if(state.kind==='playerjs')for(const value of ['ready','play'])this.post(frame,JSON.stringify({context:'player.js',version:'0.0.11',method:'addEventListener',value,listener:'rt-'+value}));
   else if(state.kind==='vimeo')for(const value of ['ready','play'])this.post(frame,JSON.stringify({method:'addEventListener',value}));
   else if(state.kind==='youtube')this.post(frame,JSON.stringify({event:'listening',id:'rt'}));
  }
  // Sends now and again once the player says it is ready (commands before that are dropped by these players).
  command(frame,method){
   const state=this.frameState(frame);if(state.kind==='flags')return false;
   const data=frameMessage(state.kind,method);this.post(frame,data);
   state.queue.push(data);if(state.queue.length>4)state.queue.shift();
   return true;
  }
  feedEmbed(embed){
   const card=embed?.closest?.('shreddit-post');
   return Boolean(card?.id && embed.matches(ANY_EMBED) && (embed.matches(EMBED) || rawFrame(embed)) && postId(this.win.location.pathname)!==card.id.replace(/^t3_/,''));
  }
  // Desktop hover over a feed YouTube embed, with the same card grace as a video. Returns true when it handled the event.
  embedHover(event,path,to,within){
   const current=this.ePreview,embed=path.find(node=>node.matches?.(ANY_EMBED));
   if(event.type==='pointerout'){
    if(!current || current.view)return Boolean(embed);
    if(!current.active){if(path.includes(current.embed) && !within(to,current.embed))this.stopEmbed();return true;}
    if(path.includes(current.card) && !within(to,current.card)){
     this.win.clearTimeout(current.leave);
     current.leave=this.win.setTimeout(()=>{if(this.ePreview===current)this.stopEmbed();},LEAVE_MS);
    }
    return Boolean(embed) || path.includes(current.card);
   }
   if(current && path.includes(current.card))this.win.clearTimeout(current.leave);
   if(!embed)return false;
   if(!this.feedEmbed(embed) || event.buttons || current?.embed===embed)return true;
   this.stopHover();
   const preview=this.ePreview={embed,card:embed.closest('shreddit-post')};
   preview.timer=this.win.setTimeout(()=>this.startEmbed(preview),HOVER_MS);
   return true;
  }
  startEmbed(preview){
   const {embed}=preview;
   if(this.ePreview!==preview || this.doc.hidden || !embed.isConnected)return;
   embed.dataset.rtEmbedPreview='on';
   let host;
   if(embed.matches(EMBED)){
    if(embed.dispatchEvent(new this.win.Event('rt-embed-preview',{bubbles:true,cancelable:true}))){this.stopEmbed();return;}
    host=embed.shadowRoot?.querySelector('lite-youtube') || embed;
   }else{
    const frame=rawFrame(embed),src=frame?.getAttribute('src');if(!frame || !src){this.stopEmbed();return;}
    const kind=this.frameState(frame).kind;
    preview.frame={frame,src,kind,position:embed.style.position};
    // A player with a control protocol starts muted in place; others reload with the provider's own flags.
    if(kind==='flags')frame.src=flagged(src,false);
    else{this.command(frame,'mute');this.command(frame,'play');}
    // The layer sits in the embed's shadow root over its iframe.
    if(this.win.getComputedStyle(embed).position==='static')embed.style.position='relative';
    host=embed.shadowRoot;
   }
   preview.active=true;
   // While it previews, a layer over the embed takes the click (the iframe would otherwise play it in place).
   const layer=preview.layer=this.doc.createElement('div');
   layer.dataset.rtEmbedLayer='';layer.setAttribute('role','link');layer.setAttribute('aria-label',this.clickPlays?'Play with sound':'Open post');
   Object.assign(layer.style,{position:'absolute',inset:'0',zIndex:'5',cursor:'pointer',background:'transparent'});
   const sound=this.doc.createElement('button');
   sound.type='button';sound.setAttribute('aria-label','Turn sound on');
   Object.assign(sound.style,{position:'absolute',right:'12px',bottom:'12px',width:'32px',height:'32px',border:'0',borderRadius:'999px',
    background:'rgba(0,0,0,.6)',color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',padding:'0'});
   sound.innerHTML='<svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M9.2 3.2 5.3 6.6H2.6a.9.9 0 0 0-.9.9v5a.9.9 0 0 0 .9.9h2.7l3.9 3.4a.9.9 0 0 0 1.5-.7V3.9a.9.9 0 0 0-1.5-.7Zm9 4.1-1.3-1.3-2.1 2.2-2.1-2.2-1.3 1.3 2.1 2.2-2.1 2.1 1.3 1.3 2.1-2.1 2.1 2.1 1.3-1.3-2.1-2.1 2.1-2.2Z"/></svg>';
   layer.append(sound);
   layer.addEventListener('click',event=>{
    event.preventDefault();event.stopPropagation();
    this.useEmbed(preview,event.composedPath().includes(sound));
   });
   host.append(layer);
  }
  useEmbed(preview,sound){
   if(this.ePreview!==preview)return;
   if(sound || this.clickPlays || !this.openPost(preview.embed)){
    this.promoteEmbed(preview,sound || this.unmutePreview);
   }
  }
  // The preview becomes the user's: the layer goes, it keeps playing, with sound when chosen.
  promoteEmbed(preview,sound){
   if(this.ePreview!==preview)return;
   this.ePreview=null;
   this.win.clearTimeout(preview.timer);this.win.clearTimeout(preview.leave);
   preview.layer?.remove();delete preview.embed.dataset.rtEmbedPreview;
   preview.embed.dataset.rtEmbedUsed='1';
   if(preview.frame){this.restoreHost(preview);if(sound)this.frameSound(preview.frame);return;}
   if(sound)preview.embed.dispatchEvent(new this.win.Event('rt-embed-sound',{bubbles:true}));
  }
  frameSound({frame,src,kind}){if(kind==='flags')frame.src=flagged(src,true);else{this.command(frame,'unmute');this.command(frame,'play');}}
  restoreHost(preview){if(preview.frame)preview.embed.style.position=preview.frame.position || '';}
  stopEmbed(){
   const preview=this.ePreview;if(!preview)return;
   this.ePreview=null;
   this.win.clearTimeout(preview.timer);this.win.clearTimeout(preview.leave);
   preview.layer?.remove();delete preview.embed.dataset.rtEmbedPreview;
   if(preview.frame){
    this.restoreHost(preview);
    const {frame,src,kind}=preview.frame;
    if(preview.active && frame.isConnected){if(kind==='flags')frame.src=src;else{this.command(frame,'pause');this.command(frame,'unmute');}}
    return;
   }
   if(preview.active)preview.embed.dispatchEvent(new this.win.Event('rt-embed-stop',{bubbles:true}));
  }
  // Opening a post whose YouTube embed plays (or previews) continues it in the post's embed at the same second.
  rememberEmbed(embed,id){
   const preview=this.ePreview?.embed===embed && this.ePreview.active ? this.ePreview : null;
   // Other providers: no position to read, but the same iframe (previewing, or one you clicked into) moves into the post.
   if(!embed.matches(EMBED)){
    if(!preview && embed.dataset.rtEmbedUsed!=='1')return false;
    if(preview){this.ePreview=null;this.win.clearTimeout(preview.timer);this.win.clearTimeout(preview.leave);preview.layer?.remove();delete embed.dataset.rtEmbedPreview;this.restoreHost(preview);
     if(this.unmutePreview)this.frameSound(preview.frame);}
    this.clearEmbedHandoff();
    const held=!embed.dispatchEvent(new this.win.Event('rt-hold-feed-embed',{bubbles:true,cancelable:true}));
    if(!held)return false;
    this.embedPending={id,from:this.win.location.pathname,held,generic:true};
    const pending=this.embedPending,watch=()=>{if(this.embedPending!==pending || this.dead)return;this.embedHandoff();this.win.requestAnimationFrame(watch);};
    this.win.requestAnimationFrame(watch);
    this.embedExpiry=this.win.setTimeout(()=>this.clearEmbedHandoff(),CONTINUE_MS);
    return true;
   }
   embed.dispatchEvent(new this.win.Event('rt-embed-snapshot',{bubbles:true}));
   const time=Number(embed.dataset.rtEmbedTime);
   if(!preview && embed.dataset.rtEmbedState!=='playing' || !(time>=0))return false;
   const muted=preview?!this.unmutePreview:embed.dataset.rtEmbedMuted==='true';
   const restart=Boolean(preview && this.restartPreview);
   this.clearEmbedHandoff();
   try{this.win.sessionStorage.setItem(EMBED_KEY,JSON.stringify({id,owner:owner(this.doc),at:Date.now(),time:restart?0:time,muted}));}catch{}
   if(preview){this.ePreview=null;this.win.clearTimeout(preview.timer);this.win.clearTimeout(preview.leave);preview.layer?.remove();delete embed.dataset.rtEmbedPreview;}
   // The same YouTube player moves into the post (page bridge); without it, the post's embed starts at this second.
   const held=!embed.dispatchEvent(new this.win.Event('rt-hold-feed-embed',{bubbles:true,cancelable:true}));
   this.embedPending={id,from:this.win.location.pathname,held,restart,muted};
   // A held player is placed on the first frame the post's embed is ready, not on the next 200 ms scan.
   if(held){
    const pending=this.embedPending,watch=()=>{if(this.embedPending!==pending || this.dead)return;this.embedHandoff();this.win.requestAnimationFrame(watch);};
    this.win.requestAnimationFrame(watch);
   }
   this.embedExpiry=this.win.setTimeout(()=>this.clearEmbedHandoff(),CONTINUE_MS);
   if(!held)embed.dispatchEvent(new this.win.Event('rt-embed-stop',{bubbles:true}));
   return true;
  }
  embedHandoff(){
   const generic=this.embedPending?.generic?this.embedPending:null;
   if(generic){
    const id=postId(this.win.location.pathname);
    if(id!==generic.id){if(this.win.location.pathname!==generic.from)this.clearEmbedHandoff();return;}
    const target=[...this.doc.querySelectorAll(ANY_EMBED)].find(node=>node.closest('shreddit-post')?.id==='t3_'+id && !node.closest('shreddit-feed'));
    if(!target)return;
    if(!('rtIncoming' in target.dataset)){target.dataset.rtIncoming=target.style.visibility;target.style.visibility='hidden';}
    if(target.dispatchEvent(new this.win.Event('rt-place-held-embed',{bubbles:true,cancelable:true})))return;
    target.style.visibility=target.dataset.rtIncoming;delete target.dataset.rtIncoming;
    this.embedPending=null;this.clearEmbedHandoff();
    return;
   }
   let saved;
   try{saved=JSON.parse(this.win.sessionStorage.getItem(EMBED_KEY) || 'null');}catch{}
   if(!saved)return;
   const id=postId(this.win.location.pathname),age=Date.now()-saved.at;
   if(!this.continueOnOpen || !(age>=0 && age<CONTINUE_MS) || saved.owner!==owner(this.doc)){this.clearEmbedHandoff();return;}
   const pending=this.embedPending;
   if(saved.id!==id){if(pending && this.win.location.pathname!==pending.from)this.clearEmbedHandoff();return;}
   // Reddit keeps the outgoing feed (with this post's card) in the page: only the post's own embed continues.
   const embed=[...this.doc.querySelectorAll(EMBED)].find(node=>node.closest('shreddit-post')?.id==='t3_'+id && !node.closest('shreddit-feed'));
   if(!embed)return;
   if(pending?.held){
    // Waits until Reddit has laid out the post's embed; its own thumbnail and play button stay hidden meanwhile.
    if(!('rtIncoming' in embed.dataset)){embed.dataset.rtIncoming=embed.style.visibility;embed.style.visibility='hidden';}
    if(embed.dispatchEvent(new this.win.Event('rt-place-held-embed',{bubbles:true,cancelable:true})))return;
    embed.style.visibility=embed.dataset.rtIncoming;delete embed.dataset.rtIncoming;
    this.embedPending=null;this.clearEmbedHandoff();
    if(pending.restart){embed.dataset.rtStart='0';embed.dataset.rtMuted=String(saved.muted===true);embed.dispatchEvent(new this.win.Event('rt-embed-continue',{bubbles:true,cancelable:true}));}
    else if(!saved.muted)embed.dispatchEvent(new this.win.Event('rt-embed-sound',{bubbles:true}));
    return;
   }
   embed.dataset.rtStart=String(saved.time);embed.dataset.rtMuted=String(saved.muted===true);
   if(!embed.dispatchEvent(new this.win.Event('rt-embed-continue',{bubbles:true,cancelable:true})))this.clearEmbedHandoff();
  }
  clearEmbedHandoff(){
   this.win.clearTimeout(this.embedExpiry);
   for(const embed of this.doc.querySelectorAll('[data-rt-incoming]')){embed.style.visibility=embed.dataset.rtIncoming;delete embed.dataset.rtIncoming;}
   if(this.embedPending?.held)this.doc.dispatchEvent(new this.win.Event('rt-release-feed-embed'));
   this.embedPending=null;
   try{this.win.sessionStorage.removeItem(EMBED_KEY);}catch{}
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
    this.play(player,video)?.catch?.(()=>this.continued.delete(video));
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
   const embed=[...card.querySelectorAll(ANY_EMBED)].find(node=>this.feedEmbed(node));
   if(embed && this.rememberEmbed(embed,id))return;
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
   this.play(player,video)?.catch?.(()=>this.continued.delete(video));
  }
  onPlay(player,event){
   const video=event.target;if(!(video instanceof (this.doc.defaultView?.HTMLMediaElement || HTMLMediaElement)))return;
   if(this.continued.has(video)){this.exclusive(video);return;}
   const preview=this.previews.get(player);
   if(preview?.active && preview.video===video){preview.played=true;this.exclusive(video);return;}
   const userStarted=this.userStarted(player);
   if(userStarted){this.started.add(video);this.previews.delete(player);this.away.delete(player);}
   else this.started.delete(video);
   if(this.blocksAutoplay && !userStarted){this.block(player,video);return;}
   delete player.dataset.rtAutoplayBlocked;
   this.exclusive(video);
  }
  // One video plays at a time, as on YouTube: whatever starts (a video, a preview, a YouTube player) pauses the rest.
  // A video held for its post keeps playing; YouTube players are paused by the page bridge.
  exclusive(source){
   for(const player of this.players){
    const video=this.video(player);
    if(!video || video===source || video.paused || this.pending?.sourceVideo===video)continue;
    if(this.previews.get(player)?.active && this.hovered===player){this.stopHover();continue;}
    video.pause();
   }
   if(this.ePreview && this.ePreview.embed!==source)this.stopEmbed();
   for(const [frame,state] of this.frames)if(state.kind!=='flags' && frame.isConnected && frame.getRootNode()?.host!==source)this.command(frame,'pause');
   source.dispatchEvent(new this.win.Event('rt-media-exclusive',{bubbles:true,composed:true}));
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
   // Feed layout settling without a scroll (cards loading in) also picks a phone preview.
   if(this.inView && !this.viewing)this.settle();
   for(const entry of entries){
    const player=entry.target,ready=this.visibilityReady.get(player);
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
   this.play(player,video)?.catch?.(()=>this.continued.delete(video));
  }
  settle(){
   this.win.clearTimeout(this.settleTimer);
   this.settleTimer=this.win.setTimeout(()=>{if(this.inView && !this.dead)this.pickInView();},DWELL_MS);
  }
  // After scrolling stops, the feed video at least 60 % visible and nearest the middle of the screen previews, one at a
  // time; a playing preview keeps going while it stays at least half on screen.
  pickInView(){
   const height=this.win.innerHeight,middle=height/2;let best=null,distance=Infinity;
   const candidates=[...this.players].filter(player=>player.getAttribute('player-type')===FEED_PLAYER)
    .concat([...this.doc.querySelectorAll(ANY_EMBED)].filter(embed=>this.feedEmbed(embed)));
   for(const node of candidates){
    if(!node.isConnected)continue;
    const box=node.getBoundingClientRect();if(!(box.height>0))continue;
    const shown=(Math.min(box.top+box.height,height)-Math.max(box.top,0))/box.height,gap=Math.abs(box.top+box.height/2-middle);
    if(shown>=IN_VIEW && gap<distance){best=node;distance=gap;}
   }
   if(best && (best===this.hovered || best===this.ePreview?.embed))return;
   this.stopHover();
   if(!best)return;
   if(best.matches(ANY_EMBED)){
    const preview=this.ePreview={embed:best,card:best.closest('shreddit-post'),view:true};
    this.startEmbed(preview);
    return;
   }
   this.hovered=best;this.viewing=true;
   this.startPreview(best);
  }
  destroy(){
   this.dead=true;this.mo?.disconnect();this.io?.disconnect();
   this.stopHover();
   for(const type of ['pointerdown','keydown','click'])this.doc.removeEventListener(type,this.onGesture,true);
   for(const type of ['pointerover','pointerout'])this.doc.removeEventListener(type,this.onHover,true);
   this.doc.removeEventListener('visibilitychange',this.onTabVisibility);
   this.win.removeEventListener('scroll',this.onScroll,{capture:true});this.win.clearTimeout(this.settleTimer);
   this.doc.removeEventListener('click',this.onRemember,true);this.doc.removeEventListener('reddit:route',this.onRoute);this.doc.removeEventListener('rt-embed-playing',this.onEmbedPlaying);this.win.removeEventListener('blur',this.onFrameFocus);this.win.removeEventListener('message',this.onFrameMessage);
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
