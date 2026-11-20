/* Runs in allowlisted player frames after the user grants optional host access. */
(() => {
  'use strict';
  const {redditOrigins,wrapperOrigin,playerOrigin}=globalThis.RTEmbedHosts;
  if(window.parent===window || !playerOrigin(location.href))return;
  const wrapper=location.origin===wrapperOrigin;
  const parents=window.parent===window.top?redditOrigins:[wrapperOrigin];
  // The worker checks the browser-supplied tab URL before we inspect or control media.
  const ready=(globalThis.browser || globalThis.chrome).runtime.sendMessage({scope:'rt-embed-player'}).catch(()=>false);
  let allowed=false,parentOrigin='',block=false,child=null,childOrigin='',childState={},playback='',sound='',announced=false;
  const media=()=>document.querySelector('video');
  // A player that starts by itself (RedGIFs) waits on its first frame until the Reddit page says play or pause, so an
  // idle feed card shows the real first frame instead of an image or a blank box. Without an answer within 3 s it
  // plays as it would have; anything the viewer does inside the player is never held back.
  const ancestors=location.ancestorOrigins,top=ancestors?.length?ancestors[ancestors.length-1]:'';
  let eligible=ancestors?redditOrigins.includes(top):true,acted=false,instructed=false,heldOnce=false,soundRevision=0;
  const holdUntil=performance.now()+3000;
  const holding=()=>eligible && !acted && (instructed?playback==='pause':performance.now()<holdUntil);
  function hold(video){
   if(!holding())return;
   video.pause();
   if(!heldOnce){heldOnce=true;try{if(video.currentTime>0.25)video.currentTime=0;}catch{}}
  }
  for(const type of ['pointerdown','keydown','touchstart'])window.addEventListener(type,event=>{if(event.isTrusted){acted=true;soundRevision++;}},true);
  document.addEventListener('play',event=>{if(event.target.matches?.('video'))hold(event.target);},true);
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
    if(!['hello','play','pause','mute','unmute','policy','rendered','release','progress','resume'].includes(method) || !await ready)return;
    if(event.source===window.parent && parents.includes(event.origin) && !['hello','rendered','progress'].includes(method)){
      parentOrigin=event.origin;
      if(method==='policy'){block=event.data.block===true;document.documentElement.toggleAttribute('data-rt-block-links',block);}
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
        else{playback=method;instructed=true;}
        apply(method);
      }
      down(method,method==='policy'?{block}:undefined);
      return;
    }
    if(!wrapper || !['hello','play','pause','rendered','progress'].includes(method))return;
    const frame=[...document.querySelectorAll('iframe[src]')].find(frame=>frame.contentWindow===event.source && playerOrigin(frame.src)===event.origin);
    if(!frame)return;
    if(method==='hello'){
      child=event.source;childOrigin=event.origin;
      childState={playing:event.data.playing===true,rendered:event.data.rendered===true};
      down('policy',{block});if(sound)down(sound);if(playback)down(playback);
      hello();
    }else if(event.source===child && method==='progress'){
      up(method,{time:event.data.time,muted:event.data.muted});
    }else if(event.source===child){
      if(method==='rendered')childState.rendered=true;else childState.playing=method==='play';
      up(method);
    }
  });
  function intercept(event){
    if(!block || event.defaultPrevented)return;
    const path=event.composedPath(),target=path[0],link=path.find(node=>node.matches?.('a[href],area[href]'));
    const video=target?.matches?.('video')?target:link?.querySelector('video');
    const control=path.some(node=>node.matches?.('button,input,select,[role="button"]:not(a[href]),[role="slider"]')) ||
      video?.controls && video.getBoundingClientRect().bottom-event.clientY<52;
    const webLink=link && /^https?:/.test(link.href) && link.href.split('#')[0]!==location.href.split('#')[0];
    if(control || !webLink && !video)return;
    event.preventDefault();event.stopImmediatePropagation();
    if(video && event.button===0){if(video.paused)apply('play',video);else video.pause();}
  }
  for(const type of ['click','auxclick'])window.addEventListener(type,intercept,true);
  ready.then(authorized=>{
    if(!authorized){
      // Not a Reddit player after all: let a held video play as it would have.
      const wasHeld=eligible && heldOnce && !acted;eligible=false;
      if(wasHeld)media()?.play()?.catch(()=>{});
      return;
    }
    allowed=true;
    for(const type of ['play','pause','ended'])document.addEventListener(type,event=>{
      if(event.target.matches?.('video') && parentOrigin)up(type==='ended'?'pause':type);
    },true);
    document.addEventListener('loadeddata',event=>{
      if(event.target===media())up('rendered');
    },true);
    let lastProgress=-Infinity;
    document.addEventListener('timeupdate',event=>{
      const video=event.target,now=performance.now();
      if(!parentOrigin || video!==media() || video.paused || now-lastProgress<750)return;
      lastProgress=now;up('progress',{time:video.currentTime,muted:video.muted});
    },true);
    new MutationObserver(()=>{
      if(!announced && media())hello();
    }).observe(document,{childList:true,subtree:true});
    hello();
    // An already-loaded player can announce before Reddit's document-idle script starts.
    if(!parentOrigin)for(const delay of [300,1000,3000])setTimeout(()=>{if(!parentOrigin)hello();},delay);
  });
})();
