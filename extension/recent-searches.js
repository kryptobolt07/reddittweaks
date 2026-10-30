/* Recent searches for profile and subreddit search, kept per signed-in account. Callers save only on submit. */
(() => {
  'use strict';
  const prefix='rt-recent-v1:',perScope=8,perAccount=40,maxQuery=256;
  const ownerOK=value=>typeof value==='string' && /^[A-Za-z0-9_:-]{1,64}$/.test(value);
  const scopeOK=value=>typeof value==='string' && /^(profile|subreddit):[a-z0-9_-]{1,64}$/.test(value);
  const folded=query=>query.toLowerCase();
  const normal=query=>{const q=typeof query==='string'?query.trim():'';return q && q.length<=maxQuery?q:'';};
  const queues=new Map();
  // Writes for one account run in order, so two quick submits cannot overwrite each other.
  function serial(owner,task) {
    const run=(queues.get(owner) || Promise.resolve()).then(task),tail=run.catch(()=>{});
    queues.set(owner,tail);tail.then(()=>{if(queues.get(owner)===tail)queues.delete(owner);});
    return run;
  }
  function clean(value) {
    if(!Array.isArray(value))return [];
    return value.filter(entry=>entry && normal(entry.q) && normal(entry.q)===entry.q && Number.isFinite(entry.at))
      .map(entry=>({q:entry.q,at:entry.at})).sort((a,b)=>b.at-a.at).slice(0,perScope);
  }
  async function readAccount(owner) {
    const key=prefix+owner,stored=await chrome.storage.local.get(key),scopes=new Map(),raw=stored[key]?.scopes;
    if(raw && typeof raw==='object' && !Array.isArray(raw))for(const scope of Object.keys(raw)) {
      if(!scopeOK(scope))continue;
      const entries=clean(raw[scope]);
      if(entries.length)scopes.set(scope,entries);
    }
    return scopes;
  }
  async function writeAccount(owner,scopes) {
    const key=prefix+owner;
    if(!scopes.size)await chrome.storage.local.remove(key);
    else await chrome.storage.local.set({[key]:{scopes:Object.fromEntries(scopes)}});
  }
  // Least recently used scopes lose their oldest entries first until the account fits its total.
  function trim(scopes) {
    let excess=[...scopes.values()].reduce((count,list)=>count+list.length,0)-perAccount;
    const order=[...scopes.entries()].sort((a,b)=>a[1][0].at-b[1][0].at);
    for(const [scope,list] of order) {
      if(excess<=0)break;
      while(excess>0 && list.length){list.pop();excess--;}
      if(!list.length)scopes.delete(scope);
    }
  }
  const entriesOf=(scopes,scope)=>(scopes.get(scope) || []).map(({q,at})=>({q,at}));
  async function mutate(owner,scope,change) {
    return serial(owner,async()=>{
      const scopes=await readAccount(owner);
      change(scopes);trim(scopes);await writeAccount(owner,scopes);
      return entriesOf(scopes,scope);
    });
  }
  // Invalid input is ignored: reads return [] and writes change nothing.
  async function list(owner,scope) {
    if(!ownerOK(owner) || !scopeOK(scope))return [];
    return serial(owner,async()=>entriesOf(await readAccount(owner),scope));
  }
  async function add(owner,scope,query) {
    const q=normal(query);
    if(!ownerOK(owner) || !scopeOK(scope) || !q)return list(owner,scope);
    return mutate(owner,scope,scopes=>{
      const latest=Math.max(0,...[...scopes.values()].map(entries=>entries[0].at));
      // Timestamps strictly increase per account, so ordering stays stable within one millisecond.
      const at=Math.max(Date.now(),latest+1),rest=(scopes.get(scope) || []).filter(entry=>folded(entry.q)!==folded(q));
      scopes.set(scope,[{q,at},...rest].slice(0,perScope));
    });
  }
  async function remove(owner,scope,query) {
    const q=normal(query);
    if(!ownerOK(owner) || !scopeOK(scope) || !q)return list(owner,scope);
    return mutate(owner,scope,scopes=>{
      const rest=(scopes.get(scope) || []).filter(entry=>folded(entry.q)!==folded(q));
      if(rest.length)scopes.set(scope,rest);else scopes.delete(scope);
    });
  }
  async function clear(owner,scope) {
    if(!ownerOK(owner) || (scope!==undefined && !scopeOK(scope)))return [];
    return mutate(owner,scope,scopes=>{
      if(scope===undefined)scopes.clear();else scopes.delete(scope);
    });
  }
  globalThis.RTRecentSearches=Object.freeze({list,add,remove,clear});
})();
