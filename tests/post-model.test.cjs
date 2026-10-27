const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
function model(){const context=vm.createContext({URL});vm.runInContext(fs.readFileSync('extension/post-model.js','utf8'),context);return context.RTPostModel;}
const post=(extra={})=>({id:'abc12',author:'Example',created_utc:1700000000,title:'Title',selftext:'Original body',...extra});
test('automatic deleted-content restoration defaults on independently of archive opt-in',()=>{
 const m=model();assert.deepEqual(JSON.parse(JSON.stringify(m.normalizeSettings())),{postDiscovery:true,archiveDiscovery:false,restoreDeletedContent:true});
 assert.equal(m.normalizeSettings({restoreDeletedContent:false}).restoreDeletedContent,false);
 for(const value of [true,null,0,'false'])assert.equal(m.normalizeSettings({restoreDeletedContent:value}).restoreDeletedContent,true);
 assert.equal(m.normalizeSettings({restoreDeletedContent:true,archiveDiscovery:false}).archiveDiscovery,false);
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
