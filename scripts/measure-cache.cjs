/* Synthetic measurement only; never reads the browser or private messages. */
const fs=require('node:fs'),vm=require('node:vm');
const {IDBFactory,IDBKeyRange}=require('fake-indexeddb');
const context=vm.createContext({indexedDB:new IDBFactory(),IDBKeyRange,TextEncoder});
for(const file of ['search-core.js','message-store.js'])vm.runInContext(fs.readFileSync(`extension/${file}`,'utf8'),context);
(async()=>{
  const store=new context.RCSMessageStore.Store(),owner='@synthetic:reddit.com';
  const start=performance.now();
  for(let room=0;room<1000;room++)await store.ingest({owner,roomId:`!room${room}:reddit.com`,events:Array.from({length:20},(_,i)=>({event_id:`$${room}-${i}`,type:'m.room.message',sender:owner,origin_server_ts:1791432000000+i*60000,content:{body:`Synthetic coffee message ${i}. `+'Example text for measuring a saved chat cache. '.repeat(6)}}))});
  const ingestMs=performance.now()-start,samples=[];
  for(let i=0;i<5;i++){const began=performance.now();const result=await store.search(owner,{query:'coffee',limit:200});samples.push(performance.now()-began);if(result.total!==20000)throw Error('Synthetic search coverage mismatch');}
  const stats=await store.stats(owner);samples.sort((a,b)=>a-b);
  console.log(JSON.stringify({environment:'Node + fake-indexeddb (synthetic, not browser disk usage)',...stats.stats,ingestMs:Math.round(ingestMs),globalSearchMedianMs:Math.round(samples[2]),globalSearchMaxMs:Math.round(samples[4]),approxMiB:Number((stats.stats.approxBytes/1024/1024).toFixed(2))},null,2));
  (await store.db()).close();
})().catch(error=>{console.error(error);process.exitCode=1;});
