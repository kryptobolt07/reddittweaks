/* Pure state and matching shared by the global search interface. */
(() => {
  'use strict';
  const core = () => globalThis.RCSCore;
  const mediaTypes = Object.freeze(['image','file','video','gif','audio','link']);
  const mediaLabels = {image:'Images',file:'Files',video:'Videos',gif:'GIFs',audio:'Audio',link:'Links'};
  const senderValue = value => {
    value=String(value ?? '').trim();
    if(value.startsWith('"') && value.endsWith('"'))value=value.slice(1,-1);
    return value && !/[":\r\n]/.test(value) ? value : '';
  };
  const senderToken = value => 'from:'+(/\s/.test(value)?'"'+value+'"':value);

  class QueryState {
    constructor(){this.applied=new Map();}
    get filters(){return [...this.applied.values()].map(item=>({...item}));}
    apply(kind,value){
      kind=String(kind).toLowerCase();
      if(kind==='from'){
        value=senderValue(value);if(!value)return null;
        const key='from:'+core().normalize(value),item={key,kind,value,label:'From '+(key==='from:me'?'you':key==='from:them'?'other people':value),token:senderToken(value)};
        if(!this.applied.has(key))this.applied.set(key,item);
        return {...this.applied.get(key)};
      }
      if(kind==='has'){
        value=core().normalize(value).replace(/s$/,'');if(!mediaTypes.includes(value))return null;
        for(const [key,item] of this.applied)if(item.kind==='has')this.applied.delete(key);
        const key='has:'+value,item={key,kind,value,label:mediaLabels[value],token:key};
        this.applied.set(key,item);return {...item};
      }
      if(kind==='before' || kind==='after'){
        value=String(value ?? '').trim();if(!value || core().dateBounds({from:value}).invalid)return null;
        const key=kind+':'+value,label=(kind==='before'?'Before ':'On or after ')+core().dayLabel(value+'T12:00:00'),item={key,kind,value,label,token:key};
        this.applied.set(key,item);return {...item};
      }
      return null;
    }
    remove(key){return this.applied.delete(key);}
    clear(){this.applied.clear();}
    ingestDraft(draft,{commit=false}={}){
      draft=String(draft ?? '');let output='',start=0,index=0;
      // Scan complete tokens without touching whitespace or quoted text in the draft.
      while(index<draft.length){
        if(/\s/.test(draft[index])){index++;continue;}
        const tokenStart=index;let quoted=false;
        while(index<draft.length){const char=draft[index];if(char==='"')quoted=!quoted;if(!quoted && /\s/.test(char))break;index++;}
        const token=draft.slice(tokenStart,index),operator=token.match(/^(from|has|before|after):(.*)$/i);
        if(!operator || quoted)continue;
        const kind=operator[1].toLowerCase(),value=operator[2];
        const complete=index<draft.length || commit || kind==='has' && mediaTypes.includes(core().normalize(value).replace(/s$/,'')) || (kind==='before' || kind==='after') && value && !core().dateBounds({from:value}).invalid;
        if(complete && this.apply(kind,value)){output+=draft.slice(start,tokenStart);start=index;}
      }
      return output+draft.slice(start);
    }
    query(draft=''){
      const tokens=this.filters.map(item=>item.token).join(' '),text=String(draft ?? '');
      return tokens ? tokens+(text?' '+text:'') : text;
    }
  }
  const timestamp = record => typeof record?.timestamp==='number'?record.timestamp:Date.parse(record?.timestamp || '') || 0;
  const direct = record => ['direct','reddit_titled_direct'].includes(record.type)
    || (!record.type || record.type==='request') && (record.participantIds?.length || record.participants?.length || 0)<=1;
  const request = record => record.membership==='invite' || /request|invite|pending/i.test(record.status || '') || record.type==='request';
  const unread = record => record.unread===true || record.isUnread===true || Number(record.unreadCount)>0;
  function legacyRoomAllowed(record,filter){
    if(typeof filter==='function')return filter(record);
    const nativeDirect=['direct','reddit_titled_direct'].includes(record.type);
    return !filter || filter==='all' || filter==='unread' && unread(record)
      || filter==='groups' && !nativeDirect && !request(record) || filter==='requests' && request(record)
      || filter==='direct' && nativeDirect && !request(record) || filter==='unavailable' && record.accountUnavailable;
  }
  function roomAllowed(record,{chatType='all',status='all'}={}){
    return (chatType==='all' || chatType==='direct' && direct(record) || chatType==='groups' && !direct(record))
      && (status==='all' || status==='unread' && unread(record) || status==='requests' && request(record) || status==='unavailable' && Boolean(record.accountUnavailable));
  }
  const recordList = records => records && typeof records.values==='function' && !Array.isArray(records)?[...records.values()]:[...records || []];
  function peoplePredicate(draft,{wholeWord=false}={}){
    const parsed=core().parseQuery(draft);
    // These operators describe messages; People and All use the same name query.
    if(parsed.invalid || parsed.from.length || parsed.after.length || parsed.before.length || mediaTypes.some(type=>parsed['has'+type[0].toUpperCase()+type.slice(1)]))return ()=>false;
    const predicate=core().prepareQuery(parsed,{wholeWord,shortTermsWholeWord:false});
    return record=>predicate({text:[record.name,...record.participants || [],...record.aliases || [],...(record.accountUnavailable?[record.accountState==='banned' ? 'banned suspended unavailable retained username' : 'deleted unavailable retained username']:[])].join(' ')});
  }
  function chatFilterCounts(records,draft='',{chatType='all',status='all',wholeWord=false}={}){
    const counts={types:{all:0,direct:0,groups:0},statuses:{all:0,unread:0,requests:0,unavailable:0}};
    const matches=peoplePredicate(draft,{wholeWord});
    for(const record of recordList(records)){
      if(!matches(record))continue;
      for(const type of Object.keys(counts.types))if(roomAllowed(record,{chatType:type,status}))counts.types[type]++;
      for(const state of Object.keys(counts.statuses))if(roomAllowed(record,{chatType,status:state}))counts.statuses[state]++;
    }
    return counts;
  }
  function matchPeople(records,draft='',{filter='all',chatType='all',status='all',sort='newest',wholeWord=false}={}){
    const matches=peoplePredicate(draft,{wholeWord});
    const newest=(a,b)=>timestamp(b)-timestamp(a);
    const compare=typeof sort==='function'?sort:sort==='oldest'?(a,b)=>timestamp(a)-timestamp(b)
      :sort==='alphabetical'?(a,b)=>String(a.name || '').localeCompare(String(b.name || ''),undefined,{sensitivity:'base'}) || newest(a,b)
      :sort==='unread'?(a,b)=>Number(unread(b))-Number(unread(a)) || newest(a,b):newest;
    return recordList(records).filter(record=>legacyRoomAllowed(record,filter) && roomAllowed(record,{chatType,status}) && matches(record)).sort(compare);
  }
  globalThis.RCSGlobalSearchModel=Object.freeze({QueryState,matchPeople,roomAllowed,chatFilterCounts,mediaTypes});
})();
