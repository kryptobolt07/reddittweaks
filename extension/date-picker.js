/* A single local calendar. Selecting dates never sends a Reddit request. */
(() => {
  const make=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
  const iso=value=>`${String(value.getFullYear()).padStart(4,'0')}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;
  function validDate(year,month,day){if(!Number.isInteger(year)||year<1||year>9999||!Number.isInteger(month)||month<1||month>12||!Number.isInteger(day)||day<1||day>31)return null;const value=new Date(0);value.setHours(12,0,0,0);value.setFullYear(year,month-1,day);return value.getFullYear()===year&&value.getMonth()===month-1&&value.getDate()===day?value:null;}
  const parse=value=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(value || ''))return null;const [y,m,d]=value.split('-').map(Number);return validDate(y,m,d);};
  const shift=(value,days)=>{const result=parse(value);if(!result)return '';result.setDate(result.getDate()+days);return result.getFullYear()>=1&&result.getFullYear()<=9999?iso(result):'';};
  const frame=callback=>typeof requestAnimationFrame==='function'?requestAnimationFrame(callback):setTimeout(callback,0);
  const cancelFrame=id=>typeof cancelAnimationFrame==='function'?cancelAnimationFrame(id):clearTimeout(id);
  const glyph=name=>{const node=document.createElementNS('http://www.w3.org/2000/svg','svg');for(const [key,value]of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'2','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',focusable:'false'}))node.setAttribute(key,value);node.innerHTML={prev:'<path d="m15 6-6 6 6 6"/>',next:'<path d="m9 6 6 6-6 6"/>',caret:'<path d="m6 9 6 6 6-6"/>'}[name]||'';return node;};
  const modes=['On','Before','After','Between'];
  const weekdays=['Su','Mo','Tu','We','Th','Fr','Sa'];
  let pickerCount=0;
  class DatePicker {
    constructor({onChange,onClose,getBounds,getAnchor,chatMode=false,getAvailability}={}) {
      this.onChange=onChange;this.onClose=onClose;this.getBounds=getBounds;this.getAnchor=getAnchor;this.chatMode=chatMode;this.getAvailability=getAvailability;this.applied={mode:chatMode?'On':'Between',start:'',end:''};this.draft={...this.applied};
      this.uid=`rcs-calendar-${++pickerCount}`;this.notice='';this.status=null;
      this.view=new Date();this.view.setDate(1);this.chooser='';this.element=make('section','date-popover');this.element.hidden=true;
      this.element.setAttribute('role','dialog');this.element.setAttribute('aria-modal','false');this.element.setAttribute('aria-label','Filter messages by date');
      this.element.addEventListener('keydown',event=>{
        if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(this.chooser){const selector=`.calendar-${this.chooser}`;this.chooser='';this.render();this.element.querySelector(selector)?.focus({preventScroll:true});}else this.close();return;}
        const target=event.target instanceof Element?event.target:null;if(!target)return;
        const radio=target.closest('.date-mode');
        if(radio){
          const keys={ArrowLeft:-1,ArrowUp:-1,ArrowRight:1,ArrowDown:1};
          if(Object.hasOwn(keys,event.key)||event.key==='Home'||event.key==='End'){event.preventDefault();event.stopPropagation();const position=modes.indexOf(radio.dataset.mode),next=event.key==='Home'?0:event.key==='End'?modes.length-1:(position+keys[event.key]+modes.length)%modes.length;this.setMode(modes[next]);}
          return;
        }
        const option=target.closest('.calendar-option');
        if(option) {
          const offsets={ArrowLeft:-1,ArrowRight:1,ArrowUp:this.chooser==='month'?-3:-4,ArrowDown:this.chooser==='month'?3:4};
          if(Object.hasOwn(offsets,event.key)||['Home','End'].includes(event.key)){event.preventDefault();event.stopPropagation();const options=[...this.element.querySelectorAll('.calendar-option')],position=options.indexOf(option),next=event.key==='Home'?0:event.key==='End'?options.length-1:Math.max(0,Math.min(options.length-1,position+offsets[event.key]));this.focusOption(options[next]);}
          return;
        }
        const button=target.closest('button[data-date]');if(button)this.dayKey(event,button);
      });
    }
    today(){return iso(new Date());}
    // Cached message days are hints, never proof that earlier history is unavailable.
    // Only verified:true permits a minimum; future days are never selectable in either calendar.
    availability(){const supplied=this.getAvailability?.()||{},today=this.today(),min=supplied.verified===true&&parse(supplied.min)?supplied.min:'',suppliedMax=supplied.verified===true&&parse(supplied.max)?supplied.max:'';return {min,max:suppliedMax&&suppliedMax<today?suppliedMax:today,days:new Set(Array.from(supplied.days||[]).filter(value=>parse(value)))};}
    selectable(value,availability=this.availability()){return Boolean(parse(value)&&(!availability.min||value>=availability.min)&&(!availability.max||value<=availability.max));}
    short(value,year=false){return parse(value)?.toLocaleDateString(undefined,{month:'short',day:'numeric',...(year?{year:'numeric'}:{})}) || '';}
    unavailable(value){const {min,max}=this.availability();return max&&value>max?`Dates after ${this.short(max)} are not available`:min&&value<min?`Dates before ${this.short(min)} are not available`:'';}
    // One status line explains the next step, or why Apply is disabled.
    instruction(){
      const {mode,start,end}=this.draft,short=value=>this.short(value);
      if(mode==='Between')return !start?'Choose a start date':!end?`${short(start)} → select end`:`${short(start)} → ${short(end)}`;
      if(!start)return `Choose a date · ${mode.toLowerCase()}`;
      if(!this.bounds())return mode==='After'?`No dates after ${short(start)}`:mode==='Before'?`No dates before ${short(start)}`:this.unavailable(start)||`${mode} ${short(start)}`;
      return `${mode} ${short(start)}`;
    }
    announce(text){this.notice=text;if(this.status)this.status.textContent=text;}
    visibleRanges(){const today=this.today();return [{label:'Today',start:today,end:today},{label:'Yesterday',start:shift(today,-1),end:shift(today,-1)},{label:'Last 7 days',start:shift(today,-6),end:today},{label:'Last 30 days',start:shift(today,-29),end:today}];}
    // The room calendar offers the four everyday ranges; the global calendar adds calendar-period ranges, clamped to today.
    quickRanges(){
      const ranges=this.visibleRanges();if(this.chatMode)return ranges;
      const today=this.today(),now=parse(today),year=now.getFullYear(),month=now.getMonth()+1,lastDay=(year,month)=>{const value=validDate(year,month,1);value.setMonth(value.getMonth()+1,0);return iso(value);},limit=value=>value>today?today:value,previous=new Date(now);previous.setMonth(previous.getMonth(),0);
      return [...ranges,{label:'This month',start:iso(validDate(year,month,1)),end:limit(lastDay(year,month))},{label:'Last month',start:iso(validDate(previous.getFullYear(),previous.getMonth()+1,1)),end:iso(previous)},{label:'This year',start:iso(validDate(year,1,1)),end:limit(iso(validDate(year,12,31)))}];
    }
    presets(){
      const choices=make('div','calendar-presets calendar-visible-presets');choices.setAttribute('role','group');choices.setAttribute('aria-label','Quick date ranges');
      for(const range of this.quickRanges()){
        const single=range.start===range.end,button=make('button','calendar-preset',range.label);button.type='button';button.dataset.preset=range.label;button.disabled=!this.selectable(range.start)||!this.selectable(range.end);
        button.setAttribute('aria-pressed',String(this.draft.start===range.start&&(single?this.draft.mode==='On':this.draft.mode==='Between'&&this.draft.end===range.end)));
        button.addEventListener('click',()=>this.chooseRange(range));choices.append(button);
      }
      return choices;
    }
    chooseRange(range){if(!this.selectable(range.start)||!this.selectable(range.end)||range.end<range.start)return;const single=range.start===range.end;this.draft={mode:single?'On':'Between',start:range.start,end:single?'':range.end};const start=parse(range.start);this.view=validDate(start.getFullYear(),start.getMonth()+1,1);this.chooser='';this.render();this.element.querySelector(`[data-preset="${range.label}"]`)?.focus({preventScroll:true});}
    setMode(mode){this.chooser='';this.draft={...this.draft,mode,end:''};this.render();this.element.querySelector(`[data-mode="${mode}"]`)?.focus({preventScroll:true});}
    get open(){return !this.element.hidden;}
    show(mode='') {
      this.chooser='';this.draft=mode?{mode,start:'',end:''}:{...this.applied};const day=parse(this.draft.start)||parse(this.today())||new Date();this.view=validDate(day.getFullYear(),day.getMonth()+1,1);
      this.element.hidden=false;this.detectScheme();this.render();this.element.scrollTop=0;this.startPosition();const focus=this.element.querySelector('[data-date].selected')||this.element.querySelector('[data-date].today')||this.element.querySelector('[data-date]');if(focus)this.focusDay(focus.dataset.date);
    }
    // Reddit's theme is not always the OS scheme: sample the resolved surface colour to pick border and shadow strength.
    detectScheme(){const match=/^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/.exec(getComputedStyle(this.element).backgroundColor||'');if(match)this.element.dataset.scheme=(0.2126*match[1]+0.7152*match[2]+0.0722*match[3])/255<0.45?'dark':'light';}
    close(restoreFocus=true){this.stopPosition();this.element.hidden=true;this.onClose?.(restoreFocus);}
    reset(){this.chooser='';this.applied={mode:this.chatMode?'On':'Between',start:'',end:''};this.draft={...this.applied};this.onChange?.({from:'',to:''},'');this.render();}
    focusDay(value){const next=this.element.querySelector(`[data-date="${value}"]`);if(!next)return;for(const day of this.element.querySelectorAll('[data-date]'))day.tabIndex=-1;next.tabIndex=0;next.focus({preventScroll:true});}
    focusOption(option){if(!option)return;option.focus({preventScroll:true});const list=option.parentElement;if(list&&list.clientHeight)list.scrollTop=Math.max(0,option.offsetTop-(list.clientHeight-option.offsetHeight)/2);}
    apply(){const bounds=this.bounds();if(!bounds)return;this.applied={...this.draft};this.onChange?.(bounds,this.summary(),{...this.applied});this.close();}
    choose(value) {
      if(!this.selectable(value)){if(parse(value))this.announce(this.unavailable(value)||'That date is not available');return;}
      if(this.draft.mode!=='Between' || !this.draft.start || this.draft.end)this.draft={...this.draft,start:value,end:''};
      else {const [start,end]=[this.draft.start,value].sort();this.draft={...this.draft,start,end};}
      this.render();this.focusDay(value);
    }
    addMonths(value,count){const day=parse(value);if(!day)return '';const number=day.getDate();day.setDate(1);day.setMonth(day.getMonth()+count);const last=new Date(day);last.setMonth(last.getMonth()+1,0);day.setDate(Math.min(number,last.getDate()));return day.getFullYear()>=1&&day.getFullYear()<=9999?iso(day):'';}
    // WAI-ARIA date-picker grid keys. Movement clamps to the available range and says so instead of silently stopping.
    dayKey(event,button){
      const value=button.dataset.date,day=parse(value),key=event.key,steps={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7};let target='';
      if(!day)return;
      if(Object.hasOwn(steps,key))target=shift(value,steps[key]);
      else if(key==='Home'||key==='End')target=shift(value,key==='Home'?-day.getDay():6-day.getDay());
      else if(key==='PageUp'||key==='PageDown')target=this.addMonths(value,(key==='PageDown'?1:-1)*(event.shiftKey?12:1));
      else return;
      event.preventDefault();event.stopPropagation();if(!target)return;
      const {min,max}=this.availability();let note='';
      if(max&&target>max){target=max;note=`Latest available date is ${this.short(max,true)}`;}else if(min&&target<min){target=min;note=`Earliest available date is ${this.short(min,true)}`;}
      if(target!==value){const next=parse(target);if(next.getFullYear()!==this.view.getFullYear()||next.getMonth()!==this.view.getMonth()){this.view=validDate(next.getFullYear(),next.getMonth()+1,1);this.render();}this.focusDay(target);}
      if(note)this.announce(note);
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
    place(){if(!this.open||!this.element.isConnected)return;const root=this.element;root.style.top='';root.style.left='';root.style.right='';root.style.maxWidth='';const bounds=this.clip(),initial=root.getBoundingClientRect(),style=getComputedStyle(root),sx=initial.width/(parseFloat(style.width)||root.offsetWidth)||1,sy=initial.height/(parseFloat(style.height)||root.offsetHeight)||1;root.style.maxWidth=Math.max(0,(bounds.right-bounds.left-12)/sx)+'px';const anchor=this.getAnchor?.(),top=Math.max(Number.isFinite(anchor?.bottom)?anchor.bottom+4:initial.top,bounds.top+4),base=parseFloat(getComputedStyle(root).top)||root.offsetTop;root.style.top=base+(top-initial.top)/sy+'px';root.style.maxHeight=Math.max(0,(bounds.bottom-top-6)/sy)+'px';const rect=root.getBoundingClientRect(),anchorRight=Number.isFinite(anchor?.right)?anchor.right:Number.isFinite(anchor?.left)?anchor.left+rect.width:rect.right,left=Math.max(bounds.left+6,Math.min(anchorRight-rect.width,bounds.right-rect.width-6));if(left!==rect.left){root.style.left=root.offsetLeft+(left-rect.left)/sx+'px';root.style.right='auto';}}
    queuePosition(){if(!this.open||this.positionFrame)return;this.positionFrame=frame(()=>{this.positionFrame=0;this.place();});}
    startPosition(){this.stopPosition();this.positionListener=event=>{if(!(event?.target instanceof Node)||!this.element.contains(event.target))this.queuePosition();};window.addEventListener('resize',this.positionListener);window.addEventListener('scroll',this.positionListener,true);this.visual=window.visualViewport;this.visual?.addEventListener('resize',this.positionListener);this.visual?.addEventListener('scroll',this.positionListener);this.place();}
    stopPosition(){if(this.positionListener){window.removeEventListener('resize',this.positionListener);window.removeEventListener('scroll',this.positionListener,true);this.visual?.removeEventListener('resize',this.positionListener);this.visual?.removeEventListener('scroll',this.positionListener);}if(this.positionFrame)cancelFrame(this.positionFrame);this.positionFrame=0;this.positionListener=null;this.visual=null;}
    modeBar() {
      const bar=make('div','date-modes');bar.setAttribute('role','radiogroup');bar.setAttribute('aria-label','Date condition');
      for(const mode of modes) {
        const checked=mode===this.draft.mode,button=make('button','date-mode',mode);button.type='button';button.dataset.mode=mode;button.setAttribute('role','radio');button.setAttribute('aria-checked',String(checked));button.tabIndex=checked?0:-1;
        button.addEventListener('click',()=>this.setMode(mode));bar.append(button);
      }
      return bar;
    }
    heading() {
      const nav=make('div','calendar-nav'),availability=this.availability(),first=iso(validDate(this.view.getFullYear(),this.view.getMonth()+1,1)),next=new Date(this.view);next.setDate(1);next.setMonth(next.getMonth()+1);
      const edges={'-1':Boolean(availability.min)&&shift(first,-1)<availability.min,'1':Boolean(availability.max)&&next.getFullYear()<=9999&&iso(next)>availability.max};
      const step=(label,delta)=>{
        const button=make('button','calendar-nav-button');button.type='button';button.append(glyph(delta<0?'prev':'next'));button.setAttribute('aria-label',label);button.disabled=Boolean(this.chooser);
        if(edges[String(delta)]){button.setAttribute('aria-disabled','true');button.title=delta<0?'Earliest month':'Latest month';}
        button.addEventListener('click',()=>{if(button.getAttribute('aria-disabled')==='true')return;const target=new Date(this.view);target.setDate(1);target.setMonth(target.getMonth()+delta);if(target.getFullYear()<1||target.getFullYear()>9999)return;this.view=target;this.render();this.element.querySelector(`[aria-label="${label}"]`)?.focus({preventScroll:true});});
        return button;
      };
      const title=make('div','calendar-heading');
      for(const kind of ['month','year']) {
        const text=kind==='month'?this.view.toLocaleDateString(undefined,{month:'long'}):String(this.view.getFullYear()),button=make('button',`calendar-${kind}`,text);
        button.type='button';button.append(glyph('caret'));button.setAttribute('aria-label',`${text}, choose ${kind}`);button.setAttribute('aria-expanded',String(this.chooser===kind));button.setAttribute('aria-controls',`${this.uid}-choices`);
        button.addEventListener('click',()=>{this.chooser=this.chooser===kind?'':kind;this.render();if(this.chooser)this.focusOption(this.element.querySelector('.calendar-option[aria-pressed=true]')||this.element.querySelector('.calendar-option'));else this.element.querySelector(`.calendar-${kind}`)?.focus({preventScroll:true});});
        title.append(button);
      }
      nav.append(step('Previous month',-1),title,step('Next month',1));return nav;
    }
    choices() {
      const kind=this.chooser,choices=make('div',`calendar-choices ${kind}-choices`);choices.id=`${this.uid}-choices`;choices.setAttribute('role','group');choices.setAttribute('aria-label',`Choose ${kind}`);
      const latest=Math.max(parse(this.today())?.getFullYear()||new Date().getFullYear(),this.view.getFullYear()),earliest=Math.min(2005,this.view.getFullYear());
      const values=kind==='month'?Array.from({length:12},(_,i)=>i):Array.from({length:latest-earliest+1},(_,i)=>latest-i);
      for(const value of values) {
        const long=kind==='month'?new Date(2020,value,1).toLocaleDateString(undefined,{month:'long'}):String(value),option=make('button','calendar-option',kind==='month'?new Date(2020,value,1).toLocaleDateString(undefined,{month:'short'}):String(value));option.type='button';option.dataset[kind]=String(value);
        option.setAttribute('aria-label',long);option.setAttribute('aria-pressed',String(value===(kind==='month'?this.view.getMonth():this.view.getFullYear())));
        option.addEventListener('click',()=>{this.view=validDate(kind==='year'?value:this.view.getFullYear(),(kind==='month'?value:this.view.getMonth())+1,1);this.chooser='';this.render();this.element.querySelector(`.calendar-${kind}`)?.focus({preventScroll:true});});choices.append(option);
      }
      return choices;
    }
    calendar() {
      const grid=make('div','calendar-grid'),view=this.view,first=validDate(view.getFullYear(),view.getMonth()+1,1),today=this.today(),availability=this.availability(),draft=this.draft;
      grid.setAttribute('role','grid');grid.setAttribute('aria-label',view.toLocaleDateString(undefined,{month:'long',year:'numeric'}));
      const head=make('div','calendar-weekdays');head.setAttribute('role','row');
      weekdays.forEach((label,index)=>{const cell=make('span','');cell.setAttribute('role','columnheader');cell.setAttribute('aria-label',new Date(2023,0,1+index).toLocaleDateString(undefined,{weekday:'long'}));cell.append(make('span','wd-long',label),make('span','wd-short',label[0]));head.append(cell);});grid.append(head);
      const last=new Date(first);last.setMonth(last.getMonth()+1,0);const count=last.getDate(),ranged=draft.mode==='Between'&&Boolean(draft.end)&&draft.end>draft.start;let week=null;
      for(let day=1;day<=count;day++) {
        const date=validDate(view.getFullYear(),view.getMonth()+1,day),value=iso(date),column=(first.getDay()+day-1)%7;
        if(!week||column===0){week=make('div','calendar-week');week.setAttribute('role','row');grid.append(week);}
        const button=make('button','calendar-day',String(day));button.type='button';button.dataset.date=value;button.tabIndex=-1;button.setAttribute('role','gridcell');if(day===1&&column)button.style.gridColumnStart=String(column+1);
        const available=this.selectable(value,availability),saved=availability.days.has(value),isStart=value===draft.start,isEnd=draft.mode==='Between'&&value===draft.end,selected=isStart||isEnd,inside=ranged&&value>draft.start&&value<draft.end,edgeStart=column===0||day===1,edgeEnd=column===6||day===count;
        if(saved){button.classList.add('has-messages');button.title='Saved messages on this day';}
        button.classList.toggle('today',value===today);button.classList.toggle('selected',selected);button.classList.toggle('range',inside);button.classList.toggle('range-start',ranged&&isStart);button.classList.toggle('range-end',ranged&&isEnd);
        button.classList.toggle('band-start',(inside||ranged&&isEnd)&&edgeStart);button.classList.toggle('band-end',(inside||ranged&&isStart)&&edgeEnd);
        button.setAttribute('aria-selected',String(selected||inside));if(value===today)button.setAttribute('aria-current','date');if(!available)button.setAttribute('aria-disabled','true');
        const notes=[date.toLocaleDateString(undefined,{dateStyle:'full'})];if(value===today)notes.push('today');if(saved)notes.push('has saved messages');
        if(draft.mode==='Between'){if(isStart)notes.push('start of range');else if(isEnd)notes.push('end of range');else if(inside)notes.push('in range');}else if(isStart)notes.push('selected');
        if(!available)notes.push('unavailable');button.setAttribute('aria-label',notes.join(', '));
        button.addEventListener('click',()=>this.choose(value));week.append(button);
      }
      (grid.querySelector('.selected:not([aria-disabled=true])')||grid.querySelector('.today:not([aria-disabled=true])')||grid.querySelector('[data-date]:not([aria-disabled=true])')||grid.querySelector('[data-date]'))?.setAttribute('tabindex','0');
      return grid;
    }
    footer() {
      const footer=make('div','calendar-footer'),status=make('div',this.chatMode?'calendar-summary calendar-instruction':'calendar-summary',this.instruction());status.setAttribute('aria-live','polite');status.setAttribute('aria-atomic','true');this.status=status;
      const actions=make('div','calendar-actions'),clear=make('button','calendar-clear',this.applied.start?'Clear filter':'Clear'),apply=make('button','calendar-apply','Apply');clear.type=apply.type='button';
      clear.addEventListener('click',()=>this.reset());apply.disabled=!this.bounds();apply.addEventListener('click',()=>this.apply());actions.append(clear,apply);footer.append(status,actions);return footer;
    }
    render() {
      const root=this.element;this.notice='';root.replaceChildren();
      const body=make('div','calendar-body');body.append(this.chooser?this.choices():this.calendar());
      root.append(this.modeBar(),this.presets(),this.heading(),body,this.footer());this.queuePosition();
    }
  }
  DatePicker.styles=`
    .date-popover{box-sizing:border-box;--calendar-cell:32px;--calendar-head:24px;--calendar-body:calc(var(--calendar-head) + var(--calendar-cell) * 6);--calendar-control:32px;--calendar-accent:var(--color-brand-background,#d93900);--calendar-band:color-mix(in srgb,var(--calendar-accent) 16%,var(--rcs-bg));--calendar-ring:color-mix(in srgb,var(--rcs-text) 18%,var(--rcs-bg));--calendar-focus:var(--rcs-focus,#167cb0);container-type:inline-size;position:absolute;top:calc(100% + 6px);right:8px;z-index:9;display:flex;flex-direction:column;gap:6px;width:288px;max-width:calc(100% - 16px);max-height:min(620px,var(--rcs-calendar-height,80vh));overflow:hidden;padding:12px;background:var(--rcs-bg);color:var(--rcs-text);border:1px solid var(--calendar-ring);border-radius:16px;box-shadow:0 8px 28px rgba(0,0,0,.18),0 1px 3px rgba(0,0,0,.12);font:12px/1.4 var(--font-sans,Arial,sans-serif)}
    .date-popover[data-scheme=dark]{--calendar-band:color-mix(in srgb,var(--calendar-accent) 26%,var(--rcs-bg));--calendar-ring:color-mix(in srgb,var(--rcs-text) 26%,var(--rcs-bg));box-shadow:0 6px 24px rgba(0,0,0,.6),0 1px 3px rgba(0,0,0,.5)}
    @media (prefers-color-scheme:dark){.date-popover:not([data-scheme=light]){--calendar-band:color-mix(in srgb,var(--calendar-accent) 26%,var(--rcs-bg));--calendar-ring:color-mix(in srgb,var(--rcs-text) 26%,var(--rcs-bg));box-shadow:0 6px 24px rgba(0,0,0,.6),0 1px 3px rgba(0,0,0,.5)}}
    .date-popover[hidden],.date-popover [hidden]{display:none!important}.date-popover *{box-sizing:border-box}.date-popover button{margin:0;font-family:inherit;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent}.date-popover button:focus-visible{outline:2px solid var(--calendar-focus);outline-offset:-2px}
    .date-modes{display:flex;flex:none;gap:2px;padding:2px;border-radius:10px;background:var(--rcs-soft)}.date-mode{flex:1 1 0;min-width:0;min-height:var(--calendar-control);padding:0 4px;border:0;border-radius:8px;background:transparent;color:var(--rcs-muted);font-size:13px;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.date-mode:hover{color:var(--rcs-text)}.date-popover .date-mode[aria-checked=true]{background:var(--rcs-bg);color:var(--rcs-text);font-weight:600;box-shadow:0 0 0 1px var(--calendar-ring),0 1px 2px rgba(0,0,0,.14)}
    .calendar-presets{display:flex;flex:none;flex-wrap:wrap;gap:4px 6px}.calendar-preset{display:inline-flex;align-items:center;max-width:100%;min-height:26px;padding:0 10px;border:1px solid var(--calendar-ring);border-radius:999px;background:transparent;color:var(--rcs-text);font-size:12px;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.calendar-preset:hover:not(:disabled){background:var(--rcs-hover)}.date-popover .calendar-preset[aria-pressed=true]{border-color:var(--rcs-text);background:var(--rcs-hover);box-shadow:inset 0 0 0 1px var(--rcs-text)}.calendar-preset:disabled{color:var(--rcs-muted);opacity:.45;cursor:default}
    .calendar-nav{display:flex;flex:none;align-items:center;justify-content:space-between;gap:4px}.calendar-heading{display:flex;flex:1;align-items:center;justify-content:center;gap:2px;min-width:0}.calendar-nav-button{display:grid;place-items:center;flex:none;width:var(--calendar-control);height:var(--calendar-control);padding:0;border:0;border-radius:50%;background:transparent;color:var(--rcs-text)}.calendar-nav-button svg{width:18px;height:18px}.calendar-nav-button:disabled{visibility:hidden}.calendar-nav-button[aria-disabled=true]{opacity:.38;cursor:default}
    .calendar-month,.calendar-year{display:inline-flex;align-items:center;gap:2px;min-width:0;height:var(--calendar-control);padding:0 8px;border:0;border-radius:8px;background:transparent;color:var(--rcs-text);font-size:14px;font-weight:600;line-height:1.2;white-space:nowrap}.calendar-month svg,.calendar-year svg{width:14px;height:14px;flex:none;color:var(--rcs-muted)}.calendar-month[aria-expanded=true],.calendar-year[aria-expanded=true]{background:var(--rcs-hover)}
    .calendar-body{flex:1 1 auto;min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin}.calendar-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));grid-template-rows:var(--calendar-head);grid-auto-rows:var(--calendar-cell);align-content:start;min-height:var(--calendar-body);gap:0}.calendar-weekdays,.calendar-week{display:contents}.calendar-weekdays>span{display:grid;place-items:center;color:var(--rcs-muted);font-size:12px}.calendar-weekdays .wd-short{display:none}
    .calendar-day{position:relative;isolation:isolate;display:grid;place-items:center;width:100%;height:var(--calendar-cell);min-width:0;padding:0;border:0;border-radius:0;background:transparent;color:var(--rcs-text);font-size:13px;line-height:1;font-variant-numeric:tabular-nums}
    .calendar-day::before{content:'';position:absolute;z-index:-1;top:50%;left:50%;width:min(var(--calendar-cell),100%);height:min(var(--calendar-cell),100%);transform:translate(-50%,-50%);border-radius:50%}
    .calendar-day.range{background:var(--calendar-band)}.calendar-day.range-start{background:linear-gradient(90deg,transparent 50%,var(--calendar-band) 50%)}.calendar-day.range-end{background:linear-gradient(270deg,transparent 50%,var(--calendar-band) 50%)}.calendar-day.band-start{border-top-left-radius:999px;border-bottom-left-radius:999px}.calendar-day.band-end{border-top-right-radius:999px;border-bottom-right-radius:999px}
    .calendar-day:hover:not([aria-disabled=true])::before{background:var(--rcs-hover)}.calendar-day.today::before{box-shadow:inset 0 0 0 1px var(--rcs-muted)}.calendar-day.selected{color:#fff;font-weight:600}.date-popover .calendar-day.selected::before{background:var(--calendar-accent);box-shadow:none}
    .calendar-day.has-messages::after{content:'';position:absolute;bottom:3px;left:50%;width:4px;height:4px;margin-left:-2px;border-radius:50%;background:currentColor;opacity:.55}.calendar-day.selected.has-messages::after{opacity:.85}
    .date-popover .calendar-day:focus-visible{outline:0}.date-popover .calendar-day:focus-visible::before{outline:2px solid var(--calendar-focus);outline-offset:-2px}.date-popover .calendar-day.selected:focus-visible::before{box-shadow:inset 0 0 0 4px var(--calendar-accent),inset 0 0 0 5px #fff}
    .calendar-day[aria-disabled=true]{color:var(--rcs-muted);opacity:.5;cursor:default}
    .calendar-choices{position:relative;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));grid-auto-rows:40px;gap:4px;align-content:start;height:var(--calendar-body);overflow:auto;overscroll-behavior:contain;scrollbar-width:thin}.year-choices{grid-template-columns:repeat(4,minmax(0,1fr))}.calendar-option{min-width:0;padding:0 4px;border:0;border-radius:8px;background:transparent;color:var(--rcs-text);font-size:13px}.calendar-option:hover{background:var(--rcs-hover)}.date-popover .calendar-option[aria-pressed=true]{background:var(--rcs-text);color:var(--rcs-bg);font-weight:600}
    .calendar-footer{display:flex;flex:none;align-items:center;gap:8px;min-height:calc(var(--calendar-control) + 7px);padding-top:6px;border-top:1px solid var(--rcs-line)}.calendar-summary{flex:1 1 auto;min-width:0;margin:0;color:var(--rcs-muted);font-size:12px;line-height:16px;overflow-wrap:anywhere}.calendar-actions{display:flex;flex:none;gap:6px}
    .calendar-clear,.calendar-apply{display:inline-flex;align-items:center;justify-content:center;min-height:var(--calendar-control);padding:0 14px;border:0;border-radius:999px;font-size:13px;font-weight:600;line-height:1.2;white-space:nowrap}.calendar-clear{background:transparent;color:var(--rcs-text)}.calendar-clear:hover{background:var(--rcs-hover)}.calendar-apply{background:var(--calendar-accent);color:#fff}.calendar-apply:hover:not(:disabled){filter:brightness(1.08)}.calendar-apply:disabled{background:var(--rcs-soft);color:var(--rcs-muted);cursor:default}
    .calendar-nav-button:hover:not(:disabled):not([aria-disabled=true]),.calendar-month:hover,.calendar-year:hover{background:var(--rcs-hover)}
    :host([data-rcs-compact]) .date-popover{--calendar-cell:28px;--calendar-control:28px;right:6px;width:264px;max-width:calc(100% - 12px);gap:6px;padding:10px;top:calc(100% + 3px)}:host([data-rcs-compact]) .calendar-day{font-size:12px}:host([data-rcs-compact]) .calendar-month,:host([data-rcs-compact]) .calendar-year{font-size:13px}:host([data-rcs-compact]) .calendar-choices{grid-auto-rows:34px}:host([data-rcs-compact]) .calendar-preset{min-height:24px}
    @media (pointer:coarse){.date-popover,:host([data-rcs-compact]) .date-popover{--calendar-cell:36px;--calendar-control:40px}.calendar-preset,:host([data-rcs-compact]) .calendar-preset{min-height:36px}}
    @container (max-width:259px){.date-mode{padding:0 2px;font-size:12px}}
    @container (max-width:231px){.date-modes{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.calendar-weekdays .wd-long{display:none}.calendar-weekdays .wd-short{display:inline}.calendar-footer{flex-direction:column;align-items:stretch;gap:6px}.calendar-actions{justify-content:stretch}.calendar-actions button{flex:1}.calendar-heading{gap:0}.calendar-month,.calendar-year{padding:0 4px;font-size:13px}.calendar-month svg,.calendar-year svg{display:none}}
    @media (prefers-reduced-motion:no-preference){.date-popover button,.calendar-day::before{transition:background-color .12s ease,color .12s ease,box-shadow .12s ease,border-color .12s ease}}
  `;
  globalThis.RCSDatePicker=DatePicker;
})();
