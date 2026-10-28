const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
// Mirrors live Reddit thread markup (2026-10): deleted/removed comments keep a
// plain <p> notice under details; normal comments use *-post-rtjson-content.
const thread=`<main><shreddit-comment-tree>
<shreddit-comment thingid="t1_norm1" postid="t3_abc12" author="Alice"><details open><summary><div slot="commentAvatar"><span avatar><svg class="default"></svg></span></div><div slot="commentMeta"><div class="author-name-meta"><a href="https://www.reddit.com/user/Alice/" class="native-author">Alice</a></div><div class="row"><shreddit-comment-badges></shreddit-comment-badges></div></div></summary><div slot="comment" id="t1_norm1-comment-rtjson-content"><div id="t1_norm1-post-rtjson-content" class="md text-14 native-body"><p class="native-p">Hello there</p></div></div></details></shreddit-comment>
<shreddit-comment thingid="t1_gone1" postid="t3_abc12" author="[deleted]" is-comment-deleted><details><summary><div slot="commentAvatar"><div><span avatar><svg class="default"></svg></span></div></div><div slot="commentMeta"><div class="author-name-meta"><faceplate-tracker><span dir="auto">[deleted]</span></faceplate-tracker></div><div class="row"><shreddit-comment-badges></shreddit-comment-badges></div></div></summary><div><div><div><div class="notice"><p>Comment deleted by user</p></div></div></div></div>
 <div id="comment-children"><shreddit-comment thingid="t1_kid1" postid="t3_abc12" author="[deleted]" collapsed><details><summary><div slot="commentMeta"><span>[deleted]</span></div></summary><div class="notice"><p>Comment removed by moderator</p></div></details></shreddit-comment></div>
</details></shreddit-comment>
<shreddit-comment thingid="t1_late1" postid="t3_abc12" author="[deleted]"><details><summary><div slot="commentMeta"></div></summary><div class="notice"><p>[deleted]</p></div></details></shreddit-comment>
</shreddit-comment-tree></main>`;
const archived=(id,body,extra={})=>({id,author:'Original'+id,body,created_utc:1700000000,link_id:'t3_abc12',parent_id:'t3_abc12',retrieved_on:1700086400,...extra});
function setup({url='https://www.reddit.com/r/example/comments/abc12/title/',settings={postDiscovery:true,archiveDiscovery:true,restoreDeletedContent:true},archive,avatar=async()=>({avatar:'https://styles.redditmedia.com/t5_x/styles/profileIcon_a.png'})}={}){
 const dom=new JSDOM(thread,{url,runScripts:'outside-only'}),W=dom.window,calls=[];
 W.chrome={runtime:{id:'own',onMessage:{addListener(){},removeListener(){}},sendMessage:async()=>({ok:true})}};W.RTThreadRestoreDisabled=true;
 for(const file of ['post-model.js','post-discovery.js','thread-restore.js'])W.eval(fs.readFileSync('extension/'+file,'utf8'));
 const avatarCalls=[];const r=new W.RTThreadRestore.ThreadRestore({observe:false,retryMs:5,reddit:async message=>{avatarCalls.push(message);return avatar(message);},settings:async()=>settings,archive:async message=>{calls.push(message);return archive?archive(message):{ok:true,posts:message.ids.map(id=>archived(id.slice(3),id==='t1_late1'?'[deleted]':'Original words of '+id+'\n\nSecond paragraph'))}}});
 return {W,r,calls,avatarCalls,doc:W.document};
}
const comment=(doc,id)=>doc.querySelector(`shreddit-comment[thingid="${id}"]`);
const settle=()=>new Promise(r=>setTimeout(r,20));
test('deleted and removed comment notices show archived text with Reddit body classes and a cue',async()=>{
 const {r,calls,doc}=setup();await r.ready;await settle();
 assert.equal(calls.length,1,'one batched archive request');assert.equal(calls[0].postId,'abc12');assert.deepEqual([...calls[0].ids].sort(),['t1_gone1','t1_kid1','t1_late1']);
 const gone=comment(doc,'t1_gone1'),body=gone.querySelector('.notice');
 assert.equal(body.querySelector('[data-rt-recovered-text]').className,'md text-14 native-body');assert.equal(body.querySelectorAll('p').length,2);assert.equal(body.querySelector('p').className,'native-p');assert.match(body.textContent,/Original words of t1_gone1/);
 const badge=gone.querySelector('[slot="commentMeta"] [data-rt-source]');assert.match(badge.title,/Deleted by its author on Reddit · Text from an Arctic Shift snapshot from .* · Originally posted by u\/Originalgone1/);assert.equal(badge.parentElement.className,'row');
 const kid=comment(doc,'t1_kid1');assert.match(kid.querySelector('.notice').textContent,/Original words of t1_kid1/);assert.match(kid.querySelector('[data-rt-source]').title,/^Removed by moderators/);assert.equal(kid.querySelector(':scope > details').open,true,'restored comments open so the text is visible');
 assert.equal(gone.querySelector(':scope > details > div .notice').textContent.includes('t1_kid1'),false,'a parent never takes a reply’s text');
 assert.equal(comment(doc,'t1_norm1').querySelector('p').textContent,'Hello there','normal comments are untouched');
 assert.equal(comment(doc,'t1_late1').querySelector('p').textContent,'[deleted]','an archive captured after deletion changes nothing');
 await r.scan();assert.equal(calls.length,1,'restored comments are not requested again');
});
test('nothing is requested without both archive opt-ins, and opting out restores Reddit’s notices',async()=>{
 const off=setup({settings:{postDiscovery:true,archiveDiscovery:true,restoreDeletedContent:false}});await off.r.ready;await settle();assert.equal(off.calls.length,0);
 const {r,doc}=setup();await r.ready;await settle();assert.match(comment(doc,'t1_gone1').textContent,/Original words/);
 r.setSettings({postDiscovery:true,archiveDiscovery:false,restoreDeletedContent:true});
 assert.equal(comment(doc,'t1_gone1').querySelector('.notice p').textContent,'Comment deleted by user');assert.equal(comment(doc,'t1_gone1').querySelector(':scope > details').open,false,'opt-out collapses it again');assert.equal(doc.querySelector('[data-rt-source]'),null);
});
test('only comments of the open post on post pages are considered',async()=>{
 const profile=setup({url:'https://www.reddit.com/user/Example/'});await profile.r.ready;await settle();assert.equal(profile.calls.length,0);
 const {r,calls,doc}=setup();comment(doc,'t1_gone1').setAttribute('postid','t3_other');await r.ready;await settle();assert.equal(calls[0].ids.includes('t1_gone1'),false);
});
test('a rate-limited archive retries the same comments later',async()=>{
 let first=true;const {r,calls,doc}=setup({archive:message=>{if(first){first=false;throw Object.assign(Error('Archive rate limit reached.'),{code:'rate-limited'});}return {ok:true,posts:message.ids.map(id=>archived(id.slice(3),'Recovered '+id))};}});
 await r.ready;await settle();await new Promise(res=>setTimeout(res,60));assert.equal(calls.length,2);assert.match(comment(doc,'t1_gone1').textContent,/Recovered t1_gone1/);
});
test('newly loaded replies are picked up on the next scan',async()=>{
 const {r,calls,doc,W}=setup();await r.ready;await settle();
 const extra=doc.createElement('shreddit-comment');extra.setAttribute('thingid','t1_more1');extra.setAttribute('postid','t3_abc12');extra.innerHTML='<details><summary><div slot="commentMeta"></div></summary><div class="notice"><p>Comment deleted by user</p></div></details>';doc.querySelector('shreddit-comment-tree').append(extra);
 await r.scan();await settle();assert.equal(calls.length,2);assert.deepEqual([...calls[1].ids],['t1_more1']);assert.match(extra.textContent,/Original words of t1_more1/);
});

