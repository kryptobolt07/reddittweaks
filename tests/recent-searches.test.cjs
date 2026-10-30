const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const vm=require('node:vm');
const source=file=>readFileSync(join(__dirname,'..',file),'utf8');
const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
// In-memory chrome.storage.local with async methods, like the real API.
function storage() {
  const data={};
  return {data,async get(keys){if(keys===null)return clone(data);return Object.fromEntries([].concat(keys).filter(key=>key in data).map(key=>[key,clone(data[key])]));},
    async set(value){await Promise.resolve();Object.assign(data,clone(value));},
    async remove(keys){await Promise.resolve();for(const key of [].concat(keys))delete data[key];},
    async clear(){for(const key of Object.keys(data))delete data[key];},async setAccessLevel(){}};
}
// Loads the store into an isolated world, as the content script does.
function recents(local=storage()) {
  const context=vm.createContext({chrome:{storage:{local}},Date,Map,Set,Promise,Math,Object,Array,Number,String,TypeError});
  vm.runInContext(source('extension/recent-searches.js'),context);
  // Results come from the vm realm; copy them so deepEqual compares plain outer-realm values.
  const plain=fn=>async(...args)=>JSON.parse(JSON.stringify(await fn(...args)));
  const api=Object.fromEntries(['list','add','remove','clear'].map(name=>[name,plain(context.RTRecentSearches[name])]));
  return {local,api};
}
const owner='t2_synthetic_me',scope='profile:synthetic_user',other='subreddit:synthetic_sub';
const queries=list=>list.map(entry=>entry.q);
const countAll=local=>Object.values(local.data).reduce((n,record)=>n+Object.values(record.scopes).reduce((m,list)=>m+list.length,0),0);

test('add lists newest first and ignores empty or oversized queries',async()=>{
  const {api}=recents();
  await api.add(owner,scope,'first');await api.add(owner,scope,'  second  ');await api.add(owner,scope,'   ');await api.add(owner,scope,'');await api.add(owner,scope,'x'.repeat(257));
  const list=await api.list(owner,scope);
  assert.deepEqual(queries(list),['second','first']);
  assert.ok(Number.isFinite(list[0].at));
  await api.add(owner,scope,'x'.repeat(256));assert.equal((await api.list(owner,scope))[0].q.length,256);
});

test('re-adding a query moves it to the top case-insensitively without duplicating it',async()=>{
  const {api}=recents();
  await api.add(owner,scope,'Alpha');await api.add(owner,scope,'beta');await api.add(owner,scope,'ALPHA');
  assert.deepEqual(queries(await api.list(owner,scope)),['ALPHA','beta']);
});

test('each scope keeps at most eight entries, dropping the oldest',async()=>{
  const {api}=recents();
  for(let i=1;i<=10;i++)await api.add(owner,scope,'q'+i);
  assert.deepEqual(queries(await api.list(owner,scope)),['q10','q9','q8','q7','q6','q5','q4','q3']);
});

test('an account keeps at most forty entries and trims the least recently used scope first',async()=>{
  const {api,local}=recents();
  for(let s=0;s<5;s++)for(let i=0;i<8;i++)await api.add(owner,`profile:s${s}`,`s${s}-${i}`);
  assert.equal(countAll(local),40);
  // Scope s0 is the least recently used, so its oldest entry goes first.
  await api.add(owner,'profile:fresh','newest');
  assert.equal(countAll(local),40);
  const s0=await api.list(owner,'profile:s0');
  assert.equal(s0.length,7);assert.equal(s0.at(-1).q,'s0-1');
  for(let s=1;s<5;s++)assert.equal((await api.list(owner,`profile:s${s}`)).length,8);
  assert.deepEqual(queries(await api.list(owner,'profile:fresh')),['newest']);
});

test('eviction empties the least recent scope completely before newer scopes lose entries',async()=>{
  const {api,local}=recents();
  for(let i=0;i<4;i++)await api.add(owner,'profile:a',`a${i}`);
  for(const name of ['b','c','d','e'])for(let i=0;i<8;i++)await api.add(owner,`profile:${name}`,`${name}${i}`);
  assert.equal(countAll(local),36);
  for(let i=0;i<8;i++)await api.add(owner,'profile:f',`f${i}`);
  assert.equal(countAll(local),40);
  assert.deepEqual(await api.list(owner,'profile:a'),[]);
  for(const name of ['b','c','d','e'])assert.equal((await api.list(owner,`profile:${name}`)).length,8);
  assert.equal(Object.keys(local.data['rt-recent-v1:'+owner].scopes).includes('profile:a'),false);
});

test('remove deletes matching entries case-insensitively and drops empty scopes',async()=>{
  const {api,local}=recents();
  await api.add(owner,scope,'Keep');await api.add(owner,scope,'Drop');await api.add(owner,other,'only');
  assert.deepEqual(queries(await api.remove(owner,scope,'  DROP ')),['Keep']);
  assert.deepEqual(await api.remove(owner,other,'only'),[]);
  assert.equal(local.data['rt-recent-v1:'+owner].scopes[other],undefined);
  assert.deepEqual(queries(await api.list(owner,scope)),['Keep']);
});

