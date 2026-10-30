const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {JSDOM}=require('jsdom');
function load(url='https://www.reddit.com/user/Example/submitted/'){
  const dom=new JSDOM('<body></body>',{url,runScripts:'outside-only'});dom.window.eval(fs.readFileSync('extension/feed-filters.js','utf8'));return {W:dom.window,F:dom.window.RTFeedFilters};
}
test('postType subdivides text, media and link posts from raw fields',()=>{
 const Model=(()=>{const ctx=vm.createContext({URL});vm.runInContext(fs.readFileSync('extension/post-model.js','utf8'),ctx);return ctx.RTPostModel;})();
 const type=extra=>Model.normalizePost({id:'a1',author:'Example',created_utc:1700000000,...extra},{source:'arctic-shift'}).postType;
 assert.equal(type({is_self:true,poll_data:{options:[]}}),'poll');assert.equal(type({is_self:true,selftext:'hello'}),'text');
 assert.equal(type({is_self:true,media_metadata:{abc:{e:'Image'}},selftext:'x'}),'textmedia');assert.equal(type({is_self:true,selftext:'look ![img](https://preview.redd.it/a.png)'}),'textmedia');
 assert.equal(type({url:'https://i.redd.it/abc.gif'}),'gif');assert.equal(type({url:'https://example.com/a.gif?x=1'}),'gif');assert.equal(type({post_hint:'image',url:'https://i.redd.it/abc.jpg',preview:{images:[{variants:{gif:{source:{}}}}]}}),'gif');
 assert.equal(type({url:'https://example.com/a',preview:{images:[{source:{url:'https://preview.redd.it/a.gif?s=1'}}]}}),'gif');assert.equal(type({is_video:true,media:{reddit_video:{is_gif:true}}}),'gif');
 assert.equal(type({url:'https://v.redd.it/xyz'}),'video');assert.equal(type({post_hint:'hosted:video'}),'video');
 assert.equal(type({post_hint:'rich:video',url:'https://www.youtube.com/watch?v=1'}),'embed');assert.equal(type({url:'https://vimeo.com/1'}),'embed');assert.equal(type({media:{oembed:{provider_name:'Streamable'}},url:'https://example.com/x'}),'embed');
 assert.equal(type({url:'https://example.com/article'}),'link');assert.equal(type({is_gallery:true}),'gallery');assert.equal(type({crosspost_parent_list:[{}]}),'crosspost');
 assert.equal(type({post_hint:'image',url:'https://i.redd.it/abc.jpg'}),'image');
 for(const id of ['textmedia','poll','gif','embed'])assert.equal(Model.normalizePost(Model.normalizePost({id:'a1',author:'Example',created_utc:1700000000,postType:id},{source:'arctic-shift'}),{source:'arctic-shift'}).postType,id);
});
test('post types: ten ids in three sections, old values still parse',t=>{
  const {W,F}=load();t.after(()=>W.close());
  assert.deepEqual(JSON.parse(JSON.stringify(F.types)),['text','textmedia','poll','image','gif','video','gallery','link','embed','crosspost']);
  assert.deepEqual(JSON.parse(JSON.stringify(F.typeSections.map(s=>[s.label,s.types]))),[['Text',['text','textmedia','poll']],['Media',['image','gif','video','gallery']],['Links',['link','embed','crosspost']]]);
  assert.deepEqual(JSON.parse(JSON.stringify(F.types.map(t=>F.typeLabels[t]))),['Text','Text with media','Polls','Images','GIFs','Videos','Galleries','Links','Embedded media','Crossposts']);
  assert.deepEqual(JSON.parse(JSON.stringify(F.parse('?rt_type=text,image,video,gallery,link,crosspost').types)),['text','image','video','gallery','link','crosspost']);
  assert.deepEqual(JSON.parse(JSON.stringify(F.parse('?rt_type=multi_media,GIF,poll,embed,textmedia,bogus,gif').types)),['textmedia','gif','poll','embed']);
  assert.equal(F.normalizeType('multi_media'),'textmedia');assert.equal(F.normalizeType('rich:video'),'embed');assert.equal(F.normalizeType('hosted:video'),'video');assert.equal(F.normalizeType('mystery'),'');
  const p=F.predicate({...F.empty(),types:['gif','poll']});assert.equal(p({postType:'gif',kind:'post'}),true);assert.equal(p({postType:'image',kind:'post'}),false);assert.equal(p({postType:'mystery',kind:'post'}),false);
  assert.equal(F.predicate(F.empty())({postType:'mystery',kind:'post'}),true);
});
test('inferType reads native shreddit-post cards',t=>{
  const {W,F}=load();t.after(()=>W.close());
  const card=(attrs={},inner='')=>{const el=W.document.createElement('shreddit-post');for(const [k,v] of Object.entries(attrs))el.setAttribute(k,v);el.innerHTML=inner;return el;};
  for(const [kind,type] of [['text','text'],['image','image'],['gallery','gallery'],['link','link'],['multi_media','textmedia'],['video','video'],['crosspost','crosspost'],['poll','poll']])assert.equal(F.inferType(card({'post-type':kind})),type,kind);
  assert.equal(F.inferType(card({'post-type':'link'},'<shreddit-player></shreddit-player>')),'video');
  assert.equal(F.inferType(card({'post-type':'image','content-href':'https://i.redd.it/a.gif'})),'gif');assert.equal(F.inferType(card({'post-type':'link','content-href':'https://i.imgur.com/a.gif?x=1'})),'gif');
  assert.equal(F.inferType(card({'post-type':'link','domain':'youtube.com','content-href':'https://www.youtube.com/watch?v=1'})),'embed');
  assert.equal(F.inferType(card({'post-type':'link','content-href':'https://streamable.com/abc'})),'embed');assert.equal(F.inferType(card({'post-type':'link'},'<shreddit-embed></shreddit-embed>')),'embed');
  assert.equal(F.inferType(card({'post-type':'link','content-href':'https://example.com/a'})),'link');
  assert.equal(F.inferType(card({'post-type':'text'},'<shreddit-poll></shreddit-poll>')),'poll');assert.equal(F.inferType(card({'post-type':'text'},'<div slot="crosspost-content"></div>')),'crosspost');
  assert.equal(F.inferType(card({'post-type':'unheard_of'})),'');assert.equal(F.inferType(card({})),'');
  assert.equal(F.inferType(W.document.createElement('shreddit-profile-comment')),'');
  const p=F.predicate({...F.empty(),types:['text']});assert.equal(p({kind:'post',postType:F.inferType(card({'post-type':'unheard_of'}))}),false);
  assert.equal(F.predicate(F.empty())({kind:'post',postType:F.inferType(card({'post-type':'unheard_of'}))}),true);
});
test('inferType for archive post objects',t=>{
  const {W,F}=load();t.after(()=>W.close());
  for(const id of F.types)assert.equal(F.inferType({postType:id}),id);
  assert.equal(F.inferType({postType:'self'}),'text');assert.equal(F.inferType({kind:'comment',postType:'image'}),'');
  assert.equal(F.inferType({url:'https://i.redd.it/a.gif',permalink:'https://www.reddit.com/r/x/comments/abc/'}),'gif');
  assert.equal(F.inferType({url:'https://www.youtube.com/watch?v=1',permalink:'https://www.reddit.com/r/x/comments/abc/'}),'embed');
  assert.equal(F.inferType({media:[{kind:'video'}]}),'video');assert.equal(F.inferType({media:[{kind:'image',url:'https://i.redd.it/a.jpg'}]}),'image');
});
test('menu value labels and icon names',t=>{
  const {W,F}=load();t.after(()=>W.close());
  const v=s=>F.valueLabels({...F.empty(),...s},new Date(2026,9,31));
  assert.deepEqual({...v({})},{date:'Any time',type:'All',sub:'All'});
  assert.equal(v({date:{preset:'year'}}).date,'Past year');assert.equal(v({date:{from:'2026-10-01',to:'2026-10-20'}}).date.replace(/ /g,' '),'Oct 1 – Oct 20');
  assert.equal(v({types:['image']}).type,'Images');assert.equal(v({types:['image','gif','poll']}).type,'3 types');
  assert.equal(v({subreddits:['announcements']}).sub,'r/announcements');assert.equal(v({subreddits:['a','b','c']}).sub,'3 communities');assert.equal(v({subreddits:['u_spez']}).sub,'u/spez');
  for(const name of ['text-post','collection','list-bulleted','image','gif','video','gallery','link','browser','rotate','community-fill','profile-fill','card','calendar','archive'])assert.ok(F.svgIcon(name),name);
  assert.equal(F.svgIcon('nonsense'),null);assert.equal(F.svgIcon('gif').textContent,'GIF');assert.equal(F.svgIcon('gallery').querySelectorAll('path').length,2);assert.equal(F.svgIcon('calendar').getAttribute('width'),'20');
});
