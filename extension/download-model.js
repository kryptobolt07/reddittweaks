(() => {
  'use strict';
  const MAX_FILES=20;
  const IMAGE_EXT=/\.(?:jpe?g|png|gif|webp)$/i;
  const VIDEO_EXT=/\.mp4$/i;
  const IMAGE_HOSTS=new Set(['i.redd.it','preview.redd.it']);
  const VIDEO_HOSTS=new Set(['packaged-media.redd.it','v.redd.it']);
  const REDDIT_HOSTS=new Set(['reddit.com','www.reddit.com','old.reddit.com','new.reddit.com','sh.reddit.com','m.reddit.com']);
  function urlOf(value) {
    if(typeof value!=='string' || value.length>4096)return null;
    try{return new URL(value.replace(/&amp;/gi,'&'));}catch{return null;}
  }
  function safeDownloadUrl(value) {
    const url=urlOf(value);
    if(!url || url.protocol!=='https:' || url.username || url.password || url.port)return '';
    const host=url.hostname.toLowerCase();
    if(IMAGE_HOSTS.has(host) && IMAGE_EXT.test(url.pathname))return url.href;
    if(VIDEO_HOSTS.has(host) && VIDEO_EXT.test(url.pathname))return url.href;
    return '';
  }
  function kindOf(value) {
    const url=urlOf(value);
    return url && VIDEO_HOSTS.has(url.hostname.toLowerCase()) && VIDEO_EXT.test(url.pathname)?'video':'image';
  }
  function extensionOf(value) {
    const url=urlOf(value);
    const match=url?.pathname.match(/\.([a-z0-9]{1,5})$/i);
    return match?match[1].toLowerCase():'';
  }
  function isRedditPage(value) {
    const url=urlOf(value);
    return Boolean(url && url.protocol==='https:' && !url.username && !url.password && !url.port && REDDIT_HOSTS.has(url.hostname.toLowerCase()));
  }
  function safeFilename(value,fallback='reddit-media') {
    let name=String(value ?? '');
    try{name=name.normalize('NFKC');}catch{}
    name=name.replace(/[\u0000-\u001f\u007f]/g,'').replace(/[\\/:*?"<>|]/g,'-').replace(/\s+/g,' ').trim().replace(/^\.+/,'').replace(/[. ]+$/,'');
    if(!name)name=fallback;
    return name.slice(0,160).replace(/[. ]+$/,'') || fallback;
  }
  function baseName(title,id) {
    const raw=safeFilename(String(title || '').trim() || 'reddit-'+String(id || 'media').replace(/^t3_/i,''),'reddit-media').replace(/\.[a-z0-9]{1,5}$/i,'');
    return raw.slice(0,80).replace(/[. ]+$/,'') || 'reddit-media';
  }
  function dimension(value) {
    const number=Number(value);
    return Number.isInteger(number) && number>0 && number<=20000?number:0;
  }
  function dimensionsOf(node) {
    const width=dimension(node?.getAttribute?.('width') || node?.width),height=dimension(node?.getAttribute?.('height') || node?.height);
    return width && height?{width,height}:{};
  }
  function safeSources(image) {
    const urls=[];
    for(const source of [image?.currentSrc,image?.getAttribute?.('src'),image?.getAttribute?.('data-lazy-src'),image?.getAttribute?.('data-src')]){
      const url=safeDownloadUrl(source);
      if(url && !urls.includes(url))urls.push(url);
    }
    return urls;
  }
  function scoreImage(image,url) {
    let score=0;
    try{if(new URL(url).hostname==='i.redd.it')score+=20;}catch{}
    if(image.closest?.('zoomable-img'))score+=8;
    if(image.classList?.contains('media-lightbox-img'))score+=6;
    if(image.classList?.contains('z-1'))score+=4;
    const dims=dimensionsOf(image);
    if(dims.width && dims.height)score+=Math.min(4,Math.round(dims.width*dims.height/1000000));
    return score;
  }
  function bestSource(image) {
    let best='',bestScore=-1;
    for(const url of safeSources(image)){
      if(kindOf(url)!=='image')continue;
      const score=scoreImage(image,url);
      if(score>bestScore){best=url;bestScore=score;}
    }
    return best;
  }
  function bestImage(root) {
    let best=null,bestScore=-1;
    for(const image of root?.querySelectorAll?.('img') || []){
      const url=bestSource(image);
      if(!url)continue;
      const score=scoreImage(image,url);
      if(score>bestScore){best={url,...dimensionsOf(image)};bestScore=score;}
    }
    return best;
  }
  function imageItems(post) {
    const href=safeDownloadUrl(post?.getAttribute?.('content-href'));
    let image=null;
    if(href){
      const path=urlOf(href)?.pathname;
      image=[...post.querySelectorAll('img')].find(candidate=>safeSources(candidate).some(source=>{
        const url=urlOf(source);
        return url && url.pathname===path && kindOf(source)==='image';
      })) || null;
    }
    if(!href){
      const container=post?.querySelector?.('[slot="post-media-container"]') || post;
      image=[...container?.querySelectorAll?.('img') || []].filter(candidate=>bestSource(candidate)).sort((a,b)=>scoreImage(b,bestSource(b))-scoreImage(a,bestSource(a)))[0] || null;
    }
    const url=href || bestSource(image);
    if(!url || kindOf(url)!=='image')return [];
    return [{kind:'image',url,...dimensionsOf(image)}];
  }
  function galleryItems(post) {
    const carousel=post?.querySelector?.('gallery-carousel');
    if(!carousel)return [];
    const pages=[...carousel.querySelectorAll('li[slot^="page-"]')].map((page,index)=>({page,index:Number(page.getAttribute('slot').split('-')[1]) || index}));
    pages.sort((a,b)=>a.index-b.index);
    const roots=pages.length?pages.map(entry=>entry.page):[carousel];
    const seen=new Set(),items=[];
    for(const root of roots){
      const image=bestImage(root);
      if(!image || seen.has(image.url))continue;
      seen.add(image.url);items.push({kind:'image',...image});
      if(items.length>=MAX_FILES)break;
    }
    if(!items.length){const image=bestImage(carousel);if(image)items.push({kind:'image',...image});}
    return items;
  }
  function bitrateText(value) {
    const bitrate=Number(value);
    if(!Number.isFinite(bitrate) || bitrate<=0)return '';
    return bitrate>=1000000?(Math.round(bitrate/100000)/10).toFixed(1)+' Mbps':Math.round(bitrate/1000)+' kbps';
  }
  function videoItems(post) {
    const player=post?.querySelector?.('shreddit-player,shreddit-player-2');
    const raw=player?.getAttribute?.('packaged-media-json');
    const seen=new Set(),items=[];
    if(raw){
      let parsed;
      try{parsed=JSON.parse(raw);}catch{}
      const permutations=parsed?.playbackMp4s?.permutations;
      if(Array.isArray(permutations))for(const permutation of permutations.slice(0,40)){
        const source=permutation?.source || permutation;
        const url=safeDownloadUrl(source?.url || permutation?.url);
        if(!url || kindOf(url)!=='video' || seen.has(url))continue;
        const dimensions=source?.dimensions || permutation?.dimensions || {};
        const width=dimension(dimensions.width),height=dimension(dimensions.height);
        const bitrate=Number(source?.bitrateBps ?? permutation?.bitrateBps);
        seen.add(url);items.push({kind:'video',url,...(width&&height?{width,height}:{}),...(Number.isFinite(bitrate)&&bitrate>0?{bitrate}:{})});
      }
    }
    if(!items.length){
      const preview=player?.shadowRoot?.querySelector?.('shreddit-media-ui')?.getAttribute?.('preview');
      const url=safeDownloadUrl(preview);
      if(url && kindOf(url)==='video')items.push({kind:'video',url});
    }
    items.sort((a,b)=>(b.height || 0)-(a.height || 0) || (b.bitrate || 0)-(a.bitrate || 0));
    const heights=new Set();
    return items.filter(item=>{if(!item.height)return true;if(heights.has(item.height))return false;heights.add(item.height);return true;}).slice(0,MAX_FILES);
  }
  function mediaFor(post) {
    const type=String(post?.getAttribute?.('post-type') || '').toLowerCase();
    if(type==='video')return {type,items:videoItems(post)};
    if(type==='gif'){const items=videoItems(post);return {type,items:items.length?items:imageItems(post)};}
    if(type==='gallery')return {type,items:galleryItems(post)};
    if(type==='image')return {type,items:imageItems(post)};
    return null;
  }
  function labelFor(item,index,total) {
    if(item.kind==='video')return item.height?item.height+'p':'Video';
    return total>1?'Image '+(index+1):'Original image';
  }
  function captionFor(item) {
    if(item.kind==='video'){
      const dimensions=item.width && item.height?item.width+' × '+item.height:'MP4';
      return [dimensions,bitrateText(item.bitrate)].filter(Boolean).join(' · ');
    }
    const extension=extensionOf(item.url).replace(/^jpeg$/,'jpg').toUpperCase() || 'IMAGE';
    return [extension,item.width && item.height?item.width+' × '+item.height:''].filter(Boolean).join(' · ');
  }
  function filenameFor(post,item,index,total) {
    const base=baseName(post?.getAttribute?.('post-title'),post?.getAttribute?.('id') || post?.getAttribute?.('post-id'));
    const suffix=item.kind==='video'?(item.height?item.height+'p':'video'):total>1?String(index+1):'image';
    const extension=extensionOf(item.url) || (item.kind==='video'?'mp4':'jpg');
    return safeFilename(base+'-'+suffix+'.'+extension,'reddit-media-'+suffix+'.'+extension);
  }
  function filesFor(post,items) {
    const list=Array.isArray(items)?items.slice(0,MAX_FILES):[];
    return {files:list.map((item,index)=>({url:safeDownloadUrl(item.url),filename:filenameFor(post,item,index,list.length)})).filter(file=>file.url)};
  }
  globalThis.RTDownloadModel=Object.freeze({MAX_FILES,safeDownloadUrl,isRedditPage,safeFilename,mediaFor,labelFor,captionFor,filenameFor,filesFor,extensionOf});
})();
