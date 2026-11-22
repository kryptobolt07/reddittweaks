const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
function setup(){const dom=new JSDOM('',{url:'https://www.reddit.com/',runScripts:'outside-only'}),W=dom.window;for(const name of ['post-model.js','archive-view.js'])W.eval(fs.readFileSync('extension/'+name,'utf8'));return W;}
const video={kind:'video',poster:'https://external-preview.redd.it/poster.png?s=signed',hls:'https://v.redd.it/clip/HLSPlaylist.m3u8?a=signed',dash:'https://v.redd.it/clip/DASHPlaylist.mpd?a=signed',fallback:'https://v.redd.it/clip/CMAF_1080.mp4',hasAudio:true,width:1080,height:1920};
test('full video uses Reddit loader and HLS player markup without a silent MP4 fallback',()=>{
 const W=setup(),root=W.RTArchiveView.media([video],{alt:'Video',postId:'abc12'}),loader=root.querySelector('shreddit-async-loader'),player=root.querySelector('shreddit-player');
 assert.equal(loader.getAttribute('bundlename'),'shreddit_player_loader');assert.equal(loader.style.aspectRatio,'1080 / 1920');assert.equal(player.getAttribute('src'),video.hls);assert.equal(player.getAttribute('post-id'),'t3_abc12');assert.equal(player.querySelector('source').type,'application/vnd.apple.mpegURL');assert.equal(player.querySelector('[slot=poster]').src,video.poster);assert.equal(player.hasAttribute('autoplay'),false);assert.equal(root.querySelector('video'),null);assert.equal(root.outerHTML.includes(video.fallback),false);W.close();
});
test('compact videos show only a poster and invalid HLS never becomes a player',()=>{
 const W=setup(),compact=W.RTArchiveView.media([video],{compact:true});assert.equal(compact.querySelector('img').src,video.poster);assert.match(compact.className,/xs:w-\[130px\]/);assert.equal(compact.dataset.testid,'post-thumbnail');assert.equal(compact.querySelector('shreddit-player'),null);
 const fallback=W.RTArchiveView.media([{...video,hls:'https://evil.test/clip/HLSPlaylist.m3u8'}]);assert.equal(fallback.querySelector('shreddit-player'),null);assert.equal(fallback.querySelector('img').src,video.poster);assert.equal(W.RTArchiveView.media([{...video,hls:'https://evil.test/a.m3u8',poster:'https://evil.test/p.jpg'}]),null);W.close();
});

test('a video the archive can\'t play shows its preview labelled, no player and no play button',async()=>{
 const W=setup();
 const noFile=W.RTArchiveView.media([{...video,hls:''}]);assert.equal(noFile.querySelector('shreddit-player'),null);assert.ok(noFile.querySelector('[data-rt-video-unavailable]'));assert.match(noFile.textContent,/Original video isn’t available/);assert.equal(noFile.querySelector('img.preview-img').src,video.poster);
 const nothing=W.RTArchiveView.videoUnavailable('');assert.match(nothing.textContent,/Original video isn’t available in the archive/);
 // The playlist is gone: the player is replaced by the labelled preview.
 W.fetch=async()=>({ok:false,status:403});const dead=W.RTArchiveView.media([video]);W.document.body.append(dead);assert.ok(dead.querySelector('shreddit-player'));
 for(let i=0;i<4;i++)await new Promise(r=>setTimeout(r,0));assert.equal(dead.querySelector('shreddit-player'),null);assert.ok(dead.querySelector('[data-rt-video-unavailable]'));
 // A playable one stays, with the poster kept inside the video box.
 W.fetch=async()=>({ok:true,status:200});const live=W.RTArchiveView.media([video]);W.document.body.append(live);for(let i=0;i<4;i++)await new Promise(r=>setTimeout(r,0));assert.ok(live.querySelector('shreddit-player'));assert.equal(live.querySelector('shreddit-async-loader').style.position,'relative');
 W.close();
});
test('archived images use Reddit’s image-post media structure',()=>{
 const W=setup(),root=W.RTArchiveView.image('https://i.redd.it/abc.png',{alt:'r/sub - Title',doc:W.document});
 assert.match(root.className,/xs:rounded-4/);assert.equal(root.dataset.rtRecoveredText,'true');assert.ok(root.querySelector('.border-neutral-border-weak'),'hairline frame');
 const ratio=root.querySelector('[data-aspect-ratio-container]');assert.equal(ratio.style.minHeight,'min(220px, var(--rt-archive-media-max-height, 220px))');
 const [backdrop,main]=root.querySelectorAll('img');assert.match(backdrop.className,/opacity-30 object-cover/);assert.equal(backdrop.getAttribute('role'),'presentation');assert.match(main.className,/object-contain/);assert.equal(main.alt,'r/sub - Title');
 for(const img of [backdrop,main]){assert.equal(img.src,'https://i.redd.it/abc.png');assert.equal(img.referrerPolicy,'no-referrer');}
 Object.defineProperty(main,'naturalWidth',{value:640});Object.defineProperty(main,'naturalHeight',{value:755});main.dispatchEvent(new W.Event('load'));assert.equal(ratio.style.aspectRatio,'640 / 755','the image’s own proportions');
});

