/* Viewed-posts History recorder (docs/viewed-history-spec.md). When the History limit is above Reddit's own 20, the
   post you open (the card whose ID is the post in the address bar) is sent to the worker once per visit, for the
   account signed in to this tab. Reddit's 20 records nothing. */
(() => {
 'use strict';
 if(globalThis.RTViewedHistory)return;
 const M=globalThis.RTPostModel;
 const postId=(path=location.pathname)=>path.match(/^\/(?:r|user)\/[\w-]+\/comments\/([a-z0-9]{1,10})(?:\/|$)/i)?.[1]?.toLowerCase() || null;
 // Content scripts can't read extension storage; normalized settings come from the worker, which also pushes changes.
 const settingsRead=async()=>{const response=await chrome.runtime.sendMessage({scope:'rt-posts',action:'get-settings'});return response?.ok?response.settings:{};};
 const number=value=>{const n=Number(value);return value!=null && value!=='' && Number.isFinite(n)?n:undefined;};
 class Recorder{
  constructor({readSettings=settingsRead,send=message=>chrome.runtime.sendMessage({scope:'rt-viewed',...message}),observe=true,doc=document,retryMs=5000}={}){
   this.doc=doc;this.send=send;this.limit=20;this.path=null;this.done=false;this.timer=null;this.active=false;this.settingsRevision=0;this.retryMs=retryMs;
   this.schedule=()=>{if(this.timer || !this.active)return;this.timer=setTimeout(()=>{this.timer=null;this.scan();},0);};
   if(observe){
    this.observer=new MutationObserver(this.schedule);this.observer.observe(doc.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['id','created-timestamp','post-title','permalink','logged-in-user-id','user-logged-in']});
    this.beforeNavigate=event=>{if(event.composedPath().some(node=>node?.matches?.('a[href]')))this.scan();};doc.addEventListener('click',this.beforeNavigate,true);
    for(const name of ['popstate','pageshow'])window.addEventListener(name,this.schedule);doc.addEventListener('reddit:route',this.schedule);
    this.onSettings=(message,sender)=>{if(message?.scope==='rt-posts' && message.action==='settings-changed' && sender?.id===chrome.runtime.id)this.configure(message.settings);};chrome.runtime.onMessage?.addListener(this.onSettings);
   }
   const revision=this.settingsRevision;this.ready=readSettings().then(settings=>{if(revision===this.settingsRevision)this.configure(settings);},()=>{if(revision===this.settingsRevision)this.configure({});});
  }
  configure(settings){const normalized=M.normalizeSettings(settings),active=normalized.postDiscovery && normalized.historyLimit!==20;this.settingsRevision++;this.limit=normalized.historyLimit;if(!active || !this.active){this.visit=null;this.done=false;this.pending=null;clearTimeout(this.timer);this.timer=null;}this.active=active;if(active)this.schedule();}
  async scan(){
   if(!this.active)return;const path=location.pathname;if(path!==this.path){this.path=path;this.visit=null;this.done=false;this.pending=null;}
   const id=postId(path);if(!id)return;
   const card=[...this.doc.querySelectorAll('shreddit-post[id]')].find(node=>node.id.toLowerCase()==='t3_'+id);if(!card)return;
   // Post pages carry Reddit's logged-in account ID but no username; views are kept per account ID.
   const app=this.doc.querySelector('shreddit-app'),owner=app?.getAttribute('logged-in-user-id');if(app?.getAttribute('user-logged-in')!=='true' || !/^t2_[a-z0-9]{1,13}$/i.test(owner || ''))return;
   const visit=owner.toLowerCase()+'|'+path;if(visit!==this.visit){this.visit=visit;this.path=path;this.done=false;this.pending=null;this.attempts=0;}if(this.done || this.pending || this.attempts>=3)return;
   const created=Date.parse(card.getAttribute('created-timestamp') || '')/1000;if(!Number.isFinite(created) || created<=0)return;
   const item={fullname:'t3_'+id,id,title:card.getAttribute('post-title') || '',subreddit:card.getAttribute('subreddit-name') || '',author:card.getAttribute('author') || '',permalink:card.getAttribute('permalink') || path,created:Math.floor(created),
    postType:card.getAttribute('post-type') || '',score:number(card.getAttribute('score')),comments:number(card.getAttribute('comment-count')),over18:card.hasAttribute('nsfw') || card.hasAttribute('over-18'),spoiler:card.hasAttribute('spoiler')};
   const pending={visit};this.pending=pending;this.attempts++;
   try{const result=await this.send({action:'record',owner:owner.toLowerCase(),item});if(this.pending===pending)this.done=result?.ok===true && result.recorded!==false;}catch{}
   finally{if(this.pending===pending){this.pending=null;if(!this.done && this.active && this.attempts<3){clearTimeout(this.timer);this.timer=setTimeout(()=>{this.timer=null;this.scan();},this.retryMs);}}}
  }
  destroy(){this.active=false;this.pending=null;clearTimeout(this.timer);this.observer?.disconnect();for(const name of ['popstate','pageshow'])window.removeEventListener(name,this.schedule);this.doc.removeEventListener('reddit:route',this.schedule);if(this.beforeNavigate)this.doc.removeEventListener('click',this.beforeNavigate,true);if(this.onSettings)chrome.runtime.onMessage?.removeListener(this.onSettings);}
 }
 globalThis.RTViewedHistory=Object.freeze({Recorder,postId});
 if(window.top===window && globalThis.chrome?.runtime?.id)new Recorder();
})();
