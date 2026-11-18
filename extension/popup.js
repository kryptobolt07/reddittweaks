const SETTINGS_KEY='rt-settings-v1';
const SETTINGS_DEFAULTS={postDiscovery:true,archiveDiscovery:false,restoreDeletedContent:true,subredditArchive:false,subredditArchiveAutomatic:false,cleanShareLinks:false,modUnapprovedFilter:true,raffles:true,ownRemoval:false,removalNotifications:false,smoothFeeds:true,smoothHome:true,smoothSubreddits:true,smoothProfiles:true,smoothSearch:true,smoothComments:false,videoRespectAutoplay:true,videoPauseOffscreen:true};

async function loadSettings() {
  const controls=[...document.querySelectorAll('[data-setting]')],status=document.querySelector('#settings-status');
  if(!controls.length)return;
  for(const control of controls)control.disabled=true;
  // Controls that cannot be read are shown as unavailable (neutral thumb, not a real "off").
  const markUnavailable=()=>{for(const control of controls){control.indeterminate=true;control.classList.add('is-unavailable');control.setAttribute('aria-disabled','true');}};
  if(!globalThis.chrome?.storage?.local?.get||!globalThis.chrome?.storage?.local?.set){
    markUnavailable();status.textContent='Settings storage unavailable.';status.classList.add('error');return;
  }
  let loaded=false;
  try {
    const stored=await chrome.storage.local.get(SETTINGS_KEY),settings={...SETTINGS_DEFAULTS,...(stored?.[SETTINGS_KEY]||{})};
    for(const control of controls)control.checked=control.dataset.setting==='restoreDeletedContent'?settings.restoreDeletedContent!==false:Boolean(settings[control.dataset.setting]);
    loaded=true;status.textContent='Settings saved automatically.';
    for(const control of controls)control.addEventListener('change',()=>saveSetting(control));
  } catch {
    markUnavailable();status.textContent='Could not load settings. Reopen the popup to retry.';status.classList.add('error');
  } finally {for(const control of controls)control.disabled=!loaded;}
}

let settingsWrite=Promise.resolve();
function saveSetting(control) {
  const status=document.querySelector('#settings-status'),key=control.dataset.setting,next=control.checked;
  control.disabled=true;status.classList.remove('error');status.textContent='Saving…';
  settingsWrite=settingsWrite.catch(()=>{}).then(async()=>{
    const storage=globalThis.chrome?.storage?.local;
    if(!storage?.get||!storage?.set)throw Error('storage unavailable');
    const latest=await storage.get(SETTINGS_KEY),merged={...SETTINGS_DEFAULTS,...(latest?.[SETTINGS_KEY]||{}),[key]:next};
    await storage.set({[SETTINGS_KEY]:merged});
  }).then(()=>{status.textContent='Settings saved automatically.';},()=>{
    control.checked=!next;syncDependencies();syncSummary();status.textContent='Could not save this setting. Please retry.';status.classList.add('error');
  }).finally(()=>{control.disabled=false;});
  return settingsWrite;
}

