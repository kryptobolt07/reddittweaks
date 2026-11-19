const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM,ResourceLoader}=require('jsdom');
const read=file=>fs.readFileSync('extension/'+file,'utf8');
const reddit='https://www.reddit.com';

async function player(t,{authorized=true}={}){
 const html='<a href="https://www.redgifs.com/watch/demo"><video></video></a><button>Volume</button>';
 const resources=new ResourceLoader();resources.fetch=async()=>Buffer.from(html);
 const dom=new JSDOM('<iframe src="https://www.redgifs.com/ifr/demo"></iframe>',{url:reddit,runScripts:'outside-only',resources});
 t.after(()=>dom.window.close());
 const parent=dom.window,frame=parent.document.querySelector('iframe');
 await new Promise(resolve=>frame.addEventListener('load',resolve,{once:true}));
 const W=frame.contentWindow,video=W.document.querySelector('video'),messages=[];
 parent.postMessage=(data,origin)=>messages.push({data,origin});
 W.chrome={runtime:{sendMessage:async()=>authorized}};
 W.eval(read('embed-player-hosts.js'));
 W.eval(read('embed-player.js'));
 await new Promise(resolve=>setImmediate(resolve));
 let paused=false;
 video.muted=true;video.currentTime=9;
 Object.defineProperty(video,'paused',{get:()=>paused});
 video.play=()=>{paused=false;return Promise.resolve();};video.pause=()=>{paused=true;};
 const send=async(rtMedia,fields={},origin=reddit,source=parent)=>{
  W.dispatchEvent(new W.MessageEvent('message',{data:{rtMedia,...fields},origin,source}));
  await new Promise(resolve=>setImmediate(resolve));
 };
 const click=target=>target.dispatchEvent(new W.MouseEvent('click',{bubbles:true,cancelable:true}));
 return {W,video,messages,send,click};
}

test('a Reddit-embedded player unmutes in place and can block its source link without swallowing controls',async t=>{
 const {W,video,messages,send,click}=await player(t);
 await send('policy',{block:true});
 assert.ok(messages.some(({data,origin})=>data.rtMedia==='hello' && origin===reddit));
 await send('unmute');await new Promise(resolve=>setTimeout(resolve,150));assert.equal(video.muted,false,'unmuted, by the player’s own button or directly');assert.equal(video.currentTime,9);
 assert.equal(click(video),false);assert.equal(video.paused,true);
 assert.equal(click(video),false);assert.equal(video.paused,false);
 assert.equal(click(W.document.querySelector('button')),true);
 W.addEventListener('click',event=>{if(event.target===video)event.preventDefault();});
 await send('policy',{block:false});click(video);assert.equal(video.paused,false,'the preferred behavior updates without reloading');
});

test('an unauthorized frame or a message from another origin cannot change the player',async t=>{
 const blocked=await player(t,{authorized:false});
 await blocked.send('policy',{block:true});await blocked.send('unmute');assert.equal(blocked.video.muted,true);
 const allowed=await player(t);
 await allowed.send('policy',{block:true},'https://unrelated.example');
 await allowed.send('unmute',{},'https://unrelated.example');assert.equal(allowed.video.muted,true);
});

test('a player that starts by itself waits on its first frame until the Reddit page says play, and never holds the viewer back',async t=>{
 const {W,video,send}=await player(t);
 const started=()=>video.dispatchEvent(new W.Event('play'));
 video.currentTime=3;started();
 assert.equal(video.paused,true,'held before any instruction');assert.equal(video.currentTime,0,'on its first frame');
 await send('pause');video.play();started();assert.equal(video.paused,true,'an idle feed card stays on its first frame');
 W.dispatchEvent(new W.Event('pointerdown'));video.play();started();
 assert.equal(video.paused,true,'an untrusted event does not count as the viewer');
 await send('play');assert.equal(video.paused,false,'the page chose it: it plays');
 started();assert.equal(video.paused,false);
});
test('a player outside Reddit is let go at once',async t=>{
 const {W,video}=await player(t,{authorized:false});
 video.dispatchEvent(new W.Event('play'));
 assert.equal(video.paused,false);
});

test('a blocked player cannot open its own site from script',async()=>{
 const {JSDOM}=require('jsdom');
 const dom=new JSDOM('<iframe></iframe>',{runScripts:'outside-only'});const W=dom.window.frames[0];
 let opened=0;W.open=()=>{opened++;return {};};
 W.eval(fs.readFileSync('extension/embed-player-main.js','utf8'));
 W.open('https://example.test/watch');assert.equal(opened,1,'allowed by default');
 W.document.documentElement.setAttribute('data-rt-block-links','');
 assert.equal(W.open('https://example.test/watch'),null);assert.equal(opened,1,'blocked while the page asks');
 dom.window.close();
});
