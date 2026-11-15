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
