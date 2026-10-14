const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
function setup(t){
  const dom=new JSDOM('<body></body>',{runScripts:'outside-only'}),w=dom.window;t.after(()=>w.close());
  for(const file of ['message-store','media-preview'])w.eval(fs.readFileSync(path.join(__dirname,'../extension/'+file+'.js'),'utf8'));
  const style=w.document.createElement('style');style.textContent=w.RCSMediaPreview.styles;w.document.head.append(style);
  return w;
}
test('cached native previews request high-density dimensions without rewriting arbitrary image URLs',t=>{
  const w=setup(t),source=w.RCSMediaPreview.sourceURL;
  const old='https://matrix.redditspace.com/_matrix/media/v3/thumbnail/reddit.com/image?width=160&height=120&method=scale';
  const upgraded=new URL(source(old));assert.equal(upgraded.pathname,new URL(old).pathname);assert.equal(upgraded.searchParams.get('width'),'384');assert.equal(upgraded.searchParams.get('height'),'256');
  assert.equal(source(upgraded.href),upgraded.href,'normalization is stable on redraw');
  const large=old.replace('160','800').replace('120','600');assert.equal(source(large),large,'do not lower existing source resolution');
  for(const url of ['https://example.invalid/thumb?width=160&height=120','https://matrix.redditspace.com/_matrix/media/v3/download/reddit.com/image','https://matrix.redditspace.com.evil.invalid/_matrix/media/v3/thumbnail/reddit.com/image?width=10'])assert.equal(source(url),url);
  for(const url of ['https://matrix.redditspace.com/_matrix/media/v3/thumbnail/reddit.com/image?access_token=secret','http://matrix.redditspace.com/img','data:image/png,abc'])assert.equal(source(url),'');
});
test('message image sender labels stack above previews while People summaries remain compact',t=>{
  const w=setup(t),view=new w.RCSMediaPreview.View(),record={roomId:'room',id:'photo',attachmentType:'image',attachmentPreview:'https://example.invalid/image.png'};
  const message=view.render(record,{prefix:'You: '});w.document.body.append(message);
  assert.equal(message.firstElementChild.textContent,'You: ');assert.ok(message.lastElementChild.matches('.media-thumb'));
  assert.equal(w.getComputedStyle(message).flexDirection,'column');assert.equal(w.getComputedStyle(message).alignItems,'flex-start');
  assert.equal(message.querySelector('img').width,96);assert.equal(message.querySelector('img').height,64);assert.equal(message.querySelector('img').getAttribute('loading'),'lazy');
  const compact=view.render(record,{prefix:'You: ',compact:true});w.document.body.append(compact);assert.equal(w.getComputedStyle(compact).flexDirection,'row');assert.equal(w.getComputedStyle(compact).height,'20px');
  const image=message.querySelector('img');assert.equal(view.render(record,{prefix:'Another sender: '}).querySelector('img'),image,'prefix updates reuse the source node');
});

test('preview dimensions preserve portrait, landscape, square and small image ratios',t=>{
  const w=setup(t),fit=(width,height,compact)=>JSON.parse(JSON.stringify(w.RCSMediaPreview.fitSize({width,height},compact)));
  assert.deepEqual(fit(1600,900),{width:128,height:72});assert.deepEqual(fit(1200,1600),{width:96,height:128});
  assert.deepEqual(fit(800,800),{width:128,height:128});assert.deepEqual(fit(20,10),{width:20,height:10});
  assert.deepEqual(fit(1200,1600,true),{width:15,height:20});assert.deepEqual(fit(undefined,undefined),{width:96,height:64});
});

test('returned dimensions correct inaccurate saved hints, including detached previews',t=>{
  const w=setup(t);let resized=0;const view=new w.RCSMediaPreview.View({onResize:()=>resized++}),record={roomId:'room',id:'photo',attachmentPreview:'https://example.invalid/photo',attachmentWidth:1600,attachmentHeight:900};
  const root=view.render(record,{prefix:'You: '});w.document.body.append(root);const image=root.querySelector('img'),url=image.src;
  assert.equal(image.width,128);assert.equal(image.height,72,'reserve saved proportions before the image loads');
  root.remove();Object.defineProperties(image,{naturalWidth:{value:500},naturalHeight:{value:1000}});image.dispatchEvent(new w.Event('load'));
  assert.equal(image.width,64);assert.equal(image.height,128);assert.equal(w.getComputedStyle(image).objectFit,'contain');assert.equal(w.getComputedStyle(image).height,'auto');assert.equal(resized,1);
  image.dispatchEvent(new w.Event('load'));assert.equal(resized,1,'unchanged dimensions do not schedule repeated layout');
  assert.equal(view.render({...record,attachmentWidth:undefined,attachmentHeight:undefined}).querySelector('img'),image);assert.equal(image.src,url);assert.equal(image.height,128,'retain learned dimensions on later renders');
});

