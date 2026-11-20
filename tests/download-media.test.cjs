const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
const read=file=>fs.readFileSync('extension/'+file,'utf8');
const flush=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setTimeout(resolve,0));};
const plain=value=>JSON.parse(JSON.stringify(value));

function model(){
  const context=vm.createContext({URL,Set,Map,Number,String,Array,Object,JSON,Math,Error});
  vm.runInContext(read('download-model.js'),context);
  return context.RTDownloadModel;
}
function page(type='image',extra=''){
  return `<!doctype html><html><body><main><shreddit-post id="t3_post1" post-type="${type}" post-title="A test / image" content-href="https://i.redd.it/abc.jpeg" permalink="/r/Alpha/comments/post1/title/"><div slot="post-media-container"><img class="z-1" src="https://i.redd.it/abc.jpeg" width="1200" height="800"></div><shreddit-post-overflow-menu post-id="t3_post1" permalink="/r/Alpha/comments/post1/title/"><button type="button" aria-haspopup="menu" aria-expanded="true">⋯</button><div slot="devvit-context-actions" role="menuitem"><span>Save</span></div></shreddit-post-overflow-menu>${extra}</shreddit-post></main></body></html>`;
}
function ui(t,{type='image',extra='',read:reader,mobile=false}={}){
  const dom=new JSDOM(page(type,extra),{url:'https://www.reddit.com/r/Alpha/',runScripts:'outside-only',pretendToBeVisual:true}),W=dom.window,D=W.document;
  t.after(()=>W.close());
  for(const file of ['download-model.js','download-ui.js'])W.eval(read(file));
  const post=D.querySelector('shreddit-post'),menu=D.querySelector('shreddit-post-overflow-menu'),trigger=menu.querySelector('button'),calls=[];
  const shadow=post.attachShadow({mode:'open'});
  shadow.innerHTML='<rpl-action-bar><div data-testid="action-row"><slot name="share-button"></slot><slot name="action-row-whitespace"></slot></div></rpl-action-bar>';
  const download=new W.RTDownloadUI.Download({observe:false,read:reader || (async message=>{calls.push(message);return {ok:true};}),mobile});
  download.sync();
  return {W,D,post,menu,trigger,shadow,download,calls,item:()=>D.querySelector('[data-rt-download="item"]'),action:()=>shadow.querySelector('[data-rt-download="action"]'),panel:()=>shadow.querySelector('[data-rt-download="panel"]') || D.querySelector('[data-rt-download="panel"]')};
}
function videoJson(items){
  return JSON.stringify({playbackMp4s:{permutations:items.map(([url,width,height,bitrate])=>({source:{url,dimensions:{width,height},bitrateBps:bitrate}}))}});
}

test('media URLs accept only Reddit image and packaged video hosts with matching extensions',()=>{
  const M=model();
  assert.equal(M.safeDownloadUrl('https://i.redd.it/abc.jpeg?width=640'),'https://i.redd.it/abc.jpeg?width=640');
  assert.equal(M.safeDownloadUrl('https://preview.redd.it/abc.png?width=640'),'https://preview.redd.it/abc.png?width=640');
  assert.equal(M.safeDownloadUrl('https://packaged-media.redd.it/abc/pb/m2-res_720p.mp4?token=1'),'https://packaged-media.redd.it/abc/pb/m2-res_720p.mp4?token=1');
  assert.equal(M.safeDownloadUrl('https://v.redd.it/abc/CMAF_96.mp4'),'https://v.redd.it/abc/CMAF_96.mp4');
  for(const url of ['http://i.redd.it/abc.jpeg','https://i.redd.it.evil/abc.jpeg','https://evil.example/abc.jpeg','https://user:pass@i.redd.it/abc.jpeg','https://i.redd.it/abc.html','https://packaged-media.redd.it/abc/m2-res_720p.m3u8'])assert.equal(M.safeDownloadUrl(url),'',url);
  assert.equal(M.isRedditPage('https://www.reddit.com/r/Alpha/'),true);
  assert.equal(M.isRedditPage('https://old.reddit.com/r/Alpha/'),true);
  assert.equal(M.isRedditPage('https://reddit.com.evil/'),false);
});

