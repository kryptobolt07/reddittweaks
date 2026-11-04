/* Keep Reddit's native sharing UI and clipboard feedback; clean only the generated URL when opted in. */
(() => {
  'use strict';
  if(window.top!==window || globalThis.RTShareLinks || !globalThis.RTPostModel)return;
  const clean=RTPostModel.cleanShareUrl;let enabled=false,intent=null;
  document.addEventListener('rt-clean-share-settings',event=>{enabled=event.detail===true;if(!enabled)intent=null;});
  document.addEventListener('click',event=>{
    if(!enabled)return;
    const path=event.composedPath(),share=path.some(node=>node.matches?.('shreddit-comment-share-button,shreddit-post-share-button') || node.matches?.('button,[role="button"]') && /^(?:Share|Share post|Share comment)$/i.test((node.getAttribute('aria-label') || node.textContent || '').trim()));
    if(!share)return;intent=null;
    const source=path.find(node=>node.matches?.('shreddit-comment-share-button[permalink],shreddit-post-share-button[permalink]')) || path.find(node=>node.matches?.('shreddit-comment[permalink],shreddit-post[permalink]'));
    const value=source?.getAttribute('permalink');
    if(value){try{const url=clean(new URL(value,location.origin).href);if(/^https:\/\/www\.reddit\.com\/(?:.*\/)?comments\//.test(url))intent={url,expires:Date.now()+15000};}catch{}}
  },true);
  const canonical=()=>intent && intent.expires>=Date.now()?intent.url:'';
  try{
    const clipboard=navigator.clipboard,original=clipboard?.writeText;
    if(typeof original==='function')Object.defineProperty(clipboard,'writeText',{configurable:true,writable:true,value:function(value){const next=enabled?clean(value,canonical()):value;if(enabled)intent=null;return original.call(this,next);}});
    const write=clipboard?.write;
    if(typeof write==='function')Object.defineProperty(clipboard,'write',{configurable:true,writable:true,value:function(items){
      if(!enabled || !Array.isArray(items) || typeof ClipboardItem!=='function')return write.call(this,items);
      const source=canonical();intent=null;
      const next=items.map(item=>{
        // Reddit's native Copy link supplies a promise-backed plain-text ClipboardItem. Keep the
        // browser write inside the original user gesture; never read the existing clipboard.
        if(item?.types?.length!==1 || item.types[0]!=='text/plain' || typeof item.getType!=='function')return item;
        try{return new ClipboardItem({'text/plain':item.getType('text/plain').then(blob=>blob.text()).then(text=>new Blob([enabled?clean(text,source):text],{type:'text/plain'}))},{presentationStyle:item.presentationStyle});}catch{return item;}
      });
      return write.call(this,next);
    }});

  }catch{/* Browser clipboard restrictions keep Reddit's original behavior. */}
  try{
    const original=navigator.share;
    if(typeof original==='function')navigator.share=function(data){return original.call(this,enabled && data && typeof data.url==='string'?{...data,url:clean(data.url,canonical())}:data);};
  }catch{/* Native sharing can be unavailable on desktop. */}
  globalThis.RTShareLinks=Object.freeze({cleanShareUrl:clean});
  document.dispatchEvent(new CustomEvent('rt-clean-share-ready'));
})();
