/* Keep Reddit's native sharing UI and clipboard feedback; clean only the generated URL when opted in.
   Also strip ?tl= auto-translation parameters on page load and clicked links when enabled. */
(() => {
  'use strict';
  if(window.top!==window || globalThis.RTShareLinks || !globalThis.RTPostModel)return;
  const clean=RTPostModel.cleanShareUrl,stripTl=RTPostModel.stripTranslationParam;
  let enabled=false,stopTl=false,intent=null,textWrapper=null,itemWrapper=null;
  function cleanCurrentUrl(){
    if(!stopTl || typeof stripTl!=='function')return false;
    const cleaned=stripTl(location.href);
    if(!cleaned)return false;
    const key='rt-tl-reloaded:'+location.pathname,now=Date.now();
    let recent=false;
    try{const saved=Number(sessionStorage.getItem(key));recent=Number.isFinite(saved) && now-saved<10000;}catch{}
    if(!recent){
      try{sessionStorage.setItem(key,String(now));}catch{}
      try{location.replace(cleaned);return true;}catch{}
    }
    try{history.replaceState(history.state,'',cleaned);return true;}catch{return false;}
  }
  document.addEventListener('rt-clean-share-settings',event=>{enabled=event.detail===true;if(!enabled)intent=null;});
  document.addEventListener('rt-stop-tl-settings',event=>{stopTl=event.detail===true;if(stopTl)cleanCurrentUrl();});
  document.addEventListener('click',event=>{
    const path=event.composedPath();
    if(stopTl && typeof stripTl==='function'){
      const anchor=path.find(node=>node.matches?.('a[href]'));
      if(anchor){
        const cleaned=stripTl(anchor.href);
        if(cleaned)anchor.href=cleaned;
      }
    }
    if(!enabled)return;
    const share=path.some(node=>node.matches?.('shreddit-comment-share-button,shreddit-post-share-button') || node.matches?.('button,[role="button"]') && /^(?:Share|Share post|Share comment)$/i.test((node.getAttribute('aria-label') || node.textContent || '').trim()));
    if(!share)return;installClipboardCleaner();intent=null;
    const source=path.find(node=>node.matches?.('shreddit-comment-share-button[permalink],shreddit-post-share-button[permalink]')) || path.find(node=>node.matches?.('shreddit-comment[permalink],shreddit-post[permalink]'));
    const value=source?.getAttribute('permalink');
    if(value){try{const url=clean(new URL(value,location.origin).href);if(/^https:\/\/www\.reddit\.com\/(?:.*\/)?comments\//.test(url))intent={url,expires:Date.now()+15000};}catch{}}
  },true);
  const canonical=()=>intent && intent.expires>=Date.now()?intent.url:'';
  function installClipboardCleaner(){try{
    const clipboard=navigator.clipboard,original=clipboard?.writeText;
    if(typeof original==='function' && original!==textWrapper){textWrapper=function(value){const next=enabled?clean(value,canonical()):value;if(enabled)intent=null;return original.call(this,next);};Object.defineProperty(clipboard,'writeText',{configurable:true,writable:true,value:textWrapper});}
    const write=clipboard?.write;
    if(typeof write==='function' && write!==itemWrapper){itemWrapper=function(items){
      if(!enabled || !Array.isArray(items) || typeof ClipboardItem!=='function')return write.call(this,items);
      const source=canonical();intent=null;
      const next=items.map(item=>{
        // Reddit's native Copy link supplies a promise-backed plain-text ClipboardItem. Keep the
        // browser write inside the original user gesture; never read the existing clipboard.
        if(item?.types?.length!==1 || item.types[0]!=='text/plain' || typeof item.getType!=='function')return item;
        try{return new ClipboardItem({'text/plain':item.getType('text/plain').then(blob=>blob.text()).then(text=>new Blob([enabled?clean(text,source):text],{type:'text/plain'}))},{presentationStyle:item.presentationStyle});}catch{return item;}
      });
      return write.call(this,next);
    };Object.defineProperty(clipboard,'write',{configurable:true,writable:true,value:itemWrapper});}

  }catch{/* Browser clipboard restrictions keep Reddit's original behavior. */}}
  // Rebind on a Share gesture if native client modules or browser integrations replaced the API.
  // The replacement stays underneath the cleaner, retaining its permission checks and feedback.
  installClipboardCleaner();
  try{
    const original=navigator.share;
    if(typeof original==='function')navigator.share=function(data){return original.call(this,enabled && data && typeof data.url==='string'?{...data,url:clean(data.url,canonical())}:data);};
  }catch{/* Native sharing can be unavailable on desktop. */}
  globalThis.RTShareLinks=Object.freeze({cleanShareUrl:clean,stripTranslationParam:stripTl});
  document.dispatchEvent(new CustomEvent('rt-clean-share-ready'));
  document.dispatchEvent(new CustomEvent('rt-stop-tl-ready'));
})();
