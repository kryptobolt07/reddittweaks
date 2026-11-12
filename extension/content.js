(() => {
  if(window.credentialless===true)return;
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
  // Mobile routing can detach the sidebar. Retain its controller only within
  // the same document, authenticated account and native chat shell.
  const retainedLists = new Map();
  function listContext(container){for(let node=container;node;node=node.parentElement || node.getRootNode?.().host){if(node.localName==='rs-app' || node.id==='resizable')return node;}return document.body || document.documentElement;}
  function clearRetainedLists(){for(const {control} of retainedLists.values())control.destroy();retainedLists.clear();}
  const observed = new Map();
  let scheduled = false;
  let refreshTimer=null,fastScheduled=false,navigationFrame=0;
  let stopped = false;
  let collapsedControl = null;
  let openListRequested = false;
  // Avatars already decoded in this page (bounded). A browser-cached image reports complete as soon
  // as its source is set, so the check costs no request; rows asking are already in the visible window.
  const loadedAvatars=new Set();
  const rememberAvatar=url=>{if(!url)return;loadedAvatars.delete(url);loadedAvatars.add(url);if(loadedAvatars.size>300)loadedAvatars.delete(loadedAvatars.values().next().value);};
  const knownAvatar=url=>{if(!url)return false;if(loadedAvatars.has(url))return true;try{const probe=new Image();probe.referrerPolicy='no-referrer';probe.src=url;if(probe.complete && probe.naturalWidth>0){rememberAvatar(url);return true;}}catch{}return false;};

  const icons = {
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
    refresh: '<path d="M20 8a8.9443 8.9443 0 1 0 0 8M20 3v5h-5"/>',
    back: '<path d="m14 5-7 7 7 7"/>',
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
      --rcs-accent:#ff4500; }
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
    .conversation-panel { height:var(--rcs-list-height,320px); display:flex; flex-direction:column; }
    .conversation-panel .results { max-height:none; flex:1; min-height:0; }
    .meta { padding:3px 9px; display:flex; align-items:center; justify-content:space-between; gap:6px; color:var(--rcs-muted); font-size:10px; border-bottom:1px solid var(--rcs-line); }
    .meta [role=status] { flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
    .load:not(.rcs-refresh),.date-chip { display:inline-flex;align-items:center;justify-content:center;gap:5px;min-height:26px;font-size:11px;font-weight:600;color:var(--rcs-text);border:1px solid var(--rcs-line);border-radius:999px;padding:4px 10px;background:var(--rcs-soft);white-space:nowrap;flex-shrink:0; }
    .results { max-height:min(360px,50vh); overflow:auto; overscroll-behavior:contain; padding:4px 0; }
    .day-heading { position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:10px;height:28px;margin:0;padding:0 10px;color:var(--rcs-muted);background:var(--rcs-bg);font-size:10px;font-weight:600; }
    .day-heading::before,.day-heading::after { content:'';flex:1;height:1px;background:var(--rcs-line); }
    .result { display:flex; align-items:center; gap:10px; width:100%; text-align:left; padding:11px 14px; color:var(--rcs-text); background:transparent; border:0; border-left:0; text-decoration:none; }
    .result:hover,.result.active { background:var(--rcs-soft); }
    .result:focus-visible { outline:0;box-shadow:none; }
    .result.active { position:relative; }
    .result.active::before { content:'';position:absolute;inset-block:8px;left:0;width:3px;border-radius:0 3px 3px 0;background:color-mix(in srgb,var(--rcs-accent) 35%,transparent); }
    .avatar { position:relative;display:grid; place-items:center; width:32px; height:32px; border-radius:50%; color:var(--rcs-muted); background:var(--rcs-soft); font-weight:600; flex:none; overflow:hidden; }
    .avatar img { position:absolute;inset:0;width:100%; height:100%; object-fit:cover; }
    .copy { min-width:0; flex:1; } .name { display:block; font-size:13px; font-weight:600; } .preview { display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; margin-top:4px; font-size:13px; overflow-wrap:anywhere; }
    .time { display:block; color:var(--rcs-muted); font-size:11px; font-weight:400; margin-top:2px; } .hint,.empty { color:var(--rcs-muted); padding:20px 16px; font-size:12px; text-align:center; }
    mark { background:#ffcc804d; color:inherit; border-radius:2px; } .count { font-size:11px; color:var(--rcs-muted); white-space:nowrap; }
    :host([data-rcs-ui=messages]) .bar { width:100%;padding:6px 8px 2px;gap:4px; }
    :host([data-rcs-ui=messages]) .field { height:40px; }
    :host([data-rcs-ui=messages]) input { height:36px;font-size:12px; }
    .date-chip { max-width:52%;color:var(--rcs-accent);background:color-mix(in srgb,var(--rcs-accent) 8%,var(--rcs-bg));border-color:color-mix(in srgb,var(--rcs-accent) 20%,var(--rcs-line)); }
    .date-chip { padding:0 3px 0 8px;gap:2px; }
    .date-chip-edit { border:0;padding:4px 0;min-width:0;background:transparent;color:inherit;font:inherit;overflow:hidden;text-overflow:ellipsis; }
    .date-chip .date-remove { width:20px;height:20px;color:inherit; }
    .date-chip .date-remove svg { width:12px;height:12px; }
    .date-chip:hover { background:color-mix(in srgb,var(--rcs-accent) 14%,var(--rcs-bg)); }
    .icon.filtered { background:var(--rcs-hover);color:var(--rcs-accent); }
    .message-panel { width:min(480px,calc(100% - 16px));left:50%;right:auto;transform:translateX(-50%);margin-top:0;border:1px solid var(--rcs-line);border-radius:12px;overflow:hidden; }
    .message-panel .result { gap:7px;padding:7px 9px;align-items:start; }
    .message-panel .results { overflow-anchor:none;max-height:min(320px,var(--rcs-message-height,42vh)); }
    .message-panel .avatar { width:24px;height:24px;margin-top:1px;font-size:11px; }
    .message-panel .avatar svg { width:15px;height:15px; }
    .message-heading { display:flex;flex-wrap:wrap;align-items:baseline;column-gap:8px;row-gap:0;min-width:0; }
    .message-heading .name { flex:1 0 auto;min-width:0;max-width:100%;white-space:normal;overflow-wrap:anywhere;font-size:12px; }
    .message-heading .time { margin:0 0 0 auto;white-space:nowrap;font-size:10px; }
    .you-prefix { color:var(--rcs-muted);font-weight:400; }
    .message-panel .preview.has-image { display:block;max-height:none;-webkit-line-clamp:unset; }
    .message-panel .preview { -webkit-line-clamp:2;font-size:12px;line-height:1.45;margin-top:2px; }
    :host([data-rcs-compact]) .bar { padding:4px 6px;gap:2px; }
    :host([data-rcs-ui=messages][data-rcs-compact]) .bar { padding-bottom:2px; }
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
    :host([data-rcs-compact]) .message-panel { width:min(320px,calc(100% - 12px));margin-top:0;border-radius:9px; }
    :host([data-rcs-compact]) .message-panel .results { max-height:min(210px,var(--rcs-message-height,42vh)); }
    :host([data-rcs-compact]) .message-panel .avatar { width:22px;height:22px; }
    :host([data-rcs-compact]) .message-panel .preview { font-size:11px; }
    :host([data-rcs-compact]) .date-chip,:host([data-rcs-compact]) .load:not(.rcs-refresh) { min-height:24px;font-size:10px; }
    :host([data-rcs-compact]) .load:not(.rcs-refresh) { padding:3px 7px; }
    :host([data-rcs-compact]) .date-chip { padding:0 2px 0 7px; }
    :host([data-rcs-compact]) .date-chip .date-remove { width:20px;height:20px; }
    :host([data-rcs-ui=minimized-search]) .icon { width:24px;height:24px; }
    :host([data-rcs-ui=minimized-search]) svg { width:16px;height:16px; }
    :host([data-rcs-ui=messages]) .bar { padding:6px 8px 3px; }
    :host([data-rcs-ui=messages]) .room-applied-filters { display:flex;flex-wrap:nowrap;align-items:center;gap:6px;height:32px;min-width:0;max-width:100%;padding:2px 8px 5px;overflow-x:auto;overflow-y:hidden;scrollbar-width:none; }
    .room-applied-filters .sender-chip,.room-applied-filters .room-type-chip { flex:0 0 auto;max-width:min(260px,75vw);min-height:25px;font-size:10px;padding:2px 4px 2px 8px; }
    .room-applied-filters .room-add-sender { display:grid;place-items:center;flex:0 0 24px;width:24px;height:24px;padding:0;border:1px solid var(--rcs-line);border-radius:50%;color:var(--rcs-muted);background:var(--rcs-bg); }
    .room-add-sender svg { width:13px;height:13px; }
    :host([data-rcs-ui=messages]) .message-panel { left:0;right:0;top:100%;transform:none;width:100%;height:var(--rcs-room-results-height,320px);margin:0;border:0;border-radius:0;box-shadow:none;display:flex;flex-direction:column; }
    :host([data-rcs-ui=messages]) .message-panel .results { flex:1;min-height:0;max-height:none;padding:0;overflow-anchor:none;scrollbar-width:thin;scrollbar-color:color-mix(in srgb,var(--rcs-muted) 28%,transparent) transparent; }
    .room-spacer { flex:none;pointer-events:none;overflow-anchor:none; }
    :host([data-rcs-ui=messages]) .message-panel .results::-webkit-scrollbar { width:5px; }
    :host([data-rcs-ui=messages]) .message-panel .results::-webkit-scrollbar-thumb { border-radius:4px;background:color-mix(in srgb,var(--rcs-muted) 28%,transparent); }
    :host([data-rcs-ui=messages]) .message-panel .meta { padding:0 8px;min-height:24px;border:0;font:var(--rcs-row-time-font,var(--font-10,10px/1.5 var(--font-sans,Arial,sans-serif))); }
    :host([data-rcs-ui=messages]) .message-panel .result { padding:var(--rcs-row-padding-block,8px) var(--rcs-row-padding-inline,12px);gap:var(--rcs-row-gap,8px);min-height:var(--rcs-row-min-height,64px); }
    :host([data-rcs-ui=messages]) .message-panel .name { flex:1;min-width:0;color:var(--rcs-row-title-color,var(--rcs-text));font:var(--rcs-row-title-font,var(--font-12,12px/1.5 var(--font-sans,Arial,sans-serif)));font-weight:400;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
    :host([data-rcs-ui=messages]) .message-heading { flex-wrap:nowrap; }
    :host([data-rcs-ui=messages]) .message-panel .preview { -webkit-line-clamp:3;color:var(--rcs-row-preview-color,var(--rcs-muted));font:var(--rcs-row-preview-font,var(--font-12,12px/1.5 var(--font-sans,Arial,sans-serif)));margin-top:var(--rcs-row-body-gap,2px); }
    :host([data-rcs-ui=messages]) .message-panel .avatar { width:var(--rcs-row-avatar-size,32px);height:var(--rcs-row-avatar-size,32px);flex:0 0 var(--rcs-row-avatar-size,32px);margin-top:0; }
    :host([data-rcs-ui=messages]) .message-panel .time { color:var(--rcs-row-time-color,var(--rcs-muted));font:var(--rcs-row-time-font,var(--font-10,10px/1.5 var(--font-sans,Arial,sans-serif))); }
    :host([data-rcs-ui=messages]) mark { background:color-mix(in srgb,var(--rcs-accent) 22%,var(--rcs-bg));font-weight:650; }
    :host([data-rcs-ui=messages]) .result.active { background:var(--rcs-soft); }
    :host([data-rcs-ui=messages]) .result.active::before { inset-block:8px;background:color-mix(in srgb,var(--rcs-accent) 35%,transparent); }
    .room-coverage { padding:5px 10px;font-size:10px;color:var(--rcs-muted); }
    :host([data-rcs-ui=messages]) .field > .icon { width:24px;height:24px; }
    :host([data-rcs-ui=messages]) .field > .icon svg { width:14px;height:14px; }
    :host([data-rcs-ui=messages]) .field > .icon[aria-label="Search"] { height:28px; }
    :host([data-rcs-ui=messages]) .field > .icon[aria-label="Search"] svg { width:18px;height:18px; }
    :host([data-rcs-ui=messages]) .field > .room-filter-toggle,:host([data-rcs-ui=messages]) .field > .room-date-toggle { width:26px;height:26px; }
    :host([data-rcs-ui=messages]) .room-filter-toggle svg,:host([data-rcs-ui=messages]) .room-date-toggle svg { width:16px;height:16px; }
    :host([data-rcs-ui=messages]) .field input { flex:1;width:0;font:var(--rcs-row-title-font,var(--font-12,12px/1.5 var(--font-sans,Arial,sans-serif))); }

    :host([data-header-search]) .bar,:host([data-header-search][data-rcs-compact]) .bar { height:var(--rcs-native-header-height,52px);min-height:0;padding:6px 8px;gap:6px; }
    :host([data-header-search]) .room-search-back { flex:0 0 28px;width:28px;height:32px;padding:4px;border:0;border-radius:50%;background:transparent;color:var(--rcs-muted); }
    .room-search-back:hover { background:var(--rcs-hover); }
    :host([data-header-search]) .field { height:clamp(28px,calc(var(--rcs-native-header-height,52px) - 12px),40px); }
    :host([data-header-search]) .field input { height:100%;max-height:100%; }
    .room-coverage[hidden] { display:none; }
    :host([data-rcs-ui=message-trigger]) .icon[aria-expanded=true] { color:var(--rcs-accent);background:color-mix(in srgb,var(--rcs-accent) 10%,var(--rcs-bg)); }
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
  // People use the same expression and phrase semantics with substring completion.
  function listMatch(text, query) {
    const parsed = C.parseQuery(query);
    const hasField=node=>node.type==='field' || node.type==='not' && hasField(node.child) || (node.children || []).some(hasField);
    return !parsed.invalid && !hasField(parsed.expr) && C.matchesText(parsed,text,{shortTermsWholeWord:false});
  }
  function highlight(text, query, options={}) {
    const fragment = document.createDocumentFragment();
    let offset = 0;
    for (const [start, end] of (options.ranges || C.highlightRanges?.(text,query,options) || C.ranges(text, query))) {
      fragment.append(document.createTextNode(text.slice(offset, start)), node('mark', '', text.slice(start, end)));
      offset = end;
    }
    fragment.append(document.createTextNode(text.slice(offset)));
    return fragment;
  }
  class SearchControl {
    constructor(container, kind) {
      if(kind==='list' && globalThis.RCSUnifiedSearch)return new RCSUnifiedSearch(container,{cache:directory,adapter:A,version:'0.32.1'});
      this.container = container; this.kind = kind; this.room = ''; this.cache = directory; this.active = -1; this.hits = []; this.loading = false;
      this.complete = kind === 'list' && directoryComplete;
      this.rows = new Map();
      this.browseOpen=false;this.renderLimit=50;this.lastQuery=undefined;this.scope='people';this.savedHits=[];this.savedTotal=0;this.savedGeneration=0;this.savedOwner=undefined;this.savedLoading=false;
      this.mediaView=globalThis.RCSMediaPreview?new RCSMediaPreview.View({onBeforeResize:()=>this.captureImageViewport(),onResize:()=>this.restoreImageViewport()}):null;this.pendingAvatarSources=new Map();
      this.host = node('div'); this.host.setAttribute('data-rcs-ui', kind);
      this.host.setAttribute('data-rcs-version','0.32.1');
      const shadow = this.host.attachShadow({mode:'open'});
      const style = node('style', '', css+(globalThis.RCSRefreshStyles || '')+(globalThis.RCSLoadingStyles || '')+(globalThis.RCSMediaPreview?.styles || '')); shadow.append(style);
      this.toggle = node('button', 'toggle', 'Search messages'); this.toggle.type = 'button';
      this.toggle.prepend(icon('search', 'Search this conversation', () => this.open()));
      // Avoid a nested button in the toggle.
      this.toggle.firstChild.replaceWith(this.toggle.firstChild.firstChild);
      this.toggle.setAttribute('aria-expanded', 'false'); this.toggle.addEventListener('click', () => this.open());
      this.bar = node('div', 'bar');
      if(kind==='messages'){this.back=icon('back','Back to conversation',()=>this.close());this.back.classList.add('room-search-back');this.bar.append(this.back);this.appliedFilters=node('div','room-applied-filters');this.appliedFilters.hidden=true;this.appliedFilters.setAttribute('aria-label','Applied message filters');}
      const field = node('div', 'field');
      const searchIcon = icon('search', 'Search', () => {this.input.focus();this.showResults();});
      searchIcon.tabIndex = -1;
      this.input = node('input'); this.input.type = 'search'; this.input.autocomplete = 'off'; this.input.spellcheck = false;
      const label = kind === 'list' ? 'Search usernames' : 'Search in this chat';
      this.input.placeholder = label; this.input.setAttribute('aria-label', label);
      this.input.setAttribute('aria-controls', 'rcs-results'); this.input.setAttribute('aria-expanded', 'false');
      this.clear = icon('close', 'Clear search', () => { this.resultsDismissed=false;this.cancelInput();this.input.value = '';if(this.kind==='messages' && !this.dates?.from && !this.dates?.to)this.cancelLoad(); this.render();if(this.isGlobal)this.ensureData();this.input.focus(); }); this.clear.hidden = true;
      field.append(searchIcon, this.input, this.clear); this.bar.append(field);
      if (kind === 'messages' || kind === 'list') {
        this.dates={from:'',to:''};
        this.datePicker=new RCSDatePicker({
          chatMode:kind==='messages',
          getAnchor:()=>{const anchor=this.dateToggle.hidden?this.tools?.controlButtons?.filter:this.dateToggle;return (anchor || this.input.closest('.field') || this.dateChip).getBoundingClientRect();},
          getAvailability:()=>({days:[...new Set([...(index.rooms.get(this.room)?.values() || [])].map(message=>{const date=new Date(message.timestamp);return Number.isFinite(date.getTime())?`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`:'';}).filter(Boolean))]}),
          getBounds:()=>{const rect=this.container.getBoundingClientRect();if(!rect.width||!rect.height)return;return {left:rect.left,right:rect.right,top:Math.max(rect.top,this.host.getBoundingClientRect().bottom,A.query(A.selectors.header,this.container)?.getBoundingClientRect().bottom||rect.top),bottom:rect.bottom};},
          onChange:(dates,label,selection)=>{if(this.tools?.completeDateOperator?.(selection))return;this.cancelInput();this.resultsDismissed=false;this.dates=dates;this.dateLabel=label;this.dateCompleteKey='';this.active=-1;this.dataTask?.setDates?.(dates);if(!this.bar.hidden)this.ensureData();this.render();},
          onClose:restoreFocus=>{this.dateToggle.setAttribute('aria-expanded','false');this.render();if(restoreFocus)(this.dateToggle.hidden?this.dateChipLabel:this.dateToggle).focus({preventScroll:true});}
        });
        this.dateToggle=icon('calendar','Filter by date',()=>{
          if(this.datePicker.open)this.datePicker.close();else{this.datePicker.show();this.dateToggle.setAttribute('aria-expanded','true');this.render();}
        });
        this.dateToggle.setAttribute('aria-expanded','false');
        if(kind==='messages')field.append(this.dateToggle);else{this.bar.append(this.dateToggle);this.dateToggle.hidden=true;}
        this.dateChip=node('span','date-chip');this.dateChip.hidden=true;
        this.dateChipLabel=node('button','date-chip-edit');this.dateChipLabel.type='button';this.dateChipLabel.addEventListener('click',()=>this.dateToggle.click());
        this.dateRemove=icon('close','Remove date filter',()=>{this.datePicker.reset();this.render();this.dateToggle.focus({preventScroll:true});});this.dateRemove.classList.add('date-remove');this.dateChip.append(this.dateChipLabel,this.dateRemove);
      }
      this.panel = node('section', 'panel'); this.panel.setAttribute('aria-label', `${label} results`);
      const meta = node('div', 'meta'); this.status = node('span'); this.status.setAttribute('role', 'status'); this.status.setAttribute('aria-live','polite');this.meta=meta; meta.append(this.status);
      this.load=kind==='messages' && globalThis.RCSUnifiedSearch?.createRefreshButton ? RCSUnifiedSearch.createRefreshButton('Refresh messages',null) : node('button','load','Refresh');this.load.classList.add('load');this.load.type='button';this.updateLoad();
      this.load.addEventListener('click', () => {this.cancelInput();this.loading ? this.cancelLoad(true) : this.ensureData(true);});if(this.dateChip){if(kind==='messages')this.appliedFilters.append(this.dateChip);else meta.append(this.dateChip);}meta.append(this.load);
      if (kind === 'list') this.panel.classList.add('conversation-panel');
      else this.panel.classList.add('message-panel');
      this.results = node('div', 'results'); this.results.id = 'rcs-results';
      this.panel.append(meta,this.results);if(kind==='messages'){this.coverage=node('div','room-coverage','Saved messages only · History may be incomplete');this.panel.append(this.coverage);}shadow.append(this.toggle,this.bar);if(this.appliedFilters)shadow.append(this.appliedFilters);
      if(kind==='list'){this.scopeBar=node('div','scope');this.scopeBar.setAttribute('aria-label','Search scope');for(const [value,label] of [['people','People'],['all','All chats']]){const button=node('button','',label);button.type='button';button.dataset.scope=value;button.setAttribute('aria-pressed',String(value===this.scope));button.addEventListener('click',()=>this.setScope(value));this.scopeBar.append(button);}shadow.append(this.scopeBar);}if(this.datePicker)shadow.append(this.datePicker.element,node('style','',RCSDatePicker.styles));shadow.append(this.panel);
      this.toggle.hidden = kind === 'list'; this.bar.hidden = kind === 'messages'; this.panel.hidden = true;
      if (kind === 'messages') {
        const header = A.query(A.selectors.header, container);
        if (header) {
          this.triggerHost = node('span'); this.triggerHost.setAttribute('data-rcs-ui','message-trigger');
          this.triggerHost.style.cssText = 'display:inline-flex;flex-shrink:0;align-items:center;';
          const triggerRoot = this.triggerHost.attachShadow({mode:'open'});
          this.trigger = icon('search','Search messages',() => this.bar.hidden?this.open():this.close()); this.trigger.setAttribute('aria-expanded','false');
          triggerRoot.append(node('style','',css),this.trigger);
          const actions = header.lastElementChild;
          (actions?.classList.contains('flex') ? actions : header).prepend(this.triggerHost);
          this.toggle.hidden = true; this.host.hidden = true;
        }
      }
      if(kind==='messages')this.headerActions=globalThis.RCSRoomHeaderActions?.attach(container,{adapter:A});
      this.input.addEventListener('input', () => {this.resultsDismissed=false;this.active=-1;if(this.kind==='messages'){this.queueInput();return;}this.browseOpen=true;this.render();if(this.isGlobal)this.ensureData();});
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
        this.lastScrollAt=Date.now();
        if(this.scrollFrame)return;this.scrollFrame=requestAnimationFrame(()=>{this.scrollFrame=0;if(!this.host.isConnected || this.inputPending)return;
          if(this.kind==='messages'){this.renderResults();return;}
          if(this.renderLimit<this.hits.length && this.results.scrollTop+this.results.clientHeight>=this.results.scrollHeight-160) {
            this.renderLimit+=50;this.render();
          }else if(this.isGlobal && this.savedHasMore && !this.savedLoading && this.results.scrollTop+this.results.clientHeight>=this.results.scrollHeight-160)this.querySaved(true);
        });
      },{passive:true});
      shadow.addEventListener('keydown', event => {
        if(event.target===this.input && this.inputPending && ['ArrowUp','ArrowDown','Enter'].includes(event.key))this.flushInput();
        if (event.key === 'Escape') {
          event.preventDefault();event.stopPropagation();
          if(this.datePicker?.open)this.datePicker.close();
          else if(this.isGlobal)this.input.blur();
          else if(this.kind==='messages' && !this.panel.hidden){this.input.focus({preventScroll:true});this.dismiss();}
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
      this.shortcut=event=>{if(this.kind!=='messages' || !(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase()!=='f' || !event.composedPath().includes(this.container))return;event.preventDefault();event.stopPropagation();this.open();};
      if(kind==='messages')document.addEventListener('keydown',this.shortcut,true);
      this.outside = event => { if (!event.composedPath().includes(this.host)){if(this.datePicker?.open)this.datePicker.close(false);this.dismiss();} };
      document.addEventListener('pointerdown', this.outside);
      const point = A.mountPoint(container, kind === 'messages' ? A.selectors.header : 'rs-room-list-header');
      this.host.hidden=point.ready===false;point.parent.insertBefore(this.host, point.before);
      if(globalThis.ResizeObserver){this.resizeObserver=new ResizeObserver(()=>{this.updateLayout();if(!this.bar.hidden)this.render();});this.resizeObserver.observe(container);}
      this.savedUnsubscribe=globalThis.RCSMessages?.subscribe(value=>this.savedChanged(value));
      if(kind==='messages')this.tools=globalThis.RCSUnifiedSearch?.decorateMessageControl?.(this,{cache:this.cache,adapter:A});
      this.sync();
      if (kind === 'list') this.ensureData(false,true);
    }
    updateLoad(){if(this.kind!=='messages'){this.load.textContent=this.loading?'Stop':'Refresh';return;}const label=this.loading?'Stop searching messages':this.inputPending || this.preparingSearch?'Searching messages…':'Refresh messages';this.load.title=label;this.load.setAttribute('aria-label',label);this.load.classList.add('room-refresh','rcs-refresh');this.load.classList.toggle('busy',this.loading || this.inputPending || this.preparingSearch);this.load.setAttribute('aria-busy',String(Boolean(this.loading || this.inputPending || this.preparingSearch)));if(!this.load.querySelector('svg'))this.load.innerHTML=`<span class="refresh-motion"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons.refresh}</svg></span>`;}
    cancelInput(){clearTimeout(this.inputTimer);this.inputTimer=null;this.inputPending=false;this.results?.setAttribute('aria-busy','false');if(this.load)this.updateLoad();}
    queueInput(){
      this.cancelInput();this.clear.hidden=!this.input.value.trim();this.results.scrollTop=0;this.imageViewport=null;
      if(!this.queryValue().trim() && !this.dates?.from && !this.dates?.to){this.cancelLoad();this.render();return;}
      this.inputPending=true;if(this.meta)this.meta.hidden=false;this.updateLoad();this.results.setAttribute('aria-busy','true');this.panel.hidden=Boolean(this.datePicker?.open);this.input.setAttribute('aria-expanded','true');if(!this.panel.hidden){this.status.textContent='Searching messages…';this.showLoadingResults();}
      this.inputTimer=setTimeout(()=>{if(this.host.isConnected)this.flushInput();else this.cancelInput();},150);
    }
    showLoadingResults(){if(!globalThis.RCSUnifiedSearch?.createLoadingSkeleton)return;if(!this.loadingSkeleton)this.loadingSkeleton=RCSUnifiedSearch.createLoadingSkeleton();if(this.loadingSkeleton.parentNode!==this.results){this.results.replaceChildren(this.loadingSkeleton);this.results.scrollTop=0;}this.results.setAttribute('aria-busy','true');}
    flushInput(){this.cancelInput();this.ensureData();this.render();}
    scheduleResultsUpdate(){
      if(this.kind!=='messages' || Date.now()-(this.lastScrollAt || 0)>=200){clearTimeout(this.resultsUpdateTimer);this.resultsUpdateTimer=null;this.render();return;}
      if(this.resultsUpdateTimer)return;
      this.resultsUpdateTimer=setTimeout(()=>{this.resultsUpdateTimer=null;if(!this.host.isConnected || this.bar.hidden)return;if(Date.now()-(this.lastScrollAt || 0)<200){this.scheduleResultsUpdate();return;}this.render();},80);
    }
    captureImageViewport(){
      this.imageViewport=null;if(!this.results?.isConnected || this.panel.hidden)return;
      const top=this.results.getBoundingClientRect().top,element=[...this.results.querySelectorAll('.result')].find(row=>!row.hidden && row.getBoundingClientRect().bottom>top);
      if(element)this.imageViewport={element,offset:element.getBoundingClientRect().top-top,scrollTop:this.results.scrollTop};
    }
    restoreImageViewport(){
      const anchor=this.imageViewport;this.imageViewport=null;if(!anchor?.element.isConnected || this.panel.hidden)return;
      const offset=anchor.element.getBoundingClientRect().top-this.results.getBoundingClientRect().top;
      this.results.scrollTop=anchor.scrollTop+offset-anchor.offset;
      if(this.kind==='messages')this.renderResults(this.queryValue().trim(),C.dateBounds(this.dates || {}),false,true);
    }
    queryValue(){return this.tools?.queryValue?.() ?? this.input.value;}
    get isGlobal(){return this.kind==='list' && this.scope==='all';}
    get messageMode(){return this.kind==='messages' || this.isGlobal;}
    rowKey(hit){return `${this.isGlobal ? hit?.roomId : this.room}:${hit?.id}`;}
    setScope(scope){
      if(this.scope===scope){this.showResults();return;}
      this.cancelLoad();this.scope=scope;this.savedKey='';this.active=-1;this.clearRows();this.browseOpen=true;
      const label=this.isGlobal?'Search saved messages':'Search usernames';this.input.placeholder=label;this.input.setAttribute('aria-label',label);this.panel.setAttribute('aria-label',`${label} results`);
      this.dateToggle.hidden=!this.isGlobal;this.dateChip.hidden=!this.isGlobal;
      for(const button of this.scopeBar.children)button.setAttribute('aria-pressed',String(button.dataset.scope===scope));
      if(!this.isGlobal)this.datePicker.close(false);
      this.render();this.ensureData();this.input.focus();
    }
    resetSaved(){this.tools?.queryState?.clear();this.cancelInput();this.imageViewport=null;this.mediaView?.clear();
      this.savedGeneration++;clearTimeout(this.savedTimer);this.savedDirty=false;this.savedKey='';this.savedHits=[];this.savedTotal=0;this.savedHasMore=false;this.savedLoading=false;this.savedStats=undefined;this.savedImporting=false;this.savedSavingError='';this.roomSavedKey='';this.complete=false;this.dateCompleteKey='';this.active=-1;this.hits=[];this.clearRows();
    }
    savedChanged(value){
      if(value.contextInvalidated){this.contextInvalidated=true;clearTimeout(this.savedTimer);this.savedLoading=this.savedDirty=this.savedImporting=false;this.notice=value.error;this.render();return;}
      if(value.statusOnly){if(value.importing!==undefined)this.savedImporting=value.importing;if(this.isGlobal)this.render();return;}
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
      else if(this.kind==='messages' && !this.bar.hidden && (!value.roomIds || value.roomIds.includes(this.room)))this.queueRoomRead();
    }
    querySaved(more=false,background=false,retryWrites=false){
      if(this.contextInvalidated || !this.isGlobal || C.parseQuery(this.queryValue()).invalid || more && (this.savedLoading || !this.savedHasMore))return;
      const key=JSON.stringify([this.input.value.trim(),this.dates]);
      if(!more && key===this.savedKey)return;
      clearTimeout(this.savedTimer);
      const generation=++this.savedGeneration;this.savedKey=key;
      if(!more && !background){this.savedHits=[];this.savedTotal=0;this.savedHasMore=false;this.active=-1;this.renderLimit=50;}
      const offset=more ? this.savedHits.length : 0;this.savedLoading=true;this.notice='';this.render();
      this.savedTimer=setTimeout(async()=>{
        if(generation!==this.savedGeneration || !this.isGlobal || !this.host.isConnected || !globalThis.document)return;
        if(C.parseQuery(this.queryValue()).invalid){this.savedLoading=false;this.render();return;}
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
    // An ingest burst into the open room would otherwise re-read the whole room per event:
    // read at once, then fold everything that arrives within 500 ms into one trailing read.
    queueRoomRead(){
      if(this.roomReadTimer){this.roomReadDirty=true;return;}
      this.readSavedRoom();
      this.roomReadTimer=setTimeout(()=>{this.roomReadTimer=null;if(this.roomReadDirty){this.roomReadDirty=false;if(this.host.isConnected && !this.bar.hidden)this.queueRoomRead();}},500);
    }
    async readSavedRoom(){
      if(this.contextInvalidated || this.kind!=='messages' || !globalThis.RCSMessages)return;
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
    open() { this.resultsDismissed=false;this.stoppedByUser=false;this.browseOpen=this.kind==='list';this.host.hidden = false; this.bar.hidden = false; this.toggle.hidden = true; this.toggle.setAttribute('aria-expanded','true'); this.trigger?.setAttribute('aria-expanded','true');this.syncHeaderSearch();this.tools?.sync?.(); this.ensureData(); this.render(); this.input.focus(); }
    showResults() {this.resultsDismissed=false;this.stoppedByUser=false;if(this.kind==='list')this.browseOpen=true;this.ensureData();this.render();}
    dismiss() {
      // All chats is the selected sidebar view, rather than a transient menu.
      // Keep it mounted when focus moves to the room or a result is opened.
      if(this.isGlobal)return;
      this.cancelInput();this.resultsDismissed=true;this.browseOpen=false;this.panel.hidden = true; this.input.setAttribute('aria-expanded', 'false');
    }
    close(focus = true) { this.tools?.closeMenu?.();this.tools?.closeSuggestions?.();this.tools?.queryState?.clear();this.jumpTask?.cancel?.();clearTimeout(this.jumpRetry);this.navigationGeneration=(this.navigationGeneration || 0)+1;this.cancelLoad();if(this.appliedFilters)this.appliedFilters.hidden=true; this.input.value = '';if(this.datePicker){this.datePicker.close(false);this.datePicker.applied={mode:this.kind==='messages'?'On':'Between',start:'',end:''};this.dates={from:'',to:''};this.dateLabel='';this.dateChip.hidden=true;this.dateToggle.setAttribute('aria-expanded','false');} this.bar.hidden = true;this.syncHeaderSearch(); this.toggle.hidden = Boolean(this.trigger); this.host.hidden = Boolean(this.trigger); this.toggle.setAttribute('aria-expanded','false'); this.trigger?.setAttribute('aria-expanded','false'); this.dismiss(); if(focus) (this.trigger || this.toggle).focus(); }
    restoreHeaderSearch(){const saved=this.hiddenHeader;if(!saved)return;const {header,display,priority}=saved;if(header.style.getPropertyValue('display')==='none' && header.style.getPropertyPriority('display')==='important'){if(display)header.style.setProperty('display',display,priority);else header.style.removeProperty('display');}this.hiddenHeader=null;this.host.removeAttribute('data-header-search');}
    syncHeaderSearch(){
      if(this.kind!=='messages')return;const header=A.query(A.selectors.header,this.container),active=!this.bar.hidden && Boolean(header);
      if(this.hiddenHeader && (!active || this.hiddenHeader.header!==header))this.restoreHeaderSearch();
      if(!active)return;
      if(this.hiddenHeader && this.hiddenHeader.width!==this.layoutWidth){const {display,priority}=this.hiddenHeader;if(display)header.style.setProperty('display',display,priority);else header.style.removeProperty('display');const height=A.searchToolbarHeight?.(this.container) || header.getBoundingClientRect().height;if(height>0)this.host.style.setProperty('--rcs-native-header-height',height+'px');this.hiddenHeader.width=this.layoutWidth;header.style.setProperty('display','none','important');}
      if(!this.hiddenHeader){const height=A.searchToolbarHeight?.(this.container) || header.getBoundingClientRect().height;if(height>0)this.host.style.setProperty('--rcs-native-header-height',height+'px');this.hiddenHeader={header,width:this.layoutWidth,display:header.style.getPropertyValue('display'),priority:header.style.getPropertyPriority('display')};header.style.setProperty('display','none','important');}
      this.host.setAttribute('data-header-search','');this.host.hidden=false;if(this.host.parentNode!==header.parentNode || this.host.nextSibling!==header)header.parentNode.insertBefore(this.host,header);
    }
    updateLayout() {
      let compact=false;
      for(let current=this.container;current;current=current.parentElement || current.getRootNode()?.host) {
        if(current.id==='resizable'){compact=true;break;}
      }
      const width=this.container.getBoundingClientRect().width;this.layoutWidth=width;if(this.hiddenHeader)this.syncHeaderSearch();
      if(this.kind==='messages' && width>0 && width<=440)compact=true;
      this.host.toggleAttribute('data-rcs-compact',compact);
      this.triggerHost?.toggleAttribute('data-rcs-compact',compact);this.headerActions?.sync();
      if(this.kind==='messages'){const appearance=[...controls.values(),...[...retainedLists.values()].map(value=>value.control)].find(control=>control.host?.getAttribute('data-rcs-ui')==='list' && control.nativeAppearance)?.nativeAppearance;if(appearance && appearance!==this.nativeAppearance){for(const key of Object.keys(this.nativeAppearance || {}))if(!(key in appearance))this.host.style.removeProperty(key);for(const [key,value]of Object.entries(appearance))this.host.style.setProperty(key,value);this.nativeAppearance=appearance;}}
    }
    sync() {
      this.updateLayout();
      // Hydration can finish after document_idle; align the search bar once the
      // real header and virtual scroller arrive instead of leaving it above Chats.
      this.syncHeaderSearch();const point=A.mountPoint(this.container,this.kind==='messages' ? A.selectors.header : 'rs-room-list-header');if(this.hiddenHeader){point.before=this.hiddenHeader.header;point.ready=true;}this.host.hidden=point.ready===false;
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
      if (!this.panel.hidden) this.scheduleResultsUpdate();
    }
    messageFilterCounts(){const records=index.rooms.get(this.room);return records?C.countMediaTypes(records.values(),this.queryValue(),{...this.queryOptions,dates:this.dates}):null;}
    render() {
      if(this.inputPending)return;
      const query = this.queryValue().trim(); this.clear.hidden = !this.input.value.trim();this.tools?.sync?.();
      const dates=this.dates || {from:'',to:''},bounds=C.dateBounds(dates),searchKey=JSON.stringify([query,dates,this.queryOptions]);
      if(searchKey!==this.lastQuery){this.renderLimit=50;if(this.kind==='messages' && this.lastQuery!==undefined){this.results.scrollTop=0;this.imageViewport=null;this.active=-1;}this.lastQuery=searchKey;}
      const selected=this.hits[this.active] ? this.rowKey(this.hits[this.active]) : '';
      if(this.dateToggle){const parsedDate=C.parseQuery(query),dateActive=bounds.active || Boolean(parsedDate.after.length || parsedDate.before.length);this.dateToggle.classList.toggle('filtered',dateActive);this.dateToggle.setAttribute('aria-pressed',String(dateActive));this.dateChip.hidden=!bounds.active || this.kind==='list' && !this.isGlobal;this.dateChipLabel.textContent=this.datePicker.compactSummary();this.dateChip.title=this.dateLabel || '';this.dateChipLabel.setAttribute('aria-label',`Edit date filter: ${this.dateLabel || ''}`);this.dateChipLabel.setAttribute('aria-haspopup','dialog');this.dateChipLabel.setAttribute('aria-expanded',String(this.datePicker.open));if(this.appliedFilters && !this.tools)this.appliedFilters.hidden=!bounds.active || this.bar.hidden;}
      if (this.kind === 'list') {
        const available = this.container.getBoundingClientRect().bottom - this.host.getBoundingClientRect().bottom;
        this.host.style.setProperty('--rcs-list-height',`${available > 50 ? available : 320}px`);this.host.style.setProperty('--rcs-calendar-height',`${Math.max(180,available-8)}px`);
      } else {const available=this.container.getBoundingClientRect().bottom-this.host.getBoundingClientRect().bottom;this.host.style.setProperty('--rcs-message-height',`${Math.max(110,available-55)}px`);this.host.style.setProperty('--rcs-room-results-height',`${available>0?Math.max(0,available):320}px`);this.host.style.setProperty('--rcs-calendar-height',`${Math.max(180,available-8)}px`);}
      if(this.meta)this.meta.hidden=false;
      const parsed=C.parseQuery(query),queryFeedback=globalThis.RCSGlobalSearchModel?.queryFeedback?.(parsed) || parsed.errors.join(' · ');
      this.hits = parsed.invalid ? [] : this.isGlobal ? this.savedHits : this.kind === 'list' ? [...this.cache.values()].filter(entry => listMatch([entry.name,...(entry.aliases || []),...(entry.participants || []),entry.membership==='invite'?'chat request invitation':'',entry.accountUnavailable ? entry.accountState==='banned' ? 'banned suspended unavailable account' : 'deleted [deleted] unavailable account' : ''].join(' '), query)) : index.search(this.room, query,dates,this.queryOptions || {}).sort((a,b)=>{
        const newest=(Date.parse(b.timestamp)||0)-(Date.parse(a.timestamp)||0);
        if(this.queryOptions?.sort==='oldest')return -newest;
        if(this.queryOptions?.sort==='relevant'){const score=record=>C.relevanceScore(record.text,query,{wholeWord:this.queryOptions?.wholeWord});return score(b)-score(a) || newest;}
        return newest;
      });
      if(selected)this.active=this.hits.findIndex(hit=>this.rowKey(hit)===selected);
      if(this.kind==='list' && !this.isGlobal)this.hits=this.hits.filter(hit=>!(!hit.historicalName && ['[deleted]','Someone','Username unavailable'].includes(hit.name) && (hit.identityPending || !hit.accountUnavailable || this.loading)));
      const showing=this.kind==='list' ? this.isGlobal || this.browseOpen : Boolean(query || bounds.active || this.kind==='messages' && !this.bar.hidden && !this.resultsDismissed);
      this.input.setAttribute('aria-expanded', String(showing));
      // The calendar overlays the global view. Hiding its opaque panel would
      // reveal Reddit's native list underneath while choosing a date.
      this.panel.hidden = !showing || this.kind==='messages' && (this.resultsDismissed || this.bar.hidden) || this.kind!=='messages' && !this.isGlobal && Boolean(this.datePicker?.open);
      if (this.count) this.count.textContent = showing ? `${Math.max(0,this.active + 1)}/${this.hits.length}` : '';
      if (this.prev) { this.prev.disabled = !showing || !this.hits.length; this.next.disabled = this.prev.disabled; }
      if (!showing) return;
      if(this.tools?.renderValueChoices?.())return;
      this.status.textContent = this.kind==='list' && globalThis.RCSDirectory?.getStartup?.().pending ? 'Restoring saved usernames…' : this.loading ? this.progress || (this.kind === 'list' ? 'Searching all conversations…' : 'Searching all messages…') : this.notice || `${this.hits.length} ${this.kind === 'list' ? 'conversation' : 'message'}${this.hits.length === 1 ? '' : 's'}${this.complete ? '' : ' · still connecting'}`;
      if(this.kind==='list' && this.loading && !this.refreshing && globalThis.RCSDirectory?.getStartup?.().entry?.directoryComplete)this.status.textContent=`${this.hits.length} saved conversations · ${this.progress.startsWith('Waiting') ? this.progress.replace(/\s*\(\d+\)$/,'') : this.progress.includes('dates') ? 'Updating dates…' : 'Checking updates…'}`;
      if(this.kind==='messages'){this.status.textContent=bounds.invalid ? 'Choose an end date on or after the start date.' : queryFeedback || this.notice || `${this.hits.length} result${this.hits.length===1?'':'s'}${this.loading ? ` · ${this.progress || 'Searching older messages…'}` : ''}`;this.coverage.hidden=this.complete;this.coverage.textContent='Saved messages only · History may be incomplete';}
      if(this.isGlobal)this.status.textContent=bounds.invalid ? 'Choose an end date on or after the start date.' : queryFeedback || this.notice || (!this.savedStats && this.savedLoading ? 'Searching saved messages…' : `${this.savedTotal} matches · ${this.savedStats?.rooms || 0} saved chats${this.savedSavingError ? ' · Saving paused' : this.savedImporting ? ' · Saving cached messages…' : this.savedLoading ? ' · Searching…' : ''}`);
      if(this.kind==='list' && parsed.invalid)this.status.textContent=queryFeedback;
      this.input.setAttribute('aria-invalid',String(parsed.invalid));
      if(this.isGlobal)this.updateLoad();
      this.status.title=this.savedSavingError ? `${this.status.textContent} · ${this.savedSavingError}` : this.status.textContent;
      if(!parsed.invalid && this.kind==='messages' && !this.hits.length && (this.loading || this.preparingSearch) && globalThis.RCSUnifiedSearch?.createLoadingSkeleton){this.status.textContent='Searching messages…';this.showLoadingResults();return;}this.loadingSkeleton?.remove();this.results.setAttribute('aria-busy','false');
      this.renderResults(query,bounds,true);
    }
    renderResults(query=this.queryValue().trim(),bounds=C.dateBounds(this.dates || {}),rebuild=false,remeasure=false){
      if(this.panel.hidden || this.inputPending || this.tools?.valuePicker?.() || this.loadingSkeleton?.parentNode===this.results)return;
      const wanted=[],dayHeaders=new Map([...this.results.querySelectorAll('.day-heading')].map(el=>[el.dataset.day,el]));let lastDay=null;
      const chronological=this.messageMode && this.queryOptions?.sort!=='relevant';
      const partner=this.kind==='messages' ? this.cache.get(this.room) : null;
      const partnerName=partner?.name || (this.kind==='messages' ? A.text(A.query('.room-name',this.container)) : '');
      const resultWidth=this.results.getBoundingClientRect().width || this.container.getBoundingClientRect().width || 320;
      const excerptMax=Math.max(48,Math.min(240,Math.floor((resultWidth-(this.kind==='messages'?76:90))/6*(this.kind==='messages'?3:2)-8)));
      const signaturePrefix=JSON.stringify([query,this.queryOptions,partnerName,partner?.type,excerptMax,this.messageMode ? false : this.loading]);
      const virtual=this.kind==='messages';let top=this.results.scrollTop;const oldAnchor=virtual && rebuild && this.roomWindowContext===signaturePrefix?this.roomItems?.find(item=>item.offset+item.height>top):null,oldWithin=oldAnchor?top-oldAnchor.offset:0;
      if(virtual && (rebuild || !this.roomItems || this.roomWindowContext!==signaturePrefix)){
        const style=getComputedStyle(this.host),base=parseFloat(style.getPropertyValue('--rcs-row-min-height')) || 64;let offset=0,previousDay=null;
        this.roomItems=this.hits.map((hit,position)=>{const key=this.rowKey(hit),day=chronological?C.dayKey(hit.timestamp):null,heading=chronological && day!==previousDay;previousDay=day;const media=hit.attachmentType==='image'?globalThis.RCSMediaPreview?.fitSize({width:hit.attachmentWidth,height:hit.attachmentHeight}):null;
          this.roomMeasurements ||= new Map();const measurement=this.roomMeasurements.get(key),measureKey=JSON.stringify([hit.text,hit.author,hit.attachmentWidth,hit.attachmentHeight,hit.attachmentType]);const rowHeight=measurement?.context===signaturePrefix && measurement.key===measureKey?measurement.height:Math.max(base,media?48+media.height:(hit.text || '').length>80?96:base);
          const item={key,hit,measureKey,position,day,heading,rowHeight,offset,height:rowHeight+(heading?28:0)};offset+=item.height;return item;});this.roomTotalHeight=offset;this.roomWindowContext=signaturePrefix;if(oldAnchor){const anchor=this.roomItems.find(item=>item.key===oldAnchor.key);if(anchor)top=anchor.offset+oldWithin;}
      }
      const lower=(value)=>{let lo=0,hi=this.roomItems.length;while(lo<hi){const mid=(lo+hi)>>>1,item=this.roomItems[mid];if(item.offset+item.height<=value)lo=mid+1;else hi=mid;}return lo;};
      const viewportAnchor=virtual?this.roomItems[lower(top)]:null,anchorWithin=viewportAnchor?top-viewportAnchor.offset:0;
      const start=virtual?lower(Math.max(0,top-240)):0,end=virtual?Math.min(this.roomItems.length,lower(top+(this.results.clientHeight || 520)+240)+1):this.renderLimit;
      const windowItems=virtual?this.roomItems.slice(start,end):this.hits.slice(0,end).map((hit,position)=>({hit,position}));
      if(virtual){this.roomTopSpacer ||= node('div','room-spacer');this.roomBottomSpacer ||= node('div','room-spacer');this.roomTopSpacer.setAttribute('aria-hidden','true');this.roomBottomSpacer.setAttribute('aria-hidden','true');this.roomBottomSpacer.style.height=Math.max(this.roomTotalHeight,parseFloat(this.roomBottomSpacer.style.height) || 0)+'px';if(!this.roomBottomSpacer.isConnected)this.results.append(this.roomBottomSpacer);const first=windowItems[0],carried=first?.day && !first.heading?28:0;this.roomTopSpacer.style.height=Math.max(0,(first?.offset || 0)-carried)+'px';wanted.push(this.roomTopSpacer);}
      for (const {position:i,hit} of windowItems) {
        if(chronological){const day=C.dayKey(hit.timestamp);if(day!==lastDay){let heading=dayHeaders.get(day);if(!heading){heading=node('h3','day-heading');heading.dataset.day=day;}heading.textContent=C.dayLabel(hit.timestamp);wanted.push(heading);lastDay=day;}}
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
        const signature=signaturePrefix+JSON.stringify([hit.attachmentType,hit.attachmentPreview,hit.attachmentMime,hit.attachmentWidth,hit.attachmentHeight,hit.name,hit.type,hit.membership,hit.status,hit.author,hit.authorSelf,this.cache.get(hit.roomId)?.name,hit.text,hit.timestamp,hit.accountUnavailable,hit.accountState,hit.historicalName]);
        if(row.signature!==signature) {
          row.signature=signature;
          row.name.replaceChildren(!this.messageMode ? highlight(hit.name,query,{shortTermsWholeWord:false}) : document.createTextNode(this.kind==='messages' ? C.messageSender(hit,partner || {}).label : partnerName || C.messageSender(hit,partner || {}).label));
          const unavailable=globalThis.RCSDirectoryModel?.accountMarker?.(hit.accountState).label || 'Unavailable account';
          row.caption.textContent=!this.messageMode ? (hit.accountUnavailable ? hit.historicalName ? unavailable+' · Retained username' : unavailable : 'Open conversation') : hit.timestamp ? C.messageTime(hit.timestamp,{sort:this.queryOptions?.sort}) : '';
          if(!this.messageMode && hit.timestamp && Number.isFinite(new Date(hit.timestamp).getTime())) {
            row.caption.textContent=`${this.formatTime(hit.timestamp)}${hit.accountUnavailable ? ' · '+unavailable : ''}`;
            row.caption.title=`Last conversation activity · ${new Date(hit.timestamp).toLocaleString()}`;
          } else if(!this.messageMode && !this.loading) {
            row.caption.textContent=hit.accountUnavailable ? unavailable+' · Date unavailable' : 'Date unavailable';
            row.caption.title='Reddit has not provided a message timestamp for this conversation.';
          } else row.caption.removeAttribute('title');
          if(this.messageMode)row.caption.title=C.fullTimestamp(hit.timestamp || NaN);
          if(!this.messageMode && (hit.type==='reddit_modmail' || hit.membership==='invite'))row.caption.textContent=`${hit.type==='reddit_modmail'?'Community chat':'Chat'}${hit.membership==='invite'?' · Request pending':''}${hit.timestamp?` · ${this.formatTime(hit.timestamp)}`:''}`;
          if(this.isGlobal)row.caption.textContent=`${this.cache.get(hit.roomId)?.name || 'Saved conversation'}${hit.timestamp ? ` · ${C.messageTime(hit.timestamp,{sort:this.queryOptions?.sort})}` : ''}`;
          if(row.preview) {
            const max=excerptMax-(this.kind==='messages' && hit.authorSelf ? 5 : 0);
            const snippet=C.excerpt?.(hit.text,query,{...this.queryOptions,max}) || {text:hit.text.slice(0,max)};
            const sender=C.messageSender(hit,partner || this.cache.get(hit.roomId) || {});row.preview.classList.toggle('has-image',hit.attachmentType==='image');if(hit.attachmentType==='image' && this.mediaView)row.preview.replaceChildren(this.mediaView.render(hit,{owner:this.savedOwner || globalThis.RCSDirectory?.getOwner?.(),prefix:this.kind==='messages'?'':sender.prefix}));else row.preview.replaceChildren(...(sender.prefix && this.kind!=='messages'?[node('span','you-prefix',sender.prefix)]:[]),highlight(snippet.text,query,{...this.queryOptions,ranges:snippet.ranges}));
            row.preview.classList.toggle('link-snippet',/(?:https?:\/\/|www\.)/i.test(hit.text));
            row.preview.title=hit.text;row.result.setAttribute('aria-label',`${sender.label} sent: ${hit.attachmentType==='image'?(globalThis.RCSMediaPreview?.label(hit) || 'Image'):snippet.text}. In ${partnerName || this.cache.get(hit.roomId)?.name || 'Saved conversation'}. ${C.fullTimestamp(hit.timestamp)}. Open message.`);
          }
        }
        const avatarUrl=hit.avatar || '',speaker=!this.messageMode ? hit.name : this.kind==='messages' ? C.messageSender(hit,partner || {}).label : partnerName || (hit.authorSelf ? 'You' : hit.author);
        if(row.avatar && (row.avatarUrl!==avatarUrl || !row.image?.isConnected && row.avatarLabel!==speaker)) {
          if(row.image){this.avatarObserver?.unobserve(row.image);this.pendingAvatarSources.delete(row.image);}
          row.avatarUrl=avatarUrl;row.avatarLabel=speaker;row.avatar.textContent=(speaker || '').replace(/^u\//,'').slice(0,1).toUpperCase();
          if(!speaker || speaker.startsWith('@') || speaker==='Sender unavailable')row.avatar.innerHTML=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">${icons.person}</svg>`;
          try {
            const url=new URL(avatarUrl,location.href);
            if(avatarUrl && (url.protocol==='https:' || /^data:image\/(png|jpeg|webp|svg\+xml)[;,]/.test(avatarUrl))) {
              const image=node('img');image.alt='';image.referrerPolicy='no-referrer';
              // An avatar the browser already shows (Reddit's chat, or an earlier result) needs no
              // placeholder letter, no hidden phase and no wait for the visibility observer.
              if(knownAvatar(avatarUrl)){image.src=avatarUrl;image.decoding='sync';row.image=image;row.avatar.replaceChildren(image);wanted.push(row.result);continue;}
              image.style.visibility='hidden';image.addEventListener('load',()=>{rememberAvatar(avatarUrl);
                image.style.visibility='visible';
                if(image.parentNode===row.avatar)for(const child of [...row.avatar.childNodes])if(child!==image)child.remove();
              },{once:true});
              image.addEventListener('error',()=>{if(image.parentNode===row.avatar){row.avatar.textContent=(speaker || '').replace(/^u\//,'').slice(0,1).toUpperCase();if(!speaker || speaker.startsWith('@') || speaker==='Sender unavailable')row.avatar.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true">${icons.person}</svg>`;}},{once:true});
              image.loading='lazy';image.decoding='async';row.image=image;
              row.avatar.append(image);
              if(this.avatarObserver){this.pendingAvatarSources.set(image,avatarUrl);this.avatarObserver.observe(image);}
              else image.src=avatarUrl;
            }
          } catch { /* Keep the initial for an invalid image URL. */ }
        }
        wanted.push(row.result);
      }
      // Keep a bounded cache of detached rows so scrolling can reuse decoded avatars.
      const visible=new Set(wanted);
      for(const heading of dayHeaders.values())if(!visible.has(heading))heading.remove();
      for(const row of this.rows.values()){const isVis=visible.has(row.result);row.result.hidden=!isVis;row.result.classList.toggle('result',isVis);if(!isVis)row.result.remove();}
      if(virtual){while(this.rows.size>160){const entry=[...this.rows].find(([,row])=>!visible.has(row.result));if(!entry)break;const [key,row]=entry;if(row.image){this.avatarObserver?.unobserve(row.image);this.pendingAvatarSources.delete(row.image);}this.rows.delete(key);}wanted.push(this.roomBottomSpacer);}
      for(const extra of this.results.querySelectorAll('.empty,.hint,.saved-more'))extra.remove();
      let position=this.results.firstElementChild;
      for(const result of wanted) {
        if(result!==position)this.results.insertBefore(result,position);
        position=result.nextElementSibling;
      }
      if(virtual){const last=windowItems.at(-1);this.roomBottomSpacer.style.height=Math.max(0,last?this.roomTotalHeight-last.offset-last.height:0)+'px';if(Math.abs(this.results.scrollTop-top)>.5)this.results.scrollTop=top;
        let changed=false;for(const item of windowItems){const row=this.rows.get(item.key);if(!row || !remeasure && row.measureKey===item.measureKey && row.measureContext===signaturePrefix)continue;const height=Math.ceil(row.result.getBoundingClientRect().height);if(!height)continue;row.measuredHeight=height;row.measureKey=item.measureKey;row.measureContext=signaturePrefix;this.roomMeasurements.set(item.key,{key:item.measureKey,context:signaturePrefix,height});while(this.roomMeasurements.size>5000)this.roomMeasurements.delete(this.roomMeasurements.keys().next().value);if(height!==item.rowHeight){item.rowHeight=height;item.height=height+(item.heading?28:0);changed=true;}}
        if(changed){let offset=0;for(const item of this.roomItems){item.offset=offset;offset+=item.height;}this.roomTotalHeight=offset;const nextTop=viewportAnchor?viewportAnchor.offset+anchorWithin:top;this.roomBottomSpacer.style.height=offset+'px';this.results.scrollTop=nextTop;this.renderResults(query,bounds);return;}
      }
      if(this.isGlobal && !this.hits.length)this.results.append(node('div','empty',this.savedLoading ? 'Searching saved messages…' : this.notice || (this.savedStats?.messages ? 'No matching saved messages. Try another word.' : 'No saved messages yet. Messages Reddit loads will become searchable here.')));
      else if (!this.hits.length) this.results.append(node('div', 'empty', this.loading ? this.kind==='list' ? 'Loading your conversations…' : 'Searching your history in the background…' : this.kind === 'list' ? 'No matching usernames. Try a shorter name.' : !query && !bounds.active ? 'No recent messages are available yet.' : `No messages match ${query ? '“'+query+'”' : 'these dates'}. Try removing a filter.`));
      if(this.isGlobal && this.savedHasMore){const more=node('button','load saved-more',this.savedLoading ? 'Loading…' : `Load more (${this.savedHits.length} of ${this.savedTotal})`);more.disabled=this.savedLoading;more.addEventListener('click',()=>this.querySaved(true));this.results.append(more);}
      if(!virtual && this.hits.length>this.renderLimit)this.results.append(node('div','hint',`Showing ${this.renderLimit} of ${this.hits.length}. Scroll for more.`));
    }
    formatTime(value) { if(C.compactTime)return C.compactTime(value);const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}); }
    move(direction,jump=false) {
      const total = this.hits.length; if (!total) return;
      const next=this.active<0 ? (direction<0 ? total-1 : 0) : (this.active+direction+total)%total;
      if(next>=this.renderLimit)this.renderLimit=Math.ceil((next+1)/50)*50;
      this.active=next;
      if(this.kind==='messages' && this.roomItems && !this.rows.get(this.rowKey(this.hits[next]))?.result.isConnected){const item=this.roomItems[next],top=this.results.scrollTop,bottom=top+(this.results.clientHeight || 520);if(item){if(item.offset<top+28)this.results.scrollTop=Math.max(0,item.offset-28);else if(item.offset+item.height>bottom)this.results.scrollTop=item.offset+item.height-(this.results.clientHeight || 520);}}
      this.render();
      const result=this.rows.get(this.rowKey(this.hits[this.active]))?.result;
      if(result){const row=result.getBoundingClientRect(),viewport=this.results.getBoundingClientRect(),sticky=this.results.querySelector('.day-heading')?.getBoundingClientRect().height || 0,top=viewport.top+sticky;if(row.top<top)this.results.scrollTop-=top-row.top;else if(row.bottom>viewport.bottom)this.results.scrollTop+=row.bottom-viewport.bottom;}
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
      const navigation=this.navigationGeneration=(this.navigationGeneration || 0)+1;
      this.jumpTask?.cancel?.();clearTimeout(this.jumpRetry);
      const room=hit.roomId || this.room;
      const reveal=(attempts=40)=>{
        if(navigation!==this.navigationGeneration || !this.host.isConnected)return false;
        const current=A.roomKey(this.container)===room && A.messages(this.container,{includeNontext:true}).find(message=>message.id===hit.id);
        if(current){this.dismiss();A.revealMessage?.(current.element,this.queryValue(),this.queryOptions || {});return true;}
        if(attempts>0)this.jumpRetry=setTimeout(()=>reveal(attempts-1),100);
        else this.status.textContent='Message could not be displayed. Retry opening it.';
        return false;
      };
      if(A.roomKey(this.container)===room && A.messages(this.container,{includeNontext:true}).some(message=>message.id===hit.id)){reveal(0);return;}
      if (globalThis.RCSData) {
        this.status.textContent='Opening message…';
        try {this.jumpTask=RCSData.request('jump',{roomId:room,eventId:hit.id,thread:Boolean(hit.thread)},progress=>{if(navigation===this.navigationGeneration && progress.label)this.status.textContent=progress.label;});await this.jumpTask.promise;if(navigation!==this.navigationGeneration)return;this.dismiss();reveal();}
        catch(error) {if(navigation===this.navigationGeneration)this.status.textContent=error.message;}
        return;
      }
      this.status.textContent = 'Reddit chat is not connected yet. Please retry.';
    }
    cancelLoad(showNotice=false) {
      this.cancelInput();
      if(showNotice)this.stoppedByUser=true;
      this.savedGeneration++;clearTimeout(this.savedTimer);this.savedLoading=false;this.savedDirty=false;this.savedKey='';
      this.dataTask?.cancel();this.dataTask=null;this.loading=false;this.updateLoad();
      if(showNotice) {this.notice='Search stopped. Results may be incomplete.';this.render();}
    }
    async ensureData(force=false,reconcile=false) {
      if(this.inputPending)return;
      if(this.tools?.suggestions?.hidden===false && !this.tools.suggestionsAtBoundary || this.tools?.valuePicker?.() || C.parseQuery(this.queryValue()).invalid)return;
      if(this.isGlobal){if(force)this.savedKey='';this.querySaved(false,force,force);return;}
      if(this.kind==='messages'){const generation=this.savedGeneration;this.preparingSearch=(this.preparingSearch || 0)+1;this.updateLoad();try{await this.readSavedRoom();}finally{this.preparingSearch=Math.max(0,this.preparingSearch-1);this.updateLoad();}if(generation!==this.savedGeneration || !this.host.isConnected || !globalThis.document)return;}
      const dateKey=JSON.stringify(this.dates || {});
      if(this.kind==='messages' && !force && !this.queryValue().trim() && !this.dates?.from && !this.dates?.to){this.render();return;}
      if(!globalThis.RCSData || this.loading || (this.complete && !force && !reconcile) || this.kind==='messages' && !force && this.dateCompleteKey===dateKey){if(this.kind==='messages')this.render();return;}
      this.refreshing=force;
      this.stoppedByUser=false;
      this.loading=true;this.notice='';this.progress='';this.updateLoad();
      const room=this.room;
      const task=(this.kind==='list' && globalThis.RCSDirectory ? RCSDirectory.load(force,progress=>{
        if(this.dataTask!==task)return;
        if(progress.records) {for(const record of progress.records)this.cache.set(record.id,{...this.cache.get(record.id),...record});}
        this.progress=`${progress.label} (${progress.loaded})`;
        if(!this.panel.hidden)this.scheduleResultsUpdate();
      }) : RCSData.request(this.kind==='list' ? 'conversations' : 'history',this.kind==='list' ? {} : {roomId:room,refresh:force,dates:this.dates},progress=>{
        if(this.dataTask!==task)return;
        if(this.kind==='messages' && progress.records)index.upsert(room,progress.records,{authoritative:true,redacted:progress.redacted || []});
        this.progress=`${progress.label} (${progress.loaded})`;
        if(!this.panel.hidden)this.scheduleResultsUpdate();
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
        } else {
          // Only a verified-complete snapshot may drop messages it lacks. Missing or partial metadata is incomplete:
          // merge what arrived, never hide or clear what the index already holds.
          const verified=records.historyMeta?.complete===true;
          if(verified)index.replace(room,records,records.historyMeta);else index.upsert(room,records,{authoritative:true,redacted:records.historyMeta?.redacted || []});
          this.complete=verified;this.dateCompleteKey=records.historyMeta?.dateComplete ? JSON.stringify(records.historyMeta.dates || {}) : '';if(this.complete)completeRooms.add(room);else completeRooms.delete(room);}
      } catch(error) { if(this.dataTask===task)this.notice=error.message; }
      finally {if(this.dataTask===task){this.dataTask=null;this.loading=false;if(!globalThis.document || stopped)return;this.updateLoad();if(!this.panel.hidden)this.render();schedule();if(this.kind==='messages' && !this.bar.hidden && !this.notice && dateKey!==JSON.stringify(this.dates || {}) && !this.complete && this.dateCompleteKey!==JSON.stringify(this.dates || {}))this.ensureData();}}
    }
    clearRows(){this.roomItems=null;this.roomMeasurements?.clear();this.avatarObserver?.disconnect();this.pendingAvatarSources.clear();this.rows.clear();this.results.replaceChildren();}
    destroy() { clearTimeout(this.resultsUpdateTimer);clearTimeout(this.roomReadTimer);this.roomReadTimer=null;this.restoreHeaderSearch();cancelAnimationFrame(this.scrollFrame);this.headerActions?.destroy();this.jumpTask?.cancel?.();clearTimeout(this.jumpRetry);this.navigationGeneration=(this.navigationGeneration || 0)+1;document.removeEventListener('keydown',this.shortcut,true);this.datePicker?.close(false);this.imageViewport=null;this.mediaView?.clear();A.releaseSearchLayer?.(this.host);this.tools?.destroy?.();this.savedUnsubscribe?.();this.cancelLoad();this.resizeObserver?.disconnect();this.avatarObserver?.disconnect();this.pendingAvatarSources.clear();document.removeEventListener('pointerdown',this.outside); this.host.remove(); this.triggerHost?.remove(); }
  }
  globalThis.RCSDirectory?.onChange(value=>{
    if(value.accountChanged)clearRetainedLists();
    if(value.accountStates) {
      // A deleted-or-banned lookup finished: reflect it in the shared records without reloading anything.
      for(const state of value.accountStates)for(const [id,record] of directory) {
        if(record.participantIds?.length!==1 || record.participantIds[0]!==state.id)continue;
        directory.set(id,{...record,...(state.accountState ? {accountState:state.accountState} : {}),
          identities:(record.identities || []).map(person=>person.id===state.id ? {...person,...(state.accountState ? {accountState:state.accountState} : {}),accountStateCheckedAt:state.accountStateCheckedAt} : person)});
      }
      for(const control of controls.values())if(!control.panel.hidden)control.render();
      schedule();
      return;
    }
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
    if(value.evicted){index.rooms.delete(value.roomId);index.redacted.delete(value.roomId);completeRooms.delete(value.roomId);return;}
    index.upsert(value.roomId,value.records || [],{authoritative:true,redacted:value.redacted || []});
    value.complete ? completeRooms.add(value.roomId) : completeRooms.delete(value.roomId);
    for(const control of controls.values())if(control.kind==='messages' && control.room===value.roomId) {
      control.complete=Boolean(value.complete);
      if(value.dateInvalidated)control.dateCompleteKey='';
      if(!control.panel.hidden)control.scheduleResultsUpdate();
      if(!value.identityOnly && !value.complete && !control.bar.hidden && !control.stoppedByUser)control.ensureData();
    }
  });
  // Ordinary Reddit pages have no chat. Finding the floating shell means scanning
  // every div, so after a probe finds nothing the scan backs off (1.8 s up to 30 s)
  // until chat appears, a candidate node is added, or the page announces its chat.
  let idle=false,probeDelay=1800,probeAt=0;
  const maxProbeDelay=30000;
  const chatSelector='rs-app, rs-room, [data-testid="chat-room-list"], [data-testid="chat-room"]';
  const wakeProbe=()=>{idle=false;probeDelay=1800;probeAt=0;};
  const chatCandidate=node=>node.nodeType===1 && Boolean(node.shadowRoot || node.localName?.startsWith('rs-') || node.matches?.(chatSelector));
  function schedule() {
    if (scheduled || stopped) return; scheduled = true;
    refreshTimer=setTimeout(() => { refreshTimer=null;scheduled = false; refresh(); },120);
  }
  function composedParent(node){return node.parentElement || node.host || node.getRootNode?.().host;}
  function extensionNode(node){for(let current=node;current;current=composedParent(current))if(current.matches?.('[data-rcs-ui]'))return true;return false;}
  const routeSelector=A.selectors.list+', rs-app, #resizable, rs-room-list-header, rs-rooms-nav-filter';
  function routeMutation(record){
    if(record.type==='attributes'){
      if(record.target.matches?.(routeSelector))return true;
      // Responsive routes can toggle a wrapper instead of the sidebar itself.
      for(const control of controls.values())if(control.kind==='list')for(let current=control.container;current;current=composedParent(current))if(current===record.target)return true;
      return false;
    }
    if(record.type==='childList' && [...record.addedNodes,...record.removedNodes].some(node=>!extensionNode(node) && (node.matches?.(routeSelector) || node.querySelector?.(routeSelector))))return true;
    for(let current=record.target;current;current=composedParent(current)){
      if(current.matches?.('rs-room-list-header, rs-rooms-nav-filter'))return true;
      if(current.matches?.(A.selectors.row+', '+A.selectors.room))return false;
    }
    return false;
  }
  function scheduleNavigation(){
    if(stopped || fastScheduled)return;
    clearTimeout(refreshTimer);refreshTimer=null;scheduled=true;fastScheduled=true;
    // Mutation delivery precedes paint: remount retained search with the native
    // sidebar, rather than showing Reddit's list during the ordinary debounce.
    queueMicrotask(()=>{fastScheduled=false;scheduled=false;if(stopped || !globalThis.document?.documentElement)return;refresh();
      cancelAnimationFrame(navigationFrame);let remaining=2;
      const follow=()=>{navigationFrame=0;if(stopped || !globalThis.document?.documentElement || document.hidden)return;
        const pending=retainedLists.size || [...controls.values()].some(control=>control.host.hidden && A.visible(control.container));
        if(!pending)return;refresh();if(--remaining>0)navigationFrame=requestAnimationFrame(follow);
      };
      // Catch shadow roots attached during this route's Lit render. This is a
      // bounded UI discovery pass, not a new heartbeat or network operation.
      navigationFrame=requestAnimationFrame(follow);
    });
  }
  function mutationsChanged(records){
    if(stopped || !globalThis.document?.documentElement)return;
    if(idle && Date.now()<probeAt){
      // No chat on this page: only a node that could be chat (or its shell) is worth a scan.
      if(!records.some(record=>record.type==='childList' && [...record.addedNodes].some(chatCandidate)))return;
      wakeProbe();
    }
    // Reddit re-rendering a chat (switching conversations) removes our bar with its own nodes. Put it back
    // before the next paint, like a route change, instead of after the 120 ms debounce (a visible collapse).
    const ours=node=>node.nodeType===1 && (node.matches?.('[data-rcs-ui]') || Boolean(node.querySelector?.('[data-rcs-ui]')));
    const lostOurs=records.some(record=>record.type==='childList' && [...record.removedNodes].some(ours) && [...record.removedNodes].some(node=>!extensionNode(node)));
    const native=records.filter(record=>!extensionNode(record.target) && !(record.type==='childList' && [...record.addedNodes,...record.removedNodes].length && [...record.addedNodes,...record.removedNodes].every(extensionNode)));
    if(lostOurs){scheduleNavigation();return;}
    if(!native.length)return;
    if(native.some(routeMutation))scheduleNavigation();else schedule();
  }
  function refresh() {
    if (stopped || !globalThis.document?.documentElement || document.hidden) return;
    if (idle && Date.now()<probeAt) return;
    const roots = A.chatRoots();
    if (!roots.length && !controls.size && !observed.size && !retainedLists.size && !collapsedControl && !openListRequested) {
      idle=true;probeAt=Date.now()+probeDelay;probeDelay=Math.min(probeDelay*2,maxProbeDelay);return;
    }
    idle=false;probeDelay=1800;
    const liveRoots = new Set(roots);
    for (const [root, observer] of observed) if (!liveRoots.has(root)) { observer.disconnect(); observed.delete(root); }
    for (const root of roots) if (!observed.has(root)) {
      const observer = new MutationObserver(mutationsChanged);
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
    for(const [container,control] of controls)if(!live.has(container) || !control.host.isConnected){
      if(control.kind==='list' && typeof control.suspend==='function'){
        control.suspend();if(container.isConnected && control.host.isConnected)continue;
        const owner=control.owner || globalThis.RCSDirectory?.getOwner?.(),context=control.listContext || listContext(container);
        if(owner){const old=retainedLists.get(context);if(old?.control!==control)old?.control.destroy();retainedLists.delete(context);retainedLists.set(context,{owner,control});while(retainedLists.size>4){const key=retainedLists.keys().next().value;retainedLists.get(key).control.destroy();retainedLists.delete(key);}controls.delete(container);continue;}
      }
      control.destroy();controls.delete(container);
    }
    for (const [container,kind] of live) {
      if(!controls.has(container)){
        const context=listContext(container),retained=kind==='list'?retainedLists.get(context):null,owner=globalThis.RCSDirectory?.getOwner?.();
        if(retained && owner && retained.owner===owner){retainedLists.delete(context);retained.control.resume(container);controls.set(container,retained.control);}
        else{if(retained){retained.control.destroy();retainedLists.delete(context);}const control=new SearchControl(container,kind);if(kind==='list')control.listContext=context;controls.set(container,control);}
      }else{const control=controls.get(container);if(control.suspended)control.resume(container);else control.sync();}
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
  // The heartbeat's refresh returns immediately while the probe back-off applies, so it is a bare timer wake on pages without chat.
  const heartbeat = setInterval(refresh,1800);
  const observer = new MutationObserver(mutationsChanged); observer.observe(document,{childList:true,subtree:true});
  document.addEventListener('visibilitychange',schedule);
  // Reddit's page world announces chat components as they connect.
  for(const name of ['rcs-chat-present','rcs-chat-starting'])document.addEventListener(name,()=>{wakeProbe();schedule();});
  window.addEventListener('pagehide',event => {
    if (event.persisted) return;
    stopped = true; clearInterval(heartbeat);clearTimeout(refreshTimer);cancelAnimationFrame(navigationFrame);observer.disconnect();
    for (const observer of observed.values()) observer.disconnect();
    clearRetainedLists();for (const control of controls.values()) control.destroy(); index.clear();
    directory.clear();completeRooms.clear();
    globalThis.RCSNativeLabels?.clear();
    collapsedControl?.host.remove();
  });
  refresh();
})();