test('image, gallery and video extraction use the post’s original Reddit media',()=>{
  const M=model(),dom=new JSDOM(page('image'),{url:'https://www.reddit.com/'}),D=dom.window.document,post=D.querySelector('shreddit-post');
  assert.deepEqual(JSON.parse(JSON.stringify(M.mediaFor(post))),{type:'image',items:[{kind:'image',url:'https://i.redd.it/abc.jpeg',width:1200,height:800}]});
  post.setAttribute('content-href','https://www.reddit.com/gallery/post1');post.querySelector('img').setAttribute('src','https://preview.redd.it/abc.jpeg?width=640');
  assert.equal(M.mediaFor(post).items[0].url,'https://preview.redd.it/abc.jpeg?width=640');
  const gallery=new JSDOM(`<shreddit-post post-type="gallery" post-title="Gallery" id="t3_g"><gallery-carousel post-id="t3_g"><li slot="page-2"><zoomable-img><img src="https://i.redd.it/two.jpeg" width="20" height="30"></zoomable-img></li><li slot="page-1"><img src="https://preview.redd.it/one.jpeg?width=10"><img class="media-lightbox-img" src="https://i.redd.it/one.jpeg" width="10" height="20"></li></gallery-carousel></shreddit-post>`,{url:'https://www.reddit.com/'}).window.document.querySelector('shreddit-post');
  assert.deepEqual(JSON.parse(JSON.stringify(M.mediaFor(gallery))),{type:'gallery',items:[{kind:'image',url:'https://i.redd.it/one.jpeg',width:10,height:20},{kind:'image',url:'https://i.redd.it/two.jpeg',width:20,height:30}]});
  const video=new JSDOM(`<shreddit-post post-type="video" post-title="Video" id="t3_v"><shreddit-player packaged-media-json='${videoJson([['https://packaged-media.redd.it/v/pb/m2-res_480p.mp4',854,480,500000],['https://packaged-media.redd.it/v/pb/m2-res_720p.mp4',1280,720,1200000],['https://evil.example/m2-res_1080p.mp4',1920,1080,2000000]])}'></shreddit-player></shreddit-post>`,{url:'https://www.reddit.com/'}).window.document.querySelector('shreddit-post');
  const media=M.mediaFor(video);
  assert.deepEqual(plain(media.items.map(item=>item.height)),[720,480]);
  assert.equal(M.labelFor(media.items[0],0,2),'720p');
  assert.match(M.captionFor(media.items[0]),/^1280 × 720 · 1\.2 Mbps$/);
  assert.equal(M.filenameFor(video,media.items[0],0,2),'Video-720p.mp4');
  assert.equal(M.filenameFor(video,media.items[1],1,2),'Video-480p.mp4');
  const duplicate=new JSDOM(`<shreddit-post post-type="video" post-title="Duplicate" id="t3_d"><shreddit-player packaged-media-json='${videoJson([['https://packaged-media.redd.it/v/pb/m2-res_720p.mp4',1280,720,1200000],['https://packaged-media.redd.it/v/pb/m2-res_720p_alt.mp4',1280,720,800000],['https://packaged-media.redd.it/v/pb/m2-res_480p.mp4',854,480,500000]])}'></shreddit-player></shreddit-post>`,{url:'https://www.reddit.com/'}).window.document.querySelector('shreddit-post');
  assert.deepEqual(plain(M.mediaFor(duplicate).items.map(item=>[item.height,item.bitrate])),[[720,1200000],[480,500000]]);
  const lazy=new JSDOM(`<shreddit-post post-type="image" post-title="Lazy"><div slot="post-media-container"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" data-lazy-src="https://i.redd.it/lazy.jpeg" width="10" height="20"></div></shreddit-post>`,{url:'https://www.reddit.com/'}).window.document.querySelector('shreddit-post');
  assert.equal(M.mediaFor(lazy).items[0].url,'https://i.redd.it/lazy.jpeg');
  const original=new JSDOM(`<shreddit-post post-type="image" post-title="Original"><div slot="post-media-container"><img src="https://preview.redd.it/original.jpeg?width=640" data-src="https://i.redd.it/original.jpeg" width="10" height="20"></div></shreddit-post>`,{url:'https://www.reddit.com/'}).window.document.querySelector('shreddit-post');
  assert.equal(M.mediaFor(original).items[0].url,'https://i.redd.it/original.jpeg');
  const nsfw=new JSDOM(`<shreddit-post post-type="video" post-title="NSFW video" id="t3_n"><shreddit-player></shreddit-player></shreddit-post>`,{url:'https://www.reddit.com/'}).window.document.querySelector('shreddit-post');
  const player=nsfw.querySelector('shreddit-player'),shadow=player.attachShadow({mode:'open'});
  shadow.innerHTML='<shreddit-media-ui preview="https://v.redd.it/abc/CMAF_96.mp4"></shreddit-media-ui>';
  assert.deepEqual(plain(M.mediaFor(nsfw)),{type:'video',items:[{kind:'video',url:'https://v.redd.it/abc/CMAF_96.mp4'}]});
  assert.equal(M.labelFor(M.mediaFor(nsfw).items[0],0,1),'Video');
});

