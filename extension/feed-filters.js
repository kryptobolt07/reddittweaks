/* Shared feed filters (date, post type, subreddit, extra sort) for profile and subreddit archive feeds.
   Pure state, URL sync, predicate, and menu/chip builders; no page logic lives here. */
(() => {
  'use strict';
  const params={date:'rt_date',types:'rt_type',subreddits:'rt_sub',sort:'rt_sort'};
  const types=Object.freeze(['text','image','video','gallery','link','crosspost']);
  const typeLabels=Object.freeze({text:'Text',image:'Image',video:'Video',gallery:'Gallery',link:'Link',crosspost:'Crosspost'});
  const presets=Object.freeze([{id:'24h',label:'Past 24 hours',seconds:86400},{id:'week',label:'Past week',seconds:604800},{id:'month',label:'Past month',seconds:2592000},{id:'year',label:'Past year',seconds:31536000}]);
  const sorts=Object.freeze(['old','comments']),maxSubreddits=8;
  const isoDay=/^(\d{4})-(\d{2})-(\d{2})$/;
  const validDay=value=>{const m=isoDay.exec(value||'');if(!m)return false;const d=new Date(+m[1],+m[2]-1,+m[3]);return d.getFullYear()===+m[1] && d.getMonth()===+m[2]-1 && d.getDate()===+m[3];};
  const empty=()=>({date:null,types:[],subreddits:[],sort:null});
  const clone=state=>({date:state.date?{...state.date}:null,types:[...state.types],subreddits:[...state.subreddits],sort:state.sort});
  const subName=value=>String(value||'').trim().replace(/^\/?r\//i,'').replace(/[^\w]/g,'').slice(0,40);
  // Reddit's own post-type values, and archive values, reduced to ours.
  function normalizeType(value){
    const v=String(value||'').toLowerCase();
    if(types.includes(v))return v;
    if(['self','rtjson','richtext','text_only'].includes(v))return 'text';
    if(['hosted:video','rich:video','video_link','reddit_video','gif','hosted_video'].includes(v))return 'video';
    if(['multi_media','multi_image','gallery_post'].includes(v))return 'gallery';
    if(['image_link','hosted_image'].includes(v))return 'image';
    if(['link','article','external','article_link'].includes(v))return 'link';
    return '';
  }
  function parse(search){
    const p=new URLSearchParams(search||''),state=empty(),date=p.get(params.date);
    if(presets.some(x=>x.id===date))state.date={preset:date};
    else{const m=/^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(date||'');if(m && validDay(m[1]) && validDay(m[2]))state.date=m[1]<=m[2]?{from:m[1],to:m[2]}:{from:m[2],to:m[1]};}
    for(const t of (p.get(params.types)||'').split(','))if(types.includes(t.trim().toLowerCase()) && !state.types.includes(t.trim().toLowerCase()))state.types.push(t.trim().toLowerCase());
    for(const s of (p.get(params.subreddits)||'').split(',')){const n=subName(s);if(n && state.subreddits.length<maxSubreddits && !state.subreddits.some(x=>x.toLowerCase()===n.toLowerCase()))state.subreddits.push(n);}
    const sort=p.get(params.sort);if(sorts.includes(sort))state.sort=sort;
    return state;
  }
  function dateParam(date){return date?.preset?date.preset:date?.from && date?.to?date.from+'..'+date.to:'';}
  // Only the rt_* values for a state, in a stable order.
  function serialize(state){
    const out={},date=dateParam(state.date);
    if(date)out[params.date]=date;if(state.types.length)out[params.types]=state.types.join(',');if(state.subreddits.length)out[params.subreddits]=state.subreddits.join(',');if(state.sort)out[params.sort]=state.sort;
    return out;
  }
  const isActive=state=>Boolean(state.date || state.types.length || state.subreddits.length || state.sort);
  const equal=(a,b)=>JSON.stringify(serialize(a))===JSON.stringify(serialize(b));
  // Search string with our params replaced and everything else kept as-is.
  function applyToSearch(search,state){
    const p=new URLSearchParams(search||'');for(const name of Object.values(params))p.delete(name);
    for(const [name,value] of Object.entries(serialize(state)))p.set(name,value);
    const text=p.toString().replace(/%2C/gi,',');return text?'?'+text:'';
  }
  // history.replaceState keeps history.state; no navigation, no popstate.
  function write(state,{location:loc=globalThis.location,history:hist=globalThis.history}={}){
    const search=applyToSearch(loc.search,state);if(search===loc.search)return false;
    try{hist.replaceState(hist.state,'',loc.pathname+search+loc.hash);return true;}catch{return false;}
  }
  const read=(loc=globalThis.location)=>parse(loc.search);
  // Inclusive seconds range {after,before}: after is the start, before is exclusive. Null when no date filter.
  function dateRange(state,now=Date.now()/1000){
    const date=state.date;if(!date)return null;
    if(date.preset){const preset=presets.find(x=>x.id===date.preset);return preset?{after:Math.floor(now-preset.seconds),before:null}:null;}
    const [fy,fm,fd]=date.from.split('-').map(Number),[ty,tm,td]=date.to.split('-').map(Number);
    return {after:Math.floor(new Date(fy,fm-1,fd).getTime()/1000),before:Math.floor(new Date(ty,tm-1,td+1).getTime()/1000)};
  }
  // item: {created (seconds), postType, subreddit, kind}. Comments carry no post type, so a type filter excludes them.
  function predicate(state,now=Date.now()/1000){
    const range=dateRange(state,now),wanted=new Set(state.types),subs=new Set(state.subreddits.map(s=>s.toLowerCase()));
    return item=>{
      if(range){const t=Number(item.created);if(!Number.isFinite(t) || t<range.after || range.before!=null && t>=range.before)return false;}
      if(wanted.size && (item.kind==='comment' || !wanted.has(normalizeType(item.postType))))return false;
      if(subs.size && !subs.has(subName(item.subreddit).toLowerCase()))return false;
      return true;
    };
  }
  // Best-effort type for items that arrive without one.
  function inferType(post){
    const known=normalizeType(post?.postType);if(known)return known;if(!post || post.kind==='comment')return '';
    const media=Array.isArray(post.media)?post.media:[];
    if(media.length>1)return 'gallery';if(media[0])return media[0].kind==='video'?'video':'image';
    try{const url=new URL(post.url),permalink=post.permalink?new URL(post.permalink):null;if(post.url && !/(^|\.)reddit\.com$/i.test(url.hostname) && (!permalink || url.href!==permalink.href))return 'link';}catch{}
    return 'text';
  }
  function countSubreddits(items){
    const counts=new Map();for(const item of items){const n=subName(item.subreddit);if(!n)continue;const key=n.toLowerCase(),entry=counts.get(key);if(entry)entry.count++;else counts.set(key,{key:n,count:1});}
    return counts;
  }
  // Archive buckets plus loaded items not already counted by the archive, as sorted [{key,count}].
  function mergeCounts(buckets,loaded=[]){
    const counts=new Map();
    for(const bucket of buckets||[]){const n=subName(bucket.key);if(!n)continue;const k=n.toLowerCase(),e=counts.get(k);if(e)e.count+=Number(bucket.count)||0;else counts.set(k,{key:n,count:Number(bucket.count)||0});}
    for(const item of loaded){const n=subName(item.subreddit);if(!n)continue;const k=n.toLowerCase(),e=counts.get(k);if(e)e.count++;else counts.set(k,{key:n,count:1});}
    return [...counts.values()].sort((a,b)=>b.count-a.count || a.key.localeCompare(b.key));
  }
  const dayLabel=value=>{const [y,m,d]=value.split('-').map(Number);return new Date(y,m-1,d).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});};
  function dateLabel(date){
    if(!date)return '';if(date.preset)return presets.find(x=>x.id===date.preset)?.label || '';
    return date.from===date.to?dayLabel(date.from):dayLabel(date.from)+' – '+dayLabel(date.to);
  }
  // Chips to show, each with the state that removes it.
  function chipList(state){
    const chips=[];
    if(state.sort==='old')chips.push({id:'sort',label:'Oldest first',remove:s=>({...s,sort:null})});
    if(state.sort==='comments')chips.push({id:'sort',label:'Most commented',remove:s=>({...s,sort:null})});
    if(state.date)chips.push({id:'date',label:dateLabel(state.date),remove:s=>({...s,date:null})});
    for(const t of state.types)chips.push({id:'type:'+t,label:typeLabels[t],remove:s=>({...s,types:s.types.filter(x=>x!==t)})});
    for(const sub of state.subreddits)chips.push({id:'sub:'+sub.toLowerCase(),label:'r/'+sub,remove:s=>({...s,subreddits:s.subreddits.filter(x=>x!==sub)})});
    return chips;
  }
  // Reddit-style chip row. Re-renders only inside click handlers, never on pointer-down,
  // so a real mouse click always reaches its button.
  function renderChips(container,state,{onChange,make,glyph}){
    const chips=chipList(state);container.replaceChildren();container.hidden=!chips.length;
    for(const chip of chips){
      const el=make('span','rt-filter-chip'),text=make('span','rt-filter-chip-label',chip.label),remove=make('button','rt-filter-chip-remove');
      remove.type='button';remove.setAttribute('aria-label','Remove filter '+chip.label);remove.dataset.rtChipRemove=chip.id;remove.append(glyph('close'));
      remove.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();onChange(chip.remove(clone(state)));});
      el.dataset.rtChip=chip.id;el.append(text,remove);container.append(el);
    }
    if(chips.length){const clear=make('button','rt-filter-clear','Clear filters');clear.type='button';clear.dataset.rtFilterClear='true';clear.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();onChange(empty());});container.append(clear);}
  }
  // Menu rows in the caller's own style: ctx supplies row(label,icon), activate(el,fn), glyph(kind).
  function menuOption(ctx,{label,subtitle='',icon=null,checked=false,onSelect,value=''}){
    const el=ctx.row(label,icon || 'filter');
    if(subtitle){const sub=document.createElement('span');sub.className='text-12 text-neutral-content-weak ms-xs';sub.dataset.rtOptionSubtitle='true';sub.textContent=subtitle;el.firstElementChild.firstElementChild.append(sub);}
    if(value)el.dataset.rtOption=value;
    ctx.activate(el,onSelect);markChecked(ctx,el,checked);return el;
  }
  function markChecked(ctx,el,checked){
    if(el.getAttribute('aria-checked')!==String(checked))el.setAttribute('aria-checked',String(checked));
    let mark=el.querySelector('[data-rt-check]');
    if(checked && !mark){mark=ctx.glyph('checkmark');mark.dataset.rtCheck='true';el.firstElementChild.append(mark);}else if(!checked)mark?.remove();
  }
  globalThis.RTFeedFilters=Object.freeze({params:Object.freeze({...params}),types,typeLabels,presets,sorts,maxSubreddits,empty,clone,parse,serialize,isActive,equal,applyToSearch,write,read,dateRange,predicate,normalizeType,inferType,countSubreddits,mergeCounts,dateLabel,chipList,renderChips,menuOption,markChecked,subName});
})();
