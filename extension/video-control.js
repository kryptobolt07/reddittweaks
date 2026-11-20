/* Videos (docs/video-control-spec.md): enforce Reddit's own "Autoplay media" off, which its phone layout ignores, pause
   a playing video as soon as it is mostly scrolled away, muted YouTube-style previews (hover on desktop, optionally the
   video in view on phones), and keep playing the same video when its post opens. Reddit's player (shreddit-player)
   keeps its <video> in an open shadow root and starts it from script, so its non-bubbling play event is caught there
   in the capture phase. */
(() => {
 'use strict';
 if(globalThis.RTVideoControl || window.top!==window)return;
 const PLAYERS='shreddit-player, shreddit-player-2',GESTURE_MS=1500,HOVER_MS=160,LEAVE_MS=250,FADE_MS=200,IN_VIEW=0.6,DWELL_MS=600,AUTOPLAY_MS=150,PROBE_MS=2500,PREF_KEY='rt-video-autoplay-v1',PREF_TTL=3600000,CONTINUE_KEY='rt-video-continue-v1',CONTINUE_MS=12000;
 const COMMENT='shreddit-comment',MEDIA_NODES=PLAYERS+', '+COMMENT+' video';
 const commentOf=node=>node?.closest?.(COMMENT);
 const closedThread=node=>Boolean(commentOf(node) && node.closest('shreddit-comment[collapsed],details:not([open]),[hidden], [inert]'));
 const PLAY_BUTTON='.poster-play-button,.play-pause-button';
 const SOUND_CONTROL='.mute-button,.volume-slider';
 const FEED_PLAYER='in_feed_player',DETAIL_PLAYER='post_detail_screen';
 // YouTube embeds Reddit renders as lite-youtube with the YouTube player API (controlled by the page bridge).
 const EMBED='shreddit-embed[providername="YouTube"]',EMBED_KEY='rt-embed-continue-v1',ANY_EMBED='shreddit-embed';
 // Other providers (Streamable, Twitch, Dailymotion, …): Reddit renders their oEmbed iframe directly in the embed.
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
  // Vimeo keeps muted apart from volume: a player loaded with muted=1 stays silent at any volume until setMuted(false).
  if(kind==='vimeo')return method==='mute'?[JSON.stringify({method:'setMuted',value:true})]:method==='unmute'?[JSON.stringify({method:'setMuted',value:false}),JSON.stringify({method:'setVolume',value:1})]:JSON.stringify({method});
  if(kind==='youtube')return JSON.stringify({event:'command',func:{play:'playVideo',pause:'pauseVideo',mute:'mute',unmute:'unMute'}[method],args:[]});
  return '';
 }
 // Whether a player's message says it started playing, or is ready for commands.
 function frameEvent(kind,raw){
  let data=raw;if(typeof data==='string'){try{data=JSON.parse(data);}catch{return '';}}
  if(!data || typeof data!=='object')return '';
  if(kind==='playerjs')return data.context!=='player.js'?'':data.event==='play'?'play':['pause','ended'].includes(data.event)?'pause':'ready';
  if(kind==='vimeo')return ['pause','ended'].includes(data.event)?'pause':['play','ready'].includes(data.event)?data.event:'';
  if(kind==='youtube'){const state=data.event==='onStateChange'?data.info:data.event==='infoDelivery'?data.info?.playerState:null;return state===1?'play':state===0 || state===2?'pause':data.event==='onReady'?'ready':'';}
  return '';
 }
 // Vimeo: Reddit renders its own lite-vimeo placeholder (read from Reddit's code 2026-11-19): a click adds
 // player.vimeo.com/video/<id>?dnt=1 inside its shadow root, with autoplay=1 only when it has both autoload and autoplay.
 const vimeoLite=embed=>embed?.shadowRoot?.querySelector?.('lite-vimeo') || null;
 // The player frame that can be driven: a plain provider iframe, or Vimeo's once lite-vimeo made it (activate: make it
 // now, playing with the requested sound state).
 function controlFrame(embed,activate=''){
  const raw=rawFrame(embed);if(raw)return raw;
  const lite=vimeoLite(embed);if(!lite)return null;
  let frame=lite.shadowRoot?.querySelector('iframe') || null;
  if(!frame && activate){
   lite.setAttribute('autoload','');lite.setAttribute('autoplay','autoplay');lite.click();
   frame=lite.shadowRoot?.querySelector('iframe') || null;
   if(frame){
    try{
     const url=new URL(frame.getAttribute('src'));
     url.searchParams.set('autoplay','1');
     url.searchParams.set('muted',activate==='muted'?'1':'0');
     allowAutoplay(frame);frame.setAttribute('src',url.href);
    }catch{}
   }
  }
  return frame;
 }
 const youTubeLite=embed=>embed?.shadowRoot?.querySelector?.('lite-youtube') || null;
 const embedHosts=globalThis.RTEmbedHosts;
 // A player reloaded to start by itself may play sound only if its frame is allowed to autoplay (Reddit's Embedly
 // frames are; a RedGIFs one may not be). The permission applies from its next load.
 function allowAutoplay(frame){const allow=frame.getAttribute('allow') || '';if(!/(^|;)\s*autoplay\b/.test(allow))frame.setAttribute('allow',(allow.trim()?allow.trim().replace(/;?$/,'; '):'')+'autoplay; fullscreen; picture-in-picture');}
 const posterOK=url=>typeof url==='string' && url.length<=2048 && /^https:\/\/[^\s"'()\\]+$/.test(url);
 const thumbAttrs=node=>['poster','thumbnail-url','thumbnail','preview-image','preview-url'].map(name=>node?.getAttribute(name));
 function templateAddress(embed){
  for(const name of ['embedly-iframe','embed-html','html']){
   const src=/<iframe\b[^>]*\ssrc\s*=\s*(['"])(.*?)\1/i.exec(embed.getAttribute(name) || '')?.[2];
   if(src)return src.replaceAll('&amp;','&');
  }
  return '';
 }
 function embedAddress(embed){
  const frame=controlFrame(embed),lite=vimeoLite(embed);
  const original=frame?.dataset.rtSrc || frame?.getAttribute('src') || templateAddress(embed);
  const vimeo=lite?.getAttribute('videoid') || lite?.getAttribute('video-id');
  try{return new URL(original || (/^\d+$/.test(vimeo || '')?'https://player.vimeo.com/video/'+vimeo:''));}catch{return null;}
 }
 const sourceAddress=url=>url?.hostname==='cdn.embedly.com'?url.searchParams.get('src'):url?.href;
 function embedPosters(embed){
  const url=embedAddress(embed),lite=vimeoLite(embed) || youTubeLite(embed);
  const image=lite?.shadowRoot?.querySelector('img') || embed.shadowRoot?.querySelector('img:not([data-rt-parked-still],[data-rt-pre-still])');
  let markup;try{markup=new URL(templateAddress(embed));}catch{}
  const widgetImages=[url,markup].map(address=>address?.hostname==='cdn.embedly.com'?address.searchParams.get('image'):'');
  const style=lite?.getAttribute('style') || '';
  return [...thumbAttrs(embed),...thumbAttrs(lite),image?.currentSrc || image?.src,...widgetImages,
   /url\(['"]?(https:\/\/[^'"()\s]+)['"]?\)/.exec(style)?.[1]].filter(posterOK);
 }
 // A still from Reddit's own data for one post: its preview image first, then the provider's (RedGIFs' poster is
 // named there with the capitals its media host needs). Reddit refuses the batched lookups (/api/info.json, /by_id:
 // HTTP 403, measured 2026-11-20); a single post's data still answers, so these go one at a time, spaced out, and stop
 // for a while on a refusal.
 let stillsPausedUntil=0;
 const postStills=d=>{
  const image=d?.preview?.images?.[0],sized=(image?.resolutions || []).find(r=>r.width>=480) || image?.source;
  return [...new Set([sized?.url,d?.secure_media?.oembed?.thumbnail_url,d?.media?.oembed?.thumbnail_url,image?.source?.url].filter(posterOK))];
 };
 // Two reads at a time, in the order given (nearest the screen first); each still is reported as soon as it's read.
 async function readPostStills(ids,onFound,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))){
  const out={},queue=[...ids];
  const worker=async()=>{
   while(queue.length && Date.now()>=stillsPausedUntil){
    const id=queue.shift();
    try{
     // Firefox content scripts fetch as the extension; content.fetch reads as the page, like Chrome's.
     const read=globalThis.content?.fetch?globalThis.content.fetch.bind(globalThis.content):fetch;
     const response=await read(new URL('/comments/'+id.replace(/^t3_/,'')+'.json?limit=1&depth=1&raw_json=1',location.origin).href,{credentials:'include',headers:{Accept:'application/json'}});
     if(response.status===403 || response.status===429){stillsPausedUntil=Date.now()+300000;break;}
     if(response.ok){const urls=postStills((await response.json())?.[0]?.data?.children?.[0]?.data);if(urls.length){out[id]=urls;onFound?.(id,urls);}}
    }catch{}
    if(queue.length)await wait(150);
   }
  };
  await Promise.all([worker(),worker()]);
  return out;
 }
 async function readPosters(ids,sources,onFound){
  const items=ids.flatMap(id=>sources.get(id)?[[id,sources.get(id)]]:[]);
  const api=globalThis.browser || globalThis.chrome;
  let found={};
  try{found=(items.length?await api?.runtime?.sendMessage?.({scope:'rt-embed-posters',items}):{}) || {};}catch{}
  for(const [id,url] of Object.entries(found))if(posterOK(url))onFound?.(id,url,true);
  const missing=ids.filter(id=>!posterOK(found[id]));
  return missing.length?{...found,...await readPostStills(missing,onFound)}:found;
 }
 // The player's address without a request to start by itself (also inside Embedly's wrapper).
 function idleSource(src){
  let url;try{url=new URL(src);}catch{return src;}
  if(/(^|\.)embedly\.com$/i.test(url.hostname) && url.searchParams.get('src'))url.searchParams.set('src',idleSource(url.searchParams.get('src')));
  for(const key of ['autoplay','auto_play'])if(['1','true'].includes(url.searchParams.get(key)))url.searchParams.delete(key);
  return url.href;
 }
 function flagged(src,sound){
  let url;try{url=new URL(src);}catch{return src;}
  // Embedly's wrapper: the flags belong on the provider's own address inside it.
  if(/(^|\.)embedly\.com$/i.test(url.hostname) && url.searchParams.get('src')){url.searchParams.set('src',flagged(url.searchParams.get('src'),sound));return url.href;}
  const flags=FLAGS.find(([host])=>host.test(url.hostname))[1];
  for(const [key,value] of Object.entries(flags)){
   if(!sound || key==='autoplay')url.searchParams.set(key,value);
   else if(value==='true')url.searchParams.set(key,'false');else url.searchParams.delete(key);
  }
  return url.href;
 }
 const postId=path=>/^\/(?:r\/[^/]+\/|user\/[^/]+\/)?comments\/([a-z0-9]{1,10})(?:\/|$)/i.exec(path)?.[1].toLowerCase() || '';
 const {videoSettings}=globalThis.RTPostModel;
 const kinds=['video','gif','embed'];
 const mediaKind=node=>node?.matches?.(ANY_EMBED)?'embed':node?.matches?.('[gif],[post-type="gif"],[data-media-type="gif"]') || node?.closest?.('shreddit-post[post-type="gif"]')?'gif':'video';
 const viewMode=mode=>mode==='autoplay' || mode==='stop';
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
  constructor({doc=document,readSettings,readPreference=readAutoplayDisabled,readDirect=null,observe=true}={}){
   this.doc=doc;this.win=doc.defaultView;this.settings={};this.autoplayDisabled=null;this.players=new Set();this.attached=new WeakSet();this.previews=new WeakMap();this.started=new WeakSet();this.continued=new WeakSet();this.gesture={at:-Infinity,path:[]};this.dead=false;
   this.visibilityReady=new WeakMap();this.fading=new WeakMap();this.away=new WeakMap();this.loops=new Map();
   this.detailEmbeds=new Set();this.embedAway=new Set();this.feedSoundEmbeds=new Set();this.managedViewport=new Set();
   this.choice=videoSettings({});
   this.onGesture=event=>{
    if(!event.isTrusted && !globalThis.__rtVideoControlTest)return;
    const path=event.composedPath();
    this.gesture={at:performance.now(),path};
    const lite=path.find(node=>node.matches?.('lite-youtube,lite-vimeo')),embed=path.find(node=>node.matches?.(ANY_EMBED));
    if(event.type==='click' && event.button===0 && lite && this.feedEmbed(embed) && this.ePreview?.embed!==embed){
     embed.dataset.rtEmbedUsed='1';this.watchFeedSound(embed);
    }
    const player=path.find(node=>node.matches?.(MEDIA_NODES));
    if(!player || closedThread(player))return;
    this.attach(player);
    const video=this.video(player);
    if(this.previews.get(player)?.video===video){
     if(event.type==='click' && event.button===0)this.usePreview(player,event,path);
    }else if(video && !video.paused)this.started.add(video);
   };
   this.onHover=event=>this.hover(event);
   this.onTabVisibility=()=>{if(this.doc.hidden){this.stopHover();for(const player of this.loops.keys())this.stopLoop(player);}else if(this.inView)this.settle();};
   this.onCommentToggle=event=>{if(commentOf(event.target))this.syncCommentVisibility();};
   // Phones, like YouTube's feed: a preview starts once scrolling has stopped for a moment.
   this.onScroll=()=>{if(this.inView)this.settle();};
   this.onRemember=event=>this.remember(event);
   this.onEmbedLink=event=>{
    const path=event.composedPath(),embed=path.find(node=>node.matches?.(ANY_EMBED)),link=path.find(node=>node.matches?.('a[href]'));
    if(!embed || !link || !this.blockEmbedLinks(!this.isDetailEmbed(embed)))return;
    if(/^https?:/.test(link.href) && new URL(link.href).origin!==this.win.location.origin){event.preventDefault();event.stopImmediatePropagation();}
   };
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
   doc.addEventListener('toggle',this.onCommentToggle,true);
   this.win.addEventListener('scroll',this.onScroll,{passive:true,capture:true});
   doc.addEventListener('click',this.onRemember,true);
   for(const type of ['click','auxclick'])doc.addEventListener(type,this.onEmbedLink,true);
   doc.addEventListener('reddit:route',this.onRoute);
   // The page bridge reports a YouTube player that started (by its own controls, a preview or a continuation).
   this.onEmbedPlaying=event=>{
    const embed=event.target;if(!embed?.matches?.(EMBED))return;
    if(this.startMode('embed')==='play' && this.feedEmbed(embed) && embed.dataset.rtEmbedUsed!=='1'){
     embed.dispatchEvent(new this.win.Event('rt-embed-stop',{bubbles:true}));this.cover(embed,true);return;
    }
    this.exclusive(embed);
   };
   doc.addEventListener('rt-embed-playing',this.onEmbedPlaying);
   // Clicking into an embed's player moves focus into its iframe (the page sees a blur): that embed is in use, so other
   // videos pause, and opening its post carries it over.
   this.onFrameFocus=()=>this.win.setTimeout(()=>{
    const active=this.doc.activeElement;if(!active?.matches?.(ANY_EMBED))return;
    active.dataset.rtEmbedUsed='1';this.exclusive(active);
   },0);
   this.win.addEventListener('blur',this.onFrameFocus);
   // Provider players report starting (see frameEvent): that one plays, everything else pauses.
   this.frames=new Map();this.posters=new Map();this.providerPosters=new Set();this.posterWanted=new Map();this.watchedEmbeds=new WeakMap();
   this.posterNodes=new Set();this.preparedPosters=new WeakSet();this.warmedPosters=new Map();
   this.posterConsumers=new Map();this.posterQuality=new Map();this.posterDeferred=new Set();
   this.readPosters=readPosters;
   this.viewportRequest=0;
   this.onEmbedResize=()=>{
    this.win.clearTimeout(this.embedResizeTimer);
    this.embedResizeTimer=this.win.setTimeout(()=>{
     for(const [frame,state] of this.frames)if(frame.isConnected && frame.hasAttribute('data-rt-fit-preview'))this.measureEmbedViewport(frame,state);
    },100);
   };
   this.win.addEventListener('resize',this.onEmbedResize,{passive:true});
   this.onFrameMessage=event=>{
    for(const [frame,state] of this.frames){
     if(!frame.isConnected){this.frames.delete(frame);continue;}
     if(!event.source || frame.contentWindow!==event.source)continue;
     if(event.data?.rtMedia && event.origin===this.embedOrigin(frame)){
      const method=event.data.rtMedia;
      if(method==='hello'){
       state.direct=true;state.pendingStart=null;state.queue.clear();
       if(this.ePreview?.frame?.frame===frame)this.labelEmbedSound(this.ePreview);
       this.framePolicy(frame,state.block,true);
       if(state.directSound){this.postDirect(frame,state.directSound);state.directSound='';}
       if(state.directPlayback){this.postDirect(frame,state.directPlayback);state.directPlayback='';}
       else this.postDirect(frame,this.idleChoice(frame));
       this.measureEmbedViewport(frame,state);
      }else if(state.direct && method==='viewport')this.adjustEmbedViewport(frame,state,event.data);
      else if(state.direct && ['play','pause'].includes(method))this.framePlayback(frame,state,method);
      return;
     }
     if(state.direct)return;
     const kind=frameEvent(state.kind,event.data);
     if(kind && !state.readySeen){
      state.readySeen=true;state.pendingStart=null;
      this.flushFrameCommands(frame,state);
      this.subscribe(frame,state);
     }
     this.framePlayback(frame,state,kind);
     return;
    }
   };
   this.win.addEventListener('message',this.onFrameMessage);
   this.win.addEventListener('popstate',this.onBack);
   this.win.addEventListener('pagehide',this.onPageExit);
   this.io=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>this.onVisibility(entries),{threshold:[0,0.5,IN_VIEW,1]}):null;
   // Warm markup stills when the card arrives. Defer public metadata requests for cards well outside the viewport.
   const screen=this.win.innerHeight || 800;
   this.posterIO=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{
    if(this.dead)return;
    for(const entry of entries)if(entry.isIntersecting && this.posterDeferred.has(entry.target))this.paintPoster(entry.target);
   },{rootMargin:`${Math.round(screen*1.5)}px 0px ${screen*5}px 0px`}):null;
   this.mo=observe?new MutationObserver(records=>{if(records.some(record=>record.attributeName==='collapsed' && record.target.matches(COMMENT)))this.syncCommentVisibility();this.handoff();this.schedule();}):null;
   this.mo?.observe(doc.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['collapsed']});
   this.readPreference=readPreference;this.preference=null;
   // Whether direct embed controls are on: then a player that starts by itself is held on its first frame, not unloaded.
   this.directReady=false;
   const direct=Promise.resolve(readDirect?.()).then(value=>{this.directReady=value===true;},()=>{});
   this.ready=Promise.all([readSettings?.(),direct]).then(([s])=>{this.configure(s || {});},()=>this.configure({}));
  }
  configure(settings){
   const before=this.choice;
   this.settings=settings || {};this.choice=videoSettings(this.settings);
   const active=this.hovered || this.ePreview?.embed,kind=mediaKind(active);
   if(active && this.startMode(kind,before)!==this.startMode(kind))this.stopHover();
   if(this.startMode('gif',before)!==this.startMode('gif'))for(const player of this.loops.keys())this.stopLoop(player);
   if(!this.pauseAway){this.embedAway.clear();this.away=new WeakMap();}
   if(!this.continueOnOpen)this.clearHandoff();
   else if(!this.configured)this.restoreHandoff();
   this.configured=true;this.scan();
   // Visibility reports that arrived before the settings did still choose the in-view preview.
   if(this.inView)this.settle();
   else if(this.viewing || this.ePreview?.view)this.stopHover();
   // These choices replace Reddit's own autoplay (and its "Autoplay media" setting): a video Reddit starts by itself is
   // paused at once; Autoplay then plays the one in view, muted, one at a time.
   for(const player of this.players){const video=this.video(player);if(video && !video.paused && !this.started.has(video) && !this.continued.has(video) && !this.loops.has(player))this.block(player,video);}
  }
  get touch(){return Boolean(this.win.matchMedia?.('(hover: none), (pointer: coarse)')?.matches);}
  // How feed videos start on this device: Autoplay (the video in view, muted) / Preview on hover (computers) or on the
  // one you stop scrolling on (phones) / Only when you press Play.
  startMode(kind,settings=this.choice){return settings[kind+(this.touch?'StartTouch':'Start')];}
  get pauseAway(){return this.choice.videoScrollAway==='pause';}
  get unmutePreview(){return this.choice.videoUnmutePreview;}
  get continueOnOpen(){return this.choice.videoOpenPost==='continue';}
  get previewClick(){return this.choice.videoPreviewClick;}
  get restartPreview(){return this.choice.videoPreviewFrom==='start';}
  blockEmbedLinks(feed){return this.choice.embedBlockLinks==='both' || this.choice.embedBlockLinks===(feed?'feed':'posts');}
  // Phones have no hover: the video you stop scrolling on previews instead, when chosen.
  get inView(){return kinds.some(kind=>viewMode(this.startMode(kind)));}
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
   for(const node of this.posterNodes)if(!node.isConnected)this.posterNodes.delete(node);
   for(const node of this.posterDeferred)if(!node.isConnected)this.stopDeferringPoster(node);
   for(const embed of this.feedSoundEmbeds)if(!embed.isConnected || !this.feedEmbed(embed))this.stopWatchingFeedSound(embed);
   for(const player of this.players)if(!player.isConnected){
    if(this.hovered===player)this.stopHover();
    this.stopLoop(player);
    this.manageViewport(player,false);
    this.players.delete(player);this.previews.delete(player);this.io?.unobserve(player);
   }
   for(const player of this.doc.querySelectorAll(MEDIA_NODES)){
    this.attach(player);
    if(player.getAttribute('player-type')===FEED_PLAYER)this.observePoster(player);
    if(player.matches(PLAYERS))this.manageViewport(player,this.isDetailMedia(player));
   }
   for(const embed of this.detailEmbeds)if(!embed.isConnected || !this.isDetailEmbed(embed)){
    this.detailEmbeds.delete(embed);this.embedAway.delete(embed);this.io?.unobserve(embed);this.manageViewport(embed,false);
   }
   for(const embed of this.doc.querySelectorAll(ANY_EMBED)){
    this.watchEmbed(embed);
    // Watched for its still as soon as its card is in the page, before Reddit inserts the player near the screen.
    if(this.configured && this.stillWanted(embed))this.observePoster(embed);
    const frame=controlFrame(embed),state=frame && this.frameState(frame);
    if(state)this.framePolicy(frame,this.blockEmbedLinks(!this.isDetailEmbed(embed)));
    if(!this.isDetailEmbed(embed))continue;
    if(!this.detailEmbeds.has(embed)){this.detailEmbeds.add(embed);this.io?.observe(embed);}
    this.manageViewport(embed,!this.pauseAway || embed.matches(EMBED) || Boolean(state && (state.direct || state.kind!=='flags')));
   }
   if(this.configured)this.parkIdle();
   this.handoff();
   this.embedHandoff();
  }
  attach(player){
   const direct=player.matches('video'),root=direct?player:player.shadowRoot;
   if(this.players.has(player) || !root)return;
   this.players.add(player);this.io?.observe(player);
   if(this.inView && !this.viewing)this.settle();
   if(this.attached.has(player))return;
   this.attached.add(player);
   if(direct)player.controls=true;
   root.addEventListener('play',event=>this.onPlay(player,event),true);
   root.addEventListener('timeupdate',event=>this.onTime(event),true);
   root.addEventListener('pause',event=>{
    if(event.target.paused)this.continued.delete(event.target);
   },true);
   // Reddit re-applies its saved volume when a video starts; a preview stays muted until it plays for real.
   root.addEventListener('volumechange',event=>{
    const preview=this.previews.get(player);
    if(preview?.active && preview.video===event.target && !event.target.muted)event.target.muted=true;
   },true);
   root.addEventListener('loadedmetadata',event=>{
    const preview=this.previews.get(player);
    if(preview?.active && preview.video===event.target)this.playPreview(player,preview);
    if(this.loops.get(player)===event.target)this.playLoop(player,event.target);
    if(this.away.get(player)?.loading)this.resumeAway(player);
    this.handoff();
   },true);
   const video=this.video(player);
   if(commentOf(player) && video && !video.paused)this.block(player,video);
  }
  video(player){return player.matches('video')?player:player.shadowRoot?.querySelector('video') || null;}
  isDetailMedia(player){
   const id=postId(this.win.location.pathname),comment=commentOf(player);
   return Boolean(id && (comment?comment.getAttribute('postid')==='t3_'+id:player.getAttribute('player-type')===DETAIL_PLAYER && player.getAttribute('post-id')==='t3_'+id));
  }
  isDetailEmbed(embed){
   const id=postId(this.win.location.pathname);
   return Boolean(id && embed.closest('shreddit-post')?.id==='t3_'+id && !embed.closest('shreddit-feed,shreddit-comment'));
  }
  manageViewport(node,enabled){
   if(enabled){
    if(this.managedViewport.has(node))return;
    if(!node.dispatchEvent(new this.win.Event('rt-manage-media-viewport',{bubbles:true,cancelable:true})))this.managedViewport.add(node);
   }else if(this.managedViewport.delete(node)){
    node.dispatchEvent(new this.win.Event('rt-restore-media-viewport',{bubbles:true}));
   }
  }
  userStarted(player){return performance.now()-this.gesture.at<GESTURE_MS && this.gesture.path.includes(player);}
  previewable(player){return player.getAttribute('player-type')===FEED_PLAYER || Boolean(commentOf(player) && !closedThread(player));}
  syncCommentVisibility(){
   for(const player of this.players){
    if(!closedThread(player))continue;
    if(this.hovered===player)this.stopHover();
    this.stopLoop(player);this.away.delete(player);delete player.dataset.rtPausedAway;
    const video=this.video(player);
    if(video && !video.paused)video.pause();
   }
   if(this.inView)this.settle();
  }
  // A preview belongs to its post card: moving to the title, flair or votes keeps it; leaving the card pauses it.
  cardOf(player){return (commentOf(player)?player.closest('figure') : player.closest('shreddit-post')) || player.parentElement || player;}
  hover(event){
   if(!this.configured || this.touch || event.pointerType!=='mouse' ||
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
   const player=path.find(node=>node.matches?.(MEDIA_NODES));
   if(!player || this.startMode(mediaKind(player))!=='hover' || !this.previewable(player) || event.buttons || current===player)return;
   if(within(to,player))return;
   this.stopHover();
   this.hovered=player;
   this.hoverTimer=this.win.setTimeout(()=>this.startPreview(player),HOVER_MS);
  }
  startPreview(player){
   const video=this.video(player);
   if(this.doc.hidden || this.hovered!==player || !player.isConnected || closedThread(player) || !video?.paused ||
      video.ended || this.started.has(video))return;
   if(mediaKind(player)!=='gif')for(const other of this.players){
    const media=this.video(other);
    if(mediaKind(other)!=='gif' && media && !media.paused && this.started.has(media))return;
   }
   this.attach(player);
   const previous=this.previews.get(player);
   const preview={video,muted:video.muted,active:true,played:previous?.video===video && previous.played};
   this.previews.set(player,preview);
   video.muted=true;
   player.dispatchEvent(new this.win.Event('rt-prepare-feed-preview',{bubbles:true}));
   if(video.readyState>=1)this.playPreview(player,preview);
  }
  startLoop(player){
   const video=this.video(player);
   if(!video || this.started.has(video) || this.loops.get(player)===video)return;
   this.loops.set(player,video);
   video.muted=true;video.loop=true;
   player.dispatchEvent(new this.win.Event('rt-prepare-feed-preview',{bubbles:true}));
   if(video.readyState>=1)this.playLoop(player,video);
  }
  playLoop(player,video){
   if(!closedThread(player) && video.paused)this.play(player,video)?.catch?.(()=>{if(this.loops.get(player)===video)this.stopLoop(player);});
  }
  stopLoop(player){
   const video=this.loops.get(player);
   this.loops.delete(player);
   if(video && !video.paused)video.pause();
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
    this.promotePreview(player,'control');
    return;
   }
   const button=path.some(node=>node.matches?.(PLAY_BUTTON));
   if(!button && path[0]!==preview.video)return;
   if(!preview.played){this.stopHover();return;}
   event.preventDefault();
   event.stopImmediatePropagation();
   if(button) this.promotePreview(player,'here');
   else if(commentOf(player) || this.previewClick!=='open' || !this.openPost(player))this.promotePreview(player,this.previewClick==='muted'?'muted':'here');
  }
  post(frame,data){try{frame.contentWindow?.postMessage(data,new URL(frame.getAttribute('src') || '',this.win.location.href).origin);}catch{}}
  embedOrigin(frame){return embedHosts?.playerOrigin(frame.getAttribute('src')) || '';}
  postDirect(frame,rtMedia,fields){
   const origin=this.embedOrigin(frame);
   if(origin)frame.contentWindow?.postMessage({rtMedia,...fields},origin);
  }
  held(state){return Boolean(state.direct || this.directReady && state.kind==='flags');}
  // What a player that just loaded should do: feed players wait (on their first frame) unless chosen; others play.
  idleChoice(frame){
   let embed=frame.getRootNode()?.host;
   if(embed && !embed.matches(ANY_EMBED))embed=embed.getRootNode()?.host;
   if(!embed?.matches?.(ANY_EMBED) || !this.feedEmbed(embed))return 'play';
   return this.ePreview?.embed===embed || embed.dataset.rtEmbedUsed==='1'?'play':'pause';
  }
  framePolicy(frame,block,force=false){
   const state=this.frameState(frame);
   if(!force && state.block===block)return;
   state.block=block;this.postDirect(frame,'policy',{block});
  }
  framePlayback(frame,state,kind){
   if(kind==='pause')state.playing=false;
   if(kind!=='play')return;
   state.played=true;state.playing=true;
   let embed=frame.getRootNode()?.host;
   if(embed && !embed.matches(ANY_EMBED))embed=embed.getRootNode()?.host;
   if(!embed?.matches?.(ANY_EMBED) || this.ePreview?.embed===embed)return;
   if(this.feedEmbed(embed) && this.startMode('embed')==='play' && embed.dataset.rtEmbedUsed!=='1'){
    this.command(frame,'pause');this.cover(embed,true,true);return;
   }
   embed.dataset.rtEmbedUsed='1';this.exclusive(embed);
  }
  frameState(frame){
   let state=this.frames.get(frame);
   if(!state){
    state={kind:frameKind(frame),queue:new Map()};this.frames.set(frame,state);
    if(state.kind!=='flags')this.subscribe(frame,state);
    frame.addEventListener('load',()=>{
     this.framePolicy(frame,state.block,true);
     this.measureEmbedViewport(frame,state);
     if(state.direct || state.kind==='flags')return;
     this.subscribe(frame,state);this.win.setTimeout(()=>this.flushFrameCommands(frame,state),300);
    });
   }
   return state;
  }
  flushFrameCommands(frame,state){
   for(const messages of state.queue.values())for(const data of messages)this.post(frame,data);
   state.queue.clear();
  }
  subscribe(frame,state){
   if(state.kind==='playerjs')for(const value of ['ready','play','pause','ended'])this.post(frame,JSON.stringify({context:'player.js',version:'0.0.11',method:'addEventListener',value,listener:'rt-'+value}));
   else if(state.kind==='vimeo')for(const value of ['ready','play','pause','ended'])this.post(frame,JSON.stringify({method:'addEventListener',value}));
   else if(state.kind==='youtube')this.post(frame,JSON.stringify({event:'listening',id:'rt'}));
  }
  // Sends now and again once the player says it is ready (commands before that are dropped by these players).
  command(frame,method){
   const state=this.frameState(frame),sound=method==='mute' || method==='unmute';
   if(!state.direct && this.embedOrigin(frame)){
    if(sound)state.directSound=method;
    else state.directPlayback=method;
   }
   if(!state.direct && state.kind==='flags')return false;
   if(method==='play'){state.played=true;state.playing=true;}
   else if(method==='pause'){state.playing=false;state.pendingStart=null;}
   if(state.direct){this.postDirect(frame,method);return true;}
   const messages=[].concat(frameMessage(state.kind,method)),channel=sound?'sound':'playback';
   for(const data of messages)this.post(frame,data);
   state.queue.delete(channel);state.queue.set(channel,messages);
   // Embedly relays player.js only for some providers: a player that never answers is driven by address flags instead.
   if(state.kind==='playerjs' && !state.readySeen && !state.probe){
    state.probe=true;
    this.post(frame,JSON.stringify({context:'player.js',version:'0.0.11',method:'getPaused',listener:'rt-probe'}));
    this.win.setTimeout(()=>{
     if(state.readySeen || state.direct || !frame.isConnected)return;
     state.kind='flags';state.queue.clear();
     const preview=this.ePreview;
     if(preview?.active && preview.frame?.frame===frame){preview.frame.kind='flags';this.labelEmbedSound(preview);}
     if(state.pendingStart && !frame.dataset.rtParked){
      const {src,sound}=state.pendingStart;allowAutoplay(frame);frame.setAttribute('src',flagged(src,sound));
     }
     state.pendingStart=null;
    },PROBE_MS);
   }
   return true;
  }
  // Like Reddit's own YouTube and Vimeo placeholders: the post's preview image with a play button stands in for a
  // player that is not the one chosen to play. A player with no control protocol (RedGIFs plays itself, muted and
  // looping, as soon as it loads) is also unloaded, so it never downloads or plays unseen; one with controls stays
  // loaded and paused under the image (as YouTube's phone feed returns to the thumbnail), so it resumes where it was.
  park(embed,frame,keepCover=false){
   if(frame.dataset.rtParked)return;
   frame.dataset.rtSrc=frame.getAttribute('src') || '';frame.dataset.rtParked='1';frame.setAttribute('src','about:blank');
   this.cover(embed,false,keepCover);
  }
  cover(embed,loaded,keep=false){
   const root=embed.shadowRoot;if(!root)return;
   root.querySelector('[data-rt-pre-still]')?.remove();
   const old=root.querySelector('[data-rt-parked-cover]');if(old){if(!loaded)delete old.dataset.rtLoaded;if(keep)old.dataset.rtKeepCover='';return;}
   if(this.win.getComputedStyle(embed).position==='static')embed.style.position='relative';
   const cover=this.doc.createElement('div');cover.dataset.rtParkedCover='';cover.setAttribute('role','button');cover.setAttribute('aria-label','Play');cover.tabIndex=0;
   if(loaded)cover.dataset.rtLoaded='';
   if(keep)cover.dataset.rtKeepCover='';
   // Fitted on black like the player itself, not cropped.
   Object.assign(cover.style,{position:'absolute',inset:'0',zIndex:'4',cursor:'pointer',backgroundColor:loaded?'transparent':'#000',backgroundPosition:'center',backgroundSize:'contain',backgroundRepeat:'no-repeat',display:'flex',flexDirection:'column',gap:'8px',alignItems:'center',justifyContent:'center'});
   const play=this.doc.createElement('span');play.dataset.rtParkedPlay='';
   Object.assign(play.style,{position:'relative',width:'56px',height:'56px',borderRadius:'999px',background:'rgba(0,0,0,.6)',color:'#fff',display:'flex',alignItems:'center',justifyContent:'center'});
   play.innerHTML='<svg viewBox="0 0 20 20" width="24" height="24" fill="currentColor" aria-hidden="true"><path d="M6 3.8v12.4a.8.8 0 0 0 1.2.7l10-6.2a.8.8 0 0 0 0-1.4l-10-6.2A.8.8 0 0 0 6 3.8Z"/></svg>';
   cover.append(play);
   // With no usable still: the provider's name under the play button (data-rt-placeholder).
   const name=embed.getAttribute('providername');
   if(name){const label=this.doc.createElement('span');label.dataset.rtParkedLabel='';label.textContent=name;
    Object.assign(label.style,{position:'relative',color:'rgba(255,255,255,.75)',font:'600 13px/16px system-ui,sans-serif'});cover.append(label);}
   const start=event=>{event.preventDefault();event.stopPropagation();this.playCovered(embed);};
   cover.addEventListener('click',start);cover.addEventListener('keydown',event=>{if(event.key==='Enter' || event.key===' ')start(event);});
   root.append(cover);
   this.paintPoster(embed);
  }
  uncover(embed){embed.shadowRoot?.querySelector('[data-rt-parked-cover]')?.remove();embed.shadowRoot?.querySelector('[data-rt-pre-still]')?.remove();}
  // A tap on the image plays that player with sound, as its own play button would.
  playCovered(embed){
   if(this.ePreview?.embed!==embed)this.stopEmbed();
   else{const preview=this.ePreview;this.ePreview=null;this.win.clearTimeout(preview.timer);this.win.clearTimeout(preview.leave);preview.layer?.remove();delete embed.dataset.rtEmbedPreview;this.restoreHost(preview);}
   embed.dataset.rtEmbedUsed='1';
   this.watchFeedSound(embed);
   const frame=controlFrame(embed);
   if(frame?.dataset.rtParked){
    const src=frame.dataset.rtSrc;this.unpark(embed,frame,flagged(src,true));this.frameSound({frame,src},false);
   }
   else{
    this.uncover(embed);
    if(embed.matches(EMBED)){const lite=youTubeLite(embed);if(lite && !lite.classList.contains('lyt-activated'))lite.click();else embed.dispatchEvent(new this.win.Event('rt-embed-sound',{bubbles:true}));}
    else{
     const player=frame || controlFrame(embed,'audible');
     if(player)this.frameSound({frame:player,src:player.src},false);
    }
   }
   this.exclusive(embed);
  }
  // A feed player that stops being the one playing goes back to its image: unloaded if it has no controls, paused
  // underneath otherwise.
  rest(embed,keepCover=false){
   if(!this.feedEmbed(embed) || this.ePreview?.embed===embed)return;
   this.stopWatchingFeedSound(embed);
   this.preparePoster(embed);
   if(embed.matches(EMBED)){if(youTubeLite(embed)?.querySelector('iframe')){delete embed.dataset.rtEmbedUsed;this.cover(embed,true);}return;}
   const frame=controlFrame(embed);if(!frame)return;
   delete embed.dataset.rtEmbedUsed;
   this.clearEmbedPreviewFit(frame);
   const state=this.frameState(frame);
   if(state.kind==='flags' && !this.held(state))this.park(embed,frame,keepCover);
   else if(!frame.dataset.rtParked)this.cover(embed,true,keepCover);
  }
  watchFeedSound(embed){
   if(!this.io || !this.feedEmbed(embed))return;
   this.feedSoundEmbeds.add(embed);this.io.observe(embed);
  }
  stopWatchingFeedSound(embed){if(this.feedSoundEmbeds.delete(embed))this.io?.unobserve(embed);}
  // Queued as its post arrives; prepared at the end of the scan, nearest the screen first.
  observePoster(node){
   if(this.preparedPosters.has(node) || this.posterNodes.has(node))return;
   this.posterNodes.add(node);
   if(!this.posterFlush)this.posterFlush=Promise.resolve().then(()=>this.preparePosters());
  }
  preparePosters(){
   this.posterFlush=null;if(this.dead)return;
   const middle=(this.win.innerHeight || 800)/2,distance=node=>{const box=node.getBoundingClientRect();return Math.abs(box.top+box.height/2-middle);};
   const nodes=[...this.posterNodes].filter(node=>node.isConnected).map(node=>[node,distance(node)]).sort((a,b)=>a[1]-b[1]);
   this.posterNodes.clear();
   for(const [node] of nodes){this.preparedPosters.add(node);this.preparePoster(node);}
  }
  preparePoster(node){
   const card=node.closest('shreddit-post');
   const image=card?.querySelector('img[slot="thumbnail"],img[data-post-media-primary]');
   if(node.matches(ANY_EMBED)){this.paintPoster(node);return;}
   const url=[this.video(node)?.getAttribute('poster'),...thumbAttrs(node),image?.currentSrc || image?.src].find(posterOK);
   if(url)this.warmPoster(url);
  }
  warmPoster(url,embed){
   if(this.posterQuality.has(url))return;
   if(embed){
    if(!this.posterConsumers.has(url))this.posterConsumers.set(url,new Set());
    this.posterConsumers.get(url).add(embed);
   }
   if(this.warmedPosters.has(url))return;
   const image=new this.win.Image();
   image.decoding='async';image.referrerPolicy='no-referrer';
   // Update only the embeds that tried this image. Keep its settled result when discarding the preload object.
   const repaint=event=>{
    if(this.dead)return;
    this.posterQuality.set(url,event?.type!=='error' && image.naturalWidth>=160 && image.naturalHeight>=90);
    if(this.posterQuality.size>512)this.posterQuality.delete(this.posterQuality.keys().next().value);
    const consumers=this.posterConsumers.get(url);this.posterConsumers.delete(url);
    for(const node of consumers || [])if(node.isConnected)this.paintPoster(node);
    if(this.warmedPosters.size>48){
     for(const [known,loaded] of this.warmedPosters){
      if(loaded.complete)this.warmedPosters.delete(known);
      if(this.warmedPosters.size<=48)break;
     }
    }
   };
   image.addEventListener?.('load',repaint);image.addEventListener?.('error',repaint);
   this.warmedPosters.set(url,image);
   image.src=url;image.decode?.().catch(()=>{});
  }
  queuePoster(id,src){
   if(!/^t3_[a-z0-9]+$/i.test(id || ''))return;
   if(this.posters.has(id)){
    if(!this.providerPosters.delete(id))return;
    src=null; // The provider image failed; try Reddit's post data without repeating the metadata request.
   }
   if(this.posterWanted.has(id))return;
   this.posterWanted.set(id,src);
   if(!this.posterTimer && !this.loadingPosters)this.posterTimer=this.win.setTimeout(()=>this.loadPosters(),60);
  }
  // A still is used once it has loaded at a real size (at least 160×90); until it loads it is assumed fine.
  posterUsable(url,embed){
   if(this.posterQuality.has(url))return this.posterQuality.get(url);
   this.warmPoster(url,embed);
   const seen=this.warmedPosters.get(url);if(!seen?.complete)return true;
   return seen.naturalWidth>=160 && seen.naturalHeight>=90;
  }
  nativePoster(embed){
   const image=embed.closest('shreddit-post')?.querySelector('img[slot="thumbnail"],img[data-post-media-primary]');
   return [...embedPosters(embed),image?.currentSrc || image?.src].find(url=>posterOK(url) && this.posterUsable(url,embed));
  }
  stopDeferringPoster(embed){
   if(this.posterDeferred.delete(embed))this.posterIO?.unobserve(embed);
  }
  requestPoster(embed,id){
   const screen=this.win.innerHeight || 800,box=embed.getBoundingClientRect();
   if(this.posterIO && (box.top>screen*6 || (box.bottom ?? box.top+box.height)<-screen*1.5)){
    if(!this.posterDeferred.has(embed)){this.posterDeferred.add(embed);this.posterIO.observe(embed);}
    return;
   }
   this.stopDeferringPoster(embed);
   this.queuePoster(id,sourceAddress(embedAddress(embed)));
  }
  // Until Reddit's player for a card has drawn (Reddit inserts it only near the screen), the card shows its still, so
  // it never scrolls in as a black box. Players with Reddit's own placeholder (YouTube, Vimeo) already show one.
  preStill(embed,found){
   const root=embed.shadowRoot,id=embed.closest('shreddit-post')?.id;if(!root || !id)return;
   const frame=controlFrame(embed);
   const wanted=found && !youTubeLite(embed) && !vimeoLite(embed) && !root.querySelector('[data-rt-parked-cover]') &&
    (!frame || frame.dataset.rtWaiting==='1') && !embed.dataset.rtEmbedPreview && !embed.dataset.rtEmbedUsed && this.stillWanted(embed);
   let still=root.querySelector('[data-rt-pre-still]');
   if(!wanted){still?.remove();return;}
   if(!still){
    if(this.win.getComputedStyle(embed).position==='static')embed.style.position='relative';
    still=this.doc.createElement('img');still.dataset.rtPreStill='';still.alt='';still.referrerPolicy='no-referrer';still.decoding='async';
    Object.assign(still.style,{position:'absolute',inset:'0',width:'100%',height:'100%',objectFit:'contain',backgroundColor:'#000',zIndex:'3',pointerEvents:'none'});
    root.append(still);
   }
   if(still.getAttribute('src')!==found)still.src=found;
  }
  // A player Reddit inserts keeps the still over it until it has loaded and had a moment to draw.
  awaitDraw(embed,frame){
   if(frame.dataset.rtWaiting)return;
   frame.dataset.rtWaiting='1';
   frame.addEventListener('load',()=>this.win.setTimeout(()=>{frame.dataset.rtWaiting='0';this.paintPoster(embed);},400),{once:true});
  }
  paintPoster(embed){
   const id=embed.closest('shreddit-post')?.id;if(!id)return;
   const native=this.nativePoster(embed),cached=this.posters.get(id);
   const found=native || cached?.find(url=>this.posterUsable(url,embed));
   if(!found && this.stillWanted(embed))this.requestPoster(embed,id);
   else this.stopDeferringPoster(embed);
   this.preStill(embed,found);
   const cover=embed.shadowRoot?.querySelector('[data-rt-parked-cover]'),frame=controlFrame(embed);
   if(!cover){
    if(found && !frame && vimeoLite(embed) && !embed.dataset.rtEmbedPreview && !embed.dataset.rtEmbedUsed && this.stillWanted(embed)){
     this.cover(embed,false);
    }
    return;
   }
   const url=found && !('rtLoaded' in cover.dataset)?found:'';
   if(!url && !frame && vimeoLite(embed)){cover.remove();return;}
   // An <img> without a referrer: RedGIFs serves its stills only then (a CSS background sends Reddit as referrer).
   let still=cover.querySelector('[data-rt-parked-still]');
   if(url && !still){
    still=this.doc.createElement('img');still.dataset.rtParkedStill='';still.alt='';still.referrerPolicy='no-referrer';still.decoding='async';
    Object.assign(still.style,{position:'absolute',inset:'0',width:'100%',height:'100%',objectFit:'contain',pointerEvents:'none'});
    cover.prepend(still);
   }
   if(url){if(still.getAttribute('src')!==url)still.src=url;}else still?.remove();
   cover.dataset.rtStill=url || '';
   cover.toggleAttribute('data-rt-placeholder',!url && !('rtLoaded' in cover.dataset));
   const label=cover.querySelector('[data-rt-parked-label]');if(label)label.hidden=!cover.hasAttribute('data-rt-placeholder');
   // No usable image for an unloaded player with controls: load it idle, so its own first frame or poster shows.
   if(!url && frame?.dataset.rtParked && this.frameState(frame).kind!=='flags' && this.feedEmbed(embed)){
    this.unpark(embed,frame,idleSource(frame.dataset.rtSrc));return;
   }
   // No usable image for a loaded player: its own paused first frame or poster shows instead.
   if('rtLoaded' in cover.dataset && !('rtKeepCover' in cover.dataset)){cover.remove();return;}
  }
  // Missing images are requested in small batches after their cards approach the viewport.
  async loadPosters(){
   this.posterTimer=null;
   const sources=new Map([...this.posterWanted].slice(0,8)),ids=[...sources.keys()];if(!ids.length)return;
   for(const id of ids)this.posterWanted.delete(id);
   for(const id of ids)this.posters.set(id,[]);
   this.loadingPosters=true;
   // Each still is painted the moment it's found, not when the whole batch is done.
   const paint=(id,value,provider=false)=>{
    const urls=[].concat(value || []).filter(posterOK);
    if(this.dead || !urls.length || this.posters.get(id)?.length)return;
    this.posters.set(id,urls);
    if(provider)this.providerPosters.add(id);
    for(const embed of this.doc.querySelectorAll(ANY_EMBED))if(embed.closest('shreddit-post')?.id===id)this.paintPoster(embed);
   };
   let found={};try{found=await this.readPosters(ids,sources,paint);}catch{}
   this.loadingPosters=false;
   if(this.dead)return;
   if(this.posterWanted.size && !this.posterTimer)this.posterTimer=this.win.setTimeout(()=>this.loadPosters(),60);
   for(const [id,urls] of Object.entries(found || {}))paint(id,urls);
   for(const embed of this.doc.querySelectorAll(ANY_EMBED))if(ids.includes(embed.closest('shreddit-post')?.id))this.paintPoster(embed);
  }
  // Iframes Reddit adds inside an embed (when it comes near the screen) are caught before they load, unless chosen.
  watchEmbed(embed){
   if(!embed.shadowRoot || this.watchedEmbeds.has(embed))return;
   const root=embed.shadowRoot;
   const observer=new this.win.MutationObserver(()=>{
    if(this.dead || !this.configured || !this.feedEmbed(embed) || this.ePreview?.embed===embed || embed.dataset.rtEmbedUsed==='1')return;
    const frame=controlFrame(embed);if(frame && !frame.dataset.rtParked && root.querySelector('[data-rt-pre-still]'))this.awaitDraw(embed,frame);
    this.observePoster(embed);this.syncIdleEmbed(embed);this.paintPoster(embed);
   });
   observer.observe(embed.shadowRoot,{childList:true,subtree:true});this.watchedEmbeds.set(embed,observer);
  }
  unpark(embed,frame,src){
   if(!frame.dataset.rtParked)return false;
   const original=frame.dataset.rtSrc || '';delete frame.dataset.rtParked;delete frame.dataset.rtSrc;
   this.uncover(embed);allowAutoplay(frame);
   frame.setAttribute('src',src || original);return true;
  }
  syncIdleEmbed(embed){
   const frame=controlFrame(embed);
   if(!frame || frame.dataset.rtParked)return;
   this.framePolicy(frame,this.blockEmbedLinks(true));
   const state=this.frameState(frame),onlyOnPlay=this.startMode('embed')==='play';
   // A player that starts by itself is unloaded behind its image, unless direct controls hold it on its first frame.
   // One with controls stays loaded: idle, it shows its own first frame or poster (On Play pauses it if it starts).
   if(state.kind==='flags' && !this.held(state)){this.park(embed,frame);return;}
   // On Play: a player with controls waits behind Reddit's own still when there is one (nothing loads until tapped).
   if(onlyOnPlay && frame===rawFrame(embed) && !state.played && this.nativePoster(embed)){this.park(embed,frame);return;}
   if(onlyOnPlay && state.playing){this.command(frame,'pause');this.cover(embed,true,true);}
  }
  // Keep raw On Play and flag-driven players behind their covers until chosen.
  parkIdle(except=null){
   for(const embed of this.doc.querySelectorAll(ANY_EMBED)){
    if(embed===except || !this.feedEmbed(embed) || embed.dataset.rtEmbedUsed==='1' || this.ePreview?.embed===embed)continue;
    this.syncIdleEmbed(embed);
   }
  }
  // A feed card's embed whose player Reddit has not inserted yet still names it in its markup (embed-html, Embedly).
  stillWanted(embed){
   const card=embed?.closest?.('shreddit-post');
   return Boolean(card?.id && postId(this.win.location.pathname)!==card.id.replace(/^t3_/,'') && (this.feedEmbed(embed) || embedAddress(embed)));
  }
  feedEmbed(embed){
   const card=embed?.closest?.('shreddit-post');
   return Boolean(card?.id && embed.matches(ANY_EMBED) && (embed.matches(EMBED) || rawFrame(embed) || vimeoLite(embed)) && postId(this.win.location.pathname)!==card.id.replace(/^t3_/,''));
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
   if(!this.feedEmbed(embed) || this.startMode('embed')!=='hover' || event.buttons || current?.embed===embed)return true;
   this.stopHover();
   const preview=this.ePreview={embed,card:embed.closest('shreddit-post')};
   preview.timer=this.win.setTimeout(()=>this.startEmbed(preview),HOVER_MS);
   return true;
  }
  startEmbed(preview){
   const {embed}=preview;
   if(this.ePreview!==preview || this.doc.hidden || !embed.isConnected)return;
   this.preparePoster(embed);
   embed.dataset.rtEmbedPreview='on';
   if(vimeoLite(embed) || embed.shadowRoot?.querySelector('[data-rt-parked-cover][data-rt-loaded]'))this.uncover(embed);
   let host;
   if(embed.matches(EMBED)){
    if(embed.dispatchEvent(new this.win.Event('rt-embed-preview',{bubbles:true,cancelable:true}))){this.stopEmbed();return;}
    host=embed.shadowRoot?.querySelector('lite-youtube') || embed;
   }else{
    const frame=controlFrame(embed,'muted'),src=frame?.dataset.rtParked?frame.dataset.rtSrc:frame?.getAttribute('src');if(!frame || !src){this.stopEmbed();return;}
    const state=this.frameState(frame),kind=this.held(state)?'direct':state.kind;
    if(kind==='playerjs' && !state.readySeen)state.pendingStart={src,sound:false};
    this.framePolicy(frame,this.blockEmbedLinks(this.feedEmbed(embed)));
    preview.frame={frame,src,kind,position:embed.style.position};
    this.fitEmbedPreview(frame);
    // A player with a control protocol starts muted in place; others load with the provider's own flags.
    if(kind==='flags'){if(!this.unpark(embed,frame,flagged(src,false))){allowAutoplay(frame);frame.setAttribute('src',flagged(src,false));}}
    else{this.unpark(embed,frame,flagged(src,false));allowAutoplay(frame);this.command(frame,'mute');this.command(frame,'play');}
    // The layer sits in the embed's shadow root over its iframe.
    if(this.win.getComputedStyle(embed).position==='static')embed.style.position='relative';
    host=embed.shadowRoot;
   }
   preview.active=true;
   // While it previews, a layer over the embed takes the click (the iframe would otherwise play it in place).
   const layer=preview.layer=this.doc.createElement('div');
   layer.dataset.rtEmbedLayer='';
   layer.setAttribute('role',this.previewClick==='open'?'link':'button');
   layer.setAttribute('aria-label',{open:'Open post',muted:'Show controls, stay muted',sound:'Play with sound'}[this.previewClick]);
   layer.tabIndex=0;
   Object.assign(layer.style,{position:'absolute',inset:'0',zIndex:'5',cursor:'pointer',background:'transparent'});
   const sound=preview.sound=this.doc.createElement('button');
   sound.type='button';this.labelEmbedSound(preview);
   Object.assign(sound.style,{position:'absolute',right:'12px',bottom:'12px',width:'32px',height:'32px',border:'0',borderRadius:'999px',
    background:'rgba(0,0,0,.6)',color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',padding:'0'});
   sound.innerHTML='<svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M9.2 3.2 5.3 6.6H2.6a.9.9 0 0 0-.9.9v5a.9.9 0 0 0 .9.9h2.7l3.9 3.4a.9.9 0 0 0 1.5-.7V3.9a.9.9 0 0 0-1.5-.7Zm9 4.1-1.3-1.3-2.1 2.2-2.1-2.2-1.3 1.3 2.1 2.2-2.1 2.1 1.3 1.3 2.1-2.1 2.1 2.1 1.3-1.3-2.1-2.1 2.1-2.2Z"/></svg>';
   layer.append(sound);
   layer.addEventListener('click',event=>{
    event.preventDefault();event.stopPropagation();
    this.useEmbed(preview,event.composedPath().includes(sound));
   });
   layer.addEventListener('keydown',event=>{
    if(event.target===layer && (event.key==='Enter' || event.key===' ')){event.preventDefault();this.useEmbed(preview,false);}
   });
   host.append(layer);
  }
  fitEmbedPreview(frame){
   // Reddit supplies the media box, including its per-post aspect ratio. Size the iframe within that box instead
   // of using the provider's intrinsic width and height. Keep this CSS local so a held frame can adopt the post layout.
   const root=frame.getRootNode();
   if(!root.querySelector('style[data-rt-preview-sizing]')){
    const style=this.doc.createElement('style');style.dataset.rtPreviewSizing='';
    style.textContent=`iframe[data-rt-fit-preview]:not(:fullscreen) { display: block; box-sizing: border-box; width: 100% !important; height: 100% !important; max-width: 100%; max-height: 100%; border: 0; }
iframe[data-rt-fit-preview][data-rt-fit-adjusted]:not(:fullscreen) { position: absolute !important; inset: 0 auto auto 0 !important; width: var(--rt-fit-extent) !important; height: var(--rt-fit-extent) !important; max-width: none !important; max-height: none !important; clip-path: inset(0 var(--rt-fit-inset) var(--rt-fit-inset) 0); }`;
    root.append(style);
   }
   frame.dataset.rtFitPreview='';
   this.measureEmbedViewport(frame,this.frameState(frame));
  }
  measureEmbedViewport(frame,state){
   // Desktop device emulation can give an out-of-process frame a smaller surface than its CSS box.
   const nav=this.win.navigator,mobile=/\b(?:Android|iOS|iPhone|iPad|iPod)\b/i;
   if(!state.direct || !frame.hasAttribute('data-rt-fit-preview') || this.doc.fullscreenElement)return;
   if(!this.touch || !/^(?:Win32|MacIntel|Linux (?:x86_64|i686))$/.test(nav.platform) ||
     !(mobile.test(nav.userAgentData?.platform) || mobile.test(nav.userAgent))){
    state.viewport=null;this.clearEmbedViewportAdjustment(frame);return;
   }
   const width=frame.clientWidth,height=frame.clientHeight;if(width<100 || height<100)return;
   const request=++this.viewportRequest;
   state.viewport={request,width,height};this.postDirect(frame,'viewport',{request});
  }
  adjustEmbedViewport(frame,state,{request,width,height}){
   const viewport=state.viewport;
   if(!viewport || request!==viewport.request || !frame.hasAttribute('data-rt-fit-preview'))return;
   state.viewport=null;
   if(!Number.isFinite(width) || !Number.isFinite(height) || width<50 || height<50)return;
   const horizontal=viewport.width/width,vertical=viewport.height/height;
   // Correct only a uniform discrepancy. A provider's own letterboxing and crops remain its responsibility.
   const factor=Math.round((horizontal+vertical)*50)/100;
   if(Math.abs(horizontal-vertical)>.025 || factor<1.05 || factor>2){this.clearEmbedViewportAdjustment(frame);return;}
   frame.style.setProperty('--rt-fit-extent',`${factor*100}%`);
   frame.style.setProperty('--rt-fit-inset',`${100-100/factor}%`);
   frame.dataset.rtFitAdjusted='';
  }
  clearEmbedViewportAdjustment(frame){
   if(!frame.hasAttribute('data-rt-fit-adjusted'))return;
   delete frame.dataset.rtFitAdjusted;
   frame.style.removeProperty('--rt-fit-extent');frame.style.removeProperty('--rt-fit-inset');
  }
  clearEmbedPreviewFit(frame){
   if(!frame)return;
   delete frame.dataset.rtFitPreview;
   this.clearEmbedViewportAdjustment(frame);
   const state=this.frames.get(frame);if(state)state.viewport=null;
  }
  labelEmbedSound(preview){
   if(!preview.sound)return;
   const label=preview.frame?.kind==='flags' && !this.held(this.frameState(preview.frame.frame))?'Use player’s sound control':'Turn sound on';
   preview.sound.setAttribute('aria-label',label);preview.sound.title=label;
  }
  useEmbed(preview,sound){
   if(this.ePreview!==preview)return;
   if(sound || this.previewClick!=='open' || !this.openPost(preview.embed)){
    this.promoteEmbed(preview,sound || this.previewClick==='sound',!sound);
   }
  }
  // The preview becomes the user's: the layer goes, it keeps playing, with sound when chosen.
  promoteEmbed(preview,sound,reload){
   if(this.ePreview!==preview)return;
   this.ePreview=null;
   this.win.clearTimeout(preview.timer);this.win.clearTimeout(preview.leave);
   preview.layer?.remove();delete preview.embed.dataset.rtEmbedPreview;
   preview.embed.dataset.rtEmbedUsed='1';
   this.watchFeedSound(preview.embed);
   if(preview.frame){this.restoreHost(preview);if(sound)this.frameSound(preview.frame,reload);return;}
   if(sound)preview.embed.dispatchEvent(new this.win.Event('rt-embed-sound',{bubbles:true}));
   else preview.embed.dispatchEvent(new this.win.Event('rt-embed-use-muted',{bubbles:true}));
  }
  frameSound({frame,src},reload=true){
   const state=this.frameState(frame);
   if(state.kind==='flags' && !this.held(state)){
    this.command(frame,'unmute');
    this.command(frame,'play');
    if(reload){allowAutoplay(frame);frame.setAttribute('src',flagged(src,true));}
    return;
   }
   if(reload && state.kind==='playerjs' && !state.readySeen)state.pendingStart={src,sound:true};
   this.command(frame,'unmute');this.command(frame,'play');
  }
  restoreHost(preview){if(preview.frame)preview.embed.style.position=preview.frame.position || '';}
  stopEmbed(){
   const preview=this.ePreview;if(!preview)return;
   this.ePreview=null;
   this.win.clearTimeout(preview.timer);this.win.clearTimeout(preview.leave);
   preview.layer?.remove();delete preview.embed.dataset.rtEmbedPreview;
   if(preview.frame){
    this.restoreHost(preview);
    const {frame,src,kind}=preview.frame;
    this.clearEmbedPreviewFit(frame);
    if(preview.active && frame.isConnected){
     if(kind!=='flags' || this.held(this.frameState(frame))){this.command(frame,'pause');this.command(frame,'unmute');this.rest(preview.embed);}
     else if(this.feedEmbed(preview.embed)){frame.setAttribute('src',src);this.park(preview.embed,frame);}
     else frame.setAttribute('src',src);
    }
    return;
   }
   if(preview.active){preview.embed.dispatchEvent(new this.win.Event('rt-embed-stop',{bubbles:true}));this.rest(preview.embed);}
  }
  // Opening a post whose YouTube embed plays (or previews) continues it in the post's embed at the same second.
  rememberEmbed(embed,id){
   const preview=this.ePreview?.embed===embed && this.ePreview.active ? this.ePreview : null;
   // Other providers: no position to read, but the same iframe (previewing, or one you clicked into) moves into the post.
   if(!embed.matches(EMBED)){
    if(!preview && embed.dataset.rtEmbedUsed!=='1')return false;
    if(preview){this.ePreview=null;this.win.clearTimeout(preview.timer);this.win.clearTimeout(preview.leave);preview.layer?.remove();delete embed.dataset.rtEmbedPreview;this.restoreHost(preview);
     if(this.unmutePreview)this.frameSound(preview.frame,false);}
    this.clearEmbedHandoff();
    const frame=controlFrame(embed);
    this.clearEmbedPreviewFit(frame);
    const held=this.continueOnOpen && !embed.dispatchEvent(new this.win.Event('rt-hold-feed-embed',{bubbles:true,cancelable:true}));
    const sound=this.unmutePreview?preview?.frame:null;
    if(!held && !sound)return false;
    this.stopWatchingFeedSound(embed);
    this.embedPending={id,from:this.win.location.pathname,held,generic:true,sound,frame};
    const pending=this.embedPending,watch=()=>{if(this.embedPending!==pending || this.dead)return;this.embedHandoff();this.win.requestAnimationFrame(watch);};
    this.win.requestAnimationFrame(watch);
    this.embedExpiry=this.win.setTimeout(()=>this.clearEmbedHandoff(),CONTINUE_MS);
    return true;
   }
   embed.dispatchEvent(new this.win.Event('rt-embed-snapshot',{bubbles:true}));
   const time=Number(embed.dataset.rtEmbedTime);
   if(!preview && (embed.dataset.rtEmbedState!=='playing' || !Number.isFinite(time) || time<0))return false;
   const muted=preview?!this.unmutePreview:embed.dataset.rtEmbedMuted==='true';
   const restart=Boolean(preview && this.restartPreview);
   this.clearEmbedHandoff();
   try{this.win.sessionStorage.setItem(EMBED_KEY,JSON.stringify({id,owner:owner(this.doc),at:Date.now(),time:restart || !Number.isFinite(time) || time<0?0:time,muted}));}catch{}
   if(preview){this.ePreview=null;this.win.clearTimeout(preview.timer);this.win.clearTimeout(preview.leave);preview.layer?.remove();delete embed.dataset.rtEmbedPreview;}
   // The same YouTube player moves into the post (page bridge); without it, the post's embed starts at this second.
   const held=!embed.dispatchEvent(new this.win.Event('rt-hold-feed-embed',{bubbles:true,cancelable:true}));
   this.embedPending={id,from:this.win.location.pathname,held,restart,muted};
   if(held && preview && !muted)embed.dispatchEvent(new this.win.Event('rt-embed-sound',{bubbles:true}));
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
    if(generic.held){
     if(!('rtIncoming' in target.dataset)){target.dataset.rtIncoming=target.style.visibility;target.style.visibility='hidden';}
     if(target.dispatchEvent(new this.win.Event('rt-place-held-embed',{bubbles:true,cancelable:true})))return;
     target.style.visibility=target.dataset.rtIncoming;delete target.dataset.rtIncoming;
     if(generic.frame?.isConnected)this.framePolicy(generic.frame,this.blockEmbedLinks(false));
     if(generic.sound?.frame.isConnected)this.frameSound(generic.sound,false);
    }else{
     const frame=controlFrame(target,'audible');if(!frame)return;
     this.framePolicy(frame,this.blockEmbedLinks(false));
     this.frameSound({frame,src:frame.src},false);
    }
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
   if(!/^[a-z0-9]{1,10}$/i.test(id || ''))return false;
   const samePost=href=>{
    try{const url=new URL(href,this.win.location.href);return url.origin===this.win.location.origin && postId(url.pathname)===id;}
    catch{return false;}
   };
   const links=[...card.querySelectorAll('a[href]')].filter(link=>!link.closest(PLAYERS) && (!link.target || link.target==='_self') &&
    !link.hasAttribute('download') && samePost(link.href));
   let link=links.find(link=>link.slot==='full-post-link') || links.find(link=>link.slot==='title') || links[0];
   const temporary=!link;
   if(temporary){
    const href=['permalink','content-href'].map(name=>card.getAttribute(name)).find(value=>value && samePost(value));
    link=this.doc.createElement('a');link.hidden=true;link.href=href || '/comments/'+id+'/';card.append(link);
   }
   this.opening=link;
   try{link.click();}finally{this.opening=null;if(temporary)link.remove();}
   return true;
  }
  promotePreview(player,action){
   const preview=this.previews.get(player);
   if(!preview || (!preview.played && !(action==='control' && preview.active)))return;
   const video=preview.video;
   this.previews.delete(player);
   this.started.add(video);
   if(this.hovered===player)this.stopHover();
   if(action==='control')return;
   if(action!=='muted' && this.restartPreview)video.currentTime=0;
   if(action==='here' || action==='open' && this.unmutePreview)this.fadeIn(video,video.volume>0?video.volume:0.5,player);
   else video.muted=true;
   if(video.paused){
    this.continued.add(video);
    this.play(player,video)?.catch?.(()=>this.continued.delete(video));
   }
  }
  remember(event){
   if(!this.configured || (!event.isTrusted && !globalThis.__rtVideoControlTest && event.target!==this.opening) ||
      event.defaultPrevented || event.button!==0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)return;
   const path=event.composedPath();
   if(path.some(node=>node.matches?.(PLAYERS)))return;
   const link=path.find(node=>node.matches?.('a[href]'));
   const card=path.find(node=>node.matches?.('shreddit-post'));
   if(!link || !card || link.hasAttribute('download') || link.target && link.target!=='_self')return;
   const url=new URL(link.href,this.win.location.href),id=postId(url.pathname);
   if(url.origin!==this.win.location.origin || !id || card.id!=='t3_'+id || postId(this.win.location.pathname)===id)return;
   const embed=[...card.querySelectorAll(ANY_EMBED)].find(node=>this.feedEmbed(node));
   if(embed && (this.continueOnOpen || !embed.matches(EMBED)) && this.rememberEmbed(embed,id))return;
   if(!this.continueOnOpen)return;
   const source=[...card.querySelectorAll(PLAYERS)].find(player=>player.getAttribute('player-type')===FEED_PLAYER);
   const sourceVideo=source && this.video(source);
   if(sourceVideo && this.previews.get(source)?.video===sourceVideo)this.promotePreview(source,'open');
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
   if(closedThread(player)){video.pause();return;}
   if(this.loops.get(player)===video)return;
   if(this.continued.has(video)){this.exclusive(video);return;}
   const preview=this.previews.get(player);
   if(preview?.active && preview.video===video){preview.played=true;this.exclusive(video);return;}
   const userStarted=this.userStarted(player);
   if(userStarted){this.started.add(video);this.previews.delete(player);this.away.delete(player);}
   else this.started.delete(video);
   if(!userStarted){this.block(player,video);return;}
   delete player.dataset.rtAutoplayBlocked;
   this.exclusive(video);
  }
  // One video plays at a time, as on YouTube: whatever starts (a video, a preview, a YouTube player) pauses the rest.
  // A video held for its post keeps playing; YouTube players are paused by the page bridge.
  exclusive(source){
   const origin=source.matches?.('video') && commentOf(source)?source:source.getRootNode?.()?.host;
   if(origin?.matches?.(MEDIA_NODES) && mediaKind(origin)==='gif')return;
   for(const embed of this.embedAway)if(embed!==source)this.embedAway.delete(embed);
   for(const player of this.players){
    const video=this.video(player);
    if(!video || video===source || video.paused || mediaKind(player)==='gif' || this.pending?.sourceVideo===video)continue;
    if(this.previews.get(player)?.active && this.hovered===player){this.stopHover();continue;}
    video.pause();
   }
   if(this.ePreview && this.ePreview.embed!==source)this.stopEmbed();
   for(const [frame,state] of this.frames)if(state.kind!=='flags' && frame.isConnected && frame.getRootNode()?.host!==source && frame.getRootNode()?.host?.getRootNode?.()?.host!==source)this.command(frame,'pause');
   // Feed players that have played go back to their image.
   for(const embed of this.doc.querySelectorAll(ANY_EMBED))if(embed!==source && (embed.dataset.rtEmbedUsed==='1' || youTubeLite(embed)?.querySelector('iframe') || this.frames.get(controlFrame(embed))?.played))this.rest(embed);
   source.dispatchEvent(new this.win.Event('rt-media-exclusive',{bubbles:true,composed:true}));
  }
  block(player,video){
   if(this.previews.get(player)?.active)return;
   video.pause();player.dataset.rtAutoplayBlocked='true';
  }
  onTime(event){if(this.pending?.sourceVideo===event.target)this.updatePlayback(this.pending);}
  observeAfterMove(player){
   this.manageViewport(player,this.isDetailMedia(player));
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
    if(this.feedSoundEmbeds.has(player)){
     if(entry.intersectionRatio===0){
      if(player.matches(EMBED))player.dispatchEvent(new this.win.Event('rt-embed-stop',{bubbles:true}));
      else{const frame=controlFrame(player);if(frame)this.command(frame,'pause');}
      this.rest(player,true);
     }
     continue;
    }
    if(this.detailEmbeds.has(player)){this.onEmbedVisibility(player,entry.intersectionRatio);continue;}
    if((ready!==undefined && !(entry.time>=ready)) || (player===pending?.source && (pending.held || pending.reached)))continue;
    // A post's own video pauses once it is fully out of view and resumes where it was when half of it is back;
    // a feed video pauses when less than half of it is on screen and stays paused.
    const detail=player.getAttribute('player-type')===DETAIL_PLAYER || Boolean(commentOf(player)),ratio=entry.intersectionRatio;
    if(ratio<0.5 && this.loops.has(player))this.stopLoop(player);
    const away=this.away.get(player);
    if(away)away.visible=ratio>=0.5;
    if(ratio>=0.5){if(detail)this.resumeAway(player);continue;}
    if(detail && ratio>0)continue;
    if(player===this.hovered)this.stopHover();
    if(!this.pauseAway)continue;
    const video=this.video(player);
    if(video && !video.paused && !video.ended){
     video.pause();player.dataset.rtPausedAway='true';
     if(detail)this.away.set(player,{video,time:video.currentTime,visible:false});
    }
   }
  }
  resumeAway(player){
   const away=this.away.get(player),video=this.video(player);
   if(!away || !this.pauseAway || this.doc.hidden || closedThread(player)){this.away.delete(player);return;}
   if(!away.visible)return;
   if(video!==away.video || !video.paused || video.ended){this.away.delete(player);return;}
   // Reddit may have unloaded the source while it was far away: reload it, then resume at the same time.
   if(video.readyState<1){
    if(!away.loading){
     away.loading=true;
     if(player===video)video.load();
     else player.dispatchEvent(new this.win.Event(commentOf(player)?'rt-prepare-feed-preview':'rt-prepare-detail-video',{bubbles:true}));
    }
    return;
   }
   this.away.delete(player);delete player.dataset.rtPausedAway;
   if(Math.abs(video.currentTime-away.time)>0.25)video.currentTime=away.time;
   this.continued.add(video);
   this.play(player,video)?.catch?.(()=>this.continued.delete(video));
  }
  onEmbedVisibility(embed,ratio){
   if(!this.pauseAway || !this.isDetailEmbed(embed) || this.doc.hidden)return;
   const youtube=embed.matches(EMBED),frame=youtube?null:controlFrame(embed);
   if(ratio>=0.5){
    if(!this.embedAway.delete(embed))return;
    if(youtube)embed.dispatchEvent(new this.win.Event('rt-embed-return',{bubbles:true}));
    else if(frame)this.command(frame,'play');
    return;
   }
   if(ratio>0 || this.embedAway.has(embed))return;
   if(youtube){
    embed.dispatchEvent(new this.win.Event('rt-embed-snapshot',{bubbles:true}));
    const state=embed.dataset.rtEmbedState;
    if(state==='playing')this.embedAway.add(embed);
    if(state!=='paused')embed.dispatchEvent(new this.win.Event('rt-embed-offscreen',{bubbles:true}));
   }else if(frame && this.frames.get(frame)?.playing){
    if(this.command(frame,'pause'))this.embedAway.add(embed);
   }
  }
  settle(){
   this.win.clearTimeout(this.settleTimer);this.win.clearTimeout(this.dwellTimer);
   const modes=kinds.map(kind=>this.startMode(kind));
   if(modes.includes('autoplay'))this.settleTimer=this.win.setTimeout(()=>this.pickInView(false),AUTOPLAY_MS);
   if(modes.includes('stop'))this.dwellTimer=this.win.setTimeout(()=>this.pickInView(),DWELL_MS);
  }
  // After scrolling stops, the feed video at least 60 % visible and nearest the middle of the screen previews, one at a
  // time; a playing preview keeps going while it stays at least half on screen.
  pickInView(settled=true){
   if(this.dead || this.doc.hidden)return;
   const height=this.win.innerHeight,middle=height/2;let best=null,distance=Infinity;
   const candidates=[...this.players].filter(player=>this.previewable(player))
    .concat([...this.doc.querySelectorAll(ANY_EMBED)].filter(embed=>this.feedEmbed(embed)));
   for(const node of candidates){
    const kind=mediaKind(node),mode=this.startMode(kind);
    if(!node.isConnected || !viewMode(mode) || mode==='stop' && !settled)continue;
    if(kind==='embed' && node.dataset.rtEmbedUsed==='1')continue;
    const box=node.getBoundingClientRect();if(!(box.height>0))continue;
    const shown=(Math.min(box.top+box.height,height)-Math.max(box.top,0))/box.height,gap=Math.abs(box.top+box.height/2-middle);
    if(kind==='gif'){
     if(shown>=IN_VIEW)this.startLoop(node);else if(shown<0.5)this.stopLoop(node);
     continue;
    }
    if(shown>=IN_VIEW && gap<distance){best=node;distance=gap;}
   }
   if(best && (best===this.hovered || best===this.ePreview?.embed))return;
   if(this.hovered && !this.viewing || this.ePreview && !this.ePreview.view)return;
   if(!settled && this.startMode(mediaKind(this.hovered || this.ePreview?.embed))==='stop' && (this.viewing || this.ePreview?.view))return;
   this.stopHover();
   for(const node of this.managedViewport)this.manageViewport(node,false);
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
   this.dead=true;this.mo?.disconnect();this.io?.disconnect();this.posterIO?.disconnect();this.win.clearTimeout(this.posterTimer);
   this.stopHover();
   for(const player of this.loops.keys())this.stopLoop(player);
   for(const type of ['pointerdown','keydown','click'])this.doc.removeEventListener(type,this.onGesture,true);
   for(const type of ['pointerover','pointerout'])this.doc.removeEventListener(type,this.onHover,true);
   this.doc.removeEventListener('visibilitychange',this.onTabVisibility);
   this.doc.removeEventListener('toggle',this.onCommentToggle,true);
   this.win.removeEventListener('scroll',this.onScroll,{capture:true});this.win.clearTimeout(this.settleTimer);this.win.clearTimeout(this.dwellTimer);
   this.win.removeEventListener('resize',this.onEmbedResize);this.win.clearTimeout(this.embedResizeTimer);
   for(const frame of this.frames.keys())this.clearEmbedPreviewFit(frame);
   this.doc.removeEventListener('click',this.onRemember,true);this.doc.removeEventListener('reddit:route',this.onRoute);this.doc.removeEventListener('rt-embed-playing',this.onEmbedPlaying);this.win.removeEventListener('blur',this.onFrameFocus);this.win.removeEventListener('message',this.onFrameMessage);
   for(const type of ['click','auxclick'])this.doc.removeEventListener(type,this.onEmbedLink,true);
   this.win.removeEventListener('popstate',this.onBack);this.win.removeEventListener('pagehide',this.onPageExit);
   this.clearHandoff();
  }
 }
 globalThis.RTVideoControl=Object.freeze({Videos,readAutoplayDisabled});
 if(globalThis.chrome?.runtime?.id && !globalThis.__rtVideoControlTest){
  const read=async()=>{const r=await chrome.runtime.sendMessage({scope:'rt-posts',action:'get-settings'});return r?.ok?r.settings:{};};
  const direct=()=>chrome.runtime.sendMessage({scope:'rt-embed-direct'}).then(value=>value===true,()=>false);
  const videos=new Videos({readSettings:read,readDirect:direct});
  chrome.runtime.onMessage.addListener((message,sender)=>{if(message?.scope==='rt-posts' && message.action==='settings-changed' && sender?.id===chrome.runtime.id)videos.configure(message.settings);});
  // Visiting Reddit's own settings re-reads the preference next time.
  if(/^\/settings\//.test(location.pathname))try{sessionStorage.removeItem(PREF_KEY);}catch{}
 }
})();
