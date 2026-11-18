// Videos (docs/video-control-spec.md): Reddit's autoplay preference enforced, and pausing when scrolled away.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const flush=async()=>{for(let i=0;i<6;i++)await new Promise(r=>setTimeout(r,0));};
function page(t,{owner='t2_alice'}={}){
 const dom=new JSDOM('<!doctype html><body><shreddit-app user-logged-in="'+Boolean(owner)+'" logged-in-user-id="'+owner+'"></shreddit-app><shreddit-player id="p1"></shreddit-player></body>',{url:'https://www.reddit.com/r/videos/',runScripts:'outside-only',pretendToBeVisual:true}),W=dom.window;t.after(()=>W.close());
 // jsdom has no media playback: a playing flag stands in for it.
 Object.defineProperty(W.HTMLMediaElement.prototype,'paused',{get(){return !this._playing;},configurable:true});W.HTMLMediaElement.prototype.pause=function(){this._playing=false;};
 const io={cb:null};W.IntersectionObserver=class{constructor(cb,o){io.cb=cb;io.options=o;}observe(){}unobserve(){}disconnect(){}};
 const player=W.document.getElementById('p1'),root=player.attachShadow({mode:'open'});root.innerHTML='<button id="play">Play</button><video></video>';
 W.__rtVideoControlTest=true;W.eval(fs.readFileSync('extension/video-control.js','utf8'));
 const video=root.querySelector('video'),start=()=>{video._playing=true;video.dispatchEvent(new W.Event('play'));};
 return {W,d:W.document,player,root,video,start,io};
}
const settingsHtml=disabled=>'<settings-preferences initialstate="{&quot;isNsfwMediaBlocked&quot;:true,&quot;isVideoAutoplayDisabled&quot;:'+disabled+',&quot;language&quot;:&quot;en&quot;}"></settings-preferences>';
test('Reddit’s autoplay preference is read from its settings page once per session and account',async t=>{
 const {W,d}=page(t),store=new Map(),storage={getItem:k=>store.get(k) ?? null,setItem:(k,v)=>store.set(k,v)};let fetches=0;
 const fetcher=async url=>{fetches++;assert.equal(url,'/settings/preferences');return {text:async()=>settingsHtml(true)};};
 assert.equal(await W.RTVideoControl.readAutoplayDisabled({doc:d,fetcher,store:storage}),true);assert.equal(await W.RTVideoControl.readAutoplayDisabled({doc:d,fetcher,store:storage}),true);assert.equal(fetches,1,'cached');
 d.querySelector('shreddit-app').setAttribute('logged-in-user-id','t2_bob');assert.equal(await W.RTVideoControl.readAutoplayDisabled({doc:d,fetcher:async()=>({text:async()=>settingsHtml(false)}),store:storage}),false,'another account reads its own');
 d.querySelector('shreddit-app').setAttribute('user-logged-in','false');assert.equal(await W.RTVideoControl.readAutoplayDisabled({doc:d,fetcher,store:storage}),null,'signed out: nothing is enforced');
});
test('with autoplay off, a video Reddit starts is paused; one you tap plays; the switch turns it off',async t=>{
 const {W,d,player,root,video,start}=page(t);const v=new W.RTVideoControl.Videos({readSettings:async()=>({videoPreviews:false}),readPreference:async()=>true,observe:false});await v.ready;await flush();
 start();assert.equal(video.paused,true,'Reddit’s autoplay is stopped');assert.equal(player.dataset.rtAutoplayBlocked,'true');
 root.getElementById('play').dispatchEvent(new W.Event('pointerdown',{bubbles:true,composed:true}));start();assert.equal(video.paused,false,'your tap plays');
 const off=page(t);const v2=new off.W.RTVideoControl.Videos({readSettings:async()=>({videoRespectAutoplay:false}),readPreference:async()=>true,observe:false});await v2.ready;await flush();off.start();assert.equal(off.video.paused,false,'switch off: Reddit decides');
 const on=page(t);const v3=new on.W.RTVideoControl.Videos({readSettings:async()=>({}),readPreference:async()=>false,observe:false});await v3.ready;await flush();on.start();assert.equal(on.video.paused,false,'autoplay on in Reddit: kept');
});
test('a video Reddit started before the preference arrived is paused when it does',async t=>{
 const {W,video,start}=page(t);let resolve;const v=new W.RTVideoControl.Videos({readSettings:async()=>({videoPreviews:false}),readPreference:()=>new Promise(r=>resolve=r),observe:false});await v.ready;
 start();assert.equal(video.paused,false);resolve(true);await flush();assert.equal(video.paused,true);
});
test('a playing video pauses once less than half of it is on screen, and stays paused',async t=>{
 const {W,player,video,io}=page(t);const v=new W.RTVideoControl.Videos({readSettings:async()=>({}),readPreference:async()=>false,observe:false});await v.ready;await flush();
 assert.deepEqual([...io.options.threshold],[0,0.5,1]);video._playing=true;
 io.cb([{target:player,intersectionRatio:0.8}]);assert.equal(video.paused,false);io.cb([{target:player,intersectionRatio:0.3}]);assert.equal(video.paused,true);assert.equal(player.dataset.rtPausedAway,'true');
 const off=page(t);const v2=new off.W.RTVideoControl.Videos({readSettings:async()=>({videoPauseOffscreen:false}),readPreference:async()=>false,observe:false});await v2.ready;off.video._playing=true;off.io.cb([{target:off.player,intersectionRatio:0}]);assert.equal(off.video.paused,false,'switch off');
});
test('silent previews: Reddit’s autoplay becomes a muted 10 s loop marked Preview that never advances; your tap starts from the beginning with sound',async t=>{
 const {W,player,root,video,start,io}=page(t);let plays=0;W.HTMLMediaElement.prototype.play=function(){plays++;this._playing=true;return Promise.resolve();};
 const v=new W.RTVideoControl.Videos({readSettings:async()=>({videoPreviews:true}),readPreference:async()=>true,observe:false});await v.ready;await flush();
 video.currentTime=0;video.muted=false;start();assert.equal(video.paused,false,'keeps playing as a preview');assert.equal(video.muted,true,'without sound');assert.equal(player.dataset.rtPreview,'true');
 video.currentTime=10.4;video.dispatchEvent(new W.Event('timeupdate'));assert.equal(video.currentTime,0,'loops the first 10 s');
 video.currentTime=6;io.cb([{target:player,intersectionRatio:0.2}]);assert.equal(video.paused,true,'stops when scrolled away');assert.equal(video.currentTime,0,'and does not advance');
 start();video.currentTime=4;root.getElementById('play').dispatchEvent(new W.Event('pointerdown',{bubbles:true,composed:true}));await flush();
 assert.equal(player.dataset.rtPreview,undefined,'your tap ends the preview');assert.equal(video.currentTime,0,'from the beginning');assert.equal(video.muted,false,'with Reddit’s sound');assert.equal(video.paused,false);
 const off=page(t);const v2=new off.W.RTVideoControl.Videos({readSettings:async()=>({videoPreviews:false}),readPreference:async()=>true,observe:false});await v2.ready;await flush();off.start();assert.equal(off.video.paused,true,'option off: plain pause');assert.equal(off.player.dataset.rtPreview,undefined);
});
