const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
function model(){const context=vm.createContext({});vm.runInContext(fs.readFileSync('extension/removal-model.js','utf8'),context);return context.RTRemovalModel;}
const T=1790000000;
const post=(extra={})=>({name:'t3_abc1234',title:'A post',selftext:'Body',created_utc:T,subreddit_type:'public',removed_by_category:null,removal_reason:null,locked:false,...extra});
const comment=(extra={})=>({name:'t1_19shscon6myio',body:'My comment',created_utc:T,subreddit_type:'public',...extra});
const archived=(latency,extra={})=>({retrieved_on:T+latency,created_utc:T,...extra});
const plain=value=>JSON.parse(JSON.stringify(value));

test('rule 1: your own deletion wins over everything',()=>{
  const m=model();
  assert.equal(m.classify({author:comment({body:'[deleted]'})}).state,'deleted');
  assert.equal(m.classify({author:post({removed_by_category:'deleted'})}).state,'deleted');
  assert.equal(m.classify({author:post({removed_by_category:'author',removal_reason:'legal'})}).state,'deleted');
});

test('rule 2: Reddit removals: removal_reason and admin categories are Reddit; the reddit category is its filters',()=>{
  const m=model();
  for(const category of ['anti_evil_ops','content_takedown','copyright_takedown','community_ops']){const r=m.classify({author:post({removed_by_category:category})});assert.equal(r.state,'removed-admin');assert.equal(r.label,'Removed by Reddit');assert.equal(r.confidence,'verified');}
  assert.equal(m.classify({author:comment({removal_reason:'spam'})}).state,'removed-admin','removal_reason plus a visible body still means Reddit');
  const f=m.classify({author:post({removed_by_category:'reddit'})});assert.equal(f.state,'removed-filter');assert.equal(f.confidence,'verified');assert.match(f.label,/filters/);
});

test('rules 3 and 4: post categories Reddit gives the author are verified',()=>{
  const m=model();
  const auto=m.classify({author:post({removed_by_category:'automod_filtered'})});assert.equal(auto.state,'removed-auto');assert.equal(auto.confidence,'verified');assert.ok(auto.removed);
  const mod=m.classify({author:post({removed_by_category:'moderator'})});assert.equal(mod.state,'removed-mod');assert.equal(mod.confidence,'verified');assert.match(mod.why,/moderators/);
});

test('rule 5: the 25 s boundary decides automatic vs moderator (Reveddit\'s threshold), from the public view',()=>{
  const m=model(),removedPublic={body:'[removed]'};
  assert.equal(m.AUTO_LATENCY,25);
  assert.equal(m.classify({author:comment(),publicView:removedPublic,archive:archived(25,{body:'[removed]'})}).state,'removed-auto','25 s is automatic');
  assert.equal(m.classify({author:comment(),publicView:removedPublic,archive:archived(26,{body:'[removed]'})}).state,'removed-unknown','26 s is too late to tell');
  const mod=m.classify({author:comment(),publicView:removedPublic,archive:archived(3600,{body:'My comment'})});assert.equal(mod.state,'removed-mod');assert.equal(mod.confidence,'likely');assert.match(mod.why,/1 hour/);
  const none=m.classify({author:comment(),publicView:{missing:true},archive:null,archiveStatus:'missing'});assert.equal(none.state,'removed-unknown');assert.match(none.why,/no archive copy/);
});

test('rules 6 and 7: public view shows it; an archive [removed] capture means it was approved',()=>{
  const m=model();
  const ok=m.classify({author:comment(),publicView:{body:'My comment'}});assert.equal(ok.state,'visible');assert.equal(ok.label,'');assert.equal(ok.removed,false);
  const approved=m.classify({author:comment(),publicView:{body:'My comment'},archive:archived(10,{body:'[removed]'})});assert.equal(approved.state,'visible');assert.ok(approved.flags.includes('approved-after-auto'));
  const postApproved=m.classify({author:post(),archive:archived(12,{removed_by_category:'automod_filtered'})});assert.equal(postApproved.state,'visible');assert.ok(postApproved.flags.includes('approved-after-auto'));assert.match(postApproved.why,/12 seconds after posting.*moderator approved/);
  const filterApproved=m.classify({author:post(),archive:archived(17,{removed_by_category:'reddit'})});assert.match(filterApproved.why,/filters held it/);assert.doesNotMatch(filterApproved.why,/moderator/);
});

