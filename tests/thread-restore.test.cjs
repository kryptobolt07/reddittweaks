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
 for(const file of ['post-model.js','post-discovery.js','thread-restore.js']){W.chrome.runtime.id=file==='post-discovery.js'?'':'own';W.eval(fs.readFileSync('extension/'+file,'utf8'));}W.chrome.runtime.id='own';
 const avatarCalls=[];const r=new W.RTThreadRestore.ThreadRestore({observe:false,retryMs:5,reddit:async message=>{avatarCalls.push(message);return avatar(message);},settings:async()=>settings,archive:async message=>{calls.push(message);return archive?archive(message):{ok:true,posts:message.ids.map(id=>archived(id.slice(3),id==='t1_late1'?'[deleted]':'Original words of '+id+'\n\nSecond paragraph'))}}});
 return {W,r,calls,avatarCalls,doc:W.document};
}
const comment=(doc,id)=>doc.querySelector(`shreddit-comment[thingid="${id}"]`);
const settle=()=>new Promise(r=>setTimeout(r,20));
test('deleted and removed comment notices show archived text with Reddit body classes and a cue',async()=>{
 const {r,calls,doc}=setup();await r.ready;await settle();
 assert.equal(calls.length,1,'one batched archive request');assert.equal(calls[0].postId,'abc12');assert.deepEqual([...calls[0].ids].sort(),['t1_gone1','t1_kid1','t1_late1']);
 const gone=comment(doc,'t1_gone1'),body=gone.querySelector('.notice');
 assert.equal(body.querySelector('[data-rt-recovered-text]').className,'md text-14 native-body rt-recovered-md','restored comments get the markdown/spoiler styling scope');assert.equal(body.querySelectorAll('p').length,2);assert.equal(body.querySelector('p').className,'native-p');assert.match(body.textContent,/Original words of t1_gone1/);
 const badge=gone.querySelector('[slot="commentMeta"] [data-rt-source]');assert.match(badge.title,/Deleted by its author on Reddit · Text from an Arctic Shift snapshot from .* · Originally posted by u\/Originalgone1/);assert.equal(badge.parentElement.className,'row');
 const kid=comment(doc,'t1_kid1');assert.match(kid.querySelector('.notice').textContent,/Original words of t1_kid1/);assert.match(kid.querySelector('[data-rt-source]').title,/^Removed on Reddit/);assert.equal(kid.querySelector(':scope > details').open,true,'restored comments open so the text is visible');
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
 assert.equal(link.textContent,'Originalgone1');assert.equal(new URL(link.href).pathname,'/user/Originalgone1/');assert.ok(link.querySelector('[data-testid="nameplate"] .truncate'),'native nameplate structure');assert.match(link.className,/text-neutral-content-strong/);assert.match(link.className,/rt-archived-author/);assert.match(link.title,/Arctic Shift snapshot/);assert.equal(gone.querySelector('.author-name-meta span[dir]')?.textContent.trim()==='[deleted]',false);
 assert.equal(new URL(gone.querySelector('[slot="commentAvatar"] a').href).pathname,'/user/Originalgone1/','avatar links to the profile like native avatars');const img=gone.querySelector('[slot="commentAvatar"] [avatar] img');assert.equal(img.src,'https://styles.redditmedia.com/t5_x/styles/profileIcon_a.png');assert.equal(img.referrerPolicy,'no-referrer');assert.equal(gone.querySelector('[avatar] svg'),null);
 assert.ok(avatarCalls.some(c=>c.action==='user-avatar' && c.username==='Originalgone1'));
 r.setSettings({postDiscovery:true,archiveDiscovery:false,restoreDeletedContent:true});
 assert.equal(gone.querySelector('.author-name-meta span[dir]').textContent,'[deleted]');assert.ok(gone.querySelector('[avatar] svg.default'),'the default avatar returns');assert.equal(gone.querySelector('[data-rt-archived-author]'),null);
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
 const badge=post.querySelector('[data-rt-source]');assert.equal(badge.dataset.state,'removed');assert.equal(badge.querySelector('svg').dataset.icon,'removed');assert.match(badge.title,/Removed on Reddit · Restored from an Arctic Shift snapshot/);assert.equal(badge.parentElement.querySelector('shreddit-post-overflow-menu')!==null,true);
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

test('a snapshot without text still restores the comment author and status cue, keeping Reddit’s notice',async()=>{
 const {r,doc}=setup({archive:message=>({ok:true,posts:message.ids.map(id=>archived(id.slice(3),'[removed]'))})});await r.ready;await settle();
 const gone=comment(doc,'t1_gone1');assert.equal(gone.querySelector('.notice p').textContent,'Comment deleted by user','no invented text');
 assert.equal(gone.querySelector('[data-rt-archived-author]').textContent,'Originalgone1');assert.match(gone.querySelector('[data-rt-source]').title,/Deleted by its author on Reddit · The Arctic Shift snapshot has no text · Originally posted by u\/Originalgone1/);
 r.setSettings({postDiscovery:true,archiveDiscovery:false,restoreDeletedContent:true});assert.equal(gone.querySelector('[data-rt-archived-author]'),null);assert.equal(gone.querySelector('.notice p').textContent,'Comment deleted by user');
});
test('a deleted post whose snapshot only names the author gets the author and its status cue',async()=>{
 const e=setup({archive:message=>message.action==='archive-ids'?{ok:true,posts:[{id:'abc12',author:'TheBrokenChad',title:'Is this legit?',selftext:'[removed]',url:'https://www.reddit.com/gallery/abc12',created_utc:1700000000}]}:{ok:true,posts:[]}});
 e.doc.querySelector('main').insertAdjacentHTML('afterbegin','<shreddit-post id="t3_abc12" author="[deleted]" post-title="Is this legit?"><span slot="credit-bar"><span class="author-cls">[deleted]</span><span><shreddit-post-overflow-menu></shreddit-post-overflow-menu></span></span><h1 slot="title">Is this legit?</h1><div slot="text-body"><p>[deleted]</p></div></shreddit-post>');
 await e.r.ready;await settle();const post=e.doc.querySelector('shreddit-post'),link=post.querySelector('[data-rt-archived-author]');
 assert.equal(link.textContent,'TheBrokenChad');assert.match(link.className,/author-cls/);assert.equal(new URL(link.href).pathname,'/user/TheBrokenChad/');
 const badge=post.querySelector('[data-rt-source]');assert.equal(badge.dataset.state,'deleted');assert.match(badge.title,/Deleted on Reddit · The Arctic Shift snapshot has nothing more · Originally posted by u\/TheBrokenChad/);
 assert.equal(post.querySelector('[slot="text-body"]').textContent,'[deleted]','nothing invented for the body');
 e.r.setSettings({postDiscovery:true,archiveDiscovery:false,restoreDeletedContent:true});assert.equal(post.querySelector('.author-cls').textContent,'[deleted]');assert.equal(post.querySelector('[data-rt-source]'),null);
});

test('a removal banner that says the author deleted the post counts as deleted, not removed',async()=>{
 const e=setup({archive:message=>message.action==='archive-ids'?{ok:true,posts:[{id:'abc12',author:'Poster',title:'Same title',selftext:'[deleted]',created_utc:1700000000}]}:{ok:true,posts:[]}});
 e.doc.querySelector('main').insertAdjacentHTML('afterbegin','<shreddit-post id="t3_abc12" author="[deleted]" post-title="Same title"><span slot="credit-bar"><span>[deleted]</span></span><h1 slot="title">Same title</h1><div slot="post-removed-banner">Sorry, this post was deleted by the person who originally posted it.</div></shreddit-post>');
 await e.r.ready;await settle();const badge=e.doc.querySelector('shreddit-post [data-rt-source]');assert.equal(badge.dataset.state,'deleted');assert.equal(badge.querySelector('svg').dataset.icon,'deleted');assert.match(badge.title,/^Deleted by its author/);
 const M=e.W.RTPostModel,div=e.doc.createElement('div');div.innerHTML='<shreddit-post><div slot="post-removed-banner">Sorry, this post has been removed by the moderators of r/x.</div></shreddit-post>';assert.equal(M.domStatus(div.firstElementChild),'removed');
});

test('early comment guard masks only each deleted comment until archive work settles, including new replies',async()=>{
 const dom=new JSDOM(thread,{url:'https://www.reddit.com/r/example/comments/abc12/title/',runScripts:'outside-only'}),W=dom.window;let settings;
 W.chrome={runtime:{id:'own',sendMessage:()=>new Promise(resolve=>settings=resolve)}};const style=W.document.createElement('style');style.textContent=fs.readFileSync('extension/post-discovery.css','utf8');W.document.head.append(style);
 W.eval(fs.readFileSync('extension/profile-notice.js','utf8'));assert.equal(W.document.querySelectorAll('[data-rt-pending]').length,0,'no restoration masking before preferences are known');
 settings({ok:true,settings:{postDiscovery:true,archiveDiscovery:true,restoreDeletedContent:true}});await settle();
 const gone=comment(W.document,'t1_gone1'),normal=comment(W.document,'t1_norm1'),meta=gone.querySelector('[slot="commentMeta"]');meta.style.backgroundColor='rgb(255, 248, 220)';assert.equal(gone.hasAttribute('data-rt-pending'),true);assert.equal(gone.querySelectorAll(':scope > details .notice > [data-rt-skeleton]').length,2,'one skeleton each for parent and reply');assert.equal(W.getComputedStyle(meta).visibility,'visible','Reddit’s selected-comment background remains painted');assert.equal(W.getComputedStyle(meta).backgroundColor,'rgb(255, 248, 220)');assert.equal(W.getComputedStyle(meta.firstElementChild).visibility,'hidden','native identity stays masked');assert.equal(W.getComputedStyle(gone.querySelector('[slot="commentAvatar"]')).visibility,'hidden');assert.equal(W.getComputedStyle(normal.querySelector('[slot="commentMeta"]')).visibility,'visible');assert.equal(normal.hasAttribute('data-rt-pending'),false);
 const late=W.document.createElement('shreddit-comment');late.setAttribute('thingid','t1_new');late.setAttribute('postid','t3_abc12');late.innerHTML='<details><summary><div slot="commentMeta">[deleted]</div></summary><div class="notice"><p>[removed]</p></div></details>';W.document.querySelector('shreddit-comment-tree').append(late);await Promise.resolve();assert.equal(late.hasAttribute('data-rt-pending'),true,'mutation microtask precedes the delayed thread scan');
 // A newer preference update cannot be undone by a stale guard settings read.
 W.RTProfileNoticeGuard.setRestoreEnabled(false);assert.equal(W.document.documentElement.hasAttribute('data-rt-restore'),false);W.close();
});

test('pending comment skeletons survive transient archive retries without flashing the native identity',async()=>{
 let reject;const {r,doc,W,calls}=setup({archive:()=>new Promise((resolve,fail)=>reject=fail)});W.eval(fs.readFileSync('extension/archive-view.js','utf8'));const style=doc.createElement('style');style.textContent=fs.readFileSync('extension/post-discovery.css','utf8');doc.head.append(style);await r.ready;await settle();
 const gone=comment(doc,'t1_gone1');assert.equal(gone.querySelectorAll('.notice > [data-rt-skeleton]').length,2);assert.equal(W.getComputedStyle(gone.querySelector('[slot="commentMeta"] > *')).visibility,'hidden');reject(Object.assign(Error('Wait'),{code:'rate-limited',retryAt:Date.now()+10000}));await settle();
 assert.equal(gone.hasAttribute('data-rt-pending'),true);assert.equal(gone.hasAttribute('data-rt-settled'),false);assert.ok(gone.querySelector('[data-rt-skeleton]'));await r.scan();assert.equal(calls.length,1,'ordinary scans do not bypass server retry backoff');r.destroy();W.close();
});

test('restored Snoovatars use Reddit headshot SVG clipping and retain an avatar placeholder during lookup',async()=>{
 let release;const {r,doc,W}=setup({avatar:()=>new Promise(resolve=>release=resolve)});await r.ready;await settle();const gone=comment(doc,'t1_gone1'),slot=gone.querySelector('[slot="commentAvatar"]');assert.equal(gone.hasAttribute('data-rt-pending'),false,'body restoration need not wait for a picture');assert.equal(slot.hasAttribute('data-rt-avatar-pending'),true);
 const url='https://cf.preview.redd.it/snoovatar/avatars/example-headshot.png?width=64&height=64&s=synthetic';release({avatar:url});await settle();const image=slot.querySelector('svg image');assert.equal(image.getAttribute('href'),url);assert.equal(image.getAttribute('height'),'100%');assert.equal(slot.querySelector('svg').getAttribute('viewBox'),'0 0 121 122');assert.equal(slot.querySelector('clipPath path').getAttribute('d').includes('59.5 122'),true);assert.equal(slot.hasAttribute('data-rt-avatar-pending'),false);r.destroy();W.close();
});

test('deleted comment Share gets its native permalink and identity without enabling votes or reply, and opt-out restores it',async()=>{
 const {r,doc,W}=setup({archive:async()=>({ok:true,posts:[]})});const gone=comment(doc,'t1_gone1');const actions=doc.createElement('shreddit-comment-action-row');actions.setAttribute('disabled','');actions.innerHTML='<button disabled upvote>Vote</button><button disabled slot="comment-reply">Reply</button><shreddit-comment-share-button ssr slot="comment-share" disabled permalink="" source-id=""><button disabled aria-disabled="true">Share</button></shreddit-comment-share-button>';gone.querySelector(':scope > details').append(actions);await r.ready;await settle();
 const share=actions.querySelector('shreddit-comment-share-button'),button=share.querySelector('button');assert.equal(share.getAttribute('permalink'),'/r/example/comments/abc12/comment/gone1/');assert.equal(share.getAttribute('source-id'),'t1_gone1');assert.equal(share.hasAttribute('disabled'),false);assert.equal(button.disabled,false);assert.equal(button.hasAttribute('aria-disabled'),false);assert.equal(actions.hasAttribute('disabled'),true);assert.equal(actions.querySelector('[upvote]').disabled,true);assert.equal(actions.querySelector('[slot="comment-reply"]').disabled,true);
 r.setSettings({postDiscovery:true,archiveDiscovery:false,restoreDeletedContent:true});assert.equal(share.hasAttribute('disabled'),true);assert.equal(button.disabled,true);assert.equal(button.getAttribute('aria-disabled'),'true');assert.equal(share.getAttribute('permalink'),'');assert.equal(share.getAttribute('source-id'),'');r.destroy();W.close();
});

test('a delayed guard settings reply cannot re-enable restoration after a newer opt-out',async()=>{
 const dom=new JSDOM(thread,{url:'https://www.reddit.com/r/example/comments/abc12/title/',runScripts:'outside-only'}),W=dom.window;let finish;W.chrome={runtime:{id:'own',sendMessage:()=>new Promise(resolve=>finish=resolve)}};W.eval(fs.readFileSync('extension/profile-notice.js','utf8'));W.RTProfileNoticeGuard.setRestoreEnabled(false);finish({ok:true,settings:{postDiscovery:true,archiveDiscovery:true,restoreDeletedContent:true}});await settle();assert.equal(W.document.documentElement.hasAttribute('data-rt-restore'),false);assert.equal(W.document.querySelector('[data-rt-pending]'),null);W.close();
});

test('native replacement comments retain Share without another archive request',async()=>{
 const {r,doc,W,calls}=setup({archive:async()=>({ok:true,posts:[]})});const gone=comment(doc,'t1_gone1'),actions=doc.createElement('shreddit-comment-action-row');actions.setAttribute('disabled','');actions.innerHTML='<shreddit-comment-share-button disabled permalink="" source-id=""><button disabled>Share</button></shreddit-comment-share-button>';gone.querySelector('details').append(actions);const replacement=gone.cloneNode(true);await r.ready;await settle();const count=calls.length;gone.replaceWith(replacement);await r.scan();const share=replacement.querySelector('shreddit-comment-share-button');assert.equal(share.hasAttribute('disabled'),false);assert.equal(share.getAttribute('source-id'),'t1_gone1');assert.equal(share.querySelector('button').disabled,false);assert.equal(calls.length,count);r.destroy();W.close();
});

test('archived link previews and gallery images restore safely without embedding external URLs',async()=>{
 const e=postSetup({url:'https://example.com/article',preview:{images:[{source:{url:'https://external-preview.redd.it/article.jpg?width=600&amp;format=pjpg'}}]}});e.W.eval(fs.readFileSync('extension/archive-view.js','utf8'));await e.r.ready;await settle();
 const post=e.doc.querySelector('shreddit-post');assert.equal(post.querySelector('.rt-archive-link-thumbnail').src,'https://external-preview.redd.it/article.jpg?width=600&format=pjpg');assert.ok(post.querySelector('[data-testid=post-thumbnail]'));e.r.destroy();e.W.close();
 const g=postSetup({url:'https://www.reddit.com/gallery/abc12',gallery_data:{items:[{media_id:'a'},{media_id:'b'}]},media_metadata:{a:{e:'Image',m:'image/jpeg',s:{u:'https://i.redd.it/a.jpg'}},b:{e:'Image',m:'image/png',s:{u:'https://i.redd.it/b.png'}}}});g.W.eval(fs.readFileSync('extension/archive-view.js','utf8'));await g.r.ready;await settle();assert.deepEqual([...g.doc.querySelectorAll('.rt-archive-media-group .preview-img')].map(img=>img.src),['https://i.redd.it/a.jpg','https://i.redd.it/b.png']);g.r.destroy();g.W.close();
});
test('restored video gives Reddit’s player the original post identity',async()=>{
 const e=postSetup({url:'https://v.redd.it/clip',is_video:true,secure_media:{reddit_video:{hls_url:'https://v.redd.it/clip/HLSPlaylist.m3u8'}}});
 e.W.eval(fs.readFileSync('extension/archive-view.js','utf8'));await e.r.ready;await settle();
 assert.equal(e.doc.querySelector('shreddit-player').getAttribute('post-id'),'t3_abc12');e.r.destroy();e.W.close();
});
test('restored comment images use validated metadata and respect post restrictions',async()=>{
 const url='https://preview.redd.it/synthetic123.jpeg?width=960&format=pjpg&s=signature';
 const archive=message=>({ok:true,posts:message.ids.map(id=>archived(id.slice(3),url,{media_metadata:{synthetic123:{e:'Image',m:'image/jpeg',s:{u:url,x:960,y:1482}}}}))});
 const e=setup({archive});e.W.eval(fs.readFileSync('extension/markdown-lite.js','utf8'));await e.r.ready;await settle();
 const body=comment(e.doc,'t1_gone1').querySelector('.notice'),img=body.querySelector('img');assert.equal(img.src,url);assert.equal(img.width,960);assert.equal(img.height,1482);assert.equal(img.referrerPolicy,'no-referrer');assert.equal(body.textContent.includes(url),false);
 e.r.setSettings({postDiscovery:true,archiveDiscovery:false,restoreDeletedContent:true});assert.equal(body.querySelector('img'),null);
 const restricted=setup({archive});restricted.W.eval(fs.readFileSync('extension/markdown-lite.js','utf8'));restricted.doc.querySelector('main').insertAdjacentHTML('afterbegin','<shreddit-post id="t3_abc12" nsfw></shreddit-post>');await restricted.r.ready;await settle();assert.equal(comment(restricted.doc,'t1_gone1').querySelector('.notice img'),null);
});
