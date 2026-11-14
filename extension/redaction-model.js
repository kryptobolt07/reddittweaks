/* Bulk redaction of your own posts and comments (docs/redaction-spec.md). Pure: filters, the confirmation phrase
   and a paced runner. No network and no DOM; the page bridge does the reads and writes. */
(() => {
  'use strict';
  if(globalThis.RTRedactionModel)return;
  const WRITE_GAP_MS=1100,MAX_BACKOFF_MS=300000,MAX_CONSECUTIVE_FAILURES=3;
  const DEFAULT_TEXT='This comment has been redacted or anonymized by Reddit Tweaks.';
  const communities=value=>(Array.isArray(value)?value:String(value || '').split(/[\s,]+/)).map(name=>String(name).trim().replace(/^\/?r\//i,'').replace(/^\/?u\//i,'u_').toLowerCase()).filter(name=>/^[a-z0-9_]{2,21}$/.test(name) || /^u_[a-z0-9_-]{3,20}$/.test(name));
  // Links or IDs to keep: t1_/t3_ fullnames, bare IDs, or Reddit permalinks (post or comment).
  function keepIds(value){
    const out=new Set();
    for(const token of String(value || '').split(/[\s,]+/).filter(Boolean)){
      const full=token.match(/^(t[13])_([a-z0-9]{1,32})$/i);if(full){out.add(full[1].toLowerCase()+'_'+full[2].toLowerCase());continue;}
      const link=token.match(/\/comments\/([a-z0-9]{1,10})(?:\/[^/\s]*)?(?:\/(?:comment\/)?([a-z0-9]{1,32}))?\/?(?:[?#].*)?$/i);
      if(link){out.add(link[2]?'t1_'+link[2].toLowerCase():'t3_'+link[1].toLowerCase());continue;}
      if(/^[a-z0-9]{1,32}$/i.test(token)){out.add('t1_'+token.toLowerCase());out.add('t3_'+token.toLowerCase());}
    }
    return out;
  }
  const day=86400;
  function normalizeRules(raw={}){
    const num=(value,min,max)=>{if(value==null || value==='')return null;const n=Number(value);return Number.isFinite(n)?Math.min(max,Math.max(min,Math.floor(n))):null;};
    const date=value=>{if(!value)return null;const t=Date.parse(String(value)+(/^\d{4}-\d{2}-\d{2}$/.test(String(value))?'T00:00:00Z':''));return Number.isFinite(t)?Math.floor(t/1000):null;};
    const kinds=['posts','comments','both'].includes(raw.kinds)?raw.kinds:'both';
    const text=String(raw.text ?? DEFAULT_TEXT).replace(/\u0000/g,'').trim().slice(0,1000) || DEFAULT_TEXT;
    return {kinds,olderThanDays:num(raw.olderThanDays,0,36500),from:date(raw.from),to:date(raw.to),onlyIn:communities(raw.onlyIn),neverIn:communities(raw.neverIn),
      keepScoreAtLeast:num(raw.keepScoreAtLeast,-1e9,1e9),onlyContaining:String(raw.onlyContaining || '').trim().toLowerCase().slice(0,200),keepContaining:String(raw.keepContaining || '').trim().toLowerCase().slice(0,200),keep:keepIds(raw.keep),text};
  }
  // One item from the bridge (already your own) → whether the rules select it, and why not.
  function reason(item,rules,now){
    if(rules.kinds==='posts' && item.kind!=='post' || rules.kinds==='comments' && item.kind!=='comment')return 'type';
    if(rules.keep.has(item.fullname))return 'kept';
    if(rules.olderThanDays!=null && item.created>now-rules.olderThanDays*day)return 'too-new';
    if(rules.from!=null && item.created<rules.from)return 'before-range';
    if(rules.to!=null && item.created>=rules.to+day)return 'after-range';
    const sub=String(item.subreddit || '').toLowerCase();
    if(rules.onlyIn.length && !rules.onlyIn.includes(sub))return 'community';
    if(rules.neverIn.includes(sub))return 'community';
    if(rules.keepScoreAtLeast!=null && item.score>=rules.keepScoreAtLeast)return 'score';
    const haystack=((item.title || '')+'\n'+(item.body || '')).toLowerCase();
    if(rules.onlyContaining && !haystack.includes(rules.onlyContaining))return 'text';
    if(rules.keepContaining && haystack.includes(rules.keepContaining))return 'kept-text';
    if(item.deleted)return 'already-deleted';
    return '';
  }
  function select(items,rawRules,{now=Date.now()/1000}={}){
    const rules=rawRules?.keep instanceof Set?rawRules:normalizeRules(rawRules),matches=[],skipped={};const seen=new Set();
    for(const item of items){if(!item?.fullname || seen.has(item.fullname))continue;seen.add(item.fullname);const why=reason(item,rules,now);if(why)skipped[why]=(skipped[why] || 0)+1;else matches.push(item);}
    // Oldest first: if a run stops part-way, the newest (most visible) items are the ones left, never a random mix.
    matches.sort((a,b)=>a.created-b.created || (a.fullname<b.fullname?-1:1));
    return {rules,matches,skipped,posts:matches.filter(i=>i.kind==='post').length,comments:matches.filter(i=>i.kind==='comment').length,
      found:seen.size,oldest:seen.size?Math.min(...items.filter(Boolean).map(i=>i.created)):null};
  }
  const overwritable=item=>item.kind==='comment' || item.isSelf===true && Boolean(String(item.body || '').trim()) && !['[deleted]','[removed]'].includes(String(item.body).trim());
  const confirmation=count=>'delete '+count;
  const confirmed=(typed,count)=>String(typed || '').trim().toLowerCase()===confirmation(count);

  /* Process items one at a time: overwrite (when there is text), then delete. write(item,step,text) resolves
     {ok:true} or {ok:false,error,retryAfterMs?,rateLimited?}; it may throw (counted as a failure).
     sleep(ms,signal) and now() are injected so tests run on a fake clock. */
  async function run(items,rules,{write,sleep,now=()=>Date.now(),signal=null,onProgress=null}={}){
    const done=[],failed=[],overwrittenOnly=[];let consecutive=0,last=-Infinity,stopped='';
    const pace=async()=>{const wait=last+WRITE_GAP_MS-now();if(wait>0)await sleep(wait,signal);last=now();};
    const attempt=async(item,step)=>{
      for(let tries=0;;tries++){
        if(signal?.aborted)throw Object.assign(Error('Stopped.'),{stopped:true});
        await pace();
        let result;try{result=await write(item,step,rules.text);}catch(error){result={ok:false,error:error.message || 'Request failed.'};}
        if(result?.ok)return result;
        if(result?.rateLimited && tries<3){await sleep(Math.min(MAX_BACKOFF_MS,Math.max(WRITE_GAP_MS,Number(result.retryAfterMs) || 60000)),signal);continue;}
        return {ok:false,error:result?.error || 'Reddit refused the request.'};
      }
    };
    for(const item of items){
      if(signal?.aborted){stopped='Stopped.';break;}
      let edited=false,outcome;
      try{
        if(overwritable(item)){outcome=await attempt(item,'overwrite');edited=outcome.ok;}
        if(!outcome || outcome.ok)outcome=await attempt(item,'delete');
      }catch(error){if(error.stopped){stopped='Stopped.';if(edited)overwrittenOnly.push({item,error:'Stopped before deleting.'});break;}outcome={ok:false,error:error.message};}
      if(outcome.ok){done.push(item);consecutive=0;}
      else{(edited?overwrittenOnly:failed).push({item,error:outcome.error});consecutive++;}
      onProgress?.({done:done.length,failed:failed.length+overwrittenOnly.length,total:items.length});
      if(consecutive>=MAX_CONSECUTIVE_FAILURES){stopped='Stopped after '+MAX_CONSECUTIVE_FAILURES+' failures in a row.';break;}
    }
    return {done,failed,overwrittenOnly,stopped,remaining:items.length-done.length-failed.length-overwrittenOnly.length};
  }
  // Rough time left at the pacing rate (two writes for overwritable items).
  const minutesLeft=items=>Math.max(1,Math.ceil(items.reduce((sum,item)=>sum+(overwritable(item)?2:1),0)*WRITE_GAP_MS/60000));

  globalThis.RTRedactionModel=Object.freeze({WRITE_GAP_MS,MAX_CONSECUTIVE_FAILURES,DEFAULT_TEXT,normalizeRules,keepIds,select,overwritable,confirmation,confirmed,run,minutesLeft});
})();