test('known geometry reserves a native shimmer and the loaded image replaces it without resizing',t=>{
  const w=setup(t);w.customElements.define('faceplate-shimmer',class extends w.HTMLElement{});let resized=0,saves=0;
  const view=new w.RCSMediaPreview.View({onResize:()=>resized++,onDimensions:()=>saves++}),record={roomId:'room',id:'portrait',attachmentPreview:'https://example.invalid/portrait',attachmentWidth:1200,attachmentHeight:1600};
  const root=view.render(record,{owner:'@me:reddit.com',prefix:'You: '});w.document.body.append(root);const thumb=root.querySelector('.media-thumb'),image=root.querySelector('img'),reserved=thumb.getAttribute('style');
  assert.ok(root.querySelector('faceplate-shimmer[shape="pill"]'));assert.equal(image.width,96);assert.equal(image.height,128);assert.equal(w.getComputedStyle(image).visibility,'hidden');assert.equal(thumb.getAttribute('aria-busy'),'true');
  Object.defineProperties(image,{naturalWidth:{value:192},naturalHeight:{value:256}});image.dispatchEvent(new w.Event('load'));
  assert.equal(thumb.getAttribute('style'),reserved);assert.equal(thumb.dataset.state,'loaded');assert.equal(root.querySelector('.media-placeholder').hidden,true);assert.equal(w.getComputedStyle(image).visibility,'visible');assert.equal(resized,0);assert.equal(saves,0);
});

test('missing hints learn once and shimmer loading, errors and reduced motion remain distinct',t=>{
  const w=setup(t);w.customElements.define('faceplate-shimmer',class extends w.HTMLElement{});w.matchMedia=()=>({matches:true});const saved=[];
  const view=new w.RCSMediaPreview.View({onDimensions:patch=>saved.push(patch)}),record={roomId:'room',id:'learn',attachmentPreview:'https://example.invalid/learn'};
  const root=view.render(record,{owner:'@me:reddit.com'});w.document.body.append(root);assert.ok(root.querySelector('.fallback-shimmer'));assert.equal(root.querySelector('faceplate-shimmer'),null);
  const image=root.querySelector('img');Object.defineProperties(image,{naturalWidth:{value:400},naturalHeight:{value:800}});image.dispatchEvent(new w.Event('load'));view.render(record,{owner:'@me:reddit.com'});image.dispatchEvent(new w.Event('load'));
  assert.equal(saved.length,1);assert.equal(saved[0].width,400);assert.equal(saved[0].height,800);assert.equal(saved[0].owner,'@me:reddit.com');
  const failure=view.render({...record,id:'failure'});failure.querySelector('img').dispatchEvent(new w.Event('error'));assert.equal(failure.querySelector('.media-thumb').dataset.state,'error');assert.equal(failure.querySelector('.media-shimmer').hidden,true);assert.equal(failure.querySelector('.media-error').hidden,false);assert.equal(failure.querySelector('.media-thumb').getAttribute('aria-busy'),'false');
});

test('image resize captures the old placeholder before changing geometry or revealing decoded content',t=>{
  const w=setup(t),steps=[];let thumb;
  const view=new w.RCSMediaPreview.View({onBeforeResize:node=>{steps.push('before');assert.equal(node.dataset.state,'loading');assert.equal(node.style.aspectRatio,'96 / 64');assert.equal(node.querySelector('.media-image').height,64);},onResize:record=>{steps.push('after');assert.equal(thumb.dataset.state,'loaded');assert.equal(thumb.querySelector('.media-image').height,128);assert.equal(record.id,'resize-order');}});
  const root=view.render({roomId:'room',id:'resize-order',attachmentPreview:'https://example.invalid/resize-order'});w.document.body.append(root);thumb=root.querySelector('.media-thumb');const img=root.querySelector('img');
  Object.defineProperties(img,{naturalWidth:{value:400},naturalHeight:{value:800}});img.dispatchEvent(new w.Event('load'));assert.deepEqual(steps,['before','after']);
});
