/* Removal detection for the signed-in user's own posts and comments (docs/own-removal-detection-spec.md).
   Pure classification: no network, no DOM. Callers gather the evidence:
   - author: the item as the signed-in author sees it (Reddit listing / thread JSON);
   - publicView: what a logged-out visitor sees, when a public check exists (phase 0 found none for comments, §9.1);
   - archive: the Arctic Shift capture (body, retrieved_on, removed_by_category), when "Use the archive" is on.
   Rules follow §4.2 in order; the first match wins. Never claims "visible" without evidence that others see it. */
(() => {
  'use strict';
  if(globalThis.RTRemovalModel)return;
  // Reveddit's AUTOMOD_LATENCY_THRESHOLD: captured already removed this soon after posting means automatic removal.
  const AUTO_LATENCY=25;
  const adminCategories=new Set(['anti_evil_ops','content_takedown','copyright_takedown','community_ops']);
  const removedBodies=new Set(['[removed]','[ Removed by Reddit ]','[Removed by Reddit]','[ Removed by moderator ]']);
  const STATES=Object.freeze({
    'visible':{label:'',confidence:'verified'},
    'removed-admin':{label:'Removed by Reddit'},
    'removed-filter':{label:'Removed by Reddit’s filters'},
    'removed-auto':{label:'Removed automatically'},
    'removed-mod':{label:'Removed by moderators'},
    'removed-unknown':{label:'Removed: moderators or automatic'},
    'deleted':{label:'Deleted by you'},
    'unknown':{label:'Couldn’t check'}
  });
  const text=value=>typeof value==='string'?value.trim():'';
  const isRemovedBody=value=>removedBodies.has(text(value));
  const isDeletedBody=value=>text(value)==='[deleted]';
  const minutes=seconds=>{const m=Math.round(seconds/60);return m<1?Math.max(0,Math.round(seconds))+' seconds':m<60?m+(m===1?' minute':' minutes'):Math.round(m/60)+(Math.round(m/60)===1?' hour':' hours');};

  // Normalise one Reddit or Arctic Shift record into the fields the rules read.
  function evidence(raw){
    if(!raw || typeof raw!=='object')return null;
    const kind=raw.kind==='comment' || /^t1_/.test(raw.name || '') || 'body' in raw && !('title' in raw)?'comment':'post';
    return {kind,body:kind==='comment'?raw.body:raw.selftext ?? raw.body,created:Number(raw.created_utc ?? raw.created) || 0,retrievedOn:Number(raw.retrieved_on ?? raw.retrievedOn) || 0,
      category:raw.removed_by_category ?? raw.removedByCategory ?? null,removalReason:raw.removal_reason ?? raw.removalReason ?? null,
      locked:raw.locked===true,collapsed:raw.collapsed===true && (raw.collapsed_because_crowd_control===true || raw.collapsed_reason_code==='CROWD_CONTROL' || raw.collapsedByCrowdControl===true),
      subredditType:raw.subreddit_type ?? raw.subredditType ?? 'public',quarantined:raw.quarantine===true || raw.quarantined===true,author:raw.author ?? '',visibilityKnown:raw.visibilityKnown!==false,nativeRemoved:raw.nativeRemoved===true};
  }

  function result(state,{confidence,why,flags=[]}={}){
    const meta=STATES[state];return {state,label:meta.label,confidence:confidence || meta.confidence || 'likely',why:why || '',flags:[...new Set(flags)],removed:state.startsWith('removed-')};
  }

  /* classify({author,publicView,archive,archiveStatus})
     publicView: null when no public check exists for this kind; {status:'failed'|'rate-limited'} on failure;
       otherwise {body, missing, collapsed, locked}.
     archiveStatus: 'ok' | 'off' | 'failed' | 'missing' (archive on, no capture). */
  function classify({author,publicView=null,archive=null,archiveStatus=archive?'ok':'off'}={}){
    const a=evidence(author),arc=evidence(archive);
    if(!a)return result('unknown',{confidence:'unknown',why:'Reddit didn’t return this item.'});
    const flags=[];if(a.locked || publicView?.locked)flags.push('locked');if(publicView?.collapsed || a.collapsed)flags.push('collapsed');if(a.quarantined)flags.push('quarantined-community');
    // 1. Deleted by you.
    if(isDeletedBody(a.body) || a.category==='deleted' || a.category==='author')return result('deleted',{confidence:'verified',why:'You deleted this.',flags});
    // L5: a logged-out visitor can't see private communities at all, so "others can't see it" means nothing there.
    if(['private','employees_only','gold_restricted'].includes(String(a.subredditType).toLowerCase()))return result('unknown',{confidence:'unknown',why:'Can’t check: private community.',flags:[...flags,'private-community']});
    // 2. Reddit itself.
    if(a.removalReason || adminCategories.has(a.category))return result('removed-admin',{confidence:'verified',why:'Reddit marks this '+a.kind+' as removed by Reddit.',flags});
    if(a.category==='reddit')return result('removed-filter',{confidence:a.kind==='post'?'verified':'likely',why:'Reddit marks this '+a.kind+' as removed by its filters.',flags});
    // 3, 4. Categories Reddit gives the author of a post.
    if(a.category==='automod_filtered')return result('removed-auto',{confidence:'verified',why:'Reddit marks this '+a.kind+' as removed automatically (AutoModerator or the spam filter).',flags});
    if(a.category==='moderator')return result('removed-mod',{confidence:'verified',why:'Reddit marks this '+a.kind+' as removed by moderators.',flags});
    const latency=arc && arc.retrievedOn && a.created?arc.retrievedOn-a.created:null;
    const archiveRemoved=Boolean(arc) && (isRemovedBody(arc.body) || ['automod_filtered','moderator','reddit'].includes(arc.category) || adminCategories.has(arc.category));
    const source=()=>{
      if(archiveRemoved && latency!=null && latency>=0 && latency<=AUTO_LATENCY)return result('removed-auto',{confidence:'likely',why:'The archive saw it already removed '+minutes(latency)+' after posting, so it was likely removed automatically.',flags});
      if(arc && !archiveRemoved && latency!=null)return result('removed-mod',{confidence:'likely',why:'The archive saw it still visible '+minutes(latency)+' after posting, so it was likely removed later by a moderator.',flags});
      return result('removed-unknown',{confidence:'likely',why:arc?'The archive saw it removed '+(latency!=null?minutes(latency)+' after posting':'')+', too late to tell who removed it.':'Others can’t see it; there is no archive copy to tell who removed it.',flags});
    };
    // Posts: Reddit tells the author the removal category, so no category means others see it (rules 6 and 7).
    if(a.nativeRemoved)return source();
    if(a.kind==='post' && a.visibilityKnown && !isRemovedBody(a.body)){
      if(archiveRemoved)return result('visible',{confidence:'verified',why:arc.category==='reddit'?'Reddit\u2019s filters held it at first; it\u2019s visible now, so it was approved.':'The archive saw it removed '+(latency!=null?minutes(latency)+' after posting':'')+'; Reddit shows it now, so a moderator approved it.',flags:[...flags,'approved-after-auto']});
      return result('visible',{confidence:'verified',why:'',flags});
    }
    // 5–7. A public view, when one exists.
    if(publicView && !['failed','rate-limited'].includes(publicView.status)){
      if(publicView.missing || isRemovedBody(publicView.body))return source();
      if(isDeletedBody(publicView.body))return result('deleted',{confidence:'verified',why:'You deleted this.',flags});
      if(archiveRemoved)return result('visible',{confidence:'verified',why:'The archive saw it removed; others see it now, so a moderator approved it.',flags:[...flags,'approved-after-auto']});
      return result('visible',{confidence:'verified',why:'',flags});
    }
    // No public view (comments today, §9.1): only an archive capture of the removal is evidence.
    if(archiveRemoved)return source();
    if(publicView)return result('unknown',{confidence:'unknown',why:publicView.status==='rate-limited'?'Couldn’t check: Reddit is limiting requests. Try again later.':'Couldn’t check: the check failed.',flags});
    if(!a.visibilityKnown)return result('unknown',{confidence:'unknown',why:'Couldn’t check: native metadata does not establish public visibility.'+(archiveStatus==='off'?' Turn on “Use the archive” to see historical removal evidence.':archiveStatus==='failed'?' The archive didn’t answer.':''),flags});
    return result('unknown',{confidence:'unknown',why:'Couldn’t check: Reddit blocks logged-out checks of comments.'+(archiveStatus==='off'?' Turn on “Use the archive” to catch removals the archive saw.':archiveStatus==='failed'?' The archive didn’t answer.':''),flags});
  }

  // Background-check bookkeeping: what changed between two results, for notifications (U4).
  function change(before,after){
    if(!before || !after || before.state===after.state && before.flags.includes('locked')===after.flags.includes('locked'))return null;
    if(after.state==='unknown' || before.state==='unknown' && !after.removed)return null;
    if(!before.removed && after.removed)return 'removed';
    if(before.removed && after.state==='visible')return 'approved';
    if(!before.flags.includes('locked') && after.flags.includes('locked'))return 'locked';
    if(before.flags.includes('locked') && !after.flags.includes('locked'))return 'unlocked';
    return null;
  }

  globalThis.RTRemovalModel=Object.freeze({AUTO_LATENCY,STATES,classify,change,evidence,isRemovedBody});
})();
