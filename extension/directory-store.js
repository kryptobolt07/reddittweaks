(() => {
  const listeners=new Set();
  let currentOwner='',inFlight=null;
  const supported=Boolean(globalThis.chrome?.runtime?.sendMessage);
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  let startup={pending:supported,owner:'',entry:null};
  async function broker(action,parameters={}) {
    const result=await chrome.runtime.sendMessage({scope:'rcs-directory',action,...parameters});
    if(!result?.ok)throw Error(result?.error || 'Username cache unavailable. Please retry.');
    return result;
  }
  let startupReady=null;
  function ensureStartup() {
    if(!supported)return Promise.resolve();
    if(!startupReady) {
      startup={...startup,pending:true};
      startupReady=restoreStartup().finally(()=>{if(!startup.owner)startupReady=null;});
    }
    return startupReady;
  }
  async function restoreStartup() {
    document.dispatchEvent(new CustomEvent('rcs-native-identities-start'));
    try {
      const context=await RCSData.request('identity-context').promise;
      // Only the signed-in account's saved directory crosses into this frame, and only once its owner is known.
      const entry=(await broker('read',{owner:context.owner}).catch(()=>null))?.entry || null;
      const people=Object.values(entry?.identities || {}).filter(p=>p.accountUnavailable && p.historicalName);
      const rooms=(entry?.records || []).filter(r=>r.type==='direct' && r.accountUnavailable && r.historicalName && r.participantIds.length===1).map(r=>({id:r.id,person:r.participantIds[0]}));
      await RCSData.request('identity-snapshot',{owner:context.owner,people,rooms,records:entry?.records || [],identities:Object.values(entry?.identities || {}),restoring:!entry?.directoryComplete}).promise;
      currentOwner=context.owner;startup={pending:false,owner:context.owner,entry};
      for(const listener of listeners)listener({owner:currentOwner,records:entry?.records || [],restored:true});
    } catch {
      startup={pending:false,owner:'',entry:null};
      document.dispatchEvent(new CustomEvent('rcs-native-identities-clear'));
      for(const listener of listeners)listener({restored:true,records:[]});
    }
  }
  function load(force=false,onProgress) {
    if(inFlight)return subscribe(inFlight,onProgress);
    const job={cancelled:false,task:null,listeners:new Set(),users:0,partial:new Map(),checkpoints:Promise.resolve()};
    inFlight=job;
    job.promise=run(job,force).finally(()=>{
      if(inFlight===job)inFlight=null;
      if(job.changed)setTimeout(()=>{for(const listener of listeners)listener(job.changed);},0);
    });
    return subscribe(job,onProgress);
  }
  function subscribe(job,onProgress) {
    job.users++;if(onProgress)job.listeners.add(onProgress);
    let settled=false,rejectCancel;
    const detach=()=>{if(settled)return;settled=true;job.users--;job.listeners.delete(onProgress);};
    const cancelled=new Promise((_,reject)=>rejectCancel=reject);
    const promise=Promise.race([job.promise,cancelled]).finally(detach);
    return {promise,cancel(){if(settled)return;detach();rejectCancel(Error('Search cancelled'));if(!job.users){job.cancelled=true;job.task?.cancel();}}};
  }
  function progress(job,value) {
    for(const record of value.records || [])job.partial.set(record.id,record);
    if(job.token && value.records?.length) {
      const token=job.token;
      job.checkpoints=job.checkpoints.then(()=>broker('checkpoint',{owner:job.owner,token,records:value.records,identities:identities(value.records),
        ...(Object.hasOwn(value,'directoryCursor') ? {directoryCursor:value.directoryCursor,discoveryComplete:value.discoveryComplete} : {}),
        ...(Object.hasOwn(value,'activityCursor') ? {activityCursor:value.activityCursor,activityComplete:value.activityComplete} : {})
      })).catch(()=>{});
    }
    for(const listener of job.listeners)listener(value);
  }
  function check(job){if(job.cancelled)throw Error('Search cancelled');}
  async function rpc(job,method,parameters={}) {
    check(job);job.task=RCSData.request(method,parameters,value=>progress(job,value));
    const result=await job.task.promise;check(job);return result;
  }
  function identities(records) {
    return [...new Map(records.flatMap(record=>record.identities || []).map(person=>[person.id,person])).values()];
  }
  async function run(job,force) {
    await ensureStartup();check(job);
    const context=await rpc(job,'directory-context');
    job.owner=context.owner;currentOwner=context.owner;
    if(!supported)return rpc(job,'conversations',{restart:force,refreshProfiles:force});
    let token,renewal,claim;
    let primed='';
    const showSaved=async entry=>{
      if(!entry)return;
      const signature=JSON.stringify([entry.directoryVerifiedAt,entry.nativeRevision,entry.records]);
      if(signature===primed)return;
      progress(job,{records:entry.records,label:'Using saved usernames…',loaded:entry.records.length});
      await rpc(job,'prime-directory',{owner:context.owner,records:entry.records,identities:Object.values(entry.identities || {})});
      primed=signature;
    };
    try {
      claim=await broker('acquire',{owner:context.owner});
      while(claim.busy) {
        check(job);await showSaved(claim.entry);
        const known=new Set((claim.entry?.records || []).map(record=>record.id));
        if(claim.entry?.directoryComplete && !force && !context.ids.some(id=>!known.has(id)) && !context.changedIds?.length)return claim.entry.records;
        await pause(1000);check(job);claim=await broker('acquire',{owner:context.owner});
      }
      token=claim.token;job.token=token;
      renewal=setInterval(()=>broker('renew',{owner:context.owner,token}).catch(()=>{}),20000);
      const entry=claim.entry;
      await showSaved(entry);
      const full=force || !entry?.directoryComplete;
      const knownIds=(entry?.records || []).map(record=>record.id);
      const known=new Set(knownIds);
      const retryIds=(entry?.records || []).filter(record=>record.type!=='reddit_modmail' && !['participants-unavailable','invite-pending'].includes(record.status) && (
        !record.identities?.length || record.identities.some(person=>
          (person.pending || !person.availabilityKnown) && person.profileRetryAt<=Date.now() ||
          person.accountUnavailable && !person.historicalName && !person.recoveryCheckedAt
        )
      )).map(record=>record.id);
      const membershipIds=(entry?.records || []).filter(record=>{
        if(!['participants-unavailable','invite-pending'].includes(record.status) && record.membership!=='invite')return false;
        const native=context.roomMeta?.[record.id];
        return native && (record.status==='participants-unavailable' && native.membership==='invite' || native.membership && native.membership!==record.membership || native.type && native.type!==record.type || record.identityPending && native.hasParticipants || native.name && native.name!=='Empty room' && native.name!==record.name);
      }).map(record=>record.id);
      const changedIds=[...new Set([...(context.changedIds || []),...retryIds,...membershipIds])];
      const needsActivity=!full && !entry.activityComplete && entry.records.some(r=>r.type!=='reddit_modmail' && !r.timestamp);
      if(!full && !context.ids.some(id=>!known.has(id)) && !changedIds.length) {
        await rpc(job,'prime-directory',{owner:context.owner,records:[],ackMetadataVersion:context.metadataVersion});
        if(!needsActivity)return entry.records;
      }
      let records=full || context.ids.some(id=>!known.has(id)) || changedIds.length ? await rpc(job,'conversations',full ? {restart:force,refreshProfiles:force,directoryCursor:!force ? entry?.directoryCursor : null} : {knownIds,changedIds,profileChangedIds:context.profileChangedIds || []}) : [];
      if(needsActivity)records=[...records,...await rpc(job,'activity',{activityCursor:entry.activityCursor})];
      const after=await rpc(job,'directory-context');
      if(after.owner!==context.owner)throw Error('Reddit account changed. Please retry.');
      await job.checkpoints;
      const result=await broker('publish',{owner:context.owner,token,records,identities:identities(records),
        revision:full ? JSON.stringify(records.map(r=>r.id).sort()) : entry.revision,
        nativeRevision:after.revision,full,activityComplete:full || needsActivity});
      startup={pending:false,owner:context.owner,entry:result.entry};
      token=null;job.token=null;
      if(after.revision!==context.revision || after.metadataVersion!==context.metadataVersion)job.changed=after;
      else await rpc(job,'prime-directory',{owner:context.owner,records:[],ackMetadataVersion:after.metadataVersion});
      return result.entry.records;
    } catch(error) {
      await job.checkpoints;
      if(token && job.partial.size && !job.accountChanged)await broker('checkpoint',{owner:context.owner,token,records:[...job.partial.values()],
        identities:identities([...job.partial.values()]),nativeRevision:context.revision}).catch(()=>{});
      throw error;
    } finally {
      clearInterval(renewal);
      if(token)await broker('release',{owner:context.owner,token}).catch(()=>{});
    }
  }
  document.addEventListener('rcs-directory-changed',event=>{
    let value;try{value=JSON.parse(event.detail);}catch{return;}
    if(typeof value?.owner!=='string')return;
    const accountChanged=Boolean(currentOwner && currentOwner!==value.owner);
    if(inFlight) {
      inFlight.changed={...value,accountChanged};
      if(accountChanged){inFlight.accountChanged=true;inFlight.cancelled=true;inFlight.task?.cancel();}
    }
    for(const listener of listeners)listener({...value,accountChanged});
  });
  globalThis.chrome?.storage?.onChanged?.addListener(async(changes,area)=>{
    if(area!=='local' || !currentOwner || !changes['rcs-directory-v2:'+currentOwner])return;
    const owner=currentOwner;
    try {
      const result=await broker('read',{owner});
      if(owner!==currentOwner || !result.entry)return;
      for(const listener of listeners)listener({owner,records:result.entry.records,fromStorage:true});
    } catch { /* The active fetch reports storage failures. */ }
  });
  window.addEventListener('online',async()=>{
    if(!supported || !currentOwner)return;
    const owner=currentOwner;
    try {
      if(owner===currentOwner)for(const listener of listeners)listener({owner,reconcile:true});
    } catch { /* A later manual refresh can retry. */ }
  });
  globalThis.RCSDirectory=Object.freeze({load,getOwner:()=>currentOwner,getStartup:()=>startup,onChange(listener){listeners.add(listener);return ()=>listeners.delete(listener);}});
  window.addEventListener('pagehide',event=>{if(!event.persisted && supported && currentOwner)broker('detach',{owner:currentOwner}).catch(()=>{});});
  if(supported) {
    document.addEventListener('rcs-chat-starting',ensureStartup);
    if(document.querySelector('rs-app'))ensureStartup();
  }
})();
