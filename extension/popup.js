document.querySelector('#clear-cache').addEventListener('click',async()=>{
  const status=document.querySelector('#cache-status');
  try {
    const result=await chrome.runtime.sendMessage({scope:'rcs-directory',action:'clear'});
    status.textContent=result?.ok ? 'Saved usernames cleared. Refresh Reddit to rebuild.' : 'Could not clear the cache. Please retry.';
  } catch {status.textContent='Could not clear the cache. Please retry.';}
});
