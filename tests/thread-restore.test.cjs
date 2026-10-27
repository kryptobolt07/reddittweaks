const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
// Mirrors live Reddit thread markup (2026-10): deleted/removed comments keep a
// plain <p> notice under details; normal comments use *-post-rtjson-content.
const thread=`<main><shreddit-comment-tree>
<shreddit-comment thingid="t1_norm1" postid="t3_abc12" author="Alice"><details open><summary><div slot="commentMeta"><span>Alice</span><div class="row"><shreddit-comment-badges></shreddit-comment-badges></div></div></summary><div slot="comment" id="t1_norm1-comment-rtjson-content"><div id="t1_norm1-post-rtjson-content" class="md text-14 native-body"><p class="native-p">Hello there</p></div></div></details></shreddit-comment>
<shreddit-comment thingid="t1_gone1" postid="t3_abc12" author="[deleted]" is-comment-deleted><details><summary><div slot="commentMeta"><span>[deleted]</span><div class="row"><shreddit-comment-badges></shreddit-comment-badges></div></div></summary><div><div><div><div class="notice"><p>Comment deleted by user</p></div></div></div></div>
 <div id="comment-children"><shreddit-comment thingid="t1_kid1" postid="t3_abc12" author="[deleted]" collapsed><details><summary><div slot="commentMeta"><span>[deleted]</span></div></summary><div class="notice"><p>Comment removed by moderator</p></div></details></shreddit-comment></div>
</details></shreddit-comment>
<shreddit-comment thingid="t1_late1" postid="t3_abc12" author="[deleted]"><details><summary><div slot="commentMeta"></div></summary><div class="notice"><p>[deleted]</p></div></details></shreddit-comment>
</shreddit-comment-tree></main>`;
const archived=(id,body,extra={})=>({id,author:'Original'+id,body,created_utc:1700000000,link_id:'t3_abc12',parent_id:'t3_abc12',retrieved_on:1700086400,...extra});
function setup({url='https://www.reddit.com/r/example/comments/abc12/title/',settings={postDiscovery:true,archiveDiscovery:true,restoreDeletedContent:true},archive}={}){
 const dom=new JSDOM(thread,{url,runScripts:'outside-only'}),W=dom.window,calls=[];
 W.chrome={runtime:{id:'own',onMessage:{addListener(){},removeListener(){}},sendMessage:async()=>({ok:true})}};W.RTThreadRestoreDisabled=true;
 for(const file of ['post-model.js','post-discovery.js','thread-restore.js'])W.eval(fs.readFileSync('extension/'+file,'utf8'));
 const r=new W.RTThreadRestore.ThreadRestore({observe:false,retryMs:5,settings:async()=>settings,archive:async message=>{calls.push(message);return archive?archive(message):{ok:true,posts:message.ids.map(id=>archived(id.slice(3),id==='t1_late1'?'[deleted]':'Original words of '+id+'\n\nSecond paragraph'))}}});
 return {W,r,calls,doc:W.document};
}
const comment=(doc,id)=>doc.querySelector(`shreddit-comment[thingid="${id}"]`);
const settle=()=>new Promise(r=>setTimeout(r,20));
test('deleted and removed comment notices show archived text with Reddit body classes and a cue',async()=>{
 const {r,calls,doc}=setup();await r.ready;await settle();
 assert.equal(calls.length,1,'one batched archive request');assert.equal(calls[0].postId,'abc12');assert.deepEqual([...calls[0].ids].sort(),['t1_gone1','t1_kid1','t1_late1']);
 const gone=comment(doc,'t1_gone1'),body=gone.querySelector('.notice');
 assert.equal(body.querySelector('[data-rt-recovered-text]').className,'md text-14 native-body');assert.equal(body.querySelectorAll('p').length,2);assert.equal(body.querySelector('p').className,'native-p');assert.match(body.textContent,/Original words of t1_gone1/);
 const badge=gone.querySelector('[slot="commentMeta"] [data-rt-source]');assert.match(badge.title,/Deleted by its author on Reddit · Text from an Arctic Shift snapshot from .* · Originally posted by u\/Originalgone1/);assert.equal(badge.parentElement.className,'row');
 const kid=comment(doc,'t1_kid1');assert.match(kid.querySelector('.notice').textContent,/Original words of t1_kid1/);assert.match(kid.querySelector('[data-rt-source]').title,/^Removed by moderators/);assert.ok(kid.hasAttribute('collapsed'),'Reddit keeps its own collapsed state');
 assert.equal(gone.querySelector(':scope > details > div .notice').textContent.includes('t1_kid1'),false,'a parent never takes a reply’s text');
 assert.equal(comment(doc,'t1_norm1').querySelector('p').textContent,'Hello there','normal comments are untouched');
 assert.equal(comment(doc,'t1_late1').querySelector('p').textContent,'[deleted]','an archive captured after deletion changes nothing');
 await r.scan();assert.equal(calls.length,1,'restored comments are not requested again');
});
test('nothing is requested without both archive opt-ins, and opting out restores Reddit’s notices',async()=>{
 const off=setup({settings:{postDiscovery:true,archiveDiscovery:true,restoreDeletedContent:false}});await off.r.ready;await settle();assert.equal(off.calls.length,0);
 const {r,doc}=setup();await r.ready;await settle();assert.match(comment(doc,'t1_gone1').textContent,/Original words/);
 r.setSettings({postDiscovery:true,archiveDiscovery:false,restoreDeletedContent:true});
 assert.equal(comment(doc,'t1_gone1').querySelector('.notice p').textContent,'Comment deleted by user');assert.equal(doc.querySelector('[data-rt-source]'),null);
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
