const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
function model(){const context=vm.createContext({URL});vm.runInContext(fs.readFileSync('extension/post-model.js','utf8'),context);return context.RTPostModel;}
const post=(extra={})=>({id:'abc12',author:'Example',created_utc:1700000000,title:'Title',selftext:'Original body',...extra});
test('automatic deleted-content restoration defaults on independently of archive opt-in and media defaults are passive',()=>{
 const m=model();
 assert.deepEqual(JSON.parse(JSON.stringify(m.normalizeSettings())),{
  postDiscovery:true,archiveDiscovery:false,restoreDeletedContent:true,subredditArchive:false,subredditArchiveAutomatic:false,
  cleanShareLinks:false,modUnapprovedFilter:true,raffles:true,downloadMedia:true,ownRemoval:false,removalNotifications:false,
  historyLimit:20,smoothFeeds:true,smoothComments:false,hideMatureOverlay:true,revealNsfwPostMedia:false,chatSearch:true,
  videoStart:'default',embedStart:'default',gifStart:'default',mediaClickAction:'default',clickAudio:'muted',embedBlockLinks:'off',
  singleVideo:false,volumeMemory:false,videoScrollAway:'default',videoOpenPost:'default',holdFor2x:false,loopPolicy:'default',streamQuality:'auto'
 });
 assert.deepEqual(JSON.parse(JSON.stringify(m.SETTINGS_DEFAULTS)),JSON.parse(JSON.stringify(m.normalizeSettings())));
 assert.deepEqual(JSON.parse(JSON.stringify(m.VIDEO_DEFAULTS)),JSON.parse(JSON.stringify(m.videoSettings())));
 assert.equal(m.normalizeSettings({restoreDeletedContent:false}).restoreDeletedContent,false);
 for(const value of [true,null,0,'false'])assert.equal(m.normalizeSettings({restoreDeletedContent:value}).restoreDeletedContent,true);
 assert.equal(m.normalizeSettings({restoreDeletedContent:true,archiveDiscovery:false}).archiveDiscovery,false);
 assert.equal(m.normalizeSettings({downloadMedia:false,chatSearch:false}).downloadMedia,false);
 assert.equal(m.normalizeSettings({downloadMedia:false,chatSearch:false}).chatSearch,false);
});
test('legacy 0.46–0.54 settings migrate cleanly to canonical rt-settings-v1 while fresh installs remain passive',()=>{
 const m=model();
 // Performance consolidation: turning off all 4 legacy feed toggles migrates smoothFeeds to false.
 assert.equal(m.normalizeSettings({smoothFeeds:true,smoothHome:false,smoothSubreddits:false,smoothProfiles:false,smoothSearch:false}).smoothFeeds,false);
 assert.equal(m.normalizeSettings({smoothFeeds:true,smoothHome:false,smoothSubreddits:true,smoothProfiles:false,smoothSearch:false}).smoothFeeds,true);
 assert.equal('smoothHome' in m.normalizeSettings({smoothHome:false}),false);
 // Feed start migration (desktop hover, touch stop, 0.48 reddit, 0.46 videoPreviewsInView)
 assert.equal(m.videoSettings({videoStart:'hover'}).videoStart,'preview');
 assert.equal(m.videoSettings({videoStartTouch:'stop'}).videoStart,'preview');
 assert.equal(m.videoSettings({videoStart:'reddit'}).videoStart,'default');
 assert.equal(m.videoSettings({videoPreviewsInView:true}).videoStart,'preview');
 assert.equal(m.videoSettings({embedStartTouch:'stop',gifStart:'play'}).embedStart,'preview');
 assert.equal(m.videoSettings({embedStartTouch:'stop',gifStart:'play'}).gifStart,'play');
 // Click & audio migration
 assert.deepEqual({a:m.videoSettings({videoPreviewClick:'muted'}).mediaClickAction,b:m.videoSettings({videoPreviewClick:'muted'}).clickAudio},{a:'inline',b:'muted'});
 assert.deepEqual({a:m.videoSettings({videoPreviewClick:'sound'}).mediaClickAction,b:m.videoSettings({videoPreviewClick:'sound'}).clickAudio},{a:'inline',b:'unmute'});
 assert.deepEqual({a:m.videoSettings({videoPreviewClick:'here',videoUnmutePreview:false}).mediaClickAction,b:m.videoSettings({videoPreviewClick:'here',videoUnmutePreview:false}).clickAudio},{a:'inline',b:'muted'});
 assert.deepEqual({a:m.videoSettings({videoPreviewClickPlays:true}).mediaClickAction,b:m.videoSettings({videoPreviewClickPlays:true}).clickAudio},{a:'inline',b:'unmute'});
 assert.deepEqual({a:m.videoSettings({videoPreviewClick:'open',videoUnmutePreview:true}).mediaClickAction,b:m.videoSettings({videoPreviewClick:'open',videoUnmutePreview:true}).clickAudio},{a:'open',b:'unmute'});
 assert.deepEqual({a:m.videoSettings({videoPreviewClick:'open',videoUnmutePreview:false}).mediaClickAction,b:m.videoSettings({videoPreviewClick:'open',videoUnmutePreview:false}).clickAudio},{a:'open',b:'muted'});
 // Open post & scroll away migration + new enhancements
 assert.equal(m.videoSettings({videoOpenPost:'continue',videoPreviewFrom:'position'}).videoOpenPost,'position');
 assert.equal(m.videoSettings({videoOpenPost:'continue',videoPreviewFrom:'start'}).videoOpenPost,'start');
 assert.equal(m.videoSettings({videoOpenPost:'continue',videoPreviewRestart:true}).videoOpenPost,'start');
 assert.equal(m.videoSettings({videoOpenPost:'reddit'}).videoOpenPost,'default');
 assert.equal(m.videoSettings({videoScrollAway:'reddit'}).videoScrollAway,'default');
 assert.equal(m.videoSettings({videoScrollAway:'mini'}).videoScrollAway,'mini');
 const enh=m.videoSettings({mediaClickAction:'fullscreen',clickAudio:'unmute',singleVideo:true,volumeMemory:true,holdFor2x:true,loopPolicy:'short',streamQuality:'saver'});
 assert.deepEqual(JSON.parse(JSON.stringify(enh)),{videoStart:'default',embedStart:'default',gifStart:'default',mediaClickAction:'fullscreen',clickAudio:'unmute',embedBlockLinks:'off',singleVideo:true,volumeMemory:true,videoScrollAway:'default',videoOpenPost:'default',holdFor2x:true,loopPolicy:'short',streamQuality:'saver'});
 // Invalid values fall back safely
 assert.deepEqual(JSON.parse(JSON.stringify(m.videoSettings({videoStart:'bogus',loopPolicy:'nope',streamQuality:'4k',singleVideo:'true'}))),JSON.parse(JSON.stringify(m.VIDEO_DEFAULTS)));
});
test('post normalization validates identity, caps untrusted text and rejects unsafe URLs',()=>{
 const m=model();assert.equal(m.validateUsername('x'),true);assert.equal(m.validateUsername('name?query'),false);assert.equal(m.validateId('t3_abc12'),true);
 assert.equal(m.normalizePost(post({id:'bad!'})),null);assert.equal(m.normalizePost(post({author:'some/one'})),null);
 const p=m.normalizePost(post({selftext:'a'.repeat(50000),url:'javascript:alert(1)',thumbnail:'data:image/png,abc',permalink:'https://evil.test/'}));
 assert.equal(p.body.length,40000);assert.equal(p.url,'');assert.equal(p.thumbnail,'');assert.equal(p.permalink,'https://www.reddit.com/comments/abc12/');
 assert.equal(m.normalizePost(post({author:'[deleted]'})).status,'available');
});
test('current live metadata wins with separately attributed archive recovery only for removed posts',()=>{
 const m=model(),archive=[post()],removed=post({author:'[deleted]',selftext:'[deleted]',score:7,title:'Current'});
 const [merged]=m.mergePosts([removed],archive,{username:'example',visibleIds:[]});
 assert.equal(merged.status,'deleted');assert.equal(merged.source,'reddit');assert.equal(merged.body,'[deleted]');assert.equal(merged.archivedBody,'Original body');assert.equal(merged.archivedBodySource,'arctic-shift');assert.equal(merged.archiveAuthor,'Example');assert.equal(merged.title,'Current');assert.equal(merged.outsideVisibleFeed,true);assert.equal(merged.profileHidden,undefined);
 const [current]=m.mergePosts([post({selftext:'Current body'})],archive,{username:'Example',visibleIds:['t3_abc12']});assert.equal(current.archivedBody,undefined);assert.equal(current.visible,true);assert.equal(current.body,'Current body');
});
test('archive absence and stale deletion never imply current deletion; foreign authors are excluded',()=>{
 const m=model(),[archived]=m.mergePosts([],[post({selftext:'[removed]'})],{username:'example'});assert.equal(archived.status,'unknown');assert.equal(archived.archiveStatus,'removed');
 assert.equal(m.mergePosts([post({author:'Foreign'})],[],{username:'Example'}).length,0);
 assert.equal(m.mergePosts([],[],{username:'Example'}).length,0);
 assert.equal(m.normalizeSettings({archiveDiscovery:true}).archiveDiscovery,true);assert.equal(m.normalizeSettings({archiveDiscovery:'true'}).archiveDiscovery,false);assert.equal(m.normalizeSettings().postDiscovery,true);
});
test('restriction flags are conservative across live and archive snapshots',()=>{
 const m=model();
 for(const [live,archive] of [[{over_18:true},{spoiler:true}],[{spoiler:true},{over_18:true}]]){
  const [merged]=m.mergePosts([post({...live,selftext:'[removed]'})],[post(archive)],{username:'Example'});
  assert.equal(merged.over18,true);assert.equal(merged.spoiler,true);assert.equal(merged.archivedBody,'Original body');
 }
});
test('modern comment IDs, parent links and post/comment identity remain distinct',()=>{
 const m=model(),comment=m.normalizeComment({id:'t1_19rktoupyflj9',author:'Example',created_utc:1700000000,body:'A comment',link_id:'t3_abc12'});
 assert.equal(comment.id,'19rktoupyflj9');assert.equal(comment.kind,'comment');assert.match(comment.permalink,/abc12\/comment\/19rktoupyflj9/);assert.equal(m.validateCommentId('t1_'+ 'x'.repeat(33)),false);
 assert.equal(m.normalizeComment({id:'one',author:'Example',created_utc:1700000000,link_id:'bad!'}),null);
 const shared={...comment,id:'abc12',fullname:'t1_abc12'};
 const merged=m.mergePosts([post(),shared],[],{username:'Example',visibleIds:['t3_abc12']});assert.equal(merged.length,2);assert.equal(merged.find(p=>p.kind==='comment').visible,false);
});
test('profile sorts use dates for New, scores for Top and Reddit order for Hot',()=>{
 const m=model(),data=[post({id:'older',created_utc:1700000000,score:100}),post({id:'recent',created_utc:1700000100,score:1}),post({id:'middle',created_utc:1700000050,score:10})];
 const ids=sort=>Array.from(m.mergePosts(data,[],{username:'Example',sort}),p=>p.id);
 assert.deepEqual(ids('new'),['recent','middle','older']);assert.deepEqual(ids('top'),['older','middle','recent']);assert.deepEqual(ids('hot'),['older','recent','middle']);
 const ranged=m.mergePosts(data,[post({id:'ancient',created_utc:1600000000,score:1000})],{username:'Example',sort:'top',range:'day',now:1700000150});assert.equal(ranged.some(p=>p.id==='ancient'),false);
});

