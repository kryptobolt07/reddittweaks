/* Extension-owned message storage (v2). O(batch) writes, verified coverage spans, and in-memory column search projection. */
(() => {
  const ownerOK=value=>typeof value==='string' && /^@[^:\s]{1,200}:[^\s]{1,200}$/.test(value);
  const str=(value,max=1000)=>typeof value==='string'?value.slice(0,max):'';
  const serverRecord=record=>!record.id.startsWith('~') && !record.bodyEvent?.startsWith('~');
  const HANDLED_TYPES=new Set(['m.room.message','m.sticker','m.room.redaction']);
  const KNOWN_IGNORED_TYPES=new Set([
    'm.room.create','m.room.member','m.room.join_rules','m.room.power_levels','m.room.history_visibility',
    'm.room.name','m.room.topic','m.room.avatar','m.room.canonical_alias','m.room.tombstone','m.room.pinned_events',
    'm.room.encryption','m.room.guest_access','m.room.server_acl','m.room.third_party_invite',
    'm.reaction','m.receipt','m.typing','m.fully_read','m.call.invite','m.call.answer','m.call.hangup','m.call.candidates',
    'com.reddit.chat.type','com.reddit.chat.settings','com.reddit.chat.pinned','com.reddit.chat.read_receipt','com.reddit.room.settings'
  ]);
  const LINK_RE=/\b(?:https?:\/\/|www\.)\S+/i;
  const MEDIA_TYPES=['image','gif','video','audio','file','link'];
  const MEDIA_BITS={image:1,gif:2,link:4,video:8,audio:16,file:32};
  const emptyMediaCounts=()=>({image:0,gif:0,video:0,audio:0,file:0,link:0});

  function previewURL(value){
    if(typeof value!=='string' || !value || value.length>2000)return '';
    try{const url=new URL(value);if(url.protocol!=='https:' || url.username || url.password || url.hash)return '';
      for(const key of url.searchParams.keys())if(/token|auth|signature|credential|password|(?:^|[_-])key(?:$|[_-])/i.test(key))return '';
      return url.href;
    }catch{return '';}
  }
  function parseSeq(seqId){
    if(typeof seqId==='number')return Number.isSafeInteger(seqId) && seqId>=0?{p:'',s:seqId}:null;
    if(typeof seqId!=='string' || !seqId || seqId.length>200)return null;
    const parts=seqId.split('.'),end=parts.at(-1);
    const num=Number(end?.replace(/^[a-z]/i,''));
    if(!end || !Number.isSafeInteger(num) || num<0)return null;
    const p=parts.length>=3?parts.slice(1,-1).join('.'):'';
    return {p,s:num};
  }
  function stripFormattedBody(html){
    if(typeof html!=='string' || !html)return '';
    return html.slice(0,65536).replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g,' ').trim();
  }
  function computeMediaFlags(body,attachmentType,attachmentMime){
    let f=0;
    if(attachmentType==='image' || attachmentType==='video' || attachmentType==='audio' || attachmentType==='file')f|=MEDIA_BITS[attachmentType];
    if(attachmentType==='image' && attachmentMime==='image/gif')f|=MEDIA_BITS.gif;
    if(body && LINK_RE.test(body))f|=MEDIA_BITS.link;
    return f;
  }
  function isUnknownEvent(raw){
    return Boolean(raw && typeof raw.event_id==='string' && raw.event_id && !raw.event_id.startsWith('~') && typeof raw.type==='string' && raw.type && raw.state_key===undefined && !HANDLED_TYPES.has(raw.type) && !KNOWN_IGNORED_TYPES.has(raw.type));
  }
  function compact(raw,roomId) {
    if(!raw || !HANDLED_TYPES.has(raw.type))return null;
    const id=str(raw.event_id),room=str(raw.room_id || roomId);if(!id || id.startsWith('~') || !room)return null;
    const content=raw.content || {},relation=content['m.relates_to'] || {},bodyContent=content['m.new_content'] || content;
    const attachmentType=raw.type==='m.sticker'?'image':({'m.image':'image','m.video':'video','m.audio':'audio','m.file':'file'}[bodyContent.msgtype] || '');
    // Only native type/MIME metadata classifies attachments; never guess from
    // filenames. Retain one credential-free image preview reference, not bytes.
    const attachmentMime=attachmentType?str(bodyContent.info?.mimetype,200).trim().toLowerCase().split(';')[0]:'';
    const candidate=attachmentType==='image'?[[bodyContent.rcs_preview_url,bodyContent.info],[bodyContent.url,bodyContent.info],[bodyContent.info?.thumbnail_url,bodyContent.info?.thumbnail_info]].map(([url,info])=>({url:previewURL(url),info})).find(item=>item.url):null;
    const attachmentPreview=candidate?.url || '',info=candidate?candidate.info:bodyContent.info;
    const w=info?.w ?? info?.width,h=info?.h ?? info?.height;
    const dimensions=attachmentType==='image' && Number.isFinite(w) && Number.isFinite(h) && w>=1 && h>=1 && w<=100000 && h<=100000?{attachmentWidth:Math.round(w),attachmentHeight:Math.round(h)}:{};
    const rawBody=str(bodyContent.body,65536) || stripFormattedBody(bodyContent.formatted_body);
    const body=rawBody || (raw.type==='m.sticker'?'Sticker':({image:'Image',video:'Video',audio:'Audio',file:'File'}[attachmentType] || ''));
    const parsedSeq=parseSeq(raw.seq_id);
    const threadMeta=raw.unsigned?.['m.relations']?.['m.thread'];
    const threadCount=threadMeta?.count;
    const threadLatestTs=Number.isFinite(threadMeta?.latest_event?.origin_server_ts) && threadMeta.latest_event.origin_server_ts>0?threadMeta.latest_event.origin_server_ts:0;
    const seqRaw=typeof raw.seq_id==='string'?str(raw.seq_id,200):typeof raw.seq_id==='number' && Number.isSafeInteger(raw.seq_id)?String(raw.seq_id):'';
    return {id,room,type:raw.type,sender:str(raw.sender),time:Number.isFinite(raw.origin_server_ts)?raw.origin_server_ts:0,
      body,attachmentType,attachmentMime,...(attachmentPreview?{attachmentPreview}:{}),...dimensions,
      replaces:relation.rel_type==='m.replace'?str(relation.event_id):'',thread:relation.rel_type==='m.thread',
      threadRoot:relation.rel_type==='m.thread'?str(relation.event_id):'',
      redacts:str(raw.redacts || content.redacts),redacted:Boolean(raw.unsigned?.redacted_because),
      ...(parsedSeq?{seq:parsedSeq.s,seqScope:parsedSeq.p}:{}),...(seqRaw?{seqRaw}:{}),
      ...(Number.isInteger(threadCount) && threadCount>0?{threadCount,...(threadLatestTs?{threadLatestTs}:{})}:{})};
  }
  let encoder;
  const bytes=value=>{const text=JSON.stringify(value);if(typeof TextEncoder==='function')return (encoder ||= new TextEncoder()).encode(text).length;return text.length;};
  const order=(a,b)=>(a.time-b.time) || a.id.localeCompare(b.id);
  const relOrder=(a,b)=>(a.t-b.t) || a.e.localeCompare(b.e);
  const foldFast=value=>{const text=String(value ?? '');return /[^\x00-\x7f]/.test(text)?(globalThis.RCSCore?.foldedValue?RCSCore.foldedValue(text):text.normalize('NFKC').toLocaleLowerCase()):text.toLowerCase();};

  // Kept for backward compatibility and v1 differential verification.
  function reduce(row,events,coverage) {
    const ledger=new Map((row.events || []).map(event=>[event.id,event]));
    for(const event of events) {
      const before=ledger.get(event.id);if(!before){ledger.set(event.id,event);continue;}
      const sourceChanged=Boolean(event.attachmentPreview && before.attachmentPreview!==event.attachmentPreview);
      const merged={...before,body:before.body || event.body,attachmentType:before.attachmentType || event.attachmentType || '',attachmentMime:before.attachmentMime || event.attachmentMime || '',...(event.attachmentPreview || before.attachmentPreview?{attachmentPreview:event.attachmentPreview || before.attachmentPreview}:{}),redacts:before.redacts || event.redacts,redacted:before.redacted || event.redacted};
      if(sourceChanged){delete merged.attachmentWidth;delete merged.attachmentHeight;delete merged.attachmentDimensionsSource;}
      if(event.attachmentWidth && event.attachmentHeight && (sourceChanged || before.attachmentDimensionsSource!=='decoded')){merged.attachmentWidth=event.attachmentWidth;merged.attachmentHeight=event.attachmentHeight;delete merged.attachmentDimensionsSource;}
      ledger.set(event.id,merged);
    }
    const removed=new Set([...ledger.values()].filter(event=>event.redacted).map(event=>event.id));
    for(const event of ledger.values())if(event.redacts)removed.add(event.redacts);
    for(const event of ledger.values())if(removed.has(event.id) || event.replaces && removed.has(event.replaces)){event.body='';event.attachmentType='';event.attachmentMime='';event.attachmentPreview='';delete event.attachmentWidth;delete event.attachmentHeight;delete event.attachmentDimensionsSource;event.redacted=true;}
    const edits=new Map();
    for(const event of ledger.values())if(event.replaces && !removed.has(event.id)) {
      const original=ledger.get(event.replaces);if(!original || original.sender!==event.sender)continue;
      const previous=edits.get(event.replaces);if(!previous || order(previous,event)<0)edits.set(event.replaces,event);
    }
    row.events=[...ledger.values()];
    row.records=row.events.filter(event=>!event.id.startsWith('~') && event.type!=='m.room.redaction' && !event.replaces && !removed.has(event.id) && (edits.get(event.id)?.body || event.body)).map(event=>({id:event.id,bodyEvent:edits.get(event.id)?.id || event.id,sender:event.sender,time:event.time,thread:event.thread,threadRoot:event.threadRoot})).filter(serverRecord);
    row.coverage=coverage ? {complete:coverage.complete===true,dateComplete:coverage.dateComplete===true,dates:{from:str(coverage.dates?.from,10),to:str(coverage.dates?.to,10)}} : {complete:false,dateComplete:false};
    delete row.approxBytes;row.approxBytes=bytes(row);return row;
  }

  function meaningfulName(value) {
    const name=str(value).trim(),normalized=name.normalize('NFKC').toLocaleLowerCase();
    return !name || name.startsWith('@') || ['[deleted]','[removed]','someone','unknown sender','username unavailable','deleted user','message'].includes(normalized)?'':name;
  }
  function identity(person) {
    if(!ownerOK(person?.id))return null;
    const aliases=Array.isArray(person.aliases)?[...new Set(person.aliases.map(meaningfulName).filter(Boolean))].slice(0,20):[];
    return {id:person.id,name:meaningfulName(person.name),avatar:/^https:\/\//.test(person.avatar || '')?str(person.avatar,2000):'',self:Boolean(person.self),historical:Boolean(person.historical ?? person.historicalName),unavailable:Boolean(person.unavailable ?? person.accountUnavailable),availabilityKnown:Boolean(person.availabilityKnown || person.unavailable || person.accountUnavailable),...(aliases.length?{aliases}:{})};
  }
  function mergeIdentity(before,after) {
    const previous=identity(before) || {},incoming=identity(after);if(!incoming)return previous;
    const name=incoming.name || previous.name || '',unavailable=incoming.availabilityKnown?incoming.unavailable:Boolean(previous.unavailable);
    const aliasSet=new Set([...(previous.aliases || []),...(incoming.aliases || [])]);
    if(previous.name && previous.name!==name)aliasSet.add(previous.name);
    if(incoming.name && incoming.name!==name)aliasSet.add(incoming.name);
    const aliases=[...aliasSet].filter(Boolean).slice(0,20);
    return {...previous,...incoming,name,avatar:incoming.avatar || previous.avatar || '',availabilityKnown:incoming.availabilityKnown || Boolean(previous.availabilityKnown),unavailable,
      historical:incoming.availabilityKnown && !unavailable?incoming.historical:Boolean(incoming.historical || previous.historical || unavailable && name),
      ...(aliases.length?{aliases}:{})};
  }

  const request=task=>new Promise((resolve,reject)=>{task.onsuccess=()=>resolve(task.result);task.onerror=()=>reject(task.error || Error('Message storage failed'));});
  const done=tx=>new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=tx.onerror=()=>reject(tx.error || Error('Message storage failed'));});

  function mergeSpanList(existing,incoming){
    const overlapping=[],kept=[];
    for(const sp of existing){
      if(sp.lo<=incoming.hi+1 && incoming.lo<=sp.hi+1)overlapping.push(sp);
      else kept.push(sp);
    }
    let lo=incoming.lo,hi=incoming.hi,tLo=incoming.tLo>0?incoming.tLo:Infinity,tHi=incoming.tHi || 0,bottom=Boolean(incoming.bottom),at=incoming.at || Date.now();
    for(const sp of overlapping){
      if(sp.lo<lo)lo=sp.lo;
      if(sp.hi>hi)hi=sp.hi;
      if(sp.tLo>0 && sp.tLo<tLo)tLo=sp.tLo;
      if(sp.tHi>tHi)tHi=sp.tHi;
      if(sp.bottom)bottom=true;
      if(sp.at>at)at=sp.at;
    }
    const merged={a:incoming.a,n:incoming.n,p:incoming.p,hi,lo,tHi,tLo:Number.isFinite(tLo)?tLo:0,bottom,at,src:incoming.src || overlapping[0]?.src || ''};
    return {merged,removed:overlapping,all:[...kept,merged].sort((x,y)=>x.hi-y.hi)};
  }

  function roomCompleteFromSpans(room,spansByScope){
    if(room.unknownCount>0 || room.inaccessible)return false;
    const main=spansByScope.get('') || [];
    const top=main.length?main.reduce((best,sp)=>!best || sp.hi>best.hi?sp:best,null):null;
    if(!top || !top.bottom)return false;
    if(room.headSeen?.s!=null && top.hi<room.headSeen.s)return false;
    for(const [p,info] of Object.entries(room.threads || {})){
      const tspans=spansByScope.get(p) || [];
      const ttop=tspans.length?tspans.reduce((best,sp)=>!best || sp.hi>best.hi?sp:best,null):null;
      if(!ttop || !ttop.bottom || info.dirty)return false;
    }
    return true;
  }

  function makeLatestFromMsg(msg){
    if(!msg || !msg.b)return null;
    return {e:msg.e,t:msg.t || 0,...(msg.s!=null?{s:msg.s}:{}),u:msg.u || '',b:msg.b.slice(0,200),f:msg.f || 0,
      ...(msg.m?{m:msg.m}:{}),...(msg.v?{v:msg.v}:{}),...(msg.w && msg.h?{w:msg.w,h:msg.h}:{})};
  }
  function isNewerLatest(candidate,current){
    if(!candidate)return false;
    if(!current)return true;
    return (candidate.t-current.t) || candidate.e.localeCompare(current.e)>0;
  }
  function attachTypeFromFlags(f){
    if(f & MEDIA_BITS.image)return 'image';
    if(f & MEDIA_BITS.video)return 'video';
    if(f & MEDIA_BITS.audio)return 'audio';
    if(f & MEDIA_BITS.file)return 'file';
    return '';
  }

  // Column projection held in worker memory per active account for O(N) tight-loop scans.
  class AccountProjection {
    constructor(a){
      this.a=a;this.count=0;this.liveCount=0;this.capacity=256;
      this.t=new Float64Array(this.capacity);
      this.room=new Uint32Array(this.capacity);
      this.senderIdx=new Uint32Array(this.capacity);
      this.flags=new Uint8Array(this.capacity);
      this.folded=[];this.ids=[];
      this.keyToPos=new Map();
      this.roomIdByOrd=new Map();this.roomOrdById=new Map();
      this.roomMeta=new Map(); // n -> room record
      this.people=new Map();   // id -> person record
      this.senderIdByIdx=[];this.senderIdxById=new Map();
      this.sortedDesc=true;
      this.lastT=Infinity;
    }
    ensureCapacity(needed){
      if(needed<=this.capacity)return;
      let next=this.capacity;while(next<needed)next*=2;
      const t=new Float64Array(next);t.set(this.t);this.t=t;
      const room=new Uint32Array(next);room.set(this.room);this.room=room;
      const senderIdx=new Uint32Array(next);senderIdx.set(this.senderIdx);this.senderIdx=senderIdx;
      const flags=new Uint8Array(next);flags.set(this.flags);this.flags=flags;
      this.capacity=next;
    }
    internSender(senderId){
      let idx=this.senderIdxById.get(senderId);
      if(idx===undefined){idx=this.senderIdByIdx.length;this.senderIdByIdx.push(senderId);this.senderIdxById.set(senderId,idx);}
      return idx;
    }
    registerRoom(room){
      this.roomIdByOrd.set(room.n,room.roomId);
      this.roomOrdById.set(room.roomId,room.n);
      this.roomMeta.set(room.n,room);
    }
    upsert(msg){
      const key=msg.n+'\0'+msg.e;
      const pos=this.keyToPos.get(key);
      if(!msg.b){
        if(pos!==undefined)this.remove(msg.n,msg.e);
        return;
      }
      const sIdx=this.internSender(msg.u || '');
      const folded=foldFast(msg.b);
      if(pos!==undefined){
        if(this.t[pos]!==(msg.t || 0))this.sortedDesc=false;
        this.t[pos]=msg.t || 0;
        this.room[pos]=msg.n;
        this.senderIdx[pos]=sIdx;
        this.flags[pos]=msg.f || 0;
        this.folded[pos]=folded;
        return;
      }
      const idx=this.count++;
      this.ensureCapacity(this.count);
      const time=msg.t || 0;
      if(idx>0 && time>this.lastT)this.sortedDesc=false;
      this.lastT=time;
      this.t[idx]=time;
      this.room[idx]=msg.n;
      this.senderIdx[idx]=sIdx;
      this.flags[idx]=msg.f || 0;
      this.folded[idx]=folded;
      this.ids[idx]=msg.e;
      this.keyToPos.set(key,idx);
      this.liveCount++;
    }
    remove(n,e){
      const key=n+'\0'+e;
      const pos=this.keyToPos.get(key);
      if(pos===undefined)return;
      this.keyToPos.delete(key);
      this.ids[pos]='';
      this.folded[pos]='';
      this.flags[pos]=0;
      this.liveCount--;
    }
  }

  // Binary search bounds on descending Float64Array t[0..count): returns [lo, hi) where t[i] in [start, end).
  function descendingTimeBounds(t,count,start,end){
    let lo=0,hi=count;
    // First index where t[i] < end (since t is descending, larger values are earlier).
    if(Number.isFinite(end)){
      let l=0,r=count;
      while(l<r){const m=(l+r)>>>1;if(t[m]>=end)l=m+1;else r=m;}
      lo=l;
    }
    // First index where t[i] < start.
    if(Number.isFinite(start)){
      let l=lo,r=count;
      while(l<r){const m=(l+r)>>>1;if(t[m]>=start)l=m+1;else r=m;}
      hi=l;
    }
    return [lo,hi];
  }

  // Lightweight read-only + dual-write helper for legacy rcs-messages-v1 during migration.
  class LegacyV1Bridge {
    constructor(idb,name){this.idb=idb;this.name=name;this.dbPromise=null;this.checked=false;this.exists=false;}
    async probe(){
      if(this.checked)return this.exists;
      this.checked=true;
      if(!this.idb || !this.name)return false;
      try{
        const db=await new Promise((resolve,reject)=>{
          const open=this.idb.open(this.name,1);let created=false;
          open.onupgradeneeded=e=>{if(e.oldVersion===0){created=true;try{open.transaction.abort();}catch{}}};
          open.onsuccess=()=>{if(created){open.result.close();resolve(null);}else resolve(open.result);};
          open.onerror=()=>resolve(null);
          open.onblocked=()=>resolve(null);
        });
        if(db){
          this.exists=db.objectStoreNames.contains('rooms') && db.objectStoreNames.contains('identities');
          if(this.exists)this.dbPromise=Promise.resolve(db);
          else db.close();
        }
      }catch{this.exists=false;}
      return this.exists;
    }
    async db(){
      if(!await this.probe())return null;
      if(!this.dbPromise){
        this.dbPromise=new Promise((resolve,reject)=>{
          const open=this.idb.open(this.name,1);
          open.onsuccess=()=>resolve(open.result);
          open.onerror=()=>reject(open.error);
          open.onblocked=()=>reject(Error('Legacy database blocked'));
        });
      }
      return this.dbPromise;
    }
    async closeAndDelete(){
      try{const db=this.dbPromise?await this.dbPromise.catch(()=>null):null;db?.close();}catch{}
      this.dbPromise=null;this.exists=false;this.checked=true;
      if(this.idb?.deleteDatabase && this.name){
        await new Promise(resolve=>{const req=this.idb.deleteDatabase(this.name);req.onsuccess=req.onerror=req.onblocked=()=>resolve();});
      }
    }
    async owners(){
      const db=await this.db();if(!db)return [];
      const tx=db.transaction(['rooms','identities'],'readonly');
      const [roomKeys,idKeys]=await Promise.all([request(tx.objectStore('rooms').getAllKeys()),request(tx.objectStore('identities').getAllKeys())]);
      const set=new Set();
      for(const k of roomKeys)if(Array.isArray(k) && ownerOK(k[0]))set.add(k[0]);
      for(const k of idKeys)if(ownerOK(k))set.add(k);
      return [...set];
    }
    async readRoomBatch(owner,afterRoomId,limit=25){
      const db=await this.db();if(!db)return {rows:[],done:true};
      const tx=db.transaction('rooms','readonly');
      const range=afterRoomId?IDBKeyRange.bound([owner,afterRoomId],[owner,'\uffff'],true,false):IDBKeyRange.bound([owner,''],[owner,'\uffff']);
      const rows=[];
      await new Promise((resolve,reject)=>{
        const req=tx.objectStore('rooms').openCursor(range);
        req.onsuccess=()=>{
          const cursor=req.result;
          if(!cursor || rows.length>=limit){resolve();return;}
          rows.push(cursor.value);
          cursor.continue();
        };
        req.onerror=()=>reject(req.error);
      });
      return {rows,done:rows.length<limit};
    }
    async readIdentities(owner){
      const db=await this.db();if(!db)return null;
      const tx=db.transaction('identities','readonly');
      return request(tx.objectStore('identities').get(owner));
    }
    async clearOwner(owner){
      const db=await this.db();if(!db)return;
      const tx=db.transaction(['rooms','identities'],'readwrite');const completion=done(tx);
      if(!owner){tx.objectStore('rooms').clear();tx.objectStore('identities').clear();}
      else{
        const keys=await request(tx.objectStore('rooms').getAllKeys(IDBKeyRange.bound([owner,''],[owner,'\uffff'])));
        for(const k of keys)tx.objectStore('rooms').delete(k);
        tx.objectStore('identities').delete(owner);
      }
      await completion;
    }
    async dualWriteIngest(batch){
      const db=await this.db();if(!db)return;
      const grouped=new Map();
      for(const raw of batch.events || []){const ev=compact(raw,batch.roomId);if(ev){if(!grouped.has(ev.room))grouped.set(ev.room,[]);grouped.get(ev.room).push(ev);}}
      if(batch.roomId && !grouped.has(batch.roomId))grouped.set(str(batch.roomId),[]);
      const tx=db.transaction(['rooms','identities'],'readwrite'),completion=done(tx);
      try{
        const prevId=await request(tx.objectStore('identities').get(batch.owner));
        const people={...prevId?.people};let idChanged=false;
        for(const raw of batch.identities || []){const p=identity(raw);if(p){const merged=mergeIdentity(people[p.id],p);if(JSON.stringify(people[p.id])!==JSON.stringify(merged)){people[p.id]=merged;idChanged=true;}}}
        if(idChanged){const saved={...prevId,owner:batch.owner,people};delete saved.approxBytes;saved.approxBytes=bytes(saved);tx.objectStore('identities').put(saved);}
        for(const [roomId,events] of grouped){
          const before=await request(tx.objectStore('rooms').get([batch.owner,roomId]));
          const coverage=roomId===batch.roomId?batch.coverage:undefined;
          const row=reduce(before || {owner:batch.owner,roomId,events:[]},events,coverage);
          tx.objectStore('rooms').put(row);
        }
        await completion;
      }catch{try{tx.abort();}catch{}}
    }
    async searchV1(owner,params,directory){
      const db=await this.db();if(!db)return null;
      const tx=db.transaction(['rooms','identities'],'readonly');
      const [found,identities]=await Promise.all([
        request(params.roomId?tx.objectStore('rooms').get([owner,params.roomId]):tx.objectStore('rooms').getAll(IDBKeyRange.bound([owner,''],[owner,'\uffff']))),
        request(tx.objectStore('identities').get(owner))
      ]);
      const rows=(params.roomId?(found?[found]:[]):found).map(row=>row.records.some(r=>!serverRecord(r))?{...row,records:row.records.filter(serverRecord)}:row);
      const people=identities?.people || {};
      const parsed=RCSCore.parseQuery(params.query || ''),match=RCSCore.prepareQuery(parsed,{from:params.from || 'all',wholeWord:Boolean(params.wholeWord),dates:params.dates || {},ignoreMedia:true}),finalMatch=RCSCore.prepareQuery(parsed,{from:params.from || 'all',wholeWord:Boolean(params.wholeWord),dates:params.dates || {}});
      const mediaEntries=Object.entries(RCSCore.mediaKinds),mediaCounts=Object.fromEntries(mediaEntries.map(([t])=>[t,0])),records=[],times=new Map(),idCache=new Map(),allowed=params.roomIds?new Set(params.roomIds):null,mediaTypes=new Set();
      for(const row of rows){
        const ledger=new Map(row.events.map(e=>[e.id,e])),included=(!params.roomId || row.roomId===params.roomId) && (!allowed || allowed.has(row.roomId));
        for(const rec of row.records){
          const be=ledger.get(rec.bodyEvent);
          if(be?.body){if(be.attachmentType)mediaTypes.add(be.attachmentType);if(be.attachmentType==='image' && be.attachmentMime==='image/gif')mediaTypes.add('gif');if(LINK_RE.test(be.body))mediaTypes.add('link');}
          if(!included)continue;
          let person=idCache.get(rec.sender);
          if(!person){person=mergeIdentity(people[rec.sender] || {},{...(directory?.identities?.[rec.sender] || {}),id:rec.sender});idCache.set(rec.sender,person);}
          const self=rec.sender===owner;
          const msg={id:rec.id,roomId:row.roomId,text:be?.body || '',sender:rec.sender,timestamp:rec.time || NaN,attachmentType:be?.attachmentType || '',attachmentMime:be?.attachmentMime || '',attachmentPreview:be?.attachmentPreview || '',...(be?.attachmentWidth?{attachmentWidth:be.attachmentWidth,attachmentHeight:be.attachmentHeight}:{}),author:self?'You':person.name || rec.sender,authorSelf:self,authorHistorical:Boolean(person.historical),authorUnavailable:Boolean(person.unavailable),avatar:person.avatar || '',thread:rec.thread,threadRoot:rec.threadRoot,...(person.aliases?.length?{authorAliases:person.aliases}:{})};
          if(msg.text && match(msg)){
            const fl=RCSCore.mediaFlags(msg);for(const [type,flag] of mediaEntries)if(fl & flag)mediaCounts[type]++;
            if(finalMatch(msg)){times.set(msg,rec.time || 0);records.push(msg);}
          }
        }
      }
      const sort=params.sort || 'newest',limit=params.limit ?? 200,offset=params.offset ?? 0;
      const scores=sort==='relevant'?new Map(records.map(r=>[r,RCSCore.relevanceScore(r.text,parsed,{wholeWord:Boolean(params.wholeWord)})])):null;
      records.sort((a,b)=>(scores?scores.get(b)-scores.get(a):0) || (sort==='oldest'?1:-1)*(times.get(a)-times.get(b)) || a.roomId.localeCompare(b.roomId) || a.id.localeCompare(b.id));
      const counts=new Map();for(const r of records)counts.set(r.roomId,(counts.get(r.roomId) || 0)+1);
      const page=records.slice(offset,offset+limit);
      for(const r of page)r.timestamp=Number.isFinite(r.timestamp)?new Date(r.timestamp).toISOString():'';
      return {owner,selfIdentity:identity(people[owner]),persistent:true,migrating:true,records:page,total:records.length,hasMore:offset+limit<records.length,matchedRooms:counts.size,mediaCounts,availableMediaTypes:MEDIA_TYPES.filter(t=>mediaTypes.has(t)),stats:{messages:rows.reduce((s,r)=>s+r.records.length,0),rooms:rows.length,completeRooms:rows.filter(r=>r.coverage?.complete).length,approxBytes:rows.reduce((s,r)=>s+(r.approxBytes || 0),0)+(identities?.approxBytes || 0)},coverage:{complete:false,dateComplete:false,unknownRooms:false,threadsVerified:false}};
    }
  }

  class Store {
    constructor({indexedDB=globalThis.indexedDB,name='rcs-chat-v2',legacyName,onStatsDelta=null}={}) {
      this.idb=indexedDB;this.name=name;this.persistent=Boolean(indexedDB);this.onStatsDelta=onStatsDelta;
      this.legacyName=legacyName!==undefined?legacyName:(name==='rcs-chat-v2'?'rcs-messages-v1':null);
      this.legacy=this.persistent && this.legacyName?new LegacyV1Bridge(indexedDB,this.legacyName):null;
      this.writeEpoch=0;
      this.database=null;this.connection=null;this.queue=Promise.resolve();
      this.projections=new Map(); // owner -> AccountProjection
      this.migrationTasks=new Map(); // owner -> Promise
      // In-memory store mirror when persistent === false.
      this.mem={accounts:new Map(),rooms:new Map(),roomsById:new Map(),msgs:new Map(),rels:new Map(),relsByTarget:new Map(),spans:new Map(),people:new Map(),meta:new Map()};
    }
    forgetConnection(db) {if(this.connection===db){this.connection=null;this.database=null;}}
    async db() {
      if(!this.persistent)return null;
      if(!this.database)this.database=new Promise((resolve,reject)=>{
        const open=this.idb.open(this.name,1);let blocked=false;
        open.onupgradeneeded=()=>{
          const db=open.result;
          const accounts=db.createObjectStore('accounts',{keyPath:'owner'});
          accounts.createIndex('a','a',{unique:true});
          const rooms=db.createObjectStore('rooms',{keyPath:['a','n']});
          rooms.createIndex('id',['a','roomId'],{unique:true});
          const msgs=db.createObjectStore('msgs',{keyPath:['a','n','e']});
          msgs.createIndex('time',['a','t'],{unique:false});
          msgs.createIndex('order',['a','n','p','s'],{unique:false});
          const rels=db.createObjectStore('rels',{keyPath:['a','n','e']});
          rels.createIndex('target',['a','n','target'],{unique:false});
          db.createObjectStore('spans',{keyPath:['a','n','p','hi']});
          db.createObjectStore('people',{keyPath:['a','id']});
          db.createObjectStore('meta',{keyPath:'key'});
        };
        open.onsuccess=()=>{const db=open.result;if(blocked){db.close();return;}this.connection=db;db.onclose=()=>this.forgetConnection(db);db.onversionchange=()=>{this.forgetConnection(db);db.close();};resolve(db);};
        open.onerror=()=>reject(open.error);open.onblocked=()=>{blocked=true;reject(Error('Message database blocked'));};
      });
      const opening=this.database;try{return await opening;}catch(error){if(this.database===opening)this.database=null;throw error;}
    }
    async transaction(names,mode='readonly') {
      for(let attempt=0;attempt<2;attempt++){
        const db=await this.db();if(!db)return null;
        try{return db.transaction(names,mode);}catch(error){
          if(error?.name!=='InvalidStateError')throw error;
          this.forgetConnection(db);try{db.close();}catch{}
          if(attempt)throw error;
        }
      }
    }

    // --- Low-level store adapters (uniform across IDB and memory fallback) ---
    async _getAccount(tx,owner){return tx?request(tx.objectStore('accounts').get(owner)):this.mem.accounts.get(owner);}
    async _ensureAccount(tx,owner){
      let acc=await this._getAccount(tx,owner);
      if(acc)return acc;
      const meta=tx?await request(tx.objectStore('meta').get('nextAccount')):this.mem.meta.get('nextAccount');
      const a=(meta?.value || 0)+1;
      const nextMeta={key:'nextAccount',value:a};
      if(tx)tx.objectStore('meta').put(nextMeta);else this.mem.meta.set('nextAccount',nextMeta);
      acc={owner,a,nextRoom:1,nativeImportComplete:false,nativeReconciledAt:0,migration:{state:'done',cursor:''},stats:{messages:0,rooms:0,completeRooms:0,bytes:0,unknownEvents:0},mediaTypeCounts:emptyMediaCounts()};
      if(tx)tx.objectStore('accounts').put(acc);else this.mem.accounts.set(owner,acc);
      return acc;
    }
    _putAccount(tx,acc){if(tx)tx.objectStore('accounts').put(acc);else this.mem.accounts.set(acc.owner,acc);}
    async _getRoomById(tx,a,roomId){
      if(tx)return request(tx.objectStore('rooms').index('id').get([a,roomId]));
      const n=this.mem.roomsById.get(a+'\0'+roomId);
      return n!==undefined?this.mem.rooms.get(a+'\0'+n):undefined;
    }
    async _getAllRooms(tx,a){
      if(tx)return request(tx.objectStore('rooms').getAll(IDBKeyRange.bound([a,0],[a,Number.MAX_SAFE_INTEGER])));
      const out=[];for(const r of this.mem.rooms.values())if(r.a===a)out.push(r);return out;
    }
    _putRoom(tx,room){
      if(tx)tx.objectStore('rooms').put(room);
      else{this.mem.rooms.set(room.a+'\0'+room.n,room);this.mem.roomsById.set(room.a+'\0'+room.roomId,room.n);}
    }
    async _getMsg(tx,a,n,e){return tx?request(tx.objectStore('msgs').get([a,n,e])):this.mem.msgs.get(a+'\0'+n+'\0'+e);}
    _putMsg(tx,msg){if(tx)tx.objectStore('msgs').put(msg);else this.mem.msgs.set(msg.a+'\0'+msg.n+'\0'+msg.e,msg);}
    _deleteMsg(tx,a,n,e){if(tx)tx.objectStore('msgs').delete([a,n,e]);else this.mem.msgs.delete(a+'\0'+n+'\0'+e);}
    async _getRoomMsgs(tx,a,n){
      if(tx)return request(tx.objectStore('msgs').getAll(IDBKeyRange.bound([a,n,''],[a,n,'\uffff'])));
      const out=[];for(const m of this.mem.msgs.values())if(m.a===a && m.n===n)out.push(m);return out;
    }
    async _getRel(tx,a,n,e){return tx?request(tx.objectStore('rels').get([a,n,e])):this.mem.rels.get(a+'\0'+n+'\0'+e);}
    async _getRelsByTarget(tx,a,n,target){
      if(tx)return request(tx.objectStore('rels').index('target').getAll([a,n,target]));
      const set=this.mem.relsByTarget.get(a+'\0'+n+'\0'+target);
      return set?[...set].map(e=>this.mem.rels.get(a+'\0'+n+'\0'+e)).filter(Boolean):[];
    }
    async _getRoomRels(tx,a,n){
      if(tx)return request(tx.objectStore('rels').getAll(IDBKeyRange.bound([a,n,''],[a,n,'\uffff'])));
      const out=[];for(const r of this.mem.rels.values())if(r.a===a && r.n===n)out.push(r);return out;
    }
    _putRel(tx,rel){
      if(tx)tx.objectStore('rels').put(rel);
      else{
        this.mem.rels.set(rel.a+'\0'+rel.n+'\0'+rel.e,rel);
        const tk=rel.a+'\0'+rel.n+'\0'+rel.target;
        let set=this.mem.relsByTarget.get(tk);if(!set){set=new Set();this.mem.relsByTarget.set(tk,set);}
        set.add(rel.e);
      }
    }
    async _getSpans(tx,a,n,p){
      if(tx){
        const range=p!==undefined?IDBKeyRange.bound([a,n,p,0],[a,n,p,Number.MAX_SAFE_INTEGER]):IDBKeyRange.bound([a,n,'',0],[a,n,'\uffff',Number.MAX_SAFE_INTEGER]);
        return request(tx.objectStore('spans').getAll(range));
      }
      const out=[];for(const sp of this.mem.spans.values())if(sp.a===a && sp.n===n && (p===undefined || sp.p===p))out.push(sp);return out;
    }
    _putSpan(tx,sp){if(tx)tx.objectStore('spans').put(sp);else this.mem.spans.set(sp.a+'\0'+sp.n+'\0'+sp.p+'\0'+sp.hi,sp);}
    _deleteSpan(tx,a,n,p,hi){if(tx)tx.objectStore('spans').delete([a,n,p,hi]);else this.mem.spans.delete(a+'\0'+n+'\0'+p+'\0'+hi);}
    async _getPerson(tx,a,id){return tx?request(tx.objectStore('people').get([a,id])):this.mem.people.get(a+'\0'+id);}
    async _getAllPeople(tx,a){
      if(tx)return request(tx.objectStore('people').getAll(IDBKeyRange.bound([a,''],[a,'\uffff'])));
      const out=[];for(const p of this.mem.people.values())if(p.a===a)out.push(p);return out;
    }
    _putPerson(tx,person){if(tx)tx.objectStore('people').put(person);else this.mem.people.set(person.a+'\0'+person.id,person);}

    _adjustMediaTypeCounts(acc,flags,delta){
      if(!flags)return;
      acc.mediaTypeCounts ||= emptyMediaCounts();
      if(flags & MEDIA_BITS.image)acc.mediaTypeCounts.image=Math.max(0,(acc.mediaTypeCounts.image || 0)+delta);
      if(flags & MEDIA_BITS.gif)acc.mediaTypeCounts.gif=Math.max(0,(acc.mediaTypeCounts.gif || 0)+delta);
      if(flags & MEDIA_BITS.video)acc.mediaTypeCounts.video=Math.max(0,(acc.mediaTypeCounts.video || 0)+delta);
      if(flags & MEDIA_BITS.audio)acc.mediaTypeCounts.audio=Math.max(0,(acc.mediaTypeCounts.audio || 0)+delta);
      if(flags & MEDIA_BITS.file)acc.mediaTypeCounts.file=Math.max(0,(acc.mediaTypeCounts.file || 0)+delta);
      if(flags & MEDIA_BITS.link)acc.mediaTypeCounts.link=Math.max(0,(acc.mediaTypeCounts.link || 0)+delta);
    }

    // --- Public Write Path: O(batch) per transaction ---
    ingest(batch) {const result=this.queue.then(()=>this.write(batch));this.queue=result.catch(()=>{});return result;}
    async write(batch) {
      if(!ownerOK(batch?.owner))throw Error('Invalid account');
      if(!Array.isArray(batch.events) || batch.events.length>1000 || (batch.identities?.length || 0)>1000)throw Error('Invalid message batch');
      // Dual-write into legacy v1 if this owner is still mid-migration (skip for migration's own copy batches).
      if(!batch._internalMigration && this.legacy && await this.legacy.probe()){
        const accCheck=await this._readAccountQuick(batch.owner);
        if(!accCheck || accCheck.migration?.state!=='done')await this.legacy.dualWriteIngest(batch);
      }
      const grouped=new Map(),unknownByRoom=new Map();
      for(const raw of batch.events){
        const ev=compact(raw,batch.roomId);
        if(ev){if(!grouped.has(ev.room))grouped.set(ev.room,[]);grouped.get(ev.room).push(ev);}
        else if(isUnknownEvent(raw)){
          const rid=str(raw.room_id || batch.roomId);
          if(rid)unknownByRoom.set(rid,(unknownByRoom.get(rid) || 0)+1);
        }
      }
      for(const rid of unknownByRoom.keys())if(!grouped.has(rid))grouped.set(rid,[]);
      if(batch.roomId && !grouped.has(batch.roomId))grouped.set(str(batch.roomId),[]);

      this.writeEpoch++;
      const tx=await this.transaction(['accounts','rooms','msgs','rels','spans','people','meta'],'readwrite'),completion=tx?done(tx):null;
      const projUpdates=[];
      try {
        const acc=await this._ensureAccount(tx,batch.owner);
        const a=acc.a;
        let deltaMessages=0,deltaRooms=0,deltaCompleteRooms=0,deltaBytes=0,deltaUnknown=0,identitiesChanged=false;

        // 1. Prefetch people and rooms in parallel (Wave 1).
        const incomingPeople=[];
        const uniquePersonIds=[];
        const personIdSeen=new Set();
        for(const raw of batch.identities || []){
          const person=identity(raw);if(!person)continue;
          incomingPeople.push(person);
          if(!personIdSeen.has(person.id)){personIdSeen.add(person.id);uniquePersonIds.push(person.id);}
        }
        const roomEntries=[...grouped.entries()];
        const [prefetchedPeople,prefetchedRooms]=await Promise.all([
          Promise.all(uniquePersonIds.map(id=>this._getPerson(tx,a,id))),
          Promise.all(roomEntries.map(([roomId])=>this._getRoomById(tx,a,roomId)))
        ]);
        const seenPeople=new Map();
        for(let i=0;i<uniquePersonIds.length;i++)if(prefetchedPeople[i])seenPeople.set(uniquePersonIds[i],prefetchedPeople[i]);

        for(const person of incomingPeople){
          const prev=seenPeople.get(person.id);
          const merged=mergeIdentity(prev,person);
          const nextRec={a,...merged};
          const prevClean=prev?{...prev}:null;if(prevClean)delete prevClean.approxBytes;
          if(JSON.stringify(prevClean)!==JSON.stringify(nextRec)){
            const prevB=prev?(prev.approxBytes ?? bytes(prev)):0;
            nextRec.approxBytes=bytes(nextRec);
            deltaBytes+=nextRec.approxBytes-prevB;
            this._putPerson(tx,nextRec);
            seenPeople.set(person.id,nextRec);
            identitiesChanged=true;
            projUpdates.push({kind:'person',person:nextRec});
          }else if(prev){
            seenPeople.set(person.id,prev);
          }
        }

        // 2. Prefetch existing msgs & rels across all existing rooms in parallel (Wave 2).
        // Brand-new rooms have zero existing msgs/rels so they need 0 IDB reads!
        const roomPrefetch=await Promise.all(roomEntries.map(async([,events],idx)=>{
          const existingRoom=prefetchedRooms[idx];
          if(!existingRoom || !events.length)return null;
          const n=existingRoom.n;
          const msgIds=new Set(),relIds=new Set(),targetIds=new Set();
          for(const ev of events){
            if(ev.type==='m.room.redaction'){
              relIds.add(ev.id);
              if(ev.redacts){msgIds.add(ev.redacts);relIds.add(ev.redacts);targetIds.add(ev.redacts);}
            }else if(ev.redacted){
              relIds.add(ev.id);msgIds.add(ev.id);targetIds.add(ev.id);
            }else if(ev.replaces){
              relIds.add(ev.id);targetIds.add(ev.id);targetIds.add(ev.replaces);msgIds.add(ev.replaces);
            }else{
              msgIds.add(ev.id);targetIds.add(ev.id);
            }
          }
          const mArr=[...msgIds],rArr=[...relIds],tArr=[...targetIds];
          const [mRes,rRes,tRes]=await Promise.all([
            Promise.all(mArr.map(id=>this._getMsg(tx,a,n,id))),
            Promise.all(rArr.map(id=>this._getRel(tx,a,n,id))),
            Promise.all(tArr.map(id=>this._getRelsByTarget(tx,a,n,id)))
          ]);
          const msgCache=new Map(),relCache=new Map(),relsByTargetCache=new Map();
          for(let i=0;i<mArr.length;i++)msgCache.set(mArr[i],mRes[i] ?? null);
          for(let i=0;i<rArr.length;i++)relCache.set(rArr[i],rRes[i] ?? null);
          for(let i=0;i<tArr.length;i++){
            const list=tRes[i] || [],map=new Map(list.map(r=>[r.e,r]));
            relsByTargetCache.set(tArr[i],map);
            for(const r of list)if(!relCache.has(r.e))relCache.set(r.e,r);
          }
          return {msgCache,relCache,relsByTargetCache};
        }));

        const changedRoomIds=[];
        for(let roomIdx=0;roomIdx<roomEntries.length;roomIdx++){
          const [roomId,events]=roomEntries[roomIdx];
          let room=prefetchedRooms[roomIdx];
          const isNewRoom=!room;
          const prevRoomComplete=room?.coverage?.complete===true?1:0;
          const prevRoomBytes=room?(room.approxBytes ?? bytes(room)):0;
          if(!room){
            const n=acc.nextRoom++;
            room={a,n,roomId,latest:null,headSeen:null,threads:{},inaccessible:null,legacyComplete:null,coverage:{complete:false,dateComplete:false,dates:{from:'',to:''}},msgCount:0,unknownCount:0,approxBytes:0};
          }else{
            room={...room,threads:{...(room.threads || {})},coverage:{...(room.coverage || {complete:false,dateComplete:false,dates:{from:'',to:''}})}};
          }
          const n=room.n;
          let roomDirty=isNewRoom,latestDirty=false,hadUnverifiedChange=false;

          // Track unknown event types (never drop silently).
          const unknownAdded=unknownByRoom.get(roomId) || 0;
          if(unknownAdded>0){
            room.unknownCount=(room.unknownCount || 0)+unknownAdded;
            deltaUnknown+=unknownAdded;
            if(room.coverage.complete)room.coverage.complete=false;
            roomDirty=true;
          }

          // Local per-batch caches pre-populated from Wave 2 (brand-new rooms never touch IDB for reads).
          const pre=roomPrefetch[roomIdx];
          const msgCache=pre?pre.msgCache:new Map(),relCache=pre?pre.relCache:new Map(),relsByTargetCache=pre?pre.relsByTargetCache:new Map();
          const getMsg=async e=>{if(msgCache.has(e))return msgCache.get(e);if(isNewRoom){msgCache.set(e,null);return null;}const v=await this._getMsg(tx,a,n,e);msgCache.set(e,v ?? null);return v ?? null;};
          const setMsg=m=>{msgCache.set(m.e,m);this._putMsg(tx,m);};
          const delMsg=e=>{msgCache.set(e,null);this._deleteMsg(tx,a,n,e);};
          const getRel=async e=>{if(relCache.has(e))return relCache.get(e);if(isNewRoom){relCache.set(e,null);return null;}const v=await this._getRel(tx,a,n,e);relCache.set(e,v ?? null);return v ?? null;};
          const getTargetRels=async target=>{
            if(!relsByTargetCache.has(target)){
              const list=isNewRoom?[]:await this._getRelsByTarget(tx,a,n,target);
              const map=new Map(list.map(r=>[r.e,r]));
              relsByTargetCache.set(target,map);
              for(const r of list)if(!relCache.has(r.e))relCache.set(r.e,r);
            }
            return relsByTargetCache.get(target);
          };
          const putRel=rel=>{
            relCache.set(rel.e,rel);
            const map=relsByTargetCache.get(rel.target);if(map)map.set(rel.e,rel);
            this._putRel(tx,rel);
          };

          const recomputeOriginal=async targetId=>{
            const orig=await getMsg(targetId);
            if(!orig)return;
            const targetRels=await getTargetRels(targetId);
            let bestEdit=null;
            for(const r of targetRels.values()){
              if(r.k==='edit' && !r.x && r.u===orig.u){
                if(!bestEdit || relOrder(bestEdit,r)<0)bestEdit=r;
              }
            }
            const base=orig.orig || {b:orig.b,f:orig.f,m:orig.m,v:orig.v,w:orig.w,h:orig.h,ds:orig.ds};
            const hadVisible=Boolean(orig.b);
            const oldFlags=hadVisible?(orig.f || 0):0;
            const oldBytes=orig.approxBytes ?? bytes(orig);

            const next={a,n,e:orig.e,p:orig.p || '',...(orig.s!=null?{s:orig.s}:{}),t:orig.t,u:orig.u,
              ...(orig.th?{th:orig.th}:{})};
            if(bestEdit){
              next.b=bestEdit.b || '';next.f=bestEdit.f || 0;
              if(bestEdit.m)next.m=bestEdit.m;
              if(bestEdit.v)next.v=bestEdit.v;
              if(bestEdit.w && bestEdit.h){next.w=bestEdit.w;next.h=bestEdit.h;}
              if(bestEdit.ds)next.ds=bestEdit.ds;
              next.eb=bestEdit.e;next.et=bestEdit.t;
              next.orig={b:base.b || '',f:base.f || 0,...(base.m?{m:base.m}:{}),...(base.v?{v:base.v}:{}),...(base.w && base.h?{w:base.w,h:base.h}:{}),...(base.ds?{ds:base.ds}:{})};
            }else{
              next.b=base.b || '';next.f=base.f || 0;
              if(base.m)next.m=base.m;
              if(base.v)next.v=base.v;
              if(base.w && base.h){next.w=base.w;next.h=base.h;}
              if(base.ds)next.ds=base.ds;
            }
            const nowVisible=Boolean(next.b);
            const newFlags=nowVisible?(next.f || 0):0;
            next.approxBytes=bytes(next);
            deltaBytes+=next.approxBytes-oldBytes;
            if(hadVisible!==nowVisible){
              const diff=nowVisible?1:-1;
              room.msgCount=Math.max(0,(room.msgCount || 0)+diff);
              deltaMessages+=diff;
            }
            if(oldFlags!==newFlags){
              this._adjustMediaTypeCounts(acc,oldFlags,-1);
              this._adjustMediaTypeCounts(acc,newFlags,1);
            }
            setMsg(next);
            projUpdates.push({kind:'msg',msg:next});
            if(room.latest?.e===next.e){
              const cand=makeLatestFromMsg(next);
              if(cand)room.latest=cand;else latestDirty=true;
            }else if(nowVisible){
              const cand=makeLatestFromMsg(next);
              if(isNewerLatest(cand,room.latest))room.latest=cand;
            }
            roomDirty=true;
          };

          const redactTarget=async(targetId,redactorId,redactorTime,redactorSender)=>{
            // Record permanent body-free redact tombstone.
            const targetRels=await getTargetRels(targetId);
            const existingSelf=await getRel(redactorId);
            if(!existingSelf || existingSelf.k!=='redact' || existingSelf.target!==targetId){
              const prevB=existingSelf?(existingSelf.approxBytes ?? bytes(existingSelf)):0;
              const tomb={a,n,e:redactorId,k:'redact',target:targetId,t:redactorTime || 0,u:redactorSender || ''};
              tomb.approxBytes=bytes(tomb);
              deltaBytes+=tomb.approxBytes-prevB;
              putRel(tomb);
              roomDirty=true;hadUnverifiedChange=true;
            }
            // Case A: target is a stored original message.
            const existingMsg=await getMsg(targetId);
            if(existingMsg){
              const prevB=existingMsg.approxBytes ?? bytes(existingMsg);
              deltaBytes-=prevB;
              if(existingMsg.b){
                room.msgCount=Math.max(0,(room.msgCount || 0)-1);
                deltaMessages-=1;
                this._adjustMediaTypeCounts(acc,existingMsg.f || 0,-1);
              }
              delMsg(targetId);
              projUpdates.push({kind:'delete',n,e:targetId});
              if(room.latest?.e===targetId)latestDirty=true;
              roomDirty=true;hadUnverifiedChange=true;
            }
            // Strip plaintext from any stored edits targeting this original.
            for(const r of targetRels.values()){
              if(r.k==='edit' && !r.x){
                const prevB=r.approxBytes ?? bytes(r);
                const stripped={a,n,e:r.e,k:'edit',target:r.target,t:r.t,u:r.u,x:1};
                stripped.approxBytes=bytes(stripped);
                deltaBytes+=stripped.approxBytes-prevB;
                putRel(stripped);
                roomDirty=true;
              }
            }
            // Case B: target itself is an edit in rels.
            const existingEdit=await getRel(targetId);
            if(existingEdit && existingEdit.k==='edit' && !existingEdit.x){
              const prevB=existingEdit.approxBytes ?? bytes(existingEdit);
              const stripped={a,n,e:existingEdit.e,k:'edit',target:existingEdit.target,t:existingEdit.t,u:existingEdit.u,x:1};
              stripped.approxBytes=bytes(stripped);
              deltaBytes+=stripped.approxBytes-prevB;
              putRel(stripped);
              await recomputeOriginal(existingEdit.target);
              roomDirty=true;hadUnverifiedChange=true;
            }
          };

          for(const ev of events){
            // Update headSeen and thread roots metadata.
            if(ev.seq!=null && !ev.seqScope && !ev.thread){
              if(!room.headSeen || ev.seq>room.headSeen.s){room.headSeen={s:ev.seq,at:Date.now()};roomDirty=true;}
            }
            if(ev.threadCount>0 && ev.seqRaw){
              const prevThread=room.threads[ev.seqRaw];
              const latestTs=Math.max(ev.threadLatestTs || 0,prevThread?.latestTs || 0);
              const rootTs=ev.time || prevThread?.rootTs || 0;
              if(!prevThread || prevThread.count!==ev.threadCount || latestTs>(prevThread.latestTs || 0) || rootTs && !prevThread.rootTs){
                room.threads[ev.seqRaw]={root:ev.id,count:ev.threadCount,dirty:!prevThread || prevThread.count!==ev.threadCount?true:Boolean(prevThread.dirty),...(latestTs?{latestTs}:{}),...(rootTs?{rootTs}:{})};
                roomDirty=true;
              }
            }

            // 1. Redactions
            if(ev.type==='m.room.redaction'){
              if(ev.redacts)await redactTarget(ev.redacts,ev.id,ev.time,ev.sender);
              continue;
            }
            if(ev.redacted){
              await redactTarget(ev.id,ev.id,ev.time,ev.sender);
              continue;
            }

            // 2. Edits (m.replace)
            if(ev.replaces){
              const selfRels=await getTargetRels(ev.id);
              const origRels=await getTargetRels(ev.replaces);
              const isRedacted=[...selfRels.values()].some(r=>r.k==='redact') || [...origRels.values()].some(r=>r.k==='redact');
              const existingRel=await getRel(ev.id);
              if(isRedacted || existingRel?.x){
                if(!existingRel || !existingRel.x){
                  const prevB=existingRel?(existingRel.approxBytes ?? bytes(existingRel)):0;
                  const stripped={a,n,e:ev.id,k:'edit',target:ev.replaces,t:ev.time,u:ev.sender,x:1};
                  stripped.approxBytes=bytes(stripped);
                  deltaBytes+=stripped.approxBytes-prevB;
                  putRel(stripped);
                  roomDirty=true;
                }
                continue;
              }
              const f=computeMediaFlags(ev.body,ev.attachmentType,ev.attachmentMime);
              let mergedRel;
              if(!existingRel){
                mergedRel={a,n,e:ev.id,k:'edit',target:ev.replaces,t:ev.time,u:ev.sender,b:ev.body,f,
                  ...(ev.attachmentMime?{m:ev.attachmentMime}:{}),...(ev.attachmentPreview?{v:ev.attachmentPreview}:{}),
                  ...(ev.attachmentWidth && ev.attachmentHeight?{w:ev.attachmentWidth,h:ev.attachmentHeight}:{})};
              }else{
                const srcChanged=Boolean(ev.attachmentPreview && existingRel.v!==ev.attachmentPreview);
                const nextBody=existingRel.b || ev.body;
                const nextType=attachTypeFromFlags(existingRel.f) || ev.attachmentType;
                const nextMime=existingRel.m || ev.attachmentMime || '';
                const nextPreview=ev.attachmentPreview || existingRel.v || '';
                const nextF=computeMediaFlags(nextBody,nextType,nextMime);
                let nextW=existingRel.w,nextH=existingRel.h,nextDs=existingRel.ds;
                if(srcChanged){nextW=undefined;nextH=undefined;nextDs=undefined;}
                if(ev.attachmentWidth && ev.attachmentHeight && (srcChanged || existingRel.ds!=='decoded')){nextW=ev.attachmentWidth;nextH=ev.attachmentHeight;nextDs=undefined;}
                const changed=nextBody!==existingRel.b || nextF!==existingRel.f || nextMime!==(existingRel.m || '') || nextPreview!==(existingRel.v || '') || nextW!==existingRel.w || nextH!==existingRel.h;
                if(!changed)continue;
                mergedRel={a,n,e:ev.id,k:'edit',target:ev.replaces,t:existingRel.t,u:existingRel.u,b:nextBody,f:nextF,
                  ...(nextMime?{m:nextMime}:{}),...(nextPreview?{v:nextPreview}:{}),
                  ...(nextW && nextH?{w:nextW,h:nextH}:{}),...(nextDs?{ds:nextDs}:{})};
              }
              const prevB=existingRel?(existingRel.approxBytes ?? bytes(existingRel)):0;
              mergedRel.approxBytes=bytes(mergedRel);
              deltaBytes+=mergedRel.approxBytes-prevB;
              putRel(mergedRel);
              await recomputeOriginal(ev.replaces);
              roomDirty=true;hadUnverifiedChange=true;
              continue;
            }

            // 3. Original messages (m.room.message / m.sticker)
            const targetRels=await getTargetRels(ev.id);
            if([...targetRels.values()].some(r=>r.k==='redact'))continue;

            const existing=await getMsg(ev.id);
            const f=computeMediaFlags(ev.body,ev.attachmentType,ev.attachmentMime);
            let base;
            if(!existing){
              base={b:ev.body,f,...(ev.attachmentMime?{m:ev.attachmentMime}:{}),...(ev.attachmentPreview?{v:ev.attachmentPreview}:{}),
                ...(ev.attachmentWidth && ev.attachmentHeight?{w:ev.attachmentWidth,h:ev.attachmentHeight}:{})};
            }else{
              const prevBase=existing.orig || {b:existing.b,f:existing.f,m:existing.m,v:existing.v,w:existing.w,h:existing.h,ds:existing.ds};
              const srcChanged=Boolean(ev.attachmentPreview && prevBase.v!==ev.attachmentPreview);
              const nextBody=prevBase.b || ev.body;
              const nextType=attachTypeFromFlags(prevBase.f) || ev.attachmentType;
              const nextMime=prevBase.m || ev.attachmentMime || '';
              const nextPreview=ev.attachmentPreview || prevBase.v || '';
              const nextF=computeMediaFlags(nextBody,nextType,nextMime);
              let nextW=prevBase.w,nextH=prevBase.h,nextDs=prevBase.ds;
              if(srcChanged){nextW=undefined;nextH=undefined;nextDs=undefined;}
              if(ev.attachmentWidth && ev.attachmentHeight && (srcChanged || prevBase.ds!=='decoded')){nextW=ev.attachmentWidth;nextH=ev.attachmentHeight;nextDs=undefined;}
              const seqChanged=ev.seq!=null && existing.s==null;
              const changed=seqChanged || nextBody!==prevBase.b || nextF!==prevBase.f || nextMime!==(prevBase.m || '') || nextPreview!==(prevBase.v || '') || nextW!==prevBase.w || nextH!==prevBase.h;
              if(!changed)continue;
              base={b:nextBody,f:nextF,...(nextMime?{m:nextMime}:{}),...(nextPreview?{v:nextPreview}:{}),
                ...(nextW && nextH?{w:nextW,h:nextH}:{}),...(nextDs?{ds:nextDs}:{})};
            }

            // Apply newest valid same-sender edit if any already arrived out-of-order.
            let bestEdit=null;
            for(const r of targetRels.values()){
              if(r.k==='edit' && !r.x && r.u===ev.sender){
                if(!bestEdit || relOrder(bestEdit,r)<0)bestEdit=r;
              }
            }
            const next={a,n,e:ev.id,p:ev.seqScope || '',...((ev.seq!=null || existing?.s!=null)?{s:ev.seq ?? existing.s}:{}),t:existing?existing.t:ev.time,u:existing?existing.u:ev.sender,
              ...(ev.thread && ev.threadRoot?{th:ev.threadRoot}:existing?.th?{th:existing.th}:{})};
            if(bestEdit){
              next.b=bestEdit.b || '';next.f=bestEdit.f || 0;
              if(bestEdit.m)next.m=bestEdit.m;
              if(bestEdit.v)next.v=bestEdit.v;
              if(bestEdit.w && bestEdit.h){next.w=bestEdit.w;next.h=bestEdit.h;}
              if(bestEdit.ds)next.ds=bestEdit.ds;
              next.eb=bestEdit.e;next.et=bestEdit.t;
              next.orig=base;
            }else{
              next.b=base.b || '';next.f=base.f || 0;
              if(base.m)next.m=base.m;
              if(base.v)next.v=base.v;
              if(base.w && base.h){next.w=base.w;next.h=base.h;}
              if(base.ds)next.ds=base.ds;
            }

            const prevVisible=Boolean(existing?.b);
            const nowVisible=Boolean(next.b);
            const prevFlags=prevVisible?(existing.f || 0):0;
            const nowFlags=nowVisible?(next.f || 0):0;
            const prevB=existing?(existing.approxBytes ?? bytes(existing)):0;
            next.approxBytes=bytes(next);
            deltaBytes+=next.approxBytes-prevB;
            if(prevVisible!==nowVisible){
              const diff=nowVisible?1:-1;
              room.msgCount=Math.max(0,(room.msgCount || 0)+diff);
              deltaMessages+=diff;
            }
            if(prevFlags!==nowFlags){
              this._adjustMediaTypeCounts(acc,prevFlags,-1);
              this._adjustMediaTypeCounts(acc,nowFlags,1);
            }
            setMsg(next);
            projUpdates.push({kind:'msg',msg:next});
            if(nowVisible){
              const cand=makeLatestFromMsg(next);
              if(isNewerLatest(cand,room.latest) || room.latest?.e===next.e)room.latest=cand;
            }
            roomDirty=true;hadUnverifiedChange=true;
          }

          // Recompute room.latest if the previous latest message was redacted.
          if(latestDirty){
            const allMsgs=await this._getRoomMsgs(tx,a,n);
            let best=null;
            for(const m of allMsgs){
              const cand=makeLatestFromMsg(m);
              if(isNewerLatest(cand,best))best=cand;
            }
            room.latest=best;
            roomDirty=true;
          }

          // 4. Span metadata (backfill & in-room history pages)
          const spanInput=roomId===batch.roomId?batch.span:null;
          const covInput=roomId===batch.roomId?batch.coverage:undefined;
          if(spanInput && Number.isSafeInteger(spanInput.lo) && Number.isSafeInteger(spanInput.hi) && spanInput.lo>=0 && spanInput.hi>=spanInput.lo){
            if(Number.isInteger(spanInput.unknownDelta) && spanInput.unknownDelta>0){
              room.unknownCount=(room.unknownCount || 0)+spanInput.unknownDelta;
              acc.unknownEvents=(acc.unknownEvents || 0)+spanInput.unknownDelta;
              roomDirty=true;coverageChanged=true;
            }
            const scope=str(spanInput.p || '',200);
            const existingSpans=await this._getSpans(tx,a,n,scope);
            let lo=spanInput.lo,bottom=Boolean(spanInput.bottom);
            // Upgrade legacyComplete room to a real bottomed span once a head pass overlaps a stored event.
            if(!scope && room.legacyComplete && spanInput.overlapLegacy){
              lo=0;bottom=true;room.legacyComplete=null;
            }
            const incoming={a,n,p:scope,lo,hi:spanInput.hi,tLo:spanInput.tLo || 0,tHi:spanInput.tHi || 0,bottom,at:Date.now(),src:str(spanInput.src || batch.source || '',40)};
            const {merged,removed}=mergeSpanList(existingSpans,incoming);
            for(const old of removed)this._deleteSpan(tx,a,n,scope,old.hi);
            this._putSpan(tx,merged);
            if(!scope && (!room.headSeen || merged.hi>room.headSeen.s))room.headSeen={s:merged.hi,at:merged.at};
            if(scope && room.threads[scope] && merged.bottom)room.threads[scope]={...room.threads[scope],dirty:false};
            const allSpans=await this._getSpans(tx,a,n);
            const byScope=new Map();
            for(const sp of allSpans){if(!byScope.has(sp.p))byScope.set(sp.p,[]);byScope.get(sp.p).push(sp);}
            const complete=roomCompleteFromSpans(room,byScope);
            room.coverage={complete,dateComplete:Boolean(complete || covInput?.dateComplete),dates:{from:str(covInput?.dates?.from,10),to:str(covInput?.dates?.to,10)}};
            roomDirty=true;
          }else if(covInput){
            const nextCov={complete:covInput.complete===true && !room.unknownCount && !room.inaccessible,dateComplete:covInput.dateComplete===true,dates:{from:str(covInput.dates?.from,10),to:str(covInput.dates?.to,10)}};
            if(JSON.stringify(nextCov)!==JSON.stringify(room.coverage)){
              room.coverage=nextCov;roomDirty=true;
            }
          }else if(hadUnverifiedChange && room.coverage?.complete){
            // Any unverified incoming event may introduce a gap (matching v1 guarantee).
            room.coverage={complete:false,dateComplete:false,dates:{from:'',to:''}};
            roomDirty=true;
          }

          if(!roomDirty)continue;
          const nextRoomComplete=room.coverage?.complete===true?1:0;
          delete room.approxBytes;room.approxBytes=bytes(room);
          deltaBytes+=room.approxBytes-prevRoomBytes;
          deltaRooms+=isNewRoom?1:0;
          deltaCompleteRooms+=nextRoomComplete-prevRoomComplete;
          this._putRoom(tx,room);
          projUpdates.push({kind:'room',room});
          changedRoomIds.push(roomId);
        }

        const changed=identitiesChanged || changedRoomIds.length>0;
        if(changed){
          acc.stats={
            messages:Math.max(0,(acc.stats?.messages || 0)+deltaMessages),
            rooms:Math.max(0,(acc.stats?.rooms || 0)+deltaRooms),
            completeRooms:Math.max(0,(acc.stats?.completeRooms || 0)+deltaCompleteRooms),
            bytes:Math.max(0,(acc.stats?.bytes || 0)+deltaBytes),
            unknownEvents:Math.max(0,(acc.stats?.unknownEvents || 0)+deltaUnknown)
          };
          this._putAccount(tx,acc);
        }
        if(completion)await completion;

        // Patch in-memory projection AFTER transaction commits so failed writes never poison memory.
        const proj=this.projections.get(batch.owner);
        if(proj && changed){
          for(const u of projUpdates){
            if(u.kind==='person')proj.people.set(u.person.id,u.person);
            else if(u.kind==='room')proj.registerRoom(u.room);
            else if(u.kind==='msg')proj.upsert(u.msg);
            else if(u.kind==='delete')proj.remove(u.n,u.e);
          }
          proj.account=acc;
        }
        if(changed && this.onStatsDelta)this.onStatsDelta({owner:batch.owner,messages:deltaMessages,rooms:deltaRooms,completeRooms:deltaCompleteRooms,approxBytes:deltaBytes});
        return {owner:batch.owner,persistent:this.persistent,changed,...(!identitiesChanged?{roomIds:changedRoomIds}:{}),...(batch.span?{coverageChanged:true}:{})};
      } catch(error){try{tx?.abort();}catch{}await completion?.catch(()=>{});throw error;}
    }

    rememberDimensions(batch){const result=this.queue.then(()=>this.writeDimensions(batch));this.queue=result.catch(()=>{});return result;}
    async writeDimensions({owner,records}={}){
      if(!ownerOK(owner) || !Array.isArray(records) || records.length>100)throw Error('Invalid image dimensions');
      for(const r of records)if(typeof r?.roomId!=='string' || !r.roomId || r.roomId.length>1000 || typeof r.eventId!=='string' || !r.eventId || r.eventId.length>1000 || !previewURL(r.preview) || !Number.isFinite(r.width) || !Number.isFinite(r.height) || r.width<1 || r.height<1 || r.width>100000 || r.height>100000)throw Error('Invalid image dimensions');
      this.writeEpoch++;
      const tx=await this.transaction(['accounts','rooms','msgs','rels'],'readwrite'),completion=tx?done(tx):null;
      try{
        const acc=await this._getAccount(tx,owner);
        if(!acc){if(completion)await completion;return {owner,changed:false,roomIds:[]};}
        const a=acc.a,changed=new Set();let deltaBytes=0;
        const roomsUpdated=[];
        for(const r of records){
          const room=await this._getRoomById(tx,a,r.roomId);if(!room)continue;
          const msg=await this._getMsg(tx,a,room.n,r.eventId);
          const cleanUrl=previewURL(r.preview);
          if(!msg || !msg.b || !(msg.f & MEDIA_BITS.image) || msg.v!==cleanUrl)continue;
          const w=Math.round(r.width),h=Math.round(r.height);
          if(msg.w===w && msg.h===h && msg.ds==='decoded')continue;
          const prevB=msg.approxBytes ?? bytes(msg);
          const updated={...msg,w,h,ds:'decoded'};
          // If unedited, persist decoded dimensions on msg; if edited, also update the applied edit in rels.
          if(msg.eb){
            const rel=await this._getRel(tx,a,room.n,msg.eb);
            if(rel && !rel.x && rel.v===cleanUrl){
              const prevRelB=rel.approxBytes ?? bytes(rel);
              const nextRel={...rel,w,h,ds:'decoded'};
              delete nextRel.approxBytes;nextRel.approxBytes=bytes(nextRel);
              deltaBytes+=nextRel.approxBytes-prevRelB;
              this._putRel(tx,nextRel);
            }
          }
          delete updated.approxBytes;updated.approxBytes=bytes(updated);
          deltaBytes+=updated.approxBytes-prevB;
          this._putMsg(tx,updated);
          if(room.latest?.e===msg.e){
            const prevRoomB=room.approxBytes ?? bytes(room);
            const nextRoom={...room,latest:{...room.latest,w,h}};
            delete nextRoom.approxBytes;nextRoom.approxBytes=bytes(nextRoom);
            deltaBytes+=nextRoom.approxBytes-prevRoomB;
            this._putRoom(tx,nextRoom);
            roomsUpdated.push(nextRoom);
          }
          changed.add(r.roomId);
        }
        if(changed.size>0){
          acc.stats={...acc.stats,bytes:Math.max(0,(acc.stats?.bytes || 0)+deltaBytes)};
          this._putAccount(tx,acc);
        }
        if(completion)await completion;
        const proj=this.projections.get(owner);
        if(proj && changed.size>0){
          proj.account=acc;
          for(const rm of roomsUpdated)proj.registerRoom(rm);
        }
        if(changed.size>0 && this.onStatsDelta)this.onStatsDelta({owner,messages:0,rooms:0,completeRooms:0,approxBytes:deltaBytes});
        return {owner,changed:changed.size>0,roomIds:[...changed]};
      }catch(error){try{tx?.abort();}catch{}await completion?.catch(()=>{});throw error;}
    }

    // --- Coverage, Inaccessible, HeadSeen APIs (Phases B & C) ---
    async coverage(owner,roomIds){
      if(!ownerOK(owner))throw Error('Invalid account');
      const tx=await this.transaction(['accounts','rooms','spans'],'readonly');
      const acc=await this._getAccount(tx,owner);
      if(!acc)return {owner,rooms:{}};
      const a=acc.a;
      const roomList=Array.isArray(roomIds)?(await Promise.all(roomIds.map(id=>this._getRoomById(tx,a,id)))).filter(Boolean):await this._getAllRooms(tx,a);
      const out={};
      for(const rm of roomList){
        const spanList=await this._getSpans(tx,a,rm.n);
        const byScope={};
        for(const sp of spanList){
          if(!byScope[sp.p])byScope[sp.p]=[];
          byScope[sp.p].push({lo:sp.lo,hi:sp.hi,tLo:sp.tLo,tHi:sp.tHi,bottom:sp.bottom,at:sp.at,src:sp.src});
        }
        for(const list of Object.values(byScope))list.sort((x,y)=>x.hi-y.hi);
        out[rm.roomId]={spans:byScope,headSeen:rm.headSeen || null,threads:rm.threads || {},inaccessible:rm.inaccessible || null,legacyComplete:rm.legacyComplete || null,unknownCount:rm.unknownCount || 0,coverage:rm.coverage || {complete:false,dateComplete:false},latest:rm.latest || null,msgCount:rm.msgCount || 0};
      }
      return {owner,rooms:out};
    }

    markInaccessible(owner,roomId,status){const result=this.queue.then(()=>this._writeInaccessible(owner,roomId,status));this.queue=result.catch(()=>{});return result;}
    async _writeInaccessible(owner,roomId,status){
      if(!ownerOK(owner) || typeof roomId!=='string' || !roomId || roomId.length>1000)throw Error('Invalid room');
      this.writeEpoch++;
      const tx=await this.transaction(['accounts','rooms','meta'],'readwrite'),completion=tx?done(tx):null;
      try{
        const acc=await this._ensureAccount(tx,owner);
        let rm=await this._getRoomById(tx,acc.a,roomId);
        const isNew=!rm,prevComplete=rm?.coverage?.complete?1:0,prevBytes=rm?(rm.approxBytes ?? bytes(rm)):0;
        if(!rm){
          const n=acc.nextRoom++;
          rm={a:acc.a,n,roomId,latest:null,headSeen:null,threads:{},inaccessible:null,legacyComplete:null,coverage:{complete:false,dateComplete:false,dates:{from:'',to:''}},msgCount:0,unknownCount:0,approxBytes:0};
        }else rm={...rm,coverage:{...(rm.coverage || {}),complete:false}};
        rm.inaccessible={status:Number(status) || 403,at:Date.now()};
        delete rm.approxBytes;rm.approxBytes=bytes(rm);
        const deltaBytes=rm.approxBytes-prevBytes;
        this._putRoom(tx,rm);
        acc.stats={...acc.stats,rooms:(acc.stats?.rooms || 0)+(isNew?1:0),completeRooms:Math.max(0,(acc.stats?.completeRooms || 0)-prevComplete),bytes:Math.max(0,(acc.stats?.bytes || 0)+deltaBytes)};
        this._putAccount(tx,acc);
        if(completion)await completion;
        const proj=this.projections.get(owner);if(proj){proj.registerRoom(rm);proj.account=acc;}
        if(this.onStatsDelta)this.onStatsDelta({owner,messages:0,rooms:isNew?1:0,completeRooms:-prevComplete,approxBytes:deltaBytes});
        return {owner,roomId,inaccessible:rm.inaccessible};
      }catch(error){try{tx?.abort();}catch{}await completion?.catch(()=>{});throw error;}
    }

    updateHeads(owner,heads){const result=this.queue.then(()=>this._writeHeads(owner,heads));this.queue=result.catch(()=>{});return result;}
    async _writeHeads(owner,heads){
      if(!ownerOK(owner) || !Array.isArray(heads))throw Error('Invalid head update');
      this.writeEpoch++;
      const tx=await this.transaction(['accounts','rooms','spans','meta'],'readwrite'),completion=tx?done(tx):null;
      try{
        const acc=await this._ensureAccount(tx,owner);
        const now=Date.now();let deltaRooms=0,deltaComplete=0,deltaBytes=0;const updatedRooms=[];
        for(const item of heads){
          const roomId=str(item?.roomId);if(!roomId)continue;
          const parsed=parseSeq(item.lastSeq);if(!parsed)continue;
          let rm=await this._getRoomById(tx,acc.a,roomId);
          const isNew=!rm,prevComplete=rm?.coverage?.complete?1:0,prevBytes=rm?(rm.approxBytes ?? bytes(rm)):0;
          if(!rm){
            const n=acc.nextRoom++;
            rm={a:acc.a,n,roomId,latest:null,headSeen:{s:parsed.s,at:now},threads:{},inaccessible:null,legacyComplete:null,coverage:{complete:false,dateComplete:false,dates:{from:'',to:''}},msgCount:0,unknownCount:0,approxBytes:0};
          }else{
            if(rm.headSeen && rm.headSeen.s>=parsed.s)continue;
            rm={...rm,headSeen:{s:parsed.s,at:now}};
            const allSpans=await this._getSpans(tx,acc.a,rm.n);
            const byScope=new Map();for(const sp of allSpans){if(!byScope.has(sp.p))byScope.set(sp.p,[]);byScope.get(sp.p).push(sp);}
            if(byScope.size)rm.coverage={...(rm.coverage || {}),complete:roomCompleteFromSpans(rm,byScope)};
          }
          delete rm.approxBytes;rm.approxBytes=bytes(rm);
          deltaBytes+=rm.approxBytes-prevBytes;deltaRooms+=isNew?1:0;deltaComplete+=(rm.coverage?.complete?1:0)-prevComplete;
          this._putRoom(tx,rm);updatedRooms.push(rm);
        }
        if(updatedRooms.length){
          acc.stats={...acc.stats,rooms:(acc.stats?.rooms || 0)+deltaRooms,completeRooms:Math.max(0,(acc.stats?.completeRooms || 0)+deltaComplete),bytes:Math.max(0,(acc.stats?.bytes || 0)+deltaBytes)};
          this._putAccount(tx,acc);
        }
        if(completion)await completion;
        const proj=this.projections.get(owner);if(proj && updatedRooms.length){for(const rm of updatedRooms)proj.registerRoom(rm);proj.account=acc;}
        return {owner,updated:updatedRooms.length};
      }catch(error){try{tx?.abort();}catch{}await completion?.catch(()=>{});throw error;}
    }

    // --- Projection Builder & Search Engine ---
    async _readAccountQuick(owner){
      const tx=await this.transaction('accounts','readonly');
      return this._getAccount(tx,owner);
    }

    async _ensureProjection(owner){
      const cached=this.projections.get(owner);
      if(cached)return cached;
      const tx=await this.transaction(['accounts','rooms','msgs','people'],'readonly');
      const acc=await this._getAccount(tx,owner);
      if(!acc)return null;
      const a=acc.a;
      const [roomList,peopleList]=await Promise.all([this._getAllRooms(tx,a),this._getAllPeople(tx,a)]);
      const proj=new AccountProjection(a);
      proj.account=acc;
      for(const rm of roomList)proj.registerRoom(rm);
      for(const p of peopleList)proj.people.set(p.id,p);

      if(tx){
        // Stream msgs in bounded 5,000-row primary-key getAll batches: O(N/5000) IDB IPC calls
        // instead of O(N) cursor steps, with strictly unique cursor keys and ~1 MB peak batch memory.
        const store=tx.objectStore('msgs'),upper=[a,Number.MAX_SAFE_INTEGER,'\uffff'];
        let lower=[a,0,''],lowerOpen=false;
        while(true){
          const batch=await request(store.getAll(IDBKeyRange.bound(lower,upper,lowerOpen,false),5000));
          for(let i=0;i<batch.length;i++){
            const m=batch[i];
            if(!m.e?.startsWith('~') && !m.eb?.startsWith('~'))proj.upsert(m);
          }
          if(batch.length<5000)break;
          const last=batch[batch.length-1];
          lower=[a,last.n,last.e];lowerOpen=true;
        }
      }else{
        for(const m of this.mem.msgs.values()){
          if(m.a===a && !m.e?.startsWith('~') && !m.eb?.startsWith('~'))proj.upsert(m);
        }
      }
      // Sort projection columns descending by t once on cold build so date queries use O(log N) binary search.
      if(!proj.sortedDesc && proj.count>1){
        const orderIdx=new Uint32Array(proj.count);
        for(let i=0;i<proj.count;i++)orderIdx[i]=i;
        orderIdx.sort((x,y)=>proj.t[y]-proj.t[x]);
        const nt=new Float64Array(proj.capacity),nr=new Uint32Array(proj.capacity),ns=new Uint32Array(proj.capacity),nf=new Uint8Array(proj.capacity);
        const nFolded=new Array(proj.count),nIds=new Array(proj.count);
        proj.keyToPos.clear();
        for(let i=0;i<proj.count;i++){
          const old=orderIdx[i];
          nt[i]=proj.t[old];nr[i]=proj.room[old];ns[i]=proj.senderIdx[old];nf[i]=proj.flags[old];
          nFolded[i]=proj.folded[old];nIds[i]=proj.ids[old];
          if(nIds[i])proj.keyToPos.set(nr[i]+'\0'+nIds[i],i);
        }
        proj.t=nt;proj.room=nr;proj.senderIdx=ns;proj.flags=nf;proj.folded=nFolded;proj.ids=nIds;
        proj.sortedDesc=true;proj.lastT=proj.t[proj.count-1];
      }
      this.projections.set(owner,proj);
      return proj;
    }

    _materializeRecord(owner,roomId,msg,peopleMap,directory,identityCache){
      let person=identityCache?.get(msg.u);
      if(!person){
        const cached=peopleMap.get(msg.u) || {},known=directory?.identities?.[msg.u] || {};
        person=mergeIdentity(cached,{...known,id:msg.u});
        identityCache?.set(msg.u,person);
      }
      const self=msg.u===owner;
      return {
        id:msg.e,roomId,text:msg.b || '',sender:msg.u,
        timestamp:msg.t?new Date(msg.t).toISOString():'',
        attachmentType:attachTypeFromFlags(msg.f || 0),
        attachmentMime:msg.m || '',
        attachmentPreview:msg.v || '',
        ...(msg.w && msg.h?{attachmentWidth:msg.w,attachmentHeight:msg.h}:{}),
        author:self?'You':person.name || msg.u,
        authorSelf:self,
        authorHistorical:Boolean(person.historical ?? person.historicalName),
        authorUnavailable:Boolean(person.unavailable ?? person.accountUnavailable),
        avatar:person.avatar || '',
        thread:Boolean(msg.th),
        threadRoot:msg.th || ''
      };
    }

    async searchCount(owner,{query='',roomId,roomIds,dates={},from='all',wholeWord=false,minTimeExclusive=-Infinity,stopAt=0,committed=true}={},directory) {
      if(!ownerOK(owner))throw Error('Invalid account');
      if(typeof query!=='string' || query.length>1000 || !['all','me','them'].includes(from) || roomIds!==undefined && (!Array.isArray(roomIds) || roomIds.some(id=>typeof id!=='string' || !id || id.length>1000)))throw Error('Invalid message query');
      if(!committed)await this.queue;
      if(this.legacy && await this.legacy.probe()){
        const acc=await this._readAccountQuick(owner);
        if(!acc || acc.migration?.state!=='done'){
          this.ensureMigration(owner).catch(()=>{});
          const v1Res=await this.legacy.searchV1(owner,{query,roomId,roomIds,dates,from,wholeWord,sort:'newest',limit:Math.min(500,Math.max(100,stopAt || 100)),offset:0},directory);
          if(v1Res){
            const hasMin=Number.isFinite(minTimeExclusive);
            let certified=0;
            for(const rec of v1Res.records || []){
              const ts=typeof rec.timestamp==='number'?rec.timestamp:Date.parse(rec.timestamp || '') || 0;
              if(!hasMin || ts>minTimeExclusive){certified++;if(stopAt>0 && certified>=stopAt)break;}
            }
            return {certified};
          }
        }
      }
      const proj=await this._ensureProjection(owner);
      if(!proj)return {certified:0};
      const plan=RCSCore.compilePlan(query,{from,wholeWord,dates});
      if(plan.invalid || plan.impossible)return {certified:0};
      let roomSet=null;
      if(roomId){
        const ord=proj.roomOrdById.get(roomId);
        if(ord===undefined || (roomIds && !roomIds.includes(roomId)))return {certified:0};
        roomSet=new Set([ord]);
      }else if(roomIds){
        roomSet=new Set();
        for(const id of roomIds){const ord=proj.roomOrdById.get(id);if(ord!==undefined)roomSet.add(ord);}
        if(!roomSet.size)return {certified:0};
      }
      const senderCount=proj.senderIdByIdx.length;
      const senderInfos=new Array(senderCount);
      const senderMask=(plan.fromMode!=='all' || plan.anySenders)?new Uint8Array(senderCount):null;
      for(let s=0;s<senderCount;s++){
        const sid=proj.senderIdByIdx[s];
        const cached=proj.people.get(sid) || {},known=directory?.identities?.[sid] || {};
        const person=mergeIdentity(cached,{...known,id:sid});
        const self=sid===owner;
        const info={self,sender:sid,author:self?'You':person.name || sid,aliases:person.aliases || []};
        senderInfos[s]=info;
        if(senderMask){
          let ok=true;
          if(plan.fromMode==='me' && !self || plan.fromMode==='them' && self)ok=false;
          if(ok && plan.anySenders){
            ok=plan.anySenders.some(wanted=>{
              if(wanted==='me')return self;
              if(wanted==='them')return !self;
              if(self)return false;
              return RCSCore.matches(info.author || info.sender,wanted) || info.aliases.some(alias=>RCSCore.matches(alias,wanted));
            });
          }
          senderMask[s]=ok?1:0;
        }
      }
      const {t,room,senderIdx,flags,folded,count}=proj;
      const {start:tStart,end:tEnd,active:timeActive}=plan.timeRange;
      const hasMin=Number.isFinite(minTimeExclusive);
      const effStart=hasMin?Math.max(tStart,minTimeExclusive):tStart;
      const needles=plan.requiredNeedles,needleCount=needles.length;
      const reqMask=plan.requiredMediaMask;
      const {matchFinal}=plan;
      const wordAt=RCSCore.wordAt;
      let lo=0,hi=count;
      if(proj.sortedDesc && (timeActive || hasMin))[lo,hi]=descendingTimeBounds(t,count,effStart,tEnd);
      let certified=0;
      for(let i=lo;i<hi;i++){
        const ti=t[i];
        if(hasMin && ti<=minTimeExclusive){if(proj.sortedDesc)break;continue;}
        if(timeActive && (ti<tStart || ti>=tEnd))continue;
        if(roomSet && !roomSet.has(room[i]))continue;
        const s=senderIdx[i];
        if(senderMask && !senderMask[s])continue;
        const fi=flags[i];
        if(reqMask && (fi & reqMask)!==reqMask)continue;
        const text=folded[i];
        if(needleCount){
          let hit=true;
          for(let k=0;k<needleCount;k++){const nd=needles[k];if(!wordAt(text,nd.needle,nd.bounded)){hit=false;break;}}
          if(!hit)continue;
        }
        if(matchFinal(text,ti,fi,senderInfos[s])){
          certified++;
          if(stopAt>0 && certified>=stopAt)break;
        }
      }
      return {certified};
    }

    async search(owner,{query='',roomId,roomIds,dates={},from='all',wholeWord=false,sort='newest',grouped=false,limit=200,offset=0,committed=false}={},directory) {
      if(!ownerOK(owner))throw Error('Invalid account');
      if(typeof query!=='string' || query.length>1000 || !Number.isInteger(limit) || limit<1 || limit>500 || !Number.isInteger(offset) || offset<0 || offset>1000000 || !['all','me','them'].includes(from) || !['newest','oldest','relevant'].includes(sort) || roomIds!==undefined && (!Array.isArray(roomIds) || roomIds.some(id=>typeof id!=='string' || !id || id.length>1000)))throw Error('Invalid message query');
      if(!committed)await this.queue;

      // During v1->v2 migration, serve reads from v1 until this owner finishes migrating.
      if(this.legacy && await this.legacy.probe()){
        const acc=await this._readAccountQuick(owner);
        if(!acc || acc.migration?.state!=='done'){
          this.ensureMigration(owner).catch(()=>{});
          const v1Res=await this.legacy.searchV1(owner,{query,roomId,roomIds,dates,from,wholeWord,sort,grouped,limit,offset},directory);
          if(v1Res)return v1Res;
        }
      }

      // Single-room fast path when projection is cold: read only that room's key range without scanning the whole account.
      if(roomId && !this.projections.has(owner)){
        return this._searchSingleRoom(owner,roomId,{query,roomIds,dates,from,wholeWord,sort,grouped,limit,offset},directory);
      }

      const proj=await this._ensureProjection(owner);
      const mediaCounts=emptyMediaCounts();
      if(!proj){
        return {owner,selfIdentity:null,persistent:this.persistent,records:[],total:0,hasMore:false,matchedRooms:0,mediaCounts,availableMediaTypes:[],...(grouped?{groups}:{}),stats:{messages:0,rooms:0,completeRooms:0,approxBytes:0},coverage:roomId?{complete:false,dateComplete:false}:{complete:false,unknownRooms:false,threadsVerified:false}};
      }
      const acc=proj.account;
      const availableMediaTypes=MEDIA_TYPES.filter(type=>(acc.mediaTypeCounts?.[type] || 0)>0);
      const selfId=identity(proj.people.get(owner));
      const statsObj={messages:acc.stats?.messages || 0,rooms:acc.stats?.rooms || 0,completeRooms:acc.stats?.completeRooms || 0,approxBytes:acc.stats?.bytes || 0,...(acc.stats?.unknownEvents?{unknownEvents:acc.stats.unknownEvents}:{})};

      const plan=RCSCore.compilePlan(query,{from,wholeWord,dates});
      if(plan.invalid || plan.impossible){
        const cov=roomId?proj.roomMeta.get(proj.roomOrdById.get(roomId))?.coverage || {complete:false,dateComplete:false}:{complete:false,unknownRooms:false,threadsVerified:false};
        return {owner,selfIdentity:selfId,persistent:this.persistent,records:[],total:0,hasMore:false,matchedRooms:0,mediaCounts,availableMediaTypes,...(grouped?{groups:[]}:{}),stats:statsObj,coverage:cov};
      }

      // Room filter set (integer ordinals).
      let roomSet=null;
      if(roomId){
        const ord=proj.roomOrdById.get(roomId);
        if(ord===undefined){
          return {owner,selfIdentity:selfId,persistent:this.persistent,records:[],total:0,hasMore:false,matchedRooms:0,mediaCounts,availableMediaTypes,...(grouped?{groups:[]}:{}),stats:statsObj,coverage:{complete:false,dateComplete:false}};
        }
        if(roomIds && !roomIds.includes(roomId)){
          return {owner,selfIdentity:selfId,persistent:this.persistent,records:[],total:0,hasMore:false,matchedRooms:0,mediaCounts,availableMediaTypes,...(grouped?{groups:[]}:{}),stats:statsObj,coverage:proj.roomMeta.get(ord)?.coverage || {complete:false,dateComplete:false}};
        }
        roomSet=new Set([ord]);
      }else if(roomIds){
        roomSet=new Set();
        for(const id of roomIds){const ord=proj.roomOrdById.get(id);if(ord!==undefined)roomSet.add(ord);}
      }

      // Pre-resolve every distinct sender ONCE for this query.
      const senderCount=proj.senderIdByIdx.length;
      const senderInfos=new Array(senderCount);
      const senderMask=(plan.fromMode!=='all' || plan.anySenders)?new Uint8Array(senderCount):null;
      for(let s=0;s<senderCount;s++){
        const sid=proj.senderIdByIdx[s];
        const cached=proj.people.get(sid) || {},known=directory?.identities?.[sid] || {};
        const person=mergeIdentity(cached,{...known,id:sid});
        const self=sid===owner;
        const info={self,sender:sid,author:self?'You':person.name || sid,aliases:person.aliases || []};
        senderInfos[s]=info;
        if(senderMask){
          let ok=true;
          if(plan.fromMode==='me' && !self || plan.fromMode==='them' && self)ok=false;
          if(ok && plan.anySenders){
            ok=plan.anySenders.some(wanted=>{
              if(wanted==='me')return self;
              if(wanted==='them')return !self;
              if(self)return false;
              return RCSCore.matches(info.author || info.sender,wanted) || info.aliases.some(alias=>RCSCore.matches(alias,wanted));
            });
          }
          senderMask[s]=ok?1:0;
        }
      }

      const {t,room,senderIdx,flags,folded,ids,count}=proj;
      const {start:tStart,end:tEnd,active:timeActive}=plan.timeRange;
      const needles=plan.requiredNeedles,needleCount=needles.length;
      const reqMask=plan.requiredMediaMask;
      const {matchIgnoreMedia,matchFinal}=plan;
      const wordAt=RCSCore.wordAt;

      let lo=0,hi=count;
      if(proj.sortedDesc && timeActive)[lo,hi]=descendingTimeBounds(t,count,tStart,tEnd);

      const matchedIdx=[];
      for(let i=lo;i<hi;i++){
        if(!ids[i])continue;
        if(roomSet && !roomSet.has(room[i]))continue;
        if(senderMask && !senderMask[senderIdx[i]])continue;
        const ti=t[i];
        if(timeActive && (ti<tStart || ti>=tEnd))continue;
        const fText=folded[i];
        if(needleCount){
          let ok=true;
          for(let k=0;k<needleCount;k++){
            const nd=needles[k];
            if(!wordAt(fText,nd.needle,nd.bounded)){ok=false;break;}
          }
          if(!ok)continue;
        }
        const fl=flags[i];
        const sInfo=senderInfos[senderIdx[i]];
        if(!matchIgnoreMedia(fText,ti,fl,sInfo))continue;
        if(fl){
          if(fl & 1)mediaCounts.image++;
          if(fl & 2)mediaCounts.gif++;
          if(fl & 4)mediaCounts.link++;
          if(fl & 8)mediaCounts.video++;
          if(fl & 16)mediaCounts.audio++;
          if(fl & 32)mediaCounts.file++;
        }
        if(reqMask && (fl & reqMask)!==reqMask)continue;
        if(!matchFinal(fText,ti,fl,sInfo))continue;
        matchedIdx.push(i);
      }

      // Compute exact relevance scores when sort === 'relevant'.
      let scores=null;
      if(sort==='relevant' && matchedIdx.length){
        scores=new Map();
        const nonAscii=[];
        for(const idx of matchedIdx){
          const fText=folded[idx];
          if(/[^\x00-\x7f]/.test(fText))nonAscii.push(idx);
          else scores.set(idx,RCSCore.relevanceScore(fText,plan.parsed,{wholeWord}));
        }
        if(nonAscii.length){
          const tx=await this.transaction('msgs','readonly');
          const rawMsgs=await Promise.all(nonAscii.map(idx=>this._getMsg(tx,proj.a,room[idx],ids[idx])));
          for(let k=0;k<nonAscii.length;k++){
            const idx=nonAscii[k],raw=rawMsgs[k];
            scores.set(idx,RCSCore.relevanceScore(raw?.b || folded[idx],plan.parsed,{wholeWord}));
          }
        }
      }

      // Deterministic sort matching v1 tie-breakers: (score desc) -> (time desc/asc) -> roomId asc -> id asc.
      const dir=sort==='oldest'?1:-1;
      const rId=proj.roomIdByOrd;
      matchedIdx.sort((aIdx,bIdx)=>{
        if(scores){const ds=scores.get(bIdx)-scores.get(aIdx);if(ds)return ds;}
        const dt=dir*(t[aIdx]-t[bIdx]);if(dt)return dt;
        const ra=rId.get(room[aIdx]) || '',rb=rId.get(room[bIdx]) || '';
        const dr=ra.localeCompare(rb);if(dr)return dr;
        return ids[aIdx].localeCompare(ids[bIdx]);
      });

      const counts=new Map();
      for(const idx of matchedIdx){const rid=rId.get(room[idx]);counts.set(rid,(counts.get(rid) || 0)+1);}

      // Fetch ONLY the final page (<=500) of full message records by primary key!
      const pageIdx=matchedIdx.slice(offset,offset+limit);
      const txRead=pageIdx.length?await this.transaction('msgs','readonly'):null;
      const pageRaw=pageIdx.length?await Promise.all(pageIdx.map(idx=>this._getMsg(txRead,proj.a,room[idx],ids[idx]))):[];
      const idCache=new Map();
      const page=[];
      for(let k=0;k<pageIdx.length;k++){
        const msg=pageRaw[k];if(!msg)continue;
        page.push(this._materializeRecord(owner,rId.get(msg.n),msg,proj.people,directory,idCache));
      }

      const groups=[];
      if(grouped){
        const byRoom=new Map();
        for(const [id,total] of counts){const g={roomId:id,total,records:[]};byRoom.set(id,g);groups.push(g);}
        for(const rec of page)byRoom.get(rec.roomId)?.records.push(rec);
      }

      let coverage;
      if(roomId){
        const rm=proj.roomMeta.get(proj.roomOrdById.get(roomId));
        coverage=rm?.coverage || {complete:false,dateComplete:false};
      }else{
        let allComplete=counts.size>0;
        if(allComplete){
          for(const rid of counts.keys()){
            const rm=proj.roomMeta.get(proj.roomOrdById.get(rid));
            if(!rm?.coverage?.complete){allComplete=false;break;}
          }
        }
        coverage={complete:allComplete,unknownRooms:false,threadsVerified:false};
      }

      return {owner,selfIdentity:selfId,persistent:this.persistent,records:page,total:matchedIdx.length,hasMore:offset+limit<matchedIdx.length,matchedRooms:counts.size,mediaCounts,availableMediaTypes,...(grouped?{groups}:{}),stats:statsObj,coverage};
    }

    async _searchSingleRoom(owner,roomId,{query='',roomIds,dates={},from='all',wholeWord=false,sort='newest',grouped=false,limit=200,offset=0},directory){
      const tx=await this.transaction(['accounts','rooms','msgs','people'],'readonly');
      const acc=await this._getAccount(tx,owner);
      const mediaCounts=emptyMediaCounts();
      if(!acc){
        return {owner,selfIdentity:null,persistent:this.persistent,records:[],total:0,hasMore:false,matchedRooms:0,mediaCounts,availableMediaTypes:[],...(grouped?{groups:[]}:{}),stats:{messages:0,rooms:0,completeRooms:0,approxBytes:0},coverage:{complete:false,dateComplete:false}};
      }
      const a=acc.a;
      const [rm,selfPerson]=await Promise.all([this._getRoomById(tx,a,roomId),this._getPerson(tx,a,owner)]);
      const availableMediaTypes=MEDIA_TYPES.filter(type=>(acc.mediaTypeCounts?.[type] || 0)>0);
      const statsObj={messages:acc.stats?.messages || 0,rooms:acc.stats?.rooms || 0,completeRooms:acc.stats?.completeRooms || 0,approxBytes:acc.stats?.bytes || 0,...(acc.stats?.unknownEvents?{unknownEvents:acc.stats.unknownEvents}:{})};
      if(!rm || roomIds && !roomIds.includes(roomId)){
        return {owner,selfIdentity:identity(selfPerson),persistent:this.persistent,records:[],total:0,hasMore:false,matchedRooms:0,mediaCounts,availableMediaTypes,...(grouped?{groups:[]}:{}),stats:statsObj,coverage:rm?.coverage || {complete:false,dateComplete:false}};
      }
      const msgs=await this._getRoomMsgs(tx,a,rm.n);
      const senderIds=[...new Set(msgs.map(m=>m.u).filter(Boolean))];
      const peopleArr=await Promise.all(senderIds.map(id=>this._getPerson(tx,a,id)));
      const peopleMap=new Map();
      if(selfPerson)peopleMap.set(owner,selfPerson);
      for(let i=0;i<senderIds.length;i++)if(peopleArr[i])peopleMap.set(senderIds[i],peopleArr[i]);

      const plan=RCSCore.compilePlan(query,{from,wholeWord,dates});
      if(plan.invalid || plan.impossible){
        return {owner,selfIdentity:identity(selfPerson),persistent:this.persistent,records:[],total:0,hasMore:false,matchedRooms:0,mediaCounts,availableMediaTypes,...(grouped?{groups:[]}:{}),stats:statsObj,coverage:rm.coverage || {complete:false,dateComplete:false}};
      }
      const idCache=new Map(),matched=[];
      const senderInfoMap=new Map();
      for(const sid of senderIds){
        const person=mergeIdentity(peopleMap.get(sid) || {},{...(directory?.identities?.[sid] || {}),id:sid});
        const self=sid===owner;
        senderInfoMap.set(sid,{self,sender:sid,author:self?'You':person.name || sid,aliases:person.aliases || []});
      }
      for(const msg of msgs){
        if(!msg.b || msg.e?.startsWith('~') || msg.eb?.startsWith('~'))continue;
        const fText=foldFast(msg.b),ti=msg.t || 0,fl=msg.f || 0,sInfo=senderInfoMap.get(msg.u) || {self:msg.u===owner,sender:msg.u,author:msg.u,aliases:[]};
        if(!plan.matchIgnoreMedia(fText,ti,fl,sInfo))continue;
        if(fl){
          if(fl & 1)mediaCounts.image++;if(fl & 2)mediaCounts.gif++;if(fl & 4)mediaCounts.link++;
          if(fl & 8)mediaCounts.video++;if(fl & 16)mediaCounts.audio++;if(fl & 32)mediaCounts.file++;
        }
        if(plan.requiredMediaMask && (fl & plan.requiredMediaMask)!==plan.requiredMediaMask)continue;
        if(!plan.matchFinal(fText,ti,fl,sInfo))continue;
        matched.push(msg);
      }
      const scores=sort==='relevant'?new Map(matched.map(m=>[m,RCSCore.relevanceScore(m.b,plan.parsed,{wholeWord})])):null;
      const dir=sort==='oldest'?1:-1;
      matched.sort((x,y)=>(scores?scores.get(y)-scores.get(x):0) || dir*((x.t || 0)-(y.t || 0)) || x.e.localeCompare(y.e));
      const slice=matched.slice(offset,offset+limit);
      const records=slice.map(m=>this._materializeRecord(owner,roomId,m,peopleMap,directory,idCache));
      return {owner,selfIdentity:identity(selfPerson),persistent:this.persistent,records,total:matched.length,hasMore:offset+limit<matched.length,matchedRooms:matched.length?1:0,mediaCounts,availableMediaTypes,...(grouped?{groups:matched.length?[{roomId,total:matched.length,records}]:[]}:{}),stats:statsObj,coverage:rm.coverage || {complete:false,dateComplete:false}};
    }

    async room(owner,roomId,directory,{committed=false}={}) {
      if(!ownerOK(owner))throw Error('Invalid account');
      if(typeof roomId!=='string' || !roomId || roomId.length>1000)throw Error('Invalid room');
      if(!committed)await this.queue;
      if(this.legacy && await this.legacy.probe()){
        const acc=await this._readAccountQuick(owner);
        if(!acc || acc.migration?.state!=='done'){
          this.ensureMigration(owner).catch(()=>{});
          const v1Res=await this.legacy.searchV1(owner,{query:'',roomId,dates:{},limit:Infinity,offset:0},directory);
          if(v1Res)return v1Res;
        }
      }
      return this._searchSingleRoom(owner,roomId,{query:'',dates:{},limit:Infinity,offset:0},directory);
    }

    async summaries(owner,{committed=false}={}) {
      if(!ownerOK(owner))throw Error('Invalid account');
      if(!committed)await this.queue;
      const tx=await this.transaction(['accounts','rooms','people'],'readonly');
      const acc=await this._getAccount(tx,owner);
      if(!acc)return {owner,selfIdentity:null,persistent:this.persistent,summaries:[]};
      const [roomList,peopleList]=await Promise.all([this._getAllRooms(tx,acc.a),this._getAllPeople(tx,acc.a)]);
      const peopleMap=new Map(peopleList.map(p=>[p.id,p]));
      const summaries=[];
      for(const rm of roomList){
        const latest=rm.latest;if(!latest || !latest.b)continue;
        summaries.push({
          id:latest.e,roomId:rm.roomId,
          attachmentType:attachTypeFromFlags(latest.f || 0),
          attachmentMime:latest.m || '',
          attachmentPreview:latest.v || '',
          ...(latest.w && latest.h?{attachmentWidth:latest.w,attachmentHeight:latest.h}:{}),
          text:latest.b.slice(0,200),
          timestamp:latest.t?new Date(latest.t).toISOString():'',
          ...(latest.s!=null?{seq:latest.s}:{}),
          authorSelf:latest.u===owner,
          author:latest.u===owner?'You':peopleMap.get(latest.u)?.name || ''
        });
      }
      summaries.sort((a,b)=>(Date.parse(b.timestamp) || 0)-(Date.parse(a.timestamp) || 0) || a.roomId.localeCompare(b.roomId));
      return {owner,selfIdentity:identity(peopleMap.get(owner)),persistent:this.persistent,summaries};
    }

    // Backward-compatible inspection helper (never used in hot search/stats paths).
    async snapshot(owner,roomId,{committed=false}={}) {
      if(!ownerOK(owner))throw Error('Invalid account');
      if(!committed)await this.queue;
      const tx=await this.transaction(['accounts','rooms','msgs','rels','people'],'readonly');
      const acc=await this._getAccount(tx,owner);
      if(!acc)return {rows:[],people:{},identityBytes:0,nativeReconciledAt:0,nativeImportComplete:false};
      const a=acc.a;
      const roomList=roomId?[await this._getRoomById(tx,a,roomId)].filter(Boolean):await this._getAllRooms(tx,a);
      const peopleList=await this._getAllPeople(tx,a);
      const people={};let identityBytes=0;
      for(const p of peopleList){people[p.id]=p;identityBytes+=p.approxBytes ?? bytes(p);}
      const rows=[];
      for(const rm of roomList){
        const [msgs,rels]=await Promise.all([this._getRoomMsgs(tx,a,rm.n),this._getRoomRels(tx,a,rm.n)]);
        const events=[];
        for(const m of msgs){
          const orig=m.orig || {b:m.b,f:m.f,m:m.m,v:m.v,w:m.w,h:m.h,ds:m.ds};
          events.push({id:m.e,room:rm.roomId,type:'m.room.message',sender:m.u,time:m.t,body:orig.b || '',attachmentType:attachTypeFromFlags(orig.f || 0),attachmentMime:orig.m || '',...(orig.v?{attachmentPreview:orig.v}:{}),...(orig.w && orig.h?{attachmentWidth:orig.w,attachmentHeight:orig.h}:{}),replaces:'',thread:Boolean(m.th),threadRoot:m.th || '',redacts:'',redacted:false});
        }
        for(const r of rels){
          events.push({id:r.e,room:rm.roomId,type:r.k==='redact'?'m.room.redaction':'m.room.message',sender:r.u,time:r.t,body:r.x?'':(r.b || ''),attachmentType:r.x?'':attachTypeFromFlags(r.f || 0),attachmentMime:r.x?'':(r.m || ''),attachmentPreview:r.x?'':(r.v || ''),replaces:r.k==='edit'?r.target:'',thread:false,threadRoot:'',redacts:r.k==='redact'?r.target:'',redacted:Boolean(r.x)});
        }
        const records=msgs.filter(m=>m.b).map(m=>({id:m.e,bodyEvent:m.eb || m.e,sender:m.u,time:m.t,thread:Boolean(m.th),threadRoot:m.th || ''}));
        rows.push({owner,roomId:rm.roomId,events,records,coverage:rm.coverage || {complete:false,dateComplete:false},approxBytes:rm.approxBytes || 0});
      }
      return {rows,people,identityBytes,nativeReconciledAt:acc.nativeReconciledAt || 0,nativeImportComplete:Boolean(acc.nativeImportComplete)};
    }

    async importState(owner,mark=false) {
      if(!ownerOK(owner))throw Error('Invalid account');
      await this.queue;if(mark)this.writeEpoch++;
      const tx=await this.transaction(['accounts','meta'],mark?'readwrite':'readonly'),completion=tx && mark?done(tx):null;
      try{
        let acc=await this._getAccount(tx,owner);
        if(mark){
          acc ||= await this._ensureAccount(tx,owner);
          acc={...acc,nativeImportComplete:true,nativeReconciledAt:Date.now()};
          this._putAccount(tx,acc);
        }
        if(completion)await completion;
        const proj=this.projections.get(owner);if(proj && acc)proj.account=acc;
        return mark || Boolean(acc?.nativeImportComplete);
      }catch(error){try{tx?.abort();}catch{}await completion?.catch(()=>{});throw error;}
    }

    async stats(owner,{committed=false,includeOwners=false}={}) {
      if(owner && !ownerOK(owner))throw Error('Invalid account');
      if(!committed)await this.queue;
      const tx=await this.transaction('accounts','readonly');
      if(owner){
        const acc=await this._getAccount(tx,owner);
        const s=acc?.stats || {messages:0,rooms:0,completeRooms:0,bytes:0};
        return {owner,persistent:this.persistent,nativeImportComplete:Boolean(acc?.nativeImportComplete),nativeReconciledAt:acc?.nativeReconciledAt || 0,
          stats:{messages:s.messages || 0,rooms:s.rooms || 0,completeRooms:s.completeRooms || 0,approxBytes:s.bytes || 0,...(s.unknownEvents?{unknownEvents:s.unknownEvents}:{})}};
      }
      const all=tx?await request(tx.objectStore('accounts').getAll()):[...this.mem.accounts.values()];
      const active=all.filter(acc=>(acc.stats?.messages || 0)>0 || (acc.stats?.rooms || 0)>0 || (acc.stats?.bytes || 0)>0 || acc.nativeImportComplete);
      const totals={messages:0,rooms:0,completeRooms:0,approxBytes:0};
      for(const acc of active){
        totals.messages+=acc.stats?.messages || 0;
        totals.rooms+=acc.stats?.rooms || 0;
        totals.completeRooms+=acc.stats?.completeRooms || 0;
        totals.approxBytes+=acc.stats?.bytes || 0;
      }
      return {persistent:this.persistent,accounts:active.length,...(includeOwners?{owners:active.map(acc=>acc.owner)}:{}),stats:totals};
    }

    async clear(owner) {
      if(owner && !ownerOK(owner))throw Error('Invalid account');
      await this.queue;this.writeEpoch++;
      if(owner)this.projections.delete(owner);else this.projections.clear();
      const tx=await this.transaction(['accounts','rooms','msgs','rels','spans','people'],'readwrite'),completion=tx?done(tx):null;
      try{
        if(!owner){
          if(tx){
            for(const storeName of ['accounts','rooms','msgs','rels','spans','people'])tx.objectStore(storeName).clear();
          }else{
            for(const map of [this.mem.accounts,this.mem.rooms,this.mem.roomsById,this.mem.msgs,this.mem.rels,this.mem.relsByTarget,this.mem.spans,this.mem.people])map.clear();
          }
        }else{
          const acc=await this._getAccount(tx,owner);
          if(acc){
            const a=acc.a;
            if(tx){
              const delRange=(storeName,upper)=>tx.objectStore(storeName).delete(IDBKeyRange.bound([a],upper));
              delRange('rooms',[a,Number.MAX_SAFE_INTEGER]);
              delRange('msgs',[a,Number.MAX_SAFE_INTEGER,'\uffff']);
              delRange('rels',[a,Number.MAX_SAFE_INTEGER,'\uffff']);
              delRange('spans',[a,Number.MAX_SAFE_INTEGER,'\uffff',Number.MAX_SAFE_INTEGER]);
              delRange('people',[a,'\uffff']);
              tx.objectStore('accounts').delete(owner);
            }else{
              this.mem.accounts.delete(owner);
              for(const [k,v] of this.mem.rooms)if(v.a===a)this.mem.rooms.delete(k);
              for(const k of this.mem.roomsById.keys())if(k.startsWith(a+'\0'))this.mem.roomsById.delete(k);
              for(const [k,v] of this.mem.msgs)if(v.a===a)this.mem.msgs.delete(k);
              for(const [k,v] of this.mem.rels)if(v.a===a)this.mem.rels.delete(k);
              for(const k of this.mem.relsByTarget.keys())if(k.startsWith(a+'\0'))this.mem.relsByTarget.delete(k);
              for(const [k,v] of this.mem.spans)if(v.a===a)this.mem.spans.delete(k);
              for(const [k,v] of this.mem.people)if(v.a===a)this.mem.people.delete(k);
            }
          }
        }
        if(completion)await completion;
        if(this.legacy && await this.legacy.probe()){
          if(!owner)await this.legacy.closeAndDelete();
          else await this.legacy.clearOwner(owner);
        }
        if(this.onStatsDelta)this.onStatsDelta(owner?{reset:true}:{clearAll:true});
      }catch(error){try{tx?.abort();}catch{}await completion?.catch(()=>{});throw error;}
    }

    // --- Resumable v1 -> v2 Migration with Differential Verification (3.8) ---
    ensureMigration(owner,{batchEvents=500,onBatch}={}){
      if(!this.legacy)return Promise.resolve({migrated:false});
      const key=owner || '*';
      if(!this.migrationTasks.has(key)){
        const task=this._runMigration(owner,{batchEvents,onBatch}).finally(()=>{this.migrationTasks.delete(key);});
        this.migrationTasks.set(key,task);
      }
      return this.migrationTasks.get(key);
    }

    async _runMigration(targetOwner,{batchEvents=500,onBatch}={}){
      if(!await this.legacy.probe())return {migrated:false};
      const owners=targetOwner?[targetOwner]:await this.legacy.owners();
      if(!owners.length){await this.legacy.closeAndDelete();return {migrated:true,deletedV1:true};}

      for(const owner of owners){
        const res=await this._migrateSingleOwner(owner,{batchEvents,onBatch});
        if(!res.ok)return {migrated:false,error:res.error};
      }
      // Delete v1 ONLY once every owner in v1 has passed differential verification.
      const allLegacyOwners=await this.legacy.owners();
      let allDone=true;
      for(const o of allLegacyOwners){
        const acc=await this._readAccountQuick(o);
        if(acc?.migration?.state!=='done'){allDone=false;break;}
      }
      if(allDone){
        await this.legacy.closeAndDelete();
        return {migrated:true,deletedV1:true};
      }
      return {migrated:true,deletedV1:false};
    }

    async _migrateSingleOwner(owner,{batchEvents=500,onBatch}={}){
      try{
        let acc=await this._readAccountQuick(owner);
        if(acc?.migration?.state==='done')return {ok:true};

        // Step 1: Initialize account migration state and copy identities.
        const v1Id=await this.legacy.readIdentities(owner);
        let cursor=acc?.migration?.cursor || '';
        const initBatch=async()=>{
          const tx=await this.transaction(['accounts','people','meta'],'readwrite'),completion=done(tx);
          acc=await this._ensureAccount(tx,owner);
          if(!acc.migration || acc.migration.state==='done'){
            acc.migration={state:'running',cursor:''};
          }else{
            acc.migration={...acc.migration,state:'running'};
          }
          if(v1Id?.nativeImportComplete){acc.nativeImportComplete=true;acc.nativeReconciledAt=v1Id.nativeReconciledAt || acc.nativeReconciledAt || Date.now();}
          let deltaBytes=0;
          for(const raw of Object.values(v1Id?.people || {})){
            const p=identity(raw);if(!p)continue;
            const prev=await this._getPerson(tx,acc.a,p.id);
            const merged=mergeIdentity(prev,p);
            const nextRec={a:acc.a,...merged};
            const prevB=prev?(prev.approxBytes ?? bytes(prev)):0;
            nextRec.approxBytes=bytes(nextRec);
            if(!prev || prevB!==nextRec.approxBytes){
              deltaBytes+=nextRec.approxBytes-prevB;
              this._putPerson(tx,nextRec);
            }
          }
          acc.stats={...acc.stats,bytes:Math.max(0,(acc.stats?.bytes || 0)+deltaBytes)};
          this._putAccount(tx,acc);
          await completion;
          cursor=acc.migration.cursor || '';
        };
        await this.queue.then(initBatch);

        // Step 2: Walk v1 rooms resumable by cursor, exploding events in <=batchEvents chunks.
        while(true){
          const {rows,done:eof}=await this.legacy.readRoomBatch(owner,cursor,20);
          if(!rows.length)break;
          for(const row of rows){
            const rawEvents=(row.events || []).filter(e=>e?.id && !e.id.startsWith('~')).map(e=>({
              event_id:e.id,room_id:row.roomId,type:e.type,sender:e.sender,origin_server_ts:e.time,
              content:{
                body:e.body,
                ...(e.attachmentType && e.type!=='m.sticker'?{msgtype:'m.'+e.attachmentType}:{}),
                ...(e.attachmentMime || e.attachmentWidth?{info:{...(e.attachmentMime?{mimetype:e.attachmentMime}:{}),...(e.attachmentWidth?{w:e.attachmentWidth,h:e.attachmentHeight}:{})}}:{}),
                ...(e.attachmentPreview?{rcs_preview_url:e.attachmentPreview}:{}),
                ...(e.replaces?{'m.new_content':{body:e.body,...(e.attachmentType?{msgtype:'m.'+e.attachmentType}:{}),...(e.attachmentMime || e.attachmentWidth?{info:{...(e.attachmentMime?{mimetype:e.attachmentMime}:{}),...(e.attachmentWidth?{w:e.attachmentWidth,h:e.attachmentHeight}:{})}}:{}),...(e.attachmentPreview?{rcs_preview_url:e.attachmentPreview}:{})},'m.relates_to':{rel_type:'m.replace',event_id:e.replaces}}:{}),
                ...(e.thread && e.threadRoot?{'m.relates_to':{rel_type:'m.thread',event_id:e.threadRoot}}:{}),
                ...(e.redacts?{redacts:e.redacts}:{})
              },
              ...(e.redacts?{redacts:e.redacts}:{}),
              ...(e.redacted?{unsigned:{redacted_because:{event_id:'$v1'}}}:{})
            }));
            for(let off=0;off<Math.max(1,rawEvents.length);off+=batchEvents){
              const slice=rawEvents.slice(off,off+batchEvents);
              await this.ingest({owner,roomId:row.roomId,events:slice,_internalMigration:true});
              onBatch?.({owner,roomId:row.roomId,offset:off,count:slice.length});
            }
            // Mark legacyComplete (never a verified span!) and advance durable cursor atomically.
            await this.queue.then(async()=>{
              const tx=await this.transaction(['accounts','rooms'],'readwrite'),completion=done(tx);
              const latestAcc=await this._getAccount(tx,owner);
              if(row.coverage?.complete===true){
                const rm=await this._getRoomById(tx,latestAcc.a,row.roomId);
                if(rm){
                  const prevComplete=rm.coverage?.complete?1:0;
                  rm.legacyComplete={at:Date.now()};
                  rm.coverage={complete:false,dateComplete:false,dates:{from:'',to:''}};
                  this._putRoom(tx,rm);
                  if(prevComplete)latestAcc.stats.completeRooms=Math.max(0,(latestAcc.stats.completeRooms || 0)-1);
                }
              }
              latestAcc.migration={state:'running',cursor:row.roomId};
              this._putAccount(tx,latestAcc);
              await completion;
              this.projections.delete(owner);
            });
            cursor=row.roomId;
          }
          if(eof)break;
        }

        // Step 3: Differential check (20 fixed queries comparing v1 vs v2 totals and ids).
        const checks=[
          {query:''},{query:'',sort:'oldest'},{query:'',from:'me'},{query:'',from:'them'},
          {query:'has:image'},{query:'has:gif'},{query:'has:link'},{query:'has:video'},{query:'has:audio'},{query:'has:file'},
          {query:'from:me'},{query:'from:them'},{query:'a'},{query:'the'},{query:'hello'},
          {query:'test OR hello'},{query:'-zzz_nonexistent'},{query:'a',wholeWord:true},{query:'',dates:{from:'2020-01-01',to:'2030-12-31'}},{query:'',sort:'relevant'}
        ];
        // Temporarily query v2 directly bypassing legacy fallback.
        await this.queue.then(async()=>{
          const tx=await this.transaction('accounts','readwrite'),completion=done(tx);
          const aRec=await this._getAccount(tx,owner);
          aRec.migration={state:'verifying',cursor};
          this._putAccount(tx,aRec);await completion;
        });
        this.projections.delete(owner);
        const savedLegacy=this.legacy;
        this.legacy=null;
        let verified=true;
        try{
          for(const q of checks){
            const [r1,r2]=await Promise.all([savedLegacy.searchV1(owner,{...q,limit:500,offset:0}),this.search(owner,{...q,limit:500,offset:0,committed:true})]);
            if(!r1)continue;
            if(r1.total!==r2.total || r1.records.length!==r2.records.length || r1.records.some((rec,i)=>rec.id!==r2.records[i]?.id || rec.roomId!==r2.records[i]?.roomId)){
              verified=false;break;
            }
          }
        }finally{this.legacy=savedLegacy;}

        if(!verified)throw Error('Differential migration check mismatch');
        await this.queue.then(async()=>{
          const tx=await this.transaction('accounts','readwrite'),completion=done(tx);
          const aRec=await this._getAccount(tx,owner);
          aRec.migration={state:'done',cursor:''};
          this._putAccount(tx,aRec);await completion;
          const proj=this.projections.get(owner);if(proj)proj.account=aRec;
        });
        return {ok:true};
      }catch(error){
        try{
          await this.queue.then(async()=>{
            const tx=await this.transaction('accounts','readwrite'),completion=done(tx);
            const aRec=await this._getAccount(tx,owner);
            if(aRec){aRec.migration={...(aRec.migration || {}),state:'failed',error:error.message};this._putAccount(tx,aRec);}
            await completion;
          });
        }catch{}
        return {ok:false,error:error.message};
      }
    }
  }

  globalThis.RCSMessageStore=Object.freeze({Store,compact,reduce,ownerOK,previewURL,parseSeq,isUnknownEvent,mergeSpanList,MEDIA_BITS});
})();