test('the outer image and video frames share the mobile post height limit without changing the default',()=>{
 const W=setup(),view=W.RTArchiveView;
 const image=view.image('https://i.redd.it/abc.png',{width:1080,height:1920});
 const videoFrame=view.media([video]).querySelector('shreddit-async-loader');
 for(const frame of [image.querySelector('[data-aspect-ratio-container]'),videoFrame]){
   assert.match(frame.style.maxHeight,/^var\(--rt-archive-media-max-height, max\(300px, /);
 }
 W.close();
});
test('only Reddit-hosted https images are accepted, and skeletons use Reddit’s shimmer element',()=>{

 const W=setup(),{imageUrl,skeleton}=W.RTArchiveView;
 assert.equal(imageUrl('https://i.redd.it/x.jpeg'),'https://i.redd.it/x.jpeg');assert.equal(imageUrl('https://preview.redd.it/x.webp?s=1'),'https://preview.redd.it/x.webp?s=1');
 for(const bad of ['http://i.redd.it/x.png','https://evil.example/x.png','https://i.redd.it/x.svg','javascript:alert(1)',''])assert.equal(imageUrl(bad),'',bad);
 const box=skeleton({lines:3,doc:W.document});assert.equal(box.dataset.rtSkeleton,'true');assert.equal(box.getAttribute('aria-hidden'),'true');assert.equal(box.querySelectorAll('.rt-skeleton-line.skeleton-shimmer').length,3);assert.ok(box.querySelector('.rt-skeleton-fallback'),'sweep fallback without Reddit’s shimmer element');assert.deepEqual([...box.children].map(n=>n.style.width),['86%','72%','55%']);
});

test('image dimensions are accepted only as positive integers up to 20000; unknown proportions reserve 16:9',()=>{
 const W=setup(),ratio=(opts)=>W.RTArchiveView.image('https://i.redd.it/abc.png',{doc:W.document,...opts}).querySelector('[data-aspect-ratio-container]');
 assert.equal(ratio({width:640,height:480}).style.aspectRatio,'640 / 480');assert.equal(ratio({width:20000,height:1}).style.aspectRatio,'20000 / 1');
 for(const [width,height] of [[0,0],[-5,10],[1.5,2],[20001,10],['640; background:url(//evil)','480'],['640','480} body{display:none'],[NaN,5],[undefined,undefined]])assert.equal(ratio({width,height}).style.aspectRatio,'16 / 9',JSON.stringify([width,height]));
 const r=ratio({width:'x',height:'y'});assert.equal(r.getAttribute('style').includes('evil'),false);assert.match(r.style.minHeight,/^min\(220px, /);
 const root=W.RTArchiveView.image('https://i.redd.it/abc.png',{doc:W.document}),main=root.querySelectorAll('img')[1],box=root.querySelector('[data-aspect-ratio-container]');
 Object.defineProperty(main,'naturalWidth',{value:99999});Object.defineProperty(main,'naturalHeight',{value:10});main.dispatchEvent(new W.Event('load'));assert.equal(box.style.aspectRatio,'16 / 9','an implausible natural size is ignored');
});

test('multi-image galleries render an interactive carousel and click-to-zoom lightbox while keeping all preview images in the DOM',()=>{
 const W=setup();
 const items=[
  {kind:'image',url:'https://i.redd.it/one.png',width:800,height:600},
  {kind:'image',url:'https://i.redd.it/two.png',width:800,height:600},
  {kind:'image',url:'https://i.redd.it/three.png',width:800,height:600}
 ];
 const gallery=W.RTArchiveView.media(items,{alt:'Album',doc:W.document});
 W.document.body.append(gallery);
 assert.ok(gallery.classList.contains('rt-archive-gallery'));
 assert.deepEqual([...gallery.querySelectorAll('.preview-img')].map(img=>img.src),items.map(i=>i.url));
 const slides=[...gallery.querySelectorAll('.rt-gallery-slide')];
 assert.equal(slides.length,3);
 assert.equal(slides[0].hidden,false);assert.equal(slides[1].hidden,true);assert.equal(slides[2].hidden,true);
 const counter=gallery.querySelector('.rt-gallery-counter');
 assert.equal(counter.textContent,'1 / 3');
 const next=gallery.querySelector('.rt-gallery-next'),prev=gallery.querySelector('.rt-gallery-prev');
 assert.equal(prev.hidden,true);assert.equal(next.hidden,false);
 next.click();
 assert.equal(counter.textContent,'2 / 3');
 assert.equal(slides[0].hidden,true);assert.equal(slides[1].hidden,false);
 assert.equal(prev.hidden,false);
 gallery.querySelectorAll('.rt-gallery-dot')[2].click();
 assert.equal(counter.textContent,'3 / 3');
 assert.equal(next.hidden,true);
 // Lightbox opens on image click and closes on Escape
 slides[2].querySelector('img.preview-img').click();
 const lb=W.document.querySelector('[data-rt-ui="archive-lightbox"]');
 assert.ok(lb,'lightbox opens on image click');
 assert.equal(lb.querySelector('.rt-lightbox-img').src,'https://i.redd.it/three.png');
 W.document.dispatchEvent(new W.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
 assert.equal(W.document.querySelector('[data-rt-ui="archive-lightbox"]'),null);
 assert.deepEqual([...W.RTArchiveView.mediaSources(gallery)].map(s=>s.url),items.map(i=>i.url));
 W.close();
});

