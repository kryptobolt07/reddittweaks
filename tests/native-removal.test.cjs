const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const source=()=>fs.readFileSync('extension/native-removal.js','utf8');
function fixture(t,html=''){
 const dom=new JSDOM('<shreddit-app user-logged-in="true" logged-in-user-id="t2_self"></shreddit-app><header><div id="user-drawer-content"><faceplate-partial src="/svc/shreddit/partial/Bundle/user-drawer-menu?params=username%3DExample"></faceplate-partial></div></header>'+html,{url:'https://www.reddit.com/user/Example/',runScripts:'outside-only'});
 t.after(()=>dom.window.close());dom.window.eval(fs.readFileSync('extension/post-model.js','utf8'));dom.window.eval(source());return {W:dom.window,N:dom.window.RTNativeRemoval,d:dom.window.document};
}
const post=(attrs='',body='Own text')=>`<shreddit-post id="t3_post1" author="Example" author-id="t2_self" created-timestamp="2026-11-15T10:00:00Z" subreddit-name="Alpha" permalink="/r/Alpha/comments/post1/title/" post-title="A post" ${attrs}><div slot="text-body">${body}</div></shreddit-post>`;
const comment=(attrs='',author='Example')=>`<shreddit-profile-comment comment-id="t1_19gsnavtu46ip" user-id="t2_self" href="/r/Alpha/comments/post1/title/19gsnavtu46ip/" ${attrs}><span id="poster-info-t1_19gsnavtu46ip"><a href="/user/${author}/">${author}</a><faceplate-timeago ts="2026-11-15T10:00:00Z"></faceplate-timeago></span><div id="t1_19gsnavtu46ip-comment-rtjson-content"><p>Own text</p></div><shreddit-overflow-menu comment-id="t1_19gsnavtu46ip" author-name="${author}" author-id="${author==='Example'?'t2_self':'t2_other'}"></shreddit-overflow-menu></shreddit-profile-comment>`;

