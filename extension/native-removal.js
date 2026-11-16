/* Authenticated native markup only. No network, credentials, or side effects. */
(() => {
 'use strict';
 if(globalThis.RTNativeRemoval)return;
 const M=globalThis.RTPostModel;
 const ownerOK=value=>/^t2_[a-z0-9]{1,13}$/i.test(value || '');
 const closestCard=node=>node?.closest?.('shreddit-post,shreddit-profile-comment,shreddit-comment');
 const ownQuery=(card,selector)=>[...card.querySelectorAll(selector)].find(n=>closestCard(n)===card);
 function bodyOf(card){
  const body=ownQuery(card,'[slot="text-body"],[slot="comment"],[id$="-comment-rtjson-content"],[id$="-post-rtjson-content"],[id$="-rtjson-content"]');
  if(!body)return '';const copy=body.cloneNode(true);for(const nested of copy.querySelectorAll('shreddit-comment,shreddit-profile-comment,shreddit-post,script,style'))nested.remove();return copy.textContent.trim();
 }
 function identity(doc=globalThis.document){
  const app=doc.querySelector('shreddit-app'),owner=app?.getAttribute('logged-in-user-id');
  if(app?.getAttribute('user-logged-in')!=='true' || !ownerOK(owner))return null;
  const names=new Map(),add=name=>{if(M.validateUsername(name))names.set(name.toLowerCase(),name);};
  for(const partial of doc.querySelectorAll('#user-drawer-content faceplate-partial[src]')){
   try{const url=new URL(partial.getAttribute('src'),doc.location?.origin || 'https://www.reddit.com');
    if(url.origin!==(doc.location?.origin || 'https://www.reddit.com') || !/^\/svc\/shreddit\/partial\/[\w-]+\/user-drawer-menu$/.test(url.pathname))continue;
    // Reddit writes this key as userName (captured 2026-11-16); match it whatever its case.
    for(const [key,value] of new URLSearchParams(url.searchParams.get('params') || ''))if(key.toLowerCase()==='username')add(value);
   }catch{}
  }
  for(const card of doc.querySelectorAll('shreddit-post[author-id],shreddit-comment[author-id],shreddit-overflow-menu[author-id]')){
   if(card.getAttribute('author-id')?.toLowerCase()===owner.toLowerCase())add(card.getAttribute('author') || card.getAttribute('author-name'));
  }
  return names.size===1?{owner:owner.toLowerCase(),username:[...names.values()][0]}:null;
 }
 function item(card,me){
  if(!card || !ownerOK(me?.owner) || !M.validateUsername(me?.username) || card.closest('[data-rt-recovered-text]'))return null;
  const comment=card.tagName!=='SHREDDIT-POST',fullname=(card.getAttribute(comment?'comment-id':'id') || card.getAttribute('thingid') || card.id || '').toLowerCase();
  if(!(comment?M.validateCommentId(fullname)&&fullname.startsWith('t1_'):M.validateId(fullname)&&fullname.startsWith('t3_')))return null;
  const overflow=ownQuery(card,'shreddit-overflow-menu[author-id]'),authorId=card.getAttribute('author-id') || overflow?.getAttribute('author-id');
  const author=card.getAttribute('author') || overflow?.getAttribute('author-name') || ownQuery(card,'[id^="poster-info-"] a[href*="/user/"]')?.getAttribute('href')?.match(/\/user\/([\w-]+)\/?$/)?.[1];
  if(author?.toLowerCase()!==me.username.toLowerCase() || authorId && authorId.toLowerCase()!==me.owner.toLowerCase())return null;
  let url;try{url=new URL(card.getAttribute('permalink') || card.getAttribute('href') || overflow?.getAttribute('permalink') || ownQuery(card,'shreddit-comment-action-row[permalink]')?.getAttribute('permalink'), 'https://www.reddit.com');}catch{return null;}
  const path=url.pathname,postId=path.match(/\/comments\/([a-z0-9]{1,10})(?:\/|$)/i)?.[1];
  if(!postId || url.origin!=='https://www.reddit.com' || comment && !path.split('/').includes(fullname.slice(3)))return null;
  const body=bodyOf(card);
  const created=Date.parse(card.getAttribute('created-timestamp') || overflow?.getAttribute('comment-created-timestamp') || ownQuery(card,'faceplate-timeago[ts]')?.getAttribute('ts'))/1000;
  if(!Number.isFinite(created) || created<=0)return null;
  const state=(card.getAttribute('item-state') || '').toUpperCase(),banner=ownQuery(card,'[slot="post-removed-banner"],[slot="comment-removed-banner"]')?.textContent?.trim() || '';
  let category=card.getAttribute('removed-by-category') || (state==='AUTOMOD_FILTERED'?'automod_filtered':null);
  if(!category && /removed by (?:the )?automoderator/i.test(banner))category='automod_filtered';
  if(!category && /removed by reddit[’']s filters/i.test(banner))category='reddit';
  if(!category && /removed by (?:the )?moderators/i.test(banner))category='moderator';
  const nativeRemoved=['REMOVED','SPAM','FILTERED','AUTOMOD_FILTERED'].includes(state) || Boolean(banner && /\bremoved\b/i.test(banner));
  const raw={id:fullname.slice(3),author,created_utc:Math.floor(created),subreddit:card.getAttribute('subreddit-name') || path.match(/^\/r\/([^/]+)\//)?.[1] || '',permalink:path+url.search,
   title:comment?undefined:card.getAttribute('post-title') || ownQuery(card,'[slot="title"]')?.textContent || '',selftext:comment?undefined:body,body:comment?body:undefined,
   link_id:comment?'t3_'+postId:undefined,parent_id:comment?card.getAttribute('parentid') || card.getAttribute('parent-id') || 't3_'+postId:undefined,
   score:Number(card.getAttribute('score') || ownQuery(card,'shreddit-comment-action-row[score]')?.getAttribute('score')) || 0,num_comments:Number(card.getAttribute('comment-count')) || 0,
   is_self:['text','textmedia'].includes(card.getAttribute('post-type')) || Boolean(body),over_18:card.hasAttribute('nsfw') || card.hasAttribute('is-nsfw'),spoiler:card.hasAttribute('spoiler')};
  const value=(comment?M.normalizeComment:M.normalizePost)(raw,{source:'reddit'});if(!value)return null;
  value.kind=comment?'comment':'post';value.moderation={category,removalReason:false,locked:card.hasAttribute('is-locked') || card.hasAttribute('locked'),subredditType:card.getAttribute('subreddit-type') || 'public',quarantined:card.hasAttribute('quarantined'),authorBody:body,
   nativeRemoved,visibilityKnown:state==='APPROVED',native:true};return value;
 }
 function listing(doc,me,source='overview',{continuation=false}={}){
  const feed=doc.querySelector('main shreddit-feed,shreddit-feed') || doc,posts=[],seen=new Set();let unreadable=0,scanned=0;
  for(const card of feed.querySelectorAll('shreddit-post,shreddit-profile-comment')){
   if(card.closest('[data-rt-ui]'))continue;scanned++;const value=item(card,me);if(!value){unreadable++;continue;}
   if(!seen.has(value.fullname)){seen.add(value.fullname);posts.push(value);}
  }
  // A continuation page with no items is the end of the profile (captured 2026-11-16); an empty first page is not.
  if(scanned && !posts.length || !scanned && !continuation && !doc.querySelector('shreddit-feed,#empty-feed-content,[data-testid="empty-state"]'))throw Error('Reddit’s native profile items could not be verified.');
  let after=null;
  for(const partial of feed.querySelectorAll('faceplate-partial[src*="/svc/shreddit/profiles/"]')){
   const url=new URL(partial.getAttribute('src'),'https://www.reddit.com');
   // Continuation pages also carry the profile's modal partials (followers, contributions, active communities).
   if(!url.pathname.includes('more-posts'))continue;
   if(url.origin!=='https://www.reddit.com' || url.pathname!=='/svc/shreddit/profiles/profile_'+source+'-more-posts/new/' || url.searchParams.get('name')?.toLowerCase()!==me.username.toLowerCase() || url.href.length>4096)throw Error('Reddit’s native profile continuation changed.');
   if(after && after!==url.pathname+url.search)throw Error('Reddit returned conflicting native continuations.');after=url.pathname+url.search;
  }
  return {posts,scanned,unreadable,after,hasMore:Boolean(after),incomplete:true,source:'reddit',transport:'native'};
 }
 /* Your profile as a signed-out visitor sees it (spec §18): which of your items are listed, with their times, and the
    native continuation. The page is your own profile, so a card counts when its author name is yours; viewer-only
    markers (author IDs on menus) may be absent signed out. */
 function publicListing(doc,me,{continuation=false}={}){
  if(!ownerOK(me?.owner) || !M.validateUsername(me?.username))throw Error('Invalid own signed-out profile read.');
  const feed=doc.querySelector('main shreddit-feed,shreddit-feed') || doc,items=[],seen=new Set();let scanned=0;
  for(const card of feed.querySelectorAll('shreddit-post,shreddit-profile-comment')){
   scanned++;const comment=card.tagName!=='SHREDDIT-POST',fullname=(card.getAttribute(comment?'comment-id':'id') || card.getAttribute('thingid') || '').toLowerCase();
   if(!(comment?M.validateCommentId(fullname)&&fullname.startsWith('t1_'):M.validateId(fullname)&&fullname.startsWith('t3_')))continue;
   const author=card.getAttribute('author') || ownQuery(card,'shreddit-overflow-menu[author-name]')?.getAttribute('author-name') || ownQuery(card,'[id^="poster-info-"] a[href*="/user/"]')?.getAttribute('href')?.match(/\/user\/([\w-]+)\/?$/)?.[1];
   if(author && author.toLowerCase()!==me.username.toLowerCase())continue;
   const created=Date.parse(card.getAttribute('created-timestamp') || ownQuery(card,'faceplate-timeago[ts]')?.getAttribute('ts') || '')/1000;
   const subreddit=String(card.getAttribute('subreddit-name') || card.getAttribute('subreddit-prefixed-name') || (card.getAttribute('permalink') || card.getAttribute('href') || '').match(/^\/r\/([^/]+)\//)?.[1] || '').replace(/^r\//i,'').toLowerCase();
   if(!seen.has(fullname)){seen.add(fullname);items.push({fullname,created:Number.isFinite(created) && created>0?Math.floor(created):0,subreddit});}
  }
  if(!scanned && !continuation && !doc.querySelector('shreddit-feed,#empty-feed-content,[data-testid="empty-state"]'))throw Error('Reddit’s signed-out profile could not be read.');
  let after=null;
  for(const partial of feed.querySelectorAll('faceplate-partial[src*="/svc/shreddit/profiles/"]')){
   const url=new URL(partial.getAttribute('src'),'https://www.reddit.com');if(!url.pathname.includes('more-posts'))continue;
   if(url.origin!=='https://www.reddit.com' || url.pathname!=='/svc/shreddit/profiles/profile_overview-more-posts/new/' || url.searchParams.get('name')?.toLowerCase()!==me.username.toLowerCase() || url.href.length>4096)throw Error('Reddit’s signed-out profile continuation changed.');
   after=url.pathname+url.search;break;
  }
  return {items,after,hasMore:Boolean(after)};
 }
 function publicItem(doc,expected){
  const fullname=expected?.fullname,comment=/^t1_/.test(fullname || ''),unknown=why=>({fullname,status:'unknown',verified:false,source:'signed-out-native',why});
  if(!(comment?M.validateCommentId(fullname):M.validateId(fullname)) || !M.validateUsername(expected?.username))return unknown('Invalid public item identity.');
  const cards=[...doc.querySelectorAll(comment?'shreddit-profile-comment,shreddit-comment':'shreddit-post')].filter(n=>[n.id,n.getAttribute('comment-id'),n.getAttribute('thingid')].includes(fullname));
  if(cards.length!==1)return unknown('The signed-out response did not contain one exact matching item.');
  const card=cards[0],overflow=ownQuery(card,'shreddit-overflow-menu[author-name]'),author=card.getAttribute('author') || overflow?.getAttribute('author-name') || ownQuery(card,'[id^="poster-info-"] a[href*="/user/"]')?.getAttribute('href')?.match(/\/user\/([\w-]+)\/?$/)?.[1] || '';
  if(author && author!=='[deleted]' && author.toLowerCase()!==expected.username.toLowerCase())return unknown('The signed-out item author did not match.');
  const body=bodyOf(card),state=(card.getAttribute('item-state') || '').toUpperCase(),flag=name=>card.hasAttribute(name) && card.getAttribute(name)!=='false';
  const explicit=flag('deleted') || flag('is-comment-deleted') || flag('removed') || ['REMOVED','DELETED','SPAM','FILTERED','AUTOMOD_FILTERED'].includes(state) || ownQuery(card,'[slot="post-removed-banner"],[slot="comment-removed-banner"]');
  let status=explicit?M.domStatus(card) || (state==='DELETED'?'deleted':'removed'):'';
  // Signed out, Reddit puts a removed or deleted comment's notice in a plain block under the card's .md wrapper, with
  // no text element and no author line (captured 2026-11-16). Only a block that is exactly the notice counts.
  const plain=body?'':(ownQuery(card,'.md > div')?.textContent || '').trim();
  const notice=M.noticeStatus(body || plain);if(!status && notice && notice!==expected.originalNotice)status=notice;
  if(!status){
   const readable=Boolean(body) || !comment && !expected.expectsBody && Boolean(card.getAttribute('post-title'));
   if(author.toLowerCase()!==expected.username.toLowerCase() || !readable)return unknown('The signed-out item was gated or contained no readable content.');status='visible';
  }
  return {fullname,status,verified:true,source:'signed-out-native',moderation:state==='APPROVED'?'approved':'',why:status==='visible'?'Visible in a signed-out Reddit view.':status==='removed'?'The signed-out Reddit view marks this item as removed.':'The signed-out Reddit view marks this item as deleted.'};
 }
 globalThis.RTNativeRemoval=Object.freeze({identity,item,listing,ownerOK,publicItem,publicListing});
})();
