/* Content-side archive search helper (isolated world). Talks to the background archive client; persists nothing. */
(() => {
  'use strict';
  const ttl=600000,maxEntries=50,cache=new Map();
  // Same message scope and 16 s guard as post-discovery's archive reads.
  function defaultSend(message){
    let timer;
    return Promise.race([chrome.runtime.sendMessage({scope:'rt-posts',...message,pageUrl:location.href}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(Error('Archive request took too long. Try again.'),{code:'timeout'})),16000);})]).finally(()=>clearTimeout(timer));
  }
  const clean=message=>Object.fromEntries(Object.entries(message).filter(([,value])=>value!=null));
  // Per-tab, in memory, 10 minutes, bounded. Only successful answers are kept.
  async function ask(send,message){
    message=clean(message);const key=JSON.stringify(Object.keys(message).sort().map(name=>[name,message[name]])),now=Date.now();
    for(const [id,entry] of cache)if(entry.expires<=now)cache.delete(id);
    const saved=cache.get(key);if(saved)return saved.value;
    const response=await (send || defaultSend)(message);
    if(!response?.ok)throw Object.assign(Error(response?.error || 'Archive unavailable.'),{code:response?.code,retryAt:response?.retryAt});
    if(cache.size>=maxEntries)cache.delete(cache.keys().next().value);
    cache.set(key,{value:response,expires:now+ttl});return response;
  }
  // WS1 (search-core) provides toArchiveQuery/matchesText. Until it lands, fall back to a plain case-insensitive AND of words.
  const words=text=>[...String(text || '').toLowerCase().matchAll(/"([^"]+)"|(\S+)/g)].map(match=>match[1] || match[2]).filter(word=>word && word!=='or' && !word.startsWith('-'));
  const parsedText=parsed=>typeof parsed==='string'?parsed:parsed?.text || '';
  function toQuery(parsed){
    const core=globalThis.RCSCore;if(typeof core?.toArchiveQuery==='function')return String(core.toArchiveQuery(parsed) || '').trim();
    return parsedText(parsed).trim();
  }
  function matches(parsed,haystack){
    const core=globalThis.RCSCore;if(typeof core?.matchesText==='function')return Boolean(core.matchesText(parsed,haystack));
    const lower=String(haystack || '').toLowerCase();return words(parsedText(parsed)).every(word=>lower.includes(word));
  }
  // Documented parameters: api/README.md, Posts and comments / Search.
  // Only unconditional positive fields can narrow a flat parameter request.
  // URL is deliberately local: the API's prefix match is narrower than url:'s
  // substring predicate. Site, self and type have no documented parameters.
  function projection(parsed,{kind,author,subreddit,after,before}={}){
    const core=globalThis.RCSCore,params={};
    if(!parsed?.expr || !core?.splitQuery)return {params,query:toQuery(parsed),residual:false};
    const split=core.splitQuery(parsed,kind==='comment'?['and','or','not','term','phrase']:['and','term','phrase']);
    let query=toQuery(split.server),residual=split.residual;
    if(query.length>256 || /[\u0000-\u001f\u007f]/.test(query)){query='';residual=true;}
    const nodes=[];const collect=node=>{if(node.type==='and')node.children.forEach(collect);else if(node.type==='field')nodes.push(node);};collect(parsed.expr);
    for(const node of nodes){
      const {field,value}=node;
      if(value.length>256 || /[\u0000-\u001f\u007f]/.test(value))continue;
      if(field==='subreddit' && !subreddit && !params.subreddit)params.subreddit=value;
      if(field==='author' && !author && !params.author)params.author=value;
      if(field==='before' || field==='after'){
        // Core dates use local midnight; archive cursors are exclusive seconds.
        const time=core.dateBounds({from:value}).start/1000;
        // Dates outside the broker's cursor range stay local.
        if(field==='before' && time>0 && time<=32503680000)before=Math.min(before ?? Infinity,time);
        else if(field==='after' && time>1 && time<=32503680000)after=Math.max(after ?? 0,time-1);
      }
      if(kind==='comment'){
        // body also carries unqualified text, so do not overwrite it.
        if(field==='body' && !query && !params.body){
          // PostgreSQL websearch treats OR, '-' and spaces as syntax. A field
          // value is literal text, so quote it through the shared serializer.
          const literal=core.parseQuery('"'+value.replace(/\\/g,'\\\\').replace(/"/g,'\\"')+'"');
          const body=core.toArchiveQuery(literal);if(body && body.length<=256)params.body=body;
        }
      }else{
        const key={title:'title',body:'selftext',flair:'link_flair_text',nsfw:'over_18',spoiler:'spoiler'}[field];
        if(key && params[key]==null)params[key]=['nsfw','spoiler'].includes(field)?value.toLowerCase()==='yes':value;
      }
    }
    if(after!=null)params.after=after;if(before!=null)params.before=before;
    // Fields are always verified locally, including server keyword semantics.
    return {params,query,residual:residual || Boolean(parsed.hasOperators)};
  }
  // Streams pages of {items, searchedBackTo, hasMore, serverFiltered, cursor, stalled, mode}. At most maxPages archive requests per call;
  // pass the last page's cursor back as `cursor` to search older (desc) or newer (asc). hasMore is never false unless the archive said so.
  async function* search({kind,author,subreddit,parsed,text,after,before,sort='desc',cursor,postTypes,maxPages=10,signal,send,titles=false}={}){
    parsed=parsed ?? (text ? globalThis.RCSCore?.parseQuery?.(text) ?? {text} : null);
    if(parsed?.invalid)return;
    const plan=projection(parsed,{kind,author,subreddit,after,before}),query=plan.query,asc=sort==='asc',types=kind==='post' && postTypes?.length?new Set(postTypes):null;
    after=plan.params.after ?? after;before=plan.params.before ?? before;
    // Cursors overlap the boundary second, so a page can repeat the previous page's edge items; drop repeats within a call.
    let local=false,position=cursor ?? (asc?after:before),reached=null,pages=0;const seen=new Set();
    while(pages<maxPages){
      if(signal?.aborted)return;
      const params={...plan.params};if(local)for(const key of ['title','selftext','body','link_flair_text'])delete params[key];
      const message={action:'archive-search',kind,...params,...(titles && kind==='comment'?{titles:true}:{}),author:author ?? params.author,subreddit:subreddit ?? params.subreddit,sort,after:asc?position:after,before:asc?before:position,query:local?undefined:query||undefined};
      let response;
      try{response=await ask(send,message);}
      catch(error){
        // A very active scope can time out on text: scan without it and match locally within the page budget.
        if(error.code==='text-search-unavailable' && (query || ['title','selftext','body','link_flair_text'].some(key=>plan.params[key])) && !local){local=true;continue;}
        throw error;
      }
      if(signal?.aborted)return;
      pages++;
      const posts=response.posts || [],times=posts.map(post=>post.created);
      if(times.length)reached=asc?Math.max(...times):Math.min(...times);
      const scan=local || plan.residual;
      const match=post=>globalThis.RCSCore?.matchRecord && globalThis.RTPostModel?.searchRecord?globalThis.RCSCore.matchRecord(parsed,globalThis.RTPostModel.searchRecord(post)):matches(parsed,post.kind==='comment'?post.body:post.title+' '+post.body);
      const items=posts.filter(post=>!seen.has(post.fullname || post.id) && seen.add(post.fullname || post.id) && (!scan || match(post)) && (!types || types.has(post.postType)));
      const stalled=response.cursorStalled===true,more=response.hasMore===true;
      yield {items,searchedBackTo:reached,hasMore:more,serverFiltered:!local && Boolean(query || Object.keys(plan.params).length),cursor:more?response.cursor ?? null:null,stalled,scanned:posts.length,mode:scan?'local':'server'};
      if(!more || stalled || response.cursor==null)return;
      position=response.cursor;
    }
  }
  function aggregate({kind,author,subreddit,by,after,before,send}={}){return ask(send,{action:'archive-aggregate',kind,author,subreddit,by,after,before});}
  const subreddit=(name,send)=>ask(send,{action:'archive-subreddit',name});
  const clear=()=>cache.clear();
  globalThis.RTArchiveQuery=Object.freeze({search,aggregate,subreddit,clear});
})();
