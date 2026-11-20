/* Look up a missing still without loading the video or sharing Reddit cookies. */
(() => {
  'use strict';
  const cache=new Map();
  function address(value){
    const origin=RTEmbedHosts.playerOrigin(value);
    if(!origin)return null;
    const url=new URL(value);
    if(origin==='https://www.redgifs.com' && /^\/ifr\/[a-z0-9]{1,80}\/?$/i.test(url.pathname))return {url:url.origin+url.pathname,host:origin+'/*',imageHost:/^(media|thumbs[2-4]?)\.redgifs\.com$/};
    if(origin==='https://streamable.com' && /^\/[eo]\/[a-z0-9]{1,20}\/?$/i.test(url.pathname))return {url:url.origin+url.pathname,host:origin+'/*',imageHost:/(^|\.)(streamable\.com|streamableusercontent\.com)$/};
    if(origin==='https://player.vimeo.com' && /^\/video\/\d{1,18}$/.test(url.pathname) && !url.searchParams.has('h')){
      const video='https://vimeo.com/'+url.pathname.split('/').at(-1);
      return {url:'https://vimeo.com/api/oembed.json?url='+encodeURIComponent(video),host:'https://vimeo.com/*',imageHost:/(^|\.)vimeocdn\.com$/,json:true};
    }
    return null;
  }
  function metaImages(html){
    const images=[];
    for(const tag of html.match(/<meta\b[^<>]*>/gi) || []){
      if(!/\s(?:property|name)\s*=\s*(['"])(?:og:image(?::(?:url|secure_url))?|twitter:image(?::src)?)\1/i.test(tag))continue;
      const image=/\scontent\s*=\s*(['"])(.*?)\1/i.exec(tag)?.[2];
      if(image)images.push(image.replaceAll('&amp;','&'));
    }
    return images;
  }
  async function read(item){
    try{
      if(!await chrome.permissions.contains({origins:[item.host]}))return '';
      const response=await fetch(item.url,{credentials:'omit',redirect:'error',signal:AbortSignal.timeout(4000)});
      if(!response.ok)return '';
      const images=item.json?[(await response.json())?.thumbnail_url]:metaImages(await response.text());
      for(const value of images){
        let image;try{image=new URL(value);}catch{continue;}
        if(image.protocol==='https:' && !image.username && !image.password && !image.port && item.imageHost.test(image.hostname))return image.href;
      }
      return '';
    }catch{return '';}
  }
  function poster(item){
    const saved=cache.get(item.url);
    if(saved && Date.now()<saved.until)return saved.result;
    const entry={until:Date.now()+60000,result:null};
    entry.result=read(item).then(url=>{entry.until=Date.now()+(url?1800000:60000);return url;});
    cache.set(item.url,entry);
    if(cache.size>96)cache.delete(cache.keys().next().value);
    return entry.result;
  }
  chrome.runtime.onMessage.addListener((message,sender,respond)=>{
    if(message?.scope!=='rt-embed-posters')return;
    let origin='';try{origin=new URL(sender.url).origin;}catch{}
    if(sender.id!==chrome.runtime.id || sender.frameId!==0 || !RTEmbedHosts.redditOrigins.includes(origin) || !Array.isArray(message.items)){respond({});return;}
    const items=message.items.slice(0,8).flatMap(entry=>{
      if(!Array.isArray(entry) || typeof entry[0]!=='string' || !/^t3_[a-z0-9]{1,10}$/.test(entry[0]) || typeof entry[1]!=='string' || entry[1].length>2048)return [];
      const item=address(entry[1]);return item?[[entry[0],item]]:[];
    });
    Promise.all(items.map(async ([id,item])=>[id,await poster(item)])).then(entries=>respond(Object.fromEntries(entries.filter(([,url])=>url))));
    return true;
  });
})();
