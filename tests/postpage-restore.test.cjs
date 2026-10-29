const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
// Post-page restoration hardening (plan 2026-10, workstream: post pages). Synthetic markup only.
const row=(id,text,extra='')=>`<shreddit-comment thingid="${id}" postid="t3_abc12" author="[deleted]" ${extra}><details><summary><div slot="commentAvatar"><span avatar><svg class="default"></svg></span></div><div slot="commentMeta"><div class="author-name-meta"><span dir="auto">[deleted]</span></div><div class="row"></div></div></summary><div class="notice">${text}</div></details></shreddit-comment>`;
const page=(...rows)=>`<main><shreddit-comment-tree>${rows.join('')}</shreddit-comment-tree></main>`;
const archived=(id,body,extra={})=>({id,author:'Original'+id,body,created_utc:1700000000,link_id:'t3_abc12',parent_id:'t3_abc12',retrieved_on:1700086400,...extra});
function setup({html=page(row('t1_a1','<p>Comment deleted by user</p>'),row('t1_b2','<p>Comment removed by moderator</p>')),settings={postDiscovery:true,archiveDiscovery:true,restoreDeletedContent:true},archive,reddit,glyph=true,css=false,pendingMs=60000,retryMs=5,files=[]}={}){
 const dom=new JSDOM(html,{url:'https://www.reddit.com/r/example/comments/abc12/title/',runScripts:'outside-only'}),W=dom.window,calls=[];
 W.chrome={runtime:{id:'own',onMessage:{addListener(){},removeListener(){}},sendMessage:async()=>({ok:true})}};W.RTThreadRestoreDisabled=true;
 for(const file of ['post-model.js','markdown-lite.js','archive-view.js',...(glyph?['post-discovery.js']:[]),...files,'thread-restore.js']){W.chrome.runtime.id=file==='post-discovery.js'?'':'own';W.eval(fs.readFileSync('extension/'+file,'utf8'));}W.chrome.runtime.id='own';
 if(css){const style=W.document.createElement('style');style.textContent=fs.readFileSync('extension/post-discovery.css','utf8');W.document.head.append(style);}
 const avatarCalls=[];
 const r=new W.RTThreadRestore.ThreadRestore({observe:false,retryMs,pendingMs,reddit:async message=>{avatarCalls.push(message);return reddit?reddit(message):{avatar:'https://styles.redditmedia.com/t5_x/styles/profileIcon_a.png'};},settings:async()=>settings,archive:async message=>{calls.push(message);return archive?archive(message):{ok:true,posts:message.ids.map(id=>archived(id.slice(3),'Original words of '+id))};}});
 return {W,r,calls,avatarCalls,doc:W.document};
}
const comment=(doc,id)=>doc.querySelector(`shreddit-comment[thingid="${id}"]`);
const settle=(ms=20)=>new Promise(r=>setTimeout(r,ms));

test('one failing record never aborts the batch or leaves skeletons stuck',async()=>{
 const e=setup();const real=e.r.apply.bind(e.r);e.r.apply=(record,node)=>{if(record.id==='a1')throw new Error('boom');return real(record,node);};
 await e.r.ready;await settle();
 assert.match(comment(e.doc,'t1_b2').textContent,/Original words of t1_b2/,'the next record is still applied');
 for(const id of ['t1_a1','t1_b2']){const node=comment(e.doc,id);assert.equal(node.hasAttribute('data-rt-pending'),false,id);assert.equal(node.hasAttribute('data-rt-settled'),true,id);assert.equal(node.querySelector('[data-rt-skeleton]'),null,id);assert.equal(node.querySelector('[data-rt-hold]'),null,id);}
 e.r.destroy();e.W.close();
});

