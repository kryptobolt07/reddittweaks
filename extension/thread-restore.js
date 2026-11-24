/* Post pages: show archived text for comments Reddit marks deleted or removed.
   Only comments Reddit itself labels deleted/removed are changed. Archive text
   is never proof of deletion, and it is shown with a cue naming its source.
   Requires the separate Arctic Shift and automatic-restoration preferences. */
(() => {
  'use strict';
  const M=globalThis.RTPostModel;if(!M || window.top!==window || !globalThis.chrome?.runtime?.id)return;
  // Reddit's own wording for notices comes from RTPostModel.noticeStatus (one shared test).
  // Reddit's image hosts, as in post-page-bridge's safeAvatar: the page world's answer is
  // revalidated here because other page scripts can post the same document events.
  const avatarHosts=new Set(['styles.redditmedia.com','i.redd.it','preview.redd.it','cf.preview.redd.it','www.redditstatic.com']);
  const safeAvatar=value=>{if(typeof value!=='string' || value.length>2048)return '';try{const url=new URL(value);return url.protocol==='https:' && !url.username && !url.password && !url.port && avatarHosts.has(url.hostname) && (!url.pathname.includes('/snoovatar/avatars/') || /-headshot\.[a-z]+$/i.test(url.pathname))?url.href:'';}catch{return '';}};
  // Only wording that names the author's own deletion may say so; a bare [deleted] does not.
  const cueOf=(status,text)=>status==='removed'?'Removed on Reddit':/\bdeleted by (?:user|the person|the author|its author)\b/i.test(text)?'Deleted by its author on Reddit':'Deleted on Reddit';
  const retryable=code=>['rate-limited','timeout','network-error','busy','http-error'].includes(code);
  const postIdOf=(path=location.pathname)=>path.match(/^\/(?:r\/[^/]+\/|user\/[^/]+\/)?comments\/([a-z0-9]{1,10})(?:\/|$)/i)?.[1]?.toLowerCase() || '';
  const make=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text)el.textContent=text;return el;};
  async function send(message){
    let timer;
    try{
      const response=await Promise.race([chrome.runtime.sendMessage({scope:'rt-posts',...message,pageUrl:location.href}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(Error('Archive request took too long.'),{code:'timeout'})),16000);})]);
      if(!response?.ok)throw Object.assign(Error(response?.error || 'Archive unavailable.'),{code:response?.code,retryAt:response?.retryAt});
      return response;
    }finally{clearTimeout(timer);}
  }
  const authorGone=node=>node.getAttribute('author')==='[deleted]' || node.hasAttribute('is-author-deleted');
  const deletedLabel=/^(?:u\/)?\[deleted\]$/i;
  // A post its author deleted keeps only its title: Reddit drops its type, body and media and shows [deleted]
  // with no notice. A deleted account's surviving post keeps its type and content.
  const contentGone=post=>authorGone(post) && !post.hasAttribute('post-type') && !post.querySelector('[slot="text-body"],[slot="post-media-container"],[slot="thumbnail"]');
  const postAuthorLabel=post=>{
    const credit=post.querySelector('[slot="credit-bar"]');
    return [...(credit?credit.querySelectorAll('a,span'):post.querySelectorAll('[slot="authorName"],.author'))].find(el=>el.childElementCount===0 && deletedLabel.test(el.textContent.trim()) && !el.closest('[data-rt-source],[data-rt-archived-author]'));
  };
  const commentAuthorLabel=comment=>{const label=comment.querySelector('.author-name-meta span[dir],[slot="commentMeta"] span[dir]');return label && label.closest('shreddit-comment')===comment && label.textContent.trim()==='[deleted]'?label:null;};
  // A [deleted] author being looked up: CSS draws a skeleton pill inside the label's own box, so nothing
  // moves when it resolves. Only ever removed to show the restored author or Reddit's plain [deleted].
  const pendingAuthor='data-rt-author-pending';
  const unmarkAuthor=label=>label?.removeAttribute(pendingAuthor);
  async function readSettings(){return (await send({action:'get-settings'})).settings;}
  const signedIn=()=>{const app=document.querySelector('shreddit-app');return Boolean(app && app.getAttribute('user-logged-in')!=='false' && (app.getAttribute('user-logged-in')==='true' || app.hasAttribute('logged-in-user-id')));};
  // An account that blocked the reader looks deleted on a post page; Reddit's signed-out view shows it.
  const blockedLabel=author=>'u/'+author+' has blocked you · Shown from Reddit’s signed-out view';
  class ThreadRestore {
    constructor({archive=send,reddit=(...args)=>globalThis.RTPostDiscovery?.redditRead?.(...args),settings=readSettings,observe=true,retryMs=15000,pendingMs=5000}={}){
      this.reddit=reddit;this.avatars=new Map();this.sharePatches=new Map();this.shareComments=new WeakSet();this.retryAt=0;this.archive=archive;this.retryMs=retryMs;this.settings=null;this.postId='';this.patches=new Map();this.requested=new Set();this.queue=new Set();this.attempts=new Map();this.timer=null;this.pendingMs=pendingMs;this.records=new Map();this.done=new Set();this.shown=new Set();this.holdTimers=new Set();this.timed=new WeakSet();this.checked=new WeakSet();this.postAuthors=new Map();this.signedOutQueue=new Set();this.signedOutAsked=new Set();this.signedOutPending=new Set();
      if(observe){
        // Only added elements can bring new comments or a new post.
        this.observer=new MutationObserver(records=>{if(records.some(r=>r.type==='attributes'?(r.target.matches('shreddit-post') || r.attributeName==='data-rt-community-filtered'):!this.ownsMutation(r) && [...r.addedNodes].some(node=>node.nodeType===1)))this.schedule();});
        this.observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['author','is-author-deleted','data-rt-community-filtered']});
        this.onRoute=()=>this.schedule();window.addEventListener('popstate',this.onRoute);document.addEventListener('reddit:route',this.onRoute);
        this.onMessage=(message,sender)=>{if(message?.scope==='rt-posts' && message.action==='settings-changed' && sender?.id===chrome.runtime.id)this.setSettings(message.settings);};chrome.runtime.onMessage?.addListener(this.onMessage);
      }
      this.ready=Promise.resolve().then(settings).then(value=>this.setSettings(value),()=>this.setSettings(null));
    }
    setSettings(value){this.settings=value?M.normalizeSettings(value):null;if(!this.active()){this.restoreAll();this.requested.clear();this.queue.clear();this.postAuthors.clear();this.signedOutQueue.clear();this.signedOutAsked.clear();}this.syncRootFlag();this.scan();}
    // Lets CSS show a skeleton (instead of Reddit's removal title) before scripts finish.
    syncRootFlag(){if(globalThis.RTProfileNoticeGuard?.setRestoreEnabled)RTProfileNoticeGuard.setRestoreEnabled(this.active());else document.documentElement.toggleAttribute('data-rt-restore',this.active() && Boolean(postIdOf()));}
    enabled(){const s=this.settings;return Boolean(s?.postDiscovery && s.archiveDiscovery && s.restoreDeletedContent);}
    // Accounts that blocked the reader: checked against Reddit's signed-out view, archive or not.
    signedOutEnabled(){const s=this.settings;return Boolean(s?.postDiscovery && s.blockedProfiles!==false) && signedIn();}
    active(){return this.enabled() || this.signedOutEnabled();}
    // Where a [deleted]-looking comment is asked first: Reddit's signed-out view, then the archive.
    want(id){
      if(this.signedOutEnabled() && !this.signedOutAsked.has(id)){this.signedOutQueue.add(id);return true;}
      if(this.enabled()){this.queue.add(id);return true;}
      return false;
    }
    ownsMutation(record){return [...record.addedNodes,...record.removedNodes].every(node=>node.nodeType===1 && (node.dataset?.rtRecoveredText || node.dataset?.rtSource)) && record.addedNodes.length+record.removedNodes.length>0;}
    schedule(){if(this.timer)return;this.timer=setTimeout(()=>{this.timer=null;this.scan();},200);}
    scan(){
      const postId=postIdOf();
      if(postId!==this.postId){clearTimeout(this.retryTimer);this.retryAt=0;this.restoreAll();this.requested.clear();this.queue.clear();this.attempts.clear();this.signedOutQueue.clear();this.signedOutAsked.clear();this.signedOutPending.clear();this.postId=postId;this.postState=null;this.syncRootFlag();}
      if(!this.active())return;
      if(!postId)return this.enabled()?this.scanFeedAuthors():undefined;
      this.restorePost();
      for(const comment of document.querySelectorAll('main shreddit-comment[thingid]')){
        // Archived reader text is a snapshot, not current Reddit deletion evidence.
        if(comment.closest('[data-rt-ui="archive-thread-comment"],[data-rt-ui="archive-subreddit"]'))continue;
        const id=comment.getAttribute('thingid').toLowerCase(),post=comment.getAttribute('postid')?.toLowerCase();
        // Comments already examined (no notice) are not re-read on every change.
        if(!/^t1_[a-z0-9]{1,32}$/.test(id))continue;
        if(post && post!=='t3_'+postId){comment.setAttribute('data-rt-settled','');continue;}
        if(this.shareComments.has(comment) || this.requested.has(id))this.restoreShare(comment,id);
        // Reddit can re-create an answered comment: restore it again from the kept record, with no new request.
        if(this.done.has(id)){if(!this.checked.has(comment)){this.reapply(id,comment);this.settleNode(comment);}continue;}
        // Asked of the signed-out view and not answered yet: the archive must not answer first.
        if(this.requested.has(id) || this.signedOutQueue.has(id) || this.signedOutPending.has(id) || this.checked.has(comment)){
          // Re-created by Reddit while its author is still being asked: the same skeleton, within the same limit.
          if(!this.checked.has(comment) && !this.noticeParagraph(comment) && authorGone(comment)){this.holdAuthor(comment,id);this.checked.add(comment);}
          continue;
        }
        if(M.domStatus(comment)){this.shareComments.add(comment);this.restoreShare(comment,id);}
        // Skeleton instead of Reddit's notice while the archive is asked.
        const notice=this.noticeParagraph(comment);
        if(!notice){
          // A deleted account keeps its text but shows [deleted] as the author: ask for the author only (same
          // batched request). The text is already there, so only the author slot shows a skeleton.
          if(authorGone(comment)){if(this.want(id))this.holdAuthor(comment,id);this.checked.add(comment);continue;}
          comment.setAttribute('data-rt-settled','');this.checked.add(comment);continue;
        }
        if(!this.want(id)){comment.setAttribute('data-rt-settled','');this.checked.add(comment);continue;}
        // Already waited the visible limit once: show Reddit's notice, keep trying quietly.
        if(this.shown.has(id)){this.settleNode(comment);continue;}
        notice.dataset.rtNotice='true';notice.dataset.rtHold='';comment.setAttribute('data-rt-pending','');
        if(![...comment.querySelectorAll('[data-rt-skeleton]')].some(n=>n.closest('shreddit-comment')===comment)){const skeleton=globalThis.RTArchiveView?.skeleton({lines:2});if(skeleton)notice.after(skeleton);}
        if(!this.timed.has(comment)){this.timed.add(comment);this.later(()=>{if(comment.hasAttribute('data-rt-pending') && !this.done.has(id)){this.shown.add(id);this.settleNode(comment);}});}
      }
      this.flushSignedOut();
      return this.flush();
    }
    // Comments that look deleted, asked of Reddit's signed-out view ten at a time. What it shows with a live
    // author is an account that blocked the reader; the rest go on to the archive when that is enabled.
    async flushSignedOut(){
      if(this.signedOutFlushing || !this.signedOutQueue.size)return;this.signedOutFlushing=true;const postId=this.postId;
      try{
        while(this.signedOutQueue.size && postId===this.postId && this.signedOutEnabled()){
          const ids=[...this.signedOutQueue].slice(0,10);for(const id of ids){this.signedOutQueue.delete(id);this.signedOutAsked.add(id);this.signedOutPending.add(id);}
          let result=null;
          try{result=await this.reddit({action:'blocked-thread-items',postId,ids});}catch{}
          for(const id of ids)this.signedOutPending.delete(id);
          if(postId!==this.postId)return;
          const found=new Set(),nodes=this.commentNodes(ids);
          for(const raw of result?.comments || []){
            const id='t1_'+String(raw?.id || '').toLowerCase();if(!ids.includes(id) || !M.validateUsername(raw.author) || typeof raw.body!=='string' || !raw.body.trim())continue;
            const record={id:raw.id.toLowerCase(),author:raw.author,body:raw.body,bodyHtml:typeof raw.bodyHtml==='string'?raw.bodyHtml:'',avatar:raw.avatar,source:'signed-out'};
            found.add(id);this.remember(record);this.done.add(id);
            const avatar=safeAvatar(raw.avatar);if(avatar && !this.avatars.has(raw.author.toLowerCase()))this.avatars.set(raw.author.toLowerCase(),avatar);
            for(const node of nodes.get(id) || [])try{this.apply(record,node);this.settleNode(node);}catch{}
          }
          for(const id of ids){
            if(found.has(id))continue;
            if(this.enabled())this.queue.add(id);
            else{this.done.add(id);for(const node of nodes.get(id) || [])this.settleNode(node);}
          }
        }
      }finally{this.signedOutFlushing=false;}
      if(postId===this.postId)this.flush();
    }
    // Visible pending states last at most pendingMs; CSS has its own longer fail-safe.
    later(fn){const timer=setTimeout(()=>{this.holdTimers.delete(timer);fn();},this.pendingMs);this.holdTimers.add(timer);}
    commentNode(id){return [...document.querySelectorAll('main shreddit-comment[thingid]')].find(node=>node.getAttribute('thingid').toLowerCase()===id);}
    commentNodes(ids){const wanted=new Set(ids),found=new Map();for(const node of document.querySelectorAll('main shreddit-comment[thingid]')){const id=node.getAttribute('thingid').toLowerCase();if(wanted.has(id)){if(!found.has(id))found.set(id,[]);found.get(id).push(node);}}return found;}
    // The comment's own body paragraph showing Reddit's deletion notice.
    noticeParagraph(comment){return M.noticeParagraph(comment);}
    // Skeleton in a deleted account's author slot while it is asked, for at most pendingMs: after that
    // Reddit's plain [deleted] shows (a later answer still restores the author).
    holdAuthor(comment,id){
      const label=commentAuthorLabel(comment);if(!label || this.shown.has(id) || label.hasAttribute(pendingAuthor))return;
      label.setAttribute(pendingAuthor,'');
      this.later(()=>{if(label.hasAttribute(pendingAuthor)){this.shown.add(id);unmarkAuthor(label);}});
    }
    // End a comment's pending look: skeleton, held notice and masks go; Reddit's content shows.
    settleNode(node){
      for(const label of node.querySelectorAll('['+pendingAuthor+']'))if(label.closest('shreddit-comment')===node)unmarkAuthor(label);
      for(const skeleton of node.querySelectorAll('[data-rt-skeleton]'))if(skeleton.closest('shreddit-comment')===node)skeleton.remove();
      for(const held of node.querySelectorAll('[data-rt-hold]'))if(held.closest('shreddit-comment')===node)held.removeAttribute('data-rt-hold');
      node.removeAttribute('data-rt-pending');node.setAttribute('data-rt-settled','');this.checked.add(node);
    }
    reapply(id,node){const record=this.records.get(id);if(record)try{this.apply(record,node);}catch{}}
    // Keep what the archive answered (bounded) so a re-created element is restored synchronously.
    remember(archived){
      if(!(Boolean(archived.body?.trim()) && !M.noticeStatus(archived.body.trim()) || M.validateUsername(archived.author)))return;
      if(this.records.size>=500)this.records.delete(this.records.keys().next().value);
      this.records.set('t1_'+archived.id,archived);
    }
    async flush(){
      if(this.flushing || !this.queue.size || Date.now()<this.retryAt)return;this.flushing=true;const postId=this.postId;
      try{
        while(this.queue.size && postId===this.postId && this.enabled()){
          const ids=[...this.queue].slice(0,100);for(const id of ids){this.queue.delete(id);this.requested.add(id);}
          // Every asked id always settles, whatever happens to one record.
          const settle=()=>{if(postId!==this.postId)return;const nodes=this.commentNodes(ids);for(const id of ids){this.done.add(id);for(const node of nodes.get(id) || [])this.settleNode(node);}
            // Nothing restored for the permalinked comment: Reddit's own toast plays (a no-op once resolved).
            const linked='t1_'+(globalThis.RTProfileNoticeGuard?.permalinkComment?.() || '');if(ids.includes(linked))globalThis.RTProfileNoticeGuard.resolveCommentAlert(linked,'');};
          let result;
          try{result=await this.archive({action:'archive-comments',postId,ids});}
          catch(error){
            // Rate limits and timeouts retry later; anything else leaves Reddit's notice in place.
            const attempts=(this.attempts.get(postId) || 0)+1;
            if(retryable(error?.code) && attempts<=3){
              this.attempts.set(postId,attempts);for(const id of ids){this.requested.delete(id);this.queue.add(id);}
              const wait=Math.max(this.retryMs*attempts,Number.isFinite(error.retryAt)?error.retryAt-Date.now()+500:0);
              this.retryAt=Date.now()+wait;clearTimeout(this.retryTimer);this.retryTimer=setTimeout(()=>{this.retryAt=0;if(postId===this.postId)this.flush();},wait);
              return;
            }
            settle();continue;
          }
          if(postId!==this.postId || !this.enabled())return;
          try{
            const asked=new Set(ids),nodes=this.commentNodes(ids);
            for(const raw of result?.posts || []){
              try{
                const comment=M.normalizeComment(raw,{source:'arctic-shift'});
                if(!comment || comment.linkId!==postId || !asked.has('t1_'+comment.id))continue;
                this.remember(comment);
                for(const node of nodes.get('t1_'+comment.id) || [])try{this.apply(comment,node);}catch{}
              }catch{}
            }
          }catch{}finally{settle();}
        }
      }finally{this.flushing=false;}
    }
    apply(archived,comment=this.commentNode('t1_'+archived.id)){
      // A snapshot taken after deletion has no text (or only Reddit's own notice), but still names the author.
      const text=archived.body?.trim(),hasText=Boolean(text) && !M.noticeStatus(text),author=M.validateUsername(archived.author)?archived.author:'';
      if(!hasText && !author)return;
      if(!comment)return;
      const p=this.noticeParagraph(comment);
      // Author only: the text is intact (a deleted account), so only the name changes.
      if(!p){if(!author || !authorGone(comment) || this.patches.has(comment))return;const patch={original:[],comment,body:comment,authorOnly:true};this.patches.set(comment,patch);this.restoreAuthor(comment,author,patch,archived.source==='signed-out'?'signed-out':'archive');return;}
      const body=p.parentElement;if(!body || this.patches.has(body))return;
      const blocked=archived.source==='signed-out',status=blocked?'blocked':M.noticeStatus(p.textContent) || 'deleted',cue=cueOf(status,p.textContent);
      this.patches.set(body,{original:[...body.childNodes],comment,body});
      if(hasText){
      // Reuse Reddit's own comment-body classes from a normal comment on this page.
      const sample=[...document.querySelectorAll('main shreddit-comment [id$="-post-rtjson-content"]')].find(node=>!node.closest('[data-rt-recovered-text]'));
      const recovered=make('div',(sample?.className || 'md text-14')+' rt-recovered-md');recovered.dataset.rtRecoveredText='true';
      const post=comment.closest('main')?.querySelector('shreddit-post[id="t3_'+this.postId+'"]');
      const restricted=archived.over18 || archived.spoiler || comment.matches('[nsfw],[spoiler],[is-nsfw],[over-18]') || post?.matches('[nsfw],[spoiler],[is-nsfw],[over-18]') || Boolean(comment.querySelector('shreddit-content-gate,[slot="nsfw-blocker"]') || post?.querySelector('shreddit-content-gate,[slot="nsfw-blocker"]'));
      const rendered=globalThis.RTMarkdown?.renderComment(text,archived.bodyHtml,archived.media,{restricted});
      if(rendered)recovered.append(rendered);else for(const part of text.split(/\n{2,}/)){const para=make('p','',part);para.style.whiteSpace='pre-wrap';recovered.append(para);}
      const pClass=sample?.querySelector('p')?.className;if(pClass)for(const para of recovered.querySelectorAll(':scope > p'))para.className=pClass;
      body.replaceChildren(recovered);
      // Reddit collapses deleted comments; open restored ones so the text is visible.
      const details=comment.querySelector(':scope > details');if(details && !details.open){details.open=true;this.patches.get(body).opened=details;}
      }
      const meta=comment.querySelector('[slot="commentMeta"]');
      if(meta && !meta.querySelector('[data-rt-source]')){
        const when=archived.retrieved?' from '+new Date(archived.retrieved*1000).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}):'';
        const by=M.validateUsername(archived.author)?' · Originally posted by u/'+archived.author:'';
        const label=blocked?blockedLabel(archived.author):cue+' · '+(hasText?'Text from an Arctic Shift snapshot'+when:'The Arctic Shift snapshot has no text')+by;
        const badge=this.labelBadge(this.makeBadge(status,'rt-post-indicator rt-thread-indicator'),label);
        (meta.querySelector('shreddit-comment-badges')?.parentElement || meta).append(badge);
        this.patches.get(body).badge=badge;
      }
      if(author)this.restoreAuthor(comment,author,this.patches.get(body),blocked?'signed-out':'archive');
      // On this comment's own permalink, Reddit's "no longer exists" toast now says where the text came from.
      if(hasText)globalThis.RTProfileNoticeGuard?.resolveCommentAlert?.(archived.id,status);
    }
    // Status cue: keyboard focusable, named for assistive tech, glyph or (if the glyph
    // is unavailable) a short text mark instead of an empty box.
    makeBadge(status,cls){
      const badge=make('span',cls);badge.dataset.rtSource='true';badge.dataset.state=status;
      const icon=globalThis.RTPostDiscovery?.glyph?.(status==='removed'?'removed':status==='blocked'?'hidden':'deleted');
      if(icon)badge.append(icon);else{const mark=make('span','rt-badge-fallback','i');mark.setAttribute('aria-hidden','true');badge.append(mark);}
      return badge;
    }
    labelBadge(badge,label){badge.removeAttribute('data-rt-reserved');badge.removeAttribute('aria-hidden');badge.setAttribute('role','img');badge.tabIndex=0;badge.setAttribute('aria-label',label);badge.title=label;return badge;}
    // Show the archived author where Reddit shows [deleted], built like a
    // native comment author: a nameplate profile link and Reddit's avatar
    // markup (snoovatar headshot on the avatar gradient, or a plain rounded
    // image). A dotted underline and tooltip mark the identity as archived.
    restoreAuthor(comment,author,patch,source='archive'){
      const where=source==='signed-out'?'Reddit’s signed-out view':'an Arctic Shift snapshot';
      const label=comment.querySelector('.author-name-meta span[dir],[slot="commentMeta"] span[dir]');
      if(label && label.textContent.trim()==='[deleted]' && !patch.author){
        const link=make('a','truncate font-bold text-neutral-content-strong text-12 focus-visible:-outline-offset-1 hover:underline rt-archived-author');link.href='https://www.reddit.com/user/'+author+'/';link.dir='auto';link.dataset.rtArchivedAuthor='true';link.setAttribute('aria-label','u/'+author+(source==='signed-out'?' (signed-out view)':' (from archive)'));link.title='Author from '+where;
        const plate=make('span','inline-flex items-center max-w-full whitespace-nowrap');plate.dir='auto';plate.dataset.testid='nameplate';plate.append(make('span','truncate',author));link.append(plate);
        unmarkAuthor(label);patch.author={label,link};label.replaceWith(link);
        // Reddit opens its profile card from an author-hovercard-trigger, for the comment's author
        // attribute. Give the restored name both, so its card shows like a native author's.
        if(!link.closest('.author-hovercard-trigger')){const trigger=make('span','author-hovercard-trigger cursor-pointer');link.replaceWith(trigger);trigger.append(link);patch.author.trigger=trigger;}
        if(comment.getAttribute('author')==='[deleted]'){patch.author.attribute={comment,value:'[deleted]'};comment.setAttribute('author',author);}
      }
      const slot=comment.querySelector('[slot="commentAvatar"]');if(!slot || patch.avatar)return;
      const show=url=>{
        url=safeAvatar(url);
        if(!url || !slot.isConnected || patch.avatar || this.patches.get(patch.body)!==patch)return;
        const anchor=make('a','flex items-center mt-2xs');anchor.href='https://www.reddit.com/user/'+author+'/';anchor.setAttribute('aria-label',author+"'s profile --- avatar");anchor.title='Profile picture of u/'+author;
        const holder=make('span','inline-flex items-center justify-center w-xl h-xl relative');holder.setAttribute('rpl','');holder.setAttribute('avatar','');
        const img=make('img','h-full w-full');img.src=url;img.alt='u/'+author+' avatar';img.loading='lazy';img.decoding='async';img.referrerPolicy='no-referrer';
        if(/snoovatar|-headshot/i.test(url)){
          const ring=make('span','inline-flex snoovatar relative fp-avatar-container rounded-full w-xl h-xl min-w-[2rem] min-h-[2rem] isolate box-content'),frame=make('span','absolute start-0 end-0 bottom-0 mx-auto inline-flex shrink-0 justify-center box-border h-full w-full');
          frame.append(make('span','rounded-full absolute h-full w-full inline-flex justify-center bg-[image:var(--color-avatar-gradient)]'));const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),defs=document.createElementNS(ns,'defs'),clip=document.createElementNS(ns,'clipPath'),path=document.createElementNS(ns,'path'),image=document.createElementNS(ns,'image'),clipId='rt-avatar-'+crypto.randomUUID();svg.setAttribute('viewBox','0 0 121 122');svg.setAttribute('class','overflow-hidden absolute bottom-0 w-xl h-xl');clip.id=clipId;path.setAttribute('d','M0 0V79L28.1628 105.5C35.013 115.465 46.4934 122 59.5 122C72.5066 122 83.987 115.465 90.8372 105.5L120.5 79V0H0Z');clip.append(path);defs.append(clip);image.setAttribute('href',url);image.setAttribute('alt','u/'+author+' avatar');image.setAttribute('clip-path','url(#'+clipId+')');image.setAttribute('height','100%');image.setAttribute('width','100%');svg.append(defs,image);frame.append(svg);ring.append(frame);holder.append(ring);
        }else{const round=make('span','inline-block rounded-full relative h-full w-full overflow-hidden');round.setAttribute('rpl','');round.append(img);holder.append(round);}
        anchor.append(holder);const row=make('div','flex flex-row items-center');row.append(anchor);
        patch.avatar={slot,original:[...slot.childNodes]};slot.replaceChildren(row);
      };
      slot.setAttribute('data-rt-avatar-pending','');this.later(()=>slot.removeAttribute('data-rt-avatar-pending'));
      const finish=url=>{show(url);if(slot.isConnected && this.patches.get(patch.body)===patch)slot.removeAttribute('data-rt-avatar-pending');};
      // Only a definitive answer (a picture, or "no picture") is cached; deferral or errors are retried next time.
      const key=author.toLowerCase();
      if(!this.avatars.has(key)){
        const lookup=(async()=>{for(let attempt=0;attempt<3;attempt++){try{const result=await this.reddit({action:'user-avatar',username:author});if(!result?.deferred)return {url:safeAvatar(result?.avatar),final:true};await new Promise(r=>setTimeout(r,Math.min(5000,result.retryAfterMs || 500)));}catch{return {url:'',final:false};}}return {url:'',final:false};})();
        const shared=lookup.then(answer=>{if(answer.final)this.avatars.set(key,answer.url);else if(this.avatars.get(key)===shared)this.avatars.delete(key);return answer.url;});
        if(this.avatars.size>=200)this.avatars.delete(this.avatars.keys().next().value);this.avatars.set(key,shared);
      }
      return Promise.resolve(this.avatars.get(key)).then(finish);
    }
    // Keep Reddit's native share menu; restore only its missing identity and
    // disabled trigger. The action row stays disabled for votes and replies.
    restoreShare(comment,id){
      const prefix=location.pathname.match(/^\/(?:r\/[^/]+\/|user\/[^/]+\/)?comments\/[a-z0-9]{1,10}/i)?.[0];if(!prefix)return;
      for(const share of comment.querySelectorAll('shreddit-comment-share-button')){
        if(share.closest('shreddit-comment')!==comment)continue;
        const save=(node,names)=>{if(!this.sharePatches.has(node))this.sharePatches.set(node,names.map(name=>[name,node.getAttribute(name)]));};
        save(share,['permalink','source-id','disabled']);const permalink=prefix+'/comment/'+id.slice(3)+'/';if(share.getAttribute('permalink')!==permalink)share.setAttribute('permalink',permalink);if(share.getAttribute('source-id')!==id)share.setAttribute('source-id',id);if(share.hasAttribute('disabled'))share.removeAttribute('disabled');
        for(const button of share.querySelectorAll('button[disabled],button[aria-disabled="true"]')){save(button,['disabled','aria-disabled']);button.removeAttribute('disabled');button.removeAttribute('aria-disabled');}
      }
    }
    // The open post itself: deleted/removed posts get their archived title,
    // formatted body and (image posts) image inside Reddit's own post element.
    restorePost(){
      const postId=this.postId,native=[...document.querySelectorAll('main shreddit-post[id="t3_'+postId+'"]')].find(node=>!node.closest('[data-rt-ui],shreddit-feed'));
      if(!native || document.documentElement.hasAttribute('data-rt-subreddit-archive'))return;
      const state=this.postState?.native===native?this.postState:(this.postState={native,status:M.domStatus(native) || (contentGone(native)?'deleted':null)});
      const {status}=state;
      // An account that blocked the reader: its post shows [deleted] without body or media. Ask Reddit's
      // signed-out view first; the archive is asked only when that shows no live author.
      if(state.signedOut==='pending' || state.signedOut==='found')return;
      if(!state.signedOut && !state.started && this.signedOutEnabled() && (authorGone(native) || postAuthorLabel(native))){
        state.signedOut='pending';native.setAttribute('data-rt-pending','');this.holdPostAuthor(state);
        const settle=()=>{if(this.postState===state){this.releasePostAuthor(state);native.removeAttribute('data-rt-pending');native.setAttribute('data-rt-settled','');}};
        this.later(()=>{if(state.signedOut==='pending')settle();});
        return Promise.resolve().then(()=>this.reddit({action:'blocked-thread-items',postId,post:true,ids:[]})).then(result=>{
          if(this.postState!==state)return;
          const found=result?.post;
          if(found && found.id===postId && M.validateUsername(found.author)){state.signedOut='found';this.applySignedOutPost(state,found);settle();return;}
          state.signedOut='none';native.removeAttribute('data-rt-pending');this.restorePost();
        },()=>{if(this.postState!==state)return;state.signedOut='none';native.removeAttribute('data-rt-pending');this.restorePost();});
      }
      if(!this.enabled()){if(state.signedOut==='none' || !this.signedOutEnabled()){this.releasePostAuthor(state);native.setAttribute('data-rt-settled','');}return;}
      if(state.started){this.applyPostAuthor(state);return;}
      if(!status){
        // A deleted account's post keeps its content; only its [deleted] author is looked up, with no deletion cues.
        if(!authorGone(native) && !postAuthorLabel(native)){native.setAttribute('data-rt-settled','');return;}
        state.started=true;
        if(this.postAuthors.has(postId)){
          state.archivedAuthor=this.postAuthors.get(postId);this.applyPostAuthor(state);this.releasePostAuthor(state);native.setAttribute('data-rt-settled','');return;
        }
        this.holdPostAuthor(state);
        return this.lookupPost(postId,state).then(result=>{
          if(this.postState!==state || !this.enabled())return;
          const found=(result?.posts || []).map(raw=>M.normalizePost(raw,{source:'arctic-shift'})).find(post=>post?.id===postId);
          state.archivedAuthor=M.validateUsername(found?.author)?found.author:null;
          this.cachePostAuthor(postId,state.archivedAuthor);this.applyPostAuthor(state);
        }).catch(()=>{}).finally(()=>{if(this.postState===state){this.releasePostAuthor(state);native.setAttribute('data-rt-settled','');}});
      }
      state.started=true;
      native.setAttribute('data-rt-pending','');this.holdPostAuthor(state);
      // What Reddit's own notice says decides whether the cue may name the author.
      const reason=[native.getAttribute('post-title'),native.querySelector('[slot="title"]')?.textContent,...[...native.querySelectorAll('[slot="post-removed-banner"],[slot="text-body"] p')].map(node=>node.textContent)].join(' ');
      // Skeleton lines where the body goes while the archive is asked.
      const skeleton=globalThis.RTArchiveView?.skeleton({lines:3});if(skeleton){native.append(skeleton);for(const slot of ['text-body','post-recovery-section','post-removed-banner']){skeleton.slot=slot;if(!native.shadowRoot || skeleton.assignedSlot)break;}}
      state.skeleton=skeleton;
      // The cue's space is reserved now (invisible) so the credit bar does not shift when it appears.
      const badge=state.reserved=this.makeBadge(status,'rt-post-indicator');badge.dataset.rtReserved='true';badge.setAttribute('aria-hidden','true');
      const credit=native.querySelector('[slot="credit-bar"]') || native;let actions=credit.querySelector('shreddit-post-overflow-menu');while(actions && actions.parentElement!==credit)actions=actions.parentElement;
      if(actions)actions.prepend(badge);else{badge.style.marginInlineStart='auto';credit.append(badge);}
      const settle=()=>{skeleton?.remove();this.releasePostAuthor(state);native.removeAttribute('data-rt-pending');native.setAttribute('data-rt-settled','');};
      this.later(()=>{if(this.postState===state)settle();});
      return this.lookupPost(postId,state).then(result=>{
        if(this.postState!==state || !this.enabled())return;
        const found=(result?.posts || []).map(raw=>M.normalizePost(raw,{source:'arctic-shift'})).find(post=>post?.id===postId);
        const author=native.getAttribute('author') || '',archived=found && (!author || author==='[deleted]' || author.toLowerCase()===found.author.toLowerCase())?found:null;
        const restricted=archived?.over18 || archived?.spoiler || native.matches('[nsfw],[spoiler],[is-nsfw],[over-18]') || Boolean(native.querySelector('shreddit-content-gate,[slot="nsfw-blocker"]'));
        const patch=state.patch={native,added:[],title:null,author:null};
        const title=native.querySelector('[slot="title"]');
        if(archived && title && archived.title && M.noticeStatus(title.textContent) && !M.noticeStatus(archived.title)){patch.title={node:title,original:[...title.childNodes]};const text=make('span','',archived.title);text.dataset.rtRecoveredText='true';title.replaceChildren(text);}
        const place=(node,slots)=>{native.append(node);patch.added.push(node);for(const slot of slots){node.slot=slot;if(!native.shadowRoot || node.assignedSlot)return;}if(native.shadowRoot && !node.assignedSlot)node.removeAttribute('slot');};
        const text=archived?.body?.trim();
        if(!restricted && text && !M.noticeStatus(text) && !native.querySelector('[slot="text-body"] [data-rt-recovered-text]')){
          const body=make('div','md text-14 pb-xs rt-recovered-md');body.dataset.rtRecoveredText='true';
          const rendered=globalThis.RTMarkdown?.fromHtml(archived.bodyHtml) || globalThis.RTMarkdown?.render(text);if(rendered)body.append(rendered);else body.append(make('p','',text));
          place(body,['text-body','post-recovery-section','post-removed-banner']);
        }
        if(!restricted && archived?.media?.length && !native.querySelector('[slot="post-media-container"] img,[slot="post-media-container"] video')){
          const subreddit=native.getAttribute('subreddit-prefixed-name') || '',alt=(subreddit?subreddit+' - ':'')+(archived.title || '');
          let figure=globalThis.RTArchiveView?.media(archived.media,{alt,postId:archived.id});
          // Minimal fallback for environments where the shared view is unavailable.
          if(!figure){const safe=archived.media.filter(item=>M.mediaUrl(item.url));if(safe.length){figure=make('div','rt-archive-media-group rt-archived-media');figure.dataset.rtRecoveredText='true';for(const item of safe){const img=make('img');img.src=M.mediaUrl(item.url);img.alt=alt;img.loading='lazy';img.referrerPolicy='no-referrer';if(item.kind!=='image'){img.className='rt-archive-link-thumbnail';img.style.cssText='width: 140px; height: 100px; object-fit: cover;';}figure.append(img);}}}
          if(figure)place(figure,['post-media-container','text-body','post-recovery-section']);
        }
        // Deleted posts show [deleted] as their author; the snapshot still names them.
        if(archived && M.validateUsername(archived.author)){state.archivedAuthor=archived.author;this.cachePostAuthor(postId,archived.author);this.applyPostAuthor(state);}
        // The status cue always shows, even when the snapshot adds nothing else.
        const when=archived?.retrieved?' from '+new Date(archived.retrieved*1000).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}):'';
        const restored=Boolean(patch.title || patch.added.length);
        const detail=!archived?'Not in the Arctic Shift archive':restored?'Restored from an Arctic Shift snapshot'+when:'The Arctic Shift snapshot has nothing more'+when;
        const label=cueOf(status,reason)+' · '+detail+(archived && M.validateUsername(archived.author)?' · Originally posted by u/'+archived.author:'');
        this.labelBadge(badge,label);patch.added.push(badge);state.reserved=null;
      }).catch(()=>{}).finally(()=>{if(this.postState===state){state.reserved?.remove();settle();}});
    }
    // Fill a blocked account's post from Reddit's signed-out view: its author, its text and its media, inside
    // Reddit's own post element, with a cue saying where they came from.
    applySignedOutPost(state,post){
      const {native}=state,patch=state.patch ||= {native,added:[],title:null,author:null};
      const place=(node,slots)=>{native.append(node);patch.added.push(node);for(const slot of slots){node.slot=slot;if(!native.shadowRoot || node.assignedSlot)return;}if(native.shadowRoot && !node.assignedSlot)node.removeAttribute('slot');};
      const restricted=native.matches('[nsfw],[spoiler],[is-nsfw],[over-18]') || Boolean(native.querySelector('shreddit-content-gate,[slot="nsfw-blocker"]'));
      const text=typeof post.body==='string'?post.body.trim():'';
      // Like restorePost: an NSFW or spoiler post's text stays behind Reddit's own gate.
      if(!restricted && text && !M.noticeStatus(text) && !native.querySelector('[slot="text-body"] [data-rt-recovered-text]')){
        const body=make('div','md text-14 pb-xs rt-recovered-md');body.dataset.rtRecoveredText='true';
        const rendered=globalThis.RTMarkdown?.fromHtml(post.bodyHtml) || globalThis.RTMarkdown?.render(text);if(rendered)body.append(rendered);else body.append(make('p','',text));
        place(body,['text-body','post-recovery-section','post-removed-banner']);
      }
      if(!restricted && Array.isArray(post.media) && post.media.length && !native.querySelector('[slot="post-media-container"] img,[slot="post-media-container"] video,[data-rt-recovered-text].rt-archive-media-group')){
        const subreddit=native.getAttribute('subreddit-prefixed-name') || '',alt=(subreddit?subreddit+' - ':'')+(post.title || native.getAttribute('post-title') || '');
        let figure=globalThis.RTArchiveView?.media(post.media,{alt,postId:post.id,href:post.url});
        if(!figure){const safe=post.media.map(item=>M.mediaUrl(item.kind==='video'?item.poster:item.url)).filter(Boolean);if(safe.length){figure=make('div','rt-archive-media-group rt-archived-media');figure.dataset.rtRecoveredText='true';for(const url of safe){const img=make('img');img.src=url;img.alt=alt;img.loading='lazy';img.referrerPolicy='no-referrer';figure.append(img);}}}
        if(figure)place(figure,['post-media-container','text-body','post-recovery-section']);
      }
      state.archivedAuthor=post.author;this.cachePostAuthor(state.native.id.slice(3).toLowerCase(),post.author);
      if(!patch.author?.link.isConnected)patch.author=this.restorePostAuthor(native,post.author,'signed-out');
      const badge=this.labelBadge(this.makeBadge('blocked','rt-post-indicator'),blockedLabel(post.author));
      const credit=native.querySelector('[slot="credit-bar"]') || native;let actions=credit.querySelector('shreddit-post-overflow-menu');while(actions && actions.parentElement!==credit)actions=actions.parentElement;
      if(actions)actions.prepend(badge);else{badge.style.marginInlineStart='auto';credit.append(badge);}
      patch.added.push(badge);
    }
    // The post header's [deleted] author while the signed-out view, then the archive, is asked: one skeleton
    // for both, shown at most pendingMs in all.
    holdPostAuthor(state){
      if(state.authorShown)return;
      const label=postAuthorLabel(state.native);if(!label)return;
      if(state.authorLabel!==label)unmarkAuthor(state.authorLabel);state.authorLabel=label;
      if(label.hasAttribute(pendingAuthor))return;label.setAttribute(pendingAuthor,'');
      this.later(()=>{if(this.postState===state && label.hasAttribute(pendingAuthor)){state.authorShown=true;this.releasePostAuthor(state);}});
    }
    releasePostAuthor(state){unmarkAuthor(state.authorLabel);state.authorLabel=null;}
    // The post's archive lookup retries transient failures, bounded like the comments'.
    async lookupPost(postId,state){
      for(let attempt=1;;attempt++){
        try{return await this.archive({action:'archive-ids',ids:[postId]});}
        catch(error){
          if(!retryable(error?.code) || attempt>3 || this.postState!==state || !this.enabled())throw error;
          const wait=Math.min(120000,Math.max(this.retryMs*attempt,Number.isFinite(error.retryAt)?error.retryAt-Date.now()+500:0));
          await new Promise(resolve=>setTimeout(resolve,wait));
          if(this.postState!==state || !this.enabled())throw error;
        }
      }
    }
    cachePostAuthor(id,author){
      if(this.postAuthors.size>=200 && !this.postAuthors.has(id))this.postAuthors.delete(this.postAuthors.keys().next().value);
      this.postAuthors.set(id,author);
    }
    applyPostAuthor(state){
      if(!state.archivedAuthor || state.patch?.author?.link.isConnected)return;
      const patch=state.patch ||= {native:state.native,added:[],title:null,author:null};
      patch.author=this.restorePostAuthor(state.native,state.archivedAuthor);
    }
    // Replace the post header's [deleted] author with the archived username,
    // keeping Reddit's element classes; the dotted underline marks it archived.
    restorePostAuthor(native,author,source='archive'){
      const label=postAuthorLabel(native);if(!label)return null;unmarkAuthor(label);
      const original=label.textContent,name=(original.trim().startsWith('u/')?'u/':'')+author;
      const accessible='u/'+author+(source==='signed-out'?' (signed-out view)':' (from archive)'),link=make('a',(label.className || '')+' rt-archived-author',name);
      link.href='https://www.reddit.com/user/'+author+'/';link.dataset.rtArchivedAuthor='true';link.title=source==='signed-out'?'Author from Reddit’s signed-out view':'Original author from an Arctic Shift snapshot';link.setAttribute('aria-label',accessible);
      link.addEventListener('click',event=>{
        if(event.button!==0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)return;
        const from=location.href;
        link.textContent=original;link.setAttribute('aria-label',original.trim());link.classList.remove('rt-archived-author');
        this.later(()=>{if(location.href===from && link.isConnected){link.textContent=name;link.setAttribute('aria-label',accessible);link.classList.add('rt-archived-author');}});
      });
      label.replaceWith(link);return {label,link};
    }
    scanFeedAuthors(){
      const subreddit=M.filteredCommunity(new URL(location.href));
      if(this.feedAuthors?.subreddit!==subreddit)this.clearFeedAuthors();
      if(!subreddit || document.documentElement.hasAttribute('data-rt-subreddit-archive'))return;
      const feed=document.querySelector('main shreddit-feed');
      if(!feed)return;
      const reload=feed.getAttribute('reload-url');
      if(reload){
        const name=new URL(reload,location.href).searchParams.get('name');
        if(name && name.toLowerCase()!==subreddit)return;
      }
      if(!this.feedAuthors){
        const state=this.feedAuthors={subreddit,patches:new Map(),watching:new Set(),wanted:new Map(),timer:null,busy:false,pausedUntil:0};
        if(typeof IntersectionObserver==='function')state.observer=new IntersectionObserver(entries=>{
          for(const {target,isIntersecting} of entries)if(isIntersecting && this.feedPostVisible(target)){
            state.observer.unobserve(target);state.watching.delete(target);state.wanted.set(target.id.slice(3).toLowerCase(),target);
          }
          this.scheduleFeedAuthors(state);
        },{rootMargin:'400px 0px'});
      }
      const state=this.feedAuthors;
      for(const post of state.watching)if(!post.isConnected){state.observer.unobserve(post);state.watching.delete(post);}
      for(const [post,patch] of state.patches)if(!post.isConnected || !patch.link.isConnected){
        if(patch.link.parentNode)patch.link.replaceWith(patch.label);
        state.patches.delete(post);
      }
      for(const post of feed.querySelectorAll('shreddit-post[id^="t3_"]')){
        if(!this.feedPostVisible(post) || state.patches.has(post) || !postAuthorLabel(post))continue;
        const name=post.getAttribute('subreddit-name') || post.getAttribute('subreddit-prefixed-name');
        if(name && name.replace(/^r\//i,'').toLowerCase()!==subreddit)continue;
        const id=post.id.slice(3).toLowerCase();if(!M.validateId(id))continue;
        if(this.postAuthors.has(id)){
          const author=this.postAuthors.get(id),patch=author && this.restorePostAuthor(post,author);if(patch)state.patches.set(post,patch);
        }else if(state.watching.has(post) || state.wanted.has(id))continue;
        else if(state.observer){state.watching.add(post);state.observer.observe(post);}
        else state.wanted.set(id,post);
      }
      if(!state.observer)return this.flushFeedAuthors(state);
    }
    feedPostVisible(post){return post.isConnected && !post.closest('[hidden],[inert],[data-rt-community-filtered],[data-rt-ui]');}
    scheduleFeedAuthors(state){
      if(this.feedAuthors!==state || !state.wanted.size || state.timer || state.busy)return;
      state.timer=setTimeout(()=>{state.timer=null;this.flushFeedAuthors(state);},Math.max(120,state.pausedUntil-Date.now()));
    }
    async flushFeedAuthors(state){
      if(this.feedAuthors!==state || !this.enabled() || state.busy || state.pausedUntil>Date.now() || M.filteredCommunity(new URL(location.href))!==state.subreddit)return;
      const ids=[],posts=new Map();
      for(const [id,post] of state.wanted){
        state.wanted.delete(id);
        if(this.feedPostVisible(post) && postAuthorLabel(post) && !this.postAuthors.has(id)){ids.push(id);posts.set(id,post);}
        if(ids.length===25)break;
      }
      if(!ids.length)return;
      state.busy=true;
      // Skeletons in the asked cards' author slots until the answer (or pendingMs).
      const labels=ids.map(id=>postAuthorLabel(posts.get(id))).filter(Boolean);for(const label of labels)label.setAttribute(pendingAuthor,'');
      const release=()=>{for(const label of labels)unmarkAuthor(label);};this.later(release);
      try{
        const result=await this.archive({action:'archive-feed-authors',subreddit:state.subreddit,ids});
        if(this.feedAuthors!==state || !this.enabled() || M.filteredCommunity(new URL(location.href))!==state.subreddit)return;
        if(result?.ok===false)throw result;
        for(const id of ids){const row=result.posts?.find(post=>post.id===id && post.subreddit?.toLowerCase()===state.subreddit && M.validateUsername(post.author));this.cachePostAuthor(id,row?.author || null);}
        this.scanFeedAuthors();
      }catch(error){state.pausedUntil=error?.retryAt || Date.now()+this.retryMs;}
      finally{release();state.busy=false;this.scheduleFeedAuthors(state);}
    }
    clearFeedAuthors(){
      const state=this.feedAuthors;if(!state)return;
      this.feedAuthors=null;state.observer?.disconnect();clearTimeout(state.timer);
      for(const {link,label} of state.patches.values())if(link.parentNode)link.replaceWith(label);
    }
    restoreAll(){
      this.clearFeedAuthors();
      clearTimeout(this.retryTimer);this.retryAt=0;for(const timer of this.holdTimers)clearTimeout(timer);this.holdTimers.clear();this.timed=new WeakSet();this.checked=new WeakSet();this.records.clear();this.done.clear();this.shown.clear();for(const [node,attrs] of this.sharePatches){for(const [name,value] of attrs)if(value===null)node.removeAttribute(name);else node.setAttribute(name,value);}this.sharePatches.clear();this.shareComments=new WeakSet();
      this.postState?.reserved?.remove();const post=this.postState?.patch;if(post){for(const node of post.added)node.remove();if(post.title)post.title.node.replaceChildren(...post.title.original);if(post.author?.link.isConnected)post.author.link.replaceWith(post.author.label);}
      if(this.postState?.native){this.postState.native.removeAttribute('data-rt-pending');this.postState.native.removeAttribute('data-rt-settled');}this.postState=null;
      for(const [body,patch] of this.patches){if(!patch.authorOnly && (body.isConnected || patch.original.length))body.replaceChildren(...patch.original);patch.badge?.remove();if(patch.opened)patch.opened.open=false;if(patch.author?.trigger?.isConnected)patch.author.trigger.replaceWith(patch.author.link);if(patch.author?.link.isConnected)patch.author.link.replaceWith(patch.author.label);if(patch.author?.attribute)patch.author.attribute.comment.setAttribute('author',patch.author.attribute.value);if(patch.avatar)patch.avatar.slot.replaceChildren(...patch.avatar.original);}
      this.patches.clear();
      for(const node of document.querySelectorAll('shreddit-comment[data-rt-pending],shreddit-comment[data-rt-settled]')){node.removeAttribute('data-rt-pending');node.removeAttribute('data-rt-settled');}
      for(const node of document.querySelectorAll('[data-rt-avatar-pending]'))node.removeAttribute('data-rt-avatar-pending');
      for(const node of document.querySelectorAll('[data-rt-notice]')){delete node.dataset.rtNotice;node.removeAttribute('data-rt-hold');}
      for(const node of document.querySelectorAll('main [data-rt-skeleton]'))node.remove();
      for(const label of document.querySelectorAll('['+pendingAuthor+']'))unmarkAuthor(label);
    }
    destroy(){this.observer?.disconnect();clearTimeout(this.timer);clearTimeout(this.retryTimer);window.removeEventListener('popstate',this.onRoute);document.removeEventListener('reddit:route',this.onRoute);chrome.runtime.onMessage?.removeListener?.(this.onMessage);this.restoreAll();}
  }
  globalThis.RTThreadRestore=Object.freeze({ThreadRestore,postIdOf});
  if(!globalThis.RTThreadRestoreDisabled)new ThreadRestore();
})();
