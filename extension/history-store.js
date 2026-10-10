/* Raw events and cursors live only in this page, never in extension storage. */
(() => {
  class HistoryStore {
    constructor(limit=20,onEvict=()=>{}) {this.limit=limit;this.onEvict=onEvict;this.rooms=new Map();}
    get(owner,roomId,create=true) {
      const key=owner+'\n'+roomId;
      let room=this.rooms.get(key);
      if(!room && create)room={owner,roomId,events:new Map(),scopes:new Map(),removed:new Set(),edits:new Map(),roots:new Map(),threadReplies:new Map(),dirtyThreads:new Set(),loading:null,complete:false};
      if(!room)return;
      if(create){this.rooms.delete(key);this.rooms.set(key,room);this.trim();}
      return room;
    }
    trim() {
      while(this.rooms.size>this.limit) {
        const candidate=[...this.rooms].find(([,room])=>!room.loading);
        if(!candidate)return;
        this.rooms.delete(candidate[0]);this.onEvict(candidate[1]);
      }
    }
    scope(room,parent='') {
      if(!room.scopes.has(parent))room.scopes.set(parent,{cursor:null,done:false,verifiedIds:new Set(),headVerified:false,coveredStart:Infinity,dateOrderSafe:true});
      return room.scopes.get(parent);
    }
    accept(room,event) {
      if(!event?.event_id)return [];
      room.events.set(event.event_id,event);
      const changed=new Set([event.event_id]);
      if(event.type==='m.room.redaction') {
        const id=event.redacts || event.content?.redacts;
        if(id){room.removed.add(id);changed.add(id);}
      }
      const relation=event.content?.['m.relates_to'];
      if(relation?.rel_type==='m.thread' && relation.event_id) {
        if(!room.threadReplies.has(relation.event_id))room.threadReplies.set(relation.event_id,new Set());
        room.threadReplies.get(relation.event_id).add(event.event_id);
      }
      if(relation?.rel_type==='m.replace' && relation.event_id) {
        if(!room.edits.has(relation.event_id))room.edits.set(relation.event_id,new Map());
        room.edits.get(relation.event_id).set(event.event_id,event);changed.add(relation.event_id);
      }
      const count=event.unsigned?.['m.relations']?.['m.thread']?.count;
      if(count>0 && event.seq_id!==undefined) {
        const parent=String(event.seq_id);
        room.roots.set(parent,{id:event.event_id,count});
        const replies=room.threadReplies.get(event.event_id)?.size || 0;
        if(replies<count)room.dirtyThreads.add(parent);
      }
      if(relation?.rel_type==='m.thread')for(const [parent,root]of room.roots)if(root.id===relation.event_id) {
        const replies=room.threadReplies.get(root.id)?.size || 0;
        if(replies>=root.count)room.dirtyThreads.delete(parent);
      }
      this.readiness(room);return [...changed];
    }
    readiness(room) {
      room.complete=Boolean(room.scopes.get('')?.done) && [...room.roots.keys()].every(parent=>room.scopes.get(parent)?.done) && !room.dirtyThreads.size;
      return room.complete;
    }
    project(room,resolve,ids) {
      const events=ids ? ids.map(id=>room.events.get(id)).filter(Boolean) : [...room.events.values()];
      return events.filter(event=>['m.room.message','m.sticker'].includes(event.type) && !room.removed.has(event.event_id) && !event.unsigned?.redacted_because && event.content?.['m.relates_to']?.rel_type!=='m.replace').map(event=>{
        let edit;
        for(const candidate of room.edits.get(event.event_id)?.values() || [])if(!room.removed.has(candidate.event_id)&&!candidate.unsigned?.redacted_because&&(!edit||(candidate.origin_server_ts||0)>(edit.origin_server_ts||0)))edit=candidate;
        const content=edit?.content?.['m.new_content'] || event.content || {},person=resolve(event.sender);
        return {id:event.event_id,text:typeof content.body==='string' ? content.body : event.type==='m.sticker'?'Sticker':'',author:person.name || event.sender,
          authorSelf:Boolean(person.self),authorHistorical:Boolean(person.historical),authorUnavailable:Boolean(person.unavailable),avatar:person.avatar || '',sender:event.sender,
          timestamp:event.origin_server_ts?new Date(event.origin_server_ts).toISOString():'',
          thread:event.content?.['m.relates_to']?.rel_type==='m.thread',roomId:room.roomId};
      }).filter(message=>message.text).sort((a,b)=>a.timestamp.localeCompare(b.timestamp));
    }
    clear(){this.rooms.clear();}
  }
  globalThis.RCSHistoryStore=HistoryStore;
})();