test('comment parent identities preserve native fullnames and normalize archive bare IDs without confusing top-level comments',()=>{
 const m=model(),base={id:'child',author:'Example',created_utc:1700000000,link_id:'t3_post',body:'Reply'};
 for(const [input,expected] of [['t1_Parent','t1_parent'],['parent','t1_parent'],['post','t3_post'],['t3_post','t3_post'],[null,'t3_post'],['','t3_post'],['../../bad','']])assert.equal(m.normalizeComment({...base,parent_id:input},{source:'arctic-shift'}).parentId,expected);
 assert.equal(m.normalizeComment(base).parentId,'');
});

test('archive retrieval time is kept only for valid arctic-shift snapshots, including comments',()=>{
 const m=model();
 assert.equal(m.normalizePost(post({retrieved_on:1700000500.7}),{source:'arctic-shift'}).retrieved,1700000500);
 assert.equal(m.normalizePost(post({retrieved_on:'1700000600'}),{source:'arctic-shift'}).retrieved,1700000600);
 assert.equal(m.normalizePost(post({retrieved_on:32503680000}),{source:'arctic-shift'}).retrieved,32503680000);
 assert.equal('retrieved' in m.normalizePost(post({retrieved_on:1700000700})),false);
 for(const value of [0,-5,'',' ','12abc','1e9','0x10',NaN,Infinity,32503680001,'32503680001',null,{}])assert.equal('retrieved' in m.normalizePost(post({retrieved_on:value}),{source:'arctic-shift'}),false,String(value));
 const comment={id:'t1_19rktoupyflj9',author:'Example',created_utc:1700000000,body:'A comment',link_id:'t3_abc12'};
 assert.equal(m.normalizeComment({...comment,retrieved_on:'1700000800'},{source:'arctic-shift'}).retrieved,1700000800);
 assert.equal('retrieved' in m.normalizeComment({...comment,retrieved_on:1700000800},{source:'reddit'}),false);
 assert.equal('retrieved' in m.normalizeComment({...comment,retrieved_on:-1},{source:'arctic-shift'}),false);
});
test('parent link info accepts only valid post IDs and bounded text for comment titles',()=>{
 const m=model();
 assert.deepEqual(JSON.parse(JSON.stringify(m.normalizeLinkInfo({id:'t3_ABC12',title:'x'.repeat(1200),subreddit:'example',over_18:true,spoiler:'yes'}))),{id:'abc12',title:'x'.repeat(1000),subreddit:'example',over18:true,spoiler:false});
 assert.equal(m.normalizeLinkInfo({id:'bad!'}),null);assert.equal(m.normalizeLinkInfo(null),null);
});

