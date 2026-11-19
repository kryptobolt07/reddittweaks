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
 W.IntersectionObserver=class{
  constructor(cb,o){this.probe=o.rootMargin?(io.posters={cb,options:o,observed:[],unobserved:[]}):io;this.probe.cb=cb;this.probe.options=o;}
  observe(player){this.probe.observed.push(player);}
  unobserve(player){this.probe.unobserved.push(player);}
  disconnect(){}
 };
 const player=W.document.getElementById('p1'),root=player.attachShadow({mode:'open'});root.innerHTML='<button id="play" class="play-pause-button">Play</button><button id="mute" class="mute-button">Mute</button><button id="cc">Captions</button><video></video>';
 W.__rtVideoControlTest=true;
 for(const file of ['post-model.js','embed-player-hosts.js','video-control.js'])W.eval(fs.readFileSync('extension/'+file,'utf8'));
 // Defaults are Reddit's behaviour; behaviour tests opt into the features they exercise unless they say otherwise.
 const Raw=W.RTVideoControl;W.RTVideoControlRaw=Raw;
 W.RTVideoControl={...Raw,Videos:class extends Raw.Videos{constructor(options={}){const read=options.readSettings;super({...options,readSettings:async()=>({videoStart:'hover',videoOpenPost:'continue',videoScrollAway:'pause',...(read?await read():{})})});}}};
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
test('the choices replace Reddit’s autoplay: Autoplay plays the video in view, muted; Only on Play starts nothing',async t=>{
 const p=page(t);let asked=0;
 p.W.HTMLMediaElement.prototype.play=function(){this._playing=true;this.dispatchEvent(new p.W.Event('play'));return Promise.resolve();};
 Object.defineProperty(p.video,'readyState',{value:1,configurable:true});
 p.player.getBoundingClientRect=()=>({top:100,bottom:400,height:300,left:0,width:390});
 const c=new p.W.RTVideoControlRaw.Videos({readSettings:async()=>({}),readPreference:async()=>{asked++;return false;},observe:false});await c.ready;await flush();c.scan();
 p.start();assert.equal(p.video.paused,true,'Reddit’s own autoplay is paused whatever its setting');assert.equal(asked,0,'Reddit’s preference is never read');
 p.W.dispatchEvent(new p.W.Event('scroll'));await new Promise(r=>setTimeout(r,250));
 assert.equal(p.video.paused,false,'Autoplay (the default) plays the video in view');assert.equal(p.video.muted,true);
 const q=page(t);const d=new q.W.RTVideoControlRaw.Videos({readSettings:async()=>({videoStart:'play'}),readPreference:async()=>false,observe:false});await d.ready;await flush();
 q.start();q.W.dispatchEvent(new q.W.Event('scroll'));await new Promise(r=>setTimeout(r,250));assert.equal(q.video.paused,true,'Only when I press Play');
 q.startFromControl();assert.equal(q.video.paused,false,'your own Play still plays');
});
test('video choices default to Autoplay and Reddit’s other behaviour, and only the old opt-ins carry over',()=>{
 const W=new JSDOM('',{runScripts:'outside-only'}).window;W.eval(fs.readFileSync('extension/post-model.js','utf8'));
 const n=raw=>{const all=W.RTPostModel.normalizeSettings(raw);return Object.fromEntries(Object.entries(all).filter(([k])=>k.startsWith('video')));};
 assert.deepEqual(JSON.parse(JSON.stringify(n({}))),{videoStart:'autoplay',videoStartTouch:'autoplay',videoPreviewClick:'open',videoPreviewFrom:'position',videoUnmutePreview:true,videoOpenPost:'continue',videoScrollAway:'reddit'},'Autoplay and Reddit’s other behaviour by default');
 assert.deepEqual(JSON.parse(JSON.stringify(n({videoPreviews:true,videoContinueOnOpen:true,videoPauseOffscreen:true,videoPreviewsInView:true,videoPreviewClickPlays:true,videoPreviewRestart:true,videoUnmutePreview:false}))),{videoStart:'autoplay',videoStartTouch:'stop',videoPreviewClick:'here',videoPreviewFrom:'start',videoUnmutePreview:false,videoOpenPost:'continue',videoScrollAway:'reddit'},'only the old opt-ins carry over');
 assert.equal(n({videoStart:'hover'}).videoStart,'hover');assert.equal(n({videoStart:'reddit',videoStartTouch:'reddit'}).videoStartTouch,'autoplay','0.48’s Reddit start is now Autoplay');
 W.close();
});
test('GIFs default to Autoplay and embeds inherit the matching device’s video choice until chosen',()=>{
 const W=new JSDOM('',{runScripts:'outside-only'}).window;
 try{
  W.eval(fs.readFileSync('extension/post-model.js','utf8'));
  const normalize=W.RTPostModel.normalizeSettings;
  const legacy=normalize({videoStart:'hover',videoStartTouch:'play'});
  assert.equal(legacy.embedStart,'hover');assert.equal(legacy.embedStartTouch,'play');
  assert.equal(legacy.gifStart,'autoplay');assert.equal(legacy.gifStartTouch,'autoplay');
  const chosen=normalize({...legacy,embedStart:'play',gifStartTouch:'stop'});
  assert.equal(chosen.videoStart,'hover');assert.equal(chosen.embedStart,'play');assert.equal(chosen.gifStartTouch,'stop');
 }finally{W.close();}
});
test('automatic GIF loops keep playing alongside one video and stop out of view',async t=>{
 const p=page(t),gif=p.player.cloneNode();
 gif.id='p2';gif.setAttribute('post-type','gif');gif.attachShadow({mode:'open'}).append(p.d.createElement('video'));p.player.after(gif);
 const media=gif.shadowRoot.querySelector('video');
 for(const node of [gif,p.player])node.getBoundingClientRect=()=>({top:160,height:300});
 for(const video of [media,p.video])Object.defineProperty(video,'readyState',{value:1});
 p.W.HTMLMediaElement.prototype.play=function(){this._playing=true;this.dispatchEvent(new p.W.Event('play'));return Promise.resolve();};
 const control=new p.W.RTVideoControl.Videos({readSettings:async()=>({videoStart:'play',embedStart:'play'}),observe:false});await control.ready;
 control.pickInView();
 assert.equal(media.paused,false);assert.equal(media.muted,true);assert.equal(media.loop,true);assert.equal(p.video.paused,true);
 p.startFromControl();assert.equal(p.video.paused,false);assert.equal(media.paused,false);
 p.io.cb([{target:gif,intersectionRatio:0.2}]);assert.equal(media.paused,true);
});
test('embeds in Play only mode do not preview when video Autoplay is on',async t=>{
 const p=page(t),e=embed(p);
 e.node.getBoundingClientRect=()=>({top:180,height:330});
 const control=await hoverController(p,{videoStart:'autoplay',embedStart:'play'});
 control.pickInView();assert.deepEqual(e.calls,[]);
});
test('a native comment GIF follows its mode and never loads or plays in a collapsed thread',async t=>{
 const p=page(t,{detail:true}),thread=p.d.createElement('shreddit-comment');
 thread.innerHTML='<details><figure class="rte-media"><shreddit-player gif></shreddit-player></figure></details>';
 p.d.body.append(thread);
 const details=thread.querySelector('details'),player=thread.querySelector('shreddit-player');
 const media=player.attachShadow({mode:'open'}).appendChild(p.d.createElement('video'));
 player.getBoundingClientRect=()=>({top:200,height:250});Object.defineProperty(media,'readyState',{value:1});
 p.W.HTMLMediaElement.prototype.play=function(){this._playing=true;this.dispatchEvent(new p.W.Event('play'));return Promise.resolve();};
 const control=new p.W.RTVideoControl.Videos({readSettings:async()=>({gifStart:'autoplay'}),observe:false});await control.ready;
 control.pickInView();assert.equal(media.paused,true);
 details.open=true;control.pickInView();assert.equal(media.paused,false);assert.equal(media.muted,true);
 details.open=false;details.dispatchEvent(new p.W.Event('toggle'));assert.equal(media.paused,true);
});
test('a tapped direct comment video preview plays in place with sound',async t=>{
 const p=page(t,{detail:true}),thread=p.d.createElement('shreddit-comment');
 thread.innerHTML='<details open><figure class="rte-media"><video></video></figure></details>';p.d.body.append(thread);
 const media=thread.querySelector('video');media.getBoundingClientRect=()=>({top:220,height:300});Object.defineProperty(media,'readyState',{value:1});
 p.W.HTMLMediaElement.prototype.play=function(){this._playing=true;this.dispatchEvent(new p.W.Event('play'));return Promise.resolve();};
 const control=new p.W.RTVideoControl.Videos({readSettings:async()=>({videoStart:'autoplay',videoUnmutePreview:true}),observe:false});await control.ready;
 control.pickInView();assert.equal(media.paused,false);assert.equal(media.muted,true);
 p.click(media);assert.equal(media.paused,false);assert.equal(media.muted,false);assert.equal(media.controls,true);
});
test('a playing video pauses once less than half of it is on screen, and stays paused',async t=>{
 const {W,player,video,io}=page(t);const v=new W.RTVideoControl.Videos({readSettings:async()=>({}),readPreference:async()=>false,observe:false});await v.ready;await flush();
 assert.deepEqual([...io.options.threshold],[0,0.5,0.6,1]);video._playing=true;
 io.cb([{target:player,intersectionRatio:0.8}]);assert.equal(video.paused,false);io.cb([{target:player,intersectionRatio:0.3}]);assert.equal(video.paused,true);assert.equal(player.dataset.rtPausedAway,'true');
 const off=page(t);const v2=new off.W.RTVideoControl.Videos({readSettings:async()=>({videoScrollAway:'reddit'}),readPreference:async()=>false,observe:false});await v2.ready;off.video._playing=true;off.io.cb([{target:off.player,intersectionRatio:0}]);assert.equal(off.video.paused,false,'switch off');
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
 const v=new b.W.RTVideoControl.Videos({readSettings:async()=>({videoOpenPost:'continue'}),readPreference:async()=>true,observe:false});await v.ready;await flush();
 assert.equal(b.video.currentTime,13.75,'the post resumes at the position reached when the feed page left');assert.equal(b.video.muted,false);
 assert.ok(b.video.volume<0.4,'sound fades in');await new Promise(r=>setTimeout(r,260));assert.equal(b.video.volume,0.4);assert.equal(b.video.playbackRate,1.5);assert.equal(b.video._playing,true);assert.equal(plays,1);
 assert.equal(b.W.sessionStorage.getItem(continuationKey),null,'the handoff is used once');
 b.io.cb([{target:b.player,intersectionRatio:0.2}]);assert.equal(b.video.paused,false,'a post video plays on while partly visible');
 b.io.cb([{target:b.player,intersectionRatio:0}]);assert.equal(b.video.paused,true,'scrolling it fully away pauses it');
 const c=page(t,{detail:true});c.W.sessionStorage.setItem(continuationKey,saved);Object.defineProperty(c.video,'duration',{value:30,configurable:true});Object.defineProperty(c.video,'readyState',{value:1,configurable:true});
 const off=new c.W.RTVideoControl.Videos({readSettings:async()=>({videoOpenPost:'reddit'}),readPreference:async()=>false,observe:false});await off.ready;await flush();assert.equal(c.video.currentTime,0,'switch off');
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
test('a post video pauses once fully out of view and resumes at the same time when half of it is back',async t=>{
 const p=page(t,{detail:true});
 const v=new p.W.RTVideoControl.Videos({readSettings:async()=>({}),readPreference:async()=>false,observe:false});await v.ready;await flush();
 let plays=0;p.W.HTMLMediaElement.prototype.play=function(){plays++;this._playing=true;this.dispatchEvent(new p.W.Event('play'));return Promise.resolve();};
 p.startFromControl();p.video.currentTime=20;
 p.io.cb([{target:p.player,intersectionRatio:0.3}]);assert.equal(p.video.paused,false);
 p.io.cb([{target:p.player,intersectionRatio:0}]);assert.equal(p.video.paused,true);
 p.io.cb([{target:p.player,intersectionRatio:0.3}]);assert.equal(p.video.paused,true,'a sliver does not restart it');
 // Reddit unloaded the source while it was far away.
 p.video.currentTime=0;Object.defineProperty(p.video,'readyState',{value:0,configurable:true});
 let loads=0;p.player.addEventListener('rt-prepare-detail-video',()=>loads++);
 p.io.cb([{target:p.player,intersectionRatio:0.6}]);p.io.cb([{target:p.player,intersectionRatio:1}]);
 assert.equal(loads,1);assert.equal(p.video.paused,true);
 Object.defineProperty(p.video,'readyState',{value:1,configurable:true});p.video.dispatchEvent(new p.W.Event('loadedmetadata'));
 assert.equal(p.video.currentTime,20);assert.equal(p.video.paused,false);assert.equal(plays,1);
 assert.equal(p.player.dataset.rtPausedAway,undefined);
 p.video.pause();p.io.cb([{target:p.player,intersectionRatio:0}]);p.io.cb([{target:p.player,intersectionRatio:1}]);
 assert.equal(p.video.paused,true,'a video the user paused stays paused');
 const f=page(t);const vf=new f.W.RTVideoControl.Videos({readSettings:async()=>({}),readPreference:async()=>false,observe:false});await vf.ready;
 f.video._playing=true;f.io.cb([{target:f.player,intersectionRatio:0.3}]);f.io.cb([{target:f.player,intersectionRatio:1}]);
 assert.equal(f.video.paused,true,'feed videos pause at half and stay paused');
 const off=page(t,{detail:true});const vo=new off.W.RTVideoControl.Videos({readSettings:async()=>({videoScrollAway:'reddit'}),readPreference:async()=>false,observe:false});await vo.ready;
 off.video._playing=true;off.io.cb([{target:off.player,intersectionRatio:0}]);assert.equal(off.video.paused,false,'switch off');
});
test('the same playing media survives feed removal and moves into the detail slot without another play',async t=>{
 const p=page(t),calls=nativeMove(p);
 const controller=new p.W.RTVideoControl.Videos({readPreference:async()=>false,observe:false});await controller.ready;
 p.startFromControl();p.video.currentTime=8;
 const feed=p.player.parentElement;
 const surface=feed.closest('main');
 const before=surface.outerHTML.length;
 p.click(p.title);
 assert.notEqual(p.player.parentElement,feed);
 assert.equal(p.d.documentElement.hasAttribute('data-rt-media-moving'),true,'filtered feeds stay visible while it moves');
 assert.equal(fs.readFileSync('extension/post-discovery.css','utf8').includes('data-rt-video-outgoing'),false);
 assert.equal([...surface.attributes].length,0,'the feed stays on screen as Reddit leaves it');
 assert.ok(surface.outerHTML.length<before,'only the player left the card');
 assert.equal(p.player.parentElement.style.position,'fixed','the video stays at its card place above the feed');
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
 assert.deepEqual(calls,['begin','end']);
 assert.equal(p.d.documentElement.hasAttribute('data-rt-media-moving'),false);
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
 assert.equal(p.io.unobserved.at(-1),p.player);
 const stale={target:p.player,intersectionRatio:0,time:p.W.performance.now()};
 p.io.cb([stale]);assert.equal(p.video.paused,false);
 frames.shift()();frames.shift()();
 assert.equal(p.io.observed.filter(player=>player===p.player).length,2);
 p.io.cb([stale]);assert.equal(p.video.paused,false,'a queued feed entry cannot pause the detail player');
 p.io.cb([{target:p.player,intersectionRatio:0,time:p.W.performance.now()}]);
 assert.equal(p.video.paused,true,'fresh geometry still pauses real scroll-away');
});
function flight(p){
 const frames=[],animations=[];p.W.requestAnimationFrame=callback=>frames.push(callback);
 Object.defineProperty(p.video,'videoWidth',{value:1600});Object.defineProperty(p.video,'videoHeight',{value:900});
 p.player.getBoundingClientRect=()=>p.player.getAttribute('player-type')==='in_feed_player'
  ? {left:100,top:160,width:640,height:360} : {left:0,top:100,width:390,height:220};
 const finishes=[];
 p.player.animate=(keyframes,timing)=>{const animation={keyframes,timing,finished:new Promise(resolve=>{finishes.push(resolve);})};animations.push(animation);return animation;};
 p.startFromControl();p.click(p.title);p.W.history.pushState({},'',postPath);
 const feed=p.d.querySelector('main shreddit-post'),stage=p.player.parentElement;
 const detail=p.player.cloneNode();detail.setAttribute('player-type','post_detail_screen');detail.className='detail-layout';
 const post=p.d.createElement('shreddit-post');post.id='t3_test';post.append(detail);p.d.querySelector('main').append(post);
 let placed=0;p.player.addEventListener('rt-video-placed',()=>placed++);
 return {frames,animations,feed,stage,detail,post,placed:()=>placed,finish:()=>finishes[0]()};
}
test('the held video takes the post slot at once and its picture moves there from the card, unclamped, on the compositor',async t=>{
 const p=page(t),calls=nativeMove(p);
 const controller=new p.W.RTVideoControl.Videos({readPreference:async()=>false,observe:false});await controller.ready;
 const sound=[];p.player.volumeController={setVolume(position){sound.push(position);}};p.video.muted=false;p.video.volume=0.36;
 const f=flight(p);controller.scan();
 assert.deepEqual(sound,[0.6],'its sound is kept in Reddit’s state, which the post player re-applies');
 assert.equal(f.post.querySelector('shreddit-player'),p.player);assert.equal(f.detail.isConnected,false);
 assert.equal(p.player.getAttribute('player-type'),'post_detail_screen');assert.equal(p.player.className,'detail-layout');
 assert.equal(f.stage.isConnected,false);assert.deepEqual(calls,['begin'],'Reddit’s reparent window stays open while it moves');
 assert.equal(f.feed.querySelector('shreddit-player').getAttribute('player-type'),'in_feed_player','Back finds a fresh feed player');
 assert.equal(p.player.shadowRoot.querySelector('video'),p.video);assert.equal(p.video.paused,false);
 const [motion,clip]=f.animations;
 assert.equal(motion.id,'rt-video-placement');assert.equal(motion.timing.duration,220);
 const [,x,y,scale]=/translate\(([-\d.]+)px,([-\d.]+)px\) scale\(([\d.]+)\)/.exec(motion.keyframes[0].transform).map(Number);
 assert.deepEqual([x,y],[225,130],'from the card centre, beyond the old ±120 px clamp');
 assert.ok(Math.abs(scale-640/390)<1e-6,'one scale from picture to picture');
 assert.match(clip.keyframes[0].clipPath,/^inset\(0\.3125px 0px\)$/);
 assert.equal(p.player.hasAttribute('data-rt-video-flying'),true);
 assert.equal(p.io.unobserved.at(-1),p.player,'feed geometry is discarded');
 f.finish();await flush();
 assert.equal(f.placed(),1);assert.equal(p.player.hasAttribute('data-rt-video-flying'),false);assert.deepEqual(calls,['begin','end']);
 f.frames.shift()();
 assert.equal(p.io.observed.at(-1),p.player,'visibility is watched again once it has landed');
});
test('with reduced motion the video takes the slot without moving',async t=>{
 const p=page(t);nativeMove(p);p.W.matchMedia=query=>({matches:/reduced-motion/.test(query)});
 const controller=new p.W.RTVideoControl.Videos({readPreference:async()=>false,observe:false});await controller.ready;
 const f=flight(p);controller.scan();
 assert.equal(p.player.getAttribute('player-type'),'post_detail_screen');assert.equal(f.animations.length,0);
 assert.equal(p.player.hasAttribute('data-rt-video-flying'),false);
});
test('previews start through Reddit’s own player so its controls show them playing',async t=>{
 const p=page(t);nativeMove(p);await hoverController(p);
 let plays=0;p.player.mediaActionsController={};p.player.play=function(){plays++;p.video._playing=true;p.video.dispatchEvent(new p.W.Event('play'));return Promise.resolve();};
 pointer(p);await waitForHover();
 assert.equal(plays,1);assert.equal(p.video.paused,false);assert.equal(p.video.muted,true);
});
test('sound for a preview goes through Reddit’s own volume state',async t=>{
 const p=page(t);nativeMove(p);await hoverController(p,{videoPreviewClickPlays:true});
 const set=[];p.player.volumeController={setVolume(position){set.push(position);}};
 p.video.volume=0.25;pointer(p);await waitForHover();p.click(p.video);
 assert.deepEqual(set,[0.5],'Reddit squares its slider position');
 assert.equal(p.video.muted,false);
});
test('the held video stays visible until Reddit lays out the detail slot',async t=>{
 const p=page(t);nativeMove(p);
 const controller=new p.W.RTVideoControl.Videos({readPreference:async()=>false,observe:false});await controller.ready;
 let notify,visible=false;
 p.W.ResizeObserver=class{constructor(callback){notify=callback;}observe(){}disconnect(){}};
 p.startFromControl();p.click(p.title);p.W.history.pushState({},'',postPath);
 const detail=p.player.cloneNode();detail.setAttribute('player-type','post_detail_screen');
 detail.getBoundingClientRect=()=>({left:0,top:90,width:visible?700:0,height:visible?390:0});
 p.d.querySelector('main shreddit-post').append(detail);controller.scan();
 assert.equal(p.player.getAttribute('player-type'),'in_feed_player');
 assert.equal(p.player.parentElement.style.position,'fixed');
 assert.equal(p.video.paused,false);
 visible=true;notify();
 assert.equal(p.player.getAttribute('player-type'),'post_detail_screen');
 assert.equal(p.video.paused,false);
});
function pointer(p,type='pointerover',pointerType='mouse',{target=p.player,related=null}={}){
 const event=new p.W.MouseEvent(type,{bubbles:true,composed:true,relatedTarget:related});
 Object.defineProperty(event,'pointerType',{value:pointerType});
 target.dispatchEvent(event);
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
 assert.equal(p.video.paused,false,'a short grace after leaving the card');
 await new Promise(resolve=>setTimeout(resolve,260));
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
 let opened=0;p.title.addEventListener('click',()=>opened++);
 p.click(p.root.getElementById('mute'));pointer(p,'pointerout');assert.equal(opened,0,'sound acts in place');
 assert.equal(p.video.muted,false);assert.equal(p.video.paused,false);
});
test('moving from a playing preview to its title keeps it; leaving the card pauses after 250 ms unless the pointer returns',async t=>{
 const p=page(t);await hoverController(p);
 pointer(p);await waitForHover();
 pointer(p,'pointerout','mouse',{related:p.title});pointer(p,'pointerover','mouse',{target:p.title,related:p.player});
 await new Promise(resolve=>setTimeout(resolve,300));
 assert.equal(p.video.paused,false,'the title is part of the card');assert.equal(p.video.muted,true);
 pointer(p,'pointerout','mouse',{target:p.title,related:p.d.body});
 await new Promise(resolve=>setTimeout(resolve,100));
 pointer(p,'pointerover','mouse',{target:p.title,related:p.d.body});
 await new Promise(resolve=>setTimeout(resolve,300));
 assert.equal(p.video.paused,false,'returning within the grace keeps it');
 pointer(p,'pointerout','mouse',{target:p.title,related:p.d.body});
 await new Promise(resolve=>setTimeout(resolve,260));
 assert.equal(p.video.paused,true);
});
test('a preview stays muted when Reddit re-applies a saved unmuted volume',async t=>{
 const p=page(t);await hoverController(p);
 pointer(p);await waitForHover();
 p.video.muted=false;p.video.dispatchEvent(new p.W.Event('volumechange'));
 assert.equal(p.video.muted,true);
 p.root.getElementById('mute').addEventListener('click',()=>{p.video.muted=false;p.video.dispatchEvent(new p.W.Event('volumechange'));});
 p.click(p.root.getElementById('mute'));assert.equal(p.video.muted,false,'the user’s own sound button still works');
});
test('a pointer that leaves the player before the preview starts cancels it',async t=>{
 const p=page(t);await hoverController(p);
 pointer(p);pointer(p,'pointerout','mouse',{related:p.title});
 await waitForHover();assert.equal(p.video.paused,true);
});
function surfaceClick(p){
 let toggled=0,opened=0;
 p.video.addEventListener('click',()=>toggled++);p.title.addEventListener('click',()=>opened++);
 return {count:()=>({toggled,opened})};
}
test('clicking a preview opens its post by default, carrying the preview on with sound faded in',async t=>{
 const p=page(t);await hoverController(p);const c=surfaceClick(p);
 p.video.volume=0.8;pointer(p);await waitForHover();p.video.currentTime=3.5;
 p.click(p.video);
 assert.deepEqual(c.count(),{toggled:0,opened:1},'Reddit’s player does not see the click; its permalink does');
 const saved=JSON.parse(p.W.sessionStorage.getItem(continuationKey));
 assert.equal(saved.time,3.5);assert.equal(saved.muted,false);assert.equal(saved.volume,0.8,'the target volume, not the fade');
 assert.equal(p.video.paused,false);assert.equal(p.video.muted,false);assert.ok(p.video.volume<0.8);
 await new Promise(resolve=>setTimeout(resolve,260));assert.equal(p.video.volume,0.8);
});
test('Play here plays a clicked preview in place, and From the beginning restarts it',async t=>{
 const p=page(t);await hoverController(p,{videoPreviewClickPlays:true,videoPreviewRestart:true});const c=surfaceClick(p);
 pointer(p);await waitForHover();p.video.currentTime=3.5;
 p.click(p.video);
 assert.deepEqual(c.count(),{toggled:0,opened:0});
 assert.equal(p.video.currentTime,0);assert.equal(p.video.paused,false);assert.equal(p.video.muted,false);
 pointer(p,'pointerout');await new Promise(resolve=>setTimeout(resolve,260));
 assert.equal(p.video.paused,false,'it is no longer a preview');
});
test('an opened preview can start from the beginning and keep its sound off',async t=>{
 const p=page(t);await hoverController(p,{videoPreviewRestart:true,videoUnmutePreview:false});
 pointer(p);await waitForHover();p.video.currentTime=3.5;
 p.click(p.video);
 const saved=JSON.parse(p.W.sessionStorage.getItem(continuationKey));
 assert.equal(saved.time,0);assert.equal(saved.muted,true);assert.equal(p.video.muted,true);
});
function phone(p,coarse=true,top=200){
 p.W.matchMedia=query=>({matches:coarse && /hover: none|pointer: coarse/.test(query)});
 const box={top,height:300};p.player.getBoundingClientRect=()=>({top:box.top,bottom:box.top+box.height,height:box.height,left:0,width:390});
 return box;
}
const settle=()=>new Promise(resolve=>setTimeout(resolve,650));
const scroll=p=>p.W.dispatchEvent(new p.W.Event('scroll'));
test('on phones a muted preview starts once scrolling stops on a video, and a tap opens its post',async t=>{
 const p=page(t);const box=phone(p);await hoverController(p,{videoPreviewsInView:true});
 scroll(p);await new Promise(resolve=>setTimeout(resolve,300));scroll(p);await new Promise(resolve=>setTimeout(resolve,300));
 assert.equal(p.video.paused,true,'nothing starts while scrolling');
 await new Promise(resolve=>setTimeout(resolve,400));
 assert.equal(p.video.paused,false);assert.equal(p.video.muted,true);
 box.top=-60;scroll(p);await new Promise(resolve=>setTimeout(resolve,100));
 assert.equal(p.video.paused,false,'a playing preview keeps going while scrolling');
 const c=surfaceClick(p);p.click(p.video);assert.deepEqual(c.count(),{toggled:0,opened:1},'a tap opens the post');
});
test('a phone preview stops when it scrolls half away and the next settled video takes over',async t=>{
 const p=page(t);const box=phone(p);await hoverController(p,{videoPreviewsInView:true});
 scroll(p);await settle();assert.equal(p.video.paused,false);
 box.top=-200;p.io.cb([{target:p.player,intersectionRatio:0.3}]);
 assert.equal(p.video.paused,true);
 scroll(p);await settle();assert.equal(p.video.paused,true,'below 60 % it is not chosen again');
});
test('a video already in view when the settings arrive previews after the pause',async t=>{
 const p=page(t);phone(p);
 p.W.HTMLMediaElement.prototype.play=function(){this._playing=true;this.dispatchEvent(new p.W.Event('play'));return Promise.resolve();};
 Object.defineProperty(p.video,'readyState',{value:1,configurable:true});
 let finish;const controller=new p.W.RTVideoControl.Videos({readSettings:()=>new Promise(r=>finish=r),readPreference:async()=>true,observe:false});
 controller.scan();finish({videoPreviewsInView:true});await controller.ready;await settle();
 assert.equal(p.video.paused,false);assert.equal(p.video.muted,true);
 controller.configure({});assert.equal(p.video.paused,true,'turning the option off stops it');
});
test('a phone preview starts for a video that loads into view without a scroll',async t=>{
 const p=page(t);phone(p);const post=p.player.parentElement,player=p.player;player.remove();
 const controller=await hoverController(p,{videoPreviewsInView:true});await settle();
 post.append(player);controller.scan();await settle();
 assert.equal(p.video.paused,false);assert.equal(p.video.muted,true);
});
test('each device follows its own start choice: Play only starts nothing, hover previews never autoplay the one in view',async t=>{
 for(const [coarse,settings,plays] of [[true,{videoStartTouch:'play'},false],[false,{videoStart:'hover'},false],[false,{videoStart:'autoplay'},true],[true,{videoStartTouch:'stop'},true]]){
  const p=page(t);phone(p,coarse);await hoverController(p,settings);
  scroll(p);await settle();
  assert.equal(p.video.paused,!plays,JSON.stringify(settings));
 }
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

// YouTube embeds (lite-youtube in shreddit-embed), driven through page-bridge events.
const embedKey='rt-embed-continue-v1';
function embed(p,{state='playing',time=12.5,muted=false}={}){
 const node=p.d.createElement('shreddit-embed');node.setAttribute('providername','YouTube');
 const lite=node.attachShadow({mode:'open'}).appendChild(p.d.createElement('lite-youtube'));
 p.player.closest('shreddit-post').append(node);
 const calls=[];
 for(const type of ['rt-embed-preview','rt-embed-stop','rt-embed-sound','rt-embed-continue'])node.addEventListener(type,event=>{calls.push(type);event.preventDefault();});
 node.addEventListener('rt-embed-snapshot',()=>{Object.assign(node.dataset,{rtEmbedState:state,rtEmbedTime:String(time),rtEmbedMuted:String(muted)});});
 const over=(type='pointerover',target=lite,related=null)=>{const event=new p.W.MouseEvent(type,{bubbles:true,composed:true,relatedTarget:related});Object.defineProperty(event,'pointerType',{value:'mouse'});target.dispatchEvent(event);};
 return {node,lite,calls,over,layer:()=>lite.querySelector('[data-rt-embed-layer]')};
}
test('hovering a feed YouTube embed previews it muted, the title keeps it, and leaving the card stops it after 250 ms',async t=>{
 const p=page(t);const e=embed(p);await hoverController(p);
 e.over();await waitForHover();
 assert.deepEqual(e.calls,['rt-embed-preview']);assert.ok(e.layer(),'a layer takes clicks while it previews');
 e.over('pointerout',e.lite,p.title);e.over('pointerover',p.title,e.node);
 await new Promise(resolve=>setTimeout(resolve,300));assert.deepEqual(e.calls,['rt-embed-preview']);
 e.over('pointerout',p.title,p.d.body);await new Promise(resolve=>setTimeout(resolve,260));
 assert.deepEqual(e.calls,['rt-embed-preview','rt-embed-stop']);assert.equal(e.layer(),null);
});
test('clicking a YouTube preview opens its post and continues there at the same second with sound',async t=>{
 const p=page(t);const e=embed(p,{muted:true});await hoverController(p);
 let opened=0;p.title.addEventListener('click',()=>opened++);
 e.over();await waitForHover();
 e.layer().dispatchEvent(new p.W.MouseEvent('click',{bubbles:true,composed:true,cancelable:true}));
 assert.equal(opened,1);
 const saved=JSON.parse(p.W.sessionStorage.getItem(embedKey));
 assert.equal(saved.id,'test');assert.equal(saved.time,12.5);assert.equal(saved.muted,false,'Sound when opening a preview');
 assert.deepEqual(e.calls,['rt-embed-preview','rt-embed-stop']);assert.equal(e.layer(),null);
});
test('tapping a YouTube preview before its first position report saves sound and a zero-position fallback',async t=>{
 const p=page(t);const e=embed(p,{state:'',time:undefined});await hoverController(p);
 e.node.addEventListener('rt-embed-snapshot',()=>{delete e.node.dataset.rtEmbedTime;});
 e.over();await waitForHover();p.click(e.layer());
 const saved=JSON.parse(p.W.sessionStorage.getItem(embedKey));
 assert.equal(saved?.time,0);assert.equal(saved?.muted,false);
});
test('the sound button unmutes a YouTube preview in place, and Play here does the same for a click',async t=>{
 for(const settings of [{},{videoPreviewClickPlays:true}]){
  const p=page(t);const e=embed(p);await hoverController(p,settings);
  let opened=0;p.title.addEventListener('click',()=>opened++);
  e.over();await waitForHover();
  const target=settings.videoPreviewClickPlays?e.layer():e.layer().querySelector('button');
  target.dispatchEvent(new p.W.MouseEvent('click',{bubbles:true,composed:true,cancelable:true}));
  assert.equal(opened,0);assert.deepEqual(e.calls,['rt-embed-preview','rt-embed-sound']);assert.equal(e.layer(),null);
  e.over('pointerout',e.lite,p.d.body);await new Promise(resolve=>setTimeout(resolve,260));
  assert.deepEqual(e.calls,['rt-embed-preview','rt-embed-sound'],'it is the user’s now');
 }
});
test('a YouTube video the user plays continues into its post; a paused one does not',async t=>{
 const p=page(t);const e=embed(p,{muted:false,time:40});await hoverController(p);
 p.click(p.title);
 assert.deepEqual(JSON.parse(p.W.sessionStorage.getItem(embedKey)),{...JSON.parse(p.W.sessionStorage.getItem(embedKey)),id:'test',time:40,muted:false});
 const q=page(t);embed(q,{state:'paused'});await hoverController(q);
 q.click(q.title);assert.equal(q.W.sessionStorage.getItem(embedKey),null);
});
test('the post page starts its YouTube embed at the saved second once it appears',async t=>{
 const p=page(t,{detail:true});
 p.W.sessionStorage.setItem(embedKey,JSON.stringify({id:'test',owner:'t2_alice',at:Date.now(),time:33.4,muted:false}));
 const controller=await hoverController(p);
 // Reddit keeps the outgoing feed, with this post's own card and embed, in the page.
 const feed=p.d.createElement('shreddit-feed'),cached=p.d.createElement('shreddit-post');cached.id='t3_test';feed.append(cached);p.d.body.prepend(feed);
 const stale=p.d.createElement('shreddit-embed');stale.setAttribute('providername','YouTube');cached.append(stale);
 let wrong=0;stale.addEventListener('rt-embed-continue',()=>wrong++);
 const e=embed(p);controller.scan();
 assert.equal(wrong,0,'the cached feed copy is left alone');
 assert.deepEqual(e.calls,['rt-embed-continue']);assert.equal(e.node.dataset.rtStart,'33.4');assert.equal(e.node.dataset.rtMuted,'false');
 assert.equal(p.W.sessionStorage.getItem(embedKey),null);
 const q=page(t,{detail:true});
 q.W.sessionStorage.setItem(embedKey,JSON.stringify({id:'test',owner:'t2_bob',at:Date.now(),time:3,muted:false}));
 const c2=await hoverController(q);const e2=embed(q);c2.scan();
 assert.deepEqual(e2.calls,[],'another account’s handoff is dropped');
});
test('detail embeds pause only after leaving view and resume only when they were playing',async t=>{
 for(const state of ['playing','paused']){
  const p=page(t,{detail:true}),e=embed(p,{state}),control=await hoverController(p);
  const commands=[];
  for(const type of ['rt-embed-offscreen','rt-embed-return'])e.node.addEventListener(type,()=>commands.push(type));
  assert.ok(p.io.observed.includes(e.node));
  p.io.cb([{target:e.node,intersectionRatio:0.25}]);assert.deepEqual(commands,[]);
  p.io.cb([{target:e.node,intersectionRatio:0}]);
  p.io.cb([{target:e.node,intersectionRatio:0.4}]);
  p.io.cb([{target:e.node,intersectionRatio:0.5}]);
  assert.deepEqual(commands,state==='playing'?['rt-embed-offscreen','rt-embed-return']:[]);
  control.configure({videoScrollAway:'reddit'});commands.length=0;
  p.io.cb([{target:e.node,intersectionRatio:0},{target:e.node,intersectionRatio:0.8}]);
  assert.deepEqual(commands,[]);
 }
});
test('on phones a YouTube embed in view previews once scrolling stops',async t=>{
 const p=page(t);phone(p,true,-900);const e=embed(p);
 e.node.getBoundingClientRect=()=>({top:200,bottom:500,height:300,left:0,width:390});
 await hoverController(p,{videoPreviewsInView:true});scroll(p);await settle();
 assert.deepEqual(e.calls,['rt-embed-preview']);
});

test('a playing YouTube embed keeps its player: held at its card, then placed in the post, with sound',async t=>{
 const p=page(t);const e=embed(p,{muted:true});const controller=await hoverController(p);
 const card=e.node.closest('shreddit-post'),feed=p.d.createElement('shreddit-feed');card.before(feed);feed.append(card);
 e.node.addEventListener('rt-hold-feed-embed',event=>{e.calls.push('hold');event.preventDefault();});
 e.over();await waitForHover();
 p.click(p.title);
 assert.deepEqual(e.calls,['rt-embed-preview','hold','rt-embed-sound'],'held and unmuted during the click');
 p.W.history.pushState({},'',postPath);
 const post=p.d.createElement('shreddit-post');post.id='t3_test';p.d.body.append(post);
 const target=p.d.createElement('shreddit-embed');target.setAttribute('providername','YouTube');post.append(target);
 const placed=[];let ready=false;
 target.addEventListener('rt-place-held-embed',event=>{placed.push('place');if(ready)event.preventDefault();});
 target.addEventListener('rt-embed-sound',()=>placed.push('sound'));
 controller.scan();assert.deepEqual(placed,['place'],'waits for the post embed');
 assert.equal(target.style.visibility,'hidden','Reddit’s own embed UI stays hidden meanwhile');
 ready=true;controller.scan();
 assert.equal(target.style.visibility,'');assert.equal(target.dataset.rtIncoming,undefined);
 assert.deepEqual(placed,['place','place'],'placement does not repeat the sound change');
 assert.equal(p.W.sessionStorage.getItem(embedKey),null);
});
test('Back before the post embed is ready returns the held YouTube player to its card',async t=>{
 const p=page(t);const e=embed(p);await hoverController(p);
 e.node.addEventListener('rt-hold-feed-embed',event=>event.preventDefault());
 let released=0;p.d.addEventListener('rt-release-feed-embed',()=>released++);
 p.click(p.title);p.W.dispatchEvent(new p.W.PopStateEvent('popstate'));
 assert.equal(released,1);assert.equal(p.W.sessionStorage.getItem(embedKey),null);
});

test('one video plays at a time: starting one pauses the others, a preview included, and YouTube players are told',async t=>{
 const p=page(t);const second=p.player.cloneNode();second.id='p2';const root2=second.attachShadow({mode:'open'});root2.innerHTML='<button class="play-pause-button">Play</button><video></video>';
 p.player.closest('shreddit-post').after(Object.assign(p.d.createElement('shreddit-post'),{id:'t3_two'}));p.d.getElementById('t3_two').append(second);
 const controller=await hoverController(p,{videoStart:'reddit'});controller.scan();
 const other=root2.querySelector('video');
 let told=0;p.d.addEventListener('rt-media-exclusive',()=>told++);
 p.startFromControl();assert.equal(p.video.paused,false);
 root2.querySelector('button').dispatchEvent(new p.W.Event('pointerdown',{bubbles:true,composed:true}));
 other._playing=true;other.dispatchEvent(new p.W.Event('play'));
 assert.equal(p.video.paused,true,'the first video pauses');assert.equal(other.paused,false);assert.ok(told>=2,'the page bridge pauses YouTube players too');
 const e=embed(p);e.node.dispatchEvent(new p.W.Event('rt-embed-playing',{bubbles:true}));
 assert.equal(other.paused,true,'a YouTube player starting pauses Reddit videos');
});

// Other providers: Reddit renders their oEmbed iframe directly in the shreddit-embed shadow root.
function frameEmbed(p,src='https://streamable.com/e/abc'){
 const node=p.d.createElement('shreddit-embed');node.setAttribute('providername','Streamable');
 const frame=node.attachShadow({mode:'open'}).appendChild(p.d.createElement('iframe'));frame.setAttribute('src',src);
 p.player.closest('shreddit-post').append(node);
 const frameWindow=p.d.body.appendChild(p.d.createElement('iframe')).contentWindow;
 Object.defineProperty(frame,'contentWindow',{value:frameWindow});
 const over=(type='pointerover',target=frame,related=null)=>{const event=new p.W.MouseEvent(type,{bubbles:true,composed:true,relatedTarget:related});Object.defineProperty(event,'pointerType',{value:'mouse'});target.dispatchEvent(event);};
 return {node,frame,over,layer:()=>node.shadowRoot.querySelector('[data-rt-embed-layer]')};
}
test('a preview surface opens a same-origin post even if the card has only an external content link',async t=>{
 const p=page(t),e=frameEmbed(p),card=e.node.closest('shreddit-post');
 card.setAttribute('permalink',postPath);p.title.href='https://streamable.com/comments/test/external';
 await hoverController(p);e.over();await waitForHover();
 let opened;p.d.addEventListener('click',event=>{if(event.target.matches('a')){opened=event.target.href;event.preventDefault();}});
 e.layer().click();assert.equal(opened,'https://www.reddit.com'+postPath);
});
test('On Play on a phone shows the provider thumbnail and requires a tap to load an Embedly player',async t=>{
 const p=page(t);phone(p,true,-900);
 const thumbnail='https://cdn.example.test/poster.jpg';
 const address=embedly+'&autoplay=1&image='+encodeURIComponent(thumbnail);
 const e=frameEmbed(p,address);e.node.getBoundingClientRect=()=>({top:205,height:280});
 const c=await hoverController(p,{videoStartTouch:'autoplay',embedStartTouch:'play'});
 c.pickInView();
 const cover=e.node.shadowRoot.querySelector('[data-rt-parked-cover]');
 assert.equal(e.frame.src,'about:blank');assert.equal(e.layer(),null);
 assert.match(cover.dataset.rtStill,/cdn\.example\.test\/poster\.jpg/);assert.equal(cover.querySelector('[data-rt-parked-still]').referrerPolicy,'no-referrer');
 cover.click();assert.equal(new URL(e.frame.src).origin,'https://cdn.embedly.com');
 assert.equal(e.node.shadowRoot.querySelector('[data-rt-parked-cover]'),null);
});
test('a parked hover preview warms the thumbnail from its Embedly URL without starting the player',async t=>{
 const p=page(t),image='https://cdn.example.test/ready.jpg';
 const e=frameEmbed(p,embedly+'&image='+encodeURIComponent(image)),c=await hoverController(p);
 const warmed=[];c.warmPoster=url=>warmed.push(url);
 c.preparedPosters=new WeakSet();c.posters.clear();c.scan();await flush();
 assert.ok(warmed.includes(image));assert.equal(e.layer(),null);
});
test('direct provider sound stays on the same frame for a feed tap and a post handoff',async t=>{
 for(const open of [false,true]){
  const p=page(t),e=frameEmbed(p,'https://www.redgifs.com/ifr/example'),c=await hoverController(p,{embedBlockLinks:'feed'});
  e.node.addEventListener('rt-hold-feed-embed',event=>event.preventDefault());
  e.over();await waitForHover();
  const messages=[],src=e.frame.src,frame=e.frame.contentWindow;
  frame.postMessage=(data,origin)=>messages.push({data,origin});
  p.W.dispatchEvent(new p.W.MessageEvent('message',{source:frame,origin:new URL(src).origin,data:{rtMedia:'hello'}}));
  (open?e.layer():e.layer().querySelector('button')).click();
  assert.equal(e.frame.src,src);
  assert.ok(messages.some(({data,origin})=>data.rtMedia==='unmute' && origin==='https://www.redgifs.com'));
  if(open){
   p.W.history.pushState({},'',postPath);
   const detail=p.d.createElement('shreddit-post');detail.id='t3_test';p.d.body.append(detail);
   const target=detail.appendChild(p.d.createElement('shreddit-embed'));
   e.node.parentElement.removeAttribute('id');
   target.addEventListener('rt-place-held-embed',event=>event.preventDefault());
   c.embedHandoff();
   assert.equal(messages.filter(({data})=>data.rtMedia==='policy').at(-1).data.block,false);
  }else assert.equal(p.W.location.pathname,'/r/videos/');
 }
});
test('another provider’s embed previews muted through its own autoplay flags and goes back when the pointer leaves the card',async t=>{
 const p=page(t);const e=frameEmbed(p);await hoverController(p);
 e.over();await waitForHover();
 const url=new URL(e.frame.src);assert.equal(url.searchParams.get('autoplay'),'1');assert.equal(url.searchParams.get('muted'),'1');assert.ok(e.layer());
 e.over('pointerout',e.frame,p.d.body);await new Promise(r=>setTimeout(r,260));
 assert.equal(e.frame.getAttribute('src'),'about:blank','a player with no controls is unloaded, not left playing');assert.equal(e.frame.dataset.rtSrc,'https://streamable.com/e/abc');
 assert.ok(e.node.shadowRoot.querySelector('[data-rt-parked-play]'),'behind a play button');assert.equal(e.layer(),null);
 const twitch=page(t);const tw=frameEmbed(twitch,'https://clips.twitch.tv/embed?clip=x&parent=www.reddit.com');await hoverController(twitch);
 tw.over();await waitForHover();const tu=new URL(tw.frame.src);assert.equal(tu.searchParams.get('autoplay'),'true');assert.equal(tu.searchParams.get('muted'),'true');assert.equal(tu.searchParams.get('parent'),'www.reddit.com');
});
test('Play here reloads another provider’s preview with sound; opening its post carries the same iframe over at the same moment',async t=>{
 const p=page(t);const e=frameEmbed(p);await hoverController(p,{videoPreviewClick:'here'});
 e.over();await waitForHover();e.layer().dispatchEvent(new p.W.MouseEvent('click',{bubbles:true,composed:true,cancelable:true}));
 const url=new URL(e.frame.src);assert.equal(url.searchParams.get('autoplay'),'1');assert.equal(url.searchParams.has('muted'),false);assert.equal(e.layer(),null);
 const q=page(t);const f=frameEmbed(q);await hoverController(q);
 let held=0;f.node.addEventListener('rt-hold-feed-embed',event=>{held++;event.preventDefault();});
 f.over();await waitForHover();const playing=f.frame.getAttribute('src');f.layer().dispatchEvent(new q.W.MouseEvent('click',{bubbles:true,composed:true,cancelable:true}));
 assert.equal(held,1,'opening the post holds the playing iframe');
 assert.equal(f.frame.getAttribute('src'),playing,'not reloaded for sound, which would start it over: its own sound button works in the post');
 assert.match(f.frame.getAttribute('allow') || '',/autoplay/,'reloaded players may autoplay');
});
test('clicking into an embed’s player marks it in use, pauses other videos and carries it into its post',async t=>{
 const p=page(t);const e=frameEmbed(p);await hoverController(p,{videoStart:'reddit'});
 p.startFromControl();assert.equal(p.video.paused,false);
 e.frame.focus();p.W.dispatchEvent(new p.W.Event('blur'));await new Promise(r=>setTimeout(r,5));
 assert.equal(e.node.dataset.rtEmbedUsed,'1');assert.equal(p.video.paused,true,'one video at a time');
 let held=0;e.node.addEventListener('rt-hold-feed-embed',event=>{held++;event.preventDefault();});
 p.click(p.title);assert.equal(held,1);
 const q=page(t);const f=frameEmbed(q);await hoverController(q);let qheld=0;f.node.addEventListener('rt-hold-feed-embed',()=>qheld++);
 q.click(q.title);assert.equal(qheld,0,'an embed nobody touched stays put');
});

// Players with a control protocol: Embedly's player.js wrapper (Streamable, Vimeo, Twitch), YouTube's iframe API.
const embedly='https://cdn.embedly.com/widgets/media.html?src=https%3A%2F%2Fstreamable.com%2Fo%2Fabc&display_name=Streamable';
async function controlled(p,settings={},src=embedly){
 const e=frameEmbed(p,src);const controller=await hoverController(p,settings);const sent=[];
 controller.post=(frame,data)=>sent.push(JSON.parse(data));controller.frames.clear();controller.scan();
 const commands=()=>sent.filter(m=>m.method && !['addEventListener','getPaused'].includes(m.method) || m.func).map(m=>m.method || m.func);
 return {...e,controller,sent,commands};
}
test('an Embedly-wrapped preview starts muted in place through player.js, then pauses and gets its sound back',async t=>{
 const p=page(t);const c=await controlled(p);
 assert.ok(c.sent.some(m=>m.context==='player.js' && m.method==='addEventListener' && m.value==='play'),'it listens for the player starting');
 c.over();await waitForHover();
 assert.equal(c.frame.getAttribute('src'),embedly,'no reload');assert.deepEqual(c.commands(),['mute','play']);
 c.over('pointerout',c.frame,p.d.body);await new Promise(r=>setTimeout(r,260));
 assert.deepEqual(c.commands(),['mute','play','pause','unmute']);
});
test('Play here unmutes an Embedly preview in place; YouTube’s own iframe gets its iframe-API commands',async t=>{
 const p=page(t);const c=await controlled(p,{videoPreviewClick:'here'});
 c.over();await waitForHover();c.layer().dispatchEvent(new p.W.MouseEvent('click',{bubbles:true,composed:true,cancelable:true}));
 assert.deepEqual(c.commands(),['mute','play','unmute','play']);assert.equal(c.frame.getAttribute('src'),embedly);
 const q=page(t);const y=await controlled(q,{},'https://www.youtube.com/embed/abc?feature=oembed&enablejsapi=1');
 y.over();await waitForHover();assert.deepEqual(y.commands(),['mute','playVideo']);
});
test('a provider player that starts by its own controls pauses Reddit videos; starting a Reddit video pauses it',async t=>{
 const p=page(t);const c=await controlled(p,{videoStart:'reddit'});
 p.startFromControl();assert.equal(p.video.paused,false);
 p.W.dispatchEvent(new p.W.MessageEvent('message',{data:JSON.stringify({context:'player.js',event:'play'}),source:c.frame.contentWindow}));
 assert.equal(p.video.paused,true,'one video at a time');assert.equal(c.node.dataset.rtEmbedUsed,'1');
 c.sent.length=0;p.startFromControl();
 assert.deepEqual(c.commands(),['pause'],'the provider player is paused');
});
test('commands sent before a player is ready are sent again when it says so',async t=>{
 const p=page(t);const c=await controlled(p);
 c.over();await waitForHover();const before=c.commands().length;
 p.W.dispatchEvent(new p.W.MessageEvent('message',{data:JSON.stringify({context:'player.js',event:'ready'}),source:c.frame.contentWindow}));
 assert.deepEqual(c.commands().slice(before),['mute','play']);
});

test('Reddit’s lite-vimeo is started muted through its own autoload and autoplay, then driven by Vimeo’s messages',async t=>{
 const p=page(t);
 const node=p.d.createElement('shreddit-embed');node.setAttribute('providername','Vimeo');
 const lite=node.attachShadow({mode:'open'}).appendChild(p.d.createElement('lite-vimeo'));lite.setAttribute('videoid','123');
 const inner=lite.attachShadow({mode:'open'});
 lite.addEventListener('click',()=>{const url=new URL('https://player.vimeo.com/video/123');url.searchParams.set('dnt','1');if(lite.hasAttribute('autoload') && lite.hasAttribute('autoplay'))url.searchParams.set('autoplay','1');const f=p.d.createElement('iframe');f.setAttribute('src',url.href);inner.append(f);});
 p.player.closest('shreddit-post').append(node);
 const controller=await hoverController(p);const sent=[];controller.post=(frame,data)=>sent.push(JSON.parse(data));
 const over=new p.W.MouseEvent('pointerover',{bubbles:true,composed:true});Object.defineProperty(over,'pointerType',{value:'mouse'});lite.dispatchEvent(over);await waitForHover();
 const frame=inner.querySelector('iframe');assert.ok(frame,'the player was made');
 const url=new URL(frame.getAttribute('src'));assert.equal(url.searchParams.get('autoplay'),'1');assert.equal(url.searchParams.get('muted'),'1');
 assert.match(frame.getAttribute('allow'),/autoplay/,'delegate playback before setting the Vimeo preview URL');
 assert.deepEqual(sent.filter(m=>m.method!=='addEventListener').map(m=>m.method+(m.value!==undefined?':'+m.value:'')),['setMuted:true','play'],'Vimeo’s own mute, which setVolume does not lift');
});
test('players with no controls stay unloaded unless chosen: Autoplay loads only the one in view; a play button starts one and unloads the rest',async t=>{
 const p=page(t);phone(p,true,-900);
 const a=frameEmbed(p,'https://www.redgifs.com/ifr/first');a.node.getBoundingClientRect=()=>({top:100,bottom:400,height:300,left:0,width:390});
 const post2=p.d.createElement('shreddit-post');post2.id='t3_second';p.d.body.append(post2);
 const node2=p.d.createElement('shreddit-embed');node2.setAttribute('providername','RedGIFs');const f2=node2.attachShadow({mode:'open'}).appendChild(p.d.createElement('iframe'));f2.setAttribute('src','https://www.redgifs.com/ifr/second');post2.append(node2);
 node2.getBoundingClientRect=()=>({top:2000,bottom:2300,height:300,left:0,width:390});
 const controller=await hoverController(p,{videoStartTouch:'autoplay'});controller.scan();
 assert.equal(f2.getAttribute('src'),'about:blank','off-screen: unloaded');
 scroll(p);await new Promise(r=>setTimeout(r,250));
 assert.match(a.frame.getAttribute('src'),/redgifs\.com\/ifr\/first/,'in view: loaded and playing');
 node2.shadowRoot.querySelector('[data-rt-parked-cover]').dispatchEvent(new p.W.MouseEvent('click',{bubbles:true,composed:true,cancelable:true}));
 assert.equal(new URL(f2.src).pathname,'/ifr/second','the play button loads it');
 assert.equal(a.frame.getAttribute('src'),'about:blank','and the one that was playing is unloaded');
});
test('an Embedly player that never answers player.js is started through flags on the provider address inside it',async t=>{
 const p=page(t);const twitch='https://cdn.embedly.com/widgets/media.html?src='+encodeURIComponent('https://clips.twitch.tv/embed?clip=x&parent=cdn.embedly.com&autoplay=false')+'&display_name=Twitch';
 const c=await controlled(p,{},twitch);
 c.over();await waitForHover();assert.equal(c.frame.getAttribute('src'),twitch,'first through player.js');
 await new Promise(r=>setTimeout(r,2600));
 const inner=new URL(new URL(c.frame.getAttribute('src')).searchParams.get('src'));
 assert.equal(inner.searchParams.get('autoplay'),'true');assert.equal(inner.searchParams.get('muted'),'true');assert.equal(inner.searchParams.get('clip'),'x');
});
test('a Play here tap survives an Embedly control probe that never answers',async t=>{
 const p=page(t),timer=p.W.setTimeout.bind(p.W);
 p.W.setTimeout=(fn,ms,...args)=>timer(fn,ms===2500?160:ms,...args);
 const twitch='https://cdn.embedly.com/widgets/media.html?src='+encodeURIComponent('https://clips.twitch.tv/embed?clip=x&autoplay=false&muted=true');
 const c=await controlled(p,{videoPreviewClick:'here'},twitch);
 c.over();await waitForHover();p.click(c.layer());
 await new Promise(resolve=>timer(resolve,180));
 const inner=new URL(new URL(c.frame.getAttribute('src')).searchParams.get('src'));
 assert.equal(inner.searchParams.get('autoplay'),'true');assert.equal(inner.searchParams.get('muted'),'false');
});

test('a player with no controls that Reddit adds later is caught before it loads and shows the post’s preview image',async t=>{
 const p=page(t);phone(p,true,-900);
 const node=p.d.createElement('shreddit-embed');node.setAttribute('providername','RedGIFs');node.attachShadow({mode:'open'});
 node.getBoundingClientRect=()=>({top:2000,bottom:2300,height:300,left:0,width:390});
 p.player.closest('shreddit-post').append(node);
 const controller=await hoverController(p,{videoStartTouch:'play'});
 const asked=[];controller.readPosters=async ids=>{asked.push(...ids);return {t3_test:'https://preview.redd.it/poster.jpg?width=640'};};
 controller.scan();
 const frame=p.d.createElement('iframe');frame.setAttribute('src','https://www.redgifs.com/ifr/late');node.shadowRoot.append(frame);
 await Promise.resolve();await Promise.resolve();
 assert.equal(frame.getAttribute('src'),'about:blank','unloaded as Reddit adds it');assert.equal(frame.dataset.rtSrc,'https://www.redgifs.com/ifr/late');
 await flush();
 await new Promise(r=>setTimeout(r,100));
 assert.deepEqual(asked,['t3_test'],'one batched lookup');
 assert.match(node.shadowRoot.querySelector('[data-rt-parked-cover]').dataset.rtStill,/preview\.redd\.it\/poster\.jpg/);
});
test('with the default choices a playing video carries into its post again',async t=>{
 const p=page(t);
 const c=new p.W.RTVideoControlRaw.Videos({readSettings:async()=>({}),readPreference:async()=>false,observe:false});await c.ready;await flush();
 p.startFromControl();p.click(p.title);
 assert.ok(p.W.sessionStorage.getItem(continuationKey),'Keeps playing in the post is the default');
});

test('a player with controls that stops being the one playing stays paused on its own frame, with nothing over it',async t=>{
 const p=page(t);const c=await controlled(p);c.controller.readPosters=async()=>({t3_test:'https://preview.redd.it/still.jpg?width=640'});
 c.over();await waitForHover();
 c.over('pointerout',c.frame,p.d.body);await new Promise(r=>setTimeout(r,260));
 await new Promise(r=>setTimeout(r,100));
 assert.equal(c.node.shadowRoot.querySelector('[data-rt-parked-cover]'),null,'no image or black box over the paused frame');
 assert.equal(c.frame.getAttribute('src'),embedly,'still loaded, so it resumes where it was');assert.ok(c.commands().includes('pause'));
 const q=page(t);const none=await controlled(q);none.controller.readPosters=async()=>({});
 none.over();await waitForHover();none.over('pointerout',none.frame,q.d.body);await new Promise(r=>setTimeout(r,360));
 assert.equal(none.node.shadowRoot.querySelector('[data-rt-parked-cover]'),null,'with no image its paused picture shows');
});
test('when a Reddit video starts, a feed player that was playing pauses on its own frame',async t=>{
 const p=page(t);const c=await controlled(p,{videoStart:'reddit'});c.controller.readPosters=async()=>({t3_test:'https://preview.redd.it/still.jpg'});
 p.W.dispatchEvent(new p.W.MessageEvent('message',{data:JSON.stringify({context:'player.js',event:'play'}),source:c.frame.contentWindow}));
 assert.equal(c.node.shadowRoot.querySelector('[data-rt-parked-cover]'),null,'the one playing is not covered');
 p.startFromControl();
 assert.equal(c.node.shadowRoot.querySelector('[data-rt-parked-cover]'),null,'its paused frame stays visible');assert.equal(c.node.dataset.rtEmbedUsed,undefined,'a paused player is not carried into its post');
});
test('opening the post of a Vimeo preview turns its sound on with Vimeo’s own unmute',async t=>{
 const p=page(t);const c=await controlled(p,{},'https://player.vimeo.com/video/9?dnt=1');
 c.node.addEventListener('rt-hold-feed-embed',event=>event.preventDefault());
 c.over();await waitForHover();c.sent.length=0;
 c.layer().dispatchEvent(new p.W.MouseEvent('click',{bubbles:true,composed:true,cancelable:true}));
 assert.deepEqual(c.sent.filter(m=>m.method!=='addEventListener').map(m=>m.method+(m.value!==undefined?':'+m.value:'')),['setMuted:false','setVolume:1','play']);
});
test('Embedly sound is requested on the tap and after the same player lands in the post',async t=>{
 const p=page(t);const c=await controlled(p);
 const card=c.node.closest('shreddit-post'),feed=p.d.createElement('shreddit-feed');card.before(feed);feed.append(card);
 c.node.addEventListener('rt-hold-feed-embed',event=>event.preventDefault());
 c.over();await waitForHover();c.sent.length=0;
 c.layer().click();assert.deepEqual(c.commands(),['unmute','play']);
 p.W.history.pushState({},'',postPath);
 const post=Object.assign(p.d.createElement('shreddit-post'),{id:'t3_test'}),target=p.d.createElement('shreddit-embed');p.d.body.append(post);post.append(target);
 target.addEventListener('rt-place-held-embed',event=>{target.attachShadow({mode:'open'}).append(c.frame);event.preventDefault();},{once:true});
 c.controller.scan();
 assert.deepEqual(c.commands(),['unmute','play','unmute','play']);
 assert.equal(target.shadowRoot.querySelector('iframe'),c.frame);assert.equal(c.frame.getAttribute('src'),embedly);
});
test('a late Vimeo readiness signal applies only the current sound and playback intent',async t=>{
 const p=page(t);const c=await controlled(p,{},'https://player.vimeo.com/video/9?dnt=1');
 c.over();await waitForHover();c.layer().querySelector('button').click();c.sent.length=0;
 p.W.dispatchEvent(new p.W.MessageEvent('message',{data:JSON.stringify({event:'ready'}),source:c.frame.contentWindow}));
 assert.deepEqual(c.sent.filter(m=>m.method!=='addEventListener').map(m=>[m.method,m.value]),[['setMuted',false],['setVolume',1],['play',undefined]]);
});
test('the sound overlay for a Twitch clip hands control to its current player without restarting',async t=>{
 const p=page(t);const c=await controlled(p,{},'https://clips.twitch.tv/embed?clip=x&parent=www.reddit.com');
 c.over();await waitForHover();
 const src=c.frame.getAttribute('src'),button=c.layer().querySelector('button');
 assert.equal(button.getAttribute('aria-label'),'Use player’s sound control');
 button.click();
 assert.equal(c.layer(),null);assert.equal(c.frame.getAttribute('src'),src);
 assert.equal(c.node.dataset.rtEmbedUsed,'1');
});
test('as a feed card approaches, warm its native poster and batch a missing embed poster before either is needed',async t=>{
 const p=page(t);p.player.setAttribute('poster','https://preview.redd.it/native.jpg');
 const c=await controlled(p),decoded=[],requests=[];
 p.W.Image=class{decode(){decoded.push(this.src);return Promise.resolve();}};
 c.controller.readPosters=async ids=>{requests.push(Array.from(ids));return {t3_test:'https://preview.redd.it/embed.jpg'};};
 c.controller.preparedPosters=new WeakSet();c.controller.warmedPosters.clear();c.controller.posters.clear();c.controller.scan();await flush();
 await new Promise(resolve=>setTimeout(resolve,100));
 assert.deepEqual(requests,[['t3_test']]);
 assert.deepEqual(decoded,['https://preview.redd.it/native.jpg','https://preview.redd.it/embed.jpg']);
 assert.equal(c.node.shadowRoot.querySelector('[data-rt-parked-cover]'),null,'preparing the image does not change playback or visible markup');
});
test('after a feed sound tap, leaving the viewport pauses and covers the same running player',async t=>{
 const p=page(t);const c=await controlled(p);
 c.controller.readPosters=async()=>({});c.over();await waitForHover();
 c.layer().querySelector('button').click();assert.ok(p.io.observed.includes(c.node));
 c.sent.length=0;
 p.io.cb([{target:c.node,intersectionRatio:0.3}]);assert.deepEqual(c.commands(),[]);
 p.io.cb([{target:c.node,intersectionRatio:0}]);assert.deepEqual(c.commands(),['pause']);
 await new Promise(resolve=>setTimeout(resolve,80));
 const cover=c.node.shadowRoot.querySelector('[data-rt-parked-cover]');
 assert.ok(cover,'Play is available over the paused frame even with no other poster');
 assert.equal(c.frame.getAttribute('src'),embedly);
 cover.click();assert.deepEqual(c.commands(),['pause','unmute','play']);
 assert.equal(c.frame.getAttribute('src'),embedly,'resume the same frame');
});
test('when a player cannot pause, leaving the viewport after the sound overlay stops its loop',async t=>{
 const p=page(t);const c=await controlled(p,{},'https://www.redgifs.com/ifr/example');
 c.over();await waitForHover();c.layer().querySelector('button').click();
 p.io.cb([{target:c.node,intersectionRatio:0}]);
 assert.equal(c.frame.getAttribute('src'),'about:blank');assert.ok(c.node.shadowRoot.querySelector('[data-rt-parked-cover]'));
});

test('with direct controls on, a player that starts by itself stays loaded and is told to wait on its first frame unless chosen',async t=>{
 const p=page(t);const e=frameEmbed(p,'https://www.redgifs.com/ifr/example');
 p.W.HTMLMediaElement.prototype.play=function(){this._playing=true;this.dispatchEvent(new p.W.Event('play'));return Promise.resolve();};
 const c=new p.W.RTVideoControl.Videos({readSettings:async()=>({embedStart:'play'}),readPreference:async()=>true,readDirect:async()=>true,observe:false});
 await c.ready;await flush();c.scan();
 assert.equal(e.frame.getAttribute('src'),'https://www.redgifs.com/ifr/example','not unloaded');
 assert.equal(e.node.shadowRoot.querySelector('[data-rt-parked-cover]'),null,'no image over its own first frame');
 const told=[];e.frame.contentWindow.postMessage=data=>told.push(data.rtMedia);
 p.W.dispatchEvent(new p.W.MessageEvent('message',{data:{rtMedia:'hello'},origin:'https://www.redgifs.com',source:e.frame.contentWindow}));
 assert.ok(told.includes('pause'),'an idle feed card waits');assert.equal(told.includes('play'),false);
 told.length=0;e.node.dataset.rtEmbedUsed='1';
 p.W.dispatchEvent(new p.W.MessageEvent('message',{data:{rtMedia:'hello'},origin:'https://www.redgifs.com',source:e.frame.contentWindow}));
 assert.ok(told.includes('play'),'one you chose plays');
});
test('without a usable still a parked player shows a plain placeholder with the provider’s name',async t=>{
 const p=page(t);const e=frameEmbed(p,'https://www.redgifs.com/ifr/example');e.node.setAttribute('providername','RedGIFs');
 const c=await hoverController(p,{embedStart:'play'});c.readPosters=async()=>({});c.scan();
 await new Promise(resolve=>setTimeout(resolve,100));
 const cover=e.node.shadowRoot.querySelector('[data-rt-parked-cover]'),label=cover.querySelector('[data-rt-parked-label]');
 assert.equal(cover.hasAttribute('data-rt-placeholder'),true);assert.equal(label.textContent,'RedGIFs');assert.equal(label.hidden,false);
 assert.equal(cover.style.backgroundSize,'contain','a still is fitted like the player, not cropped');
});
test('On Play: a still that turns out tiny gives way to the player loaded idle, without autoplay',async t=>{
 const p=page(t);phone(p,true,-900);
 const tiny='https://cdn.example.test/tiny.jpg',address=embedly+'&autoplay=1&image='+encodeURIComponent(tiny);
 p.W.Image=class{constructor(){this.listeners={};}addEventListener(type,fn){this.listeners[type]=fn;}decode(){return Promise.resolve();}};
 const e=frameEmbed(p,address);e.node.getBoundingClientRect=()=>({top:205,height:280});
 const c=await hoverController(p,{embedStartTouch:'play'});c.scan();
 assert.equal(e.frame.getAttribute('src'),'about:blank','parked behind Reddit’s still');
 const image=c.warmedPosters.get(tiny);Object.assign(image,{complete:true,naturalWidth:40,naturalHeight:30});image.listeners.load();
 const loaded=new URL(e.frame.getAttribute('src'));
 assert.equal(loaded.origin,'https://cdn.embedly.com');assert.equal(loaded.searchParams.has('autoplay'),false,'idle, not started');
 assert.equal(e.node.shadowRoot.querySelector('[data-rt-parked-cover]'),null,'its own first frame or poster shows');
});

test('a RedGIFs card with no still in the markup gets one from its post’s own Reddit data, drawn without a referrer',async t=>{
 const p=page(t);const asked=[];
 p.W.fetch=async url=>{asked.push(String(url));return {ok:true,status:200,json:async()=>[{data:{children:[{data:{secure_media:{oembed:{thumbnail_url:'https://media.redgifs.com/CamelName-poster.jpg'}}}}]}}]};};
 const e=frameEmbed(p,'https://www.redgifs.com/ifr/camelname');e.node.setAttribute('providername','RedGIFs');
 const c=await hoverController(p,{embedStart:'play'});c.scan();
 await flush();
 await new Promise(resolve=>setTimeout(resolve,500));
 assert.deepEqual(asked,['https://www.reddit.com/comments/test.json?limit=1&depth=1&raw_json=1'],'one small read for the one post');
 const cover=e.node.shadowRoot.querySelector('[data-rt-parked-cover]'),still=cover.querySelector('[data-rt-parked-still]');
 assert.equal(cover.dataset.rtStill,'https://media.redgifs.com/CamelName-poster.jpg');assert.equal(still.referrerPolicy,'no-referrer');
 assert.equal(cover.hasAttribute('data-rt-placeholder'),false);
});

test('stills are found for cards whose player Reddit has not inserted yet, every queued card included',async t=>{
 const p=page(t);const asked=[];
 p.W.fetch=async url=>{asked.push(String(url));return {ok:true,status:200,json:async()=>[{data:{children:[{data:{secure_media:{oembed:{thumbnail_url:'https://media.example.test/'+asked.length+'.jpg'}}}}]}}]};};
 const nodes=[];
 for(let i=0;i<6;i++){
  const post=p.d.createElement('shreddit-post');post.id='t3_late'+i;p.d.body.append(post);
  const node=p.d.createElement('shreddit-embed');node.setAttribute('providername','Example');
  node.setAttribute('embed-html','<iframe src="https://www.redgifs.com/ifr/late'+i+'"></iframe>');node.attachShadow({mode:'open'});post.append(node);nodes.push(node);
 }
 const c=await hoverController(p,{embedStart:'play'});c.scan();
 await flush();
 await new Promise(resolve=>setTimeout(resolve,1600));
 assert.equal(asked.length,6,'every queued card is read, not only the first four');
 for(let i=0;i<6;i++)assert.ok(c.posters.get('t3_late'+i),'still known for card '+i+' before it is shown');
});

test('on a fresh page the stills nearest the screen are looked up first and each shows as soon as it is read',async t=>{
 const p=page(t);const asked=[];let release;const slow=new Promise(resolve=>{release=resolve;});
 p.W.fetch=async url=>{const id=/comments\/(\w+)\.json/.exec(String(url))[1];asked.push(id);if(id==='far')await slow;
  return {ok:true,status:200,json:async()=>[{data:{children:[{data:{secure_media:{oembed:{thumbnail_url:'https://media.example.test/'+id+'.jpg'}}}}]}}]};};
 const make=id=>{const post=p.d.createElement('shreddit-post');post.id='t3_'+id;p.d.body.append(post);
  const node=p.d.createElement('shreddit-embed');node.setAttribute('embed-html','<iframe src="https://www.redgifs.com/ifr/'+id+'"></iframe>');node.attachShadow({mode:'open'});post.append(node);return node;};
 const far=make('far'),mid=make('mid'),near=make('near');
 far.getBoundingClientRect=()=>({top:4000,height:300});mid.getBoundingClientRect=()=>({top:1500,height:300});near.getBoundingClientRect=()=>({top:200,height:300});
 const c=await hoverController(p,{embedStart:'play'});c.scan();
 await new Promise(resolve=>setTimeout(resolve,500));
 assert.deepEqual(asked.slice(0,2),['near','mid'],'nearest first, two at a time');
 assert.equal(c.posters.get('t3_near'),'https://media.example.test/near.jpg','shown before the slow one finishes');
 release();await new Promise(resolve=>setTimeout(resolve,50));
 assert.equal(c.posters.get('t3_far'),'https://media.example.test/far.jpg');
});

test('a card shows its still while Reddit has not inserted its player, and until that player has drawn',async t=>{
 const p=page(t),image='https://cdn.example.test/still.jpg';
 const node=p.d.createElement('shreddit-embed');node.setAttribute('embedly-iframe','<iframe src="'+embedly+'&image='+encodeURIComponent(image)+'"></iframe>');node.attachShadow({mode:'open'});
 p.player.closest('shreddit-post').append(node);
 const c=await hoverController(p,{embedStart:'autoplay'});c.scan();await flush();
 const pre=()=>node.shadowRoot.querySelector('[data-rt-pre-still]');
 assert.equal(pre()?.getAttribute('src'),image,'the still, not a black box');assert.equal(pre().referrerPolicy,'no-referrer');
 const frame=p.d.createElement('iframe');frame.setAttribute('src',embedly);node.shadowRoot.append(frame);await flush();
 assert.ok(pre(),'kept while the player loads');
 frame.dispatchEvent(new p.W.Event('load'));await new Promise(resolve=>setTimeout(resolve,450));
 assert.equal(pre(),null,'gone once the player has drawn');
});
