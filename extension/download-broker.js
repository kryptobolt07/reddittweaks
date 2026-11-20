(() => {
  'use strict';
  const Model=globalThis.RTDownloadModel;
  function cleanFilename(value) {
    if(typeof value!=='string' || !value || value.length>240 || /[\\/]/.test(value) || /[\u0000-\u001f\u007f]/.test(value))return '';
    return Model.safeFilename(value,'');
  }
  function startDownload(options) {
    return new Promise((resolve,reject)=>{
      let settled=false;
      const finish=(id,error)=>{
        if(settled)return;
        settled=true;
        if(error)reject(error);
        else if(Number.isInteger(id) && id>0)resolve(id);
        else reject(Error('The browser did not start the download.'));
      };
      const callback=id=>{
        const error=chrome.runtime.lastError;
        finish(id,error?Error(error.message || 'Unable to download this media.'):null);
      };
      try{
        const result=chrome.downloads.download(options,callback);
        if(result && typeof result.then==='function')result.then(id=>finish(id),error=>finish(null,error));
        else if(result!==undefined)finish(result);
      }catch(error){finish(null,error);}
    });
  }
  async function downloadOne(file) {
    const url=Model.safeDownloadUrl(file?.url);
    const filename=cleanFilename(file?.filename);
    if(!url || !filename)throw Error('Invalid media download.');
    if(!chrome.downloads?.download)throw Error('Downloads are unavailable.');
    return startDownload({url,filename,conflictAction:'uniquify',saveAs:false});
  }
  async function handle(message,sender) {
    if(sender?.id!==chrome.runtime.id || (sender.frameId ?? 0)!==0)throw Error('Invalid sender');
    if(!Model.isRedditPage(sender.url || sender.tab?.url || ''))throw Error('Invalid message origin');
    if(!Array.isArray(message.files) || !message.files.length || message.files.length>Model.MAX_FILES)throw Error('Invalid media download.');
    const files=[];
    for(const file of message.files){
      try{files.push({ok:true,id:await downloadOne(file)});}
      catch(error){files.push({ok:false,error:error?.message || 'Unable to download this media.'});}
    }
    return {ok:files.every(file=>file.ok),files};
  }
  globalThis.RTDownloadBroker=Object.freeze({handle,cleanFilename,downloadOne,startDownload});
  chrome.runtime.onMessage.addListener((message,sender,respond)=>{
    if(message?.scope!=='rt-download')return;
    handle(message,sender).then(value=>respond(value),error=>respond({ok:false,error:error?.message || 'Unable to download this media.'}));
    return true;
  });
})();
