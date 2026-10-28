/* Post pages: show archived text for comments Reddit marks deleted or removed.
   Only comments Reddit itself labels deleted/removed are changed. Archive text
   is never proof of deletion, and it is shown with a cue naming its source.
   Requires the separate Arctic Shift and automatic-restoration preferences. */
(() => {
  'use strict';
  const M=globalThis.RTPostModel;if(!M || window.top!==window || !globalThis.chrome?.runtime?.id)return;
  const notice=/^(?:comment deleted by user|comment removed by moderator|\[deleted\]|\[removed\])$/i,placeholder=/^\[(?:deleted|removed)\]$/i;
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
  async function readSettings(){return (await send({action:'get-settings'})).settings;}
  class ThreadRestore {
    constructor({archive=send,reddit=(...args)=>globalThis.RTPostDiscovery?.redditRead?.(...args),settings=readSettings,observe=true,retryMs=15000}={}){
      this.reddit=reddit;this.avatars=new Map();this.sharePatches=new Map();this.shareComments=new WeakSet();this.retryAt=0;this.archive=archive;this.retryMs=retryMs;this.settings=null;this.postId='';this.patches=new Map();this.requested=new Set();this.queue=new Set();this.attempts=new Map();this.timer=null;
      if(observe){
        // Only added elements can bring new comments or a new post.
        this.observer=new MutationObserver(records=>{if(records.some(r=>!this.ownsMutation(r) && [...r.addedNodes].some(node=>node.nodeType===1)))this.schedule();});this.observer.observe(document.documentElement,{childList:true,subtree:true});
        this.onRoute=()=>this.schedule();window.addEventListener('popstate',this.onRoute);document.addEventListener('reddit:route',this.onRoute);
        this.onMessage=(message,sender)=>{if(message?.scope==='rt-posts' && message.action==='settings-changed' && sender?.id===chrome.runtime.id)this.setSettings(message.settings);};chrome.runtime.onMessage?.addListener(this.onMessage);
      }
      this.ready=Promise.resolve().then(settings).then(value=>this.setSettings(value),()=>this.setSettings(null));
    }
    setSettings(value){this.settings=value?M.normalizeSettings(value):null;if(!this.enabled()){this.restoreAll();this.requested.clear();this.queue.clear();}this.syncRootFlag();this.scan();}
    // Lets CSS show a skeleton (instead of Reddit's removal title) before scripts finish.
    syncRootFlag(){if(globalThis.RTProfileNoticeGuard?.setRestoreEnabled)RTProfileNoticeGuard.setRestoreEnabled(this.enabled());else document.documentElement.toggleAttribute('data-rt-restore',this.enabled() && Boolean(postIdOf()));}
    enabled(){const s=this.settings;return Boolean(s?.postDiscovery && s.archiveDiscovery && s.restoreDeletedContent);}
    ownsMutation(record){return [...record.addedNodes,...record.removedNodes].every(node=>node.nodeType===1 && (node.dataset?.rtRecoveredText || node.dataset?.rtSource)) && record.addedNodes.length+record.removedNodes.length>0;}
    schedule(){if(this.timer)return;this.timer=setTimeout(()=>{this.timer=null;this.scan();},200);}
    scan(){
      const postId=postIdOf();
      if(postId!==this.postId){clearTimeout(this.retryTimer);this.retryAt=0;this.restoreAll();this.requested.clear();this.queue.clear();this.attempts.clear();this.checked=new WeakSet();this.postId=postId;this.postState=null;this.syncRootFlag();}
      if(!postId || !this.enabled())return;
      this.restorePost();
      for(const comment of document.querySelectorAll('main shreddit-comment[thingid]')){
        const id=comment.getAttribute('thingid').toLowerCase(),post=comment.getAttribute('postid')?.toLowerCase();
        // Comments already examined (no notice) are not re-read on every change.
        if(!/^t1_[a-z0-9]{1,32}$/.test(id))continue;
        if(post && post!=='t3_'+postId){comment.setAttribute('data-rt-settled','');continue;}
        if(this.shareComments.has(comment) || this.requested.has(id))this.restoreShare(comment,id);
        if(this.requested.has(id) || this.checked?.has(comment))continue;
        if(M.domStatus(comment)){this.shareComments.add(comment);this.restoreShare(comment,id);}
        // Skeleton instead of Reddit's notice while the archive is asked.
        const notice=this.noticeParagraph(comment);if(notice){this.queue.add(id);notice.dataset.rtNotice='true';comment.setAttribute('data-rt-pending','');if(![...comment.querySelectorAll('[data-rt-skeleton]')].some(n=>n.closest('shreddit-comment')===comment)){const skeleton=globalThis.RTArchiveView?.skeleton({lines:2});if(skeleton)notice.after(skeleton);}}else{comment.setAttribute('data-rt-settled','');this.checked?.add(comment);}
      }
      return this.flush();
    }
    commentNode(id){return [...document.querySelectorAll('main shreddit-comment[thingid]')].find(node=>node.getAttribute('thingid').toLowerCase()===id);}
    // The comment's own body paragraph showing Reddit's deletion notice.
    noticeParagraph(comment){
      for(const p of comment.querySelectorAll('p')){
        if(p.closest('shreddit-comment')!==comment || p.closest('summary,[slot="actionRow"],[slot="commentMeta"],[data-rt-recovered-text]'))continue;
        if(notice.test(p.textContent.trim()))return p;
      }
      return null;
    }
    async flush(){
      if(this.flushing || !this.queue.size || Date.now()<this.retryAt)return;this.flushing=true;const postId=this.postId;
      try{
        while(this.queue.size && postId===this.postId && this.enabled()){
          const ids=[...this.queue].slice(0,100);for(const id of ids){this.queue.delete(id);this.requested.add(id);}
          let result;const settle=()=>{for(const id of ids){const node=this.commentNode(id);if(node){for(const skeleton of node.querySelectorAll('[data-rt-skeleton]'))if(skeleton.closest('shreddit-comment')===node)skeleton.remove();node.removeAttribute('data-rt-pending');node.setAttribute('data-rt-settled','');}}};
          try{result=await this.archive({action:'archive-comments',postId,ids});}
          catch(error){
            // Rate limits and timeouts retry later; anything else leaves Reddit's notice in place.
            const attempts=(this.attempts.get(postId) || 0)+1;
            if(['rate-limited','timeout','network-error','busy','http-error'].includes(error?.code) && attempts<=3){
              this.attempts.set(postId,attempts);for(const id of ids){this.requested.delete(id);this.queue.add(id);}
              const wait=Math.max(this.retryMs*attempts,Number.isFinite(error.retryAt)?error.retryAt-Date.now()+500:0);
              this.retryAt=Date.now()+wait;clearTimeout(this.retryTimer);this.retryTimer=setTimeout(()=>{this.retryAt=0;if(postId===this.postId)this.flush();},wait);
              return;
            }
            settle();continue;
          }
          if(postId!==this.postId || !this.enabled())return;
          for(const raw of result.posts || []){const comment=M.normalizeComment(raw,{source:'arctic-shift'});if(comment && comment.linkId===postId)this.apply(comment);}
          settle();
        }
      }finally{this.flushing=false;}
    }
    apply(archived){
      // A snapshot taken after deletion has no text, but still names the author.
      const text=archived.body?.trim(),hasText=Boolean(text) && !placeholder.test(text),author=M.validateUsername(archived.author)?archived.author:'';
      if(!hasText && !author)return;
      const comment=this.commentNode('t1_'+archived.id);if(!comment)return;
      const p=this.noticeParagraph(comment),body=p?.parentElement;if(!body || this.patches.has(body))return;
      const status=/removed/i.test(p.textContent)?'removed':'deleted';
      this.patches.set(body,{original:[...body.childNodes],comment,body});
      if(hasText){
      // Reuse Reddit's own comment-body classes from a normal comment on this page.
      const sample=[...document.querySelectorAll('main shreddit-comment [id$="-post-rtjson-content"]')].find(node=>!node.closest('[data-rt-recovered-text]'));
      const recovered=make('div',sample?.className || 'md text-14');recovered.dataset.rtRecoveredText='true';
      const rendered=globalThis.RTMarkdown?.fromHtml(archived.bodyHtml) || globalThis.RTMarkdown?.render(text);
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
        const label=(status==='removed'?'Removed by moderators':'Deleted by its author')+' on Reddit · '+(hasText?'Text from an Arctic Shift snapshot'+when:'The Arctic Shift snapshot has no text')+by;
        const badge=make('span','rt-post-indicator rt-thread-indicator');badge.dataset.rtSource='true';badge.dataset.state=status;badge.setAttribute('role','img');badge.setAttribute('aria-label',label);badge.title=label;
        const icon=globalThis.RTPostDiscovery?.glyph?.(status==='removed'?'removed':'deleted');if(icon)badge.append(icon);
        (meta.querySelector('shreddit-comment-badges')?.parentElement || meta).append(badge);
        this.patches.get(body).badge=badge;
      }
      if(author)this.restoreAuthor(comment,author,this.patches.get(body));
    }
    // Show the archived author where Reddit shows [deleted], built like a
    // native comment author: a nameplate profile link and Reddit's avatar
    // markup (snoovatar headshot on the avatar gradient, or a plain rounded
    // image). A dotted underline and tooltip mark the identity as archived.
    restoreAuthor(comment,author,patch){
      const label=comment.querySelector('.author-name-meta span[dir],[slot="commentMeta"] span[dir]');
      if(label && label.textContent.trim()==='[deleted]' && !patch.author){
        const link=make('a','truncate font-bold text-neutral-content-strong text-12 focus-visible:-outline-offset-1 hover:underline rt-archived-author');link.href='https://www.reddit.com/user/'+author+'/';link.dir='auto';link.dataset.rtArchivedAuthor='true';link.setAttribute('aria-label',author+"'s profile");link.title='Original author from an Arctic Shift snapshot';
        const plate=make('span','inline-flex items-center max-w-full whitespace-nowrap');plate.dir='auto';plate.dataset.testid='nameplate';plate.append(make('span','truncate',author));link.append(plate);
        patch.author={label,link};label.replaceWith(link);
      }
      const slot=comment.querySelector('[slot="commentAvatar"]');if(!slot || patch.avatar)return;
      const show=url=>{
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
      slot.setAttribute('data-rt-avatar-pending','');
      const finish=url=>{show(url);if(slot.isConnected && this.patches.get(patch.body)===patch)slot.removeAttribute('data-rt-avatar-pending');};
      const key=author.toLowerCase();if(this.avatars.has(key))return Promise.resolve(this.avatars.get(key)).then(finish);
      const lookup=(async()=>{for(let attempt=0;attempt<3;attempt++){try{const result=await this.reddit({action:'user-avatar',username:author});if(!result?.deferred)return result?.avatar || '';await new Promise(r=>setTimeout(r,Math.min(5000,result.retryAfterMs || 500)));}catch{return '';}}return '';})();
      this.avatars.set(key,lookup);lookup.then(url=>{this.avatars.set(key,url);finish(url);});
      return lookup;
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
      const postId=this.postId,native=[...document.querySelectorAll('main shreddit-post[id="t3_'+postId+'"]')].find(node=>!node.closest('[data-rt-ui]'));
      if(!native || this.postState?.native===native)return;
      const status=M.domStatus(native);this.postState={native,status};
      if(!status){native.setAttribute('data-rt-settled','');return;}
      native.setAttribute('data-rt-pending','');
      // Skeleton lines where the body goes while the archive is asked.
      const skeleton=globalThis.RTArchiveView?.skeleton({lines:3});if(skeleton){native.append(skeleton);for(const slot of ['text-body','post-recovery-section','post-removed-banner']){skeleton.slot=slot;if(!native.shadowRoot || skeleton.assignedSlot)break;}}
      const state=this.postState,settle=()=>{skeleton?.remove();native.removeAttribute('data-rt-pending');native.setAttribute('data-rt-settled','');};
      return Promise.resolve(this.archive({action:'archive-ids',ids:[postId]})).then(result=>{
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
        const image=archived?this.archivedImage(archived.url):'';
        if(!restricted && image && !native.querySelector('[slot="post-media-container"] img,[slot="post-media-container"] video')){
          const subreddit=native.getAttribute('subreddit-prefixed-name') || '',figure=globalThis.RTArchiveView?.image(image,{alt:(subreddit?subreddit+' - ':'')+(archived.title || '')}) || Object.assign(make('figure','rt-archived-media'),{innerHTML:''});
          if(!figure.querySelector('img')){figure.dataset.rtRecoveredText='true';const img=make('img');img.src=image;img.alt=archived.title || '';img.referrerPolicy='no-referrer';figure.append(img);}
          place(figure,['post-media-container','text-body','post-recovery-section']);
        }
        // Deleted posts show [deleted] as their author; the snapshot still names them.
        if(archived && M.validateUsername(archived.author))patch.author=this.restorePostAuthor(native,archived.author);
        // The status cue always shows, even when the snapshot adds nothing else.
        const when=archived?.retrieved?' from '+new Date(archived.retrieved*1000).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}):'';
        const restored=Boolean(patch.title || patch.added.length);
        const detail=!archived?'Not in the Arctic Shift archive':restored?'Restored from an Arctic Shift snapshot'+when:'The Arctic Shift snapshot has nothing more'+when;
        const label=(status==='removed'?'Removed by moderators':'Deleted by its author')+' on Reddit · '+detail+(archived && M.validateUsername(archived.author)?' · Originally posted by u/'+archived.author:'');
        const badge=make('span','rt-post-indicator');badge.dataset.rtSource='true';badge.dataset.state=status;badge.setAttribute('role','img');badge.setAttribute('aria-label',label);badge.title=label;
        const icon=globalThis.RTPostDiscovery?.glyph?.(status==='removed'?'removed':'deleted');if(icon)badge.append(icon);
        const credit=native.querySelector('[slot="credit-bar"]') || native;let actions=credit.querySelector('shreddit-post-overflow-menu');while(actions && actions.parentElement!==credit)actions=actions.parentElement;
        if(actions)actions.prepend(badge);else{badge.style.marginInlineStart='auto';credit.append(badge);}patch.added.push(badge);
      }).catch(()=>{}).finally(()=>{if(this.postState===state)settle();});
    }
    // Replace the post header's [deleted] author with the archived username,
    // keeping Reddit's element classes; the dotted underline marks it archived.
    restorePostAuthor(native,author){
      const credit=native.querySelector('[slot="credit-bar"]') || native;
      const label=[...credit.querySelectorAll('a,span')].find(el=>el.childElementCount===0 && el.textContent.trim()==='[deleted]' && !el.closest('[data-rt-source]'));if(!label)return null;
      const link=make('a',(label.className || '')+' rt-archived-author');link.href='https://www.reddit.com/user/'+author+'/';link.textContent=(label.textContent.trim().startsWith('u/')?'u/':'')+author;link.dataset.rtArchivedAuthor='true';link.title='Original author from an Arctic Shift snapshot';
      label.replaceWith(link);return {label,link};
    }
    // Images Reddit hosts itself (removed posts usually keep their media URL).
    archivedImage(value){
      if(globalThis.RTArchiveView)return RTArchiveView.imageUrl(value);
      try{const url=new URL(value);return url.protocol==='https:' && ['i.redd.it','preview.redd.it'].includes(url.hostname) && /\.(?:jpe?g|png|gif|webp)$/i.test(url.pathname)?url.href:'';}catch{return '';}
    }
    restoreAll(){
      clearTimeout(this.retryTimer);this.retryAt=0;for(const [node,attrs] of this.sharePatches){for(const [name,value] of attrs)if(value===null)node.removeAttribute(name);else node.setAttribute(name,value);}this.sharePatches.clear();this.shareComments=new WeakSet();
      const post=this.postState?.patch;if(post){for(const node of post.added)node.remove();if(post.title)post.title.node.replaceChildren(...post.title.original);if(post.author?.link.isConnected)post.author.link.replaceWith(post.author.label);}
      if(this.postState?.native){this.postState.native.removeAttribute('data-rt-pending');this.postState.native.removeAttribute('data-rt-settled');}this.postState=null;
      for(const [body,patch] of this.patches){if(body.isConnected || patch.original.length)body.replaceChildren(...patch.original);patch.badge?.remove();if(patch.opened)patch.opened.open=false;if(patch.author?.link.isConnected)patch.author.link.replaceWith(patch.author.label);if(patch.avatar)patch.avatar.slot.replaceChildren(...patch.avatar.original);}
      this.patches.clear();
      for(const node of document.querySelectorAll('shreddit-comment[data-rt-pending],shreddit-comment[data-rt-settled]')){node.removeAttribute('data-rt-pending');node.removeAttribute('data-rt-settled');}
      for(const node of document.querySelectorAll('[data-rt-avatar-pending]'))node.removeAttribute('data-rt-avatar-pending');
      for(const node of document.querySelectorAll('[data-rt-notice]'))delete node.dataset.rtNotice;
      for(const node of document.querySelectorAll('main [data-rt-skeleton]'))node.remove();
    }
    destroy(){this.observer?.disconnect();clearTimeout(this.timer);clearTimeout(this.retryTimer);window.removeEventListener('popstate',this.onRoute);document.removeEventListener('reddit:route',this.onRoute);chrome.runtime.onMessage?.removeListener?.(this.onMessage);this.restoreAll();}
  }
  globalThis.RTThreadRestore=Object.freeze({ThreadRestore,postIdOf});
  if(!globalThis.RTThreadRestoreDisabled)new ThreadRestore();
})();
