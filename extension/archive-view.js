/* Reddit-native presentation for archived content: built with the same
   structure and classes Reddit uses, so restored items look like ordinary
   posts. Only Reddit-hosted image URLs are accepted. */
(() => {
  'use strict';
  if(globalThis.RTArchiveView)return;
  const imageHosts=new Set(['i.redd.it','preview.redd.it']);
  function imageUrl(value){
    try{const url=new URL(value);return url.protocol==='https:' && imageHosts.has(url.hostname) && /\.(?:jpe?g|png|gif|webp)$/i.test(url.pathname)?url.href:'';}catch{return '';}
  }
  // Mirrors Reddit's image-post media (2026-10): rounded frame with a hairline
  // border, an aspect-ratio box (at least 220px, capped to the viewport), a
  // blurred dimmed copy behind, and the contained image on black.
  function image(url,{alt='',doc=globalThis.document}={}){
    const make=(tag,cls)=>{const el=doc.createElement(tag);if(cls)el.className=cls;return el;};
    const root=make('div','relative overflow-hidden pointer-cursor isolate bg-neutral-background xs:rounded-4 rt-archived-media');root.dataset.rtRecoveredText='true';
    root.append(make('div','pointer-events-none absolute inset-0 z-[3] border-sm border-solid border-neutral-border-weak xs:rounded-4 border-x-0 xs:border-x-sm'));
    const ratio=make('div','relative block w-full overflow-hidden');ratio.dataset.aspectRatioContainer='';
    ratio.style.cssText='aspect-ratio: 1; min-height: 220px; max-height: max(300px, calc(100vh - calc(var(--shreddit-header-height, 56px) + 250px)));';
    const fill=make('div','absolute inset-0 h-full w-full'),stage=make('div','media-lightbox-img max-h-[100vw] h-full w-full object-contain overflow-hidden relative bg-black');
    const backdrop=make('img','absolute top-1/2 -translate-y-1/2 start-0 w-full h-full opacity-30 object-cover scale-[1.2] post-background-image-filter rt-media-backdrop');backdrop.alt='';backdrop.setAttribute('role','presentation');
    const main=make('img','i18n-post-media-img preview-img media-lightbox-img max-h-[100vw] h-full w-full object-contain relative');main.alt=alt;
    for(const img of [backdrop,main]){img.src=url;img.loading='lazy';img.decoding='async';img.referrerPolicy='no-referrer';}
    // Use the image's own proportions once known, like Reddit's aspect box.
    main.addEventListener('load',()=>{if(main.naturalWidth && main.naturalHeight)ratio.style.aspectRatio=main.naturalWidth+' / '+main.naturalHeight;},{once:true});
    stage.append(backdrop,main);fill.append(stage);ratio.append(fill);root.append(ratio);
    return root;
  }
  // Reddit-style skeleton lines (its own faceplate-shimmer element).
  function skeleton({lines=3,doc=globalThis.document}={}){
    const box=doc.createElement('div');box.className='rt-skeleton';box.dataset.rtSkeleton='true';box.setAttribute('aria-hidden','true');
    for(let i=0;i<lines;i++){const line=doc.createElement('faceplate-shimmer');line.className='rt-skeleton-line';line.setAttribute('shape','rectangle');line.style.width=[100,94,62,80][i % 4]+'%';box.append(line);}
    return box;
  }
  globalThis.RTArchiveView=Object.freeze({image,imageUrl,skeleton});
})();
