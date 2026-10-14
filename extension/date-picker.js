/* A single local calendar. Selecting dates never sends a Reddit request. */
(() => {
  const make=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
  const iso=value=>`${String(value.getFullYear()).padStart(4,'0')}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;
  function validDate(year,month,day){if(!Number.isInteger(year)||year<1||year>9999||!Number.isInteger(month)||month<1||month>12||!Number.isInteger(day)||day<1||day>31)return null;const value=new Date(0);value.setHours(12,0,0,0);value.setFullYear(year,month-1,day);return value.getFullYear()===year&&value.getMonth()===month-1&&value.getDate()===day?value:null;}
  const parse=value=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(value || ''))return null;const [y,m,d]=value.split('-').map(Number);return validDate(y,m,d);};
  const shift=(value,days)=>{const result=parse(value);if(!result)return '';result.setDate(result.getDate()+days);return result.getFullYear()>=1&&result.getFullYear()<=9999?iso(result):'';};
  const frame=callback=>typeof requestAnimationFrame==='function'?requestAnimationFrame(callback):setTimeout(callback,0);
  const cancelFrame=id=>typeof cancelAnimationFrame==='function'?cancelAnimationFrame(id):clearTimeout(id);
  const modes=['On','Before','After','Between'];
  class DatePicker {
    constructor({onChange,onClose,getBounds}={}) {
      this.onChange=onChange;this.onClose=onClose;this.getBounds=getBounds;this.applied={mode:'Between',start:'',end:''};this.draft={...this.applied};
      this.view=new Date();this.view.setDate(1);this.chooser='';this.element=make('section','date-popover');this.element.hidden=true;
      this.element.setAttribute('role','dialog');this.element.setAttribute('aria-label','Filter messages by date');
      this.element.addEventListener('keydown',event=>{
        if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(this.chooser){const selector=`.calendar-${this.chooser}`;this.chooser='';this.render();this.element.querySelector(selector)?.focus({preventScroll:true});}else this.close();return;}
        const option=event.target.closest('.calendar-option');
        if(option) {
          const offsets={ArrowLeft:-1,ArrowRight:1,ArrowUp:this.chooser==='month'?-3:-4,ArrowDown:this.chooser==='month'?3:4};
          if(Object.hasOwn(offsets,event.key)){event.preventDefault();const options=[...this.element.querySelectorAll('.calendar-option')],position=options.indexOf(option);options[Math.max(0,Math.min(options.length-1,position+offsets[event.key]))]?.focus({preventScroll:true});}
          return;
        }
        const button=event.target.closest('button[data-date]');if(!button)return;
        if(['Home','End','PageUp','PageDown'].includes(event.key)){
          event.preventDefault();event.stopPropagation();let value=button.dataset.date;const day=parse(value);
          if(event.key==='Home'||event.key==='End')value=shift(value,event.key==='Home'?-day.getDay():6-day.getDay());
          else {const number=day.getDate();day.setDate(1);day.setMonth(day.getMonth()+(event.key==='PageDown'?1:-1));const last=new Date(day);last.setMonth(last.getMonth()+1,0);day.setDate(Math.min(number,last.getDate()));value=day.getFullYear()>=1&&day.getFullYear()<=9999?iso(day):'';}
          if(value){const day=parse(value);this.view=validDate(day.getFullYear(),day.getMonth()+1,1);this.render();this.focusDay(value);}return;
        }
        const offsets={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7};
        if(Object.hasOwn(offsets,event.key)) {
          event.preventDefault();event.stopPropagation();const value=shift(button.dataset.date,offsets[event.key]);if(!value)return;const day=parse(value);
          this.view=validDate(day.getFullYear(),day.getMonth()+1,1);this.render();this.focusDay(value);
        }
      });
    }
    get open(){return !this.element.hidden;}
    show() {
      this.chooser='';this.draft={...this.applied};if(parse(this.draft.start)){const day=parse(this.draft.start);this.view=validDate(day.getFullYear(),day.getMonth()+1,1);}
      this.element.hidden=false;this.render();this.element.scrollTop=0;this.startPosition();const day=this.element.querySelector('[data-date].selected')||this.element.querySelector('[data-date].today')||this.element.querySelector('[data-date]');if(day)this.focusDay(day.dataset.date);
    }
    close(restoreFocus=true){this.stopPosition();this.element.hidden=true;this.onClose?.(restoreFocus);}
    reset(){this.chooser='';this.applied={mode:'Between',start:'',end:''};this.draft={...this.applied};this.onChange?.({from:'',to:''},'');this.render();}
    focusDay(value){const next=this.element.querySelector(`[data-date="${value}"]`);if(!next)return;for(const day of this.element.querySelectorAll('[data-date]'))day.tabIndex=-1;next.tabIndex=0;next.focus({preventScroll:true});}
    apply(){const bounds=this.bounds();if(!bounds)return;this.applied={...this.draft};this.onChange?.(bounds,this.summary());this.close();}
    choose(value) {
      if(!parse(value))return;
      if(this.draft.mode!=='Between' || !this.draft.start || this.draft.end)this.draft={...this.draft,start:value,end:''};
      else {const [start,end]=[this.draft.start,value].sort();this.draft={...this.draft,start,end};}
      this.render();this.focusDay(value);
    }
    bounds() {
      const {mode,start,end}=this.draft;
      if(!parse(start)||mode==='Between'&&(!parse(end)||end<start))return null;
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
    place(){if(!this.open||!this.element.isConnected)return;const root=this.element;root.style.top='';root.style.left='';root.style.right='';root.style.maxWidth='';const bounds=this.clip(),initial=root.getBoundingClientRect(),style=getComputedStyle(root),sx=initial.width/(parseFloat(style.width)||root.offsetWidth)||1,sy=initial.height/(parseFloat(style.height)||root.offsetHeight)||1;root.style.maxWidth=Math.max(0,(bounds.right-bounds.left-12)/sx)+'px';const top=Math.max(initial.top,bounds.top+4),base=parseFloat(getComputedStyle(root).top)||root.offsetTop;root.style.top=base+(top-initial.top)/sy+'px';root.style.maxHeight=Math.max(0,(bounds.bottom-top-6)/sy)+'px';const rect=root.getBoundingClientRect(),left=Math.max(bounds.left+6,Math.min(rect.left,bounds.right-rect.width-6));if(left!==rect.left){root.style.left=root.offsetLeft+(left-rect.left)/sx+'px';root.style.right='auto';}}
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
      const first=validDate(this.view.getFullYear(),this.view.getMonth()+1,1),today=iso(new Date());
      for(let i=0;i<first.getDay();i++)grid.append(make('span','calendar-blank'));
      const last=new Date(first);last.setMonth(last.getMonth()+1,0);const count=last.getDate();
      for(let day=1;day<=count;day++) {
        const date=validDate(this.view.getFullYear(),this.view.getMonth()+1,day),value=iso(date),button=make('button','calendar-day',String(day));button.type='button';button.dataset.date=value;button.tabIndex=-1;
        const selected=value===this.draft.start || this.draft.mode==='Between' && value===this.draft.end;
        button.classList.toggle('selected',selected);button.classList.toggle('today',value===today);
        button.classList.toggle('range',this.draft.mode==='Between' && Boolean(this.draft.end) && value>this.draft.start && value<this.draft.end);
        button.setAttribute('aria-pressed',String(selected));button.setAttribute('aria-label',date.toLocaleDateString(undefined,{dateStyle:'full'}));
        button.addEventListener('click',()=>this.choose(value));grid.append(button);
      }
      (grid.querySelector('.selected')||grid.querySelector('.today')||grid.querySelector('[data-date]'))?.setAttribute('tabindex','0');
      while(grid.children.length<42)grid.append(make('span','calendar-blank'));
      const summary=make('div','calendar-summary',this.summary());summary.setAttribute('aria-live','polite');
      const actions=make('div','calendar-actions'),clear=make('button','calendar-clear','Clear'),apply=make('button','calendar-apply','Apply');clear.type=apply.type='button';apply.disabled=!this.bounds();
      clear.addEventListener('click',()=>this.reset());apply.addEventListener('click',()=>this.apply());
      actions.append(clear,apply);root.append(modesBar,nav,week,grid,summary,actions);this.queuePosition();
    }
  }
  DatePicker.styles=`
    .date-popover { box-sizing:border-box;--calendar-cell:29px;position:absolute;top:calc(100% + 6px);right:8px;z-index:9;width:272px;max-width:calc(100% - 16px);max-height:min(390px,var(--rcs-calendar-height,70vh));overflow:auto;padding:10px;background:var(--rcs-bg);border:1px solid var(--rcs-line);border-radius:12px;box-shadow:0 6px 20px #0002;font-size:12px; }
    .date-modes { display:flex;gap:2px;padding:3px;border-radius:9px;background:var(--rcs-soft);margin-bottom:9px; }
    .date-mode { flex:1;border:0;border-radius:7px;background:transparent;color:var(--rcs-muted);font-size:11px;padding:6px 2px; }
    .date-mode[aria-pressed=true] { background:var(--rcs-bg);color:var(--rcs-accent);font-weight:600;box-shadow:0 1px 3px #0001; }
    .calendar-nav { display:flex;align-items:center;gap:4px;margin-bottom:8px; }
    .calendar-nav-button { width:25px;height:26px;border:0;border-radius:7px;background:transparent;color:var(--rcs-muted);font-size:21px; }
    .calendar-month,.calendar-year { display:flex;align-items:center;justify-content:center;gap:5px;color:var(--rcs-text);background:var(--rcs-soft);font:inherit;font-weight:600;border:1px solid transparent;border-radius:999px;padding:0 8px;min-width:0;height:28px; }
    .calendar-month::after,.calendar-year::after { content:'';width:5px;height:5px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(45deg);margin-top:-3px; }
    .calendar-month { flex:1; }.calendar-year { width:72px; }
    .calendar-month:hover,.calendar-year:hover,.calendar-option:hover { background:var(--rcs-hover); }
    .calendar-month[aria-expanded=true],.calendar-year[aria-expanded=true] { border-color:var(--rcs-line);color:var(--rcs-accent); }
    .calendar-choices { display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;height:calc(6 * var(--calendar-cell) + 29px);overflow:auto;overscroll-behavior:contain;padding:4px 0; }
    .year-choices { grid-template-columns:repeat(4,minmax(0,1fr));grid-auto-rows:28px;align-content:start; }
    .calendar-option { border:0;border-radius:8px;background:var(--rcs-soft);color:var(--rcs-text);font-size:12px; }
    .calendar-option[aria-pressed=true] { color:var(--rcs-accent);background:color-mix(in srgb,var(--rcs-accent) 12%,var(--rcs-bg));font-weight:600; }
    .calendar-nav-button:disabled { opacity:.35;cursor:default; }
    .calendar-weekdays,.calendar-grid { display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:2px; }
    .calendar-weekdays { text-align:center;font-size:10px;color:var(--rcs-muted);margin-bottom:5px; }
    .calendar-day,.calendar-blank { height:var(--calendar-cell); }
    .calendar-day { border:0;border-radius:999px;color:var(--rcs-text);background:transparent;font-size:12px;padding:0; }
    .calendar-day:hover,.calendar-nav-button:hover { background:var(--rcs-hover); }
    .calendar-day.today { box-shadow:inset 0 0 0 1px var(--rcs-line); }
    .calendar-day.range { background:color-mix(in srgb,var(--rcs-accent) 14%,var(--rcs-bg));border-radius:4px; }
    .calendar-day.selected { background:var(--rcs-accent);color:#1a1a1b;font-weight:600; }
    .calendar-summary { min-height:27px;display:flex;align-items:center;justify-content:center;color:var(--rcs-muted);font-size:10px;text-align:center;padding:7px 0; }
    .calendar-actions { display:flex;justify-content:space-between;gap:8px;border-top:1px solid var(--rcs-line);padding-top:8px; }
    .calendar-clear,.calendar-apply { border:1px solid transparent;border-radius:999px;font-size:11px;min-height:28px;padding:5px 13px; }
    .calendar-clear { background:var(--rcs-soft);color:var(--rcs-text); }.calendar-apply { background:var(--rcs-accent);color:#1a1a1b;font-weight:600; }.calendar-apply:disabled { opacity:.4;cursor:default; }
    .calendar-clear:hover { background:var(--rcs-hover); }.calendar-apply:hover:not(:disabled) { filter:brightness(.95); }
    :host([data-rcs-compact]) .date-popover { box-sizing:border-box;--calendar-cell:24px;right:6px;width:228px;max-width:calc(100% - 12px);padding:8px;top:calc(100% + 3px);border-radius:9px;font-size:11px; }
    :host([data-rcs-compact]) .date-modes { padding:2px;margin-bottom:5px; }
    :host([data-rcs-compact]) .date-mode { padding:4px 2px;font-size:10px; }
    :host([data-rcs-compact]) .calendar-nav { margin-bottom:5px;gap:2px; }
    :host([data-rcs-compact]) .calendar-nav-button { width:22px;height:24px;font-size:19px; }
    :host([data-rcs-compact]) .calendar-month,:host([data-rcs-compact]) .calendar-year { height:24px; }
    :host([data-rcs-compact]) .calendar-year { width:62px; }
    :host([data-rcs-compact]) .calendar-weekdays { margin-bottom:3px; }
    :host([data-rcs-compact]) .calendar-day { font-size:11px; }
    :host([data-rcs-compact]) .calendar-option { font-size:11px; }
    :host([data-rcs-compact]) .year-choices { grid-auto-rows:24px;gap:4px; }
    :host([data-rcs-compact]) .calendar-choices { height:calc(6 * var(--calendar-cell) + 27px); }
    :host([data-rcs-compact]) .calendar-summary { min-height:22px;padding:4px 0;font-size:9px; }
    :host([data-rcs-compact]) .calendar-actions { padding-top:5px; }
    :host([data-rcs-compact]) .calendar-clear,:host([data-rcs-compact]) .calendar-apply { min-height:24px;padding:4px 11px;font-size:10px; }
  `;
  globalThis.RCSDatePicker=DatePicker;
})();
