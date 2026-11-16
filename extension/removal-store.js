/* Per-account verdicts and change history. Never stores content bodies or credentials. */
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
  const clear=owner=>{account(owner,'valid');return serial(owner.toLowerCase(),()=>storage.remove(prefix+owner.toLowerCase()));};
  /* The Removed view's cache of signed-out results (spec §18 P6): status and time only, per account, so reopening the
     view skips items checked recently. Visible results last 12 hours, removed/deleted 24 hours; unknown is never kept. */
  const proofPrefix='rt-removal-proofs-v1:',ttl={visible:43200000,removed:86400000,deleted:86400000};
  const freshProofs=(value,username)=>{const out={};if(value?.username?.toLowerCase()!==username.toLowerCase())return out;const t=now();
   for(const [fullname,raw] of Object.entries(value.proofs || {}))if(/^t[13]_[a-z0-9]{1,32}$/.test(fullname) && Object.hasOwn(ttl,raw?.status) && Number.isFinite(raw.checkedAt) && raw.checkedAt<=t && t-raw.checkedAt<ttl[raw.status])out[fullname]={status:raw.status,checkedAt:raw.checkedAt};return out;};
  async function readProofs(owner,username){account(owner,username);const key=proofPrefix+owner.toLowerCase();return freshProofs((await storage.get(key))?.[key],username);}
  function saveProofs({owner,username,proofs}){
   account(owner,username);if(!Array.isArray(proofs) || proofs.length>500)throw Error('Invalid result batch.');owner=owner.toLowerCase();
   return serial('proofs:'+owner,async()=>{
    const key=proofPrefix+owner,current=freshProofs((await storage.get(key))?.[key],username),t=now();
    for(const proof of proofs)if(/^t[13]_[a-z0-9]{1,32}$/.test(proof?.fullname || '') && Object.hasOwn(ttl,proof.status) && Number.isFinite(proof.checkedAt) && proof.checkedAt<=t && t-proof.checkedAt<ttl[proof.status])current[proof.fullname]={status:proof.status,checkedAt:proof.checkedAt};
    const kept=Object.entries(current).sort((a,b)=>b[1].checkedAt-a[1].checkedAt).slice(0,limit);
    await storage.set({[key]:{username,proofs:Object.fromEntries(kept)}});
   });
  }
  return Object.freeze({read,record,seen,clear,readProofs,saveProofs});
 }
 globalThis.RTRemovalStore=Object.freeze({create,prefix});
})();
