/* Small lazy thumbnails; image bytes and credentials are never stored here. */
(() => {
  const label=record=>record.attachmentMime==='image/gif'?'GIF':'Image';
  const make=(tag,className,text)=>{const el=document.createElement(tag);el.className=className;if(text)el.textContent=text;return el;};
  function sourceURL(value){
    const safe=globalThis.RCSMessageStore?.previewURL(value);if(!safe)return '';
    const url=new URL(safe);
    // Upgrade already-saved native thumbnail references without rereading
    // history. Arbitrary CDN URLs and native download URLs remain untouched.
    if(url.origin==='https://matrix.redditspace.com' && /^\/_matrix\/media\/(?:v\d+|r0)\/thumbnail\/[^/]+\/[^/]+$/.test(url.pathname)){
      for(const [key,size]of [['width',384],['height',256]])if(!(Number(url.searchParams.get(key))>=size))url.searchParams.set(key,String(size));
      url.searchParams.set('method','scale');
    }
    return url.href;
  }
  function fitSize(dimensions,compact=false){
    const w=dimensions?.width,h=dimensions?.height;
    if(!Number.isFinite(w) || !Number.isFinite(h) || w<=0 || h<=0)return {width:compact?28:96,height:compact?20:64};
    const scale=Math.min((compact?28:128)/w,(compact?20:128)/h,1);
    return {width:Math.max(1,Math.round(w*scale)),height:Math.max(1,Math.round(h*scale))};
  }
  const known=dimensions=>Number.isFinite(dimensions?.width) && Number.isFinite(dimensions?.height) && dimensions.width>=1 && dimensions.height>=1 && dimensions.width<=100000 && dimensions.height<=100000;
  class View {
    constructor({onResize,onBeforeResize,onDimensions}={}){this.images=new Map();this.contexts=new WeakMap();this.learned=new WeakMap();this.onResize=onResize;this.onBeforeResize=onBeforeResize;this.onDimensions=onDimensions || (patch=>globalThis.RCSMessages?.rememberImageDimensions?.(patch));}
    size(thumb,record,compact,beforeResize=false){
      const img=thumb.querySelector('img'),natural={width:img?.naturalWidth,height:img?.naturalHeight},hint={width:record?.attachmentWidth,height:record?.attachmentHeight};
      const size=fitSize(known(natural)?natural:known(hint)?hint:null,compact),signature=size.width+':'+size.height,changed=thumb.dataset.size!==signature;
      if(changed && beforeResize)this.onBeforeResize?.(thumb);
      thumb.dataset.size=signature;thumb.style.width=size.width+'px';thumb.style.aspectRatio=size.width+' / '+size.height;
      if(img){img.width=size.width;img.height=size.height;}return changed;
    }
    remember(thumb){
      const context=this.contexts.get(thumb),img=thumb.querySelector('img');if(!context || !img || !known({width:img.naturalWidth,height:img.naturalHeight}))return;
      const {record,compact,owner}=context,hint={width:record.attachmentWidth,height:record.attachmentHeight},actual=fitSize({width:img.naturalWidth,height:img.naturalHeight},compact),expected=fitSize(hint,compact);
      if(known(hint) && expected.width===actual.width && expected.height===actual.height)return;
      const signature=JSON.stringify([owner,record.attachmentPreview,img.naturalWidth,img.naturalHeight]);if(this.learned.get(thumb)===signature)return;this.learned.set(thumb,signature);
      if(owner && record.roomId && record.id && record.attachmentPreview)try{Promise.resolve(this.onDimensions?.({owner,roomId:record.roomId,eventId:record.id,preview:record.attachmentPreview,width:img.naturalWidth,height:img.naturalHeight})).catch(()=>{});}catch{}
    }
    render(record,{prefix='',compact=false,owner=''}={}){
      const root=make('span','media-snippet'+(compact?' compact-media':'')),caption=label(record),source=sourceURL(record.attachmentPreview),key=JSON.stringify([record.roomId,record.id || record.timestamp,compact,source]);
      let thumb=this.images.get(key);
      if(!thumb){
        thumb=make('span','media-thumb');thumb.dataset.state=source?'loading':'error';thumb.setAttribute('aria-busy',String(Boolean(source)));
        const fallback=make('span','media-placeholder');fallback.setAttribute('aria-hidden','true');
        const native=Boolean(globalThis.customElements?.get('faceplate-shimmer')) && !globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        const shimmer=make(native?'faceplate-shimmer':'span','media-shimmer '+(native?'native-shimmer':'fallback-shimmer'));if(native)shimmer.setAttribute('shape','pill');
        const error=make('span','media-error','▧');error.hidden=Boolean(source);shimmer.hidden=!source;fallback.append(shimmer,error);thumb.append(fallback);
        if(source){const img=make('img','media-image');img.alt=caption+' preview';img.setAttribute('loading','lazy');img.setAttribute('decoding','async');img.setAttribute('referrerpolicy','no-referrer');
          img.addEventListener('load',()=>{const context=this.contexts.get(thumb);if(!context)return;const active=this.images.get(key)===thumb || thumb.isConnected,changed=this.size(thumb,context.record,context.compact,active);thumb.dataset.state='loaded';thumb.setAttribute('aria-busy','false');fallback.hidden=true;if(changed && active)this.onResize?.(context.record);this.remember(thumb);});
          img.addEventListener('error',()=>{thumb.dataset.state='error';thumb.setAttribute('aria-busy','false');img.hidden=true;shimmer.hidden=true;error.hidden=false;fallback.hidden=false;thumb.title='Preview unavailable; open the message to view it.';});
          thumb.append(img);this.contexts.set(thumb,{record,compact,owner});this.size(thumb,record,compact);img.src=source;
        }else thumb.title='Preview unavailable; open the message to view it.';
        this.images.set(key,thumb);
      }else{this.images.delete(key);this.images.set(key,thumb);}
      this.contexts.set(thumb,{record,compact,owner});const image=thumb.querySelector('img');if(image && image.alt!==caption+' preview')image.alt=caption+' preview';this.size(thumb,record,compact);if(thumb.dataset.state==='loaded')this.remember(thumb);
      while(this.images.size>160)this.images.delete(this.images.keys().next().value);
      if(prefix){const text=make('span','media-description');text.append(make('span','media-prefix',prefix));root.append(text);}root.append(thumb);root.title=record.text || caption;return root;
    }
    clear(){this.images.clear();this.contexts=new WeakMap();this.learned=new WeakMap();}
  }
  const styles=`
    .media-snippet{display:flex;flex-direction:column;align-items:flex-start;gap:4px;min-width:0;white-space:normal}
    .media-thumb{position:relative;display:block;flex:0 0 auto;max-width:100%;overflow:hidden;border-radius:6px;background:var(--rcs-soft)}
    .media-image{display:block;width:100%;height:auto;object-fit:contain}
    .media-placeholder{position:absolute;inset:0;display:block;color:var(--rcs-muted);background:var(--color-shimmer-background,var(--rcs-soft));border-radius:inherit;font-size:20px}
    .media-shimmer{position:relative;display:block;width:100%;height:100%;border-radius:inherit;overflow:hidden}
    .fallback-shimmer::after{content:"";position:absolute;inset:0;transform:translateX(-100%);background:linear-gradient(90deg,transparent,color-mix(in srgb,var(--color-neutral-background,#fff) 55%,transparent),transparent);animation:rcs-media-shimmer 1.5s ease-in-out infinite}
    @keyframes rcs-media-shimmer{to{transform:translateX(100%)}}
    .media-error{display:grid;place-items:center;width:100%;height:100%}
    .media-thumb[data-state="loading"] .media-image{position:absolute;top:0;visibility:hidden}
    @media(prefers-reduced-motion:reduce){.fallback-shimmer::after{animation:none;display:none}}
    .media-description{display:block;min-width:0;font-size:12px;line-height:1.4;color:var(--rcs-muted)}
    .media-prefix{font-weight:400}.media-label{font-weight:400}
    .compact-media{flex-direction:row;align-items:center;height:20px;min-height:20px;gap:5px}.compact-media .media-thumb{border-radius:3px}
    .compact-media .media-placeholder{font-size:14px}.compact-media .media-description{font-size:11px}
    .media-thumb [hidden]{display:none!important}
  `;
  globalThis.RCSMediaPreview=Object.freeze({View,label,sourceURL,fitSize,styles});
})();
