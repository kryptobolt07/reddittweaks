/* Runs in Reddit's page world. Narrow read operations reuse its authenticated client.
 * Access tokens, cookies, and arbitrary URLs are never sent across this bridge. */
(() => {
  if(window.credentialless===true)return;
  const requestEvent = 'rcs-v2-request';
  const responseEvent = 'rcs-v2-response';
  const running = new Map();
  const knownConversations = new Map();
  let knownOwner='';
  let watchedClient=null;
  let watchedOwner='';
  const captureSignatures=new Map();
  const capturedIdentities=new Map();
  const capturedCoverage=new Map();
  let nativeCapture;
  let cacheConsumerReady=false;
  document.addEventListener('rcs-message-cache-listening',event=>{
    const replay=!cacheConsumerReady || event?.detail==='resume';cacheConsumerReady=true;
    if(replay && nativeCapture?.ctx && nativeCapture.owner===nativeCapture.client.getUserId()){
      // The page client can become ready before isolated content scripts attach, or chat indexing may resume.
      // Replay its already-loaded snapshot once, rather than deduplicating data
      // that was emitted while nobody could persist it.
      captureSignatures.clear();capturedIdentities.clear();capturedCoverage.clear();nativeCapture.snapshots.clear();
      seedNativeTimelines(nativeCapture.ctx,{force:true});
      // The original connection announcement may have preceded the isolated
      // consumer too. Replay it so disk-only history imports without search.
      announceNativeCache(nativeCapture.ctx,{force:true});
    }
  });
  let watchedSignature='';
  let watchTimer;
  const identityCaches = new Map();
  const roomStateCaches = new Map();
  const profileCaches = new Map();
  const renderedIdentityCaches = new Map();
  const knownRoomStates = new Map();
  const trafficWaiters = new Map();
  const localCooldowns = new Map();
  const changedRooms = new Set();
  const profileChangedRooms = new Set();
  const nativeHandlers = new Map();
  let metadataVersion=0;
  let bindingClient=null;
  const histories=new RCSHistoryStore(20,room=>document.dispatchEvent(new CustomEvent('rcs-history-changed',{detail:JSON.stringify({owner:room.owner,roomId:room.roomId,evicted:true})})));
  const delay = ms => new Promise(resolve => setTimeout(resolve,ms));
  function problem(message) {const error=new Error(message);error.rcsMessage=message;return error;}
  function descendants(scope) {
    const roots = scope.shadowRoot ? [scope,scope.shadowRoot] : [scope];
    for (let i=0;i<roots.length;i++) for (const element of roots[i].querySelectorAll('*')) {
      if (element.shadowRoot && !element.hasAttribute('data-rcs-ui')) roots.push(element.shadowRoot);
    }
    return roots;
  }
  function context() {
    const direct = document.querySelector('rs-app');
    const shells = [...document.querySelectorAll('div')].filter(element => element.shadowRoot?.querySelector('#resizable'));
    const roots = [...new Set([...(direct ? descendants(direct) : []),...shells.flatMap(descendants)])];
    const all = selector => [...new Set(roots.flatMap(root => [...root.querySelectorAll(selector)]))];
    const find = selector => all(selector)[0];
    const matrix = find('rs-matrix-client');
    const users = all('rs-rooms-nav-room,rs-room,rs-room-info,rs-timeline-event,rs-room-settings')
      .flatMap(host=>[host.users,host.usersController,host.roomController?.users])
      .find(controller=>typeof controller?.getRedditUserById==='function');
    bindingClient=matrix?.client || bindingClient;
    for(const host of all('rs-timeline-event'))try{stampNativeEvent(host);}catch{ /* Future native models must fail open. */ }
    return {client:matrix?.client,users,history:find('rs-history'),find,all};
  }
  function stampNativeEvent(host,client=bindingClient) {
    const value=host.event,raw=value?.event || value,id=value?.getId?.() || raw?.event_id,sender=value?.getSender?.() || raw?.sender,owner=client?.getUserId?.();
    const attribute=(key,value)=>{if(value && host.getAttribute(key)!==value)host.setAttribute(key,value);else if(!value && host.hasAttribute(key))host.removeAttribute(key);};
    attribute('data-rcs-event-id',id);attribute('data-rcs-sender',sender);
    attribute('data-rcs-author-self',sender && owner ? String(sender===owner) : '');
  }
  RCSNativeIdentities.configure(context,stampNativeEvent);
  async function identityReady(job) {
    for(let i=0;i<1200;i++) {
      check(job);const ctx=context();
      if(ctx.client?.getUserId?.())return ctx;
      await delay(25);
    }
    throw problem('Reddit chat is still connecting. Try search again in a moment.');
  }
  async function ready(job,{navigation=false}={}) {
    for (let i=0;i<120;i++) {
      check(job); const current=context();
      if (typeof current.client?.http?.authedRequest==='function' && typeof current.history?.navigate==='function' && current.client.getUserId?.() && (navigation || current.client.isInitialSyncComplete?.())) {
        // Directory/history reads need all native cache pages. Native navigation
        // can initialize its own target once the authenticated router exists;
        // waiting for unrelated startup sync/cache pages blocks saved results.
        if(!navigation)await current.client.syncApi?.savedSyncPromise;
        check(job);return current;
      }
      await delay(250);
    }
    throw problem('Reddit chat is still connecting. Try search again in a moment.');
  }
  function check(job) {
    if (job.cancelled) throw new DOMException('Search cancelled','AbortError');
    if(job.owner && job.ctx?.client.getUserId()!==job.owner)throw problem('Reddit account changed. Please retry.');
  }
  function emit(request,fields) {
    if(request.broadcast){request.broadcast(fields);return;}
    document.dispatchEvent(new CustomEvent(responseEvent,{detail:JSON.stringify({channel:request.channel,id:request.id,...fields})}));
  }
  function unreadCount(room,raw={}) {
    let count;try{count=room?.getUnreadNotificationCount?.('total');}catch{}
    count ??= raw.unread_notifications?.notification_count;
    return Number.isFinite(count) && count>=0 ? count : undefined;
  }
  function directoryContext(ctx) {
    const owner=ctx.client.getUserId();
    const map=ctx.client.getAccountData?.('m.direct')?.getContent() || {};
    const ids=[...new Set([...(ctx.client.getRooms?.() || []).map(room=>room.roomId),...Object.values(map).filter(Array.isArray).flat()])].filter(id=>typeof id==='string').sort();
    const roomMeta=Object.fromEntries((ctx.client.getRooms?.() || []).map(room=>{
      const event=room.getStateEvents?.('com.reddit.chat.type','') || room.currentState?.getStateEvents?.('com.reddit.chat.type','');
      return [room.roomId,{membership:room.getMyMembership?.() || '',type:event?.getContent?.()?.type || '',name:room.name || '',...(unreadCount(room)!==undefined ? {unreadCount:unreadCount(room)} : {}),hasParticipants:(room.getMembers?.() || []).some(member=>member.userId!==owner && ['join','invite'].includes(member.membership))}];
    }));
    return {owner,ids,roomMeta,revision:JSON.stringify(ids),metadataVersion,changedIds:[...changedRooms],profileChangedIds:[...profileChangedRooms]};
  }
  function watchDirectory(ctx) {
    const owner=ctx.client?.getUserId?.();
    if(!owner || watchedClient===ctx.client && watchedOwner===owner)return;
    clearTimeout(watchTimer);
    if(watchedClient?.off)for(const [type,handler]of nativeHandlers)watchedClient.off(type,handler);
    nativeHandlers.clear();changedRooms.clear();profileChangedRooms.clear();metadataVersion=0;
    // A different account's wanted list never carries over; the same account's (sent before its client attached) is kept.
    if(watchedOwner && watchedOwner!==owner)classifier.wanted.clear();
    captureSignatures.clear();capturedIdentities.clear();capturedCoverage.clear();
    watchedClient=ctx.client;watchedOwner=owner;queueMicrotask(()=>pumpClassifier());
    nativeCapture={client:ctx.client,owner,ctx,pending:new Map(),snapshots:new Map(),task:null,recovery:null,incomplete:false,missing:new Set()};
    if(knownOwner!==owner){knownConversations.clear();knownRoomStates.clear();histories.clear();knownOwner=owner;}
    watchedSignature=JSON.stringify(directoryContext(ctx));
    const client=ctx.client,matrixHost=ctx.find?.('rs-matrix-client');
    // Native callbacks must never interrupt Reddit or write an event using a
    // replacement client's account. A queued old callback is ignored too.
    const guarded=operation=>(...values)=>{try{
      if(watchedClient!==client || watchedOwner!==owner || client.getUserId()!==owner || matrixHost && (!matrixHost.isConnected || matrixHost.client!==client))return;
      operation(...values);
    }catch{ /* Future native event models must fail open. */ }};
    if(client.on)for(const type of ['sync','Room','deleteRoom','accountData','Room.name','Room.timeline','Room.localEchoUpdated','Room.receipt','Room.unreadNotifications','Room.redaction','Thread.update','Thread.newReply','RoomState.events','RoomMember.name','event']) {
      const handler=guarded((...values)=>{
        if(type==='Room.receipt' || type==='Room.unreadNotifications'){
          document.dispatchEvent(new CustomEvent('rcs-conversation-activity',{detail:JSON.stringify(directoryContext(ctx))}));return;
        }
        if(type==='event')nativeHistoryEvent(values[0]);
        else {
          if(['Room.timeline','Room.localEchoUpdated','Room.redaction','RoomState.events'].includes(type))nativeHistoryEvent(values[0],values[1]?.roomId);
          if(type==='Thread.update' || type==='Thread.newReply'){
            const thread=values.find(value=>value?.rootEvent),root=thread?.rootEvent;
            if(root)nativeHistoryEvent(root,thread.roomId);
            seedNativeTimelines(ctx);
          }
          if(type==='sync'){seedNativeTimelines(ctx);announceNativeCache(ctx);}
          if(type==='Room')captureNativeRoom(ctx,values[0]);
          signalDirectory(type,...values);
        }
      });
      nativeHandlers.set(type,handler);client.on(type,handler);
    }
    seedNativeTimelines(ctx);
    announceNativeCache(ctx);
  }
  function announceNativeCache(ctx,{force=false}={}) {
    const state=nativeCapture;if(state?.client!==ctx.client || state.owner!==ctx.client.getUserId())return;
    const db=ctx.client.store?.backend?.db,sourceReady=db?.name==='reddit-chat-store' && db.objectStoreNames?.contains('room_timeline');
    if(!force && state.announced && (!sourceReady || state.localSource===db))return;
    if(sourceReady && state.localSource && state.localSource!==db)state.attachment=crypto.randomUUID();
    state.announced=true;state.localSource=sourceReady?db:null;state.attachment ||= crypto.randomUUID();
    document.dispatchEvent(new CustomEvent('rcs-message-cache-connected',{detail:JSON.stringify({owner:state.owner,attachment:state.attachment,sourceReady:Boolean(sourceReady)})}));
  }
  function cacheIdentity(ctx,id) {
    const person=historyIdentity(ctx,id);
    return {id,...person,availabilityKnown:person.self || Boolean(profileCache(ctx).get(id)?.availabilityKnown)};
  }
  function previewURL(value){
    if(typeof value!=='string' || !value || value.length>2000)return '';
    try{const url=new URL(value);if(url.protocol!=='https:' || url.username || url.password || url.hash)return '';
      for(const key of url.searchParams.keys())if(/token|auth|signature|credential|password|(?:^|[_-])key(?:$|[_-])/i.test(key))return '';
      return url.href;
    }catch{return '';}
  }
  function imageDimensions(info){
    const w=info?.w ?? info?.width,h=info?.h ?? info?.height;
    return Number.isFinite(w) && Number.isFinite(h) && w>=1 && h>=1 && w<=100000 && h<=100000?{attachmentWidth:Math.round(w),attachmentHeight:Math.round(h)}:{};
  }
  function previewMetadata(content,type,client){
    const attachmentType=type==='m.sticker'?'image':({'m.image':'image','m.video':'video','m.audio':'audio','m.file':'file'}[content?.msgtype] || '');
    const attachmentMime=typeof content?.info?.mimetype==='string'?content.info.mimetype.slice(0,200).trim().toLowerCase().split(';')[0]:'';
    let attachmentPreview='',dimensions={};
    if(attachmentType==='image')for(const [reference,info]of [[content?.url,content?.info],[content?.info?.thumbnail_url,content?.info?.thumbnail_info],[content?.rcs_preview_url,content?.info]]){
      let source=reference;
      // Request a bounded high-density preview from the original media, rather
      // than resizing an already-small thumbnail. Never download bytes here.
      if(typeof source==='string' && source.startsWith('mxc://'))try{source=client?.mxcUrlToHttp?.(source,384,256,'scale') || '';}catch{source='';}
      attachmentPreview=previewURL(source);if(attachmentPreview){dimensions=imageDimensions(info);break;}
    }
    return {attachmentType,attachmentMime,attachmentPreview,...dimensions};
  }
  function compactCacheEvent(value,roomId,client) {
    const raw=value?.event || value;
    if(typeof raw?.event_id!=='string' || !raw.event_id || raw.event_id.startsWith('~') || !['m.room.message','m.sticker','m.room.redaction'].includes(raw.type))return;
    const id=raw.room_id || value?.getRoomId?.() || roomId;if(!id)return;
    const content=raw.content || {},keep=source=>{
      const result={};for(const key of ['body','msgtype','m.relates_to'])if(source?.[key]!==undefined)result[key]=source[key];if(typeof source?.info?.mimetype==='string')result.info={mimetype:source.info.mimetype.slice(0,200)};
      const media=previewMetadata(source,raw.type,client);if(media.attachmentPreview)result.rcs_preview_url=media.attachmentPreview;
      if(media.attachmentWidth){result.info={...result.info,w:media.attachmentWidth,h:media.attachmentHeight};}return result;
    };
    const saved={event_id:raw.event_id,room_id:id,type:raw.type,sender:raw.sender,origin_server_ts:raw.origin_server_ts,seq_id:raw.seq_id,content:keep(content)};
    if(content['m.new_content'])saved.content['m.new_content']=keep(content['m.new_content']);
    if(content.redacts)saved.content.redacts=content.redacts;
    if(raw.redacts)saved.redacts=raw.redacts;
    const relations=raw.unsigned?.['m.relations'];
    if(relations?.['m.thread'])saved.unsigned={'m.relations':{'m.thread':{count:relations['m.thread'].count}}};
    if(raw.unsigned?.redacted_because)saved.unsigned={...saved.unsigned,redacted_because:{event_id:raw.unsigned.redacted_because.event_id}};
    return saved;
  }
  function publishCache(ctx,roomId,values=[],source='native',coverage,identityIds=[],span) {
    const owner=ctx.client.getUserId();if(!owner || owner!==watchedOwner || ctx.client!==watchedClient)return;
    const events=[],ids=new Set(identityIds),identities=[];
    for(const value of values) {
      const saved=compactCacheEvent(value,roomId,ctx.client);if(!saved)continue;
      const key=saved.room_id+'\n'+saved.event_id,signature=JSON.stringify(saved);
      if(captureSignatures.get(key)!==signature){events.push(saved);captureSignatures.delete(key);captureSignatures.set(key,signature);}
      if(saved.sender)ids.add(saved.sender);
    }
    // Bound dedup memory independently of the twenty-room search working set.
    while(captureSignatures.size>10000)captureSignatures.delete(captureSignatures.keys().next().value);
    for(const id of ids) {
      const person=cacheIdentity(ctx,id),signature=JSON.stringify(person);
      if(capturedIdentities.get(id)!==signature){capturedIdentities.set(id,signature);identities.push(person);}
    }
    while(capturedIdentities.size>10000)capturedIdentities.delete(capturedIdentities.keys().next().value);
    if(coverage) {
      coverage={complete:Boolean(coverage.complete),dateComplete:Boolean(coverage.dateComplete),...(coverage.dates ? {dates:coverage.dates} : {})};
      const signature=JSON.stringify(coverage);
      if(capturedCoverage.get(roomId)===signature)coverage=undefined;else capturedCoverage.set(roomId,signature);
    }
    if(!events.length && !identities.length && !coverage && !span)return;
    const detail=JSON.stringify({owner,roomId,events,identities,source,...(coverage ? {coverage} : {}),...(span ? {span} : {})});
    document.dispatchEvent(new CustomEvent('rcs-message-cache-batch',{detail}));
    return {events:events.length,bytes:detail.length*2};
  }
  function storeControl(action,owner,payload={},job) {
    if(!cacheConsumerReady)return Promise.resolve(null);
    const id=crypto.randomUUID();
    return new Promise((resolve,reject)=>{
      let timer,monitor;
      const finish=(err,val)=>{
        document.removeEventListener('rcs-store-control-response',onReply);
        clearTimeout(timer);clearInterval(monitor);
        err ? reject(err) : resolve(val);
      };
      const onReply=event=>{
        let value;try{value=JSON.parse(event.detail);}catch{return;}
        if(value?.id!==id || value.owner!==owner)return;
        if(job)try{check(job);}catch(err){finish(err);return;}
        finish(null,value.ok?value:null);
      };
      document.addEventListener('rcs-store-control-response',onReply);
      timer=setTimeout(()=>finish(null,null),8000);
      if(job)monitor=setInterval(()=>{try{check(job);}catch(err){finish(err);}},50);
      document.dispatchEvent(new CustomEvent('rcs-store-control-request',{detail:JSON.stringify({id,owner,action,...payload})}));
    });
  }
  function nativeRoomEvents(native) {
    const live=native.getLiveTimeline?.()?.getEvents?.() || native.getUnfilteredTimelineSet?.()?.getEvents?.() || [];
    return [...live,...(native.getThreads?.() || []).flatMap(thread=>[thread.rootEvent,...(thread.events || thread.getEvents?.() || [])].filter(Boolean))];
  }
  function runNativeCapture(state) {
    if(state.task || state!==nativeCapture)return state.task;
    const matrixHost=state.ctx.find?.('rs-matrix-client');
    const guard=()=>{if(state!==nativeCapture || watchedClient!==state.client || state.client.getUserId()!==state.owner || matrixHost && (!matrixHost.isConnected || matrixHost.client!==state.client))throw problem('Reddit account changed. Please retry.');};
    state.task=Promise.resolve().then(async()=>{
      let units=0,bytes=0;
      const barrier=async(force=false)=>{if(!units && !force)return;if(!cacheConsumerReady){units=0;bytes=0;return;}await flushNativeCache({owner:state.owner},guard);units=0;bytes=0;};
      do {
      while(state.pending.size){
        guard();const [key,job]=state.pending.entries().next().value;state.pending.delete(key);
        if(job.identities){const sent=publishCache(state.ctx,undefined,[],'cache-recovery',undefined,job.identities);if(sent){units++;bytes+=sent.bytes;}if(bytes>=512*1024)await barrier();continue;}
        let values,refs;try{values=job.history ? [...job.history.events.values()] : nativeRoomEvents(job.native);refs=values.map(value=>value?.event || value);if(job.native)rememberMembers(stateOf(cachedRoom(job.native)),state.ctx);}catch{state.incomplete=true;continue;}
        const before=state.snapshots.get(key);
        // Remember native event references, not a second copy of every body.
        // Edits/redactions are independently captured by the native handlers.
        if(!job.force && before?.length===refs.length && refs.every((value,i)=>value===before[i]))continue;
        try {
          let chunk=[],chunkBytes=0;
          const send=async()=>{
            if(!chunk.length)return;
            const sent=publishCache(state.ctx,job.roomId,chunk,job.force?'cache-recovery':'native-memory');
            for(const value of chunk){const raw=compactCacheEvent(value,job.roomId,state.client);if(raw){const key=raw.room_id+'\n'+raw.event_id;if(captureSignatures.has(key))state.missing.delete(key);}}
            chunk=[];chunkBytes=0;
            if(sent){units+=Math.max(1,sent.events);bytes+=sent.bytes;}
            if(units>=200 || bytes>=512*1024)await barrier();
          };
          for(const value of values){
            guard();if(job.wanted && !job.wanted.has((value?.event || value)?.event_id))continue;const size=JSON.stringify(compactCacheEvent(value,job.roomId,state.client) || {}).length*2;
            if(chunk.length && (chunk.length>=200 || chunkBytes+size>256*1024))await send();
            chunk.push(value);chunkBytes+=size;
          }
          await send();if(!job.force || !job.wanted)state.snapshots.set(key,refs);
        }catch(error){state.pending.set(key,job);throw error;}
      }
      await barrier(Boolean(state.recovery));guard();
      } while(state.pending.size);
      if(state.recovery){document.dispatchEvent(new CustomEvent('rcs-message-cache-recovered',{detail:JSON.stringify({owner:state.owner,id:state.recovery,complete:!state.incomplete && !state.missing.size})}));state.recovery=null;state.incomplete=false;state.missing.clear();}
      document.dispatchEvent(new CustomEvent('rcs-message-cache-snapshot-saved',{detail:JSON.stringify({owner:state.owner})}));
    }).catch(()=>{state.failed=true; /* Retain the room job for a later native event/read retry. */ }).finally(()=>{state.task=null;if(state===nativeCapture && state.pending.size && !state.failed)runNativeCapture(state);});
    // A failed writer must not create a timed retry loop. A new native signal
    // can resume the pending room jobs after the storage problem is resolved.
    return state.task;
  }
  function captureNativeRoom(ctx,native) {
    const state=nativeCapture;if(!native?.roomId || state?.client!==ctx.client || state.owner!==ctx.client.getUserId())return;
    state.pending.set(native.roomId,{native,roomId:native.roomId});state.failed=false;return runNativeCapture(state);
  }
  function seedNativeTimelines(ctx,{force=false}={}) {
    const state=nativeCapture;if(state?.client!==ctx.client || state.owner!==ctx.client.getUserId())return;
    const rooms=ctx.client.getRooms?.() || [],ids=new Set(rooms.map(room=>room.roomId));
    for(const id of state.snapshots.keys())if(!ids.has(id))state.snapshots.delete(id);
    for(const native of rooms)if(native?.roomId)state.pending.set(native.roomId,{native,roomId:native.roomId,force});
    state.failed=false;return runNativeCapture(state);
  }
  function flushNativeCache(job,guard) {
    const owner=job.owner,id=crypto.randomUUID();
    return new Promise((resolve,reject)=>{
      let timeout,monitor;
      const finish=(error)=>{
        document.removeEventListener('rcs-message-cache-flushed',acknowledge);
        clearTimeout(timeout);clearInterval(monitor);
        error ? reject(error) : resolve();
      };
      const acknowledge=event=>{
        let value;try{value=JSON.parse(event.detail);}catch{return;}
        if(value?.id!==id || value.owner!==owner)return;
        try{guard();}catch(error){finish(error);return;}
        finish(value.ok===true ? null : problem('Saved messages could not be written. Please retry.'));
      };
      document.addEventListener('rcs-message-cache-flushed',acknowledge);
      timeout=setTimeout(()=>finish(problem('Saving Reddit’s local messages timed out. Please retry.')),30000);
      monitor=setInterval(()=>{try{guard();}catch(error){finish(error);}},50);
      // Register the waiter before dispatch: a memory-backed client may ack synchronously.
      document.dispatchEvent(new CustomEvent('rcs-message-cache-flush',{detail:JSON.stringify({owner,id})}));
    });
  }
  async function importNativeHistory(ctx,job) {
    // Read the verified native schema directly. Reddit's high-level loader
    // races network; its degradable store wrapper can clear DB on failure.
    // An open native database already supports a consistent readonly snapshot.
    // Its startup/network sync may remain pending; it must not gate cache reads.
    check(job);
    const db=ctx.client.store?.backend?.db;
    if(db?.name!=='reddit-chat-store' || !db.objectStoreNames?.contains('room_timeline'))return {available:false,retryable:true,imported:0};
    let lastKey,imported=0,scanned=0,malformed=false;
    const matrixHost=ctx.find?.('rs-matrix-client');
    const guard=()=>{
      check(job);
      if(matrixHost && (!matrixHost.isConnected || matrixHost.client!==ctx.client) || ctx.client.getUserId()!==job.owner)throw problem('Reddit account changed. Please retry.');
      if(ctx.client.store?.backend?.db!==db)throw problem('Reddit’s local cache connection changed. Saved messages remain available; try Refresh.');
    };
    while(true) {
      guard();
      const chunk=await new Promise((resolve,reject)=>{
        let transaction;const rows=[];let key,finished=false;
        const timeout=setTimeout(()=>{try{transaction?.abort();}catch{}reject(problem('Reading Reddit’s local cache timed out. Saved messages remain available.'));},10000);
        try {
          transaction=db.transaction('room_timeline','readonly');
          // Reddit closes its entire backend when a transaction abort bubbles
          // to db.onabort. Our readonly cancellations/errors belong to this
          // importer only; never tear down the authenticated native store.
          transaction.onabort=event=>{event.stopPropagation();clearTimeout(timeout);reject(transaction.error || problem('Reddit’s local cache read was interrupted.'));};
          transaction.onerror=event=>{event.stopPropagation();clearTimeout(timeout);reject(transaction.error || problem('Reddit’s local cache could not be read.'));};
          const store=transaction.objectStore('room_timeline');
          if(JSON.stringify(store.keyPath)!==JSON.stringify(['room_id','scope','parent_id','seq_id'])){
            clearTimeout(timeout);resolve({unavailable:true});return;
          }
          const request=store.openCursor(lastKey===undefined ? undefined : IDBKeyRange.lowerBound(lastKey,true));
          request.onsuccess=()=>{
            try {
              guard();const cursor=request.result;
              if(!cursor){finished=true;return;}
              rows.push(cursor.value);key=cursor.primaryKey;
              if(rows.length<200)cursor.continue();
            }catch(error){reject(error);transaction.abort();}
          };
          request.onerror=()=>{clearTimeout(timeout);reject(request.error);};
          transaction.oncomplete=()=>{clearTimeout(timeout);resolve({rows,key,finished});};
        }catch(error){clearTimeout(timeout);reject(error?.name==='InvalidStateError'?problem('Reddit’s local cache connection closed. Saved messages remain available; try Refresh after Reddit reconnects.'):error);}
      });
      guard();if(chunk.unavailable)return {available:false,imported};
      const rooms=new Map();
      for(const row of chunk.rows) {
        scanned++;
        if(typeof row?.room_id!=='string' || !row.content || typeof row.content!=='object'){malformed=true;continue;}
        if(!['m.room.message','m.sticker','m.room.redaction'].includes(row.content.type))continue;
        if(typeof row.content.event_id==='string' && row.content.event_id.startsWith('~'))continue;
        const event=compactCacheEvent(row.content,row.room_id,ctx.client);
        if(!event){malformed=true;continue;}
        if(!rooms.has(event.room_id))rooms.set(event.room_id,[]);
        rooms.get(event.room_id).push(event);imported++;
      }
      for(const [roomId,events]of rooms)publishCache(ctx,roomId,events,'native-indexeddb');
      if(job.request.awaitCache===true)await flushNativeCache(job,guard);
      guard();
      emit(job.request,{progress:{loaded:imported,scanned,label:'Saving messages already cached by Reddit…'}});
      if(chunk.finished)return {available:!malformed,imported};
      lastKey=chunk.key;
      // End each readonly transaction before yielding or extension storage work.
      await delay(0);
    }
  }
  function projectHistory(room,ctx,ids){return histories.project(room,id=>historyIdentity(ctx,id),ids,(content,type)=>previewMetadata(content,type,ctx.client));}
  function historyIdentity(ctx,id) {
    const person=resolvedIdentity(id,profileCache(ctx).get(id),ctx);
    const rendered=renderedIdentityCaches.get(ctx.client.getUserId())?.get(id);
    person.self=id===ctx.client.getUserId();
    if(person.self){person.name='You';person.historical=false;person.unavailable=false;}
    else if(!retainedUsername(person.name,true)) {
      const native=ctx.client.getUser?.(id),name=rendered?.name || retainedUsername(native?.rawDisplayName) || retainedUsername(native?.displayName);
      if(name){person.name=name;if(person.unavailable)person.historical=true;}else person.name=person.name || id;
    }
    if(!person.avatar)person.avatar=rendered?.avatar || safeImage(ctx.client.getUser?.(id)?.avatarUrl,ctx.client);
    return person;
  }
  function publishIdentityChanges(ctx,ids) {
    if(!ids.size)return;const owner=ctx.client.getUserId();
    publishCache(ctx,undefined,[],'identity',undefined,ids);
    for(const room of histories.rooms.values())if(room.owner===owner) {
      const changed=[...room.events.values()].filter(event=>ids.has(event.sender)).map(event=>event.event_id);
      if(changed.length)document.dispatchEvent(new CustomEvent('rcs-history-changed',{detail:JSON.stringify({owner,roomId:room.roomId,identityOnly:true,
        records:projectHistory(room,ctx,changed),redacted:[...room.removed],complete:room.complete})}));
    }
  }
  function rememberRenderedIdentities(ctx) {
    // Reddit's painted author rows already contain SVG/image avatar URLs. Read
    // these locally; getRedditUser can itself fetch when its native cache misses.
    const owner=ctx.client.getUserId();
    if(!renderedIdentityCaches.has(owner))renderedIdentityCaches.set(owner,new Map());
    const cache=renderedIdentityCaches.get(owner),changed=new Set();
    for(const host of ctx.all?.('rs-timeline-event') || []) {
      const id=host.event?.getSender?.() || host.event?.event?.sender;
      if(!id)continue;
      const roots=descendants(host),find=selector=>roots.flatMap(root=>[...root.querySelectorAll(selector)])[0];
      const nameNode=find('.user-name'),name=retainedUsername(nameNode && [...nameNode.childNodes].filter(node=>!node.hasAttribute?.('data-rcs-ui')).map(node=>node.textContent).join('').trim());
      const image=find('.user-avatar img,.user-avatar image'),avatar=safeImage(image?.getAttribute('src') || image?.getAttribute('href') || image?.getAttribute('xlink:href'),ctx.client);
      const previous=cache.get(id);
      if(name || avatar){const next={name:name || previous?.name || '',avatar:avatar || previous?.avatar || ''};cache.set(id,next);if(next.name!==previous?.name || next.avatar!==previous?.avatar)changed.add(id);}
    }
    publishIdentityChanges(ctx,changed);
  }
  function nativeHistoryEvent(value,roomId) {
    const event=value?.event || value;
    const id=event?.room_id || value?.getRoomId?.() || roomId;
    if(!id || typeof event?.event_id!=='string' || !event.event_id || event.event_id.startsWith('~') || !watchedClient)return;
    const raw={...event,room_id:id};
    const ctx={client:watchedClient},owner=watchedClient.getUserId();
    if(owner!==watchedOwner)return;
    if(raw.type==='m.room.member'){rememberMembers([raw],ctx);publishIdentityChanges(ctx,new Set([raw.state_key]));signalDirectory('RoomState.events',{roomId:id,event:raw});}
    const interested=[...running.values()].some(job=>!job.cancelled && job.request?.method==='history' && job.request.roomId===id);
    const room=histories.get(owner,id,interested);
    const changed=room ? histories.accept(room,raw) : [];
    const dirty=room?.dirtyThreads.size>0 || raw.unsigned?.['m.relations']?.['m.thread']?.count>0;
    publishCache(ctx,id,[raw],'native',dirty ? {complete:false,dateComplete:false} : undefined);
    if(!room)return;
    document.dispatchEvent(new CustomEvent('rcs-history-changed',{detail:JSON.stringify({owner,roomId:room.roomId,
      records:projectHistory(room,ctx,changed),redacted:[...room.removed],complete:room.complete,dateInvalidated:room.dirtyThreads.size>0})}));
  }
  function signalDirectory(type,...values) {
    for(const value of values) {
      const id=value?.getRoomId?.() || value?.roomId || value?.room_id || value?.event?.room_id;
      if(id){changedRooms.add(id);metadataVersion++;}
      const raw=value?.event || value;
      if(raw?.type==='m.room.member' && watchedClient) {
        const ctx={client:watchedClient},saved=profileCache(ctx).get(raw.state_key);
        if(id && saved && (raw.origin_server_ts || 0)>(saved.verifiedAt || 0))profileChangedRooms.add(id);
        rememberMembers([raw],ctx);
      }
      if(id && type==='Room.name' && ['[deleted]','Someone'].includes(value?.name) && knownConversations.get(id)?.type==='direct')profileChangedRooms.add(id);
    }
    clearTimeout(watchTimer);
    watchTimer=setTimeout(()=>{
      if(!watchedClient || watchedClient.getUserId()!==watchedOwner)return;
      const ctx={client:watchedClient};const value=directoryContext(ctx);const signature=JSON.stringify(value);
      if(signature===watchedSignature)return;
      watchedSignature=signature;
      document.dispatchEvent(new CustomEvent('rcs-directory-changed',{detail:JSON.stringify(value)}));
    },350);
  }
  document.addEventListener('rcs-traffic-response',event=>{
    let value;try{value=JSON.parse(event.detail);}catch{return;}
    const waiter=trafficWaiters.get(value?.id);if(!waiter)return;
    trafficWaiters.delete(value.id);clearTimeout(waiter.timer);
    value.ok ? waiter.resolve(value) : waiter.reject(problem('Request coordination unavailable. Please retry.'));
  });
  function traffic(action,job,parameters={}) {
    const id=crypto.randomUUID();
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{trafficWaiters.delete(id);reject(problem('Request coordination timed out. Please retry.'));},10000);
      trafficWaiters.set(id,{resolve,reject,timer});
      document.dispatchEvent(new CustomEvent('rcs-traffic-request',{detail:JSON.stringify({id,action,owner:job.owner,...parameters})}));
    });
  }
  async function waitUntil(until,job,label='Waiting for Reddit’s request limit…') {
    let notified=0;
    while(Date.now()<until) {
      check(job);
      if(Date.now()-notified>10000){if(job.request)emit(job.request,{progress:{label,loaded:job.loaded || 0}});notified=Date.now();}
      await delay(Math.min(250,until-Date.now()));
    }
    check(job);
  }
  async function coordinatedRead(operation,job) {
    check(job);
    if(job.optional && (localCooldowns.get(job.owner)||0)>Date.now())throw problem('Sender details are unavailable for now.');
    await waitUntil(localCooldowns.get(job.owner)||0,job);
    let claim=await traffic('traffic-acquire',job,{priority:job.priority});
    if(job.optional && claim.busy)throw problem('Sender details are unavailable for now.');
    while(claim.busy) {
      await waitUntil(Date.now()+claim.waitMs,job,claim.cooldown ? 'Waiting for Reddit’s request limit…' : 'Waiting for another search request…');
      claim=await traffic('traffic-acquire',job,{priority:job.priority});
    }
    let renewal,guard,deadline;
    if(claim.token)renewal=setInterval(()=>traffic('traffic-renew',job,{token:claim.token}).catch(()=>{}),20000);
    try {
      check(job);
      const interrupted=new Promise((_,reject)=>{
        guard=setInterval(()=>{try{check(job);}catch(error){reject(error);}},50);
        deadline=setTimeout(()=>reject(problem('Reddit stopped responding. Saved results are kept; try again.')),job.timeoutMs || 60000);
      });
      return await Promise.race([operation(),interrupted]);
    } finally {
      clearInterval(guard);clearTimeout(deadline);clearInterval(renewal);
      if(claim.token)await traffic('traffic-release',job,{token:claim.token}).catch(()=>{});
    }
  }
  function safeImage(value,client) {
    if (!value) return '';
    if (value.startsWith('mxc://')) value=client.mxcUrlToHttp?.(value,64,64,'crop') || '';
    try { const url=new URL(value,location.href); return url.protocol==='https:' ? url.href : ''; } catch { return ''; }
  }
  function listOf(value) { return Array.isArray(value) ? value : value?.events || []; }
  function profileId(matrixId) { return /^@(t2_[^:]+):/.exec(matrixId)?.[1]; }
  function identityCache(ctx) {
    const owner=ctx.client.getUserId();
    if(!identityCaches.has(owner))identityCaches.set(owner,new Map());
    return identityCaches.get(owner);
  }
  function retainedUsername(value,explicit=false) {
    if(typeof value!=='string')return '';
    const name=value.replace(/^u\//i,'').trim();
    if(!/^[A-Za-z0-9_-]{3,20}$/.test(name))return '';
    if(!explicit && /^t2_/.test(name))return '';
    return name;
  }
  function rememberMembers(events,ctx) {
    const cache=identityCache(ctx);
    for(const event of events) {
      if(event.type!=='m.room.member' || typeof event.state_key!=='string' || !/^@[^:]+:[^\s]+$/.test(event.state_key))continue;
      // Profile relations describe the event sender. For membership changes by
      // another person, only content.displayname is bound to the state_key.
      const profile=(!event.sender || event.sender===event.state_key) ? event.unsigned?.['m.relations']?.['com.reddit.profile'] : null;
      const name=retainedUsername(profile?.username,true) || retainedUsername(event.content?.displayname);
      if(!name)continue;
      const previous=cache.get(event.state_key);const time=event.origin_server_ts || 0;
      const avatar=safeImage(profile?.icon_url || event.content?.avatar_url,ctx.client);
      const aliases=[...new Set([...(previous?.aliases || []),name])];
      if(!previous || time>=previous.time)cache.set(event.state_key,{name,avatar:avatar || previous?.avatar || '',aliases,time});
      else cache.set(event.state_key,{...previous,aliases});
    }
  }
  function resolvedIdentity(id,person,ctx) {
    const retained=identityCache(ctx).get(id);
    const live=person && !person.deleted && retainedUsername(person.name,true);
    const name=live || retained?.name || person?.name || '';
    const historical=!live && !!retained?.name;
    return {name,avatar:historical ? retained.avatar || person?.avatar || '' : person?.avatar || retained?.avatar || '',aliases:[...new Set([...(person?.aliases || []),...(retained?.aliases || [])])],historical,unavailable:Boolean(person?.deleted),accountState:person?.deleted ? person.accountState || '' : ''};
  }
  function profileCache(ctx) {
    const owner=ctx.client.getUserId();
    if(!profileCaches.has(owner))profileCaches.set(owner,new Map());
    return profileCaches.get(owner);
  }
  async function profiles(ids,ctx,job,{refresh=false,readNative=false,onBatch,optional=false}={}) {
    const cache=profileCache(ctx),entries=new Map(),missing=[];
    for(const matrixId of [...new Set(ids)].filter(id=>id && (!optional || id!==ctx.client.getUserId()))) {
      const saved=cache.get(matrixId);
      const observed=readNative instanceof Set ? readNative.has(matrixId) : readNative;
      if(saved && (saved.retryAfter>Date.now() && !refresh && !observed || !observed && !saved.pending && (!refresh || Date.now()-(saved.verifiedAt||0)<86400000)))entries.set(matrixId,saved);
      else missing.push(matrixId);
    }
    if(missing.some(profileId) && !ctx.users?.getRedditUserById) {
      if(optional)return entries;
      for(let attempt=0;attempt<120 && !ctx.users?.getRedditUserById;attempt++) {
        check(job);if(job.request && attempt%40===0)emit(job.request,{progress:{loaded:entries.size,label:'Waiting for Reddit’s profile data…'}});
        await delay(250);ctx.users=context().users;
      }
      if(!ctx.users?.getRedditUserById)throw problem('Reddit profiles are still connecting. Try search again in a moment.');
    }
    const metadataDeadline=optional ? Date.now()+2000 : Infinity;
    // One native-sized batch at a time; never fan out thousands of profile reads.
    for(let start=0;start<missing.length;start+=200) {
      if(optional && Date.now()>=metadataDeadline)return entries;
      check(job);const batch=missing.slice(start,start+200);
      const metadataJob=optional ? {ctx:job.ctx,owner:job.owner,priority:job.priority,timeoutMs:Math.max(1,metadataDeadline-Date.now()),optional:true,get cancelled(){return job.cancelled;}} : job;
      let results;
      try {results=await retryRead(async()=>{
        const values=await Promise.allSettled(batch.map(matrixId=>{
          const id=profileId(matrixId);
          return id && ctx.users?.getRedditUserById ? ctx.users.getRedditUserById(id) : null;
        }));
        const limited=values.find(value=>value.status==='rejected' && (value.reason?.httpStatus===429 || value.reason?.errcode==='M_LIMIT_EXCEEDED'));
        if(limited)throw limited.reason;
        return values;
      },metadataJob);}catch(error){if(!optional || error.name==='AbortError')throw error;return entries;}
      for(let i=0;i<batch.length;i++) {
        const matrixId=batch[i],result=results[i];
        const profile=result.status==='fulfilled' ? result.value : null;
        const native=ctx.client.getUser?.(matrixId);
        const nativeName=retainedUsername(native?.rawDisplayName || native?.displayName);
        const name=profile?.isDeleted ? '[deleted]' : profile?.name || profile?.displayName || nativeName || '';
        const person={name,deleted:Boolean(profile?.isDeleted),availabilityKnown:Boolean(profile),
          aliases:profile?.isDeleted ? [] : [profile?.displayName,profile?.name,profile?.prefixedName,nativeName].filter(value=>typeof value==='string' && value),
          avatar:safeImage(profile?.snoovatarIcon?.src || profile?.avatar?.src || native?.avatarUrl,ctx.client),
          verifiedAt:profile ? Date.now() : 0,pending:!name || !profile && !nativeName,
          retryAfter:profile && name ? 0 : Date.now()+900000,provenance:profile ? 'native-profile' : 'native-member'};
        // Reddit's profile cannot tell a deleted account from a suspended one; keep what the hover card said.
        const before=cache.get(matrixId);
        if(person.deleted && before)Object.assign(person,{accountState:before.accountState || '',accountStateCheckedAt:before.accountStateCheckedAt || 0});
        cache.set(matrixId,person);entries.set(matrixId,person);
      }
      publishIdentityChanges(ctx,new Set(batch));
      if(job.request && !optional)emit(job.request,{progress:{loaded:entries.size,label:'Resolving missing usernames…'}});
      onBatch?.(entries);
    }
    check(job);return entries;
  }
  function identityRecord(id,person,ctx) {
    const resolved=resolvedIdentity(id,person,ctx),retained=identityCache(ctx).get(id);
    return {id,name:resolved.name,avatar:resolved.avatar,aliases:resolved.aliases,
      historicalName:resolved.historical,accountUnavailable:resolved.unavailable,
      availabilityKnown:Boolean(person?.availabilityKnown),verifiedAt:person?.verifiedAt || 0,
      observedAt:retained?.time || 0,provenance:resolved.historical ? 'retained-member' : person?.provenance || '',
      recoveryCheckedAt:retained?.recoveryCheckedAt || 0,recoveryStatus:retained?.recoveryStatus || '',
      profileRetryAt:person?.retryAfter || 0,pending:!resolved.name || Boolean(person?.pending),
      accountState:resolved.accountState,accountStateCheckedAt:person?.deleted ? person.accountStateCheckedAt || 0 : 0};
  }
  function primeCache(ctx,request) {
    const owner=ctx.client.getUserId();
    if(request.owner!==owner || !Array.isArray(request.records))throw problem('Reddit account changed. Please retry.');
    if(knownOwner!==owner){knownConversations.clear();knownRoomStates.clear();histories.clear();knownOwner=owner;}
    for(const record of request.records)if(typeof record?.id==='string' && record.id.length<=1000 && Array.isArray(record.participantIds))knownConversations.set(record.id,{...record,participantIds:record.participantIds.filter(id=>typeof id==='string' && id.length<=1000)});
    for(const raw of request.identities || []) {
      if(typeof raw?.id!=='string' || !/^@[^:\s]+:[^\s]+$/.test(raw.id) || raw.id===owner)continue;
      profileCache(ctx).set(raw.id,{name:raw.name || '',avatar:raw.avatar || '',aliases:raw.aliases || [],deleted:Boolean(raw.accountUnavailable),
        availabilityKnown:Boolean(raw.availabilityKnown),verifiedAt:raw.verifiedAt || 0,provenance:raw.provenance || 'saved-directory',
        pending:Boolean(raw.pending || !raw.availabilityKnown),retryAfter:raw.profileRetryAt || 0,
        accountState:raw.accountUnavailable && ['deleted','banned'].includes(raw.accountState) ? raw.accountState : '',accountStateCheckedAt:Number.isFinite(raw.accountStateCheckedAt) ? raw.accountStateCheckedAt : 0});
      // Reddit scrubs member names once an account is deleted, so a real username saved while the
      // account was alive is the only copy left. Seed it as the retained identity, keeping its avatar,
      // unless a newer retained entry (for example from a member event) already exists.
      const name=retainedUsername(raw.name,true),real=name && !['Someone','Unknown'].includes(name);
      if(raw.historicalName || raw.provenance==='retained-member' || real) {
        const time=raw.observedAt || raw.verifiedAt || 0,previous=identityCache(ctx).get(raw.id);
        if(!previous?.name || time>=previous.time)identityCache(ctx).set(raw.id,{name:raw.name || '',avatar:raw.avatar || previous?.avatar || '',aliases:[...new Set([...(raw.aliases || []),...(previous?.aliases || [])])],
          time,recoveryCheckedAt:raw.recoveryCheckedAt || previous?.recoveryCheckedAt || 0,recoveryStatus:raw.recoveryStatus || previous?.recoveryStatus || ''});
      }
    }
    if(request.ackMetadataVersion===metadataVersion){changedRooms.clear();profileChangedRooms.clear();watchedSignature=JSON.stringify(directoryContext(ctx));}
    publishIdentityChanges(ctx,new Set((request.identities || []).map(person=>person.id)));
    return {owner};
  }
  // Reddit's chat profile reports isDeleted for deleted and suspended accounts alike. Its public hover card
  // tells them apart, but only people the user can actually see are looked up, once each, one request at a time.
  const classifier={wanted:new Map(),running:false,nextAt:0,pausedUntil:0,strikes:0};
  const classifyGapMs=2500,classifyRetryMs=86400000,classifyNoAnswerMs=3600000,classifyLimitMs=3600000,classifyTransientMs=600000;
  function classifyHoverCard(html) {
    let doc;try{doc=new DOMParser().parseFromString(html,'text/html');}catch{return '';}
    if(doc.querySelector('[avatar] img, img[src*="profileIcon"]'))return 'live';
    const text=(doc.body?.textContent || '').toLowerCase();
    return /\bsuspended\b/.test(text) ? 'banned' : /\bdeleted\b/.test(text) ? 'deleted' : '';
  }
  // The retained username to look up, or '' when this person needs no request (no name, live, or already known).
  function classifiableName(ctx,id) {
    const person=profileCache(ctx).get(id);
    // A check that produced no answer (including ones lost before 0.22.0) is retried after an hour.
    if(!person?.deleted || person.accountState || Date.now()-(person.accountStateCheckedAt || 0)<classifyNoAnswerMs)return '';
    const resolved=resolvedIdentity(id,person,ctx);
    return resolved.unavailable && resolved.historical ? retainedUsername(resolved.name) : '';
  }
  function queueClassification(ctx,request) {
    const owner=ctx.client.getUserId();
    if(request.owner!==owner || !Array.isArray(request.ids) || request.ids.length>200 || request.ids.some(id=>typeof id!=='string' || id.length>1000))throw problem('Reddit account changed. Please retry.');
    classifier.wanted.set(String(request.source || '').slice(0,20),request.ids);
    pumpClassifier();return {owner};
  }
  async function pumpClassifier() {
    if(classifier.running)return;classifier.running=true;
    try {
      while(watchedClient) {
        const ctx={client:watchedClient},owner=watchedOwner;
        if(watchedClient.getUserId()!==owner)break;
        let id='',name='';
        for(const ids of classifier.wanted.values())for(const candidate of ids)if(!id && (name=classifiableName(ctx,candidate)))id=candidate;
        if(!id)break;
        const wait=Math.max(classifier.nextAt,classifier.pausedUntil)-Date.now();
        if(wait>0){await delay(Math.min(wait,60000));continue;}
        classifier.nextAt=Date.now()+classifyGapMs;
        const outcome=await requestHoverCard(name);
        if(watchedClient!==ctx.client || watchedOwner!==owner)break;
        if(outcome.limited){
          classifier.strikes++;classifier.pausedUntil=Date.now()+Math.min(classifyLimitMs,Math.max(outcome.wait,30000*2**classifier.strikes));
          if(classifier.strikes>=4){classifier.wanted.clear();break;}
          continue;
        }
        classifier.strikes=0;
        const cache=profileCache(ctx),person=cache.get(id);if(!person)continue;
        // Transient failures are not saved: try this person again in about ten minutes.
        if(outcome.transient){cache.set(id,{...person,accountStateCheckedAt:Date.now()-classifyNoAnswerMs+classifyTransientMs});continue;}
        // A definite answer is kept for good. Anything else is only a note that today's attempt is spent.
        const state=outcome.state==='deleted' || outcome.state==='banned' ? outcome.state : '',checked=Date.now();
        cache.set(id,{...person,accountState:state,accountStateCheckedAt:checked});
        document.dispatchEvent(new CustomEvent('rcs-account-state',{detail:JSON.stringify({owner,states:[{id,accountState:state,accountStateCheckedAt:checked}]})}));
      }
    } catch { /* A classification must never disturb Reddit's own chat. */ }
    finally {classifier.running=false;}
  }
  async function requestHoverCard(name) {
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
    try {
      const response=await fetch('https://www.reddit.com/svc/shreddit/user-hover-card/'+encodeURIComponent(name),{method:'GET',
        headers:{Accept:'text/vnd.reddit.partial+html, text/html;q=0.9'},credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',signal:controller.signal});
      if(response.status===429) {
        const hint=response.headers?.get?.('Retry-After'),seconds=Number(hint),date=Date.parse(hint || '');
        return {limited:true,wait:Number.isFinite(seconds) && hint?.trim() ? seconds*1000 : Number.isFinite(date) ? Math.max(0,date-Date.now()) : 0};
      }
      // Only a real answer is recorded; a refusal or network failure is retried later.
      if(!response.ok)return {state:'',transient:true};
      const html=await response.text();
      return {state:html.length>300000 ? '' : classifyHoverCard(html)};
    } catch { return {state:'',transient:true}; }
    finally {clearTimeout(timer);}
  }
  function nativeBindings(ctx,request) {
    RCSNativeIdentities.update(ctx,request);
    const attribute=(element,key,value)=>{if(value && element.getAttribute(key)!==value)element.setAttribute(key,value);else if(!value)element.removeAttribute(key);};
    for(const row of ctx.all('rs-rooms-nav-room, rs-room-list-item')) {
      attribute(row,'data-rcs-room-id',row.room?.roomId || row.roomId || row.getAttribute('room-id') || row.getAttribute('room'));
    }
    for(const room of ctx.all('rs-room')) {
      attribute(room,'data-rcs-room-id',room.roomId || room.roomController?.roomId || room.getAttribute('room-id') || room.getAttribute('room'));
      for(const event of descendants(room).flatMap(root=>[...root.querySelectorAll('rs-timeline-event')])) {
        stampNativeEvent(event,ctx.client);
      }
    }
    return {owner:ctx.client.getUserId()};
  }
  async function retryRead(operation,job) {
    for (let attempt=0;;attempt++) {
      check(job);
      try { return await coordinatedRead(operation,job); } catch(error) {
        const status=error.httpStatus || error.status || error.response?.status;
        const limited=status===429 || error.errcode==='M_LIMIT_EXCEEDED';
        if (!(limited || status>=500 || error.name==='ConnectionError')) throw error;
        const headers=error.headers || error.httpHeaders || error.response?.headers;
        const retryAfter=headers?.get?.('Retry-After') || headers?.['retry-after'] || headers?.['Retry-After'];
        const headerDelay=retryAfter===undefined ? 0 : Number.isFinite(Number(retryAfter)) ? Number(retryAfter)*1000 : Math.max(0,Date.parse(retryAfter)-Date.now());
        // Server hints are advisory: never wait or block longer than an hour.
        const wait=Math.min(3600000,Math.max(0,headerDelay||0,error.data?.retry_after_ms||0,error.retry_after_ms||0,(limited ? 30000 : 1000)*2**attempt));
        const until=Date.now()+wait;
        localCooldowns.set(job.owner,Math.max(localCooldowns.get(job.owner)||0,until));
        if(limited)await traffic('traffic-cooldown',job,{until});
        if(job.optional)throw error;
        if(attempt>=4)throw error;
        await waitUntil(until,job,limited ? 'Waiting for Reddit’s request limit…' : 'Retrying after a connection error…');
      }
    }
  }
  function stateOf(room) { return mergeState(listOf(room.invite_state),listOf(room.state)); }
  function mergeState(...groups) {
    const events=new Map();
    for(const group of groups)for(const event of group){const key=`${event.type}\u0000${event.state_key || ''}`,before=events.get(key);if(!before?.origin_server_ts || !event.origin_server_ts || event.origin_server_ts>=before.origin_server_ts)events.set(key,event);}
    return [...events.values()];
  }
  function cachedRoom(native) {
    const state=[];
    for(const type of ['com.reddit.chat.type','m.room.name','m.room.avatar']) {
      const event=native.getStateEvents?.(type,'') || native.currentState?.getStateEvents?.(type,'');
      if(event?.getContent)state.push({type,state_key:'',content:event.getContent(),origin_server_ts:event.getTs?.()});
    }
    for(const member of native.getMembers?.() || []) {
      const event=member.events?.member;
      state.push({type:'m.room.member',state_key:member.userId,sender:event?.getSender?.(),origin_server_ts:event?.getTs?.(),unsigned:event?.getUnsigned?.(),content:event?.getContent?.() || {membership:member.membership || 'join',displayname:member.rawDisplayName || member.name,avatar_url:member.getMxcAvatarUrl?.()}});
    }
    return {room_id:native.roomId,state,...(unreadCount(native)!==undefined ? {unread_notifications:{notification_count:unreadCount(native)}} : {}),membership:native.getMyMembership?.() || '',summary:{'m.heroes':native.summaryHeroes || []},nativeName:native.name,timestamp:native.getLastActiveTimestamp?.() || 0};
  }
  function participantIds(raw,direct,own) {
    const type=stateOf(raw).find(event=>event.type==='com.reddit.chat.type')?.content;
    return [...new Set([...(direct.get(raw.room_id) || []),...(type?.participants || []),...(raw.summary?.['m.heroes'] || []),...stateOf(raw).filter(event=>event.type==='m.room.member' && ['join','invite'].includes(event.content?.membership)).map(event=>event.state_key)])].filter(id=>typeof id==='string' && id!==own);
  }
  const directoryScans=new Map();
  async function retainedRoomState(ctx,job,roomId,expectedIds=[]) {
    const owner=ctx.client.getUserId();
    if(!roomStateCaches.has(owner))roomStateCaches.set(owner,new Map());
    const cache=roomStateCaches.get(owner);let entry=cache.get(roomId);
    if(!entry || Date.now()-entry.time>3600000) {
      // Reading state does not register a peek or add the room to Reddit's model.
      const promise=(async()=>{
        let members=[];
        try {
          const data=await retryRead(()=>ctx.client.http.authedRequest('GET','/rooms/'+encodeURIComponent(roomId)+'/members'),job);
          if(!Array.isArray(data.chunk))throw problem('Reddit did not return participant metadata for this conversation.');
          members=data.chunk;rememberMembers(members,ctx);
        } catch(error){if(error.httpStatus!==403&&error.httpStatus!==404)throw error;}
        if(expectedIds.length && expectedIds.every(id=>identityCache(ctx).get(id)?.name))return members;
        const data=await retryRead(()=>ctx.client.http.authedRequest('GET','/rooms/'+encodeURIComponent(roomId)+'/events',{before:1,include:'timeline,state'}),job);
        if(!Array.isArray(data.state))throw problem('Reddit did not return participant metadata for this conversation.');
        rememberMembers(data.state,ctx);return mergeState(members,data.state);
      })().catch(error=>{cache.delete(roomId);throw error;});
      entry={promise,time:Date.now()};cache.set(roomId,entry);
    }
    const state=await entry.promise;check(job);return state;
  }
  function roomKind(raw,direct,own) {
    const kind=stateOf(raw).find(event=>event.type==='com.reddit.chat.type')?.content?.type;
    return kind || (direct.has(raw.room_id) || participantIds(raw,direct,own).length===1 ? 'direct' : 'group');
  }
  function directoryRecords(rooms,direct,people,ctx) {
    const own=ctx.client.getUserId();
    return [...rooms.values()].map(raw=>{
      const state=stateOf(raw),value=type=>state.find(event=>event.type===type)?.content;
      const participants=participantIds(raw,direct,own),type=roomKind(raw,direct,own);
      const directRoom=['direct','reddit_titled_direct'].includes(type);
      const person=resolvedIdentity(participants[0],people.get(participants[0]),ctx);
      const saved=knownConversations.get(raw.room_id);
      const native=ctx.client.getRoom?.(raw.room_id);
      const nativeName=[native?.name,raw.nativeName].find(name=>name && name!=='Empty room') || '';
      const savedName=saved?.name && saved.name!=='Empty room'?saved.name:'';
      const name=value('m.room.name')?.name || (directRoom ? person.name || savedName || nativeName || 'Username unavailable' : nativeName || savedName || (raw.pendingInvite ? 'Chat request' : type==='reddit_modmail' ? 'Modmail' : 'Group chat'));
      const avatar=directRoom ? person.avatar || saved?.avatar || '' : safeImage(value('m.room.avatar')?.url,ctx.client);
      const membership=state.find(event=>event.type==='m.room.member' && event.state_key===own)?.content?.membership || raw.membership || native?.getMyMembership?.() || saved?.membership || '';
      return {id:raw.room_id,name,avatar,type,membership,...(unreadCount(native,raw)!==undefined ? {unreadCount:unreadCount(native,raw)} : {}),
        hidden:Boolean(native?.getAccountData?.('com.reddit.hidden_chat')?.getContent?.()?.hidden || saved?.hidden),
        historicalName:directRoom && person.historical,accountUnavailable:directRoom && person.unavailable,accountState:directRoom && person.unavailable ? person.accountState : '',
        aliases:participants.flatMap(id=>resolvedIdentity(id,people.get(id),ctx).aliases),
        participantIds:participants,participants:participants.map(id=>resolvedIdentity(id,people.get(id),ctx).name).filter(Boolean),
        identities:participants.map(id=>identityRecord(id,people.get(id),ctx)),
        status:raw.pendingInvite ? 'invite-pending' : raw.participantAccessDenied ? 'participants-unavailable' : '',
        identityPending:type!=='reddit_modmail' && (Boolean(raw.participantAccessDenied || raw.pendingInvite) || participants.some(id=>{
          const person=resolvedIdentity(id,people.get(id),ctx),retained=identityCache(ctx).get(id);
          return !person.name || person.unavailable && !person.historical && !retained?.recoveryCheckedAt;
        })),
        timestamp:Math.max(raw.timestamp || 0,saved?.timestamp || 0,latestMessageTime(raw)),
        ...(raw.lastPreview || saved?.lastPreview ? {lastPreview:pickNewerPreview(raw.lastPreview,saved?.lastPreview)} : {}),
        lastSeq:String(raw.last_seq_id ?? saved?.lastSeq ?? ''),href:'/room/'+encodeURIComponent(raw.room_id)};
    }).sort((a,b)=>b.timestamp-a.timestamp);
  }
  function latestMessageTime(raw) {
    const events=listOf(raw.chunk || raw.timeline);
    return Math.max(0,...events.filter(e=>['m.room.message','m.sticker'].includes(e.type)).map(e=>e.origin_server_ts || 0));
  }
  function pickNewerPreview(a,b) {
    if(!a)return b || null;
    if(!b)return a;
    return (a.timestamp || 0)>=(b.timestamp || 0) ? a : b;
  }
  function latestPreviewOf(raw,own,ctx) {
    const events=listOf(raw.chunk || raw.timeline);
    if(!events.length)return null;
    const redacted=new Set();
    for(const e of events){
      if(e.type==='m.room.redaction' && (e.redacts || e.content?.redacts))redacted.add(e.redacts || e.content?.redacts);
      if(e.unsigned?.redacted_because && e.event_id)redacted.add(e.event_id);
    }
    const edits=new Map();
    for(const e of events){
      const rel=e.content?.['m.relates_to'];
      if(rel?.rel_type==='m.replace' && rel.event_id && !redacted.has(e.event_id)){
        const prev=edits.get(rel.event_id);
        if(!prev || (e.origin_server_ts || 0)>=(prev.origin_server_ts || 0))edits.set(rel.event_id,e);
      }
    }
    let best=null;
    for(const e of events){
      if(!['m.room.message','m.sticker'].includes(e.type) || !e.event_id || e.event_id.startsWith('~') || redacted.has(e.event_id))continue;
      if(e.content?.['m.relates_to']?.rel_type==='m.replace')continue;
      if(!best || (e.origin_server_ts || 0)>(best.origin_server_ts || 0))best=e;
    }
    if(!best)return null;
    const edit=edits.get(best.event_id);
    const bodyEvent=edit && edit.sender===best.sender ? edit : best;
    const content=bodyEvent.content?.['m.new_content'] || bodyEvent.content || {};
    const media=previewMetadata(content,bodyEvent.type,ctx.client);
    const rawBody=typeof content.body==='string'?content.body:'';
    const text=(rawBody || (bodyEvent.type==='m.sticker'?'Sticker':({image:'Image',video:'Video',audio:'Audio',file:'File'}[media.attachmentType] || ''))).slice(0,200);
    if(!text.trim() && !media.attachmentType)return null;
    const self=best.sender===own;
    const person=!self?historyIdentity(ctx,best.sender):null;
    const seq=sequence(best);
    return {id:best.event_id,sender:best.sender || '',author:self?'You':person?.name || '',authorSelf:self,text,attachmentType:media.attachmentType,attachmentMime:media.attachmentMime,attachmentPreview:media.attachmentPreview,timestamp:best.origin_server_ts || 0,...(seq!==null?{seq}:{})};
  }
  const activityScans=new Map();
  async function activity(ctx,job,request) {
    const own=ctx.client.getUserId();let scan=activityScans.get(own);
    if(!scan){scan={cursor:typeof request.activityCursor==='string' ? request.activityCursor : null,seen:new Set(),records:new Map(),finished:false};activityScans.set(own,scan);}
    while(!scan.finished) {
      const options={page_size:200,include:{timeline:true}};if(scan.cursor)options.next_batch=scan.cursor;
      const data=await retryRead(()=>ctx.client.getRoomList(options),job);check(job);
      if(!Array.isArray(data.rooms))throw problem('Reddit did not return conversation activity. Please retry.');
      for(const raw of data.rooms) {
        rememberMembers(stateOf(raw),ctx);publishCache(ctx,raw.room_id,listOf(raw.chunk || raw.timeline),'directory');
        const saved=knownConversations.get(raw.room_id);if(!saved)continue;
        const timestamp=Math.max(saved.timestamp || 0,latestMessageTime(raw));
        const lastPreview=pickNewerPreview(latestPreviewOf(raw,own,ctx),saved.lastPreview);
        scan.records.set(raw.room_id,{...saved,timestamp,...(raw.last_seq_id!=null?{lastSeq:String(raw.last_seq_id)}:{}),...(lastPreview?{lastPreview}:{})});
      }
      const next=data.next_batch;
      if(next && (typeof next!=='string' || scan.seen.has(next) || next===scan.cursor || !data.rooms.length))throw problem('Reddit activity pagination stopped advancing.');
      scan.cursor=next || null;scan.finished=!next;if(next)scan.seen.add(next);
      emit(request,{progress:{records:[...scan.records.values()],loaded:scan.records.size,label:'Loading last conversation dates…',activityCursor:scan.cursor,activityComplete:scan.finished}});
    }
    for(const record of scan.records.values())knownConversations.set(record.id,record);
    return [...scan.records.values()];
  }
  async function conversations(ctx,job,request) {
    const own=ctx.client.getUserId(),delta=Array.isArray(request.knownIds),rooms=new Map(),direct=new Map();
    const directMap=ctx.client.getAccountData?.('m.direct')?.getContent() || {};
    for(const [user,ids] of Object.entries(directMap))if(Array.isArray(ids))for(const id of ids) {
      if(!direct.has(id))direct.set(id,[]);direct.get(id).push(user);
    }
    for(const native of ctx.client.getRooms?.() || [])if(native.roomId) {
      const raw=cachedRoom(native);rememberMembers(stateOf(raw),ctx);rooms.set(native.roomId,raw);
    }
    if(delta) {
      const changed=new Set(request.changedIds || []);
      for(const id of request.knownIds)if(!changed.has(id))rooms.delete(id);
      for(const id of changed)if(!rooms.has(id)) {
        const saved=knownConversations.get(id);if(!saved)continue;
        rooms.set(id,knownRoomStates.get(id) || {room_id:id,state:[{type:'com.reddit.chat.type',content:{type:saved.type || 'direct',participants:[own,...(saved.participantIds || [])]}}]});
      }
      for(const [id,people] of direct)if(!request.knownIds.includes(id)&&!rooms.has(id))rooms.set(id,{room_id:id,state:[]});
    } else {
      job.stage='conversation directory';
      let scan=directoryScans.get(own);
      if(request.restart || !scan || Date.now()-scan.startedAt>300000) {
        const cursor=!request.restart && typeof request.directoryCursor==='string' ? request.directoryCursor : null;
        const saved=cursor ? [...knownConversations.values()].map(r=>[r.id,{room_id:r.id,timestamp:r.timestamp,state:[{type:'com.reddit.chat.type',content:{type:r.type,participants:[own,...r.participantIds]}}]}]) : [];
        scan={rooms:new Map(saved),cursor,seenCursors:new Set(),finished:false,startedAt:Date.now()};directoryScans.set(own,scan);
      }
      while(!scan.finished) {
        const options={page_size:200,include:{state:true,timeline:true}};
        if(scan.cursor)options.next_batch=scan.cursor;
        const data=await retryRead(()=>ctx.client.getRoomList(options),job);
        check(job);
        if(!Array.isArray(data.rooms))throw problem('Reddit returned an unexpected room directory. Search is incomplete.');
        for(const raw of data.rooms) {
          if(typeof raw?.room_id!=='string')throw problem('Reddit returned an invalid conversation ID. Search is incomplete.');
          rememberMembers(stateOf(raw),ctx);
          const preview=latestPreviewOf(raw,own,ctx);
          const metadata={...raw,timestamp:latestMessageTime(raw),...(preview?{lastPreview:preview}:{})};
          delete metadata.chunk;delete metadata.timeline;
          scan.rooms.set(raw.room_id,metadata);
          publishCache(ctx,raw.room_id,listOf(raw.chunk || raw.timeline),'directory');
          const existing=rooms.get(raw.room_id);
          rooms.set(raw.room_id,{...existing,...metadata,timestamp:Math.max(existing?.timestamp || 0,metadata.timestamp),...(pickNewerPreview(metadata.lastPreview,existing?.lastPreview)?{lastPreview:pickNewerPreview(metadata.lastPreview,existing?.lastPreview)}:{}),state:mergeState(stateOf(existing || {}),stateOf(raw))});
          knownRoomStates.set(raw.room_id,metadata);
        }
        const next=data.next_batch;
        if(next!==undefined && next!==null && next!=='' && typeof next!=='string')throw problem('Reddit returned an invalid room cursor. Search is incomplete.');
        if(next && (next===scan.cursor || scan.seenCursors.has(next) || !data.rooms.length))throw problem('Reddit room pagination stopped advancing. Search is incomplete.');
        scan.cursor=next || null;scan.finished=!next;
        if(next)scan.seenCursors.add(next);
        job.loaded=scan.rooms.size;
        emit(request,{progress:{loaded:scan.rooms.size,label:'Building your conversation directory…',records:directoryRecords(new Map([...scan.rooms,...rooms]),direct,profileCache(ctx),ctx),directoryCursor:scan.cursor,discoveryComplete:scan.finished}});
      }
      // Reuse completed pages after a failed metadata phase, and resume failed pages.
      for(const [id,raw] of scan.rooms) {
        const existing=rooms.get(id);rooms.set(id,{...existing,...raw,timestamp:Math.max(existing?.timestamp || 0,raw.timestamp || 0),state:mergeState(stateOf(existing || {}),stateOf(raw))});
        knownRoomStates.set(id,raw);
      }
    }
    job.stage='conversation participants';
    const unresolved=[...rooms.values()].filter(raw=>roomKind(raw,direct,own)!=='reddit_modmail' && !participantIds(raw,direct,own).length);
    for(const raw of unresolved) {
      // Invitations and departed rooms may deny membership reads even though
      // Reddit includes them in its directory. One such room must not block
      // accessible conversations or discard the already-resolved identities.
      const membership=stateOf(raw).find(event=>event.type==='m.room.member' && event.state_key===own)?.content?.membership || raw.membership;
      if(membership==='invite'){raw.pendingInvite=true;continue;}
      const saved=knownConversations.get(raw.room_id);
      if(membership==='leave' || membership==='ban' || saved?.status==='participants-unavailable' && membership===saved.membership && !request.refreshProfiles && !request.changedIds?.includes(raw.room_id)) {raw.participantAccessDenied=true;continue;}
      try {
        const data=await retryRead(()=>ctx.client.http.authedRequest('GET','/rooms/'+encodeURIComponent(raw.room_id)+'/members',{not_membership:'leave'}),job);
        if(!Array.isArray(data.chunk))throw problem('Reddit did not return conversation participants. Search is incomplete.');
        raw.state=mergeState(stateOf(raw),data.chunk);rememberMembers(data.chunk,ctx);
      } catch(error) {
        const status=Number(error.httpStatus || error.status || error.response?.status);
        if(status!==403 && status!==404)throw error;
        check(job);raw.participantAccessDenied=true;
      }
    }
    const ids=[...rooms.values()].filter(raw=>roomKind(raw,direct,own)!=='reddit_modmail').flatMap(raw=>participantIds(raw,direct,own));
    job.stage='profiles';
    const observedIds=new Set((request.profileChangedIds || []).flatMap(id=>rooms.has(id)?participantIds(rooms.get(id),direct,own):[]));
    const people=await profiles(ids,ctx,job,{refresh:Boolean(request.refreshProfiles),readNative:observedIds,onBatch:people=>emit(request,{progress:{
      loaded:people.size,label:'Loading usernames…',records:directoryRecords(rooms,direct,people,ctx)}})});
    job.stage='retained participant names';
    for(const raw of rooms.values()) {
      if(roomKind(raw,direct,own)==='reddit_modmail')continue;
      const missing=participantIds(raw,direct,own).filter(id=>{
        const person=people.get(id),retained=identityCache(ctx).get(id);
        return (person?.deleted || !retainedUsername(person?.name)) && !retained?.name && (!retained?.recoveryCheckedAt || Date.now()-retained.recoveryCheckedAt>3600000);
      });
      if(!missing.length)continue;
      try {raw.state=mergeState(stateOf(raw),await retainedRoomState(ctx,job,raw.room_id,missing));}
      catch(error) {if(error.httpStatus!==403 && error.httpStatus!==404)throw error;}
      for(const id of missing) {
        const retained=identityCache(ctx).get(id) || {name:'',aliases:[],time:0};
        identityCache(ctx).set(id,{...retained,recoveryCheckedAt:Date.now(),recoveryStatus:retained.name?'recovered':'unavailable'});
      }
    }
    const records=directoryRecords(rooms,direct,people,ctx);
    for(const record of records)knownConversations.set(record.id,record);
    return records;
  }
  function nativeEventLoaded(ctx,roomId,eventId) {
    const room=ctx.client.getRoom?.(roomId);
    // Persistent search/history caches cannot establish that Reddit can already
    // render this event. Only skip its loader for an event in the native model.
    try {return Boolean(room?.findEventById?.(eventId) || room?.getUnfilteredTimelineSet?.()?.findEventById?.(eventId));}
    catch {return false;}
  }
  async function prepareNavigation(ctx,job,roomId) {
    if(ctx.client.getRoom?.(roomId))return;
    const record=knownConversations.get(roomId);
    const cached=knownRoomStates.get(roomId);
    if(cached?.chunk && ctx.client.storeInactiveRoom){check(job);ctx.client.storeInactiveRoom(cached);return;}
    if(record?.type && !['direct','reddit_titled_direct'].includes(record.type))return;
    if(!record?.participantIds?.[0] || !ctx.client.getRoomList || !ctx.client.storeInactiveRoom)return;
    const data=await retryRead(()=>ctx.client.getRoomList({with_user:record.participantIds[0],type:'direct',include:{state:true,timeline:true}}),job);
    const raw=data.rooms?.find(room=>room.room_id===roomId);
    if(!raw)throw problem('This conversation is no longer available to your account.');
    check(job);rememberMembers(stateOf(raw),ctx);publishCache(ctx,roomId,listOf(raw.chunk || raw.timeline),'navigation');ctx.client.storeInactiveRoom(raw);
  }
  function sequence(event) {
    const end=String(event.seq_id ?? '').split('.').at(-1);
    const number=Number(end?.replace(/^[a-z]/i,''));
    return end && Number.isSafeInteger(number) && number>=0 ? number : null;
  }
  function historyProgress(ctx,job,room,label,ids) {
    job.loaded=room.events.size;
    rememberRenderedIdentities(ctx);
    emit(job.request,{progress:{loaded:room.events.size,label,records:projectHistory(room,ctx,ids),redacted:[...room.removed],complete:room.complete}});
  }
  function historyDateStart(dates) {
    if(!dates?.from)return -Infinity;
    const value=dates.from;if(typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))throw problem('Choose a valid start date.');
    const [y,m,d]=value.split('-').map(Number),date=new Date(y,m-1,d);
    if(date.getFullYear()!==y || date.getMonth()!==m-1 || date.getDate()!==d)throw problem('Choose a valid start date.');
    return date.getTime();
  }
  function historyDateEnd(dates) {if(!dates?.to)return Infinity;const date=new Date(historyDateStart({from:dates.to}));date.setDate(date.getDate()+1);return date.getTime();}
  function scopeCoversDate(scope,start) {return scope.done || Number.isFinite(start) && scope.headVerified && scope.dateOrderSafe && scope.coveredStart<start;}
  function rangeCovered(room,start) {return scopeCoversDate(histories.scope(room,''),start) && [...room.roots.keys()].every(parent=>scopeCoversDate(histories.scope(room,parent),start)&&!room.dirtyThreads.has(parent));}
  async function readTimeline(ctx,job,room,parent,refresh=false) {
    const scope=histories.scope(room,parent);
    if(scope.done && !refresh)return;
    if(!refresh && scopeCoversDate(scope,job.dateStart?.() ?? -Infinity))return;
    const persistedSpans=(room.persistedCoverage?.spans?.[parent] || []).slice().sort((a,b)=>a.hi-b.hi);
    let topSpan=!scope.headVerified && persistedSpans.length?persistedSpans.at(-1):null;
    if(topSpan)room.resumedFromStore=true;
    const wasDone=scope.done,refreshing=scope.headVerified && refresh,resumeCursor=scope.cursor;
    const baseline=refreshing ? new Set(scope.verifiedIds) : null;
    const rootCount=room.roots.get(parent)?.count || 0;
    let cursor=refreshing ? null : scope.cursor;
    while(true) {
      check(job);
      const params={dir:'b',before:100,include:'timeline,state'};
      if(parent)params.parent=parent;
      if(cursor!==null)params.seq=String(cursor);
      const data=await retryRead(()=>ctx.client.http.authedRequest('GET','/rooms/'+encodeURIComponent(room.roomId)+'/events',params),job);
      check(job);rememberMembers(listOf(data.state),ctx);
      if(!Array.isArray(data.events))throw problem('Reddit returned an unexpected message history. Search is incomplete.');
      rememberMembers(data.events,ctx);
      let overlap=false;const changed=new Set();
      const legacyLatestId=room.persistedCoverage?.legacyComplete?room.persistedCoverage.latest?.e:'';
      let overlapLegacy=false;
      for(const event of data.events)if(event.event_id) {
        if(baseline?.has(event.event_id))overlap=true;
        if(legacyLatestId && event.event_id===legacyLatestId)overlapLegacy=true;
        for(const id of histories.accept(room,event))changed.add(id);scope.verifiedIds.add(event.event_id);
      }
      const values=data.events.map(sequence).filter(value=>value!==null);
      if(data.events.length && !values.length)throw problem('Reddit did not provide a history cursor. Search is incomplete.');
      const oldest=values.length ? Math.min(...values) : 0;
      const newest=values.length ? Math.max(...values) : (cursor!==null ? cursor : 0);
      const reqHi=cursor!==null ? cursor : newest;
      const dated=data.events.filter(event=>['m.room.message','m.sticker'].includes(event.type)).sort((a,b)=>sequence(a)-sequence(b));
      let tLo=0,tHi=0;
      if(dated.length) {
        tLo=dated[0].origin_server_ts || 0;tHi=dated.at(-1).origin_server_ts || 0;
        const chronological=dated.every((event,i)=>Number.isFinite(event.origin_server_ts) && event.origin_server_ts>0 && (!i || event.origin_server_ts>=dated[i-1].origin_server_ts));
        if(!chronological || scope.headVerified && !refreshing && chronological && dated.at(-1).origin_server_ts>scope.coveredStart)scope.dateOrderSafe=false;
        if(chronological)scope.coveredStart=Math.min(scope.coveredStart,dated[0].origin_server_ts);
      }
      if(scope.cursor===null || refreshing)scope.headVerified=true;
      const touchesPersisted=Boolean(topSpan && (!data.events.length || oldest<=topSpan.hi+1));
      const done=!data.events.length || oldest===0 || overlap && wasDone || Boolean(touchesPersisted && topSpan.bottom) || Boolean(!parent && overlapLegacy);
      const spanMeta={p:parent,lo:touchesPersisted?Math.min(oldest,topSpan.lo):oldest,hi:Math.max(reqHi,newest),tLo,tHi,bottom:Boolean(done && (!overlap || wasDone)),src:'history',...(overlapLegacy?{overlapLegacy:true}:{})};
      publishCache(ctx,room.roomId,data.events,'history-page',room.dirtyThreads.size ? {complete:false,dateComplete:false} : undefined,[],spanMeta);
      if(done) {
        scope.done=true;
        if(!parent || (room.roots.get(parent)?.count || 0)<=rootCount)room.dirtyThreads.delete(parent);
      } else if(touchesPersisted) {
        // Head gap closed: jump straight below the persisted span without refetching its messages.
        const jumped=topSpan.lo-1;
        if(topSpan.tLo>0)scope.coveredStart=Math.min(scope.coveredStart,topSpan.tLo);
        topSpan=null;
        if(jumped<0){scope.done=true;}
        else{cursor=jumped;scope.cursor=scope.cursor===null ? jumped : Math.min(scope.cursor,jumped);}
      } else {
        const next=refreshing && overlap && resumeCursor!==null ? Math.min(oldest-1,resumeCursor) : oldest-1;
        if(cursor!==null && next>=cursor)throw problem('Reddit history pagination stopped advancing. Search is incomplete.');
        cursor=next;scope.cursor=scope.cursor===null ? next : Math.min(scope.cursor,next);
      }
      histories.readiness(room);
      historyProgress(ctx,job,room,parent ? 'Searching replies…' : 'Searching older messages…',[...changed]);
      if(scope.done || scopeCoversDate(scope,job.dateStart?.() ?? -Infinity)) {
        if(parent && (room.roots.get(parent)?.count || 0)<=rootCount)room.dirtyThreads.delete(parent);
        return;
      }
    }
  }
  async function history(ctx,job,roomId,request) {
    job.stage='message history';
    rememberRenderedIdentities(ctx);
    const room=histories.get(job.owner,roomId);
    job.requestedDates=job.requestedDates || request.dates || {};historyDateStart(job.requestedDates);historyDateEnd(job.requestedDates);
    if(!room.hydratedFromStore && cacheConsumerReady) {
      const covRes=await storeControl('coverage',job.owner,{roomIds:[roomId]},job).catch(()=>null);
      room.hydratedFromStore=true;
      const savedCov=covRes?.rooms?.[roomId] || null;
      if(savedCov){
        room.persistedCoverage=savedCov;
        for(const [p,info] of Object.entries(savedCov.threads || {})){
          if(!room.roots.has(p))room.roots.set(p,{id:info.root,count:info.count});
          const tspans=savedCov.spans?.[p] || [];
          const ttop=tspans.length?tspans[tspans.length-1]:null;
          if(!ttop?.bottom || info.dirty)room.dirtyThreads.add(p);
        }
      }
    }
    const native=ctx.client.getRoom?.(roomId);
    if(native)rememberMembers(stateOf(cachedRoom(native)),ctx);
    const live=native?.getLiveTimeline?.()?.getEvents?.() || native?.getUnfilteredTimelineSet?.()?.getEvents?.() || [];
    const cached=[...live,...(native?.getThreads?.() || []).flatMap(thread=>[thread.rootEvent,...(thread.events || [])].filter(Boolean))];
    publishCache(ctx,roomId,cached,'native-memory');
    for(const value of cached){const raw=value.event || value;if(!room.events.has(raw.event_id))histories.accept(room,raw);}
    if(room.events.size)historyProgress(ctx,job,room,'Searching cached messages…');
    if((room.complete || rangeCovered(room,historyDateStart(job.requestedDates))) && !request.refresh) {
      job.historyMeta={complete:room.complete,dateComplete:true,dates:job.requestedDates,redacted:[...room.removed],...(room.resumedFromStore?{resumedFromStore:true}:{})};
      publishCache(ctx,roomId,[],'history-verified',job.historyMeta);
      if(cacheConsumerReady)await flushNativeCache(job,()=>check(job));
      return projectHistory(room,ctx);
    }
    let load=room.loading;
    if(!load) {
      load={jobs:new Set(),promise:null};room.loading=load;
    }
    load.jobs.add(job);
    if(!load.promise) {
      const shared={ctx,owner:job.owner,priority:'interactive',loaded:room.events.size,
        dateStart:()=>Math.min(...[...load.jobs].filter(job=>!job.cancelled).map(job=>historyDateStart(job.requestedDates))),
        get cancelled(){return ![...load.jobs].some(job=>!job.cancelled);},
        request:{broadcast:fields=>{for(const subscriber of load.jobs)if(!subscriber.cancelled)emit(subscriber.request,fields);}}};
      load.promise=(async()=>{
        do {
          await readTimeline(ctx,shared,room,'',Boolean(request.refresh));
          for(const [parent]of room.roots)await readTimeline(ctx,shared,room,parent,Boolean(request.refresh) || room.dirtyThreads.has(parent));
          await profiles([...room.events.values()].filter(event=>['m.room.message','m.sticker'].includes(event.type)&&event.content?.['m.relates_to']?.rel_type!=='m.replace'&&!room.removed.has(event.event_id)&&[...load.jobs].some(job=>!job.cancelled && event.origin_server_ts>=historyDateStart(job.requestedDates) && event.origin_server_ts<historyDateEnd(job.requestedDates))).map(event=>event.sender),ctx,shared,{refresh:Boolean(request.refresh),optional:true});
          check(shared);
          // A subscriber can widen dates or join during optional enrichment.
          // Continue the saved cursors before reporting its range as searched.
        } while(!rangeCovered(room,shared.dateStart()));
        check(shared);histories.readiness(room);
        historyProgress(ctx,shared,room,room.complete ? 'Available history indexed' : rangeCovered(room,shared.dateStart()) ? 'Selected dates searched' : 'More replies are available');
        return projectHistory(room,ctx);
      })().finally(()=>{if(room.loading===load)room.loading=null;histories.trim();});
    }
    try {
      const records=await load.promise;check(job);
      job.historyMeta={complete:room.complete,dateComplete:rangeCovered(room,historyDateStart(job.requestedDates)),dates:job.requestedDates,redacted:[...room.removed],...(room.resumedFromStore?{resumedFromStore:true}:{})};
      publishCache(ctx,roomId,[],'history-verified',job.historyMeta);if(cacheConsumerReady)await flushNativeCache(job,()=>check(job));return records;
    } finally {load.jobs.delete(job);}
  }
  document.addEventListener('rcs-message-cache-reset',event=>{
    let value;try{value=JSON.parse(event.detail);}catch{return;}
    if(!watchedOwner || value?.owner!==watchedOwner || watchedClient?.getUserId?.()!==watchedOwner)return;
    captureSignatures.clear();capturedIdentities.clear();capturedCoverage.clear();histories.clear();
    const ctx=nativeCapture?.ctx;
    if(ctx){
      // Clear cancels pre-clear snapshot jobs. Existing tails form the baseline;
      // unchanged syncs must not immediately refill data the user just cleared.
      nativeCapture={client:watchedClient,owner:watchedOwner,ctx,pending:new Map(),snapshots:new Map(),task:null,recovery:null,incomplete:false,missing:new Set()};
      for(const room of watchedClient.getRooms?.() || [])try{nativeCapture.snapshots.set(room.roomId,nativeRoomEvents(room).map(value=>value?.event || value));}catch{}
    }
  });
  document.addEventListener('rcs-message-cache-rejected',event=>{
    let value;try{value=JSON.parse(event.detail);}catch{return;}
    const state=nativeCapture;
    if(!state || value?.owner!==state.owner || state.client.getUserId()!==state.owner || typeof value.id!=='string' || !Array.isArray(value.events))return;
    const rooms=new Set(value.roomId?[value.roomId]:[]),wanted=new Map();
    for(const item of value.events){if(typeof item.roomId!=='string' || typeof item.id!=='string')continue;rooms.add(item.roomId);if(!wanted.has(item.roomId))wanted.set(item.roomId,new Set());wanted.get(item.roomId).add(item.id);state.missing.add(item.roomId+'\n'+item.id);captureSignatures.delete(item.roomId+'\n'+item.id);if(item.sender)capturedIdentities.delete(item.sender);}
    const identities=Array.isArray(value.identities)?value.identities:[];
    for(const id of identities)capturedIdentities.delete(id);
    for(let i=0;i<identities.length;i+=200)state.pending.set('identity-recovery:'+i,{identities:identities.slice(i,i+200)});
    state.recovery=value.id;
    for(const id of rooms){
      capturedCoverage.delete(id);const native=state.client.getRoom?.(id),history=histories.get(state.owner,id,false);
      const add=(key,source)=>{const before=state.pending.get(key)?.wanted,ids=wanted.get(id);state.pending.set(key,{...source,roomId:id,force:true,...(ids?.size?{wanted:new Set([...(before || []),...ids])}:{})});};
      if(history?.owner===state.owner)add('history-recovery:'+id,{history});
      if(native)add('native-recovery:'+id,{native});
      if(!native && history?.owner!==state.owner)state.incomplete=true;
    }
    state.failed=false;runNativeCapture(state);
  });
  // Finding the floating chat shell scans every div, in every frame of every Reddit page.
  // The 1.5 s tick stays, but it skips ticks (up to 20, i.e. 30 s) until chat exists:
  // a chat component connecting (rcs-chat-present) or a chat starting resets it.
  let chatSeen=false,observeTicks=1,skipTicks=0;
  const observeNativeClient=()=>{
    let live=chatSeen;
    try{const ctx=context();if(ctx.client?.getUserId?.()){live=true;watchDirectory(ctx);announceNativeCache(ctx);}}catch{ /* Native discovery is optional and fail open. */ }
    observeTicks=live ? 1 : Math.min(observeTicks*2,20);skipTicks=observeTicks-1;
  };
  const noteChat=()=>{if(chatSeen)return;chatSeen=true;observeTicks=1;setTimeout(observeNativeClient,0);document.dispatchEvent(new CustomEvent('rcs-chat-present'));};
  if(globalThis.customElements?.define) {
    const define=customElements.define;
    customElements.define=function(name,constructor,...args){
      try{
        const proto=name.startsWith('rs-') && constructor?.prototype,original=proto && proto.connectedCallback;
        if(typeof original==='function' && !Object.hasOwn(proto,'__rcsChatSeen')) {
          Object.defineProperty(proto,'__rcsChatSeen',{value:true});
          proto.connectedCallback=function(...args){noteChat();return original.apply(this,args);};
        }
      }catch{ /* Never block Reddit's own component registration. */ }
      return define.call(this,name,constructor,...args);
    };
  }
  setTimeout(observeNativeClient,0);
  setInterval(()=>{if(skipTicks>0)skipTicks--;else observeNativeClient();},1500);
  document.addEventListener('rcs-chat-starting',()=>{chatSeen=true;observeNativeClient();});
  document.addEventListener(requestEvent,async event => {
    let request;
    try { request=JSON.parse(event.detail); } catch { return; }
    if (!request || typeof request.channel!=='string' || typeof request.id!=='string' || request.channel.length>100 || request.id.length>100) return;
    const key=`${request.channel}:${request.id}`;
    if (request.method==='cancel') { const job=running.get(key); if(job)job.cancelled=true;return; }
    if(request.method==='history-range'){const job=running.get(key);if(job){try{historyDateStart(request.dates);historyDateEnd(request.dates);job.requestedDates=request.dates || {};}catch{}}return;}
    if (!['identity-context','identity-snapshot','cache-native-history','directory-context','prime-directory','conversations','activity','history','open','jump','native-bindings','classify-accounts'].includes(request.method)) return;
    if (['history','open','jump'].includes(request.method) && (typeof request.roomId!=='string' || request.roomId.length>1000)) return;
    if(request.knownIds && (!Array.isArray(request.knownIds) || request.knownIds.some(id=>typeof id!=='string' || id.length>1000)))return;
    if (request.method==='jump' && (typeof request.eventId!=='string' || request.eventId.length>1000)) return;
    const job={cancelled:false,stage:'connection',request,priority:['history','open','jump'].includes(request.method)?'interactive':'background'};running.set(key,job);
    try {
      if(request.method==='jump' && request.eventId.startsWith('~'))throw problem('This result has a temporary Reddit message ID. Open the conversation to check its send status.');
      if(['identity-context','identity-snapshot','cache-native-history'].includes(request.method)) {
        const ctx=await identityReady(job),owner=ctx.client.getUserId();watchDirectory(ctx);
        if(request.method==='cache-native-history') {
          if(request.owner && request.owner!==owner)throw problem('Reddit account changed. Please retry.');
          job.ctx=ctx;job.owner=owner;job.stage='Reddit’s local message cache';
          emit(request,{result:await importNativeHistory(ctx,job)});return;
        }
        if(request.method==='identity-snapshot') {
          if(request.owner!==owner)throw problem('Reddit account changed. Please retry.');
          primeCache(ctx,request);
          RCSNativeIdentities.update(ctx,request);
        }
        // Use only profile data already present in Reddit's native client. The
        // account can have no saved messages yet, and its current avatar should
        // win over an older retained membership/profile snapshot.
        let avatar='';
        try{const person=historyIdentity(ctx,owner);avatar=safeImage(ctx.client.getUser?.(owner)?.avatarUrl,ctx.client) || person.avatar;}catch{ /* Profile changes must not block authenticated cache reads. */ }
        emit(request,{result:{owner,selfIdentity:{id:owner,name:'You',self:true,avatar}}});return;
      }
      const ctx=await ready(job,{navigation:['open','jump'].includes(request.method)});const owner=ctx.client.getUserId();let result;
      job.ctx=ctx;job.owner=owner;
      if(knownOwner!==owner){knownConversations.clear();knownRoomStates.clear();histories.clear();knownOwner=owner;}
      watchDirectory(ctx);
      if(request.method==='directory-context')result=directoryContext(ctx);
      else if(request.method==='native-bindings')result=nativeBindings(ctx,request);
      else if(request.method==='classify-accounts')result=queueClassification(ctx,request);
      else if(request.method==='activity')result=await activity(ctx,job,request);
      else if(request.method==='prime-directory') {
        result=primeCache(ctx,request);
      }
      else if (request.method==='conversations') result=await conversations(ctx,job,request);
      else if (request.method==='history') result=await history(ctx,job,request.roomId,request);
      else {
        job.stage='navigation';
        await prepareNavigation(ctx,job,request.roomId);
        if(request.method==='jump' && typeof ctx.client.fetchRoomEvent==='function' &&
          (typeof ctx.client.getRoom!=='function' || ctx.client.getRoom(request.roomId)) &&
          !nativeEventLoaded(ctx,request.roomId,request.eventId)) {
          // Reddit's exact-event loader hydrates the native timeline around the
          // selected event. Route changes alone can resolve before that load
          // fails, leaving the search UI reporting a jump that never happened.
          job.stage='selected message';
          emit(request,{progress:{label:'Opening message…'}});
          await retryRead(()=>ctx.client.fetchRoomEvent(request.roomId,request.eventId),job);
          check(job);
        }
        check(job);
        const route=`/room/${encodeURIComponent(request.roomId)}${request.method==='jump' ? `/event/${encodeURIComponent(request.eventId)}${request.thread ? '/thread' : ''}` : ''}`;
        await ctx.history.navigate(route);result={route};
      }
      check(job);if(ctx.client.getUserId()!==owner)throw problem('Reddit account changed. Please retry.');emit(request,{result,...(job.historyMeta ? {historyMeta:job.historyMeta} : {})});
    } catch(error) {
      const status=Number(error.httpStatus || error.status);
      const code=typeof error.errcode==='string' && /^[A-Z_]{1,60}$/.test(error.errcode) ? error.errcode : '';
      const detail=Number.isInteger(status) && status>0 ? `HTTP ${status}${code ? ` ${code}` : ''}` : error.name==='TypeError' ? 'client interface unavailable' : '';
      emit(request,{error:error.name==='AbortError' ? 'Search cancelled' : error.rcsMessage || `Unable to load ${job.stage}${detail ? ` (${detail})` : ''}. Please retry.`,cancelled:error.name==='AbortError'});
    }
    finally { running.delete(key); }
  });
})();