test('clear removes one scope, and clear without a scope removes every scope for that owner only',async()=>{
  const {api,local}=recents();
  await api.add(owner,scope,'one');await api.add(owner,other,'two');await api.add('t2_other_account',scope,'three');
  assert.deepEqual(await api.clear(owner,scope),[]);
  assert.deepEqual(queries(await api.list(owner,other)),['two']);
  assert.deepEqual(queries(await api.list('t2_other_account',scope)),['three']);
  await api.clear(owner);
  assert.deepEqual(await api.list(owner,other),[]);
  assert.deepEqual(queries(await api.list('t2_other_account',scope)),['three']);
  assert.deepEqual(Object.keys(local.data),['rt-recent-v1:t2_other_account']);
});

test('invalid owners, scopes and queries are ignored without writing storage',async()=>{
  const {api,local}=recents();
  await api.add(owner,scope,'valid');
  const before=JSON.stringify(local.data);
  for(const bad of ['','a'.repeat(65),'bad owner','@owner:reddit.com',null,42])assert.deepEqual(await api.add(bad,scope,'x'),[]);
  for(const bad of ['profile:','PROFILE:Name','profile:has space','user:name','subreddit:'+'a'.repeat(65),'profile:Name',undefined,null])assert.deepEqual(await api.add(owner,bad,'x'),[]);
  assert.deepEqual(await api.list('bad owner',scope),[]);assert.deepEqual(await api.list(owner,'profile:Name'),[]);
  assert.deepEqual(await api.clear('bad owner'),[]);assert.deepEqual(await api.clear(owner,'profile:Name'),[]);
  assert.equal(JSON.stringify(local.data),before);
  assert.deepEqual(queries(await api.list(owner,scope)),['valid']);
});

test('concurrent adds for one account all survive',async()=>{
  const {api}=recents();
  await Promise.all(['one','two','three','four','five'].map(query=>api.add(owner,scope,query)));
  assert.deepEqual(queries(await api.list(owner,scope)).sort(),['five','four','one','three','two']);
});

test('concurrent adds and removes across accounts keep each account consistent',async()=>{
  const {api}=recents();
  await Promise.all([api.add(owner,scope,'a'),api.add('t2_other_account',scope,'b'),api.add(owner,scope,'c'),api.remove(owner,scope,'a'),api.add(owner,other,'d')]);
  assert.deepEqual(queries(await api.list(owner,scope)),['c']);
  assert.deepEqual(queries(await api.list('t2_other_account',scope)),['b']);
  assert.deepEqual(queries(await api.list(owner,other)),['d']);
});

test('malformed stored data is ignored when read',async()=>{
  const local=storage();const {api}=recents(local);
  local.data['rt-recent-v1:'+owner]={scopes:{[scope]:[{q:'good',at:5},{q:'',at:6},{q:'bad'},null,'x'],'nope:thing':[{q:'hidden',at:7}]}};
  assert.deepEqual(queries(await api.list(owner,scope)),['good']);
  assert.deepEqual(await api.list(owner,'nope:thing'),[]);
});

// The clear path lives in the cache broker, loaded the way the service worker loads it.
function broker() {
  const local=storage(),handlers=[];
  const chrome={storage:{local,session:storage()},tabs:{query:async()=>[],sendMessage:async()=>{}},runtime:{id:'test-extension',getURL:path=>'chrome-extension://test-extension/'+path,onMessage:{addListener(fn){handlers.push(fn);}}}};
  const context=vm.createContext({chrome,crypto:require('node:crypto').webcrypto,Date,Map,Promise,TextEncoder});
  context.importScripts=(...files)=>{for(const file of files)vm.runInContext(source('extension/'+file),context);};
  vm.runInContext(source('extension/cache-broker.js'),context);
  const send=(message,from)=>new Promise(resolve=>{for(const handler of handlers)handler({scope:'rcs-messages',...message},from,resolve);});
  return {local,send};
}
const popup={id:'test-extension',url:'chrome-extension://test-extension/popup.html'};

test('clear saved messages removes rt-recent-v1 keys for the owner only when an owner is given',async()=>{
  const cache=broker();
  // The chat account format passes the broker's owner check; the same string is used as the key suffix.
  const me='@t2_me:reddit.com',others='@t2_other:reddit.com';
  Object.assign(cache.local.data,{[`rt-recent-v1:${me}`]:{scopes:{}},[`rt-recent-v1:${others}`]:{scopes:{}},[`rcs-unified-recent:${me}`]:['chat'],unrelated:{keep:true}});
  assert.equal((await cache.send({action:'clear',owner:me},popup)).cleared,true);
  assert.deepEqual(Object.keys(cache.local.data).sort(),[`rt-recent-v1:${others}`,'unrelated']);
});

test('clear saved messages without an owner clears every rt-recent-v1 scope and leaves other keys',async()=>{
  const cache=broker();
  const {api}=recents(cache.local);
  await api.add('t2_me',scope,'mine');await api.add('t2_me',other,'mine too');await api.add('t2_other',scope,'theirs');
  cache.local.data.unrelated={keep:true};
  await cache.send({action:'clear'},popup);
  assert.deepEqual(cache.local.data,{unrelated:{keep:true}});
});
