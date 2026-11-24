/* Community icons for the Sort & filter menus (isolated world).
   Order of sources: icons already on the page (cards, credit bars, sidebar links, post-discovery's hints),
   then Reddit's own community hover card. Loads are rate limited and cached; nothing here blocks a menu. */
(() => {
  'use strict';
  if(globalThis.RTCommunityIcons)return;
  const hoverCard='/svc/shreddit/community-hover-card/';
  const accept='text/vnd.reddit.partial+html, text/html;q=0.9';
  const owned=/(^|\.)(redditmedia\.com|redd\.it|redditstatic\.com)$/i;
  // Only https images on Reddit-owned hosts, never a community banner.
  function safeUrl(value){
    if(typeof value!=='string' || !value || value.length>2048)return '';
    try{
      const url=new URL(value.replace(/&amp;/gi,'&'),'https://www.reddit.com');
      if(url.protocol!=='https:' || url.username || url.password || url.port || !owned.test(url.hostname) || /bannerBackgroundImage/i.test(url.href))return '';
      return url.href;
    }catch{return '';}
  }
  // r/name, /r/name and name all mean name; u_name is a user profile. Anything else is rejected.
  function normalize(value){const name=String(value||'').trim().replace(/^\/?r\//i,'');return /^[\w-]{1,40}$/.test(name)?name:'';}
  // Reddit paints old-style (thumbs) icons and the community-fill glyph over the community's own colour.
  function safeColor(value){const m=/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(value||'').trim());return m?'#'+m[1].toUpperCase():'';}
  function colorOf(node){
    const style=node?.getAttribute?.('style') || '';
    return safeColor(/(?:^|;)\s*background(?:-color)?\s*:\s*(#[0-9a-f]{3,6})\b/i.exec(style)?.[1]) || safeColor(/(?:^|;)\s*color\s*:\s*(#[0-9a-f]{3,6})\b/i.exec(style)?.[1]);
  }
  // The icon in a hover card's HTML, and its colour. Reddit marks the real icon as img.shreddit-subreddit-icon__icon; a
  // community without one shows the community-fill glyph instead (null, never a flair emoji or other image).
  function readCard(html,Parser=globalThis.DOMParser){
    if(!html || !String(html).trim() || !Parser)return {url:null,color:''};
    let doc;try{doc=new Parser().parseFromString(String(html),'text/html');}catch{return {url:null,color:''};}
    const marked=doc.querySelector('img.shreddit-subreddit-icon__icon');
    if(marked)return {url:safeUrl(marked.getAttribute('src') || '') || null,color:colorOf(marked)};
    const glyph=doc.querySelector('[avatar] svg[icon-name="community-fill"]');
    if(glyph)return {url:null,color:colorOf(glyph)};
    const candidates=[...doc.querySelectorAll('img,faceplate-img')].map(img=>safeUrl(img.getAttribute('src') || (img.getAttribute('srcset') || '').split(/\s+/)[0])).filter(Boolean);
    return {url:candidates.find(url=>/communityIcon/i.test(url) && new URL(url).hostname==='styles.redditmedia.com') || candidates.find(url=>/communityIcon/i.test(url)) || candidates[0] || null,color:''};
  }
  function parseCard(html,Parser=globalThis.DOMParser){return readCard(html,Parser).url;}
  function create({fetch:fetcher=(...args)=>globalThis.fetch(...args),doc=()=>globalThis.document,Parser=()=>globalThis.DOMParser,hint=name=>globalThis.RTPostDiscovery?.avatarHint?.(name),
    setTimer=(fn,ms)=>setTimeout(fn,ms),now=()=>Date.now(),gap=60,concurrency=4,pause=60000,max=300,storage=()=>globalThis.sessionStorage}={}){
    const cache=new Map(),pending=new Map(),queue=[];let active=0,nextStart=0,pausedUntil=0,timer=null,saveTimer=null;
    // Public icon URLs survive reloads for this browser session, so a menu reopened later shows them at once.
    const KEY='rt-community-icons-v1',store=()=>{try{return typeof storage==='function'?storage():storage;}catch{return null;}};
    try{const saved=JSON.parse(store()?.getItem(KEY) || '[]');if(Array.isArray(saved))for(const [key,url] of saved.slice(-max))if(typeof key==='string' && normalize(key) && (url===null || safeUrl(url)===url))cache.set(key.toLowerCase(),url);}catch{}
    const COLORS='rt-community-icon-colors-v1',colors=new Map();
    try{const saved=JSON.parse(store()?.getItem(COLORS) || '[]');if(Array.isArray(saved))for(const [key,color] of saved.slice(-max))if(typeof key==='string' && normalize(key) && safeColor(color))colors.set(key.toLowerCase(),safeColor(color));}catch{}
    const save=()=>{if(saveTimer!==null)return;saveTimer=setTimer(()=>{saveTimer=null;try{store()?.setItem(KEY,JSON.stringify([...cache].slice(-max)));store()?.setItem(COLORS,JSON.stringify([...colors].slice(-max)));}catch{}},500);};
    const tint=(key,color)=>{const safe=safeColor(color);if(!safe || colors.get(key)===safe)return;colors.delete(key);colors.set(key,safe);while(colors.size>max)colors.delete(colors.keys().next().value);save();};
    const remember=(key,value)=>{cache.delete(key);cache.set(key,value);while(cache.size>max)cache.delete(cache.keys().next().value);save();};
    // Icons that Reddit already painted on this page.
    function fromPage(name){
      const d=typeof doc==='function'?doc():doc;if(!d?.querySelectorAll)return '';
      const lower=name.toLowerCase(),user=/^u_./i.test(name),bare=user?name.slice(2).toLowerCase():lower;
      try{const hinted=safeUrl(hint(lower) || '');if(hinted)return hinted;}catch{}
      const pick=root=>{
        const img=root?.querySelector?.('[avatar] img[src]') || [...(root?.querySelectorAll?.('img[src]') || [])].find(i=>/communityIcon|avatar|snoo/i.test(i.getAttribute('src') || ''));
        const url=safeUrl(img?.getAttribute('src') || '');
        if(url)tint(lower,colorOf(img));
        return url;
      };
      if(!user)for(const card of d.querySelectorAll('shreddit-post[subreddit-name]'))if((card.getAttribute('subreddit-name') || '').toLowerCase()===lower){const url=pick(card.querySelector('[slot="credit-bar"]') || card);if(url)return url;}
      let seen=0;
      for(const a of d.querySelectorAll('a[href]')){
        if(++seen>3000)break;
        let path;try{path=new URL(a.getAttribute('href'),'https://www.reddit.com').pathname.toLowerCase().replace(/\/+$/,'');}catch{continue;}
        if(path==='/'+(user?'user':'r')+'/'+bare || user && path==='/u/'+bare){const url=pick(a);if(url)return url;}
      }
      return '';
    }
    function peek(value){
      const name=normalize(value);if(!name)return null;const key=name.toLowerCase();
      if(cache.has(key)){const hit=cache.get(key);remember(key,hit);return hit;}
      const url=fromPage(name);if(url){remember(key,url);return url;}
      return undefined;
    }
    function schedule(){
      if(timer!==null || !queue.length || active>=concurrency)return;
      const wait=Math.max(0,nextStart-now(),pausedUntil-now());
      timer=setTimer(()=>{timer=null;pump();},wait);
    }
    function pump(){
      while(queue.length && active<concurrency && now()>=nextStart && now()>=pausedUntil){
        const job=queue.shift();active++;nextStart=now()+gap;
        run(job).finally(()=>{active--;pump();});
      }
      schedule();
    }
    async function run({name,key,resolve}){
      let value;
      try{
        const response=await fetcher(hoverCard+encodeURIComponent(name),{headers:{Accept:accept},credentials:'same-origin'});
        if(response.status===429){pausedUntil=now()+pause;value=undefined;}
        else if(response.ok){const card=readCard(await response.text(),Parser());value=card.url;tint(key,card.color);remember(key,card.url);}
        else if(response.status>=400 && response.status<500){value=null;remember(key,null);}
        else value=undefined;
      }catch{value=undefined;}
      pending.delete(key);resolve(value ?? null);
    }
    // Promise<url|null>. A rate-limited or failed request resolves null without being cached.
    function get(value){
      const name=normalize(value);if(!name)return Promise.resolve(null);
      const key=name.toLowerCase(),known=peek(name);
      if(known!==undefined)return Promise.resolve(known);
      if(/^u_./i.test(name))return Promise.resolve(null);
      if(pending.has(key))return pending.get(key);
      const promise=new Promise(resolve=>queue.push({name,key,resolve}));pending.set(key,promise);pump();return promise;
    }
    // An icon Reddit already sent with other data (for example a search result row).
    function prime(value,url){const name=normalize(value),safe=safeUrl(url);if(!name || !safe || cache.get(name.toLowerCase())===safe)return false;remember(name.toLowerCase(),safe);return true;}
    // The community's colour behind its icon or glyph, once known ('' otherwise).
    function color(value){const name=normalize(value);return name?colors.get(name.toLowerCase()) || '':'';}
    return Object.freeze({get,peek,prime,color,stats:()=>({cached:cache.size,queued:queue.length,active,pausedUntil})});
  }
  const shared=create();
  globalThis.RTCommunityIcons=Object.freeze({get:shared.get,peek:shared.peek,prime:shared.prime,color:shared.color,create,parseCard,readCard,safeUrl,safeColor,normalize});
})();
