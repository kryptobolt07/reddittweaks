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
  function normalizeSettings(raw){return {postDiscovery:raw?.postDiscovery!==false,archiveDiscovery:raw?.archiveDiscovery===true,restoreDeletedContent:raw?.restoreDeletedContent!==false};}
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
    const parent=str(raw.parent_id ?? raw.parentId,40).toLowerCase();let parentId='';
    if(/^t1_[a-z0-9]{1,32}$/.test(parent) || /^t3_[a-z0-9]{1,10}$/.test(parent))parentId=parent;
    else if(/^[a-z0-9]{1,32}$/.test(parent))parentId=(parent===linkId?'t3_':'t1_')+parent;
    else if(Object.hasOwn(raw,'parent_id') && (raw.parent_id==null || raw.parent_id===''))parentId='t3_'+linkId;
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
  function domStatus(node){
    if(!node?.querySelectorAll)return '';
    const flag=name=>node.hasAttribute(name) && node.getAttribute(name)!=='false',state=(node.getAttribute('item-state') || '').toLowerCase(),title=noticeStatus(node.getAttribute('post-title'));
    const owner='shreddit-comment,shreddit-profile-comment,shreddit-post';
    const notice=[...node.querySelectorAll('p')].filter(p=>(p.closest(owner) || node)===node && !p.closest('[data-rt-recovered-text]')).map(p=>noticeStatus(p.textContent)).find(Boolean) || '';
    const banner=[...node.querySelectorAll('[slot="post-removed-banner"]')].some(el=>(el.closest(owner) || node)===node);
    if((flag('deleted') || flag('is-comment-deleted')) && notice!=='removed' || state==='deleted' || notice==='deleted' || title==='deleted')return 'deleted';
    if(flag('removed') || state==='removed' || banner || notice==='removed' || title==='removed')return 'removed';
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
  globalThis.RTPostModel=Object.freeze({noticeStatus,domStatus,avatarUrl,validateUsername,validateId,validateCommentId,normalizePost,normalizeComment,normalizeItem,normalizeLinkInfo,mergePosts,normalizeSettings});
})();
