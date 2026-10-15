/* Compact only native actions whose accessible purpose is known. */
(() => {
  'use strict';
  const settings=/^(?:(?:conversation|chat)\s+)?settings(?:\s+(?:for\s+)?(?:this\s+)?(?:conversation|chat))?$/i;
  const popout=/^(?:pop[ -]?out(?:\s+(?:chat|conversation))?|open\s+(?:(?:chat|conversation)\s+)?in\s+(?:a\s+)?new\s+(?:window|tab)|open\s+chat\s+new\s+tab)$/i;
  function attach(container,{adapter=globalThis.RCSAdapter}={}){
    let header,host,shadow,trigger,menu,observer,destroyed=false,open=false,records=[];
    const query=(selector,root)=>adapter?.query?adapter.query(selector,root):root?.querySelector(selector);
    const all=(selector,root)=>adapter?.queryAll?adapter.queryAll(selector,root):[...root.querySelectorAll(selector)];
    const restore=()=>{for(const record of records){const {button,hidden,display,priority}=record;if(button.getAttribute('hidden')==='')hidden===null?button.removeAttribute('hidden'):button.setAttribute('hidden',hidden);if(button.style.getPropertyValue('display')==='none' && button.style.getPropertyPriority('display')==='important'){if(display)button.style.setProperty('display',display,priority);else button.style.removeProperty('display');}}records=[];};
    const close=(focus=false)=>{open=false;if(menu)menu.hidden=true;trigger?.setAttribute('aria-expanded','false');if(focus && host?.isConnected)trigger.focus({preventScroll:true});};
    const remove=()=>{close();restore();host?.remove();host=shadow=trigger=menu=null;};
    const onOutside=event=>{if(open && !event.composedPath().includes(host))close();};
    function build(parent){
      host=document.createElement('span');host.dataset.rcsUi='room-header-actions';host.style.cssText='display:inline-flex;align-items:center;position:relative;flex-shrink:0';shadow=host.attachShadow({mode:'open'});
      const style=document.createElement('style');style.textContent=`:host{color:inherit;font:inherit}button{font:inherit;color:inherit;cursor:pointer}button:focus-visible{outline:2px solid #ff4500;outline-offset:2px}.more{display:grid;place-items:center;width:32px;height:32px;padding:0;border:0;border-radius:50%;background:transparent;font-size:22px;line-height:1}.more:hover,.item:hover{background:var(--color-neutral-background-hover,#eaeef0)}.menu{position:absolute;right:0;top:calc(100% + 6px);z-index:1000;min-width:170px;padding:5px;border:1px solid var(--color-neutral-border-weak,#d5dce0);border-radius:10px;background:var(--color-neutral-background,#fff);color:var(--color-neutral-content-strong,#18272d);box-shadow:0 5px 18px #0002}.menu[hidden]{display:none}.item{display:block;text-align:left;width:100%;padding:9px;border:0;border-radius:6px;background:transparent;font-size:13px}.item:disabled{opacity:.45;cursor:default}`;
      trigger=document.createElement('button');trigger.type='button';trigger.className='more';trigger.textContent='⋯';trigger.setAttribute('aria-label','More chat actions');trigger.title='More chat actions';trigger.setAttribute('aria-haspopup','menu');trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-controls','rcs-room-header-menu');
      menu=document.createElement('div');menu.className='menu';menu.id='rcs-room-header-menu';menu.hidden=true;menu.setAttribute('role','menu');menu.setAttribute('aria-label','More chat actions');
      trigger.addEventListener('click',()=>{open?close():show();});
      shadow.addEventListener('keydown',event=>{if(event.key==='Escape' && open){event.preventDefault();event.stopImmediatePropagation();close(true);return;}if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();event.stopImmediatePropagation();if(!open)show();const choices=[...menu.querySelectorAll('button:not(:disabled)')],index=choices.indexOf(shadow.activeElement),next=event.key==='Home'?0:event.key==='End'?choices.length-1:index<0?(event.key==='ArrowUp'?choices.length-1:0):(index+(event.key==='ArrowUp'?-1:1)+choices.length)%choices.length;choices[next]?.focus({preventScroll:true});}});
      shadow.append(style,trigger,menu);parent.insertBefore(host,records[0]?.button || null);
    }
    function show(){sync();if(!host)return;open=true;menu.hidden=false;trigger.setAttribute('aria-expanded','true');}
    function sync(){
      if(destroyed)return;
      const next=query(adapter?.selectors?.header || 'header,rs-room-header,[data-testid="chat-room-header"]',container),width=container.getBoundingClientRect().width;
      if(next!==header){remove();header=next;observe();}
      if(!header || !width || width>440){remove();return;}
      const found=all('button,[role="button"]',header).filter(button=>{if(button.getRootNode().host===host || button.closest('[data-rcs-ui]'))return false;const label=(button.getAttribute('aria-label') || button.getAttribute('title') || '').trim();return (settings.test(label)||popout.test(label)) && (records.some(record=>record.button===button)||(!button.hidden && !button.inert && button.style.display!=='none'));});
      if(!found.length){remove();return;}
      const changed=found.length!==records.length || found.some((button,index)=>records[index]?.button!==button);
      if(changed){remove();for(const button of found){records.push({button,hidden:button.getAttribute('hidden'),display:button.style.getPropertyValue('display'),priority:button.style.getPropertyPriority('display')});button.hidden=true;button.style.setProperty('display','none','important');}build(found[0].parentElement || found[0].parentNode);}
      const signature=records.map(({button})=>[(button.getAttribute('aria-label') || button.getAttribute('title') || '').trim(),button.disabled || button.getAttribute('aria-disabled')==='true']);
      if(menu.dataset.actions!==JSON.stringify(signature)){menu.dataset.actions=JSON.stringify(signature);menu.replaceChildren();records.forEach(({button},index)=>{const item=document.createElement('button');item.type='button';item.className='item';item.textContent=signature[index][0];item.disabled=Boolean(signature[index][1]);item.setAttribute('role','menuitem');item.addEventListener('click',()=>{close(true);if(!button.isConnected || button.disabled || button.getAttribute('aria-disabled')==='true')return;button.click();});menu.append(item);});}
    }
    function observe(){if(!observer)return;observer.disconnect();for(const root of new Set([container,container.shadowRoot,header,header?.shadowRoot].filter(Boolean)))observer.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['aria-label','title','disabled','aria-disabled']});}
    document.addEventListener('pointerdown',onOutside);document.addEventListener('focusin',onOutside);
    const resize=globalThis.ResizeObserver?new ResizeObserver(sync):null;resize?.observe(container);
    observer=globalThis.MutationObserver?new MutationObserver(sync):null;observe();sync();
    return {sync,destroy(){if(destroyed)return;destroyed=true;observer?.disconnect();resize?.disconnect();document.removeEventListener('pointerdown',onOutside);document.removeEventListener('focusin',onOutside);remove();}};
  }
  globalThis.RCSRoomHeaderActions={attach};
})();
