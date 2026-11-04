const SETTINGS_KEY='rt-settings-v1';
const SETTINGS_DEFAULTS={postDiscovery:true,archiveDiscovery:false,restoreDeletedContent:true,subredditArchive:false,subredditArchiveAutomatic:false,cleanShareLinks:false};

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
    control.checked=!next;syncDependencies();status.textContent='Could not save this setting. Please retry.';status.classList.add('error');
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
// Dependent settings look inactive until the setting they need is on.
function syncDependencies(){
  for(const row of document.querySelectorAll('.setting-row[data-requires]')){
    const parent=document.getElementById(row.dataset.requires),ancestor=parent?.closest('.setting-row[data-requires]');
    const active=Boolean(parent?.checked) && (!ancestor || !ancestor.classList.contains('is-inactive'));
    row.classList.toggle('is-inactive',!active);
    const control=row.querySelector('[data-setting]');if(control && !control.classList.contains('is-unavailable')){if(active)control.removeAttribute('aria-disabled');else control.setAttribute('aria-disabled','true');}
  }
}
document.addEventListener('change',event=>{if(event.target.matches?.('[data-setting]'))syncDependencies();});
try{const manifest=globalThis.chrome?.runtime?.getManifest?.();const version=document.querySelector('#version');if(manifest && version)version.textContent='v'+(manifest.version_name || manifest.version).replace(/ preview$/,'');}catch{}
loadSettings().then(syncDependencies);
updateMessageStats();
