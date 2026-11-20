const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

test('poster lookup uses public provider metadata only for verified Reddit tabs, without an API request to Reddit',async()=>{
 const calls=[],handlers=[];
 const chrome={runtime:{id:'extension',onMessage:{addListener:handler=>handlers.push(handler)}},permissions:{contains:async()=>true}};
 const context=vm.createContext({chrome,URL,AbortSignal,fetch:async (url,options)=>{
  calls.push({url,options});
  return {ok:true,text:async()=>'<meta content="https://media.redgifs.com/Sample-mobile.jpg" name="twitter:image">'};
 }});
 for(const name of ['embed-player-hosts.js','embed-poster-broker.js'])vm.runInContext(fs.readFileSync('extension/'+name,'utf8'),context);
 const ask=(tabUrl,items)=>new Promise(resolve=>handlers[0]({scope:'rt-embed-posters',items},{id:'extension',url:tabUrl,frameId:0},value=>resolve(JSON.parse(JSON.stringify(value)))));
 const items=[['t3_alpha','https://www.redgifs.com/ifr/sample?unused=tracking'],['t3_beta','https://unrelated.example/player']];
 assert.deepEqual(await ask('https://www.reddit.com/r/example/',items),{t3_alpha:'https://media.redgifs.com/Sample-mobile.jpg'});
 assert.deepEqual(await ask('https://unrelated.example/',items),{});
 assert.deepEqual(await ask('https://www.reddit.com/r/example/',items.slice(0,1)),{t3_alpha:'https://media.redgifs.com/Sample-mobile.jpg'});
 assert.equal(calls.length,1);assert.equal(calls[0].url,'https://www.redgifs.com/ifr/sample');assert.equal(calls[0].options.credentials,'omit');
});

test('poster lookup skips an unsupported metadata image and retains a later allowed image',async()=>{
 const handlers=[];
 const chrome={runtime:{id:'extension',onMessage:{addListener:handler=>handlers.push(handler)}},permissions:{contains:async()=>true}};
 const fetch=async()=>({ok:true,text:async()=>'<meta property="og:image" content="https://invalid.example/default.jpg"><meta name="twitter:image:src" content="https://thumbs2.redgifs.com/SampleCamel-poster.jpg">'});
 const context=vm.createContext({chrome,URL,AbortSignal,fetch});
 for(const name of ['embed-player-hosts.js','embed-poster-broker.js'])vm.runInContext(fs.readFileSync('extension/'+name,'utf8'),context);
 const items=[['t3_alpha','https://www.redgifs.com/ifr/samplecamel']];
 const result=await new Promise(resolve=>handlers[0]({scope:'rt-embed-posters',items},{id:'extension',url:'https://www.reddit.com/',frameId:0},resolve));
 assert.equal(result.t3_alpha,'https://thumbs2.redgifs.com/SampleCamel-poster.jpg');
});
