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
updateMessageStats();
