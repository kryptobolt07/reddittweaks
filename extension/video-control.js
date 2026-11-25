/* Videos (docs/video-control-spec.md): enforce Reddit's own "Autoplay media" off, which its phone layout ignores, pause
   a playing video as soon as it is mostly scrolled away, muted YouTube-style previews (hover on desktop, optionally the
   video in view on phones), and keep playing the same video when its post opens. Reddit's player (shreddit-player)
   keeps its <video> in an open shadow root and starts it from script, so its non-bubbling play event is caught there
   in the capture phase. */
(() => {
 'use strict';
 if(globalThis.RTVideoControl || window.top!==window)return;
 const PLAYERS='shreddit-player, shreddit-player-2',GESTURE_MS=1500,HOVER_MS=300,LEAVE_MS=250,FADE_MS=200,IN_VIEW=0.6,DWELL_MS=600,AUTOPLAY_MS=150,PROBE_MS=2500,HOLD_2X_MOUSE_MS=300,HOLD_2X_TOUCH_MS=350,HOLD_PREVIEW_MS=300,PREF_KEY='rt-video-autoplay-v1',PREF_TTL=3600000,CONTINUE_KEY='rt-video-continue-v1',CONTINUE_MS=12000,VOLUME_KEY='rt-video-volume-v1',DIRECT_PREPARE_MS=1500,DIRECT_TRIAL_MS=250,HELLO_MS=3500,PLAY_SETTLE_MS=1500,EMBED_TRIAL_MS=1500,PREVIEW_STALL_MS=4000;
 const COMMENT='shreddit-comment',MEDIA_NODES=PLAYERS+', '+COMMENT+' video';
 const commentOf=node=>node?.closest?.(COMMENT);
 const closedThread=node=>Boolean(commentOf(node) && node.closest('shreddit-comment[collapsed],details:not([open]),[hidden], [inert]'));
 const PLAY_BUTTON='.poster-play-button,.play-pause-button';
 const SOUND_CONTROL='.mute-button,.volume-slider';
 const PLAYER_CONTROLS='button,a[href],input,select,textarea,[role="button"],[role="slider"],[role="menu"],[role="menuitem"],.fullscreen-button,.captions-button,.settings-button,[slot="controls"],vds-time-slider,media-time-range';
 const FEED_PLAYER='in_feed_player',DETAIL_PLAYER='post_detail_screen',SEARCH_PLAYER='search_results';
 // Reddit's Media search tab plays its tiles with search_results players: feed media for start policies and previews.
 const feedPlayer=player=>{const type=player?.getAttribute?.('player-type');return type===FEED_PLAYER || type===SEARCH_PLAYER && Boolean(player.closest?.(SEARCH_TILE));};
 // A post opened from a search result tile (Reddit's Media tab, Visual search) brings no playing moment to keep.
 const SEARCH_TILE='[data-id="search-media-post-unit"]',SEARCH_RESULT=SEARCH_TILE+',[data-rt-ui="visual-search"] .rt-vs-tile';
 // YouTube embeds Reddit renders as lite-youtube with the YouTube player API (controlled by the page bridge).
 const EMBED='shreddit-embed[providername="YouTube"]',EMBED_KEY='rt-embed-continue-v1',ANY_EMBED='shreddit-embed';
 const BLURRED='shreddit-blurred-container[blurred]',NSFW_GATE='shreddit-blurred-container[reason="nsfw"]',POST_MEDIA='[slot="post-media-container"]';
 function nativeRevealButton(gate){
  const button=gate.shadowRoot?.querySelector('button');
  return button && !button.disabled && !button.form && button.getAttribute('aria-disabled')!=='true'?button:null;
 }
 // Other providers (Streamable, Twitch, Dailymotion, …): Reddit renders their oEmbed iframe directly in the embed.
 const rawFrame=embed=>{const frame=embed?.shadowRoot?.querySelector?.('iframe');return frame && !frame.closest('lite-youtube,lite-vimeo')?frame:null;};
 const embedOfFrame=frame=>{
  const host=frame.getRootNode()?.host;
  return host?.matches?.(ANY_EMBED)?host:host?.getRootNode()?.host;
 };
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
 let stillsPausedUntil=0,preferPartialStills=false;
 const postStills=d=>{
  const image=d?.preview?.images?.[0],sized=(image?.resolutions || []).find(r=>r.width>=480) || image?.source;
  return [...new Set([sized?.url,d?.secure_media?.oembed?.thumbnail_url,d?.media?.oembed?.thumbnail_url,image?.source?.url].filter(posterOK))];
 };
 const partialPostStills=html=>{
  if(typeof html!=='string' || !html)return [];
  const out=[],add=url=>{
   const clean=typeof url==='string'?url.replace(/&amp;/gi,'&').trim():'';
   if(posterOK(clean) && !/(?:\/avatars\/|snoovatar|icon-|\.svg(?:$|\?))/i.test(clean) && !out.includes(clean))out.push(clean);
  };
  const doc=new DOMParser().parseFromString(html,'text/html');
  for(const embed of doc.querySelectorAll('shreddit-embed')){
   for(const attr of thumbAttrs(embed))add(attr);
   const t=templateAddress(embed);
   if(t){try{const u=new URL(t);if(u.hostname==='cdn.embedly.com')add(u.searchParams.get('image'));}catch{}}
  }
  for(const node of doc.querySelectorAll('[poster],[thumbnail-url],[thumbnail],[preview-image],[preview-url]'))for(const attr of thumbAttrs(node))add(attr);
  for(const img of doc.querySelectorAll('[slot="post-media-container"] img[src],[slot="thumbnail"] img[src],shreddit-embed img[src],shreddit-player-2 img[src],img[src*="redd.it/"]'))add(img.getAttribute('src'));
  return out;
 };
 // Two reads at a time, in the order given (nearest the screen first); each still is reported as soon as it's read.
 async function readPostStills(ids,onFound,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))){
  const out={},queue=[...ids];
  const worker=async()=>{
   while(queue.length && Date.now()>=stillsPausedUntil){
    const id=queue.shift(),cleanId=id.replace(/^t3_/,'');
    try{
     // Firefox content scripts fetch as the extension; content.fetch reads as the page, like Chrome's.
     const read=globalThis.content?.fetch?globalThis.content.fetch.bind(globalThis.content):fetch;
     let tryPartial=preferPartialStills;
     if(!tryPartial){
      const response=await read(new URL('/comments/'+cleanId+'.json?limit=1&depth=1&raw_json=1',location.origin).href,{credentials:'include',headers:{Accept:'application/json'}});
      if(response.status===429){stillsPausedUntil=Date.now()+300000;break;}
      if(response.status===403 || response.status===410)tryPartial=true;
      else if(response.ok){const urls=postStills((await response.json())?.[0]?.data?.children?.[0]?.data);if(urls.length){out[id]=urls;onFound?.(id,urls);}}
     }
     if(tryPartial && Date.now()>=stillsPausedUntil){
      const part=await read(new URL('/svc/shreddit/partial-feed-post/t3_'+cleanId,location.origin).href,{credentials:'include',headers:{Accept:'text/vnd.reddit.partial+html, text/html;q=0.9'}});
      if(part.status===403 || part.status===429){stillsPausedUntil=Date.now()+300000;break;}
      if(part.ok){
       preferPartialStills=true;
       const urls=partialPostStills(await part.text());
       if(urls.length){out[id]=urls;onFound?.(id,urls);}
      }
     }
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
 // The post a tab first loaded (Post opened directly): the document's own navigation entry, still on screen, and not
 // reached by a feed-to-post continuation saved for it. In-app routes never count.
 function landingPost(win){
  let path=win.location.pathname;
  try{const entry=win.performance?.getEntriesByType?.('navigation')?.[0];if(entry?.name)path=new URL(entry.name).pathname;}catch{}
  const id=postId(path);
  if(!id || id!==postId(win.location.pathname))return '';
  try{
   for(const key of [CONTINUE_KEY,EMBED_KEY]){
    const saved=JSON.parse(win.sessionStorage.getItem(key) || 'null'),age=Date.now()-(saved?.at ?? NaN);
    if(saved?.id===id && age>=0 && age<CONTINUE_MS)return '';
   }
  }catch{}
  return id;
 }
 const dropPreStill=root=>{root?.querySelector('[data-rt-pre-still]')?.remove();root?.querySelector('[data-rt-pre-mark]')?.remove();};
 const kinds=['video','gif','embed'];
 const mediaKind=node=>node?.matches?.(ANY_EMBED)?'embed':node?.matches?.('[gif],[post-type="gif"],[data-media-type="gif"]') || node?.closest?.('shreddit-post[post-type="gif"]')?'gif':'video';
 const viewMode=(mode,touch)=>mode==='autoplay' || (touch && mode==='preview');
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
 function parseSavedVolume(saved){
  return saved && typeof saved==='object' && Number.isFinite(saved.volume) && saved.volume>=0 && saved.volume<=1
   ? {volume:saved.volume,muted:saved.muted===true} : null;
 }
 function readLocalVolume(win){
  try{return parseSavedVolume(JSON.parse(win?.localStorage?.getItem(VOLUME_KEY) || 'null'));}catch{return null;}
 }
 function writeLocalVolume(win,value){
  try{win?.localStorage?.setItem(VOLUME_KEY,JSON.stringify(value));}catch{}
 }
 function readStoredVolume(win){
  const api=win?.browser || win?.chrome || globalThis.browser || globalThis.chrome;
  if(api?.storage?.local?.get){
   try{
    return Promise.resolve(api.storage.local.get(VOLUME_KEY)).then(
     res=>parseSavedVolume(res?.[VOLUME_KEY]) || readLocalVolume(win),
     ()=>readLocalVolume(win)
    );
   }catch{}
  }
  return Promise.resolve(readLocalVolume(win));
 }
 function writeStoredVolume(win,value){
  const api=win?.browser || win?.chrome || globalThis.browser || globalThis.chrome;
  if(api?.storage?.local?.set){
   try{
    Promise.resolve(api.storage.local.set({[VOLUME_KEY]:value})).catch(()=>writeLocalVolume(win,value));
    return;
   }catch{}
  }
  writeLocalVolume(win,value);
 }
 class Videos{
  constructor({doc=document,readSettings,readPreference=readAutoplayDisabled,readDirect=null,readVolume=null,saveVolume=null,observe=true,landing}={}){
   this.doc=doc;this.win=doc.defaultView;this.settings={};this.autoplayDisabled=null;this.players=new Set();this.attached=new WeakSet();this.previews=new WeakMap();this.started=new WeakSet();this.continued=new WeakSet();this.gesture={at:-Infinity,path:[]};this.dead=false;this.active=false;this.observe=observe;
   this.visibilityReady=new WeakMap();this.fading=new WeakMap();this.away=new WeakMap();this.loops=new Map();
   this.detailEmbeds=new Set();this.embedAway=new Set();this.feedEmbeds=new Set();this.feedSoundEmbeds=new Set();this.managedViewport=new Set();
   this.revealedMediaGates=new WeakSet();
   this.miniDismissed=new WeakSet();this.mini=null;
   this.landing=landing ?? landingPost(this.win);this.direct=null;this.directEmbed=null;
   this.endedAt=new WeakMap();this.hold2x=null;this.suppressClickUntil=-Infinity;
   this.savedVolume=null;this.volumeSaveTimer=null;
   this.readVolume=readVolume || (()=>readStoredVolume(this.win));
   this.saveVolume=saveVolume || (val=>writeStoredVolume(this.win,val));
   this.choice=videoSettings({});
   this.frames=new RTPostModel.WeakElementMap();this.posters=new Map();this.providerPosters=new Set();this.posterWanted=new Map();this.watchedEmbeds=new RTPostModel.WeakElementMap();
   this.posterNodes=new Set();this.preparedPosters=new WeakSet();this.warmedPosters=new Map();
   this.posterConsumers=new Map();this.posterQuality=new Map();this.posterDeferred=new Set();
   this.readPosters=readPosters;
   this.onGesture=event=>{
    if(!this.active || this.dead)return;
    if(!event.isTrusted && !globalThis.__rtVideoControlTest)return;
    const path=event.composedPath();
    this.gesture={at:performance.now(),path};
    if(this.direct)this.directGesture(event,path);
    if(this.directEmbed)this.directEmbedGesture(event,path);
    if(event.type==='pointerdown'){
     if(this.holdFor2x)this.startHold2x(event,path);
     if(event.pointerType==='touch' || event.pointerType==='pen')this.startHoldPreview(event,path);
     return;
    }
    if(event.type==='click' && event.button===0){
     if(performance.now()<this.suppressClickUntil){event.preventDefault();event.stopImmediatePropagation();return;}
     const gate=path.find(node=>node.matches?.(NSFW_GATE+'[blurred]'));
     const card=gate?.closest('shreddit-post[id]');
     if(card && gate.closest(POST_MEDIA) && nativeRevealButton(gate) && path.includes(gate.shadowRoot) &&
        card.id!=='t3_'+postId(this.win.location.pathname)){
      this.revealedMediaGates.add(gate);
     }
    }
    const lite=path.find(node=>node.matches?.('lite-youtube,lite-vimeo')),embed=path.find(node=>node.matches?.(ANY_EMBED));
    if(event.type==='click' && event.button===0 && lite && this.feedEmbed(embed) && this.ePreview?.embed!==embed){
     embed.dataset.rtEmbedUsed='1';
     if(this.startMode('embed')!=='default')this.watchFeedSound(embed);
    }
    const player=path.find(node=>node.matches?.(MEDIA_NODES));
    if(!player || closedThread(player))return;
    this.attach(player);
    const video=this.video(player);
    if(event.type==='click' && event.button===0){
     this.handleVideoClick(player,video,event,path);
    }else if(video && !video.paused && this.previews.get(player)?.video!==video){
     this.started.add(video);
    }
   };
   this.onPointerMove=event=>{
    if(event.pointerType==='mouse')this.pointer={x:event.clientX,y:event.clientY};
    const held=this.holdPreview;
    if(held && !held.engaged && Math.hypot(event.clientX-held.x,event.clientY-held.y)>10)this.endHoldPreview(false);
    if(!this.hold2x || this.hold2x.engaged)return;
    if(Math.hypot(event.clientX-this.hold2x.x,event.clientY-this.hold2x.y)>10)this.endHold2x(false);
   };
   this.onPointerEnd=event=>{this.endHold2x(event.type==='pointerup');this.endHoldPreview(event.type==='pointerup');};
   this.onContextMenu=event=>{if(this.hold2x?.engaged || this.holdPreview)event.preventDefault();};
   this.onHover=event=>this.hover(event);
   this.onTabVisibility=()=>{
    if(this.doc.hidden){this.stopHover();this.endHold2x(false);for(const player of [...this.loops.keys()])this.stopLoop(player);return;}
    // Granting Direct embed controls happens in the popup, away from this tab.
    this.refreshDirect();
    if(this.inView)this.settle();else this.recheckPointer();
   };
   this.onCommentToggle=event=>{if(commentOf(event.target))this.syncCommentVisibility();};
   // Phones, like YouTube's feed: a preview starts once scrolling has stopped for a moment.
   this.onScroll=()=>{
    if(this.hold2x && !this.hold2x.engaged)this.endHold2x(false);
    if(this.inView)this.settle();
    else if(this.pointer){this.win.clearTimeout(this.pointerTimer);this.pointerTimer=this.win.setTimeout(()=>this.recheckPointer(),150);}
    // At most once a frame, and not at all once a scan found no embed to start on this post.
    if(this.landing && this.directOpen!=='default' && !this.directEmbedNone && !this.directScrollFrame && (!this.directEmbed || this.directEmbed.phase==='start' && !this.directEmbed.ended))
     this.directScrollFrame=this.win.requestAnimationFrame(()=>{this.directScrollFrame=0;if(!this.dead)this.applyDirectEmbed(true);});
   };
   this.onRemember=event=>this.remember(event);
   this.onVisualContinue=event=>this.continueFromVisual(event.detail);
   this.onEmbedLink=event=>{
    const path=event.composedPath(),embed=path.find(node=>node.matches?.(ANY_EMBED)),link=path.find(node=>node.matches?.('a[href]'));
    if(!embed || !link || !this.blockEmbedLinks(!this.isDetailEmbed(embed)))return;
    if(/^https?:/.test(link.href) && new URL(link.href).origin!==this.win.location.origin){event.preventDefault();event.stopImmediatePropagation();}
   };
   this.onRoute=()=>{this.hideSoundPrompt();this.endHoldPreview(false);this.stopHover();this.endHold2x(false);this.exitMini(false);this.handoff();this.adoptResultOpen();this.win.setTimeout(()=>this.directPlayer(),0);this.queueLeftBehind();};
   this.onBack=()=>{this.stopHover();this.endHold2x(false);this.exitMini(false);this.clearHandoff();this.clearEmbedHandoff();this.directPlayer();};
   this.onMiniDismissed=event=>{
    const node=event.target;
    if(node)this.miniDismissed.add(node);
    if(this.mini?.slot)this.io?.unobserve(this.mini.slot);
    this.mini=null;
   };
   this.onPageExit=()=>{
    const pending=this.activeHandoff();
    if(pending?.sourceVideo){
     this.updatePlayback(pending);
     this.saveHandoff();
    }
    this.win.clearTimeout(this.expiry);
    this.pending?.layoutObserver?.disconnect();
    this.releaseHeldVideo();
    this.releaseHeldEmbed();
    this.exitMini(false);
    this.endHold2x(false);
    this.stopHover();
    this.pending=null;
   };
   // The page bridge reports a YouTube player that started (by its own controls, a preview or a continuation).
   this.onEmbedPlaying=event=>{
    const embed=event.target;if(!embed?.matches?.(EMBED))return;
    if(this.embedPending?.held){
     if(this.embedPending.source===embed)return;
     if(this.isDetailEmbed(embed)){embed.dispatchEvent(new this.win.Event('rt-embed-stop',{bubbles:true}));return;}
    }
    if(this.directEmbedBlocks(embed)){embed.dispatchEvent(new this.win.Event('rt-embed-stop',{bubbles:true}));return;}
    if(this.startMode('embed')==='play' && this.feedEmbed(embed) && embed.dataset.rtEmbedUsed!=='1'){
     embed.dispatchEvent(new this.win.Event('rt-embed-stop',{bubbles:true}));this.cover(embed,true);return;
    }
    if(this.volumeMemory && this.savedVolume){
     embed.dataset.rtTargetVolume=String(this.savedVolume.volume);
     embed.dispatchEvent(new this.win.Event('rt-embed-volume',{bubbles:true}));
    }
    this.exclusive(embed);
   };
   // Clicking into an embed's player moves focus into its iframe (the page sees a blur): that embed is in use, so other
   // videos pause (when singleVideo is on), and opening its post carries it over (when videoOpenPost is on).
   this.onFrameFocus=()=>this.win.setTimeout(()=>{
    if(!this.active || this.dead)return;
    const active=this.doc.activeElement;if(!active?.matches?.(ANY_EMBED))return;
    if(this.directEmbed?.embed===active)this.endDirectEmbed();
    active.dataset.rtEmbedUsed='1';this.exclusive(active);
   },0);
   this.onFrameMessage=event=>{
    if(event.data?.rtMedia==='hello' && event.source && this.active){
     let known=false;
     for(const [frame] of this.frames)if(frame.contentWindow===event.source){known=true;break;}
     if(!known){const frame=this.findFrame(event.source);if(frame && event.origin===this.embedOrigin(frame))this.frameState(frame);}
    }
    for(const [frame,state] of this.frames){
     if(!frame.isConnected){this.frames.delete(frame);continue;}
     if(!event.source || frame.contentWindow!==event.source)continue;
     if(event.data?.rtMedia && event.origin===this.embedOrigin(frame)){
      const method=event.data.rtMedia;
      if(method==='hello'){
       const first=!state.direct,embed=embedOfFrame(frame);
       state.direct=true;state.pendingStart=null;state.queue.clear();
       if(typeof event.data.playing==='boolean')state.playing=event.data.playing;
       if(state.playing)state.played=true;
       if(this.ePreview?.frame?.frame===frame){
        // A preview that began behind the click layer continues layerless: the frame reports taps itself.
        const preview=this.ePreview;
        if(preview.active && !preview.direct){preview.layer?.remove();preview.layer=null;preview.sound=null;preview.direct=true;this.postDirect(frame,'preview',{on:true});}
        this.labelEmbedSound(preview);
       }
       else if(this.ePreview?.ytDirect && this.ePreview.embed===embed){this.ePreview.ytFrame=frame;this.postDirect(frame,'preview',{on:true});}
       this.win.clearTimeout(state.helloTimer);state.helloTimer=null;
       this.framePolicy(frame,state.block,true);
       this.applyDirectEmbed();
       this.syncDirectEnhancements(frame);
       if(state.directSound){this.postDirect(frame,state.directSound);state.directSound='';}
       if(state.directPlayback){this.postDirect(frame,state.directPlayback);state.directPlayback='';}
       else if(this.embedPending?.frame!==frame){
        if(this.embedPending?.held && this.isDetailEmbed(embed))this.postDirect(frame,'pause');
        else if(this.feedEmbed(embed) && this.startMode('embed')!=='default')this.postDirect(frame,this.idleChoice(frame));
        else if(first)this.postDirect(frame,'release');
       }
       if(this.isDetailEmbed(embed) && this.scrollAway!=='default')this.manageViewport(embed,true);
       if(event.data.rendered===true)this.embedRendered(frame,state);
       this.embedHandoff();
      }else if(state.direct && method==='rendered')this.embedRendered(frame,state);
      else if(state.direct && method==='progress'){
       const {time,muted}=event.data;
       if(Number.isFinite(time) && time>=0 && time<=86400 && typeof muted==='boolean')state.progress={time,muted};
      }
      else if(state.direct && ['play','pause'].includes(method))this.framePlayback(frame,state,method,event.data.user===true);
      else if(state.direct && (method==='tap' || method==='take')){
       const preview=this.ePreview;
       if(preview?.active && (preview.frame?.frame===frame || preview.ytFrame===frame)){
        if(method==='tap')this.useEmbed(preview,false);
        else this.promoteEmbed(preview,false,false);
       }
      }
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
   this.readPreference=readPreference;this.preference=null;
   // Whether direct embed controls are on: then a player that starts by itself is held on its first frame, not unloaded.
   this.directReady=false;
   this.readDirect=readDirect;
   this.directOrigins=new Set();
   const direct=Promise.resolve(readDirect?.()).then(value=>this.setDirect(value),()=>{});
   const vol=Promise.resolve(this.readVolume?.()).then(value=>{if(value && typeof value==='object')this.savedVolume=value;},()=>{});
   this.ready=Promise.all([readSettings?.(),direct,vol]).then(([s])=>{this.configure(s || {});},()=>this.configure({}));
  }
  isPassive(c=this.choice){
   return c.videoStart==='default' && c.embedStart==='default' && c.gifStart==='default' &&
    c.mediaClickAction==='default' && c.embedBlockLinks==='off' &&
    !c.singleVideo && !c.volumeMemory && c.videoScrollAway==='default' &&
    c.videoOpenPost==='default' && !c.holdFor2x && c.loopPolicy==='default' &&
    c.streamQuality==='auto' && (c.videoDirectOpen || 'default')==='default';
  }
  activate(){
   if(this.active || this.dead)return;
   this.active=true;
   const doc=this.doc,win=this.win;
   for(const type of ['pointerdown','keydown','click'])doc.addEventListener(type,this.onGesture,true);
   doc.addEventListener('pointermove',this.onPointerMove,true);
   for(const type of ['pointerup','pointercancel'])win.addEventListener(type,this.onPointerEnd,true);
   doc.addEventListener('contextmenu',this.onContextMenu,true);
   for(const type of ['pointerover','pointerout'])doc.addEventListener(type,this.onHover,true);
   doc.addEventListener('visibilitychange',this.onTabVisibility);
   doc.addEventListener('toggle',this.onCommentToggle,true);
   win.addEventListener('scroll',this.onScroll,{passive:true,capture:true});
   doc.addEventListener('click',this.onRemember,true);
   for(const type of ['click','auxclick'])doc.addEventListener(type,this.onEmbedLink,true);
   doc.addEventListener('reddit:route',this.onRoute);
   doc.addEventListener('rt-visual-continue',this.onVisualContinue);
   doc.addEventListener('rt-embed-playing',this.onEmbedPlaying);
   doc.addEventListener('rt-mini-dismissed',this.onMiniDismissed);
   win.addEventListener('blur',this.onFrameFocus);
   win.addEventListener('message',this.onFrameMessage);
   win.addEventListener('popstate',this.onBack);
   win.addEventListener('pagehide',this.onPageExit);
   this.io=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>this.onVisibility(entries),{threshold:[0,0.5,IN_VIEW,1]}):null;
   const screen=win.innerHeight || 800;
   this.posterIO=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{
    if(this.dead || !this.active)return;
    for(const entry of entries)if(entry.isIntersecting && this.posterDeferred.has(entry.target))this.paintPoster(entry.target);
   },{rootMargin:`${Math.round(screen*1.5)}px 0px ${screen*5}px 0px`}):null;
   this.mo=this.observe?new MutationObserver(records=>{if(records.some(record=>record.attributeName==='collapsed' && record.target.matches(COMMENT)))this.syncCommentVisibility();this.handoff();this.schedule();}):null;
   this.mo?.observe(doc.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['collapsed','blurred']});
  }
  deactivate(){
   if(!this.active)return;
   this.active=false;
   // Fully passive again: every video gets its own loop setting back.
   for(const player of this.players){const video=this.video(player);if(video && this.loopOriginal?.has(video)){video.loop=this.loopOriginal.get(video);this.loopOriginal.delete(video);}}
   const doc=this.doc,win=this.win;
   this.mo?.disconnect();this.mo=null;
   this.io?.disconnect();this.io=null;
   this.posterIO?.disconnect();this.posterIO=null;
   win.clearTimeout(this.posterTimer);this.posterTimer=null;
   win.clearTimeout(this.settleTimer);win.clearTimeout(this.dwellTimer);
   win.clearTimeout(this.pointerTimer);win.clearTimeout(this.previewWatch);this.retryPreview=null;
   win.clearTimeout(this.volumeSaveTimer);this.volumeSaveTimer=null;
   this.stopHover();
   this.endHold2x(false);
   this.exitMini(false);
   for(const player of [...this.loops.keys()])this.stopLoop(player);
   for(const [embed,obs] of this.watchedEmbeds){obs.disconnect();this.watchedEmbeds.delete(embed);}
   this.releaseParkedEmbeds();
   for(const node of [...this.managedViewport])this.manageViewport(node,false);
   for(const type of ['pointerdown','keydown','click'])doc.removeEventListener(type,this.onGesture,true);
   doc.removeEventListener('pointermove',this.onPointerMove,true);
   for(const type of ['pointerup','pointercancel'])win.removeEventListener(type,this.onPointerEnd,true);
   doc.removeEventListener('contextmenu',this.onContextMenu,true);
   for(const type of ['pointerover','pointerout'])doc.removeEventListener(type,this.onHover,true);
   doc.removeEventListener('visibilitychange',this.onTabVisibility);
   doc.removeEventListener('toggle',this.onCommentToggle,true);
   win.removeEventListener('scroll',this.onScroll,{capture:true});
   doc.removeEventListener('click',this.onRemember,true);
   for(const type of ['click','auxclick'])doc.removeEventListener(type,this.onEmbedLink,true);
   doc.removeEventListener('reddit:route',this.onRoute);
   doc.removeEventListener('rt-visual-continue',this.onVisualContinue);
   doc.removeEventListener('rt-embed-playing',this.onEmbedPlaying);
   doc.removeEventListener('rt-mini-dismissed',this.onMiniDismissed);
   win.removeEventListener('blur',this.onFrameFocus);
   win.removeEventListener('message',this.onFrameMessage);
   win.removeEventListener('popstate',this.onBack);
   win.removeEventListener('pagehide',this.onPageExit);
   this.players.clear();this.detailEmbeds.clear();this.feedEmbeds.clear();this.feedSoundEmbeds.clear();
   this.embedAway.clear();this.away=new WeakMap();this.posterDeferred.clear();this.posterNodes.clear();
   this.clearHandoff();this.clearEmbedHandoff();
   this.endDirect();this.endDirectEmbed();
  }
  releaseParkedEmbeds(){
   for(const embed of this.doc.querySelectorAll(ANY_EMBED)){
    this.uncover(embed);
    const frame=controlFrame(embed);
    if(frame?.dataset.rtParked){
     const original=frame.dataset.rtSrc || '';delete frame.dataset.rtParked;delete frame.dataset.rtSrc;
     if(original)frame.setAttribute('src',original);
    }else if(frame && this.frames.get(frame)?.direct){
     this.postDirect(frame,'preview',{on:false});
     this.postDirect(frame,'release');
    }
   }
  }
  syncDirectEnhancements(frame){
   if(!this.frames.get(frame)?.direct)return;
   this.postDirect(frame,'loop',{policy:this.loopPolicy});
   this.postDirect(frame,'hold2x',{enabled:this.holdFor2x});
   if(this.volumeMemory && this.savedVolume)this.postDirect(frame,'volume',{volume:this.savedVolume.volume});
  }
  configure(settings){
   const before=this.choice;
   this.settings=settings || {};this.choice=videoSettings(this.settings);
   if(this.configured && this.directOpen!==(before.videoDirectOpen || 'default')){this.endDirect();this.endDirectEmbed();this.landing='';}
   const root=this.doc.documentElement;
   root?.toggleAttribute?.('data-rt-embed-override',this.startMode('embed')!=='default');
   if(this.streamQuality==='auto')root?.removeAttribute?.('data-rt-stream-quality');
   else root?.setAttribute?.('data-rt-stream-quality',this.streamQuality);
   if(this.isPassive()){
    this.deactivate();
    this.configured=true;
    return;
   }
   if(!this.active)this.activate();
   const active=this.hovered || this.ePreview?.embed,kind=mediaKind(active);
   if(active && this.startMode(kind,before)!==this.startMode(kind))this.stopHover();
   if(this.startMode('gif',before)!==this.startMode('gif'))for(const player of [...this.loops.keys()])this.stopLoop(player);
   if(this.startMode('embed')==='default' && this.startMode('embed',before)!=='default'){
    for(const [embed,obs] of this.watchedEmbeds){obs.disconnect();this.watchedEmbeds.delete(embed);}
    this.releaseParkedEmbeds();
   }
   if(!this.holdFor2x)this.endHold2x(false);
   if(this.scrollAway!=='mini')this.exitMini(false);
   if(this.scrollAway==='default'){
    this.embedAway.clear();this.away=new WeakMap();
    for(const node of [...this.managedViewport])this.manageViewport(node,false);
   }
   if(!this.continueOnOpen){this.clearHandoff();this.clearEmbedHandoff();}
   else if(!this.configured)this.restoreHandoff();
   if(this.pending?.saved?.id && this.pending.saved.id===this.landing)this.landing='';
   for(const [frame,state] of this.frames)if(frame.isConnected && state.direct)this.syncDirectEnhancements(frame);
   this.configured=true;this.scan();
   // Visibility reports that arrived before the settings did still choose the in-view preview.
   if(this.inView)this.settle();
   else if(this.viewing || this.ePreview?.view)this.stopHover();
   this.recheckPointer();
   for(const player of this.players){
    const video=this.video(player);if(!video)continue;
    if(mediaKind(player)!=='gif'){
     this.applyLoopPolicy(player,video);
     if(this.volumeMemory && this.savedVolume && !this.previews.get(player)?.active && !this._lastAttached?.has(player))this.applySavedVolume(player,video,false);
    }
    if(this.blocksStart(player) && !video.paused && !this.started.has(video) && !this.continued.has(video) && !this.loops.has(player) &&
       !this.directManaged(video)){
     this.block(player,video);
    }
   }
  }
  get touch(){return Boolean(this.win.matchMedia?.('(hover: none) and (pointer: coarse)')?.matches);}
  startMode(kind,settings=this.choice){return settings[kind+'Start'];}
  // Whether a start Reddit makes by itself is stopped. Autoplay and Preview choose among feed and comment media only,
  // so a post's own video or GIF keeps Reddit's start there (blocking it left it paused for good, measured
  // 2026-11-23); Only when I press Play stops it everywhere.
  blocksStart(player,kind=mediaKind(player)){
   const mode=this.startMode(kind);
   return mode!=='default' && (mode==='play' || player.getAttribute?.('player-type')!==DETAIL_PLAYER);
  }
  get clickAction(){return this.choice.mediaClickAction;}
  get clickAudio(){return this.choice.clickAudio;}
  get singleVideo(){return this.choice.singleVideo===true;}
  get volumeMemory(){return this.choice.volumeMemory===true;}
  get scrollAway(){return this.choice.videoScrollAway;}
  get pauseAway(){return this.choice.videoScrollAway==='pause';}
  get unmutePreview(){return this.choice.clickAudio==='unmute';}
  get continueOnOpen(){return this.choice.videoOpenPost==='position' || this.choice.videoOpenPost==='start';}
  get restartPreview(){return this.choice.videoOpenPost==='start';}
  get cardClickAudio(){return this.choice.cardClickAudio || 'keep';}
  get directOpen(){return this.choice.videoDirectOpen || 'default';}
  // Whether media carried into its post should have sound. A click on the video itself (openPost sets this.opening)
  // follows clickAudio; a click on the card around it (title, body, whitespace) follows cardClickAudio.
  wantOpenSound(wasMuted,{isPreview=false}={}){
   if(this.opening || !this.cardOpen)return wasMuted?this.unmutePreview:true;
   const policy=this.cardClickAudio;
   if(policy==='unmute')return true;
   if(policy==='muted')return false;
   return isPreview?this.unmutePreview:!wasMuted;
  }
  get holdFor2x(){return this.choice.holdFor2x===true;}
  get loopPolicy(){return this.choice.loopPolicy;}
  get streamQuality(){return this.choice.streamQuality;}
  blockEmbedLinks(feed){return this.choice.embedBlockLinks==='both' || this.choice.embedBlockLinks===(feed?'feed':'posts');}
  get inView(){return kinds.some(kind=>viewMode(this.startMode(kind),this.touch));}
  playback(video){return {time:video.currentTime,muted:video.muted,volume:this.fading.get(video) ?? video.volume,rate:video.playbackRate};}
  targetVolume(video){
   if(this.volumeMemory && this.savedVolume && this.savedVolume.volume>0)return this.savedVolume.volume;
   return video.volume>0?video.volume:0.5;
  }
  hasAudio(player,video){
   if(player?.hasAudio===false || player?.getAttribute?.('has-audio')==='false')return false;
   if(video && video.mozHasAudio===false)return false;
   const muteBtn=player?.shadowRoot?.querySelector?.('.mute-button');
   if(muteBtn && (muteBtn.disabled || muteBtn.getAttribute('aria-disabled')==='true'))return false;
   return true;
  }
  applySavedVolume(player,video,allowUnmute=false){
   if(!this.volumeMemory || !this.savedVolume || !video || mediaKind(player)==='gif')return;
   const {volume,muted}=this.savedVolume;
   if(Number.isFinite(volume) && volume>=0 && volume<=1){
    video.volume=volume;
    if(player?.matches?.(PLAYERS)){
     player.dataset.rtTargetVolume=String(volume);
     player.dispatchEvent(new this.win.Event('rt-video-volume',{bubbles:true}));
    }
   }
   if(allowUnmute && !muted && volume>0 && this.hasAudio(player,video)){
    video.muted=false;
   }else if(allowUnmute && muted){
    video.muted=true;
   }
  }
  recordVolume(video){
   if(!this.volumeMemory || !video || !Number.isFinite(video.volume))return;
   this.savedVolume={volume:Math.max(0,Math.min(1,video.volume)),muted:Boolean(video.muted)};
   this.win.clearTimeout(this.volumeSaveTimer);
   this.volumeSaveTimer=this.win.setTimeout(()=>this.saveVolume(this.savedVolume),150);
  }
  desiredLoop(video){
   if(this.loopPolicy==='always')return true;
   if(this.loopPolicy==='never')return false;
   if(this.loopPolicy==='short')return Number.isFinite(video.duration) && video.duration>0 && video.duration<30;
   return null;
  }
  // The video's own loop value is kept the first time a policy changes it, and put back for Default.
  applyLoopPolicy(player,video){
   if(!video || mediaKind(player)==='gif')return;
   this.loopOriginal ||= new WeakMap();
   if(this.loopPolicy==='default' || !this.active){if(this.loopOriginal.has(video)){video.loop=this.loopOriginal.get(video);this.loopOriginal.delete(video);}return;}
   const want=this.desiredLoop(video);
   if(want===null)return;
   if(!this.loopOriginal.has(video))this.loopOriginal.set(video,video.loop);
   video.loop=want;
  }
  startHold2x(event,path){
   if(event.button>0)return;
   const player=path.find(node=>node.matches?.(MEDIA_NODES));
   if(!player || closedThread(player) || mediaKind(player)==='gif')return;
   const video=this.video(player);
   if(!video || video.paused || video.ended)return;
   if(path.some(node=>node.matches?.(PLAYER_CONTROLS+','+SOUND_CONTROL+','+PLAY_BUTTON)))return;
   if(path[0]!==video)return;
   const isTouch=event.pointerType==='touch' || event.pointerType==='pen';
   const rect=video.getBoundingClientRect();
   if(isTouch && rect.width>0 && (event.clientX-rect.left)<rect.width*0.6)return;
   this.endHold2x(false);
   const state={player,video,x:event.clientX,y:event.clientY,rate:video.playbackRate || 1,engaged:false,pill:null,timer:null};
   state.timer=this.win.setTimeout(()=>{
    if(this.hold2x!==state || this.dead || !video.isConnected || video.paused || video.ended)return;
    state.engaged=true;
    state.rate=video.playbackRate || 1;
    video.playbackRate=2;
    const host=player.shadowRoot || player.parentElement || this.doc.body;
    if(host && host!==this.doc.body && host!==player.shadowRoot && this.win.getComputedStyle(host).position==='static'){
     state.host=host;state.hostPos=host.style.position;host.style.position='relative';
    }
    if(player.shadowRoot && this.win.getComputedStyle(player).position==='static'){
     state.host=player;state.hostPos=player.style.position;player.style.position='relative';
    }
    const pill=this.doc.createElement('div');
    pill.dataset.rtSpeedPill='';
    pill.textContent='2× ▶▶';
    Object.assign(pill.style,{position:'absolute',top:'12px',left:'50%',transform:'translateX(-50%)',zIndex:'20',
     padding:'4px 10px',borderRadius:'999px',background:'rgba(0,0,0,.78)',color:'#fff',
     font:'600 12px/16px system-ui,sans-serif',pointerEvents:'none',letterSpacing:'0.02em'});
    host?.append(pill);
    state.pill=pill;
   },isTouch?HOLD_2X_TOUCH_MS:HOLD_2X_MOUSE_MS);
   this.hold2x=state;
  }
  // Search Media tab on touch: pressing and holding a clip plays it, muted, while the finger stays down; lifting stops
  // it again unless it was already previewing. A finger that moves first is a scroll and cancels the hold.
  startHoldPreview(event,path){
   this.endHoldPreview(false);
   if(event.button>0 || event.isPrimary===false || !this.touch || this.pending?.held || this.embedPending?.held)return;
   const player=path.find(node=>node.matches?.(MEDIA_NODES));
   if(!player || player.getAttribute('player-type')!==SEARCH_PLAYER || !player.closest?.(SEARCH_TILE) || closedThread(player))return;
   // Only the player's own sliders and sound button are excluded: the tile's link and the big Play button wrap the clip.
   if(path.slice(0,path.indexOf(player)).some(node=>node.matches?.(SOUND_CONTROL+',input,[role="slider"],vds-time-slider,media-time-range')))return;
   const video=this.video(player);
   const state={player,x:event.clientX,y:event.clientY,engaged:false,keep:Boolean(video && !video.paused),timer:0};
   state.timer=this.win.setTimeout(()=>{
    if(this.holdPreview!==state || this.dead || !player.isConnected)return;
    state.engaged=true;
    if(state.keep)return;
    this.stopHover();this.hovered=player;this.viewing=false;
    if(!this.startPreview(player))state.keep=true;
   },HOLD_PREVIEW_MS);
   this.holdPreview=state;
  }
  endHoldPreview(released=false){
   const state=this.holdPreview;if(!state)return;
   this.holdPreview=null;this.win.clearTimeout(state.timer);
   if(!state.engaged)return;
   if(released)this.suppressClickUntil=performance.now()+500;
   if(!state.keep && this.hovered===state.player)this.stopHover();
  }
  endHold2x(swallowClick=false){
   if(!this.hold2x)return;
   const h=this.hold2x;this.hold2x=null;
   this.win.clearTimeout(h.timer);
   if(h.engaged){
    try{h.video.playbackRate=h.rate;}catch{}
    h.pill?.remove();
    if(h.host)h.host.style.position=h.hostPos || '';
    if(swallowClick)this.suppressClickUntil=performance.now()+120;
   }
  }
  enterFullscreen(player,video){
   const btn=player?.shadowRoot?.querySelector?.('.fullscreen-button, [aria-label*="fullscreen" i]');
   if(btn && !btn.disabled && btn.getAttribute('aria-disabled')!=='true'){btn.click();return;}
   if(typeof player?.requestFullscreen==='function'){Promise.resolve(player.requestFullscreen()).catch(()=>{});return;}
   if(typeof video?.requestFullscreen==='function'){Promise.resolve(video.requestFullscreen()).catch(()=>{});return;}
   if(typeof video?.webkitEnterFullscreen==='function'){try{video.webkitEnterFullscreen();}catch{}}
  }
  enterEmbedFullscreen(embed){
   const frame=youTubeLite(embed)?.querySelector('iframe') || controlFrame(embed);
   if(typeof frame?.requestFullscreen==='function'){Promise.resolve(frame.requestFullscreen()).catch(()=>{});return;}
   if(typeof embed?.requestFullscreen==='function'){Promise.resolve(embed.requestFullscreen()).catch(()=>{});}
  }
  exitMini(dismissed=false){
   if(!this.mini)return;
   if(this.mini.slot)this.io?.unobserve(this.mini.slot);
   this.mini=null;
   this.doc.dispatchEvent(new this.win.Event('rt-mini-exit'));
  }
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
  schedule(){if(this.queued || this.dead || !this.active)return;this.queued=true;setTimeout(()=>{this.queued=false;if(!this.dead && this.active)this.scan();},200);}
  scan(){
   if(!this.active || this.dead)return;
   for(const node of this.posterNodes)if(!node.isConnected)this.posterNodes.delete(node);
   for(const node of this.posterDeferred)if(!node.isConnected)this.stopDeferringPoster(node);
   for(const embed of this.feedSoundEmbeds)if(!embed.isConnected || !this.feedEmbed(embed))this.stopWatchingFeedSound(embed);
   for(const embed of this.feedEmbeds)if(!embed.isConnected || this.isDetailEmbed(embed)){
    this.feedEmbeds.delete(embed);this.io?.unobserve(embed);
   }
   for(const player of this.players)if(!player.isConnected){
    if(this.hovered===player)this.stopHover();
    this.stopLoop(player);
    this.manageViewport(player,false);
    this.players.delete(player);this.previews.delete(player);this.io?.unobserve(player);
   }
   const embedOverride=this.startMode('embed')!=='default';
   const manageDetail=this.scrollAway!=='default';
   const attachedNow=new Set();
   for(const player of this.doc.querySelectorAll(MEDIA_NODES)){
    const had=this.players.has(player);
    this.attach(player);
    if(!had && this.players.has(player))attachedNow.add(player);
    if(this.startMode(mediaKind(player))!=='default' && feedPlayer(player))this.observePoster(player);
    if(player.matches(PLAYERS))this.manageViewport(player,manageDetail && this.isDetailMedia(player));
   }
   this._lastAttached=attachedNow;
   if(attachedNow.size || this.retryPreview && !this.retryPreview.isConnected)this.retryPreview=null;
   if(attachedNow.size)this.recheckPointer();
   for(const embed of this.detailEmbeds)if(!embed.isConnected || !this.isDetailEmbed(embed)){
    this.detailEmbeds.delete(embed);this.embedAway.delete(embed);this.io?.unobserve(embed);this.manageViewport(embed,false);
   }
   for(const embed of this.doc.querySelectorAll(ANY_EMBED)){
    if(embedOverride){
     this.watchEmbed(embed);
     if(this.configured && this.stillWanted(embed))this.observePoster(embed);
    }
    const frame=controlFrame(embed),state=frame && this.frameState(frame);
    if(state)this.framePolicy(frame,this.blockEmbedLinks(!this.isDetailEmbed(embed)));
    if(!this.isDetailEmbed(embed)){
     if(embedOverride && !this.feedEmbeds.has(embed) && (this.feedEmbed(embed) || this.stillWanted(embed))){
      this.feedEmbeds.add(embed);this.io?.observe(embed);
     }
     continue;
    }
    if(manageDetail)this.trackDetailEmbed(embed,state);
   }
   if(this.configured && embedOverride)this.parkIdle();
   this.handoff();
   this.embedHandoff();
   this.applyDirect();
   this.applyDirectEmbed();
  }
  trackDetailEmbed(embed,state){
   if(this.scrollAway==='default')return;
   if(!this.detailEmbeds.has(embed)){this.detailEmbeds.add(embed);this.io?.observe(embed);}
   if(state===undefined){const frame=controlFrame(embed);state=frame && this.frameState(frame);}
   this.manageViewport(embed,embed.matches(EMBED) || Boolean(state && (state.direct || state.kind!=='flags')));
  }
  attach(player){
   const direct=player.matches('video'),root=direct?player:player.shadowRoot;
   if(this.players.has(player) || !root)return;
   this.players.add(player);this.io?.observe(player);
   if(this.inView && !this.viewing)this.settle();
   const video=this.video(player);
   if(video && mediaKind(player)!=='gif'){
    this.applyLoopPolicy(player,video);
    if(this.volumeMemory && this.savedVolume && !this.previews.get(player)?.active)this.applySavedVolume(player,video,false);
   }
   if(this.attached.has(player))return;
   this.attached.add(player);
   if(direct)player.controls=true;
   root.addEventListener('play',event=>{if(this.active && !this.dead)this.onPlay(player,event);},true);
   root.addEventListener('timeupdate',event=>{if(this.active && !this.dead)this.onTime(event);},true);
   root.addEventListener('pause',event=>{
    if(!this.active || this.dead)return;
    if(event.target.paused)this.continued.delete(event.target);
    if(this.direct?.phase==='trial' && this.direct.video===event.target && !this.userStarted(player))this.directFallback(this.direct);
   },true);
   // Reddit re-applies its saved volume when a video starts; a preview stays muted until it plays for real.
   root.addEventListener('volumechange',event=>{
    if(!this.active || this.dead)return;
    const preview=this.previews.get(player);
    if(preview?.active && preview.video===event.target && !event.target.muted){event.target.muted=true;return;}
    if(this.directKeepsMuted(player,event.target))return;
    if(this.volumeMemory && mediaKind(player)!=='gif' && !this.fading.has(event.target) &&
       (this.started.has(event.target) || this.userStarted(player))){
     this.recordVolume(event.target);
    }
   },true);
   root.addEventListener('durationchange',event=>{
    if(!this.active || this.dead)return;
    if(mediaKind(player)!=='gif')this.applyLoopPolicy(player,event.target);
   },true);
   root.addEventListener('ended',event=>{
    if(!this.active || this.dead || mediaKind(player)==='gif')return;
    const v=event.target,want=this.desiredLoop(v);
    if(want===true){v.currentTime=0;this.play(player,v)?.catch?.(()=>{});}
    else if(want===false){this.endedAt.set(player,performance.now());}
   },true);
   root.addEventListener('loadedmetadata',event=>{
    if(!this.active || this.dead)return;
    const preview=this.previews.get(player);
    if(mediaKind(player)!=='gif'){
     this.applyLoopPolicy(player,event.target);
     if(this.volumeMemory && this.savedVolume && !preview?.active)this.applySavedVolume(player,event.target,false);
    }
    if(preview?.active && preview.video===event.target)this.playPreview(player,preview);
    else if(this.retryPreview===player){this.retryPreview=null;this.recheckPointer();if(this.inView)this.settle();}
    if(this.loops.get(player)===event.target)this.playLoop(player,event.target);
    if(this.away.get(player)?.loading)this.resumeAway(player);
    this.handoff();
    this.applyDirect();
   },true);
   if(commentOf(player) && video && !video.paused && this.blocksStart(player))this.block(player,video);
  }
  video(player){return player.matches('video')?player:player.shadowRoot?.querySelector('video') || null;}
  isDetailMedia(player){
   const id=postId(this.win.location.pathname),comment=commentOf(player);
   return Boolean(id && (comment?comment.getAttribute('postid')==='t3_'+id:player.getAttribute('player-type')===DETAIL_PLAYER && player.getAttribute('post-id')==='t3_'+id));
  }
  isDetailEmbed(embed){
   const id=postId(this.win.location.pathname);
   return Boolean(id && embed?.closest('shreddit-post')?.id==='t3_'+id && !embed.closest('shreddit-feed,shreddit-comment'));
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
  previewable(player){return feedPlayer(player) || Boolean(commentOf(player) && !closedThread(player));}
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
   if(!this.configured || this.touch || this.pending?.held || this.embedPending?.held || event.pointerType!=='mouse' ||
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
   if(!player || this.startMode(mediaKind(player))!=='preview' || !this.previewable(player) || event.buttons || current===player)return;
   if(within(to,player))return;
   this.stopHover();
   this.hovered=player;
   this.hoverTimer=this.win.setTimeout(()=>this.startPreview(player),HOVER_MS);
  }
  refreshDirect(){
   if(!this.readDirect)return;
   Promise.resolve(this.readDirect()).then(value=>this.setDirect(value),()=>{});
  }
  // true (original players only) or {core, origins}: extra providers count only once granted.
  setDirect(value){
   this.directReady=value===true || value?.core===true;
   this.directOrigins=new Set(Array.isArray(value?.origins)?value.origins.filter(origin=>typeof origin==='string'):[]);
  }
  // A pointer already resting on a video gets no new pointerover: when settings arrive, a player attaches, the tab
  // shows again or scrolling stops, the media under the last known pointer position is treated as just hovered
  // (docs/feed-controls-ux-plan.md, 11).
  recheckPointer(){
   if(!this.active || this.dead || !this.configured || this.touch || !this.pointer || this.doc.hidden || this.hovered || this.ePreview)return;
   if(!kinds.some(kind=>this.startMode(kind)==='preview'))return;
   const target=this.doc.elementFromPoint?.(this.pointer.x,this.pointer.y);if(!target)return;
   const path=[];for(let node=target;node;node=node.parentNode || node.host)path.push(node);path.push(this.win);
   const media=path.find(node=>node.matches?.(MEDIA_NODES) || node.matches?.(ANY_EMBED));if(!media)return;
   this.hover({type:'pointerover',pointerType:'mouse',isTrusted:true,buttons:0,relatedTarget:null,composedPath:()=>path});
  }
  // A failed start must not leave the player marked as hovered or in view: every later pointerover inside it, and every
  // in-view pick, would then return early until another video was played by hand.
  abandonPreview(player,retry=false){
   if(this.hovered===player){this.win.clearTimeout(this.hoverTimer);this.hovered=null;this.viewing=false;}
   if(retry)this.retryPreview=player;
  }
  startPreview(player){
   const video=this.video(player);
   if(this.hovered!==player || !player.isConnected)return false;
   if(this.doc.hidden || closedThread(player)){this.abandonPreview(player);return false;}
   // Not hydrated yet: try again once the player attaches or reports metadata.
   if(!video){this.abandonPreview(player,true);return false;}
   if(!video.paused || video.ended || this.started.has(video)){this.abandonPreview(player);return false;}
   if(mediaKind(player)!=='gif')for(const other of this.players){
    const media=this.video(other);
    if(mediaKind(other)!=='gif' && media && !media.paused && this.started.has(media)){this.abandonPreview(player);return false;}
   }
   if(this.retryPreview===player)this.retryPreview=null;
   this.attach(player);
   const previous=this.previews.get(player);
   const preview={video,muted:video.muted,active:true,played:previous?.video===video && previous.played};
   this.previews.set(player,preview);
   video.muted=true;
   player.dispatchEvent(new this.win.Event('rt-prepare-feed-preview',{bubbles:true}));
   if(video.readyState>=1)this.playPreview(player,preview);
   // A preview that never gets metadata or never plays is dropped, so the next hover or pick can try again.
   this.win.clearTimeout(this.previewWatch);
   this.previewWatch=this.win.setTimeout(()=>{if(this.previews.get(player)===preview && preview.active && !preview.played && this.hovered===player)this.stopHover();},PREVIEW_STALL_MS);
   return true;
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
   if(!player.dispatchEvent(new this.win.Event('rt-play-video',{bubbles:true,cancelable:true}))){
    // Reddit's own player took the start and swallows its outcome: settle by whether the video is playing soon after,
    // so a refused start still reaches the callers' fallbacks.
    return new Promise((resolve,reject)=>{
     if(!video.paused){resolve();return;}
     let timer=0;const done=ok=>{this.win.clearTimeout(timer);video.removeEventListener('playing',onPlay);ok?resolve():reject(Error('Playback did not start.'));};
     const onPlay=()=>done(true);
     video.addEventListener('playing',onPlay);
     timer=this.win.setTimeout(()=>done(!video.paused),PLAY_SETTLE_MS);
    });
   }
   return video.play();
  }
  playPreview(player,preview){
   if(preview.requested || this.hovered!==player)return;
   preview.requested=true;
   this.play(player,preview.video)?.catch?.(()=>{
    if(this.previews.get(player)===preview && preview.active)this.stopHover();
    this.retryOnActivation();
   });
  }
  // Some phone browsers (Firefox for Android among them) refuse even muted autoplay until the page has had a tap. The
  // preview that was refused is tried again on the reader's next tap or key press, instead of waiting for a video to be
  // played by hand.
  retryOnActivation(){
   if(this.activationRetry || this.dead || this.win.navigator?.userActivation?.hasBeenActive===true)return;
   const retry=()=>{
    for(const type of ['pointerup','keydown'])this.win.removeEventListener(type,retry,true);
    this.activationRetry=null;
    if(this.dead || !this.active)return;
    this.win.setTimeout(()=>{if(this.touch)this.pickInView(true);else this.recheckPointer();},0);
   };
   this.activationRetry=retry;
   for(const type of ['pointerup','keydown'])this.win.addEventListener(type,retry,true);
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
  // Unified Click & Audio Interaction Matrix with strict click-target isolation (video surface only; controls/card stay native).
  handleVideoClick(player,video,event,path){
   if(!video)return;
   const preview=this.previews.get(player);
   const isPreview=Boolean(preview && preview.video===video);
   // GIFs are strictly independent and never inherit video click/audio rules.
   if(mediaKind(player)==='gif'){
    if(isPreview){this.previews.delete(player);this.started.add(video);if(this.hovered===player){this.hovered=null;this.viewing=false;}}
    return;
   }
   if(path.some(node=>node.matches?.(SOUND_CONTROL))){
    if(isPreview)this.promotePreview(player,'control');
    else if(!video.paused)this.started.add(video);
    return;
   }
   const playButton=path.some(node=>node.matches?.(PLAY_BUTTON));
   if(playButton){
    if(isPreview){
     if(!preview.played){this.stopHover();return;}
     event.preventDefault();event.stopImmediatePropagation();
     const wantSound=this.clickAction==='default'?true:this.clickAudio==='unmute';
     this.promotePreview(player,'inline',wantSound);
    }
    return;
   }
   // Strict isolation: never intercept native player controls (captions, scrubber, fullscreen, settings, links).
   if(path.some(node=>node.matches?.(PLAYER_CONTROLS)))return;
   if(path[0]!==video)return;
   if(isPreview && !preview.played){this.stopHover();return;}
   const action=this.clickAction,wantSound=this.clickAudio==='unmute';
   const detailOrComment=this.isDetailMedia(player) || Boolean(commentOf(player));
   const effective=action==='open' && detailOrComment?'inline':action;
   if(effective==='default'){
    if(isPreview){
     this.previews.delete(player);this.started.add(video);
     if(this.hovered===player){this.hovered=null;this.viewing=false;}
    }else if(!video.paused)this.started.add(video);
    return;
   }
   if(effective==='open'){
    event.preventDefault();event.stopImmediatePropagation();
    if(!isPreview && !video.paused){
     this.started.add(video);
     if(wantSound && video.muted && this.hasAudio(player,video))this.fadeIn(video,this.targetVolume(video),player);
    }
    if(this.openPost(player)){
     if(isPreview && !this.continueOnOpen)this.promotePreview(player,'inline',wantSound);
     return;
    }
   }
   if(effective==='fullscreen'){
    event.preventDefault();event.stopImmediatePropagation();
    if(isPreview){this.promotePreview(player,'inline',wantSound);}
    else{
     this.started.add(video);
     if(wantSound && video.muted && this.hasAudio(player,video))this.fadeIn(video,this.targetVolume(video),player);
     else if(!wantSound)video.muted=true;
     if(video.paused)this.play(player,video)?.catch?.(()=>{});
    }
    this.enterFullscreen(player,video);
    return;
   }
   // effective === 'inline' (Play/Control in feed):
   if(!video.paused){
    if(video.muted){
     if(wantSound && this.hasAudio(player,video)){
      // Unmute-first priority: 1st click unmutes in place without pausing; 2nd click passes through to pause.
      event.preventDefault();event.stopImmediatePropagation();
      if(isPreview)this.promotePreview(player,'inline',true);
      else{this.started.add(video);this.fadeIn(video,this.targetVolume(video),player);}
      return;
     }
     if(isPreview){
      event.preventDefault();event.stopImmediatePropagation();
      this.promotePreview(player,'inline',false);
      return;
     }
     return; // Already user-owned muted (or silent video): pass through to native pause.
    }
    if(isPreview){
     event.preventDefault();event.stopImmediatePropagation();
     this.promotePreview(player,'inline',true);
    }
    return; // Already playing & unmuted: 2nd click passes through to native pause.
   }
   // Paused video clicked with inline action: start playing with chosen clickAudio.
   event.preventDefault();event.stopImmediatePropagation();
   if(isPreview){this.promotePreview(player,'inline',wantSound);return;}
   this.started.add(video);
   if(wantSound && this.hasAudio(player,video))this.fadeIn(video,this.targetVolume(video),player);
   else video.muted=true;
   this.play(player,video)?.catch?.(()=>{});
  }
  post(frame,data){try{frame.contentWindow?.postMessage(data,new URL(frame.getAttribute('src') || '',this.win.location.href).origin);}catch{}}
  embedOrigin(frame){return embedHosts?.playerOrigin(frame.getAttribute('src')) || '';}
  postDirect(frame,rtMedia,fields){
   const origin=this.embedOrigin(frame);
   if(origin)frame.contentWindow?.postMessage({rtMedia,...fields},origin);
  }
  held(state){return Boolean(state.direct || this.directReady && state.kind==='flags' && state.frame && this.grantedFrame(state.frame));}
  // A supported player address whose provider is covered by the current grant (the original players, or an extra
  // provider granted host by host).
  grantedFrame(frame){
   const src=frame.dataset.rtParked?frame.dataset.rtSrc:frame.getAttribute('src');
   return this.originGranted(embedHosts?.playerOrigin(src || ''));
  }
  originGranted(origin){return Boolean(origin && (!embedHosts.isExtra?.(origin) || this.directOrigins.has(origin)));}
  // Reddit's own lite-youtube creates its iframe only when activated, inside its shadow root: the scan never registers
  // it, so its hello is matched here.
  findFrame(source){
   for(const embed of this.doc.querySelectorAll(ANY_EMBED)){
    const lite=embed.shadowRoot?.querySelector('lite-youtube');
    for(const frame of [...(embed.shadowRoot?.querySelectorAll('iframe') || []),...(lite?.shadowRoot?.querySelectorAll('iframe') || []),...(lite?.querySelectorAll('iframe') || [])])
     if(frame.contentWindow===source)return frame;
   }
   return null;
  }
  // A frame the extension can drive from inside (its frame script said hello), or one expected to (Direct embed controls
  // granted and a supported player address) until it says hello or HELLO_MS pass without one. Such a player keeps its
  // own picture and controls: no still, cover or click layer is put over it.
  expectDirect(frame){
   const state=this.frameState(frame);
   if(state.direct)return true;
   if(!this.directReady || state.noHello)return false;
   if(!this.grantedFrame(frame))return false;
   if(!frame.dataset.rtParked && !state.helloTimer)state.helloTimer=this.win.setTimeout(()=>{
    state.helloTimer=null;
    if(state.direct || !frame.isConnected || frame.dataset.rtParked || this.dead)return;
    state.noHello=true;
    const embed=embedOfFrame(frame);
    if(this.active && embed?.matches?.(ANY_EMBED) && this.feedEmbed(embed) && this.startMode('embed')!=='default')this.syncIdleEmbed(embed);
   },HELLO_MS);
   return true;
  }
  dropCover(embed){embed.shadowRoot?.querySelector('[data-rt-parked-cover]')?.remove();}
  // What a player that just loaded should do: feed players wait (on their first frame) unless chosen; others play.
  idleChoice(frame){
   const embed=embedOfFrame(frame);
   if(!embed?.matches?.(ANY_EMBED) || !this.feedEmbed(embed))return 'play';
   return this.ePreview?.embed===embed || embed.dataset.rtEmbedUsed==='1'?'play':'pause';
  }
  framePolicy(frame,block,force=false){
   const state=this.frameState(frame);
   if(!force && state.block===block)return;
   state.block=block;this.postDirect(frame,'policy',{block});
  }
  framePlayback(frame,state,kind,user=false){
   const embed=embedOfFrame(frame),pending=this.embedPending;
   if(kind==='play' || kind==='pause')state.reported=kind;
   if(kind==='pause'){state.playing=false;if(this.directEmbed?.frame===frame && this.directEmbed.phase==='trial')this.directEmbedFallback(this.directEmbed);}
   if(kind!=='play')return;
   state.played=true;state.playing=true;
   if(this.directEmbedBlocks(embed,user)){this.command(frame,'pause');return;}
   if(pending?.held){
    if(pending.frame===frame)return;
    if(this.isDetailEmbed(embed)){this.command(frame,'pause');return;}
   }
   if(!embed?.matches?.(ANY_EMBED) || this.ePreview?.embed===embed)return;
   if(this.feedEmbed(embed) && this.startMode('embed')==='play' && embed.dataset.rtEmbedUsed!=='1' && !user){
    this.command(frame,'pause');
    if(!this.expectDirect(frame))this.cover(embed,true,true);
    return;
   }
   embed.dataset.rtEmbedUsed='1';this.exclusive(embed);
  }
  frameState(frame){
   let state=this.frames.get(frame);
   if(!state){
    state={kind:frameKind(frame),queue:new Map(),frame};this.frames.set(frame,state);
    if(state.kind!=='flags')this.subscribe(frame,state);
    frame.addEventListener('load',()=>{
     if(frame.dataset.rtParked)return;
     this.framePolicy(frame,state.block,true);
     if(frame.dataset.rtWaiting==='1'){
      this.win.clearTimeout(state.drawTimer);
      state.drawTimer=this.win.setTimeout(()=>this.finishEmbedDraw(frame),this.held(state)?1800:400);
     }
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
   delete frame.dataset.rtWaiting;
   const state=this.frameState(frame);
   Object.assign(state,{rendered:false,direct:false,readySeen:false});
   this.win.clearTimeout(state.drawTimer);
   frame.dataset.rtSrc=frame.getAttribute('src') || '';frame.dataset.rtParked='1';frame.setAttribute('src','about:blank');
   this.cover(embed,false,keepCover);
  }
  cover(embed,loaded,keep=false){
   const root=embed.shadowRoot;if(!root)return;
   dropPreStill(root);
   const old=root.querySelector('[data-rt-parked-cover]');if(old){if(!loaded)delete old.dataset.rtLoaded;if(keep)old.dataset.rtKeepCover='';return;}
   if(this.win.getComputedStyle(embed).position==='static')embed.style.position='relative';
   const cover=this.doc.createElement('div');cover.dataset.rtParkedCover='';cover.setAttribute('role','button');cover.setAttribute('aria-label','Play');cover.tabIndex=0;
   if(loaded)cover.dataset.rtLoaded='';
   if(keep)cover.dataset.rtKeepCover='';
   Object.assign(cover.style,{position:'absolute',inset:'0',zIndex:'4',cursor:'pointer',backgroundColor:loaded?'transparent':'var(--color-neutral-background-weak,#f6f8f9)',display:'flex',flexDirection:'column',gap:'8px',alignItems:'center',justifyContent:'center'});
   const play=this.doc.createElement('span');play.dataset.rtParkedPlay='';
   Object.assign(play.style,{position:'relative',width:'56px',height:'56px',borderRadius:'999px',background:'rgba(0,0,0,.6)',color:'#fff',display:'flex',alignItems:'center',justifyContent:'center'});
   play.innerHTML='<svg viewBox="0 0 20 20" width="24" height="24" fill="currentColor" aria-hidden="true"><path d="M6 3.8v12.4a.8.8 0 0 0 1.2.7l10-6.2a.8.8 0 0 0 0-1.4l-10-6.2A.8.8 0 0 0 6 3.8Z"/></svg>';
   cover.append(play);
   // With no usable still: the provider's name under the play button (data-rt-placeholder).
   const name=embed.getAttribute('providername');
   if(name){const label=this.doc.createElement('span');label.dataset.rtParkedLabel='';label.textContent=name;
    Object.assign(label.style,{position:'relative',color:'var(--color-neutral-content,#2a3c42)',font:'600 13px/16px system-ui,sans-serif'});cover.append(label);}
   const start=event=>{event.preventDefault();event.stopPropagation();this.playCovered(embed);};
   cover.addEventListener('click',start);cover.addEventListener('keydown',event=>{if(event.key==='Enter' || event.key===' ')start(event);});
   root.append(cover);
   this.paintPoster(embed);
  }
  uncover(embed){embed.shadowRoot?.querySelector('[data-rt-parked-cover]')?.remove();dropPreStill(embed.shadowRoot);}
  // A tap on the image plays that player, respecting clickAudio/fullscreen when configured.
  playCovered(embed){
   if(this.ePreview?.embed!==embed)this.stopEmbed();
   else{const preview=this.ePreview;this.ePreview=null;this.win.clearTimeout(preview.timer);this.win.clearTimeout(preview.leave);this.dropLayer(preview);this.restoreHost(preview);}
   embed.dataset.rtEmbedUsed='1';
   this.watchFeedSound(embed);
   const wantSound=this.clickAction==='default' || this.clickAudio==='unmute';
   const frame=controlFrame(embed);
   if(frame?.dataset.rtParked){
    const src=frame.dataset.rtSrc;this.unpark(embed,frame,flagged(src,wantSound));
    if(wantSound)this.frameSound({frame,src},false);
    else{this.command(frame,'mute');this.command(frame,'play');}
   }
   else{
    this.uncover(embed);
    if(embed.matches(EMBED)){const lite=youTubeLite(embed);if(lite && !lite.classList.contains('lyt-activated'))lite.click();else embed.dispatchEvent(new this.win.Event(wantSound?'rt-embed-sound':'rt-embed-use-muted',{bubbles:true}));}
    else{
     const player=frame || controlFrame(embed,wantSound?'audible':'muted');
     if(player){
      if(wantSound)this.frameSound({frame:player,src:player.src},false);
      else{this.command(player,'mute');this.command(player,'play');}
     }
    }
   }
   if(this.clickAction==='fullscreen')this.enterEmbedFullscreen(embed);
   this.exclusive(embed);
  }
  // A feed player that stops being the one playing goes back to its image: unloaded if it has no controls, paused
  // underneath otherwise.
  rest(embed,keepCover=false){
   if(!this.feedEmbed(embed) || this.ePreview?.embed===embed || this.embedPending?.source===embed)return;
   this.stopWatchingFeedSound(embed);
   this.preparePoster(embed);
   if(embed.matches(EMBED)){if(youTubeLite(embed)?.querySelector('iframe')){delete embed.dataset.rtEmbedUsed;this.cover(embed,true);}return;}
   const frame=controlFrame(embed);if(!frame)return;
   delete embed.dataset.rtEmbedUsed;
   const state=this.frameState(frame);
   // A player driven from inside is paused by the caller and keeps its own paused picture and controls.
   if(this.expectDirect(frame)){this.dropCover(embed);return;}
   if(state.kind==='flags' && !this.held(state))this.park(embed,frame,keepCover);
   else if(!frame.dataset.rtParked)this.cover(embed,true,keepCover);
  }
  watchFeedSound(embed){
   if(!this.io || !this.feedEmbed(embed))return;
   this.feedSoundEmbeds.add(embed);this.io.observe(embed);
  }
  stopWatchingFeedSound(embed){if(this.feedSoundEmbeds.delete(embed) && !this.feedEmbeds.has(embed))this.io?.unobserve(embed);}
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
   // A poster batch that lands after embed overrides were turned off must not cover a player nothing manages now.
   if(!this.active || this.startMode('embed')==='default'){dropPreStill(root);return;}
   const frame=controlFrame(embed);
   const waiting=frame?.dataset.rtWaiting==='1';
   const idle=!vimeoLite(embed) && !frame && !embed.dataset.rtEmbedPreview && !embed.dataset.rtEmbedUsed;
   const wanted=found && !youTubeLite(embed) && !root.querySelector('[data-rt-parked-cover]') &&
    (waiting || idle) && this.stillWanted(embed);
   let still=root.querySelector('[data-rt-pre-still]');
   if(!wanted){dropPreStill(root);return;}
   if(!still){
    if(this.win.getComputedStyle(embed).position==='static')embed.style.position='relative';
    still=this.doc.createElement('img');still.dataset.rtPreStill='';still.alt='';still.referrerPolicy='no-referrer';still.decoding='async';
    Object.assign(still.style,{position:'absolute',inset:'0',width:'100%',height:'100%',objectFit:'cover',backgroundColor:'var(--color-neutral-background-weak,#f6f8f9)',zIndex:'3',pointerEvents:'none'});
    // The same play mark as Visual search tiles, shown as soon as the still has drawn: it is a video, not a picture.
    const mark=this.doc.createElement('span');mark.dataset.rtPreMark='';mark.hidden=true;mark.setAttribute('aria-hidden','true');
    Object.assign(mark.style,{position:'absolute',top:'8px',insetInlineEnd:'8px',zIndex:'3',minWidth:'24px',height:'24px',padding:'0 6px',boxSizing:'border-box',borderRadius:'999px',background:'rgba(0,0,0,.6)',color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',pointerEvents:'none'});
    mark.innerHTML='<svg viewBox="0 0 20 20" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M6.8 4.4a.8.8 0 0 1 1.22-.68l7.6 4.6a.8.8 0 0 1 0 1.36l-7.6 4.6A.8.8 0 0 1 6.8 13.6V4.4Z"/></svg>';
    still.addEventListener('load',()=>{mark.hidden=false;});
    still.addEventListener('error',()=>{mark.hidden=true;});
    root.append(still,mark);
   }
   if(still.getAttribute('src')!==found){still.src=found;const mark=root.querySelector('[data-rt-pre-mark]');if(mark)mark.hidden=!(still.complete && still.naturalWidth);}
  }
  // A player Reddit inserts keeps the still over it until it has loaded and had a moment to draw.
  awaitDraw(frame){
   if(frame.dataset.rtWaiting)return;
   frame.dataset.rtWaiting='1';
   this.frameState(frame).rendered=false;
  }
  embedRendered(frame,state){
   state.rendered=true;
   this.finishEmbedDraw(frame);
  }
  finishEmbedDraw(frame){
   if(frame.dataset.rtWaiting!=='1' || frame.dataset.rtParked)return;
   frame.dataset.rtWaiting='0';
   const embed=embedOfFrame(frame);
   if(embed?.matches(ANY_EMBED))this.paintPoster(embed);
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
    Object.assign(still.style,{position:'absolute',inset:'0',width:'100%',height:'100%',objectFit:'cover',pointerEvents:'none'});
    cover.prepend(still);
   }
   if(url){if(still.getAttribute('src')!==url)still.src=url;}else still?.remove();
   cover.dataset.rtStill=url || '';
   cover.toggleAttribute('data-rt-placeholder',!url && !('rtLoaded' in cover.dataset));
   const label=cover.querySelector('[data-rt-parked-label]');if(label)label.hidden=!cover.hasAttribute('data-rt-placeholder');
   // A player driven from inside that was unloaded off screen loads idle once in view, its own first frame showing.
   if(frame?.dataset.rtParked && !('rtKeepCover' in cover.dataset) && this.feedEmbed(embed) && !this.outsideViewport(embed) && this.expectDirect(frame)){
    this.unpark(embed,frame,idleSource(frame.dataset.rtSrc));return;
   }
   // No usable image for an unloaded player with controls: load it idle, so its own first frame or poster shows.
   if(!url && frame?.dataset.rtParked && this.frameState(frame).kind!=='flags' && this.feedEmbed(embed) && !this.outsideViewport(embed)){
    this.unpark(embed,frame,idleSource(frame.dataset.rtSrc));return;
   }
   // No usable image for a loaded player: its own paused first frame or poster shows instead.
   if('rtLoaded' in cover.dataset && !('rtKeepCover' in cover.dataset)){cover.remove();return;}
  }
  paintPosters(ids){
   if(!ids.length)return;
   const wanted=new Set(ids);
   const selector=ids.every(id=>/^t3_[a-z0-9]+$/i.test(id))
    ?ids.map(id=>'shreddit-post[id="'+id+'"] '+ANY_EMBED).join(',')
    :ANY_EMBED;
   for(const embed of this.doc.querySelectorAll(selector))if(wanted.has(embed.closest('shreddit-post')?.id))this.paintPoster(embed);
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
    // Bounded like posterQuality: a long feed session meets thousands of posts.
    if(this.posters.size>512){const oldest=this.posters.keys().next().value;this.posters.delete(oldest);this.providerPosters.delete(oldest);}
    if(provider)this.providerPosters.add(id);
    this.paintPosters([id]);
   };
   let found={};try{found=await this.readPosters(ids,sources,paint);}catch{}
   this.loadingPosters=false;
   if(this.dead)return;
   if(this.posterWanted.size && !this.posterTimer)this.posterTimer=this.win.setTimeout(()=>this.loadPosters(),60);
   for(const [id,urls] of Object.entries(found || {}))paint(id,urls);
   this.paintPosters(ids);
  }
  // Iframes Reddit adds inside an embed (when it comes near the screen) are caught before they load, unless chosen.
  watchEmbed(embed){
   if(!embed.shadowRoot || this.watchedEmbeds.has(embed))return;
   const root=embed.shadowRoot;
   const observer=new this.win.MutationObserver(()=>{
    if(this.dead || !this.configured || !this.feedEmbed(embed) || this.ePreview?.embed===embed || this.embedPending?.source===embed || embed.dataset.rtEmbedUsed==='1')return;
    const frame=controlFrame(embed);
    if(frame && root.querySelector('[data-rt-pre-still]'))this.awaitDraw(frame);
    this.observePoster(embed);this.syncIdleEmbed(embed);this.paintPoster(embed);
   });
   observer.observe(embed.shadowRoot,{childList:true,subtree:true});this.watchedEmbeds.set(embed,observer);
  }
  unpark(embed,frame,src){
   if(!frame.dataset.rtParked)return false;
   const original=frame.dataset.rtSrc || '';delete frame.dataset.rtParked;delete frame.dataset.rtSrc;
   this.awaitDraw(frame);
   this.uncover(embed);this.paintPoster(embed);allowAutoplay(frame);
   frame.setAttribute('src',src || original);return true;
  }
  outsideViewport(node){
   const {top,bottom,height}=node.getBoundingClientRect();
   return height>0 && (top>=this.win.innerHeight || (bottom ?? top+height)<=0);
  }
  syncIdleEmbed(embed,outside){
   if(this.embedPending?.source===embed)return;
   const frame=controlFrame(embed);
   if(!frame || frame.dataset.rtParked)return;
   this.framePolicy(frame,this.blockEmbedLinks(true));
   const state=this.frameState(frame),onlyOnPlay=this.startMode('embed')==='play';
   if(!state.played && (outside ?? this.outsideViewport(embed))){this.park(embed,frame);return;}
   // A player driven from inside shows its own first frame and controls; it is held there through the frame (its hello
   // is answered with pause), never covered or unloaded in view.
   if(this.expectDirect(frame)){
    this.dropCover(embed);
    if(onlyOnPlay && state.playing && this.ePreview?.embed!==embed && embed.dataset.rtEmbedUsed!=='1')this.command(frame,'pause');
    return;
   }
   // A player that starts by itself is unloaded behind its image, unless direct controls hold it on its first frame.
   // One with controls stays loaded: idle, it shows its own first frame or poster (On Play pauses it if it starts).
   if(state.kind==='flags' && !this.held(state)){this.park(embed,frame);return;}
   // On Play: a player with controls waits behind Reddit's own still when there is one (nothing loads until tapped).
   if(onlyOnPlay && frame===rawFrame(embed) && !state.played && this.nativePoster(embed)){this.park(embed,frame);return;}
   if(onlyOnPlay && state.playing){this.command(frame,'pause');this.cover(embed,true,true);}
  }
  // Keep raw On Play and flag-driven players behind their covers until chosen.
  parkIdle(except=null){
   // Measure every embed first, then park and cover: one layout instead of one per embed.
   const list=[];
   for(const embed of this.doc.querySelectorAll(ANY_EMBED)){
    if(embed===except || !this.feedEmbed(embed) || embed.dataset.rtEmbedUsed==='1' || this.ePreview?.embed===embed)continue;
    list.push([embed,this.outsideViewport(embed)]);
   }
   for(const [embed,outside] of list)if(embed.isConnected)this.syncIdleEmbed(embed,outside);
  }
  // A feed card's embed whose player Reddit has not inserted yet still names it in its markup (embed-html, Embedly).
  stillWanted(embed){
   const card=embed?.closest?.('shreddit-post');
   return Boolean(card?.id && postId(this.win.location.pathname)!==card.id.replace(/^t3_/,'') && (this.feedEmbed(embed) || embedAddress(embed)));
  }
  feedEmbed(embed){
   const card=embed?.closest?.('shreddit-post');
   return Boolean(card?.id && !embed.closest(BLURRED) && embed.matches(ANY_EMBED) && (embed.matches(EMBED) || rawFrame(embed) || vimeoLite(embed)) && postId(this.win.location.pathname)!==card.id.replace(/^t3_/,''));
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
   if(!this.feedEmbed(embed) || this.startMode('embed')!=='preview' || event.buttons || current?.embed===embed)return true;
   this.stopHover();
   const preview=this.ePreview={embed,card:embed.closest('shreddit-post')};
   preview.timer=this.win.setTimeout(()=>this.startEmbed(preview),HOVER_MS);
   return true;
  }
  startEmbed(preview){
   const {embed}=preview;
   if(this.ePreview!==preview || this.doc.hidden || !embed.isConnected || this.outsideViewport(embed))return;
   this.preparePoster(embed);
   embed.dataset.rtEmbedPreview='on';
   if(vimeoLite(embed) || embed.shadowRoot?.querySelector('[data-rt-parked-cover][data-rt-loaded]'))this.uncover(embed);
   let host;
   if(embed.matches(EMBED)){
    if(embed.dispatchEvent(new this.win.Event('rt-embed-preview',{bubbles:true,cancelable:true}))){this.stopEmbed();return;}
    host=embed.shadowRoot?.querySelector('lite-youtube') || embed;
    // Direct embed controls granted for YouTube: its own controls work and its frame reports taps; no layer.
    if(this.directReady && ['https://www.youtube.com','https://www.youtube-nocookie.com'].some(origin=>this.originGranted(origin))){
     preview.active=true;preview.direct=true;preview.ytDirect=true;return;
    }
   }else{
    const frame=controlFrame(embed,'muted'),src=frame?.dataset.rtParked?frame.dataset.rtSrc:frame?.getAttribute('src');if(!frame || !src){this.stopEmbed();return;}
    const state=this.frameState(frame),kind=this.held(state)?'direct':state.kind;
    if(kind==='playerjs' && !state.readySeen)state.pendingStart={src,sound:false};
    this.framePolicy(frame,this.blockEmbedLinks(this.feedEmbed(embed)));
    preview.frame={frame,src,kind,position:embed.style.position};
    // A player with a control protocol starts muted in place; others load with the provider's own flags.
    if(kind==='flags'){if(!this.unpark(embed,frame,flagged(src,false))){allowAutoplay(frame);frame.setAttribute('src',flagged(src,false));}}
    else{this.unpark(embed,frame,flagged(src,false));allowAutoplay(frame);this.command(frame,'mute');this.command(frame,'play');}
    if(vimeoLite(embed) && !state.rendered){this.awaitDraw(frame);this.paintPoster(embed);}
    // A frame driven from inside reports clicks on its own video surface (tap) or controls (take): no layer over it.
    if(state.direct){preview.active=true;preview.direct=true;this.postDirect(frame,'preview',{on:true});return;}
    // Granted and its hello still on the way: no layer either; the hello turns tap reporting on.
    if(kind==='direct' && this.expectDirect(frame)){preview.active=true;return;}
    // The layer sits in the embed's shadow root over its iframe.
    if(this.win.getComputedStyle(embed).position==='static')embed.style.position='relative';
    host=embed.shadowRoot;
   }
   preview.active=true;
   // While it previews, a layer over the embed takes the click (the iframe would otherwise play it in place).
   const layer=preview.layer=this.doc.createElement('div');
   layer.dataset.rtEmbedLayer='';
   layer.setAttribute('role',this.clickAction==='open'?'link':'button');
   const layerLabel=this.clickAction==='open'?'Open post':this.clickAction==='fullscreen'?'Open in fullscreen':this.clickAudio==='unmute'?'Play with sound':'Show controls, stay muted';
   layer.setAttribute('aria-label',layerLabel);
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
  labelEmbedSound(preview){
   if(!preview.sound)return;
   const label=preview.frame?.kind==='flags' && !this.held(this.frameState(preview.frame.frame))?'Use player’s sound control':'Turn sound on';
   preview.sound.setAttribute('aria-label',label);preview.sound.title=label;
  }
  useEmbed(preview,sound){
   if(this.ePreview!==preview)return;
   const wantSound=sound || this.clickAudio==='unmute';
   if(!sound && this.clickAction==='open' && this.openPost(preview.embed)){
    if(this.ePreview===preview)this.promoteEmbed(preview,wantSound,false);
    return;
   }
   this.promoteEmbed(preview,wantSound,!sound);
   if(!sound && this.clickAction==='fullscreen')this.enterEmbedFullscreen(preview.embed);
  }
  // The preview becomes the user's: the layer goes, it keeps playing, with sound when chosen.
  promoteEmbed(preview,sound,reload){
   if(this.ePreview!==preview)return;
   this.ePreview=null;
   this.win.clearTimeout(preview.timer);this.win.clearTimeout(preview.leave);
   this.dropLayer(preview);
   preview.embed.dataset.rtEmbedUsed='1';
   this.watchFeedSound(preview.embed);
   if(preview.frame){this.restoreHost(preview);if(sound)this.frameSound(preview.frame,reload);return;}
   if(sound)preview.embed.dispatchEvent(new this.win.Event('rt-embed-sound',{bubbles:true}));
   else preview.embed.dispatchEvent(new this.win.Event('rt-embed-use-muted',{bubbles:true}));
  }
  frameSound({frame,src},reload=true){
   const state=this.frameState(frame);
   if(reload && state.kind==='playerjs' && !state.readySeen)state.pendingStart={src,sound:true};
   this.command(frame,'unmute');this.command(frame,'play');
  }
  restoreHost(preview){if(preview.frame)preview.embed.style.position=preview.frame.position || '';}
  // The preview's click layer goes, or a frame driven from inside stops reporting taps.
  dropLayer(preview){
   preview.layer?.remove();preview.layer=null;delete preview.embed.dataset.rtEmbedPreview;
   if(preview.direct && preview.frame?.frame?.isConnected)this.postDirect(preview.frame.frame,'preview',{on:false});
   if(preview.ytFrame?.isConnected)this.postDirect(preview.ytFrame,'preview',{on:false});
   preview.direct=false;preview.ytFrame=null;
  }
  stopEmbed(){
   const preview=this.ePreview;if(!preview)return;
   this.ePreview=null;
   this.win.clearTimeout(preview.timer);this.win.clearTimeout(preview.leave);
   this.dropLayer(preview);
   if(preview.frame){
    this.restoreHost(preview);
    const {frame,src,kind}=preview.frame;
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
   const reveal=this.revealedMediaGates.has(embed.closest(NSFW_GATE));
   const handoff={id,from:this.win.location.pathname,source:embed,sourceCard:embed.closest('shreddit-post'),reveal,owner:owner(this.doc)};
   // Other providers: no position to read, but the same iframe (previewing, or one you clicked into) moves into the post.
   if(!embed.matches(EMBED)){
    const frame=controlFrame(embed),state=this.frames.get(frame);
    if(!preview && embed.dataset.rtEmbedUsed!=='1' && !(this.startMode('embed')==='default' && state?.playing))return false;
    if(!preview && state?.playing===false)return false;
    const progress=state?.progress;
    const wantSound=this.wantOpenSound(preview?true:(progress?.muted ?? true),{isPreview:Boolean(preview)});
   if(preview){this.ePreview=null;this.win.clearTimeout(preview.timer);this.win.clearTimeout(preview.leave);this.dropLayer(preview);this.restoreHost(preview);
    if(wantSound)this.frameSound(preview.frame,false);}
   this.clearEmbedHandoff();
   if(!this.continueOnOpen)return false;
   const resume=progress?{
    id,owner:owner(this.doc),at:Date.now(),generic:true,
    time:this.restartPreview?0:progress.time,muted:!wantSound
   }:null;
   if(resume)try{this.win.sessionStorage.setItem(EMBED_KEY,JSON.stringify(resume));}catch{}
   const held=!embed.dispatchEvent(new this.win.Event('rt-hold-feed-embed',{bubbles:true,cancelable:true}));
   const sound=wantSound?preview?.frame:null;
   if(!held && !sound && !resume && !reveal)return false;
   this.stopWatchingFeedSound(embed);
   this.watchEmbedHandoff({...handoff,held,generic:true,sound,frame,resume});
   return true;
  }
  if(!this.continueOnOpen)return false;
  embed.dispatchEvent(new this.win.Event('rt-embed-snapshot',{bubbles:true}));
  const time=Number(embed.dataset.rtEmbedTime);
  if(!preview && (embed.dataset.rtEmbedState!=='playing' || !Number.isFinite(time) || time<0))return false;
  const wasMuted=preview?true:embed.dataset.rtEmbedMuted==='true';
  const muted=!this.wantOpenSound(wasMuted,{isPreview:Boolean(preview)});
  const restart=Boolean(this.restartPreview);
   this.clearEmbedHandoff();
   try{this.win.sessionStorage.setItem(EMBED_KEY,JSON.stringify({id,owner:owner(this.doc),at:Date.now(),time:restart || !Number.isFinite(time) || time<0?0:time,muted}));}catch{}
   if(preview){this.ePreview=null;this.win.clearTimeout(preview.timer);this.win.clearTimeout(preview.leave);this.dropLayer(preview);}
   // The same YouTube player moves into the post (page bridge); without it, the post's embed starts at this second.
   const frame=youTubeLite(embed)?.querySelector('iframe');
   const held=!embed.dispatchEvent(new this.win.Event('rt-hold-feed-embed',{bubbles:true,cancelable:true}));
   this.stopWatchingFeedSound(embed);
   this.watchEmbedHandoff({...handoff,held,restart,frame});
   if(held && wasMuted && !muted)embed.dispatchEvent(new this.win.Event('rt-embed-sound',{bubbles:true}));
   if(!held)embed.dispatchEvent(new this.win.Event('rt-embed-stop',{bubbles:true}));
   return true;
  }
  watchEmbedHandoff(pending){
   this.embedPending=pending;
   const watch=()=>{
    if(this.embedPending!==pending || this.dead)return;
    this.embedHandoff();
    if(this.embedPending===pending)this.win.requestAnimationFrame(watch);
   };
   this.win.requestAnimationFrame(watch);
   this.embedExpiry=this.win.setTimeout(()=>this.clearEmbedHandoff(),CONTINUE_MS);
  }
  readyPostMedia(target,pending,id){
   // Reddit can mount its blur before the player, or replace the blur's button during hydration.
   const post=!target && (pending?.held || pending?.reveal) && [...this.doc.querySelectorAll('shreddit-post[id="t3_'+id+'"]')]
    .find(card=>card!==pending.sourceCard && !card.closest('shreddit-feed,shreddit-comment'));
   const gate=target?.closest(BLURRED) || post?.querySelector?.(POST_MEDIA+' '+BLURRED);
   if(gate?.matches(NSFW_GATE) && gate.closest(POST_MEDIA) && !gate.parentElement?.closest(BLURRED) &&
      pending?.reveal && (pending.saved?.owner ?? pending.owner)===owner(this.doc)){
    const button=nativeRevealButton(gate);
    if(button && button.checkVisibility?.({visibilityProperty:true})!==false){
     const attempted=pending.revealButtons ??= new WeakSet();
     if(!attempted.has(button)){attempted.add(button);button.click();}
    }
   }else if(gate && pending?.held){
    this.doc.dispatchEvent(new this.win.Event('rt-conceal-held-media'));
   }
   return Boolean(target?.isConnected && !target.closest(BLURRED));
  }
  detailEmbedForHandoff(selector,pending){
   const source=pending?.source,media=source?.closest(POST_MEDIA);
   return [...this.doc.querySelectorAll(selector)]
    .find(embed=>embed!==source && this.isDetailEmbed(embed) && (!media || embed.closest(POST_MEDIA)));
  }
  embedHandoff(){
   const pending=this.embedPending;
   if(pending && this.win.location.pathname===pending.from)return;
   if(pending?.held && !(pending.frame || pending.source).isConnected)this.releaseHeldEmbed();
   const generic=pending?.generic?pending:null;
   if(generic){
    const id=postId(this.win.location.pathname);
    if(id!==generic.id){if(this.win.location.pathname!==generic.from)this.clearEmbedHandoff();return;}
    const target=this.detailEmbedForHandoff(ANY_EMBED,pending);
    if(!this.readyPostMedia(target,pending,id))return;
    if(generic.held){
     if(!('rtIncoming' in target.dataset)){target.dataset.rtIncoming=target.style.visibility;target.style.visibility='hidden';}
     if(target.dispatchEvent(new this.win.Event('rt-place-held-embed',{bubbles:true,cancelable:true})))return;
     target.style.visibility=target.dataset.rtIncoming;delete target.dataset.rtIncoming;
     this.trackDetailEmbed(target);
     if(generic.frame?.isConnected)this.framePolicy(generic.frame,this.blockEmbedLinks(false));
     if(generic.sound?.frame.isConnected)this.frameSound(generic.sound,false);
    }else if(generic.resume){
     if(!this.restoreEmbedPosition(target,generic.resume))return;
    }else if(generic.sound){
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
   if(saved.id!==id){if(pending && this.win.location.pathname!==pending.from)this.clearEmbedHandoff();return;}
   // Reddit keeps the outgoing feed (with this post's card) in the page: only the post's own embed continues.
   const embed=this.detailEmbedForHandoff(saved.generic?ANY_EMBED:EMBED,pending);
   if(!this.readyPostMedia(embed,pending,id))return;
   if(saved.generic){
    if(Number.isFinite(saved.time) && saved.time>=0 && saved.time<=86400 && typeof saved.muted==='boolean' && this.restoreEmbedPosition(embed,saved))this.clearEmbedHandoff();
    return;
   }
   if(pending?.held){
    // Waits until Reddit has laid out the post's embed; its own thumbnail and play button stay hidden meanwhile.
    if(!('rtIncoming' in embed.dataset)){embed.dataset.rtIncoming=embed.style.visibility;embed.style.visibility='hidden';}
    if(embed.dispatchEvent(new this.win.Event('rt-place-held-embed',{bubbles:true,cancelable:true})))return;
    embed.style.visibility=embed.dataset.rtIncoming;delete embed.dataset.rtIncoming;
    this.trackDetailEmbed(embed);
    this.embedPending=null;this.clearEmbedHandoff();
    if(pending.restart){embed.dataset.rtStart='0';embed.dataset.rtMuted=String(saved.muted===true);embed.dispatchEvent(new this.win.Event('rt-embed-continue',{bubbles:true,cancelable:true}));}
    return;
   }
   embed.dataset.rtStart=String(saved.time);embed.dataset.rtMuted=String(saved.muted===true);
   if(!embed.dispatchEvent(new this.win.Event('rt-embed-continue',{bubbles:true,cancelable:true})))this.clearEmbedHandoff();
  }
  restoreEmbedPosition(embed,{time,muted}){
   const frame=controlFrame(embed,'muted');
   if(!frame || !this.frameState(frame).direct)return false;
   this.postDirect(frame,'resume',{time,muted});
   return true;
  }
  clearEmbedHandoff(){
   this.win.clearTimeout(this.embedExpiry);
   for(const embed of this.doc.querySelectorAll('[data-rt-incoming]')){embed.style.visibility=embed.dataset.rtIncoming;delete embed.dataset.rtIncoming;}
   this.releaseHeldEmbed();
   this.embedPending=null;
   try{this.win.sessionStorage.removeItem(EMBED_KEY);}catch{}
  }
  releaseHeldEmbed(){
   if(!this.embedPending?.held)return;
   this.embedPending.held=false;
   this.doc.dispatchEvent(new this.win.Event('rt-release-feed-embed'));
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
  promotePreview(player,action,wantSound=null){
   const preview=this.previews.get(player);
   if(!preview || (!preview.played && !(action==='control' && preview.active)))return;
   const video=preview.video;
   this.previews.delete(player);
   this.started.add(video);
   if(this.hovered===player)this.stopHover();
   if(action==='control')return;
   const unmute=wantSound!==null?wantSound:(action==='here' || action==='open' && this.unmutePreview);
   if(action==='open' && this.restartPreview)video.currentTime=0;
   if(unmute && this.hasAudio(player,video))this.fadeIn(video,this.targetVolume(video),player);
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
   const link=path.find(node=>node.matches?.('a[href]'));
   const result=path.find(node=>node.matches?.(SEARCH_RESULT));
   if(result){this.openFromResult(link);return;}
   if(path.some(node=>node.matches?.(PLAYERS)))return;
   const card=path.find(node=>node.matches?.('shreddit-post'));
   if(!link || !card || link.hasAttribute('download') || link.target && link.target!=='_self')return;
   const url=new URL(link.href,this.win.location.href),id=postId(url.pathname);
   if(url.origin!==this.win.location.origin || !id || card.id!=='t3_'+id || postId(this.win.location.pathname)===id)return;
   this.cardOpen=!this.opening;
   try{this.rememberCard(card,id);}finally{this.cardOpen=false;}
  }
  // The post opened from a search result follows Post opened directly, as if its link had been opened: a result
  // tile has no playing moment to carry over, so the post's own video or embed starts by that choice.
  openFromResult(link){
   if(!link || link.hasAttribute('download') || link.target && link.target!=='_self')return;
   let url;try{url=new URL(link.href,this.win.location.href);}catch{return;}
   const id=postId(url.pathname);
   if(url.origin!==this.win.location.origin || !id || postId(this.win.location.pathname)===id)return;
   this.resultOpen={id,at:Date.now()};
  }
  // Visual search hands over its clip's moment (the same media as the post's video) when a result opens its post:
  // Seamless post transition then continues the post's own video from there, as from a feed preview.
  continueFromVisual(detail){
   if(!this.configured || !this.continueOnOpen || !detail)return;
   const id=String(detail.id || '').toLowerCase(),time=Number(detail.time);
   if(!/^[a-z0-9]{1,10}$/.test(id) || !Number.isFinite(time) || time<0)return;
   const muted=detail.source==='viewer'?detail.muted!==false:detail.source==='title'?
    (this.cardClickAudio==='unmute'?false:true):!this.unmutePreview;
   this.clearHandoff();
   const saved={id,owner:owner(this.doc),at:Date.now(),time:this.restartPreview?0:time,muted,volume:this.volumeMemory && this.savedVolume?.volume>0?this.savedVolume.volume:0.5,rate:1};
   this.pending={saved,from:this.win.location.pathname,reached:false};
   this.saveHandoff();
   this.expiry=this.win.setTimeout(()=>this.clearHandoff(),CONTINUE_MS);
  }
  // Called on the route change: the post Reddit has just opened is the result that was clicked.
  adoptResultOpen(){
   const open=this.resultOpen;this.resultOpen=null;
   if(!open || Date.now()-open.at>CONTINUE_MS || postId(this.win.location.pathname)!==open.id || this.pending?.saved?.id===open.id)return;
   this.endDirect();this.endDirectEmbed();
   this.direct=null;this.directEmbed=null;this.directEmbedNone=false;this.landing=open.id;
  }
  rememberCard(card,id){
   const embed=[...card.querySelectorAll(ANY_EMBED)].find(node=>this.feedEmbed(node));
   if(embed && this.continueOnOpen && this.rememberEmbed(embed,id))return;
   if(!this.continueOnOpen)return;
   const source=[...card.querySelectorAll(PLAYERS)].find(player=>player.getAttribute('player-type')===FEED_PLAYER);
   const sourceVideo=source && this.video(source);
   const wasPreview=Boolean(sourceVideo && this.previews.get(source)?.video===sourceVideo);
   if(wasPreview)this.promotePreview(source,'open',this.wantOpenSound(true,{isPreview:true}));
   const nativePlaying=Boolean(source && this.startMode(mediaKind(source))==='default' && !this.previews.has(source));
   if(!sourceVideo || sourceVideo.paused || sourceVideo.ended || (!this.started.has(sourceVideo) && !nativePlaying) || this.previews.has(source) || source.closest(BLURRED))return;
   if(this.cardOpen && !wasPreview){
    const wantSound=this.wantOpenSound(sourceVideo.muted,{isPreview:false});
    if(wantSound && sourceVideo.muted && this.hasAudio(source,sourceVideo)){this.started.add(sourceVideo);this.fadeIn(sourceVideo,this.targetVolume(sourceVideo),source);}
    else if(!wantSound && !sourceVideo.muted)sourceVideo.muted=true;
   }
   if(this.restartPreview)sourceVideo.currentTime=0;
   this.clearHandoff();
   const saved={id,owner:owner(this.doc),at:Date.now(),...this.playback(sourceVideo)};
   if(this.restartPreview)saved.time=0;
   const pending=this.pending={saved,source,sourceVideo,sourceCard:card,from:this.win.location.pathname,reached:false,
    reveal:this.revealedMediaGates.has(source.closest(NSFW_GATE))};
   this.saveHandoff();
   pending.held=!source.dispatchEvent(new this.win.Event('rt-hold-feed-video',{bubbles:true,cancelable:true}));
   this.expiry=this.win.setTimeout(()=>this.clearHandoff(),CONTINUE_MS);
   if(pending.held || pending.reveal){
    const watch=()=>{
     if(this.pending!==pending || this.dead)return;
     this.handoff();
     if(this.pending===pending)this.win.requestAnimationFrame(watch);
    };
    this.win.requestAnimationFrame(watch);
   }
  }
  saveHandoff(){
   try{this.win.sessionStorage.setItem(CONTINUE_KEY,JSON.stringify(this.pending.saved));}catch{}
  }
  clearHandoff(){
   this.win.clearTimeout(this.expiry);
   this.pending?.layoutObserver?.disconnect();
   this.releaseHeldVideo();
   this.pending=null;
   try{this.win.sessionStorage.removeItem(CONTINUE_KEY);}catch{}
  }
  releaseHeldVideo(){
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
   if(pending.held && !pending.sourceVideo.isConnected)this.releaseHeldVideo();
   const {id}=pending.saved;
   const player=[...this.doc.querySelectorAll(`[player-type="${DETAIL_PLAYER}"][post-id="t3_${id}"]:is(${PLAYERS})`)]
    .find(node=>!node.closest('shreddit-comment'));
   if(!this.readyPostMedia(player,pending,id))return;
   if(pending.held && this.waitForDetailLayout(pending,player))return;
   if(pending.held && player.checkVisibility?.({visibilityProperty:true})===false)return;
   if(pending.held){
    if(player.localName===pending.source.localName){
     if(!player.dispatchEvent(new this.win.Event('rt-place-held-video',{bubbles:true,cancelable:true}))){
      pending.held=false;
      this.observeAfterMove(pending.source);
      this.clearHandoff();
     }
     return;
    }
    this.releaseHeldVideo();
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
  // Post opened directly (docs/video-control-spec.md): the post's own native video on the tab's first page follows
  // videoDirectOpen until the reader uses its controls. Posts reached in-app or by continuation are never managed.
  directPlayer(){
   if(!this.landing)return null;
   const id=postId(this.win.location.pathname);
   if(id!==this.landing){this.landing='';this.endDirect();return null;}
   if(this.directOpen==='default' || this.direct?.ended || this.pending?.saved?.id===id)return null;
   return [...this.doc.querySelectorAll(`[player-type="${DETAIL_PLAYER}"][post-id="t3_${id}"]:is(${PLAYERS})`)]
    .find(node=>!node.closest('shreddit-comment') && mediaKind(node)!=='gif') || null;
  }
  directState(player){
   const state=this.direct;
   return state && !state.ended && state.player===player && this.landing && this.directPlayer()===player?state:null;
  }
  directManaged(video){const state=this.direct;return Boolean(state && !state.ended && state.mode!=='paused' && state.video===video);}
  endDirect(){
   const state=this.direct;if(!state || state.ended)return;
   state.ended=true;this.win.clearTimeout(state.prepareTimer);this.hideSoundPrompt(state.player);
  }
  applyDirect(){
   const player=this.directPlayer();
   if(!player)return;
   let state=this.direct;
   if(!state || state.player!==player){this.win.clearTimeout(state?.prepareTimer);state=this.direct={player,video:null,mode:this.directOpen,phase:'start',ended:false};}
   this.attach(player);
   const video=this.video(player);
   if(!video)return;
   if(state.video!==video){state.video=video;state.requested=false;state.phase='start';}
   if(state.mode==='paused'){
    if(!video.paused && !this.started.has(video))this.block(player,video);
    return;
   }
   if(!video.paused){this.directPlay(player,video);return;}
   // Like Reddit's own autoplay, a video scrolled out of view (a reload keeps the scroll position) waits until it is seen.
   if(state.requested || this.outsideViewport(player))return;
   if(video.readyState<1){
    // Reddit loads the source itself as it starts; ask its own loader only if nothing has arrived after a moment.
    if(!state.prepareTimer)state.prepareTimer=this.win.setTimeout(()=>{
     if(this.direct===state && !state.ended && state.video?.readyState<1)player.dispatchEvent(new this.win.Event('rt-prepare-detail-video',{bubbles:true}));
    },DIRECT_PREPARE_MS);
    return;
   }
   state.requested=true;
   delete player.dataset.rtAutoplayBlocked;
   video.muted=true;
   this.play(player,video)?.catch?.(()=>{if(this.direct===state)state.requested=false;});
  }
  // A play of the managed video: Stay paused stops anything the reader did not start; the other choices let it run
  // whatever the feed start option says, muted or trying for sound.
  directPlay(player,video){
   const state=this.directState(player);
   if(!state || state.video!==video)return false;
   if(state.mode==='paused'){
    if(this.userStarted(player)){this.endDirect();return false;}
    this.block(player,video);return true;
   }
   delete player.dataset.rtAutoplayBlocked;
   if(state.mode==='muted'){if(!video.muted)video.muted=true;state.phase='playing';}
   else if(state.phase==='start')this.directSound(state);
   this.exclusive(video);
   return true;
  }
  directKeepsMuted(player,video){
   const state=this.directState(player);
   if(!state || state.mode!=='muted' || state.video!==video || video.muted || this.userStarted(player))return false;
   video.muted=true;return true;
  }
  // Before any interaction the browser decides whether sound may play (measured: Chrome pauses a playing video that is
  // unmuted, and refuses an unmuted play()). Try it on the playing video; if refused, play muted and turn the sound on at
  // the first click, tap or key press on the page.
  directSound(state){
   const {player,video}=state;
   if(!this.hasAudio(player,video)){state.phase='playing';return;}
   const policy=this.win.navigator?.getAutoplayPolicy?.(video);
   if(policy==='allowed-muted' || policy==='disallowed'){this.directFallback(state);return;}
   state.phase='trial';
   video.volume=this.targetVolume(video);video.muted=false;
   if(video.paused){this.directFallback(state);return;}
   this.win.setTimeout(()=>{
    if(this.direct!==state || state.phase!=='trial')return;
    if(video.paused || video.muted){this.directFallback(state);return;}
    state.phase='playing';
    // Reddit's own volume state follows, as its sound button does, so its controls show the sound on.
    player.dispatchEvent(new this.win.Event('rt-video-sound',{bubbles:true}));
   },DIRECT_TRIAL_MS);
  }
  directFallback(state){
   if(state.ended || state.phase==='fallback')return;
   state.phase='fallback';
   const {player,video}=state;
   video.muted=true;
   if(video.paused)this.play(player,video)?.catch?.(()=>{});
   if(state.mode==='sound')this.showSoundPrompt(player);
  }
  // Browsers refuse sound until the reader has interacted with the page (a new tab, a typed address, a link from another
  // site). Play with sound then plays muted, and says so the way YouTube does: a button on the player. Its click (like
  // any click or key away from the player) is the interaction that lets the sound on (directGesture).
  showSoundPrompt(target){
   this.hideSoundPrompt();
   const doc=this.doc,win=this.win,button=doc.createElement('button');
   button.type='button';button.dataset.rtUi='direct-sound';button.setAttribute('aria-label','Turn on sound');
   button.innerHTML='<svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M9.2 3.2 5.3 6.6H2.6a.9.9 0 0 0-.9.9v5a.9.9 0 0 0 .9.9h2.7l3.9 3.4a.9.9 0 0 0 1.5-.7V3.9a.9.9 0 0 0-1.5-.7Zm9 4.1-1.3-1.3-2.1 2.2-2.1-2.2-1.3 1.3 2.1 2.2-2.1 2.1 1.3 1.3 2.1-2.1 2.1 2.1 1.3-1.3-2.1-2.1 2.1-2.2Z"/></svg><span>Turn on sound</span>';
   Object.assign(button.style,{position:'fixed',zIndex:'2147482000',display:'inline-flex',alignItems:'center',gap:'6px',height:'32px',padding:'0 12px',border:'0',borderRadius:'999px',
    background:'rgba(0,0,0,.72)',color:'#fff',font:'600 13px/1 system-ui,-apple-system,Segoe UI,Roboto,sans-serif',cursor:'pointer',boxShadow:'0 1px 4px rgba(0,0,0,.3)'});
   const place=()=>{
    if(!target.isConnected){this.hideSoundPrompt();return;}
    const box=target.getBoundingClientRect(),shown=box.height>0 && box.bottom>40 && box.top<win.innerHeight-40;
    button.hidden=!shown;button.style.left=Math.round(box.left+12)+'px';button.style.top=Math.round(Math.max(box.top,0)+12)+'px';
   };
   button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();this.hideSoundPrompt();});
   win.addEventListener('scroll',place,{passive:true,capture:true});win.addEventListener('resize',place,{passive:true});
   (doc.body || doc.documentElement).append(button);place();
   this.soundPrompt={button,target,place};
  }
  hideSoundPrompt(target=null){
   const prompt=this.soundPrompt;if(!prompt || (target && prompt.target!==target))return;
   this.soundPrompt=null;prompt.button.remove();
   this.win.removeEventListener('scroll',prompt.place,{capture:true});this.win.removeEventListener('resize',prompt.place);
  }
  directGesture(event,path){
   const state=this.direct;
   if(!state || state.ended)return;
   if(path.includes(state.player)){this.endDirect();return;}
   if(state.phase!=='fallback' || !(event.type==='click' || event.type==='keydown'))return;
   const activation=this.win.navigator?.userActivation;
   if(activation && !activation.isActive)return;
   const {player,video}=state;
   this.endDirect();
   if(!player.isConnected || video.paused || !video.muted || this.outsideViewport(player))return;
   this.started.add(video);
   this.fadeIn(video,this.targetVolume(video),player);
  }
  // Post opened directly, for the post's own embedded player (docs/video-control-spec.md, Media playback fixes): the
  // same landing as the native video, driven through the page bridge (YouTube), the provider's protocol, or the frame
  // script, until the reader uses that player.
  directEmbedTarget(){
   if(!this.landing || this.directOpen==='default' || this.directEmbed?.ended)return null;
   const id=postId(this.win.location.pathname);
   if(id!==this.landing || this.embedPending || this.pending?.saved?.id===id)return null;
   return [...this.doc.querySelectorAll(ANY_EMBED)].find(embed=>this.isDetailEmbed(embed) && !embed.closest(BLURRED)) || null;
  }
  applyDirectEmbed(fromScroll=false){
   if(!fromScroll)this.directEmbedNone=false;
   const embed=this.directEmbedTarget();if(!embed){if(fromScroll)this.directEmbedNone=true;return;}
   let st=this.directEmbed;
   if(!st || st.embed!==embed){this.endDirectEmbed();st=this.directEmbed={embed,frame:null,mode:this.directOpen,phase:'start',ended:false};}
   if(st.mode==='paused'){this.directEmbedHold(st);return;}
   if(st.phase!=='start' || this.doc.hidden || this.outsideViewport(embed))return;
   // Sound is tried unless the browser says up front that it would refuse (Firefox's getAutoplayPolicy); refused, it
   // plays muted and the sound comes with the first click, tap or key press.
   const policy=this.win.navigator?.getAutoplayPolicy?.('mediaelement');
   const sound=st.mode==='sound' && policy!=='allowed-muted' && policy!=='disallowed';
   if(embed.matches(EMBED)){
    if(!youTubeLite(embed))return;
    embed.dataset.rtStart='0';embed.dataset.rtMuted=String(!sound);
    if(embed.dispatchEvent(new this.win.Event('rt-embed-continue',{bubbles:true,cancelable:true})))return;
   }else{
    const frame=controlFrame(embed,sound?'audible':'muted');if(!frame || frame.dataset.rtParked)return;
    st.frame=frame;
    const state=this.frameState(frame);
    if(state.kind!=='flags' || this.expectDirect(frame)){
     if(state.kind==='playerjs' && !state.readySeen && !state.direct)state.pendingStart={src:frame.getAttribute('src'),sound};
     this.command(frame,sound?'unmute':'mute');this.command(frame,'play');
    }
   }
   st.phase=sound?'trial':st.mode==='sound'?'fallback':'playing';
   if(sound)st.trialTimer=this.win.setTimeout(()=>this.directEmbedCheck(st),EMBED_TRIAL_MS);
  }
  // Stay paused: Reddit does not start a YouTube embed; a frame is told to wait on its first frame, or paused when it
  // reports a start; a player that starts by itself and cannot be driven stays unloaded behind its still until tapped.
  directEmbedHold(st){
   if(st.held)return;
   const embed=st.embed;
   if(embed.matches(EMBED)){st.held=true;return;}
   const frame=controlFrame(embed);if(!frame)return;
   st.frame=frame;st.held=true;
   if(this.expectDirect(frame)){this.command(frame,'pause');return;}
   if(this.frameState(frame).kind==='flags' && !frame.dataset.rtParked)this.park(embed,frame);
  }
  directEmbedCheck(st){
   if(this.directEmbed!==st || st.ended || st.phase!=='trial')return;
   const embed=st.embed;
   if(embed.matches(EMBED)){
    embed.dispatchEvent(new this.win.Event('rt-embed-snapshot',{bubbles:true}));
    if(embed.dataset.rtEmbedState==='playing' && embed.dataset.rtEmbedMuted==='false'){st.phase='playing';return;}
   }else{
    const state=st.frame && this.frames.get(st.frame);
    if(state?.reported==='play' && state.progress?.muted!==true){st.phase='playing';return;}
   }
   this.directEmbedFallback(st);
  }
  directEmbedFallback(st){
   if(st.ended || st.phase==='fallback')return;
   st.phase='fallback';this.win.clearTimeout(st.trialTimer);
   const embed=st.embed;
   if(embed.matches(EMBED)){
    const time=Number(embed.dataset.rtEmbedTime);
    embed.dataset.rtStart=String(Number.isFinite(time) && time>=0?time:0);embed.dataset.rtMuted='true';
    embed.dispatchEvent(new this.win.Event('rt-embed-continue',{bubbles:true,cancelable:true}));
   }else if(st.frame?.isConnected){this.command(st.frame,'mute');this.command(st.frame,'play');}
   if(st.mode==='sound')this.showSoundPrompt(embed);
  }
  directEmbedBlocks(embed,user=false){
   const st=this.directEmbed;
   if(!st || st.ended || st.mode!=='paused' || st.embed!==embed)return false;
   if(user || performance.now()-this.gesture.at<GESTURE_MS && this.gesture.path.includes(embed)){this.endDirectEmbed();return false;}
   return true;
  }
  directEmbedGesture(event,path){
   const st=this.directEmbed;if(!st || st.ended)return;
   if(path.includes(st.embed) || !st.embed.isConnected || postId(this.win.location.pathname)!==this.landing){this.endDirectEmbed();return;}
   if(st.phase!=='fallback' || !(event.type==='click' || event.type==='keydown'))return;
   const activation=this.win.navigator?.userActivation;
   if(activation && !activation.isActive)return;
   this.endDirectEmbed();
   if(this.outsideViewport(st.embed))return;
   if(st.embed.matches(EMBED)){
    st.embed.dispatchEvent(new this.win.Event('rt-embed-snapshot',{bubbles:true}));
    if(st.embed.dataset.rtEmbedState==='playing')st.embed.dispatchEvent(new this.win.Event('rt-embed-sound',{bubbles:true}));
   }else if(st.frame?.isConnected && this.frames.get(st.frame)?.reported!=='pause'){this.command(st.frame,'unmute');this.command(st.frame,'play');}
  }
  endDirectEmbed(){
   const st=this.directEmbed;if(!st || st.ended)return;
   st.ended=true;this.win.clearTimeout(st.trialTimer);this.hideSoundPrompt(st.embed);
  }
  onPlay(player,event){
   const video=event.target;if(!(video instanceof (this.doc.defaultView?.HTMLMediaElement || HTMLMediaElement)))return;
   if(closedThread(player)){video.pause();return;}
   const kind=mediaKind(player);
   if(kind!=='gif')this.applyLoopPolicy(player,video);
   if(this.loops.get(player)===video)return;
   if(this.directPlay(player,video))return;
   if(this.continued.has(video)){this.exclusive(video);return;}
   const preview=this.previews.get(player);
   if(preview?.active && preview.video===video){preview.played=true;this.exclusive(video);return;}
   const userStarted=this.userStarted(player);
   if(kind!=='gif' && !userStarted && this.desiredLoop(video)===false && performance.now()-(this.endedAt.get(player) ?? -Infinity)<200){
    video.pause();return;
   }
   if(userStarted){
    this.started.add(video);this.previews.delete(player);this.away.delete(player);this.miniDismissed.delete(player);
    if(kind!=='gif' && this.volumeMemory && this.savedVolume)this.applySavedVolume(player,video,true);
   }else{
    this.started.delete(video);
    if(this.blocksStart(player,kind)){this.block(player,video);return;}
    if(kind!=='gif' && this.volumeMemory && this.savedVolume)this.applySavedVolume(player,video,false);
   }
   delete player.dataset.rtAutoplayBlocked;
   this.exclusive(video);
  }
  // One video plays at a time (opt-in enhancement): whatever starts pauses the rest (GIFs and held post moves excluded).
  exclusive(source){
   if(!this.singleVideo)return;
   const origin=source.matches?.('video') && commentOf(source)?source:source.getRootNode?.()?.host;
   if(origin?.matches?.(MEDIA_NODES) && mediaKind(origin)==='gif')return;
   for(const embed of this.embedAway)if(embed!==source)this.embedAway.delete(embed);
   for(const player of this.players){
    const video=this.video(player);
    if(!video || video===source || video.paused || mediaKind(player)==='gif' || this.pending?.sourceVideo===video)continue;
    if(this.previews.get(player)?.active && this.hovered===player){this.stopHover();continue;}
    video.pause();
   }
   // Players Reddit inserted since the last scan aren't registered yet but can already be playing.
   for(const player of this.doc.querySelectorAll(PLAYERS)){
    if(this.players.has(player) || mediaKind(player)==='gif')continue;
    const video=this.video(player);
    if(video && video!==source && !video.paused && this.pending?.sourceVideo!==video)video.pause();
   }
   if(this.ePreview && this.ePreview.embed!==source)this.stopEmbed();
   for(const [frame,state] of this.frames)if((state.kind!=='flags' || state.direct) && frame.isConnected &&
     !(this.embedPending?.held && frame===this.embedPending.frame) && embedOfFrame(frame)!==source)this.command(frame,'pause');
   // Feed players that have played go back to their image (only when embedStart is overridden).
   if(this.startMode('embed')!=='default'){
    for(const embed of this.doc.querySelectorAll(ANY_EMBED))if(embed!==source && (embed.dataset.rtEmbedUsed==='1' || youTubeLite(embed)?.querySelector('iframe') || this.frames.get(controlFrame(embed))?.played))this.rest(embed);
   }
   source.dispatchEvent(new this.win.Event('rt-media-exclusive',{bubbles:true,composed:true}));
  }
  // Reddit keeps the page it is leaving on screen until the destination renders, and may keep it detached for Back;
  // its videos and embeds kept playing (and sounding) meanwhile. After a route change, media that doesn't belong to
  // the destination is paused, except a video carried into the post (continue on open) or the mini player.
  queueLeftBehind(){
   for(const timer of this.leftBehindTimers || [])this.win.clearTimeout(timer);
   this.leftBehindTimers=[0,500,1500].map(delay=>this.win.setTimeout(()=>this.pauseLeftBehind(),delay));
  }
  pauseLeftBehind(){
   if(this.dead || !this.active)return;
   const id=postId(this.win.location.pathname),pending=this.activeHandoff();
   const keep=new Set([pending?.source,pending?.sourceVideo,this.mini?.node,this.mini?.slot].filter(Boolean));
   const belongs=node=>{
    if(keep.has(node) || [...keep].some(kept=>kept.contains?.(node) || node.contains?.(kept)))return true;
    if(id){
     const post=node.closest?.('shreddit-post');
     return Boolean(commentOf(node) || post?.id==='t3_'+id || node.getAttribute?.('post-id')==='t3_'+id);
    }
    // A feed: only a post page's own detail media is left behind.
    return node.getAttribute?.('player-type')!==DETAIL_PLAYER && !node.closest?.('shreddit-post[view-context="CommentsPage"]');
   };
   for(const player of this.doc.querySelectorAll(PLAYERS)){
    const video=this.video(player);
    if(!video || video.paused || belongs(player))continue;
    video.pause();
   }
   for(const [frame,state] of this.frames){
    const embed=embedOfFrame(frame);
    if(!frame.isConnected || !embed || belongs(embed))continue;
    if(state.playing && (state.kind!=='flags' || state.direct))this.command(frame,'pause');
   }
   for(const embed of this.doc.querySelectorAll(EMBED))if(embed.dataset.rtEmbedState==='playing' && !belongs(embed))embed.dispatchEvent(new this.win.Event('rt-embed-stop',{bubbles:true}));
  }
  block(player,video){
   if(this.previews.get(player)?.active)return;
   video.pause();player.dataset.rtAutoplayBlocked='true';
  }
  onTime(event){if(this.pending?.sourceVideo===event.target)this.updatePlayback(this.pending);}
  observeAfterMove(player){
   this.manageViewport(player,this.scrollAway!=='default' && this.isDetailMedia(player));
   if(!this.io)return;
   this.visibilityReady.set(player,Infinity);
   this.io.unobserve(player);
   // Discard feed geometry and wait for the relocated player to paint in the post (after its flight, if it flies).
   const observe=()=>this.win.requestAnimationFrame(()=>{
    if(this.dead || !this.active)return;
    this.visibilityReady.set(player,this.win.performance.now());
    if(player.isConnected && this.players.has(player))this.io.observe(player);
   });
   if(player.hasAttribute('data-rt-video-flying'))player.addEventListener('rt-video-placed',observe,{once:true});
   else this.win.requestAnimationFrame(observe);
  }
  onVisibility(entries){
   if(!this.active || this.dead)return;
   const pending=this.activeHandoff();
   // Feed layout settling without a scroll (cards loading in) also picks a phone preview.
   if(this.inView && !this.viewing)this.settle();
   for(const entry of entries){
    const player=entry.target,ready=this.visibilityReady.get(player);
    if(entry.intersectionRatio>0 && this.direct && !this.direct.ended && this.direct.player===player)this.applyDirect();
    if(this.mini && (player===this.mini.slot || player===this.mini.node && !this.mini.slot)){
     if(entry.intersectionRatio>=0.5)this.exitMini(false);
     continue;
    }
    if(this.feedSoundEmbeds.has(player)){
     if(entry.intersectionRatio===0){
      if(player.matches(EMBED))player.dispatchEvent(new this.win.Event('rt-embed-stop',{bubbles:true}));
      else{const frame=controlFrame(player);if(frame)this.command(frame,'pause');}
      this.rest(player,true);
     }
     continue;
    }
    if(this.detailEmbeds.has(player)){this.onEmbedVisibility(player,entry.intersectionRatio);continue;}
    if(this.feedEmbeds.has(player)){if(entry.intersectionRatio>0)this.paintPoster(player);continue;}
    if((ready!==undefined && !(entry.time>=ready)) || (player===pending?.source && (pending.held || pending.reached)))continue;
    // A post's own video pauses or floats once fully out of view and resumes/docks when half is back;
    // a feed video pauses when less than half of it is on screen and stays paused.
    const detail=player.getAttribute('player-type')===DETAIL_PLAYER || Boolean(commentOf(player)),ratio=entry.intersectionRatio;
    if(ratio<0.5 && this.loops.has(player))this.stopLoop(player);
    const away=this.away.get(player);
    if(away)away.visible=ratio>=0.5;
    if(ratio>=0.5){if(detail)this.resumeAway(player);continue;}
    if(detail && ratio>0)continue;
    if(player===this.hovered)this.stopHover();
    if(this.scrollAway==='default')continue;
    const video=this.video(player);
    if(!video || video.paused || video.ended)continue;
    if(this.scrollAway==='mini' && detail && !commentOf(player) && mediaKind(player)!=='gif' && !this.mini && !this.miniDismissed.has(player)){
     if(!player.dispatchEvent(new this.win.Event('rt-mini-enter',{bubbles:true,cancelable:true}))){
      const slot=this.doc.querySelector('[data-rt-mini-slot]');
      this.mini={node:player,slot};
      if(slot)this.io?.observe(slot);
      continue;
     }
    }
    if(this.pauseAway || this.scrollAway==='mini' && !this.miniDismissed.has(player) && !this.mini){
     video.pause();player.dataset.rtPausedAway='true';
     if(detail)this.away.set(player,{video,time:video.currentTime,visible:false});
    }
   }
  }
  resumeAway(player){
   const away=this.away.get(player),video=this.video(player);
   if(!away || this.scrollAway==='default' || this.doc.hidden || closedThread(player)){this.away.delete(player);return;}
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
   if(this.scrollAway==='default' || !this.isDetailEmbed(embed) || this.doc.hidden)return;
   const youtube=embed.matches(EMBED),frame=youtube?null:controlFrame(embed);
   if(ratio>=0.5){
    if(this.mini?.node===embed){this.exitMini(false);return;}
    if(!this.embedAway.delete(embed))return;
    if(youtube)embed.dispatchEvent(new this.win.Event('rt-embed-return',{bubbles:true}));
    else if(frame)this.command(frame,'play');
    return;
   }
   if(ratio>0 || this.embedAway.has(embed))return;
   let playing=false;
   if(youtube){
    embed.dispatchEvent(new this.win.Event('rt-embed-snapshot',{bubbles:true}));
    playing=embed.dataset.rtEmbedState==='playing';
   }else if(frame){
    playing=Boolean(this.frames.get(frame)?.playing);
   }
   if(this.scrollAway==='mini' && playing && !this.mini && !this.miniDismissed.has(embed)){
    if(!embed.dispatchEvent(new this.win.Event('rt-mini-enter',{bubbles:true,cancelable:true}))){
     this.mini={node:embed,slot:null};
     return;
    }
    // Firefox / no moveBefore: gracefully fall back to pause & resume.
   }
   if(youtube){
    const state=embed.dataset.rtEmbedState;
    if(state==='playing')this.embedAway.add(embed);
    if(state!=='paused')embed.dispatchEvent(new this.win.Event('rt-embed-offscreen',{bubbles:true}));
   }else if(frame && playing){
    if(this.command(frame,'pause'))this.embedAway.add(embed);
   }
  }
  settle(){
   this.win.clearTimeout(this.settleTimer);this.win.clearTimeout(this.dwellTimer);
   const modes=kinds.map(kind=>this.startMode(kind));
   if(modes.includes('autoplay'))this.settleTimer=this.win.setTimeout(()=>this.pickInView(false),AUTOPLAY_MS);
   if(this.touch && modes.includes('preview'))this.dwellTimer=this.win.setTimeout(()=>this.pickInView(true),DWELL_MS);
  }
  // After scrolling stops, the feed video at least 60 % visible and nearest the middle of the screen previews, one at a
  // time; a playing preview keeps going while it stays at least half on screen.
  pickInView(settled=true){
   if(this.dead || !this.active || this.doc.hidden || this.pending?.held || this.embedPending?.held)return;
   // Once the viewer has taken over an embed, a nearby automatic preview cannot steal playback or its controls.
   if([...this.feedSoundEmbeds].some(embed=>embed.isConnected && this.feedEmbed(embed) && !this.outsideViewport(embed)))return;
   const height=this.win.innerHeight,middle=height/2;let best=null,distance=Infinity;
   const candidates=[...this.players].filter(player=>this.previewable(player))
    .concat([...this.doc.querySelectorAll(ANY_EMBED)].filter(embed=>this.feedEmbed(embed)));
   for(const node of candidates){
    const kind=mediaKind(node),mode=this.startMode(kind);
    if(!node.isConnected || !viewMode(mode,this.touch) || (mode==='preview' && !settled))continue;
    if(kind==='embed' && node.dataset.rtEmbedUsed==='1')continue;
    const box=node.getBoundingClientRect();if(!(box.height>0))continue;
    const shown=(Math.min(box.top+box.height,height)-Math.max(box.top,0))/box.height,gap=Math.abs(box.top+box.height/2-middle);
    if(kind==='gif'){
     if(shown>=IN_VIEW)this.startLoop(node);else if(shown<0.5)this.stopLoop(node);
     continue;
    }
    if(shown>=IN_VIEW && gap<distance){best=node;distance=gap;}
   }
   if(best && (best===this.hovered && this.previews.get(best)?.active || best===this.ePreview?.embed))return;
   if(this.hovered && !this.viewing || this.ePreview && !this.ePreview.view)return;
   if(!settled && this.startMode(mediaKind(this.hovered || this.ePreview?.embed))==='preview' && (this.viewing || this.ePreview?.view))return;
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
   for(const timer of this.leftBehindTimers || [])this.win.clearTimeout(timer);this.hideSoundPrompt();this.dead=true;
   this.deactivate();
   this.doc.documentElement?.removeAttribute?.('data-rt-embed-override');
   this.doc.documentElement?.removeAttribute?.('data-rt-stream-quality');
  }
 }
 globalThis.RTVideoControl=Object.freeze({Videos,readAutoplayDisabled});
 if(globalThis.chrome?.runtime?.id && !globalThis.__rtVideoControlTest){
  const read=async()=>{const r=await chrome.runtime.sendMessage({scope:'rt-posts',action:'get-settings'});return r?.ok?r.settings:{};};
  const direct=()=>chrome.runtime.sendMessage({scope:'rt-embed-direct'}).then(value=>value,()=>false);
  const videos=new Videos({readSettings:read,readDirect:direct});
  chrome.runtime.onMessage.addListener((message,sender)=>{if(message?.scope==='rt-posts' && message.action==='settings-changed' && sender?.id===chrome.runtime.id){videos.refreshDirect();videos.configure(message.settings);};});
  // Visiting Reddit's own settings re-reads the preference next time.
  if(/^\/settings\//.test(location.pathname))try{sessionStorage.removeItem(PREF_KEY);}catch{}
 }
})();
