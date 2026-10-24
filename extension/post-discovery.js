/* Inline public-post discovery. Does not change Reddit's posts or chat client. */
(() => {
  'use strict';
  const M=globalThis.RTPostModel;if(!M)return;
  const key='rt-settings-v1';
  function pageRoute(path=location.pathname){
    const profile=path.match(/^\/user\/([\w-]{1,20})(?:\/(submitted|comments))?\/?$/i);
    if(profile){const view=profile[2]==='submitted'?'posts':profile[2]==='comments'?'comments':'overview';return {kind:'profile',view,username:profile[1],key:'profile:'+profile[1].toLowerCase()+':'+view};}
    const detail=path.match(/^\/(?:r\/[^/]+\/|user\/[^/]+\/)?comments\/([a-z0-9]{1,10})(?:\/.*)?$/i);
    return detail?{kind:'post',id:detail[1].toLowerCase(),key:'post:'+detail[1].toLowerCase()}:null;
  }
  function redditRead(parameters,signal){
    const channel=crypto.randomUUID(),id=crypto.randomUUID();let timer;
    return new Promise((resolve,reject)=>{
      const finish=(error,result)=>{clearTimeout(timer);document.removeEventListener('rt-post-response',receive);signal?.removeEventListener('abort',cancel);error?reject(error):resolve(result);};
      const cancel=()=>{document.dispatchEvent(new CustomEvent('rt-post-request',{detail:JSON.stringify({channel,id,action:'cancel'})}));finish(Error('Post request cancelled.'));};
      const receive=event=>{let response;try{response=JSON.parse(event.detail);}catch{return;}if(response.channel!==channel || response.id!==id)return;finish(response.ok?null:Error(response.error || 'Public posts could not be loaded.'),response);};
      document.addEventListener('rt-post-response',receive);signal?.addEventListener('abort',cancel,{once:true});
      timer=setTimeout(()=>{document.dispatchEvent(new CustomEvent('rt-post-request',{detail:JSON.stringify({channel,id,action:'cancel'})}));finish(Error('Public posts took too long to load. Try again.'));},12000);
      if(signal?.aborted){cancel();return;}
      document.dispatchEvent(new CustomEvent('rt-post-request',{detail:JSON.stringify({channel,id,...parameters})}));
    });
  }
  async function archiveRead(parameters){
    let timer;try{const response=await Promise.race([chrome.runtime.sendMessage({scope:'rt-posts',...parameters}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Archive request took too long. Try again.')),16000);})]);if(!response?.ok)throw Error(response?.error || 'Archive unavailable.');return response;}finally{clearTimeout(timer);}
  }
  async function settingsRead(){
    const response=await archiveRead({action:'get-settings'});
    return {[key]:response.settings};
  }
  const itemKey=post=>post.kind==='comment'?post.fullname:post.id;
  const make=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text)el.textContent=text;return el;};
  function glyph(kind='search'){
    const s=document.createElementNS('http://www.w3.org/2000/svg','svg');s.setAttribute('viewBox','0 0 24 24');s.setAttribute('aria-hidden','true');
    const p=document.createElementNS(s.namespaceURI,'path');p.setAttribute('d',kind==='archive'?'M4 8h16v12H4zM3 4h18v4H3zM9 12h6':kind==='removed'?'M5 5l14 14M19 5L5 19M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20':'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14m5 12 6 6');s.append(p);return s;
  }
  function button(text,run,icon){const b=make('button','',text);b.type='button';if(icon)b.prepend(glyph(icon));b.addEventListener('click',run);return b;}
  function link(text,url,cls){const a=make('a',cls,text);a.href=url;a.rel='noopener noreferrer';return a;}
  class Discovery {
    constructor({reddit=redditRead,archive=archiveRead,readSettings=settingsRead,observe=true,autoDiscover=observe}={}){
      this.autoDiscover=autoDiscover;this.reddit=reddit;this.archive=archive;this.readSettings=readSettings;this.settings={postDiscovery:false,archiveDiscovery:false};this.settingsRevision=0;this.generation=0;this.controllers=new Set();this.nodes=new Map();this.host=null;
      this.onRoute=()=>this.schedule();this.onSettings=(changes,area)=>{if(area==='local' && changes[key]){this.settingsRevision++;this.settingsError=false;this.settings=M.normalizeSettings(changes[key].newValue);this.reset();this.scan();}};
      if(observe){this.observer=new MutationObserver(records=>{if(records.some(r=>!this.host?.contains(r.target)))this.schedule();});this.observer.observe(document.documentElement,{childList:true,subtree:true});window.addEventListener('popstate',this.onRoute);document.addEventListener('reddit:route',this.onRoute);globalThis.chrome?.storage?.onChanged?.addListener(this.onSettings);}
      this.onWorkerSettings=(message,sender)=>{if(message?.scope==='rt-posts' && message.action==='settings-changed' && sender?.id===globalThis.chrome?.runtime?.id)this.onSettings({[key]:{newValue:message.settings}},'local');};
      if(observe)globalThis.chrome?.runtime?.onMessage?.addListener(this.onWorkerSettings);
      this.ready=this.loadSettings();
    }
    async loadSettings(){const revision=this.settingsRevision;try{const saved=await this.readSettings();if(revision!==this.settingsRevision)return;this.settingsError=false;this.settings=M.normalizeSettings(saved?.[key]);this.scan();}catch{if(revision!==this.settingsRevision)return;this.settingsError=true;this.scan();}}
    schedule(){if(this.timer)return;this.timer=setTimeout(()=>{this.timer=null;this.scan();},60);}
    reset(){this.generation++;for(const c of this.controllers)c.abort();this.controllers.clear();if(this.emptyFeed)this.emptyFeed.hidden=this.emptyWasHidden;this.emptyFeed=null;this.host?.remove();this.host=null;this.context=null;this.live=new Map();this.archived=new Map();this.nodes.clear();this.after=this.before=null;this.loaded=false;this.archiveLoaded=false;this.moreReddit=this.moreArchive=false;this.busy=false;this.pages=0;this.afterByKind={};this.beforeByKind={};this.redMore={};this.archiveMore={};}
    scan(){
      const context=pageRoute();
      if((!this.settings.postDiscovery && !this.settingsError) || !context || location.hostname==='old.reddit.com'){if(this.host || this.context)this.reset();return;}
      if(this.context?.key===context.key && this.host?.isConnected){this.deduplicate();return;}
      this.reset();
      const main=document.querySelector('main#main-content,main[role="main"],main');if(!main)return;
      let target=context.kind==='profile'?main.querySelector('shreddit-feed') || main:main.querySelector('shreddit-post');
      if(!target)return;
      this.context=context;this.live=new Map();this.archived=new Map();
      const host=this.host=make('section','rt-posts');host.dataset.rtUi='posts';host.setAttribute('aria-label',context.kind==='profile'?'Additional public activity':'Archived post snapshot');
      const toolbar=this.toolbar=make('div','rt-posts-toolbar');
      const noun=context.view==='comments'?'comments':context.view==='overview'?'activity':'posts';
      this.discover=button(this.settingsError?'Retry discovery':context.kind==='profile'?'Discover '+noun:'Check archived post',()=>this.settingsError?this.retrySettings():context.kind==='profile'?this.loadReddit():this.loadDetail(),'search');
      this.discover.title=context.kind==='profile'?'Find public '+noun+' through Reddit search, including activity omitted from this profile feed':'Look for a separate archived snapshot without replacing the current post';
      if(context.kind==='post' && !this.settings.archiveDiscovery){this.discover.disabled=true;this.discover.title='Enable Arctic Shift archive discovery in Reddit Tweaks to check this post.';}
      toolbar.append(this.discover);
      if(context.kind==='profile' && this.settings.archiveDiscovery){this.archiveButton=button('Search archive',()=>this.loadArchive(),'archive');this.archiveButton.title='Send this public username to Arctic Shift to look for older snapshots';toolbar.append(this.archiveButton);}else this.archiveButton=null;
      this.status=make('p','rt-posts-status');this.status.setAttribute('role','status');
      this.results=make('div','rt-posts-results');this.loading=make('div','rt-post-loading');this.loading.hidden=true;this.loading.setAttribute('aria-label','Loading posts');this.loading.append(make('span'),make('span'));
      this.more=button('Load more',()=>this.loadMore());this.more.className='rt-posts-more';this.more.hidden=true;
      host.append(toolbar,this.status,this.loading,this.results,this.more);
      if(context.kind==='profile')target.prepend(host);else target.after(host);
      this.emptyFeed=main.querySelector('#empty-feed-content');this.emptyWasHidden=this.emptyFeed?.hidden;
      if(this.settingsError)this.setStatus('Discovery settings could not be loaded. Select Retry discovery.',true);
      else if(context.kind==='profile' && this.autoDiscover)queueMicrotask(()=>{if(this.host===host)this.loadReddit();});
    }
    retrySettings(){this.reset();return this.loadSettings();}
    kinds(){return this.context.view==='overview'?['post','comment']:[this.context.view==='comments'?'comment':'post'];}
    visibleIds(){return new Set([...document.querySelectorAll('shreddit-post[id], [data-testid="post-container"][data-fullname], [id^="t1_"]')].filter(el=>!this.host?.contains(el)).map(el=>el.id || el.getAttribute('data-fullname')).filter(id=>M.validateId(id) || /^t1_/i.test(id) && M.validateCommentId(id)));}
    deduplicate(){if(!this.host || this.context.kind!=='profile')return;const visible=this.visibleIds();let additional=false;for(const [id,node]of this.nodes){node.hidden=visible.has(node.dataset.fullname);if(!node.hidden)additional=true;}if(this.emptyFeed)this.emptyFeed.hidden=additional || this.emptyWasHidden;}
    setStatus(text,error=false){this.status.textContent=text;this.status.dataset.error=String(error);}
    async request(parameters){const controller=new AbortController();this.controllers.add(controller);try{return await this.reddit(parameters,controller.signal);}finally{this.controllers.delete(controller);}}
    async run(task){
      if(this.busy)return;const generation=this.generation;this.busy=true;this.host.setAttribute('aria-busy','true');this.loading.hidden=this.results.childElementCount>0;this.discover.disabled=true;if(this.archiveButton)this.archiveButton.disabled=true;this.more.disabled=true;
      try{await task(()=>generation===this.generation && this.host?.isConnected);}
      catch(error){if(generation===this.generation)this.setStatus(error.message,true);}
      finally{if(generation===this.generation){this.busy=false;this.host.removeAttribute('aria-busy');this.loading.hidden=true;this.discover.disabled=false;if(this.archiveButton)this.archiveButton.disabled=false;this.more.disabled=false;}}
    }
    loadReddit({more=false}={}){if(this.pages>=8){this.setStatus('Showing a bounded selection. History is incomplete.');return;}return this.run(async current=>{
      const errors=[];let succeeded=false;
      for(const kind of this.kinds()){
        if(this.pages>=8 || more && !this.redMore[kind])continue;
        const old=more?this.afterByKind[kind]:null;this.pages++;
        try{const result=await this.request({action:'profile',username:this.context.username,kind,...(old?{after:old}:{})});if(!current())return;
          for(const raw of result.posts || []){const p=M.normalizeItem(raw,{source:'reddit'});if(p)this.live.set(itemKey(p),p);}
          this.afterByKind[kind]=result.after;this.redMore[kind]=Boolean(result.hasMore && result.after && result.after!==old);succeeded=true;
        }catch(error){if(!current())return;errors.push((kind==='comment'?'Comments: ':'Posts: ')+error.message);}
      }
      this.after=this.afterByKind.post;this.moreReddit=Object.values(this.redMore).some(Boolean);this.loaded=succeeded || this.loaded;this.render();
      if(errors.length)this.setStatus(errors.join(' '),true);
      this.discover.textContent='Refresh activity';this.discover.prepend(glyph());
    });}
    loadArchive({more=false}={}){if(!this.settings.archiveDiscovery)return;if(this.pages>=8){this.setStatus('Showing a bounded selection. History is incomplete.');return;}return this.run(async current=>{
      const warnings=[];
      for(const kind of this.kinds()){
        if(this.pages>=8 || more && !this.archiveMore[kind])continue;
        this.pages++;
        try{const before=more?this.beforeByKind[kind]:null,result=await this.archive({action:'archive-profile',username:this.context.username,kind,...(before?{before}:{})});if(!current())return;
          const page=[];for(const raw of result.posts || []){const p=M.normalizeItem(raw,{source:'arctic-shift'});if(p){this.archived.set(itemKey(p),p);page.push(p);}}
          this.beforeByKind[kind]=result.before;this.archiveMore[kind]=Boolean(result.hasMore && !result.cursorStalled);this.archiveLoaded=true;
          if(page.length){try{const live=await this.request({action:'info',kind,ids:page.map(p=>p.id)});if(!current())return;for(const raw of live.posts || []){const p=M.normalizeItem(raw,{source:'reddit'});if(p)this.live.set(itemKey(p),p);}}catch{if(!current())return;warnings.push('Current Reddit status could not be checked.');}}
          if(result.cursorStalled)warnings.push('Archive pagination stopped at an ambiguous timestamp. History is incomplete.');
        }catch(error){if(!current())return;warnings.push(error.message);}
      }
      this.moreArchive=Object.values(this.archiveMore).some(Boolean);this.render();if(warnings.length)this.setStatus(warnings.join(' '),true);
    });}
    loadMore(){if(this.pages>=8){this.more.hidden=true;this.setStatus('Showing a bounded selection; history is incomplete.');return;}return this.moreReddit?this.loadReddit({more:true}):this.loadArchive({more:true});}
    render(){
      const posts=M.mergePosts([...this.live.values()],[...this.archived.values()],{username:this.context.username,visibleIds:this.visibleIds()});
      for(const post of posts){const previous=this.nodes.get(itemKey(post)),signature=JSON.stringify(post);if(previous?.dataset.signature===signature)continue;const node=this.card(post);node.dataset.signature=signature;if(previous)previous.replaceWith(node);else this.results.append(node);this.nodes.set(itemKey(post),node);}
      for(let i=0;i<posts.length;i++){const node=this.nodes.get(itemKey(posts[i]));if(this.results.children[i]!==node)this.results.insertBefore(node,this.results.children[i] || null);}
      this.deduplicate();this.more.hidden=!(this.moreReddit || this.moreArchive) || this.pages>=8;
      const count=posts.filter(p=>!p.visible).length;this.setStatus((count?`${count} additional ${this.context.view==='comments'?(count===1?'comment':'comments'):this.context.view==='overview'?'items':count===1?'post':'posts'} · Newest first`:'No additional activity found in this selection.')+' · History may be incomplete.');
    }
    indicator(post){
      const removed=['deleted','removed'].includes(post.status),label=removed?`${post.status==='deleted'?'Deleted':'Removed'} on Reddit`:post.source==='arctic-shift'?'Arctic Shift snapshot · Current Reddit status unknown':'Found through public Reddit search · Not shown in the loaded profile feed';
      const badge=make('span','rt-post-indicator');badge.setAttribute('role','img');badge.setAttribute('aria-label',label);badge.title=label;badge.dataset.state=post.status;badge.append(glyph(removed?'removed':post.source==='arctic-shift'?'archive':'search'));return badge;
    }
    snapshot(text){const details=make('details','rt-post-snapshot');details.append(make('summary','','Archived text · Arctic Shift'),make('pre','',text),make('p','rt-post-source','Archived snapshot; it may differ from the original or current post.'));return details;}
    card(post){
      const card=make('article','rt-discovered-post');card.dataset.postId=post.id;card.dataset.fullname=post.fullname;card.hidden=post.visible;if(post.kind==='comment')card.classList.add('rt-discovered-comment');
      const meta=make('div','rt-post-meta');if(post.subreddit)meta.append(link('r/'+post.subreddit,'https://www.reddit.com/r/'+encodeURIComponent(post.subreddit)+'/'));
      const time=make('time','',new Date(post.created*1000).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}));time.dateTime=new Date(post.created*1000).toISOString();
      meta.append(make('span','','·'),time,this.indicator(post));card.append(meta,link(post.kind==='comment'?(post.title?'Comment on '+post.title:'Comment in r/'+post.subreddit):post.title || 'Post',post.permalink,'rt-post-title'));
      if(post.over18 || post.spoiler)card.append(make('span','rt-post-source',post.over18?'NSFW · Open post to view':'Spoiler · Open post to view'));
      else{
        if(post.source==='reddit' && post.thumbnail && /^https:\/\/(?:i|preview|external-preview)\.redd\.it\//i.test(post.thumbnail)){const image=make('img','rt-post-thumbnail');image.src=post.thumbnail;image.alt='';image.loading='lazy';image.referrerPolicy='no-referrer';card.append(image);}
        if(post.source==='arctic-shift' && post.body && !['[deleted]','[removed]'].includes(post.body))card.append(this.snapshot(post.body));
        else if(post.body && !['[deleted]','[removed]'].includes(post.body))card.append(make('p','rt-post-body',post.body));
        if(post.archivedBody)card.append(this.snapshot(post.archivedBody));
      }
      const footer=make('div','rt-post-footer');footer.append(link(post.kind==='comment'?'View comment':`${post.comments.toLocaleString()} comments`,post.permalink),make('span','',post.source==='arctic-shift'?'Archived snapshot':`${post.score.toLocaleString()} points`));card.append(footer);return card;
    }
    loadDetail(){if(!this.settings.archiveDiscovery)return;return this.run(async current=>{
      const id=this.context.id,result=await this.archive({action:'archive-ids',ids:[id]});if(!current())return;
      const archived=(result.posts || []).map(p=>M.normalizePost(p,{source:'arctic-shift'})).find(p=>p?.id===id);
      if(!archived){this.setStatus('No archived snapshot is available for this post.');return;}
      let live;try{const response=await this.request({action:'info',ids:[id]});live=response.posts?.map(p=>M.normalizePost(p,{source:'reddit'})).find(p=>p?.id===id);}catch{ /* An archive is never proof of current removal. */ }
      if(!current())return;
      this.results.replaceChildren();
      if(live?.status==='available'){this.setStatus('This post is available on Reddit. Its live content is unchanged.');return;}
      const note=make('div','rt-post-snapshot');note.append(this.indicator(live || archived));
      if(archived.over18 || archived.spoiler || live?.over18 || live?.spoiler)note.append(make('p','rt-post-source','NSFW or spoiler snapshot · open the post’s source to review content restrictions.'));
      else if(archived.body && !['[deleted]','[removed]'].includes(archived.body))note.append(this.snapshot(archived.body));else note.append(make('p','rt-post-source','The archive has no original text for this post.'));
      this.results.append(note);this.setStatus(live?`${live.status==='deleted'?'Deleted':'Removed'} on Reddit · Separate archived snapshot`:'Archived snapshot · Current Reddit status unknown');
    });}
    destroy(){clearTimeout(this.timer);this.observer?.disconnect();globalThis.chrome?.runtime?.onMessage?.removeListener?.(this.onWorkerSettings);window.removeEventListener('popstate',this.onRoute);document.removeEventListener('reddit:route',this.onRoute);globalThis.chrome?.storage?.onChanged?.removeListener?.(this.onSettings);this.reset();}
  }
  globalThis.RTPostDiscovery=Object.freeze({Discovery,pageRoute});
  if(window.top===window && globalThis.chrome?.runtime?.id)new Discovery();
})();
