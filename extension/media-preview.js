/* Small lazy thumbnails; image bytes and credentials are never stored here. */
(() => {
  const label=record=>record.attachmentMime==='image/gif'?'GIF':'Image';
  const make=(tag,className,text)=>{const el=document.createElement(tag);el.className=className;if(text)el.textContent=text;return el;};
  class View {
    constructor(){this.images=new Map();}
    render(record,{prefix='',compact=false}={}){
      const root=make('span','media-snippet'+(compact?' compact-media':'')),caption=label(record);
      const source=globalThis.RCSMessageStore?.previewURL(record.attachmentPreview) || '';
      const key=JSON.stringify([record.roomId,record.id || record.timestamp,compact,source]);
      let thumb=this.images.get(key);
      if(!thumb){
        thumb=make('span','media-thumb');const fallback=make('span','media-placeholder','▧');fallback.setAttribute('aria-hidden','true');thumb.append(fallback);
        if(source){const img=make('img','media-image');img.alt=caption+' preview';img.setAttribute('loading','lazy');img.setAttribute('decoding','async');img.setAttribute('referrerpolicy','no-referrer');img.width=compact?28:60;img.height=compact?20:44;
          img.addEventListener('load',()=>{fallback.hidden=true;});img.addEventListener('error',()=>{img.hidden=true;fallback.hidden=false;thumb.title='Preview unavailable; open the message to view it.';});img.src=source;thumb.append(img);
        }else thumb.title='Preview unavailable; open the message to view it.';
        this.images.set(key,thumb);
      }else{this.images.delete(key);this.images.set(key,thumb);}
      const image=thumb.querySelector('img');if(image && image.alt!==caption+' preview')image.alt=caption+' preview';
      while(this.images.size>160)this.images.delete(this.images.keys().next().value);
      root.append(thumb);const text=make('span','media-description');if(prefix)text.append(make('span','media-prefix',prefix));text.append(make('span','media-label',caption));root.append(text);root.title=record.text || caption;return root;
    }
    clear(){this.images.clear();}
  }
  const styles=`
    .media-snippet{display:flex;align-items:center;gap:8px;min-width:0;height:44px;white-space:normal}
    .media-thumb{position:relative;display:block;flex:0 0 60px;width:60px;height:44px;overflow:hidden;border-radius:6px;background:var(--rcs-soft)}
    .media-image{display:block;width:100%;height:100%;object-fit:cover}
    .media-placeholder{position:absolute;inset:0;display:grid;place-items:center;color:var(--rcs-muted);font-size:20px}
    .media-description{display:block;min-width:0;font-size:12px;line-height:1.4;color:var(--rcs-muted)}
    .media-prefix{font-weight:400}.media-label{font-weight:400}
    .compact-media{height:20px;gap:5px}.compact-media .media-thumb{flex-basis:28px;width:28px;height:20px;border-radius:3px}
    .compact-media .media-placeholder{font-size:14px}.compact-media .media-description{font-size:11px}
    .media-thumb [hidden]{display:none!important}
  `;
  globalThis.RCSMediaPreview=Object.freeze({View,label,styles});
})();