test('a re-created comment element gets its archived text back without a new request',async()=>{
 const e=setup();await e.r.ready;await settle();assert.equal(e.calls.length,1);
 const old=comment(e.doc,'t1_a1');assert.match(old.textContent,/Original words of t1_a1/);
 // Reddit re-creates the element (virtualised list, re-render) with its notice again.
 const fresh=new e.W.DOMParser().parseFromString(row('t1_a1','<p>Comment deleted by user</p>'),'text/html').body.firstElementChild;
 old.replaceWith(e.doc.importNode(fresh,true));
 await e.r.scan();
 const node=comment(e.doc,'t1_a1');assert.notEqual(node,old);
 assert.match(node.textContent,/Original words of t1_a1/,'text restored from the kept record');assert.ok(node.querySelector('[data-rt-source]'));assert.equal(node.hasAttribute('data-rt-pending'),false);assert.equal(node.querySelector('[data-rt-skeleton]'),null);
 assert.equal(e.calls.length,1,'no second request');
 e.r.setSettings({postDiscovery:true,archiveDiscovery:false,restoreDeletedContent:true});assert.equal(e.r.records.size,0,'records are cleared with the restoration');
 e.r.destroy();e.W.close();
});

test('records are bounded and cleared when the post changes',async()=>{
 const e=setup();await e.r.ready;await settle();
 for(let i=0;i<600;i++)e.r.remember({id:'x'+i,author:'Someone',body:'text'});assert.ok(e.r.records.size<=500);
 e.W.history.pushState({},'','/r/example/comments/zzz99/other/');await e.r.scan();assert.equal(e.r.records.size,0);
 e.r.destroy();e.W.close();
});

test('archive bodies that equal Reddit notices are never shown as restored text',async()=>{
 for(const body of ['Comment deleted by user','[ Removed by Reddit ]','Comment removed by moderator','[deleted]','[removed]']){
  const e=setup({archive:message=>({ok:true,posts:message.ids.map(id=>archived(id.slice(3),body))})});await e.r.ready;await settle();
  const node=comment(e.doc,'t1_a1');assert.equal(node.querySelector('.notice p').textContent,'Comment deleted by user',body);assert.equal(node.querySelector('.rt-recovered-md'),null,body);assert.ok(node.querySelector('[data-rt-archived-author]'),'the author is still restored for '+body);
  e.r.destroy();e.W.close();
 }
});

test('"[ Removed by Reddit ]" comments are detected and restored with a removed cue',async()=>{
 const e=setup({html:page(row('t1_r1','<p>[ Removed by Reddit ]</p>'))});await e.r.ready;await settle();
 const node=comment(e.doc,'t1_r1');assert.match(node.textContent,/Original words of t1_r1/);assert.equal(node.querySelector('[data-rt-source]').dataset.state,'removed');assert.match(node.querySelector('[data-rt-source]').getAttribute('aria-label'),/^Removed on Reddit/);
 e.r.destroy();e.W.close();
});

test('user text that is exactly "[removed]" in a later paragraph is not mistaken for a notice',async()=>{
 const html=page(`<shreddit-comment thingid="t1_live1" postid="t3_abc12" author="Alice"><details open><summary><div slot="commentMeta"></div></summary><div id="t1_live1-post-rtjson-content" class="md"><p>I typed this:</p><p>[removed]</p></div></details></shreddit-comment>`);
 const e=setup({html});await e.r.ready;await settle();
 assert.equal(e.calls.length,0,'nothing is requested for a live comment');assert.equal(comment(e.doc,'t1_live1').querySelectorAll('p')[1].textContent,'[removed]');
 assert.equal(e.W.RTPostModel.domStatus(comment(e.doc,'t1_live1')),'');
 const real=e.doc.createElement('shreddit-comment');real.innerHTML='<details><summary></summary><div><p>[removed]</p></div></details>';assert.equal(e.W.RTPostModel.domStatus(real),'removed','a sole notice paragraph still counts');
 e.r.destroy();e.W.close();
});

