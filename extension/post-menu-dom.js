/* Reddit's inline post menu and its phone portal mutate independently of the feed.
   Also coordinates single-line overflow rows, viewport clamping, placement recalculation,
   and collapsing >2 extension actions into a single "Reddit Tweaks ›" submenu. */
(() => {
  'use strict';
  const inline='shreddit-post-overflow-menu',sheet='#post-overflow-menu-bottom-sheet';
  const overlay=sheet+',dialog[data-rt-raffle="dialog"],[data-rt-download="panel"],[data-rt-menu-group="flyout"]';
  const surface=inline+','+overlay;
  const ROW='flex justify-between relative px-md gap-xs text-secondary-plain hover:text-secondary-plain-hover active:bg-interactive-pressed hover:bg-neutral-background-hover hover:no-underline cursor-pointer py-2xs -outline-offset-1';
  const SVG='http://www.w3.org/2000/svg';
  const PATHS={
    tweaks:['M4 6.2h12v1.6H4V6.2Zm0 6h12v1.6H4v-1.6Z','M7.2 4.5h1.6v5H7.2v-5Zm4 6h1.6v5h-1.6v-5Z'],
    'chevron-right':['M7.5 17.9a.9.9 0 0 1-.64-1.54L13.23 10 6.86 3.64a.9.9 0 0 1 1.28-1.28l7 7a.9.9 0 0 1 0 1.28l-7 7a.9.9 0 0 1-.64.26Z'],
    'arrow-back':['M17.5 9.1H4.68l5.49-5.46a.9.9 0 0 0-1.27-1.28l-7.03 7a.9.9 0 0 0 0 1.28l7.03 7a.9.9 0 0 0 1.27-1.28L4.68 10.9H17.5a.9.9 0 0 0 0-1.8Z']
  };
  function glyph(name,size=20){
    const svg=document.createElementNS(SVG,'svg');
    for(const [k,v] of Object.entries({fill:'currentColor',height:String(size),width:String(size),viewBox:'0 0 20 20','aria-hidden':'true'}))svg.setAttribute(k,v);
    for(const d of PATHS[name] || []){const p=document.createElementNS(SVG,'path');p.setAttribute('d',d);svg.append(p);}
    return svg;
  }
  function make(tag,cls,text){
    const el=document.createElement(tag);
    if(cls)el.className=cls;
    if(text!=null)el.textContent=text;
    return el;
  }
  function isMenuMutation(record){
    if(record.target.closest?.(surface))return true;
    // Mounting a new inline menu can make a post ready for its extension actions.
    // Mounting or removing an overlay does not change any post.
    const {addedNodes,removedNodes}=record;
    return (addedNodes.length>0 || removedNodes.length>0) &&
      Array.prototype.every.call(addedNodes,node=>node.matches?.(overlay)) &&
      Array.prototype.every.call(removedNodes,node=>node.matches?.(overlay));
  }

  // Coalesced placement recalculation so dynamic extension rows never clip below viewport.
  let resizeFrame=0;
  function scheduleResize(){
    if(resizeFrame)return;
    const raf=globalThis.requestAnimationFrame || (fn=>setTimeout(fn,0));
    resizeFrame=raf(()=>{
      resizeFrame=0;
      try{window.dispatchEvent(new Event('resize'));}catch{}
    });
  }

  // Inject viewport fallback clamp into Reddit's shadow-DOM overflow menu dropdown.
  function clampMenu(menu){
    if(!menu)return;
    const root=menu.shadowRoot;
    if(root && !root.querySelector('style[data-rt-menu-clamp]')){
      const style=document.createElement('style');
      style.dataset.rtMenuClamp='true';
      style.textContent='faceplate-menu, rpl-dropdown [slot="content"], [role="menu"] { max-height: calc(100vh - 80px) !important; overflow-y: auto !important; overscroll-behavior: contain; }';
      root.append(style);
    }
  }
  function menuIsOpen(node){
    const menu=node?.closest?.(inline) || (node?.matches?.(inline)?node:null);
    if(menu){
      if(menu.querySelector('button[aria-expanded="true"]'))return true;
      if(menu.shadowRoot?.querySelector('[open], [aria-expanded="true"]'))return true;
    }
    return Boolean(node?.closest?.(sheet));
  }
  function prepareOpen(menu){
    clampMenu(menu);
    scheduleResize();
  }

  // Active flyout/sheet state for collapsed ">2 actions" Reddit Tweaks submenu.
  let activeSubmenu=null;
  function closeSubmenu(focusTrigger=false){
    const current=activeSubmenu;
    if(!current)return;
    activeSubmenu=null;
    clearTimeout(current.hoverTimer);
    document.removeEventListener('pointerdown',current.onOutside,true);
    document.removeEventListener('keydown',current.onKeydown,true);
    window.removeEventListener('scroll',current.onReposition,true);
    window.removeEventListener('resize',current.onReposition);
    if(current.bucket && current.panel){
      for(const item of [...current.panel.querySelectorAll(':scope > [data-rt-menu-action]')])current.bucket.append(item);
    }
    for(const entry of current.hidden || [])if(entry.node.isConnected)entry.node.style.display=entry.display;
    current.panel?.remove();
    current.row?.setAttribute('aria-expanded','false');
    if(focusTrigger && current.row?.isConnected)current.row.focus({preventScroll:true});
  }

  function positionFlyout(row,panel){
    const rect=row.getBoundingClientRect?.();
    if(!rect || (!rect.width && !rect.height))return;
    const vw=window.innerWidth || 1024,vh=window.innerHeight || 768;
    const width=panel.offsetWidth || 220,height=Math.min(panel.offsetHeight || 180,Math.max(120,vh-80));
    const spaceRight=vw-rect.right-8,spaceLeft=rect.left-8;
    let left=spaceRight>=width || spaceRight>=spaceLeft?rect.right+4:rect.left-width-4;
    left=Math.max(8,Math.min(left,vw-width-8));
    let top=rect.top;
    if(top+height>vh-16)top=Math.max(16,vh-height-16);
    panel.style.left=Math.round(left)+'px';
    panel.style.top=Math.round(top)+'px';
  }

  function openSubmenu(trigger,row,bucket){
    if(activeSubmenu?.trigger===trigger){closeSubmenu(true);return;}
    closeSubmenu(false);
    const inSheet=trigger.closest?.('.post-overflow-menu-bottom-sheet');
    const items=[...bucket.querySelectorAll(':scope > [data-rt-menu-action]')];
    if(!items.length)return;
    row.setAttribute('aria-expanded','true');
    if(inSheet){
      const slot=trigger.closest?.('[slot="devvit-context-actions"]');
      const host=slot?.parentElement || inSheet;
      const hidden=[];
      for(const node of [...host.children]){hidden.push({node,display:node.style.display});node.style.display='none';}
      const panel=make('div','rt-menu-sheet-panel');
      panel.dataset.rtMenuGroup='panel';
      panel.setAttribute('role','menu');
      panel.setAttribute('aria-label','Reddit Tweaks');
      const backLi=make('li','relative list-none mt-0');backLi.setAttribute('role','presentation');backLi.dataset.rtMenuGroup='back';
      const backRow=make('div',ROW);backRow.setAttribute('role','menuitem');backRow.tabIndex=-1;backRow.style.paddingInlineEnd='16px';
      const lead=make('span','flex items-center gap-xs min-w-0 shrink'),box=make('span','flex shrink-0 items-center justify-center h-xl w-xl text-20 leading-4');
      box.append(glyph('arrow-back'));
      const text=make('span','flex items-center min-w-0 shrink py-[0.375rem]');text.append(make('span','text-body-2','Back'));
      lead.append(box,text);backRow.append(lead);backLi.append(backRow);
      const goBack=event=>{event.preventDefault();event.stopImmediatePropagation();closeSubmenu(true);};
      backRow.addEventListener('click',goBack,true);
      backRow.addEventListener('keydown',event=>{if(event.key==='Enter' || event.key===' ' || event.key==='ArrowLeft'){goBack(event);}},true);
      panel.append(backLi,...items);
      host.append(panel);
      const onOutside=event=>{if(!inSheet.isConnected){closeSubmenu(false);return;}const path=event.composedPath?.() || [];if(!path.includes(panel) && !path.includes(inSheet))closeSubmenu(false);};
      const onKeydown=event=>{if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();closeSubmenu(true);}};
      const onReposition=()=>{if(!inSheet.isConnected)closeSubmenu(false);};
      activeSubmenu={trigger,row,bucket,panel,hidden,onOutside,onKeydown,onReposition,hoverTimer:0};
      document.addEventListener('pointerdown',onOutside,true);
      document.addEventListener('keydown',onKeydown,true);
      backRow.focus({preventScroll:true});
      return;
    }
    const panel=make('ul','rt-menu-flyout');
    panel.dataset.rtMenuGroup='flyout';
    panel.setAttribute('role','menu');
    panel.setAttribute('aria-label','Reddit Tweaks');
    for(const item of items)panel.append(item);
    document.body.append(panel);
    positionFlyout(row,panel);
    const focusItems=()=>[...panel.querySelectorAll('[role="menuitem"]:not([aria-disabled="true"])')];
    const onOutside=event=>{
      const path=event.composedPath?.() || [];
      if(path.includes(panel) || path.includes(trigger))return;
      closeSubmenu(false);
    };
    const onKeydown=event=>{
      if(event.key==='Escape' || event.key==='ArrowLeft'){event.preventDefault();event.stopImmediatePropagation();closeSubmenu(true);return;}
      if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
      const list=focusItems();if(!list.length)return;
      event.preventDefault();event.stopImmediatePropagation();
      const i=list.indexOf(document.activeElement);
      const next=event.key==='Home'?0:event.key==='End'?list.length-1:i<0?(event.key==='ArrowUp'?list.length-1:0):(i+(event.key==='ArrowUp'?-1:1)+list.length)%list.length;
      list[next]?.focus({preventScroll:true});
    };
    const onReposition=()=>{if(!trigger.isConnected)closeSubmenu(false);else positionFlyout(row,panel);};
    panel.addEventListener('pointerenter',()=>{if(activeSubmenu?.panel===panel)clearTimeout(activeSubmenu.hoverTimer);});
    panel.addEventListener('pointerleave',()=>{if(activeSubmenu?.panel===panel)activeSubmenu.hoverTimer=setTimeout(()=>closeSubmenu(false),220);});
    activeSubmenu={trigger,row,bucket,panel,hidden:[],onOutside,onKeydown,onReposition,hoverTimer:0};
    document.addEventListener('pointerdown',onOutside,true);
    document.addEventListener('keydown',onKeydown,true);
    window.addEventListener('scroll',onReposition,true);
    window.addEventListener('resize',onReposition);
    focusItems()[0]?.focus({preventScroll:true});
  }

  function buildGroupTrigger(){
    const li=make('li','relative list-none mt-0');
    li.setAttribute('role','presentation');
    li.dataset.rtMenuGroup='trigger';
    li.dataset.rtUi='tweaks-menu-group';
    const row=make('div',ROW);
    row.setAttribute('role','menuitem');
    row.setAttribute('aria-haspopup','menu');
    row.setAttribute('aria-expanded','false');
    row.tabIndex=-1;
    row.style.paddingInlineEnd='16px';
    const lead=make('span','flex items-center gap-xs min-w-0 shrink'),box=make('span','flex shrink-0 items-center justify-center h-xl w-xl text-20 leading-4');
    box.append(glyph('tweaks'));
    const text=make('span','flex items-center min-w-0 shrink py-[0.375rem]');
    text.append(make('span','text-body-2','Reddit Tweaks'));
    const tail=make('span','flex items-center shrink-0');tail.append(glyph('chevron-right'));
    lead.append(box,text);row.append(lead,tail);
    const bucket=make('ul');bucket.dataset.rtMenuGroup='items';bucket.hidden=true;
    li.append(row,bucket);
    const activate=event=>{event.preventDefault();event.stopImmediatePropagation();openSubmenu(li,row,bucket);};
    row.addEventListener('click',activate,true);
    row.addEventListener('keydown',event=>{if(['Enter',' ','ArrowRight'].includes(event.key))activate(event);},true);
    row.addEventListener('pointerenter',()=>{
      if(li.closest?.('.post-overflow-menu-bottom-sheet'))return;
      if(activeSubmenu?.trigger===li){clearTimeout(activeSubmenu.hoverTimer);return;}
      openSubmenu(li,row,bucket);
    });
    row.addEventListener('pointerleave',()=>{
      if(activeSubmenu?.trigger===li && !li.closest?.('.post-overflow-menu-bottom-sheet')){
        activeSubmenu.hoverTimer=setTimeout(()=>closeSubmenu(false),220);
      }
    });
    return li;
  }

  function collectActions(slot){
    const trigger=slot.querySelector(':scope > [data-rt-menu-group="trigger"]');
    const direct=[...slot.querySelectorAll(':scope > [data-rt-menu-action]')];
    const bucket=trigger?.querySelector(':scope > [data-rt-menu-group="items"]');
    const collapsed=bucket?[...bucket.querySelectorAll(':scope > [data-rt-menu-action]')]:[];
    const flying=activeSubmenu?.trigger===trigger && activeSubmenu.panel?[...activeSubmenu.panel.querySelectorAll(':scope > [data-rt-menu-action]')]:[];
    const seen=new Set(),ordered=[];
    for(const item of [...collapsed,...flying,...direct]){
      const key=item.dataset.rtMenuAction || '';
      if(key && seen.has(key)){item.remove();continue;}
      if(key)seen.add(key);
      ordered.push(item);
    }
    return {trigger,bucket,ordered};
  }

  function reconcile(target){
    if(!target)return;
    const slot=target.matches?.('[slot="devvit-context-actions"]')?target:target.querySelector?.(':scope > [slot="devvit-context-actions"]');
    if(!slot)return;
    const menu=slot.closest?.(inline);
    if(menu)clampMenu(menu);
    const {trigger,bucket,ordered}=collectActions(slot);
    if(ordered.length>2){
      const group=trigger || buildGroupTrigger();
      const targetBucket=group.querySelector(':scope > [data-rt-menu-group="items"]');
      const openHere=activeSubmenu?.trigger===group && activeSubmenu.panel;
      for(const item of ordered){
        const dest=openHere?activeSubmenu.panel:targetBucket;
        if(item.parentElement!==dest)dest.append(item);
      }
      if(group.parentElement!==slot)slot.append(group);
    }else if(trigger){
      if(activeSubmenu?.trigger===trigger)closeSubmenu(false);
      for(const item of ordered)slot.append(item);
      trigger.remove();
    }
    if(menuIsOpen(slot))scheduleResize();
  }

  function retainAction(portal,selector){
    const slots=[...portal.querySelectorAll('[slot="devvit-context-actions"]')];
    const keep=slots.find(slot=>slot.querySelector('shreddit-async-loader,hr,li:not([data-rt-raffle],[data-rt-download],[data-rt-menu-action],[data-rt-menu-group])')) || slots[0];
    if(!keep)return;
    const items=[...new Set(slots.flatMap(slot=>[...slot.querySelectorAll(selector)]))];
    const survivor=keep.querySelector(selector) || items[0];
    if(survivor){
      // Reddit can add its own loader after projecting the extension-only slot.
      // Move the live row before removing duplicates so a late native slot cannot erase it.
      if(!keep.contains(survivor)){
        if(keep.moveBefore)keep.moveBefore(survivor,null);
        else keep.append(survivor);
      }
      for(const item of items)if(item!==survivor)item.remove();
    }
    for(const slot of slots)if(slot!==keep)slot.querySelector(':scope > [data-rt-menu-group="trigger"]')?.remove();
    reconcile(keep);
  }

  document.addEventListener('pointerdown',event=>{
    const menu=event.composedPath?.().find(node=>node?.tagName==='SHREDDIT-POST-OVERFLOW-MENU');
    if(menu)prepareOpen(menu);
  },true);

  globalThis.RTPostMenuDOM=Object.freeze({
    inline,sheet,isMenuMutation,retainAction,reconcile,clampMenu,prepareOpen,scheduleResize,closeSubmenu,
    onlyMenuChanges:records=>records.length>0 && records.every(isMenuMutation)
  });
})();
