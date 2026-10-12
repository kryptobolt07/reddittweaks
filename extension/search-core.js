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
  function parseQuery(query='') {
    const parsed={terms:[],phrases:[],from:[],after:[],before:[],hasLink:false,hasImage:false,hasFile:false,invalid:false,errors:[]};
    const tokens=String(query).match(/(?:[^\s"]*"[^"]*"|[^\s"]+)/g) || [];
    for(const token of tokens){
      const operator=token.match(/^(from|after|before|has):(.*)$/i);
      if(operator){const key=operator[1].toLowerCase(),value=operator[2].replace(/^"|"$/g,'');
        if(key==='has'){const kind=normalize(value);if(kind==='link')parsed.hasLink=true;else if(kind==='image')parsed.hasImage=true;else if(kind==='file')parsed.hasFile=true;else parsed.errors.push('Use has:link, has:image or has:file');}
        else if(key==='from'){if(value)parsed.from.push(normalize(value));else parsed.errors.push('Add a sender after from:');}
        else {if(!value || dateBounds({from:value}).invalid)parsed.errors.push('Use a valid YYYY-MM-DD date');parsed[key].push(value);}
      }else if(token.startsWith('"') && token.endsWith('"')){if(token.length>2)parsed.phrases.push(token.slice(1,-1));}
      else parsed.terms.push(token.replace(/"/g,''));
    }
    parsed.invalid=parsed.errors.length>0;return parsed;
  }
  const wordCharacter=char=>Boolean(char && /[\p{L}\p{N}_]/u.test(char));
  const beforeCharacter=(text,index)=>{const last=text.charCodeAt(index-1);return last>=0xdc00 && last<=0xdfff?text.slice(index-2,index):text[index-1];};
  const wordBoundary=(text,start,end)=>!wordCharacter(beforeCharacter(text,start)) && !wordCharacter(String.fromCodePoint(text.codePointAt(end) ?? 0));
  let segmenter;
  function foldedText(text){
    const original=String(text ?? '');
    // ASCII offsets never change: avoid thousands of grapheme objects and maps
    // for the usual chat messages and long links.
    if(!/[^\x00-\x7f]/.test(original))return {value:original.toLowerCase(),starts:null,ends:null};
    const starts=[],ends=[];let value='';
    const append=(segment,index)=>{const folded=segment.normalize('NFKC').toLocaleLowerCase();value+=folded;for(let i=0;i<folded.length;i++){starts.push(index);ends.push(index+segment.length);}};
    if(typeof Intl.Segmenter==='function'){
      segmenter ||= new Intl.Segmenter(undefined,{granularity:'grapheme'});
      for(const item of segmenter.segment(original))append(item.segment,item.index);
    }else{let index=0;for(const char of original){append(char,index);index+=char.length;}}
    return {value,starts,ends};
  }
  const needlesFor=parsed=>[...parsed.terms,...parsed.phrases].map(normalize).filter(Boolean);
  function queryRanges(text,needles,{wholeWord=false}={}){
    if(!needles.length)return {ranges:[],complete:true};
    const mapped=foldedText(text),found=[];let complete=true;
    for(const term of needles){let offset=0,matched=false;
      while((offset=mapped.value.indexOf(term,offset))!==-1){const end=offset+term.length;
        if(!wholeWord || wordBoundary(mapped.value,offset,end)){found.push([mapped.starts?mapped.starts[offset]:offset,mapped.ends?mapped.ends[end-1]:end]);matched=true;}
        offset=end;
      }
      if(!matched)complete=false;
    }
    found.sort((a,b)=>a[0]-b[0]);
    const ranges=found.reduce((all,next)=>{const last=all.at(-1);if(last && next[0]<=last[1])last[1]=Math.max(last[1],next[1]);else all.push(next);return all;},[]);
    return {ranges,complete};
  }
  function prepareQuery(query='',{from='all',wholeWord=false,dates={}}={},conversation={}){
    const parsed=typeof query==='object'?query:parseQuery(query),bounds=dateBounds(dates),needles=needlesFor(parsed);
    const start=Math.max(bounds.start,...parsed.after.map(date=>dateBounds({from:date}).start)),end=Math.min(bounds.end,...parsed.before.map(date=>dateBounds({from:date}).start));
    const dated=bounds.active || parsed.after.length>0 || parsed.before.length>0;
    if(parsed.invalid || bounds.invalid)return ()=>false;
    return record=>{
      const self=typeof record.authorSelf==='boolean'?record.authorSelf:record.sender==='me' || Boolean(conversation.owner && record.sender===conversation.owner) || normalize(record.author)==='you';
      if(from==='me' && !self || from==='them' && self)return false;
      // Multiple sender selections are alternatives; text and other filters
      // still narrow those senders together.
      if(parsed.from.length && !parsed.from.some(sender=>sender==='me'?self:sender==='them'?!self:!self && (matches(record.author || record.sender,sender) || !record.author && matches(conversation.name,sender))))return false;
      if(dated){const time=typeof record.timestamp==='number'?record.timestamp:new Date(record.timestamp ?? record.at).getTime();if(!(Number.isFinite(time) && time>=start && time<end))return false;}
      const text=String(record.text || '');
      if(parsed.hasLink && !/\b(?:https?:\/\/|www\.)\S+/i.test(text) || parsed.hasImage && record.attachmentType!=='image' || parsed.hasFile && record.attachmentType!=='file')return false;
      if(!needles.length)return true;
      // Keep normalization identical to highlighting. Sender normalization
      // strips u/ and whitespace, but message bodies must retain them.
      const folded=/[^\x00-\x7f]/.test(text)?foldedText(text).value:text.toLowerCase();
      return needles.every(term=>{let offset=0;while((offset=folded.indexOf(term,offset))!==-1){const end=offset+term.length;if(!wholeWord || wordBoundary(folded,offset,end))return true;offset=end;}return false;});
    };
  }
  function matchesQuery(record,query='',options={},conversation={}){return prepareQuery(query,options,conversation)(record);}
  function highlightRanges(text,query='',options={}){const parsed=typeof query==='object'?query:parseQuery(query);return queryRanges(text,needlesFor(parsed),options).ranges;}
  function excerpt(text,query='',{wholeWord=false,max=160}={}){
    text=String(text ?? '');const found=highlightRanges(text,query,{wholeWord}),first=found[0] || [0,0];
    max=Number.isFinite(max)?Math.max(20,max):160;
    let start=Math.max(0,first[0]-Math.floor(max/3)),end=Math.min(text.length,Math.max(start+max,first[1]));
    if(end===text.length)start=Math.max(0,Math.min(first[0],end-max));
    if(start && start<first[0]){const space=text.indexOf(' ',start);if(space!==-1 && space<first[0])start=space+1;}
    const prefix=start?'…':'',suffix=end<text.length?'…':'';
    return {text:prefix+text.slice(start,end)+suffix,ranges:found.filter(([a,b])=>b>start && a<end).map(([a,b])=>[Math.max(a,start)-start+prefix.length,Math.min(b,end)-start+prefix.length])};
  }
  function compactTime(timestamp,now=Date.now()){
    const date=new Date(timestamp),today=new Date(now);if(!Number.isFinite(date.getTime()))return '';
    const midnight=value=>new Date(value.getFullYear(),value.getMonth(),value.getDate()).getTime(),age=Math.round((midnight(today)-midnight(date))/86400000);
    if(age===0)return date.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});
    if(age===1)return 'Yesterday';if(age>1 && age<7)return date.toLocaleDateString(undefined,{weekday:'short'});
    return date.toLocaleDateString(undefined,{month:'short',day:'numeric',...(date.getFullYear()!==today.getFullYear()?{year:'numeric'}:{})});
  }
  function dayKey(timestamp){
    const date=new Date(timestamp);if(!Number.isFinite(date.getTime()))return '';
    return `${date.getFullYear()}-${date.getMonth()+1}-${date.getDate()}`;
  }
  function dayLabel(timestamp,now=Date.now()){
    const date=new Date(timestamp),today=new Date(now);if(!Number.isFinite(date.getTime()))return 'Date unavailable';
    const midnight=value=>Date.UTC(value.getFullYear(),value.getMonth(),value.getDate()),age=(midnight(today)-midnight(date))/86400000;
    if(age===0)return 'Today';if(age===1)return 'Yesterday';
    if(age>1 && age<7 && date.getFullYear()===today.getFullYear())return date.toLocaleDateString(undefined,{weekday:'long'});
    return date.toLocaleDateString(undefined,{month:'short',day:'numeric',...(date.getFullYear()!==today.getFullYear()?{year:'numeric'}:{})});
  }
  function messageTime(timestamp,{sort='newest',now=Date.now()}={}){
    const date=new Date(timestamp);if(!Number.isFinite(date.getTime()))return '';
    const time=date.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});
    return sort==='relevant'?`${dayLabel(timestamp,now)}, ${time}`:time;
  }
  function fullTimestamp(timestamp){
    const date=new Date(timestamp);return Number.isFinite(date.getTime())?date.toLocaleString(undefined,{weekday:'short',year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'Date unavailable';
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
    search(room, query,dates={},options={}) {
      const match=prepareQuery(query,{...options,dates});
      return [...(this.rooms.get(room)?.values() ?? [])].filter(match);
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
  globalThis.RCSCore = Object.freeze({normalize, matches, ranges, dateBounds, parseQuery, prepareQuery, matchesQuery, highlightRanges, excerpt, compactTime, dayKey, dayLabel, messageTime, fullTimestamp, MessageIndex});
})();
