/* Reddit reads. Authentication and private page HTML stay in Reddit's page world. */
(() => {
  'use strict';
  if(window.top!==window || !globalThis.RTPostModel)return;
  // Window size reads. Reddit's analytics reads innerWidth/innerHeight for every post that comes into view, and each
  // read forces a full layout of the page (measured on a phone feed 2026-11-19: 3–10 s of 45 s of scrolling). While
  // smooth scrolling is on (html[data-rt-smooth-site], set by smooth-scroll.js) they answer from a value read once
  // and refreshed on every resize; with a cache, Reddit's script time fell by about a third and frames rose 2.1 → 3.2/s.
  const fastPage=()=>Boolean(document.documentElement?.hasAttribute('data-rt-smooth-site'));
  (()=>{
    const keys=['innerWidth','innerHeight'],real={};
    for(const key of keys){const d=Object.getOwnPropertyDescriptor(window,key);if(!d?.get || !d.configurable)return;real[key]=d;}
    const cache={};let stale=true;
    const on=fastPage;
    addEventListener('resize',()=>{stale=true;},true);window.visualViewport?.addEventListener?.('resize',()=>{stale=true;});
    for(const key of keys)Object.defineProperty(window,key,{configurable:true,enumerable:real[key].enumerable,
      get(){if(!on())return real[key].get.call(window);if(stale){for(const k of keys)cache[k]=real[k].get.call(window);stale=false;}return cache[key];},
      set:real[key].set?function(value){real[key].set.call(window,value);}:undefined});
  })();
  // Reddit's ad viewability tracker reads --shreddit-header-height from shreddit-app's computed style for every ad post
  // it sets up (also ads a type filter hides); each read forces a style recalculation of the whole page (2.8 s of 46 s,
  // phone feed 2026-11-19). While smooth scrolling is on, that one property of that one element answers from a value
  // re-read at most once a second; every other read goes to the real style.
  (()=>{
    const real=window.getComputedStyle;if(typeof real!=='function')return;
    let header={value:null,at:-Infinity};
    window.getComputedStyle=function(element,pseudo){
      const style=real.call(window,element,pseudo);
      if(pseudo || element?.localName!=='shreddit-app' || !fastPage())return style;
      return new Proxy(style,{get(target,prop){
        if(prop==='getPropertyValue')return name=>{
          if(name!=='--shreddit-header-height')return target.getPropertyValue(name);
          const now=performance.now();if(header.value===null || now-header.at>1000)header={value:target.getPropertyValue(name),at:now};
          return header.value;
        };
        const value=Reflect.get(target,prop,target);return typeof value==='function'?value.bind(target):value;
      }});
    };
  })();
  // The signed-out transport holds one read and one queued; a third is refused
  // as busy. Wait for a free slot instead of failing a page of activity.
  async function publicBrowserRead(url,signal,refresh=false){
    if(!globalThis.RTPublicBrowser)throw Error('Reddit blocked logged-out search (HTTP 403).');
    while(true){
      try{return await RTPublicBrowser.read(url,{signal,refresh});}
      catch(error){
        if(signal?.aborted || !/busy/i.test(error?.message || ''))throw error;
        await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{signal?.removeEventListener('abort',stop);resolve();},200),stop=()=>{clearTimeout(timer);reject(Error('Post request cancelled.'));};signal?.addEventListener('abort',stop,{once:true});});
      }
    }
  }
  // A blocked profile remounts when Reddit swaps in its own page for the same
  // route; its identical request joins the listing read already in flight rather
  // than cancelling it and starting over. Results are never kept once settled.
  const blockedReads=new Map(),blockedReadGraceMs=1500;
  function sharedBlockedRead(url,signal,refresh=false){
    let entry=!refresh && blockedReads.get(url);
    if(!entry){
      const controller=new AbortController();
      entry={controller,consumers:0,timer:0,settled:false};
      entry.promise=publicBrowserRead(url,controller.signal,refresh).finally(()=>{entry.settled=true;clearTimeout(entry.timer);if(blockedReads.get(url)===entry)blockedReads.delete(url);});
      entry.promise.catch(()=>{});blockedReads.set(url,entry);
    }
    entry.consumers++;clearTimeout(entry.timer);
    return waitNative(entry.promise,signal,()=>{
      entry.consumers--;
      if(!entry.consumers && !entry.settled)entry.timer=setTimeout(()=>{if(entry.consumers || entry.settled)return;entry.controller.abort();if(blockedReads.get(url)===entry)blockedReads.delete(url);},blockedReadGraceMs);
    });
  }
  // Bound simultaneous work and honor server cooldowns; cursor-driven scrolling
  // must not stall behind an unrelated lifetime or rolling card-count quota.
  const M=RTPostModel,jobs=new Map(),rendererWaits=new WeakMap(),navigationReads=new Map(),controlReads=new Map(),emptySearchReads=new Map(),statusReads=new Map(),nativeCardReads=new Map();let active=0,cardActive=0,postCardActive=0,cooldown=0;
  // The page a read belongs to. The extension's own rt_* filter params (written with replaceState) are not
  // navigation, so changing a filter must not abort reads already in flight ("Page changed. Try again.").
  function pageKey(){const params=new URLSearchParams(location.search);for(const key of [...params.keys()])if(key.startsWith('rt_') && key!=='rt_list')params.delete(key);const rest=params.toString();return location.pathname+(rest?'?'+rest:'');}
  function route(){
    const profile=location.pathname.match(/^\/user\/([\w-]{1,20})(?:\/(?:submitted|comments|search|saved|history|hidden|upvoted|downvoted))?\/?$/i);
    const post=location.pathname.match(/^\/(?:r\/[^/]+\/|user\/[^/]+\/)?comments\/([a-z0-9]{1,10})(?:\/.*)?$/i);
    return profile?{username:profile[1]}:post?{id:post[1].toLowerCase()}:null;
  }
  const videoPlayers='shreddit-player,shreddit-player-2',FLIGHT_MS=220;
  const coveredMedia=node=>node.closest('shreddit-blurred-container[blurred]');
  let heldVideo,heldEmbed=null;
  // While a video or YouTube player waits at its card and moves into its post, the page says so, so that nothing
  // hides the outgoing feed behind it (a filtered feed otherwise conceals itself during post navigation).
  const markMove=()=>document.documentElement.toggleAttribute('data-rt-media-moving',Boolean(heldVideo || heldEmbed));
  function movePlayer(parent,player,before=null){
    if(parent.moveBefore)parent.moveBefore(player,before);
    else parent.insertBefore(player,before);
  }
  function moveEmbedFrame(parent,frame,before=null){
    // Chromium can keep the old iframe layout after a state-preserving move between shadow roots.
    // Clear that layout before moving so the same browsing context paints in the destination slot.
    const style=frame.getAttribute('style');
    frame.style.setProperty('display','none','important');
    frame.getBoundingClientRect();
    try{movePlayer(parent,frame,before);}
    finally{
      if(style===null)frame.removeAttribute('style');
      else frame.setAttribute('style',style);
    }
  }
  // Stage held media in document coordinates (position: absolute) so scrolling stays 100 % free and the compositor
  // scrolls the stage in pixel lockstep with its feed card. When Reddit hides the feed or resets scrollY for the post
  // swap, pin the stage to its last on-screen viewport rect until placement; user scrolling while pinned conceals it
  // (never floating as a detached overlay, never pausing playback).
  const onScreen=box=>Boolean(box && box.width && box.height && box.top+box.height>0 && box.top<(window.innerHeight || 800));
  function createStage(rect,corner){
    const stage=document.createElement('div');
    stage.setAttribute('aria-hidden','true');
    const sx=window.scrollX || 0,sy=window.scrollY || 0;
    const bodyPos=getComputedStyle(document.body).position;
    const origin=bodyPos && bodyPos!=='static'?document.body.getBoundingClientRect():{left:-sx,top:-sy};
    Object.assign(stage.style,{
      position:'absolute',zIndex:'3',pointerEvents:'none',overflow:'hidden',
      left:(rect.left-origin.left)+'px',top:(rect.top-origin.top)+'px',
      width:rect.width+'px',height:rect.height+'px',borderRadius:corner+'px'
    });
    document.body.append(stage);
    return stage;
  }
  let userScrollAt=-Infinity;
  const noteUserScroll=()=>{if(heldVideo || heldEmbed)userScrollAt=performance.now();};
  for(const type of ['wheel','touchmove','pointerdown'])addEventListener(type,noteUserScroll,{capture:true,passive:true});
  addEventListener('keydown',event=>{
    if((heldVideo || heldEmbed) && [' ','PageDown','PageUp','Home','End','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key))noteUserScroll();
  },{capture:true,passive:true});
  function concealHeldMedia(){
    const held=heldVideo || heldEmbed;
    if(!held)return;
    held.concealed=true;
    held.stage.style.visibility='hidden';
  }
  function pinStage(held){
    if(held.pinned || held.concealed)return;
    held.pinned=true;
    if(!onScreen(held.rect)){concealHeldMedia();return;}
    Object.assign(held.stage.style,{position:'fixed',left:held.rect.left+'px',top:held.rect.top+'px',width:held.rect.width+'px',height:held.rect.height+'px'});
  }
  function syncHeldStage(){
    const held=heldVideo || heldEmbed;
    if(!held || held.concealed)return;
    const recentUser=performance.now()-userScrollAt<160;
    if(held.pinned){if(recentUser)concealHeldMedia();return;}
    const anchor=held.slot || held.lite || held.vimeo || held.embed;
    const box=anchor?.isConnected?anchor.getBoundingClientRect():null;
    const visible=Boolean(box && box.width && box.height);
    if(!visible || (route()?.id && (window.scrollY || 0)===0 && !recentUser && held.scrollY>0)){
      pinStage(held);
      return;
    }
    held.scrollY=window.scrollY || 0;
    held.rect={left:box.left,top:box.top,width:box.width,height:box.height};
  }
  function flightOrigin(held){
    if(held.concealed)return null;
    let from=held.rect;
    if(!held.pinned){
      const live=held.stage.getBoundingClientRect();
      if(live.width && live.height)from={left:live.left,top:live.top,width:live.width,height:live.height};
    }
    return onScreen(from)?from:null;
  }
  function unclipDuringFlight(node,box){
    const saved=[];
    const save=(el,prop,val)=>{
      saved.push([el,prop,el.style.getPropertyValue(prop),el.style.getPropertyPriority(prop)]);
      el.style.setProperty(prop,val);
    };
    if(getComputedStyle(node).position==='static')save(node,'position','relative');
    save(node,'z-index','3');
    for(let el=node.parentElement || node.getRootNode?.()?.host,depth=0;el?.nodeType===1 && depth<8;depth++){
      if(el.matches('shreddit-post'))break;
      const style=getComputedStyle(el);
      if(/hidden|clip/.test(style.overflow+' '+style.overflowX+' '+style.overflowY)){
        const b=el.getBoundingClientRect();
        if(!b.width || !b.height || (Math.abs(b.width-box.width)<=4 && Math.abs(b.height-box.height)<=4))save(el,'overflow','visible');
      }
      el=el.parentElement || el.getRootNode?.()?.host || null;
    }
    return ()=>{
      for(const [el,prop,val,prio] of saved){
        if(val)el.style.setProperty(prop,val,prio);
        else el.style.removeProperty(prop);
      }
    };
  }
  addEventListener('scroll',syncHeldStage,{capture:true,passive:true});
  document.addEventListener('rt-conceal-held-media',concealHeldMedia);
  // The move is over: video-control starts watching visibility again.
  function landed(player){
    player.removeAttribute('data-rt-video-flying');
    player.dispatchEvent(new Event('rt-video-placed'));
  }
  function releaseVideo(){
    if(!heldVideo)return;
    const {player,slot,stage,controller,restorePause}=heldVideo;
    heldVideo=null;markMove();
    restorePause();
    if(slot.isConnected)movePlayer(slot.parentNode,player,slot);
    slot.remove();
    controller.endDomReparent();
    stage.remove();
  }
  // Reddit rounds a media box's corners on the element that clips it: the player itself or a wrapper of the same size
  // (read from its computed style, not assumed). The moving player keeps the feed's corners and lands with the post's.
  function cornerOf(node){
    const box=node.getBoundingClientRect();
    for(let el=node,depth=0;el?.nodeType===1 && depth<8;depth++){
      if(el.matches('shreddit-post'))break;
      const style=getComputedStyle(el),radius=parseFloat(style.borderTopLeftRadius) || 0;
      if(radius>0 && (el===node || /hidden|clip/.test(style.overflow+' '+style.overflowX))){
        const b=el.getBoundingClientRect();
        if(Math.abs(b.width-box.width)<=2 && Math.abs(b.height-box.height)<=2)return radius;
      }
      el=el.parentElement || el.getRootNode?.()?.host || null;
    }
    return 0;
  }
  // A clip in the moving element's own (unscaled) units: shown at `scale`, its corners look `radius` px round.
  const roundClip=(insetY,insetX,radius,scale=1)=>`inset(${insetY}px ${insetX}px${radius>0?` round ${radius/scale}px`:''})`;
  // The picture inside a box (Reddit's video is object-fit: contain).
  function picture(box,aspect){
    if(!(aspect>0))return box;
    const width=Math.min(box.width,box.height*aspect),height=width/aspect;
    return {width,height};
  }
  // Shared-element move: the held player takes Reddit's detail slot at once, then its picture travels from where it
  // was in the feed card to the slot (220 ms, ease-out). Transform runs on the compositor, so Reddit rendering the post
  // cannot stall it; one uniform scale keeps the picture undistorted, and a clip shows only the feed card's box at the
  // start. No clamps; reduced motion skips it.
  // Reddit's reparent window stays open until the move ends: its autoplay observer otherwise pauses the player while
  // the moving picture is partly outside the viewport (measured 2026-11-19).
  function moveIntoSlot(player,from,controller,corners={}){
    const video=player.shadowRoot?.querySelector('video'),to=player.getBoundingClientRect(),end=()=>controller.endDomReparent();
    if(!from || typeof player.animate!=='function' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ||
       !to.width || !to.height){end();return;}
    const aspect=video?.videoWidth/video?.videoHeight,a=picture(from,aspect),b=picture(to,aspect);
    const scale=aspect>0?a.width/b.width:Math.min(from.width/to.width,from.height/to.height);
    const x=from.left+from.width/2-to.left-to.width/2,y=from.top+from.height/2-to.top-to.height/2;
    if(Math.abs(x)<1 && Math.abs(y)<1 && Math.abs(scale-1)<.01){end();return;}
    const insetX=Math.max(0,(to.width-from.width/scale)/2),insetY=Math.max(0,(to.height-from.height/scale)/2);
    const timing={duration:FLIGHT_MS,easing:'cubic-bezier(.2,.8,.2,1)'};
    const restoreClip=unclipDuringFlight(player,to);
    player.setAttribute('data-rt-video-flying','');
    const motion=player.animate([{transform:`translate(${x}px,${y}px) scale(${scale})`},{transform:'none'}],timing);
    motion.id='rt-video-placement';
    player.animate([{clipPath:roundClip(insetY,insetX,corners.from,scale)},{clipPath:roundClip(0,0,corners.to)}],timing);
    const done=()=>{restoreClip();end();landed(player);};
    Promise.resolve(motion.finished).then(done,done);
  }
  document.addEventListener('rt-hold-feed-video',event=>{
    const player=event.target,id=player.getAttribute?.('post-id'),controller=player.mediaFbpController;
    const video=player.shadowRoot?.querySelector('video');
    if(heldVideo || !player.matches?.(videoPlayers) || player.getAttribute('player-type')!=='in_feed_player' ||
       !id || player.closest('shreddit-post')?.id!==id || !video || video.paused || video.ended ||
       typeof controller?.beginDomReparent!=='function' || typeof controller.endDomReparent!=='function' ||
       controller.shouldPreserveMedia?.() || typeof player.pause!=='function' || coveredMedia(player))return;
    const {left,top,width,height}=player.getBoundingClientRect();
    if(!width || !height || !document.body || heldEmbed)return;
    // The feed stays on screen as Reddit leaves it; the video stays glued to its card in document coordinates so
    // scrolling remains 100 % free until the post is laid out.
    const rect={left,top,width,height},corner=cornerOf(player);
    const slot=document.createElement('div');
    slot.setAttribute('aria-hidden','true');
    slot.style.height=height+'px';
    player.before(slot);
    const stage=createStage(rect,corner);
    const pause=player.pause,ownPause=Object.hasOwn(player,'pause');
    function preserveNavigation(reason,...args){
      // Reddit calls the background pause for both route changes and actual tab visibility.
      if(reason==='background' && document.visibilityState==='visible')return;
      return pause.call(this,reason,...args);
    }
    player.pause=preserveNavigation;
    const restorePause=()=>{
      if(player.pause!==preserveNavigation)return;
      if(ownPause)player.pause=pause;
      else delete player.pause;
    };
    controller.beginDomReparent();
    movePlayer(stage,player);
    heldVideo={player,id,slot,stage,controller,restorePause,rect,corner,scrollY:window.scrollY || 0,pinned:false,concealed:false};markMove();
    event.preventDefault();
  });
  document.addEventListener('rt-place-held-video',event=>{
    const detail=event.target,id=route()?.id;
    if(!heldVideo || !id || heldVideo.id!=='t3_'+id || !detail.matches?.(videoPlayers) ||
       detail.getAttribute('player-type')!=='post_detail_screen' || detail.getAttribute('post-id')!==heldVideo.id ||
       detail.closest('shreddit-post')?.id!==heldVideo.id || detail.closest('shreddit-comment') ||
       detail.localName!==heldVideo.player.localName || !heldVideo.player.isConnected || coveredMedia(detail) ||
       detail.checkVisibility?.({visibilityProperty:true})===false)return;
    const held=heldVideo,from=flightOrigin(held),{player,slot,stage,controller,restorePause,corner}=held,landing=cornerOf(detail);
    heldVideo=null;markMove();
    // A post player re-applies Reddit's session sound state when the move ends (and mutes autoplay without one); a
    // video playing with sound keeps it.
    const video=player.shadowRoot?.querySelector('video');
    if(video && !video.muted && video.volume>0 && !player.forceMuted)player.volumeController?.setVolume?.(Math.sqrt(video.volume));
    // Keep a fresh feed player in Reddit's cached card for Back navigation.
    slot.replaceWith(player.cloneNode(true));
    for(const name of ['class','style','slot','player-type','data-post-click-location','priority','is-mobile','hide-autoplay-toggle']){
      const value=detail.getAttribute(name);
      if(value===null)player.removeAttribute(name);
      else if(player.getAttribute(name)!==value)player.setAttribute(name,value);
    }
    movePlayer(detail.parentNode,player,detail);
    detail.remove();
    restorePause();
    stage.remove();
    moveIntoSlot(player,from,controller,{from:corner,to:landing});
    event.preventDefault();
  });
  // Our plays go through Reddit's player, which keeps its controls, poster and session in step with the video.
  document.addEventListener('rt-play-video',event=>{
    const player=event.target;
    if(!player.matches?.(videoPlayers) || typeof player.play!=='function' || !player.mediaActionsController)return;
    // Reddit's play() refuses (pauses) until its own visibility observer has seen the player; play directly then.
    if(player.mediaVisibilityController?.isVideoInView?.()===false && !player.playOutOfViewport)return;
    event.preventDefault();
    Promise.resolve(player.play()).catch(()=>{});
  });
  const viewportOverrides=new WeakMap();
  const detailEmbed=node=>{
    const id=route()?.id;
    return id && node.matches?.('shreddit-embed') && node.closest('shreddit-post')?.id==='t3_'+id && !node.closest('shreddit-feed,shreddit-comment');
  };
  // Raw feed embeds use Reddit's loader at the viewport edge only when embed overrides are active.
  function limitFeedEmbedLoad(){
    const proto=customElements.get('shreddit-embed')?.prototype,setup=proto?.setupLoadObserver;
    if(typeof setup!=='function' || typeof IntersectionObserver!=='function')return;
    proto.setupLoadObserver=function(...args){
      const provider=this.getAttribute('providername') || '';
      if(!document.documentElement?.hasAttribute('data-rt-embed-override') || detailEmbed(this) || !this.closest('shreddit-post[id]') || /^(?:YouTube|Vimeo|TikTok)$/i.test(provider) ||
         typeof this.loadObserverIntersectionCallback!=='function')return setup.apply(this,args);
      this.loadObserver=new IntersectionObserver(this.loadObserverIntersectionCallback,{rootMargin:'0px'});
      this.loadObserver.observe(this);
    };
  }
  if(customElements.get('shreddit-embed'))limitFeedEmbedLoad();
  else customElements.whenDefined('shreddit-embed').then(limitFeedEmbedLoad);
  function preserveEmbedPlayback(node,allowBackgroundPause=false){
    if(typeof node.pausePlayback!=='function')return ()=>{};
    const previous=node.pausePlayback,own=Object.hasOwn(node,'pausePlayback');
    const skip=function(...args){if(allowBackgroundPause && document.hidden)return previous.apply(this,args);};
    node.pausePlayback=skip;
    return ()=>{if(node.pausePlayback===skip){if(own)node.pausePlayback=previous;else delete node.pausePlayback;}};
  }
  // Let the content script apply the reader's full-offscreen policy before native visibility pauses the same player.
  document.addEventListener('rt-manage-media-viewport',event=>{
    const node=event.target;
    if(viewportOverrides.has(node)){event.preventDefault();return;}
    if(detailEmbed(node) && typeof node.pausePlayback==='function'){
      viewportOverrides.set(node,preserveEmbedPlayback(node));
    }else{
      const id=route()?.id,comment=node.closest?.('shreddit-comment');
      if(!id || !node.matches?.(videoPlayers) || typeof node.playOutOfViewport!=='boolean' ||
         (comment?comment.getAttribute('postid')!=='t3_'+id:node.getAttribute('player-type')!=='post_detail_screen' || node.getAttribute('post-id')!=='t3_'+id))return;
      const old=node.playOutOfViewport;
      node.playOutOfViewport=true;
      viewportOverrides.set(node,()=>{node.playOutOfViewport=old;});
    }
    event.preventDefault();
  });
  document.addEventListener('rt-restore-media-viewport',event=>{
    const node=event.target,restore=viewportOverrides.get(node);
    restore?.();viewportOverrides.delete(node);
  });
  // YouTube embeds: Reddit renders lite-youtube with its YouTube player API (js-api) inside shreddit-embed. Previews,
  // sound and continuation use that player; nothing is fetched beyond what Reddit's own activation loads.
  const ytPlayers=new WeakMap(),youTubeEmbed='shreddit-embed[providername="YouTube"]';
  const liteOf=embed=>embed?.matches?.(youTubeEmbed) && typeof embed.liteYoutubeElement?.activate==='function' ? embed.liteYoutubeElement : null;
  const pendingYouTube=new WeakMap();
  function youTubePlayer(embed,params={}){
    if(pendingYouTube.has(embed))return pendingYouTube.get(embed);
    const request=(async()=>{
      const lite=liteOf(embed);if(!lite)return null;
      if(!lite.classList.contains('lyt-activated')){
        const own=new URLSearchParams(lite.getAttribute('params') || '');
        for(const [key,value] of Object.entries(params))own.set(key,value);
        lite.setAttribute('params',own.toString());
        embed.hasActivatedYouTubePlayer=true;
        await lite.activate();
      }
      const player=await lite.getYTPlayer?.();
      if(player)followYouTube(embed,player);
      return player || null;
    })();
    pendingYouTube.set(embed,request);
    const cleanup=()=>pendingYouTube.delete(embed);
    request.then(cleanup,cleanup);
    return request;
  }
  // Each followed YouTube player reports when it starts playing, so the content script keeps one video playing; and
  // pauses when something else starts.
  const playingEmbeds=new RTPostModel.WeakElementMap(),playerEmbeds=new WeakMap();
  function followYouTube(embed,player){
    ytPlayers.set(embed,player);playingEmbeds.set(embed,true);
    const watched=playerEmbeds.has(player);playerEmbeds.set(player,embed);
    if(watched || typeof player.addEventListener!=='function')return;
    player.addEventListener('onStateChange',change=>{
      const active=playerEmbeds.get(player);
      if(change?.data===1 && ytPlayers.get(active)===player)active.dispatchEvent(new Event('rt-embed-playing',{bubbles:true}));
    });
  }
  document.addEventListener('rt-media-exclusive',event=>{
    const path=event.composedPath();
    for(const [embed] of playingEmbeds){
      if(!embed.isConnected){playingEmbeds.delete(embed);continue;}
      if(path.includes(embed) || heldEmbed?.embed===embed)continue;
      try{const player=ytPlayers.get(embed),state=player?.getPlayerState?.();if(state===1 || state===3)player.pauseVideo();}catch{}
    }
  });
  const youTubeCall=(embed,run)=>Promise.resolve(ytPlayers.get(embed) || null).then(player=>player && run(player)).catch(()=>{});
  // A YouTube video the user starts with its own play button is followed too, so opening its post continues it.
  document.addEventListener('click',event=>{
    const embed=event.composedPath().find(node=>node.matches?.(youTubeEmbed)),lite=liteOf(embed);
    if(lite)setTimeout(()=>{if(lite.classList.contains('lyt-activated'))Promise.resolve(lite.getYTPlayer()).then(player=>{if(player){followYouTube(embed,player);if(player.getPlayerState?.()===1)embed.dispatchEvent(new Event('rt-embed-playing',{bubbles:true}));}},()=>{});},0);
  },true);
  document.addEventListener('rt-embed-preview',event=>{
    const embed=event.target;if(!liteOf(embed))return;
    event.preventDefault();
    youTubePlayer(embed,{mute:'1'}).then(player=>{if(embed.dataset.rtEmbedPreview!=='on')return;player?.mute();player?.playVideo();},()=>{});
  });
  document.addEventListener('rt-embed-use-muted',event=>{
    const embed=event.target;
    if(ytPlayers.has(embed))return;
    pendingYouTube.get(embed)?.then(player=>{
      if(embed.isConnected && embed.dataset.rtEmbedUsed==='1'){player?.mute();player?.playVideo();}
    }).catch(()=>{});
  });
  // End of a preview: pause where it is and restore sound for the user's own play button.
  document.addEventListener('rt-embed-stop',event=>youTubeCall(event.target,player=>{player.pauseVideo();player.unMute();}));
  document.addEventListener('rt-embed-offscreen',event=>{
    const embed=event.target;
    if(!detailEmbed(embed) || !embed.matches(youTubeEmbed))return;
    const player=ytPlayers.get(embed);
    if(player)player.pauseVideo();else embed.pauseYouTubePlayback?.();
  });
  document.addEventListener('rt-embed-return',event=>{
    if(detailEmbed(event.target))youTubeCall(event.target,player=>player.playVideo());
  });
  const soundFades=new WeakMap();
  function playYouTubeWithSound(player){
    if(!player)return;
    const previous=soundFades.get(player);
    if(previous){player.unMute();player.playVideo();return;}
    const target=player.getVolume?.() || 50,begin=performance.now();
    soundFades.set(player,true);
    player.setVolume(0);player.unMute();player.playVideo();
    const step=()=>{const t=Math.min(1,(performance.now()-begin)/200);player.setVolume(Math.round(target*t));if(t<1)setTimeout(step,16);else soundFades.delete(player);};
    step();
  }
  document.addEventListener('rt-embed-sound',event=>{
    const embed=event.target,player=ytPlayers.get(embed);
    if(player){try{playYouTubeWithSound(player);}catch{}return;}
    pendingYouTube.get(embed)?.then(ready=>{if(embed.isConnected)playYouTubeWithSound(ready);}).catch(()=>{});
  });
  // Move the browsing context itself, so providers can keep playing even after Reddit removes the feed.
  // Other providers (Streamable, Twitch, Dailymotion, …): Reddit renders their oEmbed iframe directly in the embed.
  const rawFrame=embed=>{const frame=embed?.shadowRoot?.querySelector?.('iframe');return frame && !frame.closest('lite-youtube,lite-vimeo')?frame:null;};
  // Vimeo: Reddit's lite-vimeo makes its player inside its own shadow root once started.
  const vimeoLite=embed=>embed?.shadowRoot?.querySelector?.('lite-vimeo') || null;
  const playerFrame=embed=>rawFrame(embed) || vimeoLite(embed)?.shadowRoot?.querySelector?.('iframe') || null;
  function releaseEmbed(){
    const held=heldEmbed;if(!held)return;
    heldEmbed=null;markMove();held.restorePause();
    if(held.slot?.isConnected){moveEmbedFrame(held.slot.parentNode,held.ifr,held.slot);restoreStyle(held.ifr,held.style);}
    else if(held.home?.isConnected){moveEmbedFrame(held.home,held.ifr,held.next?.parentNode===held.home?held.next:null);restoreStyle(held.ifr,held.style);}
    held.slot?.remove();
    if(held.lite)restoreStyle(held.lite,held.liteStyle);
    if(held.vimeo)restoreStyle(held.vimeo,held.vimeoStyle);
    held.stage.remove();
  }
  const restoreStyle=(node,value)=>{if(value===null)node.removeAttribute('style');else node.setAttribute('style',value);};
  document.addEventListener('rt-hold-feed-embed',event=>{
    const embed=event.target,lite=liteOf(embed),vimeo=lite?null:vimeoLite(embed),ifr=lite?lite.querySelector('iframe'):playerFrame(embed),player=ytPlayers.get(embed);
    const id=embed.closest('shreddit-post')?.id;
    if(!id || heldEmbed || heldVideo || !ifr || (lite && !player) || coveredMedia(embed) || !document.body || typeof document.body.moveBefore!=='function')return;
    const {left,top,width,height}=ifr.getBoundingClientRect();
    if(!width || !height)return;
    const rect={left,top,width,height},corner=cornerOf(ifr);
    const style=ifr.getAttribute('style'),liteStyle=lite?.getAttribute('style') ?? null,vimeoStyle=vimeo?.getAttribute('style') ?? null,home=ifr.parentNode,next=ifr.nextSibling;
    let slot=null;
    if(!lite && !vimeo){
      slot=document.createElement('div');
      slot.setAttribute('aria-hidden','true');
      Object.assign(slot.style,{width:width+'px',height:height+'px',visibility:'hidden'});
      ifr.before(slot);
    }
    const stage=createStage(rect,corner);
    moveEmbedFrame(stage,ifr);
    // The emptied card would show Reddit's thumbnail and play button wherever the feed moves meanwhile.
    if(lite)lite.style.visibility='hidden';
    if(vimeo)vimeo.style.visibility='hidden';
    Object.assign(ifr.style,{position:'absolute',inset:'0',width:'100%',height:'100%'});
    heldEmbed={embed,lite,vimeo,ifr,player,stage,slot,style,liteStyle,vimeoStyle,home,next,restorePause:preserveEmbedPlayback(embed,true),rect,corner,id,scrollY:window.scrollY || 0,pinned:false,concealed:false};markMove();
    event.preventDefault();
  });
  document.addEventListener('rt-place-held-embed',event=>{
    const embed=event.target,id=route()?.id,held=heldEmbed;
    if(!held || !id || held.id!=='t3_'+id || !detailEmbed(embed) || embed===held.embed || embed.closest('shreddit-post')?.id!==held.id ||
       !held.ifr.isConnected || coveredMedia(embed))return;
    const lite=held.lite?liteOf(embed):null,target=held.lite?null:playerFrame(embed);
    // A post whose lite-vimeo has not made its player yet: the moving player covers it.
    const cover=!held.lite && !target?vimeoLite(embed):null;
    if(held.lite?!lite:!(target || cover))return;
    const targetSlot=lite || target || cover,to=targetSlot.getBoundingClientRect();
    const hiddenByUs='rtIncoming' in embed.dataset;
    if(!to.width || !to.height || targetSlot.checkVisibility?.({visibilityProperty:!hiddenByUs})===false ||
       (hiddenByUs && embed.parentElement?.checkVisibility?.({visibilityProperty:true})===false))return;
    const from=flightOrigin(held),landing=cornerOf(targetSlot);
    heldEmbed=null;markMove();held.restorePause();
    held.slot?.remove();
    if(held.vimeo)restoreStyle(held.vimeo,held.vimeoStyle);
    if(lite){
      lite.classList.add('lyt-activated');
      embed.hasActivatedYouTubePlayer=true;
      lite.playerPromise=Promise.resolve(held.player);
      for(const old of lite.querySelectorAll('iframe'))old.remove();
      restoreStyle(held.ifr,held.style);
      moveEmbedFrame(lite,held.ifr);
      followYouTube(embed,held.player);
      // The cached feed card gets a fresh, unplayed embed for Back.
      restoreStyle(held.lite,held.liteStyle);
      held.lite.classList.remove('lyt-activated');delete held.lite.playerPromise;
      held.embed.hasActivatedYouTubePlayer=false;ytPlayers.delete(held.embed);
    }else if(target){
      // The post's own iframe of the same video gives way to the one already playing.
      for(const attr of ['class','style','width','height']){
        if(target.hasAttribute(attr))held.ifr.setAttribute(attr,target.getAttribute(attr));
        else held.ifr.removeAttribute(attr);
      }
      moveEmbedFrame(target.parentNode,held.ifr,target);target.remove();
    }else{
      if(getComputedStyle(embed).position==='static')embed.style.position='relative';
      cover.style.visibility='hidden';
      Object.assign(held.ifr.style,{position:'absolute',inset:'0',width:'100%',height:'100%'});
      moveEmbedFrame(embed.shadowRoot,held.ifr);
    }
    held.stage.remove();
    const box=held.ifr.getBoundingClientRect(),aspect=lite?16/9:(from?.width || held.rect.width)/(from?.height || held.rect.height);
    if(from && typeof held.ifr.animate==='function' && box.width && box.height && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches){
      // One scale from YouTube's 16:9 picture to picture, clipped to the card's box at the start, as for videos.
      const a=picture(from,aspect),b=picture(box,aspect),scale=a.width/b.width;
      const x=from.left+from.width/2-box.left-box.width/2,y=from.top+from.height/2-box.top-box.height/2;
      if(Math.abs(x)>=1 || Math.abs(y)>=1 || Math.abs(scale-1)>=.01){
        const restoreClip=unclipDuringFlight(held.ifr,box);
        const timing={duration:FLIGHT_MS,easing:'cubic-bezier(.2,.8,.2,1)'};
        const insetX=Math.max(0,(box.width-from.width/scale)/2),insetY=Math.max(0,(box.height-from.height/scale)/2);
        const motion=held.ifr.animate([{transform:`translate(${x}px,${y}px) scale(${scale})`},{transform:'none'}],timing);
        held.ifr.animate([{clipPath:roundClip(insetY,insetX,held.corner,scale)},{clipPath:roundClip(0,0,landing)}],timing);
        Promise.resolve(motion.finished).then(restoreClip,restoreClip);
      }
    }
    event.preventDefault();
  });
  document.addEventListener('rt-release-feed-embed',releaseEmbed);
  // Synchronous read for the content script: whether it plays, where, and with sound.
  document.addEventListener('rt-embed-snapshot',event=>{
    const embed=event.target,player=ytPlayers.get(embed);
    delete embed.dataset.rtEmbedState;delete embed.dataset.rtEmbedTime;delete embed.dataset.rtEmbedMuted;
    try{
      if(!player?.getPlayerState)return;
      // During YouTube's pre-roll ad the state stays "unstarted" (-1) while the ad's own clock runs: the video
      // itself starts from 0.
      const state=player.getPlayerState(),time=player.getCurrentTime(),ad=state===-1 && time>0;
      embed.dataset.rtEmbedState=state===1 || state===3 || ad ? 'playing' : 'paused';
      embed.dataset.rtEmbedTime=String(ad?0:time);
      embed.dataset.rtEmbedMuted=String(player.isMuted());
    }catch{}
  });
  // The post's own embed continues where the feed's was (data-rt-start, data-rt-muted).
  document.addEventListener('rt-embed-continue',event=>{
    const embed=event.target,start=Number(embed.dataset.rtStart),muted=embed.dataset.rtMuted==='true',id=route()?.id;
    if(!liteOf(embed) || !id || !detailEmbed(embed) || coveredMedia(embed) || !(start>=0))return;
    event.preventDefault();
    youTubePlayer(embed,{start:String(Math.floor(start)),...(muted?{mute:'1'}:{})}).then(player=>{
      if(!player)return;
      player.seekTo(start,true);
      if(muted)player.mute();
      else{playYouTubeWithSound(player);return;}
      player.playVideo();
    },()=>{});
  });
  // Sound for a preview that plays for real goes through Reddit's own volume state, which every player follows.
  document.addEventListener('rt-video-sound',event=>{
    const player=event.target,video=player.shadowRoot?.querySelector?.('video'),volume=player.volumeController;
    if(!player.matches?.(videoPlayers) || !video || player.forceMuted || typeof volume?.setVolume!=='function')return;
    volume.setVolume(Math.sqrt(video.volume>0?video.volume:.25));
  });
  // Persistent volume memory: sync remembered volume into Reddit's volumeController.
  document.addEventListener('rt-video-volume',event=>{
    const player=event.target,video=player.shadowRoot?.querySelector?.('video'),volume=player.volumeController;
    const raw=player.dataset?.rtTargetVolume;
    if(player.dataset)delete player.dataset.rtTargetVolume;
    const target=Number(raw);
    if(!player.matches?.(videoPlayers) || !video || !Number.isFinite(target) || target<0 || target>1)return;
    video.volume=target;
    if(!player.forceMuted && typeof volume?.setVolume==='function')volume.setVolume(Math.sqrt(target));
  });
  document.addEventListener('rt-embed-volume',event=>{
    const embed=event.target,raw=embed.dataset?.rtTargetVolume;
    if(embed.dataset)delete embed.dataset.rtTargetVolume;
    const target=Number(raw);
    if(!Number.isFinite(target) || target<0 || target>1)return;
    youTubeCall(embed,player=>player.setVolume?.(Math.round(target*100)));
  });
  // Floating mini-player (Beta) for post-detail media scrolled off screen: reuses reparent/moveBefore for zero reload.
  let miniMedia=null;
  function exitMini(dismissed=false){
    const current=miniMedia;if(!current)return;
    miniMedia=null;
    const {node,player,ifr,slot,dock,controller,restorePause,style,lite,vimeo,liteStyle,vimeoStyle,home,next}=current;
    if(dismissed){
      if(player){const v=player.shadowRoot?.querySelector('video');if(v && !v.paused)v.pause();}
      else if(lite)youTubeCall(node,p=>p.pauseVideo?.());
    }
    restorePause?.();
    if(player){
      restoreStyle(player,style);
      if(slot?.isConnected)movePlayer(slot.parentNode,player,slot);
      slot?.remove();
      controller?.endDomReparent?.();
    }else if(ifr){
      restoreStyle(ifr,style);
      if(home?.isConnected)moveEmbedFrame(home,ifr,next?.parentNode===home?next:null);
      if(lite)restoreStyle(lite,liteStyle);
      if(vimeo)restoreStyle(vimeo,vimeoStyle);
    }
    dock?.remove();
    if(dismissed)node?.dispatchEvent(new Event('rt-mini-dismissed',{bubbles:true}));
  }
  function createMiniDock(node,anchor){
    const narrow=(window.innerWidth || 800)<500;
    const dock=document.createElement('div');
    dock.dataset.rtMiniDock='';
    dock.setAttribute('role','region');
    dock.setAttribute('aria-label','Mini-player');
    Object.assign(dock.style,{
      position:'fixed',right:narrow?'12px':'16px',bottom:'72px',zIndex:'9999',
      width:narrow?'200px':'320px',maxWidth:'calc(100vw - 24px)',aspectRatio:'16 / 9',
      background:'#000',borderRadius:'12px',overflow:'hidden',
      boxShadow:'0 8px 28px rgba(0,0,0,.45)',border:'1px solid rgba(255,255,255,.14)'
    });
    const bar=document.createElement('div');
    bar.dataset.rtMiniBar='';
    Object.assign(bar.style,{position:'absolute',top:'6px',right:'6px',zIndex:'10',display:'flex',gap:'4px'});
    const btnStyle={width:'28px',height:'28px',border:'0',borderRadius:'999px',background:'rgba(0,0,0,.72)',color:'#fff',
      cursor:'pointer',display:'inline-flex',alignItems:'center',justifyContent:'center',padding:'0',font:'600 14px/1 system-ui,sans-serif'};
    const back=document.createElement('button');
    back.type='button';back.dataset.rtMiniBack='';back.setAttribute('aria-label','Back to video');back.title='Back to video';back.textContent='↑';
    Object.assign(back.style,btnStyle);
    back.addEventListener('click',event=>{
      event.preventDefault();event.stopPropagation();
      const target=anchor?.isConnected?anchor:node;
      exitMini(false);
      target?.scrollIntoView?.({behavior:'smooth',block:'center'});
    });
    const close=document.createElement('button');
    close.type='button';close.dataset.rtMiniClose='';close.setAttribute('aria-label','Close mini-player');close.title='Close mini-player';close.textContent='×';
    Object.assign(close.style,btnStyle);
    close.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();exitMini(true);});
    bar.append(back,close);
    dock.append(bar);
    document.body.append(dock);
    return dock;
  }
  document.addEventListener('rt-mini-enter',event=>{
    const node=event.target,id=route()?.id;
    if(!id || miniMedia || heldVideo || heldEmbed || !document.body || coveredMedia(node))return;
    if(node.matches?.(videoPlayers) && node.getAttribute('player-type')==='post_detail_screen' && node.getAttribute('post-id')==='t3_'+id && !node.closest('shreddit-comment')){
      const video=node.shadowRoot?.querySelector('video');
      if(!video || video.paused || video.ended)return;
      const box=node.getBoundingClientRect(),height=box.height || 300;
      const slot=document.createElement('div');
      slot.dataset.rtMiniSlot='';slot.setAttribute('aria-hidden','true');
      slot.style.height=height+'px';
      node.before(slot);
      const style=node.getAttribute('style');
      const controller=node.mediaFbpController;
      controller?.beginDomReparent?.();
      const dock=createMiniDock(node,slot);
      Object.assign(node.style,{position:'absolute',inset:'0',width:'100%',height:'100%'});
      movePlayer(dock,node);
      miniMedia={node,player:node,slot,dock,controller,style};
      event.preventDefault();
      return;
    }
    if(detailEmbed(node) && typeof document.body.moveBefore==='function'){
      const lite=liteOf(node),vimeo=lite?null:vimeoLite(node),ifr=lite?lite.querySelector('iframe'):playerFrame(node);
      if(!ifr)return;
      const style=ifr.getAttribute('style'),liteStyle=lite?.getAttribute('style') ?? null,vimeoStyle=vimeo?.getAttribute('style') ?? null;
      const home=ifr.parentNode,next=ifr.nextSibling;
      const dock=createMiniDock(node,node);
      const restorePause=preserveEmbedPlayback(node,true);
      moveEmbedFrame(dock,ifr);
      if(lite)lite.style.visibility='hidden';
      if(vimeo)vimeo.style.visibility='hidden';
      Object.assign(ifr.style,{position:'absolute',inset:'0',width:'100%',height:'100%'});
      miniMedia={node,ifr,dock,restorePause,style,lite,vimeo,liteStyle,vimeoStyle,home,next};
      event.preventDefault();
    }
  });
  document.addEventListener('rt-mini-exit',()=>exitMini(false));
  window.addEventListener('pagehide',()=>exitMini(false));
  // Stream quality (Beta): passive when html[data-rt-stream-quality] is absent ('auto').
  // Filters v.redd.it HLS/DASH master manifests in MAIN world so Reddit's player selects max or data-saver variants.
  const streamManifestUrl=value=>{
    try{const url=new URL(String(value),location.href);return url.protocol==='https:' && url.hostname==='v.redd.it' && /\/(?:HLSPlaylist\.m3u8|DASHPlaylist\.mpd)$/i.test(url.pathname)?url.pathname:'';}
    catch{return '';}
  };
  function filterHlsManifest(text,mode){
    if(typeof text!=='string' || !text.includes('#EXT-X-STREAM-INF'))return text;
    const lines=text.split(/\r?\n/),variants=[],headers=[];
    for(let i=0;i<lines.length;i++){
      const line=lines[i];
      if(line.startsWith('#EXT-X-STREAM-INF:')){
        const uri=lines[i+1] || '';
        const res=/RESOLUTION=\d+x(\d+)/i.exec(line),bw=/BANDWIDTH=(\d+)/i.exec(line);
        variants.push({index:headers.length,inf:line,uri,height:res?Number(res[1]):0,bandwidth:bw?Number(bw[1]):0});
        headers.push(null);
        i++;
      }else headers.push(line);
    }
    if(variants.length<2)return text;
    const sorted=[...variants].sort((a,b)=>(b.height-a.height) || (b.bandwidth-a.bandwidth));
    let keep;
    if(mode==='max')keep=new Set([sorted[0]]);
    else{
      const low=variants.filter(v=>v.height>0 && v.height<=480);
      keep=new Set(low.length?low:[sorted[sorted.length-1]]);
    }
    const out=[];
    for(let i=0;i<headers.length;i++){
      if(headers[i]!==null){out.push(headers[i]);continue;}
      const v=variants.find(item=>item.index===i);
      if(v && keep.has(v))out.push(v.inf,v.uri);
    }
    return out.join('\n');
  }
  function filterDashManifest(text,mode){
    if(typeof text!=='string' || !text.includes('<Representation'))return text;
    return text.replace(/<AdaptationSet\b[^>]*>[\s\S]*?<\/AdaptationSet>/gi,block=>{
      if(/contentType=["']audio["']|mimeType=["']audio\//i.test(block))return block;
      const reps=[...block.matchAll(/<Representation\b([^>]*)>[\s\S]*?<\/Representation>/gi)].map(match=>{
        const attrs=match[1],h=/\bheight=["'](\d+)["']/i.exec(attrs),bw=/\bbandwidth=["'](\d+)["']/i.exec(attrs);
        return {raw:match[0],height:h?Number(h[1]):0,bandwidth:bw?Number(bw[1]):0};
      });
      if(reps.length<2)return block;
      const sorted=[...reps].sort((a,b)=>(b.height-a.height) || (b.bandwidth-a.bandwidth));
      const keep=mode==='max'?new Set([sorted[0].raw]):new Set((()=>{const low=reps.filter(r=>r.height>0 && r.height<=480);return (low.length?low:[sorted[sorted.length-1]]).map(r=>r.raw);})());
      return block.replace(/<Representation\b[^>]*>[\s\S]*?<\/Representation>/gi,raw=>keep.has(raw)?raw:'');
    });
  }
  function filterStreamManifest(path,text,mode){
    return /\.m3u8$/i.test(path)?filterHlsManifest(text,mode):filterDashManifest(text,mode);
  }
  const activeStreamQuality=()=>{
    const q=document.documentElement?.getAttribute('data-rt-stream-quality');
    return q==='max' || q==='saver'?q:'';
  };
  (()=>{
    const nativeFetch=window.fetch;
    if(typeof nativeFetch==='function'){
      window.fetch=function(input,init){
        const mode=activeStreamQuality();
        if(!mode)return nativeFetch.call(window,input,init);
        const url=typeof input==='string'?input:input?.url;
        const path=streamManifestUrl(url);
        if(!path)return nativeFetch.call(window,input,init);
        return nativeFetch.call(window,input,init).then(async response=>{
          if(!response?.ok)return response;
          const text=await response.text();
          const filtered=filterStreamManifest(path,text,mode);
          const next=typeof Response==='function'?new Response(filtered,{status:response.status,statusText:response.statusText,headers:response.headers}):{ok:response.ok,status:response.status,statusText:response.statusText,headers:response.headers,text:async()=>filtered};
          const resolvedUrl=response.url || (typeof url==='string'?url:'');
          if(resolvedUrl)try{Object.defineProperty(next,'url',{value:resolvedUrl,configurable:true});}catch{}
          return next;
        });
      };
    }
    const XHR=window.XMLHttpRequest;
    const open=XHR?.prototype?.open;
    if(typeof open==='function'){
      const xhrMeta=new WeakMap();
      XHR.prototype.open=function(method,url,...rest){
        const mode=activeStreamQuality(),path=mode?streamManifestUrl(url):'';
        if(path)xhrMeta.set(this,{path,mode});else xhrMeta.delete(this);
        return open.call(this,method,url,...rest);
      };
      for(const prop of ['responseText','response']){
        const desc=Object.getOwnPropertyDescriptor(XHR.prototype,prop);
        if(!desc?.get || !desc.configurable)continue;
        Object.defineProperty(XHR.prototype,prop,{configurable:true,enumerable:desc.enumerable,get(){
          const raw=desc.get.call(this),meta=xhrMeta.get(this);
          if(meta && this.readyState===4 && this.status>=200 && this.status<300 && typeof raw==='string'){
            return filterStreamManifest(meta.path,raw,meta.mode);
          }
          return raw;
        }});
      }
    }
  })();
  document.addEventListener('rt-release-feed-video',releaseVideo);
  document.addEventListener('rt-prepare-feed-preview',event=>{
    const player=event.target;
    if(!player.matches?.(videoPlayers))return;
    const comment=player.closest('shreddit-comment'),id=route()?.id;
    const allowed=comment?id && comment.getAttribute('postid')==='t3_'+id && !player.closest('shreddit-comment[collapsed],details:not([open]),[hidden],[inert]'):
      player.getAttribute('player-type')==='in_feed_player' && player.closest('shreddit-post')?.id===player.getAttribute('post-id') ||
      player.getAttribute('player-type')==='search_results' && Boolean(player.closest('[data-id="search-media-post-unit"]'));
    if(!allowed)return;
    player.mediaSyncController?.muteForAutoplayRetry?.();
    if(player.shadowRoot?.querySelector('video')?.readyState===0)player.load?.('metadata')?.catch?.(()=>{});
  });
  // A lazy native player needs Reddit's own media loader before its <video> has metadata.
  document.addEventListener('rt-prepare-detail-video',event=>{
    const player=event.target,id=route()?.id;
    if(!id || !player.matches?.(':is(shreddit-player,shreddit-player-2)[player-type="post_detail_screen"]') ||
       player.getAttribute('post-id')!=='t3_'+id || typeof player.load!=='function')return;
    player.load('metadata')?.catch?.(()=>{});
  });
  // Reddit's nav connects using its SSR expanded attribute before it reads the
  // saved preference. Seed each incoming native profile nav once, before paint;
  // later native toggles remain entirely under Reddit's control. Cookie access
  // stays in the page world and no cookie value is sent to the extension.
  const seededProfileNavs=new WeakSet(),profileNavSelector='flex-left-nav-container#left-sidebar-container';
  function seedProfileNavigation(records){
    if(!globalThis.document?.documentElement?.hasAttribute('data-rt-profile-discovery') || !window.location || !route()?.username)return;
    const nodes=new Set();
    if(!records || records.some(record=>record.type==='attributes'))for(const nav of document.querySelectorAll(profileNavSelector))nodes.add(nav);
    else for(const record of records)for(const node of record.addedNodes){if(node.nodeType!==1 || node.closest('main,shreddit-feed') || node.matches('shreddit-post,shreddit-profile-comment'))continue;if(node.matches(profileNavSelector))nodes.add(node);for(const nav of node.querySelectorAll(profileNavSelector))nodes.add(nav);}
    if(!nodes.size)return;
    const value=document.cookie.split(';').map(part=>part.trim()).find(part=>part.startsWith('hui_flex_nav_expanded_state='))?.slice('hui_flex_nav_expanded_state='.length);
    if(value!=='0' && value!=='1')return;
    for(const nav of nodes){if(seededProfileNavs.has(nav) || nav.closest('[data-rt-ui]'))continue;const grid=nav.closest('.grid-container');if(!grid)continue;
      seededProfileNavs.add(nav);nav.setAttribute('expanded',value);grid.classList.toggle('flex-nav-collapsed',value==='0');grid.classList.toggle('flex-nav-expanded',value==='1');
    }
  }
  // Reddit starts these headers unscoped whenever the unavailable view exists.
  // Restore the native scope once public activity is ready, once per header/scope
  // so Reddit's own remove-pill action and unscoped searches still work.
  const scopedHeaders=new Map(),pendingHeaders=new WeakSet(),profileSearchHeaders='reddit-search-large,reddit-search-small';
  const hiddenSearchScopes=new Set(),scopeGateStyles=new WeakMap();
  function syncBlockedSearchHeader(){
    const notice=document.getElementById('shreddit-forbidden');
    const shell=notice?.previousElementSibling,username=route()?.username?.toLowerCase();
    const pending=Boolean(username && document.documentElement?.hasAttribute('data-rt-profile-scope-pending'));
    const active=!pending && Boolean(username && notice?.hasAttribute('data-rt-archive-notice') && shell?.dataset.rtAccountState==='blocked' && shell.dataset.rtUsername?.toLowerCase()===username);
    for(const header of hiddenSearchScopes)if(!pending || !header.isConnected){
      header.removeAttribute('data-rt-profile-scope-hidden');hiddenSearchScopes.delete(header);
    }
    for(const [header,{scope,enabled}] of scopedHeaders){
      if(!active || !header.isConnected || header.getAttribute('scope')!==scope){
        if(header.isConnected && header.getAttribute('scope')===scope && notice?.isConnected)header.isSearchScopeEnabled=enabled;
        scopedHeaders.delete(header);
      }
    }
    if(!active && !pending)return;
    const mobile=document.querySelector('reddit-header-small')?.shadowRoot;
    for(const header of [...document.querySelectorAll(profileSearchHeaders),...(mobile?.querySelectorAll(profileSearchHeaders) || [])]){
      if(scopedHeaders.has(header))continue;
      let scope;const attr=header.getAttribute('scope');try{scope=JSON.parse(attr);}catch{}
      if(scope?.type!=='profile' || String(scope.name).toLowerCase()!==username || String(scope.path).replace(/\/$/,'').toLowerCase()!=='/user/'+username){
        if(hiddenSearchScopes.delete(header))header.removeAttribute('data-rt-profile-scope-hidden');
        continue;
      }
      if(pending){
        if(!hiddenSearchScopes.has(header)){header.setAttribute('data-rt-profile-scope-hidden','');hiddenSearchScopes.add(header);}
        if(header.shadowRoot && !scopeGateStyles.get(header)?.isConnected){
          const style=document.createElement('style');
          style.textContent=':host([data-rt-profile-scope-hidden]) :is(.scoped-search-pill,#search-input-chip,#search-input-remove-filter){display:none!important}';
          header.shadowRoot.append(style);scopeGateStyles.set(header,style);
        }
      }
      if(typeof header.isSearchScopeEnabled!=='boolean'){
        if(!customElements.get(header.localName) && !pendingHeaders.has(header)){
          pendingHeaders.add(header);
          customElements.whenDefined(header.localName).then(()=>{pendingHeaders.delete(header);syncBlockedSearchHeader();});
        }
        continue;
      }
      if(pending)continue;
      scopedHeaders.set(header,{scope:attr,enabled:header.isSearchScopeEnabled});
      header.isSearchScopeEnabled=true;
    }
  }
  const profileNavObserver=new MutationObserver(records=>{
    if(!globalThis.document)return;
    if(observedFeed && !observedFeed.isConnected)stopObservingFeed();
    seedProfileNavigation(records);
    if(scopedHeaders.size || hiddenSearchScopes.size || document.documentElement?.hasAttribute('data-rt-profile-scope-pending') ||
      document.getElementById('shreddit-forbidden')?.hasAttribute('data-rt-archive-notice'))syncBlockedSearchHeader();
  });
  profileNavObserver.observe(document,{childList:true,subtree:true,attributes:true,attributeFilter:['data-rt-profile-discovery','data-rt-archive-notice','data-rt-profile-scope-pending','scope']});
  document.addEventListener('focusin',event=>{if(event.composedPath().some(node=>node.matches?.(profileSearchHeaders)))syncBlockedSearchHeader();},true);
  document.addEventListener('rt-blocked-profile-search-submitted',event=>{
    const header=event.composedPath()[0];if(!scopedHeaders.has(header))return;
    header.handleBlur?.();
    const dialog=header.closest('faceplate-dialog,rpl-dialog') || header.assignedSlot?.closest('faceplate-dialog,rpl-dialog') ||
      (header.matches('reddit-search-small')?document.querySelector('reddit-header-small rpl-dialog[slot="reddit-search-dialog"]'):null);
    if(dialog?.open){
      if(typeof dialog.hide==='function')dialog.hide()?.catch?.(()=>{});
      else dialog.close?.();
    }
  });
  window.addEventListener('pagehide',event=>{if(!event.persisted)profileNavObserver.disconnect();});
  seedProfileNavigation();
  syncBlockedSearchHeader();
  // Reddit's feed virtualizer assumes its placeholders form one block at the top
  // of the feed, in stack order. Discovery inserts and reorders cards, which
  // breaks that: entries end up out of order, duplicated or detached, Reddit
  // stops restoring at the first one out of range and readers see blank space
  // (mostly when scrolling up). While discovery owns a profile feed, drive the
  // same controller from the document instead: restore any placeholder near the
  // viewport, wherever its stack entry is, and only virtualize cards far above.
  // Entries keep Reddit's {node,placeholder,height} shape so its state survives.
  let syncFrame=null,observedFeed=null;const managed=new WeakSet(),nativeMethods=new WeakMap();
  const feedObserver=typeof MutationObserver==='function'?new MutationObserver(records=>{
    updateFeedTargets(records);
    scheduleFeedSync();
  }):null;
  function ownedFeed(feed){return Boolean(feed?.isConnected && feed.hasAttribute('data-rt-loading-owner') && route()?.username && document.documentElement.hasAttribute('data-rt-profile-discovery'));}
  function currentFeed(){return document.querySelector('main shreddit-feed[data-rt-loading-owner]') || (observedFeed?.isConnected?observedFeed:null);}
  function manageFeed(feed){
    const controller=feed?.virtualization;
    if(!controller || !Array.isArray(controller.topStack) || typeof controller._virtualizeTop!=='function')return null;
    if(!nativeMethods.has(controller)){
      const native=controller._virtualizeTop;nativeMethods.set(controller,native);
      controller._virtualizeTop=function(distance){
        if(ownedFeed(this.host)){scheduleFeedSync();return;}
        // Discovery released the feed: restore everything we hold so Reddit
        // restarts from a consistent, empty stack.
        if(managed.has(this)){managed.delete(this);releaseFeed(this);if(observedFeed===this.host)stopObservingFeed();}
        return native.call(this,distance);
      };
    }
    managed.add(controller);
    observeFeed(feed);
    return controller;
  }
  function observeFeed(feed){
    if(observedFeed===feed)return;
    stopObservingFeed();
    observedFeed=feed;
    feedObserver?.observe(feed,{childList:true});
    for(const child of feed.children)watchPlaceholder(child);
  }
  function restoreEntry(feed,entry){
    const {node,placeholder}=entry;
    if(!placeholder?.isConnected)return false;
    if(node?.nodeType===1 && !node.isConnected && !node.contains(placeholder))placeholder.replaceWith(node);
    else placeholder.remove();
    return true;
  }
  function releaseFeed(controller){
    const stack=Array.isArray(controller.topStack)?controller.topStack:[];
    for(let pass=0;pass<4 && stack.length;pass++){const entries=stack.splice(0);for(const entry of entries.reverse())if(entry && !restoreEntry(controller.host,entry) && entry.node?.nodeType===1 && !entry.node.isConnected)stack.push(entry);if(stack.length===entries.length)break;}
    for(const placeholder of controller.host?.querySelectorAll?.(':scope > .virtualized-placeholder') || [])placeholder.remove();
    for(const node of controller.host?.querySelectorAll?.(':scope > [data-rt-skip]') || [])node.removeAttribute('data-rt-skip');
    controller.topStack=[];controller.topPadding=0;
  }
  // Type-filtered community feeds (rt_type): Reddit swaps out a whole batch once it is a screen above the viewport,
  // and a batch that shows one or two cards comes and goes far more often. Each return makes Reddit rebuild its
  // embeds (shreddit-embed drops its content on disconnect: a new lite-youtube, thumbnail loaded again, a playing
  // YouTube video lost). Keeping every card mounted instead grew a phone feed to ~73,000 elements (2026-11-19), so
  // Reddit still swaps cards out, but only beyond about ten screens.
  const keptFeeds=new WeakSet(),typeFiltered=()=>{const q=new URLSearchParams(location.search);return ['rt_type','rt_sub','rt_hide','rt_nsfw'].some(key=>q.has(key));},FILTERED_SCREENS=9;
  function keepFilteredFeeds(){
    for(const feed of document.querySelectorAll('shreddit-feed')){
      const controller=feed.virtualization;
      if(!controller || keptFeeds.has(controller) || typeof controller._virtualizeTop!=='function' || !Array.isArray(controller.topStack))continue;
      keptFeeds.add(controller);
      const native=controller._virtualizeTop;
      controller._virtualizeTop=function(distance){
        if(typeFiltered() && !ownedFeed(this.host))return native.call(this,distance-FILTERED_SCREENS*(window.innerHeight || 800));
        return native.call(this,distance);
      };
    }
  }
  let keepQueued=false;
  addEventListener('scroll',()=>{if(keepQueued || !typeFiltered())return;keepQueued=true;setTimeout(()=>{keepQueued=false;keepFilteredFeeds();},0);},{capture:true,passive:true});
  // One pass: measure everything first, then change the DOM, then correct the
  // scroll position. Measuring between writes would force a layout each time.
  function syncFeed(){
    const feed=currentFeed();
    if(!ownedFeed(feed)){
      const controller=feed?.virtualization;if(controller && managed.has(controller)){managed.delete(controller);releaseFeed(controller);}
      stopObservingFeed();
      return;
    }
    const controller=manageFeed(feed);if(!controller)return;
    try{reconcileFeed(feed,controller);}
    // Our own changes must not wake the observer into another pass.
    finally{updateFeedTargets(feedObserver?.takeRecords());}
  }
  function reconcileFeed(feed,controller){
    // Restore within 4 screens either way (the observer's margin); virtualize only beyond 5, so nothing thrashes.
    // Smooth long feeds keeps posts mounted (the browser skips drawing far ones) and swaps out only very distant ones.
    const smooth=smoothFeed(),height=Math.max(1,window.innerHeight || 0),restoreAbove=-4*height,restoreBelow=4*height,virtualizeAbove=smooth?-Math.max(40*height,20000):-Math.max(5*height,height+2000);
    // Read phase.
    const rows=[];let anchor=null;
    for(let child=feed.firstElementChild;child;child=child.nextElementSibling){
      observeForSkip(child,smooth);
      const rect=child.getBoundingClientRect(),row={child,top:rect.top,bottom:rect.bottom,height:rect.height,placeholder:child.classList.contains('virtualized-placeholder')};rows.push(row);
      if(!anchor && !row.placeholder && row.height>0 && row.bottom>0 && row.top<window.innerHeight)anchor={child,top:row.top};
    }
    // Virtualize candidates: only cards far above the viewport, the same distance
    // Reddit uses. Our status/loader UI and empty elements stay mounted.
    const pending=[];
    for(const row of rows){
      if(row.placeholder || row.child.dataset.rtUi && row.child.dataset.rtUi!=='activity-item')continue;
      if(row.height>0 && row.top>=virtualizeAbove)break;
      if(row.height>0 && row.bottom<virtualizeAbove)pending.push(row);
    }
    // Write phase. Restore any placeholder near the viewport; a restored entry
    // can itself be an older placeholder, so look again only in that case (bounded).
    let changed=false,nearRows=rows.filter(row=>row.placeholder && row.bottom>restoreAbove && row.top<restoreBelow);
    for(let pass=0;pass<8;pass++){
      const stack=controller.topStack,byPlaceholder=new Map();for(const entry of stack)if(entry?.placeholder)byPlaceholder.set(entry.placeholder,entry);
      // Entries whose placeholder left the document can never be restored by
      // Reddit either (its replaceChild would throw); drop them.
      const stale=stack.filter(entry=>!entry?.placeholder?.isConnected);
      if(!nearRows.length && !stale.length)break;
      const done=new Set(stale);let again=false;
      for(const {child:placeholder} of nearRows){const entry=byPlaceholder.get(placeholder);if(entry){restoreEntry(feed,entry);done.add(entry);if(entry.node?.classList?.contains('virtualized-placeholder'))again=true;}else placeholder.remove();changed=true;}
      if(done.size){const keep=stack.filter(entry=>!done.has(entry));stack.length=0;stack.push(...keep);}
      if(!again)break;
      nearRows=[];for(const placeholder of feed.querySelectorAll(':scope > .virtualized-placeholder')){const rect=placeholder.getBoundingClientRect();if(rect.bottom>restoreAbove && rect.top<restoreBelow)nearRows.push({child:placeholder});}
    }
    for(const {child:node,height:size} of pending){
      if(node.parentElement!==feed)continue;
      const placeholder=document.createElement('div');placeholder.className='virtualized-placeholder';placeholder.style.height=size+'px';feed.replaceChild(placeholder,node);controller.topStack.push({node,placeholder,height:size});changed=true;
    }
    if(!changed)return;
    controller.topPadding=controller.topStack.reduce((sum,entry)=>sum+(entry.placeholder?.isConnected && Number.isFinite(entry.height)?entry.height:0),0);
    // Restored cards may differ from their saved heights; keep what the reader
    // is looking at in place.
    if(anchor?.child.isConnected){const delta=anchor.child.getBoundingClientRect().top-anchor.top;if(Math.abs(delta)>0.5)window.scrollBy({top:delta,behavior:'instant'});}
  }
  // Fast flicks (measured 2026-11-17, phone emulation at 4x CPU): measuring every feed child on every scroll frame
  // forced seconds of layout, and a 1.5-screen restore window let flicks up reach placeholders (blank screens). While
  // the reader scrolls, an IntersectionObserver swaps placeholders back as they come within 4 screens, with no layout
  // reads of ours; the full measure-and-virtualize pass waits until scrolling pauses.
  let lastScroll=-Infinity,idleTimer=null,restoreFrame=null;const pendingRestore=new Set(),observedPlaceholders=new Set();
  const idleMs=()=>Number(window.__rtFeedIdleMs) || 200;
  const restoreObserver=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{const near=entries.filter(entry=>entry.isIntersecting).map(entry=>entry.target);if(near.length)queueRestore(near);},{rootMargin:'400% 0px 400% 0px'}):null;
  function watchPlaceholder(node){
    if(!restoreObserver || !node.classList?.contains('virtualized-placeholder') || observedPlaceholders.has(node))return;
    observedPlaceholders.add(node);
    restoreObserver.observe(node);
  }
  function stopObservingFeed(){
    if(!observedFeed)return;
    feedObserver?.disconnect();
    restoreObserver?.disconnect?.();
    skipObserver?.disconnect?.();
    restoreObserver?.takeRecords?.();
    skipObserver?.takeRecords?.();
    observedPlaceholders.clear();
    // Cards this feed skipped while offscreen get no further intersection entries: draw them again.
    for(const node of skipObserved)if(node.isConnected && node.hasAttribute('data-rt-skip')){node.removeAttribute('data-rt-skip');node.style.removeProperty('contain-intrinsic-size');}
    skipObserved.clear();
    pendingRestore.clear();
    observedFeed=null;
  }
  // Native virtualization and our own replacements both change direct children.
  function updateFeedTargets(records){
    if(!observedFeed || !records?.length)return;
    for(const record of records)if(record.target===observedFeed){
      for(const node of record.removedNodes)if(node.parentElement!==observedFeed){
        if(observedPlaceholders.delete(node))restoreObserver?.unobserve(node);
        if(skipObserved.delete(node))skipObserver?.unobserve(node);
        pendingRestore.delete(node);
      }
      for(const node of record.addedNodes)if(node.parentElement===observedFeed)watchPlaceholder(node);
    }
  }
  function queueRestore(list){for(const placeholder of list)pendingRestore.add(placeholder);if(restoreFrame!==null || typeof requestAnimationFrame!=='function')return;restoreFrame=requestAnimationFrame(()=>{restoreFrame=null;try{restorePlaceholders();}catch{ /* the next full pass restores them */ }});}
  function restorePlaceholders(){
    const feed=currentFeed(),list=[...pendingRestore];pendingRestore.clear();
    if(!ownedFeed(feed))return;const controller=manageFeed(feed);if(!controller)return;
    const stack=controller.topStack,byPlaceholder=new Map();for(const entry of stack)if(entry?.placeholder)byPlaceholder.set(entry.placeholder,entry);
    const done=new Set();let changed=false;
    for(const placeholder of list){
      if(!placeholder.isConnected || placeholder.parentElement!==feed)continue;
      restoreObserver.unobserve(placeholder);observedPlaceholders.delete(placeholder);
      const entry=byPlaceholder.get(placeholder);if(entry){restoreEntry(feed,entry);done.add(entry);}else placeholder.remove();changed=true;
    }
    if(!changed)return;
    if(done.size){const keep=stack.filter(entry=>!done.has(entry));stack.length=0;stack.push(...keep);}
    controller.topPadding=stack.reduce((sum,entry)=>sum+(entry.placeholder?.isConnected && Number.isFinite(entry.height)?entry.height:0),0);
    // A restored entry can itself be an older placeholder; it is observed like any other.
    updateFeedTargets(feedObserver?.takeRecords());
  }
  /* Smooth long feeds (setting, default on): a post more than two screens away gets content-visibility:hidden at its
     measured height (CSS [data-rt-skip]), so the browser skips laying it out and painting it, and draws it again as it
     comes within two screens. Posts near the screen are never contained, so their menus and pop-ups work. */
  // Touch screens never skip drawing (see smooth-scroll.js: it left blank screens during flicks without gaining speed).
  const smoothFeed=()=>document.documentElement.hasAttribute('data-rt-smooth-feed') && !window.matchMedia?.('(hover: none), (pointer: coarse)')?.matches;
  const skipObserver=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{
    const on=smoothFeed();
    for(const entry of entries){const node=entry.target,height=Math.round(entry.boundingClientRect?.height || 0);
      if(!on || entry.isIntersecting){if(node.hasAttribute('data-rt-skip'))node.removeAttribute('data-rt-skip');continue;}
      if(height>0 && !node.hasAttribute('data-rt-skip')){node.style.containIntrinsicSize='auto '+height+'px';node.setAttribute('data-rt-skip','');}}
  },{rootMargin:'200% 0px 200% 0px'}):null;
  const skipObserved=new Set();
  function observeForSkip(child,smooth){
    if(!skipObserver)return;
    if(!smooth){if(child.hasAttribute('data-rt-skip'))child.removeAttribute('data-rt-skip');return;}
    if(skipObserved.has(child) || child.classList.contains('virtualized-placeholder') || child.dataset.rtUi && child.dataset.rtUi!=='activity-item')return;
    skipObserved.add(child);skipObserver.observe(child);
  }
  function scheduleFeedSync(discover=false){
    // Only profile feeds are managed: elsewhere (subreddits, home) every scroll event returned here after a document
    // search (measured 2026-11-19: ~1.3 s of a 46 s phone scroll). A feed managed earlier still gets its release pass.
    if(!observedFeed && !route()?.username)return;
    const quiet=performance.now()-lastScroll;
    if(restoreObserver && quiet<idleMs()){
      if(discover===true || !observedFeed){
        const feed=currentFeed();if(ownedFeed(feed))observeFeed(feed);
      }else updateFeedTargets(feedObserver?.takeRecords());
      if(!idleTimer)idleTimer=setTimeout(()=>{idleTimer=null;scheduleFeedSync();},idleMs()-quiet+5);
      return;
    }
    if(syncFrame!==null || typeof requestAnimationFrame!=='function')return;
    syncFrame=requestAnimationFrame(()=>{syncFrame=null;try{syncFeed();}catch{ /* Native virtualization remains if Reddit's contract changes. */ }});
  }
  document.addEventListener('scroll',()=>{lastScroll=performance.now();if(observedFeed && !observedFeed.isConnected)stopObservingFeed();scheduleFeedSync();},{passive:true});
  window.addEventListener('resize',scheduleFeedSync,{passive:true});
  // Take over as soon as discovery marks a feed, before Reddit's next native
  // pass can virtualize around inserted cards.
  if(typeof MutationObserver==='function')new MutationObserver(()=>scheduleFeedSync(true)).observe(document.documentElement,{subtree:true,attributes:true,attributeFilter:['data-rt-loading-owner','data-rt-profile-discovery']});
  async function boundedText(response,max=2500000){
    if(Number(response.headers.get('content-length'))>max)throw Error('Reddit response is too large.');
    let text='';
    if(response.body?.getReader){const reader=response.body.getReader(),decoder=new TextDecoder();let bytes=0;try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>max){await reader.cancel();throw Error('Reddit response is too large.');}text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}}
    else text=await response.text();
    if(text.length>max)throw Error('Reddit response is too large.');
    return text;
  }
  // Search mode (the profile search view) adds the user's words to the author query and may sort by relevance or comment count.
  const authorQuery=username=>`author:"${username}"`;
  function searchCursor(doc,username,type,sort,range,{q=authorQuery(username),search=false}={}){
    for(const part of doc.querySelectorAll('faceplate-partial[loading="lazy"][src]'))try{
      const url=new URL(part.getAttribute('src'),location.origin),cursor=url.searchParams.get('cursor');
      if(url.origin===location.origin && url.pathname==='/svc/shreddit/search/' && url.searchParams.get('q')===q && url.searchParams.get('type')===type && (url.searchParams.get('sort') || (search?'relevance':'new'))===sort && (sort!=='top' && !search || (url.searchParams.get('t') || 'all')===range) && typeof cursor==='string' && cursor.length>0 && cursor.length<=4096 && !/[\u0000-\u001f]/.test(cursor))return cursor;
    }catch{ /* Only Reddit's matching, same-origin continuation is followed. */ }
    return null;
  }
  function postPageCursor(cursor,transport,username,sort,range,q=authorQuery(username)){return cursor?'rt-post-search:'+JSON.stringify({cursor,transport,username:username.toLowerCase(),sort,range,q}):null;}
  function readPostCursor(value,username,sort,range,q=authorQuery(username)){
    if(value==null)return null;
    try{if(typeof value!=='string' || value.length>8192 || !value.startsWith('rt-post-search:'))throw Error();
      const page=JSON.parse(value.slice(15));
      if(page.username!==username.toLowerCase() || page.sort!==sort || page.range!==range || (page.q ?? authorQuery(username))!==q || !['shreddit','json'].includes(page.transport) || typeof page.cursor!=='string' || !page.cursor || page.cursor.length>4096 || /[\u0000-\u001f]/.test(page.cursor) || page.transport==='json' && !/^t3_[a-z0-9]{1,10}$/i.test(page.cursor))throw Error();
      return page;
    }catch{throw Error('Invalid Reddit page cursor. Refresh activity to start again.');}
  }
  function commentPageCursor(cursor,stream,username,sort,range,q=authorQuery(username)){return cursor?'rt-comment-search:'+JSON.stringify({cursor,stream,username:username.toLowerCase(),sort,range,q}):null;}
  function readCommentCursor(value,stream,username,sort,range,q=authorQuery(username)){
    if(value==null)return null;
    try{if(typeof value!=='string' || value.length>8192 || !value.startsWith('rt-comment-search:'))throw Error();const page=JSON.parse(value.slice(18));
      if(page.stream!==stream || page.username!==username.toLowerCase() || page.sort!==sort || page.range!==range || (page.q ?? authorQuery(username))!==q || typeof page.cursor!=='string' || !page.cursor || page.cursor.length>4096 || /[\u0000-\u001f]/.test(page.cursor))throw Error();return page.cursor;
    }catch{throw Error('Invalid Reddit comment cursor. Refresh activity to start again.');}
  }
  function postListing(text,username,{sort='new',range='all',q=authorQuery(username),search=false}={}){
    const doc=new DOMParser().parseFromString(text,'text/html'),posts=[],seen=new Set();
    // Crossposts have no search-sdui-post test ID. Their outer view tracker is
    // the result; embedded original-post trackers must not become extra hits.
    const cards=doc.querySelectorAll('search-telemetry-tracker[view-events="search/view/post"]');let unread=0;
    if(cards.length>100)throw Error('Reddit returned an unexpected post listing.');
    for(const tracker of cards){
      try{
        const context=JSON.parse(tracker.getAttribute('data-faceplate-tracking-context')),id=context.post?.id;
        // Reddit's newer search cards: search-post-with-content-preview > sdui-post-unit (title, counters).
        const card=tracker.querySelector('[data-testid="search-crosspost-unit"],[data-testid="search-post-unit"],[data-testid="search-post-with-content-preview"],[data-testid="sdui-post-unit"]');
        const detail=[tracker,...tracker.querySelectorAll('search-telemetry-tracker')].map(node=>JSON.parse(node.getAttribute('data-faceplate-tracking-context') || '{}')).find(value=>value.post?.id===id && value.profile?.name);
        if(!M.validateId(id) || detail?.profile?.name?.toLowerCase()!==username.toLowerCase() || !card)throw Error();
        const title=card.querySelector('a[data-testid="post-title"],a[data-testid="post-title-text"]'),permalink=new URL(title?.getAttribute('href'),location.origin);
        if(permalink.origin!==location.origin || permalink.pathname.match(/\/comments\/([a-z0-9]{1,10})(?:\/|$)/i)?.[1]!==id.slice(3))throw Error();
        const crosspost=card.getAttribute('data-testid')==='search-crosspost-unit';
        const counter=card.querySelector(crosspost?':scope > [data-testid="search-counter-row"]':'[data-testid="search-counter-row"]'),numbers=[...counter.querySelectorAll('faceplate-number[number]')].map(node=>Number(node.getAttribute('number')));
        if(numbers.length<2 || !numbers.every(Number.isFinite))throw Error();
        const post=M.normalizePost({id,author:detail.profile.name,title:context.post.title,subreddit:context.subreddit?.name,
          created_utc:Date.parse((card.querySelector('faceplate-timeago[ts]') || tracker.querySelector('faceplate-timeago[ts]'))?.getAttribute('ts'))/1000,
          score:numbers[0],num_comments:numbers[1],permalink:permalink.href,status:'unknown',thumbnail:card.querySelector('faceplate-img[data-testid="search_post_thumbnail"],img[data-testid="search_post_thumbnail"]')?.getAttribute('src') || undefined,subredditIcon:card.querySelector('.post-credit-row img[src],[avatar] img[src]')?.getAttribute('src') || undefined,subredditColor:card.querySelector('.post-credit-row img[src],[avatar] img[src]')?.getAttribute('style')?.match(/background:\s*(#[0-9a-f]{6})\b/i)?.[1],
          over_18:context.post.nsfw===true || context.subreddit?.nsfw===true || detail.post.nsfw===true,spoiler:context.post.spoiler===true || detail.post.spoiler===true});
        if(!post)throw Error();if(!seen.has(id)){seen.add(id);posts.push(post);}
      }catch{unread++;}
    }
    // One unusual card is skipped; only a page where no card can be read means the format changed.
    if(cards.length && !posts.length && unread)throw Error('Reddit’s post search format changed. Posts could not be read safely.');
    const cursor=searchCursor(doc,username,'posts',sort,range,{q,search});
    if(!cards.length && !cursor){const empty=doc.querySelector('search-telemetry-tracker[view-events="search/view/no_results"]');let reason;try{reason=JSON.parse(empty?.getAttribute('data-faceplate-tracking-context')).action_info?.reason;}catch{}if(reason!=='empty')throw Error('Reddit returned an unrecognized post search response.');}
    return {posts,after:postPageCursor(cursor,'shreddit',username,sort,range,q),hasMore:Boolean(cursor),incomplete:true,source:'reddit'};
  }
  function commentListing(text,username,{sort='new',range='all',stream='authenticated',q=authorQuery(username),search=false}={}){
    const doc=new DOMParser().parseFromString(text,'text/html'),posts=[],seen=new Set();let unread=0,foreign=0;
    const cards=doc.querySelectorAll('[data-testid="search-sdui-comment-unit"]');
    // The comment's author: a profile link outside the comment text, relative or absolute (Reddit moved to absolute
    // https://www.reddit.com/user/<name>/ links), or the older href="#" link; "u/" prefixes are ignored.
    const authorOf=card=>{for(const a of card.querySelectorAll('a[href="#"],a[href*="/user/"]')){if(a.closest('[id$="-post-rtjson-content"],[data-testid="search-comment-content"] p'))continue;
      const fromHref=(a.getAttribute('href') || '').match(/^(?:https:\/\/(?:www\.)?reddit\.com)?\/user\/([A-Za-z0-9_-]{3,20})\/?$/)?.[1],fromText=a.textContent.trim().replace(/^\/?u\//i,'');
      const name=fromHref || (/^[A-Za-z0-9_-]{3,20}$/.test(fromText)?fromText:'');if(name)return name;}return '';};
    if(cards.length>100)throw Error('Reddit returned an unexpected comment listing.');
    for(const card of cards){
      try{
        const context=JSON.parse(card.closest('search-telemetry-tracker')?.getAttribute('data-faceplate-tracking-context') || '{}');
        const content=card.querySelector('[data-testid="search-comment-content"]');
        const author=authorOf(card);
        // Another person's comment is skipped, not a sign that the format changed.
        if(author && author.toLowerCase()!==username.toLowerCase()){foreign++;continue;}
        if(!author)throw Error('no author');
        const parts=[...content.querySelectorAll('[id$="-post-rtjson-content"] p')].map(p=>p.textContent.trim());
        const body=parts.length?parts.join('\n\n'):content.querySelector('[id$="-post-rtjson-content"]')?.textContent?.trim();
        const post=M.normalizeComment({id:context.comment?.id,author,body,link_id:context.comment?.post_id || context.post?.id,
          ...(Object.hasOwn(context.comment || {},'parent_id')?{parent_id:context.comment.parent_id}:{}),link_title:context.post?.title,subreddit:context.subreddit?.name,over_18:context.post?.nsfw===true || context.subreddit?.nsfw===true,spoiler:context.post?.spoiler,
          created_utc:Date.parse(content.querySelector('faceplate-timeago')?.getAttribute('ts'))/1000,
          score:Number(content.querySelector('faceplate-number')?.getAttribute('number')) || 0,
          ...(counts=>counts.length>=2 && counts.every(Number.isFinite)?{postScore:counts[0],postComments:counts[1]}:{})([...(card.querySelector(':scope [data-testid="search-counter-row"]')?.querySelectorAll('faceplate-number[number]') || [])].map(node=>Number(node.getAttribute('number')))),
          subredditIcon:card.querySelector('.shreddit-subreddit-icon__icon img[src],[avatar] img[src]')?.getAttribute('src') || undefined,subredditColor:card.querySelector('.shreddit-subreddit-icon__icon img[src],[avatar] img[src]')?.getAttribute('style')?.match(/background:\s*(#[0-9a-f]{6})\b/i)?.[1],
          permalink:card.querySelector('a[aria-labelledby^="comment-content-"]')?.getAttribute('href')});
        if(!post)throw Error('unreadable');if(!seen.has(post.fullname)){seen.add(post.fullname);posts.push(post);}
      }catch{unread++; /* A malformed card cannot become an unsafe or misattributed result. */ }
    }
    // Only a page where cards exist but none could be read means the format changed (contract R13).
    if(cards.length && !posts.length && unread)throw Error('Reddit’s comment format changed. Comments could not be read.');
    // Only other people's comments: Reddit didn't apply the author filter, so this page can't be trusted.
    if(cards.length && !posts.length && foreign)throw Error('Reddit’s comment search returned other people’s comments instead of this profile’s.');
    const cursor=searchCursor(doc,username,'comments',sort,range,{q,search});
    if(!cards.length && !cursor){let reason;try{reason=JSON.parse(doc.querySelector('search-telemetry-tracker[view-events="search/view/no_results"]')?.getAttribute('data-faceplate-tracking-context')).action_info?.reason;}catch{}if(reason!=='empty')throw Error('Reddit returned an unrecognized comment search response.');}
    const after=commentPageCursor(cursor,stream,username,sort,range,q);
    return {posts,after,hasMore:Boolean(after),incomplete:true,source:'reddit'};
  }
  // A profile that may be mounted by the extension (blocked-profile check) reads
  // the navigation alongside that check, so the page shows Reddit's navigation
  // as soon as it mounts instead of waiting for a second read.
  const earlyNavigation='early-navigation';
  function prefetchNavigation(input){
    const context=route();
    if(location.protocol!=='https:' || !['reddit.com','www.reddit.com','new.reddit.com','sh.reddit.com'].includes(location.hostname) || !context?.username || !M.validateUsername(input.username) || context.username.toLowerCase()!==input.username.toLowerCase() || ['url','origin','method','headers'].some(key=>input[key]!==undefined))throw Error('Open the matching Reddit profile.');
    if(Date.now()<cooldown || document.querySelector('flex-left-nav-container#left-sidebar-container'))return {started:false};
    navigationText(earlyNavigation).catch(()=>{});return {started:true};
  }
  function navigationText(lease){
    const now=Date.now(),app=document.querySelector('shreddit-app');for(const [key,value] of navigationReads)if(value.expires<=now || value.app!==app)navigationReads.delete(key);
    const cached=navigationReads.get(lease);if(cached)return cached.promise;
    const early=lease!==earlyNavigation && navigationReads.get(earlyNavigation);if(early){navigationReads.delete(earlyNavigation);navigationReads.set(lease,early);return early.promise;}
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
    const promise=(async()=>{const response=await fetch(new URL('/',location.origin).href,{method:'GET',credentials:'include',redirect:'error',headers:{Accept:'text/html'},signal:controller.signal});if(response.status===429){const retry=Number(response.headers.get('retry-after'));cooldown=Date.now()+Math.max(1000,Math.min(3600000,(Number.isFinite(retry)&&retry>0?retry:60)*1000));throw Error('Reddit navigation is rate limited.');}if(!response.ok)throw Error('Reddit navigation could not be loaded.');const doc=new DOMParser().parseFromString(await boundedText(response),'text/html'),navigation=doc.querySelector('flex-left-nav-container#left-sidebar-container');if(!navigation)throw Error('Reddit returned no native navigation.');const bootstrap=navigation.closest('.grid-container')?.previousElementSibling;for(const script of navigation.querySelectorAll('script'))script.remove();const boot=bootstrap?.tagName==='FACEPLATE-LOADER'?bootstrap.cloneNode(false).outerHTML:'';return boot+'<div class="grid-container">'+navigation.outerHTML+'</div>';})().finally(()=>clearTimeout(timer));
    if(navigationReads.size>=2)navigationReads.delete(navigationReads.keys().next().value);const entry={app,promise,expires:now+30000};navigationReads.set(lease,entry);promise.catch(()=>{if(navigationReads.get(lease)===entry)navigationReads.delete(lease);});return promise;
  }
  function nativeModuleSpec(loader){
    const src=loader?.getAttribute('src') || '',prefix=loader?.getAttribute('data-prefix') || '',chunks=src.startsWith('concat:')?src.slice(7).split(','):[];
    return loader?.tagName==='FACEPLATE-LOADER' && chunks.length && chunks.length<=512 && chunks.every(id=>/^[A-Za-z0-9_-]{1,80}$/.test(id)) && /^[A-Za-z0-9_-]{1,30}\/$/.test(prefix)?{chunks,prefix}:null;
  }
  async function renderNavigation(input,signal){
    const context=route(),target=typeof input.target==='string' && /^rt-nav-[a-z0-9-]{1,60}$/i.test(input.target)?document.getElementById(input.target):null;
    const profileShell=target?.closest('[data-rt-ui="archive-profile"]'),communityShell=target?.closest('[data-rt-ui="archive-subreddit"]'),shell=profileShell || communityShell;
    const communityName=()=>location.pathname.match(/^\/r\/([A-Za-z0-9_]{2,21})(?:\/(?:search|comments(?:\/.*)?))?\/?$/i)?.[1]?.toLowerCase();
    const communityAllowed=Boolean(communityShell && target?.dataset.rtUi==='community-navigation' && /^[A-Za-z0-9_]{2,21}$/.test(input.subreddit || '') && communityName()===input.subreddit.toLowerCase() && communityShell.dataset.rtSubreddit?.toLowerCase()===input.subreddit.toLowerCase());
    const profileAllowed=Boolean(profileShell && context?.username && M.validateUsername(input.username) && context.username.toLowerCase()===input.username.toLowerCase() && target?.dataset.rtUi==='profile-navigation');
    if(location.protocol!=='https:' || !['reddit.com','www.reddit.com','new.reddit.com','sh.reddit.com'].includes(location.hostname) || !shell || !(profileAllowed || communityAllowed))throw Error('Open the matching archived profile or community.');
    const now=Date.now();if(now<cooldown || active>=2)return {deferred:true,retryAfterMs:Math.max(100,now<cooldown?cooldown-now:250)};
    const Renderer=customElements.get('faceplate-partial');if(typeof Renderer?.prototype?._renderContent!=='function')return {deferred:true,retryAfterMs:250};
    const controller=new AbortController(),cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();let timer;active++;
    try{return await Promise.race([(async()=>{
      // Only the native navigation fragment is attached. Homepage/feed markup,
      // credentials and personalized HTML never cross into the isolated world.
      const lease=typeof input.navigationLease==='string' && /^[a-z0-9-]{1,60}$/i.test(input.navigationLease)?input.navigationLease:input.target;
      const doc=new DOMParser().parseFromString(await navigationText(lease),'text/html'),navigation=doc.querySelector('flex-left-nav-container#left-sidebar-container');if(!navigation)throw Error('Reddit returned no native navigation.');
      const bootstrap=navigation.closest('.grid-container')?.previousElementSibling,specs=[];
      if(!customElements.get('flex-left-nav-container')){const spec=nativeModuleSpec(bootstrap);if(!spec || typeof window.SML?.load!=='function')throw Error('Reddit’s navigation controller is unavailable.');specs.push(spec);}
      // Parsed SSR scripts do not initialize eager sidebar modules. Ask the
      // native loader to prepare those modules before revealing the fragment.
      if(typeof window.SML?.load==='function')for(const loader of navigation.querySelectorAll('faceplate-loader[loading="eager"]')){const spec=nativeModuleSpec(loader);if(spec)specs.push(spec);}
      const groups=new Map();for(const spec of specs){if(!groups.has(spec.prefix))groups.set(spec.prefix,new Set());for(const id of spec.chunks)groups.get(spec.prefix).add(id);}await Promise.all([...groups].map(([prefix,chunks])=>window.SML.load([...chunks],prefix,'auto')));
      if(!customElements.get('flex-left-nav-container'))throw Error('Reddit’s navigation controller could not be initialized.');
      for(const script of navigation.querySelectorAll('script'))script.remove();
      // The fragment comes from the home page, so its server-rendered top section (declarative shadow root) shows
      // Home selected. A subreddit page selects none: drop that snapshot so the defined element renders itself
      // from selectedpagetype instead of hydrating the home page's selection.
      if(communityAllowed)for(const top of navigation.querySelectorAll('left-nav-top-section')){top.setAttribute('selectedpagetype','community');if(customElements.get('left-nav-top-section'))for(const snapshot of top.querySelectorAll(':scope>template[shadowrootmode],:scope>template[shadowroot]'))snapshot.remove();}
      const current=route();if(controller.signal.aborted || !target.isConnected || document.getElementById(input.target)!==target || target.closest(profileAllowed?'[data-rt-ui="archive-profile"]':'[data-rt-ui="archive-subreddit"]')!==shell || (profileAllowed?(current?.username?current.username.toLowerCase()!==input.username.toLowerCase():!current?.id):communityName()!==input.subreddit.toLowerCase()))throw Error('Page changed. Try again.');
      // Seed the native controller before connection so SSR's expanded default cannot widen a collapsed layout
      // (archived communities and deleted profiles alike).
      navigation.setAttribute('expanded',shell.classList.contains('flex-nav-collapsed')?'0':'1');
      navigation.setAttribute('parent-grid-selector',communityAllowed?'[data-rt-ui="archive-subreddit"]':'[data-rt-ui="archive-profile"]');navigation.setAttribute('no-animate','');
      const partial=document.createElement('faceplate-partial');partial.loading='programmatic';partial.renderMode='contents';partial.style.display='contents';target.replaceChildren(partial);partial._renderContent(navigation.outerHTML);return {rendered:true};
    })(),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Reddit navigation loading timed out.'));},10000);})]);}finally{active--;clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
  }
  async function loadArchiveCommentModules(input,signal){
    const match=location.pathname.match(/^\/r\/([A-Za-z0-9_]{2,21})\/comments\/([a-z0-9]{1,10})(?:\/|$)/i),shell=document.querySelector('[data-rt-ui="archive-subreddit"]');
    if(!match || !shell || shell.dataset.rtSubreddit?.toLowerCase()!==match[1].toLowerCase() || input.postId!==match[2].toLowerCase())throw Error('Open the matching archived thread.');
    const current=()=>!signal?.aborted && shell.isConnected && document.querySelector('[data-rt-ui="archive-subreddit"]')===shell && location.pathname.match(/^\/r\/([A-Za-z0-9_]{2,21})\/comments\/([a-z0-9]{1,10})(?:\/|$)/i)?.slice(1,3).join('/').toLowerCase()===match.slice(1,3).join('/').toLowerCase();
    const required=['shreddit-comment','shreddit-comment-action-row','shreddit-comment-share-button','faceplate-progress'];
    const specs=[...document.querySelectorAll('faceplate-loader')].filter(node=>/^(PdpStandardClientAssets|CommentActionRowFull|CommentShareMenu)_/.test(node.getAttribute('name') || '')).map(nativeModuleSpec).filter(Boolean);
    const controller=new AbortController();let timer,abort;
    try{
      await Promise.race([(async()=>{
        if(required.some(name=>!customElements.get(name)) && typeof window.SML?.load==='function')await Promise.all(specs.map(spec=>window.SML.load(spec.chunks,spec.prefix,'auto')));
        if(!current())throw Error('Page changed. Try again.');
        if(required.some(name=>!customElements.get(name)) && typeof window.SML?.load==='function'){
          const comment=[...shell.querySelectorAll('shreddit-comment[data-rt-ui="archive-thread-comment"]')].find(node=>/^t1_[a-z0-9]{1,10}$/.test(node.id) && node.getAttribute('thingid')===node.id && node.getAttribute('postid')==='t3_'+input.postId);
          if(comment){
            const url=new URL('/svc/shreddit/comment/'+comment.id,location.origin);url.searchParams.set('depth','0');url.searchParams.set('subredditName',match[1]);
            const response=await fetch(url.href,{method:'GET',credentials:'include',redirect:'error',headers:{Accept:'text/vnd.reddit.partial+html'},signal:controller.signal});
            if(!response.ok)throw Error('Reddit comment components could not be loaded.');
            const doc=new DOMParser().parseFromString(await boundedText(response),'text/html');
            if(!current() || !comment.isConnected || !shell.contains(comment))throw Error('Page changed. Try again.');
            const loaders=[...doc.querySelectorAll('faceplate-loader')].filter(node=>/^Comment\$1_[A-Za-z0-9_-]+$/.test(node.getAttribute('name') || '')).map(nativeModuleSpec).filter(Boolean);
            if(!loaders.length)throw Error('Reddit comment components are unavailable on this page.');
            await Promise.all(loaders.map(spec=>window.SML.load(spec.chunks,spec.prefix,'auto')));
          }
        }
        if(!current())throw Error('Page changed. Try again.');
        if(required.some(name=>!customElements.get(name)))throw Error('Reddit comment components are unavailable on this page.');
      })(),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Reddit comment components timed out.'));},10000);abort=()=>{controller.abort();reject(Error('Page changed. Try again.'));};signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();})]);
      return {loaded:true};
    }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }
  function refreshArchiveThread(input){
    const match=location.pathname.match(/^\/r\/([A-Za-z0-9_]{2,21})\/comments\/([a-z0-9]{1,10})(?:\/|$)/i),shell=document.querySelector('[data-rt-ui="archive-subreddit"]');
    if(!match || !shell || shell.dataset.rtSubreddit?.toLowerCase()!==match[1].toLowerCase() || input.postId!==match[2].toLowerCase())throw Error('Open the matching archived thread.');
    for(const node of shell.querySelectorAll('shreddit-comment[data-rt-ui="archive-thread-comment"]'))if(node.getAttribute('postid')==='t3_'+input.postId && typeof node.updateChildren==='function')node.updateChildren();
    return {refreshed:true};
  }
  const emptySearchSelector='[data-testid="search-error-message"]';
  async function renderSearchEmpty(input,signal){
    const context=route(),path=pageKey(),target=typeof input.target==='string' && /^rt-search-empty-[a-z0-9-]{1,60}$/i.test(input.target)?document.getElementById(input.target):null;
    if(location.protocol!=='https:' || !['reddit.com','www.reddit.com','new.reddit.com','sh.reddit.com'].includes(location.hostname) || !/\/search\/?$/.test(location.pathname) || !context?.username || !M.validateUsername(input.username) || context.username.toLowerCase()!==input.username.toLowerCase() || target?.dataset.rtUi!=='search-empty' || !target.closest('main'))throw Error('Open the matching profile search.');
    if(typeof customElements.get('faceplate-partial')?.prototype?._renderContent!=='function')return {deferred:true,retryAfterMs:250};
    const app=document.querySelector('shreddit-app'),now=Date.now(),key=context.username.toLowerCase();for(const [k,v] of emptySearchReads)if(v.app!==app || v.expires<=now)emptySearchReads.delete(k);
    // Reddit's no-results view is [data-testid="search-error-message"] inside a telemetry wrapper; only the view itself is reused.
    let root=[...document.querySelectorAll(emptySearchSelector)].find(node=>!node.closest('[data-rt-ui]'))?.cloneNode(true),cached=emptySearchReads.get(key);
    if(!root && cached)root=new DOMParser().parseFromString(cached.html,'text/html').body.firstElementChild;
    if(!root){
      if(now<cooldown || active>=2)return {deferred:true,retryAfterMs:Math.max(250,now<cooldown?cooldown-now:250)};
      const url=new URL('/user/'+encodeURIComponent(context.username)+'/search/',location.origin);url.searchParams.set('q','"rt-empty-'+crypto.randomUUID()+'"');url.searchParams.set('type','posts');url.searchParams.set('t','hour');
      active++;try{const response=await fetch(url.href,{credentials:'include',cache:'no-store',redirect:'error',headers:{Accept:'text/html'},signal});if(!response.ok)throw Error('Reddit could not load its empty search view (HTTP '+response.status+').');const doc=new DOMParser().parseFromString(await boundedText(response,6000000),'text/html');root=doc.querySelector(emptySearchSelector);if(!root)throw Error('Reddit returned no native empty search view.');if(emptySearchReads.size>=4)emptySearchReads.delete(emptySearchReads.keys().next().value);emptySearchReads.set(key,{html:root.outerHTML,app,expires:now+300000});}finally{active--;}
    }
    if(signal?.aborted || pageKey()!==path || document.getElementById(input.target)!==target)throw Error('Page changed. Try again.');
    root.removeAttribute('id');root.removeAttribute('hidden');root.removeAttribute('data-rt-search-hidden');root.classList.remove('hidden');if(root.style.display==='none')root.style.removeProperty('display');
    const template=document.createElement('template');template.innerHTML='<faceplate-partial loading="programmatic" render-mode="contents" style="display:contents"></faceplate-partial>';const partial=template.content.firstElementChild;target.replaceChildren(partial);partial._renderContent(root.outerHTML);return {rendered:true};
  }
  async function renderControls(input,signal){
    const context=route(),path=pageKey(),target=typeof input.target==='string' && /^rt-controls-[a-z0-9-]{1,60}$/i.test(input.target)?document.getElementById(input.target):null;
    if(location.protocol!=='https:' || !['reddit.com','www.reddit.com','new.reddit.com','sh.reddit.com'].includes(location.hostname) || !context?.username || !M.validateUsername(input.username) || context.username.toLowerCase()!==input.username.toLowerCase() || target?.dataset.rtUi!=='profile-controls' || !target.closest('main'))throw Error('Open the matching public profile.');
    if(typeof customElements.get('faceplate-partial')?.prototype?._renderContent!=='function')return {deferred:true,retryAfterMs:250};
    const params=new URLSearchParams(location.search),sort=/\/search\/?$/.test(location.pathname)?'new':params.get('sort') || 'new',range=params.get('t') || 'all',view=params.get('feedViewType') || 'cardView';
    if(!['new','hot','top'].includes(sort) || !['hour','day','week','month','year','all'].includes(range) || !['cardView','compactView'].includes(view))throw Error('Unsupported native feed controls.');
    const now=Date.now(),app=document.querySelector('shreddit-app'),key=[sort,range,view].join(':');for(const [k,v] of controlReads)if(v.app!==app || v.expires<=now)controlReads.delete(k);
    let cached=controlReads.get(key);
    if(!cached){
      if(now<cooldown || active>=2)return {deferred:true,retryAfterMs:Math.max(250,now<cooldown?cooldown-now:250)};
      // A fixed public profile supplies Reddit's native profile controls even
      // when the viewed account has no native feed. Never import its activity.
      const url=new URL('/user/reddit/submitted/',location.origin);url.searchParams.set('sort',sort);if(sort==='top')url.searchParams.set('t',range);url.searchParams.set('feedViewType',view);
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);active++;
      const promise=(async()=>{const response=await fetch(url.href,{method:'GET',credentials:'include',redirect:'error',headers:{Accept:'text/html'},signal:controller.signal});if(response.status===429){const retry=Number(response.headers.get('retry-after'));cooldown=Date.now()+Math.max(1000,Math.min(3600000,(Number.isFinite(retry)&&retry>0?retry:60)*1000));throw Error('Reddit feed controls are rate limited.');}if(!response.ok)throw Error('Reddit feed controls could not be loaded.');const doc=new DOMParser().parseFromString(await boundedText(response),'text/html'),button=doc.querySelector('button[aria-label="Feed options"]'),dropdown=button?.closest('rpl-dropdown'),root=button?.closest('shreddit-layout-event-setter') || dropdown;if(!dropdown?.querySelector('.main-menu-container') || !root)throw Error('Reddit returned no native profile controls.');for(const node of root.querySelectorAll('script,ac-track,input,form'))node.remove();return root.outerHTML;})().finally(()=>{clearTimeout(timer);active--;});
      cached={app,expires:now+30000,promise};if(controlReads.size>=4)controlReads.delete(controlReads.keys().next().value);controlReads.set(key,cached);promise.catch(()=>{if(controlReads.get(key)===cached)controlReads.delete(key);});
    }
    const doc=new DOMParser().parseFromString(await cached.promise,'text/html'),root=doc.body.firstElementChild;
    if(signal?.aborted || path!==pageKey() || !target.isConnected || document.getElementById(input.target)!==target)throw Error('Page changed. Try again.');
    for(const row of root.querySelectorAll('rpl-menu-item[href]')){const old=new URL(row.getAttribute('href'),location.origin);if(old.origin!==location.origin || old.pathname!=='/user/reddit/submitted/')throw Error('Unexpected native control destination.');const next=new URL(path,location.origin);if(/\/search\/?$/.test(location.pathname))next.search=location.search;for(const name of ['sort','t','feedViewType'])if(old.searchParams.has(name))next.searchParams.set(name,old.searchParams.get(name));if(old.searchParams.has('sort') && old.searchParams.get('sort')!=='top')next.searchParams.delete('t');row.setAttribute('href',next.pathname+next.search);}
    if(/\/comments\/?$/.test(location.pathname)){
      // The Comments tab gets the same Sort & filter trigger and menu Reddit renders
      // on Posts. Only the View section is dropped, because the Comments tab has
      // no Card/Compact choice (unless Reddit shows its own layout control here).
      if(!root.querySelector('button[aria-label="Feed options"]'))throw Error('Reddit returned no native feed trigger.');
      const nativeView=[...document.querySelectorAll('main [aria-label="View"],main [data-testid="feed-view-toggle"],main shreddit-layout-switcher')].some(node=>!node.closest('shreddit-feed,[data-rt-ui]'));
      const menu=root.querySelector('.main-menu-container');
      if(menu && !nativeView){let drop=false;for(const node of [...menu.children]){if(node.tagName==='DIV'){drop=node.textContent.trim().toLowerCase()==='view';if(drop)node.remove();}else if(drop&&node.matches('rpl-menu-item'))node.remove();}}
    }
    const partial=document.createElement('faceplate-partial');partial.loading='programmatic';partial.renderMode='contents';partial.style.display='contents';target.replaceChildren(partial);partial._renderContent(root.outerHTML);return {rendered:true};
  }
  function nativeCardUrl(comments,fullname){
    const tag=comments?'shreddit-profile-comment':'shreddit-post',sample=[...document.querySelectorAll('main '+tag)].find(node=>!node.closest('[data-rt-ui]'));
    // Prefer Reddit's own reload contract when present. Only replace the exact
    // item's terminal fullname; never accept arbitrary paths/query credentials.
    const identity=sample?.getAttribute(comments?'comment-id':'id'),reload=sample?.getAttribute('reload-url');
    if(identity && reload){try{
      const url=new URL(reload,location.origin),prefix=comments?'t1_':'t3_',validIdentity=comments?M.validateCommentId(identity):M.validateId(identity);
      if(validIdentity && identity.startsWith(prefix) && url.origin===location.origin && !url.username && !url.password && !url.hash && new RegExp('^/svc/shreddit/(?:[a-z][a-z0-9-]*/){1,3}'+identity+'$').test(url.pathname) && [...url.searchParams].every(([key,value])=>key==='isProfile'?value==='true':key==='pvc'?/^Profile[A-Za-z0-9]{0,24}$/.test(value):key==='fvt' && /^[A-Za-z][A-Za-z0-9]{0,31}$/.test(value))){url.pathname=url.pathname.slice(0,-identity.length)+fullname;return url;}
    }catch{ /* Fall back to the last verified native endpoint. */ }}
    const url=new URL(comments?'/svc/shreddit/comment/'+fullname:'/svc/shreddit/partial-feed-post/'+fullname,location.origin);
    if(comments)url.searchParams.set('isProfile','true');else{
      const view=new URLSearchParams(location.search).get('feedViewType') || sample?.getAttribute('view-type'),context=sample?.getAttribute('view-context');
      url.searchParams.set('pvc',context && /^Profile[A-Za-z0-9]{0,24}$/.test(context)?context:'ProfileFeed2');
      url.searchParams.set('fvt',view && /^[A-Za-z][A-Za-z0-9]{0,31}$/.test(view)?view:'cardView');
    }
    return url;
  }
  function nativeStatus(doc,comments,fullname,username){
    const node=doc.querySelector(comments?`shreddit-profile-comment[comment-id="${fullname}"]`:`shreddit-post[id="${fullname}"]`);
    if(!node)return null;
    // Profile comment cards no longer carry an author attribute; their poster line links the author first.
    const poster=comments?node.querySelector('[id^="poster-info-"] a[href^="/user/"]')?.getAttribute('href')?.match(/^\/user\/([\w-]{1,20})\/?$/)?.[1]:'';
    const author=node.getAttribute('author') || node.querySelector('shreddit-comment-action-row[author]')?.getAttribute('author') || poster || '';
    // A deleted account is not proof that this particular item was deleted.
    // Likewise, absent content can be a gated or malformed fragment.
    if(author && author!=='[deleted]' && author.toLowerCase()!==username.toLowerCase())return null;
    const state=node.getAttribute('item-state')?.toLowerCase(),body=node.querySelector(comments?'[id$="-post-rtjson-content"],.md':'[slot="text-body"]'),text=body?.textContent?.trim();
    const flag=name=>node.hasAttribute(name) && node.getAttribute(name)!=='false';
    let status=M.domStatus(node) || M.noticeStatus(text) || 'unknown';
    if(status==='unknown' && (!state || ['normal','active','visible','available','unmoderated'].includes(state)) && M.validateUsername(author) && Number.isFinite(Date.parse(node.getAttribute('created-timestamp') || node.querySelector('faceplate-timeago[ts]')?.getAttribute('ts'))) && (comments?Boolean(text):Boolean(node.getAttribute('post-title'))))status='available';
    if(status==='unknown')return null;
    return {fullname,status,author,over18:flag('nsfw'),spoiler:flag('spoiler')};
  }
  function rememberStatus(path,fullname,status){
    if(!status)return;
    const now=Date.now();for(const [key,value] of statusReads)if(value.expires<=now)statusReads.delete(key);
    if(statusReads.size>=100)statusReads.delete(statusReads.keys().next().value);
    statusReads.set(path+'|'+fullname,{status,expires:now+30000});
  }
  function trimNativeReads(path){
    let size=0,count=0;const now=Date.now();
    for(const [key,entry] of nativeCardReads){if(entry.pending)continue;if(entry.path!==path || entry.expires<=now)nativeCardReads.delete(key);else{size+=entry.size;count++;}}
    // Authenticated fragments are transient page-world data, never persisted or
    // sent over the bridge. Bound both their total size and their lifetime.
    for(const [key,entry] of nativeCardReads){if(size<=5000000 && count<=25)break;if(entry.pending)continue;nativeCardReads.delete(key);size-=entry.size;count--;}
  }
  function waitNative(promise,signal,release=()=>{}){
    return new Promise((resolve,reject)=>{
      let settled=false;const finish=(callback,value)=>{if(settled)return;settled=true;signal.removeEventListener('abort',cancel);release();callback(value);},cancel=()=>finish(reject,Error('Post request cancelled.'));
      signal.addEventListener('abort',cancel,{once:true});promise.then(value=>finish(resolve,value),error=>finish(reject,error));if(signal.aborted)cancel();
    });
  }
  function consumeNative(entry,signal){
    // Each consumer cancels only its own wait. Abort the physical read when its
    // last consumer leaves, so a status timeout cannot cancel an active render.
    entry.consumers++;
    return waitNative(entry.promise,signal,()=>{entry.consumers--;if(entry.pending && !entry.consumers)entry.controller.abort();});
  }
  function anonymousCardUrl(comments,fullname,input){
    const url=new URL(comments?'/svc/shreddit/comment/'+fullname:'/svc/shreddit/partial-feed-post/'+fullname,location.origin);
    url.searchParams.set('isProfile','true');
    if(!comments){
      const view=input?.view || new URLSearchParams(location.search).get('feedViewType');
      if(view==='compactView'){url.searchParams.set('pvc','ProfileFeed2');url.searchParams.set('fvt','compactView');}
    }
    return url;
  }
  const publicBrowserSupported=()=>Boolean(globalThis.RTPublicBrowser && (typeof RTPublicBrowser.isSupported!=='function' || RTPublicBrowser.isSupported()));
  function markReadOnlyCard(native){
    if(!native)return;
    native.dataset.rtAnonymousCard='true';
    const disable=el=>{if(!el)return;el.setAttribute('inert','');el.setAttribute('aria-disabled','true');if(el.tagName==='BUTTON')el.disabled=true;};
    const voteSelector='button[upvote],button[downvote],button[aria-label*="upvote" i],button[aria-label*="downvote" i],.rpl-vote-button-group button[aria-pressed]';
    const interactiveVoteSelector=voteSelector+',button[aria-label*="reply" i],[slot="comment-reply"],button[aria-label*="award" i],award-button,[data-post-click-location="vote"]';
    const overflowSelector='shreddit-post-overflow-menu,shreddit-overflow-menu,shreddit-comment-overflow-menu';
    const keepActionSelector='slot:is([name="share-button"],[name="comment-share"]),[data-rt-download],shreddit-post-share-button,shreddit-comment-share-button,button[aria-label*="share" i],a[href*="/comments/"]:not([slot="comment-reply"])';
    const hasPreservedAction=container=>Boolean(container.querySelector(keepActionSelector) || [...container.querySelectorAll('button')].some(btn=>btn.textContent.trim().toLowerCase()==='share'));
    const roots=[native,...(native.shadowRoot?[native.shadowRoot]:[])];
    for(const root of roots){
      for(const row of root.querySelectorAll('rpl-action-bar,shreddit-comment-action-row')){
        if(row.matches('shreddit-comment-action-row') && row.getAttribute('vote-state')!=='NONE')row.setAttribute('vote-state','NONE');
        if(row.shadowRoot)roots.push(row.shadowRoot);
      }
      for(const group of root.querySelectorAll('.rpl-vote-button-group')){
        group.classList.remove('upvote','downvote');
        disable(group);
      }
      for(const vote of root.querySelectorAll(voteSelector)){
        vote.setAttribute('aria-pressed','false');
        if(vote.querySelector('.vote-icon-outline'))for(const icon of vote.querySelectorAll('.vote-icon-fill'))icon.style.setProperty('display','none','important');
      }
      for(const menu of root.querySelectorAll(overflowSelector))disable(menu);
      for(const bar of root.querySelectorAll('rpl-action-bar,shreddit-comment-action-row')){
        if(hasPreservedAction(bar) || bar.shadowRoot && hasPreservedAction(bar.shadowRoot)){
          for(const ctrl of bar.querySelectorAll(interactiveVoteSelector+','+overflowSelector))disable(ctrl);
        }else{
          disable(bar);
          bar.title='Signed-out preview · Vote and reply disabled';
        }
      }
      for(const ctrl of root.querySelectorAll(interactiveVoteSelector))disable(ctrl);
    }
  }
  // Comments are small fragments; share four physical reads across render and
  // status consumers, retaining the lower two-read limit for heavier posts.
  function nativeCapacity(comments){return cardActive<4 && (comments || postCardActive<2);}
  async function nativeFragment(comments,fullname,path,signal,{anonymous=false,input=null}={}){
    const key=path+'|'+(anonymous?'anon|':'')+fullname;
    if(anonymous){const text=signedOutCard(input?.username,fullname,comments,input);if(text)return {text,url:anonymousCardUrl(comments,fullname,input)};}
    while(true){
      if(signal.aborted || pageKey()!==path)throw Error('Page changed. Try again.');
      trimNativeReads(path);const cached=nativeCardReads.get(key);if(cached){if(cached.controller.signal.aborted){await waitNative(cached.promise.catch(()=>null),signal);continue;}return consumeNative(cached,signal);}
      if(!anonymous && Date.now()<cooldown)return {deferred:true,reason:'rate-limit',retryAfterMs:cooldown-Date.now()};
      if(nativeCapacity(comments))break;
      // Join existing reads before taking a slot; a busy renderer is not
      // evidence of an unknown status. Recheck the cache after a slot opens.
      await waitNative(Promise.race([...nativeCardReads.values()].filter(entry=>entry.pending).map(entry=>entry.promise.catch(()=>null))),signal);
    }
    const url=anonymous?anonymousCardUrl(comments,fullname,input):nativeCardUrl(comments,fullname),entry={path,pending:true,size:0,expires:Infinity,controller:new AbortController(),consumers:0};cardActive++;if(!comments)postCardActive++;
    entry.promise=(async()=>{
      let text;
      if(anonymous){
        text=await publicBrowserRead(url.href,entry.controller.signal,false);
      }else{
        const response=await fetch(url.href,{method:'GET',credentials:'include',redirect:'error',headers:{Accept:'text/vnd.reddit.partial+html, text/html;q=0.9'},signal:entry.controller.signal});
        if(response.status===429){const retry=Number(response.headers.get('retry-after'));cooldown=Date.now()+Math.max(1000,Math.min(3600000,(Number.isFinite(retry)&&retry>0?retry:60)*1000));return {deferred:true,reason:'rate-limit',retryAfterMs:cooldown-Date.now()};}
        if(!response.ok)throw Error(`Reddit could not render this card (HTTP ${response.status}).`);
        if(response.headers.get('content-type')?.split(';')[0].trim()!=='text/vnd.reddit.partial+html')throw Error('Reddit returned no native card fragment.');
        text=await boundedText(response);
      }
      const doc=new DOMParser().parseFromString(text,'text/html'),selector=comments?`shreddit-profile-comment[comment-id="${fullname}"]`:`shreddit-post[id="${fullname}"]`;
      // Reddit answers a comment its author deleted exactly like an ID that never existed: a small
      // shell with no comment card at all. Removed comments still get a card (body "[removed]").
      if(!doc.querySelector(selector)){
        if(!comments || doc.querySelector('shreddit-profile-comment,shreddit-comment') || text.length>65536)throw Error('Reddit returned no matching native card.');
        entry.size=text.length;entry.expires=Date.now()+30000;return {missing:true};
      }
      if(entry.controller.signal.aborted || pageKey()!==path)throw Error('Page changed. Try again.');
      entry.size=text.length;entry.expires=Date.now()+30000;return {text,url};
    })().finally(()=>{cardActive--;if(!comments)postCardActive--;entry.pending=false;if(!entry.size)nativeCardReads.delete(key);trimNativeReads(pageKey());});
    nativeCardReads.set(key,entry);return consumeNative(entry,signal);
  }
  // Cached evidence and rendered native cards already prove a status; they need no read.
  function knownStatus(path,comments,fullname,username){
    const cached=statusReads.get(path+'|'+fullname);if(cached?.expires>Date.now())return cached.status;
    const native=[...document.querySelectorAll(comments?`shreddit-profile-comment[comment-id="${fullname}"]`:`shreddit-post[id="${fullname}"]`)].find(node=>!node.closest('[data-rt-ui]'));
    return native?nativeStatus({querySelector:()=>native},comments,fullname,username):null;
  }
  // Legacy info is only a fast path. After any failure it is skipped for ten minutes; fragments remain the authority.
  let infoBlockedUntil=0;
  // One physical read covers every ID the cache and DOM could not prove. Only exact, authored
  // public evidence resolves here; omitted, foreign-authored or ambiguous IDs stay for fragments.
  async function infoStatuses(ids,comments,path,username,controller,signal){
    if(!ids.length || Date.now()<infoBlockedUntil)return [];
    const url=new URL('/api/info.json',location.origin);url.searchParams.set('id',ids.join(','));url.searchParams.set('raw_json','1');
    // Its own short deadline leaves the batch time to fall back to fragments.
    let children;const local=new AbortController(),link=()=>local.abort(),infoTimer=setTimeout(link,4000);controller.signal.addEventListener('abort',link,{once:true});if(controller.signal.aborted)link();
    try{
      const response=await fetch(url.href,{method:'GET',credentials:'include',redirect:'error',headers:{Accept:'application/json'},signal:local.signal});
      if(response.status===429){const retry=Number(response.headers.get('retry-after'));cooldown=Date.now()+Math.max(1000,Math.min(3600000,(Number.isFinite(retry)&&retry>0?retry:60)*1000));return [];}
      if(!response.ok)throw Error(`Reddit info could not be loaded (HTTP ${response.status}).`);
      const data=JSON.parse(await boundedText(response));
      if(!Array.isArray(data?.data?.children) || data.data.children.length>100)throw Error('Reddit returned an unexpected info response.');
      children=data.data.children;
    }catch{
      // Caller cancellation and route changes reject as before. Anything else, including our own deadline, disables only the fast path.
      if(signal?.aborted || pageKey()!==path)throw Error('Page changed. Try again.');
      infoBlockedUntil=Date.now()+600000;return [];
    }finally{clearTimeout(infoTimer);controller.signal.removeEventListener('abort',link);}
    if(controller.signal.aborted || pageKey()!==path)throw Error('Page changed. Try again.');
    const resolved=new Map();
    for(const child of children){
      if(child?.kind!==(comments?'t1':'t3'))continue;
      const item=(comments?M.normalizeComment:M.normalizePost)(child.data,{source:'reddit'});
      if(!item || !ids.includes(item.fullname) || resolved.has(item.fullname))continue;
      // Authorship must match this profile. A deleted account proves only its own tombstones, never that its content is available.
      const own=item.author.toLowerCase()===username.toLowerCase(),tombstone=item.author==='[deleted]' && item.status!=='available';
      if((own || tombstone) && ['available','deleted','removed'].includes(item.status))resolved.set(item.fullname,{fullname:item.fullname,status:item.status,author:item.author,over18:item.over18,spoiler:item.spoiler});
    }
    return [...resolved.values()];
  }
  async function readStatuses(input,signal){
    const context=route(),path=pageKey(),comments=input.kind==='comment';
    if(location.protocol!=='https:' || !['reddit.com','www.reddit.com','new.reddit.com','sh.reddit.com'].includes(location.hostname) || !context?.username || !M.validateUsername(input.username) || context.username.toLowerCase()!==input.username.toLowerCase())throw Error('Open the matching public profile.');
    if(!['post','comment'].includes(input.kind) || !Array.isArray(input.ids) || !input.ids.length || input.ids.length>25 || !input.ids.every(id=>comments?M.validateCommentId(id):M.validateId(id)))throw Error('Invalid public status IDs.');
    const requestedIds=[...new Set(input.ids.map(id=>(comments?'t1_':'t3_')+id.toLowerCase().replace(/^t[13]_/,'')))],statuses=[];
    const now=Date.now();if(now<cooldown)throw Error('Reddit asked us to wait. Try again shortly.');
    if(active>=2)return {deferred:true,retryAfterMs:250};
    const controller=new AbortController(),cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();active++;
    let timer,timedOut=false,fragmentReads=false;
    const remember=status=>{rememberStatus(path,status.fullname,status);statuses.push(status);};
    try{
      // One bounded, demand-driven batch. No background retry/sync loop, and no
      // authenticated HTML leaves the page world. Known evidence costs no read; the
      // rest share one info read, and only IDs it cannot prove reach the card budget.
      const operation=(async()=>{
        let ids=[];for(const fullname of requestedIds){const status=knownStatus(path,comments,fullname,input.username);if(status)remember(status);else ids.push(fullname);}
        const fast=await infoStatuses(ids,comments,path,input.username,controller,signal);
        fast.forEach(remember);ids=ids.filter(fullname=>!fast.some(status=>status.fullname===fullname));
        await Promise.all(Array.from({length:Math.min(2,ids.length)},async()=>{
          while(ids.length){
            const fullname=ids.shift();
            if(controller.signal.aborted || pageKey()!==path)throw Error('Page changed. Try again.');
            let status=knownStatus(path,comments,fullname,input.username);
            if(!status){
              fragmentReads=true;
              try{const fragment=await nativeFragment(comments,fullname,path,controller.signal);if(fragment.missing)status={fullname,status:'deleted',author:'[deleted]',over18:false,spoiler:false};else if(!fragment.deferred)status=nativeStatus(new DOMParser().parseFromString(fragment.text,'text/html'),comments,fullname,input.username);}
              catch{ /* A failed or missing fragment establishes no current status. */ }
            }
            if(controller.signal.aborted || pageKey()!==path)throw Error('Page changed. Try again.');
            if(status)remember(status);
          }
        }));
      })();
      try{await Promise.race([operation,new Promise(resolve=>{timer=setTimeout(()=>{timedOut=true;controller.abort();resolve();},10000);})]);}
      catch(error){if(!timedOut)throw error;}
      if(signal?.aborted || pageKey()!==path)throw Error('Page changed. Try again.');
      const verified=new Set(statuses.map(status=>status.fullname)),unknownIds=requestedIds.filter(id=>!verified.has(id));
      // "info" means no native fragment was needed for any ID, so the caller may use a larger batch.
      return {statuses,unknownIds,incomplete:unknownIds.length>0,...(timedOut?{timedOut:true}:{}),via:fragmentReads || unknownIds.length?'native':'info',source:'reddit'};
    }finally{active--;clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
  }
  async function renderCard(input,signal){
    const context=route(),path=pageKey(),comments=input.kind==='comment',anonymous=input.anonymous===true;
    if(location.protocol!=='https:' || !['reddit.com','www.reddit.com','new.reddit.com','sh.reddit.com'].includes(location.hostname))throw Error('Open a public Reddit profile.');
    if(!context?.username || !M.validateUsername(input.username) || context.username.toLowerCase()!==input.username.toLowerCase())throw Error('Profile changed. Try again.');
    if(!['post','comment'].includes(input.kind) || !(comments?M.validateCommentId(input.postId):M.validateId(input.postId)))throw Error('Invalid native card identity.');
    if(typeof input.target!=='string' || !/^rt-native-[a-z0-9-]{1,60}$/i.test(input.target))throw Error('Invalid native card target.');
    if(anonymous && !publicBrowserSupported())throw Error('Signed-out card rendering is unavailable in this browser.');
    const fullname=(comments?'t1_':'t3_')+input.postId.toLowerCase().replace(/^t[13]_/,''),target=document.getElementById(input.target);
    if(!target?.isConnected || target.dataset.rtUi!=='activity-item' || target.dataset.rtNativeFullname!==fullname || !target.closest('main'))throw Error('Native card target is no longer available.');
    const selector=comments?`shreddit-profile-comment[comment-id="${fullname}"]`:`shreddit-post[id="${fullname}"]`;
    const alreadyPresent=()=>[...document.querySelectorAll(selector)].some(node=>!target.contains(node) && !node.closest('[data-rt-search-hidden],[data-rt-profile-handoff]'));
    if(alreadyPresent())return {rendered:false,duplicate:true,fullname};
    const now=Date.now(),cacheKey=path+'|'+(anonymous?'anon|':'')+fullname;
    if((!anonymous && now<cooldown) || !nativeCapacity(comments) && !nativeCardReads.has(cacheKey) && !(anonymous && signedOutCard(input.username,fullname,comments,input)))return {deferred:true,retryAfterMs:Math.max(100,!anonymous && now<cooldown?cooldown-now:250)};
    if(typeof customElements.get('faceplate-partial')?.prototype?._renderContent!=='function'){
      const since=rendererWaits.get(target) ?? now;rendererWaits.set(target,since);
      if(now-since>=10000)throw Error('Reddit’s native card renderer did not become ready. Retry after the page finishes loading.');
      return {deferred:true,reason:'renderer-startup',retryAfterMs:250};
    }
    rendererWaits.delete(target);
    const controller=new AbortController(),cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
    let timer;
    try{
      const operation=(async()=>{
        const fragment=await nativeFragment(comments,fullname,path,controller.signal,{anonymous,input});if(fragment.deferred)return fragment;
        if(fragment.missing){if(!anonymous)rememberStatus(path,fullname,{fullname,status:'deleted',author:'[deleted]',over18:false,spoiler:false});throw Error('Reddit no longer has this comment.');}
        const {text,url}=fragment,doc=new DOMParser().parseFromString(text,'text/html');
        const evidence=nativeStatus(doc,comments,fullname,input.username);if(!anonymous)rememberStatus(path,fullname,evidence);
        if(pageKey()!==path || controller.signal.aborted || !target.isConnected || document.getElementById(input.target)!==target)throw Error('Page changed. Try again.');
        if(alreadyPresent())return {rendered:false,duplicate:true,fullname};
        // Card HTML stays in Reddit's page world. Use its own trusted fragment
        // renderer so component modules, media and native actions hydrate.
        const partial=document.createElement('faceplate-partial');partial.loading='programmatic';partial.src=url.pathname+url.search;partial.renderMode='contents';
        target.replaceChildren(partial);partial._renderContent(text);
        if(!target.querySelector(selector))throw Error('Reddit could not attach its native card.');
        const tag=comments?'shreddit-profile-comment':'shreddit-post';
        await waitNative(customElements.whenDefined(tag),controller.signal);
        const native=target.querySelector(selector);if(native?.updateComplete)await waitNative(Promise.resolve(native.updateComplete),controller.signal);
        if(pageKey()!==path || controller.signal.aborted || !target.isConnected || document.getElementById(input.target)!==target || !native || !target.contains(native))throw Error('Page changed. Try again.');
        if(anonymous)markReadOnlyCard(native);
        // The card Reddit just served is current evidence: report what it proves (available, deleted or removed).
        target.dataset.rtNativeState='ready';return {rendered:true,fullname,...(anonymous?{anonymous:true}:{}),...(evidence?{status:evidence.status}:{})};
      })();
      const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Native card loading timed out.'));},anonymous?20000:10000);});
      return await Promise.race([operation,timeout]);
    }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
  }
  // Comment headshot of an archived comment's original author, from native
  // markup or the signed-out-safe user hover card. Only an HTTPS
  // URL on Reddit's image hosts leaves the page world; cache it per username.
  const avatarReads=new Map(),avatarHosts=new Set(['styles.redditmedia.com','i.redd.it','preview.redd.it','cf.preview.redd.it','www.redditstatic.com']);
  // The hover card offers a custom avatar as the full-body Snoovatar; Reddit's
  // comments use its headshot, published next to it as <id>-headshot.png.
  const headshotOf=value=>{try{const url=new URL(value);if(url.hostname==='i.redd.it' && /^\/snoovatar\/avatars\/[0-9a-z-]+\.png$/i.test(url.pathname) && !/-headshot\.png$/i.test(url.pathname)){url.pathname=url.pathname.replace(/\.png$/i,'-headshot.png');url.search='';return url.href;}}catch{}return value;};
  const safeAvatar=value=>{try{const url=new URL(value);return url.protocol==='https:' && !url.username && !url.password && avatarHosts.has(url.hostname) && (!url.pathname.includes('/snoovatar/avatars/') || /-headshot\.[a-z]+$/i.test(url.pathname))?url.href:'';}catch{return '';}};
  const safeBanner=value=>{try{const url=new URL(String(value || '').replace(/&amp;/gi,'&'));return url.protocol==='https:' && !url.username && !url.password && !url.port && (avatarHosts.has(url.hostname) || ['a.thumbs.redditmedia.com','b.thumbs.redditmedia.com'].includes(url.hostname))?url.href:'';}catch{return '';}};
  function extractHoverAvatar(root){
    if(!root)return '';
    const headshot=[...root.querySelectorAll('[avatar] image[href],[avatar] img[src]')];
    const pool=headshot.length?headshot:[...root.querySelectorAll('img[alt*="avatar" i][src],img[src*="snoovatar"],img[src*="profileIcon"],img[src*="avatar_default"]')];
    for(const img of pool){
      const raw=img.getAttribute('href') || img.getAttribute('src') || '';
      if(/suspended-snoo/i.test(raw))continue;
      const candidate=safeAvatar(headshotOf(raw));
      if(candidate)return candidate;
    }
    return '';
  }
  async function userAvatar(input,signal){
    if(!M.validateUsername(input.username))throw Error('Invalid username.');
    const anonymous=input.anonymous===true,name=input.username.toLowerCase(),cacheKey=(anonymous?'anon:':'')+name,now=Date.now(),cached=avatarReads.get(cacheKey);
    // Reuse a native comment headshot (including its signed preview query)
    // when this author already appears on the page. Never synthesize signatures.
    // A restored comment carries its archived author but still Reddit's placeholder avatar: never reuse it.
    if(!anonymous)for(const comment of document.querySelectorAll('shreddit-comment[author]:not([is-author-deleted])'))if(comment.getAttribute('author')?.toLowerCase()===name){const slot=comment.querySelector('[slot="commentAvatar"]');if(slot?.closest('shreddit-comment')!==comment)continue;for(const image of slot?.querySelectorAll('image[href],img[src]') || []){const url=safeAvatar(image.getAttribute('href') || image.getAttribute('src'));if(url)return {avatar:url};}}
    if(cached?.expires>now)return {avatar:cached.url};
    if(anonymous && !publicBrowserSupported())return {avatar:''};
    if(!anonymous && now<cooldown)return {deferred:true,retryAfterMs:cooldown-now};
    if(active>=2)return {deferred:true,retryAfterMs:250};
    const controller=new AbortController(),cancel=()=>controller.abort(),timer=setTimeout(cancel,anonymous?12000:8000);signal?.addEventListener('abort',cancel,{once:true});active++;
    try{
      // Reddit's hover card is served to signed-out visitors and is tiny; its
      // [avatar] image is the profile headshot. Deleted and suspended accounts
      // return a card without one. No /about.json: it is unavailable signed out.
      const hoverUrl=new URL('/svc/shreddit/user-hover-card/'+encodeURIComponent(input.username),location.origin).href;
      let url='',ok=false;
      if(anonymous){
        try{
          const html=await publicBrowserRead(hoverUrl,controller.signal,input.refresh===true);
          ok=true;
          url=extractHoverAvatar(new DOMParser().parseFromString(html,'text/html'));
        }catch(error){
          if(signal?.aborted)throw Error('Post request cancelled.');
          ok=false;url='';
        }
      }else{
        const response=await fetch(hoverUrl,{method:'GET',credentials:'include',redirect:'error',headers:{Accept:'text/vnd.reddit.partial+html, text/html;q=0.9'},signal:controller.signal});
        if(response.status===429){const retry=Number(response.headers.get('retry-after'));cooldown=Date.now()+Math.max(1000,Math.min(3600000,(Number.isFinite(retry)&&retry>0?retry:60)*1000));return {deferred:true,retryAfterMs:cooldown-Date.now()};}
        // A 403 can be Reddit's bot check: pause every Reddit read for a while rather than press on author by author.
        if(response.status===403){cooldown=Date.now()+300000;return {deferred:true,retryAfterMs:cooldown-Date.now()};}
        ok=response.ok;
        if(response.ok){
          const doc=new DOMParser().parseFromString(await boundedText(response),'text/html'),headshot=[...doc.querySelectorAll('[avatar] image[href],[avatar] img[src]')],pool=headshot.length?headshot:[...doc.querySelectorAll('img[alt*="avatar" i][src]')];
          // The first safe headshot wins; a full-body Snoovatar is rejected by safeAvatar,
          // so an unavailable headshot keeps the native default.
          for(const img of pool){const candidate=safeAvatar(headshotOf(img.getAttribute('href') || img.getAttribute('src')));if(candidate){url=candidate;break;}}
        }
      }
      if(avatarReads.size>=200)avatarReads.delete(avatarReads.keys().next().value);avatarReads.set(cacheKey,{url,expires:Date.now()+(ok?1800000:60000)});
      return {avatar:url};
    }finally{active--;clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
  }
  // Blocked-by-user signed-out probe and profile reader (all reads strictly through RTPublicBrowser).
  function visibleText(root){
    if(!root)return '';
    const clone=root.cloneNode(true);
    for(const el of clone.querySelectorAll('script,style,noscript,template'))el.remove();
    return (clone.textContent || '').replace(/\s+/g,' ').trim();
  }
  function parseCompactCount(value){
    if(typeof value==='number')return Number.isFinite(value)?Math.round(value):null;
    const raw=String(value ?? '').replace(/,/g,'').trim();
    const m=raw.match(/^(-?\d+(?:\.\d+)?)\s*([kmb])?$/i);
    if(!m)return null;
    const base=Number(m[1]),mult={k:1e3,m:1e6,b:1e9}[(m[2] || '').toLowerCase()] || 1;
    return Number.isFinite(base)?Math.round(base*mult):null;
  }
  function extractKarmaStats(root){
    let postKarma=null,commentKarma=null,karma=null;
    if(!root)return {postKarma,commentKarma,karma};
    const readCount=el=>{
      if(!el)return null;
      const num=el.getAttribute?.('number') ?? el.querySelector?.('faceplate-number[number]')?.getAttribute('number');
      if(num!=null && num!==''){const parsed=parseCompactCount(num);if(parsed!==null)return parsed;}
      return parseCompactCount(visibleText(el));
    };
    const postEl=root.querySelector('[data-testid="post-karma"]');
    const commentEl=root.querySelector('[data-testid="comment-karma"]');
    const totalEl=root.querySelector('[data-testid="karma-number"]');
    if(postEl)postKarma=readCount(postEl);
    if(commentEl)commentKarma=readCount(commentEl);
    const totalEls=[...root.querySelectorAll('[data-testid="karma-number"]')];
    if(totalEls.length===1)karma=readCount(totalEls[0]);
    for(const num of root.querySelectorAll('faceplate-number[number],[data-testid="karma-number"]')){
      const val=readCount(num);if(val===null)continue;
      const block=num.closest('div,li,p,span,dl') || num.parentElement;
      const label=visibleText(block);
      if(postKarma===null && /\bpost\s+karma\b/i.test(label) && !/\bcomment\s+karma\b/i.test(label))postKarma=val;
      if(commentKarma===null && /\bcomment\s+karma\b/i.test(label) && !/\bpost\s+karma\b/i.test(label))commentKarma=val;
    }
    const text=visibleText(root);
    if(postKarma===null){
      const m=text.match(/(-?[\d,]+(?:\.\d+)?\s*[kmb]?)\s+post\s+karma\b/i) || text.match(/\bpost\s+karma\s*[:·]?\s*(-?[\d,]+(?:\.\d+)?\s*[kmb]?)/i);
      if(m)postKarma=parseCompactCount(m[1]);
    }
    if(commentKarma===null){
      const m=text.match(/(-?[\d,]+(?:\.\d+)?\s*[kmb]?)\s+comment\s+karma\b/i) || text.match(/\bcomment\s+karma\s*[:·]?\s*(-?[\d,]+(?:\.\d+)?\s*[kmb]?)/i);
      if(m)commentKarma=parseCompactCount(m[1]);
    }
    if(karma===null && postKarma!==null && commentKarma!==null)karma=postKarma+commentKarma;
    return {postKarma,commentKarma,karma};
  }
  function extractCakeDay(root){
    if(!root)return '';
    const dateRe=/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},\s+\d{4}\b/i;
    const time=root.querySelector('time[data-testid="cake-day"],[data-testid="cake-day"] time,time[datetime]');
    if(time){
      const text=(time.textContent || '').replace(/\s+/g,' ').trim();
      if(dateRe.test(text))return text.match(dateRe)[0];
      const parsed=Date.parse(time.getAttribute('datetime') || '');
      if(Number.isFinite(parsed))return new Date(parsed).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
      if(text)return text.slice(0,40);
    }
    const match=visibleText(root).match(dateRe);
    return match?match[0]:'';
  }
  function parseBlockedHoverCard(html,expectedUsername){
    const doc=new DOMParser().parseFromString(html,'text/html');
    const card=doc.querySelector('[data-testid="user-hover-card"]');
    if(!card){
      const bodyText=visibleText(doc.body);
      if(doc.querySelector('form[action*="challenge"],#challenge-form') || /prove your humanity|whoa there|blocked by network security/i.test(bodyText))return {blocked:false,reason:'unavailable'};
      if(/\bsuspended\b/i.test(bodyText))return {blocked:false,reason:'suspended'};
      if(/\bdeleted\b/i.test(bodyText))return {blocked:false,reason:'deleted'};
      return {blocked:false,reason:'not-found'};
    }
    // Status wording only: a display name such as "[deleted]" or "Deleted User" must not decide it.
    const statusCard=card.cloneNode(true);
    for(const node of statusCard.querySelectorAll('a[href*="/user/"],h1,h2,h3,[data-testid*="name" i],[slot*="name" i],faceplate-tracker[noun*="name" i]'))node.remove();
    const cardText=visibleText(statusCard);
    if(card.querySelector('img[src*="suspended-snoo"]') || /\b(?:account(?:\s+has\s+been|\s+is)?\s+suspended|has\s+been\s+suspended|account\s+suspended)\b/i.test(cardText))return {blocked:false,reason:'suspended'};
    if(card.querySelector('img[alt="Deleted user"]') || /\b(?:account\s+has\s+been\s+deleted|this\s+account\s+is\s+deleted|deleted\s+user)\b/i.test(cardText) || cardText.includes('[deleted]'))return {blocked:false,reason:'deleted'};
    let handle='';
    for(const a of card.querySelectorAll('a[href*="/user/"]')){
      const m=(a.getAttribute('href') || '').match(/^(?:https:\/\/(?:www\.)?reddit\.com)?\/user\/([\w-]{1,20})\/?$/i);
      if(m){handle=m[1];break;}
    }
    if(!handle){const m=cardText.match(/\bu\/([\w-]{1,20})\b/i);if(m)handle=m[1];}
    if(handle && handle.toLowerCase()!==expectedUsername.toLowerCase())return {blocked:false,reason:'unavailable'};
    const username=handle || expectedUsername;
    const nameNode=card.querySelector('[data-testid="nameplate"] .truncate,[data-testid="nameplate"],h1,h2,a[href*="/user/"] span,span.font-bold');
    const displayName=(visibleText(nameNode) || username).replace(/^u\//i,'').slice(0,100) || username;
    const avatar=extractHoverAvatar(card);
    const {postKarma,commentKarma}=extractKarmaStats(card);
    const cakeDay=extractCakeDay(card);
    return {blocked:true,profile:{username,displayName,avatar,postKarma,commentKarma,cakeDay}};
  }
  function blockedContext(input){
    const context=route();
    if(location.protocol!=='https:' || !['reddit.com','www.reddit.com','new.reddit.com','sh.reddit.com'].includes(location.hostname) || !context?.username || !M.validateUsername(input.username) || context.username.toLowerCase()!==input.username.toLowerCase())throw Error('Open the matching Reddit profile.');
    if(['url','origin','method','headers'].some(key=>input[key]!==undefined))throw Error('Invalid blocked profile request.');
    return context;
  }
  async function blockedProbe(input,signal){
    blockedContext(input);
    const path=pageKey();
    if(!publicBrowserSupported())return {blocked:false,reason:'unsupported'};
    const controller=new AbortController(),cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
    let timer;
    try{
      const url=new URL('/svc/shreddit/user-hover-card/'+encodeURIComponent(input.username),location.origin);
      const html=await Promise.race([
        publicBrowserRead(url.href,controller.signal,input.refresh===true),
        new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Blocked profile probe timed out.'));},15000);})
      ]);
      if(signal?.aborted || pageKey()!==path)throw Error(signal?.aborted?'Post request cancelled.':'Page changed. Try again.');
      return parseBlockedHoverCard(html,input.username);
    }catch(error){
      if(signal?.aborted)throw Error('Post request cancelled.');
      if(pageKey()!==path)throw Error('Page changed. Try again.');
      if(error?.unsupported)return {blocked:false,reason:'unsupported'};
      if(error?.status===404)return {blocked:false,reason:'not-found'};
      return {blocked:false,reason:'unavailable'};
    }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
  }
  function parseBlockedProfileMetadata(doc,username){
    const main=doc.querySelector('main'),sidebar=doc.querySelector('aside#right-sidebar-container,aside[aria-label*="profile" i]') || null;
    const gated=!main || Boolean(doc.querySelector('#shreddit-forbidden') && !main.querySelector('shreddit-feed,#empty-feed-content'));
    const empty=doc.querySelector('#empty-feed-content');
    const curated=Boolean(doc.querySelector('#empty-feed-content img[src*="snoo_wave"]') || empty && /likes to keep their (?:posts|comments) hidden/i.test(visibleText(empty)));
    const h1=main?.querySelector('h1:not(#shreddit-forbidden-title)') || sidebar?.querySelector('h1,h2');
    const displayName=(visibleText(h1) || username).replace(/^u\//i,'').slice(0,100) || username;
    const bioNode=(sidebar || main || doc).querySelector('[data-testid="profile-description"],[data-testid="profile-bio"]');
    const bio=visibleText(bioNode).slice(0,500);
    const avatar=extractHoverAvatar(main) || extractHoverAvatar(sidebar) || extractHoverAvatar(doc);
    let banner='';
    const bannerImg=doc.querySelector('main [data-testid="profile-banner"] img[src],aside [data-testid="profile-banner"] img[src],img[src*="bannerImage"],img[alt*="banner" i][src]');
    if(bannerImg)banner=safeBanner(bannerImg.getAttribute('src'));
    if(!banner){
      for(const el of doc.querySelectorAll('[data-testid="profile-banner"][style],[style*="bannerImage"]')){
        const m=(el.getAttribute('style') || '').match(/url\(\s*['"]?(https:\/\/[^'")\s]+)['"]?\s*\)/i);
        if(m){banner=safeBanner(m[1]);if(banner)break;}
      }
    }
    const {postKarma,commentKarma,karma}=extractKarmaStats(sidebar || main || doc);
    const cakeDay=extractCakeDay(sidebar || main || doc);
    return {username,displayName,bio,avatar,banner,postKarma,commentKarma,karma,cakeDay,curated,gated};
  }
  function parseBlockedProfileListing(doc,username,{continuation=false,previousUrl=null}={}){
    const feed=doc.querySelector('main shreddit-feed,shreddit-feed') || doc,posts=[],seen=new Set(),markup=new Map();
    const closestCard=node=>node?.closest?.('shreddit-post,shreddit-profile-comment,shreddit-comment');
    const own=(card,selector)=>[...card.querySelectorAll(selector)].find(n=>closestCard(n)===card);
    const flag=(card,name)=>card.hasAttribute(name) && !['false','0'].includes(String(card.getAttribute(name)).toLowerCase());
    const cardBody=card=>{
      const node=own(card,'[slot="text-body"],[slot="comment"],[id$="-comment-rtjson-content"],[id$="-post-rtjson-content"],[id$="-rtjson-content"],.md');
      if(!node)return '';
      const clone=node.cloneNode(true);
      for(const bad of clone.querySelectorAll('shreddit-comment,shreddit-profile-comment,shreddit-post,script,style'))bad.remove();
      const paras=[...clone.querySelectorAll('p')].map(p=>p.textContent.trim()).filter(Boolean);
      return paras.length?paras.join('\n\n'):clone.textContent.trim();
    };
    const commentPostTitle=(card,postId)=>{
      const pattern=new RegExp('^/(?:r|user)/[\\w-]+/comments/'+postId+'/[^/]*/?$','i');
      for(const a of card.querySelectorAll('a[href]')){
        let p;try{p=new URL(a.getAttribute('href'),location.origin).pathname;}catch{continue;}
        if(pattern.test(p)){const text=a.textContent.trim();if(text)return text.slice(0,300);}
      }
      return '';
    };
    const cards=[...feed.querySelectorAll('shreddit-post,shreddit-profile-comment')].filter(card=>!card.closest('[data-rt-ui]')).slice(0,100);
    for(const card of cards){
      try{
        const isComment=card.tagName==='SHREDDIT-PROFILE-COMMENT';
        if(!isComment){
          const fullname=(card.id || card.getAttribute('id') || '').toLowerCase();
          if(!M.validateId(fullname) || !fullname.startsWith('t3_'))continue;
          const author=card.getAttribute('author') || '';
          if(author && author.toLowerCase()!==username.toLowerCase())continue;
          const href=card.getAttribute('permalink') || own(card,'a[slot="full-post-link"],a[slot="title"]')?.getAttribute('href') || '';
          const linkUrl=href?new URL(href,location.origin):null;
          if(linkUrl && linkUrl.origin!==location.origin)continue;
          const pathName=linkUrl?.pathname || '';
          const created=Date.parse(card.getAttribute('created-timestamp') || own(card,'faceplate-timeago[ts]')?.getAttribute('ts') || own(card,'time[datetime]')?.getAttribute('datetime') || '')/1000;
          const preview=own(card,'[slot="post-media-container"] img[src],[slot="post-media-container"] faceplate-img[src],[slot="thumbnail"] img[src],[slot="thumbnail"] faceplate-img[src],img[data-testid="post-thumbnail"],faceplate-img[data-testid="post-thumbnail"]');
          const contentHref=card.getAttribute('content-href') || '';
          const post=M.normalizePost({
            id:fullname.slice(3),author:author || username,
            title:card.getAttribute('post-title') || own(card,'[slot="title"]')?.textContent?.trim() || '',
            selftext:cardBody(card),
            subreddit:(card.getAttribute('subreddit-name') || card.getAttribute('subreddit-prefixed-name') || pathName.match(/^\/r\/([^/]+)\//)?.[1] || '').replace(/^r\//i,''),
            created_utc:created,permalink:linkUrl?linkUrl.pathname+linkUrl.search:undefined,url:contentHref,
            postType:card.getAttribute('post-type') || undefined,
            is_self:['text','textmedia'].includes(card.getAttribute('post-type')),
            over_18:flag(card,'nsfw') || flag(card,'is-nsfw'),
            spoiler:flag(card,'spoiler') || flag(card,'is-spoiler'),
            score:Number(card.getAttribute('score')) || 0,
            num_comments:Number(card.getAttribute('comment-count')) || 0,
            link_flair_text:own(card,'[slot="post-flair"]')?.textContent?.trim() || '',
            domain:card.getAttribute('domain') || '',
            thumbnail:M.mediaUrl(preview?.getAttribute('src') || own(card,'video[poster]')?.getAttribute('poster') || card.getAttribute('thumbnail') || contentHref) || undefined,
            subredditIcon:own(card,'[slot="credit-bar"] img[src],.shreddit-subreddit-icon__icon img[src]')?.getAttribute('src') || undefined
          },{source:'reddit'});
          if(post && !seen.has(post.fullname)){seen.add(post.fullname);posts.push(post);markup.set(post.fullname,card.outerHTML);}
        }else{
          const fullname=(card.getAttribute('comment-id') || card.getAttribute('thingid') || card.id || '').toLowerCase();
          if(!M.validateCommentId(fullname) || !fullname.startsWith('t1_'))continue;
          const overflow=own(card,'shreddit-overflow-menu[author-name]'),actionRow=own(card,'shreddit-comment-action-row');
          const author=card.getAttribute('author') || overflow?.getAttribute('author-name') || actionRow?.getAttribute('author') || own(card,'[id^="poster-info-"] a[href*="/user/"]')?.getAttribute('href')?.match(/\/user\/([\w-]{1,20})\/?$/i)?.[1] || '';
          if(author && author.toLowerCase()!==username.toLowerCase())continue;
          const href=card.getAttribute('permalink') || card.getAttribute('href') || actionRow?.getAttribute('permalink') || own(card,'a[href*="/comment/"]')?.getAttribute('href') || '';
          const linkUrl=new URL(href,location.origin);
          if(linkUrl.origin!==location.origin)continue;
          const pathName=linkUrl.pathname,postId=pathName.match(/\/comments\/([a-z0-9]{1,10})(?:\/|$)/i)?.[1];
          if(!postId)continue;
          const created=Date.parse(card.getAttribute('created-timestamp') || own(card,'faceplate-timeago[ts]')?.getAttribute('ts') || own(card,'time[datetime]')?.getAttribute('datetime') || '')/1000;
          const profileSub=pathName.match(/^\/user\/([\w-]{1,20})\/comments\//i)?.[1];
          const subreddit=(card.getAttribute('subreddit-name') || card.getAttribute('subreddit-prefixed-name') || pathName.match(/^\/r\/([^/]+)\//)?.[1] || (profileSub?'u_'+profileSub:'')).replace(/^r\//i,'');
          const score=Number(card.getAttribute('score') ?? actionRow?.getAttribute('score') ?? own(card,'faceplate-number[number]')?.getAttribute('number')) || 0;
          const comment=M.normalizeComment({
            id:fullname.slice(3),author:author || username,body:cardBody(card),
            link_id:'t3_'+postId,parent_id:card.getAttribute('parentid') || card.getAttribute('parent-id') || 't3_'+postId,
            link_title:card.getAttribute('post-title') || own(card,'h2')?.textContent?.trim() || commentPostTitle(card,postId),
            subreddit,created_utc:created,score,permalink:linkUrl.pathname+linkUrl.search,
            over_18:flag(card,'nsfw') || flag(card,'is-nsfw'),
            spoiler:flag(card,'spoiler') || flag(card,'is-spoiler'),
            subredditIcon:own(card,'.shreddit-subreddit-icon__icon img[src],[avatar] img[src]')?.getAttribute('src') || undefined
          },{source:'reddit'});
          if(comment && !seen.has(comment.fullname)){seen.add(comment.fullname);posts.push(comment);markup.set(comment.fullname,card.outerHTML);}
        }
      }catch{ /* Skip malformed cards cleanly. */ }
    }
    let nextUrl=null;
    for(const partial of feed.querySelectorAll('faceplate-partial[src*="/svc/shreddit/profiles/"]')){
      try{
        const u=new URL(partial.getAttribute('src'),location.origin);
        if(!u.pathname.includes('more-posts') || u.origin!==location.origin || u.href.length>4096)continue;
        if(!/^\/svc\/shreddit\/profiles\/profile_(overview|posts|comments)-more-posts\/(new|hot|top)\/$/.test(u.pathname))continue;
        if(u.searchParams.get('name')?.toLowerCase()!==username.toLowerCase())continue;
        const candidate=u.pathname+u.search;
        if(candidate!==previousUrl){nextUrl=candidate;break;}
      }catch{}
    }
    const metadata=continuation?null:parseBlockedProfileMetadata(doc,username);
    return {metadata,posts,nextUrl,cards:markup};
  }
  // A signed-out profile page already holds Reddit's own native card for every
  // item it lists, in the profile feed's markup. Keep them so each card renders
  // from the page that listed it instead of being fetched again one by one.
  // Each entry carries the page's Profile module loader, as a single-card
  // fragment carries its own, so rarer components (galleries) still load.
  // Page-world memory only, bounded, and scoped to one visited profile.
  const signedOutCards=new Map(),signedOutCardLimit=200,signedOutCardMs=600000;let signedOutOwner='';
  function keepSignedOutCards(doc,username,cards){
    const owner=String(username).toLowerCase();if(owner!==signedOutOwner){signedOutCards.clear();signedOutOwner=owner;}
    const loader=doc.querySelector('faceplate-loader[name^="Profile_"]')?.outerHTML || '',expires=Date.now()+signedOutCardMs;
    for(const [fullname,html] of cards){signedOutCards.delete(fullname);signedOutCards.set(fullname,{text:loader+html,expires});}
    while(signedOutCards.size>signedOutCardLimit)signedOutCards.delete(signedOutCards.keys().next().value);
  }
  function signedOutCard(username,fullname,comments,input){
    // Listing pages are card view; a compact post card still comes from Reddit's compact fragment.
    if(!comments && (input?.view || new URLSearchParams(location.search).get('feedViewType'))==='compactView')return null;
    if(String(username || '').toLowerCase()!==signedOutOwner)return null;
    const entry=signedOutCards.get(fullname);if(!entry)return null;
    if(entry.expires<=Date.now()){signedOutCards.delete(fullname);return null;}
    return entry.text;
  }
  async function blockedProfilePage(input,signal){
    blockedContext(input);
    const path=pageKey();
    if(!publicBrowserSupported())throw Error('Signed-out profile browsing is unavailable in this browser.');
    if(input.mode!=null && !['profile','search'].includes(input.mode))throw Error('Invalid blocked profile mode.');
    const mode=input.mode==='search' || input.mode!=='profile' && (input.type!=null || input.kind!=null || input.query!==undefined || input.cursor!==undefined)?'search':'profile';
    const validRanges=['hour','day','week','month','year','all'];
    const tRaw=input.t ?? input.range;
    if(tRaw!=null && !validRanges.includes(tRaw))throw Error('Invalid time range.');
    const controller=new AbortController(),cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
    let timer;
    try{
      if(mode==='search'){
        const type=input.type ?? (input.kind==='comment'?'comments':input.kind==='post'?'posts':'');
        if(!['posts','comments'].includes(type))throw Error('Invalid blocked profile search type.');
        const query=input.query===undefined?'':typeof input.query==='string'?input.query.trim():null;
        if(query===null || query.length>300 || /[\u0000-\u001f\u007f]/.test(query))throw Error('Invalid search words.');
        const hasQuery=Boolean(query),sort=input.sort ?? (hasQuery?'relevance':'new'),range=tRaw ?? 'all';
        if(!['new','hot','top','relevance','comments'].includes(sort))throw Error('Invalid blocked profile sort.');
        if(input.cursor!=null && (typeof input.cursor!=='string' || !input.cursor || input.cursor.length>4096 || /[\u0000-\u001f\u007f]/.test(input.cursor)))throw Error('Invalid search cursor.');
        const q=authorQuery(input.username)+(hasQuery?' '+query:'');
        const url=new URL('/svc/shreddit/search/',location.origin);
        url.searchParams.set('q',q);url.searchParams.set('type',type);url.searchParams.set('sort',sort);
        if(sort==='top' || tRaw!=null && (hasQuery || tRaw!=='all'))url.searchParams.set('t',range);
        url.searchParams.set('limit','25');
        if(input.cursor)url.searchParams.set('cursor',input.cursor);
        const html=await Promise.race([
          sharedBlockedRead(url.href,controller.signal,input.refresh===true),
          new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Signed-out search timed out. Try again.'));},25000);})
        ]);
        if(signal?.aborted || pageKey()!==path)throw Error(signal?.aborted?'Post request cancelled.':'Page changed. Try again.');
        const listing=(type==='comments'?commentListing:postListing)(html,input.username,{sort,range,stream:'public',q,search:hasQuery});
        const nextCursor=searchCursor(new DOMParser().parseFromString(html,'text/html'),input.username,type,sort,range,{q,search:hasQuery});
        return {mode:'search',type,sort,metadata:null,posts:listing.posts,nextUrl:null,cursor:nextCursor,after:nextCursor,hasMore:Boolean(nextCursor),incomplete:true,source:'reddit',signedOut:true};
      }
      const isContinuation=input.moreUrl!=null || input.after!=null;
      const rawMoreUrl=input.moreUrl ?? input.after;
      let url,tab='overview',sort='new';
      if(isContinuation){
        if(typeof rawMoreUrl!=='string' || !rawMoreUrl || rawMoreUrl.length>4096 || /[\u0000-\u001f\u007f]/.test(rawMoreUrl))throw Error('Invalid profile continuation.');
        url=new URL(rawMoreUrl,location.origin);
        const m=url.pathname.match(/^\/svc\/shreddit\/profiles\/profile_(overview|posts|comments)-more-posts\/(new|hot|top)\/$/);
        const allowed=['sort','after','name','navigationSessionId','feedLength','referer','distance','t','cursor'];
        if(!m || url.origin!==location.origin || url.username || url.password || url.port || url.hash || url.searchParams.get('name')?.toLowerCase()!==input.username.toLowerCase() || (url.searchParams.has('sort') && url.searchParams.get('sort')!==m[2]) || (url.searchParams.has('t') && !validRanges.includes(url.searchParams.get('t'))) || [...url.searchParams.keys()].some(key=>!allowed.includes(key) || url.searchParams.getAll(key).length!==1) || [...url.searchParams.values()].some(v=>/[\u0000-\u001f\u007f]/.test(v)))throw Error('Invalid profile continuation.');
        tab=m[1]==='posts'?'submitted':m[1];sort=m[2];
      }else{
        const rawTab=input.tab ?? input.view ?? 'overview';
        tab=rawTab==='posts'?'submitted':rawTab;
        sort=input.sort ?? 'new';
        if(!['overview','submitted','comments'].includes(tab))throw Error('Invalid profile tab.');
        if(!['new','hot','top'].includes(sort))throw Error('Invalid profile sort.');
        url=new URL('/user/'+encodeURIComponent(input.username)+'/'+(tab==='overview'?'':tab+'/'),location.origin);
        url.searchParams.set('sort',sort);
        if(tRaw!=null)url.searchParams.set('t',tRaw);
      }
      const html=await Promise.race([
        sharedBlockedRead(url.href,controller.signal,input.refresh===true),
        new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Signed-out profile load timed out. Try again.'));},25000);})
      ]);
      if(signal?.aborted || pageKey()!==path)throw Error(signal?.aborted?'Post request cancelled.':'Page changed. Try again.');
      const doc=new DOMParser().parseFromString(html,'text/html'),parsed=parseBlockedProfileListing(doc,input.username,{continuation:isContinuation,previousUrl:isContinuation?url.pathname+url.search:null});
      keepSignedOutCards(doc,input.username,parsed.cards);
      return {mode:'profile',tab,sort,metadata:parsed.metadata,posts:parsed.posts,nextUrl:parsed.nextUrl,after:parsed.nextUrl,cursor:null,hasMore:Boolean(parsed.nextUrl),incomplete:true,source:'reddit',signedOut:true};
    }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
  }
  // On a post page, an account that blocked the reader shows as [deleted]: its post loses its body and media,
  // and its comments read "Comment deleted by user". Reddit's signed-out view of the same items tells a block
  // from a real deletion. Only items of this thread that Reddit shows signed out with a live author return.
  function threadContext(input){
    const postId=location.pathname.match(/^\/(?:r\/[^/]+\/|user\/[^/]+\/)?comments\/([a-z0-9]{1,10})(?:\/|$)/i)?.[1]?.toLowerCase();
    if(location.protocol!=='https:' || !['reddit.com','www.reddit.com','new.reddit.com','sh.reddit.com'].includes(location.hostname) || !postId || input.postId!==postId)throw Error('Open the matching Reddit post.');
    if(document.querySelector('shreddit-app')?.getAttribute('user-logged-in')==='false')throw Error('Sign in to Reddit to check blocked accounts.');
    if(['url','origin','method','headers'].some(key=>input[key]!==undefined))throw Error('Invalid blocked thread request.');
    const ids=input.ids===undefined?[]:input.ids;
    if(!Array.isArray(ids) || ids.length>10 || !ids.every(id=>typeof id==='string' && /^t1_[a-z0-9]{1,32}$/.test(id)))throw Error('Invalid comment list.');
    return {postId,ids:[...new Set(ids)]};
  }
  const liveAuthor=name=>M.validateUsername(name) && !/^\[deleted\]$/i.test(name);
  function threadBody(node){
    if(!node)return {body:'',bodyHtml:''};
    const clone=node.cloneNode(true);for(const bad of clone.querySelectorAll('script,style,template,shreddit-comment,shreddit-profile-comment,shreddit-post'))bad.remove();
    const html=clone.innerHTML.trim(),paras=[...clone.querySelectorAll('p')].map(p=>p.textContent.trim()).filter(Boolean);
    return {body:(paras.length?paras.join('\n\n'):clone.textContent.trim()).slice(0,40000),bodyHtml:html.length<=100000?html:''};
  }
  function signedOutThreadComment(doc,id,postId){
    const card=doc.querySelector('shreddit-profile-comment[comment-id="'+id+'"]');if(!card)return null;
    const own=selector=>[...card.querySelectorAll(selector)].find(node=>node.closest('shreddit-profile-comment')===card);
    const actionRow=own('shreddit-comment-action-row'),overflow=own('shreddit-overflow-menu[author-name]');
    const author=card.getAttribute('author') || overflow?.getAttribute('author-name') || actionRow?.getAttribute('author') || own('[id^="poster-info-"] a[href*="/user/"]')?.getAttribute('href')?.match(/\/user\/([\w-]{1,20})\/?$/i)?.[1] || '';
    const href=card.getAttribute('permalink') || actionRow?.getAttribute('permalink') || own('a[href*="/comment/"]')?.getAttribute('href') || '';
    let path='';try{path=new URL(href,location.origin).pathname;}catch{}
    if(!liveAuthor(author) || path.match(/\/comments\/([a-z0-9]{1,10})(?:\/|$)/i)?.[1]?.toLowerCase()!==postId)return null;
    const {body,bodyHtml}=threadBody(own('[id$="-rtjson-content"]') || own('[slot="comment"]') || own('.md'));
    if(!body || M.noticeStatus?.(body))return null;
    return {id:id.slice(3),author,body,bodyHtml,avatar:extractHoverAvatar(card)};
  }
  function signedOutThreadPost(doc,postId){
    const card=doc.querySelector('shreddit-post[id="t3_'+postId+'"]');if(!card)return null;
    const author=card.getAttribute('author') || '';if(!liveAuthor(author))return null;
    const own=selector=>[...card.querySelectorAll(selector)].find(node=>node.closest('shreddit-post')===card);
    const {body,bodyHtml}=threadBody(own('[slot="text-body"] [id$="-rtjson-content"]') || own('[slot="text-body"]'));
    const type=card.getAttribute('post-type') || '',href=card.getAttribute('content-href') || '',media=[];
    const add=(kind,url,extra={})=>{const safe=M.mediaUrl(url);if(safe && media.length<20 && !media.some(item=>item.url===safe))media.push({kind,url:safe,...extra});};
    if(type==='image')add('image',href);
    if(type==='gallery')for(const img of card.querySelectorAll('gallery-carousel img[src],gallery-carousel img[data-lazy-src]'))add('image',img.getAttribute('src') || img.getAttribute('data-lazy-src'));
    const player=own('shreddit-player,shreddit-player-2');
    if(player){const poster=M.mediaUrl(player.getAttribute('poster') || player.getAttribute('preview') || '');if(poster)media.push({kind:'video',poster,url:poster});}
    if(!media.length){const preview=own('[slot="post-media-container"] img[src],[slot="thumbnail"] img[src],img[data-testid="post-thumbnail"]');if(preview)add('thumbnail',preview.getAttribute('src'));}
    return {id:postId,author,title:card.getAttribute('post-title') || '',body,bodyHtml,media,url:href,postType:type};
  }
  async function blockedThreadItems(input,signal){
    const {postId,ids}=threadContext(input),path=pageKey();
    if(!publicBrowserSupported())return {unsupported:true,comments:[],post:null};
    const controller=new AbortController(),cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
    const read=async url=>{const text=await publicBrowserRead(url.href,controller.signal,false);if(controller.signal.aborted || pageKey()!==path)throw Error('Page changed. Try again.');return new DOMParser().parseFromString(text,'text/html');};
    const comments=[],missing=[];let post=null,failed=false;
    try{
      if(input.post===true){
        try{const url=new URL('/svc/shreddit/partial-feed-post/t3_'+postId,location.origin);url.searchParams.set('isProfile','true');post=signedOutThreadPost(await read(url),postId);}
        catch(error){if(controller.signal.aborted || pageKey()!==path)throw error;failed=true;}
      }
      for(const id of ids){
        try{const url=new URL('/svc/shreddit/comment/'+id,location.origin);url.searchParams.set('isProfile','true');const found=signedOutThreadComment(await read(url),id,postId);if(found)comments.push(found);else missing.push(id);}
        catch(error){if(controller.signal.aborted || pageKey()!==path)throw error;failed=true;}
      }
      return {post,comments,missing,incomplete:failed};
    }finally{signal?.removeEventListener('abort',cancel);}
  }
  const ownLists=new Set(['saved','history','hidden','upvoted','downvoted','removed']);
  // The Removed list reads your own overview and keeps only the moderation facts Reddit gives the author
  // (docs/own-removal-detection-spec.md §4.1 E1). The content script classifies them with RTRemovalModel.
  const moderationOf=(raw,kind)=>{
    const text=(value,max)=>typeof value==='string'?value.slice(0,max):null;
    return {category:text(raw.removed_by_category,40),removalReason:Boolean(raw.removal_reason),locked:raw.locked===true,
      subredditType:text(raw.subreddit_type,40) || 'public',quarantined:raw.quarantine===true,authorBody:text(kind==='t1'?raw.body:raw.selftext,40000) ?? ''};
  };
  function ownListContext(input){
    const context=route();
    if(location.protocol!=='https:' || !['reddit.com','www.reddit.com','new.reddit.com','sh.reddit.com'].includes(location.hostname) || !context?.username || !M.validateUsername(input.username) || context.username.toLowerCase()!==input.username.toLowerCase())throw Error('Open your own Reddit profile to search your lists.');
    // Callers supply structured names/cursors, never a URL, method or headers.
    if(['url','origin','method','headers'].some(key=>input[key]!==undefined))throw Error('Invalid own-list request.');
    return context;
  }
  async function signedInUsername(signal){
    const native=globalThis.RTNativeRemoval?.identity(document);if(native)return native.username;
    const response=await fetch(new URL('/api/me.json',location.origin).href,{method:'GET',credentials:'include',cache:'no-store',redirect:'error',headers:{Accept:'application/json'},signal});
    if(!response.ok)throw Error(response.status===401 || response.status===403?'Sign in to Reddit to search your lists.':'Reddit could not verify your signed-in account (HTTP '+response.status+').');
    let data;try{data=JSON.parse(await boundedText(response));}catch{throw Error('Reddit could not verify your signed-in account.');}
    if(!M.validateUsername(data?.data?.name))throw Error('Sign in to Reddit to search your lists.');
    return data.data.name;
  }
  const communitySuggestions=new Map();
  async function readCommunitySuggestions(input,signal){
    if(typeof input.query!=='string' || input.query.length>50 || /[\u0000-\u001f\u007f]/.test(input.query) || ['url','origin','headers','method'].some(k=>input[k]!==undefined))throw Error('Invalid community search.');
    const query=input.query.trim().replace(/^\/?r\//i,''),username=await signedInUsername(signal),key=username.toLowerCase()+'|'+query.toLowerCase();
    const cached=communitySuggestions.get(key);if(cached?.expires>Date.now())return cached.value;
    let doc=document;
    const own=route()?.username?.toLowerCase()===username.toLowerCase() && document.querySelector('main shreddit-feed');
    if(query || !own){
      try{
      const url=new URL(query?'/svc/shreddit/search-typeahead':'/user/'+encodeURIComponent(username)+'/',location.origin);
      if(query){url.searchParams.set('query',query);url.searchParams.set('cId',crypto.randomUUID());url.searchParams.set('recentSearchesCount','0');url.searchParams.set('mode','search');}else url.searchParams.set('sort','new');
      const response=await fetch(url.href,{method:'GET',credentials:'include',cache:'no-store',redirect:'error',headers:{Accept:query?'text/vnd.reddit.partial+html, text/html;q=0.9':'text/html'},signal});
      if(!response.ok)throw Error('Reddit community suggestions are unavailable (HTTP '+response.status+').');
      doc=new DOMParser().parseFromString(await boundedText(response), 'text/html');
      if(!query && !doc.querySelector('shreddit-feed'))throw Error('Reddit returned no profile suggestions.');
      }catch(error){if(query || signal?.aborted)throw error;return {username,entries:[],source:'native-profile',unavailable:true};}
    }
    const counts=new Map(),add=name=>{if(!/^[A-Za-z0-9_]{2,21}$/.test(name || '') && !/^u_[A-Za-z0-9_-]{3,20}$/.test(name || ''))return;const k=name.toLowerCase(),old=counts.get(k);if(old)old.count++;else counts.set(k,{key:name,count:query?0:1});};
    if(query){
      for(const anchor of doc.querySelectorAll('a[href]')){try{const url=new URL(anchor.getAttribute('href'),location.origin),name=url.pathname.match(/^\/r\/([A-Za-z0-9_]{2,21})\/$/)?.[1];if(url.origin===location.origin && name && !counts.has(name.toLowerCase()))add(name);}catch{}}
    }else for(const card of doc.querySelectorAll('main shreddit-feed shreddit-post,main shreddit-feed shreddit-profile-comment')){
      if(card.closest('[data-rt-ui]'))continue;const author=card.getAttribute('author') || card.querySelector('[id^="poster-info-"] a[href*="/user/"]')?.getAttribute('href')?.match(/\/user\/([A-Za-z0-9_-]{3,20})\/?$/)?.[1];
      if(author?.toLowerCase()!==username.toLowerCase())continue;
      add((card.getAttribute('subreddit-name') || card.getAttribute('subreddit-prefixed-name') || (card.getAttribute('href') || card.getAttribute('permalink') || '').match(/^\/r\/([^/]+)\//)?.[1] || '').replace(/^r\//i,''));
    }
    const value={username,entries:[...counts.values()].slice(0,100),source:query?'reddit-search':'native-profile'};
    if(communitySuggestions.size>=50)communitySuggestions.delete(communitySuggestions.keys().next().value);communitySuggestions.set(key,{expires:Date.now()+300000,value});return value;
  }
  function historyListing(text){
    const doc=new DOMParser().parseFromString(text,'text/html'),cards=[...doc.querySelectorAll('main shreddit-post[id]')];
    if(cards.length>100 || !cards.length && !doc.querySelector('main #empty-feed-content,main [data-testid="empty-state"]'))throw Error('Reddit’s History format changed or History could not be loaded.');
    const posts=[],seen=new Set();
    for(const card of cards){
      const flag=name=>card.hasAttribute(name) && !['false','0'].includes(card.getAttribute(name));
      const post=M.normalizePost({id:card.id,author:card.getAttribute('author'),title:card.getAttribute('post-title') || card.querySelector('[slot="title"]')?.textContent,
        selftext:card.querySelector('[slot="text-body"],[id$="-post-rtjson-content"]')?.textContent || '',subreddit:card.getAttribute('subreddit-name'),
        created_utc:Date.parse(card.getAttribute('created-timestamp'))/1000,permalink:card.getAttribute('permalink'),url:card.getAttribute('content-href'),
        postType:card.getAttribute('post-type'),is_self:['text','textmedia'].includes(card.getAttribute('post-type')),over_18:flag('nsfw') || flag('is-nsfw'),spoiler:flag('spoiler'),
        score:Number(card.getAttribute('score')),num_comments:Number(card.getAttribute('comment-count')),link_flair_text:card.querySelector('[slot="post-flair"]')?.textContent});
      if(!post)throw Error('Reddit’s History format changed. Some recently viewed posts could not be read.');
      if(!seen.has(post.fullname)){seen.add(post.fullname);posts.push(post);}
    }
    return {posts,after:null,hasMore:false,scanned:cards.length,incomplete:true,source:'reddit'};
  }
  // Removed reads Overview, then the Posts tab, which reaches posts older than Overview's newest 1,000 items.
  const removalSource=input=>{if(input.source!=null && !['overview','posts'].includes(input.source))throw Error('Invalid native profile source.');return input.source || 'overview';};
  const removalFirstPage=(me,source)=>'/user/'+encodeURIComponent(me.username)+'/'+(source==='posts'?'submitted/':'')+'?sort=new';
  const removalPublicCursors=new Map(),removalCursors=new Map(),removalItems=new Map(),removalProofs=new Map(),removalPending=new Map();let removalOwner='',removalQueue=Promise.resolve();
  function removalScope(me){
    const key=me.owner+':'+me.username.toLowerCase();if(removalOwner!==key){removalCursors.clear();removalItems.clear();removalProofs.clear();removalOwner=key;}return key;
  }
  function rememberRemovalItem(post,me){
    const entry={fullname:post.fullname,username:me.username,owner:me.owner,kind:post.kind==='comment'?'comment':'post',expectsBody:Boolean(post.body?.trim()),originalNotice:M.noticeStatus(post.body),restricted:['private','employees_only','gold_restricted'].includes(post.moderation?.subredditType) || post.moderation?.quarantined===true,revision:JSON.stringify([post.moderation,post.body])};
    if(removalItems.size>=1000 && !removalItems.has(post.fullname))removalItems.delete(removalItems.keys().next().value);removalItems.set(post.fullname,entry);return entry;
  }
  async function readRemovalPublic(input,signal){
    const N=globalThis.RTNativeRemoval,me=N?.identity(document),path=pageKey();
    if(!me || input.owner!==me.owner || input.username?.toLowerCase()!==me.username.toLowerCase() || !/^t(?:1_[a-z0-9]{1,32}|3_[a-z0-9]{1,10})$/.test(input.fullname || '') || ['url','origin','method','headers'].some(k=>input[k]!==undefined))throw Error('Invalid own-item public check.');
    const scope=removalScope(me);
    for(const node of document.querySelectorAll('shreddit-post,shreddit-profile-comment,shreddit-comment')){
      if(![node.id,node.getAttribute('comment-id'),node.getAttribute('thingid')].includes(input.fullname))continue;const post=N.item(node,me);if(post)rememberRemovalItem(post,me);
    }
    const item=removalItems.get(input.fullname);if(!item || item.owner!==me.owner || item.username.toLowerCase()!==me.username.toLowerCase())throw Error('This item was not observed in your native activity.');
    if(item.restricted)return {proof:{fullname:item.fullname,status:'unknown',verified:false,source:'signed-out-native',why:'Public visibility cannot be checked for this private or quarantined community.',checkedAt:Date.now()}};
    const key=scope+':'+item.fullname,saved=removalProofs.get(key);
    if(input.refresh!==true && saved?.expires>Date.now() && saved.revision===item.revision)return {proof:saved.proof};
    const pendingKey=key+':'+path+':'+item.revision,running=removalPending.get(pendingKey);if(running && !running.signal?.aborted)return running.operation;
    const current=()=>{const value=N.identity(document);return !signal?.aborted && pageKey()===path && value?.owner===me.owner && value?.username.toLowerCase()===me.username.toLowerCase();};
    const operation=removalQueue.catch(()=>{}).then(async()=>{
      if(!current())throw Error('Account or page changed. Try again.');
      const url=new URL('/svc/shreddit/'+(item.kind==='comment'?'comment/':'partial-feed-post/')+item.fullname,location.origin);url.searchParams.set('isProfile','true');let proof;
      try{const html=await publicBrowserRead(url.href,signal,false);proof=N.publicItem(new DOMParser().parseFromString(html,'text/html'),item);}
      catch(error){if(!current())throw Error('Account or page changed. Try again.');proof={fullname:item.fullname,status:'unknown',verified:false,source:'signed-out-native',why:'Signed-out check unavailable: '+String(error.message || 'request failed').slice(0,200)};}
      if(!current())throw Error('Account or page changed. Try again.');proof.checkedAt=Date.now();
      if(removalProofs.size>=1000 && !removalProofs.has(key))removalProofs.delete(removalProofs.keys().next().value);removalProofs.set(key,{proof,revision:item.revision,expires:Date.now()+(proof.verified?600000:60000)});return {proof};
    });
    const pending={operation,signal};removalQueue=operation;removalPending.set(pendingKey,pending);try{return await operation;}finally{if(removalPending.get(pendingKey)===pending)removalPending.delete(pendingKey);}
  }
  // Your profile as a signed-out visitor sees it (spec §18), through the anonymous transport only: which items it
  // lists, for the Removed view's bulk visibility comparison. Continuations are only those this read handed out.
  async function readRemovalPublicProfile(input,signal){
    const N=globalThis.RTNativeRemoval,me=N?.identity(document),path=pageKey();
    if(!me || input.owner!==me.owner || input.username?.toLowerCase()!==me.username.toLowerCase() || ['url','origin','method','headers'].some(k=>input[k]!==undefined))throw Error('Invalid own signed-out profile read.');
    const source=removalSource(input),key=removalScope(me)+':'+source;
    if(input.after!=null && (typeof input.after!=='string' || removalPublicCursors.get(input.after)!==key))throw Error('Invalid signed-out profile continuation.');
    const url=new URL(input.after || removalFirstPage(me,source),location.origin);
    const html=await publicBrowserRead(url.href,signal,false),now=N.identity(document);
    if(signal?.aborted || pageKey()!==path || now?.owner!==me.owner || now?.username.toLowerCase()!==me.username.toLowerCase())throw Error('Account or page changed. Try again.');
    const value=N.publicListing(new DOMParser().parseFromString(html,'text/html'),me,{continuation:Boolean(input.after),source});
    if(value.after===input.after && value.after)throw Error('Reddit repeated the signed-out profile continuation.');
    if(value.after){if(removalPublicCursors.size>=1000)removalPublicCursors.delete(removalPublicCursors.keys().next().value);removalPublicCursors.set(value.after,key);}
    return value;
  }
  async function nativeRemovedList(input,signal){
    const N=globalThis.RTNativeRemoval,me=N?.identity(document),path=pageKey();
    if(!me)throw Error('Reddit’s signed-in account is not ready. Refresh this tab to retry.');
    const scope=removalScope(me);
    if(input.action==='own-list-identity')return {username:me.username};
    if(input.username?.toLowerCase()!==me.username.toLowerCase())throw Error('You can only check your own removed items.');
    const source=removalSource(input),key=scope+':'+source;
    if(input.after!=null && (typeof input.after!=='string' || removalCursors.get(input.after)!==key))throw Error('Invalid native profile continuation.');
    const url=new URL(input.after || removalFirstPage(me,source),location.origin);
    const response=await fetch(url.href,{method:'GET',credentials:'include',cache:'no-store',redirect:'error',headers:{Accept:input.after?'text/vnd.reddit.partial+html, text/html;q=0.9':'text/html'},signal});
    if(!response.ok)throw Error('Reddit could not load your native profile (HTTP '+response.status+').');
    const text=await boundedText(response,6000000),now=N.identity(document);
    if(signal?.aborted || pageKey()!==path || now?.owner!==me.owner || now?.username.toLowerCase()!==me.username.toLowerCase())throw Error('Account or page changed. Try again.');
    const value=N.listing(new DOMParser().parseFromString(text,'text/html'),me,source,{continuation:Boolean(input.after)});
    for(const post of value.posts)rememberRemovalItem(post,me);
    if(value.after===input.after && value.after)throw Error('Reddit repeated the native profile continuation.');
    if(value.after){if(removalCursors.size>=1000)removalCursors.delete(removalCursors.keys().next().value);removalCursors.set(value.after,key);}
    return value;
  }
  async function readOwnList(input,signal){
    ownListContext(input);
    if(input.list==='removed' || input.action==='own-list-identity' && new URLSearchParams(location.search).get('rt_list')==='removed')return nativeRemovedList(input,signal);
    if(input.action!=='own-list-identity' && (!ownLists.has(input.list) || input.list==='history' && input.after!=null || input.after!=null && (typeof input.after!=='string' || !/^t[13]_[a-z0-9]{1,32}$/i.test(input.after))))throw Error('Invalid own-list name or cursor.');
    const path=pageKey(),username=await signedInUsername(signal);
    if(signal.aborted || pageKey()!==path)throw Error('Page changed. Try again.');
    if(input.action==='own-list-identity')return {username};
    if(username.toLowerCase()!==input.username.toLowerCase())throw Error('You can only search your own lists. The signed-in account changed.');
    const url=new URL('/user/'+encodeURIComponent(username)+'/'+(input.list==='removed'?'overview':input.list)+(input.list==='history'?'/':'.json'),location.origin);
    if(input.list!=='history'){url.searchParams.set('limit','100');url.searchParams.set('raw_json','1');if(input.after)url.searchParams.set('after',input.after);}
    const response=await fetch(url.href,{method:'GET',credentials:'include',cache:'no-store',redirect:'error',headers:{Accept:input.list==='history'?'text/html':'application/json'},signal});
    if(!response.ok)throw Error(response.status===401?'Sign in to Reddit to search your lists.':response.status===403?'Reddit denied access to your '+input.list+' list (HTTP 403).':'Reddit could not load your '+input.list+' list (HTTP '+response.status+').');
    const text=await boundedText(response);
    if(signal.aborted || pageKey()!==path)throw Error('Page changed. Try again.');
    if(input.list==='history')return historyListing(text);
    let data;try{data=JSON.parse(text);}catch{throw Error('Reddit returned an unexpected own-list response.');}
    const listing=data?.data;
    if(data.kind!=='Listing' || !Array.isArray(listing?.children) || listing.children.length>100 || listing.after!=null && !/^t[13]_[a-z0-9]{1,32}$/i.test(listing.after))throw Error('Reddit returned an unexpected own-list listing.');
    const posts=listing.children.map(item=>item.kind==='t3'?M.normalizePost(item.data):item.kind==='t1' && ['saved','removed'].includes(input.list)?M.normalizeComment(item.data):null);
    if(input.list==='removed')listing.children.forEach((item,index)=>{const post=posts[index];if(post){
      // Only the signed-in author's own items are classified (spec §7); anything else is a malformed page.
      if(post.author.toLowerCase()!==username.toLowerCase())posts[index]=null;else post.moderation=moderationOf(item.data,item.kind);}});
    // A malformed item is an explicit partial load, never silent exhaustion.
    if(posts.some(post=>!post))throw Error('Some '+input.list+' items could not be read. The list search is incomplete.');
    return {posts,after:listing.after || null,hasMore:Boolean(listing.after),scanned:listing.children.length,incomplete:true,source:'reddit'};
  }
  // "Not yet approved" filter (docs/unmoderated-filter-spec.md): moderator check and the Unmoderated queue for the
  // community this page shows. Fixed same-origin paths, the reader's own session, read-only.
  const communityName=/^[A-Za-z0-9_]{2,21}$/;
  function modContext(input){
    const page=location.pathname.match(/^\/r\/([A-Za-z0-9_]{2,21})(?:\/(?:hot|new|top|rising|best))?\/?$/i);
    if(location.protocol!=='https:' || !['reddit.com','www.reddit.com','new.reddit.com','sh.reddit.com'].includes(location.hostname) || !page || !communityName.test(input.subreddit || '') || page[1].toLowerCase()!==input.subreddit.toLowerCase())throw Error('Open the community’s feed to check its moderation queue.');
    if(['url','origin','method','headers'].some(key=>input[key]!==undefined))throw Error('Invalid moderation request.');
    return page[1];
  }
  async function modJson(path,params,signal){
    const url=new URL(path,location.origin);for(const [key,value] of Object.entries(params))url.searchParams.set(key,value);
    const response=await fetch(url.href,{method:'GET',credentials:'include',cache:'no-store',redirect:'error',headers:{Accept:'application/json'},signal});
    if(!response.ok)throw Object.assign(Error(response.status===403 || response.status===401?'Reddit says you don’t moderate this community.':'Reddit could not load the moderation queue (HTTP '+response.status+').'),{status:response.status});
    try{return JSON.parse(await boundedText(response));}catch{throw Error('Reddit returned an unexpected moderation response.');}
  }
  async function readModeration(input,signal){
    const name=modContext(input),path=pageKey();
    if(input.action==='mod-status'){
      const data=await modJson('/r/'+name+'/about.json',{raw_json:'1'},signal);
      if(signal.aborted || pageKey()!==path)throw Error('Page changed. Try again.');
      // Signed-out readers get null for every user_is_* field; signed-in readers get a boolean.
      return {moderator:data?.data?.user_is_moderator===true,signedIn:data?.data?.user_is_moderator!==null,subreddit:typeof data?.data?.display_name==='string' && communityName.test(data.data.display_name)?data.data.display_name:name};
    }
    if(input.action==='awaiting-status')return awaitingStatus(input,name,path,signal);
    if(input.after!=null && (typeof input.after!=='string' || !/^t3_[a-z0-9]{1,10}$/i.test(input.after)))throw Error('Invalid moderation queue cursor.');
    const params={limit:'100',only:'links',raw_json:'1'};if(input.after)params.after=input.after;
    const data=await modJson('/r/'+name+'/about/unmoderated.json',params,signal),listing=data?.data;
    if(signal.aborted || pageKey()!==path)throw Error('Page changed. Try again.');
    if(data?.kind!=='Listing' || !Array.isArray(listing?.children) || listing.children.length>100 || listing.after!=null && !/^t3_[a-z0-9]{1,10}$/i.test(listing.after))throw Error('Reddit returned an unexpected moderation queue.');
    const posts=listing.children.filter(item=>item?.kind==='t3').map(item=>M.normalizePost(item.data));
    if(posts.some(post=>!post))throw Error('Some queued posts could not be read.');
    return {posts:posts.filter(post=>post.subreddit.toLowerCase()===name.toLowerCase()),after:listing.after || null,hasMore:Boolean(listing.after)};
  }
  // Awaiting approval for non-moderators (docs/unmoderated-filter-spec.md B8): Reddit's current state of up to 100
  // archived post IDs of this community, read with the reader's session. Posts from another community, and IDs Reddit
  // leaves out, are not answered; the caller counts them as unchecked, never as approved.
  async function awaitingStatus(input,name,path,signal){
    if(!Array.isArray(input.ids) || !input.ids.length || input.ids.length>100 || !input.ids.every(id=>typeof id==='string' && /^[a-z0-9]{1,10}$/.test(id)))throw Error('Invalid post IDs.');
    const ids=[...new Set(input.ids)];
    if(Date.now()<cooldown)throw Error('Reddit asked us to wait. Try again shortly.');
    const url=new URL('/api/info.json',location.origin);url.searchParams.set('id',ids.map(id=>'t3_'+id).join(','));url.searchParams.set('raw_json','1');
    const response=await fetch(url.href,{method:'GET',credentials:'include',cache:'no-store',redirect:'error',headers:{Accept:'application/json'},signal});
    if(response.status===429){const retry=Number(response.headers.get('retry-after'));cooldown=Date.now()+Math.max(1000,Math.min(3600000,(Number.isFinite(retry) && retry>0?retry:60)*1000));throw Error('Reddit rate limit reached. Try again later.');}
    // Reddit refuses /api/info.json from the page (HTTP 403, measured 2026-11-15, -20 and -23); the caller then uses
    // Arctic Shift's recorded state instead.
    if(response.status===403 || response.status===401)return {statuses:[],refused:true};
    if(!response.ok)throw Error('Reddit could not check these posts (HTTP '+response.status+').');
    let data;try{data=JSON.parse(await boundedText(response));}catch{throw Error('Reddit returned an unexpected post status response.');}
    if(signal.aborted || pageKey()!==path)throw Error('Page changed. Try again.');
    if(data?.kind!=='Listing' || !Array.isArray(data?.data?.children) || data.data.children.length>100)throw Error('Reddit returned an unexpected post status response.');
    const statuses=[],seen=new Set();
    for(const child of data.data.children){
      if(child?.kind!=='t3')continue;
      const post=M.normalizePost(child.data,{source:'reddit'});
      if(!post || !ids.includes(post.id) || seen.has(post.id) || post.subreddit.toLowerCase()!==name.toLowerCase())continue;
      seen.add(post.id);const category=child.data?.removed_by_category;
      statuses.push({id:post.id,category:typeof category==='string' && /^[a-z_]{1,40}$/.test(category)?category:null,post});
    }
    return {statuses,subreddit:name};
  }
  // Raffles (docs/raffle-spec.md): comments of one post and account facts, read with the reader's session.
  const raffleId=/^[a-z0-9]{1,10}$/i,raffleComment=/^[a-z0-9]{1,32}$/i;
  const raffleEntry=(raw,postId)=>{
    if(!raw || typeof raw!=='object' || !raffleComment.test(raw.id || ''))return null;
    return {id:raw.id.toLowerCase(),author:typeof raw.author==='string'?raw.author.slice(0,20):'',created_utc:Number(raw.created_utc) || 0,parent_id:typeof raw.parent_id==='string'?raw.parent_id.slice(0,40):'',
      body:typeof raw.body==='string'?raw.body.slice(0,2000):'',permalink:typeof raw.permalink==='string' && raw.permalink.startsWith('/')?raw.permalink.slice(0,300):'/comments/'+postId+'/comment/'+raw.id+'/',removed_by_category:raw.removed_by_category ?? null};
  };
  // Winners' comments for a public draw. Reddit refuses /api/info.json on www.reddit.com (HTTP 403, measured
  // 2026-11-15), so each winner's comment is read from its permalink JSON, three at a time; one failure skips
  // only that comment.
  async function raffleWinnerComments(input,signal){
    if(!raffleId.test(input.postId || '') || !Array.isArray(input.ids) || !input.ids.length || input.ids.length>100 || !input.ids.every(id=>typeof id==='string' && raffleComment.test(id)))throw Error('Invalid winner comments.');
    const postId=input.postId.toLowerCase(),ids=[...new Set(input.ids.map(id=>id.toLowerCase()))],entries=[];let failures=0;
    const one=async id=>{
      const url=new URL('/comments/'+postId+'/_/'+id+'.json',location.origin);for(const [k,v] of Object.entries({depth:'1',limit:'1',raw_json:'1'}))url.searchParams.set(k,v);
      try{
        const response=await fetch(url.href,{method:'GET',credentials:'include',cache:'no-store',redirect:'error',headers:{Accept:'application/json'},signal});
        if(!response.ok)throw Error('HTTP '+response.status);
        const data=JSON.parse(await boundedText(response,2000000)),child=(data?.[1]?.data?.children || []).find(c=>c?.kind==='t1' && String(c.data?.id).toLowerCase()===id);
        if(child && String(child.data?.link_id).toLowerCase()==='t3_'+postId){const entry=raffleEntry(child.data,postId);if(entry)entries.push(entry);}
      }catch(error){if(signal?.aborted)throw error;failures++;}
    };
    for(let i=0;i<ids.length;i+=3)await Promise.all(ids.slice(i,i+3).map(one));
    if(failures===ids.length)throw Error('Reddit could not read the winner comments.');
    return {entries};
  }

  async function raffleMe(signal){
    try{return {username:await signedInUsername(signal)};}catch{return {username:''};}
  }
  async function raffleThread(input,signal){
    if(!raffleId.test(input.postId || ''))throw Error('Invalid post.');
    const postId=input.postId.toLowerCase(),url=new URL('/comments/'+postId+'.json',location.origin);
    for(const [k,v] of Object.entries({limit:'500',sort:'old',raw_json:'1',...(input.topLevelOnly===false?{}:{depth:'1'})}))url.searchParams.set(k,v);
    const response=await fetch(url.href,{method:'GET',credentials:'include',cache:'no-store',redirect:'error',headers:{Accept:'application/json'},signal});
    if(!response.ok)throw Error('Reddit could not load the comments (HTTP '+response.status+').');
    let data;try{data=JSON.parse(await boundedText(response,12000000));}catch(error){throw Error(/too large/.test(error.message)?error.message:'Reddit returned unexpected comments.');}
    const post=data?.[0]?.data?.children?.[0]?.data,listing=data?.[1]?.data;
    if(!post || String(post.id).toLowerCase()!==postId || !Array.isArray(listing?.children))throw Error('Reddit returned unexpected comments.');
    const entries=[],missingTopLevel=[];let missingReplies=0;
    const walk=children=>{for(const child of children || []){
      if(child?.kind==='t1'){const entry=raffleEntry(child.data,postId);if(entry)entries.push(entry);walk(child.data?.replies?.data?.children);}
      else if(child?.kind==='more'){const ids=(Array.isArray(child.data?.children)?child.data.children:[]).filter(id=>raffleComment.test(id));
        if(String(child.data?.parent_id).toLowerCase()==='t3_'+postId)missingTopLevel.push(...ids.map(id=>id.toLowerCase()));else missingReplies+=Math.max(ids.length,Number(child.data?.count) || 0);}
    }};walk(listing.children);
    return {post:{id:postId,author:typeof post.author==='string'?post.author:'',title:typeof post.title==='string'?post.title.slice(0,300):'',subreddit:typeof post.subreddit==='string'?post.subreddit:'',numComments:Number(post.num_comments) || 0,permalink:typeof post.permalink==='string'?post.permalink:''},
      entries,missingTopLevel:[...new Set(missingTopLevel)].slice(0,20000),missingReplies};
  }
  // Comments beyond the thread JSON, read with the same requests Reddit's own client makes (measured 2026-11-14,
  // artifacts/research/verify/raffle/FINDINGS.md): the comments partial for the first page, then the
  // "more comments" POST with its cursor and the page's csrf_token cookie. Works from any Reddit page.
  // One page per call; the answer lists the next loaders (top-level and "more replies") for the caller to follow.
  const reddittImage=url=>{const safe=M.avatarUrl(url);try{return safe && /(?:^|\.)(?:redditstatic\.com|redditmedia\.com|redd\.it)$/.test(new URL(safe).hostname)?safe:'';}catch{return '';}};
  const deepAll=(root,selector,acc=[])=>{for(const el of root.querySelectorAll(selector))acc.push(el);for(const t of root.querySelectorAll('template'))deepAll(t.content,selector,acc);return acc;};
  async function raffleTree(input,signal){
    if(!raffleId.test(input.postId || '') || !communityName.test(input.subreddit || ''))throw Error('Invalid post.');
    if(['url','origin','method','headers'].some(key=>input[key]!==undefined))throw Error('Invalid comment request.');
    const postId=input.postId.toLowerCase(),sub=input.subreddit;
    // Reddit's cursor grows ~700 characters per page (measured: 3,428 after six pages), so it is bounded generously.
    const path=new RegExp('^/svc/shreddit/more-comments/r/'+sub+'/t3_'+postId+'\\?[^#\\s]{0,600}$','i');
    const valid=l=>l && typeof l.src==='string' && typeof l.cursor==='string' && l.cursor.length>0 && l.cursor.length<=200000 && path.test(l.src);
    const accept='text/vnd.reddit.partial+html, text/html;q=0.9';let response;
    if(input.loader==null){
      const url=new URL('/svc/shreddit/comments/r/'+sub+'/'+postId,location.origin);for(const [k,v] of Object.entries({sort:'old','seeker-session':'true','render-mode':'partial'}))url.searchParams.set(k,v);
      response=await fetch(url.href,{method:'GET',credentials:'include',cache:'no-store',redirect:'error',headers:{Accept:accept},signal});
    }else{
      if(!valid(input.loader))throw Error('Invalid comment loader.');
      const csrf=decodeURIComponent((document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/) || [])[1] || '');
      response=await fetch(new URL(input.loader.src,location.origin).href,{method:'POST',credentials:'include',cache:'no-store',redirect:'error',headers:{Accept:accept,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({cursor:input.loader.cursor,csrf_token:csrf}),signal});
    }
    if(response.status===429){const seconds=Number(response.headers.get('retry-after'));return {entries:[],loaders:[],rateLimited:true,retryAfterMs:Number.isFinite(seconds)?Math.min(300000,seconds*1000):30000};}
    if(!response.ok)throw Error('Reddit could not load the comments (HTTP '+response.status+').');
    const doc=new DOMParser().parseFromString(await boundedText(response,8000000),'text/html');
    const entries=[],ids=new Set();
    for(const node of deepAll(doc,'shreddit-comment[thingid]')){
      const id=String(node.getAttribute('thingid')).toLowerCase().replace(/^t1_/,'');if(!raffleComment.test(id) || ids.has(id))continue;ids.add(id);
      const depth=Number(node.getAttribute('depth'));const body=node.querySelector('[slot="comment"]'),paras=body?[...body.querySelectorAll('p,li,blockquote,h1,h2,h3,pre')].filter(el=>!el.parentElement.closest('p,li,blockquote,pre')):[];
      const text=(paras.length?paras.map(el=>el.textContent.replace(/\s+/g,' ').trim()).filter(Boolean).join('\n'):String(body?.textContent || '').replace(/\s+/g,' ').trim()).slice(0,2000);
      const link=String(node.getAttribute('permalink') || '');
      entries.push({id,author:String(node.getAttribute('author') || '').slice(0,20),created_utc:Math.floor(Date.parse(node.getAttribute('created') || '')/1000) || 0,parent_id:depth===0?'t3_'+postId:'t1_',
        body:text,permalink:link.startsWith('/')?link.slice(0,300):'/comments/'+postId+'/comment/'+id+'/',avatar:reddittImage(node.getAttribute('avatar')),score:Number(node.getAttribute('score')) || 0,
        removed_by_category:/^(?:\[deleted\]|\[removed\])$/.test(text) || node.hasAttribute('is-comment-deleted') || node.hasAttribute('deleted')?'unknown':null});
    }
    const loaders=deepAll(doc,'faceplate-partial[src*="more-comments"]').map(p=>({src:p.getAttribute('src') || '',cursor:p.querySelector('input[name="cursor"]')?.value || ''})).filter(valid).map(l=>({...l,topLevel:/(?:^|[?&])top-level=1(?:&|$)/.test(l.src.split('?')[1] || '')}));
    return {entries,loaders};
  }
  // Messaging raffle winners (docs/raffle-spec.md §B7) through Reddit's own chat client, which Reddit preloads
  // (hidden) on every page: the same calls its composer makes (FINDINGS.md, 2026-11-15). Only accounts this page
  // resolved for a raffle (raffle-user) can be messaged, at most 100 per send; the chat token stays in Reddit's client.
  const chatRecipients=new Map();
  function chatClient(){
    const walk=(root,depth=0)=>{for(const el of root.querySelectorAll('rs-matrix-client'))if(el.client)return el.client;if(depth>6)return null;
      for(const el of root.querySelectorAll('*'))if(el.shadowRoot){const found=walk(el.shadowRoot,depth+1);if(found)return found;}return null;};
    const client=walk(document);
    return client && typeof client.createRoom==='function' && typeof client.sendTextMessage==='function' && /^@t2_[a-z0-9]+:reddit\.com$/i.test(client.getUserId?.() || '')?client:null;
  }
  const mxid=id=>'@t2_'+id+':reddit.com';
  const chatError=error=>{const code=String(error?.data?.errcode || error?.errcode || error?.data?.error || error?.message || '');
    if(/rate\.score_room_creation_limit/.test(code) || error?.httpStatus===429)return {sent:false,rateLimited:true,reason:'Reddit limits how many new chats you can start. Try the rest later.'};
    if(/feature_gated/.test(code))return {sent:false,reason:'Reddit doesn’t allow you to start chats right now.'};
    return {sent:false,reason:'Reddit refused the chat'+(code?' ('+code.slice(0,120)+')':'')+'.'};};
  const roomReady=(client,roomId,ms=15000)=>client.getRoom(roomId)?Promise.resolve():new Promise(resolve=>{let timer;const done=()=>{if(client.getRoom(roomId)){clearTimeout(timer);client.off?.('Room',done);resolve();}};timer=setTimeout(()=>{client.off?.('Room',done);resolve();},ms);client.on?.('Room',done);});
  const chatText=text=>typeof text==='string' && text.trim().length>0 && text.length<=10000;
  async function chatStatus(){
    const client=chatClient();if(!client)return {ready:false};
    return {ready:true,syncing:['SYNCING','PREPARED'].includes(client.getSyncState?.()),self:String(client.getUserId()).replace(/^@t2_|:reddit\.com$/g,'')};
  }
  async function chatSend(input){
    if(['url','origin','method','headers'].some(key=>input[key]!==undefined) || typeof input.userId!=='string' || !chatRecipients.has(input.userId) || !chatText(input.text))throw Error('Invalid chat request.');
    const client=chatClient();if(!client)throw Error('Reddit chat isn’t available on this page. Reload the page and try again.');
    const target=mxid(input.userId);if(target===client.getUserId())throw Error('You can’t message yourself.');
    let roomId='',existing=false;
    try{roomId=(await client.getRoomList?.({with_user:target,type:'direct',include:{state:true,timeline:true}}))?.rooms?.[0]?.room_id || '';existing=Boolean(roomId);}catch{}
    if(!roomId){
      try{roomId=(await client.createRoom({preset:'reddit_dm',invite:[target]}))?.room_id || '';}
      catch(error){const known=error?.data?.['com.reddit.existing_room_id'];if(typeof known==='string' && known.startsWith('!')){roomId=known;existing=true;}else return chatError(error);}
    }
    if(!roomId)return {sent:false,reason:'Reddit didn’t return a chat for this user.'};
    await roomReady(client,roomId);
    try{await client.sendTextMessage(roomId,null,input.text,client.makeTxnId?.());}catch(error){return chatError(error);}
    return {sent:true,existing,roomId};
  }
  async function chatGroup(input){
    const ids=Array.isArray(input.userIds)?[...new Set(input.userIds)]:[];
    if(['url','origin','method','headers'].some(key=>input[key]!==undefined) || !ids.length || ids.length>100 || !ids.every(id=>typeof id==='string' && chatRecipients.has(id)) || !chatText(input.text) || typeof input.name!=='string' || input.name.length>64)throw Error('Invalid chat request.');
    const client=chatClient();if(!client)throw Error('Reddit chat isn’t available on this page. Reload the page and try again.');
    const targets=ids.map(mxid).filter(id=>id!==client.getUserId());if(!targets.length)throw Error('There is no one else to message.');
    let roomId;try{roomId=(await client.createRoom({name:input.name.trim() || undefined,preset:'private_chat',visibility:'private',invite:targets.slice(0,10)}))?.room_id;}catch(error){return chatError(error);}
    if(!roomId)return {sent:false,reason:'Reddit didn’t create the group chat.'};
    const failedInvites=[];for(const target of targets.slice(10)){try{await client.invite(roomId,target);}catch{failedInvites.push(target.replace(/^@t2_|:reddit\.com$/g,''));}}
    await roomReady(client,roomId);
    try{await client.sendTextMessage(roomId,null,input.text,client.makeTxnId?.());}catch(error){return {...chatError(error),roomId,failedInvites};}
    return {sent:true,roomId,failedInvites};
  }
  async function raffleUser(input,signal){
    if(!M.validateUsername(input.username))throw Error('Invalid username.');
    const response=await fetch(new URL('/user/'+encodeURIComponent(input.username)+'/about.json?raw_json=1',location.origin).href,{method:'GET',credentials:'include',cache:'no-store',redirect:'error',headers:{Accept:'application/json'},signal});
    if(response.status===404 || response.status===403)return {unavailable:true};
    if(!response.ok)throw Error('Reddit could not load u/'+input.username+' (HTTP '+response.status+').');
    let data;try{data=JSON.parse(await boundedText(response))?.data;}catch{throw Error('Reddit returned an unexpected profile.');}
    if(!data || data.is_suspended===true)return {suspended:true};
    const userId=typeof data.id==='string' && /^[a-z0-9]{1,13}$/i.test(data.id)?data.id.toLowerCase():'';if(userId)chatRecipients.set(userId,input.username);
    const commentAvatar=value=>safeAvatar(headshotOf(String(value || '').replace(/&amp;/g,'&')));
    return {userId,created:Number(data.created_utc) || 0,commentKarma:Number(data.comment_karma) || 0,postKarma:Number(data.link_karma) || 0,avatar:commentAvatar(data.icon_img) || commentAvatar(data.snoovatar_img)};
  }
  // Redaction (docs/redaction-spec.md): writes only to items this page read from the signed-in account's own lists.
  // The modhash stays here, in the page world; the extension's other scripts never receive it.
  const redaction={username:'',modhash:'',allowed:new Map(),cursors:new Map(),dirty:false};
  const redactSources={overview:['new'],submitted:['new','top','controversial'],comments:['new','top','controversial']};
  async function redactIdentity(signal){
    const response=await fetch(new URL('/api/me.json',location.origin).href,{method:'GET',credentials:'include',cache:'no-store',redirect:'error',headers:{Accept:'application/json'},signal});
    if(!response.ok)throw Error(response.status===401 || response.status===403?'Sign in to Reddit to redact your posts and comments.':'Reddit could not confirm your account (HTTP '+response.status+').');
    let data;try{data=JSON.parse(await boundedText(response))?.data;}catch{throw Error('Reddit could not confirm your account.');}
    if(!M.validateUsername(data?.name))throw Error('Sign in to Reddit to redact your posts and comments.');
    if(redaction.username && redaction.username.toLowerCase()!==data.name.toLowerCase()){redaction.allowed.clear();redaction.cursors.clear();redaction.dirty=false;}
    redaction.username=data.name;redaction.modhash=typeof data.modhash==='string' && /^[a-z0-9]{10,100}$/i.test(data.modhash)?data.modhash:'';
    return {username:data.name,canWrite:Boolean(redaction.modhash)};
  }
  function redactNativePage(root,source){
    const feed=root.querySelector('shreddit-feed') || root,items=[];let unread=0;
    const wanted=source==='comments'?'shreddit-profile-comment':source==='submitted'?'shreddit-post':'shreddit-post,shreddit-profile-comment';
    for(const card of feed.querySelectorAll(wanted)){
      if(card.closest('[data-rt-ui]'))continue;
      try{
      const comment=card.tagName==='SHREDDIT-PROFILE-COMMENT',fullname=card.getAttribute(comment?'comment-id':'id');
      const author=comment?card.querySelector('[id^="poster-info-"] a[href*="/user/"]')?.getAttribute('href')?.match(/\/user\/([A-Za-z0-9_-]{3,20})\/?$/)?.[1]:card.getAttribute('author');
      if(!author)throw Error('A native profile author could not be verified.');
      if(author.toLowerCase()!==redaction.username.toLowerCase())continue;
      if(!(comment?/^t1_[a-z0-9]{1,32}$/i:/^t3_[a-z0-9]{1,32}$/i).test(fullname || ''))throw Error('A native profile item could not be read.');
      const action=card.querySelector('shreddit-comment-action-row'),href=card.getAttribute('permalink') || card.getAttribute('href') || action?.getAttribute('permalink') || '';
      let url;try{url=new URL(href,location.origin);}catch{}
      const profile=url?.pathname.match(/^\/user\/([A-Za-z0-9_-]{3,20})\/comments\//)?.[1];
      const subreddit=url?.pathname.match(/^\/r\/([A-Za-z0-9_]{2,21})\/comments\//)?.[1] || (profile?.toLowerCase()===redaction.username.toLowerCase()?'u_'+profile:'');
      const created=Date.parse(card.getAttribute('created-timestamp') || card.querySelector('faceplate-timeago[ts]')?.getAttribute('ts') || card.querySelector('time[datetime]')?.getAttribute('datetime'))/1000;
      const content=card.querySelector(comment?'.md':'[slot="text-body"]');
      if(!subreddit || url.origin!==location.origin || !Number.isFinite(created) || comment && !content)throw Error('A native profile item is incomplete.');
      const paragraphs=[...content?.querySelectorAll('p') || []],body=(paragraphs.length?paragraphs.map(p=>p.textContent.trim()).join('\n\n'):content?.textContent?.trim() || '');
      const score=Number((comment?action:card)?.getAttribute('score'));
      if(!(comment?action:card)?.hasAttribute('score') || !Number.isFinite(score))throw Error('A native profile score could not be read.');
      const item={fullname:fullname.toLowerCase(),kind:comment?'comment':'post',subreddit,created,score,body:body.slice(0,100000),title:(card.getAttribute('post-title') || card.querySelector('h2')?.textContent || '').trim().slice(0,300),
        isSelf:!comment && (card.getAttribute('post-type')==='text' || Boolean(content)),permalink:url.pathname+url.search,deleted:body==='[deleted]',pinned:card.hasAttribute('stickied') || card.getAttribute('is-stickied')==='true'};
      redaction.allowed.set(item.fullname,item.kind);items.push(item);
      }catch{unread++; /* Keep readable authored items; skipped cards never enter the write allow-list. */}
    }
    let after=null;
    const view=source==='submitted'?'posts':source;
    for(const partial of feed.querySelectorAll('faceplate-partial[src*="/svc/shreddit/profiles/"]')){
      const url=new URL(partial.getAttribute('src'),location.origin);
      if(!url.pathname.includes('more-posts'))continue;
      if(url.origin!==location.origin || url.pathname!=='/svc/shreddit/profiles/profile_'+view+'-more-posts/new/' || url.searchParams.get('name')?.toLowerCase()!==redaction.username.toLowerCase() || url.href.length>2048)throw Error('Reddit’s native profile continuation changed.');
      after=url.pathname+url.search;redaction.cursors.set(after,source);break;
    }
    return {items,after,hasMore:Boolean(after),scanned:items.length+unread,unread,transport:'native-profile'};
  }
  async function redactNativeList(input,signal){
    if(input.sort!=='new')throw Error('Native profile discovery requires newest first.');
    let url;
    if(input.after!=null){
      if(typeof input.after!=='string' || redaction.cursors.get(input.after)!==input.source)throw Error('Invalid native profile cursor.');
      url=new URL(input.after,location.origin);
    }else{
      const path='/user/'+encodeURIComponent(redaction.username)+'/'+(input.source==='overview'?'':input.source+'/');
      // Reuse the actual signed-in profile only when it still contains its newest native page.
      const current=location.pathname.replace(/\/$/,'').toLowerCase()===path.replace(/\/$/,'').toLowerCase(),params=new URLSearchParams(location.search);
      if(!redaction.dirty && current && (!params.get('sort') || params.get('sort')==='new') && ![...params.keys()].some(k=>k.startsWith('rt_')) && !document.querySelector('shreddit-feed .virtualized-placeholder') && document.querySelector('shreddit-feed shreddit-post,shreddit-feed shreddit-profile-comment'))return redactNativePage(document,input.source);
      url=new URL(path,location.origin);url.searchParams.set('sort','new');
    }
    const response=await fetch(url.href,{method:'GET',credentials:'include',cache:'no-store',redirect:'error',headers:{Accept:input.after?'text/vnd.reddit.partial+html, text/html;q=0.9':'text/html'},signal});
    if(!response.ok)throw Error('Reddit could not load your native '+input.source+' profile (HTTP '+response.status+').');
    const text=await boundedText(response,6000000),doc=new DOMParser().parseFromString(text,'text/html');
    if(!input.after && !doc.querySelector('shreddit-feed'))throw Error('Reddit returned no native profile feed.');
    if(input.after && /<(?:html|body)\b/i.test(text) && !doc.querySelector('shreddit-feed,shreddit-post,shreddit-profile-comment'))throw Error('Reddit returned an unexpected native profile page.');
    return redactNativePage(doc,input.source);
  }
  async function redactList(input,signal){
    if(!redaction.username || input.username!==redaction.username)throw Error('Confirm your account first.');
    if(!Object.hasOwn(redactSources,input.source) || !redactSources[input.source].includes(input.sort))throw Error('Invalid list.');
    if(input.native===true)return redactNativeList(input,signal);
    if(input.after!=null && (typeof input.after!=='string' || !/^t[13]_[a-z0-9]{1,32}$/i.test(input.after)))throw Error('Invalid list cursor.');
    const url=new URL('/user/'+encodeURIComponent(redaction.username)+'/'+input.source+'.json',location.origin);
    for(const [k,v] of Object.entries({sort:input.sort,limit:'100',raw_json:'1',...(input.sort==='new'?{}:{t:'all'}),...(input.after?{after:input.after}:{})}))url.searchParams.set(k,v);
    const response=await fetch(url.href,{method:'GET',credentials:'include',cache:'no-store',redirect:'error',headers:{Accept:'application/json'},signal});
    if(!response.ok)throw Error('Reddit could not list your '+(input.source==='overview'?'posts and comments':input.source==='submitted'?'posts':'comments')+' (HTTP '+response.status+').');
    let data;try{data=JSON.parse(await boundedText(response,6000000));}catch{throw Error('Reddit returned an unexpected list.');}
    const listing=data?.data;
    if(data?.kind!=='Listing' || !Array.isArray(listing?.children) || listing.children.length>100 || listing.after!=null && !/^t[13]_[a-z0-9]{1,32}$/i.test(listing.after))throw Error('Reddit returned an unexpected list.');
    const items=[];
    for(const child of listing.children){
      const raw=child?.data;if(!raw || !['t1','t3'].includes(child.kind) || typeof raw.id!=='string' || !/^[a-z0-9]{1,32}$/i.test(raw.id))continue;
      // Your own lists only ever hold your items; anything else is skipped and never becomes writable.
      if(String(raw.author).toLowerCase()!==redaction.username.toLowerCase())continue;
      const kind=child.kind==='t1'?'comment':'post',fullname=child.kind+'_'+raw.id.toLowerCase(),body=kind==='comment'?raw.body:raw.selftext;
      const item={fullname,kind,subreddit:typeof raw.subreddit==='string'?raw.subreddit:'',created:Number(raw.created_utc) || 0,score:Number(raw.score) || 0,
        title:kind==='post' && typeof raw.title==='string'?raw.title.slice(0,300):(typeof raw.link_title==='string'?raw.link_title.slice(0,300):''),body:typeof body==='string'?body.slice(0,100000):'',
        isSelf:kind==='post'?raw.is_self===true:undefined,permalink:typeof raw.permalink==='string' && raw.permalink.startsWith('/')?raw.permalink.slice(0,300):'',deleted:body==='[deleted]' || raw.removed_by_category==='deleted'};
      if(redaction.allowed.size<50000 || redaction.allowed.has(fullname))redaction.allowed.set(fullname,kind);items.push(item);
    }
    return {items,after:listing.after || null,hasMore:Boolean(listing.after),scanned:listing.children.length};
  }
  async function redactItem(input,signal){
    if(!['overwrite','delete'].includes(input.step) || typeof input.fullname!=='string' || !/^t[13]_[a-z0-9]{1,32}$/.test(input.fullname))throw Error('Invalid redaction request.');
    if(['url','origin','method','headers'].some(key=>input[key]!==undefined))throw Error('Invalid redaction request.');
    if(!redaction.allowed.has(input.fullname))throw Error('This item wasn’t read from your own lists on this page, so it can’t be changed.');
    if(!redaction.modhash || input.username!==redaction.username)throw Error('Confirm your account first.');
    if(input.step==='overwrite' && (typeof input.text!=='string' || !input.text.trim() || input.text.length>1000))throw Error('Invalid replacement text.');
    const body=input.step==='overwrite'?new URLSearchParams({thing_id:input.fullname,text:input.text,api_type:'json'}):new URLSearchParams({id:input.fullname});
    const response=await fetch(new URL(input.step==='overwrite'?'/api/editusertext':'/api/del',location.origin).href,{method:'POST',credentials:'include',cache:'no-store',redirect:'error',
      headers:{'Content-Type':'application/x-www-form-urlencoded','X-Modhash':redaction.modhash,Accept:'application/json'},body,signal});
    if(response.status===429){const seconds=Number(response.headers.get('retry-after'));return {written:false,rateLimited:true,retryAfterMs:Number.isFinite(seconds)?seconds*1000:60000,reason:'Reddit is limiting requests.'};}
    if(!response.ok)return {written:false,reason:'Reddit refused the '+(input.step==='overwrite'?'edit':'delete')+' (HTTP '+response.status+').'};
    let data=null;try{const text=await boundedText(response);data=text?JSON.parse(text):{};}catch{data=null;}
    const errors=data?.json?.errors;
    if(data==null)return {written:false,reason:'Reddit returned an unexpected answer.'};
    if(Array.isArray(errors) && errors.length)return {written:false,reason:'Reddit refused the '+(input.step==='overwrite'?'edit':'delete')+': '+String(errors[0]?.[1] || errors[0]?.[0] || 'unknown error').slice(0,200)+'.'};
    if(input.step==='delete')redaction.allowed.delete(input.fullname);
    redaction.dirty=true;return {written:true};
  }
  async function read(input,signal){
    if(input.action==='removal-public')return readRemovalPublic(input,signal);
    if(input.action==='removal-public-profile')return readRemovalPublicProfile(input,signal);
    if(input.action==='blocked-probe')return blockedProbe(input,signal);
    if(input.action==='blocked-profile-page')return blockedProfilePage(input,signal);
    if(input.action==='blocked-thread-items')return blockedThreadItems(input,signal);
    if(input.action==='community-suggestions')return readCommunitySuggestions(input,signal);
    if(['own-list','own-list-identity'].includes(input.action))return readOwnList(input,signal);
    if(['mod-status','unapproved','awaiting-status'].includes(input.action))return readModeration(input,signal);
    if(input.action==='raffle-thread')return raffleThread(input,signal);
    if(input.action==='raffle-me')return raffleMe(signal);
    if(input.action==='raffle-winner-comments')return raffleWinnerComments(input,signal);
    if(input.action==='raffle-tree')return raffleTree(input,signal);
    if(input.action==='raffle-user')return raffleUser(input,signal);
    if(input.action==='chat-status')return chatStatus();
    if(input.action==='chat-send')return chatSend(input);
    if(input.action==='chat-group')return chatGroup(input);
    if(input.action==='redact-identity')return redactIdentity(signal);
    if(input.action==='redact-list')return redactList(input,signal);
    if(input.action==='redact-item')return redactItem(input,signal);
    if(input.action==='user-avatar')return userAvatar(input,signal);
    if(input.action==='render-card')return renderCard(input,signal);
    if(input.action==='status')return readStatuses(input,signal);
    if(input.action==='render-navigation')return renderNavigation(input,signal);
    if(input.action==='prefetch-navigation')return prefetchNavigation(input);
    if(input.action==='refresh-archive-thread')return refreshArchiveThread(input);
    if(input.action==='load-archive-comment-modules')return loadArchiveCommentModules(input,signal);
    if(input.action==='render-controls')return renderControls(input,signal);
    if(input.action==='render-search-empty')return renderSearchEmpty(input,signal);
    const context=route(),path=pageKey();
    if(!context || !['reddit.com','www.reddit.com','new.reddit.com','sh.reddit.com','old.reddit.com'].includes(location.hostname))throw Error('Open a public Reddit profile or post.');
    const comments=input.kind==='comment';
    // A search view request carries the user's plain words; it needs relevance and comment-count sorts too.
    const search=input.action==='profile' && input.query!==undefined,query=search && typeof input.query==='string'?input.query.trim():'';
    if(search && (typeof input.query!=='string' || query.length>300 || /[\u0000-\u001f]/.test(query)))throw Error('Invalid search words.');
    const sort=input.sort ?? (search?'relevance':'new'),range=input.range ?? 'all';
    if(!(search?['new','hot','top','relevance','comments']:['new','hot','top']).includes(sort) || !['hour','day','week','month','year','all'].includes(range))throw Error('Invalid public feed sort.');
    if(input.kind!=null && !['post','comment'].includes(input.kind))throw Error('Invalid content type.');
    const stream=input.stream ?? 'authenticated';
    if(input.stream!=null && (input.action!=='profile' || !comments || !['authenticated','public'].includes(stream)))throw Error('Invalid comment discovery stream.');
    const url=new URL('/api/info.json',location.origin);let nativeSearch=false,postPage=null,commentCursor=null,anonymous=false,q='';
    if(input.action==='profile'){
      if(!context.username || !M.validateUsername(input.username) || context.username.toLowerCase()!==input.username.toLowerCase())throw Error('Profile changed. Try again.');
      q=authorQuery(input.username)+(query?' '+query:'');
      if(comments)commentCursor=readCommentCursor(input.after,stream,input.username,sort,range,q);
      if(!comments)postPage=readPostCursor(input.after,input.username,sort,range,q);
      // Signed-in Shreddit omits posts for explicitly blocked profiles in live
      // comparisons. Keep the existing authenticated JSON path for that case;
      // the page cursor pins its transport until Refresh starts a new scope.
      const blocked=!comments && Boolean(document.querySelector('#right-sidebar-container faceplate-tracker[source="profile"][noun="unblock_user"]'));
      // Blocked profiles: signed-in search omits their posts and the legacy JSON
      // route now answers 403, so search them without credentials instead.
      nativeSearch=comments || (postPage?.transport || 'shreddit')==='shreddit';anonymous=comments?stream==='public':blocked && nativeSearch;
      url.pathname=nativeSearch?'/svc/shreddit/search/':'/search.json';url.searchParams.set('q',q);url.searchParams.set('type',comments?'comments':nativeSearch?'posts':'link');url.searchParams.set('sort',sort);if(sort==='top' || search && range!=='all')url.searchParams.set('t',range);url.searchParams.set('limit','25');
      if(input.after)url.searchParams.set(nativeSearch?'cursor':'after',comments?commentCursor:postPage.cursor);
      // Only credential-free extension searches opt into the browser's Google Referer rule.
      if(nativeSearch && anonymous)url.searchParams.set('rt_public_search','1');
    }else if(input.action==='info'){
      if(!Array.isArray(input.ids) || !input.ids.length || input.ids.length>25 || !input.ids.every(id=>comments?M.validateCommentId(id):M.validateId(id)))throw Error('Invalid public post IDs.');
      const ids=input.ids.map(id=>id.toLowerCase().replace(/^t[13]_/, ''));
      if(context.id && (comments || ids.length!==1 || ids[0]!==context.id))throw Error('Post changed. Try again.');
      url.searchParams.set('id',ids.map(id=>(comments?'t1_':'t3_')+id).join(','));
    }else throw Error('Unknown public post operation.');
    const now=Date.now();
    if(now<cooldown)throw Error('Reddit asked us to wait. Try again shortly.');
    if(active>=2)return {deferred:true,retryAfterMs:250};
    active++;
    if(!nativeSearch)url.searchParams.set('raw_json','1');
    const controller=new AbortController(),cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
    let timer;
    try{
      const operation=(async()=>{
        const useBrowser=nativeSearch && anonymous && globalThis.RTPublicBrowser?.hasSession?.();
        const response=useBrowser?null:await fetch(url.href,{method:'GET',credentials:input.action==='profile' && anonymous?'omit':'include',...(input.action==='profile' && nativeSearch && (comments || anonymous)?{cache:'no-store',referrerPolicy:'no-referrer'}:{}),redirect:'error',headers:{Accept:nativeSearch?'text/vnd.reddit.partial+html, text/html;q=0.9':'application/json'},signal:controller.signal});
        if(response?.status===429){const hint=response.headers.get('retry-after'),seconds=Number(hint),retry=Number.isFinite(seconds)?seconds*1000:Date.parse(hint)-Date.now();cooldown=Date.now()+Math.max(1000,Math.min(3600000,retry>0?retry:60000));throw Error('Reddit rate limit reached. Try again later.');}
        let publicText=useBrowser?await publicBrowserRead(url.href,controller.signal,input.refresh===true):undefined;
        // Cold anonymous reads start a browser only after explicit refusal;
        // verified anonymous sessions are reused directly. Signed-in reads
        // never enter this transport or lend it their cookies.
        if(nativeSearch && anonymous && response?.status===403)publicText=await publicBrowserRead(url.href,controller.signal,input.refresh===true);
        if(response && !response.ok && publicText===undefined){
          // Name the source so the page can explain it; 403 means Reddit refused this request.
          const what=input.action==='profile'?(comments?(stream==='public'?'logged-out comment search':'comment search'):'post search'):'item details';
          throw Error(response.status===403?`Reddit blocked ${what} (HTTP 403).`:`Reddit couldn’t load ${what} (HTTP ${response.status}).`);
        }
        const text=publicText===undefined?await boundedText(response):publicText;
        if(pageKey()!==path || controller.signal.aborted)throw Error('Page changed. Try again.');
        if(nativeSearch)return (comments?commentListing:postListing)(text,input.username,{sort,range,stream,q,search});
        let data;try{data=JSON.parse(text);}catch{throw Error('Reddit returned an unexpected response.');}
        if(!Array.isArray(data?.data?.children) || data.data.children.length>100)throw Error('Reddit returned an unexpected post listing.');
        if(pageKey()!==path || controller.signal.aborted)throw Error('Page changed. Try again.');
        const posts=data.data.children.filter(item=>item.kind===(comments?'t1':'t3')).slice(0,25).map(item=>(comments?M.normalizeComment:M.normalizePost)(item.data,{source:'reddit'})).filter(Boolean);
        const filtered=input.action==='profile'?posts.filter(p=>p.author.toLowerCase()===input.username.toLowerCase()):posts.filter(p=>input.ids.some(id=>id.toLowerCase().replace(/^t[13]_/, '')===p.id));
        const cursor=typeof data.data.after==='string' && /^t3_[a-z0-9]{1,10}$/i.test(data.data.after)?data.data.after:null;
        const after=input.action==='profile'?postPageCursor(cursor,'json',input.username,sort,range,q):cursor;
        return {posts:filtered,after,hasMore:Boolean(after),incomplete:true,source:'reddit'};
      })();
      const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Reddit request timed out. Try again.'));},nativeSearch && anonymous?25000:10000);});
      return await Promise.race([operation,timeout]);
    }finally{active--;clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
  }
  document.addEventListener('rt-post-request',async event=>{
    let input;try{input=JSON.parse(event.detail);}catch{return;}
    if(typeof input?.channel!=='string' || input.channel.length>80 || typeof input.id!=='string' || input.id.length>80)return;
    const key=input.channel+':'+input.id;
    if(input.action==='cancel'){jobs.get(key)?.abort();return;}
    if(jobs.has(key))return;
    if(jobs.size>=4){const deferred=['own-list','own-list-identity','removal-public','removal-public-profile','blocked-probe','blocked-profile-page','blocked-thread-items','render-card','render-navigation','render-controls','render-search-empty','profile','info','status','user-avatar','raffle-thread','raffle-me','raffle-winner-comments','raffle-tree','raffle-user','chat-status','chat-send','chat-group','unapproved','mod-status','awaiting-status','community-suggestions','redact-identity','redact-list','redact-item'].includes(input.action);document.dispatchEvent(new CustomEvent('rt-post-response',{detail:JSON.stringify({channel:input.channel,id:input.id,ok:deferred,...(deferred?{deferred:true,retryAfterMs:250}:{error:'Please wait for the current Reddit request.'})})}));return;}
    const controller=new AbortController();jobs.set(key,controller);
    try{const result=await read(input,controller.signal);document.dispatchEvent(new CustomEvent('rt-post-response',{detail:JSON.stringify({channel:input.channel,id:input.id,ok:true,...result})}));}
    catch(error){document.dispatchEvent(new CustomEvent('rt-post-response',{detail:JSON.stringify({channel:input.channel,id:input.id,ok:false,error:controller.signal.aborted?'Post request cancelled.':error.message})}));}
    finally{jobs.delete(key);}
  });
})();
