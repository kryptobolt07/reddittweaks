(() => {
  if (globalThis.__rcsStarted) return;
  globalThis.__rcsStarted = true;
  const A = globalThis.RCSAdapter;
  const C = globalThis.RCSCore;
  const index = new C.MessageIndex(Infinity,room=>completeRooms.delete(room));
  const directory = new Map();
  for(const record of globalThis.RCSDirectory?.getStartup?.().entry?.records || [])directory.set(record.id,record);
  let directoryComplete = Boolean(globalThis.RCSDirectory?.getStartup?.().entry?.directoryComplete);
  const completeRooms = new Set();
  const controls = new Map();
  const observed = new Map();
  let scheduled = false;
  let stopped = false;
  let collapsedControl = null;
  let openListRequested = false;
  const icons = {
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    up: '<path d="m6 14 6-6 6 6"/>',
    down: '<path d="m6 10 6 6 6-6"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4M17 3v4M3 11h18M8 15h2M14 15h2"/>',
    person: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>'
  };
  const css = `
    :host { display:block; position:relative; z-index:1; isolation:isolate; flex-shrink:0; min-width:0;
      color:var(--color-neutral-content-strong,#0f1a1c); font:14px/1.4 var(--font-sans, -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif);
      --rcs-bg:var(--color-neutral-background,#fff); --rcs-soft:var(--color-neutral-background-weak,#f2f4f5);
      --rcs-text:var(--color-neutral-content-strong,#0f1a1c); --rcs-muted:var(--color-neutral-content-weak,#576f76);
      --rcs-line:var(--color-neutral-border-weak,#e5e8eb); --rcs-hover:var(--color-neutral-background-hover,#e8edef);
      --rcs-accent:var(--color-brand-background,#d93900); }
    :host([hidden]) { display:none!important; } * { box-sizing:border-box; } [hidden] { display:none!important; }
    button,input { font:inherit; } button { cursor:pointer; } svg { width:18px; height:18px; fill:none; stroke:currentColor; stroke-width:1.8; flex:none; }
    .bar { display:flex; gap:6px; align-items:center; padding:8px 12px; background:var(--rcs-bg); }
    .field { display:flex; flex:1; min-width:0; gap:8px; align-items:center; background:var(--rcs-soft); border-radius:20px; padding:0 10px; height:40px; color:var(--rcs-muted); border:1px solid transparent; }
    .field:focus-within { border-color:var(--rcs-muted); } input { width:100%; min-width:0; border:0; outline:0; background:transparent; color:var(--rcs-text); font-size:12px; height:36px; }
    input::placeholder { color:var(--rcs-muted); opacity:1; } input::-webkit-search-cancel-button { display:none; }
    .icon { display:grid; place-items:center; padding:0; width:28px; height:28px; border:0; border-radius:50%; background:transparent; color:var(--rcs-muted); flex:none; }
    .icon:hover,.toggle:hover,.load:hover { background:var(--rcs-hover); } button:focus-visible,a:focus-visible { outline:2px solid var(--rcs-accent); outline-offset:2px; }
    .icon:disabled { opacity:.35; cursor:default; } .toggle { display:flex; align-items:center; gap:7px; margin:5px 12px; padding:6px 10px; border:0; border-radius:20px; background:transparent; color:var(--rcs-muted); font-size:12px; }
    .panel { position:absolute; top:100%; left:0; right:0; background:var(--rcs-bg); border-bottom:1px solid var(--rcs-line); box-shadow:0 8px 16px #00000010; }
    .scope { display:flex;gap:3px;padding:0 12px 6px;background:var(--rcs-bg); }
    .scope button { border:0;border-radius:999px;padding:3px 10px;font-size:11px;color:var(--rcs-muted);background:transparent; }
    .scope button[aria-pressed=true] { color:var(--rcs-text);background:var(--rcs-soft);font-weight:600; }
    :host([data-rcs-compact]) .scope { padding:0 6px 4px; }
    .conversation-panel .message-heading { display:block; }
    .conversation-panel .message-heading .time { overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
    .conversation-panel .preview { font-size:12px;-webkit-line-clamp:2; }
    .coverage { padding:5px 10px;color:var(--rcs-muted);font-size:10px;border-bottom:1px solid var(--rcs-line); }
    .conversation-panel { height:var(--rcs-list-height,320px); display:flex; flex-direction:column; }
    .conversation-panel .results { max-height:none; flex:1; min-height:0; }
    .meta { padding:3px 9px; display:flex; align-items:center; justify-content:space-between; gap:6px; color:var(--rcs-muted); font-size:10px; border-bottom:1px solid var(--rcs-line); }
    .meta [role=status] { flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
    .load,.date-chip { display:inline-flex;align-items:center;justify-content:center;gap:5px;min-height:26px;font-size:11px;font-weight:600;color:var(--rcs-text);border:1px solid var(--rcs-line);border-radius:999px;padding:4px 10px;background:var(--rcs-soft);white-space:nowrap;flex-shrink:0; }
    .results { max-height:min(360px,50vh); overflow:auto; overscroll-behavior:contain; padding:4px 0; }
    .result { display:flex; align-items:center; gap:10px; width:100%; text-align:left; padding:11px 14px; color:var(--rcs-text); background:transparent; border:0; border-left:0; text-decoration:none; }
    .result:hover,.result.active { background:var(--rcs-soft); }
    .avatar { position:relative;display:grid; place-items:center; width:32px; height:32px; border-radius:50%; color:var(--rcs-muted); background:var(--rcs-soft); font-weight:600; flex:none; overflow:hidden; }
    .avatar img { position:absolute;inset:0;width:100%; height:100%; object-fit:cover; }
    .copy { min-width:0; flex:1; } .name { display:block; font-size:13px; font-weight:600; } .preview { display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; margin-top:4px; font-size:13px; overflow-wrap:anywhere; }
    .time { display:block; color:var(--rcs-muted); font-size:11px; font-weight:400; margin-top:2px; } .hint,.empty { color:var(--rcs-muted); padding:20px 16px; font-size:12px; text-align:center; }
    mark { background:#ffcc804d; color:inherit; border-radius:2px; } .count { font-size:11px; color:var(--rcs-muted); white-space:nowrap; }
    :host([data-rcs-ui=messages]) .bar { width:100%;padding:6px 8px;gap:4px; }
    :host([data-rcs-ui=messages]) .field { height:40px; }
    :host([data-rcs-ui=messages]) input { height:36px;font-size:12px; }
    .date-chip { max-width:52%;color:var(--rcs-accent);background:color-mix(in srgb,var(--rcs-accent) 8%,var(--rcs-bg));border-color:color-mix(in srgb,var(--rcs-accent) 20%,var(--rcs-line)); }
    .date-chip { padding:0 3px 0 8px;gap:2px; }
    .date-chip-edit { border:0;padding:4px 0;min-width:0;background:transparent;color:inherit;font:inherit;overflow:hidden;text-overflow:ellipsis; }
    .date-chip .date-remove { width:20px;height:20px;color:inherit; }
    .date-chip .date-remove svg { width:12px;height:12px; }
    .date-chip:hover { background:color-mix(in srgb,var(--rcs-accent) 14%,var(--rcs-bg)); }
    .icon.filtered { background:var(--rcs-hover);color:var(--rcs-accent); }
    .message-panel { width:min(480px,calc(100% - 16px));left:50%;right:auto;transform:translateX(-50%);margin-top:6px;border:1px solid var(--rcs-line);border-radius:12px;overflow:hidden; }
    .message-panel .result { gap:7px;padding:7px 9px;align-items:start; }
    .message-panel .results { max-height:min(320px,var(--rcs-message-height,42vh)); }
    .message-panel .avatar { width:24px;height:24px;margin-top:1px;font-size:11px; }
    .message-panel .avatar svg { width:15px;height:15px; }
    .message-heading { display:flex;align-items:baseline;gap:8px;min-width:0; }
    .message-heading .name { flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px; }
    .message-heading .time { margin:0;white-space:nowrap;font-size:10px; }
    .you-prefix { font-weight:400; }
    .message-panel .preview { -webkit-line-clamp:2;font-size:12px;line-height:1.45;margin-top:2px; }
    :host([data-rcs-compact]) .bar { padding:4px 6px;gap:2px; }
    :host([data-rcs-compact]) .field { height:40px;gap:4px;padding:0 7px; }
    :host([data-rcs-compact]) input { height:36px;font-size:12px; }
    :host([data-rcs-compact]) .icon { width:24px;height:24px; }
    :host([data-rcs-compact]) svg { width:16px;height:16px; }
    :host([data-rcs-compact]) .toggle { margin:3px 6px;padding:4px 7px; }
    :host([data-rcs-compact]) .count { font-size:10px; }
    :host([data-rcs-compact]) .meta { padding:5px 8px;font-size:10px;gap:4px; }
    :host([data-rcs-compact]) .result { padding:7px 8px;gap:7px; }
    :host([data-rcs-compact]) .avatar { width:26px;height:26px; }
    :host([data-rcs-compact]) .name { font-size:12px; }
    :host([data-rcs-compact]) .message-panel { width:min(320px,calc(100% - 12px));margin-top:3px;border-radius:9px; }
    :host([data-rcs-compact]) .message-panel .results { max-height:min(210px,var(--rcs-message-height,42vh)); }
    :host([data-rcs-compact]) .message-panel .avatar { width:22px;height:22px; }
    :host([data-rcs-compact]) .message-panel .preview { font-size:11px; }
    :host([data-rcs-compact]) .date-chip,:host([data-rcs-compact]) .load { min-height:24px;font-size:10px; }
    :host([data-rcs-compact]) .load { padding:3px 7px; }
    :host([data-rcs-compact]) .date-chip { padding:0 2px 0 7px; }
    :host([data-rcs-compact]) .date-chip .date-remove { width:20px;height:20px; }
    :host([data-rcs-ui=minimized-search]) .icon { width:24px;height:24px; }
    :host([data-rcs-ui=minimized-search]) svg { width:16px;height:16px; }
    @media(prefers-color-scheme:dark) { :host { --rcs-bg:var(--color-neutral-background,#0e1113); --rcs-soft:var(--color-neutral-background-weak,#181c1f); --rcs-text:var(--color-neutral-content-strong,#eef1f3); --rcs-muted:var(--color-neutral-content-weak,#a0b0b5); --rcs-line:var(--color-neutral-border-weak,#30383c); --rcs-hover:var(--color-neutral-background-hover,#2a3236); } }
    @media(prefers-reduced-motion:no-preference) { .result,.icon { transition:background 100ms; } }
  `;
  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function icon(name, label, handler) {
    const button = node('button', 'icon'); button.type = 'button';
    button.title = label; button.setAttribute('aria-label', label);
    // Static icons only; message text is always inserted with textContent.
    button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`;
    button.addEventListener('click', handler);
    return button;
  }
  function highlight(text, query, options={}) {
    const fragment = document.createDocumentFragment();
    let offset = 0;
    for (const [start, end] of (C.highlightRanges?.(text,query,options) || C.ranges(text, query))) {
      fragment.append(document.createTextNode(text.slice(offset, start)), node('mark', '', text.slice(start, end)));
      offset = end;
    }
    fragment.append(document.createTextNode(text.slice(offset)));
    return fragment;
  }
  class SearchControl {
    constructor(container, kind) {
      if(kind==='list' && globalThis.RCSUnifiedSearch)return new RCSUnifiedSearch(container,{cache:directory,adapter:A,version:'0.5.1'});
      this.container = container; this.kind = kind; this.room = ''; this.cache = directory; this.active = -1; this.hits = []; this.loading = false;
      this.complete = kind === 'list' && directoryComplete;
      this.rows = new Map();
      this.browseOpen=false;this.renderLimit=50;this.lastQuery=undefined;this.scope='people';this.savedHits=[];this.savedTotal=0;this.savedGeneration=0;this.savedOwner=undefined;this.savedLoading=false;
      this.pendingAvatarSources=new Map();
      this.host = node('div'); this.host.setAttribute('data-rcs-ui', kind);
      this.host.setAttribute('data-rcs-version','0.5.1');
      const shadow = this.host.attachShadow({mode:'open'});
      const style = node('style', '', css); shadow.append(style);
      this.toggle = node('button', 'toggle', 'Search messages'); this.toggle.type = 'button';
      this.toggle.prepend(icon('search', 'Search this conversation', () => this.open()));
      // Avoid a nested button in the toggle.
      this.toggle.firstChild.replaceWith(this.toggle.firstChild.firstChild);
      this.toggle.setAttribute('aria-expanded', 'false'); this.toggle.addEventListener('click', () => this.open());
      this.bar = node('div', 'bar');
      const field = node('label', 'field');
      const searchIcon = icon('search', 'Search', () => {this.input.focus();this.showResults();});
      searchIcon.tabIndex = -1;
      this.input = node('input'); this.input.type = 'search'; this.input.autocomplete = 'off'; this.input.spellcheck = false;
      const label = kind === 'list' ? 'Search usernames' : 'Search messages';
      this.input.placeholder = label; this.input.setAttribute('aria-label', label);
      this.input.setAttribute('aria-controls', 'rcs-results'); this.input.setAttribute('aria-expanded', 'false');
      this.clear = icon('close', 'Clear search', () => { this.input.value = '';if(this.kind==='messages' && !this.dates?.from && !this.dates?.to)this.cancelLoad(); this.render();if(this.isGlobal)this.ensureData();this.input.focus(); }); this.clear.hidden = true;
      field.append(searchIcon, this.input, this.clear); this.bar.append(field);
      if (kind === 'messages' || kind === 'list') {
        this.dates={from:'',to:''};
        this.datePicker=new RCSDatePicker({
          onChange:(dates,label)=>{this.dates=dates;this.dateLabel=label;this.dateCompleteKey='';this.active=-1;this.dataTask?.setDates?.(dates);this.render();if(!this.bar.hidden)this.ensureData();},
          onClose:restoreFocus=>{this.dateToggle.setAttribute('aria-expanded','false');this.render();if(restoreFocus)this.dateToggle.focus({preventScroll:true});}
        });
        this.dateToggle=icon('calendar','Filter by date',()=>{
          if(this.datePicker.open)this.datePicker.close();else{this.datePicker.show();this.dateToggle.setAttribute('aria-expanded','true');this.render();}
        });
        this.dateToggle.setAttribute('aria-expanded','false');
        this.count=node('span','count');
        this.prev=icon('up','Previous match',()=>this.move(-1,true));this.next=icon('down','Next match',()=>this.move(1,true));
        this.bar.append(this.dateToggle);if(kind==='messages')this.bar.append(this.count,this.prev,this.next,icon('close','Close message search',()=>this.close()));else this.dateToggle.hidden=true;
        this.dateChip=node('span','date-chip');this.dateChip.hidden=true;
        this.dateChipLabel=node('button','date-chip-edit');this.dateChipLabel.type='button';this.dateChipLabel.addEventListener('click',()=>this.dateToggle.click());
        this.dateRemove=icon('close','Remove date filter',()=>{this.datePicker.reset();this.render();this.dateToggle.focus({preventScroll:true});});this.dateRemove.classList.add('date-remove');this.dateChip.append(this.dateChipLabel,this.dateRemove);
      }
      this.panel = node('section', 'panel'); this.panel.setAttribute('aria-label', `${label} results`);
      const meta = node('div', 'meta'); this.status = node('span'); this.status.setAttribute('role', 'status'); this.status.setAttribute('aria-live','polite'); meta.append(this.status);
      this.load = node('button', 'load', 'Refresh'); this.load.type = 'button';
      this.load.addEventListener('click', () => this.loading ? this.cancelLoad(true) : this.ensureData(true));if(this.dateChip)meta.append(this.dateChip);meta.append(this.load);
      if (kind === 'list') this.panel.classList.add('conversation-panel');
      else this.panel.classList.add('message-panel');
      this.results = node('div', 'results'); this.results.id = 'rcs-results';
      this.coverage=node('div','coverage','Saved messages only · History may be incomplete');this.coverage.hidden=true;
      this.panel.append(meta,this.coverage,this.results); shadow.append(this.toggle,this.bar);
      if(kind==='list'){this.scopeBar=node('div','scope');this.scopeBar.setAttribute('aria-label','Search scope');for(const [value,label] of [['people','People'],['all','All chats']]){const button=node('button','',label);button.type='button';button.dataset.scope=value;button.setAttribute('aria-pressed',String(value===this.scope));button.addEventListener('click',()=>this.setScope(value));this.scopeBar.append(button);}shadow.append(this.scopeBar);}if(this.datePicker)shadow.append(this.datePicker.element,node('style','',RCSDatePicker.styles));shadow.append(this.panel);
      this.toggle.hidden = kind === 'list'; this.bar.hidden = kind === 'messages'; this.panel.hidden = true;
      if (kind === 'messages') {
        const header = A.query(A.selectors.header, container);
        if (header) {
          this.triggerHost = node('span'); this.triggerHost.setAttribute('data-rcs-ui','message-trigger');
          this.triggerHost.style.cssText = 'display:inline-flex;flex-shrink:0;align-items:center;';
          const triggerRoot = this.triggerHost.attachShadow({mode:'open'});
          this.trigger = icon('search','Search messages',() => this.open()); this.trigger.setAttribute('aria-expanded','false');
          triggerRoot.append(node('style','',css),this.trigger);
          const actions = header.lastElementChild;
          (actions?.classList.contains('flex') ? actions : header).prepend(this.triggerHost);
          this.toggle.hidden = true; this.host.hidden = true;
        }
      }
      this.input.addEventListener('input', () => { this.active = -1;if(this.kind==='list')this.browseOpen=true;else if(!this.input.value.trim() && !this.dates?.from && !this.dates?.to)this.cancelLoad();this.render();if(this.kind==='messages' || this.isGlobal)this.ensureData(); });
      this.input.addEventListener('focus', () => this.showResults());
      this.input.addEventListener('click', () => this.showResults());
      if(globalThis.IntersectionObserver)this.avatarObserver=new IntersectionObserver(entries=>{
        for(const entry of entries)if(entry.isIntersecting) {
          const source=this.pendingAvatarSources.get(entry.target);
          if(source && entry.target.isConnected)entry.target.src=source;
          this.pendingAvatarSources.delete(entry.target);this.avatarObserver.unobserve(entry.target);
        }
      },{root:this.results,rootMargin:'100px'});
      this.results.addEventListener('scroll',()=>{
        if(this.renderLimit<this.hits.length && this.results.scrollTop+this.results.clientHeight>=this.results.scrollHeight-160) {
          this.renderLimit+=50;this.render();
        }else if(this.isGlobal && this.savedHasMore && !this.savedLoading && this.results.scrollTop+this.results.clientHeight>=this.results.scrollHeight-160)this.querySaved(true);
      });
      shadow.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
          event.preventDefault();event.stopPropagation();
          if(this.datePicker?.open)this.datePicker.close();
          else if(this.isGlobal)this.input.blur();
          else this.kind === 'list' ? this.dismiss() : this.close();
          return;
        }
        const inResults=this.results.contains(event.target),arrow=['ArrowDown','ArrowUp'].includes(event.key);
        if (!this.panel.hidden && ((arrow && (this.bar.contains(event.target) || inResults)) || event.key==='Enter' && (event.target===this.input || inResults))) {
          event.preventDefault(); event.stopPropagation();
          if (event.key === 'Enter') {
            if (this.active < 0) this.move(1);
            this.activate(this.active);
          } else {this.move(event.key === 'ArrowUp' ? -1 : 1);if(this.results.contains(event.target))this.hits[this.active] && this.rows.get(this.rowKey(this.hits[this.active]))?.result.focus({preventScroll:true});}
        }
      });
      this.outside = event => { if (!event.composedPath().includes(this.host)){if(this.datePicker?.open)this.datePicker.close(false);this.dismiss();} };
      document.addEventListener('pointerdown', this.outside);
      const point = A.mountPoint(container, kind === 'messages' ? A.selectors.header : 'rs-room-list-header');
      point.parent.insertBefore(this.host, point.before);
      if(globalThis.ResizeObserver){this.resizeObserver=new ResizeObserver(()=>{this.updateLayout();if(!this.bar.hidden)this.render();});this.resizeObserver.observe(container);}
      this.savedUnsubscribe=globalThis.RCSMessages?.subscribe(value=>this.savedChanged(value));
      if(kind==='messages')this.tools=globalThis.RCSUnifiedSearch?.decorateMessageControl?.(this,{cache:this.cache,adapter:A});
      this.sync();
      if (kind === 'list') this.ensureData(false,true);
    }
    get isGlobal(){return this.kind==='list' && this.scope==='all';}
    get messageMode(){return this.kind==='messages' || this.isGlobal;}
    rowKey(hit){return `${this.isGlobal ? hit?.roomId : this.room}:${hit?.id}`;}
    setScope(scope){
      if(this.scope===scope){this.showResults();return;}
      this.cancelLoad();this.scope=scope;this.savedKey='';this.active=-1;this.clearRows();this.browseOpen=true;
      const label=this.isGlobal?'Search saved messages':'Search usernames';this.input.placeholder=label;this.input.setAttribute('aria-label',label);this.panel.setAttribute('aria-label',`${label} results`);
      this.dateToggle.hidden=!this.isGlobal;this.coverage.hidden=!this.isGlobal;this.dateChip.hidden=!this.isGlobal;
      for(const button of this.scopeBar.children)button.setAttribute('aria-pressed',String(button.dataset.scope===scope));
      if(!this.isGlobal)this.datePicker.close(false);
      this.render();this.ensureData();this.input.focus();
    }
    resetSaved(){
      this.savedGeneration++;clearTimeout(this.savedTimer);this.savedDirty=false;this.savedKey='';this.savedHits=[];this.savedTotal=0;this.savedHasMore=false;this.savedLoading=false;this.savedStats=undefined;this.savedImporting=false;this.savedSavingError='';this.roomSavedKey='';this.complete=false;this.dateCompleteKey='';this.active=-1;this.hits=[];this.clearRows();
    }
    savedChanged(value){
      const ownerChanged=this.savedOwner!==undefined && this.savedOwner!==value.owner;
      this.savedOwner=value.owner;
      if(ownerChanged || value.cleared){
        index.clear();completeRooms.clear();if(ownerChanged){directory.clear();directoryComplete=false;}
        this.cancelLoad();this.resetSaved();this.input.value='';this.notice='';this.render();
        if(this.isGlobal)this.ensureData();return;
      }
      this.roomSavedKey='';
      if(this.isGlobal){
        if(!value.changed && !value.error && !value.roomIds)return;
        // Captures may arrive faster than the debounce. Keep one query alive,
        // then refresh once for all updates that arrived while it was running.
        if(this.savedLoading){this.savedDirty=true;return;}
        this.savedKey='';if(this.browseOpen)this.querySaved(false,true);
      }
      else if(this.kind==='messages' && !this.bar.hidden && (!value.roomIds || value.roomIds.includes(this.room)))this.readSavedRoom();
    }
    querySaved(more=false,background=false,retryWrites=false){
      if(!this.isGlobal || more && (this.savedLoading || !this.savedHasMore))return;
      const key=JSON.stringify([this.input.value.trim(),this.dates]);
      if(!more && key===this.savedKey)return;
      clearTimeout(this.savedTimer);
      const generation=++this.savedGeneration;this.savedKey=key;
      if(!more && !background){this.savedHits=[];this.savedTotal=0;this.savedHasMore=false;this.active=-1;this.renderLimit=50;}
      const offset=more ? this.savedHits.length : 0;this.savedLoading=true;this.notice='';this.render();
      this.savedTimer=setTimeout(async()=>{
        if(generation!==this.savedGeneration || !this.isGlobal || !this.host.isConnected || !globalThis.document)return;
        try{
          if(!globalThis.RCSMessages)throw Error('Saved message storage is unavailable.');
          const result=await RCSMessages.search({query:this.input.value.trim(),dates:{...this.dates},limit:200,offset,...(retryWrites?{retryWrites:true}:{})});
          if(generation!==this.savedGeneration || !this.isGlobal || !this.host.isConnected)return;
          if(this.savedOwner!==undefined && this.savedOwner!==result.owner){this.resetSaved();this.savedOwner=result.owner;this.ensureData();return;}
          this.savedOwner=result.owner;this.savedHits=more ? [...this.savedHits,...result.records] : result.records;this.savedTotal=result.total;this.savedHasMore=Boolean(result.hasMore);this.savedStats=result.stats;this.savedPersistent=result.persistent;this.savedImporting=result.importing;this.savedSavingError=result.savingError || '';this.savedCaptureIncomplete=result.captureIncomplete;
          if(more)this.renderLimit+=200;
        }catch(error){if(generation===this.savedGeneration)this.notice=error.message;}
        finally{if(generation===this.savedGeneration && this.host.isConnected && globalThis.document){this.savedLoading=false;this.render();if(this.savedDirty){this.savedDirty=false;this.savedKey='';if(this.browseOpen)this.querySaved(false,true);}}}
      },more ? 0 : background && this.savedImporting && !retryWrites ? 500 : 100);
    }
    async readSavedRoom(){
      if(this.kind!=='messages' || !globalThis.RCSMessages)return;
      const room=this.room,generation=this.savedGeneration,key=`${generation}:${room}`;
      if(this.roomSavedKey===key)return this.roomSavedPromise;
      this.roomSavedKey=key;
      this.roomSavedPromise=(async()=>{
        try{
          const result=await RCSMessages.room(room);
          if(generation!==this.savedGeneration || room!==this.room || !this.host.isConnected)return;
          if(this.savedOwner!==undefined && this.savedOwner!==result.owner)return;
          this.savedOwner=result.owner;index.replace(room,result.records,{complete:false});
          // A stored boundary does not prove freshness after an offline gap.
          // Show saved data immediately; native history still verifies current coverage.
          if(!this.panel.hidden)this.render();
        }catch{if(this.roomSavedKey===key)this.roomSavedKey='';}
      })();
      return this.roomSavedPromise;
    }
    open() { this.stoppedByUser=false;this.browseOpen=this.kind==='list';this.host.hidden = false; this.bar.hidden = false; this.toggle.hidden = true; this.toggle.setAttribute('aria-expanded','true'); this.trigger?.setAttribute('aria-expanded','true'); this.ensureData(); this.render(); this.input.focus(); }
    showResults() {this.stoppedByUser=false;if(this.kind==='list')this.browseOpen=true;this.ensureData();this.render();}
    dismiss() {
      // All chats is the selected sidebar view, rather than a transient menu.
      // Keep it mounted when focus moves to the room or a result is opened.
      if(this.isGlobal)return;
      this.browseOpen=false;this.panel.hidden = true; this.input.setAttribute('aria-expanded', 'false');
    }
    close(focus = true) { this.cancelLoad(); this.input.value = '';if(this.datePicker){this.datePicker.element.hidden=true;this.datePicker.applied={mode:'Between',start:'',end:''};this.dates={from:'',to:''};this.dateLabel='';this.dateChip.hidden=true;this.dateToggle.setAttribute('aria-expanded','false');} this.bar.hidden = true; this.toggle.hidden = Boolean(this.trigger); this.host.hidden = Boolean(this.trigger); this.toggle.setAttribute('aria-expanded','false'); this.trigger?.setAttribute('aria-expanded','false'); this.dismiss(); if(focus) (this.trigger || this.toggle).focus(); }
    updateLayout() {
      let compact=false;
      for(let current=this.container;current;current=current.parentElement || current.getRootNode()?.host) {
        if(current.id==='resizable'){compact=true;break;}
      }
      const width=this.container.getBoundingClientRect().width;
      if(this.kind==='messages' && width>0 && width<=440)compact=true;
      this.host.toggleAttribute('data-rcs-compact',compact);
      this.triggerHost?.toggleAttribute('data-rcs-compact',compact);
    }
    sync() {
      this.updateLayout();
      // Hydration can finish after document_idle; align the search bar once the
      // real header and virtual scroller arrive instead of leaving it above Chats.
      const point=A.mountPoint(this.container,this.kind==='messages' ? A.selectors.header : 'rs-room-list-header');
      if(point.before!==this.host && (this.host.parentNode!==point.parent || this.host.nextSibling!==point.before)) point.parent.insertBefore(this.host,point.before);
      A.syncSearchLayer?.(this.container,this.host,this.kind==='messages'?A.selectors.header:'rs-room-list-header, rs-rooms-nav-filter');
      if (this.kind === 'list') {
        if(globalThis.RCSDirectory?.getStartup?.().pending)return;
        for (const row of A.queryAll(A.selectors.row, this.container)) {
          const entry = A.conversation(row);
          if (entry.name && entry.id) {
            const previous=this.cache.get(entry.id);
            this.cache.set(entry.id,{...previous,...entry,name:previous?.participantIds?.length || previous?.historicalName ? previous.name : entry.name,avatar:previous?.avatar || entry.avatar || ''});
          }
        }
      } else {
        const room = A.roomKey(this.container);
        if (this.room !== room) {
          this.cancelLoad(); this.results.replaceChildren();this.rows.clear();this.room = room;this.dateCompleteKey=''; this.input.value = ''; this.active = -1; this.notice = '';
          this.complete = completeRooms.has(room) && index.rooms.has(room);
          if (!this.bar.hidden) this.close(false);
        }
        this.complete=completeRooms.has(this.room) && index.rooms.has(this.room);
        index.upsert(this.room, A.messages(this.container).map(({element, ...message}) => message),{dom:true});
      }
      if ((this.input.value.trim() || this.dates?.from || this.dates?.to) && !this.panel.hidden) this.render();
    }
    render() {
      const query = this.input.value.trim(); this.clear.hidden = !query;this.tools?.sync?.();
      const dates=this.dates || {from:'',to:''},bounds=C.dateBounds(dates),searchKey=JSON.stringify([query,dates]);
      if(searchKey!==this.lastQuery){this.renderLimit=50;this.lastQuery=searchKey;}
      const selected=this.hits[this.active] ? this.rowKey(this.hits[this.active]) : '';
      if(this.dateToggle){this.dateToggle.classList.toggle('filtered',bounds.active);this.dateToggle.setAttribute('aria-pressed',String(bounds.active));this.dateChip.hidden=!bounds.active || this.kind==='list' && !this.isGlobal;this.dateChipLabel.textContent=this.datePicker.compactSummary();this.dateChip.title=this.dateLabel || '';this.dateChipLabel.setAttribute('aria-label',`Edit date filter: ${this.dateLabel || ''}`);}
      if (this.kind === 'list') {
        const available = this.container.getBoundingClientRect().bottom - this.host.getBoundingClientRect().bottom;
        this.host.style.setProperty('--rcs-list-height',`${available > 50 ? available : 320}px`);this.host.style.setProperty('--rcs-calendar-height',`${Math.max(180,available-8)}px`);
      } else {const available=this.container.getBoundingClientRect().bottom-this.host.getBoundingClientRect().bottom;this.host.style.setProperty('--rcs-message-height',`${Math.max(110,available-55)}px`);this.host.style.setProperty('--rcs-calendar-height',`${Math.max(180,available-8)}px`);}
      this.hits = this.isGlobal ? this.savedHits : this.kind === 'list' ? [...this.cache.values()].filter(entry => C.matches([entry.name,...(entry.aliases || []),...(entry.participants || []),entry.membership==='invite'?'chat request invitation':'',entry.accountUnavailable ? 'deleted [deleted] unavailable account' : ''].join(' '), query)) : index.search(this.room, query,dates,this.queryOptions || {}).sort((a,b)=>{
        const newest=(Date.parse(b.timestamp)||0)-(Date.parse(a.timestamp)||0);
        if(this.queryOptions?.sort==='oldest')return -newest;
        if(this.queryOptions?.sort==='relevant'){const score=record=>C.highlightRanges(record.text,query,{wholeWord:this.queryOptions?.wholeWord}).reduce((sum,[start,end])=>sum+end-start+(start===0?20:0),0);return score(b)-score(a) || newest;}
        return newest;
      });
      if(selected)this.active=this.hits.findIndex(hit=>this.rowKey(hit)===selected);
      if(this.kind==='list' && !this.isGlobal)this.hits=this.hits.filter(hit=>!(!hit.historicalName && ['[deleted]','Someone','Username unavailable'].includes(hit.name) && (hit.identityPending || !hit.accountUnavailable || this.loading)));
      const showing=this.kind==='list' ? this.isGlobal || this.browseOpen : Boolean(query || bounds.active);
      this.input.setAttribute('aria-expanded', String(showing));
      // The calendar overlays the global view. Hiding its opaque panel would
      // reveal Reddit's native list underneath while choosing a date.
      this.panel.hidden = !showing || !this.isGlobal && Boolean(this.datePicker?.open);
      if (this.count) this.count.textContent = showing ? `${Math.max(0,this.active + 1)}/${this.hits.length}` : '';
      if (this.prev) { this.prev.disabled = !showing || !this.hits.length; this.next.disabled = this.prev.disabled; }
      if (!showing) return;
      if(this.tools?.renderValueChoices?.())return;
      this.status.textContent = this.kind==='list' && globalThis.RCSDirectory?.getStartup?.().pending ? 'Restoring saved usernames…' : this.loading ? this.progress || (this.kind === 'list' ? 'Searching all conversations…' : 'Searching all messages…') : this.notice || `${this.hits.length} ${this.kind === 'list' ? 'conversation' : 'message'}${this.hits.length === 1 ? '' : 's'}${this.complete ? '' : ' · still connecting'}`;
      if(this.kind==='list' && this.loading && !this.refreshing && globalThis.RCSDirectory?.getStartup?.().entry?.directoryComplete)this.status.textContent=`${this.hits.length} saved conversations · ${this.progress.startsWith('Waiting') ? this.progress.replace(/\s*\(\d+\)$/,'') : this.progress.includes('dates') ? 'Updating dates…' : 'Checking updates…'}`;
      if(this.kind==='messages')this.status.textContent=bounds.invalid ? 'Choose an end date on or after the start date.' : this.notice || `${this.hits.length} match${this.hits.length===1?'':'es'}${this.loading ? ` · ${this.progress || 'Searching older messages…'}` : ''}`;
      if(this.isGlobal)this.status.textContent=bounds.invalid ? 'Choose an end date on or after the start date.' : this.notice || (!this.savedStats && this.savedLoading ? 'Searching saved messages…' : `${this.savedTotal} matches · ${this.savedStats?.rooms || 0} saved chats${this.savedSavingError ? ' · Saving paused' : this.savedImporting ? ' · Saving cached messages…' : this.savedLoading ? ' · Searching…' : ''}`);
      if(this.isGlobal){this.coverage.textContent=`${this.savedCaptureIncomplete ? 'Some captures unavailable' : this.savedPersistent===false ? 'Session messages only' : 'Saved messages only'} · History may be incomplete`;this.coverage.title=this.savedSavingError ? `Saving failed: ${this.savedSavingError}. Refresh to retry pending writes.` : '';this.load.textContent='Refresh';}
      this.status.title=this.status.textContent;
      const wanted=[];
      for (const [i, hit] of this.hits.slice(0,this.renderLimit).entries()) {
        const key=this.rowKey(hit);
        let row=this.rows.get(key);
        if(!row) {
          const result=node('button','result');result.type='button';
          const copy=node('span','copy');
          const name=node('span','name');const caption=node('span','time');
          if(this.messageMode){const heading=node('span','message-heading');heading.append(name,caption);copy.append(heading);}else copy.append(name,caption);
          row={result,copy,name,caption};
          row.avatar=node('span','avatar');row.avatar.setAttribute('aria-hidden','true');result.append(row.avatar);
          if(this.messageMode) {row.preview=node('span','preview');copy.append(row.preview);}
          result.append(copy);result.addEventListener('click',()=>this.activate(row.position));
          this.rows.set(key,row);
        }
        row.position=i;row.result.classList.toggle('active',i===this.active);row.result.hidden=false;
        const partner=this.kind==='messages' ? this.cache.get(this.room) : null;
        const partnerName=partner?.name || (this.kind==='messages' ? A.text(A.query('.room-name',this.container)) : '');
        const signature=JSON.stringify([query,this.queryOptions,partnerName,hit.name,hit.type,hit.membership,hit.status,hit.author,hit.authorSelf,this.cache.get(hit.roomId)?.name,hit.text,hit.timestamp,hit.accountUnavailable,hit.historicalName,this.loading]);
        if(row.signature!==signature) {
          row.signature=signature;
          row.name.replaceChildren(!this.messageMode ? highlight(hit.name,query) : document.createTextNode(partnerName || (hit.authorSelf ? 'You' : hit.author?.startsWith('@') ? 'Sender unavailable' : hit.author || 'Sender unavailable')));
          row.caption.textContent=!this.messageMode ? (hit.accountUnavailable ? hit.historicalName ? 'Unavailable account · Retained username' : 'Unavailable account' : 'Open conversation') : hit.timestamp ? this.formatTime(hit.timestamp) : '';
          if(!this.messageMode && hit.timestamp && Number.isFinite(new Date(hit.timestamp).getTime())) {
            row.caption.textContent=`${this.formatTime(hit.timestamp)}${hit.accountUnavailable ? ' · Unavailable account' : ''}`;
            row.caption.title=`Last conversation activity · ${new Date(hit.timestamp).toLocaleString()}`;
          } else if(!this.messageMode && !this.loading) {
            row.caption.textContent=hit.accountUnavailable ? 'Unavailable account · Date unavailable' : 'Date unavailable';
            row.caption.title='Reddit has not provided a message timestamp for this conversation.';
          } else row.caption.removeAttribute('title');
          if(this.kind==='messages' && hit.timestamp)row.caption.title=new Date(hit.timestamp).toLocaleString();
          if(!this.messageMode && (hit.type==='reddit_modmail' || hit.membership==='invite'))row.caption.textContent=`${hit.type==='reddit_modmail'?'Community chat':'Chat'}${hit.membership==='invite'?' · Request pending':''}${hit.timestamp?` · ${this.formatTime(hit.timestamp)}`:''}`;
          if(this.isGlobal)row.caption.textContent=`${this.cache.get(hit.roomId)?.name || 'Saved conversation'}${hit.timestamp ? ` · ${this.formatTime(hit.timestamp)}` : ''}`;
          if(row.preview) {
            const match=C.ranges(hit.text,query)[0];const start=Math.max(0,(match?.[0] || 0)-40);
            const snippet=C.excerpt?.(hit.text,query,this.queryOptions) || {text:`${start ? '…' : ''}${hit.text.slice(start,start+180)}${hit.text.length>start+180 ? '…' : ''}`};
            row.preview.replaceChildren(...(this.kind==='messages' && hit.authorSelf ? [node('span','you-prefix','You: ')] : []),highlight(snippet.text,query,this.queryOptions));
            row.preview.title=hit.text;
          }
        }
        const partnerAvatar=this.kind==='messages' ? this.cache.get(this.room)?.avatar || A.query('.user-avatar img, rs-user-avatar img, header img',this.container)?.getAttribute('src') : '';
        const avatarUrl=partnerAvatar || (this.kind==='messages' && hit.authorSelf ? '' : hit.avatar) || '',speaker=!this.messageMode ? hit.name : partnerName || (hit.authorSelf ? 'You' : hit.author);
        if(row.avatar && (row.avatarUrl!==avatarUrl || !row.image?.isConnected && row.avatarLabel!==speaker)) {
          if(row.image){this.avatarObserver?.unobserve(row.image);this.pendingAvatarSources.delete(row.image);}
          row.avatarUrl=avatarUrl;row.avatarLabel=speaker;row.avatar.textContent=(speaker || '').replace(/^u\//,'').slice(0,1).toUpperCase();
          if(!speaker || speaker.startsWith('@'))row.avatar.innerHTML=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">${icons.person}</svg>`;
          try {
            const url=new URL(avatarUrl,location.href);
            if(avatarUrl && (url.protocol==='https:' || /^data:image\/(png|jpeg|webp|svg\+xml)[;,]/.test(avatarUrl))) {
              const image=node('img');image.alt='';image.referrerPolicy='no-referrer';
              image.style.visibility='hidden';image.addEventListener('load',()=>{
                image.style.visibility='visible';
                if(image.parentNode===row.avatar)for(const child of [...row.avatar.childNodes])if(child!==image)child.remove();
              },{once:true});
              image.addEventListener('error',()=>{if(image.parentNode===row.avatar){row.avatar.textContent=(speaker || '').replace(/^u\//,'').slice(0,1).toUpperCase();if(!speaker || speaker.startsWith('@'))row.avatar.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true">${icons.person}</svg>`;}},{once:true});
              image.loading='lazy';image.decoding='async';row.image=image;
              row.avatar.append(image);
              if(this.avatarObserver){this.pendingAvatarSources.set(image,avatarUrl);this.avatarObserver.observe(image);}
              else image.src=avatarUrl;
            }
          } catch { /* Keep the initial for an invalid image URL. */ }
        }
        wanted.push(row.result);
      }
      // Keep unmatched rows mounted but hidden so returning to a query reuses
      // the same decoded avatar. No src assignment occurs during normal sync.
      const visible=new Set(wanted);
      for(const row of this.rows.values()){row.result.hidden=!visible.has(row.result);row.result.classList.toggle('result',visible.has(row.result));}
      for(const extra of this.results.querySelectorAll('.empty,.hint,.saved-more'))extra.remove();
      let position=this.results.firstElementChild;
      for(const result of wanted) {
        if(result!==position)this.results.insertBefore(result,position);
        position=result.nextElementSibling;
      }
      if(this.isGlobal && !this.hits.length)this.results.append(node('div','empty',this.savedLoading ? 'Searching saved messages…' : this.notice || (this.savedStats?.messages ? 'No matching saved messages. Try another word.' : 'No saved messages yet. Messages Reddit loads will become searchable here.')));
      else if (!this.hits.length) this.results.append(node('div', 'empty', this.loading ? this.kind==='list' ? 'Loading your conversations…' : 'Searching your history in the background…' : this.kind === 'list' ? 'No matching usernames. Try a shorter name.' : 'No matching messages. Try another word.'));
      if(this.isGlobal && this.savedHasMore){const more=node('button','load saved-more',this.savedLoading ? 'Loading…' : `Load more (${this.savedHits.length} of ${this.savedTotal})`);more.disabled=this.savedLoading;more.addEventListener('click',()=>this.querySaved(true));this.results.append(more);}
      if(this.hits.length>this.renderLimit)this.results.append(node('div','hint',`Showing ${this.renderLimit} of ${this.hits.length}. Scroll for more.`));
    }
    formatTime(value) { if(C.compactTime)return C.compactTime(value);const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}); }
    move(direction,jump=false) {
      const total = this.hits.length; if (!total) return;
      const next=this.active<0 ? (direction<0 ? total-1 : 0) : (this.active+direction+total)%total;
      if(next>=this.renderLimit)this.renderLimit=Math.ceil((next+1)/50)*50;
      this.active=next;this.render();
      const result=this.rows.get(this.rowKey(this.hits[this.active]))?.result;
      if(result){const row=result.getBoundingClientRect(),viewport=this.results.getBoundingClientRect();if(row.top<viewport.top)this.results.scrollTop-=viewport.top-row.top;else if(row.bottom>viewport.bottom)this.results.scrollTop+=row.bottom-viewport.bottom;}
      if (this.kind === 'messages' && jump) this.jump(this.hits[this.active]);
    }
    async activate(i) {
      const hit = this.hits[i]; if (!hit) return;
      this.active = i;
      if (this.kind === 'list' && !this.isGlobal) {
        try {
          if (globalThis.RCSData) await RCSData.request('open',{roomId:hit.id}).promise;
          else if (hit.element?.isConnected) (hit.link || hit.element).click();
          else throw Error('Reddit chat is not connected yet. Please retry.');
          this.input.value = ''; this.render();this.dismiss();
        } catch(error) { this.status.textContent=error.message; }
      } else { this.render(); this.jump(hit); }
    }
    async jump(hit) {
      if (globalThis.RCSData) {
        try { await RCSData.request('jump',{roomId:hit.roomId || this.room,eventId:hit.id,thread:Boolean(hit.thread)}).promise;this.dismiss(); }
        catch(error) { this.status.textContent=error.message; }
        return;
      }
      const current = A.messages(this.container).find(message => message.id === hit.id);
      if (!current) { this.status.textContent = 'Reddit chat is not connected yet. Please retry.'; return; }
      this.dismiss();
      current.element.scrollIntoView({block:'center',behavior:'instant'});
      if (current.element.animate && !matchMedia('(prefers-reduced-motion: reduce)').matches) current.element.animate([{outline:'2px solid #ff4500',outlineOffset:'3px'},{outline:'2px solid transparent',outlineOffset:'3px'}],{duration:1600});
    }
    cancelLoad(showNotice=false) {
      if(showNotice)this.stoppedByUser=true;
      this.savedGeneration++;clearTimeout(this.savedTimer);this.savedLoading=false;this.savedDirty=false;this.savedKey='';
      this.dataTask?.cancel();this.dataTask=null;this.loading=false;this.load.textContent='Refresh';
      if(showNotice) {this.notice='Search stopped. Results may be incomplete.';this.render();}
    }
    async ensureData(force=false,reconcile=false) {
      if(this.tools?.suggestions?.hidden===false || this.tools?.valuePicker?.() || C.parseQuery(this.input.value).invalid)return;
      if(this.isGlobal){if(force)this.savedKey='';this.querySaved(false,force,force);return;}
      if(this.kind==='messages'){const generation=this.savedGeneration;await this.readSavedRoom();if(generation!==this.savedGeneration)return;}
      const dateKey=JSON.stringify(this.dates || {});
      if(this.kind==='messages' && !force && !this.input.value.trim() && !this.dates?.from && !this.dates?.to)return;
      if(!globalThis.RCSData || this.loading || (this.complete && !force && !reconcile) || this.kind==='messages' && !force && this.dateCompleteKey===dateKey) return;
      this.refreshing=force;
      this.stoppedByUser=false;
      this.loading=true;this.notice='';this.progress='';this.load.textContent='Stop';
      const room=this.room;
      const task=(this.kind==='list' && globalThis.RCSDirectory ? RCSDirectory.load(force,progress=>{
        if(this.dataTask!==task)return;
        if(progress.records) {for(const record of progress.records)this.cache.set(record.id,{...this.cache.get(record.id),...record});}
        this.progress=`${progress.label} (${progress.loaded})`;
        if(!this.panel.hidden)this.render();
      }) : RCSData.request(this.kind==='list' ? 'conversations' : 'history',this.kind==='list' ? {} : {roomId:room,refresh:force,dates:this.dates},progress=>{
        if(this.dataTask!==task)return;
        if(this.kind==='messages' && progress.records)index.upsert(room,progress.records,{authoritative:true,redacted:progress.redacted || []});
        this.progress=`${progress.label} (${progress.loaded})`;
        if(!this.panel.hidden)this.render();
      }));
      this.dataTask=task;this.render();
      try {
        const records=await task.promise;
        if(this.dataTask!==task || !this.host.isConnected || this.room!==room)return;
        if(this.kind==='list') {
          const previous=new Map(this.cache);this.cache.clear();
          for(const record of records)this.cache.set(record.id,{...previous.get(record.id),...record});
          this.complete=!records.some(record=>record.identityPending);directoryComplete=this.complete;
          if(!this.complete)this.notice=records.some(record=>record.status==='invite-pending')?'Some chat requests are pending. Available conversations remain searchable.':'Some usernames are unavailable. Saved matches remain searchable.';
        } else {index.replace(room,records,records.historyMeta || {});this.complete=records.historyMeta?.complete!==false;this.dateCompleteKey=records.historyMeta?.dateComplete ? JSON.stringify(records.historyMeta.dates || {}) : '';if(this.complete)completeRooms.add(room);}
      } catch(error) { if(this.dataTask===task)this.notice=error.message; }
      finally {if(this.dataTask===task){this.dataTask=null;this.loading=false;this.load.textContent='Refresh';if(!this.panel.hidden)this.render();schedule();if(this.kind==='messages' && !this.bar.hidden && !this.notice && dateKey!==JSON.stringify(this.dates || {}) && !this.complete && this.dateCompleteKey!==JSON.stringify(this.dates || {}))this.ensureData();}}
    }
    clearRows(){this.avatarObserver?.disconnect();this.pendingAvatarSources.clear();this.rows.clear();this.results.replaceChildren();}
    destroy() { A.releaseSearchLayer?.(this.host);this.tools?.destroy?.();this.savedUnsubscribe?.();this.cancelLoad();this.resizeObserver?.disconnect();this.avatarObserver?.disconnect();this.pendingAvatarSources.clear();document.removeEventListener('pointerdown',this.outside); this.host.remove(); this.triggerHost?.remove(); }
  }
  globalThis.RCSDirectory?.onChange(value=>{
    if(value.fromStorage || value.restored) {
      for(const record of value.records || [])directory.set(record.id,{...directory.get(record.id),...record});
      for(const control of controls.values())if(!control.panel.hidden)control.render();
      schedule();
      return;
    }
    if(value.accountChanged){globalThis.RCSNativeLabels?.clear();directory.clear();index.clear();completeRooms.clear();for(const control of controls.values()){control.cancelLoad();control.resetSaved();control.input.value='';control.notice='';control.render();}}
    directoryComplete=false;
    for(const control of controls.values())if(control.kind==='list'){control.complete=false;if(!control.stoppedByUser || value.accountChanged)control.ensureData();}
  });
  document.addEventListener('rcs-conversation-activity',event=>{
    let value;try{value=JSON.parse(event.detail);}catch{return;}
    const owner=globalThis.RCSDirectory?.getOwner();
    if(!owner || value?.owner!==owner)return;
    for(const [id,meta] of Object.entries(value.roomMeta || {})){
      const record=directory.get(id);
      if(record && Number.isFinite(meta.unreadCount) && meta.unreadCount>=0)directory.set(id,{...record,unreadCount:meta.unreadCount});
    }
    for(const control of controls.values())if(control.kind==='list')control.render();
  });
  document.addEventListener('rcs-history-changed',event=>{
    let value;try{value=JSON.parse(event.detail);}catch{return;}
    const owner=globalThis.RCSDirectory?.getOwner();
    if(owner && value?.owner!==owner || typeof value?.roomId!=='string')return;
    if(value.evicted){index.rooms.delete(value.roomId);index.redacted.delete(value.roomId);index.metadata.delete(value.roomId);completeRooms.delete(value.roomId);return;}
    index.upsert(value.roomId,value.records || [],{authoritative:true,redacted:value.redacted || []});
    value.complete ? completeRooms.add(value.roomId) : completeRooms.delete(value.roomId);
    for(const control of controls.values())if(control.kind==='messages' && control.room===value.roomId) {
      control.complete=Boolean(value.complete);
      if(value.dateInvalidated)control.dateCompleteKey='';
      if(!control.panel.hidden)control.render();
      if(!value.identityOnly && !value.complete && !control.bar.hidden && !control.stoppedByUser)control.ensureData();
    }
  });
  function schedule() {
    if (scheduled || stopped) return; scheduled = true;
    setTimeout(() => { scheduled = false; refresh(); },120);
  }
  function refresh() {
    if (stopped || document.hidden) return;
    // On normal Reddit pages this only runs when a chat shell is present.
    const roots = A.chatRoots();
    const liveRoots = new Set(roots);
    for (const [root, observer] of observed) if (!liveRoots.has(root)) { observer.disconnect(); observed.delete(root); }
    for (const root of roots) if (!observed.has(root)) {
      const observer = new MutationObserver(records => {
        if (records.some(record => !record.target.closest?.('[data-rcs-ui]'))) schedule();
      });
      observer.observe(root,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['room','room-id','channel-id','data-room-id','data-id','data-rcs-event-id','data-rcs-sender','data-rcs-author-self','hidden','selected','style','class']}); observed.set(root,observer);
    }
    const find = selector => [...new Set(roots.flatMap(root => [...(root.matches?.(selector) ? [root] : []), ...root.querySelectorAll(selector)]))];
    const lists = find(A.selectors.list).filter(A.visible);
    // Some chat versions put list items straight into rs-app. Scope to their parent.
    if (!lists.length) {
      const row = find(A.selectors.row).find(A.visible);
      if (row) lists.push(row.parentNode.host || row.parentElement);
    }
    const rooms = find(A.selectors.room).filter(A.visible);
    const live = new Map([...lists.map(list => [list,'list']), ...rooms.map(room => [room,'messages'])]);
    for (const [container, control] of controls) if (!live.has(container) || !control.host.isConnected) { control.destroy(); controls.delete(container); }
    for (const [container,kind] of live) {
      if (!controls.has(container)) controls.set(container,new SearchControl(container,kind));
      else controls.get(container).sync();
    }
    // The minimized bar lives in a separate shadow root from rs-app.
    const restore = roots.flatMap(root => [...root.querySelectorAll('button[aria-label="Maximize chat view"]')]).find(A.visible);
    if (collapsedControl && (!collapsedControl.host.isConnected || !restore || collapsedControl.restore !== restore)) {
      collapsedControl.host.remove(); collapsedControl = null;
    }
    if (restore && !collapsedControl) {
      const host = node('span'); host.setAttribute('data-rcs-ui','minimized-search');
      host.style.cssText = 'position:absolute;inset-inline-end:30px;top:50%;transform:translateY(-50%);display:inline-flex;z-index:2;';
      const root = host.attachShadow({mode:'open'});
      const button = icon('search','Search chats',() => { openListRequested = true; restore.click(); schedule(); });
      root.append(node('style','',css),button); restore.parentElement.append(host);
      collapsedControl = {host,restore};
    }
    if (openListRequested) {
      const list = [...controls.values()].find(control => control.kind === 'list');
      if (list) { list.open(); openListRequested = false; }
    }
    if(!globalThis.RCSDirectory?.getStartup?.().pending)globalThis.RCSNativeLabels?.update(directory,index,globalThis.RCSDirectory?.getOwner(),[...controls.values()].some(c=>c.kind==='list' && c.loading));
  }
  // Shadow roots attached after an element is inserted don't emit DOM mutations.
  // A modest discovery heartbeat covers delayed Lit hydration without patching Reddit.
  const heartbeat = setInterval(refresh,1800);
  const observer = new MutationObserver(schedule); observer.observe(document,{childList:true,subtree:true});
  document.addEventListener('visibilitychange',schedule);
  window.addEventListener('pagehide',event => {
    if (event.persisted) return;
    stopped = true; clearInterval(heartbeat); observer.disconnect();
    for (const observer of observed.values()) observer.disconnect();
    for (const control of controls.values()) control.destroy(); index.clear();
    directory.clear();completeRooms.clear();
    globalThis.RCSNativeLabels?.clear();
    collapsedControl?.host.remove();
  });
  refresh();
})();
