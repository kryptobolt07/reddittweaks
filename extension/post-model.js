/* Public post data only. Archive snapshots never establish current deletion status. */
(() => {
  'use strict';
  const validateUsername=value=>typeof value==='string' && /^[A-Za-z0-9_-]{1,20}$/.test(value);
  const validateId=value=>typeof value==='string' && /^(?:t3_)?[a-z0-9]{1,10}$/i.test(value);
  const idOf=value=>validateId(value)?value.toLowerCase().replace(/^t3_/,''):'';
  const str=(value,max)=>typeof value==='string'?value.slice(0,max).replace(/\u0000/g,''):'';
  function safeUrl(value,redditOnly=false){
    if(typeof value!=='string' || value.length>4096 || !(redditOnly?/^(?:https:\/\/|\/(?!\/))/i:/^https?:\/\//i).test(value))return '';
    try{const url=new URL(value,'https://www.reddit.com');
      if(!['https:','http:'].includes(url.protocol) || url.username || url.password || redditOnly && (!['reddit.com','www.reddit.com','old.reddit.com','new.reddit.com','sh.reddit.com'].includes(url.hostname) || url.protocol!=='https:'))return '';
      return url.href;
    }catch{return '';}
  }
  function normalizeSettings(raw){return {postDiscovery:raw?.postDiscovery!==false,archiveDiscovery:raw?.archiveDiscovery===true};}
  function snapshotStatus(raw,body){
    if(body==='[deleted]' || raw.removed_by_category==='deleted' || raw.status==='deleted')return 'deleted';
    if(body==='[removed]' || raw.removed_by_category || raw.status==='removed')return 'removed';
    return raw.status==='unknown'?'unknown':'available';
  }
  function normalizePost(raw,{source='reddit'}={}){
    raw=raw?.data || raw;
    if(!raw || typeof raw!=='object' || !['reddit','arctic-shift'].includes(source))return null;
    const id=idOf(raw.id || raw.name || raw.fullname),author=str(raw.author,20),created=Number(raw.created_utc ?? raw.created);
    if(!id || !(validateUsername(author)||author==='[deleted]') || !Number.isFinite(created) || created<=0 || created>32503680000)return null;
    const body=str(raw.selftext ?? raw.body,40000),status=snapshotStatus(raw,body);
    const result={id,fullname:'t3_'+id,author,subreddit:str(raw.subreddit,100),title:str(raw.title,1000),body,
      created:Math.floor(created),permalink:safeUrl(raw.permalink,true)||'https://www.reddit.com/comments/'+id+'/',url:safeUrl(raw.url),thumbnail:safeUrl(raw.thumbnail),
      over18:raw.over_18===true||raw.over18===true,spoiler:raw.spoiler===true,score:Number.isFinite(Number(raw.score))?Math.max(-1e9,Math.min(1e9,Number(raw.score))):0,
      comments:Number.isFinite(Number(raw.num_comments ?? raw.comments))?Math.max(0,Math.min(1e9,Math.floor(Number(raw.num_comments ?? raw.comments)))):0,
      status:source==='arctic-shift'?'unknown':status,source,bodySource:source};
    if(source==='arctic-shift')result.archiveStatus=['available','deleted','removed','unknown'].includes(raw.archiveStatus)?raw.archiveStatus:status;
    return result;
  }
  function mergePosts(livePosts,archivePosts,{username,visibleIds=[]}={}){
    if(!validateUsername(username))return [];
    const same=post=>post.author.toLowerCase()===username.toLowerCase();
    const visible=new Set(Array.from(visibleIds,idOf).filter(Boolean)),posts=new Map();
    for(const raw of Array.isArray(archivePosts)?archivePosts:[]){const post=normalizePost(raw,{source:'arctic-shift'});if(post && same(post))posts.set(post.id,{...post,archiveAvailable:true});}
    for(const raw of Array.isArray(livePosts)?livePosts:[]){const post=normalizePost(raw,{source:'reddit'});if(!post)continue;const archived=posts.get(post.id);
      if(!same(post) && !(post.author==='[deleted]' && archived))continue;
      const merged={...post,over18:post.over18 || archived?.over18===true,spoiler:post.spoiler || archived?.spoiler===true,archiveAvailable:Boolean(archived)};
      if(archived && ['deleted','removed'].includes(post.status) && archived.body && !['[deleted]','[removed]'].includes(archived.body)){merged.archivedBody=archived.body;merged.archivedBodySource='arctic-shift';merged.archiveAuthor=archived.author;}
      posts.set(post.id,merged);
    }
    return [...posts.values()].map(post=>({...post,visible:visible.has(post.id),outsideVisibleFeed:!visible.has(post.id)})).sort((a,b)=>b.created-a.created || a.id.localeCompare(b.id));
  }
  globalThis.RTPostModel=Object.freeze({validateUsername,validateId,normalizePost,mergePosts,normalizeSettings});
})();
