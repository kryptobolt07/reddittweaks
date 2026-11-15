const SETTINGS_KEY='rt-settings-v1';
const SETTINGS_DEFAULTS={postDiscovery:true,archiveDiscovery:false,restoreDeletedContent:true,subredditArchive:false,subredditArchiveAutomatic:false,cleanShareLinks:false,modUnapprovedFilter:true,raffles:true};

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
loadSettings().then(()=>{syncDependencies();syncSummary();});
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
}
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
  const controls=[...document.querySelectorAll('[data-setting]')],pill=document.querySelector('#raffles-home .state-pill');
  if(controls.some(c=>c.classList.contains('is-unavailable'))){const summary=document.getElementById('feature-summary');if(summary)summary.textContent='Settings unavailable';if(pill)pill.hidden=true;return;}
  const summary=document.getElementById('feature-summary');if(summary)summary.textContent=controls.filter(isActive).length+' of '+controls.length+' features on';
  for(const card of document.querySelectorAll('#panel-settings .card')){const own=[...card.querySelectorAll('[data-setting]')],count=card.querySelector('.group-count');if(count)count.textContent=own.filter(isActive).length+' of '+own.length+' on';}
  const raffles=document.getElementById('raffles'),card=document.getElementById('raffles-home');
  if(raffles && card){card.querySelector('.state-pill').textContent=raffles.checked?'On':'Off';card.dataset.state=raffles.checked?'on':'off';document.getElementById('raffles-turn-on').hidden=raffles.checked;}
}
document.addEventListener('change',event=>{if(event.target.matches?.('[data-setting]'))syncSummary();});
document.getElementById('raffles-turn-on')?.addEventListener('click',()=>{const raffles=document.getElementById('raffles');if(!raffles || raffles.disabled || raffles.checked)return;raffles.checked=true;raffles.dispatchEvent(new Event('change',{bubbles:true}));});

