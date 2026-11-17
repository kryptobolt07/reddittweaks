const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const {JSDOM}=require('jsdom');
const identity='<shreddit-app user-logged-in="true" logged-in-user-id="t2_self"></shreddit-app><div id="user-drawer-content"><faceplate-partial src="/svc/shreddit/partial/X/user-drawer-menu?params=username%3DExample"></faceplate-partial></div><reddit-page-data data="{&quot;profile&quot;:{&quot;id&quot;:&quot;t2_self&quot;,&quot;name&quot;:&quot;Example&quot;}}"></reddit-page-data>';
const card=id=>`<shreddit-post id="t3_${id}" author="Example" author-id="t2_self" created-timestamp="2026-11-15T10:00:00Z" subreddit-name="Alpha" permalink="/r/Alpha/comments/${id}/title/" post-title="Example" item-state="REMOVED"><div slot="text-body">Text</div></shreddit-post>`;
function setup(t,{signedIn=true}={}){
 const dom=new JSDOM((signedIn?identity:'')+'<main></main>',{url:'https://www.reddit.com/user/Example/search/?rt_list=removed',runScripts:'outside-only'}),W=dom.window,calls=[],publicReads=[];t.after(()=>W.close());W.AbortController=AbortController;
 W.RTPublicBrowser={async read(url){publicReads.push(new URL(url));return card('first').replace('item-state="REMOVED"','item-state="UNMODERATED"');}};
 W.fetch=async url=>{const u=new URL(url);calls.push(u);assert.doesNotMatch(u.pathname,/\.json$|^\/api\//);return {ok:true,status:200,headers:new Headers(),text:async()=>`<main><shreddit-feed>${card(u.searchParams.has('after')?'second':'first')}${u.searchParams.has('after')?'':'<faceplate-partial src="/svc/shreddit/profiles/profile_overview-more-posts/new/?name=Example&amp;after=next"></faceplate-partial>'}</shreddit-feed></main>`};};
 for(const f of ['post-model.js','native-removal.js','post-page-bridge.js'])W.eval(fs.readFileSync('extension/'+f,'utf8'));
 const send=input=>new Promise(resolve=>{const id=crypto.randomUUID(),listener=e=>{const v=JSON.parse(e.detail);if(v.id!==id)return;W.document.removeEventListener('rt-post-response',listener);resolve(v);};W.document.addEventListener('rt-post-response',listener);W.document.dispatchEvent(new W.CustomEvent('rt-post-request',{detail:JSON.stringify({channel:'native-removal-tests',id,...input})}));});return {W,send,calls,publicReads};
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
test('exact public checks use the existing unsigned browser and cache/coalesce observed own IDs',async t=>{
 const s=setup(t);await s.send({action:'own-list',list:'removed',username:'Example'});const request={action:'removal-public',username:'Example',owner:'t2_self',fullname:'t3_first'};
 const [a,b]=await Promise.all([s.send(request),s.send(request)]);assert.equal(a.ok,true,a.error);assert.equal(a.proof.status,'visible');assert.equal(b.proof.status,'visible');assert.equal(s.publicReads.length,1);assert.equal(s.publicReads[0].pathname,'/svc/shreddit/partial-feed-post/t3_first');
 await s.send(request);assert.equal(s.publicReads.length,1);assert.equal(s.calls.length,1,'only the original native overview used the owner session');
});
test('public checks reject unobserved/foreign items and treat unreadable unsigned responses as unknown',async t=>{
 const s=setup(t),base={action:'removal-public',username:'Example',owner:'t2_self',fullname:'t3_first'};assert.equal((await s.send(base)).ok,false);assert.equal(s.publicReads.length,0);
 s.W.document.querySelector('main').innerHTML=card('first');assert.equal((await s.send({...base,owner:'t2_other'})).ok,false);assert.equal((await s.send({...base,url:'https://evil.example/'})).ok,false);
 s.W.RTPublicBrowser.read=async()=>'<p>Log in</p>';const r=await s.send(base);assert.equal(r.ok,true,r.error);assert.equal(r.proof.status,'unknown');assert.equal(r.proof.verified,false);
});
test('known private-community items are not sent to the anonymous item endpoint',async t=>{
 const s=setup(t);s.W.document.querySelector('main').innerHTML=card('first').replace('item-state="REMOVED"','subreddit-type="private" item-state="REMOVED"');const r=await s.send({action:'removal-public',owner:'t2_self',username:'Example',fullname:'t3_first'});assert.equal(r.ok,true,r.error);assert.equal(r.proof.status,'unknown');assert.equal(s.publicReads.length,0);
});
test('navigation cannot coalesce a new-route public check into an old-route cancelled read',async t=>{
 const s=setup(t);s.W.document.querySelector('main').innerHTML=card('first');let release,n=0;const gate=new Promise(r=>release=r);s.W.RTPublicBrowser.read=async()=>{if(++n===1)await gate;return card('first').replace('item-state="REMOVED"','item-state="UNMODERATED"');};
 const request={action:'removal-public',owner:'t2_self',username:'Example',fullname:'t3_first'},first=s.send(request);await new Promise(r=>setImmediate(r));s.W.history.pushState({},'','/r/Alpha/comments/first/title/');const next=s.send(request);release();assert.equal((await first).ok,false);assert.equal((await next).ok,true);assert.equal(n,2);
});
test('a cancelled check cannot swallow a fresh check on the same route',async t=>{
 const s=setup(t);s.W.document.querySelector('main').innerHTML=card('first');let release,n=0,firstId;const gate=new Promise(r=>release=r);s.W.document.addEventListener('rt-post-request',e=>{const value=JSON.parse(e.detail);if(value.action==='removal-public' && !firstId)firstId=value.id;});s.W.RTPublicBrowser.read=async()=>{if(++n===1)await gate;return card('first').replace('item-state="REMOVED"','item-state="UNMODERATED"');};
 const request={action:'removal-public',owner:'t2_self',username:'Example',fullname:'t3_first'},first=s.send(request);await new Promise(r=>setImmediate(r));s.W.document.dispatchEvent(new s.W.CustomEvent('rt-post-request',{detail:JSON.stringify({channel:'native-removal-tests',id:firstId,action:'cancel'})}));const next=s.send(request);release();assert.equal((await first).ok,false);assert.equal((await next).ok,true);assert.equal(n,2);
});
test('signed-out profile pages (spec §18) list what a visitor sees, through the anonymous transport, with own cursors only',async t=>{
 const s=setup(t);const visitor=(ids,next)=>`<main><shreddit-feed>${ids.map(id=>card(id).replace('item-state="REMOVED"','item-state="UNMODERATED"').replace('2026-11-15T10:00:00Z','2026-11-1'+(ids.indexOf(id)%9)+'T10:00:00Z')).join('')}${next?'<faceplate-partial src="/svc/shreddit/profiles/profile_overview-more-posts/new/?sort=new&amp;name=Example&amp;after='+next+'"></faceplate-partial>':''}</shreddit-feed></main>`;
 s.W.RTPublicBrowser={async read(url){const u=new URL(url);s.publicReads.push(u);return u.pathname.startsWith('/user/')?visitor(['a','b'],'more'):visitor(['c'],null).replace(/<\/?main>|<\/?shreddit-feed>/g,'');}};
 const first=await s.send({action:'removal-public-profile',owner:'t2_self',username:'Example'});assert.equal(first.ok,true,first.error);
 assert.deepEqual(first.items.map(i=>i.fullname),['t3_a','t3_b']);assert.equal(first.items[0].subreddit,'alpha','each item names its community');assert.ok(first.items.every(i=>Number.isFinite(i.created)));assert.equal(first.hasMore,true);
 assert.equal(s.publicReads[0].pathname,'/user/Example/');assert.equal(s.publicReads[0].search,'?sort=new');assert.equal(s.calls.length,0,'no signed-in request');
 const next=await s.send({action:'removal-public-profile',owner:'t2_self',username:'Example',after:first.after});assert.equal(next.ok,true,next.error);assert.deepEqual(next.items.map(i=>i.fullname),['t3_c']);assert.equal(next.hasMore,false);
 for(const after of ['/svc/shreddit/profiles/profile_overview-more-posts/new/?sort=new&name=Example&after=forged','https://evil.example/'])assert.equal((await s.send({action:'removal-public-profile',owner:'t2_self',username:'Example',after})).ok,false,after);
 assert.equal((await s.send({action:'removal-public-profile',owner:'t2_other',username:'Example'})).ok,false,'another account');
});
test('the Posts tab is read signed in and signed out with its own continuations, which never cross sources',async t=>{
 const s=setup(t),feed=(ids,source,next)=>`<main><shreddit-feed>${ids.map(card).join('')}${next?'<faceplate-partial src="/svc/shreddit/profiles/profile_'+source+'-more-posts/new/?sort=new&amp;name=Example&amp;after='+next+'"></faceplate-partial>':''}</shreddit-feed></main>`;
 s.W.fetch=async url=>{const u=new URL(url);s.calls.push(u);return {ok:true,status:200,headers:new Headers(),text:async()=>u.pathname==='/user/Example/submitted/'?feed(['old1'],'posts','p2'):feed(['old2'],'posts',null)};};
 s.W.RTPublicBrowser={async read(url){const u=new URL(url);s.publicReads.push(u);return u.pathname==='/user/Example/submitted/'?feed(['old1'],'posts','v2'):feed(['old2'],'posts',null);}};
 const own=await s.send({action:'own-list',list:'removed',username:'Example',source:'posts'});assert.equal(own.ok,true,own.error);assert.equal(s.calls[0].pathname,'/user/Example/submitted/');assert.equal(s.calls[0].search,'?sort=new');assert.deepEqual(own.posts.map(p=>p.fullname),['t3_old1']);
 const own2=await s.send({action:'own-list',list:'removed',username:'Example',source:'posts',after:own.after});assert.equal(own2.ok,true,own2.error);assert.deepEqual(own2.posts.map(p=>p.fullname),['t3_old2']);
 assert.equal((await s.send({action:'own-list',list:'removed',username:'Example',after:own.after})).ok,false,'a Posts cursor is not an Overview cursor');
 const out=await s.send({action:'removal-public-profile',owner:'t2_self',username:'Example',source:'posts'});assert.equal(out.ok,true,out.error);assert.equal(s.publicReads[0].pathname,'/user/Example/submitted/');
 assert.equal((await s.send({action:'removal-public-profile',owner:'t2_self',username:'Example',after:out.after})).ok,false,'a Posts cursor is not an Overview cursor');
 assert.equal((await s.send({action:'removal-public-profile',owner:'t2_self',username:'Example',source:'posts',after:out.after})).ok,true);
 for(const source of ['comments','../x'])assert.equal((await s.send({action:'own-list',list:'removed',username:'Example',source})).ok,false,source);
});
test('a profile-list read that arrives while four Reddit requests are running waits its turn instead of failing',async t=>{
 const s=setup(t);let release;const gate=new Promise(r=>release=r);s.W.RTPublicBrowser={async read(){await gate;return '<main><shreddit-feed></shreddit-feed></main>';}};
 const busy=[0,1,2,3].map(()=>s.send({action:'removal-public-profile',owner:'t2_self',username:'Example'}));await new Promise(r=>setImmediate(r));
 const own=await s.send({action:'own-list',list:'removed',username:'Example'});assert.equal(own.ok,true);assert.equal(own.deferred,true,'deferred, so the caller retries');release();await Promise.all(busy);
});