test('posts with no removal category are visible to others (Reddit tells the author), archive or not',()=>{
  const m=model();assert.equal(m.classify({author:post()}).state,'visible');assert.equal(m.classify({author:post(),archiveStatus:'off'}).confidence,'verified');
});

test('rule 8 and R2: comments are never "visible" without a public check; failures say why',()=>{
  const m=model();
  const blocked=m.classify({author:comment(),archiveStatus:'off'});assert.equal(blocked.state,'unknown');assert.equal(blocked.label,'Couldn’t check');assert.match(blocked.why,/blocks logged-out checks/);assert.match(blocked.why,/Use the archive/);
  assert.match(m.classify({author:comment(),archive:archived(9000,{body:'My comment'})}).why,/blocks logged-out/);
  assert.match(m.classify({author:comment(),archiveStatus:'failed'}).why,/archive didn’t answer/);
  assert.equal(m.classify({author:comment(),publicView:{status:'failed'}}).state,'unknown');
  assert.match(m.classify({author:comment(),publicView:{status:'rate-limited'}}).why,/limiting requests/);
  assert.equal(m.classify({}).state,'unknown');
});

test('without a public view, an archive capture of the removal still counts',()=>{
  const m=model();
  assert.equal(m.classify({author:comment(),archive:archived(20,{body:'[removed]'})}).state,'removed-auto');
  const late=m.classify({author:comment(),archive:archived(5000,{body:'[removed]'})});assert.equal(late.state,'removed-unknown');assert.match(late.why,/too late/);
});

test('private communities are never reported as removed (L5); flags carry lock, crowd control and quarantine',()=>{
  const m=model();
  const p=m.classify({author:post({subreddit_type:'private',removed_by_category:'moderator'})});assert.equal(p.state,'unknown');assert.match(p.why,/private community/);
  const flags=m.classify({author:post({locked:true,quarantine:true})}).flags;assert.deepEqual(plain(flags),['locked','quarantined-community']);
  assert.ok(m.classify({author:comment(),publicView:{body:'x',collapsed:true}}).flags.includes('collapsed'));
  assert.equal(m.classify({author:comment({collapsed:true})}).flags.includes('collapsed'),false,'score collapse is not crowd control');
  assert.ok(m.classify({author:comment({collapsed:true,collapsed_because_crowd_control:true})}).flags.includes('collapsed'));
});

test('changes between checks drive notifications without duplicates',()=>{
  const m=model(),c=(author,extra)=>m.classify({author:post(author),...extra});
  const visible=c(),removed=c({removed_by_category:'moderator'}),locked=c({locked:true});
  assert.equal(m.change(visible,removed),'removed');assert.equal(m.change(removed,visible),'approved');
  assert.equal(m.change(visible,locked),'locked');assert.equal(m.change(locked,visible),'unlocked');
  assert.equal(m.change(removed,removed),null,'no duplicate on recheck');
  const unknown=m.classify({author:comment()});assert.equal(m.change(removed,unknown),null,'a failed check is not an approval');assert.equal(m.change(unknown,visible),null);
});

test('native author-visible text without public evidence never proves visibility or approval',()=>{
 const m=model(),author=post({visibilityKnown:false});assert.equal(m.classify({author}).state,'unknown');assert.match(m.classify({author}).why,/native.*public visibility/i);assert.doesNotMatch(m.classify({author}).why,/checks of comments/);
 const past=archived(10,{body:'[removed]'});const r=m.classify({author,archive:past});assert.notEqual(r.state,'visible');assert.equal(r.flags.includes('approved-after-auto'),false);
});
test('explicit native removal is evidence but does not identify its actor; negative archive latency is not automatic',()=>{
 const m=model(),author=comment({nativeRemoved:true,visibilityKnown:false});
 assert.equal(m.classify({author}).state,'removed-unknown');
 assert.equal(m.classify({author,archive:archived(-1,{body:'[removed]'})}).state,'removed-unknown');
 assert.equal(m.classify({author,archive:archived(25,{body:'[removed]'})}).state,'removed-auto');
});
test('native automatic and moderator verdict tooltips identify comments as comments',()=>{
 const m=model();for(const category of ['automod_filtered','moderator'])assert.match(m.classify({author:comment({removed_by_category:category})}).why,/this comment/);
});
