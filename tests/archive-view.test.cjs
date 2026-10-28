const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
function view(){const dom=new JSDOM('',{runScripts:'outside-only'});dom.window.eval(fs.readFileSync('extension/archive-view.js','utf8'));return dom.window;}
test('archived images use Reddit’s image-post media structure',()=>{
 const W=view(),root=W.RTArchiveView.image('https://i.redd.it/abc.png',{alt:'r/sub - Title',doc:W.document});
 assert.match(root.className,/xs:rounded-4/);assert.equal(root.dataset.rtRecoveredText,'true');assert.ok(root.querySelector('.border-neutral-border-weak'),'hairline frame');
 const ratio=root.querySelector('[data-aspect-ratio-container]');assert.match(ratio.style.cssText,/min-height: 220px/);
 const [backdrop,main]=root.querySelectorAll('img');assert.match(backdrop.className,/opacity-30 object-cover/);assert.equal(backdrop.getAttribute('role'),'presentation');assert.match(main.className,/object-contain/);assert.equal(main.alt,'r/sub - Title');
 for(const img of [backdrop,main]){assert.equal(img.src,'https://i.redd.it/abc.png');assert.equal(img.referrerPolicy,'no-referrer');}
 Object.defineProperty(main,'naturalWidth',{value:640});Object.defineProperty(main,'naturalHeight',{value:755});main.dispatchEvent(new W.Event('load'));assert.equal(ratio.style.aspectRatio,'640 / 755','the image’s own proportions');
});
test('only Reddit-hosted https images are accepted, and skeletons use Reddit’s shimmer element',()=>{
 const W=view(),{imageUrl,skeleton}=W.RTArchiveView;
 assert.equal(imageUrl('https://i.redd.it/x.jpeg'),'https://i.redd.it/x.jpeg');assert.equal(imageUrl('https://preview.redd.it/x.webp?s=1'),'https://preview.redd.it/x.webp?s=1');
 for(const bad of ['http://i.redd.it/x.png','https://evil.example/x.png','https://i.redd.it/x.svg','javascript:alert(1)',''])assert.equal(imageUrl(bad),'',bad);
 const box=skeleton({lines:3,doc:W.document});assert.equal(box.dataset.rtSkeleton,'true');assert.equal(box.getAttribute('aria-hidden'),'true');assert.equal(box.querySelectorAll('faceplate-shimmer.rt-skeleton-line').length,3);
});
