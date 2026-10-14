/* Extension-owned message storage. Only compact chat events and identity hints are retained. */
(() => {
  const ownerOK=value=>typeof value==='string' && /^@[^:\s]{1,200}:[^\s]{1,200}$/.test(value);
  const str=(value,max=1000)=>typeof value==='string'?value.slice(0,max):'';
  function previewURL(value){
    if(typeof value!=='string' || !value || value.length>2000)return '';
    try{const url=new URL(value);if(url.protocol!=='https:' || url.username || url.password || url.hash)return '';
      for(const key of url.searchParams.keys())if(/token|auth|signature|credential|password|(?:^|[_-])key(?:$|[_-])/i.test(key))return '';
      return url.href;
    }catch{return '';}
  }
  function compact(raw,roomId) {
    if(!raw || !['m.room.message','m.sticker','m.room.redaction'].includes(raw.type))return null;
    const id=str(raw.event_id),room=str(raw.room_id || roomId);if(!id || !room)return null;
    const content=raw.content || {},relation=content['m.relates_to'] || {},bodyContent=content['m.new_content'] || content;
    const attachmentType=raw.type==='m.sticker'?'image':({'m.image':'image','m.video':'video','m.audio':'audio','m.file':'file'}[bodyContent.msgtype] || '');
    // Only native type/MIME metadata classifies attachments; never guess from
    // filenames. Retain one credential-free image preview reference, not bytes.
    const attachmentMime=attachmentType?str(bodyContent.info?.mimetype,200).trim().toLowerCase().split(';')[0]:'';
    const attachmentPreview=attachmentType==='image'?[bodyContent.rcs_preview_url,bodyContent.url,bodyContent.info?.thumbnail_url].map(previewURL).find(Boolean) || '':'';
    return {id,room,type:raw.type,sender:str(raw.sender),time:Number.isFinite(raw.origin_server_ts)?raw.origin_server_ts:0,
      body:str(bodyContent.body,65536) || (raw.type==='m.sticker'?'Sticker':({image:'Image',video:'Video',audio:'Audio',file:'File'}[attachmentType] || '')),
      attachmentType,attachmentMime,...(attachmentPreview?{attachmentPreview}:{}),
      replaces:relation.rel_type==='m.replace'?str(relation.event_id):'',thread:relation.rel_type==='m.thread',
      threadRoot:relation.rel_type==='m.thread'?str(relation.event_id):'',
      redacts:str(raw.redacts || content.redacts),redacted:Boolean(raw.unsigned?.redacted_because)};
  }
  const bytes=value=>new TextEncoder().encode(JSON.stringify(value)).length;
  const order=(a,b)=>a.time-b.time || a.id.localeCompare(b.id);
  function reduce(row,events,coverage) {
    const ledger=new Map((row.events || []).map(event=>[event.id,event]));
    for(const event of events) {const before=ledger.get(event.id);ledger.set(event.id,before?{...before,body:before.body || event.body,attachmentType:before.attachmentType || event.attachmentType || '',attachmentMime:before.attachmentMime || event.attachmentMime || '',...(event.attachmentPreview || before.attachmentPreview?{attachmentPreview:event.attachmentPreview || before.attachmentPreview}:{}),redacts:before.redacts || event.redacts,redacted:before.redacted || event.redacted}:event);}
    const removed=new Set([...ledger.values()].filter(event=>event.redacted).map(event=>event.id));
    for(const event of ledger.values())if(event.redacts)removed.add(event.redacts);
    // Tombstones must retain identifiers, never deleted message plaintext.
    for(const event of ledger.values())if(removed.has(event.id) || event.replaces && removed.has(event.replaces)){event.body='';event.attachmentType='';event.attachmentMime='';event.attachmentPreview='';event.redacted=true;}
    const edits=new Map();
    for(const event of ledger.values())if(event.replaces && !removed.has(event.id)) {
      const original=ledger.get(event.replaces);if(!original || original.sender!==event.sender)continue;
      const previous=edits.get(event.replaces);if(!previous || order(previous,event)<0)edits.set(event.replaces,event);
    }
    row.events=[...ledger.values()];
    // Materialized metadata references a single stored body; edits do not duplicate message text.
    row.records=row.events.filter(event=>event.type!=='m.room.redaction' && !event.replaces && !removed.has(event.id) && (edits.get(event.id)?.body || event.body)).map(event=>({id:event.id,bodyEvent:edits.get(event.id)?.id || event.id,sender:event.sender,time:event.time,thread:event.thread,threadRoot:event.threadRoot}));
    // Any unverified incoming batch may contain a gap (including unseen thread replies).
    row.coverage=coverage ? {complete:coverage.complete===true,dateComplete:coverage.dateComplete===true,dates:{from:str(coverage.dates?.from,10),to:str(coverage.dates?.to,10)}} : {complete:false,dateComplete:false};
    delete row.approxBytes;row.approxBytes=bytes(row);return row;
  }
  function meaningfulName(value) {
    const name=str(value).trim(),normalized=name.normalize('NFKC').toLocaleLowerCase();
    return !name || name.startsWith('@') || ['[deleted]','[removed]','someone','unknown sender','username unavailable','deleted user','message'].includes(normalized)?'':name;
  }
  function identity(person) {
    if(!ownerOK(person?.id))return null;
    return {id:person.id,name:meaningfulName(person.name),avatar:/^https:\/\//.test(person.avatar || '')?str(person.avatar,2000):'',self:Boolean(person.self),historical:Boolean(person.historical ?? person.historicalName),unavailable:Boolean(person.unavailable ?? person.accountUnavailable),availabilityKnown:Boolean(person.availabilityKnown || person.unavailable || person.accountUnavailable)};
  }
  function mergeIdentity(before,after) {
    const previous=identity(before) || {},incoming=identity(after);if(!incoming)return previous;
    const name=incoming.name || previous.name || '',unavailable=incoming.availabilityKnown?incoming.unavailable:Boolean(previous.unavailable);
    return {...previous,...incoming,name,avatar:incoming.avatar || previous.avatar || '',availabilityKnown:incoming.availabilityKnown || Boolean(previous.availabilityKnown),unavailable,
      historical:incoming.availabilityKnown && !unavailable?incoming.historical:Boolean(incoming.historical || previous.historical || unavailable && name)};
  }
  const request=task=>new Promise((resolve,reject)=>{task.onsuccess=()=>resolve(task.result);task.onerror=()=>reject(task.error || Error('Message storage failed'));});
  const done=tx=>new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=tx.onerror=()=>reject(tx.error || Error('Message storage failed'));});
  class Store {
    constructor({indexedDB=globalThis.indexedDB,name='rcs-messages-v1'}={}) {this.idb=indexedDB;this.name=name;this.persistent=Boolean(indexedDB);this.memory=new Map();this.identities=new Map();this.database=null;this.queue=Promise.resolve();}
    async db() {
      if(!this.persistent)return null;
      if(!this.database)this.database=new Promise((resolve,reject)=>{const open=this.idb.open(this.name,1);open.onupgradeneeded=()=>{open.result.createObjectStore('rooms',{keyPath:['owner','roomId']});open.result.createObjectStore('identities',{keyPath:'owner'});};open.onsuccess=()=>resolve(open.result);open.onerror=()=>reject(open.error);open.onblocked=()=>reject(Error('Message database blocked'));});
      try{return await this.database;}catch(error){this.database=null;throw error;}
    }
    ingest(batch) {const result=this.queue.then(()=>this.write(batch));this.queue=result.catch(()=>{});return result;}
    async write(batch) {
      if(!ownerOK(batch?.owner))throw Error('Invalid account');
      if(!Array.isArray(batch.events) || batch.events.length>1000 || (batch.identities?.length || 0)>1000)throw Error('Invalid message batch');
      const grouped=new Map();for(const raw of batch.events){const event=compact(raw,batch.roomId);if(event){if(!grouped.has(event.room))grouped.set(event.room,[]);grouped.get(event.room).push(event);}}
      if(batch.roomId && !grouped.has(batch.roomId))grouped.set(str(batch.roomId),[]);
      const db=await this.db(),tx=db?.transaction(['rooms','identities'],'readwrite'),completion=tx?done(tx):null;
      try {
        const read=tx?request(tx.objectStore('identities').get(batch.owner)):Promise.resolve(this.identities.get(batch.owner));
        const rows=await Promise.all([...grouped.keys()].map(roomId=>tx?request(tx.objectStore('rooms').get([batch.owner,roomId])):Promise.resolve(this.memory.get(JSON.stringify([batch.owner,roomId])))));
        const previous=await read,people={...previous?.people};let identitiesChanged=false;
        for(const raw of batch.identities || []){const person=identity(raw);if(person){const merged=mergeIdentity(people[person.id],person);if(JSON.stringify(people[person.id])!==JSON.stringify(merged)){people[person.id]=merged;identitiesChanged=true;}}}
        if(identitiesChanged){const saved={...previous,owner:batch.owner,people};delete saved.approxBytes;saved.approxBytes=bytes(saved);if(tx)tx.objectStore('identities').put(saved);else this.identities.set(batch.owner,saved);}
        const roomIds=[];let i=0;
        for(const [roomId,events]of grouped){
          const before=rows[i++],ledger=new Map((before?.events || []).map(event=>[event.id,event])),coverage=roomId===batch.roomId?batch.coverage:undefined;
          const changed=!before || events.some(event=>{const saved=ledger.get(event.id);return !saved || !saved.redacted && (event.attachmentType && !saved.attachmentType || event.attachmentMime && !saved.attachmentMime || event.attachmentPreview && event.attachmentPreview!==saved.attachmentPreview || event.attachmentType && !saved.body && event.body) || event.redacted && !saved.redacted || event.redacts && !saved.redacts;}) || coverage && JSON.stringify({complete:coverage.complete===true,dateComplete:coverage.dateComplete===true,dates:{from:str(coverage.dates?.from,10),to:str(coverage.dates?.to,10)}})!==JSON.stringify(before.coverage);
          // A startup reconciliation can read old cached rows again. Compare
          // their durable ledger before reducing/rewriting a whole room.
          if(!changed)continue;
          const row=reduce(before || {owner:batch.owner,roomId,events:[]},events,coverage);
          if(tx)tx.objectStore('rooms').put(row);else this.memory.set(JSON.stringify([batch.owner,roomId]),row);roomIds.push(roomId);
        }
        if(completion)await completion;return {owner:batch.owner,persistent:this.persistent,changed:identitiesChanged || roomIds.length>0,...(!identitiesChanged?{roomIds}:{})};
      } catch(error){try{tx?.abort();}catch{}await completion?.catch(()=>{});throw error;}
    }
    async snapshot(owner,roomId,{committed=false}={}) {
      if(!ownerOK(owner))throw Error('Invalid account');if(!committed)await this.queue;
      const db=await this.db();if(!db)return {rows:[...this.memory.values()].filter(row=>row.owner===owner && (!roomId || row.roomId===roomId)),people:this.identities.get(owner)?.people || {},identityBytes:this.identities.get(owner)?.approxBytes || 0,nativeReconciledAt:this.identities.get(owner)?.nativeReconciledAt || 0,nativeImportComplete:Boolean(this.identities.get(owner)?.nativeImportComplete)};
      // IndexedDB still orders this readonly transaction against an active
      // write. Future queued captures cannot delay this committed snapshot.
      const tx=db.transaction(['rooms','identities'],'readonly');const [found,identities]=await Promise.all([request(roomId?tx.objectStore('rooms').get([owner,roomId]):tx.objectStore('rooms').getAll(IDBKeyRange.bound([owner,''],[owner,'\uffff']))),request(tx.objectStore('identities').get(owner))]);const rows=roomId?(found?[found]:[]):found;return {rows,people:identities?.people || {},identityBytes:identities?.approxBytes || 0,nativeReconciledAt:identities?.nativeReconciledAt || 0,nativeImportComplete:Boolean(identities?.nativeImportComplete)};
    }
    async search(owner,{query='',roomId,roomIds,dates={},from='all',wholeWord=false,sort='newest',grouped=false,limit=200,offset=0,committed=false}={},directory) {
      if(typeof query!=='string' || query.length>1000 || !Number.isInteger(limit) || limit<1 || limit>500 || !Number.isInteger(offset) || offset<0 || offset>1000000 || !['all','me','them'].includes(from) || !['newest','oldest','relevant'].includes(sort) || roomIds!==undefined && (!Array.isArray(roomIds) || roomIds.some(id=>typeof id!=='string' || !id || id.length>1000)))throw Error('Invalid message query');
      return this.searchSnapshot(owner,await this.snapshot(owner,roomId,{committed}),{query,roomId,roomIds,dates,from,wholeWord,sort,grouped,limit,offset},directory);
    }
    async room(owner,roomId,directory,{committed=false}={}) {
      if(typeof roomId!=='string' || !roomId || roomId.length>1000)throw Error('Invalid room');
      return this.searchSnapshot(owner,await this.snapshot(owner,roomId,{committed}),{query:'',roomId,dates:{},limit:Infinity,offset:0},directory);
    }
    materialize(owner,row,record,ledger,people,directory,identityCache,numericTime=false) {
      const text=ledger.get(record.bodyEvent)?.body || '';
      let person=identityCache?.get(record.sender);
      if(!person){const cached=people[record.sender] || {},known=directory?.identities?.[record.sender] || {};person=mergeIdentity(cached,{...known,id:record.sender});identityCache?.set(record.sender,person);}
      const self=record.sender===owner;
      return {id:record.id,roomId:row.roomId,text,sender:record.sender,timestamp:numericTime?(record.time || NaN):record.time?new Date(record.time).toISOString():'',attachmentType:ledger.get(record.bodyEvent)?.attachmentType || '',attachmentMime:ledger.get(record.bodyEvent)?.attachmentMime || '',attachmentPreview:ledger.get(record.bodyEvent)?.attachmentPreview || '',author:self?'You':person.name || record.sender,authorSelf:self,authorHistorical:Boolean(person.historical ?? person.historicalName),authorUnavailable:Boolean(person.unavailable ?? person.accountUnavailable),avatar:person.avatar || '',thread:record.thread,threadRoot:record.threadRoot};
    }
    searchSnapshot(owner,{rows,people,identityBytes},{query,roomId,roomIds,dates,from='all',wholeWord=false,sort='newest',grouped=false,limit,offset},directory) {
      const parsed=RCSCore.parseQuery(query),match=RCSCore.prepareQuery(parsed,{from,wholeWord,dates}),records=[],times=new Map(),identityCache=new Map(),allowed=roomIds?new Set(roomIds):null,mediaTypes=new Set();
      for(const row of rows){const ledger=new Map(row.events.map(event=>[event.id,event])),included=(!roomId || row.roomId===roomId) && (!allowed || allowed.has(row.roomId));for(const record of row.records){
        const bodyEvent=ledger.get(record.bodyEvent);
        // Discover supported cache types during the existing traversal, even
        // when the current text, sender or room filters exclude their messages.
        if(bodyEvent?.body){if(bodyEvent.attachmentType)mediaTypes.add(bodyEvent.attachmentType);if(bodyEvent.attachmentType==='image' && bodyEvent.attachmentMime==='image/gif')mediaTypes.add('gif');if(/\b(?:https?:\/\/|www\.)\S+/i.test(bodyEvent.body))mediaTypes.add('link');}
        if(!included)continue;
        const message=this.materialize(owner,row,record,ledger,people,directory,identityCache,true);
        if(message.text && match(message)){times.set(message,record.time || 0);records.push(message);}
      }}
      const relevance=message=>RCSCore.relevanceScore(message.text,parsed,{wholeWord});
      const scores=sort==='relevant'?new Map(records.map(record=>[record,relevance(record)])):null;
      records.sort((a,b)=>(scores?scores.get(b)-scores.get(a):0) || (sort==='oldest'?1:-1)*(times.get(a)-times.get(b)) || a.roomId.localeCompare(b.roomId) || a.id.localeCompare(b.id));
      const counts=new Map();for(const record of records)counts.set(record.roomId,(counts.get(record.roomId)||0)+1);
      const page=records.slice(offset,offset+limit),groups=[];
      for(const record of page)record.timestamp=Number.isFinite(record.timestamp)?new Date(record.timestamp).toISOString():'';
      if(grouped){const byRoom=new Map();for(const [id,total]of counts){const group={roomId:id,total,records:[]};byRoom.set(id,group);groups.push(group);}for(const record of page)byRoom.get(record.roomId).records.push(record);}
      return {owner,persistent:this.persistent,records:page,total:records.length,hasMore:offset+limit<records.length,matchedRooms:counts.size,availableMediaTypes:['image','gif','video','audio','file','link'].filter(type=>mediaTypes.has(type)),...(grouped?{groups}:{}),stats:this.statistics(rows,people,identityBytes),coverage:roomId?rows.find(row=>row.roomId===roomId)?.coverage || {complete:false,dateComplete:false}:{complete:false,unknownRooms:true,threadsVerified:false}};
    }
    async summaries(owner,{committed=false}={}) {
      const {rows,people}=await this.snapshot(owner,undefined,{committed}),summaries=[];
      for(const row of rows){const ledger=new Map(row.events.map(event=>[event.id,event]));const latest=row.records.filter(record=>ledger.get(record.bodyEvent)?.body).sort((a,b)=>order(b,a))[0];if(!latest)continue;
        summaries.push({id:latest.id,roomId:row.roomId,attachmentType:ledger.get(latest.bodyEvent).attachmentType || '',attachmentMime:ledger.get(latest.bodyEvent).attachmentMime || '',attachmentPreview:ledger.get(latest.bodyEvent).attachmentPreview || '',text:ledger.get(latest.bodyEvent).body.slice(0,200),timestamp:latest.time?new Date(latest.time).toISOString():'',authorSelf:latest.sender===owner,author:latest.sender===owner?'You':people[latest.sender]?.name || ''});}
      summaries.sort((a,b)=>(Date.parse(b.timestamp)||0)-(Date.parse(a.timestamp)||0) || a.roomId.localeCompare(b.roomId));
      return {owner,persistent:this.persistent,summaries};
    }
    statistics(rows,people,identityBytes) {return {messages:rows.reduce((sum,row)=>sum+row.records.length,0),rooms:rows.length,completeRooms:rows.filter(row=>row.coverage.complete).length,approxBytes:rows.reduce((sum,row)=>sum+(row.approxBytes ?? bytes(row)),0)+(identityBytes ?? (Array.isArray(people)?people.reduce((sum,person)=>sum+(person.approxBytes ?? bytes(person)),0):bytes(people)))};}
    async importState(owner,mark=false) {await this.queue;const db=await this.db();if(!db){const saved=this.identities.get(owner) || {owner,people:{}};if(mark){saved.nativeImportComplete=true;saved.nativeReconciledAt=Date.now();delete saved.approxBytes;saved.approxBytes=bytes(saved);this.identities.set(owner,saved);}return mark || Boolean(saved.nativeImportComplete);}const tx=db.transaction('identities',mark?'readwrite':'readonly'),completion=done(tx);const saved=await request(tx.objectStore('identities').get(owner)) || {owner,people:{}};if(mark){saved.nativeImportComplete=true;saved.nativeReconciledAt=Date.now();delete saved.approxBytes;saved.approxBytes=bytes(saved);tx.objectStore('identities').put(saved);}await completion;return mark || Boolean(saved.nativeImportComplete);}
    async stats(owner,{committed=false}={}) {if(owner){const {rows,people,identityBytes,nativeReconciledAt,nativeImportComplete}=await this.snapshot(owner,undefined,{committed});return {owner,persistent:this.persistent,nativeImportComplete,nativeReconciledAt,stats:this.statistics(rows,people,identityBytes)};}if(!committed)await this.queue;const db=await this.db();const rows=db?await request(db.transaction('rooms').objectStore('rooms').getAll()):[...this.memory.values()];const people=db?await request(db.transaction('identities').objectStore('identities').getAll()):[...this.identities.values()];return {persistent:this.persistent,accounts:new Set([...rows.map(row=>row.owner),...people.map(person=>person.owner)]).size,stats:this.statistics(rows,people)};}
    async clear(owner) {await this.queue;const db=await this.db();if(!db){for(const [key,row]of this.memory)if(!owner || row.owner===owner)this.memory.delete(key);if(owner)this.identities.delete(owner);else this.identities.clear();return;}
      const tx=db.transaction(['rooms','identities'],'readwrite'),completion=done(tx);if(!owner){tx.objectStore('rooms').clear();tx.objectStore('identities').clear();}else{const rows=await request(tx.objectStore('rooms').getAll());for(const row of rows)if(row.owner===owner)tx.objectStore('rooms').delete([owner,row.roomId]);tx.objectStore('identities').delete(owner);}await completion;}
  }
  globalThis.RCSMessageStore=Object.freeze({Store,compact,reduce,ownerOK,previewURL});
})();
