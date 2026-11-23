/* Runs in allowlisted player frames after the user grants optional host access. */
(() => {
  'use strict';
  const {redditOrigins,wrapperOrigin,playerOrigin}=globalThis.RTEmbedHosts;
  if(window.parent===window || !playerOrigin(location.href))return;
  const wrapper=location.origin===wrapperOrigin;
  const parents=window.parent===window.top?redditOrigins:[wrapperOrigin];
  // The worker checks the browser-supplied tab URL and returns {authorized, holdFeed} (or bare true in unit tests).
  const ready=(globalThis.browser || globalThis.chrome).runtime.sendMessage({scope:'rt-embed-player'}).then(res=>{
    if(res===true)return {authorized:true,holdFeed:true};
    if(res && typeof res==='object')return {authorized:res.authorized===true,holdFeed:res.holdFeed===true};
    return {authorized:false,holdFeed:false};
  },()=>({authorized:false,holdFeed:false}));
  let discoveryObserver=null;
  let allowed=false,parentOrigin='',block=false,child=null,childOrigin='',childState={},playback='',sound='',announced=false;
  let targetVolume=null,loopPolicy='default',hold2xEnabled=false,activeHold2x=null,suppressClickUntil=-Infinity;
  // While the Reddit page previews this player (preview on), a click on the video surface is reported as a tap instead
  // of toggling playback, and a click on the player's own controls as the viewer taking the player.
  let previewOn=false,lastInput=-Infinity;
  const CONTROLS='button,input,select,[role="button"]:not(a[href]),[role="slider"],[role="menu"],[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"],[role="dialog"],[role="listbox"],[role="option"]';
  // Player chrome of the common embed players (YouTube, video.js, Plyr, JW Player): a click there is the viewer using
  // the player, never a tap on the video.
  const CHROME='.ytp-chrome-bottom,.ytp-chrome-top,.ytp-popup,.ytp-ce-element,.ytp-cards-teaser,.ytp-pause-overlay,.ytp-endscreen-content,.ytp-large-play-button,.ytp-watermark,.vjs-control-bar,.vjs-menu,.vjs-big-play-button,.plyr__controls,.plyr__menu,.jw-controls-backdrop~.jw-controlbar,.jw-controlbar,.jw-settings-menu,.jw-display-icon-container';
  const media=()=>document.querySelector('video');
  // A player that starts by itself (RedGIFs) waits on its first frame until the Reddit page says play or pause, so an
  // idle feed card shows the real first frame instead of an image or a blank box. Without an answer within 3 s — or
  // immediately when holdFeed is false (passive default) — it plays as it would have; viewer input is never held back.
  const ancestors=location.ancestorOrigins,top=ancestors?.length?ancestors[ancestors.length-1]:'';
  let eligible=ancestors?redditOrigins.includes(top):true,acted=false,instructed=false,heldOnce=false,soundRevision=0;
  const holdUntil=performance.now()+3000;
  const holding=()=>eligible && !acted && (instructed?playback==='pause':performance.now()<holdUntil);
  function hold(video){
   if(!holding())return;
   video.pause();
   if(!heldOnce){heldOnce=true;try{if(video.currentTime>0.25)video.currentTime=0;}catch{}}
  }
  function desiredLoop(video){
   if(loopPolicy==='always')return true;
   if(loopPolicy==='never')return false;
   if(loopPolicy==='short')return Number.isFinite(video.duration) && video.duration>0 && video.duration<30;
   return null;
  }
  function applyLoop(video=media()){
   if(!video)return;
   const want=desiredLoop(video);
   if(want!==null)video.loop=want;
  }
  function applyVolume(video=media()){
   if(!video || !Number.isFinite(targetVolume))return;
   video.volume=targetVolume;
  }
  function endHold2x(swallowClick=false){
   if(!activeHold2x)return;
   const h=activeHold2x;activeHold2x=null;
   clearTimeout(h.timer);
   if(h.engaged){
    try{h.video.playbackRate=h.rate;}catch{}
    h.pill?.remove();
    if(swallowClick)suppressClickUntil=performance.now()+120;
   }
  }
  function startHold2x(event){
   if(!hold2xEnabled || (!event.isTrusted && !globalThis.__rtEmbedHold2xTest) || event.button>0)return;
   const path=event.composedPath(),video=media();
   if(!video || video.paused || video.ended || !path.includes(video))return;
   if(path.some(node=>node.matches?.('button,input,select,[role="button"]:not(a[href]),[role="slider"]')))return;
   const isTouch=event.pointerType==='touch' || event.pointerType==='pen';
   const rect=video.getBoundingClientRect();
   if(video.controls && rect.height>0 && rect.bottom-event.clientY<52)return;
   if(isTouch && rect.width>0 && (event.clientX-rect.left)<rect.width*0.6)return;
   endHold2x(false);
   const state={video,x:event.clientX,y:event.clientY,rate:video.playbackRate || 1,engaged:false,pill:null,timer:null};
   state.timer=setTimeout(()=>{
    if(activeHold2x!==state || !video.isConnected || video.paused || video.ended)return;
    state.engaged=true;
    state.rate=video.playbackRate || 1;
    video.playbackRate=2;
    const pill=document.createElement('div');
    pill.dataset.rtSpeedPill='';
    pill.textContent='2× ▶▶';
    Object.assign(pill.style,{position:'fixed',top:'12px',left:'50%',transform:'translateX(-50%)',zIndex:'2147483647',
     padding:'4px 10px',borderRadius:'999px',background:'rgba(0,0,0,.78)',color:'#fff',font:'600 12px/16px system-ui,sans-serif',
     pointerEvents:'none',letterSpacing:'0.02em'});
    (document.body || document.documentElement)?.append(pill);
    state.pill=pill;
   },isTouch?350:300);
   activeHold2x=state;
  }
  window.addEventListener('pointerdown',event=>{
   if(event.isTrusted){acted=true;soundRevision++;}
   if(event.isTrusted || globalThis.__rtEmbedPreviewTest)lastInput=performance.now();
   startHold2x(event);
  },true);
  window.addEventListener('pointermove',event=>{
   if(!activeHold2x || activeHold2x.engaged)return;
   if(Math.hypot(event.clientX-activeHold2x.x,event.clientY-activeHold2x.y)>10)endHold2x(false);
  },true);
  for(const type of ['pointerup','pointercancel','blur'])window.addEventListener(type,()=>endHold2x(type==='pointerup'),true);
  window.addEventListener('contextmenu',event=>{if(activeHold2x?.engaged)event.preventDefault();},true);
  for(const type of ['keydown','touchstart'])window.addEventListener(type,event=>{if(event.isTrusted){acted=true;soundRevision++;lastInput=performance.now();}},true);
  document.addEventListener('play',event=>{if(event.target.matches?.('video')){hold(event.target);applyLoop(event.target);applyVolume(event.target);}},true);
  document.addEventListener('loadedmetadata',event=>{if(event.target.matches?.('video')){applyLoop(event.target);applyVolume(event.target);}},true);
  document.addEventListener('durationchange',event=>{if(event.target.matches?.('video'))applyLoop(event.target);},true);
  document.addEventListener('ended',event=>{
   const video=event.target;
   if(!video.matches?.('video'))return;
   if(desiredLoop(video)===true){video.currentTime=0;video.play()?.catch(()=>{});}
  },true);
  document.addEventListener('loadeddata',event=>{const video=event.target;if(video.matches?.('video') && holding()){video.preload='auto';if(!video.paused)hold(video);}},true);
  setTimeout(()=>{if(!instructed && heldOnce && eligible && !acted)media()?.play()?.catch(()=>{});},3050);
  const up=(rtMedia,fields)=>{
    if(parentOrigin)window.parent.postMessage({rtMedia,...fields},parentOrigin);
    else for(const origin of parents)window.parent.postMessage({rtMedia,...fields},origin);
  };
  const down=(rtMedia,fields)=>child?.postMessage({rtMedia,...fields},childOrigin);
  const hello=()=>{
    const video=media();
    if(allowed && (video || child)){
      announced=true;
      discoveryObserver?.disconnect();discoveryObserver=null;
      up('hello',video?{playing:!video.paused && !video.ended,rendered:video.readyState>=2}:childState);
    }
  };
  // The player's own sound button, so its icon and its own sound state follow (it re-mutes a video changed behind it).
  const soundButton=()=>[...document.querySelectorAll('button,[role="button"]')].find(node=>/\b(mute|unmute|sound|volume|audio)\b/i.test([node.getAttribute('aria-label'),node.getAttribute('title'),node.getAttribute('data-testid'),typeof node.className==='string'?node.className:''].join(' ')));
  function setSound(video,muted){
    const revision=++soundRevision,keepPlaying=!video.paused && !video.ended;
    if(video.muted!==muted)soundButton()?.click();
    const force=()=>{
      if(revision!==soundRevision || media()!==video)return;
      if(video.muted!==muted){video.muted=muted;if(!muted){video.defaultMuted=false;if(video.volume===0)video.volume=1;}}
      if(keepPlaying && playback!=='pause' && video.paused && !video.ended)video.play()?.catch(()=>{});
    };
    force();setTimeout(force,120);setTimeout(force,600);
  }
  function apply(method,video=media()){
    if(!video)return;
    if(method==='mute')setSound(video,true);
    if(method==='unmute')setSound(video,false);
    if(method==='play')video.play()?.catch(()=>{});
    if(method==='pause')video.pause();
  }
  function resumeAt({time,muted}){
    const video=media();
    if(!video || !Number.isFinite(time) || time<0 || time>86400 || typeof muted!=='boolean')return;
    const resume=()=>{
      if(playback!=='resume' || media()!==video)return;
      video.currentTime=Number.isFinite(video.duration)?Math.min(time,Math.max(0,video.duration-0.1)):time;
      setSound(video,muted);apply('play',video);
    };
    if(video.readyState)resume();
    else video.addEventListener('loadedmetadata',resume,{once:true});
  }
  window.addEventListener('message',async event=>{
    const method=event.data?.rtMedia;
    if(!['hello','play','pause','mute','unmute','policy','rendered','release','progress','resume','volume','loop','hold2x','preview','tap','take'].includes(method) || !(await ready).authorized)return;
    if(event.source===window.parent && parents.includes(event.origin) && !['hello','rendered','progress','tap','take'].includes(method)){
      parentOrigin=event.origin;
      if(method==='preview'){previewOn=event.data.on===true;down(method,{on:previewOn});return;}
      if(method==='policy'){block=event.data.block===true;document.documentElement.toggleAttribute('data-rt-block-links',block);}
      else if(method==='volume'){
        const vol=Number(event.data.volume);
        if(Number.isFinite(vol) && vol>=0 && vol<=1){targetVolume=vol;applyVolume();}
        down(method,{volume:targetVolume});
        return;
      }
      else if(method==='loop'){
        if(['default','always','never','short'].includes(event.data.policy)){loopPolicy=event.data.policy;applyLoop();}
        down(method,{policy:loopPolicy});
        return;
      }
      else if(method==='hold2x'){
        hold2xEnabled=event.data.enabled===true;
        if(!hold2xEnabled)endHold2x(false);
        down(method,{enabled:hold2xEnabled});
        return;
      }
      else if(method==='release'){
        if(!instructed && heldOnce && !acted)apply('play');
        instructed=true;
      }
      else if(method==='resume'){
        playback=method;instructed=true;resumeAt(event.data);
        down(method,{time:event.data.time,muted:event.data.muted});
        return;
      }
      else{
        if(method==='mute' || method==='unmute')sound=method;
        else{playback=method;instructed=true;if(method==='pause')eligible=true;}
        apply(method);
      }
      down(method,method==='policy'?{block}:undefined);
      return;
    }
    if(!wrapper || !['hello','play','pause','rendered','progress','tap','take'].includes(method))return;
    const frame=[...document.querySelectorAll('iframe[src]')].find(frame=>frame.contentWindow===event.source && playerOrigin(frame.src)===event.origin);
    if(!frame)return;
    if(method==='hello'){
      child=event.source;childOrigin=event.origin;
      childState={playing:event.data.playing===true,rendered:event.data.rendered===true};
      down('policy',{block});
      if(Number.isFinite(targetVolume))down('volume',{volume:targetVolume});
      if(loopPolicy!=='default')down('loop',{policy:loopPolicy});
      if(hold2xEnabled)down('hold2x',{enabled:true});
      if(sound)down(sound);if(playback)down(playback);
      if(previewOn)down('preview',{on:true});
      hello();
    }else if(event.source===child && method==='progress'){
      up(method,{time:event.data.time,muted:event.data.muted});
    }else if(event.source===child && (method==='tap' || method==='take')){
      if(method==='take')previewOn=false;
      up(method);
    }else if(event.source===child){
      if(method==='rendered')childState.rendered=true;else childState.playing=method==='play';
      up(method,method==='play'?{user:event.data.user===true}:undefined);
    }
  });
  function intercept(event){
    if(event.type==='click' && performance.now()<suppressClickUntil){
      event.preventDefault();event.stopImmediatePropagation();return;
    }
    if(event.defaultPrevented)return;
    const path=event.composedPath(),target=path[0],link=path.find(node=>node.matches?.('a[href],area[href]'));
    const video=target?.matches?.('video')?target:link?.querySelector('video');
    // The bottom 52 px of a player is its control strip, whether native controls or the provider's own overlay.
    const inStrip=node=>{if(!node)return false;const box=node.getBoundingClientRect();return (node.controls || box.height>80) && box.bottom-event.clientY<52 && event.clientY<=box.bottom;};
    const control=path.some(node=>node.matches?.(CONTROLS) || node.matches?.(CHROME)) || inStrip(video);
    // Preview: the video surface is the Reddit page's (tap); the player's own controls or links hand it the player (take).
    if(previewOn && event.type==='click' && event.button===0 && (event.isTrusted || globalThis.__rtEmbedPreviewTest)){
      if(control || inStrip(media()) || link && !video){previewOn=false;up('take');}
      else{event.preventDefault();event.stopImmediatePropagation();up('tap');return;}
    }
    if(!block)return;
    const webLink=link && /^https?:/.test(link.href) && link.href.split('#')[0]!==location.href.split('#')[0];
    if(control || !webLink && !video)return;
    event.preventDefault();event.stopImmediatePropagation();
    if(video && event.button===0){if(video.paused)apply('play',video);else video.pause();}
  }
  for(const type of ['click','auxclick'])window.addEventListener(type,intercept,true);
  ready.then(({authorized,holdFeed})=>{
    if(!authorized){
      // Not a Reddit player after all: let a held video play as it would have.
      const wasHeld=eligible && heldOnce && !acted;eligible=false;
      if(wasHeld)media()?.play()?.catch(()=>{});
      return;
    }
    if(!holdFeed){
      const wasHeld=eligible && heldOnce && !acted && !instructed;
      eligible=false;
      if(wasHeld)media()?.play()?.catch(()=>{});
    }
    allowed=true;
    // A start that follows the viewer's own input inside the player is theirs (user), so the page never pauses it.
    for(const type of ['play','pause','ended'])document.addEventListener(type,event=>{
      if(event.target.matches?.('video') && parentOrigin)up(type==='ended'?'pause':type,type==='play'?{user:performance.now()-lastInput<1500}:undefined);
    },true);
    document.addEventListener('loadeddata',event=>{
      if(event.target===media())up('rendered');
    },true);
    let lastProgress=-Infinity;
    document.addEventListener('timeupdate',event=>{
      const video=event.target,now=performance.now();
      if(!parentOrigin || video.paused || now-lastProgress<750 || video!==media())return;
      lastProgress=now;up('progress',{time:video.currentTime,muted:video.muted});
    },true);
    if(!announced){
      discoveryObserver=new MutationObserver(()=>{if(media())hello();});
      discoveryObserver.observe(document,{childList:true,subtree:true});
    }
    hello();
    // An already-loaded player can announce before Reddit's document-idle script starts.
    if(!parentOrigin)for(const delay of [300,1000,3000])setTimeout(()=>{if(!parentOrigin)hello();},delay);
  });
})();
