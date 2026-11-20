(() => {
  'use strict';
  if(globalThis.RTDownloadUI)return;
  const M=globalThis.RTDownloadModel;
  if(!M)return;
  const ROW='flex justify-between relative px-md gap-xs text-secondary-plain hover:text-secondary-plain-hover active:bg-interactive-pressed hover:bg-neutral-background-hover hover:no-underline cursor-pointer py-2xs -outline-offset-1';
  const SUPPORTED=new Set(['image','gallery','video','gif']);
  const SVG='http://www.w3.org/2000/svg';
  const PATHS={
    download:['M9.1 2.5h1.8v6.6l2.55-2.55 1.27 1.27L10 12.57 5.28 7.82 6.55 6.55 9.1 9.1V2.5Z','M3.9 12.5h1.8v2.8h8.6v-2.8h1.8v3.5c0 .5-.4.9-.9.9H4.8a.9.9 0 0 1-.9-.9v-3.5Z'],
    'arrow-back':['M17.5 9.1H4.68l5.49-5.46a.9.9 0 0 0-1.27-1.28l-7.03 7a.9.9 0 0 0 0 1.28l7.03 7a.9.9 0 0 0 1.27-1.28L4.68 10.9H17.5a.9.9 0 0 0 0-1.8Z'],
    'chevron-right':['M7.5 17.9a.9.9 0 0 1-.64-1.54L13.23 10 6.86 3.64a.9.9 0 0 1 1.28-1.28l7 7a.9.9 0 0 1 0 1.28l-7 7a.9.9 0 0 1-.64.26Z'],
    image:['M14.6 2H5.4A3.4 3.4 0 0 0 2 5.4v9.2A3.4 3.4 0 0 0 5.4 18h9.2a3.4 3.4 0 0 0 3.4-3.4V5.4A3.4 3.4 0 0 0 14.6 2Zm1.6 12.6c0 .88-.72 1.6-1.6 1.6H5.4a1.6 1.6 0 0 1-1.6-1.6v-1.03l2.63-2.63a1.6 1.6 0 0 1 2.26 0l4.91 4.91h-2.4Zm0-9.2c0 .88-.72 1.6-1.6 1.6H5.4c-.88 0-1.6-.72-1.6-1.6V5.4c0-.88.72-1.6 1.6-1.6h9.2c.88 0 1.6.72 1.6 1.6v.4ZM10 7.3a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5Z'],
    video:['M8.8 14a1.8 1.8 0 0 1-.87-.22A1.82 1.82 0 0 1 7 12.19V7.81c0-.66.36-1.27.93-1.59a1.79 1.79 0 0 1 1.83.06l3.41 2.19c.52.33.83.9.83 1.53 0 .62-.31 1.19-.83 1.53l-3.41 2.19a1.79 1.79 0 0 1-.96.28Zm0-6.19v4.38L12.2 10 8.8 7.81ZM10 18.9c-1.52 0-2.95-.19-4.37-.57a5.63 5.63 0 0 1-3.96-3.96 16.6 16.6 0 0 1-.57-4.37c0-1.51.19-2.94.57-4.37a5.63 5.63 0 0 1 3.96-3.96 16.9 16.9 0 0 1 8.74 0 5.63 5.63 0 0 1 3.96 3.96c.38 1.43.57 2.86.57 4.37 0 1.51-.19 2.94-.57 4.37a5.63 5.63 0 0 1-3.96 3.96c-1.43.38-2.86.57-4.37.57Zm-6.59-4.99a3.82 3.82 0 0 0 2.69 2.69 15.1 15.1 0 0 0 7.81 0 3.81 3.81 0 0 0 2.69-2.69c.34-1.27.51-2.55.51-3.9 0-1.35-.17-2.63-.51-3.9a3.82 3.82 0 0 0-2.69-2.69 15.1 15.1 0 0 0-7.81 0A3.82 3.82 0 0 0 3.41 6.1a14.8 14.8 0 0 0-.51 3.9c0 1.35.17 2.63.51 3.9Z']
  };
  function glyph(name,size=20) {
    const svg=document.createElementNS(SVG,'svg');
    for(const [key,value] of Object.entries({fill:'currentColor',height:String(size),width:String(size),viewBox:'0 0 20 20','aria-hidden':'true'}))svg.setAttribute(key,value);
    for(const d of PATHS[name] || []){const path=document.createElementNS(SVG,'path');path.setAttribute('d',d);svg.append(path);}
    return svg;
  }
  function make(tag,className,text) {
    const element=document.createElement(tag);
    if(className)element.className=className;
    if(text!=null)element.textContent=text;
    return element;
  }
  function defaultRead(message) {
    return new Promise((resolve,reject)=>{
      if(!globalThis.chrome?.runtime?.sendMessage)return reject(Error('Downloads are unavailable.'));
      let settled=false;
      const finish=response=>{
        if(settled)return;
        settled=true;
        void chrome.runtime.lastError;
        if(!response?.ok)reject(Error(response?.error || 'Unable to download this media.'));
        else resolve(response);
      };
      try{
        const result=chrome.runtime.sendMessage({scope:'rt-download',...message},finish);
        if(result && typeof result.then==='function')result.then(finish,error=>{if(!settled){settled=true;reject(error);}});
      }catch(error){reject(error);}
    });
  }
  class Download {
    constructor({observe=true,read=defaultRead,mobile}={}) {
      this.read=read;this.dead=false;this.dropdown=null;this.button=null;this.panel=null;this.post=null;this.sheetItem=null;this.sheet=null;this.hidden=[];this.busy=false;
      this.mobile=typeof mobile==='boolean'?{matches:mobile}:mobile || globalThis.matchMedia?.('(max-width: 767.98px)') || {matches:false,addEventListener(){},removeEventListener(){}};
      this.onClick=event=>{if(!this.dropdown && !this.sheetItem)return;const path=event.composedPath?.() || [];if(path.includes(this.panel) || path.includes(this.dropdown) || path.includes(this.sheetItem))return;this.close();};
      this.onKeydown=event=>{if(event.key==='Escape' && (this.dropdown || this.sheetItem)){event.preventDefault();event.stopImmediatePropagation();this.close(true);}};
      this.onViewport=()=>{if(this.dead)return;this.close();this.sync();};
      document.addEventListener('click',this.onClick,true);document.addEventListener('keydown',this.onKeydown,true);
      if(this.mobile.addEventListener)this.mobile.addEventListener('change',this.onViewport);else this.mobile.addListener?.(this.onViewport);
      if(observe){
        this.observer=new MutationObserver(()=>{if(!this.queued){this.queued=true;queueMicrotask(()=>{this.queued=false;this.sync();});}});
        this.observer.observe(document.documentElement,{childList:true,subtree:true});
      }
    }
    destroy() {
      this.dead=true;this.close();this.observer?.disconnect();
      document.removeEventListener('click',this.onClick,true);document.removeEventListener('keydown',this.onKeydown,true);
      if(this.mobile.removeEventListener)this.mobile.removeEventListener('change',this.onViewport);else this.mobile.removeListener?.(this.onViewport);
      for(const item of document.querySelectorAll('[data-rt-download="item"]'))item.remove();
      for(const post of document.querySelectorAll('shreddit-post'))for(const action of post.shadowRoot?.querySelectorAll('[data-rt-download="action"]') || [])action.remove();
    }
    sync() {
      if(this.dead)return;
      if(this.dropdown && !this.dropdown.isConnected)this.close();
      if(this.sheetItem && !this.sheetItem.isConnected)this.close();
      if(!this.mobile.matches)for(const item of document.querySelectorAll('[data-rt-download="item"]'))item.remove();
      for(const post of document.querySelectorAll('shreddit-post')){
        const supported=SUPPORTED.has(String(post.getAttribute('post-type') || '').toLowerCase()),root=post.shadowRoot;
        if(this.mobile.matches){
          root?.querySelector('[data-rt-download="action"]')?.remove();
          if(!supported)continue;
          const menu=post.querySelector('shreddit-post-overflow-menu');if(!menu)continue;
          const existing=menu.querySelector(':scope > [slot="devvit-context-actions"] [data-rt-download="item"]');
          if(existing || !M.mediaFor(post)?.items?.length)continue;
          let slot=menu.querySelector(':scope > [slot="devvit-context-actions"]');
          if(!slot){slot=make('div');slot.setAttribute('slot','devvit-context-actions');menu.append(slot);}
          slot.append(this.menuItem(menu,post));
        }else{
          const row=root?.querySelector('rpl-action-bar [data-testid="action-row"]');
          let action=root?.querySelector('[data-rt-download="action"]');
          if(!supported || !row){action?.remove();continue;}
          if(!action){if(!M.mediaFor(post)?.items?.length)continue;action=this.action(post);}
          const share=row.querySelector(':scope > slot[name="share-button"]');
          if(action.parentElement!==row){
            if(share)share.after(action);
            else{
              const whitespace=row.querySelector(':scope > slot[name="action-row-whitespace"]');
              if(whitespace)whitespace.before(action);else row.append(action);
            }
          }else if(share && action.previousElementSibling!==share)share.after(action);
        }
      }
      if(this.mobile.matches)this.dedupe();
    }
    dedupe() {
      const portal=document.getElementById('post-overflow-menu-bottom-sheet');if(!portal)return;
      const slots=[...portal.querySelectorAll('[slot="devvit-context-actions"]')];
      const keep=slots.find(slot=>slot.querySelector('shreddit-async-loader,hr,li:not([data-rt-download="item"])')) || slots[0];
      for(const slot of slots){
        const items=[...slot.querySelectorAll('[data-rt-download="item"]')];
        for(const item of items)if(slot!==keep || item!==items[0])item.remove();
      }
    }
    action(post) {
      const wrapper=make('rpl-dropdown','relative rt-download-action');
      for(const [key,value] of Object.entries({placement:'bottom-start',trigger:'manual',hoist:'','data-rt-download':'action'}))wrapper.setAttribute(key,value);
      const button=make('button','button rpl-cab border-sm flex flex-row justify-center items-center h-xl font-semibold relative text-label-2 button-secondary inline-flex items-center px-sm py-xs');
      for(const [key,value] of Object.entries({type:'button','aria-haspopup':'menu','aria-expanded':'false','aria-label':'Download media',title:'Download media'}))button.setAttribute(key,value);
      button.style.height='var(--size-button-sm-h)';
      const menu=make('faceplate-menu','rt-download-menu');
      for(const [key,value] of Object.entries({slot:'content','data-rt-download':'panel',role:'menu','aria-label':'Download media'}))menu.setAttribute(key,value);
      wrapper.append(button,menu);
      const icon=make('span','rpl-cab--leading-icon flex items-center'),box=make('span','flex text-body-1');
      box.append(glyph('download',16));icon.append(box);button.append(icon);
      button.addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();this.toggle(post,wrapper,button,menu);},true);
      menu.addEventListener('keydown',event=>this.onPanelKey(event),true);
      return wrapper;
    }
    menuItem(menu,post) {
      const li=make('li','relative list-none mt-0');li.setAttribute('role','presentation');li.dataset.rtDownload='item';li.dataset.rtUi='download-menu-item';
      const row=make('div',ROW);row.setAttribute('role','menuitem');row.setAttribute('aria-haspopup','menu');row.setAttribute('aria-expanded','false');row.tabIndex=-1;row.style.paddingInlineEnd='16px';
      const lead=make('span','flex items-center gap-xs min-w-0 shrink'),box=make('span','flex shrink-0 items-center justify-center h-xl w-xl text-20 leading-4');box.append(glyph('download'));
      const text=make('span','flex flex-col justify-center min-w-0 shrink py-[0.375rem]');
      text.append(make('span','text-body-2','Download media'),make('span','text-caption-1 text-secondary-plain-weak','Save this post’s media'));
      const tail=make('span','flex items-center shrink-0');tail.append(glyph('chevron-right'));
      lead.append(box,text);row.append(lead,tail);li.append(row);
      const choose=event=>{event.preventDefault();event.stopImmediatePropagation();this.openSheet(menu,post,li);};
      row.addEventListener('click',choose,true);row.addEventListener('keydown',event=>{if(event.key==='Enter' || event.key===' '){event.preventDefault();event.stopImmediatePropagation();choose(event);}},true);
      return li;
    }
    toggle(post,dropdown,button,menu) {
      if(this.dropdown===dropdown && dropdown.hasAttribute('open')){this.close(true);return;}
      this.close();
      this.dropdown=dropdown;this.button=button;this.panel=menu;this.post=post;
      this.render(menu,post,false);
      dropdown.setAttribute('open','');button.setAttribute('aria-expanded','true');
      menu.querySelector('[role="menuitem"]')?.focus({preventScroll:true});
    }
    openSheet(menu,post,item) {
      if(this.sheetItem===item && this.panel){this.close(true);return;}
      this.close();
      const sheet=item.closest?.('.post-overflow-menu-bottom-sheet'),slot=item.closest?.('[slot="devvit-context-actions"]');
      if(!sheet || !slot)return;
      const host=slot.parentElement,hidden=[];
      for(const node of [...host.children]){hidden.push({node,display:node.style.display});node.style.display='none';}
      item.querySelector('[role="menuitem"]')?.setAttribute('aria-expanded','true');
      const panel=make('div','rt-download-submenu');panel.dataset.rtDownload='panel';panel.setAttribute('role','menu');panel.setAttribute('aria-label','Download media');
      panel.addEventListener('keydown',event=>this.onPanelKey(event),true);
      this.sheet=sheet;this.sheetItem=item;this.panel=panel;this.post=post;this.hidden=hidden;
      host.append(panel);this.render(panel,post,true);
      panel.querySelector('[data-rt-download="back"]')?.focus({preventScroll:true});
    }
    render(panel,post,back) {
      panel.replaceChildren();
      if(back){
        const row=this.row({label:'Back',caption:'Download media',icon:'arrow-back',onSelect:()=>this.close(true)});row.dataset.rtDownload='back';panel.append(row);
      }
      const media=M.mediaFor(post);
      if(!media || !media.items.length){const item=this.sheetItem;this.close();item?.remove();return;}
      if(media.type==='gallery' && media.items.length>1){
        panel.append(this.row({label:'All images',caption:media.items.length+' images',icon:'image',onSelect:()=>this.download(post,media.items)}));
      }
      media.items.forEach((item,index)=>panel.append(this.row({label:M.labelFor(item,index,media.items.length),caption:M.captionFor(item),icon:item.kind==='video'?'video':'image',onSelect:()=>this.download(post,[item])})));
    }
    row({label,caption,icon,onSelect,disabled=false}) {
      const row=make('div',ROW);row.setAttribute('role','menuitem');row.tabIndex=-1;row.style.paddingInlineEnd='16px';
      if(disabled)row.setAttribute('aria-disabled','true');
      const lead=make('span','flex items-center gap-xs min-w-0 shrink'),box=make('span','flex shrink-0 items-center justify-center h-xl w-xl text-20 leading-4');box.append(glyph(icon));
      const text=make('span','flex flex-col justify-center min-w-0 shrink py-[0.375rem]');text.append(make('span','text-body-2 rt-download-label',label));
      if(caption)text.append(make('span','text-caption-1 text-secondary-plain-weak rt-download-caption',caption));
      const tail=make('span','flex items-center shrink-0');if(!disabled && icon!=='arrow-back')tail.append(glyph('download'));
      lead.append(box,text);row.append(lead,tail);
      if(!disabled){
        const choose=event=>{event.preventDefault();event.stopImmediatePropagation();onSelect();};
        row.addEventListener('click',choose,true);row.addEventListener('keydown',event=>{if(event.key==='Enter' || event.key===' '){event.preventDefault();event.stopImmediatePropagation();choose(event);}},true);
      }
      return row;
    }
    onPanelKey(event) {
      if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();this.close(true);return;}
      if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
      event.preventDefault();event.stopImmediatePropagation();
      const rows=[...this.panel.querySelectorAll('[role="menuitem"]:not([aria-disabled="true"])')];
      if(!rows.length)return;
      const current=rows.indexOf(document.activeElement),next=event.key==='Home'?0:event.key==='End'?rows.length-1:current<0?(event.key==='ArrowUp'?rows.length-1:0):(current+(event.key==='ArrowUp'?-1:1)+rows.length)%rows.length;
      rows[next].focus({preventScroll:true});
    }
    async download(post,items) {
      if(this.busy)return;
      const plan=M.filesFor(post,items);
      if(!plan.files.length){this.showError('No downloadable media found.');return;}
      this.busy=true;this.panel?.setAttribute('aria-busy','true');
      try{
        const response=await this.read({action:'download',files:plan.files});
        if(!response?.ok)throw Error(response?.error || 'Some downloads could not start.');
        const focus=this.button || this.sheetItem?.querySelector('[role="menuitem"]');this.close();focus?.focus({preventScroll:true});
      }catch(error){this.showError(error?.message || 'Unable to download this media.');}
      finally{this.busy=false;this.panel?.removeAttribute('aria-busy');}
    }
    showError(message) {
      if(!this.panel)return;
      this.panel.querySelector('[data-rt-download="error"]')?.remove();
      const error=make('div','rt-download-error');error.dataset.rtDownload='error';error.setAttribute('role','status');error.textContent=message;
      const back=this.panel.querySelector('[data-rt-download="back"]');if(back)back.after(error);else this.panel.prepend(error);
    }
    close(focus=false) {
      const button=this.button,item=this.sheetItem;
      if(this.dropdown)this.dropdown.removeAttribute('open');
      button?.setAttribute('aria-expanded','false');
      item?.querySelector('[role="menuitem"]')?.setAttribute('aria-expanded','false');
      for(const entry of this.hidden)if(entry.node.isConnected)entry.node.style.display=entry.display;
      if(this.sheet)this.panel?.remove();else this.panel?.replaceChildren();
      this.dropdown=null;this.button=null;this.panel=null;this.post=null;this.sheetItem=null;this.sheet=null;this.hidden=[];this.busy=false;
      if(focus){
        const target=button || item?.querySelector('[role="menuitem"]');
        if(target?.isConnected)target.focus({preventScroll:true});
      }
    }
  }
  globalThis.RTDownloadUI=Object.freeze({Download,defaultRead});
  if(globalThis.top===globalThis && globalThis.chrome?.runtime?.id && globalThis.location?.hostname!=='old.reddit.com')Object.defineProperty(globalThis,'RTDownloadUIInstance',{value:new Download()});
})();