test('archive retrieval time survives re-normalizing an already normalized record',()=>{
  const M=model(),first=M.normalizeComment({id:'c1',author:'Example',body:'b',created_utc:1700000000,link_id:'t3_abc12',retrieved_on:1700000500,title:'Parent'},{source:'arctic-shift'});
  const again=M.normalizeItem(first,{source:'arctic-shift'});assert.equal(again.retrieved,1700000500);assert.equal(again.title,'Parent');
});

test('archive media preserves safe gallery order, image previews and thumbnail distinctions across normalization',()=>{
 const m=model(), gallery=post({url:'https://www.reddit.com/gallery/abc12',gallery_data:{items:[{media_id:'b'},{media_id:'a'}]},media_metadata:{a:{e:'Image',m:'image/jpeg',s:{u:'https://preview.redd.it/a.jpg?width=600&amp;format=pjpg'}},b:{e:'Image',m:'image/png',s:{u:'https://i.redd.it/b.png'}}}});
 const first=m.normalizePost(gallery,{source:'arctic-shift'}),again=m.normalizePost(first,{source:'arctic-shift'});
 assert.deepEqual(JSON.parse(JSON.stringify(again.media)),[{url:'https://i.redd.it/b.png',kind:'image'},{url:'https://preview.redd.it/a.jpg?width=600&format=pjpg',kind:'image'}]);
 const link=m.normalizePost(post({url:'https://example.com/article',preview:{images:[{source:{url:'https://external-preview.redd.it/image.jpg?width=100&amp;x=2'}}]},thumbnail:'https://b.thumbs.redditmedia.com/t.jpg'}),{source:'arctic-shift'});
 assert.equal(link.media[0].kind,'preview');assert.equal(link.media[0].url,'https://external-preview.redd.it/image.jpg?width=100&x=2');
 assert.equal(m.normalizePost(post({url:'https://example.com/article',thumbnail:'https://b.thumbs.redditmedia.com/t.jpg'})).media[0].kind,'thumbnail');
 for(const url of ['https://example.com/image.jpg','http://i.redd.it/a.jpg','https://i.redd.it.evil.test/a.jpg','https://user@i.redd.it/a.jpg','https://i.redd.it/a.svg'])assert.equal(m.mediaUrl(url),'');
});