test('a nested pending reply under an already settled parent hides Reddit’s notice, and the CSS fail-safe is declared',()=>{
 const dom=new JSDOM(`<main><shreddit-comment data-rt-settled><details><div><p>fine</p></div><shreddit-comment data-rt-pending><details><div><p data-rt-notice data-rt-hold>Comment deleted by user</p><div class="rt-skeleton" data-rt-skeleton></div></div></details></shreddit-comment></details></shreddit-comment></main>`,{runScripts:'outside-only'}),W=dom.window,css=fs.readFileSync('extension/post-discovery.css','utf8');
 const style=W.document.createElement('style');style.textContent=css;W.document.head.append(style);
 const notice=W.document.querySelector('[data-rt-notice]');assert.equal(W.getComputedStyle(notice).visibility,'hidden');
 notice.removeAttribute('data-rt-hold');assert.notEqual(W.getComputedStyle(notice).visibility,'hidden','settled notice shows');
 assert.match(css,/\[data-rt-notice\]\[data-rt-hold\]\{[^}]*animation:rt-hold-show 0s 6s forwards/,'held notices release themselves after 6 s');
 assert.match(css,/@keyframes rt-pending-title/);assert.equal(/:not\(shreddit-comment\[data-rt-settled\] \*\)/.test(css),false,'no ancestor :not() dependency');assert.equal(/details > div > div > div > div > p/.test(css),false,'no structural chain');
 assert.equal(/\.rt-archived-media figure/.test(css),false);assert.equal((css.match(/@keyframes rt-skeleton-sweep/g) || []).length,1);
 for(const line of css.split('\n'))if(line.includes('rt-posts[data-rt-menu-ready]:not(:has('))assert.equal(line.split('(').length,line.split(')').length,'balanced parentheses: '+line.slice(0,60));
 W.close();
});

test('pending state is capped: after the limit Reddit’s notice shows, ids stay queued, and a later success applies silently',async()=>{
 let release;const e=setup({pendingMs:40,archive:()=>new Promise(res=>release=res)});await e.r.ready;await settle();
 const node=comment(e.doc,'t1_a1');assert.equal(node.hasAttribute('data-rt-pending'),true);assert.ok(node.querySelector('[data-rt-hold]'));
 await settle(80);
 assert.equal(node.hasAttribute('data-rt-pending'),false,'visually settled');assert.equal(node.querySelector('[data-rt-skeleton]'),null);assert.equal(node.querySelector('[data-rt-hold]'),null);assert.equal(node.querySelector('.notice p').textContent,'Comment deleted by user');
 await e.r.scan();assert.equal(node.querySelector('[data-rt-skeleton]'),null,'a later scan does not bring the skeleton back');
 release({ok:true,posts:[archived('a1','Late words')]});await settle();assert.match(node.textContent,/Late words/);
 e.r.destroy();e.W.close();
});

test('a transient failure keeps ids queued past the visible cap and a later retry restores quietly',async()=>{
 let first=true;const e=setup({pendingMs:30,retryMs:100,archive:message=>{if(first){first=false;throw Object.assign(Error('wait'),{code:'rate-limited'});}return {ok:true,posts:message.ids.map(id=>archived(id.slice(3),'Retry words '+id))};}});
 await e.r.ready;await settle(10);const node=comment(e.doc,'t1_a1');assert.equal(node.hasAttribute('data-rt-pending'),true);
 await settle(60);assert.equal(node.hasAttribute('data-rt-pending'),false,'visible pending is capped while the retry is still waiting');assert.equal(node.querySelector('.notice p').textContent,'Comment deleted by user');
 await settle(200);assert.match(node.textContent,/Retry words t1_a1/);assert.equal(node.hasAttribute('data-rt-pending'),false);
 e.r.destroy();e.W.close();
});

test('the post archive lookup retries transient failures like comments do',async()=>{
 let tries=0;const e=setup({html:page(),archive:message=>{if(message.action!=='archive-ids')return {ok:true,posts:[]};if(++tries<3)throw Object.assign(Error('wait'),{code:'timeout'});return {ok:true,posts:[{id:'abc12',author:'Poster',title:'Original title',selftext:'',created_utc:1700000000}]};}});
 e.doc.querySelector('main').insertAdjacentHTML('afterbegin','<shreddit-post id="t3_abc12" author="Poster" post-title="[ Removed by moderator ]"><span slot="credit-bar"><span><shreddit-post-overflow-menu></shreddit-post-overflow-menu></span></span><h1 slot="title">[ Removed by moderator ]</h1><div slot="post-removed-banner">Sorry, this post has been removed by the moderators.</div></shreddit-post>');
 await e.r.ready;
 const post=e.doc.querySelector('shreddit-post'),reserved=post.querySelector('[data-rt-reserved]');assert.ok(reserved,'the cue’s space is reserved while pending');assert.equal(reserved.getAttribute('aria-hidden'),'true');
 await settle(150);assert.equal(tries,3);assert.equal(post.querySelector('[slot="title"]').textContent,'Original title');
 const badge=post.querySelector('[data-rt-source]');assert.equal(badge,reserved,'the same element becomes the cue');assert.equal(badge.hasAttribute('data-rt-reserved'),false);assert.equal(badge.tabIndex,0);assert.match(badge.getAttribute('aria-label'),/^Removed on Reddit/);
 e.r.destroy();e.W.close();
});

