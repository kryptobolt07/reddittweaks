/* Search stays in the content-script isolated world and never leaves this tab. */
(() => {
  const normalize = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase().replace(/^u\//, '').trim();
  const matches = (text, query) => normalize(query).split(/\s+/).filter(Boolean).every(word => normalize(text).includes(word));
  const ranges = (text, query) => {
    // Keep offsets in the original string, including Unicode characters whose case expands.
    const terms = String(query).trim().split(/\s+/).filter(Boolean);
    const found = [];
    for (const term of terms) {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      for (const match of String(text).matchAll(new RegExp(escaped, 'giu'))) found.push([match.index, match.index + match[0].length]);
    }
    found.sort((a, b) => a[0] - b[0]);
    return found.reduce((all, next) => {
      const last = all.at(-1);
      if (last && next[0] <= last[1]) last[1] = Math.max(last[1], next[1]);
      else all.push(next);
      return all;
    }, []);
  };
  function dateBounds({from='',to=''}={}) {
    const day=value=>{
      if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
      const [y,m,d]=value.split('-').map(Number),date=new Date(y,m-1,d);
      return date.getFullYear()===y && date.getMonth()===m-1 && date.getDate()===d ? date : null;
    };
    const first=from?day(from):null,last=to?day(to):null;
    const invalid=Boolean(from&&!first || to&&!last || first&&last&&first>last);
    if(last)last.setDate(last.getDate()+1);
    return {start:first?.getTime()??-Infinity,end:last?.getTime()??Infinity,active:Boolean(from||to),invalid};
  }
  class MessageIndex {
    constructor(limit = 5000,onEvict=()=>{}) { this.limit = limit; this.rooms = new Map();this.redacted=new Map();this.metadata=new Map();this.onEvict=onEvict; }
    upsert(room, messages,{dom=false,authoritative=false,redacted=[]}={}) {
      if(dom)messages=messages.filter(message=>!message.provisional);
      if (!this.rooms.has(room)){this.rooms.set(room,new Map());this.metadata.set(room,{complete:false});}
      const index = this.rooms.get(room);
      if(!this.redacted.has(room))this.redacted.set(room,new Set());
      const removed=this.redacted.get(room);
      for(const id of redacted){removed.add(id);index.delete(id);}
      const named=author=>typeof author==='string' && author.trim() && !author.startsWith('@') && !['[deleted]','Someone','Unknown sender','Message'].includes(author);
      const speakers=new Map();
      for(const message of [...index.values(),...messages])if(message.sender) {
        const previous=speakers.get(message.sender) || {};
        speakers.set(message.sender,{...previous,...(named(message.author)?{author:message.author,authorHistorical:message.authorHistorical,authorUnavailable:message.authorUnavailable}:{}),authorSelf:message.authorSelf ?? previous.authorSelf,avatar:message.avatar || previous.avatar || ''});
      }
      for (const message of messages) if (message.id && message.text) {
        if(removed.has(message.id))continue;
        const previous=index.get(message.id);
        const sameSender=!message.sender || !previous?.sender || message.sender===previous.sender;
        const preserveHistorical=sameSender && previous?.authorHistorical && (!message.author || ['[deleted]','Someone'].includes(message.author));
        const preserveNamed=sameSender && named(previous?.author) && !named(message.author);
        const speaker=speakers.get(message.sender || previous?.sender),identity=preserveHistorical || preserveNamed ? previous : !named(message.author) && named(speaker?.author) ? speaker : message;
        const authorSelf=message.authorSelf ?? (sameSender ? previous?.authorSelf : undefined) ?? speaker?.authorSelf;
        const preserveBody=dom && previous?.authoritative;
        index.set(message.id,{...previous,...message,text:preserveBody ? previous.text : message.text,
          author:authorSelf ? 'You' : identity.author || message.author || (sameSender ? previous?.author : '') || '',authorSelf,
          authorHistorical:identity.authorHistorical ?? message.authorHistorical ?? (sameSender ? previous?.authorHistorical : undefined),
          authorUnavailable:message.authorUnavailable ?? identity.authorUnavailable ?? (sameSender ? previous?.authorUnavailable : undefined),
          sender:message.sender || previous?.sender,thread:message.thread ?? previous?.thread,
          avatar:message.avatar || (sameSender ? previous?.avatar : '') || speaker?.avatar || '',
          timestamp:preserveBody ? previous.timestamp : message.timestamp || previous?.timestamp || '',
          authoritative:authoritative || Boolean(previous?.authoritative)});
      }
      while (index.size > this.limit) index.delete(index.keys().next().value);
      // Keep no more than 20 conversations in memory.
      while (this.rooms.size > 20) {
        const oldest=this.rooms.keys().next().value;this.rooms.delete(oldest);this.redacted.delete(oldest);this.metadata.delete(oldest);this.onEvict(oldest);
      }
    }
    search(room, query,dates={}) {
      const bounds=dateBounds(dates);if(bounds.invalid)return [];
      return [...(this.rooms.get(room)?.values() ?? [])].filter(message=>{
        if(!bounds.active)return matches(message.text,query);
        const time=new Date(message.timestamp).getTime();
        return (!bounds.active || Number.isFinite(time)&&time>=bounds.start&&time<bounds.end) && matches(message.text,query);
      });
    }
    replace(room,messages,metadata={}) {
      const previous=this.rooms.get(room);this.rooms.delete(room);if(previous)this.rooms.set(room,previous);
      this.upsert(room,messages,{authoritative:true,redacted:metadata.redacted || []});
      const ids=new Set(messages.filter(message=>message.id && message.text).map(message=>message.id));
      for(const id of this.rooms.get(room).keys())if(!ids.has(id))this.rooms.get(room).delete(id);
      this.metadata.set(room,{complete:metadata.complete!==false});
    }
    clear() { this.rooms.clear();this.redacted.clear();this.metadata.clear(); }
  }
  globalThis.RCSCore = Object.freeze({normalize, matches, ranges, dateBounds, MessageIndex});
})();