test('direct image media does not append a duplicate preview and retains gallery dimensions',()=>{
 const m=model(),single=m.normalizePost(post({url:'https://i.redd.it/x.jpg',preview:{images:[{source:{url:'https://preview.redd.it/x.jpg?width=600'}}]}}));assert.equal(single.media.length,1);assert.equal(single.media[0].kind,'image');
 const gallery=m.normalizePost(post({gallery_data:{items:[{media_id:'x'}]},media_metadata:{x:{e:'Image',m:'image/jpeg',s:{u:'https://i.redd.it/x.jpg',x:640,y:480}}}}));assert.equal(gallery.media[0].width,640);assert.equal(gallery.media[0].height,480);
});

test('Reddit video stream and poster data survive re-normalization and reject foreign or mismatched streams',()=>{
 const m=model(),raw=post({post_hint:'hosted:video',is_video:true,url:'https://v.redd.it/clip',preview:{images:[{source:{url:'https://external-preview.redd.it/poster.png?x=1&amp;s=signed',width:405,height:720}}]},secure_media:{reddit_video:{hls_url:'https://v.redd.it/clip/HLSPlaylist.m3u8?a=1&amp;v=1',dash_url:'https://v.redd.it/clip/DASHPlaylist.mpd?a=signed',fallback_url:'https://v.redd.it/clip/CMAF_1080.mp4?source=fallback',width:1080,height:1920,has_audio:true,duration:8}}});
 const first=m.normalizePost(raw,{source:'arctic-shift'}),again=m.normalizePost(first,{source:'arctic-shift'}),v=again.media[0];
 assert.equal(again.media.length,1);assert.equal(v.kind,'video');assert.equal(v.poster,'https://external-preview.redd.it/poster.png?x=1&s=signed');assert.equal(v.hls,'https://v.redd.it/clip/HLSPlaylist.m3u8?a=1&v=1');assert.equal(v.dash,'https://v.redd.it/clip/DASHPlaylist.mpd?a=signed');assert.equal(v.fallback,'https://v.redd.it/clip/CMAF_1080.mp4?source=fallback');assert.equal(v.hasAudio,true);assert.equal(v.width,1080);assert.equal(v.height,1920);assert.equal(v.duration,8);
 const bad=m.normalizePost(post({is_video:true,secure_media:{reddit_video:{hls_url:'https://evil.test/clip/HLSPlaylist.m3u8',dash_url:'https://v.redd.it/clip/DASHPlaylist.mpd',fallback_url:'https://v.redd.it/other/CMAF_1080.mp4'}}}));assert.equal(bad.media[0].hls,'');assert.equal(bad.media[0].fallback,'');assert.equal(bad.media[0].hasAudio,null);
 assert.equal(m.videoUrl('https://v.redd.it.evil.test/clip/HLSPlaylist.m3u8','m3u8'),'');assert.ok(m.mediaUrl('https://cf.preview.redd.it/image.jpg'));
 const image=m.normalizePost(post({post_hint:'image',url:'',preview:{images:[{source:{url:'https://preview.redd.it/image.jpg',width:716,height:940}}]}}));assert.equal(image.media[0].kind,'image');assert.equal(image.media[0].width,716);
});
test('comment media requires a body reference and validated Reddit image metadata',()=>{
 const M=model();const url='https://preview.redd.it/synthetic123.jpeg?width=960&format=pjpg&s=signature';
 const raw={id:'abc',author:'Example',created_utc:1700000000,link_id:'t3_post1',body:url,media_metadata:{synthetic123:{e:'Image',m:'image/jpeg',s:{u:url,x:960,y:1482}}}};
 const image=M.normalizeComment(raw,{source:'arctic-shift'});assert.equal(image.media[0].url,url);assert.equal(image.media[0].width,960);assert.equal(M.normalizeComment(image,{source:'arctic-shift'}).media[0].height,1482);
 assert.equal(M.normalizeComment({...raw,body:'Unrelated synthetic123'},{source:'arctic-shift'}).media.length,0);
 assert.equal(M.normalizeComment({...raw,media_metadata:{synthetic123:{e:'Image',m:'image/jpeg',s:{u:'https://evil.example/synthetic123.jpeg'}}}},{source:'arctic-shift'}).media.length,0);
});

