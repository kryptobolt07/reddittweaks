const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
function setup(t){
 const W=new JSDOM('<!doctype html><body></body>',{url:'https://www.reddit.com/r/example/comments/abc12/title/',runScripts:'outside-only'}).window;t.after(()=>W.close());const writes=[],shares=[];
 Object.defineProperty(W.navigator,'clipboard',{value:{writeText(value){assert.equal(this,W.navigator.clipboard);writes.push(value);return Promise.resolve();}}});
 W.navigator.share=function(data){assert.equal(this,W.navigator);shares.push(data);return Promise.resolve();};
 W.eval(fs.readFileSync('extension/post-model.js','utf8'));W.eval(fs.readFileSync('extension/share-links-page.js','utf8'));
 return {W,writes,shares,clean:W.RTPostModel.cleanShareUrl,toggle:value=>W.document.dispatchEvent(new W.CustomEvent('rt-clean-share-settings',{detail:value}))};
}
test('clean links preserve canonical post/comment targets and remove sharing identifiers without network reads',t=>{
 const {clean}=setup(t);
 assert.equal(clean('https://www.reddit.com/r/example/comments/abc12/title/?utm_source=share&utm_medium=web3x&share_id=secret&rdt=8'),'https://www.reddit.com/r/example/comments/abc12/title/');
 assert.equal(clean('https://old.reddit.com/r/example/comments/abc12/title/19rktoupyflj9/?context=3&share_id=token#share'),'https://www.reddit.com/r/example/comments/abc12/title/19rktoupyflj9/');
 assert.equal(clean('https://redd.it/abc12?utm_source=share'),'https://www.reddit.com/comments/abc12/');
 assert.equal(clean('https://www.reddit.com/r/example/search/?q=cats&sort=new&utm_source=share&share_id=token'),'https://www.reddit.com/r/example/search/?q=cats&sort=new');
 for(const input of ['A message: https://www.reddit.com/r/example/?share_id=token',' https://www.reddit.com/r/example/','https://reddit.com.evil.test/comments/abc12/?share_id=x','https://user:password@www.reddit.com/comments/abc12/','https://example.test/?share_id=keep','javascript:alert(1)',null])assert.equal(clean(input),input);
});
test('opaque Reddit share links use only a matching source permalink; unrelated short links stay untouched',t=>{
 const {clean}=setup(t),short='https://www.reddit.com/r/example/s/opaque?share_id=token';
 assert.equal(clean(short,'/r/example/comments/abc12/title/'),'https://www.reddit.com/r/example/comments/abc12/title/');
 for(const canonical of ['', '/r/other/comments/abc12/title/','https://evil.test/r/example/comments/abc12/title/','https://name:secret@www.reddit.com/r/example/comments/abc12/title/'])assert.equal(clean(short,canonical),short);
});
test('native clipboard and Web Share preserve their feedback promises and respect live opt-out',async t=>{
 const {W,writes,shares,toggle}=setup(t),dirty='https://www.reddit.com/r/example/comments/abc12/title/?share_id=token';
 await W.navigator.clipboard.writeText(dirty);assert.equal(writes.at(-1),dirty);toggle(true);await W.navigator.clipboard.writeText(dirty);assert.equal(writes.at(-1),'https://www.reddit.com/r/example/comments/abc12/title/');
 await W.navigator.share({title:'A title',url:dirty});assert.equal(shares.at(-1).title,'A title');assert.equal(shares.at(-1).url,'https://www.reddit.com/r/example/comments/abc12/title/');
 toggle(false);await W.navigator.clipboard.writeText(dirty);assert.equal(writes.at(-1),dirty);
});
test('native Share captures a comment permalink before a detached Copy link menu writes an opaque URL',async t=>{
 const {W,writes,toggle}=setup(t);toggle(true);
 W.document.body.innerHTML='<shreddit-comment permalink="/r/example/comments/abc12/title/c1/"><shreddit-comment-share-button permalink="/r/example/comments/abc12/title/c1/"><button>Share</button></shreddit-comment-share-button></shreddit-comment>';
 W.document.querySelector('button').click();await W.navigator.clipboard.writeText('https://www.reddit.com/r/example/s/opaque?utm_source=share');assert.equal(writes.at(-1),'https://www.reddit.com/r/example/comments/abc12/title/c1/');
 await W.navigator.clipboard.writeText('https://www.reddit.com/r/example/s/other');assert.equal(writes.at(-1),'https://www.reddit.com/r/example/s/other','share intent is consumed once');
 W.document.querySelector('button').click();W.Date.now=()=>Date.now()+16000;await W.navigator.clipboard.writeText('https://www.reddit.com/r/example/s/expired');assert.equal(writes.at(-1),'https://www.reddit.com/r/example/s/expired');
});
test('settings delivery is independent of discovery, handles startup order, and rejects stale initial preferences',async t=>{
 const {W,toggle,writes}=setup(t);let receive,resolve;
 W.chrome={runtime:{id:'test',onMessage:{addListener:fn=>receive=fn},sendMessage:()=>new Promise(r=>resolve=r)}};
 W.eval(fs.readFileSync('extension/share-links-settings.js','utf8'));
 receive({scope:'rt-posts',action:'settings-changed',settings:{postDiscovery:false,cleanShareLinks:true}});resolve({ok:true,settings:{cleanShareLinks:false}});await new Promise(r=>setImmediate(r));
 const dirty='https://www.reddit.com/comments/abc12/?share_id=secret';await W.navigator.clipboard.writeText(dirty);assert.equal(writes.at(-1),'https://www.reddit.com/comments/abc12/');
 toggle(false);W.document.dispatchEvent(new W.CustomEvent('rt-clean-share-ready'));await W.navigator.clipboard.writeText(dirty);assert.equal(writes.at(-1),'https://www.reddit.com/comments/abc12/','late page-world initialization receives the saved preference');
});

