const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
function model(){const context=vm.createContext({URL});vm.runInContext(fs.readFileSync('extension/post-model.js','utf8'),context);return context.RTPostModel;}
const post=(extra={})=>({id:'abc12',author:'Example',created_utc:1700000000,title:'Title',selftext:'Original body',...extra});
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
