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
