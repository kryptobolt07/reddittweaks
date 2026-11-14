/* Raffles from a post's commenters (docs/raffle-spec.md). Pure: entries, rules and an unbiased draw.
   No network and no DOM; the page bridge supplies comments and account facts. */
(() => {
  'use strict';
  if(globalThis.RTRaffleModel)return;
  const MAX_WINNERS=100,MAX_ENTRIES=20000;
  const nameOK=value=>typeof value==='string' && /^[A-Za-z0-9_-]{3,20}$/.test(value);
  const DEFAULT_RULES=Object.freeze({winners:1,topLevelOnly:true,excludeAuthor:true,minAccountAgeDays:0,minCommentKarma:0,minPostKarma:0,minTotalKarma:0,mustInclude:'',excludeUsers:[],postedBefore:0});
  const intIn=(value,min,max,fallback)=>{const n=Number(value);return Number.isFinite(n)?Math.min(max,Math.max(min,Math.floor(n))):fallback;};
  function normalizeRules(raw={}){
    const users=(Array.isArray(raw.excludeUsers)?raw.excludeUsers:String(raw.excludeUsers || '').split(/[\s,]+/)).map(name=>String(name).trim().replace(/^\/?u\//i,'')).filter(nameOK).slice(0,200);
    return {winners:intIn(raw.winners,1,MAX_WINNERS,1),topLevelOnly:raw.topLevelOnly!==false,excludeAuthor:raw.excludeAuthor!==false,
      minAccountAgeDays:intIn(raw.minAccountAgeDays,0,36500,0),minCommentKarma:intIn(raw.minCommentKarma,0,1e9,0),minPostKarma:intIn(raw.minPostKarma,0,1e9,0),minTotalKarma:intIn(raw.minTotalKarma,0,1e9,0),
      mustInclude:String(raw.mustInclude ?? '').trim().slice(0,100),excludeUsers:[...new Set(users.map(u=>u.toLowerCase()))],postedBefore:intIn(raw.postedBefore,0,32503680000,0)};
  }
  const needsAccount=rules=>rules.minAccountAgeDays>0 || rules.minCommentKarma>0 || rules.minPostKarma>0 || rules.minTotalKarma>0;

  // One comment from Reddit's thread JSON (t1 data) → an entry, or null when it can't take part.
  function entry(raw,{postId}={}){
    raw=raw?.data || raw;if(!raw || typeof raw!=='object')return null;
    const id=typeof raw.id==='string' && /^[a-z0-9]{1,32}$/i.test(raw.id)?raw.id.toLowerCase():'';const author=String(raw.author || '');
    const created=Number(raw.created_utc);if(!id || !Number.isFinite(created) || created<=0)return null;
    const parent=String(raw.parent_id || '').toLowerCase(),topLevel=postId?parent==='t3_'+postId.toLowerCase():/^t3_/.test(parent);
    return {id,author,created:Math.floor(created),topLevel,body:typeof raw.body==='string'?raw.body.slice(0,2000):'',
      permalink:typeof raw.permalink==='string' && raw.permalink.startsWith('/')?'https://www.reddit.com'+raw.permalink:'',
      removed:['[removed]','[deleted]'].includes(String(raw.body).trim()) || raw.removed_by_category!=null || author==='[deleted]',
      avatar:typeof raw.avatar==='string' && /^https:\/\//.test(raw.avatar)?raw.avatar.slice(0,500):'',score:Number.isFinite(Number(raw.score))?Number(raw.score):null};
  }

  /* Filter entries by the rules that need no account lookups. Returns candidates (one per user, their earliest
     qualifying comment) plus a count per exclusion reason, so the result can say exactly who was left out. */
  function candidates(entries,rawRules,{postAuthor=''}={}){
    const rules=normalizeRules(rawRules),excluded={deleted:0,notTopLevel:0,author:0,listed:0,keyword:0,late:0,duplicate:0,invalid:0};
    const byUser=new Map(),needle=rules.mustInclude.toLowerCase(),excludedUsers=new Set(rules.excludeUsers);
    for(const item of entries.slice(0,MAX_ENTRIES)){
      if(!item){excluded.invalid++;continue;}
      if(item.removed || !nameOK(item.author)){excluded.deleted++;continue;}
      if(rules.topLevelOnly && !item.topLevel){excluded.notTopLevel++;continue;}
      const user=item.author.toLowerCase();
      if(rules.excludeAuthor && postAuthor && user===postAuthor.toLowerCase()){excluded.author++;continue;}
      if(excludedUsers.has(user) || user==='automoderator'){excluded.listed++;continue;}
      if(rules.postedBefore && item.created>rules.postedBefore){excluded.late++;continue;}
      if(needle && !item.body.toLowerCase().includes(needle)){excluded.keyword++;continue;}
      const seen=byUser.get(user);
      if(seen){excluded.duplicate++;if(item.created<seen.created || item.created===seen.created && item.id<seen.id)byUser.set(user,item);continue;}
      byUser.set(user,item);
    }
    // Stable order (oldest first) so the draw depends only on the random source, not on Reddit's sort.
    const list=[...byUser.values()].sort((a,b)=>a.created-b.created || (a.id<b.id?-1:1));
    return {rules,candidates:list,excluded};
  }

  // Unbiased integer in [0, max) by rejection sampling over 32-bit words.
  function randomInt(max,random=defaultRandom){
    if(!Number.isInteger(max) || max<=0 || max>2**32)throw RangeError('Invalid range.');
    const limit=Math.floor(2**32/max)*max;let value;do value=random();while(value>=limit);return value%max;
  }
  function defaultRandom(){const word=new Uint32Array(1);crypto.getRandomValues(word);return word[0];}

  // Account rule check from /user/<name>/about.json facts. Unknown accounts never pass.
  function accountReason(account,rules,now=Date.now()/1000){
    if(!account || account.unavailable)return 'unavailable';
    if(account.suspended)return 'suspended';
    if(rules.minAccountAgeDays && (now-Number(account.created))/86400<rules.minAccountAgeDays)return 'age';
    if(Number(account.commentKarma)<rules.minCommentKarma)return 'commentKarma';
    if(Number(account.postKarma)<rules.minPostKarma)return 'postKarma';
    if(Number(account.commentKarma)+Number(account.postKarma)<rules.minTotalKarma)return 'totalKarma';
    return '';
  }

  /* Draw winners: a uniform random order of all candidates (Fisher–Yates), then the first `winners` that pass the
     account rules. Equivalent to a uniform draw among eligible users, and only accounts reached are looked up.
     lookup(name) → account facts; it may throw (counted as "couldn't check" and skipped, never a winner). */
  async function draw(pool,rawRules,{lookup=null,random=defaultRandom,now=Date.now()/1000,onProgress=null,signal=null}={}){
    const rules=normalizeRules(rawRules),order=pool.slice();
    for(let i=order.length-1;i>0;i--){const j=randomInt(i+1,random);[order[i],order[j]]=[order[j],order[i]];}
    const winners=[],skipped={},check=needsAccount(rules);let checked=0;
    for(const item of order){
      if(winners.length>=rules.winners)break;
      if(signal?.aborted)throw Error('Raffle cancelled.');
      if(check){
        let reason;try{reason=accountReason(await lookup(item.author),rules,now);}catch{reason='unchecked';}
        checked++;onProgress?.({checked,winners:winners.length});
        if(reason){skipped[reason]=(skipped[reason] || 0)+1;continue;}
      }
      winners.push(item);
    }
    return {winners,skipped,checked,shortBy:Math.max(0,rules.winners-winners.length),poolSize:pool.length};
  }

  // Markdown the moderator can paste as a comment (we never post it).
  function resultsMarkdown({winners,rules,poolSize,drawnAt,postUrl}){
    const lines=['**Raffle results** ('+winners.length+' of '+poolSize+' eligible '+(poolSize===1?'entrant':'entrants')+', drawn '+new Date(drawnAt*1000).toISOString().replace(/\.\d+Z$/,'Z')+')','' ];
    winners.forEach((w,i)=>lines.push((i+1)+'. u/'+w.author+(w.permalink?' ([comment]('+w.permalink+'))':'')));
    const terms=[rules.topLevelOnly?'top-level comments only':'all comments','one entry per user',rules.excludeAuthor?'post author excluded':'',rules.minAccountAgeDays?'accounts at least '+rules.minAccountAgeDays+' days old':'',
      rules.minCommentKarma?'comment karma ≥ '+rules.minCommentKarma:'',rules.minPostKarma?'post karma ≥ '+rules.minPostKarma:'',rules.minTotalKarma?'total karma ≥ '+rules.minTotalKarma:'',rules.mustInclude?'comment includes “'+rules.mustInclude+'”':''].filter(Boolean);
    lines.push('','Rules: '+terms.join(', ')+'.');if(postUrl)lines.push('Post: '+postUrl);
    return lines.join('\n');
  }

  globalThis.RTRaffleModel=Object.freeze({MAX_WINNERS,MAX_ENTRIES,DEFAULT_RULES,normalizeRules,needsAccount,entry,candidates,randomInt,accountReason,draw,resultsMarkdown});
})();
