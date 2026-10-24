const SETTINGS_KEY='rt-settings-v1';
const SETTINGS_DEFAULTS={postDiscovery:true,archiveDiscovery:false};

async function loadSettings() {
  const controls=[...document.querySelectorAll('[data-setting]')],status=document.querySelector('#settings-status');
  if(!controls.length)return;
  for(const control of controls)control.disabled=true;
  if(!globalThis.chrome?.storage?.local?.get||!globalThis.chrome?.storage?.local?.set){
    status.textContent='Settings storage unavailable.';status.classList.add('error');return;
  }
  let loaded=false;
  try {
    const stored=await chrome.storage.local.get(SETTINGS_KEY),settings={...SETTINGS_DEFAULTS,...(stored?.[SETTINGS_KEY]||{})};
    for(const control of controls)control.checked=Boolean(settings[control.dataset.setting]);
    loaded=true;status.textContent='Settings saved automatically.';
    for(const control of controls)control.addEventListener('change',()=>saveSetting(control));
  } catch {
    status.textContent='Could not load settings. Reopen the popup to retry.';status.classList.add('error');
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
    control.checked=!next;status.textContent='Could not save this setting. Please retry.';status.classList.add('error');
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
  } catch {element.textContent='Saved-message statistics unavailable. Reopen this popup to retry.';}
}
document.querySelector('#clear-cache').addEventListener('click',async()=>{
  const status=document.querySelector('#cache-status');
  try {
    const result=await chrome.runtime.sendMessage({scope:'rcs-directory',action:'clear'});
    status.textContent=result?.ok ? 'Saved usernames cleared. Refresh Reddit to rebuild.' : 'Could not clear the cache. Please retry.';
  } catch {status.textContent='Could not clear the cache. Please retry.';}
});
document.querySelector('#clear-messages').addEventListener('click',async()=>{
  const button=document.querySelector('#clear-messages'),status=document.querySelector('#cache-status');button.disabled=true;
  try {
    const result=await chrome.runtime.sendMessage({scope:'rcs-messages',action:'clear'});
    status.textContent=result?.ok ? 'Saved messages cleared. Open chats can save newly received messages.' : 'Could not clear saved messages. Please retry.';
    if(result?.ok)await updateMessageStats();
  } catch {status.textContent='Could not clear saved messages. Please retry.';}
  finally {button.disabled=false;}
});
loadSettings();
updateMessageStats();
