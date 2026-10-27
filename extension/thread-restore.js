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
    constructor({archive=send,settings=readSettings,observe=true,retryMs=15000}={}){
      this.archive=archive;this.retryMs=retryMs;this.settings=null;this.postId='';this.patches=new Map();this.requested=new Set();this.queue=new Set();this.attempts=new Map();this.timer=null;
      if(observe){
        this.observer=new MutationObserver(records=>{if(records.some(r=>!this.ownsMutation(r)))this.schedule();});this.observer.observe(document.documentElement,{childList:true,subtree:true});
        this.onRoute=()=>this.schedule();window.addEventListener('popstate',this.onRoute);document.addEventListener('reddit:route',this.onRoute);
        this.onMessage=(message,sender)=>{if(message?.scope==='rt-posts' && message.action==='settings-changed' && sender?.id===chrome.runtime.id)this.setSettings(message.settings);};chrome.runtime.onMessage?.addListener(this.onMessage);
      }
      this.ready=Promise.resolve().then(settings).then(value=>this.setSettings(value),()=>this.setSettings(null));
    }
    setSettings(value){this.settings=value?M.normalizeSettings(value):null;if(!this.enabled()){this.restoreAll();this.requested.clear();this.queue.clear();}this.scan();}
    enabled(){const s=this.settings;return Boolean(s?.postDiscovery && s.archiveDiscovery && s.restoreDeletedContent);}
    ownsMutation(record){return [...record.addedNodes,...record.removedNodes].every(node=>node.nodeType===1 && (node.dataset?.rtRecoveredText || node.dataset?.rtSource)) && record.addedNodes.length+record.removedNodes.length>0;}
    schedule(){if(this.timer)return;this.timer=setTimeout(()=>{this.timer=null;this.scan();},200);}
    scan(){
      const postId=postIdOf();
      if(postId!==this.postId){this.restoreAll();this.requested.clear();this.queue.clear();this.attempts.clear();this.postId=postId;}
      if(!postId || !this.enabled())return;
      for(const comment of document.querySelectorAll('main shreddit-comment[thingid]')){
        const id=comment.getAttribute('thingid').toLowerCase(),post=comment.getAttribute('postid')?.toLowerCase();
        if(!/^t1_[a-z0-9]{1,32}$/.test(id) || this.requested.has(id) || post && post!=='t3_'+postId)continue;
        if(this.noticeParagraph(comment))this.queue.add(id);
      }
      return this.flush();
    }
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
          let result;
          try{result=await this.archive({action:'archive-comments',postId,ids});}
          catch(error){
            // Rate limits and timeouts retry later; anything else leaves Reddit's notice in place.
            const attempts=(this.attempts.get(postId) || 0)+1;
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
        }
      }finally{this.flushing=false;}
    }
    apply(archived){
      const text=archived.body?.trim();if(!text || placeholder.test(text))return; // captured after deletion: nothing to show
      const comment=[...document.querySelectorAll('main shreddit-comment[thingid]')].find(node=>node.getAttribute('thingid').toLowerCase()==='t1_'+archived.id);if(!comment)return;
      const p=this.noticeParagraph(comment),body=p?.parentElement;if(!body || this.patches.has(body))return;
      const status=/removed/i.test(p.textContent)?'removed':'deleted';
      // Reuse Reddit's own comment-body classes from a normal comment on this page.
      const sample=[...document.querySelectorAll('main shreddit-comment [id$="-post-rtjson-content"]')].find(node=>!node.closest('[data-rt-recovered-text]'));
      const recovered=make('div',sample?.className || 'md text-14');recovered.dataset.rtRecoveredText='true';
      const rendered=globalThis.RTMarkdown?.fromHtml(archived.bodyHtml) || globalThis.RTMarkdown?.render(text);
      if(rendered)recovered.append(rendered);else for(const part of text.split(/\n{2,}/)){const para=make('p','',part);para.style.whiteSpace='pre-wrap';recovered.append(para);}
      const pClass=sample?.querySelector('p')?.className;if(pClass)for(const para of recovered.querySelectorAll(':scope > p'))para.className=pClass;
      this.patches.set(body,{original:[...body.childNodes],comment});body.replaceChildren(recovered);
      // Reddit collapses deleted comments; open restored ones so the text is visible.
      const details=comment.querySelector(':scope > details');if(details && !details.open){details.open=true;this.patches.get(body).opened=details;}
      const meta=comment.querySelector('[slot="commentMeta"]');
      if(meta && !meta.querySelector('[data-rt-source]')){
        const when=archived.retrieved?' from '+new Date(archived.retrieved*1000).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}):'';
        const by=M.validateUsername(archived.author)?' · Originally posted by u/'+archived.author:'';
        const label=(status==='removed'?'Removed by moderators':'Deleted by its author')+' on Reddit · Text from an Arctic Shift snapshot'+when+by;
        const badge=make('span','rt-post-indicator rt-thread-indicator');badge.dataset.rtSource='true';badge.dataset.state=status;badge.setAttribute('role','img');badge.setAttribute('aria-label',label);badge.title=label;
        const icon=globalThis.RTPostDiscovery?.glyph?.('deleted');if(icon)badge.append(icon);
        (meta.querySelector('shreddit-comment-badges')?.parentElement || meta).append(badge);
        this.patches.get(body).badge=badge;
      }
    }
    restoreAll(){
      for(const [body,patch] of this.patches){if(body.isConnected || patch.original.length)body.replaceChildren(...patch.original);patch.badge?.remove();if(patch.opened)patch.opened.open=false;}
      this.patches.clear();
    }
    destroy(){this.observer?.disconnect();clearTimeout(this.timer);clearTimeout(this.retryTimer);window.removeEventListener('popstate',this.onRoute);document.removeEventListener('reddit:route',this.onRoute);chrome.runtime.onMessage?.removeListener?.(this.onMessage);this.restoreAll();}
  }
  globalThis.RTThreadRestore=Object.freeze({ThreadRestore,postIdOf});
  if(!globalThis.RTThreadRestoreDisabled)new ThreadRestore();
})();
