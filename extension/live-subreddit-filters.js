/* Keep native community feeds and search results in charge of loading and rendering. */
(() => {
  'use strict';
  if (window.top !== window || globalThis.RTLiveSubredditFilters) return;
  const filters = globalThis.RTFeedFilters;
  const sheet = globalThis.RTFeedSheet;
  if (!filters || !sheet) return;

  const hidden = 'data-rt-community-filtered';
  const paused = 'data-rt-community-paused';
  const resultsSelector = '[data-testid="search-sdui-post"],[data-testid="search-sdui-comment"]';
  const flairKey = 'rt-community-flairs-v1';
  const searchSorts = [['relevance','Relevance','search'], ['new','New','new'], ['top','Top','top'], ['hot','Hot','hot'], ['comments','Most comments','comment']];
  const searchDates = [['all','All time'], ['hour','Past hour'], ['day','Past 24 hours'], ['week','Past week'], ['month','Past month'], ['year','Past year']];
  const resultTypes = [['posts','Posts','text-post'], ['comments','Comments','comment'], ['media','Media','image']];
  const fold = value => String(value || '').toLowerCase();

  function route(url = location) {
    const match = /^\/r\/([a-z0-9_]{2,21})(?:\/(best|hot|new|top|rising|controversial|search))?\/?$/i.exec(url.pathname);
    if (!match || ['all','popular'].includes(fold(match[1]))) return null;
    return {name: match[1], kind: fold(match[2]) === 'search' ? 'search' : 'feed'};
  }

  function flairName(value) {
    const label = String(value || '').trim();
    return label.length <= 100 && !/[\u0000-\u001f]/.test(label) ? label : '';
  }

  function feedFlair(url) {
    const text = url.searchParams.get('f') || '';
    const quoted = /^flair_name:("(?:[^"\\]|\\.)*")$/i.exec(text);
    if (!quoted) return '';
    try { return flairName(JSON.parse(quoted[1])); } catch { return ''; }
  }

  function searchParts(url) {
    const query = (url.searchParams.get('q') || '').trim();
    const match = /(?:^|\s)flair:("(?:[^"\\]|\\.)*")$/i.exec(query);
    if (match) {
      try {
        const flair = flairName(JSON.parse(match[1]));
        if (flair) return {query: query.slice(0, match.index).trim(), flair};
      } catch {}
    }
    return {query, flair: ''};
  }

  function withFlair(url, label) {
    const next = new URL(url);
    const value = flairName(label);
    const scope = route(next);
    if (!scope) return next;
    if (scope.kind === 'feed') {
      if (value) next.searchParams.set('f', 'flair_name:' + JSON.stringify(value));
      else next.searchParams.delete('f');
    } else {
      const {query} = searchParts(next);
      const base = query || 'subreddit:' + scope.name;
      next.searchParams.set('q', value ? base + ' flair:' + JSON.stringify(value) : base);
    }
    return next;
  }

  function setSearchOption(url, key, value) {
    const next = new URL(url);
    next.searchParams.set(key, value);
    for (const name of ['iId','cId','cursor','after','before']) next.searchParams.delete(name);
    return next;
  }

  function searchUrl(url, subreddit) {
    if (route(url)?.kind === 'search') return url;
    const result = new URL('/r/' + subreddit + '/search/', url);
    result.searchParams.set('q', 'subreddit:' + subreddit);
    result.searchParams.set('type', 'posts');
    result.searchParams.set('sort', 'new');
    const flair = feedFlair(url);
    return flair ? withFlair(result, flair) : result;
  }

  function navigate(url) {
    const link = document.createElement('a');
    link.href = url.href;
    link.hidden = true;
    document.body.append(link);
    try { link.click(); } finally { link.remove(); }
  }

  function make(tag, name, text) {
    const node = document.createElement(tag);
    if (name) node.className = name;
    if (text) node.textContent = text;
    return node;
  }

  function scopedField(event, scope) {
    const path = event.composedPath();
    const input = path[0];
    const host = path.find(node => node.matches?.('reddit-search-large,reddit-search-small'));
    const field = path.find(node => node.matches?.('faceplate-search-input[name="q"]'));
    const form = path.find(node => node.matches?.('form'));
    const chips = '.scoped-search-pill,rpl-input-chip[slot="chips"],#search-input-remove-filter,#search-input-chip';
    if (!input?.matches?.('input[name="q"],textarea[name="q"]') || !host || !form ||
        !(field?.querySelector(chips) || form.querySelector(chips))) return null;
    try {
      const value = JSON.parse(host.getAttribute('scope'));
      if (value?.type === 'community' && fold(value.name) === fold(scope.name) &&
          fold(value.path).replace(/\/$/, '') === '/r/' + fold(scope.name)) return input;
    } catch {}
    return null;
  }

  function loadFlairs() {
    try {
      const values = JSON.parse(sessionStorage.getItem(flairKey) || '[]');
      return new Map(values.filter(entry => Array.isArray(entry) && Array.isArray(entry[1])).slice(-8));
    } catch { return new Map(); }
  }

  class Controller {
    constructor({navigate: go = navigate, enabled = true} = {}) {
      this.navigate = go;
      this.enabled = enabled;
      this.hidden = new Set();
      this.flairs = loadFlairs();
      this.links = new Map();
      this.onRoute = () => {
        this.panel?.close();
        this.schedule();
      };
      this.onKeys = event => this.handleKey(event);
      this.onFocus = event => this.prepareInput(event);
      this.observer = new MutationObserver(records => {
        if (!this.enabled || (!this.scope && !route())) return;
        if (records.some(record => {
          if (record.target.closest?.('[data-rt-ui]')) return false;
          return [...record.addedNodes, ...record.removedNodes].some(node =>
            node.nodeType === 1 && !node.matches('[data-rt-ui]'));
        })) this.schedule();
      });
      this.observer.observe(document, {childList:true, subtree:true});
      window.addEventListener('popstate', this.onRoute);
      document.addEventListener('reddit:route', this.onRoute);
      document.addEventListener('keydown', this.onKeys, true);
      document.addEventListener('focusin', this.onFocus, true);
      this.refresh();
    }

    schedule() {
      if (this.queued || this.dead) return;
      this.queued = true;
      queueMicrotask(() => {
        this.queued = false;
        if (!this.dead) this.refresh();
      });
    }

    clearHidden() {
      for (const node of this.hidden) node.removeAttribute(hidden);
      this.hidden.clear();
    }

    restoreLinks() {
      for (const [link, {original, applied}] of this.links) {
        if (link.getAttribute('href') === applied) link.setAttribute('href', original);
      }
      this.links.clear();
    }

    setEnabled(enabled) {
      if (this.enabled === enabled) return;
      this.enabled = enabled;
      this.refresh();
    }

    clear() {
      this.panel?.close();
      this.toolbar?.remove();
      this.note?.remove();
      this.toolbar = this.note = this.feed = this.main = this.scope = null;
      this.clearHidden();
      this.clearPager();
      this.restoreLinks();
    }

    refresh() {
      const url = new URL(location.href);
      const scope = this.enabled && route(url);
      const main = document.querySelector('main');
      const feed = scope?.kind === 'feed' && main?.querySelector('shreddit-feed');
      const tabs = scope?.kind === 'search' && document.querySelector('#search-results-page-tabgroup');
      const search = scope?.kind === 'search' && (tabs || main?.querySelector('[slot="filters"],[data-testid="search-sdui-post"],[data-testid="search-error-message"]'));
      if (!scope || !main || (!feed && !search) || main.closest('[data-rt-ui]') || main.querySelector('[data-rt-ui="archive-subreddit"]') ||
          document.querySelector('[data-rt-ui="archive-subreddit"]')) {
        this.clear();
        return;
      }
      // Native SPA changes the URL before replacing its outgoing feed.
      const reloadUrl = feed && feed.getAttribute('reload-url');
      const name = reloadUrl && new URL(reloadUrl,location.href).searchParams.get('name');
      if (name && fold(name) !== fold(scope.name)) return;
      if (this.main !== main || this.feed !== feed || this.scope?.kind !== scope.kind || fold(this.scope?.name) !== fold(scope.name)) {
        this.clear();
        this.main = main;
        this.feed = feed;
        this.scope = scope;
      }
      this.url = url;
      if (!this.toolbar?.isConnected) this.mount(tabs);
      this.collectFlairs();
      this.filterResults();
      this.updateToolbar();
      this.updateLinks();
      if (!this.feed) this.prepareBrowseHeader();
    }

    mount(tabs) {
      const bar = this.toolbar = make('div','rt-community-controls');
      bar.dataset.rtUi = 'community-filters';
      const options = this.options = make('button','rt-search-inline-filter rt-community-button','Filters');
      options.type = 'button';
      options.dataset.rtCommunityOptions = '';
      options.setAttribute('aria-haspopup','dialog');
      options.setAttribute('aria-expanded','false');
      options.prepend(filters.svgIcon('filter',16));
      options.append(filters.svgIcon('caret-down',16));
      options.addEventListener('click', () => this.open());
      bar.append(options);
      if (this.feed) {
        const browse = this.browse = make('a','rt-search-inline-filter rt-community-button','Browse posts');
        browse.prepend(filters.svgIcon('search',16));
        browse.addEventListener('click',event => {
          if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.button !== 0) return;
          event.preventDefault();
          this.navigate(new URL(browse.href));
        });
        bar.append(browse);
      }
      this.chips = make('div','rt-community-chips rt-filter-chips');
      bar.append(this.chips);
      if (this.feed) this.feed.before(bar);
      else if (tabs?.parentElement) tabs.parentElement.after(bar);
      else this.main.prepend(bar);
    }

    collectFlairs() {
      const key = fold(this.scope.name);
      const labels = new Set(this.flairs.get(key) || []);
      const remember = value => { if (value && labels.size < 40) labels.add(value); };
      for (const link of document.querySelectorAll('a[href*="flair_name"]')) {
        const url = new URL(link.href);
        if (url.origin === location.origin && fold(route(url)?.name) === key) remember(feedFlair(url));
      }
      if (this.feed) for (const node of this.feed.querySelectorAll('shreddit-post [slot="post-flair"]')) {
        remember(flairName(node.textContent));
      }
      if (labels.size === (this.flairs.get(key)?.length || 0)) return;
      this.flairs.delete(key);
      this.flairs.set(key,[...labels]);
      while (this.flairs.size > 8) this.flairs.delete(this.flairs.keys().next().value);
      try { sessionStorage.setItem(flairKey,JSON.stringify([...this.flairs])); } catch {}
    }

    clearPager() {
      this.paging?.pager?.removeAttribute(paused);
      this.paging = null;
    }

    filterResults() {
      const types = this.feed ? filters.parse(this.url.search).types : [];
      const period = this.feed ? '' : this.url.searchParams.get('t');
      const date = period && filters.dateRange({date:{preset:period === 'day' ? '24h' : period}});
      const next = new Set();
      let matching = 0;
      if (types.length) {
        const wanted = new Set(types);
        for (const card of this.feed.querySelectorAll('shreddit-post')) {
          const unit = card.closest('article') || card;
          const parent = unit.parentElement;
          if (parent !== this.feed && !parent?.matches('faceplate-batch,faceplate-partial')) continue;
          if (card.parentElement?.closest('shreddit-post,shreddit-ad-post')) continue;
          if (wanted.has(filters.inferType(card))) matching++;
          else {
            next.add(unit);
            if (unit.nextElementSibling?.tagName === 'HR') next.add(unit.nextElementSibling);
          }
        }
      }
      if (date) for (const unit of this.main.querySelectorAll(resultsSelector)) {
        // New and some other sorts may ignore t on Reddit's server.
        const time = unit.querySelector('faceplate-timeago[ts],time[datetime]');
        const seconds = Date.parse(time?.getAttribute('ts') || time?.getAttribute('datetime') || '') / 1000;
        if (seconds >= date.after) matching++;
        else next.add(unit);
      }
      for (const node of this.hidden) if (!next.has(node)) node.removeAttribute(hidden);
      for (const node of next) if (!this.hidden.has(node)) node.setAttribute(hidden,'');
      this.hidden = next;

      const needsMore = (types.length || date) && next.size && !matching;
      if (!needsMore) {
        this.clearPager();
        this.note?.remove();
        return;
      }
      // When all cards collapse, the next native loader can stay in view and
      // request many pages without a scroll. Pause after two empty continuations.
      const pager = this.feed
        ? [...this.feed.querySelectorAll('faceplate-partial[slot="load-after"]')].at(-1)
        : [...this.main.querySelectorAll('faceplate-partial[loading="lazy"][src*="/search/"]')].at(-1);
      const key = this.url.href;
      const previous = this.paging;
      let emptyPages = previous?.key === key ? previous.emptyPages : 0;
      if (previous?.pager && previous.pager !== pager) {
        previous.pager.removeAttribute(paused);
        if (previous.key === key) emptyPages++;
      }
      this.paging = {key,pager,emptyPages};
      const waiting = Boolean(pager && emptyPages >= 2);
      pager?.toggleAttribute(paused,waiting);
      this.updateNote(date ? 'No loaded results match this date range.' : 'No loaded posts match these types.',waiting);
    }

    updateNote(message, waiting) {
      if (!this.note?.isConnected) {
        this.note = make('div','rt-community-note');
        this.note.dataset.rtUi = 'community-filter-note';
        this.noteText = make('span');
        this.noteText.setAttribute('role','status');
        this.more = make('button','rt-community-button','Load more');
        this.more.type = 'button';
        this.more.dataset.rtCommunityContinue = '';
        this.more.addEventListener('click',() => {
          if (!this.paging?.pager) return;
          this.paging.emptyPages = 0;
          this.filterResults();
        });
        this.note.append(this.noteText,this.more);
        if (this.feed) this.feed.before(this.note);
        else this.toolbar.after(this.note);
      }
      if (this.noteText.textContent !== message) this.noteText.textContent = message;
      this.more.hidden = !waiting;
    }

    updateToolbar() {
      const types = this.feed ? filters.parse(this.url.search).types : [];
      const flair = this.feed ? feedFlair(this.url) : searchParts(this.url).flair;
      const period = !this.feed && searchDates.find(([value]) => value !== 'all' && value === this.url.searchParams.get('t'));
      const key = JSON.stringify([types,flair,period]);
      if (this.browse?.isConnected) this.browse.href = searchUrl(this.url,this.scope.name).href;
      if (this.chips.dataset.state === key) return;
      this.chips.dataset.state = key;
      this.chips.replaceChildren();
      const chip = (id, label, icon, onRemove) => this.chips.append(filters.pill(
        {id,label,icon},{make,glyph:name => filters.svgIcon(name,16),onRemove}
      ));
      for (const type of types) chip('type-' + type,filters.typeLabels[type],filters.typeIcons[type],
        () => this.applyTypes(types.filter(value => value !== type)));
      if (flair) chip('flair',flair,'filter',() => this.go(withFlair(this.url,'')));
      if (period) chip('date',period[1],'calendar',() => this.go(setSearchOption(this.url,'t','all')));
      this.chips.hidden = !this.chips.childElementCount;
    }

    updateLinks() {
      // Carry local types across native feed sort/view/flair changes, and
      // carry sort/date across native search result tabs.
      const used = new Set();
      const types = this.feed && this.url.searchParams.get('rt_type');
      const candidates = this.feed
        ? document.querySelectorAll('a[href*="flair_name"],shreddit-sort-dropdown a,shreddit-layout-switcher a')
        : document.querySelectorAll('#search-results-page-tabgroup a[href],search-sort-dropdown-menu a[href]');
      for (const link of candidates) {
        const old = this.links.get(link);
        const href = link.getAttribute('href');
        const original = old?.applied === href ? old.original : href;
        if (!original) continue;
        const url = new URL(original,this.url);
        const target = route(url);
        if (url.origin !== this.url.origin || fold(target?.name) !== fold(this.scope.name) || target.kind !== this.scope.kind) continue;
        if (this.feed) {
          if (!types) continue;
          url.searchParams.set('rt_type',types);
        } else {
          if (!url.searchParams.has('type') || url.searchParams.get('q') !== this.url.searchParams.get('q')) continue;
          const preserve = link.closest('search-sort-dropdown-menu') ? ['t'] : ['sort','t'];
          for (const key of preserve) if (this.url.searchParams.has(key) && !url.searchParams.has(key)) {
            url.searchParams.set(key,this.url.searchParams.get(key));
          }
        }
        const applied = url.pathname + url.search + url.hash;
        if (applied === original) continue;
        if (applied !== href) link.setAttribute('href',applied);
        this.links.set(link,{original,applied});
        used.add(link);
      }
      for (const [link, entry] of this.links) if (!used.has(link)) {
        if (link.getAttribute('href') === entry.applied) link.setAttribute('href',entry.original);
        this.links.delete(link);
      }
    }

    applyTypes(types) {
      const url = new URL(location.href);
      if (types.length) url.searchParams.set('rt_type',types.join(','));
      else url.searchParams.delete('rt_type');
      if (url.href !== location.href) history.replaceState(history.state,'',url.pathname + url.search + url.hash);
      this.refresh();
    }

    go(url) {
      if (url.href !== location.href) this.navigate(url);
    }

    open() {
      if (!this.scope) return;
      if (this.panel) { this.panel.close(); return; }
      const button = this.options;
      const desktop = !globalThis.matchMedia?.('(max-width: 767.98px)').matches;
      button.setAttribute('aria-expanded','true');
      const onScroll = event => {
        if (!(event.target instanceof Node) || !this.panel?.root.contains(event.target)) this.panel?.close();
      };
      const onResize = () => this.panel?.close();
      this.panel = sheet.open({
        title:'Filters', returnFocus:button,
        onClose: () => {
          this.panel = null;
          button.setAttribute('aria-expanded','false');
          window.removeEventListener('scroll',onScroll,true);
          window.removeEventListener('resize',onResize);
        },
        build: (_body, ui) => this.buildOptions(ui),
      });
      const root = this.panel.root;
      root.classList.add('rt-community-sheet');
      if (!desktop) return;

      root.dataset.rtAnchored = '';
      const popup = root.querySelector('.rt-fsheet');
      popup.classList.add('rt-inline-menu');
      const rect = button.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth || innerWidth;
      const viewportHeight = document.documentElement.clientHeight || innerHeight;
      const width = Math.min(360,viewportWidth - 16);
      const below = viewportHeight - rect.bottom - 16;
      const above = rect.top - 16;
      const useAbove = below < 240 && above > below;
      const preferredLeft = getComputedStyle(button).direction === 'rtl' ? rect.right - width : rect.left;
      popup.style.width = width + 'px';
      popup.style.left = Math.max(8,Math.min(preferredLeft,viewportWidth - width - 8)) + 'px';
      popup.style.maxHeight = Math.min(560,Math.max(90,useAbove ? above : below)) + 'px';
      if (useAbove) popup.style.bottom = (viewportHeight - rect.top + 8) + 'px';
      else popup.style.top = (rect.bottom + 8) + 'px';
      window.addEventListener('scroll',onScroll,true);
      window.addEventListener('resize',onResize);
    }

    buildOptions(ui) {
      if (this.feed) {
        const chosen = filters.parse(this.url.search).types;
        const update = type => {
          const current = filters.parse(this.url.search).types;
          this.applyTypes(current.includes(type) ? current.filter(value => value !== type) : [...current,type]);
        };
        ui.chips('Post type',[
          {label:'All types', icon:filters.svgIcon('show',16), selected:!chosen.length, keepOpen:true, onSelect:() => this.applyTypes([])},
          ...filters.typeSections.flatMap(({label,types}) => [{heading:label},...types.map(type => ({
            label:filters.typeLabels[type], icon:filters.svgIcon(type === 'gif' ? 'gif-post-outline' : filters.typeIcons[type],16),
            selected:chosen.includes(type), keepOpen:true, onSelect:() => update(type),
          }))]),
        ]);
      } else {
        const options = (label, key, values, fallback) => ui.chips(label,values.map(([value,text,icon]) => ({
          label:text, icon:filters.svgIcon(icon || 'calendar',16), selected:(this.url.searchParams.get(key) || fallback) === value,
          onSelect:() => this.go(setSearchOption(this.url,key,value)),
        })));
        options('Sort','sort',searchSorts,'relevance');
        options('Date','t',searchDates,'all');
        if (this.url.searchParams.get('type') === 'media') {
          ui.title('Reddit handles the date range for Media. Media cards do not show dates.');
        }
        options('Results','type',resultTypes,'posts');
      }
      ui.divider();
      const active = this.feed ? feedFlair(this.url) : searchParts(this.url).flair;
      ui.row({label:'Flair', icon:filters.svgIcon('filter',16), subtitle:active || 'All flairs', chevron:true, keepOpen:true, onSelect:() => {
        ui.push({title:'Flair',build:(body, page) => this.buildFlairs(body,page,active)});
        return {stay:true};
      }});
    }

    buildFlairs(body, ui, active) {
      ui.row({label:'All flairs', selected:!active, onSelect:() => this.go(withFlair(this.url,''))});
      const choices = new Set(this.flairs.get(fold(this.scope.name)) || []);
      if (active) choices.add(active);
      for (const label of [...choices].sort((a,b) => a.localeCompare(b))) {
        ui.row({label, selected:label === active, onSelect:() => this.go(withFlair(this.url,label))});
      }
      const form = make('form','rt-community-flair-form');
      const input = make('input');
      input.type = 'text';
      input.maxLength = 100;
      input.placeholder = 'Exact flair name';
      input.setAttribute('aria-label','Exact flair name');
      input.required = true;
      const submit = make('button','rt-community-button','Apply');
      submit.type = 'submit';
      form.append(input,submit);
      form.addEventListener('submit',event => {
        event.preventDefault();
        const label = flairName(input.value);
        if (label) { this.go(withFlair(this.url,label)); ui.close(); }
      });
      body.append(form);
    }

    prepareBrowseHeader() {
      const query = this.url.searchParams.get('q');
      const base = searchParts(this.url).query;
      if (fold(base) !== 'subreddit:' + fold(this.scope.name)) return;
      for (const host of document.querySelectorAll('reddit-search-large,reddit-search-small')) {
        if (host.getAttribute('initial-query') !== query) continue;
        const root = host.shadowRoot || host;
        const field = root.querySelector('faceplate-search-input[name="q"]');
        const input = (field?.shadowRoot || root).querySelector('input[name="q"],textarea[name="q"]');
        if (input?.value === query && input !== input.getRootNode().activeElement) input.value = '';
      }
    }

    prepareInput(event) {
      const url = new URL(location.href);
      const scope = this.enabled && route(url);
      if (scope?.kind !== 'search') return;
      const input = scopedField(event,scope);
      if (!input) return;
      const {query} = searchParts(url);
      if (fold(query) === 'subreddit:' + fold(scope.name) && input.value === url.searchParams.get('q')) input.value = '';
    }

    handleKey(event) {
      if (!this.enabled || event.defaultPrevented || event.key !== 'Enter' || event.isComposing ||
          event.repeat || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const url = new URL(location.href);
      const scope = route(url);
      if (scope?.kind !== 'feed' || !this.feed?.isConnected || fold(this.scope?.name) !== fold(scope.name)) return;
      const input = scopedField(event,scope);
      if (!input || input.value.trim()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.go(searchUrl(url,scope.name));
    }

    destroy() {
      if (this.dead) return;
      this.dead = true;
      this.clear();
      this.observer.disconnect();
      window.removeEventListener('popstate',this.onRoute);
      document.removeEventListener('reddit:route',this.onRoute);
      document.removeEventListener('keydown',this.onKeys,true);
      document.removeEventListener('focusin',this.onFocus,true);
    }
  }

  globalThis.RTLiveSubredditFilters = Object.freeze({Controller,route,searchUrl,withFlair});
  if (globalThis.chrome?.runtime?.id) {
    const controller = new Controller({enabled:false});
    const update = settings => controller.setEnabled(settings?.postDiscovery !== false);
    chrome.runtime.sendMessage({scope:'rt-posts',action:'get-settings'}).then(result => {
      if (result?.ok) update(result.settings);
    }).catch(() => {});
    chrome.runtime.onMessage.addListener(message => {
      if (message?.scope === 'rt-posts' && message.action === 'settings-changed') update(message.settings);
    });
  }
})();
