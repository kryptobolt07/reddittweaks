/* Compact local date filters. Editing a draft never sends a Reddit request. */
(() => {
  const make=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
  const parts=['day','month','year'],modes=['On','Before','After','Between'];let sequence=0;
  const iso=date=>`${String(date.getFullYear()).padStart(4,'0')}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  function date(year,month,day){
    if(!Number.isInteger(year) || year<1 || year>9999 || !Number.isInteger(month) || month<1 || month>12 || !Number.isInteger(day) || day<1 || day>31)return null;
    const value=new Date(0);value.setHours(12,0,0,0);value.setFullYear(year,month-1,day);
    return value.getFullYear()===year && value.getMonth()===month-1 && value.getDate()===day?value:null;
  }
  const parse=value=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(value || ''))return null;const [y,m,d]=value.split('-').map(Number);return date(y,m,d);};
  const split=value=>{const valid=parse(value);return valid?{day:value.slice(8),month:value.slice(5,7),year:value.slice(0,4)}:{day:'',month:'',year:''};};
  const shift=(value,days)=>{const result=parse(value);if(!result)return '';result.setDate(result.getDate()+days);return result.getFullYear()>=1 && result.getFullYear()<=9999?iso(result):'';};
  class DatePicker {
    constructor({onChange,onClose}){
      this.onChange=onChange;this.onClose=onClose;this.applied={mode:'Between',start:'',end:''};this.draft={...this.applied};this.values={start:split(''),end:split('')};this.id='rcs-date-'+(++sequence);
      this.element=make('section','date-popover segmented-date-picker');this.element.hidden=true;this.element.setAttribute('role','dialog');this.element.setAttribute('aria-label','Filter messages by date');
      this.element.addEventListener('keydown',event=>this.keydown(event));
      this.element.addEventListener('pointerdown',event=>{if(this.modeOpen && !event.target.closest('.date-condition-picker'))this.toggleModes(false);});
    }
    get open(){return !this.element.hidden;}
    show(){this.draft={...this.applied};this.values={start:split(this.draft.start),end:split(this.draft.end)};this.tried=false;this.modeOpen=false;this.element.hidden=false;this.render();this.segment('start','day')?.focus({preventScroll:true});}
    close(restoreFocus=true){this.modeOpen=false;this.element.hidden=true;this.onClose?.(restoreFocus);}
    reset(){this.applied={mode:'Between',start:'',end:''};this.draft={...this.applied};this.values={start:split(''),end:split('')};this.tried=false;this.modeOpen=false;this.onChange({from:'',to:''},'');this.render();if(this.open)this.segment('start','day')?.focus({preventScroll:true});}
    segment(bound,part){return this.element.querySelector(`input[data-bound="${bound}"][data-part="${part}"]`);}
    limit(bound,part){if(part==='year')return 9999;if(part==='month')return 12;const value=this.values[bound],month=Number(value.month),year=Number(value.year);if(month<1 || month>12)return 31;const first=date(value.year.length===4 && year>=1?year:2000,month,1);first.setMonth(first.getMonth()+1,0);return first.getDate();}
    read(bound){const value=this.values[bound];if(!value.day || !value.month || value.year.length!==4)return '';const result=date(Number(value.year),Number(value.month),Number(value.day));return result?iso(result):'';}
    bounds(){
      const {mode,start,end}=this.draft;if(!parse(start) || mode==='Between' && (!parse(end) || end<start))return null;
      if(mode==='Before'){const to=shift(start,-1);return to?{from:'',to}:null;}
      if(mode==='After'){const from=shift(start,1);return from?{from,to:''}:null;}
      return {from:start,to:mode==='On'?start:end};
    }
    summary(){const short=value=>parse(value)?.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}) || '';const {mode,start,end}=this.draft;return start?mode==='Between'?end?`${short(start)} – ${short(end)}`:`${short(start)} · Enter end date`:`${mode} ${short(start)}`:mode==='Between'?'Enter start and end dates':'Enter a date';}
    compactSummary(){
      const {mode,start,end}=this.applied;if(!parse(start))return '';const short=value=>parse(value)?.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}) || '';
      if(mode!=='Between')return `${mode} ${short(start)}`;if(start===end)return short(start);if(!parse(end))return short(start);
      const formatter=new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',year:'numeric'});return formatter.formatRange?formatter.formatRange(parse(start),parse(end)):`${short(start)} – ${short(end)}`;
    }
    apply(){const bounds=this.bounds();if(!bounds){this.tried=true;this.update();const input=this.element.querySelector('input[aria-invalid="true"]') || [...this.element.querySelectorAll('input')].find(input=>!input.value || input.dataset.part==='year' && input.value.length<4);input?.focus({preventScroll:true});return;}this.applied={...this.draft};this.onChange(bounds,this.summary());this.close();}
    toggleModes(open=!this.modeOpen){this.modeOpen=open;this.modeMenu.hidden=!open;this.modeButton.setAttribute('aria-expanded',String(open));if(open)this.modeMenu.querySelector('[aria-selected="true"]')?.focus({preventScroll:true});}
    setMode(mode){if(!modes.includes(mode))return;this.draft.mode=mode;this.modeOpen=false;this.tried=false;this.render();this.segment('start','day')?.focus({preventScroll:true});}
    update(){
      this.draft.start=this.read('start');this.draft.end=this.read('end');let error='';
      for(const bound of this.draft.mode==='Between'?['start','end']:['start']){
        const value=this.values[bound],complete=Boolean(value.day && value.month && value.year.length===4),invalid=complete && !this.draft[bound];
        for(const part of parts){const input=this.segment(bound,part);if(!input)continue;const number=Number(value[part]),max=this.limit(bound,part),bad=Boolean(value[part]) && (number>max || number<1 && value[part].length===input.maxLength || invalid);
          input.setAttribute('aria-valuemax',String(max));input.setAttribute('aria-invalid',String(bad));if(value[part] && number>=1 && number<=max)input.setAttribute('aria-valuenow',String(number));else input.removeAttribute('aria-valuenow');
        }
        if(invalid)error='Enter a valid date (DD / MM / YYYY).';
      }
      if(this.draft.mode==='Between' && this.draft.start && this.draft.end && this.draft.end<this.draft.start){error='End date must be on or after start date.';for(const input of this.element.querySelectorAll('input[data-bound="end"]'))input.setAttribute('aria-invalid','true');}
      if(!error && this.draft.start && this.draft.mode!=='Between' && !this.bounds())error='Choose a date between years 0001 and 9999.';
      if(!error && this.tried && !this.bounds())error=this.draft.mode==='Between'?'Enter both dates (DD / MM / YYYY).':'Enter a complete date (DD / MM / YYYY).';
      this.error.textContent=error;this.error.hidden=!error;this.applyButton.disabled=!this.bounds();
    }
    normalize(input){const {bound,part}=input.dataset,value=input.value,number=Number(value);if(value && (part!=='year' || value.length===4) && number>=1 && number<=this.limit(bound,part)){input.value=String(number).padStart(part==='year'?4:2,'0');this.values[bound][part]=input.value;}this.update();}
    step(input,key){
      const {bound,part}=input.dataset,max=this.limit(bound,part),current=Number(input.value),blank=!input.value;let value;
      if(key==='Home')value=1;else if(key==='End')value=max;else if(blank)value=part==='year'?new Date().getFullYear():key==='ArrowUp'?1:max;else value=Math.max(1,Math.min(max,current+(key==='ArrowUp'?1:-1)));
      this.values[bound][part]=String(value).padStart(part==='year'?4:2,'0');input.value=this.values[bound][part];
      if(part!=='day' && Number(this.values[bound].day)>this.limit(bound,'day')){this.values[bound].day=String(this.limit(bound,'day')).padStart(2,'0');this.segment(bound,'day').value=this.values[bound].day;}
      this.update();input.select();
    }
    keydown(event){
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(this.modeOpen){this.toggleModes(false);this.modeButton.focus({preventScroll:true});}else this.close();return;}
      if(event.altKey || event.ctrlKey || event.metaKey || event.isComposing)return;
      if(this.modeOpen && ['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();event.stopPropagation();const options=[...this.modeMenu.children],at=options.indexOf(event.target);options[event.key==='Home'?0:event.key==='End'?options.length-1:(at+(event.key==='ArrowDown'?1:-1)+options.length)%options.length]?.focus({preventScroll:true});return;}
      if(event.target===this.modeButton && ['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();event.stopPropagation();this.toggleModes(true);return;}
      const input=event.target.closest('input[data-part]');if(!input)return;
      if(['ArrowUp','ArrowDown','Home','End'].includes(event.key)){event.preventDefault();event.stopPropagation();this.step(input,event.key);return;}
      if(event.key==='Enter'){event.preventDefault();event.stopPropagation();this.apply();return;}
      const all=[...this.element.querySelectorAll('input[data-part]')],at=all.indexOf(input),selected=input.selectionStart===0 && input.selectionEnd===input.value.length;
      if(event.key==='ArrowRight' && (selected || input.selectionStart===input.value.length) || event.key==='ArrowLeft' && (selected || input.selectionStart===0) || event.key==='Backspace' && !input.value){const next=all[at+(event.key==='ArrowRight'?1:-1)];if(next){event.preventDefault();event.stopPropagation();this.normalize(input);next.focus({preventScroll:true});}}
    }
    field(bound,label){
      const row=make('div','date-field-row'),name=make('span','date-field-label',label),group=make('div','date-segments');group.setAttribute('role','group');group.setAttribute('aria-label',bound==='end'?'End date':this.draft.mode==='Between'?'Start date':'Date');row.append(name,group);
      for(const [index,part]of parts.entries()){
        if(index){const divider=make('span','date-separator','/');divider.setAttribute('aria-hidden','true');group.append(divider);}
        const input=make('input','date-segment '+part);input.type='text';input.inputMode='numeric';input.autocomplete='off';input.spellcheck=false;input.maxLength=part==='year'?4:2;input.placeholder={day:'DD',month:'MM',year:'YYYY'}[part];input.value=this.values[bound][part];input.dataset.bound=bound;input.dataset.part=part;
        input.setAttribute('role','spinbutton');input.setAttribute('aria-label',`${bound==='end'?'End':this.draft.mode==='Between'?'Start':'Date'} ${part}`);input.setAttribute('aria-valuemin','1');input.setAttribute('aria-describedby',this.id+'-hint '+this.id+'-error');
        input.addEventListener('focus',()=>input.select());input.addEventListener('click',()=>input.select());input.addEventListener('blur',()=>this.normalize(input));
        input.addEventListener('input',()=>{input.value=input.value.replace(/\D/g,'').slice(0,input.maxLength);this.values[bound][part]=input.value;this.tried=false;this.update();if(input.value.length===input.maxLength && Number(input.value)>=1 && Number(input.value)<=this.limit(bound,part)){const next=this.segment(bound,parts[index+1]);next?.focus({preventScroll:true});}});
        input.addEventListener('paste',event=>{const text=event.clipboardData?.getData('text/plain')?.trim() || '';let value;if(/^\d{4}-\d{2}-\d{2}$/.test(text))value=text;else {const match=text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);if(match)value=match[3]+'-'+match[2].padStart(2,'0')+'-'+match[1].padStart(2,'0');}if(!value)return;event.preventDefault();const [year,month,day]=value.split('-');this.values[bound]={day,month,year};for(const field of parts)this.segment(bound,field).value=this.values[bound][field];this.update();this.segment(bound,'year').focus({preventScroll:true});});
        group.append(input);
      }
      return row;
    }
    render(){
      const root=this.element;root.replaceChildren();const header=make('div','date-header'),title=make('span','date-title','Date filter'),condition=make('div','date-condition-picker');
      this.modeButton=make('button','date-condition',this.draft.mode);this.modeButton.type='button';this.modeButton.setAttribute('aria-label','Date condition: '+this.draft.mode);this.modeButton.setAttribute('aria-haspopup','listbox');this.modeButton.setAttribute('aria-expanded','false');this.modeButton.setAttribute('aria-controls',this.id+'-modes');this.modeButton.addEventListener('click',()=>this.toggleModes());
      this.modeMenu=make('div','date-condition-options');this.modeMenu.id=this.id+'-modes';this.modeMenu.hidden=true;this.modeMenu.setAttribute('role','listbox');this.modeMenu.setAttribute('aria-label','Date condition');
      for(const mode of modes){const option=make('button','date-mode',mode);option.type='button';option.dataset.mode=mode;option.setAttribute('role','option');option.setAttribute('aria-selected',String(mode===this.draft.mode));option.addEventListener('click',()=>this.setMode(mode));this.modeMenu.append(option);}
      condition.append(this.modeButton,this.modeMenu);header.append(title,condition);root.append(header,this.field('start',this.draft.mode==='Between'?'From':'Date'));if(this.draft.mode==='Between')root.append(this.field('end','To'));
      const hint=make('span','date-sr-only','Enter day, month, year. Up and down change a segment; left and right move between segments. Enter applies; Escape cancels.');hint.id=this.id+'-hint';this.error=make('p','date-error');this.error.id=this.id+'-error';this.error.setAttribute('role','status');this.error.setAttribute('aria-live','polite');
      const actions=make('div','calendar-actions'),clear=make('button','calendar-clear','Clear');clear.type='button';clear.addEventListener('click',()=>this.reset());this.applyButton=make('button','calendar-apply','Apply');this.applyButton.type='button';this.applyButton.addEventListener('click',()=>this.apply());actions.append(clear,this.applyButton);root.append(hint,this.error,actions);this.update();
    }
  }
  DatePicker.styles=`
    .date-popover { position:absolute;top:calc(100% + 6px);right:8px;z-index:9;width:236px;max-width:calc(100% - 16px);padding:8px;background:var(--rcs-bg);color:var(--rcs-text);border:1px solid var(--rcs-line);border-radius:10px;box-shadow:0 6px 20px #0002;font-size:12px; }
    .date-popover [hidden] { display:none!important; }
    .date-header { display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px; }
    .date-title { color:var(--rcs-muted);font-size:11px; }
    .date-condition-picker { position:relative; }
    .date-condition { display:flex;align-items:center;gap:8px;min-height:26px;border:0;border-radius:7px;padding:4px 8px;background:var(--rcs-soft);color:var(--rcs-text);font:inherit;cursor:pointer; }
    .date-condition::after { content:'';width:5px;height:5px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(45deg);margin-top:-3px; }
    .date-condition[aria-expanded=true] { box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--rcs-accent) 45%,var(--rcs-line)); }
    .date-condition-options { position:absolute;top:calc(100% + 4px);right:0;z-index:2;min-width:112px;padding:4px;background:var(--rcs-bg);border:1px solid var(--rcs-line);border-radius:8px;box-shadow:0 4px 14px #0002; }
    .date-mode { display:block;width:100%;min-height:27px;padding:4px 8px;border:0;border-radius:5px;text-align:left;background:transparent;color:var(--rcs-text);font:inherit;cursor:pointer; }
    .date-mode[aria-selected=true] { background:color-mix(in srgb,var(--rcs-accent) 10%,var(--rcs-bg));color:var(--rcs-text);box-shadow:inset 2px 0 0 var(--rcs-accent); }
    .date-mode:hover,.date-condition:hover,.calendar-clear:hover { background:var(--rcs-hover); }
    .date-field-row { display:flex;align-items:center;gap:6px;margin-bottom:6px; }
    .date-field-label { flex:0 0 30px;color:var(--rcs-muted);font-size:11px; }
    .date-segments { display:flex;align-items:center;justify-content:center;flex:1;min-width:0;gap:2px;padding:3px 5px;background:var(--rcs-soft);border:1px solid transparent;border-radius:7px; }
    .date-segments:focus-within { border-color:color-mix(in srgb,var(--rcs-accent) 55%,var(--rcs-line)); }
    .date-segment { box-sizing:content-box;min-width:0;width:3ch;height:23px;padding:0 3px;border:0;border-radius:3px;background:transparent;color:var(--rcs-text);font:inherit;font-variant-numeric:tabular-nums;text-align:center;outline:0; }
    .date-segment.year { width:5ch; }
    .date-segment::placeholder { color:var(--rcs-muted);opacity:1; }
    .date-segment:focus { background:color-mix(in srgb,var(--rcs-accent) 12%,var(--rcs-bg)); }
    .date-segment::selection { background:color-mix(in srgb,var(--rcs-accent) 25%,var(--rcs-bg));color:var(--rcs-text); }
    .date-segment[aria-invalid=true] { text-decoration:underline wavy var(--rcs-accent);text-underline-offset:3px; }
    .date-separator { color:var(--rcs-muted); }
    .date-error { margin:4px 0 7px;color:var(--rcs-muted);font-size:10px;line-height:1.4; }
    .date-sr-only { position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0; }
    .calendar-actions { display:flex;justify-content:space-between;gap:8px;border-top:1px solid var(--rcs-line);padding-top:6px;margin-top:2px; }
    .calendar-clear,.calendar-apply { border:0;border-radius:999px;font:inherit;font-size:11px;min-height:26px;padding:4px 12px;cursor:pointer; }
    .calendar-clear { background:var(--rcs-soft);color:var(--rcs-text); }.calendar-apply { background:var(--rcs-accent);color:#1a1a1b;font-weight:600; }.calendar-apply:disabled { opacity:.4;cursor:default; }
    .calendar-apply:hover:not(:disabled) { filter:brightness(.95); }
    .date-condition:focus-visible,.date-mode:focus-visible,.calendar-clear:focus-visible,.calendar-apply:focus-visible { outline:1px solid var(--rcs-accent);outline-offset:1px; }
    :host([data-rcs-compact]) .date-popover { right:6px;width:224px;max-width:calc(100% - 12px);padding:7px;top:calc(100% + 3px);border-radius:9px; }
  `;
  globalThis.RCSDatePicker=DatePicker;
})();
