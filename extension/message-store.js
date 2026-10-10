/* Extension-owned message storage. Only compact chat events and identity hints are retained. */
(() => {
  const ownerOK=value=>typeof value==='string' && /^@[^:\s]{1,200}:[^\s]{1,200}$/.test(value);
  const str=(value,max=1000)=>typeof value==='string'?value.slice(0,max):'';
  function compact(raw,roomId) {
    if(!raw || !['m.room.message','m.sticker','m.room.redaction'].includes(raw.type))return null;
    const id=str(raw.event_id),room=str(raw.room_id || roomId);if(!id || !room)return null;
    const content=raw.content || {},relation=content['m.relates_to'] || {};
    return {id,room,type:raw.type,sender:str(raw.sender),time:Number.isFinite(raw.origin_server_ts)?raw.origin_server_ts:0,
      body:str(content['m.new_content']?.body ?? content.body,65536) || (raw.type==='m.sticker'?'Sticker':''),
      replaces:relation.rel_type==='m.replace'?str(relation.event_id):'',thread:relation.rel_type==='m.thread',
      threadRoot:relation.rel_type==='m.thread'?str(relation.event_id):'',
      redacts:str(raw.redacts || content.redacts),redacted:Boolean(raw.unsigned?.redacted_because)};
  }
  const bytes=value=>new TextEncoder().encode(JSON.stringify(value)).length;
  const order=(a,b)=>a.time-b.time || a.id.localeCompare(b.id);
  function reduce(row,events,coverage) {
    const ledger=new Map((row.events || []).map(event=>[event.id,event]));
    for(const event of events) {const before=ledger.get(event.id);ledger.set(event.id,before?{...before,redacts:before.redacts || event.redacts,redacted:before.redacted || event.redacted}:event);}
    const removed=new Set([...ledger.values()].filter(event=>event.redacted).map(event=>event.id));
    for(const event of ledger.values())if(event.redacts)removed.add(event.redacts);
    // Tombstones must retain identifiers, never deleted message plaintext.
    for(const event of ledger.values())if(removed.has(event.id) || event.replaces && removed.has(event.replaces))event.body='';
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
          const changed=!before || events.some(event=>{const saved=ledger.get(event.id);return !saved || event.redacted && !saved.redacted || event.redacts && !saved.redacts;}) || coverage && JSON.stringify({complete:coverage.complete===true,dateComplete:coverage.dateComplete===true,dates:{from:str(coverage.dates?.from,10),to:str(coverage.dates?.to,10)}})!==JSON.stringify(before.coverage);
          // A startup reconciliation can read old cached rows again. Compare
          // their durable ledger before reducing/rewriting a whole room.
          if(!changed)continue;
          const row=reduce(before || {owner:batch.owner,roomId,events:[]},events,coverage);
          if(tx)tx.objectStore('rooms').put(row);else this.memory.set(JSON.stringify([batch.owner,roomId]),row);roomIds.push(roomId);
        }
        if(completion)await completion;return {owner:batch.owner,persistent:this.persistent,changed:identitiesChanged || roomIds.length>0,...(!identitiesChanged?{roomIds}:{})};
      } catch(error){try{tx?.abort();}catch{}await completion?.catch(()=>{});throw error;}
    }
    async snapshot(owner,roomId) {
      if(!ownerOK(owner))throw Error('Invalid account');await this.queue;
      const db=await this.db();if(!db)return {rows:[...this.memory.values()].filter(row=>row.owner===owner && (!roomId || row.roomId===roomId)),people:this.identities.get(owner)?.people || {},identityBytes:this.identities.get(owner)?.approxBytes || 0,nativeReconciledAt:this.identities.get(owner)?.nativeReconciledAt || 0};
      const tx=db.transaction(['rooms','identities'],'readonly');const [found,identities]=await Promise.all([request(roomId?tx.objectStore('rooms').get([owner,roomId]):tx.objectStore('rooms').getAll(IDBKeyRange.bound([owner,''],[owner,'\uffff']))),request(tx.objectStore('identities').get(owner))]);const rows=roomId?(found?[found]:[]):found;return {rows,people:identities?.people || {},identityBytes:identities?.approxBytes || 0,nativeReconciledAt:identities?.nativeReconciledAt || 0};
    }
    async search(owner,{query='',roomId,dates={},limit=200,offset=0}={},directory) {
      if(typeof query!=='string' || query.length>1000 || !Number.isInteger(limit) || limit<1 || limit>500 || !Number.isInteger(offset) || offset<0 || offset>1000000)throw Error('Invalid message query');
      const {rows,people,identityBytes}=await this.snapshot(owner,roomId),bounds=RCSCore.dateBounds(dates),records=[];
      for(const row of rows)if(!roomId || row.roomId===roomId){const ledger=new Map(row.events.map(event=>[event.id,event]));for(const record of row.records){const text=ledger.get(record.bodyEvent)?.body || '';if(!text || bounds.invalid || !RCSCore.matches(text,query) || bounds.active && !(record.time>=bounds.start && record.time<bounds.end))continue;
        const cached=people[record.sender] || {},known=directory?.identities?.[record.sender] || {},person=mergeIdentity(cached,{...known,id:record.sender}),self=record.sender===owner;
        records.push({id:record.id,roomId:row.roomId,text,sender:record.sender,timestamp:record.time?new Date(record.time).toISOString():'',author:self?'You':person.name || record.sender,authorSelf:self,authorHistorical:Boolean(person.historical ?? person.historicalName),authorUnavailable:Boolean(person.unavailable ?? person.accountUnavailable),avatar:person.avatar || '',thread:record.thread,threadRoot:record.threadRoot});}}
      records.sort((a,b)=>(Date.parse(b.timestamp)||0)-(Date.parse(a.timestamp)||0) || a.roomId.localeCompare(b.roomId) || a.id.localeCompare(b.id));
      return {owner,persistent:this.persistent,records:records.slice(offset,offset+limit),total:records.length,hasMore:offset+limit<records.length,stats:this.statistics(rows,people,identityBytes),coverage:roomId?rows.find(row=>row.roomId===roomId)?.coverage || {complete:false,dateComplete:false}:{complete:false,unknownRooms:true,threadsVerified:false}};
    }
    statistics(rows,people,identityBytes) {return {messages:rows.reduce((sum,row)=>sum+row.records.length,0),rooms:rows.length,completeRooms:rows.filter(row=>row.coverage.complete).length,approxBytes:rows.reduce((sum,row)=>sum+(row.approxBytes ?? bytes(row)),0)+(identityBytes ?? (Array.isArray(people)?people.reduce((sum,person)=>sum+(person.approxBytes ?? bytes(person)),0):bytes(people)))};}
    async importState(owner,mark=false) {await this.queue;const db=await this.db();if(!db){const saved=this.identities.get(owner) || {owner,people:{}};if(mark){saved.nativeImportComplete=true;saved.nativeReconciledAt=Date.now();delete saved.approxBytes;saved.approxBytes=bytes(saved);this.identities.set(owner,saved);}return mark || Boolean(saved.nativeImportComplete);}const tx=db.transaction('identities',mark?'readwrite':'readonly'),completion=done(tx);const saved=await request(tx.objectStore('identities').get(owner)) || {owner,people:{}};if(mark){saved.nativeImportComplete=true;saved.nativeReconciledAt=Date.now();delete saved.approxBytes;saved.approxBytes=bytes(saved);tx.objectStore('identities').put(saved);}await completion;return mark || Boolean(saved.nativeImportComplete);}
    async stats(owner) {if(owner){const {rows,people,identityBytes,nativeReconciledAt}=await this.snapshot(owner);return {owner,persistent:this.persistent,nativeImportComplete:await this.importState(owner),nativeReconciledAt,stats:this.statistics(rows,people,identityBytes)};}await this.queue;const db=await this.db();const rows=db?await request(db.transaction('rooms').objectStore('rooms').getAll()):[...this.memory.values()];const people=db?await request(db.transaction('identities').objectStore('identities').getAll()):[...this.identities.values()];return {persistent:this.persistent,accounts:new Set([...rows.map(row=>row.owner),...people.map(person=>person.owner)]).size,stats:this.statistics(rows,people)};}
    async clear(owner) {await this.queue;const db=await this.db();if(!db){for(const [key,row]of this.memory)if(!owner || row.owner===owner)this.memory.delete(key);if(owner)this.identities.delete(owner);else this.identities.clear();return;}
      const tx=db.transaction(['rooms','identities'],'readwrite'),completion=done(tx);if(!owner){tx.objectStore('rooms').clear();tx.objectStore('identities').clear();}else{const rows=await request(tx.objectStore('rooms').getAll());for(const row of rows)if(row.owner===owner)tx.objectStore('rooms').delete([owner,row.roomId]);tx.objectStore('identities').delete(owner);}await completion;}
  }
  globalThis.RCSMessageStore=Object.freeze({Store,compact,reduce,ownerOK});
})();
