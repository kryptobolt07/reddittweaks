/* Isolated-world client. Page event account claims are checked against native identity. */
(() => {
  const subscribers=new Set(),initializations=new Map(),preparing=new Set(),imports=new Map(),importRequests=new Map(),attachments=new Map(),clearedAccounts=new Set(),captureGaps=new Set(),pending=[];
  const dimensionPatches=new Map();let dimensionTimer=null,dimensionsRunning=false;
  const MAX_BATCHES=500,MAX_EVENTS=10000,MAX_BYTES=8*1024*1024;
  let owner=null,readRevision=0,queue=Promise.resolve(),draining=false,writeError=null,overflowError=null;
  const runtime=globalThis.chrome?.runtime,memory=!runtime?.sendMessage?new RCSMessageStore.Store({indexedDB:null}):null;
  const notify=value=>{if(owner && value.owner && value.owner!==owner)return;for(const listener of subscribers)try{listener(value);}catch{}};
  function discard(account){for(let i=pending.length-1;i>=0;i--)if(!account || pending[i].batch.owner===account)pending.splice(i,1);for(const [key,item]of dimensionPatches)if(!account || item.owner===account){dimensionPatches.delete(key);item.resolve({changed:false});}}
  async function context() {
    const value=await RCSData.request('identity-context').promise;
    if(!RCSMessageStore.ownerOK(value?.owner))throw Error('Authenticated Reddit account unavailable');
    if(owner!==value.owner){if(owner){discard(owner);preparing.delete(owner);initializations.delete(owner);}owner=value.owner;readRevision++;writeError=null;if(overflowError?.account!==owner)overflowError=null;notify({owner,accountChanged:true});}
    return owner;
  }
  async function call(action,parameters={}) {
    if(runtime?.sendMessage){const value=await runtime.sendMessage({scope:'rcs-messages',...parameters,action});if(!value?.ok)throw Error(value?.error || 'Unable to access saved messages');return value;}
    if(action==='ingest')return memory.ingest(parameters);
    if(action==='image-dimensions')return memory.rememberDimensions(parameters);
    if(action==='summaries')return memory.summaries(parameters.owner,{committed:true});
    if(action==='stats')return memory.stats(parameters.owner,{committed:true});
    if(action==='mark-native-import-complete')return {nativeImportComplete:await memory.importState(parameters.owner,true)};
    if(action==='search')return memory.search(parameters.owner,{...parameters,committed:true});
    if(action==='room')return memory.room(parameters.owner,parameters.roomId,undefined,{committed:true});
  }
  async function drain() {
    while(pending.length){const item=pending[0],active=await context();if(!pending.includes(item))continue;if(item.batch.owner!==active){pending.splice(pending.indexOf(item),1);continue;}
      let result;item.inFlight=true;try{result=await call('ingest',item.batch);}finally{item.inFlight=false;}const index=pending.indexOf(item);if(index>=0)pending.splice(index,1);writeError=null;if(result.changed!==false)notify({owner:active,changed:true,roomIds:result.roomIds});}
  }
  function schedule(){if(draining)return queue;draining=true;queue=queue.then(drain).catch(error=>{writeError=error;notify({owner,error:error.message});}).finally(()=>{draining=false;});return queue;}
  function enqueue(batch) {
    const events=Array.isArray(batch.events)?batch.events:[],identities=Array.isArray(batch.identities)?batch.identities.slice(0,1000):[],additions=[];
    for(let offset=0;offset<Math.max(1,events.length);offset+=500){const chunk={owner:batch.owner,roomId:batch.roomId,events:events.slice(offset,offset+500).map(event=>event.room_id?event:{...event,room_id:batch.roomId}),identities,coverage:offset+500>=events.length?batch.coverage:undefined};additions.push({batch:chunk,bytes:JSON.stringify(chunk).length*2});}
    const count=items=>items.reduce((sum,item)=>sum+item.batch.events.length,0),size=items=>items.reduce((sum,item)=>sum+item.bytes,0);
    if(pending.length+additions.length>MAX_BATCHES || count(pending)+count(additions)>MAX_EVENTS || size(pending)+size(additions)>MAX_BYTES){
      overflowError=Error(writeError ? `Saved message storage failed: ${writeError.message}. Waiting to recover captured messages.` : 'Saved message buffer is full. Recovering captured messages…');overflowError.account=batch.owner;overflowError.id=crypto.randomUUID();captureGaps.add(batch.owner);
      notify({owner:batch.owner,error:overflowError.message});
      document.dispatchEvent(new CustomEvent('rcs-message-cache-rejected',{detail:JSON.stringify({owner:batch.owner,id:overflowError.id,roomId:batch.roomId,events:events.map(event=>({roomId:event.room_id || batch.roomId,id:event.event_id,sender:event.sender})),identities:identities.map(person=>person.id)})}));
      schedule();return Promise.reject(overflowError);
    }
    for(const item of additions){
      const tail=pending.at(-1),a=tail?.batch,b=item.batch;
      // Coalesce native one-event bursts before transport, never mutate a batch
      // already handed to the worker or merge away a coverage boundary.
      if(tail && !tail.inFlight && a.owner===b.owner && !a.coverage && !b.coverage && a.events.length+b.events.length<=200 && a.identities.length+b.identities.length<=1000 && tail.bytes+item.bytes<=512*1024){a.events.push(...b.events);a.identities.push(...b.identities);a.roomId=undefined;tail.bytes+=item.bytes;}
      else pending.push(item);
    }
    return schedule();
  }
  document.addEventListener('rcs-message-cache-batch',event=>{let batch;try{batch=JSON.parse(event.detail);}catch{return;}if(batch && RCSMessageStore.ownerOK(batch.owner))enqueue(batch).catch(()=>{});});
  runtime?.onMessage?.addListener(message=>{
    if(message?.scope!=='rcs-messages-changed')return;
    const affectsActive=!message.owner || message.owner===owner;
    if(message.cleared){
      const accounts=message.owner?[message.owner]:new Set([owner,...initializations.keys(),...imports.keys(),...importRequests.keys(),...clearedAccounts,...pending.map(item=>item.batch.owner)]);
      discard(message.owner);
      for(const account of accounts)if(account){initializations.delete(account);preparing.delete(account);captureGaps.delete(account);clearedAccounts.add(account);importRequests.get(account)?.cancel?.();imports.set(account,{available:false,cleared:true});}
      if(affectsActive){readRevision++;writeError=null;overflowError=null;document.dispatchEvent(new CustomEvent('rcs-message-cache-reset',{detail:JSON.stringify({owner:message.owner || owner})}));}
    }
    if(affectsActive)notify({owner,changed:true,cleared:message.cleared,roomIds:message.roomIds});
  });
  async function flush({barrier=false}={}){await queue;if(pending.length)await schedule();if(writeError)throw writeError;if(overflowError && (!owner || overflowError.account===owner) && !barrier)throw overflowError;}
  document.addEventListener('rcs-message-cache-flush',async event=>{
    let value;try{value=JSON.parse(event.detail);}catch{return;}
    if(!RCSMessageStore.ownerOK(value?.owner) || typeof value.id!=='string' || !value.id || value.id.length>100)return;
    let reply;try{if(await context()!==value.owner)throw Error('Reddit account changed. Please retry.');await flush({barrier:true});if(await context()!==value.owner)throw Error('Reddit account changed. Please retry.');reply={ok:true};}catch(error){reply={ok:false,error:error.message};}
    document.dispatchEvent(new CustomEvent('rcs-message-cache-flushed',{detail:JSON.stringify({...reply,owner:value.owner,id:value.id})}));
  });
  document.addEventListener('rcs-message-cache-recovered',event=>{
    let value;try{value=JSON.parse(event.detail);}catch{return;}
    if(!overflowError || value?.owner!==overflowError.account || value.id!==overflowError.id)return;
    if(value.complete===true)captureGaps.delete(value.owner);
    overflowError=null;notify({owner:value.owner,changed:true});
  });
  async function ensureReady(active) {
    if(!initializations.has(active)){
      preparing.add(active);
      const current=()=>initializations.get(active)===task && owner===active && !clearedAccounts.has(active);
      const task=(async()=>{await flush();
        // Completion records a successful past read, not future freshness.
        // Reconcile local cached events once for each new page attachment.
        if(!memory && current()){if(!imports.has(active)){let request;try{request=RCSData.request('cache-native-history',{owner:active,awaitCache:true});importRequests.set(active,request);const result=await request.promise;if(current())imports.set(active,result);}catch(error){if(current()){imports.set(active,{available:false});notify({owner:active,error:error.message});}}finally{if(importRequests.get(active)===request)importRequests.delete(active);}}
          await flush();if(current() && !captureGaps.has(active) && imports.get(active)?.available===true){if(await context()!==active)throw Error('Reddit account changed. Please retry.');if(current())await call('mark-native-import-complete',{owner:active});}}
        return {owner:active};
      })();initializations.set(active,task);
      task.then(()=>{if(initializations.get(active)===task){preparing.delete(active);notify({owner:active,changed:true});}},()=>{if(initializations.get(active)===task){preparing.delete(active);initializations.delete(active);}});
    }
    return initializations.get(active);
  }
  document.addEventListener('rcs-message-cache-connected',async event=>{
    document.dispatchEvent(new CustomEvent('rcs-message-cache-listening'));
    let value;try{value=JSON.parse(event.detail);}catch{return;}
    if(!RCSMessageStore.ownerOK(value?.owner) || typeof value.attachment!=='string' || value.attachment.length>100)return;
    try {
      const active=await context();if(active!==value.owner || clearedAccounts.has(active))return;
      const previous=attachments.get(active);attachments.set(active,value.attachment);
      if(previous && previous!==value.attachment){importRequests.get(active)?.cancel?.();initializations.delete(active);preparing.delete(active);imports.delete(active);}
      await ensureReady(active);
      // A client can expose its account before its database opens. Retry once
      // on the native ready transition, not on every sync heartbeat.
      if(owner===active && value.sourceReady && !clearedAccounts.has(active) && imports.get(active)?.retryable){initializations.delete(active);imports.delete(active);await ensureReady(active);}
    }catch(error){notify({owner:value.owner,error:error.message});}
  });
  async function read(action,parameters={},waitForImport=false) {
    const active=await context(),revision=readRevision;
    if(parameters.retryWrites && pending.length && !draining)schedule();
    const initialization=waitForImport || !writeError && !overflowError?ensureReady(active):null;
    // Interactive reads never drain captures. Only ready()/flush() and native
    // producer acknowledgements establish that pending messages are saved.
    if(waitForImport){await initialization;await flush();}else initialization?.catch(error=>notify({owner:active,error:error.message}));
    const {retryWrites,...options}=parameters,result=await call(action,{...options,owner:active});
    if(await context()!==active)throw Error('Reddit account changed. Please retry.');
    if(revision!==readRevision)throw Error('Saved messages changed. Please retry.');
    return {...result,importing:preparing.has(active),savingPending:pending.length>0,savingError:writeError?.message || '',captureIncomplete:captureGaps.has(active)};
  }
  async function saveDimensionPatches(){
    dimensionTimer=null;if(dimensionsRunning || !dimensionPatches.size)return;dimensionsRunning=true;
    const items=[...dimensionPatches.values()];dimensionPatches.clear();
    try{
      const active=await context(),valid=items.filter(item=>item.owner===active && item.revision===readRevision && !clearedAccounts.has(active));
      const result=valid.length?await call('image-dimensions',{owner:active,records:valid.map(({roomId,eventId,preview,width,height})=>({roomId,eventId,preview,width,height}))}):{changed:false};
      for(const item of items)item.resolve(valid.includes(item)?result:{changed:false});
    }catch{for(const item of items)item.resolve({changed:false});}
    finally{dimensionsRunning=false;if(dimensionPatches.size)dimensionTimer=setTimeout(saveDimensionPatches,100);}
  }
  function rememberImageDimensions(patch){
    if(!RCSMessageStore.ownerOK(patch?.owner))return Promise.resolve({changed:false});
    return new Promise(resolve=>{
      const key=JSON.stringify([patch.owner,patch.roomId,patch.eventId]),old=dimensionPatches.get(key);old?.resolve({changed:false});dimensionPatches.delete(key);
      if(dimensionPatches.size>=100){const first=dimensionPatches.keys().next().value;dimensionPatches.get(first).resolve({changed:false});dimensionPatches.delete(first);}
      dimensionPatches.set(key,{...patch,revision:readRevision,resolve});
      if(!dimensionTimer && !dimensionsRunning)dimensionTimer=setTimeout(saveDimensionPatches,100);
    });
  }
  window.addEventListener('pagehide',event=>{if(!event.persisted){clearTimeout(dimensionTimer);for(const item of dimensionPatches.values())item.resolve({changed:false});dimensionPatches.clear();}});
  globalThis.RCSMessages=Object.freeze({ready:()=>read('stats',{},true),search:parameters=>read('search',parameters),room:roomId=>read('room',{roomId}),stats:()=>read('stats'),summaries:()=>read('summaries'),rememberImageDimensions,flush,subscribe(listener){subscribers.add(listener);return()=>subscribers.delete(listener);}});
  document.dispatchEvent(new CustomEvent('rcs-message-cache-listening'));
})();