test('a failed post lookup removes the reserved cue space and still settles',async()=>{
 const e=setup({html:page(),archive:()=>{throw Object.assign(Error('no'),{code:'invalid'});}});
 e.doc.querySelector('main').insertAdjacentHTML('afterbegin','<shreddit-post id="t3_abc12" author="Poster" post-title="[ Removed by moderator ]"><span slot="credit-bar"><span><shreddit-post-overflow-menu></shreddit-post-overflow-menu></span></span><h1 slot="title">[ Removed by moderator ]</h1></shreddit-post>');
 await e.r.ready;await settle();const post=e.doc.querySelector('shreddit-post');assert.equal(post.querySelector('[data-rt-source]'),null);assert.equal(post.hasAttribute('data-rt-settled'),true);assert.equal(post.hasAttribute('data-rt-pending'),false);
 e.r.destroy();e.W.close();
});

test('avatar lookups that were deferred or failed are not cached as "no picture"',async()=>{
 let mode='deferred';const e=setup({html:page(row('t1_a1','<p>Comment deleted by user</p>')),reddit:async()=>mode==='deferred'?{deferred:true,retryAfterMs:1}:{avatar:'https://styles.redditmedia.com/t5_x/styles/profileIcon_a.png'}});
 await e.r.ready;await settle(60);assert.equal(e.r.avatars.has('originala1'),false,'deferral is not a definitive answer');
 const old=comment(e.doc,'t1_a1');assert.ok(old.querySelector('[avatar] svg.default'));
 mode='ok';const fresh=new e.W.DOMParser().parseFromString(row('t1_a1','<p>Comment deleted by user</p>'),'text/html').body.firstElementChild;old.replaceWith(e.doc.importNode(fresh,true));await e.r.scan();await settle(30);
 assert.equal(comment(e.doc,'t1_a1').querySelector('[slot="commentAvatar"] img').src,'https://styles.redditmedia.com/t5_x/styles/profileIcon_a.png');assert.equal(e.r.avatars.get('originala1'),'https://styles.redditmedia.com/t5_x/styles/profileIcon_a.png');
 e.r.destroy();e.W.close();
 const none=setup({reddit:async()=>({avatar:''})});await none.r.ready;await settle();assert.equal(none.r.avatars.get('originala1'),'','a definitive "no picture" is cached');none.r.destroy();none.W.close();
});

test('the avatar URL from the page world is revalidated before use',async()=>{
 for(const bad of ['https://evil.example/a.png','http://styles.redditmedia.com/a.png','https://user:pw@i.redd.it/a.png','javascript:alert(1)','https://styles.redditmedia.com/'+'a'.repeat(3000),'https://cf.preview.redd.it/snoovatar/avatars/full-body.png',42]){
  const e=setup({html:page(row('t1_a1','<p>Comment deleted by user</p>')),reddit:async()=>({avatar:bad})});await e.r.ready;await settle();
  assert.equal(comment(e.doc,'t1_a1').querySelector('[slot="commentAvatar"] img'),null,String(bad).slice(0,40));assert.ok(comment(e.doc,'t1_a1').querySelector('[avatar] svg.default'));e.r.destroy();e.W.close();
 }
});

