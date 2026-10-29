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

test('archived images use Reddit’s image-post media structure',()=>{
 const W=setup(),root=W.RTArchiveView.image('https://i.redd.it/abc.png',{alt:'r/sub - Title',doc:W.document});
 assert.match(root.className,/xs:rounded-4/);assert.equal(root.dataset.rtRecoveredText,'true');assert.ok(root.querySelector('.border-neutral-border-weak'),'hairline frame');
 const ratio=root.querySelector('[data-aspect-ratio-container]');assert.match(ratio.style.cssText,/min-height: 220px/);
 const [backdrop,main]=root.querySelectorAll('img');assert.match(backdrop.className,/opacity-30 object-cover/);assert.equal(backdrop.getAttribute('role'),'presentation');assert.match(main.className,/object-contain/);assert.equal(main.alt,'r/sub - Title');
 for(const img of [backdrop,main]){assert.equal(img.src,'https://i.redd.it/abc.png');assert.equal(img.referrerPolicy,'no-referrer');}
 Object.defineProperty(main,'naturalWidth',{value:640});Object.defineProperty(main,'naturalHeight',{value:755});main.dispatchEvent(new W.Event('load'));assert.equal(ratio.style.aspectRatio,'640 / 755','the image’s own proportions');
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
 const r=ratio({width:'x',height:'y'});assert.equal(r.getAttribute('style').includes('evil'),false);assert.equal(r.style.minHeight,'220px');
 const root=W.RTArchiveView.image('https://i.redd.it/abc.png',{doc:W.document}),main=root.querySelectorAll('img')[1],box=root.querySelector('[data-aspect-ratio-container]');
 Object.defineProperty(main,'naturalWidth',{value:99999});Object.defineProperty(main,'naturalHeight',{value:10});main.dispatchEvent(new W.Event('load'));assert.equal(box.style.aspectRatio,'16 / 9','an implausible natural size is ignored');
});
