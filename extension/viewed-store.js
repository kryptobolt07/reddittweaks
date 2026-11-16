/* Viewed-posts History beyond Reddit's 20 (docs/viewed-history-spec.md). Worker-side IndexedDB, one record per account
   ID and post, newest view wins. Only what a History row needs is kept: identity, title, community, author, link, dates
   and the facts shown on the row. Nothing leaves the device. */
(() => {
 'use strict';
 if(globalThis.RTViewedStore)return;
 const DB='rt-viewed-history',STORE='views',INDEX='owner_time';
 const ownerOK=value=>/^t2_[a-z0-9]{1,13}$/i.test(value || ''),nameOK=value=>/^[\w-]{1,20}$/.test(value || '');
 function clean(raw){
  const fullname=String(raw?.fullname || '').toLowerCase(),id=fullname.slice(3);
  if(!/^t3_[a-z0-9]{1,10}$/.test(fullname) || String(raw.id || '').toLowerCase()!==id || !Number.isFinite(raw.created) || raw.created<=0)return null;
  let url;try{url=new URL(raw.permalink,'https://www.reddit.com');}catch{return null;}
  if(url.origin!=='https://www.reddit.com' || !new RegExp('^/(?:r|user)/[\\w-]+/comments/'+id+'(?:/|$)','i').test(url.pathname))return null;
  const text=(value,max)=>typeof value==='string'?value.slice(0,max):'',num=value=>typeof value==='number' && Number.isFinite(value)?Math.max(-1e9,Math.min(1e9,Math.floor(value))):undefined;
  const thumbnail=globalThis.RTPostModel?.mediaUrl?.(raw.thumbnail),out={fullname,id,title:text(raw.title,300),subreddit:/^[\w]{1,21}$/.test(raw.subreddit || '')?raw.subreddit:'',author:nameOK(raw.author)?raw.author:'',permalink:url.pathname,created:Math.floor(raw.created),
   postType:/^[a-z]{1,16}$/.test(raw.postType || '')?raw.postType:'',over18:raw.over18===true,spoiler:raw.spoiler===true};
  const score=num(raw.score),comments=num(raw.comments);if(score!==undefined)out.score=score;if(comments!==undefined)out.comments=Math.max(0,comments);if(thumbnail && thumbnail.length<=2048)out.thumbnail=thumbnail;
  return out;
 }
 function create({indexedDB=globalThis.indexedDB,now=()=>Date.now()}={}){
  let opening=null;
  const open=()=>opening ||= new Promise((resolve,reject)=>{const request=indexedDB.open(DB,1);
   request.onupgradeneeded=()=>{const store=request.result.createObjectStore(STORE,{keyPath:['owner','fullname']});store.createIndex(INDEX,['owner','viewedAt']);};
   request.onsuccess=()=>resolve(request.result);request.onerror=()=>{opening=null;reject(request.error);};});
  const done=tx=>new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(tx.error);});
  const range=owner=>globalThis.IDBKeyRange.bound([owner,-Infinity],[owner,Infinity]);
  // Walks one account's views newest first; visit returns false to stop.
  const walk=(index,owner,visit)=>new Promise((resolve,reject)=>{const request=index.openCursor(range(owner),'prev');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const cursor=request.result;if(!cursor || visit(cursor)===false)resolve();else cursor.continue();};});
  async function trimOwner(owner,limit){
   if(!(limit>0))return;const db=await open(),tx=db.transaction(STORE,'readwrite');let seen=0;
   await walk(tx.objectStore(STORE).index(INDEX),owner,cursor=>{if(++seen>limit)cursor.delete();});await done(tx);
  }
  async function record({owner,item,limit}){
   const value=clean(item);if(!value || !ownerOK(owner))return false;owner=owner.toLowerCase();
   const db=await open(),tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put({...value,owner,viewedAt:now()});await done(tx);
   await trimOwner(owner,limit);return true;
  }
  async function load({owner,limit}){
   if(!ownerOK(owner))return [];owner=owner.toLowerCase();const db=await open(),tx=db.transaction(STORE,'readonly'),items=[];
   await walk(tx.objectStore(STORE).index(INDEX),owner,cursor=>{const {owner:_o,...value}=cursor.value;items.push(value);return !(limit>0 && items.length>=limit);});
   return items;
  }
  async function trimAll(limit){
   if(!(limit>0))return;const db=await open(),tx=db.transaction(STORE,'readwrite'),counts=new Map();
   await new Promise((resolve,reject)=>{const request=tx.objectStore(STORE).index(INDEX).openCursor(null,'prev');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const cursor=request.result;if(!cursor)return resolve();const n=(counts.get(cursor.value.owner) || 0)+1;counts.set(cursor.value.owner,n);if(n>limit)cursor.delete();cursor.continue();};});
   await done(tx);
  }
  async function clear(){const db=await open(),tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).clear();await done(tx);}
  return Object.freeze({record,load,trimAll,clear});
 }
 globalThis.RTViewedStore=Object.freeze({create,clean});
})();
