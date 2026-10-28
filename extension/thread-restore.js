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
      const response=await Promise.race([chrome.runtime.sendMessage({scope:'rt-posts',...message}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(Error('Archive request took too long.'),{code:'timeout'})),16000);})]);
      if(!response?.ok)throw Object.assign(Error(response?.error || 'Archive unavailable.'),{code:response?.code,retryAt:response?.retryAt});
      return response;
    }finally{clearTimeout(timer);}
  }
  async function readSettings(){return (await send({action:'get-settings'})).settings;}
  class ThreadRestore {
    constructor({archive=send,reddit=(...args)=>globalThis.RTPostDiscovery?.redditRead?.(...args),settings=readSettings,observe=true,retryMs=15000}={}){
      this.reddit=reddit;this.avatars=new Map();this.archive=archive;this.retryMs=retryMs;this.settings=null;this.postId='';this.patches=new Map();this.requested=new Set();this.queue=new Set();this.attempts=new Map();this.timer=null;
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
    syncRootFlag(){document.documentElement.toggleAttribute('data-rt-restore',this.enabled() && Boolean(postIdOf()));}
    enabled(){const s=this.settings;return Boolean(s?.postDiscovery && s.archiveDiscovery && s.restoreDeletedContent);}
    ownsMutation(record){return [...record.addedNodes,...record.removedNodes].every(node=>node.nodeType===1 && (node.dataset?.rtRecoveredText || node.dataset?.rtSource)) && record.addedNodes.length+record.removedNodes.length>0;}
    schedule(){if(this.timer)return;this.timer=setTimeout(()=>{this.timer=null;this.scan();},200);}
    scan(){
      const postId=postIdOf();
      if(postId!==this.postId){this.restoreAll();this.requested.clear();this.queue.clear();this.attempts.clear();this.checked=new WeakSet();this.postId=postId;this.postState=null;this.syncRootFlag();}
      if(!postId || !this.enabled())return;
      this.restorePost();
      for(const comment of document.querySelectorAll('main shreddit-comment[thingid]')){
        const id=comment.getAttribute('thingid').toLowerCase(),post=comment.getAttribute('postid')?.toLowerCase();
        // Comments already examined (no notice) are not re-read on every change.
        if(!/^t1_[a-z0-9]{1,32}$/.test(id) || this.requested.has(id) || this.checked?.has(comment))continue;
        if(post && post!=='t3_'+postId){comment.setAttribute('data-rt-settled','');continue;}
        // Skeleton instead of Reddit's notice while the archive is asked.
        const notice=this.noticeParagraph(comment);if(notice){this.queue.add(id);notice.dataset.rtNotice='true';comment.setAttribute('data-rt-pending','');}else{comment.setAttribute('data-rt-settled','');this.checked?.add(comment);}
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
      if(this.flushing || !this.queue.size)return;this.flushing=true;const postId=this.postId;
      try{
        while(this.queue.size && postId===this.postId && this.enabled()){
          const ids=[...this.queue].slice(0,100);for(const id of ids){this.queue.delete(id);this.requested.add(id);}
          let result;const settle=()=>{for(const id of ids){const node=this.commentNode(id);if(node){node.removeAttribute('data-rt-pending');node.setAttribute('data-rt-settled','');}}};
          try{result=await this.archive({action:'archive-comments',postId,ids});}
          catch(error){
            // Rate limits and timeouts retry later; anything else leaves Reddit's notice in place.
            settle();const attempts=(this.attempts.get(postId) || 0)+1;
            if(['rate-limited','timeout','network-error','busy','http-error'].includes(error?.code) && attempts<=3){
              this.attempts.set(postId,attempts);for(const id of ids){this.requested.delete(id);this.queue.add(id);}
              const wait=Math.max(this.retryMs*attempts,Number.isFinite(error.retryAt)?error.retryAt-Date.now()+500:0);
              clearTimeout(this.retryTimer);this.retryTimer=setTimeout(()=>{if(postId===this.postId)this.flush();},wait);
              return;
            }
            continue;
          }
          if(postId!==this.postId || !this.enabled())return;
          for(const raw of result.posts || []){const comment=M.normalizeComment(raw,{source:'arctic-shift'});if(comment && comment.linkId===postId)this.apply(comment);}
          settle();
        }
      }finally{this.flushing=false;}
    }
    apply(archived){
      const text=archived.body?.trim();if(!text || placeholder.test(text))return; // captured after deletion: nothing to show
      const comment=this.commentNode('t1_'+archived.id);if(!comment)return;
      const p=this.noticeParagraph(comment),body=p?.parentElement;if(!body || this.patches.has(body))return;
      const status=/removed/i.test(p.textContent)?'removed':'deleted';
      // Reuse Reddit's own comment-body classes from a normal comment on this page.
      const sample=[...document.querySelectorAll('main shreddit-comment [id$="-post-rtjson-content"]')].find(node=>!node.closest('[data-rt-recovered-text]'));
      const recovered=make('div',sample?.className || 'md text-14');recovered.dataset.rtRecoveredText='true';
      const rendered=globalThis.RTMarkdown?.fromHtml(archived.bodyHtml) || globalThis.RTMarkdown?.render(text);
      if(rendered)recovered.append(rendered);else for(const part of text.split(/\n{2,}/)){const para=make('p','',part);para.style.whiteSpace='pre-wrap';recovered.append(para);}
      const pClass=sample?.querySelector('p')?.className;if(pClass)for(const para of recovered.querySelectorAll(':scope > p'))para.className=pClass;
      this.patches.set(body,{original:[...body.childNodes],comment,body});body.replaceChildren(recovered);
      // Reddit collapses deleted comments; open restored ones so the text is visible.
      const details=comment.querySelector(':scope > details');if(details && !details.open){details.open=true;this.patches.get(body).opened=details;}
      const meta=comment.querySelector('[slot="commentMeta"]');
      if(meta && !meta.querySelector('[data-rt-source]')){
        const when=archived.retrieved?' from '+new Date(archived.retrieved*1000).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}):'';
        const by=M.validateUsername(archived.author)?' · Originally posted by u/'+archived.author:'';
        const label=(status==='removed'?'Removed by moderators':'Deleted by its author')+' on Reddit · Text from an Arctic Shift snapshot'+when+by;
        const badge=make('span','rt-post-indicator rt-thread-indicator');badge.dataset.rtSource='true';badge.dataset.state=status;badge.setAttribute('role','img');badge.setAttribute('aria-label',label);badge.title=label;
        const icon=globalThis.RTPostDiscovery?.glyph?.(status==='removed'?'removed':'deleted');if(icon)badge.append(icon);
        (meta.querySelector('shreddit-comment-badges')?.parentElement || meta).append(badge);
        this.patches.get(body).badge=badge;
      }
      if(M.validateUsername(archived.author))this.restoreAuthor(comment,archived.author,this.patches.get(body));
    }
    // Show the archived author where Reddit shows [deleted]: a profile link
    // styled like this page's author names, and their Reddit profile picture
    // when Reddit still has one. A dotted underline and tooltip mark the source.
    restoreAuthor(comment,author,patch){
      const label=comment.querySelector('.author-name-meta span[dir],[slot="commentMeta"] span[dir]');
      if(label && label.textContent.trim()==='[deleted]' && !patch.author){
        const sample=[...document.querySelectorAll('main shreddit-comment [slot="commentMeta"] a[href^="https://www.reddit.com/user/"],main shreddit-comment [slot="commentMeta"] a[href^="/user/"]')].find(a=>!a.closest('[data-rt-archived-author]'));
        const link=make('a',(sample?.className || 'font-bold text-neutral-content-strong')+' rt-archived-author');link.href='/user/'+author+'/';link.dir='auto';link.dataset.rtArchivedAuthor='true';link.title='Original author from an Arctic Shift snapshot';link.textContent=author;
        patch.author={label,original:[...label.childNodes]};label.replaceChildren(link);
      }
      const holder=comment.querySelector('[slot="commentAvatar"] [avatar]');if(!holder || patch.avatar)return;
      const show=url=>{if(!url || !holder.isConnected || patch.avatar || !this.patches.has(patch.body))return;const img=make('img','rt-archived-avatar');img.src=url;img.alt='';img.loading='lazy';img.decoding='async';img.referrerPolicy='no-referrer';img.title='Profile picture of u/'+author;patch.avatar={holder,original:[...holder.childNodes]};holder.replaceChildren(img);};
      const key=author.toLowerCase();if(this.avatars.has(key))return Promise.resolve(this.avatars.get(key)).then(show);
      const lookup=(async()=>{for(let attempt=0;attempt<3;attempt++){try{const result=await this.reddit({action:'user-avatar',username:author});if(!result?.deferred)return result?.avatar || '';await new Promise(r=>setTimeout(r,Math.min(5000,result.retryAfterMs || 500)));}catch{return '';}}return '';})();
      this.avatars.set(key,lookup);lookup.then(url=>{this.avatars.set(key,url);show(url);});
      return lookup;
    }
    // The open post itself: deleted/removed posts get their archived title,
    // formatted body and (image posts) image inside Reddit's own post element.
    restorePost(){
      const postId=this.postId,native=[...document.querySelectorAll('main shreddit-post[id="t3_'+postId+'"]')].find(node=>!node.closest('[data-rt-ui]'));
      if(!native || this.postState?.native===native)return;
      const status=M.domStatus(native);this.postState={native,status};
      if(!status){native.setAttribute('data-rt-settled','');return;}
      native.setAttribute('data-rt-pending','');
      const state=this.postState,settle=()=>{native.removeAttribute('data-rt-pending');native.setAttribute('data-rt-settled','');};
      return Promise.resolve(this.archive({action:'archive-ids',ids:[postId]})).then(result=>{
        if(this.postState!==state || !this.enabled())return;
        const archived=(result?.posts || []).map(raw=>M.normalizePost(raw,{source:'arctic-shift'})).find(post=>post?.id===postId);if(!archived)return;
        const author=native.getAttribute('author') || '';if(author && author!=='[deleted]' && author.toLowerCase()!==archived.author.toLowerCase())return;
        const restricted=archived.over18 || archived.spoiler || native.matches('[nsfw],[spoiler],[is-nsfw],[over-18]') || Boolean(native.querySelector('shreddit-content-gate,[slot="nsfw-blocker"]'));
        const patch=state.patch={native,added:[],title:null};
        const title=native.querySelector('[slot="title"]');
        if(title && archived.title && M.noticeStatus(title.textContent) && !M.noticeStatus(archived.title)){patch.title={node:title,original:[...title.childNodes]};const text=make('span','',archived.title);text.dataset.rtRecoveredText='true';title.replaceChildren(text);}
        const place=(node,slots)=>{native.append(node);patch.added.push(node);for(const slot of slots){node.slot=slot;if(!native.shadowRoot || node.assignedSlot)return;}if(native.shadowRoot && !node.assignedSlot)node.removeAttribute('slot');};
        const text=archived.body?.trim();
        if(!restricted && text && !M.noticeStatus(text) && !native.querySelector('[slot="text-body"] [data-rt-recovered-text]')){
          const body=make('div','md text-14 pb-xs rt-recovered-md');body.dataset.rtRecoveredText='true';
          const rendered=globalThis.RTMarkdown?.fromHtml(archived.bodyHtml) || globalThis.RTMarkdown?.render(text);if(rendered)body.append(rendered);else body.append(make('p','',text));
          place(body,['text-body','post-recovery-section','post-removed-banner']);
        }
        const image=this.archivedImage(archived.url);
        if(!restricted && image && !native.querySelector('[slot="post-media-container"] img,[slot="post-media-container"] video')){
          const figure=make('figure','rt-archived-media');figure.dataset.rtRecoveredText='true';const img=make('img');img.src=image;img.alt=archived.title || '';img.loading='lazy';img.decoding='async';img.referrerPolicy='no-referrer';figure.append(img);
          place(figure,['post-media-container','text-body','post-recovery-section']);
        }
        if(!patch.title && !patch.added.length)return;
        const when=archived.retrieved?' from '+new Date(archived.retrieved*1000).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}):'';
        const label=(status==='removed'?'Removed by moderators':'Deleted by its author')+' on Reddit · Restored from an Arctic Shift snapshot'+when;
        const badge=make('span','rt-post-indicator');badge.dataset.rtSource='true';badge.dataset.state=status;badge.setAttribute('role','img');badge.setAttribute('aria-label',label);badge.title=label;
        const icon=globalThis.RTPostDiscovery?.glyph?.(status==='removed'?'removed':'deleted');if(icon)badge.append(icon);
        const credit=native.querySelector('[slot="credit-bar"]') || native;let actions=credit.querySelector('shreddit-post-overflow-menu');while(actions && actions.parentElement!==credit)actions=actions.parentElement;
        if(actions)actions.prepend(badge);else{badge.style.marginInlineStart='auto';credit.append(badge);}patch.added.push(badge);
      }).catch(()=>{}).finally(()=>{if(this.postState===state)settle();});
    }
    // Images Reddit hosts itself (removed posts usually keep their media URL).
    archivedImage(value){
      try{const url=new URL(value);return url.protocol==='https:' && ['i.redd.it','preview.redd.it'].includes(url.hostname) && /\.(?:jpe?g|png|gif|webp)$/i.test(url.pathname)?url.href:'';}catch{return '';}
    }
    restoreAll(){
      const post=this.postState?.patch;if(post){for(const node of post.added)node.remove();if(post.title)post.title.node.replaceChildren(...post.title.original);}
      if(this.postState?.native){this.postState.native.removeAttribute('data-rt-pending');this.postState.native.removeAttribute('data-rt-settled');}this.postState=null;
      for(const [body,patch] of this.patches){if(body.isConnected || patch.original.length)body.replaceChildren(...patch.original);patch.badge?.remove();if(patch.opened)patch.opened.open=false;if(patch.author)patch.author.label.replaceChildren(...patch.author.original);if(patch.avatar)patch.avatar.holder.replaceChildren(...patch.avatar.original);}
      this.patches.clear();
      for(const node of document.querySelectorAll('shreddit-comment[data-rt-pending],shreddit-comment[data-rt-settled]')){node.removeAttribute('data-rt-pending');node.removeAttribute('data-rt-settled');}
      for(const node of document.querySelectorAll('[data-rt-notice]'))delete node.dataset.rtNotice;
    }
    destroy(){this.observer?.disconnect();clearTimeout(this.timer);clearTimeout(this.retryTimer);window.removeEventListener('popstate',this.onRoute);document.removeEventListener('reddit:route',this.onRoute);chrome.runtime.onMessage?.removeListener?.(this.onMessage);this.restoreAll();}
  }
  globalThis.RTThreadRestore=Object.freeze({ThreadRestore,postIdOf});
  if(!globalThis.RTThreadRestoreDisabled)new ThreadRestore();
})();