test('restored comments show the original author linked to their profile and their Reddit picture, marked as archived',async()=>{
 const {r,doc,avatarCalls}=setup();await r.ready;await settle();
 const gone=comment(doc,'t1_gone1'),link=gone.querySelector('.author-name-meta a[data-rt-archived-author]');
 assert.equal(link.textContent,'Originalgone1');assert.equal(new URL(link.href).pathname,'/user/Originalgone1/');assert.match(link.className,/native-author/);assert.match(link.className,/rt-archived-author/);assert.match(link.title,/Arctic Shift snapshot/);
 const img=gone.querySelector('[slot="commentAvatar"] [avatar] img');assert.equal(img.src,'https://styles.redditmedia.com/t5_x/styles/profileIcon_a.png');assert.equal(img.referrerPolicy,'no-referrer');assert.equal(gone.querySelector('[avatar] svg'),null);
 assert.ok(avatarCalls.some(c=>c.action==='user-avatar' && c.username==='Originalgone1'));
 r.setSettings({postDiscovery:true,archiveDiscovery:false,restoreDeletedContent:true});
 assert.equal(gone.querySelector('.author-name-meta span[dir]').textContent,'[deleted]');assert.ok(gone.querySelector('[avatar] svg.default'),'the default avatar returns');
});
test('no picture keeps Reddit’s default avatar while the name is still restored',async()=>{
 const {r,doc}=setup({avatar:async()=>({avatar:''})});await r.ready;await settle();
 const gone=comment(doc,'t1_gone1');assert.equal(gone.querySelector('[data-rt-archived-author]').textContent,'Originalgone1');assert.ok(gone.querySelector('[avatar] svg.default'));
});