test('a notice counts only as the first own paragraph; later user text "[removed]" does not',()=>{
 const {JSDOM}=require('jsdom');const dom=new JSDOM('',{runScripts:'outside-only'}),W=dom.window;W.eval(fs.readFileSync('extension/post-model.js','utf8'));
 const status=html=>{const box=W.document.createElement('div');box.innerHTML=html;return W.RTPostModel.domStatus(box.firstElementChild);};
 assert.equal(status('<shreddit-comment><div><p>[removed]</p></div></shreddit-comment>'),'removed');
 assert.equal(status('<shreddit-comment><div><p>[ Removed by Reddit ]</p></div></shreddit-comment>'),'removed');
 assert.equal(status('<shreddit-comment><div><p>Comment deleted by user</p></div></shreddit-comment>'),'deleted');
 assert.equal(status('<shreddit-comment><div><p>I wrote:</p><p>[removed]</p></div></shreddit-comment>'),'');
 assert.equal(status('<shreddit-comment><div><p>  </p><p>[deleted]</p></div></shreddit-comment>'),'deleted','blank paragraphs are skipped');
 assert.equal(status('<shreddit-comment><div><p>Live text</p></div><shreddit-comment><div><p>[removed]</p></div></shreddit-comment></shreddit-comment>'),'','a nested reply’s notice never counts');
 assert.equal(W.RTPostModel.noticeParagraph(null),null);
});

test('community archive preferences require explicit booleans independently of other archive features',()=>{
 const M=model();for(const key of ['subredditArchive','subredditArchiveAutomatic']){
  assert.equal(M.normalizeSettings({[key]:true})[key],true);
  for(const value of [undefined,false,'true',1,null])assert.equal(M.normalizeSettings({[key]:value})[key],false);
 }
 assert.equal(M.normalizeSettings({archiveDiscovery:true}).subredditArchive,false);
});
test('Reddit’s “[ Removed by moderator ]” title recorded by the archive is removal evidence',()=>{
 const M=model();const p=M.normalizePost(post({_meta:{edited_title:'[ Removed by moderator ]',removal_type:'deleted',was_deleted_later:true}}),{source:'arctic-shift'});
 assert.equal(p.archiveRemovedBy,'moderator');assert.equal(p.archiveDeletedLater,true);
 assert.equal(M.normalizePost(post({_meta:{edited_title:'A better title'}}),{source:'arctic-shift'}).archiveRemovedBy || '','','an ordinary title edit is not evidence');
});
