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
  // Streams pages of {items, searchedBackTo, hasMore, serverFiltered, cursor, stalled, mode}. At most maxPages archive requests per call;
  // pass the last page's cursor back as `cursor` to search older (desc) or newer (asc). hasMore is never false unless the archive said so.
  async function* search({kind,author,subreddit,parsed,text,after,before,sort='desc',cursor,postTypes,maxPages=10,signal,send}={}){
    parsed=parsed ?? (text ? {text} : null);
    const query=toQuery(parsed),asc=sort==='asc',types=kind==='post' && postTypes?.length?new Set(postTypes):null;
    // Cursors overlap the boundary second, so a page can repeat the previous page's edge items; drop repeats within a call.
    let local=false,position=cursor ?? (asc?after:before),reached=null,pages=0;const seen=new Set();
    while(pages<maxPages){
      if(signal?.aborted)return;
      const message={action:'archive-search',kind,author,subreddit,sort,after:asc?position:after,before:asc?before:position,query:local?undefined:query||undefined};
      let response;
      try{response=await ask(send,message);}
      catch(error){
        // A very active scope can time out on text: scan without it and match locally within the page budget.
        if(error.code==='text-search-unavailable' && query && !local){local=true;continue;}
        throw error;
      }
      if(signal?.aborted)return;
      pages++;
      const posts=response.posts || [],times=posts.map(post=>post.created);
      if(times.length)reached=asc?Math.max(...times):Math.min(...times);
      const scan=local && query;
      const items=posts.filter(post=>!seen.has(post.fullname || post.id) && seen.add(post.fullname || post.id) && (!scan || matches(parsed,post.kind==='comment'?post.body:post.title+' '+post.body)) && (!types || types.has(post.postType)));
      const stalled=response.cursorStalled===true,more=response.hasMore===true;
      yield {items,searchedBackTo:reached,hasMore:more,serverFiltered:!scan && Boolean(query),cursor:more?response.cursor ?? null:null,stalled,scanned:posts.length,mode:scan?'local':'server'};
      if(!more || stalled || response.cursor==null)return;
      position=response.cursor;
    }
  }
  function aggregate({kind,author,subreddit,by,after,before,send}={}){return ask(send,{action:'archive-aggregate',kind,author,subreddit,by,after,before});}
  const subreddit=(name,send)=>ask(send,{action:'archive-subreddit',name});
  const clear=()=>cache.clear();
  globalThis.RTArchiveQuery=Object.freeze({search,aggregate,subreddit,clear});
})();
