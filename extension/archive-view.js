/* Reddit-native presentation for archived content: built with the same
   structure and classes Reddit uses, so restored items look like ordinary
   posts. Only Reddit-hosted image URLs are accepted. */
(() => {
  'use strict';
  if(globalThis.RTArchiveView)return;
  const imageUrl=value=>globalThis.RTPostModel?.mediaUrl(value) || '';
  const videoMp4Url=value=>globalThis.RTPostModel?.videoUrl?.(value,'mp4') || '';
  const mediaMaxHeight='var(--rt-archive-media-max-height, max(300px, calc(100vh - (var(--shreddit-header-height, 56px) + 250px))))';
  // Keep downloadable archive media sources (especially MP4 fallbacks and gallery URLs) in memory
  // without putting silent MP4 URLs into shreddit-player markup.
  const mediaSourcesMap=new WeakMap();
  function registerSources(node,entries){
    if(!node || !entries?.length)return;
    const prev=mediaSourcesMap.get(node) || [],seen=new Set(prev.map(item=>item.url)),merged=[...prev];
    for(const item of entries){if(item?.url && !seen.has(item.url)){seen.add(item.url);merged.push(item);}}
    if(merged.length)mediaSourcesMap.set(node,merged);
  }
  function mediaSources(node){
    if(!node || typeof node!=='object')return [];
    const seen=new Set(),out=[];
    const collect=target=>{for(const item of mediaSourcesMap.get(target) || []){if(item?.url && !seen.has(item.url)){seen.add(item.url);out.push({...item});}}};
    collect(node);
    if(typeof node.querySelectorAll==='function'){
      for(const el of node.querySelectorAll('.rt-archive-media-group,shreddit-player,shreddit-player-2'))collect(el);
    }
    return out;
  }
  const SVG='http://www.w3.org/2000/svg';
  const ICON_PATHS={
    prev:'M12.5 16.4a.9.9 0 0 1-.64-.26l-5.5-5.5a.9.9 0 0 1 0-1.28l5.5-5.5a.9.9 0 1 1 1.28 1.28L8.27 10l4.87 4.86a.9.9 0 0 1-.64 1.54Z',
    next:'M7.5 16.4a.9.9 0 0 1-.64-1.54L11.73 10 6.86 5.14a.9.9 0 1 1 1.28-1.28l5.5 5.5a.9.9 0 0 1 0 1.28l-5.5 5.5a.9.9 0 0 1-.64.26Z',
    close:'m11.273 10 5.363-5.363a.9.9 0 10-1.273-1.273L10 8.727 4.637 3.364a.9.9 0 10-1.273 1.273L8.727 10l-5.363 5.363a.9.9 0 101.274 1.273L10 11.273l5.363 5.363a.897.897 0 001.274 0 .9.9 0 000-1.273L11.275 10h-.002Z'
  };
  function icon(name,doc=globalThis.document,size=16){
    const svg=doc.createElementNS(SVG,'svg');
    for(const [k,v] of Object.entries({fill:'currentColor',width:String(size),height:String(size),viewBox:'0 0 20 20','aria-hidden':'true'}))svg.setAttribute(k,v);
    const p=doc.createElementNS(SVG,'path');p.setAttribute('d',ICON_PATHS[name] || '');svg.append(p);return svg;
  }
  function openLightbox(url,{alt='',items=null,index=0,trigger=null,doc=globalThis.document}={}){
    const list=(Array.isArray(items) && items.length?items:[{url,alt}]).map(item=>({url:imageUrl(item?.url || item),alt:String(item?.alt ?? alt)})).filter(item=>item.url);
    if(!list.length)return null;
    doc.querySelector('[data-rt-ui="archive-lightbox"]')?.remove();
    let current=Math.max(0,Math.min(list.length-1,Number(index) || 0));
    const dialog=doc.createElement('div');dialog.className='rt-lightbox';dialog.dataset.rtUi='archive-lightbox';dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label','Image preview');
    const closeBtn=doc.createElement('button');closeBtn.type='button';closeBtn.className='rt-lightbox-close';closeBtn.setAttribute('aria-label','Close image preview');closeBtn.append(icon('close',doc,20));
    const stage=doc.createElement('div');stage.className='rt-lightbox-stage';
    const img=doc.createElement('img');img.className='rt-lightbox-img';img.referrerPolicy='no-referrer';img.decoding='async';
    stage.append(img);
    let prevBtn=null,nextBtn=null,counter=null;
    const sync=()=>{
      const item=list[current];img.src=item.url;img.alt=item.alt || alt;
      if(counter)counter.textContent=(current+1)+' / '+list.length;
      if(prevBtn){prevBtn.disabled=current<=0;prevBtn.hidden=current<=0;}
      if(nextBtn){nextBtn.disabled=current>=list.length-1;nextBtn.hidden=current>=list.length-1;}
    };
    const cleanup=()=>{doc.removeEventListener('keydown',onKey,true);dialog.remove();if(trigger?.isConnected)trigger.focus?.({preventScroll:true});};
    const onKey=event=>{
      if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();cleanup();return;}
      if(list.length>1 && event.key==='ArrowLeft' && current>0){event.preventDefault();current--;sync();}
      else if(list.length>1 && event.key==='ArrowRight' && current<list.length-1){event.preventDefault();current++;sync();}
    };
    closeBtn.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();cleanup();});
    dialog.addEventListener('click',event=>{if(event.target===dialog || event.target===stage){event.preventDefault();event.stopPropagation();cleanup();}});
    dialog.append(closeBtn,stage);
    if(list.length>1){
      counter=doc.createElement('span');counter.className='rt-lightbox-counter';counter.setAttribute('aria-live','polite');
      prevBtn=doc.createElement('button');prevBtn.type='button';prevBtn.className='rt-lightbox-nav rt-lightbox-prev';prevBtn.setAttribute('aria-label','Previous image');prevBtn.append(icon('prev',doc,20));
      nextBtn=doc.createElement('button');nextBtn.type='button';nextBtn.className='rt-lightbox-nav rt-lightbox-next';nextBtn.setAttribute('aria-label','Next image');nextBtn.append(icon('next',doc,20));
      prevBtn.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();if(current>0){current--;sync();}});
      nextBtn.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();if(current<list.length-1){current++;sync();}});
      dialog.append(counter,prevBtn,nextBtn);
    }
    sync();
    doc.body?.append(dialog);
    doc.addEventListener('keydown',onKey,true);
    closeBtn.focus?.({preventScroll:true});
    return dialog;
  }
  // Deleted i.redd.it images 404 or come back as Reddit's 130x60 "image was probably deleted"
  // placeholder. Replace either with an honest, fixed-size notice instead of stretching it.
  const isRemovedPlaceholder=img=>img.naturalWidth===130 && img.naturalHeight===60;
  function watchUnavailable(img,frame,doc,compact){
    const replace=()=>{const note=doc.createElement('div');note.className='rt-media-unavailable'+(compact?' rt-media-unavailable-compact':'');note.dataset.rtRecoveredText='true';note.setAttribute('role','img');note.setAttribute('aria-label','Image no longer available');note.textContent=compact?'No image':'Image no longer available';frame.replaceChildren(note);frame.classList.add('rt-media-unavailable-frame');};
    img.addEventListener('error',replace,{once:true});img.addEventListener('load',()=>{if(isRemovedPlaceholder(img))replace();},{once:true});
  }
  // Mirrors Reddit's image-post media (2026-10): rounded frame with a hairline
  // border, an aspect-ratio box (at least 220px, capped to the viewport), a
  // blurred dimmed copy behind, and the contained image on black.
  function image(url,{alt='',width=0,height=0,doc=globalThis.document}={}){
    url=imageUrl(url);if(!url)return null;
    const make=(tag,cls)=>{const el=doc.createElement(tag);if(cls)el.className=cls;return el;};
    const root=make('div','relative overflow-hidden pointer-cursor isolate bg-neutral-background xs:rounded-4 rt-archived-media');root.dataset.rtRecoveredText='true';
    root.append(make('div','pointer-events-none absolute inset-0 z-[3] border-sm border-solid border-neutral-border-weak xs:rounded-4 border-x-0 xs:border-x-sm'));
    const ratio=make('div','relative block w-full overflow-hidden');ratio.dataset.aspectRatioContainer='';
    // Dimensions come from archive metadata: only positive integers up to 20000 are used.
    // Unknown proportions reserve 16:9 so the frame does not jump from a square.
    const valid=value=>Number.isInteger(value) && value>0 && value<=20000,w=Number(width),h=Number(height);
    ratio.style.aspectRatio=valid(w) && valid(h)?w+' / '+h:'16 / 9';
    ratio.style.minHeight='min(220px, var(--rt-archive-media-max-height, 220px))';
    ratio.style.maxHeight=mediaMaxHeight;
    const fill=make('div','absolute inset-0 h-full w-full'),stage=make('div','media-lightbox-img max-h-[100vw] h-full w-full object-contain overflow-hidden relative bg-black');
    const backdrop=make('img','absolute top-1/2 -translate-y-1/2 start-0 w-full h-full opacity-30 object-cover scale-[1.2] post-background-image-filter rt-media-backdrop');backdrop.alt='';backdrop.setAttribute('role','presentation');
    const main=make('img','i18n-post-media-img preview-img media-lightbox-img max-h-[100vw] h-full w-full object-contain relative');main.alt=alt;
    for(const img of [backdrop,main]){img.src=url;img.loading='lazy';img.decoding='async';img.referrerPolicy='no-referrer';}
    // Use the image's own proportions once known, like Reddit's aspect box.
    main.addEventListener('load',()=>{if(isRemovedPlaceholder(main))return;if(valid(main.naturalWidth) && valid(main.naturalHeight))ratio.style.aspectRatio=main.naturalWidth+' / '+main.naturalHeight;},{once:true});
    main.addEventListener('click',event=>{
      if(event.defaultPrevented || event.button!==0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)return;
      if(main.closest?.('.rt-sensitive:not(.rt-revealed)'))return;
      event.preventDefault();event.stopPropagation();
      const gallery=main.closest?.('.rt-archive-gallery');
      if(gallery){
        const imgs=[...gallery.querySelectorAll('.preview-img')];
        const idx=Math.max(0,imgs.indexOf(main));
        openLightbox(url,{alt,items:imgs.map(el=>({url:el.src,alt:el.alt})),index:idx,trigger:main,doc});
      }else openLightbox(url,{alt,trigger:main,doc});
    });
    watchUnavailable(main,root,doc,false);
    stage.append(backdrop,main);fill.append(stage);ratio.append(fill);root.append(ratio);
    return root;
  }
  // A video the archive can't play: its preview in the image frame (no play button) with a clear label,
  // or a plain note when there's no preview either.
  function videoUnavailable(poster,{alt='',width=0,height=0,doc=globalThis.document}={}){
    const label='Original video isn’t available';
    const view=poster?image(poster,{alt,width,height,doc}):null;
    if(view){const badge=doc.createElement('span');badge.className='rt-media-badge';badge.textContent=label;view.append(badge);view.dataset.rtVideoUnavailable='true';return view;}
    const note=doc.createElement('div');note.className='rt-media-unavailable';note.dataset.rtRecoveredText='true';note.dataset.rtVideoUnavailable='true';note.setAttribute('role','img');note.setAttribute('aria-label',label);note.textContent=label+' in the archive';return note;
  }
  // An archive can provide full gallery images, a link preview, or only a
  // small thumbnail. Link previews use the compact thumbnail treatment.
  function media(items,{alt='',compact=false,postId='',href='',thread=false,doc=globalThis.document}={}){
    if(!Array.isArray(items))return null;
    const valid=items.slice(0,20).filter(item=>item?.kind==='video'?imageUrl(item.poster) || globalThis.RTPostModel?.videoUrl(item.hls,'m3u8'):['image','preview','thumbnail'].includes(item?.kind) && imageUrl(item.url));
    if(!valid.length)return null;
    const thumbnail=url=>{
      if(!imageUrl(url))return null;
      const box=doc.createElement('div');box.className='rt-archive-media-group relative rounded-2 overflow-hidden box-border border-sm border-solid border-neutral-border-weak xs:h-[100px] xs:w-[130px] h-[88px] w-[114px] block';box.dataset.rtRecoveredText='true';box.dataset.testid='post-thumbnail';
      const img=doc.createElement('img');img.className='rt-archive-link-thumbnail h-full w-full object-cover';img.src=imageUrl(url);img.alt=alt;img.loading='lazy';img.decoding='async';img.referrerPolicy='no-referrer';
      let destination='';try{const parsed=new URL(href);if(['http:','https:'].includes(parsed.protocol) && !parsed.username && !parsed.password)destination=parsed.href;}catch{}
      if(destination){const a=doc.createElement('a');a.className='block w-full h-full';a.href=destination;a.target='_blank';a.rel='noopener noreferrer nofollow ugc';a.append(img);box.append(a);}else box.append(img);
      watchUnavailable(img,box,doc,true);return box;
    };
    const collectedSources=[];
    for(const item of valid){
      if(item.kind==='video'){
        const mp4=videoMp4Url(item.fallback);
        if(mp4){const w=Number(item.width),h=Number(item.height);collectedSources.push({kind:'video',url:mp4,...(Number.isInteger(w)&&w>0&&Number.isInteger(h)&&h>0?{width:w,height:h}:{})});}
      }else if(item.kind==='image'){
        const u=imageUrl(item.url);
        if(u){const w=Number(item.width),h=Number(item.height);collectedSources.push({kind:'image',url:u,...(Number.isInteger(w)&&w>0&&Number.isInteger(h)&&h>0?{width:w,height:h}:{})});}
      }
    }
    // Native profile link layouts display one preview in the right-hand cell.
    // Keep full gallery/video media for the opened post rather than stacking it
    // into that small preview area.
    if(compact){
      const box=thumbnail(valid[0].kind==='video'?valid[0].poster:valid[0].url);
      if(box && collectedSources.length)registerSources(box,collectedSources);
      return box;
    }
    const root=doc.createElement('div');root.className='rt-archive-media-group';root.dataset.rtRecoveredText='true';
    const galleryImages=valid.length>1 && valid.every(item=>item.kind==='image');
    if(galleryImages){
      root.classList.add('rt-archive-gallery');
      root.dataset.rtGalleryCount=String(valid.length);
      root.dataset.rtGalleryIndex='0';
      const viewport=doc.createElement('div');viewport.className='rt-gallery-viewport';
      const track=doc.createElement('ul');track.className='rt-gallery-track';track.setAttribute('role','region');track.setAttribute('aria-label','Image gallery');
      const slides=[];
      for(const [index,item] of valid.entries()){
        const view=image(item.url,{alt:alt+' ('+(index+1)+'/'+valid.length+')',width:item.width,height:item.height,doc});
        if(!view)continue;
        const slide=doc.createElement('li');slide.className='rt-gallery-slide';slide.dataset.rtSlideIndex=String(slides.length);
        slide.append(view);track.append(slide);slides.push(slide);
      }
      if(!slides.length)return null;
      viewport.append(track);
      const counter=doc.createElement('span');counter.className='rt-gallery-counter';counter.dataset.rtGalleryCounter='';counter.setAttribute('aria-live','polite');
      const prev=doc.createElement('button');prev.type='button';prev.className='rt-gallery-nav rt-gallery-prev';prev.dataset.rtGalleryNav='prev';prev.setAttribute('aria-label','Previous image');prev.append(icon('prev',doc,18));
      const next=doc.createElement('button');next.type='button';next.className='rt-gallery-nav rt-gallery-next';next.dataset.rtGalleryNav='next';next.setAttribute('aria-label','Next image');next.append(icon('next',doc,18));
      const dots=doc.createElement('div');dots.className='rt-gallery-dots';dots.setAttribute('role','group');dots.setAttribute('aria-label','Gallery slides');
      const dotButtons=[];
      let current=0;
      const setSlide=idx=>{
        current=Math.max(0,Math.min(slides.length-1,idx));
        root.dataset.rtGalleryIndex=String(current);
        counter.textContent=(current+1)+' / '+slides.length;
        prev.disabled=current<=0;prev.hidden=current<=0;
        next.disabled=current>=slides.length-1;next.hidden=current>=slides.length-1;
        slides.forEach((slide,i)=>{
          const active=i===current;
          slide.hidden=!active;
          slide.toggleAttribute('data-rt-slide-active',active);
          slide.setAttribute('aria-hidden',String(!active));
        });
        dotButtons.forEach((dot,i)=>{
          const active=i===current;
          dot.setAttribute('aria-pressed',String(active));
          dot.classList.toggle('rt-gallery-dot-active',active);
        });
      };
      for(let i=0;i<slides.length;i++){
        const dot=doc.createElement('button');dot.type='button';dot.className='rt-gallery-dot';dot.dataset.rtGalleryDot=String(i);dot.setAttribute('aria-label','Image '+(i+1)+' of '+slides.length);
        dot.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();setSlide(i);});
        dots.append(dot);dotButtons.push(dot);
      }
      prev.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();setSlide(current-1);});
      next.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();setSlide(current+1);});
      root.addEventListener('keydown',event=>{
        if(event.key==='ArrowLeft' && current>0){event.preventDefault();event.stopPropagation();setSlide(current-1);}
        else if(event.key==='ArrowRight' && current<slides.length-1){event.preventDefault();event.stopPropagation();setSlide(current+1);}
      });
      viewport.append(counter,prev,next,dots);
      root.append(viewport);
      setSlide(0);
      if(collectedSources.length)registerSources(root,collectedSources);
      return root;
    }
    for(const [index,item] of valid.entries()){
      if(item.kind==='video'){
        const poster=imageUrl(item.poster),hls=globalThis.RTPostModel?.videoUrl(item.hls,'m3u8') || '';
        const width=Number(item.width),height=Number(item.height);
        const mp4=videoMp4Url(item.fallback);
        const videoEntry=mp4?[{kind:'video',url:mp4,...(Number.isInteger(width)&&width>0&&Number.isInteger(height)&&height>0?{width,height}:{})}]:[];
        if(!hls){const unavail=videoUnavailable(poster,{alt,width,height,doc});if(videoEntry.length)registerSources(unavail,videoEntry);root.append(unavail);continue;}
        // The poster is absolutely positioned until the player hydrates: keep it inside this box (relative),
        // never over the post's header, and cap the height like Reddit's media frames.
        const loader=doc.createElement('shreddit-async-loader');loader.setAttribute('bundlename','shreddit_player_loader');
        const sized=Number.isInteger(width) && width>0 && width<=20000 && Number.isInteger(height) && height>0 && height<=20000;
        loader.style.cssText='display: block; position: relative; overflow: hidden; width: 100%; aspect-ratio: '+(sized?width+' / '+height:'16 / 9')+';';
        loader.style.maxHeight=mediaMaxHeight;
        // Archived video files are often gone: check the playlist and swap in the unavailable view if so.
        const fetcher=doc.defaultView?.fetch || globalThis.fetch;
        if(typeof fetcher==='function')Promise.resolve().then(()=>fetcher.call(doc.defaultView || globalThis,hls,{cache:'force-cache',credentials:'omit'})).then(response=>{if(!response?.ok && loader.isConnected)loader.replaceWith(videoUnavailable(poster,{alt,width,height,doc}));},()=>{if(loader.isConnected)loader.replaceWith(videoUnavailable(poster,{alt,width,height,doc}));});
        const player=doc.createElement('shreddit-player');player.setAttribute('src',hls);player.className='block h-full w-full max-h-full max-w-full nd:visible';player.setAttribute('data-post-click-location','video-player');player.setAttribute('single-playback','');player.setAttribute('player-type',thread?'post_detail_screen':'in_feed_player');player.setAttribute('post-domain','v.redd.it');player.setAttribute('post-type','video');player.setAttribute('post-title',alt);player.setAttribute('priority','auto');
        if(globalThis.RTPostModel?.validateId(postId))player.setAttribute('post-id','t3_'+postId.replace(/^t3_/i,'').toLowerCase());
        if(poster){player.setAttribute('poster',poster);const img=doc.createElement('img');img.slot='poster';img.className='preview-image h-full w-full ease absolute inset-0 object-contain bg-black';img.setAttribute('objectfit','contain');img.src=poster;img.alt='media poster';img.loading='lazy';img.referrerPolicy='no-referrer';player.append(img);}
        const source=doc.createElement('source');source.src=hls;source.type='application/vnd.apple.mpegURL';player.prepend(source);
        if(videoEntry.length)registerSources(player,videoEntry);
        loader.append(player);root.append(loader);
      }else if(item.kind==='image'){
        const view=image(item.url,{alt:valid.length>1?alt+' ('+(index+1)+'/'+valid.length+')':alt,width:item.width,height:item.height,doc});if(view)root.append(view);
      }else{
        const preview=thumbnail(item.url);if(preview)root.append(preview);
      }
    }
    if(collectedSources.length)registerSources(root,collectedSources);
    return root.childNodes.length?root:null;
  }
  // Same skeleton design as the chat search results: Reddit's faceplate-shimmer
  // in pill shape (title 55%, preview 86%, 9px apart), with a sweeping
  // highlight fallback when the element isn't available or motion is reduced.
  function skeleton({lines=3,doc=globalThis.document}={}){
    const view=doc.defaultView || globalThis,native=Boolean(view.customElements?.get('faceplate-shimmer')) && !view.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const box=doc.createElement('div');box.className='rt-skeleton';box.dataset.rtSkeleton='true';box.setAttribute('aria-hidden','true');
    const widths=lines<=2?[86,55]:[86,72,55];
    for(let i=0;i<lines;i++){const line=doc.createElement(native?'faceplate-shimmer':'span');line.className='rt-skeleton-line skeleton-shimmer'+(native?'':' rt-skeleton-fallback');if(native)line.setAttribute('shape','pill');line.style.width=widths[i % widths.length]+'%';box.append(line);}
    return box;
  }
  globalThis.RTArchiveView=Object.freeze({image,imageUrl,media,mediaSources,openLightbox,skeleton,videoUnavailable});
})();
