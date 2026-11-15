const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const {JSDOM}=require('jsdom');
const identity='<shreddit-app user-logged-in="true" logged-in-user-id="t2_self"></shreddit-app><div id="user-drawer-content"><faceplate-partial src="/svc/shreddit/partial/X/user-drawer-menu?params=username%3DExample"></faceplate-partial></div>';
const card=id=>`<shreddit-post id="t3_${id}" author="Example" author-id="t2_self" created-timestamp="2026-11-15T10:00:00Z" subreddit-name="Alpha" permalink="/r/Alpha/comments/${id}/title/" post-title="Example" item-state="REMOVED"><div slot="text-body">Text</div></shreddit-post>`;
function setup(t,{signedIn=true}={}){
 const dom=new JSDOM((signedIn?identity:'')+'<main></main>',{url:'https://www.reddit.com/user/Example/search/?rt_list=removed',runScripts:'outside-only'}),W=dom.window,calls=[];t.after(()=>W.close());W.AbortController=AbortController;
 W.fetch=async url=>{const u=new URL(url);calls.push(u);assert.doesNotMatch(u.pathname,/\.json$|^\/api\//);return {ok:true,status:200,headers:new Headers(),text:async()=>`<main><shreddit-feed>${card(u.searchParams.has('after')?'second':'first')}${u.searchParams.has('after')?'':'<faceplate-partial src="/svc/shreddit/profiles/profile_overview-more-posts/new/?name=Example&amp;after=next"></faceplate-partial>'}</shreddit-feed></main>`};};
 for(const f of ['post-model.js','native-removal.js','post-page-bridge.js'])W.eval(fs.readFileSync('extension/'+f,'utf8'));
 const send=input=>new Promise(resolve=>{const id=crypto.randomUUID(),listener=e=>{const v=JSON.parse(e.detail);if(v.id!==id)return;W.document.removeEventListener('rt-post-response',listener);resolve(v);};W.document.addEventListener('rt-post-response',listener);W.document.dispatchEvent(new W.CustomEvent('rt-post-request',{detail:JSON.stringify({channel:'native-removal-tests',id,...input})}));});return {W,send,calls};
}
test('Removed identity and native overview pagination make no legacy API calls',async t=>{
 const s=setup(t);assert.equal((await s.send({action:'own-list-identity',username:'Example'})).username,'Example');assert.equal(s.calls.length,0);
 const first=await s.send({action:'own-list',list:'removed',username:'Example'});assert.equal(first.ok,true,first.error);assert.equal(first.posts[0].moderation.nativeRemoved,true);assert.equal(first.incomplete,true);assert.equal(s.calls[0].pathname,'/user/Example/');
 const next=await s.send({action:'own-list',list:'removed',username:'Example',after:first.after});assert.equal(next.ok,true,next.error);assert.equal(next.posts[0].id,'second');assert.equal(next.hasMore,false);
});
test('Removed fails closed if identity is unavailable or changes; arbitrary continuation URLs are rejected',async t=>{
 const s=setup(t,{signedIn:false});assert.equal((await s.send({action:'own-list-identity',username:'Example'})).ok,false);assert.equal(s.calls.length,0);
 const b=setup(t);assert.equal((await b.send({action:'own-list',list:'removed',username:'Other'})).ok,false);
 for(const after of ['https://evil.example/','/svc/shreddit/profiles/profile_overview-more-posts/new/?name=Other','/api/me.json'])assert.equal((await b.send({action:'own-list',list:'removed',username:'Example',after})).ok,false);
 assert.equal(b.calls.length,0);
});