// History length (docs/viewed-history-spec.md): 20 is Reddit's own limit and records nothing; 0 is no limit.
const HISTORY_LIMITS=[20,100,500,1000,5000,0];
async function loadHistoryLimit(){
  const trigger=document.getElementById('history-limit'),menu=document.getElementById('history-limit-menu'),storage=globalThis.chrome?.storage?.local;
  if(!trigger || !menu || !storage?.get || !storage?.set)return;
  document.body.append(menu); // The settings panel's fade mask must not clip this viewport overlay.
  const options=[...menu.querySelectorAll('[role="menuitemradio"]')],labels=['20','100','500','1,000','5,000','No limit'];let saved=20;
  const paint=()=>{trigger.querySelector('[data-history-value]').textContent=labels[HISTORY_LIMITS.indexOf(saved)];trigger.setAttribute('aria-label','History length: '+labels[HISTORY_LIMITS.indexOf(saved)]);for(const option of options){option.setAttribute('aria-checked',String(Number(option.dataset.value)===saved));option.tabIndex=-1;}};
  const close=(focus=false)=>{menu.hidden=true;trigger.setAttribute('aria-expanded','false');if(focus)trigger.focus({preventScroll:true});};
  const open=()=>{if(trigger.disabled)return;paint();const width=Math.max(0,Math.min(164,innerWidth-16)),maxHeight=Math.max(0,innerHeight-16);menu.style.width=width+'px';menu.style.maxHeight=maxHeight+'px';menu.hidden=false;const rect=trigger.getBoundingClientRect(),height=Math.min(menu.getBoundingClientRect().height || 180,maxHeight);menu.style.left=Math.max(8,Math.min(rect.right-width,innerWidth-width-8))+'px';menu.style.top=Math.max(8,Math.min(rect.bottom+4,innerHeight-height-8))+'px';trigger.setAttribute('aria-expanded','true');options.find(o=>Number(o.dataset.value)===saved)?.focus({preventScroll:true});};
  trigger.addEventListener('click',()=>menu.hidden?open():close());
  trigger.addEventListener('keydown',event=>{if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();open();}});
  menu.addEventListener('keydown',event=>{const index=options.indexOf(document.activeElement);if(event.key==='Escape'){event.preventDefault();close(true);}else if(event.key==='Tab')close();else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();options[event.key==='Home'?0:event.key==='End'?options.length-1:(index+(event.key==='ArrowDown'?1:-1)+options.length)%options.length].focus();}});
  document.addEventListener('click',event=>{if(!menu.contains(event.target) && !trigger.contains(event.target))close();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape' && !menu.hidden)close(true);});
  document.addEventListener('scroll',event=>{if(!menu.hidden && !menu.contains(event.target))close();},true);
  for(const option of options)option.addEventListener('click',()=>{
    if(trigger.disabled)return;const next=Number(option.dataset.value);close(true);if(next===saved)return;
    const status=document.querySelector('#settings-status');trigger.disabled=true;status.classList.remove('error');status.textContent='Saving…';
    settingsWrite=settingsWrite.catch(()=>{}).then(async()=>{const latest=await storage.get(SETTINGS_KEY);await storage.set({[SETTINGS_KEY]:{...SETTINGS_DEFAULTS,...(latest?.[SETTINGS_KEY] || {}),historyLimit:next}});saved=next;paint();})
      .then(()=>{status.textContent='Settings saved automatically.';},()=>{paint();status.textContent='Could not save this setting. Please retry.';status.classList.add('error');}).finally(()=>{trigger.disabled=false;});
  });
  try{const stored=(await storage.get(SETTINGS_KEY))?.[SETTINGS_KEY] || {};saved=HISTORY_LIMITS.includes(stored.historyLimit)?stored.historyLimit:20;paint();trigger.disabled=false;}
  catch{trigger.disabled=true;}
}
loadHistoryLimit();

async function updateMessageStats() {
  const element=document.querySelector('#message-stats');
  try {
    const result=await chrome.runtime.sendMessage({scope:'rcs-messages',action:'stats'});
    if(!result?.ok)throw Error('Cache unavailable');
    const stats=result.stats || {},bytes=stats.approxBytes || 0;
    const size=bytes<1048576 ? `${Math.ceil(bytes/1024).toLocaleString()} KB` : `${(bytes/1048576).toFixed(1)} MB`;
    element.textContent=`${(stats.messages || 0).toLocaleString()} saved messages · ${(stats.rooms || 0).toLocaleString()} chats · ${size} estimated data`;
  } catch {element.textContent='Statistics unavailable. Reopen to retry.';}
}
// Both clear actions remove data for every Reddit account on this device, so the first click only arms a confirmation:
// the button label and the reserved status line change (the popup never resizes), and a second click within a few seconds confirms.
const CONFIRM_MS=5000;let armed=null;
function disarm(){
  if(!armed)return;clearTimeout(armed.timer);armed.button.classList.remove('confirming');armed.button.textContent=armed.label;
  const status=document.querySelector('#cache-status');if(status.dataset.confirming)status.textContent='';delete status.dataset.confirming;armed=null;
}
function clearAction(id,{scope,label,warning,done,failed,after}){
  const button=document.querySelector(id),status=document.querySelector('#cache-status');
  button.addEventListener('click',async()=>{
    if(armed?.button!==button){
      disarm();
      armed={button,label:button.textContent,timer:setTimeout(disarm,CONFIRM_MS)};
      button.classList.add('confirming');button.textContent='Confirm clear';
      status.dataset.confirming='1';status.textContent=warning;return;
    }
    disarm();status.textContent='';button.disabled=true;
    try {
      const result=await chrome.runtime.sendMessage({scope,action:'clear'});
      status.textContent=result?.ok ? done : failed;
      if(result?.ok && after)await after();
    } catch {status.textContent=failed;}
    finally {button.disabled=false;}
  });
}
clearAction('#clear-cache',{scope:'rcs-directory',warning:'Clears saved usernames for every Reddit account on this device. Click Confirm clear to proceed.',done:'Saved usernames cleared. Refresh Reddit to rebuild.',failed:'Could not clear the cache. Please retry.'});
clearAction('#clear-messages',{scope:'rcs-messages',warning:'Clears saved messages for every Reddit account on this device. Click Confirm clear to proceed.',done:'Saved messages cleared. Open chats can save newly received messages.',failed:'Could not clear saved messages. Please retry.',after:updateMessageStats});
document.addEventListener('keydown',event=>{if(event.key==='Escape')disarm();});
document.addEventListener('click',event=>{if(armed && event.target!==armed.button)disarm();});
// About-history overlay: toggled by its trigger, the × button, Escape, or any click/focus outside it.
const aboutWrap=document.querySelector('#cache-about'),aboutButton=document.querySelector('#cache-info-toggle'),aboutPanel=document.querySelector('#cache-info-panel');
function setAbout(open,restoreFocus=false){
  aboutPanel.hidden=!open;aboutButton.setAttribute('aria-expanded',String(open));
  if(open)aboutPanel.querySelector('.popover-close').focus({preventScroll:true});else if(restoreFocus)aboutButton.focus({preventScroll:true});
}
aboutButton.addEventListener('click',()=>setAbout(aboutPanel.hidden));
aboutPanel.querySelector('.popover-close').addEventListener('click',()=>setAbout(false,true));
aboutWrap.addEventListener('focusout',event=>{if(!aboutPanel.hidden && !aboutWrap.contains(event.relatedTarget))setAbout(false);});
document.addEventListener('click',event=>{if(!aboutPanel.hidden && !aboutWrap.contains(event.target))setAbout(false);});
document.addEventListener('keydown',event=>{if(event.key==='Escape' && !aboutPanel.hidden)setAbout(false,true);});
// Dependent settings look inactive until the setting they need is on, and say which one that is.
function syncDependencies(){
  for(const row of document.querySelectorAll('.setting-row[data-requires]')){
    const parent=document.getElementById(row.dataset.requires),ancestor=parent?.closest('.setting-row[data-requires]');
    const active=Boolean(parent?.checked) && (!ancestor || !ancestor.classList.contains('is-inactive'));
    row.classList.toggle('is-inactive',!active);
    // Name the switch nearest the top of the chain that is off: turning that on comes first.
    let blocker=null;for(let at=parent;at;){if(!at.checked)blocker=at;const up=at.closest('.setting-row[data-requires]');at=up?document.getElementById(up.dataset.requires):null;}
    // Options refining a switch in the same card fold away until it's on; a card's first option stays, dimmed.
    row.hidden=!active && parent?.closest('.card')===row.closest('.card');
    let note=row.querySelector('.requires-note');
    if(!active && blocker && !row.hidden){if(!note){note=document.createElement('p');note.className='requires-note';row.querySelector('.setting-copy').append(note);}note.textContent='Needs “'+(document.querySelector('label[for="'+blocker.id+'"]')?.textContent || 'the setting above')+'”';}
    else note?.remove();
    const control=row.querySelector('[data-setting]');if(control && !control.classList.contains('is-unavailable')){if(active)control.removeAttribute('aria-disabled');else control.setAttribute('aria-disabled','true');}
  }
}
document.addEventListener('change',event=>{if(event.target.matches?.('[data-setting]'))syncDependencies();});
try{const manifest=globalThis.chrome?.runtime?.getManifest?.();const version=document.querySelector('#version');if(manifest && version)version.textContent='v'+(manifest.version_name || manifest.version).replace(/ preview$/,'');}catch{}
loadSettings().then(()=>{syncDependencies();syncSummary();for(const panel of document.querySelectorAll('.panel:not([hidden])'))syncFade(panel);});
updateMessageStats();

// Redaction runs on Reddit itself (docs/redaction-spec.md); the fragment opens its dialog there.
document.getElementById('open-redaction')?.addEventListener('click',async event=>{
  const button=event.currentTarget;button.disabled=true;
  try{
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    let url;try{url=new URL(tab?.url);}catch{}
    if(tab?.id!=null && url?.protocol==='https:' && ['reddit.com','www.reddit.com','new.reddit.com','sh.reddit.com'].includes(url.hostname)){
      // Ask the page to open the dialog in place. Changing the address (even only its #fragment) makes Reddit's router
      // redraw parts of the page, such as the right sidebar; the fragment is only for a tab whose script isn't connected.
      let opened=false;try{opened=(await chrome.tabs.sendMessage(tab.id,{scope:'rt-redact',action:'open'},{frameId:0}))?.opened===true;}catch{}
      if(!opened){url.hash='rt-redact';await chrome.tabs.update(tab.id,{url:url.href});}
    }else await chrome.tabs.create({url:'https://www.reddit.com/user/me/#rt-redact'});
    window.close?.();
  }catch{button.disabled=false;document.getElementById('redaction-open-status').textContent='Couldn’t open Redaction. Open a Reddit page and try again.';}
});

// --- Sections (docs: popup redesign 0.36): Home has things to run, Settings the switches, Data the saved history.
const TAB_KEY='rt-popup-tab',tabs=[...document.querySelectorAll('[role="tab"]')];
function showTab(name,{focus=false}={}){
  const tab=tabs.find(t=>t.dataset.tab===name) || tabs[0];
  for(const t of tabs){const on=t===tab;t.setAttribute('aria-selected',String(on));t.tabIndex=on?0:-1;document.getElementById(t.getAttribute('aria-controls')).hidden=!on;}
  if(focus)tab.focus({preventScroll:true});
  try{localStorage.setItem(TAB_KEY,tab.dataset.tab);}catch{}
  syncFade(document.getElementById(tab.getAttribute('aria-controls')));
}
// No scrollbar: a panel with more content fades at the edge where it continues.
function syncFade(panel){if(!panel)return;const room=panel.scrollHeight-panel.clientHeight,top=panel.scrollTop;panel.dataset.more=room<=1?'none':top<=1?'end':top>=room-1?'start':'both';}
for(const panel of document.querySelectorAll('.panel'))panel.addEventListener('scroll',()=>syncFade(panel),{passive:true});
document.addEventListener('change',()=>{for(const panel of document.querySelectorAll('.panel:not([hidden])'))syncFade(panel);});
for(const tab of tabs){
  tab.addEventListener('click',()=>showTab(tab.dataset.tab));
  tab.addEventListener('keydown',event=>{
    const at=tabs.indexOf(tab),next={ArrowRight:(at+1)%tabs.length,ArrowLeft:(at-1+tabs.length)%tabs.length,Home:0,End:tabs.length-1}[event.key];
    if(next==null)return;event.preventDefault();showTab(tabs[next].dataset.tab,{focus:true});
  });
}
{let saved='';try{saved=localStorage.getItem(TAB_KEY) || '';}catch{}showTab(saved || 'home');}
document.getElementById('manage-features')?.addEventListener('click',()=>showTab('settings',{focus:true}));

// A feature counts as on when its switch is on and everything it needs is on too.
const isActive=control=>control.checked && !control.closest('.setting-row')?.classList.contains('is-inactive');
function syncSummary(){
  // Sub-options of a feature (data-detail rows) refine it and are not counted as features of their own.
  const counted=c=>!c.closest('.setting-row')?.hasAttribute('data-detail');
  const controls=[...document.querySelectorAll('[data-setting]')].filter(counted),pill=document.querySelector('#raffles-home .state-pill');
  if(controls.some(c=>c.classList.contains('is-unavailable'))){const summary=document.getElementById('feature-summary');if(summary)summary.textContent='Settings unavailable';if(pill)pill.hidden=true;return;}
  const summary=document.getElementById('feature-summary');if(summary)summary.textContent=controls.filter(isActive).length+' of '+controls.length+' features on';
  for(const card of document.querySelectorAll('#panel-settings .card')){const own=[...card.querySelectorAll('[data-setting]')].filter(counted),count=card.querySelector('.group-count');if(count)count.textContent=own.filter(isActive).length+' of '+own.length+' on';}
  const raffles=document.getElementById('raffles'),card=document.getElementById('raffles-home');
  if(raffles && card){card.querySelector('.state-pill').textContent=raffles.checked?'On':'Off';card.dataset.state=raffles.checked?'on':'off';document.getElementById('raffles-turn-on').hidden=raffles.checked;}
}
document.addEventListener('change',event=>{if(event.target.matches?.('[data-setting]'))syncSummary();});
document.getElementById('raffles-turn-on')?.addEventListener('click',()=>{const raffles=document.getElementById('raffles');if(!raffles || raffles.disabled || raffles.checked)return;raffles.checked=true;raffles.dispatchEvent(new Event('change',{bubbles:true}));});

// The active Reddit tab supplies identity; clearing never touches another account's saved checks.
// Removed and its recent changes live on your profile; the popup only offers clearing (with the removal settings).
let removalTab=null,removalAccount=null,removalClearTimer=null;
async function loadRemovalSummary(){
  const clear=document.getElementById('clear-removal-history');if(!clear)return;
  try{
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});if(!Number.isInteger(tab?.id) || !/^https:\/\/(?:www\.|new\.|sh\.)?reddit\.com\//.test(tab.url || ''))throw Error('Open a signed-in Reddit tab to manage your checks.');
    const result=await chrome.runtime.sendMessage({scope:'rt-removal',action:'summary',tabId:tab.id});if(!result?.ok || !/^[\w-]{1,20}$/.test(result.value?.username || ''))throw Error(result?.error || 'Removal history is unavailable. Refresh Reddit to retry.');
    removalTab=tab.id;removalAccount=result.value;clear.disabled=false;
  }catch{removalAccount=null;removalTab=null;clear.disabled=true;}
}
document.getElementById('clear-removal-history')?.addEventListener('click',async event=>{
  const button=event.currentTarget;if(removalTab==null)return;
  if(!removalClearTimer){button.textContent='Confirm clear for u/'+removalAccount.username;removalClearTimer=setTimeout(()=>{removalClearTimer=null;button.textContent='Clear this account’s checks';},6000);return;}
  clearTimeout(removalClearTimer);removalClearTimer=null;button.disabled=true;
  try{const result=await chrome.runtime.sendMessage({scope:'rt-removal',action:'clear',tabId:removalTab,owner:removalAccount?.owner});if(!result?.ok)throw Error(result?.error);document.getElementById('removal-status').textContent='This account’s checks cleared. New observations start a fresh baseline.';await loadRemovalSummary();}
  catch{document.getElementById('removal-status').textContent='Could not clear checks. Please retry.';}finally{button.disabled=removalTab==null;button.textContent='Clear this account’s checks';}
});
loadRemovalSummary();