test('native identity uses authenticated app plus account drawer, not the viewed profile or viewer ID',t=>{
 const {N,d}=fixture(t,post());assert.deepEqual(JSON.parse(JSON.stringify(N.identity(d))),{owner:'t2_self',username:'Example'});
 d.querySelector('#user-drawer-content').remove();assert.equal(N.identity(d).username,'Example','matching author ID is a native fallback');
 d.querySelector('shreddit-post').remove();assert.equal(N.identity(d),null,'a profile URL cannot establish the signed-in name');
});
test('signed-out, contradictory, or foreign-origin native identity is rejected',t=>{
 const {N,d}=fixture(t);d.querySelector('shreddit-app').setAttribute('user-logged-in','false');assert.equal(N.identity(d),null);
 d.querySelector('shreddit-app').setAttribute('user-logged-in','true');d.querySelector('faceplate-partial').setAttribute('src','https://evil.example/svc/shreddit/partial/X/user-drawer-menu?params=username%3DExample');assert.equal(N.identity(d),null);
});
test('native reader verifies authorship, accepts long comment IDs, and never treats user-id as author-id',t=>{
 const {N,d}=fixture(t,comment()+comment('','Other'));const me=N.identity(d),cards=d.querySelectorAll('shreddit-profile-comment');
 const item=N.item(cards[0],me);assert.equal(item.fullname,'t1_19gsnavtu46ip');assert.equal(item.kind,'comment');assert.equal(item.body,'Own text');assert.equal(item.subreddit,'Alpha');
 assert.equal(N.item(cards[1],me),null);cards[1].querySelector('shreddit-overflow-menu').remove();assert.equal(N.item(cards[1],me),null);
});
test('native moderation evidence distinguishes explicit removal, AutoModerator and no visibility evidence',t=>{
 const {N,d}=fixture(t,post('item-state="UNMODERATED"'));let item=N.item(d.querySelector('shreddit-post'),N.identity(d));assert.equal(item.moderation.visibilityKnown,false);assert.equal(item.moderation.nativeRemoved,false);
 const card=d.querySelector('shreddit-post');card.setAttribute('item-state','REMOVED');item=N.item(card,N.identity(d));assert.equal(item.moderation.nativeRemoved,true);assert.equal(item.moderation.category,null,'REMOVED does not name a moderator');
 card.setAttribute('item-state','AUTOMOD_FILTERED');item=N.item(card,N.identity(d));assert.equal(item.moderation.category,'automod_filtered');
 card.setAttribute('removed-by-category','automod_filtered');item=N.item(card,N.identity(d));assert.equal(item.moderation.category,'automod_filtered');
});
test('quoted removal text and nested foreign comment metadata cannot classify the own item',t=>{
 const {N,d}=fixture(t,post('item-state="UNMODERATED"','Removed by AutoModerator '+comment('item-state="REMOVED"','Other')));
 const p=N.item(d.querySelector('shreddit-post'),N.identity(d));assert.equal(p.moderation.nativeRemoved,false);assert.equal(p.moderation.category,null);
});
test('native listing keeps readable own cards, reports unreadable records, and validates continuation scope',t=>{
 const {N,d}=fixture(t,'<main><shreddit-feed>'+post()+comment()+'<shreddit-post author="Example"></shreddit-post><faceplate-partial src="/svc/shreddit/profiles/profile_overview-more-posts/new/?name=Example&amp;after=abc"></faceplate-partial></shreddit-feed></main>');
 const page=N.listing(d,N.identity(d),'overview');assert.equal(page.posts.length,2);assert.equal(page.unreadable,1);assert.equal(page.hasMore,true);assert.match(page.after,/profile_overview-more-posts/);assert.equal(page.incomplete,true);
 d.querySelector('main faceplate-partial').setAttribute('src','/svc/shreddit/profiles/profile_overview-more-posts/new/?name=Other');assert.throws(()=>N.listing(d,N.identity(d),'overview'),/continuation/i);
});
test('a thread comment can use the permalink supplied by its native action row',t=>{
 const {N,d}=fixture(t,'<shreddit-comment thingid="t1_19gsnavtu46ip" author="Example" author-id="t2_self" created-timestamp="2026-11-15T10:00:00Z"><div slot="comment"><p>Own text</p></div><shreddit-comment-action-row permalink="/r/Alpha/comments/post1/title/19gsnavtu46ip/"></shreddit-comment-action-row></shreddit-comment>');
 assert.equal(N.item(d.querySelector('shreddit-comment'),N.identity(d))?.fullname,'t1_19gsnavtu46ip');
});
test('native profile comment bodies use Reddit’s generic rtjson container too',t=>{
 const {N,d}=fixture(t,comment().replace('t1_19gsnavtu46ip-comment-rtjson-content','-post-rtjson-content'));assert.equal(N.item(d.querySelector('shreddit-profile-comment'),N.identity(d)).body,'Own text');
});
test('signed-out evidence requires an exact item, readable content and matching author',t=>{
 const {N,W}=fixture(t),parse=html=>new W.DOMParser().parseFromString(html,'text/html'),expected={fullname:'t1_19gsnavtu46ip',username:'Example',expectsBody:true};
 assert.equal(N.publicItem(parse(comment().replace('t1_19gsnavtu46ip-comment-rtjson-content','-post-rtjson-content')),expected).status,'visible');
 assert.equal(N.publicItem(parse(comment('','Other')),expected).status,'unknown');assert.equal(N.publicItem(parse('<p>Log in</p>'),expected).status,'unknown');
 assert.equal(N.publicItem(parse(comment().replace('Own text','')),expected).status,'unknown');
});
test('signed-out removed/deleted notices are item-specific; nested replies cannot decide parent visibility',t=>{
 const {N,W}=fixture(t),parse=html=>new W.DOMParser().parseFromString(html,'text/html'),expected={fullname:'t3_post1',username:'Example',expectsBody:true};
 assert.equal(N.publicItem(parse(post('item-state="REMOVED"')),expected).status,'removed');assert.equal(N.publicItem(parse(post('deleted="true"','[deleted]')),expected).status,'deleted');
 assert.equal(N.publicItem(parse(post('',comment('item-state="REMOVED"','Other'))),expected).status,'unknown','nested content alone is not the post body');
});
test('identity reads Reddit’s real drawer partial (userName key, extra query) on pages without own cards, such as profile search',t=>{
 // Captured live 2026-11-16 on /user/<me>/search/?rt_list=removed: the key is userName, followed by a query parameter.
 const dom=new JSDOM('<shreddit-app user-logged-in="true" logged-in-user-id="t2_self"></shreddit-app><div id="user-drawer-content"><faceplate-partial src="/svc/shreddit/partial/SZvQJM/user-drawer-menu?params=userName%3DExample&amp;query=%7B%22q%22%3A%22%22%2C%22rt_list%22%3A%22removed%22%7D"></faceplate-partial></div>',{url:'https://www.reddit.com/user/Example/search/?q=&rt_list=removed',runScripts:'outside-only'});
 t.after(()=>dom.window.close());dom.window.eval(fs.readFileSync('extension/post-model.js','utf8'));dom.window.eval(source());
 assert.deepEqual(JSON.parse(JSON.stringify(dom.window.RTNativeRemoval.identity(dom.window.document))),{owner:'t2_self',username:'Example'});
});
test('continuation pages: Reddit’s profile modal partials are ignored and an empty last page ends the list (captured 2026-11-16)',t=>{
 const {W,N}=fixture(t);const me={owner:'t2_self',username:'Example'};
 const parse=html=>new W.DOMParser().parseFromString(html,'text/html');
 const more='/svc/shreddit/profiles/profile_overview-more-posts/new/?sort=new&after=dDNfYWJj&name=Example&feedLength=33';
 const page=parse(post()+'<faceplate-partial src="/svc/shreddit/profiles/:username/profile-active-subreddits-modal"></faceplate-partial><faceplate-partial src="/svc/shreddit/profiles/:username/profile-contributions-modal"></faceplate-partial><faceplate-partial src="/svc/shreddit/profiles/:username/profile-followers-modal"></faceplate-partial><faceplate-partial src="'+more.replace(/&/g,'&amp;')+'"></faceplate-partial>');
 const value=N.listing(page,me,'overview',{continuation:true});assert.equal(value.posts.length,1);assert.equal(value.after,more);
 const end=N.listing(parse(''),me,'overview',{continuation:true});assert.deepEqual(JSON.parse(JSON.stringify([end.posts,end.after,end.hasMore])),[[],null,false],'an empty continuation is the end, not an error');
 assert.throws(()=>N.listing(parse(''),me,'overview'),/could not be verified/,'an empty first page is still an error');
 assert.throws(()=>N.listing(parse(post()+'<faceplate-partial src="/svc/shreddit/profiles/profile_overview-more-posts/new/?name=Other"></faceplate-partial>'),me,'overview',{continuation:true}),/continuation changed/,'a next link for another account is rejected');
});
test('a signed-out removed comment (captured 2026-11-16) is read as removed, not as unreadable',t=>{
 const {W,N}=fixture(t);
 const removed=`<article data-feed-element-id="t1_19sfh5eexcxic"><shreddit-profile-comment href="/r/LaptopDealsIndia/comments/1xqwnuj/comment/19sfh5eexcxic/?context=3" comment-id="t1_19sfh5eexcxic" user-id="" mod-tools-host="false"><div class="hover:bg-neutral-background-hover relative rounded-4"><a href="/r/LaptopDealsIndia/comments/1xqwnuj/comment/19sfh5eexcxic/?context=3" class="absolute inset-0"></a><div class="px-md py-sm "><div class="text-12 relative w-fit"><h2 class="inline-block m-0"><a href="/r/LaptopDealsIndia/comments/1xqwnuj/x/">Should I wait?</a></h2></div><shreddit-stop-propagation><div class="text-neutral-content-weak inline-block ms-xl mt-2xs"><span id="poster-info-t1_19sfh5eexcxic"></span><faceplate-timeago ts="2026-11-10T14:36:14.654000+0000" short></faceplate-timeago></div></shreddit-stop-propagation></div><div class="ms-[22px] mt-2xs ps-[10px] md"><div class="text-neutral-content-strong overflow-hidden"> [removed] </div></div><div class="block ms-lg relative"><shreddit-comment-action-row comment-id="t1_19sfh5eexcxic" score="1"></shreddit-comment-action-row></div></div></shreddit-profile-comment></article>`;
 const doc=new W.DOMParser().parseFromString(removed,'text/html');
 const proof=N.publicItem(doc,{fullname:'t1_19sfh5eexcxic',username:'Example'});assert.equal(proof.status,'removed');assert.equal(proof.verified,true);
 const deleted=new W.DOMParser().parseFromString(removed.replace('[removed]','[deleted]'),'text/html');assert.equal(N.publicItem(deleted,{fullname:'t1_19sfh5eexcxic',username:'Example'}).status,'deleted');
 const quoted=new W.DOMParser().parseFromString(removed.replace(' [removed] ','I said [removed] in jest'),'text/html');assert.notEqual(N.publicItem(quoted,{fullname:'t1_19sfh5eexcxic',username:'Example'}).status,'removed','only a block that is exactly the notice counts');
});
test('the signed-out Posts tab listing follows its own continuation and rejects the overview one',t=>{
 const {W,N}=fixture(t);const me={owner:'t2_self',username:'Example'},parse=html=>new W.DOMParser().parseFromString(html,'text/html');
 const more='/svc/shreddit/profiles/profile_posts-more-posts/new/?sort=new&after=dDNfYWJj&name=Example';
 const value=N.publicListing(parse('<shreddit-feed>'+post()+'<faceplate-partial src="'+more.replace(/&/g,'&amp;')+'"></faceplate-partial></shreddit-feed>'),me,{source:'posts'});
 assert.deepEqual([...value.items].map(i=>i.fullname),['t3_post1']);assert.equal(value.after,more);
 assert.throws(()=>N.publicListing(parse('<shreddit-feed>'+post()+'<faceplate-partial src="'+more.replace('profile_posts','profile_overview').replace(/&/g,'&amp;')+'"></faceplate-partial></shreddit-feed>'),me,{source:'posts'}),/continuation changed/);
 assert.throws(()=>N.publicListing(parse('<shreddit-feed>'+post()+'</shreddit-feed>'),me,{source:'comments'}),/Invalid/);
});

