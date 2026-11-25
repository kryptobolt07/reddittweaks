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
 // Defaults are passive (Reddit/Provider Default); behaviour tests opt into the features they exercise unless they say otherwise.
 const Raw=W.RTVideoControl;W.RTVideoControlRaw=Raw;
 W.RTVideoControl={...Raw,Videos:class extends Raw.Videos{constructor(options={}){const read=options.readSettings;super({...options,readSettings:async()=>{
  const extra=read?await read():{};
  const base={videoStart:'preview',embedStart:'preview',gifStart:'autoplay',mediaClickAction:'open',clickAudio:'unmute',singleVideo:true,videoOpenPost:'position',videoScrollAway:'pause'};
  if('videoStart' in extra || 'videoStartTouch' in extra || 'videoPreviewsInView' in extra)delete base.videoStart;
  if('embedStart' in extra || 'embedStartTouch' in extra)delete base.embedStart;
  if('gifStart' in extra || 'gifStartTouch' in extra)delete base.gifStart;
  if('mediaClickAction' in extra || 'videoPreviewClick' in extra || 'videoPreviewClickPlays' in extra)delete base.mediaClickAction;
  if('clickAudio' in extra || 'videoPreviewClick' in extra || 'videoUnmutePreview' in extra)delete base.clickAudio;
  if('videoOpenPost' in extra || 'videoPreviewFrom' in extra || 'videoPreviewRestart' in extra)delete base.videoOpenPost;
  return {...base,...extra};
 }});}}};
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
test('default settings are genuinely passive, while Autoplay plays in-view muted and Play only starts nothing',async t=>{
 const passive=page(t);let asked=0;
 passive.W.HTMLMediaElement.prototype.play=function(){this._playing=true;this.dispatchEvent(new passive.W.Event('play'));return Promise.resolve();};
 Object.defineProperty(passive.video,'readyState',{value:1,configurable:true});
 passive.player.getBoundingClientRect=()=>({top:100,bottom:400,height:300,left:0,width:390});
 const c0=new passive.W.RTVideoControlRaw.Videos({readSettings:async()=>({}),readPreference:async()=>{asked++;return false;},observe:false});await c0.ready;await flush();
 assert.equal(c0.active,false,'fresh install attaches zero observers/listeners');
 assert.equal(passive.io.observed.length,0,'zero IntersectionObserver entries in passive default');
 passive.start();assert.equal(passive.video.paused,false,'Reddit native autoplay is never blocked in passive default');
 assert.equal(asked,0,'Reddit preference is never fetched');
 const p=page(t);
 p.W.HTMLMediaElement.prototype.play=function(){this._playing=true;this.dispatchEvent(new p.W.Event('play'));return Promise.resolve();};
 Object.defineProperty(p.video,'readyState',{value:1,configurable:true});
 p.player.getBoundingClientRect=()=>({top:100,bottom:400,height:300,left:0,width:390});
 const c=new p.W.RTVideoControlRaw.Videos({readSettings:async()=>({videoStart:'autoplay'}),readPreference:async()=>false,observe:false});await c.ready;await flush();c.scan();
 p.start();assert.equal(p.video.paused,true,'Autoplay mode replaces Reddit native autoplay');
 p.W.dispatchEvent(new p.W.Event('scroll'));await new Promise(r=>setTimeout(r,250));
 assert.equal(p.video.paused,false,'Autoplay plays the video in view');assert.equal(p.video.muted,true);
 const q=page(t);const d=new q.W.RTVideoControlRaw.Videos({readSettings:async()=>({videoStart:'play'}),readPreference:async()=>false,observe:false});await d.ready;await flush();
 q.start();q.W.dispatchEvent(new q.W.Event('scroll'));await new Promise(r=>setTimeout(r,250));assert.equal(q.video.paused,true,'Only when I press Play');
 q.startFromControl();assert.equal(q.video.paused,false,'your own Play still plays');
});
test('video choices default to passive Reddit/Provider defaults, and legacy opt-ins migrate cleanly',()=>{
 const W=new JSDOM('',{runScripts:'outside-only'}).window;W.eval(fs.readFileSync('extension/post-model.js','utf8'));
 const v=raw=>W.RTPostModel.videoSettings(raw);
 assert.deepEqual(JSON.parse(JSON.stringify(v({}))),{
  videoStart:'default',embedStart:'default',gifStart:'default',
  mediaClickAction:'default',clickAudio:'muted',embedBlockLinks:'off',
  singleVideo:false,volumeMemory:false,videoScrollAway:'default',
  videoOpenPost:'default',cardClickAudio:'keep',videoDirectOpen:'default',holdFor2x:false,loopPolicy:'default',streamQuality:'auto'
 },'100% passive defaults on fresh install');
 for(const value of ['default','muted','sound','paused'])assert.equal(v({videoDirectOpen:value}).videoDirectOpen,value);
 assert.equal(v({videoDirectOpen:'loud'}).videoDirectOpen,'default','unknown direct-open choices fall back to Reddit Default');
 const migrated=v({videoPreviewsInView:true,videoPreviewClickPlays:true,videoPreviewRestart:true,videoUnmutePreview:false,videoOpenPost:'continue',videoScrollAway:'reddit'});
 assert.equal(migrated.videoStart,'preview');
 assert.equal(migrated.mediaClickAction,'inline');
 assert.equal(migrated.clickAudio,'muted');
 assert.equal(migrated.videoOpenPost,'start');
 assert.equal(migrated.videoScrollAway,'default');
 assert.equal(v({videoPreviewClick:'here',videoUnmutePreview:true}).clickAudio,'unmute');
 assert.equal(v({videoStart:'hover'}).videoStart,'preview');
 assert.equal(v({videoStart:'reddit',videoStartTouch:'reddit'}).videoStart,'default');
 W.close();
});
test('GIFs and embeds are independent of videoStart and default to passive',()=>{
 const W=new JSDOM('',{runScripts:'outside-only'}).window;
 try{
  W.eval(fs.readFileSync('extension/post-model.js','utf8'));
  const normalize=W.RTPostModel.normalizeSettings;
  const onlyVideo=normalize({videoStart:'preview'});
  assert.equal(onlyVideo.videoStart,'preview');
  assert.equal(onlyVideo.embedStart,'default');
  assert.equal(onlyVideo.gifStart,'default');
  const chosen=normalize({videoStart:'preview',embedStart:'play',gifStart:'autoplay'});
  assert.equal(chosen.videoStart,'preview');assert.equal(chosen.embedStart,'play');assert.equal(chosen.gifStart,'autoplay');
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
 assert.equal(p.player.parentElement.style.position,'absolute','the video stays at its card place in document coordinates above the feed');
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

test('a wheel scroll during the move stays free instead of pausing or cancelling playback',async t=>{
 const p=page(t),calls=nativeMove(p);
 const controller=new p.W.RTVideoControl.Videos({readPreference:async()=>false,observe:false});await controller.ready;
 p.startFromControl();p.video.currentTime=8;
 const feed=p.player.parentElement;p.click(p.title);
 assert.notEqual(p.player.parentElement,feed);
 const wheel=new p.W.WheelEvent('wheel',{deltaY:20,bubbles:true,cancelable:true});
 p.W.dispatchEvent(wheel);
 assert.equal(wheel.defaultPrevented,false,'scrolling is never frozen');
 assert.equal(p.player.parentElement.style.position,'absolute','the player stays anchored in document coordinates');
 assert.equal(p.video.paused,false,'playback does not pause');
 assert.deepEqual(calls,['begin']);
 assert.equal(p.d.documentElement.hasAttribute('data-rt-media-moving'),true);
 p.W.history.pushState({},'',postPath);
 const post=p.d.createElement('shreddit-post');post.id='t3_test';p.d.body.append(post);
 const detail=p.player.cloneNode();detail.setAttribute('player-type','post_detail_screen');post.append(detail);
 detail.attachShadow({mode:'open'}).appendChild(p.d.createElement('video'));
 controller.handoff();
 assert.equal(p.player.parentElement,post,'still lands seamlessly in the post');
 assert.equal(p.video.paused,false);
 assert.equal(p.d.documentElement.hasAttribute('data-rt-media-moving'),false);
});
test('Back before the detail slot mounts releases the native pause override',async t=>{
 const p=page(t),calls=nativeMove(p);
 const controller=new p.W.RTVideoControl.Videos({readPreference:async()=>false,observe:false});await controller.ready;
 p.startFromControl();
 const feed=p.player.parentElement;p.click(p.title);
 p.W.dispatchEvent(new p.W.PopStateEvent('popstate'));
 assert.equal(p.player.parentElement,feed);
 assert.equal(p.video.paused,false);
 assert.deepEqual(calls,['begin','end']);
 assert.equal(p.W.sessionStorage.getItem(continuationKey),null);
});
test('the native video keeps playing across feed removal',async t=>{
 const p=page(t),calls=nativeMove(p);
 const controller=await hoverController(p);
 p.startFromControl();p.video.currentTime=8;
 const card=p.player.closest('shreddit-post');
 p.click(p.title);p.W.history.pushState({},'',postPath);
 card.remove();p.video.currentTime=9;
 assert.equal(p.video.isConnected,true);
 const post=p.d.createElement('shreddit-post');post.id='t3_test';p.d.body.append(post);
 const detail=p.player.cloneNode();detail.setAttribute('player-type','post_detail_screen');post.append(detail);
 const video=detail.attachShadow({mode:'open'}).appendChild(p.d.createElement('video'));
 Object.defineProperty(video,'readyState',{value:1});
 controller.scan();
 assert.equal(detail.isConnected,false);
 assert.equal(post.querySelector('shreddit-player'),p.player);
 assert.equal(p.video.currentTime,9);assert.equal(p.video.paused,false);
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
 while(frames.length)frames.shift()();
 assert.equal(p.io.observed.filter(player=>player===p.player).length,2);
 p.io.cb([stale]);assert.equal(p.video.paused,false,'a queued feed entry cannot pause the detail player');
 p.io.cb([{target:p.player,intersectionRatio:0,time:p.W.performance.now()}]);
 assert.equal(p.video.paused,true,'fresh geometry still pauses real scroll-away');
});
test('the native player carries its sound into the detail slot',async t=>{
 const p=page(t),calls=nativeMove(p);
 const controller=new p.W.RTVideoControl.Videos({readPreference:async()=>false,observe:false});await controller.ready;
 const sound=[];p.player.volumeController={setVolume(position){sound.push(position);}};p.video.muted=false;p.video.volume=0.36;
 p.startFromControl();p.click(p.title);p.W.history.pushState({},'',postPath);
 const detail=p.player.cloneNode();detail.setAttribute('player-type','post_detail_screen');
 const post=p.d.createElement('shreddit-post');post.id='t3_test';post.append(detail);p.d.querySelector('main').append(post);
 controller.scan();
 assert.deepEqual(sound,[0.6],'the post re-applies Reddit’s sound state');
 assert.equal(post.querySelector('shreddit-player'),p.player);
 assert.equal(detail.isConnected,false);
 assert.deepEqual(calls,['begin','end']);
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
 assert.equal(p.player.parentElement.style.position,'absolute');
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
const waitForHover=()=>new Promise(resolve=>setTimeout(resolve,330));
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
test('Play here plays a clicked preview in place, and Start from beginning restarts on post open',async t=>{
 const p=page(t);await hoverController(p,{mediaClickAction:'inline',clickAudio:'unmute'});const c=surfaceClick(p);
 pointer(p);await waitForHover();p.video.currentTime=3.5;
 p.click(p.video);
 assert.deepEqual(c.count(),{toggled:0,opened:0});
 assert.equal(p.video.currentTime,3.5);assert.equal(p.video.paused,false);assert.equal(p.video.muted,false);
 pointer(p,'pointerout');await new Promise(resolve=>setTimeout(resolve,260));
 assert.equal(p.video.paused,false,'it is no longer a preview');
});
test('an opened preview can start from the beginning and keep its sound off',async t=>{
 const p=page(t);await hoverController(p,{videoOpenPost:'start',clickAudio:'muted'});
 pointer(p);await waitForHover();p.video.currentTime=3.5;
 p.click(p.video);
 const saved=JSON.parse(p.W.sessionStorage.getItem(continuationKey));
 assert.equal(saved.time,0);assert.equal(saved.muted,true);assert.equal(p.video.muted,true);
});
function phone(p,coarse=true,top=200){
 p.W.matchMedia=query=>({matches:coarse && /hover: none.*pointer: coarse/.test(query)});
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
test('each device follows its start mode: Play starts nothing, Smart Preview adapts to hover vs touch stop',async t=>{
 for(const [coarse,settings,plays] of [[true,{videoStart:'play'},false],[false,{videoStart:'preview'},false],[false,{videoStart:'autoplay'},true],[true,{videoStart:'preview'},true]]){
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
test('the same post inherits an explicit feed embed reveal, including when its native button hydrates late',async t=>{
 for(const reason of ['nsfw','spoiler','no-click']){
  const p=page(t),e=embed(p,{muted:true});
  const nativeGate=(parent,kind)=>{
   const box=p.d.createElement('div');box.slot='post-media-container';parent.append(box);
   box.innerHTML='<shreddit-blurred-container mode="slot" blurred><div slot="revealed"></div></shreddit-blurred-container>';
   const gate=box.firstElementChild;gate.setAttribute('reason',kind);return gate;
  };
  const addButton=gate=>{
   const button=gate.attachShadow({mode:'open'}).appendChild(p.d.createElement('button'));
   button.addEventListener('click',()=>gate.removeAttribute('blurred'));
   return button;
  };
  const card=e.node.closest('shreddit-post'),sourceGate=nativeGate(card,reason==='spoiler'?'spoiler':'nsfw');
  sourceGate.firstElementChild.append(e.node);
  const control=await hoverController(p);const sourceButton=addButton(sourceGate);
  if(reason==='no-click')sourceGate.removeAttribute('blurred');else p.click(sourceButton);
  assert.equal(control.revealedMediaGates.has(sourceGate),reason==='nsfw');
  e.over();await waitForHover();
  e.node.addEventListener('rt-hold-feed-embed',event=>event.preventDefault());
  p.click(p.title);p.W.history.pushState({},'',postPath);
  const post=p.d.createElement('shreddit-post');post.id='t3_test';p.d.body.append(post);
  const targetGate=nativeGate(post,reason==='spoiler'?'spoiler':'nsfw');
  const target=p.d.createElement('shreddit-embed');target.setAttribute('providername','YouTube');targetGate.firstElementChild.append(target);
  let landed=0;target.addEventListener('rt-place-held-embed',event=>{landed++;event.preventDefault();});
  control.embedHandoff();assert.equal(landed,0);
  addButton(targetGate);control.embedHandoff();
  assert.equal(targetGate.hasAttribute('blurred'),reason!=='nsfw');
  assert.equal(landed,reason==='nsfw'?1:0);
 }
});
test('Back before the post embed is ready returns the held YouTube player to its card',async t=>{
 const p=page(t);const e=embed(p);await hoverController(p);
 e.node.addEventListener('rt-hold-feed-embed',event=>event.preventDefault());
 let released=0;p.d.addEventListener('rt-release-feed-embed',()=>released++);
 p.click(p.title);p.W.dispatchEvent(new p.W.PopStateEvent('popstate'));
 assert.equal(released,1);assert.equal(p.W.sessionStorage.getItem(embedKey),null);
});
test('an unrevealed post blur gate conceals a held YouTube overlay while keeping the handoff alive for manual reveal',async t=>{
 const p=page(t);const e=embed(p);const control=await hoverController(p);
 e.node.addEventListener('rt-hold-feed-embed',event=>event.preventDefault());
 let concealed=0;p.d.addEventListener('rt-conceal-held-media',()=>concealed++);
 p.click(p.title);assert.ok(p.W.sessionStorage.getItem(embedKey));
 p.W.history.pushState({},'',postPath);
 const detail=p.d.createElement('shreddit-post');detail.id='t3_test';
 detail.innerHTML='<div slot="post-media-container"><shreddit-blurred-container blurred reason="spoiler"><div slot="revealed"></div></shreddit-blurred-container></div>';
 const target=embed(p).node;detail.querySelector('[slot="revealed"]').append(target);p.d.body.append(detail);
 control.embedHandoff();
 assert.equal(concealed,1,'the fixed stage is concealed so it never floats over the blurred gate');
 assert.ok(p.W.sessionStorage.getItem(embedKey),'handoff stays ready if the user reveals the gate');
});
test('a disconnected YouTube feed preview falls back to the post’s own embed at the saved position',async t=>{
 const p=page(t);const e=embed(p);const control=await hoverController(p);
 e.node.addEventListener('rt-hold-feed-embed',event=>event.preventDefault());
 let released=0;p.d.addEventListener('rt-release-feed-embed',()=>released++);
 p.click(p.title);assert.ok(p.W.sessionStorage.getItem(embedKey));
 p.W.history.pushState({},'',postPath);
 const target=embed(p).node;const detail=p.d.createElement('shreddit-post');detail.id='t3_test';detail.append(target);p.d.body.append(detail);
 e.node.closest('shreddit-post').remove();
 control.embedHandoff();
 assert.equal(released,1);assert.equal(target.dataset.rtStart,'12.5');
 assert.equal(p.W.sessionStorage.getItem(embedKey),null);
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
 c.preparedPosters=new WeakSet();c.posters.clear();c.warmedPosters.clear();c.scan();await flush();
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
  // Once the frame announces itself the preview continues without the click layer: the frame reports taps.
  assert.equal(e.layer(),null);
  assert.ok(messages.some(({data})=>data.rtMedia==='preview' && data.on===true));
  p.W.dispatchEvent(new p.W.MessageEvent('message',{source:frame,origin:new URL(src).origin,data:{rtMedia:open?'tap':'take'}}));
  assert.equal(e.frame.src,src);
  assert.equal(c.ePreview,null,'the preview became the reader’s');
  assert.ok(messages.some(({data})=>data.rtMedia==='preview' && data.on===false));
  // A tap follows Media click action (open, with sound); a click on the player's own sound control leaves sound to it.
  assert.equal(messages.some(({data,origin})=>data.rtMedia==='unmute' && origin==='https://www.redgifs.com'),open);
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
test('Play here keeps a flag-only preview loaded; opening its post carries the same iframe over at the same moment',async t=>{
 const p=page(t);const e=frameEmbed(p);await hoverController(p,{videoPreviewClick:'here'});
 e.over();await waitForHover();e.layer().dispatchEvent(new p.W.MouseEvent('click',{bubbles:true,composed:true,cancelable:true}));
 const url=new URL(e.frame.src);assert.equal(url.searchParams.get('autoplay'),'1');assert.equal(url.searchParams.get('muted'),'1','a flag-only preview keeps its position and reveals the player controls');assert.equal(e.layer(),null);
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
 const controller=await hoverController(p,{videoStart:'autoplay',embedStart:'autoplay'});controller.scan();
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
test('default choices are passive on post open; enabling videoOpenPost carries the playing video into its post',async t=>{
 const p=page(t);
 const c=new p.W.RTVideoControlRaw.Videos({readSettings:async()=>({}),readPreference:async()=>false,observe:false});await c.ready;await flush();
 p.startFromControl();p.click(p.title);
 assert.equal(p.W.sessionStorage.getItem(continuationKey),null,'passive default leaves post navigation untouched');
 const q=page(t);
 const c2=new q.W.RTVideoControlRaw.Videos({readSettings:async()=>({videoOpenPost:'position'}),readPreference:async()=>false,observe:false});await c2.ready;await flush();
 q.startFromControl();q.click(q.title);
 assert.ok(q.W.sessionStorage.getItem(continuationKey),'videoOpenPost=position carries playback into the post');
 const r=page(t);
 const c3=new r.W.RTVideoControlRaw.Videos({readSettings:async()=>({videoStart:'default',videoOpenPost:'position'}),readPreference:async()=>false,observe:false});await c3.ready;await flush();
 r.video.currentTime=4;r.start();r.click(r.title);
 assert.ok(r.W.sessionStorage.getItem(continuationKey),'videoOpenPost=position carries Reddit-autoplayed video into the post');
 // Separate policies: clicking the video itself uses clickAudio, clicking the post card around it uses cardClickAudio
 const s1=page(t);
 const c4=new s1.W.RTVideoControlRaw.Videos({readSettings:async()=>({videoStart:'default',mediaClickAction:'open',clickAudio:'unmute',videoOpenPost:'position',cardClickAudio:'muted'}),readPreference:async()=>false,observe:false});await c4.ready;await flush();
 s1.video.currentTime=5;s1.video.muted=true;s1.start();s1.click(s1.title);
 assert.equal(JSON.parse(s1.W.sessionStorage.getItem(continuationKey)).muted,true,'clicking the post card respects cardClickAudio=muted even when clickAudio=unmute');
 const s2=page(t);
 const c5=new s2.W.RTVideoControlRaw.Videos({readSettings:async()=>({videoStart:'default',mediaClickAction:'inline',clickAudio:'muted',videoOpenPost:'position',cardClickAudio:'unmute'}),readPreference:async()=>false,observe:false});await c5.ready;await flush();
 s2.video.currentTime=6;s2.video.muted=true;s2.start();s2.click(s2.title);
 assert.equal(JSON.parse(s2.W.sessionStorage.getItem(continuationKey)).muted,false,'clicking the post card respects cardClickAudio=unmute even when clickAudio=muted');
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
 assert.match(cover.style.backgroundColor,/color-neutral-background-weak/,'missing artwork leaves a themed placeholder');
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
 assert.equal(c.posters.get('t3_near')?.[0],'https://media.example.test/near.jpg','shown before the slow one finishes');
 release();await new Promise(resolve=>setTimeout(resolve,50));
 assert.equal(c.posters.get('t3_far')?.[0],'https://media.example.test/far.jpg');
});

test('a card shows its still while Reddit has not inserted its player, and until that player has drawn',async t=>{
 const p=page(t),image='https://cdn.example.test/still.jpg';
 const node=p.d.createElement('shreddit-embed');node.setAttribute('embedly-iframe','<iframe src="'+embedly+'&image='+encodeURIComponent(image)+'"></iframe>');node.attachShadow({mode:'open'});
 p.player.closest('shreddit-post').append(node);
 const c=await hoverController(p,{embedStart:'autoplay'});c.scan();await flush();
 const pre=()=>node.shadowRoot.querySelector('[data-rt-pre-still]');
 assert.equal(pre()?.getAttribute('src'),image,'the still, not a black box');assert.equal(pre().referrerPolicy,'no-referrer');
 const mark=()=>node.shadowRoot.querySelector('[data-rt-pre-mark]');
 assert.equal(mark()?.hidden,true,'no play mark before the still has drawn');
 pre().dispatchEvent(new p.W.Event('load'));assert.equal(mark().hidden,false,'the play mark appears with the still');
 const frame=p.d.createElement('iframe');frame.setAttribute('src',embedly);node.shadowRoot.append(frame);await flush();
 assert.ok(pre(),'kept while the player loads');
 frame.dispatchEvent(new p.W.Event('load'));await new Promise(resolve=>setTimeout(resolve,450));
 assert.equal(pre(),null,'gone once the player has drawn');assert.equal(mark(),null,'its mark goes with it');
});

test('an in-place muted click unlocks Reddit’s controls and keeps the preview position with opening sound on',async t=>{
 const p=page(t);await hoverController(p,{videoPreviewClick:'muted',videoUnmutePreview:true,videoPreviewFrom:'start'});
 const clicks=surfaceClick(p);pointer(p);await waitForHover();p.video.currentTime=4;
 p.click(p.video);pointer(p,'pointerout');await new Promise(resolve=>setTimeout(resolve,260));
 assert.deepEqual(clicks.count(),{toggled:0,opened:0});
 assert.equal(p.video.muted,true);assert.equal(p.video.paused,false);assert.equal(p.video.currentTime,4);
 p.click(p.video);assert.equal(clicks.count().toggled,1,'the next tap reaches the native player');
});

test('an embed preview can reveal the same controls at the same position while keeping muted',async t=>{
 const p=page(t);const c=await controlled(p,{videoPreviewClick:'muted',videoUnmutePreview:true});
 let opened=0;p.title.addEventListener('click',()=>opened++);
 c.over();await waitForHover();c.layer().click();
 assert.equal(opened,0);assert.equal(c.layer(),null);assert.equal(c.node.dataset.rtEmbedUsed,'1');
 assert.equal(c.frame.src,embedly);assert.deepEqual(c.commands(),['mute','play']);
 assert.ok(p.io.observed.includes(c.node),'a user-owned muted player is observed offscreen like a sound player');
});

test('unified clickAudio controls sound on both inline clicks and post opens',async t=>{
 const p=page(t);const e=embed(p,{muted:true});await hoverController(p,{mediaClickAction:'inline',clickAudio:'unmute'});
 e.over();await waitForHover();p.click(p.title);
 assert.equal(JSON.parse(p.W.sessionStorage.getItem(embedKey)).muted,false);
 const q=page(t);const f=await controlled(q,{mediaClickAction:'inline',clickAudio:'unmute'});
 f.over();await waitForHover();f.layer().click();
 assert.deepEqual(f.commands(),['mute','play','unmute','play']);
 const r=page(t);const g=await controlled(r,{mediaClickAction:'inline',clickAudio:'muted'});
 g.over();await waitForHover();g.layer().click();
 assert.deepEqual(g.commands(),['mute','play']);
});

test('Vimeo can show Reddit’s fallback still until the provider begins playback',async t=>{
 const p=page(t),node=p.d.createElement('shreddit-embed');node.setAttribute('providerName','Vimeo');
 const lite=node.attachShadow({mode:'open'}).appendChild(p.d.createElement('lite-vimeo'));
 lite.setAttribute('videoid','123');lite.attachShadow({mode:'open'});p.player.closest('shreddit-post').append(node);
 lite.addEventListener('click',()=>{if(lite.shadowRoot.querySelector('iframe'))return;const frame=lite.shadowRoot.appendChild(p.d.createElement('iframe'));frame.src='https://player.vimeo.com/video/123';});
 const c=await hoverController(p);c.readPosters=async()=>({t3_test:'https://preview.redd.it/vimeo.jpg'});c.scan();
 await new Promise(resolve=>setTimeout(resolve,100));
 assert.equal(node.shadowRoot.querySelector('[data-rt-parked-still]')?.getAttribute('src'),'https://preview.redd.it/vimeo.jpg');
 const over=new p.W.MouseEvent('pointerover',{bubbles:true,composed:true});Object.defineProperty(over,'pointerType',{value:'mouse'});lite.dispatchEvent(over);await waitForHover();
 assert.equal(node.shadowRoot.querySelector('[data-rt-parked-cover]'),null);
 assert.ok(lite.shadowRoot.querySelector('iframe'));
});

test('a broken native poster tries the post alternatives and keeps the case of the RedGIFs still',async t=>{
 const p=page(t),native='https://preview.redd.it/invalid-native.jpg',reddit='https://preview.redd.it/invalid-post.jpg',poster='https://media.redgifs.com/SampleCamel-poster.jpg';
 p.W.Image=class{constructor(){this.listeners={};}addEventListener(type,fn){this.listeners[type]=fn;}};
 let reads=0;p.W.fetch=async()=>{reads++;return {ok:true,status:200,json:async()=>[{data:{children:[{data:{preview:{images:[{source:{url:reddit}}]},secure_media:{oembed:{thumbnail_url:poster}}}}]}}]};};
 const e=frameEmbed(p,'https://www.redgifs.com/ifr/samplecamel');e.node.setAttribute('poster',native);
 const c=await hoverController(p,{embedStart:'play'});c.scan();
 const fail=url=>{const image=c.warmedPosters.get(url);image.complete=true;image.listeners.error();};
 fail(native);await new Promise(resolve=>setTimeout(resolve,120));fail(reddit);
 const still=e.node.shadowRoot.querySelector('[data-rt-parked-still]');
 assert.equal(reads,1);assert.equal(still?.src,poster);assert.equal(still.referrerPolicy,'no-referrer');
});

test('playing raw provider previews leave the iframe at Reddit’s own size',async t=>{
 const p=page(t),e=frameEmbed(p,'https://www.redgifs.com/ifr/layout');
 e.node.getBoundingClientRect=()=>({width:408,height:312,top:120,bottom:432});
 e.frame.width='600';e.frame.height='338';
 await hoverController(p,{videoPreviewClick:'muted'});
 e.over();await waitForHover();
 assert.equal(e.frame.hasAttribute('data-rt-fit-preview'),false);
 assert.equal(e.node.shadowRoot.querySelector('style[data-rt-preview-sizing]'),null);
 assert.equal(e.frame.width,'600');assert.equal(e.frame.height,'338');
 e.layer().click();
 assert.equal(e.frame.hasAttribute('data-rt-fit-preview'),false,'revealing the same provider controls does not resize it');
});

test('a provider metadata still that fails lets Reddit supply the replacement',async t=>{
 const p=page(t),bad='https://media.redgifs.com/broken.jpg',poster='https://preview.redd.it/replacement.jpg',reads=[];
 p.W.Image=class{constructor(){this.listeners={};}addEventListener(type,fn){this.listeners[type]=fn;}};
 p.W.chrome={runtime:{sendMessage:async message=>{reads.push(message.scope);return {t3_test:bad};}}};
 p.W.fetch=async()=>{reads.push('reddit');return {ok:true,status:200,json:async()=>[{data:{children:[{data:{preview:{images:[{source:{url:poster}}]}}}]}}]};};
 const e=frameEmbed(p,'https://www.redgifs.com/ifr/example');
 const c=await hoverController(p,{embedStart:'play'});c.scan();await new Promise(resolve=>setTimeout(resolve,100));
 const img=c.warmedPosters.get(bad);img.complete=true;img.listeners.error();await new Promise(resolve=>setTimeout(resolve,100));
 assert.deepEqual(reads,['rt-embed-posters','reddit']);
 assert.equal(e.node.shadowRoot.querySelector('[data-rt-parked-still]')?.src,poster);
});

test('muted controls stay muted if the Embedly preview needs startup flags',async t=>{
 const p=page(t),timer=p.W.setTimeout.bind(p.W);
 p.W.setTimeout=(fn,ms,...args)=>timer(fn,ms===2500?350:ms,...args);
 const wrapped='https://cdn.embedly.com/widgets/media.html?src='+encodeURIComponent('https://clips.twitch.tv/embed?clip=x&autoplay=false');
 const c=await controlled(p,{videoPreviewClick:'muted'},wrapped);
 c.over();await waitForHover();c.layer().click();
 await new Promise(resolve=>timer(resolve,380));
 const provider=new URL(new URL(c.frame.src).searchParams.get('src'));
 assert.equal(provider.searchParams.get('autoplay'),'true');assert.equal(provider.searchParams.get('muted'),'true');
 assert.equal(c.layer(),null);
});

test('Vimeo uses an Embedly image baked into Reddit’s html attribute before the player exists',async t=>{
 const p=page(t),image='https://i.vimeocdn.com/video/123_640.jpg',node=p.d.createElement('shreddit-embed');
 node.setAttribute('providername','Vimeo');node.setAttribute('html','<iframe src="'+embedly+'&amp;image='+encodeURIComponent(image)+'"></iframe>');
 node.attachShadow({mode:'open'});p.player.closest('shreddit-post').append(node);
 const c=await hoverController(p,{embedStart:'play'});c.readPosters=async()=>{throw Error('markup already supplies poster');};
 c.scan();await flush();
 assert.equal(node.shadowRoot.querySelector('[data-rt-pre-still]')?.src,image);
});

test('fallback poster lookups wait until a distant card approaches the viewport',async t=>{
 const p=page(t),requests=[];
 const e=frameEmbed(p,'https://www.redgifs.com/ifr/distant');
 let top=12000;e.node.getBoundingClientRect=()=>({width:408,height:300,top,bottom:top+300});
 const c=await hoverController(p,{embedStart:'play'});c.readPosters=async ids=>{requests.push(...ids);return {};};
 c.scan();await new Promise(resolve=>setTimeout(resolve,100));
 assert.deepEqual(requests,[]);
 top=1300;p.io.posters.cb([{target:e.node,isIntersecting:true}]);await new Promise(resolve=>setTimeout(resolve,100));
 assert.deepEqual(requests,['t3_test']);
});

test('feed preview selection preserves detail viewport ownership and teardown restores it',async t=>{
 const p=page(t,{detail:true});
 let managed=0,released=0;
 p.player.addEventListener('rt-manage-media-viewport',event=>{managed++;event.preventDefault();});
 p.player.addEventListener('rt-restore-media-viewport',()=>released++);
 const c=await hoverController(p);
 assert.equal(managed,1);
 c.pickInView();c.pickInView();
 assert.equal(released,0);
 c.destroy();
 assert.equal(released,1);
});

test('a direct embed that was already playing when it announced can pause and resume on its detail page',async t=>{
 const p=page(t,{detail:true});
 const e=frameEmbed(p,'https://www.redgifs.com/ifr/detail'),c=await hoverController(p),sent=[];
 e.frame.contentWindow.postMessage=message=>sent.push(message.rtMedia);
 c.onFrameMessage({source:e.frame.contentWindow,origin:'https://www.redgifs.com',data:{rtMedia:'hello',playing:true,rendered:true}});
 sent.length=0;
 p.io.cb([{target:e.node,intersectionRatio:0}]);
 p.io.cb([{target:e.node,intersectionRatio:0.65}]);
 assert.deepEqual(sent,['pause','play']);
 c.onFrameMessage({source:e.frame.contentWindow,origin:'https://www.redgifs.com',data:{rtMedia:'pause'}});
 sent.length=0;
 p.io.cb([{target:e.node,intersectionRatio:0}]);p.io.cb([{target:e.node,intersectionRatio:1}]);
 assert.deepEqual(sent,[],'manual pause remains paused');
});

test('an offscreen feed iframe stays parked before a poster arrives and its first picture replaces the still',async t=>{
 const p=page(t);
 const e=frameEmbed(p,'https://player.vimeo.com/video/9'),still='https://preview.redd.it/embed.jpg';
 let top=950;
 e.node.getBoundingClientRect=()=>({top,bottom:top+280,height:280,width:390});
 e.node.setAttribute('poster',still);
 const c=await hoverController(p);
 c.scan();
 assert.equal(e.frame.getAttribute('src'),'about:blank');
 top=150;
 e.over();await waitForHover();
 assert.equal(e.frame.hasAttribute('data-rt-fit-preview'),false,'no sizing style is applied');
 const image=()=>e.node.shadowRoot.querySelector('[data-rt-pre-still]');
 assert.equal(image()?.src,still);
 assert.equal(image().style.objectFit,'cover','the still fills the reserved container while the frame connects');
 c.onFrameMessage({source:e.frame.contentWindow,origin:'https://player.vimeo.com',data:{rtMedia:'hello',playing:false,rendered:false}});
 assert.ok(image(),'a handshake alone is too early');
 c.onFrameMessage({source:e.frame.contentWindow,origin:'https://player.vimeo.com',data:{rtMedia:'rendered'}});
 assert.equal(image(),null,'the first frame replaces the still');
});

test('the sound tap does not reload a playing flag-only frame',async t=>{
 const p=page(t),c=await controlled(p,{videoPreviewClick:'sound'},'https://www.redgifs.com/ifr/example');
 c.over();await waitForHover();const original=c.frame.getAttribute('src');
 c.layer().click();
 assert.equal(c.frame.getAttribute('src'),original);
 assert.equal(c.layer(),null);
});

test('another player cannot pause an iframe held on its way into a detail post',async t=>{
 const p=page(t),c=await controlled(p);
 c.node.addEventListener('rt-hold-feed-embed',event=>event.preventDefault(),{once:true});
 c.over();await waitForHover();p.click(p.title);c.sent.length=0;
 const other=p.d.createElement('video');p.d.body.append(other);
 c.controller.exclusive(other);
 assert.deepEqual(c.commands(),[]);
});

test('autoplay does not replace a promoted visible embed while its controls are in use',async t=>{
 const p=page(t);phone(p,true);
 const first=frameEmbed(p,'https://player.vimeo.com/video/1');
 first.node.getBoundingClientRect=()=>({top:150,bottom:360,height:210,width:390});
 const c=await hoverController(p,{embedStartTouch:'autoplay',videoPreviewClick:'sound',videoStartTouch:'play'});
 c.pickInView();
 first.layer().click();
 const card=p.d.createElement('shreddit-post');card.id='t3_second';
 const second=frameEmbed(p,'https://player.vimeo.com/video/2');
 card.append(second.node);p.d.body.append(card);
 second.node.getBoundingClientRect=()=>({top:370,bottom:710,height:340,width:390});
 c.scan();c.pickInView();
 assert.equal(second.layer(),null);
});

test('a direct embed remembers its time across a full navigation when the iframe cannot move',async t=>{
 const p=page(t),c=await controlled(p,{},'https://www.redgifs.com/ifr/example'),origin='https://www.redgifs.com';
 const tell=(controller,frame,data)=>controller.onFrameMessage({source:frame.contentWindow,origin,data});
 c.over();await waitForHover();
 tell(c.controller,c.frame,{rtMedia:'hello',playing:true,rendered:true});
 tell(c.controller,c.frame,{rtMedia:'progress',time:7.25,muted:true});
 p.click(p.title);
 const saved=p.W.sessionStorage.getItem(embedKey);assert.ok(saved);
 const detail=page(t,{detail:true}),e=frameEmbed(detail,'https://www.redgifs.com/ifr/example'),sent=[];
 detail.W.sessionStorage.setItem(embedKey,saved);
 const d=await hoverController(detail);
 e.frame.contentWindow.postMessage=data=>sent.push(data);
 tell(d,e.frame,{rtMedia:'hello',playing:false,rendered:true});
 assert.deepEqual(JSON.parse(JSON.stringify(sent.find(data=>data.rtMedia==='resume'))),{rtMedia:'resume',time:7.25,muted:false});
 assert.equal(detail.W.sessionStorage.getItem(embedKey),null);
});

// Phase 2 new media architecture tests: Passive Default, Click Interaction Matrix, and all 7 Enhancements.
test('passive default attaches zero observers/wrappers and live-toggling on and back off cleanly tears down',async t=>{
 const p=page(t);const e=frameEmbed(p,'https://www.redgifs.com/ifr/passive');
 let managed=0;p.player.addEventListener('rt-manage-media-viewport',ev=>{managed++;ev.preventDefault();});
 const c=new p.W.RTVideoControlRaw.Videos({readSettings:async()=>({}),observe:false});await c.ready;await flush();
 assert.equal(c.active,false);assert.equal(p.io.observed.length,0);assert.equal(managed,0);
 assert.equal(e.frame.getAttribute('src'),'https://www.redgifs.com/ifr/passive','raw embed is untouched');
 assert.equal(e.node.shadowRoot.querySelector('[data-rt-parked-cover]'),null);
 assert.equal(p.d.documentElement.hasAttribute('data-rt-embed-override'),false);
 assert.equal(p.d.documentElement.hasAttribute('data-rt-stream-quality'),false);
 // Live activate
 c.configure({embedStart:'play',streamQuality:'saver'});
 assert.equal(c.active,true);assert.equal(e.frame.getAttribute('src'),'about:blank');
 assert.equal(p.d.documentElement.hasAttribute('data-rt-embed-override'),true);
 assert.equal(p.d.documentElement.getAttribute('data-rt-stream-quality'),'saver');
 // Live return to passive default
 c.configure({});
 assert.equal(c.active,false);
 assert.equal(e.frame.getAttribute('src'),'https://www.redgifs.com/ifr/passive','parked embed restored');
 assert.equal(e.node.shadowRoot.querySelector('[data-rt-parked-cover]'),null);
 assert.equal(p.d.documentElement.hasAttribute('data-rt-embed-override'),false);
 assert.equal(p.d.documentElement.hasAttribute('data-rt-stream-quality'),false);
});

test('click matrix: inline + unmute unmutes first without pausing and lets the second click pause; silent videos pass through',async t=>{
 const p=page(t);
 await hoverController(p,{videoStart:'default',mediaClickAction:'inline',clickAudio:'unmute'});
 const c=surfaceClick(p);
 p.video.muted=true;p.video.volume=0.6;p.start();
 // 1st click on playing muted video: unmutes in place, does NOT reach native pause toggle
 p.click(p.video);
 assert.deepEqual(c.count(),{toggled:0,opened:0});
 assert.equal(p.video.muted,false);assert.equal(p.video.paused,false);
 // 2nd click while playing & unmuted: passes through to native pause toggle
 p.click(p.video);
 assert.deepEqual(c.count(),{toggled:1,opened:0});
 // Silent video (has-audio="false"): 1st click passes through without trapping
 const q=page(t);q.player.setAttribute('has-audio','false');
 await hoverController(q,{videoStart:'default',mediaClickAction:'inline',clickAudio:'unmute'});
 const qc=surfaceClick(q);q.video.muted=true;q.start();
 q.click(q.video);
 assert.deepEqual(qc.count(),{toggled:1,opened:0});
});

test('click matrix: strict click-target isolation preserves title, controls, and GIF independence',async t=>{
 const p=page(t);
 const slider=p.d.createElement('input');slider.type='range';slider.setAttribute('role','slider');
 p.root.append(slider);
 await hoverController(p,{videoStart:'preview',mediaClickAction:'open',clickAudio:'unmute'});
 let titleClicks=0,sliderClicks=0,ccClicks=0;
 p.title.addEventListener('click',()=>titleClicks++);
 slider.addEventListener('click',()=>sliderClicks++);
 p.root.getElementById('cc').addEventListener('click',()=>ccClicks++);
 pointer(p);await waitForHover();
 p.click(slider);p.click(p.root.getElementById('cc'));
 assert.equal(sliderClicks,1,'scrubber slider is never hijacked');
 assert.equal(ccClicks,1,'captions button is never hijacked');
 assert.equal(titleClicks,0);
 // GIF ignores video click/audio/open rules
 const g=page(t);g.player.setAttribute('post-type','gif');
 await hoverController(g,{gifStart:'autoplay',mediaClickAction:'open',clickAudio:'unmute'});
 let gifOpened=0;g.title.addEventListener('click',()=>gifOpened++);
 g.video.muted=true;g.start();g.click(g.video);
 assert.equal(gifOpened,0,'GIF never inherits video mediaClickAction');
 assert.equal(g.video.muted,true,'GIF never inherits clickAudio');
});

test('click matrix: fullscreen action invokes native fullscreen button and applies clickAudio',async t=>{
 const p=page(t);
 const fsBtn=p.d.createElement('button');fsBtn.className='fullscreen-button';
 let fsClicks=0;fsBtn.addEventListener('click',()=>fsClicks++);
 p.root.append(fsBtn);
 await hoverController(p,{videoStart:'play',mediaClickAction:'fullscreen',clickAudio:'unmute'});
 p.video.muted=true;p.video.volume=0.7;
 p.click(p.video);
 assert.equal(fsClicks,1,'uses native fullscreen button');
 assert.equal(p.video.paused,false);assert.equal(p.video.muted,false);
});

test('click matrix: open action with videoOpenPost=default opens permalink without DOM reparenting',async t=>{
 const p=page(t);
 await hoverController(p,{videoStart:'preview',mediaClickAction:'open',clickAudio:'unmute',videoOpenPost:'default'});
 let opened=0,held=0;
 p.title.addEventListener('click',()=>opened++);
 p.player.addEventListener('rt-hold-feed-video',ev=>{held++;ev.preventDefault();});
 pointer(p);await waitForHover();
 p.click(p.video);
 assert.equal(opened,1,'opens post permalink');
 assert.equal(held,0,'no DOM reparenting when videoOpenPost is default');
 assert.equal(p.W.sessionStorage.getItem(continuationKey),null);
});

test('enhancement: singleVideo defaults to off (allows concurrent play) and pauses competitors when enabled',async t=>{
 const setupTwo=async singleVideo=>{
  const p=page(t);
  const second=p.player.cloneNode();second.id='p2';const root2=second.attachShadow({mode:'open'});
  root2.innerHTML='<button class="play-pause-button">Play</button><video></video>';
  const post2=Object.assign(p.d.createElement('shreddit-post'),{id:'t3_two'});post2.append(second);
  p.player.closest('shreddit-post').after(post2);
  const c=new p.W.RTVideoControlRaw.Videos({readSettings:async()=>({singleVideo,mediaClickAction:'inline'}),observe:false});
  await c.ready;await flush();c.scan();
  const other=root2.querySelector('video');
  p.startFromControl();
  root2.querySelector('button').dispatchEvent(new p.W.Event('pointerdown',{bubbles:true,composed:true}));
  other._playing=true;other.dispatchEvent(new p.W.Event('play'));
  return {v1:p.video,v2:other};
 };
 const off=await setupTwo(false);
 assert.equal(off.v1.paused,false,'singleVideo=false allows concurrent playback');assert.equal(off.v2.paused,false);
 const on=await setupTwo(true);
 assert.equal(on.v1.paused,true,'singleVideo=true pauses earlier video');assert.equal(on.v2.paused,false);
});

test('enhancement: volumeMemory persists user volume changes and restores via rt-video-volume',async t=>{
 const p=page(t);
 const saved=[],synced=[];
 p.player.addEventListener('rt-video-volume',()=>synced.push(p.player.dataset.rtTargetVolume));
 const c=new p.W.RTVideoControlRaw.Videos({
  readSettings:async()=>({volumeMemory:true}),
  readVolume:async()=>({volume:0.42,muted:false}),
  saveVolume:val=>saved.push(val),
  observe:false
 });
 await c.ready;await flush();
 assert.equal(p.video.volume,0.42,'restored saved volume on attach');
 assert.deepEqual(synced,['0.42'],'synced to Reddit volumeController');
 p.startFromControl();
 p.video.volume=0.75;p.video.muted=false;
 p.video.dispatchEvent(new p.W.Event('volumechange'));
 await new Promise(r=>setTimeout(r,200));
 assert.deepEqual(JSON.parse(JSON.stringify(saved)),[{volume:0.75,muted:false}]);
});

test('enhancement: volumeMemory falls back to localStorage when chrome.storage.local rejects (TRUSTED_CONTEXTS)',async t=>{
 const p=page(t);
 p.W.chrome={storage:{local:{
  get:()=>Promise.reject(new Error('Access to storage is not allowed from this context')),
  set:()=>Promise.reject(new Error('Access to storage is not allowed from this context'))
 }}};
 const c=new p.W.RTVideoControlRaw.Videos({readSettings:async()=>({volumeMemory:true}),observe:false});
 await c.ready;await flush();
 p.startFromControl();
 p.video.volume=0.64;p.video.muted=false;
 p.video.dispatchEvent(new p.W.Event('volumechange'));
 await new Promise(r=>setTimeout(r,220));
 assert.deepEqual(JSON.parse(p.W.localStorage.getItem('rt-video-volume-v1')),{volume:0.64,muted:false},'persists to localStorage on storage.local rejection');
 // Fresh controller on same origin reads back from localStorage despite rejecting storage.local
 const p2=page(t);
 p2.W.localStorage.setItem('rt-video-volume-v1',JSON.stringify({volume:0.64,muted:false}));
 p2.W.chrome=p.W.chrome;
 const c2=new p2.W.RTVideoControlRaw.Videos({readSettings:async()=>({volumeMemory:true}),observe:false});
 await c2.ready;await flush();
 assert.equal(p2.video.volume,0.64,'restores from localStorage fallback on storage.local rejection');
});

test('enhancement: videoScrollAway=mini floats detail video offscreen, docks back on scroll return, and falls back to pause if unsupported',async t=>{
 const p=page(t,{detail:true});
 const events=[];
 let slot=null;
 p.player.addEventListener('rt-mini-enter',ev=>{
  events.push('enter');
  slot=p.d.createElement('div');slot.dataset.rtMiniSlot='';p.player.before(slot);
  ev.preventDefault();
 });
 p.d.addEventListener('rt-mini-exit',()=>events.push('exit'));
 const c=new p.W.RTVideoControlRaw.Videos({readSettings:async()=>({videoScrollAway:'mini'}),observe:false});
 await c.ready;await flush();
 p.startFromControl();
 p.io.cb([{target:p.player,intersectionRatio:0}]);
 assert.deepEqual(events,['enter']);assert.equal(p.video.paused,false,'keeps playing in mini-player');
 assert.ok(p.io.observed.includes(slot));
 p.io.cb([{target:slot,intersectionRatio:0.6}]);
 assert.deepEqual(events,['enter','exit'],'docks back when slot returns');
 // Dismissed mini-player does not re-open on same post until manually replayed
 p.io.cb([{target:p.player,intersectionRatio:0}]);
 p.player.dispatchEvent(new p.W.Event('rt-mini-dismissed',{bubbles:true}));
 p.io.cb([{target:p.player,intersectionRatio:0}]);
 assert.equal(events.filter(e=>e==='enter').length,2,'does not re-open after user dismissed');
 // Fallback to pause when rt-mini-enter is not handled (e.g. Firefox embed without moveBefore)
 const q=page(t,{detail:true});const e=embed(q,{state:'playing'});
 let paused=0;e.node.addEventListener('rt-embed-offscreen',()=>paused++);
 const c2=new q.W.RTVideoControlRaw.Videos({readSettings:async()=>({videoScrollAway:'mini'}),observe:false});
 await c2.ready;await flush();
 q.io.cb([{target:e.node,intersectionRatio:0}]);
 assert.equal(paused,1,'falls back to pause when rt-mini-enter is unhandled');
});

test('enhancement: holdFor2x speeds up playing native video on desktop hold and touch right-40% long-press, swallowing trailing click',async t=>{
 const p=page(t);
 p.video.getBoundingClientRect=()=>({left:0,top:0,width:400,height:300});
 const c=new p.W.RTVideoControlRaw.Videos({readSettings:async()=>({holdFor2x:true}),observe:false});
 await c.ready;await flush();
 p.startFromControl();
 const clicks=surfaceClick(p);
 const down=(pointerType,clientX)=>{
  const ev=new p.W.MouseEvent('pointerdown',{bubbles:true,composed:true,button:0,clientX,clientY:150});
  Object.defineProperty(ev,'pointerType',{value:pointerType});
  p.video.dispatchEvent(ev);
 };
 // Touch left side (25% < 60%): ignored
 down('touch',100);await new Promise(r=>setTimeout(r,380));
 assert.equal(p.video.playbackRate,1,'left zone on touch does not trigger 2x');
 // Touch right side (80% >= 60%): triggers 2x
 down('touch',320);await new Promise(r=>setTimeout(r,380));
 assert.equal(p.video.playbackRate,2);
 assert.ok(p.root.querySelector('[data-rt-speed-pill]'));
 const ctx=new p.W.Event('contextmenu',{bubbles:true,cancelable:true,composed:true});
 p.video.dispatchEvent(ctx);assert.equal(ctx.defaultPrevented,true,'suppresses mobile contextmenu while holding');
 p.W.dispatchEvent(new p.W.MouseEvent('pointerup',{bubbles:true}));
 assert.equal(p.video.playbackRate,1,'restores original speed');
 assert.equal(p.root.querySelector('[data-rt-speed-pill]'),null);
 p.click(p.video);
 assert.equal(clicks.count().toggled,0,'trailing click after release is swallowed');
 // Desktop mouse hold (300ms)
 down('mouse',100);await new Promise(r=>setTimeout(r,330));
 assert.equal(p.video.playbackRate,2);
 p.W.dispatchEvent(new p.W.MouseEvent('pointerup',{bubbles:true}));
 assert.equal(p.video.playbackRate,1);
});

test('enhancement: loopPolicy supports always, never, and short (<30s) while excluding GIFs',async t=>{
 const p=page(t);
 p.W.HTMLMediaElement.prototype.play=function(){this._playing=true;this.dispatchEvent(new p.W.Event('play'));return Promise.resolve();};
 Object.defineProperty(p.video,'duration',{value:15,configurable:true});
 const c=new p.W.RTVideoControlRaw.Videos({readSettings:async()=>({loopPolicy:'short'}),observe:false});
 await c.ready;await flush();
 assert.equal(p.video.loop,true,'15s video loops under short policy');
 Object.defineProperty(p.video,'duration',{value:45,configurable:true});
 p.video.dispatchEvent(new p.W.Event('durationchange'));
 assert.equal(p.video.loop,false,'45s video does not loop under short policy');
 // Under never, immediate unsolicited restart right after ended is paused
 c.configure({loopPolicy:'never'});
 assert.equal(p.video.loop,false);
 p.video.dispatchEvent(new p.W.Event('ended'));
 p.video._playing=true;p.video.dispatchEvent(new p.W.Event('play'));
 assert.equal(p.video.paused,true,'unsolicited loop restart blocked under never');
 // Under always, ended replays from 0
 c.configure({loopPolicy:'always'});
 assert.equal(p.video.loop,true);
 p.video.currentTime=45;p.video._playing=false;
 p.video.dispatchEvent(new p.W.Event('ended'));
 assert.equal(p.video.currentTime,0);assert.equal(p.video.paused,false);
 // GIF is never forced to never-loop
 const g=page(t);g.player.setAttribute('post-type','gif');g.video.loop=true;
 const cg=new g.W.RTVideoControlRaw.Videos({readSettings:async()=>({loopPolicy:'never'}),observe:false});
 await cg.ready;await flush();
 assert.equal(g.video.loop,true,'GIF ignores video loopPolicy');
});

// Post opened directly (docs/video-control-spec.md): the post the tab first loaded follows videoDirectOpen.
function directPage(t,options){
 const p=page(t,{detail:true,...options});
 const calls={plays:0,sound:0,prepare:0};
 p.W.HTMLMediaElement.prototype.play=function(){calls.plays++;this._playing=true;this.dispatchEvent(new p.W.Event('play'));return Promise.resolve();};
 p.player.addEventListener('rt-video-sound',()=>calls.sound++);
 p.player.addEventListener('rt-prepare-detail-video',()=>calls.prepare++);
 // Reddit's own autoplay: it starts the player by script, muted unless sound was chosen this session.
 p.redditAutoplay=(muted=true)=>{p.video.muted=muted;p.video._playing=true;p.video.dispatchEvent(new p.W.Event('play'));};
 p.calls=calls;
 return p;
}
async function directController(p,settings,{wrapped=false,landing}={}){
 const Videos=(wrapped?p.W.RTVideoControl:p.W.RTVideoControlRaw).Videos;
 const control=new Videos({readSettings:async()=>settings,readPreference:async()=>false,observe:false,...(landing===undefined?{}:{landing})});
 await control.ready;await flush();
 return control;
}
test('Post opened directly: Reddit Default leaves the landing post untouched and attaches nothing',async t=>{
 const p=directPage(t);
 const control=await directController(p,{videoDirectOpen:'default'});
 assert.equal(control.active,false,'passive with every option at its default');
 p.redditAutoplay(false);assert.equal(p.video.paused,false);assert.equal(p.video.muted,false,'Reddit decides the sound');
 assert.equal(control.isPassive({...control.choice,videoDirectOpen:'muted'}),false,'any other choice activates the control');
});
test('Post opened directly: Play muted keeps Reddit’s autoplay muted and starts it when Reddit would not',async t=>{
 const p=directPage(t);
 const control=await directController(p,{videoDirectOpen:'muted',videoStart:'play'});
 assert.equal(control.landing,'test');
 p.redditAutoplay(false);
 assert.equal(p.video.paused,false,'the feed start option does not block the landing post');
 assert.equal(p.video.muted,true,'sound Reddit brought back is turned off');
 p.video.muted=false;p.video.dispatchEvent(new p.W.Event('volumechange'));
 assert.equal(p.video.muted,true,'Reddit re-applying its volume stays muted');
 p.root.getElementById('mute').addEventListener('click',()=>{p.video.muted=false;p.video.dispatchEvent(new p.W.Event('volumechange'));});
 p.root.getElementById('mute').dispatchEvent(new p.W.Event('pointerdown',{bubbles:true,composed:true}));
 p.click(p.root.getElementById('mute'));
 assert.equal(p.video.muted,false,'the reader’s own sound button works');
 // Reddit's autoplay is off: nothing starts it, so the extension does, through Reddit's player, once it has metadata.
 const q=directPage(t);
 let viaReddit=0;q.player.addEventListener('rt-play-video',()=>viaReddit++);
 Object.defineProperty(q.video,'readyState',{value:0,configurable:true});
 await directController(q,{videoDirectOpen:'muted'});
 assert.equal(q.video.paused,true,'waits for metadata');
 Object.defineProperty(q.video,'readyState',{value:1,configurable:true});q.video.dispatchEvent(new q.W.Event('loadedmetadata'));
 assert.equal(q.video.paused,false);assert.equal(q.video.muted,true);assert.equal(viaReddit,1,'started through Reddit’s own play');
 q.video.pause();q.video.dispatchEvent(new q.W.Event('pause'));q.video.dispatchEvent(new q.W.Event('loadedmetadata'));
 assert.equal(q.calls.plays,1,'started once; a later pause is not undone');
});
test('Post opened directly: a lazy player is asked to load only when nothing arrives',async t=>{
 const p=directPage(t);
 Object.defineProperty(p.video,'readyState',{value:0,configurable:true});
 const control=await directController(p,{videoDirectOpen:'muted'});control.scan();
 assert.equal(p.calls.prepare,0,'Reddit loads its own source first');
 await new Promise(r=>setTimeout(r,1600));
 assert.equal(p.calls.prepare,1,'Reddit’s own loader is asked once after the wait');
});
test('Post opened directly: Stay paused stops every start the reader did not make, until Play',async t=>{
 const p=directPage(t);
 const control=await directController(p,{videoDirectOpen:'paused'});
 p.redditAutoplay();assert.equal(p.video.paused,true,'Reddit’s autoplay is stopped');
 p.redditAutoplay();assert.equal(p.video.paused,true,'and again when it retries');
 assert.equal(p.player.dataset.rtAutoplayBlocked,'true');
 assert.equal(p.calls.plays,0,'nothing starts it');
 p.startFromControl();assert.equal(p.video.paused,false,'the reader’s Play plays');
 p.video.pause();p.redditAutoplay();assert.equal(p.video.paused,false,'after that, Reddit’s own behaviour returns');
 assert.equal(control.direct.ended,true);
 // A video Reddit already started before the settings arrived is paused at once.
 const q=directPage(t);q.redditAutoplay();
 await directController(q,{videoDirectOpen:'paused'});
 assert.equal(q.video.paused,true);
});
test('Post opened directly: Play with sound unmutes when the browser allows it, through Reddit’s volume state',async t=>{
 const p=directPage(t);
 await directController(p,{videoDirectOpen:'sound'});
 p.video.volume=0.4;p.redditAutoplay();
 assert.equal(p.video.muted,false);assert.equal(p.video.paused,false);
 await new Promise(r=>setTimeout(r,300));
 assert.equal(p.video.muted,false);assert.equal(p.calls.sound,1,'Reddit’s controls are told the sound is on');
 // A video without audio just plays.
 const q=directPage(t);q.player.setAttribute('has-audio','false');
 const control=await directController(q,{videoDirectOpen:'sound'});q.redditAutoplay();
 assert.equal(q.video.muted,true);assert.equal(q.video.paused,false);assert.equal(control.direct.phase,'playing');
});
test('Post opened directly: refused sound falls back to muted playback, and sound comes at the first click',async t=>{
 const refuse=p=>{
  // Chrome without user activation: unmuting a playing video pauses it.
  let muted=true;Object.defineProperty(p.video,'muted',{configurable:true,get:()=>muted,set(value){
   muted=value;p.video.dispatchEvent(new p.W.Event('volumechange'));
   if(!value && !p.allowed && p.video._playing){p.video._playing=false;p.video.dispatchEvent(new p.W.Event('pause'));}
  }});
 };
 const p=directPage(t);refuse(p);
 const control=await directController(p,{videoDirectOpen:'sound'});
 p.redditAutoplay();
 assert.equal(p.video.paused,false,'playing again at once');assert.equal(p.video.muted,true,'muted');
 assert.equal(control.direct.phase,'fallback');assert.equal(p.calls.sound,0);
 p.allowed=true;
 p.d.body.dispatchEvent(new p.W.Event('pointerdown',{bubbles:true}));
 assert.equal(p.video.muted,true,'a pointerdown alone is not an activation');
 p.click(p.d.body);
 assert.equal(p.video.muted,false,'the first click on the page turns the sound on');assert.equal(p.calls.sound,1);
 await new Promise(r=>setTimeout(r,250));
 assert.ok(p.video.volume>0,'faded in');
 // Using the player's own controls first leaves the sound to them.
 const q=directPage(t);refuse(q);
 await directController(q,{videoDirectOpen:'sound'});q.redditAutoplay();
 q.allowed=true;q.click(q.root.getElementById('cc'));q.click(q.d.body);
 assert.equal(q.video.muted,true,'no sound after the reader used the player');
 // Firefox answers before trying.
 const f=directPage(t);let unmutes=0;f.video.addEventListener('volumechange',()=>{if(!f.video.muted)unmutes++;});
 f.W.navigator.getAutoplayPolicy=()=>'allowed-muted';
 const ff=await directController(f,{videoDirectOpen:'sound'});f.redditAutoplay();
 assert.equal(unmutes,0);assert.equal(ff.direct.phase,'fallback');assert.equal(f.video.paused,false);
});
test('Post opened directly: posts reached in-app or by a feed continuation are never managed',async t=>{
 // Feed → post in the same tab: the continuation keeps its moment and sound, whatever the direct-open choice.
 const p=page(t);
 const controller=await directController(p,{videoDirectOpen:'paused'},{wrapped:true});
 assert.equal(controller.landing,'','the tab first loaded a feed');
 p.W.HTMLMediaElement.prototype.play=function(){this._playing=true;this.dispatchEvent(new p.W.Event('play'));return Promise.resolve();};
 p.video.currentTime=8;p.startFromControl();p.video.muted=false;p.click(p.title);
 p.W.history.pushState({},'',postPath);
 const detail=p.player.cloneNode();detail.setAttribute('player-type','post_detail_screen');p.player.after(detail);
 const video=p.d.createElement('video');detail.attachShadow({mode:'open'}).append(video);
 Object.defineProperty(video,'readyState',{value:1});controller.scan();
 assert.equal(video.paused,false,'the continuation plays');assert.equal(video.currentTime,8);assert.equal(video.muted,false);
 // A full page load that continues a feed video is not a direct open either.
 const q=page(t,{detail:true});
 q.W.sessionStorage.setItem(continuationKey,JSON.stringify({id:'test',owner:'t2_alice',at:Date.now(),time:3,muted:false,volume:0.5,rate:1}));
 const restored=new q.W.RTVideoControlRaw.Videos({readSettings:async()=>({videoDirectOpen:'paused'}),readPreference:async()=>false,observe:false});
 await restored.ready;assert.equal(restored.landing,'');
 // Leaving the landing post in-app ends it: coming back is not a direct open.
 const r=directPage(t);const back=await directController(r,{videoDirectOpen:'paused'});
 r.W.history.pushState({},'','/r/videos/');r.W.dispatchEvent(new r.W.PopStateEvent('popstate'));
 assert.equal(back.landing,'');
 r.W.history.pushState({},'',postPath);back.scan();r.redditAutoplay();
 assert.equal(r.video.paused,false,'Reddit decides on the in-app visit');
});
test('Post opened directly: changing the choice with the post open applies to the next direct open only',async t=>{
 const p=directPage(t);
 const control=await directController(p,{videoDirectOpen:'muted'});
 p.redditAutoplay();assert.equal(p.video.muted,true);
 control.configure({videoDirectOpen:'paused'});
 assert.equal(p.video.paused,false,'not paused on the open tab');
 p.redditAutoplay();assert.equal(p.video.paused,false);
 control.configure({videoDirectOpen:'default'});assert.equal(control.active,false,'back to passive');
});
test('Post opened directly: a video scrolled out of view waits until it is seen',async t=>{
 const p=directPage(t);
 Object.defineProperty(p.video,'readyState',{value:1,configurable:true});
 let top=1200;p.player.getBoundingClientRect=()=>({top,bottom:top+300,height:300,left:0,width:400});
 const control=await directController(p,{videoDirectOpen:'muted'});control.scan();
 assert.equal(p.video.paused,true,'not started off screen');
 top=200;p.io.cb([{target:p.player,intersectionRatio:0.6}]);
 assert.equal(p.video.paused,false);assert.equal(p.video.muted,true);
});

// Media playback fixes (docs/video-control-spec.md): frames driven from inside keep their own picture, the post's own
// embed follows Post opened directly, and Autoplay/Preview leave a post's own video to Reddit.
const frameSays=(p,e,rtMedia,data={})=>p.W.dispatchEvent(new p.W.MessageEvent('message',{source:e.frame.contentWindow,origin:new URL(e.frame.getAttribute('src')).origin,data:{rtMedia,...data}}));
const frameHello=(p,e,data={})=>frameSays(p,e,'hello',data);
async function directControls(p,settings){
 p.W.HTMLMediaElement.prototype.play=function(){this._playing=true;this.dispatchEvent(new p.W.Event('play'));return Promise.resolve();};
 const c=new p.W.RTVideoControlRaw.Videos({readSettings:async()=>settings,readPreference:async()=>true,readDirect:async()=>true,observe:false});
 await c.ready;await flush();return c;
}
test('Direct controls: an idle On Play card keeps its own first frame and controls, with no still or cover over it',async t=>{
 const p=page(t),e=frameEmbed(p,'https://streamable.com/e/abc');
 e.node.setAttribute('thumbnail-url','https://cdn.example.test/still.jpg');
 e.node.getBoundingClientRect=()=>({top:120,bottom:420,height:300});
 const c=await directControls(p,{embedStart:'play',singleVideo:true});c.scan();
 assert.equal(e.frame.getAttribute('src'),'https://streamable.com/e/abc','not unloaded behind Reddit’s still');
 assert.equal(e.node.shadowRoot.querySelector('[data-rt-parked-cover]'),null);
 const told=[];e.frame.contentWindow.postMessage=data=>told.push(data.rtMedia);
 frameHello(p,e);
 assert.ok(told.includes('pause'),'held on its first frame');
 told.length=0;
 frameSays(p,e,'play');
 assert.deepEqual(told,['pause'],'a start nobody chose is paused');
 assert.equal(e.node.shadowRoot.querySelector('[data-rt-parked-cover]'),null,'and nothing is put over it');
 told.length=0;
 frameSays(p,e,'play',{user:true});
 assert.deepEqual(told,[],'its own Play button is the reader’s');
 assert.equal(e.node.dataset.rtEmbedUsed,'1');
 // Something else starting rests it: paused through the frame, its own paused picture stays.
 c.exclusive(p.video);
 assert.ok(told.includes('pause'));
 assert.equal(e.node.shadowRoot.querySelector('[data-rt-parked-cover]'),null);
});
test('Direct controls: a frame that never announces itself falls back to the still after the wait',async t=>{
 const p=page(t),e=frameEmbed(p,'https://streamable.com/e/abc');
 e.node.setAttribute('thumbnail-url','https://cdn.example.test/still.jpg');
 e.node.getBoundingClientRect=()=>({top:120,bottom:420,height:300});
 const c=await directControls(p,{embedStart:'play'});c.scan();
 assert.equal(e.frame.getAttribute('src'),'https://streamable.com/e/abc');
 c.frameState(e.frame).noHello=true;c.syncIdleEmbed(e.node);
 assert.equal(e.frame.getAttribute('src'),'about:blank','parked behind the still like any player');
 assert.ok(e.node.shadowRoot.querySelector('[data-rt-parked-cover]'));
 // Without the permission nothing is expected from inside: today’s still.
 const q=page(t),f=frameEmbed(q,'https://streamable.com/e/abc');
 f.node.setAttribute('thumbnail-url','https://cdn.example.test/still.jpg');
 f.node.getBoundingClientRect=()=>({top:120,bottom:420,height:300});
 const d=await hoverController(q,{embedStart:'play'});d.scan();
 assert.equal(f.frame.getAttribute('src'),'about:blank');
});
test('Direct controls: a frame unloaded off screen loads idle once in view instead of staying behind a still',async t=>{
 const p=page(t),e=frameEmbed(p,'https://www.redgifs.com/ifr/demo');
 e.node.setAttribute('thumbnail-url','https://cdn.example.test/still.jpg');
 let top=2400;e.node.getBoundingClientRect=()=>({top,bottom:top+300,height:300});
 const c=await directControls(p,{embedStart:'autoplay'});c.scan();
 assert.equal(e.frame.getAttribute('src'),'about:blank','unloaded while far away');
 top=100;c.paintPoster(e.node);
 assert.equal(e.frame.getAttribute('src'),'https://www.redgifs.com/ifr/demo');
 assert.equal(e.node.shadowRoot.querySelector('[data-rt-parked-cover]'),null);
});
test('Direct controls: a preview has no click layer; the frame reports taps on its picture and takes on its controls',async t=>{
 for(const [action,expectUnmute] of [['tap',true],['take',false]]){
  const p=page(t),e=frameEmbed(p,'https://streamable.com/e/abc');
  e.node.getBoundingClientRect=()=>({top:120,bottom:420,height:300});
  const c=await directControls(p,{embedStart:'preview',mediaClickAction:'inline',clickAudio:'unmute'});
  const told=[];e.frame.contentWindow.postMessage=data=>told.push(data);
  frameHello(p,e);
  e.over();await waitForHover();
  assert.equal(e.layer(),null,'no layer over a frame driven from inside');
  assert.ok(told.some(data=>data.rtMedia==='preview' && data.on===true));
  assert.ok(told.some(data=>data.rtMedia==='mute') && told.some(data=>data.rtMedia==='play'),'previews muted in place');
  told.length=0;
  frameSays(p,e,action);
  assert.equal(c.ePreview,null,'the preview became the reader’s');
  assert.ok(told.some(data=>data.rtMedia==='preview' && data.on===false));
  assert.equal(told.some(data=>data.rtMedia==='unmute'),expectUnmute,action==='take'?'its own sound control decides':'Video click audio unmutes');
  assert.equal(e.node.dataset.rtEmbedUsed,'1');
 }
});
function detailEmbedPage(t,src){
 const p=page(t,{detail:true});
 const e=src?frameEmbed(p,src):null;
 p.player.remove();
 return {p,e};
}
function ytDetail(p){
 const node=p.d.createElement('shreddit-embed');node.setAttribute('providername','YouTube');
 node.attachShadow({mode:'open'}).appendChild(p.d.createElement('lite-youtube'));
 p.d.querySelector('shreddit-post').append(node);
 const calls=[],state={state:'playing',muted:'true',time:'2'};
 for(const type of ['rt-embed-stop','rt-embed-sound','rt-embed-continue'])node.addEventListener(type,event=>{calls.push([type,node.dataset.rtStart,node.dataset.rtMuted]);event.preventDefault();});
 node.addEventListener('rt-embed-snapshot',()=>Object.assign(node.dataset,{rtEmbedState:state.state,rtEmbedTime:state.time,rtEmbedMuted:state.muted}));
 return {node,calls,state};
}
const activate=(p,value)=>Object.defineProperty(p.W.navigator,'userActivation',{value,configurable:true});
async function directOpen(p,settings,{activation=null,landing}={}){
 if(activation)activate(p,activation);
 p.W.HTMLMediaElement.prototype.play=function(){this._playing=true;this.dispatchEvent(new p.W.Event('play'));return Promise.resolve();};
 const c=new p.W.RTVideoControlRaw.Videos({readSettings:async()=>settings,readPreference:async()=>false,readDirect:async()=>settings.direct===true,observe:false,...(landing===undefined?{}:{landing})});
 await c.ready;await flush();return c;
}
test('Post opened directly: the post’s own YouTube embed plays muted, or tries sound and falls back to muted',async t=>{
 const {p}=detailEmbedPage(t),y=ytDetail(p);
 const c=await directOpen(p,{videoDirectOpen:'muted'});
 assert.deepEqual(y.calls,[['rt-embed-continue','0','true']]);
 c.scan();assert.equal(y.calls.length,1,'started once');
 const q=detailEmbedPage(t).p,z=ytDetail(q);
 const d=await directOpen(q,{videoDirectOpen:'sound'},{activation:{hasBeenActive:true,isActive:false}});
 assert.deepEqual(z.calls,[['rt-embed-continue','0','false']]);
 z.state.state='paused';d.directEmbedCheck(d.directEmbed);
 assert.deepEqual(z.calls[1],['rt-embed-continue','2','true'],'refused: kept playing muted where it was');
 z.state.state='playing';
 activate(q,{hasBeenActive:true,isActive:true});
 q.click(q.d.body);
 assert.equal(z.calls[2]?.[0],'rt-embed-sound','sound at the first click on the page');
});
test('Post opened directly: when the browser says sound would be refused, an embed starts muted and the first click elsewhere brings the sound',async t=>{
 const {p}=detailEmbedPage(t),y=ytDetail(p);
 p.W.navigator.getAutoplayPolicy=()=>'allowed-muted';
 const c=await directOpen(p,{videoDirectOpen:'sound'},{activation:{hasBeenActive:false,isActive:false}});
 assert.deepEqual(y.calls,[['rt-embed-continue','0','true']]);
 assert.equal(c.directEmbed.phase,'fallback');
 activate(p,{hasBeenActive:true,isActive:true});
 p.click(p.d.body);
 assert.equal(y.calls.at(-1)[0],'rt-embed-sound');
 assert.equal(c.directEmbed.ended,true,'once');
 const q=detailEmbedPage(t).p,z=ytDetail(q);
 q.W.navigator.getAutoplayPolicy=()=>'allowed-muted';
 await directOpen(q,{videoDirectOpen:'sound'},{activation:{hasBeenActive:false,isActive:false}});
 activate(q,{hasBeenActive:true,isActive:true});
 q.click(z.node.shadowRoot.querySelector('lite-youtube'));
 assert.equal(z.calls.some(([type])=>type==='rt-embed-sound'),false,'a click into the player leaves the sound to it');
});
test('Post opened directly: Stay paused stops a YouTube start the reader did not make, until they press Play',async t=>{
 const {p}=detailEmbedPage(t),y=ytDetail(p);
 const c=await directOpen(p,{videoDirectOpen:'paused'});
 assert.deepEqual(y.calls,[],'Reddit does not start it; nothing to do');
 y.node.dispatchEvent(new p.W.Event('rt-embed-playing',{bubbles:true}));
 assert.deepEqual(y.calls.map(([type])=>type),['rt-embed-stop']);
 p.click(y.node.shadowRoot.querySelector('lite-youtube'));
 y.node.dispatchEvent(new p.W.Event('rt-embed-playing',{bubbles:true}));
 assert.equal(y.calls.length,1,'the reader’s Play is left alone');
 assert.equal(c.directEmbed.ended,true);
});
test('Post opened directly: a frame driven from inside gets the choice on its hello; Stay paused holds it until the reader plays',async t=>{
 const {p,e}=detailEmbedPage(t,'https://www.redgifs.com/ifr/demo');
 const told=[];e.frame.contentWindow.postMessage=data=>told.push(data.rtMedia);
 await directOpen(p,{videoDirectOpen:'muted',direct:true});
 frameHello(p,e,{playing:false});
 assert.ok(told.includes('mute') && told.includes('play'),told.join());
 const q=detailEmbedPage(t,'https://www.redgifs.com/ifr/demo'),qt=[];q.e.frame.contentWindow.postMessage=data=>qt.push(data.rtMedia);
 const d=await directOpen(q.p,{videoDirectOpen:'paused',direct:true});
 frameHello(q.p,q.e,{playing:false});
 assert.ok(qt.includes('pause'));assert.equal(qt.includes('play'),false);
 qt.length=0;frameSays(q.p,q.e,'play');
 assert.deepEqual(qt,['pause'],'a start nobody chose is paused');
 qt.length=0;frameSays(q.p,q.e,'play',{user:true});
 assert.deepEqual(qt,[],'the reader’s Play inside the player');
 assert.equal(d.directEmbed.ended,true);
});
test('Post opened directly: Play with sound refused inside a frame keeps it playing muted, then unmutes at the first click',async t=>{
 const {p,e}=detailEmbedPage(t,'https://www.redgifs.com/ifr/demo');
 const told=[];e.frame.contentWindow.postMessage=data=>told.push(data.rtMedia);
 const c=await directOpen(p,{videoDirectOpen:'sound',direct:true},{activation:{hasBeenActive:true,isActive:false}});
 frameHello(p,e,{playing:false});
 assert.ok(told.includes('unmute') && told.includes('play'));
 told.length=0;frameSays(p,e,'pause');
 assert.deepEqual(told,['mute','play'],'the browser paused it for sound: muted playback');
 assert.equal(c.directEmbed.phase,'fallback');
 frameSays(p,e,'play');told.length=0;
 activate(p,{hasBeenActive:true,isActive:true});
 p.click(p.d.body);
 assert.deepEqual(told,['unmute','play']);
});
test('Post opened directly: a self-starting player that cannot be driven stays behind its still with Stay paused',async t=>{
 const {p,e}=detailEmbedPage(t,'https://www.redgifs.com/ifr/demo');
 await directOpen(p,{videoDirectOpen:'paused'});
 assert.equal(e.frame.getAttribute('src'),'about:blank');
 const cover=e.node.shadowRoot.querySelector('[data-rt-parked-cover]');assert.ok(cover);
 cover.click();
 assert.match(e.frame.getAttribute('src'),/^https:\/\/www\.redgifs\.com\/ifr\/demo/,'a tap loads it');
});
test('Post opened directly: an embed reached in-app, or carried over from the feed, is not managed',async t=>{
 const {p}=detailEmbedPage(t),y=ytDetail(p);
 const c=await directOpen(p,{videoDirectOpen:'muted'},{landing:''});c.scan();
 assert.deepEqual(y.calls,[],'reached in-app');
 const q=detailEmbedPage(t).p;
 q.W.sessionStorage.setItem(embedKey,JSON.stringify({id:'test',owner:'t2_alice',at:Date.now(),time:4,muted:true,generic:true}));
 const d=new q.W.RTVideoControlRaw.Videos({readSettings:async()=>({videoDirectOpen:'muted'}),readPreference:async()=>false,observe:false});
 assert.equal(d.landing,'','an embed continuation is not a direct open');
});
test('Autoplay and Preview leave a post’s own video to Reddit; Only when I press Play still stops it',async t=>{
 for(const [mode,stopped] of [['autoplay',false],['preview',false],['play',true]]){
  const p=page(t,{detail:true});
  await hoverController(p,{videoStart:mode});
  p.video.muted=true;p.start();
  assert.equal(p.video.paused,stopped,mode);
 }
 const q=page(t);await hoverController(q,{videoStart:'play'});q.start();
 assert.equal(q.video.paused,true,'a feed video Reddit starts is still stopped');
});
// First load (docs/feed-controls-ux-plan.md, 11): no stuck hover or in-view state.
test('a preview that cannot start yet (no video element) leaves no stuck hover, and the next hover starts it',async t=>{
 const p=page(t);const controller=await hoverController(p);
 const video=p.video;video.remove();
 pointer(p);await waitForHover();
 assert.equal(controller.hovered,null,'a failed start clears the hovered player');
 p.root.append(video);
 pointer(p);await waitForHover();
 assert.equal(video.paused,false,'a later pointerover in the same player starts the preview');
});
test('a pointer already resting on a video starts its preview once settings arrive, without moving',async t=>{
 const p=page(t);
 p.W.HTMLMediaElement.prototype.play=function(){this._playing=true;this.dispatchEvent(new p.W.Event('play'));return Promise.resolve();};
 Object.defineProperty(p.video,'readyState',{value:1,configurable:true});
 p.d.elementFromPoint=()=>p.player;
 const controller=new p.W.RTVideoControl.Videos({readSettings:async()=>({}),readPreference:async()=>true,observe:false});
 controller.pointer={x:100,y:200};
 await controller.ready;await flush();await waitForHover();
 assert.equal(p.video.paused,false,'previewing under the resting pointer');assert.equal(p.video.muted,true);
});
test('a stalled preview is dropped so a later pick can try again',async t=>{
 const p=page(t);const controller=await hoverController(p);
 p.W.HTMLMediaElement.prototype.play=function(){return new Promise(()=>{});};// never plays
 const watch=[];const setTimeout0=p.W.setTimeout;p.W.setTimeout=(fn,ms)=>{if(ms===4000){watch.push(fn);return 0;}return setTimeout0(fn,ms);};
 pointer(p);await waitForHover();
 assert.equal(controller.hovered,p.player);assert.equal(watch.length,1,'a stall watch is armed');
 watch[0]();
 assert.equal(controller.hovered,null,'the stalled preview is released');
});
test('an extra provider’s frame is expected to drive itself only once that provider is granted',async t=>{
 const p=page(t);const controller=await hoverController(p);
 const frame=p.d.createElement('iframe');frame.setAttribute('src','https://www.youtube.com/embed/abc?enablejsapi=1');p.d.body.append(frame);
 const vimeo=p.d.createElement('iframe');vimeo.setAttribute('src','https://player.vimeo.com/video/1');p.d.body.append(vimeo);
 controller.setDirect(true);
 assert.equal(controller.grantedFrame(frame),false,'the original grant does not cover YouTube');assert.equal(controller.grantedFrame(vimeo),true);
 assert.equal(controller.expectDirect(frame),false);
 controller.setDirect({core:true,origins:['https://www.youtube.com']});
 assert.equal(controller.grantedFrame(frame),true);assert.equal(controller.expectDirect(frame),true);
 controller.setDirect({core:false,origins:[]});assert.equal(controller.directReady,false);assert.equal(controller.expectDirect(vimeo),false);
});

test('one video at a time also pauses a player Reddit inserted after the last scan',async t=>{
 const p=page(t);
 const controller=await hoverController(p,{videoStart:'reddit'});controller.scan();
 const late=p.player.cloneNode();late.id='late';const root=late.attachShadow({mode:'open'});root.innerHTML='<video></video>';
 p.d.body.append(Object.assign(p.d.createElement('shreddit-post'),{id:'t3_late'}));p.d.getElementById('t3_late').append(late);
 const lateVideo=root.querySelector('video');lateVideo._playing=true;
 p.startFromControl();
 assert.equal(lateVideo.paused,true,'not yet registered, still paused');
 assert.equal(p.video.paused,false);
});

test('opening a post pauses feed media left playing in the outgoing feed, but not the post\'s own video',async t=>{
 const p=page(t);
 const controller=await hoverController(p,{videoStart:'reddit',videoOpenPost:'reddit'});controller.scan();
 const other=p.player.cloneNode();other.id='p2';const root=other.attachShadow({mode:'open'});root.innerHTML='<video></video>';
 p.d.body.append(Object.assign(p.d.createElement('shreddit-post'),{id:'t3_two'}));p.d.getElementById('t3_two').append(other);
 const otherVideo=root.querySelector('video');
 p.video._playing=true;otherVideo._playing=true;
 p.W.history.pushState({},'','/r/example/comments/two/title/');
 p.d.dispatchEvent(new p.W.Event('reddit:route'));
 await new Promise(resolve=>setTimeout(resolve,20));
 assert.equal(p.video.paused,true,'the outgoing feed\'s video stops');
 assert.equal(otherVideo.paused,false,'the destination post\'s video keeps playing');
 controller.destroy();
});

test('Direct controls for YouTube: a granted preview has no layer, and its frame\'s taps and takes reach the page',async t=>{
 const p=page(t),e=embed(p);
 p.W.HTMLMediaElement.prototype.play=function(){this._playing=true;this.dispatchEvent(new p.W.Event('play'));return Promise.resolve();};
 const c=new p.W.RTVideoControlRaw.Videos({readSettings:async()=>({embedStart:'preview',mediaClickAction:'inline',clickAudio:'unmute'}),readPreference:async()=>true,
  readDirect:async()=>({core:true,origins:['https://www.youtube.com']}),observe:false});
 await c.ready;await flush();
 e.over();await waitForHover();
 assert.deepEqual(e.calls,['rt-embed-preview']);
 assert.equal(e.layer(),null,'no layer over YouTube once it is granted');
 // Reddit's lite-youtube creates its iframe on activation; its frame script announces itself.
 const frame=p.d.createElement('iframe');frame.setAttribute('src','https://www.youtube.com/embed/abc?enablejsapi=1');e.lite.append(frame);
 Object.defineProperty(frame,'contentWindow',{value:p.d.body.appendChild(p.d.createElement('iframe')).contentWindow});
 const told=[];frame.contentWindow.postMessage=data=>told.push(data);
 const says=(rtMedia,data={})=>p.W.dispatchEvent(new p.W.MessageEvent('message',{source:frame.contentWindow,origin:'https://www.youtube.com',data:{rtMedia,...data}}));
 says('hello',{playing:true});
 assert.ok(told.some(data=>data?.rtMedia==='preview' && data.on===true),'tap reporting turned on');
 says('tap');
 assert.equal(c.ePreview,null,'the preview became the reader\'s');
 assert.ok(e.calls.includes('rt-embed-sound'),'Video click audio unmutes');

 // With only the original grant, YouTube keeps the layer.
 const q=page(t),f=embed(q);
 const d=new q.W.RTVideoControlRaw.Videos({readSettings:async()=>({embedStart:'preview'}),readPreference:async()=>true,readDirect:async()=>true,observe:false});
 await d.ready;await flush();
 f.over();await waitForHover();
 assert.ok(f.layer(),'the layer stays without the YouTube grant');
});

test('Direct controls: a granted frame previewing before its hello gets no layer, and the hello turns tap reporting on',async t=>{
 const p=page(t),e=frameEmbed(p,'https://streamable.com/e/abc');
 e.node.getBoundingClientRect=()=>({top:120,bottom:420,height:300});
 const c=await directControls(p,{embedStart:'preview',mediaClickAction:'inline'});
 const told=[];e.frame.contentWindow.postMessage=data=>told.push(data);
 e.over();await waitForHover();
 assert.equal(e.layer(),null,'no layer while the hello is on its way');
 assert.ok(c.ePreview?.active);
 frameHello(p,e);
 assert.ok(told.some(data=>data.rtMedia==='preview' && data.on===true));
});

test('a loop policy puts each video\'s own loop setting back when set to Default',async t=>{
  const p=page(t);let settings={videoStart:'reddit',loopPolicy:'always'};
  p.W.HTMLMediaElement.prototype.play=function(){this._playing=true;return Promise.resolve();};
  const c=new p.W.RTVideoControlRaw.Videos({readSettings:async()=>settings,readPreference:async()=>true,observe:false});await c.ready;await flush();
  c.scan();
  p.video.loop=false;c.configure({...settings});
  assert.equal(p.video.loop,true,'Always loop');
  c.configure({videoStart:'reddit',loopPolicy:'default'});
  assert.equal(p.video.loop,false,'Default gives Reddit\'s own value back');
});

test('a start handed to Reddit\'s own player that never plays is reported as failed',async t=>{
  const p=page(t);
  const c=new p.W.RTVideoControlRaw.Videos({readSettings:async()=>({videoStart:'reddit'}),readPreference:async()=>true,observe:false});await c.ready;await flush();
  p.player.addEventListener('rt-play-video',event=>event.preventDefault());
  await assert.rejects(c.play(p.player,p.video),/did not start/);
  p.player.addEventListener('rt-play-video',()=>{setTimeout(()=>{p.video._playing=true;p.video.dispatchEvent(new p.W.Event('playing'));},20);});
  await c.play(p.player,p.video);
});

test('Post opened directly with sound: a refused start says so with a Turn on sound button that brings the sound',async t=>{
 const refuse=p=>{p.allowed=false;Object.defineProperty(p.video,'muted',{configurable:true,
  get(){return this._muted!==false;},
  set(value){if(value===false && !p.allowed){this._playing=false;this.dispatchEvent(new p.W.Event('pause'));return;}this._muted=value;this.dispatchEvent(new p.W.Event('volumechange'));
  }});
 };
 const p=directPage(t);refuse(p);
 const control=await directController(p,{videoDirectOpen:'sound'});
 p.redditAutoplay();
 assert.equal(control.direct.phase,'fallback');
 const button=p.d.querySelector('[data-rt-ui="direct-sound"]');
 assert.ok(button,'a visible prompt instead of silent muted playback');assert.equal(button.getAttribute('aria-label'),'Turn on sound');
 p.allowed=true;p.click(button);
 assert.equal(p.video.muted,false,'its click is the interaction that turns the sound on');
 assert.equal(p.d.querySelector('[data-rt-ui="direct-sound"]'),null,'and it goes away');
 // Using the player's own controls also removes it.
 const q=directPage(t);refuse(q);
 await directController(q,{videoDirectOpen:'sound'});q.redditAutoplay();
 assert.ok(q.d.querySelector('[data-rt-ui="direct-sound"]'));
 q.click(q.root.getElementById('cc'));
 assert.equal(q.d.querySelector('[data-rt-ui="direct-sound"]'),null);
 // Muted on purpose: no prompt.
 const m=directPage(t);await directController(m,{videoDirectOpen:'muted'});m.redditAutoplay();
 assert.equal(m.d.querySelector('[data-rt-ui="direct-sound"]'),null);
});
// Reddit's Media search tab: tiles play through search_results players inside search-media-post-unit.
function searchTile(p){
 const unit=p.d.createElement('div');unit.dataset.id='search-media-post-unit';
 p.player.closest('shreddit-post').replaceWith(unit);unit.append(p.player);p.player.setAttribute('player-type','search_results');
 return unit;
}
test('Media search tab videos follow the start choice: the one you stop on previews on phones',async t=>{
 const p=page(t);searchTile(p);phone(p);
 const controller=await hoverController(p,{videoStart:'preview'});
 assert.equal(controller.previewable(p.player),true);
 scroll(p);await settle();
 assert.equal(p.video.paused,false,'the settled tile previews');assert.equal(p.video.muted,true);
 // A search_results player outside a Media tile is not feed media.
 const q=page(t);q.player.setAttribute('player-type','search_results');const other=await hoverController(q,{videoStart:'preview'});
 assert.equal(other.previewable(q.player),false);
});
test('Post opened directly also covers a post opened from a search result tile',async t=>{
 for(const [fromResult,expectMuted] of [[true,true],[false,false]]){
  const p=directPage(t);
  p.W.history.replaceState({},'','/search/?q=ice+cream&type=media');
  const control=await directController(p,{videoDirectOpen:'muted'});
  assert.equal(control.landing,'','a search page is not a landing post');
  const tile=p.d.createElement('div');
  if(fromResult)tile.dataset.id='search-media-post-unit';
  const link=p.d.createElement('a');link.href=postPath;tile.append(link);p.d.body.append(tile);
  p.click(link);
  p.W.history.pushState({},'',postPath);p.d.dispatchEvent(new p.W.Event('reddit:route'));await flush();
  control.scan();p.redditAutoplay(false);
  assert.equal(control.landing,fromResult?'test':'');
  assert.equal(p.video.muted,expectMuted,fromResult?'the result post follows Play muted':'other in-app opens keep Reddit’s start');
 }
});

test('a Visual search clip hands its moment to the opened post under Seamless post transition',async t=>{
 for(const [videoOpenPost,source,expectTime,expectMuted] of [['position','media',7,true],['start','media',0,true],['position','viewer',9,false],['default','media',null,null]]){
  const p=page(t,{detail:true});
  p.W.history.replaceState({},'','/search/?q=ice+cream&type=media&rt_visual=1');
  p.W.HTMLMediaElement.prototype.play=function(){this._playing=true;this.dispatchEvent(new p.W.Event('play'));return Promise.resolve();};
  Object.defineProperty(p.video,'readyState',{value:1,configurable:true});
  const c=new p.W.RTVideoControlRaw.Videos({readSettings:async()=>({videoOpenPost,clickAudio:'muted'}),readPreference:async()=>false,observe:false});
  await c.ready;await flush();
  p.d.dispatchEvent(new p.W.CustomEvent('rt-visual-continue',{detail:{id:'test',time:source==='viewer'?9:7,source,muted:source!=='viewer'}}));
  p.W.history.pushState({},'',postPath);p.d.dispatchEvent(new p.W.Event('reddit:route'));await flush();c.scan();await flush();
  if(expectTime===null){assert.ok(!c.pending,'Reddit Default keeps Reddit’s own start');continue;}
  assert.equal(p.video.paused,false,videoOpenPost+'/'+source);assert.equal(p.video.currentTime,expectTime);assert.equal(p.video.muted,expectMuted);
 }
});

test('embed stills fall back to /svc/shreddit/partial-feed-post when .json returns 403 and reuse partial lookup afterward',async t=>{
 const p=page(t);const urls=[];
 p.W.fetch=async url=>{
  const href=String(url);urls.push(href);
  if(href.includes('.json'))return {ok:false,status:403};
  const id=/t3_(\w+)/.exec(href)?.[1];
  return {ok:true,status:200,text:async()=>`<shreddit-post id="t3_${id}"><shreddit-embed poster="https://preview.redd.it/${id}-poster.jpg"></shreddit-embed></shreddit-post>`};
 };
 const mkPost=id=>{
  const post=p.d.createElement('shreddit-post');post.id='t3_'+id;p.d.body.append(post);
  const node=p.d.createElement('shreddit-embed');node.setAttribute('providername','RedGIFs');
  node.setAttribute('embed-html','<iframe src="https://www.redgifs.com/ifr/'+id+'"></iframe>');node.attachShadow({mode:'open'});post.append(node);
 };
 p.player.closest('shreddit-post').remove();
 mkPost('first');
 const c=await hoverController(p,{embedStart:'play'});c.scan();
 await flush();
 await new Promise(resolve=>setTimeout(resolve,400));
 mkPost('second');
 c.scan();
 await flush();
 await new Promise(resolve=>setTimeout(resolve,400));
 assert.equal(c.posters.get('t3_first')?.[0],'https://preview.redd.it/first-poster.jpg');
 assert.equal(c.posters.get('t3_second')?.[0],'https://preview.redd.it/second-poster.jpg');
 assert.equal(urls.filter(u=>u.includes('.json')).length,1,'switches directly to partial endpoint after .json refusal');
 assert.ok(urls.some(u=>u.includes('/svc/shreddit/partial-feed-post/t3_second')));
});
test('Media search tab on touch: press and hold plays a clip while held, lifting stops it and is not a tap',async t=>{
 const p=page(t);searchTile(p);phone(p);
 const controller=await hoverController(p,{videoStart:'play'});
 const down=(x=50)=>{const ev=new p.W.MouseEvent('pointerdown',{bubbles:true,composed:true,button:0,clientX:x,clientY:150});Object.defineProperty(ev,'pointerType',{value:'touch'});p.video.dispatchEvent(ev);};
 // A moving finger is a scroll.
 down();p.d.dispatchEvent(new p.W.MouseEvent('pointermove',{bubbles:true,clientX:90,clientY:150}));
 await new Promise(r=>setTimeout(r,340));
 assert.equal(p.video.paused,true,'a scroll starts nothing');
 p.W.dispatchEvent(new p.W.MouseEvent('pointerup',{bubbles:true}));
 down();await new Promise(r=>setTimeout(r,340));await flush();
 assert.equal(p.video.paused,false,'held clip plays even with Only when I press Play');assert.equal(p.video.muted,true);
 const ctx=new p.W.Event('contextmenu',{bubbles:true,cancelable:true,composed:true});p.video.dispatchEvent(ctx);
 assert.equal(ctx.defaultPrevented,true,'no long-press menu');
 p.W.dispatchEvent(new p.W.MouseEvent('pointerup',{bubbles:true}));
 assert.equal(p.video.paused,true,'lifting stops it');
 assert.equal(controller.hovered,null);
 const click=new p.W.MouseEvent('click',{bubbles:true,cancelable:true,composed:true,button:0});p.video.dispatchEvent(click);
 assert.equal(click.defaultPrevented,true,'the click that ends a hold is swallowed');
});
test('a preview that ends, or that the reader takes over, hands Reddit’s player its own mute state back',async t=>{
 const p=page(t);searchTile(p);phone(p);
 const controller=await hoverController(p,{videoStart:'preview'});
 const events=[];for(const type of ['rt-prepare-feed-preview','rt-release-feed-preview'])p.player.addEventListener(type,()=>events.push(type));
 scroll(p);await settle();
 assert.equal(p.video.paused,false);
 controller.stopHover();
 assert.deepEqual(events,['rt-prepare-feed-preview','rt-release-feed-preview']);
});
