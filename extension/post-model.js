/* Public post data only. Archive snapshots never establish current deletion status. */
(() => {
  'use strict';
  const validateUsername=value=>typeof value==='string' && /^[A-Za-z0-9_-]{1,20}$/.test(value);
  const validateId=value=>typeof value==='string' && /^(?:t3_)?[a-z0-9]{1,10}$/i.test(value);
  const validateCommentId=value=>typeof value==='string' && /^(?:t1_)?[a-z0-9]{1,32}$/i.test(value);
  const idOf=value=>validateId(value)?value.toLowerCase().replace(/^t3_/,''):'';
  const str=(value,max)=>typeof value==='string'?value.slice(0,max).replace(/\u0000/g,''):'';
  // Archive retrieval time arrives as epoch seconds, sometimes as a numeric string. Anything else is omitted.
  const retrievedAt=value=>{const number=typeof value==='number'?value:typeof value==='string' && /^\d+(?:\.\d+)?$/.test(value)?Number(value):NaN;return Number.isFinite(number)&&number>0&&number<=32503680000?Math.floor(number):0;};
  function safeUrl(value,redditOnly=false){
    if(typeof value!=='string' || value.length>4096 || !(redditOnly?/^(?:https:\/\/|\/(?!\/))/i:/^https?:\/\//i).test(value))return '';
    try{const url=new URL(value,'https://www.reddit.com');
      if(!['https:','http:'].includes(url.protocol) || url.username || url.password || redditOnly && (!['reddit.com','www.reddit.com','old.reddit.com','new.reddit.com','sh.reddit.com'].includes(url.hostname) || url.protocol!=='https:'))return '';
      return url.href;
    }catch{return '';}
  }
  function avatarUrl(value){const url=safeUrl(value);return url.startsWith('https://')?url:'';}
  // Only Reddit's image hosts are loaded automatically. Archive URLs may contain
  // HTML-escaped query separators; decoding those is not HTML execution.
  function mediaUrl(value){
    if(typeof value!=='string' || value.length>4096)return '';
    try{const url=new URL(value.replace(/&amp;/gi,'&'));
      return url.protocol==='https:' && !url.username && !url.password && !url.port && ['i.redd.it','preview.redd.it','cf.preview.redd.it','external-preview.redd.it','i.reddituploads.com','a.thumbs.redditmedia.com','b.thumbs.redditmedia.com'].includes(url.hostname) && /\.(?:jpe?g|png|gif|webp)$/i.test(url.pathname)?url.href:'';
    }catch{return '';}
  }
  function videoUrl(value,extension){
    if(typeof value!=='string' || value.length>4096)return '';
    try{const url=new URL(value.replace(/&amp;/gi,'&'));
      return url.protocol==='https:' && url.hostname==='v.redd.it' && !url.username && !url.password && !url.port && new RegExp('^/[a-z0-9]+/[^/]+\\.'+extension+'$','i').test(url.pathname)?url.href:'';
    }catch{return '';}
  }
  function normalizeMedia(raw){
    const result=[],seen=new Set();
    const dims=(item,source)=>{const width=Number(source?.width ?? source?.x),height=Number(source?.height ?? source?.y);if(Number.isInteger(width) && width>0 && width<=20000 && Number.isInteger(height) && height>0 && height<=20000){item.width=width;item.height=height;}};
    const add=(value,kind,dimensions)=>{const url=mediaUrl(value);if(url && !seen.has(url) && result.length<20){seen.add(url);const item={url,kind};dims(item,dimensions);result.push(item);}};
    const addVideo=(source,poster)=>{
      if(!source || result.length)return;
      const hls=videoUrl(source.hls ?? source.hls_url,'m3u8'),dash=videoUrl(source.dash ?? source.dash_url,'mpd'),fallback=videoUrl(source.fallback ?? source.fallback_url,'mp4');
      const first=hls || dash || fallback;if(!first)return;
      const id=new URL(first).pathname.split('/')[1],same=value=>value && new URL(value).pathname.split('/')[1]===id?value:'';
      const item={kind:'video',hls:same(hls),dash:same(dash),fallback:same(fallback),poster:mediaUrl(poster || source.poster),hasAudio:typeof source.hasAudio==='boolean'?source.hasAudio:typeof source.has_audio==='boolean'?source.has_audio:null};dims(item,source);
      const duration=Number(source.duration);if(Number.isFinite(duration) && duration>0 && duration<=86400)item.duration=duration;
      result.push(item);
    };
    // A second normalization happens across the worker boundary; validate again.
    if(Array.isArray(raw.media))for(const item of raw.media.slice(0,20)){if(item?.kind==='video')addVideo(item);else if(['image','preview','thumbnail'].includes(item?.kind))add(item.url,item.kind,item);}
    const preview=Array.isArray(raw.preview?.images)?raw.preview.images[0]?.source:null;
    if(!result.length && (raw.is_video===true || raw.post_hint==='hosted:video'))addVideo(raw.secure_media?.reddit_video || raw.media?.reddit_video,preview?.url);
    const items=Array.isArray(raw.gallery_data?.items)?raw.gallery_data.items.slice(0,20):[];
    if(!result.length)for(const item of items){const id=item?.media_id;if(typeof id!=='string' || !/^[a-z0-9]{1,40}$/i.test(id))continue;const entry=raw.media_metadata?.[id];
      if(entry?.e==='Image' && /^image\/(?:jpe?g|png|gif|webp)$/i.test(entry.m || ''))add(entry.s?.u,'image',entry.s);
    }
    if(!items.length && !result.length){const direct=mediaUrl(raw.url);if(direct && new URL(direct).hostname==='i.redd.it')add(direct,'image',preview);
      if(!result.length && preview)add(preview.url,raw.post_hint==='image'?'image':'preview',preview);
    }
    if(!result.length)add(raw.thumbnail,'thumbnail');
    return result;
  }
  function normalizeSettings(raw){return {postDiscovery:raw?.postDiscovery!==false,archiveDiscovery:raw?.archiveDiscovery===true,restoreDeletedContent:raw?.restoreDeletedContent!==false};}
  function snapshotStatus(raw,body){
    if(body==='[deleted]' || raw.removed_by_category==='deleted' || raw.status==='deleted')return 'deleted';
    if(body==='[removed]' || raw.removed_by_category || raw.status==='removed')return 'removed';
    return raw.status==='unknown'?'unknown':'available';
  }
  // Post type for local filtering (Arctic Shift has no type filter). Already-normalized posts keep theirs.
  const postTypes=['text','textmedia','poll','image','gif','video','gallery','link','embed','crosspost'];
  const embedHosts=/(^|\.)(youtube\.com|youtu\.be|vimeo\.com|streamable\.com|twitch\.tv|dailymotion\.com|dai\.ly|gfycat\.com|redgifs\.com|tiktok\.com|rumble\.com|soundcloud\.com|spotify\.com|twitter\.com|x\.com)$/i;
  const embedProviders=/youtube|vimeo|streamable|twitch|dailymotion|gfycat|redgifs|tiktok|rumble|soundcloud|spotify|twitter/i;
  function postTypeOf(raw){
    if(postTypes.includes(raw.postType))return raw.postType;
    if(raw.crosspost_parent || Array.isArray(raw.crosspost_parent_list) && raw.crosspost_parent_list.length)return 'crosspost';
    if(raw.poll_data && typeof raw.poll_data==='object')return 'poll';
    if(raw.is_gallery===true || raw.gallery_data)return 'gallery';
    let host='',path='';try{const url=new URL(String(raw.url_overridden_by_dest ?? raw.url ?? ''));host=url.hostname.toLowerCase();path=url.pathname;}catch{}
    const isSelf=raw.is_self===true,images=Array.isArray(raw.preview?.images)?raw.preview.images:[];
    const previewPath=(()=>{try{return new URL(String(images[0]?.source?.url ?? '').replace(/&amp;/gi,'&')).pathname;}catch{return '';}})();
    if(!isSelf && (/\.gif$/i.test(path) || /\.gif$/i.test(previewPath) || images[0]?.variants?.gif || raw.media?.reddit_video?.is_gif===true || raw.preview?.reddit_video_preview?.is_gif===true))return 'gif';
    if(raw.is_video===true || raw.post_hint==='hosted:video' || host==='v.redd.it')return 'video';
    const oembed=raw.secure_media?.oembed ?? raw.media?.oembed;
    if(raw.post_hint==='rich:video' || oembed && embedProviders.test(String(oembed.provider_name ?? oembed.provider_url ?? '')) || !isSelf && embedHosts.test(host))return 'embed';
    if(raw.post_hint==='image' || ['i.redd.it','i.imgur.com','preview.redd.it'].includes(host) && /\.(?:jpe?g|png|gif|webp)$/i.test(path))return 'image';
    if(isSelf){
      const inline=raw.media_metadata && typeof raw.media_metadata==='object' && Object.keys(raw.media_metadata).length>0 || /(?:https?:\/\/(?:preview|i)\.redd\.it\/\S+\.(?:jpe?g|png|gif|webp)|!\[[^\]]*\]\(https?:)/i.test(String(raw.selftext ?? ''));
      return inline?'textmedia':'text';
    }
    return 'link';
  }
  function normalizePost(raw,{source='reddit'}={}){
    raw=raw?.data || raw;
    if(!raw || typeof raw!=='object' || !['reddit','arctic-shift'].includes(source))return null;
    const id=idOf(raw.id || raw.name || raw.fullname),author=str(raw.author,20),created=Number(raw.created_utc ?? raw.created);
    if(!id || !(validateUsername(author)||author==='[deleted]') || !Number.isFinite(created) || created<=0 || created>32503680000)return null;
    const body=str(raw.selftext ?? raw.body,40000),status=snapshotStatus(raw,body);
    const result={id,fullname:'t3_'+id,author,subreddit:str(raw.subreddit,100),title:str(raw.title,1000),body,
      created:Math.floor(created),permalink:safeUrl(raw.permalink,true)||'https://www.reddit.com/comments/'+id+'/',url:safeUrl(raw.url),thumbnail:safeUrl(raw.thumbnail),
      media:normalizeMedia(raw),over18:raw.over_18===true||raw.over18===true,spoiler:raw.spoiler===true,score:Number.isFinite(Number(raw.score))?Math.max(-1e9,Math.min(1e9,Number(raw.score))):0,
      comments:Number.isFinite(Number(raw.num_comments ?? raw.comments))?Math.max(0,Math.min(1e9,Math.floor(Number(raw.num_comments ?? raw.comments)))):0,
      status:source==='arctic-shift'?'unknown':status,source,bodySource:source,postType:postTypeOf(raw)};
    if(source==='arctic-shift'){
      result.archiveStatus=['available','deleted','removed','unknown'].includes(raw.archiveStatus)?raw.archiveStatus:status;
      const retrieved=retrievedAt(raw.retrieved_on ?? raw.retrieved);if(retrieved)result.retrieved=retrieved;
      // Server-rendered markdown from the archive. Untrusted: pages must sanitize before display.
      const html=str(raw.bodyHtml ?? raw.selftext_html ?? raw.body_html,120000);if(html)result.bodyHtml=html;
    }
    return result;
  }
  function normalizeComment(raw,{source='reddit'}={}){
    raw=raw?.data || raw;
    if(!raw || typeof raw!=='object' || !['reddit','arctic-shift'].includes(source))return null;
    const input=raw.id || raw.name || raw.fullname;
    if(!validateCommentId(input))return null;
    const id=input.toLowerCase().replace(/^t1_/,''),linkId=idOf(raw.link_id || raw.linkId);
    const base=normalizePost({...raw,id:'comment',selftext:raw.body,permalink:undefined},{source});
    if(!base || !linkId)return null;
    // Comment image metadata is independent of post galleries. Only accept
    // entries referenced by the body, and validate their Reddit-hosted source.
    if(!base.media.length && raw.media_metadata && typeof raw.media_metadata==='object'){
      const body=str(raw.body,40000), media=[];
      for(const [key,entry] of Object.entries(raw.media_metadata).slice(0,100)){
        if(!/^[a-z0-9]{1,40}$/i.test(key) || entry?.e!=='Image' || !/^image\/(?:jpe?g|png|gif|webp)$/i.test(entry.m || ''))continue;
        const source=mediaUrl(entry.s?.u);if(!source)continue;
        const path=new URL(source).pathname.split('/').pop()?.replace(/\.[^.]+$/,'');
        const references=[...body.matchAll(/https:\/\/[^\s<>()]+/gi)].some(match=>{const ref=mediaUrl(match[0]);return ref && new URL(ref).pathname.split('/').pop()?.replace(/\.[^.]+$/,'')===key;});
        const marker=new RegExp('!\\[[^\\]\\n]*\\]\\('+key+'\\)','i').test(body);
        if(path!==key || !references && !marker)continue;
        const item={url:source,kind:'image'},width=Number(entry.s?.x),height=Number(entry.s?.y);
        if(Number.isInteger(width) && width>0 && width<=20000 && Number.isInteger(height) && height>0 && height<=20000){item.width=width;item.height=height;}
        media.push(item);if(media.length===20)break;
      }
      base.media=media;
    }
    const parent=str(raw.parent_id ?? raw.parentId,40).toLowerCase();let parentId='';
    if(/^t1_[a-z0-9]{1,32}$/.test(parent) || /^t3_[a-z0-9]{1,10}$/.test(parent))parentId=parent;
    else if(/^[a-z0-9]{1,32}$/.test(parent))parentId=(parent===linkId?'t3_':'t1_')+parent;
    else if(Object.hasOwn(raw,'parent_id') && (raw.parent_id==null || raw.parent_id===''))parentId='t3_'+linkId;
    delete base.postType;
    return {...base,kind:'comment',id,fullname:'t1_'+id,linkId,title:str(raw.link_title ?? raw.title,1000),
      permalink:safeUrl(raw.permalink,true)||'https://www.reddit.com/comments/'+linkId+'/comment/'+id+'/',
      parentId};
  }
  // Minimal parent-post facts for comment titles and restriction flags. Only the requested ID set is trusted by callers.
  function normalizeLinkInfo(raw){
    raw=raw?.data || raw;
    if(!raw || typeof raw!=='object' || !validateId(raw.id))return null;
    return {id:idOf(raw.id),title:str(raw.title,1000),subreddit:str(raw.subreddit,100),over18:raw.over_18===true||raw.over18===true,spoiler:raw.spoiler===true};
  }
  // Reddit's deletion evidence. Current markup shows notices ("Comment deleted by
  // user", "[ Removed by moderator ]" titles, a removal banner); older markup
  // used [deleted]/[removed]. Notices of nested replies never count.
  const deletedNotice=/^(?:\[deleted\]|comment deleted by user|\[\s*deleted by user\s*\])$/i,removedNotice=/^(?:\[removed\]|comment removed by moderator|\[\s*removed by (?:moderator|reddit)\s*\])$/i;
  const noticeStatus=text=>{const value=String(text || '').trim();return deletedNotice.test(value)?'deleted':removedNotice.test(value)?'removed':'';};
  // The item's own notice paragraph: only the first non-empty paragraph of its own
  // body counts, so user text that is exactly "[removed]" in a later paragraph (or
  // in a nested reply) is never mistaken for Reddit's notice.
  function noticeParagraph(node){
    if(!node?.querySelectorAll)return null;
    const owner='shreddit-comment,shreddit-profile-comment,shreddit-post';
    for(const p of node.querySelectorAll('p')){
      if((p.closest(owner) || node)!==node || p.closest('summary,[slot="actionRow"],[slot="commentMeta"],[data-rt-recovered-text]') || !p.textContent.trim())continue;
      return noticeStatus(p.textContent)?p:null;
    }
    return null;
  }
  function domStatus(node){
    if(!node?.querySelectorAll)return '';
    const flag=name=>node.hasAttribute(name) && node.getAttribute(name)!=='false',state=(node.getAttribute('item-state') || '').toLowerCase(),title=noticeStatus(node.getAttribute('post-title'));
    const owner='shreddit-comment,shreddit-profile-comment,shreddit-post';
    const notice=noticeStatus(noticeParagraph(node)?.textContent);
    // Reddit uses the same banner slot for both cases; only its wording differs
    // ("deleted by the person who originally posted it" vs "removed by the moderators").
    const bannerText=[...node.querySelectorAll('[slot="post-removed-banner"]')].filter(el=>(el.closest(owner) || node)===node).map(el=>el.textContent.replace(/\s+/g,' ').trim()).join(' ');
    const banner=bannerText?(/\bdeleted\b/i.test(bannerText) && !/\bremoved\b/i.test(bannerText)?'deleted':'removed'):'';
    if((flag('deleted') || flag('is-comment-deleted')) && notice!=='removed' || state==='deleted' || notice==='deleted' || title==='deleted' || banner==='deleted')return 'deleted';
    if(flag('removed') || state==='removed' || banner==='removed' || notice==='removed' || title==='removed')return 'removed';
    return '';
  }
  const normalizeItem=(raw,options)=>raw?.kind==='comment' || /^t1_/i.test(raw?.name || raw?.fullname || raw?.id || '')?normalizeComment(raw,options):normalizePost(raw,options);
  function mergePosts(livePosts,archivePosts,{username,visibleIds=[],sort='new',range='all',now=Date.now()/1000}={}){
    if(!validateUsername(username))return [];
    const same=post=>post.author.toLowerCase()===username.toLowerCase();
    const visible=new Set(Array.from(visibleIds,value=>String(value).toLowerCase())),posts=new Map();
    for(const raw of Array.isArray(archivePosts)?archivePosts:[]){const post=normalizeItem(raw,{source:'arctic-shift'});if(post && same(post))posts.set(post.fullname,{...post,archiveAvailable:true});}
    for(const raw of Array.isArray(livePosts)?livePosts:[]){const post=normalizeItem(raw,{source:'reddit'});if(!post)continue;const archived=posts.get(post.fullname);
      if(!same(post) && !(post.author==='[deleted]' && archived))continue;
      const merged={...post,over18:post.over18 || archived?.over18===true,spoiler:post.spoiler || archived?.spoiler===true,archiveAvailable:Boolean(archived)};
      if(archived && ['deleted','removed'].includes(post.status) && archived.body && !['[deleted]','[removed]'].includes(archived.body)){merged.archivedBody=archived.body;merged.archivedBodySource='arctic-shift';merged.archiveAuthor=archived.author;if(archived.bodyHtml)merged.archivedBodyHtml=archived.bodyHtml;}
      posts.set(post.fullname,merged);
    }
    const rank=new Map();for(const raw of Array.isArray(livePosts)?livePosts:[]){const post=normalizeItem(raw,{source:'reddit'});if(post && !rank.has(post.fullname))rank.set(post.fullname,rank.size);}
    const duration={hour:3600,day:86400,week:604800,month:2592000,year:31536000}[range],cutoff=sort==='top' && duration?now-duration:-Infinity;
    return [...posts.values()].filter(post=>post.created>=cutoff).map(post=>({...post,visible:visible.has(post.fullname) || post.kind!=='comment' && visible.has(post.id),outsideVisibleFeed:!visible.has(post.fullname) && !(post.kind!=='comment' && visible.has(post.id))})).sort((a,b)=>(sort==='top'?b.score-a.score:sort==='hot'?(rank.get(a.fullname)??Infinity)-(rank.get(b.fullname)??Infinity):0) || b.created-a.created || a.fullname.localeCompare(b.fullname));
  }
  globalThis.RTPostModel=Object.freeze({noticeStatus,noticeParagraph,domStatus,avatarUrl,validateUsername,validateId,validateCommentId,mediaUrl,videoUrl,normalizePost,normalizeComment,normalizeItem,normalizeLinkInfo,mergePosts,normalizeSettings});
})();
