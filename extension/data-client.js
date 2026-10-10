(() => {
  document.addEventListener('rcs-traffic-request',async event=>{
    let value;try{value=JSON.parse(event.detail);}catch{return;}
    if(typeof value?.id!=='string' || value.id.length>100 || !['traffic-acquire','traffic-renew','traffic-release','traffic-cooldown'].includes(value.action))return;
    let reply;
    try {
      reply=globalThis.chrome?.runtime?.sendMessage ? await chrome.runtime.sendMessage({scope:'rcs-directory',...value}) : {ok:true,unsupported:true};
    } catch {reply={ok:false};}
    document.dispatchEvent(new CustomEvent('rcs-traffic-response',{detail:JSON.stringify({...reply,id:value.id})}));
  });
  const channel=crypto.randomUUID();
  const pending=new Map();
  document.addEventListener('rcs-v2-response',event => {
    let response;try {response=JSON.parse(event.detail);}catch{return;}
    if (response.channel!==channel) return;
    const task=pending.get(response.id);if(!task)return;
    if (response.progress) {clearTimeout(task.timeout);task.timeout=setTimeout(task.expire,120000);task.onProgress?.(response.progress);return;}
    pending.delete(response.id);clearTimeout(task.timeout);
    if(response.historyMeta && Array.isArray(response.result))Object.defineProperty(response.result,'historyMeta',{value:response.historyMeta});
    response.error ? task.reject(new Error(response.error)) : task.resolve(response.result);
  });
  function request(method,parameters={},onProgress) {
    const id=crypto.randomUUID();
    const promise=new Promise((resolve,reject)=>{
      const expire=()=>{pending.delete(id);reject(new Error('Reddit took too long to respond. Please retry.'));send('cancel',id,{});};
      const timeout=setTimeout(expire,120000);
      pending.set(id,{resolve,reject,onProgress,timeout,expire});
      send(method,id,parameters);
    });
    return {promise,setDates:dates=>send('history-range',id,{dates}),cancel:()=>{send('cancel',id,{});const task=pending.get(id);if(task){pending.delete(id);clearTimeout(task.timeout);task.reject(new Error('Search cancelled'));}}};
  }
  function send(method,id,parameters){document.dispatchEvent(new CustomEvent('rcs-v2-request',{detail:JSON.stringify({channel,id,method,...parameters})}));}
  globalThis.RCSData=Object.freeze({request});
})();
