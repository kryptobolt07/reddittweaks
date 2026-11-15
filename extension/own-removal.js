/* Observe the signed-in account's native cards. No Reddit API fetches or background crawl. */
(() => {
 'use strict';
 if(globalThis.RTOwnRemoval)return;
 const N=globalThis.RTNativeRemoval,R=globalThis.RTRemovalModel,TTL=600000;
 const runtime=message=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Removal checks timed out. Refresh this tab.')),10000);try{Promise.resolve(chrome.runtime.sendMessage(message)).then(resolve,reject).finally(()=>clearTimeout(timer));}catch(e){clearTimeout(timer);reject(e);}});
 const author=p=>{const m=p.moderation;return {kind:p.kind,name:p.fullname,...(p.kind==='post'?{title:p.title,selftext:p.body}:{body:p.body}),created_utc:p.created,removed_by_category:m.category,locked:m.locked,subreddit_type:m.subredditType,quarantine:m.quarantined,visibilityKnown:m.visibilityKnown,nativeRemoved:m.nativeRemoved};};
 async function checkPublic(input,signal){
  if(!globalThis.RTPostDiscovery?.redditRead)throw Error('Refresh this Reddit tab to connect signed-out checks.');
  for(let attempt=0;attempt<40;attempt++){
   if(signal?.aborted)throw Error('Check cancelled.');const result=await globalThis.RTPostDiscovery.redditRead({action:'removal-public',...input},signal);if(!result.deferred)return result.proof;
   await new Promise(resolve=>setTimeout(resolve,250));
  }throw Error('Signed-out checks are busy.');
 }
 function verdict(p,archive=null,status='off',proof=null){
  const publicView=proof?.verified===true?{verified:true,visibility:proof.status,moderation:proof.moderation}:proof?{status:'failed'}:null;
  return R.classify({author:{...author(p),visibilityKnown:false},publicView,archive,archiveStatus:status});
 }
 class Monitor {
  constructor({doc=globalThis.document,readSettings=async()=>{const r=await runtime({scope:'rt-posts',action:'get-settings'});if(!r?.ok)throw Error('Settings unavailable.');return r.settings;},send=message=>runtime({scope:'rt-removal',...message}),archive=message=>runtime({scope:'rt-posts',...message,pageUrl:location.href}),check=checkPublic,now=()=>Date.now(),visible,observe=true}={}){
   Object.assign(this,{doc,readSettings,send,archive,check,now});this.entries=new Map();this.saved={};this.generation=0;this.me=null;this.settings={ownRemoval:false};this.dead=false;this.observe=observe;
   this.visible=visible || (node=>{if(doc.visibilityState==='hidden')return false;if(!node)return true;const r=node.getBoundingClientRect();return r.height>0 && r.bottom>=0 && r.top<=doc.defaultView.innerHeight+200;});
   this.schedule=()=>{if(this.queued || this.dead)return;this.queued=doc.defaultView.requestAnimationFrame(()=>{this.queued=0;this.scan().catch(()=>{});});};
   this.message=(m,sender,respond)=>{if(m?.scope==='rt-removal' && m.action==='context'){respond(N.identity(doc));return false;}if(m?.scope==='rt-removal' && m.action==='cleared' && m.owner===this.me?.owner){this.entries.clear();this.saved={};this.loaded='';this.schedule();}if(m?.scope==='rt-posts' && m.action==='settings-changed')this.configure(m.settings).catch(()=>{});};
   globalThis.chrome?.runtime?.onMessage?.addListener(this.message);
   if(observe){this.observer=new MutationObserver(records=>{if(records.some(r=>!(r.target.nodeType===1?r.target:r.target.parentElement)?.closest?.('[data-rt-own-removal]') && (r.type==='attributes' || r.type==='characterData' || [...r.addedNodes,...r.removedNodes].some(n=>n.nodeType!==1 || !n.matches('[data-rt-own-removal]')))))this.schedule();});
   }
   this.ready=readSettings().then(cfg=>this.configure(cfg)).catch(()=>{this.error='Could not load removal settings. Refresh this tab.';});
  }
  clearBadges(){for(const n of this.doc.querySelectorAll('[data-rt-own-removal]'))n.remove();}
  watch(on){
   if(!this.observe || this.watching===on)return;this.watching=on;
   if(on)this.observer.observe(this.doc.documentElement,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['user-logged-in','logged-in-user-id','src','author','author-id','author-name','item-state','removed-by-category','locked','is-locked','hidden','collapsed']});
   else{this.observer.disconnect();if(this.queued){this.doc.defaultView.cancelAnimationFrame(this.queued);this.queued=0;}}
   for(const event of ['scroll','resize','popstate','pageshow','visibilitychange','rt-route-change'])this.doc.defaultView[on?'addEventListener':'removeEventListener'](event,this.schedule,{passive:true});
  }
  async configure(cfg){this.proofController?.abort();this.settings={...cfg};this.watch(cfg.ownRemoval===true);this.generation++;this.busy=null;this.entries.clear();this.saved={};this.loaded='';if(!cfg.ownRemoval){this.clearBadges();await this.send({action:'reset'}).catch(()=>{});return;}return this.scan();}
  route(){const url=new URL(this.doc.location.href);for(const key of [...url.searchParams.keys()])if(key.startsWith('rt_') && key!=='rt_list')url.searchParams.delete(key);return url.pathname+url.search;}
  current(me,generation){const current=N.identity(this.doc);return !this.dead && this.settings.ownRemoval===true && this.generation===generation && this.routeKey===this.route() && current?.owner===me.owner && current?.username.toLowerCase()===me.username.toLowerCase();}
  async scan(){
   if(this.dead)return;const me=N.identity(this.doc),key=me?me.owner+':'+me.username.toLowerCase():'';
   const route=this.route();if(this.routeKey!==route){this.proofController?.abort();this.routeKey=route;this.generation++;this.busy=null;this.rescan=false;}
   if(key!==this.key){this.proofController?.abort();const previous=this.me;this.key=key;this.me=me;this.generation++;this.busy=null;this.entries.clear();this.saved={};this.loaded='';this.clearBadges();if(previous || this.visible())await this.send({action:'reset'}).catch(()=>{});}
   if(!me || !this.settings.ownRemoval){this.clearBadges();return;}if(!this.visible())return;if(this.busy){this.rescan=true;return this.busy;}
   const generation=this.generation,job=this.run(me,generation);this.busy=job;try{return await job;}finally{if(this.busy===job){this.busy=null;if(this.rescan){this.rescan=false;this.schedule();}}}
  }
  async run(me,generation){
   if(this.loaded!==this.key){try{const response=await this.send({action:'load',...me});if(!this.current(me,generation))return;this.saved=response?.value?.items || {};}catch{}this.loaded=this.key;}
   if(!this.current(me,generation))return;
   const pending=[],hosts=new Map(),observations=new Map(),owned=new Set(),time=this.now(),strength=p=>p.moderation.category?3:p.moderation.nativeRemoved?2:p.moderation.visibilityKnown?1:0;
   const controller=new AbortController();this.proofController=controller;
   for(const card of [...this.doc.querySelectorAll('shreddit-post,shreddit-profile-comment,shreddit-comment')].filter(n=>this.visible(n)).slice(0,100)){
    const p=N.item(card,me);if(!p)continue;owned.add(card);if(!hosts.has(p.fullname))hosts.set(p.fullname,[]);hosts.get(p.fullname).push(card);
    const previous=observations.get(p.fullname);if(!previous || strength(p)>strength(previous))observations.set(p.fullname,p);
   }
   for(const p of observations.values()){
    const paint=record=>{for(const host of hosts.get(p.fullname))this.paint(host,record);};
    const signature=JSON.stringify([p.moderation,p.body]),old=this.entries.get(p.fullname);
    if(old?.signature===signature && old.record.publicCheckedAt && time-old.record.publicCheckedAt<(old.record.publicStatus==='unknown'?60000:TTL)){paint(old.record);if(old.dirty){old.p=p;pending.push(old);}continue;}
    let result=verdict(p),saved=!old?this.saved[p.fullname]:null;
    if(saved?.publicCheckedAt && time-saved.publicCheckedAt<(saved.publicStatus==='unknown'?60000:TTL) && time>=saved.publicCheckedAt && (this.settings.archiveDiscovery || !saved.why?.startsWith('The archive')) && (result.state===saved.state || result.state==='unknown' || result.state==='removed-unknown' && saved.state.startsWith('removed-')) && result.state!=='deleted'){
     const entry={signature,record:saved};this.entries.set(p.fullname,entry);paint(saved);continue;
    }
    const entry={signature,p,dirty:true,refresh:Boolean(old),record:{...result,fullname:p.fullname,permalink:p.permalink,checkedAt:Math.max(time,(old?.record.checkedAt || 0)+1)}};
    this.entries.set(p.fullname,entry);paint(entry.record);pending.push(entry);
   }
   for(const pill of this.doc.querySelectorAll('[data-rt-own-removal]'))if(!owned.has(pill.closest('shreddit-post,shreddit-profile-comment,shreddit-comment')))pill.remove();
   for(const entry of pending){
    if(!this.current(me,generation))return;if(!this.visible())break;
    if(entry.record.publicCheckedAt && time-entry.record.publicCheckedAt<(entry.record.publicStatus==='unknown'?60000:TTL))continue;
    const restricted=['private','employees_only','gold_restricted'].includes(entry.p.moderation.subredditType) || entry.p.moderation.quarantined;
    let proof;if(restricted){proof={status:'unknown',verified:false};entry.archiveDone=true;}else try{proof=await this.check({...me,fullname:entry.p.fullname,refresh:entry.refresh},controller.signal);}catch(e){proof={status:'unknown',verified:false,why:e.message};}
    if(!this.current(me,generation))return;
    if(!proof || proof.verified && proof.fullname!==entry.p.fullname || !['visible','removed','deleted','unknown'].includes(proof.status))proof={status:'unknown',verified:false};
    entry.proof=proof;Object.assign(entry.record,verdict(entry.p,null,this.settings.archiveDiscovery?'missing':'off',proof));entry.record.publicStatus=proof.verified?proof.status:'unknown';entry.record.publicCheckedAt=proof.checkedAt || this.now();entry.record.checkedAt=Math.max(this.now(),entry.record.publicCheckedAt,entry.record.checkedAt);for(const host of hosts.get(entry.p.fullname) || [])this.paint(host,entry.record);
   }
   for(const kind of ['post','comment']){
    const candidates=pending.filter(e=>e.p.kind===kind && e.record.publicCheckedAt && !e.archiveDone && !e.p.moderation.category && !['visible','deleted'].includes(e.record.state));
    if(!this.settings.archiveDiscovery)continue;
    for(let i=0;i<candidates.length;i+=25){
     if(!this.current(me,generation))return;if(!this.visible())break;const group=candidates.slice(i,i+25);let response;
     try{response=await this.archive({action:'archive-removal',monitor:true,...me,kind,ids:group.map(e=>e.p.id)});if(!response?.ok)throw Error(response?.error || 'Archive unavailable');}
     catch{response=null;}
     if(!this.current(me,generation))return;
     for(const entry of group){const raw=response?.posts?.find(a=>(a.fullname || (kind==='post'?'t3_':'t1_')+a.id)===entry.p.fullname && a.author?.toLowerCase()===me.username.toLowerCase());
      const body=raw?.archiveStatus==='removed' || raw?.status==='removed'?'[removed]':raw?.body;
      const archive=raw?{kind,...(kind==='post'?{title:raw.title || '',selftext:body}:{body}),created_utc:raw.created || raw.created_utc,retrieved_on:raw.retrieved || raw.retrieved_on}:null;
      entry.archiveDone=true;Object.assign(entry.record,verdict(entry.p,archive,response?archive?'ok':'missing':'failed',entry.proof));for(const host of hosts.get(entry.p.fullname) || [])this.paint(host,entry.record);
     }
    }
   }
   if(!this.current(me,generation))return;
   if(this.entries.size>5000)for(const id of [...this.entries.keys()].slice(0,this.entries.size-5000))this.entries.delete(id);
   const ready=pending.filter(e=>e.record.publicCheckedAt && (!this.settings.archiveDiscovery || e.archiveDone || e.p.moderation.category || ['visible','deleted'].includes(e.record.state)));
   for(let i=0;i<ready.length;i+=100){if(!this.current(me,generation))return;const group=ready.slice(i,i+100);try{const r=await this.send({action:'record',...me,records:group.map(e=>e.record)});if(r?.ok===false)this.error=r.error;else for(const entry of group)entry.dirty=false;}catch(e){this.error=e.message;}}
  }
  paint(card,record){
   const existing=[...card.querySelectorAll('[data-rt-own-removal]')].filter(n=>n.closest('shreddit-post,shreddit-profile-comment,shreddit-comment')===card);
   if(record.state==='visible' || record.state==='unknown'){for(const n of existing)n.remove();return;}
   let pill=existing.shift();for(const n of existing)n.remove();if(!pill){pill=this.doc.createElement('span');pill.dataset.rtOwnRemoval='';pill.className='rt-removal-pill rt-own-removal inline-flex items-center gap-2xs text-12 font-semibold';}
   const label=(R.STATES[record.state]?.label || 'Couldn’t check')+(record.confidence==='likely' && record.state!=='removed-unknown'?' (likely)':'');
   if(pill.textContent!==label)pill.textContent=label;pill.dataset.rtRemoval=record.state;pill.title=[record.why,'Checked '+new Date(record.checkedAt).toLocaleString()].filter(Boolean).join(' · ');pill.setAttribute('role','img');pill.setAttribute('aria-label',label+'. '+record.why);
   if(!pill.isConnected){const time=[...card.querySelectorAll('faceplate-timeago')].find(n=>n.closest('shreddit-post,shreddit-profile-comment,shreddit-comment')===card);const meta=card.querySelector('[slot="commentMeta"],[slot="credit-bar"],[id^="poster-info-"]');if(time)time.after(pill);else if(meta)meta.append(pill);}
  }
  destroy(){this.dead=true;this.generation++;this.proofController?.abort();this.watch(false);if(this.queued)this.doc.defaultView.cancelAnimationFrame(this.queued);globalThis.chrome?.runtime?.onMessage?.removeListener?.(this.message);this.clearBadges();this.entries.clear();}
 }
 globalThis.RTOwnRemoval=Object.freeze({Monitor});
 if(window.top===window && globalThis.chrome?.runtime?.id && location.hostname!=='old.reddit.com')globalThis.RTOwnRemovalInstance=new Monitor();
})();
