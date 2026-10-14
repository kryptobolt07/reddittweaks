/* Compact local date filters. Editing a draft never sends a Reddit request. */
(() => {
  const make=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
  const parts=['day','month','year'],modes=['On','Before','After','Between'];let sequence=0;
  const months=Array.from({length:12},(_,i)=>new Date(2000,i,1).toLocaleDateString(undefined,{month:'long'}));
  const shortMonths=Array.from({length:12},(_,i)=>new Date(2000,i,1).toLocaleDateString(undefined,{month:'short'}));
  const englishMonths=['January','February','March','April','May','June','July','August','September','October','November','December'];
  const fold=value=>value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase().trim();

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
      this.element.addEventListener('pointerdown',event=>{if(this.modeOpen && !event.target.closest('.date-condition-picker,.date-condition-options'))this.toggleModes(false);if(this.optionInput && !event.target.closest('.date-segment-wrap,.date-options'))this.closeOptions();});
    }
    get open(){return !this.element.hidden;}
    show(){this.closeOptions();this.stopPosition();this.draft={...this.applied};this.values={start:split(this.draft.start),end:split(this.draft.end)};this.tried=false;this.modeOpen=false;this.element.hidden=false;this.render();this.segment('start','day')?.focus({preventScroll:true});}
    close(restoreFocus=true){this.closeOptions();this.stopPosition();this.modeOpen=false;this.element.hidden=true;this.onClose?.(restoreFocus);}
    reset(){this.closeOptions();this.stopPosition();this.applied={mode:'Between',start:'',end:''};this.draft={...this.applied};this.values={start:split(''),end:split('')};this.tried=false;this.modeOpen=false;this.onChange({from:'',to:''},'');this.render();if(this.open)this.segment('start','day')?.focus({preventScroll:true});}
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
    toggleModes(open=!this.modeOpen){if(open)this.closeOptions();else if(this.positionMenu===this.modeMenu)this.stopPosition();this.modeOpen=open;this.modeMenu.hidden=!open;this.modeButton.setAttribute('aria-expanded',String(open));if(open){this.watchPosition(this.modeMenu,this.modeButton);this.modeMenu.querySelector('[aria-selected="true"]')?.focus({preventScroll:true});}}
    setMode(mode){if(!modes.includes(mode))return;this.closeOptions();this.stopPosition();this.draft.mode=mode;this.modeOpen=false;this.tried=false;this.render();this.segment('start','day')?.focus({preventScroll:true});}
    update(){
      this.draft.start=this.read('start');this.draft.end=this.read('end');let error='';
      for(const bound of this.draft.mode==='Between'?['start','end']:['start']){
        const value=this.values[bound],complete=Boolean(value.day && value.month && value.year.length===4),invalid=complete && !this.draft[bound];
        for(const part of parts){const input=this.segment(bound,part);if(!input)continue;const number=Number(value[part]),max=this.limit(bound,part),bad=Boolean(this.tried && part==='month' && input.value && !value[part] || value[part] && (number>max || number<1 && value[part].length===(part==='month'?2:input.maxLength) || invalid));
          input.setAttribute('aria-invalid',String(bad));
        }
        if(invalid)error='Enter a valid date (DD / MM / YYYY).';
      }
      if(this.draft.mode==='Between' && this.draft.start && this.draft.end && this.draft.end<this.draft.start){error='End date must be on or after start date.';for(const input of this.element.querySelectorAll('input[data-bound="end"]'))input.setAttribute('aria-invalid','true');}
      if(!error && this.draft.start && this.draft.mode!=='Between' && !this.bounds())error='Choose a date between years 0001 and 9999.';
      if(!error && this.tried && !this.bounds())error=this.draft.mode==='Between'?'Enter both dates (DD / MM / YYYY).':'Enter a complete date (DD / MM / YYYY).';
      this.error.textContent=error;this.error.hidden=!error;this.applyButton.disabled=!this.bounds();
    }
    display(bound,part){const value=this.values[bound][part];return part==='month' && Number(value)>=1 && Number(value)<=12?shortMonths[Number(value)-1]:value;}
    monthValue(text){const query=fold(text);if(/^\d{1,2}$/.test(query))return query;const matches=months.map((name,i)=>({value:String(i+1).padStart(2,'0'),names:[name,englishMonths[i],shortMonths[i]]})).filter(item=>query && item.names.some(name=>fold(name).startsWith(query)));return matches.length===1?matches[0].value:'';}
    normalize(input){const {bound,part}=input.dataset,value=this.values[bound][part],number=Number(value);if(value && (part!=='year' || value.length===4) && number>=1 && number<=this.limit(bound,part))this.values[bound][part]=String(number).padStart(part==='year'?4:2,'0');if(this.values[bound][part])input.value=this.display(bound,part);this.update();}
    options(input,query=''){
      const {bound,part}=input.dataset,q=fold(query);let values;
      if(part==='month')return months.map((name,i)=>({value:String(i+1).padStart(2,'0'),label:name,detail:String(i+1).padStart(2,'0')})).filter((item,i)=>!q || [item.label,englishMonths[i],shortMonths[i],item.value,String(i+1)].some(value=>fold(value).startsWith(q)));
      if(part==='day')values=Array.from({length:this.limit(bound,part)},(_,i)=>i+1);
      else {const now=new Date().getFullYear();if(!q)values=Array.from({length:101},(_,i)=>now+1-i).filter(year=>year>=1 && year<=9999);else if(/^\d{1,4}$/.test(q)){const span=10**(4-q.length),start=Number(q)*span;values=Array.from({length:span},(_,i)=>start+i).filter(year=>year>=1 && year<=9999).sort((a,b)=>Math.abs(a-now)-Math.abs(b-now)||b-a);}else values=[];}
      return values.map(value=>({value:String(value).padStart(part==='year'?4:2,'0'),label:String(value).padStart(part==='year'?4:2,'0')})).filter(item=>!q || item.value.startsWith(q) || part==='day' && String(Number(item.value)).startsWith(q)).slice(0,101);
    }
    closeOptions(){if(this.optionInput){this.optionInput.setAttribute('aria-expanded','false');this.optionInput.removeAttribute('aria-activedescendant');}this.optionInput=null;if(this.optionsMenu)this.optionsMenu.hidden=true;if(this.positionMenu===this.optionsMenu)this.stopPosition();}
    openOptions(input,query=''){
      if(this.modeOpen)this.toggleModes(false);if(this.optionInput!==input)this.closeOptions();this.optionInput=input;this.optionChoices=this.options(input,query);const selected=this.optionChoices.findIndex(item=>Number(item.value)===Number(this.values[input.dataset.bound][input.dataset.part]));this.optionIndex=selected<0?0:selected;
      this.optionsMenu.replaceChildren();this.optionsMenu.setAttribute('aria-label',input.getAttribute('aria-label')+' options');
      for(const [i,item]of this.optionChoices.entries()){const option=make('button','date-option');option.type='button';option.tabIndex=-1;option.id=this.id+'-option-'+i;option.dataset.value=item.value;option.setAttribute('role','option');option.setAttribute('aria-selected',String(i===selected));option.append(make('span','',item.label));if(item.detail){const detail=make('small','date-option-detail',item.detail);detail.setAttribute('aria-hidden','true');option.append(detail);}option.addEventListener('pointerdown',event=>event.preventDefault());option.addEventListener('click',()=>this.chooseOption(i));this.optionsMenu.append(option);}
      if(!this.optionChoices.length)this.optionsMenu.append(make('p','date-option-empty','No matching '+input.dataset.part));
      this.optionsMenu.hidden=false;input.setAttribute('aria-expanded','true');this.watchPosition(this.optionsMenu,input.closest('.date-segment-wrap'));this.highlightOption();
    }
    highlightOption(){const options=[...this.optionsMenu.querySelectorAll('[role=option]')];for(const [i,option]of options.entries())option.classList.toggle('active',i===this.optionIndex);const active=options[this.optionIndex];if(!active){this.optionInput?.removeAttribute('aria-activedescendant');return;}this.optionInput.setAttribute('aria-activedescendant',active.id);const top=active.offsetTop,bottom=top+active.offsetHeight;if(top<this.optionsMenu.scrollTop)this.optionsMenu.scrollTop=top;else if(bottom>this.optionsMenu.scrollTop+this.optionsMenu.clientHeight)this.optionsMenu.scrollTop=Math.max(0,bottom-this.optionsMenu.clientHeight);}
    chooseOption(index){const input=this.optionInput,item=this.optionChoices[index];if(!input || !item)return;const {bound,part}=input.dataset;this.values[bound][part]=item.value;
      if(part!=='day' && Number(this.values[bound].day)>this.limit(bound,'day')){this.values[bound].day=String(this.limit(bound,'day')).padStart(2,'0');this.segment(bound,'day').value=this.values[bound].day;}
      input.value=this.display(bound,part);this.closeOptions();this.tried=false;this.update();const all=[...this.element.querySelectorAll('input[data-part]')],next=all[all.indexOf(input)+1];const target=next || input;target.focus({preventScroll:true});target.select();
    }
    stopPosition(){if(this.positionListener){window.removeEventListener('resize',this.positionListener);window.removeEventListener('scroll',this.positionListener,true);}if(this.positionVisual){this.positionVisual.removeEventListener('resize',this.positionListener);this.positionVisual.removeEventListener('scroll',this.positionListener);}this.positionVisual=null;if(this.positionFrame)cancelAnimationFrame(this.positionFrame);this.positionFrame=0;this.positionListener=null;this.positionMenu=null;}
    watchPosition(menu,anchor){this.stopPosition();this.positionMenu=menu;this.positionListener=()=>{if(this.positionFrame)return;this.positionFrame=requestAnimationFrame(()=>{this.positionFrame=0;if(this.open && !menu.hidden)this.placeMenu(menu,anchor);});};window.addEventListener('resize',this.positionListener);window.addEventListener('scroll',this.positionListener,true);this.positionVisual=window.visualViewport;this.positionVisual?.addEventListener('resize',this.positionListener);this.positionVisual?.addEventListener('scroll',this.positionListener);this.placeMenu(menu,anchor);}
    placeMenu(menu,anchor){
      const viewport=window.visualViewport,clip={left:viewport?.offsetLeft || 0,top:viewport?.offsetTop || 0,right:(viewport?.offsetLeft || 0)+(viewport?.width || window.innerWidth),bottom:(viewport?.offsetTop || 0)+(viewport?.height || window.innerHeight)};
      for(let parent=this.element.parentElement || this.element.getRootNode()?.host;parent;parent=parent.parentElement || parent.getRootNode()?.host){const style=getComputedStyle(parent),rect=parent.getBoundingClientRect();if(rect.width && /hidden|clip|auto|scroll/.test(style.overflowX || style.overflow)){clip.left=Math.max(clip.left,rect.left);clip.right=Math.min(clip.right,rect.right);}if(rect.height && /hidden|clip|auto|scroll/.test(style.overflowY || style.overflow)){clip.top=Math.max(clip.top,rect.top);clip.bottom=Math.min(clip.bottom,rect.bottom);}}
      const root=this.element.getBoundingClientRect(),rect=anchor.getBoundingClientRect(),sx=root.width/this.element.offsetWidth || 1,sy=root.height/this.element.offsetHeight || 1,gap=4*sy,bottom=Math.max(0,clip.bottom-rect.bottom-gap-6),top=Math.max(0,rect.top-clip.top-gap-6),up=bottom/sy<Math.min(180,menu.children.length*28+8) && top>bottom,available=up?top:bottom;
      const desired=menu===this.modeMenu?112:this.optionInput?.dataset.part==='month'?164:this.optionInput?.dataset.part==='year'?112:80,width=Math.min(Math.max(rect.width/sx,desired),Math.max(0,(clip.right-clip.left-12)/sx));menu.style.width=width+'px';menu.style.maxHeight=Math.max(0,Math.min(180,available/sy))+'px';menu.dataset.side=up?'above':'below';
      const height=menu.getBoundingClientRect().height/sy || Math.min(180,available/sy,menu.children.length*28+8),left=Math.max(clip.left+6,Math.min(rect.left,clip.right-6-width*sx));menu.style.left=((left-root.left)/sx-this.element.clientLeft)+'px';menu.style.right='auto';menu.style.top=((up?rect.top-root.top-gap:rect.bottom-root.top+gap)/sy-(up?height:0)-this.element.clientTop)+'px';
    }
    keydown(event){
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(this.optionInput)this.closeOptions();else if(this.modeOpen){this.toggleModes(false);this.modeButton.focus({preventScroll:true});}else this.close();return;}
      if(event.ctrlKey || event.metaKey || event.isComposing)return;
      if(this.modeOpen && ['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();event.stopPropagation();const options=[...this.modeMenu.children],at=options.indexOf(event.target);options[event.key==='Home'?0:event.key==='End'?options.length-1:(at+(event.key==='ArrowDown'?1:-1)+options.length)%options.length]?.focus({preventScroll:true});return;}
      if(event.target===this.modeButton && ['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();event.stopPropagation();this.toggleModes(true);return;}
      const input=event.target.closest('input[data-part]');if(!input)return;
      if(event.key==='Tab'){this.closeOptions();return;}
      if(event.altKey && event.key==='ArrowUp'){event.preventDefault();event.stopPropagation();this.closeOptions();return;}
      if(['ArrowUp','ArrowDown'].includes(event.key) || this.optionInput===input && ['Home','End'].includes(event.key)){event.preventDefault();event.stopPropagation();if(this.optionInput!==input)this.openOptions(input);else if(this.optionChoices.length){this.optionIndex=event.key==='Home'?0:event.key==='End'?this.optionChoices.length-1:(this.optionIndex+(event.key==='ArrowDown'?1:-1)+this.optionChoices.length)%this.optionChoices.length;this.highlightOption();}return;}
      if(event.key==='Enter'){event.preventDefault();event.stopPropagation();if(this.optionInput===input){if(this.optionChoices.length)this.chooseOption(this.optionIndex);}else this.apply();return;}
      if(event.altKey)return;const all=[...this.element.querySelectorAll('input[data-part]')],at=all.indexOf(input),selected=input.selectionStart===0 && input.selectionEnd===input.value.length;
      if(event.key==='ArrowRight' && (selected || input.selectionStart===input.value.length) || event.key==='ArrowLeft' && (selected || input.selectionStart===0) || event.key==='Backspace' && !input.value){const next=all[at+(event.key==='ArrowRight'?1:-1)];if(next){event.preventDefault();event.stopPropagation();this.closeOptions();this.normalize(input);next.focus({preventScroll:true});}}
    }
    field(bound,label){
      const row=make('div','date-field-row'),name=make('span','date-field-label',label),group=make('div','date-segments');group.setAttribute('role','group');group.setAttribute('aria-label',bound==='end'?'End date':this.draft.mode==='Between'?'Start date':'Date');row.append(name,group);
      for(const part of parts){
        const wrap=make('span','date-segment-wrap '+part),input=make('input','date-segment '+part);input.type='text';input.inputMode=part==='month'?'text':'numeric';input.autocomplete='off';input.spellcheck=false;input.maxLength=part==='year'?4:part==='month'?12:2;input.placeholder={day:'DD',month:'Month',year:'YYYY'}[part];input.value=this.display(bound,part);input.dataset.bound=bound;input.dataset.part=part;
        input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-haspopup','listbox');input.setAttribute('aria-expanded','false');input.setAttribute('aria-controls',this.id+'-options');input.setAttribute('aria-label',`${bound==='end'?'End':this.draft.mode==='Between'?'Start':'Date'} ${part}`);input.setAttribute('aria-describedby',this.id+'-hint '+this.id+'-error');
        input.addEventListener('focus',()=>input.select());input.addEventListener('click',()=>{input.select();this.openOptions(input);});input.addEventListener('blur',()=>{this.normalize(input);if(this.optionInput===input)this.closeOptions();});
        input.addEventListener('input',()=>{if(part!=='month')input.value=input.value.replace(/\D/g,'').slice(0,input.maxLength);this.values[bound][part]=part==='month'?this.monthValue(input.value):input.value;this.tried=false;this.update();this.openOptions(input,input.value);});
        input.addEventListener('paste',event=>{const text=event.clipboardData?.getData('text/plain')?.trim() || '';let value;if(/^\d{4}-\d{2}-\d{2}$/.test(text))value=text;else {const match=text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);if(match)value=match[3]+'-'+match[2].padStart(2,'0')+'-'+match[1].padStart(2,'0');}if(!value)return;event.preventDefault();this.closeOptions();const [year,month,day]=value.split('-');this.values[bound]={day,month,year};for(const field of parts)this.segment(bound,field).value=this.display(bound,field);this.update();this.segment(bound,'year').focus({preventScroll:true});});
        const toggle=make('button','date-segment-toggle');toggle.type='button';toggle.tabIndex=-1;toggle.setAttribute('aria-label','Choose '+input.getAttribute('aria-label').toLocaleLowerCase());toggle.addEventListener('pointerdown',event=>event.preventDefault());toggle.addEventListener('click',()=>{if(this.optionInput===input)this.closeOptions();else {input.focus({preventScroll:true});this.openOptions(input);}});wrap.append(input,toggle);group.append(wrap);
      }
      return row;
    }
    render(){
      this.closeOptions();this.stopPosition();const root=this.element;root.replaceChildren();const header=make('div','date-header'),title=make('span','date-title','Date filter'),condition=make('div','date-condition-picker');
      this.modeButton=make('button','date-condition',this.draft.mode);this.modeButton.type='button';this.modeButton.setAttribute('aria-label','Date condition: '+this.draft.mode);this.modeButton.setAttribute('aria-haspopup','listbox');this.modeButton.setAttribute('aria-expanded','false');this.modeButton.setAttribute('aria-controls',this.id+'-modes');this.modeButton.addEventListener('click',()=>this.toggleModes());
      this.modeMenu=make('div','date-condition-options');this.modeMenu.id=this.id+'-modes';this.modeMenu.hidden=true;this.modeMenu.setAttribute('role','listbox');this.modeMenu.setAttribute('aria-label','Date condition');
      for(const mode of modes){const option=make('button','date-mode',mode);option.type='button';option.dataset.mode=mode;option.setAttribute('role','option');option.setAttribute('aria-selected',String(mode===this.draft.mode));option.addEventListener('click',()=>this.setMode(mode));this.modeMenu.append(option);}
      condition.append(this.modeButton);header.append(title,condition);root.append(header,this.modeMenu,this.field('start',this.draft.mode==='Between'?'From':'Date'));if(this.draft.mode==='Between')root.append(this.field('end','To'));
      this.optionsMenu=make('div','date-options');this.optionsMenu.id=this.id+'-options';this.optionsMenu.hidden=true;this.optionsMenu.setAttribute('role','listbox');root.append(this.optionsMenu);
      const hint=make('span','date-sr-only','Type to filter day, month or year, or open their dropdowns. Arrow keys browse options; Enter selects. Enter with a closed dropdown applies; Escape closes the dropdown before cancelling the draft.');hint.id=this.id+'-hint';this.error=make('p','date-error');this.error.id=this.id+'-error';this.error.setAttribute('role','status');this.error.setAttribute('aria-live','polite');
      const actions=make('div','calendar-actions'),clear=make('button','calendar-clear','Clear');clear.type='button';clear.addEventListener('click',()=>this.reset());this.applyButton=make('button','calendar-apply','Apply');this.applyButton.type='button';this.applyButton.addEventListener('click',()=>this.apply());actions.append(clear,this.applyButton);root.append(hint,this.error,actions);this.update();
    }
  }
  DatePicker.styles=`
    .date-popover { position:absolute;top:calc(100% + 6px);right:8px;z-index:9;box-sizing:border-box;width:272px;max-width:calc(100% - 16px);padding:10px;background:var(--rcs-bg);color:var(--rcs-text);border:1px solid var(--rcs-line);border-radius:12px;box-shadow:0 6px 20px #0002;font-size:12px; }
    .date-popover [hidden] { display:none!important; }
    .date-header { display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px; }
    .date-title { color:var(--rcs-muted);font-size:11px; }
    .date-condition { display:flex;align-items:center;gap:8px;min-height:26px;border:0;border-radius:7px;padding:4px 8px;background:var(--rcs-soft);color:var(--rcs-text);font:inherit;cursor:pointer; }
    .date-condition::after,.date-segment-toggle::after { content:'';display:block;width:5px;height:5px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(45deg);margin-top:-3px; }
    .date-condition[aria-expanded=true]::after,.date-segment-wrap:has(input[aria-expanded=true]) .date-segment-toggle::after { transform:rotate(225deg);margin-top:3px; }
    .date-condition[aria-expanded=true] { box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--rcs-accent) 45%,var(--rcs-line)); }
    .date-condition-options,.date-options { position:absolute;z-index:3;box-sizing:border-box;padding:4px;background:var(--rcs-bg);color:var(--rcs-text);border:1px solid var(--rcs-line);border-radius:9px;box-shadow:0 5px 18px #0002;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:var(--rcs-line) transparent; }
    .date-condition-options[data-side=above],.date-options[data-side=above] { box-shadow:0 -4px 16px #0002; }
    .date-mode,.date-option { display:flex;align-items:center;justify-content:space-between;gap:8px;box-sizing:border-box;width:100%;min-height:28px;padding:5px 8px;border:0;border-radius:5px;text-align:left;background:transparent;color:var(--rcs-text);font:inherit;line-height:18px;cursor:pointer;white-space:nowrap; }
    .date-mode[aria-selected=true],.date-option[aria-selected=true] { background:color-mix(in srgb,var(--rcs-accent) 8%,var(--rcs-bg));box-shadow:inset 2px 0 0 var(--rcs-accent); }
    .date-mode:hover,.date-option:hover,.date-option.active,.date-condition:hover,.calendar-clear:hover { background:var(--rcs-hover); }
    .date-option-detail { color:var(--rcs-muted);font-size:10px;font-variant-numeric:tabular-nums; }
    .date-option-empty { margin:0;padding:8px;color:var(--rcs-muted);font-size:11px; }
    .date-field-row { display:flex;align-items:center;gap:6px;margin-bottom:7px; }
    .date-field-label { flex:0 0 26px;color:var(--rcs-muted);font-size:11px; }
    .date-segments { display:grid;grid-template-columns:44px minmax(55px,1fr) 67px;flex:1;min-width:0;gap:4px; }
    .date-segment-wrap { display:flex;align-items:center;min-width:0;background:var(--rcs-soft);border:1px solid transparent;border-radius:7px; }
    .date-segment-wrap:focus-within { border-color:color-mix(in srgb,var(--rcs-accent) 55%,var(--rcs-line));background:color-mix(in srgb,var(--rcs-accent) 4%,var(--rcs-bg)); }
    .date-segment { box-sizing:border-box;min-width:0;width:100%;height:29px;padding:0 0 0 7px;border:0;border-radius:7px;background:transparent;color:var(--rcs-text);font:inherit;font-size:11px;font-variant-numeric:tabular-nums;text-align:left;outline:0; }
    .date-segment-toggle { display:flex;align-items:center;justify-content:center;flex:0 0 16px;width:16px;height:27px;padding:0;border:0;border-radius:0 6px 6px 0;background:transparent;color:var(--rcs-muted);cursor:pointer; }
    .date-segment-toggle:hover { color:var(--rcs-accent); }
    .date-segment::placeholder { color:var(--rcs-muted);opacity:1; }
    .date-segment::selection { background:color-mix(in srgb,var(--rcs-accent) 25%,var(--rcs-bg));color:var(--rcs-text); }
    .date-segment[aria-invalid=true] { text-decoration:underline wavy var(--rcs-accent);text-underline-offset:3px; }
    .date-error { margin:4px 0 7px;color:var(--rcs-muted);font-size:10px;line-height:1.4; }
    .date-sr-only { position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0; }
    .calendar-actions { display:flex;justify-content:space-between;gap:8px;border-top:1px solid var(--rcs-line);padding-top:7px;margin-top:3px; }
    .calendar-clear,.calendar-apply { border:0;border-radius:999px;font:inherit;font-size:11px;min-height:26px;padding:4px 12px;cursor:pointer; }
    .calendar-clear { background:var(--rcs-soft);color:var(--rcs-text); }.calendar-apply { background:var(--rcs-accent);color:#1a1a1b;font-weight:600; }.calendar-apply:disabled { opacity:.4;cursor:default; }
    .calendar-apply:hover:not(:disabled) { filter:brightness(.95); }
    .date-condition:focus-visible,.date-mode:focus-visible,.calendar-clear:focus-visible,.calendar-apply:focus-visible { outline:1px solid var(--rcs-accent);outline-offset:1px; }
    :host([data-rcs-compact]) .date-popover { right:6px;width:260px;max-width:calc(100% - 12px);padding:8px;top:calc(100% + 3px);border-radius:10px; }
  `;
  globalThis.RCSDatePicker=DatePicker;
})();
