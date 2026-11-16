/* Per-account verdicts, change history and bounded saved Removed results. Credentials are never stored. */
(() => {
 'use strict';
 if(globalThis.RTRemovalStore)return;
 const R=globalThis.RTRemovalModel,prefix='rt-removal-v1:';
 const account=(owner,username)=>{if(!/^t2_[a-z0-9]{1,13}$/i.test(owner || '') || !/^[\w-]{1,20}$/.test(username || ''))throw Error('Invalid monitoring account.');};
 function create({storage,now=()=>Date.now(),limit=5000,changesLimit=50}={}){
  const locks=new Map();
  function clean(raw){
   if(!raw || !/^t[13]_[a-z0-9]{1,32}$/.test(raw.fullname || '') || !Object.hasOwn(R.STATES,raw.state) || !['verified','likely','unknown'].includes(raw.confidence) || !Number.isFinite(raw.checkedAt) || raw.checkedAt<=0 || raw.checkedAt>now()+1000)throw Error('Invalid removal observation.');
   let url;try{url=new URL(raw.permalink,'https://www.reddit.com');}catch{throw Error('Invalid item link.');}
   if(url.origin!=='https://www.reddit.com' || !/^\/(?:r|user)\/[\w-]+\/comments\/[a-z0-9]+\//i.test(url.pathname))throw Error('Invalid item link.');
   const publicProof=Number.isFinite(raw.publicCheckedAt) && raw.publicCheckedAt>0 && raw.publicCheckedAt<=raw.checkedAt && ['visible','removed','deleted','unknown'].includes(raw.publicStatus)?{publicStatus:raw.publicStatus,publicCheckedAt:raw.publicCheckedAt}:{};
   return {fullname:raw.fullname,state:raw.state,removed:raw.state.startsWith('removed-'),confidence:raw.confidence,why:typeof raw.why==='string'?raw.why.slice(0,800):'',flags:Array.isArray(raw.flags)?[...new Set(raw.flags.filter(x=>['locked','collapsed','approved-after-auto','quarantined-community','private-community'].includes(x)))]:[],permalink:url.pathname,checkedAt:Math.floor(raw.checkedAt),...publicProof};
  }
  const serial=(owner,run)=>{const previous=locks.get(owner) || Promise.resolve(),job=previous.catch(()=>{}).then(run);locks.set(owner,job);return job.finally(()=>{if(locks.get(owner)===job)locks.delete(owner);});};
  async function read(owner,username){
   account(owner,username);const key=prefix+owner.toLowerCase(),value=(await storage.get(key))?.[key],items={};
   if(value?.username?.toLowerCase()===username.toLowerCase())for(const raw of Object.values(value.items || {}).slice(-limit))try{const item=clean(raw);if(raw.known && raw.known.state!=='unknown')item.known=clean(raw.known);items[item.fullname]=item;}catch{}
   const changes=(value?.username?.toLowerCase()===username.toLowerCase() && Array.isArray(value.changes)?value.changes:[]).slice(0,changesLimit).flatMap(raw=>{try{const item=clean(raw);return ['removed','approved','locked','unlocked'].includes(raw.type)?[{...item,type:raw.type,unread:raw.unread===true}]:[];}catch{return [];}});
   return {owner:owner.toLowerCase(),username,items,changes,unread:changes.filter(x=>x.unread).length,lastChecked:Math.max(0,...Object.values(items).map(x=>x.checkedAt))};
  }
  const save=value=>storage.set({[prefix+value.owner]:value});
  async function record({owner,username,records,notify=false}){
   account(owner,username);if(!Array.isArray(records) || records.length>100)throw Error('Invalid monitoring batch.');
   const incoming=records.map(clean);owner=owner.toLowerCase();
   return serial(owner,async()=>{
    const value=await read(owner,username);
    for(const item of incoming){
     const previous=value.items[item.fullname];if(previous && previous.checkedAt>=item.checkedAt)continue;
     const known=previous?.known || (previous?.state!=='unknown'?previous:null),transition=item.publicCheckedAt && previous && !previous.publicCheckedAt?null:R.change(known || previous,item);
     if(transition)value.changes.unshift({...item,type:transition,unread:notify===true});
     value.items[item.fullname]={...item,...(item.state==='unknown' && known?{known}:item.state!=='unknown'?{known:{...item}}:{})};
    }
    const sorted=Object.values(value.items).sort((a,b)=>b.checkedAt-a.checkedAt);value.items=Object.fromEntries(sorted.slice(0,limit).map(item=>[item.fullname,item]));value.changes=value.changes.slice(0,changesLimit);value.unread=value.changes.filter(x=>x.unread).length;value.lastChecked=sorted[0]?.checkedAt || 0;await save(value);return value;
   });
  }
  const seen=(owner,username)=>{account(owner,username);return serial(owner.toLowerCase(),async()=>{const value=await read(owner,username);for(const c of value.changes)c.unread=false;value.unread=0;await save(value);return value;});};
  const clear=owner=>{account(owner,'valid');owner=owner.toLowerCase();return serial(owner,async()=>{for(const key of [prefix,'rt-removal-proofs-v1:','rt-removal-list-v1:'])await storage.remove(key+owner);});};
  /* The Removed view's cache of signed-out results (spec §18 P6, §27): status, time and item date only, per account, so
     reopening the view skips items checked recently. For items from the last week, when removals happen, visible lasts
     12 hours and removed/deleted 24 hours; once an item is older than a week, any result lasts 7 days. Unknown is never kept. */
  const proofPrefix='rt-removal-proofs-v1:',week=604800000,ttl={visible:43200000,removed:86400000,deleted:86400000};
  const life=raw=>Number.isFinite(raw.created) && raw.created>0 && raw.checkedAt-raw.created*1000>week?week:ttl[raw.status];
  const fresh=(raw,t)=>Object.hasOwn(ttl,raw?.status) && Number.isFinite(raw.checkedAt) && raw.checkedAt<=t && t-raw.checkedAt<life(raw);
  const keep=raw=>({status:raw.status,checkedAt:raw.checkedAt,...(Number.isFinite(raw.created) && raw.created>0?{created:Math.floor(raw.created)}:{})});
  const freshProofs=(value,username)=>{const out={};if(value?.username?.toLowerCase()!==username.toLowerCase())return out;const t=now();
   for(const [fullname,raw] of Object.entries(value.proofs || {}))if(/^t[13]_[a-z0-9]{1,32}$/.test(fullname) && fresh(raw,t))out[fullname]=keep(raw);return out;};
  async function readProofs(owner,username){account(owner,username);const key=proofPrefix+owner.toLowerCase();return freshProofs((await storage.get(key))?.[key],username);}
  function saveProofs({owner,username,proofs}){
   account(owner,username);if(!Array.isArray(proofs) || proofs.length>500)throw Error('Invalid result batch.');owner=owner.toLowerCase();
   return serial('proofs:'+owner,async()=>{
    const key=proofPrefix+owner,current=freshProofs((await storage.get(key))?.[key],username),t=now();
    for(const proof of proofs)if(/^t[13]_[a-z0-9]{1,32}$/.test(proof?.fullname || '') && fresh(proof,t))current[proof.fullname]=keep(proof);
    const kept=Object.entries(current).sort((a,b)=>b[1].checkedAt-a[1].checkedAt).slice(0,limit);
    await storage.set({[key]:{username,proofs:Object.fromEntries(kept)}});
   });
  }
  /* The saved Removed list (spec §27): the last complete Removed result for this account, so reopening Removed or its
     search shows it at once while a fresh walk confirms it. Removed items only: identity, date, community, link, verdict
     and the item's own title and text (bounded) so search can match it. Replaced on each complete walk; kept 30 days. */
  const listPrefix='rt-removal-list-v1:',listLife=2592000000,listLimit=2000;
  const listFlags=['deleted-later','gone','locked','approved-after-auto'];
  function cleanListItem(raw){
   const comment=raw?.kind==='comment',fullname=String(raw?.fullname || '');
   if(!(comment?/^t1_[a-z0-9]{1,32}$/:/^t3_[a-z0-9]{1,10}$/).test(fullname) || fullname.slice(3)!==raw.id || !Number.isFinite(raw.created) || raw.created<=0)return null;
   const removal=raw.removal;if(!removal || !Object.hasOwn(R.STATES,removal.state) || !removal.state.startsWith('removed-') || !['verified','likely'].includes(removal.confidence))return null;
   let url;try{url=new URL(raw.permalink,'https://www.reddit.com');}catch{return null;}
   if(url.origin!=='https://www.reddit.com' || !/^\/(?:r|user)\/[\w-]+\/comments\/[a-z0-9]+\//i.test(url.pathname))return null;
   const text=(value,max)=>typeof value==='string'?value.slice(0,max):'';
   const facts={};for(const key of ['score','comments','postScore','postComments'])if(typeof raw[key]==='number' && Number.isFinite(raw[key]))facts[key]=Math.max(key==='score'||key==='postScore'?-1e9:0,Math.min(1e9,Math.floor(raw[key])));
   const thumbnail=globalThis.RTPostModel?.mediaUrl(raw.thumbnail);if(thumbnail && thumbnail.length<=2048)facts.thumbnail=thumbnail;
   return {...facts,fullname,kind:comment?'comment':'post',id:raw.id,created:Math.floor(raw.created),subreddit:/^[\w]{1,21}$/.test(raw.subreddit || '')?raw.subreddit:'',permalink:url.pathname,title:text(raw.title,300),body:text(raw.body,4000),
    source:raw.source==='arctic-shift'?'arctic-shift':'reddit',postType:/^[a-z]{1,16}$/.test(raw.postType || '')?raw.postType:'',over18:raw.over18===true,spoiler:raw.spoiler===true,
    removal:{state:removal.state,confidence:removal.confidence,why:text(removal.why,800),flags:Array.isArray(removal.flags)?[...new Set(removal.flags.filter(flag=>listFlags.includes(flag)))]:[]}};
  }
  async function readList(owner,username){
   account(owner,username);const key=listPrefix+owner.toLowerCase(),value=(await storage.get(key))?.[key];
   if(value?.username?.toLowerCase()!==username.toLowerCase() || !Number.isFinite(value.savedAt) || now()-value.savedAt>=listLife)return {items:[],savedAt:0};
   const historyAt=Number.isFinite(value.historyAt) && value.historyAt>0 && value.historyAt<=now()?value.historyAt:0;
   return {items:(Array.isArray(value.items)?value.items:[]).slice(0,listLimit).map(cleanListItem).filter(Boolean),savedAt:value.savedAt,historyAt};
  }
  // historyAt: when the last complete archive-history read started (spec §31), so later reads can stop at it.
  function saveList({owner,username,items,historyAt}){
   account(owner,username);if(!Array.isArray(items) || items.length>listLimit)throw Error('Invalid Removed list.');owner=owner.toLowerCase();
   return serial('list:'+owner,()=>storage.set({[listPrefix+owner]:{username,savedAt:now(),...(Number.isFinite(historyAt) && historyAt>0 && historyAt<=now()?{historyAt}:{}),items:items.map(cleanListItem).filter(Boolean)}}));
  }
  return Object.freeze({read,record,seen,clear,readProofs,saveProofs,readList,saveList});
 }
 globalThis.RTRemovalStore=Object.freeze({create,prefix});
})();