test('filenames are bounded and never contain path separators',()=>{
  const M=model();
  assert.equal(M.safeFilename('../../A: bad / title?.jpeg'),'..-..-A- bad - title-.jpeg'.replace(/^\.+/,''));
  assert.equal(M.safeFilename('x'.repeat(300)).length,160);
  assert.equal(M.safeFilename('', 'fallback'),'fallback');
  const post={getAttribute:name=>name==='post-title'?'A/B:C*D?E"F<G>H|I':'t3_x'};
  const file=M.filesFor(post,[{kind:'image',url:'https://i.redd.it/a.jpeg'}]).files[0];
  assert.equal(file.filename,'A-B-C-D-E-F-G-H-I-image.jpeg');
  assert.equal(/[\\/]/.test(file.filename),false);
});

test('desktop puts one download button in the action bar next to Share, not in ⋯',async t=>{
  const s=ui(t),action=s.action(),button=action.querySelector('button'),row=s.shadow.querySelector('[data-testid="action-row"]');
  assert.ok(action);assert.equal(action.parentElement,row);assert.equal(action.previousElementSibling,row.querySelector('slot[name="share-button"]'));
  assert.equal(s.item(),null);assert.equal(button.getAttribute('aria-label'),'Download media');assert.equal(button.getAttribute('aria-expanded'),'false');
  button.click();
  assert.equal(action.hasAttribute('open'),true);assert.equal(button.getAttribute('aria-expanded'),'true');
  assert.deepEqual([...s.panel().querySelectorAll('[role="menuitem"]')].map(node=>node.querySelector('.text-body-2').textContent),['Original image']);
  s.panel().querySelector('[role="menuitem"]').click();await flush();
  assert.equal(s.calls.length,1);assert.equal(action.hasAttribute('open'),false);assert.equal(s.panel().querySelectorAll('[role="menuitem"]').length,0);assert.equal(button.getAttribute('aria-expanded'),'false');
});

