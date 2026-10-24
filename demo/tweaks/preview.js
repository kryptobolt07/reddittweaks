/* Synthetic visual fixture. Never calls Reddit or Arctic Shift. */
history.replaceState({},'', '/user/Example/');
const post=(id,title,selftext,extra={})=>({id,author:'Example',subreddit:'design',title,selftext,created_utc:1792587600,score:24,num_comments:6,...extra});
const discovery=new RTPostDiscovery.Discovery({
  // Only a timeline fixture: the installed extension obtains real cards from Reddit.
  nativeRenderer:async(post,target)=>{const native=document.createElement(post.kind==='comment'?'shreddit-profile-comment':'shreddit-post');if(post.kind==='comment')native.setAttribute('comment-id',post.fullname);else native.id=post.fullname;const credit=document.createElement('span');credit.slot='credit-bar';credit.textContent='r/'+post.subreddit;const title=document.createElement('h2');title.textContent=post.title || 'Comment';const body=document.createElement('p');body.textContent=post.source==='reddit'?post.body:'Synthetic native placeholder';native.append(credit,title,body);target.replaceChildren(native);},
  readSettings:async()=>({'rt-settings-v1':{postDiscovery:true,archiveDiscovery:true}}),
  reddit:async request=>({posts:request.kind==='comment'?[{kind:'comment',id:'19rktoupyflj9',fullname:'t1_19rktoupyflj9',author:'Example',body:'A public comment discovered through Reddit’s native search.',link_id:'t3_abc12',created_utc:1792587700,subreddit:'design',title:'A discussion about design'}]:request.action==='info'?[post('old12','An older discussion','[removed]')]:[post('native','Already visible','Duplicate'),post('abc12','A small design detail that made a difference','A public post found through Reddit search. It may be omitted from the currently loaded profile, which does not prove that its author hid it.')],hasMore:false}),
  archive:async request=>({posts:request.kind==='comment'?[]:[post('old12','An older discussion about interfaces','An archived snapshot is separate from the current Reddit post. Expand this section to review it.'),post('older1','What makes a tool feel native?','This archive-only result retains its source and an unknown current status.',{created_utc:1789909200})],hasMore:false})
});
document.querySelector('#theme').onclick=()=>document.body.classList.toggle('dark');
document.querySelector('#width').onclick=()=>document.body.classList.toggle('narrow');
discovery.ready.then(()=>discovery.loadReddit());

// Preview the real popup with disposable local state, never extension/private storage.
fetch('/extension/popup.html').then(r=>r.text()).then(html=>{
 document.querySelector('iframe').srcdoc=html.replace('href="popup.css"','href="/extension/popup.css"').replace('<script src="popup.js"></script>','<script src="/demo/tweaks/popup-mock.js"></script><script src="/extension/popup.js"></script>');
});
