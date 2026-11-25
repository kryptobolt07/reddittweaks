/* Bounded public archive response reuse in trusted browser-session memory, never disk. */
(() => {
 'use strict';
 if(globalThis.RTArchiveMemo)return;
 const storageKey='rt-own-archive-session-v1',validKey=k=>typeof k==='string' && /^t2_[a-z0-9]{1,13}:[\w-]{1,20}:/.test(k) && k.length<512;
 const copy=value=>JSON.parse(JSON.stringify(value));
 function create({storage,now=()=>Date.now(),limit=512,maxBytes=2097152}={}){
  let entries=new Map(),loaded,tail=Promise.resolve(),generation=0;
  const encoder=globalThis.TextEncoder?new TextEncoder():null;
  const size=value=>{const json=JSON.stringify(value);return encoder?encoder.encode(json).length:json.length*3;};
  const usable=(record,time)=>record?.value && typeof record.value==='object' && Number.isFinite(record.expires) && record.expires>time && record.expires<=time+86400000 && Number.isFinite(record.touched) && record.touched<=time;
  function pruneExpired(time){
   for(const [key,{record}] of entries)if(!usable(record,time))entries.delete(key);
  }
  function trim(){
   pruneExpired(now());const kept=new Map();let bytes=32;
   for(const [key,entry] of [...entries].reverse().sort((a,b)=>b[1].record.touched-a[1].record.touched)){
    if(kept.size>=limit || bytes+entry.bytes>maxBytes)continue;
    bytes+=entry.bytes;kept.set(key,entry);
   }entries=new Map([...kept].reverse());
  }
  const load=()=>loaded ||= (async()=>{try{
   const stored=(await storage?.get(storageKey))?.[storageKey],time=now();
   if(stored && typeof stored==='object')for(const [key,record] of Object.entries(stored)){
    if(validKey(key) && usable(record,time))entries.set(key,{record,bytes:size([key,record])});
   }
   trim();
  }catch{entries.clear();}})();
  const serial=run=>{const task=tail.catch(()=>{}).then(async()=>{await load();return run();});tail=task;return task;};
  const get=keys=>serial(()=>{pruneExpired(now());const out={};for(const key of keys){const entry=entries.get(key);if(entry)out[key]=copy(entry.record.value);}return out;});
  const put=(records,expected=generation)=>serial(async()=>{
   if(expected!==generation)return;
   const time=now();for(const {key,value,ttl} of records){if(!validKey(key) || !Number.isFinite(ttl) || ttl<=0 || ttl>86400000)continue;
    const record={value:copy(value),expires:time+ttl,touched:time};entries.delete(key);
    if(usable(record,time))entries.set(key,{record,bytes:size([key,record])});
   }
   trim();try{await storage?.set({[storageKey]:Object.fromEntries([...entries].map(([key,entry])=>[key,entry.record]))});}catch{}
  });
  const clear=()=>{generation++;return serial(async()=>{entries.clear();try{await storage?.remove(storageKey);}catch{}});};
  return Object.freeze({get,put,clear});
 }
 globalThis.RTArchiveMemo=Object.freeze({create,storageKey});
})();
