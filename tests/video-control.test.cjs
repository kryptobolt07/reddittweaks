// Videos (docs/video-control-spec.md): Reddit's autoplay preference enforced, and pausing when scrolled away.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const flush=async()=>{for(let i=0;i<6;i++)await new Promise(r=>setTimeout(r,0));};
const postPath='/r/videos/comments/test/test_video/';
const continuationKey='rt-video-continue-v1';
function page(t,{owner='t2_alice',detail=false}={}){
 const dom=new JSDOM('<!doctype html><body><shreddit-app user-logged-in="'+Boolean(owner)+'" logged-in-user-id="'+owner+'"></shreddit-app><shreddit-post id="t3_test"><a slot="title" href="'+postPath+'">Video title</a><a href="/user/example/">Author</a><shreddit-player id="p1" post-id="t3_test" player-type="'+(detail?'post_detail_screen':'in_feed_player')+'"></shreddit-player></shreddit-post></body>',{url:'https://www.reddit.com'+(detail?postPath:'/r/videos/'),runScripts:'outside-only',pretendToBeVisual:true}),W=dom.window;t.after(()=>W.close());
 // jsdom has no media playback: a playing flag stands in for it.
 Object.defineProperty(W.HTMLMediaElement.prototype,'paused',{get(){return !this._playing;},configurable:true});W.HTMLMediaElement.prototype.pause=function(){this._playing=false;};
 const io={cb:null,observed:[],unobserved:[]};
 W.IntersectionObserver=class{constructor(cb,o){io.cb=cb;io.options=o;}observe(player){io.observed.push(player);}unobserve(player){io.unobserved.push(player);}disconnect(){}};
 const player=W.document.getElementById('p1'),root=player.attachShadow({mode:'open'});root.innerHTML='<button id="play" class="play-pause-button">Play</button><button id="mute" class="mute-button">Mute</button><button id="cc">Captions</button><video></video>';
 W.__rtVideoControlTest=true;W.eval(fs.readFileSync('extension/video-control.js','utf8'));
 const video=root.querySelector('video'),start=()=>{video._playing=true;video.dispatchEvent(new W.Event('play'));};
 const click=(target,options)=>target.dispatchEvent(new W.MouseEvent('click',{bubbles:true,cancelable:true,composed:true,...options}));
 const title=W.document.querySelector('[slot="title"]');W.document.addEventListener('click',event=>event.preventDefault());
 const startFromControl=()=>{root.getElementById('play').dispatchEvent(new W.Event('pointerdown',{bubbles:true,composed:true}));start();};
 return {W,d:W.document,player,root,video,start,startFromControl,click,title,io};
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
test('a playing feed video carries its position into its post, and the scroll-away knob still pauses it',async t=>{
 const a=page(t);a.video.currentTime=12.5;a.video.muted=false;
 const va=new a.W.RTVideoControl.Videos({readSettings:async()=>({}),readPreference:async()=>false,observe:false});await va.ready;await flush();
 a.startFromControl();a.click(a.title);
 a.video.currentTime=13.75;a.video.volume=0.4;a.video.playbackRate=1.5;
 a.W.dispatchEvent(new a.W.Event('pagehide'));
 const saved=a.W.sessionStorage.getItem(continuationKey);assert.ok(saved,'the click remembers the playing position');
 const b=page(t,{detail:true});b.W.sessionStorage.setItem(continuationKey,saved);
 let plays=0;b.W.HTMLMediaElement.prototype.play=function(){plays++;this._playing=true;return Promise.resolve();};
 Object.defineProperty(b.video,'duration',{value:30,configurable:true});Object.defineProperty(b.video,'readyState',{value:1,configurable:true});
 const v=new b.W.RTVideoControl.Videos({readSettings:async()=>({videoContinueOnOpen:true}),readPreference:async()=>true,observe:false});await v.ready;await flush();
 assert.equal(b.video.currentTime,13.75,'the post resumes at the position reached when the feed page left');assert.equal(b.video.muted,false);assert.equal(b.video.volume,0.4);assert.equal(b.video.playbackRate,1.5);assert.equal(b.video._playing,true);assert.equal(plays,1);
 assert.equal(b.W.sessionStorage.getItem(continuationKey),null,'the handoff is used once');
 b.io.cb([{target:b.player,intersectionRatio:0.2}]);assert.equal(b.video.paused,true,'scrolling it away still pauses it');
 const c=page(t,{detail:true});c.W.sessionStorage.setItem(continuationKey,saved);Object.defineProperty(c.video,'duration',{value:30,configurable:true});Object.defineProperty(c.video,'readyState',{value:1,configurable:true});
 const off=new c.W.RTVideoControl.Videos({readSettings:async()=>({videoContinueOnOpen:false}),readPreference:async()=>false,observe:false});await off.ready;await flush();assert.equal(c.video.currentTime,0,'switch off');
});
test('only opening the playing video’s own post in the same tab prepares continuation',async t=>{
 const p=page(t);
 const controller=new p.W.RTVideoControl.Videos({readPreference:async()=>false,observe:false});await controller.ready;
 p.video.currentTime=4;p.start();p.click(p.title);
 assert.equal(p.W.sessionStorage.getItem(continuationKey),null,'native autoplay did not start with a media gesture');
 p.startFromControl();
 for(const [target,options] of [[p.root.querySelector('button'),{}],[p.d.querySelector('a[href^="/user"]'),{}],[p.title,{ctrlKey:true}],[p.title,{button:1}]]){
  p.click(target,options);assert.equal(p.W.sessionStorage.getItem(continuationKey),null);
 }
 p.title.target='_blank';p.click(p.title);assert.equal(p.W.sessionStorage.getItem(continuationKey),null);
 p.title.removeAttribute('target');p.video.pause();p.click(p.title);assert.equal(p.W.sessionStorage.getItem(continuationKey),null);
});
test('a late detail video takes over at its first metadata event while the SPA feed keeps playing',async t=>{
 const p=page(t);
 const controller=new p.W.RTVideoControl.Videos({readPreference:async()=>true,observe:false});await controller.ready;
 p.video.currentTime=8;p.startFromControl();p.click(p.title);
 p.W.history.pushState({},'',postPath);
 const duplicate=p.player.cloneNode();duplicate.attachShadow({mode:'open'}).append(p.d.createElement('video'));p.player.after(duplicate);
 controller.scan();
 assert.ok(p.W.sessionStorage.getItem(continuationKey),'a feed player on the new URL does not consume it');
 const detail=p.player.cloneNode();detail.setAttribute('player-type','post_detail_screen');p.player.after(detail);
 const root=detail.attachShadow({mode:'open'});controller.scan();
 assert.equal(p.video.paused,false,'opening the post leaves the feed player running');
 p.io.cb([{target:p.player,intersectionRatio:0}]);
 assert.equal(p.video.paused,false,'a transient layout collapse does not pause the outgoing player');
 p.video.currentTime=9.25;p.video.dispatchEvent(new p.W.Event('timeupdate'));
 const video=p.d.createElement('video');root.append(video);
 let preloads=0;detail.addEventListener('rt-prepare-detail-video',()=>preloads++);
 controller.scan();controller.scan();
 assert.equal(preloads,1,'a lazy detail player is asked to load metadata once');
 let playedAt;
 video.play=function(){playedAt=this.currentTime;this._playing=true;this.dispatchEvent(new p.W.Event('play'));return Promise.resolve();};
 Object.defineProperty(video,'readyState',{value:1});video.dispatchEvent(new p.W.Event('loadedmetadata'));
 assert.equal(playedAt,9.25);
 assert.equal(video.paused,false,'continuation is allowed with native autoplay disabled');
 assert.equal(p.video.paused,true,'only one player continues');
 assert.equal(p.W.sessionStorage.getItem(continuationKey),null);
});
test('returning to the feed before metadata arrives cancels the pending detail playback',async t=>{
 const p=page(t);
 const controller=new p.W.RTVideoControl.Videos({readPreference:async()=>false,observe:false});await controller.ready;
 p.video.currentTime=8;p.startFromControl();p.click(p.title);
 p.W.history.pushState({},'',postPath);
 const detail=p.player.cloneNode();detail.setAttribute('player-type','post_detail_screen');p.player.after(detail);
 const video=p.d.createElement('video');detail.attachShadow({mode:'open'}).append(video);controller.scan();
 p.W.history.replaceState({},'','/r/videos/');p.W.dispatchEvent(new p.W.PopStateEvent('popstate'));
 Object.defineProperty(video,'readyState',{value:1});video.dispatchEvent(new p.W.Event('loadedmetadata'));
 assert.equal(video.currentTime,0);
 assert.equal(p.W.sessionStorage.getItem(continuationKey),null);
});
function nativeMove(p){
 for(const name of ['post-model.js','post-page-bridge.js'])p.W.eval(fs.readFileSync('extension/'+name,'utf8'));
 const main=p.d.createElement('main');
 p.d.body.append(main);main.append(p.player.closest('shreddit-post'));
 const calls=[];
 p.player.mediaFbpController={
  shouldPreserveMedia(){return false;},
  beginDomReparent(){calls.push('begin');},
  endDomReparent(){calls.push('end');}
 };
 p.player.pause=function(){p.video.pause();};
 p.player.getBoundingClientRect=()=>({left:100,top:160,width:640,height:360});
 return calls;
}
test('the same playing media survives feed removal and moves into the detail slot without another play',async t=>{
 const p=page(t),calls=nativeMove(p);
 const controller=new p.W.RTVideoControl.Videos({readPreference:async()=>false,observe:false});await controller.ready;
 p.startFromControl();p.video.currentTime=8;
 const feed=p.player.parentElement;
 const surface=feed.closest('main');
 const style=p.d.createElement('style');
 style.textContent=fs.readFileSync('extension/post-discovery.css','utf8').split('\n').find(line=>line.startsWith('[data-rt-video-outgoing]'));
 p.d.head.append(style);
 p.click(p.title);
 assert.notEqual(p.player.parentElement,feed);
 assert.equal(surface.hasAttribute('data-rt-video-outgoing'),true,'conceal the still-mounted feed during navigation');
 assert.equal(p.W.getComputedStyle(surface).visibility,'hidden');
 assert.equal(p.player.closest('[data-rt-video-outgoing]'),null,'the held video remains visible');
 assert.deepEqual(calls,['begin']);
 p.player.pause('background');
 assert.equal(p.video.paused,false,'Reddit’s navigation pause leaves the held player running');
 p.W.history.pushState({},'',postPath);
 feed.remove();
 p.io.cb([{target:p.player,intersectionRatio:0}]);
 assert.equal(p.video.isConnected,true,'the departed feed does not disconnect its video');
 assert.equal(p.video.paused,false);
 p.video.currentTime=9.25;
 const detail=p.d.createElement('shreddit-post');detail.id='t3_test';
 const shell=p.player.cloneNode();shell.setAttribute('player-type','post_detail_screen');shell.className='detail-layout';
 detail.append(shell);p.d.body.append(detail);controller.scan();
 assert.equal(detail.querySelector('shreddit-player'),p.player);
 assert.equal(p.player.shadowRoot.querySelector('video'),p.video);
 assert.equal(p.video.currentTime,9.25);assert.equal(p.video.paused,false);
 assert.equal(p.player.className,'detail-layout');
 assert.equal(feed.querySelector('shreddit-player').getAttribute('player-type'),'in_feed_player','a cached feed still has its player when restored');
 assert.equal(surface.hasAttribute('data-rt-video-outgoing'),false,'the old feed can be drawn on Back');
 assert.deepEqual(calls,['begin','end']);
 assert.equal(p.W.sessionStorage.getItem(continuationKey),null);
 p.player.pause('background');
 assert.equal(p.video.paused,true,'normal pause behavior resumes after placement');
});
test('cancelling before the detail slot mounts restores the playing player to its original feed',async t=>{
 const p=page(t),calls=nativeMove(p);
 const controller=new p.W.RTVideoControl.Videos({readPreference:async()=>false,observe:false});await controller.ready;
 p.startFromControl();
 const feed=p.player.parentElement;p.click(p.title);
 assert.notEqual(p.player.parentElement,feed);
 p.W.dispatchEvent(new p.W.PopStateEvent('popstate'));
 assert.equal(p.player.parentElement,feed);
 assert.equal(feed.closest('main').hasAttribute('data-rt-video-outgoing'),false);
 assert.equal(p.video.paused,false);
 assert.deepEqual(calls,['begin','end']);
});
test('placement ignores old visibility readings and observes the painted post for scroll-away pauses',async t=>{
 const p=page(t);nativeMove(p);
 const controller=new p.W.RTVideoControl.Videos({readPreference:async()=>false,observe:false});await controller.ready;
 const frames=[];
 p.W.requestAnimationFrame=callback=>frames.push(callback);
 p.startFromControl();p.click(p.title);
 p.W.history.pushState({},'',postPath);
 const detail=p.player.cloneNode();detail.setAttribute('player-type','post_detail_screen');
 p.d.querySelector('main shreddit-post').append(detail);
 controller.scan();
 assert.equal(p.player.getAttribute('player-type'),'post_detail_screen');
 assert.equal(p.d.querySelector('main').hasAttribute('data-rt-video-outgoing'),false,'a reused main can paint the incoming post');
 assert.equal(p.io.unobserved.at(-1),p.player);
 const stale={target:p.player,intersectionRatio:0,time:p.W.performance.now()};
 p.io.cb([stale]);assert.equal(p.video.paused,false);
 frames.shift()();frames.shift()();
 assert.equal(p.io.observed.filter(player=>player===p.player).length,2);
 p.io.cb([stale]);assert.equal(p.video.paused,false,'a queued feed entry cannot pause the detail player');
 p.io.cb([{target:p.player,intersectionRatio:0.3,time:p.W.performance.now()}]);
 assert.equal(p.video.paused,true,'fresh geometry still pauses real scroll-away');
});
test('post placement eases the same player and defers visibility tracking for the movement',async t=>{
 const p=page(t);nativeMove(p);
 const controller=new p.W.RTVideoControl.Videos({readPreference:async()=>false,observe:false});await controller.ready;
 let finish;
 const animation={finished:new Promise(resolve=>{finish=resolve;})},frames=[];
 p.W.requestAnimationFrame=callback=>frames.push(callback);
 p.player.getBoundingClientRect=()=>p.player.getAttribute('player-type')==='in_feed_player'
  ? {left:120,top:140,width:700,height:394} : {left:140,top:180,width:740,height:416};
 p.player.animate=keyframes=>{assert.match(keyframes[0].transform,/translate\(/);return animation;};
 p.player.getAnimations=()=>[animation];
 p.startFromControl();p.click(p.title);p.W.history.pushState({},'',postPath);
 const detail=p.player.cloneNode();detail.setAttribute('player-type','post_detail_screen');
 p.d.querySelector('main shreddit-post').append(detail);controller.scan();
 assert.equal(animation.id,'rt-video-placement');assert.equal(frames.length,1);
 frames.shift()();assert.equal(frames.length,0);
 assert.equal(p.player.shadowRoot.querySelector('video'),p.video);assert.equal(p.video.paused,false);
 finish();await Promise.resolve();
 assert.equal(frames.length,1);
});
test('the held video stays visible until Reddit lays out the detail slot',async t=>{
 const p=page(t);nativeMove(p);
 const controller=new p.W.RTVideoControl.Videos({readPreference:async()=>false,observe:false});await controller.ready;
 let notify,visible=false;
 p.W.ResizeObserver=class{constructor(callback){notify=callback;}observe(){}disconnect(){}};
 p.startFromControl();p.click(p.title);p.W.history.pushState({},'',postPath);
 const detail=p.player.cloneNode();detail.setAttribute('player-type','post_detail_screen');
 detail.getBoundingClientRect=()=>({width:visible?700:0,height:visible?390:0});
 p.d.querySelector('main shreddit-post').append(detail);controller.scan();
 assert.equal(p.player.getAttribute('player-type'),'in_feed_player');
 assert.equal(p.player.closest('[data-rt-video-outgoing]'),null);
 assert.equal(p.video.paused,false);
 visible=true;notify();
 assert.equal(p.player.getAttribute('player-type'),'post_detail_screen');
 assert.equal(p.video.paused,false);
});
function pointer(p,type='pointerover',pointerType='mouse'){
 const event=new p.W.MouseEvent(type,{bubbles:true,composed:true});
 Object.defineProperty(event,'pointerType',{value:pointerType});
 p.player.dispatchEvent(event);
}
async function hoverController(p,settings={}){
 p.W.HTMLMediaElement.prototype.play=function(){
  this._playing=true;this.dispatchEvent(new p.W.Event('play'));return Promise.resolve();
 };
 Object.defineProperty(p.video,'readyState',{value:1,configurable:true});
 const controller=new p.W.RTVideoControl.Videos({readSettings:async()=>settings,readPreference:async()=>true,observe:false});
 await controller.ready;await flush();return controller;
}
const waitForHover=()=>new Promise(resolve=>setTimeout(resolve,210));
test('only hovering a paused feed video previews it, and play continues with audio from the current position',async t=>{
 const p=page(t);
 await hoverController(p);
 p.start();assert.equal(p.video.paused,true,'idle autoplay stays paused');
 pointer(p,'pointerover','touch');await waitForHover();assert.equal(p.video.paused,true);
 pointer(p);await waitForHover();
 assert.equal(p.video.paused,false);assert.equal(p.video.muted,true);
 p.video.currentTime=4.25;
 p.root.getElementById('play').addEventListener('click',()=>p.video.pause());
 p.click(p.root.getElementById('play'));
 pointer(p,'pointerout');
 assert.equal(p.video.currentTime,4.25);
 assert.equal(p.video.muted,false);assert.equal(p.video.paused,false,'the first play click cannot become pause');
});
test('leaving pauses the preview at its playhead and opening the post keeps that position and the chosen mute setting',async t=>{
 const p=page(t);await hoverController(p,{videoUnmutePreview:false});
 pointer(p);await waitForHover();p.video.currentTime=6.5;
 pointer(p,'pointerout');
 assert.equal(p.video.paused,true);assert.equal(p.video.currentTime,6.5);
 p.click(p.title);
 const saved=JSON.parse(p.W.sessionStorage.getItem(continuationKey));
 assert.equal(saved.time,6.5);assert.equal(saved.muted,true);
});
test('captions keep preview mode and the native mute button can promote playback without a second toggle',async t=>{
 const p=page(t);await hoverController(p);
 pointer(p);await waitForHover();
 p.click(p.root.getElementById('cc'));assert.equal(p.video.muted,true);
 p.root.getElementById('mute').addEventListener('click',()=>{p.video.muted=!p.video.muted;});
 p.click(p.root.getElementById('mute'));pointer(p,'pointerout');
 assert.equal(p.video.muted,false);assert.equal(p.video.paused,false);
});
test('a hover that ends during metadata loading cannot start playback later',async t=>{
 const p=page(t);await hoverController(p);
 Object.defineProperty(p.video,'readyState',{value:0,configurable:true});
 let loads=0;p.player.addEventListener('rt-prepare-feed-preview',()=>loads++);
 pointer(p);await waitForHover();assert.equal(loads,1);
 pointer(p,'pointerout');
 Object.defineProperty(p.video,'readyState',{value:1,configurable:true});
 p.video.dispatchEvent(new p.W.Event('loadedmetadata'));
 assert.equal(p.video.paused,true);
});
test('native Play pressed before preview metadata arrives takes control immediately',async t=>{
 const p=page(t);await hoverController(p);
 Object.defineProperty(p.video,'readyState',{value:0,configurable:true});
 pointer(p);await waitForHover();
 p.root.getElementById('play').addEventListener('click',p.start);
 p.click(p.root.getElementById('play'));pointer(p,'pointerout');
 assert.equal(p.video.paused,false);
 assert.equal(p.video.muted,false);
});
