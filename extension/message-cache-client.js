/* Isolated-world client. Page event account claims are checked against native identity. */
(() => {
  const subscribers=new Set(),initializations=new Map(),imports=new Map(),importRequests=new Map(),clearedAccounts=new Set(),captureGaps=new Set(),pending=[];
  const MAX_BATCHES=500,MAX_EVENTS=10000,MAX_BYTES=8*1024*1024;
  let owner=null,queue=Promise.resolve(),draining=false,writeError=null,overflowError=null;
  const runtime=globalThis.chrome?.runtime,memory=!runtime?.sendMessage?new RCSMessageStore.Store({indexedDB:null}):null;
  const notify=value=>{for(const listener of subscribers)try{listener(value);}catch{}};
  function discard(account){for(let i=pending.length-1;i>=0;i--)if(!account || pending[i].batch.owner===account)pending.splice(i,1);}
  async function context() {
    const value=await RCSData.request('identity-context').promise;
    if(!RCSMessageStore.ownerOK(value?.owner))throw Error('Authenticated Reddit account unavailable');
    if(owner!==value.owner){if(owner){discard(owner);initializations.delete(owner);}owner=value.owner;writeError=null;if(overflowError?.account!==owner)overflowError=null;notify({owner,accountChanged:true});}
    return owner;
  }
  async function call(action,parameters={}) {
    if(runtime?.sendMessage){const value=await runtime.sendMessage({scope:'rcs-messages',...parameters,action});if(!value?.ok)throw Error(value?.error || 'Unable to access saved messages');return value;}
    if(action==='ingest')return memory.ingest(parameters);
    if(action==='stats')return memory.stats(parameters.owner);
    if(action==='mark-native-import-complete')return {nativeImportComplete:await memory.importState(parameters.owner,true)};
    if(action==='search')return memory.search(parameters.owner,parameters);
    if(action==='room'){const value=await memory.search(parameters.owner,{roomId:parameters.roomId,limit:500});while(value.hasMore){const page=await memory.search(parameters.owner,{roomId:parameters.roomId,limit:500,offset:value.records.length});value.records.push(...page.records);value.hasMore=page.hasMore;}return value;}
  }
  async function drain() {
    while(pending.length){const item=pending[0],active=await context();if(!pending.includes(item))continue;if(item.batch.owner!==active){pending.splice(pending.indexOf(item),1);continue;}
      item.inFlight=true;try{await call('ingest',item.batch);}finally{item.inFlight=false;}const index=pending.indexOf(item);if(index>=0)pending.splice(index,1);writeError=null;notify({owner:active,changed:true});}
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
      for(const account of accounts)if(account){initializations.delete(account);captureGaps.delete(account);clearedAccounts.add(account);importRequests.get(account)?.cancel?.();imports.set(account,{available:false,cleared:true});}
      if(affectsActive){writeError=null;overflowError=null;document.dispatchEvent(new CustomEvent('rcs-message-cache-reset',{detail:JSON.stringify({owner:message.owner || owner})}));}
    }
    if(affectsActive)notify({owner,changed:true,cleared:message.cleared});
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
      const task=(async()=>{await flush();const value=await call('stats',{owner:active});
        if(!memory && !value.nativeImportComplete){if(!imports.has(active)){try{const request=RCSData.request('cache-native-history',{owner:active,awaitCache:true});importRequests.set(active,request);const result=await request.promise;if(!clearedAccounts.has(active))imports.set(active,result);}catch(error){if(!clearedAccounts.has(active)){imports.set(active,{available:false});notify({owner:active,error:error.message});}}finally{importRequests.delete(active);}}
          await flush();if(!clearedAccounts.has(active) && !captureGaps.has(active) && imports.get(active)?.available===true){if(await context()!==active)throw Error('Reddit account changed. Please retry.');await call('mark-native-import-complete',{owner:active});}}
        return value;
      })();initializations.set(active,task);task.catch(()=>{if(initializations.get(active)===task)initializations.delete(active);});
    }
    return initializations.get(active);
  }
  async function read(action,parameters={}) {const active=await context();await ensureReady(active);await flush();const result=await call(action,{...parameters,owner:active});if(await context()!==active)throw Error('Reddit account changed. Please retry.');return {...result,captureIncomplete:captureGaps.has(active)};}
  globalThis.RCSMessages=Object.freeze({ready:()=>read('stats'),search:parameters=>read('search',parameters),room:roomId=>read('room',{roomId}),stats:()=>read('stats'),flush,subscribe(listener){subscribers.add(listener);return()=>subscribers.delete(listener);}});
})();
