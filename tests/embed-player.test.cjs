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

test('viewport requests are ignored now that the player is not resized',async t=>{
 const {messages,send}=await player(t);
 await send('viewport',{request:3});
 assert.equal(messages.some(({data})=>data.rtMedia==='viewport'),false);
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

test('a provider sound button that pauses its current video keeps it playing at the same time',async t=>{
 const {W,video,send}=await player(t),button=W.document.querySelector('button');
 button.setAttribute('aria-label','Turn sound on');
 button.addEventListener('click',()=>{video.pause();video.muted=false;});
 await send('unmute');
 await new Promise(resolve=>setTimeout(resolve,150));
 assert.equal(video.muted,false);assert.equal(video.paused,false);assert.equal(video.currentTime,9);
});

test('link blocking leaves provider buttons inside a linked player usable',async t=>{
 const {W,send,click}=await player(t);
 const control=W.document.querySelector('button');
 W.document.querySelector('a').append(control);
 await send('policy',{block:true});
 let used=0;control.addEventListener('click',()=>used++);
 assert.equal(click(control),true);
 assert.equal(used,1);
});

test('the frame announces its available picture before it starts playing',async t=>{
 const {W,video,messages,send}=await player(t);
 await send('policy',{block:false});
 video.pause();
 Object.defineProperty(video,'readyState',{value:2});
 video.dispatchEvent(new W.Event('loadeddata'));
 assert.ok(messages.some(({data})=>data.rtMedia==='rendered'));
 assert.equal(video.paused,true);
});

test('a continuation waits for metadata and applies its time before playing',async t=>{
 const {W,video,send}=await player(t);
 let readiness=0;
 Object.defineProperty(video,'readyState',{get:()=>readiness});
 video.pause();
 await send('resume',{time:14,muted:true});
 assert.equal(video.currentTime,9);assert.equal(video.paused,true);
 readiness=1;video.dispatchEvent(new W.Event('loadedmetadata'));
 assert.equal(video.currentTime,14);assert.equal(video.muted,true);assert.equal(video.paused,false);
});

test('missing player scripts are restored only for already approved provider access',async t=>{
 const {W}=await player(t),registered=new Map();
 let permitted=false;
 const api={permissions:{contains:async()=>permitted},scripting:{
  getRegisteredContentScripts:async()=>[...registered.values()],
  registerContentScripts:async scripts=>{for(const script of scripts)registered.set(script.id,script);}
 }};
 assert.equal(await W.RTEmbedHosts.ensureScripts(api),false);
 assert.equal(registered.size,0);
 permitted=true;
 assert.equal(await W.RTEmbedHosts.ensureScripts(api),true);
 assert.deepEqual([...registered.keys()],['rt-embed-player','rt-embed-player-main']);
 assert.equal(registered.get('rt-embed-player').runAt,'document_start');
 assert.equal(registered.get('rt-embed-player-main').world,'MAIN');
 assert.equal(await W.RTEmbedHosts.ensureScripts(api),true);
 assert.equal(registered.size,2);
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

test('when holdFeed is false (passive default), a direct player never stalls on its first frame',async t=>{
 const {W,video}=await player(t,{authorized:{authorized:true,holdFeed:false}});
 video.dispatchEvent(new W.Event('play'));
 assert.equal(video.paused,false,'passive default does not hold playback');
});

test('a direct player applies volume, loop policy, and hold-for-2x enhancements',async t=>{
 const {W,video,send,click}=await player(t);
 W.__rtEmbedHold2xTest=true;
 Object.defineProperty(video,'duration',{value:18,configurable:true});
 video.getBoundingClientRect=()=>({left:0,top:0,width:400,height:240,bottom:240});
 await send('volume',{volume:0.4});
 assert.equal(video.volume,0.4);
 await send('loop',{policy:'short'});
 assert.equal(video.loop,true,'<30s video loops under short policy');
 Object.defineProperty(video,'duration',{value:45,configurable:true});
 video.dispatchEvent(new W.Event('durationchange'));
 assert.equal(video.loop,false,'>=30s video does not loop under short policy');
 await send('loop',{policy:'always'});
 assert.equal(video.loop,true);
 await send('hold2x',{enabled:true});
 const down=new W.MouseEvent('pointerdown',{bubbles:true,composed:true,button:0,clientX:200,clientY:100});
 Object.defineProperty(down,'pointerType',{value:'mouse'});
 video.dispatchEvent(down);
 await new Promise(r=>setTimeout(r,330));
 assert.equal(video.playbackRate,2);
 assert.ok(W.document.querySelector('[data-rt-speed-pill]'));
 W.dispatchEvent(new W.MouseEvent('pointerup',{bubbles:true}));
 assert.equal(video.playbackRate,1);
 assert.equal(W.document.querySelector('[data-rt-speed-pill]'),null);
 assert.equal(click(video),false,'trailing click after 2x hold is swallowed');
});
test('while the page previews it, a click on the video is a tap for the page and a click on its controls hands it over',async t=>{
 const {W,video,messages,send,click}=await player(t);
 W.__rtEmbedPreviewTest=true;
 await send('policy',{block:false});
 await send('play');
 const told=()=>messages.map(({data})=>data.rtMedia).filter(method=>method==='tap' || method==='take');
 assert.equal(click(video),true,'no preview: the player handles its own click');
 await send('preview',{on:true});
 const before=video.paused;
 assert.equal(click(video),false,'the video surface click is the page’s');
 assert.equal(video.paused,before,'the player does not toggle');
 assert.deepEqual(told(),['tap']);
 assert.equal(click(W.document.querySelector('button')),true,'its own controls stay usable');
 assert.deepEqual(told(),['tap','take']);
 assert.equal(click(video),true,'once taken, clicks are the player’s again');
 assert.deepEqual(told(),['tap','take']);
});
test('a start that follows input inside the player is reported as the viewer’s',async t=>{
 const {W,video,messages,send}=await player(t);
 await send('policy',{block:false});
 const plays=()=>messages.filter(({data})=>data.rtMedia==='play').map(({data})=>data.user);
 video.dispatchEvent(new W.Event('play'));
 assert.deepEqual(plays(),[false]);
 W.__rtEmbedPreviewTest=true;
 W.dispatchEvent(new W.MouseEvent('pointerdown',{bubbles:true}));
 video.dispatchEvent(new W.Event('play'));
 assert.deepEqual(plays(),[false,true]);
});

// Every embed provider (docs/video-control-spec.md, Direct embed controls for all providers).
test('every embed provider is a player address; only its embed page counts',async t=>{
 const {W}=await player(t),H=W.RTEmbedHosts;
 for(const url of ['https://www.youtube.com/embed/abc?enablejsapi=1','https://www.youtube-nocookie.com/embed/abc','https://www.dailymotion.com/embed/video/x1','https://www.tiktok.com/embed/v2/123','https://rumble.com/embed/v1abc/','https://player.kick.com/channel','https://platform.twitter.com/embed/Tweet.html?id=1','https://www.facebook.com/plugins/video.php?href=x'])
  assert.ok(H.playerOrigin(url),url);
 for(const url of ['https://www.youtube.com/watch?v=abc','https://www.facebook.com/someone','http://www.youtube.com/embed/abc','https://evil.example/embed/abc'])assert.equal(H.playerOrigin(url),'',url);
 assert.equal(H.isExtra('https://www.youtube.com'),true);assert.equal(H.isExtra('https://player.vimeo.com'),false);
 assert.ok(H.origins.every(origin=>H.allOrigins.includes(origin)) && H.extraOrigins.every(origin=>H.allOrigins.includes(origin)));
 assert.ok(!H.origins.some(origin=>origin.includes('youtube')),'an existing grant stays complete without the new providers');
 const manifest=JSON.parse(read('manifest.json'));for(const origin of H.allOrigins)assert.ok(manifest.optional_host_permissions.includes(origin),origin);
});
test('an existing grant keeps its players; granting a provider adds its frames to the registered scripts',async t=>{
 const {W}=await player(t),H=W.RTEmbedHosts,registered=new Map(),granted=new Set(H.origins);const updates=[];
 const api={permissions:{contains:async({origins})=>origins.every(origin=>granted.has(origin))},scripting:{
  getRegisteredContentScripts:async()=>[...registered.values()],
  registerContentScripts:async scripts=>{for(const script of scripts)registered.set(script.id,{...script});},
  updateContentScripts:async scripts=>{for(const script of scripts){updates.push(script.id);registered.get(script.id).matches=script.matches;}}
 }};
 assert.equal(await H.ensureScripts(api),true);
 assert.equal(registered.get('rt-embed-player').matches.some(match=>match.includes('youtube')),false);
 assert.deepEqual([...H.missingProviders((await H.access(api)).hosts).slice(0,2)],['YouTube','Dailymotion']);
 granted.add('https://www.youtube.com/*');
 assert.equal(await H.ensureScripts(api),true);
 assert.ok(registered.get('rt-embed-player').matches.includes('https://www.youtube.com/embed/*'));
 assert.deepEqual(updates,['rt-embed-player','rt-embed-player-main']);
 assert.equal(await H.ensureScripts(api),true);assert.equal(updates.length,2,'unchanged matches are left alone');
});
test('during a preview, YouTube’s own player chrome and menus hand the player over instead of tapping',async t=>{
 const {W,video,messages,send,click}=await player(t);
 W.__rtEmbedPreviewTest=true;
 const bar=W.document.createElement('div');bar.className='ytp-chrome-bottom';const inner=W.document.createElement('span');bar.append(inner);W.document.body.append(bar);
 const menu=W.document.createElement('div');menu.setAttribute('role','menuitem');W.document.body.append(menu);
 await send('preview',{on:true});
 const told=()=>messages.map(({data})=>data.rtMedia).filter(method=>method==='tap' || method==='take');
 assert.equal(click(inner),true);assert.deepEqual(told(),['take']);
 await send('preview',{on:true});
 assert.equal(click(menu),true);assert.deepEqual(told(),['take','take']);
 await send('preview',{on:true});
 assert.equal(click(video),false);assert.deepEqual(told(),['take','take','tap']);
});

test('a player announces again on the page\'s first message, so a hello sent before the page knew the frame is not lost',async t=>{
 const {messages,send}=await player(t);
 const hellos=()=>messages.filter(({data})=>data.rtMedia==='hello').length;
 const early=hellos();
 assert.ok(early>=1,'announced on load');
 await send('policy',{block:false});
 await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(hellos(),early+1,'re-announced once on first contact');
 await send('pause');await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(hellos(),early+1,'not on later messages');
});
