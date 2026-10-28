/* Reddit-native presentation for archived content: built with the same
   structure and classes Reddit uses, so restored items look like ordinary
   posts. Only Reddit-hosted image URLs are accepted. */
(() => {
  'use strict';
  if(globalThis.RTArchiveView)return;
  const imageUrl=value=>globalThis.RTPostModel?.mediaUrl(value) || '';
  // Mirrors Reddit's image-post media (2026-10): rounded frame with a hairline
  // border, an aspect-ratio box (at least 220px, capped to the viewport), a
  // blurred dimmed copy behind, and the contained image on black.
  function image(url,{alt='',width=0,height=0,doc=globalThis.document}={}){
    url=imageUrl(url);if(!url)return null;
    const make=(tag,cls)=>{const el=doc.createElement(tag);if(cls)el.className=cls;return el;};
    const root=make('div','relative overflow-hidden pointer-cursor isolate bg-neutral-background xs:rounded-4 rt-archived-media');root.dataset.rtRecoveredText='true';
    root.append(make('div','pointer-events-none absolute inset-0 z-[3] border-sm border-solid border-neutral-border-weak xs:rounded-4 border-x-0 xs:border-x-sm'));
    const ratio=make('div','relative block w-full overflow-hidden');ratio.dataset.aspectRatioContainer='';
    ratio.style.cssText='aspect-ratio: '+(width && height?width+' / '+height:'1')+'; min-height: 220px; max-height: max(300px, calc(100vh - calc(var(--shreddit-header-height, 56px) + 250px)));';
    const fill=make('div','absolute inset-0 h-full w-full'),stage=make('div','media-lightbox-img max-h-[100vw] h-full w-full object-contain overflow-hidden relative bg-black');
    const backdrop=make('img','absolute top-1/2 -translate-y-1/2 start-0 w-full h-full opacity-30 object-cover scale-[1.2] post-background-image-filter rt-media-backdrop');backdrop.alt='';backdrop.setAttribute('role','presentation');
    const main=make('img','i18n-post-media-img preview-img media-lightbox-img max-h-[100vw] h-full w-full object-contain relative');main.alt=alt;
    for(const img of [backdrop,main]){img.src=url;img.loading='lazy';img.decoding='async';img.referrerPolicy='no-referrer';}
    // Use the image's own proportions once known, like Reddit's aspect box.
    main.addEventListener('load',()=>{if(main.naturalWidth && main.naturalHeight)ratio.style.aspectRatio=main.naturalWidth+' / '+main.naturalHeight;},{once:true});
    stage.append(backdrop,main);fill.append(stage);ratio.append(fill);root.append(ratio);
    return root;
  }
  // An archive can provide full gallery images, a link preview, or only a
  // small thumbnail. Link previews use the compact thumbnail treatment.
  function media(items,{alt='',compact=false,postId='',href='',doc=globalThis.document}={}){
    if(!Array.isArray(items))return null;
    const valid=items.slice(0,20).filter(item=>item?.kind==='video'?imageUrl(item.poster) || globalThis.RTPostModel?.videoUrl(item.hls,'m3u8'):['image','preview','thumbnail'].includes(item?.kind) && imageUrl(item.url));
    if(!valid.length)return null;
    const thumbnail=url=>{
      if(!imageUrl(url))return null;
      const box=doc.createElement('div');box.className='rt-archive-media-group relative rounded-2 overflow-hidden box-border border-sm border-solid border-neutral-border-weak xs:h-[100px] xs:w-[130px] h-[88px] w-[114px] block';box.dataset.rtRecoveredText='true';box.dataset.testid='post-thumbnail';
      const img=doc.createElement('img');img.className='rt-archive-link-thumbnail h-full w-full object-cover';img.src=imageUrl(url);img.alt=alt;img.loading='lazy';img.decoding='async';img.referrerPolicy='no-referrer';
      let destination='';try{const parsed=new URL(href);if(['http:','https:'].includes(parsed.protocol) && !parsed.username && !parsed.password)destination=parsed.href;}catch{}
      if(destination){const a=doc.createElement('a');a.className='block w-full h-full';a.href=destination;a.target='_blank';a.rel='noopener noreferrer nofollow ugc';a.append(img);box.append(a);}else box.append(img);
      return box;
    };
    // Native profile link layouts display one preview in the right-hand cell.
    // Keep full gallery/video media for the opened post rather than stacking it
    // into that small preview area.
    if(compact)return thumbnail(valid[0].kind==='video'?valid[0].poster:valid[0].url);
    const root=doc.createElement('div');root.className='rt-archive-media-group';root.dataset.rtRecoveredText='true';
    for(const [index,item] of valid.entries()){
      if(item.kind==='video'){
        const poster=imageUrl(item.poster),hls=globalThis.RTPostModel?.videoUrl(item.hls,'m3u8') || '';
        if(!hls){const preview=thumbnail(poster);if(preview)root.append(preview);continue;}
        const loader=doc.createElement('shreddit-async-loader');loader.setAttribute('bundlename','shreddit_player_loader');
        const width=Number(item.width),height=Number(item.height);if(Number.isInteger(width) && width>0 && width<=20000 && Number.isInteger(height) && height>0 && height<=20000)loader.style.cssText='display: block; width: 100%; aspect-ratio: '+width+' / '+height+'; max-height: max(300px, calc(100vh - calc(var(--shreddit-header-height, 56px) + 250px)));';
        const player=doc.createElement('shreddit-player');player.setAttribute('src',hls);player.className='block h-full w-full max-h-full max-w-full nd:visible';player.setAttribute('data-post-click-location','video-player');player.setAttribute('single-playback','');player.setAttribute('player-type','in_feed_player');player.setAttribute('post-domain','v.redd.it');player.setAttribute('post-type','video');player.setAttribute('post-title',alt);player.setAttribute('priority','auto');
        if(globalThis.RTPostModel?.validateId(postId))player.setAttribute('post-id','t3_'+postId.replace(/^t3_/i,'').toLowerCase());
        if(poster){player.setAttribute('poster',poster);const img=doc.createElement('img');img.slot='poster';img.className='preview-image h-full w-full ease absolute inset-0 object-contain bg-black';img.setAttribute('objectfit','contain');img.src=poster;img.alt='media poster';img.loading='lazy';img.referrerPolicy='no-referrer';player.append(img);}
        const source=doc.createElement('source');source.src=hls;source.type='application/vnd.apple.mpegURL';player.prepend(source);loader.append(player);root.append(loader);
      }else if(item.kind==='image'){
        const view=image(item.url,{alt:valid.length>1?alt+' ('+(index+1)+'/'+valid.length+')':alt,width:item.width,height:item.height,doc});if(view)root.append(view);
      }else{
        const preview=thumbnail(item.url);if(preview)root.append(preview);
      }
    }
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
  globalThis.RTArchiveView=Object.freeze({image,imageUrl,media,skeleton});
})();
