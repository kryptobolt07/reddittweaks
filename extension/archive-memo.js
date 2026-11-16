/* Bounded public archive response reuse in trusted browser-session memory, never disk. */
(() => {
 'use strict';
 if(globalThis.RTArchiveMemo)return;
 const storageKey='rt-own-archive-session-v1',validKey=k=>typeof k==='string' && /^t2_[a-z0-9]{1,13}:[\w-]{1,20}:/.test(k) && k.length<512;
 const copy=value=>JSON.parse(JSON.stringify(value));
 function create({storage,now=()=>Date.now(),limit=512,maxBytes=2097152}={}){
  let entries=new Map(),loaded,tail=Promise.resolve(),generation=0;
  const size=value=>{const json=JSON.stringify(value);return globalThis.TextEncoder?new TextEncoder().encode(json).length:json.length*3;};
  function trim(){
   const time=now(),kept=new Map();let bytes=32;
   for(const [key,record] of [...entries].reverse().sort((a,b)=>b[1].touched-a[1].touched)){
    if(!validKey(key) || !record?.value || typeof record.value!=='object' || !Number.isFinite(record?.expires) || record.expires<=time || record.expires>time+86400000 || !Number.isFinite(record.touched) || record.touched>time)continue;
    const count=size([key,record]);if(kept.size>=limit || bytes+count>maxBytes)continue;bytes+=count;kept.set(key,record);
   }entries=new Map([...kept].reverse());
  }
  const load=()=>loaded ||= (async()=>{try{const stored=(await storage?.get(storageKey))?.[storageKey];if(stored && typeof stored==='object')entries=new Map(Object.entries(stored));trim();}catch{entries.clear();}})();
  const serial=run=>{const task=tail.catch(()=>{}).then(async()=>{await load();return run();});tail=task;return task;};
  const get=keys=>serial(()=>{trim();const out={};for(const key of keys){const record=entries.get(key);if(record)out[key]=copy(record.value);}return out;});
  const put=(records,expected=generation)=>serial(async()=>{
   if(expected!==generation)return;
   const time=now();for(const {key,value,ttl} of records){if(!validKey(key) || !Number.isFinite(ttl) || ttl<=0 || ttl>86400000)continue;
    const record={value:copy(value),expires:time+ttl,touched:time};entries.delete(key);entries.set(key,record);
   }trim();try{await storage?.set({[storageKey]:Object.fromEntries(entries)});}catch{}
  });
  const clear=()=>{generation++;return serial(async()=>{entries.clear();try{await storage?.remove(storageKey);}catch{}});};
  return Object.freeze({get,put,clear});
 }
 globalThis.RTArchiveMemo=Object.freeze({create,storageKey});
})();