test('native promise-backed ClipboardItem writes keep user activation and clean the generated share URL',async t=>{
 const W=new JSDOM('<!doctype html><body></body>',{url:'https://www.reddit.com/r/example/comments/abc12/title/',runScripts:'outside-only'}).window;t.after(()=>W.close());
 W.Blob=Blob;W.ClipboardItem=class{constructor(data,options){this.data=data;this.types=Object.keys(data);this.presentationStyle=options?.presentationStyle || 'unspecified';}getType(type){return Promise.resolve(this.data[type]);}};
 let writeItems,writes=0;const originalPromise=Promise.resolve();
 Object.defineProperty(W.navigator,'clipboard',{value:{write(items){assert.equal(this,W.navigator.clipboard);writes++;writeItems=items;return originalPromise;}}});
 W.eval(fs.readFileSync('extension/post-model.js','utf8'));W.eval(fs.readFileSync('extension/share-links-page.js','utf8'));W.document.dispatchEvent(new W.CustomEvent('rt-clean-share-settings',{detail:true}));
 W.document.body.innerHTML='<shreddit-post permalink="/r/example/comments/abc12/title/"><button>Share</button></shreddit-post>';W.document.querySelector('button').click();
 let resolve;const text=new Promise(r=>resolve=r),item=new W.ClipboardItem({'text/plain':text.then(value=>new Blob([value],{type:'text/plain'}))});
 const result=W.navigator.clipboard.write([item]);assert.equal(result,originalPromise);assert.equal(writes,1,'the native write runs synchronously within the click activation');
 resolve('https://www.reddit.com/r/example/s/opaque?share_id=tracking');assert.equal(await (await writeItems[0].getType('text/plain')).text(),'https://www.reddit.com/r/example/comments/abc12/title/');
 const image=new W.ClipboardItem({'image/png':new Blob(['image'])});W.navigator.clipboard.write([image]);assert.equal(writeItems[0],image,'image and rich clipboard payloads are untouched');
 W.document.dispatchEvent(new W.CustomEvent('rt-clean-share-settings',{detail:false}));W.navigator.clipboard.write([item]);assert.equal(writeItems[0],item,'opt-out passes the original item through');
});
