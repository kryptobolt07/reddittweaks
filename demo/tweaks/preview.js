/* Synthetic visual fixture. Never calls Reddit or Arctic Shift. */
history.replaceState({},'', '/user/Example/');
const post=(id,title,selftext,extra={})=>({id,author:'Example',subreddit:'design',title,selftext,created_utc:1792587600,score:24,num_comments:6,...extra});
const discovery=new RTPostDiscovery.Discovery({
  readSettings:async()=>({'rt-settings-v1':{postDiscovery:true,archiveDiscovery:true}}),
  reddit:async request=>({posts:request.action==='info'?[post('old12','An older discussion','[removed]')]:[post('native','Already visible','Duplicate'),post('abc12','A small design detail that made a difference','A public post found through Reddit search. It may be omitted from the currently loaded profile, which does not prove that its author hid it.')],hasMore:false}),
  archive:async()=>({posts:[post('old12','An older discussion about interfaces','An archived snapshot is separate from the current Reddit post. Expand this section to review it.'),post('older1','What makes a tool feel native?','This archive-only result retains its source and an unknown current status.',{created_utc:1789909200})],hasMore:false})
});
document.querySelector('#theme').onclick=()=>document.body.classList.toggle('dark');
document.querySelector('#width').onclick=()=>document.body.classList.toggle('narrow');
discovery.ready.then(()=>discovery.loadReddit());
