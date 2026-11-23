/* Applied-filter rail for the chat panel (docs/filter-pills-spec.md, "Chat search"). The rail is one non-scrolling,
   non-wrapping line: pills that fit are shown in order, the rest hide behind a "+N" chip that lists every applied
   filter, each removable, with Clear all. The list is a popover inside the chat's shadow root; in a phone-width
   window it is Reddit's phone bottom sheet (RTFeedSheet) when that is loaded. Nothing outside the rail moves. */
(() => {
  'use strict';
  if(globalThis.RCSFilterRail)return;
  const PILL='.sender-chip,.filter-chip,.date-chip',PHONE='(max-width: 767.98px)';
  const rails=new WeakMap();
  let openList=null;
  const make=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text!=null)el.textContent=text;return el;};
  const CLOSE='m11.273 10 5.363-5.363a.9.9 0 10-1.273-1.273L10 8.727 4.637 3.364a.9.9 0 10-1.273 1.273L8.727 10l-5.363 5.363a.9.9 0 101.274 1.273L10 11.273l5.363 5.363a.897.897 0 001.274 0 .9.9 0 000-1.273L11.275 10h-.002Z';
  const closeGlyph=size=>{const NS='http://www.w3.org/2000/svg',svg=document.createElementNS(NS,'svg'),path=document.createElementNS(NS,'path');svg.setAttribute('viewBox','0 0 20 20');svg.setAttribute('width',String(size));svg.setAttribute('height',String(size));svg.setAttribute('fill','currentColor');svg.setAttribute('aria-hidden','true');path.setAttribute('d',CLOSE);svg.append(path);return svg;};
  const phone=()=>Boolean(globalThis.matchMedia?.(PHONE)?.matches && globalThis.RTFeedSheet);
  const pillsOf=rail=>[...rail.children].filter(node=>node.matches(PILL) && !node.hidden);
  const labelOf=node=>(node.querySelector('.sender-chip-value,.date-chip-edit')?.textContent || node.querySelector('span')?.textContent || node.textContent || '').trim() || 'Filter';
  const removerOf=node=>node.querySelector('.date-remove') || node.querySelector(':scope > button:last-of-type');
  const iconOf=node=>{const lead=node.querySelector('.sender-chip-avatar,.sender-chip-icon,.applied-filter-icon,svg');return lead?lead.cloneNode(true):null;};
  const entriesOf=rail=>pillsOf(rail).map(node=>({node,label:labelOf(node),remove:()=>removerOf(node)?.click()}));
  const clearAll=entries=>{for(const entry of [...entries].reverse())entry.remove();};
  const closeList=()=>{const list=openList;openList=null;list?.close();};
  function fit(rail){
    if(!rail)return;
    let state=rails.get(rail);
    if(!state){
      state={frame:0,observer:null};rails.set(rail,state);
      if(typeof ResizeObserver==='function'){state.observer=new ResizeObserver(()=>{cancelAnimationFrame(state.frame);state.frame=requestAnimationFrame(()=>layout(rail));});state.observer.observe(rail);}
    }
    layout(rail);
  }
  function layout(rail){
    rail.querySelector(':scope > .rcs-rail-more')?.remove();
    for(const node of rail.querySelectorAll(':scope > [data-rcs-fit-hidden]'))node.removeAttribute('data-rcs-fit-hidden');
    rail.removeAttribute('data-rcs-fit');
    if(!rail.isConnected || rail.hidden)return;
    const pills=pillsOf(rail);
    if(!pills.length || rail.scrollWidth<=rail.clientWidth+1)return;
    const more=make('button','rcs-rail-more');more.type='button';more.setAttribute('aria-haspopup','dialog');more.setAttribute('aria-expanded','false');
    more.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();toggleList(rail,more);});
    // Beside the add-sender button when it ends the rail, so the chip follows the pills it stands for.
    const add=rail.querySelector(':scope > .global-filter-add,:scope > .room-add-sender');
    if(add && !add.nextElementSibling)add.before(more);else rail.append(more);
    let shown=pills.length;
    const label=()=>{const hidden=pills.length-shown;more.textContent=shown?'+'+hidden:pills.length+' filters';more.setAttribute('aria-label',(shown?hidden+' more filters':pills.length+' filters applied')+'. Show all applied filters');};
    while(shown>0 && (label(),rail.scrollWidth>rail.clientWidth+1)){shown--;pills[shown].setAttribute('data-rcs-fit-hidden','');}
    label();
    rail.setAttribute('data-rcs-fit',shown?'partial':'collapsed');
  }
  function toggleList(rail,anchor){
    if(openList?.anchor===anchor){closeList();return;}
    closeList();
    const entries=entriesOf(rail);if(!entries.length)return;
    anchor.setAttribute('aria-expanded','true');
    if(phone()){
      const sheet=globalThis.RTFeedSheet.open({title:'Applied filters',returnFocus:anchor,onClose:()=>anchor.setAttribute('aria-expanded','false'),build:(_body,ui)=>{
        for(const entry of entries){const lead=iconOf(entry.node);ui.row({label:entry.label,icon:lead,action:{label:'Remove filter '+entry.label,icon:closeGlyph(16),onSelect:entry.remove},onSelect:entry.remove});}
        ui.divider();ui.row({label:'Clear all filters',onSelect:()=>clearAll(entries)});
      }});
      openList={anchor,close:()=>sheet?.close?.()};return;
    }
    const pop=make('div','popover menu-popover rcs-rail-list');pop.setAttribute('role','dialog');pop.setAttribute('aria-label','Applied filters');
    const head=make('div','rcs-rail-list-head'),all=make('button','rcs-rail-list-clear','Clear all');all.type='button';
    all.addEventListener('click',event=>{event.preventDefault();closeList();clearAll(entries);});
    head.append(make('span','rcs-rail-list-title','Applied filters'),all);pop.append(head);
    for(const entry of entries){
      const row=make('div','rcs-rail-list-row'),lead=iconOf(entry.node),remove=make('button','rcs-rail-list-remove');
      remove.type='button';remove.setAttribute('aria-label','Remove filter '+entry.label);remove.append(closeGlyph(12));
      remove.addEventListener('click',event=>{event.preventDefault();closeList();entry.remove();});
      if(lead){lead.classList.add('rcs-rail-list-icon');row.append(lead);}
      row.append(make('span','rcs-rail-list-label',entry.label),remove);pop.append(row);
    }
    rail.parentNode.append(pop);
    place(pop,anchor);
    const root=anchor.getRootNode();
    const away=event=>{const path=event.composedPath();if(!path.includes(pop) && !path.includes(anchor))closeList();};
    const keys=event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeList();anchor.focus({preventScroll:true});}};
    document.addEventListener('pointerdown',away,true);root.addEventListener('keydown',keys,true);
    openList={anchor,close:()=>{document.removeEventListener('pointerdown',away,true);root.removeEventListener('keydown',keys,true);pop.remove();anchor.setAttribute('aria-expanded','false');}};
    pop.querySelector('button')?.focus({preventScroll:true});
  }
  // Under the +N chip, kept inside the offset parent's width; the popover is absolutely positioned in the shadow root.
  function place(pop,anchor){
    const parent=pop.offsetParent || pop.parentNode,frame=parent.getBoundingClientRect(),box=anchor.getBoundingClientRect(),width=Math.min(260,frame.width-16);
    pop.style.width=width+'px';pop.style.right='auto';
    pop.style.left=Math.round(Math.max(8,Math.min(box.right-frame.left-width,frame.width-width-8)))+'px';
    pop.style.top=Math.round(box.bottom-frame.top+4)+'px';
  }
  globalThis.RCSFilterRail=Object.freeze({fit,close:closeList,isOpen:()=>Boolean(openList)});
})();
