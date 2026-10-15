/* A single local calendar. Selecting dates never sends a Reddit request. */
(() => {
  const make=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
  const iso=value=>`${String(value.getFullYear()).padStart(4,'0')}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;
  function validDate(year,month,day){if(!Number.isInteger(year)||year<1||year>9999||!Number.isInteger(month)||month<1||month>12||!Number.isInteger(day)||day<1||day>31)return null;const value=new Date(0);value.setHours(12,0,0,0);value.setFullYear(year,month-1,day);return value.getFullYear()===year&&value.getMonth()===month-1&&value.getDate()===day?value:null;}
  const parse=value=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(value || ''))return null;const [y,m,d]=value.split('-').map(Number);return validDate(y,m,d);};
  const shift=(value,days)=>{const result=parse(value);if(!result)return '';result.setDate(result.getDate()+days);return result.getFullYear()>=1&&result.getFullYear()<=9999?iso(result):'';};
  const frame=callback=>typeof requestAnimationFrame==='function'?requestAnimationFrame(callback):setTimeout(callback,0);
  const cancelFrame=id=>typeof cancelAnimationFrame==='function'?cancelAnimationFrame(id):clearTimeout(id);
  const glyph=(name)=>{const node=document.createElementNS('http://www.w3.org/2000/svg','svg');node.setAttribute('viewBox','0 0 24 24');node.setAttribute('fill','none');node.setAttribute('stroke','currentColor');node.setAttribute('stroke-width','1.8');node.setAttribute('stroke-linecap','round');node.setAttribute('stroke-linejoin','round');node.setAttribute('aria-hidden','true');node.innerHTML=name==='back'?'<path d="m14 6-6 6 6 6"/>':'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>';return node;};
  const modes=['On','Before','After','Between'];
  class DatePicker {
    constructor({onChange,onClose,getBounds,getAnchor,chatMode=false,getAvailability}={}) {
      this.onChange=onChange;this.onClose=onClose;this.getBounds=getBounds;this.getAnchor=getAnchor;this.chatMode=chatMode;this.getAvailability=getAvailability;this.applied={mode:chatMode?'On':'Between',start:'',end:''};this.draft={...this.applied};
      this.view=new Date();this.view.setDate(1);this.chooser='';this.element=make('section','date-popover');this.element.hidden=true;
      this.element.setAttribute('role','dialog');this.element.setAttribute('aria-label','Filter messages by date');
      this.element.addEventListener('keydown',event=>{
        if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(this.chooser){const selector=`.calendar-${this.chooser}`;this.chooser='';this.render();this.element.querySelector(selector)?.focus({preventScroll:true});}else this.close();return;}
        if(event.target.closest('.calendar-quick')&&['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();event.stopPropagation();this.toggleQuick(true);return;}
        const option=event.target.closest('.calendar-option');
        if(option) {
          const offsets={ArrowLeft:-1,ArrowRight:1,ArrowUp:this.chooser==='quick'?-1:this.chooser==='month'?-3:-4,ArrowDown:this.chooser==='quick'?1:this.chooser==='month'?3:4};
          if(Object.hasOwn(offsets,event.key)||['Home','End'].includes(event.key)){event.preventDefault();event.stopPropagation();const options=[...this.element.querySelectorAll('.calendar-option')],position=options.indexOf(option),next=event.key==='Home'?0:event.key==='End'?options.length-1:Math.max(0,Math.min(options.length-1,position+offsets[event.key]));options[next]?.focus({preventScroll:true});}
          return;
        }
        const button=event.target.closest('button[data-date]');if(!button)return;
        if(['Home','End','PageUp','PageDown'].includes(event.key)){
          event.preventDefault();event.stopPropagation();let value=button.dataset.date;const day=parse(value);
          if(event.key==='Home'||event.key==='End')value=shift(value,event.key==='Home'?-day.getDay():6-day.getDay());
          else {const number=day.getDate();day.setDate(1);day.setMonth(day.getMonth()+(event.key==='PageDown'?1:-1));const last=new Date(day);last.setMonth(last.getMonth()+1,0);day.setDate(Math.min(number,last.getDate()));value=day.getFullYear()>=1&&day.getFullYear()<=9999?iso(day):'';}
          if(value&&this.selectable(value)){const day=parse(value);this.view=validDate(day.getFullYear(),day.getMonth()+1,1);this.render();this.focusDay(value);}return;
        }
        const offsets={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7};
        if(Object.hasOwn(offsets,event.key)) {
          event.preventDefault();event.stopPropagation();const value=shift(button.dataset.date,offsets[event.key]);if(!value||!this.selectable(value))return;const day=parse(value);
          this.view=validDate(day.getFullYear(),day.getMonth()+1,1);this.render();this.focusDay(value);
        }
      });
    }
    today(){return iso(new Date());}
    // Cached message days are hints, never proof that earlier history is unavailable.
    // Only verified:true permits min/max limits; chat mode always excludes future days.
    availability(){const supplied=this.getAvailability?.()||{},min=supplied.verified===true&&parse(supplied.min)?supplied.min:'',suppliedMax=supplied.verified===true&&parse(supplied.max)?supplied.max:'';return {min,max:this.chatMode?(suppliedMax&&suppliedMax<this.today()?suppliedMax:this.today()):suppliedMax,days:new Set(Array.from(supplied.days||[]).filter(value=>parse(value)))};}
    selectable(value,availability=this.availability()){return Boolean(parse(value)&&(!availability.min||value>=availability.min)&&(!availability.max||value<=availability.max));}
    instruction(){const {mode,start,end}=this.draft,short=value=>parse(value)?.toLocaleDateString(undefined,{month:'short',day:'numeric'}) || '';if(mode==='Between')return !start?'Choose a start date':!end?`${short(start)} → select end`:`${short(start)} → ${short(end)}`;return !start?`Choose a date · ${mode.toLowerCase()}`:`${mode} ${short(start)}`;}
    visibleRanges(){const today=this.today();return [{label:'Today',start:today,end:today},{label:'Yesterday',start:shift(today,-1),end:shift(today,-1)},{label:'Last 7 days',start:shift(today,-6),end:today},{label:'Last 30 days',start:shift(today,-29),end:today}];}
    presets(){const choices=make('div','calendar-presets calendar-visible-presets');choices.setAttribute('role','group');choices.setAttribute('aria-label','Quick date ranges');for(const range of this.visibleRanges()){const button=make('button','calendar-preset',range.label);button.type='button';button.dataset.preset=range.label;button.disabled=!this.selectable(range.start)||!this.selectable(range.end);button.setAttribute('aria-pressed',String(this.draft.start===range.start&&(this.draft.mode==='On'?range.start===range.end:this.draft.mode==='Between'&&this.draft.end===range.end)));button.addEventListener('click',()=>this.chooseRange(range));choices.append(button);}return choices;}
    quickRanges(){
      if(this.chatMode)return this.visibleRanges();
      const today=this.today(),now=parse(today),year=now.getFullYear(),month=now.getMonth()+1,lastDay=(year,month)=>{const value=validDate(year,month,1);value.setMonth(value.getMonth()+1,0);return iso(value);},previous=new Date(now);previous.setMonth(previous.getMonth(),0);
      return [{label:'Last 7 days',start:shift(today,-6),end:today},{label:'Last 30 days',start:shift(today,-29),end:today},{label:'This month',start:iso(validDate(year,month,1)),end:lastDay(year,month)},{label:'Last month',start:iso(validDate(previous.getFullYear(),previous.getMonth()+1,1)),end:iso(previous)},{label:'This year',start:iso(validDate(year,1,1)),end:iso(validDate(year,12,31))}];
    }
    toggleQuick(open=this.chooser!=='quick'){this.chooser=open?'quick':'';this.render();(open?this.element.querySelector('.calendar-preset[aria-pressed=true]')||this.element.querySelector('.calendar-preset'):this.element.querySelector('.calendar-quick'))?.focus({preventScroll:true});}
    chooseRange(range){if(!this.selectable(range.start)||!this.selectable(range.end)||range.end<range.start)return;this.draft={mode:this.chatMode&&range.start===range.end?'On':'Between',start:range.start,end:this.chatMode&&range.start===range.end?'':range.end};const start=parse(range.start);this.view=validDate(start.getFullYear(),start.getMonth()+1,1);this.chooser='';this.render();(this.element.querySelector(`[data-preset="${range.label}"]`)||this.element.querySelector('.calendar-quick'))?.focus({preventScroll:true});}
    actions(){const actions=make('div','calendar-actions'),clear=make('button','calendar-clear','Clear'),quick=make('button','calendar-quick'),apply=make('button','calendar-apply','Apply');clear.type=quick.type=apply.type='button';clear.addEventListener('click',()=>this.reset());quick.append(glyph(this.chooser==='quick'?'back':'clock'),make('span','',this.chooser==='quick'?'Calendar':'Quick ranges'));quick.setAttribute('aria-label',this.chooser==='quick'?'Back to calendar':'Quick date ranges');quick.title=quick.getAttribute('aria-label');quick.setAttribute('aria-expanded',String(this.chooser==='quick'));quick.setAttribute('aria-controls','calendar-quick-ranges');quick.addEventListener('click',()=>this.toggleQuick());apply.disabled=!this.bounds();apply.addEventListener('click',()=>this.apply());if(this.chatMode)actions.append(clear,apply);else actions.append(clear,quick,apply);return actions;}
    get open(){return !this.element.hidden;}
    show(mode='') {
      this.chooser='';this.draft=mode?{mode,start:'',end:''}:{...this.applied};if(parse(this.draft.start)){const day=parse(this.draft.start);this.view=validDate(day.getFullYear(),day.getMonth()+1,1);}else if(mode){const today=new Date();this.view=validDate(today.getFullYear(),today.getMonth()+1,1);}
      this.element.hidden=false;this.render();this.element.scrollTop=0;this.startPosition();const day=this.element.querySelector('[data-date].selected')||this.element.querySelector('[data-date].today')||this.element.querySelector('[data-date]');if(day)this.focusDay(day.dataset.date);
    }
    close(restoreFocus=true){this.stopPosition();this.element.hidden=true;this.onClose?.(restoreFocus);}
    reset(){this.chooser='';this.applied={mode:this.chatMode?'On':'Between',start:'',end:''};this.draft={...this.applied};this.onChange?.({from:'',to:''},'');this.render();}
    focusDay(value){const next=this.element.querySelector(`[data-date="${value}"]`);if(!next||next.disabled)return;for(const day of this.element.querySelectorAll('[data-date]'))day.tabIndex=-1;next.tabIndex=0;next.focus({preventScroll:true});}
    apply(){const bounds=this.bounds();if(!bounds)return;this.applied={...this.draft};this.onChange?.(bounds,this.summary(),{...this.applied});this.close();}
    choose(value) {
      if(!this.selectable(value))return;
      if(this.draft.mode!=='Between' || !this.draft.start || this.draft.end)this.draft={...this.draft,start:value,end:''};
      else {const [start,end]=[this.draft.start,value].sort();this.draft={...this.draft,start,end};}
      this.render();this.focusDay(value);
    }
    bounds() {
      const {mode,start,end}=this.draft;
      if(!this.selectable(start)||mode==='Between'&&(!this.selectable(end)||end<start))return null;
      if(mode==='After'&&!this.selectable(shift(start,1))||mode==='Before'&&!this.selectable(shift(start,-1)))return null;
      if(mode==='Before'){const to=shift(start,-1);return to?{from:'',to}:null;}
      if(mode==='After'){const from=shift(start,1);return from?{from,to:''}:null;}
      return {from:start,to:mode==='On'?start:end};
    }
    summary() {
      const short=value=>parse(value)?.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}) || '';
      const {mode,start,end}=this.draft;
      return start ? mode==='Between' ? end ? `${short(start)} – ${short(end)}` : `${short(start)} · Select end date` : `${mode} ${short(start)}` : mode==='Between' ? 'Select start and end dates' : `Select a date for ${mode.toLowerCase()}`;
    }
    compactSummary() {
      const {mode,start,end}=this.applied;if(!parse(start))return '';
      const short=value=>parse(value)?.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}) || '';
      if(mode!=='Between')return `${mode} ${short(start)}`;
      if(start===end||!parse(end))return short(start);
      const formatter=new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',year:'numeric'});
      return formatter.formatRange ? formatter.formatRange(parse(start),parse(end)) : `${short(start)} – ${short(end)}`;
    }
    clip(){const viewport=window.visualViewport,bounds={left:viewport?.offsetLeft||0,top:viewport?.offsetTop||0,right:(viewport?.offsetLeft||0)+(viewport?.width||window.innerWidth),bottom:(viewport?.offsetTop||0)+(viewport?.height||window.innerHeight)};const supplied=this.getBounds?.();if(supplied)for(const key of ['left','top','right','bottom'])if(Number.isFinite(supplied[key]))bounds[key]=key==='left'||key==='top'?Math.max(bounds[key],supplied[key]):Math.min(bounds[key],supplied[key]);return bounds;}
    // offsetWidth/Height round to integers; computed sizes also preserve native zoom.
    place(){if(!this.open||!this.element.isConnected)return;const root=this.element;root.style.top='';root.style.left='';root.style.right='';root.style.maxWidth='';const bounds=this.clip(),initial=root.getBoundingClientRect(),style=getComputedStyle(root),sx=initial.width/(parseFloat(style.width)||root.offsetWidth)||1,sy=initial.height/(parseFloat(style.height)||root.offsetHeight)||1;root.style.maxWidth=Math.max(0,(bounds.right-bounds.left-12)/sx)+'px';const anchor=this.getAnchor?.(),top=Math.max(Number.isFinite(anchor?.bottom)?anchor.bottom+4:initial.top,bounds.top+4),base=parseFloat(getComputedStyle(root).top)||root.offsetTop;root.style.top=base+(top-initial.top)/sy+'px';root.style.maxHeight=Math.max(0,(bounds.bottom-top-6)/sy)+'px';const rect=root.getBoundingClientRect(),anchorRight=Number.isFinite(anchor?.right)?anchor.right:rect.right,left=Math.max(bounds.left+6,Math.min(anchorRight-rect.width,bounds.right-rect.width-6));if(left!==rect.left){root.style.left=root.offsetLeft+(left-rect.left)/sx+'px';root.style.right='auto';}}
    queuePosition(){if(!this.open||this.positionFrame)return;this.positionFrame=frame(()=>{this.positionFrame=0;this.place();});}
    startPosition(){this.stopPosition();this.positionListener=event=>{if(!(event?.target instanceof Node)||!this.element.contains(event.target))this.queuePosition();};window.addEventListener('resize',this.positionListener);window.addEventListener('scroll',this.positionListener,true);this.visual=window.visualViewport;this.visual?.addEventListener('resize',this.positionListener);this.visual?.addEventListener('scroll',this.positionListener);this.place();}
    stopPosition(){if(this.positionListener){window.removeEventListener('resize',this.positionListener);window.removeEventListener('scroll',this.positionListener,true);this.visual?.removeEventListener('resize',this.positionListener);this.visual?.removeEventListener('scroll',this.positionListener);}if(this.positionFrame)cancelFrame(this.positionFrame);this.positionFrame=0;this.positionListener=null;this.visual=null;}
    render() {
      const root=this.element;root.replaceChildren();
      const modesBar=make('div','date-modes');modesBar.setAttribute('role','group');modesBar.setAttribute('aria-label','Date condition');
      for(const mode of modes) {
        const button=make('button','date-mode',mode);button.type='button';button.setAttribute('aria-pressed',String(mode===this.draft.mode));
        button.addEventListener('click',()=>{this.chooser='';this.draft={...this.draft,mode,end:''};this.render();root.querySelector(`[data-mode="${mode}"]`)?.focus({preventScroll:true});});
        button.dataset.mode=mode;modesBar.append(button);
      }
      const nav=make('div','calendar-nav');
      for(const [text,label,delta]of [['‹','Previous month',-1],['›','Next month',1]]) {
        const button=make('button','calendar-nav-button',text);button.type='button';button.setAttribute('aria-label',label);
        button.disabled=Boolean(this.chooser);
        button.addEventListener('click',()=>{const next=new Date(this.view);next.setDate(1);next.setMonth(next.getMonth()+delta);if(next.getFullYear()<1||next.getFullYear()>9999)return;this.view=next;this.render();root.querySelector(`[aria-label="${label}"]`)?.focus({preventScroll:true});});
        if(delta===-1)nav.append(button);else this.next=button;
      }
      const month=make('button','calendar-month',this.view.toLocaleDateString(undefined,{month:'long'}));
      const year=make('button','calendar-year',String(this.view.getFullYear()));
      for(const [button,kind]of [[month,'month'],[year,'year']]) {
        button.type='button';button.setAttribute('aria-label',`Calendar ${kind}`);button.setAttribute('aria-expanded',String(this.chooser===kind));button.setAttribute('aria-controls','calendar-choices');
        button.addEventListener('click',()=>{this.chooser=this.chooser===kind?'':kind;this.render();root.querySelector(this.chooser?'.calendar-option[aria-pressed=true]':`.calendar-${kind}`)?.focus({preventScroll:true});});
      }
      nav.append(month,year,this.next);
      if(this.chooser==='quick'){
        nav.replaceChildren(glyph('clock'),make('span','','Quick ranges'));nav.classList.add('calendar-quick-heading');
        const choices=make('div','calendar-presets');choices.id='calendar-quick-ranges';choices.setAttribute('role','group');choices.setAttribute('aria-label','Quick date ranges');
        for(const range of this.quickRanges()){
          const row=make('button','calendar-option calendar-preset'),selected=this.draft.mode==='Between'&&this.draft.start===range.start&&this.draft.end===range.end;row.type='button';row.dataset.preset=range.label;row.setAttribute('aria-pressed',String(selected));row.append(make('span','',range.label));const formatter=new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',...(range.start.slice(0,4)!==this.today().slice(0,4)?{year:'numeric'}:{})}),start=parse(range.start),end=parse(range.end);row.append(make('small','calendar-preset-dates',formatter.formatRange?formatter.formatRange(start,end):formatter.format(start)+' – '+formatter.format(end)));row.addEventListener('click',()=>this.chooseRange(range));choices.append(row);
        }
        const summary=make('div','calendar-summary',this.summary());summary.setAttribute('aria-live','polite');root.append(modesBar,nav,choices,summary,this.actions());this.queuePosition();return;
      }
      if(this.chooser) {
        const choices=make('div',`calendar-choices ${this.chooser}-choices`);choices.id='calendar-choices';choices.setAttribute('role','group');choices.setAttribute('aria-label',`Choose ${this.chooser}`);
        const values=this.chooser==='month'?Array.from({length:12},(_,i)=>i):Array.from({length:Math.max(new Date().getFullYear()+1,this.view.getFullYear())-Math.min(2005,this.view.getFullYear())+1},(_,i)=>Math.max(new Date().getFullYear()+1,this.view.getFullYear())-i);
        for(const value of values) {
          const kind=this.chooser,label=kind==='month'?new Date(2020,value,1).toLocaleDateString(undefined,{month:'short'}):String(value),option=make('button','calendar-option',label);option.type='button';option.dataset[kind]=String(value);
          option.setAttribute('aria-label',kind==='month'?new Date(2020,value,1).toLocaleDateString(undefined,{month:'long'}):String(value));option.setAttribute('aria-pressed',String(value===(kind==='month'?this.view.getMonth():this.view.getFullYear())));
          option.addEventListener('click',()=>{this.view=validDate(kind==='year'?value:this.view.getFullYear(),(kind==='month'?value:this.view.getMonth())+1,1);this.chooser='';this.render();root.querySelector(`.calendar-${kind}`)?.focus({preventScroll:true});});choices.append(option);
        }
        const hint=make('div','calendar-summary',`Choose a ${this.chooser}`),actions=make('div','calendar-actions'),back=make('button','calendar-clear','Back');back.type='button';
        back.addEventListener('click',()=>{const kind=this.chooser;this.chooser='';this.render();root.querySelector(`.calendar-${kind}`)?.focus({preventScroll:true});});actions.append(back);
        root.append(modesBar,nav,choices,hint,actions);this.queuePosition();return;
      }
      const week=make('div','calendar-weekdays');week.setAttribute('aria-hidden','true');for(const day of ['Su','Mo','Tu','We','Th','Fr','Sa'])week.append(make('span','',day));
      const grid=make('div','calendar-grid');grid.setAttribute('role','group');grid.setAttribute('aria-label',this.view.toLocaleDateString(undefined,{month:'long',year:'numeric'}));
      const first=validDate(this.view.getFullYear(),this.view.getMonth()+1,1),today=this.today(),availability=this.availability();
      for(let i=0;i<first.getDay();i++)grid.append(make('span','calendar-blank'));
      const last=new Date(first);last.setMonth(last.getMonth()+1,0);const count=last.getDate();
      for(let day=1;day<=count;day++) {
        const date=validDate(this.view.getFullYear(),this.view.getMonth()+1,day),value=iso(date),button=make('button','calendar-day',String(day));button.type='button';button.dataset.date=value;button.tabIndex=-1;button.disabled=!this.selectable(value,availability);
        if(availability.days.has(value)){button.classList.add('has-messages');button.title='Saved messages on this day';}
        const selected=value===this.draft.start || this.draft.mode==='Between' && value===this.draft.end;
        button.classList.toggle('selected',selected);button.classList.toggle('today',value===today);
        button.classList.toggle('range',this.draft.mode==='Between' && Boolean(this.draft.end) && value>this.draft.start && value<this.draft.end);
        button.setAttribute('aria-pressed',String(selected));button.setAttribute('aria-label',date.toLocaleDateString(undefined,{dateStyle:'full'}));
        button.addEventListener('click',()=>this.choose(value));grid.append(button);
      }
      (grid.querySelector('.selected:not(:disabled)')||grid.querySelector('.today:not(:disabled)')||grid.querySelector('[data-date]:not(:disabled)'))?.setAttribute('tabindex','0');
      while(grid.children.length%7)grid.append(make('span','calendar-blank'));
      const summary=make('div','calendar-summary',this.summary());summary.setAttribute('aria-live','polite');
      if(this.chatMode){const instruction=make('div','calendar-instruction',this.instruction());instruction.setAttribute('aria-live','polite');instruction.setAttribute('aria-atomic','true');root.append(modesBar,this.presets(),nav,instruction,week,grid,this.actions());}else root.append(modesBar,nav,week,grid,summary,this.actions());this.queuePosition();
    }
  }
  DatePicker.styles=`
    .date-popover{box-sizing:border-box;--calendar-cell:26px;--calendar-accent:#ff4500;--calendar-tint:color-mix(in srgb,var(--calendar-accent) 8%,var(--rcs-bg));--calendar-fade:color-mix(in srgb,var(--calendar-accent) 40%,transparent);position:absolute;top:calc(100% + 6px);right:8px;z-index:9;width:264px;max-width:calc(100% - 16px);max-height:min(370px,var(--rcs-calendar-height,70vh));overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;padding:9px;background:var(--rcs-bg);color:var(--rcs-text);border:1px solid var(--rcs-line);border-radius:11px;box-shadow:0 6px 20px #0002;font:12px/1.4 var(--font-sans,Arial,sans-serif)}
    .date-popover[hidden],.date-popover [hidden]{display:none!important}.date-popover button{font-family:inherit;cursor:pointer;touch-action:manipulation}.date-popover button:focus-visible{outline:0;box-shadow:inset 0 -2px var(--calendar-fade)}
    .date-modes{display:flex;gap:2px;margin-bottom:7px;border-bottom:1px solid var(--rcs-line)}.date-mode{position:relative;flex:1;min-width:0;min-height:28px;padding:4px 2px 5px;border:0;border-bottom:2px solid transparent;border-radius:0;background:transparent;color:var(--rcs-muted);font-size:11px}.date-mode:hover{background:transparent;border-bottom-color:color-mix(in srgb,var(--calendar-accent) 35%,transparent)}.date-popover .date-mode[aria-pressed=true]{background:transparent;color:var(--rcs-text);border-bottom-color:var(--calendar-accent);font-weight:600}
    .calendar-nav{display:flex;align-items:center;gap:4px;margin-bottom:6px}.calendar-nav-button{display:grid;place-items:center;width:24px;height:25px;flex:none;padding:0;border:0;border-radius:6px;background:transparent;color:var(--rcs-muted);font-size:20px}.calendar-nav-button:disabled{opacity:.35;cursor:default}
    .calendar-month,.calendar-year{display:flex;align-items:center;justify-content:center;gap:5px;min-width:0;height:26px;padding:0 7px;border:1px solid transparent;border-radius:7px;background:var(--rcs-soft);color:var(--rcs-text);font:inherit;font-size:11px;font-weight:600}.calendar-month{flex:1}.calendar-year{width:63px;flex:none}.calendar-month::after,.calendar-year::after{content:'';width:4px;height:4px;flex:none;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(45deg);margin-top:-3px;color:var(--rcs-muted)}.calendar-month[aria-expanded=true],.calendar-year[aria-expanded=true]{border-color:var(--calendar-fade);background:var(--calendar-tint)}
    .calendar-weekdays,.calendar-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:2px}.calendar-weekdays{margin-bottom:3px;text-align:center;font-size:10px;color:var(--rcs-muted)}.calendar-day,.calendar-blank{height:var(--calendar-cell)}.calendar-day{position:relative;min-width:0;padding:0;border:0;border-radius:4px;background:transparent;color:var(--rcs-text);font-size:11px;font-variant-numeric:tabular-nums}.calendar-day.range{background:var(--calendar-tint);border-radius:4px}.calendar-day.selected{background:var(--calendar-accent);color:#1a1a1b;font-weight:600}.calendar-day.today:not(.selected)::after{content:'';position:absolute;bottom:1px;left:calc(50% - 2px);width:4px;height:2px;border-radius:2px;background:var(--calendar-accent)}
    .calendar-day:hover:not(.selected):not(:disabled),.calendar-nav-button:hover,.calendar-month:hover,.calendar-year:hover,.calendar-option:hover,.calendar-clear:hover,.calendar-quick:hover{background:var(--rcs-hover)}.calendar-day:focus-visible:not(.selected){background:var(--calendar-tint)}
    .calendar-choices{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));grid-auto-rows:27px;gap:4px;align-content:start;max-height:166px;overflow:auto;overscroll-behavior:contain;padding:2px 0;scrollbar-width:thin}.year-choices{grid-template-columns:repeat(4,minmax(0,1fr))}.calendar-option{position:relative;min-width:0;padding:4px;border:0;border-radius:6px;background:transparent;color:var(--rcs-text);font-size:11px}.date-popover .calendar-option[aria-pressed=true]{color:var(--rcs-text);background:var(--calendar-tint);font-weight:600}.date-popover .calendar-option:focus-visible{outline:0;box-shadow:none;background:var(--rcs-soft)}.calendar-option[aria-pressed=true]::before,.calendar-option:focus-visible::before{content:'';position:absolute;left:0;top:5px;bottom:5px;width:3px;border-radius:0 3px 3px 0;background:var(--calendar-fade)}
    .calendar-option[aria-pressed=true]::before{background:var(--calendar-accent)}
    .calendar-presets.calendar-visible-presets{display:grid;grid-template-columns:auto auto auto auto;gap:3px;margin:0 0 6px}.calendar-visible-presets .calendar-preset{display:block;min-width:0;width:auto;min-height:23px;padding:3px 1px;border:1px solid var(--rcs-line);border-radius:5px;background:var(--rcs-soft);color:var(--rcs-text);font:inherit;font-size:9px;text-align:center;white-space:nowrap}.calendar-visible-presets .calendar-preset[aria-pressed=true]{border-color:var(--calendar-fade);background:var(--calendar-tint)}.calendar-visible-presets .calendar-preset:disabled,.calendar-day:disabled{color:var(--rcs-muted);opacity:.4;cursor:default}.calendar-instruction{min-height:14px;margin:0 0 4px;color:var(--rcs-muted);font-size:10px;text-align:center}.calendar-day.has-messages::before{content:'';position:absolute;bottom:2px;left:calc(50% - 1.5px);width:3px;height:3px;border-radius:50%;background:currentColor}.calendar-day.has-messages.today::after{display:none}
    .calendar-quick-heading{height:26px;justify-content:flex-start;gap:5px;color:var(--rcs-muted);font-size:11px;font-weight:600}.calendar-quick-heading svg{width:12px;height:12px;fill:none;stroke:currentColor}.calendar-presets{display:flex;flex-direction:column;gap:2px}.calendar-preset{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;min-height:29px;padding:5px 7px;text-align:left}.calendar-preset-dates{color:var(--rcs-muted);font-size:9px;white-space:nowrap;font-weight:400}
    .calendar-summary{display:flex;align-items:center;justify-content:center;min-height:24px;padding:5px 1px;color:var(--rcs-muted);font-size:10px;text-align:center;line-height:1.35}.calendar-actions{display:flex;align-items:center;justify-content:space-between;gap:4px;padding-top:6px;border-top:1px solid var(--rcs-line)}.calendar-clear,.calendar-apply,.calendar-quick{display:inline-flex;align-items:center;justify-content:center;gap:4px;min-height:26px;padding:4px 9px;border:0;border-radius:999px;font:inherit;font-size:10px;white-space:nowrap}.calendar-clear{background:var(--rcs-soft);color:var(--rcs-text)}.calendar-apply{background:var(--calendar-accent);color:#1a1a1b;font-weight:600}.calendar-apply:disabled{background:var(--rcs-soft);color:var(--rcs-muted);cursor:default}.calendar-apply:hover:not(:disabled){filter:brightness(.95)}.calendar-quick{padding-inline:5px;background:transparent;color:var(--rcs-muted)}.calendar-quick[aria-expanded=true]{color:var(--rcs-text)}.calendar-quick svg{width:12px;height:12px;flex:none;fill:none;stroke:currentColor;stroke-width:1.8}.calendar-quick[aria-expanded=true] svg{color:var(--calendar-accent)}
    :host([data-rcs-compact]) .date-popover{--calendar-cell:23px;right:6px;width:228px;max-width:calc(100% - 12px);padding:7px;top:calc(100% + 3px);border-radius:9px;font-size:11px}:host([data-rcs-compact]) .date-mode{min-height:25px;padding:3px 1px 4px;font-size:10px}:host([data-rcs-compact]) .date-modes{margin-bottom:5px}:host([data-rcs-compact]) .calendar-nav{gap:2px;margin-bottom:4px}:host([data-rcs-compact]) .calendar-nav-button{width:22px;height:24px;font-size:18px}:host([data-rcs-compact]) .calendar-month,:host([data-rcs-compact]) .calendar-year{height:24px;font-size:10px}:host([data-rcs-compact]) .calendar-year{width:57px}:host([data-rcs-compact]) .calendar-weekdays{font-size:9px}:host([data-rcs-compact]) .calendar-summary{min-height:22px;padding:4px 0;font-size:9px}:host([data-rcs-compact]) .calendar-clear,:host([data-rcs-compact]) .calendar-apply,:host([data-rcs-compact]) .calendar-quick{min-height:25px;padding:3px 7px;font-size:10px}:host([data-rcs-compact]) .calendar-quick{padding-inline:3px}:host([data-rcs-compact]) .calendar-preset-dates{font-size:9px}
  `;
  globalThis.RCSDatePicker=DatePicker;
})();
