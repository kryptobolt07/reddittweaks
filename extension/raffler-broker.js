/* Official raffles on Reddit Raffler (docs/raffle-spec.md §4b). Uses the endpoints redditraffler.com's own pages call
   (read from its public source, github.com/redditraffler/redditraffler, and checked on the live site 2026-11-15):
   GET  /raffles/new                → form page: csrf_token, and the signed-in name when you're signed in there
   POST /api/raffles/new            → 202 {url} queued, 303 existing raffle, 422 validation message
   GET  /api/job_status?job_id=<id> → {status:"Fetching comments..."|"Done!"|"Error: …", error}
   GET  /raffles/<post id>          → the permanent public results page (HTML), 404 when there is none
   Requests carry the browser's redditraffler.com cookies, so a signed-in Raffler session is used; otherwise the
   raffle is a guest raffle. Raffler's CSRF check needs a same-site Referer, set by raffler-referer-rules.json for the
   create request only. Nothing else leaves the browser: the post ID, the rules and the ignored usernames. */
(() => {
  'use strict';
  if(globalThis.RTRafflerBroker)return;
  const BASE='https://www.redditraffler.com',TIMEOUT=20000,MAX_BYTES=2000000;
  const postIdOK=/^[a-z0-9]{1,10}$/,nameOK=/^[A-Za-z0-9_-]{3,20}$/;
  const fail=(error,code='failed',extra={})=>({ok:false,error,code,...extra});
  function senderOK(sender){
    if(sender?.id!==chrome.runtime.id || sender.frameId!=null && sender.frameId!==0)return false;
    try{const url=new URL(sender.url);return url.protocol==='https:' && ['reddit.com','www.reddit.com','new.reddit.com','sh.reddit.com'].includes(url.hostname) && !url.port;}catch{return false;}
  }
  async function request(path,init={}){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),TIMEOUT);
    try{
      const response=await fetch(BASE+path,{credentials:'include',cache:'no-store',...init,signal:controller.signal});
      if(Number(response.headers?.get?.('content-length'))>MAX_BYTES)throw Error('Reddit Raffler sent too much data.');
      const text=response.type==='opaqueredirect'?'':await response.text();if(text.length>MAX_BYTES)throw Error('Reddit Raffler sent too much data.');
      return {response,text};
    }catch(error){throw Error(controller.signal.aborted?'Reddit Raffler took too long to answer.':'Reddit Raffler is unreachable.');}
    finally{clearTimeout(timer);}
  }
  const decode=text=>String(text).replace(/&#(\d+);/g,(m,n)=>String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi,(m,n)=>String.fromCodePoint(parseInt(n,16))).replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
  // The signed-in Raffler name, from the header every page renders when you're signed in there.
  const signedInName=html=>/id="logout"/.test(html)?(html.match(/<a class="navbar-link">\s*([A-Za-z0-9_-]{3,20})\s*<\/a>/)?.[1] || ''):'';

  // Results page → plain data. Parsed with patterns (service workers have no DOMParser); unreadable → error.
  function parseResults(html,postId){
    const winners=[];
    for(const card of html.split('<div class="card">').slice(1)){
      const username=card.match(/\/u\/([A-Za-z0-9_-]{3,20})\s*<\/p>/)?.[1];
      const comment=card.match(/href="(https:\/\/(?:www\.)?reddit\.com\/r\/[A-Za-z0-9_]{2,21}\/comments\/[a-z0-9]{1,10}\/[^"\s]*?\/([a-z0-9]{1,32})\/?)"/i);
      if(!username)continue;
      const karma=[...card.matchAll(/(-?\d+) karma/g)].map(m=>Number(m[1]));
      winners.push({username,commentUrl:comment?decode(comment[1]):'',commentId:comment?comment[2].toLowerCase():'',accountAgeDays:Number(card.match(/(\d+) days/)?.[1] ?? NaN),commentKarma:karma[0] ?? null,linkKarma:karma[1] ?? null});
    }
    const titlePost=html.match(/Raffle results for "<a href="https:\/\/redd\.it\/([a-z0-9]{1,10})">/i)?.[1];
    if(!winners.length || titlePost && titlePost.toLowerCase()!==postId)throw Error('Reddit Raffler’s results page changed and couldn’t be read.');
    const criteria={};
    for(const m of html.matchAll(/<p class="is-size-3">\s*(\d+)[\s\S]{0,80}?<p class="is-size-6">\s*([^<]{3,40}?)\s*<\/p>/g)){
      const label=m[2].toLowerCase(),value=Number(m[1]);
      if(/account age/.test(label))criteria.minAge=value;else if(/comment karma/.test(label))criteria.minComment=value;else if(/link karma/.test(label))criteria.minLink=value;else if(/combined/.test(label))criteria.minCombined=value;else if(/ignored/.test(label))criteria.ignoredCount=value;
    }
    const ignored=[...html.matchAll(/<span class="tag is-reddit is-rounded">\s*([A-Za-z0-9_-]{3,20})\s*<\/span>/g)].map(m=>m[1]);
    return {postId,url:BASE+'/raffles/'+postId,verified:/id="verified-tag"/.test(html),creator:html.match(/Created by\s*<a href="\/users\/([A-Za-z0-9_-]{3,20})"/)?.[1] || '',
      created:decode(html.match(/ on ([A-Z][a-z]+ \d{1,2} \d{4}, \d{1,2}:\d{2}[ap]m) UTC/)?.[1] || ''),criteria,ignored,winners};
  }
  async function status(postId){
    const {response,text}=await request('/raffles/'+postId,{method:'GET',redirect:'follow',headers:{Accept:'text/html'}});
    if(response.status===404)return {ok:true,exists:false};
    if(!response.ok)return fail('Reddit Raffler couldn’t be checked (HTTP '+response.status+').','http-error');
    return {ok:true,exists:true,raffle:parseResults(text,postId)};
  }
  async function session(){
    const {response,text}=await request('/raffles/new',{method:'GET',headers:{Accept:'text/html'}});
    if(!response.ok)return fail('Reddit Raffler is unavailable (HTTP '+response.status+').','unavailable');
    const csrf=text.match(/name="csrf_token" value="([^"]{10,300})"/)?.[1] || '';
    return {ok:true,signedIn:signedInName(text),csrf};
  }
  async function create(message){
    const p=message.params || {};
    const ignored=Array.isArray(p.ignoredUsers)?[...new Set(p.ignoredUsers.filter(name=>typeof name==='string' && nameOK.test(name)))].slice(0,100):null;
    const int=(value,max)=>Number.isInteger(value) && value>=0 && value<=max;
    if(!ignored || !int(p.winnerCount,100) || p.winnerCount<1 || !int(p.minAge,36500) || (p.minCombined!=null?!int(p.minCombined,1e9) || p.minComment!=null || p.minLink!=null:!int(p.minComment,1e9) || !int(p.minLink,1e9)))return fail('Invalid raffle rules.','invalid-request');
    const form=await session();if(!form.ok)return form;
    if(!form.csrf)return fail('Reddit Raffler’s form changed and couldn’t be used.','format');
    const body=new URLSearchParams({csrf_token:form.csrf,submissionUrl:'https://redd.it/'+message.postId,winnerCount:String(p.winnerCount),minAge:String(p.minAge),
      ...(p.minCombined!=null?{minCombined:String(p.minCombined)}:{minComment:String(p.minComment),minLink:String(p.minLink)}),ignoredUsers:JSON.stringify(ignored)});
    const {response,text}=await request('/api/raffles/new',{method:'POST',redirect:'manual',headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8',Accept:'application/json','X-Requested-With':'XMLHttpRequest'},body});
    if(response.status===202)return {ok:true,queued:true,signedIn:form.signedIn};
    if(response.status===303 || response.type==='opaqueredirect')return {ok:true,exists:true};
    if(response.status===429)return fail('Reddit Raffler is limiting requests. Try again in a minute.','rate-limited');
    if(response.status===422){let reason='';try{reason=JSON.parse(text).message || '';}catch{}return fail('Reddit Raffler didn’t accept this raffle'+(reason?' ('+String(reason).slice(0,160).replace(/\.$/,'')+')':'')+'. A post can only have one official raffle, and it needs enough top-level comments for the winners.','rejected');}
    if(response.status===400)return fail('Reddit Raffler refused the request (its security check failed).','csrf');
    return fail('Reddit Raffler couldn’t create the raffle (HTTP '+response.status+').','http-error');
  }
  async function job(postId){
    const {response,text}=await request('/api/job_status?job_id='+postId,{method:'GET',headers:{Accept:'application/json'}});
    if(response.status===404)return {ok:true,missing:true};
    if(!response.ok)return fail('Reddit Raffler’s progress couldn’t be read (HTTP '+response.status+').','http-error');
    let data;try{data=JSON.parse(text);}catch{return fail('Reddit Raffler sent an unreadable progress update.','format');}
    return {ok:true,status:String(data?.status || '').slice(0,200),error:data?.error===true};
  }
  async function handle(message,sender){
    if(!senderOK(sender))return fail('Raffles must start from a Reddit page.','forbidden');
    const settings=globalThis.RTPostModel?.normalizeSettings?.((await chrome.storage.local.get('rt-settings-v1'))['rt-settings-v1']);
    if(settings && !settings.raffles)return fail('Raffles are turned off in Reddit Tweaks.','disabled');
    if(message.action!=='session' && !postIdOK.test(message.postId || ''))return fail('Invalid post.','invalid-request');
    try{
      if(message.action==='status')return await status(message.postId);
      if(message.action==='session')return await session().then(r=>r.ok?{ok:true,signedIn:r.signedIn}:r);
      if(message.action==='create')return await create(message);
      if(message.action==='job')return await job(message.postId);
      return fail('Unknown Raffler action.','invalid-request');
    }catch(error){return fail(error.message || 'Reddit Raffler request failed.','network-error');}
  }
  chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
    if(message?.scope!=='rt-raffler')return;
    handle(message,sender).then(sendResponse,()=>sendResponse(fail('Reddit Raffler request failed.')));return true;
  });
  globalThis.RTRafflerBroker=Object.freeze({parseResults,signedInName,handle});
})();