test('status cues are keyboard focusable, named once, and the archived author is exposed as such',async()=>{
 const e=setup();await e.r.ready;await settle();const node=comment(e.doc,'t1_a1'),badge=node.querySelector('[data-rt-source]');
 assert.equal(badge.tabIndex,0);assert.equal(badge.getAttribute('role'),'img');assert.match(badge.getAttribute('aria-label'),/^Deleted by its author on Reddit · Text from an Arctic Shift snapshot/);
 assert.equal(node.querySelector('[data-rt-archived-author]').getAttribute('aria-label'),'u/Originala1 (from archive)');
 // Reddit's own profile card: its trigger wraps the name, and it reads the comment's author attribute.
 assert.ok(node.querySelector('[data-rt-archived-author]').closest('.author-hovercard-trigger'));
 assert.equal(node.getAttribute('author'),'Originala1');
 assert.match(comment(e.doc,'t1_b2').querySelector('[data-rt-source]').getAttribute('aria-label'),/^Removed on Reddit/);
 e.r.restoreAll();assert.equal(node.getAttribute('author'),'[deleted]');assert.equal(node.querySelector('.author-hovercard-trigger'),null);
 e.r.destroy();e.W.close();
 const bare=setup({glyph:false});await bare.r.ready;await settle();const mark=comment(bare.doc,'t1_a1').querySelector('[data-rt-source] .rt-badge-fallback');assert.ok(mark,'text fallback instead of an empty box');assert.equal(mark.getAttribute('aria-hidden'),'true');bare.r.destroy();bare.W.close();
});

test('bare [deleted] notices do not claim the author deleted the comment',async()=>{
 const e=setup({html:page(row('t1_a1','<p>[deleted]</p>'))});await e.r.ready;await settle();
 assert.match(comment(e.doc,'t1_a1').querySelector('[data-rt-source]').getAttribute('aria-label'),/^Deleted on Reddit · /);e.r.destroy();e.W.close();
});

test('restored comment spoilers stay hidden until revealed and are operable by keyboard',async()=>{
 const html='<div class="md"><p>Hello <span class="md-spoiler-text">secret</span></p></div>';
 const e=setup({css:true,archive:message=>({ok:true,posts:message.ids.map(id=>archived(id.slice(3),'Hello secret',{body_html:html}))})});await e.r.ready;await settle();
 const spoiler=comment(e.doc,'t1_a1').querySelector('.rt-recovered-md .rt-spoiler');assert.ok(spoiler,'rendered inside the styled container');
 assert.equal(spoiler.getAttribute('role'),'button');assert.equal(spoiler.tabIndex,0);assert.equal(spoiler.getAttribute('aria-expanded'),'false');assert.equal(e.W.getComputedStyle(spoiler).color,'rgba(0, 0, 0, 0)');
 spoiler.dispatchEvent(new e.W.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));assert.equal(spoiler.getAttribute('aria-expanded'),'true');assert.equal(spoiler.hasAttribute('data-revealed'),true);
 spoiler.dispatchEvent(new e.W.KeyboardEvent('keydown',{key:' ',bubbles:true,cancelable:true}));assert.equal(spoiler.getAttribute('aria-expanded'),'false');
 spoiler.click();assert.equal(spoiler.getAttribute('aria-expanded'),'true');spoiler.click();assert.equal(spoiler.getAttribute('aria-expanded'),'false');
 e.r.destroy();e.W.close();
});

test('profile-notice marks the held notice paragraph, ignores later "[removed]" user paragraphs, and shares the notice wording',async()=>{
 const html=page(row('t1_a1','<p>[ Removed by Reddit ]</p>'),`<shreddit-comment thingid="t1_u1" postid="t3_abc12"><details><summary></summary><div><p>user says</p><p>[removed]</p></div></details></shreddit-comment>`);
 const dom=new JSDOM(html,{url:'https://www.reddit.com/r/example/comments/abc12/title/',runScripts:'outside-only'}),W=dom.window;
 W.chrome={runtime:{id:'own',sendMessage:async()=>({ok:true,settings:{postDiscovery:true,archiveDiscovery:true,restoreDeletedContent:true}})}};W.eval(fs.readFileSync('extension/profile-notice.js','utf8'));
 W.RTProfileNoticeGuard.setRestoreEnabled(true);
 const held=W.document.querySelector('shreddit-comment[thingid="t1_a1"] p');assert.equal(held.dataset.rtHold,'');assert.equal(held.dataset.rtNotice,'true');assert.equal(W.document.querySelector('shreddit-comment[thingid="t1_u1"]').hasAttribute('data-rt-pending'),false);
 W.close();
});
