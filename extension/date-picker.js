/* A single local calendar. Selecting dates never sends a Reddit request. */
(() => {
  const make=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
  const iso=value=>`${String(value.getFullYear()).padStart(4,'0')}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;
  function validDate(year,month,day){if(!Number.isInteger(year)||year<1||year>9999||!Number.isInteger(month)||month<1||month>12||!Number.isInteger(day)||day<1||day>31)return null;const value=new Date(0);value.setHours(12,0,0,0);value.setFullYear(year,month-1,day);return value.getFullYear()===year&&value.getMonth()===month-1&&value.getDate()===day?value:null;}
  const parse=value=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(value || ''))return null;const [y,m,d]=value.split('-').map(Number);return validDate(y,m,d);};
  const shift=(value,days)=>{const result=parse(value);if(!result)return '';result.setDate(result.getDate()+days);return result.getFullYear()>=1&&result.getFullYear()<=9999?iso(result):'';};
  const frame=callback=>typeof requestAnimationFrame==='function'?requestAnimationFrame(callback):setTimeout(callback,0);
  const cancelFrame=id=>typeof cancelAnimationFrame==='function'?cancelAnimationFrame(id):clearTimeout(id);
  const glyph=name=>{const node=document.createElementNS('http://www.w3.org/2000/svg','svg');for(const [key,value]of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'2','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',focusable:'false'}))node.setAttribute(key,value);const paths={prev:'m15 6-6 6 6 6',next:'m9 6 6 6-6 6',caret:'m6 9 6 6 6-6',close:'M6 6l12 12M18 6 6 18'},d=paths[name];if(d){const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',d);node.append(path);}return node;};
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
        const preset=target.closest('.calendar-preset');
        if(preset && ['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){
          event.preventDefault();event.stopPropagation();const chips=[...this.element.querySelectorAll('.calendar-preset:not(:disabled)')],at=chips.indexOf(preset);if(!chips.length)return;
          const next=chips[event.key==='Home'?0:event.key==='End'?chips.length-1:(at+(event.key==='ArrowLeft'?-1:1)+chips.length)%chips.length];
          next.focus({preventScroll:true});this.revealPreset(next.parentElement,next);return;
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
      if(!start)return mode==='On'?'Pick a day':mode==='Before'?'Pick the day to search before':'Pick the day to search after';
      if(!this.bounds())return mode==='After'?`No dates after ${short(start)}`:mode==='Before'?`No dates before ${short(start)}`:this.unavailable(start)||`${mode} ${short(start)}`;
      return `${mode} ${short(start)}`;
    }
    announce(text){this.notice=text;if(this.status)this.status.textContent=text;}
    visibleRanges(){const today=this.today();return [{label:'Today',start:today,end:today},{label:'Yesterday',start:shift(today,-1),end:shift(today,-1)},{label:'Last 7 days',short:'7 days',start:shift(today,-6),end:today},{label:'Last 30 days',short:'30 days',start:shift(today,-29),end:today}];}
    // The room calendar offers the four everyday ranges; the global calendar adds calendar-period ranges, clamped to today.
    quickRanges(){
      const ranges=this.visibleRanges();if(this.chatMode)return ranges;
      const today=this.today(),now=parse(today),year=now.getFullYear(),month=now.getMonth()+1,lastDay=(year,month)=>{const value=validDate(year,month,1);value.setMonth(value.getMonth()+1,0);return iso(value);},limit=value=>value>today?today:value,previous=new Date(now);previous.setMonth(previous.getMonth(),0);
      return [...ranges,{label:'This month',start:iso(validDate(year,month,1)),end:limit(lastDay(year,month))},{label:'Last month',start:iso(validDate(previous.getFullYear(),previous.getMonth()+1,1)),end:iso(previous)},{label:'This year',start:iso(validDate(year,1,1)),end:limit(iso(validDate(year,12,31)))}];
    }
    presets(){
      const choices=make('div','calendar-presets calendar-visible-presets');choices.setAttribute('role','group');choices.setAttribute('aria-label','Quick date ranges');
      for(const range of this.quickRanges()){
        const single=range.start===range.end,button=make('button','calendar-preset',range.short || range.label);button.type='button';if(range.short)button.setAttribute('aria-label',range.label);button.dataset.preset=range.label;button.disabled=!this.selectable(range.start)||!this.selectable(range.end);
        button.setAttribute('aria-pressed',String(this.draft.start===range.start&&(single?this.draft.mode==='On':this.draft.mode==='Between'&&this.draft.end===range.end)));
        button.addEventListener('click',()=>this.chooseRange(range));choices.append(button);
      }
      // One sideways strip with no scrollbar: a vertical wheel scrolls it while there is more to see, and the edges fade.
      choices.addEventListener('wheel',event=>{
        if(Math.abs(event.deltaY)<=Math.abs(event.deltaX) || choices.scrollWidth<=choices.clientWidth+1)return;
        const before=choices.scrollLeft;choices.scrollLeft=Math.max(0,Math.min(choices.scrollWidth-choices.clientWidth,before+event.deltaY));
        if(choices.scrollLeft!==before){event.preventDefault();this.syncPresetFade(choices);}
      },{passive:false});
      choices.addEventListener('scroll',()=>this.syncPresetFade(choices),{passive:true});
      return choices;
    }
    previewTo(grid,value){
      const {mode,start,end}=this.draft,active=mode==='Between' && start && !end && value && value!==start && this.selectable(value);
      const [low,high]=active?[start,value].sort():['',''];
      for(const day of grid.querySelectorAll('.calendar-day[data-date]')){const date=day.dataset.date;day.classList.toggle('preview',Boolean(active) && date!==start && date>=low && date<=high);}
    }
    // Keep a chip fully inside the strip (with the strip's 6 px inset), scrolling only as far as needed.
    revealPreset(strip,chip){
      const left=chip.offsetLeft,right=left+chip.offsetWidth,view=strip.clientWidth;
      if(right>strip.scrollLeft+view-6)strip.scrollLeft=right-view+6;else if(left<strip.scrollLeft+6)strip.scrollLeft=Math.max(0,left-6);
      this.syncPresetFade(strip);
    }
    syncPresetFade(strip){
      const room=strip.scrollWidth-strip.clientWidth,left=strip.scrollLeft;
      strip.dataset.fade=room<=1?'none':left<=1?'end':left>=room-1?'start':'both';
    }
    chooseRange(range){if(!this.selectable(range.start)||!this.selectable(range.end)||range.end<range.start)return;this.sheetJump=true;const single=range.start===range.end;this.draft={mode:single?'On':'Between',start:range.start,end:single?'':range.end};const start=parse(range.start);this.view=validDate(start.getFullYear(),start.getMonth()+1,1);this.chooser='';this.render();this.element.querySelector(`[data-preset="${range.label}"]`)?.focus({preventScroll:true});}
    setMode(mode){this.chooser='';this.draft={...this.draft,mode,end:''};this.render();this.element.querySelector(`[data-mode="${mode}"]`)?.focus({preventScroll:true});}
    get open(){return !this.element.hidden;}
    // Phones (Reddit's layout below 768 px): a pull-up sheet with months to scroll through and touch-sized days.
    sheetLayout(){return Boolean(globalThis.matchMedia?.('(max-width: 767.98px)')?.matches);}
    show(mode='') {
      this.sheet=this.sheetLayout();this.element.classList.toggle('date-sheet',this.sheet);this.sheetFirst=null;this.sheetLast=null;this.sheetJump=true;
      if(this.sheet && !this.scrim?.isConnected){this.scrim=make('div','date-sheet-scrim');this.scrim.setAttribute('aria-hidden','true');this.scrim.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();this.close();});this.element.before(this.scrim);}
      this.element.setAttribute('aria-modal',String(this.sheet));
      this.chooser='';this.draft=mode?{mode,start:'',end:''}:{...this.applied};const day=parse(this.draft.start)||parse(this.today())||new Date();this.view=validDate(day.getFullYear(),day.getMonth()+1,1);
      this.element.hidden=false;this.detectScheme();this.render();{const strip=this.element.querySelector('.calendar-presets'),pressed=strip?.querySelector('[aria-pressed=true]');if(pressed)this.revealPreset(strip,pressed);}this.element.scrollTop=0;this.startPosition();const focus=this.element.querySelector('[data-date].selected')||this.element.querySelector('[data-date].today')||this.element.querySelector('[data-date]');if(focus)this.focusDay(focus.dataset.date);
    }
    // Reddit's theme is not always the OS scheme: sample the resolved surface colour to pick border and shadow strength.
    detectScheme(){const match=/^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/.exec(getComputedStyle(this.element).backgroundColor||'');if(match)this.element.dataset.scheme=(0.2126*match[1]+0.7152*match[2]+0.0722*match[3])/255<0.45?'dark':'light';}
    close(restoreFocus=true){this.stopPosition();this.element.hidden=true;this.scrim?.remove();this.scrim=null;this.onClose?.(restoreFocus);}
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
    place(){if(!this.open||!this.element.isConnected)return;if(this.sheet){for(const key of ['top','left','right','maxWidth'])this.element.style[key]='';return;}const root=this.element;root.style.top='';root.style.left='';root.style.right='';root.style.maxWidth='';const bounds=this.clip(),initial=root.getBoundingClientRect(),style=getComputedStyle(root),sx=initial.width/(parseFloat(style.width)||root.offsetWidth)||1,sy=initial.height/(parseFloat(style.height)||root.offsetHeight)||1;root.style.maxWidth=Math.max(0,(bounds.right-bounds.left-12)/sx)+'px';const anchor=this.getAnchor?.(),top=Math.max(Number.isFinite(anchor?.bottom)?anchor.bottom+4:initial.top,bounds.top+4),base=parseFloat(getComputedStyle(root).top)||root.offsetTop;root.style.top=base+(top-initial.top)/sy+'px';root.style.maxHeight=Math.max(0,(bounds.bottom-top-6)/sy)+'px';const rect=root.getBoundingClientRect(),anchorRight=Number.isFinite(anchor?.right)?anchor.right:Number.isFinite(anchor?.left)?anchor.left+rect.width:rect.right,left=Math.max(bounds.left+6,Math.min(anchorRight-rect.width,bounds.right-rect.width-6));if(left!==rect.left){root.style.left=root.offsetLeft+(left-rect.left)/sx+'px';root.style.right='auto';}}
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
        option.addEventListener('click',()=>{this.view=validDate(kind==='year'?value:this.view.getFullYear(),(kind==='month'?value:this.view.getMonth())+1,1);this.sheetJump=true;if(this.sheet && kind==='year'){this.chooser='month';this.render();this.focusOption(this.element.querySelector('.calendar-option[aria-pressed=true]'));return;}this.chooser='';this.render();this.element.querySelector(`.calendar-${kind}`)?.focus({preventScroll:true});});choices.append(option);
      }
      return choices;
    }
    calendar(view=this.view,{weekdays:showWeekdays=true}={}) {
      const grid=make('div','calendar-grid'),first=validDate(view.getFullYear(),view.getMonth()+1,1),today=this.today(),availability=this.availability(),draft=this.draft;
      // While choosing a range's end, the days up to the hovered one preview as the same faded boxes.
      grid.addEventListener('pointerover',event=>{const day=event.target instanceof Element?event.target.closest('.calendar-day[data-date]'):null;if(day)this.previewTo(grid,day.dataset.date);});
      grid.addEventListener('pointerleave',()=>this.previewTo(grid,''));
      grid.setAttribute('role','grid');grid.setAttribute('aria-label',view.toLocaleDateString(undefined,{month:'long',year:'numeric'}));
      if(showWeekdays)grid.append(this.weekdayRow());
      const last=new Date(first);last.setMonth(last.getMonth()+1,0);const count=last.getDate(),ranged=draft.mode==='Between'&&Boolean(draft.end)&&draft.end>draft.start;let week=null;
      for(let day=1;day<=count;day++) {
        const date=validDate(view.getFullYear(),view.getMonth()+1,day),value=iso(date),column=(first.getDay()+day-1)%7;
        if(!week||column===0){week=make('div','calendar-week');week.setAttribute('role','row');grid.append(week);}
        const button=make('button','calendar-day',String(day));button.type='button';button.dataset.date=value;button.tabIndex=-1;button.setAttribute('role','gridcell');if(day===1&&column)button.style.gridColumnStart=String(column+1);
        const available=this.selectable(value,availability),saved=availability.days.has(value),isStart=value===draft.start,isEnd=draft.mode==='Between'&&value===draft.end,selected=isStart||isEnd,inside=ranged&&value>draft.start&&value<draft.end;
        if(saved){button.classList.add('has-messages');button.title='Saved messages on this day';}
        button.classList.toggle('today',value===today);button.classList.toggle('selected',selected);button.classList.toggle('range',inside);button.classList.toggle('range-start',ranged&&isStart);button.classList.toggle('range-end',ranged&&isEnd);
        button.setAttribute('aria-selected',String(selected||inside));if(value===today)button.setAttribute('aria-current','date');if(!available)button.setAttribute('aria-disabled','true');
        const notes=[date.toLocaleDateString(undefined,{dateStyle:'full'})];if(value===today)notes.push('today');if(saved)notes.push('has saved messages');
        if(draft.mode==='Between'){if(isStart)notes.push('start of range');else if(isEnd)notes.push('end of range');else if(inside)notes.push('in range');}else if(isStart)notes.push('selected');
        if(!available)notes.push('unavailable');button.setAttribute('aria-label',notes.join(', '));
        button.addEventListener('click',()=>this.choose(value));week.append(button);
      }
      (grid.querySelector('.selected:not([aria-disabled=true])')||grid.querySelector('.today:not([aria-disabled=true])')||grid.querySelector('[data-date]:not([aria-disabled=true])')||grid.querySelector('[data-date]'))?.setAttribute('tabindex','0');
      return grid;
    }
    weekdayRow(){
      const head=make('div','calendar-weekdays');head.setAttribute('role','row');
      weekdays.forEach((label,index)=>{const cell=make('span','');cell.setAttribute('role','columnheader');cell.setAttribute('aria-label',new Date(2023,0,1+index).toLocaleDateString(undefined,{weekday:'long'}));cell.append(make('span','wd-long',label),make('span','wd-short',label[0]));head.append(cell);});
      return head;
    }
    footer() {
      const footer=make('div','calendar-footer'),status=make('div',this.chatMode?'calendar-summary calendar-instruction':'calendar-summary',this.instruction());status.setAttribute('aria-live','polite');status.setAttribute('aria-atomic','true');this.status=status;
      const actions=make('div','calendar-actions'),clear=make('button','calendar-clear',this.applied.start?'Clear filter':'Clear'),apply=make('button','calendar-apply','Apply');clear.type=apply.type='button';
      clear.addEventListener('click',()=>this.reset());apply.disabled=!this.bounds();apply.addEventListener('click',()=>this.apply());actions.append(clear,apply);footer.append(status,actions);return footer;
    }
    monthStart(value){return validDate(value.getFullYear(),value.getMonth()+1,1);}
    addMonth(value,count){const next=new Date(value);next.setDate(1);next.setMonth(next.getMonth()+count);return this.monthStart(next);}
    // The months the sheet lists: around the one in view, never past the available range; more load as you scroll.
    sheetBounds(){
      const {min,max}=this.availability(),latest=this.monthStart(parse(max)||new Date()),earliestDay=parse(min)||validDate(2005,6,1),earliest=this.monthStart(earliestDay);
      return {earliest,latest};
    }
    ensureSheetMonths(){
      const {earliest,latest}=this.sheetBounds(),view=this.monthStart(this.view);
      const clamp=value=>value<earliest?earliest:value>latest?latest:value;
      if(!this.sheetFirst || view<this.sheetFirst || view>this.sheetLast){this.sheetFirst=clamp(this.addMonth(view,-3));this.sheetLast=clamp(this.addMonth(view,3));if(this.sheetLast<latest && this.addMonth(this.sheetLast,3)>=latest)this.sheetLast=latest;}
      this.sheetFirst=clamp(this.sheetFirst);this.sheetLast=clamp(this.sheetLast);
    }
    renderSheet(){
      const root=this.element,old=root.querySelector('.calendar-months'),keep=old&&!this.sheetJump?{top:old.scrollTop,height:old.scrollHeight}:null,scrolled=root.querySelector('.calendar-presets')?.scrollLeft || 0;
      this.notice='';root.replaceChildren();
      const head=make('div','date-sheet-head'),handle=make('div','date-sheet-handle'),title=make('h2','date-sheet-title',this.chooser?`Choose ${this.chooser}`:'Date'),closer=make('button','date-sheet-close');
      handle.setAttribute('aria-hidden','true');closer.type='button';closer.setAttribute('aria-label','Close');closer.append(glyph('close'));closer.addEventListener('click',()=>this.close());
      if(this.chooser){const back=make('button','date-sheet-back');back.type='button';back.setAttribute('aria-label','Back to the calendar');back.append(glyph('prev'));back.addEventListener('click',()=>{this.chooser='';this.sheetJump=true;this.render();});head.append(handle,back,title,closer);}
      else head.append(handle,title,closer);
      root.append(head);
      if(this.chooser){const body=make('div','calendar-body date-sheet-choices');body.append(this.choices());root.append(body,this.footer());return;}
      const presets=this.presets();root.append(this.modeBar(),presets,this.weekdayRow());
      this.ensureSheetMonths();
      const list=make('div','calendar-months');list.setAttribute('aria-label','Months');
      for(let month=this.sheetFirst;month<=this.sheetLast;month=this.addMonth(month,1)){
        const block=make('section','calendar-month-block');block.dataset.month=iso(month).slice(0,7);
        const label=make('button','calendar-month-title',month.toLocaleDateString(undefined,{month:'long',year:'numeric'}));label.type='button';label.setAttribute('aria-label',`${label.textContent}, choose another month or year`);
        label.addEventListener('click',()=>{this.view=month;this.chooser='year';this.render();this.focusOption(this.element.querySelector('.calendar-option[aria-pressed=true]'));});
        block.append(label,this.calendar(month,{weekdays:false}));list.append(block);
      }
      root.append(list,this.footer());
      presets.scrollLeft=scrolled;this.syncPresetFade(presets);
      // Keep the reader's place across a choice; after a jump (opening, a preset, a chosen month) show that month.
      if(keep){list.scrollTop=keep.top+(this.sheetShift?list.scrollHeight-keep.height:0);}
      else frame(()=>{const target=list.querySelector(`[data-month="${iso(this.monthStart(this.view)).slice(0,7)}"]`);if(target)list.scrollTop=Math.max(0,target.offsetTop-list.offsetTop-8);});
      this.sheetShift=false;this.sheetJump=false;
      // Older months load as the top comes near; newer ones (up to today) at the bottom.
      list.addEventListener('scroll',()=>{
        const {earliest,latest}=this.sheetBounds();
        if(list.scrollTop<160 && this.sheetFirst>earliest){this.sheetFirst=this.addMonth(this.sheetFirst,-6);if(this.sheetFirst<earliest)this.sheetFirst=earliest;this.sheetShift=true;this.render();}
        else if(list.scrollTop+list.clientHeight>list.scrollHeight-160 && this.sheetLast<latest){this.sheetLast=this.addMonth(this.sheetLast,6);if(this.sheetLast>latest)this.sheetLast=latest;this.render();}
      },{passive:true});
    }
    render() {
      if(this.sheet){this.renderSheet();return;}
      const root=this.element,scrolled=root.querySelector('.calendar-presets')?.scrollLeft || 0;this.notice='';root.replaceChildren();
      const body=make('div','calendar-body');body.append(this.chooser?this.choices():this.calendar());
      const presets=this.presets();root.append(this.modeBar(),presets,this.heading(),body,this.footer());
      // Re-rendering keeps the strip where the reader left it.
      presets.scrollLeft=scrolled;this.syncPresetFade(presets);this.queuePosition();
    }
  }
  DatePicker.styles=`
    .date-popover{box-sizing:border-box;--calendar-cell:26px;--calendar-head:18px;--calendar-body:calc(var(--calendar-head) + var(--calendar-cell) * 6);--calendar-control:26px;--calendar-accent:var(--color-brand-background,#d93900);--calendar-band:color-mix(in srgb,var(--calendar-accent) 13%,var(--rcs-bg));--calendar-ring:color-mix(in srgb,var(--rcs-text) 16%,var(--rcs-bg));--calendar-focus:var(--rcs-focus,#167cb0);container-type:inline-size;position:absolute;top:calc(100% + 4px);right:8px;z-index:9;display:flex;flex-direction:column;gap:5px;width:248px;max-width:calc(100% - 16px);max-height:min(400px,var(--rcs-calendar-height,80vh));overflow:hidden;padding:6px 6px 8px;background:var(--rcs-bg);color:var(--rcs-text);border:1px solid var(--rcs-line);border-radius:12px;box-shadow:0 4px 16px rgba(0,0,0,.14),0 1px 2px rgba(0,0,0,.08);font:12px/1.35 var(--font-sans,Arial,sans-serif)}
    .date-popover[data-scheme=dark]{--calendar-band:color-mix(in srgb,var(--calendar-accent) 24%,var(--rcs-bg));--calendar-ring:color-mix(in srgb,var(--rcs-text) 24%,var(--rcs-bg));border-color:var(--calendar-ring);box-shadow:0 6px 22px rgba(0,0,0,.6),0 1px 3px rgba(0,0,0,.5)}
    @media (prefers-color-scheme:dark){.date-popover:not([data-scheme=light]){--calendar-band:color-mix(in srgb,var(--calendar-accent) 24%,var(--rcs-bg));--calendar-ring:color-mix(in srgb,var(--rcs-text) 24%,var(--rcs-bg));border-color:var(--calendar-ring);box-shadow:0 6px 22px rgba(0,0,0,.6),0 1px 3px rgba(0,0,0,.5)}}
    .date-popover[hidden],.date-popover [hidden]{display:none!important}.date-popover *{box-sizing:border-box}.date-popover button{margin:0;font-family:inherit;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent}.date-popover button:focus-visible{outline:2px solid var(--calendar-focus);outline-offset:-2px}
    .date-modes{display:flex;flex:none;gap:0;border-bottom:1px solid var(--rcs-line)}.date-mode{flex:1 1 0;min-width:0;height:var(--calendar-control);padding:0 2px;border:0;border-radius:0;background:transparent;color:var(--rcs-muted);font-size:12px;font-weight:500;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;box-shadow:inset 0 -2px 0 transparent}.date-mode:hover{color:var(--rcs-text)}.date-popover .date-mode[aria-checked=true]{color:var(--rcs-text);font-weight:700;box-shadow:inset 0 -2px 0 var(--calendar-accent)}
    .calendar-presets{position:relative;display:flex;flex:none;flex-wrap:nowrap;gap:4px;margin:0 -6px;padding:0 6px;overflow-x:auto;overflow-y:hidden;overscroll-behavior-x:contain;scroll-padding-inline:6px;scrollbar-width:none}.calendar-presets::-webkit-scrollbar{display:none}.calendar-presets[data-fade=end]{-webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 24px),transparent);mask-image:linear-gradient(90deg,#000 calc(100% - 24px),transparent)}.calendar-presets[data-fade=start]{-webkit-mask-image:linear-gradient(90deg,transparent,#000 24px);mask-image:linear-gradient(90deg,transparent,#000 24px)}.calendar-presets[data-fade=both]{-webkit-mask-image:linear-gradient(90deg,transparent,#000 24px,#000 calc(100% - 24px),transparent);mask-image:linear-gradient(90deg,transparent,#000 24px,#000 calc(100% - 24px),transparent)}.calendar-preset{display:inline-flex;flex:none;align-items:center;height:22px;padding:0 9px;border:0;border-radius:999px;background:var(--rcs-soft);color:var(--rcs-text);font-size:12px;font-weight:500;line-height:1;white-space:nowrap}.calendar-preset:hover:not(:disabled){background:var(--rcs-hover)}.date-popover .calendar-preset[aria-pressed=true]{background:var(--calendar-band);color:var(--rcs-text);font-weight:600;box-shadow:inset 0 0 0 1px var(--calendar-accent)}.calendar-preset:disabled{color:var(--rcs-muted);opacity:.45;cursor:default}
    .calendar-nav{display:flex;flex:none;align-items:center;justify-content:space-between;gap:2px;height:var(--calendar-control)}.calendar-heading{display:flex;flex:1;align-items:center;justify-content:center;gap:0;min-width:0}.calendar-nav-button{display:grid;place-items:center;flex:none;width:var(--calendar-control);height:var(--calendar-control);padding:0;border:0;border-radius:7px;background:transparent;color:var(--rcs-text)}.calendar-nav-button svg{width:16px;height:16px}.calendar-nav-button[aria-disabled=true],.calendar-nav-button:disabled{color:var(--rcs-muted);opacity:.4;cursor:default}
    .calendar-month,.calendar-year{display:inline-flex;align-items:center;gap:1px;min-width:0;height:var(--calendar-control);padding:0 6px;border:0;border-radius:999px;background:transparent;color:var(--rcs-text);font-size:13px;font-weight:700;line-height:1.2;white-space:nowrap}.calendar-month svg,.calendar-year svg{width:12px;height:12px;flex:none;color:var(--rcs-muted)}.calendar-month[aria-expanded=true],.calendar-year[aria-expanded=true]{background:var(--rcs-soft)}
    .calendar-body{flex:1 1 auto;min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin}.calendar-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));grid-template-rows:var(--calendar-head);grid-auto-rows:var(--calendar-cell);align-content:start;gap:2px}.calendar-weekdays,.calendar-week{display:contents}.calendar-weekdays>span{display:grid;place-items:center;color:var(--rcs-muted);font-size:12px;font-weight:500}.calendar-weekdays .wd-short{display:none}
    .calendar-day{position:relative;isolation:isolate;display:grid;place-items:center;width:100%;height:var(--calendar-cell);min-width:0;padding:0;border:0;border-radius:0;background:transparent;color:var(--rcs-text);font-size:12px;line-height:1;font-variant-numeric:tabular-nums}
    .calendar-day::before{content:'';position:absolute;z-index:-1;top:50%;left:50%;width:min(var(--calendar-cell),100%);height:min(var(--calendar-cell),100%);transform:translate(-50%,-50%);border-radius:6px}
    /* Each day inside a range is its own faded box; the gap between days keeps them apart. */
    .calendar-day.range::before,.calendar-day.preview::before{background:var(--calendar-band)}.calendar-day.preview::before{opacity:.7}
    .calendar-day:hover:not([aria-disabled=true])::before{background:var(--rcs-hover)}.calendar-day.today{color:var(--calendar-accent);font-weight:700}.calendar-day.selected{color:#fff;font-weight:700}.date-popover .calendar-day.selected::before{background:var(--calendar-accent);box-shadow:none}
    .calendar-day.has-messages::after{content:'';position:absolute;bottom:2px;left:50%;width:4px;height:4px;margin-left:-2px;border-radius:50%;background:currentColor;opacity:.5}.calendar-day.selected.has-messages::after{opacity:.9}
    .date-popover .calendar-day:focus-visible{outline:0}.date-popover .calendar-day:focus-visible::before{outline:2px solid var(--calendar-focus);outline-offset:-2px}.date-popover .calendar-day.selected:focus-visible::before{box-shadow:inset 0 0 0 3px var(--calendar-accent),inset 0 0 0 4px #fff}
    .calendar-day[aria-disabled=true]{color:var(--rcs-muted);opacity:.45;cursor:default}
    .calendar-choices{position:relative;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));grid-auto-rows:32px;gap:2px;align-content:start;height:var(--calendar-body);overflow:auto;overscroll-behavior:contain;scrollbar-width:thin}.year-choices{grid-template-columns:repeat(4,minmax(0,1fr))}.calendar-option{min-width:0;padding:0 4px;border:0;border-radius:999px;background:transparent;color:var(--rcs-text);font-size:12px}.calendar-option:hover{background:var(--rcs-hover)}.date-popover .calendar-option[aria-pressed=true]{background:var(--calendar-accent);color:#fff;font-weight:700}
    .calendar-footer{display:flex;flex:none;align-items:center;gap:6px;padding-top:5px;border-top:1px solid var(--rcs-line)}.calendar-summary{flex:1 1 auto;min-width:0;margin:0;color:var(--rcs-muted);font-size:12px;line-height:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.calendar-actions{display:flex;flex:none;gap:4px}
    .calendar-clear,.calendar-apply{display:inline-flex;align-items:center;justify-content:center;height:var(--calendar-control);padding:0 12px;border:0;border-radius:999px;font-size:12px;font-weight:700;line-height:1;white-space:nowrap}.calendar-clear{background:transparent;color:var(--rcs-text)}.calendar-clear:hover{background:var(--rcs-hover)}.calendar-apply{background:var(--calendar-accent);color:#fff}.calendar-apply:hover:not([aria-disabled=true]):not(:disabled){filter:brightness(1.08)}.calendar-apply[aria-disabled=true],.calendar-apply:disabled{background:var(--rcs-soft);color:var(--rcs-muted);cursor:default}
    .calendar-nav-button:hover:not(:disabled):not([aria-disabled=true]),.calendar-month:hover,.calendar-year:hover{background:var(--rcs-hover)}
    :host([data-rcs-compact]) .date-popover{--calendar-cell:24px;--calendar-control:24px;right:6px;width:232px;max-width:calc(100% - 12px);gap:4px;padding:6px 6px 8px;top:calc(100% + 3px)}:host([data-rcs-compact]) .calendar-month,:host([data-rcs-compact]) .calendar-year{font-size:13px}:host([data-rcs-compact]) .calendar-choices{grid-auto-rows:28px}:host([data-rcs-compact]) .calendar-preset{height:22px;padding:0 8px}:host([data-rcs-compact]) .calendar-presets{margin-inline:-6px;padding-inline:6px}
    @media (pointer:coarse){.date-popover,:host([data-rcs-compact]) .date-popover{--calendar-cell:34px;--calendar-control:36px}.calendar-preset,:host([data-rcs-compact]) .calendar-preset{height:32px}}
    @container (max-width:231px){.calendar-weekdays .wd-long{display:none}.calendar-weekdays .wd-short{display:inline}.calendar-footer{flex-wrap:wrap}.calendar-summary{flex-basis:100%}.calendar-actions{margin-inline-start:auto}.calendar-month,.calendar-year{padding:0 3px;font-size:13px}}
    @media (prefers-reduced-motion:no-preference){.date-popover button,.calendar-day::before{transition:background-color .12s ease,color .12s ease,box-shadow .12s ease}}
    /* Phones: a pull-up sheet (docs/date-picker-mobile-spec.md). Months scroll continuously under a fixed weekday row;
       days are 44 px touch targets; Clear and a full-width Apply stay at the bottom. */
    .date-sheet-scrim{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.6);pointer-events:auto}
    .date-popover.date-sheet{position:fixed!important;left:0!important;right:0!important;top:auto!important;bottom:0!important;z-index:2147483001;width:100%!important;max-width:none!important;height:min(640px,88vh);height:min(640px,88dvh);max-height:none;display:flex;flex-direction:column;gap:8px;margin:0;padding:0 16px calc(12px + env(safe-area-inset-bottom,0px));border:0;border-radius:16px 16px 0 0;box-shadow:0 -2px 15px rgba(26,26,27,.3);pointer-events:auto;--calendar-cell:44px;--calendar-control:40px;--calendar-head:28px;font-size:15px;overflow:hidden}
    .date-sheet .date-sheet-head{position:relative;display:flex;align-items:center;gap:8px;flex:none;min-height:52px;padding-top:14px}
    .date-sheet .date-sheet-handle{position:absolute;top:6px;left:50%;width:36px;height:4px;margin-left:-18px;border-radius:2px;background:var(--rcs-line,#d0d7da)}
    .date-sheet .date-sheet-title{flex:1;min-width:0;margin:0;color:var(--rcs-text);font-size:18px;font-weight:700;line-height:24px;text-transform:capitalize}
    .date-sheet .date-sheet-close,.date-sheet .date-sheet-back{display:grid;place-items:center;flex:none;width:36px;height:36px;padding:0;border:0;border-radius:999px;background:var(--rcs-soft,#f2f4f5);color:var(--rcs-text)}.date-sheet .date-sheet-back{background:transparent}
    .date-sheet .date-sheet-close svg,.date-sheet .date-sheet-back svg{width:20px;height:20px}
    .date-sheet .date-modes{border:1px solid var(--rcs-line);border-radius:999px;overflow:hidden}.date-sheet .date-mode{height:38px;font-size:14px}
    .date-sheet .calendar-presets{margin:0 -16px;padding:0 16px;gap:8px}.date-sheet .calendar-preset{height:36px;padding:0 14px;font-size:14px}
    .date-sheet .calendar-weekdays{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));flex:none;height:28px;align-items:center;border-bottom:1px solid var(--rcs-line);color:var(--rcs-muted);font-size:12px;font-weight:600;text-align:center}
    .date-sheet .calendar-months{flex:1 1 auto;min-height:0;margin:0 -16px;padding:0 16px;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}
    .date-sheet .calendar-month-block{padding:4px 0 12px}
    .date-sheet .calendar-month-title{position:sticky;top:0;z-index:1;display:block;width:100%;height:40px;padding:0 4px;border:0;background:var(--rcs-bg);color:var(--rcs-text);font-size:16px;font-weight:700;text-align:start}
    .date-sheet .calendar-grid{gap:2px 0;grid-template-rows:none}.date-sheet .calendar-day{font-size:15px}
    .date-sheet .calendar-day::before{width:40px;height:40px;border-radius:999px}
    .date-sheet .calendar-day.range::before,.date-sheet .calendar-day.preview::before{width:100%;border-radius:0}
    .date-sheet .calendar-day.range-start::after,.date-sheet .calendar-day.range-end::after{content:'';position:absolute;z-index:-2;top:50%;height:40px;width:50%;transform:translateY(-50%);background:var(--calendar-band)}
    .date-sheet .calendar-day.range-start::after{right:0}.date-sheet .calendar-day.range-end::after{left:0}
    .date-sheet .date-sheet-choices{flex:1 1 auto;min-height:0;overflow:auto}.date-sheet .calendar-choices{height:auto;grid-auto-rows:48px;gap:6px}.date-sheet .calendar-option{font-size:15px}
    .date-sheet .calendar-footer{flex-wrap:wrap;gap:8px;padding-top:10px}.date-sheet .calendar-summary{flex-basis:100%;font-size:14px;line-height:20px;color:var(--rcs-text)}
    .date-sheet .calendar-actions{flex:1 1 100%;gap:8px}.date-sheet .calendar-clear,.date-sheet .calendar-apply{height:44px;font-size:15px}.date-sheet .calendar-clear{flex:none;padding:0 18px}.date-sheet .calendar-apply{flex:1}
    @media (prefers-reduced-motion:no-preference){.date-popover.date-sheet:not([hidden]){animation:date-sheet-in .2s ease-out}.date-sheet-scrim{animation:date-sheet-fade .2s ease-out}}
    @keyframes date-sheet-in{from{transform:translateY(24px);opacity:.6}to{transform:none;opacity:1}}@keyframes date-sheet-fade{from{opacity:0}to{opacity:1}}
  `;
  globalThis.RCSDatePicker=DatePicker;
})();
