/* Phone bottom sheet for profile Feed options (docs/feed-options-sheet-spec.md), shaped like Reddit's app: a title
   with a round close button, rows listed directly (check / chevron / subtitle), dividers, titled chip groups, and
   drill-in pages with Back. Pages are built by the caller each time they render, from the live desktop menu, so every
   choice runs through the menu's existing handlers. */
(() => {
 'use strict';
 if(globalThis.RTFeedSheet)return;
 const SVG='http://www.w3.org/2000/svg';
 const PATHS={
  close:'m11.273 10 5.363-5.363a.9.9 0 10-1.273-1.273L10 8.727 4.637 3.364a.9.9 0 10-1.273 1.273L8.727 10l-5.363 5.363a.9.9 0 101.274 1.273L10 11.273l5.363 5.363a.897.897 0 001.274 0 .9.9 0 000-1.273L11.275 10h-.002Z',
  check:'M7.09 15.84c-.23 0-.46-.09-.64-.26L1.3 10.42a.9.9 0 010-1.27.9.9 0 011.27 0l4.52 4.52L17.5 3.26a.9.9 0 011.27 0 .9.9 0 010 1.27L7.73 15.58c-.18.18-.41.26-.64.26Z',
  next:'M7.4 3.6 6.1 4.9 11.2 10l-5.1 5.1 1.3 1.3 6.4-6.4-6.4-6.4Z',
  back:'M12.6 3.6 6.2 10l6.4 6.4 1.3-1.3L8.8 10l5.1-5.1-1.3-1.3Z'
 };
 const make=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text!=null)el.textContent=text;return el;};
 const glyph=(name,size=20)=>{const s=document.createElementNS(SVG,'svg');s.setAttribute('viewBox','0 0 20 20');s.setAttribute('width',String(size));s.setAttribute('height',String(size));s.setAttribute('fill','currentColor');s.setAttribute('aria-hidden','true');s.dataset.rtSheetIcon=name;const p=document.createElementNS(SVG,'path');p.setAttribute('d',PATHS[name]);s.append(p);return s;};
 let active=null,seq=0;

 function open({title,build,returnFocus=null,onClose=null,modal=false}){
  close();
  const id='rt-fsheet-title-'+(++seq),root=make(modal?'dialog':'div','rt-fsheet-root'),scrim=make('div','rt-fsheet-scrim'),sheet=make('section','rt-fsheet');
  root.dataset.rtUi='feed-sheet';scrim.setAttribute('aria-hidden','true');
  const dialog=modal?root:sheet;dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-labelledby',id);
  const head=make('div','rt-fsheet-head'),back=make('button','rt-fsheet-back'),heading=make('h2','rt-fsheet-title'),closer=make('button','rt-fsheet-close'),body=make('div','rt-fsheet-body');
  heading.id=id;back.type='button';back.setAttribute('aria-label','Back');back.append(glyph('back'));closer.type='button';closer.setAttribute('aria-label','Close');closer.append(glyph('close'));
  head.append(back,heading,closer);sheet.append(head,body);root.append(scrim,sheet);
  const pages=[{title,build}];
  const state={root,body,closeFn:null,returnFocus,onClose,pages,leaving:[]};
  const ui={
   // A list row: real link when href is given (Reddit's own navigation), else a button. Optional: an avatar (URL or
   // node) in the lead, a trailing action button (for example sign out), ask-twice (confirm), and an async onSelect
   // whose {ok:false,error} result stays on screen.
   row({label,subtitle='',icon=null,avatar=null,selected=false,chevron=false,href='',onSelect=null,keepOpen=false,toggle=false,role='',confirm=false,busy='',action=null}){
    const el=make(href?'a':'button','rt-fsheet-row');if(href)el.href=href;else el.type='button';if(role)el.setAttribute('role',role);
    if(toggle)el.setAttribute('aria-pressed',String(selected));else if(selected)el.setAttribute('aria-current','true');
    const lead=make('span','rt-fsheet-lead');
    if(avatar){lead.classList.add('rt-fsheet-avatar');if(typeof avatar==='string'){const img=make('img');img.src=avatar;img.alt='';img.referrerPolicy='no-referrer';img.loading='lazy';lead.append(img);}else lead.append(avatar);}
    else if(icon)lead.append(icon);
    el.append(lead);
    const copy=make('span','rt-fsheet-copy'),sub=make('span','rt-fsheet-sub');
    const say=value=>{sub.replaceChildren(...(value?[value]:[]));sub.hidden=!value;};
    say(subtitle);copy.append(make('span','rt-fsheet-label',label),sub);el.append(copy);
    const tail=make('span','rt-fsheet-tail');if(selected)tail.append(glyph('check'));else if(chevron)tail.append(glyph('next'));el.append(tail);
    const run=async(handler,{ask,working,stay})=>{
     if(el.getAttribute('aria-busy')==='true')return;
     if(ask && !el.dataset.armed){el.dataset.armed='true';say('Tap again to continue');clearTimeout(el.rtDisarm);el.rtDisarm=setTimeout(()=>{delete el.dataset.armed;say(subtitle);},4000);return;}
     clearTimeout(el.rtDisarm);delete el.dataset.armed;
     const previous=pages.at(-1),focus=document.activeElement===el?label:'';
     const refresh=()=>{if(pages.at(-1)===previous)ui.refresh(focus);};
     const result=handler();
     if(!result || typeof result.then!=='function'){if(!stay)close();else refresh();return;}
     el.setAttribute('aria-busy','true');if(working)say(working);
     const value=await result.catch(error=>({ok:false,error:error?.message}));el.removeAttribute('aria-busy');
     if(value?.ok===false){say(value.error || 'Something went wrong. Try again.');return;}
     if(!stay && !value?.stay)close();else refresh();
    };
    el.addEventListener('click',event=>{if(!onSelect){if(href)close();return;}event.preventDefault();run(()=>onSelect(event),{ask:confirm,working:busy,stay:keepOpen});});
    if(!action){body.append(el);return el;}
    const item=make('div','rt-fsheet-item'),button=make('button','rt-fsheet-action');button.type='button';button.setAttribute('aria-label',action.label);button.title=action.label;if(action.icon)button.append(action.icon);
    button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();run(()=>action.onSelect(event),{ask:action.confirm,working:action.busy,stay:false});});
    item.append(el,button);body.append(item);return el;
   },
   // A titled group of toggle chips.
   chips(title,items){
    const group=make('div','rt-fsheet-group');if(title){const t=make('div','rt-fsheet-group-title',title);group.append(t);}
    const wrap=make('div','rt-fsheet-chips');group.append(wrap);
    for(const item of items){
     if(item.heading){wrap.append(make('div','rt-fsheet-chip-heading',item.heading));continue;}
     const chip=make('button','rt-fsheet-chip');chip.type='button';chip.setAttribute('aria-pressed',String(Boolean(item.selected)));
     if(item.selected)chip.append(glyph('check',16));if(item.icon && !item.selected)chip.append(item.icon);chip.append(make('span','',item.label));
     chip.addEventListener('click',event=>{event.preventDefault();item.onSelect?.(event);if(!item.keepOpen)close();else ui.refresh();});
     wrap.append(chip);
    }
    body.append(group);return group;
   },
   title(text){body.append(make('div','rt-fsheet-section',text));},
   divider(){if(body.lastElementChild && !body.lastElementChild.matches('.rt-fsheet-divider'))body.append(make('hr','rt-fsheet-divider'));},
   // A drill-in page (Top's time ranges, Community) with Back.
   push(page){pages.push(page);render();},
   pop(){if(pages.length>1){pages.pop();render();}},
   // Some choices (Post type, Community) stay open: rebuild after the menu has applied them.
   refresh(focus=''){setTimeout(()=>{
    if(active!==state)return;
    render(true);
    if(focus)[...body.querySelectorAll('.rt-fsheet-row')].find(row=>row.querySelector('.rt-fsheet-label')?.textContent===focus)?.focus({preventScroll:true});
   },0);},
   close,
   // A node lent to a page (the community picker) is handed back when the page or sheet goes away.
   lend(node,restore){state.leaving.push(restore);body.append(node);}
  };
  const giveBack=()=>{for(const restore of state.leaving.splice(0))try{restore();}catch{}};
  function render(keepScroll=false){
   const top=keepScroll?body.scrollTop:0;giveBack();body.replaceChildren();const page=pages.at(-1);
   heading.textContent=page.title;back.hidden=pages.length<2;sheet.dataset.depth=String(pages.length);
   try{page.build(body,ui);}catch(error){body.append(make('p','rt-fsheet-error',error?.message || 'Feed options are unavailable.'));}
   if(!body.lastElementChild)close();else body.scrollTop=top;
  }
  back.addEventListener('click',event=>{event.preventDefault();ui.pop();});
  closer.addEventListener('click',event=>{event.preventDefault();close();});
  scrim.addEventListener('click',event=>{event.preventDefault();close();});
  if(modal)root.addEventListener('cancel',event=>{event.preventDefault();close();});
  const onKey=event=>{if(event.key!=='Escape')return;event.preventDefault();event.stopPropagation();if(pages.length>1)ui.pop();else close();};
  const onMedia=()=>{if(!globalThis.matchMedia?.('(max-width: 767.98px)')?.matches)close();};
  const media=globalThis.matchMedia?.('(max-width: 767.98px)');media?.addEventListener?.('change',onMedia);
  document.addEventListener('keydown',onKey,true);
  state.closeFn=()=>{giveBack();document.removeEventListener('keydown',onKey,true);media?.removeEventListener?.('change',onMedia);if(modal)root.close?.();root.remove();};
  active=state;document.body.append(root);
  if(modal){if(root.showModal)root.showModal();else root.setAttribute('open','');}
  render();
  if(active===state){root.dataset.open='true';closer.focus({preventScroll:true});}
  return {close,refresh:ui.refresh,root};
 }
 function close(){
  const state=active;if(!state)return;active=null;state.closeFn?.();
  try{state.onClose?.();}catch{}
  if(state.returnFocus?.isConnected)state.returnFocus.focus?.({preventScroll:true});
 }
 function postTypeRows(ui,{selected,onClear,onToggle}){
  const filters=globalThis.RTFeedFilters;
  ui.row({label:'All types',selected:!selected.length,toggle:true,keepOpen:true,onSelect:onClear});
  for(const section of filters.typeSections){
   ui.title(section.label);
   for(const type of section.types)ui.row({label:filters.typeLabels[type],
    icon:filters.svgIcon(type==='gif'?'gif-post-outline':filters.typeIcons[type],20),
    selected:selected.includes(type),toggle:true,keepOpen:true,onSelect:()=>onToggle(type)});
  }
 }
 globalThis.RTFeedSheet=Object.freeze({open,close,postTypeRows,isOpen:()=>Boolean(active)});
})();