test('own native listing retains post vote/comment facts and its preview rather than avatar artwork',t=>{
 const {N,d}=fixture(t,post('score="57" comment-count="8" post-type="image" content-href="https://i.redd.it/syntheticpreview.jpg"'));const card=d.querySelector('shreddit-post');card.insertAdjacentHTML('beforeend','<span slot="credit-bar"><img src="https://www.redditstatic.com/avatar.png"></span><div slot="post-media-container"><img src="https://preview.redd.it/syntheticpreview.jpg?width=640"></div>');const item=N.item(card,N.identity(d));assert.equal(item.score,57);assert.equal(item.comments,8);assert.equal(item.thumbnail,'https://preview.redd.it/syntheticpreview.jpg?width=640');assert.equal(item.url,'https://i.redd.it/syntheticpreview.jpg');
});

test('own native listing reads media before faceplate images upgrade',t=>{
 const {N,d}=fixture(t,post('post-type="image"'));const card=d.querySelector('shreddit-post');card.insertAdjacentHTML('beforeend','<span slot="credit-bar"><faceplate-img src="https://www.redditstatic.com/avatar.png"></faceplate-img></span><div slot="post-media-container"><faceplate-img src="https://preview.redd.it/syntheticpreview.jpg?width=320"></faceplate-img></div>');assert.equal(N.item(card,N.identity(d)).thumbnail,'https://preview.redd.it/syntheticpreview.jpg?width=320');
});

test('a native profile comment carries its post title from the card’s link to the post (live markup 2026-11-16)',t=>{
 const card=comment().replace('<div id="t1_19gsnavtu46ip-comment-rtjson-content">','<a class="absolute inset-0" href="/r/Alpha/comments/post1/comment/19gsnavtu46ip/?context=3" aria-label="Thread"></a><a class="text-neutral-content-strong" href="/r/Alpha/comments/post1/a_synthetic_post/">A synthetic post</a><div id="t1_19gsnavtu46ip-comment-rtjson-content">');
 const {N,d}=fixture(t,card);const item=N.item(d.querySelector('shreddit-profile-comment'),N.identity(d));assert.equal(item.title,'A synthetic post');
 const bare=fixture(t,comment());assert.equal(bare.N.item(bare.d.querySelector('shreddit-profile-comment'),bare.N.identity(bare.d)).title,'','no post link: no invented title');
});