test('mobile keeps the download item in ⋯ and opens the phone submenu in place',async t=>{
  const s=ui(t,{mobile:true}),item=s.item();assert.ok(item);assert.equal(s.action(),null);
  assert.equal(item.parentElement.getAttribute('slot'),'devvit-context-actions');
  const portal=s.D.createElement('div');portal.id='post-overflow-menu-bottom-sheet';portal.className='post-overflow-menu-bottom-sheet';
  const slot=s.D.createElement('div');slot.setAttribute('slot','devvit-context-actions');slot.setAttribute('role','menuitem');slot.append(item);portal.append(slot);s.D.body.append(portal);
  item.querySelector('[role="menuitem"]').click();
  assert.ok(s.panel());assert.equal(s.panel().parentElement,portal);assert.equal(slot.style.display,'none');
  assert.deepEqual([...s.panel().querySelectorAll('[role="menuitem"]')].map(node=>node.querySelector('.text-body-2').textContent),['Back','Original image']);
  s.panel().querySelector('[data-rt-download="back"]').click();
  assert.equal(s.panel(),null);assert.equal(slot.style.display,'');assert.equal(item.querySelector('[role="menuitem"]').getAttribute('aria-expanded'),'false');
  const css=read('download-media.css');assert.match(css,/#post-overflow-menu-bottom-sheet \.rt-download-submenu\{[^}]*max-width:none/);
});

test('the phone bottom sheet keeps one copied download item',t=>{
  const s=ui(t,{mobile:true}),portal=s.D.createElement('div');portal.id='post-overflow-menu-bottom-sheet';
  const native=s.D.createElement('div');native.setAttribute('slot','devvit-context-actions');native.append(s.D.createElement('hr'));
  const copy=s.item().cloneNode(true),extra=s.item().cloneNode(true);
  native.append(copy);const other=s.D.createElement('div');other.setAttribute('slot','devvit-context-actions');other.append(extra);
  portal.append(native,other);s.D.body.append(portal);s.download.dedupe();
  assert.equal(portal.querySelectorAll('[data-rt-download="item"]').length,1);assert.equal(native.querySelectorAll('[data-rt-download="item"]').length,1);
});

test('gallery and video rows offer all images and quality choices, then send one download request',async t=>{
  const gallery=ui(t,{type:'gallery',extra:'<gallery-carousel><li slot="page-1"><img src="https://i.redd.it/one.jpeg" width="10" height="20"></li><li slot="page-2"><img src="https://i.redd.it/two.jpeg" width="20" height="30"></li></gallery-carousel>'});
  gallery.action().querySelector('button').click();
  assert.deepEqual([...gallery.panel().querySelectorAll('[role="menuitem"]')].map(node=>node.querySelector('.text-body-2').textContent),['All images','Image 1','Image 2']);
  gallery.panel().querySelectorAll('[role="menuitem"]')[0].click();await flush();
  assert.equal(gallery.calls.length,1);assert.deepEqual(plain(gallery.calls[0].files.map(file=>file.filename)),['A test - image-1.jpeg','A test - image-2.jpeg']);
  assert.equal(gallery.action().hasAttribute('open'),false);assert.equal(gallery.panel().querySelectorAll('[role="menuitem"]').length,0);assert.equal(gallery.action().querySelector('button').getAttribute('aria-expanded'),'false');
  const video=ui(t,{type:'video',extra:`<shreddit-player packaged-media-json='${videoJson([['https://packaged-media.redd.it/v/pb/m2-res_480p.mp4',854,480,500000],['https://packaged-media.redd.it/v/pb/m2-res_720p.mp4',1280,720,1200000]])}'></shreddit-player>`});
  video.action().querySelector('button').click();
  const rows=[...video.panel().querySelectorAll('[role="menuitem"]')];
  assert.deepEqual(rows.map(node=>node.querySelector('.text-body-2').textContent),['720p','480p']);
  rows[0].click();await flush();
  assert.equal(video.calls[0].files[0].filename,'A test - image-720p.mp4');
});

test('an NSFW video without packaged JSON offers Reddit’s direct preview MP4',async t=>{
  const s=ui(t,{type:'video',extra:'<shreddit-player></shreddit-player>'});
  assert.equal(s.action(),null,'wait for a source before showing the action');
  const player=s.post.querySelector('shreddit-player'),shadow=player.attachShadow({mode:'open'});
  shadow.innerHTML='<shreddit-media-ui preview="https://v.redd.it/abc/CMAF_96.mp4"></shreddit-media-ui>';
  s.download.sync();
  s.action().querySelector('button').click();
  const rows=[...s.panel().querySelectorAll('[role="menuitem"]')];
  assert.deepEqual(rows.map(node=>node.querySelector('.text-body-2').textContent),['Video']);
  rows[0].click();await flush();
  assert.equal(s.calls[0].files[0].url,'https://v.redd.it/abc/CMAF_96.mp4');
  assert.equal(s.calls[0].files[0].filename,'A test - image-video.mp4');
});
test('a missing source is not offered, and a failed worker shows an error',async t=>{
  const empty=ui(t,{type:'video',extra:'<shreddit-player></shreddit-player>'});
  assert.equal(empty.item(),null,'no download row without media');
  assert.equal(empty.action(),null,'no action-bar button without media');
  assert.equal(empty.D.body.textContent.includes('Try again'),false);
  const failed=ui(t,{read:async()=>{throw Error('Worker unavailable');}});
  failed.action().querySelector('button').click();failed.panel().querySelectorAll('[role="menuitem"]')[0].click();await flush();
  assert.ok(failed.panel());assert.equal(failed.panel().querySelector('[data-rt-download="error"]').textContent,'Worker unavailable');
  assert.equal(failed.panel().getAttribute('aria-busy'),null);
});

test('keyboard navigation stays inside the download menu and Escape returns to the button',async t=>{
  const s=ui(t),button=s.action().querySelector('button');
  button.click();
  const row=s.panel().querySelector('[role="menuitem"]');assert.ok(row);assert.equal(row.querySelector('.text-body-2').textContent,'Original image');
  row.dispatchEvent(new s.W.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
  assert.equal(s.action().hasAttribute('open'),false);assert.equal(s.panel().querySelectorAll('[role="menuitem"]').length,0);assert.equal(button.getAttribute('aria-expanded'),'false');
});

test('unsupported posts get no download control and sync is idempotent',t=>{
  const s=ui(t,{type:'link'});
  assert.equal(s.action(),null);assert.equal(s.item(),null);
  const image=ui(t);
  image.download.sync();image.download.sync();
  assert.equal(image.shadow.querySelectorAll('[data-rt-download="action"]').length,1);
});

test('defaultRead accepts callback and promise messaging APIs',async t=>{
  const dom=new JSDOM('<html><body></body></html>',{url:'https://www.reddit.com/',runScripts:'outside-only',pretendToBeVisual:true}),W=dom.window;t.after(()=>W.close());
  for(const file of ['download-model.js','download-ui.js'])W.eval(read(file));
  let callback;
  W.chrome={runtime:{lastError:undefined,sendMessage:(message,cb)=>{callback=cb;return undefined;}}};
  const pending=W.RTDownloadUI.defaultRead({action:'download',files:[]});
  callback({ok:true,files:[]});
  assert.deepEqual(plain(await pending),{ok:true,files:[]});
  W.chrome.runtime.sendMessage=async()=>({ok:true,files:[1]});
  assert.deepEqual(plain(await W.RTDownloadUI.defaultRead({action:'download',files:[]})),{ok:true,files:[1]});
  W.chrome.runtime.sendMessage=async()=>({ok:false,error:'No worker'});
  await assert.rejects(()=>W.RTDownloadUI.defaultRead({action:'download',files:[]}),/No worker/);
});

function broker(download,{callback=false,noDownloads=false}={}){
  let listener;const downloads=[];
  const chrome={runtime:{id:'extension',onMessage:{addListener(fn){listener=fn;}}},downloads:noDownloads?undefined:{download:(options,cb)=>{downloads.push(options);if(callback){setTimeout(()=>cb(7),0);return;}return download?download(options):downloads.length;}}};
  const context=vm.createContext({chrome,URL,Set,Map,Number,String,Array,Object,JSON,Math,Error,Promise,setTimeout});
  for(const file of ['download-model.js','download-broker.js'])vm.runInContext(read(file),context);
  return {B:context.RTDownloadBroker,downloads,listener};
}
const sender={id:'extension',frameId:0,url:'https://www.reddit.com/r/Alpha/'};
const files=[{url:'https://i.redd.it/abc.jpeg',filename:'alpha-image.jpeg'}];

test('the worker validates the sender, origin, media host and filename before downloading',async()=>{
  const {B,downloads}=broker();
  const result=await B.handle({scope:'rt-download',files},sender);
  assert.equal(result.ok,true);assert.deepEqual(plain(result.files),[{ok:true,id:1}]);
  assert.deepEqual(plain(downloads[0]),{url:'https://i.redd.it/abc.jpeg',filename:'alpha-image.jpeg',conflictAction:'uniquify',saveAs:false});
  await assert.rejects(()=>B.handle({scope:'rt-download',files},{...sender,id:'other'}),/Invalid sender/);
  await assert.rejects(()=>B.handle({scope:'rt-download',files},{...sender,frameId:2}),/Invalid sender/);
  await assert.rejects(()=>B.handle({scope:'rt-download',files},{...sender,url:'https://evil.example/'}),/Invalid message origin/);
  await assert.rejects(()=>B.handle({scope:'rt-download',files:[]},sender),/Invalid media download/);
  await assert.rejects(()=>B.handle({scope:'rt-download',files:Array.from({length:21},()=>files[0])},sender),/Invalid media download/);
  const invalid=await B.handle({scope:'rt-download',files:[{url:'https://evil.example/abc.jpeg',filename:'a.jpeg'}]},sender);
  assert.equal(invalid.ok,false);assert.match(invalid.files[0].error,/Invalid media download/);
  const path=await B.handle({scope:'rt-download',files:[{url:files[0].url,filename:'../alpha.jpeg'}]},sender);
  assert.equal(path.ok,false);
});

test('a partial gallery download reports the failure without losing the files that started',async()=>{
  const {B}=broker(options=>options.filename.startsWith('two')?Promise.reject(Error('blocked')):1);
  const result=await B.handle({scope:'rt-download',files:[{url:'https://i.redd.it/one.jpeg',filename:'one.jpeg'},{url:'https://i.redd.it/two.jpeg',filename:'two.jpeg'}]},sender);
  assert.equal(result.ok,false);assert.deepEqual(plain(result.files.map(file=>file.ok)),[true,false]);assert.equal(result.files[1].error,'blocked');
});

test('callback-style download APIs and a missing downloads API are handled',async()=>{
  const callback=broker(null,{callback:true});
  assert.deepEqual(plain(await callback.B.handle({scope:'rt-download',files},sender)),{ok:true,files:[{ok:true,id:7}]});
  const missing=broker(null,{noDownloads:true});
  const result=await missing.B.handle({scope:'rt-download',files},sender);
  assert.equal(result.ok,false);assert.match(result.files[0].error,/Downloads are unavailable/);
});