const removedPost=`<shreddit-post id="t3_abc12" author="Poster" post-title="[ Removed by moderator ]" post-type="link"><span slot="credit-bar"><span><shreddit-post-overflow-menu></shreddit-post-overflow-menu></span></span><h1 slot="title">[ Removed by moderator ]</h1><div slot="post-removed-banner">Sorry, this post has been removed by the moderators.</div></shreddit-post>`;
function postSetup(record,extra={}){
 const e=setup({archive:message=>message.action==='archive-ids'?{ok:true,posts:[{id:'abc12',author:'Poster',title:'Original title',selftext:'',url:'https://i.redd.it/abc.jpeg',created_utc:1700000000,retrieved_on:1700000100,...record}]}:{ok:true,posts:[]},...extra});
 e.doc.querySelector('main').insertAdjacentHTML('afterbegin',removedPost);return e;
}
test('a removed post opened in any way gets its title, image and status cue back inside Reddit’s post element',async()=>{
 const {r,doc,calls}=postSetup({});await r.ready;await settle();
 const post=doc.querySelector('shreddit-post');assert.equal(post.querySelector('[slot="title"]').textContent,'Original title');
 const img=post.querySelector('.rt-archived-media img');assert.equal(img.src,'https://i.redd.it/abc.jpeg');assert.equal(img.referrerPolicy,'no-referrer');
 const badge=post.querySelector('[data-rt-source]');assert.equal(badge.dataset.state,'removed');assert.equal(badge.querySelector('svg').dataset.icon,'removed');assert.match(badge.title,/Removed by moderators on Reddit · Restored from an Arctic Shift snapshot/);assert.equal(badge.parentElement.querySelector('shreddit-post-overflow-menu')!==null,true);
 assert.ok(calls.some(c=>c.action==='archive-ids' && c.ids[0]==='abc12'));assert.equal(post.hasAttribute('data-rt-settled'),true);assert.equal(post.hasAttribute('data-rt-pending'),false);
 r.setSettings({postDiscovery:true,archiveDiscovery:false,restoreDeletedContent:true});
 assert.equal(post.querySelector('[slot="title"]').textContent,'[ Removed by moderator ]');assert.equal(post.querySelector('.rt-archived-media'),null);assert.equal(post.querySelector('[data-rt-source]'),null);
});
test('restored post text uses the formatted body; NSFW or another author’s snapshot is never shown',async()=>{
 const text=postSetup({selftext:'Hello **world**',url:''});text.doc.defaultView.eval(fs.readFileSync('extension/markdown-lite.js','utf8'));await text.r.ready;await settle();
 assert.equal(text.doc.querySelector('shreddit-post [data-rt-recovered-text].rt-recovered-md strong').textContent,'world');
 const nsfw=postSetup({over_18:true,selftext:'secret'});await nsfw.r.ready;await settle();const post=nsfw.doc.querySelector('shreddit-post');assert.equal(post.querySelector('.rt-archived-media'),null);assert.equal(post.textContent.includes('secret'),false);
 const other=postSetup({author:'Someone'});await other.r.ready;await settle();assert.equal(other.doc.querySelector('shreddit-post [slot="title"]').textContent,'[ Removed by moderator ]');assert.equal(other.doc.querySelector('shreddit-post').hasAttribute('data-rt-settled'),true,'the skeleton always ends');
});
test('deleted comments show a skeleton while the archive is asked, then settle either way',async()=>{
 let release;const {r,doc}=setup({archive:()=>new Promise(res=>release=res)});await r.ready;await settle();
 const gone=comment(doc,'t1_gone1');assert.equal(gone.hasAttribute('data-rt-pending'),true);assert.equal(gone.querySelector('.notice p').dataset.rtNotice,'true');
 release({ok:true,posts:[]});await settle();assert.equal(gone.hasAttribute('data-rt-pending'),false);assert.equal(gone.hasAttribute('data-rt-settled'),true);assert.equal(gone.querySelector('.notice p').textContent,'Comment deleted by user','nothing archived: Reddit’s notice returns');
});
